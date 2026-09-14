// Bozo week gate: Bozo Week N == NFL REG week N. Legs whose kickoff falls outside
// that week's Eastern gameday span (or NFL games from another week / preseason) are
// rejected with out_of_week. UI /scores?week=N returns the same filtered slate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'dawg-bot-worker.js'), 'utf8');
const seedSource = fs.readFileSync(path.join(root, 'bozo-team-registry.mjs'), 'utf8');
const seed = JSON.parse(seedSource.slice(seedSource.indexOf('{'), seedSource.lastIndexOf('};') + 1));

function between(start, end) {
  const a = worker.indexOf(start);
  const b = worker.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `markers: ${start}`);
  return worker.slice(a, b);
}

const context = vm.createContext({
  Intl, Date, Number, String, Object, Array, Set, Map, Promise, JSON, Math, Response, URL,
  crypto, TextEncoder, TextDecoder, Uint8Array, Request,
  BOZO_ESPN_TEAM_SEED: seed,
  SEASON: 2026,
  LEAGUE: { nfl: 1, cfb: 1 },
  BOZO_GRADEABLE_SPORTS: new Set(['nfl', 'cfb']),
  MARKETS: ['spread', 'ml', 'total', 'prop', 'other'],
  bzNorm: s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
  bzAmerican: v => { const n = Number(v); return Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null; },
  assertQuote: () => null,
  playerName: s => { try { return decodeURIComponent(s); } catch { return s; } },
  encodeURIComponent, isNaN, isFinite, RegExp,
  json: (body, status = 200) => ({ status, body }),
});

vm.runInContext([
  between('const BOZO_PERIODS = [', '/* ---------------- player props ----------------'),
  between('const BOZO_GRADEABLE_SPORTS', 'const ledgerKey'),
  between('const selectionKeyOf = p => [', '// Server-side Fisher'),
  `this.api = {
    bozoEasternDate, bozoNflWeekWindow, bozoStartsAtInWeekWindow, bozoWeekGateError,
    bozoPublicScheduleGames, bozoScheduleFindGame, validatePick,
  };`,
].join('\n'), context);

const api = context.api;

const nflGames = [
  {
    espnEventId: '401772710', week: 1, seasonType: 'REG',
    localDate: '2026-09-07', startsAt: '2026-09-07T17:00:00.000Z',
    canonicalKey: 'nfl|phi~was|2026-09-07',
    completed: false,
    away: { abbr: 'WAS', name: 'WAS' }, home: { abbr: 'PHI', name: 'PHI' },
    awayScore: null, homeScore: null,
  },
  {
    espnEventId: '401772720', week: 1, seasonType: 'REG',
    localDate: '2026-09-08', startsAt: '2026-09-09T00:20:00.000Z',
    canonicalKey: 'nfl|dal~nyg|2026-09-08',
    completed: false,
    away: { abbr: 'DAL', name: 'DAL' }, home: { abbr: 'NYG', name: 'NYG' },
    awayScore: null, homeScore: null,
  },
  {
    espnEventId: '401772810', week: 2, seasonType: 'REG',
    localDate: '2026-09-14', startsAt: '2026-09-14T17:00:00.000Z',
    canonicalKey: 'nfl|phi~ten|2026-09-14',
    completed: false,
    away: { abbr: 'PHI', name: 'PHI' }, home: { abbr: 'TEN', name: 'TEN' },
    awayScore: null, homeScore: null,
  },
  {
    espnEventId: '401770001', week: 0, seasonType: 'PRE',
    localDate: '2026-08-15', startsAt: '2026-08-15T23:00:00.000Z',
    canonicalKey: 'nfl|ten~sf|2026-08-15',
    completed: true,
    away: { abbr: 'TEN', name: 'TEN' }, home: { abbr: 'SF', name: 'SF' },
    awayScore: 17, homeScore: 20,
  },
];

const cfbGames = [
  {
    espnEventId: '401858425', week: 2, seasonType: 'regular',
    localDate: '2026-09-05', startsAt: '2026-09-05T16:00:00.000Z',
    canonicalKey: 'cfb|indianahoosiers~northtexasmeangreen|2026-09-05',
    completed: false,
    away: { abbr: 'UNT', name: 'North Texas' }, home: { abbr: 'IU', name: 'Indiana' },
    awayScore: null, homeScore: null,
  },
  {
    espnEventId: '401858999', week: 3, seasonType: 'regular',
    localDate: '2026-09-14', startsAt: '2026-09-14T19:30:00.000Z',
    canonicalKey: 'cfb|navy~uab|2026-09-14',
    completed: false,
    away: { abbr: 'UAB', name: 'UAB' }, home: { abbr: 'NAVY', name: 'Navy' },
    awayScore: null, homeScore: null,
  },
];

const nflDoc = { games: nflGames, source: 'test', fetchedAt: '2026-09-13T00:00:00.000Z' };
const cfbDoc = { games: cfbGames, source: 'test', fetchedAt: '2026-09-13T00:00:00.000Z' };

const band = { ceil: -100, floor: -500 };
const baseLeg = {
  sport: 'nfl', mkt: 'ml', side: 'PHI', line: 0, label: 'PHI ML',
  price: -150, priceOpp: 130, priceSource: 'captured',
  entrySnapshotAt: '2026-09-06T12:00:00.000Z',
  providerEventIds: { sgo: 'abc' },
};

function gateFor(week) {
  return {
    week,
    window: api.bozoNflWeekWindow(nflDoc, week),
    docs: { nfl: nflDoc, cfb: cfbDoc },
  };
}

const plain = v => JSON.parse(JSON.stringify(v));

test('NFL week window is the inclusive Eastern gameday span of REG games', () => {
  const w1 = plain(api.bozoNflWeekWindow(nflDoc, 1));
  assert.deepEqual(w1, {
    week: 1, loDate: '2026-09-07', hiDate: '2026-09-08',
    startMs: Date.parse('2026-09-07T17:00:00.000Z'),
    endMs: Date.parse('2026-09-09T00:20:00.000Z'),
  });
  assert.equal(api.bozoNflWeekWindow(nflDoc, 99), null);
});

test('in-week NFL leg is accepted', () => {
  const p = {
    ...baseLeg,
    eventId: '401772710', game: 'WAS @ PHI',
    startsAt: '2026-09-07T17:00:00.000Z',
  };
  assert.equal(api.validatePick(p, 'Kap', {}, band, 'standard', 'u_kap', gateFor(1)), null);
});

test('out-of-week NFL leg (Week 2 game on Week 1 board) is rejected', () => {
  const p = {
    ...baseLeg,
    eventId: '401772810', game: 'PHI @ TEN', side: 'PHI', label: 'PHI ML',
    startsAt: '2026-09-14T17:00:00.000Z',
  };
  const err = api.validatePick(p, 'Kap', {}, band, 'standard', 'u_kap', gateFor(1));
  assert.match(err, /^out_of_week:/);
  assert.match(err, /NFL Week 2/);
  assert.match(err, /Bozo Week 1/);
});

test('preseason NFL leg is rejected as out_of_week', () => {
  const p = {
    ...baseLeg,
    eventId: '401770001', game: 'TEN @ SF', side: 'SF', label: 'SF ML',
    startsAt: '2026-08-15T23:00:00.000Z',
  };
  const err = api.validatePick(p, 'Kap', {}, band, 'standard', 'u_kap', gateFor(1));
  assert.match(err, /^out_of_week:/);
  assert.match(err, /not a regular-season/);
});

test('CFB kickoff outside the NFL week window is rejected', () => {
  const p = {
    ...baseLeg,
    sport: 'cfb', eventId: '401858999', game: 'UAB @ NAVY', side: 'NAVY', label: 'NAVY ML',
    startsAt: '2026-09-14T19:30:00.000Z',
  };
  const err = api.validatePick(p, 'Kap', {}, band, 'standard', 'u_kap', gateFor(1));
  assert.match(err, /^out_of_week:/);
  assert.match(err, /outside Bozo Week 1/);
});

test('CFB kickoff inside the NFL week window is accepted', () => {
  // Force a CFB start that lands on Week 1's Eastern dates.
  const p = {
    ...baseLeg,
    sport: 'cfb', eventId: '401858425', game: 'UNT @ IU', side: 'IU', label: 'IU ML',
    startsAt: '2026-09-07T19:00:00.000Z',
  };
  assert.equal(api.validatePick(p, 'Kap', {}, band, 'standard', 'u_kap', gateFor(1)), null);
});


test('bozoPublicScheduleGames week match returns only REG games for that week', () => {
  const games = api.bozoPublicScheduleGames(nflDoc, '', { week: 1, matchWeek: true });
  assert.deepEqual(games.map(g => g.id).sort(), ['401772710', '401772720']);
  const w2 = api.bozoPublicScheduleGames(nflDoc, '', { week: 2, matchWeek: true });
  assert.deepEqual(w2.map(g => g.id), ['401772810']);
});

test('bozoPublicScheduleGames window filter keeps CFB inside NFL week dates', () => {
  const window = api.bozoNflWeekWindow(nflDoc, 1);
  const games = api.bozoPublicScheduleGames(cfbDoc, '', { window });
  // 2026-09-05 is before Week 1 window (09-07..09-08); 09-14 is after — none in window
  assert.equal(games.length, 0);
  const inWindowDoc = {
    games: [{
      ...cfbGames[0],
      localDate: '2026-09-07', startsAt: '2026-09-07T16:00:00.000Z',
      espnEventId: '401850001',
    }],
  };
  const kept = api.bozoPublicScheduleGames(inWindowDoc, '', { window });
  assert.deepEqual(kept.map(g => g.id), ['401850001']);
});

// Source invariants: picker and pick route both consult the week gate.
test('Worker and page both gate on the current Bozo week', () => {
  assert.match(worker, /async function bozoWeekGate\(/);
  assert.match(worker, /bozoWeekGateError\(p, weekGate\)/);
  assert.match(worker, /url\.searchParams\.get\("week"\)/);
  const page = fs.readFileSync(path.join(root, 'bozo.html'), 'utf8');
  assert.match(page, /\/scores\?sport=\$\{sport\}&week=\$\{week\}/);
  assert.match(page, /inWeekWindow/);
  assert.match(page, /no games in this Bozo week/);
});
