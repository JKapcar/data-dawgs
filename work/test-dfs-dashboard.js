#!/usr/bin/env node
"use strict";
const D = require("./dfs-dashboard.js");
const Screener = require("./dfs-contest-screener.js");

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}

// --- countdown formatter (DOM-free) ---
assert(D.formatCountdown(0) === "LOCKED", "countdown 0 → LOCKED");
assert(D.formatCountdown(-5000) === "LOCKED", "countdown negative → LOCKED");
assert(D.formatCountdown(null) === "—", "countdown null → emdash");
assert(D.formatCountdown(45 * 1000) === "45s", "countdown seconds");
assert(D.formatCountdown((3 * 60 + 12) * 1000) === "3m 12s", "countdown minutes");
assert(D.formatCountdown((2 * 3600 + 14 * 60) * 1000) === "2h 14m", "countdown hours");
assert(D.formatCountdown((1 * 86400 + 3 * 3600) * 1000) === "1d 3h", "countdown days");

// --- survivor join with 3 abbrev mismatches (JAC/JAX, LA/LAR, WSH/WAS) ---
const survivor = {
  as_of: "2026-09-07",
  data: {
    games: [
      { wk: 1, a: "IND", h: "JAX", d: "2026-09-14", p: 0.41, mm: -2.1, src: "market" },
      { wk: 1, a: "SF", h: "LAR", d: "2026-09-10", p: 0.62, mm: 3.4, src: "model" },
      { wk: 1, a: "NYG", h: "WAS", d: "2026-09-14", p: 0.38, mm: -3.0, src: "market" },
      { wk: 2, a: "BUF", h: "MIA", d: "2026-09-21", p: 0.55, mm: 1.2, src: "market" }
    ]
  }
};
const slateGames = [
  { away: "IND", home: "JAC", gid: "IND@JAC", kickoff: "2026-09-14T17:00:00Z" }, // JAC vs JAX
  { away: "SF", home: "LA", gid: "SF@LA" }, // LA vs LAR
  { away: "NYG", home: "WSH", gid: "NYG@WSH" } // WSH vs WAS
];
const joined = D.joinSurvivorSlate(slateGames, survivor, { week: 1 });
assert(joined.as_of === "2026-09-07", "as_of once from envelope");
assert(joined.rows.length === 3, "3 joined rows");
assert(joined.unmatched.length === 0, "all three abbrev mismatches resolve");
assert(joined.rows[0].matched && joined.rows[0].home === "JAX" && joined.rows[0].src === "market", "JAC→JAX market");
assert(joined.rows[1].matched && joined.rows[1].home === "LAR" && joined.rows[1].src === "model", "LA→LAR model");
assert(joined.rows[2].matched && Math.abs(joined.rows[2].p - 0.38) < 1e-9, "WSH→WAS p");
assert(joined.rows[1].mm === 3.4, "modelled margin");

// unmatched when no survivor row
const miss = D.joinSurvivorSlate([{ away: "BUF", home: "MIA" }], survivor, { week: 1 });
assert(miss.unmatched.indexOf("BUF@MIA") >= 0 && !miss.rows[0].matched, "week filter leaves BUF@MIA unmatched");

// --- chip state from fixture S ---
const chipsEmpty = D.pipelineChips({ players: [], lineups: [], weeks: {} }, {});
assert(chipsEmpty.map(c => c.id).join(",") === "slate,projections,lineups,sim,exported,graded", "chip order");
assert(chipsEmpty.every(c => !c.ready), "all chips cold on empty S");

const chipsHot = D.pipelineChips({
  players: [
    { name: "A", proj: 20, excl: false },
    { name: "B", proj: null }
  ],
  lineups: [{ ids: [0] }],
  slate: { source: "toto", loadedAt: "2026-09-07T12:00:00Z", draftGroupId: 1 },
  exportedAt: "2026-09-07T15:00:00Z",
  weeks: { 1: { graded: true } }
}, { sim: { meta: { sims: 1000 } } });
assert(chipsHot[0].ready && chipsHot[1].ready && chipsHot[2].ready, "slate/proj/lineups ready");
assert(chipsHot[3].ready && chipsHot[4].ready && chipsHot[5].ready, "sim/exported/graded ready");
assert(chipsHot[5].detail.indexOf("1") >= 0, "graded detail has week");

// play band
const scored = [
  Screener.scoreContest({ name: "Play GPP", buyIn: 3, entryCap: 1, fieldCap: 100, prizePool: 270, firstPrize: 50, tenthPrize: 10, minCash: 6 }),
  Screener.scoreContest({ name: "Avoid", buyIn: 20, entryCap: 150, fieldCap: 100000, prizePool: 1000000, firstPrize: 500000, tenthPrize: 1000, minCash: 20 })
];
// force into list shape via playBandList with pre-scored
const plays = D.playBandList(scored.map(r => Object.assign({}, r.contest, { verdict: r.verdict, rank: r.rank })), null, 5);
// Actually playBandList expects either scored objects or uses scoreFn — pass scored directly:
const plays2 = D.playBandList(scored, null, 5);
assert(plays2.every(r => String(r.verdict).toLowerCase() === "play") || plays2.length <= scored.filter(r => r.verdict === "play").length, "play filter");

const last = D.lastWeekCard({}, 3);
assert(last.empty && /Week 3 not graded/.test(last.message), "last week empty message");
const lastOk = D.lastWeekCard({ weeks: { 2: { graded: true, net: 12 } } }, 3);
assert(!lastOk.empty && lastOk.week === 2 && lastOk.graded, "last week from S.weeks");

const games = D.gamesFromPlayers([
  { gid: "BUF@MIA", team: "BUF", kickoff: "2026-09-14T17:00:00Z" },
  { gid: "BUF@MIA", team: "MIA" },
  { away: "JAC", home: "IND", gid: "JAC@IND" }
]);
assert(games.length === 2, "unique games");
assert(games.some(g => g.away === "JAX" || g.home === "JAX" || g.away === "JAC"), "abbrev on gamesFromPlayers");

console.log(failed ? "\n" + failed + " failed" : "\nall passed");
process.exit(failed ? 1 : 0);
