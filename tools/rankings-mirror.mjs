#!/usr/bin/env node
/* Mirror the Dog Track's public grades document into data/rankings-grades.json.
 *
 *   node tools/rankings-mirror.mjs                fetch GET /rankings/grades from the Worker
 *   node tools/rankings-mirror.mjs --doc FILE     use a saved copy of that response instead
 *
 * GET /rankings/grades is the feature's only public read (work/rankings-grade.js): derived
 * scores, entrant identity and the method version. The page already renders from it. The Worker
 * cannot commit, so this copies it into /data/ as the spec asks ("at each grade run"). Grading
 * itself stays the manual admin run; nothing here needs a secret.
 *
 * ⚠️ The file must never carry player-level data. A document with a player-shaped key, or an
 * array holding objects (a row list), is refused rather than trimmed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'rankings-grades.json');
const TOTO = 'https://toto.jkapcar4.workers.dev';
const FORBIDDEN = new Set(['rows', 'players', 'player', 'player_id', 'rank', 'ranks', 'team', 'pos',
  'unmatched', 'snapshot', 'snapshots', 'csv']);

export function forbiddenPaths(value, at = 'doc') {
  const out = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      if (v && typeof v === 'object') out.push(`${at}[${i}] (an object inside an array)`);
    });
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.has(k)) out.push(`${at}.${k}`);
      out.push(...forbiddenPaths(v, `${at}.${k}`));
    }
  }
  return out;
}

// The previous file and the Worker's document in, the file to write out (or null: unchanged).
export function mirror(prev, doc, season, built = new Date().toISOString()) {
  if (!doc || doc.season !== season) throw new Error(`expected season ${season}, got ${doc && doc.season}`);
  if (!Number.isInteger(doc.weeks_graded) || doc.weeks_graded < 0) throw new Error('weeks_graded is not a count');
  if (!doc.scopes || typeof doc.scopes !== 'object') throw new Error('no scopes object');
  const bad = forbiddenPaths(doc);
  if (bad.length) throw new Error('refusing a document with player-level shape: ' + bad.join(', '));
  // Before Week 1 the Worker answers with an empty state; nothing graded means nothing to copy.
  if (doc.weeks_graded === 0 && prev.data && prev.data.weeks_graded === 0) return null;

  // The page link and the method summary are this file's own; everything else is the Worker's.
  const data = { ...doc, method: prev.data.method, page: prev.data.page };
  if (JSON.stringify(data) === JSON.stringify(prev.data)) return null;
  const through = Math.max(0, ...Object.keys(doc.weeks || {}).map(Number).filter(Number.isFinite));
  return {
    ...prev,
    as_of: String(doc.updated_at || built).slice(0, 10),
    graded: doc.weeks_graded > 0,
    note: `Mirrored from the Worker's public GET /rankings/grades: ${doc.weeks_graded} week(s) graded` +
      (through ? `, through Week ${through}` : '') + `, as of ${doc.updated_at || built}. ` +
      'Derived scores only: no player, rank or snapshot is published, by design. Provisional until the ' +
      'declared promotion gate (data.method.promotion_gate); a week whose snapshot was not captured ' +
      'before kickoff can never be graded.',
    built,
    data,
  };
}

async function main() {
  const prev = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const season = Number(process.env.SEASON || new Date().getUTCFullYear());
  const at = process.argv.indexOf('--doc');
  let doc;
  if (at > -1) doc = JSON.parse(fs.readFileSync(process.argv[at + 1], 'utf8'));
  else {
    const r = await fetch(`${TOTO}/rankings/grades?season=${season}`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`GET /rankings/grades HTTP ${r.status}`);
    doc = await r.json();
  }
  const next = mirror(prev, doc, season);
  if (!next) { console.log(`rankings grades: unchanged (${doc.weeks_graded} week(s) graded)`); return; }
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n');
  console.log(`rankings grades: ${doc.weeks_graded} week(s) graded, as_of ${next.as_of}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
}
