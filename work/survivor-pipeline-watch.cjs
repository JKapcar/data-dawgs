// Public operational evidence only. No recipients, credentials, or private picks.
const fs = require('node:fs');
const crypto = require('node:crypto');

const H = 36e5;
/* ⚠️ THE TABLE IS THE COVERAGE. One row per workflow that runs unattended against main: every
   schedule:, every GH_PACER_DAILY entry in dawg-bot-worker.js, everything chained by
   workflow_run or `gh workflow run`, and the push-triggered production checks. `name` is the
   workflow's own name: field, copied exactly — survivor-pipeline-watch.yml's workflow_run
   trigger matches names, not filenames. work/test-survivor-pipeline.mjs derives the list from
   the repo and fails on a missing row, a misspelt name, or a row the trigger does not name.

   max_age_hours = the longest gap between the workflow's own cron fires + 9 hours, because
   GitHub lands these schedules 5-7 hours late (2026-10-05..09: nfelo 14:45 → 19:43-21:37,
   resolve-grade 04:15 → 11:01-11:19). Pacer slots only ever add runs, and the pacer is inert
   without its token, so they never tighten a threshold. null = push-triggered: there is no
   cadence to miss, so only a failed run is news.
   window = when a missing success is news: the cron's own month field, otherwise always. */
const SEASON = { months: [9, 10, 11, 12, 1, 2], label: 'Sep-Feb' };
const WATCHED = [
  { file: 'nfelo-refresh.yml', name: 'nfelo refresh', max_age_hours: 33, window: 'always' },
  { file: 'survivor-receipt.yml', name: 'survivor-receipt', max_age_hours: 33, window: 'always' },
  { file: 'nfl-data.yml', name: 'NFL data backbone', max_age_hours: 33, window: 'always' },
  { file: 'fourth-down.yml', name: 'Fourth Down Lab', max_age_hours: 33, window: SEASON },
  { file: 'fourth-down-rates.yml', name: 'Fourth Down comparison rates', max_age_hours: 33, window: 'always' },
  { file: 'epa-daily.yml', name: 'Daily EPA refresh', max_age_hours: 33, window: 'always' },
  { file: 'cfb-data.yml', name: 'CFB efficiency backbone', max_age_hours: 33, window: 'always' },
  { file: 'draft-picks.yml', name: 'Record draft picks', max_age_hours: 33, window: 'always' },
  { file: 'guillotine-refresh.yml', name: 'Guillotine daily weekly inputs and receipts', max_age_hours: 33, window: 'always' },
  { file: 'bozo-menu-ledger.yml', name: 'Bozo Menu ledger', max_age_hours: 26, window: 'always' },
  { file: 'rankings-mirror.yml', name: 'Dog Track grades mirror', max_age_hours: 33, window: 'always' },
  { file: 'resolve-grade.yml', name: 'forecast-resolve-grade', max_age_hours: 33, window: 'always' },
  { file: 'pool.yml', name: 'forecast-pool', max_age_hours: 192, window: 'always' },
  { file: 'bozo-menu-smoke.yml', name: 'Bozo Menu production smoke', max_age_hours: null, window: 'always' },
  { file: 'site-safety.yml', name: 'Site cache and live-state checks', max_age_hours: null, window: 'always' },
];
const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
// cancelled, skipped and neutral runs say nothing about whether the job works; look past them.
const DECISIVE = new Set(['success', ...FAILED]);
const FRESH_EVENTS = new Set(['schedule', 'workflow_dispatch', 'workflow_run', 'push']);
/* ⚠️ HOLD-DOWN. A problem that clears stays listed this long. The watch now wakes on every
   watched workflow — fourth-down alone can fire every 15 minutes on game days — so a check
   that flaps (one failed run between two good ones, a live fetch that blips) would otherwise
   swing the problem set, and with it the notifying comment, back and forth. Problems still
   appear on the first sighting; only their exit waits. */
const HOLD_MS = 60 * 6e4;
// A deploy that has not landed this long after its commit is a problem, not a deploy in flight.
const LIVE_SETTLE_MS = 60 * 6e4;
/* The Worker's own job health (dawg-bot-worker.js, GET /ops/health): which scheduled jobs are
   failing since when, and when each cron last fired. PULLED, so a failure stays listed until
   the job itself succeeds. Only names and timestamps cross over: the route never carries error
   text, and nothing here would echo it if it did. */
const WORKER_HEALTH = 'https://toto.jkapcar4.workers.dev/ops/health';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const iso = t => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* ⚠️ The issue is public: a problem names WHAT failed in a fixed vocabulary, never an error's
   own text, which can carry a URL or a response body. */
const kindOf = error => (error && Number.isInteger(error.status) ? `HTTP ${error.status}` : (error && error.name) || 'error');

// When the row's window opened (ms), or null while it is shut. A missing success is news only
// once the window has been open longer than max_age, so a season's first day is not judged
// against last season's final run.
function windowOpenSince(window, now) {
  if (window === 'always') return -Infinity;
  const months = new Set(window.months);
  const d = new Date(now);
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  if (!months.has(m)) return null;
  for (let i = 0; i < 12; i++) {
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    if (!months.has(pm)) break;
    y = py; m = pm;
  }
  return Date.UTC(y, m - 1, 1);
}

async function listRuns(github, repo, file, status) {
  const ask = () => github.rest.actions.listWorkflowRuns({ ...repo, workflow_id: file, branch: 'main', status, per_page: 30, exclude_pull_requests: true });
  let res;
  try { res = await ask(); } catch (error) { await sleep(2000); res = await ask(); }
  return res.data.workflow_runs.filter(r => r.head_branch === 'main' && r.event !== 'pull_request');
}

// Two checks per row: the latest decisive run on main failed; or, inside the window, no
// success within max_age. `eventRun` is the run that woke this watch, which the API may not
// list yet; it is the newest evidence for its own row.
async function checkRow(github, repo, row, now, eventRun) {
  let runs = await listRuns(github, repo, row.file, 'completed');
  if (eventRun && eventRun.status === 'completed' && eventRun.head_branch === 'main' && eventRun.event !== 'pull_request'
    && !runs.some(r => r.id === eventRun.id)) runs = [eventRun, ...runs];
  runs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const latest = runs.find(r => DECISIVE.has(r.conclusion));
  const isOk = r => r.conclusion === 'success' && FRESH_EVENTS.has(r.event);
  let ok = runs.filter(isOk).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
  const openedAt = windowOpenSince(row.window, now);
  const due = row.max_age_hours != null && openedAt !== null && now - openedAt >= row.max_age_hours * H;
  if (!ok && due) ok = (await listRuns(github, repo, row.file, 'success')).filter(isOk)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
  const found = [];
  if (latest && FAILED.has(latest.conclusion))
    found.push({ key: `fail:${row.file}`, text: `${row.name} (${row.file}): latest run on main concluded ${latest.conclusion} at ${iso(latest.updated_at)}. ${latest.html_url}` });
  if (due && (!ok || now - Date.parse(ok.updated_at) > row.max_age_hours * H))
    found.push({ key: `stale:${row.file}`, text: `${row.name} (${row.file}): no successful run on main within ${row.max_age_hours} hours (last success: ${ok ? iso(ok.updated_at) : 'none in the last 30'}).` });
  const label = row.window === 'always' ? 'always' : `${row.window.label}${openedAt === null ? ' (shut)' : ''}`;
  const line = `${row.file} [${row.name}] window=${label} max_age=${row.max_age_hours == null ? 'none (push)' : row.max_age_hours + 'h'}` +
    ` latest=${latest ? `${latest.conclusion} ${iso(latest.updated_at)} #${latest.run_number}` : 'none'}` +
    ` last_success=${ok ? `${iso(ok.updated_at)} (${((now - Date.parse(ok.updated_at)) / H).toFixed(1)}h ago)` : 'none'}` +
    ` → ${found.length ? found.map(p => p.key).join(', ') : 'ok'}`;
  return { found, line };
}

// How long a cron's heartbeat may be quiet before the cron counts as silent: its own period,
// plus the hour the heartbeat may lag (it is written at most hourly), plus half an hour.
function cronSilentAfterMs(cron) {
  const [minute, hour] = String(cron).split(/\s+/);
  const period = /^\*\/\d+$/.test(minute) && hour === '*' ? Number(minute.slice(2)) * 6e4
    : /^\d+$/.test(minute) && hour === '*' ? 60 * 6e4
    : 24 * H;
  return period + 90 * 6e4;
}

// A blip is retried; three failures are one problem, worded from a fixed vocabulary.
async function readWorkerHealth() {
  let why = 'no response';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(WORKER_HEALTH, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
      if (response.ok) {
        const body = await response.json();
        if (Array.isArray(body.jobs) && Array.isArray(body.crons)) return body;
        why = 'unexpected shape';
      } else why = `HTTP ${response.status}`;
    } catch { why = 'network error'; }
    if (attempt < 3) await sleep(5000 * attempt);
  }
  throw Object.assign(new Error(why), { why });
}

// The previous run's problems, carried in the issue body so the hold-down survives between runs.
function readState(body) {
  const m = String(body || '').match(/<!-- watch-state: (.*?) -->/s);
  try { return m ? JSON.parse(m[1]) : {}; } catch { return {}; }
}
const writeState = s => JSON.stringify(s).replace(/--/g, '-\\u002d');   // never close the comment early

module.exports = async ({ github, context, core }) => {
  const repo = context.repo;
  const now = Date.now();
  const read = f => JSON.parse(fs.readFileSync('data/' + f + '.json'));
  const problems = [];
  const add = (key, text) => { if (!problems.some(p => p.key === key)) problems.push({ key, text }); };
  if (context.payload.inputs?.failure) add('input:' + sha(context.payload.inputs.failure).slice(0, 12), context.payload.inputs.failure);
  const event = context.payload.workflow_run;
  const eventRow = event && WATCHED.find(r => event.path === `.github/workflows/${r.file}` || event.name === r.name);
  if (event && !eventRow && FAILED.has(event.conclusion)) add(`event:${event.name}`, `${event.name}: ${event.conclusion}. ${event.html_url}`);

  core.info(`Evaluating ${WATCHED.length} watched workflows at ${iso(now)}:`);
  for (const row of WATCHED) {
    try {
      const { found, line } = await checkRow(github, repo, row, now, eventRow === row ? event : null);
      for (const p of found) add(p.key, p.text);
      core.info('  ' + line);
    } catch (error) {
      add(`watchdog:${row.file}`, `Watchdog could not read ${row.file} runs (${kindOf(error)}).`);
      core.info(`  ${row.file} [${row.name}] → check failed (${kindOf(error)})`);
    }
  }

  // Year-round, outside the NFL season gate, in its own try: a failed read is one problem
  // line and never skips the GitHub checks above or the NFL checks below.
  try {
    const health = await readWorkerHealth();
    const when = v => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
    for (const j of health.jobs) {
      const job = String(j.job || '').replace(/[^\w:.-]/g, '');
      core.info(`  worker ${job}: ${j.failing === true ? `failing since ${when(j.since) || 'an unrecorded time'}` : 'ok'}`);
      if (job && j.failing === true) add(`worker:job:${job}`, `Worker ${job} failing since ${when(j.since) || 'an unrecorded time'}`);
    }
    for (const c of health.crons) {
      const cron = String(c.cron || '').replace(/[^\w*\/ ,-]/g, '');
      const last = when(c.last_fired_at);
      const silent = last !== null && now - Date.parse(last) > cronSilentAfterMs(cron);
      core.info(`  worker cron ${cron}: ${last ? `last fired ${last}` : 'no heartbeat yet'}${silent ? ' → silent' : ''}`);
      if (cron && silent) add(`worker:cron:${cron}`, `Worker cron ${cron} silent since ${last}`);
    }
  } catch (error) {
    add('worker:health', `Worker health unreadable (${error.why || 'error'}): ${WORKER_HEALTH}`);
    core.info(`  worker health unreadable (${error.why || 'error'})`);
  }

  let schedule, games, inSeason = false;
  try {
    schedule = read('nfl-schedule').data;
    games = schedule.games.filter(g => g.season === schedule.season && g.season_type === 'REG');
    const starts = games.map(g => Date.parse(g.kickoff_at));
    inSeason = now >= Math.min(...starts) - 7 * 864e5 && now <= Math.max(...starts) + 7 * 864e5;
  } catch (error) { add('watchdog:nfl-schedule', `Watchdog could not read data/nfl-schedule.json (${kindOf(error)}).`); }
  core.info(`NFL survivor checks: ${inSeason ? 'in season' : 'out of season, skipped'}.`);
  if (inSeason) {
    try {
      const nf = read('nfelo').data.meta;
      for (const field of ['captured_at', 'upstream_committed_at']) {
        const age = now - Date.parse(nf[field]);
        if (!Number.isFinite(age) || age > 36 * H) add(`nfelo:${field}`, `nfelo ${field} stale or missing: ${nf[field]}`);
      }
      const receipts = read('survivor-receipts').data;
      for (const week of new Set(games.map(g => g.week))) {
        const first = Math.min(...games.filter(g => g.week === week).map(g => Date.parse(g.kickoff_at)));
        if (first < now && !receipts.some(r => r.season === schedule.season && r.week === week && r.entry_id === 'default'))
          add(`receipt:week-${week}`, `Week ${week}: capture deadline passed with no receipt. Permanent hole; do not backfill.`);
      }
      for (const r of receipts.filter(r => r.season === schedule.season && r.forecast_status === 'prospective')) {
        const legs = games.filter(g => g.week === r.week && r.recommended.some(t => [g.home_team, g.away_team].includes(t)));
        if (legs.length && now > Math.max(...legs.map(g => Date.parse(g.kickoff_at))) + 48 * H)
          add(`receipt:${r.receipt_id}`, `${r.receipt_id}: still prospective 48 hours after its latest leg. Check schedule PR and resolver.`);
      }
    } catch (error) { add('watchdog:nfl', `Watchdog NFL survivor checks failed (${kindOf(error)}).`); }
    for (const name of ['nfelo', 'survivor', 'survivor-receipts']) {
      try {
        // A blip is retried here rather than reported: one failed fetch is not a broken site.
        let response;
        for (let attempt = 1; ; attempt++) {
          try {
            response = await fetch(`https://datadawgs216.com/data/${name}.json?watch=${now}`, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
            if (response.ok || attempt === 3) break;
          } catch (error) { if (attempt === 3) throw error; }
          await sleep(5000 * attempt);
        }
        if (!response.ok) throw Object.assign(new Error('live fetch refused'), { liveStatus: response.status });
        if (sha(Buffer.from(await response.arrayBuffer())) !== sha(fs.readFileSync(`data/${name}.json`))) {
          // Allow a deploy to settle; compare age of the repository's last change.
          const { data: commits } = await github.rest.repos.listCommits({ ...repo, sha: 'main', path: `data/${name}.json`, per_page: 1 });
          if (now - Date.parse(commits[0]?.commit.committer.date) > LIVE_SETTLE_MS)
            add(`live:${name}`, `Live ${name}.json differs from main more than ${LIVE_SETTLE_MS / 6e4} minutes after its commit.`);
        }
      } catch (error) {
        add(`watchdog:live-${name}`, error.liveStatus ? `Live ${name}.json unreadable (HTTP ${error.liveStatus}).`
          : Number.isInteger(error.status) ? `Watchdog could not read the history of data/${name}.json (HTTP ${error.status}).`
          : `Live ${name}.json unreadable (network error).`);
      }
    }
  }

  /* ⚠️ ONE ROLLING ISSUE, NOT ONE PER DAY. The dated issues this replaced piled up at one a
     day (17 open by 2026-10-10, many with seven comments) while the same full-source failure
     repeated for ten days, and nobody could tell a new problem from the old one. Now the
     status issue is edited in place, a COMMENT (which is what notifies) is posted only when
     the set of problems changes, and the issue closes itself when every check passes. */
  const TITLE = 'Pipeline status (automated)';
  const LEGACY = /^Survivor pipeline alert \d{4}-\d{2}-\d{2}$/;
  const runUrl = `${context.serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`;
  const stamp = iso(now);
  const issues = await github.paginate(github.rest.issues.listForRepo, { ...repo, state: 'open', creator: 'github-actions[bot]', per_page: 100 });
  const rolling = issues.find(i => i.title === TITLE && !i.pull_request);
  const legacy = issues.filter(i => LEGACY.test(i.title) && !i.pull_request);
  const close = async (issue, why) => {
    await github.rest.issues.createComment({ ...repo, issue_number: issue.number, body: why });
    await github.rest.issues.update({ ...repo, issue_number: issue.number, state: 'closed', state_reason: 'completed' });
  };
  const state = {};
  for (const p of problems) state[p.key] = { at: stamp, text: p.text };
  for (const [key, prior] of Object.entries(readState(rolling && rolling.body)))
    if (!state[key] && prior && now - Date.parse(prior.at) < HOLD_MS) state[key] = prior;
  const keys = Object.keys(state).sort();
  if (!keys.length) {
    if (rolling) await close(rolling, `Resolved: every check passed at ${stamp}.\n\nWatch run: ${runUrl}`);
    for (const old of legacy) await close(old, `Resolved: every check passed at ${stamp}. Alerts now live in one rolling "${TITLE}" issue.`);
    core.info('Pipeline checks passed');
    return;
  }
  // Run links and timestamps change every time; the fingerprint is which problems there are.
  const fingerprint = sha(keys.join('\n')).slice(0, 12);
  const list = keys.map(k => '- ' + state[k].text + (state[k].at === stamp ? '' : ` _(not seen since ${state[k].at}; listed until it has been clear for ${HOLD_MS / 6e4} minutes)_`)).join('\n');
  const body = `Automated pipeline check — last run ${stamp}:\n\n${list}\n\nWatch run: ${runUrl}\n\n` +
    `This issue is edited in place by each watch run, gets a comment only when the problems change, ` +
    `and closes itself when every check passes. A problem that clears stays listed for ${HOLD_MS / 6e4} minutes, ` +
    `so a check that flaps does not swing the list back and forth.\n\n<!-- fingerprint: ${fingerprint} -->\n<!-- watch-state: ${writeState(state)} -->`;
  let number;
  if (rolling) {
    number = rolling.number;
    const prior = (String(rolling.body || '').match(/<!-- fingerprint: ([0-9a-f]+) -->/) || [])[1];
    await github.rest.issues.update({ ...repo, issue_number: number, body });
    if (prior !== fingerprint)
      await github.rest.issues.createComment({ ...repo, issue_number: number, body: `Problems changed at ${stamp}:\n\n${list}\n\nWatch run: ${runUrl}` });
  } else {
    number = (await github.rest.issues.create({ ...repo, title: TITLE, body })).data.number;
  }
  for (const old of legacy)
    await close(old, `Superseded by #${number}, which is kept current and closes itself when every check passes.`);
  if (problems.length) core.setFailed(problems.map(p => p.text).join('\n'));
  else core.info(`Every check passed; ${keys.length} recently cleared problem(s) stay listed until they have been clear for ${HOLD_MS / 6e4} minutes.`);
};
module.exports.WATCHED = WATCHED;
module.exports.windowOpenSince = windowOpenSince;
module.exports.HOLD_MS = HOLD_MS;
