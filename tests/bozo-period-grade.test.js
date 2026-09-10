// Phase 2.8b — period legs on the grade side. No Worker-reachable score source carries
// per-period scores, so a period leg is hand-graded like a prop and is NEVER scored off
// the full-game result. Worst Beat divides by a scaled SD (game SD × √fraction, D21) and
// says so in beatBasis. data/bozo-sd.json is pinned to the grader's table.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.join(__dirname, '..', 'dawg-bot-worker.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'bozo.html'), 'utf8');
const sdDoc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'bozo-sd.json'), 'utf8'));

function between(start, end) {
  const a = worker.indexOf(start);
  const b = worker.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source markers exist: ${start} … ${end}`);
  return worker.slice(a, b);
}
const plain = v => JSON.parse(JSON.stringify(v));

const sandbox = {
  BOZO_GRADEABLE_SPORTS: new Set(['nfl', 'cfb']),
  SEASON: 2026,
  playerName: k => { try { return decodeURIComponent(k); } catch { return k; } },
  bozoScheduledTeamSide: (pick, game) => pick.side === game.home.abbr ? 'home' : pick.side === game.away.abbr ? 'away' : null,
  bozoCanonicalScheduleKey: () => null,
  rDevig: (a, b) => (a == null || b == null) ? null : 0.6,
  rImp: p => { const n = Number(p); return n < 0 ? (-n) / (-n + 100) : 100 / (n + 100); },
  rInvNorm: p => p >= 0.5 ? 1 : -1,
  Number, String, Object, Array, Math, JSON, Date, Map, Set, isNaN, isFinite, Promise,
};
vm.createContext(sandbox);
vm.runInContext([
  between('const BOZO_PERIODS = [', '/* ---------------- player props ----------------'),
  between('function bozoScheduleFindGame(', 'const ledgerKey ='),
  between('const ROYALE_SD = {', 'function rExpected('),
  between('function royaleBeatDeficit(', '/* Score every losing leg on one lever.'),
  between('function bozoScheduledOutcome(', 'async function bozoGradeConfirmCode('),
  'this.api = { rSd, bozoBeatBasis, bozoIsManualLeg, royaleBeatDeficit, bozoScheduledOutcome, bozoGradeFromScheduleKv, ROYALE_SD, BOZO_PERIOD_FRACTION };',
].join('\n'), sandbox);
const api = sandbox.api;

const GAME = { canonicalKey: 'k1', espnEventId: '401', completed: true, homeScore: 31, awayScore: 10,
  home: { abbr: 'BYU', name: 'BYU' }, away: { abbr: 'ARIZ', name: 'Arizona' } };
const doc = { source: 'cfbfastR', fetchedAt: '2026-09-13T02:00:00Z', etag: 'e', games: [GAME] };
sandbox.bozoScheduleDoc = async () => doc;

test('a period leg is never graded from the full-game score; its manual row passes through', async () => {
  const state = { season: 2026, week: 1, picks: {
    u_kap: { sport: 'cfb', eventId: '401', espnEventId: '401', mkt: 'ml', side: 'BYU', line: 0, who: 'Kap' },
    u_wb:  { sport: 'cfb', eventId: '401', espnEventId: '401', mkt: 'ml', side: 'BYU', line: 0, period: '1h', who: 'WBeamen' },
  } };
  const supplied = { u_wb: { result: 'lost', won: false, actual: -3 } };   // ARIZ led at the half
  const out = await api.bozoGradeFromScheduleKv({ RL: {} }, state, supplied);
  assert.equal(out.results.u_kap.result, 'won', 'the full-game leg grades from the schedule');
  assert.equal(out.results.u_kap.actual, 21);
  assert.deepEqual(plain(out.results.u_wb), { result: 'lost', won: false, actual: -3 }, 'the 1H row is exactly what the manager typed');
  assert.equal(out.pending.length, 0);
  // and with nothing typed, the 1H leg simply has no row — it is not invented from 31-10
  const none = await api.bozoGradeFromScheduleKv({ RL: {} }, state, {});
  assert.equal(none.results.u_wb, undefined);
  assert.equal(none.results.u_kap.result, 'won');
});

test('manual-leg classification: props, other, and any non-game period', () => {
  assert.equal(api.bozoIsManualLeg({ mkt: 'ml' }), false);
  assert.equal(api.bozoIsManualLeg({ mkt: 'ml', period: 'game' }), false);
  assert.equal(api.bozoIsManualLeg({ mkt: 'ml', period: '1h' }), true);
  assert.equal(api.bozoIsManualLeg({ mkt: 'total', period: '4q' }), true);
  assert.equal(api.bozoIsManualLeg({ mkt: 'prop' }), true);
  assert.equal(api.bozoIsManualLeg({ mkt: 'other' }), true);
  // the contradiction check in bozoGrade keys on it and includes the period
  assert.match(worker, /if \(!p \|\| !bozoIsManualLeg\(p\)\) continue;/);
  assert.match(worker, /const mk = \[p\.eventId, p\.mkt, p\.prop \|\| "", p\.line \?\? "", p\.side \?\? "", bozoPeriodOf\(p\)\]\.join\("\|"\);/);
});

test('Worst Beat: a period leg divides by game SD × √fraction and reports scaled-sd', () => {
  const nfl = api.ROYALE_SD.nfl;
  assert.equal(api.rSd({ sport: 'nfl', mkt: 'spread' }), nfl.sd);
  assert.equal(api.rSd({ sport: 'nfl', mkt: 'spread', period: 'game' }), nfl.sd);
  assert.equal(api.rSd({ sport: 'nfl', mkt: 'spread', period: '1h' }), nfl.sd * Math.sqrt(0.5));
  assert.equal(api.rSd({ sport: 'nfl', mkt: 'total', period: '2q' }), nfl.tot * Math.sqrt(0.25));
  assert.equal(api.rSd({ sport: 'cfb', mkt: 'ml', period: '2h' }), api.ROYALE_SD.cfb.sd * Math.sqrt(0.5));
  assert.equal(api.rSd({ sport: 'nfl', mkt: 'prop', line: 60.5, period: '1h' }), 60.5 * 0.55, 'props keep their placeholder');
  // deficit: lost a 1H spread by 7 laying 3 → edge -10, over SD 13.5·√.5
  const d = api.royaleBeatDeficit({ sport: 'nfl', mkt: 'spread', line: 3, period: '1h', price: -150 }, { actual: -7 });
  assert.equal(d.basis, 'scaled-sd');
  assert.ok(Math.abs(d.v - 10 / (13.5 * Math.sqrt(0.5))) < 1e-12);
  const g = api.royaleBeatDeficit({ sport: 'nfl', mkt: 'spread', line: 3, price: -150 }, { actual: -7 });
  assert.equal(g.basis, 'margin');
  assert.ok(Math.abs(g.v - 10 / 13.5) < 1e-12);
  // the stamp the grader writes
  assert.equal(api.bozoBeatBasis({ mkt: 'spread' }), 'sd');
  assert.equal(api.bozoBeatBasis({ mkt: 'spread', period: '1h' }), 'scaled-sd');
  assert.equal(api.bozoBeatBasis({ mkt: 'prop', price: -150 }, { close: -160, closeOpp: 130 }), 'close');
  assert.match(worker, /row\.beatSd = rSd\(p\);\s*row\.beatBasis = bozoBeatBasis\(p, row\);/);
});

test('docs/bozo-sd.json is pinned to the grader, and the page scales the same way', () => {
  assert.deepEqual(plain(api.ROYALE_SD), sdDoc.game);
  assert.deepEqual(plain(api.BOZO_PERIOD_FRACTION), sdDoc.period_fraction);
  assert.match(sdDoc.period_rule, /sqrt\(period_fraction\)/);
  assert.match(page, /const PERIOD_FRACTION = \{game:1,'1h':\.5,'2h':\.5,'1q':\.25,'2q':\.25,'3q':\.25,'4q':\.25\};/);
  assert.match(page, /return base \* Math\.sqrt\(PERIOD_FRACTION\[x\.period\|\|'game'\] \?\? 1\); \}/);
  assert.match(page, /const need = live\.filter\(isManualLeg\);/);
  assert.match(page, /needs manual grade/);
  assert.match(page, /scaled by the square root of the fraction played/);
});
