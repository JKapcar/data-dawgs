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
const A = id(1), B = id(2), C = id(3), D = id(4), POUND = '/privatePounds/u_owner';
const task = (taskId, title, status = 'queued', extra = {}) => ({ id: taskId, title, body: 'Synthetic brief: ' + title, agent_id: '', status, archived: false, revision: 1, ...extra });
const db = new Map([['/privatePounds/u_owner', { owner_uid: 'u_owner', payload: JSON.stringify({ revision: 3, agents: [], tasks: [task(A, 'Synthetic task A'), task(B, 'Synthetic task B'), task(C, 'Synthetic self-reported sign-up', 'working', { status_source: 'owner_connector_reported' }), task(D, 'Synthetic owner task D')], messages: [], contexts: [{ id: id(9), title: 'Synthetic design of record', archived: false, versions: [{ version: 1, title: 'v1', sha256: 'c'.repeat(64), text: 'synthetic' }] }], activity: [], receipts: [] }) }]]);
const etags = new Map();
let posts = [], dropOp = null, failOp = null, failBoardRead = false, boardReadArmed = false;
const env = { ROBOKAP_ENABLED: 'true', DAWG_POUND_ENABLED: 'true', RESEARCH_OWNER_UID: 'u_owner', RESEARCH_LAB_ENABLED: 'false' };
const robokap = createRoboKap({
  fbGet: async (e, p) => { if (boardReadArmed && p === POUND) { boardReadArmed = false; throw new Error('synthetic read failure after commit'); } return { data: structuredClone(db.get(p) ?? null), etag: String(etags.get(p) || 0) }; },
  fbPut: async (e, p, data, etag) => { if (etag !== String(etags.get(p) || 0)) return false; db.set(p, structuredClone(data)); etags.set(p, (etags.get(p) || 0) + 1); if (failBoardRead) { failBoardRead = false; boardReadArmed = true; } return true; },
  ownerIdentity: async req => { const auth = req.headers.get('Authorization'); if (auth !== 'Bearer synthetic-session') throw Object.assign(new Error('Sign in again'), { poundStatus: 401 }); return 'u_owner'; },
});
const claude = (name, args) => robokap.connector(name, args, env, { uid: 'u_owner', keyLabel: 'Claude' }, async () => {});
let rq = 0;
const claudeWrite = (op, data) => claude('dd_owner_robokap_write', { op, request_id: 'browser_claude_' + String(++rq).padStart(6, '0'), data });
const stored = () => JSON.parse(db.get(POUND).robokap);
const editTask = (taskId, change) => { const record = db.get(POUND), payload = JSON.parse(record.payload); Object.assign(payload.tasks.find(t => t.id === taskId), change); record.payload = JSON.stringify(payload); };
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
  let expectedAborts = 0, expectedServerErrors = 0;
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (expectedAborts && /ERR_FAILED/.test(m.text())) { expectedAborts--; return; }
    if (expectedServerErrors && /status of 503/.test(m.text())) { expectedServerErrors--; return; }
    errors.push(m.text());
  });
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'datadawgs216.com') {
      const file = STATIC.get(url.pathname);
      assert.ok(file, 'unexpected static asset ' + url.pathname);
      return route.fulfill({ contentType: /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: readFileSync(new URL(file, import.meta.url)) });
    }
    assert.equal(url.hostname, 'toto.jkapcar4.workers.dev', 'no other host');
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      posts.push(body);
      // Commit for real, then lose the answer (dropOp) or replace it with a server error (failOp).
      if (dropOp === body.op || failOp === body.op) {
        const response = await robokap.route(new Request(req.url(), { method: 'POST', headers: req.headers(), body: req.postData() }), env);
        assert.equal(response.status, 200);
        if (dropOp === body.op) { dropOp = null; return route.abort('failed'); }
        failOp = null;
        return route.fulfill({ status: 503, headers: { 'content-type': 'application/json', 'access-control-allow-origin': 'https://datadawgs216.com', vary: 'Origin' }, body: JSON.stringify({ error: 'robokap_unavailable' }) });
      }
    }
    const response = await robokap.route(new Request(req.url(), { method: req.method(), headers: req.headers(), ...(req.method() === 'POST' ? { body: req.postData() } : {}) }), env);
    const headers = Object.fromEntries(response.headers);
    return route.fulfill({ status: response.status, headers, body: response.status === 204 ? '' : await response.text() });
  });
  await page.goto('https://datadawgs216.com/research-lab/robokap.html');
  await page.getByText('Sign in to open your board.', { exact: true }).waitFor();
  await page.evaluate(() => { localStorage.setItem('dd-bozo-sess', 'synthetic-session'); dispatchEvent(new StorageEvent('storage', { key: 'dd-bozo-sess' })); });
  await page.locator('#rkUnplanned li').first().waitFor();
  assert.equal(await page.locator('#rkUnplanned li').count(), 4);
  assert.match(await page.locator('#rkEvidence').innerText(), /authenticated owner request/);
  assert.match(await page.locator('#rkEvidence').innerText(), /Connected assistants: unknown/);
  assert.match(await page.locator('#rkEvidence').innerText(), /Executing: unverified. 0 leases held/);
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
  // Plan A (priority 2), then B depending on A, from the plan form.
  for (const [taskId, depends, priority] of [[A, null, '2'], [B, A, '3']]) {
    await page.locator('#rkPlanBox summary').click();
    await page.locator('#rkPlanForm [name=task_id]').selectOption(taskId);
    if (depends) await page.locator('#rkPlanForm [name=depends_on]').selectOption([depends]);
    await page.locator('#rkPlanForm [name=priority]').selectOption(priority);
    await page.locator('#rkPlanForm button[type=submit]').click();
    await page.getByText('Save plan: saved', { exact: false }).waitFor();
  }
  assert.equal(stored().plans.find(p => p.task_id === A).priority, 2);
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
  await claudeWrite('rk.report', { task_id: A, claim_id: claim.claim_id, lease_secret: 'browser_lease_secret_000000', outcome: 'succeeded', summary: 'Synthetic result A.', artifacts: [{ kind: 'github_pr', ref: 'https://github.com/JKapcar/data-dawgs/pull/1' }] });
  await page.locator('#rkRefresh').click();
  await page.getByRole('button', { name: 'Accept result', exact: true }).waitFor();
  await page.locator('#rkCards details summary', { hasText: 'Evidence' }).first().click();
  assert.match(await page.locator('#rkCards').innerText(), /format checked/);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal scroll at ' + width);
    await page.screenshot({ path: path.join(output, 'robokap-board-needs-you-' + width + '.png'), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 900 });
  // An owner decision whose response is lost: nothing is claimed as saved; pressing again resends
  // the identical request, which the server replays instead of deciding twice.
  dropOp = 'rk.decide';
  expectedAborts = 1;
  await page.getByRole('button', { name: 'Accept result', exact: true }).click();
  await page.getByText('no answer from the server', { exact: false }).waitFor();
  assert.equal(await page.locator('#rkStatus').innerText().then(t => /: saved/.test(t)), false, 'no success claimed without a response');
  await page.getByRole('button', { name: 'Accept result', exact: true }).click();
  await page.getByText('(already recorded)', { exact: false }).waitFor();
  const decisions = posts.filter(p => p.op === 'rk.decide' && p.data.subject === 'receipt');
  assert.equal(decisions.length, 2);
  assert.equal(decisions[0].request_id, decisions[1].request_id, 'the retry resent the identical request');
  assert.equal(JSON.parse(db.get('/privatePounds/u_owner').robokap).decisions.filter(d => d.subject === 'receipt').length, 1, 'exactly one decision recorded');
  assert.equal(await tab('Done').locator('b').innerText(), '1');
  assert.equal(await tab('Ready').locator('b').innerText(), '1', 'B became ready once A was accepted');
  await tab('Ready').click();
  assert.match(await page.locator('#rkCards').innerText(), /Synthetic task B/);
  await page.screenshot({ path: path.join(output, 'robokap-board-ready-390.png'), fullPage: true });
  await claudeWrite('rk.claim', { task_id: B, plan_version: 1, session_ref: 'claude-code:browser', lease_secret: 'browser_b_lease_secret_000000' });
  // Claude proposes an amendment. You see the whole change before deciding, not a version number.
  await claudeWrite('rk.plan', { task_id: B, expected_plan_version: 1, seat: 'claude', review: 'advisory', decision: 'required', data_scope: 'none', depends_on: [A], priority: 2, note: 'Synthetic tidy-up', thread: { discord_thread_id: '111111111111111111' }, acceptance: [{ text: 'Synthetic check one' }, { text: 'Synthetic check two' }] });
  await page.locator('#rkRefresh').click();
  const cardB = page.locator('.rk-card[data-task="' + B + '"]');
  await cardB.locator('.rk-proposal').waitFor();
  assert.equal(await tab('Running').locator('b').innerText(), '0');
  assert.match(await page.locator('#rkEvidence').innerText(), /Executing: unverified. 1 leases held; 1 tasks in Done/);
  const proposal = await cardB.locator('.rk-proposal').innerText();
  for (const line of [/Proposed plan v2 · connector key "Claude"/, /Review\s*none → advisory/, /Priority\s*3 → 2/, /Discord thread\s*none → 111111111111111111/, /Acceptance\s*none → Synthetic check one; Synthetic check two/]) assert.match(proposal, line);
  await page.screenshot({ path: path.join(output, 'robokap-board-proposal-390.png'), fullPage: true });
  // The server commits the approval but answers with an error: the identical request is kept.
  failOp = 'rk.decide';
  expectedServerErrors = 1;
  await cardB.getByRole('button', { name: 'Approve plan v2' }).click();
  await page.getByText('the server could not confirm it', { exact: false }).waitFor();
  await page.locator('#rkResend').click();
  await page.getByText('Approve plan: saved (already recorded)', { exact: false }).waitFor();
  const approvals = posts.filter(p => p.op === 'rk.decide' && p.data.subject === 'plan');
  assert.equal(approvals.length, 2);
  assert.equal(approvals[0].request_id, approvals[1].request_id);
  // B's brief changes, so its plan needs amending. The form starts from the whole current plan
  // and keeps what it cannot edit.
  editTask(B, { body: 'Synthetic brief B, revised' });
  await page.locator('#rkRefresh').click();
  await cardB.getByRole('button', { name: 'Amend plan' }).click();
  // Re-rendering (switching lanes and back) must not drop what the form holds.
  await tab('Done').click();
  await tab('Needs you').click();
  const form = page.locator('#rkPlanForm');
  assert.equal(await form.locator('[name=priority]').inputValue(), '2');
  assert.equal(await form.locator('[name=review]:checked').inputValue(), 'advisory');
  assert.equal(await form.locator('[name=acceptance]').inputValue(), 'Synthetic check one');
  assert.equal(await form.locator('[name=note]').inputValue(), 'Synthetic tidy-up');
  assert.deepEqual(await form.locator('[name=depends_on] option:checked').evaluateAll(o => o.map(x => x.value)), [A]);
  assert.match(await page.locator('#rkPlanCarry').innerText(), /Kept from plan v2: Discord thread 111111111111111111 · 1 more acceptance check/);
  await form.locator('button[type=submit]').click();
  await page.getByText('Save plan: saved', { exact: false }).waitFor();
  const v3 = stored().plans.find(p => p.task_id === B && p.version === 3);
  assert.deepEqual([v3.status, v3.priority, v3.review, v3.depends_on, v3.thread, v3.acceptance.map(a => a.text), v3.note], ['approved', 2, 'advisory', [A], { discord_thread_id: '111111111111111111' }, ['Synthetic check one', 'Synthetic check two'], 'Synthetic tidy-up']);
  // A committed write whose board could not be re-read still reads as saved, then reloads.
  failBoardRead = true;
  await page.locator('#rkRoleBox summary').click();
  await page.locator('#rkRoleForm [name=seat]').selectOption('grok');
  await page.locator('#rkRoleForm [name=key_label]').fill('Grok');
  await page.locator('#rkRoleForm [name=role]').fill('Synthetic reviewer role');
  await page.locator('#rkRoleForm button[type=submit]').click();
  await page.getByText('Propose role: saved. Board as of', { exact: false }).waitFor();
  assert.equal(stored().roles.filter(r => r.seat === 'grok').length, 1);
  // Your own task: the claim lands, the report's answer is lost, and the tab is hidden. Hiding clears
  // every private view, form and list, but keeps the in-flight request for an identical resend.
  await page.locator('#rkPlanBox summary').click();
  await page.locator('#rkPlanForm [name=task_id]').selectOption(D);
  await page.locator('#rkPlanForm [name=seat]').selectOption('owner');
  await page.locator('#rkPlanForm [name=decision][value=not_required]').check();
  await page.locator('#rkPlanForm button[type=submit]').click();
  await page.getByText('Save plan: saved', { exact: false }).waitFor();
  const cardD = page.locator('.rk-card[data-task="' + D + '"]');
  await cardD.getByRole('button', { name: 'Record it done' }).click();
  await cardD.locator('textarea').fill('Synthetic owner step finished.');
  dropOp = 'rk.report';
  expectedAborts = 1;
  await cardD.getByRole('button', { name: 'Save as done' }).click();
  await page.getByText('Record your task: no answer from the server', { exact: false }).waitFor();
  const setHidden = hidden => page.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
  await setHidden(true);
  await page.getByText('Board hidden. Return to reload securely. "Record your task" is kept for a resend.', { exact: true }).waitFor();
  assert.equal(await page.locator('#rkCards li').count(), 0);
  for (const select of ['#rkPlanForm [name=task_id]', '#rkPlanForm [name=depends_on]', '#rkPlanForm [name=pin]', '#rkPinForm [name=context_id]']) assert.equal(await page.locator(select + ' option').count(), 0, select + ' emptied');
  assert.equal(await page.locator('#rkPlanForm [name=note]').inputValue(), '');
  assert.equal(await page.locator('#rkResend').isHidden(), true);
  assert.equal(await page.locator('#rkEvidence').isHidden(), true);
  assert.equal(await page.locator('#rkEvidenceList').innerText(), '');
  await setHidden(false);
  await page.locator('#rkResend').waitFor();
  assert.equal(await page.locator('#rkResend').innerText(), 'Resend "Record your task"');
  await page.locator('#rkResend').click();
  await page.getByText('Record your task: saved (already recorded)', { exact: false }).waitFor();
  assert.equal(stored().receipts.filter(r => r.task_id === D).length, 1, 'exactly one receipt for your task');
  assert.equal(await tab('Done').locator('b').innerText(), '2');
  // Signing out leaves nothing rendered.
  await page.evaluate(() => { localStorage.clear(); dispatchEvent(new StorageEvent('storage', { key: null })); });
  await page.getByText('Sign in to open your board.', { exact: true }).waitFor();
  assert.equal(await page.locator('#rkCards li').count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, screenshots: output, posts: posts.length, liveRequests: 0 }));
} finally { await browser.close(); }
