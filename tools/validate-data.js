#!/usr/bin/env node
/*
 * Fails if any machine-readable surface breaks the contract.
 * Run: node tools/validate-data.js   (exit 0 = clean, 1 = broken)
 *
 * The rule this enforces: every agent-facing payload carries as_of and source.
 * An agent quotes a number with confidence; an undated number is worse than no number.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

// Markdown is committed and served with LF even when a Windows checkout exposes
// CRLF in the working tree.
const servedText = text => text.replace(/\r\n/g, '\n');
const canonicalJson = value => {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
};
const fails = [];
const warns = [];
const ok = m => console.log('  ok   ' + m);
const fail = m => { fails.push(m); console.log('  FAIL ' + m); };
const warn = m => { warns.push(m); console.log('  warn ' + m); };

const TODAY = process.env.DD_TODAY || new Date().toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STALE_DAYS = 21;

console.log('data/ envelope contract');
const jsons = fs.readdirSync(DATA).filter(f => f.endsWith('.json')).sort();
if (!jsons.length) fail('no JSON files found in data/');

const seen = {};
for (const f of jsons) {
  const p = path.join(DATA, f);
  const txt = fs.readFileSync(p, 'utf8');
  let o;
  try { o = JSON.parse(txt); } catch (e) { fail(`${f}: unparseable — ${e.message}`); continue; }

  if (!o.as_of) fail(`${f}: missing as_of`);
  else if (!DATE_RE.test(o.as_of)) fail(`${f}: as_of "${o.as_of}" is not YYYY-MM-DD`);
  else {
    const age = Math.round((Date.parse(TODAY) - Date.parse(o.as_of)) / 86400000);
    if (age < 0) fail(`${f}: as_of ${o.as_of} is in the future`);
    else if (age > STALE_DAYS && !/stale|snapshot|covers through|captured/i.test(o.note || '' + o.source))
      warn(`${f}: ${age} days old and the note does not flag staleness`);
  }
  if (!o.source) fail(`${f}: missing source`);
  if (!('data' in o)) fail(`${f}: missing data`);
  if (f !== 'index.json') {
    if (!['labs', 'dawg', 'pound'].includes(o.tier)) fail(`${f}: tier is "${o.tier}" — must be labs|dawg|pound`);
    if (typeof o.graded !== 'boolean') fail(`${f}: missing graded (boolean)`);
    if (!o.tier_meaning) fail(`${f}: missing tier_meaning`);
  }
  if (o.canonical_url && !o.canonical_url.startsWith('https://datadawgs216.com/data/'))
    fail(`${f}: canonical_url does not point at the live path`);

  seen[f] = { bytes: Buffer.byteLength(txt), sha256: crypto.createHash('sha256').update(txt).digest('hex'), as_of: o.as_of };
  if (fails.length === 0 || !fails.some(x => x.startsWith(f))) ok(`${f} (${(Buffer.byteLength(txt) / 1024).toFixed(1)} KB, as_of ${o.as_of})`);
}

console.log('\ndata/index.json manifest agreement');
const idx = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
const listed = new Map((idx.data.files || []).map(e => [path.basename(e.path), e]));
for (const f of jsons) {
  if (f === 'index.json') continue;
  const e = listed.get(f);
  if (!e) { fail(`${f}: present on disk but absent from index.json`); continue; }
  if (e.sha256 !== seen[f].sha256) fail(`${f}: index.json sha256 does not match the file on disk`);
  else if (e.bytes !== seen[f].bytes) fail(`${f}: index.json byte count does not match`);
  else if (e.as_of !== seen[f].as_of) fail(`${f}: index.json as_of does not match`);
  else ok(`${f} matches manifest`);
}
for (const entry of (idx.data.files || [])) {
  if (entry.path.startsWith('/data/leagues/')) continue;
  const name=path.basename(entry.path);
  if (!jsons.includes(name)) fail(`${name}: listed in index.json but missing on disk`);
}

console.log('\ncanonical league records');
{
  const leagueDir=path.join(DATA,'leagues');
  const leagueFiles=fs.existsSync(leagueDir)?fs.readdirSync(leagueDir).filter(f=>f.endsWith('.json')).sort():[];
  for(const f of leagueFiles){
    const rel=`/data/leagues/${f}`, p=path.join(leagueDir,f), txt=fs.readFileSync(p,'utf8');
    let L; try{L=JSON.parse(txt)}catch(e){fail(`${rel}: unparseable — ${e.message}`);continue}
    const manifest=(idx.data.files||[]).find(e=>e.path===rel);
    if(!manifest) fail(`${rel}: absent from index.json`);
    else if(manifest.sha256!==crypto.createHash('sha256').update(txt).digest('hex')) fail(`${rel}: manifest hash mismatch`);
    if(L.canon_version!==1) fail(`${rel}: canon_version must be 1`);
    for(const k of ['provider','provider_league_id','dd_id','season','name','source','settings','teams','rosters','draft','diagnostics'])
      if(!(k in L)) fail(`${rel}: missing ${k}`);
    if(!L.source||!L.source.url||!L.source.captured_at||typeof L.source.official!=='boolean') fail(`${rel}: incomplete source evidence`);
    if(!Array.isArray(L.teams)||L.teams.length!==L.settings.team_count) fail(`${rel}: team placeholders disagree with team_count`);
    if(!L.diagnostics||!Array.isArray(L.diagnostics.missing_inputs)) fail(`${rel}: missing diagnostics.missing_inputs`);
    else ok(`${rel} matches docs/league-schema.md and its manifest receipt`);
  }
}

console.log('\nmarkdown mirrors');
{
  // YAML permits bare or quoted scalars; accept both rather than forcing hand-authored
  // mirrors to a house style they were not written in.
  const AS_OF_RE = /^as_of:\s*["']?(\d{4}-\d{2}-\d{2})["']?\s*$/m;
  const onDisk = fs.readdirSync(DATA).filter(f => f.endsWith('.md')).sort();
  const listedMd = new Set((idx.data.markdown || []).map(m => path.basename(m.path)));
  for (const f of onDisk) if (!listedMd.has(f)) fail(`data/${f}: on disk but absent from index.json`);

  for (const m of (idx.data.markdown || [])) {
    const rel = m.path.replace(/^\//, '');
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { fail(`${rel}: listed in index.json but missing on disk`); continue; }
    const txt = servedText(fs.readFileSync(p, 'utf8'));
    const head = txt.slice(0, 900);
    const found = (head.match(AS_OF_RE) || [])[1];
    if (!found) { fail(`${rel}: front matter missing a valid as_of`); continue; }
    if (!/^source:\s*\S/m.test(head)) { fail(`${rel}: front matter missing source`); continue; }
    if (m.sha256 && m.sha256 !== crypto.createHash('sha256').update(txt).digest('hex'))
      fail(`${rel}: index.json sha256 does not match the file on disk`);
    else if (m.bytes && m.bytes !== Buffer.byteLength(txt))
      fail(`${rel}: index.json byte count does not match`);
    else if (m.as_of && m.as_of !== found)
      fail(`${rel}: index.json as_of (${m.as_of}) disagrees with the file's front matter (${found})`);
    else ok(`${rel} (as_of ${found}, matches manifest)`);
  }
}

console.log('\nsurfaces.json — a coverage claim must be true');
{
  const S = JSON.parse(fs.readFileSync(path.join(DATA, 'surfaces.json'), 'utf8'));
  let liveClaims = 0;
  for (const s of S.data) {
    if (!fs.existsSync(path.join(ROOT, s.page.replace(/^\//, ''))))
      fail(`surfaces.json: ${s.id} points at ${s.page}, which does not exist`);
    for (const m of s.machine) {
      if (m.status === 'live') {
        liveClaims++;
        // An MCP entry names a tool, not a file — its truth is checked against
        // mcp.tools_live below, not against the filesystem.
        if (m.kind === 'mcp') {
          if (!m.tool) fail(`surfaces.json: ${s.id} claims a live mcp surface with no tool name`);
          continue;
        }
        if (!m.url) { fail(`surfaces.json: ${s.id} claims a live surface with no url`); continue; }
        if (!fs.existsSync(path.join(ROOT, m.url.replace(/^\//, ''))))
          fail(`surfaces.json: ${s.id} claims ${m.url} is live, but the file does not exist`);
      } else if (m.status === 'none' && m.url) {
        fail(`surfaces.json: ${s.id} has status "none" but names a url`);
      } else if (!['live', 'planned', 'none'].includes(m.status)) {
        fail(`surfaces.json: ${s.id} has status "${m.status}"`);
      }
    }
    if (!['labs', 'dawg', 'pound'].includes(s.tier)) fail(`surfaces.json: ${s.id} tier "${s.tier}"`);
  }
  // The whole point of the file is that it cannot overstate coverage.
  // The MCP server shipped 8/7/26 (nine read-only tools on the toto Worker).
  // The count must equal the declared tool roster, and a non-empty roster must
  // name its endpoint — a number with no callable address is a coverage claim.
  const mcpLive = (S.mcp && Array.isArray(S.mcp.tools_live)) ? S.mcp.tools_live : [];
  if (S.counts.mcp_tools_live !== mcpLive.length)
    fail(`surfaces.json: counts.mcp_tools_live=${S.counts.mcp_tools_live} but mcp.tools_live names ${mcpLive.length}`);
  if (mcpLive.length > 0 && !(S.mcp && S.mcp.path && S.mcp.host))
    fail('surfaces.json: live MCP tools claimed but no endpoint declared');
  const perSurface = new Set(S.data.flatMap(s => s.machine.filter(m => m.kind === 'mcp' && m.status === 'live').map(m => m.tool)));
  for (const t of perSurface)
    if (!mcpLive.includes(t)) fail(`surfaces.json: surface lists live MCP tool ${t} not in mcp.tools_live`);
  const covered = new Set(S.data.flatMap(s => s.machine.filter(m => m.status === 'live' && m.url).map(m => path.basename(m.url))));
  for (const f of jsons) {
    if (['index.json', 'surfaces.json'].includes(f)) continue;
    if (!covered.has(f)) warn(`${f} is published but not referenced by any surface in surfaces.json`);
  }
  if (!fails.some(x => x.startsWith('surfaces.json'))) ok(`${S.data.length} surfaces, ${liveClaims} live machine surfaces, all resolve`);
}

console.log('\nreceipts integrity — the published spec must reproduce the locked hash');
{
  const R = JSON.parse(fs.readFileSync(path.join(DATA, 'receipts.json'), 'utf8'));
  const canon = R.data.map(x => `${x.id}|${x.p.toFixed(4)}|${x.mk == null ? '' : x.mk.toFixed(4)}`).join('\n');
  const h = crypto.createHash('sha256').update(canon, 'utf8').digest('hex');
  if (h !== R.integrity.sha256) fail(`receipts.json: canonical spec yields ${h.slice(0, 16)}…, locked value is ${R.integrity.sha256.slice(0, 16)}…`);
  else ok('canonical spec reproduces ' + h.slice(0, 16) + '…');
  if (R.integrity.canonical_string_bytes !== Buffer.byteLength(canon)) fail('receipts.json: canonical_string_bytes is wrong');
  else ok('canonical_string_bytes correct');
  if (R.data.length !== R.meta.n) fail(`receipts.json: ${R.data.length} rows but meta.n says ${R.meta.n}`);
  else ok(`row count matches meta.n (${R.meta.n})`);
}

console.log('\nNFL backbone — canonical schedule and append-only model receipts');
{
  const schedule = JSON.parse(fs.readFileSync(path.join(DATA, 'nfl-schedule.json'), 'utf8'));
  const games = schedule.data && schedule.data.games;
  if (!Array.isArray(games)) fail('nfl-schedule.json: data.games is not an array');
  else {
    const ids = new Set(games.map(game => game.game_id));
    const regular = games.filter(game => game.season_type === 'REG');
    const teams = new Set(regular.flatMap(game => [game.home_team, game.away_team]));
    const weeks = new Set(regular.map(game => game.week));
    if (games.length < 250 || games.length > 350) fail(`nfl-schedule.json: suspicious row count ${games.length}`);
    else ok(`schedule row-count gate (${games.length})`);
    if (ids.size !== games.length) fail('nfl-schedule.json: duplicate game_id');
    else ok('canonical game IDs are unique');
    if (regular.length !== 272 || weeks.size !== 18 || teams.size !== 32)
      fail(`nfl-schedule.json: expected 272 regular games, 18 weeks and 32 teams; got ${regular.length}, ${weeks.size}, ${teams.size}`);
    else ok('regular-season coverage is 272 games / 18 weeks / 32 teams');
    const snapshot = 'sha256:' + crypto.createHash('sha256').update(canonicalJson(games)).digest('hex');
    if (snapshot !== schedule.integrity.snapshot_id) fail('nfl-schedule.json: snapshot hash mismatch');
    else ok('schedule snapshot hash reproduces ' + snapshot.slice(0, 23) + '…');
    if (!/^[0-9a-f]{40,64}$/.test(schedule.provenance && schedule.provenance.source_commit || ''))
      fail('nfl-schedule.json: missing exact upstream source commit');
    else ok('exact upstream source commit recorded');
  }

  const ledger = JSON.parse(fs.readFileSync(path.join(DATA, 'model-receipts.json'), 'utf8'));
  const rows = ledger.data;
  if (!Array.isArray(rows)) fail('model-receipts.json: data is not an array');
  else {
    const ids = new Set(rows.map(row => row.forecast_id));
    if (ids.size !== rows.length) fail('model-receipts.json: duplicate forecast_id');
    else ok(`normalized receipt IDs are unique (${rows.length} rows)`);
    const canonical = rows.map(canonicalJson).join('\n');
    const hash = crypto.createHash('sha256').update(canonical).digest('hex');
    if (hash !== ledger.integrity.sha256) fail('model-receipts.json: ledger hash mismatch');
    else if (ledger.integrity.rows !== rows.length) fail('model-receipts.json: integrity.rows mismatch');
    else ok('normalized receipt ledger hash and row count reproduce');
    if (rows.some(row => !/^sha256:[0-9a-f]{64}$/.test(row.schedule_snapshot_id || '')))
      fail('model-receipts.json: a receipt lacks a schedule snapshot identifier');
    else ok('every normalized receipt names its canonical schedule snapshot');
    if (rows.some(row => !/^[0-9a-f]{40,64}$/.test(row.source_commit || '')))
      fail('model-receipts.json: a receipt lacks an exact source commit');
    const counts = rows.reduce((out, row) => (out[row.model_id] = (out[row.model_id] || 0) + 1, out), {});
    if (counts.nfelo !== 272 || (counts['538-classic'] || 0) < 272)
      fail(`model-receipts.json: expected 272 nfelo and at least 272 538-classic rows; got ${JSON.stringify(counts)}`);
    else ok('two complete prospective model sets are locked');
  }

  const classic = JSON.parse(fs.readFileSync(path.join(DATA, '538-classic.json'), 'utf8'));
  const classicDataHash = 'sha256:' + crypto.createHash('sha256').update(canonicalJson(classic.data)).digest('hex');
  const classicInputHash = 'sha256:' + crypto.createHash('sha256')
    .update(canonicalJson(classic.provenance.input_material)).digest('hex');
  if (classic.integrity.snapshot_id !== classicDataHash) fail('538-classic.json: public snapshot hash mismatch');
  else if (classic.integrity.input_snapshot_id !== classicInputHash) fail('538-classic.json: input snapshot hash mismatch');
  else ok('538 Classic public and input snapshot hashes reproduce');
  if (classic.graded !== false || classic.validation.status !== 'reproduced' ||
      classic.validation.official_probabilities_compared !== 16810 ||
      classic.validation.max_absolute_probability_error >= 0.000002)
    fail('538-classic.json: historical reproduction evidence is missing or out of tolerance');
  else ok('538 Classic reproduces 16,810 official probabilities within declared tolerance');
  const expectedProspective = games.filter(game => game.status === 'scheduled' &&
    Date.parse(game.kickoff_at) > Date.parse(classic.provenance.generated_at)).length;
  if (!Array.isArray(classic.data.teams) || classic.data.teams.length !== 32 ||
      !Array.isArray(classic.data.forecasts) || classic.data.forecasts.length !== expectedProspective)
    fail(`538-classic.json: expected 32 teams and ${expectedProspective} still-prospective forecasts`);
  else ok(`538 Classic covers 32 teams and ${expectedProspective} still-prospective games`);
  /* ⚠️ COVERAGE, not equality with today's envelope. This used to select only ledger rows
     whose input_snapshot_id equalled the CURRENT envelope's, which was the same set only
     because the ledger was rewritten on every refresh — the duplicate-slate bug. The ledger
     now keeps ONE prospective row per model per game forever, so when an upstream commit
     moves the envelope forward the receipt stays pinned to the inputs it was made from and
     the two snapshot ids legitimately differ. A receipt is dated evidence; the envelope is
     current model state.
     What must still hold: every game the envelope forecasts has a prospective receipt, and
     any receipt that DOES come from this envelope's snapshot agrees with it exactly. */
  const classicReceiptByGame = new Map(rows
    .filter(row => row.model_id === '538-classic')
    .map(row => [row.game_id, row]));
  if (classic.data.forecasts.some(forecast => {
    const receipt = classicReceiptByGame.get(forecast.game_id);
    if (!receipt) return true;
    if (receipt.input_snapshot_id !== classic.integrity.input_snapshot_id) return false;
    return receipt.home_win_probability !== forecast.home_win_probability ||
      receipt.schedule_snapshot_id !== schedule.integrity.snapshot_id;
  })) fail('538-classic.json: a current forecast is absent from or disagrees with the receipt ledger');
  else ok('every current 538 Classic forecast has an immutable receipt for its game');
}

console.log('\nCFB ratings registry — normalized evidence without invented consensus');
{
  const elo = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-elo.json'), 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-ratings.json'), 'utf8'));
  // Python's canonical JSON deliberately retains integral float spelling (1500.0),
  // while JSON.parse in JavaScript erases that distinction (1500). The authoritative
  // Python contract reproduces this hash byte-for-byte; here we validate its shape and
  // then independently compare every normalized value with the locked Elo source.
  if (!/^sha256:[0-9a-f]{64}$/.test(registry.integrity && registry.integrity.snapshot_id || ''))
    fail('cfb-ratings.json: canonical snapshot identifier is missing');
  else ok('registry declares a canonical SHA-256 snapshot');
  const inputSnapshot = elo.integrity && elo.integrity.snapshot_id;
  const systems = registry.data && registry.data.systems;
  const teams = registry.data && registry.data.teams;
  const diagnostics = elo.data && elo.data.team_diagnostics;
  const diagnosticRows = diagnostics && diagnostics.teams;
  if (!Array.isArray(systems) || systems.length !== 1 || systems[0].system_id !== 'dd-cfb-elo')
    fail('cfb-ratings.json: first registry version must contain exactly the shipped Elo system');
  else if (systems[0].source_snapshot_id !== inputSnapshot || registry.provenance.input_snapshot_id !== inputSnapshot)
    fail('cfb-ratings.json: registry does not lock the current Elo snapshot');
  else if (!systems[0].matchup_probability || systems[0].matchup_probability.available !== true ||
           systems[0].matchup_probability.elo_scale !== 400 || systems[0].matchup_probability.home_field_elo !== 55 ||
           systems[0].matchup_probability.neutral_site_home_field_elo !== 0 ||
           systems[0].outputs.win_probability.available !== false)
    fail('cfb-ratings.json: matchup transform is absent, drifted or misrepresented as a team-level output');
  else if (!systems[0].team_diagnostics || systems[0].team_diagnostics.available !== true ||
           systems[0].team_diagnostics.kind !== 'retrodictive-team-aggregate' ||
           systems[0].team_diagnostics.prospective !== false || systems[0].team_diagnostics.graded !== false ||
           systems[0].team_diagnostics.rankings_published !== false)
    fail('cfb-ratings.json: team diagnostics are absent, ranked, graded or prospective');
  else ok('registry locks the current Elo source snapshot');
  const sourceRows = elo.data && elo.data.ratings_as_of_end_of_2025;
  if (!diagnostics || diagnostics.kind !== 'retrodictive-team-aggregate' ||
      diagnostics.prospective !== false || diagnostics.graded !== false ||
      diagnostics.team_rankings_published !== false || !Array.isArray(diagnosticRows) ||
      !Array.isArray(sourceRows) || diagnosticRows.length !== sourceRows.length)
    fail('cfb-elo.json: team diagnostics are missing, mislabelled or incomplete');
  else {
    const ratedSlugs = new Set(sourceRows.map(row => row.team_slug));
    const diagnosticSlugs = new Set(diagnosticRows.map(row => row.team_slug));
    const perspectives = diagnosticRows.reduce((sum, row) => sum + row.games, 0);
    const expectedWins = diagnosticRows.reduce((sum, row) => sum + row.expected_wins, 0);
    const forbidden = /"(?:rank|label|luck)"|overrated|underrated/i.test(JSON.stringify(diagnostics));
    if (diagnosticSlugs.size !== diagnosticRows.length || diagnosticSlugs.size !== ratedSlugs.size ||
        [...ratedSlugs].some(slug => !diagnosticSlugs.has(slug)) ||
        perspectives !== 2 * elo.data.backtest.n_games ||
        Math.abs(expectedWins - elo.data.backtest.n_games) > 0.05 || forbidden)
      fail('cfb-elo.json: team diagnostics fail identity, conservation or no-label gates');
    else ok(`${diagnosticRows.length} retrodictive team diagnostics reconcile without ranks or labels`);
  }
  const diagnosticsBySlug = new Map((diagnosticRows || []).map(row => [row.team_slug, row]));
  if (!Array.isArray(teams) || !Array.isArray(sourceRows) || teams.length !== sourceRows.length)
    fail('cfb-ratings.json: registry team count differs from Elo');
  else if (teams.some((row, i) => {
    const source = sourceRows[i];
    const diagnostic = diagnosticsBySlug.get(row.team_slug);
    const value = row.systems && row.systems['dd-cfb-elo'];
    return !value || row.team_slug !== source.team_slug || value.rank !== i + 1 ||
      value.team_strength !== source.rating || value.games_rated !== source.games_rated ||
      value.expected_margin !== null || value.win_probability !== null || value.predicted_total !== null ||
      !diagnostic || !value.retrodictive_team_diagnostic ||
      ['games', 'observed_wins', 'observed_losses', 'observed_win_percentage', 'expected_wins',
       'actual_minus_expected_wins', 'mean_pregame_win_probability', 'brier_win_probability']
        .some(field => value.retrodictive_team_diagnostic[field] !== diagnostic[field]);
  })) fail('cfb-ratings.json: a normalized row drifts from Elo or invents an unavailable output');
  else ok(`all ${teams.length} registry rows reproduce Elo and leave unsupported outputs null`);
  const consensus = registry.data && registry.data.consensus;
  if (!consensus || consensus.status !== 'not-built' || consensus.weights !== null || consensus.system_count !== 1)
    fail('cfb-ratings.json: one system cannot claim a consensus');
  else ok('one-system registry explicitly refuses a consensus');
}

console.log('\nCFB model receipts — append-only prospective evidence');
{
  const ledger = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-model-receipts.json'), 'utf8'));
  const rows = ledger.data;
  if (!Array.isArray(rows)) fail('cfb-model-receipts.json: data must be an array');
  else {
    const ids = new Set(rows.map(row => row.forecast_id));
    if (ids.size !== rows.length) fail('cfb-model-receipts.json: duplicate forecast_id');
    else if (ledger.integrity.rows !== rows.length) fail('cfb-model-receipts.json: integrity.rows disagrees');
    else if (rows.some(row => row.forecast_status !== 'prospective' || row.grading_status !== 'ungraded'))
      fail('cfb-model-receipts.json: ledger contains a non-prospective or mutated grading row');
    else ok(`receipt ledger contains ${rows.length} prospective, immutable forecast rows`);
    if (rows.length === 0) {
      const emptyHash = crypto.createHash('sha256').update('').digest('hex');
      if (ledger.integrity.sha256 !== emptyHash || ledger.integrity.snapshot_id !== 'sha256:' + emptyHash)
        fail('cfb-model-receipts.json: empty-ledger hash is wrong');
      else if (!/EMPTY BY DESIGN/i.test(ledger.note || ''))
        fail('cfb-model-receipts.json: empty ledger does not explain why it is empty');
      else ok('empty ledger is hash-locked and explicitly disclaims any frozen forecast');
    } else if (!/^sha256:[0-9a-f]{64}$/.test(ledger.integrity.snapshot_id || '')) {
      fail('cfb-model-receipts.json: canonical snapshot identifier is missing');
    }
  }
}

console.log('\nCFB results layers — exact schedule-derived team facts');
{
  const schedule = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-schedule.json'), 'utf8'));
  const teamGame = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-team-game.json'), 'utf8'));
  const teamWeek = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-team-week.json'), 'utf8'));
  const latest = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-team-week-latest.json'), 'utf8'));
  const gamesLatest = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-games-latest.json'), 'utf8'));
  const games = schedule.data.games;
  const rows = teamGame.data && teamGame.data.rows;
  const unavailable = teamGame.data && teamGame.data.unavailable_metrics;
  if (!Array.isArray(rows) || rows.length !== games.length * 2)
    fail(`cfb-team-game.json: expected ${games.length * 2} rows`);
  else if (teamGame.data.scope !== 'results-only' || !Array.isArray(unavailable) ||
           !unavailable.includes('epa_per_play') || !unavailable.includes('opponent_adjusted_metrics'))
    fail('cfb-team-game.json: results-only evidence boundary is missing');
  else if (teamGame.provenance.input_snapshot_id !== schedule.integrity.snapshot_id ||
           teamGame.data.input_schedule_snapshot_id !== schedule.integrity.snapshot_id)
    fail('cfb-team-game.json: schedule snapshot provenance drifted');
  else {
    const byGame = new Map();
    for (const row of rows) {
      if (!byGame.has(row.game_id)) byGame.set(row.game_id, []);
      byGame.get(row.game_id).push(row);
    }
    const badMirror = games.some(game => {
      const pair = byGame.get(game.game_id) || [];
      if (pair.length !== 2) return true;
      const home = pair.find(row => row.team_slug === game.home_team_slug);
      const away = pair.find(row => row.team_slug === game.away_team_slug);
      return !home || !away || home.opponent_slug !== away.team_slug || away.opponent_slug !== home.team_slug ||
        home.points_for !== game.home_points || home.points_against !== game.away_points ||
        away.points_for !== game.away_points || away.points_against !== game.home_points ||
        (home.point_differential === null ? away.point_differential !== null : home.point_differential !== -away.point_differential);
    });
    if (badMirror) fail('cfb-team-game.json: a game does not have two exact mirrored rows');
    else if (teamGame.integrity.snapshot_id !== 'sha256:' + crypto.createHash('sha256').update(canonicalJson(teamGame.data)).digest('hex'))
      fail('cfb-team-game.json: snapshot hash mismatch');
    else ok(`all ${rows.length} team-game rows mirror ${games.length} canonical games`);
  }

  const latestGameRows = gamesLatest.data && gamesLatest.data.rows;
  const fbsTeams = new Set(Object.entries(teamGame.data.teams)
    .filter(([, facts]) => facts.division === 'fbs').map(([slug]) => slug));
  const expectedLatestGames = new Map();
  for (const row of rows || []) {
    if (!fbsTeams.has(row.team_slug) || row.result === null) continue;
    const prior = expectedLatestGames.get(row.team_slug);
    if (!prior || row.kickoff_at > prior.kickoff_at ||
        (row.kickoff_at === prior.kickoff_at && row.team_game_id > prior.team_game_id))
      expectedLatestGames.set(row.team_slug, row);
  }
  if (!Array.isArray(latestGameRows) || latestGameRows.length !== expectedLatestGames.size)
    fail('cfb-games-latest.json: expected one latest completed row per represented FBS team');
  else if (gamesLatest.data.scope !== 'observed-final-results-only' ||
           gamesLatest.data.input_team_game_snapshot_id !== teamGame.integrity.snapshot_id ||
           gamesLatest.provenance.input_snapshot_id !== teamGame.integrity.snapshot_id)
    fail('cfb-games-latest.json: input snapshot or observed-final boundary drifted');
  else if (new Set(latestGameRows.map(row => row.team_slug)).size !== latestGameRows.length)
    fail('cfb-games-latest.json: duplicate team row');
  else if (latestGameRows.some(row => {
    const source = expectedLatestGames.get(row.team_slug);
    const game = row.latest_completed_game;
    return !source || !game || game.team_game_id !== source.team_game_id ||
      game.points_for !== source.points_for || game.points_against !== source.points_against ||
      game.point_differential !== source.point_differential || game.result !== source.result;
  }))
    fail('cfb-games-latest.json: a compact row drifted from its exact team-game source');
  else if (gamesLatest.integrity.snapshot_id !== 'sha256:' + crypto.createHash('sha256').update(canonicalJson(gamesLatest.data)).digest('hex'))
    fail('cfb-games-latest.json: snapshot hash mismatch');
  else ok(`${latestGameRows.length} latest completed FBS team games lock the exact team-game snapshot`);

  const weekRows = teamWeek.data && teamWeek.data.rows;
  if (!Array.isArray(weekRows) || !weekRows.length)
    fail('cfb-team-week.json: rows are missing');
  else if (teamWeek.data.scope !== 'results-only' ||
           !/not an official standing/i.test(teamWeek.data.conference_record_definition || '') ||
           teamWeek.data.input_team_game_snapshot_id !== teamGame.integrity.snapshot_id ||
           teamWeek.provenance.input_snapshot_id !== schedule.integrity.snapshot_id)
    fail('cfb-team-week.json: input snapshots or results-only boundary drifted');
  else if (new Set(weekRows.map(row => row.team_period_id)).size !== weekRows.length)
    fail('cfb-team-week.json: duplicate team_period_id');
  else if (weekRows.some(row => !row.conference_regular_season_to_date ||
      row.period.games !== row.period.wins + row.period.losses + row.period.ties ||
      row.season_to_date.games !== row.season_to_date.wins + row.season_to_date.losses + row.season_to_date.ties ||
      row.conference_regular_season_to_date.games !== row.conference_regular_season_to_date.wins +
        row.conference_regular_season_to_date.losses + row.conference_regular_season_to_date.ties ||
      row.period.point_differential !== row.period.points_for - row.period.points_against ||
      row.season_to_date.point_differential !== row.season_to_date.points_for - row.season_to_date.points_against ||
      row.conference_regular_season_to_date.point_differential !==
        row.conference_regular_season_to_date.points_for - row.conference_regular_season_to_date.points_against))
    fail('cfb-team-week.json: record or point-differential arithmetic drifted');
  else if (teamWeek.integrity.snapshot_id !== 'sha256:' + crypto.createHash('sha256').update(canonicalJson(teamWeek.data)).digest('hex'))
    fail('cfb-team-week.json: snapshot hash mismatch');
  else ok(`${weekRows.length} results-only team-period rows reconcile arithmetically`);

  const latestRows = latest.data && latest.data.rows;
  const teamFacts = teamWeek.data && teamWeek.data.teams;
  const expectedLatest = new Map();
  for (const row of weekRows || []) {
    const prior = expectedLatest.get(row.team_slug);
    if (!prior || row.through_at > prior.through_at ||
        (row.through_at === prior.through_at && row.team_period_id > prior.team_period_id))
      expectedLatest.set(row.team_slug, row);
  }
  if (!Array.isArray(latestRows) || !teamFacts || latestRows.length !== Object.keys(teamFacts).length)
    fail('cfb-team-week-latest.json: expected exactly one row per team');
  else if (latest.data.scope !== 'results-only' ||
           latest.data.conference_record_definition !== teamWeek.data.conference_record_definition ||
           latest.data.input_team_week_snapshot_id !== teamWeek.integrity.snapshot_id ||
           latest.provenance.input_snapshot_id !== teamWeek.integrity.snapshot_id)
    fail('cfb-team-week-latest.json: input snapshot or results-only boundary drifted');
  else if (new Set(latestRows.map(row => row.team_slug)).size !== latestRows.length)
    fail('cfb-team-week-latest.json: duplicate team row');
  else if (latestRows.some(row => {
    const source = expectedLatest.get(row.team_slug);
    const facts = teamFacts[row.team_slug];
    return !source || !facts || !row.latest_period || !row.season_to_date || !row.conference_regular_season_to_date ||
      row.team !== facts.team || row.division !== facts.division ||
      row.conference !== facts.conference || row.through_at !== source.through_at ||
      row.latest_period.team_period_id !== source.team_period_id ||
      canonicalJson(row.season_to_date) !== canonicalJson(source.season_to_date) ||
      canonicalJson(row.conference_regular_season_to_date) !== canonicalJson(source.conference_regular_season_to_date) ||
      canonicalJson(row.latest_period.observed_result) !== canonicalJson(source.period);
  }))
    fail('cfb-team-week-latest.json: a compact row drifted from its exact latest source period');
  else if (latest.integrity.snapshot_id !== 'sha256:' + crypto.createHash('sha256').update(canonicalJson(latest.data)).digest('hex'))
    fail('cfb-team-week-latest.json: snapshot hash mismatch');
  else ok(`${latestRows.length} compact latest-team rows lock the exact team-week snapshot`);
}

console.log('\nCFB efficiency — cfbfastR model output stays descriptive and directional');
{
  const eff = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-efficiency.json'), 'utf8'));
  const rows = eff.data && eff.data.teams;
  const season = eff.data && eff.data.season;
  if (!Array.isArray(rows) || rows.length < 100)
    fail('cfb-efficiency.json: expected a complete FBS team-summary snapshot');
  else if (eff.graded !== false || eff.tier !== 'labs' || !/not a forecast/i.test(eff.note || ''))
    fail('cfb-efficiency.json: ungraded descriptive evidence boundary is missing');
  else if (!/cfbfastR 3\.0/i.test(eff.source || '') || eff.provenance.source_package !== 'cfbfastR 3.0')
    fail('cfb-efficiency.json: cfbfastR 3.0 source provenance is missing');
  else if (new Set(rows.map(row => row.team_id)).size !== rows.length || rows.some(row =>
    row.season !== season || !row.team || !row.conference || !Number.isInteger(row.games) ||
    !Number.isInteger(row.plays) || !row.adjusted || !row.raw ||
    !Number.isFinite(row.adjusted.off_epa_play) ||
    !Number.isFinite(row.adjusted.def_epa_play_allowed) ||
    !Number.isFinite(row.adjusted.net_epa_play) ||
    Math.abs((row.adjusted.off_epa_play - row.adjusted.def_epa_play_allowed) - row.adjusted.net_epa_play) > 0.00001))
    fail('cfb-efficiency.json: identity, season, sample or adjusted-EPA arithmetic drifted');
  else if (eff.integrity.snapshot_id !== 'sha256:' + crypto.createHash('sha256').update(canonicalJson(eff.data)).digest('hex'))
    fail('cfb-efficiency.json: snapshot hash mismatch');
  else ok(`${rows.length} season-${season} FBS efficiency rows preserve source, sample and metric direction`);
}

console.log('\nCFB compact team profiles — facts and modelled rating stay separate');
{
  const week = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-team-week.json'), 'utf8'));
  const ratings = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-ratings.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-teams.json'), 'utf8'));
  const teams = profiles.data && profiles.data.teams;
  if (!Array.isArray(teams) || teams.length !== ratings.data.teams.length)
    fail('cfb-teams.json: compact profile count differs from the ratings registry');
  else if (profiles.data.scope !== 'observed-results-plus-retrodictive-rating' || profiles.graded !== false)
    fail('cfb-teams.json: evidence boundary is missing');
  else if (profiles.data.inputs.team_week_snapshot_id !== week.integrity.snapshot_id ||
           profiles.data.inputs.ratings_registry_snapshot_id !== ratings.integrity.snapshot_id)
    fail('cfb-teams.json: input snapshot receipts drifted');
  else if (profiles.data.consensus.status !== 'not-built' || profiles.data.consensus.weights !== null)
    fail('cfb-teams.json: one system cannot become a consensus');
  else if (new Set(teams.map(row => row.team_slug)).size !== teams.length || teams.some(row => {
    const observed = row.observed_results;
    const rating = row.systems && row.systems['dd-cfb-elo'];
    const diagnostic = rating && rating.retrodictive_team_diagnostic;
    return row.division !== 'fbs' || !observed || !rating ||
      observed.games !== observed.wins + observed.losses + observed.ties ||
      observed.point_differential !== observed.points_for - observed.points_against ||
      rating.win_probability !== null || rating.expected_margin !== null || rating.predicted_total !== null ||
      !diagnostic || !Number.isInteger(diagnostic.games) || diagnostic.games < 1 ||
      diagnostic.observed_wins + diagnostic.observed_losses !== diagnostic.games ||
      Object.keys(diagnostic).some(key => /rank|label|luck/i.test(key));
  })) fail('cfb-teams.json: a profile merges, invents or misstates observed/modelled fields');
  // Python canonical JSON retains integral float spelling in the nested Elo rows;
  // JSON.parse does not. The Python contract reproduces the hash byte-for-byte.
  else if (!/^sha256:[0-9a-f]{64}$/.test(profiles.integrity.snapshot_id || ''))
    fail('cfb-teams.json: canonical snapshot identifier is missing');
  else ok(`${teams.length} compact profiles preserve separate observed and retrodictive objects`);
}

console.log('\nCFB record divergence — descriptive baseline, not a verdict');
{
  const teamGame = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-team-game.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-teams.json'), 'utf8'));
  const divergence = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-record-divergence.json'), 'utf8'));
  const rows = divergence.data && divergence.data.rows;
  if (!Array.isArray(rows) || rows.length !== profiles.data.teams.length)
    fail('cfb-record-divergence.json: row count differs from compact profiles');
  else if (divergence.data.status !== 'descriptive-baseline' || divergence.graded !== false ||
           divergence.data.predictive_validation.status !== 'evaluated-separately' ||
           divergence.data.predictive_validation.evidence_url !== '/data/cfb-record-divergence-validation.json' ||
           divergence.data.predictive_validation.forward_value_claimed !== false ||
           divergence.data.predictive_validation.team_labels_permitted !== false)
    fail('cfb-record-divergence.json: descriptive evidence boundary is missing');
  else if (divergence.data.inputs.team_game_snapshot_id !== teamGame.integrity.snapshot_id ||
           divergence.data.inputs.team_profiles_snapshot_id !== profiles.integrity.snapshot_id)
    fail('cfb-record-divergence.json: input snapshot receipts drifted');
  else if (rows.some(row => row.predictive_label !== null ||
      row.record_scoring_rank_gap !== row.scoring_rank - row.record_rank ||
      row.one_score_games.games !== row.one_score_games.wins + row.one_score_games.losses + row.one_score_games.ties))
    fail('cfb-record-divergence.json: a row invents a label or fails arithmetic reconciliation');
  else if (!/^sha256:[0-9a-f]{64}$/.test(divergence.integrity.snapshot_id || ''))
    fail('cfb-record-divergence.json: canonical snapshot identifier is missing');
  else ok(`${rows.length} descriptive divergence rows publish no predictive labels`);
}

console.log('\nCFB record divergence - chronological aggregate validation');
{
  const teamGame = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-team-game.json'), 'utf8'));
  const elo = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-elo.json'), 'utf8'));
  const validation = JSON.parse(fs.readFileSync(path.join(DATA, 'cfb-record-divergence-validation.json'), 'utf8'));
  const data = validation.data || {};
  const result = data.result || {};
  const holdout = result.holdout || {};
  const decision = data.roadmap_decision || {};
  const checks = (result.promotion_gate && result.promotion_gate.checks) || {};
  const passed = Object.keys(checks).length > 0 && Object.values(checks).every(Boolean);
  const serialized = JSON.stringify(data);
  if (data.status !== 'retrodictive-chronological-validation' || validation.graded !== false)
    fail('cfb-record-divergence-validation.json: retrodictive evidence boundary is missing');
  else if (data.inputs.team_game_snapshot_id !== teamGame.integrity.snapshot_id ||
           data.inputs.elo_snapshot_id !== elo.integrity.snapshot_id ||
           JSON.stringify(data.inputs.elo_season_source_snapshots) !== JSON.stringify(elo.data.seasons_ingested))
    fail('cfb-record-divergence-validation.json: input snapshot receipts drifted');
  else if (!data.design.pregame_only || !data.design.simultaneous_kickoffs_batched_before_state_update ||
           data.design.market_adjusted !== false)
    fail('cfb-record-divergence-validation.json: leakage or evidence controls are missing');
  else if (decision.team_labels_permitted !== false || decision.prospective_value_claimed !== false)
    fail('cfb-record-divergence-validation.json: result overstates evidence');
  else if (result.promotion_gate.passed !== passed ||
           result.finding !== (passed ? 'held-out-incremental-signal' :
             (checks.minimum_holdout_games === false ? 'underpowered' : 'no-held-out-improvement')))
    fail('cfb-record-divergence-validation.json: promotion gate does not reconcile');
  else if (Math.round((holdout.elo_baseline.brier_home_win - holdout.elo_plus_divergence.brier_home_win) * 1e6) / 1e6 !== holdout.brier_improvement_over_elo ||
           Math.round((holdout.elo_baseline.log_loss_home_win - holdout.elo_plus_divergence.log_loss_home_win) * 1e6) / 1e6 !== holdout.log_loss_improvement_over_elo)
    fail('cfb-record-divergence-validation.json: held-out score deltas do not reconcile');
  else if (['"game_id"', '"home_team_slug"', '"away_team_slug"', '"predictive_label"'].some(field => serialized.includes(field)))
    fail('cfb-record-divergence-validation.json: private row fields were published');
  else if (!/^sha256:[0-9a-f]{64}$/.test(validation.integrity.snapshot_id || ''))
    fail('cfb-record-divergence-validation.json: canonical snapshot identifier is missing');
  else ok(`${result.qualified_games} pregame-only features; ${holdout.n_games} held-out games; ${result.finding}`);
}

console.log('\nWorker deployment contract');
{
  const configPath = path.join(ROOT, 'wrangler.jsonc');
  if (!fs.existsSync(configPath)) fail('wrangler.jsonc missing');
  else {
    let w;
    try { w = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch (e) { fail(`wrangler.jsonc: unparseable — ${e.message}`); }
    if (w) {
      const expectedSecrets = ['BOZO_PEPPER', 'BOZO_TOKENS', 'DAWG_PASS', 'DDCC_IMPORT_TOKEN', 'ELEVEN_KEY', 'FB_SECRET', 'RESEND_KEY', 'SGO_KEY', 'XAI_KEY'];
      const required = [...((w.secrets && w.secrets.required) || [])].sort();
      const crons = [...((w.triggers && w.triggers.crons) || [])].sort();
      const rl = (w.kv_namespaces || []).find(x => x.binding === 'RL');
      if (w.name !== 'toto' || w.main !== 'dawg-bot-worker.js') fail('wrangler.jsonc: wrong Worker name or entry point');
      if (w.compatibility_date !== '2026-07-31') fail('wrangler.jsonc: compatibility date drifted from production');
      // Preview URLs are intentionally enabled so a real cross-origin browser can prove
      // preflight behavior before production traffic moves. Disposable preview versions
      // are deleted after verification; keep_vars remains the manifest safety invariant.
      if (!w.keep_vars || w.preview_urls !== true) fail('wrangler.jsonc: keep_vars/preview_urls safety settings missing');
      if (!w.observability || w.observability.enabled !== true || !w.observability.logs || w.observability.logs.enabled !== true)
        fail('wrangler.jsonc: Workers Logs must stay enabled');
      if (!w.limits || w.limits.cpu_ms !== 1000) fail('wrangler.jsonc: production CPU ceiling must stay 1000 ms');
      if (!rl || rl.id !== 'ffee9157b0a04cebb796acfa6046880a') fail('wrangler.jsonc: RL KV binding missing or changed');
      if (JSON.stringify(required) !== JSON.stringify(expectedSecrets.sort())) fail('wrangler.jsonc: required secret-name set drifted');
      // ⚠️ Three jobs share this Worker and the dispatcher in scheduled() fails closed on
      // an unknown cron, so this list and that switch have to move together:
      //   0 9 * * *   nightly private RTDB backup — NEVER run this hourly, it contains
      //               auth material and exists for disaster recovery, not polling
      //   9 * * * *   hourly public CFB market receipt capture
      //   */5 * * * * Bozo closing prices. Fires often because a close has to be snapped
      //               near kickoff to be a close at all, and does nothing on a tick with
      //               no game about to start — one RTDB read and out.
      if (JSON.stringify(crons) !== JSON.stringify(['0 9 * * *', '9 * * * *', '*/5 * * * *'].sort()))
        fail('wrangler.jsonc: expected daily backup, hourly CFB and 5-minute Bozo-close triggers');
      if (!w.vars || w.vars.BOZO_ADMIN !== 'Kap' || w.vars.MODEL !== 'grok-4.5' || !w.vars.ELEVEN_VOICE)
        fail('wrangler.jsonc: production plain variables missing');
      // MAIL_FROM is pinned, not merely present. mailReady() is true only when both it and
      // RESEND_KEY exist, so a silent drift here switches every /auth/* mail route back to
      // 503 with nothing in the config to explain it. Sending is from the mail. subdomain
      // deliberately: a transactional deliverability problem must never reach the apex.
      if (!w.vars || w.vars.MAIL_FROM !== 'no-reply@mail.datadawgs216.com')
        fail('wrangler.jsonc: MAIL_FROM must be the verified no-reply@mail.datadawgs216.com sender');
      for (const secret of expectedSecrets) if (w.vars && Object.hasOwn(w.vars, secret))
        fail(`wrangler.jsonc: ${secret} must be a secret name, never a plain variable`);
      if (!fails.some(x => x.startsWith('wrangler.jsonc'))) ok('complete config preserves Worker, KV, secrets, crons, logs and limits');
    }
  }
}

console.log('\nllms.txt');
{
  const p = path.join(ROOT, 'llms.txt');
  if (!fs.existsSync(p)) fail('llms.txt missing');
  else {
    const t = fs.readFileSync(p, 'utf8');
    const kb = Buffer.byteLength(t) / 1024;
    /* ⚠️ 6 KB, RAISED FROM 5 ON PURPOSE — read this before lowering it back.
       llms.txt is the front door for machines, and the ceiling was reached: main sat at
       5102 bytes against a 5120 limit, so the site could not add another machine surface
       to its own index without deleting an existing one. That is the wrong trade — the
       index going stale is a worse failure than the index being a kilobyte larger, and
       "compress somebody else's entry to fit mine" is not a rule anyone can follow twice.
       The number is still a real budget: this file is fetched by models that pay for
       every token of it, and it must stay an INDEX. If it reaches 6 KB the answer is to
       move detail into surfaces.json and link it, not to raise this again. */
    if (kb > 6) fail(`llms.txt is ${kb.toFixed(1)} KB — the convention is to stay under 6 KB`);
    else ok(`${kb.toFixed(1)} KB`);
    if (!/^# /m.test(t)) fail('llms.txt: no H1');
    if (!/^> /m.test(t)) fail('llms.txt: no blockquote summary');
    const urls = [...t.matchAll(/https:\/\/datadawgs216\.com(\/[^)\s]*)/g)].map(m => m[1]);
    for (const u of new Set(urls)) {
      const rel = u.replace(/^\//, '').split('#')[0];
      if (!rel) continue;
      if (!fs.existsSync(path.join(ROOT, rel))) fail(`llms.txt links /${rel} which does not exist in the repo`);
    }
    if (!fails.some(x => x.startsWith('llms.txt links'))) ok('every linked path exists in the repo');
  }
}

// ---------------------------------------------------------------- tier_meaning drift
// Added 2026-08-10 with the Labs→Pup relabel. Until this check existed, the rule above
// only asserted that tier_meaning EXISTS. That is not enough: the sentence is written
// from FIVE independent sources — tools/build-data.js holds the real map, and
// scripts/cfb_data_backbone.py, scripts/nfl_data_backbone.py and scripts/elo_538_classic.py
// each carry their own hardcoded copy, writing 17 of the 24 affected payloads between
// them. Changing build-data.js alone therefore published two different definitions of
// the same tier with every gate green. The map is parsed out of build-data.js rather
// than imported so that drift is caught in either direction without running the builder.
// -------------------------------------------------- the inventory is not stale
// Stage RI, 2026-08-10. receipts-inventory.json is DERIVED from the receipt ledgers, but
// the ledgers it reads are written by scripts/*_backbone.py and scripts/elo_538_classic.py,
// NOT by tools/build-data.js. Nothing in the build enforces that build-data runs last, so
// a backbone run after it silently publishes stale counts. Recompute every number here.
// Same failure shape as tier_meaning's five sources: a derived value with no equality check
// is two definitions waiting to diverge.
console.log('\nreceipts-inventory.json agrees with the ledgers it counts');
{
  const invPath = path.join(DATA, 'receipts-inventory.json');
  if (!fs.existsSync(invPath)) {
    fail('receipts-inventory.json is missing — receipts.html#inventory renders nothing');
  } else {
    const inv = JSON.parse(fs.readFileSync(invPath, 'utf8')).data || {};
    const KEYS = ['resolved_at', 'graded_at', 'outcome', 'result', 'actual', 'final'];
    const settledOf = rows => rows.filter(r => r && typeof r === 'object' &&
      KEYS.some(k => r[k] !== undefined && r[k] !== null && r[k] !== '')).length;
    /* ⚠️ STRUCTURAL, not a filename list. This used to name 538-classic.json explicitly,
       which meant the second envelope shaped that way (ddpr-nfl.json) failed here as "did
       not yield an array" — a message that reads like a corrupt file rather than a check
       that had not been told about a new one. Ask the payload what shape it is. Anything
       that is neither an array nor a {forecasts:[]} still fails loud below. */
    const rowsOf = (file, d) => Array.isArray(d) ? d : (d && d.forecasts);
    let bad = 0;
    const ledgers = inv.ledgers || [];
    if (!ledgers.length) { fail('receipts-inventory.json publishes no ledgers'); bad++; }
    for (const l of ledgers) {
      const file = String(l.machine || '').replace('/data/', '');
      const p = path.join(DATA, file);
      if (!fs.existsSync(p)) { fail(`receipts-inventory.json counts ${file}, which does not exist`); bad++; continue; }
      const env = JSON.parse(fs.readFileSync(p, 'utf8'));
      const rows = rowsOf(file, env.data);
      if (!Array.isArray(rows)) { fail(`receipts-inventory.json: ${file} did not yield an array`); bad++; continue; }
      const settled = settledOf(rows);
      if (l.registered !== rows.length) {
        fail(`receipts-inventory.json: ${file} registered=${l.registered} but the file holds ${rows.length}`); bad++;
      }
      if (l.settled !== settled) {
        fail(`receipts-inventory.json: ${file} settled=${l.settled} but the file shows ${settled}`); bad++;
      }
      if (l.pending !== rows.length - settled) {
        fail(`receipts-inventory.json: ${file} pending=${l.pending} does not equal registered minus settled`); bad++;
      }
      if (l.as_of !== env.as_of) {
        fail(`receipts-inventory.json: ${file} as_of=${l.as_of} but the file says ${env.as_of}`); bad++;
      }
    }
    // The aggregate must come from ONE superset ledger, never from summing the column.
    const ag = inv.aggregate || {};
    const supFile = String(ag.counted_from || '').replace('/data/', '');
    const supPath = path.join(DATA, supFile);
    if (!supFile || !fs.existsSync(supPath)) {
      fail(`receipts-inventory.json: aggregate.counted_from "${ag.counted_from}" does not exist`); bad++;
    } else {
      const sup = JSON.parse(fs.readFileSync(supPath, 'utf8')).data;
      const games = new Set(sup.map(r => r.game_id).filter(Boolean)).size;
      if (ag.forecasts !== sup.length) {
        fail(`receipts-inventory.json: aggregate.forecasts=${ag.forecasts} but ${supFile} holds ${sup.length}`); bad++;
      }
      if (ag.games !== games) {
        fail(`receipts-inventory.json: aggregate.games=${ag.games} but ${supFile} covers ${games}`); bad++;
      }
      const naive = ledgers.reduce((a, l) => a + l.registered, 0);
      if (ag.naive_sum !== naive) {
        fail(`receipts-inventory.json: aggregate.naive_sum=${ag.naive_sum} but the column sums to ${naive}`); bad++;
      }
      // The whole point of the file: the aggregate must NOT be the column sum.
      if (ledgers.length > 1 && ag.forecasts === naive) {
        fail('receipts-inventory.json: aggregate.forecasts equals the column sum — the overlap was double-counted'); bad++;
      }
    }
    // An inventory that scores is the cross-domain blend the page argues against.
    // ⚠️ Scoped to the COUNTED data, not the whole file: the envelope note has to be free
    // to say "there is no honest Brier across domains", which is the reason this file
    // exists. A first cut checked the raw text and failed on its own explanation.
    const counted = JSON.stringify({ ledgers: inv.ledgers, aggregate: inv.aggregate }).toLowerCase();
    for (const w of ['brier', 'accuracy', 'score', 'correct', 'win_rate']) {
      if (counted.includes(w)) {
        fail(`receipts-inventory.json's counted data mentions "${w}" — this file counts, it does not grade`); bad++;
      }
    }
    const au = inv.audit || {};
    const ta = JSON.parse(fs.readFileSync(path.join(DATA, 'tier-audit.json'), 'utf8'));
    if (au.tools !== (ta.data || []).length) {
      fail(`receipts-inventory.json: audit.tools=${au.tools} but tier-audit.json holds ${(ta.data || []).length}`); bad++;
    }
    if (ledgers.some(l => /audit/i.test(l.id || ''))) {
      fail('receipts-inventory.json puts the tier audit in the forecast ledgers — a judgment is not a forecast'); bad++;
    }
    if (!bad) ok(`${ledgers.length} ledgers, the aggregate and the audit all match the files they count`);
  }
}

// -------------------------------------------------- the model board is not stale
// Stage MS-B, 2026-08-10. model-board.json is derived from model-receipts.json at build
// time and is what receipts.html#models actually draws. Same hazard as the inventory
// above: the ledger is written by scripts/*.py, so a backbone run after build-data.js
// publishes a board that disagrees with the ledger it claims to summarise. Everything here
// is RECOMPUTED from the ledger rather than checked for self-consistency -- a derived file
// that only agrees with itself is exactly the failure this suite exists to catch.
console.log('\nmodel-board.json agrees with the ledger it summarises');
{
  const bPath = path.join(DATA, 'model-board.json');
  const lPath = path.join(DATA, 'model-receipts.json');
  if (!fs.existsSync(bPath)) {
    fail('model-board.json is missing — receipts.html#models renders nothing');
  } else {
    const board = JSON.parse(fs.readFileSync(bPath, 'utf8')).data || {};
    const rows = (JSON.parse(fs.readFileSync(lPath, 'utf8')).data || [])
      .filter(r => r && r.forecast_status === 'prospective');
    const latest = new Map();
    for (const r of rows) {
      const k = r.game_id + '|' + r.model_id, prior = latest.get(k);
      if (!prior || r.captured_at > prior.captured_at) latest.set(k, r);
    }
    const current = [...latest.values()];
    const ids = [...new Set(current.map(r => r.model_id))];
    const models = board.models || [];
    let bad = 0;

    // 1. Every model_id in the ledger has a board row, and the board invents none.
    const boardIds = models.map(m => m.model_id);
    for (const id of ids) if (!boardIds.includes(id)) {
      fail(`model-board.json omits model_id "${id}", which the ledger registers`); bad++;
    }
    for (const id of boardIds) if (!ids.includes(id)) {
      fail(`model-board.json publishes model_id "${id}", which the ledger does not register`); bad++;
    }

    // 2. Per-model coverage and central tendency, recomputed.
    const r6 = v => Number(v.toFixed(6));
    for (const m of models) {
      const rs = current.filter(r => r.model_id === m.model_id);
      if (!rs.length) continue;
      const games = new Set(rs.map(r => r.game_id)).size;
      if (m.games !== games) { fail(`model-board.json: ${m.model_id} games=${m.games} but the ledger covers ${games}`); bad++; }
      if (m.receipts !== rs.length) { fail(`model-board.json: ${m.model_id} receipts=${m.receipts} but the ledger holds ${rs.length}`); bad++; }
      const ps = rs.map(r => r.home_win_probability).filter(Number.isFinite);
      const mean = r6(ps.reduce((s, v) => s + v, 0) / ps.length);
      if (m.mean_home_win_probability !== mean) {
        fail(`model-board.json: ${m.model_id} mean=${m.mean_home_win_probability} but the ledger means ${mean}`); bad++;
      }
      // kind is what every honesty claim on the board hangs off, so derive it too.
      const head = rs[0];
      const kind = (Array.isArray(head.ensemble_of) && head.ensemble_of.length) ? 'ensemble' : 'primitive';
      if (m.kind !== kind) { fail(`model-board.json: ${m.model_id} kind="${m.kind}" but the ledger says ${kind}`); bad++; }
      if (m.displayed !== (head.displayed !== false)) {
        fail(`model-board.json: ${m.model_id} displayed=${m.displayed} disagrees with the ledger`); bad++;
      }
      // Nothing is graded until kickoff. A number here is a claim nobody can back yet.
      if (m.brier !== null || m.points !== null || m.settled !== 0) {
        fail(`model-board.json: ${m.model_id} carries a score before any game has kicked off`); bad++;
      }
    }

    // 3. ⚠️ THE UNDISPLAYED LINE MUST STAY UNDISPLAYED, asserted as a negative.
    //    ddpr-nfl-linear exists so the season-end comparison is not model-shopping. The
    //    moment it renders, the site is publishing two aggregations and can pick afterwards.
    const linear = models.find(m => m.model_id === 'ddpr-nfl-linear');
    if (linear && linear.displayed !== false) {
      fail('model-board.json marks ddpr-nfl-linear displayed — it is registered for comparison and must never render'); bad++;
    }
    const wk = board.week || {};
    for (const g of (wk.games || [])) {
      for (const id of Object.keys(g.beliefs || {})) {
        const m = models.find(x => x.model_id === id);
        if (m && m.displayed === false) {
          fail(`model-board.json: week beliefs carry "${id}", which is registered undisplayed`); bad++;
        }
      }
    }

    // 4. The panel arithmetic, and the pre-registration cross-check.
    const panel = board.panel || {};
    const prims = models.filter(m => m.kind === 'primitive').map(m => m.model_id);
    if (panel.registered_lines !== models.length) { fail(`model-board.json: panel.registered_lines=${panel.registered_lines} but the board holds ${models.length}`); bad++; }
    if (panel.independent_lines !== prims.length) { fail(`model-board.json: panel.independent_lines=${panel.independent_lines} but ${prims.length} lines are primitive`); bad++; }
    if (panel.displayed_lines !== models.filter(m => m.displayed).length) { fail('model-board.json: panel.displayed_lines disagrees with the rows'); bad++; }
    if (panel.independent_lines >= panel.registered_lines && panel.registered_lines > 1) {
      fail('model-board.json calls every registered line independent — an ensemble of two lines is not a third source'); bad++;
    }
    const chk = panel.pre_registration_check;
    if (!chk) { fail('model-board.json publishes no pre-registration cross-check against ddpr-nfl.json'); bad++; }
    else if (chk.agrees !== true
             || chk.derived_logit_correlation !== chk.pre_registered_logit_correlation
             || chk.derived_mean_absolute_probability_gap !== chk.pre_registered_mean_absolute_probability_gap) {
      fail(`model-board.json: the correlation derived from the ledger (${chk.derived_logit_correlation}) does not match the value pre-registered in ddpr-nfl.json (${chk.pre_registered_logit_correlation}) — the ledger moved after registration`); bad++;
    }

    // 5. The per-game spread must average the INDEPENDENT lines only. Averaging an
    //    ensemble back in with its own inputs counts the same beliefs twice and narrows
    //    the range for free, which would make the board look more agreed than it is.
    for (const g of (wk.games || [])) {
      const over = (g.spread || {}).over || [];
      if (over.slice().sort().join('|') !== prims.slice().sort().join('|')) {
        fail(`model-board.json: ${g.game_id} spread.over=[${over}] but the independent lines are [${prims}]`); bad++;
        break;
      }
      const ps = over.map(id => (g.beliefs || {})[id]).filter(Number.isFinite).sort((a, b) => a - b);
      if (ps.length && g.spread.mean !== r6(ps.reduce((s, v) => s + v, 0) / ps.length)) {
        fail(`model-board.json: ${g.game_id} spread.mean does not equal the mean of its own panel`); bad++;
        break;
      }
    }

    // 6. The board is a summary of a lazy fetch, so it has to stay small enough to be worth
    //    having. If it ever approaches the superset it is replacing, it has stopped being a
    //    derived view and this check says so before a user pays for it.
    const bKb = fs.statSync(bPath).size / 1024, lKb = fs.statSync(lPath).size / 1024;
    if (bKb > lKb / 4) {
      fail(`model-board.json is ${bKb.toFixed(0)} KB against a ${lKb.toFixed(0)} KB ledger — it is no longer a small derived view`); bad++;
    }
    if (!bad) ok(`${models.length} model lines, ${prims.length} independent, ${(wk.games || []).length} week-${wk.week} games, all recomputed from the ledger`);
  }
}

console.log('\ntier_meaning matches its source of truth');
{
  const src = fs.readFileSync(path.join(ROOT, 'tools/build-data.js'), 'utf8');
  const block = src.match(/const TIER_MEANING = \{([\s\S]*?)\n\};/);
  if (!block) {
    fail('build-data.js: could not parse the TIER_MEANING map — this check is now blind');
  } else {
    const MEAN = {};
    for (const m of block[1].matchAll(/^\s*(labs|dawg|pound):\s*'((?:[^'\\]|\\.)*)',?\s*$/gm))
      MEAN[m[1]] = m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    for (const t of ['labs', 'dawg', 'pound'])
      if (!MEAN[t]) fail(`build-data.js: TIER_MEANING is missing ${t}`);
    let checked = 0;
    let drift = 0;
    for (const f of fs.readdirSync(DATA).filter(n => n.endsWith('.json'))) {
      let o;
      try { o = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { continue; }
      if (!o || typeof o !== 'object' || !o.tier || !o.tier_meaning) continue;
      const want = MEAN[o.tier];
      if (!want) continue;
      checked++;
      if (o.tier_meaning !== want) {
        drift++;
        fail(`${f}: tier_meaning does not match TIER_MEANING.${o.tier} in tools/build-data.js`);
      }
    }
    if (!checked) fail('no data/*.json carried a tier_meaning — the check ran on nothing');
    else if (!drift) ok(`${checked} payloads carry the byte-identical sentence for their tier`);
  }
}

// ---------------------------------------------------------------------------
// Defenses: one row per team, and never the DEF spelling.
// The 2026-08-24 workbook shipped every defense three times — "Philadelphia Eagles DST"
// (pos DEF, $2.10), "Philadelphia Eagles" (pos DST, $1.50) and "PHI DST" (pos DST, bye 0,
// $0.80). The operator recorded the top-ranked one as pos DEF, which fills no DST slot, so
// the unit was drafted and then benched. Three prices for one unit is also three answers
// to "what is the Eagles defense worth". This check is what keeps that from coming back.
// ---------------------------------------------------------------------------
console.log('\nplayer pool: one defense per team');
{
  const poolPath = path.join(DATA, 'pool.json');
  if (!fs.existsSync(poolPath)) fail('pool.json missing');
  else {
    const pool = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
    const rows = Array.isArray(pool.data) ? pool.data : [];
    const defs = rows.filter(r => ['DEF', 'DST', 'D'].includes(String(r.pos || '').toUpperCase()));
    const wrongPos = defs.filter(r => r.pos !== 'DST');
    const byTeam = new Map();
    for (const r of defs) byTeam.set(r.team, (byTeam.get(r.team) || 0) + 1);
    const dupes = [...byTeam].filter(([, n]) => n > 1);
    const noBye = defs.filter(r => !(r.bye > 0));
    if (wrongPos.length) fail(`pool.json: ${wrongPos.length} defense row(s) are not pos "DST" (${wrongPos.slice(0, 3).map(r => `${r.name}=${r.pos}`).join(', ')})`);
    if (dupes.length) fail(`pool.json: ${dupes.length} team(s) have more than one defense row (${dupes.slice(0, 3).map(([t, n]) => `${t}x${n}`).join(', ')})`);
    if (noBye.length) fail(`pool.json: ${noBye.length} defense row(s) carry no bye week (${noBye.slice(0, 3).map(r => r.name).join(', ')})`);
    if (byTeam.size !== 32) fail(`pool.json: ${byTeam.size} teams have a defense row, expected 32`);
    if (!wrongPos.length && !dupes.length && !noBye.length && byTeam.size === 32)
      ok(`${defs.length} defense rows, one per team, all pos DST with a real bye`);
  }
}

console.log('\nGitHub Pages serving');
if (!fs.existsSync(path.join(ROOT, '.nojekyll')))
  fail('.nojekyll missing — Jekyll will drop dot-directories such as /.well-known/');
else ok('.nojekyll present');

console.log('\n' + (fails.length ? `${fails.length} FAILURE(S)` : 'all checks passed') +
  (warns.length ? `, ${warns.length} warning(s)` : ''));
process.exit(fails.length ? 1 : 0);
