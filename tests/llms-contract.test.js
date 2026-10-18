const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateLlms } = require('../tools/llms-contract');
const root = path.resolve(__dirname, '..');
const text = fs.readFileSync(path.join(root, 'llms.txt'), 'utf8');

test('current source counts and LF/CRLF served sizes agree', () => {
  const result = validateLlms(root, text);
  assert.deepEqual(result.errors, []);
  assert.equal(validateLlms(root, text.replace(/\r?\n/g, '\r\n')).bytes, result.bytes);
});
test('stale and absent source claims fail', () => {
  for (const replacement of ['Source MCP: 62 tools; 0 not read-only', 'Source MCP: unknown']) {
    assert.ok(validateLlms(root, text.replace(/Source MCP: \d+ tools; \d+ not read-only/, replacement)).errors.length);
  }
});
test('UTF-8 bytes enforce the limit, including multibyte prose', () => {
  const base = text.replace(/\r\n/g, '\n');
  const padded = base + ' '.repeat(6144 - Buffer.byteLength(base));
  assert.deepEqual(validateLlms(root, padded).errors, []);
  assert.ok(validateLlms(root, padded + 'é').errors.some(e => e.includes('6146')));
});
