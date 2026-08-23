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

   DOUBLE-PICK WEEKS are the same problem with more columns. A week that requires two
   picks is two SLOTS, and the assignment formulation already forbids a team from
   taking two slots when reuse is off — the distinct-team rule falls out of the
   assignment rather than being bolted on. `slotsPerWeek` carries that; absent, every
   week is one slot and the maths is bit-for-bit what it always was.
   ========================================================================== */
(function (root) {
"use strict";

const MAX_WEEKS = 18;
const MAX_TEAMS = 64;
const MAX_SLOTS_PER_WEEK = 4;   // no real pool asks for more; the cap bounds the matrix
/* ⚠️ BIG must dominate PER CELL, not per path. The Hungarian minimises a sum, so the
   only thing that matters is that swapping a BIG cell for any legal cell always lowers
   the total — i.e. BIG > the most expensive legal cell, which is -log(1e-6) = 13.8155.
   It is tempting to reason "a full path is ~19 slots so BIG must beat 19 × 1.6 = 30",
   and that comparison is not the binding one: a path's total cost is never weighed
   against a single BIG. test-survivor-path.js asserts the per-cell inequality instead
   of trusting either sentence. */
const BIG = 25;

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
  /* ⚠️ Slots are validated SEPARATELY and AFTER the caller-facing shape, on purpose.
     The distinct-weeks rule above is what stops a caller passing week 3 twice and
     silently getting a double-pick week it never asked for; weakening it so that
     "weeks" could carry duplicates would make the double-pick rule unstateable and
     the accidental-duplicate bug unreportable at the same time. A week appears once
     in `weeks` and says how many picks it wants in `slotsPerWeek`. */
  return {
    weeks: weeks.slice(), teams: teams.slice(), probabilities: matrix,
    reuse: input.reuse === true,
    slotCounts: validateSlots(weeks, input.slotsPerWeek),
  };
}

/* slotsPerWeek: { [week]: count }. Absent, or absent for a given week, means one pick —
   so every existing caller keeps the exact matrix it had before slots existed. */
function validateSlots(weeks, slotsPerWeek) {
  if (slotsPerWeek === null || slotsPerWeek === undefined) return weeks.map(() => 1);
  if (typeof slotsPerWeek !== "object" || Array.isArray(slotsPerWeek))
    throw new Error("slotsPerWeek must be an object keyed by week");
  for (const key of Object.keys(slotsPerWeek)) {
    const week = Number(key);
    if (!Number.isInteger(week) || week < 1 || week > 18)
      throw new Error("slotsPerWeek keys must be whole weeks from 1 to 18");
  }
  return weeks.map(week => {
    const raw = slotsPerWeek[week] !== undefined ? slotsPerWeek[week] : slotsPerWeek[String(week)];
    if (raw === undefined || raw === null) return 1;
    if (!Number.isInteger(raw) || raw < 1 || raw > MAX_SLOTS_PER_WEEK)
      throw new Error("slotsPerWeek for week " + week + " must be a whole number from 1 to " + MAX_SLOTS_PER_WEEK);
    return raw;
  });
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

/* ⚠️ `covered` COUNTS SLOTS, not weeks. With one pick a week those are the same number,
   which is why every pre-slots caller is unaffected; with a double-pick week they are
   not, and a "covered N of M" string built on weeks would under-report a half-filled
   double week as fully covered. `weeksCovered` and `slots` are alongside it so a
   consumer that genuinely wants weeks does not have to derive it — and the MCP payload
   names which one it is returning. */
function finish(input, assignments) {
  assignments.sort((a, b) => a.weekIndex - b.weekIndex || a.slotIndex - b.slotIndex
    || a.teamIndex - b.teamIndex);
  let logSurvival = 0;
  for (const pick of assignments) logSurvival += Math.log(pick.probability);
  const slots = input.slotCounts.reduce((sum, n) => sum + n, 0);
  return {
    weeks: input.weeks.slice(), assignments,
    survival: assignments.length ? Math.exp(logSurvival) : 0,
    covered: assignments.length,
    weeksCovered: new Set(assignments.map(a => a.week)).size,
    slots,
    slotsPerWeek: input.weeks.reduce((out, w, j) => { out[w] = input.slotCounts[j]; return out; }, {}),
    complete: assignments.length === slots,
    reuse: input.reuse,
  };
}

/* Expand weeks into slots: week index j appears slotCounts[j] times. One pick a week
   gives back exactly the old column order, so the cost matrix is unchanged. */
function expandSlots(input) {
  const weekOf = [], nth = [];
  for (let j = 0; j < input.weeks.length; j++)
    for (let k = 0; k < input.slotCounts[j]; k++) { weekOf.push(j); nth.push(k); }
  return { weekOf, nth };
}

function solvePath(rawInput) {
  const input = validateInput(rawInput);
  const R = input.teams.length;
  const { weekOf, nth } = expandSlots(input);
  const C = weekOf.length;

  if (input.reuse) {
    /* Reuse mode: weeks are independent, so each week just takes its best teams.
       ⚠️ With two slots that is the top TWO DISTINCT teams, not the best team twice.
       Nothing in this branch forbids a repeat — the assignment's distinct-team rule is
       what does that when reuse is off, and this branch never builds an assignment.
       Taking the top k distinct teams is both the fix and the exact optimum: within a
       week you need k different teams and the product is maximised by the k largest
       probabilities. (An earlier plan was to solve, detect a same-team collision, mark
       that cell impossible and re-solve in a bounded loop. That works, but it is a
       search for something this branch can read straight off a sort.) */
    const assignments = [];
    for (let j = 0; j < input.weeks.length; j++) {
      const ranked = [];
      for (let i = 0; i < R; i++) {
        const p = input.probabilities[i][j];
        if (p !== null) ranked.push({ i, p });
      }
      ranked.sort((a, b) => b.p - a.p || a.i - b.i);
      for (let k = 0; k < input.slotCounts[j] && k < ranked.length; k++) assignments.push({
        week: input.weeks[j], team: input.teams[ranked[k].i], probability: ranked[k].p,
        teamIndex: ranked[k].i, weekIndex: j, slotIndex: k,
      });
    }
    return finish(input, assignments);
  }

  const N = Math.max(R, C);
  const cost = Array.from({ length: N }, () => new Float64Array(N).fill(BIG));
  for (let i = 0; i < R; i++) for (let s = 0; s < C; s++) {
    const p = input.probabilities[i][weekOf[s]];
    if (p !== null) cost[i][s] = -Math.log(Math.max(p, 1e-6));
  }
  const assignment = hungarian(cost), picks = [];
  for (let i = 0; i < R; i++) {
    const s = assignment[i];
    if (s >= 0 && s < C && cost[i][s] < BIG) picks.push({
      week: input.weeks[weekOf[s]], team: input.teams[i],
      probability: input.probabilities[i][weekOf[s]],
      teamIndex: i, weekIndex: weekOf[s], slotIndex: nth[s],
    });
  }
  return finish(input, picks);
}

root.DDSurvivorPath = { MAX_WEEKS, MAX_TEAMS, MAX_SLOTS_PER_WEEK, BIG, hungarian, solvePath };

})(typeof module !== "undefined" && module.exports ? module.exports : (typeof self !== "undefined" ? self : this));
