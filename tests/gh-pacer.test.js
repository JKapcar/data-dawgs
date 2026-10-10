// The Worker's GitHub pacer: on-time workflow_dispatch for the jobs GitHub's own scheduler
// runs four to seven hours late. Pure slot logic plus the dispatcher, sliced from the
// Worker and driven with a fake clock, KV and fetch. Nothing here reaches GitHub.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.join(__dirname, '..', 'dawg-bot-worker.js'), 'utf8');
const start = worker.indexOf('const GH_PACER_REPO');
const end = worker.indexOf('async function bozoGradeFromScheduleKv', start);
assert.ok(start > 0 && end > start, 'pacer source markers exist');

const calls = [];
let reply = () => new Response(null, { status: 204 });
const context = vm.createContext({
  Date, Math, JSON, Map, Set, Object, Array, Number, String, Promise, Response, encodeURIComponent,
  SEASON: 2026,
  fetch: async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith('https://datadawgs216.com/')) return new Response(JSON.stringify(context.SITE_DOC), { status: 200 });
    return reply(String(url), init);
  },
  bozoScheduleDoc: async (env) => env.RL.get('schedule:nfl:2026', 'json'),
});
vm.runInContext(worker.slice(start, end) + '\nthis.api = { ghPacerDue, runGithubPacer };', context);
const { ghPacerDue, runGithubPacer } = context.api;

const at = iso => Date.parse(iso);
const names = due => due.map(d => d.workflow + (d.inputs && d.inputs.mode ? ':' + d.inputs.mode : '')).sort().join(' ');
const kv = () => {
  const store = new Map();
  return { store, async get(k, type) { const v = store.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { store.set(k, v); } };
};

test('daily slots fire at the intended minute and stay due for the 15-minute grace only', () => {
  assert.equal(names(ghPacerDue(at('2026-10-10T10:17:00Z'), [], [])), 'nfl-data.yml:full');
  assert.equal(names(ghPacerDue(at('2026-10-10T10:31:00Z'), [], [])), 'nfl-data.yml:full', 'a skipped tick is recovered');
  assert.equal(names(ghPacerDue(at('2026-10-10T10:33:00Z'), [], [])), '');
  assert.equal(names(ghPacerDue(at('2026-10-10T10:12:00Z'), [], [])), '', 'never early');
  assert.equal(ghPacerDue(at('2026-10-10T10:20:00Z'), [], [])[0].slot, '2026-10-10T10:17');
  // nfelo four times a day; survivor gate at 15:00.
  for (const t of ['02:45', '08:45', '14:45', '20:45'])
    assert.match(names(ghPacerDue(at(`2026-10-10T${t}:00Z`), [], [])), /nfelo-refresh\.yml/, t);
  assert.equal(names(ghPacerDue(at('2026-10-10T15:00:00Z'), [], [])), 'survivor-receipt.yml');
});

test('weekday-only slots respect the weekday', () => {
  // 2026-10-13 is a Tuesday, 2026-10-10 a Saturday.
  assert.match(names(ghPacerDue(at('2026-10-13T12:17:00Z'), [], [])), /fourth-down\.yml/);
  assert.doesNotMatch(names(ghPacerDue(at('2026-10-10T12:17:00Z'), [], [])), /fourth-down\.yml/);
  assert.match(names(ghPacerDue(at('2026-10-14T08:15:00Z'), [], [])), /guillotine-refresh\.yml/);
  assert.equal(names(ghPacerDue(at('2026-10-10T08:15:00Z'), [], [])), '');
});

test('the Fourth Down Lab runs every 15 minutes while an NFL game is live, and not otherwise', () => {
  const kick = '2026-10-11T17:00:00.000Z';
  const games = [{ week: 5, startsAt: kick, completed: false, away: { abbr: 'CHI' }, home: { abbr: 'GB' } }];
  assert.equal(names(ghPacerDue(at('2026-10-11T16:30:00Z'), games, [])), '');
  assert.equal(names(ghPacerDue(at('2026-10-11T16:45:00Z'), games, [])), 'fourth-down.yml');
  assert.equal(names(ghPacerDue(at('2026-10-11T21:25:00Z'), games, [])), 'fourth-down.yml');
  assert.equal(names(ghPacerDue(at('2026-10-11T21:35:00Z'), games, [])), '');
  const a = ghPacerDue(at('2026-10-11T17:01:00Z'), games, [])[0].slot, b = ghPacerDue(at('2026-10-11T17:14:00Z'), games, [])[0].slot;
  const c = ghPacerDue(at('2026-10-11T17:16:00Z'), games, [])[0].slot;
  assert.equal(a, b, 'one slot per quarter hour'); assert.notEqual(b, c);
});

test('a final nflverse has but the published schedule lacks is banked now; nothing else is', () => {
  const now = at('2026-10-09T22:20:00Z');
  const kv = [{ week: 5, startsAt: '2026-10-09T00:15:00.000Z', completed: true, homeScore: 16, awayScore: 24, away: { abbr: 'TB' }, home: { abbr: 'DAL' } },
    { week: 5, startsAt: '2026-10-13T00:15:00.000Z', completed: false, away: { abbr: 'BUF' }, home: { abbr: 'LA' } }];
  const site = [{ game_id: '2026_05_TB_DAL', week: 5, away_team: 'TB', home_team: 'DAL', status: 'scheduled' },
    { game_id: '2026_05_BUF_LAR', week: 5, away_team: 'BUF', home_team: 'LAR', status: 'scheduled' }];
  const due = ghPacerDue(now, kv, site);
  assert.equal(names(due), 'nfl-data.yml:results'); assert.equal(due[0].reason, 'TB@DAL');
  site[0].status = 'final';
  assert.equal(names(ghPacerDue(now, kv, site)), '', 'already published');
  // nflverse's LA is the schedule's LAR.
  kv[1].completed = true; kv[1].startsAt = '2026-10-09T00:15:00.000Z';
  assert.equal(names(ghPacerDue(now, kv, site)), 'nfl-data.yml:results');
  // A final older than three days is someone else's problem (the daily full refresh).
  site[1].status = 'final'; site[0].status = 'scheduled';
  assert.equal(names(ghPacerDue(at('2026-10-14T00:00:00Z'), kv, site)), '');
});

test('the dispatcher is inert without its token, dispatches each slot once, and never stores a response body', async () => {
  const env = { RL: kv() };
  env.RL.store.set('schedule:nfl:2026', JSON.stringify({ games: [] }));
  context.SITE_DOC = { data: { games: [] } };
  calls.length = 0;
  const off = await runGithubPacer(env, at('2026-10-10T10:17:00Z'));
  assert.equal(off.skipped, 'token_unset'); assert.equal(calls.length, 0);

  env.GH_DISPATCH_TOKEN = 'test-token';
  const first = await runGithubPacer(env, at('2026-10-10T10:17:00Z'));
  const dispatch = calls.filter(c => c.url.startsWith('https://api.github.com/'));
  assert.equal(dispatch.length, 1);
  assert.equal(dispatch[0].url, 'https://api.github.com/repos/JKapcar/data-dawgs/actions/workflows/nfl-data.yml/dispatches');
  assert.equal(dispatch[0].init.method, 'POST');
  assert.equal(dispatch[0].init.headers.Authorization, 'Bearer test-token');
  assert.ok(dispatch[0].init.headers['User-Agent'], 'GitHub refuses requests without a User-Agent');
  assert.equal(dispatch[0].init.body, JSON.stringify({ ref: 'main', inputs: { mode: 'full' } }));
  assert.equal(first.dispatched.length, 1);

  calls.length = 0;
  await runGithubPacer(env, at('2026-10-10T10:22:00Z'));
  assert.equal(calls.filter(c => c.url.startsWith('https://api.github.com/')).length, 0, 'same slot, no second dispatch');

  reply = () => new Response('{"message":"Bad credentials","documentation_url":"echoes test-token"}', { status: 401 });
  const failed = await runGithubPacer(env, at('2026-10-10T11:41:00Z'));   // cfb-data only; epa-daily is 11:43
  assert.equal(failed.failed.length, 1); assert.equal(failed.failed[0].status, 401);
  assert.equal(failed.failed[0].workflow, 'cfb-data.yml');
  assert.ok(!env.RL.store.get('gh:pacer:last-run').includes('test-token'), 'no body, no token, ever');
  reply = () => new Response(null, { status: 204 });
  const retried = await runGithubPacer(env, at('2026-10-10T11:46:00Z'));
  assert.equal(retried.dispatched.join(' '), 'cfb-data.yml epa-daily.yml',
    'the failed slot is retried inside its grace, beside the one now due');
});
