// RoboKap through the real owner-app connector path and the owner route, over a fake
// conditional-write database. Every account, key, task and Lab record is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createOwnerApps } from './owner-apps.mjs';
import { createRoboKap } from './robokap.mjs';
import { transition, view, initialState } from './worker-core.mjs';
import { encodeEnvelope } from './exact-store.mjs';

const context = { crypto, TextEncoder, TextDecoder, Uint8Array, Date };
vm.createContext(context);
vm.runInContext(readFileSync('work/dawg-pound.js', 'utf8') + '\nthis.pound={empty:poundEmpty,view:poundView,write:poundWrite,validate:poundValidate,schema:POUND_SCHEMA,hash:poundHash,canonical:poundCanonical};', context);
const pound = context.pound;
const P = '/privatePounds/u_owner', L = '/researchLab/v1/tenants/test';
const keys = { claude: { kind: 'user', uid: 'u_owner', keyLabel: 'Claude' }, grok: { kind: 'user', uid: 'u_owner', keyLabel: 'Grok' }, gemini: { kind: 'user', uid: 'u_owner', keyLabel: 'Gemini' }, primary: { kind: 'user', uid: 'u_owner', keyLabel: 'primary' } };
const LAB_H = '11111111-1111-4111-8111-111111111111';
const secret = n => ('integration_secret_' + n).padEnd(30, 'z');

function labEnvelope({ grant = true } = {}) {
  const state = initialState();
  state.hypotheses.push({ id: LAB_H, tenant: 'test', revisions: [{ version: 1, title: 'Synthetic', method: 'Synthetic', status: 'exploratory' }] });
  state.receipts.push({ id: 'lab-receipt-1', tenant: 'test', taskId: 'lab-task-1', hypothesisId: LAB_H, hypothesisVersion: 1, split: 'discovery', outcome: 'success', receiptHash: 'd'.repeat(64) });
  return encodeEnvelope({ version: 1, access: { users: { u_owner: { owner: grant, enabled: true, capabilities: ['research:read'] } } }, state, inputs: {} });
}
function rig({ robokapFlag = 'true' } = {}) {
  let clock = Date.parse('2026-10-22T12:00:00Z'), race = 0, lose = false, revoke = false, sessionUid = 'u_owner', failReadAfterWrite = false, readArmed = false;
  const env = { RESEARCH_OWNER_UID: 'u_owner', RESEARCH_UPLOAD_TENANT: 'test', DAWG_POUND_ENABLED: 'true', RESEARCH_LAB_ENABLED: 'true', ...(robokapFlag ? { ROBOKAP_ENABLED: robokapFlag } : {}) };
  const db = new Map([[L, labEnvelope()]]), etags = new Map(), writes = [];
  const fbGet = async (e, path) => {
    if (readArmed && path === P) { readArmed = false; throw new Error('synthetic read failure'); }
    return { data: structuredClone(db.get(path) ?? null), etag: String(etags.get(path) || 0) };
  };
  const fbPut = async (e, path, data, etag) => {
    if (race > 0) { race--; etags.set(path, (etags.get(path) || 0) + 1); }
    if (etag !== String(etags.get(path) || 0)) return false;
    db.set(path, structuredClone(data)); etags.set(path, (etags.get(path) || 0) + 1); writes.push(path);
    if (failReadAfterWrite) { failReadAfterWrite = false; readArmed = true; }
    if (lose) { lose = false; throw new Error('synthetic lost response'); }
    return true;
  };
  const ownerIdentity = async req => { assert.equal(req.headers.get('Authorization'), 'Bearer synthetic-session'); return sessionUid; };
  const robokap = createRoboKap({ fbGet, fbPut, ownerIdentity, now: () => clock });
  const api = createOwnerApps({ pound, transition, view, codeHash: 'a'.repeat(64), now: () => clock, ownerIdentity, fbGet, fbPut, robokap });
  const permission = async body => { const res = await api.permissions(new Request('https://test/owner-apps/v1', { method: 'POST', headers: { Authorization: 'Bearer synthetic-session', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env); return { status: res.status, body: await res.json() }; };
  const enable = async app => { const v = db.get(app === 'pound' ? P : L)?.ownerConnector?.version || 0; assert.equal((await permission({ app, enabled: true, expectedVersion: v, mode: 'seven_days' })).status, 200); };
  const run = (who, name, args = {}) => api.run(name, args, env, keys[who], async () => revoke ? { kind: 'user', uid: 'u_other', keyLabel: keys[who].keyLabel } : keys[who]);
  const write = (who, op, data, request_id) => run(who, 'dd_owner_robokap_write', { op, request_id: request_id || 'rq_' + op.replace(/\./g, '_') + '_' + Math.random().toString(36).slice(2, 12).padEnd(10, '0'), data });
  const route = async (body, { method, origin, path = '/robokap/v1', auth = true } = {}) => {
    const headers = { ...(auth ? { Authorization: 'Bearer synthetic-session' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) };
    const res = await robokap.route(new Request('https://test' + path, { method: method || (body ? 'POST' : 'GET'), headers, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
    return { status: res.status, headers: res.headers, body: res.status === 204 ? null : await res.json() };
  };
  let n = 0;
  const owner = (op, data) => route({ op, request_id: 'owner_request_' + String(++n).padStart(8, '0'), data });
  const addTask = async (title, extra = {}) => {
    const s = db.get(P) ? JSON.parse(db.get(P).payload) : { revision: 0 };
    const out = await run('claude', 'dd_owner_pound_write', { op: 'task.save', expected_revision: s.revision, request_id: 'pound_task_' + String(++n).padStart(10, '0'), data: { title, body: 'Synthetic brief for ' + title, agent_id: '', status: 'queued', archived: false, ...extra } });
    return out.result.item_id;
  };
  return { env, db, writes, api, robokap, enable, run, write, route, owner, addTask, tick: ms => { clock += ms; }, race: (k = 1) => { race = k; }, lose: () => { lose = true; }, revoke: () => { revoke = true; }, sessionAs: uid => { sessionUid = uid; }, failReadAfterWrite: () => { failReadAfterWrite = true; } };
}
const names = tools => tools.map(t => t.name);
async function seat(f) {
  const role = await f.owner('rk.role.propose', { seat: 'claude', key_label: 'Claude', role: 'Synthetic coordinator' });
  assert.equal(role.status, 200, JSON.stringify(role.body));
  await f.write('claude', 'rk.role.accept', { role_id: role.body.result.role_id });
  const approved = await f.owner('rk.decide', { subject: 'role', id: role.body.result.role_id, decision: 'approve' });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
}

test('default off: tools appear only with the flag AND the RoboKap app grant, and calls fail closed otherwise', async () => {
  const off = rig({ robokapFlag: null });
  await off.enable('pound');
  assert.deepEqual(names(await off.api.list(off.env, keys.claude)), ['dd_owner_pound_read', 'dd_owner_pound_write']);
  await assert.rejects(off.run('claude', 'dd_owner_robokap_read'), /robokap_disabled/);
  assert.equal((await off.route()).status, 503);
  const on = rig();
  assert.deepEqual(names(await on.api.list(on.env, keys.claude)), [], 'no grant, no tools');
  await assert.rejects(on.run('claude', 'dd_owner_robokap_read'), /app_permission_off_or_expired/);
  await on.enable('pound');
  assert.deepEqual(names(await on.api.list(on.env, keys.claude)), ['dd_owner_pound_read', 'dd_owner_pound_write', 'dd_owner_robokap_read', 'dd_owner_robokap_write']);
  for (const t of await on.api.list(on.env, keys.claude)) for (const k of ['oneOf', 'anyOf', 'allOf']) assert.equal(t.inputSchema[k], undefined);
  const write = (await on.api.list(on.env, keys.claude)).find(t => t.name === 'dd_owner_robokap_write');
  assert.deepEqual(write.inputSchema.properties.op.enum, ['rk.plan', 'rk.role.propose', 'rk.role.accept', 'rk.claim', 'rk.release', 'rk.report', 'rk.review', 'rk.intake', 'rk.dispatch', 'rk.heartbeat', 'rk.notice']);
  assert.deepEqual(names(await on.api.list(on.env, { kind: 'user', uid: 'u_other', keyLabel: 'primary' })), []);
  assert.deepEqual(names(await on.api.list(on.env, { kind: 'shared' })), []);
});

test('complete workflow through the real interfaces: owner route decides, the Claude key works, B unlocks only after A', async () => {
  const f = rig();
  await f.enable('pound');
  const A = await f.addTask('Synthetic task A'), B = await f.addTask('Synthetic task B');
  await seat(f);
  const pin = await f.owner('rk.pin', { project_id: 'bdb-test', kind: 'design_of_record', status: 'draft', ref: { type: 'claude_doc', id: 'SyntheticDocId00000000', rev: 1 } });
  assert.equal(pin.body.result.pin.verification, 'owner_attested');
  await f.owner('rk.plan', { task_id: A, expected_plan_version: 0, seat: 'claude', review: 'advisory', decision: 'required', data_scope: 'synthetic', pin: { project_id: 'bdb-test', kind: 'design_of_record', version: 1, require: 'any' } });
  const planB = await f.owner('rk.plan', { task_id: B, expected_plan_version: 0, seat: 'claude', review: 'none', decision: 'required', data_scope: 'none', depends_on: [A] });
  assert.equal(planB.body.board.lanes.ready.map(c => c.task_id).join(), A);
  assert.equal(planB.body.board.lanes.blocked.map(c => c.task_id).join(), B);
  const queue = await f.run('claude', 'dd_owner_robokap_read', { session_ref: 'claude-code:synthetic' });
  assert.deepEqual(queue.ready.map(t => t.task_id), [A]);
  assert.equal(queue.identity.key_label_trust, 'server_verified');
  assert.match(queue.capability.wake_session, /^unsupported/);
  const claim = await f.write('claude', 'rk.claim', { task_id: A, plan_version: 1, pin_version: 1, session_ref: 'claude-code:synthetic', lease_secret: secret(1) });
  const receipt = await f.write('claude', 'rk.report', { task_id: A, claim_id: claim.claim_id, lease_secret: secret(1), outcome: 'succeeded', summary: 'Synthetic result', artifacts: [{ kind: 'github_pr', ref: 'https://github.com/JKapcar/data-dawgs/pull/1' }] });
  assert.equal(receipt.validity, 'current');
  await assert.rejects(f.write('claude', 'rk.review', { receipt_id: receipt.receipt_id, verdict: 'accept' }), /self_review/);
  const review = await f.write('grok', 'rk.review', { receipt_id: receipt.receipt_id, verdict: 'accept', note: 'Synthetic advisory review' });
  assert.equal(review.mode, 'advisory');
  await assert.rejects(f.write('claude', 'rk.decide', { subject: 'receipt', id: receipt.receipt_id, decision: 'accept' }), /owner_session_required/);
  const before = await f.route();
  assert.deepEqual(before.body.board.lanes.needs_you.map(c => c.reasons[0].code), ['decide_receipt']);
  assert.deepEqual(before.body.board.lanes.blocked.map(c => c.task_id), [B]);
  const decided = await f.owner('rk.decide', { subject: 'receipt', id: receipt.receipt_id, decision: 'accept' });
  assert.deepEqual(decided.body.board.done.map(c => c.task_id), [A]);
  assert.deepEqual(decided.body.board.lanes.ready.map(c => c.task_id), [B]);
  const next = await f.run('claude', 'dd_owner_robokap_read', { session_ref: 'claude-code:synthetic' });
  assert.deepEqual(next.ready.map(t => t.task_id), [B]);
  const card = decided.body.board.done[0];
  assert.equal(card.evidence.review.mode, 'advisory');
  assert.match(card.evidence.by, /server-verified key, shared owner authority/);
  assert.ok(!f.writes.includes(L), 'nothing in this workflow wrote the Lab');
});

test('the Pound record stays one envelope: neither writer erases the other, grants and payload survive', async () => {
  const f = rig();
  await f.enable('pound');
  const A = await f.addTask('Synthetic task A');
  f.db.get(P).agentAccess = { retained: { enabled: false } };
  const payloadBefore = f.db.get(P).payload;
  await seat(f);
  const after = f.db.get(P);
  assert.equal(after.payload, payloadBefore, 'RoboKap never rewrites Pound content');
  assert.deepEqual(after.agentAccess, { retained: { enabled: false } });
  assert.equal(after.ownerConnector.enabled, true);
  assert.equal(typeof after.robokap, 'string');
  const robokapBefore = after.robokap;
  const s = JSON.parse(after.payload);
  await f.run('claude', 'dd_owner_pound_write', { op: 'message.add', expected_revision: s.revision, request_id: 'pound_message_0000001', data: { thread_id: A, text: 'Synthetic note' } });
  assert.equal(f.db.get(P).robokap, robokapBefore, 'Pound writes preserve the coordination records');
  const readback = await f.run('claude', 'dd_owner_pound_read');
  assert.equal(readback.workspace.robokap, undefined, 'Pound views never expose coordination internals');
});

test('compare-and-swap races retry from fresh state; lost responses replay; persistent conflict fails closed', async () => {
  const f = rig();
  await f.enable('pound');
  await f.addTask('Synthetic task A');
  f.race(1);
  const role = await f.owner('rk.role.propose', { seat: 'claude', key_label: 'Claude', role: 'Race survivor' });
  assert.equal(role.status, 200);
  f.lose();
  const body = { op: 'rk.role.accept', request_id: 'lost_response_000001', data: { role_id: role.body.result.role_id } };
  await assert.rejects(f.run('claude', 'dd_owner_robokap_write', body), /lost response/);
  const replay = await f.run('claude', 'dd_owner_robokap_write', body);
  assert.equal(replay.replayed, true);
  f.race(10);
  const conflict = await f.owner('rk.role.propose', { seat: 'grok', key_label: 'Grok', role: 'Never lands' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'workspace_changed_retry_same_request');
});

test('identity, grant expiry and owner-only operations stop commits', async () => {
  const f = rig();
  await f.enable('pound');
  await f.addTask('Synthetic task A');
  const role = await f.owner('rk.role.propose', { seat: 'claude', key_label: 'Claude', role: 'Synthetic' });
  f.revoke();
  const robokapBefore = f.db.get(P).robokap;
  await assert.rejects(f.write('claude', 'rk.role.accept', { role_id: role.body.result.role_id }), /configured_owner_required|connector_identity_changed/);
  assert.equal(f.db.get(P).robokap, robokapBefore);
  const g = rig();
  await g.enable('pound');
  g.tick(8 * 86400000);
  await assert.rejects(g.run('claude', 'dd_owner_robokap_read'), /app_permission_off_or_expired/);
  const h = rig();
  await h.enable('pound');
  await assert.rejects(h.write('claude', 'rk.pin', { project_id: 'x1', kind: 'sourcebook', status: 'approved', ref: { type: 'claude_doc', id: 'SyntheticDocId00000000', rev: 1 } }), /owner_session_required|invalid/);
  await assert.rejects(h.run('claude', 'dd_owner_robokap_write', { op: 'rk.claim', request_id: 'extra_field_0000001', data: {}, principal: 'owner_session' }), /unexpected_arguments/);
  await assert.rejects(h.run('claude', 'dd_owner_robokap_read', { key_label: 'Grok' }), /unexpected_arguments/);
});

test('owner route: signed owner only, no query strings, foreign origins refused, private no-store headers', async () => {
  const f = rig();
  await f.enable('pound');
  await f.addTask('Synthetic task A');
  const ok = await f.route();
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('cache-control'), /private, no-store/);
  assert.equal(ok.body.holdout, 'sealed');
  assert.equal((await f.route(undefined, { path: '/robokap/v1?owner=u_x' })).status, 400);
  assert.equal((await f.route(undefined, { path: '/robokap/v2' })).status, 404);
  assert.equal((await f.route(undefined, { origin: 'https://evil.test' })).status, 403);
  const pre = await f.route(undefined, { method: 'OPTIONS', origin: 'https://datadawgs216.com' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://datadawgs216.com');
  f.sessionAs('u_member');
  assert.equal((await f.route()).status, 403);
  f.sessionAs('u_owner');
  const bad = await f.owner('rk.decide', { subject: 'nothing', id: 'x', decision: 'approve' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_decision_subject');
});

test('Lab links are checked read-only through the owner\'s research access and fail closed without it', async () => {
  const f = rig();
  await f.enable('pound');
  const A = await f.addTask('Synthetic task A');
  await seat(f);
  const plan = await f.owner('rk.plan', { task_id: A, expected_plan_version: 0, seat: 'claude', review: 'none', decision: 'not_required', data_scope: 'synthetic', lab: { hypothesis_id: LAB_H, hypothesis_version: 1, evidence: 'required' } });
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  const claim = await f.write('claude', 'rk.claim', { task_id: A, plan_version: 1, session_ref: 'claude-code:synthetic', lease_secret: secret(2) });
  const out = await f.write('claude', 'rk.report', { task_id: A, claim_id: claim.claim_id, lease_secret: secret(2), outcome: 'succeeded', summary: 'Lab receipt attached', artifacts: [{ kind: 'lab_receipt', ref: 'lab-receipt-1', sha256: 'd'.repeat(64) }] });
  assert.equal(out.artifacts[0].verification, 'server_verified');
  assert.deepEqual((await f.route()).body.board.done.map(c => c.task_id), [A]);
  // Without the owner's research grant the Lab cannot be checked, so linked work waits.
  f.db.set(L, labEnvelope({ grant: false }));
  const board = (await f.route()).body.board;
  assert.equal(board.lab.status, 'unavailable');
  assert.deepEqual(board.lanes.blocked.map(c => c.reasons.map(r => r.code)), [['lab_unverifiable']]);
  assert.ok(!f.writes.includes(L), 'RoboKap never writes the Lab');
});

test('a committed owner write reads as saved even when the board cannot be re-read afterwards', async () => {
  const f = rig();
  await f.enable('pound');
  await f.addTask('Synthetic task A');
  f.failReadAfterWrite();
  const body = { op: 'rk.role.propose', request_id: 'owner_saved_read_failed', data: { seat: 'claude', key_label: 'Claude', role: 'Synthetic' } };
  const first = await f.route(body);
  assert.equal(first.status, 200, 'the write committed, so the answer is not an error');
  assert.equal(first.body.board, null);
  assert.equal(first.body.board_status, 'saved_reload_needed');
  assert.equal(first.body.result.state, 'proposed');
  const again = await f.route(body);
  assert.equal(again.body.result.replayed, true, 'a resend replays instead of writing twice');
  assert.equal(JSON.parse(f.db.get(P).robokap).roles.length, 1);
  assert.ok(again.body.board);
});

test('Pack Sled pipeline through the real interfaces: playbook intake, dispatch, heartbeat, evidence and review agree with the board after reload', async () => {
  const f = rig();
  await f.enable('pound');
  const task = await f.addTask('Synthetic recruiting role');
  const rev = JSON.parse(f.db.get(P).payload).revision;
  const brief = 'Synthetic role brief v1';
  const saved = await f.run('claude', 'dd_owner_pound_write', { op: 'context.save', expected_revision: rev, request_id: 'pound_context_0000000001', data: { title: 'Synthetic brief', text: brief } });
  const ctxId = saved.result.item_id;
  await seat(f);
  const role = await f.owner('rk.role.propose', { seat: 'claude-reviewer', key_label: 'Grok', role: 'Synthetic reviewer' });
  await f.write('grok', 'rk.role.accept', { role_id: role.body.result.role_id });
  await f.owner('rk.decide', { subject: 'role', id: role.body.result.role_id, decision: 'approve' });
  await f.owner('rk.pin', { project_id: 'synthetic-role', kind: 'sourcebook', status: 'approved', ref: { type: 'pound_context', context_id: ctxId, version: 1 } });
  const pb = await f.owner('rk.playbook', { playbook_id: 'synthetic-role', expected_version: 0, status: 'active', task_id: task, seat: 'claude', reviewer_seat: 'claude-reviewer', review: 'advisory', decision: 'required', data_scope: 'none', criteria: { project_id: 'synthetic-role', kind: 'sourcebook' }, coordinator_key: 'primary', intake: { source: 'gmail' }, acceptance: [{ text: 'Synthetic criterion' }] });
  assert.equal(pb.status, 200, JSON.stringify(pb.body));
  await assert.rejects(f.write('claude', 'rk.playbook', { playbook_id: 'x-y' }), /owner_session_required/);
  const sha = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('synthetic-message')).then(b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join(''));
  const intake = await f.write('primary', 'rk.intake', { playbook_id: 'synthetic-role', source: 'gmail', message_sha256: sha, received_at: '2026-10-22T11:55:00Z' });
  const writesBefore = f.writes.length;
  const dup = await f.write('primary', 'rk.intake', { playbook_id: 'synthetic-role', source: 'gmail', message_sha256: sha, received_at: '2026-10-22T11:55:00Z' });
  assert.equal(dup.duplicate, true);
  assert.equal(f.writes.length, writesBefore, 'a duplicate intake causes no database write');
  await f.write('primary', 'rk.dispatch', { playbook_id: 'synthetic-role', intake_ids: [intake.intake_id], expected_plan_version: 0 });
  const queue = await f.run('claude', 'dd_owner_robokap_read', { session_ref: 'claude-code:synthetic' });
  assert.equal(queue.ready[0].criteria.pin_version, 1);
  assert.match(queue.capability.scheduler, /^external/);
  const claim = await f.write('claude', 'rk.claim', { task_id: task, plan_version: 1, pin_version: 1, session_ref: 'claude-code:synthetic', lease_secret: secret(9), executor: 'synthetic-routine' });
  await f.write('claude', 'rk.heartbeat', { task_id: task, claim_id: claim.claim_id, lease_secret: secret(9), execution_id: 'exe_synthetic_01', checkpoint: { step: 'search' } });
  const running = await f.route();
  const runCard = running.body.board.lanes.running[0];
  assert.equal(runCard.execution.state, 'running');
  assert.equal(runCard.claim.checkpoints[0].step, 'search');
  const stored = JSON.parse(f.db.get(P).robokap).claims.find(c => c.id === runCard.claim.id);
  assert.equal(runCard.claim.heartbeat_at, stored.heartbeat_at, 'the board shows exactly what is stored');
  const ctxSha = JSON.parse(f.db.get(P).payload).contexts.find(c => c.id === ctxId).versions[0].sha256;
  const receipt = await f.write('claude', 'rk.report', { task_id: task, claim_id: claim.claim_id, lease_secret: secret(9), outcome: 'succeeded', summary: 'Synthetic result', evidence: { criteria: { pin_version: 1, sha256: ctxSha }, claims: [{ text: 'Synthetic claim', support: 'source', sources: [{ url: 'https://example.com/synthetic', observed_at: '2026-10-22T11:58:00Z' }] }], gaps: [] } });
  assert.equal(receipt.validity, 'current');
  await assert.rejects(f.write('primary', 'rk.review', { receipt_id: receipt.receipt_id, verdict: 'reject' }), /reviewer_not_assigned/);
  await f.write('grok', 'rk.review', { receipt_id: receipt.receipt_id, verdict: 'accept', checks: [{ criterion: 0, result: 'pass' }, { criterion: 'sources', result: 'pass' }], sources_checked: [{ url: 'https://example.com/synthetic', observed_at: '2026-10-22T12:00:00Z', result: 'confirmed' }] });
  const reloaded = await f.route();
  const card = reloaded.body.board.lanes.needs_you[0];
  assert.equal(card.reasons[0].code, 'decide_receipt');
  assert.equal(card.evidence.review.checks.length, 2);
  assert.equal(card.evidence.claims[0].sources[0].url, 'https://example.com/synthetic');
  const viaKey = await f.run('claude', 'dd_owner_robokap_read', { view: 'board' });
  assert.deepEqual(viaKey.lanes, reloaded.body.board.lanes, 'the owner page and a connector read show the same board');
});
