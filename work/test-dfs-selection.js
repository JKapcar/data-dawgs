#!/usr/bin/env node
/**
 * T4 · Selection key — Bible §3.4 / I4 / B5.
 * Synthetic 20-lineup set: ROI order vs evAdj order must disagree by ≥3 positions;
 * top10 ≥ top1; evAdj ≤ raw EV when E[dupes] > 0; dfs.html #ddfsEngine == work/dfs-engine.js.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const D = require("./dfs-engine.js").DDFS;
const mk = require("./mkslate.js");

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}

function rankBy(arr, key) {
  return arr
    .map((r, i) => ({ i, v: r[key] }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .map((x) => x.i);
}

function kendallPositions(orderA, orderB) {
  // max absolute rank displacement between the two orderings
  const posA = {}, posB = {};
  orderA.forEach((id, p) => { posA[id] = p; });
  orderB.forEach((id, p) => { posB[id] = p; });
  let max = 0;
  for (const id of orderA) {
    const d = Math.abs(posA[id] - posB[id]);
    if (d > max) max = d;
  }
  return max;
}

// --- engine restamp equality (H2) ---
{
  const root = path.resolve(__dirname, "..");
  const engine = fs.readFileSync(path.join(root, "work/dfs-engine.js"), "utf8").trim();
  const html = fs.readFileSync(path.join(root, "dfs.html"), "utf8");
  const open = '<script type="text/plain" id="ddfsEngine">';
  const a = html.indexOf(open) + open.length;
  const b = html.indexOf("</script>", a);
  const block = html.slice(a, b).trim();
  assert(block === engine, "dfs.html #ddfsEngine byte-equals work/dfs-engine.js");
}

// --- build a 20-lineup pool on a synthetic slate ---
const P = mk(13).map((p) => ({ ...p }));
const posTot = {};
P.forEach((p) => {
  p.val = p.proj / (p.sal / 1000);
  posTot[p.pos] = (posTot[p.pos] || 0) + Math.pow(p.val, 3);
});
const slots = { QB: 100, RB: 200, WR: 300, TE: 100, DST: 100 };
P.forEach((p) => {
  p.own = +(Math.pow(p.val, 3) / posTot[p.pos] * slots[p.pos]).toFixed(2);
  if (p.own > 45) p.own = 45;
  if (p.own < 0.5) p.own = 0.5;
});

const sol = D.solveLineups(P, {
  site: "dk_classic", count: 20, uniques: 2, randomness: 0.25,
  minSalary: 49000, maxPerTeam: 4,
  stack: { qbMin: 1, qbPos: ["WR", "TE"] },
  timeLimitMs: 90000, seed: 42
});
assert(sol.lineups.length >= 20, "solved ≥20 lineups (got " + sol.lineups.length + ")");
const L20 = sol.lineups.slice(0, 20).map((l, i) => {
  // Chalky (high cumulative own) → huge E[dupes]; rare → near-zero.
  // Forces ROI order ≠ evAdj order: high-sim-ROI chalk gets crushed by the divisor.
  const cumOwn = l.ids.reduce((t, id) => t + (P[id].own || 0), 0);
  const eDupes = Math.pow(cumOwn / 70, 5) * 80; // ~0 for rare, >>1 for chalk
  return { ids: l.ids, cpt: l.cpt, proj: l.proj, eDupes };
});

const fee = 20;
// fieldSize 201 + fieldSample 200 => full modelled field (engine v2).
// Literal top-10 ⊇ top-1% (top1 cutoff = floor(201*0.01)=2) so top10≥top1.
const r = D.simulate(P, L20, {
  sims: 3000, fieldSample: 200, fieldSize: 201,
  entryFee: fee, seed: 99,
  payout: { kind: "param", paidFrac: 0.2, alpha: 1.15, rake: 0.15 }
});

assert(r.perLineup.length === 20, "20 perLineup rows");

// metrics present
for (const row of r.perLineup) {
  assert(typeof row.top10 === "number" && row.top10 >= 0 && row.top10 <= 1, "top10 in [0,1] for i=" + row.i);
  assert(typeof row.top1 === "number", "top1 present i=" + row.i);
  assert(typeof row.evAdj === "number", "evAdj present i=" + row.i);
  assert(typeof row.roi === "number" && typeof row.cash === "number" && typeof row.win === "number", "keep roi/cash/win i=" + row.i);
  assert(typeof row.mean === "number" && typeof row.meanRank === "number", "keep mean/meanRank i=" + row.i);
  // B5 / I4: top-10 contains top-1%
  assert(row.top10 + 1e-12 >= row.top1, "top10≥top1 i=" + row.i + " (" + row.top10 + " vs " + row.top1 + ")");
  // §3.4: when E[dupes]>0, adjusted EV ≤ raw EV
  const ed = L20[row.i].eDupes;
  if (ed > 0) {
    assert(row.evAdj <= row.ev + 1e-9,
      "evAdj≤ev when eDupes>0 i=" + row.i + " evAdj=" + row.evAdj + " ev=" + row.ev + " ed=" + ed);
    // and matches E[prize]/(1+E[dupes]) within float noise
    const expected = row.ev / (1 + ed);
    assert(Math.abs(row.evAdj - expected) < 1e-6,
      "evAdj ≈ ev/(1+eDupes) i=" + row.i + " got " + row.evAdj + " want " + expected);
  }
}

const byRoi = rankBy(r.perLineup, "roi");
const byEv = rankBy(r.perLineup, "evAdj");
const shift = kendallPositions(byRoi, byEv);
assert(shift >= 3,
  "ROI order vs evAdj order differ by ≥3 positions (max shift=" + shift + ")");
console.log("  (max rank displacement ROI↔evAdj =", shift + ")");

// default selection sort: evAdj desc, tiebreak top10 desc
const sel = r.perLineup.slice().sort((a, b) => {
  const d = (b.evAdj || 0) - (a.evAdj || 0);
  return d !== 0 ? d : (b.top10 || 0) - (a.top10 || 0);
});
assert(sel[0].evAdj >= sel[sel.length - 1].evAdj, "selection sort places highest evAdj first");

if (failed) {
  console.error("\n" + failed + " failure(s)");
  process.exit(1);
}
console.log("\nall selection-key checks passed");
