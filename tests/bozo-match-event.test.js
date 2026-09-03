const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.join(__dirname, '..', 'dawg-bot-worker.js'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'sgo-ncaaf-2026-09-05.json'), 'utf8'));

function between(start, end) {
  const a = worker.indexOf(start);
  const b = worker.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source markers exist: ${start} … ${end}`);
  return worker.slice(a, b);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext([
  'const BOZO_CLOSE_BOOK = "draftkings";',
  between('const bzNorm =', '/* ---------------- player props'),
  between('const bzAmerican =', '/* Resolve one free-text prop'),
  between('function bozoMatchEvent(', '/* The cron body.'),
  'this.api = { bozoTeamNorm, bozoDkQuote, bozoMatchEvent };',
].join('\n'), sandbox);

const { bozoTeamNorm, bozoDkQuote, bozoMatchEvent } = sandbox.api;
const target = fixture.data.find((event) => event.eventID === 'QzGmzxPGyovJ48j1BUHc');

test('the captured UNT-Indiana names really are long-only', () => {
  assert.deepEqual(Object.keys(target.teams.home.names), ['long']);
  assert.deepEqual(Object.keys(target.teams.away.names), ['long']);
  assert.equal(target.teams.home.names.long, 'Indiana');
  assert.equal(target.teams.away.names.long, 'North Texas');
});

test('the Week 1 floor matches UNT @ IU and both supported separators', () => {
  for (const game of ['UNT @ IU', 'UNT vs IU', 'UNT VS. IU']) {
    assert.equal(bozoMatchEvent(fixture.data, { game })?.eventID, target.eventID, game);
  }
  assert.equal(bozoTeamNorm('UNT'), bozoTeamNorm('North Texas'));
  assert.equal(bozoTeamNorm('IU'), bozoTeamNorm('Indiana'));
});

test('full-name equality does not collapse Miami into Miami (OH)', () => {
  assert.equal(bozoMatchEvent(fixture.data, { game: 'Miami @ Stanford' })?.eventID,
    'f5mweoy6d2NQvns6K9mB');
  assert.equal(bozoMatchEvent(fixture.data, { game: 'Miami (OH) @ Pittsburgh' })?.eventID,
    'ndZjaKF9HZGCGNyZ1w45');
  assert.equal(bozoMatchEvent(fixture.data, { game: 'Miami @ Pittsburgh' }), null);
});

test('the same floor orients a DK quote when SGO supplies only long names', () => {
  const quote = bozoDkQuote(target, { mkt: 'spread', side: 'IU' });
  assert.equal(quote.price, -108);
  assert.equal(quote.opp, -112);
});
