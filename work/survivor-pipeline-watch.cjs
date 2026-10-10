// Public operational evidence only. No recipients, credentials, or private picks.
module.exports = async ({github, context, core}) => {
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  const repo = context.repo;
  const now = Date.now();
  const read = f => JSON.parse(fs.readFileSync('data/' + f + '.json'));
  const problems = [];
  if (context.payload.inputs?.failure) problems.push(context.payload.inputs.failure);
  const event = context.payload.workflow_run;
  if (event && !['success', 'skipped'].includes(event.conclusion))
    problems.push(`${event.name}: ${event.conclusion}. ${event.html_url}`);
  try {
    const schedule = read('nfl-schedule').data;
    const games = schedule.games.filter(g => g.season === schedule.season && g.season_type === 'REG');
    const starts = games.map(g => Date.parse(g.kickoff_at));
    const inSeason = now >= Math.min(...starts) - 7 * 864e5 && now <= Math.max(...starts) + 7 * 864e5;
    if (inSeason) {
      for (const workflow_id of ['nfelo-refresh.yml', 'survivor-receipt.yml', 'nfl-data.yml']) {
        const {data} = await github.rest.actions.listWorkflowRuns({...repo, workflow_id, branch:'main', status:'success', per_page:30});
        const run = data.workflow_runs.find(r => ['schedule','workflow_dispatch','workflow_run'].includes(r.event));
        if (!run || now - Date.parse(run.updated_at) > 30 * 36e5)
          problems.push(`${workflow_id}: no successful scheduled/dispatch/chained run within 30 hours.`);
      }
      const nf = read('nfelo').data.meta;
      for (const field of ['captured_at', 'upstream_committed_at']) {
        const age = now - Date.parse(nf[field]);
        if (!Number.isFinite(age) || age > 36 * 36e5) problems.push(`nfelo ${field} stale or missing: ${nf[field]}`);
      }
      const receipts = read('survivor-receipts').data;
      for (const week of new Set(games.map(g => g.week))) {
        const first = Math.min(...games.filter(g => g.week === week).map(g => Date.parse(g.kickoff_at)));
        if (first < now && !receipts.some(r => r.season === schedule.season && r.week === week && r.entry_id === 'default'))
          problems.push(`Week ${week}: capture deadline passed with no receipt. Permanent hole; do not backfill.`);
      }
      for (const r of receipts.filter(r => r.season === schedule.season && r.forecast_status === 'prospective')) {
        const legs = games.filter(g => g.week === r.week && r.recommended.some(t => [g.home_team,g.away_team].includes(t)));
        if (legs.length && now > Math.max(...legs.map(g => Date.parse(g.kickoff_at))) + 48 * 36e5)
          problems.push(`${r.receipt_id}: still prospective 48 hours after its latest leg. Check schedule PR and resolver.`);
      }
      for (const name of ['nfelo','survivor','survivor-receipts']) {
        const response = await fetch(`https://datadawgs216.com/data/${name}.json?watch=${now}`, {signal:AbortSignal.timeout(20000),cache:'no-store'});
        if (!response.ok) throw new Error(`live ${name}: HTTP ${response.status}`);
        const hash = b => crypto.createHash('sha256').update(b).digest('hex');
        if (hash(Buffer.from(await response.arrayBuffer())) !== hash(fs.readFileSync(`data/${name}.json`))) {
          // Allow a deploy to settle; compare age of the repository's last change.
          const {data:commits} = await github.rest.repos.listCommits({...repo,sha:'main',path:`data/${name}.json`,per_page:1});
          if (now - Date.parse(commits[0]?.commit.committer.date) > 30 * 6e4)
            problems.push(`Live ${name}.json differs from main more than 30 minutes after its commit.`);
        }
      }
    }
  } catch (error) { problems.push(`Watchdog check failed: ${error.message}`); }

  /* ⚠️ ONE ROLLING ISSUE, NOT ONE PER DAY. The dated issues this replaced piled up at one a
     day (17 open by 2026-10-10, many with seven comments) while the same full-source failure
     repeated for ten days, and nobody could tell a new problem from the old one. Now the
     status issue is edited in place, a COMMENT (which is what notifies) is posted only when
     the set of problems changes, and the issue closes itself when every check passes. */
  const TITLE = 'Pipeline status (automated)';
  const LEGACY = /^Survivor pipeline alert \d{4}-\d{2}-\d{2}$/;
  const runUrl = `${context.serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`;
  const stamp = new Date(now).toISOString();
  const issues = await github.paginate(github.rest.issues.listForRepo,{...repo,state:'open',creator:'github-actions[bot]',per_page:100});
  const rolling = issues.find(i => i.title === TITLE && !i.pull_request);
  const legacy = issues.filter(i => LEGACY.test(i.title) && !i.pull_request);
  const close = async (issue, why) => {
    await github.rest.issues.createComment({...repo,issue_number:issue.number,body:why});
    await github.rest.issues.update({...repo,issue_number:issue.number,state:'closed',state_reason:'completed'});
  };
  if (!problems.length) {
    if (rolling) await close(rolling, `Resolved: every check passed at ${stamp}.\n\nWatch run: ${runUrl}`);
    for (const old of legacy) await close(old, `Resolved: every check passed at ${stamp}. Alerts now live in one rolling "${TITLE}" issue.`);
    core.info('Survivor pipeline checks passed');
    return;
  }
  // Run links change every time; the fingerprint is the problems themselves.
  const fingerprint = crypto.createHash('sha256')
    .update(problems.map(p => p.replace(/https?:\/\/\S+/g, '')).sort().join('\n')).digest('hex').slice(0, 12);
  const list = problems.map(p => '- ' + p).join('\n');
  const body = `Automated pipeline check — last run ${stamp}:\n\n${list}\n\nWatch run: ${runUrl}\n\n` +
    `This issue is edited in place by each watch run, gets a comment only when the problems change, ` +
    `and closes itself when every check passes.\n\n<!-- fingerprint: ${fingerprint} -->`;
  let number;
  if (rolling) {
    number = rolling.number;
    const prior = (String(rolling.body || '').match(/<!-- fingerprint: ([0-9a-f]+) -->/) || [])[1];
    await github.rest.issues.update({...repo,issue_number:number,body});
    if (prior !== fingerprint)
      await github.rest.issues.createComment({...repo,issue_number:number,body:`Problems changed at ${stamp}:\n\n${list}\n\nWatch run: ${runUrl}`});
  } else {
    number = (await github.rest.issues.create({...repo,title:TITLE,body})).data.number;
  }
  for (const old of legacy)
    await close(old, `Superseded by #${number}, which is kept current and closes itself when every check passes.`);
  core.setFailed(problems.join('\n'));
};
