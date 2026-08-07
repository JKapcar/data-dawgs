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
    const txt = fs.readFileSync(p, 'utf8');
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
