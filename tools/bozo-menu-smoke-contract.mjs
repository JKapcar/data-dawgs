import assert from 'node:assert/strict';
// Validate the public static snapshot contract, not the retired dynamic-page link.
export function validateMenuText(plain) {
  assert.match(plain, /Week beginning \d{4}-\d{2}-\d{2} · revision/);
  assert.match(plain, /Public Data Dawgs research/);
}
export function validateStaticMenu(html, plain, json) {
  assert.match(html, /The Bozo Menu/);
  for (const path of ['/bozo-menu.txt', '/bozo-menu.json'])
    assert.ok(html.includes(`href="${path}"`), `Static page must link ${path}`);
  assert.match(html, /id="snapshotNotice"/);
  validateMenuText(plain);
  assert.ok(['published', 'unpublished'].includes(json.status));
  assert.ok(Array.isArray(json.candidates));
  assert.ok(Array.isArray(json.published_weeks));
}
