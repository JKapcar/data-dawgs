/* /data/epa-players.json — the per-player EPA surface.

   ⚠️ WHAT THIS SUITE IS REALLY FOR. The file is easy to overstate. It aggregates by the
   PRIMARY BALL HANDLER, because the play-by-play snapshot carries exactly one name per
   play — the passer on a dropback, the carrier on a rush. There is no receiver on any
   row. A file called "epa-players" that did not shout about that would read as complete
   player EPA, which it is not and cannot be from this source.

   So the assertions below check the honesty fields as hard as they check the arithmetic,
   and one of them recomputes a player's numbers straight from stats.html rather than
   trusting the builder that wrote them.

   Run: node work/test-epa-players.js      (from the repo root)
*/
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('ok  ' + name); };
const env = JSON.parse(fs.readFileSync(path.join('data', 'epa-players.json'), 'utf8'));
const teamsEnv = JSON.parse(fs.readFileSync(path.join('data', 'epa-teams.json'), 'utf8'));
const surfaces = JSON.parse(fs.readFileSync(path.join('data', 'surfaces.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join('data', 'index.json'), 'utf8'));
const D = env.data;
const allRows = [...Object.values(D.by_season).flat(), ...D.pooled];

test('the /data/ envelope contract holds', () => {
  assert.match(env.as_of, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(env.source && env.note && env.canonical_url && env.built);
  assert.equal(env.graded, false);
  assert.equal(env.source_page, '/stats.html');
  // it describes the same capture as the team file it is derived from
  assert.equal(env.as_of, teamsEnv.as_of);
});

test('it is in the manifest, with the right bytes and digest', () => {
  const entry = index.data.files.find(f => f.path === '/data/epa-players.json');
  assert.ok(entry, 'epa-players.json is missing from index.json');
  const raw = fs.readFileSync(path.join('data', 'epa-players.json'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(entry.bytes, Buffer.byteLength(raw));
  assert.equal(entry.sha256, require('crypto').createHash('sha256').update(raw).digest('hex'));
  assert.equal(entry.as_of, env.as_of);
});

test('a surface claims it, so it is not an orphan file', () => {
  const epa = surfaces.data.find(s => s.id === 'epa');
  assert.ok(epa.machine.some(m => m.url === '/data/epa-players.json' && m.status === 'live'));
});

/* ------------------------------ the honesty half ------------------------------ */
test('⚠️ the payload itself says there is no receiving EPA', () => {
  assert.equal(D.scope, 'primary-ball-handler-per-play');
  assert.ok(Array.isArray(D.unavailable));
  const un = D.unavailable.join(' | ').toLowerCase();
  assert.match(un, /receiving epa/);
  assert.match(un, /defensive players/);
  assert.match(un, /postseason/);
  // and the prose says it too, for anything reading the note rather than the fields
  assert.match(env.note, /no receiving EPA/i);
  assert.match(env.note, /primary ball handler/i);
});

test('⚠️ it does not present itself as a projection', () => {
  assert.match(env.note, /descriptive aggregates/i);
  assert.match(env.note, /do not read 2025 as 2026/i);
  assert.equal(env.graded, false);
});

test('total_epa is labelled as the volume number it is', () => {
  assert.match(env.field_notes.total_epa, /volume/i);
});

/* ------------------------------ the arithmetic half --------------------------- */
test('every season and the pooled table are present and populated', () => {
  assert.deepEqual(Object.keys(D.by_season).map(Number).sort(), [...D.seasons].sort());
  for (const [yr, rows] of Object.entries(D.by_season)) {
    assert.ok(rows.length > 50, `${yr}: only ${rows.length} players`);
    assert.ok(rows.length < 400, `${yr}: ${rows.length} players is past the minimum threshold`);
  }
  assert.ok(D.pooled.length > 50);
});

test('every row clears one of the two minimums, and the rule is published', () => {
  assert.match(D.minimum_rule, /EITHER/i);
  for (const [yr, rows] of Object.entries(D.by_season))
    for (const r of rows)
      assert.ok(r.dropbacks >= D.minimums.season.dropbacks || r.rushes >= D.minimums.season.rushes,
        `${yr} ${r.player}: ${r.dropbacks} db / ${r.rushes} ru`);
  for (const r of D.pooled)
    assert.ok(r.dropbacks >= D.minimums.pooled.dropbacks || r.rushes >= D.minimums.pooled.rushes,
      `pooled ${r.player}: ${r.dropbacks} db / ${r.rushes} ru`);
});

test('⚠️ both kinds of player survive the threshold', () => {
  // a dropback-only minimum would silently delete every running back — that is the
  // failure the two-bar rule exists to prevent, so prove both sides are actually here
  const passers = D.pooled.filter(r => r.dropbacks >= D.minimums.pooled.dropbacks);
  const carriers = D.pooled.filter(r => r.dropbacks === 0);
  assert.ok(passers.length >= 20, `only ${passers.length} passers`);
  assert.ok(carriers.length >= 10, `only ${carriers.length} pure ball carriers`);
});

test('plays reconcile, and rates are null exactly when the denominator is zero', () => {
  for (const r of allRows) {
    assert.equal(r.plays, r.dropbacks + r.rushes, r.player);
    assert.equal(r.epa_per_dropback === null, r.dropbacks === 0, `${r.player} dropback rate`);
    /* cpoe needs a completion-eligible pass, which a sack or a scramble is not, so a
       passer CAN legitimately have none. What must never happen is a cpoe on a player
       who never dropped back — that would mean the column was credited to a carrier. */
    if (r.dropbacks === 0) assert.equal(r.cpoe, null, `${r.player} has cpoe with no dropbacks`);
    assert.equal(r.epa_per_rush === null, r.rushes === 0, `${r.player} rush rate`);
    assert.ok(Number.isFinite(r.epa_per_play) && Number.isFinite(r.total_epa), r.player);
    assert.ok(r.success >= 0 && r.success <= 1, `${r.player} success ${r.success}`);
  }
});

test('the per-play rate agrees with the split rates it is made of', () => {
  for (const r of allRows) {
    const parts = (r.dropbacks * (r.epa_per_dropback || 0)) + (r.rushes * (r.epa_per_rush || 0));
    assert.ok(Math.abs(parts - r.plays * r.epa_per_play) < 0.6,
      `${r.player}: split ${parts.toFixed(2)} vs combined ${(r.plays * r.epa_per_play).toFixed(2)}`);
    assert.ok(Math.abs(r.total_epa - r.plays * r.epa_per_play) < 0.6, `${r.player} total_epa`);
  }
});

test('a multi-team row lists its teams, and a single-team row does not', () => {
  for (const r of allRows) {
    if (r.teams === undefined) continue;
    assert.ok(r.teams.length > 1, `${r.player} has a teams array with ${r.teams.length} entry`);
    assert.equal(r.team, r.teams[0].team, `${r.player} lead team`);
    assert.equal(r.teams.reduce((a, t) => a + t.plays, 0), r.plays, `${r.player} team play counts`);
    for (let i = 1; i < r.teams.length; i++)
      assert.ok(r.teams[i - 1].plays >= r.teams[i].plays, `${r.player} teams not sorted`);
  }
});

test('rows are ordered by total_epa, biggest first', () => {
  for (const rows of [...Object.values(D.by_season), D.pooled])
    for (let i = 1; i < rows.length; i++)
      assert.ok(rows[i - 1].total_epa >= rows[i].total_epa, `${rows[i].player} out of order`);
});

/* -------- recompute one player from the page, not from the builder -------- */
test('⚠️ a player recomputes from stats.html itself', () => {
  /* The builder and this test could share a bug. Decoding the columnar snapshot here,
     independently, is what makes the numbers evidence rather than a restatement. */
  const html = fs.readFileSync('stats.html', 'utf8');
  const j = html.indexOf('const DATA = ');
  let k = html.indexOf('{', j), depth = 0, i = k, inStr = false, q = '', esc = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === q) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; q = c; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) { i++; break; } }
  }
  const DATA = JSON.parse(html.slice(k, i));
  const b64 = x => Buffer.from(x, 'base64');
  const C = DATA.cols;
  const S = b64(C.season), FL = b64(C.flags), DOWN = b64(C.down), POS = b64(C.pos);
  const nb = b64(C.name), eb = b64(C.epa);
  const NAMEI = new Uint16Array(nb.buffer, nb.byteOffset, nb.length / 2);
  const EPA = new Int16Array(eb.buffer, eb.byteOffset, eb.length / 2);

  const target = D.pooled[0].player;                 // whoever leads the pooled table
  const ni = DATA.names.indexOf(target);
  assert.ok(ni > 0, `${target} is not in the snapshot's name list`);
  let n = 0, epa = 0, db = 0, dbEpa = 0, ru = 0, ruEpa = 0;
  for (let x = 0; x < DATA.n; x++) {
    if (NAMEI[x] !== ni) continue;
    if ((FL[x] >> 3) & 1) continue;
    if (DOWN[x] === 0) continue;
    const e = EPA[x] / 100;
    n++; epa += e;
    if (FL[x] & 1) { db++; dbEpa += e; } else { ru++; ruEpa += e; }
  }
  const row = D.pooled[0];
  assert.equal(row.plays, n, `${target} plays`);
  assert.equal(row.dropbacks, db, `${target} dropbacks`);
  assert.equal(row.rushes, ru, `${target} rushes`);
  assert.ok(Math.abs(row.total_epa - epa) < 0.02, `${target} total_epa ${row.total_epa} vs ${epa.toFixed(4)}`);
  assert.ok(Math.abs(row.epa_per_dropback - dbEpa / db) < 0.0002, `${target} epa/dropback`);
  assert.ok(Math.abs(row.epa_per_rush - ruEpa / ru) < 0.0002, `${target} epa/rush`);
  void POS; void S;
});

/* -------- the build must not delete files it did not write -------- */
test('⚠️ build-data.js regenerates the manifest by scanning the directory', () => {
  /* It used to build index.json from its own output list, which dropped every /data/ file
     written by another pipeline and turned validate-data.js red on a clean tree. */
  const bd = fs.readFileSync(path.join('tools', 'build-data.js'), 'utf8');
  assert.match(bd, /require\('\.\/data-manifest\.js'\)/);
  assert.match(bd, /writeDataManifest\(/);
  assert.ok(!/fs\.writeFileSync\(path\.join\(OUT, 'index\.json'\)/.test(bd),
    'build-data.js writes index.json directly again');
  // every JSON on disk is in the manifest — the property that broke
  const onDisk = fs.readdirSync('data').filter(f => f.endsWith('.json') && f !== 'index.json');
  const listed = new Set(index.data.files.map(f => path.basename(f.path)));
  for (const f of onDisk) assert.ok(listed.has(f), `${f} is on disk but not in index.json`);
});

console.log(`\n${pass} passed / 0 failed`);
