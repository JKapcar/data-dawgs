/**
 * toto Worker — Dawg Bot proxy + Bozo trust layer
 * -----------------------------------------------
 * datadawgs216.com is a static site in a PUBLIC repo, so nothing secret can live
 * in a page. This Worker holds every secret and does every privileged write.
 *
 * ROUTES
 *   POST /            — Dawg Bot chat proxy (unchanged from the original Worker)
 *   GET  /scores      — ESPN scoreboard proxy (public data; CORS + edge cache)
 *   POST /bozo/pick   — submit / edit / remove a leg   (join-token auth)
 *   POST /bozo/grade  — write results + verdict        (admin token only)
 *   POST /bozo/next   — archive week, open the next    (admin token only)
 *
 * SECRETS (dashboard → Worker → Settings → Variables → Encrypt):
 *   XAI_KEY      = xai-... key
 *   DAWG_PASS    = league passphrase for the chat bot
 *   FB_SECRET    = RTDB legacy database secret (console → Project settings →
 *                  Service accounts → Database secrets). Grants the Worker
 *                  write access after the /bozo rule goes .write:false.
 *   BOZO_TOKENS  = JSON map of join token → player name, e.g.
 *                  {"a1b2c3d4e5f6":"Kap","f6e5d4c3b2a1":"Will", ...}
 * PLAIN VARIABLES:
 *   MODEL        = grok-4.5 (chat model; default grok-4-1-fast if unset)
 *   DAILY_CAP    = 400
 *   BOZO_ADMIN   = player name whose token may call /bozo/grade and /bozo/next
 *
 * TRUST MODEL — why the Worker is in the write path at all:
 * Bozo is nine writers with something to gain. Submission time is a scoring
 * input (Last In lever) and price is another (Shortest Odds), so the Worker —
 * not the client — stamps the timestamp, and the RTDB rule for /bozo is
 * .read:true / .write:false so no browser can write directly. The tiebreaker
 * permutation is drawn HERE with crypto randomness the moment the ninth leg
 * lands, and written once; a client-side roll would be re-rollable.
 */

const ORIGINS = [
  "https://datadawgs216.com",
  "https://www.datadawgs216.com",
  "https://jkapcar.github.io",
];

const UPSTREAM = "https://api.x.ai/v1/chat/completions";
const MAX_BODY = 24_000;
const MAX_TOKENS = 800;
const MAX_MSGS = 12;

const DB = "https://data-dawgs-draft-default-rtdb.firebaseio.com";

const LEAGUE = {
  nfl: "football/nfl",
  cfb: "football/college-football",
  nba: "basketball/nba",
  cbb: "basketball/mens-college-basketball",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
};
const MARKETS = ["spread", "ml", "total", "prop"];

function corsFor(origin) {
  const allow = ORIGINS.includes(origin) ? origin : ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Content-Type, X-Dawg-Pass, X-Bozo-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

const json = (obj, status, cors) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsFor(origin);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    if (url.pathname === "/scores") return handleScores(url, cors);
    if (url.pathname === "/bozo/pick") return bozoPick(request, env, cors);
    if (url.pathname === "/bozo/grade") return bozoGrade(request, env, cors);
    if (url.pathname === "/bozo/next") return bozoNext(request, env, cors);

    return handleChat(request, env, origin, cors);
  },
};

/* ============================== Dawg Bot chat ============================== */

async function handleChat(request, env, origin, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  if (!ORIGINS.includes(origin)) return json({ error: "Bad origin." }, 403, cors);
  if (!env.XAI_KEY) return json({ error: "Worker misconfigured: XAI_KEY secret not set." }, 500, cors);
  if (!env.DAWG_PASS) return json({ error: "Worker misconfigured: DAWG_PASS secret not set." }, 500, cors);

  const pass = request.headers.get("X-Dawg-Pass") || "";
  if (!timingSafeEqual(pass, env.DAWG_PASS)) {
    return json({ error: "Wrong league passphrase." }, 401, cors);
  }

  const cap = parseInt(env.DAILY_CAP || "400", 10);
  if (env.RL) {
    const day = new Date().toISOString().slice(0, 10);
    const key = "count:" + day;
    const used = parseInt((await env.RL.get(key)) || "0", 10);
    if (used >= cap) {
      return json({ error: `Dawg Bot hit its daily cap (${cap} questions). Resets at midnight UTC.` }, 429, cors);
    }
    await env.RL.put(key, String(used + 1), { expirationTtl: 172800 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: "Request too large." }, 413, cors);

  let body;
  try { body = JSON.parse(raw); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const messages = Array.isArray(body.messages) ? body.messages.slice(-MAX_MSGS) : [];
  if (!messages.length) return json({ error: "No messages." }, 400, cors);

  const payload = {
    model: env.MODEL || "grok-4-1-fast",
    max_tokens: Math.min(MAX_TOKENS, parseInt(body.max_tokens, 10) || 700),
    messages,
  };

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.XAI_KEY },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json({ error: "Couldn't reach the AI provider: " + e.message }, 502, cors);
  }

  const text = await upstream.text();
  return new Response(text, { status: upstream.status, headers: { ...cors, "Content-Type": "application/json" } });
}

/* ================================ /scores ================================= */
// ESPN's site API is public and unauthenticated; proxying gives CORS + cache.
// Upstream is undocumented and can move — fail loudly (502) so the page falls
// back to manual entry instead of silently grading nothing.

async function handleScores(url, cors) {
  const sport = url.searchParams.get("sport");
  const dates = url.searchParams.get("dates") || "";
  const path = LEAGUE[sport];
  if (!path) return json({ error: "unknown sport" }, 400, cors);

  let src = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`;
  if (dates) src += `?dates=${encodeURIComponent(dates)}&limit=400`;

  let raw;
  try {
    const r = await fetch(src, {
      cf: { cacheTtl: 60, cacheEverything: true },
      headers: { "User-Agent": "data-dawgs-bozo/1" },
    });
    if (!r.ok) throw new Error("upstream " + r.status);
    raw = await r.json();
  } catch (e) {
    return json({ error: "scores unavailable", detail: String(e) }, 502, cors);
  }

  const games = (raw.events || []).map(ev => {
    const comp = (ev.competitions && ev.competitions[0]) || {};
    const teams = (comp.competitors || []).map(c => ({
      abbr: (c.team && (c.team.abbreviation || c.team.shortDisplayName)) || "?",
      name: (c.team && c.team.displayName) || "?",
      home: c.homeAway === "home",
      score: c.score == null ? null : Number(c.score),
    }));
    const st = (ev.status && ev.status.type) || {};
    return {
      id: String(ev.id),
      short: ev.shortName || ev.name || "",
      start: ev.date || null,
      state: st.state || "pre", // pre | in | post
      final: st.completed === true,
      teams,
    };
  });

  return new Response(JSON.stringify({ sport, games, fetched: Date.now() }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "max-age=60", ...cors },
  });
}

/* ============================== Bozo helpers ============================== */

function bozoAuth(request, env) {
  if (!env.FB_SECRET || !env.BOZO_TOKENS) return { err: "Worker misconfigured: Bozo secrets not set." };
  let map;
  try { map = JSON.parse(env.BOZO_TOKENS); }
  catch { return { err: "Worker misconfigured: BOZO_TOKENS is not valid JSON." }; }
  const token = request.headers.get("X-Bozo-Token") || "";
  for (const [t, name] of Object.entries(map)) {
    if (timingSafeEqual(token, t)) return { name, players: Object.values(map) };
  }
  return { err: "Bad join token." };
}

const fbUrl = (env, path) => `${DB}/bozo${path}.json?auth=${env.FB_SECRET}`;

async function fbGet(env, path, withEtag) {
  const r = await fetch(fbUrl(env, path), withEtag ? { headers: { "X-Firebase-ETag": "true" } } : undefined);
  if (!r.ok) throw new Error("RTDB read " + r.status);
  return { data: await r.json(), etag: r.headers.get("ETag") };
}

async function fbPut(env, path, value, etag) {
  const r = await fetch(fbUrl(env, path), {
    method: "PUT",
    headers: etag ? { "if-match": etag } : {},
    body: JSON.stringify(value),
  });
  if (r.status === 412) return false; // ETag mismatch — someone else wrote first
  if (!r.ok) throw new Error("RTDB write " + r.status);
  return true;
}

async function fbDelete(env, path) {
  const r = await fetch(fbUrl(env, path), { method: "DELETE" });
  if (!r.ok) throw new Error("RTDB delete " + r.status);
}

async function readBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new Error("too large");
  return JSON.parse(raw);
}

/* =============================== /bozo/pick =============================== */
// One leg per person. Favorites only, −100 to −300. No exact duplicates.
// Editing allowed while the board is open — the Worker stamps a fresh server
// timestamp, which is what "editing resets your clock and your price" means.
// When the ninth leg lands, the board locks and the permutation is drawn.

async function bozoPick(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = bozoAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.err.startsWith("Bad") ? 403 : 500, cors);
  const { name, players } = auth;

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  let state;
  try { state = (await fbGet(env, "")).data || {}; }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }

  if ((state.status || "open") !== "open") {
    return json({ error: "The ticket is placed. Board is locked." }, 409, cors);
  }

  try {
    if (body.action === "remove") {
      await fbDelete(env, "/picks/" + encodeURIComponent(name));
      return json({ ok: true, removed: true }, 200, cors);
    }

    const p = body.pick || {};
    const err = validatePick(p, name, state.picks || {});
    if (err) return json({ error: err }, 400, cors);

    const pick = {
      sport: p.sport, eventId: String(p.eventId), game: String(p.game).slice(0, 80),
      mkt: p.mkt, side: String(p.side).slice(0, 40),
      line: p.mkt === "ml" ? 0 : Number(p.line),
      dir: (p.mkt === "total" || p.mkt === "prop") ? p.side : "over",
      price: Math.round(Number(p.price)),
      label: String(p.label).slice(0, 90),
      prop: p.prop ? String(p.prop).slice(0, 80) : null,
      ts: Date.now(), // SERVER time — the whole reason this route exists
    };
    await fbPut(env, "/picks/" + encodeURIComponent(name), pick);

    // Ninth leg in → that moment is the close. Lock, stamp, draw — once.
    const picks = (await fbGet(env, "/picks")).data || {};
    let placed = false;
    if (Object.keys(picks).length >= players.length) {
      placed = await placeAndDraw(env, picks);
    }
    return json({ ok: true, ts: pick.ts, placed }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}

function validatePick(p, name, existing) {
  if (!LEAGUE[p.sport]) return "Unknown sport.";
  if (!MARKETS.includes(p.mkt)) return "Unknown market.";
  if (!p.eventId || !p.game) return "Pick a game.";
  if (!p.label || !p.side) return "Incomplete pick.";
  const price = Number(p.price);
  if (!isFinite(price) || price > -100 || price < -300)
    return `${p.price} is outside the −100 to −300 band.`;
  if (p.mkt !== "ml" && !isFinite(Number(p.line))) return "Number is required for that market.";
  const label = String(p.label).toLowerCase();
  for (const [who, x] of Object.entries(existing)) {
    if (who !== name && x && String(x.label).toLowerCase() === label)
      return `${who} already has that exact leg.`;
  }
  return null;
}

// Server-side Fisher–Yates over the four levers, crypto-seeded, written once.
// The ETag guard means two simultaneous ninth submissions can't both draw.
async function placeAndDraw(env, picks) {
  const cur = await fbGet(env, "/order", true);
  if (cur.data != null) return true; // already drawn — never redraw

  const order = [0, 1, 2, 3];
  const rnd = new Uint32Array(4);
  crypto.getRandomValues(rnd);
  for (let i = 3; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }

  const wrote = await fbPut(env, "/order", order, cur.etag);
  if (!wrote) return true; // lost the race — the other draw stands

  const closeTs = Math.max(...Object.values(picks).map(x => x.ts || 0));
  await fbPut(env, "/status", "placed");
  await fbPut(env, "/closeTs", closeTs);
  return true;
}

/* ========================== /bozo/grade, /bozo/next ======================= */
// Admin-only writes. The verdict is client-computed but admin-signed — anyone
// can recompute it from the public order + results and call BS. The one thing
// that must not be client-side (the permutation) already isn't.

function requireAdmin(request, env) {
  const auth = bozoAuth(request, env);
  if (auth.err) return auth;
  const admin = env.BOZO_ADMIN || "";
  if (!admin || auth.name !== admin) return { err: "Admin only." };
  return auth;
}

async function bozoGrade(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = requireAdmin(request, env);
  if (auth.err) return json({ error: auth.err }, 403, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  try {
    const status = (await fbGet(env, "/status")).data;
    if (status !== "placed" && status !== "graded")
      return json({ error: "Nothing to grade — ticket isn't placed." }, 409, cors);

    if (body.results && typeof body.results === "object")
      await fbPut(env, "/results", body.results);
    if (body.bozo !== undefined) await fbPut(env, "/bozo", body.bozo);
    if (body.bozoWhy !== undefined) await fbPut(env, "/bozoWhy", String(body.bozoWhy).slice(0, 200));
    if (body.graded) await fbPut(env, "/status", "graded");
    return json({ ok: true }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}

async function bozoNext(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = requireAdmin(request, env);
  if (auth.err) return json({ error: auth.err }, 403, cors);

  try {
    const state = (await fbGet(env, "")).data || {};
    const history = Array.isArray(state.history) ? state.history : [];
    history.push({ week: state.week || 1, bozo: state.bozo || null });
    await fbPut(env, "", {
      week: (state.week || 1) + 1,
      status: "open",
      history,
    });
    return json({ ok: true, week: (state.week || 1) + 1 }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}

/* ================================= util =================================== */

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
