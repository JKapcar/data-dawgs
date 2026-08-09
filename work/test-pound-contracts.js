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
const CFB_MCP_LIVE = ['dd_find_cfb_games', 'dd_find_cfb_team_games', 'dd_find_cfb_latest_games',
  'dd_find_cfb_team_periods', 'dd_find_cfb_latest_team_periods', 'dd_find_cfb_historical_market',
  'dd_get_cfb_model_card', 'dd_get_cfb_rating_system', 'dd_rank_cfb_teams', 'dd_cfb_team_profile',
  'dd_compare_cfb_teams', 'dd_project_cfb_matchup', 'dd_project_cfb_schedule_path',
  'dd_find_cfb_record_divergence', 'dd_get_cfb_model_disagreement', 'dd_get_cfb_model_receipt_status'];
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
  assert.equal(surfaces.counts.mcp_tools_live, 43);   // 43 live since the 2026-08-09 deploy
  assert.ok(surfaces.mcp.tools_live.includes('dd_survivor_ev'));
  assert.ok(surfaces.mcp.tools_live.includes('dd_optimize_survivor_path'));
  assert.ok(surfaces.mcp.tools_live.includes('dd_analyze_matchup'));
  assert.ok(surfaces.mcp.tools_live.includes('dd_solve_dfs_lineup'));
  poundMcp.forEach(name => assert.ok(surfaces.mcp.tools_live.includes(name), name));
  CFB_MCP_LIVE.forEach(name => assert.ok(surfaces.mcp.tools_live.includes(name), name));
});
/* ⚠️ STAGED IS NOT LIVE, AND THE TEST HAS TO SAY WHICH.
   This assertion used to read `tools_staged === []`, which passed only while nothing was
   ever staged — so the first genuinely staged tool turned the suite red instead of being
   checked. What actually matters is the boundary: a staged name is in the registry and in
   the committed Worker source, and is NOT callable on the deployed endpoint, so it must
   never appear in tools_live and must never be counted there. */
test('staged MCP tools are named, counted separately, and kept out of the live roster', () => {
  const staged = surfaces.mcp.tools_staged;
  /* Empty since the 2026-08-09 deploy. ⚠️ This is deliberately NOT written as
     `deepEqual(staged, [])` — that is the exact bug the comment above describes, a check
     that passes only while nothing is staged and turns red the moment something is. The
     assertions below are about the BOUNDARY and hold whether the list is empty or not. */
  assert.equal(surfaces.counts.mcp_tools_staged, staged.length);
  for (const name of staged) assert.ok(!surfaces.mcp.tools_live.includes(name), `${name} is staged but claimed live`);
  assert.equal(surfaces.counts.mcp_tools_live, surfaces.mcp.tools_live.length);
});
/* ⚠️ THE ROSTER IS DERIVED FROM work/mcp-block.js, SO THE MAP CANNOT DRIFT FROM THE WORKER.
   What is still a human decision — and must stay one — is deployment state: registered is
   not deployed. These assertions hold the two apart and hold the catalog block to the same
   honesty, since /mcp/core/<credential> does not answer on the live endpoint yet. */
test('the surfaces map derives its MCP roster from the registry and labels the catalogs honestly', () => {
  const registry = fs.readFileSync(path.join('work', 'mcp-block.js'), 'utf8');
  const reg = registry.slice(registry.indexOf('const MCP_TOOLS = ['));
  const declared = (reg.match(/\n    name: "dd_\w+",\n/g) || []).map(s => s.match(/"(dd_\w+)"/)[1]);
  assert.equal(declared.length, surfaces.counts.mcp_tools_registered);
  assert.deepEqual([...surfaces.mcp.tools_live, ...surfaces.mcp.tools_staged].sort(), [...declared].sort());

  const cat = surfaces.mcp.catalogs;
  assert.match(cat.status, /^LIVE/);
  /* ⚠️ A LIVE claim must still say what was NOT verified. The per-catalog tools/list counts
     need a credential and none was minted, so the map has to keep admitting that. */
  assert.match(cat.status, /NOT VERIFIED IN PRODUCTION/);
  assert.deepEqual(cat.full, declared);
  assert.equal(cat.core.length, surfaces.counts.mcp_tools_core);
  assert.ok(cat.core.length > 0 && cat.core.length < cat.full.length, 'core must be a proper subset, or it saves nothing');
  for (const name of cat.core) assert.ok(cat.full.includes(name), `${name} is in core but not in full`);
  assert.equal(cat.paths.core, '/mcp/core/<credential>');
  // the endpoint description must now ADVERTISE the catalog routes, because they answer
  assert.ok(/\/mcp\/core\//.test(surfaces.mcp.path), 'the catalogs are live but the path does not name them');

  const titles = surfaces.mcp.annotations.titles;
  assert.match(surfaces.mcp.annotations.status, /^LIVE/);
  assert.match(surfaces.mcp.annotations.status, /NOT VERIFIED ON THE WIRE/);
  assert.deepEqual(Object.keys(titles).sort(), [...declared].sort());
  assert.ok(Object.values(titles).every(t => typeof t === 'string' && t.length > 0));
  assert.equal(new Set(Object.values(titles)).size, declared.length, 'two tools sharing a title is a UI that lies');
});
/* ⚠️ THE DEPLOY CHECKLIST IS PART OF THE ARTIFACT, SO IT IS GRADED LIKE ONE.
   docs/mcp-catalogs.md tells whoever runs the Worker deploy which files must change in the
   same commit. A checklist that has drifted from the code is worse than none, because it
   reads as verified. So the doc has to keep naming the real staged set and the real core
   set — and, now that the deploy has happened, must NOT still claim the catalogs are
   undeployed. The assertion inverted on 2026-08-09 rather than being deleted. */
test('docs/mcp-catalogs.md still matches the registry it documents', () => {
  const doc = fs.readFileSync(path.join('docs', 'mcp-catalogs.md'), 'utf8');
  assert.ok(!/NOT deployed/.test(doc), 'the catalogs are deployed; the doc must not still say otherwise');
  for (const name of surfaces.mcp.tools_staged)
    assert.ok(doc.includes(name), `${name} is staged but docs/mcp-catalogs.md never mentions it`);
  const cat = surfaces.mcp.catalogs;
  for (const name of cat.core)
    assert.ok(doc.includes(name), `${name} is in the core catalog but is not listed in the doc`);
  // the doc states the two counts in prose; keep them true
  assert.ok(doc.includes(`| core | ${cat.core.length} |`) || new RegExp(`core\\b[^\\n]*\\b${cat.core.length}\\b`).test(doc),
    'the doc must state the real core count');
  assert.ok(new RegExp(`\\b${cat.full.length}\\b`).test(doc), 'the doc must state the real full count');
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
  assert.match(pound.gap, /timestamped 24-hour market collector are live/i);
  assert.match(pound.gap, /first market observation waits on an eligible 2026 event/i);
  assert.match(pound.gap, /no CFB (?:model )?forecast receipt has been frozen/i);
});
test('new data surfaces are in the generated manifest', () => {
  const paths = new Set(index.data.files.map(x => x.path));
  for (const p of ['/data/pound-tools.json', '/data/model-contracts.json', '/data/upstream-models.json',
    '/data/nfl-schedule.json', '/data/model-receipts.json', '/data/538-classic.json',
    '/data/cfb-schedule.json', '/data/cfb-games-latest.json', '/data/cfb-team-game.json', '/data/cfb-team-week.json', '/data/cfb-team-week-latest.json', '/data/cfb-teams.json', '/data/cfb-record-divergence.json', '/data/cfb-record-divergence-validation.json', '/data/cfb-market.json', '/data/cfb-elo.json',
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
  assert.deepEqual(byId['cfb-public-outputs'].candidate_mcp_tools, ['dd_find_cfb_latest_games', 'dd_find_cfb_latest_team_periods']);
  assert.equal(byId['cfb-fraud-detector'].lifecycle_status, 'evaluating');
  assert.equal(byId['cfb-fraud-detector'].implemented, true);
  assert.ok(byId['cfb-fraud-detector'].candidate_mcp_tools.includes('dd_find_cfb_record_divergence'));
  assert.equal(byId['cfb-ratings-registry'].lifecycle_status, 'live');
  assert.equal(byId['cfb-ratings-registry'].implemented, true);
  assert.deepEqual(byId['cfb-ratings-registry'].candidate_mcp_tools, ['dd_get_cfb_rating_system', 'dd_rank_cfb_teams']);
  assert.equal(byId['cfb-elo'].lifecycle_status, 'live');
  assert.deepEqual(byId['cfb-elo'].candidate_mcp_tools, ['dd_get_cfb_model_card']);
  assert.match(byId['cfb-elo'].delivery_note, /non-ranked/i);
  assert.match(byId['cfb-elo'].delivery_note, /team diagnostics/i);
  assert.equal(byId['cfb-disagreement-lab'].lifecycle_status, 'evaluating');
  assert.ok(byId['cfb-disagreement-lab'].candidate_mcp_tools.includes('dd_get_cfb_model_disagreement'));
  assert.equal(byId['cfb-model-receipts'].lifecycle_status, 'building');
  assert.equal(byId['cfb-model-receipts'].implemented, true);
  assert.ok(byId['cfb-model-receipts'].candidate_mcp_tools.includes('dd_get_cfb_model_receipt_status'));
  assert.equal(byId['cfb-season-sim'].lifecycle_status, 'building');
  assert.equal(byId['cfb-season-sim'].implemented, true);
  assert.deepEqual(byId['cfb-season-sim'].candidate_mcp_tools, ['dd_project_cfb_schedule_path']);
  assert.equal(byId['cfb-mcp-layer'].lifecycle_status, 'live');
  assert.equal(byId['cfb-mcp-layer'].implemented, true);
  assert.match(byId['cfb-mcp-layer'].delivery_note, /sixteen source-backed CFB tools are live in production/i);
  assert.match(byId['cfb-mcp-layer'].delivery_note, /42 live tools total/i);
});
test('published CFB backbone artifacts are discoverable without overstating their evidence', () => {
  const pound = surfaces.data.find(s => s.id === 'pound');
  const machine = Object.fromEntries(pound.machine.filter(x => x.url && x.url.includes('/cfb-')).map(x => [x.url, x]));
  assert.deepEqual(Object.keys(machine).sort(), ['/data/cfb-disagreement.json', '/data/cfb-elo.json',
    '/data/cfb-games-latest.json', '/data/cfb-market.json', '/data/cfb-model-cards.json', '/data/cfb-model-receipts.json',
    '/data/cfb-ratings.json', '/data/cfb-record-divergence-validation.json',
    '/data/cfb-record-divergence.json', '/data/cfb-schedule.json',
    '/data/cfb-team-game.json', '/data/cfb-team-week-latest.json', '/data/cfb-team-week.json', '/data/cfb-teams.json']);
  assert.match(machine['/data/cfb-market.json'].covers, /observation time is explicitly unknown/i);
  assert.match(machine['/data/cfb-market.json'].covers, /not closing lines/i);
  assert.match(machine['/data/cfb-elo.json'].covers, /ungraded as a prospective model/i);
  assert.match(machine['/data/cfb-elo.json'].covers, /non-ranked expected-versus-observed team diagnostics/i);
  assert.match(machine['/data/cfb-ratings.json'].covers, /consensus is explicitly not built/i);
  assert.match(machine['/data/cfb-ratings.json'].covers, /exact non-ranked team diagnostics/i);
  assert.match(machine['/data/cfb-model-receipts.json'].covers, /zero forecasts/i);
  assert.match(machine['/data/cfb-disagreement.json'].covers, /blocked/i);
  assert.match(machine['/data/cfb-games-latest.json'].covers, /one per FBS team/i);
  assert.match(machine['/data/cfb-games-latest.json'].covers, /not current form or forecasts/i);
  assert.match(machine['/data/cfb-team-game.json'].covers, /advanced play metrics are unavailable/i);
  assert.match(machine['/data/cfb-team-week.json'].covers, /results-only/i);
  assert.match(machine['/data/cfb-team-week.json'].covers, /non-authoritative regular-season conference records/i);
  assert.match(machine['/data/cfb-team-week-latest.json'].covers, /230 compact latest team-period rows/i);
  assert.match(machine['/data/cfb-team-week-latest.json'].covers, /no current-2026 or predictive claim/i);
  assert.match(machine['/data/cfb-team-week-latest.json'].covers, /non-authoritative conference records/i);
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
test('the deployed CFB MCP tools are live while unimplemented candidate names remain reserved', () => {
  const candidates = new Set(cfbIdeas.flatMap(i => i.candidate_mcp_tools || []));
  const live = new Set(CFB_MCP_LIVE);
  assert.ok(candidates.size >= 12);
  for (const name of candidates) {
    if (live.has(name)) assert.ok(surfaces.mcp.tools_live.includes(name), `${name} missing live status`);
    else assert.ok(!surfaces.mcp.tools_live.includes(name), `${name} falsely live`);
    assert.ok(!surfaces.mcp.tools_staged.includes(name), `${name} falsely staged`);
  }
  assert.equal(surfaces.counts.mcp_tools_live, 43);   // 43 live since the 2026-08-09 deploy
  const pound = surfaces.data.find(s => s.id === 'pound');
  const exposed = new Set(pound.machine.filter(x => x.kind === 'mcp').map(x => x.tool));
  for (const name of CFB_MCP_LIVE) assert.ok(exposed.has(name), `${name} missing from Pound machine surfaces`);
  assert.match(pound.machine.find(m => m.url === '/data/pound-tools.json').covers, /sixteen production CFB MCP tools/i);
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

/* ⚠️ THE BUG THIS DEFENDS. pound.html carried a TYPED "0 candidate CFB MCP tools
   callable" and labelled every card's tool names "not callable", months after sixteen of
   them went live in /data/surfaces.json. The page and the machine surface disagreed and
   only the machine surface was right. So: the page may not contain the answer, it must
   compute it, and these assertions check the mechanism rather than the number. */
test('pound.html computes the callable CFB tool count instead of stating one', () => {
  const html = fs.readFileSync('pound.html', 'utf8');
  assert.ok(!/\d+ candidate CFB MCP tools callable/.test(html),
    'the callable count is typed into the page again');
  assert.ok(!html.includes('Candidate MCP tools (not callable)'),
    'cards label live tools as not callable again');
  assert.ok(!html.includes('Candidate CFB MCP tool names are not callable'),
    'the machine-readable bullet claims no CFB tool is callable again');
  // the split must come from the live roster, intersected with the cards
  assert.match(html, /liveMcp=new Set\(surfaces\.mcp\.tools_live\)/);
  assert.match(html, /function cfbToolSplit\(\)/);
  assert.match(html, /liveMcp\.has\(t\)/);
  assert.match(html, /json\("\/data\/surfaces\.json"\)/);
  for (const id of ['cfbTools', 'cfbToolStats', 'cfbToolsLive', 'cfbToolsPlanned', 'cfbMachineTools'])
    assert.ok(html.includes(`id="${id}"`), id);
  // a missing roster must fail loudly, not silently report zero
  assert.match(html, /surfaces\.json is missing its live MCP roster/);
  assert.match(html, /this is not a claim that no tools are live/);
});
test('the sixteen live CFB tools are exactly the cards-and-roster intersection', () => {
  // the page computes this at runtime; the test computes it here from the same two files
  const named = new Set();
  cfbIdeas.forEach(i => (i.candidate_mcp_tools || []).forEach(t => named.add(t)));
  const live = new Set(surfaces.mcp.tools_live);
  const callable = [...named].filter(t => live.has(t)).sort();
  const reserved = [...named].filter(t => !live.has(t)).sort();
  assert.deepEqual(callable, [...CFB_MCP_LIVE].sort());
  assert.equal(callable.length, 16);
  assert.ok(reserved.length > 0, 'a page that shows no reservations would be hiding the roadmap');
  // every callable tool must be attributable to a card that is not the umbrella
  const umbrellaOnly = callable.filter(t => !cfbIdeas.some(
    i => i.id !== 'cfb-mcp-layer' && (i.candidate_mcp_tools || []).includes(t)));
  assert.ok(umbrellaOnly.length <= 3,
    `too many tools attributable only to cfb-mcp-layer: ${umbrellaOnly.join(', ')}`);
});
test('build-pound.py cannot silently delete the CFB section', () => {
  /* It regenerates pound.html from the 2026-08-07 nfelo.html template, which predates the
     entire CFB section. Running it on 8/9 removed 6,697 characters and reported success. */
  const bp = fs.readFileSync(path.join('work', 'build-pound.py'), 'utf8');
  assert.match(bp, /HISTORICAL BOOTSTRAP/);
  assert.match(bp, /raise SystemExit/);
  assert.match(bp, /DD_REBUILD_POUND/);
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
