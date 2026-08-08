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
for (const name of listed.keys()) if (!jsons.includes(name)) fail(`${name}: listed in index.json but missing on disk`);

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
  const currentClassicReceipts = new Map(rows
    .filter(row => row.model_id === '538-classic' && row.input_snapshot_id === classic.integrity.input_snapshot_id)
    .map(row => [row.game_id, row]));
  if (classic.data.forecasts.some(forecast => {
    const receipt = currentClassicReceipts.get(forecast.game_id);
    return !receipt || receipt.home_win_probability !== forecast.home_win_probability ||
      receipt.schedule_snapshot_id !== schedule.integrity.snapshot_id;
  })) fail('538-classic.json: a current forecast is absent from or disagrees with the receipt ledger');
  else ok('every current 538 Classic forecast has a matching immutable receipt');
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
  if (!Array.isArray(systems) || systems.length !== 1 || systems[0].system_id !== 'dd-cfb-elo')
    fail('cfb-ratings.json: first registry version must contain exactly the shipped Elo system');
  else if (systems[0].source_snapshot_id !== inputSnapshot || registry.provenance.input_snapshot_id !== inputSnapshot)
    fail('cfb-ratings.json: registry does not lock the current Elo snapshot');
  else ok('registry locks the current Elo source snapshot');
  const sourceRows = elo.data && elo.data.ratings_as_of_end_of_2025;
  if (!Array.isArray(teams) || !Array.isArray(sourceRows) || teams.length !== sourceRows.length)
    fail('cfb-ratings.json: registry team count differs from Elo');
  else if (teams.some((row, i) => {
    const source = sourceRows[i];
    const value = row.systems && row.systems['dd-cfb-elo'];
    return !value || row.team_slug !== source.team_slug || value.rank !== i + 1 ||
      value.team_strength !== source.rating || value.games_rated !== source.games_rated ||
      value.expected_margin !== null || value.win_probability !== null || value.predicted_total !== null;
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

console.log('\nWorker deployment contract');
{
  const configPath = path.join(ROOT, 'wrangler.jsonc');
  if (!fs.existsSync(configPath)) fail('wrangler.jsonc missing');
  else {
    let w;
    try { w = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch (e) { fail(`wrangler.jsonc: unparseable — ${e.message}`); }
    if (w) {
      const expectedSecrets = ['BOZO_PEPPER', 'BOZO_TOKENS', 'DAWG_PASS', 'ELEVEN_KEY', 'FB_SECRET', 'SGO_KEY', 'XAI_KEY'];
      const required = [...((w.secrets && w.secrets.required) || [])].sort();
      const crons = [...((w.triggers && w.triggers.crons) || [])].sort();
      const rl = (w.kv_namespaces || []).find(x => x.binding === 'RL');
      if (w.name !== 'toto' || w.main !== 'dawg-bot-worker.js') fail('wrangler.jsonc: wrong Worker name or entry point');
      if (w.compatibility_date !== '2026-07-31') fail('wrangler.jsonc: compatibility date drifted from production');
      if (!w.keep_vars || w.preview_urls !== false) fail('wrangler.jsonc: keep_vars/preview_urls safety settings missing');
      if (!w.observability || w.observability.enabled !== true || !w.observability.logs || w.observability.logs.enabled !== true)
        fail('wrangler.jsonc: Workers Logs must stay enabled');
      if (!w.limits || w.limits.cpu_ms !== 1000) fail('wrangler.jsonc: production CPU ceiling must stay 1000 ms');
      if (!rl || rl.id !== 'ffee9157b0a04cebb796acfa6046880a') fail('wrangler.jsonc: RL KV binding missing or changed');
      if (JSON.stringify(required) !== JSON.stringify(expectedSecrets.sort())) fail('wrangler.jsonc: required secret-name set drifted');
      if (JSON.stringify(crons) !== JSON.stringify(['0 9 * * *', '9 * * * *'].sort()))
        fail('wrangler.jsonc: expected daily backup and hourly CFB triggers');
      if (!w.vars || w.vars.BOZO_ADMIN !== 'Kap' || w.vars.MODEL !== 'grok-4.5' || !w.vars.ELEVEN_VOICE)
        fail('wrangler.jsonc: production plain variables missing');
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
    if (kb > 5) fail(`llms.txt is ${kb.toFixed(1)} KB — the convention is to stay under 5 KB`);
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

console.log('\nGitHub Pages serving');
if (!fs.existsSync(path.join(ROOT, '.nojekyll')))
  fail('.nojekyll missing — Jekyll will drop dot-directories such as /.well-known/');
else ok('.nojekyll present');

console.log('\n' + (fails.length ? `${fails.length} FAILURE(S)` : 'all checks passed') +
  (warns.length ? `, ${warns.length} warning(s)` : ''));
process.exit(fails.length ? 1 : 0);
