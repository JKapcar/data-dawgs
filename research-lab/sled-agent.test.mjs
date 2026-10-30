// Pack Sled seat credentials end to end over a fake conditional-write database: owner issuance,
// renewal and revocation (agent-setup), the scoped gateway (sled-agent-gateway), and the board's
// view of credentials (robokap). Every account, credential, task and brief is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentSetup } from './agent-setup.mjs';
import { createRoboKap } from './robokap.mjs';
import { createSledAgentGateway, sledRoute } from './sled-agent-gateway.mjs';
import { createPoundAgentGateway } from './pound-agent-gateway.mjs';
import { sha256Hex } from './robokap-core.mjs';

const OWNER = 'u_owner', P = '/privatePounds/' + OWNER, R = '/researchLab/v1/tenants/test', DAY = 86400000;
const TASK = 'p_00000001-0000-4000-8000-000000000000', BRIEF = 'p_00000002-0000-4000-8000-000000000000';
const BRIEF_TEXT = 'Synthetic brief: public read-only sourcing; nobody contacted.';

async function rig(flags = {}) {
  let clock = Date.parse('2026-10-31T12:00:00Z'), beforePut = null;
  const env = { RESEARCH_OWNER_UID: OWNER, RESEARCH_UPLOAD_TENANT: 'test', DAWG_POUND_ENABLED: 'true', ROBOKAP_ENABLED: 'true', AGENT_SETUP_ENABLED: 'true', DELEGATED_AGENTS_ENABLED: 'true', SLED_AGENTS_ENABLED: 'true', ...flags };
  const payload = { revision: 1, tasks: [{ id: TASK, title: 'Synthetic recruiting task', body: 'Synthetic', agent_id: '', status: 'queued', archived: false, project_id: 'synthetic' }], contexts: [{ id: BRIEF, title: 'Synthetic brief', archived: false, active_version: 1, versions: [{ version: 1, title: 'Synthetic brief', text: BRIEF_TEXT, sha256: await sha256Hex(BRIEF_TEXT) }] }], agents: [], messages: [], activity: [], receipts: [] };
  const db = new Map([[P, { owner_uid: OWNER, payload: JSON.stringify(payload) }], [R, { payload: '{}', access: { users: { [OWNER]: { owner: true, enabled: true, capabilities: ['research:read'] } } } }]]);
  const etags = new Map();
  const fbGet = async (e, path) => ({ data: structuredClone(db.get(path) ?? null), etag: String(etags.get(path) || 0) });
  const fbPut = async (e, path, data, etag) => {
    if (beforePut) { const f = beforePut; beforePut = null; await f(); }
    if (etag !== String(etags.get(path) || 0)) return false;
    db.set(path, structuredClone(data)); etags.set(path, (etags.get(path) || 0) + 1); return true;
  };
  const ownerIdentity = async req => req.headers.get('Authorization') === 'Bearer owner-session' ? OWNER : null;
  const now = () => clock;
  const setup = createAgentSetup({ fbGet, fbPut, ownerIdentity, now });
  const robokap = createRoboKap({ fbGet, fbPut, ownerIdentity, now });
  const sled = createSledAgentGateway({ robokap });
  const pound = createPoundAgentGateway({ fbGet, fbPut, now });
  const responses = [];
  const keep = async res => { const text = res.status === 202 ? '' : await res.text(); return { status: res.status, body: text ? JSON.parse(text) : null, text }; };
  // Everything but the one-time issuance response is kept to prove no secret is ever echoed.
  const kept = async res => { const r = await keep(res); responses.push(r.text); return r; };
  const owner = body => setup(new Request('https://t/agent-setup/v1', { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer owner-session', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), env).then(body?.action === 'issue' ? keep : kept);
  const board = () => robokap.route(new Request('https://t/robokap/v1', { headers: { Authorization: 'Bearer owner-session' } }), env).then(kept);
  let rpc = 0;
  const call = (token, method, params, { path = false, headerToken } = {}) => sled(new Request('https://t/agents/v1/owners/' + OWNER + '/sled/' + (path ? token + '/' : '') + 'mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(!path || headerToken ? { Authorization: 'Bearer ' + (headerToken || token) } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method, ...(params ? { params } : {}) }) }), env).then(kept);
  const tool = async (token, name, args, opts) => { const r = await call(token, 'tools/call', { name, arguments: args }, opts); return { http: r.status, ...(r.body.result ? { error: r.body.result.isError, out: r.body.result.structuredContent } : { rpcError: r.body.error }) }; };
  let req = 0;
  const write = (token, op, data, request_id) => tool(token, 'sled_write', { op, request_id: request_id || 'sled_request_' + String(++req).padStart(8, '0'), data });
  const issue = (seat, scopes, label, ttlDays = 30) => owner({ action: 'issue', audience: 'sled', seat, scopes, label, ttlDays });
  return { env, db, owner, board, call, tool, write, issue, pound, responses, tick: ms => { clock += ms; }, onNextPut: f => { beforePut = f; }, bump: path => etags.set(path, (etags.get(path) || 0) + 1) };
}

test('the owner issues seat credentials whose seat and scopes are stored, shown once and never kept in clear', async () => {
  const w = await rig();
  const res = await w.issue('claude', ['sled:work:read', 'sled:work:claim'], 'PackResearch owner admin');
  assert.equal(res.status, 200);
  assert.match(res.body.secret, /^da1_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/);
  assert.equal(res.body.shownOnce, true);
  assert.deepEqual(res.body.capabilities, ['sled:work:read', 'sled:work:claim']);
  assert.equal(res.body.endpoint, 'https://toto.jkapcar4.workers.dev/agents/v1/owners/u_owner/sled/mcp');
  const stored = w.db.get(P).agentAccess[res.body.id];
  assert.equal(stored.audience, 'sled:u_owner');
  assert.equal(stored.seat, 'claude');
  assert.equal(stored.expiresAt - Date.parse('2026-10-31T12:00:00Z'), 30 * DAY);
  assert.ok(!JSON.stringify(w.db.get(P)).includes(res.body.secret), 'only the hash is stored');
  // One active credential per seat; bad requests change nothing.
  assert.equal((await w.issue('claude', ['sled:work:read'], 'Second')).body.error, 'active_seat_credential_exists_renew_or_revoke');
  assert.equal((await w.issue('owner', ['sled:work:read'], 'x')).body.error, 'invalid_seat');
  assert.equal((await w.issue('grok', ['sled:work:read', 'pound:task:read'], 'x')).body.error, 'invalid_scopes');
  assert.equal((await w.issue('grok', ['sled:work:claim'], 'x')).body.error, 'invalid_scopes', 'read is always included');
  assert.equal((await w.issue('grok', ['sled:work:read'], 'x', 31)).body.error, 'invalid_ttl');
  const listed = (await w.owner()).body;
  assert.equal(listed.sled.maxDays, 30);
  const row = listed.grants.find(g => g.audience === 'sled');
  assert.deepEqual([row.seat, row.daysLeft, row.status], ['claude', 30, 'issued_not_connection_verified']);
  assert.ok(!listed.grants.some(g => g.audience === 'pound'), 'a sled grant is not listed as a Pound grant');
});

test('each credential sees and runs only what its stored scopes allow, whatever its label claims', async () => {
  const w = await rig();
  const research = (await w.issue('claude', ['sled:work:read', 'sled:work:claim'], 'PackResearch owner admin')).body.secret;
  const coord = (await w.issue('coordinator', ['sled:work:read', 'sled:coordinate'], 'Coordinator')).body.secret;
  const review = (await w.issue('claude-reviewer', ['sled:work:read', 'sled:review'], 'Reviewer')).body.secret;
  const ops = async t => (await w.call(t, 'tools/list')).body.result.tools.find(x => x.name === 'sled_write').inputSchema.properties.op.enum;
  assert.deepEqual(await ops(research), ['rk.claim', 'rk.heartbeat', 'rk.release', 'rk.report']);
  assert.deepEqual(await ops(review), ['rk.review']);
  assert.deepEqual(await ops(coord), ['rk.intake', 'rk.dispatch', 'rk.notice', 'rk.plan', 'rk.propose']);
  const me = await w.tool(research, 'sled_read', { session_ref: 'claude-code:synthetic' });
  assert.equal(me.error, false);
  assert.equal(me.out.identity.seat, 'claude');
  assert.deepEqual(me.out.identity.scopes, ['sled:work:read', 'sled:work:claim']);
  assert.equal(me.out.identity.days_left, 30);
  // Out-of-scope writes and owner ops are refused as readable tool results with their status.
  const pin = { kind: 'pin', project_id: 'synthetic', pin_kind: 'sourcebook', ref: { type: 'pound_context', context_id: BRIEF, version: 1 } };
  const denied = await w.write(research, 'rk.propose', pin);
  assert.deepEqual([denied.http, denied.error, denied.out.status, denied.out.error, denied.out.detail.needs], [200, true, 403, 'scope_denied', 'sled:coordinate']);
  assert.equal((await w.write(coord, 'rk.decide', { subject: 'proposal' })).out.error, 'scope_denied');
  assert.equal((await w.write(coord, 'rk.pin', {})).out.detail.needs, 'owner_session');
  assert.equal((await w.tool(research, 'sled_read', { view: 'alerts' })).out.error, 'view_denied');
  // In scope: the coordinator's draft lands and replays on an identical resend.
  const draft = await w.write(coord, 'rk.propose', pin, 'sled_request_draft_0001');
  assert.equal(draft.error, false);
  const again = await w.write(coord, 'rk.propose', pin, 'sled_request_draft_0001');
  assert.equal(again.out.replayed, true);
  const b = (await w.board()).body.board;
  assert.equal(b.proposals.length, 1);
  assert.equal(b.proposals[0].type, 'pin');
  assert.equal(b.credentials.length, 3);
  assert.ok(b.credentials.every(c => !('credentialHash' in c)));
  // A sled credential is not a Pound credential.
  const poundRes = await w.pound(new Request('https://t/agents/v1/owners/u_owner/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + research, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), w.env);
  assert.equal(poundRes.status, 403);
  assert.ok(sledRoute('/agents/v1/owners/u_owner/sled/mcp') && !sledRoute('/agents/v1/owners/u_owner/mcp'));
  const secretParts = [research, coord, review].map(s => s.slice(37));
  assert.ok(w.responses.length > 10 && w.responses.every(r => !secretParts.some(p => r.includes(p))), 'no response after issuance echoes a secret');
  assert.ok(!secretParts.some(p => JSON.stringify([...w.db.values()]).includes(p)), 'no secret is stored');
});

test('the gateway is off by default and refuses missing, malformed or conflicting credentials', async () => {
  const off = await rig({ SLED_AGENTS_ENABLED: undefined });
  const t = (await off.issue('claude', ['sled:work:read'], 'R')).body.secret;
  assert.equal((await off.call(t, 'tools/list')).status, 503);
  const w = await rig();
  const good = (await w.issue('claude', ['sled:work:read'], 'R')).body.secret;
  assert.equal((await w.call('da1_' + 'a'.repeat(32) + '_' + 'b'.repeat(43), 'tools/list')).status, 403);
  assert.equal((await w.call('not-a-credential', 'tools/list')).status, 401);
  assert.equal((await w.call(good, 'tools/list', null, { path: true })).status, 200, 'path form for header-less clients');
  assert.equal((await w.call(good, 'tools/list', null, { path: true, headerToken: 'da1_' + 'c'.repeat(32) + '_' + 'd'.repeat(43) })).status, 401);
  assert.equal((await w.call(good, 'initialize', { protocolVersion: '2025-06-18' })).body.result.serverInfo.name, 'datadawgs-pack-sled');
});

test('expiry, renewal and revocation: an expired credential pauses, renewal resumes the same secret, revocation is final', async () => {
  const w = await rig();
  const issued = (await w.issue('claude', ['sled:work:read', 'sled:work:claim'], 'Research', 7)).body;
  const t = issued.secret;
  w.tick(5 * DAY);
  assert.match((await w.tool(t, 'sled_read', {})).out.identity.warning, /expires in 2 days/);
  w.tick(3 * DAY);
  assert.equal((await w.call(t, 'tools/list')).status, 403, 'expired');
  const renewed = await w.owner({ action: 'renew', audience: 'sled', agentId: issued.id, ttlDays: 30 });
  assert.equal(renewed.body.renewed, true);
  assert.ok(!('secret' in renewed.body), 'renewal never re-shows or changes the secret');
  assert.equal((await w.tool(t, 'sled_read', {})).out.identity.days_left, 30);
  assert.equal((await w.owner({ action: 'revoke', audience: 'sled', agentId: issued.id })).body.revoked, true);
  assert.equal((await w.call(t, 'tools/list')).status, 403);
  assert.equal((await w.owner({ action: 'renew', audience: 'sled', agentId: issued.id, ttlDays: 30 })).body.error, 'revoked_credential_issue_new');
  assert.equal((await w.issue('claude', ['sled:work:read'], 'Replacement')).status, 200, 'the seat can be issued again after revocation');
  const audit = w.db.get(P).agentSetupAudit.map(a => a.action);
  assert.deepEqual(audit, ['issue', 'renew', 'revoke', 'issue']);
});

test('a revocation saved while a write is in flight wins: the write is retried against fresh state and refused', async () => {
  const w = await rig();
  const coord = (await w.issue('coordinator', ['sled:work:read', 'sled:coordinate'], 'Coordinator')).body;
  w.onNextPut(async () => {
    // The owner's revocation commits between this write's read and its conditional put.
    const s = w.db.get(P);
    s.agentAccess[coord.id] = { ...s.agentAccess[coord.id], enabled: false, revokedAt: 1 };
    w.db.set(P, s); w.bump(P);
  });
  const res = await w.write(coord.secret, 'rk.notice', { key: 'synthetic-race-0001', action: 'reserve' });
  assert.deepEqual([res.error, res.out.status, res.out.error], [true, 403, 'agent_grant_required']);
  assert.ok(!(w.db.get(P).robokap || '').includes('synthetic-race-0001'), 'nothing was saved');
  assert.equal(w.db.get(P).agentAccess[coord.id].enabled, false, 'the revocation was not overwritten');
});
