const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.join(__dirname, '..', 'dawg-bot-worker.js'), 'utf8');
const registryModule = fs.readFileSync(path.join(__dirname, '..', 'bozo-team-registry.mjs'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'sgo-ncaaf-2026-09-05.json'), 'utf8'));
const seedMatch = registryModule.match(/export const BOZO_ESPN_TEAM_SEED = ([\s\S]*);\s*$/);
assert.ok(seedMatch, 'generated ESPN registry exports its seed');

function between(start, end) {
  const a = worker.indexOf(start);
  const b = worker.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source markers exist: ${start} … ${end}`);
  return worker.slice(a, b);
}

const sandbox = { FIXTURE: fixture.data };
vm.createContext(sandbox);
vm.runInContext([
  'const BOZO_CLOSE_BOOK = "draftkings";',
  `const BOZO_ESPN_TEAM_SEED = ${seedMatch[1]};`,
  between('const bzNorm =', '/* ---------------- player props'),
  between('const BOZO_STAT_WORDS =', 'const bzAmerican ='),
  between('const bzAmerican =', '/* Resolve one free-text prop'),
  between('function bozoDkPropQuote(', '// Every leg across every league'),
  between('function bozoMatchEvent(', '/* The cron body.'),
  'async function bozoFetchEvents(){ return FIXTURE; }',
  'this.api = { bozoBuildTeamRegistry, bozoTeamRegistry, bozoTeamNorm, bozoDkQuote, bozoMatchEvent, bozoCaptureEntry, assertQuote };',
].join('\n'), sandbox);

const { bozoBuildTeamRegistry, bozoTeamRegistry, bozoTeamNorm, bozoDkQuote, bozoMatchEvent,
  bozoCaptureEntry, assertQuote } = sandbox.api;
const cfbBuilt = bozoBuildTeamRegistry('cfb');
const nflBuilt = bozoBuildTeamRegistry('nfl');
const cfbRegistry = cfbBuilt.aliases;
const nflRegistry = nflBuilt.aliases;
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

test('the ESPN registry joins abbreviations to SGO long names without collapsing Miami', () => {
  assert.equal(cfbBuilt.teamCount, 148);
  assert.equal(nflBuilt.teamCount, 32);
  assert.equal(bozoTeamNorm('UNT', cfbRegistry), bozoTeamNorm('North Texas', cfbRegistry));
  assert.equal(bozoTeamNorm('IU', cfbRegistry), bozoTeamNorm('Indiana', cfbRegistry));
  assert.equal(bozoMatchEvent(fixture.data, { game: 'MIA @ STAN' }, cfbRegistry)?.eventID,
    'f5mweoy6d2NQvns6K9mB');
  assert.equal(bozoMatchEvent(fixture.data, { game: 'M-OH @ PITT' }, cfbRegistry)?.eventID,
    'ndZjaKF9HZGCGNyZ1w45');
  assert.equal(bozoMatchEvent(fixture.data, { game: 'MIA @ PITT' }, cfbRegistry), null);
});

test('the NFL registry supports both separators with the full three-name SGO shape', () => {
  const event = { eventID: 'nfl-ten-sf', teams: {
    away: { names: { long: 'Tennessee Titans', medium: 'Titans', short: 'TEN' } },
    home: { names: { long: 'San Francisco 49ers', medium: '49ers', short: 'SF' } },
  } };
  assert.equal(bozoMatchEvent([event], { game: 'TEN @ SF' }, nflRegistry)?.eventID, event.eventID);
  assert.equal(bozoMatchEvent([event], { game: 'TEN vs SF' }, nflRegistry)?.eventID, event.eventID);
});

test('the same floor orients a DK quote when SGO supplies only long names', () => {
  const quote = bozoDkQuote(target, { mkt: 'spread', side: 'IU', line: 40.5 }, cfbRegistry);
  assert.equal(quote.price, -108);
  assert.equal(quote.opp, -112);
  assert.equal(quote.line, 40.5);
  assert.equal(quote.bookLine, -40.5);
});

test('quote orientation checks every SGO name instead of trusting a drifting short name', () => {
  const event = structuredClone(target);
  event.teams.home.names.short = 'IND';
  event.teams.home.names.medium = 'Hoosiers';
  const quote = bozoDkQuote(event, { mkt: 'spread', side: 'IU', line: 40.5 }, cfbRegistry);
  assert.equal(quote.price, -108);
  assert.equal(quote.opp, -112);
});

test('an alternate spread returns both DK sides at the exact selected number', () => {
  const quote = bozoDkQuote(target, { mkt: 'spread', side: 'IU', line: 39.5 }, cfbRegistry);
  assert.equal(quote.price, -122);
  assert.equal(quote.opp, -109);
  assert.equal(quote.line, 39.5);
  assert.equal(quote.bookLine, -39.5);
  assert.equal(quote.snapshotAt, '2026-09-03T23:19:46.604Z');
});

test('a missing alternate never falls through to the main-line quote', () => {
  const quote = bozoDkQuote(target, { mkt: 'spread', side: 'IU', line: 39.25 }, cfbRegistry);
  assert.match(quote.reason, /no two-sided spread market/);
  assert.equal(quote.price, undefined);
});

test('submit-time capture freezes the real two-sided DK alternate and receipt', async () => {
  const out = await bozoCaptureEntry({}, {
    sport: 'cfb', eventId: '401752661', game: 'UNT @ IU', mkt: 'spread', side: 'IU',
    line: 39.5, label: 'IU -39.5', startsAt: '2026-09-05T16:00:00.000Z', typedPrice: -120,
  });
  assert.equal(out.ok, true);
  assert.equal(out.p.price, -122);
  assert.equal(out.p.priceOpp, -109);
  assert.equal(out.p.priceSource, 'captured');
  assert.equal(out.p.clvEligible, true);
  assert.equal(out.p.providerEventIds.sgo, 'QzGmzxPGyovJ48j1BUHc');
  assert.equal(out.p.canonicalKey, 'cfb|indianahoosiers~northtexasmeangreen|2026-09-05');
  assert.equal(out.p.entrySnapshotAt, '2026-09-03T23:19:46.604Z');
  assert.equal(out.agreement.needsConfirmation, false);
});

test('strict game markets reject capture failure while prop fallback is visibly ineligible', async () => {
  const base = { sport: 'cfb', eventId: 'x', game: 'UNT @ IU', side: 'IU', line: 39.25,
    label: 'test', startsAt: '2026-09-05T16:00:00.000Z', typedPrice: -130 };
  const spread = await bozoCaptureEntry({}, { ...base, mkt: 'spread' });
  assert.equal(spread.ok, false);
  assert.match(spread.error, /Nothing was submitted/);
  const prop = await bozoCaptureEntry({}, { ...base, mkt: 'prop', side: 'over', prop: 'Nobody receiving yards' });
  assert.equal(prop.ok, true);
  assert.equal(prop.p.priceSource, 'self');
  assert.equal(prop.p.clvEligible, false);
  assert.equal(prop.p.priceOpp, null);
});

test('assertQuote rejects a one-sided quote instead of assuming hold', () => {
  assert.match(assertQuote({ price: -120, opp: null, line: -3.5 }, { mkt: 'spread', line: -3.5 }), /two real/);
});

test('every write path is pinned to kickoff and a captured opposite side', () => {
  assert.match(worker, /if \(!p\.startsAt \|\| isNaN\(Date\.parse\(p\.startsAt\)\)\)/);
  assert.match(worker, /if \(gameMarket && bzAmerican\(p\.priceOpp\) === null\)/);
  assert.match(worker, /priceOpp: entryPriceOpp,\s*entryPriceOpp,/);
  assert.match(worker, /\{ required: \["sport", "eventId", "game", "mkt", "side", "label", "startsAt"\] \}/);
  assert.match(worker, /Phase two commits the quote frozen in KV/);
});

test('the generated registry is cached in KV and read back on the next call', async () => {
  const store = new Map();
  let puts = 0;
  const env = { RL: {
    async get(key, type) {
      const value = store.get(key);
      return type === 'json' && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { puts++; store.set(key, value); },
  } };
  const first = await bozoTeamRegistry(env, 'cfb');
  const second = await bozoTeamRegistry(env, 'cfb');
  assert.equal(puts, 1);
  assert.equal(first.unt, second.unt);
  assert.equal(first.northtexas, second.northtexas);
});
