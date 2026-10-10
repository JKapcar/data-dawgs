/* ESPN live finals (work/bozo-espn-scores.js): mapping to canonicalKey and to the scheduled
   game, final versus in-progress, precedence of the official schedule finals, the optional
   Odds API (missing key / 401 tolerated), request budget, and the bozo:scores health rule.
   Runs the assembled Worker's Bozo region in a sandbox with fetch and KV faked.
   Fixture: tests/fixtures/espn-scoreboard-2026-10.json, real ESPN scoreboards captured
   2026-10-10 and trimmed to the fields the Worker reads. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'dawg-bot-worker.js'), 'utf8');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'espn-scoreboard-2026-10.json'), 'utf8'));
const seedSource = fs.readFileSync(path.join(root, 'bozo-team-registry.mjs'), 'utf8');
const seed = JSON.parse(seedSource.slice(seedSource.indexOf('{'), seedSource.lastIndexOf('};') + 1));

const sliceBetween = (a, b) => { const x = worker.indexOf(a); const y = worker.indexOf(b, x); assert.ok(x >= 0 && y > x, a); return worker.slice(x, y); };
const logs = [];
const context = vm.createContext({
  Intl, Date, Number, String, Object, Array, Set, Map, Promise, JSON, Math, Response, URL,
  crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array, Request, setTimeout, clearTimeout, AbortController,
  console: { log: (tag, detail) => logs.push([tag, detail]) },
  BOZO_ESPN_TEAM_SEED: seed, SEASON: 2026,
  bzNorm: s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
  playerName: s => decodeURIComponent(s),
});
context.json = (body, status, headers) => Response.json(body, { status, headers });
// The Odds API path name table lives outside the sliced region.
vm.runInContext('const BOZO_ODDS_API_SPORT = {nfl:"americanfootball_nfl", cfb:"americanfootball_ncaaf"};', context);
vm.runInContext(sliceBetween('const ROYALE_SD = {', 'function rExpected(')
  + '\n' + sliceBetween('function royaleBeatDeficit(', '/* Score every losing leg on one lever.')
  + '\n' + sliceBetween('const BOZO_GRADEABLE_SPORTS', '\nconst ledgerKey')
  + '\n' + sliceBetween('const BOZO_TEAM_FALLBACK_ALIASES', '\n// The two sides of each game-level market.')
  + '\n' + sliceBetween('function bozoScheduledTeamSide', '\nasync function requireAdmin')
  + '\n' + sliceBetween('async function handleScores(', '/* ================================== /tts')
  + `\nthis.api={bozoNormalizeEspnScoreboard,bozoEspnRefresh,bozoLiveFinalsIndex,bozoAttachLiveFinal,
     runBozoLiveScores,bozoGradeFromScheduleKv,bozoCanonicalScheduleKey,opsOutcome,opsRecord,
     bozoNormalizeOddsScores,handleScores,bozoEspnIsFinal};`, context);
const api = context.api;

assert.ok(worker.includes('DD-BOZO-ESPN-SCORES START'), 'the block is assembled into the Worker');

const T = iso => Date.parse(iso);
const clone = x => JSON.parse(JSON.stringify(x));
const nflBoard = fx.nfl_20261008, cfbBoard = fx.cfb_20261009;
const tbDal = { espnEventId: '401872980', canonicalKey: null, startsAt: '2026-10-09T00:15:00.000Z',
  localDate: '2026-10-08', week: 5, seasonType: 'REG', completed: false,
  away: { name: 'TB', abbr: 'TB' }, home: { name: 'DAL', abbr: 'DAL' }, awayScore: null, homeScore: null };
const cfbRow = (id, away, home, startsAt, extra = {}) => ({ espnEventId: id, startsAt, completed: false, week: 7,
  away: { name: away[0], abbr: away[1], id: away[2] }, home: { name: home[0], abbr: home[1], id: home[2] },
  awayScore: null, homeScore: null, ...extra });
const isuByu = cfbRow('401856826', ['Iowa State', 'ISU', '66'], ['BYU', 'BYU', '252'], '2026-10-10T02:30:00.000Z');
const fsuLou = cfbRow('401858254', ['Florida State', 'FSU', '52'], ['Louisville', 'LOU', '97'], '2026-10-09T23:00:00.000Z');

// A KV + fetch rig. `routes` maps a URL predicate to a response factory.
function rig({ schedule = {}, routes = [], key = undefined } = {}) {
  const store = new Map(), urls = [];
  const env = { RL: {
    async get(k, type) { const v = store.get(k); return v === undefined ? null : (type === 'json' ? clone(v) : JSON.stringify(v)); },
    async put(k, v) { store.set(k, JSON.parse(v)); },
  } };
  if (key !== undefined) env.ODDS_API_KEY = key;
  for (const [sport, games] of Object.entries(schedule)) store.set(`schedule:${sport}:2026`, { source: `fixture-${sport}`, games });
  const fetcher = async url => {
    url = String(url); urls.push(url);
    for (const [match, respond] of routes) if (match(url)) return respond(url);
    return new Response('not found', { status: 404 });
  };
  return { env, store, urls, fetcher };
}
const jsonRes = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const status = code => () => new Response('no', { status: code });
const scoreboard = (board, date) => [u => /scoreboard/.test(u) && u.includes(`dates=${date}`), () => jsonRes(board)];
const oddsCalls = [];
context.bozoOddsApiRequest = async (_env, p) => { oddsCalls.push(p); throw Object.assign(new Error('Odds API HTTP 401'),
  { code: 'provider_error', failureKind: 'http_error', httpStatus: 401 }); };

/* ---------------------------------- mapping ---------------------------------- */
test('mapping: an ESPN NFL final maps to the schedule canonicalKey and carries source espn', () => {
  const out = api.bozoNormalizeEspnScoreboard('nfl', nflBoard, '2026-10-09T04:00:00.000Z');
  assert.equal(out.games.length, 1);
  const row = out.games[0];
  assert.equal(row.canonicalKey, api.bozoCanonicalScheduleKey('nfl', 'TB', 'DAL', tbDal.startsAt));
  assert.equal(row.canonicalKey, 'nfl|dallascowboys~tampabaybuccaneers|2026-10-09', 'registry names, kickoff UTC date');
  assert.equal(row.source, 'espn'); assert.equal(row.scoreSource, 'espn'); assert.equal(row.espnEventId, '401872980');
  assert.equal(row.homeScore, 16); assert.equal(row.awayScore, 24);
  assert.equal(row.home.abbr, 'DAL'); assert.equal(row.away.abbr, 'TB');
});

test('mapping: CFB display names reach the same key as cfbfastR names', () => {
  const out = api.bozoNormalizeEspnScoreboard('cfb', cfbBoard, '2026-10-10T12:00:00.000Z');
  assert.equal(out.games.length, 5);
  const row = out.games.find(g => g.espnEventId === '401856826');
  assert.equal(row.canonicalKey, api.bozoCanonicalScheduleKey('cfb', 'Iowa State', 'BYU', '2026-10-10T02:30:00Z'));
  const attached = api.bozoAttachLiveFinal(api.bozoLiveFinalsIndex({ games: out.games }, null, 'cfb'), isuByu);
  assert.equal(attached.homeScore, 24); assert.equal(attached.awayScore, 10);
  assert.equal(attached.home.name, 'BYU', 'the scheduled names and orientation are kept');
  assert.equal(attached.source, 'espn');
});

test('mapping: a Monday-night final keeps its UTC date and attaches by id or by teams', () => {
  const board = clone(fx.nfl_week6);
  const ev = board.events.find(e => e.id === '401872994');               // BUF @ LAR, 2026-10-13T00:15Z
  const final = { id: '3', name: 'STATUS_FINAL', state: 'post', completed: true, description: 'Final', detail: 'Final' };
  ev.status.type = final; ev.competitions[0].status.type = final;
  for (const c of ev.competitions[0].competitors) c.score = c.homeAway === 'home' ? '27' : '20';
  const out = api.bozoNormalizeEspnScoreboard('nfl', { events: [ev] }, '2026-10-13T03:30:00.000Z');
  const row = out.games[0];
  assert.equal(row.canonicalKey, 'nfl|buffalobills~losangelesrams|2026-10-13', 'UTC date, not the Eastern Monday');

  assert.equal(row.localDate, '2026-10-12');
  const scheduled = { espnEventId: '401872994', startsAt: '2026-10-13T00:15:00.000Z', completed: false,
    away: { name: 'BUF', abbr: 'BUF' }, home: { name: 'LA', abbr: 'LA' } };
  const index = api.bozoLiveFinalsIndex({ games: out.games }, null, 'nfl');
  const byId = api.bozoAttachLiveFinal(index, scheduled);
  assert.equal(byId.homeScore, 27); assert.equal(byId.awayScore, 20);
  const byTeams = api.bozoAttachLiveFinal(index, { ...scheduled, espnEventId: undefined, home: { name: 'LAR', abbr: 'LAR' } });
  assert.equal(byTeams.homeScore, 27); assert.equal(byTeams.source, 'espn');
});

test('mapping: a row placed by event id adopts the schedule canonicalKey (nflverse "LA" Rams)', async () => {
  const board = clone(fx.nfl_week6);
  const ev = board.events.find(e => e.id === '401872994');
  const final = { name: 'STATUS_FINAL', state: 'post', completed: true };
  ev.status.type = final; ev.competitions[0].status.type = final;
  for (const c of ev.competitions[0].competitors) c.score = c.homeAway === 'home' ? '27' : '20';
  const startsAt = '2026-10-13T00:15:00.000Z';
  const scheduled = { espnEventId: '401872994', startsAt, completed: false,
    canonicalKey: api.bozoCanonicalScheduleKey('nfl', 'BUF', 'LA', startsAt),
    away: { name: 'BUF', abbr: 'BUF' }, home: { name: 'LA', abbr: 'LA' } };
  const r = rig({ schedule: { nfl: [scheduled], cfb: [] }, routes: [scoreboard({ events: [ev] }, '20261012')] });
  const out = await api.runBozoLiveScores(r.env, T('2026-10-13T03:30:00Z'), 2026, r.fetcher);
  assert.equal(out.nfl.health, 'ok');
  const row = r.store.get('bozo:score-espn:nfl:2026').games[0];
  assert.equal(row.canonicalKey, scheduled.canonicalKey); assert.match(row.canonicalKey, /\|2026-10-13$/);
  assert.match(r.urls[0], /dates=20261012/, 'ESPN is asked for the Eastern Monday');
});

/* ----------------------------- final vs in-progress ----------------------------- */
test('only completed + post is final; in-progress, halftime, postponed and blank scores never are', () => {
  const base = clone(nflBoard.events[0]);
  const variants = [
    { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false },
    { name: 'STATUS_HALFTIME', state: 'in', completed: false },
    { name: 'STATUS_END_PERIOD', state: 'in', completed: false },
    { name: 'STATUS_FINAL', state: 'in', completed: true },
    { name: 'STATUS_POSTPONED', state: 'post', completed: true },
    { name: 'STATUS_CANCELED', state: 'post', completed: true },
    { name: 'STATUS_SCHEDULED', state: 'pre', completed: false },
  ];
  for (const type of variants) {
    const ev = clone(base); ev.status.type = type; ev.competitions[0].status.type = type;
    const out = api.bozoNormalizeEspnScoreboard('nfl', { events: [ev] }, '2026-10-09T04:00:00.000Z');
    assert.equal(out.games.length, 0, type.name);
  }
  const live = clone(base); live.competitions[0].status.type = { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false };
  assert.equal(api.bozoNormalizeEspnScoreboard('nfl', { events: [live] }, '2026-10-09T04:00:00.000Z').inProgress, 1);
  const blank = clone(base); blank.competitions[0].competitors[0].score = '';
  assert.equal(api.bozoNormalizeEspnScoreboard('nfl', { events: [blank] }, '2026-10-09T04:00:00.000Z').games.length, 0);
  const early = api.bozoNormalizeEspnScoreboard('nfl', nflBoard, '2026-10-08T23:00:00.000Z');
  assert.equal(early.games.length, 0, 'a final observed before kickoff is refused');
});

test('an in-progress ESPN score leaves the leg pending and the game still due', async () => {
  const live = clone(nflBoard);
  live.events[0].competitions[0].status.type = { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false };
  const r = rig({ schedule: { nfl: [tbDal], cfb: [] }, routes: [scoreboard(live, '20261008')] });
  const now = T('2026-10-09T03:00:00Z');
  const out = await api.runBozoLiveScores(r.env, now, 2026, r.fetcher);
  assert.equal(out.nfl.due, 1); assert.equal(out.nfl.health, 'ok'); assert.equal(out.nfl.espn.inProgress, 1);
  assert.equal(r.store.get('bozo:score-espn:nfl:2026').games.length, 0);
  const again = await api.runBozoLiveScores(r.env, now + 5 * 60_000, 2026, r.fetcher);
  assert.equal(again.nfl.due, 1, 'still due: nothing attached');
});

/* --------------------------------- live job ---------------------------------- */
test('a due game refreshes from ESPN, attaches, stops polling, and never calls the Odds API', async () => {
  oddsCalls.length = 0;
  const r = rig({ schedule: { nfl: [tbDal], cfb: [] }, routes: [scoreboard(nflBoard, '20261008')], key: 'test-only' });
  const now = T('2026-10-09T03:00:00Z');
  const out = await api.runBozoLiveScores(r.env, now, 2026, r.fetcher);
  assert.equal(out.nfl.health, 'ok'); assert.equal(out.nfl.source, 'espn'); assert.equal(out.nfl.espn.via, 'site');
  assert.equal(out.nfl.odds.skipped, 'espn_ok'); assert.equal(oddsCalls.length, 0);
  assert.equal(r.urls.length, 1); assert.match(r.urls[0], /site\.api\.espn\.com\/apis\/site\/v2\/sports\/football\/nfl\/scoreboard\?dates=20261008/);
  const archive = r.store.get('bozo:score-espn:nfl:2026');
  assert.equal(archive.games[0].source, 'espn'); assert.equal(archive.error, null);
  const after = await api.runBozoLiveScores(r.env, now + 5 * 60_000, 2026, r.fetcher);
  assert.equal(after.nfl.due, 0); assert.equal(r.urls.length, 1);
  assert.equal(api.opsOutcome('bozo:scores', out), 'ok');
  assert.equal(api.opsOutcome('bozo:scores', after), 'noop');
});

test('CFB asks ESPN for FBS on each due Eastern date, at most two dates a tick', async () => {
  const thu = cfbRow('401850001', ['USF', 'USF', '58'], ['UTSA', 'UTSA', '2636'], '2026-10-08T23:30:00.000Z');
  const r = rig({ schedule: { nfl: [], cfb: [thu, fsuLou, isuByu] },
    routes: [scoreboard(cfbBoard, '20261009'), scoreboard({ events: [] }, '20261008')] });
  const out = await api.runBozoLiveScores(r.env, T('2026-10-10T12:00:00Z'), 2026, r.fetcher);
  assert.equal(r.urls.length, 2); assert.ok(r.urls.every(u => /college-football\/scoreboard\?dates=\d{8}&limit=300&groups=80$/.test(u)));
  assert.equal(out.cfb.health, 'ok'); assert.equal(out.cfb.espn.finals, 5);
  const again = await api.runBozoLiveScores(r.env, T('2026-10-10T12:05:00Z'), 2026, r.fetcher);
  assert.equal(again.cfb.due, 1, 'only the Thursday game is still due');
});

/* --------------------------------- precedence --------------------------------- */
test('precedence: an official cfbfastR final wins over ESPN, and the disagreement is logged and kept', async () => {
  logs.length = 0;
  const official = { ...fsuLou, completed: true, homeScore: 45, awayScore: 20 };   // ESPN says 44-20
  const r = rig({ schedule: { nfl: [], cfb: [official, isuByu] }, routes: [scoreboard(cfbBoard, '20261009')] });
  await api.runBozoLiveScores(r.env, T('2026-10-10T12:00:00Z'), 2026, r.fetcher);
  const logged = logs.filter(([tag]) => tag === 'bozo-final-disagreement').map(([, d]) => JSON.parse(d));
  assert.equal(logged.length, 1); assert.equal(logged[0].espnEventId, '401858254'); assert.equal(logged[0].winner, 'official');
  assert.deepEqual(logged[0].official, { home: 45, away: 20 }); assert.deepEqual(logged[0].espn, { home: 44, away: 20 });
  assert.equal(r.store.get('bozo:score-espn:cfb:2026').disagreements.length, 1);
  // /scores serves the official final, untouched by the ESPN row.
  const res = await api.handleScores(new URL('https://fixture.invalid/scores?sport=cfb&dates=20261009'), r.env, {});
  const body = await res.json();
  const game = body.games.find(g => g.id === '401858254');
  assert.equal(game.scoreSource, 'fixture-cfb', 'the official row is served, not the ESPN overlay');
  assert.deepEqual(game.teams.map(t => t.score).sort(), [20, 45]);
  assert.equal(body.feeds.live.source, 'espn'); assert.equal(body.feeds.live.disagreements, 1);
  assert.equal(body.feeds.live.via, 'site'); assert.equal(body.feeds.live.error, null);
});

test('precedence in grading: ESPN grades while the schedule is open; the official final replaces it', async () => {
  logs.length = 0;
  const espnRows = api.bozoNormalizeEspnScoreboard('nfl', nflBoard, '2026-10-09T04:00:00.000Z').games;
  const pick = { sport: 'nfl', game: 'TB @ DAL', mkt: 'spread', side: 'DAL', line: -7.5, period: 'game',
    espnEventId: '401872980', canonicalKey: tbDal.canonicalKey, startsAt: tbDal.startsAt };
  const r = rig({ schedule: { nfl: [tbDal] } });
  r.store.set('bozo:score-espn:nfl:2026', { games: espnRows, fetchedAt: '2026-10-09T04:00:00.000Z' });
  const live = await api.bozoGradeFromScheduleKv(r.env, { season: 2026, picks: { Kap: pick } });
  assert.equal(live.results.Kap.gradeSource, 'espn'); assert.equal(live.results.Kap.actual, -8);   // DAL +7.5, lost by 8
  assert.equal(live.results.Kap.result, 'lost'); assert.equal(live.pending.length, 0);
  // nflverse publishes a different final: the official one wins and the disagreement is logged.
  r.store.set('schedule:nfl:2026', { source: 'fixture-nfl', games: [{ ...tbDal, completed: true, homeScore: 17, awayScore: 24 }] });
  const official = await api.bozoGradeFromScheduleKv(r.env, { season: 2026, picks: { Kap: pick }, results: live.results });
  assert.equal(official.results.Kap.gradeSource, 'fixture-nfl'); assert.equal(official.results.Kap.result, 'won');
  assert.ok(logs.some(([tag]) => tag === 'bozo-final-disagreement'));
});

/* ------------------------------ Odds API optional ------------------------------ */
test('Odds API 401 is tolerated: no failure while the schedule feeds are healthy, probed once a day', async () => {
  oddsCalls.length = 0;
  const blocked = [[u => /espn\.com/.test(u), status(403)]];
  const r = rig({ schedule: { nfl: [tbDal], cfb: [] }, routes: blocked, key: 'revoked' });
  const now = T('2026-10-09T03:00:00Z');
  const out = await api.runBozoLiveScores(r.env, now, 2026, r.fetcher);
  assert.equal(out.nfl.espn.error, 'espn_blocked'); assert.equal(out.nfl.odds.skipped, 'unauthorized', JSON.stringify(out.nfl) + JSON.stringify(r.store.get('bozo:score-finals:nfl:2026')));
  assert.equal(out.nfl.health, 'ok'); assert.equal(out.nfl.degraded, 'live_scores_unavailable');
  assert.equal(api.opsOutcome('bozo:scores', out), 'ok'); assert.equal(oddsCalls.length, 1);
  await api.runBozoLiveScores(r.env, now + 2 * 3600_000, 2026, r.fetcher);
  assert.equal(oddsCalls.length, 1, 'a 401 is not re-asked within the day');
  await api.runBozoLiveScores(r.env, now + 24 * 3600_000 + 60_000, 2026, r.fetcher);
  assert.equal(oddsCalls.length, 2, 'one daily probe notices a fixed key');
});

test('no ODDS_API_KEY: skipped quietly; ESPN success needs no key at all', async () => {
  oddsCalls.length = 0;
  const r = rig({ schedule: { nfl: [tbDal], cfb: [] }, routes: [[u => /espn\.com/.test(u), status(500)]] });
  const out = await api.runBozoLiveScores(r.env, T('2026-10-09T03:00:00Z'), 2026, r.fetcher);
  assert.equal(out.nfl.odds.skipped, 'no_key'); assert.equal(oddsCalls.length, 0); assert.equal(out.nfl.health, 'ok');
  const ok = rig({ schedule: { nfl: [tbDal], cfb: [] }, routes: [scoreboard(nflBoard, '20261008')] });
  const good = await api.runBozoLiveScores(ok.env, T('2026-10-09T03:00:00Z'), 2026, ok.fetcher);
  assert.equal(good.nfl.source, 'espn'); assert.equal(good.nfl.health, 'ok');
});

/* ------------------------------------ health ------------------------------------ */
test('health: fail only when ESPN, the Odds API and the schedule feed all fail; ESPN success clears it', async () => {
  const r = rig({ schedule: { nfl: [tbDal], cfb: [] }, routes: [[u => /espn\.com/.test(u), status(503)]], key: 'revoked' });
  r.store.set('ops:health:bozo:schedule', { failing: true, since: '2026-10-09T01:00:00.000Z', last_ok_at: null });
  const now = T('2026-10-09T03:00:00Z');
  const out = await api.runBozoLiveScores(r.env, now, 2026, r.fetcher);
  assert.equal(out.nfl.health, 'fail'); assert.equal(api.opsOutcome('bozo:scores', out), 'fail');
  // The latched failure (as /ops/health showed on Oct 10) clears on the first ESPN success.
  r.store.set('ops:health:bozo:scores', { failing: true, since: '2026-10-10T06:30:10.000Z', last_ok_at: null });
  const healthy = rig({ schedule: { nfl: [tbDal], cfb: [] }, routes: [scoreboard(nflBoard, '20261008')] });
  healthy.store.set('ops:health:bozo:scores', { failing: true, since: '2026-10-10T06:30:10.000Z', last_ok_at: null });
  const good = await api.runBozoLiveScores(healthy.env, now, 2026, healthy.fetcher);
  const outcome = api.opsOutcome('bozo:scores', good);
  assert.equal(outcome, 'ok');
  const flipped = await api.opsRecord(healthy.env, 'bozo:scores', outcome, now);
  assert.equal(flipped.failing, false); assert.equal(healthy.store.get('ops:health:bozo:scores').failing, false);
  // Throttled ESPN pass inside the window: no new attempt, so no flip either way.
  const failing = rig({ schedule: { nfl: [tbDal], cfb: [] }, routes: [[u => /espn\.com/.test(u), status(503)]] });
  await api.runBozoLiveScores(failing.env, now, 2026, failing.fetcher);
  const throttled = await api.runBozoLiveScores(failing.env, now + 5 * 60_000, 2026, failing.fetcher);
  assert.equal(throttled.nfl.health, 'noop', 'a failed pass backs off fifteen minutes');
  // Pre-ESPN result shapes keep their old meaning.
  assert.equal(api.opsOutcome('bozo:scores', { nfl: { due: 1, refreshed: true, error: 'provider_error' }, cfb: { due: 0 } }), 'fail');
});

/* -------------------------------- egress + budget -------------------------------- */
test('a 403 host is skipped for six hours; the core records grade within a per-tick budget', async () => {
  const id = '401872980', core = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${id}/competitions/${id}`;
  const routes = [
    [u => /site(\.web)?\.api\.espn\.com/.test(u), status(403)],
    [u => u === core + '/status', () => jsonRes({ type: { name: 'STATUS_FINAL', state: 'post', completed: true } })],
    [u => u === core, () => jsonRes({ date: '2026-10-09T00:15Z', competitors: [{ id: '6', homeAway: 'home' }, { id: '27', homeAway: 'away' }] })],
    [u => u === core + '/competitors/6/score', () => jsonRes({ value: 16.0 })],
    [u => u === core + '/competitors/27/score', () => jsonRes({ value: 24.0 })],
  ];
  const r = rig({ schedule: { nfl: [tbDal], cfb: [] }, routes });
  const now = T('2026-10-09T03:00:00Z');
  const out = await api.runBozoLiveScores(r.env, now, 2026, r.fetcher);
  assert.equal(out.nfl.health, 'ok'); assert.equal(out.nfl.espn.via, 'core');
  assert.equal(r.urls.length, 6, 'two blocked scoreboard hosts, then four core reads');
  const row = r.store.get('bozo:score-espn:nfl:2026').games[0];
  assert.equal(row.homeScore, 16); assert.equal(row.awayScore, 24); assert.equal(row.home.name, 'DAL'); assert.equal(row.via, 'core');
  assert.ok(r.store.get('bozo:score-espn:nfl:2026').hosts.site.blockedUntil);
  // A second due game: the blocked hosts are not asked again, and the core budget holds.
  const second = { ...tbDal, espnEventId: '401872981', canonicalKey: 'nfl|x~y|2026-10-09',
    away: { name: 'NYG', abbr: 'NYG' }, home: { name: 'PHI', abbr: 'PHI' } };
  r.store.set('schedule:nfl:2026', { source: 'fixture-nfl', games: [tbDal, second] });
  const before = r.urls.length;
  await api.runBozoLiveScores(r.env, now + 20 * 60_000, 2026, r.fetcher);
  const asked = r.urls.slice(before);
  assert.ok(asked.every(u => u.startsWith('https://sports.core.api.espn.com/')), asked.join('\n'));
  assert.ok(asked.length <= 4);
});

test('the daily ESPN ceiling holds and records no false attempt', async () => {
  const r = rig({ schedule: { nfl: [tbDal], cfb: [] }, routes: [scoreboard(nflBoard, '20261008')] });
  const now = T('2026-10-09T03:00:00Z');
  r.store.set('bozo:score-espn:nfl:2026', { games: [], calls: { day: '2026-10-09', n: 600 }, checkedAt: null });
  const out = await api.runBozoLiveScores(r.env, now, 2026, r.fetcher);
  assert.equal(r.urls.length, 0); assert.equal(out.nfl.espn.skipped, 'daily_cap'); assert.notEqual(out.nfl.health, 'fail');
});
