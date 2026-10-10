// Dog Track grades mirror: copies only the Worker's public derived document, refuses anything
// player-shaped, and leaves the file alone when nothing new was graded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mirror, forbiddenPaths } from '../tools/rankings-mirror.mjs';

const prev = JSON.parse(fs.readFileSync(new URL('../data/rankings-grades.json', import.meta.url), 'utf8'));
const empty = { season: 2026, weeks_graded: 0, scoring: 'PPR', method_version: '1.0', provisional: true, empty: true,
  note: 'No graded weeks yet.', entrants: {}, scopes: {}, weeks: {} };
const graded = {
  season: 2026, weeks_graded: 2, scoring: 'PPR', updated_at: '2026-10-07T15:02:11.000Z', method_version: '1.0',
  provisional: true, shrinkage_mode: 'field', excluded_unmatched: 3, hygiene_tracked: true,
  entrants: { BLEND: { name: 'Blend', type: 'blend', color: '#888', first_week: 1, blend_member: false } },
  blend: { members: ['a', 'b'], frozen_at_week: 1 },
  scopes: { ALL: { BLEND: { rho: 0.61, rho_raw: 0.6, ci: [0.5, 0.7], tau: 0.4, capture: 0.5, hygiene: 1,
    relative_to_field: 0, weeks_graded: 2, weekly_rho: [0.6, 0.62], provisional: true, tied_with_leader: true, grade: 'B' } } },
  weeks: { 1: { ALL: { BLEND: { rho: 0.6, tau: 0.4, capture: 0.5, hygiene: 1 } } },
           2: { ALL: { BLEND: { rho: 0.62, tau: 0.4, capture: 0.5, hygiene: 0 } } } },
};

test('the empty pre-Week-1 state is not a change', () => {
  assert.equal(mirror(prev, empty, 2026), null);
});

test('graded weeks are copied with the file\'s own method and page, dated by the grade run', () => {
  const out = mirror(prev, graded, 2026, '2026-10-08T15:40:00.000Z');
  assert.equal(out.as_of, '2026-10-07');
  assert.equal(out.graded, true);
  assert.equal(out.data.weeks_graded, 2);
  assert.deepEqual(out.data.method, prev.data.method);
  assert.equal(out.data.page, prev.data.page);
  assert.equal(out.tier, 'labs');
  assert.equal(out.tier_meaning, prev.tier_meaning);
  assert.match(out.note, /2 week\(s\) graded, through Week 2/);
  // a second copy of the same document is not a change
  assert.equal(mirror(out, graded, 2026, '2026-10-09T15:40:00.000Z'), null);
});

test('anything player-shaped is refused, not trimmed', () => {
  const leaked = structuredClone(graded);
  leaked.weeks[2].ALL.BLEND.players = ['x'];
  assert.throws(() => mirror(prev, leaked, 2026), /player-level shape: doc\.weeks\.2\.ALL\.BLEND\.players/);
  const rowList = structuredClone(graded);
  rowList.scopes.ALL.BLEND.weekly_rho = [{ rank: 1, name: 'A', team: 'X', pos: 'RB' }];
  assert.throws(() => mirror(prev, rowList, 2026), /an object inside an array/);
  assert.deepEqual(forbiddenPaths(graded), []);
});

test('a wrong season or a malformed count is an error', () => {
  assert.throws(() => mirror(prev, { ...graded, season: 2025 }, 2026), /expected season 2026/);
  assert.throws(() => mirror(prev, { ...graded, weeks_graded: '2' }, 2026), /not a count/);
});
