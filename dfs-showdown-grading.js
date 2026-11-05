/* ============================================================================
   dfs-showdown-grading.js — pre-lock checks, prize tables, big-contest ROI tables,
   the post-slate pool scorecard and field calibration for DFS SHOWDOWN.

   DraftKings NFL Showdown only. Pure computation: no DOM, no network, no storage.
   Loaded by dfs-showdown.html after dfs-showdown.js and dfs-ledger.js, and by
   tests/dfs-showdown-grading.test.js and tools/showdown-grade.mjs in node.

   ⚠️ NO PROJECTION, OWNERSHIP OR STANDINGS DATA LIVES IN THIS FILE. This repo is
   public. Inputs are the signed-in user's own workspace and the DK files they load.

   ⚠️ EVERYTHING HERE IS GRADING SCAFFOLDING, NOT A RESULT.
   - The pre-lock checks are tracked hypotheses from one audited slate (TNF CAR@GB,
     Oct 29 2026). They warn, they never block, and they stay hypotheses until the
     user's own ledger supports them.
   - The big-contest ROI is an extrapolation from a sampled field, disclosed as such.
   - The scorecard is ONE slate. Lineups in a pool share players, so 150 lineups are
     not 150 independent results.
   - Calibration fits one knob (the field-sharpness preset) per contest type by
     matching the real field's mean projection. It is descriptive until repeated.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DDShowdownGrading = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
'use strict';

const VERSION = 'showdown-grading-1';
const CAP = 50000;
function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; }
function normName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, '').replace(/[.'’`]/g, '').replace(/-/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/* =====================================================================================
   1. PRE-LOCK CHECKS — the TNF CAR@GB audit lessons, as warnings.
   ===================================================================================== */

const CHECK_SOURCE = 'TNF CAR@GB post-slate audit, Oct 29 2026';
const CHECK_LABEL = 'Tracked hypotheses from one audited slate, not rules. Warnings only: nothing here blocks an export.';
const RULES = {
  exposure: { id: 'exposure-thesis', title: 'Exposure thesis gate', threshold: 15,
    rule: 'Any player 15+ points off field ownership, either way, needs a written reason, or gets pulled toward the field.' },
  dogQb: { id: 'underdog-qb-cap', title: 'Underdog QB cap', margin: 10,
    rule: 'Underdog QB capped near field +10 unless there is a written edge; below field when their line is missing starters against a top-half pass rush.' },
  favCatchers: { id: 'favorite-pass-catchers', title: "Favorite's top two pass-catchers", margin: 10,
    rule: "The favorite's top two pass-catchers combined no lower than field minus 10, unless projections move them." },
  cashPunt: { id: 'double-up-punt', title: 'Double Up punt', minProj: 3, altCost: 2,
    rule: 'Double Ups: no player projected under 3 points unless every alternative costs more than about 2 projected points; log the trade-off.' },
  kicker: { id: 'kicker-make-rate', title: 'Kicker make-rate note',
    rule: 'Kickers get a season make-rate note before they enter the pool.' }
};
const MIN_EXPOSURE_ENTRIES = 5;

function pidOf(p) { return String(p.id || ((p.team || '') + ':' + (p.name || p.i))); }

/* Which team is favoured. A supplied favourite (the user's pick, or a betting line they
   typed) wins; otherwise the team with more total projected points, which is only a
   proxy and is labelled one. Within 3% the call is too close and the two
   favourite/underdog checks are skipped rather than guessed. */
function favoriteOf(players, override) {
  const teams = [...new Set(players.filter(p => p.ok !== false && p.team).map(p => p.team))];
  if (override && teams.includes(override)) return { team: override, dog: teams.find(t => t !== override) || null, source: 'user' };
  const tot = {}; players.forEach(p => { if (p.ok !== false && finite(p.proj)) tot[p.team] = (tot[p.team] || 0) + p.proj; });
  const [a, b] = teams.sort((x, y) => (tot[y] || 0) - (tot[x] || 0));
  if (!a || !b) return { team: null, dog: null, source: 'none' };
  if ((tot[a] - tot[b]) / Math.max(1, tot[a]) < 0.03) return { team: null, dog: null, source: 'too-close', totals: tot };
  return { team: a, dog: b, source: 'projection', totals: tot };
}

/* Best lineup with the same captain and no FLEX player projected under minProj.
   Captain stays fixed so the comparison is about the punt, not the build. */
function bestWithoutPunts(players, cpt, minProj) {
  const C = players[cpt];
  const pool = players.filter(p => p.ok !== false && p.i !== cpt && finite(p.proj) && p.proj >= minProj && finite(p.sal))
    .sort((a, b) => b.proj - a.proj).slice(0, 30);
  const n = pool.length, room = CAP - C.cptSal;
  let best = -Infinity, bestIds = null;
  for (let a = 0; a < n - 4; a++) for (let b = a + 1; b < n - 3; b++) {
    const s2 = pool[a].sal + pool[b].sal; if (s2 > room) continue;
    for (let c = b + 1; c < n - 2; c++) { const s3 = s2 + pool[c].sal; if (s3 > room) continue;
      for (let d = c + 1; d < n - 1; d++) { const s4 = s3 + pool[d].sal; if (s4 > room) continue;
        for (let e = d + 1; e < n; e++) { const s5 = s4 + pool[e].sal; if (s5 > room) continue;
          const five = [pool[a], pool[b], pool[c], pool[d], pool[e]];
          if (five.every(p => p.team === C.team)) continue;
          const v = five.reduce((s, p) => s + p.proj, 0);
          if (v > best) { best = v; bestIds = five.map(p => p.i); } } } } }
  return bestIds ? { proj: 1.5 * C.proj + best, ids: [cpt].concat(bestIds) } : null;
}

/* players: [{i,id,name,pos,team,proj,own,cptOwn,sal,cptSal,ok}] (own/cptOwn in percent).
   entries: [{label,ids,cpt,fee,type,contest,key}] (ids[0] is the captain).
   opts.notes: { [noteKey]: text } — written reasons that clear a warning.
   opts.favorite: team override. Returns { checks, skipped, summary, label }. */
function preLockChecks(players, entries, opts) {
  opts = opts || {};
  const notes = opts.notes || {};
  const P = players.map((p, i) => ({ ...p, i: Number.isInteger(p.i) ? p.i : i,
    cptSal: finite(p.cptSal) && p.cptSal > 0 ? p.cptSal : Math.round((p.sal || 0) * 1.5) }));
  const E = (entries || []).filter(e => Array.isArray(e.ids) && e.ids.length === 6);
  const n = E.length, checks = [], skipped = [];
  const note = key => { const t = String(notes[key] || '').trim(); return t || null; };
  const push = c => { c.note = note(c.noteKey); c.status = c.note ? 'explained' : 'open'; checks.push(c); };
  const expo = new Float64Array(P.length);
  E.forEach(e => e.ids.forEach(i => { if (P[i]) expo[i] += 1; }));
  for (let i = 0; i < expo.length; i++) expo[i] = n ? expo[i] / n * 100 : 0;
  const fav = favoriteOf(P, opts.favorite);

  // 1. exposure thesis gate
  if (n >= MIN_EXPOSURE_ENTRIES) {
    P.forEach(p => {
      if (p.ok === false || !finite(p.own)) return;
      const gap = expo[p.i] - p.own;
      if (Math.abs(gap) < RULES.exposure.threshold) return;
      push({ rule: RULES.exposure.id, title: RULES.exposure.title, players: [pidOf(p)], noteKey: RULES.exposure.id + ':' + pidOf(p),
        head: p.name + ' ' + round(expo[p.i], 0) + '% vs ' + round(p.own, 0) + '% field (' + (gap > 0 ? '+' : '') + round(gap, 0) + ' pts)',
        detail: gap > 0 ? 'Overweight. Write why you are this far above the field, or trim toward ' + round(p.own, 0) + '%.'
          : 'Underweight. Write why you are fading this player this hard, or add exposure toward ' + round(p.own, 0) + '%.',
        value: round(gap, 1) });
    });
  } else skipped.push({ rule: RULES.exposure.id, reason: n + ' selected ' + (n === 1 ? 'entry' : 'entries') + ': exposure is too coarse to compare with the field below ' + MIN_EXPOSURE_ENTRIES + '.' });

  // 2 + 3. underdog QB cap and favourite's pass-catchers need a favourite
  if (!fav.team) {
    const why = fav.source === 'too-close' ? 'Team projections are within 3%, so the favourite is unclear. Pick it to run this check.' : 'No favourite could be identified.';
    skipped.push({ rule: RULES.dogQb.id, reason: why }, { rule: RULES.favCatchers.id, reason: why });
  } else if (n >= MIN_EXPOSURE_ENTRIES) {
    const favNote = fav.source === 'user' ? fav.team + ' is the favourite (your pick).' : fav.team + ' is the favourite by total projected points (a proxy; pick the real favourite if it differs).';
    const qb = P.filter(p => p.team === fav.dog && p.pos === 'QB' && p.ok !== false && finite(p.own)).sort((a, b) => b.proj - a.proj)[0];
    if (qb && expo[qb.i] > qb.own + RULES.dogQb.margin) push({ rule: RULES.dogQb.id, title: RULES.dogQb.title, players: [pidOf(qb)], noteKey: RULES.dogQb.id + ':' + pidOf(qb),
      head: qb.name + ' ' + round(expo[qb.i], 0) + '% vs field ' + round(qb.own, 0) + '% (cap ~' + round(qb.own + RULES.dogQb.margin, 0) + '%)',
      detail: favNote + ' Write the edge, or trim. Go below field if the QB\'s line is missing starters against a top-half pass rush.', value: round(expo[qb.i] - qb.own, 1) });
    const catchers = P.filter(p => p.team === fav.team && (p.pos === 'WR' || p.pos === 'TE') && p.ok !== false && finite(p.own)).sort((a, b) => b.proj - a.proj).slice(0, 2);
    if (catchers.length === 2) {
      const you = expo[catchers[0].i] + expo[catchers[1].i], field = catchers[0].own + catchers[1].own;
      if (you < field - RULES.favCatchers.margin) push({ rule: RULES.favCatchers.id, title: RULES.favCatchers.title, players: catchers.map(pidOf),
        noteKey: RULES.favCatchers.id + ':' + catchers.map(pidOf).join('+'),
        head: catchers.map(p => p.name).join(' + ') + ' ' + round(you, 0) + '% combined vs field ' + round(field, 0) + '%',
        detail: favNote + ' Floor is field minus 10 (' + round(field - RULES.favCatchers.margin, 0) + '%) unless projections moved them. Write why, or add exposure.', value: round(you - field, 1) });
    }
  } else skipped.push({ rule: RULES.dogQb.id, reason: 'Needs ' + MIN_EXPOSURE_ENTRIES + '+ selected entries.' }, { rule: RULES.favCatchers.id, reason: 'Needs ' + MIN_EXPOSURE_ENTRIES + '+ selected entries.' });

  // 4. Double Up punts
  E.filter(e => e.type === 'cash').forEach(e => {
    const cpt = Number.isInteger(e.cpt) ? e.cpt : e.ids[0];
    const punts = e.ids.filter(i => P[i] && finite(P[i].proj) && P[i].proj < RULES.cashPunt.minProj);
    if (!punts.length) return;
    const proj = e.ids.reduce((s, i) => s + (i === cpt ? 1.5 : 1) * (P[i].proj || 0), 0);
    const alt = bestWithoutPunts(P, cpt, RULES.cashPunt.minProj);
    const cost = alt ? proj - alt.proj : null;   // positive = the punt build projects more
    const justified = cost != null && cost > RULES.cashPunt.altCost;
    push({ rule: RULES.cashPunt.id, title: RULES.cashPunt.title, players: punts.map(i => pidOf(P[i])), entry: e.label || e.key,
      noteKey: RULES.cashPunt.id + ':' + (e.key || e.label),
      head: (e.label || 'Entry') + ': ' + punts.map(i => P[i].name + ' (' + round(P[i].proj, 1) + ')').join(', ') + ' in a cash lineup',
      detail: alt == null ? 'No legal build with this captain avoids every sub-3 player. Log the trade-off.'
        : justified ? 'Avoiding the punt costs ' + round(cost, 1) + ' projected points with this captain, more than the ~2-point line. The rule allows it; log the trade-off.'
        : 'A build with this captain and no sub-3 player projects ' + round(alt.proj, 1) + ' (' + (cost >= 0 ? round(cost, 1) + ' fewer' : round(-cost, 1) + ' more') + ' than this one). Swap, or log why.',
      value: cost == null ? null : round(cost, 1), level: justified ? 'info' : 'warn' });
  });

  // 5. kickers need a make-rate note
  const kIds = new Set(); E.forEach(e => e.ids.forEach(i => { if (P[i] && P[i].pos === 'K') kIds.add(i); }));
  kIds.forEach(i => push({ rule: RULES.kicker.id, title: RULES.kicker.title, players: [pidOf(P[i])], noteKey: RULES.kicker.id + ':' + pidOf(P[i]),
    head: P[i].name + ' is in ' + round(expo[i], 0) + '% of entries', detail: 'Add the season make rate (and long-range attempts) before this kicker stays in the pool.' }));

  checks.forEach(c => { if (!c.level) c.level = 'warn'; });
  const open = checks.filter(c => c.status === 'open' && c.level === 'warn').length;
  return { version: VERSION, label: CHECK_LABEL, source: CHECK_SOURCE, rules: RULES, favorite: fav, entries: n,
    checks, skipped, summary: { open, explained: checks.filter(c => c.status === 'explained').length, info: checks.filter(c => c.level === 'info' && c.status === 'open').length } };
}

/* =====================================================================================
   2. PRIZE TABLES — paste or upload, parsed to a per-rank payout array.
   ===================================================================================== */

function parseMoney(s) {
  const m = String(s || '').replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)\s*([kKmM](?![a-z]))?/);
  if (!m) return null;
  let v = parseFloat(m[1]); if (m[2]) v *= /k/i.test(m[2]) ? 1e3 : 1e6;
  return finite(v) ? v : null;
}
const RANK_RE = /^\s*(?:place\s*)?(\d{1,3}(?:,\d{3})+|\d{1,6})(?:st|nd|rd|th)?(?:\s*(?:place)?\s*(?:-|–|—|to)\s*(\d{1,3}(?:,\d{3})+|\d{1,6})(?:st|nd|rd|th)?)?(?:\s*place)?\b/i;
const rankInt = s => parseInt(String(s).replace(/,/g, ''), 10);
const NONCASH_RE = /ticket|entry into|seat|qualif|satellite|merch|package/i;

/* Accepts what people actually paste: DK's prize list ("1st $25,000", "11th - 15th $500"),
   the same copied from the web page with rank and amount on separate lines, or a CSV with
   rank,prize or from,to,prize columns. Non-cash prizes (tickets) are recorded as zero cash
   and reported. Nothing is guessed: overlaps, rising prizes and ranks past the field fail. */
function parsePrizeTable(text, opts) {
  opts = opts || {};
  const problems = [], notes = [], rows = [];
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, problems: ['The prize table is empty.'], rows: [], payouts: [] };
  const head = lines[0].toLowerCase();
  let csv = null;
  if (/,/.test(head) && /(prize|payout|amount|winnings)/.test(head) && !/\d/.test(head)) {
    const cols = head.split(',').map(s => s.trim());
    const at = (...names) => cols.findIndex(c => names.some(n => c === n || c.includes(n)));
    csv = { from: at('from', 'min', 'rank', 'place', 'position'), to: at('to', 'max'), prize: at('prize', 'payout', 'amount', 'winnings') };
    if (csv.to === csv.from) csv.to = -1;
  }
  let pending = null;
  const add = (from, to, prize, raw) => {
    if (!Number.isInteger(from) || from < 1 || !Number.isInteger(to) || to < from) { problems.push('Bad rank range in "' + raw + '".'); return; }
    rows.push({ from, to, prize, raw, noncash: prize === 0 && NONCASH_RE.test(raw) });
  };
  for (let li = csv ? 1 : 0; li < lines.length; li++) {
    const line = lines[li];
    if (csv) {
      const cells = line.split(',').map(s => s.trim());
      const rk = String(cells[csv.from] || '').match(RANK_RE);
      const from = rk ? rankInt(rk[1]) : NaN, to = csv.to >= 0 && cells[csv.to] !== '' ? rankInt(cells[csv.to]) : rk && rk[2] ? rankInt(rk[2]) : from;
      const cell = cells[csv.prize] || '';
      if (NONCASH_RE.test(cell)) { notes.push('Ranks ' + from + (to !== from ? '–' + to : '') + ' pay a non-cash prize; counted as $0 cash.'); add(from, to, 0, line); continue; }
      const prize = parseMoney(cell);
      if (prize == null) { problems.push('No prize amount in "' + line + '".'); continue; }
      add(from, to, prize, line); continue;
    }
    const m = line.match(RANK_RE);
    if (m) {
      const from = rankInt(m[1]), to = m[2] ? rankInt(m[2]) : from;
      const rest = line.slice(m[0].length).replace(/^[\s:=,|\t-]+/, '');
      if (!rest) { pending = { from, to, raw: line }; continue; }
      if (NONCASH_RE.test(rest) && !/\$\s*\d[\d,]*(?:\.\d+)?\s*(?:cash|\+)/i.test(rest)) { notes.push('Ranks ' + from + (to !== from ? '–' + to : '') + ' pay a non-cash prize; counted as $0 cash.'); add(from, to, 0, line); pending = null; continue; }
      const prize = parseMoney(rest);
      if (prize == null) { pending = { from, to, raw: line }; continue; }
      add(from, to, prize, line); pending = null; continue;
    }
    if (pending) {
      if (NONCASH_RE.test(line)) { notes.push('Ranks ' + pending.from + (pending.to !== pending.from ? '–' + pending.to : '') + ' pay a non-cash prize; counted as $0 cash.'); add(pending.from, pending.to, 0, pending.raw + ' ' + line); pending = null; continue; }
      const prize = parseMoney(line);
      if (prize != null) { add(pending.from, pending.to, prize, pending.raw + ' ' + line); pending = null; continue; }
    }
    if (/\d/.test(line) && !/total|prize pool|entries|entry fee|places paid/i.test(line)) problems.push('Skipped a line the parser could not read: "' + line.slice(0, 60) + '".');
  }
  if (pending) problems.push('Rank ' + pending.from + ' has no prize amount.');
  rows.sort((a, b) => a.from - b.from);
  let lastCash = Infinity;
  for (let k = 0; k < rows.length; k++) {
    if (k && rows[k].from <= rows[k - 1].to) problems.push('Ranks overlap at ' + rows[k].from + '.');
    if (rows[k].noncash) continue;   // a ticket row is $0 cash, not a prize that later rows must stay under
    const rises = rows[k].prize > lastCash; lastCash = rows[k].prize;
    if (rises) problems.push('Prize rises at rank ' + rows[k].from + '; DK prizes never increase down the table.');
  }
  const maxRank = rows.length ? rows[rows.length - 1].to : 0;
  const N = Number.isInteger(opts.fieldSize) ? opts.fieldSize : null;
  if (N != null && maxRank > N) problems.push('The table pays rank ' + maxRank.toLocaleString() + ' but the contest has ' + N.toLocaleString() + ' entrants.');
  if (!rows.length) problems.push('No prize rows found.');
  const payouts = new Array(maxRank).fill(0);
  rows.forEach(r => { for (let k = r.from; k <= r.to && k <= maxRank; k++) payouts[k - 1] = r.prize; });
  // trailing zeros carry no information and confuse the cash line
  while (payouts.length && payouts[payouts.length - 1] === 0) payouts.pop();
  const total = payouts.reduce((s, v) => s + v, 0);
  const fee = finite(opts.fee) && opts.fee > 0 ? opts.fee : null;
  return {
    ok: !problems.length && payouts.length > 0, problems, notes, rows: rows.map(({ from, to, prize }) => ({ from, to, prize })), payouts,
    paidPlaces: payouts.filter(v => v > 0).length, total: round(total, 2), firstPrize: payouts[0] || 0,
    firstShare: total > 0 ? round((payouts[0] || 0) / total, 4) : null,
    rake: fee && N ? round(1 - total / (fee * N), 4) : null, fieldSize: N
  };
}

/* =====================================================================================
   3. BIG-CONTEST ROI — expected prize by sampled rank, scaled to the full field.

   A full field above ~12,000 entrants is too heavy to simulate on a phone. Instead each
   world ranks the entry against a sample of m opponents and reads off how many beat it
   (a). The sample is a subset of the full field of N−1 opponents, so the other N−1−m
   opponents beat it with an unknown rate q. With a uniform prior, q | a ~ Beta(a+1, m−a+1),
   and the full-field count above is A = a + BetaBinomial(N−1−m, a+1, m−a+1). The uniform
   prior is the one that keeps ranks exchangeable: an entry drawn from the field itself gets
   exactly the field's average prize (total prizes ÷ N), which the tests check. Exact
   copies of the entry are modelled separately as Poisson with mean (N−1)·(field frequency
   of this exact roster), sharing the places they occupy, as DK splits ties.

   The table below is E[prize | a] for every a, so the world loop stays a lookup.
   Limits, disclosed on the page: first place and other thin top prizes come from the
   extrapolated tail (worlds where the entry beat the whole sample); the field model
   itself is uncalibrated; the Monte Carlo interval covers simulation noise only.
   ===================================================================================== */

const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1; let a = LANCZOS[0]; const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function lbeta(a, b) { return lgamma(a) + lgamma(b) - lgamma(a + b); }
function bbLogPmf(k, n, a, b) { return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1) + lbeta(k + a, n - k + b) - lbeta(a, b); }

/* g(A): expected prize, win share, top-10 and cash share for a world where exactly A
   non-copy opponents beat the entry, averaged over Poisson copies T. */
function rankFunctions(payouts, entrants, lambda) {
  const N = entrants, paid = payouts.filter(v => v > 0).length, G = Math.max(paid, 10);
  const prefix = new Float64Array(N + 2);
  for (let r = 0; r < N + 1; r++) prefix[r + 1] = prefix[r] + (payouts[r] || 0);
  const tmax = lambda > 0 ? Math.ceil(lambda + 10 * Math.sqrt(lambda) + 10) : 0;
  const pois = new Float64Array(tmax + 1);
  if (lambda > 0) { let p = Math.exp(-lambda), s = 0; for (let t = 0; t <= tmax; t++) { if (t) p *= lambda / t; pois[t] = p; s += p; } for (let t = 0; t <= tmax; t++) pois[t] /= s; } else pois[0] = 1;
  const pay = new Float64Array(G), win = new Float64Array(G), top10 = new Float64Array(G), cash = new Float64Array(G);
  for (let A = 0; A < G; A++) {
    let gp = 0, gw = 0, gc = 0;
    for (let t = 0; t <= tmax; t++) {
      const w = pois[t]; if (w < 1e-15) continue;
      const lo = Math.min(A, N), hi = Math.min(A + t + 1, N);
      gp += w * (prefix[hi] - prefix[lo]) / (t + 1);
      if (A === 0) gw += w / (t + 1);
      gc += w * Math.max(0, Math.min(t + 1, paid - A)) / (t + 1);
    }
    pay[A] = gp; win[A] = gw; cash[A] = gc; top10[A] = A < 10 ? 1 : 0;
  }
  return { pay, win, top10, cash, paid, G };
}

function scaledContestTables(opts) {
  const payouts = opts.payouts, N = opts.entrants, m = opts.sample;
  if (!Array.isArray(payouts) || !payouts.length || !Number.isInteger(N) || !Number.isInteger(m) || m < 1 || m >= N - 1) throw new Error('Scaled tables need payouts, entrants and a sample smaller than the field.');
  const lambda = Math.max(0, (N - 1) * (opts.dupRate || 0));
  const g = rankFunctions(payouts, N, lambda), n = N - 1 - m, G = g.G;
  const len = Math.min(m, G - 1) + 1;
  const T = { pay: new Float64Array(len), win: new Float64Array(len), top10: new Float64Array(len), cash: new Float64Array(len), lambda, extra: n, sample: m, entrants: N };
  const TINY = 1e-18;
  for (let a = 0; a < len; a++) {
    const al = a + 1, be = m - a + 1, kmax = Math.min(n, G - 1 - a);
    if (kmax < 0) break;
    const ratio = k => (n - k) * (k + al) / ((k + 1) * (n - k - 1 + be));
    let k0 = Math.floor(n * al / (al + be)); if (k0 > kmax) k0 = kmax; if (k0 < 0) k0 = 0;
    const p0 = Math.exp(bbLogPmf(k0, n, al, be));
    let sp = 0, sw = 0, st = 0, sc = 0;
    const acc = (k, p) => { const A = a + k; sp += p * g.pay[A]; sw += p * g.win[A]; st += p * g.top10[A]; sc += p * g.cash[A]; };
    acc(k0, p0);
    let p = p0;
    for (let k = k0; k < kmax; k++) { const r = ratio(k); p *= r; if (p < TINY && r < 1) break; acc(k + 1, p); }
    p = p0;
    for (let k = k0; k > 0; k--) { const r = ratio(k - 1); p /= r; if (p < TINY && r > 1) break; acc(k - 1, p); }
    T.pay[a] = sp; T.win[a] = sw; T.top10[a] = st; T.cash[a] = sc;
  }
  return T;
}

/* Copies are bucketed on a log grid so a contest with many entries reuses tables. */
function lambdaBucket(lambda) {
  if (!(lambda > 0.01)) return 0;
  return round(Math.pow(1.25, Math.round(Math.log(lambda) / Math.log(1.25))), 4);
}
function contestTableCache(payouts, entrants, sample) {
  const cache = new Map();
  return dupRate => {
    const lam = lambdaBucket((entrants - 1) * (dupRate || 0));
    if (!cache.has(lam)) cache.set(lam, scaledContestTables({ payouts, entrants, sample, dupRate: lam / (entrants - 1) }));
    return cache.get(lam);
  };
}
const SCALED_METHOD = 'Ranked against a sampled field, then scaled to the full contest: the count of opponents above the entry is extrapolated from the sample with a beta-binomial (uniform prior), exact copies are Poisson from the field model, and ties share prizes as DK splits them.';

/* =====================================================================================
   4. POST-SLATE SCORECARD — our pool vs a plain projection pool, on actual points.
   ===================================================================================== */

/* Player name matching for standings rows. DST rows on DK carry the team nickname. */
function nameIndex(players) {
  const by = new Map(), dup = new Set();
  const put = (k, i) => { if (!k) return; if (by.has(k) && by.get(k) !== i) dup.add(k); else by.set(k, i); };
  players.forEach((p, i) => {
    put(normName(p.name), i);
    if (p.pos === 'DST') { const w = normName(p.name).split(' '); put(w[w.length - 1], i); put(normName(p.team), i); put(normName(p.team) + ' dst', i); }
  });
  dup.forEach(k => by.delete(k));
  return k => { const n = normName(k); if (by.has(n)) return by.get(n); const w = n.replace(/\s*(dst|d st|defense)$/, '').trim(); return by.has(w) ? by.get(w) : (by.has(w.split(' ').pop()) ? by.get(w.split(' ').pop()) : null); };
}

/* Actual DK points per pool player from a parsed standings file (DDFSLedger.parseStandings).
   FLEX rows give the base score directly. A player only ever drafted at captain falls back
   to the CPT row ÷ 1.5. The result is then checked against the standings' own lineup
   Points: every fully matched field lineup is rescored and the error reported, so a
   wrong assumption about the FPTS column shows up as a non-zero error, not a silent bias. */
function actualPoints(standings, players) {
  const find = nameIndex(players), base = new Map(), cptOnly = new Map(), unmatched = new Set();
  for (const o of standings.ownership || []) {
    if (!finite(o.fpts)) continue;
    const i = find(o.player); if (i == null) { unmatched.add(o.player); continue; }
    if (o.slot === 'CPT') cptOnly.set(i, o.fpts); else base.set(i, o.fpts);
  }
  cptOnly.forEach((v, i) => { if (!base.has(i)) base.set(i, v / 1.5); });
  let n = 0, err = 0, maxErr = 0;
  for (const e of standings.entries || []) {
    if (!e.lineup || !finite(e.points)) continue;
    let s = 0, ok = true;
    for (const slot of e.lineup) { const i = find(slot.name); if (i == null || !base.has(i)) { ok = false; break; } s += (slot.slot === 'CPT' ? 1.5 : 1) * base.get(i); }
    if (!ok) continue;
    const d = Math.abs(s - e.points); n++; err += d; if (d > maxErr) maxErr = d;
  }
  return { points: base, unmatched: [...unmatched], check: { lineups: n, meanAbsErr: n ? round(err / n, 3) : null, maxAbsErr: n ? round(maxErr, 3) : null } };
}

function lineupScore(ids, cpt, pts) {
  let s = 0;
  for (const i of ids) { if (!pts.has(i)) return null; s += (i === cpt ? 1.5 : 1) * pts.get(i); }
  return s;
}

/* The contest's real cut lines from its standings. Rank of a score = 1 + entries above it.
   top 1% = the best floor(1% of N) places (at least 1). Cash needs paid places, from a
   prize table or typed; without it the cash line is unknown and stays null. */
function cutLines(standings, opts) {
  opts = opts || {};
  const pts = (standings.entries || []).map(e => e.points).filter(finite).sort((a, b) => b - a);
  const N = pts.length, top1Places = Math.max(1, Math.floor(N * 0.01));
  const paid = Number.isInteger(opts.paidPlaces) && opts.paidPlaces > 0 ? Math.min(opts.paidPlaces, N) : null;
  return { field: N, sorted: pts, top1Places, top1Score: pts[top1Places - 1], paidPlaces: paid, cashScore: paid ? pts[paid - 1] : null,
    cashSource: paid ? (opts.paidSource || 'supplied') : 'unknown', median: pts[Math.floor(N / 2)], p90: pts[Math.floor(N * 0.1)], winning: pts[0] };
}
function rankOf(sortedDesc, v) {
  let lo = 0, hi = sortedDesc.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedDesc[mid] > v + 1e-9) lo = mid + 1; else hi = mid; }
  return lo + 1;
}

function poolStats(scores, cuts) {
  const s = scores.filter(finite), N = cuts.field;
  if (!s.length) return { n: scores.length, scored: 0 };
  const ranks = s.map(v => rankOf(cuts.sorted, v)), sorted = s.slice().sort((a, b) => b - a);
  const avg = mean(s), sd = Math.sqrt(mean(s.map(v => (v - avg) * (v - avg))));
  return {
    n: scores.length, scored: s.length, mean: round(avg, 2), sd: round(sd, 2), max: round(sorted[0], 2), p90: round(sorted[Math.floor(s.length * 0.1)], 2),
    bestRank: Math.min(...ranks), meanPercentile: round(mean(ranks.map(r => 100 * (1 - (r - 1) / N))), 1),
    top1: ranks.filter(r => r <= cuts.top1Places).length, top1Rate: round(ranks.filter(r => r <= cuts.top1Places).length / s.length, 4),
    cash: cuts.paidPlaces ? ranks.filter(r => r <= cuts.paidPlaces).length : null,
    cashRate: cuts.paidPlaces ? round(ranks.filter(r => r <= cuts.paidPlaces).length / s.length, 4) : null
  };
}

/* The plainest pool there is: the n highest-projected legal Showdown lineups (captain at
   1.5x, $50,000 cap, both teams), from the 30 highest-projected players. No exposure
   rules, no ownership, no correlation. It is the bar a builder has to clear. */
function baselinePool(players, n) {
  const pool = players.map((p, i) => ({ ...p, i: Number.isInteger(p.i) ? p.i : i }))
    .filter(p => p.ok !== false && finite(p.proj) && p.proj > 0 && finite(p.sal) && p.sal > 0)
    .sort((a, b) => b.proj - a.proj).slice(0, 30);
  const K = Math.max(1, n | 0), heap = [];   // min-heap of [proj, ids]
  const up = j => { while (j > 0) { const q = (j - 1) >> 1; if (heap[q][0] <= heap[j][0]) break; [heap[q], heap[j]] = [heap[j], heap[q]]; j = q; } };
  const down = j => { for (;;) { const l = 2 * j + 1, r = l + 1; let m = j; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === j) break; [heap[m], heap[j]] = [heap[j], heap[m]]; j = m; } };
  const offer = (v, mk) => { if (heap.length < K) { heap.push([v, mk()]); up(heap.length - 1); } else if (v > heap[0][0]) { heap[0] = [v, mk()]; down(0); } };
  const L = pool.length;
  for (let c = 0; c < L; c++) {
    const C = pool[c], cs = finite(C.cptSal) && C.cptSal > 0 ? C.cptSal : Math.round(C.sal * 1.5), room = CAP - cs, cp = 1.5 * C.proj;
    if (room < 0) continue;
    const f = pool.filter((_, k) => k !== c), m = f.length;
    for (let a = 0; a < m - 4; a++) { const sa = f[a].sal; if (sa > room) continue;
      for (let b = a + 1; b < m - 3; b++) { const sb = sa + f[b].sal; if (sb > room) continue;
        for (let d = b + 1; d < m - 2; d++) { const sd = sb + f[d].sal; if (sd > room) continue;
          for (let e = d + 1; e < m - 1; e++) { const se = sd + f[e].sal; if (se > room) continue;
            const v4 = cp + f[a].proj + f[b].proj + f[d].proj + f[e].proj;
            if (heap.length === K && v4 + f[e + 1].proj <= heap[0][0]) continue;   // f is sorted by proj, so later g only fall
            for (let g = e + 1; g < m; g++) { if (se + f[g].sal > room) continue;
              const v = v4 + f[g].proj;
              if (heap.length === K && v <= heap[0][0]) break;
              const five = [f[a], f[b], f[d], f[e], f[g]];
              if (five.every(p => p.team === C.team)) continue;
              offer(v, () => ({ cpt: C.i, ids: [C.i].concat(five.map(p => p.i)), proj: round(v, 3) })); } } } } }
  }
  return heap.map(h => h[1]).sort((x, y) => y.proj - x.proj);
}

function keyOf(l) { const cpt = Number.isInteger(l.cpt) ? l.cpt : l.ids[0]; return cpt + '|' + l.ids.filter(i => i !== cpt).slice().sort((a, b) => a - b).join(','); }

/* players: the pool players (workspace order). pools: { ours: [{cpt,ids}], baseline?: [...] }.
   contests: [{ name, standings (parsed), paidPlaces?, payouts? }]. When pools.baseline is
   missing it is built: the top-N projected lineups, N = our pool size. */
function poolScorecard(input) {
  const players = input.players, ours = (input.pools && input.pools.ours) || [];
  if (!ours.length) throw new Error('No lineups in our pool to score.');
  const baseline = (input.pools && input.pools.baseline) || baselinePool(players, ours.length);
  const shared = new Set(baseline.map(keyOf)); const overlap = ours.filter(l => shared.has(keyOf(l))).length;
  const contests = (input.contests || []).map(c => {
    const paid = Number.isInteger(c.paidPlaces) ? c.paidPlaces : Array.isArray(c.payouts) && c.payouts.length ? c.payouts.filter(v => v > 0).length : null;
    const cuts = cutLines(c.standings, { paidPlaces: paid, paidSource: Number.isInteger(c.paidPlaces) ? 'typed paid places' : paid ? 'prize table' : null });
    const act = actualPoints(c.standings, players);
    const score = l => lineupScore(l.ids, Number.isInteger(l.cpt) ? l.cpt : l.ids[0], act.points);
    const oS = ours.map(score), bS = baseline.map(score);
    const o = poolStats(oS, cuts), b = poolStats(bS, cuts);
    return {
      name: c.name || c.standings.contest_id || 'contest', field: cuts.field, type: c.type || null,
      cuts: { top1Places: cuts.top1Places, top1Score: cuts.top1Score, paidPlaces: cuts.paidPlaces, cashScore: cuts.cashScore, cashSource: cuts.cashSource, median: cuts.median, winning: cuts.winning },
      pointsCheck: act.check, unmatchedPlayers: act.unmatched.slice(0, 20),
      ours: o, baseline: b,
      diff: o.scored && b.scored ? { mean: round(o.mean - b.mean, 2), max: round(o.max - b.max, 2), top1Rate: round(o.top1Rate - b.top1Rate, 4), cashRate: o.cashRate != null && b.cashRate != null ? round(o.cashRate - b.cashRate, 4) : null } : null
    };
  });
  return {
    version: VERSION, pools: { ours: ours.length, baseline: baseline.length, identical: overlap, baselineMethod: input.pools && input.pools.baseline ? 'supplied' : 'top-' + baseline.length + ' projected legal lineups (no ownership, exposure or correlation rules)' },
    contests,
    caveats: [
      'One slate is one observation. Lineups in a pool share players and captains, so their results move together: ' + ours.length + ' lineups are not ' + ours.length + ' independent tests.',
      'Rates are against the actual field in each standings file at its real cut lines. Cash needs the paid places (from a prize table or typed); without them cash stays unknown.',
      'Actual player points come from the standings file itself and are checked against its own lineup totals (pointsCheck).'
    ]
  };
}

/* =====================================================================================
   5. FIELD CALIBRATION — fit the contest-type sharpness preset to a real DK field.
   ===================================================================================== */

/* What the real field did, from standings alone: ownership by slot against the projection,
   the mean projection of the lineups people actually played, duplication, and the actual
   score distribution. Lineups are resolved to pool players by name; unresolved ones are
   counted and left out of the projection average. */
function observedField(standings, players) {
  const find = nameIndex(players);
  let n = 0, unresolved = 0; const proj = [];
  for (const e of standings.entries || []) {
    if (!e.lineup) { unresolved++; continue; }
    let s = 0, ok = e.lineup.length === 6;
    for (const slot of e.lineup) { const i = find(slot.name); const p = i == null ? null : players[i]; if (!p || !finite(p.proj)) { ok = false; break; } s += (slot.slot === 'CPT' ? 1.5 : 1) * p.proj; }
    if (ok) { proj.push(s); n++; } else unresolved++;
  }
  const own = { CPT: [], FLEX: [] };
  for (const o of standings.ownership || []) {
    if (!finite(o.drafted) || (o.slot !== 'CPT' && o.slot !== 'FLEX')) continue;
    const i = find(o.player); if (i == null) continue;
    const p = players[i];
    const want = o.slot === 'CPT' ? p.cptOwn : (finite(p.flexOwn) ? p.flexOwn : (finite(p.own) && finite(p.cptOwn) ? p.own - p.cptOwn : null));
    if (finite(want)) own[o.slot].push(o.drafted - want);
  }
  const ownStats = a => ({ n: a.length, bias: a.length ? round(mean(a), 2) : null, mae: a.length ? round(mean(a.map(Math.abs)), 2) : null });
  const entries = (standings.entries || []).filter(e => finite(e.points));
  const pts = entries.map(e => e.points).sort((a, b) => a - b), q = f => pts.length ? pts[Math.min(pts.length - 1, Math.floor(f * pts.length))] : null;
  const copies = entries.filter(e => finite(e.copies));
  return {
    field: entries.length, resolved: n, unresolved, projMean: proj.length ? mean(proj) : null, projs: proj,
    ownership: { CPT: ownStats(own.CPT), FLEX: ownStats(own.FLEX) },
    dupes: { meanOtherCopies: copies.length ? round(mean(copies.map(e => e.copies - 1)), 3) : null, uniqueShare: copies.length ? round(copies.filter(e => e.copies === 1).length / copies.length, 4) : null },
    scores: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: pts.length ? pts[pts.length - 1] : null }
  };
}

/* Fit β so the modelled field's weighted mean projection equals the real field's. The
   modelled field is the same ownership-calibrated legal sample the page draws, weighted by
   exp(β·z(projection)) exactly as dfs-showdown.js weights it. Bisection on [−2, 4]; a fit
   at a bound is reported as clipped. One knob absorbs everything else the field model gets
   wrong (including ownership misses), and the result says so. */
function fitBeta(fieldProj, targetMean) {
  const n = fieldProj.length; let m = 0, s2 = 0;
  for (let k = 0; k < n; k++) m += fieldProj[k]; m /= n;
  for (let k = 0; k < n; k++) s2 += (fieldProj[k] - m) * (fieldProj[k] - m);
  const sd = Math.sqrt(s2 / n) || 1, z = new Float64Array(n);
  for (let k = 0; k < n; k++) z[k] = (fieldProj[k] - m) / sd;
  const zt = (targetMean - m) / sd;
  const mz = beta => { let a = 0, b = 0; for (let k = 0; k < n; k++) { const w = Math.exp(beta * z[k]); a += w * z[k]; b += w; } return a / b; };
  let lo = -2, hi = 4, clipped = null;
  if (zt <= mz(lo)) { clipped = 'low'; hi = lo; } else if (zt >= mz(hi)) { clipped = 'high'; lo = hi; }
  else for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; if (mz(mid) < zt) lo = mid; else hi = mid; }
  const beta = (lo + hi) / 2;
  return { beta: round(beta, 3), clipped, modelMeanAt: b => round(m + sd * mz(b), 2), fieldMean: round(m, 2), fieldSd: round(sd, 2), targetZ: round(zt, 3) };
}

/* Expected other copies of a random lineup in an N-entry field under weights w. */
function modelDupes(keys, w, N) {
  const f = new Map(); for (let k = 0; k < keys.length; k++) f.set(keys[k], (f.get(keys[k]) || 0) + w[k]);
  let e = 0; for (let k = 0; k < keys.length; k++) e += w[k] * f.get(keys[k]) * (N - 1);
  return round(e, 3);
}

/* input: { players (workspace), standings (parsed), type, entrants?, presetBeta, settings }.
   opts: { engine: DDFS, showdown: DDShowdown, fieldN, seed }. */
async function calibrateContest(input, opts) {
  opts = opts || {};
  const SD = opts.showdown || root.DDShowdown, E = opts.engine || root.DDFS;
  if (!SD || !SD._internal || !E) throw new Error('Calibration needs the DFS engine and dfs-showdown.js.');
  const { P } = SD.preparePlayers(input.players);
  const obs = observedField(input.standings, P);
  if (obs.resolved < 30) throw new Error('Only ' + obs.resolved + ' field lineups matched the pool by name; need at least 30 to fit anything.');
  const fieldN = Math.max(2000, Math.min(40000, opts.fieldN || 12000));
  const field = await SD._internal.sampleField(E, P, fieldN, { seed: opts.seed || 216, fieldMinSalary: (input.settings || {}).fieldMinSalary, ownershipFloor: (input.settings || {}).ownershipFloor });
  const L = field.lineups, nF = field.n, fp = new Float64Array(nF), keys = new Array(nF);
  for (let k = 0; k < nF; k++) {
    const o = k * 6, cpt = L[o], flex = [L[o + 1], L[o + 2], L[o + 3], L[o + 4], L[o + 5]];
    fp[k] = SD.features(P, cpt, flex).proj; keys[k] = SD.lineupKey(P, cpt, flex);
  }
  const fit = fitBeta(fp, obs.projMean);
  const preset = finite(input.presetBeta) ? input.presetBeta : null;
  const weightsFor = b => { const w = new Float64Array(nF); let s = 0; for (let k = 0; k < nF; k++) { w[k] = Math.exp(b * (fp[k] - fit.fieldMean) / fit.fieldSd); s += w[k]; } for (let k = 0; k < nF; k++) w[k] /= s; return w; };
  const N = Number.isInteger(input.entrants) ? input.entrants : obs.field;
  return {
    version: VERSION, contest: input.name || input.standings.contest_id || 'contest', type: input.type || null, entrants: N,
    resolved: obs.resolved, unresolved: obs.unresolved,
    beta: { preset, fit: fit.beta, clipped: fit.clipped },
    projection: { observedMean: round(obs.projMean, 2), modelAtPreset: preset != null ? fit.modelMeanAt(preset) : null, modelAtFit: fit.modelMeanAt(fit.beta), unweightedSample: fit.fieldMean },
    ownership: obs.ownership, scores: obs.scores,
    dupes: { observedMeanOtherCopies: obs.dupes.meanOtherCopies, observedUniqueShare: obs.dupes.uniqueShare,
      modelAtPreset: preset != null ? modelDupes(keys, weightsFor(preset), N) : null, modelAtFit: modelDupes(keys, weightsFor(fit.beta), N) },
    sampler: { lineups: nF, ownErr: round(field.ownErr, 2), cptErr: round(field.cptErr, 2) },
    note: 'β is fit by matching the real field\'s mean projection (your projections applied to the lineups people played). It also absorbs ownership misses, so read it with the ownership bias beside it. One contest is one observation.'
  };
}

/* Combine fits by contest type. A type with fewer than 3 contests stays provisional. */
function combineCalibrations(list) {
  const by = {};
  for (const c of list || []) { if (!c || !c.type || !c.beta || !finite(c.beta.fit)) continue; (by[c.type] || (by[c.type] = [])).push(c); }
  const out = {};
  for (const [t, a] of Object.entries(by)) {
    const betas = a.map(c => c.beta.fit), avg = mean(betas);
    out[t] = { beta: round(avg, 3), contests: a.length, lineups: a.reduce((s, c) => s + c.resolved, 0), spread: a.length > 1 ? round(Math.max(...betas) - Math.min(...betas), 3) : null,
      provisional: a.length < 3, names: a.map(c => c.contest) };
  }
  return out;
}

return {
  VERSION, RULES, CHECK_LABEL, CHECK_SOURCE, MIN_EXPOSURE_ENTRIES, SCALED_METHOD,
  preLockChecks, favoriteOf, bestWithoutPunts,
  parsePrizeTable, parseMoney,
  lgamma, scaledContestTables, rankFunctions, contestTableCache, lambdaBucket,
  actualPoints, cutLines, poolStats, baselinePool, poolScorecard, lineupScore, rankOf,
  observedField, fitBeta, calibrateContest, combineCalibrations, normName
};
});
