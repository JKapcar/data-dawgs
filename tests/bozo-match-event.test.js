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

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext([
  'const BOZO_CLOSE_BOOK = "draftkings";',
  `const BOZO_ESPN_TEAM_SEED = ${seedMatch[1]};`,
  between('const bzNorm =', '/* ---------------- player props'),
  between('const bzAmerican =', '/* Resolve one free-text prop'),
  between('function bozoMatchEvent(', '/* The cron body.'),
  'this.api = { bozoBuildTeamRegistry, bozoTeamRegistry, bozoTeamNorm, bozoDkQuote, bozoMatchEvent };',
].join('\n'), sandbox);

const { bozoBuildTeamRegistry, bozoTeamRegistry, bozoTeamNorm, bozoDkQuote, bozoMatchEvent } = sandbox.api;
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
  const quote = bozoDkQuote(target, { mkt: 'spread', side: 'IU' }, cfbRegistry);
  assert.equal(quote.price, -108);
  assert.equal(quote.opp, -112);
});

test('quote orientation checks every SGO name instead of trusting a drifting short name', () => {
  const event = structuredClone(target);
  event.teams.home.names.short = 'IND';
  event.teams.home.names.medium = 'Hoosiers';
  const quote = bozoDkQuote(event, { mkt: 'spread', side: 'IU' }, cfbRegistry);
  assert.equal(quote.price, -108);
  assert.equal(quote.opp, -112);
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
