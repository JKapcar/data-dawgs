#!/usr/bin/env node
"use strict";
/**
 * Phase 0.5 T6 — week object + receipts gates.
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const Receipts = require("./dfs-receipts.js");
const Week = require("./dfs-week.js");
const Standings = require("./dfs-standings-ingest.js");

let failed = 0;
function check(cond, msg) {
  try {
    assert.ok(cond, msg);
    console.log("ok:", msg);
  } catch (e) {
    failed++;
    console.error("FAIL:", msg, e.message);
  }
}

// --- hash stability (salt-less SHA-256 of sorted DK ids + CPT) ---
const players = [
  { name: "Alpha", dkId: "100", cptId: "100C", team: "AA", proj: 20, own: 12 },
  { name: "Bravo", dkId: "200", team: "BB", proj: 18, own: 8 },
  { name: "Charlie", dkId: "300", team: "AA", proj: 15, own: 5 },
  { name: "Delta", dkId: "400", team: "CC", proj: 14, own: 4 },
  { name: "Echo", dkId: "500", team: "DD", proj: 11, own: 3 },
  { name: "Foxtrot", dkId: "600", team: "EE", proj: 9, own: 2 }
];
const lineupA = { ids: [0, 1, 2, 3, 4, 5], cpt: 0, proj: 87 };
const lineupB = { ids: [5, 4, 3, 2, 1, 0], cpt: 0, proj: 87 }; // same set, different order
const h1 = Receipts.hashEntries({ players, lineups: [lineupA] }).lineupHashes[0];
const h2 = Receipts.hashEntries({ players, lineups: [lineupB] }).lineupHashes[0];
check(typeof h1 === "string" && h1.length === 64, "lineup hash is 64-hex SHA-256");
check(h1 === h2, "sha stable across slot order (sorted DK ids + CPT)");
const hDirect = Receipts.hashLineupIds(["100C", "200", "300", "400", "500", "600"], "100C");
check(h1 === hDirect, "hashEntries matches hashLineupIds");

// reorder DK ids input still stable
const h3 = Receipts.hashLineupIds(["600", "100C", "200", "500", "300", "400"], "100C");
check(h1 === h3, "hashLineupIds sorts before hashing");

// --- build week object: aggregates only ---
const S = {
  season: 2026,
  week: 1,
  site: "dk_showdown",
  demo: false,
  players,
  lineups: [lineupA],
  slate: { source: "upload", draftGroupId: 42 },
  contests: [{ id: "dk-contest-999", name: "Wildcat", buyIn: 3, entryCap: 150, fieldCap: 20000 }],
  projSource: "paste",
  ownSource: "paste"
};
const SIM = {
  meta: { fieldSize: 20000, sims: 1000 },
  perLineup: [{ cash: 0.22, top10: 0.04, top1: 0.002, win: 0.002 }]
};
const week = Week.build(S, SIM, S.contests);
Week.stampLockedSha256(week);
check(week.realized === null, "realized:null at lock");
check(!!week.lockedSha256 && week.lockedSha256.length === 64, "lockedSha256 stamped before kickoff");
check(Array.isArray(week.lineups) && week.lineups[0] === h1, "lineups are hashes only");
check(week.expCash != null && week.dupePrior === true, "expCash + dupePrior");
const agg = Week.assertAggregateOnly(week);
check(agg.ok, "no player names/projections/ownership in week JSON: " + (agg.reason || "ok"));
const raw = JSON.stringify(week);
check(!/"Alpha"/.test(raw) && !/"proj":20/.test(raw), "player names and proj values absent");
check(!/"own":12/.test(raw), "ownership values absent");

// sha stable for same canonical payload
const week2 = Week.build(S, SIM, S.contests);
week2.lockAt = week.lockAt;
Week.stampLockedSha256(week2);
check(week.lockedSha256 === week2.lockedSha256, "lockedSha256 stable for identical canonical JSON");

// --- ingest fills realized by hash when contest matches ---
const standings = {
  contestKey: "dk-contest-999",
  week: 1,
  n: 100,
  entries: [
    { rank: 5, points: 120, entryName: "me", entryHash: "deadbeef", lineupHash: h1 }
  ]
};
const before = week.realized;
check(before === null, "still null before ingest");
Week.fillRealized(week, standings);
check(week.realized != null, "ingest fills realized");
check(week.realized.matchedLineups === 1, "matched by hash");
check(week.realized.byHash[h1].rank === 5, "rank attached under hash");

// null stays null when contest does not match
const weekOther = Week.build(S, SIM, [{ id: "other-contest", name: "x" }]);
Week.stampLockedSha256(weekOther);
check(weekOther.realized === null, "pre-ingest null");
Week.fillRealized(weekOther, standings);
check(weekOther.realized === null, "null stays null when contest id does not match");

// applyWeekRealized on S.weeks map
const weeksMap = { 1: Week.build(S, SIM, S.contests) };
Week.stampLockedSha256(weeksMap[1]);
const applied = Standings.applyWeekRealized(weeksMap, standings);
check(applied.updated === true, "applyWeekRealized updates matching week");
check(weeksMap[1].realized != null, "S.weeks[1].realized filled");

// calibration only over weeks with realized
const cal = Week.calibrationFromWeeks([weeksMap[1], weekOther]);
check(cal.ready === true && cal.n === 1, "cashBuckets/roiBuckets only over realized weeks");

// Toto report line
Week.storeInState(S, weeksMap[1]);
const report = Week.totoReport(S);
check(/Expectations were pre-registered at /.test(report), "Toto pre-registered line");
check(/sha [a-f0-9]{8}/.test(report), "Toto sha 8");

// --- seed envelope: validate-data contract shape ---
const seedPath = path.join(__dirname, "..", "data", "dfs-weeks.json");
check(fs.existsSync(seedPath), "data/dfs-weeks.json seed exists");
const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
check(!!seed.as_of && !!seed.source, "seed has as_of + source");
check(Array.isArray(seed.data) && seed.data.length === 0, "seed data:[] (Kap publishes later)");
check(/week-object|week object|DFS/i.test(seed.note || seed.source || ""), "seed notes week-object path");

if (failed) {
  console.error("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall passed");
