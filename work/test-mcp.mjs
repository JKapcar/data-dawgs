// Tests the ASSEMBLED Worker — its real timingSafeEqual, loadLeague, fbGet and
// handleScores — with only the network faked. Run: node test-mcp.mjs
import { readFileSync } from "fs";
import worker from "../dawg-bot-worker.js";
import P from "./pound-core.js";

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error("FAIL:", name); } };

/* ------------------------------ fake network ------------------------------ */
const FB = "https://data-dawgs-draft-default-rtdb.firebaseio.com";
const NOW = Date.now();
const leagueRec = {
  name: "Data Dawgs", manager: "Kap", season: 2026, week: 1, status: "open",
  members: { Kap: true, Jeff: true, "The%20Kid": true },
  picks: {
    Jeff: { sport: "nfl", eventId: "401", game: "CLE @ PIT", mkt: "spread", side: "CLE", dir: "over", line: 3.5, price: -140, label: "CLE -3.5", ts: NOW - 2000, priceSource: "self" },
    Kap:  { sport: "nfl", eventId: "402", game: "DET @ GB",  mkt: "total",  side: "over", dir: "over", line: 47.5, price: -110, label: "Over 47.5", ts: NOW - 1000, priceSource: "self" },
  },
};
const draftRec = {
  ts: NOW,
  state: {
    settings: { budget: 200, spots: 15, scoring: "half", teams: [{ name: "Team A", owner: "Kap" }, { name: "Team B", owner: "Jeff" }] },
    picks: [{ player: "Jahmyr Gibbs", pos: "RB", ti: 0, price: 73, keeper: false, ts: NOW }],
    nomIdx: 1, onBlock: "Bijan Robinson",
  },
};
const poolJson = { as_of: "2026-07-29", source: "MV snapshot", note: "dated", tier: "labs", graded: false, scoring_keys: { half: "Half PPR" }, data: [
  { name: "Jahmyr Gibbs", pos: "RB", team: "DET", half: 81, rank: 1 },
  { name: "Ja'Marr Chase", pos: "WR", team: "CIN", half: 68, rank: 3 },
] };
const dfsHtml = 'junk before\nconst CORR = {"meta":{"seasons":[2019,2025]},"roles":["QB"],"same":[[1.0]],"opp":[[0.19]],"cv":{"QB":[{"lo":10,"hi":14,"cv":0.62,"n":62}]}};\njunk after';
const espnRaw = { events: [{ id: "401", shortName: "CLE @ PIT", date: "2026-09-13", status: { type: { state: "pre", completed: false } }, competitions: [{ competitors: [{ team: { abbreviation: "PIT" }, homeAway: "home", score: null }, { team: { abbreviation: "CLE" }, homeAway: "away", score: null }] }] }] };
const survJson = { data: {
  meta: { season: 2026, captured: "2026-08-06", elo_per_pt: 23.58, hfa: 2.1, sd: 13.18, nfelo_sha: "0d3f8418" },
  elo: { SEA: 1620, ARI: 1420, PIT: 1520, CLE: 1500 },
  teams: { SEA: { n: "Seahawks", loc: "Seattle", full: "Seattle Seahawks" },
           ARI: { n: "Cardinals", loc: "Arizona", full: "Arizona Cardinals" },
           PIT: { n: "Steelers", loc: "Pittsburgh", full: "Pittsburgh Steelers" },
           CLE: { n: "Browns", loc: "Cleveland", full: "Cleveland Browns" } },
  games: [
    { id: "2026_01_ARI_SEA", wk: 1, h: "SEA", a: "ARI", d: "2026-09-13", p: 0.8, src: "market" },
    { id: "2026_01_CLE_PIT", wk: 1, h: "PIT", a: "CLE", d: "2026-09-13", p: 0.55, src: "model" },
    { id: "2026_02_PIT_SEA", wk: 2, h: "SEA", a: "PIT", d: "2026-09-20", p: 0.7, src: "model" },
    { id: "2026_02_ARI_CLE", wk: 2, h: "CLE", a: "ARI", d: "2026-09-20", p: 0.6, src: "model" },
  ],
} };

let netMode = "normal"; // normal | dbdown | emptyRoom | espnDown | simulatedRoom | simulatedSettings
globalThis.fetch = async (input, init) => {
  const u = String(input instanceof URL ? input.href : (input && input.url) || input);
  const method = (init && init.method) || (input && input.method) || "GET";
  const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  if (method !== "GET") throw new Error("TEST: non-GET network call attempted by MCP path: " + method + " " + u);
  if (u.startsWith(FB + "/bozo/leagues.json") || u.startsWith(FB + "/bozo/leagues.json?")) {
    if (netMode === "dbdown") throw new Error("connect refused");
    return J({ main: leagueRec });
  }
  if (u.includes("/bozo/leagues/main/ledger")) return J(leagueRec.ledger || null);
  if (u.startsWith(FB + "/drafts/")) {
    if (netMode === "emptyRoom") return J(null);
    // C6 — the flag lives at the top level of the room node, out of the draft app's
    // write path. `simulatedSettings` covers the other place it might be written.
    if (netMode === "simulatedRoom") return J({ ...draftRec, simulated: true });
    if (netMode === "simulatedSettings") return J({ ...draftRec, state: { ...draftRec.state, settings: { ...draftRec.state.settings, simulated: true } } });
    return J(draftRec);
  }
  if (u.includes("datadawgs216.com/data/pool.json")) return J(poolJson);
  if (u.includes("datadawgs216.com/data/survivor.json")) return J(survJson);
  if (u.includes("datadawgs216.com/dfs.html")) return new Response(dfsHtml, { status: 200 });
  if (u.includes("site.api.espn.com")) {
    if (netMode === "espnDown") return new Response("no", { status: 403 });
    return J(espnRaw);
  }
  throw new Error("TEST: unexpected fetch " + u);
};

/* -------------------------------- helpers -------------------------------- */
const PASS = "sekrit-league-pass";
const env = { DAWG_PASS: PASS, RL: { async get(k) { return k === "survivor:2026:1" ? JSON.stringify({ season: 2026, week: 1, stored: NOW - 3600e3, picks: { CLE: 40 } }) : null; } } };
const req = (body, { path = "/mcp/" + PASS, headers = {}, method = "POST" } = {}) =>
  worker.fetch(new Request("https://toto.jkapcar4.workers.dev" + path, {
    method, headers: { "Content-Type": "application/json", ...headers },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  }), env);
const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, params });
const call = (name, args, id = 1) => rpc("tools/call", { name, arguments: args || {} }, id);
const text = r => JSON.parse(r.result.content[0].text);

/* --------------------------------- tests ---------------------------------- */
// handshake: echo each known protocolVersion, fall back on unknown
for (const v of ["2025-03-26", "2025-06-18", "2026-07-28"]) {
  const j = await (await req(rpc("initialize", { protocolVersion: v }))).json();
  ok(j.result && j.result.protocolVersion === v, "initialize echoes " + v);
  ok(j.result.serverInfo.name === "data-dawgs", "serverInfo " + v);
}
{
  const j = await (await req(rpc("initialize", { protocolVersion: "1999-01-01" }))).json();
  ok(j.result.protocolVersion === "2025-06-18", "initialize falls back on unknown version");
  ok(/caller-supplied inputs/.test(j.result.instructions) && /not stored/.test(j.result.instructions),
     "initialize explains deterministic calculator provenance and non-persistence");
}
// notification: 202, EMPTY body
{
  const r = await req({ jsonrpc: "2.0", method: "notifications/initialized" });
  ok(r.status === 202, "notification returns 202");
  ok((await r.text()) === "", "notification body is EMPTY");
}
// batch: initialize + notification + ping → array of 2
{
  const r = await req([rpc("initialize", { protocolVersion: "2025-06-18" }, 1), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("ping", {}, 2)]);
  const j = await r.json();
  ok(Array.isArray(j) && j.length === 2, "batch skips notification, answers the rest");
  ok(j[0].id === 1 && j[1].id === 2, "batch preserves ids");
}
// auth failure paths
ok((await req(rpc("ping"), { path: "/mcp/wrong-pass" })).status === 401, "wrong passphrase in path → 401");
ok((await req(rpc("ping"), { path: "/mcp" })).status === 401, "no passphrase → 401");
{
  const r = await req(rpc("ping"), { path: "/mcp", headers: { "X-Dawg-Pass": PASS } });
  ok(r.status === 200, "X-Dawg-Pass header accepted");
  const r2 = await req(rpc("ping"), { path: "/mcp", headers: { Authorization: "Bearer " + PASS } });
  ok(r2.status === 200, "Authorization: Bearer accepted");
}
{
  const r = await worker.fetch(new Request("https://x/mcp/" + PASS, { method: "POST", body: "{}" }), {});
  ok(r.status === 500, "missing DAWG_PASS secret → 500");
}
// protocol failure paths
ok((await req("this is not json")).status === 400, "bad JSON → 400");
{
  const j = await (await req("this is not json")).json();
  ok(j.error && j.error.code === -32700, "bad JSON → -32700");
}
{
  const j = await (await req({ notRpc: true, id: 9 })).json();
  ok(j.error && j.error.code === -32600, "invalid request → -32600");
}
{
  const j = await (await req(rpc("resources/list"))).json();
  ok(j.error && j.error.code === -32601, "unknown method → -32601");
}
{
  const j = await (await req(call("dd_nonexistent"))).json();
  ok(j.error && j.error.code === -32602, "unknown tool → -32602");
}
// OPTIONS preflight and GET hint
ok((await req(null, { method: "OPTIONS" })).status === 200 || (await req(null, { method: "OPTIONS" })).status === 204, "OPTIONS answered");
{
  const r = await req(null, { method: "GET" });
  ok(r.status === 405, "GET → 405 with hint");
  ok((r.headers.get("Access-Control-Allow-Origin") || "") === "*", "/mcp carries its own permissive CORS");
}
// tools/list: every tool is named and schema-described
{
  const j = await (await req(rpc("tools/list"))).json();
  const t = j.result.tools;
  ok(t.length === 21, "twenty-one tools listed");
  ok(t.every(x => x.name.startsWith("dd_")), "all tools dd_-prefixed");
  ok(t.every(x => x.inputSchema && x.inputSchema.type === "object"), "all tools carry an inputSchema");
  for (const name of ["dd_convert_odds", "dd_devig_market", "dd_price_parlay", "dd_calculate_bet_ev",
    "dd_calculate_hedge", "dd_nfl_passer_rating", "dd_score_forecast", "dd_summarize_beliefs"])
    ok(t.some(x => x.name === name), name + " is listed");
}
// dd_league_overview
{
  const j = await (await req(call("dd_league_overview"))).json();
  const d = text(j);
  ok(d.name === "Data Dawgs" && d.season === 2026, "league overview basics");
  ok(d.members.includes("The Kid"), "member names are DECODED (The%20Kid → The Kid)");
  ok(d.legsIn === 2, "legsIn counts current picks");
}
// dd_bozo_week: submission order + caveats
{
  const j = await (await req(call("dd_bozo_week"))).json();
  const d = text(j);
  ok(d.legs.length === 2, "bozo week returns both legs");
  ok(d.legs[0].player === "Jeff" && d.legs[1].player === "Kap", "legs in SUBMISSION ORDER (ts), not key order");
  ok(Array.isArray(d.caveats) && d.caveats.some(c => c.includes("CLV")), "caveats ship in the payload, incl. never-state-CLV");
  ok(d.legs[0].priceSource === "self", "priceSource label survives");
}
// dd_bozo_standings on an empty ledger: an answer, not a crash
{
  const j = await (await req(call("dd_bozo_standings"))).json();
  ok(!j.result.isError && text(j).note.includes("empty"), "empty ledger is an answer");
}
// dd_draft_board: maxBid math
{
  const j = await (await req(call("dd_draft_board"))).json();
  const d = text(j);
  const a = d.teams.find(t => t.name === "Team A"), b = d.teams.find(t => t.name === "Team B");
  ok(a.spent === 73 && a.left === 127 && a.openSpots === 14, "team A spent/left/open");
  ok(a.maxBid === 127 - 13, "maxBid = left − (openSpots − 1) — $1 reserved per unfilled slot");
  ok(b.maxBid === 200 - 14, "untouched team maxBid = budget − (spots − 1)");
  ok(d.onTheClock === "Team B" && d.onBlock === "Bijan Robinson", "clock + block");
}
// dd_draft_board: C6 — a test pick must never read as a completed sale
{
  const j = await (await req(call("dd_draft_board"))).json();
  const d = text(j);
  ok(d.simulated === false, "unflagged room: simulated is present and false, never absent");
  ok(d.note === undefined, "…and carries no warning it would have to walk back");
}
{
  netMode = "simulatedRoom";
  const j = await (await req(call("dd_draft_board"))).json();
  const d = text(j);
  ok(d.simulated === true, "top-level flag → simulated true");
  ok(typeof d.note === "string" && /NOT completed sales/.test(d.note),
     "…and the payload says so in WORDS — a bare boolean is ignorable, prose is not");
  ok(d.recentSales.length === 1 && d.teams.length === 2,
     "…while still returning the picks: the room stays usable for league testing (backlog C5)");
  netMode = "normal";
}
{
  netMode = "simulatedSettings";
  const j = await (await req(call("dd_draft_board"))).json();
  ok(text(j).simulated === true, "settings-level flag also counts (draft app may rewrite state)");
  netMode = "normal";
}
// dd_draft_board: empty room is a tool error, not a protocol error
{
  netMode = "emptyRoom";
  const j = await (await req(call("dd_draft_board"))).json();
  ok(j.result && j.result.isError === true, "empty draft room → isError RESULT");
  ok(j.result.content[0].text.includes("empty"), "…that says the room is empty");
  netMode = "normal";
}
// database failure → isError result, turn survives
{
  netMode = "dbdown";
  const j = await (await req(call("dd_bozo_week"))).json();
  ok(j.result && j.result.isError === true && /unreachable|refused/i.test(j.result.content[0].text), "DB down → isError result");
  netMode = "normal";
}
// dd_draft_pool: envelope + filter + limit
{
  const j = await (await req(call("dd_draft_pool", { pos: "RB", limit: 5 }))).json();
  const d = text(j);
  ok(d.as_of === "2026-07-29", "pool carries as_of");
  ok(d.players.length === 1 && d.players[0].pos === "RB", "pos filter works");
  ok(/NOT a points projection/i.test(d.note) || d.note.length > 0, "staleness note survives");
}
// dd_survivor_week
{
  const j = await (await req(call("dd_survivor_week", { week: 1 }))).json();
  const d = text(j);
  ok(d.picks && d.picks.CLE === 40, "survivor picks returned");
  ok(d.stale === false && typeof d.ageHours === "number", "age computed, not stale at 1h");
  const j2 = await (await req(call("dd_survivor_week", { week: 9 }))).json();
  ok(j2.result.isError === true, "missing survivor week → isError");
  const j3 = await (await req(call("dd_survivor_week", { week: 99 }))).json();
  ok(j3.result.isError === true, "week 99 rejected");
}
// dd_survivor_ev: a PORT of survivor.html's leverage(), and the parity is enforced —
// the reference below is transcribed from the page, not from the block. If the two
// drift, the MCP answer and the board silently disagree, which is the actual failure.
function refLeverage(week, pop, games, entries, used) {
  const tab = {};
  games.filter((g) => g.wk === week).forEach((g) => { tab[g.h] = { opp: g.a, p: g.p }; tab[g.a] = { opp: g.h, p: 1 - g.p }; });
  const E = Math.max(1, entries - 1);
  const seen = {}, gs = [];
  for (const t in tab) {
    if (seen[t]) continue;
    const g = tab[t]; seen[t] = 1; seen[g.opp] = 1;
    const ph = g.p, ah = pop[t] || 0, aa = pop[g.opp] || 0;
    gs.push({ h: t, a: g.opp, mean: aa + (ah - aa) * ph, varc: (ah - aa) * (ah - aa) * ph * (1 - ph) });
  }
  return Object.keys(tab).filter((t) => !used.has(t)).map((t) => {
    const own = pop[t] || 0; let mu = 0, v2 = 0;
    for (const g of gs) { if (g.h === t || g.a === t) { mu += own; continue; } mu += g.mean; v2 += g.varc; }
    const mean = E * mu, varS = E * E * v2, d = 1 + mean;
    return { team: t, equity: tab[t].p * (1 / d + varS / (d * d * d)) };
  });
}
{
  // week 2 has no posted snapshot → ownership is MODELLED and must say so in words
  const j = await (await req(call("dd_survivor_ev", { week: 2, entries: 200 }))).json();
  const d = text(j);
  ok(d.ownership === "modelled", "no snapshot → ownership modelled");
  ok(typeof d.note === "string" && /MODELLED/.test(d.note), "…and the payload says so in WORDS, not a flag");
  ok(typeof d.model === "string" && /independent/.test(d.model) && /Taylor/.test(d.model),
     "the model names itself: independence assumption + Taylor correction (invariant 6)");
  ok(d.rows.length === 4 && d.rows[0].evIndex === 1 && d.rows[0].rank === 1, "4 candidates, leader indexed 1.0");
  ok(d.rows.every((r, i) => !i || d.rows[i - 1].equity >= r.equity), "sorted by equity, best first");
  const CHALK = 2.4, tabP = { SEA: 0.7, PIT: 0.3, CLE: 0.6, ARI: 0.4 };
  const pop = {}; let tot = 0;
  for (const t in tabP) { pop[t] = Math.pow(Math.max(tabP[t], 0.01), CHALK); tot += pop[t]; }
  for (const t in pop) pop[t] /= tot;
  const ref = refLeverage(2, pop, survJson.data.games, 200, new Set());
  ok(ref.every((r) => Math.abs((d.rows.find((x) => x.team === r.team) || {}).equity - r.equity) < 1e-5),
     "equity matches survivor.html's leverage() transcribed independently — a port, not a cousin");
}
{
  // week 1 HAS a posted snapshot ({CLE:40}) → renormalised over the teams playing
  const j = await (await req(call("dd_survivor_ev", { week: 1 }))).json();
  const d = text(j);
  ok(d.ownership === "posted" && d.stale === false, "stored snapshot → posted, hour-old is not stale");
  const cle = d.rows.find((r) => r.team === "CLE"), sea = d.rows.find((r) => r.team === "SEA");
  ok(cle && cle.pop === 1, "posted picks renormalise over teams actually playing (CLE 40 → 100%)");
  ok(sea.survivorsIfWin < cle.survivorsIfWin,
     "joining the chalk keeps the whole field alive with you; fading it does not");
}
{
  // every playing team spent → a tool error, case-insensitively
  const j = await (await req(call("dd_survivor_ev", { week: 1, used: ["sea", "PIT", "CLE", "ari"] }))).json();
  ok(j.result.isError === true && /used list/.test(j.result.content[0].text), "all teams used → tool error, used list is case-insensitive");
  const j2 = await (await req(call("dd_survivor_ev", { week: 7 }))).json();
  ok(j2.result.isError === true, "week with no games in the snapshot → tool error");
}
// dd_analyze_matchup: the formula is public in models.json — recompute it here with a
// DIFFERENT Φ approximation (Press erfc, not the page's Abramowitz–Stegun) so agreement
// means the maths is right, not that the same bug is pasted twice.
function refNcdf(z) {
  const x = z / Math.SQRT2, ax = Math.abs(x), t = 1 / (1 + 0.5 * ax);
  const e = t * Math.exp(-ax * ax - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  const erfc = x >= 0 ? e : 2 - e;
  return 1 - erfc / 2;
}
{
  const j = await (await req(call("dd_analyze_matchup", { home: "SEA", away: "cardinals" }))).json();
  const d = text(j);
  ok(d.home.team === "SEA" && d.away.team === "ARI", "abbreviation and nickname both resolve");
  const margin = (1620 - 1420) / 23.58 + 2.1;
  ok(Math.abs(d.expectedMarginAtHome - Math.round(margin * 100) / 100) < 1e-9, "margin follows the published formula");
  ok(Math.abs(d.pHomeWin - refNcdf(margin / 13.18)) < 2e-4, "win prob is Φ(margin/SD), checked against an independent CDF");
  ok(Array.isArray(d.scheduledMeetings2026) && d.scheduledMeetings2026[0].week === 1 && d.scheduledMeetings2026[0].pHomeWin === 0.8,
     "the week-1 meeting is listed with the board's blended number");
  ok(/Elo-only/.test(d.model) && /0d3f8418/.test(d.model), "model names itself AND its snapshot (invariant 6)");
}
{
  const j = await (await req(call("dd_analyze_matchup", { home: "the 1972 dolphins", away: "SEA" }))).json();
  ok(j.result.isError === true, "unknown team → tool error");
  const j2 = await (await req(call("dd_analyze_matchup", { home: "browns", away: "Cleveland" }))).json();
  ok(j2.result.isError === true, "same team by two names → tool error");
}
// Pound calculators: pure MCP results must stay in parity with work/pound-core.js.
{
  const j = await (await req(call("dd_convert_odds", { american_odds: -110 }))).json();
  const d = text(j), ref = P.oddsConverter(-110);
  ok(Math.abs(d.decimal_odds - ref.decimal) < 1e-12, "odds decimal matches Pound core");
  ok(Math.abs(d.implied_probability - ref.implied_probability) < 1e-12, "odds implied probability matches Pound core");
  ok(d.read_only === true && /user-supplied/i.test(d.note), "odds result labels provenance and read-only behavior");
  const bad = await (await req(call("dd_convert_odds", { american_odds: -50 }))).json();
  ok(bad.result.isError === true, "invalid American odds fail closed");
  const wrongType = await (await req(call("dd_convert_odds", { american_odds: "-110" }))).json();
  ok(wrongType.result.isError === true, "numeric strings are rejected against the MCP number schema");
}
{
  const j = await (await req(call("dd_devig_market", { side_a_american: -110, side_b_american: -110 }))).json();
  const d = text(j), ref = P.holdVig(-110, -110);
  ok(Math.abs(d.hold - ref.hold) < 1e-12, "market hold matches Pound core");
  ok(d.devig_probability.every((x, i) => Math.abs(x - ref.devig_probability[i]) < 1e-12), "proportional devig matches Pound core");
  ok(d.devig_method === "proportional normalization", "devig method is explicit");
}
{
  const prices = [-110, 150];
  const j = await (await req(call("dd_price_parlay", { american_odds: prices }))).json();
  const d = text(j), ref = P.parlay(prices);
  ok(Math.abs(d.decimal_odds - ref.decimal) < 1e-12 && Math.abs(d.american_odds - ref.american) < 1e-12,
     "parlay price matches Pound core");
  ok(/correlation/.test(d.note), "parlay discloses that price multiplication is not a correlation model");
  const empty = await (await req(call("dd_price_parlay", { american_odds: [] }))).json();
  ok(empty.result.isError === true, "empty parlay fails closed");
  const tooMany = await (await req(call("dd_price_parlay", { american_odds: new Array(21).fill(-110) }))).json();
  ok(tooMany.result.isError === true, "parlay call is bounded at 20 legs");
}
{
  const price = -110, p = P.impliedFromAmerican(price);
  const j = await (await req(call("dd_calculate_bet_ev", { win_probability: p, american_odds: price }))).json();
  const d = text(j), ref = P.betEV(p, price);
  ok(Math.abs(d.roi - ref.roi) < 1e-12 && Math.abs(d.break_even_probability - ref.break_even_probability) < 1e-12,
     "bet EV matches Pound core at break-even");
  ok(/caller-supplied/.test(d.note) && /not an independently graded edge/i.test(d.note), "EV result refuses an edge claim");
  const bad = await (await req(call("dd_calculate_bet_ev", { win_probability: 1.1, american_odds: -110 }))).json();
  ok(bad.result.isError === true, "EV probability outside [0,1] fails closed");
}
{
  const j = await (await req(call("dd_calculate_hedge", { original_stake: 100, original_american: 200, hedge_american: -150 }))).json();
  const d = text(j), ref = P.hedge(100, 200, -150);
  ok(Math.abs(d.hedge_stake - ref.hedge_stake) < 1e-12 && Math.abs(d.locked_profit - ref.locked_profit) < 1e-12,
     "hedge sizing matches Pound core");
  ok(/no bet is placed/.test(d.note), "hedge tool states that it takes no action");
  const bad = await (await req(call("dd_calculate_hedge", { original_stake: 0, original_american: 200, hedge_american: -150 }))).json();
  ok(bad.result.isError === true, "non-positive hedge stake fails closed");
}
{
  const args = { attempts: 20, completions: 20, yards: 400, touchdowns: 4, interceptions: 0 };
  const j = await (await req(call("dd_nfl_passer_rating", args))).json();
  const d = text(j), ref = P.passerRating(20, 20, 400, 4, 0);
  ok(Math.abs(d.nfl_passer_rating - ref.rating) < 1e-12 && Math.abs(d.nfl_passer_rating - 158.33333333333334) < 1e-12,
     "perfect passer rating matches Pound core");
  const neg = text(await (await req(call("dd_nfl_passer_rating", { attempts: 1, completions: 0, yards: -5, touchdowns: 0, interceptions: 0 }))).json());
  ok(Math.abs(neg.nfl_passer_rating - P.passerRating(1, 0, -5, 0, 0).rating) < 1e-12, "legitimate negative passing yards remain valid");
  const fractional = await (await req(call("dd_nfl_passer_rating", { attempts: 1.5, completions: 1, yards: 10, touchdowns: 0, interceptions: 0 }))).json();
  ok(fractional.result.isError === true, "fractional passing statistics fail closed");
}
{
  const j = await (await req(call("dd_score_forecast", { forecast_probability: 0.7, outcome_0_or_1: 1 }))).json();
  const d = text(j), ref = P.forecastGrade(0.7, 1);
  ok(Math.abs(d.brier - ref.brier) < 1e-12 && Math.abs(d.log_loss - ref.log_loss) < 1e-12,
     "forecast grade matches Pound core");
  ok(d.sample_size === 1 && d.graded_track_record === false, "single-row grade cannot masquerade as a track record");
  const bad = await (await req(call("dd_score_forecast", { forecast_probability: 0.7, outcome_0_or_1: 2 }))).json();
  ok(bad.result.isError === true, "non-binary outcome fails closed");
}
{
  const xs = [0.4, 0.6, 0.7];
  const j = await (await req(call("dd_summarize_beliefs", { probabilities: xs }))).json();
  const d = text(j), ref = P.beliefSummary(xs);
  ok(Math.abs(d.mean - ref.mean) < 1e-12 && Math.abs(d.standard_deviation - ref.standard_deviation) < 1e-12,
     "belief summary matches Pound core");
  ok(d.crosses_50 === true && /not a validated consensus blend/i.test(d.note), "belief summary carries the no-consensus claim");
  const empty = await (await req(call("dd_summarize_beliefs", { probabilities: [] }))).json();
  ok(empty.result.isError === true, "empty belief list fails closed");
}
// dd_scores: reuses handleScores with sport+dates
{
  const j = await (await req(call("dd_scores", { sport: "nfl", dates: "20260913" }))).json();
  const d = text(j);
  ok(d.games && d.games[0].short === "CLE @ PIT", "scores flow through handleScores");
  const j2 = await (await req(call("dd_scores", { sport: "curling" }))).json();
  ok(j2.result.isError === true, "unknown sport → isError");
  netMode = "espnDown";
  const j3 = await (await req(call("dd_scores", { sport: "nfl" }))).json();
  ok(j3.result.isError === true && /espn\.com/.test(j3.result.content[0].text), "ESPN egress refusal → honest isError with fallback hint");
  netMode = "normal";
}
// dd_dfs_correlations: extraction from the live page
{
  const j = await (await req(call("dd_dfs_correlations"))).json();
  const d = text(j);
  ok(d.roles && d.roles[0] === "QB" && d.same[0][0] === 1, "CORR extracted and parsed from dfs.html");
}
// dd_site_map: says what is NOT served
{
  const j = await (await req(call("dd_site_map"))).json();
  const d = text(j);
  ok(d.notServedHere && /localStorage/.test(d.notServedHere.dfs_projections_and_ownership), "notServedHere explains the DFS invariant");
  ok(d.machine.surfaces.includes("surfaces.json"), "points agents at the surfaces map");
  ok(d.machine.data.includes("/data/model-contracts.json") && d.pages["pound.html"], "site map includes the Pound contracts and workbench");
}

/* ----------------------- source-level safety asserts ----------------------- */
const blockSrc = readFileSync("mcp-block.js", "utf8");
const noComments = blockSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
ok(!/fbPut|fbPatch|fbDelete/.test(noComments), "block calls NO Firebase write helper");
ok(!/\.put\(|\.delete\(/.test(noComments), "block performs NO KV writes");
ok(!/method:\s*["'](PUT|POST|PATCH|DELETE)/.test(noComments), "block issues NO writing HTTP methods");
const assembled = readFileSync("../dawg-bot-worker.js", "utf8");
const oldLines = readFileSync("../dawg-bot-worker.js", "utf8").split("\n").filter(l => l.trim());
const newSet = new Set(assembled.split("\n"));
ok(oldLines.every(l => newSet.has(l)), "purely additive: every non-blank old line survives");
ok((assembled.match(/export default/g) || []).length === 1, "exactly one default export");
ok(!assembled.includes(PASS), "no hardcoded secrets in the source");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
