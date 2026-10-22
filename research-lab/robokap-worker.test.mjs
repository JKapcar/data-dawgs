// Packaged end-to-end proof: the real assembled Worker in Miniflare, the real MCP connector
// path for two connector keys, and the signed-owner /robokap/v1 route. The outbound service
// is the only database; it refuses unexpected paths. Every credential here is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { buildWorker } from './build-worker.mjs';
import { initialState } from './worker-core.mjs';
import { encodeEnvelope } from './exact-store.mjs';

const require = createRequire(path.join(process.env.DD_NODE_MODULES, 'resolver.cjs'));
const { Miniflare } = require('miniflare');
const uid = 'u_owner', pepper = 'synthetic-pepper', primary = 'u_synthetic-primary', claudeKey = 'u_synthetic-claude', grokKey = 'u_synthetic-grok';
const A = 'p_00000000-0000-4000-8000-00000000000a', B = 'p_00000000-0000-4000-8000-00000000000b';
const mac = text => createHmac('sha256', pepper).update(text).digest('base64url');
const session = () => { const payload = Buffer.from(JSON.stringify({ u: uid, n: 'Synthetic Owner', i: Date.now(), e: Date.now() + 86400000, p: 0 })).toString('base64url'); return payload + '.' + mac(payload); };

async function boot({ flag = 'true' } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dd-robokap-'));
  buildWorker(directory);
  const task = (id, title) => ({ id, title, body: 'Synthetic brief: ' + title, agent_id: '', status: 'queued', archived: false, created_at: '2026-10-22T00:00:00.000Z', updated_at: '2026-10-22T00:00:00.000Z', revision: 1 });
  const grant = { owner: uid, enabled: true, expiresAt: 0, mode: 'until_revoked', version: 1 };
  const db = new Map([
    ['/privatePounds/' + uid, { owner_uid: uid, payload: JSON.stringify({ revision: 2, updated_at: null, agents: [], tasks: [task(A, 'Synthetic A'), task(B, 'Synthetic B')], messages: [], contexts: [], activity: [], receipts: [] }), ownerConnector: grant }],
    ['/researchLab/v1/tenants/test', encodeEnvelope({ version: 1, access: { users: { [uid]: { owner: true, enabled: true, capabilities: ['research:read'] } } }, state: initialState(), inputs: {} })],
    ['/users', { [uid]: { name: 'Synthetic Owner', passwordSetAt: 0, mcpToken: mac('mcp|' + primary), mcpTokens: { Claude: { hash: mac('mcp|' + claudeKey) }, Grok: { hash: mac('mcp|' + grokKey) } } } }],
    ['/users/' + uid, { name: 'Synthetic Owner', passwordSetAt: 0 }],
  ]);
  const versions = new Map(), writes = [];
  const mf = new Miniflare({
    modules: true, modulesRoot: directory, scriptPath: path.join(directory, 'worker.mjs'), compatibilityDate: '2026-07-30', r2Buckets: ['RESEARCH_UPLOADS'],
    bindings: { RESEARCH_OWNER_UID: uid, RESEARCH_UPLOAD_TENANT: 'test', RESEARCH_LAB_ENABLED: 'true', DAWG_POUND_ENABLED: 'true', ...(flag ? { ROBOKAP_ENABLED: flag } : {}), BOZO_PEPPER: pepper, DAWG_PASS: 'synthetic-shared', FB_SECRET: 'synthetic' },
    outboundService: async req => {
      const p = new URL(req.url).pathname.replace(/\.json$/, '');
      if (p.startsWith('/users/') && !db.has(p)) return Response.json(null);
      assert.ok(db.has(p), 'unexpected database path ' + p);
      const v = versions.get(p) || 0;
      if (req.method === 'PUT') {
        if (req.headers.get('if-match') !== '"' + v + '"') return new Response('', { status: 412 });
        db.set(p, await req.json()); versions.set(p, v + 1); writes.push(p);
        return Response.json(db.get(p));
      }
      assert.equal(req.method, 'GET');
      return Response.json(db.get(p), { headers: { ETag: '"' + v + '"' } });
    },
  });
  let n = 0;
  const rpc = async (method, params = {}, credential = claudeKey) => {
    const res = await mf.dispatchFetch('https://test/mcp/full/' + credential, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }) });
    return res.json();
  };
  const tool = async (name, args, credential = claudeKey) => {
    const out = await rpc('tools/call', { name, arguments: args }, credential);
    const text = out.result.content[0].text;
    if (out.result.isError) throw new Error(text);
    return JSON.parse(text);
  };
  const write = (op, data, credential = claudeKey) => tool('dd_owner_robokap_write', { op, request_id: 'pkg_' + op.replace(/\./g, '_') + '_' + String(++n).padStart(8, '0'), data }, credential);
  const owner = async (body, { auth = session(), method } = {}) => {
    const res = await mf.dispatchFetch('https://test/robokap/v1', { method: method || (body ? 'POST' : 'GET'), headers: { ...(auth ? { Authorization: 'Bearer ' + auth } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json() };
  };
  const decide = data => owner({ op: 'rk.decide', request_id: 'owner_' + String(++n).padStart(12, '0'), data });
  const ownerOp = (op, data) => owner({ op, request_id: 'owner_' + String(++n).padStart(12, '0'), data });
  const close = async () => { await mf.dispose(); const resolved = path.resolve(directory); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); rmSync(resolved, { recursive: true, force: true }); };
  return { mf, db, writes, rpc, tool, write, owner, ownerOp, decide, close };
}

test('packaged Worker: default off lists nothing new and refuses the owner route', async () => {
  const w = await boot({ flag: null });
  try {
    const list = (await w.rpc('tools/list')).result.tools.map(t => t.name);
    assert.ok(list.includes('dd_owner_pound_read'));
    assert.ok(!list.some(t => t.startsWith('dd_owner_robokap_')));
    assert.equal((await w.owner()).status, 503);
    assert.deepEqual(w.writes, []);
  } finally { await w.close(); }
});

test('packaged Worker: one complete RoboKap workflow over MCP and the signed owner route', async () => {
  const w = await boot();
  try {
    const list = (await w.rpc('tools/list')).result.tools.map(t => t.name);
    assert.ok(list.includes('dd_owner_robokap_read') && list.includes('dd_owner_robokap_write'));
    const init = await w.rpc('initialize', { protocolVersion: '2025-06-18' });
    assert.match(init.result.instructions, /dd_owner_\* tools/);
    assert.equal((await w.owner(undefined, { auth: null })).status, 401);
    const empty = await w.owner();
    assert.equal(empty.status, 200);
    assert.match(empty.cache, /private, no-store/);
    assert.deepEqual(empty.body.board.unplanned.map(c => c.task_id).sort(), [A, B]);
    const shared = await w.ownerOp('rk.role.propose', { seat: 'claude', key_label: 'primary', role: 'Shared key seat' });
    assert.equal(shared.status, 409);
    assert.equal(shared.body.error, 'shared_primary_key_not_allowed');
    const role = await w.ownerOp('rk.role.propose', { seat: 'claude', key_label: 'Claude', role: 'Synthetic coordinator' });
    assert.equal(role.status, 200, JSON.stringify(role.body));
    await assert.rejects(w.write('rk.role.accept', { role_id: role.body.result.role_id }, grokKey), /acceptance_must_come_from_the_seat_key/);
    await assert.rejects(w.write('rk.role.accept', { role_id: role.body.result.role_id }, primary), /acceptance_must_come_from_the_seat_key/);
    await w.write('rk.role.accept', { role_id: role.body.result.role_id });
    assert.equal((await w.decide({ subject: 'role', id: role.body.result.role_id, decision: 'approve' })).status, 200);
    assert.equal((await w.ownerOp('rk.plan', { task_id: A, expected_plan_version: 0, seat: 'claude', review: 'advisory', decision: 'required', data_scope: 'synthetic' })).status, 200);
    const planned = await w.ownerOp('rk.plan', { task_id: B, expected_plan_version: 0, seat: 'claude', review: 'none', decision: 'required', data_scope: 'none', depends_on: [A] });
    assert.deepEqual(planned.body.board.lanes.ready.map(c => c.task_id), [A]);
    assert.deepEqual(planned.body.board.lanes.blocked.map(c => c.task_id), [B]);
    const queue = await w.tool('dd_owner_robokap_read', { session_ref: 'claude-code:packaged' });
    assert.deepEqual(queue.ready.map(t => t.task_id), [A]);
    assert.deepEqual((await w.tool('dd_owner_robokap_read', { session_ref: 'grok:any' }, grokKey)).ready, [], 'another key sees no work for a seat it does not hold');
    await assert.rejects(w.write('rk.claim', { task_id: A, plan_version: 1, session_ref: 'grok:any', lease_secret: 'packaged_secret_grok_000000' }, grokKey), /target_mismatch/);
    const claim = await w.write('rk.claim', { task_id: A, plan_version: 1, session_ref: 'claude-code:packaged', lease_secret: 'packaged_secret_claude_00000' });
    const receipt = await w.write('rk.report', { task_id: A, claim_id: claim.result?.claim_id ?? claim.claim_id, lease_secret: 'packaged_secret_claude_00000', outcome: 'succeeded', summary: 'Synthetic packaged result', artifacts: [{ kind: 'note', note: 'Synthetic' }] });
    const receiptId = receipt.result?.receipt_id ?? receipt.receipt_id;
    await assert.rejects(w.write('rk.review', { receipt_id: receiptId, verdict: 'accept' }), /self_review/);
    const review = await w.write('rk.review', { receipt_id: receiptId, verdict: 'accept' }, grokKey);
    assert.equal(review.result?.mode ?? review.mode, 'advisory');
    await assert.rejects(w.write('rk.decide', { subject: 'receipt', id: receiptId, decision: 'accept' }), /owner_session_required|invalid/);
    const done = await w.decide({ subject: 'receipt', id: receiptId, decision: 'accept' });
    assert.deepEqual(done.body.board.done.map(c => c.task_id), [A]);
    assert.deepEqual(done.body.board.lanes.ready.map(c => c.task_id), [B]);
    assert.deepEqual((await w.tool('dd_owner_robokap_read', { session_ref: 'claude-code:packaged' })).ready.map(t => t.task_id), [B]);
    assert.ok(w.writes.every(p => p === '/privatePounds/' + uid), 'only the Pound record was written');
    const record = w.db.get('/privatePounds/' + uid);
    assert.equal(JSON.parse(record.payload).tasks.length, 2, 'Pound content untouched');
    assert.deepEqual(record.ownerConnector, { owner: uid, enabled: true, expiresAt: 0, mode: 'until_revoked', version: 1 });
  } finally { await w.close(); }
});
