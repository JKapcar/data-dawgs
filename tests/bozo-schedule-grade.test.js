const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'dawg-bot-worker.js'), 'utf8');
const nflCsv = fs.readFileSync(path.join(__dirname, 'fixtures', 'nflverse-games-sample.csv'), 'utf8');
const cfbCsv = fs.readFileSync(path.join(__dirname, 'fixtures', 'cfbfastr-schedule-2026-sample.csv'), 'utf8');
const seedSource = fs.readFileSync(path.join(root, 'bozo-team-registry.mjs'), 'utf8');
const seed = JSON.parse(seedSource.slice(seedSource.indexOf('{'), seedSource.lastIndexOf('};') + 1));

const scheduleStart = worker.indexOf('const BOZO_GRADEABLE_SPORTS');
const scheduleEnd = worker.indexOf('\nconst ledgerKey', scheduleStart);
const aliasStart = worker.indexOf('const BOZO_TEAM_FALLBACK_ALIASES');
const aliasEnd = worker.indexOf('\n// The two sides of each game-level market.', aliasStart);
const gradeStart = worker.indexOf('function bozoScheduledTeamSide');
const gradeEnd = worker.indexOf('\nasync function requireAdmin', gradeStart);
const gradeRouteStart = worker.indexOf('async function bozoGrade(');
const gradeRouteEnd = worker.indexOf('\nasync function bozoNext', gradeRouteStart);
const encodingStart = worker.indexOf('const te = new TextEncoder()');
const encodingEnd = worker.indexOf('\n// The pepper is mixed', encodingStart);
const hmacStart = worker.indexOf('async function hmac(');
const hmacEnd = worker.indexOf('\n// `p` pins the session', hmacStart);
const timingStart = worker.indexOf('function timingSafeEqual(');
const timingEnd = worker.indexOf('\n/* ============================ SwoleDawg', timingStart);
assert.ok(scheduleStart > 0 && scheduleEnd > scheduleStart && aliasStart > 0 && aliasEnd > aliasStart && gradeStart > 0 && gradeEnd > gradeStart);

const context = vm.createContext({
  Intl, Date, Number, String, Object, Array, Set, Map, Promise, JSON, Math, Response,
  crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array, Request,
  BOZO_ESPN_TEAM_SEED: seed,
  bzNorm: s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
  playerName: s => decodeURIComponent(s),
});
vm.runInContext(worker.slice(scheduleStart, scheduleEnd)
  + '\n' + worker.slice(aliasStart, aliasEnd)
  + '\n' + worker.slice(encodingStart, encodingEnd)
  + '\n' + worker.slice(hmacStart, hmacEnd)
  + '\n' + worker.slice(timingStart, timingEnd)
  + '\n' + worker.slice(gradeStart, gradeEnd)
  + '\n' + worker.slice(gradeRouteStart, gradeRouteEnd)
  + `\nthis.api={bozoCsvTable,bozoEasternKickoff,bozoNormalizeNflSchedule,bozoNormalizeCfbSchedule,
      bozoRefreshOneSchedule,bozoPublicScheduleGames,bozoScheduledOutcome,bozoGradeFromScheduleKv,
      bozoGradeConfirmCode,readBozoGradeConfirm,bozoGrade};`, context);
const api = context.api;
const byEspn = (games, id) => games.find(game => game.espnEventId === id);

test('captured CSV fixtures preserve quoted commas and source columns', () => {
  const table = api.bozoCsvTable(cfbCsv);
  assert.equal(table.rows[1][table.index.venue], 'Memorial Stadium (Bloomington, IN)');
  assert.equal(table.rows[1][table.index.home_points], 'NA');
});

test('nflverse gameday + gametime is interpreted in America/New_York', () => {
  assert.equal(api.bozoEasternKickoff('2026-09-13', '13:00'), '2026-09-13T17:00:00.000Z');
  assert.equal(api.bozoEasternKickoff('2026-12-13', '13:00'), '2026-12-13T18:00:00.000Z');
  const complete = byEspn(api.bozoNormalizeNflSchedule(nflCsv, 2025), '401772510');
  assert.equal(complete.startsAt, '2025-09-05T00:20:00.000Z');
  assert.equal(complete.awayScore, 20);
  assert.equal(complete.homeScore, 24);
  assert.equal(complete.completed, true);
});

test('nflverse pending scores remain null and no odds column enters KV shape', () => {
  const game = byEspn(api.bozoNormalizeNflSchedule(nflCsv, 2026), '401872656');
  assert.equal(game.awayScore, null);
  assert.equal(game.homeScore, null);
  assert.equal(game.completed, false);
  for (const forbidden of ['away_moneyline', 'home_moneyline', 'spread_line', 'total_line'])
    assert.equal(Object.hasOwn(game, forbidden), false, forbidden);
});

test('processed cfbfastR schedule carries ESPN id, UTC start and real completion', () => {
  const games = api.bozoNormalizeCfbSchedule(cfbCsv, 2026);
  const completed = byEspn(games, '401856766');
  const pending = byEspn(games, '401858425');
  assert.equal(completed.completed, true);
  assert.equal(completed.awayScore, 15);
  assert.equal(completed.homeScore, 10);
  assert.equal(pending.startsAt, '2026-09-05T16:00:00.000Z');
  assert.equal(pending.away.abbr, 'UNT');
  assert.equal(pending.home.abbr, 'IU');
  assert.equal(pending.canonicalKey, 'cfb|indianahoosiers~northtexasmeangreen|2026-09-05');
  assert.equal(pending.homeScore, null);
});

test('blank score is retryable pending, never a zero-score grade', () => {
  const pending = api.bozoScheduledOutcome({ sport: 'cfb', mkt: 'total', side: 'over', line: 50 },
    { completed: true, homeScore: null, awayScore: 21 });
  assert.deepEqual(JSON.parse(JSON.stringify(pending)), { pending: true, reason: 'scores_pending' });
});

test('a completed nflverse row grades an NFL game market', () => {
  const game = byEspn(api.bozoNormalizeNflSchedule(nflCsv, 2025), '401772510');
  const grade = api.bozoScheduledOutcome(
    { sport: 'nfl', game: 'DAL @ PHI', mkt: 'spread', side: 'PHI', line: 3 }, game);
  assert.equal(grade.pending, false);
  assert.equal(grade.actual, 4);
  assert.equal(grade.result, 'won');
});

test('UNT @ IU can grade the IND side through the captured registry aliases', () => {
  const base = byEspn(api.bozoNormalizeCfbSchedule(cfbCsv, 2026), '401858425');
  const grade = api.bozoScheduledOutcome(
    { sport: 'cfb', game: 'UNT @ IU', mkt: 'spread', side: 'IND', line: 7 },
    { ...base, completed: true, homeScore: 31, awayScore: 20 });
  assert.equal(grade.pending, false);
  assert.equal(grade.actual, 11);
  assert.equal(grade.result, 'won');
});

test('ETag refresh writes only schedule:{sport}:{season} and 304 writes nothing', async () => {
  const store = new Map(), writes = [];
  const kv = {
    async get(key, type) { const v = store.get(key); return type === 'json' && v ? JSON.parse(v) : (v || null); },
    async put(key, value) { writes.push(key); store.set(key, value); },
  };
  let sentHeaders;
  const first = await api.bozoRefreshOneSchedule({ RL: kv }, 'nfl', 2026, Date.parse('2026-09-04T00:00:00Z'),
    async (_url, init) => { sentHeaders = init.headers; return new Response(nflCsv, { status: 200, headers: { ETag: '"nfl-a"' } }); });
  assert.equal(first.status, 'updated');
  assert.deepEqual(writes, ['schedule:nfl:2026']);
  assert.equal(Object.keys(sentHeaders).length, 0);
  const saved = JSON.parse(store.get('schedule:nfl:2026'));
  assert.equal(saved.source.includes('nflverse/nfldata'), true);
  assert.equal(saved.etag, '"nfl-a"');

  const second = await api.bozoRefreshOneSchedule({ RL: kv }, 'nfl', 2026, Date.parse('2026-09-04T01:00:00Z'),
    async (_url, init) => { sentHeaders = init.headers; return new Response(null, { status: 304 }); });
  assert.equal(second.status, 'not_modified');
  assert.equal(sentHeaders['If-None-Match'], '"nfl-a"');
  assert.deepEqual(writes, ['schedule:nfl:2026']);
});

test('grade reads KV and strips a supplied game result while scores are blank', async () => {
  const games = api.bozoNormalizeCfbSchedule(cfbCsv, 2026);
  const doc = { source: 'cfbfastR processed', fetchedAt: '2026-09-04T00:00:00Z', games };
  const env = { RL: { async get(key, type) {
    assert.equal(key, 'schedule:cfb:2026');
    return type === 'json' ? doc : JSON.stringify(doc);
  } } };
  const state = { season: 2026, picks: { Kap: { who: 'Kap', sport: 'cfb', eventId: '401858425',
    espnEventId: '401858425', game: 'UNT @ IU', mkt: 'spread', side: 'IND', line: 7 } } };
  const out = await api.bozoGradeFromScheduleKv(env, state, { Kap: { actual: 999, result: 'won', won: true, close: -110 } });
  assert.equal(out.pending[0].reason, 'scores_pending');
  assert.deepEqual(JSON.parse(JSON.stringify(out.results.Kap)), { close: -110 });
});

test('grade confirmation freezes phase-one values in a signed, stateless token', async () => {
  const env = { BOZO_PEPPER: 'test-only-pepper' };
  const proposal = { v: 1, lid: 'main', week: 1, status: 'placed',
    expiresAt: Date.now() + 60_000,
    body: { results: { Kap: { result: 'lost' } }, bozo: 'Kap', bozoWhy: 'Bad beat 🐶', graded: true } };
  const token = await api.bozoGradeConfirmCode(env, proposal);
  assert.deepEqual(JSON.parse(JSON.stringify(await api.readBozoGradeConfirm(env, token))), proposal);
  assert.equal(await api.readBozoGradeConfirm(env, token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')), null);
});

test('/bozo/grade phase one writes nothing and phase two does not re-fetch scores', async () => {
  const games = api.bozoNormalizeCfbSchedule(cfbCsv, 2026);
  const completed = games.find(game => game.espnEventId === '401856766');
  const state = { season: 2026, week: 1, status: 'placed', settings: { format: 'standard' },
    picks: { Kap: { who: 'Kap', sport: 'cfb', eventId: '401856766', espnEventId: '401856766',
      game: 'TCU @ UNC', mkt: 'total', side: 'under', line: 30 } }, results: {} };
  const writes = [];
  context.requireManager = async () => ({ league: state, name: 'Kap', uid: 'u_kap' });
  context.readBody = request => request.json();
  context.leagueOf = body => body.league || 'main';
  context.json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
  context.LG = lid => `/bozo/leagues/${lid}`;
  context.fbPut = async (_env, path, value) => { writes.push({ path, value }); };
  context.fbPatch = async (_env, path, value) => { writes.push({ path, value }); };
  context.fbGet = async () => ({ data: {} });
  context.ledgerBackfill = async () => 0;
  context.ledgerGradeUpdate = () => ({});
  context.settingsOf = league => league.settings || {};
  context.royaleResolveWeek = async () => null;
  context.loadLeague = async () => state;
  context.ledgerKey = () => 'unused';
  let scheduleReads = 0;
  const env = { BOZO_PEPPER: 'test-only-pepper', RL: { async get(key, type) {
    assert.equal(key, 'schedule:cfb:2026');
    scheduleReads++;
    const doc = { source: 'cfbfastR fixture', fetchedAt: '2026-09-04T00:00:00Z', games: [completed] };
    return type === 'json' ? doc : JSON.stringify(doc);
  } } };
  const phaseOne = await api.bozoGrade(new Request('https://example.test/bozo/grade', { method: 'POST',
    body: JSON.stringify({ results: {}, bozo: 'Kap', bozoWhy: 'test', graded: true }) }), env, {});
  const proposal = await phaseOne.json();
  assert.equal(proposal.status, 'confirm_required');
  assert.equal(writes.length, 0);
  assert.equal(scheduleReads, 1);

  const phaseTwo = await api.bozoGrade(new Request('https://example.test/bozo/grade', { method: 'POST',
    body: JSON.stringify({ confirm: proposal.confirm_code }) }), env, {});
  assert.equal(phaseTwo.status, 200);
  assert.equal(scheduleReads, 1);
  assert.equal(writes.some(write => write.path === '/bozo/leagues/main/results'), true);
  assert.equal(writes.some(write => write.path === '/bozo/leagues/main/status' && write.value === 'graded'), true);
});
