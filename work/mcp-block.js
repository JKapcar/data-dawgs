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
          "The close is DraftKings' price obtained through a licensed aggregator; the entry is self-reported by the player. Any CLV figure mixes a checked number with an unchecked one.",
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
          price: x.price, priceSource: x.priceSource || "self",
          priceOpp: x.entryPriceOpp ?? null, entryBook: x.entryBook || null,
          label: x.label, prop: x.prop || null, ts: x.ts || null,
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
          // number a human typed. State CLV for a leg that has one; say it is
          // unmeasured for a leg that does not; never average across the two.
          "CLV is computable only where closeObservedAt is set AND both priceOpp and closeOpp are present — de-vig proportionally, and report probability points, not cents.",
          "A leg with closeUnavailableReason has NO CLV. Do not substitute the entry price for a missing close: that fabricates a zero and drags any average toward it.",
          "Entry prices are still self-reported (priceSource: self). The close is DraftKings' price via a licensed aggregator (closeBook: draftkings, closeSource: sgo) — so a CLV figure mixes a checked number with an unchecked one, and should be quoted that way.",
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
      "Check a proposed Bozo leg against the LIVE board and return the exact body /bozo/pick wants, " +
      "or the reason it would be rejected. ⚠️ READ-ONLY: this submits nothing, writes nothing and " +
      "changes nothing. The member still submits it themselves on bozo.html — that is deliberate, not a " +
      "limitation to work around. Runs the server's own validator, so a pass here is a pass there.",
    inputSchema: {
      type: "object",
      properties: {
        sport: { type: "string", description: "nfl | cfb | nba | cbb | mlb | nhl" },
        eventId: { type: "string", description: "The game's id, from dd_scores" },
        game: { type: "string", description: "Human-readable matchup, e.g. \"BUF @ MIA\"" },
        mkt: { type: "string", description: "spread | ml | total | prop | other" },
        side: { type: "string", description: "Team abbreviation, or over / under" },
        line: { type: "number", description: "The number. Required for everything except ml." },
        price: { type: "number", description: "American odds, e.g. -180. Favourites only; the band is league-set." },
        label: { type: "string", description: "How the leg reads on the ticket, e.g. \"BUF -6.5\"" },
        prop: { type: "string", description: "Required when mkt is \"other\": what the bet actually is" },
        league: { type: "string", description: "League id (default: main)" },
      },
      required: ["sport", "eventId", "game", "mkt", "side", "price", "label"],
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

      // The proposal, shaped the way /bozo/pick reads it.
      const p = {
        sport: String(args.sport || "").toLowerCase(),
        eventId: String(args.eventId || ""),
        game: String(args.game || "").slice(0, 80),
        mkt: String(args.mkt || "").toLowerCase(),
        side: String(args.side || "").slice(0, 40),
        line: args.mkt === "ml" ? 0 : Number(args.line),
        price: Math.round(Number(args.price)),
        label: String(args.label || "").slice(0, 90),
        prop: args.prop ? String(args.prop).slice(0, 80) : null,
      };

      // ⚠️ THE SERVER'S OWN VALIDATOR, not a copy of its rules. A second copy would drift
      // and start passing legs /bozo/pick rejects, which is worse than no check at all.
      const band = bandOf(lg);
      const err = validatePick(p, name, picks, band, set.format);
      if (err)
        return toolText({
          accepted: false, reason: "rejected-by-the-same-validator-the-server-runs",
          detail: err, band,
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
          how: "POST " + SITE.replace("https://datadawgs216.com", "https://toto.jkapcar4.workers.dev") +
               "/bozo/pick — or just press submit on " + SITE + "/bozo.html, which is the intended path.",
          body: { league: lid, pick: p },
        },
        willBeStoredAs: {
          ...p,
          dir: (p.side === "over" || p.side === "under") ? p.side : "over",
          priceSource: "self",
          ts: "set by the server when you actually submit, not now",
        },
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
          "The price is whatever you typed. Nothing here checks it against a book, and it is recorded as self-reported.",
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
        price: { type: "number", description: "American odds, e.g. -180. Favourites only; the band is league-set." },
        label: { type: "string", description: "How the leg reads on the ticket, e.g. \"BUF -6.5\"" },
        prop: { type: "string", description: "Required when mkt is \"other\": what the bet actually is" },
        priceOpp: { type: "number", description: "American odds of the OPPOSITE side, for de-vig. Optional but strongly encouraged — without it the leg has no CLV baseline." },
        startsAt: { type: "string", description: "Kickoff ISO timestamp from dd_scores. Optional but strongly encouraged — without it the closing line is never captured." },
        league: { type: "string", description: "League id (default: main)" },
        confirm: { type: "string", description: "PHASE TWO ONLY: the confirm_code returned by phase one, after the human approved the echo. Sends the bet." },
      },
      required: [],
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
        if ((lg.status || "open") !== "open")
          return toolText({ status: "board-locked", detail: "The ticket is placed and the board is locked — nothing can be added or changed for week " + (lg.week || 1) + "." });
        const set = settingsOf(lg);
        const picks = lg.picks || {};
        // One resolution, reused by every check below and by the write itself, so an
        // MCP leg can never land under a different key than the site form would use.
        const mkey = memberKeyOf(lg, caller);
        if (!mkey)
          return toolText({ status: "not-a-member", detail: "You are not in this league." });
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
          leg: { label: pend.p.label, price: pend.p.price, game: pend.p.game },
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

      // Shaped exactly the way /bozo/pick reads it, priceOpp and startsAt included —
      // this object is what gets frozen into the pending record and later committed.
      const p = {
        sport: String(args.sport || "").toLowerCase(),
        eventId: String(args.eventId || ""),
        game: String(args.game || "").slice(0, 80),
        mkt: String(args.mkt || "").toLowerCase(),
        side: String(args.side || "").slice(0, 40),
        line: args.mkt === "ml" ? 0 : Number(args.line),
        price: Math.round(Number(args.price)),
        label: String(args.label || "").slice(0, 90),
        prop: args.prop ? String(args.prop).slice(0, 80) : null,
        priceOpp: args.priceOpp,
        startsAt: typeof args.startsAt === "string" ? args.startsAt : null,
      };
      // ⚠️ The server's own validator, same as the site form and dd_draft_bozo_leg.
      const band = bandOf(lg);
      const err = validatePick(p, name, picks, band, set.format);
      if (err)
        return toolText({ status: "rejected", detail: err, band, note: "That is the literal string the server would reject with. Fix it and propose again." });

      const size = set.format === "royale" ? royaleRoster(lg).length : memberNames(lg).length;
      const need = set.lockRule === "count" ? Math.min(set.lockCount || size, size || set.lockCount) : size;
      const already = Object.keys(picks).length;
      const wouldLock = need > 0 && (mine ? already : already + 1) >= need;

      // The echo IS the safety mechanism (spec §4.1): the human reads the parsed bet in
      // plain English before anything can happen. Consequences ride in the same sentence.
      const echo =
        p.label + " — " + p.game + ", " + (p.mkt === "ml" ? "moneyline" : p.mkt + " " + p.line) +
        " at " + p.price + ", for " + name + ", week " + (lg.week || 1) + " in league " + lid + "." +
        (mine ? " ⚠️ This REPLACES your current leg (" + mine.label + " at " + mine.price + ") and resets your submission clock — that moves you in the Last In lever." : "") +
        (wouldLock ? " ⚠️ THIS IS THE LAST LEG: confirming places the ticket, locks the board for all " + size + " and draws the lever hierarchy. No undo." : "");

      const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
      const rnd = new Uint32Array(6);
      crypto.getRandomValues(rnd);
      let code = "";
      for (const r of rnd) code += alphabet[r % alphabet.length];

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
        missing: [
          ...(p.priceOpp == null ? ["priceOpp — without the opposite side's price this leg has no de-vig baseline and no CLV"] : []),
          ...(p.startsAt ? [] : ["startsAt — without kickoff time the closing line is never captured for this leg"]),
        ],
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
      "an unmatched player has no DataDawg$, which is a gap in the join and never a valuation of zero.",
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["yahoo", "espn"],
          description: "Which connection to read. Omit it and the tool resolves the one that exists, or names both and refuses to guess when the caller has connected two.",
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

      return toolText({
        provider,
        leagueId: cred.leagueId,
        you: cred.teamId != null ? String(cred.teamId) : null,
        ...feed.body,
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
