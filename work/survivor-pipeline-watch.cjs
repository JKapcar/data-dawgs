// Public operational evidence only. No recipients, credentials, or private picks.
module.exports = async ({github, context, core}) => {
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  const repo = context.repo;
  const now = Date.now();
  const read = f => JSON.parse(fs.readFileSync('data/' + f + '.json'));
  const problems = [];
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
  if (!problems.length) { core.info('Survivor pipeline checks passed'); return; }
  const title = `Survivor pipeline alert ${new Date(now).toISOString().slice(0,10)}`;
  const body = 'Automated pipeline check:\n\n' + problems.map(p => '- ' + p).join('\n') +
    `\n\nWatch run: ${context.serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`;
  const issues = await github.paginate(github.rest.issues.listForRepo,{...repo,state:'open',creator:'github-actions[bot]',per_page:100});
  const existing = issues.find(i => i.title === title && !i.pull_request);
  if (existing) await github.rest.issues.createComment({...repo,issue_number:existing.number,body});
  else await github.rest.issues.create({...repo,title,body});
  core.setFailed(problems.join('\n'));
};
