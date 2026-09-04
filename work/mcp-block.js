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
    throw new Error("direction must be all, record-ahead-of-scoring, scoring-ahead-of-recordnteger(args, "count", "count", 1, MCP_DFS_MAX_LINEUPS, 1);
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
          systemIds.has(system.system_id) || typ