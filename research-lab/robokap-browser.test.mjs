// Browser proof of the RoboKap board against the REAL route handler and coordination core,
// running in this process over an in-memory conditional-write database. Synthetic tasks, keys
// and sessions only; every request is intercepted, nothing reaches the network.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadPlaywright, chromiumExecutable } from '../work/playwright-loader.mjs';
import { createRoboKap } from './robokap.mjs';

const output = process.env.LAB_SCREENSHOTS ? path.join(process.env.LAB_SCREENSHOTS, 'robokap') : path.join(os.tmpdir(), 'dd-robokap-board');
mkdirSync(output, { recursive: true });
const id = n => 'p_' + String(n).padStart(8, '0') + '-0000-4000-8000-000000000000';
const A = id(1), B = id(2), C = id(3);
const task = (taskId, title, status = 'queued', extra = {}) => ({ id: taskId, title, body: 'Synthetic brief: ' + title, agent_id: '', status, archived: false, revision: 1, ...extra });
const db = new Map([['/privatePounds/u_owner', { owner_uid: 'u_owner', payload: JSON.stringify({ revision: 3, agents: [], tasks: [task(A, 'Synthetic audit of develop coverage'), task(B, 'Synthetic feature notes'), task(C, 'Synthetic self-reported sign-up', 'working', { status_source: 'owner_connector_reported' })], messages: [], contexts: [{ id: id(9), title: 'Synthetic design of record', archived: false, versions: [{ version: 1, title: 'v1', sha256: 'c'.repeat(64), text: 'synthetic' }] }], activity: [], receipts: [] }) }]]);
const etags = new Map();
let posts = [], dropNext = false;
const env = { ROBOKAP_ENABLED: 'true', DAWG_POUND_ENABLED: 'true', RESEARCH_OWNER_UID: 'u_owner', RESEARCH_LAB_ENABLED: 'false' };
const robokap = createRoboKap({
  fbGet: async (e, p) => ({ data: structuredClone(db.get(p) ?? null), etag: String(etags.get(p) || 0) }),
  fbPut: async (e, p, data, etag) => { if (etag !== String(etags.get(p) || 0)) return false; db.set(p, structuredClone(data)); etags.set(p, (etags.get(p) || 0) + 1); return true; },
  ownerIdentity: async req => { const auth = req.headers.get('Authorization'); if (auth !== 'Bearer synthetic-session') throw Object.assign(new Error('Sign in again'), { poundStatus: 401 }); return 'u_owner'; },
});
const claude = (name, args) => robokap.connector(name, args, env, { uid: 'u_owner', keyLabel: 'Claude' }, async () => {});
let rq = 0;
const claudeWrite = (op, data) => claude('dd_owner_robokap_write', { op, request_id: 'browser_claude_' + String(++rq).padStart(6, '0'), data });
const STATIC = new Map([
  ['/research-lab/robokap.html', 'robokap.html'], ['/research-lab/robokap-board.mjs', 'robokap-board.mjs'], ['/research-lab/robokap.css', 'robokap.css'],
  ['/research-lab/account.js', 'account.js'], ['/research-lab/agent-setup.css', 'agent-setup.css'], ['/research-lab/navigation.css', 'navigation.css'], ['/research-lab/navigation.js', 'navigation.js'],
  ['/presentation-mode.js', '../presentation-mode.js'], ['/presentation-mode.css', '../presentation-mode.css'], ['/install-help.js', '../install-help.js'], ['/install-help.css', '../install-help.css'],
]);

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable(chromium) });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let expectedAborts = 0;
  page.on('console', m => { if (m.type() !== 'error') return; if (expectedAborts && /ERR_FAILED/.test(m.text())) { expectedAborts--; return; } errors.push(m.text()); });
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'datadawgs216.com') {
      const file = STATIC.get(url.pathname);
      assert.ok(file, 'unexpected static asset ' + url.pathname);
      return route.fulfill({ contentType: /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: readFileSync(new URL(file, import.meta.url)) });
    }
    assert.equal(url.hostname, 'toto.jkapcar4.workers.dev', 'no other host');
    if (req.method() === 'POST') {
      posts.push(req.postDataJSON());
      if (dropNext) { dropNext = false; const response = await robokap.route(new Request(req.url(), { method: 'POST', headers: req.headers(), body: req.postData() }), env); assert.equal(response.status, 200); return route.abort('failed'); }
    }
    const response = await robokap.route(new Request(req.url(), { method: req.method(), headers: req.headers(), ...(req.method() === 'POST' ? { body: req.postData() } : {}) }), env);
    const headers = Object.fromEntries(response.headers);
    return route.fulfill({ status: response.status, headers, body: response.status === 204 ? '' : await response.text() });
  });
  await page.goto('https://datadawgs216.com/research-lab/robokap.html');
  await page.getByText('Sign in to open your board.', { exact: true }).waitFor();
  await page.evaluate(() => { localStorage.setItem('dd-bozo-sess', 'synthetic-session'); dispatchEvent(new StorageEvent('storage', { key: 'dd-bozo-sess' })); });
  await page.locator('#rkUnplanned li').first().waitFor();
  assert.equal(await page.locator('#rkUnplanned li').count(), 3);
  assert.match(await page.locator('#rkUnplanned').innerText(), /Reported working · owner connector reported · Reported working; no execution receipt/);
  // Propose Claude's role from the form; Claude accepts with its own key; you approve on the board.
  await page.locator('#rkRoleBox summary').click();
  await page.locator('#rkRoleForm [name=key_label]').fill('Claude');
  await page.locator('#rkRoleForm [name=role]').fill('Synthetic coordinator');
  await page.locator('#rkRoleForm button[type=submit]').click();
  await page.getByText('Propose role: saved', { exact: false }).waitFor();
  const offer = (await claude('dd_owner_robokap_read', { session_ref: 'claude-code:browser' })).role_offers[0];
  await claudeWrite('rk.role.accept', { role_id: offer.role_id });
  await page.locator('#rkRefresh').click();
  await page.getByRole('button', { name: 'Approve role' }).click();
  await page.getByText('Approve role: saved', { exact: false }).waitFor();
  // Plan A, then B depending on A, from the plan form.
  for (const [taskId, depends] of [[A, null], [B, A]]) {
    await page.locator('#rkPlanBox summary').click();
    await page.locator('#rkPlanForm [name=task_id]').selectOption(taskId);
    if (depends) await page.locator('#rkPlanForm [name=depends_on]').selectOption([depends]);
    await page.locator('#rkPlanForm button[type=submit]').click();
    await page.getByText('Save plan: saved', { exact: false }).waitFor();
  }
  const tab = name => page.locator('.rk-tab', { hasText: name });
  assert.equal(await tab('Ready').locator('b').innerText(), '1');
  assert.equal(await tab('Blocked').locator('b').innerText(), '1');
  await tab('Blocked').click();
  assert.match(await page.locator('#rkCards').innerText(), /Waiting for a dependency/);
  // Claude claims and reports A with its own key.
  const claim = await claudeWrite('rk.claim', { task_id: A, plan_version: 1, session_ref: 'claude-code:browser', lease_secret: 'browser_lease_secret_000000' });
  await page.locator('#rkRefresh').click();
  await page.locator('.rk-tab[aria-pressed=true]', { hasText: 'Running' }).waitFor();
  assert.match(await page.locator('#rkCards').innerText(), /Progress is unverified until a receipt arrives/);
  await claudeWrite('rk.report', { task_id: A, claim_id: claim.claim_id, lease_secret: 'browser_lease_secret_000000', outcome: 'succeeded', summary: 'Synthetic coverage table produced.', artifacts: [{ kind: 'github_pr', ref: 'https://github.com/JKapcar/data-dawgs/pull/1' }] });
  await page.locator('#rkRefresh').click();
  await page.getByRole('button', { name: 'Accept result' }).waitFor();
  await page.locator('#rkCards details summary').first().click();
  assert.match(await page.locator('#rkCards').innerText(), /format checked/);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal scroll at ' + width);
    await page.screenshot({ path: path.join(output, 'robokap-board-needs-you-' + width + '.png'), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 900 });
  // An owner decision whose response is lost: nothing is claimed as saved; pressing again resends
  // the identical request, which the server replays instead of deciding twice.
  dropNext = true;
  expectedAborts = 1;
  await page.getByRole('button', { name: 'Accept result' }).click();
  await page.getByText('no answer from the server', { exact: false }).waitFor();
  assert.equal(await page.locator('#rkStatus').innerText().then(t => /: saved/.test(t)), false, 'no success claimed without a response');
  await page.getByRole('button', { name: 'Accept result' }).click();
  await page.getByText('(already recorded)', { exact: false }).waitFor();
  const decisions = posts.filter(p => p.op === 'rk.decide' && p.data.subject === 'receipt');
  assert.equal(decisions.length, 2);
  assert.equal(decisions[0].request_id, decisions[1].request_id, 'the retry resent the identical request');
  assert.equal(JSON.parse(db.get('/privatePounds/u_owner').robokap).decisions.filter(d => d.subject === 'receipt').length, 1, 'exactly one decision recorded');
  assert.equal(await tab('Done').locator('b').innerText(), '1');
  assert.equal(await tab('Ready').locator('b').innerText(), '1', 'B became ready once A was accepted');
  await tab('Ready').click();
  assert.match(await page.locator('#rkCards').innerText(), /Synthetic feature notes/);
  await page.screenshot({ path: path.join(output, 'robokap-board-ready-390.png'), fullPage: true });
  // Hiding the page clears private content; signing out leaves nothing rendered.
  await page.evaluate(() => { localStorage.clear(); dispatchEvent(new StorageEvent('storage', { key: null })); });
  await page.getByText('Sign in to open your board.', { exact: true }).waitFor();
  assert.equal(await page.locator('#rkCards li').count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, screenshots: output, posts: posts.length, liveRequests: 0 }));
} finally { await browser.close(); }
