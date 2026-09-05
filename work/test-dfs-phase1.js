#!/usr/bin/env node
"use strict";
const Presets = require("./dfs-contest-presets.js");
const Dupe = require("./dfs-dupe-model.js");
const Val = require("./dfs-validators.js");
const Receipts = require("./dfs-receipts.js");
const Screener = require("./dfs-contest-screener.js");

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}

// presets
assert(Presets.listPresets().length === 7, "7 presets");
const milly = Presets.solverCfgFromPreset("milly", { lineupCap: 150, entryCap: 20 });
assert(milly.count === 20, "milly capped by entryCap 20 → " + milly.count);
assert(milly.uniq >= 3, "milly min uniques");
assert(milly.leverageScale > 1, "milly highest leverage");

const cash = Presets.solverCfgFromPreset("cash");
assert(cash.count === 1 && cash.rand === 0, "cash 1 lineup zero rand");

// screener enrich
const scored = Screener.scoreContest({ name: "Milly Maker", buyIn: 20, entryCap: 150, fieldCap: 100000, prizePool: 1700000, firstPrize: 1000000, tenthPrize: 50000, minCash: 30 });
assert(scored.preset.key === "milly", "screener milly");
assert(scored.preset.lineups === 150, "enriched lineups on preset");

// dupe model
const players = [
  { name: "QB A", pos: "QB", team: "BUF", opp: "MIA", own: 20, proj: 20 },
  { name: "WR1", pos: "WR", team: "BUF", opp: "MIA", own: 25, proj: 18 },
  { name: "WR2", pos: "WR", team: "BUF", opp: "MIA", own: 12, proj: 14 },
  { name: "RB1", pos: "RB", team: "KC", opp: "DEN", own: 18, proj: 16 },
  { name: "RB2", pos: "RB", team: "KC", opp: "DEN", own: 10, proj: 12 },
  { name: "WR3", pos: "WR", team: "MIA", opp: "BUF", own: 15, proj: 13 },
  { name: "TE1", pos: "TE", team: "MIA", opp: "BUF", own: 8, proj: 10 },
  { name: "DST", pos: "DST", team: "DEN", opp: "KC", own: 5, proj: 7 },
  { name: "FLEX", pos: "WR", team: "LAR", opp: "SF", own: 9, proj: 11 }
];
const lu = { ids: [0, 1, 2, 3, 4, 5, 6, 7, 8], proj: 100, sal: 50000 };
const d = Dupe.expectedDupes(lu, players, { entries: 100000 });
assert(d.prior === true, "dupe labelled prior");
assert(d.eDupes > 0, "eDupes positive " + d.eDupes);
assert(d.drivers.some(x => x.id === "qb_same_wrte"), "QB+WR prior fired");
assert(d.drivers.some(x => x.id === "two_rb_same"), "two RB prior fired");

const thr = Dupe.thresholdForContest(100000);
assert(thr === 10, "large field thr entries/10000 = " + thr);

// validators classic naked QB
const naked = { ids: [0, 3, 4, 5, 6, 7, 8, 8, 8].slice(0, 9) };
// fix: need 9 unique-ish - use players without BUF WR
const nakedPlayers = players.map(p => Object.assign({}, p));
const nakedLu = { ids: [0, 3, 4, 5, 6, 7, 8], sal: 49000 }; // QB without BUF catchers - missing slots ok for validator
const issues = Val.validateLineup(nakedLu, nakedPlayers, { showdown: false });
assert(issues.some(i => i.code === "naked_qb"), "naked QB warn");

const setRep = Val.validateSet([lu], players, { entries: 100000, showdown: false });
assert(setRep.summary.prior === true, "set summary prior");
assert(setRep.results[0].eDupes != null, "eDupes on result");

const fit = Val.fitCheck([lu], players, Presets.getPreset("single_gpp"), { fieldCap: 100000, entryCap: 1 });
assert(fit.score <= 100 && fit.prior === true, "fit score " + fit.score);

const blocked = Val.exportAllowed("cash", "gpp tournament");
assert(blocked.ok === false, "cash vs gpp export blocked");
assert(Val.exportAllowed("mme", "gpp").ok === true, "mme gpp ok");

// showdown CPT K warn
const sdPlayers = [
  { name: "K", pos: "K", team: "NE", opp: "NYJ", own: 8, proj: 9 },
  { name: "QB", pos: "QB", team: "NE", opp: "NYJ", own: 20, proj: 22 },
  { name: "WR", pos: "WR", team: "NE", opp: "NYJ", own: 18, proj: 16 },
  { name: "RB", pos: "RB", team: "NYJ", opp: "NE", own: 14, proj: 15 },
  { name: "TE", pos: "TE", team: "NYJ", opp: "NE", own: 10, proj: 11 },
  { name: "DST", pos: "DST", team: "NYJ", opp: "NE", own: 6, proj: 7 }
];
const sdLu = { ids: [0, 1, 2, 3, 4, 5], cpt: 0, sal: 48000 };
const sdIssues = Val.validateLineup(sdLu, sdPlayers, { showdown: true, site: { cap: 50000 } });
assert(sdIssues.some(i => i.code === "cpt_k_dst"), "CPT K warn");
assert(sdIssues.some(i => i.code === "split"), "split info");

// receipts
const g = Receipts.gradeWeek({ week: 1 });
assert(g.ownershipMiss.ready === false && g.ownershipMiss.prior === true, "receipts empty prior");
assert(Receipts.fnv1a("Kap") === Receipts.fnv1a("Kap"), "hash stable");
assert(Receipts.fnv1a("Kap") !== Receipts.fnv1a("Other"), "hash differs");

const stand = require("./dfs-standings-ingest.js");
const parsed = stand.parseStandingsCsv("Rank,Entry,Points\n1,Alice,100\n2,Bob,90\n", { week: 1, contestKey: "t1" });
assert(parsed.entries[0].entryHash, "standings hashes entry");
assert(parsed.schema === "dfs-standings-v1-phase1", "schema bump");

console.log(failed ? "\n" + failed + " failed" : "\nall passed");
process.exit(failed ? 1 : 0);
