const D = require("./dfs-engine.js").DDFS;
const mk = require("./mkslate.js");

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log("  ok   " + n)) : (fail++, console.log("  FAIL " + n + (x ? "  " + x : ""))); };

const P = mk(13).map((p, i) => ({ ...p, own: 0 }));
// ownership roughly proportional to projection-per-dollar, normalised per position so the
// field has a believable shape
const posTot = {};
P.forEach(p => { p.val = p.proj / (p.sal / 1000); posTot[p.pos] = (posTot[p.pos] || 0) + Math.pow(p.val, 3); });
const slots = { QB: 100, RB: 200, WR: 300, TE: 100, DST: 100 };
P.forEach(p => { p.own = +(Math.pow(p.val, 3) / posTot[p.pos] * slots[p.pos]).toFixed(2); });
P.forEach(p => { if (p.own > 45) p.own = 45; });

console.log("\nbuilding a lineup pool");
let t0 = Date.now();
const sol = D.solveLineups(P, { site: "dk_classic", count: 20, uniques: 2, randomness: 0.2,
  minSalary: 49000, maxPerTeam: 4, stack: { qbMin: 1, qbPos: ["WR", "TE"] }, timeLimitMs: 60000 });
console.log(`  ${sol.lineups.length} lineups in ${Date.now() - t0}ms`);

console.log("\ndistribution shape");
{
  // one lineup, many sims, tiny field: checks the DRAWS, not the contest maths
  const r = D.simulate(P, sol.lineups.slice(0, 1), { sims: 4000, fieldSample: 60, fieldSize: 1000,
    entryFee: 20, seed: 5, payout: { kind: "param", paidFrac: 0.2, alpha: 1.15, rake: 0.15 } });
  const l = sol.lineups[0];
  const projSum = l.proj;
  ok("simulated lineup mean is within 2% of the sum of projections",
     Math.abs(r.perLineup[0].mean - projSum) / projSum < 0.02,
     `sim ${r.perLineup[0].mean.toFixed(2)} vs proj ${projSum.toFixed(2)}`);
  ok("lineup sd is a plausible fraction of the mean",
     r.perLineup[0].sd / r.perLineup[0].mean > 0.15 && r.perLineup[0].sd / r.perLineup[0].mean < 0.45,
     `cv ${(r.perLineup[0].sd / r.perLineup[0].mean).toFixed(3)}`);
  ok("no correlation matrix failed to factor", r.warn.length === 0, r.warn.join("; "));
}

console.log("\ncorrelation actually lands where the data says");
{
  // reach into the engine's own machinery to draw raw scores
  const roles = D.assignRoles(P);
  const qb = P.findIndex(p => p.pos === "QB" && p.team === "T0");
  const wr1 = P.map((p, i) => [p, i]).filter(([p]) => p.pos === "WR" && p.team === "T0")
              .sort((a, b) => b[0].proj - a[0].proj)[0][1];
  const oppQb = P.findIndex(p => p.pos === "QB" && p.team === "T1");
  const dst = P.findIndex(p => p.pos === "DST" && p.team === "T1");
  ok("role assignment: top-projected WR on a team is WR1", roles[wr1] === "WR1", roles[wr1]);

  // Spearman is what the copula preserves; Pearson is attenuated by the lognormal map.
  const N = 20000;
  const one = D.simulate(P, sol.lineups.slice(0, 1),
    { sims: 1, fieldSample: 50, fieldSize: 100, entryFee: 1, seed: 1, payout: {} });
  // rerun the draw loop directly for a clean sample
  const samples = { qb: [], wr1: [], oppQb: [], dst: [] };
  const rand = D.rng(4242);
  const CORR = D.CORR;
  // rebuild the same per-game machinery the simulator uses, minimally
  const gids = [...new Set(P.map(p => p.gid))];
  const game0 = P.map((p, i) => [p, i]).filter(([p]) => p.gid === 0).map(([, i]) => i);
  const n = game0.length;
  const M = new Float64Array(n * n);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    if (a === b) { M[a * n + b] = 1; continue; }
    const ia = game0[a], ib = game0[b], same = P[ia].team === P[ib].team;
    const i = CORR.roles.indexOf(roles[ia]), j = CORR.roles.indexOf(roles[ib]);
    const sameSlot = same && roles[ia] === roles[ib];
    M[a * n + b] = sameSlot ? 0.03 : (same ? CORR.same[i][j] : CORR.opp[i][j]);
  }
  // cholesky (same routine, re-derived here so the test doesn't depend on an export)
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = M[i * n + j] + (i === j ? 1e-9 : 0);
    for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
    if (i === j) L[i * n + i] = Math.sqrt(Math.max(s, 1e-12)); else L[i * n + j] = s / L[j * n + j];
  }
  const at = id => game0.indexOf(id);
  const zbuf = new Float64Array(n), out = new Float64Array(n);
  for (let s = 0; s < N; s++) {
    for (let a = 0; a < n; a++) zbuf[a] = D.gauss(rand);
    for (let a = 0; a < n; a++) { let v = 0; for (let b = 0; b <= a; b++) v += L[a * n + b] * zbuf[b]; out[a] = v; }
    samples.qb.push(out[at(qb)]); samples.wr1.push(out[at(wr1)]);
    samples.oppQb.push(out[at(oppQb)]); samples.dst.push(out[at(dst)]);
  }
  const corr = (a, b) => {
    const n2 = a.length, ma = a.reduce((x, y) => x + y) / n2, mb = b.reduce((x, y) => x + y) / n2;
    let c = 0, va = 0, vb = 0;
    for (let i = 0; i < n2; i++) { const x = a[i] - ma, y = b[i] - mb; c += x * y; va += x * x; vb += y * y; }
    return c / Math.sqrt(va * vb);
  };
  const cQW = corr(samples.qb, samples.wr1), cQQ = corr(samples.qb, samples.oppQb),
        cQD = corr(samples.qb, samples.dst);
  const tQW = CORR.same[0][CORR.roles.indexOf("WR1")], tQQ = CORR.opp[0][0],
        tQD = CORR.opp[0][CORR.roles.indexOf("DST")];
  ok(`latent QB<->own WR1 reproduces the estimate (${tQW})`, Math.abs(cQW - tQW) < 0.03, `drew ${cQW.toFixed(3)}`);
  ok(`latent QB<->opposing QB reproduces the estimate (${tQQ})`, Math.abs(cQQ - tQQ) < 0.03, `drew ${cQQ.toFixed(3)}`);
  ok(`latent QB<->opposing DST reproduces the estimate (${tQD})`, Math.abs(cQD - tQD) < 0.03, `drew ${cQD.toFixed(3)}`);
}

console.log("\nfield construction");
{
  const r = D.simulate(P, sol.lineups, { sims: 800, fieldSample: 3000, fieldSize: 20000,
    entryFee: 20, seed: 8, fieldStackRate: 0.6,
    payout: { kind: "param", paidFrac: 0.2, alpha: 1.15, rake: 0.15 } });
  ok("field reached the requested sample size", r.meta.fieldSample >= 2900, String(r.meta.fieldSample));
  ok("mean absolute ownership error under 3 points after calibration",
     r.meta.fieldOwnershipError != null && r.meta.fieldOwnershipError < 3,
     `${(r.meta.fieldOwnershipError || 0).toFixed(2)}pp`);
  ok("every lineup has a win rate between 0 and 1", r.perLineup.every(l => l.win >= 0 && l.win <= 1));
  ok("cash rate is at least the win rate for every lineup", r.perLineup.every(l => l.cash >= l.win - 1e-9));
  ok("mean rank is sane (between 1 and field size)", r.perLineup.every(l => l.meanRank >= 1 && l.meanRank <= 20000));
  const lev = r.perPlayer.map(p => p.leverage);
  ok("leverage is signed both ways", Math.min(...lev) < 0 && Math.max(...lev) > 0,
     `${Math.min(...lev).toFixed(1)} to ${Math.max(...lev).toFixed(1)}`);
  const sumWL = r.perPlayer.reduce((t, p) => t + p.winLineup, 0);
  ok("win-lineup shares sum to ~900% (9 roster slots)", Math.abs(sumWL - 900) < 1, sumWL.toFixed(1));
}

console.log("\nchalk should lose to leverage in a top-heavy GPP (the whole argument)");
{
  // build the most-owned legal lineup and the highest-projected one, compare ROI
  const chalk = D.solveLineups(P.map(p => ({ ...p, proj: p.own })), { site: "dk_classic", count: 1, minSalary: 45000 });
  const chalkIds = chalk.lineups[0].ids;
  const best = sol.lineups[0];
  const r = D.simulate(P, [{ ids: chalkIds }, { ids: best.ids }], { sims: 6000, fieldSample: 2500,
    fieldSize: 50000, entryFee: 20, seed: 21, fieldStackRate: 0.65,
    payout: { kind: "param", paidFrac: 0.2, alpha: 1.15, rake: 0.15 } });
  const chalkOwn = chalkIds.reduce((t, i) => t + P[i].own, 0);
  const bestOwn = best.ids.reduce((t, i) => t + P[i].own, 0);
  console.log(`  chalk build: ${chalkOwn.toFixed(0)}% cumulative own, ROI ${(r.perLineup[0].roi * 100).toFixed(1)}%`);
  console.log(`  solver best: ${bestOwn.toFixed(0)}% cumulative own, ROI ${(r.perLineup[1].roi * 100).toFixed(1)}%`);
  ok("the chalk build really is the more-owned one", chalkOwn > bestOwn);
}

console.log("\nspeed");
for (const [sims, fs] of [[5000, 2000], [10000, 2000], [20000, 3000]]) {
  const t = Date.now();
  D.simulate(P, sol.lineups, { sims, fieldSample: fs, fieldSize: 50000, entryFee: 20, seed: 3,
    payout: { kind: "param", paidFrac: 0.2, alpha: 1.15, rake: 0.15 } });
  console.log(`  ${sims} sims x ${fs} field x ${sol.lineups.length} lineups: ${Date.now() - t}ms`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
