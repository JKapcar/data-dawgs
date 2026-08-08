/* ============================================================================
   Survivor path engine — bounded exact assignment over weekly win probabilities.

   Pure computation. No DOM, network, storage or randomness. Loaded three ways:
     1. Node, for correctness and parity tests
     2. inlined into survivor.html for the human path board
     3. injected into the Cloudflare Worker under a private root for MCP

   The ordinary survivor rule is one distinct team per week. That is a rectangular
   maximum-product assignment, solved as minimum -log(probability) with Hungarian.
   If a pool explicitly allows reuse, each week is independent and the exact solution
   is simply that week's highest-probability team; the same team may appear repeatedly.
   ========================================================================== */
(function (root) {
"use strict";

const MAX_WEEKS = 18;
const MAX_TEAMS = 64;
const BIG = 25; // impossible cell; -log(1e-6) is only 13.82

function finiteProbability(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Error((label || "probability") + " must be null or a finite number from 0 to 1");
  return value;
}

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("path input must be an object");
  const weeks = input.weeks, teams = input.teams, probabilities = input.probabilities;
  if (!Array.isArray(weeks) || !weeks.length || weeks.length > MAX_WEEKS)
    throw new Error("weeks must contain 1-" + MAX_WEEKS + " entries");
  if (!weeks.every(w => Number.isInteger(w) && w >= 1 && w <= 18) || new Set(weeks).size !== weeks.length)
    throw new Error("weeks must be unique whole numbers from 1 to 18");
  if (!Array.isArray(teams) || !teams.length || teams.length > MAX_TEAMS)
    throw new Error("teams must contain 1-" + MAX_TEAMS + " entries");
  if (!teams.every(t => typeof t === "string" && t.length > 0 && t.length <= 20) || new Set(teams).size !== teams.length)
    throw new Error("teams must be unique non-empty strings of at most 20 characters");
  if (!Array.isArray(probabilities) || probabilities.length !== teams.length)
    throw new Error("probabilities must have one row per team");
  const matrix = probabilities.map((row, i) => {
    if (!Array.isArray(row) || row.length !== weeks.length)
      throw new Error("probabilities row " + (i + 1) + " must have one cell per week");
    return row.map((p, j) => finiteProbability(p, "probability for " + teams[i] + " week " + weeks[j]));
  });
  return { weeks: weeks.slice(), teams: teams.slice(), probabilities: matrix, reuse: input.reuse === true };
}

function hungarian(cost) { // square matrix, minimizes
  if (!Array.isArray(cost)) throw new Error("cost must be a square matrix");
  const n = cost.length, INF = 1e18;
  if (!n) return new Int32Array(0);
  if (!cost.every(row => row && row.length === n)) throw new Error("cost must be a square matrix");
  const u = new Float64Array(n + 1), v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1), way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const minv = new Float64Array(n + 1).fill(INF);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1; const i0 = p[j0]; let delta = INF, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cell = cost[i0 - 1][j - 1];
        if (typeof cell !== "number" || !Number.isFinite(cell)) throw new Error("cost cells must be finite numbers");
        const cur = cell - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const result = new Int32Array(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] > 0) result[p[j] - 1] = j - 1;
  return result; // result[row] = column
}

function finish(input, assignments) {
  assignments.sort((a, b) => a.weekIndex - b.weekIndex || a.teamIndex - b.teamIndex);
  let logSurvival = 0;
  for (const pick of assignments) logSurvival += Math.log(pick.probability);
  return {
    weeks: input.weeks.slice(), assignments,
    survival: assignments.length ? Math.exp(logSurvival) : 0,
    covered: assignments.length,
    complete: assignments.length === input.weeks.length,
    reuse: input.reuse,
  };
}

function solvePath(rawInput) {
  const input = validateInput(rawInput);
  const R = input.teams.length, C = input.weeks.length;
  if (input.reuse) {
    const assignments = [];
    for (let j = 0; j < C; j++) {
      let best = -1, bestP = -1;
      for (let i = 0; i < R; i++) {
        const p = input.probabilities[i][j];
        if (p !== null && p > bestP) { best = i; bestP = p; }
      }
      if (best >= 0) assignments.push({
        week: input.weeks[j], team: input.teams[best], probability: bestP,
        teamIndex: best, weekIndex: j,
      });
    }
    return finish(input, assignments);
  }

  const N = Math.max(R, C);
  const cost = Array.from({ length: N }, () => new Float64Array(N).fill(BIG));
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    const p = input.probabilities[i][j];
    if (p !== null) cost[i][j] = -Math.log(Math.max(p, 1e-6));
  }
  const assignment = hungarian(cost), picks = [];
  for (let i = 0; i < R; i++) {
    const j = assignment[i];
    if (j >= 0 && j < C && cost[i][j] < BIG) picks.push({
      week: input.weeks[j], team: input.teams[i], probability: input.probabilities[i][j],
      teamIndex: i, weekIndex: j,
    });
  }
  return finish(input, picks);
}

root.DDSurvivorPath = { MAX_WEEKS, MAX_TEAMS, hungarian, solvePath };

})(typeof module !== "undefined" && module.exports ? module.exports : (typeof self !== "undefined" ? self : this));
