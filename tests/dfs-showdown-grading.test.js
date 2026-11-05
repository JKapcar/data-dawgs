/* DFS SHOWDOWN grading (dfs-showdown-grading.js): pre-lock checks, prize-table parsing, the
   scaled big-contest ROI, the post-slate pool scorecard and field calibration.
   Every fixture here is SYNTHETIC: the invented demo slate and standings files generated from
   it inside the test. These tests pin arithmetic and invariants, not truth.
   ⚠️ No real DK standings, paid projections or other entrants' data may be used as a fixture
   in this public repo. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DDFS } = require('../work/dfs-engine.js');
const SD = require('../dfs-showdown.js');
const GR = require('../dfs-showdown-grading.js');
const LG = require('../dfs-ledger.js');

const QUICK = { engine: DDFS, worlds: 600, fieldN: 6000, grading: GR };
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` ${a} vs ${b} (tol ${tol})`);

/* A tiny seeded RNG so the synthetic standings are reproducible. */
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { const u = Math.max(1e-12, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/* ------------------------------------------------------------------ prize tables */
test('prize tables parse in the common pasted shapes and refuse bad ones', () => {
  const a = GR.parsePrizeTable('1st $25,000\n2nd $10,000\n3rd - 5th $1,000\n6th-10th $100\n11th - 1,000th $10', { fieldSize: 5000, fee: 5 });
  assert.ok(a.ok, a.problems.join(' '));
  assert.equal(a.paidPlaces, 1000);
  assert.equal(a.payouts.length, 1000);
  assert.equal(a.payouts[0], 25000); assert.equal(a.payouts[4], 1000); assert.equal(a.payouts[9], 100); assert.equal(a.payouts[999], 10);
  assert.equal(a.total, 25000 + 10000 + 3000 + 500 + 990 * 10);

  const b = GR.parsePrizeTable('1st\n$1.5K\n2nd\n$500\n3rd - 4th\n$50', { fieldSize: 100 });
  assert.ok(b.ok, b.problems.join(' '));
  assert.deepEqual(b.payouts, [1500, 500, 50, 50]);

  const c = GR.parsePrizeTable('Place,Prize\n1,1M\n2,100000\n3-10,5000', { fieldSize: 200000 });
  assert.ok(c.ok, c.problems.join(' '));
  assert.equal(c.payouts[0], 1000000); assert.equal(c.paidPlaces, 10);

  const tix = GR.parsePrizeTable('1st $1,000\n2nd Ticket to the Millionaire\n3rd $50', { fieldSize: 100 });
  assert.ok(tix.ok, tix.problems.join(' '));
  assert.equal(tix.payouts[1], 0, 'a non-cash prize counts as $0');
  assert.ok(tix.notes.some(n => /ticket|non-cash/i.test(n)));

  assert.equal(GR.parsePrizeTable('1st $10\n2nd $50', { fieldSize: 100 }).ok, false, 'prizes rising down the table');
  assert.equal(GR.parsePrizeTable('1st - 5th $10\n4th $5', { fieldSize: 100 }).ok, false, 'overlapping ranks');
  assert.equal(GR.parsePrizeTable('1st - 500th $10', { fieldSize: 100 }).ok, false, 'paid ranks beyond the field');
  assert.equal(GR.parsePrizeTable('', { fieldSize: 100 }).ok, false, 'nothing pasted is not a table');
});

/* ------------------------------------------------------------------ scaled ROI */
test('scaled tables are exchangeable: averaged over a uniform sample rank they pay total ÷ entrants', () => {
  const N = 20000, m = 499;
  const pay = []; for (let r = 0; r < 4500; r++) pay.push(r === 0 ? 5000 : r < 10 ? 500 : r < 100 ? 40 : 6);
  const total = pay.reduce((s, v) => s + v, 0);
  /* With copies, a lineup splits whatever its group of identical lineups wins, so in a
     top-heavy contest it is worth LESS than total ÷ entrants. The exact value for an entry
     whose rank among the other N−1 is uniform and whose copies are Poisson(λ): */
  const prefix = [0]; for (let r = 0; r < N; r++) prefix.push(prefix[r] + (pay[r] || 0));
  const exact = lambda => { let e = 0, p = Math.exp(-lambda);
    for (let t = 0; t < 40; t++) { if (t) p *= lambda / t; let s = 0; for (let A = 0; A < N; A++) s += (prefix[Math.min(N, A + t + 1)] - prefix[A]) / (t + 1); e += p * s / N; }
    return e; };
  for (const dupRate of [0, 2 / (N - 1)]) {
    const T = GR.scaledContestTables({ payouts: pay, entrants: N, sample: m, dupRate });
    let s = 0, cash = 0; for (let a = 0; a < T.pay.length; a++) { s += T.pay[a]; cash += T.cash[a]; }
    const avg = s / (m + 1), want = exact(T.lambda);
    if (!dupRate) close(want, total / N, 1e-9, 'no copies: exactly total ÷ entrants');
    else assert.ok(want < total / N, 'copies cost a top-heavy lineup EV');
    close(avg, want, want * 0.002, 'mean pay, dupRate ' + dupRate);
    close(cash / (m + 1), 4500 / N, 0.002, 'mean cash rate');
    assert.ok(T.pay[0] >= T.pay[T.pay.length - 1], 'beating the whole sample pays at least as much as finishing last in it');
  }
  assert.equal(GR.lambdaBucket(0), 0);
  assert.equal(GR.lambdaBucket(1), 1);
  const cache = GR.contestTableCache(pay, N, m);
  assert.equal(cache(1 / (N - 1)), cache(1.05 / (N - 1)), 'near-equal copy rates share one table');
});

test('a big contest with a prize table gets a scaled ROI that agrees with the full-field sim', async () => {
  const d = SD.demoSlate();
  const fieldSize = 4000, payouts = []; for (let r = 0; r < 900; r++) payouts.push(r === 0 ? 2000 : r < 20 ? 100 : r < 200 ? 15 : 5);
  d.entries = d.entries.slice(0, 3).map(e => ({ ...e, type: 'flag', entrants: fieldSize, fee: 5, contestMeta: { contestType: 'gpp', fieldSize, payouts } }));
  const opts = { ...QUICK, worlds: 1500, fieldN: 8000 };
  const full = await SD.analyze(JSON.parse(JSON.stringify(d)), opts);
  const scaled = await SD.analyze(JSON.parse(JSON.stringify(d)), { ...opts, fullContestMax: 1000 });
  full.entries.forEach((e, k) => {
    const f = e.contestSim, s = scaled.entries[k].contestSim;
    assert.ok(f.available && !f.scaled, 'full-field sim ran');
    assert.ok(s.available && s.scaled, 'scaled sim ran');
    assert.equal(s.sampled, 999);
    assert.ok(Array.isArray(s.roiCi) && s.roiCi[0] <= s.roi && s.roi <= s.roiCi[1]);
    const halfWidth = Math.max(f.roiCi[1] - f.roiCi[0], s.roiCi[1] - s.roiCi[0]);
    close(s.roi, f.roi, halfWidth + 5, 'scaled vs full ROI, entry ' + k);
  });
  const none = await SD.analyze((() => { const x = SD.demoSlate(); x.entries = x.entries.filter(e => e.type === 'flag'); return x; })(), QUICK);
  assert.equal(none.entries[0].contestSim.available, false, 'no prize table, no ROI');
  assert.match(none.entries[0].contestSim.reason, /prize table/i);
});

/* ------------------------------------------------------------------ pre-lock checks */
test('pre-lock checks flag the audit patterns, accept a written reason and never block', async () => {
  const d = SD.demoSlate();
  const { P } = SD.preparePlayers(d.players);
  const L = (cpt, flex) => ({ cpt, ids: [cpt].concat(flex), type: 'se' });
  // Rowan Vance (0, HBR QB) in every entry; Delacroix (11) is the other QB.
  const entries = [
    L(0, [1, 2, 12, 13, 9]), L(0, [1, 3, 12, 13, 9]), L(0, [2, 3, 12, 14, 9]),
    L(0, [1, 4, 12, 13, 9]), L(0, [1, 2, 13, 14, 9]), L(0, [3, 4, 12, 13, 9])
  ];
  const out = GR.preLockChecks(P, entries, {});
  assert.ok(out.label && /hypothes/i.test(out.label), 'labelled as tracked hypotheses');
  assert.ok(out.checks.every(c => c.level === 'warn' || c.level === 'info'), 'warnings only');
  const vance = out.checks.find(c => c.rule === GR.RULES.exposure.id && c.players.includes('HBR:Rowan Vance'));
  assert.ok(vance, 'Vance at 100% vs 75.6% field is 15+ points over');
  assert.ok(out.checks.some(c => c.rule === GR.RULES.kicker.id), 'a kicker in the entries needs a make-rate note');
  // A written reason marks the exposure warning explained.
  const notes = { [vance.noteKey]: 'Stacking the HBR passing game on purpose.' };
  const again = GR.preLockChecks(P, entries, { notes });
  assert.equal(again.checks.find(c => c.noteKey === vance.noteKey).status, 'explained');
  assert.equal(again.summary.open, out.summary.open - 1);
  // Underdog QB: force MSA as favourite, so Vance (HBR) is the dog at 100% vs ~76%.
  const dog = GR.preLockChecks(P, entries, { favorite: 'MSA' });
  assert.ok(dog.checks.some(c => c.rule === GR.RULES.dogQb.id), 'underdog QB above field +10');
  // Favourite's top two pass-catchers combined below field − 10: MSA favourite, no Calloway (13) or Abara (14).
  const fade = [L(0, [1, 2, 3, 4, 12]), L(0, [1, 2, 3, 12, 15]), L(0, [1, 2, 4, 12, 15]), L(0, [1, 3, 4, 12, 15]), L(0, [2, 3, 4, 12, 15])];
  const fav = GR.preLockChecks(P, fade, { favorite: 'MSA' });
  assert.ok(fav.checks.some(c => c.rule === GR.RULES.favCatchers.id), 'favourite pass-catchers faded');
  // Exposure rules need at least five entries.
  const few = GR.preLockChecks(P, entries.slice(0, 2), {});
  assert.ok(few.skipped.some(s => s.rule === GR.RULES.exposure.id));
});

test('cash punts are flagged unless every alternative costs more than ~2 projected points', () => {
  const d = SD.demoSlate();
  const { P } = SD.preparePlayers(d.players);
  // Paxton Drury (19) projects 2.4: a sub-3 punt in a Double Up.
  const punt = { cpt: 0, ids: [0, 1, 12, 13, 2, 19], type: 'cash' };
  const out = GR.preLockChecks(P, [punt], {});
  const c = out.checks.find(x => x.rule === GR.RULES.cashPunt.id);
  assert.ok(c, 'sub-3-point player in a cash lineup is checked');
  const best = GR.bestWithoutPunts(P, 0, 3);
  assert.ok(best && best.ids.every(i => P[i].proj >= 3), 'the comparison lineup has no punts');
  const cost = (1.5 * P[0].proj + [1, 12, 13, 2, 19].reduce((s, i) => s + P[i].proj, 0)) - best.proj;   // positive: the punt build projects more
  assert.equal(c.level, cost > 2 ? 'info' : 'warn');
  // A punt that is not worth it: swap a strong FLEX for the punt so a no-punt build clearly projects more.
  const bad = GR.preLockChecks(P, [{ cpt: 0, ids: [0, 19, 18, 8, 12, 13], type: 'cash' }], {}).checks.find(x => x.rule === GR.RULES.cashPunt.id);
  assert.equal(bad.level, 'warn');
  assert.equal(bad.status, 'open');
});

/* ------------------------------------------------------------------ synthetic standings */
/* Build a DK-format contest-standings CSV from the demo slate: a field drawn from the same
   ownership-calibrated sampler, tilted by a known β, with invented actual points. */
async function syntheticStandings({ N, beta, seed, actualSeed }) {
  const d = SD.demoSlate(), { P } = SD.preparePlayers(d.players), r = rng(seed);
  const field = await SD._internal.sampleField(DDFS, P, 12000, { seed, fieldMinSalary: d.settings.fieldMinSalary });
  const L = field.lineups, nF = field.n, fp = new Float64Array(nF);
  for (let k = 0; k < nF; k++) { const o = k * 6; fp[k] = SD.features(P, L[o], [L[o + 1], L[o + 2], L[o + 3], L[o + 4], L[o + 5]]).proj; }
  let mu = 0, s2 = 0; for (let k = 0; k < nF; k++) mu += fp[k]; mu /= nF; for (let k = 0; k < nF; k++) s2 += (fp[k] - mu) ** 2; const sd = Math.sqrt(s2 / nF);
  const cw = new Float64Array(nF); let acc = 0; for (let k = 0; k < nF; k++) { acc += Math.exp(beta * (fp[k] - mu) / sd); cw[k] = acc; }
  const ra = rng(actualSeed || 99);
  const actual = P.map(p => Math.max(0, Math.round((p.proj + gauss(ra) * p.proj * 0.6) * 100) / 100));
  const rows = [];
  for (let n = 0; n < N; n++) {
    const u = r() * acc; let lo = 0, hi = nF - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cw[mid] < u) lo = mid + 1; else hi = mid; }
    const o = lo * 6, ids = [L[o], L[o + 1], L[o + 2], L[o + 3], L[o + 4], L[o + 5]];
    const pts = Math.round((1.5 * actual[ids[0]] + ids.slice(1).reduce((s, i) => s + actual[i], 0)) * 100) / 100;
    rows.push({ ids, pts, name: 'user' + n });
  }
  rows.sort((a, b) => b.pts - a.pts);
  const cnt = { CPT: new Map(), FLEX: new Map() };
  rows.forEach(x => { cnt.CPT.set(x.ids[0], (cnt.CPT.get(x.ids[0]) || 0) + 1); x.ids.slice(1).forEach(i => cnt.FLEX.set(i, (cnt.FLEX.get(i) || 0) + 1)); });
  const own = [];
  for (const slot of ['CPT', 'FLEX']) for (const [i, c] of cnt[slot]) own.push({ i, slot, pct: 100 * c / N });
  own.sort((a, b) => b.pct - a.pct);
  const q = s => /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  const lines = ['Rank,EntryId,EntryName,TimeRemaining,Points,Lineup,,Player,Roster Position,%Drafted,FPTS'];
  let rank = 0, prev = null;
  rows.forEach((x, k) => {
    if (x.pts !== prev) rank = k + 1; prev = x.pts;
    const lu = 'CPT ' + P[x.ids[0]].name + ' ' + x.ids.slice(1).map(i => 'FLEX ' + P[i].name).join(' ');
    const o = own[k];
    const tail = o ? [q(P[o.i].name), o.slot, o.pct.toFixed(2) + '%', String(Math.round((o.slot === 'CPT' ? 1.5 : 1) * actual[o.i] * 100) / 100)] : ['', '', '', ''];
    lines.push([rank, 4000000000 + k, x.name, 0, x.pts.toFixed(2), q(lu), ''].concat(tail).join(','));
  });
  return { csv: lines.join('\n'), players: d.players, P, actual, rows };
}

test('a synthetic DK standings file parses, and actual points rescore its lineups exactly', async () => {
  const S = await syntheticStandings({ N: 1500, beta: 0.6, seed: 11 });
  const st = LG.parseStandings(S.csv, { showdown: true });
  assert.equal(st.field_size, 1500);
  assert.ok(st.showdown);
  const act = GR.actualPoints(st, S.P);
  assert.deepEqual(act.unmatched, []);
  assert.ok(act.check.lineups >= 1400, 'nearly every lineup rescored');
  assert.ok(act.check.maxAbsErr < 0.05, 'player points reproduce each lineup total: max err ' + act.check.maxAbsErr);
  for (const [i, v] of act.points) if (S.actual[i] > 0) close(v, S.actual[i], 0.01, 'player ' + i);
});

test('the pool scorecard reads real cut lines and compares our pool with the plain pool', async () => {
  const S = await syntheticStandings({ N: 2000, beta: 0.4, seed: 23 });
  const st = LG.parseStandings(S.csv, { showdown: true });
  const base = GR.baselinePool(S.P, 20);
  assert.equal(base.length, 20);
  for (const l of base) {
    const sal = 1.5 * S.P[l.cpt].sal + l.ids.slice(1).reduce((s, i) => s + S.P[i].sal, 0);
    assert.ok(sal <= 50000, 'baseline lineup under the cap');
    assert.equal(new Set(l.ids).size, 6);
    assert.equal(new Set(l.ids.map(i => S.P[i].team)).size, 2, 'both teams');
  }
  for (let k = 1; k < base.length; k++) assert.ok(base[k - 1].proj >= base[k].proj, 'sorted by projection');
  const ours = SD.demoSlate().entries.map(e => ({ cpt: e.cpt, ids: e.ids }));
  const sc = GR.poolScorecard({ players: S.P, pools: { ours }, contests: [{ name: 'Synthetic', standings: st, paidPlaces: 440 }, { name: 'No paid places', standings: st }] });
  const c = sc.contests[0];
  assert.equal(c.cuts.top1Places, 20);
  assert.equal(c.cuts.paidPlaces, 440);
  assert.equal(c.cuts.top1Score, S.rows[19].pts);
  assert.equal(c.cuts.cashScore, S.rows[439].pts);
  assert.equal(c.ours.scored, ours.length);
  assert.equal(c.baseline.n, ours.length, 'plain pool is the same size as ours');
  assert.ok(c.ours.cashRate >= 0 && c.ours.cashRate <= 1);
  // Hand-check one lineup's rank against the actual field.
  const s0 = 1.5 * S.actual[ours[0].cpt] + ours[0].ids.slice(1).reduce((s, i) => s + S.actual[i], 0);
  const above = S.rows.filter(x => x.pts > s0 + 1e-9).length;
  assert.equal(GR.rankOf(GR.cutLines(st).sorted, s0), above + 1);
  assert.equal(sc.contests[1].ours.cashRate, null, 'cash stays unknown without paid places');
  assert.ok(sc.caveats.some(x => /independent/i.test(x)), 'correlation caveat present');
});

test('field calibration recovers a known field sharpness from synthetic standings', async () => {
  for (const truth of [0.2, 1.2]) {
    const S = await syntheticStandings({ N: 4000, beta: truth, seed: 37 + Math.round(truth * 10) });
    const st = LG.parseStandings(S.csv, { showdown: true });
    const fit = await GR.calibrateContest({ players: S.players, standings: st, type: 'mme', presetBeta: 0.9, settings: SD.demoSlate().settings, name: 'synthetic β=' + truth },
      { engine: DDFS, showdown: SD, fieldN: 12000, seed: 5 });
    assert.equal(fit.resolved, 4000);
    close(fit.beta.fit, truth, 0.25, 'fitted β');
    close(fit.projection.modelAtFit, fit.projection.observedMean, 0.05, 'fit matches the real mean projection');
    assert.ok(fit.ownership.CPT.n > 0 && fit.ownership.FLEX.n > 0);
  }
  const comb = GR.combineCalibrations([{ type: 'mme', beta: { fit: 1 }, resolved: 10, contest: 'a' }, { type: 'mme', beta: { fit: 1.4 }, resolved: 10, contest: 'b' }]);
  assert.equal(comb.mme.beta, 1.2);
  assert.equal(comb.mme.provisional, true, 'fewer than three contests stays provisional');
});

test('fitted betas feed the engine and are labelled as fitted', async () => {
  const a = await SD.analyze(SD.demoSlate(), { ...QUICK, betas: { se: 1.1 } });
  assert.equal(a.betas.se.beta, 1.1);
  assert.match(a.betas.se.source, /fitted/);
  assert.match(a.betas.mid.source, /preset/);
  const clamp = await SD.analyze(SD.demoSlate(), { ...QUICK, betas: { se: 99 } });
  assert.equal(clamp.betas.se.beta, 4, 'a fitted β is clamped to the fit range');
});
