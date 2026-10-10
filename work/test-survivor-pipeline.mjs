import fs from 'node:fs';
import assert from 'node:assert/strict';
import { captureGate } from './survivor-capture-gate.mjs';
import { classifyCapture } from './check-survivor-capture.mjs';
import watch from './survivor-pipeline-watch.cjs';
const schedule = JSON.parse(fs.readFileSync('data/nfl-schedule.json')).data;
const cases = [
  ['2026-09-08',1,false], ['2026-09-09',1,true], ['2026-09-10',2,false],
  ['2026-09-13',2,false], ['2026-09-17',2,true], ['2026-09-24',3,true],
  ['2026-11-25',12,true], ['2026-11-26',13,false], ['2026-12-17',15,true],
  ['2026-12-19',16,false], ['2026-12-24',16,true], ['2026-12-26',17,false],
  ['2027-01-09',18,false], ['2027-01-10',18,true],
];
console.log('| UTC time | Next week | Hours | Capture eligible |');
console.log('|---|---:|---:|---|');
for (const [day,week,capture] of cases) {
  const time=day+'T15:00:00Z', got=captureGate(schedule.games,schedule.season,Date.parse(time));
  assert.equal(got.week,week); assert.equal(got.capture,capture);
  console.log(`| ${time} | ${week} | ${got.hours.toFixed(2)} | ${capture} |`);
}
const bad=structuredClone(schedule.games);bad[0].kickoff_at='garbage';
assert.throws(()=>captureGate(bad,schedule.season));
const log='wrote data/survivor-receipts.json — 1 row(s) · week 2 captured';
assert.equal(classifyCapture(0,log),'captured');
assert.equal(classifyCapture(1,'REFUSED: a receipt already exists for 2026 week 1 / default'),'already captured');
assert.equal(classifyCapture(1,'REFUSED: week 1 kicked off at 2026-09-10T00:20:00Z'),'kickoff passed');
for(const [code,text] of [[1,'SyntaxError: bad JSON'],[1,'REFUSED: no legal picks'],[0,''],[1,log],[0,'REFUSED: bad']])
  assert.throws(()=>classifyCapture(code,text));


// ---------------------------------------------------------------- watchdog coverage
/* The table must be derived from the repo, not from memory: every workflow with a schedule, a
   workflow_run trigger, a `gh workflow run` dispatch or a GH_PACER_DAILY slot, plus the two
   push-triggered production checks, and nothing else. */
const H = 36e5;
const { WATCHED, windowOpenSince, HOLD_MS } = watch;
const WF = '.github/workflows/';
const files = fs.readdirSync(WF).filter(f => f.endsWith('.yml'));
const text = Object.fromEntries(files.map(f => [f, fs.readFileSync(WF + f, 'utf8')]));
const nameOf = f => text[f].match(/^name:\s*(.+?)\s*$/m)[1].replace(/^["']|["']$/g, '');
const cronsOf = f => [...text[f].matchAll(/\bcron\s*:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
const WATCHER = 'survivor-pipeline-watch.yml';
const chained = new Set(files.filter(f => f !== WATCHER && /^\s{2}workflow_run:/m.test(text[f])));
const dispatched = new Set(files.flatMap(f => [...text[f].matchAll(/gh workflow run ([\w.-]+\.yml)/g)].map(m => m[1])).filter(f => f !== WATCHER));
const worker = fs.readFileSync('dawg-bot-worker.js', 'utf8');
const pacerBlock = worker.match(/const GH_PACER_DAILY = \[([\s\S]*?)\n\];/)[1];
const paced = new Set([...pacerBlock.matchAll(/\["([\w.-]+\.yml)"/g)].map(m => m[1]));
assert.ok(paced.size >= 10, 'the pacer table was found and parsed');
const scheduled = new Set(files.filter(f => f !== WATCHER && cronsOf(f).length));
const production = new Set(['bozo-menu-smoke.yml', 'site-safety.yml']);
const required = new Set([...scheduled, ...chained, ...dispatched, ...paced, ...production]);
const rows = new Set(WATCHED.map(r => r.file));
assert.deepEqual([...required].sort(), [...rows].sort(), 'every unattended workflow has exactly one row');
assert.equal(rows.size, WATCHED.length, 'no workflow is listed twice');
for (const r of WATCHED) assert.equal(r.name, nameOf(r.file), `${r.file}: row name is the workflow's own name: field`);
const triggered = [...text[WATCHER].matchAll(/^\s+- "([^"]+)"\s*$/gm)].map(m => m[1]);
assert.deepEqual([...triggered].sort(), WATCHED.map(r => r.name).sort(), 'workflow_run names every row, exactly');
for (const f of production) assert.match(text[f], /^\s{2}push:/m, `${f} runs on push`);

// Thresholds come from each workflow's own cron: the longest gap between fires (simulated over
// four weeks of the season), plus 9-24 hours for GitHub's late schedules. Push-only rows have none.
const field = (spec, v, lo, hi) => spec.split(',').some(part => {
  const [range, step] = part.split('/');
  const [a, b] = range === '*' ? [lo, hi] : range.split('-').map(Number);
  const end = range.includes('-') || range === '*' ? b : a;
  return v >= a && v <= end && (v - a) % (step ? Number(step) : 1) === 0;
});
const fires = (cron, t) => {
  const [mi, ho, dom, mo, dow] = cron.split(/\s+/), d = new Date(t);
  return field(mi, d.getUTCMinutes(), 0, 59) && field(ho, d.getUTCHours(), 0, 23) && field(dom, d.getUTCDate(), 1, 31)
    && field(mo, d.getUTCMonth() + 1, 1, 12) && field(dow, d.getUTCDay(), 0, 6);
};
const maxGapHours = crons => {
  let last = null, gap = 0;
  for (let t = Date.parse('2026-10-01T00:00:00Z'); t < Date.parse('2026-10-29T00:00:00Z'); t += 6e4)
    if (crons.some(c => fires(c, t))) { if (last !== null) gap = Math.max(gap, (t - last) / H); last = t; }
  return gap;
};
for (const r of WATCHED) {
  const crons = cronsOf(r.file);
  if (!crons.length) { assert.equal(r.max_age_hours, null, `${r.file}: push-triggered, so no max_age`); continue; }
  const gap = maxGapHours(crons);
  assert.ok(r.max_age_hours >= gap + 9 && r.max_age_hours <= gap + 24, `${r.file}: max_age ${r.max_age_hours}h vs cron gap ${gap.toFixed(1)}h`);
  const months = new Set(crons.map(c => c.split(/\s+/)[3]));
  if (months.size === 1 && [...months][0] !== '*') {
    const want = [...Array(12)].map((_, i) => i + 1).filter(m => crons.some(c => field(c.split(/\s+/)[3], m, 1, 12)));
    assert.deepEqual([...r.window.months].sort((a, b) => a - b), want, `${r.file}: window is the cron's month field`);
  }
}
assert.equal(WATCHED.find(r => r.file === 'pool.yml').max_age_hours, 192, 'pool is weekly: 8 days, not 30 hours');
assert.equal(windowOpenSince('always', 0), -Infinity);
assert.equal(windowOpenSince({ months: [9, 10, 11, 12, 1, 2] }, Date.parse('2026-07-15T00:00:00Z')), null, 'shut in July');
assert.equal(windowOpenSince({ months: [9, 10, 11, 12, 1, 2] }, Date.parse('2027-01-20T00:00:00Z')), Date.parse('2026-09-01T00:00:00Z'), 'opened the September before');

// ---------------------------------------------------------------- watchdog behaviour
// Everything below runs without network or a real issue: a fake GitHub that serves runs per
// workflow file and records every issue write.
const realNow = Date.now, realFetch = globalThis.fetch, realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => realTimeout(fn, 0, ...a);   // retries without the wait
// The Worker's GET /ops/health, read on every run. Healthy unless a test says otherwise.
const HEALTHY = { jobs: [{ job: 'bozo:close', cron: '*/5 * * * *', failing: false, since: null, last_ok_at: null }],
  crons: [{ cron: '*/5 * * * *', last_fired_at: null }] };
const healthy = () => ({ ok: true, status: 200, json: async () => HEALTHY });
let workerHealth = healthy;
globalThis.fetch = async url => {
  if (String(url).includes('/ops/health')) return workerHealth();
  throw new Error('unexpected fetch ' + url);
};
let NOW = Date.parse('2026-02-01T12:00:00Z');
Date.now = () => NOW;
const iso = t => new Date(t).toISOString();
let seq = 1000;
const run = (file, conclusion, hoursAgo, extra = {}) => {
  const id = ++seq, at = NOW - hoursAgo * H;
  return { id, run_number: id, status: 'completed', conclusion, event: 'schedule', head_branch: 'main',
    path: WF + file, name: (WATCHED.find(r => r.file === file) || {}).name || file,
    created_at: iso(at - 6e4), updated_at: iso(at), html_url: `https://example.invalid/runs/${id}`, ...extra };
};
const greenRuns = () => Object.fromEntries(WATCHED.map(r => [r.file, [run(r.file, 'success', 1)]]));
function harness({ runs = greenRuns(), issues = [], boom = {} } = {}) {
  const calls = { created: [], comments: [], updates: [], lines: [], failed: [] };
  const github = {
    rest: {
      actions: { async listWorkflowRuns(q) {
        if (boom[q.workflow_id] > 0) { boom[q.workflow_id]--; throw new Error('API unavailable'); }
        const all = runs[q.workflow_id] || [];
        return { data: { workflow_runs: q.status === 'success' ? all.filter(r => r.conclusion === 'success') : all.filter(r => r.status === 'completed') } };
      } },
      issues: { listForRepo() {},
        async create(x) { calls.created.push(x); return { data: { number: 42 } }; },
        async createComment(x) { calls.comments.push(x); },
        async update(x) { calls.updates.push(x); } },
      repos: { async listCommits() { return { data: [{ commit: { committer: { date: iso(NOW - 45 * 6e4) } } }] }; } },
    },
    async paginate() { return issues; },
  };
  const core = { info(m) { calls.lines.push(m); }, setFailed(m) { calls.failed.push(m); } };
  const ctx = (payload = {}, runId = 1) => ({ repo: { owner: 'fixture', repo: 'fixture' }, payload, serverUrl: 'https://example.invalid', runId });
  return { github, core, ctx, calls, go: (payload, runId) => watch({ github, context: ctx(payload, runId), core }) };
}
const keysOf = body => Object.keys(JSON.parse(body.match(/<!-- watch-state: (.*?) -->/s)[1])).sort();

try {
  // All green: every row is evaluated and logged, nothing is opened, dated legacy alerts close.
  {
    const h = harness({ issues: [{ title: 'Survivor pipeline alert 2026-01-30', number: 7 }, { title: 'Unrelated bot issue', number: 8 }] });
    await h.go();
    for (const r of WATCHED) assert.ok(h.calls.lines.some(l => l.includes(r.file) && l.includes('→ ok')), `${r.file} evaluated and logged`);
    assert.equal(h.calls.created.length, 0, 'green opens nothing');
    assert.equal(h.calls.failed.length, 0, 'green does not fail the run');
    assert.ok(h.calls.updates.some(u => u.issue_number === 7 && u.state === 'closed'), 'a dated legacy alert is closed');
    assert.ok(!h.calls.updates.some(u => u.issue_number === 8), 'unrelated issues are untouched');
  }

  // Check 1: the latest decisive run on main failed. Cancelled and skipped runs are looked past;
  // pull-request runs and other branches never count.
  {
    const runs = greenRuns();
    runs['nfl-data.yml'] = [run('nfl-data.yml', 'cancelled', 0.5), run('nfl-data.yml', 'skipped', 0.7), run('nfl-data.yml', 'failure', 1), run('nfl-data.yml', 'success', 2)];
    runs['cfb-data.yml'] = [run('cfb-data.yml', 'failure', 0.2, { event: 'pull_request', head_branch: 'feature' }), run('cfb-data.yml', 'failure', 0.3, { head_branch: 'feature' }), run('cfb-data.yml', 'success', 1)];
    runs['site-safety.yml'] = [run('site-safety.yml', 'startup_failure', 3, { event: 'push' })];
    const h = harness({ runs });
    await h.go();
    const keys = keysOf(h.calls.created[0].body);
    assert.deepEqual(keys, ['fail:nfl-data.yml', 'fail:site-safety.yml']);
    assert.match(h.calls.failed[0], /NFL data backbone \(nfl-data\.yml\): latest run on main concluded failure/);
  }

  // Check 2: no success within max_age while the window is open. A success after the failure
  // clears check 1; push-only rows are never stale; a shut or just-opened window is not judged.
  {
    const runs = greenRuns();
    runs['pool.yml'] = [run('pool.yml', 'success', 191)];
    runs['resolve-grade.yml'] = [run('resolve-grade.yml', 'success', 34)];
    runs['epa-daily.yml'] = [run('epa-daily.yml', 'success', 0.1), run('epa-daily.yml', 'failure', 1)];
    runs['bozo-menu-smoke.yml'] = [run('bozo-menu-smoke.yml', 'success', 24 * 60, { event: 'push' })];
    const h = harness({ runs });
    await h.go();
    assert.deepEqual(keysOf(h.calls.created[0].body), ['stale:resolve-grade.yml'], 'pool at 191h is inside its 8 days; resolve-grade at 34h is not');
    assert.ok(h.calls.lines.some(l => l.startsWith('  bozo-menu-smoke.yml') && l.includes('max_age=none (push)') && l.endsWith('→ ok')));
  }
  {
    // Every success is older than the first page: the second query finds it, still in time.
    const runs = greenRuns();
    runs['fourth-down.yml'] = [...Array(30)].map((_, i) => run('fourth-down.yml', 'cancelled', 0.1 + i * 0.01)).concat(run('fourth-down.yml', 'success', 5));
    const h = harness({ runs });
    h.github.rest.actions.listWorkflowRuns = (orig => async q => {
      const res = await orig(q);
      if (q.status === 'completed') res.data.workflow_runs = res.data.workflow_runs.slice(0, 30);
      return res;
    })(h.github.rest.actions.listWorkflowRuns);
    await h.go();
    assert.equal(h.calls.created.length, 0, 'the success past the first page is found');
  }
  for (const [when, expectStale, why] of [['2026-07-15T12:00:00Z', false, 'shut in July'],
    ['2026-09-01T10:00:00Z', false, 'open only 10 hours: not yet judged'], ['2026-09-03T12:00:00Z', true, 'open 60 hours']]) {
    NOW = Date.parse(when);
    const runs = greenRuns();
    runs['fourth-down.yml'] = [run('fourth-down.yml', 'success', 24 * 150)];
    const h = harness({ runs });
    await h.go();
    const stale = h.calls.created.length > 0 && keysOf(h.calls.created[0].body).includes('stale:fourth-down.yml');
    assert.equal(stale, expectStale, `fourth-down window: ${why}`);
  }
  NOW = Date.parse('2026-02-01T12:00:00Z');

  // The run that woke the watch is evidence even before the API lists it; a failing run of a
  // workflow outside the table is still reported; a row whose API call fails is its own problem
  // after one retry, and never stops the other rows.
  {
    const runs = greenRuns();
    const fresh = run('guillotine-refresh.yml', 'failure', 0.01);
    const h = harness({ runs, boom: { 'draft-picks.yml': 1, 'epa-daily.yml': 2 } });
    await h.go({ workflow_run: fresh });
    const keys = keysOf(h.calls.created[0].body);
    assert.deepEqual(keys, ['fail:guillotine-refresh.yml', 'watchdog:epa-daily.yml'], 'one retry absorbs a blip; two failures are reported');
    assert.match(h.calls.created[0].body, /Watchdog could not read epa-daily\.yml runs \(Error\)\./);
    assert.ok(!h.calls.created[0].body.includes('API unavailable'), 'the public issue never carries an error\'s own text');
    assert.ok(h.calls.lines.some(l => l.startsWith('  site-safety.yml')), 'rows after the failed one were still evaluated');
    const h2 = harness();
    await h2.go({ workflow_run: { name: 'Mystery job', path: WF + 'mystery.yml', conclusion: 'failure', html_url: 'https://example.invalid/runs/9' } });
    assert.deepEqual(keysOf(h2.calls.created[0].body), ['event:Mystery job']);
    const h3 = harness();
    await h3.go({ workflow_run: { name: 'Mystery job', path: WF + 'mystery.yml', conclusion: 'cancelled', html_url: 'x' } });
    assert.equal(h3.calls.created.length, 0, 'a cancelled run is not a failure');
    const h4 = harness();
    await h4.go({ workflow_run: run('cfb-data.yml', 'failure', 0.01, { event: 'pull_request', head_branch: 'feature' }) });
    assert.equal(h4.calls.created.length, 0, 'a waking run from another branch is not main evidence');
  }

  // ONE ROLLING ISSUE: created once, edited in place, commented only when the problem set
  // changes, closed when green. A cleared problem stays listed for the hold-down, so a flapping
  // check does not swing the set; dispatched failure evidence is held the same way.
  {
    const runs = greenRuns();
    const nfeloOk = run('nfelo-refresh.yml', 'success', 10);   // fresh enough: only check 1 is at stake
    runs['nfelo-refresh.yml'] = [run('nfelo-refresh.yml', 'failure', 0.1), nfeloOk];
    let issues = [{ title: 'Survivor pipeline alert 2026-01-30', number: 7 }];
    let h = harness({ runs, issues });
    await h.go({}, 1);
    assert.equal(h.calls.created.length, 1); assert.equal(h.calls.created[0].title, 'Pipeline status (automated)');
    assert.deepEqual(keysOf(h.calls.created[0].body), ['fail:nfelo-refresh.yml']);
    assert.ok(h.calls.updates.some(u => u.issue_number === 7 && u.state === 'closed'), 'a dated legacy alert is closed as superseded');
    assert.match(h.calls.failed[0], /nfelo refresh \(nfelo-refresh\.yml\): latest run on main concluded failure/);
    let body = h.calls.created[0].body;

    // Same problem, newer failing run and run link: edited in place, no comment.
    runs['nfelo-refresh.yml'] = [run('nfelo-refresh.yml', 'failure', 0.05), nfeloOk];
    h = harness({ runs, issues: [{ title: 'Pipeline status (automated)', number: 42, body }] });
    await h.go({}, 2);
    assert.equal(h.calls.created.length, 0, 'no second issue');
    assert.equal(h.calls.updates[0].issue_number, 42); assert.equal(h.calls.updates[0].state, undefined, 'edited in place, still open');
    assert.equal(h.calls.comments.length, 0, 'the same problem with a new run link is not news');
    body = h.calls.updates[0].body;

    // Flap: nfelo recovers for one run, then fails again, all inside the hold-down. No comments.
    NOW += 15 * 6e4;
    runs['nfelo-refresh.yml'] = [run('nfelo-refresh.yml', 'success', 0.01)];
    h = harness({ runs, issues: [{ title: 'Pipeline status (automated)', number: 42, body }] });
    await h.go({}, 3);
    assert.equal(h.calls.comments.length, 0, 'a recovery inside the hold-down is not yet news');
    assert.ok(!h.calls.updates.some(u => u.state === 'closed'), 'still open while held');
    assert.deepEqual(keysOf(h.calls.updates[0].body), ['fail:nfelo-refresh.yml'], 'the cleared problem is still listed');
    assert.match(h.calls.updates[0].body, /not seen since/);
    assert.equal(h.calls.failed.length, 0, 'held problems alone do not fail the run');
    body = h.calls.updates[0].body;
    NOW += 15 * 6e4;
    runs['nfelo-refresh.yml'] = [run('nfelo-refresh.yml', 'failure', 0.01), nfeloOk];
    h = harness({ runs, issues: [{ title: 'Pipeline status (automated)', number: 42, body }] });
    await h.go({}, 4);
    assert.equal(h.calls.comments.length, 0, 'the flap back is not news either');
    body = h.calls.updates[0].body;

    // A genuinely new problem (and dispatched failure evidence) changes the set: one comment.
    runs['cfb-data.yml'] = [run('cfb-data.yml', 'failure', 0.01), run('cfb-data.yml', 'success', 10)];
    h = harness({ runs, issues: [{ title: 'Pipeline status (automated)', number: 42, body }] });
    await h.go({ inputs: { failure: 'NFL data backbone: refresh step failed --> see run' } }, 5);
    assert.equal(h.calls.comments.length, 1, 'a changed problem set comments, which is what notifies');
    const k = keysOf(h.calls.updates[0].body);
    assert.equal(k.length, 3); assert.ok(k.includes('fail:cfb-data.yml') && k.some(x => x.startsWith('input:')));
    // The evidence text carries "-->"; the state must round-trip without closing its own comment.
    const st = JSON.parse(h.calls.updates[0].body.match(/<!-- watch-state: (.*?) -->/s)[1]);
    assert.equal(Object.values(st).find(v => v.text.includes('see run')).text, 'NFL data backbone: refresh step failed --> see run');
    body = h.calls.updates[0].body;

    // Everything recovers. Inside the hold-down the issue stays; after it, the issue closes.
    Object.assign(runs, greenRuns());
    NOW += 30 * 6e4;
    h = harness({ runs, issues: [{ title: 'Pipeline status (automated)', number: 42, body }] });
    await h.go({}, 6);
    assert.ok(!h.calls.updates.some(u => u.state === 'closed'), 'held for the hold-down after recovery');
    body = h.calls.updates[0].body;
    NOW += HOLD_MS + 6e4;
    Object.assign(runs, greenRuns());
    h = harness({ runs, issues: [{ title: 'Pipeline status (automated)', number: 42, body }] });
    await h.go({}, 7);
    assert.ok(h.calls.updates.some(u => u.issue_number === 42 && u.state === 'closed'), 'closes itself when every check passes');
    assert.equal(h.calls.failed.length, 0);

    // A failed issue write is fatal: the watch must not report success it could not record.
    NOW = Date.parse('2026-02-01T12:00:00Z');
    runs['nfelo-refresh.yml'] = [run('nfelo-refresh.yml', 'failure', 0.1)];
    h = harness({ runs, issues: [{ title: 'Pipeline status (automated)', number: 42, body: '' }] });
    h.github.rest.issues.update = async () => { throw Error('denied'); };
    await assert.rejects(() => h.go({}, 8), /denied/);
  }

  // In season, the live-vs-main compare allows a deploy an hour to land and retries a blip.
  {
    NOW = Date.parse('2026-10-10T12:00:00Z');
    const local = name => fs.readFileSync(`data/${name}.json`);
    const serve = (plan) => { const tries = {}; globalThis.fetch = async url => {
      if (String(url).includes('/ops/health')) return workerHealth();
      const name = url.match(/\/data\/([\w-]+)\.json/)[1]; tries[name] = (tries[name] || 0) + 1;
      const r = plan[name](tries[name]);
      if (r instanceof Error) throw r;
      return { ok: true, status: 200, arrayBuffer: async () => r };
    }; return tries; };
    let tries = serve({ nfelo: () => local('nfelo'), survivor: () => Buffer.from('older deploy'),
      'survivor-receipts': n => n < 3 ? new Error('socket hang up') : local('survivor-receipts') });
    let h = harness();
    await h.go();
    assert.equal(h.calls.created.length, 0, 'a deploy 45 minutes old is in flight, and a blip is retried');
    assert.equal(tries['survivor-receipts'], 3, 'two retries before giving up');
    assert.ok(h.calls.lines.some(l => l.includes('in season')));
    serve({ nfelo: () => local('nfelo'), survivor: () => Buffer.from('older deploy'), 'survivor-receipts': () => new Error('socket hang up') });
    h = harness();
    h.github.rest.repos.listCommits = async () => ({ data: [{ commit: { committer: { date: iso(NOW - 90 * 6e4) } } }] });
    await h.go();
    assert.deepEqual(keysOf(h.calls.created[0].body), ['live:survivor', 'watchdog:live-survivor-receipts']);
    assert.ok(!/socket hang up/i.test(h.calls.created[0].body), 'neither keys nor lines carry error text');
    assert.match(h.calls.created[0].body, /Live survivor-receipts\.json unreadable \(network error\)\./);
    serve({ nfelo: () => local('nfelo'), survivor: () => Buffer.from('older deploy'), 'survivor-receipts': () => local('survivor-receipts') });
    h = harness();
    h.github.rest.repos.listCommits = async () => { throw Object.assign(new Error('Resource not accessible by integration'), { status: 403 }); };
    await h.go();
    assert.match(h.calls.created[0].body, /Watchdog could not read the history of data\/survivor\.json \(HTTP 403\)\./);
    assert.ok(!/not accessible/.test(h.calls.created[0].body), 'a GitHub API error is reported by status, not its text');
  }

  // The Worker's own job health is read year-round (this is February, out of NFL season) and
  // only names and timestamps cross over — even when the route offers more.
  {
    NOW = Date.parse('2026-02-01T12:00:00Z');
    globalThis.fetch = async url => { if (String(url).includes('/ops/health')) return workerHealth(); throw new Error('unexpected fetch ' + url); };
    workerHealth = () => ({ ok: true, status: 200, json: async () => ({
      jobs: [
        { job: 'bozo:close', cron: '*/5 * * * *', failing: true, since: '2026-02-01T10:00:00.000Z', last_ok_at: '2026-01-31T00:00:00.000Z',
          error: 'RTDB read 401 https://db.invalid/x.json?auth=top-secret' },
        { job: 'backup', cron: '0 9 * * *', failing: false, since: null, last_ok_at: '2026-02-01T09:00:00.000Z' },
      ],
      crons: [
        { cron: '*/5 * * * *', last_fired_at: iso(NOW - 2 * H) },     // 120 min: past 5 + 60 + 30
        { cron: '9 * * * *', last_fired_at: iso(NOW - 2 * H) },       // 120 min: inside 60 + 60 + 30
        { cron: '0 9 * * *', last_fired_at: null },                   // no heartbeat yet: not an alarm
      ] }) });
    let h = harness();
    await h.go();
    const body = h.calls.created[0].body;
    const st = JSON.parse(body.match(/<!-- watch-state: (.*?) -->/s)[1]);
    assert.deepEqual(Object.keys(st).sort(), ['worker:cron:*/5 * * * *', 'worker:job:bozo:close']);
    assert.equal(st['worker:job:bozo:close'].text, 'Worker bozo:close failing since 2026-02-01T10:00:00.000Z');
    assert.equal(st['worker:cron:*/5 * * * *'].text, `Worker cron */5 * * * * silent since ${iso(NOW - 2 * H)}`);
    assert.ok(!/top-secret|RTDB|auth=/.test(body), 'nothing but names and timestamps crosses over');
    assert.ok(h.calls.lines.some(l => l.includes('out of season')), 'read even out of NFL season');
    assert.ok(h.calls.lines.some(l => l.includes('worker cron 0 9 * * *: no heartbeat yet')));

    // A failed read is one problem line, worded by kind, and every GitHub row still ran.
    let reads = 0;
    workerHealth = () => { reads++; return { ok: false, status: 503, json: async () => ({}) }; };
    h = harness();
    await h.go();
    assert.equal(reads, 3, 'retried twice before it counts');
    assert.deepEqual(keysOf(h.calls.created[0].body), ['worker:health']);
    assert.match(h.calls.created[0].body, /Worker health unreadable \(HTTP 503\)/);
    for (const r of WATCHED) assert.ok(h.calls.lines.some(l => l.includes(r.file) && l.includes('→ ok')), `${r.file} still evaluated`);
    workerHealth = () => { throw new Error('getaddrinfo ENOTFOUND toto.invalid?auth=top-secret'); };
    h = harness();
    await h.go();
    assert.match(h.calls.created[0].body, /Worker health unreadable \(network error\)/);
    assert.ok(!/ENOTFOUND|top-secret/.test(h.calls.created[0].body), 'a fetch error is reported by kind, not by its text');
    workerHealth = () => ({ ok: true, status: 200, json: async () => ({ status: 'fine' }) });
    h = harness();
    await h.go();
    assert.match(h.calls.created[0].body, /Worker health unreadable \(unexpected shape\)/);
    workerHealth = healthy;
    h = harness();
    await h.go();
    assert.equal(h.calls.created.length, 0, 'a healthy Worker adds nothing');
  }
} finally { Date.now = realNow; globalThis.fetch = realFetch; globalThis.setTimeout = realTimeout; }
console.log(`PASS: 14 gate cases, invalid schedule, capture outcomes, watchdog coverage of ${WATCHED.length} workflows, both checks per row, windows, hold-down, live-compare debounce, Worker job health, rolling notifier create/edit/change/close/legacy/failure`);
