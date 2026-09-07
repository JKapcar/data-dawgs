#!/usr/bin/env node
"use strict";
/**
 * Phase 0.5 T2 — Auto-load on open.
 * Fixture lobby: Wed showdown + Thu showdown + Sun classic main.
 */
const assert = require("assert");
const api = require("./dfs-autoload.js");

let failed = 0;
function ok(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}

// --- Fixture lobby: Wed SD + Thu SD + Sun classic (main + satellite) ---
// Times are ISO Z that land on the intended ET wall-clock.
// Wed 2026-09-09 20:20 ET = 2026-09-10T00:20:00Z
// Thu 2026-09-10 20:15 ET = 2026-09-11T00:15:00Z
// Sun 2026-09-13 13:00 ET = 2026-09-13T17:00:00Z (EDT)
const FIXTURE = {
  DraftGroups: [
    {
      DraftGroupId: 90001,
      ContestTypeId: 96,
      GameCount: 1,
      StartDate: "2026-09-10T00:20:00.0000000Z",
      StartDateEst: "2026-09-09T20:20:00.0000000",
      DraftGroupTag: "Featured",
      StartTimeSuffix: " (NE @ SEA)",
      Sport: "NFL"
    },
    {
      DraftGroupId: 90002,
      ContestTypeId: 96,
      GameCount: 1,
      StartDate: "2026-09-11T00:15:00.0000000Z",
      StartDateEst: "2026-09-10T20:15:00.0000000",
      DraftGroupTag: "Featured",
      StartTimeSuffix: " (DAL @ NYG)",
      Sport: "NFL"
    },
    {
      DraftGroupId: 90010,
      ContestTypeId: 21,
      GameCount: 12,
      StartDate: "2026-09-13T17:00:00.0000000Z",
      StartDateEst: "2026-09-13T13:00:00.0000000",
      DraftGroupTag: "Featured",
      Sport: "NFL"
    },
    {
      // Same Sunday 1pm slot, fewer games — must lose to 90010
      DraftGroupId: 90011,
      ContestTypeId: 21,
      GameCount: 8,
      StartDate: "2026-09-13T17:00:00.0000000Z",
      StartDateEst: "2026-09-13T13:00:00.0000000",
      DraftGroupTag: "",
      Sport: "NFL"
    },
    {
      // Classic but not Sunday 1pm (Wed-Mon early) — not "main"
      DraftGroupId: 90012,
      ContestTypeId: 21,
      GameCount: 16,
      StartDate: "2026-09-10T00:20:00.0000000Z",
      StartDateEst: "2026-09-09T20:20:00.0000000",
      ContestStartTimeSuffix: " (Wed-Mon)",
      Sport: "NFL"
    },
    {
      // Irrelevant contest type
      DraftGroupId: 99999,
      ContestTypeId: 145,
      GameCount: 16,
      StartDate: "2026-09-13T17:00:00.0000000Z",
      Sport: "NFL"
    }
  ]
};

// "now" = Tuesday before the Wed showdown
const NOW = Date.parse("2026-09-08T15:00:00Z");

ok(api.isSundayMainSlotEt(Date.parse("2026-09-13T17:00:00Z")), "Sun 1pm ET detected via 17:00Z");
ok(!api.isSundayMainSlotEt(Date.parse("2026-09-10T00:20:00Z")), "Wed night is not Sunday main");

const picked = api.pickAutoloadTargets(FIXTURE, NOW);
ok(picked.showdown && picked.showdown.draftGroupId === 90001, "next-locking showdown is Wed (90001), not Thu");
ok(picked.classicMain && picked.classicMain.draftGroupId === 90010, "classic main = largest GameCount at earliest Sun 1pm (90010)");
ok(picked.classicMain.gameCount === 12, "classic main has 12 games");
ok(picked.primary && picked.primary.draftGroupId === 90001, "primary locks first = Wed showdown");
ok(picked.alternate && picked.alternate.draftGroupId === 90010, "alternate = Sun classic main (T1 switch hook)");
ok(picked.switchTarget === picked.alternate, "switchTarget aliases alternate for T1");

// After Wed locks, next showdown is Thu
const afterWed = Date.parse("2026-09-10T02:00:00Z");
const picked2 = api.pickAutoloadTargets(FIXTURE, afterWed);
ok(picked2.showdown && picked2.showdown.draftGroupId === 90002, "after Wed lock, next showdown is Thu");
ok(picked2.primary && picked2.primary.draftGroupId === 90002, "primary becomes Thu showdown");

// --- Stale on failure (meta helper) ---
const staleMeta = api.slateMeta({
  source: "toto",
  draftGroupId: 90001,
  loadedAt: "2026-09-08T12:00:00.000Z",
  stale: true
});
ok(staleMeta.stale === true, "stale=true on fetch failure meta");
ok(staleMeta.source === "toto" && staleMeta.draftGroupId === 90001, "last-good meta kept");
ok(staleMeta.loadedAt === "2026-09-08T12:00:00.000Z", "loadedAt preserved on stale mark");

// --- Projections survive same-group reload; dropped on different group ---
const prev = [
  { name: "A", playerDkId: "111", dkId: "d1", proj: 18.5, own: 12 },
  { name: "B", playerDkId: "222", dkId: "d2", proj: 14.0, own: 8 },
  { name: "C", playerDkId: "333", dkId: "d3", proj: null, own: 0 }
];
const nextSame = [
  { name: "A", playerDkId: "111", dkId: "d1", proj: null, own: 0 },
  { name: "B", playerDkId: "222", dkId: "d2", proj: null, own: 0 },
  { name: "D", playerDkId: "444", dkId: "d4", proj: null, own: 0 }
];
const same = api.carryProjections(prev, nextSame, { sameGroup: true });
ok(same.carried === 2, "same-group reload carries 2 projections by DK player id");
ok(same.players[0].proj === 18.5 && same.players[0].own === 12, "player A proj/own survived");
ok(same.players[1].proj === 14.0, "player B proj survived");
ok(same.players[2].proj == null, "new player D has no proj");
ok(!same.notice || same.notice.indexOf("Kept") >= 0, "same-group notice mentions Kept");

const nextDiff = [
  { name: "A", playerDkId: "111", dkId: "x1", proj: null, own: 0 },
  { name: "B", playerDkId: "222", dkId: "x2", proj: null, own: 0 }
];
const diff = api.carryProjections(prev, nextDiff, { sameGroup: false });
ok(diff.carried === 0 && diff.dropped === 2, "different group drops projections");
ok(diff.players.every(p => p.proj == null && p.own === 0), "diff-group pool has no proj/own");
ok(/cleared|previous draft group/i.test(diff.notice || ""), "visible notice when projections dropped");

// Never auto-load demo — module has no demo path
ok(typeof api.demoSlate !== "function" && typeof api.loadDemo !== "function", "no demo auto-load API");

console.log(failed ? "\n" + failed + " failed" : "\nall passed");
process.exit(failed ? 1 : 0);
