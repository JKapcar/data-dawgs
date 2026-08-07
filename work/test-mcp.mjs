// Tests the ASSEMBLED Worker — its real timingSafeEqual, loadLeague, fbGet and
// handleScores — with only the network faked. Run: node test-mcp.mjs
import { readFileSync } from "fs";
import worker from "./dawg-bot-worker.assembled.js";

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

let netMode = "normal"; // normal | dbdown | emptyRoom | espnDown
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
  if (u.startsWith(FB + "/drafts/")) return J(netMode === "emptyRoom" ? null : draftRec);
  if (u.includes("datadawgs216.com/data/pool.json")) return J(poolJson);
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
// tools/list: nine tools, all dd_-prefixed, all with schemas
{
  const j = await (await req(rpc("tools/list"))).json();
  const t = j.result.tools;
  ok(t.length === 9, "nine tools listed");
  ok(t.every(x => x.name.startsWith("dd_")), "all tools dd_-prefixed");
  ok(t.every(x => x.inputSchema && x.inputSchema.type === "object"), "all tools carry an inputSchema");
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
}

/* ----------------------- source-level safety asserts ----------------------- */
const blockSrc = readFileSync("mcp-block.js", "utf8");
const noComments = blockSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
ok(!/fbPut|fbPatch|fbDelete/.test(noComments), "block calls NO Firebase write helper");
ok(!/\.put\(|\.delete\(/.test(noComments), "block performs NO KV writes");
ok(!/method:\s*["'](PUT|POST|PATCH|DELETE)/.test(noComments), "block issues NO writing HTTP methods");
const assembled = readFileSync("dawg-bot-worker.assembled.js", "utf8");
const oldLines = readFileSync("../dawg-bot-worker.js", "utf8").split("\n").filter(l => l.trim());
const newSet = new Set(assembled.split("\n"));
ok(oldLines.every(l => newSet.has(l)), "purely additive: every non-blank old line survives");
ok((assembled.match(/export default/g) || []).length === 1, "exactly one default export");
ok(!assembled.includes(PASS), "no hardcoded secrets in the source");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
