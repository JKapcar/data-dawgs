/* Simulation scale and Stokastic-style sorting for DFS Labs (dfs.html) and the MCP
   workspace. Mechanics only: more worlds shrink Monte Carlo noise, nothing else. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

test('MCP compute limits and defaults keep simulate and compare inside the budget', () => {
  const src = fs.readFileSync(path.join(root, 'work/dfs-workspace.js'), 'utf8');
  const L = vm.runInNewContext('(' + src.match(/const DFS_LIMITS = (\{[^}]+\})/)[1] + ')');
  const D = vm.runInNewContext('(' + src.match(/const DFS_SIM_DEFAULT = (\{.+?\}\});/)[1] + ')');
  assert.equal(L.worlds, 50000); assert.equal(L.sample, 20000); assert.equal(L.work, 96000000);
  assert.equal(D.sims, 8000);
  const lineups = 150;
  assert.ok(D.sims * (Math.min(D.fieldSample, D.fieldSize - 1) + lineups) <= L.work, 'default simulate fits');
  assert.ok(D.sims * (D.fieldSample + lineups) * 5 <= L.work, 'default four-contest compare fits');
  assert.ok(16000 * (5299 + lineups) <= L.work, 'a full 5,300-entrant field at 16,000 worlds fits');
  const worker = fs.readFileSync(path.join(root, 'dawg-bot-worker.js'), 'utf8');
  assert.ok(worker.includes(src.match(/const DFS_LIMITS = [^\n]+/)[0]), 'assembled Worker carries the same limits');
});

test('Labs results re-sort by sim ROI, first place, top-10 and cash; unresolved last', () => {
  const html = fs.readFileSync(path.join(root, 'dfs.html'), 'utf8');
  const fn = html.match(/function sortSimRows\(perLineup, key\) \{[\s\S]*?\n\}/)[0];
  const sortSimRows = vm.runInNewContext('(' + fn + ')');
  const rows = [
    { i: 0, ev: 1.2, roi: 0.2, win: null, top10: 0.01, top1: 0.03, cash: 0.25, mean: 140 },
    { i: 1, ev: 0.9, roi: null, win: 0.002, top10: 0.03, top1: 0.02, cash: 0.20, mean: 150 },
    { i: 2, ev: 1.5, roi: 0.5, win: 0.001, top10: 0.02, top1: 0.04, cash: 0.30, mean: 130 }
  ];
  const order = k => sortSimRows(rows, k).map(r => r.i);
  assert.deepEqual(order('ev'), [2, 0, 1]);
  assert.deepEqual(order('roi'), [2, 0, 1]);
  assert.deepEqual(order('win'), [1, 2, 0]);
  assert.deepEqual(order('top10'), [1, 2, 0]);
  assert.deepEqual(order('cash'), [2, 0, 1]);
  assert.deepEqual(order('mean'), [1, 0, 2]);
  for (const k of ['ev', 'roi', 'win', 'top10', 'top1', 'cash', 'mean']) assert.match(html, new RegExp('<option value="' + k + '">'));
  assert.match(html, /<option value="32000">32,000/);
  assert.match(html, /id="siSample" min="200" max="20000"/);
});
