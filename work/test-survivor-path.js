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

const html = fs.readFileSync(path.join(__dirname, "..", "survivor.html"), "utf8");
const source = fs.readFileSync(path.join(__dirname, "survivor-path-engine.js"), "utf8").trim();
const startMarker = "/* ===== DD-SURVIVOR-PATH-ENGINE START — generated from work/survivor-path-engine.js; edit THERE ===== */";
const endMarker = "/* ===== DD-SURVIVOR-PATH-ENGINE END ===== */";
const start = html.indexOf(startMarker), end = html.indexOf(endMarker);
const inlined = html.slice(start + startMarker.length, end).trim();
ok(start >= 0 && end > start && inlined === source, "browser inline engine is exact shared source");

console.log(`survivor path: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
