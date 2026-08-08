const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('ok  ' + name); };
const read = name => JSON.parse(fs.readFileSync(path.join('data', name), 'utf8'));
const tools = read('pound-tools.json');
const contracts = read('model-contracts.json');
const upstream = read('upstream-models.json');
const surfaces = read('surfaces.json');
const index = read('index.json');

for (const [name, env] of Object.entries({ tools, contracts, upstream })) {
  test(`${name} envelope`, () => {
    assert.match(env.as_of, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(env.source && env.note && env.canonical_url);
    assert.equal(env.tier, 'pound');
    assert.equal(env.graded, false);
  });
}
const nflTools = tools.data.filter(t => (t.kind || 'tool') === 'tool');
const cfbIdeas = tools.data.filter(t => t.kind === 'roadmap-idea');
const roadmap = tools.cfb_roadmap;
test('inventory uses only declared statuses', () => {
  const allowed = new Set(['ready', 'frontend-only', 'backend-blocked', 'data-blocked', 'complete']);
  assert.ok(nflTools.length >= 20);
  nflTools.forEach(t => assert.ok(allowed.has(t.status), `${t.id}: ${t.status}`));
});
test('existing NFL delivery statuses are unchanged by the CFB roadmap', () => {
  const expected = {
    'model-scoreboard': 'complete', disagreement: 'complete', '538-classic': 'complete', nfelo: 'complete',
    nfeloml: 'backend-blocked', nfeloqb: 'data-blocked', wepa: 'data-blocked', srs: 'data-blocked',
    hfa: 'frontend-only', units: 'data-blocked', translation: 'complete', market: 'complete',
    'cover-ev': 'complete', odds: 'complete', parlay: 'complete', hedge: 'complete', passer: 'complete',
    grader: 'complete', receipts: 'complete', regimes: 'data-blocked', ensembles: 'frontend-only',
    'nfl-data': 'complete',
  };
  assert.equal(nflTools.length, 22);
  for (const t of nflTools) assert.equal(t.status, expected[t.id], t.id);
});
test('every incomplete tool names a distinct blocker and minimum path', () => {
  nflTools.filter(t => t.status !== 'complete').forEach(t => {
    assert.ok(t.exact_blocker, t.id);
    assert.ok(t.minimum_path_to_completion, t.id);
    assert.notEqual(t.minimum_path_to_completion, t.exact_blocker, t.id);
  });
});
test('unverified upstream code is never direct integration', () => {
  upstream.data.filter(x => x.license_status.startsWith('unverified') || x.license_status.includes('educational'))
    .forEach(x => assert.notEqual(x.integration_mode, 'direct', x.id));
});
test('not-installed upstream packages are not labelled direct integrations', () => {
  upstream.data.filter(x => /not installed/i.test(x.data_status)).forEach(x => assert.equal(x.integration_mode, 'pending', x.id));
});
test('forecast contract retains nullable unsupported fields', () => {
  assert.match(contracts.data.null_policy, /null/i);
  assert.ok(contracts.data.forecast_required.includes('forecast_status'));
  assert.ok(contracts.data.forecast_required.includes('schedule_snapshot_id'));
  assert.match(contracts.data.snapshot_policy, /not interchangeable/i);
  assert.deepEqual(contracts.data.forecast_status_values, ['backtest', 'prospective']);
  assert.match(contracts.data.calculator_contracts.normal_translation.formula, /inverse_standard_normal/);
  assert.match(contracts.data.calculator_contracts.normal_translation.formula, /0\.5/);
  assert.equal(contracts.data.calculator_contracts.elo_game.mcp_tool, 'dd_elo_game');
  assert.equal(contracts.data.calculator_contracts.normal_translation.mcp_tool, 'dd_translate_probability');
  assert.match(contracts.data.calculator_contracts.belief_summary.note, /not a validated consensus blend/i);
  assert.equal(contracts.data.model_scoreboard_contract.mcp_tool, 'dd_model_scoreboard');
  assert.match(contracts.data.model_scoreboard_contract.grading, /ungraded/i);
  assert.match(contracts.data.model_scoreboard_contract.consensus, /no validated consensus/i);
  assert.equal(contracts.data.model_scoreboard_contract.bounds.maximum_games_returned, 50);
});
test('surface generator reports the deployed Pound MCP tools as live', () => {
  const poundMcp = ['dd_model_scoreboard', 'dd_convert_odds', 'dd_devig_market', 'dd_price_parlay',
    'dd_calculate_bet_ev', 'dd_calculate_hedge', 'dd_nfl_passer_rating',
    'dd_score_forecast', 'dd_summarize_beliefs', 'dd_elo_game',
    'dd_translate_probability'];
  assert.equal(surfaces.counts.mcp_tools_live, 26);
  assert.equal(surfaces.counts.mcp_tools_staged, 14);
  assert.ok(surfaces.mcp.tools_live.includes('dd_survivor_ev'));
  assert.ok(surfaces.mcp.tools_live.includes('dd_optimize_survivor_path'));
  assert.ok(surfaces.mcp.tools_live.includes('dd_analyze_matchup'));
  assert.ok(surfaces.mcp.tools_live.includes('dd_solve_dfs_lineup'));
  poundMcp.forEach(name => assert.ok(surfaces.mcp.tools_live.includes(name), name));
  assert.deepEqual(surfaces.mcp.tools_staged, ['dd_find_cfb_games', 'dd_find_cfb_team_games', 'dd_find_cfb_team_periods', 'dd_find_cfb_historical_market', 'dd_get_cfb_model_card', 'dd_get_cfb_rating_system', 'dd_rank_cfb_teams', 'dd_cfb_team_profile', 'dd_compare_cfb_teams', 'dd_project_cfb_matchup', 'dd_project_cfb_schedule_path', 'dd_find_cfb_record_divergence', 'dd_get_cfb_model_disagreement', 'dd_get_cfb_model_receipt_status']);
});
test('survivor surface exposes the exact path optimizer and names its remaining rule gap', () => {
  const survivor = surfaces.data.find(s => s.id === 'survivor');
  assert.ok(survivor.machine.some(x => x.kind === 'mcp' && x.tool === 'dd_optimize_survivor_path' && x.status === 'live'));
  assert.match(survivor.gap, /one-pick-per-week path is live/i);
  assert.match(survivor.gap, /double-pick weeks/i);
});
test('deployed Pound tools name live MCP implementations without staged claims', () => {
  const ids = new Set(['model-scoreboard', 'disagreement', '538-classic', 'translation', 'market', 'cover-ev', 'odds', 'parlay', 'hedge', 'passer', 'grader']);
  const deployed = tools.data.filter(t => ids.has(t.id));
  assert.equal(deployed.length, 11);
  deployed.forEach(t => {
    assert.equal(t.status, 'complete');
    assert.match(t.existing_worker_mcp_implementation, /^dd_/);
    assert.equal(t.staged_worker_mcp_implementation, null);
    assert.equal(t.exact_blocker, null);
  });
  assert.equal(contracts.data.contract_version, '1.5.0');
  assert.equal(contracts.data.calculator_contracts.odds_converter.mcp_tool, 'dd_convert_odds');
});
test('model scoreboard is live over the normalized ungraded receipt ledger', () => {
  const scoreboard = tools.data.find(t => t.id === 'model-scoreboard');
  assert.equal(scoreboard.status, 'complete');
  assert.equal(scoreboard.existing_worker_mcp_implementation, 'dd_model_scoreboard');
  assert.equal(scoreboard.exact_blocker, null);
  assert.match(scoreboard.machine_readable_requirement, /model-receipts\.json/);
  const pound = surfaces.data.find(s => s.id === 'pound');
  assert.ok(pound.machine.some(x => x.kind === 'mcp' && x.tool === 'dd_model_scoreboard' && x.status === 'live'));
  assert.ok(!pound.planned.includes('mcp:model_scoreboard'));
  assert.match(pound.gap, /prospective timestamped market collector is staged rather than activated/i);
  assert.match(pound.gap, /no CFB forecast receipt has been frozen/i);
});
test('new data surfaces are in the generated manifest', () => {
  const paths = new Set(index.data.files.map(x => x.path));
  for (const p of ['/data/pound-tools.json', '/data/model-contracts.json', '/data/upstream-models.json',
    '/data/nfl-schedule.json', '/data/model-receipts.json', '/data/538-classic.json',
    '/data/cfb-schedule.json', '/data/cfb-team-game.json', '/data/cfb-team-week.json', '/data/cfb-teams.json', '/data/cfb-record-divergence.json', '/data/cfb-record-divergence-validation.json', '/data/cfb-market.json', '/data/cfb-elo.json',
    '/data/cfb-ratings.json', '/data/cfb-model-cards.json', '/data/cfb-model-receipts.json',
    '/data/cfb-disagreement.json']) assert.ok(paths.has(p), p);
});
test('NFL backbone is complete and exposes its canonical files', () => {
  const backbone = tools.data.find(t => t.id === 'nfl-data');
  assert.equal(backbone.status, 'complete');
  assert.equal(backbone.exact_blocker, null);
  assert.match(backbone.machine_readable_requirement, /nfl-schedule\.json/);
  const pound = surfaces.data.find(s => s.id === 'pound');
  const urls = new Set(pound.machine.filter(x => x.status === 'live').map(x => x.url));
  assert.ok(urls.has('/data/nfl-schedule.json'));
  assert.ok(urls.has('/data/model-receipts.json'));
  assert.ok(urls.has('/data/538-classic.json'));
  assert.ok(urls.has('/data/538-classic-methodology.md'));
});
test('538 Classic and multi-model receipts are live but ungraded', () => {
  const model = read('538-classic.json');
  const receipts = read('model-receipts.json');
  assert.equal(model.graded, false);
  assert.equal(model.validation.official_probabilities_compared, 16810);
  assert.ok(model.validation.max_absolute_probability_error < 0.000002);
  assert.equal(model.data.forecasts.length, 272);
  assert.equal(receipts.data.filter(x => x.model_id === 'nfelo').length, 272);
  assert.equal(receipts.data.filter(x => x.model_id === '538-classic').length, 272);
  assert.ok(receipts.data.every(x => x.forecast_status === 'prospective'));
});
/* ---------- College Football roadmap ---------- */
const CFB_HEADINGS = [
  'SportsDataverse bulk-data ingestion', 'CFBD enrichment/model ingestion', 'Canonical CFB Games',
  'Canonical CFB Play-by-Play', 'CFB Team-Game Dataset', 'CFB Player-Game Dataset',
  'CFB Rosters / Identity Resolution', 'CFB Market Dataset', 'CFB Ratings Registry', 'CFB Talent Dataset',
  'CFB Team-Week Analytical Layer', 'Compact public CFB outputs', 'Full offline-reprocessable upstream/raw pipeline',
  'Static SQLite / browser-queryable exploratory database', 'CFB Model Disagreement Lab',
  'Model Receipts / Historical Grading', 'Model Diversity / Consensus Engine', 'Continuous Elo / Glicko Rating',
  'Opponent-Adjusted Unit Ratings', 'Data Dawgs Predictive Power Rating', 'Deep/Trajectory Model',
  'XGBoost / Other ML Challenger Models', 'CFBD Model Training Pack / educational modeling resources',
  'Transfer Portal Flow Network', 'Recruiting Acquisition Network', 'Player Acquisition Graph',
  'Returning Production', 'Portal Net Flow', 'Recruiting Composite / Talent Composite',
  'Raw 247 / On3 / Rivals Scraping', 'NIL Deal Tracking / NIL Valuation', 'Fourth-Down Decision Engine',
  'Fourth-Down Yards-Gained Distribution Model', 'CPOE', 'xREPA', 'Matchup Fingerprints',
  'Counterfactual Simulator', 'Schedule Path Simulator', 'Game Leverage Index', 'Prediction-Market Integration',
  'Overrated / Underrated Team Detector', 'Coaching Trees', 'Coaching Movement / Performance Delta',
  'Coaching Decision Scorecards', 'Weather Effects', 'Altitude', 'Travel Distance / Time Zones',
  'Indoor / Outdoor Effects', 'Injury / Availability Data', 'Practice Participation / Beat-Writer Proxies',
  'Media / Reddit / Social Sentiment', 'ESPN Total QBR Historical Layer', 'Deterministic CFB MCP/API Tool Layer',
  'Local LLM Generated Reports', 'Source Provenance', 'Snapshotting / Receipts', 'Model Cards',
  'Baseline Requirement', 'Incremental Information Test', 'Correlation Awareness', 'Uncertainty',
];
const RECS = ['build', 'lab', 'defer', 'avoid-initially', 'not-needed'];
const LIFECYCLE = ['idea', 'evaluating', 'planned', 'building', 'live', 'deferred', 'graveyard', 'revived'];

test('CFB roadmap ideas carry evidence-backed lifecycle without inventing tools', () => {
  assert.equal(cfbIdeas.length, 44);
  for (const i of cfbIdeas) {
    assert.match(i.id, /^cfb-/, i.id);
    assert.equal(i.domain, 'College Football', i.id);
    assert.equal(typeof i.implemented, 'boolean', i.id);
    assert.ok(!('status' in i), `${i.id}: a roadmap idea must not carry a delivery status`);
    assert.ok(!i.existing_worker_mcp_implementation, `${i.id}: a roadmap artifact cannot claim a live MCP tool`);
    assert.ok(!i.staged_worker_mcp_implementation, `${i.id}: a roadmap artifact cannot claim a staged MCP tool`);
    assert.ok(RECS.includes(i.recommendation), `${i.id}: ${i.recommendation}`);
    assert.ok(LIFECYCLE.includes(i.lifecycle_status), `${i.id}: ${i.lifecycle_status}`);
    if (i.lifecycle_status === 'live') assert.equal(i.implemented, true, `${i.id}: live requires implementation`);
    if (i.implemented) {
      assert.ok(Array.isArray(i.delivery_evidence) && i.delivery_evidence.length, `${i.id}: missing evidence`);
      for (const evidence of i.delivery_evidence)
        assert.ok(fs.existsSync(evidence.replace(/^\//, '')), `${i.id}: missing ${evidence}`);
    }
    for (const field of ['category', 'rationale', 'expected_value', 'data_source_requirements',
      'validation_requirement', 'risks_limitations', 'priority']) assert.ok(i[field], `${i.id}: missing ${field}`);
    assert.ok(Array.isArray(i.source_headings) && i.source_headings.length, `${i.id}: missing source_headings`);
    assert.ok(Array.isArray(i.tags) && i.tags.includes('CFB'), `${i.id}: tags`);
    if (['defer', 'avoid-initially', 'not-needed'].includes(i.recommendation))
      assert.ok(Array.isArray(i.revisit_conditions) && i.revisit_conditions.length, `${i.id}: kept ideas need revisit conditions`);
  }
  const byId = Object.fromEntries(cfbIdeas.map(i => [i.id, i]));
  assert.equal(byId['cfb-sportsdataverse'].lifecycle_status, 'live');
  assert.equal(byId['cfb-games'].lifecycle_status, 'live');
  assert.deepEqual(byId['cfb-games'].candidate_mcp_tools, ['dd_find_cfb_games']);
  assert.equal(byId['cfb-market'].lifecycle_status, 'building');
  assert.deepEqual(byId['cfb-market'].candidate_mcp_tools, ['dd_find_cfb_historical_market']);
  assert.equal(byId['cfb-team-game'].lifecycle_status, 'building');
  assert.equal(byId['cfb-team-game'].implemented, true);
  assert.deepEqual(byId['cfb-team-game'].candidate_mcp_tools, ['dd_find_cfb_team_games']);
  assert.equal(byId['cfb-team-week'].lifecycle_status, 'building');
  assert.equal(byId['cfb-team-week'].implemented, true);
  assert.deepEqual(byId['cfb-team-week'].candidate_mcp_tools, ['dd_find_cfb_team_periods']);
  assert.equal(byId['cfb-public-outputs'].lifecycle_status, 'building');
  assert.equal(byId['cfb-public-outputs'].implemented, true);
  assert.equal(byId['cfb-fraud-detector'].lifecycle_status, 'evaluating');
  assert.equal(byId['cfb-fraud-detector'].implemented, true);
  assert.ok(byId['cfb-fraud-detector'].candidate_mcp_tools.includes('dd_find_cfb_record_divergence'));
  assert.equal(byId['cfb-ratings-registry'].lifecycle_status, 'live');
  assert.equal(byId['cfb-ratings-registry'].implemented, true);
  assert.deepEqual(byId['cfb-ratings-registry'].candidate_mcp_tools, ['dd_get_cfb_rating_system', 'dd_rank_cfb_teams']);
  assert.equal(byId['cfb-elo'].lifecycle_status, 'live');
  assert.deepEqual(byId['cfb-elo'].candidate_mcp_tools, ['dd_get_cfb_model_card']);
  assert.equal(byId['cfb-disagreement-lab'].lifecycle_status, 'evaluating');
  assert.ok(byId['cfb-disagreement-lab'].candidate_mcp_tools.includes('dd_get_cfb_model_disagreement'));
  assert.equal(byId['cfb-model-receipts'].lifecycle_status, 'building');
  assert.equal(byId['cfb-model-receipts'].implemented, true);
  assert.ok(byId['cfb-model-receipts'].candidate_mcp_tools.includes('dd_get_cfb_model_receipt_status'));
  assert.equal(byId['cfb-season-sim'].lifecycle_status, 'building');
  assert.equal(byId['cfb-season-sim'].implemented, true);
  assert.deepEqual(byId['cfb-season-sim'].candidate_mcp_tools, ['dd_project_cfb_schedule_path']);
});
test('published CFB backbone artifacts are discoverable without overstating their evidence', () => {
  const pound = surfaces.data.find(s => s.id === 'pound');
  const machine = Object.fromEntries(pound.machine.filter(x => x.url && x.url.includes('/cfb-')).map(x => [x.url, x]));
  assert.deepEqual(Object.keys(machine).sort(), ['/data/cfb-disagreement.json', '/data/cfb-elo.json',
    '/data/cfb-market.json', '/data/cfb-model-cards.json', '/data/cfb-model-receipts.json',
    '/data/cfb-ratings.json', '/data/cfb-record-divergence-validation.json',
    '/data/cfb-record-divergence.json', '/data/cfb-schedule.json',
    '/data/cfb-team-game.json', '/data/cfb-team-week.json', '/data/cfb-teams.json']);
  assert.match(machine['/data/cfb-market.json'].covers, /observation time is explicitly unknown/i);
  assert.match(machine['/data/cfb-market.json'].covers, /not closing lines/i);
  assert.match(machine['/data/cfb-elo.json'].covers, /ungraded as a prospective model/i);
  assert.match(machine['/data/cfb-ratings.json'].covers, /consensus is explicitly not built/i);
  assert.match(machine['/data/cfb-model-receipts.json'].covers, /zero forecasts/i);
  assert.match(machine['/data/cfb-disagreement.json'].covers, /blocked/i);
  assert.match(machine['/data/cfb-team-game.json'].covers, /advanced play metrics are unavailable/i);
  assert.match(machine['/data/cfb-team-week.json'].covers, /results-only/i);
  assert.match(machine['/data/cfb-teams.json'].covers, /separating observed 2025 results/i);
  assert.match(machine['/data/cfb-record-divergence.json'].covers, /no predictive or overrated\/underrated labels/i);
  assert.match(machine['/data/cfb-record-divergence-validation.json'].covers, /aggregate-only chronological holdout/i);
  assert.match(machine['/data/cfb-record-divergence-validation.json'].covers, /no team labels/i);
});
test('CFB dependency, related-idea and governance references resolve', () => {
  const ids = new Set(cfbIdeas.map(i => i.id));
  const gov = new Set(roadmap.governance.map(g => g.id));
  for (const i of cfbIdeas) {
    for (const d of i.dependencies || []) assert.ok(ids.has(d), `${i.id} → ${d}`);
    for (const d of i.related_ideas || []) assert.ok(ids.has(d), `${i.id} ~ ${d}`);
    for (const g of i.governance || []) assert.ok(gov.has(g), `${i.id} gov ${g}`);
  }
  for (const g of roadmap.governance) for (const d of g.related_ideas || []) assert.ok(ids.has(d), `${g.id} → ${d}`);
});
test('every one of the 61 source headings is represented directly or via a documented consolidation', () => {
  const covered = new Set([
    ...cfbIdeas.flatMap(i => i.source_headings),
    ...cfbIdeas.flatMap(i => (i.components || []).map(c => c.source_heading)),
    ...roadmap.governance.map(g => g.source_heading),
  ]);
  assert.equal(roadmap.source_headings.length, 61);
  assert.deepEqual([...roadmap.source_headings].sort(), [...CFB_HEADINGS].sort());
  for (const h of CFB_HEADINGS) assert.ok(covered.has(h), `heading dropped: ${h}`);
  for (const h of covered) assert.ok(CFB_HEADINGS.includes(h), `unknown heading claimed: ${h}`);
  // a consolidated card (an idea covering more than one heading) must document it
  for (const i of cfbIdeas) {
    const headings = new Set([...i.source_headings, ...(i.components || []).map(c => c.source_heading)]);
    if (headings.size > 1) {
      assert.ok((i.components || []).length >= 1 || /consolidat/i.test(i.notes || ''), `${i.id}: undocumented consolidation`);
    }
  }
});
test('the 12-step roadmap ordering is stored explicitly and stays consistent', () => {
  const titles = ['Foundation / canonical CFB data', 'Ratings registry', 'Model disagreement + receipts',
    'Model diversity / consensus', 'Fourth-down engine', 'Talent / recruiting / portal', 'Fraud Detector',
    'Opponent-adjusted unit ratings + matchup engine', 'Season / playoff path simulator',
    'Coaching decision scorecards', 'Data Dawgs predictive model', 'Experimental challenger models'];
  assert.deepEqual(roadmap.steps.map(s => s.step), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(roadmap.steps.map(s => s.title), titles);
  const ids = new Set(cfbIdeas.map(i => i.id));
  const inSteps = new Map();
  for (const s of roadmap.steps) for (const id of s.idea_ids) { assert.ok(ids.has(id), id); inSteps.set(id, s.step); }
  for (const i of cfbIdeas) {
    if (i.roadmap_step != null) assert.equal(inSteps.get(i.id), i.roadmap_step, i.id);
    else assert.ok(!inSteps.has(i.id), `${i.id} listed in a step but carries no roadmap_step`);
  }
});
test('the implemented CFB MCP tools are staged locally but no candidate is claimed live', () => {
  const candidates = new Set(cfbIdeas.flatMap(i => i.candidate_mcp_tools || []));
  const staged = new Set(['dd_find_cfb_games', 'dd_find_cfb_team_games', 'dd_find_cfb_team_periods', 'dd_find_cfb_historical_market', 'dd_get_cfb_model_card', 'dd_get_cfb_rating_system', 'dd_rank_cfb_teams', 'dd_cfb_team_profile', 'dd_compare_cfb_teams', 'dd_project_cfb_matchup', 'dd_project_cfb_schedule_path', 'dd_find_cfb_record_divergence', 'dd_get_cfb_model_disagreement', 'dd_get_cfb_model_receipt_status']);
  assert.ok(candidates.size >= 12);
  for (const name of candidates) {
    assert.ok(!surfaces.mcp.tools_live.includes(name), `${name} falsely live`);
    if (staged.has(name)) assert.ok(surfaces.mcp.tools_staged.includes(name), `${name} missing staged status`);
    else assert.ok(!surfaces.mcp.tools_staged.includes(name), `${name} falsely staged`);
  }
  assert.equal(surfaces.counts.mcp_tools_live, 26); // unchanged by this task
  const pound = surfaces.data.find(s => s.id === 'pound');
  for (const m of pound.machine.filter(x => x.kind === 'mcp')) assert.ok(!candidates.has(m.tool), m.tool);
  assert.match(pound.machine.find(m => m.url === '/data/pound-tools.json').covers, /evidence-backed lifecycle state; no candidate CFB MCP tool is callable/);
});
test('the roadmap is Graveyard-ready: lifecycle history, postmortem shape and revival path exist', () => {
  assert.deepEqual(roadmap.lifecycle.statuses, LIFECYCLE);
  assert.ok(roadmap.lifecycle.alternate_exits.some(x => /graveyard → revived/i.test(x)));
  for (const f of ['original_hypothesis', 'validation_design', 'performance_vs_baseline',
    'cost_complexity_maintenance', 'reason_retired', 'receipts', 'lessons_learned',
    'revival_conditions', 'lifecycle_history']) assert.ok(roadmap.lifecycle.graveyard_postmortem_fields.includes(f), f);
  for (const i of cfbIdeas) {
    assert.equal(i.graveyard_ready, true, i.id);
    assert.ok(Array.isArray(i.lifecycle_history) && i.lifecycle_history.length >= 1, i.id);
    assert.equal(i.lifecycle_history[0].status, 'idea', i.id);
    assert.match(i.lifecycle_history[0].on, /^\d{4}-\d{2}-\d{2}$/, i.id);
  }
});
test('the seven governance principles are preserved as shared metadata', () => {
  const names = roadmap.governance.map(g => g.source_heading).sort();
  assert.deepEqual(names, ['Baseline Requirement', 'Correlation Awareness', 'Incremental Information Test',
    'Model Cards', 'Snapshotting / Receipts', 'Source Provenance', 'Uncertainty']);
  for (const g of roadmap.governance) assert.ok(g.principle && g.applies_to, g.id);
});
test('pound.html renders the CFB roadmap honestly', () => {
  const html = fs.readFileSync('pound.html', 'utf8');
  assert.match(html, /<section class="p-section" id="cfb">/);
  assert.match(html, /roadmap ideas, not automatically tools/i);
  assert.match(html, /Candidate MCP tool names remain reservations/);
  assert.match(html, /implemented artifacts/);
  assert.match(html, /Shipped evidence/);
  for (const id of ['cfbCat', 'cfbRec', 'cfbLife', 'cfbStep']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /AVOID INITIALLY/);
  assert.match(html, /NOT NEEDED/);
  assert.match(html, /kind==="roadmap-idea"/);
});

test('all shared-nav pages point at pound.html exactly once', () => {
  const pages = fs.readdirSync('.').filter(x => x.endsWith('.html'));
  let covered = 0;
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    if (!html.includes('const NAV = [')) continue;
    covered++;
    assert.equal((html.match(/label:"The Pound"/g) || []).length, 1, page);
    assert.equal((html.match(/href:"pound\.html"/g) || []).length, 1, page);
  }
  assert.ok(covered >= 19);
});
test('Pound page declares its tier and accessible result regions', () => {
  const html = fs.readFileSync('pound.html', 'utf8');
  assert.match(html, /class="tierchip"[^>]*>The Pound<\/a>/);
  assert.ok((html.match(/aria-live="polite"/g) || []).length >= 10);
  assert.match(html, /MODELLED:/);
  assert.match(html, /<option>ready<\/option>/);
  assert.match(html, /live, read-only Worker tools/i);
  assert.match(html, /<b>Live MCP:<\/b>/);
  assert.match(html, /Week 1 nfelo and 538 Classic belief scoreboard/);
  assert.match(html, /\/data\/model-receipts\.json/);
});

console.log(`\n${pass} passed / 0 failed`);
