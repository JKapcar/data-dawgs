/* DFS SHOWDOWN (dfs-showdown.html + dfs-showdown.js): mechanical regression evidence on the
   synthetic demo slate only. Nothing here is calibration: the grades, bands and finish odds
   are model output, and these tests pin their arithmetic and invariants, not their truth.
   ⚠️ No paid or private slate may ever be used as a fixture in this public repo. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const { DDFS } = require('../work/dfs-engine.js');
const SD = require('../dfs-showdown.js');

const QUICK = { engine: DDFS, worlds: 600, fieldN: 6000 };
let cached = null;
const demoModel = async () => cached || (cached = await SD.analyze(SD.demoSlate(), QUICK));

test('the demo slate is invented and every demo entry is a legal DK Showdown lineup', () => {
  const d = SD.demoSlate();
  assert.equal(d.site, 'dk_showdown');
  assert.match(d.source, /invented/i);
  assert.equal(new Set(d.players.map(p => p.team)).size, 2);
  for (const e of d.entries) {
    assert.equal(e.ids.length, 6);
    assert.equal(new Set(e.ids).size, 6, 'six distinct players');
    assert.equal(e.ids[0], e.cpt, 'captain is the first id');
    const sal = d.players[e.cpt].sal * 1.5 + e.ids.slice(1).reduce((s, i) => s + d.players[i].sal, 0);
    assert.ok(sal <= 50000, `salary ${sal} over the cap`);
    assert.equal(new Set(e.ids.map(i => d.players[i].team)).size, 2, 'both teams represented');
    assert.ok(SD.TYPES.some(t => t.id === e.type));
  }
});

test('analysis is deterministic for a seed and its distributions are coherent', async () => {
  const a = await demoModel();
  const b = await SD.analyze(SD.demoSlate(), QUICK);
  assert.deepEqual(a.entries.map(e => e.score), b.entries.map(e => e.score));
  assert.deepEqual(a.portfolio, b.portfolio);
  assert.equal(a.portfolio.fees, 34);
  assert.equal(a.portfolio.entries, 6);
  for (const e of a.entries) for (const t of SD.TYPES) {
    const fin = e.finish[t.id];
    assert.equal(fin.length, 6);
    // bins are published to one decimal, so they partition 100 up to rounding
    assert.ok(Math.abs(fin.reduce((s, v) => s + v, 0) - 100) <= 0.35, 'finish bins partition the worlds');
    assert.ok(Math.abs(e.top1[t.id] - fin[0]) <= 0.06, 'top-1% rate is the first finish bin');
    assert.ok(Math.abs(e.cash[t.id] - (fin[0] + fin[1] + fin[2] + fin[3])) <= 0.25, 'cash is the top four bins (the top-22% line)');
    assert.ok(e.cash[t.id] >= e.top1[t.id], 'cashing includes every top-1% finish');
    const s = e.score[t.id];
    assert.ok(s.score >= 0 && s.score <= 100);
    if (t.id === 'cash') assert.deepEqual(s, {score:null,word:'Unavailable'}); else assert.equal(s.word, SD.gradeWord(s.score));
    assert.ok(e.dupes[t.id] >= 0);
  }
  assert.ok(a.portfolio.pTop1 <= a.portfolio.pCash);
});

test('field bands never cross and every type is graded on the same features', async () => {
  const m = await demoModel();
  for (const t of SD.TYPES) for (const ax of ['own', 'sal', 'dupe']) {
    const b = m.bands[t.id][ax];
    assert.ok(b.x.length >= 4);
    for (let i = 1; i < b.x.length; i++) assert.ok(b.x[i] >= b.x[i - 1], 'bin centres ascend');
    for (const y of ['proj', 'ceil']) {
      const q = b[y];
      for (let i = 0; i < b.x.length; i++) assert.ok(q.p25[i] <= q.p50[i] && q.p50[i] <= q.p75[i] && q.p75[i] <= q.p90[i], `${t.id} ${ax} ${y} bin ${i}`);
    }
  }
  const e = m.entries[0];
  assert.deepEqual(Object.keys(e.score).sort(), SD.TYPES.map(t => t.id).sort());
});

test('exposure is counted in dollars and captains in captain dollars', async () => {
  const m = await demoModel(), d = SD.demoSlate();
  for (const x of m.exposure) {
    const usd = d.entries.filter(e => e.ids.includes(x.i)).reduce((s, e) => s + e.fee, 0);
    assert.equal(x.usd, usd);
    assert.ok(Math.abs(x.share - Math.round(usd / 34 * 1000) / 10) < 1e-9);
  }
  for (const c of m.captains) {
    const usd = d.entries.filter(e => e.cpt === c.i).reduce((s, e) => s + e.fee, 0);
    assert.ok(Math.abs(c.you - Math.round(usd / 34 * 1000) / 10) < 1e-9);
  }
  assert.equal(m.scripts.reduce((s, x) => s + x.usd, 0), 34);
});

test('DraftKings entry CSVs map contest names to contest types and players by ID or name', () => {
  assert.equal(SD.contestTypeFromName('NFL Showdown $5 Single Entry [BUF vs LAR]'), 'se');
  assert.equal(SD.contestTypeFromName('NFL Showdown $3 [20 Entry Max]'), 'mid');
  assert.equal(SD.contestTypeFromName('NFL Showdown $333 [150 Entry Max]'), 'mme');
  assert.equal(SD.contestTypeFromName('NFL Showdown Millionaire'), 'flag');
  const d = SD.demoSlate();
  const players = d.players.map((p, i) => ({ ...p, dkId: String(1000 + i), cptId: String(2000 + i) }));
  const cell = (i, cpt) => `${players[i].name} (${cpt ? 2000 + i : 1000 + i})`;
  const e0 = d.entries[0], e1 = d.entries[1];
  const csv = [
    'Entry ID,Contest Name,Contest ID,Entry Fee,CPT,FLEX,FLEX,FLEX,FLEX,FLEX,,Instructions',
    ['4001', 'NFL Showdown $15 Single Entry [HBR vs MSA]', '77', '$15', cell(e0.cpt, true), ...e0.ids.slice(1).map(i => cell(i))].join(','),
    ['4002', '"NFL Showdown $6 [5 Entry Max]"', '78', '$6', players[e1.cpt].name, ...e1.ids.slice(1).map(i => players[i].name)].join(','),
    ['4003', 'NFL Showdown $1 Single Entry', '79', '$1', 'Nobody Real (999)', ...e1.ids.slice(1).map(i => cell(i))].join(','),
    ',,,,,,,,,,,Position,Name + ID'
  ].join('\n');
  const out = SD.parseEntriesCsv(csv, players);
  assert.equal(out.entries.length, 2);
  assert.deepEqual(out.entries[0].ids, e0.ids);
  assert.equal(out.entries[0].type, 'se');
  assert.equal(out.entries[0].fee, 15);
  assert.deepEqual(out.entries[1].ids, e1.ids);
  assert.equal(out.entries[1].type, 'mid');
  assert.equal(out.problems.length, 1);
  assert.match(out.problems[0], /Nobody Real/);
  assert.match(SD.parseEntriesCsv('Entry ID,Contest Name\n1,x', players).problems[0], /No CPT column/);
});

test('illegal entries are reported, never silently graded', async () => {
  const d = SD.demoSlate();
  const bad = [{ ...d.entries[0], ids: [0, 0, 1, 2, 3, 4], cpt: 0 }, { ...d.entries[0], ids: [0, 1, 2, 3, 4, 5], cpt: 0 }];
  const m = await SD.analyze({ ...d, entries: bad.concat(d.entries.slice(0, 1)) }, QUICK);
  assert.equal(m.entries.length, 1);
  assert.ok(m.warnings.length >= 2, JSON.stringify(m.warnings));
});

test('the page is public code with no paid data in it and only reads the account', () => {
  const html = fs.readFileSync(path.join(root, 'dfs-showdown.html'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'dfs-showdown.js'), 'utf8');
  let count = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    new vm.Script(m[2], { filename: `dfs-showdown.html script ${++count}` });
  }
  assert.ok(count >= 3, 'nav, page and Toto scripts compile');
  assert.match(html, /<script src="work\/dfs-engine\.js"><\/script>/);
  assert.match(html, /<script src="dfs-showdown\.js\?v=[\w.-]+"><\/script>/);
  assert.match(html, /<script data-page="dfs-showdown">/);
  const main = html.match(/<main\b[^>]*\bid="sd"/);
  assert.ok(main, 'Showdown main exists');
  const page = html.slice(main.index);
  for (const text of [page, core]) {
    assert.doesNotMatch(text, /\bETR\b|Establish ?The ?Run/i, 'no vendor data or attribution in the page’s own code');
  }
  const ops = [...page.matchAll(/api\('([a-z_]+)'/g)].map(m => m[1]);
  assert.deepEqual([...new Set(ops)].sort(), ['get', 'list'], 'read-only: list and get are the only account calls');
  assert.match(page, /window\.DD_BOTCTX = \{/);
  assert.match(page, /NOTHING IS GRADED/);
  assert.match(page, /NO ROI/);
});

test('the page is wired into the site: nav, Arena surface, sitemap and Toto map', () => {
  const html = fs.readFileSync(path.join(root, 'dfs-showdown.html'), 'utf8');
  assert.ok(html.includes('["dfs-showdown.html","DFS SHOWDOWN","dfs-showdown"],'));
  const surfaces = JSON.parse(fs.readFileSync(path.join(root, 'data/surfaces.json'), 'utf8'));
  const row = surfaces.data.find(s => s.id === 'dfs-showdown');
  assert.ok(row && row.domain === 'arena' && row.page === '/dfs-showdown.html');
  assert.equal(surfaces.counts.surfaces, surfaces.data.length);
  assert.match(fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8'), /dfs-showdown\.html/);
  for (const f of fs.readdirSync(root).filter(f => f.endsWith('.html'))) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    if (!s.includes('const NAV = [')) continue;
    assert.equal(s.split('["dfs-showdown.html","DFS SHOWDOWN","dfs-showdown"],').length - 1, 1, f + ' nav');
    assert.equal(s.split('\ndfs-showdown.html — DFS SHOWDOWN:').length - 1, 1, f + ' Toto map');
  }
});
