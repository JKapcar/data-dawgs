/* RoboKap Worker integration. Default off: ROBOKAP_ENABLED must be exactly "true" (and the
 * existing DAWG_POUND_ENABLED too). Adds no credential, grant, schedule, store or external call.
 *
 * Storage: the existing Pound record /privatePounds/<owner>. Coordination records live in its
 * `robokap` key as one JSON string beside Pound's `payload`, under the same ETag
 * compare-and-swap. Every existing Pound writer spreads the envelope, so neither side can
 * erase the other. Backups already copy the whole private record (30-day private copy) and
 * keep it out of general backups.
 *
 * Lab: read only, through the owner's existing research access, to check links and receipt
 * hashes. RoboKap never writes /researchLab, never claims or runs a Lab task.
 *
 * Callers:
 *   /robokap/v1                 signed site session of RESEARCH_OWNER_UID (board + owner ops)
 *   dd_owner_robokap_read/write the owner connector, listed only while the RoboKap (pound) app
 *                               grant is on; principal = owner_key with the verified key label. */
import { rkApply, rkBoard, rkWork, rkParse, rkSerialize, RoboKapError, RK_CONNECTOR_OPS, RK_TOOL_DESCRIPTION, RK_LIMITS } from './robokap-core.mjs';
import { decodeEnvelope } from './exact-store.mjs';

const ORIGINS = ['https://datadawgs216.com', 'https://www.datadawgs216.com'];
const check = (ok, status, code, detail) => { if (!ok) throw new RoboKapError(status, code, detail); };
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const UID = /^u_[A-Za-z0-9_-]{1,100}$/, KEY = /^[A-Za-z0-9_-]{1,24}$/;
const CAPABILITY = Object.freeze({
  read_context: 'supported: a session holding a connector key reads its queue and pinned references when it runs',
  receive_task: 'supported by pull: dd_owner_robokap_read lists work addressed to the caller\'s key',
  wake_session: 'unsupported: nothing here can start or wake an assistant session; the owner opens it',
  execute: 'in-session only: the bound session does the work and returns evidence',
  scheduler: 'unconfigured',
});

export function createRoboKap({ fbGet, fbPut, ownerIdentity, now = Date.now }) {
  const enabled = env => env.ROBOKAP_ENABLED === 'true' && env.DAWG_POUND_ENABLED === 'true';
  const path = uid => '/privatePounds/' + uid;
  const ownerUid = (env, uid) => { check(typeof uid === 'string' && UID.test(uid) && uid === env.RESEARCH_OWNER_UID, 403, 'configured_owner_required'); return uid; };

  async function load(env, uid) {
    const snapshot = await fbGet(env, path(uid), true);
    check(snapshot && snapshot.etag, 503, 'conditional_storage_required');
    check(!snapshot.data || snapshot.data.owner_uid === uid, 403, 'owner_mismatch');
    let pound = { tasks: [], contexts: [] };
    if (snapshot.data) {
      check(typeof snapshot.data.payload === 'string', 503, 'pound_workspace_invalid');
      try { pound = JSON.parse(snapshot.data.payload); } catch { check(false, 503, 'pound_workspace_invalid'); }
    }
    return { snapshot, pound, rk: rkParse(snapshot.data?.robokap) };
  }

  // Read-only index of the owner's Lab tenant: versions, receipt hashes and splits only.
  async function labIndex(env, uid) {
    const tenant = env.RESEARCH_UPLOAD_TENANT;
    if (env.RESEARCH_LAB_ENABLED !== 'true' || !/^[A-Za-z0-9_-]{1,100}$/.test(tenant || '')) return null;
    try {
      const s = await fbGet(env, '/researchLab/v1/tenants/' + tenant, true);
      const g = s?.data?.access?.users?.[uid];
      if (!(g?.owner === true && g.enabled === true && Array.isArray(g.capabilities) && g.capabilities.includes('research:read') && (g.expiresAt == null || g.expiresAt > now()))) return null;
      const { state } = decodeEnvelope(s.data);
      const mine = x => x && x.tenant === tenant;
      return {
        tenant,
        hypotheses: new Map(state.hypotheses.filter(mine).map(h => [h.id, { version: h.revisions.length, status: h.revisions.at(-1)?.status ?? null }])),
        receipts: new Map(state.receipts.filter(mine).map(r => [r.id, { receiptHash: r.receiptHash, hypothesisId: r.hypothesisId, hypothesisVersion: r.hypothesisVersion, split: r.split, taskId: r.taskId }])),
        discussions: new Map(state.discussions.filter(mine).map(d => [d.id, { hypothesisId: d.hypothesisId, kind: d.kind }])),
      };
    } catch { return null; }
  }

  // Re-read, apply to fresh state, compare-and-swap. A lost race retries from fresh state;
  // the request id makes a retried success a replay rather than a second write.
  async function write(env, uid, principal, input, guard) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const loaded = await load(env, uid);
      check(loaded.snapshot.data, 409, 'pound_workspace_required');
      const lab = await labIndex(env, uid);
      const out = await rkApply(loaded.rk, loaded.pound, input, principal, now(), { lab });
      if (!out.changed) return out.result;
      const next = { ...loaded.snapshot.data, owner_uid: uid, robokap: rkSerialize(out.rk) };
      await guard();
      if (await fbPut(env, path(uid), next, loaded.snapshot.etag)) return out.result;
    }
    throw new RoboKapError(409, 'workspace_changed_retry_same_request');
  }

  const definitions = () => [
    {
      name: 'dd_owner_robokap_read', title: 'RoboKap work queue',
      description: 'Read the RoboKap coordination queue for THIS connector key: ready work addressed to your seat, your live leases, review requests and role offers, with each task\'s brief, plan version and pinned context reference. view "board" returns the owner\'s full board instead. Includes private text. Key label is server-verified; session_ref is declared; model identity is never verified. Nothing here wakes a session, schedules work or runs a model.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { session_ref: { type: 'string', minLength: 1, maxLength: 200, description: 'Declare which session is reading, for example claude-code:<session id>. Routing only; never authorization.' }, view: { type: 'string', enum: ['work', 'board'] } } },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'dd_owner_robokap_write', title: 'RoboKap coordination write', description: RK_TOOL_DESCRIPTION,
      inputSchema: { type: 'object', additionalProperties: false, required: ['op', 'request_id', 'data'], properties: { op: { type: 'string', enum: [...RK_CONNECTOR_OPS] }, request_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,80}$', description: 'Idempotency key. Resend the identical call after a timeout.' }, data: { type: 'object', description: 'Per-op fields; see the description.' } } },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
  ];

  async function connector(name, args, env, { uid, keyLabel }, guard) {
    check(enabled(env), 503, 'robokap_disabled');
    check(typeof keyLabel === 'string' && KEY.test(keyLabel), 401, 'verified_credential_label_required');
    check(isObj(args) && JSON.stringify(args).length <= RK_LIMITS.request_bytes, 400, 'invalid_arguments');
    const principal = { kind: 'owner_key', key_label: keyLabel };
    if (name === 'dd_owner_robokap_read') {
      check(Object.keys(args).every(k => ['session_ref', 'view'].includes(k)), 400, 'unexpected_arguments');
      check(args.session_ref === undefined || (typeof args.session_ref === 'string' && args.session_ref.trim() && args.session_ref.length <= 200), 400, 'invalid_session_ref');
      check(args.view === undefined || ['work', 'board'].includes(args.view), 400, 'invalid_view');
      const loaded = await load(env, uid), lab = await labIndex(env, uid);
      const body = args.view === 'board' ? await rkBoard(loaded.rk, loaded.pound, now(), { lab }) : await rkWork(loaded.rk, loaded.pound, now(), { lab }, { key_label: keyLabel, session_ref: args.session_ref });
      await guard();
      const result = { ...body, capability: CAPABILITY, holdout: 'sealed', lab: lab ? 'checked' : 'unavailable' };
      check(JSON.stringify(result).length <= 524288, 507, 'response_capacity');
      return result;
    }
    if (name === 'dd_owner_robokap_write') {
      check(Object.keys(args).every(k => ['op', 'request_id', 'data'].includes(k)), 400, 'unexpected_arguments');
      return write(env, uid, principal, args, guard);
    }
    throw new RoboKapError(404, 'unknown_private_tool');
  }

  async function readJson(request) {
    check((request.headers.get('Content-Type') || '').split(';')[0].trim() === 'application/json', 415, 'json_required');
    const reader = request.body?.getReader();
    check(reader, 400, 'body_required');
    const chunks = []; let size = 0, timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { reader.cancel().catch(() => {}); reject(new RoboKapError(408, 'body_timeout')); }, 10000); });
    try { for (;;) { const { done, value } = await Promise.race([reader.read(), timeout]); if (done) break; size += value.length; check(size <= RK_LIMITS.request_bytes, 413, 'request_too_large'); chunks.push(value); } }
    finally { clearTimeout(timer); await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new RoboKapError(400, 'invalid_json'); }
  }

  async function route(request, env) {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Vary': 'Origin, Authorization', 'X-Robots-Tag': 'noindex, nofollow' };
    const send = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    try {
      const url = new URL(request.url), origin = request.headers.get('Origin');
      check(!origin || ORIGINS.includes(origin), 403, 'origin_denied');
      if (origin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' });
      check(url.pathname === '/robokap/v1', 404, 'route_not_found');
      check(!url.search, 400, 'query_parameters_not_accepted');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      check(['GET', 'POST'].includes(request.method), 405, 'method_not_allowed');
      check(enabled(env), 503, 'robokap_disabled');
      const uid = ownerUid(env, await ownerIdentity(request, env));
      const board = async () => { const loaded = await load(env, uid), lab = await labIndex(env, uid); return rkBoard(loaded.rk, loaded.pound, now(), { lab }); };
      if (request.method === 'GET') return send({ board: await board(), capability: CAPABILITY, holdout: 'sealed' });
      const input = await readJson(request);
      const result = await write(env, uid, { kind: 'owner_session' }, input, async () => check(await ownerIdentity(request, env) === uid, 401, 'owner_session_changed'));
      return send({ result, board: await board(), capability: CAPABILITY, holdout: 'sealed' });
    } catch (e) {
      const status = e.status || e.poundStatus;
      return send({ error: status ? e.message : 'robokap_unavailable', ...(status && e.detail !== undefined ? { detail: e.detail } : {}) }, status || 503);
    }
  }

  return { enabled, definitions, connector, route };
}
