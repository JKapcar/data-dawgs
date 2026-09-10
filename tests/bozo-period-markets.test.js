// Phase 2.8a — period markets, capture side. A spread / ML / total leg may be for 1h, 2h
// or 1q–4q. The oddID builder puts the period in SGO's third token, the validator refuses
// what §2.2 does not allow, the dedup keys treat "Eagles -3 1h" and "Eagles -3 game" as
// different legs, and everything without a period reads as the full game, byte-identical.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.join(__dirname, '..', 'dawg-bot-worker.js'), 'utf8');
const fixture1h = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sgo-1h-ml.json'), 'utf8'));
const fixtureGame = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sgo-ncaaf-2026-09-05.json'), 'utf8'));

function between(start, end) {
  const a = worker.indexOf(start);
  const b = worker.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source markers exist: ${start} … ${end}`);
  return worker.slice(a, b);
}

const sandbox = {
  LEAGUE: { nfl: 1, cfb: 1, nba: 1, cbb: 1, mlb: 1, nhl: 1 },
  BOZO_GRADEABLE_SPORTS: new Set(['nfl', 'cfb', 'nba', 'cbb', 'mlb', 'nhl']),
  MARKETS: ['spread', 'ml', 'total', 'prop', 'other'],
  BOZO_CLOSE_BOOK: 'draftkings',
  bzAmerican: v => { const n = Number(v); return Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null; },
  assertQuote: () => null,
  bozoTeamNorm: s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
  playerName: k => { try { return decodeURIComponent(k); } catch { return k; } },
  encodeURIComponent, Number, String, Object, Array, Math, JSON, Date, isNaN, isFinite, RegExp,
};
vm.createContext(sandbox);
vm.runInContext([
  between('const BOZO_PERIODS = [', '/* ---------------- player props ----------------'),
  between('function bozoDkOutcome(', '/* Resolve one free-text prop'),
  between('const selectionKeyOf = p => [', '// Server-side Fisher'),
  'this.api = { BOZO_PERIODS, BOZO_PERIOD_FRACTION, bozoPeriodOf, bozoPeriodError, bozoOddIds, bozoLabelWithPeriod, bozoDkQuote, selectionKeyOf, marketKeyOf, validatePick };',
].join('\n'), sandbox);
const api = sandbox.api;
const plain = v => JSON.parse(JSON.stringify(v));   // sandbox values cross a realm; compare by shape

test('the static odd-id table is gone and bozoOddIds reproduces it for "game"', () => {
  assert.ok(!worker.includes('BOZO_ODD_IDS'), 'no caller reads the old table');
  assert.deepEqual(plain(api.bozoOddIds('ml')), ['points-home-game-ml-home', 'points-away-game-ml-away']);
  assert.deepEqual(plain(api.bozoOddIds('spread', 'game')), ['points-home-game-sp-home', 'points-away-game-sp-away']);
  assert.deepEqual(plain(api.bozoOddIds('total', 'game')), ['points-all-game-ou-over', 'points-all-game-ou-under']);
  assert.deepEqual(plain(api.bozoOddIds('ml', '1h')), ['points-home-1h-ml-home', 'points-away-1h-ml-away']);
  assert.deepEqual(plain(api.bozoOddIds('spread', '1h')), ['points-home-1h-sp-home', 'points-away-1h-sp-away']);
  assert.deepEqual(plain(api.bozoOddIds('total', '3q')), ['points-all-3q-ou-over', 'points-all-3q-ou-under']);
  assert.equal(api.bozoOddIds('prop', '1h'), null);
  assert.deepEqual(plain(api.bozoOddIds('ml', 'bogus')), plain(api.bozoOddIds('ml', 'game')), 'an unknown period never builds a bad id');
});

test('the 1h fixture is a real SGO capture: both DK sides price through bozoDkQuote', () => {
  assert.match(fixture1h.notice, /live SportsGameOdds capture/);
  const ev = fixture1h.data[0];
  const home = ev.teams.home.names, away = ev.teams.away.names;
  const homeName = home.short || home.medium || home.long, awayName = away.short || away.medium || away.long;
  const q = api.bozoDkQuote(ev, { sport: 'cfb', mkt: 'ml', side: homeName, line: 0, period: '1h' }, null);
  assert.equal(q.reason, undefined, JSON.stringify(q));
  assert.equal(q.price, api.bozoDkQuote(ev, { mkt: 'ml', side: awayName, line: 0, period: '1h' }, null).opp);
  assert.equal(q.line, 0);
  assert.equal(api.bzAmerican === undefined, true);
  // 1h markets are priced from the 1h ids, not the game ids
  const game = api.bozoDkQuote(ev, { mkt: 'ml', side: homeName, line: 0 }, null);
  assert.equal(game.reason, 'market-absent-at-source', 'the 1h-only fixture has no full-game market');
  // spread with a period, including the alt-line path on the stored 1h number
  const sp = ev.odds['points-home-1h-sp-home'].byBookmaker.draftkings;
  const storedLine = -Number(sp.spread);   // Bozo stores points this side gives up
  const qs = api.bozoDkQuote(ev, { mkt: 'spread', side: homeName, line: storedLine, period: '1h' }, null);
  assert.equal(qs.reason, undefined, JSON.stringify(qs));
  assert.equal(qs.price, Number(sp.odds));
});

test('every existing full-game fixture still parses identically with no period', () => {
  for (const ev of fixtureGame.data.slice(0, 5)) {
    const home = ev.teams.home.names; const homeName = home.short || home.medium || home.long;
    const withoutPeriod = api.bozoDkQuote(ev, { mkt: 'ml', side: homeName, line: 0 }, null);
    const withGame = api.bozoDkQuote(ev, { mkt: 'ml', side: homeName, line: 0, period: 'game' }, null);
    assert.deepEqual(JSON.parse(JSON.stringify(withoutPeriod)), JSON.parse(JSON.stringify(withGame)));
    if (!withoutPeriod.reason) assert.equal(withoutPeriod.price, Number(ev.odds['points-home-game-ml-home'].byBookmaker.draftkings.odds));
  }
});

test('validator: allowed (sport, mkt, period) pass; prop+period, unsupported sport, unknown period fail; absent = game', () => {
  const band = { ceil: -100, floor: -500 };
  const base = { sport: 'cfb', eventId: '401', game: 'UAB @ NAVY', label: 'NAVY ML', side: 'NAVY', mkt: 'ml', line: 0,
    startsAt: '2026-09-12T19:30:00.000Z', price: -150, priceOpp: 130, priceSource: 'captured',
    entrySnapshotAt: '2026-09-10T00:00:00.000Z', providerEventIds: { sgo: 'x' } };
  const v = p => api.validatePick(p, 'Kap', {}, band, 'standard', 'u_kap');
  assert.equal(v(base), null);
  assert.equal(v({ ...base, period: '1h' }), null);
  assert.equal(v({ ...base, period: '4q', mkt: 'spread', line: 3.5 }), null);
  assert.equal(v({ ...base, sport: 'nfl', period: '2h', mkt: 'total', line: 24.5, side: 'over' }), null);
  assert.equal(v({ ...base, sport: 'cbb', period: '1h' }), null);
  assert.match(v({ ...base, sport: 'cbb', period: '1q' }), /not supported for cbb/);
  assert.match(v({ ...base, sport: 'nhl', period: '1h' }), /not supported for nhl/);
  assert.match(v({ ...base, period: '1st' }), /Unknown period/);
  assert.match(v({ ...base, mkt: 'prop', prop: 'Kelce yards', line: 60.5, side: 'over', priceSource: 'self', period: '1q' }), /full-game only/);
  assert.match(v({ ...base, mkt: 'other', prop: 'no overtime', line: 0.5, side: 'over', priceSource: 'self', clvEligible: false, period: '1h' }), /full-game only/);
  assert.equal(api.bozoPeriodOf({}), 'game');
  assert.equal(api.bozoPeriodOf({ period: '' }), 'game');
  assert.equal(api.bozoPeriodOf({ period: '1H' }), '1h');
});

test('dedup: same side and number, different period, are distinct legs; game keys are unchanged', () => {
  const g = { eventId: '401', mkt: 'spread', side: 'PHI', line: 3 };
  assert.equal(api.selectionKeyOf(g), '401|spread|PHI|3|');
  assert.equal(api.selectionKeyOf({ ...g, period: 'game' }), '401|spread|PHI|3|', 'explicit game adds nothing');
  assert.equal(api.selectionKeyOf({ ...g, period: '1h' }), '401|spread|PHI|3||1h');
  assert.equal(api.marketKeyOf(g), '401|spread|3');
  assert.equal(api.marketKeyOf({ ...g, period: '1h' }), '401|spread|3|1h');
  // both survive on one board
  const band = { ceil: -100, floor: -500 };
  const leg = { sport: 'cfb', eventId: '401', game: 'A @ B', label: 'PHI -3', side: 'PHI', mkt: 'spread', line: 3,
    startsAt: '2026-09-12T19:30:00.000Z', price: -150, priceOpp: 130, priceSource: 'captured',
    entrySnapshotAt: 'x', providerEventIds: { sgo: 'x' } };
  const existing = { u_rog: { ...leg, who: 'Roger', selectionKey: api.selectionKeyOf(leg), marketKey: api.marketKeyOf(leg) } };
  assert.match(api.validatePick(leg, 'Kap', existing, band, 'standard', 'u_kap'), /already has that exact selection/);
  assert.equal(api.validatePick({ ...leg, period: '1h' }, 'Kap', existing, band, 'standard', 'u_kap'), null);
  // and the opposite side of the SAME period is still blocked, while the other period is not
  const opp = { ...leg, side: 'DAL', line: -3 };
  assert.match(api.validatePick(opp, 'Kap', existing, band, 'standard', 'u_kap'), /other side of that same market/);
  assert.equal(api.validatePick({ ...opp, period: '2h' }, 'Kap', existing, band, 'standard', 'u_kap'), null);
});

test('label and echo carry the period, idempotently, and the fraction table matches D21', () => {
  assert.equal(api.bozoLabelWithPeriod('UAB ML', '1h'), 'UAB ML · 1st half');
  assert.equal(api.bozoLabelWithPeriod('UAB ML · 1st half', '1h'), 'UAB ML · 1st half');
  assert.equal(api.bozoLabelWithPeriod('UAB ML', 'game'), 'UAB ML');
  assert.equal(api.bozoLabelWithPeriod('UAB ML', undefined), 'UAB ML');
  assert.deepEqual(plain(api.BOZO_PERIOD_FRACTION), { game: 1, '1h': 0.5, '2h': 0.5, '1q': 0.25, '2q': 0.25, '3q': 0.25, '4q': 0.25 });
  // the stored pick and the phase-one echo both go through it
  assert.match(worker, /label: String\(bozoLabelWithPeriod\(p\.label, bozoPeriodOf\(p\)\)\)\.slice\(0, 90\)/);
  assert.match(worker, /period: bozoPeriodOf\(p\),/);
  assert.match(worker, /BOZO_PERIOD_LABEL\[p\.period\] \? BOZO_PERIOD_LABEL\[p\.period\] \+ " " : ""/);
});

test('capture and the close cron ask SGO for every period the bucket needs', () => {
  assert.match(worker, /async function bozoFetchEvents\(env, sport, startMs, needProps, periods = \["game"\]\)/);
  assert.match(worker, /bozoFetchEvents\(env, p\.sport, startMs, p\.mkt === "prop", \[p\.period\]\)/);
  assert.match(worker, /const periods = \[\.\.\.new Set\(bucket\.legs\.map\(t => bozoPeriodOf\(t\.pick\)\)\)\];/);
  assert.match(worker, /const periodErr = bozoPeriodError\(p\);\s*if \(periodErr\) return \{ ok: false, reason: "bad_period"/);
  // MCP schemas and the board carry it
  const block = fs.readFileSync(path.join(__dirname, '..', 'work', 'mcp-block.js'), 'utf8');
  assert.equal((block.match(/period: \{ type: "string", enum: \["game", "1h", "2h", "1q", "2q", "3q", "4q"\]/g) || []).length, 2);
  assert.equal((block.match(/period: args\.period \? String\(args\.period\)\.toLowerCase\(\) : "game"/g) || []).length, 2);
  assert.match(block, /period: x\.period \|\| "game"/);
});
