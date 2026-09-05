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
 *   GET  /dk/lobby     — CORS proxy: DraftKings NFL lobby (getcontests). Query: sport=NFL.
 *                        Stores nothing (I2). Used by dfs.html Load from DraftKings.
 *   GET  /dk/draftables — CORS proxy: draftgroups draftables JSON. Query: draftGroupId=.
 *                        Salaries + OUT/Q/IR + CPT/FLEX. Stores nothing.
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

  const url = `${ESPN_READ}/seasons/${encodeURIComponent(cred.season)}/segments/0/leagues/${encodeURIComponent(cred.leagueId)}?view=kona_player_info`;
  const headers = { Accept: "application/json",
    "X-Fantasy-Filter": JSON.stringify({ players: { limit: 1200,
      sortPercOwned: { sortAsc: false, sortPriority: 1 } } }) };
  if (cred.s2 && cred.swid) {
    const swid = String(cred.swid).startsWith("{") ? cred.swid : `{${cred.swid}}`;
    headers.Cookie = `espn_s2=${cred.s2}; SWID=${swid}`;
  }
  const map = new Map();
  try {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const pj = await res.json();
      for (const e of (pj && pj.players) || []) {
        const p = e.player;
        if (p && p.id != null) map.set(String(p.id), {
          name: p.fullName || "",
          pos: ESPN_POS[Number(p.defaultPositionId)] || "",
          team: p.proTeamId != null ? String(p.proTeamId) : "",
        });
      }
    }
  } catch { /* leave the map empty; the caller keeps the roster-only result */ }
  // Only cache a real answer, so one failed fetch does not blank names for five minutes.
  if (map.size) espnNameCache.set(key, { at: Date.now(), map });
  return map;
}

async function espnPicksWithNames(cred, body) {
  const first = espnNormalizePicks(body);
  if (!first.diagnostics.unnamed) return first;
  const index = await espnPlayerIndex(cred);
  if (!index.size) return first;
  return espnNormalizePicks(body, index);
}

/* ⚠️ An ESPN "owner" is an account GUID, not a name. It identifies a real person's ESPN
   account, nothing here needs it, and this payload is read by assistants and mirrored into
   an anonymously-readable database. Names pass; opaque ids do not. */
const OPAQUE_OWNER_ID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
const ownerName = v => { const s = String(v == null ? "" : v).trim(); return !s || OPAQUE_OWNER_ID.test(s) ? null : s; };

async function espnWarroomFeed(cred) {
  const base = await espnFetch(cred.leagueId, cred.season,
    ["mSettings", "mTeam", "mRoster", "mSchedule", "mDraftDetail"], cred.s2 ? cred : null);
  if (!base.ok) return base;
  const body = base.body;
  const s = body.settings || {};
  /* the league's own regular season, not a constant: a 14-week league divided by 17 reads
     every projection ~18% light */
  const seasonWeeks = Number((s.scheduleSettings || {}).matchupPeriodCount) || 17;
  /* auction price per player, from the draft ESPN already returned in this same call */
  const paidBy = new Map();
  for (const pk of ((body.draftDetail && body.draftDetail.picks) || [])) {
    const pid = pk && pk.playerId != null ? String(pk.playerId) : null;
    if (!pid || pid === "-1") continue;
    const bid = Number(pk.bidAmount);
    if (Number.isFinite(bid)) paidBy.set(pid, bid);
  }

  /* The free-agent pool is what sets replacement level, so rostered players alone
     are not enough. kona_player_info takes its bounds from a filter header. */
  const url = `${ESPN_READ}/seasons/${encodeURIComponent(cred.season)}/segments/0/leagues/${encodeURIComponent(cred.leagueId)}?view=kona_player_info`;
  const headers = { Accept: "application/json",
    "X-Fantasy-Filter": JSON.stringify({ players: { limit: 500,
      sortPercOwned: { sortAsc: false, sortPriority: 1 } } }) };
  if (cred.s2 && cred.swid) {
    const swid = String(cred.swid).startsWith("{") ? cred.swid : `{${cred.swid}}`;
    headers.Cookie = `espn_s2=${cred.s2}; SWID=${swid}`;
  }
  let poolRows = [];
  try {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const pj = await res.json();
      poolRows = ((pj && pj.players) || []).map(e => espnPlayerRow(e.player, cred.season, seasonWeeks, paidBy)).filter(Boolean);
    }
  } catch { poolRows = []; }

  // rostered players are authoritative for the roster view and backfill the pool
  const rostered = new Map();
  const teams = (body.teams || []).map((t, i) => {
    const entries = (t.roster && t.roster.entries) || [];
    const players = [];
    const starters = [];
    for (const e of entries) {
      const row = espnPlayerRow(e.playerPoolEntry && e.playerPoolEntry.player, cred.season, seasonWeeks, paidBy);
      if (!row) continue;
      rostered.set(row.id, row);
      players.push(row.id);
      // lineupSlotId 20 = bench, 21 = IR; anything else is a starting slot
      const slot = Number(e.lineupSlotId);
      if (slot !== 20 && slot !== 21) starters.push(row.id);
    }
    return {
      id: String(t.id),
      name: [t.location, t.nickname].filter(Boolean).join(" ").trim() || t.name || `Team ${i + 1}`,
      owner: ownerName((t.owners && t.owners[0]) || ""),
      players, starters,
    };
  });
  const poolById = new Map(poolRows.map(p => [p.id, p]));
  for (const [id, row] of rostered) if (!poolById.has(id)) poolById.set(id, row);

  /* ESPN's schedule is one row per matchup with home/away team ids, keyed by
     matchupPeriodId. The War Room wants an array of weeks, each a list of pairs. */
  const byWeek = new Map();
  const rawSchedule = body.schedule;
  let schedRows = 0, noWeek = 0, noHome = 0, noAway = 0;
  for (const g of (Array.isArray(rawSchedule) ? rawSchedule : [])) {
    schedRows++;
    const wk = Number(g.matchupPeriodId);
    const home = g.home && g.home.teamId, away = g.away && g.away.teamId;
    if (!wk) { noWeek++; continue; }
    if (home == null) { noHome++; continue; }
    if (away == null) { noAway++; continue; }            // byes carry no away side
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push([String(home), String(away)]);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  const schedule = weeks.map(w => byWeek.get(w));

  const scheduleState =
    rawSchedule == null ? "absent" :
    !Array.isArray(rawSchedule) ? "unexpected-type" :
    schedRows === 0 ? "empty" :
    schedule.length === 0 ? "unparseable" : "ok";
  const scheduleNote = {
    "absent": "ESPN's mSchedule view came back with no `schedule` key at all for this league, so no matchups could be read. That is a view or credential problem, not an empty schedule.",
    "unexpected-type": "ESPN returned a `schedule` value that is not an array, so no matchups could be read. The shape of this view has changed.",
    "empty": "ESPN has not published a matchup schedule for this league this season yet, so playoff odds cannot be simulated. Nothing is broken here — the odds fill in once ESPN posts the schedule.",
    "unparseable": "ESPN returned " + schedRows + " schedule rows and none could be read as a matchup (" +
      noWeek + " with no matchupPeriodId, " + noHome + " with no home team, " + noAway +
      " with no away team). The schedule exists and this parse cannot read it — that is a bug on our side.",
    "ok": "",
  }[scheduleState];

  const sched = s.scheduleSettings || {};
  return { ok: true, body: {
    league: {
      id: String(body.id || ""), name: s.name || "ESPN league",
      season: Number(body.seasonId) || null, size: Number(s.size) || teams.length,
      dynasty: false,
      playoffTeams: Number(sched.playoffTeamCount) || Math.max(2, Math.round(teams.length / 3)),
      playoffStart: Number(sched.matchupPeriodCount) ? Number(sched.matchupPeriodCount) + 1 : 15,
      scoring: espnScoring(s),
      slots: espnRosterSlots(s),
    },
    teams, pool: [...poolById.values()], schedule,
    diagnostics: {
      poolSize: poolById.size, fromPlayerIndex: poolRows.length, rostered: rostered.size,
      /* ⚠️ Report this. An unprojected player used to arrive as a 0 and pull replacement
         level down; now he arrives as null and the page must exclude him and say how many. */
      unprojected: [...poolById.values()].filter(r => r.p == null).length,
      priced: [...poolById.values()].filter(r => r.paid != null).length,
      regularSeasonWeeks: seasonWeeks,
      weeks: schedule.length,
      /* ⚠️ `weeks: 0` used to be the whole story, and it has three different causes with
         three different fixes: ESPN never published a schedule, ESPN published one this
         parse cannot read, or the view came back without the key at all. Reporting them
         as one number is what made this undiagnosable from the outside. Do not fold these
         back into a single flag. */
      scheduleState, scheduleRows: schedRows,
      scheduleSkipped: { noMatchupPeriodId: noWeek, noHomeTeam: noHome, noAwayTeam: noAway },
      scheduleNote,
      note: poolRows.length ? "" : "ESPN's player index did not answer, so replacement level is computed from rostered players only and will read high.",
    },
  } };
}

/* ---- routes -------------------------------------------------------------- */
async function handleEspn(request, url, env, cors) {
  const kv = env.RL || null;
  if (!kv) return json({ error: "credential storage is unavailable" }, 503, cors);

  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 401, cors);
  // uid, never the display name: names are self-chosen and may repeat.
  const uid = auth.uid || (auth.user && auth.user.uid) || null;
  if (!uid) return json({ error: "This account predates per-user ids. Sign in again to connect ESPN." }, 409, cors);

  const path = url.pathname.replace(/^\/espn\/?/, "");
  const stored = async () => {
    let blob = null;
    try { blob = await kv.get(espnKvKey(uid)); } catch { blob = null; }
    return blob ? espnOpen(env, uid, blob) : null;
  };

  if (path === "connect" && request.method === "DELETE") {
    try { await kv.delete(espnKvKey(uid)); } catch {}
    /* a share reads through the credential, so disconnecting must revoke it too —
       otherwise a link the owner believes is dead sits there returning 409s forever */
    try {
      const tok = await kv.get(ESPN_SHARE_OF_PREFIX + uid);
      if (tok) await kv.delete(ESPN_SHARE_PREFIX + tok);
      await kv.delete(ESPN_SHARE_OF_PREFIX + uid);
    } catch {}
    return json({ ok: true, connected: false }, 200, cors);
  }

  if (path === "connect" && request.method === "GET") {
    const cred = await stored();
    // status only — never the credential
    return json({ ok: true, connected: !!cred,
      leagueId: cred ? cred.leagueId : null, season: cred ? cred.season : null,
      connectedAt: cred ? cred.at : null }, 200, cors);
  }

  if (path === "connect" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch { return json({ error: "Send JSON." }, 400, cors); }
    const leagueId = String(body.leagueId || "").trim();
    const season = String(body.season || "").trim();
    if (!/^\d{1,12}$/.test(leagueId)) return json({ error: "That does not look like an ESPN league id." }, 400, cors);
    if (!/^\d{4}$/.test(season)) return json({ error: "Season must be a four-digit year." }, 400, cors);
    const s2 = body.s2 == null ? "" : String(body.s2).trim();
    const swid = body.swid == null ? "" : String(body.swid).trim();
    if ((s2 && !swid) || (swid && !s2)) return json({ error: "ESPN needs both espn_s2 and SWID, or neither." }, 400, cors);
    if (s2.length > 4096 || swid.length > 256) return json({ error: "Those values are longer than ESPN's." }, 400, cors);

    // Public first: if the league reads without credentials, store none.
    let cred = null;
    let probe = await espnFetch(leagueId, season, ["mSettings"], null);
    if (!probe.ok && (probe.status === 401 || probe.status === 403)) {
      if (!s2) return json({ error: probe.reason, needsCredentials: true }, 401, cors);
      cred = { s2, swid };
      probe = await espnFetch(leagueId, season, ["mSettings"], cred);
    }
    if (!probe.ok) return json({ error: probe.reason, needsCredentials: probe.status === 401 || probe.status === 403 }, 400, cors);

    const record = { leagueId, season: Number(season), at: new Date().toISOString(),
      s2: cred ? cred.s2 : "", swid: cred ? cred.swid : "" };
    try { await kv.put(espnKvKey(uid), await espnSeal(env, uid, record), { expirationTtl: ESPN_CRED_TTL }); }
    catch { return json({ error: "Could not save the connection." }, 500, cors); }
    const league = espnNormalizeLeague(probe.body);
    return json({ ok: true, connected: true, private: !!cred, league }, 200, cors);
  }

  if (path === "league" && request.method === "GET") {
    const cred = await stored();
    if (!cred) return json({ error: "No ESPN league connected for this account." }, 404, cors);
    const r = await espnFetch(cred.leagueId, cred.season,
      ["mSettings", "mTeam", "mRoster", "mDraftDetail"], cred.s2 ? cred : null);
    if (!r.ok) return json({ error: r.reason, needsCredentials: r.status === 401 || r.status === 403 }, 400, cors);
    return json({ ok: true, league: espnNormalizeLeague(r.body), draft: await espnPicksWithNames(cred, r.body) }, 200, cors);
  }

  if (path === "warroom" && request.method === "GET") {
    const cred = await stored();
    if (!cred) return json({ error: "No ESPN league connected for this account." }, 404, cors);
    const r = await espnWarroomFeed(cred);
    if (!r.ok) return json({ error: r.reason, needsCredentials: r.status === 401 || r.status === 403 }, 400, cors);
    /* DataDawg$ rides along for THIS league's players only - see the DD$ block */
    ddDecorateBody(await ddLoadBoard(env, "espn", cred.leagueId, "season"), r.body);
    return json({ ok: true, ...r.body }, 200, cors);
  }

  if (path === "share" && request.method === "GET") {
    let tok = null;
    try { tok = await kv.get(ESPN_SHARE_OF_PREFIX + uid); } catch { tok = null; }
    return json({ ok: true, shared: !!tok, url: tok ? `${SITE}/fantasy-warroom.html?share=${tok}` : null }, 200, cors);
  }

  if (path === "share" && request.method === "POST") {
    const cred = await stored();
    if (!cred) return json({ error: "Connect an ESPN league before sharing it." }, 404, cors);
    let tok = null;
    try { tok = await kv.get(ESPN_SHARE_OF_PREFIX + uid); } catch { tok = null; }
    if (!tok) {
      tok = espnShareToken();
      const rec = { uid, leagueId: String(cred.leagueId), season: cred.season, at: Date.now() };
      await kv.put(ESPN_SHARE_PREFIX + tok, JSON.stringify(rec), { expirationTtl: ESPN_CRED_TTL });
      await kv.put(ESPN_SHARE_OF_PREFIX + uid, tok, { expirationTtl: ESPN_CRED_TTL });
    }
    return json({ ok: true, url: `${SITE}/fantasy-warroom.html?share=${tok}` }, 200, cors);
  }

  if (path === "share" && request.method === "DELETE") {
    let tok = null;
    try { tok = await kv.get(ESPN_SHARE_OF_PREFIX + uid); } catch { tok = null; }
    if (tok) { try { await kv.delete(ESPN_SHARE_PREFIX + tok); } catch {} }
    try { await kv.delete(ESPN_SHARE_OF_PREFIX + uid); } catch {}
    return json({ ok: true, shared: false }, 200, cors);
  }

  if (path === "picks" && request.method === "GET") {
    const cred = await stored();
    if (!cred) return json({ error: "No ESPN league connected for this account." }, 404, cors);
    const r = await espnFetch(cred.leagueId, cred.season,
      ["mDraftDetail", "mTeam", "mRoster"], cred.s2 ? cred : null);
    if (!r.ok) return json({ error: r.reason, needsCredentials: r.status === 401 || r.status === 403 }, 400, cors);
    return json({ ok: true, ...(await espnPicksWithNames(cred, r.body)) }, 200, cors);
  }

  return json({ error: "Unknown ESPN route." }, 404, cors);
}

async function handleSleeperPlayersSlim(request, env, cors) {
  if (request.method !== "GET") return json({ error: "GET only" }, 405, cors);
  // Names RL explicitly — see the survivorKV note.
  const kv = env.RL || null;
  if (!kv) return json({ error: "player index storage is unavailable" }, 503, cors);

  const serve = (body, extra) => new Response(body, {
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", ...(extra || {}) },
  });

  let cached = null;
  try { cached = await kv.get(SLEEPER_SLIM_KEY); } catch { cached = null; }
  if (cached) {
    try {
      const builtMs = Date.parse(JSON.parse(cached).built || "");
      if (Number.isFinite(builtMs) && Date.now() - builtMs < SLEEPER_SLIM_TTL_MS) return serve(cached);
    } catch { cached = null; } // unparseable cache is no cache
  }

  let slim;
  try {
    const r = await fetch(SLEEPER_PLAYERS_URL);
    if (!r.ok) throw new Error("Sleeper /players/nfl returned " + r.status);
    slim = sleeperSlimFromRaw(await r.json());
  } catch (e) {
    if (cached) {
      // Serve the stale copy and say so, rather than failing a working page.
      try {
        const payload = JSON.parse(cached);
        payload.note = String(payload.note || "") + " STALE: refresh failed (" + String((e && e.message) || e) + "); serving the previous day's index.";
        return serve(JSON.stringify(payload), { "X-DD-Stale": "1" });
      } catch { /* fall through */ }
    }
    return json({ error: "player index refresh failed: " + String((e && e.message) || e) }, 503, cors);
  }

  const now = new Date().toISOString();
  const payload = JSON.stringify({
    as_of: now.slice(0, 10),
    source: "Sleeper /players/nfl, slimmed to active fantasy positions by the Data Dawgs Worker.",
    note: "Identity only: player id -> [name, position, nfl team]. Refreshed at most once per day per Sleeper's own guidance. No stats, no projections.",
    built: now,
    canonical_url: "https://toto.jkapcar4.workers.dev/sleeper/players-slim",
    data: { count: slim.count, players: slim.players },
  });
  try { await kv.put(SLEEPER_SLIM_KEY, payload); } catch { /* serving still works without the cache */ }
  return serve(payload);
}

export default {
  // Two isolated jobs share this Worker: the nightly private RTDB backup and the
  // hourly public-data CFB receipt capture. Never run the backup hourly: it contains
  // sensitive auth material and exists for disaster recovery, not polling.
  async scheduled(controller, env, ctx) {
    const cron = (controller && controller.cron) || "";
    // Bozo closes: fires every five minutes and does nothing on a tick with no game
    // about to start, which is the overwhelming majority of them. One RTDB read.
    if (cron === BOZO_CLOSE_CRON) {
      try {
        return await runBozoCloseCapture(env, (controller && controller.scheduledTime) || Date.now());
      } catch (e) {
        const kv = cfbMarketKV(env);
        if (kv) await kv.put("bozo:close:lasterror",
          JSON.stringify({ at: new Date().toISOString(), error: String((e && e.message) || e) }));
        throw e;
      }
    }
    if (cron === CFB_MARKET_CRON) {
      const scheduledTime = (controller && controller.scheduledTime) || Date.now();
      const marketRun = runCfbMarketCapture(env, scheduledTime).catch(async e => {
        const kv = cfbMarketKV(env);
        if (kv) await kv.put(CFB_MARKET_PREFIX + "lasterror",
          JSON.stringify({ at: new Date().toISOString(), error: String((e && e.message) || e) }));
        throw e;
      });
      const [market, schedules] = await Promise.all([marketRun, runBozoScheduleRefresh(env, scheduledTime)]);
      return { ...market, schedules };
    }
    // Missing cron preserves the local test/manual-call contract. Production names
    // the daily trigger explicitly, and an unknown configured cron fails closed.
    if (cron && cron !== BACKUP_CRON) throw new Error("unknown scheduled trigger: " + cron);
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
    // Keep renewal outside the dispatcher: every authenticated route, including old
    // compatibility aliases, gets the same sliding-session behavior automatically.
    const dispatch = async () => {
    const url = new URL(request.url);
    // DD-MCP-ROUTE — matched before ANY Origin-gated handler; see the block at the bottom.
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) return handleMcp(request, url, env);
    const origin = request.headers.get("Origin") || "";
    const cors = corsFor(origin);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    if (url.pathname === "/scores")       return handleScores(url, env, cors);
    if (url.pathname === "/dk/lobby")     return handleDkLobby(request, url, cors);
    if (url.pathname === "/dk/draftables") return handleDkDraftables(request, url, cors);
    if (url.pathname === "/survivor-picks") return handleSurvivorPicks(request, url, env, cors);
    if (url.pathname === "/cfb/market-snapshots") return handleCfbMarketSnapshots(request, url, env, cors);
    if (url.pathname === "/sleeper/players-slim") return handleSleeperPlayersSlim(request, env, cors);
    if (url.pathname.startsWith("/api/swoledawg")) return handleSwole(request, url, env, cors);
    // DD-RANKINGS-ROUTE — The Dog Track capture half; see the DD-RANKINGS-BLOCK below.
    if (url.pathname.startsWith("/rankings/")) return handleRankings(request, url, env, cors);
    // the shared read is public by design and must not reach handleEspn's session gate
    if (url.pathname.startsWith("/espn/share/") && request.method === "GET")
      return handleEspnShareRead(request, url, env, cors);
    if (url.pathname === "/dd/values") return handleDdValues(request, env, cors);
    if (url.pathname === "/espn" || url.pathname.startsWith("/espn/")) return handleEspn(request, url, env, cors);
    // DD-YAHOO-ROUTE — public share read first; every other Yahoo route is session-gated in handleYahoo.
    if (url.pathname.startsWith("/yahoo/share/") && request.method === "GET") return handleYahooShareRead(request, url, env, cors);
    if (url.pathname === "/yahoo" || url.pathname.startsWith("/yahoo/")) return handleYahoo(request, url, env, cors);

    // ⚠️ Identity is SITE-WIDE, not Bozo's. /auth/* is canonical; the /bozo/* spellings
    // are permanent aliases because bozo.html in the wild (and any phone with a cached
    // page) still calls them. Never remove the aliases — a stale service-worker copy of
    // the page would lose the ability to sign in.
    // ⚠️ "/reset" was already taken by the ADMIN-only clear-the-hash route (bozoReset)
    // long before CEP-6 existed. The email flow is "/reset-password" — do not rename
    // either one to tidy this up: bozo.html and signon.html in the wild still call
    // /auth/reset expecting the admin behaviour, and a cached page would silently start
    // hitting a route with completely different semantics.
    const AUTH = { "/roster": bozoRoster, "/claim": bozoClaim, "/login": bozoLogin,
                   "/passwd": bozoPasswd, "/reset": bozoReset, "/invite": authInvite,
                   "/mcp-token": authMcpToken, "/email": authEmail, "/name": authName,
                   "/email-confirm": authEmailConfirm, "/signup": bozoSignup,
                   "/lookup": authLookup,
                   "/verify-request": authVerifyRequest, "/verify": authVerify,
                   "/forgot": authForgot, "/reset-password": authReset };
    for (const [suffix, fn] of Object.entries(AUTH)) {
      if (url.pathname === "/auth" + suffix || url.pathname === "/bozo" + suffix)
        return suffix === "/roster" ? fn(env, cors) : fn(request, env, cors);
    }
    if (url.pathname === "/auth/draft-state") return authDraftState(request, url, env, cors);
    if (url.pathname === "/auth/guillotine-state") return authGuillotineState(request, env, cors);
    if (url.pathname === "/league/mine")   return universalLeagueMine(request, env, cors);
    if (url.pathname === "/league/gate")   return universalLeagueGate(request, env, cors);
    if (url.pathname === "/league/list")   return leagueList(request, env, cors);
    if (url.pathname === "/league/search") return leagueSearch(request, env, cors);
    if (url.pathname === "/league/create") return leagueCreateDispatch(request, env, cors);
    if (url.pathname === "/league/delete") return leagueDelete(request, env, cors);
    if (url.pathname === "/league/import") return leagueImport(request, env, cors);
    if (url.pathname === "/league/member") return leagueMember(request, env, cors);
    if (url.pathname === "/league/join")
      return request.method === "GET" ? retiredLeagueLink(cors) : leagueJoinDispatch(request, env, cors);
    if (url.pathname === "/league/access") return leagueAccess(request, env, cors);
    if (url.pathname === "/league/join-code") return leagueAccessLegacy(request, env, cors);
    if (url.pathname === "/league/lock")   return leagueLock(request, env, cors);
    if (url.pathname === "/league/slip")   return leagueSlip(request, env, cors);
    if (url.pathname === "/league/config") return bozoConfigSet(request, env, cors);
    if (url.pathname === "/league/settings") return leagueSettings(request, env, cors);
    if (url.pathname === "/league/team")   return leagueTeam(request, env, cors);
    if (url.pathname === "/league/invite") return retiredLeagueInvite(cors);

    // DDCC is account-backed. Every handler derives its user from the signed session;
    // no request body can choose whose attempts or receipts are read or written.
    if (url.pathname === "/ddcc/state")  return ddccState(request, env, cors);
    if (url.pathname === "/ddcc/start")  return ddccStart(request, env, cors);
    if (url.pathname === "/ddcc/answer") return ddccAnswer(request, env, cors);
    if (url.pathname === "/ddcc/review") return ddccReview(request, url, env, cors);
    if (url.pathname === "/ddcc/admin/questions") return ddccImportQuestions(request, env, cors);

    // The forecasting challenge. Storage and entrants — no page calls these yet.
    // ⚠️ A BOT TOKEN IS HONOURED ON /forecast/entry AND NOWHERE ELSE, and that scoping
    // lives HERE rather than inside the handlers. Only forecastEntry calls fcEntrantAuth;
    // every other route below still calls sessionAuth, so an X-DD-Bot header sent at them
    // is not "rejected" so much as never consulted. Put the check in a handler instead and
    // the next route someone adds inherits whichever auth they happen to copy.
    if (url.pathname === "/forecast/entry")   return forecastEntry(request, env, cors);
    if (url.pathname === "/forecast/entries") return forecastMine(request, url, env, cors);
    if (url.pathname === "/forecast/game")    return forecastGame(request, url, env, cors);
    if (url.pathname === "/forecast/seal")    return forecastSeal(request, env, cors);
    if (url.pathname === "/forecast/week")    return forecastWeek(request, url, env, cors);
    if (url.pathname === "/forecast/bot")     return forecastBot(request, env, cors);
    if (url.pathname === "/forecast/bots")    return forecastBots(request, env, cors);
    if (url.pathname === "/bozo/pick")    return bozoPick(request, env, cors);
    if (url.pathname === "/bozo/grade")   return bozoGrade(request, env, cors);
    if (url.pathname === "/bozo/next")    return bozoNext(request, env, cors);
    if (url.pathname === "/bozo/buyback") return bozoBuyback(request, env, cors);
    if (url.pathname === "/bozo/clv")     return bozoClv(request, url, env, cors);
    if (url.pathname === "/bozo/close")   return bozoCloseFill(request, env, cors);
    if (url.pathname === "/bozo/close-gaps") return bozoCloseGaps(request, url, env, cors);
    if (url.pathname === "/bozo/config")  return bozoConfigSet(request, env, cors);
    if (url.pathname === "/tts")          return handleTts(request, env, cors);
    if (url.pathname === "/tts/models")   return ttsModels(request, env, cors);
    if (url.pathname === "/tts/voices")   return ttsVoices(request, env, cors);

    return handleChat(request, env, origin, cors);
    };
    const response = await dispatch();
    return attachSlidingSession(request, env, response);
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
// Worker egress cannot reach ESPN. NFL and CFB now come from the same compact,
// scheduled KV documents the grader uses; unsupported sports fail explicitly instead
// of taking three doomed ESPN trips. bozo.html still tries browser-side ESPN first, but
// this route is now a real fallback rather than a diagnostic dead end.
// These header shapes remain shared by two non-Bozo legacy recovery paths below. They
// are deliberately not used here: ESPN's block is by egress IP, not header shape.
const UA_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
const FETCH_SHAPES = [
  { name: "browser", headers: { "User-Agent": UA_CHROME, "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9", "Referer": "https://www.espn.com/", "Origin": "https://www.espn.com" } },
  { name: "ua-only", headers: { "User-Agent": UA_CHROME } },
  { name: "bare", headers: {} },
];

/* ============================== /dk/* (CORS only) ============================== */
// DraftKings public lobby + draftables. DFS Labs Phase 0: browser cannot call DK
// directly (CORS), so toto forwards GET responses and stores nothing (Bible I2).
// Never log or KV-put player lists. ContestTypeId 21 = Classic, 96 = Showdown CPT.

const DK_UA = "Mozilla/5.0 (compatible; DataDawgsDFS/1.0; +https://datadawgs216.com)";
const DK_LOBBY = "https://www.draftkings.com/lobby/getcontests";
const DK_DRAFTABLES = "https://api.draftkings.com/draftgroups/v1/draftgroups";

async function dkUpstream(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: { "User-Agent": DK_UA, "Accept": "application/json" },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch {
    const err = new Error("DraftKings returned non-JSON (HTTP " + res.status + ")");
    err.status = 502;
    throw err;
  }
  if (!res.ok) {
    const err = new Error("DraftKings HTTP " + res.status);
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.body = body;
    throw err;
  }
  return body;
}

async function handleDkLobby(request, url, cors) {
  if (request.method !== "GET") return json({ error: "GET only" }, 405, cors);
  const sport = String(url.searchParams.get("sport") || "NFL").toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(sport)) return json({ error: "sport must be a short code like NFL" }, 400, cors);
  try {
    const body = await dkUpstream(DK_LOBBY + "?sport=" + encodeURIComponent(sport));
    return new Response(JSON.stringify(body), {
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return json({ error: "dk_lobby_failed", detail: String(e.message || e) }, e.status || 502, cors);
  }
}

async function handleDkDraftables(request, url, cors) {
  if (request.method !== "GET") return json({ error: "GET only" }, 405, cors);
  const id = String(url.searchParams.get("draftGroupId") || "").trim();
  if (!/^\d{1,12}$/.test(id)) return json({ error: "draftGroupId must be a positive integer" }, 400, cors);
  try {
    const body = await dkUpstream(DK_DRAFTABLES + "/" + id + "/draftables");
    return new Response(JSON.stringify(body), {
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return json({ error: "dk_draftables_failed", detail: String(e.message || e) }, e.status || 502, cors);
  }
}

async function handleScores(url, env, cors) {
  const sport = url.searchParams.get("sport");
  const dates = url.searchParams.get("dates") || "";
  if (!BOZO_GRADEABLE_SPORTS.has(sport))
    return json({ error: "sport_not_gradeable", sport,
      detail: "NFL and CFB are the only sports with a Worker-reachable schedule adapter." }, 422, cors);
  let doc;
  try { doc = await bozoScheduleDoc(env, sport, SEASON); }
  catch (e) { return json({ error: "scores unavailable", detail: e.message }, 503, cors); }
  if (!doc) return json({ error: "scores unavailable", detail: `schedule:${sport}:${SEASON} is not populated yet` }, 503, cors);
  const games = bozoPublicScheduleGames(doc, dates);
  return new Response(JSON.stringify({ sport, games, via: doc.source, fetched: doc.fetchedAt }), {
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

async function fbDelete(env, path, etag) {
  const r = await fetch(fbUrl(env, path), {
    method: "DELETE",
    headers: etag ? { "if-match": etag } : {},
  });
  if (r.status === 412) return false;
  if (!r.ok) throw new Error("RTDB delete " + r.status);
  return true;
}

async function fbPost(env, path, value) {
  const r = await fetch(fbUrl(env, path), {
    method: "POST",
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error("RTDB append " + r.status);
  const data = await r.json();
  if (!data || typeof data.name !== "string" || !data.name)
    throw new Error("RTDB append returned no event id");
  return data.name;
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
// Names RL explicitly — see the survivorKV note. This one is the disaster-recovery copy;
// a fallback that silently pointed it at an empty namespace would look identical to a
// working backup right up until the day it was needed.
const backupKV = (env) => env.RL || null;

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
const SESSION_RENEW_AFTER_MS = 7 * 864e5;
const LOGIN_FAIL_CAP = 10;        // per player per hour; needs the RL binding
const LOOKUP_IP_CAP = 60;         // explicit enumeration is accepted, not unlimited
const MIN_PW = 8;
const UID_PATTERN = "^u_[A-Za-z0-9_-]{22,64}$";
const UID_RE = new RegExp(UID_PATTERN);

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
async function makeSession(env, name, setAt, uid) {
  const now = Date.now();
  const payload = b64urlStr(JSON.stringify({
    ...(uid ? { u: uid } : {}), n: name, i: now,
    e: now + SESSION_DAYS * 864e5, p: setAt || 0,
  }));
  return payload + "." + (await hmac(env.BOZO_PEPPER, payload));
}

async function readSession(env, tok) {
  if (typeof tok !== "string" || tok.indexOf(".") < 1) return null;
  const [payload, sig] = tok.split(".");
  if (!timingSafeEqual(sig || "", await hmac(env.BOZO_PEPPER, payload))) return null;
  let o;
  try { o = JSON.parse(unb64urlStr(payload)); } catch { return null; }
  if (!o || (!o.n && !o.u) || !o.e || Date.now() > o.e) return null;
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

  // Greenfield identity sessions carry immutable `u`. Legacy name-keyed sessions carry
  // only `n` and continue through the untouched branch below until the post-draft wipe.
  // Draft-state refuses the legacy shape rather than pretending a mutable display name
  // is a UID. That keeps Tranche B inert until the UID auth deployment is complete.
  if (sess.u) {
    let rec;
    try { rec = (await fbGet(env, "/users/" + encodeURIComponent(sess.u))).data; }
    catch (e) { return { err: "Database unreachable: " + e.message, code: 502 }; }
    if (!rec || typeof rec !== "object") return { err: "Unknown account.", code: 403 };
    const setAt = rec.passwordSetAt == null ? rec.setAt : rec.passwordSetAt;
    if ((setAt || 0) !== (sess.p || 0))
      return { err: "Your password changed — sign in again.", code: 401 };
    return { uid: sess.u, name: String(rec.name || sess.n || ""), user: rec,
             passwordSetAt: setAt || 0 };
  }

  let players, legacyUser;
  try {
    const users = await loadUsers(env);
    players = userNames(users);
    legacyUser = users[encodeURIComponent(sess.n)] || users[sess.n];
  }
  catch (e) { return { err: e.message, code: 502 }; }
  // Membership is checked against /users, so removing someone from the roster kills
  // their session on the next request rather than leaving it valid until expiry.
  if (!legacyUser) return { err: "Unknown player.", code: 403 };

  // The session must still match the password on file (see makeSession).
  let rec;
  try { rec = (await fbGet(env, authPath(sess.n))).data; }
  catch (e) { return { err: "Database unreachable: " + e.message, code: 502 }; }
  if (!rec) return { err: "Your password was reset — use your join link again.", code: 401 };
  if ((rec.setAt || 0) !== (sess.p || 0))
    return { err: "Your password changed — sign in again.", code: 401 };

  return { name: sess.n, players, passwordSetAt: rec.setAt || 0 };
}

async function attachSlidingSession(request, env, response) {
  if (!(response instanceof Response) || request.method === "OPTIONS") return response;
  const token = request.headers.get("X-Dawg-Session") || request.headers.get("X-Bozo-Session") || "";
  if (!token) return response;
  const sess = await readSession(env, token);
  // Tokens minted before `i` existed renew on their first successful authenticated call.
  if (!sess || (Number.isFinite(sess.i) && Date.now() - sess.i < SESSION_RENEW_AFTER_MS)) return response;
  const auth = await sessionAuth(request, env);
  if (auth.err) return response;
  const renewed = await makeSession(env, auth.name, auth.passwordSetAt, auth.uid);
  const headers = new Headers(response.headers);
  headers.set("X-Dawg-Session", renewed);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// GET/PUT /auth/draft-state?league_id=<id>
//
// This dirty-local-wins CAS policy is ONLY for one user's private scratchpad. Shared
// game writes never copy it: they append immutable /leagues/<id>/events rows under D7.
async function authDraftState(request, url, env, cors) {
  if (request.method !== "GET" && request.method !== "PUT")
    return draftError(cors, 405, "method_not_allowed", "Use GET or PUT.");

  const auth = await sessionAuth(request, env);
  if (auth.err) {
    const code = auth.code || 401;
    return draftError(cors, code, code === 401 ? "unauthenticated" : code === 403 ? "forbidden" : "backend_unavailable", auth.err);
  }
  if (!auth.uid)
    return draftError(cors, 403, "forbidden", "This account must use the UID identity system before personal draft state can sync.");

  const ids = url.searchParams.getAll("league_id");
  const leagueId = ids.length === 1 ? ids[0] : "";
  if (!DRAFT_LEAGUE_ID_RE.test(leagueId))
    return draftError(cors, 400, "invalid_league_id", "Provide exactly one valid league_id.");

  let league;
  try { league = (await fbGet(env, "/leagues/" + leagueId)).data; }
  catch (e) { return draftError(cors, 502, "backend_unavailable", "The league store could not be read."); }
  if (!league) return draftError(cors, 404, "league_not_found", "That league does not exist.");
  if (league.game !== "draft" || (league.visibility != null && league.visibility !== "public"))
    return draftError(cors, 403, "forbidden", "Personal draft state is available only for public draft leagues.");

  const statePath = "/users/" + encodeURIComponent(auth.uid) + "/draftState/" + leagueId;
  if (request.method === "GET") {
    try {
      const stored = checkedDraftRecord((await fbGet(env, statePath)).data);
      if (!stored.ok) return draftError(cors, 502, "backend_unavailable", "The saved draft state is invalid.");
      return json(draftStateEnvelope(leagueId, stored.record), 200, cors);
    } catch (e) {
      return draftError(cors, 502, "backend_unavailable", "The draft-state store could not be read.");
    }
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType))
    return draftError(cors, 415, "unsupported_media_type", "PUT requires Content-Type: application/json.");
  const parsed = await readCappedJson(request, DRAFT_STATE_MAX_BYTES);
  if (parsed.tooLarge)
    return draftError(cors, 413, "payload_too_large", "The request body exceeds 65,536 bytes.");
  if (parsed.malformed)
    return draftError(cors, 400, "invalid_json", "The request body must be valid UTF-8 JSON.");
  if (!draftExactKeys(parsed.value, ["baseVersion", "state"]) ||
      !Number.isSafeInteger(parsed.value.baseVersion) || parsed.value.baseVersion < 0)
    return draftError(cors, 422, "invalid_state", "The body must contain exactly a non-negative baseVersion and state.", { field: "/" });
  const checked = validateDraftState(parsed.value.state);
  if (!checked.ok)
    return draftError(cors, 422, "invalid_state", checked.message, { field: checked.field });

  let currentRead;
  try { currentRead = await fbGet(env, statePath, true); }
  catch (e) { return draftError(cors, 502, "backend_unavailable", "The draft-state store could not be read."); }
  const stored = checkedDraftRecord(currentRead.data);
  if (!stored.ok || !currentRead.etag)
    return draftError(cors, 502, "backend_unavailable", "The saved draft-state version is invalid.");
  const current = stored.record;
  const currentVersion = current ? current.version : 0;
  if (currentVersion === Number.MAX_SAFE_INTEGER)
    return draftError(cors, 502, "backend_unavailable", "The saved draft-state version is invalid.");
  if (parsed.value.baseVersion !== currentVersion)
    return draftError(cors, 409, "version_conflict", "The saved draft state changed after this client loaded it.",
      { current: draftStateEnvelope(leagueId, current) });

  const record = { version: currentVersion + 1, updatedAt: Date.now(), state: checked.state };
  let wrote;
  try { wrote = await fbPut(env, statePath, record, currentRead.etag); }
  catch (e) { return draftError(cors, 502, "backend_unavailable", "The draft-state store could not be written."); }
  if (!wrote) {
    let raced;
    try { raced = checkedDraftRecord((await fbGet(env, statePath)).data); }
    catch (e) { return draftError(cors, 502, "backend_unavailable", "The draft-state store could not be read after a conflict."); }
    if (!raced.ok) return draftError(cors, 502, "backend_unavailable", "The saved draft state is invalid after a conflict.");
    return draftError(cors, 409, "version_conflict", "The saved draft state changed after this client loaded it.",
      { current: draftStateEnvelope(leagueId, raced.record) });
  }
  return json(draftStateEnvelope(leagueId, record), 200, cors);
}

// GET/PUT /auth/guillotine-state
// Private per-UID shelf only. It stores no league data, prediction receipts, or
// ownership claim—just Sleeper IDs and the user's unverified focus-roster choices.
async function authGuillotineState(request, env, cors) {
  if (request.method !== "GET" && request.method !== "PUT")
    return draftError(cors, 405, "method_not_allowed", "Use GET or PUT.");
  const auth = await sessionAuth(request, env);
  if (auth.err) {
    const code = auth.code || 401;
    return draftError(cors, code, code === 401 ? "unauthenticated" : code === 403 ? "forbidden" : "backend_unavailable", auth.err);
  }
  if (!auth.uid)
    return draftError(cors, 403, "forbidden", "This account must use the UID identity system before its league shelf can sync.");

  const statePath = "/users/" + encodeURIComponent(auth.uid) + "/guillotineState";
  if (request.method === "GET") {
    try {
      const record = (await fbGet(env, statePath)).data;
      const stored = record && record.state ? record.state : { leagues: [] };
      const checked = validateGuillotineState(stored);
      // A legacy or malformed stored record is salvaged, not 502'd — see salvageGuillotineState.
      const state = checked.ok ? checked.state : salvageGuillotineState(stored);
      const body = { ok: true, state, updatedAt: Number(record && record.updatedAt) || null };
      if (!checked.ok) body.recovered = true;
      return json(body, 200, cors);
    } catch (e) {
      return draftError(cors, 502, "backend_unavailable", "The guillotine-state store could not be read.");
    }
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType))
    return draftError(cors, 415, "unsupported_media_type", "PUT requires Content-Type: application/json.");
  const parsed = await readCappedJson(request, GUILLOTINE_STATE_MAX_BYTES);
  if (parsed.tooLarge) return draftError(cors, 413, "payload_too_large", "The request body exceeds 16,384 bytes.");
  if (parsed.malformed) return draftError(cors, 400, "invalid_json", "The request body must be valid UTF-8 JSON.");
  const checked = validateGuillotineState(parsed.value);
  if (!checked.ok) return draftError(cors, 422, "invalid_state", checked.message, { field: checked.field });
  const record = { updatedAt: Date.now(), state: checked.state };
  try { await fbPut(env, statePath, record); }
  catch (e) { return draftError(cors, 502, "backend_unavailable", "The guillotine-state store could not be written."); }
  return json({ ok: true, state: checked.state, updatedAt: record.updatedAt }, 200, cors);
}

/* ================= Data Dawgs Confidence Calibration V1 ================== */
// The question bank lives at /ddcc/questions behind Firebase's default-deny rules. It is
// deliberately NOT a file in the public Pages tree. Active-attempt payloads are projected
// through ddccPublicQuestion, so truth values, explanations and sources stay server-side
// until the whole 40-response attempt is complete.
const DDCC_DOMAINS = [
  ["sports", "Sports"], ["us_history", "United States History"],
  ["world_history", "World History"], ["geography", "Geography"],
  ["government_civics_law", "Government, Civics & Law"], ["world_affairs", "World Affairs"],
  ["biology", "Biology"], ["medicine_human_body", "Medicine & the Human Body"],
  ["animals_nature", "Animals & Nature"], ["physics_chemistry", "Physics & Chemistry"],
  ["earth_environment", "Earth & Environment"], ["space_astronomy", "Space & Astronomy"],
  ["math_statistics_logic", "Mathematics, Statistics & Logic"],
  ["economics_finance", "Economics & Finance"], ["business_industry", "Business & Industry"],
  ["technology_computing_engineering", "Technology, Computing & Engineering"],
  ["psychology_human_behavior", "Psychology & Human Behavior"],
  ["arts_literature_language", "Arts, Literature & Language"],
  ["film_tv_music_pop_culture", "Film, Television, Music & Popular Culture"],
  ["food_everyday_life", "Food & Everyday Life"],
].map(([key, label]) => ({ key, label }));
const DDCC_DOMAIN_KEYS = DDCC_DOMAINS.map(d => d.key);
const DDCC_DOMAIN_LABELS = Object.fromEntries(DDCC_DOMAINS.map(d => [d.key, d.label]));
const DDCC_BINS = [[0, 20], [21, 40], [41, 60], [61, 80], [81, 100]];
const ddccUserPath = name => "/ddcc/users/" + encodeURIComponent(name).replace(/\./g, "%2E");

function ddccShuffle(values, random = Math.random) {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function ddccSelectQuestions(questions, completedIds, random = Math.random) {
  const seen = completedIds instanceof Set ? completedIds : new Set(completedIds || []);
  const active = (questions || []).filter(q => q && q.status === "active" && q.verified === true && !seen.has(q.id));
  const selected = [], shortages = [];
  for (const domain of DDCC_DOMAIN_KEYS) {
    const available = active.filter(q => q.domain === domain);
    if (available.length < 2) shortages.push({ domain, available: available.length, needed: 2 });
    else selected.push(...ddccShuffle(available, random).slice(0, 2));
  }
  if (shortages.length) {
    const e = new Error("Not enough unseen verified questions in every domain.");
    e.code = "DDCC_EXHAUSTED"; e.shortages = shortages; throw e;
  }
  return ddccShuffle(selected, random);
}

const ddccBrier = (p, truth) => ((p / 100) - (truth ? 1 : 0)) ** 2;
function ddccAggregate(rows, domain) {
  const use = (rows || []).filter(r => r && (!domain || r.domainSnapshot === domain) &&
    Number.isInteger(r.probability) && r.probability >= 0 && r.probability <= 100 &&
    typeof r.truthValueSnapshot === "boolean");
  const bins = DDCC_BINS.map(([min, max]) => ({ min, max, label: min + "–" + max,
    responseCount: 0, meanForecast: null, truthRate: null, _p: 0, _t: 0 }));
  let ps = 0, ts = 0, bs = 0, right = 0, directional = 0;
  for (const r of use) {
    const p = r.probability / 100, t = r.truthValueSnapshot ? 1 : 0;
    ps += p; ts += t; bs += ddccBrier(r.probability, r.truthValueSnapshot);
    if (r.probability !== 50) { directional++; if ((r.probability > 50) === r.truthValueSnapshot) right++; }
    const b = bins.find(x => r.probability >= x.min && r.probability <= x.max);
    b.responseCount++; b._p += p; b._t += t;
  }
  for (const b of bins) {
    if (b.responseCount) { b.meanForecast = b._p / b.responseCount; b.truthRate = b._t / b.responseCount; }
    delete b._p; delete b._t;
  }
  const n = use.length, meanForecast = n ? ps / n : null, truthRate = n ? ts / n : null;
  return { responseCount: n, meanForecast, truthRate,
    calibrationBias: n ? meanForecast - truthRate : null,
    meanBrierLoss: n ? bs / n : null,
    accuracy: directional ? right / directional : null, accuracyDenominator: directional, bins };
}

function ddccMilestone(n) {
  n = Math.max(0, Number(n) || 0);
  if (n >= 216) return { label: "Established DDCC Profile", threshold: 216, next: null, remaining: 0 };
  if (n >= 100) return { label: "Developing DDCC Profile", threshold: 100, next: 216, remaining: 216 - n };
  if (n >= 40) return { label: "Initial DDCC Profile", threshold: 40, next: 100, remaining: 100 - n };
  return { label: "Profile in progress", threshold: 0, next: 40, remaining: 40 - n };
}

function ddccAllAttempts(user) { return Object.values((user && user.attempts) || {}); }
function ddccResponses(attempt) { return Object.values((attempt && attempt.responses) || {}); }
function ddccCompletedRows(user) {
  return ddccAllAttempts(user).filter(a => a.status === "completed" && ddccResponses(a).length === 40)
    .flatMap(ddccResponses);
}
function ddccCompletedIds(user) { return new Set(ddccCompletedRows(user).map(r => r.questionId)); }
function ddccActiveAttempt(user) {
  if (!user || !user.activeAttemptId) return null;
  const a = user.attempts && user.attempts[user.activeAttemptId];
  return a && a.status === "in_progress" ? a : null;
}
function ddccPublicQuestion(q) {
  return q ? { id: q.id, claim: q.claim, domain: q.domain,
    domainLabel: DDCC_DOMAIN_LABELS[q.domain] || q.domain, version: q.version } : null;
}
function ddccCurrentIndex(attempt) {
  const responses = attempt.responses || {};
  const idx = attempt.questionOrder.findIndex(id => !responses[id]);
  return idx < 0 ? attempt.questionOrder.length : idx;
}
function ddccAttemptSummary(attempt) {
  const index = ddccCurrentIndex(attempt);
  const id = attempt.questionOrder[index];
  return { id: attempt.id, status: attempt.status, currentIndex: index,
    completedCount: ddccResponses(attempt).length, total: 40, startedAt: attempt.startedAt,
    currentQuestion: id ? ddccPublicQuestion(attempt.items[id]) : null };
}
function ddccProfile(user, domain) {
  const attempts = ddccAllAttempts(user).filter(a => a.status === "completed" && ddccResponses(a).length === 40);
  const rows = attempts.flatMap(ddccResponses);
  const metrics = ddccAggregate(rows, domain);
  return { ...metrics, completedQuizCount: attempts.length, milestone: ddccMilestone(rows.length),
    history: attempts.map(a => {
      const m = ddccAggregate(ddccResponses(a));
      return { id: a.id, completedAt: a.completedAt, responseCount: m.responseCount,
        meanBrierLoss: m.meanBrierLoss, calibrationBias: m.calibrationBias };
    }).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))) };
}
function ddccStatePayload(user) {
  const active = ddccActiveAttempt(user);
  return { ok: true, activeAttempt: active ? ddccAttemptSummary(active) : null,
    profile: ddccProfile(user),
    domainProfiles: Object.fromEntries(DDCC_DOMAIN_KEYS.map(k => [k, ddccAggregate(ddccCompletedRows(user), k)])),
    domains: DDCC_DOMAINS };
}

async function ddccAuth(request, env, cors) {
  const auth = await sessionAuth(request, env);
  return auth.err ? { response: json({ error: auth.err }, auth.code || 401, cors) } : { auth };
}
async function ddccReadUser(env, name, etag = false) {
  const got = await fbGet(env, ddccUserPath(name), etag);
  return { user: got.data && typeof got.data === "object" ? got.data : { attempts: {} }, etag: got.etag };
}
async function ddccReadQuestions(env) {
  const raw = (await fbGet(env, "/ddcc/questions")).data || {};
  return Array.isArray(raw) ? raw.filter(Boolean) : Object.values(raw);
}

function ddccValidateQuestionBank(rows) {
  const errors = [], ids = new Set(), claims = new Set();
  const counts = Object.fromEntries(DDCC_DOMAIN_KEYS.map(k => [k, { active: 0, true: 0, false: 0 }]));
  if (!Array.isArray(rows)) return { errors: ["questions must be an array"], counts };
  if (rows.length > 5000) errors.push("question bank exceeds the 5,000-record operational limit");
  rows.forEach((q, i) => {
    const at = "record " + (i + 1);
    if (!q || typeof q !== "object" || Array.isArray(q)) { errors.push(at + " must be an object"); return; }
    for (const key of ["id", "claim", "explanation", "sourceTitle", "sourceUrl", "sourceAccessedAt", "createdAt", "updatedAt"])
      if (typeof q[key] !== "string" || !q[key].trim()) errors.push(at + " missing " + key);
    if (typeof q.id === "string" && !/^[a-z0-9][a-z0-9-]{2,79}$/.test(q.id)) errors.push(at + " has an unsafe id");
    if (ids.has(q.id)) errors.push(at + " duplicates id " + q.id); else ids.add(q.id);
    const claim = typeof q.claim === "string" ? q.claim.trim().replace(/\s+/g, " ").toLowerCase() : "";
    if (claims.has(claim)) errors.push(at + " duplicates a claim"); else if (claim) claims.add(claim);
    if (!DDCC_DOMAIN_KEYS.includes(q.domain)) errors.push(at + " has an unknown domain");
    if (typeof q.truthValue !== "boolean") errors.push(at + " truthValue must be Boolean");
    if (!Array.isArray(q.secondaryTags) || q.secondaryTags.some(x => typeof x !== "string" || !x.trim()))
      errors.push(at + " secondaryTags must be non-empty strings");
    if (!Number.isInteger(q.version) || q.version < 1) errors.push(at + " version must be positive");
    if (!["draft", "active", "retired"].includes(q.status)) errors.push(at + " has an invalid status");
    if (q.status === "active" && q.verified !== true) errors.push(at + " active questions must be verified");
    try { const u = new URL(q.sourceUrl); if (!/^https?:$/.test(u.protocol)) throw new Error(); }
    catch { errors.push(at + " sourceUrl must be absolute http(s)"); }
    if (counts[q.domain] && q.status === "active" && q.verified === true) {
      counts[q.domain].active++;
      counts[q.domain][q.truthValue ? "true" : "false"]++;
    }
  });
  for (const domain of DDCC_DOMAIN_KEYS) {
    const c = counts[domain];
    if (c.active < 2) errors.push(domain + " needs at least two active verified questions");
    if (Math.abs(c.true - c.false) > 1) errors.push(domain + " active truth values are imbalanced");
  }
  return { errors, counts };
}

async function ddccImportQuestions(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST required." }, 405, cors);
  if (!env.DDCC_IMPORT_TOKEN) return json({ error: "DDCC importer is not configured." }, 503, cors);
  if (!timingSafeEqual(request.headers.get("X-DDCC-Import") || "", env.DDCC_IMPORT_TOKEN))
    return json({ error: "Importer credential rejected." }, 401, cors);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2_000_000) return json({ error: "Question-bank payload exceeds 2 MB." }, 413, cors);
    body = JSON.parse(raw);
  } catch { return json({ error: "Invalid JSON." }, 400, cors); }
  const rows = body && body.questions;
  const checked = ddccValidateQuestionBank(rows);
  if (checked.errors.length) return json({ error: "Question-bank validation failed.", errors: checked.errors.slice(0, 50) }, 400, cors);
  const keyed = Object.fromEntries(rows.filter(q => q.status !== "draft").map(q => [q.id, q]));
  try { await fbPut(env, "/ddcc/questions", keyed); }
  catch (e) { return json({ error: "Question-bank import failed: " + e.message }, 502, cors); }
  return json({ ok: true, imported: Object.keys(keyed).length, counts: checked.counts }, 200, cors);
}
function ddccId(prefix) {
  if (crypto.randomUUID) return prefix + "-" + crypto.randomUUID();
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  return prefix + "-" + [...bytes].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function ddccState(request, env, cors) {
  if (request.method !== "GET") return json({ error: "GET required." }, 405, cors);
  const gate = await ddccAuth(request, env, cors); if (gate.response) return gate.response;
  try { const { user } = await ddccReadUser(env, gate.auth.name); return json(ddccStatePayload(user), 200, cors); }
  catch (e) { return json({ error: "DDCC storage is unavailable: " + e.message }, 502, cors); }
}

async function ddccStart(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST required." }, 405, cors);
  const gate = await ddccAuth(request, env, cors); if (gate.response) return gate.response;
  let bank;
  try { bank = await ddccReadQuestions(env); }
  catch (e) { return json({ error: "The DDCC question library is unavailable." }, 503, cors); }
  for (let tries = 0; tries < 4; tries++) {
    let got;
    try { got = await ddccReadUser(env, gate.auth.name, true); }
    catch (e) { return json({ error: "DDCC storage is unavailable: " + e.message }, 502, cors); }
    const existing = ddccActiveAttempt(got.user);
    if (existing) return json(ddccStatePayload(got.user), 200, cors);
    let selected;
    try { selected = ddccSelectQuestions(bank, ddccCompletedIds(got.user)); }
    catch (e) {
      if (e.code !== "DDCC_EXHAUSTED") throw e;
      const diagnostic = { at: new Date().toISOString(), user: gate.auth.name, shortages: e.shortages };
      try { await fbPut(env, "/ddcc/diagnostics/" + ddccId("exhausted"), diagnostic); } catch {}
      return json({ error: "A balanced 40-question quiz is not available yet.", code: e.code,
        shortages: e.shortages }, 409, cors);
    }
    const id = ddccId("attempt"), now = new Date().toISOString();
    const items = Object.fromEntries(selected.map(q => [q.id, {
      id: q.id, claim: q.claim, domain: q.domain, truthValue: q.truthValue,
      explanation: q.explanation, sourceTitle: q.sourceTitle, sourceUrl: q.sourceUrl,
      sourcePublisher: q.sourcePublisher || null, version: q.version,
    }]));
    const order = selected.map(q => q.id);
    const attempt = { id, userId: gate.auth.name, status: "in_progress", questionIds: order,
      questionOrder: order, currentIndex: 0, startedAt: now, scoringVersion: "ddcc-v1", items,
      responses: {} };
    got.user.attempts = got.user.attempts || {};
    got.user.attempts[id] = attempt; got.user.activeAttemptId = id;
    try {
      if (await fbPut(env, ddccUserPath(gate.auth.name), got.user, got.etag))
        return json(ddccStatePayload(got.user), 201, cors);
    } catch (e) { return json({ error: "The quiz could not be saved: " + e.message }, 502, cors); }
  }
  return json({ error: "The quiz changed in another tab. Try again." }, 409, cors);
}

async function ddccAnswer(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST required." }, 405, cors);
  const gate = await ddccAuth(request, env, cors); if (gate.response) return gate.response;
  let body;
  try { body = await readBody(request); } catch { return json({ error: "Invalid JSON." }, 400, cors); }
  const probability = body && body.probability;
  if (!Number.isInteger(probability) || probability < 0 || probability > 100)
    return json({ error: "Probability must be a whole number from 0 through 100." }, 400, cors);
  for (let tries = 0; tries < 4; tries++) {
    let got;
    try { got = await ddccReadUser(env, gate.auth.name, true); }
    catch (e) { return json({ error: "DDCC storage is unavailable: " + e.message }, 502, cors); }
    const attempt = got.user.attempts && got.user.attempts[body.attemptId];
    if (!attempt || attempt.userId !== gate.auth.name) return json({ error: "That attempt was not found." }, 404, cors);
    const locked = attempt.responses && attempt.responses[body.questionId];
    if (locked) {
      if (locked.probability === probability) return json(ddccStatePayload(got.user), 200, cors);
      return json({ error: "That answer is already locked." }, 409, cors);
    }
    if (attempt.status !== "in_progress" || got.user.activeAttemptId !== attempt.id)
      return json({ error: "That attempt is already complete." }, 409, cors);
    const index = ddccCurrentIndex(attempt), expected = attempt.questionOrder[index];
    if (body.questionId !== expected) return json({ error: "That is not the current question." }, 409, cors);
    const q = attempt.items[expected], now = new Date().toISOString();
    attempt.responses = attempt.responses || {};
    attempt.responses[expected] = { id: ddccId("response"), attemptId: attempt.id,
      userId: gate.auth.name, questionId: q.id, questionVersion: q.version,
      claimSnapshot: q.claim, domainSnapshot: q.domain, truthValueSnapshot: q.truthValue,
      explanationSnapshot: q.explanation, sourceTitleSnapshot: q.sourceTitle,
      sourceUrlSnapshot: q.sourceUrl, sourcePublisherSnapshot: q.sourcePublisher || null,
      probability, submittedAt: now };
    attempt.currentIndex = index + 1;
    if (attempt.currentIndex === 40) {
      attempt.status = "completed"; attempt.completedAt = now;
      got.user.activeAttemptId = null;
    }
    try {
      if (await fbPut(env, ddccUserPath(gate.auth.name), got.user, got.etag)) {
        const payload = ddccStatePayload(got.user);
        if (attempt.status === "completed") payload.completedAttemptId = attempt.id;
        return json(payload, 200, cors);
      }
    } catch (e) { return json({ error: "The answer was not saved: " + e.message }, 502, cors); }
  }
  return json({ error: "The answer changed in another tab. Reload before continuing." }, 409, cors);
}

async function ddccReview(request, url, env, cors) {
  if (request.method !== "GET") return json({ error: "GET required." }, 405, cors);
  const gate = await ddccAuth(request, env, cors); if (gate.response) return gate.response;
  const id = url.searchParams.get("attempt") || "";
  try {
    const { user } = await ddccReadUser(env, gate.auth.name);
    const attempt = user.attempts && user.attempts[id];
    if (!attempt || attempt.userId !== gate.auth.name) return json({ error: "Receipt not found." }, 404, cors);
    if (attempt.status !== "completed" || ddccResponses(attempt).length !== 40)
      return json({ error: "Results stay sealed until all 40 answers are complete." }, 409, cors);
    const responses = attempt.questionOrder.map(qid => attempt.responses[qid]).map(r => ({ ...r,
      brierLoss: ddccBrier(r.probability, r.truthValueSnapshot) }));
    return json({ ok: true, attempt: { id: attempt.id, completedAt: attempt.completedAt,
      scoringVersion: attempt.scoringVersion, metrics: ddccAggregate(responses), responses } }, 200, cors);
  } catch (e) { return json({ error: "DDCC storage is unavailable: " + e.message }, 502, cors); }
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

/* -------------------------- the entitlement field ------------------------- */
// /users/<name>/entitlement = { plan, status, period_end }
//
// Added 2026-08-10, before anyone can subscribe and while every account will hold the same
// value for a year, because an ABSENT entitlement is AMBIGUOUS: nothing can distinguish a
// free account from one that predates the field. Adding it after money has changed hands
// means migrating live accounts. `stripe_customer_id` deliberately does NOT go in yet — an
// absent one is not ambiguous, it means "not a customer", so it costs nothing to add on the
// day the webhook lands. That asymmetry is the whole reason this field is early and that
// one is not.
//
// ⚠️ STATUS IS NOT A BOOLEAN. Subscriptions lapse and cards fail, so there has to be a
// state that is neither on nor off. A boolean forces "off" the instant a renewal payment is
// retried, which locks a paying member out of the thing they just paid for.
//
// ⚠️ THE PLAN VOCABULARY IS DELIBERATELY NOT THE TIER VOCABULARY. Pup / Working Dawg /
// DawgHouse grade whether a TOOL has been validated. A person's billing state is not a
// validation verdict, and once access is sold, reusing those words would make a paying user
// read as a validated tool and the tier labels stop meaning anything.
//
// ⚠️ THE SERVER IS THE ONLY WRITER. No request body anywhere may carry an entitlement.
// Today the sole writer is the free default below; when Stripe lands, the sole addition is
// its webhook. work/test-identity.mjs asserts both halves, including that a signup body
// carrying an entitlement cannot set one.
const ENTITLEMENT_PLANS = ["free", "member"];
const ENTITLEMENT_STATUSES = ["none", "active", "past_due", "canceled", "grace"];
const freeEntitlement = () => ({ plan: "free", status: "none", period_end: null });

// The read side. An absent or malformed field reads as the free default, so no caller ever
// sees undefined and no corrupt record ever reads as paid.
// ⚠️ IT FAILS CLOSED ON PURPOSE. An unrecognised plan or status degrades to free/none
// rather than being passed through, because the alternative is a garbled record granting
// access. A record that cannot be understood must not be treated as a customer.
function entitlementOf(user) {
  const e = user && typeof user === "object" ? user.entitlement : null;
  if (!e || typeof e !== "object") return freeEntitlement();
  return {
    plan: ENTITLEMENT_PLANS.includes(e.plan) ? e.plan : "free",
    status: ENTITLEMENT_STATUSES.includes(e.status) ? e.status : "none",
    period_end: Number.isFinite(e.period_end) ? e.period_end : null,
  };
}

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

// Resolve an email to a player name. Email is an ALTERNATE SIGN-IN IDENTIFIER, and since
// CEP-6 it is also the address a reset link goes to.
//
// ⚠️ THIS LOOKUP IS DELIBERATELY INDIFFERENT TO emailVerified. Every account predates the
// mail sender, so gating sign-in on confirmation would lock existing players out of their
// own names for a property none of them could have had. Verification is additive and
// opt-in (POST /auth/verify-request); it proves an address is reachable, and it is never
// a precondition for signing in with it.
async function emailToName(env, email) {
  try {
    const owners = await accountsForEmail(env, email);
    return owners.length === 1 ? owners[0].name : null;
  } catch { return null; }
}

// POST /auth/lookup {email} — intentional, disclosed enumeration for email-first UX.
// It is bounded per IP and returns no name, UID, verification, or membership data.
async function authLookup(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  if (!env.RL) return json({ error: "Rate limiting is not configured." }, 503, cors);
  let body;
  try { body = await readBody(request); } catch { return json({ error: "Bad JSON." }, 400, cors); }
  const email = normEmail(body && body.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ error: "That does not look like an email address." }, 400, cors);
  const hour = Math.floor(Date.now() / 3600000);
  const ip = request.headers.get("CF-Connecting-IP") || "noip";
  const key = "lookup:" + hour + ":" + ip;
  const used = parseInt((await env.RL.get(key)) || "0", 10);
  if (used >= LOOKUP_IP_CAP) return json({ error: "Too many account lookups. Try again in an hour." }, 429, cors);
  await env.RL.put(key, String(used + 1), { expirationTtl: 7200 });
  let owners;
  try { owners = await accountsForEmail(env, email); }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
  return json({ ok: true, known: owners.length === 1 }, 200, cors);
}

// POST /auth/name {name} — change the display name. Session required, acts only on SELF.
//
// ⚠️ DISPLAY NAMES ARE DELIBERATELY NOT UNIQUE. Email is the uniqueness key: one account
// per address, enforced by accountsForEmail plus the ETag reservation on /emailIndex.
// Five members may all be "John". Nothing here checks /users for a collision, and adding
// such a check later would be a regression, not a fix — test-identity asserts a duplicate
// display name is ALLOWED at signup, and this route holds the same line.
//
// ⚠️ UID ACCOUNTS ONLY. A legacy record IS its name — /users/<name> and /bozoauth/<name>
// are both keyed by it — so renaming one is a migration, not a field write. After the
// legacy wipe no such account exists and this branch is dead; it stays because a stale
// service-worker copy of an old page can still present a legacy session.
//
// Bozo seats and live picks are keyed by uid. Renaming changes only the display label;
// commitBozoLeg refreshes the league member label on the next submission and receipts
// keep the name stamped when the leg was filed. No league-state lookup belongs here.
const RENAME_CAP = 5;   // per account per day

async function authName(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 401, cors);
  if (!auth.uid)
    return json({ error: "This account predates renaming and cannot be renamed." }, 409, cors);

  let body;
  try { body = await readBody(request); } catch { return json({ error: "Bad JSON." }, 400, cors); }
  const name = String(body.name || "").trim();
  if (!name) return json({ error: "Pick a name - it is what shows on rosters." }, 400, cors);
  if (Array.from(name).length > 60 || /[\u0000-\u001f\u007f]/.test(name))
    return json({ error: "That display name is not valid." }, 400, cors);
  if (name === auth.name) return json({ ok: true, name, unchanged: true }, 200, cors);

  if (env.RL) {
    const day = new Date().toISOString().slice(0, 10);
    const rlKey = "rename:" + day + ":" + auth.uid;
    const used = parseInt((await env.RL.get(rlKey)) || "0", 10);
    if (used >= RENAME_CAP)
      return json({ error: "That is enough name changes for one day." }, 429, cors);
    await env.RL.put(rlKey, String(used + 1), { expirationTtl: 172800 });
  }

  const at = Date.now();
  try {
    // The log is append-only and written FIRST: a rename that is not recorded is worse
    // than a rename that is recorded twice.
    await fbPut(env, uidUserPath(auth.uid) + "/nameLog/" + at, { from: auth.name, to: name, at });
    await fbPatch(env, uidUserPath(auth.uid), { name, nameSetAt: at });
  } catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }

  // sessionAuth prefers rec.name over the token's n, so the old session keeps working.
  // A fresh one is returned anyway so every page stops showing the stale label at once.
  return json({ ok: true, name, previous: auth.name,
                session: await makeSession(env, name, auth.passwordSetAt || 0, auth.uid) }, 200, cors);
}

// POST /auth/mcp-token {action:"mint"|"revoke"} — session required, acts only on SELF.
async function authMcpToken(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 401, cors);
  if (auth.uid && auth.user.emailVerified !== true)
    return json({ error: "Confirm your email before creating a personal connector credential.",
                  verificationRequired: true }, 403, cors);

  let body;
  try { body = await readBody(request); } catch { return json({ error: "Bad JSON." }, 400, cors); }
  const action = String((body && body.action) || "mint");
  const key = encodeURIComponent(auth.uid || auth.name);

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
  if (auth.uid) {
    const next = normEmail(email);
    if (!next) return json({ error: "A UID account must keep a primary email address." }, 400, cors);
    if (next === normEmail(auth.user.email))
      return json({ ok: true, player: auth.name, email: next,
                    alreadyCurrent: true, verified: auth.user.emailVerified === true }, 200, cors);
    if (!mailReady(env)) return json({ error: MAIL_OFF }, 503, cors);
    let owners;
    try { owners = await accountsForEmail(env, next); }
    catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
    if (owners.length) return json({ error: "Another account already uses that address." }, 409, cors);
    const q = await mailQuota(env, request, next);
    if (q.err) return json({ error: q.err }, q.code || 429, cors);
    const tok = await mintMailToken(env, "email-change", auth.name, next, auth.uid,
                                    { o: normEmail(auth.user.email) });
    try {
      await sendMail(env, next, "Confirm your new Data Dawgs address",
        "Confirm this new address for the Data Dawgs account \"" + auth.name + "\".\n\n" +
        MAIL_BASE + "/signon.html?email-change=" + tok + "\n\n" +
        "The current sign-in address stays active until this one-time link is used. The link expires in an hour.\n");
      await q.bump();
    } catch (e) { return json({ error: "Could not send that email: " + e.message }, 502, cors); }
    return json({ ok: true, player: auth.name, pendingEmail: next,
                  note: "The current address stays active until the new address is confirmed." }, 202, cors);
  }
  const taken = email ? await emailToName(env, email) : null;
  if (taken && taken !== auth.name) return json({ error: "Another player already uses that address." }, 409, cors);
  try { await fbPatch(env, "/users/" + encodeURIComponent(auth.name), { email: email || null }); }
  catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  return json({ ok: true, player: auth.name, email: email || null,
                note: "Saved but unconfirmed. It lets you sign in, and a reset link goes here." }, 200, cors);
}

// POST /auth/email-confirm {token} — proves the new address before changing login.
async function authEmailConfirm(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  let body;
  try { body = await readBody(request); } catch { return json({ error: "Bad JSON." }, 400, cors); }
  const t = await consumeMailToken(env, "email-change", body && body.token);
  if (t.err) return json({ error: t.err }, t.code || 400, cors);
  if (!t.u || !UID_RE.test(t.u)) return json({ error: "That link is not valid for a UID account." }, 400, cors);
  let user;
  try { user = (await fbGet(env, uidUserPath(t.u))).data; }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
  if (!user) return json({ error: "That account no longer exists." }, 410, cors);
  if (normEmail(user.email) !== normEmail(t.o))
    return json({ error: "The account address changed after this link was sent. Ask for a new one." }, 409, cors);
  let owners;
  try { owners = await accountsForEmail(env, t.e); }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
  if (owners.some(o => o.uid !== t.u)) return json({ error: "Another account now uses that address." }, 409, cors);
  let reservation;
  try {
    reservation = await reserveEmail(env, t.e, t.u);
    if (!reservation.ok) return json({ error: "Another account now uses that address." }, 409, cors);
    await fbPatch(env, uidUserPath(t.u), {
      email: normEmail(t.e), emailVerified: true, emailVerifiedAt: Date.now(), emailChangedAt: Date.now(),
    });
    if (t.o && normEmail(t.o) !== normEmail(t.e)) {
      const oldPath = await emailIndexPath(t.o);
      const old = await fbGet(env, oldPath, true);
      if (old.data && old.data.uid === t.u && old.etag) await fbDelete(env, oldPath, old.etag);
    }
    return json({ ok: true, player: user.name || t.n, email: normEmail(t.e), verified: true }, 200, cors);
  } catch (e) {
    if (normEmail(user.email) !== normEmail(t.e)) await releaseEmailReservation(env, reservation, t.u);
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}

// POST /auth/signup {name, email, password} — TRUE OPEN SIGNUP (Kap's call, 8/7).
// Anyone may create a site-wide account, like any normal website. What signup does
// NOT grant is a league seat: membership stays invite/manager-gated, so an open door
// on accounts costs the leagues nothing. The data model is unchanged — name stays the
// roster key, exactly as claim/invite create it, so every existing surface that is
// keyed by name keeps working without a migration.
//
// ⚠️ The email is an UNCONFIRMED alternate sign-in identifier, same as /auth/email.
// Signup neither verifies it nor sends anything: CEP-6 made verification additive and
// opt-in (POST /auth/verify-request), because every existing account predates mail and
// gating sign-in on confirmation would lock those people out of their own names.
// Required here — it is the identifier a stranger signs in with, and the only address a
// reset link could ever reach. First come, first served.
//
// ⚠️ This is the ONLY unauthenticated write on the Worker. Everything else behind a
// write is session- or token-gated; this endpoint by design is not, so it gets the
// hardest cap: SIGNUP_CAP fresh accounts per IP per day via the RL binding. The cap
// is checked BEFORE any database work so a flood costs KV reads, not RTDB writes.
const SIGNUP_CAP = 5;

async function bozoSignup(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const cfg = bozoConfig(env);
  if (cfg) return json({ error: cfg }, 500, cors);

  let used = 0, rlKey = null;
  if (env.RL) {
    const ip = request.headers.get("CF-Connecting-IP") || "noip";
    const day = new Date().toISOString().slice(0, 10);
    rlKey = "signup:" + day + ":" + ip;
    used = parseInt((await env.RL.get(rlKey)) || "0", 10);
    if (used >= SIGNUP_CAP)
      return json({ error: "Too many new accounts from this connection today. Try again tomorrow." }, 429, cors);
  }

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }
  const name = String(body.name || "").trim();
  if (!name) return json({ error: "Pick a name - it is what shows on rosters." }, 400, cors);
  if (Array.from(name).length > 60 || /[\u0000-\u001f\u007f]/.test(name))
    return json({ error: "That display name is not valid." }, 400, cors);
  const email = normEmail(body.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ error: "That does not look like an email address." }, 400, cors);
  const pw = String(body.password || "");
  if (pw.length < MIN_PW)
    return json({ error: `Password must be at least ${MIN_PW} characters.` }, 400, cors);
  if (rlKey) await env.RL.put(rlKey, String(used + 1), { expirationTtl: 172800 });

  let owners;
  try { owners = await accountsForEmail(env, email); }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
  if (owners.length)
    return json({ error: "An account already uses that address. Sign in with it instead." }, 409, cors);
  const uid = newUid();
  if (!UID_RE.test(uid)) return json({ error: "Account ID generation failed." }, 500, cors);
  let reservation;
  try {
    reservation = await reserveEmail(env, email, uid);
    if (!reservation.ok)
      return json({ error: "An account already uses that address. Sign in with it instead." }, 409, cors);
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    const salt = b64(saltBytes);
    const hash = await pbkdf2(pw, env.BOZO_PEPPER, salt, PBKDF2_ITERS);
    const setAt = Date.now();
    const user = {
      uid, email, emailVerified: false, name,
      passwordHash: hash, passwordSalt: salt, passwordIters: PBKDF2_ITERS,
      passwordSetAt: setAt, roles: {}, apps: {}, entitlement: freeEntitlement(),
      createdAt: new Date(setAt).toISOString(), src: "signup-v2",
    };
    await fbPut(env, uidUserPath(uid), user);
    return json({ ok: true, uid, name, email, emailVerified: false,
                  session: await makeSession(env, name, setAt, uid),
                  note: "Account created. Confirm the address before creating a personal connector credential." }, 201, cors);
  } catch (e) {
    await releaseEmailReservation(env, reservation, uid);
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}

// Retained as executable compatibility documentation until the post-draft wipe. No
// route calls it: all new signups use immutable UID records above.
async function legacyBozoSignup(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const cfg = bozoConfig(env);
  if (cfg) return json({ error: cfg }, 500, cors);

  let used = 0, rlKey = null;
  if (env.RL) {
    const ip = request.headers.get("CF-Connecting-IP") || "noip";
    const day = new Date().toISOString().slice(0, 10);
    rlKey = "signup:" + day + ":" + ip;
    used = parseInt((await env.RL.get(rlKey)) || "0", 10);
    if (used >= SIGNUP_CAP)
      return json({ error: "Too many new accounts from this connection today. Try again tomorrow." }, 429, cors);
  }

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  // Same name rules as /auth/invite — the name is a Firebase key and a roster label.
  const name = String(body.name || "").trim();
  if (!name) return json({ error: "Pick a name — it's what shows on rosters." }, 400, cors);
  if (name.length > 40) return json({ error: "That name is too long." }, 400, cors);
  if (/[.#$\[\]\/]/.test(name)) return json({ error: "Name can't contain . # $ [ ] or /" }, 400, cors);

  const email = String(body.email || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ error: "That does not look like an email address." }, 400, cors);

  const pw = String(body.password || "");
  if (pw.length < MIN_PW) return json({ error: `Password must be at least ${MIN_PW} characters.` }, 400, cors);

  // Count the attempt only NOW: a typo'd email must not burn one of the day's five,
  // but anything that reaches the database — even a "name taken" probe — does.
  if (rlKey) await env.RL.put(rlKey, String(used + 1), { expirationTtl: 172800 });

  let users;
  try { users = await loadUsers(env); }
  catch (e) { return json({ error: e.message }, 502, cors); }
  if (userNames(users).includes(name))
    return json({ error: "That name is taken. If it's yours, sign in instead." }, 409, cors);
  const emailOwner = await emailToName(env, email);
  if (emailOwner)
    return json({ error: "Another account already uses that address. Sign in with it instead." }, 409, cors);

  try {
    // Belt and braces: an auth record means the name is live even if /users
    // momentarily disagrees (the same pair of nodes claim writes).
    const existing = (await fbGet(env, authPath(name))).data;
    if (existing) return json({ error: "That name is taken. If it's yours, sign in instead." }, 409, cors);

    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    const salt = b64(saltBytes);
    const hash = await pbkdf2(pw, env.BOZO_PEPPER, salt, PBKDF2_ITERS);
    const setAt = Date.now();
    // PATCH, not PUT: /users/<name> must not clobber anything if a concurrent
    // invite landed first — though the name checks above make that a razor edge.
    // ⚠️ The entitlement is built HERE, from the server's own constant. It is never read
    // out of the request body, which is why a signup posting {entitlement:{plan:"member"}}
    // creates a free account like everyone else.
    await fbPatch(env, "/users/" + encodeURIComponent(name),
                  { email, src: "signup", signupTs: setAt, apps: {}, entitlement: freeEntitlement() });
    await fbPut(env, authPath(name), { v: 1, salt, hash, iters: PBKDF2_ITERS, setAt });
    return json({ ok: true, name, email, session: await makeSession(env, name, setAt),
                  note: "Email saved but unconfirmed. It lets you sign in, and a reset link goes here." }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
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
      entitlement: freeEntitlement(),
      invite: await inviteHash(env, tok),
      invitedTs: Date.now(),
      apps: { bozo: true },
      src: "seed",
    };
  }
  try { await fbPatch(env, "/users", seed); } catch (e) { /* next read retries */ }
  return seed;
}

const userNames = users => Object.entries(users).map(([key, rec]) => accountName(key, rec));

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
      // ⚠️ ONLY WHEN THE ACCOUNT IS NEW. Re-inviting an EXISTING person is supported and
      // ordinary (a lost link gets re-minted), and this is a PATCH — so writing the free
      // default unconditionally would silently downgrade a paying member to free the next
      // time an admin re-sent them a join link. That is a billing bug with no error
      // message, so the guard is load-bearing and has its own assertion.
      ...(isNew ? { entitlement: freeEntitlement() } : {}),
    });
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
  const claimed = !!(await fbGet(env, authPath(player))).data;
  // Identity invitations create or recover an account only. League membership always
  // comes from an authenticated league search plus the shared league password.
  return json({ ok: true, player, token, claimed, isNew }, 200, cors);
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

  /* ⚠️ THE ENTITLEMENT BACKFILL RIDES THE SAME PATCH, AND IT LIVES HERE RATHER THAN IN
     loadUsers ON PURPOSE. loadUsers is the funnel every path uses — including mcpAuth —
     so putting a write there would mean an MCP read-only tool could trigger a Firebase
     write on its first call. "Every tool is read-only, asserted by test against the
     source" is a published claim on connect.html and in surfaces.json, and a self-healing
     migration is not a good enough reason to make it need an asterisk.
     Nothing is lost by backfilling here instead: entitlementOf() already returns the free
     default for an absent field, so every read is unambiguous whether or not the record
     has caught up, and this route runs on every sign-on page load. Accounts converge in
     minutes and no read depends on that having happened. */
  for (const [key, user] of Object.entries(users)) {
    if (user && typeof user === "object" && user.entitlement && typeof user.entitlement === "object") continue;
    const seeded = freeEntitlement();
    fix[key + "/entitlement"] = seeded;
    if (user && typeof user === "object") user.entitlement = seeded;   // this request sees it too
  }

  if (Object.keys(fix).length) {
    try { await fbPatch(env, "/users", fix); } catch (e) { /* next read retries */ }
  }

  // ⚠️ /bozoauth IS EMPTY NOW, BY DESIGN. Legacy accounts kept their password hash there;
  // uid accounts carry it on the user record. Reading only /bozoauth reports every
  // account as unclaimed -- which empties the sign-in autocomplete and makes the manager
  // view label people who plainly have passwords as "not claimed yet".
  const claimedBy = rec => !!(rec && rec.passwordHash && rec.passwordSalt);
  const players = Object.entries(users).map(([key, rec]) => {
    const n = accountName(playerName(key), rec);
    return { name: n, claimed: !!auth[n] || claimedBy(rec) };
  });
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

    // Account claim is identity-only. Any stale pendingLeague left by the retired
    // per-person invite system is cleared without granting membership.
    if ((users[encodeURIComponent(name)] || {}).pendingLeague) {
      try { await fbPatch(env, "/users/" + encodeURIComponent(name), { pendingLeague: null }); }
      catch { /* membership still remains closed; the stale marker is inert */ }
    }
    return json({ ok: true, name, session: await makeSession(env, name, setAt) }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}

async function bozoLogin(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const cfg = bozoConfig(env);
  if (cfg) return json({ error: cfg }, 500, cors);
  if (!env.RL) return json({ error: "Rate limiting is not configured." }, 503, cors);
  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const identifier = String(body.email || body.name || "").trim();
  const password = String(body.password || "");
  if (!identifier || !password) return json({ error: "Email and password are required." }, 400, cors);
  const normalized = identifier.indexOf("@") > 0 ? normEmail(identifier) : identifier;
  const hour = Math.floor(Date.now() / 3600000);
  const ip = request.headers.get("CF-Connecting-IP") || "noip";
  const identKey = "loginid:" + hour + ":" + (await sha256hex(normalized));
  const ipKey = "loginip:" + hour + ":" + ip;
  const identFails = parseInt((await env.RL.get(identKey)) || "0", 10);
  const ipFails = parseInt((await env.RL.get(ipKey)) || "0", 10);
  if (identFails >= LOGIN_FAIL_CAP || ipFails >= LOGIN_FAIL_CAP)
    return json({ error: "Too many wrong passwords. Try again in an hour." }, 429, cors);

  let account = null, users;
  try {
    users = await loadUsers(env);
    if (normalized.indexOf("@") > 0) {
      const found = await accountsForEmail(env, normalized);
      if (found.length === 1) account = found[0];
    } else {
      const rec = users[encodeURIComponent(normalized)] || users[normalized];
      if (rec) account = { key: normalized, uid: null, name: normalized, user: rec };
    }
  } catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }

  let authRec = null;
  try {
    authRec = account && account.uid ? {
      hash: account.user.passwordHash, salt: account.user.passwordSalt,
      iters: account.user.passwordIters, setAt: account.user.passwordSetAt,
    } : account ? (await fbGet(env, authPath(account.name))).data : null;
  } catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }

  let valid = false;
  if (authRec && authRec.hash && authRec.salt) {
    const hash = await pbkdf2(password, env.BOZO_PEPPER, authRec.salt, authRec.iters || PBKDF2_ITERS);
    valid = timingSafeEqual(hash, authRec.hash);
  }
  if (!valid) {
    await env.RL.put(identKey, String(identFails + 1), { expirationTtl: 7200 });
    await env.RL.put(ipKey, String(ipFails + 1), { expirationTtl: 7200 });
    return json({ error: "Email or password not recognized." }, 401, cors);
  }

  return json({ ok: true, ...(account.uid ? { uid: account.uid } : {}), name: account.name,
                email: account.user.email || null, emailVerified: account.user.emailVerified === true,
                session: await makeSession(env, account.name, authRec.setAt || 0, account.uid) }, 200, cors);
}

async function legacyBozoLogin(request, env, cors) {
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

  if (auth.uid) {
    const rec = auth.user;
    if (!rec.passwordHash || !rec.passwordSalt) return json({ error: "No password on file." }, 409, cors);
    const check = await pbkdf2(oldPw, env.BOZO_PEPPER, rec.passwordSalt, rec.passwordIters || PBKDF2_ITERS);
    if (!timingSafeEqual(check, rec.passwordHash)) return json({ error: "Current password is wrong." }, 401, cors);
    try {
      const saltBytes = new Uint8Array(16); crypto.getRandomValues(saltBytes);
      const salt = b64(saltBytes);
      const hash = await pbkdf2(newPw, env.BOZO_PEPPER, salt, PBKDF2_ITERS);
      const setAt = Date.now();
      await fbPatch(env, uidUserPath(auth.uid), {
        passwordHash: hash, passwordSalt: salt, passwordIters: PBKDF2_ITERS, passwordSetAt: setAt,
      });
      return json({ ok: true, session: await makeSession(env, auth.name, setAt, auth.uid),
                    note: "Password changed. Every other sign-in was ended." }, 200, cors);
    } catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  }

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

/* ===================== CEP-6 — email verification and reset =====================
   ⚠️ INERT BY DEFAULT. mailReady() is false until BOTH the RESEND_KEY secret and the
   MAIL_FROM plain-text var exist. Every route below checks it FIRST and returns 503
   without minting a token, without touching the database and without calling out.

   WHY A HARD GATE RATHER THAN A BEST EFFORT. The failure mode of "try to send, carry
   on if it fails" is a reset token sitting in KV, valid for an hour, that the account
   owner never receives. The only safe partial state is no state at all.

   TOKENS. 32 random bytes, base64url. KV stores the SHA-256 of the token, never the
   token, so read access to KV does not hand over an account — the same discipline as
   the per-user MCP tokens. KV's own expirationTtl is the expiry; there is no sweeper
   to forget to run.

   ⚠️ A TOKEN IS DELETED BEFORE THE WORK IT AUTHORIZES, NOT AFTER. If the database
   write then fails, the user has to ask for a new link. That is the correct direction
   to fail: the alternative leaves a replayable password-reset token alive after an
   error, and "the reset didn't take, try again" is a much smaller problem than that.

   CAPS. Three, all checked before any work: per address per day, per IP per day, and
   a cooldown per address. Mail is the one endpoint here that costs money and can be
   pointed at a stranger's inbox, so it gets the tightest limits on the Worker.

   ENUMERATION. /auth/forgot answers identically whether or not the address exists.
   The single exception is "email is not configured on this site", which leaks nothing
   about any address and is the honest answer to someone who would otherwise wait for
   a message that is never coming. */
const MAIL_TOKEN_TTL  = 3600;   // seconds; one hour is enough to walk to a laptop
const MAIL_ADDR_CAP   = 3;      // links per address per day
const MAIL_IP_CAP     = 10;     // links per connection per day
const MAIL_COOLDOWN_S = 60;     // seconds between links to one address
const MAIL_BASE       = "https://datadawgs216.com";

function mailReady(env) { return !!(env && env.RESEND_KEY && env.MAIL_FROM); }
const MAIL_OFF = "Email is not switched on for this site yet, so no link can be sent. " +
                 "Ask Kap to reset you by hand in the meantime.";

async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", te.encode(String(str)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const normEmail = e => String(e || "").trim().toLowerCase();

function newUid() {
  const raw = crypto.getRandomValues(new Uint8Array(18));
  let s = ""; for (const b of raw) s += String.fromCharCode(b);
  return "u_" + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const uidUserPath = uid => "/users/" + encodeURIComponent(uid);
const accountName = (key, rec) => String((rec && rec.name) || playerName(key) || "");

async function accountsForEmail(env, email) {
  const want = normEmail(email);
  if (!want || want.indexOf("@") < 1) return [];
  const users = await loadUsers(env);
  return Object.entries(users).filter(([, rec]) => rec && typeof rec === "object" && normEmail(rec.email) === want)
    .map(([key, rec]) => ({ key: playerName(key), uid: UID_RE.test(playerName(key)) ? playerName(key) : null,
                           name: accountName(key, rec), user: rec }));
}

async function emailIndexPath(email) {
  return "/emailIndex/" + (await sha256hex(normEmail(email)));
}

// RTDB has no unique index. Reserve the normalized-email hash with an ETag before the
// user write, then keep that immutable UID as the index value. A failed user write
// releases only the reservation carrying the same ETag, so it cannot delete a winner.
async function reserveEmail(env, email, uid) {
  const path = await emailIndexPath(email);
  for (let tries = 0; tries < 3; tries++) {
    const got = await fbGet(env, path, true);
    if (!got.etag) throw new Error("email index returned no ETag");
    if (got.data && got.data.uid === uid)
      return { ok: true, path, email: normEmail(email), etag: got.etag, existing: true };
    if (got.data) return { ok: false, conflict: true };
    const value = { uid, email: normEmail(email), reservedAt: Date.now() };
    if (await fbPut(env, path, value, got.etag)) {
      const confirmed = await fbGet(env, path, true);
      return { ok: true, path, email: normEmail(email), etag: confirmed.etag };
    }
  }
  return { ok: false, conflict: true };
}


async function releaseEmailReservation(env, reservation, uid) {
  if (!reservation || !reservation.path) return;
  try {
    // A fetch can fail after Firebase committed the user write. Never release the
    // uniqueness row if the account now owns that address; that would permit a duplicate.
    const user = (await fbGet(env, uidUserPath(uid))).data;
    if (user && normEmail(user.email) === reservation.email) return;
    const got = await fbGet(env, reservation.path, true);
    if (got.data && got.data.uid === uid && got.etag) await fbDelete(env, reservation.path, got.etag);
  } catch { /* a cleanup failure leaves a safe conflict, never a duplicate account */ }
}


// Every account holding this address. /auth/email and /auth/signup both refuse
// duplicates, so this should never return more than one — but reset has to resolve an
// address to exactly one account, and guessing which one would be the wrong kind of
// helpful. If the invariant has broken, say so and stop.
async function emailOwners(env, email) {
  const want = normEmail(email);
  if (!want || want.indexOf("@") < 1) return [];
  let users;
  try { users = await loadUsers(env); } catch { return []; }
  const out = [];
  for (const [k, u] of Object.entries(users))
    if (u && typeof u.email === "string" && normEmail(u.email) === want) out.push(playerName(k));
  return out;
}

async function mailQuota(env, request, email) {
  if (!env.RL) return { err: "Rate limiting is not configured, so no mail will be sent.", code: 503 };
  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get("CF-Connecting-IP") || "noip";
  const eh = await sha256hex(normEmail(email));
  const addrKey = "mailaddr:" + day + ":" + eh;
  const ipKey = "mailip:" + day + ":" + ip;
  const coolKey = "mailcool:" + eh;
  if (await env.RL.get(coolKey))
    return { err: "A link was just sent to that address. Give it a minute.", code: 429 };
  const addrUsed = parseInt((await env.RL.get(addrKey)) || "0", 10);
  if (addrUsed >= MAIL_ADDR_CAP)
    return { err: "That address has had its links for today.", code: 429 };
  const ipUsed = parseInt((await env.RL.get(ipKey)) || "0", 10);
  if (ipUsed >= MAIL_IP_CAP)
    return { err: "Too many emails from this connection today.", code: 429 };
  // Counted only when the caller actually commits to sending, so a refusal further
  // down (no such account, database down) does not burn somebody's daily allowance.
  return { ok: true, bump: async () => {
    await env.RL.put(addrKey, String(addrUsed + 1), { expirationTtl: 172800 });
    await env.RL.put(ipKey, String(ipUsed + 1), { expirationTtl: 172800 });
    await env.RL.put(coolKey, "1", { expirationTtl: MAIL_COOLDOWN_S });
  } };
}

async function mintMailToken(env, kind, name, email, uid, extra) {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const tok = b64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const tokenKey = "mailtok:" + (await hmac(env.BOZO_PEPPER, "mail|" + kind + "|" + tok));
  await env.RL.put(tokenKey,
                   JSON.stringify({ k: kind, n: name, ...(uid ? { u: uid } : {}),
                                    e: normEmail(email), iat: Date.now(), ...(extra || {}) }),
                   { expirationTtl: MAIL_TOKEN_TTL });
  return tok;
}

async function consumeMailToken(env, kind, tok) {
  if (!env.RL) return { err: "Token storage is not configured.", code: 503 };
  if (typeof tok !== "string" || tok.length < 20 || tok.length > 200)
    return { err: "That link is not valid.", code: 400 };
  // New links use a peppered, purpose-separated HMAC. The SHA fallback only lets
  // one-hour links minted by the previous deployed Worker finish their lifecycle.
  const key = "mailtok:" + (await hmac(env.BOZO_PEPPER, "mail|" + kind + "|" + tok));
  const legacyKey = "mailtok:" + (await sha256hex(tok));
  let usedKey = key;
  let raw = await env.RL.get(key);
  if (!raw) { raw = await env.RL.get(legacyKey); usedKey = legacyKey; }
  if (!raw) return { err: "That link has expired or has already been used.", code: 410 };
  await env.RL.delete(usedKey);              // single use; delete before authorized work
  let o;
  try { o = JSON.parse(raw); } catch { return { err: "That link is not valid.", code: 400 }; }
  if (!o || o.k !== kind) return { err: "That link is not valid for this.", code: 400 };
  return o;
}

// ⚠️ The key travels in a header and NEVER in a URL, a log line or a response. The
// provider's error body is truncated and returned without it.
async function sendMail(env, to, subject, text) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }),
  });
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.text()).slice(0, 180); } catch { /* body is optional */ }
    throw new Error("mail provider returned " + r.status + (detail ? ": " + detail : ""));
  }
  let accepted = null;
  try { accepted = await r.json(); } catch { /* a successful provider response should still carry an id */ }
  if (!accepted || typeof accepted.id !== "string" || !accepted.id)
    throw new Error("mail provider accepted the request without a delivery id");
  return { id: accepted.id };
}

// POST /auth/verify-request — session required. Sends a verification link to the
// address already on the caller's own account. It cannot be pointed anywhere else,
// which is what keeps this from being an open relay.
async function authVerifyRequest(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  if (!mailReady(env)) return json({ error: MAIL_OFF }, 503, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 401, cors);

  let rec = auth.user || null;
  if (!rec) {
    let users;
    try { users = await loadUsers(env); }
    catch (e) { return json({ error: e.message }, 502, cors); }
    rec = users[auth.name] || users[encodeURIComponent(auth.name)] || null;
  }
  const email = rec && typeof rec.email === "string" ? rec.email.trim() : "";
  if (!email) return json({ error: "There is no address on your account to verify." }, 409, cors);
  if (rec.emailVerified === true)
    return json({ ok: true, player: auth.name, email, alreadyVerified: true }, 200, cors);

  const q = await mailQuota(env, request, email);
  if (q.err) return json({ error: q.err }, q.code || 429, cors);

  const tok = await mintMailToken(env, "verify", auth.name, email, auth.uid);
  let delivery;
  try {
    delivery = await sendMail(env, email, "Confirm your Data Dawgs address",
      "Someone asked to confirm this address for the Data Dawgs account \"" + auth.name + "\".\n\n" +
      MAIL_BASE + "/signon.html?verify=" + tok + "\n\n" +
      "The link works once and expires in an hour. If this wasn't you, ignore it — " +
      "nothing changes and nobody can sign in as you from this message.\n");
  } catch (e) {
    try { await env.RL.delete("mailtok:" + (await hmac(env.BOZO_PEPPER, "mail|verify|" + tok))); }
    catch { /* expiry remains the safe fallback if cleanup itself fails */ }
    console.error(JSON.stringify({ event: "mail.verify.rejected", account: auth.uid || auth.name,
                                   reason: String(e && e.message || e).slice(0, 220) }));
    return json({ error: "Could not send that email: " + e.message }, 502, cors);
  }
  console.log(JSON.stringify({ event: "mail.verify.accepted", account: auth.uid || auth.name,
                               deliveryId: delivery.id }));
  await q.bump();
  return json({ ok: true, player: auth.name, sent: true, providerAccepted: true,
                note: "Email provider accepted the confirmation. Check that inbox and spam; the link works once and expires in an hour." }, 200, cors);
}

// POST /auth/verify {token} — no session; the token IS the proof.
async function authVerify(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  let body;
  try { body = await readBody(request); } catch { return json({ error: "Bad JSON." }, 400, cors); }
  const t = await consumeMailToken(env, "verify", body && body.token);
  if (t.err) return json({ error: t.err }, t.code || 400, cors);

  // The address may have been changed after the link was sent. Verifying the OLD
  // address against the NEW one would mark an unverified address verified.
  let rec;
  try {
    if (t.u) rec = (await fbGet(env, uidUserPath(t.u))).data;
    else {
      const users = await loadUsers(env);
      rec = users[t.n] || users[encodeURIComponent(t.n)] || null;
    }
  } catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
  if (!rec) return json({ error: "That account no longer exists." }, 410, cors);
  if (normEmail(rec.email) !== t.e)
    return json({ error: "That address has changed since the link was sent. Ask for a new one." }, 409, cors);

  try { await fbPatch(env, t.u ? uidUserPath(t.u) : "/users/" + encodeURIComponent(t.n),
                      { emailVerified: true, emailVerifiedAt: Date.now() }); }
  catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  return json({ ok: true, player: t.n, email: t.e, verified: true }, 200, cors);
}

// POST /auth/forgot {email} — NO session, by definition.
// ⚠️ The success response is IDENTICAL whether or not the address exists, whether or
// not it has one account, and whether or not the send worked. Any other shape turns
// this into a "does this person play?" oracle for anyone with a list of addresses.
const FORGOT_SAID = "If that address has an account, a reset link is on its way. " +
                    "It works once and expires in an hour.";

async function authForgot(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  // Not an enumeration leak: this says nothing about any address, and it is the honest
  // answer to somebody who would otherwise wait forever for a message.
  if (!mailReady(env)) return json({ error: MAIL_OFF }, 503, cors);

  let body;
  try { body = await readBody(request); } catch { return json({ error: "Bad JSON." }, 400, cors); }
  const email = normEmail(body && body.email);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ error: "That does not look like an email address." }, 400, cors);

  // The caps are the one thing allowed to answer differently, because a rate limit is
  // about the CALLER, not about whether the address is real.
  const q = await mailQuota(env, request, email);
  if (q.err) return json({ error: q.err }, q.code || 429, cors);

  let owners = [];
  try { owners = await accountsForEmail(env, email); } catch { owners = []; }
  if (owners.length === 1) {
    try {
      const owner = owners[0];
      const tok = await mintMailToken(env, "reset", owner.name, email, owner.uid);
      await sendMail(env, email, "Reset your Data Dawgs password",
        "Someone asked to reset the password for the Data Dawgs account \"" + owner.name + "\".\n\n" +
        MAIL_BASE + "/signon.html?reset=" + tok + "\n\n" +
        "The link works once and expires in an hour. If this wasn't you, ignore it — " +
        "your password does not change until that link is used.\n");
      await q.bump();
    } catch (e) {
      // Swallowed on purpose: a provider outage must not become a signal about the
      // address. It is still visible in the Worker's own logs.
      console.log("forgot: send failed:", e.message);
    }
  }
  // owners.length > 1 means /auth/email's duplicate guard has been bypassed somehow.
  // Resolving it by picking one would be a guess about whose account to reset.
  return json({ ok: true, note: FORGOT_SAID }, 200, cors);
}

// POST /auth/reset {token, password} — the token is the proof; no session needed.
async function authReset(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const cfg = bozoConfig(env);
  if (cfg) return json({ error: cfg }, 500, cors);

  let body;
  try { body = await readBody(request); } catch { return json({ error: "Bad JSON." }, 400, cors); }
  const pw = String((body && body.password) || "");
  if (pw.length < MIN_PW) return json({ error: `Password must be at least ${MIN_PW} characters.` }, 400, cors);

  const t = await consumeMailToken(env, "reset", body && body.token);
  if (t.err) return json({ error: t.err }, t.code || 400, cors);

  let rec;
  try {
    if (t.u) rec = (await fbGet(env, uidUserPath(t.u))).data;
    else {
      const users = await loadUsers(env);
      rec = users[t.n] || users[encodeURIComponent(t.n)] || null;
    }
  } catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
  if (!rec) return json({ error: "That account no longer exists." }, 410, cors);
  // Same reason as verify: the address may have moved since the link was sent, and a
  // link sent to an address that is no longer on the account must not still open it.
  if (normEmail(rec.email) !== t.e)
    return json({ error: "That address has changed since the link was sent. Ask for a new one." }, 409, cors);

  try {
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    const salt = b64(saltBytes);
    const hash = await pbkdf2(pw, env.BOZO_PEPPER, salt, PBKDF2_ITERS);
    // ⚠️ A fresh setAt is what kills every session that existed before the reset — the
    // session payload pins `p` to it. Without this, whoever prompted the reset keeps
    // their stolen session and the reset accomplishes nothing.
    const setAt = Date.now();
    if (t.u) await fbPatch(env, uidUserPath(t.u), {
      passwordHash: hash, passwordSalt: salt, passwordIters: PBKDF2_ITERS, passwordSetAt: setAt,
    });
    else await fbPut(env, authPath(t.n), { v: 1, salt, hash, iters: PBKDF2_ITERS, setAt });
    return json({ ok: true, player: t.n, session: await makeSession(env, t.n, setAt, t.u),
                  note: "Password changed. Every other sign-in was ended." }, 200, cors);
  } catch (e) {
    return json({ error: "Database write failed: " + e.message }, 502, cors);
  }
}
/* =================== end CEP-6 =================== */

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
// Universal account-backed leagues live outside the public legacy /bozo tree. Firebase
// rules must default-deny this branch; clients receive projections from these routes.
const UNIVERSAL_GAMES = ["bozo", "guillotine", "draft"];
const UNIVERSAL_SETTINGS_MAX_BYTES = 12_000;

function validUniversalLeagueId(id) { return DRAFT_LEAGUE_ID_RE.test(String(id || "")); }
function validGateCode(code) {
  return typeof code === "string" && Array.from(code.trim()).length >= 6 &&
    Array.from(code.trim()).length <= 64 && !/[\u0000-\u001f\u007f]/.test(code);
}
function validLeagueSettings(settings) {
  if (settings == null) return {};
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  if (Object.keys(settings).some(k => ["__proto__", "prototype", "constructor"].includes(k))) return null;
  try {
    if (te.encode(JSON.stringify(settings)).byteLength > UNIVERSAL_SETTINGS_MAX_BYTES) return null;
  } catch { return null; }
  return settings;
}
function universalLeagueView(id, league, auth) {
  const members = league && league.members && typeof league.members === "object" ? league.members : {};
  return {
    id, game: league.game, name: league.name, visibility: league.visibility,
    managerUid: league.managerUid, managed: !!auth && league.managerUid === auth.uid,
    member: !!auth && !!members[auth.uid], memberCount: Object.values(members).filter(m => m && m.status === "active").length,
    settings: league.settings || {}, createdAt: league.createdAt,
  };
}
function universalEvent(type, auth, payload) {
  return { type, uid: auth.uid, at: new Date().toISOString(), payload: payload || {} };
}
async function requireUniversalManager(request, env, leagueId) {
  const auth = await sessionAuth(request, env);
  if (auth.err) return auth;
  if (!auth.uid) return { err: "This action requires a UID account.", code: 403 };
  let league;
  try { league = (await fbGet(env, "/leagues/" + leagueId)).data; }
  catch (e) { return { err: "Database unreachable: " + e.message, code: 502 }; }
  if (!league) return { err: "No such league.", code: 404 };
  const siteAdmin = auth.user && auth.user.roles && auth.user.roles.site_admin === true;
  if (!siteAdmin && league.managerUid !== auth.uid)
    return { err: "That league is managed by another account.", code: 403 };
  return { ...auth, league, leagueId, siteAdmin };
}

async function universalLeagueCreate(request, env, cors, body) {
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 401, cors);
  if (!auth.uid) return json({ error: "League creation requires a UID account." }, 403, cors);
  const game = String(body.game || "").trim().toLowerCase();
  if (!UNIVERSAL_GAMES.includes(game))
    return json({ error: "game must be bozo, guillotine, or draft" }, 400, cors);
  const name = String(body.name || "").trim();
  if (!name || Array.from(name).length > 100 || /[\u0000-\u001f\u007f]/.test(name))
    return json({ error: "League name must be 1-100 printable characters." }, 400, cors);
  const gateCode = String(body.gateCode || "").trim();
  if (!validGateCode(gateCode)) return json({ error: "Gate code must be 6-64 printable characters." }, 400, cors);
  const settings = validLeagueSettings(body.settings);
  if (settings == null) return json({ error: "settings must be an object no larger than 12,000 UTF-8 bytes." }, 400, cors);

  for (let attempt = 0; attempt < 4; attempt++) {
    const id = mintDraftLeagueId();
    if (!validUniversalLeagueId(id)) return json({ error: "League ID generation failed." }, 500, cors);
    const now = new Date().toISOString();
    const league = {
      game, name, managerUid: auth.uid, gate: { mode: "code", code: gateCode }, settings,
      visibility: game === "draft" ? "public" : "members",
      members: { [auth.uid]: { joinedAt: now, status: "active" } },
      events: { ["league_created_" + auth.uid]: universalEvent("league_created", auth, { game, name }) },
      createdAt: now,
    };
    let got;
    try { got = await fbGet(env, "/leagues/" + id, true); }
    catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
    if (got.data) continue;
    try {
      if (await fbPut(env, "/leagues/" + id, league, got.etag))
        return json({ ok: true, league: universalLeagueView(id, league, auth) }, 201, cors);
    } catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  }
  return json({ error: "Could not allocate a unique league ID." }, 503, cors);
}

async function leagueCreateDispatch(request, env, cors) {
  let body = null;
  try { body = await request.clone().json(); } catch { /* legacy handler owns its error */ }
  if (body && Object.prototype.hasOwnProperty.call(body, "game"))
    return universalLeagueCreate(request, env, cors, body);
  return leagueCreate(request, env, cors);
}

async function universalLeagueJoin(request, env, cors, body) {
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err, needSignIn: true }, auth.code || 401, cors);
  if (!auth.uid) return json({ error: "League joining requires a UID account." }, 403, cors);
  const id = String(body.leagueId || "");
  if (!validUniversalLeagueId(id)) return json({ error: "Invalid leagueId." }, 400, cors);
  let league;
  try { league = (await fbGet(env, "/leagues/" + id)).data; }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
  if (!league) return json({ error: "No such league." }, 404, cors);
  if (!league.gate || league.gate.mode !== "code" ||
      !timingSafeEqual(String(body.gateCode || ""), String(league.gate.code || "")))
    return json({ error: "That league code is not valid." }, 403, cors);
  const memberPath = "/leagues/" + id + "/members/" + auth.uid;
  const eventPath = "/leagues/" + id + "/events/member_joined_" + auth.uid;
  let existing;
  try { existing = await fbGet(env, eventPath, true); }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
  const now = new Date().toISOString();
  try {
    if (!existing.data) {
      const wrote = await fbPut(env, eventPath, universalEvent("member_joined", auth, {}), existing.etag);
      if (!wrote) existing = await fbGet(env, eventPath, true);
    }
    await fbPut(env, memberPath, { joinedAt: (existing.data && existing.data.at) || now, status: "active" });
  } catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  league.members = league.members || {};
  const already = !!league.members[auth.uid];
  league.members[auth.uid] = { joinedAt: now, status: "active" };
  return json({ ok: true, already, league: universalLeagueView(id, league, auth) }, 200, cors);
}

async function leagueJoinDispatch(request, env, cors) {
  let body = null;
  try { body = await request.clone().json(); } catch { /* legacy handler owns its error */ }
  if (body && Object.prototype.hasOwnProperty.call(body, "leagueId"))
    return universalLeagueJoin(request, env, cors, body);
  return leagueJoin(request, env, cors);
}

async function universalLeagueGate(request, env, cors) {
  if (request.method !== "PUT") return json({ error: "PUT only" }, 405, cors);
  let body;
  try { body = await readBody(request); } catch { return json({ error: "Bad JSON." }, 400, cors); }
  const id = String(body.leagueId || "");
  if (!validUniversalLeagueId(id)) return json({ error: "Invalid leagueId." }, 400, cors);
  const code = String(body.gateCode || "").trim();
  if (!validGateCode(code)) return json({ error: "Gate code must be 6-64 printable characters." }, 400, cors);
  const auth = await requireUniversalManager(request, env, id);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);
  try {
    // /leagues is default-deny, so the event may carry the code needed to reconstruct
    // the manager setting. The projection returned to clients never includes it.
    await fbPost(env, "/leagues/" + id + "/events",
                 universalEvent("gate_changed", auth, { mode: "code", code }));
    await fbPut(env, "/leagues/" + id + "/gate", { mode: "code", code });
  } catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  return json({ ok: true, leagueId: id, gate: { mode: "code" } }, 200, cors);
}

async function universalLeagueMine(request, env, cors) {
  if (request.method !== "GET") return json({ error: "GET only" }, 405, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 401, cors);
  if (!auth.uid) return json({ error: "League membership requires a UID account." }, 403, cors);
  let leagues;
  try { leagues = (await fbGet(env, "/leagues")).data || {}; }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
  const out = Object.entries(leagues).filter(([, lg]) => lg &&
    (lg.managerUid === auth.uid || (lg.members && lg.members[auth.uid] && lg.members[auth.uid].status === "active")))
    .map(([id, lg]) => universalLeagueView(id, lg, auth))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return json({ ok: true, leagues: out }, 200, cors);
}

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

// Loud, structured evidence for the handful of writes that can make a live Bozo board
// disappear. Workers Observability retains these console records even though RTDB itself
// has no node history. Log only after the database write succeeds, so every record means
// the destructive change actually landed rather than merely being attempted.
function bozoNullWriteTripwire(route, auth, lid, nulled) {
  console.log(JSON.stringify({
    event: "bozo-null-write",
    route,
    callerUid: (auth && auth.uid) || null,
    league: lid,
    nulled,
    at: new Date().toISOString(),
  }));
}

// Firebase keys cannot contain . $ # [ ] / — and these ids show up in URLs, so keep
// them boring on purpose.
function validLeagueId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9-]{1,23}$/.test(id);
}

/* ===== member keys =====
   A member row is keyed by the joiner's immutable uid and carries their display name as
   a mutable label. Everything that used to key on the name now keys on the uid and reads
   the label for display. The legacy shapes -- `true` as the value, or the name itself as
   the key -- are still READ so the demo leagues and any imported season keep rendering;
   nothing WRITES them any more. */
const memberRec = (lg, key) => ((lg && lg.members) || {})[key];
const memberNameAt = (lg, key) => {
  const v = memberRec(lg, key);
  return (v && typeof v === "object" && v.name) ? String(v.name) : playerName(key);
};
const memberKeys = lg => Object.keys((lg && lg.members) || {});
const memberNames = lg => memberKeys(lg).map(k => memberNameAt(lg, k));

/* The one resolver. Returns the map key for whoever is asking, or null if they are not
   in this league. Prefers the uid; falls back to the legacy name shapes so a demo league
   still resolves. ⚠️ Never invent a key from auth.name -- a miss must be null, or a
   non-member silently gets a seat under a name-shaped key and the re-key is undone. */
function memberKeyOf(lg, auth) {
  const ms = (lg && lg.members) || {};
  const has = k => k != null && Object.prototype.hasOwnProperty.call(ms, k);
  if (auth && auth.uid && has(auth.uid)) return auth.uid;
  const n = auth && auth.name;
  if (n == null) return null;
  if (has(encodeURIComponent(n))) return encodeURIComponent(n);
  if (has(n)) return n;
  for (const k of Object.keys(ms)) if (memberNameAt(lg, k) === n) return k;
  return null;
}
const isMember = (lg, name) => memberKeyOf(lg, { name }) !== null;

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
  // ⚠️ DORMANT BUT NOT HARMLESS. This only fires when /bozo/leagues is entirely empty,
  // which it is not. It is fixed anyway because /users is now uid-keyed: seeding
  // `members[uid] = true` would give every seat a uid key with NO name label, and
  // memberNameAt would fall back to the key -- a board rendering raw u_ strings, from a
  // path nobody would think to look at because it normally never runs.
  for (const [key, rec] of Object.entries(users)) members[key] = { name: accountName(playerName(key), rec) };
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

// Anyone whose name is on THIS league's roster. The betslip link is the first
// write a plain member can make about the WHOLE ticket rather than about their
// own leg, so it needed a power that did not exist yet: not the manager, not the
// site admin, just "you are in this league".
//
// ⚠️ Membership is checked against the STORED roster and identity comes from the
// session. Neither is ever read from the request body — a body that could name
// its own author is a body that can post as anybody.
async function requireMember(request, env, lid) {
  const auth = await sessionAuth(request, env);
  if (auth.err) return auth;
  let lg;
  try { lg = await loadLeague(env, lid); }
  catch (e) { return { err: e.message, code: 502 }; }
  if (!lg) return { err: "No such league.", code: 404 };
  const siteAdmin = env.BOZO_ADMIN && auth.name === env.BOZO_ADMIN;
  if (!siteAdmin && !memberNames(lg).includes(auth.name))
    return { err: "You're not in this league.", code: 403 };
  return { ...auth, league: lg, lid, siteAdmin };
}

// GET /league/list — two named public rooms plus the signed-in person's rooms.
//
// ⚠️ THIS FILTER LIVES HERE, BEFORE SERIALISATION. Hiding cards in bozo.html would
// still hand every private league and every roster name to an unsigned browser. A
// missing, expired or forged session simply receives the public catalog; it never
// turns a read-only directory request into an auth error.
//
// ⚠️ ONE hardcoded public room, not two. `demo-royale` was the second — the seeded
// Royale demo, kept listed so the format had a public surface before a real Royale
// league existed. It has been deleted, and a hardcoded id for a league that is gone
// would publish a 404 to every unsigned browser that reads the directory.
const PUBLIC_BOZO_LEAGUES = new Set([DEFAULT_LEAGUE]);
const leagueIsPublic = (id, lg) => PUBLIC_BOZO_LEAGUES.has(id) || (lg && lg.visibility === "public");
async function leagueList(request, env, cors) {
  let leagues;
  try { leagues = await loadLeagues(env); }
  catch (e) { return json({ error: e.message }, 502, cors); }

  let viewer = null;
  const hasSession = request.headers.has("X-Dawg-Session") || request.headers.has("X-Bozo-Session");
  if (hasSession) {
    const auth = await sessionAuth(request, env);
    if (!auth.err) viewer = auth.name;
  }

  const visible = ([id, lg]) => leagueIsPublic(id, lg)
    || (!!viewer && (lg.manager === viewer || isMember(lg, viewer)));
  const out = Object.entries(leagues).filter(visible).map(([id, lg]) => ({
    id, name: lg.name || id, manager: lg.manager || null,
    size: memberNames(lg).length,
    members: memberNames(lg),
    teams: lg.teams || null,
    settings: settingsOf(lg),
    week: lg.week || 1, status: lg.status || "open",
    visibility: leagueIsPublic(id, lg) ? "public" : "private",
  })).sort((a, b) => a.id === DEFAULT_LEAGUE ? -1 : b.id === DEFAULT_LEAGUE ? 1 : a.name.localeCompare(b.name));
  return json({ leagues: out, defaultLeague: DEFAULT_LEAGUE, signedIn: !!viewer }, 200, cors);
}

// POST /league/search {query} — signed-in Bozo league directory. League names are not
// credentials: an empty query returns the first 20 and a query filters the same public
// directory. Password verification is still the only path into a league.
async function leagueSearch(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err, needSignIn: true }, auth.code || 401, cors);
  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }
  const query = String(body.query || "").trim().replace(/\s+/g, " ");
  if ((query.length > 0 && query.length < 2) || query.length > 60)
    return json({ error: "Use at least two characters to filter the league list." }, 400, cors);
  const q = query.toLocaleLowerCase("en-US");
  let leagues;
  try { leagues = await loadLeagues(env); }
  catch (e) { return json({ error: e.message }, 502, cors); }
  const matches = Object.entries(leagues).filter(([id, lg]) => {
    const name = String((lg && lg.name) || id).trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    return !q || name.includes(q) || id.includes(q);
  }).sort(([aId, a], [bId, b]) => {
    const aOwn = a && (a.manager === auth.name || isMember(a, auth.name));
    const bOwn = b && (b.manager === auth.name || isMember(b, auth.name));
    if (aOwn !== bOwn) return aOwn ? -1 : 1;
    return String((a && a.name) || aId).localeCompare(String((b && b.name) || bId));
  });
  const results = matches.slice(0, 20).map(([id, lg]) => ({
    id, name: lg.name || id, manager: lg.manager || null,
    size: memberNames(lg).length,
    already: isMember(lg, auth.name),
    visibility: leagueIsPublic(id, lg) ? "public" : "private",
  }));
  return json({ results, total: matches.length, limit: 20 }, 200, cors);
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

  // ⚠️ THE MANAGER'S SEAT IS KEYED BY UID LIKE EVERY OTHER SEAT. The manager is named by
  // display name in the request body (an admin naming a person), so their uid has to be
  // resolved out of /users. Refusing when it cannot be is deliberate: seeding a
  // name-keyed seat here would put the one shape this codebase no longer writes into a
  // brand-new league, where every member joining after them is uid-keyed and only the
  // manager is not.
  let managerUid = null;
  for (const [key, rec] of Object.entries(users)) {
    const k = playerName(key);
    if (UID_RE.test(k) && accountName(k, rec) === manager) { managerUid = k; break; }
  }
  if (!managerUid)
    return json({ error: manager + " has no account id yet — they need to sign in once before they can manage a league." }, 409, cors);

  // ⚠️ FORMAT IS CHOSEN HERE AND NOWHERE ELSE. Standard is the original game; Bozo
  // Royale is the guillotine. It is immutable after the first lock — see leagueSettings —
  // because changing the ruleset mid-season retroactively changes who should have been
  // eliminated, which is the same class of error as mutating a published forecast.
  const format = body.format === "royale" ? "royale" : "standard";
  const buyback = format === "royale" ? Math.max(0, Math.round(Number(body.buyback) || 0)) : 0;
  if (!Number.isFinite(buyback) || buyback > 100000)
    return json({ error: "Re-deploy cost must be between 0 and 100000." }, 400, cors);
  const leaguePassword = normLeaguePassword(body.password);
  if (!validLeaguePassword(leaguePassword))
    return json({ error: "A new league needs a 6–64 character league password." }, 400, cors);
  const accessKv = JOIN_KV(env);
  if (!accessKv) return json({ error: "League access is unavailable right now." }, 503, cors);

  const lg = {
    name: String(body.name || id).slice(0, 60),
    manager,
    // The manager starts as the only member; size grows from here. A league of 4 is
    // just a league whose manager stopped adding people at 4.
    members: { [managerUid]: { name: manager, joinedAt: Date.now() } },
    season: SEASON, week: 1, status: "open",
    format, buyback,
    formatLocked: false,
    createdTs: Date.now(), createdBy: auth.name,
  };
  try { await fbPatch(env, LG(id), lg); }
  catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  try {
    await accessKv.put(JOIN_LG(id), JSON.stringify({
      passwordHash: await leaguePasswordHash(env, id, leaguePassword),
      cap: JOIN_CAP_DEFAULT, createdTs: Date.now(), createdBy: auth.name,
      passwordChangedTs: Date.now(), passwordChangedBy: auth.name,
    }));
  } catch (e) {
    // Creation is one operation to the caller. If its password cannot be stored, remove
    // the brand-new empty league so a retry does not collide with a half-created room.
    try {
      await fbPut(env, LG(id), null);
      bozoNullWriteTripwire("/league/create rollback", auth, id, ["members", "picks", "results"]);
    } catch { /* report the original access failure */ }
    return json({ error: "League password write failed: " + e.message }, 502, cors);
  }
  return json({ ok: true, id, league: lg }, 200, cors);
}

/* POST /league/import — SITE ADMIN only. Loads a simulated season from the seeding
   script into a brand-new league, so the group can see what a populated Bozo looks like
   before a single real leg is graded.

   ⚠️ `synthetic: true` IS FORCED ON HERE AND CANNOT BE TURNED OFF BY THE CALLER. It is
   the only thing standing between a fabricated close and the evidence layer. Every
   surface that aggregates — receipts, the model scoreboard, any cross-league total —
   filters on it, and the close-capture cron skips these leagues outright so an invented
   price is never confused with an observed one.

   ⚠️ Import is create-only. It refuses an existing id rather than merging, because a
   half-simulated real league is not a state anyone could reason about afterwards.

   ⚠️ IT ARRIVES IN BATCHES, because a season does not fit in one request. MAX_BODY is
   24 KB and the standard demo season is 112 KB of JSON. That limit is a shared defence
   on every route in this Worker, so it is NOT raised for one admin convenience — the
   caller sends the metadata plus a first slice, then appends the rest.

   The first call creates the league with `importing: true`. Appends are only accepted
   onto a league that is BOTH synthetic and still importing, which is what stops this
   route from being a way to inject fabricated rows into a real league's ledger. The
   final call clears the flag.

   ⚠️ The simulator that produces this payload is NOT wired into any production path. It
   is run by hand and its output posted here once. */
/* Turn simulator legs into ledger rows. Shared by the create call and every append, so
   a row written in batch 1 and a row written in batch 7 are built by the same code. */
function leagueImportRows(id, season, legs) {
  const RESULT = { win: "won", loss: "lost", push: "push" };
  const rows = {};
  for (const l of (legs || [])) {
    if (!l || !l.player) continue;
    const key = encodeURIComponent(String(l.player));
    const week = Number(l.week) || 1;
    rows[ledgerKey(season, week, key)] = {
      league: id, season, week, player: String(l.player),
      sport: l.sport, eventId: String(l.eventId || ""), game: l.game || "",
      mkt: l.mkt, side: String(l.side ?? ""), dir: (l.side === "over" || l.side === "under") ? l.side : "over",
      priceSource: "simulated",                 // never "self" — nobody typed this
      line: l.line ?? null, label: l.label || "", prop: l.prop || null,
      price: l.entryPrice ?? null, priceOpp: l.entryPriceOpp ?? null,
      entryBook: l.entryBook || "draftkings",
      selectionKey: l.selectionKey || null,
      startsAt: null,                           // no capture will ever run on these
      dkSgpEligible: l.dkSgpEligible === true ? "asserted" : (l.dkSgpEligible || null),
      mainLine: null,
      ts: Date.parse(l.entrySubmittedAt || "") || null,
      close: l.closePrice ?? null, closeOpp: l.closePriceOpp ?? null,
      closeBook: l.closeBook || null,
      closeObservedAt: l.closeObservedAt || null,
      // ⚠️ Not "sgo" and not "manual". A fabricated close must be distinguishable from
      // an observed one in the column that records where closes come from, forever.
      closeSource: l.closePrice == null ? null : "simulated",
      closeUnavailableReason: l.closeUnavailableReason || null,
      result: RESULT[l.result] || null,
      won: l.result === "win" ? true : l.result === "loss" ? false : null,
      gradedAt: l.gradedAt || null,
      synthetic: true,
    };
  }
  return rows;
}

/* Turn an imported ledger into a BOARD.
   ⚠️ WITHOUT THIS THE DEMO DEMOS ALMOST NOTHING. The first version wrote 176 ledger rows
   and stopped, which is everything the CLV chart needs and nothing the rest of the page
   reads: the ticket renders from /picks, the hierarchy from /order, the verdict from
   /bozo, and the season counts from /history. All four were empty, so a league with a
   full simulated season showed "0 legs" and eight rows of "no leg yet" — the exact
   surfaces the demo exists to populate.

   So the last batch replays the season out of the ledger: every week's legs become picks
   and results, each week's drawn hierarchy names its bozo, and the final week is left
   loaded on the board.

   ⚠️ The bozo is named by royaleDecideChop — the SAME cascade the live grader runs — not
   by a second implementation written for the demo. A demo that resolved weeks by
   different rules than the real thing would be worse than no demo. */
const IMPORT_LEVER_IX = { "Shortest Odds": 0, "Worst Beat": 1, "Last In": 2, "Worst CLV": 3 };

async function leagueImportFinalise(env, id, lg) {
  let ledger = {};
  try { ledger = (await fbGet(env, LG(id) + "/ledger")).data || {}; }
  catch (e) { throw new Error("ledger read failed: " + e.message); }

  const rows = Object.values(ledger).filter(r => r && r.week && r.player);
  if (!rows.length) return null;

  const byWeek = new Map();
  for (const r of rows) {
    if (!byWeek.has(r.week)) byWeek.set(r.week, []);
    byWeek.get(r.week).push(r);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  const season = lg.season || SEASON;
  const orders = lg.weekOrders || {};

  // One week's legs, in the shape /picks and /results actually hold.
  const shape = (wk) => {
    const picks = {}, results = {};
    for (const r of byWeek.get(wk) || []) {
      const k = encodeURIComponent(r.player);
      picks[k] = {
        sport: r.sport, eventId: r.eventId, game: r.game, mkt: r.mkt, side: r.side,
        line: r.line ?? 0, dir: r.dir || "over", price: r.price, label: r.label,
        prop: r.prop || null, ts: r.ts || null, priceSource: r.priceSource || "simulated",
        entryPriceOpp: r.priceOpp ?? null, entryBook: r.entryBook || null,
        selectionKey: r.selectionKey || null, marketKey: null, startsAt: null,
        dkSgpEligible: r.dkSgpEligible || null,
      };
      results[k] = {
        result: r.result || null,
        won: r.result === "won" ? true : r.result === "lost" ? false : null,
        actual: r.actual ?? null,
        close: r.close ?? null, closeOpp: r.closeOpp ?? null,
        closeBook: r.closeBook || null, closeSource: r.closeSource || null,
        closeObservedAt: r.closeObservedAt || null,
        closeUnavailableReason: r.closeUnavailableReason || null,
      };
    }
    return { picks, results };
  };

  /* Build the history the season board counts from.

     ⚠️ A ROYALE SEASON'S HISTORY COMES FROM ITS CHOP LOG, NOT FROM A REPLAY, and the
     reason is causal rather than tidy. The chop decides who is on the roster the
     following week, so the legs that were generated after it only make sense under the
     chops that actually happened. Re-deciding week 6 under different rules would give
     week 7 a roster that never bet those legs — a season that contradicts its own rows.

     ⚠️ It matters because the two DO disagree. The simulator scores Worst Beat as raw
     distance past the line; the site scores it as distance from the price-implied
     expectation in standard deviations, which is what data/bozo-rules.json describes and
     which makes a −400 favourite missing by three a worse beat than a −110 missing by
     three. Replaying the seeded Royale season under the site's rule reproduces 12 of 13
     chops and disagrees on week 6. The chop log wins there, because it is the season the
     legs were dealt for.

     A Standard league has no chop log — nobody is eliminated, so nothing downstream
     depends on last week's verdict — and its history is replayed under the live cascade,
     which is the rule that will decide real weeks. */
  const chops = (lg.royale || {}).chops || {};
  const chopByWeek = {};
  for (const c of Object.values(chops)) if (c && c.week && c.chopped) chopByWeek[c.week] = c.chopped;
  const fromChops = Object.keys(chopByWeek).length > 0;

  const history = [];
  for (const wk of weeks) {
    if (fromChops) {
      const who = chopByWeek[wk];
      history.push({ week: wk, bozo: who ? encodeURIComponent(who) : null });
      continue;
    }
    const { picks, results } = shape(wk);
    const d = royaleDecideChop({ picks, results }, orders[wk] || [0, 1, 2, 3]);
    history.push({ week: wk, bozo: d.choppedKey || null });
  }

  // The last week stays loaded on the board, so the ticket, hierarchy, diagnostics and
  // verdict all have something real to draw.
  const last = weeks[weeks.length - 1];
  const { picks, results } = shape(last);
  const order = orders[last] || [0, 1, 2, 3];
  // Same rule as the history above: a Royale week's verdict is its chop record.
  const decided = fromChops && chopByWeek[last]
    ? { choppedKey: encodeURIComponent(chopByWeek[last]), chopped: chopByWeek[last],
        decidedBy: (Object.values(chops).find(c => c && c.week === last) || {}).decidedBy || "the drawn hierarchy" }
    : royaleDecideChop({ picks, results }, order);
  const bozoLeg = decided.choppedKey ? picks[decided.choppedKey] : null;

  const patch = {
    week: last, season, status: "graded",
    picks, results, order,
    history: history.slice(0, -1),        // the current week is `bozo`, not history
    bozo: decided.choppedKey || null,
    bozoWhy: decided.choppedKey
      ? `${decided.decidedBy} · lost ${bozoLeg ? bozoLeg.label : ""}${bozoLeg ? " at " + bozoLeg.price : ""} · funds next week`
      : "Ticket cashed. Nobody wears it.",
    closeTs: Math.max(0, ...Object.values(picks).map(p => p.ts || 0)) || null,
  };
  await fbPatch(env, LG(id), patch);
  return { week: last, legs: Object.keys(picks).length, bozo: decided.chopped,
           decidedBy: decided.decidedBy, weeksReplayed: weeks.length };
}

async function leagueImport(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = await requireAdmin(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  let body;
  try { body = await readBody(request); }
  catch (e) {
    // ⚠️ Say WHICH failure it was. These were one message until an import hit the size
    // ceiling and reported "Bad JSON", which is a completely different problem and sent
    // the reader looking at their payload's syntax instead of its length.
    return /too large/.test(String(e && e.message))
      ? json({ error: `That request body is over the ${MAX_BODY / 1000} KB limit. Send the legs in batches — see /league/import.` }, 413, cors)
      : json({ error: "Bad JSON." }, 400, cors);
  }

  const id = String(body.id || body.league || "").toLowerCase().trim();
  if (!validLeagueId(id)) return json({ error: "League id must be 2–24 chars: lowercase letters, numbers and dashes." }, 400, cors);

  const legs = Array.isArray(body.legs) ? body.legs : [];
  const append = body.append === true;

  let leagues;
  try { leagues = await loadLeagues(env); }
  catch (e) { return json({ error: e.message }, 502, cors); }

  /* ---------- appending to an import already in progress ---------- */
  if (append) {
    const lg = leagues[id];
    if (!lg) return json({ error: "No such league — send the first batch without append." }, 404, cors);
    // ⚠️ Both conditions, every time. Synthetic alone would let a finished demo be
    // topped up months later; importing alone would be a way into a real league.
    if (lg.synthetic !== true || lg.importing !== true)
      return json({ error: "That league isn't mid-import. Import never merges into an existing league." }, 409, cors);

    const rows = leagueImportRows(id, Number(lg.season) || SEASON, legs);
    if (Object.keys(rows).length) {
      try { await fbPatch(env, LG(id) + "/ledger", rows); }
      catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
    }
    if (body.done === true) {
      // Everything is in — now make it a BOARD, not just a ledger. See the note there.
      let live = null;
      try { live = await leagueImportFinalise(env, id, lg); }
      catch (e) { console.log("import: finalise failed — " + e.message); }
      // ⚠️ The flag clears LAST, after every row has landed. An import interrupted
      // halfway leaves `importing: true` — visibly unfinished, and still appendable —
      // rather than a league that looks complete and silently isn't.
      try { await fbPatch(env, LG(id), { importing: null }); }
      catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
      return json({ ok: true, id, appended: legs.length, done: true, live }, 200, cors);
    }
    return json({ ok: true, id, appended: legs.length, done: false }, 200, cors);
  }

  /* ---------- the first batch, which creates the league ---------- */
  if (leagues[id]) return json({ error: "A league with that id already exists. Delete it first — import never merges." }, 409, cors);
  if (!legs.length) return json({ error: "Nothing to import — no legs in the payload." }, 400, cors);

  const season = Number(body.season) || SEASON;
  const format = body.format === "royale" ? "royale" : "standard";
  // ⚠️ The roster comes from body.players, NOT from this batch's legs. Under batching the
  // first slice is a few weeks of one league and would name only whoever happened to bet
  // in them — and in Bozo Royale, where the roster shrinks, the last slice names almost
  // nobody. Falling back to the legs is only for a single-shot import.
  const players = Array.isArray(body.players) && body.players.length
    ? [...new Set(body.players.map(String))].sort()
    : [...new Set(legs.map(l => String(l.player || "")).filter(Boolean))].sort();
  const members = {};
  for (const p of players) members[encodeURIComponent(p)] = true;

  const ledger = leagueImportRows(id, season, legs);

  const weekLabels = {}, weekPhases = {};
  for (const w of (Array.isArray(body.weeks) ? body.weeks : [])) {
    if (w && w.week) { weekLabels[w.week] = w.label || ("Week " + w.week); weekPhases[w.week] = w.phase || "regular"; }
  }

  /* ⚠️ The drawn hierarchy per week, converted from the simulator's lever NAMES to the
     indices the page's LEVERS array uses. Stored on the first batch because the finalise
     step runs on the last one and needs all of them — and without it every replayed week
     would resolve under a default 0,1,2,3 order that was never actually drawn, quietly
     naming different bozos than the season it claims to be. */
  const weekOrders = {};
  for (const h of (Array.isArray(body.hierarchies) ? body.hierarchies : [])) {
    if (!h || !h.week || !Array.isArray(h.order)) continue;
    const ix = h.order.map(n => IMPORT_LEVER_IX[n]).filter(n => Number.isInteger(n));
    if (ix.length) weekOrders[h.week] = ix;
  }

  const lg = {
    name: String(body.name || id).slice(0, 60),
    manager: auth.name,
    members, season,
    week: Number(body.weeksPlayed) || Math.max(...legs.map(l => Number(l.week) || 1)),
    status: "graded",
    format, buyback: format === "royale" ? (Number(body.buyback) || 25) : 0,
    formatLocked: true,
    synthetic: true,
    // Cleared by the final batch. Until then the league is visibly mid-import rather
    // than looking complete while missing most of its season.
    importing: body.done === true ? null : true,
    demoNote: String(body.note || "SIMULATED SEASON — every leg, price, close and result is fabricated."),
    weekLabels, weekPhases, weekOrders,
    ledger,
    createdTs: Date.now(), createdBy: auth.name, importedTs: Date.now(),
  };

  // Royale state travels with the season so the DEAD badges and the chop log are right
  // the moment the league opens.
  if (format === "royale") {
    const status = {};
    for (const [name, s] of Object.entries(body.playersStatus || {})) {
      status[encodeURIComponent(name)] = {
        alive: s.alive === true,
        buybacksLeft: Number(s.buybacksLeft) || 0,
        chopped: Array.isArray(s.chopped) ? s.chopped : [],
        boughtBack: Array.isArray(s.boughtBack) ? s.boughtBack : [],
        eliminatedWeek: s.alive === true ? null : (Array.isArray(s.chopped) ? s.chopped[s.chopped.length - 1] ?? null : null),
      };
    }
    const chops = {};
    for (const c of (Array.isArray(body.chops) ? body.chops : [])) {
      if (c && c.week) chops[`w${c.week}`] = { ...c, season, resolvedTs: null, simulated: true };
    }
    lg.royale = { status, chops, offers: {}, survivor: body.survivor || null };
  }

  try { await fbPatch(env, LG(id), lg); }
  catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  return json({ ok: true, id, legs: legs.length, players: players.length, format, synthetic: true }, 200, cors);
}

// POST /league/delete {league, confirm} — MANAGER or site admin. A HARD delete: the
// whole league node goes, which takes its picks, ledger, closes, grades, order,
// results, history, config, members and teams with it.
//
// ⚠️ Hard, not soft, and that is the point. A soft-hidden league is a synthetic-data
// leak waiting to happen — the demo seasons in here are fabricated closes and
// fabricated results, and a hidden-but-present demo row is exactly the thing that
// eventually gets counted by a query someone writes next month. If it is deleted it
// cannot be counted.
//
// ⚠️ The default league cannot be deleted. loadLeagues() re-seeds it from /users on the
// next read, so "deleting" it would silently resurrect an empty shell — worse than
// refusing, because it looks like it worked.
async function leagueDelete(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const lid = leagueOf(body);
  if (!lid) return json({ error: "Bad league id." }, 400, cors);
  if (lid === DEFAULT_LEAGUE)
    return json({ error: "The default league can't be deleted — it is recreated on the next read." }, 400, cors);

  const auth = await requireManager(request, env, lid);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  // Typing the name is the confirmation. A modal alone is a reflex; this is not.
  const want = String(auth.league.name || lid);
  if (String(body.confirm || "").trim() !== want)
    return json({ error: 'Type the league name exactly — "' + want + '" — to confirm.' }, 400, cors);

  // The join code lives in KV, not in the league node, so it has to be reaped
  // separately or a live link keeps pointing at a league that no longer exists.
  const kv = JOIN_KV(env);
  if (kv) {
    try {
      const rec = JSON.parse((await kv.get(JOIN_LG(lid))) || "null");
      if (rec && rec.code) await kv.delete(JOIN_CODE(rec.code));
      if (rec && rec.passHash) await kv.delete(JOIN_PASS(rec.passHash));
      await kv.delete(JOIN_LG(lid));
    } catch (e) { /* a stale code resolves to "no such league" below; not worth failing on */ }
  }

  try { await fbDelete(env, LG(lid)); }
  catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  bozoNullWriteTripwire("/league/delete", auth, lid, ["members", "picks", "results"]);
  return json({ ok: true, deleted: lid, name: want }, 200, cors);
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
//
// ⚠️ `allowDupes` IS RETIRED AND IS NO LONGER READ. It used to let a manager permit two
// players on the identical selection. The league rule now says every leg must be a real
// DraftKings selection that is legal in an SGP, and DK will not accept the same
// selection twice in one parlay — so a league with dupes on could not build its own
// ticket. That is a physical constraint on the bet, not a house preference, and a
// setting that cannot be honoured is worse than no setting. The stored field is left
// alone rather than migrated: it is inert, and rewriting history to hide that a league
// once ran differently is not this codebase's habit. settingsOf reports it as
// `dupesRetired` so the panel can say why the control vanished.
const LEVER_COUNT = 4;
const SETTING_DEFAULTS = {
  stake: 50, allowEdit: true, lockRule: "all", lockCount: 0,
};
const settingsOf = lg => ({
  stake: Number.isFinite(lg?.stake) ? lg.stake : SETTING_DEFAULTS.stake,
  allowEdit: lg?.allowEdit !== false,
  lockRule: lg?.lockRule === "count" ? "count" : "all",
  lockCount: Number.isFinite(lg?.lockCount) ? lg.lockCount : 0,
  levers: Array.isArray(lg?.levers) && lg.levers.length ? lg.levers : [0, 1, 2, 3],
  format: lg?.format === "royale" ? "royale" : "standard",
  buyback: Number.isFinite(lg?.buyback) ? lg.buyback : 0,
  formatLocked: lg?.formatLocked === true,
  synthetic: lg?.synthetic === true,
  dupesRetired: lg?.allowDupes === true,
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

  /* allowDupes is retired — see the note above settingsOf. It is DROPPED rather than
     rejected, and `dupesRetired` in the response says so.

     ⚠️ Rejecting the whole save would have been the more talkative choice and the wrong
     one. bozo.html is served network-first with a cache fallback, so a phone that has not
     revalidated is still posting the old settings body — and failing its Save because it
     mentioned a setting we retired punishes a manager for our schema change, on the one
     panel where the error would look like their edit was invalid. The field is inert
     either way; the ticket is one real DraftKings parlay and DK will not take the same
     selection twice, whatever any league once preferred. */
  const dupesRetired = has("allowDupes");
  if (has("allowEdit"))  patch.allowEdit  = body.allowEdit !== false;

  // ⚠️ Format is immutable once the league has locked a ticket. Before that it is just a
  // choice on a league nobody has played yet, so let a manager fix a mis-click.
  if (has("format")) {
    const f = body.format === "royale" ? "royale" : "standard";
    if (settingsOf(lg).formatLocked && f !== settingsOf(lg).format)
      return json({ error: "This league has already locked a ticket — the format is fixed for the season. Changing it now would retroactively change who should have been eliminated." }, 409, cors);
    patch.format = f;
    if (f === "standard") patch.buyback = 0;
  }
  if (has("buyback")) {
    const b = Math.round(Number(body.buyback));
    if (!Number.isFinite(b) || b < 0 || b > 100000)
      return json({ error: "Re-deploy cost must be between 0 and 100000." }, 400, cors);
    const f = patch.format || settingsOf(lg).format;
    if (f !== "royale") return json({ error: "Re-deploys only exist in Bozo Royale." }, 400, cors);
    patch.buyback = b;
  }

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
  return json({
    ok: true, league: lid, settings: settingsOf(after), name: after.name, manager: after.manager,
    dupesRetired: dupesRetired || undefined,
    note: dupesRetired
      ? "Duplicate legs aren't a setting any more and that part of your save was ignored. Every leg has to be a real DraftKings selection that's legal in an SGP, and DK rejects the same selection twice on one parlay — so duplicates and contradicting sides are refused on every league now. Reload the page to see the current panel."
      : undefined,
  }, 200, cors);
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

// POST /league/member {league, player, action:"remove"} — manager removal only.
// A manager cannot pre-seat somebody else's account. Every non-manager membership is
// created by that person's authenticated /league/join request plus the shared password.
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
  if (body.action !== "remove")
    return json({ error: "Members must sign in and join this league themselves with its shared password." }, 400, cors);

  // ⚠️ Changing the roster mid-week moves the lock threshold under a live board.
  // Removing the last person you were waiting on would otherwise silently place the
  // ticket; refuse while picks are in and the board is open, and say why.
  const lg = auth.league;
  if ((lg.status || "open") !== "open")
    return json({ error: "The ticket is placed — roster changes wait for next week." }, 409, cors);
  // Resolve the seat by NAME here on purpose: this route's caller is a manager naming
  // somebody, not the member themselves, so there is no uid in hand.
  const pkey = memberKeyOf(lg, { name: player });
  if (!pkey) return json({ error: player + " is not in this league." }, 404, cors);
  if ((lg.picks || {})[pkey])
    return json({ error: player + " already has a leg in this week. Remove the leg first." }, 409, cors);
  if (lg.manager === player)
    return json({ error: "The manager can't leave their own league." }, 400, cors);

  try {
    await fbPatch(env, LG(lid) + "/members", { [pkey]: null });
  } catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  bozoNullWriteTripwire("/league/member", auth, lid, ["members/" + pkey]);

  // Re-read so the caller sees the real size, and so a removal that just completed the
  // board can lock immediately rather than waiting for someone to resubmit.
  const after = await loadLeague(env, lid);
  const picks = after.picks || {};
  let placed = false;
  if (Object.keys(picks).length >= memberNames(after).length && memberNames(after).length > 0)
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
  return json({ ok: true, placed, legs: n,
                waitingOn: memberKeys(lg).filter(k => !picks[k]).map(k => memberNameAt(lg, k)) }, 200, cors);
}

/* ============================ the betslip link ============================
   One DraftKings link per league per week, posted by any member, so that seven
   people do not retype an eight-leg parlay by hand.

   ⚠️ This is the only place on the site where one member hands the other seven a
   link to click. Two rules follow from that, and neither is negotiable:

   1. DRAFTKINGS HOSTS ONLY, ENFORCED HERE. The page checks too, but the page is a
      convenience and this function is the authority. The league books one place
      and one place only — every pick is written with entryBook "draftkings" — so
      a link pointing anywhere else is either a mistake or an attack, and both get
      the same answer.

   2. SUBDOMAIN-SCOPED, NEVER A WHOLE SHORTENER. `*.draftkings.com` is DraftKings.
      A link shortener is by definition an open redirect: allowlisting one would
      let anybody with an account there aim this button wherever they liked. The
      two share hosts below are pinned as EXACT hosts for exactly that reason.

   ⚠️ Those two share hosts are what the DraftKings app is BELIEVED to emit. They
   have not been checked against a real shared link — no sample was available when
   this shipped. A rejection names the host it saw, so if the app emits something
   else the error message is the bug report: add that exact host to this set. Do
   not answer a rejected paste by loosening the rule. */
const DK_SHARE_HOSTS = new Set(["dksb.sng.link", "draftkings.onelink.me"]);
const MAX_SLIP_URL = 600;

function dkSlipUrl(raw) {
  if (typeof raw !== "string") return { err: "Send the link as text." };
  const s = raw.trim();
  if (!s) return { err: "Paste a link first." };
  if (s.length > MAX_SLIP_URL) return { err: "That link is over " + MAX_SLIP_URL + " characters." };
  let u;
  try { u = new URL(s); } catch { return { err: "That is not a link." }; }
  if (u.protocol !== "https:") return { err: "The link has to be https." };
  // A URL carrying credentials can render as one host and resolve to another.
  if (u.username || u.password) return { err: "That link carries credentials. Paste the plain share link." };
  const host = u.hostname.toLowerCase();
  const dk = host === "draftkings.com" || host.endsWith(".draftkings.com") || DK_SHARE_HOSTS.has(host);
  if (!dk) return { err: "Only DraftKings links go on the ticket — that one points at " + host + "." };
  return { url: u.toString(), host };
}

// POST /league/slip {league, url} — ANY MEMBER. An empty url takes it down.
//
// Deliberately NOT manager-gated. Whoever actually placed the parlay is whoever
// placed it, and making them chase the manager to publish the link is how the
// link never gets published. Attribution is the check instead: the row records
// who put it up and when, and the ticket prints that next to the button.
async function leagueSlip(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const lid = leagueOf(body);
  if (!lid) return json({ error: "Bad league id." }, 400, cors);
  const auth = await requireMember(request, env, lid);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  // ⚠️ A graded week is a record. The link is archived into the history row on
  // rollover, so editing it afterwards rewrites a receipt that is already filed.
  if ((auth.league.status || "open") === "graded")
    return json({ error: "That week is graded. Its ticket is a receipt now." }, 409, cors);

  const raw = body.url == null ? "" : String(body.url);
  if (!raw.trim()) {
    await fbPut(env, LG(lid) + "/slip", null);
    return json({ ok: true, slip: null }, 200, cors);
  }
  const v = dkSlipUrl(raw);
  if (v.err) return json({ error: v.err }, 400, cors);

  // by/ts come from the SESSION and the SERVER, never from the body.
  const slip = { url: v.url, host: v.host, by: auth.name, ts: Date.now() };
  await fbPut(env, LG(lid) + "/slip", slip);
  return json({ ok: true, slip }, 200, cors);
}

/* ============================== league access ==============================
   Every Bozo league has one manager-controlled password. People authenticate first,
   search for a league, and submit {league,password}; the password grants membership
   to that authenticated account. Private rooms appear only on an exact-name search.

   ⚠️ PASSWORD HASHES LIVE IN KV, NEVER FIREBASE. /bozo is world-readable, so access
   material under /bozo/leagues/<id> would be public. KV is Worker-only. The historical
   joinlink:* key name remains only to migrate or revoke records created before links
   were retired; no route mints or redeems those links now.

   The cap is the blast radius. A shared password cannot grow a league past the
   manager's chosen ceiling.

   ⚠️ This is NOT how the draft rig works and must never become that. AGENTS.md
   rule 6: the draft board is public on purpose. This gates league MEMBERSHIP for
   the Bozo game only. */

// ⚠️ Names RL explicitly — this namespace holds the only password hashes. Pointing it
// at an empty namespace disables new joins until managers set passwords again.
const JOIN_KV = (env) => env.RL || null;
const JOIN_LG = (lid) => "joinlink:lg:" + lid;
const JOIN_CODE = (code) => "joinlink:code:" + code;
const JOIN_PASS = (hash) => "joinpass:code:" + hash;
const JOIN_CAP_DEFAULT = 20;
const JOIN_CAP_MIN = 2;
const JOIN_CAP_MAX = 64;
const JOIN_REDEEM_PER_DAY = 20;
// Legacy short-code helpers exist only so the first password join after deployment can
// honour a code that a manager set immediately before retirement. The next password
// change deletes this global lookup and writes the league-scoped form below.
const normJoinPass = (c) => String(c || "").trim().toUpperCase();
const joinPassHash = (env, c) =>
  hmac(env.BOZO_PEPPER, "bozo-league-code" + String.fromCharCode(0) + normJoinPass(c));

// League passwords are case-sensitive and scoped to one league. Scoping means two
// unrelated friend groups may choose the same password without either becoming a
// lookup for the other. The raw password never reaches Firebase or KV.
const normLeaguePassword = (p) => String(p == null ? "" : p).trim();
const validLeaguePassword = (p) => {
  const s = normLeaguePassword(p);
  return s.length >= 6 && s.length <= 64 && !/[\u0000-\u001f\u007f]/.test(s);
};
const leaguePasswordHash = (env, lid, password) =>
  hmac(env.BOZO_PEPPER, "bozo-league-password" + String.fromCharCode(0) + lid + String.fromCharCode(0) + normLeaguePassword(password));

function retiredLeagueLink(cors) {
  return json({ error: "League join links have been retired. Sign in, search for the league under Your Dawgs, and enter its password." }, 410, cors);
}

function retiredLeagueInvite(cors) {
  return json({ error: "Per-person league invites have been retired. The person should create their own account, search for the league, and enter its shared password." }, 410, cors);
}

const joinCapOf = (rec) =>
  Number.isFinite(rec && rec.cap) ? Math.min(JOIN_CAP_MAX, Math.max(JOIN_CAP_MIN, rec.cap)) : JOIN_CAP_DEFAULT;

// POST /league/join {league,password} — join after an authenticated search. A session
// says who, the selected id says where, and the shared password proves permission.
// This route never creates an account and never accepts retired link tokens.
async function leagueJoin(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const kv = JOIN_KV(env);
  if (!kv) return json({ error: "League access is unavailable right now." }, 503, cors);

  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err, needSignIn: true }, auth.code || 401, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }
  const lid = String(body.league || "");
  const password = normLeaguePassword(body.password);
  if (!validLeagueId(lid)) return json({ error: "Choose a league from search first." }, 400, cors);
  if (!validLeaguePassword(password))
    return json({ error: "League passwords are 6–64 characters." }, 400, cors);

  // Per-IP daily cap is the online-guessing boundary for shared passwords.
  let rlKey = null, used = 0;
  if (env.RL) {
    const day = new Date().toISOString().slice(0, 10);
    rlKey = "joinrl:" + day + ":" + (request.headers.get("CF-Connecting-IP") || "noip");
    used = parseInt((await env.RL.get(rlKey)) || "0", 10);
    if (used >= JOIN_REDEEM_PER_DAY)
      return json({ error: "Too many join attempts from here today. Try tomorrow." }, 429, cors);
    await env.RL.put(rlKey, String(used + 1), { expirationTtl: 172800 });
  }

  let lg, rec = null;
  try {
    lg = await loadLeague(env, lid);
    rec = JSON.parse((await kv.get(JOIN_LG(lid))) || "null");
  } catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
  if (!lg) return json({ error: "That league is gone." }, 404, cors);

  // Existing membership is already the authorization; no password is needed to keep it.
  if (isMember(lg, auth.name))
    return json({ ok: true, already: true, league: lid, name: lg.name || lid, size: memberNames(lg).length }, 200, cors);

  const currentHash = rec && rec.passwordHash;
  const legacyHash = rec && rec.passHash;
  let passwordOkay = false;
  try {
    if (currentHash)
      passwordOkay = timingSafeEqual(currentHash, await leaguePasswordHash(env, lid, password));
    else if (legacyHash)
      passwordOkay = timingSafeEqual(legacyHash, await joinPassHash(env, password));
  } catch { return json({ error: "League password check failed." }, 502, cors); }
  if (!passwordOkay) return json({ error: "That league password is not valid." }, 403, cors);

  // ⚠️ Same rule leagueMember enforces, for the same reason: joining mid-week moves
  // the lock threshold under a live board and could place the ticket early.
  if ((lg.status || "open") !== "open")
    return json({ error: "This week's ticket is already placed — you can join once next week opens." }, 409, cors);

  const cap = joinCapOf(rec);
  if (memberNames(lg).length >= cap)
    return json({ error: "That league is full (" + cap + " members)." }, 409, cors);

  // ⚠️ A UID IS REQUIRED TO TAKE A SEAT, and the refusal is deliberate rather than a
  // fallback to the display name. Falling back is exactly how the mutable key got into
  // league state in the first place; one legacy session would silently undo this commit.
  if (!auth.uid || !UID_RE.test(String(auth.uid)))
    return json({ error: "Your sign-in predates the current account system. Create an account on the sign-on page, then join." }, 409, cors);

  try {
    await fbPatch(env, LG(lid) + "/members",
                  { [auth.uid]: { name: auth.name, joinedAt: Date.now() } });
  } catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }

  const after = await loadLeague(env, lid);
  return json({ ok: true, league: lid, name: after.name || lid, size: memberNames(after).length, cap }, 200, cors);
}

// POST /league/access {league, action} — manager-only password, visibility and cap.
// Passwords are write-only: status reports whether one exists but never returns it.
async function leagueAccess(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const kv = JOIN_KV(env);
  if (!kv) return json({ error: "League access is unavailable right now." }, 503, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const lid = leagueOf(body);
  if (!lid) return json({ error: "Bad league id." }, 400, cors);
  const auth = await requireManager(request, env, lid);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  const action = String(body.action || "status");
  if (!["password", "password-off", "cap", "visibility", "status"].includes(action))
    return json({ error: "Unknown action." }, 400, cors);

  let rec = null;
  try { rec = JSON.parse((await kv.get(JOIN_LG(lid))) || "null"); }
  catch { rec = null; }

  const size = memberNames(auth.league).length;
  const reply = (r, visibility) => json({
    ok: true, league: lid, name: auth.league.name || lid,
    passwordEnabled: !!(r && (r.passwordHash || r.passHash)),
    cap: joinCapOf(r), size, full: r ? size >= joinCapOf(r) : false,
    visibility: visibility || (leagueIsPublic(lid, auth.league) ? "public" : "private"),
    visibilityLocked: PUBLIC_BOZO_LEAGUES.has(lid),
    changedTs: r ? (r.passwordChangedTs || r.passChangedTs || null) : null,
    changedBy: r ? (r.passwordChangedBy || r.passChangedBy || null) : null,
  }, 200, cors);

  if (action === "status") return reply(rec);

  if (action === "password") {
    const password = normLeaguePassword(body.password);
    if (!validLeaguePassword(password))
      return json({ error: "Use 6–64 characters with no control characters." }, 400, cors);
    const passwordHash = await leaguePasswordHash(env, lid, password);
    const next = {
      ...(rec || { cap: JOIN_CAP_DEFAULT, createdTs: Date.now(), createdBy: auth.name }),
      passwordHash, passwordChangedTs: Date.now(), passwordChangedBy: auth.name,
    };
    delete next.code; delete next.passHash; delete next.passChangedTs; delete next.passChangedBy;
    try {
      if (rec && rec.code) await kv.delete(JOIN_CODE(rec.code));
      if (rec && rec.passHash) await kv.delete(JOIN_PASS(rec.passHash));
      await kv.put(JOIN_LG(lid), JSON.stringify(next));
    } catch (e) { return json({ error: "League password write failed: " + e.message }, 502, cors); }
    return reply(next);
  }

  if (action === "password-off") {
    if (!rec || (!rec.passwordHash && !rec.passHash)) return reply(rec);
    const next = { ...rec, cap: joinCapOf(rec) };
    delete next.passwordHash; delete next.passwordChangedTs; delete next.passwordChangedBy;
    delete next.passHash; delete next.passChangedTs; delete next.passChangedBy;
    delete next.code;
    try {
      if (rec && rec.code) await kv.delete(JOIN_CODE(rec.code));
      if (rec && rec.passHash) await kv.delete(JOIN_PASS(rec.passHash));
      await kv.put(JOIN_LG(lid), JSON.stringify(next));
    } catch (e) { return json({ error: "League password write failed: " + e.message }, 502, cors); }
    return reply(next);
  }

  if (action === "cap") {
    const cap = parseInt(body.cap, 10);
    if (!Number.isFinite(cap) || cap < JOIN_CAP_MIN || cap > JOIN_CAP_MAX)
      return json({ error: "Cap must be a whole number from " + JOIN_CAP_MIN + " to " + JOIN_CAP_MAX + "." }, 400, cors);
    // ⚠️ A cap below the current roster is allowed and does NOT evict anyone. It just
    // closes the door: existing members stay, nobody new gets in until it is raised.
    const next = { ...(rec || { createdTs: Date.now(), createdBy: auth.name }), cap };
    try {
      await kv.put(JOIN_LG(lid), JSON.stringify(next));
    } catch (e) { return json({ error: "League access write failed: " + e.message }, 502, cors); }
    return reply(next);
  }

  if (action === "visibility") {
    const visibility = body.visibility === "public" ? "public" : "private";
    if (PUBLIC_BOZO_LEAGUES.has(lid) && visibility !== "public")
      return json({ error: "Bozo Boyz stays public." }, 400, cors);
    try { await fbPatch(env, LG(lid), { visibility }); }
    catch (e) { return json({ error: "League visibility write failed: " + e.message }, 502, cors); }
    return reply(rec, visibility);
  }

  return reply(rec);
}

// Cached pages may still post the names used by the short-lived join-code UI. Keep
// password/status/cap compatible, but every action that could mint or expose a link is
// permanently gone. This is a retirement shim, not a second access system.
async function leagueAccessLegacy(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  let body;
  try { body = await request.clone().json(); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }
  const action = String(body.action || "get");
  if (["get", "rotate", "off"].includes(action)) return retiredLeagueLink(cors);
  const mapped = action === "league-code" ? "password"
    : action === "league-code-off" ? "password-off" : action;
  const nextBody = { ...body, action: mapped };
  if (body.leagueCode != null && body.password == null) nextBody.password = body.leagueCode;
  const forwarded = new Request(request.url, {
    method: "POST", headers: request.headers, body: JSON.stringify(nextBody),
  });
  return leagueAccess(forwarded, env, cors);
}

/* ========================== the forecasting challenge ======================= */
/* Storage for the 538-style challenge. Entries only — no scores, no standings, no
 * running totals of any kind. Points, Brier, ranks and slices are all queries over
 * the entry table, and a stored total would be the one copy that could go stale.
 *
 *   /forecast/entries/<sport>/<season>/<week>/<user>/<game_id>   one entry
 *   /forecast/sealed/<sport>/<season>/<week>/<game_id>           one crowd consensus
 *
 * ⚠️ WHY /forecast AND NOT /users, WHICH IS WHERE THIS WAS FIRST AIMED.
 * loadUsers() reads the ENTIRE /users node in one fbGet, and sessionAuth() calls it on
 * every authenticated request. A season of entries nested under /users/<name>/ would put
 * every user's whole history on the wire for every signed-in click, against a hard 10 ms
 * CPU ceiling on the free plan. /forecast is a sibling root with identical protection.
 *
 * ⚠️ THE PROTECTION IS THE RTDB RULES, AND IT WAS MEASURED, NOT ASSUMED. On 2026-08-10 an
 * unauthenticated browser GET returned 200 for /bozo (world-readable, by design) and 401
 * Permission denied for /users, /bozoauth, / and /forecast. No rules change is needed here
 * and none should be made. Re-run that probe before deploying: if someone widens the rules,
 * these routes become the leak.
 *
 * This is the same reasoning CEP-7 used to put join codes in KV rather than under /bozo.
 * The conclusion differs only because /forecast, unlike /bozo/leagues/<id>, is closed.
 */

const FC_ROOT = "/forecast";
const FC_SPORTS = { nfl: "/data/nfl-schedule.json", cfb: "/data/cfb-schedule.json" };
const FC_MIN_TOUCH = 3;       // fewer than three touched entries is not a crowd
const FC_TRIM = 0.1;          // dropped from EACH end, by logit, once n >= 5
const FC_CLAMP_LO = 0.01;     // sliders reach 0 and 100; an unclamped logit is infinite
const FC_CLAMP_HI = 0.99;
const FC_WRITE_CAP = 2000;    // entry writes per HUMAN per day
// ⚠️ Agents get their own cap and their own key. FC_WRITE_CAP was sized for a person
// dragging sliders; a bot resubmitting on every model refresh burns that in an afternoon
// through no fault of its own. Sharing one counter would let a busy bot lock its owner
// out of the website, which is the wrong failure. Repeat submissions carrying the same
// idempotency_key cost nothing against either counter — see forecastEntry.
const FC_AGENT_WRITE_CAP = 5000;
const FC_BOTS_PER_OWNER = 3;
const FC_BOT_REG_CAP = 10;    // registrations per IP per day
const FC_CROWD_VERSION = "crowd-1.0.0";

const fcEntryPath = (sport, season, week, entrant, gameId) =>
  `${FC_ROOT}/entries/${sport}/${season}/${week}/${encodeURIComponent(entrant)}` +
  (gameId ? "/" + encodeURIComponent(gameId) : "");
const fcBotPath = (botName) =>
  `${FC_ROOT}/bots` + (botName ? "/" + encodeURIComponent(botName) : "");
const fcSealPath = (sport, season, week, gameId) =>
  `${FC_ROOT}/sealed/${sport}/${season}/${week}` + (gameId ? "/" + encodeURIComponent(gameId) : "");

/* ------------------------------ bot entrants ----------------------------- */
/* ⚠️ A BOT IS A RESERVED NAME IN THE ACCOUNT NAMESPACE, NOT A SUFFIX ON ITS OWNER'S.
 * The tempting shape is `owner~slug`, and it is wrong: account names have no enforced
 * charset at signup, so any separator that can be chosen can also appear inside a real
 * name, and the parse becomes ambiguous exactly once — silently, on somebody's receipt.
 * Registration instead refuses a name that already exists in /users OR in /forecast/bots,
 * so humans and bots share ONE namespace. That is correct on its own terms — leaderboard
 * names have to be unique anyway — and it means the entry path shape does not change:
 * .../<entrant>/<game_id> works whoever the entrant is.
 *
 * ⚠️ WHY BOTS DO NOT WRITE UNDER THEIR OWNER'S ACCOUNT. One entry per entrant per game
 * means an agent writing as its owner would overwrite the owner's own slider, last write
 * wins, with no way to tell afterwards which was which. It would also make the single
 * most interesting comparison in the whole project — you against your own bot —
 * impossible to express. */

// Domain-separated from MCP tokens and invite hashes: same pepper, different prefix, so a
// stolen credential of one kind can never be replayed as another.
const fcBotTokenHash = (env, token) => hmac(env.BOZO_PEPPER, "fcbot|" + token);

function newFcBotToken() {
  const raw = crypto.getRandomValues(new Uint8Array(24));
  let s = ""; for (const b of raw) s += String.fromCharCode(b);
  return "b_" + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Bot names are charset-controlled even though account names are not. We own this
// namespace's creation path, so there is no reason to inherit the looseness that forced
// the no-separator decision above.
const FC_BOT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,39}$/;
const fcNameKey = (s) => String(s || "").trim().toLowerCase();

/* Case-insensitive collision check across BOTH namespaces. "Kap" and "kap" as two
 * separate leaderboard rows would be a support problem and an impersonation vector. */
async function fcNameTaken(env, wanted) {
  const want = fcNameKey(wanted);
  let users = {};
  try { users = await loadUsers(env); } catch (e) { throw new Error("roster unreadable: " + e.message); }
  for (const k of Object.keys(users)) if (fcNameKey(playerName(k)) === want) return "an account";
  let bots = {};
  try { bots = (await fbGet(env, fcBotPath(null))).data || {}; }
  catch (e) { throw new Error("bot registry unreadable: " + e.message); }
  for (const [k, b] of Object.entries(bots))
    if (fcNameKey((b && b.bot_name) || decodeURIComponent(k)) === want) return "a bot";
  return null;
}

/* ⚠️ Resolves a bot credential to an entrant. This is sessionAuth's SIBLING, not a branch
 * inside it: the two credential kinds authorise different things, and folding them into
 * one function is how a bot token eventually gets accepted somewhere nobody intended.
 * A bot token is honoured on POST /forecast/entry and nowhere else. */
async function fcBotAuth(env, token) {
  const cfg = bozoConfig(env);
  if (cfg) return { err: cfg, code: 500 };
  if (!token) return { err: "Missing bot token.", code: 401 };
  const hash = await fcBotTokenHash(env, token);

  let bots;
  try { bots = (await fbGet(env, fcBotPath(null))).data || {}; }
  catch (e) { return { err: "Database unreachable: " + e.message, code: 502 }; }

  for (const [k, b] of Object.entries(bots)) {
    if (!b || b.token_hash !== hash) continue;
    if (b.revoked === true) return { err: "That bot token was revoked.", code: 403 };
    const botName = b.bot_name || decodeURIComponent(k);
    // Mirrors sessionAuth's roster check: if the owner is removed from /users, their
    // bots stop writing on the next request rather than outliving the human indefinitely.
    let players;
    try { players = userNames(await loadUsers(env)); }
    catch (e) { return { err: e.message, code: 502 }; }
    if (!players.includes(b.owner)) return { err: "That bot's owner is no longer a player.", code: 403 };
    return { entrant: botName, kind: "agent", owner: b.owner };
  }
  return { err: "Unknown bot token.", code: 401 };
}

/* The one place the two credential kinds meet. Header presence picks the path; a request
 * carrying both is treated as the human, because a session is the stronger claim and
 * silently preferring the bot would let a stolen token ride a real browser session. */
async function fcEntrantAuth(request, env) {
  const sessTok = request.headers.get("X-Dawg-Session") || request.headers.get("X-Bozo-Session") || "";
  if (sessTok) {
    const auth = await sessionAuth(request, env);
    if (auth.err) return auth;
    return { entrant: auth.name, kind: "human", owner: auth.name, source: "web" };
  }
  const botTok = request.headers.get("X-DD-Bot") || "";
  if (botTok) {
    const bot = await fcBotAuth(env, botTok);
    if (bot.err) return bot;
    return { entrant: bot.entrant, kind: "agent", owner: bot.owner, source: "api" };
  }
  return { err: "Sign in first, or send a bot token.", code: 401 };
}

/* ---------------------------- the schedule ------------------------------- */
/* kickoff_at comes from the canonical schedule surface and NEVER from the request.
 * A client that could name its own kickoff could name one in the future and write a
 * "prospective" forecast after the game had started. */
const fcScheduleCache = {};

async function fcSchedule(sport) {
  const url = FC_SPORTS[sport];
  if (!url) throw new Error("Unknown sport.");
  const hit = fcScheduleCache[sport];
  if (hit && Date.now() - hit.at < 900e3) return hit.games;

  const r = await fetch(SITE + url, { cf: { cacheTtl: 900, cacheEverything: true } });
  if (!r.ok) throw new Error(url + " unavailable: HTTP " + r.status);
  const envelope = await r.json();
  const data = envelope && envelope.data;
  const rows = data && data.games;
  if (!envelope || !envelope.as_of || !envelope.source || !Array.isArray(rows) || !rows.length)
    throw new Error(url + " has an invalid envelope");

  const games = new Map();
  for (const g of rows) {
    const kickoff = Date.parse(g && g.kickoff_at);
    if (!g || typeof g.game_id !== "string" || !g.game_id || !Number.isFinite(kickoff) ||
        typeof g.home_team !== "string" || typeof g.away_team !== "string" ||
        !Number.isInteger(g.season) || !Number.isInteger(g.week)) continue;
    games.set(g.game_id, {
      game_id: g.game_id, season: g.season, week: g.week, kickoff_ms: kickoff,
      kickoff_at: new Date(kickoff).toISOString(),
      home_team: g.home_team, away_team: g.away_team,
    });
  }
  if (!games.size) throw new Error(url + " produced no usable games");
  fcScheduleCache[sport] = { at: Date.now(), games };
  return games;
}

/* ----------------------------- aggregation ------------------------------- */
/* Average in LOG-ODDS, never in probabilities. Probability averaging is systematically
 * underconfident and costs most where forecasters agree — which is exactly where points
 * are earned. Do NOT extremize: the literature's case for it assumes partially
 * independent forecasters, and ours are not. Model numbers are on the site before you
 * pick, so copying is expected and is handled by MEASURING correlation against each
 * model rather than by hiding numbers. */
const fcLogit = p => {
  const q = Math.min(FC_CLAMP_HI, Math.max(FC_CLAMP_LO, Number(p)));
  return Math.log(q / (1 - q));
};
const fcSigmoid = z => 1 / (1 + Math.exp(-z));

/* ⚠️ `touched === true` is an EXPLICIT filter and must never become
 * `slider_value !== 50`. An untouched slider and a deliberate 50 have the same value and
 * opposite meanings — both score zero, but the first is an ABSENCE. Let untouched games
 * into the consensus at 50% and every lurker drags the crowd to the middle, which
 * destroys the only thing the human line is for: independence from the models. */
/* ⚠️ AGENTS ARE EXCLUDED FROM THE CROWD LINE. FC-C introduced bot entrants, which forces
 * a question stage FC-A did not have to answer: does dd-crowd-<sport> average humans, or
 * everyone? It has to be humans. The crowd line's entire reason to exist is being an
 * INDEPENDENT signal to grade the models against — and bots are model-driven by
 * construction, so admitting them turns "Data Dawgs Crowd" into a weighted average of the
 * same models it is supposed to be independent of. It would still be a legitimate line;
 * it would just no longer be the line the contract pre-registered.
 *
 * This is the same argument the `touched` filter already makes, one level up: untouched
 * sliders drag the crowd toward 50, and model-following bots drag it toward the models.
 * Both destroy independence, which is the only thing the human line is for.
 *
 * Agents still compete, still score, still get a leaderboard row. They just are not the
 * crowd. A v1 row has no entrant_kind, so `!== "agent"` treats it as human — which is
 * exactly right, because v1 predates bots existing at all. */
function fcAggregate(rows) {
  const contributors = rows
    .filter(r => r && r.touched === true && r.entrant_kind !== "agent" &&
                 Number.isFinite(Number(r.home_win_probability)))
    .sort((a, b) => String(a.entrant).localeCompare(String(b.entrant)));
  const n = contributors.length;
  if (n < FC_MIN_TOUCH) return null;

  const zs = contributors.map(r => fcLogit(r.home_win_probability)).sort((a, b) => a - b);
  let keep;
  if (n >= 5) {
    const k = Math.ceil(FC_TRIM * n);
    keep = zs.slice(k, n - k);
  } else {
    // Too few to trim meaningfully; the median is the robust statistic that remains.
    keep = n % 2 ? [zs[(n - 1) / 2]] : [zs[n / 2 - 1], zs[n / 2]];
  }
  const mean = keep.reduce((a, b) => a + b, 0) / keep.length;
  return {
    home_win_probability: Math.round(fcSigmoid(mean) * 1e6) / 1e6,
    n_touched: n,
    n_used: keep.length,
    n_trimmed: n - keep.length,
    contributors,
  };
}

/* The canonical row form the contributors hash is taken over — same device the receipt
 * ledger uses, so the consensus is recomputable by anyone once entries become readable. */
const fcCanonicalRow = r => JSON.stringify({
  game_id: r.game_id, home_win_probability: r.home_win_probability,
  submitted_at: r.submitted_at, touched: r.touched, entrant: r.entrant,
});

/* ------------------------- POST /forecast/entry -------------------------- */
async function forecastEntry(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  // The ONE route that accepts a bot credential. Everywhere else still calls sessionAuth.
  const auth = await fcEntrantAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code, cors);
  const { entrant, kind, owner, source } = auth;

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const sport = String(body.sport || "");
  if (!FC_SPORTS[sport]) return json({ error: "Unknown sport." }, 400, cors);
  const gameId = String(body.game_id || "");
  if (!gameId) return json({ error: "Which game?" }, 400, cors);

  let games;
  try { games = await fcSchedule(sport); }
  catch (e) { return json({ error: e.message }, 502, cors); }
  const game = games.get(gameId);
  if (!game) return json({ error: "No such game in the canonical schedule." }, 404, cors);

  // ⚠️ SERVER TIME, ALWAYS. This refusal is what makes forecast_status "prospective"
  // (captured_at < kickoff_at) true by construction instead of true by audit.
  const now = Date.now();
  if (now >= game.kickoff_ms)
    return json({ error: "That game has kicked off. Forecasts are locked." }, 409, cors);

  const slider = Number(body.slider_value);
  if (!Number.isInteger(slider) || slider < 0 || slider > 100)
    return json({ error: "slider_value must be a whole number from 0 to 100." }, 400, cors);
  const side = String(body.slider_side || "");
  if (side !== "home" && side !== "away")
    return json({ error: "slider_side must be home or away." }, 400, cors);
  if (typeof body.touched !== "boolean")
    return json({ error: "touched must be true or false." }, 400, cors);
  // ⚠️ The client may not assert the canonical probability. Deriving it here is what makes
  // it impossible for the raw slider and the number everything scores to disagree.
  if ("home_win_probability" in body)
    return json({ error: "home_win_probability is derived, not submitted." }, 400, cors);

  const pNaive = body.p_naive == null ? null : Number(body.p_naive);
  if (pNaive !== null && (!Number.isInteger(pNaive) || pNaive < 0 || pNaive > 100))
    return json({ error: "p_naive must be null or a whole number from 0 to 100." }, 400, cors);
  const entryMethod = body.entry_method == null ? "legacy" : String(body.entry_method);
  if (entryMethod !== "legacy" && entryMethod !== "drive")
    return json({ error: "entry_method must be legacy or drive." }, 400, cors);
  if (body.hints_revealed != null && typeof body.hints_revealed !== "boolean")
    return json({ error: "hints_revealed must be true or false." }, 400, cors);

  const idemKey = body.idempotency_key == null ? null : String(body.idempotency_key);
  if (idemKey !== null && (!idemKey || idemKey.length > 128))
    return json({ error: "idempotency_key must be a string of 1 to 128 characters." }, 400, cors);

  const path = fcEntryPath(sport, game.season, game.week, entrant, gameId);
  let prior = null;
  try { prior = (await fbGet(env, path)).data; }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }

  // ⚠️ IDEMPOTENCY IS CHECKED BEFORE THE CAP, AND THAT ORDER IS THE WHOLE POINT. A repeat
  // carrying a key we have already stored is a no-op, not a revision: it must not bump
  // `revision`, must not move `submitted_at`, and must not cost a write against the cap.
  // An agent that retries after a timeout it never saw the response to would otherwise be
  // punished for the network's failure, and its revision history would record edits that
  // never happened. Reading `prior` first is what makes this possible, which is why the
  // cap moved below the read.
  if (idemKey !== null && prior && prior.idempotency_key === idemKey)
    return json({ ok: true, entry: prior, idempotent: true }, 200, cors);

  if (env.RL) {
    const day = new Date().toISOString().slice(0, 10);
    const agent = kind === "agent";
    const key = agent ? `fc:b:${day}:${encodeURIComponent(entrant)}`
                      : `fc:w:${day}:${encodeURIComponent(entrant)}`;
    const cap = agent ? FC_AGENT_WRITE_CAP : FC_WRITE_CAP;
    const used = parseInt((await env.RL.get(key)) || "0", 10);
    if (used >= cap)
      return json({ error: `Daily forecast write cap reached (${cap}).` }, 429, cors);
    await env.RL.put(key, String(used + 1), { expirationTtl: 172800 });
  }

  const entry = {
    // ⚠️ v2 RENAMES `user` TO `entrant`, AND IT IS A CLEAN BREAK, NOT A DUPLICATE FIELD.
    // Nothing had ever read `user` — no page called these routes — so carrying both would
    // have bought compatibility with no reader, at the price of two names for one thing
    // and a permanent question about which is authoritative. `entrant` is the leaderboard
    // key and may be a person or a bot; `owner` is the human answerable for it, and equals
    // `entrant` for humans.
    v: 2,
    sport, season: game.season, week: game.week, game_id: gameId,
    entrant, entrant_kind: kind, owner,
    home_team: game.home_team, away_team: game.away_team, kickoff_at: game.kickoff_at,
    // The canonical number is ALWAYS P(home). Scoring is symmetric under
    // p -> 1-p, r -> 1-r, so the side the user expressed it on cannot change a score.
    home_win_probability: (side === "home" ? slider : 100 - slider) / 100,
    slider_value: slider,
    slider_side: side,
    // ⚠️ CLIENT-ASSERTED, like priceSource "self" on a Bozo leg — the Worker cannot observe
    // a drag. Stored anyway, and stored SEPARATELY from the value: "was here and left this
    // one alone" is real coverage information, and discarding it would make an absent
    // record ambiguous between two states that mean opposite things.
    touched: body.touched,
    p_naive: pNaive,
    entry_method: entryMethod,
    hints_revealed: body.hints_revealed === true,
    submitted_at: now,
    revision: (prior && Number.isInteger(prior.revision) ? prior.revision : 0) + 1,
    // Where the write came from, decided by which credential authenticated it — never
    // read from the body, so a caller cannot dress an API write up as a human one.
    source,
    idempotency_key: idemKey,
  };

  try { await fbPut(env, path, entry); }
  catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  return json({ ok: true, entry }, 200, cors);
}

/* ------------------------ GET /forecast/entries -------------------------- */
/* Your own week, and nothing else. This route reads exactly one node containing exactly
 * your own data, so the request that runs most often never holds another person's
 * pre-lock forecast in memory at all. */
async function forecastMine(request, url, env, cors) {
  if (request.method !== "GET") return json({ error: "GET only" }, 405, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code, cors);

  const sport = String(url.searchParams.get("sport") || "");
  if (!FC_SPORTS[sport]) return json({ error: "Unknown sport." }, 400, cors);
  const season = parseInt(url.searchParams.get("season") || "", 10);
  const week = parseInt(url.searchParams.get("week") || "", 10);
  if (!Number.isInteger(season) || !Number.isInteger(week))
    return json({ error: "season and week are required." }, 400, cors);

  let mine, sealed;
  try {
    mine = (await fbGet(env, fcEntryPath(sport, season, week, auth.name, null))).data || {};
    sealed = (await fbGet(env, fcSealPath(sport, season, week, null))).data || {};
  } catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }

  return json({
    ok: true, sport, season, week,
    entries: Object.values(mine),
    // The sealed rows are for games that have already locked, so publishing them here
    // discloses nothing that was private a moment ago.
    sealed: Object.values(sealed),
  }, 200, cors);
}

/* -------------------------- GET /forecast/game --------------------------- */
/* Every entry for one game — AFTER kickoff and never before. This is the route the
 * privacy assertion attacks. */
async function forecastGame(request, url, env, cors) {
  if (request.method !== "GET") return json({ error: "GET only" }, 405, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code, cors);

  const sport = String(url.searchParams.get("sport") || "");
  if (!FC_SPORTS[sport]) return json({ error: "Unknown sport." }, 400, cors);
  const gameId = String(url.searchParams.get("game_id") || "");
  if (!gameId) return json({ error: "Which game?" }, 400, cors);

  let games;
  try { games = await fcSchedule(sport); }
  catch (e) { return json({ error: e.message }, 502, cors); }
  const game = games.get(gameId);
  if (!game) return json({ error: "No such game in the canonical schedule." }, 404, cors);

  // ⚠️ THE ONE THAT MATTERS. Nobody but the owner reads an entry until the game locks.
  // Refuse BEFORE any read, so a bug in the shaping code below cannot leak anything.
  if (Date.now() < game.kickoff_ms)
    return json({ error: "Forecasts stay private until kickoff." }, 409, cors);

  let byEntrant;
  try { byEntrant = (await fbGet(env, `${FC_ROOT}/entries/${sport}/${game.season}/${game.week}`)).data || {}; }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }

  const key = encodeURIComponent(gameId);
  const entries = [];
  for (const perEntrant of Object.values(byEntrant)) {
    const row = perEntrant && perEntrant[key];
    if (row) entries.push(row);
  }
  entries.sort((a, b) => String(a.entrant).localeCompare(String(b.entrant)));

  let sealed = null;
  try { sealed = (await fbGet(env, fcSealPath(sport, game.season, game.week, gameId))).data || null; }
  catch { /* the entries are the answer; a missing seal is not an error */ }

  return json({ ok: true, sport, game_id: gameId, kickoff_at: game.kickoff_at, entries, sealed }, 200, cors);
}

/* ------------------------- POST /forecast/seal --------------------------- */
/* Freeze the crowd consensus for every game in a week that has kicked off and has no
 * sealed row yet. Idempotent: an existing row is NEVER overwritten, not even a wrong one.
 * A ledger that can be corrected in place is not a ledger.
 *
 * ⚠️ captured_at AND sealed_at ARE TWO DIFFERENT FACTS AND BOTH ARE PUBLISHED.
 * A consensus can only be computed once its inputs stop changing, which is kickoff — so
 * captured_at = now would be at or after kickoff and the row could never be prospective.
 *   captured_at = the latest submitted_at among contributors. The instant the forecast
 *                 became fully determined. < kickoff_at by construction, because
 *                 /forecast/entry refuses every later write.
 *   sealed_at   = when this row was written. >= kickoff_at, always.
 * captured_at alone is true but invites "we computed this before kickoff", which is false.
 * Publishing both makes the claim exact: every input predates kickoff, the arithmetic
 * does not. */
async function forecastSeal(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = await requireAdmin(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const sport = String(body.sport || "");
  if (!FC_SPORTS[sport]) return json({ error: "Unknown sport." }, 400, cors);
  const season = parseInt(body.season, 10);
  const week = parseInt(body.week, 10);
  if (!Number.isInteger(season) || !Number.isInteger(week))
    return json({ error: "season and week are required." }, 400, cors);

  let games;
  try { games = await fcSchedule(sport); }
  catch (e) { return json({ error: e.message }, 502, cors); }

  let byEntrant, already;
  try {
    byEntrant = (await fbGet(env, `${FC_ROOT}/entries/${sport}/${season}/${week}`)).data || {};
    already = (await fbGet(env, fcSealPath(sport, season, week, null))).data || {};
  } catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }

  const perGame = new Map();
  for (const entries of Object.values(byEntrant)) {
    for (const row of Object.values(entries || {})) {
      if (!row || typeof row.game_id !== "string") continue;
      if (!perGame.has(row.game_id)) perGame.set(row.game_id, []);
      perGame.get(row.game_id).push(row);
    }
  }

  const now = Date.now();
  const sealed = [], skipped = [];
  for (const [gameId, rows] of perGame) {
    const game = games.get(gameId);
    if (!game) { skipped.push({ game_id: gameId, why: "not in the canonical schedule" }); continue; }
    if (now < game.kickoff_ms) { skipped.push({ game_id: gameId, why: "not kicked off" }); continue; }
    if (already[encodeURIComponent(gameId)]) {
      skipped.push({ game_id: gameId, why: "already sealed" }); continue;
    }
    const agg = fcAggregate(rows);
    if (!agg) { skipped.push({ game_id: gameId, why: `fewer than ${FC_MIN_TOUCH} touched entries` }); continue; }

    const capturedMs = Math.max(...agg.contributors.map(r => Number(r.submitted_at) || 0));
    // Belt and braces: an entry that somehow predates nothing, or postdates kickoff, must
    // never be laundered into a prospective row by the aggregator.
    if (!(capturedMs > 0 && capturedMs < game.kickoff_ms)) {
      skipped.push({ game_id: gameId, why: "a contributing entry is not prospective" });
      continue;
    }

    const row = {
      v: 1,
      model_id: "dd-crowd-" + sport,
      model_name: "Data Dawgs Crowd",
      model_version: FC_CROWD_VERSION,
      sport, season, week, game_id: gameId,
      home_team: game.home_team, away_team: game.away_team,
      kickoff_at: game.kickoff_at,
      home_win_probability: agg.home_win_probability,
      aggregation: "trimmed-mean-logit",
      trim_fraction: FC_TRIM,
      clamp: [FC_CLAMP_LO, FC_CLAMP_HI],
      extremized: false,
      min_touch: FC_MIN_TOUCH,
      n_touched: agg.n_touched,
      n_used: agg.n_used,
      n_trimmed: agg.n_trimmed,
      captured_at: new Date(capturedMs).toISOString(),
      sealed_at: new Date(now).toISOString(),
      forecast_status: "prospective",
      contributors: agg.contributors.map(r => r.entrant),
      contributors_sha256: await sha256hex(agg.contributors.map(fcCanonicalRow).join("\n")),
    };
    try { await fbPut(env, fcSealPath(sport, season, week, gameId), row); }
    catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
    sealed.push(row);
  }

  return json({ ok: true, sport, season, week, sealed, skipped }, 200, cors);
}

/* -------------------------- GET /forecast/week --------------------------- */
/* Every entry for one week, admin only. This is the grader's read: scripts/forecast_grade.py
 * joins these against the canonical schedule's finals, out here rather than in the Worker,
 * because outcomes and grades are evidence ABOUT forecasts and must be produced by a
 * different process from a different source. Keeping them together would let a bug in
 * scoring rewrite a forecast, which is the one thing the storage layer exists to prevent.
 *
 * ⚠️ IT REFUSES A WEEK THAT IS NOT FULLY KICKED OFF, AND THAT IS NOT A CONVENIENCE CHECK.
 * The whole privacy guarantee is that nobody but the owner reads an entry before that
 * game locks. An admin route returning a week with one unkicked game in it would be a
 * hole straight through that promise — and the person holding the admin credential is
 * also an entrant. The refusal is checked BEFORE any read, so a bug in the shaping code
 * below cannot leak what the guard would have refused. */
async function forecastWeek(request, url, env, cors) {
  if (request.method !== "GET") return json({ error: "GET only" }, 405, cors);
  const auth = await requireAdmin(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  const sport = String(url.searchParams.get("sport") || "");
  if (!FC_SPORTS[sport]) return json({ error: "Unknown sport." }, 400, cors);
  const season = parseInt(url.searchParams.get("season") || "", 10);
  const week = parseInt(url.searchParams.get("week") || "", 10);
  if (!Number.isInteger(season) || !Number.isInteger(week))
    return json({ error: "season and week are required." }, 400, cors);

  let games;
  try { games = await fcSchedule(sport); }
  catch (e) { return json({ error: e.message }, 502, cors); }

  const now = Date.now();
  const pending = [];
  for (const g of games.values()) {
    if (g.season !== season || g.week !== week) continue;
    if (now < g.kickoff_ms) pending.push(g.game_id);
  }
  if (!games.size) return json({ error: "The schedule produced no games." }, 502, cors);
  if (pending.length)
    return json({ error: "That week still has games that have not kicked off.", pending }, 409, cors);

  let byEntrant, sealed;
  try {
    byEntrant = (await fbGet(env, `${FC_ROOT}/entries/${sport}/${season}/${week}`)).data || {};
    sealed = (await fbGet(env, fcSealPath(sport, season, week, null))).data || {};
  } catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }

  const entries = [];
  for (const perEntrant of Object.values(byEntrant))
    for (const row of Object.values(perEntrant || {})) if (row) entries.push(row);
  entries.sort((a, b) => String(a.game_id).localeCompare(String(b.game_id)) ||
                         String(a.entrant).localeCompare(String(b.entrant)));

  return json({ ok: true, sport, season, week, entries, sealed: Object.values(sealed) }, 200, cors);
}

/* -------------------------- POST /forecast/bot --------------------------- */
/* Register, rotate or revoke a bot entrant. Session required, and it acts ONLY on bots
 * the caller owns — the same "acts only on SELF" discipline /auth/mcp-token has.
 *
 * ⚠️ REGISTRATION REQUIRES A CONFIRMED EMAIL, AND FORECAST ENTRY DOES NOT. That asymmetry
 * is deliberate. A slider is a person playing a game; a verification wall in front of it
 * would cost conversion and protect nothing. A bot token is a different object: it writes
 * attributable prospective receipts, unattended, at volume, and it is the thing that would
 * be abused first. Requiring a reachable human behind it is proportionate to what it can
 * do — and unlike a slider, nobody is standing there waiting on it. */
async function forecastBot(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 401, cors);

  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const action = String((body && body.action) || "");
  if (!["register", "rotate", "revoke"].includes(action))
    return json({ error: "action must be register, rotate or revoke." }, 400, cors);
  const botName = String((body && body.bot_name) || "").trim();
  if (!botName) return json({ error: "bot_name is required." }, 400, cors);

  let users;
  try { users = await loadUsers(env); }
  catch (e) { return json({ error: e.message }, 502, cors); }
  const me = users[auth.name] || users[encodeURIComponent(auth.name)] || null;

  /* ---------------------------- register ---------------------------- */
  if (action === "register") {
    if (!me || me.emailVerified !== true)
      return json({ error: "Confirm your email address before registering a bot." }, 403, cors);
    if (!FC_BOT_NAME_RE.test(botName))
      return json({ error: "bot_name must be 2 to 40 characters: letters, digits, spaces, dot, underscore or hyphen, starting with a letter or digit." }, 400, cors);

    if (env.RL) {
      const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
      const key = `fcbotreg:${new Date().toISOString().slice(0, 10)}:${ip}`;
      const used = parseInt((await env.RL.get(key)) || "0", 10);
      if (used >= FC_BOT_REG_CAP)
        return json({ error: "Too many bot registrations from this address today." }, 429, cors);
      await env.RL.put(key, String(used + 1), { expirationTtl: 172800 });
    }

    let bots;
    try { bots = (await fbGet(env, fcBotPath(null))).data || {}; }
    catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
    const mine = Object.values(bots).filter(b => b && b.owner === auth.name && b.revoked !== true);
    if (mine.length >= FC_BOTS_PER_OWNER)
      return json({ error: `You already have ${FC_BOTS_PER_OWNER} active bots.` }, 409, cors);

    let taken;
    try { taken = await fcNameTaken(env, botName); }
    catch (e) { return json({ error: e.message }, 502, cors); }
    if (taken) return json({ error: `That name is already ${taken}. Bots and people share one namespace.` }, 409, cors);

    const token = newFcBotToken();
    const rec = {
      v: 1,
      owner: auth.name,
      bot_name: botName,
      created_at: Date.now(),
      token_hash: await fcBotTokenHash(env, token),
      token_set_at: Date.now(),
      revoked: false,
      agent_note: String((body && body.agent_note) || "").slice(0, 280),
    };
    try { await fbPut(env, fcBotPath(botName), rec); }
    catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
    // ⚠️ Shown ONCE. Only the hash is stored, so it cannot be redisplayed — same discipline
    // as invite tokens and MCP tokens. Losing it means rotating.
    return json({ ok: true, bot: fcPublicBot(botName, rec), token,
                  note: "Copy this token now. It is shown once and only its hash is stored. Send it as the X-DD-Bot header on POST /forecast/entry." }, 200, cors);
  }

  /* ------------------------ rotate / revoke ------------------------- */
  let rec;
  try { rec = (await fbGet(env, fcBotPath(botName))).data; }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
  // Same answer for "does not exist" and "is not yours", so this cannot be used to probe
  // which bot names other people have registered.
  if (!rec || rec.owner !== auth.name) return json({ error: "No such bot of yours." }, 404, cors);

  if (action === "revoke") {
    // ⚠️ REVOKE DOES NOT DELETE THE RECORD. The name must stay reserved: its entries are
    // already attributed to it, and freeing the name would let someone else register it
    // and inherit a leaderboard row full of somebody else's forecasts.
    try { await fbPatch(env, fcBotPath(botName), { revoked: true, revoked_at: Date.now() }); }
    catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
    return json({ ok: true, bot: fcPublicBot(botName, { ...rec, revoked: true }), revoked: true }, 200, cors);
  }

  const token = newFcBotToken();
  try {
    await fbPatch(env, fcBotPath(botName),
      { token_hash: await fcBotTokenHash(env, token), token_set_at: Date.now(), revoked: false });
  } catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }
  return json({ ok: true, bot: fcPublicBot(botName, rec), token,
                note: "Rotated. The previous token stopped working immediately." }, 200, cors);
}

// The public shape of a bot. ⚠️ token_hash is never in it — not because the hash is
// usable, but because publishing it invites someone to try.
const fcPublicBot = (name, b) => ({
  bot_name: b.bot_name || name,
  owner: b.owner,
  created_at: b.created_at || null,
  token_set_at: b.token_set_at || null,
  revoked: b.revoked === true,
  agent_note: b.agent_note || "",
});

/* -------------------------- GET /forecast/bots --------------------------- */
async function forecastBots(request, env, cors) {
  if (request.method !== "GET") return json({ error: "GET only" }, 405, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 401, cors);

  let bots;
  try { bots = (await fbGet(env, fcBotPath(null))).data || {}; }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }

  const mine = Object.entries(bots)
    .filter(([, b]) => b && b.owner === auth.name)
    .map(([k, b]) => fcPublicBot(decodeURIComponent(k), b))
    .sort((a, b) => a.bot_name.localeCompare(b.bot_name));
  return json({ ok: true, owner: auth.name, bots: mine, cap: FC_BOTS_PER_OWNER }, 200, cors);
}

/* =============================== /bozo/pick =============================== */
// One leg per person. Favorites only, band from /bozo/config. No exact duplicates.
// Editing is allowed while the board is open — the Worker stamps a fresh server
// timestamp, which is what "editing resets your clock and your price" means.
// When the last leg lands, the board locks and the permutation is drawn.

// The single place a Bozo leg is written. Both entry paths — the site form via
// bozoPick below, and the MCP two-phase tool dd_submit_bozo_leg — land here AFTER
// their own auth, membership, status and validatePick checks have passed. Extracted
// so the stored pick shape can never drift between the two: a second copy of this
// object is how an MCP leg would silently stop carrying startsAt and fall out of the
// close capture.
// `via` records HOW the leg arrived ("mcp"), not who submitted it — identity is
// `name`, checked by the caller. Site submissions carry no `via`, exactly as before.
async function commitBozoLeg(env, lid, state, name, p, via = null, mkey = null) {
  const set = settingsOf(state);
  // The caller has already resolved membership; this is the key that resolution produced.
  // Refusing a null key rather than falling back to the name keeps one code path.
  const key = mkey || memberKeyOf(state, { name });
  if (!key) return { ok: false, error: "You are not in this league." };

  // ⚠️ The opposite side is NOT optional. Without it there is no de-vig, and the
  // chart's y-axis baseline is wrong by the whole hold — about two probability
  // points, which is comparable to the entire spread of CLV across the league. A leg
  // that arrives without it is stored with null and flagged, never quietly de-vigged
  // against nothing. See handoff §4 rule 6.
  const oppRaw = Number(p.priceOpp);
  const entryPriceOpp = Number.isFinite(oppRaw) && Math.abs(oppRaw) >= 100 ? Math.round(oppRaw) : null;

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
    // ⚠️ Where the PRICE came from, not where the pick came from. "captured" is
    // server-only and carries the SGO/DraftKings receipt fields below. "self" is limited
    // to props whose capture failed and `other`; both are visibly excluded from CLV.
    priceSource: p.priceSource === "captured" ? "captured" : "self",
    // ⚠️ Stored so the uniqueness and contradiction checks never have to re-derive a
    // key from a row written under an older version of the rules. A key that drifts
    // between write time and read time silently stops catching collisions.
    selectionKey: selectionKeyOf(p),
    marketKey: marketKeyOf(p),
    // ⚠️ Kickoff, carried from the ESPN game the player picked. The close capture has
    // no other way to know WHEN to snap: event ids don't line up between ESPN and the
    // odds source, so this timestamp is what schedules the whole thing. A leg without
    // it is never captured — see bozoCloseTargets.
    startsAt: typeof p.startsAt === "string" && !isNaN(Date.parse(p.startsAt)) ? p.startsAt : null,
    priceOpp: entryPriceOpp,
    entryPriceOpp,
    entryBook: "draftkings",        // league rule: there is no other book at either end
    entryProvider: p.entryProvider || null,
    entrySnapshotAt: p.entrySnapshotAt || null,
    fairEntry: Number.isFinite(Number(p.fairEntry)) ? Number(p.fairEntry) : null,
    entryHold: Number.isFinite(Number(p.entryHold)) ? Number(p.entryHold) : null,
    clvEligible: p.clvEligible === true,
    canonicalKey: p.canonicalKey || null,
    commenceTime: p.commenceTime || p.startsAt || null,
    espnEventId: p.espnEventId || String(p.eventId),
    providerEventIds: p.providerEventIds || {},
    closeState: p.closeState || "pending",
    submissionId: p.submissionId || null,
    // ⚠️ "asserted", not "verified". DK has no public API, so this records that the
    // player is claiming an SGP-legal selection and that it passed the structural
    // checks — nothing has asked DraftKings.
    dkSgpEligible: "asserted",
    // ⚠️ Audit, spec'd in cep-identity §4.4: an agent-submitted leg must be
    // distinguishable from a hand-submitted one forever, without guessing. Only the
    // Worker sets this; no request body may carry it.
    ...(via ? { via } : {}),
    // ⚠️ The display name AT SUBMISSION TIME, stored on the leg itself. Ledger rows are
    // immutable receipts that outlive membership: resolving the name through the members
    // map at render time would turn every row for a departed member into a bare uid.
    // A later rename changes the live board and leaves settled receipts alone, which is
    // the correct behaviour for a receipt.
    who: String(name || ""),
    ts: Date.now(),                 // SERVER time — the reason this route exists
  };
  await fbPut(env, LG(lid) + "/picks/" + key, pick);

  // ⚠️ THE LABEL IS REFRESHED ON EVERY SUBMISSION, and this is what keeps a rename from
  // going stale. /auth/rename writes the new name to /users/<uid> and knows nothing about
  // which leagues that person sits in; without this line the board would keep showing the
  // old name until they re-joined. Filing a leg re-stamps it, so a rename is visible from
  // the next submission and no cross-league name index has to exist.
  try { await fbPatch(env, LG(lid) + "/members/" + key, { name: String(name || "") }); }
  catch { /* the leg is the write that matters; a stale label is cosmetic and self-heals */ }

  const picks = (await fbGet(env, LG(lid) + "/picks")).data || {};
  // ⚠️ THIS league's threshold, never the global roster. Default is "everyone in",
  // where the size IS the member count — an 8-person league locks on the 8th leg and
  // a 4-person league on the 4th. A league can instead lock at a fixed count, which
  // turns Last In into a race with a real risk of not making the ticket at all.
  // ⚠️ In Bozo Royale the threshold is the ALIVE roster, not the member count. A
  // chopped player never submits again, so waiting for "everyone in" would mean the
  // ticket could never lock once the first elimination landed — the board would just
  // sit open forever with the league unable to play.
  const size = set.format === "royale" ? royaleRoster(state).length : memberNames(state).length;
  const need = set.lockRule === "count" ? Math.min(set.lockCount || size, size || set.lockCount) : size;
  let placed = false;
  if (need > 0 && Object.keys(picks).length >= need) {
    placed = await placeAndDraw(env, lid, picks, state);
  }
  return { ok: true, ts: pick.ts, placed, size, need };
}

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

  if ((state.status || "open") !== "open" && body.confirm === undefined) {
    return json({ error: "The ticket is placed. Board is locked." }, 409, cors);
  }

  const mkey = memberKeyOf(state, auth);
  if (!mkey) return json({ error: "You are not in this league." }, 403, cors);

  try {
    if (body.action === "remove") {
      await fbDelete(env, LG(lid) + "/picks/" + mkey);
      bozoNullWriteTripwire("/bozo/pick remove", auth, lid, ["picks/" + mkey]);
      return json({ ok: true, removed: true }, 200, cors);
    }

    const set = settingsOf(state);
    if (!env.RL) return json({ error: "The confirmation store is not configured." }, 503, cors);
    const kvKey = "bozoconfirm:" + (auth.uid || name) + ":" + lid;

    // "Editing is allowed until the ticket is placed" is the default, not a law. A
    // league can lock a leg the moment it lands — which removes the edit-resets-your-
    // clock dynamic entirely, so it is a real change to how the game plays.
    if (body.confirm === undefined && !set.allowEdit && (state.picks || {})[mkey])
      return json({ error: "This league locks your leg once it's in — no edits." }, 409, cors);

    // Bozo Royale: a chopped player funds the ticket, they do not bet on it. Their
    // re-deploy puts you straight back the first time; after that this is the end of it.
    if (body.confirm === undefined && set.format === "royale" && !royaleAliveKey(state, mkey))
      return json({ error: "You're out — chopped in week " + (royaleStatus(state)[mkey]?.chopped?.slice(-1)[0] ?? "?") + ". You fund this ticket; you don't have a leg on it." }, 409, cors);

    // Phase two commits the quote frozen in KV. It deliberately does not call SGO again:
    // confirmation is approval of the exact price printed in phase one's echo.
    if (body.confirm !== undefined) {
      const code = String(body.confirm || "").trim().toUpperCase();
      let pend;
      try { pend = JSON.parse((await env.RL.get(kvKey)) || "null"); } catch { pend = null; }
      if (!pend) return json({ error: "No proposal is waiting for confirmation. It may have expired." }, 409, cors);
      if (pend.code !== code) return json({ error: pend.consumed ? "That confirmation was already used." : "Wrong confirmation code." }, 409, cors);
      if (pend.consumed) return json(pend.result, 200, cors);
      if (pend.week !== (state.week || 1)) return json({ error: "The league advanced. Propose the leg again." }, 409, cors);
      const landed = (state.picks || {})[mkey];
      if (landed && landed.submissionId === code)
        return json({ ok: true, status: "submitted", replayed: true, ts: landed.ts,
          placed: (state.status || "open") !== "open",
          leg: { label: landed.label, line: landed.line, price: landed.price,
            priceOpp: landed.entryPriceOpp, priceSource: landed.priceSource } }, 200, cors);
      if ((state.status || "open") !== "open")
        return json({ error: "The ticket is placed. Board is locked." }, 409, cors);
      if (!set.allowEdit && landed)
        return json({ error: "This league locks your leg once it's in — no edits." }, 409, cors);
      if (set.format === "royale" && !royaleAliveKey(state, mkey))
        return json({ error: "You're out of this Royale league." }, 409, cors);
      const err = validatePick(pend.p, name, state.picks || {}, bandOf(state), set.format, mkey);
      if (err) return json({ error: "The leg no longer passes validation: " + err }, 409, cors);
      const out = await commitBozoLeg(env, lid, state, name, pend.p, null, mkey);
      const result = { ...out, status: "submitted", leg: {
        label: pend.p.label, line: pend.p.line, price: pend.p.price,
        priceOpp: pend.p.priceOpp, priceSource: pend.p.priceSource,
      } };
      try { await env.RL.put(kvKey, JSON.stringify({ code, consumed: true, result }), { expirationTtl: 3600 }); } catch {}
      return json(result, 200, cors);
    }

    // A stale cached page used to interpret a phase-one 200 as "Submitted". Require the
    // new protocol marker so an old client gets a visible reload error and writes nothing.
    if (body.captureVersion !== 1)
      return json({ error: "Price capture is now two-phase. Reload this page before submitting." }, 409, cors);
    const input = { ...(body.pick || {}) };
    if (input.price !== undefined && input.typedPrice === undefined) input.typedPrice = input.price;
    const captured = await bozoCaptureEntry(env, input);
    if (!captured.ok) return json({ error: captured.error }, 400, cors);
    const p = captured.p;
    const err = validatePick(p, name, state.picks || {}, bandOf(state), set.format, mkey);
    if (err) return json({ error: `Captured DraftKings ${p.price} / ${p.priceOpp ?? "no opposite"} at line ${p.line}. ${err}`,
      captured: { line: p.line, price: p.price, priceOpp: p.priceOpp } }, 400, cors);

    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", rnd = new Uint32Array(6);
    crypto.getRandomValues(rnd);
    let code = ""; for (const n of rnd) code += alphabet[n % alphabet.length];
    p.submissionId = code;
    const mine = (state.picks || {})[mkey] || null;
    const echo = p.label + " — " + p.game + ", " + (p.mkt === "ml" ? "moneyline" : p.mkt + " " + p.line) +
      " at " + p.price + " (other side " + (p.priceOpp == null ? "not captured" : p.priceOpp) + "), " +
      (p.priceSource === "captured" ? "captured from DraftKings via SGO" : "self-priced; not CLV-eligible") + "." +
      (mine ? " This replaces your current leg and resets your submission clock." : "");
    await env.RL.put(kvKey, JSON.stringify({ code, lid, week: state.week || 1, p, echo, ts: Date.now() }), { expirationTtl: 300 });
    return json({ status: "confirm_required", echo, confirm_code: code, expires_in: 300,
      captured: { line: p.line, price: p.price, priceOpp: p.priceOpp, priceSource: p.priceSource,
        clvEligible: p.clvEligible, entrySnapshotAt: p.entrySnapshotAt },
      agreement: captured.agreement || null, warning: captured.captureWarning || null }, 200, cors);
  } catch (e) {
    return json({ error: "Submission failed: " + e.message }, 502, cors);
  }
}

/* ---------- the DraftKings SGP rule, enforced at submission ----------
   Every leg must be a real DraftKings selection that is legal in a same-game parlay.
   If it can't go on the ticket, it isn't a Bozo leg. Three checks follow from that, and
   they run on EVERY league — none of them is a manager preference, because none of them
   is about what the league wants. They are about what the bet physically is.

   ⚠️ NONE OF THIS IS VERIFICATION AGAINST DRAFTKINGS. DK has no public odds API — no
   developer portal, no key programme — so nothing here has asked DK whether the
   selection exists. What these checks catch is a ticket that could not be built even if
   every leg were real: the same selection twice, or two selections that cannot both win.
   Never present this as "checked against the book". */

// The selection: what you'd tap on the DK bet slip. Two players cannot both have it,
// because DK will not put the same selection on one parlay twice.
const selectionKeyOf = p => [
  String(p.eventId), p.mkt, String(p.side),
  p.mkt === "ml" ? "" : String(p.line ?? ""),
  String(p.prop || ""),
].join("|");

// The MARKET INSTANCE: the question, without the answer. Two different sides of one
// market instance can never both cash, so DK blocks the pair and so do we.
//
// ⚠️ Uniqueness does NOT catch this. "over 45.5" and "under 45.5" are distinct
// selections — different sides — so they pass the duplicate check and still make a
// ticket that cannot win.
//
// ⚠️ Spread keys on the ABSOLUTE line, so DET −8.5 and DEN +8.5 collide (they are the
// two sides of one instance) while DET −8.5 and DEN +10.5 do not (both can cash if DET
// wins by nine). Props key on text AND number, because "over 199.5 yards" and "over
// 249.5 yards" are two different markets that happen to share a name.
const marketKeyOf = p => [
  String(p.eventId), p.mkt,
  p.mkt === "total"  ? String(p.line ?? "")
  : p.mkt === "spread" ? String(Math.abs(Number(p.line) || 0))
  : p.mkt === "prop" ? String(p.prop || "") + "|" + String(p.line ?? "")
  : p.mkt === "other" ? String(p.prop || "")
  : "",
].join("|");

// A future is not an SGP-legal leg — DK will not parlay "to win the division" with game
// markets. This is a WORD MATCH, not a market lookup, and it is deliberately narrow:
// it catches the obvious ones and says so. `other` must be a game market.
const FUTURES_WORDS = /\b(to win (the )?(division|conference|championship|title|super ?bowl|pennant|cup|east|west|north|south)|mvp|award|make (the )?playoffs?|season win|regular[- ]season wins|to be drafted|coach of the year|rookie of the year)\b/i;

function validatePick(p, name, existing, band, format, mkey = null) {
  if (!LEAGUE[p.sport]) return "Unknown sport.";
  if (!BOZO_GRADEABLE_SPORTS.has(p.sport)) return "sport_not_gradeable";
  if (!MARKETS.includes(p.mkt)) return "Unknown market.";
  if (!p.eventId || !p.game) return "Pick a game.";
  if (!p.label || !p.side) return "Incomplete pick.";
  if (p.mkt === "other" && !String(p.prop || "").trim())
    return "Describe the bet — an \"other\" leg needs to say what it actually is.";
  if (!p.startsAt || isNaN(Date.parse(p.startsAt)))
    return "Kickoff time (startsAt) is required.";
  const price = Number(p.price);
  if (!isFinite(price) || price > band.ceil || price < band.floor)
    return `${p.price} is outside the ${band.ceil} to ${band.floor} band.`;
  if (p.mkt !== "ml" && !isFinite(Number(p.line))) return "Number is required for that market.";
  const gameMarket = p.mkt === "spread" || p.mkt === "ml" || p.mkt === "total";
  if (gameMarket && p.priceSource !== "captured")
    return "Spread, moneyline and total prices must be captured from DraftKings.";
  if (gameMarket && bzAmerican(p.priceOpp) === null)
    return "The captured opposite-side DraftKings price is required for that market.";
  if (p.priceSource === "captured" && (!p.entrySnapshotAt || !p.providerEventIds?.sgo))
    return "The captured quote is missing its source receipt.";
  if (p.priceSource === "captured" && assertQuote({ price: p.price, opp: p.priceOpp, line: p.line }, p))
    return "The captured quote is incomplete or does not match the selected number.";
  if (p.mkt === "other" && (p.priceSource !== "self" || p.clvEligible !== false))
    return "Other markets must be self-priced and excluded from CLV.";

  if ((p.mkt === "other" || p.mkt === "prop") && FUTURES_WORDS.test(String(p.prop || "")))
    return "That reads like a future, and DraftKings won't parlay a future with game legs. Bozo takes SGP-legal game markets only.";

  // ⚠️ Bozo Royale only: a prop or `other` leg is binary and Worst Beat needs a margin.
  // Kap's call was to give binary legs a margin from the de-vigged close rather than
  // restrict the markets, so this is NOT a rejection — the note is here so the next
  // person to read this file doesn't re-derive the exploit and "fix" it by banning them.
  // See royaleBeatDeficit().

  const meKey = mkey || encodeURIComponent(name), meName = playerName(name);
  const mySel = selectionKeyOf(p), myMkt = marketKeyOf(p);

  for (const [who, x] of Object.entries(existing)) {
    if (!x) continue;
    // ⚠️ The key comparison is what excludes MY OWN leg while I edit it. The name
    // comparisons stay as a belt for legacy/demo maps whose keys are still names.
    if (who === meKey || who === meName || (x.who || playerName(who)) === meName) continue;
    const theirSel = x.selectionKey || selectionKeyOf(x);
    if (theirSel === mySel)
      return `${x.who || playerName(who)} already has that exact selection — DraftKings won't take it twice on one parlay. Pick a different side, number or game.`;
    const theirMkt = x.marketKey || marketKeyOf(x);
    if (theirMkt === myMkt && String(x.side) !== String(p.side))
      return `${x.who || playerName(who)} has the other side of that same market (${x.label}). Both can't cash, so the ticket could never win — DraftKings blocks the pair.`;
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

  // ⚠️ THE FIRST LOCK FREEZES THE FORMAT. Up to here the ruleset is a choice on a league
  // nobody has played; from here it is the thing everyone's week was played under.
  // Switching it now would retroactively change who should have been eliminated — the
  // same class of error as mutating a published forecast.
  const lockPatch = { formatLocked: true };

  // ⚠️ There used to be buy-back offers to expire here. There aren't any: the re-deploy
  // is automatic and resolves at the chop, so nothing is ever left pending at a lock. Any
  // offers still stored are from before that change and are cleared once, so a league
  // mid-season doesn't carry a prompt nothing will ever answer.
  const offers = ((state && state.royale) || {}).offers || {};
  if (Object.keys(offers).length) lockPatch["royale/offers"] = null;
  try { await fbPatch(env, LG(lid), lockPatch); }
  catch (e) { console.log("royale: lock patch failed — " + e.message); }

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

/* ======================== Bozo schedule + score cache ======================
   ESPN rejects Cloudflare egress, so game facts are pulled on the existing hourly
   scheduled tick from two GitHub-hosted static sources and compacted into RL KV:

     schedule:nfl:<season>  — nflverse/nfldata data/games.csv
     schedule:cfb:<season>  — cfbfastR-data processed schedule (never raw)

   Foreign ids remain attributes. The ESPN id is useful for resolving old/browser picks,
   but the normalized row also carries a canonical team/date key. No odds column is copied
   out of either source. Blank/NA scores stay null all the way through grading. */
const BOZO_GRADEABLE_SPORTS = new Set(["nfl", "cfb"]);
const BOZO_SCHEDULE_SOURCE = Object.freeze({
  nfl: "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
  cfb: "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/schedules/csv/cfb_schedules_2026.csv",
});
const bozoScheduleKey = (sport, season) => `schedule:${sport}:${season}`;

// RFC-4180 enough for both captured sources: quoted commas, escaped quotes and CRLF.
// Returns arrays rather than allocating an object for every historical nflverse row.
function bozoCsvTable(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => {
    pushField();
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") pushField();
    else if (c === "\n") pushRow();
    else if (c !== "\r") field += c;
  }
  if (field || row.length) pushRow();
  if (!rows.length) throw new Error("schedule CSV is empty");
  const header = rows.shift();
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  return { index, rows };
}

const bozoCsvValue = (table, row, name) => {
  const i = table.index[name];
  return i == null ? "" : String(row[i] ?? "");
};
const bozoCsvNumber = value => {
  const s = String(value ?? "").trim();
  if (!s || /^na$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// nflverse documents gametime as US Eastern regardless of venue. Convert that wall time
// under America/New_York; appending Z would shift every close by four or five hours.
function bozoEasternKickoff(gameday, gametime) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(gameday || "")) || !/^\d{1,2}:\d{2}$/.test(String(gametime || ""))) return null;
  const [y, m, d] = gameday.split("-").map(Number);
  const [hh, mm] = gametime.split(":").map(Number);
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let guess = target;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  for (let n = 0; n < 2; n++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).filter(x => x.type !== "literal").map(x => [x.type, Number(x.value)]));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += target - shown;
  }
  return new Date(guess).toISOString();
}

function bozoCanonicalScheduleKey(sport, away, home, startsAt) {
  const registry = bozoBuildTeamRegistry(sport).aliases;
  const teams = [away, home].map(x => bozoTeamNorm(x, registry)).filter(Boolean).sort();
  return teams.length === 2 && !isNaN(Date.parse(startsAt || ""))
    ? [sport, teams.join("~"), startsAt.slice(0, 10)].join("|") : null;
}

function bozoEspnSeedTeam(sport, id, name) {
  const rows = ((BOZO_ESPN_TEAM_SEED.sports || {})[sport] || []);
  return rows.find(t => String(t.id) === String(id))
    || rows.find(t => [t.displayName, t.shortDisplayName, t.location].some(v => bzNorm(v) === bzNorm(name)))
    || null;
}

function bozoNormalizeNflSchedule(text, season) {
  const table = bozoCsvTable(text), games = [];
  for (const row of table.rows) {
    if (Number(bozoCsvValue(table, row, "season")) !== Number(season)) continue;
    const espnEventId = bozoCsvValue(table, row, "espn");
    if (!espnEventId) continue;
    const away = bozoCsvValue(table, row, "away_team"), home = bozoCsvValue(table, row, "home_team");
    const localDate = bozoCsvValue(table, row, "gameday");
    const startsAt = bozoEasternKickoff(localDate, bozoCsvValue(table, row, "gametime"));
    const awayScore = bozoCsvNumber(bozoCsvValue(table, row, "away_score"));
    const homeScore = bozoCsvNumber(bozoCsvValue(table, row, "home_score"));
    games.push({
      espnEventId, canonicalKey: bozoCanonicalScheduleKey("nfl", away, home, startsAt), startsAt, localDate,
      week: bozoCsvNumber(bozoCsvValue(table, row, "week")), seasonType: bozoCsvValue(table, row, "game_type"),
      completed: awayScore !== null && homeScore !== null,
      away: { name: away, abbr: away }, home: { name: home, abbr: home }, awayScore, homeScore,
    });
  }
  return games;
}

function bozoNormalizeCfbSchedule(text, season) {
  const table = bozoCsvTable(text), games = [];
  for (const row of table.rows) {
    if (Number(bozoCsvValue(table, row, "season")) !== Number(season)) continue;
    const espnEventId = bozoCsvValue(table, row, "game_id");
    if (!espnEventId) continue;
    const awayName = bozoCsvValue(table, row, "away_team"), homeName = bozoCsvValue(table, row, "home_team");
    const awayId = bozoCsvValue(table, row, "away_id"), homeId = bozoCsvValue(table, row, "home_id");
    const awaySeed = bozoEspnSeedTeam("cfb", awayId, awayName), homeSeed = bozoEspnSeedTeam("cfb", homeId, homeName);
    const startsAt = bozoCsvValue(table, row, "start_date") || null;
    const awayScore = bozoCsvNumber(bozoCsvValue(table, row, "away_points"));
    const homeScore = bozoCsvNumber(bozoCsvValue(table, row, "home_points"));
    games.push({
      espnEventId, canonicalKey: bozoCanonicalScheduleKey("cfb", awayName, homeName, startsAt), startsAt,
      localDate: startsAt ? startsAt.slice(0, 10) : null,
      week: bozoCsvNumber(bozoCsvValue(table, row, "week")), seasonType: bozoCsvValue(table, row, "season_type"),
      completed: /^true$/i.test(bozoCsvValue(table, row, "completed")) && awayScore !== null && homeScore !== null,
      away: { id: awayId, name: awayName, abbr: awaySeed?.abbreviation || awayName },
      home: { id: homeId, name: homeName, abbr: homeSeed?.abbreviation || homeName },
      awayScore, homeScore,
    });
  }
  return games;
}

async function bozoScheduleDoc(env, sport, season) {
  if (!env || !env.RL) throw new Error("schedule KV is not configured");
  try { return await env.RL.get(bozoScheduleKey(sport, season), "json"); }
  catch (e) { throw new Error("schedule KV read failed: " + e.message); }
}

async function bozoRefreshOneSchedule(env, sport, season, nowMs, fetcher = fetch) {
  if (!BOZO_GRADEABLE_SPORTS.has(sport)) throw new Error("unsupported schedule sport: " + sport);
  if (!env || !env.RL) throw new Error("schedule KV is not configured");
  const key = bozoScheduleKey(sport, season), previous = await bozoScheduleDoc(env, sport, season);
  const headers = previous?.etag ? { "If-None-Match": previous.etag } : {};
  const response = await fetcher(BOZO_SCHEDULE_SOURCE[sport], { headers });
  if (response.status === 304) return { sport, season, key, status: "not_modified", games: (previous.games || []).length };
  if (!response.ok) throw new Error(`${sport} schedule HTTP ${response.status}`);
  const csv = await response.text();
  const games = sport === "nfl" ? bozoNormalizeNflSchedule(csv, season) : bozoNormalizeCfbSchedule(csv, season);
  if (!games.length) throw new Error(`${sport} schedule contained no ${season} games`);
  const doc = { schemaVersion: 1, sport, season, etag: response.headers.get("ETag") || null,
    fetchedAt: new Date(nowMs).toISOString(), source: BOZO_SCHEDULE_SOURCE[sport], games };
  await env.RL.put(key, JSON.stringify(doc));
  return { sport, season, key, status: "updated", games: games.length, etag: doc.etag };
}

async function runBozoScheduleRefresh(env, nowMs = Date.now()) {
  return Promise.all(["nfl", "cfb"].map(sport => bozoRefreshOneSchedule(env, sport, SEASON, nowMs)));
}

function bozoPublicScheduleGames(doc, dates) {
  const m = String(dates || "").match(/^(\d{8})(?:-(\d{8}))?$/);
  const compact = s => String(s || "").replace(/-/g, "");
  const lo = m ? m[1] : null, hi = m ? (m[2] || m[1]) : null;
  return ((doc && doc.games) || []).filter(g => {
    const d = compact(g.localDate || (g.startsAt || "").slice(0, 10));
    return !lo || (d >= lo && d <= hi);
  }).map(g => ({
    id: String(g.espnEventId), short: `${g.away.abbr} @ ${g.home.abbr}`, start: g.startsAt,
    state: g.completed ? "post" : "pre", final: g.completed === true,
    teams: [
      { abbr: g.away.abbr, name: g.away.name, home: false, score: g.awayScore },
      { abbr: g.home.abbr, name: g.home.name, home: true, score: g.homeScore },
    ],
  }));
}

function bozoScheduleFindGame(doc, pick) {
  const games = Array.isArray(doc?.games) ? doc.games : Object.values(doc?.games || {});
  if (pick.canonicalKey) {
    const canonical = games.find(g => g.canonicalKey === pick.canonicalKey);
    if (canonical) return canonical;
  }
  // Foreign ids are attributes, never storage keys. This compatibility lookup supports
  // browser and MCP submissions that know only ESPN's id while the canonical key is filled.
  const foreignId = String(pick.espnEventId || pick.eventId || "");
  if (foreignId) {
    const attributed = games.find(g => String(g.espnEventId || "") === foreignId);
    if (attributed) return attributed;
  }
  const parts = String(pick.game || "").split(/\s+(?:@|vs\.?)\s+/i);
  const startsAt = pick.startsAt || pick.commenceTime;
  if (parts.length !== 2 || isNaN(Date.parse(startsAt || ""))) return null;
  const wanted = bozoCanonicalScheduleKey(pick.sport, parts[0], parts[1], startsAt);
  return games.find(g => g.canonicalKey === wanted) || null;
}

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
      season, week, player: x.who || playerName(n),
      sport: x.sport, eventId: x.eventId, game: x.game,
      mkt: x.mkt, side: x.side, dir: x.dir,
      priceSource: x.priceSource || "self",     // see the note in bozoPick
      line: x.line == null ? null : x.line,     // numeric, and separate from the label,
      label: x.label,                           // or the Bozo Index can't be computed
      prop: x.prop || null,
      price: x.price,
      // ⚠️ The opposite side of the entry, and the book both ends came from. Without
      // priceOpp there is no de-vig, so the CLV chart's y-axis baseline is wrong by the
      // hold. A null here is a flagged gap, never a silent raw-implied substitution.
      priceOpp: x.entryPriceOpp ?? null,
      entryBook: x.entryBook || null,
      selectionKey: x.selectionKey || null,
      startsAt: x.startsAt || null,             // what schedules the close capture
      dkSgpEligible: x.dkSgpEligible || null,   // "asserted" — see bozoPick
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
function ledgerGradeUpdate(season, week, results, bozo, picks, have) {
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

    /* ⚠️ A CAPTURED CLOSE IS IMMUTABLE AND OUTRANKS ANYTHING TYPED IN LATER. The cron
       snapped it at kickoff off a licensed feed and stamped a server clock; a manager
       grading on Monday is recalling a number, at best. Once closeObservedAt exists the
       grade stage does not touch the close columns — so re-grading a week to fix a
       result can never silently rewrite its prices.

       ⚠️ BUT "UNAVAILABLE" IS NOT "CAPTURED", and conflating the two locked out the one
       case that most needs a human: the cron couldn't match the market, so the leg has a
       reason and no price, and a manager reading it off the placed ticket is the ONLY
       way it will ever have one. A row with a reason and no observation is fillable.
       Filling it clears the reason, because the reason described a gap that no longer
       exists — and closeSource keeps the two provenances apart forever. */
    const row = (have || {})[k] || {};
    const capturedAlready = row.closeObservedAt != null;

    if (!capturedAlready) {
      if (r.close !== undefined) {
        upd[`${k}/close`] = r.close ?? null;
        // ⚠️ Record WHERE a close came from. Hand-entered and cron-captured closes must
        // never end up silently mixed in the same column.
        upd[`${k}/closeSource`] = r.close == null ? null : (r.closeSource || "manual");
        // A hand-entered close is still DraftKings' number — it is read off the placed
        // ticket — so the book is the same. What differs is who observed it, and that is
        // what closeSource carries.
        if (r.close != null) {
          upd[`${k}/closeBook`] = r.closeBook || "draftkings";
          // The gap is filled, so the note describing the gap goes.
          upd[`${k}/closeUnavailableReason`] = null;
        }
      }
      // ⚠️ The opposite side travels with the close or the close is useless. Without it
      // there is no de-vig, and the chart drops the leg exactly as if nothing had been
      // entered — which looks like the manual fill silently failed.
      if (r.closeOpp !== undefined) upd[`${k}/closeOpp`] = r.closeOpp ?? null;
      if (r.closeBook !== undefined) upd[`${k}/closeBook`] = r.closeBook ?? null;
      if (r.closeObservedAt !== undefined) upd[`${k}/closeObservedAt`] = r.closeObservedAt ?? null;
      if (r.closeUnavailableReason !== undefined)
        upd[`${k}/closeUnavailableReason`] = r.closeUnavailableReason ?? null;
    }
    if (bozoKey !== undefined) upd[`${k}/bozo`] = p === bozoKey;
  }
  return upd;
}

/* ========================= Bozo closing-price capture ======================
   The x-axis of the CLV chart. Without this there is nothing to compare an entry price
   to, and `dd_bozo_week` is right to say the site cannot compute anyone's CLV.

   ⚠️ WHERE THE PRICE ACTUALLY COMES FROM, said plainly. The league rule is that every
   leg is a real DraftKings selection, and the handoff says to capture from DraftKings at
   both ends. DRAFTKINGS HAS NO PUBLIC ODDS API — no developer portal, no key programme —
   which bozo.html has said in a comment for months. The only compliant route to a DK
   number is a licensed aggregator, and this Worker already has one wired up with a key:
   SportsGameOdds, whose payloads carry `byBookmaker.draftkings`.

   So: the price IS DraftKings' price, and `closeBook` is honestly "draftkings". But it
   reached us through a reseller, and that is recorded separately in `closeSource:
   "sgo"`. Those are two different facts and they get two different fields. Anything
   that quotes a close should be able to say which book set it AND how we came to have
   it, without having to guess.

   ⚠️ WHAT THIS CANNOT DO, so nobody discovers it as a surprise:
     · Nothing here joins on an id, because there is no shared id to join on. Picks carry
       ESPN event ids (the page reads ESPN's scoreboard) and the aggregator has its own,
       so events are matched on sport + kickoff + team name, and props on stat + player +
       number parsed out of the free text a player typed. Every one of those joins can
       miss. A miss writes a null WITH THE REASON IT MISSED — never a guess, and never
       the entry price.
     · A prop IS always priced: every Bozo leg goes on a real DraftKings bet slip, so the
       market exists and closes. What can fail is the text-to-market resolution, and
       bozoDkPropQuote reports which of stat / player / number it could not line up so
       the fix is obvious rather than a shrug.
     · `other` legs are the real hole. They describe an arbitrary game market in free
       text with no player, no stat and no number to join on, so they stay null.
     · DK's real SGP price for a correlated ticket is not obtainable at all. See
       ticketPricing() — the displayed parlay price is labelled indicative instead.

   Rows are immutable: a close is written once, and every write below is guarded on the
   field being absent. Nulls stay null and are NEVER back-filled from the entry price —
   an entry price copied into the close column is a fabricated zero-movement reading,
   which is worse than a visible gap because it silently drags every average toward zero.
   ========================================================================== */

const BOZO_CLOSE_CRON = "*/5 * * * *";
const BOZO_CLOSE_API = "https://api.sportsgameodds.com/v2/events";
// Fire when kickoff is inside this window ahead of now. One cron tick wide, plus slack,
// so a game cannot slip between two runs.
const BOZO_CLOSE_LEAD_MS = 7 * 60 * 1000;
// How far back we will still accept a capture. Past this the number is not a close any
// more, it is an in-play price, and writing it into the close column would be a lie.
const BOZO_CLOSE_STALE_MS = 20 * 60 * 1000;
const BOZO_SGO_LEAGUE = { nfl: "NFL", cfb: "NCAAF", nba: "NBA", cbb: "NCAAB", mlb: "MLB", nhl: "NHL" };
const BOZO_CLOSE_BOOK = "draftkings";

// Team names arrive spelled differently at each end. Strip everything that is not a
// letter or digit and compare on that — "St. Louis" / "St Louis" / "ST-LOUIS" collapse.
const bzNorm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Week 1 floor: SGO returned only `names.long` for North Texas and Indiana, while the
// filed leg stores UNT and IU. Keep these aliases even with the ESPN registry: they are
// the guaranteed path for the Saturday 2026-09-05 close if KV is unavailable.
const BOZO_TEAM_FALLBACK_ALIASES = Object.freeze({
  unt: "northtexas",
  iu: "indiana",
  ind: "indiana",
});
const BOZO_TEAM_REGISTRY_VERSION = 1;
const BOZO_TEAM_REGISTRY_TTL = 7 * 24 * 60 * 60;

function bozoBuildTeamRegistry(sport) {
  const rows = ((BOZO_ESPN_TEAM_SEED.sports || {})[sport] || []);
  const aliases = Object.create(null);
  const ambiguous = new Set();
  const add = (value, canonical) => {
    const alias = bzNorm(value);
    if (!alias || ambiguous.has(alias)) return;
    if (aliases[alias] && aliases[alias] !== canonical) {
      delete aliases[alias];
      ambiguous.add(alias);
      return;
    }
    aliases[alias] = canonical;
  };

  for (const team of rows) {
    const canonical = bzNorm(team.displayName || team.shortDisplayName || team.location);
    if (!canonical) continue;
    // SGO's `long` is usually ESPN's shortDisplayName/location for college teams and
    // ESPN's displayName for NFL teams. Index all observed stable vocabularies; mascot
    // name alone is deliberately excluded because dozens of teams share it.
    for (const value of [team.abbreviation, team.displayName, team.shortDisplayName, team.location]) {
      add(value, canonical);
    }
  }
  return {
    schemaVersion: BOZO_TEAM_REGISTRY_VERSION,
    sourceAsOf: BOZO_ESPN_TEAM_SEED.asOf,
    sport,
    teamCount: rows.length,
    aliases,
  };
}

async function bozoTeamRegistry(env, sport) {
  const built = bozoBuildTeamRegistry(sport);
  const kv = env && env.RL;
  if (!kv || !built.teamCount) return built.aliases;
  const key = `bozo:team-registry:v${BOZO_TEAM_REGISTRY_VERSION}:${built.sourceAsOf}:${sport}`;
  try {
    const cached = await kv.get(key, "json");
    if (cached && cached.schemaVersion === BOZO_TEAM_REGISTRY_VERSION &&
        cached.sourceAsOf === built.sourceAsOf && cached.sport === sport && cached.aliases) {
      return cached.aliases;
    }
  } catch { /* the embedded ESPN snapshot remains usable */ }
  try { await kv.put(key, JSON.stringify(built), { expirationTtl: BOZO_TEAM_REGISTRY_TTL }); }
  catch { /* matching must not depend on cache availability */ }
  return built.aliases;
}

const bozoTeamNorm = (s, registry) => {
  const key = bzNorm(s);
  if (registry && typeof registry[key] === "string") return registry[key];
  if (!Object.prototype.hasOwnProperty.call(BOZO_TEAM_FALLBACK_ALIASES, key)) return key;
  const fallback = BOZO_TEAM_FALLBACK_ALIASES[key];
  return registry && typeof registry[fallback] === "string" ? registry[fallback] : fallback;
};

// The two sides of each game-level market.
const BOZO_ODD_IDS = {
  ml:     ["points-home-game-ml-home", "points-away-game-ml-away"],
  spread: ["points-home-game-sp-home", "points-away-game-sp-away"],
  total:  ["points-all-game-ou-over",  "points-all-game-ou-under"],
};

/* ---------------- player props ----------------
   ⚠️ A PROP IS ALWAYS PRICED. Every Bozo leg goes on a real DraftKings bet slip, so by
   construction DraftKings has a market for it and quotes both sides at kickoff. The
   difficulty was never whether the price exists — it was resolving the free text a
   player typed ("Kelce receiving yards") onto the odds source's market identifier.
   That is a MATCHING problem, and it gets a real attempt rather than an assumed null.

   The aggregator keys props as {statID}-{playerEntityID}-{period}-{betType}-{side}, so a
   match needs three things to line up: the stat, the player, and the number. All three
   come out of what is already on the leg — the prop text carries the first two and
   `line` is the third.

   ⚠️ When it still fails, the reason says WHICH of the three failed. "Couldn't resolve
   the stat" and "DraftKings pulled the market" are different problems with different
   fixes, and a blanket "no close" hides both. */
const BOZO_STAT_WORDS = [
  // NFL / CFB
  [/pass(ing)?\s*(yds|yards)/i,            ["passing_yards"]],
  [/pass(ing)?\s*(td|touchdown)/i,         ["passing_touchdowns"]],
  [/completion/i,                          ["passing_completions"]],
  [/interception|\bint\b/i,                ["passing_interceptions"]],
  [/rush(ing)?\s*(yds|yards)/i,            ["rushing_yards"]],
  [/rush(ing)?\s*(td|touchdown)/i,         ["rushing_touchdowns"]],
  [/receiv(ing)?\s*(yds|yards)/i,          ["receiving_yards"]],
  [/reception|\brec\b(?!eiving)/i,         ["receptions"]],
  [/receiv(ing)?\s*(td|touchdown)/i,       ["receiving_touchdowns"]],
  [/anytime\s*(td|touchdown)|scores?\s*a\s*(td|touchdown)/i, ["touchdowns"]],
  // NBA / CBB
  [/\bpoints?\b|\bpts\b/i,                 ["points"]],
  [/rebound|\breb\b/i,                     ["rebounds"]],
  [/assist|\bast\b/i,                      ["assists"]],
  [/three|\b3pt|3-point/i,                 ["threePointersMade"]],
  [/\bsteal/i,                             ["steals"]],
  [/\bblock/i,                             ["blocks"]],
  // MLB
  [/strikeout|\bks?\b|punchout/i,          ["strikeouts"]],
  [/\bhits?\b/i,                           ["hits"]],
  [/total\s*bases/i,                       ["totalBases"]],
  [/home\s*run|\bhr\b/i,                   ["homeRuns"]],
  [/\brbi/i,                               ["RBIs"]],
  // NHL
  [/shots?\s*on\s*goal|\bsog\b/i,          ["shotsOnGoal"]],
  [/\bgoals?\b/i,                          ["goals"]],
  [/\bsaves?\b/i,                          ["saves"]],
  [/\bassists?\b/i,                        ["assists"]],
  [/\bpoints?\b/i,                         ["points"]],
];

// Words that are never part of a player's name, so they can be stripped before what is
// left is treated as one.
const BOZO_PROP_NOISE = /\b(over|under|o|u|the|a|an|to|record|total|\d+\+?|yards?|yds|pts|points?|rebounds?|reb|assists?|ast|receptions?|rec|receiving|rushing|passing|touchdowns?|tds?|strikeouts?|hits?|bases|home|runs?|rbi|shots?|on|goal|sog|goals?|saves?|steals?|blocks?|three|3pt|pointers?|made|anytime|scores?|completions?|interceptions?|ints?|first|longest|alt)\b/gi;

function bozoPropStats(text) {
  const out = [];
  for (const [re, ids] of BOZO_STAT_WORDS) if (re.test(text)) out.push(...ids);
  return [...new Set(out)];
}
// Whatever is left once the stat vocabulary is removed is the player's name.
function bozoPropNameTokens(text) {
  return String(text || "").replace(BOZO_PROP_NOISE, " ")
    .split(/[^A-Za-z'.-]+/).map(bzNorm).filter(t => t.length >= 3);
}

const bzAmerican = v => {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null;
};

// One DraftKings outcome can have a main number plus dozens of alternate numbers. Pick
// the exact market instance the member selected; requesting alt lines and then silently
// reading the main line would price a different bet.
function bozoDkOutcome(odd, field, wanted) {
  const book = (((odd || {}).byBookmaker || {})[BOZO_CLOSE_BOOK]);
  if (!book) return null;
  const rows = [book, ...((book.altLines || []))];
  return rows.find(row => {
    if (!row || row.available === false || bzAmerican(row.odds) === null) return false;
    return field === null || (Number.isFinite(Number(row[field])) && Math.abs(Number(row[field]) - wanted) < 0.001);
  }) || null;
}

// Pull DraftKings' two sides for one market off an aggregator event.
// Returns { price, opp, line, snapshotAt } in the orientation of the leg, or a reason.
function bozoDkQuote(event, pick, registry) {
  if (pick.mkt === "prop") return bozoDkPropQuote(event, pick);
  const ids = BOZO_ODD_IDS[pick.mkt];
  if (!ids) return { reason: "market-not-matchable" };
  const odds = (event && event.odds) || {};
  const a = odds[ids[0]], b = odds[ids[1]];
  if (!a || !b) return { reason: "market-absent-at-source" };

  // Orient to the side the player actually took. For a total that is over/under; for a
  // moneyline or spread it is home/away, and the pick stores a team abbreviation.
  let mineOdd, theirOdd;
  if (pick.mkt === "total") {
    const over = (pick.dir || pick.side) !== "under";
    mineOdd = over ? a : b; theirOdd = over ? b : a;
  } else {
    const homeNames = (((event.teams || {}).home || {}).names || {});
    const awayNames = (((event.teams || {}).away || {}).names || {});
    const home = [homeNames.short, homeNames.medium, homeNames.long]
      .map(name => bozoTeamNorm(name, registry)).filter(Boolean);
    const away = [awayNames.short, awayNames.medium, awayNames.long]
      .map(name => bozoTeamNorm(name, registry)).filter(Boolean);
    const side = bozoTeamNorm(pick.side, registry);
    if (side && home.includes(side))      { mineOdd = a; theirOdd = b; }
    else if (side && away.includes(side)) { mineOdd = b; theirOdd = a; }
    else return { reason: "could not tell which side of the market the leg was on" };
  }

  const field = pick.mkt === "spread" ? "spread" : pick.mkt === "total" ? "overUnder" : null;
  const storedLine = Number(pick.line);
  if (field && !Number.isFinite(storedLine)) return { reason: "the leg has no number to price" };
  // Bozo stores the handicap as points this side GIVES UP: +39.5 renders Indiana -39.5.
  // SGO stores the sportsbook display number, so spreads cross this boundary inverted.
  const wanted = pick.mkt === "spread" ? -storedLine : storedLine;
  const mine = bozoDkOutcome(mineOdd, field, wanted);
  const opposingNumber = pick.mkt === "spread" ? -wanted : wanted;
  const theirs = bozoDkOutcome(theirOdd, field, opposingNumber);
  if (!mine || !theirs)
    return { reason: `DraftKings had no two-sided ${pick.mkt} market at ${wanted}` };
  const minePrice = bzAmerican(mine.odds), theirPrice = bzAmerican(theirs.odds);

  // ⚠️ Both sides or nothing. Without the opposite side there is no de-vig, and the
  // chart's expected-win baseline is off by the entire hold.
  if (minePrice === null || theirPrice === null) return { reason: "only one side of the market was priced" };
  const observed = [mine.lastUpdatedAt, theirs.lastUpdatedAt].filter(x => !isNaN(Date.parse(x || ""))).sort();
  return { price: minePrice, opp: theirPrice, line: pick.mkt === "ml" ? 0 : storedLine,
           bookLine: pick.mkt === "ml" ? 0 : wanted,
           snapshotAt: observed.length ? observed[observed.length - 1] : null };
}

/* Resolve one free-text prop against every market the aggregator has on that event.
   Returns the DraftKings price for the side the player took, plus the other side.

   ⚠️ The number is part of the identity, not a detail. "Kelce over 62.5" and "Kelce over
   74.5" are two different DraftKings markets that close at different prices, so a match
   that ignores the line would be confidently wrong rather than absent. Alt lines are
   requested for exactly this reason: Bozo's favourites-only band pushes players onto
   bought-down numbers constantly, and the main line is often not the one they took. */
function bozoDkPropQuote(event, pick) {
  const odds = (event && event.odds) || {};
  const wantStats = bozoPropStats(pick.prop || "");
  const wantName = bozoPropNameTokens(pick.prop || "");
  const wantLine = Number(pick.line);
  const over = (pick.dir || pick.side) !== "under";

  if (!wantStats.length)
    return { reason: 'couldn\'t work out which stat "' + String(pick.prop || "").slice(0, 40) + '" refers to' };
  if (!wantName.length)
    return { reason: 'couldn\'t work out which player "' + String(pick.prop || "").slice(0, 40) + '" refers to' };
  if (!Number.isFinite(wantLine)) return { reason: "the leg has no number to match a prop market on" };

  let sawStat = false, sawPlayer = false, sawLine = false, best = null;
  for (const [oddID, o] of Object.entries(odds)) {
    // {statID}-{playerEntityID}-{period}-{betType}-{side}
    const parts = String(oddID).split("-");
    if (parts.length < 5) continue;
    const side = parts[parts.length - 1];
    const betType = parts[parts.length - 2];
    if (betType !== "ou") continue;                       // props are over/under markets
    const statID = parts[0], entity = parts.slice(1, parts.length - 3).join("-");
    if (!wantStats.includes(statID)) continue;
    sawStat = true;

    const ent = bzNorm(entity);
    if (!wantName.some(t => ent.includes(t))) continue;
    sawPlayer = true;

    // The line the book is offering on this particular market instance.
    const ln = Number(o.bookOverUnder ?? o.overUnder ?? o.fairOverUnder);
    if (!Number.isFinite(ln) || Math.abs(ln - wantLine) > 0.001) continue;
    sawLine = true;

    if (side !== (over ? "over" : "under")) continue;
    const opp = odds[parts.slice(0, -1).join("-") + "-" + (over ? "under" : "over")];
    if (!opp) continue;
    const mine = (o.byBookmaker || {})[BOZO_CLOSE_BOOK];
    const theirs = (opp.byBookmaker || {})[BOZO_CLOSE_BOOK];
    if (!mine || !theirs) continue;
    if (mine.available === false || theirs.available === false) continue;
    const a = bzAmerican(mine.odds), b = bzAmerican(theirs.odds);
    if (a === null || b === null) continue;
    const observed = [mine.lastUpdatedAt, theirs.lastUpdatedAt].filter(x => !isNaN(Date.parse(x || ""))).sort();
    best = { price: a, opp: b, line: wantLine,
             snapshotAt: observed.length ? observed[observed.length - 1] : null };
    break;
  }
  if (best) return best;

  // ⚠️ Say which of the three joins failed. "The stat resolved but the player didn't"
  // and "DraftKings pulled the market" need different fixes, and one shared message
  // would hide both behind whichever someone guessed at first.
  if (!sawStat)   return { reason: "the odds source had no " + wantStats[0].replace(/_/g, " ") + " market on this game" };
  if (!sawPlayer) return { reason: 'no market for "' + wantName.join(" ") + '" on this game — check the spelling against the bet slip' };
  if (!sawLine)   return { reason: "DraftKings had that player and stat but not the number " + wantLine + " at kickoff" };
  return { reason: "DraftKings wasn't pricing that selection at kickoff" };
}

// Every leg across every league that is still waiting on a close and whose game is
// about to start. One RTDB read; on a quiet tick this returns nothing and we stop.
async function bozoCloseTargets(env, nowMs) {
  let leagues;
  try { leagues = await loadLeagues(env); } catch { return []; }
  // Legacy seats and in-flight picks can still be name-keyed. Resolve their immutable
  // account id now, while the users table is available, so a kickoff-stage ledger row is
  // a complete receipt even when the lock-stage row was never written.
  const uidByName = new Map();
  try {
    const users = await loadUsers(env);
    for (const [key, rec] of Object.entries(users || {})) {
      const uid = playerName(key);
      if (UID_RE.test(uid)) uidByName.set(accountName(uid, rec), uid);
    }
  } catch { /* player remains useful evidence even if identity lookup is unavailable */ }
  const out = [];
  for (const [lid, lg] of Object.entries(leagues || {})) {
    // ⚠️ Synthetic leagues are skipped outright. Their closes are fabricated by design
    // and must never be overwritten with, or mistaken for, an observed market price.
    if (lg && lg.synthetic === true) continue;
    const picks = (lg && lg.picks) || {};
    const results = (lg && lg.results) || {};
    for (const [key, p] of Object.entries(picks)) {
      if (!p || !p.eventId) continue;
      const r = results[key] || {};
      if (r.close != null || r.closeUnavailableReason) continue;   // immutable once written
      const start = Date.parse(p.startsAt || "");
      if (!Number.isFinite(start)) continue;                       // no kickoff, no window
      if (start > nowMs + BOZO_CLOSE_LEAD_MS) continue;            // too early
      if (start < nowMs - BOZO_CLOSE_STALE_MS) continue;           // too late to be a close
      const player = p.who || memberNameAt(lg, key) || playerName(key);
      const uid = UID_RE.test(key) ? key : (uidByName.get(player) || null);
      out.push({ lid, key, pick: p, player, uid, startMs: start,
                 season: lg.season || SEASON, week: lg.week || 1 });
    }
  }
  return out;
}

async function bozoFetchEvents(env, sport, startMs, needProps) {
  if (!env.SGO_KEY) throw new Error("Worker misconfigured: SGO_KEY secret not set");
  const leagueID = BOZO_SGO_LEAGUE[sport];
  if (!leagueID) return [];
  const url = new URL(BOZO_CLOSE_API);
  url.searchParams.set("leagueID", leagueID);
  // A generous window around the kickoff — the join is on teams, not on this.
  url.searchParams.set("startsAfter", new Date(startMs - 6 * 3600 * 1000).toISOString());
  url.searchParams.set("startsBefore", new Date(startMs + 6 * 3600 * 1000).toISOString());
  // ⚠️ The oddID filter is dropped when any leg in this bucket is a prop. A prop's market
  // id contains the player's entity id, which we don't know until we've seen the event's
  // markets — so filtering by id first would rule out the very rows we need to search.
  // Game-only buckets keep the narrow filter, because most ticks are game-only and
  // pulling every prop on a full NFL Sunday for no reason is wasteful.
  if (!needProps) url.searchParams.set("oddID", [...new Set(Object.values(BOZO_ODD_IDS).flat())].join(","));
  url.searchParams.set("includeOpposingOdds", "true");
  // ⚠️ Alt lines are NOT optional here. Bozo's favourites-only band pushes players onto
  // bought-down numbers constantly, so the number they took is frequently not the main
  // line — and a close snapped off the main line would be a different market's price.
  url.searchParams.set("includeAltLines", "true");
  url.searchParams.set("limit", needProps ? "25" : "100");
  const res = await fetch(url, { headers: { "x-api-key": env.SGO_KEY } });
  if (!res.ok) throw new Error("SGO " + res.status);
  const body = await res.json();
  return (body && body.data) || [];
}

// Join an ESPN-sourced pick to an aggregator event. The pick's `game` is "AWAY VS HOME"
// as the page rendered it, so both abbreviations are available even though the ids are not.
function bozoMatchEvent(events, pick, registry) {
  const parts = String(pick.game || "").split(/\s+(?:@|vs\.?)\s+/i);
  const want = parts.map(part => bozoTeamNorm(part, registry)).filter(Boolean);
  if (want.length < 2) return null;
  const wantedStart = Date.parse(pick.startsAt || "");
  const matches = [];
  for (const ev of events) {
    const t = ev.teams || {};
    const names = [t.home, t.away].map(x => {
      const n = (x && x.names) || {};
      return [n.short, n.medium, n.long].map(name => bozoTeamNorm(name, registry)).filter(Boolean);
    });
    const hit = want.every(w => names.some(list => list.includes(w)));
    if (hit) matches.push(ev);
  }
  if (!matches.length) return null;
  if (!Number.isFinite(wantedStart)) return matches[0];
  matches.sort((a, b) => Math.abs(Date.parse(a.status?.startsAt || "") - wantedStart) -
                         Math.abs(Date.parse(b.status?.startsAt || "") - wantedStart));
  const nearest = matches[0], delta = Math.abs(Date.parse(nearest.status?.startsAt || "") - wantedStart);
  return Number.isFinite(delta) && delta <= 6 * 3600 * 1000 ? nearest : null;
}

const bozoRawImplied = price => price < 0 ? -price / (-price + 100) : 100 / (price + 100);

function bozoDevigPair(price, opp) {
  const a = bzAmerican(price), b = bzAmerican(opp);
  if (a === null || b === null) return null;
  const pa = bozoRawImplied(a), pb = bozoRawImplied(b), sum = pa + pb;
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return { fair: pa / sum, hold: sum - 1 };
}

function assertQuote(quote, pick) {
  if (!quote || quote.reason) return (quote && quote.reason) || "no quote returned";
  if (bzAmerican(quote.price) === null || bzAmerican(quote.opp) === null)
    return "the quote did not contain two real American prices";
  if (pick.mkt !== "ml" && (!Number.isFinite(Number(quote.line)) ||
      Math.abs(Number(quote.line) - Number(pick.line)) > 0.001))
    return "the quote was for a different number";
  return bozoDevigPair(quote.price, quote.opp) ? null : "the two-sided quote could not be de-vigged";
}

function bozoCanonicalKey(sport, event, registry) {
  const teams = [event?.teams?.away, event?.teams?.home].map(team => {
    const n = (team && team.names) || {};
    return bozoTeamNorm(n.long || n.medium || n.short, registry);
  }).filter(Boolean).sort();
  const startsAt = event?.status?.startsAt;
  return teams.length === 2 && !isNaN(Date.parse(startsAt || ""))
    ? [sport, teams.join("~"), startsAt.slice(0, 10)].join("|") : null;
}

function bozoSelfPricedEntry(p, reason) {
  const typed = bzAmerican(p.typedPrice ?? p.price);
  if (typed === null) return { ok: false, error: reason + " A real American price is required for the self-priced fallback." };
  return { ok: true, p: { ...p, price: typed, priceOpp: null, priceSource: "self",
    entryBook: BOZO_CLOSE_BOOK, entryProvider: null, entrySnapshotAt: null,
    fairEntry: null, entryHold: null, clvEligible: false,
    closeState: p.mkt === "other" ? "unmatched" : "pending" },
    captureWarning: reason };
}

// Resolve and freeze the submit-time quote. This function never writes RTDB. Callers may
// stage its returned object in short-lived KV, but phase two must commit this exact object
// without fetching SGO again.
async function bozoCaptureEntry(env, input) {
  const p = { ...input };
  if (!BOZO_GRADEABLE_SPORTS.has(p.sport)) return { ok: false, reason: "sport_not_gradeable",
    error: `${p.sport || "That sport"} cannot be submitted until it has a Worker-reachable grading adapter.` };
  let startMs = Date.parse(p.startsAt || "");
  if (!Number.isFinite(startMs) && p.eventId) {
    let doc = null;
    try { doc = await bozoScheduleDoc(env, p.sport, SEASON); } catch { doc = null; }
    const game = bozoScheduleFindGame(doc, p);
    if (game && !isNaN(Date.parse(game.startsAt || ""))) {
      p.startsAt = game.startsAt;
      p.espnEventId = String(game.espnEventId || p.eventId);
      p.canonicalKey = game.canonicalKey || null;
      startMs = Date.parse(p.startsAt);
    }
  }
  if (!Number.isFinite(startMs)) return { ok: false, reason: "starts_at_unresolved",
    error: "Kickoff time (startsAt) could not be resolved from the schedule cache." };
  if (p.mkt === "other") return bozoSelfPricedEntry(p, "Other markets are always self-priced and not CLV-eligible.");

  let events, registry;
  try {
    [events, registry] = await Promise.all([
      bozoFetchEvents(env, p.sport, startMs, p.mkt === "prop"),
      bozoTeamRegistry(env, p.sport),
    ]);
  } catch (e) {
    if (p.mkt === "prop") return bozoSelfPricedEntry(p, "DraftKings capture failed: " + e.message + ".");
    return { ok: false, error: "DraftKings capture failed: " + e.message + ". Nothing was submitted." };
  }
  const event = bozoMatchEvent(events, p, registry);
  if (!event) {
    if (p.mkt === "prop") return bozoSelfPricedEntry(p, "The game could not be matched at the odds source.");
    return { ok: false, error: "The game could not be matched at the odds source. Nothing was submitted." };
  }
  const quote = bozoDkQuote(event, p, registry);
  const quoteError = assertQuote(quote, p);
  if (quoteError) {
    if (p.mkt === "prop") return bozoSelfPricedEntry(p, "DraftKings capture failed: " + quoteError + ".");
    return { ok: false, error: "DraftKings capture failed: " + quoteError + ". Nothing was submitted." };
  }
  const facts = bozoDevigPair(quote.price, quote.opp);
  const commenceTime = event.status?.startsAt || p.startsAt;
  const typed = bzAmerican(p.typedPrice ?? p.price);
  const agreement = typed === null ? null : {
    typedPrice: typed,
    capturedPrice: quote.price,
    probabilityPointDifference: Math.abs(bozoRawImplied(typed) - bozoRawImplied(quote.price)) * 100,
  };
  if (agreement) agreement.needsConfirmation = agreement.probabilityPointDifference > 1.5;
  return { ok: true, p: { ...p,
    line: quote.line, price: quote.price, priceOpp: quote.opp,
    priceSource: "captured", entryBook: BOZO_CLOSE_BOOK, entryProvider: "sgo",
    entrySnapshotAt: quote.snapshotAt || new Date().toISOString(),
    fairEntry: facts.fair, entryHold: facts.hold, clvEligible: true,
    canonicalKey: bozoCanonicalKey(p.sport, event, registry), commenceTime,
    startsAt: commenceTime, espnEventId: String(p.eventId),
    providerEventIds: { sgo: String(event.eventID) }, closeState: "pending",
  }, agreement };
}

/* Build one close mutation without touching shared state. A target is writeable only
 * while it still carries the pick and both identity fields. That makes a stale target
 * (pick removed after discovery) and an unresolved legacy UID retryable no-ops instead
 * of allowing either to manufacture a close-only ledger row. */
function bozoCloseMutation(t, quote, reason, observedAt) {
  if (!t || !t.pick || !t.key || !t.player || !t.uid) return null;
  const patch = {};
  const base = `results/${t.key}`;
  const lrow = `ledger/${ledgerKey(t.season, t.week, t.key)}`;
  patch[`${lrow}/player`] = t.player;
  patch[`${lrow}/uid`] = t.uid;
  const both = (field, val) => { patch[`${base}/${field}`] = val; patch[`${lrow}/${field}`] = val; };
  if (quote) {
    both("close", quote.price);
    both("closeOpp", quote.opp);
    both("closeBook", BOZO_CLOSE_BOOK);
    both("closeSource", "sgo");
    both("closeObservedAt", observedAt);
    both("closeUnavailableReason", null);
  } else {
    both("close", null);
    both("closeOpp", null);
    both("closeBook", null);
    both("closeObservedAt", null);
    both("closeUnavailableReason", reason);
    both("closeSource", "sgo");
  }
  return patch;
}

/* The cron body. Writes at most one close per leg, ever. */
async function runBozoCloseCapture(env, nowMs) {
  const targets = await bozoCloseTargets(env, nowMs);
  if (!targets.length) return { captured: 0, skipped: 0, checked: 0 };

  // One fetch per (sport, hour-bucket) rather than one per leg.
  const byBucket = new Map();
  for (const t of targets) {
    const k = t.pick.sport + "|" + Math.floor(t.startMs / (3600 * 1000));
    if (!byBucket.has(k)) byBucket.set(k, { sport: t.pick.sport, startMs: t.startMs, legs: [] });
    byBucket.get(k).legs.push(t);
  }

  const observedAt = new Date(nowMs).toISOString();
  let captured = 0, skipped = 0;
  const patches = new Map();                                  // lid -> deep-path patch
  const add = (lid, path, val) => {
    if (!patches.has(lid)) patches.set(lid, {});
    patches.get(lid)[path] = val;
  };

  for (const bucket of byBucket.values()) {
    let events = [];
    let fetchErr = null;
    const needProps = bucket.legs.some(t => t.pick.mkt === "prop");
    try { events = await bozoFetchEvents(env, bucket.sport, bucket.startMs, needProps); }
    catch (e) { fetchErr = String((e && e.message) || e); }
    const registry = await bozoTeamRegistry(env, bucket.sport);

    for (const t of bucket.legs) {
      if (fetchErr) { skipped++; continue; }                  // no reason written — retry next tick

      let reason = null, quote = null;
      // ⚠️ `other` is the one market type with no principled way in. It is free text
      // describing an arbitrary game market ("favourite to lead at halftime", "no
      // overtime"), with no player, no stat and no number to join on — unlike a prop,
      // which has all three. It stays a null with a reason.
      if (t.pick.mkt === "other") {
        reason = "No closing price captured: an “other” leg describes an arbitrary game market in free text, "
               + "with no stat, player or number to match on at the odds source.";
      } else {
        const ev = bozoMatchEvent(events, t.pick, registry);
        if (!ev) reason = "No closing price captured: this game couldn't be matched at the odds source.";
        else {
          const q = bozoDkQuote(ev, t.pick, registry);
          if (q.reason) reason = "No closing price captured: " + q.reason + ".";
          else quote = q;
        }
      }

      // ⚠️ Written in TWO places, on purpose. `results/<key>` is this week's live board
      // and gets cleared by bozoNext; the ledger row is the permanent receipt. Refuse
      // an incomplete/stale target before adding EITHER path to the shared patch.
      const mutation = bozoCloseMutation(t, quote, reason, observedAt);
      if (!mutation) { skipped++; continue; }
      for (const [path, value] of Object.entries(mutation)) add(t.lid, path, value);
      if (quote) captured++; else skipped++;
    }
  }

  for (const [lid, patch] of patches.entries()) {
    if (!Object.keys(patch).length) continue;
    try { await fbPatch(env, LG(lid), patch); }
    catch (e) { console.log("bozo close: write failed for " + lid + " — " + e.message); }
  }

  const kv = cfbMarketKV(env);
  if (kv) {
    try {
      await kv.put("bozo:close:last-run", JSON.stringify({
        at: observedAt, checked: targets.length, captured, skipped,
        book: BOZO_CLOSE_BOOK, via: "sportsgameodds",
      }));
    } catch { /* the capture already landed; the summary is a convenience */ }
  }
  return { captured, skipped, checked: targets.length };
}

/* GET /bozo/clv?league=<id> — the read model behind the CLV chart. Public, because the
   board is public and this is the same rows in a different shape.

   ⚠️ RAW INPUTS ONLY, in the ledger's own tradition. No CLV is computed here, no
   de-vigged probability, no delta, no luck band. Those are pure functions of price,
   opposite price, close and result, and the de-vig METHOD is declared in the payload
   (`devig: "proportional"`) so the page can reproduce them and an old payload stays
   reproducible if the method ever changes. Persisting a derived CLV would freeze
   today's formula into last year's rows — the exact mistake the ledger comment warns
   about for imp/clv/beat. */
async function bozoClv(request, url, env, cors) {
  const lid = validLeagueId(url.searchParams.get("league") || "") ? url.searchParams.get("league") : DEFAULT_LEAGUE;
  let lg;
  try { lg = await loadLeague(env, lid); }
  catch (e) { return json({ error: e.message }, 502, cors); }
  if (!lg) return json({ error: "No such league." }, 404, cors);

  let ledger = {};
  try { ledger = (await fbGet(env, LG(lid) + "/ledger")).data || {}; }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }

  const set = settingsOf(lg);
  // The ledger says "won"/"lost"; the chart contract says "win"/"loss". Translate once,
  // here, rather than teaching the page two vocabularies for one fact.
  const RESULT = { won: "win", lost: "loss", push: "push", void: "push" };
  const labels = lg.weekLabels || {};

  const legs = Object.values(ledger)
    .filter(r => r && r.player)
    .sort((a, b) => (a.week - b.week) || String(a.player).localeCompare(String(b.player)))
    .map(r => ({
      synthetic: lg.synthetic === true,
      league: lid, season: r.season ?? (lg.season || SEASON),
      week: r.week, weekLabel: labels[r.week] || ("Week " + r.week),
      player: r.player, sport: r.sport,
      eventId: r.eventId, game: r.game,
      mkt: r.mkt, side: r.side, line: r.line ?? null, prop: r.prop || null,
      label: r.label, selectionKey: r.selectionKey || null,
      dkSgpEligible: r.dkSgpEligible || null,

      entryPrice: r.price ?? null,
      entryPriceOpp: r.priceOpp ?? null,
      entryBook: r.entryBook || null,
      entrySubmittedAt: r.ts ? new Date(r.ts).toISOString() : null,

      closePrice: r.close ?? null,
      closePriceOpp: r.closeOpp ?? null,
      closeBook: r.closeBook || null,
      closeObservedAt: r.closeObservedAt || null,
      closeSource: r.closeSource || null,
      closeUnavailableReason: r.closeUnavailableReason || null,

      result: RESULT[r.result] || null,
      gradedAt: r.gradedAt || null,

      // ⚠️ Needed by the Royale survival simulation, which BOOTSTRAPS from a player's own
      // past legs rather than inventing a distribution for them. Resampling a whole real
      // leg keeps the correlation between the price someone takes and how badly they
      // tend to miss — a made-up distribution would throw that away and quietly flatter
      // whoever bets the most chalk.
      actual: r.actual ?? null,
      rank: r.rank ?? null,            // 1 = first leg in that week, N = Last In
      shortestOdds: r.shortestOdds === true,
    }));

  const weeks = [...new Set(legs.map(l => l.week))].sort((a, b) => a - b)
    .map(w => ({ week: w, label: labels[w] || ("Week " + w), phase: (lg.weekPhases || {})[w] || "regular" }));

  // Header counts, so the page never has to guess what it is NOT showing.
  const graded = legs.filter(l => l.result === "win" || l.result === "loss");
  const coverage = {
    legs: legs.length,
    charted: graded.filter(l => l.closePrice != null && l.entryPrice != null).length,
    pushes: legs.filter(l => l.result === "push").length,
    ungraded: legs.filter(l => l.result == null).length,
    noClose: legs.filter(l => l.closePrice == null).length,
    noEntryOpp: legs.filter(l => l.entryPriceOpp == null).length,
  };

  return json({
    league: lid, leagueName: lg.name || lid, season: lg.season || SEASON,
    format: set.format, synthetic: lg.synthetic === true,
    devig: "proportional",
    book: BOZO_CLOSE_BOOK,
    closeVia: "sportsgameodds",
    players: memberNames(lg), teams: lg.teams || null,
    week: lg.week || 1,
    weeks, coverage, legs,
    royale: set.format === "royale" ? {
      status: royaleStatus(lg),
      // Normalised on the way out: whether the database hands back an object or an
      // array-with-holes, the page receives one shape and never has to know.
      chops: Object.fromEntries(Object.entries((lg.royale || {}).chops || {})
        .filter(([, c]) => c && c.week).map(([, c]) => [`w${c.week}`, c])),
      survivor: (lg.royale || {}).survivor || null,
      // The cost of coming back. It is charged, not offered — see royaleStatus.
      redeployCost: set.buyback,
    } : null,
    tickets: ticketPricing(lg, ledger),
    note: lg.synthetic === true
      ? "SIMULATED SEASON — every leg, price, close and result in this league is fabricated. It is excluded from receipts, the model scoreboard and every cross-league aggregate."
      : null,
  }, 200, cors);
}

/* ---------------- the parlay price, and why it is labelled ----------------
   dd_price_parlay describes itself as "price arithmetic, not a correlation-aware joint
   outcome model". That is exactly right for eight independent games and WRONG the moment
   two legs share an event: DraftKings reprices correlated SGP legs, and the product of
   the individual prices OVERSTATES the payout, sometimes badly.

   ⚠️ The better fix — pulling DK's real SGP price for the constructed ticket — is not
   available to us. It needs DK's bet-slip pricing endpoint, and DK has no public API.
   Nothing an aggregator sells reprices an arbitrary same-game combination either. So the
   honest option is the only available one: say the number is indicative, and say why. */
function ticketPricing(lg, ledger) {
  const byWeek = new Map();
  for (const r of Object.values(ledger || {})) {
    if (!r || !r.week) continue;
    if (!byWeek.has(r.week)) byWeek.set(r.week, []);
    byWeek.get(r.week).push(r);
  }
  const dec = o => o < 0 ? 1 + 100 / Math.abs(o) : 1 + o / 100;
  const out = [];
  for (const [week, rows] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    const groups = {};
    for (const r of rows) (groups[r.eventId] = groups[r.eventId] || []).push(r);
    const sameGame = Object.entries(groups).filter(([, g]) => g.length > 1)
      .map(([eventId, g]) => ({ eventId, game: g[0].game, sport: g[0].sport,
                                legs: g.length, players: g.map(x => x.player) }));
    const naive = rows.reduce((a, r) => a * dec(r.price), 1);
    const correlated = sameGame.length > 0;
    out.push({
      week, legs: rows.length,
      naiveDecimal: +naive.toFixed(2),
      naiveAmerican: naive >= 2 ? Math.round((naive - 1) * 100) : -Math.round(100 / (naive - 1)),
      priceIsIndicative: correlated,
      priceCaveat: correlated
        ? "Indicative only — legs share a game, so this is a same-game parlay. DraftKings reprices correlated legs, and the product of the individual prices is an upper bound, not the payout."
        : "All legs from distinct games. Product pricing is a fair approximation.",
      sameGameGroups: sameGame,
    });
  }
  return out;
}

/* ================================ Bozo Royale ==============================
   The guillotine ruleset. One chop a week; last one standing takes the pot.

   Everything about a leg is identical to Standard — same submission, same band, same
   prices, same closes, same chart. Royale is a second ruleset laid over the same rows.
   What differs is the consequence: in Standard the worst loser wears the shame and
   funds next week, and plays again. Here they are OUT.

   ⚠️ THAT IS WHY THE CHOP IS COMPUTED HERE AND NOT IN THE PAGE. The standard verdict is
   client-computed and admin-signed on purpose — anyone can recompute it from the public
   order and results and call BS, and being named bozo costs you nothing you can't argue
   about next week. Elimination is not that. It gates who may write a leg for the rest of
   the season, so the thing that decides it lives on the server beside the permutation.
   A manager can still fabricate the RESULTS — they always could — but they cannot
   fabricate who those results eliminate.

   Lever indices are the page's LEVERS array and must stay aligned with it:
     0 Shortest Odds   1 Worst Beat   2 Last In   3 Worst CLV
   ========================================================================== */

const ROYALE_LEVER_NAMES = ["Shortest Odds", "Worst Beat", "Last In", "Worst CLV"];

// Margin-of-victory / total spreads per sport, mirroring the page's SPORTS table. Both
// copies are flagged as needing calibration; they are a shared guess, not a measurement.
const ROYALE_SD = {
  nfl: { sd: 13.5, tot: 10.5 }, cfb: { sd: 16.5, tot: 13.0 },
  nba: { sd: 11.5, tot: 17.0 }, cbb: { sd: 10.5, tot: 13.0 },
  mlb: { sd: 4.4,  tot: 4.2  }, nhl: { sd: 2.3,  tot: 2.1  },
};

const rImp = a => a < 0 ? Math.abs(a) / (Math.abs(a) + 100) : 100 / (a + 100);

// Proportional de-vig against the opposite side of the same two-way market.
// ⚠️ Returns null when the opposite side is missing. It does NOT quietly fall back to
// raw implied: raw implied and de-vigged are different quantities by about the whole
// hold, and ranking one player's de-vigged number against another's raw one is a
// silently wrong comparison. A visible gap beats an invisible error.
function rDevig(price, opp) {
  if (price == null || opp == null) return null;
  const a = rImp(price), b = rImp(opp);
  const t = a + b;
  return t > 0 ? a / t : null;
}

// Acklam's inverse normal — the page's copy, verbatim.
function rInvNorm(p) {
  if (p <= 0) return -6; if (p >= 1) return 6;
  const a = [-39.696830286653757, 220.94609842452050, -275.92851044696869, 138.35775186726900, -30.664798066147160, 2.5066282774592392],
        b = [-54.476098798224058, 161.58583685804089, -155.69897985988661, 66.801311887719720, -13.280681552885721],
        c = [-0.0077848940024302926, -0.32239645804113648, -2.4007582771618381, -2.5497325393437338, 4.3746641414649678, 2.9381639826987831],
        d = [0.0077846957090414622, 0.32246712907003983, 2.4451340770184519, 3.7544086619074162];
  const pl = 0.02425; let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  q = p - .5; r = q * q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5]) * q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

const rDir = x => ((x && (x.dir || x.side)) === "under") ? "under" : "over";
function rSd(x) {
  const s = ROYALE_SD[x.sport] || ROYALE_SD.nfl;
  return x.mkt === "total" ? s.tot
       : (x.mkt === "prop" || x.mkt === "other") ? Math.max(Math.abs(Number(x.line) || 0) * .55, 1)
       : s.sd;
}
function rExpected(x) {
  const sd = rSd(x), p = Math.min(.98, Math.max(.02, rImp(x.price) - .022));
  const shift = sd * rInvNorm(p), base = x.mkt === "ml" ? 0 : (Number(x.line) || 0);
  return rDir(x) === "under" ? base - shift : base + shift;
}

/* ---------------- Worst Beat, including for legs that have no margin ----------------
   ⚠️ THIS IS THE FIX FOR THE EXPLOIT ROYALE CREATES, and it is a rules decision, not a
   detail. A prop or an `other` leg is BINARY: it hit or it didn't, and there is no
   margin to be "furthest under" by. In Standard that costs nothing — Worst Beat is a
   shame mechanic and an unmeasurable lever just falls through. In Royale it is
   elimination-dodging: a player who only ever bets props is immune to a quarter of the
   chop machinery by construction, forever, at no cost.

   Kap's call (handoff §8.3, option 1): give a binary leg a margin from its own price.
   A leg that lost at a de-vigged 82% was a far worse beat than one that lost at 55%, so
   convert that probability to the equivalent normal deviate and rank it on the SAME
   z-scale the margin legs already use. −450 loses to −120, as intended, and every leg
   in the league stays rankable on every lever.

   Preference order for the probability: the de-vigged CLOSE, because the close is the
   bar this whole system argues from. Falling back to the entry price when no close was
   captured is deliberate and is recorded in `beatBasis` — Worst Beat asks "how
   surprising was this loss", and the price you took is a legitimate answer to that.
   Worst CLV does NOT get the same fallback, because Worst CLV is *about* the close;
   substituting the entry price there would make every uncapturable leg score exactly
   zero movement, which is a fabricated number, not a missing one. */
function royaleBeatDeficit(x, r) {
  if (x.mkt === "prop" || x.mkt === "other") {
    const pClose = rDevig(r && r.close, r && r.closeOpp);
    const pEntry = rDevig(x.price, x.entryPriceOpp);
    const p = pClose != null ? pClose : (pEntry != null ? pEntry : rImp(x.price));
    const basis = pClose != null ? "close" : (pEntry != null ? "entry" : "entry-raw");
    if (!(p > 0 && p < 1)) return { v: null, basis: "unpriced" };
    return { v: rInvNorm(p), basis };
  }
  /* Margin markets: how far under ITS OWN NUMBER the leg finished, in SDs.

     ⚠️ FROM THE NUMBER, NOT FROM THE PRICE. This measured the gap to rExpected(), which
     folds the price in — so the same miss scored worse for a −400 favourite than for a
     −110. But SHORTEST ODDS is already the lever that punishes taking chalk, and pricing
     it in here made two of the four levers measure overlapping things. A randomised
     hierarchy is only interesting while its levers are independent.
     data/bozo-rules.json says "finished furthest under its number, in standard
     deviations", and this now is that.

     ⚠️ It is the grader's own edge, negated — you lost by exactly the amount you missed
     by, with no second definition of "missed" to drift from the first. `line` is what
     this side gives up, so margin − line is the edge in both directions, including an
     MLB/NHL dog at +1.5 stored as −1.5. */
  if (r == null || r.actual == null) return { v: null, basis: "no-result" };
  const sd = rSd(x);
  if (!(sd > 0)) return { v: null, basis: "no-sd" };
  const actual = Number(r.actual);
  const line = x.mkt === "ml" ? 0 : (Number(x.line) || 0);
  const edge = x.mkt === "total" ? (rDir(x) === "under" ? (line - actual) : (actual - line))
             : x.mkt === "ml"    ? actual
             :                     (actual - line);
  return { v: -edge / sd, basis: "margin" };
}

/* Score every losing leg on one lever.
     { key }                  a unique worst — this lever decides
     { pass: "tie" }          measurable, two or more tied on the worst value
     { pass: "unmeasurable" } no losing leg could be scored at all
   ⚠️ A tie and an unmeasurable lever are DIFFERENT FAILURES and are recorded as such.
   A tie is bad luck. An unmeasurable lever is a hole in the data, and the whole reason
   §8.3 exists. Reporting them as one thing hides the second behind the first. */
function royaleApplyLever(leverIdx, losers, picks, results) {
  const scored = [];
  for (const key of losers) {
    const x = picks[key], r = (results || {})[key] || {};
    let v = null;
    switch (leverIdx) {
      case 0: v = rImp(x.price); break;                            // biggest favourite = worst
      case 1: v = royaleBeatDeficit(x, r).v; break;                // furthest under = worst
      case 2: v = x.ts || null; break;                             // latest in = worst
      case 3: {                                                    // price moved most against = worst
        // ⚠️ Needs BOTH sides at BOTH ends. Kap's call: a leg with no capturable close
        // is unmeasurable and falls through to the next lever. It is neither ranked
        // worst (DraftKings pulling a market is not the player's doing) nor ranked best
        // (that would make an uncapturable market the optimal thing to bet).
        const pC = rDevig(r.close, r.closeOpp), pE = rDevig(x.price, x.entryPriceOpp);
        v = (pC == null || pE == null) ? null : -(pC - pE);
        break;
      }
    }
    if (v != null && Number.isFinite(v)) scored.push({ key, v });
  }
  if (!scored.length) return { pass: "unmeasurable" };
  const max = Math.max(...scored.map(s => s.v));
  const top = scored.filter(s => s.v === max);
  return top.length === 1 ? { key: top[0].key } : { pass: "tie" };
}

/* The chop, exactly as handoff §8.2 specifies it. */
function royaleDecideChop(state, order) {
  const picks = state.picks || {}, results = state.results || {};
  const keys = Object.keys(picks);
  const losers = keys.filter(k => {
    const r = results[k] || {};
    return r.result === "lost" || (r.result == null && r.won === false);
  });

  const out = { ticketCashed: losers.length === 0, losers: losers.map(playerName),
                chopped: null, decidedBy: null, leversPassed: [] };
  if (!losers.length) return out;                                   // clean week, pot carries
  if (losers.length === 1) {
    out.chopped = playerName(losers[0]); out.choppedKey = losers[0];
    out.decidedBy = "only loser";
    return out;
  }
  for (const li of (Array.isArray(order) && order.length ? order : [0, 1, 2, 3])) {
    const r = royaleApplyLever(li, losers, picks, results);
    if (r.key) { out.chopped = playerName(r.key); out.choppedKey = r.key; out.decidedBy = ROYALE_LEVER_NAMES[li]; return out; }
    out.leversPassed.push({ lever: ROYALE_LEVER_NAMES[li], why: r.pass });
  }
  // Every lever tied or was unmeasurable. The week still has to resolve, so the
  // longest-standing submission wears it — and the fallback is NAMED in the record
  // rather than dressed up as a lever decision.
  const first = losers.slice().sort((a, b) => (picks[a].ts || 0) - (picks[b].ts || 0))[0];
  out.chopped = (picks[first] && picks[first].who) || playerName(first); out.choppedKey = first;
  out.decidedBy = "fallback: first submitted";
  return out;
}

/* ---------------- roster state ----------------
   Defaults are computed, never written at league creation, so a league that switches
   format before its first lock doesn't carry a stale roster snapshot. */
/* ⚠️ THE RE-DEPLOY IS AUTOMATIC. It was a "buy-back" with a timed window: you were
   chopped, offered a way back, and had until the next lock to take it or forfeit. That
   window existed to stop a chopped player lurking and re-entering at the final two, which
   would be strictly better than playing every week.

   Kap replaced it with the Warzone gulag: you don't choose, you just come back — once.
   The exploit it was built to close cannot exist, because there is no decision to defer.
   A whole class of state goes with it: no offers, no expiry, no forfeiting at lock, no
   prompt that has to be noticed. What is left is a parachute next to your name, which
   says the next chop is the one that ends you.

   ⚠️ Storage keys stay `buybacksLeft` and `boughtBack`. Renaming them would orphan the
   seeded demo leagues and every league already mid-season for the sake of vocabulary the
   database never shows anyone. The rename happens at this boundary: everything above
   reads `redeploysLeft` and `redeployed`, and both spellings are accepted on the way in
   so a league written under either one loads. */
function royaleStatus(state) {
  const stored = (state && state.royale && state.royale.status) || {};
  const out = {};
  /* ⚠️ EVERY PLAYER GETS EXACTLY ONE, ALWAYS. The cost used to double as an on/off
     switch — 0 meant no re-deploys at all — which made a free re-deploy impossible to
     express and, worse, made "no way back" a league someone could configure.

     Kap's call: in Bozo Royale you auto-redeploy, full stop. Being able to sit out and
     dodge bozos is unfair to the group, and a league where the first chop is final turns
     week 1 into the whole season for whoever loses it. The cost is now only a price, and
     0 simply means free. */
  const allowance = 1;
  for (const k of Object.keys((state && state.members) || {})) {
    const s = stored[k] || {};
    const left = Number.isFinite(s.redeploysLeft) ? s.redeploysLeft
               : Number.isFinite(s.buybacksLeft) ? s.buybacksLeft : allowance;
    const back = Array.isArray(s.redeployed) ? s.redeployed
               : Array.isArray(s.boughtBack) ? s.boughtBack : [];
    out[k] = {
      alive: s.alive !== false,
      redeploysLeft: left,
      redeployed: back,
      // ⚠️ THE PARACHUTE. True once you have used your one way back, and it stays true
      // for the rest of the season — it is not a status that clears. It marks you as the
      // player for whom the next chop is final.
      hasParachute: back.length > 0,
      chopped: Array.isArray(s.chopped) ? s.chopped : [],
      eliminatedWeek: s.eliminatedWeek ?? null,
    };
  }
  return out;
}
const royaleAliveKey = (state, key) => {
  const st = royaleStatus(state)[key];
  return !st || st.alive !== false;
};
const royaleAlive = (state, name) => royaleAliveKey(state, memberKeyOf(state, { name }));
const royaleRoster = state => Object.entries(royaleStatus(state))
  .filter(([, s]) => s.alive).map(([k]) => k);

/* Resolve one Royale week: decide the chop, re-deploy them if they still have one, and
   write an immutable record of how it was decided.

   ⚠️ The chop record is written ONCE and never revised. It is the receipt for an
   elimination, and the reason `leversPassed` carries the tie-vs-unmeasurable distinction
   is so that a season later you can tell a coin-flip from a data hole. */
async function royaleResolveWeek(env, lid, state) {
  const week = state.week || 1;
  if (((state.royale || {}).chops || {})[week]) return null;      // already resolved

  const status = royaleStatus(state);
  const before = royaleRoster(state);
  const decided = royaleDecideChop(state, state.order);

  const rec = {
    week, season: state.season || SEASON,
    rosterBefore: before.map(playerName),
    leverOrder: (Array.isArray(state.order) ? state.order : [0, 1, 2, 3]).map(i => ROYALE_LEVER_NAMES[i]),
    ticketCashed: decided.ticketCashed,
    chopped: decided.chopped, decidedBy: decided.decidedBy,
    leversPassed: decided.leversPassed,
    losers: decided.losers,
    resolvedTs: Date.now(),
  };

  const patch = {};
  const key = decided.choppedKey;
  if (key) {
    const st = status[key] || { redeploysLeft: 0, chopped: [], redeployed: [] };
    patch[`royale/status/${key}/chopped`] = [...(st.chopped || []), week];
    rec.fundsNextTicket = decided.chopped;              // the standard-Bozo mechanic, kept

    /* ⚠️ RE-DEPLOYED, NOT OFFERED. You do not get asked and you cannot decline — being
       chopped with a re-deploy left puts you straight back on the next ticket. That is
       the whole reason the timed window is gone: there is no decision left to defer to a
       more convenient week.

       ⚠️ NOT at the final two. A re-deploy there would mean the chop cannot resolve the
       league, and the season would never end. Your last life is spent by being the last
       one chopped, which is the correct place for it to run out. */
    const stillAlive = before.filter(k => k !== key).length;
    const canRedeploy = (st.redeploysLeft || 0) > 0 && stillAlive > 1;

    if (canRedeploy) {
      patch[`royale/status/${key}/alive`] = true;
      patch[`royale/status/${key}/redeploysLeft`] = (st.redeploysLeft || 0) - 1;
      patch[`royale/status/${key}/buybacksLeft`] = (st.redeploysLeft || 0) - 1;  // legacy mirror
      patch[`royale/status/${key}/redeployed`] = [...(st.redeployed || []), week];
      patch[`royale/status/${key}/boughtBack`] = [...(st.redeployed || []), week]; // legacy mirror
      patch[`royale/status/${key}/eliminatedWeek`] = null;
      rec.redeployed = true;
      rec.cost = settingsOf(state).buyback;
    } else {
      patch[`royale/status/${key}/alive`] = false;
      patch[`royale/status/${key}/eliminatedWeek`] = week;
      rec.redeployed = false;
      // Out for good. The parachute they already used is what made this chop final.
      rec.hadParachute = (st.redeployed || []).length > 0;

      const survivors = before.filter(k => k !== key);
      if (survivors.length === 1) {
        patch["royale/survivor"] = playerName(survivors[0]);
        patch["royale/endedWeek"] = week;
        rec.survivor = playerName(survivors[0]);
      }
    }
  }
  // ⚠️ "w" PREFIX, AND IT IS LOAD-BEARING. Firebase silently converts an object whose
  // keys are sequential integers into an ARRAY — so chops keyed 1..14 come back as a
  // 15-element array with null at index 0, and any reader doing Object.values().sort()
  // dies on null.week. Measured on the seeded demo, not theorised. A non-numeric key
  // cannot be coerced.
  patch[`royale/chops/w${week}`] = rec;
  try { await fbPatch(env, LG(lid), patch); }
  catch (e) { console.log("royale: chop write failed — " + e.message); return null; }
  return rec;
}

/* POST /bozo/buyback — RETIRED.
   The re-deploy is automatic now: being chopped with one left puts you straight back on
   the next ticket, so there is nothing to accept or decline and no window to miss.

   ⚠️ The route stays and answers honestly rather than being deleted. bozo.html is
   served network-first with a cache fallback, so a phone that has not revalidated still
   has the old prompt on it — and a button that falls through to the generic chat handler
   tells the player nothing about why it stopped working. This does. */
async function bozoBuyback(request, env, cors) {
  return json({
    error: "Buy-backs are gone. Get chopped with a re-deploy left and you come straight back, automatically — there is nothing to decide. Reload the page.",
    retired: true, replacedBy: "automatic re-deploy",
  }, 410, cors);
}

/* POST /bozo/close {league, row, close, closeOpp} — fill in a closing price by hand, on
   any week, long after that week has rolled over.

   ⚠️ THIS EXISTS BECAUSE THE GRADE CARD CANNOT REACH BACKWARDS. bozoNext clears
   /results when the week advances, so the grading UI only ever shows the current week —
   and a leg the capture missed in week 3 would be permanently unfillable by the time
   anyone noticed. The ledger keeps the row forever; this is the door to it.

   ⚠️ A CAPTURED CLOSE IS STILL IMMUTABLE. If closeObservedAt is set, the cron observed
   that price at kickoff off a licensed feed and stamped a server clock. Nothing typed in
   afterwards outranks that, and this route refuses rather than quietly declining.

   ⚠️ Both sides or nothing. A close with no opposite side cannot be de-vigged, so it is
   not a usable close — accepting one alone would write a row that looks filled and is
   still invisible to the chart.

   ⚠️ closeSource stays "manual" forever. A number read off a bet slip and a number
   snapped from the feed are different kinds of evidence and must never become
   indistinguishable in the column that records where closes come from. */
async function bozoCloseFill(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const lid = leagueOf(body);
  if (!lid) return json({ error: "Bad league id." }, 400, cors);
  const auth = await requireManager(request, env, lid);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  const rowKey = String(body.row || "");
  if (!/^[\w%.-]+$/.test(rowKey)) return json({ error: "Bad ledger row key." }, 400, cors);

  let row;
  try { row = (await fbGet(env, LG(lid) + "/ledger/" + rowKey)).data; }
  catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }
  if (!row) return json({ error: "No such ledger row." }, 404, cors);

  if (row.closeObservedAt != null)
    return json({ error: "That close was captured at kickoff from the book and can't be overwritten." }, 409, cors);

  // Clearing is allowed — sending both as null undoes a mistyped entry.
  const clear = body.close == null && body.closeOpp == null;
  const close = Math.round(Number(body.close)), closeOpp = Math.round(Number(body.closeOpp));
  if (!clear) {
    if (!Number.isFinite(close) || Math.abs(close) < 100)
      return json({ error: "The closing price has to be a real American price (±100 or wider)." }, 400, cors);
    if (!Number.isFinite(closeOpp) || Math.abs(closeOpp) < 100)
      return json({ error: "The other side is required — without it the price can't be de-vigged, and the leg stays off the chart either way." }, 400, cors);
  }

  const patch = clear
    ? { close: null, closeOpp: null, closeBook: null, closeSource: null,
        closeEnteredBy: null, closeEnteredTs: null }
    : { close, closeOpp, closeBook: "draftkings", closeSource: "manual",
        closeUnavailableReason: null,
        closeEnteredBy: auth.name, closeEnteredTs: Date.now() };

  try { await fbPatch(env, LG(lid) + "/ledger/" + rowKey, patch); }
  catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }

  // Mirror onto the live week if this row is the current one, so the board agrees.
  const state = auth.league;
  const parts = rowKey.split("-w");
  if (parts.length === 2) {
    const [wk, pKey] = parts[1].split("-");
    if (Number(wk) === (state.week || 1) && (state.picks || {})[pKey]) {
      try { await fbPatch(env, LG(lid) + "/results/" + pKey, clear
        ? { close: null, closeOpp: null, closeBook: null, closeSource: null }
        : { close, closeOpp, closeBook: "draftkings", closeSource: "manual", closeUnavailableReason: null }); }
      catch (e) { /* the ledger is the receipt; the live mirror is a convenience */ }
    }
  }
  return json({ ok: true, row: rowKey, close: clear ? null : close, closeOpp: clear ? null : closeOpp }, 200, cors);
}

/* GET /bozo/close-gaps?league=<id> — every ledger row still missing a usable close.
   Public, like the rest of the board. "Usable" means BOTH sides present: one side alone
   cannot be de-vigged and is dropped by the chart, so it belongs on this list. */
async function bozoCloseGaps(request, url, env, cors) {
  const lid = validLeagueId(url.searchParams.get("league") || "") ? url.searchParams.get("league") : DEFAULT_LEAGUE;
  let lg, ledger = {};
  try {
    lg = await loadLeague(env, lid);
    if (!lg) return json({ error: "No such league." }, 404, cors);
    ledger = (await fbGet(env, LG(lid) + "/ledger")).data || {};
  } catch (e) { return json({ error: "Database unreachable: " + e.message }, 502, cors); }

  const gaps = Object.entries(ledger)
    .filter(([, r]) => r && (r.close == null || r.closeOpp == null))
    .map(([row, r]) => ({
      row, week: r.week, player: r.player, label: r.label, sport: r.sport,
      game: r.game, price: r.price, priceOpp: r.priceOpp ?? null,
      close: r.close ?? null, closeOpp: r.closeOpp ?? null,
      reason: r.closeUnavailableReason || null,
      // A row the cron observed is not fillable, and the UI needs to know before it
      // offers a box that would be refused.
      locked: r.closeObservedAt != null,
      result: r.result || null,
    }))
    .sort((a, b) => (a.week - b.week) || String(a.player).localeCompare(String(b.player)));

  return json({
    league: lid, synthetic: lg.synthetic === true,
    total: Object.keys(ledger).length, gaps: gaps.length, rows: gaps,
    note: "A leg needs BOTH sides of the closing market to be de-vigged. One side alone is dropped from the CLV chart and from n, exactly as if there were no close at all.",
  }, 200, cors);
}

/* ========================== /bozo/grade, /bozo/next ======================= */
// Manager-only writes. NFL/CFB outcomes are recomputed from scheduled KV data; only
// prop/other outcomes and the public lever walk arrive from the browser. The signed,
// stateless phase-one proposal freezes every value before the confirmed write.

function bozoScheduledTeamSide(pick, game) {
  const registry = bozoBuildTeamRegistry(pick.sport).aliases;
  const side = bozoTeamNorm(pick.side, registry);
  const matches = team => [team?.abbr, team?.name].some(v => bozoTeamNorm(v, registry) === side);
  if (matches(game.home)) return "home";
  if (matches(game.away)) return "away";
  // The stored matchup is always away @ home. This is a final compatibility belt for
  // legacy abbreviations such as IU that are not the current ESPN abbreviation.
  const parts = String(pick.game || "").split(/\s+(?:@|vs\.?)\s+/i);
  if (parts.length === 2) {
    if (bozoTeamNorm(parts[0], registry) === side) return "away";
    if (bozoTeamNorm(parts[1], registry) === side) return "home";
  }
  return null;
}

function bozoScheduledOutcome(pick, game) {
  // Blank is not zero. Completion alone is insufficient: a source can flip its status
  // before both score cells land, and that row remains retryable.
  if (!game || game.completed !== true || game.homeScore == null || game.awayScore == null)
    return { pending: true, reason: game ? "scores_pending" : "event_unmatched" };
  const home = Number(game.homeScore), away = Number(game.awayScore);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return { pending: true, reason: "scores_pending" };
  let actual, edge;
  if (pick.mkt === "total") {
    actual = home + away;
    edge = pick.side === "under" ? Number(pick.line) - actual : actual - Number(pick.line);
  } else {
    const selected = bozoScheduledTeamSide(pick, game);
    if (!selected) return { pending: true, reason: "team_unmatched" };
    actual = selected === "home" ? home - away : away - home;
    edge = pick.mkt === "ml" ? actual : actual - Number(pick.line);
  }
  if (!Number.isFinite(edge)) return { pending: true, reason: "invalid_market_number" };
  const result = edge > 0 ? "won" : edge < 0 ? "lost" : "push";
  return { pending: false, actual, result, won: result === "won" ? true : result === "lost" ? false : null };
}

async function bozoGradeFromScheduleKv(env, state, supplied) {
  const results = JSON.parse(JSON.stringify(supplied || state.results || {}));
  const pending = [], docs = new Map(), sources = {};
  for (const [key, pick] of Object.entries(state.picks || {})) {
    if (!pick || pick.mkt === "prop" || pick.mkt === "other") continue;
    if (!BOZO_GRADEABLE_SPORTS.has(pick.sport)) {
      pending.push({ key, player: pick.who || playerName(key), reason: "sport_not_gradeable" });
      continue;
    }
    if (!docs.has(pick.sport)) docs.set(pick.sport, await bozoScheduleDoc(env, pick.sport, state.season || SEASON));
    const doc = docs.get(pick.sport);
    if (doc) sources[pick.sport] = { source: doc.source, fetchedAt: doc.fetchedAt, etag: doc.etag || null };
    const eventId = String(pick.espnEventId || pick.eventId || "");
    const game = bozoScheduleFindGame(doc, pick);
    const grade = bozoScheduledOutcome(pick, game);
    if (grade.pending) {
      // A cached page may still send a hand-entered game result. Preserve close fields,
      // but strip every grade field until the Worker-reachable source has both scores.
      const row = { ...(results[key] || {}) };
      for (const field of ["actual", "result", "won", "gradeSource", "gradeObservedAt"]) delete row[field];
      if (Object.keys(row).length) results[key] = row; else delete results[key];
      pending.push({ key, player: pick.who || playerName(key), eventId, reason: grade.reason });
      continue;
    }
    results[key] = { ...(results[key] || {}), actual: grade.actual, result: grade.result, won: grade.won,
      gradeSource: doc.source, gradeObservedAt: doc.fetchedAt };
  }
  return { results, pending, sources };
}

async function bozoGradeConfirmCode(env, proposal) {
  const bytes = te.encode(JSON.stringify(proposal));
  const payload = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return payload + "." + (await hmac(env.BOZO_PEPPER, "bozo-grade|" + payload));
}

async function readBozoGradeConfirm(env, token) {
  if (typeof token !== "string" || token.indexOf(".") < 1) return null;
  const [payload, sig] = token.split(".");
  if (!timingSafeEqual(sig || "", await hmac(env.BOZO_PEPPER, "bozo-grade|" + payload))) return null;
  let proposal;
  try {
    const bytes = Uint8Array.from(unb64urlStr(payload), c => c.charCodeAt(0));
    proposal = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
  if (!proposal || proposal.v !== 1 || !proposal.expiresAt || Date.now() > proposal.expiresAt) return null;
  return proposal;
}

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

    if (body.confirm !== undefined) {
      const proposal = await readBozoGradeConfirm(env, body.confirm);
      if (!proposal || proposal.lid !== lid)
        return json({ error: "That grade confirmation is invalid or expired. Preview it again." }, 409, cors);
      if (proposal.week !== (state.week || 1) || proposal.status !== status)
        return json({ error: "The board changed after the grade preview. Preview it again." }, 409, cors);
      // Phase two uses only the signed, frozen phase-one values. It does not read a score
      // source again, and no value supplied beside `confirm` can alter the write.
      body = proposal.body;
    } else {
      let automatic;
      try { automatic = await bozoGradeFromScheduleKv(env, state, body.results); }
      catch (e) { return json({ error: "Schedule cache unavailable: " + e.message, retryable: true }, 503, cors); }
      if (body.action === "preview")
        return json({ ok: true, results: automatic.results, pending: automatic.pending,
          sources: automatic.sources, retryable: automatic.pending.length > 0 }, 200, cors);
      // Never trust a browser's game score over the scheduled source. Manual results remain
      // legal only for prop/other legs; game-market rows above have just been overwritten.
      body.results = automatic.results;
      if (body.graded && automatic.pending.length)
        return json({ error: "Game scores are still pending from the scheduled source.",
          pending: automatic.pending, retryable: true }, 409, cors);
      const proposal = { v: 1, lid, week: state.week || 1, status,
        expiresAt: Date.now() + 5 * 60 * 1000,
        body: { results: body.results || {}, bozo: body.bozo ?? null,
          bozoWhy: body.bozoWhy == null ? "" : String(body.bozoWhy).slice(0, 200),
          graded: body.graded === true } };
      const confirmCode = await bozoGradeConfirmCode(env, proposal);
      const resultCount = Object.values(proposal.body.results).filter(r => r && r.result).length;
      const targets = [LG(lid) + "/results", LG(lid) + "/bozo", LG(lid) + "/bozoWhy",
        LG(lid) + "/ledger", ...(proposal.body.graded ? [LG(lid) + "/status"] : [])];
      return json({ status: "confirm_required",
        echo: `Grade week ${proposal.week}: ${resultCount} results; Bozo ${proposal.body.bozo || "none"}. ` +
          `Confirm to write ${targets.join(", ")}.`,
        confirm_code: confirmCode, expires_in: 300, writeTargets: targets,
        results: proposal.body.results, bozo: proposal.body.bozo, bozoWhy: proposal.body.bozoWhy,
        note: "Nothing was written. Phase two stores these signed values without re-fetching scores." }, 200, cors);
    }

    /* ⚠️ ONE EVENT, ONE OUTCOME. A game's margin and total are read once per eventId, so
       moneylines, spreads and totals cannot disagree with themselves. Props and `other`
       are hand-graded per player, and nothing stopped two people on the SAME selection
       from being marked differently — one wins, one loses, off a single real-world fact.
       That is not a display glitch: it decides who wears it, and in Bozo Royale who is
       eliminated. The simulator caught this by grading legs independently and getting
       eight answers for one Super Bowl.

       Keyed on (eventId, prop) rather than on the leg, exactly as the handoff specifies.
       Refused rather than auto-reconciled — picking a winner between two hand-entered
       answers would be inventing the result, and the manager knows which is right. */
    if (body.results && typeof body.results === "object") {
      const picks = state.picks || {};
      const byMarket = new Map();
      for (const [key, p] of Object.entries(picks)) {
        if (!p || (p.mkt !== "prop" && p.mkt !== "other")) continue;
        const r = body.results[key] || body.results[playerName(key)];
        if (!r) continue;
        const outcome = r.result || (r.won === true ? "won" : r.won === false ? "lost" : null);
        if (outcome == null) continue;
        const mk = [p.eventId, p.mkt, p.prop || "", p.line ?? "", p.side ?? ""].join("|");
        if (!byMarket.has(mk)) byMarket.set(mk, []);
        byMarket.get(mk).push({ who: playerName(key), outcome, label: p.label });
      }
      for (const [, group] of byMarket) {
        if (group.length < 2) continue;
        const distinct = [...new Set(group.map(g => g.outcome))];
        if (distinct.length > 1)
          return json({ error:
            `${group.map(g => g.who + " = " + g.outcome).join(", ")} — but that's the same selection `
            + `(${group[0].label}) on the same game, so it can only have one outcome. Fix the odd one out and grade again.`
          }, 409, cors);
      }
      await fbPut(env, LG(lid) + "/results", body.results);
    }
    if (body.bozo !== undefined) await fbPut(env, LG(lid) + "/bozo", body.bozo);
    if (body.bozoWhy !== undefined) await fbPut(env, LG(lid) + "/bozoWhy", String(body.bozoWhy).slice(0, 200));

    // Ledger last, before the status flip: if it fails the manager gets a 502, status is
    // still "placed", and hitting Decide again replays the whole thing idempotently.
    const backfilled = await ledgerBackfill(env, lid, state);
    // Read the ledger once so the grade stage can see which rows already carry a close
    // the cron captured at kickoff, and leave those alone.
    let have = {};
    try { have = (await fbGet(env, LG(lid) + "/ledger")).data || {}; }
    catch (e) { console.log("ledger: grade-stage read failed — " + e.message); }
    const upd = ledgerGradeUpdate(state.season || SEASON, state.week || 1, body.results, body.bozo, state.picks, have);
    if (Object.keys(upd).length) {
      // gradedAt is per row, not per league — a re-grade that only fixes one player's
      // result should not restamp everyone else's.
      const pickKeys = Object.keys(state.picks || {});
      const gradedAt = new Date().toISOString();
      for (const k of Object.keys(body.results || {})) {
        const rowKey = pickKeys.includes(k) ? k
          : pickKeys.includes(encodeURIComponent(k)) ? encodeURIComponent(k)
          : (pickKeys.find(x => playerName(x) === k) || k);
        upd[`${ledgerKey(state.season || SEASON, state.week || 1, rowKey)}/gradedAt`] = gradedAt;
      }
      await fbPatch(env, LG(lid) + "/ledger", upd);
    }

    // ⚠️ Bozo Royale resolves the chop HERE, on the server, from the results just
    // written — not from anything the client sent. See the note above royaleDecideChop.
    // It runs only on the transition into "graded", so re-grading a week to correct a
    // typo cannot chop a second person or double-spend a buy-back.
    let chop = null;
    if (body.graded && settingsOf(state).format === "royale" && status !== "graded") {
      const fresh = await loadLeague(env, lid);          // read back the results we just wrote
      chop = await royaleResolveWeek(env, lid, fresh || state);
    }

    if (body.graded) await fbPut(env, LG(lid) + "/status", "graded");
    return json({ ok: true, backfilled, chop }, 200, cors);
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
    history.push({ week: state.week || 1, bozo: state.bozo || null, slip: state.slip || null });

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
      // ⚠️ Named on purpose. Anything NOT named here survives the rollover, and a
      // betslip link surviving means last week's settled parlay stays on the new
      // week's ticket, still clickable. Archived into `history` just above.
      slip: null,
    });
    bozoNullWriteTripwire("/bozo/next", auth, lid, ["picks", "results"]);
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

/* ============================ SwoleDawg — D1 layer ============================ */
// Training data for the signed-in athlete. Identity is NOT re-invented here: it is the
// same uid Firebase already keys /users/{uid} by, resolved by sessionAuth() for the
// browser and by the per-user MCP token for Claude. D1 holds the training rows; the uid
// is the only join between the two stores.
//
// ⚠️ EVERY function here takes a uid and every statement binds it. There is one athlete
// today and the code must not assume one — a dropped uid filter is one member reading or
// overwriting another's log. This is the single place that reads or writes those tables:
// the browser routes below and the sd_* MCP tools both come through these functions, so
// there is exactly one implementation of what a valid write is.

const SWOLE_DAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

function swoleDb(env) { return env && env.SWOLE_DB ? env.SWOLE_DB : null; }
function swoleNoDb() { return { error: "SwoleDawg storage is not configured on this deployment (no SWOLE_DB binding)." }; }
const swoleNow = () => new Date().toISOString();

function swoleValidDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function swoleDayKeyFor(dateISO) { return SWOLE_DAYS[new Date(dateISO + "T12:00:00Z").getUTCDay()]; }
function swoleSessionId(uid, dateISO, dayKey) { return uid + ":" + dateISO + ":" + dayKey; }

// Week is DERIVED from block_start_date, never stored in the program and never typed by
// hand — then frozen onto the session row at write time. Weeks turn over on Monday so
// they line up with the day list; a date before the block starts reads week 1, not 0.
function swoleMondayOf(dateISO) {
  const d = new Date(dateISO + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}
function swoleWeekOf(programDoc, dateISO) {
  const start = programDoc && programDoc.block_start_date;
  if (!swoleValidDate(start) || !swoleValidDate(dateISO)) return 1;
  const n = Math.floor((swoleMondayOf(dateISO) - swoleMondayOf(start)) / 604800000) + 1;
  return Math.max(1, n);
}
// The effort schedule is keyed by that derived week. Week 1 carries sets_override, which
// WINS over the per-exercise sets in the day tables — anything that prescribes or renders
// sets must apply it. Only fall through to the open-ended "4+" row when the week really is
// >= 4; never fall through to it for an unmatched low week, which would hand the most
// aggressive setting to a block that has not started.
function swoleEffortFor(programDoc, week) {
  const sched = (programDoc && programDoc.effort_schedule) || [];
  const exact = sched.find(e => e.week === week);
  if (exact) return exact;
  const open = sched.find(e => typeof e.week === "string" && e.week.endsWith("+"));
  if (open && week >= parseInt(open.week, 10)) return open;
  return sched[0] || null;
}
function swoleSetsFor(exercise, effort) {
  const o = effort && effort.sets_override;
  return o == null ? exercise.sets : Math.min(o, exercise.sets);
}

async function swoleGetProgram(env, uid) {
  const db = swoleDb(env); if (!db) return null;
  const row = await db.prepare(
    "SELECT doc, version FROM program WHERE uid = ? AND active = 1 ORDER BY version DESC LIMIT 1"
  ).bind(uid).first();
  if (!row) return null;
  try { return { doc: JSON.parse(row.doc), version: row.version }; } catch { return null; }
}

// Seeding is an explicit write of a supplied document, not a copy baked into this file.
// A second copy of program.json living in the Worker would drift from the one in the repo
// and there would be no way to tell which was authoritative.
async function swolePutProgram(env, uid, doc, note) {
  const db = swoleDb(env); if (!db) return { error: swoleNoDb().error };
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.days))
    return { error: "That does not look like a program document (no days array)." };
  const cur = await db.prepare("SELECT MAX(version) v FROM program WHERE uid = ?").bind(uid).first();
  const version = ((cur && cur.v) || 0) + 1;
  await db.batch([
    db.prepare("UPDATE program SET active = 0 WHERE uid = ?").bind(uid),
    db.prepare("INSERT INTO program (uid, version, doc, active, created_at, note) VALUES (?, ?, ?, 1, ?, ?)")
      .bind(uid, version, JSON.stringify(doc), swoleNow(), note || null),
  ]);
  return { ok: true, version };
}

function swoleDayOf(programDoc, dayKey) {
  return ((programDoc && programDoc.days) || []).find(d => d.day === dayKey) || null;
}

async function swoleStartSession(env, uid, dateISO, dayKey, source) {
  const db = swoleDb(env); if (!db) return swoleNoDb();
  if (!swoleValidDate(dateISO)) return { error: "Date must be YYYY-MM-DD." };
  const prog = await swoleGetProgram(env, uid);
  if (!prog) return { error: "No program is seeded for this account yet. Seed program.json first." };
  const key = dayKey || swoleDayKeyFor(dateISO);
  const day = swoleDayOf(prog.doc, key);
  if (!day) return { error: "No day '" + key + "' in the program." };
  const id = swoleSessionId(uid, dateISO, key);
  const week = swoleWeekOf(prog.doc, dateISO);
  const type = (day.exercises && day.exercises.length) ? "lift" : (day.name || "").toLowerCase().includes("ruck") ? "ruck" : "rest";
  const existing = await db.prepare("SELECT id, started_at, completed_at FROM sessions WHERE id = ? AND uid = ?").bind(id, uid).first();
  if (existing) return { ok: true, id, week, day: key, already_open: !existing.completed_at, reopened: false };
  await db.prepare(
    "INSERT INTO sessions (id, uid, date, day_key, session_type, block, week, started_at) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(id, uid, dateISO, key, type, prog.doc.block || 1, week, swoleNow()).run();
  return { ok: true, id, week, day: key, name: day.name, source };
}

// One write path for a set, shared by the browser and by sd_log_set. UPSERT on
// (session, exercise, set_number) so "that was 11 not 10" corrects the row instead of
// appending a second, contradictory one.
async function swoleLogSet(env, uid, a, source) {
  const db = swoleDb(env); if (!db) return swoleNoDb();
  const dateISO = a.date;
  if (!swoleValidDate(dateISO)) return { error: "Date must be YYYY-MM-DD." };
  const prog = await swoleGetProgram(env, uid);
  if (!prog) return { error: "No program is seeded for this account yet." };
  const dayKey = a.day_key || swoleDayKeyFor(dateISO);
  const day = swoleDayOf(prog.doc, dayKey);
  if (!day) return { error: "No day '" + dayKey + "' in the program." };

  // id, then exact name, then substring, then every token present — "flat bench" has to
  // reach "Flat DB bench press", which no substring match does. AMBIGUITY IS A REFUSAL at
  // every stage: two candidates mean the caller gets the list back, never the first one.
  const wanted = String(a.exercise || "").toLowerCase().trim();
  const list = day.exercises || [];
  const narrow = () => {
    const byId = list.filter(e => e.id.toLowerCase() === wanted);
    if (byId.length) return byId;
    const exact = list.filter(e => e.name.toLowerCase() === wanted);
    if (exact.length) return exact;
    const sub = list.filter(e => e.name.toLowerCase().includes(wanted));
    if (sub.length) return sub;
    const toks = wanted.split(/[^a-z0-9]+/).filter(Boolean);
    if (!toks.length) return [];
    return list.filter(e => { const n = e.name.toLowerCase(); return toks.every(t => n.includes(t)); });
  };
  const hits = narrow();
  const ex = hits.length === 1 ? hits[0] : null;
  if (hits.length > 1) {
    return { error: "'" + a.exercise + "' matches more than one exercise on " + dayKey + " — say which.",
             candidates: hits.map(e => ({ id: e.id, name: e.name })) };
  }
  if (!ex) {
    // ⚠️ Refuse rather than guess. A wrong exercise match corrupts the history of two
    // lifts at once and will not be noticed for weeks.
    return { error: "No exercise matching '" + a.exercise + "' on " + dayKey + ".",
             candidates: list.map(e => ({ id: e.id, name: e.name })) };
  }
  const started = await swoleStartSession(env, uid, dateISO, dayKey, source);
  if (started.error) return started;

  const effort = swoleEffortFor(prog.doc, started.week);
  const prescribed = swoleSetsFor(ex, effort);
  let n = Number(a.set_number);
  if (!Number.isFinite(n) || n < 1) {
    const done = await db.prepare(
      "SELECT COUNT(*) c FROM sets WHERE uid = ? AND session_id = ? AND exercise_id = ?"
    ).bind(uid, started.id, ex.id).first();
    n = ((done && done.c) || 0) + 1;
  }
  const reps = Number(a.reps), weight = Number(a.weight_lb);
  if (!Number.isFinite(reps) || reps < 1) return { error: "reps is required." };
  if (!Number.isFinite(weight)) return { error: "weight_lb is required." };

  await db.prepare(
    "INSERT INTO sets (uid, session_id, exercise_id, exercise_name, set_number, weight_lb, reps, rir, rest_prescribed_s, rest_taken_s, source, logged_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?) " +
    "ON CONFLICT(session_id, exercise_id, set_number) DO UPDATE SET " +
    "weight_lb=excluded.weight_lb, reps=excluded.reps, rir=excluded.rir, " +
    "rest_taken_s=excluded.rest_taken_s, source=excluded.source, logged_at=excluded.logged_at"
  ).bind(uid, started.id, ex.id, ex.name, n, weight, reps,
         Number.isFinite(Number(a.rir)) ? Number(a.rir) : null,
         ex.rest_between_sets == null ? null : ex.rest_between_sets,
         Number.isFinite(Number(a.rest_taken_s)) ? Number(a.rest_taken_s) : null,
         source, swoleNow()).run();

  const rows = await db.prepare(
    "SELECT set_number, weight_lb, reps FROM sets WHERE uid = ? AND session_id = ? AND exercise_id = ? ORDER BY set_number"
  ).bind(uid, started.id, ex.id).all();
  const logged = (rows && rows.results) || [];
  const belowRange = reps < ex.rep_min;
  return {
    ok: true, session: started.id, week: started.week,
    exercise: { id: ex.id, name: ex.name },
    set: n, weight_lb: weight, reps,
    prescribed_sets: prescribed, sets_logged: logged.length,
    remaining: Math.max(0, prescribed - logged.length),
    rep_range: [ex.rep_min, ex.rep_max],
    rest_s: ex.rest_between_sets,
    // Flagged, never auto-applied. The program's calibration_override fires on "can't hit
    // bottom of range CLEAN" — and in a week whose RIR cap is high, stopping short of the
    // bottom is obedience to the cap, not a failed set. Only the human knows which it was.
    below_rep_range: belowRange,
    note: belowRange
      ? "Below the bottom of the " + ex.rep_min + "-" + ex.rep_max + " range. Program rule: can't hit bottom clean -> drop 5. " +
        "Do not apply it without asking whether the set was cut short by the week's RIR cap (" +
        (effort && effort.reps_in_reserve != null ? effort.reps_in_reserve + " RIR" : "see effort_schedule") +
        ") rather than by failure — those imply opposite actions."
      : null,
  };
}

async function swoleFinishSession(env, uid, dateISO, notes) {
  const db = swoleDb(env); if (!db) return swoleNoDb();
  if (!swoleValidDate(dateISO)) return { error: "Date must be YYYY-MM-DD." };
  const row = await db.prepare("SELECT id, day_key, week FROM sessions WHERE uid = ? AND date = ? ORDER BY started_at DESC LIMIT 1").bind(uid, dateISO).first();
  if (!row) return { error: "No session on " + dateISO + "." };
  await db.prepare("UPDATE sessions SET completed_at = ?, notes = COALESCE(?, notes) WHERE id = ? AND uid = ?")
    .bind(swoleNow(), notes || null, row.id, uid).run();
  const agg = await db.prepare(
    "SELECT COUNT(*) sets, SUM(weight_lb * reps) volume, COUNT(DISTINCT exercise_id) exercises FROM sets WHERE uid = ? AND session_id = ?"
  ).bind(uid, row.id).first();
  return { ok: true, session: row.id, day: row.day_key, week: row.week,
           sets: (agg && agg.sets) || 0, exercises: (agg && agg.exercises) || 0,
           volume_lb: (agg && agg.volume) || 0 };
}

async function swoleSession(env, uid, dateISO) {
  const db = swoleDb(env); if (!db) return swoleNoDb();
  const s = await db.prepare("SELECT * FROM sessions WHERE uid = ? AND date = ? ORDER BY started_at DESC LIMIT 1").bind(uid, dateISO).first();
  if (!s) return { error: "No session on " + dateISO + "." };
  const rows = await db.prepare(
    "SELECT exercise_id, exercise_name, set_number, weight_lb, reps, rir, rest_taken_s, source FROM sets WHERE uid = ? AND session_id = ? ORDER BY exercise_id, set_number"
  ).bind(uid, s.id).all();
  return { session: s, sets: (rows && rows.results) || [] };
}

async function swoleRecentSessions(env, uid, n) {
  const db = swoleDb(env); if (!db) return swoleNoDb();
  const rows = await db.prepare(
    "SELECT s.id, s.date, s.day_key, s.week, s.completed_at, COUNT(x.id) sets, SUM(x.weight_lb * x.reps) volume " +
    "FROM sessions s LEFT JOIN sets x ON x.session_id = s.id AND x.uid = s.uid " +
    "WHERE s.uid = ? GROUP BY s.id ORDER BY s.date DESC LIMIT ?"
  ).bind(uid, Math.min(Math.max(Number(n) || 10, 1), 50)).all();
  return { sessions: (rows && rows.results) || [] };
}

// A null value is a RECORDED GAP, not a zero and not a reason to interpolate. Storing the
// raw reads beside the value is what makes an averaged number auditable later.
async function swoleLogMeasurement(env, uid, m, source) {
  const db = swoleDb(env); if (!db) return swoleNoDb();
  const field = String(m.field || "").trim();
  if (!field) return { error: "field is required." };
  const date = m.date || swoleNow().slice(0, 10);
  if (!swoleValidDate(date)) return { error: "Date must be YYYY-MM-DD." };
  const known = await db.prepare("SELECT field, label, direction, tag FROM measurement_fields WHERE uid = ? AND field = ?").bind(uid, field).first();
  if (!known) return { error: "Unknown measurement field '" + field + "'. Seed measurement_fields first." };
  const value = m.value === null || m.value === undefined || m.value === "" ? null : Number(m.value);
  if (value !== null && !Number.isFinite(value)) return { error: "value must be a number or null." };
  const reads = Array.isArray(m.reads) && m.reads.length ? JSON.stringify(m.reads.map(Number)) : null;
  await db.prepare(
    "INSERT INTO measurements (uid, field, date, value, reads, source, note, logged_at) VALUES (?,?,?,?,?,?,?,?) " +
    "ON CONFLICT(uid, field, date) DO UPDATE SET value=excluded.value, reads=excluded.reads, source=excluded.source, note=excluded.note, logged_at=excluded.logged_at"
  ).bind(uid, field, date, value, reads, source, m.note || null, swoleNow()).run();
  return { ok: true, field, label: known.label, date, value, direction: known.direction, tag: known.tag };
}

async function swoleMeasurementHistory(env, uid, field, n) {
  const db = swoleDb(env); if (!db) return swoleNoDb();
  const rows = await db.prepare(
    "SELECT date, value, reads, source, note FROM measurements WHERE uid = ? AND field = ? ORDER BY date DESC LIMIT ?"
  ).bind(uid, field, Math.min(Math.max(Number(n) || 20, 1), 200)).all();
  return { field, readings: (rows && rows.results) || [] };
}

async function swoleLogNutrition(env, uid, d, source) {
  const db = swoleDb(env); if (!db) return swoleNoDb();
  const date = d.date || swoleNow().slice(0, 10);
  if (!swoleValidDate(date)) return { error: "Date must be YYYY-MM-DD." };
  const kcal = d.kcal == null || d.kcal === "" ? null : Number(d.kcal);
  const pro  = d.protein_g == null || d.protein_g === "" ? null : Number(d.protein_g);
  if (kcal === null && pro === null && !d.note)
    return { error: "Nothing to log: give kcal, protein_g, or a note. 'Hit target' is not a number." };
  await db.prepare(
    "INSERT INTO nutrition (uid, date, kcal, protein_g, note, source, logged_at) VALUES (?,?,?,?,?,?,?) " +
    "ON CONFLICT(uid, date) DO UPDATE SET kcal=excluded.kcal, protein_g=excluded.protein_g, note=excluded.note, source=excluded.source, logged_at=excluded.logged_at"
  ).bind(uid, date, kcal, pro, d.note || null, source, swoleNow()).run();
  return { ok: true, date, kcal, protein_g: pro };
}

// ⚠️ Nutrition was WRITE-ONLY until this existed. swoleLogNutrition could store a day's
// kcal and protein and nothing in the Worker — no route, no tool, no query — could read
// one back. A store you cannot read is not a log; it is a hole that accepts input.
async function swoleNutrition(env, uid, a) {
  const db = swoleDb(env); if (!db) return swoleNoDb();
  if (a && a.date) {
    if (!swoleValidDate(a.date)) return { error: "Date must be YYYY-MM-DD." };
    const row = await db.prepare(
      "SELECT date, kcal, protein_g, note, source, logged_at FROM nutrition WHERE uid = ? AND date = ?"
    ).bind(uid, a.date).first();
    return row ? { date: a.date, day: row } : { date: a.date, day: null, note: "Nothing logged on " + a.date + "." };
  }
  const rows = await db.prepare(
    "SELECT date, kcal, protein_g, note, source FROM nutrition WHERE uid = ? ORDER BY date DESC LIMIT ?"
  ).bind(uid, Math.min(Math.max(Number(a && a.n) || 14, 1), 200)).all();
  const days = (rows && rows.results) || [];
  // Averages over the days that CARRY a number, and the count is reported beside them —
  // a mean over 3 logged days out of 14 is not a 14-day average and must not read as one.
  const withKcal = days.filter(d => d.kcal != null), withPro = days.filter(d => d.protein_g != null);
  const mean = (list, k) => list.length ? Math.round(list.reduce((a2, d) => a2 + d[k], 0) / list.length) : null;
  return { days, days_returned: days.length,
           mean_kcal: mean(withKcal, "kcal"), kcal_days: withKcal.length,
           mean_protein_g: mean(withPro, "protein_g"), protein_days: withPro.length };
}

// What the page and radar.html read. OBSERVED and DERIVED only — nothing MODELLED is
// plotted here, because a modelled number rendered beside a measured one is treated as
// measured within a month.
async function swoleSummary(env, uid) {
  const db = swoleDb(env); if (!db) return swoleNoDb();
  const fields = await db.prepare("SELECT field, label, direction, tag, baseline, target_lo, target_hi FROM measurement_fields WHERE uid = ?").bind(uid).all();
  const out = {};
  for (const f of (fields && fields.results) || []) {
    const latest = await db.prepare("SELECT date, value FROM measurements WHERE uid = ? AND field = ? AND value IS NOT NULL ORDER BY date DESC LIMIT 1").bind(uid, f.field).first();
    out[f.field] = {
      label: f.label, unit: null, dir: f.direction, tag: f.tag,
      baseline: f.baseline, current: latest ? latest.value : null,
      target: f.target_lo != null && f.target_hi != null && f.target_lo !== f.target_hi
        ? [f.target_lo, f.target_hi] : (f.target_lo != null ? f.target_lo : null),
      as_of: latest ? latest.date : null,
    };
  }
  const recent = await db.prepare(
    "SELECT COUNT(*) n FROM sessions WHERE uid = ? AND completed_at IS NOT NULL AND date >= date('now','-7 day')"
  ).bind(uid).first();
  return { fields: out, sessions_last_7d: (recent && recent.n) || 0, as_of: swoleNow() };
}

/* ------------------------------- recovery -------------------------------------
   ⚠️ This closes a hole that read as missing data and was actually a missing
   feature. The Recovery sheet has carried a ten-field form since v0.3, and
   `saveRec` only ever mutated the in-memory day object and toasted "Recovery
   saved" — there was no table, no route, and `sdHydrateDays` hardcoded
   `recovery:{}`. So the value was gone on reload, the Overview sleep KPI could
   never populate, and the Sleep and HRV charts could never draw. Nothing about
   that was visible on screen: it looked like Kap had not logged anything.

   The whole day is one row. The form posts every field at once and says on
   screen that a blank stays null, so an absent value here means "not measured",
   NOT "leave whatever was there". The upsert overwrites accordingly — that is
   the promise the UI already makes, and the two must not disagree.

   A null is a recorded gap, not a zero, exactly as in `measurements`. Nothing
   here is derived from the DEVICE sleep fields: a watch's estimate and a number
   Kap typed are different claims, and merging them would launder one into the
   other. */
const SWOLE_RECOVERY_FIELDS = ["sleep_hours", "sleep_score", "hrv", "resting_hr",
  "readiness", "soreness", "energy", "mood", "joint_feel"];

async function swoleLogRecovery(env, uid, d, source) {
  const db = swoleDb(env); if (!db) return swoleNoDb();
  const date = (d && d.date) || swoleNow().slice(0, 10);
  if (!swoleValidDate(date)) return { error: "Date must be YYYY-MM-DD." };

  const vals = {};
  for (const f of SWOLE_RECOVERY_FIELDS) {
    const raw = d ? d[f] : null;
    if (raw == null || raw === "") { vals[f] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n)) return { error: f + " must be a number, or blank for not measured." };
    vals[f] = n;
  }
  if (SWOLE_RECOVERY_FIELDS.every(f => vals[f] === null) && !(d && d.note))
    return { error: "Nothing to log: give at least one reading, or a note. A blank day is not a zero day." };

  await db.prepare(
    "INSERT INTO recovery (uid, date, sleep_hours, sleep_score, hrv, resting_hr, readiness, soreness, energy, mood, joint_feel, note, source, logged_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) " +
    "ON CONFLICT(uid, date) DO UPDATE SET sleep_hours=excluded.sleep_hours, sleep_score=excluded.sleep_score, " +
    "hrv=excluded.hrv, resting_hr=excluded.resting_hr, readiness=excluded.readiness, soreness=excluded.soreness, " +
    "energy=excluded.energy, mood=excluded.mood, joint_feel=excluded.joint_feel, note=excluded.note, " +
    "source=excluded.source, logged_at=excluded.logged_at"
  ).bind(uid, date, vals.sleep_hours, vals.sleep_score, vals.hrv, vals.resting_hr, vals.readiness,
         vals.soreness, vals.energy, vals.mood, vals.joint_feel,
         (d && d.note) || null, source, swoleNow()).run();
  return Object.assign({ ok: true, date }, vals);
}

async function swoleRecovery(env, uid, a) {
  const db = swoleDb(env); if (!db) return swoleNoDb();
  const cols = "date, " + SWOLE_RECOVERY_FIELDS.join(", ") + ", note, source, logged_at";
  if (a && a.date) {
    if (!swoleValidDate(a.date)) return { error: "Date must be YYYY-MM-DD." };
    const row = await db.prepare(
      "SELECT " + cols + " FROM recovery WHERE uid = ? AND date = ?"
    ).bind(uid, a.date).first();
    return row ? { date: a.date, day: row }
               : { date: a.date, day: null, note: "Nothing logged on " + a.date + "." };
  }
  const rows = await db.prepare(
    "SELECT " + cols + " FROM recovery WHERE uid = ? ORDER BY date DESC LIMIT ?"
  ).bind(uid, Math.min(Math.max(Number(a && a.n) || 30, 1), 200)).all();
  const days = (rows && rows.results) || [];
  // Same rule as nutrition: a mean is taken over the days that CARRY the number,
  // and the count travels beside it so 3-of-30 cannot read as a 30-day average.
  const slept = days.filter(x => x.sleep_hours != null);
  return { days, days_returned: days.length,
           mean_sleep_hours: slept.length
             ? Math.round((slept.reduce((t, x) => t + x.sleep_hours, 0) / slept.length) * 10) / 10
             : null,
           sleep_days: slept.length };
}

/* ------------------------- SwoleDawg — browser routes ------------------------- */
// Session-authenticated, uid-scoped. The same functions the sd_* MCP tools call, so a
// set tapped in the browser and a set spoken to Claude are the same write with a
// different `source` stamp.
async function handleSwole(request, url, env, cors) {
  const path = url.pathname.replace(/^\/api\/swoledawg/, "") || "/";
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 401, cors);
  const uid = auth.uid || ("name:" + auth.name);
  if (!swoleDb(env)) return json(swoleNoDb(), 503, cors);

  const body = request.method === "POST"
    ? await request.json().catch(() => ({}))
    : {};
  const q = url.searchParams;
  const wrap = r => json(r && r.error ? r : r, r && r.error ? 400 : 200, cors);

  if (request.method === "GET") {
    if (path === "/summary")  return wrap(await swoleSummary(env, uid));
    if (path === "/program")  { const p = await swoleGetProgram(env, uid); return wrap(p ? { version: p.version, program: p.doc } : { error: "No program seeded." }); }
    if (path === "/sessions") return wrap(await swoleRecentSessions(env, uid, q.get("n")));
    if (path === "/session")  return wrap(await swoleSession(env, uid, q.get("date") || ""));
    if (path === "/measurements") return wrap(await swoleMeasurementHistory(env, uid, q.get("field") || "", q.get("n")));
    if (path === "/nutrition") return wrap(await swoleNutrition(env, uid, { date: q.get("date"), n: q.get("n") }));
    if (path === "/recovery") return wrap(await swoleRecovery(env, uid, { date: q.get("date"), n: q.get("n") }));
    return json({ error: "Unknown SwoleDawg route." }, 404, cors);
  }
  if (request.method !== "POST") return json({ error: "GET or POST only." }, 405, cors);

  if (path === "/program")   return wrap(await swolePutProgram(env, uid, body.program, body.note));
  if (path === "/session/start")  return wrap(await swoleStartSession(env, uid, body.date, body.day_key, "web"));
  if (path === "/session/finish") return wrap(await swoleFinishSession(env, uid, body.date, body.notes));
  if (path === "/set")       return wrap(await swoleLogSet(env, uid, body, "web"));
  if (path === "/nutrition") return wrap(await swoleLogNutrition(env, uid, body, "web"));
  if (path === "/recovery")  return wrap(await swoleLogRecovery(env, uid, body, "web"));
  if (path === "/measurement") return wrap(await swoleLogMeasurement(env, uid, body, "web"));
  return json({ error: "Unknown SwoleDawg route." }, 404, cors);
}

/* ===== DD-YAHOO-BLOCK START — generated from work/yahoo-parse.js + work/yahoo-worker.js; edit THERE ===== */
/* ===================== Yahoo public-league HTML adapter ====================
 * Yahoo's Fantasy API is access-gated behind a manual application review with
 * no published turnaround. A PUBLIC Yahoo league renders every input this site
 * needs on pages that require no cookie at all, and the Worker can read them
 * server-side where CORS does not apply. These are the pure parsers over that
 * HTML. Verified against league 773763 on 2026-09-02.
 *
 * ⚠️ THIS IS A SCRAPER AND IT WILL EVENTUALLY BREAK. Yahoo owes us no markup
 * stability. The design premise is that it breaks LOUDLY: every parser reports
 * what it found alongside what it expected, and the feed refuses to serve a
 * partial league. A half-read league that renders anyway is worse than an
 * error — it would put wrong replacement level and wrong money on a page whose
 * entire claim is that its numbers are checkable.
 *
 * Swap target: when the API application is approved only the fetch layer
 * changes. Everything downstream reads the same body shape as espnWarroomFeed.
 *
 * ---- What is and is not available server-side (measured, not assumed) ------
 *  /f1/<lg>/draftresults   210 rows, Pick | Player | Salary | Team.      ✅
 *  /f1/<lg>/<teamId>       lineup table, slot + player, incl. empty slots ✅
 *  /f1/<lg>?week=N         that week's matchups, week echoed in header    ✅
 *  /f1/<lg>/settings       scoring + playoffs + team count                ✅
 *      ⚠️ EXCEPT "Roster Positions", which that page builds in JavaScript and
 *      is therefore absent from the HTML a Worker sees. The lineup shape is
 *      taken from a roster page instead, where it is present as real rows.
 *      Do not "fix" this by adding a settings-page regex; there is nothing
 *      there to match.
 * ========================================================================= */

/* Yahoo slot label -> this site's slot vocabulary (Sleeper's, which the War
   Room speaks everywhere). W/R/T is Yahoo's flex; Q/W/R/T its superflex. */
const YAHOO_SLOT = {
  "QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "K": "K",
  "DEF": "DST", "D/ST": "DST", "DL": "DL", "LB": "LB", "DB": "DB",
  "W/R": "FLEX", "W/T": "FLEX", "R/W": "FLEX", "W/R/T": "FLEX", "R/W/T": "FLEX",
  "Q/W/R/T": "SUPERFLEX", "QB/WR/RB/TE": "SUPERFLEX",
  "BN": "BN", "IR": "IR", "IR+": "IR", "NA": "IR",
};
const YAHOO_POS = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DEF: "DST", "D/ST": "DST" };

/* ---- tiny HTML helpers ---------------------------------------------------
 * Deliberately NOT a general HTML parser. Each keys off a semantic class token
 * or an href shape Yahoo must keep for its own page to work — a far better bet
 * than nesting depth or attribute order. */
function ydecode(s) {
  return String(s == null ? "" : s)
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ").trim();
}
function ystrip(html) { return ydecode(String(html).replace(/<[^>]*>/g, " ")); }
function yrows(html) { return String(html).split(/<tr\b/i).slice(1); }

/* ⚠️ Match the class ATTRIBUTE, then test its tokens. The first version of this
   tried to match the token inside the attribute with a `(?:^|\s|")` prefix and
   silently returned null for `class="player"` — a token with nothing before it —
   while still working for `class="Alt Ta-start player"`. The result was a draft
   page that parsed to zero picks and a roster page that parsed perfectly, which
   is exactly the kind of half-success this file exists to prevent. */
function ycells(rowHtml) {
  const re = /<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi;
  const out = [];
  let m;
  while ((m = re.exec(rowHtml))) out.push({ attrs: m[2], html: m[3] });
  return out;
}
function ycell(rowHtml, token) {
  for (const c of ycells(rowHtml)) {
    const cls = (/class="([^"]*)"/i.exec(c.attrs) || [])[1] || "";
    if (cls.split(/\s+/).indexOf(token) >= 0) return c.html;
  }
  return null;
}
/* Every player anchor on every Yahoo fantasy page points at the same canonical
   NFL player page. That numeric id is the most stable identifier on the page.
   Defenses carry no such link — see ynamePos. */
function ypid(fragment) {
  const m = /sports\.yahoo\.com\/nfl\/players\/(\d+)/.exec(String(fragment || ""));
  return m ? m[1] : null;
}
/* "Matthew Stafford (LAR - QB)" / "Ravens (Bal - DEF)" / "--empty-- ( - )" */
function ynamePos(cellHtml) {
  const raw = ystrip(cellHtml);
  const compact = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(raw);
  /* Draft rows use the compact text above. Roster rows wrap the name, status icons,
     opponent, and notes in the same cell; use the canonical name anchor and the explicit
     "TEAM - POS" detail instead of treating all of that chrome as the player's name. */
  const nameAnchor = /<a\b(?=[^>]*class="[^"]*\bname\b)[^>]*>([\s\S]*?)<\/a>/i.exec(String(cellHtml));
  const playerAnchor = /<a\b[^>]*href="https?:\/\/sports\.yahoo\.com\/nfl\/players\/\d+"[^>]*>([\s\S]*?)<\/a>/i.exec(String(cellHtml));
  const name = ydecode(playerAnchor ? ystrip(playerAnchor[1]) : nameAnchor ? ystrip(nameAnchor[1]) : compact ? compact[1] : raw);
  const detail = /\b([A-Za-z]{2,3})\s*-\s*(QB|RB|WR|TE|K|DEF|D\/ST)\b/i.exec(raw);
  const parts = (compact ? compact[2] : "").split("-").map(s => s.trim());
  const posRaw = detail ? detail[2] : parts.length > 1 ? parts[parts.length - 1] : "";
  const team = detail ? detail[1] : parts.length > 1 ? parts[0] : "";
  return {
    name, team: team.toUpperCase(), posRaw,
    pos: YAHOO_POS[posRaw.toUpperCase()] || "",
    empty: /^--?\s*empty\s*--?$/i.test(name) || /^\(?\s*empty\s*\)?$/i.test(name) || !name,
  };
}
/* The join key the rest of the site uses. Defenses have no Yahoo player id, and
   the site's Market Value table already keys them by team abbreviation, so a
   defense becomes "dst:SEA" on both sides rather than being dropped. */
function yahooPlayerKey(pid, np) {
  if (np.pos === "DST") return np.team ? "dst:" + np.team : null;
  return pid ? "y:" + pid : null;
}

/* ---- team ids and names --------------------------------------------------
 * Team links are /f1/<leagueId>/<teamId>. Yahoo prints each team many times per
 * page (avatar, name, matchup), so order-preserving dedupe is the whole trick.
 * "My Team" is Yahoo's nav label for the viewer's own team, never a team name. */
function yahooTeamIds(html, leagueId) {
  const re = new RegExp('/f1/' + String(leagueId) + '/(\\d+)"', 'g');
  const ids = [];
  let m;
  while ((m = re.exec(html))) if (ids.indexOf(m[1]) < 0) ids.push(m[1]);
  return ids;
}
function yahooParseTeams(html, leagueId) {
  const re = new RegExp('href="(?:https?://[^"]*)?/f1/' + String(leagueId) + '/(\\d+)"[^>]*>([\\s\\S]{0,200}?)</a>', 'gi');
  const byId = new Map();
  let m;
  while ((m = re.exec(html))) {
    const name = ystrip(m[2]);
    if (!name || /^my team$/i.test(name)) continue;
    if (!byId.has(m[1])) byId.set(m[1], name);
  }
  const teams = [...byId.entries()].map(([id, name]) => ({ id, name }))
    .sort((a, b) => Number(a.id) - Number(b.id));
  return { teams, found: teams.length };
}

/* ---- draft results -------------------------------------------------------
 * ⚠️ Undrafted slots render as "--empty-- ( - )" at $0. A $0 here is NOT a
 * price, it is the absence of one, and letting it through would hand a free
 * player to every surplus number on the Money tab. Skipped and counted.
 * Measured on 773763: 210 rows = 149 linked players + defenses + empties. */
function yahooParseDraft(html) {
  const picks = [];
  let empty = 0, unkeyed = 0, ownerless = 0, rows = 0;
  for (const row of yrows(html)) {
    const playerCell = ycell(row, "player");
    const costCell = ycell(row, "cost");
    if (playerCell == null || costCell == null) continue;
    rows++;
    const np = ynamePos(playerCell);
    if (np.empty) { empty++; continue; }
    const key = yahooPlayerKey(ypid(playerCell), np);
    if (!key) { unkeyed++; continue; }
    const teamCell = ycell(row, "team-name");
    const owner = teamCell == null ? null : ystrip(teamCell);
    if (!owner) { ownerless++; continue; }
    const cm = /\$\s*([\d,]+)/.exec(ystrip(costCell));
    picks.push({
      key, pid: ypid(playerCell), name: np.name, pos: np.pos, team: np.team,
      cost: cm ? Number(cm[1].replace(/,/g, "")) : null, owner,
    });
  }
  return { picks, rows, found: picks.length, empty, unkeyed, ownerless };
}

/* ---- one team's roster ---------------------------------------------------
 * ⚠️ The SLOT decides starter vs bench and it is the only place that
 * information exists — a player's own position cannot tell you whether he is
 * starting. BN and IR are the bench; everything else starts.
 * Empty slots are recorded, not skipped: they are how the league's lineup shape
 * is recovered without the settings page (see the header note). */
function yahooParseRoster(html, teamId) {
  const players = [];
  const shape = {};
  const unknownSlots = [];
  let emptySlots = 0;
  for (const row of yrows(html)) {
    const posCell = ycell(row, "pos");
    if (posCell == null) continue;
    const slotRaw = ystrip(posCell).toUpperCase();
    if (!slotRaw || slotRaw === "POS") continue;
    const slot = YAHOO_SLOT[slotRaw];
    if (!slot) { unknownSlots.push(slotRaw); continue; }   // report, never guess
    shape[slot] = (shape[slot] || 0) + 1;
    const playerCell = ycell(row, "player");
    const np = playerCell ? ynamePos(playerCell) : null;
    const key = np ? yahooPlayerKey(ypid(playerCell), np) : null;
    if (!np || np.empty || !key) { emptySlots++; continue; }
    players.push({
      key, pid: ypid(playerCell), name: np.name, pos: np.pos, team: np.team,
      slot, starter: slot !== "BN" && slot !== "IR",
    });
  }
  /* "<league> - <team> | Fantasy Football | Yahoo! Sports" */
  const tm = /<title>\s*(.*?)\s+-\s+(.*?)\s*\|/i.exec(html);
  return {
    teamId: String(teamId),
    leagueName: tm ? ydecode(tm[1]) : "",
    teamName: tm ? ydecode(tm[2]) : "",
    players, shape, unknownSlots,
    found: players.length, emptySlots, slotCount: players.length + emptySlots,
  };
}

/* ---- schedule ------------------------------------------------------------
 * /f1/<lg>?week=N. Team ids appear inside the matchups module in pair order,
 * so distinct-ids-in-document-order chunked by two IS the week's matchups.
 *
 * ⚠️ TWO TRAPS, BOTH OF WHICH PRODUCE CONFIDENT WRONG ANSWERS:
 *  1. The browser will happily serve every ?week=N from cache, making all 17
 *     weeks identical while every sanity check still passes. Fetch with
 *     cache: "no-store", and
 *  2. verify the week Yahoo actually rendered against the week asked for. The
 *     module prints "Week N Matchups"; if that N disagrees, the page is not the
 *     page requested and the week must be discarded, not stored under the
 *     wrong index. */
function yahooParseWeek(html, leagueId, expectWeek) {
  const i = html.search(/Tst-matchups-body/i);
  if (i < 0) return { ok: false, reason: "no-matchups-module", pairs: [] };
  const j = html.indexOf("Tst-standings", i);
  const mod = html.slice(i, j > i ? j : i + 120000);

  const hdr = /Week\s+(\d+)\s+Matchups/i.exec(mod);
  const saw = hdr ? Number(hdr[1]) : null;
  if (expectWeek != null && saw != null && saw !== Number(expectWeek))
    return { ok: false, reason: "week-mismatch", asked: Number(expectWeek), saw, pairs: [] };

  const ids = yahooTeamIds(mod, leagueId);
  const pairs = [];
  for (let k = 0; k + 1 < ids.length; k += 2) pairs.push([ids[k], ids[k + 1]]);
  return { ok: true, week: saw, teams: ids.length, pairs };
}
/* A week is only usable if every team appears exactly once. Anything else means
   the module held something other than a clean round of matchups. */
function yahooWeekIsSane(week, teamCount) {
  if (!week.ok) return false;
  const flat = week.pairs.reduce((a, p) => a.concat(p), []);
  return flat.length === teamCount && new Set(flat).size === teamCount;
}

/* ---- settings ------------------------------------------------------------
 * A plain label/value table plus the stat-modifier rows. Only what the War Room
 * consumes is read; nothing else is half-modelled. Roster Positions is NOT here
 * (see header) — take the shape from yahooParseRoster().shape. */
/* ⚠️ Splitting a row on "</td>" and stripping tags leaves the opening <tr>'s
   own attributes glued to the first cell (" class=\"...\">Max Teams:"), so the
   label never matches and every setting silently reads null — which is how this
   returned an all-null settings object against the real page while looking
   fine. Cells come from ycells(), which matches whole <td>…</td> elements. */
function yahooSettingRow(html, label) {
  const re = new RegExp("^" + label + "\\s*:?$", "i");
  for (const row of yrows(html)) {
    const cells = ycells(row).map(c => ystrip(c.html));
    const first = cells.findIndex(c => c);
    if (first < 0) continue;
    if (re.test(cells[first])) return cells[first + 1] == null ? "" : cells[first + 1];
  }
  return null;
}
function yahooParseSettings(html) {
  const playoffs = yahooSettingRow(html, "Playoffs");
  const maxTeams = yahooSettingRow(html, "Max Teams");
  const fractional = yahooSettingRow(html, "Fractional Points");
  const rec = yahooSettingRow(html, "Receptions");

  /* "6 teams - Week 15, 16 and 17 (ends Monday, Jan 4)" */
  const pt = /(\d+)\s*teams?/i.exec(playoffs || "");
  const pw = /Week\s+(\d+)/i.exec(playoffs || "");
  const recPts = rec == null ? null : Number(String(rec).replace(/[^0-9.]/g, ""));

  return {
    teams: maxTeams ? Number(maxTeams) : null,
    playoffTeams: pt ? Number(pt[1]) : null,
    playoffStart: pw ? Number(pw[1]) : null,
    fractional: fractional == null ? null : /^yes$/i.test(fractional),
    /* reception points is what picks this site's Market Value column */
    rec: Number.isFinite(recPts) ? recPts : null,
    playoffsRaw: playoffs,
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = {
  YAHOO_SLOT, YAHOO_POS, ydecode, ystrip, yrows, ycells, ycell, ypid, ynamePos,
  yahooPlayerKey, yahooTeamIds, yahooParseTeams, yahooParseDraft,
  yahooParseRoster, yahooParseWeek, yahooWeekIsSane, yahooParseSettings,
};

/* ================= Yahoo public-league Worker adapter ====================
 * The pure HTML parsers above are generated verbatim from work/yahoo-parse.js.
 * This layer owns network I/O, refusal rules, projection joins, caching, and routes.
 * Public Yahoo pages require no cookie; a private league is refused explicitly.
 */
const YAHOO_READ = "https://football.fantasysports.yahoo.com/f1";
const YAHOO_KV_PREFIX = "yahoo:league:";
const YAHOO_SHARE_PREFIX = "yahoo:share:";
const YAHOO_SHARE_OF_PREFIX = "yahoo:shareof:";
const YAHOO_SCHEDULE_PREFIX = "yahoo:schedule:";
const YAHOO_RECORD_TTL = 60 * 60 * 24 * 180;
const YAHOO_MAX_HTML = 2 * 1024 * 1024;
const YAHOO_PROJ_POS = ["QB", "RB", "WR", "TE", "K", "DEF"];

function yahooKvKey(uid) { return YAHOO_KV_PREFIX + uid; }
function yahooScheduleKey(leagueId, season, weeks) {
  return YAHOO_SCHEDULE_PREFIX + season + ":" + leagueId + ":" + weeks;
}

function yahooShareToken() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(28));
  let token = "";
  for (const byte of bytes) token += alphabet[byte % alphabet.length];
  return token;
}

function yahooPrivateReason() {
  return "This Yahoo league is not public. Yahoo must expose it without a sign-in for Data Dawgs to read it.";
}

async function yahooFetchPage(leagueId, suffix, noStore) {
  const url = YAHOO_READ + "/" + encodeURIComponent(leagueId) + String(suffix || "");
  const init = { redirect: "follow", headers: { Accept: "text/html,application/xhtml+xml" } };
  if (noStore) init.cache = "no-store";
  let response;
  try { response = await fetch(url, init); }
  catch { return { ok: false, status: 0, reason: "Yahoo could not be reached from the Worker." }; }
  const finalUrl = String(response.url || url);
  const finalHost = (() => { try { return new URL(finalUrl).hostname; } catch { return ""; } })();
  if (response.status === 401 || response.status === 403 || response.status === 404 ||
      /(^|\.)login\.yahoo\.com$/i.test(finalHost))
    return { ok: false, status: response.status || 403, reason: yahooPrivateReason() };
  if (!response.ok) return { ok: false, status: response.status, reason: "Yahoo answered " + response.status + "." };
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > YAHOO_MAX_HTML)
    return { ok: false, status: 502, reason: "Yahoo's page was too large to parse safely." };
  let html;
  try { html = await response.text(); }
  catch { return { ok: false, status: 502, reason: "Yahoo's page could not be read." }; }
  if (html.length > YAHOO_MAX_HTML)
    return { ok: false, status: 502, reason: "Yahoo's page was too large to parse safely." };
  if (/id=["']login-username["']|name=["']signin["']/i.test(html))
    return { ok: false, status: 403, reason: yahooPrivateReason() };
  return { ok: true, status: response.status, html };
}

/* Slice the one table/module a parser needs before walking rows. Yahoo pages are close to
   1 MB; retaining or repeatedly scanning whole documents would waste the Worker's CPU. */
function yahooTableAround(html, pattern, maxLength) {
  const at = typeof pattern === "string" ? html.indexOf(pattern) : html.search(pattern);
  if (at < 0) return "";
  const start = html.lastIndexOf("<table", at);
  const end = html.indexOf("</table>", at);
  if (start < 0 || end < at) return "";
  const out = html.slice(start, end + 8);
  return out.length <= maxLength ? out : "";
}
function yahooMatchupsModule(html) {
  const start = html.search(/Tst-matchups-body/i);
  if (start < 0) return "";
  const end = html.indexOf("Tst-standings", start);
  const out = html.slice(start, end > start ? end : start + 160000);
  return out.length <= 180000 ? out : "";
}
function yahooRosterModule(html) {
  const first = html.search(/class="[^"]*\bpos\b[^"]*\bheadcol\b/i);
  if (first < 0) return "";
  const start = html.lastIndexOf('<section class="stat-target"', first);
  const last = (() => {
    const matches = [...html.matchAll(/class="[^"]*\bpos\b[^"]*\bheadcol\b/gi)];
    return matches.length ? matches[matches.length - 1].index : first;
  })();
  const end = html.indexOf("</section>", last);
  if (start < 0 || end < last) return "";
  const out = html.slice(start, end + 10);
  return out.length <= 400000 ? out : "";
}

async function yahooCanonicalSettings(leagueId) {
  if (String(leagueId) !== "773763") return null;
  let response;
  try {
    response = await fetch(SITE + "/data/leagues/pepperoninipples.json", {
      headers: { Accept: "application/json" },
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
  } catch { return null; }
  if (!response.ok) return null;
  try {
    const body = await response.json();
    return body && body.settings ? body : null;
  } catch { return null; }
}

function yahooReconcileSettings(live, canonical) {
  if (!canonical) return { ok: true, canonical: null };
  const expected = canonical.settings || {};
  const disagreements = [];
  if (Number(live.teams) !== Number(expected.team_count)) disagreements.push("team count");
  if (Number(live.playoffTeams) !== Number(expected.playoff_teams)) disagreements.push("playoff teams");
  if (Number(live.playoffStart) !== Number(expected.playoff_start_week)) disagreements.push("playoff start");
  if (Number(live.rec) !== Number((expected.scoring || {}).ppr)) disagreements.push("reception scoring");
  return disagreements.length
    ? { ok: false, reason: "Yahoo's live settings disagree with the canonical league file: " + disagreements.join(", ") + "." }
    : { ok: true, canonical };
}

function yahooProjectionValue(row, rec, weeks) {
  const stats = row && row.stats || {};
  const key = Number(rec) === 1 ? "pts_ppr" : Number(rec) === 0 ? "pts_std" :
    Number(rec) === 0.5 ? "pts_half_ppr" : null;
  if (!key || !Number.isFinite(Number(stats[key]))) return null;
  const total = Number(stats[key]);
  return Math.round((total / Math.max(1, Number(weeks) || 1)) * 100) / 100;
}

function yahooProjectionIndex(rows, rec, weeks) {
  const by = new Map(), pool = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const player = row && row.player || {};
    const rawPos = String(player.position || "").toUpperCase();
    if (!YAHOO_PROJ_POS.includes(rawPos)) continue;
    const pos = rawPos === "DEF" ? "DST" : rawPos;
    const name = String(player.full_name || ((player.first_name || "") + " " + (player.last_name || "")).trim());
    if (!name) continue;
    const team = player.team ? String(player.team).toUpperCase() : "";
    const key = ddPlayerKey({ name, pos, team });
    if (!key || by.has(key)) continue;
    const item = {
      id: "s:" + String(row.player_id == null ? key : row.player_id),
      sleeperId: row.player_id == null ? null : String(row.player_id),
      name, pos, team, p: yahooProjectionValue(row, rec, weeks), key,
    };
    by.set(key, item);
    /* Null projections are useful only as a join result for a rostered/drafted player.
       They are not a replacement-level pool and would otherwise ship thousands of retired
       Sleeper index rows to the browser as if they were current free agents. */
    if (item.p != null) pool.push(item);
  }
  return { by, pool };
}

async function yahooFetchProjections(season, rec, weeks) {
  const query = "?season_type=regular&order_by=pts_half_ppr" +
    YAHOO_PROJ_POS.map(pos => "&position[]=" + encodeURIComponent(pos)).join("");
  let response;
  try { response = await fetch("https://api.sleeper.app/projections/nfl/" + season + query); }
  catch { return { ok: false, reason: "Sleeper's projection feed could not be reached." }; }
  if (!response.ok) return { ok: false, reason: "Sleeper's projection feed answered " + response.status + "." };
  let rows;
  try { rows = await response.json(); }
  catch { return { ok: false, reason: "Sleeper's projection feed was not JSON." }; }
  return { ok: true, ...yahooProjectionIndex(rows, rec, weeks) };
}

async function yahooReadSchedule(leagueId, season, weeks, teamCount, homeModule, env) {
  const kv = env && env.RL || null;
  const key = yahooScheduleKey(leagueId, season, weeks);
  if (kv) {
    try {
      const cached = JSON.parse((await kv.get(key)) || "null");
      if (cached && cached.teamCount === teamCount && Array.isArray(cached.schedule) &&
          cached.schedule.length === weeks)
        return { ok: true, schedule: cached.schedule, weeksOk: weeks, cached: true };
    } catch { /* a corrupt cache is a miss */ }
  }
  const schedule = [];
  for (let weekNo = 1; weekNo <= weeks; weekNo++) {
    let module = weekNo === 1 ? homeModule : "";
    if (!module) {
      const page = await yahooFetchPage(leagueId, "?week=" + weekNo, true);
      if (!page.ok) return page;
      module = yahooMatchupsModule(page.html);
      page.html = "";
    }
    const parsed = yahooParseWeek(module, leagueId, weekNo);
    if (!parsed.ok || Number(parsed.week) !== weekNo || !yahooWeekIsSane(parsed, teamCount))
      return { ok: false, status: 502, reason: "Yahoo's Week " + weekNo + " matchup page failed its echoed-week or team-count check." };
    schedule.push(parsed.pairs);
  }
  if (kv) {
    try { await kv.put(key, JSON.stringify({ teamCount, schedule }), { expirationTtl: YAHOO_RECORD_TTL }); }
    catch { /* the verified schedule can still be served */ }
  }
  return { ok: true, schedule, weeksOk: weeks, cached: false };
}

async function yahooWarroomFeed(cred, env) {
  const leagueId = String(cred && cred.leagueId || "");
  const season = Number(cred && cred.season) || new Date().getUTCFullYear();
  if (!/^\d{1,12}$/.test(leagueId)) return { ok: false, status: 400, reason: "That does not look like a Yahoo league id." };

  let page = await yahooFetchPage(leagueId, "/settings", false);
  if (!page.ok) return page;
  const settingsTable = yahooTableAround(page.html, "Max Teams", 160000) +
    yahooTableAround(page.html, "Receptions", 160000);
  page.html = "";
  if (!settingsTable) return { ok: false, status: 502, reason: "Yahoo's settings table could not be isolated." };
  const settings = yahooParseSettings(settingsTable);
  if (!settings.teams || settings.rec == null || !settings.playoffTeams || !settings.playoffStart)
    return { ok: false, status: 502, reason: "Yahoo's settings page was incomplete, so this league was not loaded." };
  const canonical = await yahooCanonicalSettings(leagueId);
  const reconciled = yahooReconcileSettings(settings, canonical);
  if (!reconciled.ok) return { ok: false, status: 409, reason: reconciled.reason };

  page = await yahooFetchPage(leagueId, "?week=1", true);
  if (!page.ok) return page;
  const homeModule = yahooMatchupsModule(page.html);
  page.html = "";
  if (!homeModule) return { ok: false, status: 502, reason: "Yahoo's league-home matchup module could not be isolated." };
  const teamResult = yahooParseTeams(homeModule, leagueId);
  if (teamResult.found !== Number(settings.teams))
    return { ok: false, status: 502, reason: "Yahoo returned " + teamResult.found + " teams; settings require " + settings.teams + "." };

  page = await yahooFetchPage(leagueId, "/draftresults", false);
  if (!page.ok) return page;
  const draftTable = yahooTableAround(page.html, /class="player"/i, 400000);
  page.html = "";
  if (!draftTable) return { ok: false, status: 502, reason: "Yahoo's draft-results table could not be isolated." };
  const draft = yahooParseDraft(draftTable);
  if (draft.rows > 0 && draft.found === 0 && draft.empty !== draft.rows)
    return { ok: false, status: 502, reason: "Yahoo lists a drafted league but no draft picks could be read." };

  const rosterReads = [];
  const observedShape = {};
  const unknownSlots = [];
  for (const team of teamResult.teams) {
    page = await yahooFetchPage(leagueId, "/" + encodeURIComponent(team.id), false);
    if (!page.ok) return page;
    const rosterTable = yahooRosterModule(page.html);
    const title = (/<title>[\s\S]*?<\/title>/i.exec(page.html) || [""])[0];
    page.html = "";
    if (!rosterTable) return { ok: false, status: 502, reason: "Yahoo's roster table for team " + team.id + " could not be isolated." };
    const roster = yahooParseRoster(title + rosterTable, team.id);
    if (!roster.found) return { ok: false, status: 502, reason: "Yahoo returned zero readable players for team " + team.id + "." };
    /* Empty IR slots are not rendered, and an occupied IR slot can replace a displayed BN
       row. Merge maxima across teams; the canonical file wins when this is the known room. */
    for (const [slot, count] of Object.entries(roster.shape))
      observedShape[slot] = Math.max(observedShape[slot] || 0, Number(count) || 0);
    unknownSlots.push(...roster.unknownSlots);
    rosterReads.push({ team, roster });
  }

  const regularWeeks = Math.max(1, Number(settings.playoffStart) - 1);
  const scheduleResult = await yahooReadSchedule(leagueId, season, regularWeeks,
    Number(settings.teams), homeModule, env);
  if (!scheduleResult.ok) return scheduleResult;

  const projections = await yahooFetchProjections(season, settings.rec, regularWeeks);
  if (!projections.ok) return { ok: false, status: 502, reason: projections.reason };
  const paidBy = new Map(draft.picks.map(pick => [pick.key, pick.cost]));
  const poolById = new Map(), usedProjectionKeys = new Set();
  const addYahooPlayer = row => {
    const id = String(row.key);
    if (poolById.has(id)) return poolById.get(id);
    const projectionKey = ddPlayerKey({ name: row.name, pos: row.pos, team: row.team });
    const projection = projectionKey ? projections.by.get(projectionKey) : null;
    if (projectionKey) usedProjectionKeys.add(projectionKey);
    const out = { id, yahooId: row.pid || null, name: row.name, pos: row.pos, team: row.team,
      p: projection ? projection.p : null, paid: paidBy.has(row.key) ? paidBy.get(row.key) : null };
    poolById.set(id, out);
    return out;
  };
  const teams = rosterReads.map(({ team, roster }) => {
    const ids = [], starters = [];
    for (const player of roster.players) {
      const row = addYahooPlayer(player);
      ids.push(row.id);
      if (player.starter) starters.push(row.id);
    }
    return { id: String(team.id), name: roster.teamName || team.name,
      owner: null, players: ids, starters };
  });
  for (const pick of draft.picks) addYahooPlayer(pick);
  for (const projection of projections.pool) {
    if (usedProjectionKeys.has(projection.key)) continue;
    poolById.set(projection.id, { id: projection.id, yahooId: null, name: projection.name,
      pos: projection.pos, team: projection.team, p: projection.p, paid: null });
  }
  const shape = canonical && canonical.settings && canonical.settings.roster_slots || observedShape;
  const slots = Object.entries(shape).map(([slot, count]) => ({ slot: slot === "BN" ? "BENCH" : slot, count }));
  const superflex = Number(shape.SUPERFLEX || 0) > 0;
  const scoringMode = superflex ? "sf" : settings.rec === 1 ? "full" : settings.rec === 0.5 ? "half" : settings.rec === 0 ? "std" : "custom";
  const leagueName = rosterReads[0] && rosterReads[0].roster.leagueName ||
    canonical && canonical.name || "Yahoo league";
  return { ok: true, body: {
    league: {
      id: leagueId, name: leagueName, season, size: Number(settings.teams), dynasty: false,
      playoffTeams: Number(settings.playoffTeams), playoffStart: Number(settings.playoffStart),
      scoring: { mode: scoringMode, ppr: Number(settings.rec), superflex }, slots,
      draftType: canonical && canonical.settings && canonical.settings.draft_type || null,
      budget: canonical && canonical.settings && canonical.settings.budget || null,
      keepers: !!(canonical && canonical.settings && canonical.settings.keepers),
    },
    teams, pool: [...poolById.values()], schedule: scheduleResult.schedule,
    diagnostics: {
      teamsFound: teamResult.found, rostersFound: rosterReads.length,
      picksFound: draft.found, weeksOk: scheduleResult.weeksOk,
      unmatched: [...poolById.values()].filter(player => player.p == null).map(player => player.name),
      unknownSlots: [...new Set(unknownSlots)], scheduleCached: scheduleResult.cached,
      canonicalReconciled: !!canonical,
    },
  } };
}

async function yahooStored(kv, uid) {
  try { return JSON.parse((await kv.get(yahooKvKey(uid))) || "null"); }
  catch { return null; }
}

async function handleYahooShareRead(request, url, env, cors) {
  const kv = env.RL || null;
  if (!kv) return json({ error: "share storage is unavailable" }, 503, cors);
  const token = url.pathname.replace(/^\/yahoo\/share\//, "").replace(/\/+$/, "");
  if (!/^[A-Za-z0-9]{16,64}$/.test(token)) return json({ error: "That is not a share link." }, 404, cors);
  let link = null;
  try { link = JSON.parse((await kv.get(YAHOO_SHARE_PREFIX + token)) || "null"); } catch { link = null; }
  if (!link || !link.uid) return json({ error: "That share link is not valid, or the league owner revoked it." }, 404, cors);
  const cred = await yahooStored(kv, link.uid);
  if (!cred || String(cred.leagueId) !== String(link.leagueId))
    return json({ error: "The league owner is no longer connected to this Yahoo league." }, 409, cors);
  const result = await yahooWarroomFeed(cred, env);
  if (!result.ok) return json({ error: result.reason }, result.status || 502, cors);
  if (DD_SHARE_INCLUDE) ddDecorateBody(await ddLoadBoard(env, "yahoo", cred.leagueId, "season"), result.body);
  return json({ ok: true, shared: true, readOnly: true, sharedAt: link.at || null, ...result.body }, 200, cors);
}

async function handleYahoo(request, url, env, cors) {
  const kv = env.RL || null;
  if (!kv) return json({ error: "Yahoo connection storage is unavailable" }, 503, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 401, cors);
  const uid = auth.uid || auth.user && auth.user.uid || null;
  if (!uid) return json({ error: "This account has no durable uid. Sign in again to connect Yahoo." }, 409, cors);
  const path = url.pathname.replace(/^\/yahoo\/?/, "");

  if (path === "connect" && request.method === "DELETE") {
    try { await kv.delete(yahooKvKey(uid)); } catch {}
    try {
      const token = await kv.get(YAHOO_SHARE_OF_PREFIX + uid);
      if (token) await kv.delete(YAHOO_SHARE_PREFIX + token);
      await kv.delete(YAHOO_SHARE_OF_PREFIX + uid);
    } catch {}
    return json({ ok: true, connected: false }, 200, cors);
  }
  if (path === "connect" && request.method === "GET") {
    const cred = await yahooStored(kv, uid);
    return json({ ok: true, connected: !!cred, leagueId: cred && cred.leagueId || null,
      teamId: cred && cred.teamId || null, connectedAt: cred && cred.at || null }, 200, cors);
  }
  if (path === "connect" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch { return json({ error: "Send JSON." }, 400, cors); }
    const leagueId = String(body.leagueId || "").trim();
    const teamId = body.teamId == null || body.teamId === "" ? null : String(body.teamId).trim();
    if (!/^\d{1,12}$/.test(leagueId)) return json({ error: "That does not look like a Yahoo league id." }, 400, cors);
    if (teamId != null && !/^\d{1,4}$/.test(teamId)) return json({ error: "That does not look like a Yahoo team id." }, 400, cors);
    const probe = await yahooFetchPage(leagueId, "?week=1", true);
    if (!probe.ok) return json({ error: probe.reason }, probe.status || 400, cors);
    const module = yahooMatchupsModule(probe.html);
    const teams = yahooParseTeams(module, leagueId).teams;
    if (!teams.length) return json({ error: "Yahoo's public league page contained no readable teams." }, 502, cors);
    if (teamId != null && !teams.some(team => String(team.id) === teamId))
      return json({ error: "That team id is not in this Yahoo league." }, 400, cors);
    const record = { leagueId, teamId, season: new Date().getUTCFullYear(), at: new Date().toISOString() };
    try { await kv.put(yahooKvKey(uid), JSON.stringify(record), { expirationTtl: YAHOO_RECORD_TTL }); }
    catch { return json({ error: "Could not save the Yahoo connection." }, 500, cors); }
    return json({ ok: true, connected: true, public: true, leagueId, teamId,
      teams: teams.map(team => ({ id: team.id, name: team.name })) }, 200, cors);
  }
  if (path === "warroom" && request.method === "GET") {
    const cred = await yahooStored(kv, uid);
    if (!cred) return json({ error: "No Yahoo league connected for this account." }, 404, cors);
    const result = await yahooWarroomFeed(cred, env);
    if (!result.ok) return json({ error: result.reason }, result.status || 502, cors);
    ddDecorateBody(await ddLoadBoard(env, "yahoo", cred.leagueId, "season"), result.body);
    return json({ ok: true, ...result.body }, 200, cors);
  }
  if (path === "share" && request.method === "GET") {
    let token = null;
    try { token = await kv.get(YAHOO_SHARE_OF_PREFIX + uid); } catch { token = null; }
    return json({ ok: true, shared: !!token,
      url: token ? SITE + "/fantasy-warroom.html?provider=yahoo&share=" + token : null }, 200, cors);
  }
  if (path === "share" && request.method === "POST") {
    const cred = await yahooStored(kv, uid);
    if (!cred) return json({ error: "Connect a Yahoo league before sharing it." }, 404, cors);
    let token = null;
    try { token = await kv.get(YAHOO_SHARE_OF_PREFIX + uid); } catch { token = null; }
    if (!token) {
      token = yahooShareToken();
      const link = { uid, leagueId: String(cred.leagueId), at: Date.now() };
      await kv.put(YAHOO_SHARE_PREFIX + token, JSON.stringify(link), { expirationTtl: YAHOO_RECORD_TTL });
      await kv.put(YAHOO_SHARE_OF_PREFIX + uid, token, { expirationTtl: YAHOO_RECORD_TTL });
    }
    return json({ ok: true, url: SITE + "/fantasy-warroom.html?provider=yahoo&share=" + token }, 200, cors);
  }
  if (path === "share" && request.method === "DELETE") {
    let token = null;
    try { token = await kv.get(YAHOO_SHARE_OF_PREFIX + uid); } catch { token = null; }
    if (token) { try { await kv.delete(YAHOO_SHARE_PREFIX + token); } catch {} }
    try { await kv.delete(YAHOO_SHARE_OF_PREFIX + uid); } catch {}
    return json({ ok: true, shared: false }, 200, cors);
  }
  return json({ error: "Unknown Yahoo route." }, 404, cors);
}
/* ===== DD-YAHOO-BLOCK END ===== */

/* ===== DD-RANKINGS-BLOCK START — generated from work/rankings-block.js; edit THERE ===== */
/* The Dog Track — capture half (Stage A): entrants registry + Thursday snapshots.
 *
 * ⚠️ EDIT THIS FILE, NEVER THE ASSEMBLED WORKER. `node work/assemble.mjs` regenerates
 * the DD-RANKINGS-BLOCK region of ../dawg-bot-worker.js from this source; edits made to
 * the output are lost on the next build.
 *
 * ⚠️ WHY THIS BLOCK IS INJECTED *ABOVE* THE MCP BLOCK.
 * Both assemble.mjs and work/test-identity.mjs enforce "no Firebase write helper is ever
 * called inside the MCP block" by slicing from that block's opening marker to end of file.
 * This block legitimately calls fbPut/fbPost — it is a capture ledger — so it must live
 * before that marker or it would trip a guard written for a completely different reason.
 * assemble.mjs asserts the ordering rather than trusting it.
 *
 * ⚠️ AND THIS COMMENT MUST NOT SPELL THAT MARKER OUT. It did, once. test-identity.mjs
 * locates the block with a bare indexOf on the short marker text, so the sentence above
 * BECAME the earliest match: the guard sliced from this comment instead of from the real
 * marker, scanned this ledger, found fbPut and failed the deploy — a code comment breaking
 * a build by being quoted too accurately. Describe the marker; never reproduce it.
 *
 * WHAT THIS IS
 * Kap pastes each ranking service's positional ranks every Thursday BEFORE the first
 * kickoff of that NFL week. This block validates the paste, stamps captured_at with
 * SERVER time, refuses anything late, refuses to overwrite what was already captured,
 * and appends an audit row for every attempt — accepted or rejected.
 *
 * THE PRIVACY INVARIANT, WHICH IS THE WHOLE ARCHITECTURE (handoff §1)
 * Raw third-party ranks are paid content. They live at /rankings/snapshots/… behind the
 * Firebase secret and are readable ONLY by this Worker. Consequences, all load-bearing:
 *   · no route in this block returns a player name — not in a receipt, not in an error;
 *   · validation errors carry (line, pos, rank) coordinates so the admin page can point
 *     at the bad row in the paste box without the name making a round trip;
 *   · Stage A adds ZERO public routes. The only public read in this feature is
 *     GET /rankings/grades, which is Stage B and serves derived scores only.
 *
 * APPEND-ONLY, AND WHAT A "CORRECTION" MEANS (handoff §2, trap #10)
 * /rankings/snapshots/{season}/{week}/{entrant} is a MAP of capture_id → capture, not a
 * single record. Nothing in it is ever rewritten or deleted. At most one capture per
 * entrant/week is active (voided !== true); a bad paste is corrected by voiding the
 * original — which stays, flagged, forever — and pasting again before kickoff. After
 * kickoff the void still works but the replacement will not: that week then honestly
 * shows no active snapshot rather than a quietly-swapped one.
 */

const RANKINGS_POS = ["RB", "WR", "QB", "TE"];
const RANKINGS_DEPTHS = { RB: 36, WR: 48, QB: 24, TE: 24 };   // handoff §3, pre-registered

/* A four-position paste is legitimately bigger than any other body this Worker takes
 * (132 rows at the depth minimums, and services publish deeper), so it gets its own cap
 * rather than borrowing MAX_BODY = 24_000 and failing on a normal Thursday. */
const RANKINGS_MAX_BODY = 96_000;

/* Trap #12: a mid-season entrant must not shift anybody else's colour. Derived from a
 * hash of the entrant id, never from registry size or array index, so registering an
 * eighth service leaves the other seven exactly where they were. An explicit colour on
 * the create call always wins; this is only the default. */
const RANKINGS_PALETTE = [
  "#ff6a02", "#4aa3d6", "#e05555", "#2fbf3f",
  "#d19a30", "#9b7ede", "#3fbfb0", "#e0708f",
];

const RANKINGS_SCHEDULE_URL = "https://datadawgs216.com/data/nfl-schedule.json";

/* ---------------------------------------------------------------- name normalization --
 * THE SHARED SPEC (handoff §8.5 contract #1). These four rules are the contract between
 * this Worker and the local pipeline's normalize.py. Implement them identically in both
 * or trap #1 reappears as a cross-system divergence:
 *   1. lowercase
 *   2. strip punctuation and symbols
 *   3. strip a trailing generational suffix (jr, sr, ii, iii, iv, v), repeatedly
 *   4. collapse whitespace, trim
 * ⚠️ Punctuation is stripped by Unicode property (\p{P}\p{S}), NOT by deleting every
 * non-[a-z0-9] character. The naive version turns "André" into "andr" and "Amon-Ra" into
 * two tokens that no longer match the alias map — a silent corruption of exactly the
 * names this feature exists to line up.
 * Matching is on (normalized name + team + pos) — never on the name alone.
 */
function rankingsNormName(raw) {
  let s = String(raw == null ? "" : raw).toLowerCase();
  s = s.replace(/[\p{P}\p{S}]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  let parts = s.split(" ").filter(Boolean);
  while (parts.length > 1 && /^(jr|sr|ii|iii|iv|v)$/.test(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
}

/* --------------------------------------------------------------------------- admin ---
 * FAILS CLOSED. Until RANKINGS_ADMIN_KEY exists in the Cloudflare dashboard every admin
 * route here answers 403 — an unset secret must never mean an open door. The length floor
 * refuses a placeholder or a truncated paste for the same reason.
 */
const RANKINGS_KEY_MIN = 16;

function rankingsAdminOk(request, env) {
  const key = String((env && env.RANKINGS_ADMIN_KEY) || "");
  const got = String(request.headers.get("x-dd-admin") || "");
  if (key.length < RANKINGS_KEY_MIN) return false;
  if (got.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= got.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

async function rankingsReadBody(request) {
  const raw = await request.text();
  if (raw.length > RANKINGS_MAX_BODY) throw new Error("body too large");
  return JSON.parse(raw);
}

/* Every write AND every refusal appends here. Best-effort by design: losing the audit row
 * is bad, but failing a Thursday capture because the log write 500'd is worse. The caller
 * surfaces `logged:false` in the receipt so the admin strip can show that it happened
 * rather than the failure being invisible. */
async function rankingsLog(env, event) {
  try {
    await fbPost(env, "/rankings/log", { at: new Date().toISOString(), ...event });
    return true;
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------------- kickoff ---
 * WHAT "BEFORE KICKOFF" IS CHECKED AGAINST, in order:
 *   1. data/nfl-schedule.json on the site — the canonical nflverse-derived schedule this
 *      repo already ships and already refuses survivor captures against.
 *   2. the ESPN scoreboard (handoff trap #5, the documented recovery path).
 *   3. nothing — accept with kickoff_check:"deferred" and re-verify at grade time.
 *
 * ⚠️ DEVIATION FROM THE HANDOFF, RAISED RATHER THAN TAKEN SILENTLY (rule 8).
 * The handoff names ESPN as the kickoff source. This Worker already documents, at the
 * /scores route, that ESPN answers 403 to Cloudflare egress and 200 to a browser on the
 * identical path — an IP/ASN block, three header shapes tested, "another permutation will
 * not fix it" (8/4/26). Taking that literally, tier 2 fails on every Thursday and every
 * capture lands in "deferred", which turns the pre-kickoff gate into a grade-time
 * post-mortem and quietly drops the property the handoff actually asks for. So the site's
 * own canonical schedule goes in front of ESPN, ESPN stays exactly where the handoff put
 * it, and deferred remains the last resort. Kap ratifies or reverts this at the checkpoint.
 *
 * A RESOLVED kickoff is cached at /rankings/kickoffs/{season}/{week} at the first snapshot
 * attempt of the week, so a Thursday outage cannot block a capture. A FAILURE is never
 * cached — poisoning the week with a transient 502 is the bug that cache is meant to prevent.
 */
async function rankingsFirstKickoff(env, season, week) {
  const cachePath = `/rankings/kickoffs/${season}/${week}`;
  try {
    const { data } = await fbGet(env, cachePath);
    if (data && data.at) return { at: data.at, source: data.source, cached: true };
  } catch (e) { /* a cache read failure just means we resolve again */ }

  let resolved = null;

  // 1. the canonical schedule this site already publishes
  try {
    const r = await fetch(RANKINGS_SCHEDULE_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (r.ok) {
      const doc = await r.json();
      const games = (doc && doc.data && doc.data.games) || [];
      const kicks = games
        .filter(g => Number(g.season) === Number(season) && Number(g.week) === Number(week) && g.kickoff_at)
        .map(g => Date.parse(g.kickoff_at))
        .filter(t => Number.isFinite(t));
      if (kicks.length) resolved = { at: new Date(Math.min(...kicks)).toISOString(), source: "site-schedule" };
    }
  } catch (e) { /* fall through to ESPN */ }

  // 2. ESPN — the handoff's documented path, kept even though Worker egress is blocked
  if (!resolved) {
    const src = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
      + `?dates=${encodeURIComponent(season)}&seasontype=2&week=${encodeURIComponent(week)}`;
    for (const shape of FETCH_SHAPES) {
      try {
        const r = await fetch(src, { cf: { cacheTtl: 300, cacheEverything: true }, headers: shape.headers });
        if (!r.ok) continue;
        const raw = await r.json();
        const kicks = (raw.events || [])
          .map(ev => Date.parse(ev.date))
          .filter(t => Number.isFinite(t));
        if (kicks.length) { resolved = { at: new Date(Math.min(...kicks)).toISOString(), source: "espn" }; break; }
      } catch (e) { /* try the next shape, then give up */ }
    }
  }

  if (!resolved) return { at: null, source: null, cached: false };

  try {
    await fbPut(env, cachePath, { at: resolved.at, source: resolved.source, cached_at: new Date().toISOString() });
  } catch (e) { /* an uncached but resolved kickoff is still a valid gate */ }
  return { ...resolved, cached: false };
}

/* ----------------------------------------------------------------- the Thursday OUT list --
 * WHAT HYGIENE IS COMPUTED FROM (spec §3, gap G1 resolved). "Officially OUT at capture
 * time" is a fact about Thursday, so it has to be recorded on Thursday — it cannot be
 * reconstructed from who failed to play on Sunday without blaming services for warmup
 * injuries nobody could have known about.
 *
 * Same shape as the kickoff cache, for the same reason: resolved ONCE per (season, week)
 * at the first snapshot attempt, cached at /rankings/out/{season}/{week}, and reused by
 * every later paste that Thursday. One Sleeper /players/nfl pull per week keeps to
 * Sleeper's own once-a-day guidance. A player ruled out BETWEEN the first and last paste
 * of the session is therefore missed — hygiene UNDERCOUNTS in that window, which is the
 * fair direction: it can fail to flag sloppiness, it can never invent it.
 *
 * Statuses counted: Out, IR, PUP, Sus — the ones that mean "will not play", knowable at
 * capture. Questionable and Doubtful are deliberately excluded: ranking a Questionable
 * player is a judgement call, not hygiene.
 *
 * A fetch failure returns null, is NEVER cached, and NEVER blocks the capture — losing a
 * week of hygiene is an annotation gap; losing a Thursday capture is unrecoverable.
 * This is public injury data from Sleeper, not paid content; storing it is fine. */
const RANKINGS_OUT_STATUSES = ["Out", "IR", "PUP", "Sus"];

async function rankingsOutList(env, season, week) {
  const cachePath = `/rankings/out/${season}/${week}`;
  try {
    const { data } = await fbGet(env, cachePath);
    if (data && Array.isArray(data.players)) return data.players;
  } catch (e) { /* a cache read failure just means we resolve again */ }

  let players = null;
  try {
    const r = await fetch(SLEEPER_PLAYERS_URL);
    if (r.ok) {
      const raw = await r.json();
      players = [];
      for (const [id, p] of Object.entries(raw || {})) {
        if (!p || typeof p !== "object") continue;
        if (!RANKINGS_POS.includes(String(p.position || ""))) continue;
        if (!RANKINGS_OUT_STATUSES.includes(String(p.injury_status || ""))) continue;
        const name = String(p.full_name || ((p.first_name || "") + " " + (p.last_name || "")).trim());
        players.push({ id, name, pos: String(p.position), status: String(p.injury_status) });
      }
    }
  } catch (e) { players = null; }

  if (players === null) return null;                     // failure is not cached
  try {
    await fbPut(env, cachePath, { players, stamped_at: new Date().toISOString() });
  } catch (e) { /* an uncached list is still a valid list */ }
  return players;
}

/* ----------------------------------------------------------------------------- CSV ---
 * Format (handoff §4):   pos,rank,player,team
 * One paste per entrant covering all four positions; ranks restart at 1 per position.
 *
 * Returns { rows, canonical, counts } or { errors: [{line,pos,rank,code}] }. Errors carry
 * coordinates and a code — never a player name (see the privacy invariant at the top).
 */
function rankingsParseCsv(csv) {
  const errors = [];
  const text = String(csv == null ? "" : csv).replace(/^﻿/, "");
  const lines = text.split(/\r\n|\r|\n/);
  const rows = [];
  const seen = new Map();          // pos → Set(normalized name+team), for duplicate detection

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const t = line.trim();
    if (!t) return;
    // an optional header, tolerated because the admin page shows the format above the box
    if (i === 0 && /^pos\s*,\s*rank\s*,\s*player\s*,\s*team$/i.test(t)) return;

    const parts = t.split(",");
    if (parts.length < 4) { errors.push({ line: lineNo, code: "fields" }); return; }

    const pos = String(parts[0]).trim().toUpperCase();
    const rankRaw = String(parts[1]).trim();
    const team = String(parts[parts.length - 1]).trim().toUpperCase();
    const player = parts.slice(2, -1).join(",").trim();   // a name may legally contain a comma

    if (!RANKINGS_POS.includes(pos)) { errors.push({ line: lineNo, code: "pos" }); return; }
    if (!/^\d+$/.test(rankRaw)) { errors.push({ line: lineNo, pos, code: "rank" }); return; }
    const rank = Number(rankRaw);
    if (rank < 1) { errors.push({ line: lineNo, pos, rank, code: "rank" }); return; }
    if (!player) { errors.push({ line: lineNo, pos, rank, code: "player" }); return; }
    if (!/^[A-Z]{2,4}$/.test(team)) { errors.push({ line: lineNo, pos, rank, code: "team" }); return; }

    const key = rankingsNormName(player) + "|" + team;
    if (!seen.has(pos)) seen.set(pos, new Set());
    if (seen.get(pos).has(key)) { errors.push({ line: lineNo, pos, rank, code: "duplicate" }); return; }
    seen.get(pos).add(key);

    rows.push({ pos, rank, name: player, team });
  });

  if (errors.length) return { errors };

  // ranks contiguous 1..n per position, and deep enough to grade
  const counts = {};
  for (const pos of RANKINGS_POS) {
    const at = rows.filter(r => r.pos === pos).map(r => r.rank).sort((a, b) => a - b);
    counts[pos] = at.length;
    if (!at.length) { errors.push({ pos, code: "missing_position" }); continue; }
    for (let i = 0; i < at.length; i++) {
      if (at[i] !== i + 1) { errors.push({ pos, rank: at[i], code: "not_contiguous" }); break; }
    }
    if (at.length < RANKINGS_DEPTHS[pos])
      errors.push({ pos, code: "too_shallow", got: at.length, need: RANKINGS_DEPTHS[pos] });
  }
  if (errors.length) return { errors };

  /* The idempotency key. Sorting by (pos, rank) means re-pasting the same list with the
   * positions in a different order is correctly recognised as the same content rather
   * than rejected as a conflicting rewrite. Case and spacing are normalized; the player's
   * own capitalisation is preserved because it is what gets stored. */
  const canonical = rows
    .slice()
    .sort((a, b) => (RANKINGS_POS.indexOf(a.pos) - RANKINGS_POS.indexOf(b.pos)) || (a.rank - b.rank))
    .map(r => `${r.pos},${r.rank},${r.name.replace(/\s+/g, " ")},${r.team}`)
    .join("\n");

  return { rows, canonical, counts };
}

/* -------------------------------------------------------------------------- registry --*/
const RANKINGS_ID_RE = /^[A-Z0-9_]{2,16}$/;
const RANKINGS_TYPES = ["service", "house"];

function rankingsAutoColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return RANKINGS_PALETTE[h % RANKINGS_PALETTE.length];
}

async function rankingsEntrants(env) {
  const { data } = await fbGet(env, "/rankings/entrants");
  return data || {};
}

async function rankingsEntrantsList(request, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);
  return json({ ok: true, entrants: await rankingsEntrants(env) }, 200, cors);
}

async function rankingsEntrantCreate(request, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);

  let body;
  try { body = await rankingsReadBody(request); }
  catch (e) { return json({ error: "bad body" }, 400, cors); }

  const id = String(body.id || "").trim().toUpperCase();
  const name = String(body.name || "").trim();
  const type = String(body.type || "").trim().toLowerCase();
  const firstWeek = Number(body.first_week);

  if (!RANKINGS_ID_RE.test(id)) return json({ error: "bad id" }, 400, cors);
  if (!name || name.length > 40) return json({ error: "bad name" }, 400, cors);
  if (!RANKINGS_TYPES.includes(type)) return json({ error: "bad type" }, 400, cors);
  if (!Number.isInteger(firstWeek) || firstWeek < 0 || firstWeek > 18)
    return json({ error: "bad first_week" }, 400, cors);
  const color = body.color ? String(body.color).trim() : rankingsAutoColor(id);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return json({ error: "bad color" }, 400, cors);

  const { data, etag } = await fbGet(env, "/rankings/entrants", true);
  const reg = data || {};
  if (reg[id]) return json({ error: "entrant exists", id }, 409, cors);

  reg[id] = { name, type, first_week: firstWeek, color, registered_at: new Date().toISOString() };
  const wrote = await fbPut(env, "/rankings/entrants", reg, etag);
  if (!wrote) return json({ error: "registry changed under us, retry" }, 409, cors);

  const logged = await rankingsLog(env, { action: "entrant_add", entrant: id, detail: { name, type, first_week: firstWeek, color } });
  return json({ ok: true, id, entrant: reg[id], logged }, 200, cors);
}

/* Only name and colour are mutable. id, type and first_week are what comparability is
 * computed from — changing first_week after the fact would silently rewrite which weeks
 * an entrant is judged on. */
async function rankingsEntrantUpdate(request, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);

  let body;
  try { body = await rankingsReadBody(request); }
  catch (e) { return json({ error: "bad body" }, 400, cors); }

  const id = String(body.id || "").trim().toUpperCase();
  const { data, etag } = await fbGet(env, "/rankings/entrants", true);
  const reg = data || {};
  if (!reg[id]) return json({ error: "unknown entrant", id }, 404, cors);

  const next = { ...reg[id] };
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name || name.length > 40) return json({ error: "bad name" }, 400, cors);
    next.name = name;
  }
  if (body.color !== undefined) {
    const color = String(body.color).trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return json({ error: "bad color" }, 400, cors);
    next.color = color;
  }
  reg[id] = next;
  const wrote = await fbPut(env, "/rankings/entrants", reg, etag);
  if (!wrote) return json({ error: "registry changed under us, retry" }, 409, cors);

  const logged = await rankingsLog(env, { action: "entrant_update", entrant: id, detail: { name: next.name, color: next.color } });
  return json({ ok: true, id, entrant: next, logged }, 200, cors);
}

/* -------------------------------------------------------------------------- snapshot --*/
function rankingsActiveCapture(captures) {
  for (const [id, c] of Object.entries(captures || {})) {
    if (c && c.voided !== true) return { id, capture: c };
  }
  return null;
}

async function rankingsSnapshot(request, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);

  let body;
  try { body = await rankingsReadBody(request); }
  catch (e) { return json({ error: "bad body" }, 400, cors); }

  const season = Number(body.season);
  const week = Number(body.week);
  const entrant = String(body.entrant || body.service || "").trim().toUpperCase();

  if (!Number.isInteger(season) || season < 0) return json({ error: "bad season" }, 400, cors);
  if (!Number.isInteger(week) || week < 1 || week > 18) return json({ error: "bad week" }, 400, cors);
  if (!RANKINGS_ID_RE.test(entrant)) return json({ error: "bad entrant" }, 400, cors);

  const reg = await rankingsEntrants(env);
  if (!reg[entrant]) return json({ error: "unknown entrant", entrant }, 404, cors);
  if (season !== 0 && week < Number(reg[entrant].first_week))
    return json({ error: "week precedes entrant first_week", entrant, first_week: reg[entrant].first_week }, 400, cors);

  const parsed = rankingsParseCsv(body.csv);
  if (parsed.errors) {
    await rankingsLog(env, { action: "snapshot_reject", entrant, season, week, detail: { reason: "invalid_csv", count: parsed.errors.length } });
    return json({ error: "invalid csv", errors: parsed.errors.slice(0, 25) }, 400, cors);
  }

  const sha256 = await sha256hex(parsed.canonical);
  const capturedAt = new Date().toISOString();          // SERVER time, never the client's

  /* Season 0 is the Stage E sandbox: it has no real kickoff and is excluded from the
   * public doc, so the gate does not apply to it. Every other season is gated. */
  let kickoffCheck = "sandbox";
  let kickoffAt = null;
  if (season !== 0) {
    const ko = await rankingsFirstKickoff(env, season, week);
    kickoffAt = ko.at;
    if (!ko.at) {
      kickoffCheck = "deferred";                        // trap #5 — verified again at grade time
    } else if (Date.parse(capturedAt) >= Date.parse(ko.at)) {
      await rankingsLog(env, { action: "snapshot_reject", entrant, season, week, detail: { reason: "late", kickoff_at: ko.at, captured_at: capturedAt } });
      return json({ error: "late — first kickoff has passed", kickoff_at: ko.at, captured_at: capturedAt }, 409, cors);
    } else {
      kickoffCheck = "verified";
    }
  }

  const path = `/rankings/snapshots/${season}/${week}/${entrant}`;
  const { data, etag } = await fbGet(env, path, true);
  const captures = data || {};
  const active = rankingsActiveCapture(captures);

  if (active) {
    /* Identical content is a no-op that returns the ORIGINAL receipt — re-pasting because
     * the phone lost signal must not look like a second capture. */
    if (active.capture.sha256 === sha256) {
      return json({
        ok: true, idempotent: true,
        receipt: {
          season, week, entrant, capture_id: active.id,
          captured_at: active.capture.captured_at, sha256: active.capture.sha256,
          kickoff_check: active.capture.kickoff_check, counts: active.capture.counts,
        },
      }, 200, cors);
    }
    await rankingsLog(env, { action: "snapshot_reject", entrant, season, week, detail: { reason: "immutable", existing: active.id } });
    return json({
      error: "a snapshot already exists for this entrant and week; void it first",
      capture_id: active.id, captured_at: active.capture.captured_at,
    }, 409, cors);
  }

  /* The Thursday OUT list, stamped with the capture (G1). null = source was down; the
   * capture proceeds and that week's hygiene honestly reads null instead of 0. */
  const outList = season === 0 ? [] : await rankingsOutList(env, season, week);

  const captureId = "c" + Date.parse(capturedAt).toString(36) + "-" + sha256.slice(0, 8);
  captures[captureId] = {
    rows: parsed.rows,                                  // PRIVATE — never leaves this Worker
    captured_at: capturedAt,
    sha256,
    out_at_capture: outList === null ? null : outList.map(o => o.id),
    source_label: String(body.source_label || "").trim().slice(0, 60) || null,
    kickoff_check: kickoffCheck,
    kickoff_at: kickoffAt,
    counts: parsed.counts,
    voided: false,
  };

  const wrote = await fbPut(env, path, captures, etag);
  if (!wrote) return json({ error: "snapshot changed under us, retry" }, 409, cors);

  const logged = await rankingsLog(env, {
    action: "snapshot", entrant, season, week,
    detail: { capture_id: captureId, sha256, kickoff_check: kickoffCheck, counts: parsed.counts },
  });

  return json({
    ok: true, idempotent: false, logged,
    receipt: {
      season, week, entrant, capture_id: captureId, captured_at: capturedAt,
      sha256, kickoff_check: kickoffCheck, kickoff_at: kickoffAt,
      counts: parsed.counts, rows: parsed.rows.length,
    },
  }, 200, cors);
}

/* ------------------------------------------------------------------------------ void --
 * Flags a capture; never removes one. Permitted after kickoff (a wrong capture should be
 * markable as wrong whenever it is noticed) — but the replacement paste is still gated,
 * so voiding late leaves the week with no active snapshot rather than a swapped one.
 */
async function rankingsVoid(request, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);

  let body;
  try { body = await rankingsReadBody(request); }
  catch (e) { return json({ error: "bad body" }, 400, cors); }

  const season = Number(body.season);
  const week = Number(body.week);
  const entrant = String(body.entrant || "").trim().toUpperCase();
  const captureId = String(body.capture_id || "").trim();
  const reason = String(body.reason || "").trim().slice(0, 200);

  if (!Number.isInteger(season) || season < 0) return json({ error: "bad season" }, 400, cors);
  if (!Number.isInteger(week) || week < 1 || week > 18) return json({ error: "bad week" }, 400, cors);
  if (!RANKINGS_ID_RE.test(entrant)) return json({ error: "bad entrant" }, 400, cors);
  if (!captureId) return json({ error: "capture_id required" }, 400, cors);
  if (!reason) return json({ error: "reason required" }, 400, cors);

  const path = `/rankings/snapshots/${season}/${week}/${entrant}`;
  const { data, etag } = await fbGet(env, path, true);
  const captures = data || {};
  if (!captures[captureId]) return json({ error: "unknown capture", capture_id: captureId }, 404, cors);
  if (captures[captureId].voided === true) return json({ error: "already voided", capture_id: captureId }, 409, cors);

  captures[captureId] = {
    ...captures[captureId],
    voided: true,
    voided_at: new Date().toISOString(),
    void_reason: reason,
  };
  const wrote = await fbPut(env, path, captures, etag);
  if (!wrote) return json({ error: "snapshot changed under us, retry" }, 409, cors);

  const logged = await rankingsLog(env, { action: "void", entrant, season, week, detail: { capture_id: captureId, reason } });
  return json({ ok: true, capture_id: captureId, voided_at: captures[captureId].voided_at, logged }, 200, cors);
}

/* ---------------------------------------------------------------------------- status --
 * Feeds the admin page's per-week capture strip (captured ✓ / missing / voided). Derived
 * counts and hashes only — no rows, so the strip can render without the paid content ever
 * being sent to a browser.
 */
async function rankingsStatus(request, url, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);

  const season = Number(url.searchParams.get("season"));
  const week = Number(url.searchParams.get("week"));
  if (!Number.isInteger(season) || season < 0) return json({ error: "bad season" }, 400, cors);
  if (!Number.isInteger(week) || week < 1 || week > 18) return json({ error: "bad week" }, 400, cors);

  const reg = await rankingsEntrants(env);
  const { data } = await fbGet(env, `/rankings/snapshots/${season}/${week}`);
  const byEntrant = data || {};

  const entrants = Object.entries(reg).map(([id, e]) => {
    const captures = byEntrant[id] || {};
    const active = rankingsActiveCapture(captures);
    const voided = Object.values(captures).filter(c => c && c.voided === true).length;
    return {
      id, name: e.name, type: e.type, color: e.color, first_week: e.first_week,
      state: active ? "captured" : (voided ? "voided" : "missing"),
      capture_id: active ? active.id : null,
      captured_at: active ? active.capture.captured_at : null,
      sha256: active ? active.capture.sha256 : null,
      kickoff_check: active ? active.capture.kickoff_check : null,
      counts: active ? active.capture.counts : null,
      voided_count: voided,
    };
  });

  const ko = season === 0 ? { at: null, source: "sandbox" } : await rankingsFirstKickoff(env, season, week);
  return json({ ok: true, season, week, first_kickoff: ko.at, kickoff_source: ko.source, entrants }, 200, cors);
}

async function handleRankings(request, url, env, cors) {
  const p = url.pathname;
  if (p === "/rankings/entrants") {
    if (request.method === "GET")   return rankingsEntrantsList(request, env, cors);
    if (request.method === "POST")  return rankingsEntrantCreate(request, env, cors);
    if (request.method === "PATCH") return rankingsEntrantUpdate(request, env, cors);
    return json({ error: "method not allowed" }, 405, cors);
  }
  if (p === "/rankings/snapshot" && request.method === "POST") return rankingsSnapshot(request, env, cors);
  if (p === "/rankings/void"     && request.method === "POST") return rankingsVoid(request, env, cors);
  if (p === "/rankings/status"   && request.method === "GET")  return rankingsStatus(request, url, env, cors);
  if (p === "/rankings/grade"    && request.method === "POST") return rankingsGrade(request, env, cors);
  if (p === "/rankings/aliases"  && request.method === "POST") return rankingsAliasAdd(request, env, cors);
  // ⚠️ THE ONLY PUBLIC ROUTE IN THIS FEATURE. Everything above is admin-gated; this one
  // serves derived scores to the page and to nobody's detriment. Adding a second public
  // route here means re-reading spec §1 first — assemble.mjs keeps an explicit allowlist.
  if (p === "/rankings/grades"   && request.method === "GET")  return rankingsGrades(request, url, env, cors);
  return json({ error: "not found" }, 404, cors);
}

/* The Dog Track — grading half (Stage B): stats, matching, metrics, publication.
 *
 * ⚠️ EDIT THIS FILE, NEVER THE ASSEMBLED WORKER. It is concatenated with
 * rankings-block.js into the DD-RANKINGS-BLOCK region by work/assemble.mjs.
 *
 * ⚠️ THE METHODOLOGY IS PRE-REGISTERED (spec §3) AND THIS FILE IMPLEMENTS IT LITERALLY.
 * Three metrics, no fourth. The depths, the G values, the 2,000 bootstrap draws, the 0.7
 * shrinkage, the grade cutoffs and the tie rule are all spec constants, not tuning knobs.
 * The page publishes §3 verbatim before Week 1; changing a number here after that is an
 * amendment that owes the reader a dated note saying what changed and why.
 *
 * WHAT PUBLISHES AND WHAT DOES NOT
 * /rankings/graded/{season}/{week} and the snapshots stay private: they are derived from
 * paid inputs at player level. /rankings/public/{season} carries scores only, and
 * GET /rankings/grades is the single public read in this entire feature. The unmatched
 * review list DOES carry player names — it is returned from the admin-only grade route,
 * because adding an alias requires seeing the name — and the public doc carries only the
 * count, as excluded_unmatched.
 */

const RANKINGS_G = { RB: 12, WR: 12, QB: 6, TE: 6 };            // capture-rate group size, §3
const RANKINGS_STARTABLE = { RB: 24, WR: 24, QB: 12, TE: 12 };  // hygiene window, §3
const RANKINGS_BOOTSTRAP_DRAWS = 2000;
const RANKINGS_SHRINK_K = 0.7;
const RANKINGS_EB_FROM_WEEK = 10;
const RANKINGS_MIN_WEEKS = 4;                                   // provisional + matched-week floor
const RANKINGS_METHOD_VERSION = "1.0";
const RANKINGS_SLEEPER_STATS = "https://api.sleeper.app/v1/stats/nfl/regular";

/* ============================================================== rank arithmetic ==== */

/* Mid-ranks for ties (§3: "actual finish = within-position rank by PPR points, mid-ranks
 * for ties"). Two players tied for 3rd both get 3.5, and the next player gets 5 — the
 * positions are consumed, not compressed. Feeding competition ranks (3,3,5) or dense
 * ranks (3,3,4) into Spearman instead would quietly bias every tied week. */
function rankingsMidRanks(scores) {
  const order = scores.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const ranks = new Array(scores.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const mid = ((i + 1) + (j + 1)) / 2;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = mid;
    i = j + 1;
  }
  return ranks;
}

function rankingsPearson(a, b) {
  const n = a.length;
  if (n < 2) return null;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da === 0 || db === 0) return null;      // a constant vector has no correlation
  return num / Math.sqrt(da * db);
}

/* Spearman ρ IS Pearson on the rank vectors. Both inputs here are already mid-ranks, so
 * this is the tie-corrected form rather than the 1 - 6Σd²/n(n²-1) shortcut, which is only
 * valid without ties. */
const rankingsSpearman = (serviceRanks, actualRanks) => rankingsPearson(serviceRanks, actualRanks);

/* Weighted Kendall τ, §3: "hyperbolic weights on actual-finish rank (scipy weightedtau
 * semantics; implement in JS: additive hyperbolic weighting, w(r)=1/(r+1))".
 *
 * Pair weight is additive — w(r_i) + w(r_j) — so a pair involving the actual RB1 carries
 * far more than a pair of week-long benchwarmers. r is the 1-based actual finish rank
 * exactly as §3 writes it, so the actual winner weighs 1/2. A tied pair contributes 0 to
 * the numerator and its full weight to the denominator (tau-a treatment of ties). */
function rankingsWeightedTau(serviceRanks, actualRanks) {
  const n = serviceRanks.length;
  if (n < 2) return null;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = 1 / (actualRanks[i] + 1) + 1 / (actualRanks[j] + 1);
      num += w * Math.sign(serviceRanks[j] - serviceRanks[i]) * Math.sign(actualRanks[j] - actualRanks[i]);
      den += w;
    }
  }
  return den === 0 ? null : num / den;
}

/* Capture rate, §3: points scored by the service's top-G group ÷ points scored by the
 * actual top-G group. Computed on the service's list as pasted — a top-12 RB who did not
 * play contributes 0 and correctly costs the service, which is the whole point of the
 * "money view". This is why it runs on the full ranked list rather than the
 * inactive-stripped correlation pool. */
function rankingsCaptureRate(entrantRanked, pointsOf, actualPool, G) {
  const topG = entrantRanked.slice().sort((a, b) => a.rank - b.rank).slice(0, G);
  const got = topG.reduce((s, r) => s + (pointsOf(r.key) || 0), 0);
  const best = actualPool.slice().sort((a, b) => b.points - a.points).slice(0, G)
    .reduce((s, p) => s + p.points, 0);
  if (!best) return null;
  return (got / best) * 100;
}

/* ⚠️ SEEDED, DELIBERATELY. The public season doc is rebuilt from the immutable graded rows
 * at every grade run. With Math.random the same unchanged week would print a slightly
 * different CI on every rebuild, and a number that moves when nothing happened is a number
 * a reader is right to distrust. The seed is derived from (season, scope, entrant), so a
 * rebuild reproduces the interval exactly and a genuinely new week changes it. */
function rankingsSeedFrom(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rankingsPrng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Bootstrap 95% CI on the season mean: resample weeks with replacement, 2,000 draws,
 * percentile method (§3). One week cannot produce an interval and must not pretend to —
 * a CI of width zero implying certainty is trap #11's failure mode. */
function rankingsBootstrapCI(weekly, seedStr) {
  const vals = weekly.filter(v => Number.isFinite(v));
  if (vals.length < 2) return null;
  const rnd = rankingsPrng(rankingsSeedFrom(seedStr));
  const means = new Array(RANKINGS_BOOTSTRAP_DRAWS);
  for (let d = 0; d < RANKINGS_BOOTSTRAP_DRAWS; d++) {
    let s = 0;
    for (let i = 0; i < vals.length; i++) s += vals[Math.floor(rnd() * vals.length)];
    means[d] = s / vals.length;
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * RANKINGS_BOOTSTRAP_DRAWS)],
          means[Math.ceil(0.975 * RANKINGS_BOOTSTRAP_DRAWS) - 1]];
}

const rankingsMean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
function rankingsVariance(a) {
  if (a.length < 2) return 0;
  const m = rankingsMean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
}

/* Shrinkage, §3. Before Week 10 it is the declared flat 0.7. From Week 10 the
 * empirical-Bayes weight is used where it is computable: w = var_between /
 * (var_between + var_within/n). var_between is the spread of entrant means with the
 * portion attributable to within-entrant noise removed, floored at zero — a negative
 * between-variance estimate means the field is indistinguishable, and the honest response
 * is to shrink everything to the field mean rather than to report a negative weight. */
function rankingsShrinkWeights(perEntrantWeekly, week) {
  const series = Object.values(perEntrantWeekly).filter(w => w.length >= 1);
  if (week < RANKINGS_EB_FROM_WEEK || series.length < 2) {
    return { mode: "fixed-0.7", weightFor: () => RANKINGS_SHRINK_K };
  }
  const means = series.map(w => rankingsMean(w));
  const withins = series.filter(w => w.length >= 2).map(w => rankingsVariance(w));
  if (!withins.length) return { mode: "fixed-0.7", weightFor: () => RANKINGS_SHRINK_K };
  const varWithin = rankingsMean(withins);
  const nBar = rankingsMean(series.map(w => w.length));
  const varBetween = Math.max(0, rankingsVariance(means) - varWithin / nBar);
  if (varBetween === 0) return { mode: "empirical-bayes", weightFor: () => 0 };
  return {
    mode: "empirical-bayes",
    weightFor: n => varBetween / (varBetween + varWithin / Math.max(1, n)),
  };
}

/* Letter grades, §3: blended percentile of the three metrics vs. the field per scope.
 * A metric the field cannot supply (an all-null hygiene column, say) is dropped from the
 * blend rather than scored as zero. */
function rankingsPercentile(value, field) {
  const vals = field.filter(v => Number.isFinite(v));
  if (!vals.length || !Number.isFinite(value)) return null;
  if (vals.length === 1) return 50;
  const below = vals.filter(v => v < value).length;
  const equal = vals.filter(v => v === value).length;
  return ((below + 0.5 * equal) / vals.length) * 100;
}
function rankingsLetter(p) {
  if (p >= 90) return "A";
  if (p >= 80) return "A−";
  if (p >= 70) return "B+";
  if (p >= 60) return "B";
  if (p >= 50) return "B−";
  if (p >= 40) return "C+";
  return "C";
}

/* ============================================================= name matching ======= */

/* THE ALIAS KEY FORMAT, which aliases.csv must mirror exactly (spec §8.5 contract #2).
 * Two accepted shapes, tried in this order:
 *     "<normalized name>|<TEAM>|<POS>"   → player_id      (most specific)
 *     "<normalized name>|<POS>"          → player_id      (team-independent)
 * The team-independent form exists because a trade is the common reason a Thursday paste
 * disagrees with the player index, and re-aliasing every traded player every week would
 * guarantee the map rots. Normalization is rankingsNormName — the ONE shared spec.
 */
const rankingsAliasKeys = (norm, team, pos) => [`${norm}|${team}|${pos}`, `${norm}|${pos}`];

function rankingsPlayerIndex(slim) {
  const byTriple = new Map(), byNamePos = new Map();
  for (const [id, row] of Object.entries(slim || {})) {
    const [name, pos, team] = row;
    const norm = rankingsNormName(name);
    if (!norm || !pos) continue;
    byTriple.set(`${norm}|${String(team || "")}|${pos}`, id);
    const np = `${norm}|${pos}`;
    if (!byNamePos.has(np)) byNamePos.set(np, []);
    byNamePos.get(np).push(id);
  }
  return { byTriple, byNamePos };
}

/* ⚠️ TRAP #1 LIVES HERE — name matching is the failure mode of this entire feature.
 * Exact on (normalized name + team + pos), then the alias map, then FAIL LOUDLY. There is
 * deliberately no fuzzy fallback: a wrong merge corrupts a graded row that is immutable by
 * design, and an edit-distance match between two real players is indistinguishable from a
 * correct one at review time. Unmatched rows are excluded from the week and surfaced to
 * the admin with a suggestion, which is how the alias map grows. */
function rankingsMatchRow(row, index, aliases) {
  const norm = rankingsNormName(row.name);
  const triple = `${norm}|${row.team}|${row.pos}`;
  if (index.byTriple.has(triple)) return { id: index.byTriple.get(triple), via: "exact" };

  for (const key of rankingsAliasKeys(norm, row.team, row.pos)) {
    const id = aliases && aliases[key];
    if (id) return { id: String(id), via: "alias" };
  }

  // Unique on name+pos but the team disagrees: almost always a trade. NOT auto-matched —
  // it is offered to the admin as a one-click alias instead.
  const np = index.byNamePos.get(`${norm}|${row.pos}`) || [];
  const suggestion = np.length === 1 ? np[0] : null;
  return { id: null, via: "unmatched", suggestion, alias_key: `${norm}|${row.pos}` };
}

/* ============================================================= stats fetching ===== */

/* Source order per §4: Sleeper first, ESPN as the fallback.
 * ⚠️ The ESPN leg will almost certainly fail from Worker egress — this Worker documents at
 * /scores (8/4/26) that ESPN 403s Cloudflare IPs across every header shape. It is
 * implemented because the spec names it and because the block is not the right place to
 * decide the spec is wrong, but a grade run that reaches it should be read as "Sleeper is
 * down", not as "we have a second working source". Same finding as deviation D1. */
async function rankingsFetchStats(season, week) {
  try {
    const r = await fetch(`${RANKINGS_SLEEPER_STATS}/${season}/${week}`, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (r.ok) {
      const raw = await r.json();
      if (raw && typeof raw === "object" && Object.keys(raw).length) return { stats: raw, source: "sleeper" };
    }
  } catch (e) { /* fall through */ }

  for (const shape of FETCH_SHAPES) {
    try {
      const r = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}`,
        { cf: { cacheTtl: 300, cacheEverything: true }, headers: shape.headers });
      if (!r.ok) continue;
      await r.json();
      // ESPN's scoreboard does not carry per-player PPR; reaching here means Sleeper is
      // down and the run cannot be graded honestly. Refuse rather than invent a number.
      return { stats: null, source: "espn-unusable" };
    } catch (e) { /* try the next shape */ }
  }
  return { stats: null, source: null };
}

/* Did a player actually play? §3 removes inactives, byes and ruled-OUT players from the
 * correlation pool — but NOT a player who suited up and scored zero, who is a genuine
 * ranking miss and must keep costing the service that ranked him. Sleeper omits the row
 * entirely for a player who did not appear, and carries gp on those who did. */
function rankingsPlayed(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.gp !== undefined) return Number(entry.gp) > 0;
  return Object.keys(entry).length > 0;
}
const rankingsPprOf = entry => (entry && Number.isFinite(Number(entry.pts_ppr)) ? Number(entry.pts_ppr) : 0);

/* ============================================================ the weekly grade ==== */

/* BLEND membership freezes at Week 1 and is written once (§3: "a mutating benchmark
 * corrupts comparability"). Recomputing it every week from the live registry would quietly
 * admit every mid-season entrant into the benchmark that all the relative-to-field numbers
 * are measured against, which is the same class of error as a moving goalpost. */
async function rankingsBlendMembers(env, season, entrants, dryRun) {
  const path = `/rankings/blend/${season}`;
  const { data } = await fbGet(env, path);
  if (data && Array.isArray(data.members)) return data;

  const members = Object.entries(entrants)
    .filter(([, e]) => e.type === "service" && Number(e.first_week) <= 1)
    .map(([id]) => id)
    .sort();
  const frozen = { members, frozen_at_week: 1, frozen_at: new Date().toISOString() };
  if (!dryRun) {
    try { await fbPut(env, path, frozen); } catch (e) { /* a failed freeze retries next run */ }
  }
  return frozen;
}

/* Imputation for a player the entrant did not rank (§3: "slot at that service's deepest
 * ranked player + 1, ties broken by consensus order").
 *
 * ⚠️ INTERPRETATION I1, recorded in the spec. "Ties broken by consensus order" is read as
 * assigning consecutive slots — deepest+1, deepest+2, … in consensus order — rather than
 * giving every unranked player the identical value deepest+1 and mid-ranking the block.
 * The two readings agree on ordering and differ in how hard the unranked tail pulls on ρ.
 * Consecutive slots is the reading that actually breaks the tie, which is what the text
 * says. Raised for ratification rather than assumed. */
function rankingsEntrantRanks(pool, rankedByKey, consensusRank) {
  const deepest = Math.max(0, ...Object.values(rankedByKey));
  const unranked = pool.filter(k => rankedByKey[k] === undefined)
    .sort((a, b) => (consensusRank[a] ?? Infinity) - (consensusRank[b] ?? Infinity));
  const imputed = {};
  unranked.forEach((k, i) => { imputed[k] = deepest + 1 + i; });
  return pool.map(k => (rankedByKey[k] !== undefined ? rankedByKey[k] : imputed[k]));
}

/* Hygiene (§3, G1 resolved): count the players who were officially OUT at capture time yet
 * sat inside the startable range of that entrant's list. Never touches the correlation.
 *
 * The OUT list is stamped onto the capture on Thursday as Sleeper player ids
 * (rankingsOutList — statuses Out/IR/PUP/Sus, once per week, undercount-safe), and the
 * ranked rows arriving here are the MATCHED rows, already carrying their ids — so this is
 * a set lookup, not a second name-matching pass that could disagree with the first.
 * A capture whose OUT fetch failed carries null and that week's hygiene honestly reads
 * null: an annotation gap is not a clean record, and it is never rendered as 0. */
function rankingsHygiene(capture, ranked, pos) {
  const out = capture && capture.out_at_capture;
  if (!Array.isArray(out)) return null;
  const outSet = new Set(out);
  const window = RANKINGS_STARTABLE[pos];
  return ranked.filter(r => r.rank <= window && outSet.has(r.key)).length;
}

function rankingsGradeWeek({ captures, entrants, stats, index, aliases, blendMembers }) {
  const unmatched = [];
  const positions = {};

  // player_id -> PPR points, and the per-position actual boards, from the stats source
  const pointsOf = id => rankingsPprOf(stats[id]);
  const playedOf = id => rankingsPlayed(stats[id]);

  const actualByPos = {};
  for (const pos of RANKINGS_POS) actualByPos[pos] = [];
  for (const [id, row] of Object.entries(index.slim || {})) {
    const pos = row[1];
    if (!RANKINGS_POS.includes(pos)) continue;
    if (!playedOf(id)) continue;
    actualByPos[pos].push({ key: id, points: pointsOf(id) });
  }

  // match every entrant's rows once, up front
  const matched = {};
  for (const [eid, cap] of Object.entries(captures)) {
    matched[eid] = { byPos: {}, capture: cap };
    for (const pos of RANKINGS_POS) matched[eid].byPos[pos] = [];
    for (const row of cap.rows || []) {
      const m = rankingsMatchRow(row, index, aliases);
      if (!m.id) {
        unmatched.push({ entrant: eid, pos: row.pos, rank: row.rank, name: row.name, team: row.team,
                         suggestion: m.suggestion, alias_key: m.alias_key });
        continue;
      }
      matched[eid].byPos[row.pos].push({ key: m.id, rank: row.rank, name: row.name, team: row.team });
    }
  }

  for (const pos of RANKINGS_POS) {
    const depth = RANKINGS_DEPTHS[pos];

    // consensus = mean rank across the uploaded SERVICE entrants (§3)
    const serviceIds = Object.keys(captures).filter(id => entrants[id] && entrants[id].type === "service");
    const consensusAcc = {};
    for (const eid of serviceIds) {
      for (const r of matched[eid].byPos[pos]) {
        if (!consensusAcc[r.key]) consensusAcc[r.key] = [];
        consensusAcc[r.key].push(r.rank);
      }
    }
    const consensusRank = {};
    Object.entries(consensusAcc).forEach(([k, arr]) => { consensusRank[k] = rankingsMean(arr); });
    const consensusTop = Object.keys(consensusRank)
      .sort((a, b) => consensusRank[a] - consensusRank[b]).slice(0, depth);

    const actualTop = actualByPos[pos].slice().sort((a, b) => b.points - a.points)
      .slice(0, depth).map(p => p.key);

    // pool = union, minus anyone who did not play (§3 removes inactives from the correlation)
    const pool = [...new Set([...consensusTop, ...actualTop])].filter(playedOf);
    const actualRanks = rankingsMidRanks(pool.map(pointsOf));
    const actualPool = pool.map(k => ({ key: k, points: pointsOf(k) }));

    // BLEND's per-player mean rank across the frozen membership, using each member's own
    // imputation so a player one member skipped is not scored as if the field skipped him
    const blendPresent = blendMembers.filter(id => captures[id]);
    const blendRanked = [];
    if (blendPresent.length) {
      const universe = [...new Set(blendPresent.flatMap(id => matched[id].byPos[pos].map(r => r.key)))];
      const perMember = blendPresent.map(id => {
        const byKey = {};
        matched[id].byPos[pos].forEach(r => { byKey[r.key] = r.rank; });
        const vals = rankingsEntrantRanks(universe, byKey, consensusRank);
        return Object.fromEntries(universe.map((k, i) => [k, vals[i]]));
      });
      const means = universe.map(k => ({ key: k, mean: rankingsMean(perMember.map(m => m[k])) }));
      means.sort((a, b) => a.mean - b.mean);
      means.forEach((m, i) => blendRanked.push({ key: m.key, rank: i + 1, name: "", team: "" }));
    }

    const rows = {};
    const graders = Object.keys(captures).map(id => ({ id, ranked: matched[id].byPos[pos], cap: matched[id].capture }));
    if (blendRanked.length) graders.push({ id: "BLEND", ranked: blendRanked, cap: null });

    for (const g of graders) {
      const byKey = {};
      g.ranked.forEach(r => { byKey[r.key] = r.rank; });
      const serviceRanks = rankingsEntrantRanks(pool, byKey, consensusRank);
      rows[g.id] = {
        rho: pool.length >= 2 ? rankingsSpearman(serviceRanks, actualRanks) : null,
        tau: pool.length >= 2 ? rankingsWeightedTau(serviceRanks, actualRanks) : null,
        capture: rankingsCaptureRate(g.ranked, pointsOf, actualPool, RANKINGS_G[pos]),
        hygiene: g.cap ? rankingsHygiene(g.cap, g.ranked, pos) : null,
        ranked_n: g.ranked.length,
        imputed_n: pool.filter(k => byKey[k] === undefined).length,
      };
    }

    positions[pos] = { pool_size: pool.length, entrants: rows };
  }

  return { positions, unmatched };
}

/* ======================================================== season aggregation ====== */

/* Rebuilt from the immutable graded rows at every run — derivable, so rebuilding is safe
 * (§2). Everything below is a score; nothing player-level reaches this document. */
async function rankingsRebuildPublic(env, season, entrants, blend, dryRun) {
  const { data } = await fbGet(env, `/rankings/graded/${season}`);
  const gradedWeeks = Object.keys(data || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);

  const scopes = {};
  const weeks = {};
  const latestWeek = gradedWeeks.length ? gradedWeeks[gradedWeeks.length - 1] : 0;
  let excludedUnmatched = 0;

  const seriesFor = {};                       // scope -> entrant -> [weekly value]
  const perWeekMetric = {};                   // week -> scope -> entrant -> raw metrics

  for (const w of gradedWeeks) {
    const row = data[String(w)];
    excludedUnmatched += Number(row.excluded_unmatched || 0);
    perWeekMetric[w] = {};
    const ids = new Set();
    for (const pos of RANKINGS_POS) Object.keys((row.positions[pos] || {}).entrants || {}).forEach(i => ids.add(i));

    for (const pos of RANKINGS_POS) {
      perWeekMetric[w][pos] = {};
      for (const id of ids) {
        const m = ((row.positions[pos] || {}).entrants || {})[id];
        if (!m) continue;
        perWeekMetric[w][pos][id] = { rho: m.rho, tau: m.tau, capture: m.capture, hygiene: m.hygiene };
        for (const [metric, val] of [["rho", m.rho], ["tau", m.tau], ["capture", m.capture], ["hygiene", m.hygiene]]) {
          if (!Number.isFinite(val)) continue;
          seriesFor[pos] = seriesFor[pos] || {};
          seriesFor[pos][id] = seriesFor[pos][id] || {};
          seriesFor[pos][id][metric] = seriesFor[pos][id][metric] || [];
          seriesFor[pos][id][metric].push(val);
        }
      }
    }

    // ALL = equal-weight mean across the four positions (§3, a declared choice)
    perWeekMetric[w].ALL = {};
    for (const id of ids) {
      const pick = metric => {
        const vals = RANKINGS_POS.map(p => (perWeekMetric[w][p][id] || {})[metric]).filter(Number.isFinite);
        return vals.length === RANKINGS_POS.length ? rankingsMean(vals) : null;
      };
      const rho = pick("rho"), tau = pick("tau"), capture = pick("capture");
      /* Hygiene at the ALL scope is a SUM across positions, not a mean — it is a counter
       * (the mockup's hygOf does the same). A week whose OUT list was unavailable has all
       * four positions null and stays null rather than becoming a fake zero. */
      const hygVals = RANKINGS_POS.map(p => (perWeekMetric[w][p][id] || {}).hygiene).filter(Number.isFinite);
      const hygiene = hygVals.length ? hygVals.reduce((a, b) => a + b, 0) : null;
      perWeekMetric[w].ALL[id] = { rho, tau, capture, hygiene };
      if (Number.isFinite(hygiene)) {
        seriesFor.ALL = seriesFor.ALL || {};
        seriesFor.ALL[id] = seriesFor.ALL[id] || {};
        seriesFor.ALL[id].hygiene = seriesFor.ALL[id].hygiene || [];
        seriesFor.ALL[id].hygiene.push(hygiene);
      }
      for (const [metric, val] of [["rho", rho], ["tau", tau], ["capture", capture]]) {
        if (!Number.isFinite(val)) continue;
        seriesFor.ALL = seriesFor.ALL || {};
        seriesFor.ALL[id] = seriesFor.ALL[id] || {};
        seriesFor.ALL[id][metric] = seriesFor.ALL[id][metric] || [];
        seriesFor.ALL[id][metric].push(val);
      }
    }
    weeks[String(w)] = perWeekMetric[w];
  }

  for (const scope of ["ALL", ...RANKINGS_POS]) {
    const byEntrant = seriesFor[scope] || {};
    const ids = Object.keys(byEntrant);
    if (!ids.length) { scopes[scope] = {}; continue; }

    const rhoSeries = Object.fromEntries(ids.map(id => [id, byEntrant[id].rho || []]));
    const fieldMean = rankingsMean(ids.map(id => rankingsMean(rhoSeries[id])).filter(Number.isFinite));
    const shrink = rankingsShrinkWeights(rhoSeries, latestWeek);

    const rows = {};
    for (const id of ids) {
      const weekly = rhoSeries[id];
      const raw = rankingsMean(weekly);
      const w = shrink.weightFor(weekly.length);
      const shrunk = Number.isFinite(raw) && Number.isFinite(fieldMean) ? fieldMean + w * (raw - fieldMean) : null;

      // relative-to-field: this entrant's weekly ρ minus BLEND's that same week, over the
      // weeks THIS entrant was graded — the headline cross-entrant comparison (§3)
      let relative = null;
      const blendWeekly = [];
      const mineWeekly = [];
      for (const wk of gradedWeeks) {
        const mine = ((perWeekMetric[wk][scope] || {})[id] || {}).rho;
        const bl = ((perWeekMetric[wk][scope] || {}).BLEND || {}).rho;
        if (Number.isFinite(mine) && Number.isFinite(bl)) { mineWeekly.push(mine); blendWeekly.push(bl); }
      }
      if (mineWeekly.length) relative = rankingsMean(mineWeekly.map((v, i) => v - blendWeekly[i]));

      rows[id] = {
        rho: shrunk, rho_raw: raw,
        ci: rankingsBootstrapCI(weekly, `${season}|${scope}|${id}`),
        tau: rankingsMean(byEntrant[id].tau || []),
        capture: rankingsMean(byEntrant[id].capture || []),
        // season hygiene = the sum of the weeks that had an OUT list; null if none did
        hygiene: (byEntrant[id].hygiene || []).length
          ? (byEntrant[id].hygiene).reduce((a, b) => a + b, 0) : null,
        relative_to_field: relative,
        weeks_graded: weekly.length,
        weekly_rho: weekly,
        provisional: weekly.length < RANKINGS_MIN_WEEKS,
      };
    }

    // PHOTO FINISH (§3): tied with the leader if your CI upper ≥ the leader's CI lower
    const ranked = Object.entries(rows).filter(([, r]) => Number.isFinite(r.rho))
      .sort((a, b) => b[1].rho - a[1].rho);
    const leader = ranked.length ? ranked[0] : null;
    for (const [id, r] of Object.entries(rows)) {
      r.tied_with_leader = !!(leader && r.ci && leader[1].ci && r.ci[1] >= leader[1].ci[0]);
      if (leader && id === leader[0]) r.tied_with_leader = true;
    }

    // letter grades from the blended percentile of the three metrics vs. the field
    const field = m => Object.values(rows).map(r => r[m]);
    for (const [id, r] of Object.entries(rows)) {
      const ps = [rankingsPercentile(r.rho, field("rho")),
                  rankingsPercentile(r.tau, field("tau")),
                  rankingsPercentile(r.capture, field("capture"))].filter(Number.isFinite);
      r.grade = ps.length ? rankingsLetter(rankingsMean(ps)) : null;
    }
    // "Tied services display the leader's grade" (§3)
    if (leader && rows[leader[0]] && rows[leader[0]].grade) {
      for (const r of Object.values(rows)) if (r.tied_with_leader) r.grade = rows[leader[0]].grade;
    }
    scopes[scope] = rows;
  }

  const doc = {
    season,
    weeks_graded: gradedWeeks.length,
    scoring: "PPR",
    updated_at: new Date().toISOString(),
    method_version: RANKINGS_METHOD_VERSION,
    provisional: true,                        // stays true until the declared promotion gate
    shrinkage_mode: rankingsShrinkWeights(seriesFor.ALL || {}, latestWeek).mode,
    excluded_unmatched: excludedUnmatched,
    /* true the moment any graded week carried an OUT list. Stays false over weeks graded
     * before this capability shipped — those can never be backfilled (G1), and the page
     * renders their hygiene as "not tracked yet" rather than 0. */
    hygiene_tracked: Object.values(scopes).some(rows =>
      Object.values(rows).some(r => Number.isFinite(r.hygiene))),
    entrants: Object.fromEntries(Object.entries(entrants).map(([id, e]) => [id, {
      name: e.name, type: e.type, color: e.color, first_week: e.first_week,
      blend_member: (blend.members || []).includes(id),
    }])),
    blend: { members: blend.members || [], frozen_at_week: blend.frozen_at_week || 1 },
    scopes,
    weeks,
  };
  if (!dryRun) await fbPut(env, `/rankings/public/${season}`, doc);
  return doc;
}

/* ================================================================== the routes ==== */

async function rankingsGrade(request, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);

  let body;
  try { body = await rankingsReadBody(request); }
  catch (e) { return json({ error: "bad body" }, 400, cors); }

  const season = Number(body.season);
  const week = Number(body.week);
  const dryRun = body.dry_run === true;
  if (!Number.isInteger(season) || season < 0) return json({ error: "bad season" }, 400, cors);
  if (!Number.isInteger(week) || week < 1 || week > 18) return json({ error: "bad week" }, 400, cors);

  /* Write-once. A graded row is the record of what a service said BEFORE the games; a
   * re-grade is how that record silently becomes a record of something else. */
  const existing = await fbGet(env, `/rankings/graded/${season}/${week}`);
  if (existing.data && !dryRun)
    return json({ error: "week already graded — graded rows are immutable", graded_at: existing.data.graded_at }, 409, cors);

  const entrants = await rankingsEntrants(env);
  const { data: snapRaw } = await fbGet(env, `/rankings/snapshots/${season}/${week}`);
  const captures = {};
  const skipped = [];
  for (const [eid, caps] of Object.entries(snapRaw || {})) {
    const active = rankingsActiveCapture(caps);
    if (!active) { skipped.push({ entrant: eid, reason: "no_snapshot" }); continue; }

    /* Trap #5's other half: a capture accepted with kickoff_check "deferred" has never
     * actually been checked against a kickoff. Grade time is where that debt comes due —
     * verify now, and refuse the row if it turns out to have been late. */
    if (active.capture.kickoff_check === "deferred" && season !== 0) {
      const ko = await rankingsFirstKickoff(env, season, week);
      if (ko.at && Date.parse(active.capture.captured_at) >= Date.parse(ko.at)) {
        skipped.push({ entrant: eid, reason: "late_on_deferred_check", captured_at: active.capture.captured_at, kickoff_at: ko.at });
        await rankingsLog(env, { action: "grade_exclude", entrant: eid, season, week,
                                 detail: { reason: "late_on_deferred_check", capture_id: active.id } });
        continue;
      }
    }
    captures[eid] = active.capture;
  }

  if (!Object.keys(captures).length)
    return json({ error: "no gradeable snapshots for this week", skipped }, 400, cors);

  const { stats, source } = await rankingsFetchStats(season, week);
  if (!stats) return json({ error: "no usable stats source — refusing to grade", stats_source: source }, 502, cors);

  const slim = await rankingsSlimIndex(env);
  if (!slim) return json({ error: "player index unavailable — refusing to grade" }, 503, cors);
  const index = rankingsPlayerIndex(slim);
  index.slim = slim;

  const { data: aliases } = await fbGet(env, "/rankings/aliases");
  const blend = await rankingsBlendMembers(env, season, entrants, dryRun);

  const { positions, unmatched } = rankingsGradeWeek({
    captures, entrants, stats, index, aliases: aliases || {}, blendMembers: blend.members,
  });

  const row = {
    graded_at: new Date().toISOString(),
    stats_source: source,
    method_version: RANKINGS_METHOD_VERSION,
    excluded_unmatched: unmatched.length,
    entrants_graded: Object.keys(positions.RB ? positions.RB.entrants : {}),
    positions,
  };
  if (!dryRun) {
    await fbPut(env, `/rankings/graded/${season}/${week}`, row);
    await rankingsLog(env, { action: "grade", season, week,
                             detail: { stats_source: source, excluded_unmatched: unmatched.length } });
  }

  const doc = season === 0 && !dryRun
    ? null                                     // season 0 is the sandbox; it never publishes
    : await rankingsRebuildPublic(env, season, entrants, blend, dryRun || season === 0);

  return json({
    ok: true, dry_run: dryRun, season, week, stats_source: source,
    entrants_graded: row.entrants_graded, skipped,
    excluded_unmatched: unmatched.length,
    unmatched,                                 // admin-only: names are needed to add aliases
    weeks_graded: doc ? doc.weeks_graded : null,
  }, 200, cors);
}

/* The player index. Reuses the Worker's existing daily-cached slim copy rather than adding
 * a second index — Sleeper's own guidance is one /players/nfl pull per day, and two
 * independent caches would mean two different answers to "who is a WR". */
async function rankingsSlimIndex(env) {
  const kv = env.RL || null;
  if (kv) {
    try {
      const cached = await kv.get(SLEEPER_SLIM_KEY);
      if (cached) {
        const payload = JSON.parse(cached);
        if (payload && payload.data && payload.data.players) return payload.data.players;
      }
    } catch (e) { /* fall through to a live pull */ }
  }
  try {
    const r = await fetch(SLEEPER_PLAYERS_URL);
    if (!r.ok) return null;
    return sleeperSlimFromRaw(await r.json()).players;
  } catch (e) { return null; }
}

/* THE ONLY PUBLIC READ IN THIS FEATURE. Derived scores, entrant identity and the method
 * version — no player, no rank, no snapshot. Before Week 1 it answers with an honest empty
 * state rather than a 404, so the page can render "season opens Sep 10" from real data. */
async function rankingsGrades(request, url, env, cors) {
  const season = Number(url.searchParams.get("season") || new Date().getUTCFullYear());
  if (!Number.isInteger(season) || season < 0) return json({ error: "bad season" }, 400, cors);
  // ⚠️ Order matters: `season < 1` first would swallow 0 into a generic "bad season" and
  // leave this branch dead, which is exactly how it was written the first time.
  if (season === 0) return json({ error: "the sandbox season is not published" }, 404, cors);

  const { data } = await fbGet(env, `/rankings/public/${season}`);
  if (!data) {
    return json({
      season, weeks_graded: 0, scoring: "PPR", method_version: RANKINGS_METHOD_VERSION,
      provisional: true, empty: true,
      note: "No graded weeks yet. Methodology is pre-registered and published; receipts follow the first Tuesday grade run.",
      entrants: {}, scopes: {}, weeks: {},
    }, 200, cors);
  }
  return json(data, 200, cors);
}

/* The other half of trap #1's loop: the review list surfaces an unmatched name, this turns
 * it into an alias, and the next grade run matches it. Bulk form accepts the seed import
 * from the local pipeline's aliases.csv (§8.5 contract #2) through the same door — one
 * validation path, one audit trail, no special-case importer. */
async function rankingsAliasAdd(request, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);

  let body;
  try { body = await rankingsReadBody(request); }
  catch (e) { return json({ error: "bad body" }, 400, cors); }

  const incoming = Array.isArray(body.aliases) ? body.aliases
    : (body.key && body.player_id ? [{ key: body.key, player_id: body.player_id }] : null);
  if (!incoming || !incoming.length) return json({ error: "aliases required" }, 400, cors);
  if (incoming.length > 4000) return json({ error: "too many aliases in one call" }, 400, cors);

  const { data, etag } = await fbGet(env, "/rankings/aliases", true);
  const map = data || {};
  const added = [], rejected = [], conflicts = [];

  for (const a of incoming) {
    const key = String((a && a.key) || "").trim().toLowerCase();
    const pid = String((a && a.player_id) || "").trim();
    // key is "<normalized name>|<POS>" or "<normalized name>|<TEAM>|<POS>" — see rankingsAliasKeys
    if (!/^[^|]+\|[a-z]{2,4}(\|[a-z]{2,4})?$/.test(key) || !pid) { rejected.push({ key, reason: "bad_key" }); continue; }
    const norm = key.split("|");
    const canonical = [rankingsNormName(norm[0]), ...norm.slice(1).map(s => s.toUpperCase())].join("|");
    if (map[canonical] && map[canonical] !== pid) {
      // An alias that already points somewhere else is a corruption risk, not an update:
      // it would silently re-point a name that previous weeks were graded against.
      conflicts.push({ key: canonical, existing: map[canonical], proposed: pid });
      continue;
    }
    if (map[canonical] === pid) continue;
    map[canonical] = pid;
    added.push(canonical);
  }

  if (added.length) {
    const wrote = await fbPut(env, "/rankings/aliases", map, etag);
    if (!wrote) return json({ error: "alias map changed under us, retry" }, 409, cors);
    await rankingsLog(env, { action: "alias_add", detail: { count: added.length } });
  }
  return json({ ok: true, added: added.length, rejected, conflicts, total: Object.keys(map).length }, 200, cors);
}
/* ===== DD-RANKINGS-BLOCK END ===== */

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
/* ===== DD-FRONTIER START — generated from work/patch-dfs-frontier.py ===== */
/* ============================================================================
   PROJECTION vs RARITY — the exact convex frontier

   The tournament question this answers: to make a lineup rarer, how much projection do
   you have to give up? "Rarer" here is CUMULATIVE OWNERSHIP, the sum of the projected
   ownership of the players in it — the number this page already reports per lineup, and
   the one a field is measured in.

   The method is a Lagrangian sweep. For a weight L, solve the ordinary exact problem on
   proj[i] - L*own[i]. Whatever comes back is EXACTLY optimal for that weight, and it is
   a vertex of the upper convex hull of the achievable (own, proj) set. Probing L at the
   chord slope between two known vertices and recursing finds every vertex between them.

   ⚠️ IT IS THE HULL, NOT THE FRONTIER. A lineup sitting in a dent — beaten by the
   straight line between two hull vertices, but the best there is at its own ownership —
   is optimal for no weight L at all and cannot be found this way. No sweep of this kind
   can find one. `hull: true` rides on the result so the page has to say so.

   ⚠️ ONLY PROVED POINTS ARE PLOTTED. A solve that hits its slice of the clock returns
   the best lineup found so far, which is not the optimum and therefore not a vertex.
   Those are DISCARDED and `capped` goes true, rather than drawing an unproved point on
   a curve whose whole claim is exactness.

   ⚠️ THE RARE END IS THE EXPENSIVE END, and that is structural. Low ownership correlates
   with low salary, so "cheapest ownership while still spending the salary floor" sets
   the objective against the constraint and the salary-knapsack bound goes slack. On a
   full 13-game slate the max-projection solve is ~70ms and a large-L solve does not
   finish in 15s. So the sweep walks L UP only while probes keep succeeding, and stops.
   The curve then covers what was proved and says where it stopped.

   ⚠️ THE SHIFT IS NOT A FUDGE, BUT IT IS NOT FREE. proj[i] - L*own[i] goes negative for
   large L, and a non-positive projection means "no projection" everywhere else in this
   engine, which would silently empty the pool. A constant added to every eligible
   projection cannot change the winner, because every classic lineup holds exactly
   site.size players. (That is also why showdown is refused rather than answered wrong:
   the captain multiplier makes the constant non-uniform.) What the constant DOES cost is
   pruning — it compresses the relative spread the bound works on — which is the other
   half of why large L is slow.
   ========================================================================== */

var FRONTIER_MAX_SOLVES = 24;
var FRONTIER_WALK = 6;      // probes spent finding the rare end before refinement starts

/**
 * players/cfg: exactly as solveLineups takes them, plus `own` (percent) per player.
 * Returns { points, segments, solves, capped, hull, unavailable }.
 *   points[]   {ids, proj, own, sal, lam}  hull vertices, ascending ownership
 *   segments[] {from, to, rate}            rate = projection points per ownership point
 *   capped     the search stopped on its budget or the clock, not on convergence
 *   unavailable a reason string when no frontier can honestly be drawn at all
 */
function frontier(players, cfg, onProgress) {
  cfg = cfg || {};
  var site = SITES[cfg.site] || SITES.dk_classic;
  var out = { points: [], segments: [], solves: 0, capped: false, hull: true, unavailable: null };
  if (site.showdown) { out.unavailable = "showdown"; return out; }

  var own = [], anyOwn = false, i;
  for (i = 0; i < players.length; i++) {
    var v = +players[i].own || 0;
    own.push(v > 0 ? v : 0);
    if (v > 0) anyOwn = true;
  }
  if (!anyOwn) { out.unavailable = "no-ownership"; return out; }

  var budget = cfg.maxSolves > 0 ? Math.min(FRONTIER_MAX_SOLVES, cfg.maxSolves | 0) : FRONTIER_MAX_SOLVES;
  var deadline = Date.now() + (cfg.timeLimitMs || 30000);
  var seen = {}, points = [];

  function at(lam) {
    if (out.solves >= budget || Date.now() > deadline) { out.capped = true; return null; }
    out.solves++;
    if (onProgress) onProgress(out.solves, budget);

    var lo = 0, j;
    for (j = 0; j < players.length; j++) {
      if (!(players[j].proj > 0) && !players[j].lock) continue;
      var w = (players[j].proj || 0) - lam * own[j];
      if (w < lo) lo = w;
    }
    var shift = -lo + 1e-6;

    var shadow = [];
    for (j = 0; j < players.length; j++) {
      var p = players[j], q = {};
      for (var k in p) q[k] = p[k];
      // A player with no projection stays absent, exactly as everywhere else.
      q.proj = (p.proj > 0 || p.lock) ? (p.proj || 0) - lam * own[j] + shift : 0;
      shadow.push(q);
    }

    // A slice of what is left, not all of it: one hard weight must not starve the rest.
    var c = {}; for (var kk in cfg) c[kk] = cfg[kk];
    c.count = 1; c.randomness = 0; c.uniques = 0; c.seed = 1;
    c.timeLimitMs = Math.max(600, Math.floor((deadline - Date.now()) / Math.max(1, budget - out.solves + 1)));

    var res = solveLineups(shadow, c);
    if (!res || res.timedOut || !res.lineups.length) { out.capped = true; return null; }

    var ids = res.lineups[0].ids.slice();
    var key = ids.slice().sort(function (a, b) { return a - b; }).join(",");
    if (seen[key]) return seen[key];

    var pr = 0, ow = 0;
    for (j = 0; j < ids.length; j++) { pr += players[ids[j]].proj || 0; ow += own[ids[j]]; }
    var pt = { ids: ids, proj: pr, own: ow, sal: res.lineups[0].sal, lam: lam };
    seen[key] = pt; points.push(pt);
    return pt;
  }

  var top = at(0);                       // the plain max-projection lineup
  if (!top) { out.unavailable = "infeasible"; return out; }

  // Walk the weight up while probes keep succeeding, keeping the rarest lineup seen.
  // ⚠️ DO NOT stop because a probe returned the same lineup as the last one. Small
  // weights often do — the max-projection lineup stays optimal until the weight is big
  // enough to dislodge it — and an early stop there leaves the frontier a single point.
  var lam = 0.05, bot = top, walk = 0;
  while (walk++ < FRONTIER_WALK) {
    var nxt = at(lam);
    if (!nxt) break;                     // timed out, or the budget ran out
    if (nxt.own < bot.own - 1e-9) bot = nxt;
    lam *= 4;
  }
  // The rare end is "the rarest lineup this search reached", not provably the rarest
  // lineup on the slate — see the note above about why large weights do not finish.

  function refine(a, b, depth) {         // a = richer and more owned, b = leaner and rarer
    if (depth > 12) return;
    var dOwn = a.own - b.own;
    if (dOwn <= 1e-9) return;
    var slope = (a.proj - b.proj) / dOwn;
    var p = at(slope);
    if (!p) return;
    if (p.proj <= b.proj + (p.own - b.own) * slope + 1e-7) return;   // sits on the chord
    refine(a, p, depth + 1); refine(p, b, depth + 1);
  }
  refine(top, bot, 0);

  points.sort(function (a, b) { return a.own - b.own || b.proj - a.proj; });

  // Pareto filter first: a point beaten on BOTH axes by a rarer one is on no frontier,
  // hull or otherwise. This can only bite when the search was cut off mid-recursion.
  var pareto = [], bestProj = -Infinity;
  for (i = 0; i < points.length; i++) {
    if (points[i].proj > bestProj + 1e-9) { pareto.push(points[i]); bestProj = points[i].proj; }
  }
  // Then the upper hull: slopes must strictly decrease as ownership rises.
  var hull = [];
  for (i = 0; i < pareto.length; i++) {
    var c2 = pareto[i];
    while (hull.length >= 2) {
      var x = hull[hull.length - 2], y = hull[hull.length - 1];
      if ((y.proj - x.proj) * (c2.own - y.own) <= (c2.proj - y.proj) * (y.own - x.own) + 1e-9) hull.pop();
      else break;
    }
    hull.push(c2);
  }
  out.points = hull;
  for (i = 1; i < hull.length; i++) {
    out.segments.push({
      from: hull[i - 1], to: hull[i],
      rate: (hull[i].proj - hull[i - 1].proj) / (hull[i].own - hull[i - 1].own)
    });
  }
  return out;
}

root.DDFS.frontier = frontier;
root.DDFS.FRONTIER_MAX_SOLVES = FRONTIER_MAX_SOLVES;
root.DDFS.FRONTIER_WALK = FRONTIER_WALK;
/* ===== DD-FRONTIER END ===== */

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

/* Shared survivor path engine — generated verbatim from work/survivor-path-engine.js except for its private root. */
const mcpSurvivorPathRoot = {};
/* ============================================================================
   Survivor path engine — bounded exact assignment over weekly win probabilities.

   Pure computation. No DOM, network, storage or randomness. Loaded three ways:
     1. Node, for correctness and parity tests
     2. inlined into survivor.html for the human path board
     3. injected into the Cloudflare Worker under a private root for MCP

   The ordinary survivor rule is one distinct team per week. That is a rectangular
   maximum-product assignment, solved as minimum -log(probability) with Hungarian.
   If a pool explicitly allows reuse, each week is independent and the exact solution
   is simply that week's highest-probability team; the same team may appear repeatedly.

   DOUBLE-PICK WEEKS are the same problem with more columns. A week that requires two
   picks is two SLOTS, and the assignment formulation already forbids a team from
   taking two slots when reuse is off — the distinct-team rule falls out of the
   assignment rather than being bolted on. `slotsPerWeek` carries that; absent, every
   week is one slot and the maths is bit-for-bit what it always was.
   ========================================================================== */
(function (root) {
"use strict";

const MAX_WEEKS = 18;
const MAX_TEAMS = 64;
const MAX_SLOTS_PER_WEEK = 4;   // no real pool asks for more; the cap bounds the matrix
/* ⚠️ BIG must dominate PER CELL, not per path. The Hungarian minimises a sum, so the
   only thing that matters is that swapping a BIG cell for any legal cell always lowers
   the total — i.e. BIG > the most expensive legal cell, which is -log(1e-6) = 13.8155.
   It is tempting to reason "a full path is ~19 slots so BIG must beat 19 × 1.6 = 30",
   and that comparison is not the binding one: a path's total cost is never weighed
   against a single BIG. test-survivor-path.js asserts the per-cell inequality instead
   of trusting either sentence. */
const BIG = 25;

function finiteProbability(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Error((label || "probability") + " must be null or a finite number from 0 to 1");
  return value;
}

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("path input must be an object");
  const weeks = input.weeks, teams = input.teams, probabilities = input.probabilities;
  if (!Array.isArray(weeks) || !weeks.length || weeks.length > MAX_WEEKS)
    throw new Error("weeks must contain 1-" + MAX_WEEKS + " entries");
  if (!weeks.every(w => Number.isInteger(w) && w >= 1 && w <= 18) || new Set(weeks).size !== weeks.length)
    throw new Error("weeks must be unique whole numbers from 1 to 18");
  if (!Array.isArray(teams) || !teams.length || teams.length > MAX_TEAMS)
    throw new Error("teams must contain 1-" + MAX_TEAMS + " entries");
  if (!teams.every(t => typeof t === "string" && t.length > 0 && t.length <= 20) || new Set(teams).size !== teams.length)
    throw new Error("teams must be unique non-empty strings of at most 20 characters");
  if (!Array.isArray(probabilities) || probabilities.length !== teams.length)
    throw new Error("probabilities must have one row per team");
  const matrix = probabilities.map((row, i) => {
    if (!Array.isArray(row) || row.length !== weeks.length)
      throw new Error("probabilities row " + (i + 1) + " must have one cell per week");
    return row.map((p, j) => finiteProbability(p, "probability for " + teams[i] + " week " + weeks[j]));
  });
  /* ⚠️ Slots are validated SEPARATELY and AFTER the caller-facing shape, on purpose.
     The distinct-weeks rule above is what stops a caller passing week 3 twice and
     silently getting a double-pick week it never asked for; weakening it so that
     "weeks" could carry duplicates would make the double-pick rule unstateable and
     the accidental-duplicate bug unreportable at the same time. A week appears once
     in `weeks` and says how many picks it wants in `slotsPerWeek`. */
  return {
    weeks: weeks.slice(), teams: teams.slice(), probabilities: matrix,
    reuse: input.reuse === true,
    slotCounts: validateSlots(weeks, input.slotsPerWeek),
  };
}

/* slotsPerWeek: { [week]: count }. Absent, or absent for a given week, means one pick —
   so every existing caller keeps the exact matrix it had before slots existed. */
function validateSlots(weeks, slotsPerWeek) {
  if (slotsPerWeek === null || slotsPerWeek === undefined) return weeks.map(() => 1);
  if (typeof slotsPerWeek !== "object" || Array.isArray(slotsPerWeek))
    throw new Error("slotsPerWeek must be an object keyed by week");
  for (const key of Object.keys(slotsPerWeek)) {
    const week = Number(key);
    if (!Number.isInteger(week) || week < 1 || week > 18)
      throw new Error("slotsPerWeek keys must be whole weeks from 1 to 18");
  }
  return weeks.map(week => {
    const raw = slotsPerWeek[week] !== undefined ? slotsPerWeek[week] : slotsPerWeek[String(week)];
    if (raw === undefined || raw === null) return 1;
    if (!Number.isInteger(raw) || raw < 1 || raw > MAX_SLOTS_PER_WEEK)
      throw new Error("slotsPerWeek for week " + week + " must be a whole number from 1 to " + MAX_SLOTS_PER_WEEK);
    return raw;
  });
}

function hungarian(cost) { // square matrix, minimizes
  if (!Array.isArray(cost)) throw new Error("cost must be a square matrix");
  const n = cost.length, INF = 1e18;
  if (!n) return new Int32Array(0);
  if (!cost.every(row => row && row.length === n)) throw new Error("cost must be a square matrix");
  const u = new Float64Array(n + 1), v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1), way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const minv = new Float64Array(n + 1).fill(INF);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1; const i0 = p[j0]; let delta = INF, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cell = cost[i0 - 1][j - 1];
        if (typeof cell !== "number" || !Number.isFinite(cell)) throw new Error("cost cells must be finite numbers");
        const cur = cell - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const result = new Int32Array(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] > 0) result[p[j] - 1] = j - 1;
  return result; // result[row] = column
}

/* ⚠️ `covered` COUNTS SLOTS, not weeks. With one pick a week those are the same number,
   which is why every pre-slots caller is unaffected; with a double-pick week they are
   not, and a "covered N of M" string built on weeks would under-report a half-filled
   double week as fully covered. `weeksCovered` and `slots` are alongside it so a
   consumer that genuinely wants weeks does not have to derive it — and the MCP payload
   names which one it is returning. */
function finish(input, assignments) {
  assignments.sort((a, b) => a.weekIndex - b.weekIndex || a.slotIndex - b.slotIndex
    || a.teamIndex - b.teamIndex);
  let logSurvival = 0;
  for (const pick of assignments) logSurvival += Math.log(pick.probability);
  const slots = input.slotCounts.reduce((sum, n) => sum + n, 0);
  return {
    weeks: input.weeks.slice(), assignments,
    survival: assignments.length ? Math.exp(logSurvival) : 0,
    covered: assignments.length,
    weeksCovered: new Set(assignments.map(a => a.week)).size,
    slots,
    slotsPerWeek: input.weeks.reduce((out, w, j) => { out[w] = input.slotCounts[j]; return out; }, {}),
    complete: assignments.length === slots,
    reuse: input.reuse,
  };
}

/* Expand weeks into slots: week index j appears slotCounts[j] times. One pick a week
   gives back exactly the old column order, so the cost matrix is unchanged. */
function expandSlots(input) {
  const weekOf = [], nth = [];
  for (let j = 0; j < input.weeks.length; j++)
    for (let k = 0; k < input.slotCounts[j]; k++) { weekOf.push(j); nth.push(k); }
  return { weekOf, nth };
}

function solvePath(rawInput) {
  const input = validateInput(rawInput);
  const R = input.teams.length;
  const { weekOf, nth } = expandSlots(input);
  const C = weekOf.length;

  if (input.reuse) {
    /* Reuse mode: weeks are independent, so each week just takes its best teams.
       ⚠️ With two slots that is the top TWO DISTINCT teams, not the best team twice.
       Nothing in this branch forbids a repeat — the assignment's distinct-team rule is
       what does that when reuse is off, and this branch never builds an assignment.
       Taking the top k distinct teams is both the fix and the exact optimum: within a
       week you need k different teams and the product is maximised by the k largest
       probabilities. (An earlier plan was to solve, detect a same-team collision, mark
       that cell impossible and re-solve in a bounded loop. That works, but it is a
       search for something this branch can read straight off a sort.) */
    const assignments = [];
    for (let j = 0; j < input.weeks.length; j++) {
      const ranked = [];
      for (let i = 0; i < R; i++) {
        const p = input.probabilities[i][j];
        if (p !== null) ranked.push({ i, p });
      }
      ranked.sort((a, b) => b.p - a.p || a.i - b.i);
      for (let k = 0; k < input.slotCounts[j] && k < ranked.length; k++) assignments.push({
        week: input.weeks[j], team: input.teams[ranked[k].i], probability: ranked[k].p,
        teamIndex: ranked[k].i, weekIndex: j, slotIndex: k,
      });
    }
    return finish(input, assignments);
  }

  const N = Math.max(R, C);
  const cost = Array.from({ length: N }, () => new Float64Array(N).fill(BIG));
  for (let i = 0; i < R; i++) for (let s = 0; s < C; s++) {
    const p = input.probabilities[i][weekOf[s]];
    if (p !== null) cost[i][s] = -Math.log(Math.max(p, 1e-6));
  }
  const assignment = hungarian(cost), picks = [];
  for (let i = 0; i < R; i++) {
    const s = assignment[i];
    if (s >= 0 && s < C && cost[i][s] < BIG) picks.push({
      week: input.weeks[weekOf[s]], team: input.teams[i],
      probability: input.probabilities[i][weekOf[s]],
      teamIndex: i, weekIndex: weekOf[s], slotIndex: nth[s],
    });
  }
  return finish(input, picks);
}

root.DDSurvivorPath = { MAX_WEEKS, MAX_TEAMS, MAX_SLOTS_PER_WEEK, BIG, hungarian, solvePath };

})(mcpSurvivorPathRoot);

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
let mcpModelReceiptsCache = { at: 0, data: null };
let mcpCfbProfilesCache = { at: 0, data: null };
let mcpCfbDivergenceCache = { at: 0, data: null };
let mcpCfbDisagreementCache = { at: 0, data: null };
let mcpCfbReceiptCache = { at: 0, data: null };
let mcpCfbScheduleCache = { at: 0, data: null };
let mcpCfbTeamPeriodsCache = { at: 0, data: null };
let mcpCfbLatestPeriodsCache = { at: 0, data: null };
let mcpCfbLatestGamesCache = { at: 0, data: null };
let mcpCfbTeamGamesCache = { at: 0, data: null };
let mcpCfbMarketCache = { at: 0, data: null };
let mcpCfbModelCardsCache = { at: 0, data: null };

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

/* ⚠️ EVERY /data fetch below uses cacheTtlByStatus, never a bare cacheTtl, and the
   difference is not cosmetic. `cacheTtl` forces the response into Cloudflare's edge
   cache REGARDLESS of its status, so one transient 5xx from Pages is pinned for the
   full TTL and every caller in that window is told the file is unavailable while the
   file sits there, valid, on the origin. That is a self-inflicted outage lasting as
   long as the success TTL.

   Success caches for the helper's own TTL; 404 caches for one second so a genuinely
   missing file is still noticed quickly; 5xx caches for zero, so the next call retries.

   This shape came out of the 2026-08-23 survivor.json incident, where both survivor
   tools returned "unavailable: HTTP 503" against a healthy file. That diagnosis was
   never confirmed — the tools had recovered before it could be reproduced — but the
   defect is real independent of whether it caused that outage, and it was identical in
   all sixteen helpers rather than unique to one. */

// survivor.json carries the whole 2026 schedule with blended win probabilities,
// the nfelo Elo table and the margin-model constants — one fetch feeds both the
// survivor EV tool and the matchup tool. 15 min cache: it changes on data pushes,
// not per request, but weekly ownership context makes an hour feel stale.
//
// ⚠️ cacheTtlByStatus, NOT a bare cacheTtl. `cacheTtl` forces the response into the
// edge cache REGARDLESS of its status, so a single transient 503 from Pages gets
// pinned for the full 15 minutes and every caller in that window is told the file is
// unavailable while the file is sitting there, valid, on the origin. That is the
// shape of the outage reported 2026-08-23: both survivor tools returning
// "survivor.json unavailable: HTTP 503" against a file that was fine.
// Success caches for 15 minutes; a 404 caches for one second so a genuinely missing
// file is still noticed quickly; 5xx caches for zero, so the next call retries.
//
// ⚠️ This fix is UNFALSIFIED. By the time it was written the tools had recovered on
// their own and the origin was unreachable from the dev container (network policy),
// so the 503 could not be reproduced to confirm the cause. The change is correct
// regardless — pinning an error response for 15 minutes is a defect whether or not it
// is firing right now — but if 503s return, this was not the (only) cause.
async function mcpSurvivor() {
  if (!mcpSurvCache.data || Date.now() - mcpSurvCache.at > 900e3) {
    const r = await fetch(`${SITE}/data/survivor.json`, {
      cf: { cacheTtlByStatus: { "200-299": 900, "404": 1, "500-599": 0 }, cacheEverything: true },
    });
    if (!r.ok) throw new Error("survivor.json unavailable: HTTP " + r.status);
    mcpSurvCache = { at: Date.now(), data: (await r.json()).data };
  }
  return mcpSurvCache.data;
}

// Exact survivor path adapter. The optimizer is injected from
// work/survivor-path-engine.js, the same source inlined into survivor.html.
function mcpSurvivorWeekTable(D, week) {
  const table = {};
  for (const g of D.games) {
    if (g.wk !== week) continue;
    table[g.h] = { opponent: g.a, home: true, probability: g.p, source: g.src, game_id: g.id, date: g.d };
    table[g.a] = { opponent: g.h, home: false, probability: 1 - g.p, source: g.src, game_id: g.id, date: g.d };
  }
  return table;
}

// doubleWeeks: a Set of weeks requiring two picks. Empty means one pick a week and the
// cost matrix is exactly what it was before slots existed.
function mcpSolveSurvivorPath(D, fromWeek, used, reuse, doubleWeeks) {
  const weeks = [];
  for (let week = fromWeek; week <= 18; week++) weeks.push(week);
  const dbl = doubleWeeks || new Set();
  const slotsPerWeek = {};
  for (const week of weeks) if (dbl.has(week)) slotsPerWeek[week] = 2;
  const slots = weeks.reduce((n, w) => n + (slotsPerWeek[w] || 1), 0);
  if (!weeks.length) return { weeks, assignments: [], survival: 1, covered: 0, slots: 0, weeksCovered: 0, complete: true, reuse };
  const tables = weeks.map(week => mcpSurvivorWeekTable(D, week));
  const teams = Object.keys(D.elo).filter(team => reuse || !used.has(team));
  if (!teams.length) return { weeks, assignments: [], survival: 0, covered: 0, slots, weeksCovered: 0, complete: false, reuse };
  const solved = mcpSurvivorPathRoot.DDSurvivorPath.solvePath({
    weeks, teams, reuse, slotsPerWeek,
    probabilities: teams.map(team => tables.map(table => table[team] ? table[team].probability : null)),
  });
  solved.assignments = solved.assignments.map(pick => ({
    week: pick.week, team: pick.team, probability: pick.probability,
    ...tables[pick.weekIndex][pick.team],
  }));
  return solved;
}

// The public receipt ledger is append-only and changes only when a new dated model
// snapshot is published. Keep the envelope (not just data) so every response can carry
// its source date and integrity receipt. The returned rows are always bounded by the tool.
async function mcpModelReceipts() {
  if (!mcpModelReceiptsCache.data || Date.now() - mcpModelReceiptsCache.at > 900e3) {
    const r = await fetch(`${SITE}/data/model-receipts.json`, { cf: { cacheTtlByStatus: { "200-299": 900, "404": 1, "500-599": 0 }, cacheEverything: true } });
    if (!r.ok) throw new Error("model-receipts.json unavailable: HTTP " + r.status);
    const envelope = await r.json();
    if (!envelope || !Array.isArray(envelope.data)) throw new Error("model-receipts.json has an invalid envelope");
    if (!envelope.as_of || !envelope.source) throw new Error("model-receipts.json is missing required provenance");
    if (envelope.integrity && Number.isInteger(envelope.integrity.rows) && envelope.integrity.rows !== envelope.data.length)
      throw new Error("model-receipts.json row count does not match its integrity receipt");
    mcpModelReceiptsCache = { at: Date.now(), data: envelope };
  }
  return mcpModelReceiptsCache.data;
}

// The registry is a compact, public, dated normalization boundary rather than a
// live upstream query. Retain its envelope so callers receive the exact source and
// snapshot receipt that produced every rating. The tool below returns one team only.
async function mcpCfbTeamProfiles() {
  if (!mcpCfbProfilesCache.data || Date.now() - mcpCfbProfilesCache.at > 900e3) {
    const r = await fetch(`${SITE}/data/cfb-teams.json`, { cf: { cacheTtlByStatus: { "200-299": 900, "404": 1, "500-599": 0 }, cacheEverything: true } });
    if (!r.ok) throw new Error("cfb-teams.json unavailable: HTTP " + r.status);
    const envelope = await r.json();
    const data = envelope && envelope.data;
    if (!envelope || !envelope.as_of || !envelope.source || !data ||
        !Array.isArray(data.systems) || !Array.isArray(data.teams))
      throw new Error("cfb-teams.json has an invalid envelope");
    if (!data.systems.length || data.systems.length > 20)
      throw new Error("cfb-teams.json must contain 1-20 registered systems");
    if (!data.teams.length || data.teams.length > 200)
      throw new Error("cfb-teams.json must contain 1-200 teams");
    if (data.scope !== "observed-results-plus-retrodictive-rating" ||
        !data.consensus || typeof data.consensus.status !== "string" || !data.rating_period)
      throw new Error("cfb-teams.json is missing rating-period or consensus metadata");
    if (envelope.integrity && Number.isInteger(envelope.integrity.teams) && envelope.integrity.teams !== data.teams.length)
      throw new Error("cfb-teams.json team count does not match its integrity receipt");
    if (envelope.integrity && Number.isInteger(envelope.integrity.systems) && envelope.integrity.systems !== data.systems.length)
      throw new Error("cfb-teams.json system count does not match its integrity receipt");
    const systemIds = new Set();
    for (const system of data.systems) {
      if (!system || typeof system.system_id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(system.system_id) ||
          systemIds.has(system.system_id) || typeof system.name !== "string" || !system.name ||
          typeof system.provider !== "string" || !system.provider || typeof system.kind !== "string" || !system.kind ||
          typeof system.feature_family !== "string" || !system.feature_family ||
          typeof system.source_snapshot_id !== "string" || !system.source_snapshot_id ||
          typeof system.source_url !== "string" || !system.source_url ||
          typeof system.model_card_url !== "string" || !system.model_card_url ||
          !system.outputs || typeof system.outputs !== "object" || Array.isArray(system.outputs) ||
          !system.team_diagnostics || typeof system.team_diagnostics.available !== "boolean" ||
          (system.team_diagnostics.available === true &&
            (system.team_diagnostics.kind !== "retrodictive-team-aggregate" ||
             system.team_diagnostics.prospective !== false || system.team_diagnostics.graded !== false ||
             system.team_diagnostics.rankings_published !== false)) ||
          typeof system.prospective_forecasts_exist !== "boolean" || typeof system.graded !== "boolean")
        throw new Error("cfb-teams.json has an invalid or duplicate system_id");
      systemIds.add(system.system_id);
    }
    for (const team of data.teams) {
      if (!team || typeof team.team_slug !== "string" || typeof team.team !== "string" ||
          !team.observed_results || typeof team.observed_results !== "object" ||
          !team.systems || typeof team.systems !== "object" || Array.isArray(team.systems))
        throw new Error("cfb-teams.json has an invalid team row");
      for (const systemId of Object.keys(team.systems))
        if (!systemIds.has(systemId)) throw new Error("cfb-teams.json team row names an unregistered system: " + systemId);
      for (const [systemId, rating] of Object.entries(team.systems)) {
        const diagnosticsAvailable = data.systems.find(system => system.system_id === systemId).team_diagnostics.available;
        const diagnostic = rating && rating.retrodictive_team_diagnostic;
        if (!diagnosticsAvailable) {
          if (diagnostic !== undefined && diagnostic !== null)
            throw new Error("cfb-teams.json publishes an unavailable team diagnostic");
          continue;
        }
        if (!diagnostic || !Number.isInteger(diagnostic.games) || diagnostic.games < 1 ||
            !Number.isInteger(diagnostic.observed_wins) || !Number.isInteger(diagnostic.observed_losses) ||
            diagnostic.observed_wins + diagnostic.observed_losses !== diagnostic.games ||
            !Number.isFinite(diagnostic.expected_wins) ||
            !Number.isFinite(diagnostic.actual_minus_expected_wins) ||
            !Number.isFinite(diagnostic.mean_pregame_win_probability) ||
            !Number.isFinite(diagnostic.brier_win_probability) ||
            Object.keys(diagnostic).some(key => /rank|label|luck/i.test(key)))
          throw new Error("cfb-teams.json has an invalid, ranked or labelled team diagnostic");
      }
    }
    mcpCfbProfilesCache = { at: Date.now(), data: envelope };
  }
  return mcpCfbProfilesCache.data;
}

// Keep the descriptive team rows and their aggregate-only validation receipt
// together. The explorer below must never return a team label that the validation
// artifact explicitly refuses to authorize.
async function mcpCfbRecordDivergenceEvidence() {
  if (!mcpCfbDivergenceCache.data || Date.now() - mcpCfbDivergenceCache.at > 900e3) {
    const [baselineResponse, validationResponse] = await Promise.all([
      fetch(`${SITE}/data/cfb-record-divergence.json`, { cf: { cacheTtlByStatus: { "200-299": 900, "404": 1, "500-599": 0 }, cacheEverything: true } }),
      fetch(`${SITE}/data/cfb-record-divergence-validation.json`, { cf: { cacheTtlByStatus: { "200-299": 900, "404": 1, "500-599": 0 }, cacheEverything: true } }),
    ]);
    if (!baselineResponse.ok) throw new Error("cfb-record-divergence.json unavailable: HTTP " + baselineResponse.status);
    if (!validationResponse.ok) throw new Error("cfb-record-divergence-validation.json unavailable: HTTP " + validationResponse.status);
    const [baseline, validation] = await Promise.all([baselineResponse.json(), validationResponse.json()]);
    const rows = baseline && baseline.data && baseline.data.rows;
    if (!baseline || !baseline.as_of || !baseline.source || !baseline.data ||
        baseline.data.status !== "descriptive-baseline" || !Array.isArray(rows) || !rows.length || rows.length > 200)
      throw new Error("cfb-record-divergence.json has an invalid envelope");
    if (baseline.integrity && Number.isInteger(baseline.integrity.rows) && baseline.integrity.rows !== rows.length)
      throw new Error("cfb-record-divergence.json row count does not match its integrity receipt");
    const slugs = new Set();
    const directions = new Set(["record-ahead-of-scoring", "scoring-ahead-of-record", "aligned"]);
    for (const row of rows) {
      if (!row || typeof row.team_slug !== "string" || !row.team_slug || slugs.has(row.team_slug) ||
          typeof row.team !== "string" || !row.team || typeof row.conference !== "string" ||
          !Number.isInteger(row.record_rank) || !Number.isInteger(row.scoring_rank) ||
          !Number.isInteger(row.record_scoring_rank_gap) || !directions.has(row.descriptive_direction) ||
          row.predictive_label !== null)
        throw new Error("cfb-record-divergence.json has an invalid or labelled team row");
      slugs.add(row.team_slug);
    }
    const evidence = validation && validation.data;
    if (!validation || !validation.as_of || !validation.source || !evidence ||
        evidence.status !== "retrodictive-chronological-validation" ||
        !evidence.result || typeof evidence.result.finding !== "string" ||
        !evidence.result.holdout || !evidence.roadmap_decision ||
        evidence.roadmap_decision.team_labels_permitted !== false ||
        evidence.roadmap_decision.prospective_value_claimed !== false ||
        !String(evidence.published_granularity || "").includes("aggregate-only"))
      throw new Error("cfb-record-divergence-validation.json does not preserve the aggregate-only no-label contract");
    mcpCfbDivergenceCache = { at: Date.now(), data: { baseline, validation } };
  }
  return mcpCfbDivergenceCache.data;
}

async function mcpCfbModelDisagreementEvidence() {
  if (!mcpCfbDisagreementCache.data || Date.now() - mcpCfbDisagreementCache.at > 900e3) {
    const response = await fetch(`${SITE}/data/cfb-disagreement.json`, { cf: { cacheTtlByStatus: { "200-299": 900, "404": 1, "500-599": 0 }, cacheEverything: true } });
    if (!response.ok) throw new Error("cfb-disagreement.json unavailable: HTTP " + response.status);
    const envelope = await response.json();
    const data = envelope && envelope.data;
    const measured = data && data.measured_anyway;
    if (!envelope || !envelope.as_of || !envelope.source || !data || data.finding !== "blocked" ||
        typeof data.question !== "string" || !data.question || typeof data.why_blocked !== "string" ||
        !data.why_blocked || typeof data.what_would_unblock_it !== "string" || !data.what_would_unblock_it ||
        !measured || !Number.isInteger(measured.n_paired_games) || measured.n_paired_games < 1 ||
        measured.n_paired_games > 2000 || !Array.isArray(measured.buckets) || !measured.buckets.length ||
        measured.buckets.length > 20)
      throw new Error("cfb-disagreement.json has an invalid blocked-evidence envelope");
    let bucketGames = 0;
    for (const bucket of measured.buckets) {
      if (!bucket || !Number.isFinite(bucket.gap_low) ||
          !(bucket.gap_high === null || Number.isFinite(bucket.gap_high)) ||
          !Number.isInteger(bucket.n) || bucket.n < 1 || typeof bucket.underpowered !== "boolean" ||
          !Number.isFinite(bucket.mean_gap) || !Number.isFinite(bucket.elo_brier) ||
          !Number.isFinite(bucket.market_brier) || !Number.isFinite(bucket.market_brier_advantage))
        throw new Error("cfb-disagreement.json has an invalid measured bucket");
      bucketGames += bucket.n;
    }
    if (bucketGames !== measured.n_paired_games)
      throw new Error("cfb-disagreement.json bucket counts do not reconcile to paired games");
    mcpCfbDisagreementCache = { at: Date.now(), data: envelope };
  }
  return mcpCfbDisagreementCache.data;
}

async function mcpCfbModelReceipts() {
  if (!mcpCfbReceiptCache.data || Date.now() - mcpCfbReceiptCache.at > 900e3) {
    const response = await fetch(`${SITE}/data/cfb-model-receipts.json`, { cf: { cacheTtlByStatus: { "200-299": 900, "404": 1, "500-599": 0 }, cacheEverything: true } });
    if (!response.ok) throw new Error("cfb-model-receipts.json unavailable: HTTP " + response.status);
    const envelope = await response.json();
    const rows = envelope && envelope.data;
    if (!envelope || !envelope.as_of || !envelope.source || envelope.graded !== false ||
        !Array.isArray(rows) || rows.length > 5000)
      throw new Error("cfb-model-receipts.json has an invalid ungraded ledger envelope");
    if (envelope.integrity && Number.isInteger(envelope.integrity.rows) && envelope.integrity.rows !== rows.length)
      throw new Error("cfb-model-receipts.json row count does not match its integrity receipt");
    const ids = new Set();
    for (const row of rows) {
      const issued = Date.parse(row && row.issued_at);
      const kickoff = Date.parse(row && row.kickoff_at);
      if (!row || typeof row.forecast_id !== "string" || !row.forecast_id || ids.has(row.forecast_id) ||
          typeof row.model_id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.model_id) ||
          !Number.isInteger(row.season) || !Number.isInteger(row.week) ||
          row.forecast_status !== "prospective" || row.grading_status !== "ungraded" ||
          !Number.isFinite(issued) || !Number.isFinite(kickoff) || issued >= kickoff ||
          typeof row.home_win_probability !== "number" || !Number.isFinite(row.home_win_probability) ||
          row.home_win_probability < 0 || row.home_win_probability > 1)
        throw new Error("cfb-model-receipts.json has an invalid, duplicate or non-prospective receipt");
      ids.add(row.forecast_id);
    }
    mcpCfbReceiptCache = { at: Date.now(), data: envelope };
  }
  return mcpCfbReceiptCache.data;
}

async function mcpCfbSchedule() {
  if (!mcpCfbScheduleCache.data || Date.now() - mcpCfbScheduleCache.at > 900e3) {
    const response = await fetch(`${SITE}/data/cfb-schedule.json`, { cf: { cacheTtlByStatus: { "200-299": 900, "404": 1, "500-599": 0 }, cacheEverything: true } });
    if (!response.ok) throw new Error("cfb-schedule.json unavailable: HTTP " + response.status);
    const envelope = await response.json();
    const data = envelope && envelope.data;
    const games = data && data.games;
    if (!envelope || !envelope.as_of || !envelope.source || !data || !Number.isInteger(data.season) ||
        !Array.isArray(games) || !games.length || games.length > 2000)
      throw new Error("cfb-schedule.json has an invalid envelope");
    if (envelope.integrity && Number.isInteger(envelope.integrity.rows) && envelope.integrity.rows !== games.length)
      throw new Error("cfb-schedule.json row count does not match its integrity receipt");
    const ids = new Set();
    for (const game of games) {
      const final = game && game.status === "final";
      if (!game || typeof game.game_id !== "string" || !game.game_id || ids.has(game.game_id) ||
          game.season !== data.season || !Number.isInteger(game.week) || game.week < 1 || game.week > 20 ||
          !["regular", "postseason"].includes(game.season_type) || !Number.isFinite(Date.parse(game.kickoff_at)) ||
          typeof game.home_team !== "string" || typeof game.home_team_slug !== "string" ||
          typeof game.away_team !== "string" || typeof game.away_team_slug !== "string" ||
          !["scheduled", "final"].includes(game.status) ||
          (final && (!Number.isInteger(game.home_points) || !Number.isInteger(game.away_points))) ||
          (!final && !(game.home_points === null && game.away_points === null)))
        throw new Error("cfb-schedule.json has an invalid or duplicate canonical game row");
      ids.add(game.game_id);
    }
    mcpCfbScheduleCache = { at: Date.now(), data: envelope };
  }
  return mcpCfbScheduleCache.data;
}

async function mcpCfbTeamPeriods() {
  if (!mcpCfbTeamPeriodsCache.data || Date.now() - mcpCfbTeamPeriodsCache.at > 900e3) {
    const response = await fetch(`${SITE}/data/cfb-team-week.json`, { cf: { cacheTtlByStatus: { "200-299": 900, "404": 1, "500-599": 0 }, cacheEverything: true } });
    if (!response.ok) throw new Error("cfb-team-week.json unavailable: HTTP " + response.status);
    const envelope = await response.json();
    const data = envelope && envelope.data;
    const teams = data && data.teams;
    const rows = data && data.rows;
    if (!envelope || !envelope.as_of || !envelope.source || !data || !Number.isInteger(data.season) ||
        data.scope !== "results-only" || typeof data.conference_record_definition !== "string" ||
        !/not an official standing/i.test(data.conference_record_definition) ||
        !teams || typeof teams !== "object" || Array.isArray(teams) ||
        !Array.isArray(rows) || !rows.length || rows.length > 4000 || !Array.isArray(data.unavailable_metrics))
      throw new Error("cfb-team-week.json has an invalid results-only envelope");
    if (envelope.integrity && Number.isInteger(envelope.integrity.rows) && envelope.integrity.rows !== rows.length)
      throw new Error("cfb-team-week.json row count does not match its integrity receipt");
    for (const [slug, team] of Object.entries(teams)) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !team || typeof team.team !== "string" || !team.team ||
          !["fbs", "fcs"].includes(team.division))
        throw new Error("cfb-team-week.json has an invalid team registry");
    }
    const ids = new Set();
    for (const row of rows) {
      const period = row && row.period;
      const seasonToDate = row && row.season_to_date;
      const conferenceToDate = row && row.conference_regular_season_to_date;
      if (!row || typeof row.team_period_id !== "string" || !row.team_period_id || ids.has(row.team_period_id) ||
          row.season !== data.season || !["regular", "postseason"].includes(row.season_type) ||
          !Number.isInteger(row.week) || row.week < 1 || row.week > 20 || typeof row.period_key !== "string" ||
          !Number.isFinite(Date.parse(row.through_at)) || !teams[row.team_slug] ||
          !Number.isInteger(row.scheduled_games_this_period) || row.scheduled_games_this_period < 1 ||
          !Array.isArray(row.opponent_slugs) || !period || !seasonToDate || !conferenceToDate)
        throw new Error("cfb-team-week.json has an invalid or duplicate team-period row");
      for (const summary of [period, seasonToDate, conferenceToDate]) {
        if (![summary.games, summary.wins, summary.losses, summary.ties, summary.points_for,
              summary.points_against, summary.point_differential].every(Number.isInteger) ||
            summary.games !== summary.wins + summary.losses + summary.ties ||
            summary.point_differential !== summary.points_for - summary.points_against)
          throw new Error("cfb-team-week.json has an arithmetically invalid team-period summary");
      }
      if (period.games !== row.scheduled_games_this_period || seasonToDate.games < period.games ||
          typeof seasonToDate.record !== "string" || !/^\d+-\d+-\d+$/.test(seasonToDate.record))
        throw new Error("cfb-team-week.json has an inconsistent team-period summary");
      ids.add(row.team_period_id);
    }
    mcpCfbTeamPeriodsCache = { at: Date.now(), data: envelope };
  }
  return mcpCfbTeamPeriodsCache.data;
}

async function mcpCfbLatestPeriods() {
  if (!mcpCfbLatestPeriodsCache.data || Date.now() - mcpCfbLatestPeriodsCache.at > 900e3) {
    const response = await fetch(`${SITE}/data/cfb-team-week-latest.json`, { cf: { cacheTtlByStatus: { "200-299": 900, "404": 1, "500-599": 0 }, cacheEverything: true } });
    if (!response.ok) throw new Error("cfb-team-week-latest.json unavailable: HTTP " + response.status);
    const envelope = await response.json();
    const data = envelope && envelope.data;
    const rows = data && data.rows;
    if (!envelope || !envelope.as_of || !envelope.source || envelope.graded !== false || !data ||
        data.scope !== "results-only" || !Number.isInteger(data.season) || !data.coverage ||
        typeof data.coverage.fcs_team_records !== "string" || !/not complete FCS/i.test(data.coverage.fcs_team_records) ||
        typeof data.conference_record_definition !== "string" || !/not an official standing/i.test(data.conference_record_definition) ||
        typeof data.input_team_week_snapshot_id !== "string" || !Array.isArray(data.unavailable_metrics) ||
        !Array.isArray(rows) || !rows.length || rows.length > 400)
      throw new Error("cfb-team-week-latest.json has an invalid results-only envelope");
    if (envelope.integrity && Number.isInteger(envelope.integrity.rows) && envelope.integrity.rows !== rows.length)
      throw new Error("cfb-team-week-latest.json row count does not match its integrity receipt");
    const slugs = new Set();
    for (const row of rows) {
      const latest = row && row.latest_period;
      const period = latest && latest.observed_result;
      const season = row && row.season_to_date;
      const conference = row && row.conference_regular_season_to_date;
      if (!row || typeof row.team_slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.team_slug) ||
          slugs.has(row.team_slug) || typeof row.team !== "string" || !row.team || !["fbs", "fcs"].includes(row.division) ||
          !Number.isFinite(Date.parse(row.through_at)) || !latest || !["regular", "postseason"].includes(latest.season_type) ||
          !Number.isInteger(latest.week) || latest.week < 1 || latest.week > 20 || !period || !season || !conference)
        throw new Error("cfb-team-week-latest.json has an invalid or duplicate team row");
      for (const summary of [period, season, conference]) {
        if (![summary.games, summary.wins, summary.losses, summary.ties, summary.points_for,
              summary.points_against, summary.point_differential].every(Number.isInteger) ||
            summary.games !== summary.wins + summary.losses + summary.ties ||
            summary.point_differential !== summary.points_for - summary.points_against)
          throw new Error("cfb-team-week-latest.json has an arithmetically invalid result summary");
      }
      if (typeof season.record !== "string" || !/^\d+-\d+-\d+$/.test(season.record))
        throw new Error("cfb-team-week-latest.json has an invalid season-to-date record");
      slugs.add(row.team_slug);
    }
    mcpCfbLatestPeriodsCache = { at: Date.now(), data: envelope };
  }
  return mcpCfbLatestPeriodsCache.data;
}

async function mcpCfbLatestGames() {
  if (!mcpCfbLatestGamesCache.data || Date.now() - mcpCfbLatestGamesCache.at > 900e3) {
    const response = await fetch(`${SITE}/data/cfb-games-latest.json`, { cf: { cacheTtlByStatus: { "200-299": 900, "404": 1, "500-599": 0 }, cacheEverything: true } });
    if (!response.ok) throw new Error("cfb-games-latest.json unavailable: HTTP " + response.status);
    const envelope = await response.json();
    const data = envelope && envelope.data;
    const rows = data && data.rows;
    const coverage = data && data.coverage;
    if (!envelope || !envelope.as_of || !envelope.source || envelope.graded !== false || !data ||
        data.scope !== "observed-final-results-only" || !Number.isInteger(data.season) ||
        typeof data.input_team_game_snapshot_id !== "string" || !coverage || coverage.final_games_only !== true ||
        coverage.one_row_per_represented_team !== true || !Array.isArray(data.unavailable_metrics) ||
        !Array.isArray(rows) || !rows.length || rows.length > 200)
      throw new Error("cfb-games-latest.json has an invalid observed-results envelope");
    if (envelope.integrity && Number.isInteger(envelope.integrity.rows) && envelope.integrity.rows !== rows.length)
      throw new Error("cfb-games-latest.json row count does not match its integrity receipt");
    const slugs = new Set();
    for (const row of rows) {
      const game = row && row.latest_completed_game;
      if (!row || typeof row.team_slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.team_slug) ||
          slugs.has(row.team_slug) || typeof row.team !== "string" || !row.team ||
          typeof row.conference !== "string" || !row.conference || !game ||
          typeof game.team_game_id !== "string" || !game.team_game_id || typeof game.game_id !== "string" || !game.game_id ||
          !["regular", "postseason"].includes(game.season_type) || !Number.isInteger(game.week) ||
          game.week < 1 || game.week > 20 || !Number.isFinite(Date.parse(game.kickoff_at)) ||
          typeof game.opponent_slug !== "string" || !game.opponent_slug || typeof game.opponent !== "string" || !game.opponent ||
          !["fbs", "fcs"].includes(game.opponent_division) || !["home", "away"].includes(game.team_side) ||
          !["home", "away", "neutral"].includes(game.site) || typeof game.neutral_site !== "boolean" ||
          (game.site === "neutral") !== game.neutral_site || typeof game.conference_game !== "boolean" ||
          !Number.isInteger(game.points_for) || !Number.isInteger(game.points_against) ||
          game.point_differential !== game.points_for - game.points_against || !["win", "loss", "tie"].includes(game.result) ||
          (game.result === "win") !== (game.points_for > game.points_against) ||
          (game.result === "loss") !== (game.points_for < game.points_against) ||
          (game.result === "tie") !== (game.points_for === game.points_against))
        throw new Error("cfb-games-latest.json has an invalid or duplicate team row");
      slugs.add(row.team_slug);
    }
    if (coverage.represented_teams !== rows.length)
      throw new Error("cfb-games-latest.json coverage count does not match its rows");
    mcpCfbLatestGamesCache = { at: Date.now(), data: envelope };
  }
  return mcpCfbLatestGamesCache.data;
}

async function mcpCfbTeamGames() {
  if (!mcpCfbTeamGamesCache.data || Date.now() - mcpCfbTeamGamesCache.at > 900e3) {
    const response = await fetch(`${SITE}/data/cfb-team-game.json`, { cf: { cacheTtlByStatus: { "200-299": 900, "404": 1, "500-599": 0 }, cacheEverything: true } });
    if (!response.ok) throw new Error("cfb-team-game.json unavailable: HTTP " + response.status);
    const envelope = await response.json();
    const data = envelope && envelope.data;
    const teams = data && data.teams;
    const rows = data && data.rows;
    if (!envelope || !envelope.as_of || !envelope.source || !data || !Number.isInteger(data.season) ||
        data.scope !== "results-only" || !teams || typeof teams !== "object" || Array.isArray(teams) ||
        !Array.isArray(rows) || !rows.length || rows.length > 4000 || rows.length % 2 !== 0 ||
        !Array.isArray(data.unavailable_metrics))
      throw new Error("cfb-team-game.json has an invalid results-only envelope");
    if (envelope.integrity && Number.isInteger(envelope.integrity.rows) && envelope.integrity.rows !== rows.length)
      throw new Error("cfb-team-game.json row count does not match its integrity receipt");
    for (const [slug, team] of Object.entries(teams)) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !team || typeof team.team !== "string" || !team.team ||
          !["fbs", "fcs"].includes(team.division))
        throw new Error("cfb-team-game.json has an invalid team registry");
    }
    const ids = new Set();
    const gameCounts = new Map();
    for (const row of rows) {
      if (!row || typeof row.team_game_id !== "string" || !row.team_game_id || ids.has(row.team_game_id) ||
          typeof row.game_id !== "string" || !row.game_id || row.season !== data.season ||
          !["regular", "postseason"].includes(row.season_type) || !Number.isInteger(row.week) ||
          row.week < 1 || row.week > 20 || !Number.isFinite(Date.parse(row.kickoff_at)) || row.status !== "final" ||
          !teams[row.team_slug] || !teams[row.opponent_slug] || row.team_slug === row.opponent_slug ||
          !["home", "away"].includes(row.team_side) || !["home", "away", "neutral"].includes(row.site) ||
          typeof row.neutral_site !== "boolean" || (row.site === "neutral") !== row.neutral_site ||
          !Number.isInteger(row.points_for) || !Number.isInteger(row.points_against) ||
          row.point_differential !== row.points_for - row.points_against ||
          !["win", "loss", "tie"].includes(row.result) ||
          (row.result === "win") !== (row.points_for > row.points_against) ||
          (row.result === "loss") !== (row.points_for < row.points_against) ||
          (row.result === "tie") !== (row.points_for === row.points_against))
        throw new Error("cfb-team-game.json has an invalid or duplicate team-game row");
      ids.add(row.team_game_id);
      gameCounts.set(row.game_id, (gameCounts.get(row.game_id) || 0) + 1);
    }
    if ([...gameCounts.values()].some(count => count !== 2))
      throw new Error("cfb-team-game.json does not contain exactly two mirrored rows per game");
    mcpCfbTeamGamesCache = { at: Date.now(), data: envelope };
  }
  return mcpCfbTeamGamesCache.data;
}

async function mcpCfbHistoricalMarket() {
  if (!mcpCfbMarketCache.data || Date.now() - mcpCfbMarketCache.at > 900e3) {
    const response = await fetch(`${SITE}/data/cfb-market.json`, { cf: { cacheTtlByStatus: { "200-299": 900, "404": 1, "500-599": 0 }, cacheEverything: true } });
    if (!response.ok) throw new Error("cfb-market.json unavailable: HTTP " + response.status);
    const envelope = await response.json();
    const data = envelope && envelope.data;
    const games = data && data.games;
    const provenance = envelope && envelope.provenance;
    if (!envelope || !envelope.as_of || !envelope.source || !data || !Number.isInteger(data.season) ||
        !Array.isArray(games) || !games.length || games.length > 2000 || !provenance ||
        provenance.observation_timestamp_available !== false || provenance.price_timing !== "unknown")
      throw new Error("cfb-market.json does not preserve the unknown-timing historical market contract");
    if (envelope.integrity && Number.isInteger(envelope.integrity.games) && envelope.integrity.games !== games.length)
      throw new Error("cfb-market.json game count does not match its integrity receipt");
    const ids = new Set();
    for (const game of games) {
      if (!game || typeof game.game_id !== "string" || !game.game_id || ids.has(game.game_id) ||
          game.season !== data.season || !Number.isInteger(game.week) || game.week < 1 || game.week > 20 ||
          !Number.isFinite(Date.parse(game.kickoff_at)) || typeof game.home_team !== "string" ||
          typeof game.away_team !== "string" || !Array.isArray(game.books) || game.books.length > 50)
        throw new Error("cfb-market.json has an invalid or duplicate game row");
      const books = new Set();
      for (const quote of game.books) {
        if (!quote || typeof quote.book !== "string" || !quote.book || books.has(quote.book) ||
            !(quote.devig_home_win_probability === null ||
              (typeof quote.devig_home_win_probability === "number" && Number.isFinite(quote.devig_home_win_probability) &&
               quote.devig_home_win_probability >= 0 && quote.devig_home_win_probability <= 1)))
          throw new Error("cfb-market.json has an invalid or duplicate bookmaker quote");
        books.add(quote.book);
      }
      ids.add(game.game_id);
    }
    mcpCfbMarketCache = { at: Date.now(), data: envelope };
  }
  return mcpCfbMarketCache.data;
}

async function mcpCfbModelCards() {
  if (!mcpCfbModelCardsCache.data || Date.now() - mcpCfbModelCardsCache.at > 900e3) {
    const response = await fetch(`${SITE}/data/cfb-model-cards.json`, { cf: { cacheTtlByStatus: { "200-299": 900, "404": 1, "500-599": 0 }, cacheEverything: true } });
    if (!response.ok) throw new Error("cfb-model-cards.json unavailable: HTTP " + response.status);
    const envelope = await response.json();
    const cards = envelope && envelope.data && envelope.data.cards;
    if (!envelope || !envelope.as_of || !envelope.source || envelope.graded !== false ||
        !Array.isArray(cards) || !cards.length || cards.length > 50)
      throw new Error("cfb-model-cards.json has an invalid governance envelope");
    if (envelope.integrity && Number.isInteger(envelope.integrity.cards) && envelope.integrity.cards !== cards.length)
      throw new Error("cfb-model-cards.json card count does not match its integrity receipt");
    const ids = new Set();
    for (const card of cards) {
      if (!card || typeof card.model_id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(card.model_id) ||
          ids.has(card.model_id) || typeof card.model_name !== "string" || !card.model_name ||
          typeof card.model_version !== "string" || !card.model_version || typeof card.purpose !== "string" ||
          typeof card.target !== "string" || !Array.isArray(card.features) || !card.features.length ||
          !card.validation_design || typeof card.validation_design.kind !== "string" ||
          !card.performance || !Array.isArray(card.known_limitations) || !card.known_limitations.length ||
          !Array.isArray(card.failure_modes) || !card.failure_modes.length || !card.receipts ||
          typeof card.receipts.prospective_receipts_exist !== "boolean")
        throw new Error("cfb-model-cards.json has an invalid or duplicate model card");
      ids.add(card.model_id);
    }
    mcpCfbModelCardsCache = { at: Date.now(), data: envelope };
  }
  return mcpCfbModelCardsCache.data;
}

function mcpCfbTeamSlug(v) {
  return String(v || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function mcpCfbTeamArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const extra = Object.keys(args).filter(k => k !== "team");
  if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
  if (typeof args.team !== "string" || !args.team.trim()) throw new Error("team must be a non-empty name or slug");
  if (args.team.trim().length > 80) throw new Error("team is limited to 80 characters");
  const slug = mcpCfbTeamSlug(args.team);
  if (!slug) throw new Error("team must contain letters or numbers");
  return { query: args.team.trim(), slug };
}

function mcpCfbTeamMatch(envelope, input) {
  const teams = envelope.data.teams;
  const exact = teams.filter(team => team.team_slug === input.slug || mcpCfbTeamSlug(team.team) === input.slug);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error("cfb-teams.json has duplicate normalized team names for " + input.query);
  const partial = teams.filter(team => team.team_slug.includes(input.slug) || mcpCfbTeamSlug(team.team).includes(input.slug));
  if (partial.length) {
    const choices = partial.slice(0, 10).map(team => team.team + " (" + team.team_slug + ")").join(", ");
    throw new Error("team is not an exact registry name or slug" + (partial.length > 1 ? " and is ambiguous" : "") + "; try: " + choices);
  }
  throw new Error("team is not present in the dated CFB ratings registry: " + input.query);
}

function mcpCfbDivergenceArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const allowed = ["team", "direction", "conference", "minimum_absolute_rank_gap", "limit"];
  const extra = Object.keys(args).filter(k => !allowed.includes(k));
  if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
  const out = {
    team: args.team === undefined ? null : mcpCfbTeamArgs({ team: args.team }),
    direction: args.direction === undefined ? "all" : args.direction,
    conference: null,
    minimumAbsoluteRankGap: args.minimum_absolute_rank_gap === undefined ? 0 : args.minimum_absolute_rank_gap,
    limit: args.limit === undefined ? 10 : args.limit,
  };
  if (!["all", "record-ahead-of-scoring", "scoring-ahead-of-record", "aligned"].includes(out.direction))
    throw new Error("direction must be all, record-ahead-of-scoring, scoring-ahead-of-record or aligned");
  if (args.conference !== undefined) {
    if (typeof args.conference !== "string" || !args.conference.trim() || args.conference.trim().length > 80)
      throw new Error("conference must be a non-empty string of at most 80 characters");
    out.conference = args.conference.trim();
  }
  if (!Number.isInteger(out.minimumAbsoluteRankGap) || out.minimumAbsoluteRankGap < 0 || out.minimumAbsoluteRankGap > 135)
    throw new Error("minimum_absolute_rank_gap must be a whole number from 0 through 135");
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 25)
    throw new Error("limit must be a whole number from 1 through 25");
  return out;
}

function mcpCfbDivergenceTeamMatch(rows, input) {
  const exact = rows.filter(row => row.team_slug === input.slug || mcpCfbTeamSlug(row.team) === input.slug);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error("cfb-record-divergence.json has duplicate normalized team names for " + input.query);
  const partial = rows.filter(row => row.team_slug.includes(input.slug) || mcpCfbTeamSlug(row.team).includes(input.slug));
  if (partial.length) {
    const choices = partial.slice(0, 10).map(row => row.team + " (" + row.team_slug + ")").join(", ");
    throw new Error("team is not an exact record-divergence name or slug" + (partial.length > 1 ? " and is ambiguous" : "") + "; try: " + choices);
  }
  throw new Error("team is not present in the dated CFB record-divergence surface: " + input.query);
}

function mcpCfbTeamPeriodArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const allowed = ["team", "week", "season_type", "sort", "limit"];
  const extra = Object.keys(args).filter(k => !allowed.includes(k));
  if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
  const out = {
    team: mcpCfbTeamArgs({ team: args.team }),
    week: args.week === undefined ? null : args.week,
    seasonType: args.season_type === undefined ? "all" : args.season_type,
    sort: args.sort === undefined ? "period-asc" : args.sort,
    limit: args.limit === undefined ? 20 : args.limit,
  };
  if (out.week !== null && (!Number.isInteger(out.week) || out.week < 1 || out.week > 20))
    throw new Error("week must be a whole number from 1 through 20");
  if (!["all", "regular", "postseason"].includes(out.seasonType))
    throw new Error("season_type must be all, regular or postseason");
  if (!["period-asc", "period-desc"].includes(out.sort))
    throw new Error("sort must be period-asc or period-desc");
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 25)
    throw new Error("limit must be a whole number from 1 through 25");
  return out;
}

function mcpCfbTeamPeriodMatch(teams, input) {
  const entries = Object.entries(teams);
  const exact = entries.filter(([slug, team]) => slug === input.slug || mcpCfbTeamSlug(team.team) === input.slug);
  if (exact.length === 1) return { team_slug: exact[0][0], ...exact[0][1] };
  if (exact.length > 1) throw new Error("cfb-team-week.json has duplicate normalized team names for " + input.query);
  const partial = entries.filter(([slug, team]) => slug.includes(input.slug) || mcpCfbTeamSlug(team.team).includes(input.slug));
  if (partial.length) {
    const choices = partial.slice(0, 10).map(([slug, team]) => team.team + " (" + slug + ")").join(", ");
    throw new Error("team is not an exact team-period name or slug" + (partial.length > 1 ? " and is ambiguous" : "") + "; try: " + choices);
  }
  throw new Error("team is not present in the dated CFB team-period surface: " + input.query);
}

function mcpCfbLatestPeriodArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const allowed = ["team", "division", "conference", "season_type", "period_outcome", "sort", "offset", "limit"];
  const extra = Object.keys(args).filter(k => !allowed.includes(k));
  if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
  const out = {
    team: args.team === undefined ? null : mcpCfbTeamArgs({ team: args.team }),
    division: args.division === undefined ? "all" : args.division,
    conference: null,
    seasonType: args.season_type === undefined ? "all" : args.season_type,
    periodOutcome: args.period_outcome === undefined ? "all" : args.period_outcome,
    sort: args.sort === undefined ? "team-asc" : args.sort,
    offset: args.offset === undefined ? 0 : args.offset,
    limit: args.limit === undefined ? 25 : args.limit,
  };
  if (!["all", "fbs", "fcs"].includes(out.division)) throw new Error("division must be all, fbs or fcs");
  if (args.conference !== undefined) {
    if (typeof args.conference !== "string" || !args.conference.trim() || args.conference.trim().length > 80)
      throw new Error("conference must be a non-empty string of at most 80 characters");
    out.conference = args.conference.trim();
  }
  if (!["all", "regular", "postseason"].includes(out.seasonType))
    throw new Error("season_type must be all, regular or postseason");
  if (!["all", "positive", "negative", "even"].includes(out.periodOutcome))
    throw new Error("period_outcome must be all, positive, negative or even");
  if (!["team-asc", "through-desc", "conference-record-desc"].includes(out.sort))
    throw new Error("sort must be team-asc, through-desc or conference-record-desc");
  if (!Number.isInteger(out.offset) || out.offset < 0 || out.offset > 399)
    throw new Error("offset must be a whole number from 0 through 399");
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 50)
    throw new Error("limit must be a whole number from 1 through 50");
  return out;
}

function mcpCfbLatestPeriodTeam(rows, input) {
  const exact = rows.filter(row => row.team_slug === input.slug || mcpCfbTeamSlug(row.team) === input.slug);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error("cfb-team-week-latest.json has duplicate normalized team names for " + input.query);
  const partial = rows.filter(row => row.team_slug.includes(input.slug) || mcpCfbTeamSlug(row.team).includes(input.slug));
  if (partial.length) {
    const choices = partial.slice(0, 10).map(row => row.team + " (" + row.team_slug + ")").join(", ");
    throw new Error("team is not an exact latest-period name or slug" + (partial.length > 1 ? " and is ambiguous" : "") + "; try: " + choices);
  }
  throw new Error("team is not present in the dated CFB latest-period surface: " + input.query);
}

function mcpCfbLatestGameArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const allowed = ["team", "conference", "opponent_division", "season_type", "result", "site", "sort", "offset", "limit"];
  const extra = Object.keys(args).filter(k => !allowed.includes(k));
  if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
  const out = {
    team: args.team === undefined ? null : mcpCfbTeamArgs({ team: args.team }),
    conference: null,
    opponentDivision: args.opponent_division === undefined ? "all" : args.opponent_division,
    seasonType: args.season_type === undefined ? "all" : args.season_type,
    result: args.result === undefined ? "all" : args.result,
    site: args.site === undefined ? "all" : args.site,
    sort: args.sort === undefined ? "team-asc" : args.sort,
    offset: args.offset === undefined ? 0 : args.offset,
    limit: args.limit === undefined ? 25 : args.limit,
  };
  if (args.conference !== undefined) {
    if (typeof args.conference !== "string" || !args.conference.trim() || args.conference.trim().length > 80)
      throw new Error("conference must be a non-empty string of at most 80 characters");
    out.conference = args.conference.trim();
  }
  if (!["all", "fbs", "fcs"].includes(out.opponentDivision))
    throw new Error("opponent_division must be all, fbs or fcs");
  if (!["all", "regular", "postseason"].includes(out.seasonType))
    throw new Error("season_type must be all, regular or postseason");
  if (!["all", "win", "loss", "tie"].includes(out.result))
    throw new Error("result must be all, win, loss or tie");
  if (!["all", "home", "away", "neutral"].includes(out.site))
    throw new Error("site must be all, home, away or neutral");
  if (!["team-asc", "kickoff-desc"].includes(out.sort))
    throw new Error("sort must be team-asc or kickoff-desc");
  if (!Number.isInteger(out.offset) || out.offset < 0 || out.offset > 199)
    throw new Error("offset must be a whole number from 0 through 199");
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 50)
    throw new Error("limit must be a whole number from 1 through 50");
  return out;
}

function mcpCfbLatestGameTeam(rows, input) {
  const exact = rows.filter(row => row.team_slug === input.slug || mcpCfbTeamSlug(row.team) === input.slug);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error("cfb-games-latest.json has duplicate normalized team names for " + input.query);
  const partial = rows.filter(row => row.team_slug.includes(input.slug) || mcpCfbTeamSlug(row.team).includes(input.slug));
  if (partial.length) {
    const choices = partial.slice(0, 10).map(row => row.team + " (" + row.team_slug + ")").join(", ");
    throw new Error("team is not an exact latest-game name or slug" + (partial.length > 1 ? " and is ambiguous" : "") + "; try: " + choices);
  }
  throw new Error("team is not present in the dated CFB latest-game surface: " + input.query);
}

function mcpCfbTeamGameArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const allowed = ["team", "opponent", "week", "season_type", "result", "site", "sort", "limit"];
  const extra = Object.keys(args).filter(k => !allowed.includes(k));
  if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
  const out = {
    team: mcpCfbTeamArgs({ team: args.team }),
    opponent: args.opponent === undefined ? null : mcpCfbTeamArgs({ team: args.opponent }),
    week: args.week === undefined ? null : args.week,
    seasonType: args.season_type === undefined ? "all" : args.season_type,
    result: args.result === undefined ? "all" : args.result,
    site: args.site === undefined ? "all" : args.site,
    sort: args.sort === undefined ? "kickoff-asc" : args.sort,
    limit: args.limit === undefined ? 25 : args.limit,
  };
  if (out.opponent && out.opponent.slug === out.team.slug) throw new Error("team and opponent must name different teams");
  if (out.week !== null && (!Number.isInteger(out.week) || out.week < 1 || out.week > 20))
    throw new Error("week must be a whole number from 1 through 20");
  if (!["all", "regular", "postseason"].includes(out.seasonType))
    throw new Error("season_type must be all, regular or postseason");
  if (!["all", "win", "loss", "tie"].includes(out.result))
    throw new Error("result must be all, win, loss or tie");
  if (!["all", "home", "away", "neutral"].includes(out.site))
    throw new Error("site must be all, home, away or neutral");
  if (!["kickoff-asc", "kickoff-desc"].includes(out.sort))
    throw new Error("sort must be kickoff-asc or kickoff-desc");
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 50)
    throw new Error("limit must be a whole number from 1 through 50");
  return out;
}

function mcpCfbTeamGameMatch(teams, input) {
  const entries = Object.entries(teams);
  const exact = entries.filter(([slug, team]) => slug === input.slug || mcpCfbTeamSlug(team.team) === input.slug);
  if (exact.length === 1) return { team_slug: exact[0][0], ...exact[0][1] };
  if (exact.length > 1) throw new Error("cfb-team-game.json has duplicate normalized team names for " + input.query);
  const partial = entries.filter(([slug, team]) => slug.includes(input.slug) || mcpCfbTeamSlug(team.team).includes(input.slug));
  if (partial.length) {
    const choices = partial.slice(0, 10).map(([slug, team]) => team.team + " (" + slug + ")").join(", ");
    throw new Error("team is not an exact team-game name or slug" + (partial.length > 1 ? " and is ambiguous" : "") + "; try: " + choices);
  }
  throw new Error("team is not present in the dated CFB team-game surface: " + input.query);
}

/* ==================== the two merged CFB find surfaces ====================
 * `dd_find_cfb_team_games` and `dd_find_cfb_team_periods` each cover a PARENT surface
 * (one team, longitudinal) and its DERIVED cross-sectional view (every team's latest).
 * They used to be four tools. Two names a model has to choose between, whose difference
 * is one word, is a discovery hazard: `latest_games` got picked for questions that wanted
 * `team_games`.
 *
 * ⚠️ A PARAMETER BELONGING TO THE OTHER SCOPE MUST BE REFUSED, NOT IGNORED. Ignoring it
 * answers a question the caller did not ask and looks like success. The refusal is not new
 * code: each scope DELEGATES to its original unchanged parser, and those already reject
 * unknown fields by name against their own `allowed` list. The list below is only a
 * first-pass check that can name the scope in the message; the delegated parser is the
 * backstop, so a drift between them can make an error message worse and can never let an
 * invalid field through.
 *
 * ⚠️ `required: ["team"]` LEFT THE JSON SCHEMA because the requirement is now conditional
 * on the scope, and a schema that cannot express a rule must not pretend to. It is
 * enforced below with an error that says which scope needs it and which one does not.
 */
const MCP_CFB_SCOPE_FIELDS = {
  "dd_find_cfb_team_games": {
    "team-games": ["team", "opponent", "week", "season_type", "result", "site", "sort", "limit"],
    "latest-per-team": ["team", "conference", "opponent_division", "season_type", "result", "site", "sort", "offset", "limit"],
  },
  "dd_find_cfb_team_periods": {
    "team-periods": ["team", "week", "season_type", "sort", "limit"],
    "latest-per-team": ["team", "division", "conference", "season_type", "period_outcome", "sort", "offset", "limit"],
  },
};

function mcpCfbScopeArgs(tool, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const scopes = MCP_CFB_SCOPE_FIELDS[tool];
  const names = Object.keys(scopes);
  const scope = args.scope === undefined ? names[0] : args.scope;
  if (!names.includes(scope)) throw new Error("scope must be " + names.join(" or "));
  const allowed = scopes[scope];
  const extra = Object.keys(args).filter(k => k !== "scope" && !allowed.includes(k));
  if (extra.length)
    throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + " for scope " + scope + ": " + extra.join(", ") +
      " (supported: " + allowed.join(", ") + ")");
  // The default scope wants one exact team; the derived scope is cross-team by design.
  if (scope !== "latest-per-team" && args.team === undefined)
    throw new Error("team is required when scope is " + scope + "; use scope latest-per-team for bounded cross-team discovery");
  const rest = { ...args };
  delete rest.scope;
  return { scope, rest };
}

async function mcpCfbTeamGamesScoped(args) {
  const { scope, rest } = mcpCfbScopeArgs("dd_find_cfb_team_games", args);
  if (scope === "latest-per-team") return mcpCfbLatestGamesRun({ scope, ...mcpCfbLatestGameArgs(rest) });
  return mcpCfbTeamGamesRun({ scope, ...mcpCfbTeamGameArgs(rest) });
}

async function mcpCfbTeamPeriodsScoped(args) {
  const { scope, rest } = mcpCfbScopeArgs("dd_find_cfb_team_periods", args);
  if (scope === "latest-per-team") return mcpCfbLatestPeriodsRun({ scope, ...mcpCfbLatestPeriodArgs(rest) });
  return mcpCfbTeamPeriodsRun({ scope, ...mcpCfbTeamPeriodArgs(rest) });
}

async function mcpCfbTeamGamesRun(input) {
  const envelope = await mcpCfbTeamGames();
  const team = mcpCfbTeamGameMatch(envelope.data.teams, input.team);
  const opponent = input.opponent ? mcpCfbTeamGameMatch(envelope.data.teams, input.opponent) : null;
  const direction = input.sort === "kickoff-asc" ? 1 : -1;
  const matches = envelope.data.rows.filter(row =>
    row.team_slug === team.team_slug &&
    (!opponent || row.opponent_slug === opponent.team_slug) &&
    (input.week === null || row.week === input.week) &&
    (input.seasonType === "all" || row.season_type === input.seasonType) &&
    (input.result === "all" || row.result === input.result) &&
    (input.site === "all" || row.site === input.site)
  ).sort((a, b) => direction * (a.kickoff_at.localeCompare(b.kickoff_at) || a.team_game_id.localeCompare(b.team_game_id)));
  const games = matches.slice(0, input.limit).map(row => ({
    team_game_id: row.team_game_id,
    game_id: row.game_id,
    upstream_game_id: row.upstream_game_id,
    season: row.season,
    season_type: row.season_type,
    week: row.week,
    kickoff_at: row.kickoff_at,
    status: row.status,
    opponent: { team_slug: row.opponent_slug, team: envelope.data.teams[row.opponent_slug].team },
    team_side: row.team_side,
    site: row.site,
    neutral_site: row.neutral_site,
    conference_game: row.conference_game,
    points_for: row.points_for,
    points_against: row.points_against,
    point_differential: row.point_differential,
    result: row.result,
  }));
  return toolText({
    query: {
      scope: input.scope,
      team: team.team,
      opponent: opponent ? opponent.team : null,
      week: input.week,
      season_type: input.seasonType,
      result: input.result,
      site: input.site,
      sort: input.sort,
      limit: input.limit,
    },
    team,
    season: envelope.data.season,
    scope: envelope.data.scope,
    response_shape: "team-game-rows",
    matched_before_limit: matches.length,
    returned: games.length,
    games,
    unavailable_metrics: envelope.data.unavailable_metrics,
    as_of: envelope.as_of,
    source: envelope.source,
    built: envelope.built || null,
    integrity: envelope.integrity || null,
    observed_results_only: true,
    modelled: false,
    opponent_adjusted: false,
    market_adjusted: false,
    forecast: false,
    graded: false,
    read_only: true,
    stored: false,
    warnings: [
      "These are observed schedule-derived 2025 team-game facts, not current 2026 form or a forecast.",
      "The same canonical game has one mirrored row per team; points and result are returned from the selected team's perspective.",
      "EPA, success, explosiveness, havoc, garbage-time, opponent-adjusted and market-performance fields are unavailable in this results-only layer.",
    ],
  });
}

async function mcpCfbLatestGamesRun(input) {
  const envelope = await mcpCfbLatestGames();
  const allRows = envelope.data.rows;
  const team = input.team ? mcpCfbLatestGameTeam(allRows, input.team) : null;
  let conference = null;
  if (input.conference) {
    const conferences = [...new Set(allRows.map(row => row.conference))].sort((a, b) => a.localeCompare(b));
    conference = conferences.find(name => name.toLowerCase() === input.conference.toLowerCase()) || null;
    if (!conference) throw new Error("conference is not present in the dated CFB latest-game surface; available: " + conferences.join(", "));
  }
  const matches = allRows.filter(row => {
    const game = row.latest_completed_game;
    return (!team || row.team_slug === team.team_slug) && (!conference || row.conference === conference) &&
      (input.opponentDivision === "all" || game.opponent_division === input.opponentDivision) &&
      (input.seasonType === "all" || game.season_type === input.seasonType) &&
      (input.result === "all" || game.result === input.result) &&
      (input.site === "all" || game.site === input.site);
  }).sort((a, b) => input.sort === "team-asc"
    ? a.team.localeCompare(b.team) || a.team_slug.localeCompare(b.team_slug)
    : b.latest_completed_game.kickoff_at.localeCompare(a.latest_completed_game.kickoff_at) || a.team.localeCompare(b.team));
  const rows = matches.slice(input.offset, input.offset + input.limit);
  return toolText({
    query: { scope: input.scope, team: team ? team.team : null, conference, opponent_division: input.opponentDivision,
      season_type: input.seasonType, result: input.result, site: input.site,
      sort: input.sort, offset: input.offset, limit: input.limit },
    season: envelope.data.season,
    scope: envelope.data.scope,
    coverage: envelope.data.coverage,
    selection: envelope.data.selection,
    response_shape: "latest-per-team-rows",
    matched_before_pagination: matches.length,
    returned: rows.length,
    rows,
    unavailable_metrics: envelope.data.unavailable_metrics,
    as_of: envelope.as_of,
    source: envelope.source,
    integrity: envelope.integrity || null,
    observed_results_only: true,
    current_2026_form: false,
    forecast: false,
    modelled: false,
    graded: false,
    read_only: true,
    stored: false,
    warnings: [
      "Latest means each FBS team's last completed game in the dated 2025 surface, not current 2026 form.",
      "The same canonical game can appear once for each FBS participant; scores and results use each team's perspective.",
      "EPA, opponent-adjusted and market-performance metrics are unavailable in this observed-results surface.",
    ],
  });
}

async function mcpCfbTeamPeriodsRun(input) {
  const envelope = await mcpCfbTeamPeriods();
  const team = mcpCfbTeamPeriodMatch(envelope.data.teams, input.team);
  const direction = input.sort === "period-asc" ? 1 : -1;
  const matches = envelope.data.rows.filter(row =>
    row.team_slug === team.team_slug &&
    (input.week === null || row.week === input.week) &&
    (input.seasonType === "all" || row.season_type === input.seasonType)
  ).sort((a, b) => direction * (a.through_at.localeCompare(b.through_at) || a.team_period_id.localeCompare(b.team_period_id)));
  const periods = matches.slice(0, input.limit).map(row => ({
    team_period_id: row.team_period_id,
    season: row.season,
    season_type: row.season_type,
    week: row.week,
    period_key: row.period_key,
    through_at: row.through_at,
    scheduled_games_this_period: row.scheduled_games_this_period,
    opponent_slugs: row.opponent_slugs,
    venue_counts: { home: row.home_games, away: row.away_games, neutral: row.neutral_games },
    fbs_opponents: row.fbs_opponents,
    period: row.period,
    season_to_date: row.season_to_date,
    conference_regular_season_to_date: row.conference_regular_season_to_date,
  }));
  return toolText({
    query: {
      scope: input.scope,
      team: team.team,
      week: input.week,
      season_type: input.seasonType,
      sort: input.sort,
      limit: input.limit,
    },
    team,
    season: envelope.data.season,
    scope: envelope.data.scope,
    period_definition: envelope.data.period_definition,
    conference_record_definition: envelope.data.conference_record_definition,
    response_shape: "team-period-rows",
    matched_before_limit: matches.length,
    returned: periods.length,
    periods,
    unavailable_metrics: envelope.data.unavailable_metrics,
    as_of: envelope.as_of,
    source: envelope.source,
    built: envelope.built || null,
    integrity: envelope.integrity || null,
    observed_results_only: true,
    modelled: false,
    opponent_adjusted: false,
    market_adjusted: false,
    forecast: false,
    graded: false,
    read_only: true,
    stored: false,
    warnings: [
      "These are observed schedule-derived 2025 results, not current 2026 form or a forecast.",
      "Regular-season week 1 and postseason week 1 are distinct periods; use season_type when filtering a repeated week number.",
      "Conference records include only final regular-season rows marked conference_game and are not official standings, ranks or tiebreakers.",
      "EPA, success, explosiveness, havoc, garbage-time, opponent-adjusted and market-performance fields are unavailable in this results-only layer.",
      "Period rows can contain more than one scheduled game; scheduled_games_this_period is explicit.",
    ],
  });
}

async function mcpCfbLatestPeriodsRun(input) {
  const envelope = await mcpCfbLatestPeriods();
  const allRows = envelope.data.rows;
  const team = input.team ? mcpCfbLatestPeriodTeam(allRows, input.team) : null;
  let conference = null;
  if (input.conference) {
    const conferences = [...new Set(allRows.map(row => row.conference).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    conference = conferences.find(name => name.toLowerCase() === input.conference.toLowerCase()) || null;
    if (!conference) throw new Error("conference is not present in the dated CFB latest-period surface; available: " + conferences.join(", "));
  }
  const outcomeMatches = row => {
    const differential = row.latest_period.observed_result.point_differential;
    return input.periodOutcome === "all" || (input.periodOutcome === "positive" && differential > 0) ||
      (input.periodOutcome === "negative" && differential < 0) || (input.periodOutcome === "even" && differential === 0);
  };
  const conferenceWinPercentage = row => {
    const record = row.conference_regular_season_to_date;
    return record.games ? (record.wins + 0.5 * record.ties) / record.games : -1;
  };
  const matches = allRows.filter(row =>
    (!team || row.team_slug === team.team_slug) &&
    (input.division === "all" || row.division === input.division) &&
    (!conference || row.conference === conference) &&
    (input.seasonType === "all" || row.latest_period.season_type === input.seasonType) && outcomeMatches(row)
  ).sort((a, b) => {
    if (input.sort === "team-asc") return a.team.localeCompare(b.team) || a.team_slug.localeCompare(b.team_slug);
    if (input.sort === "through-desc") return b.through_at.localeCompare(a.through_at) || a.team.localeCompare(b.team);
    const aRecord = a.conference_regular_season_to_date;
    const bRecord = b.conference_regular_season_to_date;
    return conferenceWinPercentage(b) - conferenceWinPercentage(a) || bRecord.wins - aRecord.wins ||
      bRecord.point_differential - aRecord.point_differential || a.team.localeCompare(b.team);
  });
  const rows = matches.slice(input.offset, input.offset + input.limit);
  return toolText({
    query: { scope: input.scope, team: team ? team.team : null, division: input.division, conference, season_type: input.seasonType,
      period_outcome: input.periodOutcome, sort: input.sort, offset: input.offset, limit: input.limit },
    season: envelope.data.season,
    scope: envelope.data.scope,
    coverage: envelope.data.coverage,
    selection: envelope.data.selection,
    conference_record_definition: envelope.data.conference_record_definition,
    response_shape: "latest-per-team-rows",
    matched_before_pagination: matches.length,
    returned: rows.length,
    rows,
    unavailable_metrics: envelope.data.unavailable_metrics,
    as_of: envelope.as_of,
    source: envelope.source,
    integrity: envelope.integrity || null,
    observed_results_only: true,
    current_2026_form: false,
    forecast: false,
    modelled: false,
    graded: false,
    read_only: true,
    stored: false,
    warnings: [
      "Latest means the last covered period in the dated 2025 FBS-involved schedule, not current 2026 form.",
      "FCS season-to-date records include only games against FBS opponents and are not complete FCS season records.",
      "Conference records include only final regular-season rows marked conference_game and are not official standings, ranks or tiebreakers.",
      "conference-record-desc is a descriptive arithmetic order only; it does not apply conference-specific standings rules.",
      "period_outcome is the sign of the aggregate observed point differential; one period can contain multiple games.",
      "EPA, opponent-adjusted and market-performance metrics are unavailable in this results-only surface.",
    ],
  });
}

function mcpCfbGameArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const allowed = ["game_id", "team", "week", "season_type", "status", "conference", "sort", "limit"];
  const extra = Object.keys(args).filter(k => !allowed.includes(k));
  if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
  const out = {
    gameId: null,
    team: args.team === undefined ? null : mcpCfbTeamArgs({ team: args.team }),
    week: args.week === undefined ? null : args.week,
    seasonType: args.season_type === undefined ? "all" : args.season_type,
    status: args.status === undefined ? "all" : args.status,
    conference: null,
    sort: args.sort === undefined ? "kickoff-desc" : args.sort,
    limit: args.limit === undefined ? 20 : args.limit,
  };
  if (args.game_id !== undefined) {
    if (typeof args.game_id !== "string" || !args.game_id.trim() || args.game_id.trim().length > 150)
      throw new Error("game_id must be a non-empty string of at most 150 characters");
    out.gameId = args.game_id.trim();
  }
  if (out.week !== null && (!Number.isInteger(out.week) || out.week < 1 || out.week > 20))
    throw new Error("week must be a whole number from 1 through 20");
  if (!["all", "regular", "postseason"].includes(out.seasonType))
    throw new Error("season_type must be all, regular or postseason");
  if (!["all", "scheduled", "final"].includes(out.status))
    throw new Error("status must be all, scheduled or final");
  if (args.conference !== undefined) {
    if (typeof args.conference !== "string" || !args.conference.trim() || args.conference.trim().length > 80)
      throw new Error("conference must be a non-empty string of at most 80 characters");
    out.conference = args.conference.trim();
  }
  if (!["kickoff-asc", "kickoff-desc"].includes(out.sort))
    throw new Error("sort must be kickoff-asc or kickoff-desc");
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 50)
    throw new Error("limit must be a whole number from 1 through 50");
  return out;
}

function mcpCfbScheduleTeam(games, input) {
  const teams = new Map();
  for (const game of games) {
    teams.set(game.home_team_slug, game.home_team);
    teams.set(game.away_team_slug, game.away_team);
  }
  const exact = [...teams].filter(([slug, name]) => slug === input.slug || mcpCfbTeamSlug(name) === input.slug);
  if (exact.length === 1) return { team_slug: exact[0][0], team: exact[0][1] };
  if (exact.length > 1) throw new Error("cfb-schedule.json has duplicate normalized team names for " + input.query);
  const partial = [...teams].filter(([slug, name]) => slug.includes(input.slug) || mcpCfbTeamSlug(name).includes(input.slug));
  if (partial.length) {
    const choices = partial.slice(0, 10).map(([slug, name]) => name + " (" + slug + ")").join(", ");
    throw new Error("team is not an exact canonical schedule name or slug" + (partial.length > 1 ? " and is ambiguous" : "") + "; try: " + choices);
  }
  throw new Error("team is not present in the dated canonical CFB schedule: " + input.query);
}

function mcpCfbMarketArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const allowed = ["game_id", "team", "week", "book", "priced_only", "sort", "limit"];
  const extra = Object.keys(args).filter(k => !allowed.includes(k));
  if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
  const out = {
    gameId: null,
    team: args.team === undefined ? null : mcpCfbTeamArgs({ team: args.team }),
    week: args.week === undefined ? null : args.week,
    book: null,
    pricedOnly: args.priced_only === true,
    sort: args.sort === undefined ? "kickoff-desc" : args.sort,
    limit: args.limit === undefined ? 20 : args.limit,
  };
  if (args.game_id !== undefined) {
    if (typeof args.game_id !== "string" || !args.game_id.trim() || args.game_id.trim().length > 150)
      throw new Error("game_id must be a non-empty string of at most 150 characters");
    out.gameId = args.game_id.trim();
  }
  if (out.week !== null && (!Number.isInteger(out.week) || out.week < 1 || out.week > 20))
    throw new Error("week must be a whole number from 1 through 20");
  if (args.book !== undefined) {
    if (typeof args.book !== "string" || !args.book.trim() || args.book.trim().length > 80)
      throw new Error("book must be a non-empty string of at most 80 characters");
    out.book = args.book.trim();
  }
  if (args.priced_only !== undefined && typeof args.priced_only !== "boolean")
    throw new Error("priced_only must be true or false");
  if (!["kickoff-asc", "kickoff-desc"].includes(out.sort))
    throw new Error("sort must be kickoff-asc or kickoff-desc");
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 25)
    throw new Error("limit must be a whole number from 1 through 25");
  return out;
}

function mcpCfbMarketTeam(games, input) {
  const teams = new Map();
  for (const game of games) {
    teams.set(mcpCfbTeamSlug(game.home_team), game.home_team);
    teams.set(mcpCfbTeamSlug(game.away_team), game.away_team);
  }
  const exact = [...teams].filter(([slug, name]) => slug === input.slug || mcpCfbTeamSlug(name) === input.slug);
  if (exact.length === 1) return { team_slug: exact[0][0], team: exact[0][1] };
  if (exact.length > 1) throw new Error("cfb-market.json has duplicate normalized team names for " + input.query);
  const partial = [...teams].filter(([slug, name]) => slug.includes(input.slug) || mcpCfbTeamSlug(name).includes(input.slug));
  if (partial.length) {
    const choices = partial.slice(0, 10).map(([slug, name]) => name + " (" + slug + ")").join(", ");
    throw new Error("team is not an exact historical market name or slug" + (partial.length > 1 ? " and is ambiguous" : "") + "; try: " + choices);
  }
  throw new Error("team is not present in the dated historical CFB market surface: " + input.query);
}

function mcpCfbModelCardArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const extra = Object.keys(args).filter(k => k !== "model_id");
  if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
  if (args.model_id === undefined) return { modelId: null };
  if (typeof args.model_id !== "string" || !args.model_id.trim() || args.model_id.trim().length > 80)
    throw new Error("model_id must be a non-empty string of at most 80 characters");
  const modelId = args.model_id.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(modelId)) throw new Error("model_id must be a lowercase slug");
  return { modelId };
}

function mcpCfbRatingSystemArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const extra = Object.keys(args).filter(k => k !== "system_id");
  if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
  if (args.system_id === undefined) return { systemId: null };
  if (typeof args.system_id !== "string" || !args.system_id.trim() || args.system_id.trim().length > 80)
    throw new Error("system_id must be a non-empty string of at most 80 characters");
  const systemId = args.system_id.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(systemId)) throw new Error("system_id must be a lowercase slug");
  return { systemId };
}

function mcpCfbRankingArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const allowed = ["system_id", "conference", "offset", "limit"];
  const extra = Object.keys(args).filter(k => !allowed.includes(k));
  if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
  const out = {
    systemId: null,
    conference: null,
    offset: args.offset === undefined ? 0 : args.offset,
    limit: args.limit === undefined ? 25 : args.limit,
  };
  if (args.system_id !== undefined) {
    if (typeof args.system_id !== "string" || !args.system_id.trim() || args.system_id.trim().length > 80)
      throw new Error("system_id must be a non-empty string of at most 80 characters");
    out.systemId = args.system_id.trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(out.systemId)) throw new Error("system_id must be a lowercase slug");
  }
  if (args.conference !== undefined) {
    if (typeof args.conference !== "string" || !args.conference.trim() || args.conference.trim().length > 80)
      throw new Error("conference must be a non-empty string of at most 80 characters");
    out.conference = args.conference.trim();
  }
  if (!Number.isInteger(out.offset) || out.offset < 0 || out.offset > 199)
    throw new Error("offset must be a whole number from 0 through 199");
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 50)
    throw new Error("limit must be a whole number from 1 through 50");
  return out;
}

function mcpCfbCompareArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const extra = Object.keys(args).filter(k => !["team_a", "team_b"].includes(k));
  if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
  const teamA = mcpCfbTeamArgs({ team: args.team_a });
  const teamB = mcpCfbTeamArgs({ team: args.team_b });
  if (teamA.slug === teamB.slug) throw new Error("team_a and team_b must name different teams");
  return { teamA, teamB };
}

function mcpCfbProjectionArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const extra = Object.keys(args).filter(k => !["home_team", "away_team", "neutral_site"].includes(k));
  if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
  const homeTeam = mcpCfbTeamArgs({ team: args.home_team });
  const awayTeam = mcpCfbTeamArgs({ team: args.away_team });
  if (homeTeam.slug === awayTeam.slug) throw new Error("home_team and away_team must name different teams");
  if (args.neutral_site !== undefined && typeof args.neutral_site !== "boolean")
    throw new Error("neutral_site must be true or false");
  return { homeTeam, awayTeam, neutralSite: args.neutral_site === true };
}

function mcpCfbScheduleArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const extra = Object.keys(args).filter(k => !["team", "games", "minimum_wins"].includes(k));
  if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
  const team = mcpCfbTeamArgs({ team: args.team });
  if (!Array.isArray(args.games) || !args.games.length) throw new Error("games must contain at least one hypothetical matchup");
  if (args.games.length > 20) throw new Error("games is limited to 20 hypothetical matchups");
  const games = args.games.map((raw, i) => {
    const label = "games[" + i + "]";
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(label + " must be an object");
    const gameExtra = Object.keys(raw).filter(k => !["opponent", "venue", "label"].includes(k));
    if (gameExtra.length) throw new Error(label + " has unsupported field" + (gameExtra.length > 1 ? "s" : "") + ": " + gameExtra.join(", "));
    const opponent = mcpCfbTeamArgs({ team: raw.opponent });
    const venue = raw.venue === undefined ? "neutral" : raw.venue;
    if (!["home", "away", "neutral"].includes(venue)) throw new Error(label + ".venue must be home, away or neutral");
    if (raw.label !== undefined && (typeof raw.label !== "string" || !raw.label.trim() || raw.label.trim().length > 80))
      throw new Error(label + ".label must be a non-empty string of at most 80 characters");
    return { opponent, venue, label: raw.label === undefined ? null : raw.label.trim() };
  });
  const minimumWins = args.minimum_wins === undefined ? null : args.minimum_wins;
  if (minimumWins !== null && (!Number.isInteger(minimumWins) || minimumWins < 0 || minimumWins > games.length))
    throw new Error("minimum_wins must be a whole number from 0 through the number of games");
  return { team, games, minimumWins };
}

function mcpCfbMatchupProbability(system, focalRating, opponentRating, venue) {
  const transform = system.matchup_probability;
  if (!transform || transform.available !== true) return null;
  if (!focalRating || !opponentRating || !Number.isFinite(focalRating.team_strength) || !Number.isFinite(opponentRating.team_strength))
    throw new Error("team strength is missing for registered system " + system.system_id);
  if (!Number.isFinite(transform.elo_scale) || transform.elo_scale <= 0 ||
      !Number.isFinite(transform.home_field_elo) || !Number.isFinite(transform.neutral_site_home_field_elo))
    throw new Error("invalid matchup transform for registered system " + system.system_id);
  const hfa = venue === "neutral" ? transform.neutral_site_home_field_elo : transform.home_field_elo;
  const homeStrength = venue === "away" ? opponentRating.team_strength : focalRating.team_strength;
  const awayStrength = venue === "away" ? focalRating.team_strength : opponentRating.team_strength;
  const pHome = 1 / (1 + 10 ** (-(homeStrength - awayStrength + hfa) / transform.elo_scale));
  return {
    focal_win_probability: venue === "away" ? 1 - pHome : pHome,
    venue_adjustment_elo: hfa,
    focal_is_formula_home_team: venue !== "away",
  };
}

function mcpCfbPoissonBinomial(probabilities) {
  let distribution = [1];
  for (const p of probabilities) {
    const next = new Array(distribution.length + 1).fill(0);
    for (let wins = 0; wins < distribution.length; wins++) {
      next[wins] += distribution[wins] * (1 - p);
      next[wins + 1] += distribution[wins] * p;
    }
    distribution = next;
  }
  return distribution;
}

function mcpCfbProbabilityAtLeast(distribution, wins) {
  if (wins <= 0) return 1;
  if (wins >= distribution.length) return 0;
  return distribution.slice(wins).reduce((sum, probability) => sum + probability, 0);
}

function mcpCfbObservedView(team) {
  const observed = team.observed_results || {};
  return {
    season: observed.season,
    through_at: observed.through_at,
    record: observed.record,
    games: observed.games,
    wins: observed.wins,
    losses: observed.losses,
    ties: observed.ties,
    win_percentage: observed.win_percentage,
    points_for_per_game: observed.points_for_per_game,
    points_against_per_game: observed.points_against_per_game,
    point_differential_per_game: observed.point_differential_per_game,
  };
}

function mcpModelScoreboardString(v, label, max) {
  if (typeof v !== "string" || !v.trim()) throw new Error(label + " must be a non-empty string");
  const s = v.trim();
  if (s.length > max) throw new Error(label + " is limited to " + max + " characters");
  return s;
}

function mcpModelScoreboardInt(v, label, lo, hi) {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(label + " must be a whole number from " + lo + " to " + hi);
  return v;
}

function mcpModelScoreboardArgs(args) {
  const allowed = ["season", "week", "team", "game_id", "model_ids", "limit", "sort"];
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const extra = Object.keys(args).filter(k => !allowed.includes(k));
  if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
  const out = {};
  if (args.season !== undefined) out.season = mcpModelScoreboardInt(args.season, "season", 2000, 2100);
  if (args.week !== undefined) out.week = mcpModelScoreboardInt(args.week, "week", 1, 22);
  if (args.team !== undefined) {
    out.team = mcpModelScoreboardString(args.team, "team", 5).toUpperCase();
    if (!/^[A-Z]{2,5}$/.test(out.team)) throw new Error("team must be a 2-5 letter abbreviation");
  }
  if (args.game_id !== undefined) {
    out.game_id = mcpModelScoreboardString(args.game_id, "game_id", 80).toUpperCase();
    if (!/^\d{4}_\d{2}_[A-Z]{2,5}_[A-Z]{2,5}$/.test(out.game_id))
      throw new Error("game_id must use season_week_away_home, for example 2026_01_CLE_PIT");
  }
  if (args.model_ids !== undefined) {
    if (!Array.isArray(args.model_ids) || !args.model_ids.length || args.model_ids.length > 10)
      throw new Error("model_ids must contain 1-10 model ids");
    out.model_ids = args.model_ids.map((v, i) => {
      const s = mcpModelScoreboardString(v, "model_ids[" + i + "]", 40).toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) throw new Error("model_ids must be lowercase slugs");
      return s;
    });
    if (new Set(out.model_ids).size !== out.model_ids.length) throw new Error("model_ids must not contain duplicates");
  }
  out.limit = args.limit === undefined ? 25 : mcpModelScoreboardInt(args.limit, "limit", 1, 50);
  out.sort = args.sort === undefined ? "disagreement" : args.sort;
  if (!['disagreement', 'kickoff'].includes(out.sort)) throw new Error("sort must be disagreement or kickoff");
  return out;
}

function mcpModelScoreboardRows(envelope, input) {
  const prospective = envelope.data.filter(r => r && r.forecast_status === "prospective");
  if (!prospective.length) throw new Error("model-receipts.json has no prospective receipts");
  const latestSeason = prospective.reduce((n, r) => Math.max(n, Number(r.season) || 0), 0);
  const season = input.season === undefined ? latestSeason : input.season;
  // No-argument calls intentionally match the human Week 1 board. A caller who
  // supplies any locator can omit week to search the full selected season.
  const defaultWeek = input.season === undefined && input.week === undefined && !input.team && !input.game_id && !input.model_ids;
  const week = defaultWeek ? 1 : input.week;
  const preferredModelOrder = new Map([["nfelo", 0], ["538-classic", 1]]);
  const allModelIds = Array.from(new Set(prospective.filter(r => r.season === season).map(r => r.model_id)))
    .sort((a, b) => (preferredModelOrder.get(a) ?? 999) - (preferredModelOrder.get(b) ?? 999) || a.localeCompare(b));
  const requestedModels = input.model_ids || allModelIds;
  const requestedSet = new Set(requestedModels);
  const latest = new Map();
  for (const r of prospective) {
    if (r.season !== season || (week !== undefined && r.week !== week)) continue;
    if (input.team && r.home_team !== input.team && r.away_team !== input.team) continue;
    if (input.game_id && r.game_id !== input.game_id) continue;
    if (!requestedSet.has(r.model_id)) continue;
    if (typeof r.home_win_probability !== "number" || !Number.isFinite(r.home_win_probability) || r.home_win_probability < 0 || r.home_win_probability > 1)
      throw new Error("receipt " + (r.forecast_id || "unknown") + " has an invalid home_win_probability");
    const capturedMs = Date.parse(r.captured_at);
    if (!Number.isFinite(capturedMs)) throw new Error("receipt " + (r.forecast_id || "unknown") + " has an invalid captured_at");
    const key = r.game_id + "|" + r.model_id;
    const prior = latest.get(key);
    if (!prior || capturedMs > Date.parse(prior.captured_at)) latest.set(key, r);
  }
  const grouped = new Map();
  for (const r of latest.values()) {
    if (!grouped.has(r.game_id)) grouped.set(r.game_id, []);
    grouped.get(r.game_id).push(r);
  }
  const modelOrder = new Map(requestedModels.map((id, i) => [id, i]));
  const games = Array.from(grouped.values()).map(receipts => {
    receipts.sort((a, b) => (modelOrder.get(a.model_id) ?? 999) - (modelOrder.get(b.model_id) ?? 999) || a.model_id.localeCompare(b.model_id));
    const first = receipts[0];
    for (const r of receipts) {
      if (r.season !== first.season || r.week !== first.week || r.kickoff_at !== first.kickoff_at ||
          r.home_team !== first.home_team || r.away_team !== first.away_team || r.schedule_snapshot_id !== first.schedule_snapshot_id)
        throw new Error("receipt game facts disagree for " + first.game_id);
    }
    const summary = mcpCalcBeliefSummary(receipts.map(r => r.home_win_probability));
    return {
      game_id: first.game_id, season: first.season, week: first.week, kickoff_at: first.kickoff_at,
      away_team: first.away_team, home_team: first.home_team,
      models: receipts.map(r => ({
        model_id: r.model_id, model_name: r.model_name, model_version: r.model_version,
        home_win_probability: r.home_win_probability, forecast_id: r.forecast_id,
        captured_at: r.captured_at, source_repo: r.source_repo, source_commit: r.source_commit,
        source_capture_at: r.source_capture_at, input_snapshot_id: r.input_snapshot_id,
        schedule_snapshot_id: r.schedule_snapshot_id, methodology_url: r.methodology_url,
        license_status: r.license_status,
      })),
      descriptive_summary: summary,
      requested_models: requestedModels.length,
      models_present: receipts.length,
      complete_comparable_set: requestedModels.every(id => receipts.some(r => r.model_id === id)),
      graded: false, outcome: null,
    };
  });
  games.sort(input.sort === "kickoff"
    ? (a, b) => String(a.kickoff_at).localeCompare(String(b.kickoff_at)) || a.game_id.localeCompare(b.game_id)
    : (a, b) => b.descriptive_summary.range - a.descriptive_summary.range || String(a.kickoff_at).localeCompare(String(b.kickoff_at)) || a.game_id.localeCompare(b.game_id));
  return { season, week: week === undefined ? null : week, availableModelIds: allModelIds, requestedModels, matched: games.length, games: games.slice(0, input.limit) };
}

// Resolve the credential in the URL (or header) to a caller.
//   { kind:"user", name, uid }  — a per-user token, matched by HASH against /users
//   { kind:"shared" }           — the legacy league passphrase; anonymous
//   null                        — no match; the caller gets a 401
// ⚠️ Matched by hash and compared timing-safely against EVERY row, so a wrong token
// leaks no timing signal about which member it nearly matched — the same discipline
// bozoClaim already applies to invite tokens.
// ⚠️ `name` is the DISPLAY name — rec.name when the account has one, the /users key
// otherwise. Greenfield accounts are keyed by immutable uid (u_…), and before this
// resolution every `you:` marker and membership check compared that raw uid against
// league rosters keyed by display name, so a uid-keyed member's own leg showed
// you:false. sessionAuth already resolves rec.name the same way; this mirrors it.
// `uid` is the /users key and is what anything durable (KV keys, audit fields) must
// use — display names are mutable.
async function mcpAuth(request, url, env) {
  const supplied = mcpPassOf(request, url);
  if (!supplied) return null;

  if (supplied.startsWith("u_")) {
    if (!env.BOZO_PEPPER) return null;          // per-user tokens need the pepper to hash
    let users;
    try { users = await loadUsers(env); } catch { return null; }
    const h = await mcpTokenHash(env, supplied);
    let hit = null, hitUser = null;
    for (const [key, u] of Object.entries(users))
      if (u && u.mcpToken && timingSafeEqual(h, u.mcpToken)) { hit = playerName(key); hitUser = u; }
    // The caller's own entitlement rides along. Their record is already in hand here, so it
    // costs no extra read, and it is what a future gate on the solver or the simulator will
    // check instead of re-fetching /users on every tool call.
    // ⚠️ THIS IS A READ. entitlementOf() never writes, and the backfill that persists the
    // field deliberately lives on /auth/roster instead of in loadUsers, so that no MCP call
    // can ever trigger a Firebase write. Every tool except dd_submit_bozo_leg is read-only,
    // and that one writes only at its confirm step — never during auth.
    if (!hit) return null;
    const display = hitUser && typeof hitUser.name === "string" && hitUser.name.trim()
      ? hitUser.name.trim() : hit;
    return { kind: "user", name: display, uid: hit, entitlement: entitlementOf(hitUser) };
  }

  if (env.DAWG_PASS && timingSafeEqual(supplied, env.DAWG_PASS)) return { kind: "shared" };
  return null;
}

// ⚠️ THE CATALOG IS A PATH SEGMENT, STRIPPED BEFORE THE CREDENTIAL IS READ.
//   /mcp/<credential>        full — UNCHANGED, so no connector already in the wild loses a tool
//   /mcp/full/<credential>   full, named explicitly
//   /mcp/core/<credential>   core — the everyday league surface, for conversations that should
//                            not spend 41 tool schemas of context on tools they never call
// The default stayed `full` on purpose: switching it would silently remove tool names a live
// connector may already be calling, which is the same breaking change as renaming one.
// ⚠️ A CATALOG NAME IS ONLY A CATALOG IF SOMETHING FOLLOWS IT. This one condition is what
// makes the split safe to deploy without anyone auditing the secret first. The earlier
// version consumed a leading "core"/"full" unconditionally, which meant a DAWG_PASS that
// happened to BE one of those words became unreachable: /mcp/core parsed as "catalog core,
// no credential" and there was no URL left that could carry it. That was defended with a
// comment telling a human not to let it happen, which is not a defence — it fails silently,
// at deploy time, and locks out the whole league rather than one member.
// Requiring a following segment closes it by construction:
//   /mcp/<credential>            full — UNCHANGED, so no connector in the wild loses a tool
//   /mcp/full/<credential>       full, named explicitly
//   /mcp/core/<credential>       core — the everyday league surface, for conversations that
//                                should not spend 41 tool schemas of context on tools they
//                                never call
//   /mcp/core     (nothing after) credential "core" — NOT a catalog selection
// ⚠️ UNLESS THE CREDENTIAL ARRIVED IN A HEADER. A header-authenticated caller does not need
// the URL to carry a credential, so for them a lone /mcp/core IS a catalog selection and
// nothing is ambiguous. Leaving that out silently broke header auth + catalog in the first
// draft of this guard: /mcp/core consumed "core" as the credential, never read the header,
// and returned 401 to a caller who had authenticated correctly. The existing suite caught it.
// The only residue is harmless and worth stating: a URL credential that literally is "core"
// or "full" still authenticates, it just always gets the default catalog, because its own
// name occupies the slot a catalog would use. Nobody is ever locked out. Per-user tokens
// start with u_ and could never collide in the first place.
// The default stayed `full` on purpose: switching it would silently remove tool names a live
// connector may already be calling, which is the same breaking change as renaming one.
const MCP_CATALOGS = ["core", "full"];
const MCP_DEFAULT_CATALOG = "full";

function mcpHasHeaderPass(request) {
  if (!request) return false;
  if (request.headers.get("X-Dawg-Pass")) return true;
  return (request.headers.get("Authorization") || "").startsWith("Bearer ");
}

function mcpRoute(url, request) {
  const seg = url.pathname.split("/").filter(Boolean);          // ["mcp", ("core"|"full")?, "<pass>"]
  let rest = seg.slice(1), catalog = MCP_DEFAULT_CATALOG;
  const named = rest.length && MCP_CATALOGS.includes(rest[0]);
  if (named && (rest.length > 1 || mcpHasHeaderPass(request))) { catalog = rest[0]; rest = rest.slice(1); }
  return { catalog, rest };
}

function mcpPassOf(request, url) {
  const { rest } = mcpRoute(url, request);
  if (rest.length) { try { return decodeURIComponent(rest.join("/")); } catch { return rest.join("/"); } }
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
    return mcpJson({
      name: "data-dawgs", transport: "streamable-http",
      catalogs: {
        core: "/mcp/core/<credential> — the everyday league surface",
        full: "/mcp/full/<credential> — every tool; the bare /mcp/<credential> is also full",
      },
      hint: "POST JSON-RPC 2.0 here.",
    }, 405);
  if (request.method !== "POST") return mcpJson(rpcErr(null, -32600, "POST only"), 405);

  // ⚠️ Either mechanism is enough on its own: BOZO_PEPPER for per-user tokens, DAWG_PASS
  // for the legacy shared one. Demanding both would have taken shared access down the
  // moment per-user shipped, for no reason.
  if (!env.BOZO_PEPPER && !env.DAWG_PASS)
    return mcpJson(rpcErr(null, -32000, "Worker misconfigured: neither BOZO_PEPPER nor DAWG_PASS is set."), 500);
  const { catalog } = mcpRoute(url, request);
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
    const r = await mcpDispatch(m, env, caller, catalog);
    if (r !== undefined) replies.push(r);        // notifications contribute nothing
  }
  if (!replies.length) return new Response(null, { status: 202, headers: MCP_CORS });
  return mcpJson(batch ? replies : replies[0]);
}

// ⚠️ THE CATALOG IS THE SURFACE, NOT A LISTING HINT. A tool outside the catalog is not
// callable either. Filtering only tools/list would make `core` a suggestion a model can
// step around by remembering a name it saw in another conversation.
const mcpCatalogTools = catalog => catalog === "full" ? MCP_TOOLS : MCP_TOOLS.filter(t => t.catalog === catalog);

async function mcpDispatch(m, env, caller, catalog = MCP_DEFAULT_CATALOG) {
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
        serverInfo: { name: "data-dawgs", version: "1.7.0" },
        instructions:
          "Catalog `" + catalog + "`: " + mcpCatalogTools(catalog).length + " of " + MCP_TOOLS.length + " tools are callable here. " +
          (catalog === "core"
            ? "The rest — college football evidence, the DFS and survivor solvers, the model scoreboard and the less common price math — " +
              "are on the same URL with `full` in place of `core`. Calling one of them from here is an error, not a silent fallback.\n"
            : "A smaller `core` catalog is served at the same URL with `core` before the credential; it costs less context.\n") +
          (caller && caller.kind === "user"
            ? "You are connected as " + caller.name + ". When a tool marks a row `you: true`, that is them.\n"
            : "⚠️ This is the SHARED league connector — you do NOT know which member you are talking to. " +
              "Never assume whose team, leg or ledger is whose; ask. A personal URL from " + SITE + "/connect.html fixes this.\n") +
          "Every tool here is read-only except dd_submit_bozo_leg, which can write exactly one thing — " +
          "the caller's own Bozo leg, in an open week, and only after the human has read back the parsed bet and " +
          "confirmed with the code it returns. Never call its confirm step without showing the human the echo first. " +
          "Everything else is the league's own data, public play-by-play, " +
          "or a deterministic calculation over caller-supplied inputs. Calculator inputs and results are not stored. " +
          "The model scoreboard reads dated prospective receipts and returns descriptive disagreement only; it is ungraded and is not a validated consensus or ranking. " +
          "The CFB reads separate observed 2025 results from one end-of-2025 retrodictive Elo row. Compact profiles also expose non-ranked expected-versus-observed Elo diagnostics; these are not luck, team-quality labels, forecasts or grades. dd_find_cfb_games reads the actual canonical 2025 schedule/results surface; it is historical and not the unpublished 2026 schedule. dd_find_cfb_team_games and dd_find_cfb_team_periods return schedule-derived results only, for one exact team by default or for every team's most recent game or period under scope=latest-per-team; latest means latest within the 2025 FBS-involved surface, not current 2026 form, and FCS records are partial. dd_find_cfb_historical_market returns book-identified prices whose observation time is unknown: never call them closing lines, compute CLV or cite them as prospective inputs. dd_get_cfb_model_card returns generated governance and retrodictive evidence, not a current forecast or leaderboard. dd_get_cfb_rating_system describes registered methods and output availability; registration is not evidence of prospective skill. dd_rank_cfb_teams returns one declared system's dated ranking, not a consensus or current power ranking. dd_project_cfb_matchup and dd_project_cfb_schedule_path are hypothetical rating-period calculations, not scheduled 2026 forecasts. dd_find_cfb_record_divergence returns descriptive record-versus-scoring gaps whose small held-out lift does not authorize current-team labels. dd_get_cfb_model_disagreement returns a blocked study whose untimestamped market input prevents a winner or blend conclusion. dd_get_cfb_model_receipt_status reports the append-only prospective ledger honestly; receipt rows remain ungraded and outcomes belong in a separate surface. All CFB outputs are ungraded, not market-adjusted and are not a consensus. " +
          "There is no built-in DFS projection or ownership feed: dd_solve_dfs_lineup requires the caller to supply every value per call, and stores none of them. dd_optimize_survivor_path is an ungraded ceiling over a dated snapshot; it models double-pick weeks exactly, as two assignment slots spending two distinct teams. When quoting bozo odds, survivor odds " +
          "or the correlation matrix, say it is model output or a measured historical average, never a forecast " +
          "of a specific game. Team names, weeks and league ids come from dd_league_overview — do not guess them.",
      });
    }
    case "ping":
      return rpcOk(id, {});
    case "tools/list":
      // ⚠️ ONLY THE TWO HINTS WE CAN STAND BEHIND. destructiveHint is defined only when
      // readOnlyHint is false, and idempotentHint/openWorldHint would be a guess per tool.
      // A client trusts these; an annotation nobody checked is worse than no annotation.
      // `catalog` is ours and stays server-side — it is not part of the Tool wire shape.
      return rpcOk(id, { tools: mcpCatalogTools(catalog).map(t => ({
        name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
        annotations: {
          title: t.title, readOnlyHint: t.readOnlyHint === true,
          // Defined ONLY for the write tool, per the rule above: an edit overwrites the
          // caller's existing leg, so destructive is the honest value.
          ...(t.readOnlyHint === true ? {} : { destructiveHint: t.destructiveHint === true }),
        },
      })) });
    case "tools/call": {
      const name = m.params && m.params.name;
      const tool = mcpCatalogTools(catalog).find(t => t.name === name);
      if (!tool)
        return rpcErr(id, -32602, MCP_TOOLS.some(t => t.name === name)
          ? name + " exists but is not in the `" + catalog + "` catalog. Reconnect with /mcp/full/<your token> to use it."
          : "Unknown tool: " + name);
      try { return rpcOk(id, await tool.run((m.params && m.params.arguments) || {}, env, caller)); }
      catch (e) { return rpcOk(id, toolErr(String((e && e.message) || e))); }
    }
    default:
      return rpcErr(id, -32601, "Method not found: " + m.method);
  }
}

/* ------------------------------- the tools ------------------------------- */
// All read-only except dd_submit_bozo_leg (two-phase, own leg only — see the tool).
// Data tools use the same Firebase paths, KV keys and published pages
// the site itself uses; calculator tools mirror work/pound-core.js and are parity-tested.

const MCP_NO_ARGS = { type: "object", properties: {}, additionalProperties: false };

// The one sentence every sd_* tool gives an unidentified caller. A training log is
// personal: without a uid there is no correct log to read or write.
const SWOLE_NEEDS_USER = "SwoleDawg needs to know who you are, and the shared league connector cannot tell. Mint a personal URL at " + SITE + "/connect.html and this works.";

const MCP_TOOLS = [
  {
    name: "dd_whoami",
    title: "Who am I",
    catalog: "core",
    readOnlyHint: true,
    description: "Who this connection is authenticated as. Call it when a question says 'my' or 'I' — my leg, my budget, my ledger — so you resolve that to the right person instead of guessing. If it reports anonymous:true you do NOT know who you are talking to and must ask.",
    inputSchema: MCP_NO_ARGS,
    async run(args, env, caller) {
      if (caller && caller.kind === "user")
        return toolText({
          player: caller.name, anonymous: false,
          // Read everything, write one thing: your own Bozo leg, two-phase. Stated here
          // because "read-only" was a published claim and its retirement should be too.
          access: "read-only, except your own Bozo leg via dd_submit_bozo_leg (two-phase confirm)",
          // This caller's own subscription state, from their own record. Everything on the
          // site is free today: plan is "free" for every account and NOTHING is gated on
          // it, so never tell a user a tool is being withheld from them on this basis.
          entitlement: caller.entitlement || null,
          note: "Rows belonging to this player are marked `you: true` by the other tools.",
        });
      return toolText({
        player: null, anonymous: true, access: "read-only (shared league connector)",
        // ⚠️ NULL, NOT THE FREE DEFAULT. A shared connection is not an account, so it has
        // no entitlement to report. Handing back a free-looking one would invite a model to
        // describe somebody's plan from a connection that cannot identify anybody.
        entitlement: null,
        note: "This connection uses the shared league passphrase, so the server cannot tell which member is asking. " +
              "Do not assume whose team, leg or ledger is whose — ask the user. They can get a personal URL at " + SITE + "/connect.html. " +
              "It is not an account and has no entitlement: do not describe anyone's plan or subscription from this connection.",
      });
    },
  },
  {
    name: "dd_league_overview",
    title: "League overview",
    catalog: "core",
    readOnlyHint: true,
    description: "Who is in the Data Dawgs Bozo league, what season/week it is on, and whether the current board is open, placed or graded.",
    inputSchema: { type: "object", properties: { league: { type: "string", description: "League id (default: main)" } }, additionalProperties: false },
    async run(args, env) {
      const lid = validLeagueId(args.league || DEFAULT_LEAGUE) ? (args.league || DEFAULT_LEAGUE) : null;
      if (!lid) return toolErr("Bad league id.");
      const lg = await loadLeague(env, lid);
      if (!lg) return toolErr("No such league: " + lid);
      const set = settingsOf(lg);
      return toolText({
        id: lid, name: lg.name || lid, manager: lg.manager || null,
        season: lg.season || SEASON, week: lg.week || 1, status: lg.status || "open",
        members: memberNames(lg),
        legsIn: Object.keys(lg.picks || {}).length,
        // ⚠️ Two rulesets now run on the same rows. Standard names a bozo who plays
        // again; Bozo Royale ELIMINATES them. Never describe a Royale league's weekly
        // loser as "wearing it" — they are out, and who is still alive is the state
        // that matters.
        format: set.format,
        royale: set.format === "royale" ? {
          alive: royaleRoster(lg).map(k => memberNameAt(lg, k)),
          eliminated: Object.entries(royaleStatus(lg)).filter(([, s]) => !s.alive)
            .map(([k, s]) => ({ player: memberNameAt(lg, k), eliminatedWeek: s.eliminatedWeek })),
          // ⚠️ A parachute means that player has already used their one way back, so the
          // next chop ends them. It is the single most decision-relevant fact about a
          // live Bozo Royale board.
          parachutes: Object.entries(royaleStatus(lg)).filter(([, s]) => s.hasParachute)
            .map(([k]) => memberNameAt(lg, k)),
          survivor: (lg.royale || {}).survivor || null,
          redeployCost: set.buyback,
          // ⚠️ Automatic, not a choice. Never describe a chopped Royale player as
          // "deciding whether to buy back" — there is no decision to make.
          redeployRule: "A chopped player with a re-deploy left comes straight back on the next ticket, automatically. One each. After that the parachute stays next to their name and the next chop is final.",
        } : null,
        // ⚠️ SAY SO IN EVERY ANSWER ABOUT THIS LEAGUE. A simulated season uses the real
        // eight names on purpose, which is exactly why it must never be quoted as a
        // result. Nothing here counts toward receipts, standings or any aggregate.
        synthetic: lg.synthetic === true,
        syntheticNote: lg.synthetic === true
          ? "SIMULATED LEAGUE. Every leg, price, close and result is fabricated. Label it as simulated in any answer that quotes it, and never let it into a total."
          : undefined,
      });
    },
  },
  {
    name: "dd_bozo_clv",
    title: "Bozo closing line value",
    catalog: "full",
    readOnlyHint: true,
    description: "Per-leg entry and closing prices for a Bozo league, with both sides of each market so the caller can de-vig. Returns RAW PRICES ONLY — it does not compute CLV, a delta or a ranking. Legs with no capturable close are returned with the reason and must be excluded from any average, never back-filled from the entry price.",
    inputSchema: { type: "object", properties: {
      league: { type: "string", description: "League id (default: main)" },
      player: { type: "string", description: "Restrict to one player (optional)" },
      week: { type: "number", description: "Restrict to one week (optional)" },
    }, additionalProperties: false },
    async run(args, env) {
      const lid = validLeagueId(args.league || DEFAULT_LEAGUE) ? (args.league || DEFAULT_LEAGUE) : null;
      if (!lid) return toolErr("Bad league id.");
      const lg = await loadLeague(env, lid);
      if (!lg) return toolErr("No such league: " + lid);
      let ledger = {};
      try { ledger = (await fbGet(env, LG(lid) + "/ledger")).data || {}; }
      catch (e) { return toolErr("Database unreachable: " + e.message); }

      const want = args.player ? String(args.player) : null;
      const wk = Number.isFinite(Number(args.week)) ? Number(args.week) : null;
      const rows = Object.values(ledger)
        .filter(r => r && r.player && (!want || r.player === want) && (wk == null || r.week === wk))
        .sort((a, b) => (a.week - b.week) || String(a.player).localeCompare(String(b.player)))
        .map(r => ({
          week: r.week, player: r.player, sport: r.sport, eventId: r.eventId,
          mkt: r.mkt, label: r.label, result: r.result || null,
          entryPrice: r.price ?? null, entryPriceOpp: r.priceOpp ?? null,
          entryBook: r.entryBook || null, entrySubmittedAt: r.ts ? new Date(r.ts).toISOString() : null,
          closePrice: r.close ?? null, closePriceOpp: r.closeOpp ?? null,
          closeBook: r.closeBook || null, closeObservedAt: r.closeObservedAt || null,
          closeSource: r.closeSource || null,
          closeUnavailableReason: r.closeUnavailableReason || null,
          // The one derived field, and it is a boolean rather than a number: whether
          // this leg is eligible to be in a CLV calculation at all.
          clvMeasurable: r.close != null && r.closeOpp != null && r.price != null && r.priceOpp != null
            && (r.result === "won" || r.result === "lost"),
        }));

      const measurable = rows.filter(r => r.clvMeasurable).length;
      return toolText({
        league: lid, name: lg.name || lid, season: lg.season || SEASON,
        synthetic: lg.synthetic === true,
        devig: "proportional",
        formula: "imp(o) = o<0 ? -o/(-o+100) : 100/(o+100); p = imp(price)/(imp(price)+imp(oppPrice)); clv = p_close - p_entry, in probability points.",
        counts: { legs: rows.length, clvMeasurable: measurable, notMeasurable: rows.length - measurable },
        legs: rows,
        caveats: [
          "This tool returns prices. It deliberately does not return a CLV number, a per-player average or a ranking — the de-vig method is declared so the caller derives those and stays reproducible if the method ever changes.",
          "Use ONLY legs where clvMeasurable is true. A leg missing either side of either price cannot be de-vigged, and mixing a de-vigged number with a raw implied one is wrong by roughly the whole hold.",
          "Never substitute the entry price for a missing close.",
          "Pushes and voids carry no information about the number and belong in neither the average nor the count.",
          "Measured CLV uses captured DraftKings prices at both entry and close. Self-priced legs are not measurable and must stay out of aggregates.",
          lg.synthetic === true ? "SIMULATED LEAGUE — every price here is fabricated. Never quote it as evidence of anyone's skill." : null,
        ].filter(Boolean),
      });
    },
  },
  {
    name: "dd_bozo_week",
    title: "Bozo board this week",
    catalog: "core",
    readOnlyHint: true,
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
          // ⚠️ `who` is stamped on the leg at submission. Reading the name off the key
          // would print a bare uid; reading it off the members map would go blank for
          // anyone who has since left the league.
          order: i + 1, player: x.who || playerName(k),
          you: me ? (x.who || playerName(k)) === me : undefined,
          sport: x.sport, game: x.game, eventId: x.eventId,
          mkt: x.mkt, side: x.side, line: x.mkt === "ml" ? null : x.line,
          price: x.price, priceSource: x.priceSource || "self", clvEligible: x.clvEligible === true,
          priceOpp: x.entryPriceOpp ?? null, entryBook: x.entryBook || null,
          entryProvider: x.entryProvider || null, entrySnapshotAt: x.entrySnapshotAt || null,
          fairEntry: x.fairEntry ?? null, entryHold: x.entryHold ?? null,
          canonicalKey: x.canonicalKey || null, providerEventIds: x.providerEventIds || {},
          startsAt: x.startsAt || null, label: x.label, prop: x.prop || null, ts: x.ts || null,
          // The close, once the kickoff cron has snapped it. Null until then, and null
          // FOREVER for legs it could not match — with the reason attached, so a missing
          // close is never mistaken for a leg that did not move.
          close: (lg.results || {})[k]?.close ?? null,
          closeOpp: (lg.results || {})[k]?.closeOpp ?? null,
          closeBook: (lg.results || {})[k]?.closeBook ?? null,
          closeObservedAt: (lg.results || {})[k]?.closeObservedAt ?? null,
          closeUnavailableReason: (lg.results || {})[k]?.closeUnavailableReason ?? null,
        };
      });
      return toolText({
        season: lg.season || SEASON, week: lg.week || 1, status: lg.status || "open",
        band: bandOf(lg), legs,
        you: me,
        yourLegIn: me ? keys.some(k => (picks[k].who || playerName(k)) === me) : null,
        stillWaitingOn: memberKeys(lg).filter(k => !picks[k]).map(k => memberNameAt(lg, k)),
        leverHierarchy: lg.order || null,
        results: lg.results || null, bozo: lg.bozo || null, bozoWhy: lg.bozoWhy || null,
        caveats: [
          "Bozo odds anywhere on the site are simulation output, not market prices.",
          "The simulator draws legs independently; correlated legs (same game, same side of a number) must be flagged by the reader.",
          "The lever hierarchy is a server-side random permutation drawn at lock — it is not chosen by anyone.",
          // ⚠️ This caveat changed the day the capture shipped, and the change is narrow
          // on purpose. CLV is now computable — but only for a leg that has BOTH a
          // captured close and both sides of both prices, and the entry is still a
          // server-captured DK quote. State CLV for a leg that has one; say it is
          // unmeasured for a leg that does not; never average across the two.
          "CLV is computable only where closeObservedAt is set AND both priceOpp and closeOpp are present — de-vig proportionally, and report probability points, not cents.",
          "A leg with closeUnavailableReason has NO CLV. Do not substitute the entry price for a missing close: that fabricates a zero and drags any average toward it.",
          "priceSource=captured means both entry sides came from DraftKings through SGO. priceSource=self is excluded from CLV; never mix those legs into a CLV average.",
          "Every leg goes on a real DraftKings bet slip, so every market — props included — exists and closes. A missing close means the capture could not resolve the typed description onto the right market, and closeUnavailableReason says which of stat, player or number failed. \"Other\" legs are the exception: free text for an arbitrary market, with nothing to match on. Either way it is a matching gap, never evidence about a player.",
          "If two legs share an eventId the ticket is a same-game parlay and the displayed parlay price is INDICATIVE — DraftKings reprices correlated legs, so the product of the leg prices is an upper bound, not the payout.",
        ],
      });
    },
  },
  {
    name: "dd_bozo_standings",
    title: "Bozo season ledger",
    catalog: "core",
    readOnlyHint: true,
    description: "Season-to-date Bozo ledger summary per player: legs submitted, Last In count, Shortest Odds count, and any graded results present. Early season this will honestly say nothing has resolved.",
    inputSchema: { type: "object", properties: { league: { type: "string", description: "League id (default: main)" } }, additionalProperties: false },
    async run(args, env, caller) {
      const lid = validLeagueId(args.league || DEFAULT_LEAGUE) ? (args.league || DEFAULT_LEAGUE) : null;
      if (!lid) return toolErr("Bad league id.");
      // ⚠️ Whether this league's rows are real has to be known BEFORE any of them are
      // summarised. A demo league uses the real player names on purpose, so a standings
      // table off one is indistinguishable from a real one unless it says so itself.
      const lgRec = await loadLeague(env, lid);
      const synthetic = !!(lgRec && lgRec.synthetic === true);
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
        synthetic,
        syntheticNote: synthetic
          ? "SIMULATED LEAGUE. Every leg, price, close and result behind this table is fabricated by a seeding "
            + "script — it exists to show what a populated board looks like. It counts toward no standing, no "
            + "receipt and no aggregate. Say so in any answer that quotes it, and never combine it with a real league."
          : undefined,
        note: graded ? undefined : "No graded results yet — everything above is bookkeeping, not performance.",
      });
    },
  },
  {
    name: "dd_draft_bozo_leg",
    title: "Draft a Bozo leg",
    catalog: "core",
    readOnlyHint: true,
    description:
      "Capture the live DraftKings quote for a proposed Bozo leg, check it against the LIVE board, " +
      "or the reason it would be rejected. ⚠️ READ-ONLY: this submits nothing and changes no board " +
      "state. Runs the server's own capture and validator; use dd_submit_bozo_leg to " +
      "make a separately captured, two-phase submission.",
    inputSchema: {
      type: "object",
      properties: {
        sport: { type: "string", description: "nfl | cfb | nba | cbb | mlb | nhl" },
        eventId: { type: "string", description: "The game's id, from dd_scores" },
        game: { type: "string", description: "Human-readable matchup, e.g. \"BUF @ MIA\"" },
        mkt: { type: "string", description: "spread | ml | total | prop | other" },
        side: { type: "string", description: "Team abbreviation, or over / under" },
        line: { type: "number", description: "The number. Required for everything except ml." },
        price: { type: "number", description: "Optional typed DraftKings price tripwire. The Worker captures and stores the live quote; this value is never trusted as the entry price." },
        label: { type: "string", description: "How the leg reads on the ticket, e.g. \"BUF -6.5\"" },
        prop: { type: "string", description: "Required when mkt is \"other\": what the bet actually is" },
        startsAt: { type: "string", description: "Kickoff ISO timestamp. Optional when eventId resolves from the Worker schedule cache; otherwise required." },
        league: { type: "string", description: "League id (default: main)" },
      },
      required: ["sport", "eventId", "game", "mkt", "side", "label"],
      additionalProperties: false,
    },
    async run(args, env, caller) {
      // ⚠️ REFUSALS FIRST, and identity before anything else. Membership, the duplicate
      // rule and "have you already got a leg in" are all questions about who is asking.
      if (!caller || caller.kind !== "user")
        return toolErr(
          "This one needs to know who you are, and the shared league connector cannot tell. " +
          "Every check below — are you in this league, do you already have a leg in, has someone " +
          "else taken this exact bet — depends on your name. Mint a personal URL at " +
          SITE + "/connect.html and it works.");
      const name = caller.name;

      const lid = validLeagueId(args.league || DEFAULT_LEAGUE) ? (args.league || DEFAULT_LEAGUE) : null;
      if (!lid) return toolErr("Bad league id.");
      let lg;
      try { lg = await loadLeague(env, lid); }
      catch (e) { return toolErr("Database unreachable: " + e.message); }
      if (!lg) return toolErr("No such league: " + lid);

      if (!isMember(lg, name))
        return toolErr("You are not in " + lid + ", so nothing can go on that board under your name.");

      const status = lg.status || "open";
      if (status !== "open")
        return toolText({
          accepted: false, reason: "board-closed",
          detail: "The ticket is placed and the board is locked — nothing can be added or changed for week " +
                  (lg.week || 1) + ". The lever hierarchy has already been drawn.",
          week: lg.week || 1, status,
        });

      const set = settingsOf(lg);
      const picks = lg.picks || {};
      const mine = picks[memberKeyOf(lg, caller) || ""] || null;
      if (mine && !set.allowEdit)
        return toolText({
          accepted: false, reason: "edits-locked",
          detail: "This league locks your leg the moment it lands, and yours is already in. " +
                  "No edit is possible, by league setting rather than by timing.",
          yourExistingLeg: { label: mine.label, price: mine.price, ts: mine.ts || null },
        });

      // Shape the selection and run the same read-only SGO capture as phase one.
      const input = {
        sport: String(args.sport || "").toLowerCase(),
        eventId: String(args.eventId || ""),
        game: String(args.game || "").slice(0, 80),
        mkt: String(args.mkt || "").toLowerCase(),
        side: String(args.side || "").slice(0, 40),
        line: String(args.mkt || "").toLowerCase() === "ml" ? 0 : Number(args.line),
        typedPrice: args.price,
        label: String(args.label || "").slice(0, 90),
        prop: args.prop ? String(args.prop).slice(0, 80) : null,
        startsAt: typeof args.startsAt === "string" ? args.startsAt : null,
      };
      const captured = await bozoCaptureEntry(env, input);
      if (!captured.ok)
        return toolText({ accepted: false, reason: captured.reason || "capture-failed", detail: captured.error });
      const p = captured.p;

      // ⚠️ THE SERVER'S OWN VALIDATOR, not a copy of its rules. A second copy would drift
      // and start passing legs /bozo/pick rejects, which is worse than no check at all.
      const band = bandOf(lg);
      const err = validatePick(p, name, picks, band, set.format);
      if (err)
        return toolText({
          accepted: false, reason: "rejected-by-the-same-validator-the-server-runs",
          detail: err, band, captured: { line: p.line, price: p.price, priceOpp: p.priceOpp },
          note: "That is the literal string POST /bozo/pick would return. Fix it and ask again.",
        });

      // ⚠️ Say when submitting would END THE WEEK for everyone. The last leg locks the
      // board and draws the lever hierarchy, and there is no undo — the only route back to
      // open advances the week and discards this one. Whoever is about to press the button
      // should know that is what the button does this time.
      const size = memberNames(lg).length;
      const need = set.lockRule === "count" ? Math.min(set.lockCount || size, size || set.lockCount) : size;
      const already = Object.keys(picks).length;
      const wouldBeNth = mine ? already : already + 1;
      const wouldLock = need > 0 && wouldBeNth >= need;

      return toolText({
        accepted: true,
        league: lid, week: lg.week || 1, you: name,
        editingAnExistingLeg: !!mine,
        // ⚠️ Editing resets your clock. The server stamps a fresh ts, and ts is what
        // decides Last In — so an edit is not free even when it is allowed.
        editResetsYourClock: !!mine || undefined,
        submit: {
          how: "Use dd_submit_bozo_leg with the same selection fields. It performs its own fresh phase-one capture and returns a confirmation code.",
        },
        willBeStoredAs: {
          ...p,
          dir: (p.side === "over" || p.side === "under") ? p.side : "over",
          priceSource: p.priceSource,
          ts: "set by the server when you actually submit, not now",
        },
        captured: { line: p.line, price: p.price, priceOpp: p.priceOpp,
          priceSource: p.priceSource, clvEligible: p.clvEligible,
          entrySnapshotAt: p.entrySnapshotAt, providerEventIds: p.providerEventIds,
          startsAt: p.startsAt, espnEventId: p.espnEventId, canonicalKey: p.canonicalKey },
        agreement: captured.agreement || null,
        band,
        legsIn: already, legsNeeded: need,
        stillWaitingOn: memberKeys(lg).filter(k => !picks[k]).map(k => memberNameAt(lg, k)),
        wouldLockTheBoard: wouldLock,
        warning: wouldLock
          ? "⚠️ THIS WOULD BE THE LAST LEG. Submitting it places the ticket, locks the board for all " +
            size + " and draws the lever hierarchy. That draw happens once and is never redone; there is " +
            "no undo short of a manager advancing the week, which discards it for everyone."
          : undefined,
        caveats: [
          "Nothing was submitted. This tool cannot submit — it reads the board and runs the validator.",
          p.priceSource === "captured" ? "Both prices were captured from DraftKings through SGO." : "This market is self-priced and excluded from CLV.",
          "A pass here is a pass at this instant. Someone else can take your exact leg, or fill the board, before you press submit.",
        ],
      });
    },
  },
  {
    // ⚠️ THE ONE WRITE TOOL. Spec: claude/data-dawgs-cep-identity.md §4 — two-phase
    // commit, idempotent replay, server-enforced blast radius, audit stamp. The blast
    // radius is absolute: this tool can touch the CALLER'S OWN LEG, in the CURRENT
    // week, while the board is OPEN — never another member's pick, league config, the
    // hierarchy draw, grading, or the draft. Nothing in the arguments can widen that.
    name: "dd_submit_bozo_leg",
    title: "Submit your Bozo leg (two-phase)",
    catalog: "core",
    readOnlyHint: false,
    destructiveHint: true,   // an edit overwrites your existing leg and resets your clock
    description:
      "Submit (or replace) YOUR OWN leg on the live Bozo board. TWO-PHASE, and phase one writes " +
      "nothing: call with the bet fields and it validates against the live board, then returns a " +
      "plain-English echo of the parsed bet plus a confirm_code. ⚠️ SHOW THE HUMAN THE ECHO and only " +
      "call again with {confirm: code} after they have approved it — the echo is what stops a " +
      "misparsed team, line or price from becoming a real bet. The code expires in 5 minutes; " +
      "replaying a used code is a no-op that returns the original result. Editing an existing leg " +
      "resets its server timestamp AND price, which moves you in the Last In lever. If the response " +
      "says the submission would lock the board, say so out loud before confirming: the last leg " +
      "places the ticket for everyone and draws the lever hierarchy, and there is no undo.",
    inputSchema: {
      type: "object",
      properties: {
        sport: { type: "string", description: "nfl | cfb | nba | cbb | mlb | nhl" },
        eventId: { type: "string", description: "The game's id, from dd_scores" },
        game: { type: "string", description: "Human-readable matchup, e.g. \"BUF @ MIA\"" },
        mkt: { type: "string", description: "spread | ml | total | prop | other" },
        side: { type: "string", description: "Team abbreviation, or over / under" },
        line: { type: "number", description: "The number. Required for everything except ml." },
        price: { type: "number", description: "Optional typed DraftKings price tripwire. The Worker captures and stores the quote; use this only to detect a mismatch. Required only for self-priced other markets or a prop fallback." },
        label: { type: "string", description: "How the leg reads on the ticket, e.g. \"BUF -6.5\"" },
        prop: { type: "string", description: "Required when mkt is \"other\": what the bet actually is" },
        priceOpp: { type: "number", description: "Deprecated input; the Worker captures the opposite DraftKings side itself." },
        startsAt: { type: "string", description: "Kickoff ISO timestamp. Optional when eventId resolves from the Worker schedule cache; phase two needs only confirm." },
        league: { type: "string", description: "League id (default: main)" },
        confirm: { type: "string", description: "PHASE TWO ONLY: the confirm_code returned by phase one, after the human approved the echo. Sends the bet." },
      },
      anyOf: [
        { required: ["confirm"] },
        { required: ["sport", "eventId", "game", "mkt", "side", "label"] },
      ],
      additionalProperties: false,
    },
    async run(args, env, caller) {
      // Identity first, same reasoning as dd_draft_bozo_leg — every check below is a
      // question about who is asking, and a WRITE with no identity is unattributable.
      if (!caller || caller.kind !== "user")
        return toolErr(
          "Submitting needs to know who you are, and the shared league connector cannot tell. " +
          "Mint a personal URL at " + SITE + "/connect.html and this works.");
      if (!env.RL)
        return toolErr("The confirmation store is not configured on this deployment.");
      const name = caller.name;
      const uid = caller.uid || caller.name;
      // ⚠️ Keyed by uid, not display name: display names are mutable, and a rename
      // between propose and confirm must not orphan (or worse, cross-match) a pending bet.
      const kvKey = "mcpconfirm:" + uid;

      /* -------------------------- phase two: confirm -------------------------- */
      if (args.confirm !== undefined) {
        const code = String(args.confirm || "").trim().toUpperCase();
        if (!code) return toolErr("Empty confirm code.");
        let pend;
        try { pend = JSON.parse((await env.RL.get(kvKey)) || "null"); } catch { pend = null; }
        if (!pend)
          return toolText({ status: "nothing_pending", detail: "No proposal is waiting on a confirmation — it may have expired (codes live 5 minutes). Propose the leg again." });
        if (pend.code !== code)
          return toolErr(pend.consumed
            ? "That code was already used for a different submission. Propose again if you want to change the leg."
            : "Wrong confirm code. The pending proposal is: " + pend.echo);
        // ⚠️ Idempotent replay, spec §4.2: the same code returns the ORIGINAL result and
        // writes nothing. An agent retry must not become a second submission.
        if (pend.consumed) return toolText(pend.result);

        // Re-check EVERYTHING against the live board. The confirm may arrive minutes
        // after the propose; someone can have taken the selection, filled the board, or
        // locked it in between. A stale pass must not write.
        const lid = pend.lid;
        let lg;
        try { lg = await loadLeague(env, lid); }
        catch (e) { return toolErr("Database unreachable: " + e.message); }
        if (!lg) return toolErr("No such league: " + lid);
        if (!isMember(lg, name))
          return toolErr("You are not in " + lid + " any more, so nothing can go on that board under your name.");
        if ((lg.week || 1) !== pend.week) {
          try { await env.RL.put(kvKey, "null", { expirationTtl: 60 }); } catch {}
          return toolText({ status: "stale", detail: "The league moved to week " + (lg.week || 1) + " since this was proposed for week " + pend.week + ". Propose again on the current board." });
        }
        const set = settingsOf(lg);
        const picks = lg.picks || {};
        // One resolution, reused by every check below and by the write itself, so an
        // MCP leg can never land under a different key than the site form would use.
        const mkey = memberKeyOf(lg, caller);
        if (!mkey)
          return toolText({ status: "not-a-member", detail: "You are not in this league." });
        const landed = picks[mkey];
        if (landed && landed.submissionId === code)
          return toolText({ status: "submitted", replayed: true, league: lid, week: pend.week,
            you: name, leg: { label: landed.label, line: landed.line, price: landed.price,
              priceOpp: landed.entryPriceOpp, priceSource: landed.priceSource }, ts: landed.ts,
            detail: "This exact confirmation already landed; replay wrote nothing." });
        if ((lg.status || "open") !== "open")
          return toolText({ status: "board-locked", detail: "The ticket is placed and the board is locked — nothing can be added or changed for week " + (lg.week || 1) + "." });
        if (!set.allowEdit && picks[mkey])
          return toolText({ status: "edits-locked", detail: "This league locks your leg the moment it lands, and yours is already in." });
        if (set.format === "royale" && !royaleAliveKey(lg, mkey))
          return toolText({ status: "chopped", detail: "You're out this season — you fund the ticket, you don't have a leg on it." });
        const err = validatePick(pend.p, name, picks, bandOf(lg), set.format, mkey);
        if (err) {
          try { await env.RL.put(kvKey, "null", { expirationTtl: 60 }); } catch {}
          return toolText({ status: "rejected", detail: "The board changed since this was proposed and the leg no longer passes: " + err + " Propose again." });
        }

        // The same single write path the site form uses, stamped as agent-submitted.
        const out = await commitBozoLeg(env, lid, lg, name, pend.p, "mcp", mkey);
        const result = {
          status: "submitted", league: lid, week: pend.week, you: name,
          leg: { label: pend.p.label, line: pend.p.line, price: pend.p.price,
                 priceOpp: pend.p.priceOpp, priceSource: pend.p.priceSource, game: pend.p.game },
          ts: out.ts, via: "mcp",
          boardLocked: !!out.placed,
          legsIn: null,   // read dd_bozo_week for the live board; this result is frozen for replay
          detail: out.placed
            ? "That was the last leg. The ticket is placed, the board is locked and the lever hierarchy has been drawn."
            : "Your leg is on the board. Others can still see and react to it; the board locks when the last leg lands.",
        };
        // Consumed marker, kept 1 hour so a retry storm keeps getting the same answer.
        try { await env.RL.put(kvKey, JSON.stringify({ code, consumed: true, result }), { expirationTtl: 3600 }); } catch {}
        return toolText(result);
      }

      /* -------------------------- phase one: propose -------------------------- */
      const lid = validLeagueId(args.league || DEFAULT_LEAGUE) ? (args.league || DEFAULT_LEAGUE) : null;
      if (!lid) return toolErr("Bad league id.");
      let lg;
      try { lg = await loadLeague(env, lid); }
      catch (e) { return toolErr("Database unreachable: " + e.message); }
      if (!lg) return toolErr("No such league: " + lid);
      if (!isMember(lg, name))
        return toolErr("You are not in " + lid + ", so nothing can go on that board under your name.");
      if ((lg.status || "open") !== "open")
        return toolText({ status: "board-locked", detail: "The ticket is placed and the board is locked — nothing can be added or changed for week " + (lg.week || 1) + ". The lever hierarchy has already been drawn." });

      const set = settingsOf(lg);
      const picks = lg.picks || {};
      const mine = picks[memberKeyOf(lg, caller) || ""] || null;
      if (mine && !set.allowEdit)
        return toolText({ status: "edits-locked", detail: "This league locks your leg the moment it lands, and yours is already in — no edit is possible, by league setting.", yourExistingLeg: { label: mine.label, price: mine.price, ts: mine.ts || null } });
      if (set.format === "royale" && !royaleAlive(lg, name))
        return toolText({ status: "chopped", detail: "You're out this season — you fund the ticket, you don't have a leg on it." });

      // Shape the selection, then resolve and freeze its live DraftKings quote. No RTDB
      // write occurs in this phase; the pending KV record is the confirmation envelope.
      const input = {
        sport: String(args.sport || "").toLowerCase(),
        eventId: String(args.eventId || ""),
        game: String(args.game || "").slice(0, 80),
        mkt: String(args.mkt || "").toLowerCase(),
        side: String(args.side || "").slice(0, 40),
        line: String(args.mkt || "").toLowerCase() === "ml" ? 0 : Number(args.line),
        typedPrice: args.price,
        label: String(args.label || "").slice(0, 90),
        prop: args.prop ? String(args.prop).slice(0, 80) : null,
        startsAt: typeof args.startsAt === "string" ? args.startsAt : null,
      };
      const captured = await bozoCaptureEntry(env, input);
      if (!captured.ok)
        return toolText({ status: "rejected", reason: captured.reason || "capture-failed",
          detail: captured.error, note: "Nothing was submitted." });
      const p = captured.p;
      // ⚠️ The server's own validator, same as the site form and dd_draft_bozo_leg.
      const band = bandOf(lg);
      const err = validatePick(p, name, picks, band, set.format);
      if (err)
        return toolText({ status: "rejected", detail: err, band,
          captured: { line: p.line, price: p.price, priceOpp: p.priceOpp },
          note: "That is the literal validation failure after capture. Nothing was submitted." });

      const size = set.format === "royale" ? royaleRoster(lg).length : memberNames(lg).length;
      const need = set.lockRule === "count" ? Math.min(set.lockCount || size, size || set.lockCount) : size;
      const already = Object.keys(picks).length;
      const wouldLock = need > 0 && (mine ? already : already + 1) >= need;

      // The echo IS the safety mechanism (spec §4.1): the human reads the parsed bet in
      // plain English before anything can happen. Consequences ride in the same sentence.
      const echo =
        p.label + " — " + p.game + ", " + (p.mkt === "ml" ? "moneyline" : p.mkt + " " + p.line) +
        " at " + p.price + " (opposite side " + (p.priceOpp == null ? "not captured" : p.priceOpp) + "), for " + name + ", week " + (lg.week || 1) + " in league " + lid + "." +
        (captured.agreement ? " Typed check " + captured.agreement.typedPrice + " vs captured " + captured.agreement.capturedPrice +
          " (" + captured.agreement.probabilityPointDifference.toFixed(2) + " probability points apart" +
          (captured.agreement.needsConfirmation ? "; explicit confirmation required" : "") + ")." : "") +
        (mine ? " ⚠️ This REPLACES your current leg (" + mine.label + " at " + mine.price + ") and resets your submission clock — that moves you in the Last In lever." : "") +
        (wouldLock ? " ⚠️ THIS IS THE LAST LEG: confirming places the ticket, locks the board for all " + size + " and draws the lever hierarchy. No undo." : "");

      const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
      const rnd = new Uint32Array(6);
      crypto.getRandomValues(rnd);
      let code = "";
      for (const r of rnd) code += alphabet[r % alphabet.length];
      p.submissionId = code;

      // ⚠️ The pending record is the ONLY thing written in phase one, it lives in KV —
      // never Firebase — and it expires on its own. Nothing on the board changes here.
      try {
        await env.RL.put(kvKey, JSON.stringify({ code, lid, week: lg.week || 1, p, echo, ts: Date.now() }), { expirationTtl: 300 });
      } catch (e) { return toolErr("Could not stage the confirmation: " + e.message); }

      return toolText({
        status: "confirm_required",
        echo,
        confirm_code: code,
        expires_in: 300,
        editingAnExistingLeg: !!mine,
        wouldLockTheBoard: wouldLock,
        captured: { line: p.line, price: p.price, priceOpp: p.priceOpp,
          priceSource: p.priceSource, clvEligible: p.clvEligible,
          entrySnapshotAt: p.entrySnapshotAt, providerEventIds: p.providerEventIds,
          startsAt: p.startsAt, espnEventId: p.espnEventId, canonicalKey: p.canonicalKey },
        agreement: captured.agreement || null,
        warning: captured.captureWarning || null,
        note: "NOTHING has been submitted. Show the human the echo verbatim; only after they approve, call this tool again with {confirm: \"" + code + "\"}.",
      });
    },
  },
  {
    name: "dd_draft_board",
    title: "Live auction board",
    catalog: "core",
    readOnlyHint: true,
    description: "Live auction draft state from the league's Firebase mirror: budgets, open roster spots, and each team's max bid. Max bid equals dollars remaining because this league allows $0 bids; data/league.json `bid_rule` is the source of that rule. Also returns who is on the clock, what is on the block, and recent sales. The payload always carries a `simulated` flag: when it is true the rows are test picks entered to exercise the rig, not completed sales.",
    inputSchema: { type: "object", properties: { room: { type: "string", description: "Draft room id, which IS the site league id (the `league` parameter in the auction URL, e.g. dd_b689f18c46a2534bb10b8ba4f62e5bd0) — not the league's display name. `pepperoninipples` is the pre-league-system legacy room and is almost never the league being asked about. Omit this and the tool resolves the room when there is only one, or lists the rooms and refuses to guess." } }, additionalProperties: false },
    async run(args, env) {
      /* ⚠️ THIS DEFAULTED TO `pepperoninipples`, AND THAT COST AN AGENT AN HOUR.
         readSyncConfig() (draft-league.js) has keyed the room to the league id since the
         league system shipped, so the legacy default sent every no-argument caller to a
         stale 14-team, zero-pick shell — during a live draft in a different room. The
         caller cannot tell a wrong room from an empty league, so it reported the league
         as empty and was right to refuse to go on.
         A confidently wrong room is worse than no answer. When the room is not named and
         cannot be resolved to exactly one, this LISTS the rooms and reads nothing. Do not
         reintroduce a default here — "most recently updated" is a guess too, and a guess
         is what this is here to stop. */
      let room = args.room ? String(args.room).replace(/[.#$\[\]\/]/g, "-") : null;
      let resolvedBy = null;
      if (!room) {
        let keys = [];
        try {
          const r = await fetch(`${DB}/drafts.json?shallow=true`);
          if (!r.ok) return toolErr("Draft mirror unavailable: HTTP " + r.status);
          keys = Object.keys((await r.json()) || {});
        } catch (e) { return toolErr("Draft mirror unavailable: " + e.message); }
        if (!keys.length) return toolErr("There are no draft rooms in the mirror.");
        if (keys.length === 1) { room = keys[0]; resolvedBy = "the only room in the mirror"; }
        else {
          /* One cheap read per room — enough to tell them apart, never the picks. */
          const cards = await Promise.all(keys.slice(0, 12).map(async k => {
            const card = { room: k, legacy: k === "pepperoninipples" };
            try {
              const [tsR, setR] = await Promise.all([
                fetch(`${DB}/drafts/${encodeURIComponent(k)}/ts.json`),
                fetch(`${DB}/drafts/${encodeURIComponent(k)}/state/settings.json`),
              ]);
              card.updated_at = tsR.ok ? await tsR.json() : null;
              const st = setR.ok ? await setR.json() : null;
              if (st) {
                card.teams = (st.teams || []).length;
                card.rosterSpots = Number.isFinite(st.spots) ? st.spots : null;
                card.scoring = st.scoring || null;
                card.draftType = st.draftType || null;
              }
            } catch { /* a room that will not describe itself still gets listed */ }
            return card;
          }));
          cards.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
          return toolText({
            status: "room_required",
            rooms: cards,
            truncated: keys.length > 12 ? keys.length - 12 : 0,
            note: "NOTHING WAS READ. More than one draft room exists and this connection cannot tell which one belongs to the person asking. " +
                  "The room id is the site league id — the `league` parameter in that league's auction URL. Ask the user which league they mean, then call this tool again with `room`. " +
                  "Rooms are listed most-recently-updated first, but recency is not ownership: do not pick one on their behalf. " +
                  "`legacy: true` marks `pepperoninipples`, the pre-league-system room, which is almost certainly not the league being asked about.",
          });
        }
      }
      let rec;
      try {
        const r = await fetch(`${DB}/drafts/${room}.json`);
        if (!r.ok) return toolErr("Draft mirror unavailable: HTTP " + r.status);
        rec = await r.json();
      } catch (e) { return toolErr("Draft mirror unavailable: " + e.message); }
      if (!rec || !rec.state) return toolErr("The draft room is empty.");
      const st = rec.state, set = st.settings || {};
      const budget = set.budget || 200;
      /* ⚠️ NEVER HARDCODE THE ROSTER SIZE. This read `set.spots || 15`, which reported a
         17-spot league as 15 and made every openSpots count wrong by two. The room's own
         settings are the only source of truth; when they do not carry it, say null rather
         than invent a number that looks authoritative. */
      const spots = Number.isFinite(set.spots) ? set.spots : null;

      /* ⚠️ The mirror already holds ESPN account GUIDs in `owner` for rooms written before
         the rig stopped storing them. Strip them on the way out too: this payload is read by
         assistants, and a GUID identifies a real person's ESPN account. A Sleeper display
         name is a name and passes through. */
      const opaqueId = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
      const teams = (set.teams || []).map(t => ({
        name: t.name,
        owner: t.owner && !opaqueId.test(String(t.owner).trim()) ? t.owner : null,
        spent: 0, count: 0,
      }));
      const picks = st.picks || [];
      for (const pk of picks) { const t = teams[pk.ti]; if (t) { t.spent += pk.price || 0; t.count++; } }
      for (const t of teams) {
        t.left = budget - t.spent;
        t.openSpots = spots == null ? null : spots - t.count;
        // League rule: $0 bids are legal, so no $1-per-open-slot reserve applies.
        t.maxBid = t.left;
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
        room, resolvedBy, as_of: rec.ts || null, scoring: set.scoring || "half",
        simulated,
        budget, rosterSpots: spots,
        rosterSpotsNote: spots == null
          ? "This room's settings carry no roster size, so openSpots is null. Do not assume a default — ask, or read the league page."
          : undefined,

        onTheClock: (teams[st.nomIdx] || {}).name || null,
        onBlock: st.onBlock || null,
        teams, picksMade: picks.length, recentSales: recent,
        note: simulated
          ? "SIMULATED — these picks were entered to test the league rig. They are NOT completed sales: no money moved, no player is rostered, and nobody is really on the clock. Do not report any of it as a real draft result."
          : undefined,
      });
    },
  },
  /* ⚠️ THE ONLY TOOL HERE THAT READS A LEAGUE OUTSIDE THIS SITE, and the only reason it
     can is that the caller signed in and connected one. Yahoo and ESPN connections are
     stored per account (yahooKvKey / espnKvKey, both keyed by uid), so this resolves the
     SAME credential the page uses and returns the SAME feed — it is not a second read of
     the provider with its own idea of the league.

     ⚠️ NO leagueId ARGUMENT, ON PURPOSE. Accepting one would turn a per-account tool into
     a way to read any league id somebody can guess, and both providers hand back rosters
     and team names. The credential decides which league this answers about. A caller who
     wants a different league connects it on the site.

     ⚠️ SLEEPER IS NOT HERE, and the tool says so rather than reporting "not connected".
     Sleeper is read straight from the browser by public URL and no connection is stored
     server-side, so there is nothing for this to resolve. Reporting it as unconnected
     would be a wrong answer to a question the user can see the answer to on screen. */
  {
    name: "dd_war_room",
    title: "Your connected fantasy league",
    catalog: "full",
    readOnlyHint: true,
    description:
      "The caller's OWN connected fantasy league as the War Room reads it: teams, rosters, each player's " +
      "position and projection, and DataDawg$ where a board exists for that league. DataDawg$ is this site's " +
      "converted auction dollars for THAT league's settings — priced against its own replacement level, not a " +
      "generic board and not what anybody paid. Covers the Yahoo and ESPN connections, which are stored per " +
      "account; a Sleeper league is read in the browser by public URL and is not stored here, so it cannot be " +
      "resolved by this tool. Needs a personal connection: the shared league connector is not signed in as " +
      "anybody and has no league. The `dd` block reports how many of the league's players the board matched — " +
      "an unmatched player has no DataDawg$, which is a gap in the join and never a valuation of zero. " +
      "Returns ROSTERED players only by default — pass scope:\"full\" for free agents, which roughly triples " +
      "the payload and is worth it only for a waiver-wire question.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["rosters", "full"],
          description: "How much of the player pool to return. \"rosters\" (the default) returns only players somebody actually holds — that is 161 of 629 rows in a typical 14-team league and about a quarter of the payload. \"full\" adds every free agent, which is what a waiver-wire or best-available question needs and nothing else does. Ask for full deliberately; it is large enough to crowd out the reasoning it was fetched for.",
        },
        provider: {
          type: "string",
          enum: ["yahoo", "espn", "sleeper"],
          description: "Which provider to read. Yahoo and ESPN use the caller's stored connection. Sleeper is accepted only so the tool can report that browser-only leagues are unreachable. Omit it and the tool resolves the one stored connection that exists, or names both and refuses to guess when the caller has connected two.",
        },
      },
      additionalProperties: false,
    },
    async run(args, env, caller) {
      if (!caller || caller.kind !== "user")
        return toolErr(
          "This reads the league YOU connected, and the shared league connector is not signed in as anybody. " +
          "Mint a personal URL at " + SITE + "/connect.html and this works.");
      const kv = env && env.RL;
      if (!kv) return toolErr("League connections are not configured on this deployment.");
      const uid = caller.uid || caller.name;

      const want = args && args.provider ? String(args.provider).toLowerCase() : null;
      if (want === "sleeper")
        return toolErr(
          "Sleeper is UNREACHABLE from dd_war_room. A Sleeper league is read only in your browser from its " +
          "public URL and is not stored server-side, so this tool cannot read it even while the War Room page is showing it.");
      const yahoo = (!want || want === "yahoo") ? await yahooStored(kv, uid) : null;
      let espn = null;
      if (!want || want === "espn") {
        let blob = null;
        try { blob = await kv.get(espnKvKey(uid)); } catch { blob = null; }
        if (blob) { try { espn = await espnOpen(env, uid, blob); } catch { espn = null; } }
      }

      /* ⚠️ REFUSE, DO NOT PICK. Two connected leagues and no `provider` is genuinely
         ambiguous, and answering about the wrong one is worse than answering about
         neither — every number below would be right about a league nobody asked about. */
      if (!want && yahoo && espn)
        return toolErr(
          "You have both a Yahoo and an ESPN league connected. Say which one: " +
          'provider "yahoo" (league ' + yahoo.leagueId + ') or provider "espn" (league ' + espn.leagueId + ").");

      const provider = yahoo ? "yahoo" : espn ? "espn" : null;
      if (!provider)
        return toolErr(
          (want ? "No " + want + " league is connected to this account." : "No Yahoo or ESPN league is connected to this account.") +
          " Connect one at " + SITE + "/fantasy-warroom.html. A Sleeper league is read in your browser from its " +
          "public URL and is not stored here, so it cannot be read by this tool even while the page is showing it.");

      const cred = provider === "yahoo" ? yahoo : espn;
      const feed = provider === "yahoo" ? await yahooWarroomFeed(cred, env) : await espnWarroomFeed(cred);
      if (!feed.ok)
        return toolErr("Could not read the " + provider + " league: " + (feed.reason || "upstream refused"));

      // The same decoration the page's own /warroom route applies — one code path, so a
      // number here can never disagree with the number on screen.
      ddDecorateBody(await ddLoadBoard(env, provider, cred.leagueId, "season"), feed.body);

      /* ⚠️ THE FREE AGENTS ARE DROPPED BY DEFAULT, and that is a usability fix, not a
         cosmetic one. This returned the whole feed once: 93 KB, of which the pool was
         86 KB — 629 player rows for a league where 161 are rostered. That is roughly
         23k tokens, which overflows a tool-result budget outright, so the answer a
         caller wanted never arrived and the context it needed to reason with was gone.
         A tool nobody can afford to call is not a live tool.
         ⚠️ THE POOL CANNOT SIMPLY BE OMITTED. teams[].players holds IDS ("y:40896"),
         and every name, position, projection and DataDawg$ lives in the pool rows they
         point at. Drop the pool and the rosters become unreadable id lists. So it is
         FILTERED to the ids the rosters reference, never removed.
         ⚠️ The counts below describe WHAT WAS RETURNED. ddDecorateBody's own matched /
         unmatched are league-wide and would contradict a trimmed pool on their face —
         reporting 406 matched beside 161 rows invites exactly the wrong conclusion. */
      const full = (args && args.scope) === "full";
      const body = feed.body || {};
      const allPool = Array.isArray(body.pool) ? body.pool : [];
      let pool = allPool, omitted = 0;
      if (!full && allPool.length) {
        const held = new Set();
        for (const t of (Array.isArray(body.teams) ? body.teams : []))
          for (const id of (t && Array.isArray(t.players) ? t.players : [])) held.add(id);
        // A league that reports no rosters at all would filter to nothing and look empty,
        // which is a worse answer than a big one. Keep the whole pool in that case.
        if (held.size) { pool = allPool.filter(x => x && held.has(x.id)); omitted = allPool.length - pool.length; }
      }
      const withDd = pool.filter(x => x && x.dd).length;

      return toolText({
        provider,
        leagueId: cred.leagueId,
        you: cred.teamId != null ? String(cred.teamId) : null,
        ...body,
        pool,
        dd: {
          ...(body.dd || {}),
          // ⚠️ Named for the rows actually in this payload. `matched`/`unmatched` on the
          // spread-in dd block stay league-wide; these two are the ones that describe
          // what the caller is holding.
          returnedRows: pool.length,
          returnedWithDollars: withDd,
          note: withDd < pool.length
            ? (pool.length - withDd) + " of the returned players have no DataDawg$ — the board did not match "
              + "them. That is a gap in the join, never a valuation of zero."
            : "Every returned player carries DataDawg$.",
        },
        scope: {
          returned: full ? "full" : "rosters",
          rosteredRows: full ? undefined : pool.length,
          freeAgentsOmitted: full ? 0 : omitted,
          howToGetThem: full || !omitted ? undefined
            : "Call again with scope:\"full\" for the " + omitted + " free agents. It is roughly three times "
              + "this payload, so ask for it only when the question is about who is available.",
        },
        method: {
          dollars: SITE + "/data/datadawg-dollars-method.md",
          page: SITE + "/fantasy-warroom.html",
          note: "DataDawg$ is converted for THIS league's settings against its own replacement level. It is not " +
                "Market Value, not what anyone paid, and not comparable across leagues with different rosters.",
        },
      });
    },
  },
  {
    name: "dd_draft_pool",
    title: "Draft player pool",
    catalog: "core",
    readOnlyHint: true,
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
        const r = await fetch(`${SITE}/data/pool.json`, { cf: { cacheTtlByStatus: { "200-299": 3600, "404": 1, "500-599": 0 }, cacheEverything: true } });
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
    title: "Survivor ownership snapshot",
    catalog: "core",
    readOnlyHint: true,
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
      // Names RL explicitly, matching survivorKV — see its note in the Worker.
      const kv = env.RL;
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
    title: "Survivor pick EV",
    catalog: "core",
    readOnlyHint: true,
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
      const kv = env.RL;   // names RL explicitly, matching survivorKV
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
        ownership_adjustment: "alive-count projection; pick mix assumed independent of survival",
    model: "One-week closed-form leverage: equity = P(win) × E[1/(1+survivors)], games independent, field mass survives by ownership share, E[1/(1+S)] by second-order Taylor. Win probabilities are the " + D.meta.captured + " snapshot blend (market 0.75 where a line existed). No future-value term: a team spent today is not priced against the weeks it could have covered — survivor.html's optimal-path view does that.",
        note: ownership === "modelled"
          ? "OWNERSHIP IS MODELLED (chalk softmax, exponent 2.4), not observed. A modelled ranking cannot see narrative picks and is wrong exactly where fading the field pays most. Post real pick data via /survivor-picks and this caveat disappears."
          : (stale ? "Posted ownership is over 72h old — treat as directional-only." : undefined),
        rows,
      });
    },
  },
  {
    name: "dd_optimize_survivor_path",
    title: "Survivor path optimizer",
    catalog: "full",
    readOnlyHint: true,
    description: "Computes the exact maximum-product survivor path from a starting week through Week 18, subject to teams already used and to any weeks that require two picks. Returns the path, run-the-table probability, each current-week option's future cost, and explicit rule/data caveats. This is a deterministic ceiling over a dated probability snapshot, not a recommendation or graded forecast.",
    inputSchema: {
      type: "object",
      properties: {
        from_week: { type: "integer", minimum: 1, maximum: 18, description: "First week to optimize (default 1)" },
        used_teams: { type: "array", maxItems: 32, items: { type: "string" }, description: "NFL team abbreviations already spent; case-insensitive" },
        reuse_teams: { type: "boolean", description: "Allow the same team in multiple weeks (default false)" },
        double_pick_from: { type: "integer", minimum: 0, maximum: 18, description: "Pool requires two picks every week from this week through Week 18; 0 means never. Modelled exactly: each such week is two assignment slots and spends two distinct teams." },
        double_pick_weeks: { type: "array", maxItems: 18, items: { type: "integer", minimum: 1, maximum: 18 }, description: "Specific weeks requiring two picks, for formats that are not a suffix (e.g. [9,12,13,14,15,16]). Combined with double_pick_from if both are given." },
      },
      additionalProperties: false,
    },
    async run(args) {
      const allowed = ["from_week", "used_teams", "reuse_teams", "double_pick_from", "double_pick_weeks"];
      if (!args || typeof args !== "object" || Array.isArray(args)) return toolErr("arguments must be an object");
      const extra = Object.keys(args).filter(key => !allowed.includes(key));
      if (extra.length) return toolErr("Unknown argument" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
      const fromWeek = args.from_week === undefined ? 1 : args.from_week;
      if (!Number.isInteger(fromWeek) || fromWeek < 1 || fromWeek > 18) return toolErr("from_week must be a whole number from 1 to 18");
      const reuse = args.reuse_teams === true;
      if (args.reuse_teams !== undefined && typeof args.reuse_teams !== "boolean") return toolErr("reuse_teams must be true or false");
      const doublePickFrom = args.double_pick_from === undefined ? 0 : args.double_pick_from;
      if (!Number.isInteger(doublePickFrom) || doublePickFrom < 0 || doublePickFrom > 18)
        return toolErr("double_pick_from must be 0 or a whole number from 1 to 18");
      if (args.double_pick_weeks !== undefined && !Array.isArray(args.double_pick_weeks))
        return toolErr("double_pick_weeks must be an array");
      const explicitDouble = args.double_pick_weeks || [];
      if (explicitDouble.some(w => !Number.isInteger(w) || w < 1 || w > 18))
        return toolErr("double_pick_weeks entries must be whole numbers from 1 to 18");
      // from_week is a suffix rule, double_pick_weeks is a list; a caller may state both.
      const doubleWeeks = new Set(explicitDouble);
      if (doublePickFrom > 0) for (let w = doublePickFrom; w <= 18; w++) doubleWeeks.add(w);
      if (args.used_teams !== undefined && !Array.isArray(args.used_teams)) return toolErr("used_teams must be an array");
      if ((args.used_teams || []).length > 32) return toolErr("used_teams is limited to 32 teams");

      const D = await mcpSurvivor();
      const usedList = (args.used_teams || []).map(team => String(team).trim().toUpperCase()).filter(Boolean);
      if (new Set(usedList).size !== usedList.length) return toolErr("used_teams contains a duplicate");
      const unknown = usedList.filter(team => !Object.prototype.hasOwnProperty.call(D.elo, team));
      if (unknown.length) return toolErr("Unknown team abbreviation" + (unknown.length > 1 ? "s" : "") + ": " + unknown.join(", "));
      const used = new Set(usedList);
      const path = mcpSolveSurvivorPath(D, fromWeek, used, reuse, doubleWeeks);
      const currentTable = mcpSurvivorWeekTable(D, fromWeek);
      if (!Object.keys(currentTable).length) return toolErr("No games found for week " + fromWeek + ".");

      const baselineFuture = fromWeek === 18 ? 1 : mcpSolveSurvivorPath(D, fromWeek + 1, used, reuse, doubleWeeks).survival;
      const selected = path.assignments.find(pick => pick.week === fromWeek);
      const currentOptions = Object.keys(currentTable)
        .filter(team => reuse || !used.has(team))
        .map(team => {
          const nextUsed = new Set(used);
          if (!reuse) nextUsed.add(team);
          const future = fromWeek === 18 ? 1 : mcpSolveSurvivorPath(D, fromWeek + 1, nextUsed, reuse, doubleWeeks).survival;
          const game = currentTable[team];
          return {
            team, opponent: game.opponent, home: game.home, probability: game.probability,
            source: game.source, game_id: game.game_id, date: game.date,
            future_path_probability: future,
            future_cost: baselineFuture > 0 ? 1 - future / baselineFuture : 0,
            combined_path_probability: game.probability * future,
            selected: !!selected && selected.team === team,
          };
        })
        .sort((a, b) => b.combined_path_probability - a.combined_path_probability || b.probability - a.probability || a.team.localeCompare(b.team));
      if (!currentOptions.length) return toolErr("Every team playing week " + fromWeek + " is on the used list.");

      const weakest = path.assignments.length
        ? path.assignments.reduce((low, pick) => pick.probability < low.probability ? pick : low)
        : null;
      const modelGames = D.games.filter(game => game.src === "model").length;
      const warnings = [
        "CEILING, NOT A PLAN: the maximum-product path assumes the " + D.meta.captured + " probabilities stay fixed. Injuries, lines and ratings will move, so rerun it as inputs update.",
        modelGames + " of " + D.games.length + " games have model-only probabilities; the rest use the published market/model blend where a captured line exists.",
        "Run-the-table probability is modelled and ungraded. It is the product of the selected weekly probabilities, not evidence of a validated edge.",
      ];
      if (doubleWeeks.size)
        warnings.push("Double-pick weeks are modelled exactly: " + [...doubleWeeks].sort((a, b) => a - b).join(", ")
          + " each spend two distinct teams, and covered_picks counts slots rather than weeks.");
      if (reuse) warnings.push("reuse_teams is on: used_teams is ignored and the same team may be selected in multiple weeks.");

      return toolText({
        season: D.meta.season,
        as_of: D.meta.captured,
        from_week: fromWeek,
        through_week: 18,
        access: "read-only",
        stored: false,
        modelled: true,
        graded: false,
        rules_fully_modelled: true,
        double_pick_weeks: [...doubleWeeks].sort((a, b) => a - b),
        reuse_teams: reuse,
        used_teams: usedList,
        path: path.assignments,
        // ⚠️ covered_picks counts SLOTS, not weeks — a double-pick week wants two of
        // them. covered_weeks is kept alongside and named so a consumer never has to
        // guess which quantity it is reading.
        covered_picks: path.covered,
        requested_picks: path.slots,
        covered_weeks: path.weeksCovered,
        requested_weeks: path.weeks.length,
        complete: path.complete,
        run_the_table_probability: path.survival,
        weakest_link: weakest,
        current_week_options: currentOptions,
        warnings,
      });
    },
  },
  {
    name: "dd_analyze_matchup",
    title: "NFL matchup read",
    catalog: "core",
    readOnlyHint: true,
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
    title: "Odds converter",
    catalog: "core",
    readOnlyHint: true,
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
    title: "Elo game probability",
    catalog: "full",
    readOnlyHint: true,
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
    title: "Probability to margin",
    catalog: "full",
    readOnlyHint: true,
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
    title: "Two-way devig",
    catalog: "full",
    readOnlyHint: true,
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
    title: "Parlay pricer",
    catalog: "core",
    readOnlyHint: true,
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
    title: "Bet EV",
    catalog: "core",
    readOnlyHint: true,
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
    title: "Hedge sizer",
    catalog: "full",
    readOnlyHint: true,
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
    title: "NFL passer rating",
    catalog: "full",
    readOnlyHint: true,
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
    title: "Score one forecast",
    catalog: "full",
    readOnlyHint: true,
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
    title: "Summarize probabilities",
    catalog: "full",
    readOnlyHint: true,
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
    name: "dd_get_cfb_rating_system",
    title: "CFB rating systems",
    catalog: "full",
    readOnlyHint: true,
    description: "List the dated CFB ratings registry or return one exact registered system with its source receipt, output availability and matchup transform. Registration documents a method; it does not imply prospective forecasts, grading, consensus status, current-2026 relevance or betting skill.",
    inputSchema: {
      type: "object",
      properties: {
        system_id: { type: "string", minLength: 1, maxLength: 80, description: "Optional exact registered system slug. Omit for the compact registry index." },
      },
      additionalProperties: false,
    },
    async run(args) {
      const input = mcpCfbRatingSystemArgs(args);
      const envelope = await mcpCfbTeamProfiles();
      const systems = envelope.data.systems;
      const system = input.systemId ? systems.find(row => row.system_id === input.systemId) || null : null;
      if (input.systemId && !system)
        throw new Error("system_id is not present in the dated CFB ratings registry; available: " + systems.map(row => row.system_id).join(", "));
      const availableSystems = systems.map(row => ({
        system_id: row.system_id,
        name: row.name,
        provider: row.provider,
        kind: row.kind,
        feature_family: row.feature_family,
        available_outputs: Object.entries(row.outputs).filter(([, value]) => value && value.available === true).map(([key]) => key),
        prospective_forecasts_exist: row.prospective_forecasts_exist === true,
        graded: row.graded === true,
      }));
      const scopedSystems = system ? [system] : systems;
      const consensusBuilt = envelope.data.consensus.status === "built";
      const prospective = scopedSystems.some(row => row.prospective_forecasts_exist === true);
      const graded = scopedSystems.length > 0 && scopedSystems.every(row => row.graded === true);
      const warnings = ["Registry membership documents source and output contracts; it is not evidence of forecast skill."];
      if (systems.length === 1) warnings.push("The current registry contains one system; one rating cannot form a consensus.");
      if (!consensusBuilt) warnings.push("The registry's published consensus status is not built.");
      if (!prospective) warnings.push("No prospective CFB forecast receipts exist for the returned system scope.");
      if (!graded) warnings.push("No prospective graded track record exists for the returned system scope.");
      warnings.push("Unsupported outputs remain explicitly unavailable rather than being inferred from team strength.");
      return toolText({
        mode: system ? "rating-system" : "rating-system-index",
        query: { system_id: input.systemId },
        available_systems: availableSystems,
        system,
        rating_period: envelope.data.rating_period,
        consensus: envelope.data.consensus,
        as_of: envelope.as_of,
        source: envelope.source,
        built: envelope.built || null,
        integrity: envelope.integrity || null,
        registered_system_count: systems.length,
        consensus_built: consensusBuilt,
        prospective_forecasts_exist: prospective,
        graded,
        current_2026_method: envelope.data.rating_period && envelope.data.rating_period.season === 2026 &&
          envelope.data.rating_period.prospective === true,
        read_only: true,
        stored: false,
        warnings,
      });
    },
  },
  {
    name: "dd_rank_cfb_teams",
    title: "CFB team ranking",
    catalog: "full",
    readOnlyHint: true,
    description: "Return a bounded dated ranking from one exact registered CFB rating system, optionally filtered to an exact conference. Observed 2025 results remain separate from modelled team strength. The current registry contains one end-of-2025 retrodictive, ungraded Elo system; this is not a consensus, current 2026 power ranking or recommendation.",
    inputSchema: {
      type: "object",
      properties: {
        system_id: { type: "string", minLength: 1, maxLength: 80, description: "Exact registered system slug. Optional only while the registry has one system." },
        conference: { type: "string", minLength: 1, maxLength: 80, description: "Optional exact conference name, case-insensitive." },
        offset: { type: "integer", minimum: 0, maximum: 199, default: 0 },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 25 },
      },
      additionalProperties: false,
    },
    async run(args) {
      const input = mcpCfbRankingArgs(args);
      const envelope = await mcpCfbTeamProfiles();
      const systems = envelope.data.systems;
      let system = null;
      if (input.systemId) {
        system = systems.find(row => row.system_id === input.systemId) || null;
        if (!system) throw new Error("system_id is not present in the dated CFB ratings registry; available: " + systems.map(row => row.system_id).join(", "));
      } else if (systems.length === 1) {
        system = systems[0];
      } else {
        throw new Error("system_id is required when the CFB ratings registry contains more than one system; available: " + systems.map(row => row.system_id).join(", "));
      }
      let conference = null;
      if (input.conference) {
        const conferences = [...new Set(envelope.data.teams.map(team => team.conference).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b));
        conference = conferences.find(name => name.toLowerCase() === input.conference.toLowerCase()) || null;
        if (!conference) throw new Error("conference is not present in the dated CFB ratings registry; available: " + conferences.join(", "));
      }
      const ranked = envelope.data.teams.filter(team =>
        (!conference || team.conference === conference) && team.systems[system.system_id] &&
        Number.isInteger(team.systems[system.system_id].rank) &&
        Number.isFinite(team.systems[system.system_id].team_strength)
      ).sort((a, b) =>
        a.systems[system.system_id].rank - b.systems[system.system_id].rank || a.team.localeCompare(b.team)
      );
      const teams = ranked.slice(input.offset, input.offset + input.limit).map(team => ({
        team_slug: team.team_slug,
        team: team.team,
        conference: team.conference || null,
        rating: team.systems[system.system_id],
        observed_results: mcpCfbObservedView(team),
      }));
      const prospective = envelope.data.rating_period && envelope.data.rating_period.prospective === true &&
        system.prospective_forecasts_exist === true;
      const graded = system.graded === true;
      const warnings = ["This ranks one declared system at its published rating period; it is not a consensus ranking."];
      if (!prospective) warnings.push("The selected system has no prospective CFB forecast receipt in this snapshot.");
      if (!graded) warnings.push("The selected system has no prospective graded track record in this snapshot.");
      warnings.push("Observed records and scoring are shown separately and do not alter the modelled rank returned here.");
      warnings.push("Current rosters, injuries, availability, talent, portal, market and play-efficiency inputs are absent.");
      return toolText({
        query: { system_id: system.system_id, conference, offset: input.offset, limit: input.limit },
        system: {
          system_id: system.system_id,
          name: system.name,
          provider: system.provider,
          kind: system.kind,
          feature_family: system.feature_family,
          source_snapshot_id: system.source_snapshot_id,
          source_url: system.source_url,
          model_card_url: system.model_card_url,
          prospective_forecasts_exist: system.prospective_forecasts_exist === true,
          graded: system.graded === true,
        },
        registered_systems: systems.map(row => ({ system_id: row.system_id, name: row.name })),
        rating_period: envelope.data.rating_period,
        consensus: envelope.data.consensus,
        matched_before_pagination: ranked.length,
        returned: teams.length,
        teams,
        as_of: envelope.as_of,
        source: envelope.source,
        integrity: envelope.integrity || null,
        observed_results_are_facts: true,
        modelled_fields: ["teams[].rating"],
        retrodictive: envelope.data.rating_period && envelope.data.rating_period.prospective !== true,
        prospective,
        graded,
        consensus_ranking: false,
        current_2026_ranking: envelope.data.rating_period && envelope.data.rating_period.season === 2026 && prospective,
        read_only: true,
        stored: false,
        warnings,
      });
    },
  },
  {
    name: "dd_cfb_team_profile",
    title: "CFB team profile",
    catalog: "full",
    readOnlyHint: true,
    description: "Read one exact team from the compact dated CFB profile surface. Returns observed 2025 record/scoring facts separately from the end-of-2025 retrodictive Elo value, rating rank, provenance and non-ranked expected-versus-observed diagnostic. The diagnostic is not luck or team quality. This is ungraded, not a 2026 forecast, and not a consensus or betting recommendation.",
    inputSchema: {
      type: "object",
      properties: {
        team: { type: "string", minLength: 1, maxLength: 80, description: "Exact registry team name or slug, case-insensitive; for example Ohio State or ohio-state." },
      },
      required: ["team"],
      additionalProperties: false,
    },
    async run(args) {
      const input = mcpCfbTeamArgs(args);
      const envelope = await mcpCfbTeamProfiles();
      const team = mcpCfbTeamMatch(envelope, input);
      const registeredSystems = envelope.data.systems.map(system => ({
        system_id: system.system_id,
        name: system.name,
        provider: system.provider,
        kind: system.kind,
        feature_family: system.feature_family,
        source_snapshot_id: system.source_snapshot_id,
        source_url: system.source_url,
        model_card_url: system.model_card_url,
        outputs: system.outputs,
        team_diagnostics: system.team_diagnostics,
        prospective_forecasts_exist: system.prospective_forecasts_exist === true,
        graded: system.graded === true,
        rating: Object.prototype.hasOwnProperty.call(team.systems, system.system_id) ? team.systems[system.system_id] : null,
      }));
      const period = envelope.data.rating_period;
      const consensus = envelope.data.consensus;
      const warnings = [];
      if (period && period.prospective !== true)
        warnings.push("This rating period is retrodictive and does not represent a current-season forecast.");
      if (registeredSystems.length === 1)
        warnings.push("The registry currently contains one system; one rating is not a consensus.");
      if (!registeredSystems.some(system => system.prospective_forecasts_exist))
        warnings.push("No registered system has a prospective CFB forecast in this snapshot.");
      if (!registeredSystems.some(system => system.graded))
        warnings.push("The registered ratings are ungraded prospectively.");
      warnings.push("Expected-versus-observed team diagnostics are retrodictive model residuals, not luck, team-quality labels, forecasts, grades or rankings.");
      warnings.push("This profile does not include current market prices, talent, roster, injury, portal, matchup or availability inputs.");
      return toolText({
        query: input.query,
        match: { exact: true, team_slug: team.team_slug },
        team: { team_slug: team.team_slug, name: team.team, conference: team.conference || null },
        observed_results: team.observed_results || null,
        rating_period: period,
        systems: registeredSystems,
        consensus,
        as_of: envelope.as_of,
        source: envelope.source,
        built: envelope.built || null,
        integrity: envelope.integrity || null,
        modelled: true,
        observed_results_are_facts: true,
        modelled_fields: ["systems", "systems[].rating.retrodictive_team_diagnostic"],
        retrodictive: period && period.prospective !== true,
        prospective: period && period.prospective === true,
        graded: registeredSystems.length > 0 && registeredSystems.every(system => system.graded),
        read_only: true,
        stored: false,
        warnings,
      });
    },
  },
  {
    name: "dd_compare_cfb_teams",
    title: "Compare CFB teams",
    catalog: "full",
    readOnlyHint: true,
    description: "Compare two exact teams on the same dated compact CFB snapshot. Returns observed 2025 records/scoring, non-ranked expected-versus-observed diagnostics and per-system retrodictive rating deltas. Diagnostics are not luck or team-quality labels. It does not produce a matchup win probability, spread, forecast, consensus, edge or recommendation.",
    inputSchema: {
      type: "object",
      properties: {
        team_a: { type: "string", minLength: 1, maxLength: 80, description: "First exact registry team name or slug." },
        team_b: { type: "string", minLength: 1, maxLength: 80, description: "Second exact registry team name or slug." },
      },
      required: ["team_a", "team_b"],
      additionalProperties: false,
    },
    async run(args) {
      const input = mcpCfbCompareArgs(args);
      const envelope = await mcpCfbTeamProfiles();
      const teamA = mcpCfbTeamMatch(envelope, input.teamA);
      const teamB = mcpCfbTeamMatch(envelope, input.teamB);
      const observedA = mcpCfbObservedView(teamA);
      const observedB = mcpCfbObservedView(teamB);
      const systems = envelope.data.systems.map(system => {
        const a = teamA.systems[system.system_id] || null;
        const b = teamB.systems[system.system_id] || null;
        return {
          system_id: system.system_id,
          name: system.name,
          team_a: a,
          team_b: b,
          team_strength_delta_a_minus_b: a && b && Number.isFinite(a.team_strength) && Number.isFinite(b.team_strength)
            ? a.team_strength - b.team_strength : null,
          rank_delta_a_minus_b: a && b && Number.isInteger(a.rank) && Number.isInteger(b.rank) ? a.rank - b.rank : null,
          prospective_forecasts_exist: system.prospective_forecasts_exist === true,
          graded: system.graded === true,
        };
      });
      const finiteDelta = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
      return toolText({
        query: { team_a: input.teamA.query, team_b: input.teamB.query },
        teams: {
          team_a: { team_slug: teamA.team_slug, name: teamA.team, conference: teamA.conference || null, observed_results: observedA },
          team_b: { team_slug: teamB.team_slug, name: teamB.team, conference: teamB.conference || null, observed_results: observedB },
        },
        comparison: {
          observed_2025: {
            win_percentage_delta_a_minus_b: finiteDelta(observedA.win_percentage, observedB.win_percentage),
            point_differential_per_game_delta_a_minus_b: finiteDelta(observedA.point_differential_per_game, observedB.point_differential_per_game),
            note: "Descriptive season-result differences only; schedule strength is not adjusted here.",
          },
          systems,
          rank_delta_note: "Negative rank_delta_a_minus_b means team_a has the better (lower-numbered) rank.",
        },
        rating_period: envelope.data.rating_period,
        consensus: envelope.data.consensus,
        as_of: envelope.as_of,
        source: envelope.source,
        integrity: envelope.integrity || null,
        observed_results_are_facts: true,
        modelled_fields: ["comparison.systems"],
        retrodictive: envelope.data.rating_period && envelope.data.rating_period.prospective !== true,
        prospective: false,
        graded: false,
        read_only: true,
        stored: false,
        warnings: [
          "The comparison is not a head-to-head game projection and supplies no win probability or spread.",
          "Observed records and scoring are not opponent-adjusted; differences in schedule strength are not modelled.",
          "The registry currently contains one retrodictive, ungraded rating system; one system is not a consensus.",
          "Expected-versus-observed team diagnostics are retrodictive model residuals, not luck, team-quality labels, forecasts, grades or rankings.",
          "Current market prices, rosters, injuries, availability, talent, portal and matchup inputs are absent.",
        ],
      });
    },
  },
  {
    name: "dd_project_cfb_matchup",
    title: "CFB matchup projection",
    catalog: "full",
    readOnlyHint: true,
    description: "Calculate a hypothetical home/away win probability from two exact teams using the published Data Dawgs CFB Elo transform and its dated end-of-2025 ratings. This is retrodictive and ungraded: not a scheduled 2026 forecast, market edge, spread, total, consensus or recommendation.",
    inputSchema: {
      type: "object",
      properties: {
        home_team: { type: "string", minLength: 1, maxLength: 80, description: "Exact home-team registry name or slug." },
        away_team: { type: "string", minLength: 1, maxLength: 80, description: "Exact away-team registry name or slug." },
        neutral_site: { type: "boolean", default: false, description: "True removes the published home-field Elo adjustment." },
      },
      required: ["home_team", "away_team"],
      additionalProperties: false,
    },
    async run(args) {
      const input = mcpCfbProjectionArgs(args);
      const envelope = await mcpCfbTeamProfiles();
      const home = mcpCfbTeamMatch(envelope, input.homeTeam);
      const away = mcpCfbTeamMatch(envelope, input.awayTeam);
      const projections = envelope.data.systems.map(system => {
        const transform = system.matchup_probability;
        const homeRating = home.systems[system.system_id];
        const awayRating = away.systems[system.system_id];
        if (!transform || transform.available !== true) return {
          system_id: system.system_id, available: false, reason: "This registered system has no declared matchup transform.",
        };
        if (!homeRating || !awayRating || !Number.isFinite(homeRating.team_strength) || !Number.isFinite(awayRating.team_strength))
          throw new Error("team strength is missing for registered system " + system.system_id);
        if (!Number.isFinite(transform.elo_scale) || transform.elo_scale <= 0 ||
            !Number.isFinite(transform.home_field_elo) || !Number.isFinite(transform.neutral_site_home_field_elo))
          throw new Error("invalid matchup transform for registered system " + system.system_id);
        const venueAdjustment = input.neutralSite ? transform.neutral_site_home_field_elo : transform.home_field_elo;
        const adjustedDifference = homeRating.team_strength - awayRating.team_strength + venueAdjustment;
        const pHome = 1 / (1 + 10 ** (-adjustedDifference / transform.elo_scale));
        return {
          system_id: system.system_id,
          name: system.name,
          available: true,
          home_team_strength: homeRating.team_strength,
          away_team_strength: awayRating.team_strength,
          raw_team_strength_difference_home_minus_away: homeRating.team_strength - awayRating.team_strength,
          venue_adjustment_elo: venueAdjustment,
          adjusted_elo_difference: adjustedDifference,
          home_win_probability: pHome,
          away_win_probability: 1 - pHome,
          formula: transform.formula,
          elo_scale: transform.elo_scale,
          graded: system.graded === true,
          prospective_forecasts_exist: system.prospective_forecasts_exist === true,
        };
      });
      if (!projections.some(row => row.available)) throw new Error("no registered CFB system has a callable matchup transform");
      return toolText({
        projection_kind: "hypothetical matchup at the published rating period",
        matchup: {
          away_team: { team_slug: away.team_slug, name: away.team, conference: away.conference || null },
          home_team: { team_slug: home.team_slug, name: home.team, conference: home.conference || null },
          neutral_site: input.neutralSite,
        },
        rating_period: envelope.data.rating_period,
        projections,
        consensus: envelope.data.consensus,
        as_of: envelope.as_of,
        source: envelope.source,
        integrity: envelope.integrity || null,
        modelled: true,
        retrodictive: true,
        prospective: false,
        scheduled_game: false,
        graded: false,
        read_only: true,
        stored: false,
        unsupported_outputs: { expected_margin: null, spread: null, predicted_total: null },
        warnings: [
          "This uses end-of-2025 ratings for a hypothetical matchup; it is not a frozen 2026 forecast receipt.",
          "Only the published Elo transform is available. One retrodictive system is not a consensus.",
          "The calculation does not include a current roster, injuries, availability, talent, portal, matchup, market or schedule context.",
          "No expected margin, spread or total is inferred from win probability.",
        ],
      });
    },
  },
  {
    name: "dd_project_cfb_schedule_path",
    title: "CFB schedule path",
    catalog: "full",
    readOnlyHint: true,
    description: "Calculate an exact win-count distribution for one team over a caller-supplied hypothetical schedule of up to 20 opponents. An optional minimum-wins threshold also returns each supplied game's exact threshold leverage if its result were forced to a win versus loss. Uses dated end-of-2025 CFB Elo with fixed independent games; it is not an actual schedule, playoff model or forecast.",
    inputSchema: {
      type: "object",
      properties: {
        team: { type: "string", minLength: 1, maxLength: 80, description: "Exact focal-team registry name or slug." },
        games: {
          type: "array", minItems: 1, maxItems: 20,
          description: "Caller-supplied hypothetical path. Repeated opponents are allowed for rematch scenarios.",
          items: {
            type: "object",
            properties: {
              opponent: { type: "string", minLength: 1, maxLength: 80, description: "Exact opponent registry name or slug." },
              venue: { type: "string", enum: ["home", "away", "neutral"], default: "neutral" },
              label: { type: "string", minLength: 1, maxLength: 80, description: "Optional caller label such as Week 1 or semifinal." },
            },
            required: ["opponent"],
            additionalProperties: false,
          },
        },
        minimum_wins: { type: "integer", minimum: 0, maximum: 20, description: "Optional threshold for P(wins >= threshold); cannot exceed games.length." },
      },
      required: ["team", "games"],
      additionalProperties: false,
    },
    async run(args) {
      const input = mcpCfbScheduleArgs(args);
      const envelope = await mcpCfbTeamProfiles();
      const focal = mcpCfbTeamMatch(envelope, input.team);
      const games = input.games.map((game, index) => {
        const opponent = mcpCfbTeamMatch(envelope, game.opponent);
        if (opponent.team_slug === focal.team_slug)
          throw new Error("games[" + index + "].opponent must be different from the focal team");
        return { index: index + 1, label: game.label, venue: game.venue, opponent };
      });
      const systems = envelope.data.systems.map(system => {
        const probabilities = [];
        const projectedGames = games.map(game => {
          const projection = mcpCfbMatchupProbability(
            system,
            focal.systems[system.system_id],
            game.opponent.systems[system.system_id],
            game.venue
          );
          if (!projection) return {
            index: game.index, label: game.label, venue: game.venue,
            opponent: { team_slug: game.opponent.team_slug, name: game.opponent.team },
            available: false,
          };
          probabilities.push(projection.focal_win_probability);
          return {
            index: game.index, label: game.label, venue: game.venue,
            opponent: { team_slug: game.opponent.team_slug, name: game.opponent.team, conference: game.opponent.conference || null },
            available: true,
            focal_win_probability: projection.focal_win_probability,
            focal_loss_probability: 1 - projection.focal_win_probability,
            venue_adjustment_elo: projection.venue_adjustment_elo,
          };
        });
        if (probabilities.length !== games.length) return {
          system_id: system.system_id, name: system.name, available: false,
          reason: "This registered system has no declared matchup transform for every game.",
        };
        const exact = mcpCfbPoissonBinomial(probabilities);
        const expectedWins = probabilities.reduce((sum, p) => sum + p, 0);
        const variance = probabilities.reduce((sum, p) => sum + p * (1 - p), 0);
        let mostLikelyWins = 0;
        for (let wins = 1; wins < exact.length; wins++) if (exact[wins] > exact[mostLikelyWins]) mostLikelyWins = wins;
        const thresholdGameLeverage = input.minimumWins === null ? null : projectedGames.map((game, index) => {
          const withoutGame = mcpCfbPoissonBinomial(probabilities.filter((_, j) => j !== index));
          const ifWin = mcpCfbProbabilityAtLeast(withoutGame, input.minimumWins - 1);
          const ifLoss = mcpCfbProbabilityAtLeast(withoutGame, input.minimumWins);
          return {
            index: game.index,
            label: game.label,
            opponent: game.opponent,
            venue: game.venue,
            probability_at_least_minimum_wins_if_forced_win: ifWin,
            probability_at_least_minimum_wins_if_forced_loss: ifLoss,
            threshold_probability_swing: ifWin - ifLoss,
          };
        }).sort((a, b) => b.threshold_probability_swing - a.threshold_probability_swing || a.index - b.index);
        return {
          system_id: system.system_id,
          name: system.name,
          available: true,
          method: "Exact Poisson-binomial distribution over fixed independent game probabilities; no Monte Carlo.",
          games: projectedGames,
          expected_wins: expectedWins,
          expected_losses: games.length - expectedWins,
          win_count_standard_deviation: Math.sqrt(variance),
          most_likely_wins: mostLikelyWins,
          undefeated_probability: exact[games.length],
          winless_probability: exact[0],
          minimum_wins: input.minimumWins,
          probability_at_least_minimum_wins: input.minimumWins === null
            ? null : mcpCfbProbabilityAtLeast(exact, input.minimumWins),
          threshold_game_leverage: thresholdGameLeverage,
          threshold_leverage_definition: input.minimumWins === null ? null :
            "Exact change in P(wins >= minimum_wins) when one supplied game's result is forced from loss to win, with all other independent fixed-rating probabilities unchanged.",
          exact_win_distribution: exact.map((probability, wins) => ({ wins, probability })),
          graded: system.graded === true,
          prospective_forecasts_exist: system.prospective_forecasts_exist === true,
        };
      });
      if (!systems.some(system => system.available))
        throw new Error("no registered CFB system can project every game in this schedule path");
      return toolText({
        projection_kind: "caller-supplied hypothetical schedule path at the published rating period",
        team: { team_slug: focal.team_slug, name: focal.team, conference: focal.conference || null },
        games_supplied: games.length,
        rating_period: envelope.data.rating_period,
        systems,
        consensus: envelope.data.consensus,
        as_of: envelope.as_of,
        source: envelope.source,
        integrity: envelope.integrity || null,
        modelled: true,
        retrodictive: true,
        prospective: false,
        actual_schedule: false,
        playoff_or_conference_rules_modelled: false,
        graded: false,
        read_only: true,
        stored: false,
        assumptions: [
          "Ratings are fixed at the published end-of-2025 values for every game; wins and losses do not update later matchup probabilities.",
          "Game outcomes are independent conditional on the fixed probabilities.",
          "The caller supplied every opponent and venue; Data Dawgs did not assert that this is a real schedule.",
          "Threshold leverage, when requested, changes only one supplied game's forced result and leaves every other fixed probability unchanged.",
        ],
        warnings: [
          "This is an exact distribution over a hypothetical path, not a prospective 2026 season forecast or receipt.",
          "Conference standings, tiebreakers, championship qualification, playoff selection and seed rules are not modelled.",
          "Win-threshold leverage is not conference or playoff leverage unless the caller's threshold independently represents that event, which this tool does not establish.",
          "The registry currently contains one retrodictive, ungraded Elo system; one system is not a consensus.",
          "Current rosters, injuries, availability, talent, portal, market and matchup-style inputs are absent.",
        ],
      });
    },
  },
  {
    name: "dd_find_cfb_record_divergence",
    title: "CFB record divergence",
    catalog: "full",
    readOnlyHint: true,
    description: "Explore dated 2025 differences between each team's observed record rank and scoring-margin rank, optionally by exact team, direction, conference or minimum absolute gap. Returns the aggregate held-out validation receipt too. Descriptive only: it does not label teams overrated/underrated, claim prospective value, use timestamped market prices or make a betting recommendation.",
    inputSchema: {
      type: "object",
      properties: {
        team: { type: "string", minLength: 1, maxLength: 80, description: "Optional exact team name or slug, case-insensitive." },
        direction: {
          type: "string",
          enum: ["all", "record-ahead-of-scoring", "scoring-ahead-of-record", "aligned"],
          default: "all",
          description: "Descriptive direction of the record rank relative to scoring-margin rank.",
        },
        conference: { type: "string", minLength: 1, maxLength: 80, description: "Optional exact conference name, case-insensitive." },
        minimum_absolute_rank_gap: { type: "integer", minimum: 0, maximum: 135, default: 0 },
        limit: { type: "integer", minimum: 1, maximum: 25, default: 10 },
      },
      additionalProperties: false,
    },
    async run(args) {
      const input = mcpCfbDivergenceArgs(args);
      const evidence = await mcpCfbRecordDivergenceEvidence();
      const baseline = evidence.baseline;
      const validation = evidence.validation;
      const sourceRows = input.team
        ? [mcpCfbDivergenceTeamMatch(baseline.data.rows, input.team)]
        : baseline.data.rows.slice();
      let conference = null;
      if (input.conference) {
        const conferences = [...new Set(baseline.data.rows.map(row => row.conference))].sort((a, b) => a.localeCompare(b));
        conference = conferences.find(name => name.toLowerCase() === input.conference.toLowerCase()) || null;
        if (!conference) throw new Error("conference is not present in the dated record-divergence surface; available: " + conferences.join(", "));
      }
      const matches = sourceRows.filter(row =>
        (input.direction === "all" || row.descriptive_direction === input.direction) &&
        (!conference || row.conference === conference) &&
        Math.abs(row.record_scoring_rank_gap) >= input.minimumAbsoluteRankGap
      ).sort((a, b) =>
        Math.abs(b.record_scoring_rank_gap) - Math.abs(a.record_scoring_rank_gap) ||
        a.team.localeCompare(b.team)
      );
      const rows = matches.slice(0, input.limit).map(row => ({
        team_slug: row.team_slug,
        team: row.team,
        conference: row.conference,
        through_at: row.through_at,
        games: row.games,
        record: row.record,
        win_percentage: row.win_percentage,
        record_rank: row.record_rank,
        point_differential_per_game: row.point_differential_per_game,
        scoring_rank: row.scoring_rank,
        record_scoring_rank_gap: row.record_scoring_rank_gap,
        absolute_rank_gap: Math.abs(row.record_scoring_rank_gap),
        descriptive_direction: row.descriptive_direction,
        one_score_games: row.one_score_games,
      }));
      const result = validation.data.result;
      return toolText({
        query: {
          team: input.team ? input.team.query : null,
          direction: input.direction,
          conference,
          minimum_absolute_rank_gap: input.minimumAbsoluteRankGap,
          limit: input.limit,
        },
        season: baseline.data.season,
        ranking_basis: baseline.data.definitions,
        matched_before_limit: matches.length,
        returned: rows.length,
        rows,
        validation: {
          status: validation.data.status,
          finding: result.finding,
          qualified_games: result.qualified_games,
          holdout_games: result.holdout.n_games,
          holdout_brier_improvement_over_elo: result.holdout.brier_improvement_over_elo,
          holdout_log_loss_improvement_over_elo: result.holdout.log_loss_improvement_over_elo,
          promotion_gate_passed: result.promotion_gate && result.promotion_gate.passed === true,
          design: validation.data.design,
          roadmap_decision: validation.data.roadmap_decision,
          published_granularity: validation.data.published_granularity,
          as_of: validation.as_of,
          source: validation.source,
          integrity: validation.integrity || null,
        },
        as_of: baseline.as_of,
        source: baseline.source,
        integrity: baseline.integrity || null,
        observed_descriptive_rows: true,
        modelled_fields: ["validation"],
        current_team_labels_permitted: false,
        prospective: false,
        market_adjusted: false,
        graded: false,
        read_only: true,
        stored: false,
        warnings: [
          "Rank gaps describe completed 2025 results; schedule strength is not adjusted in the team rows.",
          "A single-season chronological holdout showed a small incremental signal beyond Elo, but this has not been validated prospectively or against timestamped market prices.",
          "The validation receipt is aggregate-only and explicitly prohibits current-team predictive labels.",
          "Do not convert these rows into overrated, underrated, fraud, betting-edge or recommendation claims.",
        ],
      });
    },
  },
  {
    name: "dd_get_cfb_model_disagreement",
    title: "CFB model disagreement",
    catalog: "full",
    readOnlyHint: true,
    description: "Read the dated aggregate 2025 CFB Elo-versus-market disagreement probe, including bucket measurements and the exact data blocker. The study is blocked because market observations have no capture timestamp; it does not identify a better model, authorize a blend or provide game-level edges.",
    inputSchema: MCP_NO_ARGS,
    async run(args) {
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
      const extra = Object.keys(args);
      if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
      const envelope = await mcpCfbModelDisagreementEvidence();
      const data = envelope.data;
      return toolText({
        question: data.question,
        finding: data.finding,
        conclusion_withheld: true,
        why_blocked: data.why_blocked,
        what_would_unblock_it: data.what_would_unblock_it,
        measured_anyway: data.measured_anyway,
        governance: data.governance || [],
        as_of: envelope.as_of,
        source: envelope.source,
        built: envelope.built || null,
        integrity: envelope.integrity || null,
        market_observation_timestamp_available: false,
        market_price_timing: "unknown",
        better_model_identified: false,
        consensus_or_blend_authorized: false,
        game_level_edges_available: false,
        prospective: false,
        graded: false,
        read_only: true,
        stored: false,
        warnings: [
          "The bucket measurements are reproducible, but the headline comparison is confounded by unknown market observation timing.",
          "A larger market advantage in wider-gap buckets cannot distinguish a better method from a later information set.",
          "Do not infer a model winner, consensus weight, current-game edge or recommendation from this blocked study.",
        ],
      });
    },
  },
  {
    name: "dd_get_cfb_model_receipt_status",
    title: "CFB receipt ledger status",
    catalog: "full",
    readOnlyHint: true,
    description: "Report the dated append-only CFB prospective forecast receipt ledger status and bounded counts by model. The ledger is currently empty by design; immutable receipt rows remain ungraded and outcomes belong in a separate future grading surface. This tool does not return backtest results or invent a leaderboard.",
    inputSchema: MCP_NO_ARGS,
    async run(args) {
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
      const extra = Object.keys(args);
      if (extra.length) throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + ": " + extra.join(", "));
      const envelope = await mcpCfbModelReceipts();
      const rows = envelope.data;
      const byModel = new Map();
      for (const row of rows) {
        if (!byModel.has(row.model_id)) byModel.set(row.model_id, {
          model_id: row.model_id, receipts: 0, seasons: new Set(), first_issued_at: null,
          last_issued_at: null, with_timestamped_market_context: 0,
        });
        const summary = byModel.get(row.model_id);
        summary.receipts++;
        summary.seasons.add(row.season);
        if (!summary.first_issued_at || row.issued_at < summary.first_issued_at) summary.first_issued_at = row.issued_at;
        if (!summary.last_issued_at || row.issued_at > summary.last_issued_at) summary.last_issued_at = row.issued_at;
        if (row.market_context && row.market_context.captured_at) summary.with_timestamped_market_context++;
      }
      const models = [...byModel.values()].map(summary => ({
        ...summary,
        seasons: [...summary.seasons].sort((a, b) => a - b),
      })).sort((a, b) => a.model_id.localeCompare(b.model_id));
      return toolText({
        status: rows.length ? "prospective-receipts-exist-ungraded" : "empty-by-design",
        prospective_receipts: rows.length,
        model_count: models.length,
        models,
        first_actual_forecast_exists: rows.length > 0,
        graded_forecasts: 0,
        receipt_ledger_is_grading_surface: false,
        grading_surface_available: false,
        leaderboard_available: false,
        as_of: envelope.as_of,
        source: envelope.source,
        built: envelope.built || null,
        integrity: envelope.integrity || null,
        prospective: rows.length > 0,
        graded: false,
        read_only: true,
        stored: false,
        next_unlock: rows.length
          ? "Join immutable forecast receipts to completed canonical outcomes in a separate derived grading surface without mutating the receipt rows."
          : "Publish a canonical scheduled 2026 game, then freeze a model forecast before kickoff against exact schedule, ratings-registry and model-card snapshots.",
        warnings: [
          "A zero-row ledger is evidence that no CFB forecast has yet been frozen prospectively, not evidence of model performance.",
          "Retrodictive 2025 backtests are intentionally excluded from this prospective receipt ledger.",
          "Do not report CFB model grades, calibration, a leaderboard or a track record until prospective receipts and a separate outcome-derived grading surface exist.",
        ],
      });
    },
  },
  {
    name: "dd_find_cfb_team_games",
    title: "CFB team games",
    catalog: "full",
    readOnlyHint: true,
    description: "Query bounded schedule-derived 2025 CFB game results from a team's perspective. scope=team-games returns every covered game for one exact required team, optionally by opponent, week, regular/postseason, result or site. scope=latest-per-team returns one compact latest completed game per FBS team for bounded cross-team discovery, where team is optional and conference and opponent_division apply instead. Observed score and outcome facts only: latest means the last completed game in the dated 2025 surface, not current 2026 form, a forecast or a model grade. No EPA, opponent adjustment or market performance is available. A parameter belonging to the other scope is refused by name rather than ignored.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["team-games", "latest-per-team"], default: "team-games", description: "team-games needs one exact team and returns that team's covered games. latest-per-team returns each FBS team's last completed game and makes team optional." },
        team: { type: "string", minLength: 1, maxLength: 80, description: "Exact canonical team name or slug, case-insensitive. REQUIRED when scope is team-games; optional when scope is latest-per-team." },
        opponent: { type: "string", minLength: 1, maxLength: 80, description: "Optional exact canonical opponent name or slug, case-insensitive. scope=team-games only." },
        week: { type: "integer", minimum: 1, maximum: 20, description: "scope=team-games only." },
        conference: { type: "string", minLength: 1, maxLength: 80, description: "Optional exact FBS conference name, case-insensitive. scope=latest-per-team only." },
        opponent_division: { type: "string", enum: ["all", "fbs", "fcs"], default: "all", description: "scope=latest-per-team only." },
        season_type: { type: "string", enum: ["all", "regular", "postseason"], default: "all" },
        result: { type: "string", enum: ["all", "win", "loss", "tie"], default: "all" },
        site: { type: "string", enum: ["all", "home", "away", "neutral"], default: "all" },
        sort: { type: "string", enum: ["kickoff-asc", "kickoff-desc", "team-asc"], default: "kickoff-asc", description: "kickoff-asc or kickoff-desc under scope=team-games, default kickoff-asc. team-asc or kickoff-desc under scope=latest-per-team, default team-asc. A value belonging to the other scope is refused." },
        offset: { type: "integer", minimum: 0, maximum: 199, default: 0, description: "scope=latest-per-team only." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 25 },
      },
      additionalProperties: false,
    },
    async run(args) {
      return mcpCfbTeamGamesScoped(args);
    },
  },
  {
    name: "dd_find_cfb_team_periods",
    title: "CFB team periods",
    catalog: "full",
    readOnlyHint: true,
    description: "Query bounded schedule-derived 2025 CFB team-period results, with regular and postseason week labels kept distinct. scope=team-periods returns every covered period for one exact required team, optionally by week or season type. scope=latest-per-team returns each team's latest covered period for bounded cross-team discovery, where team is optional and division, conference and period_outcome apply instead. Period and season-to-date record and scoring facts only: latest means the last covered 2025 period, not current 2026 form. FCS records include only games against FBS opponents. No EPA, success rate, explosiveness, havoc, garbage-time, opponent adjustment or market performance is available. A parameter belonging to the other scope is refused by name rather than ignored.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["team-periods", "latest-per-team"], default: "team-periods", description: "team-periods needs one exact team and returns that team's covered periods. latest-per-team returns each team's latest period and makes team optional." },
        team: { type: "string", minLength: 1, maxLength: 80, description: "Exact canonical team name or slug, case-insensitive. REQUIRED when scope is team-periods; optional when scope is latest-per-team." },
        week: { type: "integer", minimum: 1, maximum: 20, description: "scope=team-periods only." },
        division: { type: "string", enum: ["all", "fbs", "fcs"], default: "all", description: "scope=latest-per-team only." },
        conference: { type: "string", minLength: 1, maxLength: 80, description: "Optional exact conference name, case-insensitive. scope=latest-per-team only." },
        season_type: { type: "string", enum: ["all", "regular", "postseason"], default: "all" },
        period_outcome: { type: "string", enum: ["all", "positive", "negative", "even"], default: "all", description: "Filter the latest period by the sign of its observed point differential; a period can contain multiple games. scope=latest-per-team only." },
        sort: { type: "string", enum: ["period-asc", "period-desc", "team-asc", "through-desc", "conference-record-desc"], default: "period-asc", description: "period-asc or period-desc under scope=team-periods, default period-asc. team-asc, through-desc or conference-record-desc under scope=latest-per-team, default team-asc. conference-record-desc orders by observed regular-season conference win percentage, then wins and point differential; it is not an official standing. A value belonging to the other scope is refused." },
        offset: { type: "integer", minimum: 0, maximum: 399, default: 0, description: "scope=latest-per-team only." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 25, description: "scope=team-periods accepts 1 through 25 and defaults to 20; scope=latest-per-team accepts 1 through 50 and defaults to 25. The lower ceiling is a payload bound, not an oversight." },
      },
      additionalProperties: false,
    },
    async run(args) {
      return mcpCfbTeamPeriodsScoped(args);
    },
  },
  {
    name: "dd_find_cfb_games",
    title: "CFB schedule search",
    catalog: "full",
    readOnlyHint: true,
    description: "Query the current dated canonical CFB schedule/results surface by exact game id, exact team, week, regular/postseason, status or conference. Returns bounded schedule and observed-result facts only, with the covered season declared. It includes no model, market, forecast or recommendation.",
    inputSchema: {
      type: "object",
      properties: {
        game_id: { type: "string", minLength: 1, maxLength: 150, description: "Optional exact canonical game id." },
        team: { type: "string", minLength: 1, maxLength: 80, description: "Optional exact canonical team name or slug, case-insensitive." },
        week: { type: "integer", minimum: 1, maximum: 20 },
        season_type: { type: "string", enum: ["all", "regular", "postseason"], default: "all" },
        status: { type: "string", enum: ["all", "scheduled", "final"], default: "all" },
        conference: { type: "string", minLength: 1, maxLength: 80, description: "Optional exact home-or-away conference name, case-insensitive." },
        sort: { type: "string", enum: ["kickoff-asc", "kickoff-desc"], default: "kickoff-desc" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      additionalProperties: false,
    },
    async run(args) {
      const input = mcpCfbGameArgs(args);
      const envelope = await mcpCfbSchedule();
      const allGames = envelope.data.games;
      const team = input.team ? mcpCfbScheduleTeam(allGames, input.team) : null;
      let conference = null;
      if (input.conference) {
        const conferences = [...new Set(allGames.flatMap(game => [game.home_conference, game.away_conference]).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b));
        conference = conferences.find(name => name.toLowerCase() === input.conference.toLowerCase()) || null;
        if (!conference) throw new Error("conference is not present in the dated canonical CFB schedule; available: " + conferences.join(", "));
      }
      if (input.gameId && !allGames.some(game => game.game_id === input.gameId))
        throw new Error("game_id is not present in the dated canonical CFB schedule: " + input.gameId);
      const matches = allGames.filter(game =>
        (!input.gameId || game.game_id === input.gameId) &&
        (!team || game.home_team_slug === team.team_slug || game.away_team_slug === team.team_slug) &&
        (input.week === null || game.week === input.week) &&
        (input.seasonType === "all" || game.season_type === input.seasonType) &&
        (input.status === "all" || game.status === input.status) &&
        (!conference || game.home_conference === conference || game.away_conference === conference)
      ).sort((a, b) => input.sort === "kickoff-asc"
        ? a.kickoff_at.localeCompare(b.kickoff_at) || a.game_id.localeCompare(b.game_id)
        : b.kickoff_at.localeCompare(a.kickoff_at) || a.game_id.localeCompare(b.game_id));
      const games = matches.slice(0, input.limit).map(game => ({
        game_id: game.game_id,
        upstream_game_id: game.upstream_game_id,
        season: game.season,
        week: game.week,
        season_type: game.season_type,
        kickoff_at: game.kickoff_at,
        status: game.status,
        neutral_site: game.neutral_site,
        conference_game: game.conference_game,
        away_team: { name: game.away_team, team_slug: game.away_team_slug, division: game.away_division, conference: game.away_conference },
        home_team: { name: game.home_team, team_slug: game.home_team_slug, division: game.home_division, conference: game.home_conference },
        observed_result: game.status === "final" ? {
          away_points: game.away_points,
          home_points: game.home_points,
          home_margin: game.home_points - game.away_points,
          winner_team_slug: game.home_points === game.away_points ? null
            : game.home_points > game.away_points ? game.home_team_slug : game.away_team_slug,
          tie: game.home_points === game.away_points,
        } : null,
      }));
      return toolText({
        query: {
          game_id: input.gameId,
          team: team ? team.team : null,
          week: input.week,
          season_type: input.seasonType,
          status: input.status,
          conference,
          sort: input.sort,
          limit: input.limit,
        },
        season: envelope.data.season,
        matched_before_limit: matches.length,
        returned: games.length,
        games,
        as_of: envelope.as_of,
        source: envelope.source,
        built: envelope.built || null,
        integrity: envelope.integrity || null,
        actual_canonical_schedule: true,
        completed_schedule: allGames.every(game => game.status === "final"),
        scheduled_games_in_surface: allGames.filter(game => game.status === "scheduled").length,
        prospective_model_output: false,
        forecast: false,
        modelled: false,
        graded: false,
        read_only: true,
        stored: false,
        warnings: [
          allGames.every(game => game.status === "final")
            ? "This surface covers a completed FBS-involved season; it contains no upcoming games."
            : "Scheduled rows are schedule facts only and do not imply a forecast.",
          "Scores and schedule fields are observed facts. No rating, probability, market price, roster context or forecast is included.",
          "Week numbers repeat between regular season and postseason; use season_type when that distinction matters.",
        ],
      });
    },
  },
  {
    name: "dd_find_cfb_historical_market",
    title: "CFB historical prices",
    catalog: "full",
    readOnlyHint: true,
    description: "Query bounded book-identified 2025 CFB prices by exact game id, exact team, week or book. Observation time is unknown: these are historical reference prices, not verified closing lines or prospective inputs, and the tool does not support CLV, an edge or a recommendation.",
    inputSchema: {
      type: "object",
      properties: {
        game_id: { type: "string", minLength: 1, maxLength: 150, description: "Optional exact canonical game id." },
        team: { type: "string", minLength: 1, maxLength: 80, description: "Optional exact team name or slug, case-insensitive." },
        week: { type: "integer", minimum: 1, maximum: 20 },
        book: { type: "string", minLength: 1, maxLength: 80, description: "Optional exact bookmaker name, case-insensitive." },
        priced_only: { type: "boolean", default: false, description: "Require a finite median devigged home win probability." },
        sort: { type: "string", enum: ["kickoff-asc", "kickoff-desc"], default: "kickoff-desc" },
        limit: { type: "integer", minimum: 1, maximum: 25, default: 20 },
      },
      additionalProperties: false,
    },
    async run(args) {
      const input = mcpCfbMarketArgs(args);
      const envelope = await mcpCfbHistoricalMarket();
      const allGames = envelope.data.games;
      const team = input.team ? mcpCfbMarketTeam(allGames, input.team) : null;
      let book = null;
      if (input.book) {
        const books = [...new Set(allGames.flatMap(game => game.books.map(quote => quote.book)))]
          .sort((a, b) => a.localeCompare(b));
        book = books.find(name => name.toLowerCase() === input.book.toLowerCase()) || null;
        if (!book) throw new Error("book is not present in the dated historical CFB market surface; available: " + books.join(", "));
      }
      if (input.gameId && !allGames.some(game => game.game_id === input.gameId))
        throw new Error("game_id is not present in the dated historical CFB market surface: " + input.gameId);
      const matches = allGames.filter(game =>
        (!input.gameId || game.game_id === input.gameId) &&
        (!team || mcpCfbTeamSlug(game.home_team) === team.team_slug || mcpCfbTeamSlug(game.away_team) === team.team_slug) &&
        (input.week === null || game.week === input.week) &&
        (!book || game.books.some(quote => quote.book === book)) &&
        (!input.pricedOnly || Number.isFinite(game.median_devig_home_win_probability))
      ).sort((a, b) => input.sort === "kickoff-asc"
        ? a.kickoff_at.localeCompare(b.kickoff_at) || a.game_id.localeCompare(b.game_id)
        : b.kickoff_at.localeCompare(a.kickoff_at) || a.game_id.localeCompare(b.game_id));
      const games = matches.slice(0, input.limit).map(game => ({
        game_id: game.game_id,
        upstream_game_id: game.upstream_game_id,
        season: game.season,
        week: game.week,
        kickoff_at: game.kickoff_at,
        away_team: game.away_team,
        home_team: game.home_team,
        books: game.books.filter(quote => !book || quote.book === book).map(quote => ({
          book: quote.book,
          spread_home: quote.spread_home,
          source_labelled_open_spread_home: quote.spread_open_home,
          total: quote.total,
          source_labelled_open_total: quote.total_open,
          moneyline_home: quote.moneyline_home,
          moneyline_away: quote.moneyline_away,
          devig_home_win_probability: quote.devig_home_win_probability,
          hold: quote.hold,
        })),
        median_spread_home: game.median_spread_home,
        median_total: game.median_total,
        median_devig_home_win_probability: game.median_devig_home_win_probability,
        books_quoting_all: game.books_quoting,
      }));
      return toolText({
        query: {
          game_id: input.gameId,
          team: team ? team.team : null,
          week: input.week,
          book,
          priced_only: input.pricedOnly,
          sort: input.sort,
          limit: input.limit,
        },
        season: envelope.data.season,
        matched_before_limit: matches.length,
        returned: games.length,
        games,
        rejected_quote_count: Array.isArray(envelope.data.rejected_quotes) ? envelope.data.rejected_quotes.length : null,
        as_of: envelope.as_of,
        source: envelope.source,
        built: envelope.built || null,
        integrity: envelope.integrity || null,
        provenance: envelope.provenance,
        observation_timestamp_available: false,
        price_timing: "unknown",
        verified_closing_lines: false,
        clv_supported: false,
        prospective_input_eligible: false,
        current_market: false,
        modelled: false,
        graded: false,
        read_only: true,
        stored: false,
        warnings: [
          "The upstream date_time field is kickoff, not price capture time; no quote has a verified observation timestamp.",
          "The source-labelled open fields are retained as upstream labels, not as a verified line history or timing claim.",
          "Never call these closing lines, compute CLV from them, cite them in a prospective forecast receipt or treat them as a current betting market.",
          "Prices are historical reference observations only and do not establish an edge or recommendation.",
        ],
      });
    },
  },
  {
    name: "dd_get_cfb_model_card",
    title: "CFB model card",
    catalog: "full",
    readOnlyHint: true,
    description: "List available generated CFB model cards or return one exact model card with purpose, target, features, parameters, validation, performance, calibration, limitations, failure modes, receipts and provenance. Model-card status is governance, not proof of a current forecast, prospective track record, consensus or recommendation.",
    inputSchema: {
      type: "object",
      properties: {
        model_id: { type: "string", minLength: 1, maxLength: 80, description: "Optional exact model slug. Omit to list compact card summaries." },
      },
      additionalProperties: false,
    },
    async run(args) {
      const input = mcpCfbModelCardArgs(args);
      const envelope = await mcpCfbModelCards();
      const cards = envelope.data.cards;
      const summaries = cards.map(card => ({
        model_id: card.model_id,
        model_name: card.model_name,
        model_version: card.model_version,
        roadmap_idea: card.roadmap_idea || null,
        roadmap_step: card.roadmap_step || null,
        lifecycle_status: card.lifecycle_status || null,
        retirement_status: card.retirement_status || null,
        purpose: card.purpose,
        target: card.target,
        validation_kind: card.validation_design.kind,
        prospective_receipts_exist: card.receipts.prospective_receipts_exist,
        methodology_url: card.methodology_url || null,
      })).sort((a, b) => a.model_id.localeCompare(b.model_id));
      let card = null;
      if (input.modelId) {
        card = cards.find(row => row.model_id === input.modelId) || null;
        if (!card) throw new Error("model_id is not present in the dated CFB model-card registry; available: " + summaries.map(row => row.model_id).join(", "));
      }
      const selected = card ? [card] : cards;
      const anyProspective = selected.some(row => row.receipts.prospective_receipts_exist === true);
      const allProspectiveValidation = selected.every(row => row.validation_design.kind === "prospective");
      return toolText({
        mode: card ? "model-card" : "model-card-index",
        query: { model_id: input.modelId },
        available_models: summaries,
        card,
        as_of: envelope.as_of,
        source: envelope.source,
        built: envelope.built || null,
        integrity: envelope.integrity || null,
        cards_are_generated_from_model_output: true,
        prospective_receipts_exist: anyProspective,
        prospective_validation: allProspectiveValidation,
        graded: false,
        consensus: false,
        current_forecast: false,
        read_only: true,
        stored: false,
        warnings: [
          "A lifecycle value documents roadmap state; it does not prove forecast skill or a live prospective track record.",
          "Retrodictive performance and calibration are evaluation evidence, not current-season forecasts or betting recommendations.",
          "Read each card's known_limitations, failure_modes and receipts fields before interpreting its performance.",
          "The current registry is not a consensus and no model card appears on a CFB leaderboard without prospective receipts and separate grading.",
        ],
      });
    },
  },
  {
    name: "dd_model_scoreboard",
    title: "NFL model scoreboard",
    catalog: "full",
    readOnlyHint: true,
    description: "Query the dated prospective nfelo and 538 Classic receipt ledger by season, week, team, game or model. Returns receipt provenance plus descriptive mean/range/standard deviation; it is ungraded and is not a validated consensus, ensemble or leaderboard.",
    inputSchema: {
      type: "object",
      properties: {
        season: { type: "integer", minimum: 2000, maximum: 2100, description: "Season. Defaults to the latest season in the ledger." },
        week: { type: "integer", minimum: 1, maximum: 22, description: "NFL week. With no filters at all, the tool defaults to Week 1; otherwise omission searches the selected season." },
        team: { type: "string", minLength: 2, maxLength: 5, description: "Exact home or away team abbreviation, case-insensitive." },
        game_id: { type: "string", maxLength: 80, description: "Exact canonical season_week_away_home id, for example 2026_01_CLE_PIT." },
        model_ids: { type: "array", minItems: 1, maxItems: 10, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 40 }, description: "Optional stable model slugs, currently nfelo and 538-classic." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 25 },
        sort: { type: "string", enum: ["disagreement", "kickoff"], default: "disagreement" },
      },
      additionalProperties: false,
    },
    async run(args) {
      const input = mcpModelScoreboardArgs(args);
      const envelope = await mcpModelReceipts();
      const out = mcpModelScoreboardRows(envelope, input);
      return toolText({
        as_of: envelope.as_of, source: envelope.source, built: envelope.built || null,
        ledger_integrity: envelope.integrity || null,
        filters: {
          season: out.season, week: out.week, team: input.team || null,
          game_id: input.game_id || null, model_ids: out.requestedModels,
          sort: input.sort, limit: input.limit,
        },
        matched_games: out.matched, returned_games: out.games.length,
        available_model_ids: out.availableModelIds,
        games: out.games,
        read_only: true, stored: false, graded: false,
        comparison_type: "equal-weight descriptive statistics only",
        note: out.matched ? undefined : "No prospective receipt games matched these filters.",
        warnings: [
          "No outcomes are joined to this ledger, so nothing in this response is graded and no model is ranked.",
          "The equal-weight mean and disagreement statistics are descriptive only, not a validated consensus, ensemble, confidence score or predictive edge.",
          "Two model columns are not independent confirmation of one another.",
          "No market probability is included: legacy values without a named book and observation timestamp are deliberately not normalized.",
        ],
      });
    },
  },
  {
    name: "dd_scores",
    title: "Live scores",
    catalog: "core",
    readOnlyHint: true,
    description: "NFL/CFB schedule and scores from the Worker's scheduled nflverse/cfbfastR cache (sport + optional YYYYMMDD dates). Other sports fail until an adapter exists.",
    inputSchema: {
      type: "object",
      properties: {
        sport: { type: "string", enum: ["nfl", "cfb", "nba", "cbb", "mlb", "nhl"], description: "Sport key" },
        dates: { type: "string", description: "YYYYMMDD or YYYYMMDD-YYYYMMDD (optional)" },
      },
      required: ["sport"],
      additionalProperties: false,
    },
    async run(args, env) {
      if (!LEAGUE[args.sport]) return toolErr("unknown sport");
      // ⚠️ handleScores takes sport and dates via searchParams — not season/week.
      const u = new URL("https://mcp.internal/scores");
      u.searchParams.set("sport", args.sport);
      if (args.dates) u.searchParams.set("dates", args.dates);
      const resp = await handleScores(u, env, {});
      const data = await resp.json();
      if (!resp.ok) return toolErr("Scores unavailable from this Worker's schedule cache (" + (data.detail || data.error || resp.status) + ").");
      return toolText(data);
    },
  },
  {
    name: "dd_dfs_correlations",
    title: "DFS correlations",
    catalog: "full",
    readOnlyHint: true,
    description: "The site's within-game DFS correlation structure (same-team and opponent role×role matrices plus CV-by-projection tables), estimated from public nflverse data, 2019-2025 regular seasons. League-average structure — not this specific game.",
    inputSchema: MCP_NO_ARGS,
    async run() {
      if (!mcpCorrCache.data || Date.now() - mcpCorrCache.at > 3600e3) {
        const r = await fetch(`${SITE}/dfs.html`, { cf: { cacheTtlByStatus: { "200-299": 3600, "404": 1, "500-599": 0 }, cacheEverything: true } });
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
    title: "DFS lineup solver",
    catalog: "full",
    readOnlyHint: true,
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
    title: "Last Dawg Standing odds",
    catalog: "core",
    readOnlyHint: true,
    description: "Modeled weekly survival odds for every team in a Sleeper guillotine league, plus the projected chop line. Built ONLY from completed weeks; it does not ingest live in-game scores. ⚠️ Needs at least two completed weeks; with fewer it returns the roster and says so rather than inventing a probability.",
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
        const r = await fetch(API + path, { cf: { cacheTtlByStatus: { "200-299": 300, "404": 1, "500-599": 0 }, cacheEverything: true } });
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
    title: "Site map",
    catalog: "core",
    readOnlyHint: true,
    description: "What Data Dawgs publishes, where the machine-readable surfaces live, and — explicitly — what is NOT served here and why.",
    inputSchema: MCP_NO_ARGS,
    async run() {
      return toolText({
        site: SITE,
        machine: {
          index: "/llms.txt",
          surfaces: "/data/surfaces.json — every human page, its machine equivalent, and an honest live|planned|none status. Check it before claiming a route exists.",
          data: ["/data/pool.json", "/data/receipts.json", "/data/models.json", "/data/epa-teams.json", "/data/nfelo.json", "/data/league.json", "/data/bozo-rules.json", "/data/survivor.json", "/data/pound-tools.json", "/data/model-contracts.json", "/data/upstream-models.json", "/data/nfl-schedule.json", "/data/538-classic.json", "/data/model-receipts.json", "/data/cfb-schedule.json", "/data/cfb-games-latest.json", "/data/cfb-team-game.json", "/data/cfb-team-week.json", "/data/cfb-team-week-latest.json", "/data/cfb-teams.json", "/data/cfb-record-divergence.json", "/data/cfb-record-divergence-validation.json", "/data/cfb-market.json", "/data/cfb-elo.json", "/data/cfb-ratings.json", "/data/cfb-model-cards.json", "/data/cfb-model-receipts.json", "/data/cfb-disagreement.json", "/data/datadawg-dollars-values.json", "/data/datadawg-dollars-method.json", "/data/datadawg-dollars-method.md", "/data/index.json"],
        },
        pages: {
          "index.html": "Home — what Data Dawgs is and the working-dawg taxonomy (Pup / Dawgs / The DawgHouse).",
          "bigboard.html": "Draft big board over the MV pool.",
          "fantasy-warroom.html": "Fantasy War Room — a connected Sleeper, public Yahoo or ESPN league with every roster priced in DataDawg$ against THAT league's own replacement level. The rows are one account's league and have no public JSON; dd_war_room reads the caller's own Yahoo or ESPN connection. A Sleeper league is read in the browser and is not stored here.",
          "datadawg-dollars.html": "DataDawg$ — our own converted auction dollars for one league room: Target $, conversion-sensitivity bands, ETR delta. Not MV; MV is the market snapshot this converts.",
          "auction.html": "Auction draft operator (league passphrase gate).",
          "board.html": "Live draft board — mirrors the auction via Firebase.",
          "strategy.html": "Draft strategy digest (dated).",
          "stats.html": "NFL EPA stats explorer.",
          "dataviz.html": "Data visualisations.",
          "bozo.html": "The Bozo weekly parlay game; signed-in members search for a league under Your Dawgs and enter its shared password.",
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
  /* ------------------------------- SwoleDawg ------------------------------- */
  // ⚠️ THESE WRITE. Every one of them is gated on caller.kind === "user": the shared
  // league connector cannot tell one caller from another, and a write with no identity is
  // unattributable — it would land in whoever's log the server guessed. Same gate, same
  // reasoning, as dd_submit_bozo_leg.
  //
  // Set logging is deliberately SINGLE-phase, unlike the Bozo submission. A misparsed leg
  // is money on a shared board with no undo; a misparsed set is private and corrected by
  // saying "that was 11 not 10", which UPSERTs the same row. The human is between sets
  // holding dumbbells. Two-phase belongs on sd_update_program, which rewrites the plan.
  {
    name: "sd_whoami",
    title: "SwoleDawg — who am I, and what is today",
    catalog: "core",
    readOnlyHint: true,
    description: "Whose training log this connection can write to, the current block and derived week, and today's prescribed day. Call this before logging anything if you are unsure who is asking.",
    inputSchema: MCP_NO_ARGS,
    async run(args, env, caller) {
      if (!caller || caller.kind !== "user")
        return toolText({ athlete: null, anonymous: true, can_write: false,
          note: "The shared league connector cannot tell who is asking, so it can neither read nor write a personal training log. Mint a personal URL at " + SITE + "/connect.html." });
      const uid = caller.uid || caller.name;
      const prog = await swoleGetProgram(env, uid);
      if (!prog) return toolText({ athlete: caller.name, can_write: true, program: null,
        note: "No program seeded for this account yet. Seed program.json before logging." });
      const today = new Date().toISOString().slice(0, 10);
      const week = swoleWeekOf(prog.doc, today);
      const effort = swoleEffortFor(prog.doc, week);
      const dayKey = swoleDayKeyFor(today);
      const day = swoleDayOf(prog.doc, dayKey);
      return toolText({
        athlete: caller.name, can_write: true,
        block: prog.doc.block || 1, week, date: today, day: dayKey,
        session: day ? day.name : null,
        reps_in_reserve: effort ? effort.reps_in_reserve : null,
        sets_override: effort ? (effort.sets_override || null) : null,
        note: effort && effort.sets_override
          ? "Week " + week + " overrides the tables to " + effort.sets_override + " working sets per exercise."
          : null,
      });
    },
  },
  {
    name: "sd_get_program",
    title: "SwoleDawg — the program",
    catalog: "core",
    readOnlyHint: true,
    description: "The athlete's current training program, or one day of it, with rest values, rep ranges and effective RIR. Sets shown already have the current week's sets_override applied — do not re-apply it.",
    inputSchema: { type: "object", properties: { day: { type: "string", description: "monday|tuesday|… (omit for the whole program)" } }, additionalProperties: false },
    async run(args, env, caller) {
      if (!caller || caller.kind !== "user") return toolErr(SWOLE_NEEDS_USER);
      const uid = caller.uid || caller.name;
      const prog = await swoleGetProgram(env, uid);
      if (!prog) return toolErr("No program seeded for this account yet.");
      const today = new Date().toISOString().slice(0, 10);
      const week = swoleWeekOf(prog.doc, today);
      const effort = swoleEffortFor(prog.doc, week);
      const rirFor = e => effort && effort.reps_in_reserve != null
        ? effort.reps_in_reserve : (e.rir == null ? null : e.rir);
      const shape = d => ({
        day: d.day, name: d.name,
        exercises: (d.exercises || []).map(e => ({
          id: e.id, name: e.name, sets: swoleSetsFor(e, effort),
          reps: e.rep_min + "-" + e.rep_max,
          reps_in_reserve: rirFor(e),
          start_weight_lb_per_hand: e.start_weight_lb_per_hand,
          rest_between_sets_s: e.rest_between_sets, rest_after_exercise_s: e.rest_after_exercise,
          cue: e.cue || null,
        })),
      });
      if (args.day) {
        const d = swoleDayOf(prog.doc, String(args.day).toLowerCase());
        if (!d) return toolErr("No day '" + args.day + "' in the program.");
        return toolText({ week, reps_in_reserve: effort ? effort.reps_in_reserve : null, ...shape(d) });
      }
      return toolText({ block: prog.doc.block || 1, week,
        reps_in_reserve: effort ? effort.reps_in_reserve : null,
        rules: prog.doc.rules || null, progression: prog.doc.progression || null,
        days: (prog.doc.days || []).map(shape) });
    },
  },
  {
    name: "sd_start_session",
    title: "SwoleDawg — start a session",
    catalog: "core",
    readOnlyHint: false,
    description: "Open a training session. The day is inferred from the date's weekday unless you name one. Idempotent: starting a session that already exists returns it rather than creating a second. sd_log_set opens the session on its own, so you rarely need this first.",
    inputSchema: { type: "object", properties: {
      date: { type: "string", description: "YYYY-MM-DD (default: today)" },
      day_key: { type: "string", description: "monday|tuesday|… — override the weekday inference" },
    }, additionalProperties: false },
    async run(args, env, caller) {
      if (!caller || caller.kind !== "user") return toolErr(SWOLE_NEEDS_USER);
      const uid = caller.uid || caller.name;
      const r = await swoleStartSession(env, uid, args.date || new Date().toISOString().slice(0, 10), args.day_key, "mcp");
      return r.error ? toolErr(r.error) : toolText(r);
    },
  },
  {
    name: "sd_log_set",
    title: "SwoleDawg — log a set",
    catalog: "core",
    readOnlyHint: false,
    destructiveHint: true,
    description:
      "Log ONE working set and get back what is left in the exercise plus the rest time. Writes immediately — do not ask the user to confirm first; they are between sets. " +
      "Omit set_number and it takes the next one. Re-logging an existing set_number OVERWRITES it, which is how a correction works: 'that was 11 not 10' is an edit, not a new set. " +
      "The exercise is matched against the day's program by id, then exact name, then substring; an ambiguous or absent match is REFUSED with the day's candidates rather than guessed, because a wrong match corrupts two lifts' histories at once. " +
      "If the response sets below_rep_range, tell the user and ask whether the set was cut short by failure or by the week's RIR cap before touching the load — those imply opposite actions.",
    inputSchema: { type: "object", properties: {
      exercise: { type: "string", description: "Exercise id ('mon_1') or name ('flat bench')" },
      weight_lb: { type: "number", description: "Per hand for dumbbell work, matching the program's start_weight_lb_per_hand" },
      reps: { type: "number" },
      set_number: { type: "number", description: "Omit to append the next set; supply to correct an existing one" },
      rir: { type: "number", description: "Reps in reserve, if the user said" },
      rest_taken_s: { type: "number", description: "Actual rest before this set. Stored separately from prescribed — a stalled lift is usually collapsed rest." },
      date: { type: "string", description: "YYYY-MM-DD (default: today)" },
      day_key: { type: "string" },
    }, required: ["exercise", "weight_lb", "reps"], additionalProperties: false },
    async run(args, env, caller) {
      if (!caller || caller.kind !== "user") return toolErr(SWOLE_NEEDS_USER);
      const uid = caller.uid || caller.name;
      const a = { ...args, date: args.date || new Date().toISOString().slice(0, 10) };
      const r = await swoleLogSet(env, uid, a, "mcp");
      return r.error ? toolText({ status: "rejected", ...r }) : toolText(r);
    },
  },
  {
    name: "sd_log_sets",
    title: "SwoleDawg — log several sets",
    catalog: "core",
    readOnlyHint: false,
    destructiveHint: true,
    description: "Bulk version of sd_log_set, for 'I did 12, 11 and 10 at thirty'. Each entry takes the same fields. Entries are applied in order and each is reported separately, so a rejection in the middle does not hide the ones that landed.",
    inputSchema: { type: "object", properties: {
      sets: { type: "array", description: "Each: {exercise, weight_lb, reps, set_number?, rir?, rest_taken_s?}",
        items: { type: "object", properties: {
          exercise: { type: "string" }, weight_lb: { type: "number" }, reps: { type: "number" },
          set_number: { type: "number" }, rir: { type: "number" }, rest_taken_s: { type: "number" },
        }, required: ["exercise", "weight_lb", "reps"], additionalProperties: false } },
      date: { type: "string" }, day_key: { type: "string" },
    }, required: ["sets"], additionalProperties: false },
    async run(args, env, caller) {
      if (!caller || caller.kind !== "user") return toolErr(SWOLE_NEEDS_USER);
      const uid = caller.uid || caller.name;
      const date = args.date || new Date().toISOString().slice(0, 10);
      const out = [];
      for (const s of args.sets || []) {
        const r = await swoleLogSet(env, uid, { ...s, date, day_key: args.day_key }, "mcp");
        out.push(r.error ? { status: "rejected", input: s, ...r } : r);
      }
      return toolText({ date, results: out,
        logged: out.filter(r => r.ok).length, rejected: out.filter(r => !r.ok).length });
    },
  },
  {
    name: "sd_finish_session",
    title: "SwoleDawg — finish the session",
    catalog: "core",
    readOnlyHint: false,
    description: "Close the day's session and return its summary: sets, exercises touched and total volume.",
    inputSchema: { type: "object", properties: {
      date: { type: "string", description: "YYYY-MM-DD (default: today)" },
      notes: { type: "string" },
    }, additionalProperties: false },
    async run(args, env, caller) {
      if (!caller || caller.kind !== "user") return toolErr(SWOLE_NEEDS_USER);
      const r = await swoleFinishSession(env, caller.uid || caller.name, args.date || new Date().toISOString().slice(0, 10), args.notes);
      return r.error ? toolErr(r.error) : toolText(r);
    },
  },
  {
    name: "sd_session",
    title: "SwoleDawg — read one session",
    catalog: "core",
    readOnlyHint: true,
    description: "Every set recorded on one date, with the source each row arrived from.",
    inputSchema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" } }, required: ["date"], additionalProperties: false },
    async run(args, env, caller) {
      if (!caller || caller.kind !== "user") return toolErr(SWOLE_NEEDS_USER);
      const r = await swoleSession(env, caller.uid || caller.name, args.date);
      return r.error ? toolErr(r.error) : toolText(r);
    },
  },
  {
    name: "sd_recent_sessions",
    title: "SwoleDawg — recent sessions",
    catalog: "core",
    readOnlyHint: true,
    description: "The last N sessions with set counts and volume. Use it to answer 'how many did I train last week' without pulling every set.",
    inputSchema: { type: "object", properties: { n: { type: "number", description: "Default 10, max 50" } }, additionalProperties: false },
    async run(args, env, caller) {
      if (!caller || caller.kind !== "user") return toolErr(SWOLE_NEEDS_USER);
      return toolText(await swoleRecentSessions(env, caller.uid || caller.name, args.n));
    },
  },
  {
    name: "sd_log_measurement",
    title: "SwoleDawg — log a measurement",
    catalog: "full",
    readOnlyHint: false,
    destructiveHint: true,
    description:
      "Record one tape or scale reading. One value per field per day; a re-read on the same date overwrites it. " +
      "Pass reads:[…] when the protocol's replication rule was used (two within 0.125\" averaged, or the median of three) — the raw reads are stored beside the value so an averaged number stays auditable. " +
      "⚠️ NEVER invent a value for a field the user did not measure. Pass null, or leave it out. A null reads as a gap; a guess reads as data and corrupts every trend built on it.",
    inputSchema: { type: "object", properties: {
      field: { type: "string", description: "e.g. waist_navel_in, ankle_l_in" },
      value: { type: ["number", "null"], description: "null records an explicit gap" },
      reads: { type: "array", items: { type: "number" }, description: "Raw reads before averaging" },
      date: { type: "string", description: "YYYY-MM-DD (default: today)" },
      note: { type: "string" },
    }, required: ["field"], additionalProperties: false },
    async run(args, env, caller) {
      if (!caller || caller.kind !== "user") return toolErr(SWOLE_NEEDS_USER);
      const r = await swoleLogMeasurement(env, caller.uid || caller.name, args, "mcp");
      return r.error ? toolErr(r.error) : toolText(r);
    },
  },
  {
    name: "sd_measurement_history",
    title: "SwoleDawg — measurement history",
    catalog: "full",
    readOnlyHint: true,
    description: "Every recorded reading for one field, newest first, with the raw reads where they were kept.",
    inputSchema: { type: "object", properties: {
      field: { type: "string" }, n: { type: "number", description: "Default 20, max 200" },
    }, required: ["field"], additionalProperties: false },
    async run(args, env, caller) {
      if (!caller || caller.kind !== "user") return toolErr(SWOLE_NEEDS_USER);
      return toolText(await swoleMeasurementHistory(env, caller.uid || caller.name, args.field, args.n));
    },
  },
  {
    name: "sd_nutrition",
    title: "SwoleDawg — read nutrition back",
    catalog: "full",
    readOnlyHint: true,
    description: "Logged calories and protein: one day with `date`, or the recent run without it. Means are computed only over the days that carry a number, and the count is returned beside them — a mean over 3 logged days out of 14 is not a 14-day average.",
    inputSchema: { type: "object", properties: {
      date: { type: "string", description: "YYYY-MM-DD for one day; omit for the recent run" },
      n: { type: "number", description: "Days to return when no date is given. Default 14, max 200" },
    }, additionalProperties: false },
    async run(args, env, caller) {
      if (!caller || caller.kind !== "user") return toolErr(SWOLE_NEEDS_USER);
      const r = await swoleNutrition(env, caller.uid || caller.name, args);
      return r.error ? toolErr(r.error) : toolText(r);
    },
  },
  {
    name: "sd_log_nutrition",
    title: "SwoleDawg — log nutrition",
    catalog: "full",
    readOnlyHint: false,
    description: "Record a day's calories and protein. Needs actual numbers: \"hit target\" is not one, and this refuses rather than storing the program's target as though it were an observation.",
    inputSchema: { type: "object", properties: {
      date: { type: "string" }, kcal: { type: "number" }, protein_g: { type: "number" }, note: { type: "string" },
    }, additionalProperties: false },
    async run(args, env, caller) {
      if (!caller || caller.kind !== "user") return toolErr(SWOLE_NEEDS_USER);
      const r = await swoleLogNutrition(env, caller.uid || caller.name, args, "mcp");
      return r.error ? toolErr(r.error) : toolText(r);
    },
  },

];
/* ===== DD-MCP-BLOCK END ===== */
