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
 *   POST /bozo/config  — league-manager dials: the legal-bet price band (admin)
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
    "Access-Control-Allow-Headers": "Content-Type, X-Dawg-Pass, X-Bozo-Session",
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
  const sess = await readSession(env, request.headers.get("X-Bozo-Session") || "");
  if (!sess) return { err: "Sign in first.", code: 401 };
  const players = Object.values(map);
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
    const setAt = Date.now();
    await fbPut(env, authPath(name), { v: 1, salt, hash, iters: PBKDF2_ITERS, setAt });
    return json({ ok: true, name, session: await makeSession(env, name, setAt) }, 200, cors);
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
    return json({ ok: true, name, session: await makeSession(env, name, rec.setAt || 0) }, 200, cors);
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
  const auth = await requireAdmin(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

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
    await fbPatch(env, "/bozo/config", { bandCeil: ceil, bandFloor: floor, updatedTs: Date.now(), updatedBy: auth.name });
    return json({ ok: true, bandCeil: ceil, bandFloor: floor }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
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
    const err = validatePick(p, name, state.picks || {}, bandOf(state));
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
      placed = await placeAndDraw(env, picks, state);
    }
    return json({ ok: true, ts: pick.ts, placed }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}

function validatePick(p, name, existing, band) {
  if (!LEAGUE[p.sport]) return "Unknown sport.";
  if (!MARKETS.includes(p.mkt)) return "Unknown market.";
  if (!p.eventId || !p.game) return "Pick a game.";
  if (!p.label || !p.side) return "Incomplete pick.";
  const price = Number(p.price);
  if (!isFinite(price) || price > band.ceil || price < band.floor)
    return `${p.price} is outside the ${band.ceil} to ${band.floor} band.`;
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
async function placeAndDraw(env, picks, state) {
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

  // ⚠️ The ledger is written HERE, at lock — not at grade, and not in bozoNext. A week
  // that locks but never gets graded must still leave a complete record of the entry.
  await ledgerWriteEntries(env, (state && state.season) || SEASON, (state && state.week) || 1, picks, order);
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
function ledgerEntries(season, week, picks, order) {
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
      season, week, player: playerName(n),
      sport: x.sport, eventId: x.eventId, game: x.game,
      mkt: x.mkt, side: x.side, dir: x.dir,
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
async function ledgerWriteEntries(env, season, week, picks, order) {
  try {
    await fbPatch(env, "/bozo/ledger", ledgerEntries(season, week, picks, order));
    return true;
  } catch (e) {
    console.log("ledger: entry write failed — " + e.message);
    return false;
  }
}

// Idempotent by construction: writes only rows that are absent, so it can never clobber
// a field a later stage already patched in.
async function ledgerBackfill(env, state) {
  const picks = state.picks || {};
  if (!Object.keys(picks).length) return false;
  let have = {};
  try { have = (await fbGet(env, "/bozo/ledger")).data || {}; }
  catch (e) { console.log("ledger: backfill read failed — " + e.message); return false; }

  const rows = ledgerEntries(state.season || SEASON, state.week || 1, picks, state.order || null);
  const missing = {};
  for (const k of Object.keys(rows)) if (!have[k]) missing[k] = rows[k];
  if (!Object.keys(missing).length) return false;

  try { await fbPatch(env, "/bozo/ledger", missing); return true; }
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
  const auth = await requireAdmin(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  try {
    const state = (await fbGet(env, "/bozo")).data || {};
    const status = state.status;
    if (status !== "placed" && status !== "graded")
      return json({ error: "Nothing to grade — ticket isn't placed." }, 409, cors);

    if (body.results && typeof body.results === "object")
      await fbPut(env, "/bozo/results", body.results);
    if (body.bozo !== undefined) await fbPut(env, "/bozo/bozo", body.bozo);
    if (body.bozoWhy !== undefined) await fbPut(env, "/bozo/bozoWhy", String(body.bozoWhy).slice(0, 200));

    // Ledger last, before the status flip: if it fails the admin gets a 502, status is
    // still "placed", and hitting Decide again replays the whole thing idempotently.
    const backfilled = await ledgerBackfill(env, state);
    const upd = ledgerGradeUpdate(state.season || SEASON, state.week || 1, body.results, body.bozo, state.picks);
    if (Object.keys(upd).length) await fbPatch(env, "/bozo/ledger", upd);

    if (body.graded) await fbPut(env, "/bozo/status", "graded");
    return json({ ok: true, backfilled }, 200, cors);
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

    // ⚠️ PATCH, not PUT. A wholesale PUT of /bozo replaces the whole node, which under
    // the write-at-lock ledger would delete /bozo/ledger every single week — the site
    // whose thesis is "the receipts stay up" quietly shredding its receipts. The nulls
    // clear this week's children explicitly; anything not named here survives, so a
    // node added later can't be silently destroyed the same way.
    await fbPatch(env, "/bozo", {
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
