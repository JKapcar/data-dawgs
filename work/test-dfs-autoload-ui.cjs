// Exercise the production page: module tests cannot catch duplicate UI wiring.
// npm install --prefix /tmp/dd-dfs-test jsdom
// DDFS_JSDOM=/tmp/dd-dfs-test/node_modules/jsdom node work/test-dfs-autoload-ui.cjs
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { JSDOM } = require(process.env.DDFS_JSDOM || 'jsdom');
const root = path.resolve(__dirname, '..');
const dom = new JSDOM(fs.readFileSync(root + '/dfs.html', 'utf8'), {
  url: 'https://datadawgs216.com/dfs.html', runScripts: 'outside-only', pretendToBeVisual: true
});
const w = dom.window, errors = [], requests = [];
w.addEventListener('error', e => errors.push(String(e.error || e.message)));
w.HTMLElement.prototype.scrollIntoView = function() {};
w.URL.createObjectURL = () => 'blob:test';
w.Worker = class { terminate() {} postMessage() { throw Error('Must not auto-run solver'); } };
const fixture = format => JSON.parse(fs.readFileSync(root + '/tests/fixtures/dk-draftables-' + format + '-sample.json'));
const lobby = { DraftGroups: [
  { DraftGroupId: 90001, ContestTypeId: 96, GameCount: 1, StartDate: '2099-09-09T00:20:00Z', Sport: 'NFL' },
  { DraftGroupId: 90010, ContestTypeId: 21, GameCount: 12, StartDate: '2099-09-13T17:00:00Z', StartDateEst: '2099-09-13T13:00:00', Sport: 'NFL' }
] };
let failDraftables = false;
w.fetch = async url => {
  url = String(url);
  if (url.includes('/dk/lobby')) return { ok: true, json: async () => lobby };
  if (url.includes('/dk/draftables')) {
    requests.push(new URL(url).searchParams.get('draftGroupId'));
    if (failDraftables) throw Error('Fixture connection failure');
    return { ok: true, json: async () => fixture(url.includes('90001') ? 'showdown' : 'classic') };
  }
  return { ok: false, json: async () => ({}), text: async () => '' };
};
for (const f of ['dfs-lab-audit.js', 'dfs-lab-contests.js', 'dfs-pareto.js']) w.eval(fs.readFileSync(root + '/' + f, 'utf8'));
for (const s of w.document.querySelectorAll('script')) if (!s.src && !/text\/plain|application\/(?:ld\+)?json/i.test(s.type)) {
  Object.defineProperty(w.document, 'currentScript', { value: s, configurable: true });
  w.eval(s.textContent);
}
const delay = ms => new Promise(r => setTimeout(r, ms));
const state = () => JSON.parse(w.localStorage.getItem('dd-dfs-v1'));
(async () => {
  await delay(800);
  assert.deepEqual(requests, ['90001']);
  assert.equal(state().site, 'dk_showdown');
  assert.ok(state().players.length > 0);
  const button = w.document.getElementById('dkSwitchAlt');
  assert.equal(button.hidden, false);
  button.click(); await delay(400);
  assert.deepEqual(requests, ['90001', '90010'], 'one click makes one request');
  assert.equal(state().site, 'dk_classic', w.document.getElementById('slateWarn').textContent);
  assert.equal(button.dataset.draftGroupId, '90001');
  button.click(); await delay(400);
  assert.deepEqual(requests, ['90001', '90010', '90001']);
  assert.equal(state().site, 'dk_showdown');
  const previous = state().players;
  failDraftables = true;
  button.click(); await delay(400);
  assert.deepEqual(state().players, previous, 'failed switch retains last-good pool');
  assert.equal(state().slate.stale, true);
  assert.deepEqual(errors, []);
  console.log('Production page: boot, auto-load, single-request bidirectional switching, and failed-load retention PASS');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => w.close());
