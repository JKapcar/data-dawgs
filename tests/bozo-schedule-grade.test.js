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
// Phase 2.8: the grade route stamps beatSd/beatBasis and classifies manual legs, so it
// needs the period helpers and the Worst Beat SD table in scope.
const sliceBetween = (a, b) => { const x = worker.indexOf(a); const y = worker.indexOf(b, x); assert.ok(x >= 0 && y > x, a); return worker.slice(x, y); };
vm.runInContext(sliceBetween('const ROYALE_SD = {', 'function rExpected(')   // the schedule slice already carries the period helpers
  + '\n' + sliceBetween('function royaleBeatDeficit(', '/* Score every losing leg on one lever.')
  + '\n' + worker.slice(scheduleStart, scheduleEnd)
  + '\n' + worker.slice(aliasStart, aliasEnd)
  + '\n' + worker.slice(encodingStart, encodingEnd)
  + '\n' + worker.slice(hmacStart, hmacEnd)
  + '\n' + worker.slice(timingStart, timingEnd)
  + '\n' + worker.slice(gradeStart, gradeEnd)
  + '\n' + sliceBetween('async function bozoCommitGrade(', '/* ===================== the manager\'s override')
  + '\n' + worker.slice(gradeRouteStart, gradeRouteEnd)
  + `\nthis.api={bozoCsvTable,bozoEasternKickoff,bozoNormalizeNflSchedule,bozoNormalizeCfbSchedule,
      bozoRefreshOneSchedule,bozoPublicScheduleGames,bozoScheduledOutcome,bozoGradeFromScheduleKv,
      bozoGradeConfirmCode,readBozoGradeConfirm,bozoGrade,bozoNormalizeOddsScores,bozoFallbackScores,
      bozoFinalsIndex,bozoAttachFinal,bozoPickAsGame,runBozoLiveScores,
      bozoNearCloseMarket,bozoNearCloseRecord,runBozoNearCloses,bozoNearCloseForGame,bozoNearCloseIndexFor};`, context);
// The near-close archive reads SGO's oddID grammar and American prices, and builds URLs.
context.URL = URL;
vm.runInContext('const BOZO_CLOSE_BOOK = "draftkings"; const BOZO_CLOSE_API = "https://api.sportsgameodds.com/v2/events";' +
  'const BOZO_SGO_LEAGUE = { nfl: "NFL", cfb: "NCAAF" };\n' +
  sliceBetween('const bozoOddIds =', '// "UAB ML') + '\n' +
  sliceBetween('const bzAmerican =', '// One DraftKings outcome can have'), context);
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

test('a manual stamp on a still-pending scheduled game is kept and still pending', async () => {
  const games = api.bozoNormalizeNflSchedule(nflCsv, 2026);
  const doc = { source: 'nflverse fixture', fetchedAt: '2026-09-13T00:00:00Z', games };
  const env = { RL: { async get(key, type) {
    assert.equal(key, 'schedule:nfl:2026');
    return type === 'json' ? doc : JSON.stringify(doc);
  } } };
  const state = { season: 2026, picks: { JWhite: { who: 'JWhite', sport: 'nfl', eventId: '401872656',
    espnEventId: '401872656', game: 'NE @ SEA', mkt: 'ml', side: 'SEA', line: null } } };
  const supplied = { JWhite: { result: 'won', won: true, resultSource: 'manual', close: -185 } };
  const out = await api.bozoGradeFromScheduleKv(env, state, supplied);
  assert.equal(out.pending[0].reason, 'scores_pending');
  assert.equal(out.pending[0].player, 'JWhite');
  assert.equal(out.results.JWhite.result, 'won');
  assert.equal(out.results.JWhite.won, true);
  assert.equal(out.results.JWhite.resultSource, 'manual');
  assert.equal(out.results.JWhite.close, -185);
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

// Synthetic provider payloads reproduce the September 26 stale-CFB-feed failure.
const scoreNow = Date.now();
const scoreStart = new Date(scoreNow - 8 * 3600_000).toISOString();
const scoreUpdated = new Date(scoreNow - 4 * 3600_000).toISOString();
context.BOZO_ODDS_API_SPORT = { nfl: 'americanfootball_nfl', cfb: 'americanfootball_ncaaf' };
function scoreEvent(id, away, home, a, h, sport = 'cfb') {
  return { id, sport_key: context.BOZO_ODDS_API_SPORT[sport], commence_time: scoreStart,
    away_team: away, home_team: home, completed: true, last_update: scoreUpdated,
    scores: [{ name: home, score: String(h) }, { name: away, score: String(a) }] };
}
const clemsonFinal = scoreEvent('synthetic-clemson', 'Clemson Tigers', 'California Golden Bears', 24, 10);
const indianaFinal = scoreEvent('synthetic-indiana', 'Northwestern Wildcats', 'Indiana Hoosiers', 23, 29);
const finalPick = (game, mkt, side, line = 0) => ({ sport: 'cfb', game, mkt, side, line,
  period: 'game', startsAt: scoreStart });
function scoreRig(rows, state) {
  const store = new Map(), calls = [];
  const env = { ODDS_API_KEY: 'test-only', RL: {
    async get(k) { return store.get(k) || null; },
    async put(k, v) { store.set(k, JSON.parse(v)); },
  }};
  context.bozoOddsApiRequest = async (_env, path, params) => {
    calls.push({path, params}); return { data: rows, fetchedAt: new Date().toISOString() };
  };
  return { env, store, calls, state };
}

test('stale CFB feed: both Friday legs win using one backup request; future leg stays pending', async () => {
  const state = { season: 2026, picks: {
    Roger: finalPick('CLEM @ CAL', 'ml', 'CLEM'),
    Tony: finalPick('NU @ IU', 'total', 'over', 45.5),
    Kap: { ...finalPick('CLEM @ CAL', 'ml', 'CLEM'), startsAt: new Date(scoreNow + 86400_000).toISOString() },
  }, results: { Roger: { close: -142, closeOpp: 120 } } };
  const r = scoreRig([clemsonFinal, indianaFinal], state);
  const out = await api.bozoGradeFromScheduleKv(r.env, state);
  assert.equal(out.results.Roger.result, 'won'); assert.equal(out.results.Roger.actual, 14);
  assert.equal(out.results.Tony.result, 'won'); assert.equal(out.results.Tony.actual, 52);
  assert.equal(out.results.Roger.close, -142); assert.equal(out.results.Roger.closeOpp, 120);
  assert.equal(out.results.Roger.gradeSource, 'the-odds-api');
  assert.equal(out.results.Roger.gradeObservedAt, scoreUpdated);
  assert.equal(out.pending.length, 1); assert.equal(out.pending[0].key, 'Kap');
  assert.equal(r.calls.length, 1); assert.equal(r.calls[0].params.daysFrom, 3);
});

test('NFL fallback handles underdogs and does not depend on CFB availability', async () => {
  const event = scoreEvent('synthetic-nfl', 'Tennessee Titans', 'New York Giants', 20, 24, 'nfl');
  const pick = { ...finalPick('TEN @ NYG', 'spread', 'TEN', -7.5), sport: 'nfl' };
  const r = scoreRig([event]);
  const out = await api.bozoGradeFromScheduleKv(r.env, { season: 2026, picks: { A: pick } });
  assert.equal(out.results.A.result, 'won'); assert.equal(out.results.A.actual, -4);
  assert.match(r.calls[0].path, /americanfootball_nfl\/scores$/);
});

test('in-progress, blank, wrong sport, wrong date, and incomplete score pairs cannot settle', async () => {
  const fetched = new Date().toISOString();
  for (const mutate of [e => e.completed = false, e => e.scores[0].score = '',
    e => e.scores[0].score = null, e => e.scores.pop(), e => e.sport_key = 'americanfootball_nfl',
    e => e.last_update = null, e => e.scores[0].score = '-1']) {
    const e = structuredClone(clemsonFinal); mutate(e);
    assert.equal(api.bozoNormalizeOddsScores('cfb', [e], fetched).length, 0);
  }
  const differentDate = { ...clemsonFinal, commence_time: new Date(scoreNow - 7 * 86400_000).toISOString() };
  const r = scoreRig([differentDate]);
  const out = await api.bozoGradeFromScheduleKv(r.env, {season: 2026, picks: { A: finalPick('CLEM @ CAL','ml','CLEM') }});
  assert.equal(out.pending.length, 1); assert.equal(out.results.A, undefined);
});

test('cached finals survive provider three-day expiry and outages without refreshing their timestamp', async () => {
  const r = scoreRig([clemsonFinal]);
  const first = await api.bozoFallbackScores(r.env, 'cfb', 2026, scoreNow);
  await api.bozoFallbackScores(r.env, 'cfb', 2026, scoreNow + 1000);
  assert.equal(r.calls.length, 1);
  context.bozoOddsApiRequest = async () => ({ data: [], fetchedAt: new Date(scoreNow + 5 * 86400_000).toISOString() });
  const later = await api.bozoFallbackScores(r.env, 'cfb', 2026, scoreNow + 5 * 86400_000);
  assert.equal(later.games.length, 1); assert.equal(later.games[0].scoreObservedAt, scoreUpdated);
  context.bozoOddsApiRequest = async () => { throw Error('private URL must not be copied'); };
  const failed = await api.bozoFallbackScores(r.env, 'cfb', 2026, scoreNow + 6 * 86400_000);
  assert.equal(failed.games.length, 1); assert.equal(failed.error, 'score_fallback_unavailable');
  assert.ok(!JSON.stringify(failed).includes('private URL'));
  assert.equal(first.games[0].homeScore, 10);
});

test('outage preserves server-banked finals, rejects forged supplied grades, preserves manual gate', async () => {
  const pick = finalPick('CLEM @ CAL','ml','CLEM');
  const banked = { actual: 14, result: 'won', won: true, gradeSource: 'the-odds-api', gradeObservedAt: scoreUpdated };
  const r = scoreRig([]);
  context.bozoOddsApiRequest = async () => { throw Error('offline'); };
  const base = {season:2026,picks:{A:pick}};
  const saved = await api.bozoGradeFromScheduleKv(r.env, {...base,results:{A:banked}});
  assert.equal(saved.results.A.result, 'won'); assert.equal(saved.pending.length, 0);
  const forged = await api.bozoGradeFromScheduleKv(r.env, base, {A:banked});
  assert.equal(forged.results.A, undefined); assert.equal(forged.pending.length, 1);
  const manual = await api.bozoGradeFromScheduleKv(r.env, {...base,results:{A:{...banked,resultSource:'manual'}}});
  assert.equal(manual.pending.length, 1);
});

test('props and half-game picks never use full-game fallback scores', async () => {
  const r = scoreRig([clemsonFinal]);
  const state = {season:2026,picks:{A:{...finalPick('CLEM @ CAL','ml','CLEM'),period:'1h'},
    B:finalPick('CLEM @ CAL','prop','CLEM')}};
  const out = await api.bozoGradeFromScheduleKv(r.env,state);
  assert.equal(Object.keys(out.results).length, 0); assert.equal(r.calls.length, 0);
});

/* ---- live finals: tolerant attachment (Oct 2026 midweek CFB gap) ----
   Reproduces the week-6 shape: cfbfastR has the game at 7:30 PM ET (23:30Z) and the
   provider at 8:00 PM ET (00:00Z the NEXT UTC day). The old exact canonical-key lookup
   embedded the UTC date, so this final could never attach. All times are relative to
   the run so the suite does not age out. */
const utcMidnight = (() => { const d = new Date(scoreNow - 86400_000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); })();
const schedStart = new Date(utcMidnight - 30 * 60_000).toISOString();
const provStart = new Date(utcMidnight).toISOString();
const provUpdated = new Date(utcMidnight + 3 * 3600_000).toISOString();
const libFinal = { ...scoreEvent('synthetic-lib', 'Sam Houston State Bearkats', 'Liberty Flames', 10, 31),
  commence_time: provStart, last_update: provUpdated };
const libRow = { espnEventId: '401870766', canonicalKey: 'cfb|libertyflames~samhoustonbearkats|' + schedStart.slice(0, 10),
  startsAt: schedStart, completed: false, week: 6, away: { name: 'Sam Houston', abbr: 'SHSU' },
  home: { name: 'Liberty', abbr: 'LIB' }, awayScore: null, homeScore: null };
const indexOf = rows => api.bozoFinalsIndex({ games: api.bozoNormalizeOddsScores('cfb', rows, new Date().toISOString()) }, 'cfb');

test('a final across the UTC date line attaches, keeping the scheduled names and orientation', () => {
  const attached = api.bozoAttachFinal(indexOf([libFinal]), libRow);
  assert.equal(attached.completed, true);
  assert.equal(attached.homeScore, 31); assert.equal(attached.awayScore, 10);
  assert.equal(attached.home.name, 'Liberty'); assert.equal(attached.away.name, 'Sam Houston');
  assert.equal(attached.scoreSource, 'the-odds-api'); assert.equal(attached.scoreObservedAt, provUpdated);
  assert.equal(attached.espnEventId, '401870766');
});

test('a leg keyed only by ESPN id grades from the scheduled row plus the provider final', async () => {
  const r = scoreRig([libFinal]);
  r.store.set('schedule:cfb:2026', { schemaVersion: 1, sport: 'cfb', season: 2026, source: 'cfbfastR', games: [libRow] });
  const pick = { sport: 'cfb', game: 'SHSU @ LIB', eventId: '401870766', canonicalKey: null,
    mkt: 'spread', side: 'LIB', line: 4.5, period: 'game', startsAt: schedStart };
  const out = await api.bozoGradeFromScheduleKv(r.env, { season: 2026, picks: { Kap: pick } });
  assert.equal(out.results.Kap.result, 'won'); assert.equal(out.results.Kap.actual, 21);
  assert.equal(out.results.Kap.gradeSource, 'the-odds-api');
  assert.equal(out.pending.length, 0);
});

test('one unknown provider spelling still attaches; a different registered team never does', () => {
  const usmRow = { startsAt: schedStart, completed: false,
    away: { name: 'Southern Miss', abbr: 'USM' }, home: { name: 'Troy', abbr: 'TROY' } };
  const unknown = { ...scoreEvent('synthetic-usm', 'Hattiesburg Golden Eagles', 'Troy Trojans', 17, 20),
    commence_time: provStart, last_update: provUpdated };
  const attached = api.bozoAttachFinal(indexOf([unknown]), usmRow);
  assert.equal(attached.homeScore, 20); assert.equal(attached.awayScore, 17);
  const wrongTeam = { ...unknown, id: 'synthetic-arst', away_team: 'Arkansas State Red Wolves',
    scores: [{ name: 'Troy Trojans', score: '20' }, { name: 'Arkansas State Red Wolves', score: '17' }] };
  assert.equal(api.bozoAttachFinal(indexOf([wrongTeam]), usmRow), null);
  const bothUnknown = { ...unknown, id: 'synthetic-unk', home_team: 'Trojans of Alabama',
    scores: [{ name: 'Trojans of Alabama', score: '20' }, { name: 'Hattiesburg Golden Eagles', score: '17' }] };
  assert.equal(api.bozoAttachFinal(indexOf([bothUnknown]), usmRow), null);
});

test('a neutral-site final listed the other way round is re-oriented, and a tie is refused', () => {
  const ouRow = { startsAt: schedStart, completed: false,
    away: { name: 'Texas', abbr: 'TEX' }, home: { name: 'Oklahoma', abbr: 'OU' } };
  const flipped = { ...scoreEvent('synthetic-rrs', 'Oklahoma Sooners', 'Texas Longhorns', 24, 30),
    commence_time: schedStart, last_update: provUpdated };
  const attached = api.bozoAttachFinal(indexOf([flipped]), ouRow);
  assert.equal(attached.awayScore, 30); assert.equal(attached.homeScore, 24);   // Texas 30, OU 24
  const early = { ...flipped, id: 'synthetic-a', commence_time: new Date(Date.parse(schedStart) - 3600_000).toISOString() };
  const late = { ...flipped, id: 'synthetic-b', commence_time: new Date(Date.parse(schedStart) + 3600_000).toISOString() };
  assert.equal(api.bozoAttachFinal(indexOf([early, late]), ouRow), null);
  const farAway = { ...flipped, id: 'synthetic-c', commence_time: new Date(Date.parse(schedStart) + 7 * 3600_000).toISOString() };
  assert.equal(api.bozoAttachFinal(indexOf([farAway]), ouRow), null);
});

test('the archive dedupes by provider event id, so a registry change cannot double a game', async () => {
  const r = scoreRig([libFinal]);
  r.store.set('bozo:score-finals:cfb:2026', { games: [{ ...api.bozoNormalizeOddsScores('cfb', [libFinal], new Date().toISOString())[0],
    canonicalKey: 'cfb|libertyflames~samhoustonbearkats|old-key' }], checkedAt: null });
  const out = await api.bozoFallbackScores(r.env, 'cfb', 2026, scoreNow);
  assert.equal(out.games.length, 1); assert.equal(out.games[0].providerEventId, 'synthetic-lib');
  assert.equal(out.calls.n, 1); assert.equal(out.error, null);
});

test('live scores: no due game, no provider call; a due game refreshes every ten minutes, then stops once final', async () => {
  const due = { ...libRow, startsAt: new Date(scoreNow - 3 * 3600_000).toISOString() };
  const future = { ...libRow, espnEventId: 'f', startsAt: new Date(scoreNow + 3600_000).toISOString() };
  const r = scoreRig([]);
  r.store.set('schedule:cfb:2026', { games: [future, { ...due, completed: true, homeScore: 1, awayScore: 0 }] });
  r.store.set('schedule:nfl:2026', { games: [] });
  let out = await api.runBozoLiveScores(r.env, scoreNow, 2026);
  assert.equal(r.calls.length, 0); assert.equal(out.cfb.due, 0);

  r.store.set('schedule:cfb:2026', { games: [future, due] });
  out = await api.runBozoLiveScores(r.env, scoreNow, 2026);
  assert.equal(r.calls.length, 1); assert.equal(out.cfb.due, 1); assert.equal(out.cfb.refreshed, true);
  await api.runBozoLiveScores(r.env, scoreNow + 5 * 60_000, 2026);
  assert.equal(r.calls.length, 1, 'throttled inside the window');
  await api.runBozoLiveScores(r.env, scoreNow + 10 * 60_000, 2026);
  assert.equal(r.calls.length, 2);

  // The final arrives: the game attaches and polling stops.
  const final = { ...scoreEvent('synthetic-due', 'Sam Houston State Bearkats', 'Liberty Flames', 3, 7),
    commence_time: due.startsAt, last_update: new Date(scoreNow - 60_000).toISOString() };
  context.bozoOddsApiRequest = async (_env, path, params) => {
    r.calls.push({ path, params }); return { data: [final], fetchedAt: new Date(scoreNow).toISOString(), quota: { 'x-requests-remaining': 4321 } };
  };
  out = await api.runBozoLiveScores(r.env, scoreNow + 20 * 60_000, 2026);
  assert.equal(r.calls.length, 3); assert.equal(r.store.get('bozo:score-finals:cfb:2026').quotaRemaining, 4321);
  out = await api.runBozoLiveScores(r.env, scoreNow + 40 * 60_000, 2026);
  assert.equal(r.calls.length, 3); assert.equal(out.cfb.due, 0);
});

test('live scores spend credits by what is left, and closes keep a protected floor', async () => {
  // docs/bozo-workplan.md D6: the 500-credit free tier, ~345-390 of it owed to closes.
  const due = { ...libRow, startsAt: new Date(scoreNow - 3 * 3600_000).toISOString() };
  const withQuota = async (remaining, ticksMin) => {
    const r = scoreRig([]);
    r.store.set('schedule:cfb:2026', { games: [due] });
    r.store.set('bozo:score-finals:cfb:2026', { games: [], checkedAt: new Date(scoreNow).toISOString(), quotaRemaining: remaining });
    for (const m of ticksMin) await api.runBozoLiveScores(r.env, scoreNow + m * 60_000, 2026);
    return r.calls.length;
  };
  assert.equal(await withQuota(5000, [10]), 1, 'plenty left: ten-minute cadence');
  assert.equal(await withQuota(1200, [10, 25]), 0, 'thrifty: not before thirty minutes');
  assert.equal(await withQuota(1200, [30]), 1);
  assert.equal(await withQuota(300, [45]), 0, 'under 500: hourly');
  assert.equal(await withQuota(300, [60]), 1);
  assert.equal(await withQuota(100, [60, 12 * 60]), 0, 'below the floor: closes keep the credits');
  assert.equal(await withQuota(100, [24 * 60]), 1, 'one daily probe notices the monthly reset');
  // A refused call records the quota the provider still reports, and backs off to hourly.
  const r = scoreRig([]);
  r.store.set('schedule:cfb:2026', { games: [due] });
  context.bozoOddsApiRequest = async (_env, path, params) => {
    r.calls.push({ path, params });
    throw Object.assign(new Error('Odds API HTTP 401'), { code: 'provider_error', quota: { 'x-requests-remaining': 0 } });
  };
  await api.runBozoLiveScores(r.env, scoreNow, 2026);
  const archive = r.store.get('bozo:score-finals:cfb:2026');
  assert.equal(archive.errorCode, 'provider_error'); assert.equal(archive.quotaRemaining, 0);
  await api.runBozoLiveScores(r.env, scoreNow + 2 * 3600_000, 2026);
  assert.equal(r.calls.length, 1, 'an exhausted account is not hammered');
  assert.equal((await api.bozoFallbackScores(r.env, 'cfb', 2026, scoreNow + 2 * 3600_000)).quotaRemaining, 0,
    'grading shares the same budget throttle');
  assert.equal(r.calls.length, 1);
});

test('live scores: long-overdue games poll hourly, and the daily cap holds', async () => {
  const stale = { ...libRow, startsAt: new Date(scoreNow - 20 * 3600_000).toISOString() };
  const r = scoreRig([]);
  r.store.set('schedule:cfb:2026', { games: [stale] });
  await api.runBozoLiveScores(r.env, scoreNow, 2026);
  await api.runBozoLiveScores(r.env, scoreNow + 15 * 60_000, 2026);
  assert.equal(r.calls.length, 1, 'slow cadence');
  await api.runBozoLiveScores(r.env, scoreNow + 61 * 60_000, 2026);
  assert.equal(r.calls.length, 2);
  const archive = r.store.get('bozo:score-finals:cfb:2026');
  r.store.set('bozo:score-finals:cfb:2026', { ...archive, checkedAt: null, calls: { day: new Date(scoreNow + 3 * 3600_000).toISOString().slice(0, 10), n: 150 } });
  const out = await api.runBozoLiveScores(r.env, scoreNow + 3 * 3600_000, 2026);
  assert.equal(out.cfb.skipped, 'daily_cap'); assert.equal(r.calls.length, 2);
  const gone = await api.runBozoLiveScores(r.env, scoreNow + 80 * 3600_000, 2026);
  assert.equal(gone.cfb.due, 0, 'past the provider horizon nothing is due');
});

/* ---- near-close archive: every NFL/FBS game, DraftKings, both sides, before kickoff ---- */
const dkRow = (odds, extra = {}) => ({ odds: String(odds), lastUpdatedAt: new Date(scoreNow - 600_000).toISOString(), available: true, ...extra });
function sgoEvent(id, away, home, startsAt) {
  return { eventID: id, leagueID: 'NCAAF', status: { startsAt },
    teams: { home: { names: { long: home } }, away: { names: { long: away } } },
    odds: {
      'points-home-game-sp-home': { byBookmaker: { draftkings: dkRow(-110, { spread: '-4.5',
        altLines: [dkRow(-150, { spread: '-2.5' }), dkRow(+120, { spread: '-7.5' }), dkRow(+400, { spread: '-20.5' })] }) } },
      'points-away-game-sp-away': { byBookmaker: { draftkings: dkRow(-110, { spread: '4.5',
        altLines: [dkRow(+125, { spread: '2.5' }), dkRow(-145, { spread: '7.5' }), dkRow(-600, { spread: '20.5' })] }) } },
      'points-all-game-ou-over': { byBookmaker: { draftkings: dkRow(-105, { overUnder: '52.5', altLines: [dkRow(-200, { overUnder: '48.5' })] }) } },
      'points-all-game-ou-under': { byBookmaker: { draftkings: dkRow(-115, { overUnder: '52.5', altLines: [dkRow(+160, { overUnder: '48.5' })] }) } },
      'points-home-game-ml-home': { byBookmaker: { draftkings: dkRow(-200) } },
      'points-away-game-ml-away': { byBookmaker: { draftkings: dkRow(+170) } },
    } };
}

test('near-close keeps both sides of the same number, alternates in a band, and refuses a half', () => {
  const e = sgoEvent('sgo-lib', 'Sam Houston Bearkats', 'Liberty Flames', new Date(scoreNow + 5 * 60_000).toISOString());
  const spread = api.bozoNearCloseMarket(e.odds, 'spread');
  assert.equal(spread.home_line, -4.5); assert.equal(spread.home_price, -110); assert.equal(spread.away_price, -110);
  assert.equal(spread.alternates.map(a => a.home_line).join(','), '-7.5,-2.5', 'within 7 points, sorted; -20.5 dropped');
  assert.equal(spread.alternates[0].away_price, -145);
  const total = api.bozoNearCloseMarket(e.odds, 'total');
  assert.equal(total.line, 52.5); assert.equal(total.over_price, -105); assert.equal(total.under_price, -115);
  assert.equal(total.alternates[0].line, 48.5);
  assert.equal(JSON.stringify(api.bozoNearCloseMarket(e.odds, 'ml')),
    JSON.stringify({ home_price: -200, away_price: 170, updated_at: e.odds['points-home-game-ml-home'].byBookmaker.draftkings.lastUpdatedAt }));
  const oneSided = structuredClone(e); delete oneSided.odds['points-away-game-ml-away'];
  assert.equal(api.bozoNearCloseMarket(oneSided.odds, 'ml'), null);
  const mispaired = structuredClone(e); mispaired.odds['points-away-game-sp-away'].byBookmaker.draftkings.spread = '3.5';
  assert.equal(api.bozoNearCloseMarket(mispaired.odds, 'spread'), null, 'the two sides must be the same number');
  const pulled = structuredClone(e); pulled.odds['points-all-game-ou-under'].byBookmaker.draftkings.available = false;
  assert.equal(api.bozoNearCloseMarket(pulled.odds, 'total'), null);
  assert.equal(api.bozoNearCloseRecord(e, 'cfb', scoreNow + 5 * 60_000), null, 'never written at or after kickoff');
});

test('near-close runs only near a kickoff, keeps the latest pre-kick capture, and reads back oriented', async () => {
  const kick = scoreNow + 6 * 60_000;
  const store = new Map(), calls = [];
  const env = { SGO_KEY: 'test-only', RL: { async get(k) { return store.get(k) || null; }, async put(k, v) { store.set(k, JSON.parse(v)); } } };
  const ev = sgoEvent('sgo-lib', 'Sam Houston Bearkats', 'Liberty Flames', new Date(kick).toISOString());
  context.bozoSgoRequest = async (_env, url) => { calls.push(String(url)); return [ev]; };
  store.set('schedule:nfl:2026', { games: [] });
  store.set('schedule:cfb:2026', { games: [{ ...libRow, startsAt: new Date(scoreNow + 3 * 3600_000).toISOString() }] });
  let out = await api.runBozoNearCloses(env, scoreNow, 2026);
  assert.equal(calls.length, 0, 'no kickoff inside the gate: no request'); assert.equal(out.cfb.skipped, 'no_kickoff_in_gate');

  const game = { ...libRow, startsAt: new Date(kick).toISOString() };
  store.set('schedule:cfb:2026', { games: [game] });
  out = await api.runBozoNearCloses(env, scoreNow, 2026);
  assert.equal(calls.length, 1); assert.equal(out.cfb.stored, 1);
  assert.match(calls[0], /leagueID=NCAAF/); assert.match(calls[0], /includeAltLines=true/);
  const key = 'bozo:nearclose:cfb:' +
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(kick));
  assert.equal(store.get(key).events['sgo-lib'].label, 'near-close');

  ev.odds['points-home-game-ml-home'].byBookmaker.draftkings.odds = '-240';
  await api.runBozoNearCloses(env, scoreNow + 3 * 60_000, 2026);
  assert.equal(store.get(key).events['sgo-lib'].markets.moneyline.home_price, -240, 'the later pre-kick capture wins');
  assert.equal(store.get(key).events['sgo-lib'].captures, 2);
  ev.odds['points-home-game-ml-home'].byBookmaker.draftkings.odds = '-900';
  await api.runBozoNearCloses(env, kick + 60_000, 2026);
  assert.equal(store.get(key).events['sgo-lib'].markets.moneyline.home_price, -240, 'an in-play quote is never a close');

  // A refusal for one sport is recorded by code and does not throw away the other's run.
  store.set('schedule:nfl:2026', { games: [{ ...game, espnEventId: 'nfl-x' }] });
  context.bozoSgoRequest = async (_env, url) => {
    if (/leagueID=NFL/.test(String(url))) throw Object.assign(new Error('secret detail'), { code: 'quota_exceeded' });
    calls.push(String(url)); return [];
  };
  const split = await api.runBozoNearCloses(env, scoreNow + 4 * 60_000, 2026);
  assert.equal(split.nfl.error, 'quota_exceeded'); assert.equal(split.cfb.events, 0);
  assert.ok(!JSON.stringify(store.get('bozo:nearclose:last-run')).includes('secret detail'));

  const index = await api.bozoNearCloseIndexFor(env, 'cfb', [game]);
  const close = api.bozoNearCloseForGame(index, game);
  assert.equal(close.label, 'near-close'); assert.equal(close.moneyline.home_price, -240);
  assert.equal(close.spread.home_line, -4.5);
  // The same game listed the other way round by the provider reads back in the schedule's orientation.
  const swapped = { ...game, home: game.away, away: game.home };
  const flip = api.bozoNearCloseForGame(index, swapped);
  assert.equal(flip.spread.home_line, 4.5); assert.equal(flip.moneyline.home_price, 170);
  assert.equal(flip.spread.alternates.map(a => a.home_line).join(','), '2.5,7.5');
  assert.equal(flip.total.line, 52.5);
});

test('score diagnostics survive throttled reads, preserve finals, and clear on real recovery', async()=>{
 const r=scoreRig([clemsonFinal]);
 const first=await api.bozoFallbackScores(r.env,'cfb',2026,scoreNow);
 const fetchedAt=first.fetchedAt, games=JSON.stringify(first.games);
 context.bozoOddsApiRequest=async()=>{throw Object.assign(Error('private apiKey fixture'),{
  code:'provider_error',failureKind:'http_error',httpStatus:401,quota:{'x-requests-remaining':0},body:'private provider body'});};
 const failed=await api.bozoFallbackScores(r.env,'cfb',2026,scoreNow+86400_000);
 assert.deepEqual(JSON.parse(JSON.stringify(failed.diagnostic)),{kind:'http_error',httpStatus:401});
 assert.equal(failed.fetchedAt,fetchedAt);assert.equal(JSON.stringify(failed.games),games);
 assert.equal(failed.quotaRemaining,0);assert.ok(!JSON.stringify(failed).includes('private'));
 const cached=await api.bozoFallbackScores(r.env,'cfb',2026,scoreNow+86400_000+300_000);
 assert.equal(cached.diagnostic.httpStatus,401);
 context.bozoOddsApiRequest=async()=>({data:[],fetchedAt:new Date(scoreNow+2*86400_000).toISOString(),quota:{'x-requests-remaining':2000}});
 const recovered=await api.bozoFallbackScores(r.env,'cfb',2026,scoreNow+2*86400_000);
 assert.equal(recovered.diagnostic,null);assert.equal(recovered.error,null);assert.equal(recovered.errorCode,null);
 assert.equal(JSON.stringify(recovered.games),games);
});
test('score schema errors retain safe diagnostics and successful-response quota without inventing finals', async()=>{
 const r=scoreRig([]);
 context.bozoOddsApiRequest=async()=>({data:{error:'secret provider body'},httpStatus:200,fetchedAt:new Date(scoreNow).toISOString(),quota:{'x-requests-remaining':125}});
 const out=await api.bozoFallbackScores(r.env,'cfb',2026,scoreNow);
 assert.equal(out.errorCode,'provider_error');assert.equal(out.diagnostic.kind,'invalid_response');
 assert.equal(out.diagnostic.httpStatus,200);assert.equal(out.quotaRemaining,125);
 assert.equal(out.games.length,0);assert.equal(out.fetchedAt,null);assert.ok(!JSON.stringify(out).includes('secret'));
});
test('public score diagnostics are allowlisted, omit quotas and do not guess legacy causes', async()=>{
 context.SEASON=2026;context.json=(body,status,headers)=>Response.json(body,{status,headers});
 vm.runInContext(sliceBetween('async function handleScores(', '/* ================================== /tts')+'this.publicScores=handleScores;',context);
 const r=scoreRig([]);
 r.store.set('schedule:cfb:2026',{source:'fixture',fetchedAt:new Date(scoreNow).toISOString(),games:[]});
 for(const diagnostic of [undefined,{kind:'http_error',httpStatus:503,secret:'not-public'},
   {kind:'private provider URL',httpStatus:401},{kind:'network_error',httpStatus:'private status'}]) {
  r.store.set('bozo:score-finals:cfb:2026',{games:[],errorCode:'provider_error',quotaRemaining:4321,diagnostic});
  const out=await (await context.publicScores(new URL('https://fixture.invalid/scores?sport=cfb'),r.env,{})).json();
  const serialized=JSON.stringify(out.feeds);
  assert.ok(!serialized.includes('4321'));assert.ok(!serialized.includes('private'));assert.ok(!serialized.includes('secret'));
  if(diagnostic?.kind==='http_error')assert.deepEqual(out.feeds.finals.diagnostic,{kind:'http_error',httpStatus:503});
  else if(diagnostic?.kind==='network_error')assert.deepEqual(out.feeds.finals.diagnostic,{kind:'network_error',httpStatus:null});
  else assert.equal(out.feeds.finals.diagnostic,null);
 }
});

test('direct grading fallback obeys the same daily score cap and resumes on the next UTC day', async()=>{
 const r=scoreRig([clemsonFinal]);
 const key='bozo:score-finals:cfb:2026', day=new Date(scoreNow).toISOString().slice(0,10);
 const previous={games:[],checkedAt:null,fetchedAt:null,calls:{day,n:150},error:'score_fallback_unavailable',errorCode:'provider_error',
  diagnostic:{kind:'http_error',httpStatus:503}};
 r.store.set(key,previous);
 const skipped=await api.bozoFallbackScores(r.env,'cfb',2026,scoreNow);
 assert.equal(r.calls.length,0);assert.equal(skipped.calls.n,150);assert.equal(skipped.checkedAt,null);
 assert.equal(skipped.errorCode,'provider_error');assert.equal(skipped.diagnostic.httpStatus,503);
 assert.equal(r.store.get(key),previous,'a capped read writes no false success or new attempt');
 const nextDay=await api.bozoFallbackScores(r.env,'cfb',2026,scoreNow+86400_000);
 assert.equal(r.calls.length,1);assert.equal(nextDay.calls.n,1);assert.equal(nextDay.errorCode,null);
});

test('an exhausted daily score cap still grades verified archived finals and leaves new finals pending', async()=>{
 const r=scoreRig([]), day=new Date(scoreNow).toISOString().slice(0,10);
 const finals=api.bozoNormalizeOddsScores('cfb',[clemsonFinal],new Date(scoreNow).toISOString());
 r.store.set('bozo:score-finals:cfb:2026',{games:finals,checkedAt:null,calls:{day,n:150},fetchedAt:new Date(scoreNow).toISOString()});
 const out=await api.bozoGradeFromScheduleKv(r.env,{season:2026,picks:{
  A:finalPick('CLEM @ CAL','ml','CLEM'),B:finalPick('NU @ IU','total','over',45.5)}});
 assert.equal(out.results.A.result,'won');assert.equal(out.results.A.gradeSource,'the-odds-api');
 assert.equal(out.results.B,undefined);assert.equal(out.pending.length,1);assert.equal(out.pending[0].key,'B');
 assert.equal(r.calls.length,0);assert.equal(r.store.get('bozo:score-finals:cfb:2026').games.length,1);
});

test('malformed score arrays preserve response metadata and do not invent a missing HTTP status', async()=>{
 for(const httpStatus of [undefined,201]) {
  const r=scoreRig([]);
  context.bozoOddsApiRequest=async()=>({data:[null],httpStatus,quota:{'x-requests-remaining':0},fetchedAt:new Date(scoreNow).toISOString()});
  const out=await api.bozoFallbackScores(r.env,'cfb',2026,scoreNow);
  assert.equal(out.diagnostic.kind,'invalid_response');assert.equal(out.diagnostic.httpStatus,httpStatus??null);
  assert.equal(out.quotaRemaining,0);assert.equal(out.games.length,0);assert.equal(out.fetchedAt,null);
 }
});
