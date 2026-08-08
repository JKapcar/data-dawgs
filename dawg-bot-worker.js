/**
 * toto Worker — Dawg Bot proxy + Bozo trust layer
 * -----------------------------------------------
 * datadawgs216.com is a static site in a PUBLIC repo, so nothing secret can live
 * in a page. This Worker holds every secret and does every privileged write.
 *
 * ROUTES
 *   POST /             — Dawg Bot chat proxy. Accepts a site session (preferred, gives
 *                        a per-user rate bucket) OR the shared DAWG_PASS (fallback).
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
 *   POST /bozo/config  — alias of /league/config
 *
 * BOZO IS MULTI-LEAGUE. Several groups, each with its OWN roster size, band, week,
 * picks and ledger, at /bozo/leagues/<id> (under /bozo, so it inherits the public-read
 * rule — no rules change). Every Bozo route takes an optional {league}; absent means
 * "main", so pre-league callers keep working.
 *   GET  /league/list    — public directory: id, name, manager, size, week, status
 *   POST /league/create  — SITE ADMIN only: {id, name, manager}
 *   POST /league/member  — manager: {league, player, action:"add"|"remove"}  ← the size dial
 *   POST /league/invite  — manager: mints a join link, CREATES the account if new
 *   POST /league/lock    — manager: force-place when someone never submits
 *   POST /league/config  — manager: the price band for that league
 *   POST /league/settings — manager: name, manager, stake, allowDupes, allowEdit,
 *                          lockRule/lockCount, levers, band — the whole rules panel
 *   POST /league/team    — manager: {player, team} display name inside this league
 * ⚠️ The lock threshold is THAT LEAGUE'S member count, never the global roster.
 *
 * IDENTITY IS SITE-WIDE. The five auth routes answer on BOTH /auth/* and /bozo/*:
 *   GET  /auth/roster  POST /auth/claim  /auth/login  /auth/passwd  /auth/reset
 *   POST /auth/invite  — admin re-issues a join link (returns the raw token ONCE)
 * The roster lives at /users in RTDB — Worker-only (no rule, so RTDB default-denies
 * every browser; the Worker reads it with FB_SECRET). BOZO_TOKENS is now only a
 * BOOTSTRAP: /users is seeded from it on first read, and after that it is the truth.
 * ⚠️ /users stores an invite HASH, never the raw token — so a database dump hands
 * nobody a live invite, and "I lost my link" is answered by minting a new one.
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
// ⚠️ "other" is deliberately LAST and deliberately constrained. It is a number +
// over/under + a price + a written description — NOT a free-for-all. Kap's call was
// "require a number anyway": an unscoreable leg would be immune to Worst Beat, and a
// lever you can opt out of is exactly what the randomised hierarchy exists to prevent.
// So an "other" leg carries a line and gets a result typed in at grading, like a prop.
const MARKETS = ["spread", "ml", "total", "prop", "other"];

// Legal-bet band, league-manager adjustable via POST /bozo/config. `ceil` is the
// closest-to-even price allowed, `floor` the deepest favorite. Favorites only, so
// ceil never rises above −100. Defaults apply when /bozo/config is absent.
// ⚠️ Kap changed the rule 8/5: floor moved −300 → −500. The band bounds the PARLAY
// price, not individual embarrassment — a deeper floor makes the ticket likelier
// to cash for less. Taste dial, not fairness dial (brief).
const BAND_DEFAULT = { ceil: -100, floor: -500 };

function bandOf(state) {
  const c = (state && state.config) || {};
  const ceil = Number.isFinite(c.bandCeil) ? c.bandCeil : BAND_DEFAULT.ceil;
  const floor = Number.isFinite(c.bandFloor) ? c.bandFloor : BAND_DEFAULT.floor;
  return { ceil, floor };
}

function corsFor(origin) {
  const allow = ORIGINS.includes(origin) ? origin : ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    // Must list EVERY custom header any page sends. A header that is accepted by
    // the handler but missing here is still killed by the browser at preflight,
    // and the page only sees "Failed to fetch" with no status and no console body.
    "Access-Control-Allow-Headers": "Content-Type, X-Dawg-Pass, X-Bozo-Session, X-Dawg-Session",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// ⚠️ no-store is load-bearing, not decoration. Without it Cloudflare's edge
// cached GET /bozo/roster and served "nobody has claimed" to a player who HAD
// just claimed — so the page showed them the claim form instead of sign-in.
// Caught live 8/4: a plain fetch returned [] while the same URL with a cache
// buster returned ["Kap"]. Every Bozo response is per-player state; none of it
// is cacheable. (/scores builds its own Response and keeps max-age=60.)
const json = (obj, status, cors) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });


// ============================================================
//  /survivor-picks — weekly survivor pick popularity for survivor.html
//
//  ⚠️ PUSH, not pull, on purpose. SurvivorGrid / PoolGenius / TeamRankings are
//  commercial products with no documented API and terms that may forbid
//  automated collection, and a scraper breaks silently on a class-name change.
//  A survivor board running on stale ownership is worse than one that admits it
//  has none. So: POST the week's numbers, KV stores them, every device reads the
//  same figures. There is deliberately no upstream fetch here.
//
//  ⚠️ Storage reuses the EXISTING `RL` namespace rather than a new binding.
//  Keys are prefixed `survivor:` so they cannot collide with the rate-limit
//  counters, and it means this route needs no dashboard change to work. If a
//  dedicated DD_KV is ever bound it is preferred automatically.
// ============================================================
const survivorKV = (env) => env.DD_KV || env.RL || null;
const survivorKey = (season, week) => `survivor:${season}:${week}`;

// Normalise to { TEAM: share } summing to 1. Rejects a row rather than guessing.
function survivorNormalise(raw) {
  const out = {}; const bad = [];
  for (const k of Object.keys(raw || {})) {
    const code = String(k).toUpperCase().replace(/[^A-Z]/g, "");
    const v = Number(raw[k]);
    if (!code || !Number.isFinite(v) || v < 0) { bad.push(k); continue; }
    out[code] = (out[code] || 0) + v;
  }
  let tot = 0; for (const k in out) tot += out[k];
  if (tot <= 0) return { picks: {}, bad, total: 0 };
  for (const k in out) out[k] = out[k] / tot;
  return { picks: out, bad, total: tot };
}

async function handleSurvivorPicks(request, url, env, cors) {
  const kv = survivorKV(env);
  if (!kv) return json({ error: "no KV binding available" }, 500, cors);

  const season = Number(url.searchParams.get("season")) || new Date().getUTCFullYear();
  const week = Number(url.searchParams.get("week"));
  if (!(week >= 1 && week <= 18)) return json({ error: "week must be 1-18" }, 400, cors);

  if (request.method === "POST") {
    // ⚠️ Gated. Without this anyone can rewrite the ownership every device reads,
    // which is a quiet way to make the board recommend whatever they like.
    const pass = request.headers.get("X-Dawg-Pass");
    if (!env.DAWG_PASS || pass !== env.DAWG_PASS) return json({ error: "unauthorised" }, 401, cors);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "bad json" }, 400, cors); }
    const { picks, bad, total } = survivorNormalise(body && body.picks);
    if (!Object.keys(picks).length) return json({ error: "no usable rows", bad }, 400, cors);
    const rec = { season, week, picks, source: (body && body.source) || "manual",
                  stored: Date.now(), rows: Object.keys(picks).length, rawTotal: total };
    await kv.put(survivorKey(season, week), JSON.stringify(rec));
    return json({ ok: true, ...rec, ignored: bad }, 200, cors);
  }

  const hit = await kv.get(survivorKey(season, week));
  if (!hit) return json({ error: "no pick data stored for this week",
                          hint: "POST it to this route, or paste it into the board" }, 404, cors);
  const rec = JSON.parse(hit);
  const ageH = (Date.now() - rec.stored) / 3.6e6;
  // Ownership moves all week. Serve it, but never let the page believe a Tuesday
  // number is a Sunday number — the page decides what to do with this.
  return json({ ...rec, ageHours: Math.round(ageH * 10) / 10, stale: ageH > 72 }, 200, cors);
}

export default {
  // Nightly RTDB snapshot to KV — see the "Nightly backup" section for why and where.
  async scheduled(controller, env, ctx) {
    try {
      await runBackup(env, (controller && controller.scheduledTime) || Date.now());
    } catch (e) {
      const kv = backupKV(env);
      if (kv) await kv.put("backup:lasterror",
        JSON.stringify({ at: new Date().toISOString(), error: String((e && e.message) || e) }));
      throw e;                            // surface the failure in the cron log
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    // DD-MCP-ROUTE — matched before ANY Origin-gated handler; see the block at the bottom.
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) return handleMcp(request, url, env);
    const origin = request.headers.get("Origin") || "";
    const cors = corsFor(origin);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    if (url.pathname === "/scores")       return handleScores(url, cors);
    if (url.pathname === "/survivor-picks") return handleSurvivorPicks(request, url, env, cors);

    // ⚠️ Identity is SITE-WIDE, not Bozo's. /auth/* is canonical; the /bozo/* spellings
    // are permanent aliases because bozo.html in the wild (and any phone with a cached
    // page) still calls them. Never remove the aliases — a stale service-worker copy of
    // the page would lose the ability to sign in.
    const AUTH = { "/roster": bozoRoster, "/claim": bozoClaim, "/login": bozoLogin,
                   "/passwd": bozoPasswd, "/reset": bozoReset, "/invite": authInvite,
                   "/mcp-token": authMcpToken, "/email": authEmail };
    for (const [suffix, fn] of Object.entries(AUTH)) {
      if (url.pathname === "/auth" + suffix || url.pathname === "/bozo" + suffix)
        return suffix === "/roster" ? fn(env, cors) : fn(request, env, cors);
    }
    if (url.pathname === "/league/list")   return leagueList(env, cors);
    if (url.pathname === "/league/create") return leagueCreate(request, env, cors);
    if (url.pathname === "/league/member") return leagueMember(request, env, cors);
    if (url.pathname === "/league/lock")   return leagueLock(request, env, cors);
    if (url.pathname === "/league/config") return bozoConfigSet(request, env, cors);
    if (url.pathname === "/league/settings") return leagueSettings(request, env, cors);
    if (url.pathname === "/league/team")   return leagueTeam(request, env, cors);
    if (url.pathname === "/league/invite") return authInvite(request, env, cors);

    if (url.pathname === "/bozo/pick")    return bozoPick(request, env, cors);
    if (url.pathname === "/bozo/grade")   return bozoGrade(request, env, cors);
    if (url.pathname === "/bozo/next")    return bozoNext(request, env, cors);
    if (url.pathname === "/bozo/config")  return bozoConfigSet(request, env, cors);
    if (url.pathname === "/tts")          return handleTts(request, env, cors);
    if (url.pathname === "/tts/models")   return ttsModels(request, env, cors);
    if (url.pathname === "/tts/voices")   return ttsVoices(request, env, cors);

    return handleChat(request, env, origin, cors);
  },
};

/* ============================== Dawg Bot chat ============================== */

async function handleChat(request, env, origin, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  if (!ORIGINS.includes(origin)) return json({ error: "Bad origin." }, 403, cors);
  if (!env.XAI_KEY) return json({ error: "Worker misconfigured: XAI_KEY secret not set." }, 500, cors);
  if (!env.DAWG_PASS) return json({ error: "Worker misconfigured: DAWG_PASS secret not set." }, 500, cors);

  // Two ways in, and the order matters. A real session is preferred; DAWG_PASS is the
  // fallback so a phone with a cached page (or anyone who hasn't claimed yet) keeps
  // working through the transition.
  //
  // ⚠️ DAWG_PASS is one shared string in fourteen browsers. It cannot be revoked for
  // one person — a single leak means rotating for everybody. That is why sessions are
  // preferred, and why the cap below is PER USER once you have one: a signed-in
  // leaguemate can't burn the whole league's daily budget, and if someone does go
  // haywire you reset that one account instead of re-texting a new passphrase to all.
  let who = null;
  const sess = await readSession(env,
    request.headers.get("X-Dawg-Session") || request.headers.get("X-Bozo-Session") || "");
  if (sess) {
    who = sess.n;
  } else {
    const pass = request.headers.get("X-Dawg-Pass") || "";
    if (!env.DAWG_PASS || !timingSafeEqual(pass, env.DAWG_PASS)) {
      return json({ error: "Sign in, or enter the league passphrase." }, 401, cors);
    }
  }

  const cap = parseInt(env.DAILY_CAP || "400", 10);
  if (env.RL) {
    const day = new Date().toISOString().slice(0, 10);
    // Signed-in users get their own bucket at a fraction of the shared cap; the
    // passphrase path keeps the single global bucket it always had.
    const perUser = Math.max(20, Math.round(cap / 4));
    const key = who ? `count:${day}:${encodeURIComponent(who)}` : "count:" + day;
    const limit = who ? perUser : cap;
    const used = parseInt((await env.RL.get(key)) || "0", 10);
    if (used >= limit) {
      return json({ error: who
        ? `You have hit your daily Dawg Bot cap (${limit} questions). Resets at midnight UTC.`
        : `Dawg Bot hit its daily cap (${limit} questions). Resets at midnight UTC.` }, 429, cors);
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

/* ================================== /tts ================================== */
// ElevenLabs voice clone for the auctioneer. The key is a Worker secret for the
// usual reason: the repo is public, so a key in the page is scraped within hours.
//
// Access is the league passphrase (X-Dawg-Pass) — the same one Dawg Bot already
// uses, so the operator's browser has it in localStorage and nobody has to
// remember a second thing. Without that gate anyone who read the page source
// could burn the ElevenLabs balance for laughs.
//
// ⚠️ The page MUST keep its speechSynthesis fallback. Draft night cannot hinge
// on a third party being up, and a 429 here should degrade to the robot voice,
// not to silence.

const TTS_MAX_CHARS = 300;          // one announcement; anything longer is a bug
const TTS_DEFAULT_MODEL = "eleven_turbo_v2_5";

// Cache key for a rendered line. Same voice + model + settings + text = same audio.
// ⚠️ `settings` MUST be in the key. Without it, the first render of a line would be
// replayed for every stability/style/speed variant — which is exactly the tuning
// bench's job to compare, and it would have compared the same clip against itself.
async function ttsCacheKey(voice, model, text, settings) {
  const buf = await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(voice + "|" + model + "|" + (settings || "") + "|" + text));
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  // A synthetic https URL: caches.default keys on the Request, and it must be a GET.
  return new Request("https://tts-cache.datadawgs.invalid/" + hex);
}

async function handleTts(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  if (!env.ELEVEN_KEY) return json({ error: "Worker misconfigured: ELEVEN_KEY not set." }, 500, cors);

  // ⚠️ NO passphrase on this route (Kap, 8/4: "I want it to be the voice of what's
  // selected in the operator controls, regardless if you're signed in or not").
  // Leaguemates who never opened Ask Toto were getting their phone's stock robot,
  // which defeats the point of a single league voice.
  //
  // What replaces the gate, in order of how much they actually matter:
  //  1. The response cache below — 14 phones announcing the same sale now cost ONE
  //     generation instead of 14. This is the change that makes open access affordable.
  //  2. TTS_DAILY_CHARS via the RL binding (which IS bound — verified 8/4), counted
  //     only on a cache MISS, so it bounds generation rather than playback.
  //  3. TTS_MAX_CHARS 300 per request.
  // The admin surface (/tts/voices) stays passphrase-gated — only the operator needs it.

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const text = String(body.text || "").trim().slice(0, TTS_MAX_CHARS);
  if (!text) return json({ error: "No text." }, 400, cors);

  const voice = String(body.voice || env.ELEVEN_VOICE || "");
  if (!voice) return json({ error: "No voice id configured." }, 500, cors);
  const model = String(body.model || env.ELEVEN_MODEL || TTS_DEFAULT_MODEL);

  // Voice settings, whitelisted and clamped. Passing the caller's object straight
  // through would let anyone hand ElevenLabs arbitrary JSON; these five are the only
  // knobs that exist, and out-of-range values degrade the audio rather than erroring,
  // which would be a confusing thing to debug live.
  //   stability        v3: 0.0 Creative / 0.5 Natural / 1.0 Robust (discrete)
  //                    v2: continuous 0–1
  //   similarity_boost 0–1   style 0–1   speed 0.7–1.2 (ignored by v3, which takes
  //                    pace direction from audio tags instead)
  const num = (v, lo, hi) => (typeof v === "number" && isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : undefined;
  let vs;
  if (body.voice_settings && typeof body.voice_settings === "object") {
    const b = body.voice_settings;
    vs = {};
    const st = num(b.stability, 0, 1);          if (st !== undefined) vs.stability = st;
    const sb = num(b.similarity_boost, 0, 1);   if (sb !== undefined) vs.similarity_boost = sb;
    const sy = num(b.style, 0, 1);              if (sy !== undefined) vs.style = sy;
    const sp = num(b.speed, 0.7, 1.2);          if (sp !== undefined) vs.speed = sp;
    if (typeof b.use_speaker_boost === "boolean") vs.use_speaker_boost = b.use_speaker_boost;
    if (!Object.keys(vs).length) vs = undefined;
  }
  // Stable stringify so {stability,style} and {style,stability} share a cache entry.
  const vsKey = vs ? JSON.stringify(Object.keys(vs).sort().map(k => [k, vs[k]])) : "";

  // ---- cache first ----
  // Draft night is the perfect shape for this: every listening device asks for the
  // identical sentence within a second or two of each other. The first one pays,
  // everyone else is served from the edge — faster AND free.
  const ck = await ttsCacheKey(voice, model, text, vsKey);
  const cache = caches.default;
  const hit = await cache.match(ck);
  if (hit) {
    return new Response(hit.body, {
      headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Dawg-TTS": "hit" },
    });
  }

  // Daily character cap. A render loop or a bored stranger should cost pennies, not
  // the plan. Counted on misses only — a replayed line has already been paid for.
  if (env.RL) {
    const day = new Date().toISOString().slice(0, 10);
    const key = "tts:" + day;
    const cap = parseInt(env.TTS_DAILY_CHARS || "60000", 10);
    const used = parseInt((await env.RL.get(key)) || "0", 10);
    if (used + text.length > cap) {
      return json({ error: `Voice hit its daily character cap (${cap}). Falling back to the browser voice.` }, 429, cors);
    }
    await env.RL.put(key, String(used + text.length), { expirationTtl: 172800 });
  }

  let up;
  try {
    up = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": env.ELEVEN_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(vs ? { text, model_id: model, voice_settings: vs }
                                : { text, model_id: model }),
    });
  } catch (e) {
    return json({ error: "Couldn't reach ElevenLabs: " + e.message }, 502, cors);
  }

  if (!up.ok) {
    // Pass the upstream detail through — "voice not found" and "quota exceeded"
    // need different fixes and a generic 502 hides which one you have.
    const detail = (await up.text()).slice(0, 300);
    return json({ error: "ElevenLabs " + up.status, detail }, 502, cors);
  }

  // Read the whole clip so it can be both stored and served. These are ~50-120KB —
  // streaming would save nothing worth the complexity of teeing the body.
  const audio = await up.arrayBuffer();

  // ⚠️ The CACHED copy needs a real max-age; caches.default refuses to store a
  // no-store response, and a silent refusal here would quietly restore the old
  // one-generation-per-device cost. The copy sent to the browser keeps no-store,
  // because that one is per-request and CORS-bearing.
  await cache.put(ck, new Response(audio, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=604800" },
  }));

  return new Response(audio, {
    headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Dawg-TTS": "miss" },
  });
}

// GET /tts/voices — powers the voice picker on the dashboard.
//
// Why a proxy instead of a hardcoded list in the page: voice ids are not secret, but
// they ARE churn. Kap has already swapped the auctioneer voice three times (clone →
// unhingedman → Pepperoni_football_announcer). A list in the page means a site deploy
// every time he clones something in ElevenLabs; a list from the account means he
// clones it and it shows up in the dropdown on the next page load.
//
// ⚠️ /v2/voices, not /v1. v1 is the old flat list; v2 is the current endpoint and
// returns {voices:[...], has_more, total_count, next_page_token}. Verified against
// the docs 8/4/26 rather than guessed — the /tts/models route shipped broken because
// its response shape was assumed (it mapped `Array.isArray(raw)` against an object).
async function ttsVoices(request, env, cors) {
  if (!env.ELEVEN_KEY) return json({ error: "Worker misconfigured: ELEVEN_KEY not set." }, 500, cors);
  const pass = request.headers.get("X-Dawg-Pass") || "";
  if (!timingSafeEqual(pass, env.DAWG_PASS || "")) return json({ error: "Wrong league passphrase." }, 401, cors);
  try {
    const r = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100&voice_type=personal", {
      headers: { "xi-api-key": env.ELEVEN_KEY },
    });
    const raw = await r.json();
    if (!r.ok) return json({ error: "ElevenLabs " + r.status, detail: JSON.stringify(raw).slice(0, 300) }, 502, cors);
    const list = Array.isArray(raw && raw.voices) ? raw.voices : [];
    // ⚠️ Kap's voices ONLY. ElevenLabs returns ~21 stock voices (Bella, Roger, Sarah…)
    // alongside the three he cloned, and he asked for them gone — an auctioneer list
    // where "Laura - Quirky Attitude" outnumbers Pepperoni 7:1 is not a control, it's
    // a haystack. `voice_type=personal` asks the API to do it; the category filter is
    // the belt to that suspenders, because the param is silently ignored on some
    // account tiers and one stray premade voice puts the whole list back.
    const voices = list.map(v => ({ id: v.voice_id, name: v.name, category: v.category }))
                       .filter(v => v.id && v.name && v.category !== "premade");
    // `current` lets the page show which one is the house default without a second call
    return json({ voices, current: env.ELEVEN_VOICE || "" }, 200, cors);
  } catch (e) {
    return json({ error: "voices lookup failed: " + e.message }, 502, cors);
  }
}

// GET /tts/models — model ids change and guessing one wastes a deploy cycle
// (see the xAI notes in data-dawgs-dawg-bot.md). Ask, don't assume.
async function ttsModels(request, env, cors) {
  if (!env.ELEVEN_KEY) return json({ error: "Worker misconfigured: ELEVEN_KEY not set." }, 500, cors);
  const pass = request.headers.get("X-Dawg-Pass") || "";
  if (!timingSafeEqual(pass, env.DAWG_PASS || "")) return json({ error: "Wrong league passphrase." }, 401, cors);
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/models", { headers: { "xi-api-key": env.ELEVEN_KEY } });
    const raw = await r.json();
    const models = (Array.isArray(raw) ? raw : []).map(m => ({
      id: m.model_id, name: m.name,
      tts: m.can_do_text_to_speech === true,
      cost: m.model_rates && m.model_rates.character_cost_multiplier,
    }));
    return json({ models }, 200, cors);
  } catch (e) {
    return json({ error: "models lookup failed: " + e.message }, 502, cors);
  }
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

// PATCH updates only the children named. Keys may carry slashes for a deep write
// ("2026-w1-Kap/won"), and a null value deletes that child. Both properties matter
// for the ledger: stages patch only the fields they own, and bozoNext can clear the
// week without replacing the node.
async function fbPatch(env, path, value) {
  const r = await fetch(fbUrl(env, path), {
    method: "PATCH",
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error("RTDB patch " + r.status);
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

/* =============================== Nightly backup =========================== */
// The RTDB is the only copy of every Bozo pick, account and draft room. Code
// can be rebuilt; a season of results cannot. So once a day the cron trigger
// snapshots the ENTIRE database (auth=FB_SECRET reads "/", which includes the
// Worker-only /users and /bozoauth) into KV beside the rate-limit counters,
// prefixed so nothing can collide:
//   backup:<YYYY-MM-DD>  — dated snapshot, expires after 180 days
//   backup:latest        — same payload, never expires
//   backup:lasterror     — written only when a run fails, for post-mortems
// ⚠️ The snapshot contains password hashes and session material. NOTHING may
// serve these keys: no route, no MCP tool, and never the public repo.
// Retrieval is the Cloudflare dashboard or API, already behind Kap's account.
// The backup READS Firebase and writes only to KV — it must stay that way.
const backupKV = (env) => env.DD_KV || env.RL || null;

async function runBackup(env, nowMs) {
  const kv = backupKV(env);
  if (!kv) throw new Error("no KV binding for backup");
  // "/" not "": fbUrl appends ".json" directly, so "" glues ".json" onto the
  // HOSTNAME and DNS-fails as a 530. Caught live 8/7 on the first cron fire.
  const { data } = await fbGet(env, "/");                 // whole DB, one read
  const taken = new Date(nowMs).toISOString();
  const body = JSON.stringify({ taken, db: data });
  await kv.put("backup:" + taken.slice(0, 10), body, { expirationTtl: 15552000 });
  await kv.put("backup:latest", body);
  return { day: taken.slice(0, 10), bytes: body.length };
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
// ⚠️ fromCharCode(0), NOT a backslash-u escape: the NUL separator must stay, but the
// escape spelling of it corrupted twice in clipboard transcription (collapsing to a
// real NUL, which truncates the Windows clipboard). Identical runtime string; every
// existing hash still verifies. Do not "simplify" back to the escape.
async function pbkdf2(password, pepper, saltB64, iters) {
  const key = await crypto.subtle.importKey(
    "raw", te.encode(password + String.fromCharCode(0) + pepper), "PBKDF2", false, ["deriveBits"]);
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

// `p` pins the session to the password that created it. Change your password or
// get reset by the admin and every older session stops authenticating — without
// it, a reset would leave a stolen session working forever, which defeats the
// point of having a reset.
async function makeSession(env, name, setAt) {
  const payload = b64urlStr(JSON.stringify({
    n: name, e: Date.now() + SESSION_DAYS * 864e5, p: setAt || 0,
  }));
  return payload + "." + (await hmac(env.BOZO_PEPPER, payload));
}

async function readSession(env, tok) {
  if (typeof tok !== "string" || tok.indexOf(".") < 1) return null;
  const [payload, sig] = tok.split(".");
  if (!timingSafeEqual(sig || "", await hmac(env.BOZO_PEPPER, payload))) return null;
  let o;
  try { o = JSON.parse(unb64urlStr(payload)); } catch { return null; }
  if (!o || !o.n || !o.e || Date.now() > o.e) return null;
  return o;
}

// ⚠️ BOZO_TOKENS is deliberately NOT required any more. Once /users is seeded it is
// the roster of record, and the secret can be deleted or left stale forever — which is
// the whole point of moving off a value nobody can read back.
function bozoConfig(env) {
  if (!env.FB_SECRET || !env.BOZO_PEPPER)
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
  // Either header is accepted: X-Dawg-Session is the site-wide name, X-Bozo-Session
  // the one bozo.html has always sent. A cached page must keep working.
  const tok = request.headers.get("X-Dawg-Session") || request.headers.get("X-Bozo-Session") || "";
  const sess = await readSession(env, tok);
  if (!sess) return { err: "Sign in first.", code: 401 };

  let players;
  try { players = userNames(await loadUsers(env)); }
  catch (e) { return { err: e.message, code: 502 }; }
  // Membership is checked against /users, so removing someone from the roster kills
  // their session on the next request rather than leaving it valid until expiry.
  if (!players.includes(sess.n)) return { err: "Unknown player.", code: 403 };

  // The session must still match the password on file (see makeSession).
  let rec;
  try { rec = (await fbGet(env, authPath(sess.n))).data; }
  catch (e) { return { err: "Database unreachable: " + e.message, code: 502 }; }
  if (!rec) return { err: "Your password was reset — use your join link again.", code: 401 };
  if ((rec.setAt || 0) !== (sess.p || 0))
    return { err: "Your password changed — sign in again.", code: 401 };

  return { name: sess.n, players };
}

/* ============================ the /users roster =========================== */
// The roster used to live ONLY inside the BOZO_TOKENS secret. Cloudflare secrets are
// write-only — Kap lost the token map on 8/5 and had no way to read it back, so eight
// people could not be invited without minting a whole new set. That is the bug this
// node fixes.
//
// /users/<name> = { invite: <hash|null>, invitedTs, apps: {bozo:true,…} }
// ⚠️ No RTDB rule covers /users, so it default-DENIES every browser. Only the Worker
// (which authenticates with FB_SECRET) can read or write it. Nothing here is exposed
// by /bozo being world-readable, and no rules change is needed.
//
// ⚠️ The stored `invite` is an HMAC of the token, never the token. A database dump
// therefore hands nobody a working join link. The cost is that a lost link cannot be
// recovered — only re-minted, which is what POST /auth/invite is for. That is the
// right trade: re-issuing is a button, and the raw secret exists in exactly one place
// (Kap's text message) instead of two.

const inviteHash = (env, token) => hmac(env.BOZO_PEPPER, "invite|" + token);

/* ----------------------- per-user MCP credentials ------------------------ */
// One personal connector URL per member: https://<worker>/mcp/u_<token>
//
// ⚠️ WHY A SEPARATE TOKEN AND NOT THE SESSION. Claude's custom-connector UI accepts a
// URL and nothing else — no header field — so a credential must ride in the path. A
// makeSession token would work for exactly 60 days and then silently stop, which is a
// support problem nobody diagnoses. An MCP token ends only when it is rotated.
//
// ⚠️ DOMAIN-SEPARATED from invite tokens: same pepper, different prefix, so a stolen
// join link can never be replayed as an MCP credential or the reverse.
const mcpTokenHash = (env, token) => hmac(env.BOZO_PEPPER, "mcp|" + token);

function newMcpToken() {
  const raw = crypto.getRandomValues(new Uint8Array(24));
  let s = ""; for (const b of raw) s += String.fromCharCode(b);
  return "u_" + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Resolve an email to a player name. Email is an ALTERNATE IDENTIFIER ONLY — nothing is
// ever sent to it and nothing is verified, because verifying would need a mail sender
// (Resend + DKIM/SPF at Porkbun), and a public repo with an open mail endpoint is a spam
// relay that gets the domain blacklisted. Saying "verified" without that work is a lie.
async function emailToName(env, email) {
  const want = String(email || "").trim().toLowerCase();
  if (!want || want.indexOf("@") < 1) return null;
  let users;
  try { users = await loadUsers(env); } catch { return null; }
  for (const [k, u] of Object.entries(users))
    if (u && typeof u.email === "string" && u.email.trim().toLowerCase() === want) return playerName(k);
  return null;
}

// POST /auth/mcp-token {action:"mint"|"revoke"} — session required, acts only on SELF.
async function authMcpToken(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 401, cors);

  let body;
  try { body = await readBody(request); } catch { return json({ error: "Bad JSON." }, 400, cors); }
  const action = String((body && body.action) || "mint");
  const key = encodeURIComponent(auth.name);

  if (action === "revoke") {
    try { await fbPatch(env, "/users/" + key, { mcpToken: null, mcpTokenTs: null }); }
    catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
    return json({ ok: true, player: auth.name, revoked: true }, 200, cors);
  }
  if (action !== "mint") return json({ error: "action must be mint or revoke" }, 400, cors);

  const token = newMcpToken();
  try {
    await fbPatch(env, "/users/" + key, { mcpToken: await mcpTokenHash(env, token), mcpTokenTs: Date.now() });
  } catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }

  // ⚠️ Shown ONCE. Only the hash is stored — the same discipline invite tokens already
  // get — so it cannot be redisplayed. Losing it means rotating, which is the right
  // trade for a credential that will eventually authorise writes.
  const origin = new URL(request.url).origin;
  return json({
    ok: true, player: auth.name, token, url: origin + "/mcp/" + token,
    note: "Save this now. Only a hash is stored, so it can never be shown again — rotate if you lose it.",
  }, 200, cors);
}

// POST /auth/email {email} — session required, sets the alternate login identifier.
async function authEmail(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 401, cors);
  let body;
  try { body = await readBody(request); } catch { return json({ error: "Bad JSON." }, 400, cors); }
  const email = String((body && body.email) || "").trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ error: "That does not look like an email address." }, 400, cors);
  const taken = email ? await emailToName(env, email) : null;
  if (taken && taken !== auth.name) return json({ error: "Another player already uses that address." }, 409, cors);
  try { await fbPatch(env, "/users/" + encodeURIComponent(auth.name), { email: email || null }); }
  catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  return json({ ok: true, player: auth.name, email: email || null,
                note: "Unverified — nothing is sent to this address. It only lets you sign in with it." }, 200, cors);
}

// BOZO_TOKENS is the bootstrap, not the truth. First read seeds /users from it and
// from then on /users wins — so the secret can be left alone forever after setup.
async function loadUsers(env) {
  let users = null;
  try { users = (await fbGet(env, "/users")).data; }
  catch (e) { throw new Error("Database unreachable: " + e.message); }
  if (users && Object.keys(users).length) return users;

  const map = tokenMap(env);
  if (!map) return {};
  const seed = {};
  for (const [tok, name] of Object.entries(map)) {
    seed[encodeURIComponent(name)] = {
      invite: await inviteHash(env, tok),
      invitedTs: Date.now(),
      apps: { bozo: true },
      src: "seed",
    };
  }
  try { await fbPatch(env, "/users", seed); } catch (e) { /* next read retries */ }
  return seed;
}

const userNames = users => Object.keys(users).map(playerName);

// POST /auth/invite {player} — admin mints a FRESH join token for one player and
// returns it ONCE. Replaces "edit an encrypted secret you cannot read".
// ⚠️ Minting does not clear an existing password. Re-inviting someone who has already
// claimed is a no-op for them until an admin /auth/reset clears their hash — otherwise
// anyone who saw an old text could re-claim a live account.
async function authInvite(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const lid = leagueOf(body);
  if (!lid) return json({ error: "Bad league id." }, 400, cors);
  // A league manager invites into their own league; the site admin into any.
  const auth = await requireManager(request, env, lid);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  const player = String(body.player || "").trim();
  if (!player) return json({ error: "Which player?" }, 400, cors);
  if (player.length > 40) return json({ error: "That name is too long." }, 400, cors);
  // Firebase keys are the encoded name; these characters break the path even encoded.
  if (/[.#$\[\]\/]/.test(player)) return json({ error: "Name can't contain . # $ [ ] or /" }, 400, cors);

  let users;
  try { users = await loadUsers(env); }
  catch (e) { return json({ error: e.message }, 502, cors); }

  // Inviting someone brand new CREATES the account. That is how a second league full
  // of different people gets off the ground without editing a secret.
  const isNew = !userNames(users).includes(player);

  const raw = new Uint8Array(16);
  crypto.getRandomValues(raw);
  const token = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  try {
    await fbPatch(env, "/users/" + encodeURIComponent(player), {
      invite: await inviteHash(env, token), invitedTs: Date.now(),
      // ⚠️ Provenance decides precedence. Once an admin has minted for someone, the
      // bootstrap secret stops being authoritative for them — otherwise a stale token
      // sitting in BOZO_TOKENS would out-rank the link you just deliberately issued.
      src: "mint",
      // Consumed by /auth/claim: claiming this link also joins that league, so one
      // click gets a new person both an account and a seat.
      pendingLeague: lid,
    });
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
  const claimed = !!(await fbGet(env, authPath(player))).data;
  // Someone who already has a password won't go through claim, so seat them now.
  if (claimed) {
    try { await fbPatch(env, LG(lid) + "/members", { [encodeURIComponent(player)]: true }); }
    catch (e) { /* the manager can still add them by hand */ }
  }
  return json({ ok: true, player, token, claimed, isNew, league: lid }, 200, cors);
}

// GET /auth/roster — who exists and who has set a password. No secrets: it is
// exactly what the login screen needs to decide "claim" vs "sign in".
async function bozoRoster(env, cors) {
  const cfg = bozoConfig(env);
  if (cfg) return json({ error: cfg }, 500, cors);
  let users, auth = {};
  try {
    users = await loadUsers(env);
    auth = (await fbGet(env, "/bozoauth")).data || {};
  } catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }

  // ⚠️ Rotation has to actually revoke. /users holds hashes, so once seeded it would
  // happily keep honouring a token you rotated the secret to kill. This reconciles the
  // two on every roster read (i.e. every page load): for anyone who has NOT claimed,
  // the bootstrap secret is authoritative — its token is re-armed and the previous one
  // dies. Claimed accounts are never touched; their password is the credential now.
  // This is the only place both /users and /bozoauth are already in hand, so it costs
  // no extra read.
  const map = tokenMap(env) || {};
  const fix = {};
  for (const [tok, name] of Object.entries(map)) {
    if (auth[name]) continue;                       // claimed — hands off
    const key = encodeURIComponent(name);
    if (users[key] && users[key].src === "mint") continue;   // admin-issued link wins
    const h = await inviteHash(env, tok);
    if (!users[key] || users[key].invite !== h)
      fix[key + "/invite"] = h, fix[key + "/invitedTs"] = Date.now();
  }
  if (Object.keys(fix).length) {
    try { await fbPatch(env, "/users", fix); } catch (e) { /* next read retries */ }
  }

  const players = userNames(users).map(n => ({ name: n, claimed: !!auth[n] }));
  if (!players.length) return json({ error: "No roster configured." }, 500, cors);
  return json({ players }, 200, cors);
}

async function bozoClaim(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const cfg = bozoConfig(env);
  if (cfg) return json({ error: cfg }, 500, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const token = String(body.token || "");
  if (!token) return json({ error: "That claim link isn't valid." }, 403, cors);

  // The token is matched by HASH — /users never holds the raw value. Hash once, then
  // timing-safe compare against every row so a wrong token leaks no timing signal
  // about which player it nearly matched.
  let users, name = null;
  try { users = await loadUsers(env); }
  catch (e) { return json({ error: e.message }, 502, cors); }
  const h = await inviteHash(env, token);
  for (const [key, u] of Object.entries(users))
    if (u && u.invite && timingSafeEqual(h, u.invite)) name = playerName(key);

  // ⚠️ BREAK-GLASS. /users seeds itself from BOZO_TOKENS on first read — which happens
  // on any page load — so if the secret is updated AFTER that first read, the new
  // tokens would be ignored forever and nobody could claim. Since claiming is the only
  // route to admin, and admin is the only route to minting invites, that deadlocks the
  // whole roster with no way out.
  //
  // So: a token straight out of the bootstrap secret is ALWAYS honoured for a player
  // who has not claimed yet, and heals the stored hash on the way through. The secret
  // can re-arm unclaimed slots at any time; it can never touch a claimed account
  // (bozoClaim 409s below on an existing password, same as any other path).
  if (!name) {
    const map = tokenMap(env) || {};
    for (const [t, n] of Object.entries(map)) if (timingSafeEqual(token, t)) name = n;
    // An admin-minted link supersedes the secret for that player — don't let a stale
    // bootstrap token walk in behind it.
    if (name && (users[encodeURIComponent(name)] || {}).src === "mint") name = null;
    if (name) {
      try { await fbPatch(env, "/users/" + encodeURIComponent(name), { invite: h, invitedTs: Date.now() }); }
      catch (e) { /* the claim below still stands; the heal retries next time */ }
    }
  }
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
    const setAt = Date.now();
    await fbPut(env, authPath(name), { v: 1, salt, hash, iters: PBKDF2_ITERS, setAt });

    // The invite was minted FOR a league — claiming it takes the seat. One click gets
    // a new person an account and membership; without this they would land signed in
    // to a league they are not in and be told so.
    const pending = (users[encodeURIComponent(name)] || {}).pendingLeague;
    let joined = null;
    if (pending && validLeagueId(pending)) {
      try {
        await fbPatch(env, LG(pending) + "/members", { [encodeURIComponent(name)]: true });
        await fbPatch(env, "/users/" + encodeURIComponent(name), { pendingLeague: null });
        joined = pending;
      } catch (e) { /* the manager can add them by hand */ }
    }
    return json({ ok: true, name, joined, session: await makeSession(env, name, setAt) }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}

async function bozoLogin(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const cfg = bozoConfig(env);
  if (cfg) return json({ error: cfg }, 500, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  // An email is accepted anywhere a name is. It resolves to the name BEFORE anything
  // else happens, so the rate-limit bucket, the auth record and the session are all
  // keyed the same way whichever identifier was typed.
  let name = String(body.name || body.email || "").trim();
  if (name.indexOf("@") > 0) name = (await emailToName(env, name)) || name;
  const pw = String(body.password || "");
  let players;
  try { players = userNames(await loadUsers(env)); }
  catch (e) { return json({ error: e.message }, 502, cors); }
  if (!players.includes(name)) return json({ error: "Unknown player." }, 403, cors);

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
    // `email` rides along so connect.html can prefill the field without a second call.
    const urec = (await loadUsers(env))[encodeURIComponent(name)] || {};
    return json({ ok: true, name, email: urec.email || null,
                  session: await makeSession(env, name, rec.setAt || 0) }, 200, cors);
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
    const setAt = Date.now();
    await fbPut(env, authPath(auth.name), { v: 1, salt, hash, iters: PBKDF2_ITERS, setAt });
    return json({ ok: true, session: await makeSession(env, auth.name, setAt) }, 200, cors);
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

// POST /bozo/config — league-manager dials. v1: the price band. Lives at
// /bozo/config (world-readable like the rest of /bozo — the page reads it straight
// from Firebase to mirror the check client-side; the Worker is the enforcer).
// PATCHed, and deliberately NOT in bozoNext's null list, so it survives rollovers.
async function bozoConfigSet(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const lid = leagueOf(body);
  if (!lid) return json({ error: "Bad league id." }, 400, cors);
  // Each league sets its own band — this is a league manager's dial, not a site one.
  const auth = await requireManager(request, env, lid);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  const ceil = Math.round(Number(body.bandCeil));
  const floor = Math.round(Number(body.bandFloor));
  // Favorites only: the ceiling can never rise above −100. Floor below the ceiling,
  // and bounded so a typo (−50000) can't turn the band meaningless.
  if (!Number.isFinite(ceil) || !Number.isFinite(floor))
    return json({ error: "Band values must be numbers." }, 400, cors);
  if (ceil > -100) return json({ error: "Ceiling can't be shorter than −100 — favorites only." }, 400, cors);
  if (floor >= ceil) return json({ error: "Floor must be deeper (more negative) than the ceiling." }, 400, cors);
  if (floor < -2000) return json({ error: "Floor below −2000? That's not a band, that's a typo." }, 400, cors);

  try {
    await fbPatch(env, LG(lid) + "/config", { bandCeil: ceil, bandFloor: floor, updatedTs: Date.now(), updatedBy: auth.name });
    return json({ ok: true, league: lid, bandCeil: ceil, bandFloor: floor }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}

/* ================================ Leagues ================================= */
// Bozo is multi-tenant: several groups, each with its own roster size, band, week,
// picks and ledger. A league of 8 and a league of 4 run side by side.
//
// Leagues live at /bozo/leagues/<id> — deliberately UNDER /bozo so they inherit its
// {".read":true,".write":false} rule. Reads stream straight to the page for free;
// every write still goes through this Worker. No rules change was needed.
//
// ⚠️ Identity stays GLOBAL. One account per person at /users + /bozoauth, and
// membership is per league. The same human in two leagues is one login, not two.
//
// ⚠️ THE LOCK THRESHOLD IS THE LEAGUE'S MEMBER COUNT, never the global roster. That
// is the whole point of per-league size: an 8-person league locks on the 8th leg, a
// 4-person league on the 4th.

const DEFAULT_LEAGUE = "main";
const LG = lid => "/bozo/leagues/" + lid;

// Firebase keys cannot contain . $ # [ ] / — and these ids show up in URLs, so keep
// them boring on purpose.
function validLeagueId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9-]{1,23}$/.test(id);
}

const memberNames = lg => Object.keys((lg && lg.members) || {}).map(playerName);
const isMember = (lg, name) =>
  !!((lg && lg.members) || {})[encodeURIComponent(name)] || !!((lg && lg.members) || {})[name];

// Everything that existed before leagues belongs to DEFAULT_LEAGUE. It is created on
// first touch with the whole current /users roster, so the setup that ran yesterday
// keeps running today without a migration step anyone has to remember.
async function loadLeagues(env) {
  let leagues = null;
  try { leagues = (await fbGet(env, "/bozo/leagues")).data; }
  catch (e) { throw new Error("Database unreachable: " + e.message); }
  if (leagues && Object.keys(leagues).length) return leagues;

  const users = await loadUsers(env);
  const members = {};
  for (const key of Object.keys(users)) members[key] = true;
  const seed = {
    name: "Data Dawgs", manager: env.BOZO_ADMIN || "", members,
    season: SEASON, week: 1, status: "open", createdTs: Date.now(), createdBy: "seed",
  };
  try { await fbPatch(env, LG(DEFAULT_LEAGUE), seed); } catch (e) { /* next read retries */ }
  return { [DEFAULT_LEAGUE]: seed };
}

async function loadLeague(env, lid) {
  const leagues = await loadLeagues(env);
  return leagues[lid] || null;
}

// The league id a request is talking about. Absent = the default, so every pre-league
// caller (including a cached copy of the page) keeps working untouched.
const leagueOf = body => {
  const id = (body && body.league) || DEFAULT_LEAGUE;
  return validLeagueId(id) ? id : null;
};

// A league manager runs their own league and nobody else's. The site admin can act in
// any league — they created them.
async function requireManager(request, env, lid) {
  const auth = await sessionAuth(request, env);
  if (auth.err) return auth;
  let lg;
  try { lg = await loadLeague(env, lid); }
  catch (e) { return { err: e.message, code: 502 }; }
  if (!lg) return { err: "No such league.", code: 404 };
  const siteAdmin = env.BOZO_ADMIN && auth.name === env.BOZO_ADMIN;
  if (!siteAdmin && lg.manager !== auth.name)
    return { err: "That's not your league to manage.", code: 403 };
  return { ...auth, league: lg, lid, siteAdmin };
}

// GET /league/list — public. The board is public, so the league directory is too.
// Deliberately thin: no picks, no ledger, just enough to draw a switcher.
async function leagueList(env, cors) {
  let leagues;
  try { leagues = await loadLeagues(env); }
  catch (e) { return json({ error: e.message }, 502, cors); }
  const out = Object.entries(leagues).map(([id, lg]) => ({
    id, name: lg.name || id, manager: lg.manager || null,
    size: memberNames(lg).length,
    members: memberNames(lg),
    teams: lg.teams || null,
    settings: settingsOf(lg),
    week: lg.week || 1, status: lg.status || "open",
  })).sort((a, b) => a.id === DEFAULT_LEAGUE ? -1 : b.id === DEFAULT_LEAGUE ? 1 : a.name.localeCompare(b.name));
  return json({ leagues: out, defaultLeague: DEFAULT_LEAGUE }, 200, cors);
}

// POST /league/create {id, name, manager} — SITE ADMIN only. Kap makes leagues and
// names who runs each one; managers cannot mint more leagues on his Firebase.
async function leagueCreate(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = await requireAdmin(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const id = String(body.id || "").toLowerCase().trim();
  if (!validLeagueId(id))
    return json({ error: "League id must be 2–24 chars: lowercase letters, numbers and dashes." }, 400, cors);

  let leagues;
  try { leagues = await loadLeagues(env); }
  catch (e) { return json({ error: e.message }, 502, cors); }
  if (leagues[id]) return json({ error: "A league with that id already exists." }, 409, cors);

  // The manager must be a real account, or nobody can administer the league.
  const manager = String(body.manager || auth.name);
  const users = await loadUsers(env);
  if (!userNames(users).includes(manager))
    return json({ error: manager + " doesn't have an account yet — invite them first." }, 400, cors);

  const lg = {
    name: String(body.name || id).slice(0, 60),
    manager,
    // The manager starts as the only member; size grows from here. A league of 4 is
    // just a league whose manager stopped adding people at 4.
    members: { [encodeURIComponent(manager)]: true },
    season: SEASON, week: 1, status: "open",
    createdTs: Date.now(), createdBy: auth.name,
  };
  try { await fbPatch(env, LG(id), lg); }
  catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  return json({ ok: true, id, league: lg }, 200, cors);
}


// League settings, one patch route. Everything here is a MANAGER'S PREFERENCE — the
// site admin can edit any league, a manager only their own (requireManager handles both).
//
// ⚠️ One of these is not like the others. `levers` decides which of the four tiebreakers
// go into the weekly draw, and the randomisation is what keeps the game unsolvable: the
// brief rejected a composite score because "any weighted blend of the four is just a new
// deterministic objective with a new optimum someone will solve". Cut to one lever and
// you have rebuilt exactly that — under pure shortest-odds-loses, undercutting to the
// floor is strictly dominant and the whole league converges there. It is allowed, it is
// warned about in the UI, and it is the only setting here with a game-theory cost.
const LEVER_COUNT = 4;
const SETTING_DEFAULTS = {
  stake: 50, allowDupes: false, allowEdit: true, lockRule: "all", lockCount: 0,
};
const settingsOf = lg => ({
  stake: Number.isFinite(lg?.stake) ? lg.stake : SETTING_DEFAULTS.stake,
  allowDupes: lg?.allowDupes === true,
  allowEdit: lg?.allowEdit !== false,
  lockRule: lg?.lockRule === "count" ? "count" : "all",
  lockCount: Number.isFinite(lg?.lockCount) ? lg.lockCount : 0,
  levers: Array.isArray(lg?.levers) && lg.levers.length ? lg.levers : [0, 1, 2, 3],
});

async function leagueSettings(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const lid = leagueOf(body);
  if (!lid) return json({ error: "Bad league id." }, 400, cors);
  const auth = await requireManager(request, env, lid);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  const lg = auth.league;
  const patch = {};
  const has = k => Object.prototype.hasOwnProperty.call(body, k);

  if (has("name")) {
    const n = String(body.name).trim();
    if (!n || n.length > 60) return json({ error: "Name must be 1–60 characters." }, 400, cors);
    patch.name = n;
  }

  if (has("manager")) {
    const m = String(body.manager);
    let users;
    try { users = await loadUsers(env); }
    catch (e) { return json({ error: e.message }, 502, cors); }
    if (!userNames(users).includes(m))
      return json({ error: m + " doesn't have an account yet." }, 400, cors);
    patch.manager = m;
    // A manager who isn't in their own league can't submit a leg and can't be counted
    // toward the lock. Seat them rather than leaving that inconsistency lying around.
    if (!isMember(lg, m)) patch["members/" + encodeURIComponent(m)] = true;
  }

  if (has("stake")) {
    const v = Math.round(Number(body.stake));
    if (!Number.isFinite(v) || v < 1 || v > 100000)
      return json({ error: "Stake must be between 1 and 100000." }, 400, cors);
    patch.stake = v;
  }

  if (has("allowDupes")) patch.allowDupes = body.allowDupes === true;
  if (has("allowEdit"))  patch.allowEdit  = body.allowEdit !== false;

  if (has("lockRule")) {
    const r = body.lockRule === "count" ? "count" : "all";
    patch.lockRule = r;
    if (r === "count") {
      const c = Math.round(Number(body.lockCount));
      if (!Number.isFinite(c) || c < 2 || c > 64)
        return json({ error: "Lock count must be between 2 and 64." }, 400, cors);
      patch.lockCount = c;
    } else {
      patch.lockCount = null;
    }
  }

  if (has("levers")) {
    const raw = Array.isArray(body.levers) ? body.levers : [];
    const set = [...new Set(raw.map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n < LEVER_COUNT);
    if (!set.length) return json({ error: "At least one tiebreaker has to stay in the draw." }, 400, cors);
    patch.levers = set.sort();
  }

  // The band lives here too, so one Save covers the whole rules panel.
  if (has("bandCeil") || has("bandFloor")) {
    const cur = bandOf(lg);
    const ceil = has("bandCeil") ? Math.round(Number(body.bandCeil)) : cur.ceil;
    const floor = has("bandFloor") ? Math.round(Number(body.bandFloor)) : cur.floor;
    if (!Number.isFinite(ceil) || !Number.isFinite(floor))
      return json({ error: "Band values must be numbers." }, 400, cors);
    if (ceil > -100) return json({ error: "Ceiling can't be shorter than −100 — favorites only." }, 400, cors);
    if (floor >= ceil) return json({ error: "Floor must be deeper (more negative) than the ceiling." }, 400, cors);
    if (floor < -2000) return json({ error: "Floor below −2000? That's not a band, that's a typo." }, 400, cors);
    patch["config/bandCeil"] = ceil;
    patch["config/bandFloor"] = floor;
    patch["config/updatedTs"] = Date.now();
    patch["config/updatedBy"] = auth.name;
  }

  if (!Object.keys(patch).length) return json({ error: "Nothing to change." }, 400, cors);
  patch.settingsTs = Date.now();
  patch.settingsBy = auth.name;

  try { await fbPatch(env, LG(lid), patch); }
  catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  const after = await loadLeague(env, lid);
  return json({ ok: true, league: lid, settings: settingsOf(after), name: after.name, manager: after.manager }, 200, cors);
}

// POST /league/team {league, player, team} — the display name inside THIS league.
// ⚠️ Deliberately not a rename. The account name stays the identity key everywhere —
// /users, the password record, pick keys, ledger rows — so changing what the board
// calls someone costs nothing and can never orphan a receipt. The same person can be
// one thing here and another in a different league.
async function leagueTeam(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const lid = leagueOf(body);
  if (!lid) return json({ error: "Bad league id." }, 400, cors);
  const auth = await requireManager(request, env, lid);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  const player = String(body.player || "");
  if (!isMember(auth.league, player)) return json({ error: player + " isn't in this league." }, 400, cors);
  const team = String(body.team == null ? "" : body.team).trim().slice(0, 40);

  try {
    await fbPatch(env, LG(lid) + "/teams", { [encodeURIComponent(player)]: team || null });
  } catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  return json({ ok: true, player, team: team || null }, 200, cors);
}

// POST /league/member {league, player, action:"add"|"remove"} — the size dial.
// Adding requires an existing account; use /league/invite for someone brand new.
async function leagueMember(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const lid = leagueOf(body);
  if (!lid) return json({ error: "Bad league id." }, 400, cors);
  const auth = await requireManager(request, env, lid);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  const player = String(body.player || "");
  const remove = body.action === "remove";
  const users = await loadUsers(env);
  if (!remove && !userNames(users).includes(player))
    return json({ error: player + " doesn't have an account yet — send them a join link instead." }, 400, cors);

  // ⚠️ Changing the roster mid-week moves the lock threshold under a live board.
  // Removing the last person you were waiting on would otherwise silently place the
  // ticket; refuse while picks are in and the board is open, and say why.
  const lg = auth.league;
  if ((lg.status || "open") !== "open")
    return json({ error: "The ticket is placed — roster changes wait for next week." }, 409, cors);
  if (remove && (lg.picks || {})[encodeURIComponent(player)])
    return json({ error: player + " already has a leg in this week. Remove the leg first." }, 409, cors);
  if (remove && lg.manager === player)
    return json({ error: "The manager can't leave their own league." }, 400, cors);

  try {
    await fbPatch(env, LG(lid) + "/members", { [encodeURIComponent(player)]: remove ? null : true });
  } catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }

  // Re-read so the caller sees the real size, and so a removal that just completed the
  // board can lock immediately rather than waiting for someone to resubmit.
  const after = await loadLeague(env, lid);
  const picks = after.picks || {};
  let placed = false;
  if (!remove ? false : Object.keys(picks).length >= memberNames(after).length && memberNames(after).length > 0)
    placed = await placeAndDraw(env, lid, picks, after);
  return json({ ok: true, size: memberNames(after).length, members: memberNames(after), placed }, 200, cors);
}

// POST /league/lock {league} — the escape hatch. The board otherwise waits forever for
// a member who never submits, which with eight friends is a matter of when, not if.
// Legs that are in make the ticket; anyone who didn't submit simply isn't on it.
async function leagueLock(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const lid = leagueOf(body);
  if (!lid) return json({ error: "Bad league id." }, 400, cors);
  const auth = await requireManager(request, env, lid);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  const lg = auth.league;
  if ((lg.status || "open") !== "open") return json({ error: "Already placed." }, 409, cors);
  const picks = lg.picks || {};
  const n = Object.keys(picks).length;
  if (n < 2) return json({ error: "Need at least two legs to make a parlay." }, 400, cors);
  // (A forced lock deliberately ignores lockRule — that is the entire point of it.)

  const placed = await placeAndDraw(env, lid, picks, lg);
  return json({ ok: true, placed, legs: n, waitingOn: memberNames(lg).filter(p => !picks[encodeURIComponent(p)]) }, 200, cors);
}

/* =============================== /bozo/pick =============================== */
// One leg per person. Favorites only, band from /bozo/config. No exact duplicates.
// Editing is allowed while the board is open — the Worker stamps a fresh server
// timestamp, which is what "editing resets your clock and your price" means.
// When the last leg lands, the board locks and the permutation is drawn.

async function bozoPick(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code, cors);
  const { name } = auth;

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const lid = leagueOf(body);
  if (!lid) return json({ error: "Bad league id." }, 400, cors);

  let state;
  try { state = await loadLeague(env, lid); }
  catch (e) { return json({ error: e.message }, 502, cors); }
  if (!state) return json({ error: "No such league." }, 404, cors);

  // Having an account is not the same as being in THIS league.
  if (!isMember(state, name))
    return json({ error: "You're not in this league." }, 403, cors);

  if ((state.status || "open") !== "open") {
    return json({ error: "The ticket is placed. Board is locked." }, 409, cors);
  }

  try {
    if (body.action === "remove") {
      await fbDelete(env, LG(lid) + "/picks/" + encodeURIComponent(name));
      return json({ ok: true, removed: true }, 200, cors);
    }

    const set = settingsOf(state);

    // "Editing is allowed until the ticket is placed" is the default, not a law. A
    // league can lock a leg the moment it lands — which removes the edit-resets-your-
    // clock dynamic entirely, so it is a real change to how the game plays.
    if (!set.allowEdit && (state.picks || {})[encodeURIComponent(name)])
      return json({ error: "This league locks your leg once it's in — no edits." }, 409, cors);

    const p = body.pick || {};
    const err = validatePick(p, name, state.picks || {}, bandOf(state), set.allowDupes);
    if (err) return json({ error: err }, 400, cors);

    const pick = {
      sport: p.sport, eventId: String(p.eventId), game: String(p.game).slice(0, 80),
      mkt: p.mkt, side: String(p.side).slice(0, 40),
      line: p.mkt === "ml" ? 0 : Number(p.line),
      // market-agnostic: a side of over/under sets the direction, anything else
      // (a team abbreviation on a spread or ML) resolves to "over", which is the
      // branch expected() has always wanted for those.
      dir: (p.side === "over" || p.side === "under") ? p.side : "over",
      price: Math.round(Number(p.price)),
      label: String(p.label).slice(0, 90),
      prop: p.prop ? String(p.prop).slice(0, 80) : null,
      // ⚠️ Where the PRICE came from, not where the pick came from. "self" means a
      // human typed it and nothing checked it; "market" is reserved for the day a
      // licensed odds source writes it server-side. Recorded now, before any such
      // source exists, so that legs entered under the honour system stay honestly
      // labelled forever instead of becoming indistinguishable from verified ones.
      // The client cannot assert "market" — only this file may ever set that.
      priceSource: "self",
      ts: Date.now(),                 // SERVER time — the reason this route exists
    };
    await fbPut(env, LG(lid) + "/picks/" + encodeURIComponent(name), pick);

    const picks = (await fbGet(env, LG(lid) + "/picks")).data || {};
    // ⚠️ THIS league's threshold, never the global roster. Default is "everyone in",
    // where the size IS the member count — an 8-person league locks on the 8th leg and
    // a 4-person league on the 4th. A league can instead lock at a fixed count, which
    // turns Last In into a race with a real risk of not making the ticket at all.
    const size = memberNames(state).length;
    const need = set.lockRule === "count" ? Math.min(set.lockCount || size, size || set.lockCount) : size;
    let placed = false;
    if (need > 0 && Object.keys(picks).length >= need) {
      placed = await placeAndDraw(env, lid, picks, state);
    }
    return json({ ok: true, ts: pick.ts, placed, size, need }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}

function validatePick(p, name, existing, band, allowDupes) {
  if (!LEAGUE[p.sport]) return "Unknown sport.";
  if (!MARKETS.includes(p.mkt)) return "Unknown market.";
  if (!p.eventId || !p.game) return "Pick a game.";
  if (!p.label || !p.side) return "Incomplete pick.";
  if (p.mkt === "other" && !String(p.prop || "").trim())
    return "Describe the bet — an \"other\" leg needs to say what it actually is.";
  const price = Number(p.price);
  if (!isFinite(price) || price > band.ceil || price < band.floor)
    return `${p.price} is outside the ${band.ceil} to ${band.floor} band.`;
  if (p.mkt !== "ml" && !isFinite(Number(p.line))) return "Number is required for that market.";
  if (!allowDupes) {
    const label = String(p.label).toLowerCase();
    for (const [who, x] of Object.entries(existing)) {
      if (who !== playerName(name) && who !== encodeURIComponent(name) && x &&
          String(x.label).toLowerCase() === label)
        return `${playerName(who)} already has that exact leg.`;
    }
  }
  return null;
}

// Server-side Fisher–Yates over the four levers, crypto-seeded, written once.
// The ETag guard means two simultaneous final submissions can't both draw.
async function placeAndDraw(env, lid, picks, state) {
  const cur = await fbGet(env, LG(lid) + "/order", true);
  if (cur.data != null) return true;                 // already drawn — never redraw

  // Only the levers this league kept in the draw. With all four this is the original
  // behaviour; with fewer the hierarchy is shorter and the meta gets easier to solve.
  const order = settingsOf(state).levers.slice();
  const rnd = new Uint32Array(Math.max(order.length, 1));
  crypto.getRandomValues(rnd);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }

  const wrote = await fbPut(env, LG(lid) + "/order", order, cur.etag);
  if (!wrote) return true;                           // lost the race — other draw stands

  const closeTs = Math.max(...Object.values(picks).map(x => x.ts || 0));
  await fbPut(env, LG(lid) + "/status", "placed");
  await fbPut(env, LG(lid) + "/closeTs", closeTs);

  // ⚠️ The ledger is written HERE, at lock — not at grade, and not in bozoNext. A week
  // that locks but never gets graded must still leave a complete record of the entry.
  await ledgerWriteEntries(env, lid, (state && state.season) || SEASON, (state && state.week) || 1, picks, order);
  return true;
}

/* =============================== Bozo ledger ============================== */
// A flat, one-row-per-leg record of the season, keyed <season>-w<week>-<player>.
// ~8 players × ~18 weeks ≈ 150 rows ≈ 45 KB by season's end.
//
// Lives at /bozo/ledger — deliberately INSIDE /bozo, which is already
// {".read":true,".write":false}, so it needs no Firebase rules change. A sibling node
// would have no rule at all and default to deny.
//
// Keyed object, never an array: each stage PATCHes only the fields it owns, retries are
// idempotent, and no stage has to read-modify-write 150 rows to change 8.
//
// Four write stages:
//   LOCK       entry, drawn hierarchy, submission timing   → placeAndDraw
//   KICKOFF    close, closeTs, closeSource                 → cron (not built)
//   PLACEMENT  placedPrice, mainLine                       → slip parse (not built)
//   GRADE      actual, result, won, bozo                   → bozoGrade
//
// ⚠️ Raw inputs only. imp, clv, beat and altLine are pure functions of price, close,
// actual, line, mainLine and the sport SD. The SD table is flagged as needing
// calibration, so persisting derivatives would freeze today's formulas into last
// year's rows. Derive them in the page and in the CSV export.
//
// ⚠️ mainLine (the market's main number, e.g. −6.5 when someone bought down to −9.5) is
// reserved and stays null until the odds-API spike lands. A stored altLine BOOLEAN was
// rejected: the band forces almost every spread and total to be an alt line,
// and moneylines can't be one, so the flag would be constant wherever it's derivable.
// The distance from the main number is the part that actually varies between players.

const SEASON = 2026;

const ledgerKey = (season, week, playerKey) => `${season}-w${week}-${playerKey}`;

// ⚠️ /bozo/picks and /bozoauth are keyed with encodeURIComponent(name), so "The Kid"
// is stored as "The%20Kid" and nothing on the page decodes it. The ledger KEY keeps
// that encoding — it stays URL-safe for a targeted row read and for deep-path PATCH
// keys — but the player COLUMN is decoded, because that column is what lands in the CSV.
const playerName = k => { try { return decodeURIComponent(k); } catch { return k; } };

// Entry-stage rows. Everything here is known the instant the board locks.
function ledgerEntries(lid, season, week, picks, order) {
  const names = Object.keys(picks);
  const byTs = names.slice().sort((a, b) => (picks[a].ts || 0) - (picks[b].ts || 0));
  const closeTs = Math.max(...names.map(n => picks[n].ts || 0));

  // Shortest odds = the biggest favorite = the MOST negative price. This has to match
  // decide(), which takes max(imp(price)): −300 is chalkier than −110.
  // ⚠️ An earlier spec snippet sorted the other way and called −100 "chalkiest".
  let chalk = null;
  for (const n of names) if (chalk === null || picks[n].price < picks[chalk].price) chalk = n;

  const rows = {};
  for (const n of names) {
    const x = picks[n];
    rows[ledgerKey(season, week, n)] = {
      league: lid,                              // so a CSV across leagues stays sortable
      season, week, player: playerName(n),
      sport: x.sport, eventId: x.eventId, game: x.game,
      mkt: x.mkt, side: x.side, dir: x.dir,
      priceSource: x.priceSource || "self",     // see the note in bozoPick
      line: x.line == null ? null : x.line,     // numeric, and separate from the label,
      label: x.label,                           // or the Bozo Index can't be computed
      prop: x.prop || null,
      price: x.price,
      mainLine: null,                           // reserved — see the note above
      ts: x.ts || null,                         // server time, the reason /bozo/pick exists
      rank: byTs.indexOf(n) + 1,                // 1 = first in, N = Last In
      secToClose: x.ts && closeTs ? Math.round((closeTs - x.ts) / 1000) : null,
      tiebreak: order || null,                  // the week's drawn lever hierarchy
      shortestOdds: n === chalk,
      slipKey: x.slipKey || null,
    };
  }
  return rows;
}

// ⚠️ Never throws into the caller. At lock the ticket is already placed and the
// permutation already drawn; failing the last submitter's request over a bookkeeping
// write would be worse than a missing row. bozoGrade backfills anything that didn't land.
async function ledgerWriteEntries(env, lid, season, week, picks, order) {
  try {
    await fbPatch(env, LG(lid) + "/ledger", ledgerEntries(lid, season, week, picks, order));
    return true;
  } catch (e) {
    console.log("ledger: entry write failed — " + e.message);
    return false;
  }
}

// Idempotent by construction: writes only rows that are absent, so it can never clobber
// a field a later stage already patched in.
async function ledgerBackfill(env, lid, state) {
  const picks = state.picks || {};
  if (!Object.keys(picks).length) return false;
  let have = {};
  try { have = (await fbGet(env, LG(lid) + "/ledger")).data || {}; }
  catch (e) { console.log("ledger: backfill read failed — " + e.message); return false; }

  const rows = ledgerEntries(lid, state.season || SEASON, state.week || 1, picks, state.order || null);
  const missing = {};
  for (const k of Object.keys(rows)) if (!have[k]) missing[k] = rows[k];
  if (!Object.keys(missing).length) return false;

  try { await fbPatch(env, LG(lid) + "/ledger", missing); return true; }
  catch (e) { console.log("ledger: backfill write failed — " + e.message); return false; }
}

// Grade-stage deep-path update. Keys carry slashes, so each field is written on its own
// and nothing written at lock is touched.
function ledgerGradeUpdate(season, week, results, bozo, picks) {
  // ⚠️ Results arrive keyed however the page keyed them, and the page keys off
  // Object.keys(picks) — which is URL-encoded. Map any decoded name back onto the
  // stored key, or the day someone fixes the "The%20Kid" display bug the grade stage
  // starts writing a SECOND, orphaned row per player instead of patching the real one.
  const keys = Object.keys(picks || {});
  const norm = k => keys.includes(k) ? k
    : keys.includes(encodeURIComponent(k)) ? encodeURIComponent(k)
    : (keys.find(x => playerName(x) === k) || k);
  const bozoKey = bozo === undefined || bozo === null ? bozo : norm(bozo);

  const upd = {};
  for (const [p0, r] of Object.entries(results || {})) {
    if (!r || typeof r !== "object") continue;
    const p = norm(p0);
    const k = ledgerKey(season, week, p);

    // result is the four-state truth; won is the boolean derived from it, and null on
    // push/void so a push can never silently count as a loss.
    const result = r.result || (r.won === true ? "won" : r.won === false ? "lost" : null);
    if (result) {
      upd[`${k}/result`] = result;
      upd[`${k}/won`] = result === "won" ? true : result === "lost" ? false : null;
    }
    if (r.actual !== undefined) upd[`${k}/actual`] = r.actual ?? null;
    if (r.close !== undefined) {
      upd[`${k}/close`] = r.close ?? null;
      // ⚠️ Record WHERE a close came from. Hand-entered and cron-captured closes must
      // never end up silently mixed in the same column.
      upd[`${k}/closeSource`] = r.close == null ? null : "manual";
    }
    if (bozoKey !== undefined) upd[`${k}/bozo`] = p === bozoKey;
  }
  return upd;
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

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const lid = leagueOf(body);
  if (!lid) return json({ error: "Bad league id." }, 400, cors);
  const auth = await requireManager(request, env, lid);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  try {
    const state = auth.league;
    const status = state.status;
    if (status !== "placed" && status !== "graded")
      return json({ error: "Nothing to grade — ticket isn't placed." }, 409, cors);

    if (body.results && typeof body.results === "object")
      await fbPut(env, LG(lid) + "/results", body.results);
    if (body.bozo !== undefined) await fbPut(env, LG(lid) + "/bozo", body.bozo);
    if (body.bozoWhy !== undefined) await fbPut(env, LG(lid) + "/bozoWhy", String(body.bozoWhy).slice(0, 200));

    // Ledger last, before the status flip: if it fails the manager gets a 502, status is
    // still "placed", and hitting Decide again replays the whole thing idempotently.
    const backfilled = await ledgerBackfill(env, lid, state);
    const upd = ledgerGradeUpdate(state.season || SEASON, state.week || 1, body.results, body.bozo, state.picks);
    if (Object.keys(upd).length) await fbPatch(env, LG(lid) + "/ledger", upd);

    if (body.graded) await fbPut(env, LG(lid) + "/status", "graded");
    return json({ ok: true, backfilled }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}

async function bozoNext(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const lid = leagueOf(body);
  if (!lid) return json({ error: "Bad league id." }, 400, cors);
  const auth = await requireManager(request, env, lid);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  try {
    const state = auth.league;
    const history = Array.isArray(state.history) ? state.history : [];
    history.push({ week: state.week || 1, bozo: state.bozo || null });

    // ⚠️ PATCH, not PUT. A wholesale PUT of the league node would delete its ledger,
    // members and config every single week — the site whose thesis is "the receipts
    // stay up" quietly shredding its receipts. The nulls clear this week's children
    // explicitly; anything not named here survives, so a node added later can't be
    // silently destroyed the same way.
    await fbPatch(env, LG(lid), {
      season: state.season || SEASON,
      week: (state.week || 1) + 1,
      status: "open",
      history,
      picks: null, order: null, results: null,
      bozo: null, bozoWhy: null, closeTs: null,
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

/* ===== DD-MCP-BLOCK START — generated from work/mcp-block.js; edit THERE ===== */
/* Shared DFS engine — generated verbatim from work/dfs-engine.js except for its private root. */
const mcpDdfsRoot = {};
/* ============================================================================
   DFS engine — exact lineup solver + correlated contest simulator.

   Pure computation. No DOM. Loaded three ways:
     1. node, for the benchmark + tests in the build dir
     2. inlined into dfs.html as a Blob-URL Web Worker (keeps the page self-contained)
     3. inlined into dfs.html on the main thread if Worker/Blob is unavailable

   ⚠️ Everything here consumes projections the USER supplies. The engine has no opinion
   about how good a player is and never invents a number. A missing projection is a
   missing player, not a zero.
   ========================================================================== */
(function (root) {
"use strict";

/* ---------------------------------------------------------------- constants */

const POS = ["QB", "RB", "WR", "TE", "DST"];

const SITES = {
  dk_classic: {
    key: "dk_classic", label: "DraftKings · Classic", cap: 50000, size: 9,
    // FLEX is resolved by enumerating the three legal position splits rather than
    // carrying a wildcard slot — a wildcard slot generates the same lineup up to
    // three times and de-duplicating after the fact costs more than not making them.
    patterns: [
      { QB: 1, RB: 3, WR: 3, TE: 1, DST: 1 },
      { QB: 1, RB: 2, WR: 4, TE: 1, DST: 1 },
      { QB: 1, RB: 2, WR: 3, TE: 2, DST: 1 }
    ],
    minGames: 2,          // DK requires two different games on a classic slate
    showdown: false
  },
  dk_showdown: {
    key: "dk_showdown", label: "DraftKings · Showdown Captain Mode", cap: 50000, size: 6,
    patterns: null, minTeams: 2, cptMult: 1.5, cptSalMult: 1.5, showdown: true
  }
};

const SAL_STEP = 100;     // DK salaries are multiples of 100 — the DP bound rides on this

/* ------------------------------------------------------------------ helpers */

// Mulberry32 — seeded, so a run is reproducible and so is any bug in it.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ============================================================================
   SOLVER

   Branch and bound over slots, one position group at a time, players inside a
   group visited in projection order with a strictly increasing index so a set is
   only ever generated once.

   ⚠️ The whole thing lives or dies on the bound. A first cut used "sum of the top
   k projections still available", which ignores salary — with a salary floor of
   $49,000 that bound never fires and a single main-slate solve did not finish in
   two minutes. The bound below is a real salary-aware DP relaxation:

     SUF[gi][k][b] = the most projection obtainable by taking k more players from
                     group gi PLUS the full requirement from every later group,
                     spending at most b.

   Built by knapsack per group then a (max,+) convolution backwards through the
   groups. It ignores the increasing-index rule and lets a group re-pick a player
   already taken, so it is a genuine upper bound — just a tight one.
   ========================================================================== */

/**
 * players: [{pos, team, opp, gid, sal, proj, lock, excl, maxExp}]  (array index = id)
 * cfg: { site, count, minSalary, maxSalary, uniques, randomness, seed,
 *        maxPerTeam, maxPerGame, timeLimitMs,
 *        stack:{qbMin, qbPos, bringBack, noRbVsDst, noOppDst},
 *        groups:[{mode:"atMost"|"atLeast"|"exactly", n, ids:[]}] }
 */
function solveLineups(players, cfg, onProgress) {
  const site = SITES[cfg.site] || SITES.dk_classic;
  return site.showdown ? solveShowdown(players, cfg, site, onProgress)
                       : solveClassic(players, cfg, site, onProgress);
}

function activePool(players, cfg, expCount, made) {
  // Excluded, or already at the exposure cap, means the player is simply absent from
  // this solve. That is exact — no penalty term, no soft nudge.
  const out = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p.excl) continue;
    if (!(p.proj > 0) && !p.lock) continue;
    if (!p.lock && p.maxExp != null && made > 0 && expCount[i] / made >= p.maxExp - 1e-9) continue;
    out.push(i);
  }
  return out;
}

/* ---- per-group DP tables, rebuilt whenever the pool or the projections move ---- */

/* Rows are stored windowed: {a, lo, hi}. `a` is indexed by absolute salary bucket but
   only [lo..hi] is meaningful — below lo the row is -Infinity (cannot be afforded),
   above hi it is flat at a[hi] (money left over buys nothing more). Windowing is not a
   micro-optimisation: full 0..500 convolutions made the DP rebuild, not the tree search,
   the dominant cost of a solve. A QB slot spans ~30 buckets, not 501. */
function rowGet(r, b) { return b < r.lo ? -Infinity : r.a[b > r.hi ? r.hi : b]; }

// exact-k knapsack over one group: best proj taking exactly k, salary <= b*100
function groupKnap(ids, players, proj, kMax, B) {
  const raw = [];
  for (let k = 0; k <= kMax; k++) raw.push(new Float64Array(B + 1).fill(k === 0 ? 0 : -Infinity));
  const sals = ids.map(id => (players[id].sal / SAL_STEP) | 0).sort((x, y) => x - y);
  for (const id of ids) {
    const s = (players[id].sal / SAL_STEP) | 0, v = proj[id];
    for (let k = kMax; k >= 1; k--) {
      const cur = raw[k], prev = raw[k - 1];
      for (let b = B; b >= s; b--) {
        const alt = prev[b - s] + v;
        if (alt > cur[b]) cur[b] = alt;
      }
    }
  }
  const K = [];
  for (let k = 0; k <= kMax; k++) {
    const r = raw[k];
    for (let b = 1; b <= B; b++) if (r[b - 1] > r[b]) r[b] = r[b - 1];
    let lo = 0, hi = 0;
    for (let j = 0; j < k; j++) lo += sals[j];
    for (let j = 0; j < k; j++) hi += sals[sals.length - 1 - j];
    if (lo > B) { K.push({ a: r, lo: B + 1, hi: B }); continue; }
    if (hi > B) hi = B;
    K.push({ a: r, lo, hi });
  }
  return K;
}

// windowed (max,+) convolution: out[b] = max_s A[s] + C[b-s]
function maxPlusConv(A, C, B) {
  const out = new Float64Array(B + 1).fill(-Infinity);
  const lo = A.lo + C.lo, hiRaw = A.hi + C.hi;
  const hi = hiRaw > B ? B : hiRaw;
  if (lo > B) return { a: out, lo: B + 1, hi: B };
  for (let s = A.lo; s <= A.hi; s++) {
    const a = A.a[s];
    if (a === -Infinity) continue;
    const bEnd = Math.min(B, s + C.hi);
    for (let b = s + C.lo; b <= bEnd; b++) {
      const alt = a + C.a[b - s];
      if (alt > out[b]) out[b] = alt;
    }
  }
  for (let b = lo + 1; b <= hi; b++) if (out[b - 1] > out[b]) out[b] = out[b - 1];
  return { a: out, lo, hi };
}

function solveClassic(players, cfg, site, onProgress) {
  const N = players.length;
  const count = Math.max(1, cfg.count | 0);
  const cap = Math.min(cfg.maxSalary || site.cap, site.cap);
  const floor = cfg.minSalary || 0;
  const uniques = Math.max(0, cfg.uniques | 0);
  const maxOverlap = site.size - uniques;
  const stack = cfg.stack || {};
  const rand = rng(cfg.seed || 1);
  const noise = cfg.randomness || 0;
  // ⚠️ Always have a deadline. An impossible constraint set (a salary window no roster can
  // hit, say) has no solution to prune toward, so the search enumerates the whole tree and
  // a caller that forgot a limit would simply hang.
  const deadline = Date.now() + (cfg.timeLimitMs || 120000);

  const expCount = new Int32Array(N);
  const acceptedSets = [];               // Uint8Array membership per accepted lineup
  const inLineups = [];                  // id -> [accepted lineup indexes]  (sparse)
  for (let i = 0; i < N; i++) inLineups.push([]);
  const out = [];
  let infeasible = null, timedOut = false;

  for (let n = 0; n < count; n++) {
    if (Date.now() > deadline) { timedOut = true; break; }
    // Projections are re-drawn per lineup when randomness is on. That is what turns a
    // pool into a portfolio instead of N near-copies of one opinion.
    const proj = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const base = players[i].proj || 0;
      proj[i] = noise > 0 ? Math.max(0, base * (1 + noise * gauss(rand))) : base;
    }
    const pool = activePool(players, cfg, expCount, n);
    const res = bestClassic(players, proj, pool, cfg, site, cap, floor,
                            acceptedSets, inLineups, maxOverlap, stack, deadline);
    if (res && !res.ids) { timedOut = true; break; }   // deadline hit mid-search
    if (!res) { infeasible = n === 0 ? "no lineup satisfies these constraints"
                                     : "ran out of lineups that meet the uniqueness rule"; break; }
    if (res.aborted) timedOut = true;

    const set = new Uint8Array(N);
    for (const id of res.ids) { set[id] = 1; expCount[id]++; inLineups[id].push(acceptedSets.length); }
    acceptedSets.push(set);
    // Report the TRUE projection of the lineup, never the perturbed one used to find it.
    let trueProj = 0; for (const id of res.ids) trueProj += players[id].proj || 0;
    out.push({ ids: res.ids.slice().sort((a, b) => POS.indexOf(players[a].pos) - POS.indexOf(players[b].pos)),
               proj: trueProj, drawnProj: res.proj, sal: res.sal });
    if (onProgress && (n % 5 === 0 || n === count - 1)) onProgress(n + 1, count);
  }
  return { lineups: out, infeasible, timedOut, exposure: expCount };
}

function bestClassic(players, proj, pool, cfg, site, cap, floor,
                     acceptedSets, inLineups, maxOverlap, stack, deadline) {
  const B = (cap / SAL_STEP) | 0;
  const byPos = {}; for (const p of POS) byPos[p] = [];
  const locks = [];
  for (const id of pool) {
    const p = players[id];
    if (byPos[p.pos]) byPos[p.pos].push(id);
    if (p.lock) locks.push(id);
  }
  for (const p of POS) byPos[p].sort((a, b) => proj[b] - proj[a]);

  let best = null, bestVal = -1;
  const nAcc = acceptedSets.length;
  const overlap = new Int32Array(nAcc);
  let nodes = 0;
  // ⚠️ A deadline has to LATCH. Returning from only the one frame that happened to notice
  // the clock leaves the rest of the tree to be explored normally, so the "time limit"
  // merely slowed the search instead of ending it — an impossible constraint set still ran
  // for minutes. `aborted` is checked at the top of every node, which is cheap; the clock
  // is read once every 1,024 nodes, which is not.
  let aborted = false;

  const qbPosArr = stack.qbPos && stack.qbPos.length ? stack.qbPos : ["WR", "TE"];
  const stacking = (stack.qbMin || 0) > 0 || (stack.bringBack || 0) > 0;

  for (const pat of site.patterns) {
    // Group order matters a lot. Default: small, heavily constrained groups first, so
    // the tree narrows at the top.
    // ⚠️ When a QB stack is required that order is exactly wrong. The DP bound knows
    // nothing about stacking, so it stays optimistic all the way down; the only thing
    // that can cut a stackless subtree is the stack constraint itself, and that cannot
    // fire until the groups the stack partners live in have been visited. Leaving WR
    // last took a 150-lineup stacked run from 2s to over 60s. Pass-catchers first.
    const order = stacking ? ["QB", "TE", "WR", "RB", "DST"]
                           : ["QB", "DST", "TE", "RB", "WR"];
    const need = order.map(g => pat[g]);
    const grp = order.map(g => byPos[g]);
    const G = order.length;
    if (grp.some((g, i) => g.length < need[i])) continue;

    // Locks have to fit this pattern or the pattern cannot produce a lineup at all.
    const lockNeed = order.map(() => 0);
    let ok = true;
    for (const id of locks) {
      const gi = order.indexOf(players[id].pos);
      if (gi < 0) { ok = false; break; }
      lockNeed[gi]++;
    }
    if (!ok || lockNeed.some((v, i) => v > need[i])) continue;

    /* ---- the DP bound ---- */
    const KN = grp.map((g, i) => groupKnap(g, players, proj, need[i], B));
    // SUF[gi][k] = best proj from k more of group gi plus all of gi+1..G-1, salary <= b
    const SUF = [];
    for (let gi = 0; gi <= G; gi++) SUF.push([]);
    SUF[G][0] = { a: new Float64Array(B + 1), lo: 0, hi: 0 };   // nothing left to buy
    for (let gi = G - 1; gi >= 0; gi--) {
      const tail = SUF[gi + 1][need[gi + 1] === undefined ? 0 : need[gi + 1]] || SUF[gi + 1][0];
      for (let k = 0; k <= need[gi]; k++) SUF[gi][k] = maxPlusConv(KN[gi][k], tail, B);
    }

    /* ---- O(1) salary/projection suffix tables inside each group ---- */
    // minSal[gi][from][k] / maxSal[gi][from][k] — cheapest / priciest k at or after `from`
    const MINS = [], MAXS = [], TOPP = [];
    for (let gi = 0; gi < G; gi++) {
      const list = grp[gi], L = list.length, k = need[gi];
      const mn = [], mx = [], tp = [];
      for (let f = 0; f <= L; f++) { mn.push(new Float64Array(k + 1)); mx.push(new Float64Array(k + 1)); }
      for (let j = 1; j <= k; j++) { mn[L][j] = Infinity; mx[L][j] = -Infinity; }
      for (let f = L - 1; f >= 0; f--) {
        const s = players[list[f]].sal;
        for (let j = 1; j <= k; j++) {
          mn[f][j] = Math.min(mn[f + 1][j], s + mn[f + 1][j - 1]);
          mx[f][j] = Math.max(mx[f + 1][j], s + mx[f + 1][j - 1]);
        }
      }
      // list is proj-descending, so the top k from `from` is just the next k entries
      const pre = new Float64Array(L + 1);
      for (let j = 0; j < L; j++) pre[j + 1] = pre[j] + proj[list[j]];
      for (let f = 0; f <= L; f++) {
        const row = new Float64Array(k + 1);
        for (let j = 0; j <= k; j++) row[j] = f + j <= L ? pre[f + j] - pre[f] : -Infinity;
        tp.push(row);
      }
      MINS.push(mn); MAXS.push(mx); TOPP.push(tp);
    }
    // whole-group minima for the groups still entirely ahead of us
    const sufMinAll = new Float64Array(G + 1), sufMaxAll = new Float64Array(G + 1);
    for (let gi = G - 1; gi >= 0; gi--) {
      sufMinAll[gi] = sufMinAll[gi + 1] + MINS[gi][0][need[gi]];
      sufMaxAll[gi] = sufMaxAll[gi + 1] + MAXS[gi][0][need[gi]];
    }
    // ⚠️ Stack feasibility has to count only the slots a stack partner could OCCUPY.
    // Counting every remaining slot (including DST and RB for a WR/TE stack) makes the
    // prune almost never fire, which is most of why the stacked run was slow.
    const sufStackSlots = new Int32Array(G + 1), sufBringSlots = new Int32Array(G + 1);
    for (let gi = G - 1; gi >= 0; gi--) {
      sufStackSlots[gi] = sufStackSlots[gi + 1] + (qbPosArr.indexOf(order[gi]) >= 0 ? need[gi] : 0);
      sufBringSlots[gi] = sufBringSlots[gi + 1] + (order[gi] === "RB" || order[gi] === "WR" || order[gi] === "TE" ? need[gi] : 0);
    }

    const picked = [];
    const teamCt = {}, gameCt = {};
    let qbTeam = null, qbOpp = null, stackHave = 0, bringHave = 0;
    const qbPos = stack.qbPos && stack.qbPos.length ? stack.qbPos : ["WR", "TE"];
    const qbMin = stack.qbMin || 0, bringMin = stack.bringBack || 0;
    let hasRb = 0, hasDstOpp = null;

    function rec(gi, si, from, curProj, curSal) {
      if (aborted) return;
      if ((++nodes & 1023) === 0 && Date.now() > deadline) { aborted = true; return; }
      if (gi === G) {
        if (curSal < floor) return;
        if (qbMin && stackHave < qbMin) return;
        if (bringMin && bringHave < bringMin) return;
        if (site.minGames) { let g = 0; for (const k in gameCt) if (gameCt[k] > 0) g++; if (g < site.minGames) return; }
        for (const id of locks) if (picked.indexOf(id) < 0) return;
        if (cfg.groups) for (const gr of cfg.groups) {
          let c = 0; for (const id of picked) if (gr.ids.indexOf(id) >= 0) c++;
          if (gr.mode === "atMost" && c > gr.n) return;
          if (gr.mode === "atLeast" && c < gr.n) return;
          if (gr.mode === "exactly" && c !== gr.n) return;
        }
        if (curProj > bestVal) { bestVal = curProj; best = { ids: picked.slice(), proj: curProj, sal: curSal }; }
        return;
      }

      const list = grp[gi], k = need[gi], left = k - si;

      // ---- bounds, cheapest first ----
      const minRem = MINS[gi][from][left] + sufMinAll[gi + 1];
      if (curSal + minRem > cap) return;
      const maxRem = MAXS[gi][from][left] + sufMaxAll[gi + 1];
      if (curSal + maxRem < floor) return;
      // salary-aware projection bound
      const budget = ((cap - curSal) / SAL_STEP) | 0;
      if (budget < 0) return;
      const ub = rowGet(SUF[gi][left], budget);
      if (ub === -Infinity || curProj + ub <= bestVal) return;
      // index-order bound: nothing after `from` can beat the next `left` entries
      if (curProj + TOPP[gi][from][left] + (gi + 1 < G ? rowGet(SUF[gi + 1][need[gi + 1]], budget) : 0) <= bestVal) return;

      const isStackGrp = qbPosArr.indexOf(order[gi]) >= 0;
      const isBringGrp = order[gi] === "RB" || order[gi] === "WR" || order[gi] === "TE";
      const stackAfter = (isStackGrp ? left - 1 : 0) + sufStackSlots[gi + 1];
      const bringAfter = (isBringGrp ? left - 1 : 0) + sufBringSlots[gi + 1];
      const last = list.length - left;
      for (let j = from; j <= last; j++) {
        const id = list[j], p = players[id], sal = p.sal;
        // cheapest completion once this player is in
        if (curSal + sal + MINS[gi][j + 1][left - 1] + sufMinAll[gi + 1] > cap) continue;

        const isDst = p.pos === "DST";
        const tc = (teamCt[p.team] || 0) + (isDst ? 0 : 1);
        if (cfg.maxPerTeam && tc > cfg.maxPerTeam) continue;
        const gc = (gameCt[p.gid] || 0) + 1;
        if (cfg.maxPerGame && gc > cfg.maxPerGame) continue;
        if (stack.noRbVsDst) {
          if (isDst && hasRb && picked.some(x => players[x].pos === "RB" && players[x].team === p.opp)) continue;
          if (p.pos === "RB" && hasDstOpp === p.team) continue;
        }
        if (stack.noOppDst) {
          if (!isDst && hasDstOpp === p.team) continue;
          if (isDst && picked.some(x => players[x].pos !== "DST" && players[x].team === p.opp)) continue;
        }

        // overlap prune — overlap is monotone, so a violation kills the whole subtree
        const inL = inLineups[id];
        let over = false, oi = 0;
        for (; oi < inL.length; oi++) if (++overlap[inL[oi]] > maxOverlap) { over = true; oi++; break; }
        if (over) { for (let z = 0; z < oi; z++) overlap[inL[z]]--; continue; }

        // stack bookkeeping
        let dQb = false, dStack = 0, dBring = 0;
        if (p.pos === "QB") { qbTeam = p.team; qbOpp = p.opp; dQb = true; }
        else if (qbTeam) {
          if (p.team === qbTeam && qbPos.indexOf(p.pos) >= 0) { stackHave++; dStack = 1; }
          if (p.team === qbOpp && !isDst) { bringHave++; dBring = 1; }
        }
        const infeasStack = qbTeam && ((qbMin && stackHave + stackAfter < qbMin) ||
                                       (bringMin && bringHave + bringAfter < bringMin));
        if (infeasStack) {
          if (dQb) { qbTeam = null; qbOpp = null; }
          stackHave -= dStack; bringHave -= dBring;
          for (let z = 0; z < inL.length; z++) overlap[inL[z]]--;
          continue;
        }

        picked.push(id);
        teamCt[p.team] = tc; gameCt[p.gid] = gc;
        if (p.pos === "RB") hasRb++;
        const prevDstOpp = hasDstOpp; if (isDst) hasDstOpp = p.opp;

        if (si + 1 < k) rec(gi, si + 1, j + 1, curProj + proj[id], curSal + sal);
        else rec(gi + 1, 0, 0, curProj + proj[id], curSal + sal);

        picked.pop();
        teamCt[p.team] = tc - (isDst ? 0 : 1); gameCt[p.gid] = gc - 1;
        if (p.pos === "RB") hasRb--;
        hasDstOpp = prevDstOpp;
        if (dQb) { qbTeam = null; qbOpp = null; }
        stackHave -= dStack; bringHave -= dBring;
        for (let z = 0; z < inL.length; z++) overlap[inL[z]]--;
      }
    }
    rec(0, 0, 0, 0, 0);
    if (aborted) break;
  }
  if (best) { best.nodes = nodes; best.aborted = aborted; }
  return best ? best : (aborted ? { aborted: true } : null);
}

function sufSlots(need, gi, G) { let s = 0; for (let x = gi + 1; x < G; x++) s += need[x]; return s; }

/* --------------------------------------------------------------- showdown */

function solveShowdown(players, cfg, site, onProgress) {
  const N = players.length;
  const count = Math.max(1, cfg.count | 0);
  const cap = Math.min(cfg.maxSalary || site.cap, site.cap);
  const floor = cfg.minSalary || 0;
  const maxOverlap = site.size - Math.max(0, cfg.uniques | 0);
  const rand = rng(cfg.seed || 1);
  const noise = cfg.randomness || 0;
  // ⚠️ Always have a deadline. An impossible constraint set (a salary window no roster can
  // hit, say) has no solution to prune toward, so the search enumerates the whole tree and
  // a caller that forgot a limit would simply hang.
  const deadline = Date.now() + (cfg.timeLimitMs || 120000);
  const expCount = new Int32Array(N);
  const acceptedSets = [];
  const inLineups = []; for (let i = 0; i < N; i++) inLineups.push([]);
  const out = [];
  let infeasible = null, timedOut = false;

  for (let n = 0; n < count; n++) {
    if (Date.now() > deadline) { timedOut = true; break; }
    const proj = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const base = players[i].proj || 0;
      proj[i] = noise > 0 ? Math.max(0, base * (1 + noise * gauss(rand))) : base;
    }
    const pool = activePool(players, cfg, expCount, n);
    const res = bestShowdown(players, proj, pool, cfg, site, cap, floor,
                             acceptedSets, inLineups, maxOverlap, deadline);
    if (res && !res.ids) { timedOut = true; break; }
    if (!res) { infeasible = n === 0 ? "no lineup satisfies these constraints"
                                     : "ran out of lineups that meet the uniqueness rule"; break; }
    if (res.aborted) timedOut = true;
    const set = new Uint8Array(N);
    for (const id of res.ids) { set[id] = 1; expCount[id]++; inLineups[id].push(acceptedSets.length); }
    acceptedSets.push(set);
    let trueProj = (players[res.cpt].proj || 0) * site.cptMult;
    for (const id of res.ids) if (id !== res.cpt) trueProj += players[id].proj || 0;
    out.push({ ids: res.ids, cpt: res.cpt, proj: trueProj, drawnProj: res.proj, sal: res.sal });
    if (onProgress && (n % 5 === 0 || n === count - 1)) onProgress(n + 1, count);
  }
  return { lineups: out, infeasible, timedOut, exposure: expCount };
}

function bestShowdown(players, proj, pool, cfg, site, cap, floor,
                      acceptedSets, inLineups, maxOverlap, deadline) {
  const flexN = site.size - 1;
  let best = null, bestVal = -1;
  const locks = pool.filter(i => players[i].lock);
  const nAcc = acceptedSets.length;
  const overlap = new Int32Array(nAcc);
  let nodes = 0, aborted = false;

  const cptList = pool.slice().sort((a, b) => proj[b] * site.cptMult - proj[a] * site.cptMult);
  for (const cpt of cptList) {
    if (aborted || Date.now() > deadline) break;
    const cptSal = Math.round(players[cpt].sal * site.cptSalMult);
    const cptProj = proj[cpt] * site.cptMult;
    if (cptSal > cap) continue;
    const list = pool.filter(i => i !== cpt).sort((a, b) => proj[b] - proj[a]);
    if (list.length < flexN) continue;

    // suffix tables for this captain's flex list
    const L = list.length;
    const mn = [], mx = [], pre = new Float64Array(L + 1);
    for (let f = 0; f <= L; f++) { mn.push(new Float64Array(flexN + 1)); mx.push(new Float64Array(flexN + 1)); }
    for (let j = 1; j <= flexN; j++) { mn[L][j] = Infinity; mx[L][j] = -Infinity; }
    for (let f = L - 1; f >= 0; f--) {
      const s = players[list[f]].sal;
      for (let j = 1; j <= flexN; j++) {
        mn[f][j] = Math.min(mn[f + 1][j], s + mn[f + 1][j - 1]);
        mx[f][j] = Math.max(mx[f + 1][j], s + mx[f + 1][j - 1]);
      }
    }
    for (let j = 0; j < L; j++) pre[j + 1] = pre[j] + proj[list[j]];

    const picked = [cpt];
    const teamCt = {}; teamCt[players[cpt].team] = 1;
    for (let a = 0; a < nAcc; a++) overlap[a] = 0;
    for (const a of inLineups[cpt]) overlap[a] = 1;
    let cptOver = false;
    for (const a of inLineups[cpt]) if (overlap[a] > maxOverlap) cptOver = true;
    if (cptOver) continue;

    (function rec(from, k, curProj, curSal) {
      if (aborted) return;
      if ((++nodes & 1023) === 0 && Date.now() > deadline) { aborted = true; return; }
      if (k === 0) {
        if (curSal < floor) return;
        let teams = 0; for (const t in teamCt) if (teamCt[t] > 0) teams++;
        if (site.minTeams && teams < site.minTeams) return;
        for (const id of locks) if (picked.indexOf(id) < 0) return;
        if (curProj > bestVal) { bestVal = curProj; best = { ids: picked.slice(), cpt, proj: curProj, sal: curSal }; }
        return;
      }
      if (curSal + mn[from][k] > cap) return;
      if (curSal + mx[from][k] < floor) return;
      if (curProj + (from + k <= L ? pre[from + k] - pre[from] : -Infinity) <= bestVal) return;
      for (let j = from; j <= L - k; j++) {
        const id = list[j], p = players[id];
        if (curSal + p.sal + mn[j + 1][k - 1] > cap) continue;
        if (cfg.maxPerTeam && (teamCt[p.team] || 0) + 1 > cfg.maxPerTeam) continue;
        const inL = inLineups[id];
        let over = false, oi = 0;
        for (; oi < inL.length; oi++) if (++overlap[inL[oi]] > maxOverlap) { over = true; oi++; break; }
        if (over) { for (let z = 0; z < oi; z++) overlap[inL[z]]--; continue; }
        picked.push(id); teamCt[p.team] = (teamCt[p.team] || 0) + 1;
        rec(j + 1, k - 1, curProj + proj[id], curSal + p.sal);
        picked.pop(); teamCt[p.team]--;
        for (let z = 0; z < inL.length; z++) overlap[inL[z]]--;
      }
    })(0, flexN, cptProj, cptSal);
  }
  if (best) { best.nodes = nodes; best.aborted = aborted; }
  return best ? best : (aborted ? { aborted: true } : null);
}

/* ------------------------------------------------------------------ export */

root.DDFS = { SITES, POS, solveLineups, rng, gauss };

/* ============================================================================
   CONTEST SIMULATOR

   Three layers, and the page names all three:

   1. CORRELATION — measured, not assumed. DDFS.CORR is the within-game correlation
      of DraftKings scoring by role, estimated from seven regular seasons of nflverse
      weekly stats (see the meta block for provenance and sample sizes). Weekly scores
      are z-scored inside player-season before correlating, so the numbers describe how
      outcomes MOVE TOGETHER inside a game rather than how much better one player is
      than another. Each game on the slate gets its own correlation matrix assembled
      from those cells and Cholesky-factored once.

   2. SHAPE — each player's score is a lognormal with the user's projection as its mean
      and a coefficient of variation read off the same data, by position and scoring
      level. DST is drawn normal instead, because a DK defence can finish negative and a
      lognormal cannot.

   3. FIELD — opponent lineups sampled to hit the ownership projections the user
      supplied, with a configurable share of them stacked. ⚠️ The field is a SAMPLE,
      typically 2,000-5,000 lineups, and the finishing rank is extrapolated to the real
      contest size. That is a real approximation and the page says so.

   ⚠️ What none of this can see: news after the projections were written, weather,
   snap-count surprises, or a field that is smarter than the ownership estimate.
   ========================================================================== */

const CORR = {"meta":{"source":"nflverse-data stats_player_week + stats_team_week + nfldata games.csv","seasons":[2019,2025],"regularSeasonOnly":true,"games":1871,"playerWeeks":35587,"minGamesPerPlayerSeason":6,"minPairObservations":400,"psdEigenvaluesClipped":0,"psdMaxCellDrift":0.0,"scoring":"DraftKings full-PPR incl. 100/300-yard bonuses; DST incl. points-allowed tiers"},"roles":["QB","RB1","RB2","RBx","WR1","WR2","WR3","WRx","TE1","TEx","DST"],"same":[[1.0,0.0642,0.0583,0.0201,0.3525,0.3134,0.2414,0.1697,0.2715,0.1671,-0.1101],[0.0642,1.0,-0.0077,-0.0418,-0.0263,-0.0214,-0.0295,-0.0096,-0.0013,0.0357,0.0609],[0.0583,-0.0077,1.0,0.0615,-0.0051,-0.057,-0.0084,-0.0173,-0.0191,0.0144,0.0192],[0.0201,-0.0418,0.0615,1.0,-0.041,0.039,-0.0047,-0.0005,0.0253,0.0106,-0.0002],[0.3525,-0.0263,-0.0051,-0.041,1.0,0.0057,-0.0152,-0.0085,0.0103,0.0178,-0.0666],[0.3134,-0.0214,-0.057,0.039,0.0057,1.0,-0.0123,0.0217,-0.0134,-0.0142,-0.0697],[0.2414,-0.0295,-0.0084,-0.0047,-0.0152,-0.0123,1.0,0.042,0.0193,0.0143,-0.0697],[0.1697,-0.0096,-0.0173,-0.0005,-0.0085,0.0217,0.042,1.0,0.0385,0.0398,-0.0277],[0.2715,-0.0013,-0.0191,0.0253,0.0103,-0.0134,0.0193,0.0385,1.0,0.0167,-0.0751],[0.1671,0.0357,0.0144,0.0106,0.0178,-0.0142,0.0143,0.0398,0.0167,1.0,-0.0483],[-0.1101,0.0609,0.0192,-0.0002,-0.0666,-0.0697,-0.0697,-0.0277,-0.0751,-0.0483,1.0]],"opp":[[0.1888,0.0394,0.0083,-0.0042,0.0894,0.0723,0.0752,0.0521,0.0723,0.053,-0.3114],[0.0394,-0.0847,-0.0165,-0.0108,0.0126,0.0034,0.0238,0.0132,0.0022,0.0207,-0.208],[0.0083,-0.0165,-0.0382,-0.0292,0.0245,0.011,0.0028,-0.0082,0.0147,-0.0224,-0.1308],[-0.0042,-0.0108,-0.0292,0.0634,0.03,-0.0413,-0.027,0.0218,-0.0075,0.01,-0.0296],[0.0894,0.0126,0.0245,0.03,0.076,0.0239,0.0407,0.0193,0.0539,0.0087,-0.1349],[0.0723,0.0034,0.011,-0.0413,0.0239,0.0463,0.0292,0.0395,0.0556,0.0551,-0.111],[0.0752,0.0238,0.0028,-0.027,0.0407,0.0292,-0.0002,0.0463,-0.0051,0.0151,-0.0751],[0.0521,0.0132,-0.0082,0.0218,0.0193,0.0395,0.0463,0.0268,-0.0148,0.0073,-0.0587],[0.0723,0.0022,0.0147,-0.0075,0.0539,0.0556,-0.0051,-0.0148,0.0479,-0.006,-0.0689],[0.053,0.0207,-0.0224,0.01,0.0087,0.0551,0.0151,0.0073,-0.006,0.0209,-0.0786],[-0.3114,-0.208,-0.1308,-0.0296,-0.1349,-0.111,-0.0751,-0.0587,-0.0689,-0.0786,-0.2075]],"cv":{"DST":[{"lo":0.0,"hi":6.0,"cv":1.0644,"n":148},{"lo":6.0,"hi":10.0,"cv":0.7407,"n":75}],"QB":[{"lo":10.0,"hi":14.0,"cv":0.6249,"n":62},{"lo":14.0,"hi":18.0,"cv":0.4637,"n":93},{"lo":18.0,"hi":24.0,"cv":0.3987,"n":88}],"RB":[{"lo":0.0,"hi":6.0,"cv":1.1329,"n":375},{"lo":6.0,"hi":10.0,"cv":0.7495,"n":165},{"lo":10.0,"hi":14.0,"cv":0.6153,"n":120},{"lo":14.0,"hi":18.0,"cv":0.5245,"n":87},{"lo":18.0,"hi":24.0,"cv":0.483,"n":39}],"TE":[{"lo":0.0,"hi":6.0,"cv":0.9846,"n":396},{"lo":6.0,"hi":10.0,"cv":0.7185,"n":141},{"lo":10.0,"hi":14.0,"cv":0.6303,"n":64}],"WR":[{"lo":0.0,"hi":6.0,"cv":1.1486,"n":527},{"lo":6.0,"hi":10.0,"cv":0.7723,"n":271},{"lo":10.0,"hi":14.0,"cv":0.6508,"n":195},{"lo":14.0,"hi":18.0,"cv":0.5796,"n":127},{"lo":18.0,"hi":24.0,"cv":0.5333,"n":48}]}};

const POS_OF_ROLE = { QB: "QB", RB1: "RB", RB2: "RB", RBx: "RB", WR1: "WR", WR2: "WR",
                      WR3: "WR", WRx: "WR", TE1: "TE", TEx: "TE", DST: "DST" };
// Two players sharing a depth role (a third RB, a fourth WR) are not the same player.
// The estimation forces a role's self-correlation to 1, so a small measured-neighbour
// value is used instead of 1 for duplicates. WR3-WRx measured 0.042; this is that,
// rounded down. It is an assumption, and it only ever touches bench-level players.
const SAME_ROLE_RHO = 0.03;

function assignRoles(players) {
  // Role is read off the user's own projections: the highest-projected WR on a team is
  // WR1. It is the only ordering available before kickoff, and it is the same ordering
  // the field will use.
  const byTeamPos = {};
  players.forEach((p, i) => {
    const k = p.team + "|" + p.pos;
    (byTeamPos[k] || (byTeamPos[k] = [])).push(i);
  });
  const role = new Array(players.length).fill(null);
  for (const k in byTeamPos) {
    const list = byTeamPos[k].sort((a, b) => (players[b].proj || 0) - (players[a].proj || 0));
    const pos = k.split("|")[1];
    list.forEach((id, n) => {
      if (pos === "QB") role[id] = "QB";
      else if (pos === "DST") role[id] = "DST";
      else if (pos === "RB") role[id] = n === 0 ? "RB1" : n === 1 ? "RB2" : "RBx";
      else if (pos === "WR") role[id] = n === 0 ? "WR1" : n === 1 ? "WR2" : n === 2 ? "WR3" : "WRx";
      else if (pos === "TE") role[id] = n === 0 ? "TE1" : "TEx";
    });
  }
  return role;
}

function corrBetween(roleA, roleB, sameTeam, sameSlot) {
  const i = CORR.roles.indexOf(roleA), j = CORR.roles.indexOf(roleB);
  if (i < 0 || j < 0) return 0;
  if (sameTeam) return sameSlot ? SAME_ROLE_RHO : CORR.same[i][j];
  return CORR.opp[i][j];
}

// Cholesky with a jitter retry. The assembled per-game matrix mixes cells estimated on
// different subsets, so it is not guaranteed positive definite even though the source
// matrix is; jitter is cheaper and clearer than an eigen decomposition in the browser.
function cholesky(M, n) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const jitter = attempt === 0 ? 0 : Math.pow(10, -9 + attempt);
    const L = new Float64Array(n * n);
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        let s = M[i * n + j] + (i === j ? jitter : 0);
        for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
        if (i === j) {
          if (s <= 0) { ok = false; break; }
          L[i * n + i] = Math.sqrt(s);
        } else {
          L[i * n + j] = s / L[j * n + j];
        }
      }
    }
    if (ok) return { L, jitter };
  }
  // Last resort: independence. Never silently — the caller surfaces this.
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) L[i * n + i] = 1;
  return { L, jitter: null, failed: true };
}

function cvFor(pos, mean) {
  const rows = CORR.cv[pos] || CORR.cv.WR;
  if (!rows || !rows.length) return 0.7;
  for (const r of rows) if (mean >= r.lo && mean < r.hi) return r.cv;
  // ⚠️ Outside the estimated range the nearest bin is reused rather than extrapolated.
  // Thin bins are exactly where an extrapolated CV would be least trustworthy.
  return mean < rows[0].lo ? rows[0].cv : rows[rows.length - 1].cv;
}

/**
 * players: [{pos, team, opp, gid, sal, proj, own}]   own is a PERCENT, 0-100
 * lineups: [{ids:[...], cpt?}]   the pool being evaluated
 * cfg: { sims, fieldSample, fieldSize, entries, entryFee, seed, fieldStackRate,
 *        payout: {kind:'param', paidFrac, alpha, rake} | {kind:'table', rows:[{from,to,prize}]},
 *        site }
 */
function simulate(players, lineups, cfg, onProgress) {
  const N = players.length;
  const site = SITES[cfg.site] || SITES.dk_classic;
  const sims = Math.max(200, cfg.sims | 0 || 10000);
  const fieldSize = Math.max(2, cfg.fieldSize | 0 || 10000);
  const ourN = lineups.length;
  const sampleN = Math.max(50, Math.min(cfg.fieldSample | 0 || 2000, Math.max(2, fieldSize - ourN)));
  const rand = rng(cfg.seed || 99);
  const roles = assignRoles(players);

  /* ---- per-game correlation ---- */
  const games = {};
  players.forEach((p, i) => (games[p.gid] || (games[p.gid] = [])).push(i));
  const gameKeys = Object.keys(games);
  const chol = {}, warn = [];
  for (const g of gameKeys) {
    const ids = games[g], n = ids.length;
    const M = new Float64Array(n * n);
    const seen = {};
    for (let a = 0; a < n; a++) {
      const ra = roles[ids[a]], ta = players[ids[a]].team;
      for (let b = 0; b < n; b++) {
        if (a === b) { M[a * n + b] = 1; continue; }
        const rb = roles[ids[b]], tb = players[ids[b]].team;
        M[a * n + b] = corrBetween(ra, rb, ta === tb, ta === tb && ra === rb);
      }
    }
    const c = cholesky(M, n);
    if (c.failed) warn.push("game " + g + ": correlation matrix would not factor, players drawn independently");
    chol[g] = { L: c.L, ids, n };
  }

  /* ---- score shape ---- */
  const mu = new Float64Array(N), sigma = new Float64Array(N), isNorm = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const p = players[i], m = Math.max(0, p.proj || 0);
    mu[i] = m;
    const cv = cvFor(p.pos, m);
    if (p.pos === "DST") { isNorm[i] = 1; sigma[i] = cv * Math.max(m, 3); }
    else sigma[i] = Math.sqrt(Math.log(1 + cv * cv));
  }

  /* ---- field ---- */
  const field = buildField(players, roles, cfg, site, sampleN, rand, onProgress);
  if (field.tooHard || field.length < 25) {
    warn.push("Could not build a believable field from these salaries and ownership — " +
              (field.length ? "only " + field.length + " valid opponent lineups were found." :
               "no valid opponent lineup could be assembled.") +
              " Check that ownership is set and that the salary cap is reachable.");
  }

  /* ---- payout curve ---- */
  const pay = payoutFn(cfg.payout || {}, fieldSize, cfg.entryFee || 1);

  /* ---- simulate ---- */
  const score = new Float64Array(N);
  const z = new Float64Array(N);
  const fieldScore = new Float64Array(field.length);
  const ourScore = new Float64Array(ourN);
  const BINS = 4096;
  const hist = new Int32Array(BINS + 1);

  const accPay = new Float64Array(ourN), accCash = new Int32Array(ourN),
        accWin = new Int32Array(ourN), accTop1 = new Int32Array(ourN),
        accScore = new Float64Array(ourN), accScore2 = new Float64Array(ourN),
        accRank = new Float64Array(ourN);
  const winLineup = new Int32Array(N);
  const cptMult = site.showdown ? site.cptMult : 1;

  for (let s = 0; s < sims; s++) {
    // correlated draws, one game at a time
    for (const g of gameKeys) {
      const { L, ids, n } = chol[g];
      for (let a = 0; a < n; a++) z[a] = gauss(rand);
      for (let a = 0; a < n; a++) {
        let v = 0, row = a * n;
        for (let b = 0; b <= a; b++) v += L[row + b] * z[b];
        const id = ids[a];
        score[id] = isNorm[id] ? mu[id] + sigma[id] * v
                               : mu[id] * Math.exp(sigma[id] * v - sigma[id] * sigma[id] / 2);
      }
    }

    let lo = Infinity, hi = -Infinity, fieldMax = -Infinity;
    for (let f = 0; f < field.length; f++) {
      const L9 = field[f]; let t = 0;
      for (let k = 0; k < L9.length; k++) t += score[L9[k]];
      if (L9.cpt !== undefined) t += score[L9.cpt] * (cptMult - 1);
      fieldScore[f] = t;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
      if (t > fieldMax) fieldMax = t;
    }
    for (let o = 0; o < ourN; o++) {
      const l = lineups[o]; let t = 0;
      for (let k = 0; k < l.ids.length; k++) t += score[l.ids[k]];
      if (l.cpt !== undefined) t += score[l.cpt] * (cptMult - 1);
      ourScore[o] = t;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }

    // histogram rank: counting how many field lineups beat us, without sorting the field
    const span = hi - lo || 1, inv = BINS / span;
    hist.fill(0);
    for (let f = 0; f < field.length; f++) {
      let b = ((fieldScore[f] - lo) * inv) | 0;
      if (b > BINS) b = BINS;
      hist[b]++;
    }
    for (let b = BINS - 1; b >= 0; b--) hist[b] += hist[b + 1];   // count at or above bin

    // best lineup on the slate this week, for win-lineup share
    let bestF = -Infinity, bestIdx = -1, bestIsOurs = false;
    for (let f = 0; f < field.length; f++) if (fieldScore[f] > bestF) { bestF = fieldScore[f]; bestIdx = f; bestIsOurs = false; }
    for (let o = 0; o < ourN; o++) if (ourScore[o] > bestF) { bestF = ourScore[o]; bestIdx = o; bestIsOurs = true; }
    const bestL = bestIsOurs ? lineups[bestIdx].ids : field[bestIdx];
    for (let k = 0; k < bestL.length; k++) winLineup[bestL[k]]++;

    const scale = (fieldSize - ourN) / field.length;
    for (let o = 0; o < ourN; o++) {
      const v = ourScore[o];
      let b = ((v - lo) * inv) | 0; if (b > BINS) b = BINS; if (b < 0) b = 0;
      // hist[b+1] counts field lineups in strictly higher bins — a conservative "above"
      const above = (b < BINS ? hist[b + 1] : 0) * scale;
      let ours = 0;
      for (let q = 0; q < ourN; q++) if (q !== o && ourScore[q] > v) ours++;
      const rank = 1 + above + ours;
      const prize = pay(rank);
      accPay[o] += prize;
      if (prize > 0) accCash[o]++;
      // ⚠️ Win rate is decided on the EXACT field maximum, not on the histogram. The
      // histogram counts "lineups in a strictly higher bin", so anything sharing our bin
      // reads as beaten — harmless 300 places deep, but at the very top that is the
      // difference between winning the tournament and not, and it biases win% upward.
      if (v > fieldMax && ours === 0) accWin[o]++;
      if (rank <= Math.max(1, fieldSize * 0.01)) accTop1[o]++;
      accScore[o] += v; accScore2[o] += v * v; accRank[o] += rank;
    }
    if (onProgress && (s % 250 === 0)) onProgress("sim", s, sims);
  }

  const fee = cfg.entryFee || 1;
  const perLineup = [];
  for (let o = 0; o < ourN; o++) {
    const m = accScore[o] / sims;
    perLineup.push({
      i: o,
      mean: m,
      sd: Math.sqrt(Math.max(0, accScore2[o] / sims - m * m)),
      ev: accPay[o] / sims,
      roi: (accPay[o] / sims - fee) / fee,
      cash: accCash[o] / sims,
      win: accWin[o] / sims,
      top1: accTop1[o] / sims,
      meanRank: accRank[o] / sims
    });
  }

  // per-player exposure vs how often they show up in the slate's best lineup
  const inOurs = new Int32Array(N);
  lineups.forEach(l => l.ids.forEach(i => inOurs[i]++));
  const perPlayer = [];
  for (let i = 0; i < N; i++) {
    if (!(players[i].proj > 0)) continue;
    const wl = winLineup[i] / sims;
    perPlayer.push({
      i,
      own: players[i].own || 0,
      winLineup: wl * 100,
      leverage: wl * 100 - (players[i].own || 0),
      ourExposure: ourN ? (inOurs[i] / ourN) * 100 : 0
    });
  }

  // duplication, measured off the sampled field and scaled
  const key = l => (l.cpt !== undefined ? l.cpt + "c|" : "") + l.slice().sort((a, b) => a - b).join(",");
  const fieldKeys = {};
  for (const f of field) { const k = key(f); fieldKeys[k] = (fieldKeys[k] || 0) + 1; }
  const scaleF = (fieldSize - ourN) / field.length;
  lineups.forEach((l, o) => {
    const k = key(l.ids);
    perLineup[o].dupes = (fieldKeys[k] || 0) * scaleF;
  });

  return {
    perLineup, perPlayer, warn,
    meta: {
      sims, fieldSize, fieldSample: field.length, entries: ourN,
      entryFee: fee, payout: cfg.payout,
      corr: CORR.meta,
      fieldOwnershipError: field.ownErr,
      fieldMedianProj: field.medProj,
      fieldP90Proj: field.p90Proj,
      fieldMedianSalary: field.medSal,
      ourMedianProj: (() => {
        const a = lineups.map(l => l.proj != null ? l.proj
          : l.ids.reduce((t, i) => t + (players[i].proj || 0), 0)).sort((x, y) => x - y);
        return a.length ? a[a.length >> 1] : null;
      })()
    }
  };
}

/* ---- field construction -------------------------------------------------- */

function buildField(players, roles, cfg, site, sampleN, rand, onProgress) {
  const N = players.length;
  const target = new Float64Array(N);
  for (let i = 0; i < N; i++) target[i] = Math.max(0, (players[i].own || 0)) / 100;
  const eligible = [];
  for (let i = 0; i < N; i++) if (players[i].proj > 0 && target[i] > 0) eligible.push(i);
  const byPos = { QB: [], RB: [], WR: [], TE: [], DST: [] };
  for (const i of eligible) if (byPos[players[i].pos]) byPos[players[i].pos].push(i);

  const w = new Float64Array(N);
  for (const i of eligible) w[i] = target[i];
  const stackRate = cfg.fieldStackRate == null ? 0.6 : cfg.fieldStackRate;
  const cap = site.cap;
  const floor = cfg.fieldMinSalary == null ? Math.round(cap * 0.98) : cfg.fieldMinSalary;

  let out = [];
  // ⚠️ Sampling by raw ownership does NOT reproduce the ownership you asked for — the
  // salary cap and the roster shape distort it. Three calibration passes reweight toward
  // the target and the residual error is reported, rather than quietly presenting the
  // first pass as if it hit.
  let ownErr = null;
  for (let pass = 0; pass < 3; pass++) {
    out = [];
    let guard = 0, tries = 0;
    // ⚠️ Bail out loudly rather than grinding. A slate where almost nothing fits under the
    // cap used to burn three passes of 120,000 attempts and hand back an empty field.
    while (out.length < sampleN && guard < sampleN * 12) {
      guard++; tries++;
      const l = site.showdown ? sampleShowdown(players, byPos, w, cap, rand, site, eligible, floor)
                              : sampleClassic(players, roles, byPos, w, cap, rand, stackRate, floor);
      if (l) out.push(l);
      if (tries === 500 && out.length < 25) break;
    }
    if (out.length < 25) { out.tooHard = true; break; }
    const got = new Float64Array(N);
    for (const l of out) for (const id of l) got[id]++;
    let err = 0, n = 0;
    for (const i of eligible) {
      const realized = got[i] / out.length;
      err += Math.abs(realized - target[i]); n++;
      if (pass < 2) {
        const ratio = realized > 1e-6 ? target[i] / realized : 3;
        w[i] = Math.max(1e-6, w[i] * Math.min(3, Math.max(0.33, ratio)));
      }
    }
    ownErr = n ? (err / n) * 100 : null;
    if (onProgress) onProgress("field", pass + 1, 3);
  }
  out.ownErr = ownErr;
  // how strong the modelled field turned out, so the page can show it rather than assume it
  if (out.length) {
    const pr = out.map(l => {
      let t = 0;
      for (const id of l) t += players[id].proj || 0;
      if (l.cpt !== undefined) t += (players[l.cpt].proj || 0) * 0.5;
      return t;
    }).sort((a, b) => a - b);
    const sa = out.map(l => l.sal || 0).sort((a, b) => a - b);
    out.medProj = pr[pr.length >> 1];
    out.p90Proj = pr[Math.floor(pr.length * 0.9)];
    out.medSal = sa[sa.length >> 1];
  }
  return out;
}

/* ⚠️ Budget-aware weighted pick. A plain ownership-weighted draw with a salary-cap
   rejection at the end does not work: on a real-priced slate the overwhelming majority
   of randomly assembled lineups are over the cap, so the sampler returned an EMPTY
   field and every downstream metric quietly became NaN. Candidates are filtered to what
   is still affordable once the cheapest completion of the remaining slots is reserved. */
function pick(list, w, rand, used, maxSal, players, minSal) {
  const fits = id => !used[id] && (maxSal == null || players[id].sal <= maxSal)
                              && (minSal == null || players[id].sal >= minSal);
  let tot = 0;
  for (const id of list) if (fits(id)) tot += w[id];
  if (tot <= 0) {
    // the salary floor is a preference, the cap is a rule — drop the floor before failing
    if (minSal != null) return pick(list, w, rand, used, maxSal, players, null);
    return -1;
  }
  let r = rand() * tot;
  for (const id of list) { if (!fits(id)) continue; r -= w[id]; if (r <= 0) return id; }
  for (let k = list.length - 1; k >= 0; k--) if (fits(list[k])) return list[k];
  return -1;
}

// priciest k players in `list` that are not already used
function costliestK(list, k, used, players) {
  if (k <= 0) return 0;
  const best = [];
  for (const id of list) {
    if (used[id]) continue;
    const s = players[id].sal;
    if (best.length < k) { best.push(s); best.sort((a, b) => b - a); }
    else if (s > best[k - 1]) { best[k - 1] = s; best.sort((a, b) => b - a); }
  }
  return best.length < k ? 0 : best.reduce((a, b) => a + b, 0);
}

// cheapest k players in `list` that are not already used
function cheapestK(list, k, used, players) {
  if (k <= 0) return 0;
  const best = [];
  for (const id of list) {
    if (used[id]) continue;
    const s = players[id].sal;
    if (best.length < k) { best.push(s); best.sort((a, b) => a - b); }
    else if (s < best[k - 1]) { best[k - 1] = s; best.sort((a, b) => a - b); }
  }
  return best.length < k ? Infinity : best.reduce((a, b) => a + b, 0);
}

function sampleClassic(players, roles, byPos, w, cap, rand, stackRate, floor) {
  const FLEX = byPos.RB.concat(byPos.WR, byPos.TE);
  for (let attempt = 0; attempt < 8; attempt++) {
    const used = {}, ids = [];
    let sal = 0, ok = true;
    const want = { QB: 1, RB: 2, WR: 3, TE: 1, DST: 1 };
    let flexLeft = 1;
    // cheapest / priciest way to finish the roster from here
    const minLeft = (excl) => {
      let mn = 0;
      for (const pos of ["QB", "RB", "WR", "TE", "DST"])
        mn += cheapestK(byPos[pos], want[pos] - (excl === pos ? 1 : 0), used, players);
      if (flexLeft && excl !== "FLEX") mn += cheapestK(FLEX, 1, used, players);
      return mn;
    };
    const maxLeft = (excl) => {
      let mx = 0;
      for (const pos of ["QB", "RB", "WR", "TE", "DST"])
        mx += costliestK(byPos[pos], want[pos] - (excl === pos ? 1 : 0), used, players);
      if (flexLeft && excl !== "FLEX") mx += costliestK(FLEX, 1, used, players);
      return mx;
    };
    const take = (id) => { used[id] = 1; ids.push(id); sal += players[id].sal; };
    // ⚠️ Real DraftKings entries spend nearly the whole cap. A field sampled without a
    // salary floor is systematically cheaper — and therefore weaker — than the room you
    // are actually playing against, which inflates every ROI the simulator reports.
    const roomFor = (pos) => ({
      max: cap - sal - minLeft(pos),
      min: floor ? floor - sal - maxLeft(pos) : null
    });

    let r = roomFor("QB");
    const qb = pick(byPos.QB, w, rand, used, r.max, players, r.min);
    if (qb < 0) return null;
    take(qb); want.QB = 0;

    if (rand() < stackRate) {
      const mates = byPos.WR.concat(byPos.TE).filter(i => players[i].team === players[qb].team);
      const n = rand() < 0.45 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const pool = mates.filter(i => !used[i] && want[players[i].pos] > 0);
        if (!pool.length) break;
        const pos = players[pool[0]].pos;
        r = roomFor(pos);
        const m = pick(pool, w, rand, used, r.max, players, r.min);
        if (m < 0) break;
        take(m); want[players[m].pos]--;
      }
    }

    for (const pos of ["RB", "WR", "TE", "DST"]) {
      while (want[pos] > 0) {
        r = roomFor(pos);
        const p = pick(byPos[pos], w, rand, used, r.max, players, r.min);
        if (p < 0) { ok = false; break; }
        take(p); want[pos]--;
      }
      if (!ok) break;
    }
    if (!ok) continue;

    const fx = pick(FLEX, w, rand, used, cap - sal, players, floor ? floor - sal : null);
    if (fx < 0) continue;
    take(fx); flexLeft = 0;

    if (ids.length !== 9 || sal > cap) continue;
    let ng = 0; const games = {};
    for (const id of ids) if (!games[players[id].gid]) { games[players[id].gid] = 1; ng++; }
    if (ng >= 2) { ids.sal = sal; return ids; }
  }
  return null;
}

function sampleShowdown(players, byPos, w, cap, rand, site, eligible, floor) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const used = {}, ids = [];
    let left = site.size - 1;
    const cptRoom = cap - cheapestK(eligible, left, used, players);
    const cpt = pick(eligible, w, rand, used, cptRoom / site.cptSalMult, players, null);
    if (cpt < 0) return null;
    used[cpt] = 1; ids.push(cpt);
    let sal = Math.round(players[cpt].sal * site.cptSalMult), ok = true;
    while (left > 0) {
      const max = cap - sal - cheapestK(eligible, left - 1, used, players);
      const min = floor ? floor - sal - costliestK(eligible, left - 1, used, players) : null;
      const p = pick(eligible, w, rand, used, max, players, min);
      if (p < 0) { ok = false; break; }
      used[p] = 1; ids.push(p); sal += players[p].sal; left--;
    }
    if (!ok || sal > cap) continue;
    const teams = {}; let nt = 0;
    for (const id of ids) if (!teams[players[id].team]) { teams[players[id].team] = 1; nt++; }
    if (nt < 2) continue;
    ids.cpt = cpt; ids.sal = sal;
    return ids;
  }
  return null;
}

/* ---- payouts ------------------------------------------------------------- */

function payoutFn(spec, fieldSize, entryFee) {
  if (spec.kind === "table" && spec.rows && spec.rows.length) {
    const rows = spec.rows.slice().sort((a, b) => a.from - b.from);
    return function (rank) {
      const r = Math.round(rank);
      for (const row of rows) if (r >= row.from && r <= row.to) return row.prize;
      return 0;
    };
  }
  // parametric: prize(r) proportional to r^-alpha over the paid places.
  // alpha is "how top-heavy" — 1.15 puts roughly 15-18% of the pool on first in a
  // large field, which is about where DraftKings' big tournaments sit.
  const paidFrac = spec.paidFrac == null ? 0.2 : spec.paidFrac;
  const alpha = spec.alpha == null ? 1.15 : spec.alpha;
  const rake = spec.rake == null ? 0.15 : spec.rake;
  const paid = Math.max(1, Math.round(fieldSize * paidFrac));
  const pool = fieldSize * entryFee * (1 - rake);
  if (spec.kind === "flat") {
    const prize = pool / paid;
    return rank => (rank <= paid ? prize : 0);
  }
  let H = 0;
  const step = paid > 5000 ? Math.ceil(paid / 5000) : 1;
  for (let r = 1; r <= paid; r += step) H += Math.pow(r, -alpha) * step;
  return function (rank) {
    if (rank > paid || rank < 1) return 0;
    return pool * Math.pow(rank, -alpha) / H;
  };
}

root.DDFS.simulate = simulate;
root.DDFS.CORR = CORR;
root.DDFS.assignRoles = assignRoles;
root.DDFS.payoutFn = payoutFn;

})(mcpDdfsRoot);

/* ================================== /mcp ================================== */
// The league's remote MCP server. One URL, pasted once into Claude's custom-
// connector box, gives any leaguemate's own Claude READ access to the league:
//
//   https://toto.jkapcar4.workers.dev/mcp/<DAWG_PASS>
//
// TWO WAYS IN, and they are not equivalent:
//
//   /mcp/u_<token>     PER-USER. Minted at /connect.html, stored HASHED, revocable
//                      individually. The call knows WHO is asking, which is what makes
//                      attribution — and eventually writes — possible.
//   /mcp/<DAWG_PASS>   SHARED, legacy, read-only. Anonymous: the server cannot tell one
//                      caller from another. Kept working so nobody is cut off mid-season;
//                      retire it once all 14 hold personal URLs.
//
// ⚠️ The URL IS the credential either way. Claude's connector UI takes a URL and has no
// field for a custom header, so the secret rides in the path. It leaks through
// screenshots and history. Per-user makes a leak CONTAINABLE — rotate one row, nobody
// else is disturbed — it does not make it secure, and it must never be described as
// security. Rotating DAWG_PASS by contrast re-onboards all 14 AND breaks the website's
// Toto/TTS auth, since that secret is shared.
// Header X-Dawg-Pass and Authorization: Bearer are also accepted for clients
// that can send them (Claude Code, Desktop config).
//
// ⚠️ NOTHING WRITES. No fbPut, no fbPatch, no fbDelete, no KV writes anywhere
// in this block — asserted by test against the source. An agent cannot place a
// Bozo leg, edit a draft or grade a week through this endpoint.
//
// Protocol: JSON-RPC 2.0 over Streamable HTTP, STATELESS — every POST is
// self-contained, no session, no SSE. A Worker is not a long-lived process.
// ⚠️ A notification must return 202 with an EMPTY body. notifications/initialized
//   carries no id; replying with an envelope and a null id breaks strict clients
//   during the handshake.
// ⚠️ Tool failures are results with isError:true, not JSON-RPC errors. A protocol
//   error aborts the turn; a tool error is something the model reads and recovers
//   from. "The draft room is empty" is an answer, not a crash.
// ⚠️ This route is matched BEFORE the Origin-gated handlers. Anthropic calls the
//   Worker server-to-server with no Origin; anything consulting ORIGINS would
//   reject it. /mcp carries its own permissive CORS — the URL secret authorises.

const MCP_PROTOS = ["2025-03-26", "2025-06-18", "2026-07-28"];
const MCP_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Dawg-Pass, Mcp-Session-Id, MCP-Protocol-Version",
};
const SITE = "https://datadawgs216.com";

// Module-scope caches: the pool and the correlation matrix change on deploy, not
// per request. An hour is generous; a Worker isolate rarely lives that long anyway.
let mcpPoolCache = { at: 0, data: null };
let mcpCorrCache = { at: 0, data: null };
let mcpSurvCache = { at: 0, data: null };

// Abramowitz–Stegun normal CDF — the SAME approximation survivor.html ships, so the
// tool and the page cannot disagree about a probability by more than float dust.
function mcpNcdf(z) {
  const s = z < 0 ? -1 : 1; z = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}

// Pure Pound calculator primitives. These intentionally mirror work/pound-core.js,
// and test-mcp.mjs checks the MCP results against that source. MCP schemas describe
// the inputs, but the server validates again because not every client enforces schemas.
// No value is stored, no external service is called and no result is represented as a
// forecast unless the caller supplied a probability explicitly.
function mcpCalcFinite(v, name) {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw new Error((name || "value") + " must be a finite number");
  return v;
}
function mcpCalcProbability(v, name) {
  const n = mcpCalcFinite(v, name || "probability");
  if (n < 0 || n > 1) throw new Error((name || "probability") + " must be between 0 and 1");
  return n;
}
function mcpCalcAmerican(v) {
  const n = mcpCalcFinite(v, "American odds");
  if (n === 0 || Math.abs(n) < 100) throw new Error("American odds must be <= -100 or >= +100");
  return n;
}
const mcpCalcClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function mcpCalcAmericanToDecimal(v) {
  const a = mcpCalcAmerican(v);
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}
function mcpCalcDecimalToAmerican(v) {
  const d = mcpCalcFinite(v, "decimal odds");
  if (d <= 1) throw new Error("decimal odds must be greater than 1");
  return d >= 2 ? (d - 1) * 100 : -100 / (d - 1);
}
function mcpCalcImplied(v) { return 1 / mcpCalcAmericanToDecimal(v); }
function mcpCalcParlay(values) {
  if (!Array.isArray(values) || !values.length) throw new Error("enter at least one leg");
  if (values.length > 20) throw new Error("a parlay is limited to 20 legs per call");
  const legs = values.map(mcpCalcAmerican);
  const decimal = legs.reduce((p, v) => p * mcpCalcAmericanToDecimal(v), 1);
  if (!Number.isFinite(decimal)) throw new Error("combined parlay price is outside the supported numeric range");
  return { legs, decimal, american: mcpCalcDecimalToAmerican(decimal), implied_probability: 1 / decimal };
}
function mcpCalcHoldVig(a, b) {
  const raw = [mcpCalcImplied(a), mcpCalcImplied(b)];
  const sum = raw[0] + raw[1];
  return { raw_implied: raw, hold: sum - 1, devig_probability: raw.map(p => p / sum) };
}
function mcpCalcBetEv(winProbability, price) {
  const p = mcpCalcProbability(winProbability, "win probability");
  const decimal = mcpCalcAmericanToDecimal(price);
  const breakEven = 1 / decimal;
  const expected = p * (decimal - 1) - (1 - p);
  return { break_even_probability: breakEven, expected_profit_per_unit: expected, roi: expected };
}
function mcpCalcHedge(originalStake, originalPrice, hedgePrice) {
  const stake = mcpCalcFinite(originalStake, "original stake");
  if (stake <= 0) throw new Error("original stake must be greater than zero");
  const d1 = mcpCalcAmericanToDecimal(originalPrice), d2 = mcpCalcAmericanToDecimal(hedgePrice);
  const hedgeStake = stake * d1 / d2;
  const profit = stake * (d1 - 1) - hedgeStake;
  return { hedge_stake: hedgeStake, locked_profit: profit, original_decimal: d1, hedge_decimal: d2 };
}
function mcpCalcPasserRating(attempts, completions, yards, touchdowns, interceptions) {
  const att = mcpCalcFinite(attempts, "attempts"), cmp = mcpCalcFinite(completions, "completions");
  const yds = mcpCalcFinite(yards, "yards"), td = mcpCalcFinite(touchdowns, "touchdowns");
  const interceptionsN = mcpCalcFinite(interceptions, "interceptions");
  if (att <= 0) throw new Error("attempts must be greater than zero");
  if (![att, cmp, yds, td, interceptionsN].every(Number.isInteger)) throw new Error("passing statistics must be whole numbers");
  if ([cmp, td, interceptionsN].some(v => v < 0) || cmp > att || td > att || interceptionsN > att)
    throw new Error("enter a valid passing line");
  const parts = [
    mcpCalcClamp((cmp / att - 0.3) * 5, 0, 2.375),
    mcpCalcClamp((yds / att - 3) * 0.25, 0, 2.375),
    mcpCalcClamp((td / att) * 20, 0, 2.375),
    mcpCalcClamp(2.375 - (interceptionsN / att) * 25, 0, 2.375),
  ];
  return { rating: parts.reduce((s, v) => s + v, 0) / 6 * 100, components: parts };
}
function mcpCalcEloGame(homeElo, awayElo, homeFieldElo) {
  const homeRating = mcpCalcFinite(homeElo, "home Elo");
  const awayRating = mcpCalcFinite(awayElo, "away Elo");
  const homeField = mcpCalcFinite(homeFieldElo, "home-field Elo");
  const adjusted = homeRating + homeField - awayRating;
  const home = 1 / (1 + Math.pow(10, -adjusted / 400));
  return { home_win_probability: home, away_win_probability: 1 - home, adjusted_elo_difference: adjusted };
}
// Peter J. Acklam's inverse-normal rational approximation and the matching
// browser CDF. Keeping these coefficients in parity with work/pound-core.js
// prevents the MCP and human calculator from producing different answers.
function mcpCalcNormalInv(v) {
  const p = mcpCalcProbability(v);
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
    -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425, hi = 1 - lo;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > hi) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
function mcpCalcNormalCdf(x) {
  const z = mcpCalcFinite(x, "z");
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const density = 0.3989422804014327 * Math.exp(-z * z / 2);
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - density * poly;
  return z >= 0 ? cdf : 1 - cdf;
}
function mcpCalcNormalTranslation(homeWinProbability, residualSdPoints, homeLine) {
  const p = mcpCalcProbability(homeWinProbability, "home win probability");
  if (p <= 0 || p >= 1) throw new Error("translation probability must be strictly between 0 and 1");
  const sd = mcpCalcFinite(residualSdPoints, "residual SD");
  if (sd <= 0) throw new Error("residual SD must be greater than zero");
  const margin = 0.5 + sd * mcpCalcNormalInv(p);
  if (!Number.isFinite(margin)) throw new Error("translated margin is outside the supported numeric range");
  const out = { expected_margin_home: margin, model_spread_home: margin, residual_sd_points: sd };
  if (homeLine !== undefined && homeLine !== null && homeLine !== "") {
    const line = mcpCalcFinite(homeLine, "home line");
    const threshold = -line;
    out.home_line = line;
    out.cover_threshold_home_margin = threshold;
    out.home_cover_probability = 1 - mcpCalcNormalCdf((threshold - margin) / sd);
    out.push_probability = 0;
  }
  return out;
}
function mcpCalcForecastGrade(forecastProbability, outcome) {
  const p = mcpCalcProbability(forecastProbability, "forecast probability");
  const y = mcpCalcFinite(outcome, "outcome");
  if (y !== 0 && y !== 1) throw new Error("outcome must be 0 or 1");
  const safe = mcpCalcClamp(p, 1e-15, 1 - 1e-15);
  return { brier: (p - y) ** 2, log_loss: -(y * Math.log(safe) + (1 - y) * Math.log(1 - safe)), sample_size: 1 };
}
function mcpCalcBeliefSummary(values) {
  if (!Array.isArray(values) || !values.length) throw new Error("enter at least one probability");
  if (values.length > 100) throw new Error("belief summary is limited to 100 probabilities per call");
  const xs = values.map((v, i) => mcpCalcProbability(v, "probability " + (i + 1))).sort((a, b) => a - b);
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  const median = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
  const variance = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length;
  return { count: xs.length, mean, median, min: xs[0], max: xs[xs.length - 1], range: xs[xs.length - 1] - xs[0],
    standard_deviation: Math.sqrt(variance), crosses_50: xs[0] < 0.5 && xs[xs.length - 1] > 0.5 };
}

// DFS solver adapter. The optimizer itself is injected from work/dfs-engine.js by
// assemble.mjs, so the browser and MCP execute one source. This layer only validates a
// bounded caller-supplied slate, maps public ids to engine indexes and makes every
// constraint/result inspectable. Inputs and results are never stored.
const MCP_DFS_MAX_PLAYERS = 220;
const MCP_DFS_MAX_LINEUPS = 20;
const MCP_DFS_MAX_TIME_MS = 3000;
const MCP_DFS_POSITIONS = ["QB", "RB", "WR", "TE", "DST"];

function mcpDfsHas(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
function mcpDfsKnown(obj, allowed, label) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error(label + " must be an object");
  const extra = Object.keys(obj).filter(k => !allowed.includes(k));
  if (extra.length) throw new Error(label + " has unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
}
function mcpDfsString(v, label, max) {
  if (typeof v !== "string" || !v.trim()) throw new Error(label + " must be a non-empty string");
  const s = v.trim();
  if (s.length > max) throw new Error(label + " is limited to " + max + " characters");
  return s;
}
function mcpDfsNumber(v, label, lo, hi) {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(label + " must be a finite number");
  if (v < lo || v > hi) throw new Error(label + " must be between " + lo + " and " + hi);
  return v;
}
function mcpDfsInteger(v, label, lo, hi) {
  const n = mcpDfsNumber(v, label, lo, hi);
  if (!Number.isInteger(n)) throw new Error(label + " must be a whole number");
  return n;
}
function mcpDfsOptionalInteger(args, key, label, lo, hi, fallback) {
  return mcpDfsHas(args, key) ? mcpDfsInteger(args[key], label, lo, hi) : fallback;
}
function mcpDfsOptionalNumber(args, key, label, lo, hi, fallback) {
  return mcpDfsHas(args, key) ? mcpDfsNumber(args[key], label, lo, hi) : fallback;
}
function mcpDfsSlots(lineup, players, site) {
  if (site === "dk_showdown") {
    const rest = lineup.ids.filter(i => i !== lineup.cpt);
    return [{ slot: "CPT", i: lineup.cpt }].concat(rest.map(i => ({ slot: "FLEX", i })));
  }
  const by = { QB: [], RB: [], WR: [], TE: [], DST: [] };
  lineup.ids.forEach(i => by[players[i].pos].push(i));
  for (const pos of MCP_DFS_POSITIONS)
    by[pos].sort((a, b) => players[b].proj - players[a].proj || players[a].id.localeCompare(players[b].id));
  const flex = by.RB[2] !== undefined ? by.RB[2] : by.WR[3] !== undefined ? by.WR[3] : by.TE[1];
  return [
    { slot: "QB", i: by.QB[0] },
    { slot: "RB", i: by.RB[0] }, { slot: "RB", i: by.RB[1] },
    { slot: "WR", i: by.WR[0] }, { slot: "WR", i: by.WR[1] }, { slot: "WR", i: by.WR[2] },
    { slot: "TE", i: by.TE[0] }, { slot: "FLEX", i: flex }, { slot: "DST", i: by.DST[0] },
  ];
}
function mcpDfsSolve(args) {
  mcpDfsKnown(args, ["players", "site", "count", "min_salary", "max_salary", "unique_players",
    "randomness", "seed", "max_per_team", "max_per_game", "time_limit_ms", "stack"], "arguments");
  if (!Array.isArray(args.players) || !args.players.length)
    throw new Error("players must be a non-empty array");
  if (args.players.length > MCP_DFS_MAX_PLAYERS)
    throw new Error("players is limited to " + MCP_DFS_MAX_PLAYERS + " rows per call");

  const site = args.site === undefined ? "dk_classic" : args.site;
  if (site !== "dk_classic" && site !== "dk_showdown")
    throw new Error("site must be dk_classic or dk_showdown");
  const siteSpec = mcpDdfsRoot.DDFS.SITES[site];
  const count = mcpDfsOptionalInteger(args, "count", "count", 1, MCP_DFS_MAX_LINEUPS, 1);
  const minSalary = mcpDfsOptionalInteger(args, "min_salary", "min_salary", 0, siteSpec.cap, 0);
  const maxSalary = mcpDfsOptionalInteger(args, "max_salary", "max_salary", 100, siteSpec.cap, siteSpec.cap);
  if (minSalary > maxSalary) throw new Error("min_salary cannot exceed max_salary");
  if (minSalary % 100 || maxSalary % 100) throw new Error("salary limits must be multiples of 100");
  const uniques = mcpDfsOptionalInteger(args, "unique_players", "unique_players", 0, siteSpec.size, count > 1 ? (siteSpec.showdown ? 1 : 2) : 0);
  const randomness = mcpDfsOptionalNumber(args, "randomness", "randomness", 0, 0.6, 0);
  const seed = mcpDfsOptionalInteger(args, "seed", "seed", 1, 2147483647, 1);
  const maxPerTeam = mcpDfsHas(args, "max_per_team")
    ? mcpDfsInteger(args.max_per_team, "max_per_team", 1, siteSpec.size) : undefined;
  const maxPerGame = mcpDfsHas(args, "max_per_game")
    ? mcpDfsInteger(args.max_per_game, "max_per_game", 1, siteSpec.size) : undefined;
  const timeLimitMs = mcpDfsOptionalInteger(args, "time_limit_ms", "time_limit_ms", 100, MCP_DFS_MAX_TIME_MS, 2000);

  const stackIn = args.stack === undefined ? {} : args.stack;
  mcpDfsKnown(stackIn, ["qb_min", "qb_positions", "bring_back", "no_rb_vs_dst", "no_opp_dst"], "stack");
  const qbMin = mcpDfsOptionalInteger(stackIn, "qb_min", "stack.qb_min", 0, 3, 0);
  const bringBack = mcpDfsOptionalInteger(stackIn, "bring_back", "stack.bring_back", 0, 3, 0);
  const qbPos = stackIn.qb_positions === undefined ? ["WR", "TE"] : stackIn.qb_positions;
  if (!Array.isArray(qbPos) || !qbPos.length || qbPos.length > 3 ||
      qbPos.some(p => !["RB", "WR", "TE"].includes(p)) || new Set(qbPos).size !== qbPos.length)
    throw new Error("stack.qb_positions must contain one to three unique values from RB, WR, TE");
  for (const key of ["no_rb_vs_dst", "no_opp_dst"])
    if (mcpDfsHas(stackIn, key) && typeof stackIn[key] !== "boolean")
      throw new Error("stack." + key + " must be true or false");
  if (siteSpec.showdown && (qbMin || bringBack || stackIn.no_rb_vs_dst || stackIn.no_opp_dst))
    throw new Error("QB-stack and DST-opponent constraints apply only to dk_classic");

  const ids = new Set();
  const players = args.players.map((raw, i) => {
    const label = "players[" + i + "]";
    mcpDfsKnown(raw, ["id", "name", "position", "team", "opponent", "game_id", "salary",
      "projection", "ownership", "lock", "exclude", "max_exposure"], label);
    const id = mcpDfsString(raw.id, label + ".id", 80);
    if (ids.has(id)) throw new Error("player id appears more than once: " + id);
    ids.add(id);
    const pos = mcpDfsString(raw.position, label + ".position", 3).toUpperCase();
    if (!MCP_DFS_POSITIONS.includes(pos)) throw new Error(label + ".position must be QB, RB, WR, TE or DST");
    const sal = mcpDfsInteger(raw.salary, label + ".salary", 100, siteSpec.cap);
    if (sal % 100) throw new Error(label + ".salary must be a multiple of 100");
    const lock = raw.lock === undefined ? false : raw.lock;
    const excl = raw.exclude === undefined ? false : raw.exclude;
    if (typeof lock !== "boolean" || typeof excl !== "boolean") throw new Error(label + ".lock and .exclude must be true or false");
    if (lock && excl) throw new Error(label + " cannot be both locked and excluded");
    const maxExp = raw.max_exposure === undefined ? null
      : mcpDfsNumber(raw.max_exposure, label + ".max_exposure", 0, 1);
    if (lock && maxExp === 0) throw new Error(label + " cannot be locked with max_exposure 0");
    return {
      id,
      name: mcpDfsString(raw.name, label + ".name", 100),
      pos,
      team: mcpDfsString(raw.team, label + ".team", 12).toUpperCase(),
      opp: mcpDfsString(raw.opponent, label + ".opponent", 12).toUpperCase(),
      gid: mcpDfsString(raw.game_id, label + ".game_id", 80),
      sal,
      proj: mcpDfsNumber(raw.projection, label + ".projection", 0, 100),
      own: raw.ownership === undefined ? null : mcpDfsNumber(raw.ownership, label + ".ownership", 0, 100),
      lock, excl: excl || maxExp === 0, maxExp,
    };
  });

  const cfg = {
    site, count, minSalary, maxSalary, uniques, randomness, seed,
    maxPerTeam, maxPerGame, timeLimitMs,
    stack: { qbMin, qbPos: qbPos.slice(), bringBack,
      noRbVsDst: stackIn.no_rb_vs_dst === true, noOppDst: stackIn.no_opp_dst === true },
  };
  const started = Date.now();
  const solved = mcpDdfsRoot.DDFS.solveLineups(players, cfg);
  const elapsedMs = Date.now() - started;
  const locked = players.filter(p => p.lock).map(p => p.id);
  const excluded = new Set(players.filter(p => p.excl).map(p => p.id));
  const output = solved.lineups.map((lineup, n) => {
    const slots = mcpDfsSlots(lineup, players, site).map(({ slot, i }) => {
      const p = players[i], captain = slot === "CPT";
      return {
        slot, id: p.id, name: p.name, position: p.pos, team: p.team,
        opponent: p.opp, game_id: p.gid, salary: p.sal,
        slot_salary: captain ? Math.round(p.sal * siteSpec.cptSalMult) : p.sal,
        projection: p.proj,
        slot_projection: captain ? p.proj * siteSpec.cptMult : p.proj,
        ownership: p.own, locked: p.lock,
      };
    });
    const lineupIds = new Set(slots.map(p => p.id));
    const ownershipComplete = slots.every(p => p.ownership !== null);
    const audit = {
      roster_size: slots.length,
      unique_players: lineupIds.size,
      salary_within_range: lineup.sal >= minSalary && lineup.sal <= maxSalary,
      all_locks_present: locked.every(id => lineupIds.has(id)),
      no_excluded_players: ![...lineupIds].some(id => excluded.has(id)),
    };
    audit.satisfied = audit.roster_size === siteSpec.size && audit.unique_players === siteSpec.size &&
      audit.salary_within_range && audit.all_locks_present && audit.no_excluded_players;
    return {
      rank: n + 1, salary: lineup.sal, projection: lineup.proj,
      drawn_projection: randomness ? lineup.drawnProj : null,
      ownership_sum: ownershipComplete ? slots.reduce((sum, p) => sum + p.ownership, 0) : null,
      ownership_complete: ownershipComplete,
      captain_id: lineup.cpt === undefined ? null : players[lineup.cpt].id,
      players: slots, constraint_audit: audit,
    };
  });
  const exposure = players.map((p, i) => ({
    id: p.id, name: p.name,
    lineups: Number(solved.exposure[i] || 0),
    rate: output.length ? Number(solved.exposure[i] || 0) / output.length : 0,
  })).filter(row => row.lineups > 0);
  const status = output.length === count && !solved.timedOut && !solved.infeasible ? "complete"
    : output.length ? "partial" : solved.timedOut ? "time_limit_no_lineup" : "infeasible";
  const warnings = [
    "Every projection, salary and ownership value came from this call. Data Dawgs did not supply or verify them.",
    "The optimizer maximizes the supplied projection under the declared constraints; optimized does not mean likely or profitable.",
  ];
  if (randomness) warnings.push("Seeded randomness perturbed the optimization objective per lineup; projection reports the unperturbed caller-supplied total.");
  if (solved.timedOut) warnings.push("The bounded Worker time limit was reached. Every returned lineup is valid, but the requested set did not finish.");
  if (output.some(l => !l.ownership_complete)) warnings.push("Ownership was missing for at least one selected player, so ownership_sum is null for that lineup.");
  return {
    status, read_only: true, stored: false, site,
    method: "Exact branch-and-bound per accepted lineup using the same source as dfs.html.",
    methodology_url: SITE + "/dfs.html#method",
    requested_lineups: count, returned_lineups: output.length,
    elapsed_ms: elapsedMs, timed_out: !!solved.timedOut,
    infeasible_reason: solved.infeasible || null,
    constraints: {
      min_salary: minSalary, max_salary: maxSalary, unique_players: uniques,
      randomness, seed, max_per_team: maxPerTeam || null, max_per_game: maxPerGame || null,
      time_limit_ms: timeLimitMs,
      stack: { qb_min: qbMin, qb_positions: qbPos, bring_back: bringBack,
        no_rb_vs_dst: stackIn.no_rb_vs_dst === true, no_opp_dst: stackIn.no_opp_dst === true },
    },
    input_summary: { players: players.length, locked: locked.length, excluded: excluded.size },
    lineups: output, exposure, warnings,
  };
}

// survivor.json carries the whole 2026 schedule with blended win probabilities,
// the nfelo Elo table and the margin-model constants — one fetch feeds both the
// survivor EV tool and the matchup tool. 15 min cache: it changes on data pushes,
// not per request, but weekly ownership context makes an hour feel stale.
async function mcpSurvivor() {
  if (!mcpSurvCache.data || Date.now() - mcpSurvCache.at > 900e3) {
    const r = await fetch(`${SITE}/data/survivor.json`, { cf: { cacheTtl: 900, cacheEverything: true } });
    if (!r.ok) throw new Error("survivor.json unavailable: HTTP " + r.status);
    mcpSurvCache = { at: Date.now(), data: (await r.json()).data };
  }
  return mcpSurvCache.data;
}

// Resolve the credential in the URL (or header) to a caller.
//   { kind:"user", name }  — a per-user token, matched by HASH against /users
//   { kind:"shared" }      — the legacy league passphrase; anonymous
//   null                   — no match; the caller gets a 401
// ⚠️ Matched by hash and compared timing-safely against EVERY row, so a wrong token
// leaks no timing signal about which member it nearly matched — the same discipline
// bozoClaim already applies to invite tokens.
async function mcpAuth(request, url, env) {
  const supplied = mcpPassOf(request, url);
  if (!supplied) return null;

  if (supplied.startsWith("u_")) {
    if (!env.BOZO_PEPPER) return null;          // per-user tokens need the pepper to hash
    let users;
    try { users = await loadUsers(env); } catch { return null; }
    const h = await mcpTokenHash(env, supplied);
    let hit = null;
    for (const [key, u] of Object.entries(users))
      if (u && u.mcpToken && timingSafeEqual(h, u.mcpToken)) hit = playerName(key);
    return hit ? { kind: "user", name: hit } : null;
  }

  if (env.DAWG_PASS && timingSafeEqual(supplied, env.DAWG_PASS)) return { kind: "shared" };
  return null;
}

function mcpPassOf(request, url) {
  const seg = url.pathname.split("/").filter(Boolean);          // ["mcp", "<pass>"]
  if (seg.length >= 2) { try { return decodeURIComponent(seg.slice(1).join("/")); } catch { return seg.slice(1).join("/"); } }
  const h = request.headers.get("X-Dawg-Pass");
  if (h) return h;
  const a = request.headers.get("Authorization") || "";
  if (a.startsWith("Bearer ")) return a.slice(7);
  return "";
}

const mcpJson = (obj, status) =>
  new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json", ...MCP_CORS } });
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } });
const rpcOk  = (id, result) => ({ jsonrpc: "2.0", id, result });
const toolText = obj => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 1) }] });
const toolErr  = msg => ({ content: [{ type: "text", text: msg }], isError: true });

async function handleMcp(request, url, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: MCP_CORS });
  if (request.method === "GET")
    return mcpJson({ name: "data-dawgs", transport: "streamable-http", hint: "POST JSON-RPC 2.0 here." }, 405);
  if (request.method !== "POST") return mcpJson(rpcErr(null, -32600, "POST only"), 405);

  // ⚠️ Either mechanism is enough on its own: BOZO_PEPPER for per-user tokens, DAWG_PASS
  // for the legacy shared one. Demanding both would have taken shared access down the
  // moment per-user shipped, for no reason.
  if (!env.BOZO_PEPPER && !env.DAWG_PASS)
    return mcpJson(rpcErr(null, -32000, "Worker misconfigured: neither BOZO_PEPPER nor DAWG_PASS is set."), 500);
  const caller = await mcpAuth(request, url, env);
  if (!caller)
    return new Response(JSON.stringify(rpcErr(null, -32001, "unauthorised — get your personal connector URL from " + SITE + "/connect.html")),
      { status: 401, headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="data-dawgs"', ...MCP_CORS } });

  let body;
  try { body = await request.json(); }
  catch { return mcpJson(rpcErr(null, -32700, "Parse error"), 400); }

  const batch = Array.isArray(body);
  const msgs = batch ? body : [body];
  if (!msgs.length) return mcpJson(rpcErr(null, -32600, "Invalid Request"), 400);

  const replies = [];
  for (const m of msgs) {
    const r = await mcpDispatch(m, env, caller);
    if (r !== undefined) replies.push(r);        // notifications contribute nothing
  }
  if (!replies.length) return new Response(null, { status: 202, headers: MCP_CORS });
  return mcpJson(batch ? replies : replies[0]);
}

async function mcpDispatch(m, env, caller) {
  if (!m || typeof m !== "object" || m.jsonrpc !== "2.0" || typeof m.method !== "string")
    return rpcErr(m && m.id, -32600, "Invalid Request");
  const id = m.id;
  if (id === undefined) return undefined;        // a notification: acknowledge by silence

  switch (m.method) {
    case "initialize": {
      const want = m.params && m.params.protocolVersion;
      // Echo a known protocolVersion; fall back rather than guess forward.
      const proto = MCP_PROTOS.includes(want) ? want : "2025-06-18";
      return rpcOk(id, {
        protocolVersion: proto,
        capabilities: { tools: {} },
        serverInfo: { name: "data-dawgs", version: "1.4.0" },
        instructions:
          (caller && caller.kind === "user"
            ? "You are connected as " + caller.name + ". When a tool marks a row `you: true`, that is them.\n"
            : "⚠️ This is the SHARED league connector — you do NOT know which member you are talking to. " +
              "Never assume whose team, leg or ledger is whose; ask. A personal URL from " + SITE + "/connect.html fixes this.\n") +
          "Everything here is read-only and is either the league's own data, public play-by-play, " +
          "or a deterministic calculation over caller-supplied inputs. Calculator inputs and results are not stored. " +
          "There is no built-in DFS projection or ownership feed: dd_solve_dfs_lineup requires the caller to supply every value per call, and stores none of them. When quoting bozo odds, survivor odds " +
          "or the correlation matrix, say it is model output or a measured historical average, never a forecast " +
          "of a specific game. Team names, weeks and league ids come from dd_league_overview — do not guess them.",
      });
    }
    case "ping":
      return rpcOk(id, {});
    case "tools/list":
      return rpcOk(id, { tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case "tools/call": {
      const name = m.params && m.params.name;
      const tool = MCP_TOOLS.find(t => t.name === name);
      if (!tool) return rpcErr(id, -32602, "Unknown tool: " + name);
      try { return rpcOk(id, await tool.run((m.params && m.params.arguments) || {}, env, caller)); }
      catch (e) { return rpcOk(id, toolErr(String((e && e.message) || e))); }
    }
    default:
      return rpcErr(id, -32601, "Method not found: " + m.method);
  }
}

/* ------------------------------- the tools ------------------------------- */
// All read-only. Data tools use the same Firebase paths, KV keys and published pages
// the site itself uses; calculator tools mirror work/pound-core.js and are parity-tested.

const MCP_NO_ARGS = { type: "object", properties: {}, additionalProperties: false };

const MCP_TOOLS = [
  {
    name: "dd_whoami",
    description: "Who this connection is authenticated as. Call it when a question says 'my' or 'I' — my leg, my budget, my ledger — so you resolve that to the right person instead of guessing. If it reports anonymous:true you do NOT know who you are talking to and must ask.",
    inputSchema: MCP_NO_ARGS,
    async run(args, env, caller) {
      if (caller && caller.kind === "user")
        return toolText({
          player: caller.name, anonymous: false, access: "read-only",
          note: "Rows belonging to this player are marked `you: true` by the other tools.",
        });
      return toolText({
        player: null, anonymous: true, access: "read-only (shared league connector)",
        note: "This connection uses the shared league passphrase, so the server cannot tell which member is asking. " +
              "Do not assume whose team, leg or ledger is whose — ask the user. They can get a personal URL at " + SITE + "/connect.html.",
      });
    },
  },
  {
    name: "dd_league_overview",
    description: "Who is in the Data Dawgs Bozo league, what season/week it is on, and whether the current board is open, placed or graded.",
    inputSchema: { type: "object", properties: { league: { type: "string", description: "League id (default: main)" } }, additionalProperties: false },
    async run(args, env) {
      const lid = validLeagueId(args.league || DEFAULT_LEAGUE) ? (args.league || DEFAULT_LEAGUE) : null;
      if (!lid) return toolErr("Bad league id.");
      const lg = await loadLeague(env, lid);
      if (!lg) return toolErr("No such league: " + lid);
      return toolText({
        id: lid, name: lg.name || lid, manager: lg.manager || null,
        season: lg.season || SEASON, week: lg.week || 1, status: lg.status || "open",
        members: memberNames(lg),
        legsIn: Object.keys(lg.picks || {}).length,
      });
    },
  },
  {
    name: "dd_bozo_week",
    description: "The current Bozo board: every leg IN SUBMISSION ORDER (whoever went last saw every other leg first — that is the social point), plus the drawn lever hierarchy once the ticket is placed. Read the caveats field before analysing.",
    inputSchema: { type: "object", properties: { league: { type: "string", description: "League id (default: main)" } }, additionalProperties: false },
    async run(args, env, caller) {
      const lid = validLeagueId(args.league || DEFAULT_LEAGUE) ? (args.league || DEFAULT_LEAGUE) : null;
      if (!lid) return toolErr("Bad league id.");
      const lg = await loadLeague(env, lid);
      if (!lg) return toolErr("No such league: " + lid);
      const picks = lg.picks || {};
      const keys = Object.keys(picks);
      if (!keys.length)
        return toolText({ season: lg.season || SEASON, week: lg.week || 1, status: lg.status || "open", legs: [], note: "No legs are in yet this week." });
      // ⚠️ SUBMISSION ORDER, not object-key order.
      keys.sort((a, b) => (picks[a].ts || 0) - (picks[b].ts || 0));
      const me = caller && caller.kind === "user" ? caller.name : null;
      const legs = keys.map((k, i) => {
        const x = picks[k];
        return {
          order: i + 1, player: playerName(k),
          you: me ? playerName(k) === me : undefined,
          sport: x.sport, game: x.game, eventId: x.eventId,
          mkt: x.mkt, side: x.side, line: x.mkt === "ml" ? null : x.line,
          price: x.price, priceSource: x.priceSource || "self",
          label: x.label, prop: x.prop || null, ts: x.ts || null,
        };
      });
      return toolText({
        season: lg.season || SEASON, week: lg.week || 1, status: lg.status || "open",
        band: bandOf(lg), legs,
        you: me,
        yourLegIn: me ? keys.some(k => playerName(k) === me) : null,
        stillWaitingOn: Object.keys(lg.members || {}).filter(n => !keys.some(k => playerName(k) === n)),
        leverHierarchy: lg.order || null,
        results: lg.results || null, bozo: lg.bozo || null, bozoWhy: lg.bozoWhy || null,
        caveats: [
          "Bozo odds anywhere on the site are simulation output, not market prices.",
          "The simulator draws legs independently; correlated legs (same game, same side of a number) must be flagged by the reader.",
          "The lever hierarchy is a server-side random permutation drawn at lock — it is not chosen by anyone.",
          "Never state anyone's CLV. The site does not compute it and prices are self-reported (priceSource: self).",
        ],
      });
    },
  },
  {
    name: "dd_bozo_standings",
    description: "Season-to-date Bozo ledger summary per player: legs submitted, Last In count, Shortest Odds count, and any graded results present. Early season this will honestly say nothing has resolved.",
    inputSchema: { type: "object", properties: { league: { type: "string", description: "League id (default: main)" } }, additionalProperties: false },
    async run(args, env, caller) {
      const lid = validLeagueId(args.league || DEFAULT_LEAGUE) ? (args.league || DEFAULT_LEAGUE) : null;
      if (!lid) return toolErr("Bad league id.");
      let ledger;
      try { ledger = (await fbGet(env, LG(lid) + "/ledger")).data || {}; }
      catch (e) { return toolErr("Database unreachable: " + e.message); }
      const rows = Object.values(ledger);
      if (!rows.length) return toolText({ league: lid, note: "The ledger is empty — no week has locked yet." });
      const per = {};
      let graded = 0;
      for (const r of rows) {
        const p = per[r.player] || (per[r.player] = { legs: 0, lastIn: 0, shortestOdds: 0, results: {} });
        p.legs++;
        if (r.shortestOdds) p.shortestOdds++;
        if (r.result !== undefined && r.result !== null) { p.results[String(r.result)] = (p.results[String(r.result)] || 0) + 1; graded++; }
      }
      // Last In = highest rank within each season-week.
      const byWeek = {};
      for (const r of rows) (byWeek[`${r.season}-w${r.week}`] = byWeek[`${r.season}-w${r.week}`] || []).push(r);
      for (const wk of Object.values(byWeek)) {
        const last = wk.reduce((a, b) => (b.rank > a.rank ? b : a));
        if (per[last.player]) per[last.player].lastIn++;
      }
      const me = caller && caller.kind === "user" ? caller.name : null;
      if (me && per[me]) per[me].you = true;
      return toolText({
        league: lid, weeksOnLedger: Object.keys(byWeek).length, gradedRows: graded,
        you: me, players: per,
        note: graded ? undefined : "No graded results yet — everything above is bookkeeping, not performance.",
      });
    },
  },
  {
    name: "dd_draft_board",
    description: "Live auction draft state from the league's Firebase mirror: budgets, open roster spots, each team's TRUE max bid (dollars left minus $1 reserved per unfilled slot — reporting raw remaining is the classic auction blunder), who is on the clock, what is on the block, and recent sales. The payload always carries a `simulated` flag: when it is true the rows are test picks entered to exercise the rig, not completed sales.",
    inputSchema: { type: "object", properties: { room: { type: "string", description: "Draft room (default: the league room)" } }, additionalProperties: false },
    async run(args, env) {
      const room = String(args.room || "pepperoninipples").replace(/[.#$\[\]\/]/g, "-");
      let rec;
      try {
        const r = await fetch(`${DB}/drafts/${room}.json`);
        if (!r.ok) return toolErr("Draft mirror unavailable: HTTP " + r.status);
        rec = await r.json();
      } catch (e) { return toolErr("Draft mirror unavailable: " + e.message); }
      if (!rec || !rec.state) return toolErr("The draft room is empty.");
      const st = rec.state, set = st.settings || {};
      const budget = set.budget || 200, spots = set.spots || 15;
      const teams = (set.teams || []).map(t => ({ name: t.name, owner: t.owner || null, spent: 0, count: 0 }));
      const picks = st.picks || [];
      for (const pk of picks) { const t = teams[pk.ti]; if (t) { t.spent += pk.price || 0; t.count++; } }
      for (const t of teams) {
        t.left = budget - t.spent;
        t.openSpots = spots - t.count;
        // $1 must stay reserved for every unfilled slot beyond this one.
        t.maxBid = t.openSpots > 0 ? Math.max(0, t.left - (t.openSpots - 1)) : 0;
      }
      const recent = picks.slice(-10).map(pk => ({
        player: pk.player, pos: pk.pos, price: pk.price,
        team: (teams[pk.ti] || {}).name || null, keeper: !!pk.keeper,
      }));
      // C6 — this room is reused for testing between real drafts. A payload that cannot
      // tell a test pick from a completed sale reads as a finished auction to any assistant
      // that calls it ("Josh Allen $55 to Mark"). Read the flag from the top-level room node
      // AND from settings: the draft app rewrites `state`, so a flag stored inside it can be
      // clobbered mid-session. An absent flag means false — so it MUST be set on a test room
      // before anyone is handed a connector URL.
      const simulated = rec.simulated === true || set.simulated === true;
      return toolText({
        room, as_of: rec.ts || null, scoring: set.scoring || "half",
        simulated,
        budget, rosterSpots: spots,
        onTheClock: (teams[st.nomIdx] || {}).name || null,
        onBlock: st.onBlock || null,
        teams, picksMade: picks.length, recentSales: recent,
        note: simulated
          ? "SIMULATED — these picks were entered to test the league rig. They are NOT completed sales: no money moved, no player is rostered, and nobody is really on the clock. Do not report any of it as a real draft result."
          : undefined,
      });
    },
  },
  {
    name: "dd_draft_pool",
    description: "The published Market Value (MV) auction-dollar pool the site drafts from, filterable by position. MV is a dated snapshot, NOT a points projection — quote the as_of date out loud when quoting dollars.",
    inputSchema: {
      type: "object",
      properties: {
        pos: { type: "string", enum: ["QB", "RB", "WR", "TE", "K", "DST"], description: "Filter to one position" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Rows to return (default 25)" },
      },
      additionalProperties: false,
    },
    async run(args) {
      if (!mcpPoolCache.data || Date.now() - mcpPoolCache.at > 3600e3) {
        const r = await fetch(`${SITE}/data/pool.json`, { cf: { cacheTtl: 3600, cacheEverything: true } });
        if (!r.ok) return toolErr("pool.json unavailable: HTTP " + r.status);
        mcpPoolCache = { at: Date.now(), data: await r.json() };
      }
      const env2 = mcpPoolCache.data;
      let rows = env2.data || [];
      if (args.pos) rows = rows.filter(p => p.pos === args.pos);
      const limit = Math.min(Math.max(args.limit || 25, 1), 100);
      return toolText({
        as_of: env2.as_of, source: env2.source, note: env2.note,
        scoring_keys: env2.scoring_keys, tier: env2.tier, graded: env2.graded,
        count: rows.length, players: rows.slice(0, limit),
      });
    },
  },
  {
    name: "dd_survivor_week",
    description: "Stored survivor pick-ownership snapshot for a week. Ownership moves all week: a snapshot over 72 hours old is flagged stale and is directional-only.",
    inputSchema: {
      type: "object",
      properties: {
        season: { type: "integer", description: "Season (default: current)" },
        week: { type: "integer", minimum: 1, maximum: 18, description: "NFL week" },
      },
      required: ["week"],
      additionalProperties: false,
    },
    async run(args, env) {
      const kv = env.DD_KV || env.RL;
      if (!kv) return toolErr("No KV namespace bound — survivor data unavailable.");
      const season = args.season || SEASON, week = args.week;
      if (!(week >= 1 && week <= 18)) return toolErr("week must be 1-18");
      const hit = await kv.get(survivorKey(season, week));
      if (!hit) return toolErr("No pick data stored for this week.");
      const rec = JSON.parse(hit);
      const ageH = (Date.now() - rec.stored) / 3.6e6;
      return toolText({ ...rec, ageHours: Math.round(ageH * 10) / 10, stale: ageH > 72,
        note: ageH > 72 ? "Snapshot is over 72h old — treat as directional-only." : undefined });
    },
  },
  {
    name: "dd_survivor_ev",
    description: "Ranks every legal survivor pick for a week by closed-form expected value: win probability × expected share of the surviving field (one-week leverage). Ownership comes from the posted weekly snapshot when one exists, otherwise a chalk-softmax MODEL — and a modelled ranking is a structured guess, which the payload says in words.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1, maximum: 18, description: "NFL week" },
        entries: { type: "integer", minimum: 2, description: "Pool size (default 200). Drives how much fading the chalk is worth." },
        used: { type: "array", items: { type: "string" }, description: "Teams you have already spent (abbreviations)" },
      },
      required: ["week"],
      additionalProperties: false,
    },
    async run(args, env) {
      const D = await mcpSurvivor();
      const week = args.week;
      if (!(week >= 1 && week <= 18)) return toolErr("week must be 1-18");
      // Per-team table for the week, from the shipped blend (market 0.75 where a
      // line existed at capture — the same numbers survivor.html renders by default).
      const tab = {};
      for (const g of D.games) {
        if (g.wk !== week) continue;
        tab[g.h] = { opp: g.a, home: true, p: g.p, src: g.src };
        tab[g.a] = { opp: g.h, home: false, p: 1 - g.p, src: g.src };
      }
      if (!Object.keys(tab).length) return toolErr("No games found for week " + week + ".");

      // Ownership: the posted snapshot when Kap has stored one, else chalk softmax.
      // The field's distribution deliberately ignores YOUR used list — the field is not you.
      let pop = null, ownership = "modelled", ageHours, stale;
      const kv = env.DD_KV || env.RL;
      if (kv) {
        const hit = await kv.get(survivorKey(D.meta.season, week));
        if (hit) {
          const rec = JSON.parse(hit);
          const w = {}; let tot = 0;
          for (const t in (rec.picks || {})) { if (tab[t]) { w[t] = Math.max(0, rec.picks[t]); tot += w[t]; } }
          if (tot > 0) {
            for (const t in w) w[t] /= tot;
            pop = w; ownership = "posted";
            ageHours = Math.round((Date.now() - rec.stored) / 3.6e5) / 10;
            stale = ageHours > 72;
          }
        }
      }
      if (!pop) {
        const CHALK = 2.4;                      // survivor.html's default dial
        pop = {}; let tot = 0;
        for (const t in tab) { const v = Math.pow(Math.max(tab[t].p, 0.01), CHALK); pop[t] = v; tot += v; }
        for (const t in pop) pop[t] /= tot;
      }

      const entries = Math.max(2, Number(args.entries) || 200);
      const E = entries - 1;                    // the field is everyone but you
      const used = new Set((args.used || []).map(t => String(t).toUpperCase()));

      // Per-GAME surviving-mass contribution. Games are independent; within a game the
      // two sides are perfectly anti-correlated, so a game contributes
      // pop_a + (pop_h − pop_a)·W_h with W_h ~ Bernoulli(p_h): mean and variance closed-form.
      // Ported from survivor.html leverage() — keep the two in lockstep or the MCP
      // answer and the page will silently disagree.
      const seen = {}, gs = [];
      for (const t in tab) {
        if (seen[t]) continue;
        const g = tab[t]; seen[t] = 1; seen[g.opp] = 1;
        const ah = pop[t] || 0, aa = pop[g.opp] || 0;
        gs.push({ h: t, a: g.opp, mean: aa + (ah - aa) * g.p, varc: (ah - aa) * (ah - aa) * g.p * (1 - g.p) });
      }
      const rows = Object.keys(tab).filter(t => !used.has(t)).map(t => {
        const own = pop[t] || 0;
        let mu = 0, v2 = 0;
        for (const g of gs) {
          if (g.h === t || g.a === t) { mu += own; continue; }  // your game is settled: your side won
          mu += g.mean; v2 += g.varc;
        }
        const mean = E * mu, varS = E * E * v2;
        // E[1/(1+S)] is NOT 1/(1+E[S]) — 1/(1+x) is convex, the naive form is biased LOW.
        // Second-order Taylor closes it: 1/(1+µ) + Var(S)/(1+µ)³. Same correction the page uses.
        const d = 1 + mean;
        const equity = tab[t].p * (1 / d + varS / (d * d * d));
        return { team: t, opp: tab[t].opp, home: tab[t].home, p: tab[t].p, src: tab[t].src,
                 pop: Math.round(own * 1e4) / 1e4,
                 survivorsIfWin: Math.round(mean * 10) / 10,
                 equity };
      });
      if (!rows.length) return toolErr("Every team playing week " + week + " is on the used list.");
      rows.sort((a, b) => b.equity - a.equity || b.p - a.p);
      const best = Math.max(rows[0].equity, 1e-12);
      rows.forEach((r, i) => { r.rank = i + 1; r.evIndex = Math.round((r.equity / best) * 1e4) / 1e4; r.equity = Math.round(r.equity * 1e6) / 1e6; });

      return toolText({
        season: D.meta.season, week, entries, ownership, ageHours, stale,
        asOf: D.meta.captured,
        model: "One-week closed-form leverage: equity = P(win) × E[1/(1+survivors)], games independent, field mass survives by ownership share, E[1/(1+S)] by second-order Taylor. Win probabilities are the " + D.meta.captured + " snapshot blend (market 0.75 where a line existed). No future-value term: a team spent today is not priced against the weeks it could have covered — survivor.html's optimal-path view does that.",
        note: ownership === "modelled"
          ? "OWNERSHIP IS MODELLED (chalk softmax, exponent 2.4), not observed. A modelled ranking cannot see narrative picks and is wrong exactly where fading the field pays most. Post real pick data via /survivor-picks and this caveat disappears."
          : (stale ? "Posted ownership is over 72h old — treat as directional-only." : undefined),
        rows,
      });
    },
  },
  {
    name: "dd_analyze_matchup",
    description: "Elo-based read on any two NFL teams: rating gap, expected margin if hosted, win probability from the site's margin model, plus every 2026 scheduled meeting with the blended probability the survivor board uses. Ratings are a preseason snapshot and the payload names it.",
    inputSchema: {
      type: "object",
      properties: {
        home: { type: "string", description: "Hosting team — abbreviation or name" },
        away: { type: "string", description: "Visiting team — abbreviation or name" },
      },
      required: ["home", "away"],
      additionalProperties: false,
    },
    async run(args) {
      const D = await mcpSurvivor();
      const find = (q) => {
        const s = String(q || "").trim().toUpperCase();
        if (D.elo[s] != null) return s;
        const sl = s.toLowerCase();
        // exact name first, substring second — "cleveland", "browns", "hawks" all land
        for (const t in D.teams) {
          const m = D.teams[t];
          if ([m.n, m.loc, m.full].some(x => x && x.toLowerCase() === sl)) return t;
        }
        for (const t in D.teams) {
          const m = D.teams[t];
          if (sl.length >= 3 && [m.n, m.loc, m.full].some(x => x && x.toLowerCase().includes(sl))) return t;
        }
        return null;
      };
      const H = find(args.home), A = find(args.away);
      if (!H) return toolErr("Unknown team: " + args.home);
      if (!A) return toolErr("Unknown team: " + args.away);
      if (H === A) return toolErr("That is the same team twice.");
      const M = D.meta;
      const margin = (D.elo[H] - D.elo[A]) / M.elo_per_pt + M.hfa;
      const p = mcpNcdf(margin / M.sd);
      const meetings = D.games
        .filter(g => (g.h === H && g.a === A) || (g.h === A && g.a === H))
        .map(g => ({ week: g.wk, date: g.d, home: g.h, away: g.a, pHomeWin: g.p, src: g.src }));
      return toolText({
        home: { team: H, name: (D.teams[H] || {}).full, elo: D.elo[H] },
        away: { team: A, name: (D.teams[A] || {}).full, elo: D.elo[A] },
        eloGap: Math.round((D.elo[H] - D.elo[A]) * 10) / 10,
        expectedMarginAtHome: Math.round(margin * 100) / 100,
        pHomeWin: Math.round(p * 1e4) / 1e4,
        model: "expected_margin = (elo_home − elo_away) / " + M.elo_per_pt + " + " + M.hfa + " HFA; P(home) = Φ(margin / " + M.sd + "). Elo-only — no injuries, no rest, no weather. Ratings are the nfelo " + M.nfelo_sha + " snapshot captured " + M.captured + "; they do NOT update in-season here.",
        scheduledMeetings2026: meetings.length ? meetings : "none",
        note: meetings.length
          ? "Per-meeting pHomeWin is the survivor board's blend (market 0.75 where a line existed at capture) and can differ from the Elo-only number above."
          : undefined,
      });
    },
  },
  {
    name: "dd_convert_odds",
    description: "Convert user-supplied American odds to decimal odds and implied probability. Pure price arithmetic: no sportsbook feed, forecast, recommendation or stored input.",
    inputSchema: {
      type: "object",
      properties: {
        american_odds: { type: "number", description: "American price, <= -100 or >= +100." },
      },
      required: ["american_odds"],
      additionalProperties: false,
    },
    async run(args) {
      const american = mcpCalcAmerican(args.american_odds);
      const decimal = mcpCalcAmericanToDecimal(american);
      return toolText({
        american_odds: american,
        decimal_odds: decimal,
        implied_probability: 1 / decimal,
        read_only: true,
        note: "Deterministic price conversion only; the price is user-supplied and is not verified against a sportsbook.",
      });
    },
  },
  {
    name: "dd_elo_game",
    description: "Calculate one-game home and away win probabilities from caller-supplied Elo ratings and a caller-supplied home-field Elo adjustment. This is the transparent 538 Classic logistic equation, not a current team-state feed or forecast ledger.",
    inputSchema: {
      type: "object",
      properties: {
        home_elo: { type: "number", description: "Caller-supplied home-team Elo rating." },
        away_elo: { type: "number", description: "Caller-supplied away-team Elo rating." },
        home_field_elo: { type: "number", description: "Caller-supplied home-field Elo adjustment; 65 reproduces the calculator's historical default." },
      },
      required: ["home_elo", "away_elo", "home_field_elo"],
      additionalProperties: false,
    },
    async run(args) {
      const out = mcpCalcEloGame(args.home_elo, args.away_elo, args.home_field_elo);
      return toolText({
        home_elo: args.home_elo,
        away_elo: args.away_elo,
        home_field_elo: args.home_field_elo,
        ...out,
        read_only: true,
        note: "One-game calculator only. Published dated 2026 team states and ungraded prospective forecasts live separately at /data/538-classic.json; immutable normalized rows live at /data/model-receipts.json.",
      });
    },
  },
  {
    name: "dd_translate_probability",
    description: "MODELLED translation from caller-supplied home win probability to expected home margin, with optional home cover probability at a caller-supplied sportsbook line. Uses the published 0.5-point win threshold and continuous normal approximation.",
    inputSchema: {
      type: "object",
      properties: {
        home_win_probability: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1, description: "Caller-supplied home win probability strictly between 0 and 1." },
        residual_sd_points: { type: "number", exclusiveMinimum: 0, description: "Positive residual standard deviation in points; 13.18 is the dated Data Dawgs calculator default." },
        home_line: { type: "number", description: "Optional sportsbook home spread; a home favorite is negative, for example -3." },
      },
      required: ["home_win_probability", "residual_sd_points"],
      additionalProperties: false,
    },
    async run(args) {
      const out = mcpCalcNormalTranslation(args.home_win_probability, args.residual_sd_points, args.home_line);
      return toolText({
        home_win_probability: args.home_win_probability,
        ...out,
        modelled: true,
        read_only: true,
        note: "MODELLED continuous normal approximation with a 0.5-point win threshold, independent residuals, no NFL key-number mass and zero push probability when a line is supplied. No injuries, weather, rest or market feed is included.",
      });
    },
  },
  {
    name: "dd_devig_market",
    description: "Normalize a two-outcome market by proportional devig. Returns raw implied probabilities, hold and no-vig probabilities from user-supplied American prices; it does not fetch or validate a market.",
    inputSchema: {
      type: "object",
      properties: {
        side_a_american: { type: "number", description: "Side A American price, <= -100 or >= +100." },
        side_b_american: { type: "number", description: "Side B American price, <= -100 or >= +100." },
      },
      required: ["side_a_american", "side_b_american"],
      additionalProperties: false,
    },
    async run(args) {
      const out = mcpCalcHoldVig(args.side_a_american, args.side_b_american);
      return toolText({
        ...out,
        devig_method: "proportional normalization",
        read_only: true,
        note: "User-entered two-outcome prices; no timestamped or licensed market feed is attached.",
      });
    },
  },
  {
    name: "dd_price_parlay",
    description: "Multiply user-supplied American leg prices into a combined parlay price and price-implied probability. This is price arithmetic, not a correlation-aware joint outcome model.",
    inputSchema: {
      type: "object",
      properties: {
        american_odds: {
          type: "array", minItems: 1, maxItems: 20,
          items: { type: "number" },
          description: "One to twenty American prices; every value must be <= -100 or >= +100.",
        },
      },
      required: ["american_odds"],
      additionalProperties: false,
    },
    async run(args) {
      const out = mcpCalcParlay(args.american_odds);
      return toolText({
        leg_american_odds: out.legs,
        decimal_odds: out.decimal,
        american_odds: out.american,
        implied_probability: out.implied_probability,
        read_only: true,
        note: "Multiplies listed prices only. It does not estimate leg correlation or a true joint win probability.",
      });
    },
  },
  {
    name: "dd_calculate_bet_ev",
    description: "Compute break-even probability, expected profit per unit and ROI from a caller-supplied win probability and American price. The probability is not generated or validated by Data Dawgs.",
    inputSchema: {
      type: "object",
      properties: {
        win_probability: { type: "number", minimum: 0, maximum: 1, description: "Caller-supplied probability from 0 to 1." },
        american_odds: { type: "number", description: "American price, <= -100 or >= +100." },
      },
      required: ["win_probability", "american_odds"],
      additionalProperties: false,
    },
    async run(args) {
      const out = mcpCalcBetEv(args.win_probability, args.american_odds);
      return toolText({
        ...out,
        win_probability: args.win_probability,
        american_odds: args.american_odds,
        read_only: true,
        note: "Arithmetic on a caller-supplied probability, not an independently graded edge or betting recommendation.",
      });
    },
  },
  {
    name: "dd_calculate_hedge",
    description: "Size the opposite side so the two net outcomes are equal, using a user-supplied original stake and two American prices. Ignores limits, taxes, execution risk and market movement.",
    inputSchema: {
      type: "object",
      properties: {
        original_stake: { type: "number", exclusiveMinimum: 0, description: "Positive original stake." },
        original_american: { type: "number", description: "Original American price, <= -100 or >= +100." },
        hedge_american: { type: "number", description: "Opposite-side American price, <= -100 or >= +100." },
      },
      required: ["original_stake", "original_american", "hedge_american"],
      additionalProperties: false,
    },
    async run(args) {
      const out = mcpCalcHedge(args.original_stake, args.original_american, args.hedge_american);
      return toolText({
        ...out,
        read_only: true,
        note: "Equal-net-outcome arithmetic only; no bet is placed and no input is stored.",
      });
    },
  },
  {
    name: "dd_nfl_passer_rating",
    description: "Compute the official-style NFL passer rating from a complete passing line. Descriptive statistic only: not QBR, EPA or a forecast.",
    inputSchema: {
      type: "object",
      properties: {
        attempts: { type: "integer", minimum: 1 },
        completions: { type: "integer", minimum: 0 },
        yards: { type: "integer", description: "Whole-number passing yards; legitimate negative totals are accepted." },
        touchdowns: { type: "integer", minimum: 0 },
        interceptions: { type: "integer", minimum: 0 },
      },
      required: ["attempts", "completions", "yards", "touchdowns", "interceptions"],
      additionalProperties: false,
    },
    async run(args) {
      const out = mcpCalcPasserRating(args.attempts, args.completions, args.yards, args.touchdowns, args.interceptions);
      return toolText({
        nfl_passer_rating: out.rating,
        components: out.components,
        read_only: true,
        note: "NFL passer-rating formula only; this is not QBR, EPA or a performance forecast.",
      });
    },
  },
  {
    name: "dd_score_forecast",
    description: "Score one declared binary forecast with Brier score and log loss. One observation is not evidence of model skill; nothing is added to a receipt ledger or leaderboard.",
    inputSchema: {
      type: "object",
      properties: {
        forecast_probability: { type: "number", minimum: 0, maximum: 1 },
        outcome_0_or_1: { type: "integer", enum: [0, 1] },
      },
      required: ["forecast_probability", "outcome_0_or_1"],
      additionalProperties: false,
    },
    async run(args) {
      const out = mcpCalcForecastGrade(args.forecast_probability, args.outcome_0_or_1);
      return toolText({
        ...out,
        read_only: true,
        graded_track_record: false,
        note: "One caller-supplied observation. It is not stored, immutable, prospective or comparable to a leaderboard sample.",
      });
    },
  },
  {
    name: "dd_summarize_beliefs",
    description: "Return equal-weight descriptive statistics for caller-supplied probabilities: mean, median, range, standard deviation and whether values cross 50%. Not a validated consensus blend.",
    inputSchema: {
      type: "object",
      properties: {
        probabilities: {
          type: "array", minItems: 1, maxItems: 100,
          items: { type: "number", minimum: 0, maximum: 1 },
          description: "One to one hundred probabilities from 0 to 1.",
        },
      },
      required: ["probabilities"],
      additionalProperties: false,
    },
    async run(args) {
      const out = mcpCalcBeliefSummary(args.probabilities);
      return toolText({
        ...out,
        read_only: true,
        note: "Equal-weight descriptive summary only; this is not a validated consensus blend or confidence score.",
      });
    },
  },
  {
    name: "dd_scores",
    description: "ESPN scoreboard proxy (sport + optional YYYYMMDD dates). ⚠️ ESPN sometimes refuses Cloudflare egress; if this tool reports unavailable, the scoreboard is still readable in a browser at espn.com.",
    inputSchema: {
      type: "object",
      properties: {
        sport: { type: "string", enum: ["nfl", "cfb", "nba", "cbb", "mlb", "nhl"], description: "Sport key" },
        dates: { type: "string", description: "YYYYMMDD or YYYYMMDD-YYYYMMDD (optional)" },
      },
      required: ["sport"],
      additionalProperties: false,
    },
    async run(args) {
      if (!LEAGUE[args.sport]) return toolErr("unknown sport");
      // ⚠️ handleScores takes sport and dates via searchParams — not season/week.
      const u = new URL("https://mcp.internal/scores");
      u.searchParams.set("sport", args.sport);
      if (args.dates) u.searchParams.set("dates", args.dates);
      const resp = await handleScores(u, {});
      const data = await resp.json();
      if (!resp.ok) return toolErr("Scores unavailable from this Worker (" + (data.detail || data.error || resp.status) + "). Read the scoreboard directly at espn.com.");
      return toolText(data);
    },
  },
  {
    name: "dd_dfs_correlations",
    description: "The site's within-game DFS correlation structure (same-team and opponent role×role matrices plus CV-by-projection tables), estimated from public nflverse data, 2019-2025 regular seasons. League-average structure — not this specific game.",
    inputSchema: MCP_NO_ARGS,
    async run() {
      if (!mcpCorrCache.data || Date.now() - mcpCorrCache.at > 3600e3) {
        const r = await fetch(`${SITE}/dfs.html`, { cf: { cacheTtl: 3600, cacheEverything: true } });
        if (!r.ok) return toolErr("dfs.html unavailable: HTTP " + r.status);
        const html = await r.text();
        const tag = "const CORR = ";
        const i = html.indexOf(tag);
        if (i < 0) return toolErr("Correlation matrix not found in dfs.html — the page layout changed.");
        const j = html.indexOf("};", i);
        if (j < 0) return toolErr("Correlation matrix not parseable — the page layout changed.");
        let corr;
        try { corr = JSON.parse(html.slice(i + tag.length, j + 1)); }
        catch (e) { return toolErr("Correlation matrix not parseable: " + e.message); }
        mcpCorrCache = { at: Date.now(), data: corr };
      }
      return toolText(mcpCorrCache.data);
    },
  },
  {
    name: "dd_solve_dfs_lineup",
    description: "Build one to twenty DraftKings Classic or Showdown lineups with the exact branch-and-bound solver used by dfs.html. Every salary, projection and ownership value must be supplied in this call; Data Dawgs has no projection feed, stores nothing, and returns the applied constraints plus explicit infeasibility or timeout state.",
    inputSchema: {
      type: "object",
      properties: {
        players: {
          type: "array", minItems: 1, maxItems: MCP_DFS_MAX_PLAYERS,
          description: "Caller-supplied slate. Omit players with no usable projection or set exclude=true.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", minLength: 1, maxLength: 80, description: "Unique stable player id for this call." },
              name: { type: "string", minLength: 1, maxLength: 100 },
              position: { type: "string", enum: ["QB", "RB", "WR", "TE", "DST"] },
              team: { type: "string", minLength: 1, maxLength: 12 },
              opponent: { type: "string", minLength: 1, maxLength: 12 },
              game_id: { type: "string", minLength: 1, maxLength: 80, description: "Same value for every player in one game." },
              salary: { type: "integer", minimum: 100, maximum: 50000, multipleOf: 100 },
              projection: { type: "number", minimum: 0, maximum: 100, description: "Caller-supplied DraftKings points projection." },
              ownership: { type: "number", minimum: 0, maximum: 100, description: "Optional caller-supplied projected ownership percentage." },
              lock: { type: "boolean", description: "Force into every lineup." },
              exclude: { type: "boolean", description: "Remove from the eligible pool." },
              max_exposure: { type: "number", minimum: 0, maximum: 1, description: "Maximum lineup share from 0 to 1." },
            },
            required: ["id", "name", "position", "team", "opponent", "game_id", "salary", "projection"],
            additionalProperties: false,
          },
        },
        site: { type: "string", enum: ["dk_classic", "dk_showdown"], description: "Default dk_classic." },
        count: { type: "integer", minimum: 1, maximum: MCP_DFS_MAX_LINEUPS, description: "Lineups requested; default 1." },
        min_salary: { type: "integer", minimum: 0, maximum: 50000, multipleOf: 100, description: "Default 0." },
        max_salary: { type: "integer", minimum: 100, maximum: 50000, multipleOf: 100, description: "Default 50000." },
        unique_players: { type: "integer", minimum: 0, maximum: 9, description: "Minimum differing players between returned lineups; default 2 for multi-lineup Classic and 1 for Showdown." },
        randomness: { type: "number", minimum: 0, maximum: 0.6, description: "Seeded projection jitter as a decimal. Default 0 for a deterministic optimum." },
        seed: { type: "integer", minimum: 1, maximum: 2147483647, description: "Reproducible random seed; default 1." },
        max_per_team: { type: "integer", minimum: 1, maximum: 9 },
        max_per_game: { type: "integer", minimum: 1, maximum: 9 },
        time_limit_ms: { type: "integer", minimum: 100, maximum: MCP_DFS_MAX_TIME_MS, description: "Bounded solve deadline; default 2000, maximum 3000." },
        stack: {
          type: "object",
          properties: {
            qb_min: { type: "integer", minimum: 0, maximum: 3, description: "Required QB teammates from qb_positions." },
            qb_positions: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: { type: "string", enum: ["RB", "WR", "TE"] } },
            bring_back: { type: "integer", minimum: 0, maximum: 3, description: "Required non-DST opponent players with the QB." },
            no_rb_vs_dst: { type: "boolean" },
            no_opp_dst: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
      required: ["players"],
      additionalProperties: false,
    },
    async run(args) {
      return toolText(mcpDfsSolve(args));
    },
  },
  {
    name: "dd_guillotine_odds",
    description: "Survival odds for every team in a Sleeper guillotine league, plus the projected chop line — who is most likely to be eliminated this week. Built ONLY from that league's own completed weeks. ⚠️ Needs at least two completed weeks; with fewer it returns the roster and says so rather than inventing a probability.",
    inputSchema: {
      type: "object",
      properties: {
        league_id: { type: "string", description: "Sleeper league id — the long number in the league URL." },
        team: { type: "string", description: "Optional: a team or manager name to highlight." },
        sims: { type: "integer", description: "Monte Carlo runs. Default 20000, max 50000." },
      },
      required: ["league_id"],
      additionalProperties: false,
    },
    async run(args, env, caller) {
      const id = String(args.league_id || "").replace(/[^0-9]/g, "");
      if (!id) return toolErr("A Sleeper league id is required — it is the long number in the league URL.");
      const SIMS = Math.min(Math.max(parseInt(args.sims, 10) || 20000, 1000), 50000);
      const API = "https://api.sleeper.app/v1";

      // ⚠️ /players/nfl is deliberately NOT fetched — ~5MB, and Sleeper's own docs say to
      // pull it at most once a day. Names come from /users + /rosters, scores from
      // /matchups. The page has always worked this way and so does this.
      const get = async (path) => {
        const r = await fetch(API + path, { cf: { cacheTtl: 300, cacheEverything: true } });
        if (!r.ok) throw new Error("Sleeper " + path + " returned " + r.status);
        return r.json();
      };

      let state, league, users, rosters;
      try {
        [state, league, users, rosters] = await Promise.all([
          get("/state/nfl"), get("/league/" + id), get("/league/" + id + "/users"), get("/league/" + id + "/rosters"),
        ]);
      } catch (e) { return toolErr("Could not read that league from Sleeper: " + e.message); }
      if (!league || !league.name) return toolErr("No Sleeper league with id " + id + ".");

      const uname = {};
      for (const u of users || []) uname[u.user_id] = (u.metadata && u.metadata.team_name) || u.display_name || "?";
      const owner = {};
      for (const u of users || []) owner[u.user_id] = u.display_name || "?";

      // Sleeper's /state/nfl `week` is the week IN PROGRESS, so completed = week - 1.
      const completed = Math.max(0, (parseInt(state && state.week, 10) || 0) - 1);

      const scores = {};   // roster_id -> [week scores]
      for (let w = 1; w <= completed; w++) {
        let mm;
        try { mm = await get("/league/" + id + "/matchups/" + w); } catch { continue; }
        for (const m of mm || []) {
          if (m && m.roster_id != null && typeof m.points === "number")
            (scores[m.roster_id] = scores[m.roster_id] || []).push(m.points);
        }
      }

      const teams = (rosters || []).map(r => {
        const xs = scores[r.roster_id] || [];
        const n = xs.length;
        const mean = n ? xs.reduce((a, b) => a + b, 0) / n : 0;
        // sample sd, n-1 — identical to the page's stats()
        const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1)) : 0;
        return {
          rosterId: r.roster_id,
          team: uname[r.owner_id] || ("Roster " + r.roster_id),
          manager: owner[r.owner_id] || "?",
          weeks: n, mean: +mean.toFixed(2), sd: +sd.toFixed(2),
          last: n ? xs[n - 1] : null, low: n ? Math.min(...xs) : null,
        };
      });

      const base = {
        league: league.name, season: league.season, leagueId: id,
        completedWeeks: completed, teamCount: teams.length, teams,
      };

      // ⚠️ Two completed weeks is the floor. One week gives a mean and no spread, and a
      // survival probability without a spread is a coin flip wearing a lab coat. The page
      // refuses here too — this must not quietly return 1/n.
      const usable = teams.filter(t => t.weeks >= 2);
      if (completed < 2 || usable.length < 2)
        return toolText({
          ...base, survivalAvailable: false,
          why: "Survival needs at least two completed weeks — one week gives a mean with no spread, and a probability without a spread is not a probability. The league, its teams and its managers are above; the odds are not computed.",
        });

      // Monte Carlo, same estimator as guillotine.html: draw a week for every live team,
      // find who is lowest, repeat. Survival = share of runs in which you are NOT lowest.
      // The distribution of the weekly minimum IS the chop line.
      let seed = 0x9e3779b9 ^ (completed * 2654435761) ^ (teams.length * 40503);
      const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      let spare = null;
      const gauss = () => {
        if (spare !== null) { const v = spare; spare = null; return v; }
        let u, v2, s2;
        do { u = rnd() * 2 - 1; v2 = rnd() * 2 - 1; s2 = u * u + v2 * v2; } while (s2 >= 1 || s2 === 0);
        const m = Math.sqrt(-2 * Math.log(s2) / s2); spare = v2 * m; return u * m;
      };

      const k = usable.length, lose = new Array(k).fill(0), mins = new Float64Array(SIMS);
      for (let i = 0; i < SIMS; i++) {
        let lo = Infinity, li = -1;
        for (let j = 0; j < k; j++) {
          const x = usable[j].mean + gauss() * usable[j].sd;
          if (x < lo) { lo = x; li = j; }
        }
        lose[li]++; mins[i] = lo;
      }
      const sorted = Array.from(mins).sort((a, b) => a - b);
      const chop = sorted[Math.floor(SIMS * 0.5)];

      const ranked = usable.map((t, j) => ({
        ...t,
        survival: +(1 - lose[j] / SIMS).toFixed(4),
        chopRisk: +(lose[j] / SIMS).toFixed(4),
        marginOverChop: +(t.mean - chop).toFixed(1),
      })).sort((a, b) => a.survival - b.survival);

      const want = args.team ? String(args.team).toLowerCase() : null;
      const highlighted = want
        ? ranked.find(t => t.team.toLowerCase().includes(want) || t.manager.toLowerCase().includes(want)) || null
        : null;

      return toolText({
        ...base, survivalAvailable: true, sims: SIMS,
        projectedChopLine: +chop.toFixed(1),
        mostAtRisk: ranked[0] ? { team: ranked[0].team, manager: ranked[0].manager, survival: ranked[0].survival } : null,
        teams: ranked,
        highlighted,
        // ⚠️ Never default to a team the user did not name. Returning someone else's
        // number as "yours" is the failure this page was explicitly fixed for.
        note: want && !highlighted ? "No team or manager matched '" + args.team + "'." : undefined,
        caveats: [
          "Built from this league's own completed weekly scores and nothing else — no projections, no rankings, no ADP.",
          "Scores are drawn NORMAL and INDEPENDENT across teams. Real weeks are neither.",
          "It cannot see a bye week, an injury, a favourable matchup, or a roster change made after the last completed week.",
          "Survival is the share of simulated weeks in which a team is NOT the lowest scorer; the chop line is the median simulated minimum.",
          "With only " + completed + " completed week" + (completed === 1 ? "" : "s") + ", the standard deviations are estimated from a very small sample — early-season numbers move a lot.",
        ],
      });
    },
  },
  {
    name: "dd_site_map",
    description: "What Data Dawgs publishes, where the machine-readable surfaces live, and — explicitly — what is NOT served here and why.",
    inputSchema: MCP_NO_ARGS,
    async run() {
      return toolText({
        site: SITE,
        machine: {
          index: "/llms.txt",
          surfaces: "/data/surfaces.json — every human page, its machine equivalent, and an honest live|planned|none status. Check it before claiming a route exists.",
          data: ["/data/pool.json", "/data/receipts.json", "/data/models.json", "/data/epa-teams.json", "/data/nfelo.json", "/data/league.json", "/data/bozo-rules.json", "/data/survivor.json", "/data/pound-tools.json", "/data/model-contracts.json", "/data/upstream-models.json", "/data/nfl-schedule.json", "/data/538-classic.json", "/data/model-receipts.json", "/data/index.json"],
        },
        pages: {
          "index.html": "Home — what Data Dawgs is and the working-dawg taxonomy (Labs / Dawgs / The Pound).",
          "bigboard.html": "Draft big board over the MV pool.",
          "auction.html": "Auction draft operator (league passphrase gate).",
          "board.html": "Live draft board — mirrors the auction via Firebase.",
          "strategy.html": "Draft strategy digest (dated).",
          "stats.html": "NFL EPA stats explorer.",
          "dataviz.html": "Data visualisations.",
          "bozo.html": "The Bozo weekly parlay game.",
          "survivor.html": "Survivor pool EV tools.",
          "receipts.html": "272 pre-registered 2026 forecasts, SHA-256 locked.",
          "dfs.html": "DFS lineup lab; the exact lineup solver is also callable through dd_solve_dfs_lineup with a bounded caller-supplied slate.",
          "pound.html": "The Pound model workbench, deterministic calculators, contracts and honest tool-status inventory.",
        },
        notServedHere: {
          dfs_projections_and_ownership: "Never hosted or persisted, by design. The browser slate stays in that user's localStorage. dd_solve_dfs_lineup accepts a bounded slate transiently in one authenticated call, computes, returns, and stores neither inputs nor results.",
          epa_stats: "The 2.1MB dataset is embedded in stats.html; parsing it per call is a poor fit for a Worker. Browse the page directly.",
        },
      });
    },
  },
];
/* ===== DD-MCP-BLOCK END ===== */
