import fs from 'node:fs';
import assert from 'node:assert/strict';
import { validateStaticMenu } from '../tools/bozo-menu-smoke-contract.mjs';
const html = fs.readFileSync('bozo-menu.html', 'utf8');
const plain = fs.readFileSync('bozo-menu.txt', 'utf8');
const json = JSON.parse(fs.readFileSync('bozo-menu.json'));
validateStaticMenu(html, plain, json);
for (const path of ['/bozo-menu.txt', '/bozo-menu.json'])
  assert.throws(() => validateStaticMenu(html.replace(`href="${path}"`, ''), plain, json));
assert.throws(() => validateStaticMenu(html.replace('id="snapshotNotice"', ''), plain, json));
assert.throws(() => validateStaticMenu(html, plain, {...json, candidates: null}));
assert.throws(() => validateStaticMenu(html, 'unrelated response', json));
console.log('PASS current static contract and missing-link/notice/schema regressions');
