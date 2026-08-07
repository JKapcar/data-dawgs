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
test('inventory uses only declared statuses', () => {
  const allowed = new Set(['ready', 'frontend-only', 'backend-blocked', 'data-blocked', 'complete']);
  assert.ok(tools.data.length >= 20);
  tools.data.forEach(t => assert.ok(allowed.has(t.status), `${t.id}: ${t.status}`));
});
test('every incomplete tool names a distinct blocker and minimum path', () => {
  tools.data.filter(t => t.status !== 'complete').forEach(t => {
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
  assert.deepEqual(contracts.data.forecast_status_values, ['backtest', 'prospective']);
  assert.match(contracts.data.calculator_contracts.normal_translation.formula, /inverse_standard_normal/);
  assert.match(contracts.data.calculator_contracts.normal_translation.formula, /0\.5/);
  assert.equal(contracts.data.calculator_contracts.elo_game.mcp_tool, 'dd_elo_game');
  assert.equal(contracts.data.calculator_contracts.normal_translation.mcp_tool, 'dd_translate_probability');
  assert.match(contracts.data.calculator_contracts.belief_summary.note, /not a validated consensus blend/i);
});
test('surface generator reports the deployed Pound MCP tools as live', () => {
  const poundMcp = ['dd_convert_odds', 'dd_devig_market', 'dd_price_parlay',
    'dd_calculate_bet_ev', 'dd_calculate_hedge', 'dd_nfl_passer_rating',
    'dd_score_forecast', 'dd_summarize_beliefs', 'dd_elo_game',
    'dd_translate_probability'];
  assert.equal(surfaces.counts.mcp_tools_live, 23);
  assert.equal(surfaces.counts.mcp_tools_staged, 0);
  assert.ok(surfaces.mcp.tools_live.includes('dd_survivor_ev'));
  assert.ok(surfaces.mcp.tools_live.includes('dd_analyze_matchup'));
  poundMcp.forEach(name => assert.ok(surfaces.mcp.tools_live.includes(name), name));
  assert.deepEqual(surfaces.mcp.tools_staged, []);
});
test('deployed Pound tools name live MCP implementations without staged claims', () => {
  const ids = new Set(['disagreement', '538-classic', 'translation', 'market', 'cover-ev', 'odds', 'parlay', 'hedge', 'passer', 'grader']);
  const deployed = tools.data.filter(t => ids.has(t.id));
  assert.equal(deployed.length, 10);
  deployed.forEach(t => {
    assert.equal(t.status, 'complete');
    assert.match(t.existing_worker_mcp_implementation, /^dd_/);
    assert.equal(t.staged_worker_mcp_implementation, null);
    assert.equal(t.exact_blocker, null);
  });
  assert.equal(contracts.data.contract_version, '1.2.0');
  assert.equal(contracts.data.calculator_contracts.odds_converter.mcp_tool, 'dd_convert_odds');
});
test('new data surfaces are in the generated manifest', () => {
  const paths = new Set(index.data.files.map(x => x.path));
  for (const p of ['/data/pound-tools.json', '/data/model-contracts.json', '/data/upstream-models.json']) assert.ok(paths.has(p), p);
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
});

console.log(`\n${pass} passed / 0 failed`);
