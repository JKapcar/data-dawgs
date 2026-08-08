/* ============================================================================
   DFS engine — exact lineup solver + correlated contest simulator.

   Pure computation. No DOM. Loaded three ways:
     1. node, for the benchmark + tests in the build dir
     2. inlined into dfs.html as a Blob-URL Web Worker (keeps the page self-contained)
     3. inlined into dfs.html on the main thread if Worker/Blob is unavailable

   ⚠️ Everything here consumes projections the USER supplies. The engine has no opinion
   about how good a player is and never invents a number. A missing projection is a
   missing player, not a zero.
   ========================================================================== */
(function (root) {
"use strict";

/* ---------------------------------------------------------------- constants */

const POS = ["QB", "RB", "WR", "TE", "DST"];

const SITES = {
  dk_classic: {
    key: "dk_classic", label: "DraftKings · Classic", cap: 50000, size: 9,
    // FLEX is resolved by enumerating the three legal position splits rather than
    // carrying a wildcard slot — a wildcard slot generates the same lineup up to
    // three times and de-duplicating after the fact costs more than not making them.
    patterns: [
      { QB: 1, RB: 3, WR: 3, TE: 1, DST: 1 },
      { QB: 1, RB: 2, WR: 4, TE: 1, DST: 1 },
      { QB: 1, RB: 2, WR: 3, TE: 2, DST: 1 }
    ],
    minGames: 2,          // DK requires two different games on a classic slate
    showdown: false
  },
  dk_showdown: {
    key: "dk_showdown", label: "DraftKings · Showdown Captain Mode", cap: 50000, size: 6,
    patterns: null, minTeams: 2, cptMult: 1.5, cptSalMult: 1.5, showdown: true
  }
};

const SAL_STEP = 100;     // DK salaries are multiples of 100 — the DP bound rides on this

/* ------------------------------------------------------------------ helpers */

// Mulberry32 — seeded, so a run is reproducible and so is any bug in it.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ============================================================================
   SOLVER

   Branch and bound over slots, one position group at a time, players inside a
   group visited in projection order with a strictly increasing index so a set is
   only ever generated once.

   ⚠️ The whole thing lives or dies on the bound. A first cut used "sum of the top
   k projections still available", which ignores salary — with a salary floor of
   $49,000 that bound never fires and a single main-slate solve did not finish in
   two minutes. The bound below is a real salary-aware DP relaxation:

     SUF[gi][k][b] = the most projection obtainable by taking k more players from
                     group gi PLUS the full requirement from every later group,
                     spending at most b.

   Built by knapsack per group then a (max,+) convolution backwards through the
   groups. It ignores the increasing-index rule and lets a group re-pick a player
   already taken, so it is a genuine upper bound — just a tight one.
   ========================================================================== */

/**
 * players: [{pos, team, opp, gid, sal, proj, lock, excl, maxExp}]  (array index = id)
 * cfg: { site, count, minSalary, maxSalary, uniques, randomness, seed,
 *        maxPerTeam, maxPerGame, timeLimitMs,
 *        stack:{qbMin, qbPos, bringBack, noRbVsDst, noOppDst},
 *        groups:[{mode:"atMost"|"atLeast"|"exactly", n, ids:[]}] }
 */
function solveLineups(players, cfg, onProgress) {
  const site = SITES[cfg.site] || SITES.dk_classic;
  return site.showdown ? solveShowdown(players, cfg, site, onProgress)
                       : solveClassic(players, cfg, site, onProgress);
}

function activePool(players, cfg, expCount, made) {
  // Excluded, or already at the exposure cap, means the player is simply absent from
  // this solve. That is exact — no penalty term, no soft nudge.
  const out = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p.excl) continue;
    if (!(p.proj > 0) && !p.lock) continue;
    if (!p.lock && p.maxExp != null && made > 0 && expCount[i] / made >= p.maxExp - 1e-9) continue;
    out.push(i);
  }
  return out;
}

/* ---- per-group DP tables, rebuilt whenever the pool or the projections move ---- */

/* Rows are stored windowed: {a, lo, hi}. `a` is indexed by absolute salary bucket but
   only [lo..hi] is meaningful — below lo the row is -Infinity (cannot be afforded),
   above hi it is flat at a[hi] (money left over buys nothing more). Windowing is not a
   micro-optimisation: full 0..500 convolutions made the DP rebuild, not the tree search,
   the dominant cost of a solve. A QB slot spans ~30 buckets, not 501. */
function rowGet(r, b) { return b < r.lo ? -Infinity : r.a[b > r.hi ? r.hi : b]; }

// exact-k knapsack over one group: best proj taking exactly k, salary <= b*100
function groupKnap(ids, players, proj, kMax, B) {
  const raw = [];
  for (let k = 0; k <= kMax; k++) raw.push(new Float64Array(B + 1).fill(k === 0 ? 0 : -Infinity));
  const sals = ids.map(id => (players[id].sal / SAL_STEP) | 0).sort((x, y) => x - y);
  for (const id of ids) {
    const s = (players[id].sal / SAL_STEP) | 0, v = proj[id];
    for (let k = kMax; k >= 1; k--) {
      const cur = raw[k], prev = raw[k - 1];
      for (let b = B; b >= s; b--) {
        const alt = prev[b - s] + v;
        if (alt > cur[b]) cur[b] = alt;
      }
    }
  }
  const K = [];
  for (let k = 0; k <= kMax; k++) {
    const r = raw[k];
    for (let b = 1; b <= B; b++) if (r[b - 1] > r[b]) r[b] = r[b - 1];
    let lo = 0, hi = 0;
    for (let j = 0; j < k; j++) lo += sals[j];
    for (let j = 0; j < k; j++) hi += sals[sals.length - 1 - j];
    if (lo > B) { K.push({ a: r, lo: B + 1, hi: B }); continue; }
    if (hi > B) hi = B;
    K.push({ a: r, lo, hi });
  }
  return K;
}

// windowed (max,+) convolution: out[b] = max_s A[s] + C[b-s]
function maxPlusConv(A, C, B) {
  const out = new Float64Array(B + 1).fill(-Infinity);
  const lo = A.lo + C.lo, hiRaw = A.hi + C.hi;
  const hi = hiRaw > B ? B : hiRaw;
  if (lo > B) return { a: out, lo: B + 1, hi: B };
  for (let s = A.lo; s <= A.hi; s++) {
    const a = A.a[s];
    if (a === -Infinity) continue;
    const bEnd = Math.min(B, s + C.hi);
    for (let b = s + C.lo; b <= bEnd; b++) {
      const alt = a + C.a[b - s];
      if (alt > out[b]) out[b] = alt;
    }
  }
  for (let b = lo + 1; b <= hi; b++) if (out[b - 1] > out[b]) out[b] = out[b - 1];
  return { a: out, lo, hi };
}

function solveClassic(players, cfg, site, onProgress) {
  const N = players.length;
  const count = Math.max(1, cfg.count | 0);
  const cap = Math.min(cfg.maxSalary || site.cap, site.cap);
  const floor = cfg.minSalary || 0;
  const uniques = Math.max(0, cfg.uniques | 0);
  const maxOverlap = site.size - uniques;
  const stack = cfg.stack || {};
  const rand = rng(cfg.seed || 1);
  const noise = cfg.randomness || 0;
  // ⚠️ Always have a deadline. An impossible constraint set (a salary window no roster can
  // hit, say) has no solution to prune toward, so the search enumerates the whole tree and
  // a caller that forgot a limit would simply hang.
  const deadline = Date.now() + (cfg.timeLimitMs || 120000);

  const expCount = new Int32Array(N);
  const acceptedSets = [];               // Uint8Array membership per accepted lineup
  const inLineups = [];                  // id -> [accepted lineup indexes]  (sparse)
  for (let i = 0; i < N; i++) inLineups.push([]);
  const out = [];
  let infeasible = null, timedOut = false;

  for (let n = 0; n < count; n++) {
    if (Date.now() > deadline) { timedOut = true; break; }
    // Projections are re-drawn per lineup when randomness is on. That is what turns a
    // pool into a portfolio instead of N near-copies of one opinion.
    const proj = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const base = players[i].proj || 0;
      proj[i] = noise > 0 ? Math.max(0, base * (1 + noise * gauss(rand))) : base;
    }
    const pool = activePool(players, cfg, expCount, n);
    const res = bestClassic(players, proj, pool, cfg, site, cap, floor,
                            acceptedSets, inLineups, maxOverlap, stack, deadline);
    if (res && !res.ids) { timedOut = true; break; }   // deadline hit mid-search
    if (!res) { infeasible = n === 0 ? "no lineup satisfies these constraints"
                                     : "ran out of lineups that meet the uniqueness rule"; break; }
    if (res.aborted) timedOut = true;

    const set = new Uint8Array(N);
    for (const id of res.ids) { set[id] = 1; expCount[id]++; inLineups[id].push(acceptedSets.length); }
    acceptedSets.push(set);
    // Report the TRUE projection of the lineup, never the perturbed one used to find it.
    let trueProj = 0; for (const id of res.ids) trueProj += players[id].proj || 0;
    out.push({ ids: res.ids.slice().sort((a, b) => POS.indexOf(players[a].pos) - POS.indexOf(players[b].pos)),
               proj: trueProj, drawnProj: res.proj, sal: res.sal });
    if (onProgress && (n % 5 === 0 || n === count - 1)) onProgress(n + 1, count);
  }
  return { lineups: out, infeasible, timedOut, exposure: expCount };
}

function bestClassic(players, proj, pool, cfg, site, cap, floor,
                     acceptedSets, inLineups, maxOverlap, stack, deadline) {
  const B = (cap / SAL_STEP) | 0;
  const byPos = {}; for (const p of POS) byPos[p] = [];
  const locks = [];
  for (const id of pool) {
    const p = players[id];
    if (byPos[p.pos]) byPos[p.pos].push(id);
    if (p.lock) locks.push(id);
  }
  for (const p of POS) byPos[p].sort((a, b) => proj[b] - proj[a]);

  let best = null, bestVal = -1;
  const nAcc = acceptedSets.length;
  const overlap = new Int32Array(nAcc);
  let nodes = 0;
  // ⚠️ A deadline has to LATCH. Returning from only the one frame that happened to notice
  // the clock leaves the rest of the tree to be explored normally, so the "time limit"
  // merely slowed the search instead of ending it — an impossible constraint set still ran
  // for minutes. `aborted` is checked at the top of every node, which is cheap; the clock
  // is read once every 1,024 nodes, which is not.
  let aborted = false;

  const qbPosArr = stack.qbPos && stack.qbPos.length ? stack.qbPos : ["WR", "TE"];
  const stacking = (stack.qbMin || 0) > 0 || (stack.bringBack || 0) > 0;

  for (const pat of site.patterns) {
    // Group order matters a lot. Default: small, heavily constrained groups first, so
    // the tree narrows at the top.
    // ⚠️ When a QB stack is required that order is exactly wrong. The DP bound knows
    // nothing about stacking, so it stays optimistic all the way down; the only thing
    // that can cut a stackless subtree is the stack constraint itself, and that cannot
    // fire until the groups the stack partners live in have been visited. Leaving WR
    // last took a 150-lineup stacked run from 2s to over 60s. Pass-catchers first.
    const order = stacking ? ["QB", "TE", "WR", "RB", "DST"]
                           : ["QB", "DST", "TE", "RB", "WR"];
    const need = order.map(g => pat[g]);
    const grp = order.map(g => byPos[g]);
    const G = order.length;
    if (grp.some((g, i) => g.length < need[i])) continue;

    // Locks have to fit this pattern or the pattern cannot produce a lineup at all.
    const lockNeed = order.map(() => 0);
    let ok = true;
    for (const id of locks) {
      const gi = order.indexOf(players[id].pos);
      if (gi < 0) { ok = false; break; }
      lockNeed[gi]++;
    }
    if (!ok || lockNeed.some((v, i) => v > need[i])) continue;

    /* ---- the DP bound ---- */
    const KN = grp.map((g, i) => groupKnap(g, players, proj, need[i], B));
    // SUF[gi][k] = best proj from k more of group gi plus all of gi+1..G-1, salary <= b
    const SUF = [];
    for (let gi = 0; gi <= G; gi++) SUF.push([]);
    SUF[G][0] = { a: new Float64Array(B + 1), lo: 0, hi: 0 };   // nothing left to buy
    for (let gi = G - 1; gi >= 0; gi--) {
      const tail = SUF[gi + 1][need[gi + 1] === undefined ? 0 : need[gi + 1]] || SUF[gi + 1][0];
      for (let k = 0; k <= need[gi]; k++) SUF[gi][k] = maxPlusConv(KN[gi][k], tail, B);
    }

    /* ---- O(1) salary/projection suffix tables inside each group ---- */
    // minSal[gi][from][k] / maxSal[gi][from][k] — cheapest / priciest k at or after `from`
    const MINS = [], MAXS = [], TOPP = [];
    for (let gi = 0; gi < G; gi++) {
      const list = grp[gi], L = list.length, k = need[gi];
      const mn = [], mx = [], tp = [];
      for (let f = 0; f <= L; f++) { mn.push(new Float64Array(k + 1)); mx.push(new Float64Array(k + 1)); }
      for (let j = 1; j <= k; j++) { mn[L][j] = Infinity; mx[L][j] = -Infinity; }
      for (let f = L - 1; f >= 0; f--) {
        const s = players[list[f]].sal;
        for (let j = 1; j <= k; j++) {
          mn[f][j] = Math.min(mn[f + 1][j], s + mn[f + 1][j - 1]);
          mx[f][j] = Math.max(mx[f + 1][j], s + mx[f + 1][j - 1]);
        }
      }
      // list is proj-descending, so the top k from `from` is just the next k entries
      const pre = new Float64Array(L + 1);
      for (let j = 0; j < L; j++) pre[j + 1] = pre[j] + proj[list[j]];
      for (let f = 0; f <= L; f++) {
        const row = new Float64Array(k + 1);
        for (let j = 0; j <= k; j++) row[j] = f + j <= L ? pre[f + j] - pre[f] : -Infinity;
        tp.push(row);
      }
      MINS.push(mn); MAXS.push(mx); TOPP.push(tp);
    }
    // whole-group minima for the groups still entirely ahead of us
    const sufMinAll = new Float64Array(G + 1), sufMaxAll = new Float64Array(G + 1);
    for (let gi = G - 1; gi >= 0; gi--) {
      sufMinAll[gi] = sufMinAll[gi + 1] + MINS[gi][0][need[gi]];
      sufMaxAll[gi] = sufMaxAll[gi + 1] + MAXS[gi][0][need[gi]];
    }
    // ⚠️ Stack feasibility has to count only the slots a stack partner could OCCUPY.
    // Counting every remaining slot (including DST and RB for a WR/TE stack) makes the
    // prune almost never fire, which is most of why the stacked run was slow.
    const sufStackSlots = new Int32Array(G + 1), sufBringSlots = new Int32Array(G + 1);
    for (let gi = G - 1; gi >= 0; gi--) {
      sufStackSlots[gi] = sufStackSlots[gi + 1] + (qbPosArr.indexOf(order[gi]) >= 0 ? need[gi] : 0);
      sufBringSlots[gi] = sufBringSlots[gi + 1] + (order[gi] === "RB" || order[gi] === "WR" || order[gi] === "TE" ? need[gi] : 0);
    }

    const picked = [];
    const teamCt = {}, gameCt = {};
    let qbTeam = null, qbOpp = null, stackHave = 0, bringHave = 0;
    const qbPos = stack.qbPos && stack.qbPos.length ? stack.qbPos : ["WR", "TE"];
    const qbMin = stack.qbMin || 0, bringMin = stack.bringBack || 0;
    let hasRb = 0, hasDstOpp = null;

    function rec(gi, si, from, curProj, curSal) {
      if (aborted) return;
      if ((++nodes & 1023) === 0 && Date.now() > deadline) { aborted = true; return; }
      if (gi === G) {
        if (curSal < floor) return;
        if (qbMin && stackHave < qbMin) return;
        if (bringMin && bringHave < bringMin) return;
        if (site.minGames) { let g = 0; for (const k in gameCt) if (gameCt[k] > 0) g++; if (g < site.minGames) return; }
        for (const id of locks) if (picked.indexOf(id) < 0) return;
        if (cfg.groups) for (const gr of cfg.groups) {
          let c = 0; for (const id of picked) if (gr.ids.indexOf(id) >= 0) c++;
          if (gr.mode === "atMost" && c > gr.n) return;
          if (gr.mode === "atLeast" && c < gr.n) return;
          if (gr.mode === "exactly" && c !== gr.n) return;
        }
        if (curProj > bestVal) { bestVal = curProj; best = { ids: picked.slice(), proj: curProj, sal: curSal }; }
        return;
      }

      const list = grp[gi], k = need[gi], left = k - si;

      // ---- bounds, cheapest first ----
      const minRem = MINS[gi][from][left] + sufMinAll[gi + 1];
      if (curSal + minRem > cap) return;
      const maxRem = MAXS[gi][from][left] + sufMaxAll[gi + 1];
      if (curSal + maxRem < floor) return;
      // salary-aware projection bound
      const budget = ((cap - curSal) / SAL_STEP) | 0;
      if (budget < 0) return;
      const ub = rowGet(SUF[gi][left], budget);
      if (ub === -Infinity || curProj + ub <= bestVal) return;
      // index-order bound: nothing after `from` can beat the next `left` entries
      if (curProj + TOPP[gi][from][left] + (gi + 1 < G ? rowGet(SUF[gi + 1][need[gi + 1]], budget) : 0) <= bestVal) return;

      const isStackGrp = qbPosArr.indexOf(order[gi]) >= 0;
      const isBringGrp = order[gi] === "RB" || order[gi] === "WR" || order[gi] === "TE";
      const stackAfter = (isStackGrp ? left - 1 : 0) + sufStackSlots[gi + 1];
      const bringAfter = (isBringGrp ? left - 1 : 0) + sufBringSlots[gi + 1];
      const last = list.length - left;
      for (let j = from; j <= last; j++) {
        const id = list[j], p = players[id], sal = p.sal;
        // cheapest completion once this player is in
        if (curSal + sal + MINS[gi][j + 1][left - 1] + sufMinAll[gi + 1] > cap) continue;

        const isDst = p.pos === "DST";
        const tc = (teamCt[p.team] || 0) + (isDst ? 0 : 1);
        if (cfg.maxPerTeam && tc > cfg.maxPerTeam) continue;
        const gc = (gameCt[p.gid] || 0) + 1;
        if (cfg.maxPerGame && gc > cfg.maxPerGame) continue;
        if (stack.noRbVsDst) {
          if (isDst && hasRb && picked.some(x => players[x].pos === "RB" && players[x].team === p.opp)) continue;
          if (p.pos === "RB" && hasDstOpp === p.team) continue;
        }
        if (stack.noOppDst) {
          if (!isDst && hasDstOpp === p.team) continue;
          if (isDst && picked.some(x => players[x].pos !== "DST" && players[x].team === p.opp)) continue;
        }

        // overlap prune — overlap is monotone, so a violation kills the whole subtree
        const inL = inLineups[id];
        let over = false, oi = 0;
        for (; oi < inL.length; oi++) if (++overlap[inL[oi]] > maxOverlap) { over = true; oi++; break; }
        if (over) { for (let z = 0; z < oi; z++) overlap[inL[z]]--; continue; }

        // stack bookkeeping
        let dQb = false, dStack = 0, dBring = 0;
        if (p.pos === "QB") { qbTeam = p.team; qbOpp = p.opp; dQb = true; }
        else if (qbTeam) {
          if (p.team === qbTeam && qbPos.indexOf(p.pos) >= 0) { stackHave++; dStack = 1; }
          if (p.team === qbOpp && !isDst) { bringHave++; dBring = 1; }
        }
        const infeasStack = qbTeam && ((qbMin && stackHave + stackAfter < qbMin) ||
                                       (bringMin && bringHave + bringAfter < bringMin));
        if (infeasStack) {
          if (dQb) { qbTeam = null; qbOpp = null; }
          stackHave -= dStack; bringHave -= dBring;
          for (let z = 0; z < inL.length; z++) overlap[inL[z]]--;
          continue;
        }

        picked.push(id);
        teamCt[p.team] = tc; gameCt[p.gid] = gc;
        if (p.pos === "RB") hasRb++;
        const prevDstOpp = hasDstOpp; if (isDst) hasDstOpp = p.opp;

        if (si + 1 < k) rec(gi, si + 1, j + 1, curProj + proj[id], curSal + sal);
        else rec(gi + 1, 0, 0, curProj + proj[id], curSal + sal);

        picked.pop();
        teamCt[p.team] = tc - (isDst ? 0 : 1); gameCt[p.gid] = gc - 1;
        if (p.pos === "RB") hasRb--;
        hasDstOpp = prevDstOpp;
        if (dQb) { qbTeam = null; qbOpp = null; }
        stackHave -= dStack; bringHave -= dBring;
        for (let z = 0; z < inL.length; z++) overlap[inL[z]]--;
      }
    }
    rec(0, 0, 0, 0, 0);
    if (aborted) break;
  }
  if (best) { best.nodes = nodes; best.aborted = aborted; }
  return best ? best : (aborted ? { aborted: true } : null);
}

function sufSlots(need, gi, G) { let s = 0; for (let x = gi + 1; x < G; x++) s += need[x]; return s; }

/* --------------------------------------------------------------- showdown */

function solveShowdown(players, cfg, site, onProgress) {
  const N = players.length;
  const count = Math.max(1, cfg.count | 0);
  const cap = Math.min(cfg.maxSalary || site.cap, site.cap);
  const floor = cfg.minSalary || 0;
  const maxOverlap = site.size - Math.max(0, cfg.uniques | 0);
  const rand = rng(cfg.seed || 1);
  const noise = cfg.randomness || 0;
  // ⚠️ Always have a deadline. An impossible constraint set (a salary window no roster can
  // hit, say) has no solution to prune toward, so the search enumerates the whole tree and
  // a caller that forgot a limit would simply hang.
  const deadline = Date.now() + (cfg.timeLimitMs || 120000);
  const expCount = new Int32Array(N);
  const acceptedSets = [];
  const inLineups = []; for (let i = 0; i < N; i++) inLineups.push([]);
  const out = [];
  let infeasible = null, timedOut = false;

  for (let n = 0; n < count; n++) {
    if (Date.now() > deadline) { timedOut = true; break; }
    const proj = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const base = players[i].proj || 0;
      proj[i] = noise > 0 ? Math.max(0, base * (1 + noise * gauss(rand))) : base;
    }
    const pool = activePool(players, cfg, expCount, n);
    const res = bestShowdown(players, proj, pool, cfg, site, cap, floor,
                             acceptedSets, inLineups, maxOverlap, deadline);
    if (res && !res.ids) { timedOut = true; break; }
    if (!res) { infeasible = n === 0 ? "no lineup satisfies these constraints"
                                     : "ran out of lineups that meet the uniqueness rule"; break; }
    if (res.aborted) timedOut = true;
    const set = new Uint8Array(N);
    for (const id of res.ids) { set[id] = 1; expCount[id]++; inLineups[id].push(acceptedSets.length); }
    acceptedSets.push(set);
    let trueProj = (players[res.cpt].proj || 0) * site.cptMult;
    for (const id of res.ids) if (id !== res.cpt) trueProj += players[id].proj || 0;
    out.push({ ids: res.ids, cpt: res.cpt, proj: trueProj, drawnProj: res.proj, sal: res.sal });
    if (onProgress && (n % 5 === 0 || n === count - 1)) onProgress(n + 1, count);
  }
  return { lineups: out, infeasible, timedOut, exposure: expCount };
}

function bestShowdown(players, proj, pool, cfg, site, cap, floor,
                      acceptedSets, inLineups, maxOverlap, deadline) {
  const flexN = site.size - 1;
  let best = null, bestVal = -1;
  const locks = pool.filter(i => players[i].lock);
  const nAcc = acceptedSets.length;
  const overlap = new Int32Array(nAcc);
  let nodes = 0, aborted = false;

  const cptList = pool.slice().sort((a, b) => proj[b] * site.cptMult - proj[a] * site.cptMult);
  for (const cpt of cptList) {
    if (aborted || Date.now() > deadline) break;
    const cptSal = Math.round(players[cpt].sal * site.cptSalMult);
    const cptProj = proj[cpt] * site.cptMult;
    if (cptSal > cap) continue;
    const list = pool.filter(i => i !== cpt).sort((a, b) => proj[b] - proj[a]);
    if (list.length < flexN) continue;

    // suffix tables for this captain's flex list
    const L = list.length;
    const mn = [], mx = [], pre = new Float64Array(L + 1);
    for (let f = 0; f <= L; f++) { mn.push(new Float64Array(flexN + 1)); mx.push(new Float64Array(flexN + 1)); }
    for (let j = 1; j <= flexN; j++) { mn[L][j] = Infinity; mx[L][j] = -Infinity; }
    for (let f = L - 1; f >= 0; f--) {
      const s = players[list[f]].sal;
      for (let j = 1; j <= flexN; j++) {
        mn[f][j] = Math.min(mn[f + 1][j], s + mn[f + 1][j - 1]);
        mx[f][j] = Math.max(mx[f + 1][j], s + mx[f + 1][j - 1]);
      }
    }
    for (let j = 0; j < L; j++) pre[j + 1] = pre[j] + proj[list[j]];

    const picked = [cpt];
    const teamCt = {}; teamCt[players[cpt].team] = 1;
    for (let a = 0; a < nAcc; a++) overlap[a] = 0;
    for (const a of inLineups[cpt]) overlap[a] = 1;
    let cptOver = false;
    for (const a of inLineups[cpt]) if (overlap[a] > maxOverlap) cptOver = true;
    if (cptOver) continue;

    (function rec(from, k, curProj, curSal) {
      if (aborted) return;
      if ((++nodes & 1023) === 0 && Date.now() > deadline) { aborted = true; return; }
      if (k === 0) {
        if (curSal < floor) return;
        let teams = 0; for (const t in teamCt) if (teamCt[t] > 0) teams++;
        if (site.minTeams && teams < site.minTeams) return;
        for (const id of locks) if (picked.indexOf(id) < 0) return;
        if (curProj > bestVal) { bestVal = curProj; best = { ids: picked.slice(), cpt, proj: curProj, sal: curSal }; }
        return;
      }
      if (curSal + mn[from][k] > cap) return;
      if (curSal + mx[from][k] < floor) return;
      if (curProj + (from + k <= L ? pre[from + k] - pre[from] : -Infinity) <= bestVal) return;
      for (let j = from; j <= L - k; j++) {
        const id = list[j], p = players[id];
        if (curSal + p.sal + mn[j + 1][k - 1] > cap) continue;
        if (cfg.maxPerTeam && (teamCt[p.team] || 0) + 1 > cfg.maxPerTeam) continue;
        const inL = inLineups[id];
        let over = false, oi = 0;
        for (; oi < inL.length; oi++) if (++overlap[inL[oi]] > maxOverlap) { over = true; oi++; break; }
        if (over) { for (let z = 0; z < oi; z++) overlap[inL[z]]--; continue; }
        picked.push(id); teamCt[p.team] = (teamCt[p.team] || 0) + 1;
        rec(j + 1, k - 1, curProj + proj[id], curSal + p.sal);
        picked.pop(); teamCt[p.team]--;
        for (let z = 0; z < inL.length; z++) overlap[inL[z]]--;
      }
    })(0, flexN, cptProj, cptSal);
  }
  if (best) { best.nodes = nodes; best.aborted = aborted; }
  return best ? best : (aborted ? { aborted: true } : null);
}

/* ------------------------------------------------------------------ export */

root.DDFS = { SITES, POS, solveLineups, rng, gauss };
/* ===== DD-FRONTIER START — generated from work/patch-dfs-frontier.py ===== */
/* ============================================================================
   PROJECTION vs RARITY — the exact convex frontier

   The tournament question this answers: to make a lineup rarer, how much projection do
   you have to give up? "Rarer" here is CUMULATIVE OWNERSHIP, the sum of the projected
   ownership of the players in it — the number this page already reports per lineup, and
   the one a field is measured in.

   The method is a Lagrangian sweep. For a weight L, solve the ordinary exact problem on
   proj[i] - L*own[i]. Whatever comes back is EXACTLY optimal for that weight, and it is
   a vertex of the upper convex hull of the achievable (own, proj) set. Probing L at the
   chord slope between two known vertices and recursing finds every vertex between them.

   ⚠️ IT IS THE HULL, NOT THE FRONTIER. A lineup sitting in a dent — beaten by the
   straight line between two hull vertices, but the best there is at its own ownership —
   is optimal for no weight L at all and cannot be found this way. No sweep of this kind
   can find one. `hull: true` rides on the result so the page has to say so.

   ⚠️ ONLY PROVED POINTS ARE PLOTTED. A solve that hits its slice of the clock returns
   the best lineup found so far, which is not the optimum and therefore not a vertex.
   Those are DISCARDED and `capped` goes true, rather than drawing an unproved point on
   a curve whose whole claim is exactness.

   ⚠️ THE RARE END IS THE EXPENSIVE END, and that is structural. Low ownership correlates
   with low salary, so "cheapest ownership while still spending the salary floor" sets
   the objective against the constraint and the salary-knapsack bound goes slack. On a
   full 13-game slate the max-projection solve is ~70ms and a large-L solve does not
   finish in 15s. So the sweep walks L UP only while probes keep succeeding, and stops.
   The curve then covers what was proved and says where it stopped.

   ⚠️ THE SHIFT IS NOT A FUDGE, BUT IT IS NOT FREE. proj[i] - L*own[i] goes negative for
   large L, and a non-positive projection means "no projection" everywhere else in this
   engine, which would silently empty the pool. A constant added to every eligible
   projection cannot change the winner, because every classic lineup holds exactly
   site.size players. (That is also why showdown is refused rather than answered wrong:
   the captain multiplier makes the constant non-uniform.) What the constant DOES cost is
   pruning — it compresses the relative spread the bound works on — which is the other
   half of why large L is slow.
   ========================================================================== */

var FRONTIER_MAX_SOLVES = 24;
var FRONTIER_WALK = 6;      // probes spent finding the rare end before refinement starts

/**
 * players/cfg: exactly as solveLineups takes them, plus `own` (percent) per player.
 * Returns { points, segments, solves, capped, hull, unavailable }.
 *   points[]   {ids, proj, own, sal, lam}  hull vertices, ascending ownership
 *   segments[] {from, to, rate}            rate = projection points per ownership point
 *   capped     the search stopped on its budget or the clock, not on convergence
 *   unavailable a reason string when no frontier can honestly be drawn at all
 */
function frontier(players, cfg, onProgress) {
  cfg = cfg || {};
  var site = SITES[cfg.site] || SITES.dk_classic;
  var out = { points: [], segments: [], solves: 0, capped: false, hull: true, unavailable: null };
  if (site.showdown) { out.unavailable = "showdown"; return out; }

  var own = [], anyOwn = false, i;
  for (i = 0; i < players.length; i++) {
    var v = +players[i].own || 0;
    own.push(v > 0 ? v : 0);
    if (v > 0) anyOwn = true;
  }
  if (!anyOwn) { out.unavailable = "no-ownership"; return out; }

  var budget = cfg.maxSolves > 0 ? Math.min(FRONTIER_MAX_SOLVES, cfg.maxSolves | 0) : FRONTIER_MAX_SOLVES;
  var deadline = Date.now() + (cfg.timeLimitMs || 30000);
  var seen = {}, points = [];

  function at(lam) {
    if (out.solves >= budget || Date.now() > deadline) { out.capped = true; return null; }
    out.solves++;
    if (onProgress) onProgress(out.solves, budget);

    var lo = 0, j;
    for (j = 0; j < players.length; j++) {
      if (!(players[j].proj > 0) && !players[j].lock) continue;
      var w = (players[j].proj || 0) - lam * own[j];
      if (w < lo) lo = w;
    }
    var shift = -lo + 1e-6;

    var shadow = [];
    for (j = 0; j < players.length; j++) {
      var p = players[j], q = {};
      for (var k in p) q[k] = p[k];
      // A player with no projection stays absent, exactly as everywhere else.
      q.proj = (p.proj > 0 || p.lock) ? (p.proj || 0) - lam * own[j] + shift : 0;
      shadow.push(q);
    }

    // A slice of what is left, not all of it: one hard weight must not starve the rest.
    var c = {}; for (var kk in cfg) c[kk] = cfg[kk];
    c.count = 1; c.randomness = 0; c.uniques = 0; c.seed = 1;
    c.timeLimitMs = Math.max(600, Math.floor((deadline - Date.now()) / Math.max(1, budget - out.solves + 1)));

    var res = solveLineups(shadow, c);
    if (!res || res.timedOut || !res.lineups.length) { out.capped = true; return null; }

    var ids = res.lineups[0].ids.slice();
    var key = ids.slice().sort(function (a, b) { return a - b; }).join(",");
    if (seen[key]) return seen[key];

    var pr = 0, ow = 0;
    for (j = 0; j < ids.length; j++) { pr += players[ids[j]].proj || 0; ow += own[ids[j]]; }
    var pt = { ids: ids, proj: pr, own: ow, sal: res.lineups[0].sal, lam: lam };
    seen[key] = pt; points.push(pt);
    return pt;
  }

  var top = at(0);                       // the plain max-projection lineup
  if (!top) { out.unavailable = "infeasible"; return out; }

  // Walk the weight up while probes keep succeeding, keeping the rarest lineup seen.
  // ⚠️ DO NOT stop because a probe returned the same lineup as the last one. Small
  // weights often do — the max-projection lineup stays optimal until the weight is big
  // enough to dislodge it — and an early stop there leaves the frontier a single point.
  var lam = 0.05, bot = top, walk = 0;
  while (walk++ < FRONTIER_WALK) {
    var nxt = at(lam);
    if (!nxt) break;                     // timed out, or the budget ran out
    if (nxt.own < bot.own - 1e-9) bot = nxt;
    lam *= 4;
  }
  // The rare end is "the rarest lineup this search reached", not provably the rarest
  // lineup on the slate — see the note above about why large weights do not finish.

  function refine(a, b, depth) {         // a = richer and more owned, b = leaner and rarer
    if (depth > 12) return;
    var dOwn = a.own - b.own;
    if (dOwn <= 1e-9) return;
    var slope = (a.proj - b.proj) / dOwn;
    var p = at(slope);
    if (!p) return;
    if (p.proj <= b.proj + (p.own - b.own) * slope + 1e-7) return;   // sits on the chord
    refine(a, p, depth + 1); refine(p, b, depth + 1);
  }
  refine(top, bot, 0);

  points.sort(function (a, b) { return a.own - b.own || b.proj - a.proj; });

  // Pareto filter first: a point beaten on BOTH axes by a rarer one is on no frontier,
  // hull or otherwise. This can only bite when the search was cut off mid-recursion.
  var pareto = [], bestProj = -Infinity;
  for (i = 0; i < points.length; i++) {
    if (points[i].proj > bestProj + 1e-9) { pareto.push(points[i]); bestProj = points[i].proj; }
  }
  // Then the upper hull: slopes must strictly decrease as ownership rises.
  var hull = [];
  for (i = 0; i < pareto.length; i++) {
    var c2 = pareto[i];
    while (hull.length >= 2) {
      var x = hull[hull.length - 2], y = hull[hull.length - 1];
      if ((y.proj - x.proj) * (c2.own - y.own) <= (c2.proj - y.proj) * (y.own - x.own) + 1e-9) hull.pop();
      else break;
    }
    hull.push(c2);
  }
  out.points = hull;
  for (i = 1; i < hull.length; i++) {
    out.segments.push({
      from: hull[i - 1], to: hull[i],
      rate: (hull[i].proj - hull[i - 1].proj) / (hull[i].own - hull[i - 1].own)
    });
  }
  return out;
}

root.DDFS.frontier = frontier;
root.DDFS.FRONTIER_MAX_SOLVES = FRONTIER_MAX_SOLVES;
root.DDFS.FRONTIER_WALK = FRONTIER_WALK;
/* ===== DD-FRONTIER END ===== */

/* ============================================================================
   CONTEST SIMULATOR

   Three layers, and the page names all three:

   1. CORRELATION — measured, not assumed. DDFS.CORR is the within-game correlation
      of DraftKings scoring by role, estimated from seven regular seasons of nflverse
      weekly stats (see the meta block for provenance and sample sizes). Weekly scores
      are z-scored inside player-season before correlating, so the numbers describe how
      outcomes MOVE TOGETHER inside a game rather than how much better one player is
      than another. Each game on the slate gets its own correlation matrix assembled
      from those cells and Cholesky-factored once.

   2. SHAPE — each player's score is a lognormal with the user's projection as its mean
      and a coefficient of variation read off the same data, by position and scoring
      level. DST is drawn normal instead, because a DK defence can finish negative and a
      lognormal cannot.

   3. FIELD — opponent lineups sampled to hit the ownership projections the user
      supplied, with a configurable share of them stacked. ⚠️ The field is a SAMPLE,
      typically 2,000-5,000 lineups, and the finishing rank is extrapolated to the real
      contest size. That is a real approximation and the page says so.

   ⚠️ What none of this can see: news after the projections were written, weather,
   snap-count surprises, or a field that is smarter than the ownership estimate.
   ========================================================================== */

const CORR = {"meta":{"source":"nflverse-data stats_player_week + stats_team_week + nfldata games.csv","seasons":[2019,2025],"regularSeasonOnly":true,"games":1871,"playerWeeks":35587,"minGamesPerPlayerSeason":6,"minPairObservations":400,"psdEigenvaluesClipped":0,"psdMaxCellDrift":0.0,"scoring":"DraftKings full-PPR incl. 100/300-yard bonuses; DST incl. points-allowed tiers"},"roles":["QB","RB1","RB2","RBx","WR1","WR2","WR3","WRx","TE1","TEx","DST"],"same":[[1.0,0.0642,0.0583,0.0201,0.3525,0.3134,0.2414,0.1697,0.2715,0.1671,-0.1101],[0.0642,1.0,-0.0077,-0.0418,-0.0263,-0.0214,-0.0295,-0.0096,-0.0013,0.0357,0.0609],[0.0583,-0.0077,1.0,0.0615,-0.0051,-0.057,-0.0084,-0.0173,-0.0191,0.0144,0.0192],[0.0201,-0.0418,0.0615,1.0,-0.041,0.039,-0.0047,-0.0005,0.0253,0.0106,-0.0002],[0.3525,-0.0263,-0.0051,-0.041,1.0,0.0057,-0.0152,-0.0085,0.0103,0.0178,-0.0666],[0.3134,-0.0214,-0.057,0.039,0.0057,1.0,-0.0123,0.0217,-0.0134,-0.0142,-0.0697],[0.2414,-0.0295,-0.0084,-0.0047,-0.0152,-0.0123,1.0,0.042,0.0193,0.0143,-0.0697],[0.1697,-0.0096,-0.0173,-0.0005,-0.0085,0.0217,0.042,1.0,0.0385,0.0398,-0.0277],[0.2715,-0.0013,-0.0191,0.0253,0.0103,-0.0134,0.0193,0.0385,1.0,0.0167,-0.0751],[0.1671,0.0357,0.0144,0.0106,0.0178,-0.0142,0.0143,0.0398,0.0167,1.0,-0.0483],[-0.1101,0.0609,0.0192,-0.0002,-0.0666,-0.0697,-0.0697,-0.0277,-0.0751,-0.0483,1.0]],"opp":[[0.1888,0.0394,0.0083,-0.0042,0.0894,0.0723,0.0752,0.0521,0.0723,0.053,-0.3114],[0.0394,-0.0847,-0.0165,-0.0108,0.0126,0.0034,0.0238,0.0132,0.0022,0.0207,-0.208],[0.0083,-0.0165,-0.0382,-0.0292,0.0245,0.011,0.0028,-0.0082,0.0147,-0.0224,-0.1308],[-0.0042,-0.0108,-0.0292,0.0634,0.03,-0.0413,-0.027,0.0218,-0.0075,0.01,-0.0296],[0.0894,0.0126,0.0245,0.03,0.076,0.0239,0.0407,0.0193,0.0539,0.0087,-0.1349],[0.0723,0.0034,0.011,-0.0413,0.0239,0.0463,0.0292,0.0395,0.0556,0.0551,-0.111],[0.0752,0.0238,0.0028,-0.027,0.0407,0.0292,-0.0002,0.0463,-0.0051,0.0151,-0.0751],[0.0521,0.0132,-0.0082,0.0218,0.0193,0.0395,0.0463,0.0268,-0.0148,0.0073,-0.0587],[0.0723,0.0022,0.0147,-0.0075,0.0539,0.0556,-0.0051,-0.0148,0.0479,-0.006,-0.0689],[0.053,0.0207,-0.0224,0.01,0.0087,0.0551,0.0151,0.0073,-0.006,0.0209,-0.0786],[-0.3114,-0.208,-0.1308,-0.0296,-0.1349,-0.111,-0.0751,-0.0587,-0.0689,-0.0786,-0.2075]],"cv":{"DST":[{"lo":0.0,"hi":6.0,"cv":1.0644,"n":148},{"lo":6.0,"hi":10.0,"cv":0.7407,"n":75}],"QB":[{"lo":10.0,"hi":14.0,"cv":0.6249,"n":62},{"lo":14.0,"hi":18.0,"cv":0.4637,"n":93},{"lo":18.0,"hi":24.0,"cv":0.3987,"n":88}],"RB":[{"lo":0.0,"hi":6.0,"cv":1.1329,"n":375},{"lo":6.0,"hi":10.0,"cv":0.7495,"n":165},{"lo":10.0,"hi":14.0,"cv":0.6153,"n":120},{"lo":14.0,"hi":18.0,"cv":0.5245,"n":87},{"lo":18.0,"hi":24.0,"cv":0.483,"n":39}],"TE":[{"lo":0.0,"hi":6.0,"cv":0.9846,"n":396},{"lo":6.0,"hi":10.0,"cv":0.7185,"n":141},{"lo":10.0,"hi":14.0,"cv":0.6303,"n":64}],"WR":[{"lo":0.0,"hi":6.0,"cv":1.1486,"n":527},{"lo":6.0,"hi":10.0,"cv":0.7723,"n":271},{"lo":10.0,"hi":14.0,"cv":0.6508,"n":195},{"lo":14.0,"hi":18.0,"cv":0.5796,"n":127},{"lo":18.0,"hi":24.0,"cv":0.5333,"n":48}]}};

const POS_OF_ROLE = { QB: "QB", RB1: "RB", RB2: "RB", RBx: "RB", WR1: "WR", WR2: "WR",
                      WR3: "WR", WRx: "WR", TE1: "TE", TEx: "TE", DST: "DST" };
// Two players sharing a depth role (a third RB, a fourth WR) are not the same player.
// The estimation forces a role's self-correlation to 1, so a small measured-neighbour
// value is used instead of 1 for duplicates. WR3-WRx measured 0.042; this is that,
// rounded down. It is an assumption, and it only ever touches bench-level players.
const SAME_ROLE_RHO = 0.03;

function assignRoles(players) {
  // Role is read off the user's own projections: the highest-projected WR on a team is
  // WR1. It is the only ordering available before kickoff, and it is the same ordering
  // the field will use.
  const byTeamPos = {};
  players.forEach((p, i) => {
    const k = p.team + "|" + p.pos;
    (byTeamPos[k] || (byTeamPos[k] = [])).push(i);
  });
  const role = new Array(players.length).fill(null);
  for (const k in byTeamPos) {
    const list = byTeamPos[k].sort((a, b) => (players[b].proj || 0) - (players[a].proj || 0));
    const pos = k.split("|")[1];
    list.forEach((id, n) => {
      if (pos === "QB") role[id] = "QB";
      else if (pos === "DST") role[id] = "DST";
      else if (pos === "RB") role[id] = n === 0 ? "RB1" : n === 1 ? "RB2" : "RBx";
      else if (pos === "WR") role[id] = n === 0 ? "WR1" : n === 1 ? "WR2" : n === 2 ? "WR3" : "WRx";
      else if (pos === "TE") role[id] = n === 0 ? "TE1" : "TEx";
    });
  }
  return role;
}

function corrBetween(roleA, roleB, sameTeam, sameSlot) {
  const i = CORR.roles.indexOf(roleA), j = CORR.roles.indexOf(roleB);
  if (i < 0 || j < 0) return 0;
  if (sameTeam) return sameSlot ? SAME_ROLE_RHO : CORR.same[i][j];
  return CORR.opp[i][j];
}

// Cholesky with a jitter retry. The assembled per-game matrix mixes cells estimated on
// different subsets, so it is not guaranteed positive definite even though the source
// matrix is; jitter is cheaper and clearer than an eigen decomposition in the browser.
function cholesky(M, n) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const jitter = attempt === 0 ? 0 : Math.pow(10, -9 + attempt);
    const L = new Float64Array(n * n);
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        let s = M[i * n + j] + (i === j ? jitter : 0);
        for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
        if (i === j) {
          if (s <= 0) { ok = false; break; }
          L[i * n + i] = Math.sqrt(s);
        } else {
          L[i * n + j] = s / L[j * n + j];
        }
      }
    }
    if (ok) return { L, jitter };
  }
  // Last resort: independence. Never silently — the caller surfaces this.
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) L[i * n + i] = 1;
  return { L, jitter: null, failed: true };
}

function cvFor(pos, mean) {
  const rows = CORR.cv[pos] || CORR.cv.WR;
  if (!rows || !rows.length) return 0.7;
  for (const r of rows) if (mean >= r.lo && mean < r.hi) return r.cv;
  // ⚠️ Outside the estimated range the nearest bin is reused rather than extrapolated.
  // Thin bins are exactly where an extrapolated CV would be least trustworthy.
  return mean < rows[0].lo ? rows[0].cv : rows[rows.length - 1].cv;
}

/**
 * players: [{pos, team, opp, gid, sal, proj, own}]   own is a PERCENT, 0-100
 * lineups: [{ids:[...], cpt?}]   the pool being evaluated
 * cfg: { sims, fieldSample, fieldSize, entries, entryFee, seed, fieldStackRate,
 *        payout: {kind:'param', paidFrac, alpha, rake} | {kind:'table', rows:[{from,to,prize}]},
 *        site }
 */
function simulate(players, lineups, cfg, onProgress) {
  const N = players.length;
  const site = SITES[cfg.site] || SITES.dk_classic;
  const sims = Math.max(200, cfg.sims | 0 || 10000);
  const fieldSize = Math.max(2, cfg.fieldSize | 0 || 10000);
  const ourN = lineups.length;
  const sampleN = Math.max(50, Math.min(cfg.fieldSample | 0 || 2000, Math.max(2, fieldSize - ourN)));
  const rand = rng(cfg.seed || 99);
  const roles = assignRoles(players);

  /* ---- per-game correlation ---- */
  const games = {};
  players.forEach((p, i) => (games[p.gid] || (games[p.gid] = [])).push(i));
  const gameKeys = Object.keys(games);
  const chol = {}, warn = [];
  for (const g of gameKeys) {
    const ids = games[g], n = ids.length;
    const M = new Float64Array(n * n);
    const seen = {};
    for (let a = 0; a < n; a++) {
      const ra = roles[ids[a]], ta = players[ids[a]].team;
      for (let b = 0; b < n; b++) {
        if (a === b) { M[a * n + b] = 1; continue; }
        const rb = roles[ids[b]], tb = players[ids[b]].team;
        M[a * n + b] = corrBetween(ra, rb, ta === tb, ta === tb && ra === rb);
      }
    }
    const c = cholesky(M, n);
    if (c.failed) warn.push("game " + g + ": correlation matrix would not factor, players drawn independently");
    chol[g] = { L: c.L, ids, n };
  }

  /* ---- score shape ---- */
  const mu = new Float64Array(N), sigma = new Float64Array(N), isNorm = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const p = players[i], m = Math.max(0, p.proj || 0);
    mu[i] = m;
    const cv = cvFor(p.pos, m);
    if (p.pos === "DST") { isNorm[i] = 1; sigma[i] = cv * Math.max(m, 3); }
    else sigma[i] = Math.sqrt(Math.log(1 + cv * cv));
  }

  /* ---- field ---- */
  const field = buildField(players, roles, cfg, site, sampleN, rand, onProgress);
  if (field.tooHard || field.length < 25) {
    warn.push("Could not build a believable field from these salaries and ownership — " +
              (field.length ? "only " + field.length + " valid opponent lineups were found." :
               "no valid opponent lineup could be assembled.") +
              " Check that ownership is set and that the salary cap is reachable.");
  }

  /* ---- payout curve ---- */
  const pay = payoutFn(cfg.payout || {}, fieldSize, cfg.entryFee || 1);

  /* ---- simulate ---- */
  const score = new Float64Array(N);
  const z = new Float64Array(N);
  const fieldScore = new Float64Array(field.length);
  const ourScore = new Float64Array(ourN);
  const BINS = 4096;
  const hist = new Int32Array(BINS + 1);

  const accPay = new Float64Array(ourN), accCash = new Int32Array(ourN),
        accWin = new Int32Array(ourN), accTop1 = new Int32Array(ourN),
        accScore = new Float64Array(ourN), accScore2 = new Float64Array(ourN),
        accRank = new Float64Array(ourN);
  const winLineup = new Int32Array(N);
  const cptMult = site.showdown ? site.cptMult : 1;

  for (let s = 0; s < sims; s++) {
    // correlated draws, one game at a time
    for (const g of gameKeys) {
      const { L, ids, n } = chol[g];
      for (let a = 0; a < n; a++) z[a] = gauss(rand);
      for (let a = 0; a < n; a++) {
        let v = 0, row = a * n;
        for (let b = 0; b <= a; b++) v += L[row + b] * z[b];
        const id = ids[a];
        score[id] = isNorm[id] ? mu[id] + sigma[id] * v
                               : mu[id] * Math.exp(sigma[id] * v - sigma[id] * sigma[id] / 2);
      }
    }

    let lo = Infinity, hi = -Infinity, fieldMax = -Infinity;
    for (let f = 0; f < field.length; f++) {
      const L9 = field[f]; let t = 0;
      for (let k = 0; k < L9.length; k++) t += score[L9[k]];
      if (L9.cpt !== undefined) t += score[L9.cpt] * (cptMult - 1);
      fieldScore[f] = t;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
      if (t > fieldMax) fieldMax = t;
    }
    for (let o = 0; o < ourN; o++) {
      const l = lineups[o]; let t = 0;
      for (let k = 0; k < l.ids.length; k++) t += score[l.ids[k]];
      if (l.cpt !== undefined) t += score[l.cpt] * (cptMult - 1);
      ourScore[o] = t;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }

    // histogram rank: counting how many field lineups beat us, without sorting the field
    const span = hi - lo || 1, inv = BINS / span;
    hist.fill(0);
    for (let f = 0; f < field.length; f++) {
      let b = ((fieldScore[f] - lo) * inv) | 0;
      if (b > BINS) b = BINS;
      hist[b]++;
    }
    for (let b = BINS - 1; b >= 0; b--) hist[b] += hist[b + 1];   // count at or above bin

    // best lineup on the slate this week, for win-lineup share
    let bestF = -Infinity, bestIdx = -1, bestIsOurs = false;
    for (let f = 0; f < field.length; f++) if (fieldScore[f] > bestF) { bestF = fieldScore[f]; bestIdx = f; bestIsOurs = false; }
    for (let o = 0; o < ourN; o++) if (ourScore[o] > bestF) { bestF = ourScore[o]; bestIdx = o; bestIsOurs = true; }
    const bestL = bestIsOurs ? lineups[bestIdx].ids : field[bestIdx];
    for (let k = 0; k < bestL.length; k++) winLineup[bestL[k]]++;

    const scale = (fieldSize - ourN) / field.length;
    for (let o = 0; o < ourN; o++) {
      const v = ourScore[o];
      let b = ((v - lo) * inv) | 0; if (b > BINS) b = BINS; if (b < 0) b = 0;
      // hist[b+1] counts field lineups in strictly higher bins — a conservative "above"
      const above = (b < BINS ? hist[b + 1] : 0) * scale;
      let ours = 0;
      for (let q = 0; q < ourN; q++) if (q !== o && ourScore[q] > v) ours++;
      const rank = 1 + above + ours;
      const prize = pay(rank);
      accPay[o] += prize;
      if (prize > 0) accCash[o]++;
      // ⚠️ Win rate is decided on the EXACT field maximum, not on the histogram. The
      // histogram counts "lineups in a strictly higher bin", so anything sharing our bin
      // reads as beaten — harmless 300 places deep, but at the very top that is the
      // difference between winning the tournament and not, and it biases win% upward.
      if (v > fieldMax && ours === 0) accWin[o]++;
      if (rank <= Math.max(1, fieldSize * 0.01)) accTop1[o]++;
      accScore[o] += v; accScore2[o] += v * v; accRank[o] += rank;
    }
    if (onProgress && (s % 250 === 0)) onProgress("sim", s, sims);
  }

  const fee = cfg.entryFee || 1;
  const perLineup = [];
  for (let o = 0; o < ourN; o++) {
    const m = accScore[o] / sims;
    perLineup.push({
      i: o,
      mean: m,
      sd: Math.sqrt(Math.max(0, accScore2[o] / sims - m * m)),
      ev: accPay[o] / sims,
      roi: (accPay[o] / sims - fee) / fee,
      cash: accCash[o] / sims,
      win: accWin[o] / sims,
      top1: accTop1[o] / sims,
      meanRank: accRank[o] / sims
    });
  }

  // per-player exposure vs how often they show up in the slate's best lineup
  const inOurs = new Int32Array(N);
  lineups.forEach(l => l.ids.forEach(i => inOurs[i]++));
  const perPlayer = [];
  for (let i = 0; i < N; i++) {
    if (!(players[i].proj > 0)) continue;
    const wl = winLineup[i] / sims;
    perPlayer.push({
      i,
      own: players[i].own || 0,
      winLineup: wl * 100,
      leverage: wl * 100 - (players[i].own || 0),
      ourExposure: ourN ? (inOurs[i] / ourN) * 100 : 0
    });
  }

  // duplication, measured off the sampled field and scaled
  const key = l => (l.cpt !== undefined ? l.cpt + "c|" : "") + l.slice().sort((a, b) => a - b).join(",");
  const fieldKeys = {};
  for (const f of field) { const k = key(f); fieldKeys[k] = (fieldKeys[k] || 0) + 1; }
  const scaleF = (fieldSize - ourN) / field.length;
  lineups.forEach((l, o) => {
    const k = key(l.ids);
    perLineup[o].dupes = (fieldKeys[k] || 0) * scaleF;
  });

  return {
    perLineup, perPlayer, warn,
    meta: {
      sims, fieldSize, fieldSample: field.length, entries: ourN,
      entryFee: fee, payout: cfg.payout,
      corr: CORR.meta,
      fieldOwnershipError: field.ownErr,
      fieldMedianProj: field.medProj,
      fieldP90Proj: field.p90Proj,
      fieldMedianSalary: field.medSal,
      ourMedianProj: (() => {
        const a = lineups.map(l => l.proj != null ? l.proj
          : l.ids.reduce((t, i) => t + (players[i].proj || 0), 0)).sort((x, y) => x - y);
        return a.length ? a[a.length >> 1] : null;
      })()
    }
  };
}

/* ---- field construction -------------------------------------------------- */

function buildField(players, roles, cfg, site, sampleN, rand, onProgress) {
  const N = players.length;
  const target = new Float64Array(N);
  for (let i = 0; i < N; i++) target[i] = Math.max(0, (players[i].own || 0)) / 100;
  const eligible = [];
  for (let i = 0; i < N; i++) if (players[i].proj > 0 && target[i] > 0) eligible.push(i);
  const byPos = { QB: [], RB: [], WR: [], TE: [], DST: [] };
  for (const i of eligible) if (byPos[players[i].pos]) byPos[players[i].pos].push(i);

  const w = new Float64Array(N);
  for (const i of eligible) w[i] = target[i];
  const stackRate = cfg.fieldStackRate == null ? 0.6 : cfg.fieldStackRate;
  const cap = site.cap;
  const floor = cfg.fieldMinSalary == null ? Math.round(cap * 0.98) : cfg.fieldMinSalary;

  let out = [];
  // ⚠️ Sampling by raw ownership does NOT reproduce the ownership you asked for — the
  // salary cap and the roster shape distort it. Three calibration passes reweight toward
  // the target and the residual error is reported, rather than quietly presenting the
  // first pass as if it hit.
  let ownErr = null;
  for (let pass = 0; pass < 3; pass++) {
    out = [];
    let guard = 0, tries = 0;
    // ⚠️ Bail out loudly rather than grinding. A slate where almost nothing fits under the
    // cap used to burn three passes of 120,000 attempts and hand back an empty field.
    while (out.length < sampleN && guard < sampleN * 12) {
      guard++; tries++;
      const l = site.showdown ? sampleShowdown(players, byPos, w, cap, rand, site, eligible, floor)
                              : sampleClassic(players, roles, byPos, w, cap, rand, stackRate, floor);
      if (l) out.push(l);
      if (tries === 500 && out.length < 25) break;
    }
    if (out.length < 25) { out.tooHard = true; break; }
    const got = new Float64Array(N);
    for (const l of out) for (const id of l) got[id]++;
    let err = 0, n = 0;
    for (const i of eligible) {
      const realized = got[i] / out.length;
      err += Math.abs(realized - target[i]); n++;
      if (pass < 2) {
        const ratio = realized > 1e-6 ? target[i] / realized : 3;
        w[i] = Math.max(1e-6, w[i] * Math.min(3, Math.max(0.33, ratio)));
      }
    }
    ownErr = n ? (err / n) * 100 : null;
    if (onProgress) onProgress("field", pass + 1, 3);
  }
  out.ownErr = ownErr;
  // how strong the modelled field turned out, so the page can show it rather than assume it
  if (out.length) {
    const pr = out.map(l => {
      let t = 0;
      for (const id of l) t += players[id].proj || 0;
      if (l.cpt !== undefined) t += (players[l.cpt].proj || 0) * 0.5;
      return t;
    }).sort((a, b) => a - b);
    const sa = out.map(l => l.sal || 0).sort((a, b) => a - b);
    out.medProj = pr[pr.length >> 1];
    out.p90Proj = pr[Math.floor(pr.length * 0.9)];
    out.medSal = sa[sa.length >> 1];
  }
  return out;
}

/* ⚠️ Budget-aware weighted pick. A plain ownership-weighted draw with a salary-cap
   rejection at the end does not work: on a real-priced slate the overwhelming majority
   of randomly assembled lineups are over the cap, so the sampler returned an EMPTY
   field and every downstream metric quietly became NaN. Candidates are filtered to what
   is still affordable once the cheapest completion of the remaining slots is reserved. */
function pick(list, w, rand, used, maxSal, players, minSal) {
  const fits = id => !used[id] && (maxSal == null || players[id].sal <= maxSal)
                              && (minSal == null || players[id].sal >= minSal);
  let tot = 0;
  for (const id of list) if (fits(id)) tot += w[id];
  if (tot <= 0) {
    // the salary floor is a preference, the cap is a rule — drop the floor before failing
    if (minSal != null) return pick(list, w, rand, used, maxSal, players, null);
    return -1;
  }
  let r = rand() * tot;
  for (const id of list) { if (!fits(id)) continue; r -= w[id]; if (r <= 0) return id; }
  for (let k = list.length - 1; k >= 0; k--) if (fits(list[k])) return list[k];
  return -1;
}

// priciest k players in `list` that are not already used
function costliestK(list, k, used, players) {
  if (k <= 0) return 0;
  const best = [];
  for (const id of list) {
    if (used[id]) continue;
    const s = players[id].sal;
    if (best.length < k) { best.push(s); best.sort((a, b) => b - a); }
    else if (s > best[k - 1]) { best[k - 1] = s; best.sort((a, b) => b - a); }
  }
  return best.length < k ? 0 : best.reduce((a, b) => a + b, 0);
}

// cheapest k players in `list` that are not already used
function cheapestK(list, k, used, players) {
  if (k <= 0) return 0;
  const best = [];
  for (const id of list) {
    if (used[id]) continue;
    const s = players[id].sal;
    if (best.length < k) { best.push(s); best.sort((a, b) => a - b); }
    else if (s < best[k - 1]) { best[k - 1] = s; best.sort((a, b) => a - b); }
  }
  return best.length < k ? Infinity : best.reduce((a, b) => a + b, 0);
}

function sampleClassic(players, roles, byPos, w, cap, rand, stackRate, floor) {
  const FLEX = byPos.RB.concat(byPos.WR, byPos.TE);
  for (let attempt = 0; attempt < 8; attempt++) {
    const used = {}, ids = [];
    let sal = 0, ok = true;
    const want = { QB: 1, RB: 2, WR: 3, TE: 1, DST: 1 };
    let flexLeft = 1;
    // cheapest / priciest way to finish the roster from here
    const minLeft = (excl) => {
      let mn = 0;
      for (const pos of ["QB", "RB", "WR", "TE", "DST"])
        mn += cheapestK(byPos[pos], want[pos] - (excl === pos ? 1 : 0), used, players);
      if (flexLeft && excl !== "FLEX") mn += cheapestK(FLEX, 1, used, players);
      return mn;
    };
    const maxLeft = (excl) => {
      let mx = 0;
      for (const pos of ["QB", "RB", "WR", "TE", "DST"])
        mx += costliestK(byPos[pos], want[pos] - (excl === pos ? 1 : 0), used, players);
      if (flexLeft && excl !== "FLEX") mx += costliestK(FLEX, 1, used, players);
      return mx;
    };
    const take = (id) => { used[id] = 1; ids.push(id); sal += players[id].sal; };
    // ⚠️ Real DraftKings entries spend nearly the whole cap. A field sampled without a
    // salary floor is systematically cheaper — and therefore weaker — than the room you
    // are actually playing against, which inflates every ROI the simulator reports.
    const roomFor = (pos) => ({
      max: cap - sal - minLeft(pos),
      min: floor ? floor - sal - maxLeft(pos) : null
    });

    let r = roomFor("QB");
    const qb = pick(byPos.QB, w, rand, used, r.max, players, r.min);
    if (qb < 0) return null;
    take(qb); want.QB = 0;

    if (rand() < stackRate) {
      const mates = byPos.WR.concat(byPos.TE).filter(i => players[i].team === players[qb].team);
      const n = rand() < 0.45 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const pool = mates.filter(i => !used[i] && want[players[i].pos] > 0);
        if (!pool.length) break;
        const pos = players[pool[0]].pos;
        r = roomFor(pos);
        const m = pick(pool, w, rand, used, r.max, players, r.min);
        if (m < 0) break;
        take(m); want[players[m].pos]--;
      }
    }

    for (const pos of ["RB", "WR", "TE", "DST"]) {
      while (want[pos] > 0) {
        r = roomFor(pos);
        const p = pick(byPos[pos], w, rand, used, r.max, players, r.min);
        if (p < 0) { ok = false; break; }
        take(p); want[pos]--;
      }
      if (!ok) break;
    }
    if (!ok) continue;

    const fx = pick(FLEX, w, rand, used, cap - sal, players, floor ? floor - sal : null);
    if (fx < 0) continue;
    take(fx); flexLeft = 0;

    if (ids.length !== 9 || sal > cap) continue;
    let ng = 0; const games = {};
    for (const id of ids) if (!games[players[id].gid]) { games[players[id].gid] = 1; ng++; }
    if (ng >= 2) { ids.sal = sal; return ids; }
  }
  return null;
}

function sampleShowdown(players, byPos, w, cap, rand, site, eligible, floor) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const used = {}, ids = [];
    let left = site.size - 1;
    const cptRoom = cap - cheapestK(eligible, left, used, players);
    const cpt = pick(eligible, w, rand, used, cptRoom / site.cptSalMult, players, null);
    if (cpt < 0) return null;
    used[cpt] = 1; ids.push(cpt);
    let sal = Math.round(players[cpt].sal * site.cptSalMult), ok = true;
    while (left > 0) {
      const max = cap - sal - cheapestK(eligible, left - 1, used, players);
      const min = floor ? floor - sal - costliestK(eligible, left - 1, used, players) : null;
      const p = pick(eligible, w, rand, used, max, players, min);
      if (p < 0) { ok = false; break; }
      used[p] = 1; ids.push(p); sal += players[p].sal; left--;
    }
    if (!ok || sal > cap) continue;
    const teams = {}; let nt = 0;
    for (const id of ids) if (!teams[players[id].team]) { teams[players[id].team] = 1; nt++; }
    if (nt < 2) continue;
    ids.cpt = cpt; ids.sal = sal;
    return ids;
  }
  return null;
}

/* ---- payouts ------------------------------------------------------------- */

function payoutFn(spec, fieldSize, entryFee) {
  if (spec.kind === "table" && spec.rows && spec.rows.length) {
    const rows = spec.rows.slice().sort((a, b) => a.from - b.from);
    return function (rank) {
      const r = Math.round(rank);
      for (const row of rows) if (r >= row.from && r <= row.to) return row.prize;
      return 0;
    };
  }
  // parametric: prize(r) proportional to r^-alpha over the paid places.
  // alpha is "how top-heavy" — 1.15 puts roughly 15-18% of the pool on first in a
  // large field, which is about where DraftKings' big tournaments sit.
  const paidFrac = spec.paidFrac == null ? 0.2 : spec.paidFrac;
  const alpha = spec.alpha == null ? 1.15 : spec.alpha;
  const rake = spec.rake == null ? 0.15 : spec.rake;
  const paid = Math.max(1, Math.round(fieldSize * paidFrac));
  const pool = fieldSize * entryFee * (1 - rake);
  if (spec.kind === "flat") {
    const prize = pool / paid;
    return rank => (rank <= paid ? prize : 0);
  }
  let H = 0;
  const step = paid > 5000 ? Math.ceil(paid / 5000) : 1;
  for (let r = 1; r <= paid; r += step) H += Math.pow(r, -alpha) * step;
  return function (rank) {
    if (rank > paid || rank < 1) return 0;
    return pool * Math.pow(rank, -alpha) / H;
  };
}

root.DDFS.simulate = simulate;
root.DDFS.CORR = CORR;
root.DDFS.assignRoles = assignRoles;
root.DDFS.payoutFn = payoutFn;

})(typeof module !== "undefined" && module.exports ? module.exports : (typeof self !== "undefined" ? self : this));

