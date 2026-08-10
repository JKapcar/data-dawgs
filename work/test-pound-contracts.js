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
  /* CEP-5A 1b: the models sheet renders on receipts.html, so the tool and its data
     ride on the receipts surface now. The pound surface must NOT still claim them. */
  const pound = surfaces.data.find(s => s.id === 'pound');
  const receiptsSurface = surfaces.data.find(s => s.id === 'receipts');
  assert.ok(receiptsSurface.machine.some(x => x.kind === 'mcp' && x.tool === 'dd_model_scoreboard' && x.status === 'live'));
  assert.ok(!pound.machine.some(x => x.tool === 'dd_model_scoreboard'));
  assert.ok(!pound.planned.includes('mcp:model_scoreboard'));
  /* CEP-5A Stage 3: the CFB claims moved with the roadmap to the cfb surface. The
     collector/receipt honesty statements must survive the move, on the row that now
     owns them — this is the same check, at its new address. */
  const cfbSurface = surfaces.data.find(s => s.id === 'cfb');
  assert.ok(cfbSurface, 'surfaces.json has no cfb row');
  assert.match(cfbSurface.gap, /timestamped 24-hour market collector are live/i);
  assert.match(cfbSurface.gap, /first market observation waits on an eligible 2026 event/i);
  assert.match(cfbSurface.gap, /no CFB (?:model )?forecast receipt has been frozen/i);
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
  /* CEP-5A 1b: these render on receipts.html now, so the receipts surface owns them. */
  const receiptsSurface = surfaces.data.find(s => s.id === 'receipts');
  const urls = new Set(receiptsSurface.machine.filter(x => x.status === 'live').map(x => x.url));
  assert.ok(urls.has('/data/nfl-schedule.json'));
  assert.ok(urls.has('/data/model-receipts.json'));
  assert.ok(urls.has('/data/538-classic.json'));
  assert.ok(urls.has('/data/538-classic-methodology.md'));
  assert.ok(urls.has('/data/upstream-models.json'));
  const poundUrls = new Set(surfaces.data.find(s => s.id === 'pound').machine.map(x => x.url));
  for (const moved of ['/data/nfl-schedule.json', '/data/model-receipts.json', '/data/538-classic.json',
    '/data/538-classic-methodology.md', '/data/upstream-models.json'])
    assert.ok(!poundUrls.has(moved), moved + ' still claimed by the pound surface');
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
  /* CEP-5A Stage 3: the files ride on the cfb surface now — same honesty checks, at
     the row that owns them. The pound row must have let them go. */
  const cfbSurface = surfaces.data.find(s => s.id === 'cfb');
  const machine = Object.fromEntries(cfbSurface.machine.filter(x => x.url && x.url.includes('/cfb-')).map(x => [x.url, x]));
  const pound = surfaces.data.find(s => s.id === 'pound');
  assert.ok(!pound.machine.some(x => x.url && x.url.includes('/cfb-')),
    'the pound surface still claims CFB data files');
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
  /* CEP-5A Stage 3: the sixteen CFB tools ride on the cfb surface, whose page renders
     the roadmap that names them. The DawgHouse surface must no longer claim them, and
     its pound-tools.json entry must stop advertising a roadmap it does not render. */
  const cfbSurface = surfaces.data.find(s => s.id === 'cfb');
  const exposed = new Set(cfbSurface.machine.filter(x => x.kind === 'mcp').map(x => x.tool));
  for (const name of CFB_MCP_LIVE) assert.ok(exposed.has(name), `${name} missing from the cfb machine surfaces`);
  const pound = surfaces.data.find(s => s.id === 'pound');
  assert.ok(!pound.machine.some(x => x.kind === 'mcp' && CFB_MCP_LIVE.includes(x.tool)),
    'the pound surface still claims the CFB tools');
  assert.match(cfbSurface.machine.find(m => m.url === '/data/pound-tools.json').covers, /roadmap/i);
  assert.match(pound.machine.find(m => m.url === '/data/pound-tools.json').covers, /listed on the cfb surface/i);
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
/* CEP-5A Stage 3: the roadmap renders on cfb.html's Roadmap sheet now. These two
   tests grade the CONTENT and the MECHANISM, which travelled unchanged — they follow
   it rather than being deleted, and dawghouse.html is checked for having let go. */
test('cfb.html renders the CFB roadmap honestly', () => {
  const html = fs.readFileSync('cfb.html', 'utf8');
  assert.match(html, /<div class="card" id="roadmap">/);
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
test('cfb.html computes the callable CFB tool count instead of stating one', () => {
  const html = fs.readFileSync('cfb.html', 'utf8');
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

test('every shared-nav page reaches the shelf, and never by the old name', () => {
  /* CEP-5A Stage 7 took The DawgHouse OUT of the menu, reasoning that a shelf of blocked
     work is not somewhere to route people. Kap reversed that on 2026-08-10: the shelf is
     EVIDENCE, so it belongs with the evidence, and it is now an item inside the Receipts
     group. What did NOT change is that it stays its own PAGE — its content is prose per
     tenant, not a graded table, so it is not a sheet inside receipts.html.
     ⚠️ It is still not a TOP-LEVEL chip, which is what `label:"The DawgHouse"` would mean.
     The footer row link stays as well: exactly one, injected sitewide by the nav script. */
  const pages = fs.readdirSync('.').filter(x => x.endsWith('.html'));
  let covered = 0;
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    if (!html.includes('const NAV = [')) continue;
    covered++;
    assert.equal((html.match(/udh\.href = "dawghouse\.html";/g) || []).length, 1,
      `${page}: the shelf link is not in the footer row exactly once`);
    assert.equal((html.match(/label:"The DawgHouse"/g) || []).length, 0,
      `${page}: the DawgHouse became a top-level chip — it is an item under Receipts`);
    assert.equal((html.match(/label:"The Pound"/g) || []).length, 0, page);
    // no link may point at the stub (prose/comments may still name the old file)
    assert.equal((html.match(/(?:href="|href:"|\[")pound\.html/g) || []).length, 0,
      `${page} still links pound.html — the stub is not a destination`);
  }
  assert.equal(covered, 25, 'the nav page set changed');
});

test('the flipped nav is identical on every page and carries the locked order', () => {
  // ⚠️ THE FLATTENED HTML IS THE SOURCE. If two pages disagree about the menu, the site
  // disagrees with itself and nothing catches it at runtime.
  const pages = fs.readdirSync('.').filter(x => x.endsWith('.html'));
  const blocks = new Set();
  const ORDER = ['Receipts', 'Arena', 'NFL', 'CFB', 'Data', 'Dawgs'];
  let covered = 0;
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    const i = html.indexOf('  const NAV = [\n');
    if (i < 0) continue;
    covered++;
    const block = html.slice(i, html.indexOf('\n  ];', i));
    blocks.add(block);
    const labels = [...block.matchAll(/\{label:"([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(labels, ORDER, `${page}: top-level order drifted`);
    // ⚠️ operator pages stay unlinked; they run draft night from the operator machine
    assert.ok(!block.includes('"auction.html"'), `${page}: auction.html was restored to the nav`);
    assert.ok(!block.includes('"bigboard.html"'), `${page}: bigboard.html was restored to the nav`);
    assert.ok(!/\{label:"Home"/.test(block), page);   // the wordmark is already the link home

    /* Stage NB, 2026-08-10. Three rulings, asserted on the array rather than on the
       rendered bar, because the array is what 25 files have to agree about. */

    // 1. THE MODEL SCOREBOARD IS FRONT AND CENTRE. Not "somewhere in the Receipts group":
    //    first item, named for what it is. A reorder has to turn this red.
    assert.ok(block.includes('key:"receipts", items:[\n      ["receipts.html#models","Model scoreboard","receipts-models"],'),
      `${page}: the model scoreboard is not the first item in the Receipts group`);

    // 2. THE SHELF IS AN ITEM UNDER RECEIPTS, exactly once.
    //    ⚠️ The key is "pound", not "dawghouse". dawghouse.html declares data-page="pound"
    //    and the nav lights an item by `it[2] === page`, so "dawghouse" would render a
    //    dead item that never highlights and a Receipts group that never reads as active
    //    on the shelf page. Same reasoning that kept the "pound-provenance" key.
    assert.equal((block.match(/\["dawghouse\.html","The DawgHouse","pound"\],/g) || []).length, 1,
      `${page}: the shelf is not an item in the nav exactly once, keyed "pound"`);

    // 3. LEAGUE SETUP LEFT THE ARENA GROUP. It lives in the hub whose rooms it creates.
    assert.ok(!block.includes('"draft-leagues.html"'),
      `${page}: draft-leagues.html is back in the nav — it belongs to the draft hub now`);
  }
  assert.equal(covered, 25);
  assert.equal(blocks.size, 1, 'the NAV array is not identical across pages');
});

test('the draft hub owns league setup now that the menu does not', () => {
  /* ⚠️ Removing a nav item can orphan a page, and nothing at runtime notices: the file
     still exists, still renders, and is simply unreachable. draft-leagues.html carries no
     nav of its own, so it cannot even offer a way back. This asserts the two doors that
     replaced the menu entry, by BODY link and not by mention: the draft hub, and the
     Arena directory that lists what Arena contains. */
  const body = (f) => {
    const h = fs.readFileSync(f, 'utf8');
    const i = h.indexOf('<div class="dbwrap">');
    return i < 0 ? h.slice(h.indexOf('</head>')) : h.slice(i);
  };
  assert.equal((body('dashboard.html').match(/href="draft-leagues\.html"/g) || []).length, 1,
    'the draft hub does not link league setup exactly once');
  assert.match(body('dashboard.html'), /class="dbsetup" href="draft-leagues\.html">League setup/,
    'the draft hub link is not the styled header action');
  assert.ok((body('arena.html').match(/href="draft-leagues\.html"/g) || []).length >= 1,
    'arena.html stopped linking league setup');
  // and the page it points at is really there
  assert.ok(fs.existsSync('draft-leagues.html'));
  assert.ok(!fs.readFileSync('draft-leagues.html', 'utf8').includes('const NAV = ['),
    'draft-leagues.html grew a nav — the reachability argument above changes if it does');
});

test('the hubs the reorg built are in the menu, and machine values did not move', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const [href, label] of [['arena.html', 'All the games'], ['nfl.html', 'The NFL work'],
                               ['data.html', 'The Library']])
    assert.ok(html.includes(`["${href}","${label}"`), `${href} is not in the menu`);
  // ⚠️ a tier is a maturity claim, not an address. The menu changed; the stored values did not.
  assert.equal(surfaces.data.find(s => s.id === 'pound').tier, 'pound');
  assert.equal(surfaces.data.find(s => s.id === 'pound').page, '/dawghouse.html');
  assert.ok(fs.existsSync('data/pound-tools.json'));
  assert.match(html, /"pound-provenance"/, 'a historical nav key was renamed to match the menu');
  // the lifecycle section is the other half of "off-nav, not unreachable"
  assert.match(html, /<h3><a href="dawghouse\.html">The DawgHouse<\/a><\/h3>/);
});
test('DawgHouse page declares its tier and accessible result regions', () => {
  const html = fs.readFileSync('dawghouse.html', 'utf8');
  assert.match(html, /class="tierchip"[^>]*>The DawgHouse<\/a>/);
  /* CEP-5A Stage 2: the ten aria-live calculator answers moved to calculators.html;
     the CFB count line is what remains live-announced here */
  assert.ok((html.match(/aria-live="polite"/g) || []).length >= 1);
  assert.match(html, /<b>Live MCP:<\/b>/);
  /* CEP-5A 1b: the belief scoreboard renders on receipts.html now */
  const receiptsHtml = fs.readFileSync('receipts.html', 'utf8');
  assert.match(receiptsHtml, /Week 1 nfelo and 538 Classic belief scoreboard/);
  assert.doesNotMatch(html, /Week 1 nfelo and 538 Classic belief scoreboard/);
  assert.match(html, /\/data\/model-receipts\.json/);
});

/* ---- CEP-5A Stage 1a: the rename, graded ---------------------------------------- */

test('the rename did not touch stored machine values', () => {
  // Invariant 13. The human label moved; the machine key must not.
  const row = surfaces.data.find(s => s.id === 'pound');
  assert.ok(row, 'surfaces.json lost its pound row');
  assert.equal(row.tier, 'pound',
    'tier flipped — tierOf() matched "dawg" before "dawghouse" and promoted the shelf to a collar');
  assert.equal(row.page, '/dawghouse.html');
  assert.match(row.name, /DawgHouse/);
  assert.equal(surfaces.policy.tiers.pound.includes('DawgHouse'), true);
  for (const env of [tools, contracts, upstream]) assert.equal(env.tier, 'pound');
});
test('pound.html is a redirect stub, not a second copy of the page', () => {
  const html = fs.readFileSync('pound.html', 'utf8');
  assert.ok(html.length < 4000, `stub is ${html.length} B — a stub, not a page`);
  assert.match(html, /http-equiv=["']refresh["']/i);
  assert.match(html, /name="robots" content="noindex"/);
  assert.match(html, /rel="canonical" href="https:\/\/datadawgs216\.com\/dawghouse\.html"/);
  // replace() so the stub leaves no history trap, and the hash survives the hop
  assert.match(html, /location\.replace\("dawghouse\.html"\+location\.search\+location\.hash\)/);
  assert.ok(!html.includes('const NAV = ['), 'the stub must not carry the nav');
});
test('the shelf holds only blocked work; complete tools left it', () => {
  const html = fs.readFileSync('dawghouse.html', 'utf8');
  assert.match(html, /t\.status!=="complete"/,
    'the shelf filter is gone — complete tools are back on the shelf');
  assert.ok(!html.includes('<option>complete</option>'), 'the status filter still offers complete');
  assert.ok(!html.includes('<option>ready</option>'), 'the status filter still offers ready');
  assert.match(html, /The complete NFL tools left the shelf on 2026-08-09/);
  // the machine inventory keeps every row — reduction is presentation, not deletion
  assert.equal(nflTools.filter(t => t.status === 'complete').length, 14);
  assert.equal(nflTools.filter(t => t.status !== 'complete').length, 8);
});
test('the homepage lifecycle card tells the current truth', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /it goes to The DawgHouse with the reason attached/);
  assert.match(html, /The DawgHouse<\/a> is no longer empty; every tenant keeps its reason and its way back/);
  assert.ok(!html.includes('The Pound is empty today'), 'the sentence the update note falsified is back');
  assert.ok(!html.includes('Update · 2026-08-07'), 'the superseded update note survived');
});
test('the rename is recorded in Receipts as a material change', () => {
  const html = fs.readFileSync('receipts.html', 'utf8');
  assert.match(html, /<h2>Material changes<\/h2>/);
  assert.match(html, /2026-08-09 &mdash; The Pound is renamed The DawgHouse/);
  const md = fs.readFileSync(path.join('data', 'receipts-method.md'), 'utf8');
  assert.match(md, /## Material changes/);
  assert.match(md, /The Pound is renamed The DawgHouse/);
});
/* ---- CEP-5A Stage 2: the calculators leave for their own page ------------------- */

test('calculators.html holds the ten forms and claims Pup, not a collar', () => {
  const html = fs.readFileSync('calculators.html', 'utf8');
  assert.equal((html.match(/class="calc"/g) || []).length, 10);
  /* the chip is a maturity claim: complete + contract-tested is still ungraded work,
     so the page must not promote itself to a collar or keep the DawgHouse label */
  assert.match(html, /class="tierchip"[^>]*>Pup<\/a>/);
  assert.doesNotMatch(html, /class="tierchip"[^>]*>The DawgHouse<\/a>/);
  assert.ok((html.match(/aria-live="polite"/g) || []).length >= 10);
  assert.match(html, /MODELLED:/);
  assert.match(html, /live, read-only Worker tools/i);
  assert.match(html, /\/data\/model-contracts\.json/);
  assert.match(html, /<script data-page="calculators">/);
  // no shelf, no roadmap: those stayed home
  assert.ok(!html.includes('id="toolInventory"'));
  assert.ok(!html.includes('id="cfbGrid"'));
});
test('dawghouse.html no longer carries the calculator forms and forwards the deep link', () => {
  const html = fs.readFileSync('dawghouse.html', 'utf8');
  assert.equal((html.match(/class="calc"/g) || []).length, 0);
  assert.ok(!html.includes('id="oddsForm"'));
  assert.match(html, /else if\(h==="#calculators"\)location\.replace\("calculators\.html"\)/);
  // the machine box no longer lists what the page no longer holds
  assert.ok(!html.includes('<code>dd_convert_odds</code>'));
  assert.ok(!html.includes('/data/model-contracts.json'));
});
test('every shared-nav page points the Calculators item at the canonical page', () => {
  const pages = fs.readdirSync('.').filter(x => x.endsWith('.html'));
  let covered = 0;
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    if (!html.includes('const NAV = [')) continue;
    covered++;
    assert.equal((html.match(/\["calculators\.html","Calculators · NFL","calculators"\],/g) || []).length, 1, page);
    assert.equal((html.match(/dawghouse\.html#calculators/g) || []).length, 0, page);
  }
  assert.ok(covered >= 20);
});
test('the calculators surface says what the pound surface stopped claiming', () => {
  const row = surfaces.data.find(s => s.id === 'calculators');
  assert.ok(row, 'surfaces.json has no calculators row');
  assert.equal(row.page, '/calculators.html');
  assert.equal(row.tier, 'labs', 'tierOf read the wrong chip from calculators.html');
  const mcp = row.machine.filter(m => m.kind === 'mcp').map(m => m.tool).sort();
  assert.deepEqual(mcp, ['dd_calculate_bet_ev', 'dd_calculate_hedge', 'dd_convert_odds',
    'dd_devig_market', 'dd_elo_game', 'dd_nfl_passer_rating', 'dd_price_parlay',
    'dd_score_forecast', 'dd_summarize_beliefs', 'dd_translate_probability']);
  assert.ok(row.machine.some(m => m.url === '/data/model-contracts.json'));
  const pound = surfaces.data.find(s => s.id === 'pound');
  assert.ok(!pound.machine.some(m => m.kind === 'mcp' && mcp.includes(m.tool)),
    'the pound surface still claims the calculator tools');
  assert.ok(!pound.machine.some(m => m.url === '/data/model-contracts.json'),
    'the pound surface still claims the contracts file');
});
test('the inventory claims follow the forms to the new page', () => {
  for (const t of nflTools) {
    if (t.existing_website_implementation.includes('#calculators'))
      assert.fail(`${t.id} still claims a #calculators section that no longer exists`);
  }
  assert.equal(nflTools.find(t => t.id === 'odds').existing_website_implementation, '/calculators.html');
  assert.equal(nflTools.find(t => t.id === 'disagreement').existing_website_implementation,
    '/receipts.html#models + /calculators.html');
});
test('calculators.html is cached for draft night and findable by crawlers', () => {
  const sw = fs.readFileSync('sw.js', 'utf8');
  assert.match(sw, /"\/calculators\.html"/);
  const sitemap = fs.readFileSync('sitemap.xml', 'utf8');
  assert.match(sitemap, /datadawgs216\.com\/calculators\.html/);
});

test('the domain field partitions the surfaces map without changing any claim', () => {
  // CEP-5A Stage 4. `domain` is an editorial grouping so a hub can COMPUTE its cards.
  // It must not become a back door for a capability claim, so: every row has one, the
  // values are a closed set, and no row's tier, machine list or planned list depends on it.
  const allowed = new Set(['arena', 'nfl', 'cfb', 'data', 'receipts', 'site']);
  surfaces.data.forEach(r => assert.ok(allowed.has(r.domain), `${r.id}: domain ${r.domain}`));
  const arena = surfaces.data.filter(r => r.domain === 'arena').map(r => r.id).sort();
  assert.deepEqual(arena, ['bozo', 'dfs', 'guillotine', 'live-draft', 'survivor']);
  // every arena row still points at a page that exists
  arena.forEach(id => {
    const row = surfaces.data.find(r => r.id === id);
    assert.ok(fs.existsSync(row.page.replace(/^\//, '')), `${id}: ${row.page} is missing`);
  });
});

test('arena.html is a directory and claims no surface of its own', () => {
  // ⚠️ The opposite of what the pattern suggests: a hub gets NO surfaces row. A row would
  // claim a machine surface that does not exist, which is the exact overclaim CEP-5A is
  // meant to remove. It also must not pick up a collar — tierOf() reads the hero chip.
  assert.ok(!surfaces.data.some(s => s.id === 'arena'), 'arena claimed a surfaces row');
  assert.ok(!surfaces.data.some(s => s.page === '/arena.html'), 'a surfaces row points at the hub');
  const html = fs.readFileSync('arena.html', 'utf8');
  const chip = html.match(/class="tierchip[^"]*"[^>]*>([^<]+)</);
  assert.ok(chip, 'arena.html has no tier chip');
  assert.equal(chip[1].trim(), 'Pup', 'a hub is a directory, not a graded tool');
  // the card set is read from the map, never typed
  assert.match(html, /r\.domain===DOMAIN/);
  assert.ok(!/data-surface="bozo"/.test(html), 'a card id is typed into the page');
});

test('arena.html is cached for draft night and findable by crawlers', () => {
  assert.match(fs.readFileSync('sw.js', 'utf8'), /"\/arena\.html"/);
  assert.match(fs.readFileSync('sitemap.xml', 'utf8'), /datadawgs216\.com\/arena\.html/);
});

test('the collar has published criteria', () => {
  // A symbol with no criteria is an unbacked claim (CEP-5A ruling, 2026-08-09).
  const method = fs.readFileSync('data/receipts-method.md', 'utf8');
  assert.match(method, /## Tiers and the collar/);
  assert.match(method, /Working Dawg/);
  assert.match(method, /Material changes/);
  assert.match(method, /2026-08-09 — the collar becomes a symbol/);
});

test('a reference-only source is recorded and never integrated', () => {
  // CEP-5A Stage 5. upstream-models.json was the only record of what we consume and under
  // what terms, and it was missing the source we consume most carefully: a paid
  // subscription synthesized into /data/strategy.md. Its absence made the file look
  // complete when it was not.
  const etr = upstream.data.find(x => x.id === 'etr');
  assert.ok(etr, 'the provenance file does not record ETR');
  assert.equal(etr.integration_mode, 'reference-only');
  assert.equal(etr.repository, null, 'reference-only sources are not repositories');
  assert.ok(etr.homepage && /^https:\/\//.test(etr.homepage));
  assert.match(etr.data_status, /not republished/);
  assert.equal(etr.license, null);
  // and nothing on the site may fetch it
  for (const f of ['data.html', 'strategy.html', 'index.html'])
    assert.ok(!/fetch\([^)]*establishtherun/.test(fs.readFileSync(f, 'utf8')), f);
});

test('proprietary and unverified sources are never direct integrations', () => {
  upstream.data
    .filter(x => x.license_status.startsWith('unverified') || x.license_status.includes('educational')
      || x.license_status.includes('proprietary'))
    .forEach(x => assert.notEqual(x.integration_mode, 'direct', x.id));
});

test('data.html is a directory and claims no surface of its own', () => {
  assert.ok(!surfaces.data.some(s => s.page === '/data.html'), 'a surfaces row points at the hub');
  const html = fs.readFileSync('data.html', 'utf8');
  const chip = html.match(/class="tierchip[^"]*"[^>]*>([^<]+)</);
  assert.equal(chip && chip[1].trim(), 'Pup', 'a hub is a directory, not a graded tool');
  // the shelf is rendered from the manifest, never typed
  assert.match(html, /idx\.data\.files\.map/);
  assert.ok(!/data-book="pool/.test(html), 'a book id is typed into the page');
  // and it paints nothing
  assert.ok(!/<canvas/i.test(html.slice(html.indexOf('<main>'))), 'the library paints something');
});

test('data.html is cached for draft night and findable by crawlers', () => {
  assert.match(fs.readFileSync('sw.js', 'utf8'), /"\/data\.html"/);
  assert.match(fs.readFileSync('sitemap.xml', 'utf8'), /datadawgs216\.com\/data\.html/);
});

test('nfl.html is a directory and claims no surface of its own', () => {
  assert.ok(!surfaces.data.some(s => s.page === '/nfl.html'), 'a surfaces row points at the hub');
  const html = fs.readFileSync('nfl.html', 'utf8');
  const chip = html.match(/class="tierchip[^"]*"[^>]*>([^<]+)</);
  assert.equal(chip && chip[1].trim(), 'Pup', 'a hub is a directory, not a graded tool');
  // both card sets are computed, neither typed
  assert.match(html, /r\.domain===DOMAIN/);
  assert.match(html, /t\.domain===SHELF_DOMAIN/);
  assert.ok(!/data-tool="nfeloml"/.test(html), 'a blocked tool id is typed into the page');
  // ⚠️ models (belief) and scoreboard (grading) stay apart — the point of Receipts
  const body = html.slice(html.indexOf('<main>'));
  assert.ok(!/receipts\.json/.test(body) && !/model-receipts\.json/.test(body),
    'nfl.html re-hosts a receipt file');
  assert.match(body, /receipts\.html#models/);
});

test('the NFL hub and the DawgHouse shelf render the same blocked rows', () => {
  // Neither page is a copy: both read /data/pound-tools.json, so they cannot disagree.
  const blocked = nflTools.filter(t => t.domain === 'NFL' && t.status !== 'complete');
  assert.equal(blocked.length, 8, 'the blocked NFL set moved');
  blocked.forEach(t => {
    assert.ok(t.exact_blocker, `${t.id} has no exact blocker`);
    assert.ok(t.minimum_path_to_completion, `${t.id} has no minimum path`);
  });
  for (const f of ['nfl.html', 'dawghouse.html'])
    assert.match(fs.readFileSync(f, 'utf8'), /pound-tools\.json/, f);
});

test('nfl.html is cached for draft night and findable by crawlers', () => {
  assert.match(fs.readFileSync('sw.js', 'utf8'), /"\/nfl\.html"/);
  assert.match(fs.readFileSync('sitemap.xml', 'utf8'), /datadawgs216\.com\/nfl\.html/);
});

test('the under-construction component has one source, not three copies', () => {
  // Stage 4 built it once; build_data_library.py and build_nfl_hub.py SLICE it out of
  // arena.html rather than retyping it. A retyped copy is a fork waiting to happen.
  const arena = fs.readFileSync('arena.html', 'utf8');
  const i = arena.indexOf('/* CEP-5A Stage 4 — THE REUSABLE UNDER-CONSTRUCTION TREATMENT.');
  const j = arena.indexOf('\n/* Tier chips rendered FROM surfaces.json', i);
  assert.ok(i >= 0 && j > i, 'arena.html lost the component');
  const block = arena.slice(i, j);
  for (const f of ['data.html', 'nfl.html'])
    assert.ok(fs.readFileSync(f, 'utf8').includes(block), `${f} has forked the component`);
});

test('tier is DATA, not chip text — a collar cannot demote a Working Dawg', () => {
  /* ⚠️ THE BUG THIS GUARDS. tools/build-data.js tierOf() used to read a page's tier from
     its hero chip's TEXT. On 2026-08-10 the three Working Dawg chips became a COLLAR
     GLYPH with no word in it, which under the old logic reported "labs" and would have
     silently demoted dashboard, nfelo and stats in every /data/ envelope. data-tier on
     the chip TAG is now authoritative. This test re-derives the tier the same way the
     builder does and compares it against the COMMITTED data, so drift in either
     direction is red. */
  const TIERS = { labs: 'labs', dawg: 'dawg', pound: 'pound' };
  const derive = (page) => {
    let html;
    try { html = fs.readFileSync(page, 'utf8'); } catch (e) { return 'labs'; }
    const tag = html.match(/<[a-z]+[^>]*class="tierchip[^"]*"[^>]*>/);
    if (tag) {
      const a = tag[0].match(/data-tier="([a-z]+)"/);
      if (a && TIERS[a[1]]) return TIERS[a[1]];
    }
    const chip = html.match(/class="tierchip[^"]*"[^>]*>([^<]+)</);
    if (!chip) return 'labs';
    const l = chip[1].trim().toLowerCase();
    if (l.includes('dawghouse') || l.includes('pound')) return 'pound';
    if (l.startsWith('dawg')) return 'dawg';
    return 'labs';
  };

  // 1. every page carrying a chip declares its tier as an ATTRIBUTE
  const withChip = fs.readdirSync('.').filter(f => f.endsWith('.html'))
    .filter(f => /<[a-z]+[^>]*class="tierchip/.test(fs.readFileSync(f, 'utf8')));
  assert.equal(withChip.length, 10, 'the set of pages carrying a tier chip moved: ' + withChip.join(','));
  for (const f of withChip) {
    const tag = fs.readFileSync(f, 'utf8').match(/<[a-z]+[^>]*class="tierchip[^"]*"[^>]*>/);
    assert.match(tag[0], /data-tier="(labs|dawg|pound)"/, f + ' has a tier chip with no data-tier');
  }

  // 2. the three collared pages carry NO word in the chip, and still derive as dawg
  for (const f of ['dashboard.html', 'nfelo.html', 'stats.html']) {
    const html = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(html, /class="tierchip[^"]*"[^>]*>Dawg</,
      f + ' put the word back — the glyph is the collar');
    assert.match(html, /class="collar" role="img" aria-label="Working Dawg/,
      f + ' has no accessible name on its collar glyph');
    assert.equal(derive(f), 'dawg', f + ' DEMOTED — data-tier is missing or wrong');
  }

  // 3. the re-derived tier agrees with what is COMMITTED in surfaces.json.
  //    This is the assertion that turns red if data-tier is stripped from a page.
  for (const row of surfaces.data) {
    const page = row.page.replace(/^\//, '');
    if (!page || !fs.existsSync(page)) continue;
    assert.equal(row.tier, derive(page),
      'surfaces.json says ' + row.id + ' is ' + row.tier + ' but ' + page + ' now derives ' + derive(page));
  }

  /* 4. ⚠️ derive() above is a RE-IMPLEMENTATION. Without this check, reverting the real
     tierOf() in tools/build-data.js to text-only would leave this test green while every
     /data/ envelope silently demoted. Assert the builder reads the attribute, and reads
     it BEFORE the text fallback. */
  const bd = fs.readFileSync('tools/build-data.js', 'utf8');
  const fn = bd.match(/function tierOf\(page\)[\s\S]*?\n\}/);
  assert.ok(fn, 'tierOf() is gone from tools/build-data.js');
  const iAttr = fn[0].indexOf('data-tier=');
  const iText = fn[0].indexOf('>([^<]+)<');
  assert.ok(iAttr !== -1, 'tierOf() no longer reads data-tier — a collar will demote to labs');
  assert.ok(iText === -1 || iAttr < iText,
    'tierOf() reads the chip TEXT before data-tier — the collared pages will demote');
});

test('the dated 2026-08-07 tier audit keeps its original wording', () => {
  // A dated record is history, not a label. The rename must not edit it.
  const html = fs.readFileSync('receipts.html', 'utf8');
  assert.match(html, /The empty Pound is the biggest finding/);
  const audit = read('tier-audit.json');
  assert.match(audit.headline_finding, /The Pound is empty/);
});

test('the tier LABEL map is one vocabulary, not four copies drifting', () => {
  /* Stage TR, 2026-08-10. TIER_LABEL is duplicated in FOUR places: the two hub pages and
     the two Python builders that GENERATE those pages. Nothing guarded them, so patching
     arena.html without work/build_arena.py left a page that silently reverts on the next
     rebuild — the same failure mode as tier_meaning's five sources, one layer up. The
     assertion is equality across all four, not a hardcoded string, so a future relabel
     stays a one-line change and still cannot drift. */
  const SITES = ['arena.html', 'nfl.html', 'work/build_arena.py', 'work/build_nfl_hub.py'];
  const maps = SITES.map(f => {
    const m = fs.readFileSync(f, 'utf8').match(/const TIER_LABEL=\{[^}]*\};/);
    assert.ok(m, `${f} no longer declares TIER_LABEL`);
    return m[0];
  });
  for (let i = 1; i < maps.length; i++)
    assert.equal(maps[i], maps[0], `${SITES[i]} disagrees with ${SITES[0]} about the tier labels`);
  // ids are load-bearing and must survive any relabel; only the display strings may move
  for (const id of ['labs', 'dawg', 'pound'])
    assert.match(maps[0], new RegExp(`\\b${id}:"`), `TIER_LABEL lost the ${id} id`);
});

test('every worded tier chip uses a label from that map', () => {
  /* Six pages carry a worded hero chip. tierOf() reads data-tier from the TAG (05bce3b),
     so the text carries no machine meaning — which is exactly why it can rot unnoticed.
     This pins the words to the map instead of to a literal, and it is what would have
     caught a half-finished relabel. */
  const labels = [...fs.readFileSync('arena.html', 'utf8')
    .match(/const TIER_LABEL=\{([^}]*)\};/)[1]
    .matchAll(/\w+:"([^"]+)"/g)].map(m => m[1]);
  const PAGES = ['arena.html', 'data.html', 'nfl.html', 'calculators.html',
    'receipts.html', 'survivor.html', 'dawghouse.html'];
  for (const f of PAGES) {
    const chip = fs.readFileSync(f, 'utf8').match(/class="tierchip[^"]*"[^>]*>([^<]+)<\/a>/);
    assert.ok(chip, `${f} lost its hero tier chip`);
    assert.ok(labels.includes(chip[1].trim()),
      `${f} chip reads "${chip[1].trim()}", which is not in TIER_LABEL`);
  }
  // and the lifecycle section on the homepage teaches the same three words
  const home = fs.readFileSync('index.html', 'utf8');
  const lc = [...home.matchAll(/class="lc-chip[^"]*">([^<]+)</g)].map(m => m[1].trim());
  assert.equal(lc.length, 3, 'index.html#tiers no longer shows exactly three lifecycle chips');
  for (const word of lc)
    assert.ok(labels.includes(word), `index.html#tiers teaches "${word}", which is not in TIER_LABEL`);
});

console.log(`\n${pass} passed / 0 failed`);
