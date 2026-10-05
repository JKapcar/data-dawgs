// Anonymous, read-only production verification. No credentials or candidate writes.
import assert from 'node:assert/strict';
const host = 'https://toto.jkapcar4.workers.dev';
async function read(url) {
  const r = await fetch(url, {signal: AbortSignal.timeout(20000), cache: 'no-store'});
  assert.equal(r.status, 200, `${url}: HTTP ${r.status}`);
  return {r, text: await r.text()};
}
const {r, text} = await read(host + '/bozo/menu.json');
const menu = JSON.parse(text);
assert.ok(['published', 'unpublished'].includes(menu.status));
assert.ok(Array.isArray(menu.candidates));
assert.ok(Array.isArray(menu.published_weeks));
assert.equal(r.headers.get('access-control-allow-origin'), '*');
assert.match(r.headers.get('cache-control'), /no-store/);
for (const path of ['/bozo/menu', '/bozo/menu.md']) {
  const response = await read(host + path);
  assert.match(response.text, /Bozo Menu/);
  console.log(`PASS ${path}: anonymous 200`);
}
console.log(`PASS public JSON: ${menu.status}, ${menu.candidates.length} candidates, ${menu.published_weeks.length} weeks`);
const privateRead = await fetch(host + '/api/bozo-menu/list', {signal: AbortSignal.timeout(20000)});
assert.ok([401,403].includes(privateRead.status), 'Private drafts must reject anonymous reads');
console.log('PASS private drafts reject anonymous reads');
// Pages may take a few minutes to serve a newly merged file.
let ready = false;
for (let i=0; i<12; i++) {
  try {
    const page = await read('https://datadawgs216.com/bozo-menu.html');
    assert.match(page.text, /The Bozo Menu/);
    assert.match(page.text, /bozo\/menu\.md/);
    const module = await read('https://datadawgs216.com/bozo-menu.mjs');
    assert.match(module.text, /export function renderPublicMenu/);
    ready = true; break;
  } catch(e) {
    if (i===11) throw e;
    await new Promise(resolve=>setTimeout(resolve,15000));
  }
}
assert.ok(ready);
console.log('PASS published page and renderer module');
