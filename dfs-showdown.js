/* ============================================================================
   dfs-showdown.js — the math behind DFS SHOWDOWN (dfs-showdown.html).

   DraftKings NFL Showdown only. Pure computation: no DOM, no network, no storage.
   Loaded by dfs-showdown.html after its inlined engine (window.DDFS), and by
   work/test-showdown.mjs in node with the engine passed in explicitly.

   ⚠️ NO PROJECTION OR OWNERSHIP DATA LIVES IN THIS FILE. Inputs are the signed-in
   user's private workspace, loaded at runtime from the Worker, or the synthetic demo
   slate below, whose teams and players are invented. This repo is public.

   ⚠️ THE WORLDS MIRROR DDFS.simulate (engine v2): one Cholesky per game over the
   measured role correlations, lognormal scores with cvFor(pos, proj), Normal for DST,
   captain scored at 1.5×. The engine does not hand back per-world scores, and this page
   needs them (finish distributions, the portfolio's any-lineup odds, the best sampled
   lineup's captain), so the loop is repeated here with the engine's own primitives
   rather than a parallel port of the maths: assignRoles, corrBetween, cholesky, cvFor,
   gauss, rng and sampleShowdown all come from DDFS.

   ⚠️ THE OPPONENT FIELD mirrors buildField's Showdown branch (ownership-weighted legal
   samples from DDFS.modelHelpers.sampleShowdown, three calibration passes toward the
   captain and FLEX targets). buildField itself is not exported by the engine.

   ⚠️ CONTEST TYPES DIFFER BY A FIELD-SHARPNESS PRESET, NOT BY MEASURED FIELDS. One
   ownership projection describes every contest. The presets below tilt the same sampled
   field toward higher projection for sharper contest types. They are hypotheses until
   they are fit on the user's own contest standings, and the page says so.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DDShowdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
'use strict';

const VERSION = 'showdown-dashboard-1';

/* Contest types. `beta` is the field-sharpness tilt (hypothesis, see header). Entrants
   are the default field size when the user has not typed the real one. */
const TYPES = [
  { id: 'se', label: 'Single-entry', sub: '2–9K entrants', entrants: 4000, fee: 5, beta: 0.25 },
  { id: 'mid', label: '5/20-max', sub: '4–9K entrants', entrants: 6000, fee: 3, beta: 0.35 },
  { id: 'mme', label: 'Max-entry', sub: '~1.5K · $333', entrants: 1500, fee: 333, beta: 0.8 },
  { id: 'flag', label: 'Flagship', sub: '~90K entrants', entrants: 90000, fee: 20, beta: 0.1 }
];
// Accounting category only: reuse the existing single-entry field hypothesis, no new ranking weights.
TYPES.push({id:'cash',label:'Cash / Double Up',sub:'Payout-based cutoff',entrants:4000,fee:1,beta:TYPES[0].beta});
const TYPE_IDS = TYPES.map(t => t.id);

/* Lineup score weights by contest type. A placeholder until calibrated on receipts;
   the page labels it as such. Large fields lean on ceiling and uniqueness. */
const SCORE_WEIGHTS = {
  se: { pts: 0.25, ceil: 0.25, top1: 0.40, cash: 0.10 },
  mid: { pts: 0.25, ceil: 0.25, top1: 0.40, cash: 0.10 },
  mme: { pts: 0.30, ceil: 0.20, top1: 0.35, unique: 0.15 },
  flag: { pts: 0.15, ceil: 0.30, top1: 0.35, unique: 0.20 }
};
const CONTRIBUTOR_NAMES = {
  pts: 'Points for its ownership', ceil: 'Ceiling', top1: 'Top-1% chance',
  cash: 'Top-22% simulation baseline', unique: 'Uniqueness'
};
const AXES = ['own', 'sal', 'dupe'];
const MEASURES = ['proj', 'ceil'];
const FINISH_CUTS = [0.01, 0.05, 0.10, 0.22, 0.50];   // top 1%, 5%, 10%, cash line, top half
const BINS = 16;
const FRONTIER_BINS = 40;
const CEIL_FALLBACK = 1.6;     // only used when a player has no ceiling; hasCeil goes false

function gradeWord(p) { return p >= 90 ? 'Elite' : p >= 75 ? 'Strong' : p >= 25 ? 'Typical' : 'Weak'; }
function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
function num(v) { const n = typeof v === 'string' ? parseFloat(v) : v; return finite(n) ? n : NaN; }
const tick = () => new Promise(r => setTimeout(r, 0));

/* Cash-line inputs use numeric types, never permissive string parsing. A numeric
   payouts array is ordered by finishing rank; omitted trailing ranks pay zero.
   Validate every supplied field, including lower-priority evidence. Conflicting
   ratios fail closed; empty payouts are absent, not evidence of zero paid places. */
function resolveCashLine(c = {}) {
  const has = k => c[k] !== undefined && c[k] !== null;
  const fail = m => { throw new Error('Cash line: ' + m); };
  if (has('fieldSize') && (!Number.isInteger(c.fieldSize) || c.fieldSize < 2)) fail('fieldSize must be an integer >= 2');
  if (has('paidPlaces') && (!Number.isInteger(c.paidPlaces) || c.paidPlaces < 0)) fail('paidPlaces must be a nonnegative integer');
  if (has('cashLinePct') && (!finite(c.cashLinePct) || c.cashLinePct < 0 || c.cashLinePct > 100)) fail('cashLinePct must be a finite percentage from 0 to 100');
  if (has('cashLineSource') && typeof c.cashLineSource !== 'string') fail('cashLineSource must be text');
  if (has('contestType') && !['cash','gpp'].includes(c.contestType)) fail('contestType must be cash or gpp');
  if (has('entryLimit') && (!Number.isInteger(c.entryLimit) || c.entryLimit < 1)) fail('entryLimit must be a positive integer');
  for (const k of ['fee','prizePool']) if (has(k) && (!finite(c[k]) || c[k] < 0)) fail(k + ' must be finite and nonnegative');
  if (has('payouts') && (!Array.isArray(c.payouts) || c.payouts.some(v => !finite(v) || v < 0))) fail('payouts must be a numeric nonnegative array by rank');
  const payouts = c.payouts || [], evidence = [];
  if ((payouts.length || has('paidPlaces')) && !has('fieldSize')) fail('supplied payouts/paidPlaces require fieldSize');
  if (payouts.length > c.fieldSize || (has('paidPlaces') && c.paidPlaces > c.fieldSize)) fail('paid ranks exceed fieldSize');
  for (let i=1;i<payouts.length;i++) if (payouts[i] > payouts[i-1]) fail('payouts must not increase at lower ranks');
  const positive = payouts.filter(v => v > 0);
  if (payouts.length) evidence.push(['payouts',positive.length/c.fieldSize]);
  if (has('paidPlaces')) evidence.push(['paidPlaces',c.paidPlaces/c.fieldSize]);
  if (has('cashLinePct')) evidence.push(['cashLinePct',c.cashLinePct/100]);
  if (evidence.some(x => Math.abs(x[1]-evidence[0][1]) > 1e-9)) fail('supplied cutoff fields contradict each other');
  const chosen = evidence[0] || ['assumed',0.22];
  return {cashLine:chosen[1],cashLineSource:chosen[0],cashLineSourceText:c.cashLineSource || '',
    // This describes supplied rank prizes only; ties at the boundary remain unresolved.
    flatPositivePrizes:positive.length > 1 && positive.every(v => v === positive[0])};
}
function classifyContest(c = {}, fallback = 'se') {
  const name=String(c.name || c.contest || '');
  if (c.contestType === 'cash' || /double up|50\/50|head.to.head|triple up/i.test(name)) return 'cash';
  if (finite(c.fieldSize) && c.fieldSize >= 20000) return 'flag';
  if (finite(c.prizePool) && c.prizePool >= 250000 && /\[\$?(?:500|50)K to 1st\]/i.test(name)) return 'flag';
  if (c.entryLimit === 1) return 'se';
  if (Number.isInteger(c.entryLimit) && c.entryLimit > 1) return c.entryLimit >= 100 ? 'mme' : 'mid';
  if (/single[ -]entry/i.test(name)) return 'se';
  if (/milly|millionaire/i.test(name)) return 'flag';
  const m=name.match(/\[(\d+)\s*entry max\]/i);
  return m ? (+m[1] === 1 ? 'se' : +m[1] >= 100 ? 'mme' : 'mid') : fallback;
}
function formatSimulationPct(pct, worlds) {
  if (!finite(pct) || pct < 0 || pct > 100 || !Number.isInteger(worlds) || worlds < 1) return 'Unavailable';
  if ((pct < 100 && Math.round(pct) >= 100) || pct === 100 && worlds < 5000) return '>99%';
  if (pct === 100) return '100% in simulation';
  return (pct < 1 && pct > 0 ? '<1' : Math.round(pct)) + '%';
}
function wilson95(hits, n) {
  if (!Number.isInteger(hits) || !Number.isInteger(n) || n < 1 || hits < 0 || hits > n) return null;
  const z=1.959963984540054, q=z*z, p=hits/n, d=1+q/n;
  const center=(p+q/(2*n))/d, half=z*Math.sqrt(p*(1-p)/n+q/(4*n*n))/d;
  return [Math.max(0,center-half),Math.min(1,center+half)];
}
/* ---------------------------------------------------------------- inputs */

/* Normalise workspace players. Ownership is PERCENT, 0–100, as everywhere on the site.
   FLEX ownership is total minus captain when the pool does not carry it, which is the
   convention the playbook and buildField both use. */
function preparePlayers(players) {
  if (!Array.isArray(players) || players.length < 2) throw new Error('A Showdown pool needs at least two players.');
  let hasCeil = true;
  const P = players.map((p, i) => {
    const proj = num(p.proj), own = num(p.own), sal = num(p.sal);
    const cptOwn0 = num(p.cptOwn), flexOwn0 = num(p.flexOwn), ceil0 = num(p.ceil), cptSal0 = num(p.cptSal);
    const ownPct = finite(own) ? Math.max(0, Math.min(100, own)) : 0;
    const cptOwn = finite(cptOwn0) ? Math.max(0, Math.min(ownPct || 100, cptOwn0)) : ownPct / 6;
    const flexOwn = finite(flexOwn0) ? Math.max(0, flexOwn0) : Math.max(0, ownPct - cptOwn);
    const ok = finite(proj) && proj > 0 && finite(sal) && sal > 0;
    const ceil = finite(ceil0) && ceil0 > 0 ? ceil0 : null;
    if (ok && ceil == null) hasCeil = false;
    return {
      i, id: String(p.id || ((p.team || '') + ':' + (p.name || i))), name: String(p.name || 'Player ' + (i + 1)),
      pos: String(p.pos || '').toUpperCase(), team: String(p.team || ''), opp: String(p.opp || ''),
      gid: String(p.gid || [p.team, p.opp].filter(Boolean).sort().join('-') || 'G'),
      sal: finite(sal) ? Math.round(sal) : 0, cptSal: finite(cptSal0) && cptSal0 > 0 ? Math.round(cptSal0) : Math.round((finite(sal) ? sal : 0) * 1.5),
      proj: finite(proj) ? proj : 0, ceil, own: ownPct, cptOwn, flexOwn, ok,
      dkId: p.dkId ? String(p.dkId) : '', cptId: p.cptId ? String(p.cptId) : ''
    };
  });
  P.forEach(p => { p.ceilUse = p.ceil != null ? p.ceil : p.proj * CEIL_FALLBACK; });
  const teams = [...new Set(P.filter(p => p.ok).map(p => p.team))];
  if (teams.length !== 2) throw new Error('Showdown needs exactly two teams with projections; found ' + teams.length + '.');
  return { P, hasCeil, teams };
}

/* Validate and normalise entries: six distinct players, captain first, both teams,
   under the cap. A broken entry is reported, never silently repaired. */
function prepareEntries(P, entries) {
  const out = [], problems = [];
  (entries || []).forEach((e, k) => {
    const ids = (e.ids || []).map(Number);
    const cpt = Number.isInteger(+e.cpt) ? +e.cpt : ids[0];
    const flex = ids.filter(i => i !== cpt);
    const label = e.label || ('#' + (k + 1));
    if (!Number.isInteger(cpt) || !P[cpt] || flex.length !== 5 || new Set(flex).size !== 5 || flex.some(i => !P[i])) {
      problems.push(label + ': needs one captain and five different FLEX players.'); return;
    }
    const all = [cpt].concat(flex);
    if (all.some(i => !P[i].ok)) { problems.push(label + ': uses a player without a projection.'); return; }
    const sal = P[cpt].cptSal + flex.reduce((s, i) => s + P[i].sal, 0);
    if (sal > 50000) { problems.push(label + ': is over the $50,000 cap.'); return; }
    if (new Set(all.map(i => P[i].team)).size < 2) { problems.push(label + ': needs players from both teams.'); return; }
    let cashMeta;
    const supplied = e.contestMeta || e;
    try { cashMeta = resolveCashLine(supplied); } catch(err) { problems.push(label + ': ' + err.message); return; }
    const type = classifyContest(supplied, TYPE_IDS.includes(e.type) ? e.type : 'se');
    const preset = TYPES.find(t => t.id === type);
    const fee = finite(num(e.fee)) && num(e.fee) >= 0 ? num(e.fee) : 1;
    if (supplied.fieldSize != null && e.entrants != null && supplied.fieldSize !== e.entrants) { problems.push(label + ': fieldSize contradicts entrants'); return; }
    const entrants = supplied.fieldSize != null ? supplied.fieldSize : Number.isInteger(+e.entrants) && +e.entrants >= 2 ? +e.entrants : preset.entrants;
    const canon = lineupKey(P, cpt, flex);
    out.push({
      key: e.key || canon, canon, label, cpt, flex, ids: all, sal, fee, type, entrants, ...cashMeta,
      contest: String(e.contest || '').slice(0, 120), source: e.source || 'workspace', idx: out.length
    });
  });
  return { entries: out, problems };
}

function lineupKey(P, cpt, flex) {
  return P[cpt].id + '|' + flex.map(i => P[i].id).sort().join(',');
}

/* ---------------------------------------------------------------- features */

function features(P, cpt, flex) {
  const c = P[cpt];
  let own = c.cptOwn, sal = c.cptSal, proj = 1.5 * c.proj, ceil = 1.5 * c.ceilUse;
  let lp = Math.log10(Math.max(c.cptOwn, 0.05) / 100);
  for (const i of flex) {
    const p = P[i];
    own += p.flexOwn; sal += p.sal; proj += p.proj; ceil += p.ceilUse;
    lp += Math.log10(Math.max(p.flexOwn, 0.05) / 100);
  }
  return { own, sal, dupe: lp, proj, ceil };
}

/* ---------------------------------------------------------------- the field */

async function sampleField(E, P, n, opts, onProgress) {
  const H = E.modelHelpers, site = E.SITES.dk_showdown, cap = site.cap;
  const floorOwn = opts.ownershipFloor || 0.0025;
  const floor = opts.fieldMinSalary == null ? Math.round(cap * 0.98) : opts.fieldMinSalary;
  const N = P.length, eligible = [], w = new Float64Array(N), cw = new Float64Array(N);
  const flexT = new Float64Array(N), cptT = new Float64Array(N);
  // The engine's sampler reads .sal/.cptSal/.team off the objects it is handed.
  const shaped = P.map(p => ({ sal: p.sal, cptSal: p.cptSal, team: p.team, pos: p.pos }));
  for (let i = 0; i < N; i++) {
    const p = P[i];
    cptT[i] = Math.max(floorOwn, p.cptOwn / 100);
    flexT[i] = Math.max(floorOwn, p.flexOwn / 100);
    w[i] = flexT[i]; cw[i] = cptT[i];
    if (p.ok) eligible.push(i);
  }
  const rand = H.rng((opts.seed || 216) ^ 0x5d0e);
  let lineups = null, count = 0, ownErr = null, cptErr = null;
  for (let pass = 0; pass < 3; pass++) {
    const target = pass < 2 ? Math.min(n, 6000) : n;
    lineups = new Int16Array(target * 6); count = 0;
    let guard = 0, last = Date.now();
    while (count < target && guard < target * 12) {
      guard++;
      const l = H.sampleShowdown(shaped, {}, w, cap, rand, site, eligible, floor, cw);
      if (l) { lineups.set(l.slice(0, 6), count * 6); count++; }
      if (guard === 600 && count < 25) break;
      if ((guard & 255) === 0 && Date.now() - last > 40) {
        await tick(); last = Date.now();
        if (onProgress) onProgress('field', (pass + count / target) / 3);
      }
    }
    if (!count) throw new Error('No legal opponent lineup could be sampled. Check salaries, projections and ownership.');
    const got = new Float64Array(N), gotC = new Float64Array(N);
    for (let k = 0; k < count; k++) { gotC[lineups[k * 6]]++; for (let s = 1; s < 6; s++) got[lineups[k * 6 + s]]++; }
    let fe = 0, ce = 0;
    for (const i of eligible) {
      const rf = got[i] / count, rc = gotC[i] / count;
      fe += Math.abs(rf - flexT[i]); ce += Math.abs(rc - cptT[i]);
      if (pass < 2) {
        const adj = (want, seen) => Math.min(3, Math.max(0.33, seen > 1e-6 ? want / seen : 3));
        w[i] = Math.max(1e-8, w[i] * adj(flexT[i], rf));
        cw[i] = Math.max(1e-8, cw[i] * adj(cptT[i], rc));
      }
    }
    ownErr = fe / eligible.length * 100; cptErr = ce / eligible.length * 100;
    if (onProgress) onProgress('field', (pass + 1) / 3);
  }
  return { lineups: lineups.subarray(0, count * 6), n: count, ownErr, cptErr, floor };
}

/* ---------------------------------------------------------------- weighted stats */

function normalise(w) {
  let s = 0; for (let i = 0; i < w.length; i++) s += w[i];
  if (!(s > 0)) { w.fill(1 / w.length); return w; }
  for (let i = 0; i < w.length; i++) w[i] /= s;
  return w;
}

/* Quantiles of y weighted by w over a subset given as an index list. */
function weightedQuantiles(idx, y, w, qs) {
  const order = idx.slice().sort((a, b) => y[a] - y[b]);
  let tot = 0; for (const i of order) tot += w[i];
  const out = []; let acc = 0, k = 0;
  for (const q of qs) {
    const goal = q * tot;
    while (k < order.length - 1 && acc + w[order[k]] < goal) { acc += w[order[k]]; k++; }
    out.push(y[order[k]]);
  }
  return out;
}

function median3(a) {
  const b = a.slice();
  for (let i = 1; i < a.length - 1; i++) { const s = [a[i - 1], a[i], a[i + 1]].sort((x, y) => x - y); b[i] = s[1]; }
  return b;
}

/* Equal-weight bins over x, then the field's p25/p50/p75/p90 of y inside each bin.
   Separately fitted quantile lines can cross (the textbook quantile-regression crossing
   problem), so the curves are median-smoothed and then sorted bin by bin. Each bin keeps
   its sorted members so an entry's conditional percentile is exact, not interpolated. */
function buildBands(x, ys, w) {
  const n = x.length;
  const order = Array.from({ length: n }, (_, i) => i).filter(i => w[i] > 0).sort((a, b) => x[a] - x[b] || a - b);
  let tot = 0; for (const i of order) tot += w[i];
  const bins = Array.from({ length: BINS }, () => []);
  let acc = 0;
  for (const i of order) {
    const b = Math.min(BINS - 1, Math.floor((acc + w[i] / 2) / tot * BINS));
    bins[b].push(i); acc += w[i];
  }
  const filled = bins.filter(b => b.length);
  const edges = filled.map(b => x[b[0]]);
  const xc = filled.map(b => { let s = 0, ww = 0; for (const i of b) { s += x[i] * w[i]; ww += w[i]; } return s / ww; });
  const out = { x: xc.map(v => round(v, 4)), edges, measures: {}, members: filled };
  for (const m of Object.keys(ys)) {
    const y = ys[m];
    const qs = filled.map(b => weightedQuantiles(b, y, w, [0.25, 0.5, 0.75, 0.9]));
    let cols = [0, 1, 2, 3].map(j => median3(qs.map(r => r[j])));
    const rows = qs.map((_, r) => [cols[0][r], cols[1][r], cols[2][r], cols[3][r]].sort((a, b) => a - b));
    const sortedY = filled.map(b => {
      const o = b.slice().sort((p, q) => y[p] - y[q]);
      const vals = new Float64Array(o.length), cum = new Float64Array(o.length);
      let c = 0; o.forEach((i, k) => { vals[k] = y[i]; c += w[i]; cum[k] = c; });
      return { vals, cum, tot: c };
    });
    out.measures[m] = {
      p25: rows.map(r => round(r[0], 2)), p50: rows.map(r => round(r[1], 2)),
      p75: rows.map(r => round(r[2], 2)), p90: rows.map(r => round(r[3], 2)), sorted: sortedY
    };
  }
  return out;
}

function binOf(edges, xv) {
  let lo = 0, hi = edges.length - 1;
  if (xv < edges[0]) return 0;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (edges[mid] <= xv) lo = mid; else hi = mid - 1; }
  return lo;
}

/* Weighted percentile (0–100) of value v inside a sorted bin, ties counted half. */
function pctInSorted(s, v) {
  const a = s.vals; let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  let hi2 = lo; while (hi2 < a.length && a[hi2] === v) hi2++;
  const below = lo ? s.cum[lo - 1] : 0, tied = (hi2 ? s.cum[hi2 - 1] : 0) - below;
  return Math.max(0, Math.min(100, Math.round((below + tied / 2) / s.tot * 100)));
}

function weightedPct(values, w, v) {
  let below = 0, tied = 0, tot = 0;
  for (let i = 0; i < values.length; i++) {
    tot += w[i];
    if (values[i] < v) below += w[i]; else if (values[i] === v) tied += w[i];
  }
  return tot > 0 ? Math.max(0, Math.min(100, Math.round((below + tied / 2) / tot * 100))) : 50;
}

/* ---------------------------------------------------------------- best possible */

/* Exact upper envelope over every legal lineup built from the top projected players:
   the best median and ceiling available at each ownership, salary or dupe-risk level.
   The pool is capped at 26 players so the enumeration stays near a second on a phone;
   the cap only drops players who cannot lift the envelope's top. */
async function frontier(P, domains) {
  const pool = P.filter(p => p.ok).sort((a, b) => b.proj - a.proj).slice(0, 26).map(p => p.i);
  const env = {};
  for (const a of AXES) {
    env[a] = {};
    for (const m of MEASURES) env[a][m] = new Float64Array(FRONTIER_BINS).fill(-Infinity);
  }
  const lo = {}, span = {};
  for (const a of AXES) { lo[a] = domains[a][0]; span[a] = (domains[a][1] - domains[a][0]) || 1; }
  const binX = (a, v) => Math.max(0, Math.min(FRONTIER_BINS - 1, Math.floor((v - lo[a]) / span[a] * FRONTIER_BINS)));
  let last = Date.now();
  const n = pool.length;
  const fo = pool.map(i => P[i].flexOwn), fs = pool.map(i => P[i].sal), fp = pool.map(i => P[i].proj);
  const fc = pool.map(i => P[i].ceilUse), fl = pool.map(i => Math.log10(Math.max(P[i].flexOwn, 0.05) / 100));
  const ft = pool.map(i => P[i].team);
  const teamA = ft[0];
  for (let c = 0; c < n; c++) {
    const C = P[pool[c]];
    const c0 = { own: C.cptOwn, sal: C.cptSal, proj: 1.5 * C.proj, ceil: 1.5 * C.ceilUse, lp: Math.log10(Math.max(C.cptOwn, 0.05) / 100), a: C.team === teamA ? 1 : 0 };
    if (c0.sal > 50000) continue;
    const idx = []; for (let k = 0; k < n; k++) if (k !== c) idx.push(k);
    const m = idx.length;
    for (let i1 = 0; i1 < m - 4; i1++) {
      const a1 = idx[i1], s1 = c0.sal + fs[a1]; if (s1 > 50000) continue;
      for (let i2 = i1 + 1; i2 < m - 3; i2++) {
        const a2 = idx[i2], s2 = s1 + fs[a2]; if (s2 > 50000) continue;
        for (let i3 = i2 + 1; i3 < m - 2; i3++) {
          const a3 = idx[i3], s3 = s2 + fs[a3]; if (s3 > 50000) continue;
          for (let i4 = i3 + 1; i4 < m - 1; i4++) {
            const a4 = idx[i4], s4 = s3 + fs[a4]; if (s4 > 50000) continue;
            const o4 = c0.own + fo[a1] + fo[a2] + fo[a3] + fo[a4];
            const p4 = c0.proj + fp[a1] + fp[a2] + fp[a3] + fp[a4];
            const e4 = c0.ceil + fc[a1] + fc[a2] + fc[a3] + fc[a4];
            const l4 = c0.lp + fl[a1] + fl[a2] + fl[a3] + fl[a4];
            const t4 = c0.a + (ft[a1] === teamA) + (ft[a2] === teamA) + (ft[a3] === teamA) + (ft[a4] === teamA);
            for (let i5 = i4 + 1; i5 < m; i5++) {
              const a5 = idx[i5], s5 = s4 + fs[a5]; if (s5 > 50000) continue;
              const ta = t4 + (ft[a5] === teamA); if (ta === 0 || ta === 6) continue;
              const vo = o4 + fo[a5], vp = p4 + fp[a5], ve = e4 + fc[a5], vl = l4 + fl[a5];
              let b = binX('own', vo); if (vp > env.own.proj[b]) env.own.proj[b] = vp; if (ve > env.own.ceil[b]) env.own.ceil[b] = ve;
              b = binX('sal', s5); if (vp > env.sal.proj[b]) env.sal.proj[b] = vp; if (ve > env.sal.ceil[b]) env.sal.ceil[b] = ve;
              b = binX('dupe', vl); if (vp > env.dupe.proj[b]) env.dupe.proj[b] = vp; if (ve > env.dupe.ceil[b]) env.dupe.ceil[b] = ve;
            }
          }
        }
      }
    }
    if (Date.now() - last > 40) { await tick(); last = Date.now(); }
  }
  const out = {};
  for (const a of AXES) {
    out[a] = {};
    for (const m of MEASURES) {
      const pts = [];
      env[a][m].forEach((v, b) => { if (v > -Infinity) pts.push([lo[a] + (b + 0.5) / FRONTIER_BINS * span[a], v]); });
      const ys = median3(pts.map(p => p[1]));
      out[a][m] = pts.map((p, k) => [round(p[0], 4), round(ys[k], 2)]);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- worlds */

function gameStructure(E, P) {
  const H = E.modelHelpers, roles = H.assignRoles(P), games = {}, chol = [], warn = [];
  P.forEach((p, i) => { if (p.ok) (games[p.gid] || (games[p.gid] = [])).push(i); });
  for (const g of Object.keys(games)) {
    const ids = games[g], n = ids.length, M = new Float64Array(n * n);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const ia = ids[a], ib = ids[b], same = P[ia].team === P[ib].team;
      M[a * n + b] = a === b ? 1 : H.corrBetween(roles[ia], roles[ib], same, same && roles[ia] === roles[ib]);
    }
    const c = H.cholesky(M, n);
    if (c.failed) warn.push('Game ' + g + ': the correlation matrix failed, so scores were drawn independently.');
    chol.push({ L: c.L, ids, n });
  }
  const mu = new Float64Array(P.length), sigma = new Float64Array(P.length), isNorm = new Uint8Array(P.length);
  P.forEach((p, i) => {
    mu[i] = Math.max(0, p.proj || 0);
    const cv = H.cvFor(p.pos, mu[i]);
    if (p.pos === 'DST') { isNorm[i] = 1; sigma[i] = cv * Math.max(mu[i], 3); }
    else sigma[i] = Math.sqrt(Math.log(1 + cv * cv));
  });
  return { chol, mu, sigma, isNorm, warn };
}

async function runWorlds(E, P, field, weights, entries, bench, opts, onProgress) {
  const G = gameStructure(E, P), rand = E.modelHelpers.rng((opts.seed || 216) ^ 0x2c1b3c6d), gauss = E.gauss;
  const worlds = opts.worlds, NP = P.length;
  const nf = Math.min(field.n, opts.fieldSim || 3000);
  const L = field.lineups;
  const score = new Float64Array(NP), z = new Float64Array(Math.max(64, ...G.chol.map(g => g.n)));
  const fScore = new Float64Array(nf), keys = new Float64Array(nf);
  const types = TYPE_IDS, T = types.length;
  const K = entries.length, B = bench.length;
  // finish[entry][type][bin] counts; bench hits per type
  const finish = entries.map(() => types.map(() => new Float64Array(6)));
  const bTop1 = types.map(() => new Float64Array(B)), bCash = types.map(() => new Float64Array(B));
  const eCashBaseline = types.map(() => new Float64Array(K));
  const cashCuts = [...new Set(entries.map(e => e.cashLine))].sort((a,b)=>a-b);
  const entryThresholds = types.map(() => ({}));
  const eTop1 = types.map(() => new Float64Array(K)), eCash = types.map(() => new Float64Array(K));
  const bestCpt = new Float64Array(NP), bestAny = new Float64Array(NP);
  let anyTop1 = 0, anyCash = 0;
  const th = new Float64Array(T * FINISH_CUTS.length);
  const wf = types.map(t => { const a = new Float64Array(nf); let s = 0; for (let i = 0; i < nf; i++) { a[i] = weights[t][i]; s += a[i]; } for (let i = 0; i < nf; i++) a[i] /= s; return a; });
  const lineScore = (ids6) => { let v = score[ids6[0]] * 1.5; for (let s = 1; s < 6; s++) v += score[ids6[s]]; return v; };
  const eIds = entries.map(e => e.ids), bIds = bench.map(k => Array.from(L.subarray(k * 6, k * 6 + 6)));
  const eScore = new Float64Array(K), bScore = new Float64Array(B);
  const t0 = Date.now(); let last = t0;
  for (let s = 0; s < worlds; s++) {
    for (const g of G.chol) {
      const { L: Lc, ids, n } = g;
      for (let a = 0; a < n; a++) z[a] = gauss(rand);
      for (let a = 0; a < n; a++) {
        let v = 0; for (let b = 0; b <= a; b++) v += Lc[a * n + b] * z[b];
        const id = ids[a];
        score[id] = G.isNorm[id] ? G.mu[id] + G.sigma[id] * v : G.mu[id] * Math.exp(G.sigma[id] * v - G.sigma[id] * G.sigma[id] / 2);
      }
    }
    for (let f = 0; f < nf; f++) {
      const o = f * 6; let v = score[L[o]] * 1.5;
      v += score[L[o + 1]] + score[L[o + 2]] + score[L[o + 3]] + score[L[o + 4]] + score[L[o + 5]];
      fScore[f] = v;
      // pack (score, index) so one native numeric sort orders both
      keys[f] = Math.floor(Math.max(0, v) * 1000) * 8192 + f;
    }
    keys.sort();
    // One cumulative traversal per type for all legacy bins and entry cash lines.
    const cuts=[...new Set(FINISH_CUTS.concat(cashCuts))].sort((a,b)=>a-b);
    for (let t=0;t<T;t++) {
      const found={};let acc=0,c=0;
      while(c<cuts.length && cuts[c]===0){found[cuts[c++]]=Infinity;}
      for(let r=nf-1;r>=0 && c<cuts.length;r--){
        const id=keys[r]%8192;acc+=wf[t][id];
        while(c<cuts.length && acc>=cuts[c]) found[cuts[c++]]=fScore[id];
      }
      while(c<cuts.length) found[cuts[c++]]=-Infinity;
      found[1]=-Infinity;
      FINISH_CUTS.forEach((cut,i)=>{th[t*FINISH_CUTS.length+i]=found[cut];});
      cashCuts.forEach(cut=>{entryThresholds[t][cut]=found[cut];});
    }
    let bestV = fScore[keys[nf - 1] % 8192], bestIds = null;
    for (let k = 0; k < K; k++) { eScore[k] = lineScore(eIds[k]); if (eScore[k] > bestV) { bestV = eScore[k]; bestIds = eIds[k]; } }
    if (!bestIds) { const o = (keys[nf - 1] % 8192) * 6; bestIds = L.subarray(o, o + 6); }
    bestCpt[bestIds[0]]++; for (let q = 0; q < 6; q++) bestAny[bestIds[q]]++;
    for (let k = 0; k < B; k++) bScore[k] = lineScore(bIds[k]);
    let hitTop1 = false, hitCash = false;
    for (let t = 0; t < T; t++) {
      const o = t * FINISH_CUTS.length, t1 = th[o], tc = th[o + 3];
      for (let k = 0; k < K; k++) {
        const v = eScore[k];
        let bin = 5;
        for (let c = 0; c < FINISH_CUTS.length; c++) if (v > th[o + c]) { bin = c; break; }
        finish[k][t][bin]++;
        if (v > t1) { eTop1[t][k]++; if (types[t] === entries[k].type) hitTop1 = true; }
        if (v > tc) eCashBaseline[t][k]++;
        if (v > entryThresholds[t][entries[k].cashLine]) { eCash[t][k]++; if (types[t] === entries[k].type) hitCash = true; }
      }
      for (let k = 0; k < B; k++) { if (bScore[k] > t1) bTop1[t][k]++; if (bScore[k] > tc) bCash[t][k]++; }
    }
    if (hitTop1) anyTop1++; if (hitCash) anyCash++;
    const now = Date.now();
    if (now - last > 40) { last = now; await tick(); if (onProgress) onProgress('worlds', (s + 1) / worlds); }
  }
  return {
    worlds, fieldSim: nf, warn: G.warn, anyCashHits:anyCash,
    eCashHits:eCash.map(a=>Array.from(a)), eCashBaseline:eCashBaseline.map(a=>Array.from(a,v=>v/worlds*100)),
    finish: finish.map(rows => rows.map(r => Array.from(r, v => v / worlds * 100))),
    eTop1: eTop1.map(a => Array.from(a, v => v / worlds * 100)), eCash: eCash.map(a => Array.from(a, v => v / worlds * 100)),
    bTop1: bTop1.map(a => Array.from(a, v => v / worlds * 100)), bCash: bCash.map(a => Array.from(a, v => v / worlds * 100)),
    bestCpt: Array.from(bestCpt, v => v / worlds * 100), bestAny: Array.from(bestAny, v => v / worlds * 100),
    pTop1: anyTop1 / worlds * 100, pCash: anyCash / worlds * 100
  };
}

/* ---------------------------------------------------------------- scripts */

/* A plain-language name for what has to happen. Rules, not a model: the captain's team
   and position, whether both quarterbacks are rostered, and the team split. */
function scriptOf(P, e) {
  const c = P[e.cpt], all = e.ids.map(i => P[i]);
  const qbs = all.filter(p => p.pos === 'QB').map(p => p.team);
  const dst = all.filter(p => p.pos === 'DST').map(p => p.team);
  const counts = {}; all.forEach(p => { counts[p.team] = (counts[p.team] || 0) + 1; });
  const heavy = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  if (qbs.length === 2 && ['QB', 'WR', 'TE'].includes(c.pos)) return 'Shootout';
  if (c.pos === 'RB' || c.pos === 'DST' || c.pos === 'K') return c.team + ' control';
  if (dst.length && dst[0] !== c.team && counts[c.team] <= 3) return dst[0] + ' control';
  if (['QB', 'WR', 'TE'].includes(c.pos) && qbs.includes(c.team)) return c.team + ' through the air';
  return heavy + '-leaning';
}

function splitOf(P, e) {
  const counts = {}; e.ids.forEach(i => { counts[P[i].team] = (counts[P[i].team] || 0) + 1; });
  const t = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  return counts[t[0]] === 3 ? '3-3' : counts[t[0]] + '-' + counts[t[1]] + ' ' + t[0];
}

/* ---------------------------------------------------------------- analyze */

async function analyze(input, opts) {
  opts = opts || {};
  const E = opts.engine || root.DDFS;
  if (!E || !E.modelHelpers || !E.modelHelpers.sampleShowdown || !E.gauss) throw new Error('The DFS engine is not loaded.');
  const prog = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const seed = Number.isInteger(opts.seed) ? opts.seed : 216;
  const { P, hasCeil, teams } = preparePlayers(input.players);
  const { entries, problems } = prepareEntries(P, input.entries);
  const settings = input.settings || {};
  const fieldN = Math.max(2000, Math.min(60000, opts.fieldN || 24000));
  const worlds = Math.max(400, Math.min(20000, opts.worlds || 2500));
  const started = Date.now();

  if (prog) prog('field', 0);
  const field = await sampleField(E, P, fieldN, { seed, fieldMinSalary: settings.fieldMinSalary, ownershipFloor: settings.ownershipFloor }, prog);
  const nF = field.n, L = field.lineups;

  // features of every field lineup
  const fx = { own: new Float64Array(nF), sal: new Float64Array(nF), dupe: new Float64Array(nF), proj: new Float64Array(nF), ceil: new Float64Array(nF) };
  const fKeys = new Array(nF);
  for (let k = 0; k < nF; k++) {
    const o = k * 6, cpt = L[o], flex = [L[o + 1], L[o + 2], L[o + 3], L[o + 4], L[o + 5]];
    const f = features(P, cpt, flex);
    fx.own[k] = f.own; fx.sal[k] = f.sal; fx.dupe[k] = f.dupe; fx.proj[k] = f.proj; fx.ceil[k] = f.ceil;
    fKeys[k] = lineupKey(P, cpt, flex);
  }
  entries.forEach(e => { e.feat = features(P, e.cpt, e.flex); e.split = splitOf(P, e); e.script = scriptOf(P, e); });

  // field sharpness weights per contest type
  let m = 0, s2 = 0; for (let k = 0; k < nF; k++) m += fx.proj[k]; m /= nF;
  for (let k = 0; k < nF; k++) s2 += (fx.proj[k] - m) * (fx.proj[k] - m);
  const sd = Math.sqrt(s2 / nF) || 1;
  const weights = {};
  for (const t of TYPES) {
    const w = new Float64Array(nF);
    for (let k = 0; k < nF; k++) w[k] = Math.exp(t.beta * (fx.proj[k] - m) / sd);
    weights[t.id] = normalise(w);
  }

  // weighted frequency of each exact lineup → expected copies
  const freq = {};
  for (const t of TYPE_IDS) {
    const mp = new Map(), w = weights[t];
    for (let k = 0; k < nF; k++) mp.set(fKeys[k], (mp.get(fKeys[k]) || 0) + w[k]);
    freq[t] = mp;
  }

  // domains for the best-possible envelope: the field's range widened to every entry
  const domains = {};
  for (const a of AXES) {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < nF; k++) { const v = fx[a][k]; if (v < lo) lo = v; if (v > hi) hi = v; }
    entries.forEach(e => { lo = Math.min(lo, e.feat[a]); hi = Math.max(hi, e.feat[a]); });
    const pad = (hi - lo) * 0.02; domains[a] = [lo - pad, hi + pad];
  }
  if (prog) prog('frontier', 0);
  const best = await frontier(P, domains);
  if (prog) prog('frontier', 1);

  // bands per type × axis
  const bands = {};
  for (const t of TYPE_IDS) {
    bands[t] = {};
    for (const a of AXES) bands[t][a] = buildBands(fx[a], { proj: fx.proj, ceil: fx.ceil }, weights[t]);
  }

  // faint field dots: a weighted sample per type
  const cloud = {};
  const crand = E.modelHelpers.rng(seed ^ 0x77c1);
  for (const t of TYPE_IDS) {
    const w = weights[t], cum = new Float64Array(nF); let c = 0;
    for (let k = 0; k < nF; k++) { c += w[k]; cum[k] = c; }
    const pts = [];
    for (let j = 0; j < 110; j++) {
      const r = crand() * c; let lo = 0, hi = nF - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
      pts.push([round(fx.own[lo], 2), fx.sal[lo], round(fx.dupe[lo], 3), round(fx.proj[lo], 2), round(fx.ceil[lo], 2)]);
    }
    cloud[t] = pts;
  }

  // worlds: entries plus a benchmark sample of field lineups for percentile contributors
  const nb = Math.min(240, nF);
  const bench = Array.from({ length: nb }, (_, k) => k);
  if (prog) prog('worlds', 0);
  const sim = entries.length ? await runWorlds(E, P, field, weights, entries, bench, { seed, worlds, fieldSim: 3000 }, prog) : null;

  // per-entry grades and contributors
  const benchW = {};
  for (const t of TYPE_IDS) { const a = new Float64Array(nb); for (let k = 0; k < nb; k++) a[k] = weights[t][k]; benchW[t] = a; }
  const fieldUniq = {};
  for (const t of TYPE_IDS) { const a = new Float64Array(nF); for (let k = 0; k < nF; k++) a[k] = -(freq[t].get(fKeys[k]) || 0); fieldUniq[t] = a; }
  const fieldCeil = fx.ceil;
  entries.forEach((e, k) => {
    e.cashInterval = {}; e.cashHits = {}; e.grade = {}; e.contrib = {}; e.score = {}; e.finish = {}; e.top1 = {}; e.cash = {}; e.dupes = {};
    TYPE_IDS.forEach((t, ti) => {
      const preset = TYPES[ti];
      const ent = t === e.type ? e.entrants : preset.entrants;
      const fq = freq[t].get(e.canon) || 0;
      e.dupes[t] = round(fq * (ent - 1), 2);
      e.grade[t] = {};
      for (const a of AXES) {
        const bb = bands[t][a], b = binOf(bb.edges, e.feat[a]);
        e.grade[t][a] = {};
        for (const mm of MEASURES) e.grade[t][a][mm] = pctInSorted(bb.measures[mm].sorted[b], e.feat[mm]);
      }
      const top1 = sim ? sim.eTop1[ti][k] : 0, cash = sim ? sim.eCash[ti][k] : 0;
      e.top1[t] = round(top1, 2); e.cash[t] = cash;
      e.cashHits[t] = sim ? sim.eCashHits[ti][k] : 0; e.cashInterval[t] = sim ? wilson95(e.cashHits[t],sim.worlds) : null;
      e.finish[t] = sim ? sim.finish[k][ti].map(v => round(v, 1)) : [0, 0, 0, 0, 0, 100];
      const c = {
        pts: e.grade[t].own.proj,
        ceil: weightedPct(fieldCeil, weights[t], e.feat.ceil),
        top1: sim ? weightedPct(sim.bTop1[ti], benchW[t], top1) : 50,
        cash: sim ? weightedPct(sim.bCash[ti], benchW[t], sim.eCashBaseline[ti][k]) : 50,
        unique: weightedPct(fieldUniq[t], weights[t], -fq)
      };
      e.contrib[t] = c;
      if (t === 'cash' || e.type === 'cash') { e.score[t]={score:null,word:'Unavailable'}; return; }
      const W = SCORE_WEIGHTS[t]; let sc = 0;
      for (const key of Object.keys(W)) sc += W[key] * c[key];
      e.score[t] = { score: Math.round(sc), word: gradeWord(Math.round(sc)) };
    });
  });

  // portfolio, exposure, captains, scripts, overlap
  const fees = entries.reduce((s, e) => s + e.fee, 0);
  const usd = new Float64Array(P.length), cptUsd = new Float64Array(P.length), lineups = new Float64Array(P.length);
  entries.forEach(e => { e.ids.forEach(i => { usd[i] += e.fee; lineups[i]++; }); cptUsd[e.cpt] += e.fee; });
  const exposure = P.filter(p => usd[p.i] > 0).map(p => ({
    i: p.i, name: p.name, pos: p.pos, team: p.team, usd: round(usd[p.i], 2), cptUsd: round(cptUsd[p.i], 2), lineups: lineups[p.i],
    share: fees > 0 ? round(usd[p.i] / fees * 100, 1) : 0, field: round(p.own, 1), simBest: sim ? round(sim.bestAny[p.i], 1) : null
  })).sort((a, b) => b.usd - a.usd || b.lineups - a.lineups);
  const captainPool = P.filter(p => p.ok && (cptUsd[p.i] > 0 || p.cptOwn >= 5 || (sim && sim.bestCpt[p.i] >= 5)));
  const captains = captainPool.map(p => ({
    i: p.i, name: p.name, pos: p.pos, team: p.team,
    you: fees > 0 ? round(cptUsd[p.i] / fees * 100, 1) : 0, field: round(p.cptOwn, 1), simBest: sim ? round(sim.bestCpt[p.i], 1) : null
  })).sort((a, b) => b.you - a.you || b.field - a.field).slice(0, 8);
  const scriptMap = {};
  entries.forEach(e => { const r = scriptMap[e.script] || (scriptMap[e.script] = { name: e.script, usd: 0, ids: [] }); r.usd += e.fee; r.ids.push(e.idx); });
  const scripts = Object.values(scriptMap).sort((a, b) => b.usd - a.usd);
  const overlap = entries.map(a => entries.map(b => a.ids.filter(i => b.ids.includes(i)).length));
  const avgCopies = entries.length ? entries.reduce((s, e) => s + e.dupes[e.type], 0) / entries.length : 0;

  const warnings = problems.slice();
  // A Showdown pool's total ownership sums to about 600% (six roster slots). Far below that,
  // the ownership projection is missing or partial and the field is mostly the sampler's guess.
  const ownSum = P.filter(p => p.ok).reduce((s, p) => s + p.own, 0);
  if (ownSum < 300) warnings.push('Ownership adds up to only ' + Math.round(ownSum) + '% across the pool (a full Showdown pool is about 600%), so the simulated field is mostly guesswork. Add ownership in DFS Labs before trusting a grade.');
  if (!hasCeil) warnings.push('Some players have no ceiling, so ceiling views use 1.6× the median for them.');
  if (field.ownErr > 3) warnings.push('The sampled field misses its ownership targets by ' + round(field.ownErr, 1) + ' points on average.');
  if (sim) warnings.push(...sim.warn);

  return {
    version: VERSION, seed, worlds: sim ? sim.worlds : 0, fieldN: nF, fieldSim: sim ? sim.fieldSim : 0,
    elapsedMs: Date.now() - started, teams, hasCeil,
    types: TYPES.map(t => ({ ...t })), weightsDoc: SCORE_WEIGHTS, names: CONTRIBUTOR_NAMES,
    players: P.map(p => ({ i: p.i, id: p.id, name: p.name, pos: p.pos, team: p.team, sal: p.sal, cptSal: p.cptSal, proj: p.proj, ceil: p.ceil, own: p.own, cptOwn: p.cptOwn, ok: p.ok })),
    fieldStats: { ownErr: round(field.ownErr, 2), cptErr: round(field.cptErr, 2), salaryFloor: field.floor },
    bands: stripBands(bands), frontier: best, cloud, domains,
    entries: entries.map(e => ({
      key: e.key, label: e.label, idx: e.idx, cpt: e.cpt, flex: e.flex, ids: e.ids, sal: e.sal, fee: e.fee, type: e.type,
      entrants: e.entrants, contest: e.contest, source: e.source, cashLine:e.cashLine,cashLineSource:e.cashLineSource,cashLineSourceText:e.cashLineSourceText,flatPositivePrizes:e.flatPositivePrizes,cashInterval:e.cashInterval,cashHits:e.cashHits, feat: e.feat, split: e.split, script: e.script,
      grade: e.grade, contrib: e.contrib, score: e.score, finish: e.finish, top1: e.top1, cash: e.cash, dupes: e.dupes
    })),
    portfolio: { fees: round(fees, 2), entries: entries.length, pTop1: sim ? round(sim.pTop1, 1) : 0, cashHits:sim ? sim.anyCashHits : 0,cashInterval:sim ? wilson95(sim.anyCashHits,sim.worlds) : null,pCash: sim ? sim.pCash : 0, avgCopies: round(avgCopies, 2), captains: new Set(entries.map(e => e.cpt)).size },
    exposure, captains, scripts, overlap, warnings
  };
}

function stripBands(bands) {
  const out = {};
  for (const t of Object.keys(bands)) {
    out[t] = {};
    for (const a of Object.keys(bands[t])) {
      const b = bands[t][a];
      out[t][a] = { x: b.x };
      for (const mm of Object.keys(b.measures)) {
        const q = b.measures[mm];
        out[t][a][mm] = { p25: q.p25, p50: q.p50, p75: q.p75, p90: q.p90 };
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------- DK entries CSV */

/* Parses DraftKings' "Edit entries" CSV (Entry ID, Contest Name, Contest ID, Entry Fee,
   CPT, FLEX × 5). Player cells read "Name (12345678)". Players are matched by DK ID first
   and by normalised name second; anything unmatched is reported, never guessed. */
function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}
function normName(s) {
  return String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function contestTypeFromName(name, fallback) {
  return classifyContest({name},fallback || 'se');
}
function parseEntriesCsv(text, players) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { entries: [], problems: ['The file is empty.'] };
  const head = parseCsvLine(lines[0]).map(h => h.toLowerCase());
  const col = name => head.indexOf(name);
  const cCpt = col('cpt'), cFee = col('entry fee'), cName = col('contest name'), cId = col('contest id'), cEntry = col('entry id');
  if (cCpt < 0) return { entries: [], problems: ['No CPT column. Download "Edit entries" from DraftKings for a Showdown contest.'] };
  const flexCols = head.map((h, i) => h === 'flex' ? i : -1).filter(i => i >= 0).slice(0, 5);
  if (flexCols.length !== 5) return { entries: [], problems: ['Expected five FLEX columns.'] };
  const byId = new Map(), byName = new Map();
  players.forEach((p, i) => {
    if (p.dkId) byId.set(String(p.dkId), i); if (p.cptId) byId.set(String(p.cptId), i);
    const k = normName(p.name); if (!byName.has(k)) byName.set(k, i); else byName.set(k, -1);
  });
  const find = cell => {
    const m = String(cell || '').match(/\((\d+)\)\s*$/);
    if (m && byId.has(m[1])) return byId.get(m[1]);
    const k = normName(cell); const i = byName.get(k);
    return i == null ? null : i;
  };
  const entries = [], problems = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = parseCsvLine(lines[r]);
    const cptCell = cells[cCpt];
    if (!cptCell || !/[a-z]/i.test(cptCell)) continue;          // the player list to the right has no CPT cell
    const ids = [find(cptCell)].concat(flexCols.map(c => find(cells[c])));
    if (ids.some(i => i == null || i < 0)) {
      problems.push('Row ' + (r + 1) + ': could not match ' + [cptCell].concat(flexCols.map(c => cells[c])).filter((_, j) => ids[j] == null || ids[j] < 0).join(', ') + '.');
      continue;
    }
    const contest = cName >= 0 ? cells[cName] : '';
    const feeRaw = cFee >= 0 ? String(cells[cFee] || '').replace(/[$,]/g, '') : '';
    entries.push({
      cpt: ids[0], ids, fee: finite(+feeRaw) ? +feeRaw : 1, contest, contestId: cId >= 0 ? cells[cId] : '',
      entryId: cEntry >= 0 ? cells[cEntry] : '', type: contestTypeFromName(contest), source: 'dk-csv'
    });
  }
  return { entries, problems };
}

/* ---------------------------------------------------------------- demo slate */

/* A synthetic Showdown slate. Every team and player is INVENTED, and the numbers are
   generated, not taken from any projection source. It exists so the page works signed
   out, and so the tests have fixtures that can never leak paid data. */
function demoSlate() {
  const teams = [
    { t: 'HBR', o: 'MSA', names: ['Rowan Vance', 'Ellis Marlow', 'Tobin Reyes', 'Cassius Hart', 'Jalen Pryor', 'Wes Thornbury', 'Nico Albrecht', 'Dorian Fisk', 'Ike Stanhope', 'Bram Kessler', 'Harbor D/ST'] },
    { t: 'MSA', o: 'HBR', names: ['Quinn Delacroix', 'Malik Ostrander', 'Reggie Calloway', 'Sterling Abara', 'Davion Pike', 'Hollis Wren', 'Corbin Lusk', 'Emmett Varga', 'Paxton Drury', 'Felix Oduya', 'Mesa D/ST'] }
  ];
  const shape = [
    ['QB', 11000, 23.6, 33.5, 70, 16], ['RB', 9600, 18.4, 31.0, 48, 11], ['WR', 9200, 17.9, 31.8, 45, 10],
    ['WR', 7400, 13.1, 25.4, 30, 5], ['TE', 6000, 10.6, 20.2, 28, 3.4], ['WR', 4800, 7.4, 15.8, 14, 1.2],
    ['RB', 3200, 6.1, 13.4, 13, 0.8], ['TE', 2200, 4.2, 10.1, 10, 0.5], ['WR', 1000, 2.6, 7.0, 7, 0.4],
    ['K', 4400, 8.6, 14.4, 20, 0.7], ['DST', 3600, 5.0, 11.5, 9, 0.8]
  ];
  const tilt = [1.0, 0.94];
  const players = [];
  teams.forEach((tm, ti) => tm.names.forEach((name, k) => {
    const [pos, sal, proj, ceil, own, cptOwn] = shape[k];
    const f = tilt[ti], salAdj = Math.round(sal * (ti ? 0.96 : 1) / 100) * 100;
    players.push({
      id: tm.t + ':' + name, name, pos, team: tm.t, opp: tm.o, gid: 'HBR-MSA', sal: salAdj, cptSal: Math.round(salAdj * 1.5),
      proj: round(proj * f, 1), ceil: round(ceil * f, 1), own: round(own * (ti ? 0.92 : 1.08), 1), cptOwn: round(cptOwn * (ti ? 0.9 : 1.1), 1)
    });
  }));
  const idx = n => players.findIndex(p => p.name === n);
  const L = (cpt, flex, fee, type, entrants, contest) => ({ cpt: idx(cpt), ids: [idx(cpt)].concat(flex.map(idx)), fee, type, entrants, contest, source: 'demo' });
  const entries = [
    L('Rowan Vance', ['Quinn Delacroix', 'Jalen Pryor', 'Reggie Calloway', 'Sterling Abara', 'Paxton Drury'], 15, 'se', 3100, 'Demo single entry'),
    L('Quinn Delacroix', ['Rowan Vance', 'Jalen Pryor', 'Reggie Calloway', 'Sterling Abara', 'Ike Stanhope'], 6, 'mid', 4400, 'Demo 5-entry max'),
    L('Ellis Marlow', ['Tobin Reyes', 'Rowan Vance', 'Reggie Calloway', 'Harbor D/ST', 'Emmett Varga'], 5, 'se', 4700, 'Demo single entry'),
    L('Malik Ostrander', ['Rowan Vance', 'Tobin Reyes', 'Reggie Calloway', 'Nico Albrecht', 'Mesa D/ST'], 4, 'flag', 88000, 'Demo flagship'),
    L('Rowan Vance', ['Wes Thornbury', 'Nico Albrecht', 'Hollis Wren', 'Tobin Reyes', 'Quinn Delacroix'], 3, 'se', 5900, 'Demo single entry'),
    L('Quinn Delacroix', ['Reggie Calloway', 'Sterling Abara', 'Ellis Marlow', 'Bram Kessler', 'Ike Stanhope'], 1, 'se', 8900, 'Demo single entry')
  ];
  return { id: 'demo', site: 'dk_showdown', source: 'Synthetic demo slate · invented teams and players', as_of: null, players, entries, settings: { fieldMinSalary: 48000 } };
}

return {
  resolveCashLine, classifyContest, formatSimulationPct, wilson95,
  VERSION, TYPES, SCORE_WEIGHTS, CONTRIBUTOR_NAMES, AXES, MEASURES, FINISH_CUTS,
  analyze, preparePlayers, prepareEntries, features, gradeWord, lineupKey, parseEntriesCsv, parseCsvLine,
  contestTypeFromName, normName, demoSlate, scriptOf, splitOf,
  _internal: { buildBands, binOf, pctInSorted, weightedPct, weightedQuantiles, median3, sampleField, frontier, runWorlds }
};
});
