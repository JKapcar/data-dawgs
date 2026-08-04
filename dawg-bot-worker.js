/**
 * toto Worker — Dawg Bot proxy + Bozo trust layer
 * -----------------------------------------------
 * datadawgs216.com is a static site in a PUBLIC repo, so nothing secret can live
 * in a page. This Worker holds every secret and does every privileged write.
 *
 * ROUTES
 *   POST /             — Dawg Bot chat proxy (unchanged from the original Worker)
 *   GET  /scores       — ESPN scoreboard proxy. DEAD: ESPN 403s Cloudflare egress
 *                        (see the note above handleScores). The page calls ESPN
 *                        itself; this stays only as a fallback.
 *   GET  /bozo/roster  — player list + who has claimed a password (public)
 *   POST /bozo/claim   — spend a one-time join token, set your own password
 *   POST /bozo/login   — name + password  → session
 *   POST /bozo/passwd  — change your own password (session)
 *   POST /bozo/pick    — submit / edit / remove a leg (session)
 *   POST /bozo/grade   — write results + verdict (admin session)
 *   POST /bozo/next    — archive week, open the next (admin session)
 *   POST /bozo/reset   — admin clears a player's password so their original
 *                        join link works again (the no-email recovery path)
 *
 * SECRETS (dashboard → Worker → Settings → Variables → Encrypt):
 *   XAI_KEY      = xai-... key
 *   DAWG_PASS    = league passphrase for the chat bot
 *   FB_SECRET    = RTDB legacy database secret. Grants the Worker write access
 *                  after the /bozo rule goes .write:false.
 *   BOZO_TOKENS  = JSON map of one-time join token → player name
 *   BOZO_PEPPER  = random string. Peppers password hashes AND signs sessions.
 *                  Never stored in the database, so a database leak alone does
 *                  not enable an offline password attack. Rotating it logs
 *                  everyone out and invalidates every stored hash.
 * PLAIN VARIABLES:
 *   MODEL        = grok-4.5      DAILY_CAP = 400      BOZO_ADMIN = Kap
 *
 * TRUST MODEL — why the Worker is in the write path at all:
 * Bozo is eight writers with something to gain. Submission time is a scoring
 * input (Last In) and price is another (Shortest Odds), so the Worker — not the
 * client — stamps the timestamp, and the RTDB rule for /bozo is .read:true /
 * .write:false so no browser can write directly. The tiebreaker permutation is
 * drawn HERE with crypto randomness the moment the last leg lands, and written
 * once; a client-side roll would be re-rollable.
 *
 * ⚠️ Password hashes live under /bozoauth, NOT under /bozo. /bozo is
 * world-readable by design (everyone sees the ticket); anything under it is
 * public. Never move auth data inside it.
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
    "Access-Control-Allow-Headers": "Content-Type, X-Dawg-Pass, X-Bozo-Session",
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

    if (url.pathname === "/scores")       return handleScores(url, cors);
    if (url.pathname === "/bozo/roster")  return bozoRoster(env, cors);
    if (url.pathname === "/bozo/claim")   return bozoClaim(request, env, cors);
    if (url.pathname === "/bozo/login")   return bozoLogin(request, env, cors);
    if (url.pathname === "/bozo/passwd")  return bozoPasswd(request, env, cors);
    if (url.pathname === "/bozo/pick")    return bozoPick(request, env, cors);
    if (url.pathname === "/bozo/grade")   return bozoGrade(request, env, cors);
    if (url.pathname === "/bozo/next")    return bozoNext(request, env, cors);
    if (url.pathname === "/bozo/reset")   return bozoReset(request, env, cors);

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
// ⚠️ 8/4/26: ESPN answers 403 to Cloudflare Worker egress and 200 to a browser
// on the identical path. Three header shapes were tested — full browser
// impersonation, UA-only, and bare — and ALL THREE 403'd across nfl/mlb/nba.
// It is an IP/ASN block, not header fingerprinting. Another permutation will
// not fix it. bozo.html calls ESPN directly (its CORS is permissive); this
// route survives only as a fallback if that ever closes. `via` reports which
// shape won so a future failure needs no rediagnosis.

const UA_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

const FETCH_SHAPES = [
  { name: "browser", headers: {
      "User-Agent": UA_CHROME,
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.espn.com/",
      "Origin": "https://www.espn.com",
    } },
  { name: "ua-only", headers: { "User-Agent": UA_CHROME } },
  { name: "bare", headers: {} },
];

async function handleScores(url, cors) {
  const sport = url.searchParams.get("sport");
  const dates = url.searchParams.get("dates") || "";
  const path = LEAGUE[sport];
  if (!path) return json({ error: "unknown sport" }, 400, cors);

  let src = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`;
  if (dates) src += `?dates=${encodeURIComponent(dates)}&limit=400`;

  let raw, via = null;
  const tried = [];
  for (const shape of FETCH_SHAPES) {
    try {
      const r = await fetch(src, { cf: { cacheTtl: 60, cacheEverything: true }, headers: shape.headers });
      if (!r.ok) { tried.push(`${shape.name}:${r.status}`); continue; }
      raw = await r.json();
      via = shape.name;
      break;
    } catch (e) {
      tried.push(`${shape.name}:${e.message}`);
    }
  }
  if (!via) return json({ error: "scores unavailable", detail: tried.join(", ") }, 502, cors);

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
      state: st.state || "pre",
      final: st.completed === true,
      teams,
    };
  });

  return new Response(JSON.stringify({ sport, games, via, fetched: Date.now() }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "max-age=60", ...cors },
  });
}

/* ============================== RTDB plumbing ============================= */

const fbUrl = (env, path) => `${DB}${path}.json?auth=${env.FB_SECRET}`;

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
  if (r.status === 412) return false;      // ETag mismatch — someone wrote first
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

/* ================================ Bozo auth =============================== */
// Identity in three moves:
//   1. Kap texts each player a one-time claim link: bozo.html?join=<token>
//   2. First open, the player sets THEIR OWN password → /bozo/claim.
//      The token is spent at that moment; forwarding the link afterwards
//      does nothing. That is the whole reason this beats bearer tokens.
//   3. Every visit after that is name + password → /bozo/login.
// Both return a stateless HMAC-signed session sent as X-Bozo-Session.
// Forgot it? Kap calls /bozo/reset, which clears the hash and re-arms the
// original join link. No email, no reset tokens, no extra moving parts.

// ⚠️ DO NOT RAISE PBKDF2_ITERS on the free plan. Workers Free caps CPU at 10ms
// per request — hard, no override. Benchmarked steady-state: 100k ≈ 49ms (killed
// every time), 12k ≈ 6.2ms, 8k ≈ 4.0ms, 5k ≈ 2.7ms. /bozo/passwd runs the KDF
// TWICE (verify old + hash new), so the binding number is 2×: 8k lands at 8.9ms
// against a 10ms ceiling — about 1ms of headroom before session signing and JSON
// are counted, which is not enough. 5k gives 4.9ms and room to breathe.
// Each stored record carries its own
// `iters`, so if this ever moves to a paid plan you can raise the constant and
// old passwords keep working — no migration, no lockout.
//
// What actually defends these passwords, in order: the 48-byte BOZO_PEPPER
// (not in the database, so a database leak alone is useless), then the 10/hour
// failure cap below. Online guessing is the realistic attack against eight
// friends and the cap makes it hopeless. The iteration count is doing very
// little work here and is not worth blowing the CPU budget over.
const PBKDF2_ITERS = 5_000;
const SESSION_DAYS = 60;
const LOGIN_FAIL_CAP = 10;        // per player per hour; needs the RL binding
const MIN_PW = 8;

const te = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64urlStr = s => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64urlStr = s => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

// The pepper is mixed into the password itself, so the stored hash is useless
// to anyone who steals the database but not the Worker's secrets.
async function pbkdf2(password, pepper, saltB64, iters) {
  const key = await crypto.subtle.importKey(
    "raw", te.encode(password + "\u0000" + pepper), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iters }, key, 256);
  return b64(bits);
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(msg));
  return b64(sig).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function makeSession(env, name) {
  const payload = b64urlStr(JSON.stringify({ n: name, e: Date.now() + SESSION_DAYS * 864e5 }));
  return payload + "." + (await hmac(env.BOZO_PEPPER, payload));
}

async function readSession(env, tok) {
  if (typeof tok !== "string" || tok.indexOf(".") < 1) return null;
  const [payload, sig] = tok.split(".");
  if (!timingSafeEqual(sig || "", await hmac(env.BOZO_PEPPER, payload))) return null;
  let o;
  try { o = JSON.parse(unb64urlStr(payload)); } catch { return null; }
  if (!o || !o.n || !o.e || Date.now() > o.e) return null;
  return o.n;
}

function bozoConfig(env) {
  if (!env.FB_SECRET || !env.BOZO_TOKENS || !env.BOZO_PEPPER)
    return "Worker misconfigured: Bozo secrets not set.";
  return null;
}

function tokenMap(env) {
  try { return JSON.parse(env.BOZO_TOKENS); } catch { return null; }
}

const authPath = name => "/bozoauth/" + encodeURIComponent(name);

async function sessionAuth(request, env) {
  const cfg = bozoConfig(env);
  if (cfg) return { err: cfg, code: 500 };
  const map = tokenMap(env);
  if (!map) return { err: "Worker misconfigured: BOZO_TOKENS is not valid JSON.", code: 500 };
  const name = await readSession(env, request.headers.get("X-Bozo-Session") || "");
  if (!name) return { err: "Sign in first.", code: 401 };
  const players = Object.values(map);
  if (!players.includes(name)) return { err: "Unknown player.", code: 403 };
  return { name, players };
}

// GET /bozo/roster — who exists and who has set a password. No secrets: it is
// exactly what the login screen needs to decide "claim" vs "sign in".
async function bozoRoster(env, cors) {
  const cfg = bozoConfig(env);
  if (cfg) return json({ error: cfg }, 500, cors);
  const map = tokenMap(env);
  if (!map) return json({ error: "Worker misconfigured: BOZO_TOKENS is not valid JSON." }, 500, cors);
  let auth = {};
  try { auth = (await fbGet(env, "/bozoauth")).data || {}; }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
  const players = Object.values(map).map(n => ({ name: n, claimed: !!auth[n] }));
  return json({ players }, 200, cors);
}

async function bozoClaim(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const cfg = bozoConfig(env);
  if (cfg) return json({ error: cfg }, 500, cors);
  const map = tokenMap(env);
  if (!map) return json({ error: "Worker misconfigured: BOZO_TOKENS is not valid JSON." }, 500, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const token = String(body.token || "");
  let name = null;
  for (const [t, n] of Object.entries(map)) if (timingSafeEqual(token, t)) name = n;
  if (!name) return json({ error: "That claim link isn't valid." }, 403, cors);

  const pw = String(body.password || "");
  if (pw.length < MIN_PW) return json({ error: `Password must be at least ${MIN_PW} characters.` }, 400, cors);

  try {
    const existing = (await fbGet(env, authPath(name))).data;
    if (existing) {
      return json({
        error: `${name} has already set a password. Sign in instead — or ask Kap to reset it.`,
      }, 409, cors);
    }
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    const salt = b64(saltBytes);
    const hash = await pbkdf2(pw, env.BOZO_PEPPER, salt, PBKDF2_ITERS);
    await fbPut(env, authPath(name), { v: 1, salt, hash, iters: PBKDF2_ITERS, setAt: Date.now() });
    return json({ ok: true, name, session: await makeSession(env, name) }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}

async function bozoLogin(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const cfg = bozoConfig(env);
  if (cfg) return json({ error: cfg }, 500, cors);
  const map = tokenMap(env);
  if (!map) return json({ error: "Worker misconfigured: BOZO_TOKENS is not valid JSON." }, 500, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const name = String(body.name || "");
  const pw = String(body.password || "");
  if (!Object.values(map).includes(name)) return json({ error: "Unknown player." }, 403, cors);

  // Online brute force is the only realistic attack on an 8-person password.
  // The RL binding makes this real; without it the cap is inert.
  const bucket = "bozofail:" + name + ":" + Math.floor(Date.now() / 3600000);
  if (env.RL) {
    const fails = parseInt((await env.RL.get(bucket)) || "0", 10);
    if (fails >= LOGIN_FAIL_CAP) {
      return json({ error: "Too many wrong passwords. Try again in an hour." }, 429, cors);
    }
  }

  try {
    const rec = (await fbGet(env, authPath(name))).data;
    if (!rec) return json({ error: `${name} hasn't set a password yet — use the join link Kap texted you.` }, 409, cors);
    const hash = await pbkdf2(pw, env.BOZO_PEPPER, rec.salt, rec.iters || PBKDF2_ITERS);
    if (!timingSafeEqual(hash, rec.hash)) {
      if (env.RL) {
        const fails = parseInt((await env.RL.get(bucket)) || "0", 10);
        await env.RL.put(bucket, String(fails + 1), { expirationTtl: 7200 });
      }
      return json({ error: "Wrong password." }, 401, cors);
    }
    return json({ ok: true, name, session: await makeSession(env, name) }, 200, cors);
  } catch (e) {
    return json({ error: "Database unreachable: " + e.message }, 502, cors);
  }
}

async function bozoPasswd(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const oldPw = String(body.oldPassword || "");
  const newPw = String(body.newPassword || "");
  if (newPw.length < MIN_PW) return json({ error: `Password must be at least ${MIN_PW} characters.` }, 400, cors);

  try {
    const rec = (await fbGet(env, authPath(auth.name))).data;
    if (!rec) return json({ error: "No password on file." }, 409, cors);
    const check = await pbkdf2(oldPw, env.BOZO_PEPPER, rec.salt, rec.iters || PBKDF2_ITERS);
    if (!timingSafeEqual(check, rec.hash)) return json({ error: "Current password is wrong." }, 401, cors);

    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    const salt = b64(saltBytes);
    const hash = await pbkdf2(newPw, env.BOZO_PEPPER, salt, PBKDF2_ITERS);
    await fbPut(env, authPath(auth.name), { v: 1, salt, hash, iters: PBKDF2_ITERS, setAt: Date.now() });
    return json({ ok: true, session: await makeSession(env, auth.name) }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}

// Admin-only recovery. Clearing the hash re-arms that player's original join
// link, so the fix is "Kap resets you, then re-open the text I sent you."
async function bozoReset(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = await requireAdmin(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const player = String(body.player || "");
  if (!auth.players.includes(player)) return json({ error: "Unknown player." }, 400, cors);
  try {
    await fbDelete(env, authPath(player));
    return json({ ok: true, reset: player }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}

/* =============================== /bozo/pick =============================== */
// One leg per person. Favorites only, −100 to −300. No exact duplicates.
// Editing is allowed while the board is open — the Worker stamps a fresh server
// timestamp, which is what "editing resets your clock and your price" means.
// When the last leg lands, the board locks and the permutation is drawn.

async function bozoPick(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code, cors);
  const { name, players } = auth;

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  let state;
  try { state = (await fbGet(env, "/bozo")).data || {}; }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }

  if ((state.status || "open") !== "open") {
    return json({ error: "The ticket is placed. Board is locked." }, 409, cors);
  }

  try {
    if (body.action === "remove") {
      await fbDelete(env, "/bozo/picks/" + encodeURIComponent(name));
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
      ts: Date.now(),                 // SERVER time — the reason this route exists
    };
    await fbPut(env, "/bozo/picks/" + encodeURIComponent(name), pick);

    const picks = (await fbGet(env, "/bozo/picks")).data || {};
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
// The ETag guard means two simultaneous final submissions can't both draw.
async function placeAndDraw(env, picks) {
  const cur = await fbGet(env, "/bozo/order", true);
  if (cur.data != null) return true;                 // already drawn — never redraw

  const order = [0, 1, 2, 3];
  const rnd = new Uint32Array(4);
  crypto.getRandomValues(rnd);
  for (let i = 3; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }

  const wrote = await fbPut(env, "/bozo/order", order, cur.etag);
  if (!wrote) return true;                           // lost the race — other draw stands

  const closeTs = Math.max(...Object.values(picks).map(x => x.ts || 0));
  await fbPut(env, "/bozo/status", "placed");
  await fbPut(env, "/bozo/closeTs", closeTs);
  return true;
}

/* ========================== /bozo/grade, /bozo/next ======================= */
// Admin-only writes. The verdict is client-computed but admin-signed — anyone
// can recompute it from the public order + results and call BS. The one thing
// that must not be client-side (the permutation) already isn't.

async function requireAdmin(request, env) {
  const auth = await sessionAuth(request, env);
  if (auth.err) return auth;
  const admin = env.BOZO_ADMIN || "";
  if (!admin || auth.name !== admin) return { err: "Admin only.", code: 403 };
  return auth;
}

async function bozoGrade(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = await requireAdmin(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  try {
    const status = (await fbGet(env, "/bozo/status")).data;
    if (status !== "placed" && status !== "graded")
      return json({ error: "Nothing to grade — ticket isn't placed." }, 409, cors);

    if (body.results && typeof body.results === "object")
      await fbPut(env, "/bozo/results", body.results);
    if (body.bozo !== undefined) await fbPut(env, "/bozo/bozo", body.bozo);
    if (body.bozoWhy !== undefined) await fbPut(env, "/bozo/bozoWhy", String(body.bozoWhy).slice(0, 200));
    if (body.graded) await fbPut(env, "/bozo/status", "graded");
    return json({ ok: true }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}

async function bozoNext(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = await requireAdmin(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  try {
    const state = (await fbGet(env, "/bozo")).data || {};
    const history = Array.isArray(state.history) ? state.history : [];
    history.push({ week: state.week || 1, bozo: state.bozo || null });
    await fbPut(env, "/bozo", {
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
