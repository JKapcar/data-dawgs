const fs = require("fs");
const path = require("path");
const SurvivorPath = require("./survivor-path-engine.js").DDSurvivorPath;

let pass = 0, fail = 0;
function ok(condition, name) {
  if (condition) pass++;
  else { fail++; console.error("FAIL:", name); }
}
const close = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;

function bruteForce(weeks, teams, probabilities) {
  let best = 0;
  function visit(j, used, product) {
    if (j === weeks.length) { best = Math.max(best, product); return; }
    for (let i = 0; i < teams.length; i++) {
      const p = probabilities[i][j];
      if (used.has(i) || p === null) continue;
      used.add(i); visit(j + 1, used, product * p); used.delete(i);
    }
  }
  visit(0, new Set(), 1);
  return best;
}

const small = {
  weeks: [1, 2, 3], teams: ["A", "B", "C"],
  probabilities: [[0.8, 0.4, 0.5], [0.7, 0.9, 0.2], [0.6, 0.3, 0.95]],
};
const exact = SurvivorPath.solvePath(small);
ok(close(exact.survival, bruteForce(small.weeks, small.teams, small.probabilities)), "Hungarian result matches brute force");
ok(exact.complete && exact.covered === 3, "complete path reports all weeks");

const fixture = {
  weeks: [1, 2], teams: ["SEA", "ARI", "PIT", "CLE"],
  probabilities: [[0.8, 0.7], [0.2, 0.4], [0.55, 0.3], [0.45, 0.6]],
};
const ordinary = SurvivorPath.solvePath(fixture);
ok(close(ordinary.survival, 0.48), "fixture no-reuse path is 0.48");
ok(ordinary.assignments.some(x => x.week === 1 && x.team === "SEA") && ordinary.assignments.some(x => x.week === 2 && x.team === "CLE"), "fixture chooses SEA then CLE");

const withoutSea = SurvivorPath.solvePath({
  weeks: fixture.weeks, teams: fixture.teams.slice(1), probabilities: fixture.probabilities.slice(1),
});
ok(close(withoutSea.survival, 0.33), "used SEA leaves PIT then CLE at 0.33");

const reusable = SurvivorPath.solvePath({ ...fixture, reuse: true });
ok(close(reusable.survival, 0.56), "reuse path is 0.56");
ok(reusable.assignments.every(x => x.team === "SEA"), "reuse really allows the same team twice");

const incomplete = SurvivorPath.solvePath({
  weeks: [1, 2, 3], teams: fixture.teams,
  probabilities: fixture.probabilities.map(row => row.concat(null)),
});
ok(!incomplete.complete && incomplete.covered === 2 && close(incomplete.survival, 0.48), "missing week is explicit and preserves covered product");

for (const [name, input] of [
  ["duplicate weeks rejected", { weeks: [1, 1], teams: ["A"], probabilities: [[0.5, 0.5]] }],
  ["bad probability rejected", { weeks: [1], teams: ["A"], probabilities: [[1.1]] }],
  ["bad matrix rejected", { weeks: [1, 2], teams: ["A"], probabilities: [[0.5]] }],
]) {
  let threw = false;
  try { SurvivorPath.solvePath(input); } catch { threw = true; }
  ok(threw, name);
}

/* ===================== double-pick weeks (Stage B) =====================
   The gate is brute force, not a snapshot: enumerate every legal pick sequence for a
   small board with a double-pick week and confirm solvePath returns the max-product
   one. Both reuse settings, because they take completely different code paths — the
   Hungarian's distinct-team rule does the work when reuse is off, and nothing does
   when it is on, which is exactly where a same-team-twice-in-one-week bug lives. */
function bruteForceSlots(weeks, teams, probabilities, slotsPerWeek, reuse) {
  const slotWeek = [];
  weeks.forEach((w, j) => { for (let k = 0; k < (slotsPerWeek[w] || 1); k++) slotWeek.push(j); });
  let best = 0;
  function visit(s, usedAll, product) {
    if (s === slotWeek.length) { best = Math.max(best, product); return; }
    const j = slotWeek[s];
    for (let i = 0; i < teams.length; i++) {
      const p = probabilities[i][j];
      if (p === null) continue;
      // reuse off: a team is spent for the whole season. reuse on: only within a week.
      const key = reuse ? j + ":" + i : "*:" + i;
      if (usedAll.has(key)) continue;
      usedAll.add(key); visit(s + 1, usedAll, product * p); usedAll.delete(key);
    }
  }
  visit(0, new Set(), 1);
  return best;
}

const dp = {
  weeks: [1, 2, 3, 4],
  teams: ["A", "B", "C", "D", "E", "F"],
  probabilities: [
    [0.82, 0.41, 0.55, 0.30],
    [0.71, 0.90, 0.22, 0.64],
    [0.60, 0.33, 0.95, 0.48],
    [0.45, 0.77, 0.38, 0.81],
    [0.52, 0.68, 0.71, 0.29],
    [0.36, 0.59, 0.44, 0.66],
  ],
};
for (const reuse of [false, true]) {
  const slots = { 2: 2 };
  const got = SurvivorPath.solvePath({ ...dp, reuse, slotsPerWeek: slots });
  const want = bruteForceSlots(dp.weeks, dp.teams, dp.probabilities, slots, reuse);
  ok(close(got.survival, want, 1e-12), `double-pick week 2 is exactly optimal (reuse=${reuse})`);
  ok(got.slots === 5 && got.covered === 5 && got.complete,
     `double-pick fills 5 slots across 4 weeks (reuse=${reuse})`);
  ok(got.weeksCovered === 4, `weeksCovered still counts weeks, not slots (reuse=${reuse})`);
  const wk2 = got.assignments.filter(a => a.week === 2);
  ok(wk2.length === 2, `week 2 gets two picks (reuse=${reuse})`);
  ok(new Set(wk2.map(a => a.team)).size === 2,
     `week 2's two picks are DIFFERENT teams (reuse=${reuse})`);
}

// two double weeks at once — the ClevAnalytics shape (W9 + a late block)
{
  const slots = { 2: 2, 4: 2 };
  const got = SurvivorPath.solvePath({ ...dp, slotsPerWeek: slots });
  const want = bruteForceSlots(dp.weeks, dp.teams, dp.probabilities, slots, false);
  ok(close(got.survival, want, 1e-12), "two double-pick weeks are exactly optimal");
  ok(got.slots === 6 && got.covered === 6, "two double weeks ask for six slots");
}

// more slots than teams: report it, do not silently drop a week
{
  const tiny = { weeks: [1, 2], teams: ["A", "B"], probabilities: [[0.8, 0.7], [0.6, 0.5]] };
  const got = SurvivorPath.solvePath({ ...tiny, slotsPerWeek: { 1: 2, 2: 2 } });
  ok(got.slots === 4 && got.covered === 2 && !got.complete,
     "four slots and two teams is incomplete, not a crash", `${got.covered}/${got.slots}`);
}

// one slot per week is bit-for-bit the old behaviour
{
  const a = SurvivorPath.solvePath(small);
  const b = SurvivorPath.solvePath({ ...small, slotsPerWeek: { 1: 1, 2: 1, 3: 1 } });
  ok(a.survival === b.survival && a.covered === b.covered,
     "an explicit one-slot-per-week map changes nothing");
  ok(a.slots === 3 && a.complete, "slots defaults to one per week for pre-slots callers");
}

for (const [name, input] of [
  ["slot count of zero rejected", { ...small, slotsPerWeek: { 2: 0 } }],
  ["fractional slot count rejected", { ...small, slotsPerWeek: { 2: 1.5 } }],
  ["slot count past the cap rejected", { ...small, slotsPerWeek: { 2: 9 } }],
  ["slot key outside 1-18 rejected", { ...small, slotsPerWeek: { 0: 2 } }],
  ["array slotsPerWeek rejected", { ...small, slotsPerWeek: [1, 2, 1] }],
]) {
  let threw = false;
  try { SurvivorPath.solvePath(input); } catch { threw = true; }
  ok(threw, name);
}
// ⚠️ and the caller-facing distinct-weeks rule is NOT relaxed by slots existing
{
  let threw = false;
  try { SurvivorPath.solvePath({ weeks: [1, 1], teams: ["A"], probabilities: [[0.5, 0.5]], slotsPerWeek: { 1: 1 } }); }
  catch { threw = true; }
  ok(threw, "duplicate weeks are still rejected — a double week is slots, not a repeat");
}

/* ⚠️ BIG dominance, asserted rather than argued. What matters is per-cell: swapping an
   impossible cell for any legal one must always lower the total. The most expensive
   legal cell is -log(1e-6). */
ok(SurvivorPath.BIG > -Math.log(1e-6),
   "BIG dominates the most expensive legal cell", `${SurvivorPath.BIG} vs ${-Math.log(1e-6)}`);

const html = fs.readFileSync(path.join(__dirname, "..", "survivor.html"), "utf8");
const source = fs.readFileSync(path.join(__dirname, "survivor-path-engine.js"), "utf8").trim();
const startMarker = "/* ===== DD-SURVIVOR-PATH-ENGINE START — generated from work/survivor-path-engine.js; edit THERE ===== */";
const endMarker = "/* ===== DD-SURVIVOR-PATH-ENGINE END ===== */";
const start = html.indexOf(startMarker), end = html.indexOf(endMarker);
const inlined = html.slice(start + startMarker.length, end).trim();
ok(start >= 0 && end > start && inlined === source, "browser inline engine is exact shared source");

console.log(`survivor path: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
