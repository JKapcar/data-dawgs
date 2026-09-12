#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const lobbyApi = require("./dfs-screener-lobby.js");
const screener = require("./dfs-contest-screener.js");

const root = path.join(__dirname, "..", "tests", "fixtures");
let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}

const rawLobby = JSON.parse(fs.readFileSync(path.join(root, "dk-contests-nfl-sample.json"), "utf8"));
const rawRows = rawLobby.Contests || [];
assert(rawRows.length >= 3, "fixture has lobby contests");

const mapped = rawRows.map(lobbyApi.mapDkLobbyContestRow);
assert(mapped.every(r => r.id && r.name && r.entryFee >= 0 && r.prizePool >= 0), "mapper fills id/name/fees");
assert(mapped.every(r => r.maxEntries > 0 && r.maxEntriesPerUser >= 1), "mapper fills caps");
assert(mapped[0].draftGroupId === 151307 || mapped.every(r => r.draftGroupId), "draftGroupId mapped from dg");

const keysObserved = Object.keys(rawRows[0]).sort();
console.log("raw contest keys observed:", keysObserved.join(", "));

const detail = JSON.parse(fs.readFileSync(path.join(root, "dk-contest-detail-sample.json"), "utf8"));
const tiers = lobbyApi.mapDkContestPayoutTiers(detail.contestDetail);
assert(tiers.length >= 3, "detail yields payout tiers");
assert(tiers[0].fromPlace === 1 && tiers[0].prize > 0, "first tier is place 1");

const top = lobbyApi.topByPrizePool(mapped, 5);
assert(top.length === 5, "top N=5");
assert(top[0].prizePool >= top[4].prizePool, "sorted by prize pool desc");

const scoreIn = lobbyApi.toScoreContestInput(top[0], { payout: tiers, entryFee: top[0].entryFee, prizePool: top[0].prizePool, maxEntries: top[0].maxEntries, maxEntriesPerUser: top[0].maxEntriesPerUser });
assert(scoreIn.firstPrize === scoreIn.first && scoreIn.tenthPrize === scoreIn.tenth, "first/tenth aliases");
assert(scoreIn.first > 0, "first prize from tier");
assert(typeof scoreIn.rake === "number" && isFinite(scoreIn.rake), "rake computed");

const expectedRake = 1 - scoreIn.prizePool / (scoreIn.buyIn * scoreIn.fieldCap);
assert(Math.abs(scoreIn.rake - expectedRake) < 0.005, "rake within ±0.5% abs (" + scoreIn.rake + " vs " + expectedRake + ")");
// also percent-points check
assert(Math.abs((scoreIn.rake - expectedRake) * 100) <= 0.5, "rake ±0.5 percentage points");

const scored = screener.scoreContest(scoreIn);
assert(scored && scored.verdict, "scoreContest accepts mapper output: " + scored.verdict);

// no place-10 → tenth=0 → Avoid on tenth band
const noTenthTiers = [
  { fromPlace: 1, toPlace: 1, prize: 1000 },
  { fromPlace: 2, toPlace: 5, prize: 100 }
];
const no10 = lobbyApi.toScoreContestInput({
  name: "Tiny payout board",
  gameType: "Classic",
  entryFee: 10,
  maxEntries: 100,
  maxEntriesPerUser: 1,
  prizePool: 850,
  entries: 50
}, noTenthTiers);
assert(no10.tenth === 0 && no10.tenthPrize === 0, "missing place-10 → tenth=0");
const scoredNo10 = screener.scoreContest(no10);
assert(scoredNo10.bands.tenth === "avoid", "no place-10 → tenth band Avoid");
assert(scoredNo10.verdict === "avoid", "no place-10 → overall Avoid");

assert(lobbyApi.fallback404Message().indexOf("toto update") >= 0, "404 fallback message builder");
assert(lobbyApi.isRouteMissing(404, {}), "404 status is route missing");
assert(!lobbyApi.isRouteMissing(502, { error: "dk_contests_failed" }), "502 upstream is not route-missing");

console.log(failed ? "\n" + failed + " failed" : "\nall passed");
process.exit(failed ? 1 : 0);
