// Bozo Menu ledger: grading at the published line, near-close CLV in the selection's own
// orientation, Wilson intervals, and the "missing is never zero" rules. Fixtures are the
// PUBLISHED menu (public feed) and Worker /scores rows; nothing here touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildLedger, gradeRow, parseSelection, parseEvent, wilson, MIN_RANK_N } from '../tools/bozo-menu-ledger.mjs';

const dir = new URL('./fixtures/bozo-menu-ledger/', import.meta.url);
const read = f => JSON.parse(fs.readFileSync(new URL(f, dir)));
const menu = read('menu-2026-10-05.json');
const scores = { cfb: read('scores-cfb.json').games, nfl: read('scores-nfl.json').games };
const built = buildLedger([menu], scores, '2026-10-10T02:00:00.000Z');
const row = id => built.ledger.data.rows.find(r => r.id === id);

test('rows grade at the published line; pending stays pending; scratch stays out of the menu totals', () => {
  assert.equal(row('cfb-2026-w6-liberty').result, 'win');            // LIB 35-3, -13.5
  assert.equal(row('cfb-2026-w6-liberty').actual.side_margin, 32);
  assert.equal(row('cfb-2026-w6-fiu').result, 'win');                // FIU 22-3, -4.5, but scratched
  assert.equal(row('nfl-202610-tb-dal-total-over').result, 'loss');   // 40 vs 47.5
  for (const id of ['cfb-2026-w6-usf', 'cfb-202610-usf-utsa-total-over', 'cfb-2026-w6-ball-state', 'nfl-202610-det-ari-moneyline'])
    assert.equal(row(id).result, 'pending', id);
  const card = built.scorecard.data;
  assert.equal(card.menu.n_graded, 2); assert.equal(card.menu.wins, 1);
  assert.equal(card.scratched_for_the_record.n_graded, 1);
  assert.match(card.menu.verdict, /^insufficient \(n=2 < 30\)$/);
  assert.equal(MIN_RANK_N, 30);
});

test('published numeric claims are read from the public row only, and derived arithmetic says so', () => {
  const lib = row('cfb-2026-w6-liberty').claims.find(c => c.kind === 'margin');
  assert.equal(lib.value, 19.8); assert.match(lib.derived, /-line \+ edge/);          // -(-13.5) + 6.3
  assert.equal(row('nfl-202610-tb-dal-total-over').claims[0].value, 50.7);
  const ind = row('cfb-202610-ind-neb-moneyline').claims.find(c => c.kind === 'probability');
  assert.equal(ind.value, 0.769);                                                     // break-even(-290) + 2.54pp
  const card = built.scorecard.data.sources;
  assert.deepEqual(JSON.parse(JSON.stringify(card[0].margin)), { n: 1, mae: 12.2, bias: -12.2, close_mae_same_games: { n: 0, mae: null } });
  assert.deepEqual(JSON.parse(JSON.stringify(card[1].total)), { n: 1, mae: 10.7, bias: 10.7, close_mae_same_games: { n: 0, mae: null } });
  assert.match(card[3].verdict, /not gradeable/); assert.match(card[4].verdict, /not gradeable/);
});

test('a missing number is null, never zero, and every envelope is dated and sourced', () => {
  const total = row('cfb-202610-usf-utsa-total-over');
  assert.equal(total.selection.line, 52, 'line from the published edge definition, not a 0 from a missing quote');
  assert.equal(total.selection.odds, null);
  for (const e of [built.ledger, built.scorecard]) { assert.equal(e.as_of, '2026-10-10'); assert.ok(e.source && e.note); }
  assert.equal(row('cfb-2026-w6-liberty').clv, null, 'no near-close captured: no CLV, not a zero');
});

test('near-close CLV is measured in the selection\'s own orientation, at the published number', () => {
  const close = { label: 'near-close', book: 'draftkings', source: 'SportsGameOdds', captured_at: '2026-10-10T16:25:00.000Z',
    spread: { home_line: -34.5, home_price: -110, away_price: -110,
      alternates: [{ home_line: -36, home_price: +105, away_price: -125 }] },
    total: { line: 54.5, over_price: -110, under_price: -110, alternates: [{ line: 53, over_price: -130, under_price: +110 }] },
    moneyline: { home_price: -5000, away_price: +1500 } };
  const game = { id: '401858482', start: '2026-10-10T16:30:00.000Z', final: true, close, scoreSource: 'x', scoreObservedAt: 'y',
    teams: [{ abbr: 'BALL', name: 'Ball State', home: false, score: 10 }, { abbr: 'NU', name: 'Northwestern', home: true, score: 41 }] };
  const ball = menu.candidates.find(c => c.id === 'cfb-2026-w6-ball-state');
  const r = gradeRow(ball, '2026-10-05', menu.published_at, { cfb: [game], nfl: [] });
  assert.equal(r.result, 'win');                         // lost by 31, +36 covers
  assert.equal(r.close.line, 34.5, 'the away side receives what the home side lays');
  assert.equal(r.clv.points, 1.5, '+36 against a +34.5 close is 1.5 points better');
  assert.equal(r.close.price_at_published_line.mine, -125, 'the +36 price comes from the alternate, away side');
  assert.equal(r.clv.close_fair_prob_at_published_line, 0.5325);   // -125 / +105 de-vigged
  assert.equal(r.clv.prob_pp, null, 'one-sided entry: no entry de-vig, no assumed juice');
  // A total: over 53 against a 54.5 close is 1.5 better; under the same is 1.5 worse.
  const over = { ...ball, id: 't', market: 'total', selection: 'over', edge: { value: 2, unit: 'points',
    definition: 'Data Dawgs arithmetic: public DRatings total 55 versus observed base-market reference 53, favoring over.' } };
  assert.equal(gradeRow(over, 'w', null, { cfb: [game], nfl: [] }).clv.points, 1.5);
  const under = { ...over, edge: { ...over.edge, definition: 'public DRatings total 51 versus observed base-market reference 53, favoring under.' } };
  assert.equal(gradeRow(under, 'w', null, { cfb: [game], nfl: [] }).clv.points, -1.5);
});

test('event and selection parsing handle neutral sites, abbreviations and prefix twins', () => {
  assert.deepEqual(parseEvent('Texas Longhorns vs Oklahoma Sooners (Cotton Bowl, neutral site)'), { away: 'Texas Longhorns', home: 'Oklahoma Sooners' });
  const twins = { teams: [{ abbr: 'UL', name: 'Louisiana', home: false }, { abbr: 'LT', name: 'Louisiana Tech', home: true }] };
  assert.equal(parseSelection({ market: 'spread', selection: 'Louisiana (ULL) +1.5 (base; shop)', sport: 'College football' }, twins).isHome, false);
  assert.equal(parseSelection({ market: 'spread', selection: 'Louisiana Tech −2.5 (base)', sport: 'College football' }, twins).isHome, true);
  const fiu = { teams: [{ abbr: 'NMSU', name: 'New Mexico State', home: false }, { abbr: 'FIU', name: 'Florida International', home: true }] };
  assert.equal(parseSelection({ market: 'spread', selection: 'FIU −4.5 (base)', sport: 'College football' }, fiu).isHome, true);
  // The resolved team is written on the row, so a mismatch is visible in the published ledger.
  assert.equal(row('cfb-2026-w6-fiu').selection.team, 'FIU');
  assert.equal(row('nfl-202610-det-ari-moneyline').selection.team, 'DET');
  assert.equal(row('nfl-202610-tb-dal-total-over').selection.team, null);
});

test('Wilson 90% intervals', () => {
  assert.deepEqual(wilson(0, 1), [0, 0.7301]);
  assert.deepEqual(wilson(1, 2), [0.1209, 0.8791]);
  assert.equal(wilson(0, 0), null);
});
