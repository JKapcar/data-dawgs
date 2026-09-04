import { BOZO_ESPN_TEAM_SEED } from "./bozo-team-registry.mjs";

/**
 * toto Worker — Dawg Bot proxy + Bozo trust layer
 * -----------------------------------------------
 * datadawgs216.com is a static site in a PUBLIC repo, so nothing secret can live
 * in a page. This Worker holds every secret and does every privileged write.
 *
 * ROUTES
 *   POST /             — Dawg Bot chat proxy. Accepts a site session (preferred, gives
 *                        a per-user rate bucket) OR the shared DAWG_PASS (fallback).
 *   GET  /scores       — NFL/CFB schedule-score cache from nflverse/cfbfastR in KV.
 *                        The page may enhance this with browser-side ESPN.
 *   GET  /bozo/roster  — player list + who has claimed a password (public)
 *   POST /bozo/claim   — spend a one-time join token, set your own password
 *   POST /bozo/login   — name + password  → session
 *   POST /bozo/passwd  — change your own password (session)
 *   POST /bozo/pick    — submit / edit / remove a leg (session)
 *   POST /bozo/grade   — preview/confirm schedule-backed results + verdict (manager)
 *   POST /bozo/next    — archive week, open the next (admin session)
 *   POST /bozo/reset   — admin clears a player's password so their original
 *                        join link works again (the no-email recovery path)
 *   POST /bozo/config  — alias of /league/config
 *
 * BOZO IS MULTI-LEAGUE. Several groups, each with its OWN roster size, band, week,
 * picks and ledger, at /bozo/leagues/<id> (under /bozo, so it inherits the public-read
 * rule — no rules change). Every Bozo route takes an optional {league}; absent means
 * "main", so pre-league callers keep working.
 *   GET  /league/list    — public leagues + signed-in member/manager leagues
 *   POST /league/create  — SITE ADMIN only: {id, name, manager, password}
 *   POST /league/search  — signed-in league directory, capped at 20 results
 *   POST /league/join    — signed-in membership via {league, password}
 *   POST /league/access  — manager: password, cap and public/private visibility
 *   POST /league/member  — manager removal only; members add themselves with password
 *   POST /league/lock    — manager: force-place when someone never submits
 *   POST /league/slip    — any member: publish the week's DraftKings betslip link
 *   POST /league/config  — manager: the price band for that league
 *   POST /league/settings — manager: name, manager, stake, allowDupes, allowEdit,
 *                          lockRule/lockCount, levers, band — the whole rules panel
 *   POST /league/team    — manager: {player, team} display name inside this league
 * ⚠️ The lock threshold is THAT LEAGUE'S member count, never the global roster.
 *
 * Universal UID leagues share /league/create and /league/join through explicit v2
 * request shapes, plus GET /league/mine and PUT /league/gate. They live under the
 * default-deny /leagues branch and use append-only events for shared changes.
 *
 * IDENTITY IS SITE-WIDE. The auth routes answer on BOTH /auth/* and /bozo/*:
 *   GET  /auth/roster  POST /auth/claim  /auth/login  /auth/passwd  /auth/reset
 *   POST /auth/invite  — admin re-issues a join link (returns the raw token ONCE)
 *   POST /auth/signup  — OPEN SIGNUP (8/7): {name, email, password} creates a
 *     site-wide account, no invite. An account is NOT a league seat — membership
 *     requires the league password or a manager add. The only unauthenticated write;
 *     IP-capped.
 *   POST /auth/lookup — bounded email-first account lookup
 *   POST /auth/email-confirm — proves a new primary address before switching login
 *   GET/PUT /auth/draft-state — private UID scratch state with ETag-backed CAS
 * New accounts are keyed by immutable UID; lowercase email is unique and display names
 * are mutable/non-unique. Legacy name-keyed records remain readable until the approved wipe.
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
    // X-DD-Bot is a forecast-challenge bot credential (FC-C). It is listed here so a
    // browser-side bot test preflights, and it is accepted on POST /forecast/entry and
    // NOWHERE else — that scoping lives in the route table, not in a handler branch.
    // X-DD-Admin is the Dog Track admin key rankings-admin.html sends on every call.
    // Advertising it here is preflight permission, never authorization — the rankings
    // block still checks it, and an unrecognised header on this list grants nothing.
    "Access-Control-Allow-Headers": "Content-Type, X-Dawg-Pass, X-Bozo-Session, X-Dawg-Session, X-DD-Bot, X-DD-Admin",
    // PUT is load-bearing for /auth/draft-state. application/json plus the session
    // header makes that browser request preflight; omitting PUT here produces a
    // silent client-side "Failed to fetch" before the route ever runs.
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
    // A session older than seven days is rotated on any authenticated request. Pages
    // must be allowed to read the replacement without exposing any other header.
    "Access-Control-Expose-Headers": "X-Dawg-Session",
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

/* ======================= Personal draft-state contract ================== */
// Shared inside the Worker by draft-state validation and every universal draft-league
// create path. Browser minting carries the same source string in draft-league.js, and
// the contract suite asserts they stay identical.
const DRAFT_LEAGUE_ID_PATTERN = "^(dd_[A-Za-z0-9_-]{22,64}|pepperoninipples)$";
const DRAFT_LEAGUE_ID_RE = new RegExp(DRAFT_LEAGUE_ID_PATTERN);
const DRAFT_STATE_MAX_BYTES = 65_536;
const DRAFT_PLAYER_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const DRAFT_POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "DST", "K"];
// Keep this in step with board.html's actual sortable columns. The test reads both
// declarations so a post-refresh column rename cannot silently strand saved filters.
// "lg" is the pepperoninipples league-adjusted value column (board.html's league
// profile); a saved sort on it must survive the round trip like any other column.
/* ⚠️ MIRRORS THE RIG'S sortable:true COLUMNS IN board.html, and work/test-draft-state.mjs
   asserts the two sets are equal. The four-source cheat sheet added dd/espn/pff/fp and
   retired lg; this list was not updated with it, so the contract test broke on main.
   Change both sides in the same commit or the Worker rejects a sort the page offers. */
const DRAFT_SORT_KEYS = ["rank", "name", "pos", "team", "half14", "half", "full", "sfhalf12", "sf", "silva", "dd", "espn", "pff", "fp"];
const DRAFT_SORT_DIRECTIONS = ["asc", "desc"];
const DRAFT_MARKS = ["target", "taken"];
const DRAFT_EMPTY_STATE = Object.freeze({
  filters: Object.freeze({
    query: "", position: "ALL", hideTaken: false, taggedOnly: false,
    sort: Object.freeze({ key: "rank", direction: "asc" }),
  }),
  marks: Object.freeze([]),
  keeperIds: Object.freeze([]),
});

/* ==================== Personal guillotine-state contract ==================
 * This is a private convenience shelf, not league ownership. A signed-in user
 * may remember Sleeper league IDs and a focus roster for each one. The focus
 * choice is deliberately unverified: Sleeper's public API cannot prove that the
 * Data Dawgs account controls that roster. The UID always comes from sessionAuth;
 * accepting one in the body would create a cross-account write primitive. */
const GUILLOTINE_STATE_MAX_BYTES = 16_384;
const GUILLOTINE_LEAGUE_ID_RE = /^\d{6,24}$/;
const GUILLOTINE_MAX_LEAGUES = 24;

function validateGuillotineState(input) {
  const bad = (field, message) => ({ ok: false, field, message });
  if (!draftExactKeys(input, ["leagues"]))
    return bad("/", "State must contain exactly leagues.");
  if (!Array.isArray(input.leagues) || input.leagues.length > GUILLOTINE_MAX_LEAGUES)
    return bad("/leagues", "leagues must be an array with at most 24 entries.");
  const seen = new Set(), leagues = [];
  for (let i = 0; i < input.leagues.length; i++) {
    const item = input.leagues[i];
    if (!draftExactKeys(item, ["leagueId", "focusRosterId"]))
      return bad(`/leagues/${i}`, "Each league must contain exactly leagueId and focusRosterId.");
    const leagueId = String(item.leagueId || "");
    if (!GUILLOTINE_LEAGUE_ID_RE.test(leagueId))
      return bad(`/leagues/${i}/leagueId`, "Sleeper league IDs must contain 6 to 24 digits.");
    if (seen.has(leagueId)) return bad(`/leagues/${i}/leagueId`, "League IDs must be unique.");
    seen.add(leagueId);
    const focus = item.focusRosterId;
    if (focus !== null && (!Number.isSafeInteger(focus) || focus < 1 || focus > 1000))
      return bad(`/leagues/${i}/focusRosterId`, "focusRosterId must be null or a positive integer.");
    leagues.push({ leagueId, focusRosterId: focus });
  }
  return { ok: true, state: { leagues } };
}

// Reads tolerate what writes refuse. Shelf records written before validateGuillotineState
// existed (older guillotine.html stored display names alongside the IDs) fail the strict
// check, and a GET that 502s on them bricks account sync on every device until someone
// hand-edits Firebase. Instead: keep each entry that can be coerced to the current shape,
// drop what cannot, and let the client's next save PUT the clean form back. PUT stays strict.
function salvageGuillotineState(input) {
  const rows = input && typeof input === "object" && !Array.isArray(input) && Array.isArray(input.leagues) ? input.leagues : [];
  const seen = new Set(), leagues = [];
  for (const item of rows) {
    if (leagues.length >= GUILLOTINE_MAX_LEAGUES) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const leagueId = String(item.leagueId || "");
    if (!GUILLOTINE_LEAGUE_ID_RE.test(leagueId) || seen.has(leagueId)) continue;
    seen.add(leagueId);
    const focus = Number(item.focusRosterId);
    leagues.push({ leagueId, focusRosterId: Number.isSafeInteger(focus) && focus >= 1 && focus <= 1000 ? focus : null });
  }
  return { leagues };
}

function mintDraftLeagueId(cryptoImpl) {
  const source = cryptoImpl || crypto;
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  return "dd_" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

const draftError = (cors, status, error, message, extra) =>
  json({ ok: false, error, message, ...(extra || {}) }, status, cors);

function draftExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((key, i) => key === wanted[i]);
}

function draftUnicodeLength(value) {
  return Array.from(value).length;
}

function validateDraftState(input) {
  const bad = (field, message) => ({ ok: false, field, message });
  if (!draftExactKeys(input, ["filters", "marks", "keeperIds"]))
    return bad("/state", "state must contain exactly filters, marks and keeperIds.");

  const filters = input.filters;
  if (!draftExactKeys(filters, ["query", "position", "hideTaken", "taggedOnly", "sort"]))
    return bad("/state/filters", "filters contains missing or unsupported fields.");
  if (typeof filters.query !== "string") return bad("/state/filters/query", "query must be a string.");
  const query = filters.query.normalize("NFC");
  if (draftUnicodeLength(query) > 80 || /[\u0000-\u001f\u007f]/.test(query))
    return bad("/state/filters/query", "query must be at most 80 characters and contain no control characters.");
  if (!DRAFT_POSITIONS.includes(filters.position))
    return bad("/state/filters/position", "position is not supported.");
  if (typeof filters.hideTaken !== "boolean")
    return bad("/state/filters/hideTaken", "hideTaken must be boolean.");
  if (typeof filters.taggedOnly !== "boolean")
    return bad("/state/filters/taggedOnly", "taggedOnly must be boolean.");
  if (!draftExactKeys(filters.sort, ["key", "direction"]))
    return bad("/state/filters/sort", "sort must contain exactly key and direction.");
  if (!DRAFT_SORT_KEYS.includes(filters.sort.key))
    return bad("/state/filters/sort/key", "sort key is not supported.");
  if (!DRAFT_SORT_DIRECTIONS.includes(filters.sort.direction))
    return bad("/state/filters/sort/direction", "sort direction must be asc or desc.");

  if (!Array.isArray(input.marks) || input.marks.length > 512)
    return bad("/state/marks", "marks must be an array of at most 512 entries.");
  const markIds = new Set();
  const marks = [];
  for (let i = 0; i < input.marks.length; i++) {
    const mark = input.marks[i];
    if (!draftExactKeys(mark, ["playerId", "mark"]))
      return bad(`/state/marks/${i}`, "each mark must contain exactly playerId and mark.");
    if (typeof mark.playerId !== "string" || !DRAFT_PLAYER_ID_RE.test(mark.playerId))
      return bad(`/state/marks/${i}/playerId`, "playerId is invalid.");
    if (!DRAFT_MARKS.includes(mark.mark))
      return bad(`/state/marks/${i}/mark`, "mark must be target or taken.");
    if (markIds.has(mark.playerId))
      return bad(`/state/marks/${i}/playerId`, "playerId must be unique within marks.");
    markIds.add(mark.playerId);
    marks.push({ playerId: mark.playerId, mark: mark.mark });
  }

  if (!Array.isArray(input.keeperIds) || input.keeperIds.length > 32)
    return bad("/state/keeperIds", "keeperIds must be an array of at most 32 entries.");
  const keeperSet = new Set();
  for (let i = 0; i < input.keeperIds.length; i++) {
    const id = input.keeperIds[i];
    if (typeof id !== "string" || !DRAFT_PLAYER_ID_RE.test(id))
      return bad(`/state/keeperIds/${i}`, "keeper playerId is invalid.");
    if (keeperSet.has(id))
      return bad(`/state/keeperIds/${i}`, "keeper playerIds must be unique.");
    keeperSet.add(id);
  }

  return {
    ok: true,
    state: {
      filters: {
        query, position: filters.position, hideTaken: filters.hideTaken,
        taggedOnly: filters.taggedOnly,
        sort: { key: filters.sort.key, direction: filters.sort.direction },
      },
      marks: marks.sort((a, b) => a.playerId.localeCompare(b.playerId)),
      keeperIds: [...keeperSet].sort((a, b) => a.localeCompare(b)),
    },
  };
}

async function readCappedJson(request, limit) {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit)
    return { tooLarge: true };
  if (!request.body) return { malformed: true };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch {}
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) }; }
  catch { return { malformed: true }; }
}

function draftStateEnvelope(leagueId, record) {
  const exists = !!record;
  return {
    ok: true,
    leagueId,
    exists,
    version: exists ? record.version : 0,
    updatedAt: exists ? record.updatedAt : null,
    state: exists ? record.state : DRAFT_EMPTY_STATE,
  };
}

function checkedDraftRecord(record) {
  if (!record) return { ok: true, record: null };
  const checked = validateDraftState(record.state);
  if (!checked.ok || !Number.isSafeInteger(record.version) || record.version < 1 ||
      !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 0)
    return { ok: false };
  return { ok: true, record: { version: record.version, updatedAt: record.updatedAt, state: checked.state } };
}


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
//  counters, and it means this route needs no dashboard change to work.
//
//  ⚠️ THIS NAMES `RL` EXPLICITLY, AND MUST KEEP DOING SO. It used to read
//  `env.DD_KV || env.RL`, which sounds harmless — "prefer a dedicated namespace if
//  one is ever bound" — and is not. The live data is in RL. Binding an empty DD_KV
//  would have silently repointed this and five other concerns at it: no exception,
//  no 500, just survivor boards, CFB market receipts, the player index, nightly
//  backups and EVERY LEAGUE JOIN LINK reading blank. A binding is a dashboard
//  action taken by someone who is not reading this file. Do not reintroduce the
//  fallback; give genuinely new concerns their own binding by name.
// ============================================================
const survivorKV = (env) => env.RL || null;
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

/* ======================= CFB 24-hour market receipts ===================== */
// The historical CFB market file names books but has no observation timestamp,
// which makes every model-vs-market comparison confounded. This collector fixes
// that prospectively and narrowly: once an hour it asks SportsGameOdds for NCAAF
// events kicking off in [24h, 25h), freezes the paired moneylines it sees, and
// never overwrites them. One event object counts as one SGO quota object; the
// narrow window keeps a full season viable on the 2,500-object free allowance.
//
// Storage is one immutable KV value per event AND scheduled kickoff. Including
// kickoff is deliberate: if a game is rescheduled after its first receipt, the
// new 24-hour window creates a second record instead of rewriting history.
//
//   cfb:market:24h:<season>:<kickoff-ms>:<event-id>  - immutable receipt
//   cfb:market:24h:last-run                           - operational summary
//   cfb:market:24h:lasterror                          - operational failure trail
//
// GET /cfb/market-snapshots?season=2026 publishes only the receipt prefix. It
// can never enumerate backup, auth, rate-limit or other KV keys.
const CFB_MARKET_CRON = "9 * * * *";
const BACKUP_CRON = "0 9 * * *";
const CFB_MARKET_API = "https://api.sportsgameodds.com/v2/events";
const CFB_MARKET_PREFIX = "cfb:market:24h:";
const CFB_MARKET_LEAD_MS = 24 * 60 * 60 * 1000;
const CFB_MARKET_WINDOW_MS = 60 * 60 * 1000;
const CFB_MARKET_PAGE_LIMIT = 100;
const CFB_MARKET_MAX_PAGES = 4;
const CFB_MARKET_ODDS = [
  "points-home-game-ml-home",
  "points-home-game-sp-home",
  "points-all-game-ou-over",
];

// Names RL explicitly — see the survivorKV note. A DD_KV fallback here would point the
// market receipts at an empty namespace the moment that binding appeared.
const cfbMarketKV = (env) => env.RL || null;

function cfbSeasonFromKickoff(ms) {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  return d.getUTCMonth() < 2 ? year - 1 : year;
}

function cfbMarketWindow(nowMs) {
  const start = nowMs + CFB_MARKET_LEAD_MS;
  return { start, end: start + CFB_MARKET_WINDOW_MS };
}

function cfbAmerican(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) < 100 || n === 0) return null;
  return Math.round(n);
}

function cfbImplied(american) {
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

function cfbTeam(team, side) {
  const names = (team && team.names) || {};
  return {
    side,
    id: String((team && team.teamID) || ""),
    name: String(names.long || names.medium || names.short || ""),
    abbreviation: String(names.short || ""),
  };
}

function cfbCanonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(cfbCanonicalJson).join(",") + "]";
  return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + cfbCanonicalJson(value[k])).join(",") + "}";
}

async function cfbSha256(value) {
  const bytes = new TextEncoder().encode(cfbCanonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function cfbPairedMoneylines(event) {
  const odds = (event && event.odds) || {};
  const home = odds["points-home-game-ml-home"] || {};
  const away = odds["points-away-game-ml-away"] || {};
  const homeBooks = home.byBookmaker || {};
  const awayBooks = away.byBookmaker || {};
  const books = [...new Set([...Object.keys(homeBooks), ...Object.keys(awayBooks)])].sort();
  const accepted = [], rejected = [];

  for (const bookmaker of books) {
    const h = homeBooks[bookmaker], a = awayBooks[bookmaker];
    if (!h || !a) {
      rejected.push({ bookmaker, market: "moneyline", reason: "missing-opposing-side" });
      continue;
    }
    if (h.available === false || a.available === false) {
      rejected.push({ bookmaker, market: "moneyline", reason: "quote-not-available" });
      continue;
    }
    const homeAmerican = cfbAmerican(h.odds), awayAmerican = cfbAmerican(a.odds);
    if (homeAmerican === null || awayAmerican === null) {
      rejected.push({ bookmaker, market: "moneyline", reason: "invalid-american-price" });
      continue;
    }
    const rawHome = cfbImplied(homeAmerican), rawAway = cfbImplied(awayAmerican);
    const total = rawHome + rawAway;
    const hold = total - 1;
    // A slightly negative hold can occur when books move opposing sides at different
    // moments. Large negative or >25% holds are not credible paired markets and stay
    // visible as rejected input rather than disappearing.
    if (hold < -0.05 || hold > 0.25) {
      rejected.push({
        bookmaker, market: "moneyline", reason: "implausible-hold",
        home_american: homeAmerican, away_american: awayAmerican,
        hold: Math.round(hold * 1e6) / 1e6,
      });
      continue;
    }
    accepted.push({
      bookmaker,
      home_american: homeAmerican,
      away_american: awayAmerican,
      hold: Math.round(hold * 1e6) / 1e6,
      home_probability_no_vig: Math.round((rawHome / total) * 1e6) / 1e6,
      away_probability_no_vig: Math.round((rawAway / total) * 1e6) / 1e6,
      home_quote_updated_at: h.lastUpdatedAt || null,
      away_quote_updated_at: a.lastUpdatedAt || null,
    });
  }
  return { accepted, rejected };
}

async function cfbMarketRecord(event, capturedMs, sourceNotice) {
  if (!event || event.leagueID !== "NCAAF") throw new Error("SGO returned a non-NCAAF event");
  const eventId = String(event.eventID || "");
  if (!eventId || eventId.length > 200) throw new Error("SGO event missing a valid eventID");
  const kickoff = Date.parse(event.status && event.status.startsAt);
  if (!Number.isFinite(kickoff)) throw new Error("SGO event missing a valid kickoff");
  if (kickoff <= capturedMs) throw new Error("SGO returned an event that has already started");
  const teams = event.teams || {};
  const home = cfbTeam(teams.home, "home"), away = cfbTeam(teams.away, "away");
  if (!home.id || !home.name || !away.id || !away.name) throw new Error("SGO event missing team identity");
  const pairs = cfbPairedMoneylines(event);
  const season = cfbSeasonFromKickoff(kickoff);
  const capturedAt = new Date(capturedMs).toISOString();
  const body = {
    schema_version: 1,
    event_id: eventId,
    league: "NCAAF",
    season,
    kickoff: new Date(kickoff).toISOString(),
    captured_at: capturedAt,
    lead_seconds: Math.round((kickoff - capturedMs) / 1000),
    price_timing: "prospective-24h-window",
    teams: { home, away },
    source: {
      provider: "SportsGameOdds",
      endpoint: CFB_MARKET_API,
      observation_timestamp_available: true,
      provider_notice: sourceNotice || null,
    },
    status: pairs.accepted.length ? "priced" : "unpriced",
    moneylines: pairs.accepted,
    rejected_quotes: pairs.rejected,
    grading: { modelled: false, simulation: false, graded: false },
  };
  const snapshotId = await cfbSha256(body);
  return {
    ...body,
    integrity: { algorithm: "sha256-canonical-json", snapshot_id: snapshotId },
    storage_key: `${CFB_MARKET_PREFIX}${season}:${kickoff}:${encodeURIComponent(eventId)}`,
  };
}

async function cfbFetchMarketEvents(env, window) {
  if (!env.SGO_KEY) throw new Error("Worker misconfigured: SGO_KEY secret not set");
  const events = [];
  let cursor = null, notice = null;
  for (let page = 0; page < CFB_MARKET_MAX_PAGES; page++) {
    const url = new URL(CFB_MARKET_API);
    url.searchParams.set("leagueID", "NCAAF");
    url.searchParams.set("started", "false");
    // One millisecond of API-side overlap prevents an exact-boundary game from
    // falling between two exclusive filters. Local filtering below is canonical.
    url.searchParams.set("startsAfter", new Date(window.start - 1).toISOString());
    url.searchParams.set("startsBefore", new Date(window.end).toISOString());
    url.searchParams.set("oddID", CFB_MARKET_ODDS.join(","));
    url.searchParams.set("includeOpposingOdds", "true");
    url.searchParams.set("includeAltLines", "false");
    url.searchParams.set("limit", String(CFB_MARKET_PAGE_LIMIT));
    if (cursor) url.searchParams.set("cursor", cursor);

    let response;
    try {
      response = await fetch(url, { headers: { "x-api-key": env.SGO_KEY } });
    } catch (e) {
      throw new Error("SportsGameOdds network failure: " + e.message);
    }
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); }
    catch { throw new Error("SportsGameOdds returned non-JSON (HTTP " + response.status + ")"); }
    if (!response.ok || !payload || payload.success !== true || !Array.isArray(payload.data)) {
      const detail = String((payload && (payload.error || payload.message)) || "invalid response").slice(0, 240);
      throw new Error("SportsGameOdds HTTP " + response.status + ": " + detail);
    }
    if (payload.notice) notice = String(payload.notice).slice(0, 500);
    for (const event of payload.data) {
      const kickoff = Date.parse(event && event.status && event.status.startsAt);
      if (Number.isFinite(kickoff) && kickoff >= window.start && kickoff < window.end) events.push(event);
    }
    cursor = payload.nextCursor || null;
    if (!cursor) return { events, notice, pages: page + 1 };
  }
  throw new Error(`SportsGameOdds pagination exceeded ${CFB_MARKET_MAX_PAGES} pages`);
}

async function runCfbMarketCapture(env, nowMs) {
  const kv = cfbMarketKV(env);
  if (!kv) throw new Error("no KV binding for CFB market receipts");
  const window = cfbMarketWindow(nowMs);
  const fetched = await cfbFetchMarketEvents(env, window);
  let stored = 0, existing = 0, priced = 0, unpriced = 0;
  for (const event of fetched.events) {
    const record = await cfbMarketRecord(event, nowMs, fetched.notice);
    const prior = await kv.get(record.storage_key);
    if (prior !== null) { existing++; continue; }
    await kv.put(record.storage_key, JSON.stringify(record));
    stored++;
    if (record.status === "priced") priced++; else unpriced++;
  }
  const summary = {
    at: new Date(nowMs).toISOString(),
    window_start: new Date(window.start).toISOString(),
    window_end: new Date(window.end).toISOString(),
    pages: fetched.pages,
    events: fetched.events.length,
    stored, existing, priced, unpriced,
    provider_notice: fetched.notice,
  };
  await kv.put(CFB_MARKET_PREFIX + "last-run", JSON.stringify(summary));
  return summary;
}

async function handleCfbMarketSnapshots(request, url, env, cors) {
  if (request.method !== "GET") return json({ error: "GET only" }, 405, cors);
  const kv = cfbMarketKV(env);
  if (!kv) return json({ error: "CFB market receipt storage is unavailable" }, 503, cors);
  const season = Number(url.searchParams.get("season") || cfbSeasonFromKickoff(Date.now()));
  if (!Number.isInteger(season) || season < 2018 || season > 2100)
    return json({ error: "season must be an integer from 2018 through 2100" }, 400, cors);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const options = { prefix: `${CFB_MARKET_PREFIX}${season}:`, limit };
  const cursor = url.searchParams.get("cursor");
  if (cursor) options.cursor = cursor;

  let listed;
  try { listed = await kv.list(options); }
  catch (e) { return json({ error: "CFB market receipt listing failed: " + e.message }, 502, cors); }
  const records = [];
  try {
    for (const key of listed.keys || []) {
      const value = await kv.get(key.name);
      if (value === null) throw new Error("listed receipt disappeared");
      records.push(JSON.parse(value));
    }
  } catch (e) {
    return json({ error: "Stored CFB market receipt failed validation: " + e.message }, 500, cors);
  }
  records.sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)) || String(a.event_id).localeCompare(String(b.event_id)));
  const latest = records.reduce((m, r) => String(r.captured_at || "") > m ? String(r.captured_at) : m, "");
  const payload = {
    as_of: latest ? latest.slice(0, 10) : new Date().toISOString().slice(0, 10),
    source: "SportsGameOdds NCAAF events captured prospectively by the Data Dawgs Cloudflare Worker.",
    note: "Immutable market observations captured 24 to 25 hours before scheduled kickoff. Prices are model inputs, not forecasts or graded results. Rescheduled games may have multiple receipts.",
    built: new Date().toISOString(),
    canonical_url: `https://toto.jkapcar4.workers.dev/cfb/market-snapshots?season=${season}`,
    data: {
      season,
      target_lead_hours: 24,
      capture_window_hours: 1,
      records,
      complete: !!listed.list_complete,
      next_cursor: listed.list_complete ? null : (listed.cursor || null),
    },
  };
  return new Response(JSON.stringify(payload), {
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}

/* ========================= Sleeper slim player index =========================
   GET /sleeper/players-slim — a daily-cached, slimmed copy of Sleeper's
   /players/nfl. The upstream file is ~5MB and Sleeper's docs say to pull it at
   most once a day and cache it server-side — so the WORKER is the one place on
   the site allowed to fetch it. guillotine.html's waiver board reads names from
   here instead of hitting Sleeper per pageview.

   Kept per player: [name, position, nfl team]. Active players at fantasy
   positions only. This is identity data, nothing else — no stats, no
   projections, and nothing caller-specific is stored.

     sleeper:players:slim — one KV value, the full JSON envelope, rewritten
                            at most once per SLEEPER_SLIM_TTL_MS.

   Freshness: served from KV while `built` is under 24h old. When stale, one
   request pays for the upstream refresh; if the refresh fails and a stale copy
   exists, the stale copy is served and says so. No copy + failed refresh = 503,
   never an invented payload. */
const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const SLEEPER_SLIM_KEY = "sleeper:players:slim";
const SLEEPER_SLIM_TTL_MS = 24 * 60 * 60 * 1000;
const SLEEPER_SLIM_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

function sleeperSlimFromRaw(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("players payload is not an object");
  const players = {};
  let count = 0;
  for (const id of Object.keys(raw)) {
    const p = raw[id];
    if (!p || typeof p !== "object") continue;
    if (p.active !== true) continue;
    const pos = String(p.position || "");
    if (!SLEEPER_SLIM_POSITIONS.includes(pos)) continue;
    const name = String(p.full_name || ((p.first_name || "") + " " + (p.last_name || "")).trim());
    if (!name) continue;
    players[id] = [name, pos, p.team ? String(p.team) : null];
    count++;
  }
  // Fail closed on an implausibly small index rather than caching a broken upstream
  // response for 24 hours. ~2,000+ actives is normal; 500 is already alarm territory.
  if (count < 500) throw new Error("slim player index implausibly small: " + count);
  return { players, count };
}

/* ===== DD$ PRIVATE VALUATION (begin) ===== */
/* DataDawg$ is Kap's private, league-specific valuation (ETR-derived). It is NEVER in the
   repo and NEVER returned whole. A board sits in KV under dd$:<provider>:<leagueId>; the
   helpers below attach a value to a player the caller already holds, and nothing else.
   PMV (data/pool.json) is the public fallback and is not touched here. */
const DD_KV_PREFIX = "dd$:";
/* ⚠️ A league has TWO boards and they answer different questions. The season board prices
   this year; the dynasty board prices the asset (and its draft picks). Mixing them in one
   number is the single most misleading thing this code could do, so the horizon is part of
   the KV key and part of every response. */
const DD_HORIZONS = { season: "", dynasty: ":dynasty" };
const DD_MAX_KEYS = 700;                 // a 12-team league's whole pool is ~500
const DD_SHARE_INCLUDE = true;           // share-link readers see the same grades as the owner
/* team abbreviations differ by source: ETR says LA/JAX/WAS, ESPN says LAR/JAX/WSH */
const DD_TEAM_ALIAS = { LAR:"LA", JAC:"JAX", WSH:"WAS", OAK:"LV", SD:"LAC", STL:"LA" };
const DD_NICK = { ravens:"BAL", bills:"BUF", bengals:"CIN", browns:"CLE", broncos:"DEN", texans:"HOU",
  colts:"IND", jaguars:"JAX", chiefs:"KC", raiders:"LV", chargers:"LAC", dolphins:"MIA", patriots:"NE",
  jets:"NYJ", steelers:"PIT", titans:"TEN", cardinals:"ARI", falcons:"ATL", panthers:"CAR", bears:"CHI",
  cowboys:"DAL", lions:"DET", packers:"GB", rams:"LA", vikings:"MIN", saints:"NO", giants:"NYG",
  eagles:"PHI", "49ers":"SF", seahawks:"SEA", buccaneers:"TB", commanders:"WAS" };

/* the page's mvKey, ported: suffixes, punctuation and accents stripped, lowercase */
function ddNameKey(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}
/* the two names ETR and the providers spell differently; extend, never loosen the matcher */
const DD_NAME_ALIAS = { "kenneth gainwell":"kenny gainwell", "cameron ward":"cam ward" };
function ddTeamAbbr(t) { const u = String(t || "").toUpperCase(); return DD_TEAM_ALIAS[u] || u; }
/* A join key for any player row from any source: {name, pos, team}. Defenses key by team
   because they have no shared id anywhere; "Ravens D/ST" and "BAL DST" both -> dst:BAL. */
function ddPlayerKey(row) {
  if (!row) return null;
  const pos = String(row.pos || "").toUpperCase();
  const name = String(row.name || row.player || "");
  if (pos === "DST" || pos === "DEF" || /\bd\/st\b|\bdst\b/i.test(name)) {
    const nick = name.toLowerCase().replace(/\s*d\/st.*$/, "").replace(/\s*dst.*$/, "").trim();
    const byNick = DD_NICK[nick] || DD_NICK[nick.split(" ").pop()];
    const abbr = byNick || (/^[A-Z]{2,3}$/i.test(String(row.team || "")) ? ddTeamAbbr(row.team) : null);
    return abbr ? "dst:" + abbr : null;
  }
  const k = ddNameKey(name);
  return k ? "name:" + (DD_NAME_ALIAS[k] || k) : null;
}
/* Board JSON -> lookup index. Only the fields a caller may receive are kept. */
function ddIndexBoard(board) {
  const d = (board && board.data) || {};
  const by = new Map();
  for (const p of (d.players || [])) {
    if (!p || !Number.isFinite(Number(p.target))) continue;
    const k = ddPlayerKey({ name: p.player, pos: p.pos, team: p.team });
    if (!k || by.has(k)) continue;
    const v = { v: Number(p.target) };
    if (Number.isFinite(Number(p.low)))  v.low  = Number(p.low);
    if (Number.isFinite(Number(p.high))) v.high = Number(p.high);
    by.set(k, v);
    if (p.id && /^\d{2}-\d{7}$/.test(String(p.id))) by.set("gsis:" + p.id, v);
  }
  /* Draft picks are dynasty ASSETS, priced at ROUND level by the source. They are carried
     separately from players and must be shown BESIDE roster value, never folded into it
     silently - a team can be mid-table on roster and first on capital. */
  const picks = (d.picks || []).map(p => ({ pick: p.pick, season: p.season, round: p.round, v: Number(p.target) }))
                               .filter(p => Number.isFinite(p.v));
  const capital = d.draft_capital_by_team || null;
  return { by, picks, capital, meta: {
    basis: "dd", model_id: d.model_id || null, as_of: d.as_of || board.as_of || null,
    horizon: d.horizon || "season", dynasty_league: !!d.dynasty_league,
    has_picks: picks.length > 0,
    tier: d.tier || board.tier || "labs", graded: !!(d.graded || board.graded),
    league: d.league || null, priced: (d.validation && d.validation.priced_players) || null,
    note: "DataDawg$: private league-specific valuation, " + (d.as_of || board.as_of || "undated") +
          ". Not graded. " +
          ((d.horizon || "season") === "dynasty"
            ? "DYNASTY horizon: asset value including draft capital. Picks are priced by ROUND, not by slot. "
            : (d.dynasty_league ? "SEASON horizon only - dynasty value is NOT in this board. " : "")) +
          "low/high are conversion-assumption bounds, not bid ceilings.",
  } };
}
async function ddLoadBoard(env, provider, leagueId, horizon) {
  const kv = env && env.RL;
  const suffix = DD_HORIZONS[horizon || "season"];
  if (!kv || !provider || !leagueId || suffix === undefined) return null;
  let raw = null;
  try { raw = await kv.get(DD_KV_PREFIX + String(provider) + ":" + String(leagueId) + suffix); } catch { raw = null; }
  if (!raw) return null;
  try { return ddIndexBoard(JSON.parse(raw)); } catch { return null; }
}
/* Attach values to a warroom feed body IN PLACE. Only players already in body.pool are
   touched; the board's remaining rows never leave this function. */
function ddDecorateBody(index, body) {
  if (!index || !body) return body;
  let matched = 0;
  const pool = Array.isArray(body.pool) ? body.pool : [];
  for (const p of pool) {
    const hit = index.by.get(ddPlayerKey(p));
    if (hit) { p.dd = hit; matched++; }
  }
  body.dd = Object.assign({}, index.meta, { matched, unmatched: pool.length - matched });
  return body;
}
/* Values for a caller-supplied key list. Same rule: answers only what was asked. */
function ddValuesFor(index, keys) {
  const out = {};
  let matched = 0;
  for (const k of keys) {
    const hit = index.by.get(String(k));
    if (hit) { out[k] = hit; matched++; }
  }
  return { dd: Object.assign({}, index.meta, { matched, unmatched: keys.length - matched }), values: out };
}
/* POST /dd/values  {provider, leagueId, keys:[...]}  -> {ok, dd, values}
   Signed-in callers only. Keys are the page's own ddPlayerKey() strings ("name:..." or
   "dst:XXX" or "gsis:..."). Capped so the route cannot be used to walk a board. */
async function handleDdValues(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only." }, 405, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 401, cors);
  let body = {};
  try { body = await request.json(); } catch { return json({ error: "Send JSON." }, 400, cors); }
  const provider = String(body.provider || "").toLowerCase();
  const leagueId = String(body.leagueId || "").trim();
  if (!/^(sleeper|espn|yahoo)$/.test(provider)) return json({ error: "Unknown provider." }, 400, cors);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(leagueId)) return json({ error: "That is not a league id." }, 400, cors);
  const horizon = String(body.horizon || "season");
  if (!(horizon in DD_HORIZONS)) return json({ error: "horizon must be season or dynasty." }, 400, cors);
  const keys = Array.isArray(body.keys) ? body.keys.filter(k => typeof k === "string" && k.length < 80) : [];
  if (!keys.length) return json({ error: "Send the player keys you hold." }, 400, cors);
  if (keys.length > DD_MAX_KEYS) return json({ error: "Too many keys." }, 413, cors);
  const index = await ddLoadBoard(env, provider, leagueId, horizon);
  if (!index) return json({ ok: true, dd: null, values: {} }, 200, cors);   // no board: page falls back to PMV
  const out = Object.assign({ ok: true }, ddValuesFor(index, keys));
  if (index.picks && index.picks.length) out.picks = index.picks;
  if (index.capital) out.draftCapital = index.capital;
  return json(out, 200, cors);
}
/* ===== DD$ PRIVATE VALUATION (end) ===== */

/* ======================= ESPN fantasy league adapter ====================== */
/* Why this is server-side at all: ESPN's fantasy read API does not send permissive
   CORS headers, and a private league needs the espn_s2 / SWID cookies, which belong
   to espn.com and can never be attached by a page on datadawgs216.com. So the fetch
   has to happen here. A PUBLIC league needs no cookies at all — /espn/connect tries
   without them first and only asks for credentials if ESPN refuses.

   ⚠️ espn_s2 and SWID are ACCOUNT-level ESPN session cookies, not league-scoped.
   Anyone holding them can act as that ESPN user. They are therefore:
     - never logged, never echoed back in any response, never put in a URL,
     - encrypted with AES-GCM under a key derived from BOZO_PEPPER + the caller's uid,
     - stored per uid, and readable only by a request carrying that uid's session,
     - deletable by the owner via DELETE /espn/connect.
   The uid, not the display name, is the key: a name is chosen by the user and two
   accounts may share one. */

const ESPN_READ = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
const ESPN_KV_PREFIX = "espn:cred:";
const ESPN_CRED_TTL = 60 * 60 * 24 * 120;   // 120 days; ESPN cookies outlive a season

function espnKvKey(uid) { return ESPN_KV_PREFIX + uid; }

/* ---- shared league links ----------------------------------------------------
 * Eleven managers in a twelve-team league have no ESPN cookie in this Worker, and
 * asking each of them to paste one is not a product. The owner mints one link; it
 * reads THEIR league through THEIR sealed credential and returns the same feed the
 * owner's own War Room renders, so the grades are identical by construction rather
 * than by two implementations agreeing.
 * ⚠️ THE TOKEN IS THE ONLY SECRET, SO IT IS THE ONLY THING THAT MAY GRANT ACCESS.
 * It maps to a uid AND a leagueId: if the owner reconnects to a different league the
 * old link must stop resolving rather than quietly start serving a different set of
 * rosters. The share can never outlive the credential it reads through. */
const ESPN_SHARE_PREFIX = "espn:share:";
const ESPN_SHARE_OF_PREFIX = "espn:shareof:";

function espnShareToken() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const r = new Uint8Array(28);
  crypto.getRandomValues(r);
  let t = "";
  for (const x of r) t += alphabet[x % alphabet.length];
  return t;
}

/* ⚠️ THE ONLY UNAUTHENTICATED ESPN ROUTE IN THIS WORKER. Everything it returns comes
   from espnWarroomFeed, whose body is league / teams / pool / schedule / diagnostics —
   no cookie, no SWID, no session, no uid, and owner GUIDs already stripped at the feed.
   Do not spread `cred` into this response, and do not add a field here without checking
   it against that list first. */
async function handleEspnShareRead(request, url, env, cors) {
  const kv = env.RL || null;
  if (!kv) return json({ error: "share storage is unavailable" }, 503, cors);

  const token = url.pathname.replace(/^\/espn\/share\//, "").replace(/\/+$/, "");
  if (!/^[A-Za-z0-9]{16,64}$/.test(token))
    return json({ error: "That is not a share link." }, 404, cors);

  let rec = null;
  try { rec = JSON.parse((await kv.get(ESPN_SHARE_PREFIX + token)) || "null"); } catch { rec = null; }
  if (!rec || !rec.uid)
    return json({ error: "That share link is not valid, or the league owner revoked it." }, 404, cors);

  let blob = null;
  try { blob = await kv.get(espnKvKey(rec.uid)); } catch { blob = null; }
  const cred = blob ? await espnOpen(env, rec.uid, blob) : null;
  if (!cred)
    return json({ error: "The league owner's ESPN connection has expired, so this shared view cannot refresh. Ask them to reconnect." }, 409, cors);
  if (String(cred.leagueId) !== String(rec.leagueId))
    return json({ error: "The league owner is no longer connected to this league, so this link no longer resolves." }, 409, cors);

  const r = await espnWarroomFeed(cred);
  if (!r.ok) return json({ error: r.reason }, 502, cors);
  /* ⚠️ Deliberate addition to the unauthenticated share body: `dd` on pool players and a `dd`
     meta block. The token holder is a member of the league the board prices, and the grades
     must match the owner's or the two views disagree about the same roster. Still no cookie,
     no uid, no board rows beyond the pool. Flip DD_SHARE_INCLUDE to withhold. */
  if (DD_SHARE_INCLUDE) ddDecorateBody(await ddLoadBoard(env, "espn", cred.leagueId, "season"), r.body);
  return json({ ok: true, shared: true, readOnly: true, sharedAt: rec.at || null, ...r.body }, 200, cors);
}

async function espnKey(env, uid) {
  const base = new TextEncoder().encode(String(env.BOZO_PEPPER || "") + "|espn|" + uid);
  const material = await crypto.subtle.importKey("raw", base, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("dd-espn-v1"), info: new Uint8Array() },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function espnSeal(env, uid, obj) {
  const key = await espnKey(env, uid);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv },
    key, new TextEncoder().encode(JSON.stringify(obj)));
  return JSON.stringify({ v: 1, iv: [...iv], ct: [...new Uint8Array(ct)] });
}

async function espnOpen(env, uid, blob) {
  try {
    const rec = JSON.parse(blob);
    if (!rec || rec.v !== 1) return null;
    const key = await espnKey(env, uid);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) },
      key, new Uint8Array(rec.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch { return null; }
}

/* One place that talks to ESPN, so the cookie header is built in exactly one place
   and a caller can never accidentally pass credentials somewhere else. */
async function espnFetch(leagueId, season, views, cred) {
  const qs = (views || []).map(v => "view=" + encodeURIComponent(v)).join("&");
  const url = `${ESPN_READ}/seasons/${encodeURIComponent(season)}/segments/0/leagues/${encodeURIComponent(leagueId)}${qs ? "?" + qs : ""}`;
  const headers = { Accept: "application/json" };
  if (cred && cred.s2 && cred.swid) {
    const swid = String(cred.swid).startsWith("{") ? cred.swid : `{${cred.swid}}`;
    headers.Cookie = `espn_s2=${cred.s2}; SWID=${swid}`;
  }
  let res;
  try { res = await fetch(url, { headers }); }
  catch (e) { return { ok: false, status: 0, reason: "ESPN could not be reached from the Worker." }; }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, reason: cred
      ? "ESPN rejected the stored credentials. They usually expire when you sign out of ESPN or change your password — reconnect to refresh them."
      : "This league is private, so it needs your ESPN credentials. Connect them below." };
  }
  if (res.status === 404) return { ok: false, status: 404, reason: "ESPN has no league with that id for that season. Check the league id and the season." };
  if (!res.ok) return { ok: false, status: res.status, reason: `ESPN answered ${res.status}.` };
  let body;
  try { body = await res.json(); } catch { return { ok: false, status: res.status, reason: "ESPN's answer was not JSON." }; }
  return { ok: true, status: res.status, body };
}

/* ---- normalisation: ESPN's shapes -> the site's league contract ---------- */
const ESPN_SLOT = { 0:"QB",2:"RB",4:"WR",6:"TE",16:"DST",17:"K",23:"FLEX",20:"BE",21:"IR",7:"OP" };
const ESPN_POS  = { 1:"QB",2:"RB",3:"WR",4:"TE",5:"K",16:"DST" };

function espnRosterSlots(settings) {
  const counts = (settings && settings.rosterSettings && settings.rosterSettings.lineupSlotCounts) || {};
  const order = [];
  for (const [id, n] of Object.entries(counts)) {
    const count = Number(n) || 0;
    if (!count) continue;
    const slot = ESPN_SLOT[Number(id)];
    if (!slot || slot === "IR") continue;          // IR is not drafted
    order.push({ slot: slot === "OP" ? "SUPERFLEX" : slot === "BE" ? "BENCH" : slot, count });
  }
  return order;
}

function espnScoring(settings) {
  // Reception points decide half vs full; a superflex/OP slot decides sf.
  const items = (settings && settings.scoringSettings && settings.scoringSettings.scoringItems) || [];
  const rec = items.find(i => Number(i.statId) === 53);
  const ppr = rec ? Number(rec.points) : 0;
  const counts = (settings && settings.rosterSettings && settings.rosterSettings.lineupSlotCounts) || {};
  const superflex = Number(counts[7] || 0) > 0;
  let mode = "custom";
  if (superflex && [0, 0.5, 1].includes(ppr)) mode = "sf";
  else if (ppr === 1) mode = "full";
  else if (ppr === 0.5) mode = "half";
  else if (ppr === 0) mode = "std";
  return { mode, ppr: Number.isFinite(ppr) ? ppr : null, superflex };
}

function espnNormalizeLeague(body) {
  const s = body && body.settings || {};
  const draft = s.draftSettings || {};
  const isAuction = String(draft.type || "").toUpperCase() === "AUCTION";
  const teams = (body.teams || []).map((t, i) => ({
    providerId: String(t.id),
    name: [t.location, t.nickname].filter(Boolean).join(" ").trim() || t.name || `Team ${i + 1}`,
    owner: (t.owners && t.owners[0]) || "",
    draftSlot: t.draftDayProjectedRank || null,
  }));
  return {
    provider: "espn",
    leagueId: String(body.id || ""),
    season: Number(body.seasonId) || null,
    name: s.name || "ESPN league",
    teamCount: Number(s.size) || teams.length || null,
    draftType: isAuction ? "auction" : "snake",
    budget: isAuction ? (Number(draft.auctionBudget) || 200) : null,
    scoring: espnScoring(s),
    rosterSlots: espnRosterSlots(s),
    teams,
  };
}

/* Picks. ESPN gives playerId only on the pick.
   ⚠️ This used to rely ENTIRELY on the roster views for names, on the theory that a pick
   shows up on the roster a moment later. That is false in the two cases that matter:
   before a draft mRoster is EMPTY, so keeper picks resolve to nothing, and during a live
   auction the roster entry lags the draft-detail row by longer than one poll. The result
   was 204 of 204 picks arriving nameless and every one of them failing to map. The roster
   map stays as the fast path; espnPlayerIndex() below is the fallback that fills the gaps. */
function espnPlayerNames(body) {
  const map = new Map();
  for (const t of body.teams || []) {
    for (const e of (t.roster && t.roster.entries) || []) {
      const p = e.playerPoolEntry && e.playerPoolEntry.player;
      if (p && p.id != null) map.set(String(p.id), {
        name: p.fullName || "",
        pos: ESPN_POS[Number(p.defaultPositionId)] || "",
        team: p.proTeamId != null ? String(p.proTeamId) : "",
      });
    }
  }
  return map;
}

function espnNormalizePicks(body, fallbackNames) {
  const names = espnPlayerNames(body);
  if (fallbackNames) for (const [id, meta] of fallbackNames) if (!names.has(id)) names.set(id, meta);
  const byTeam = new Map((body.teams || []).map((t, i) => [String(t.id), i]));
  const picks = ((body.draftDetail && body.draftDetail.picks) || []).map(p => {
    const meta = names.get(String(p.playerId)) || {};
    return {
      providerPickId: String(p.id != null ? p.id : `${p.roundId}-${p.roundPickNumber}`),
      overall: Number(p.overallPickNumber) || null,
      round: Number(p.roundId) || null,
      ti: byTeam.has(String(p.teamId)) ? byTeam.get(String(p.teamId)) : null,
      providerTeamId: String(p.teamId),
      playerId: String(p.playerId),
      player: meta.name || "",
      pos: meta.pos || "",
      nfl: meta.team || "",
      price: p.bidAmount != null ? Number(p.bidAmount) : null,
      keeper: !!p.keeper,
    };
  });
  /* Before a draft starts ESPN already lists every slot, as playerId "-1" with no team.
     Those are not picks waiting on a name — they are an empty board — and counting them
     as pending made an undrafted league look like 204 stuck picks. */
  const made = picks.filter(p => p.playerId !== "-1" && p.playerId !== "0");
  const pending = made.filter(p => !p.player).length;
  return {
    complete: !!(body.draftDetail && body.draftDetail.drafted),
    inProgress: !!(body.draftDetail && body.draftDetail.inProgress),
    picks,
    diagnostics: { total: picks.length, made: made.length, empty: picks.length - made.length, unnamed: pending,
      note: pending
        ? "Some picks have no name yet: ESPN publishes the roster entry a moment after the pick. They resolve on the next poll."
        : (made.length ? "" : "No picks yet — ESPN is listing " + (picks.length - made.length) + " empty draft slots.") },
  };
}

/* ---- War Room feed -------------------------------------------------------
   The War Room needs four things Sleeper hands over in five calls: a player pool
   WITH projections, rosters, the weekly schedule, and lineup slots. ESPN carries
   all of it but spread across views, and the projection lives inside each player's
   stats array rather than in a projections endpoint. Assembling it here keeps the
   page's own shape untouched — fantasy-warroom.html gets the same object it builds
   from Sleeper, so every sheet downstream is unchanged. */
const ESPN_PROJ_SOURCE = 1;      // statSourceId 1 = projected (0 = actual)
const ESPN_SEASON_SPLIT = 0;     // scoringPeriodId 0 = full season
const ESPN_SEASON_SPLIT_TYPE = 0; // statSplitTypeId 0 = the season total, not a per-game split

/* ⚠️ THIS READ LAST SEASON'S PROJECTION FOR MONTHS. `player.stats[]` carries one entry per
   season (ids like 102025 and 102026), and this used to `find` the first projected
   full-season split with NO seasonId filter — so a player whose 2025 row serialised first
   got his PRIOR season's number. For a rookie backup that is roughly the replacement line,
   which is why a $34 superflex QB plotted at VOR ≈ 0 and read as a bad buy.
   Three more things were wrong in the same eight lines:
   • `/ 17` is not every league's regular season. Divide by the league's own week count.
   • the fallback comment claimed "the highest scoring period we can see" and the code took
     `weekly[weekly.length-1]` — the last ARRAY element, i.e. whatever order ESPN sent.
   • a missing projection returned 0, and a 0 is a data point: it dragged replacement level
     down for everyone else. Absent is null, and the caller counts it. */
function espnProjection(player, season, weeks) {
  const stats = (player && player.stats) || [];
  const wk = Number(weeks) > 0 ? Number(weeks) : 17;
  const isProj = s => Number(s.statSourceId) === ESPN_PROJ_SOURCE;
  const thisSeason = s => Number(s.seasonId) === Number(season);
  const full = stats.find(s => isProj(s) && thisSeason(s) &&
                               Number(s.scoringPeriodId) === ESPN_SEASON_SPLIT &&
                               Number(s.statSplitTypeId) === ESPN_SEASON_SPLIT_TYPE);
  if (full && Number.isFinite(Number(full.appliedTotal))) return Number(full.appliedTotal) / wk;
  // some leagues only carry weekly projections: take THIS week's, not the last row in the array
  const current = stats.filter(s => isProj(s) && thisSeason(s) &&
                                    Number.isFinite(Number(s.appliedTotal)) &&
                                    Number(s.scoringPeriodId) > 0)
                       .sort((a, b) => Number(b.scoringPeriodId) - Number(a.scoringPeriodId))[0];
  if (current) return Number(current.appliedTotal);
  return null;                                   // ⚠️ null, never 0 — see the note above
}

function espnPlayerRow(player, season, weeks, paidBy) {
  if (!player || player.id == null) return null;
  const pos = ESPN_POS[Number(player.defaultPositionId)] || "";
  if (!pos) return null;
  const proj = espnProjection(player, season, weeks);
  const id = String(player.id);
  return {
    id,
    name: player.fullName || [player.firstName, player.lastName].filter(Boolean).join(" "),
    pos,
    team: player.proTeamId != null ? String(player.proTeamId) : "",
    /* ⚠️ null must SURVIVE as null. Math.round(null * 100) / 100 is 0, which would quietly
       restore the exact bug the null exists to prevent. */
    p: proj == null ? null : Math.round(proj * 100) / 100,
    /* what this player actually cost at THIS league's auction — the input the war room has
       never had, and the one every surplus number needs */
    paid: paidBy && paidBy.has(id) ? paidBy.get(id) : null,
  };
}

/* The name index: every pick carries a playerId, and this is the only view that turns
   an arbitrary playerId into a name without the player being on someone's roster yet.
   It is one extra request, so it is fetched only when a poll actually has unnamed picks
   and is cached per league for a few minutes — the index does not change during a draft. */
const ESPN_NAME_TTL_MS = 5 * 60 * 1000;
const espnNameCache = new Map();

async function espnPlayerIndex(cred) {
  const key = `${cred.leagueId}:${cred.season}`;
  const hit = espnNameCache.get(key);
  if (hit && (Date.now() - hit.at) < ESPN_NAME_TTL_MS) return hit.map;

  const url = `${ESPN_READ}/seasons/${encodeURIComponent(cred.season)}/segments/0/leagues/${encodeUludes(filters.position))
    return bad("/state/filters/position", "position is not supported.");
  if (typeof filters.hideTaken !== "boolean")
    return bad("/state/filters/hideTaken", "hideTaken must be boolean.");
  if (typeof filters.taggedOnly !== "boolean")
    return bad("/state/filters/taggedOnly", "taggedOnly must be boolean.");
  if (!draftExactKeys(filters.sort, ["key", "direction"]))
    return bad("/state/filters/sort", "sort must contain exactly key and direction.");
  if (!DRAFT_SORT_KEYS.includes(filters.sort.key))
    return bad("/state/filters/sort/key", "sort key is not supported.");
  if (!DRAFT_SORT_DIRECTIONS.includes(filters.sort.direction))
    return bad("/state/filters/sort/direction", "sort direction must be asc or desc.");

  if (!Array.isArray(input.marks) || input.marks.length > 512)
    return bad("/state/marks", "marks must be an array of at most 512 entries.");
  const markIds = new Set();
  const marks = [];
  for (let i = 0; i < input.marks.length; i++) {
    const mark = input.marks[i];
    if (!draftExactKeys(mark, ["playerId", "mark"]))
      return bad(`/state/marks/${i}`, "each mark must contain exactly playerId and mark.");
    if (typeof mark.playerId !== "string" || !DRAFT_PLAYER_ID_RE.test(mark.playerId))
      return bad(`/state/marks/${i}/playerId`, "playerId is invalid.");
    if (!DRAFT_MARKS.includes(mark.mark))
      return bad(`/state/marks/${i}/mark`, "mark must be target or taken.");
    if (markIds.has(mark.playerId))
      return bad(`/state/marks/${i}/playerId`, "playerId must be unique within marks.");
    markIds.add(mark.playerId);
    marks.push({ playerId: mark.playerId, mark: mark.mark });
  }

  if (!Array.isArray(input.keeperIds) || input.keeperIds.length > 32)
    return bad("/state/keeperIds", "keeperIds must be an array of at most 32 entries.");
  const keeperSet = new Set();
  for (let i = 0; i < input.keeperIds.length; i++) {
    const id = input.keeperIds[i];
    if (typeof id !== "string" || !DRAFT_PLAYER_ID_RE.test(id))
      return bad(`/state/keeperIds/${i}`, "keeper playerId is invalid.");
    if (keeperSet.has(id))
      return bad(`/state/keeperIds/${i}`, "keeper playerIds must be unique.");
    keeperSet.add(id);
  }

  return {
    ok: true,
    state: {
      filters: {
        query, position: filters.position, hideTaken: filters.hideTaken,
        taggedOnly: filters.taggedOnly,
        sort: { key: filters.sort.key, direction: filters.sort.direction },
      },
      marks: marks.sort((a, b) => a.playerId.localeCompare(b.playerId)),
      keeperIds: [...keeperSet].sort((a, b) => a.localeCompare(b)),
    },
  };
}

async function readCappedJson(request, limit) {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit)
    return { tooLarge: true };
  if (!request.body) return { malformed: true };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch {}
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) }; }
  catch { return { malformed: true }; }
}

function draftStateEnvelope(leagueId, record) {
  const exists = !!record;
  return {
    ok: true,
    leagueId,
    exists,
    version: exists ? record.version : 0,
    updatedAt: exists ? record.updatedAt : null,
    state: exists ? record.state : DRAFT_EMPTY_STATE,
  };
}

function checkedDraftRecord(record) {
  if (!record) return { ok: true, record: null };
  const checked = validateDraftState(record.state);
  if (!checked.ok || !Number.isSafeInteger(record.version) || record.version < 1 ||
      !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 0)
    return { ok: false };
  return { ok: true, record: { version: record.version, updatedAt: record.updatedAt, state: checked.state } };
}


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
//  counters, and it means this route needs no dashboard change to work.
//
//  ⚠️ THIS NAMES `RL` EXPLICITLY, AND MUST KEEP DOING SO. It used to read
//  `env.DD_KV || env.RL`, which sounds harmless — "prefer a dedicated namespace if
//  one is ever bound" — and is not. The live data is in RL. Binding an empty DD_KV
//  would have silently repointed this and five other concerns at it: no exception,
//  no 500, just survivor boards, CFB market receipts, the player index, nightly
//  backups and EVERY LEAGUE JOIN LINK reading blank. A binding is a dashboard
//  action taken by someone who is not reading this file. Do not reintroduce the
//  fallback; give genuinely new concerns their own binding by name.
// ============================================================
const survivorKV = (env) => env.RL || null;
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

/* ======================= CFB 24-hour market receipts ===================== */
// The historical CFB market file names books but has no observation timestamp,
// which makes every model-vs-market comparison confounded. This collector fixes
// that prospectively and narrowly: once an hour it asks SportsGameOdds for NCAAF
// events kicking off in [24h, 25h), freezes the paired moneylines it sees, and
// never overwrites them. One event object counts as one SGO quota object; the
// narrow window keeps a full season viable on the 2,500-object free allowance.
//
// Storage is one immutable KV value per event AND scheduled kickoff. Including
// kickoff is deliberate: if a game is rescheduled after its first receipt, the
// new 24-hour window creates a second record instead of rewriting history.
//
//   cfb:market:24h:<season>:<kickoff-ms>:<event-id>  - immutable receipt
//   cfb:market:24h:last-run                           - operational summary
//   cfb:market:24h:lasterror                          - operational failure trail
//
// GET /cfb/market-snapshots?season=2026 publishes only the receipt prefix. It
// can never enumerate backup, auth, rate-limit or other KV keys.
const CFB_MARKET_CRON = "9 * * * *";
const BACKUP_CRON = "0 9 * * *";
const CFB_MARKET_API = "https://api.sportsgameodds.com/v2/events";
const CFB_MARKET_PREFIX = "cfb:market:24h:";
const CFB_MARKET_LEAD_MS = 24 * 60 * 60 * 1000;
const CFB_MARKET_WINDOW_MS = 60 * 60 * 1000;
const CFB_MARKET_PAGE_LIMIT = 100;
const CFB_MARKET_MAX_PAGES = 4;
const CFB_MARKET_ODDS = [
  "points-home-game-ml-home",
  "points-home-game-sp-home",
  "points-all-game-ou-over",
];

// Names RL explicitly — see the survivorKV note. A DD_KV fallback here would point the
// market receipts at an empty namespace the moment that binding appeared.
const cfbMarketKV = (env) => env.RL || null;

function cfbSeasonFromKickoff(ms) {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  return d.getUTCMonth() < 2 ? year - 1 : year;
}

function cfbMarketWindow(nowMs) {
  const start = nowMs + CFB_MARKET_LEAD_MS;
  return { start, end: start + CFB_MARKET_WINDOW_MS };
}

function cfbAmerican(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) < 100 || n === 0) return null;
  return Math.round(n);
}

function cfbImplied(american) {
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

function cfbTeam(team, side) {
  const names = (team && team.names) || {};
  return {
    side,
    id: String((team && team.teamID) || ""),
    name: String(names.long || names.medium || names.short || ""),
    abbreviation: String(names.short || ""),
  };
}

function cfbCanonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(cfbCanonicalJson).join(",") + "]";
  return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + cfbCanonicalJson(value[k])).join(",") + "}";
}

async function cfbSha256(value) {
  const bytes = new TextEncoder().encode(cfbCanonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function cfbPairedMoneylines(event) {
  const odds = (event && event.odds) || {};
  const home = odds["points-home-game-ml-home"] || {};
  const away = odds["points-away-game-ml-away"] || {};
  const homeBooks = home.byBookmaker || {};
  const awayBooks = away.byBookmaker || {};
  const books = [...new Set([...Object.keys(homeBooks), ...Object.keys(awayBooks)])].sort();
  const accepted = [], rejected = [];

  for (const bookmaker of books) {
    const h = homeBooks[bookmaker], a = awayBooks[bookmaker];
    if (!h || !a) {
      rejected.push({ bookmaker, market: "moneyline", reason: "missing-opposing-side" });
      continue;
    }
    if (h.available === false || a.available === false) {
      rejected.push({ bookmaker, market: "moneyline", reason: "quote-not-available" });
      continue;
    }
    const homeAmerican = cfbAmerican(h.odds), awayAmerican = cfbAmerican(a.odds);
    if (homeAmerican === null || awayAmerican === null) {
      rejected.push({ bookmaker, market: "moneyline", reason: "invalid-american-price" });
      continue;
    }
    const rawHome = cfbImplied(homeAmerican), rawAway = cfbImplied(awayAmerican);
    const total = rawHome + rawAway;
    const hold = total - 1;
    // A slightly negative hold can occur when books move opposing sides at different
    // moments. Large negative or >25% holds are not credible paired markets and stay
    // visible as rejected input rather than disappearing.
    if (hold < -0.05 || hold > 0.25) {
      rejected.push({
        bookmaker, market: "moneyline", reason: "implausible-hold",
        home_american: homeAmerican, away_american: awayAmerican,
        hold: Math.round(hold * 1e6) / 1e6,
      });
      continue;
    }
    accepted.push({
      bookmaker,
      home_american: homeAmerican,
      away_american: awayAmerican,
      hold: Math.round(hold * 1e6) / 1e6,
      home_probability_no_vig: Math.round((rawHome / total) * 1e6) / 1e6,
      away_probability_no_vig: Math.round((rawAway / total) * 1e6) / 1e6,
      home_quote_updated_at: h.lastUpdatedAt || null,
      away_quote_updated_at: a.lastUpdatedAt || null,
    });
  }
  return { accepted, rejected };
}

async function cfbMarketRecord(event, capturedMs, sourceNotice) {
  if (!event || event.leagueID !== "NCAAF") throw new Error("SGO returned a non-NCAAF event");
  const eventId = String(event.eventID || "");
  if (!eventId || eventId.length > 200) throw new Error("SGO event missing a valid eventID");
  const kickoff = Date.parse(event.status && event.status.startsAt);
  if (!Number.isFinite(kickoff)) throw new Error("SGO event missing a valid kickoff");
  if (kickoff <= capturedMs) throw new Error("SGO returned an event that has already started");
  const teams = event.teams || {};
  const home = cfbTeam(teams.home, "home"), away = cfbTeam(teams.away, "away");
  if (!home.id || !home.name || !away.id || !away.name) throw new Error("SGO event missing team identity");
  const pairs = cfbPairedMoneylines(event);
  const season = cfbSeasonFromKickoff(kickoff);
  const capturedAt = new Date(capturedMs).toISOString();
  const body = {
    schema_version: 1,
    event_id: eventId,
    league: "NCAAF",
    season,
    kickoff: new Date(kickoff).toISOString(),
    captured_at: capturedAt,
    lead_seconds: Math.round((kickoff - capturedMs) / 1000),
    price_timing: "prospective-24h-window",
    teams: { home, away },
    source: {
      provider: "SportsGameOdds",
      endpoint: CFB_MARKET_API,
      observation_timestamp_available: true,
      provider_notice: sourceNotice || null,
    },
    status: pairs.accepted.length ? "priced" : "unpriced",
    moneylines: pairs.accepted,
    rejected_quotes: pairs.rejected,
    grading: { modelled: false, simulation: false, graded: false },
  };
  const snapshotId = await cfbSha256(body);
  return {
    ...body,
    integrity: { algorithm: "sha256-canonical-json", snapshot_id: snapshotId },
    storage_key: `${CFB_MARKET_PREFIX}${season}:${kickoff}:${encodeURIComponent(eventId)}`,
  };
}

async function cfbFetchMarketEvents(env, window) {
  if (!env.SGO_KEY) throw new Error("Worker misconfigured: SGO_KEY secret not set");
  const events = [];
  let cursor = null, notice = null;
  for (let page = 0; page < CFB_MARKET_MAX_PAGES; page++) {
    const url = new URL(CFB_MARKET_API);
    url.searchParams.set("leagueID", "NCAAF");
    url.searchParams.set("started", "false");
    // One millisecond of API-side overlap prevents an exact-boundary game from
    // falling between two exclusive filters. Local filtering below is canonical.
    url.searchParams.set("startsAfter", new Date(window.start - 1).toISOString());
    url.searchParams.set("startsBefore", new Date(window.end).toISOSt