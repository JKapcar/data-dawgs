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
        serverInfo: { name: "data-dawgs", version: "1.3.0" },
        instructions:
          (caller && caller.kind === "user"
            ? "You are connected as " + caller.name + ". When a tool marks a row `you: true`, that is them.\n"
            : "⚠️ This is the SHARED league connector — you do NOT know which member you are talking to. " +
              "Never assume whose team, leg or ledger is whose; ask. A personal URL from " + SITE + "/connect.html fixes this.\n") +
          "Everything here is read-only and is either the league's own data, public play-by-play, " +
          "or a deterministic calculation over caller-supplied inputs. Calculator inputs and results are not stored. " +
          "There is no DFS projection or ownership data on this server. When quoting bozo odds, survivor odds " +
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
        note: "One-game calculator only. Data Dawgs does not supply current 2026 538 team states or a prospectively graded 538 forecast ledger.",
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
          data: ["/data/pool.json", "/data/receipts.json", "/data/models.json", "/data/epa-teams.json", "/data/nfelo.json", "/data/league.json", "/data/bozo-rules.json", "/data/survivor.json", "/data/pound-tools.json", "/data/model-contracts.json", "/data/upstream-models.json", "/data/index.json"],
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
          "dfs.html": "DFS lineup lab (runs entirely in the browser).",
          "pound.html": "The Pound model workbench, deterministic calculators, contracts and honest tool-status inventory.",
        },
        notServedHere: {
          dfs_projections_and_ownership: "Never served, by design. The DFS slate lives only in each user's own browser localStorage; there is no server copy, and building an upload path is exactly the invariant the DFS roadmap forbids.",
          epa_stats: "The 2.1MB dataset is embedded in stats.html; parsing it per call is a poor fit for a Worker. Browse the page directly.",
        },
      });
    },
  },
];
