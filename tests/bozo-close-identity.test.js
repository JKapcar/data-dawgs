const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.join(__dirname, '..', 'dawg-bot-worker.js'), 'utf8');

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
  'const ledgerKey = (season, week, key) => `${season}-w${week}-${key}`;',
  between('const BOZO_KAP_W1_CLEANUP_KEY', 'async function cleanupBozoKapW1Orphans('),
  between('function bozoCloseMutation(', '/* The cron body.'),
  'this.api = { bozoCloseMutation, isBozoKapW1Orphan };',
].join('\n'), sandbox);

const { bozoCloseMutation, isBozoKapW1Orphan } = sandbox.api;
const target = {
  lid: 'main', key: 'u_abc', uid: 'u_abc', player: 'Kap',
  season: 2026, week: 1, pick: { eventId: '401858425' },
};

test('a close mutation always stamps player and uid on the ledger row', () => {
  const patch = bozoCloseMutation(target, { price: -108, opp: -112 }, null,
    '2026-09-05T16:00:00.000Z');
  assert.equal(patch['ledger/2026-w1-u_abc/player'], 'Kap');
  assert.equal(patch['ledger/2026-w1-u_abc/uid'], 'u_abc');
  assert.equal(patch['results/u_abc/close'], -108);
  assert.equal(patch['ledger/2026-w1-u_abc/close'], -108);
});

test('a missing pick writes nothing', () => {
  assert.equal(bozoCloseMutation({ ...target, pick: null }, null, 'unmatched', null), null);
});

test('an unresolved uid writes nothing instead of a partial ledger row', () => {
  assert.equal(bozoCloseMutation({ ...target, uid: null }, null, 'unmatched', null), null);
});

test('the one-shot cleanup accepts only the exact close-only orphan shape', () => {
  const orphan = {
    closeSource: 'sgo',
    closeUnavailableReason: "No closing price captured: this game couldn't be matched at the odds source.",
  };
  assert.equal(isBozoKapW1Orphan(orphan), true);
  assert.equal(isBozoKapW1Orphan({ ...orphan, player: 'Kap' }), false);
  assert.equal(isBozoKapW1Orphan({ ...orphan, closeSource: 'manual' }), false);
});
