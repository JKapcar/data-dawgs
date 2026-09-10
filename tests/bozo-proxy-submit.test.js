// Phase 2.7 — proxy submit. The league manager (or site admin) files, replaces or
// removes a leg FOR another member through /bozo/pick with `forUid`. Every gate runs
// against the TARGET seat, the author is stamped from the SESSION, the timestamp is
// server-now (D20), and every proxy write leaves an admin/actions audit row.
//
// The route runs for real inside a vm sandbox: the real memberKeyOf / canActFor /
// bozoTargetSeat / commitBozoLeg / bozoPick from the Worker source, over an in-memory
// Firebase and KV. Capture and validation are stubbed — they are not what is under test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.join(__dirname, '..', 'dawg-bot-worker.js'), 'utf8');
const block = fs.readFileSync(path.join(__dirname, '..', 'work', 'mcp-block.js'), 'utf8');

function between(start, end) {
  const a = worker.indexOf(start);
  const b = worker.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source markers exist: ${start} … ${end}`);
  return worker.slice(a, b);
}

/* ---------------- source-level invariants ---------------- */

test('isSiteAdmin is the only admin check in the Worker', () => {
  assert.match(worker, /function isSiteAdmin\(auth, env\)/);
  const hits = worker.match(/env\.BOZO_ADMIN &&/g) || [];
  assert.equal(hits.length, 1, 'the legacy name check survives only inside the helper');
  assert.doesNotMatch(worker, /auth\.user && auth\.user\.roles && auth\.user\.roles\.site_admin === true/);
  assert.equal((worker.match(/isSiteAdmin\(auth, env\)/g) || []).length >= 3, true, 'the three former inline checks call it');
});

test('no route reads the author or a role from the body — forUid names a target only', () => {
  const pick = between('async function bozoPick(', '/* ---------- the DraftKings SGP rule');
  assert.match(pick, /const seat = bozoTargetSeat\(state, auth, env, body\.forUid\);/);
  const bodyReads = new Set(pick.match(/body\.\w+/g) || []);
  assert.deepEqual([...bodyReads].sort(), ['body.action', 'body.captureVersion', 'body.confirm', 'body.forUid', 'body.pick'],
    'the route reads exactly these body fields — no author, no role');
});

test('MCP tools accept forUid, the board carries provenance, and the audit tool is registered', () => {
  assert.match(block, /name: "dd_draft_bozo_leg",[\s\S]*?forUid: \{ type: "string"/);
  assert.match(block, /name: "dd_submit_bozo_leg",[\s\S]*?forUid: \{ type: "string"/);
  assert.match(block, /\n    name: "dd_bozo_admin_actions",\n    title: "Commissioner actions this week",\n    catalog: "core",\n    readOnlyHint: true,\n/);
  assert.match(block, /submittedBy: x\.commissionerModified === true/);
  assert.match(block, /commissionerModified: x\.commissionerModified === true/);
  assert.doesNotMatch(block, /own leg only/);
  // the assembled worker carries the same block
  assert.match(worker, /name: "dd_bozo_admin_actions"/);
  // one commit and one audit call inside the block, both in the confirm branch
  const mcp = worker.slice(worker.indexOf('DD-MCP-BLOCK START'));
  assert.equal((mcp.match(/commitBozoLeg\(/g) || []).length, 1);
  assert.equal((mcp.match(/bozoAdminAction\(/g) || []).length, 1);
  for (const banned of ['fbPut(', 'fbPatch(', 'fbDelete(']) assert.ok(!mcp.includes(banned), banned);
});

/* ---------------- the route, live in a sandbox ---------------- */

function tree() {
  const root = {};
  const segs = p => p.split('/').filter(Boolean);
  const clone = v => JSON.parse(JSON.stringify(v));
  return {
    put(p, v) {
      const s = segs(p); let n = root;
      for (const k of s.slice(0, -1)) n = (n[k] && typeof n[k] === 'object') ? n[k] : (n[k] = {});
      n[s[s.length - 1]] = clone(v);
    },
    patch(p, obj) { for (const [k, v] of Object.entries(obj)) this.put(p + '/' + k, v); },
    get(p) {
      let n = root;
      for (const k of segs(p)) { if (!n || typeof n !== 'object' || !(k in n)) return null; n = n[k]; }
      return n == null ? null : clone(n);
    },
    del(p) {
      const s = segs(p); let n = root;
      for (const k of s.slice(0, -1)) { if (!n[k]) return; n = n[k]; }
      delete n[s[s.length - 1]];
    },
  };
}

function rig() {
  const fb = tree();
  const ctx = { auth: null, tripwires: [], logs: [], placed: false, validate: () => null };
  const kv = { store: new Map(), async get(k) { return this.store.has(k) ? this.store.get(k) : null; }, async put(k, v) { this.store.set(k, v); } };
  const env = { RL: kv, BOZO_ADMIN: 'Kap' };
  const sandbox = {
    fbPut: async (e, p, v) => { fb.put(p, v); return true; },
    fbPatch: async (e, p, o) => { fb.patch(p, o); return true; },
    fbGet: async (e, p) => ({ data: fb.get(p) }),
    fbDelete: async (e, p) => { fb.del(p); return true; },
    json: (body, status) => ({ status, body }),
    sessionAuth: async () => ctx.auth,
    readBody: async req => req.body,
    leagueOf: body => (body && body.league) || 'main',
    loadLeague: async (e, lid) => fb.get('/bozo/leagues/' + lid),
    settingsOf: lg => ({ format: lg.format || 'standard', allowEdit: lg.allowEdit !== false, lockRule: 'all', levers: [] }),
    bandOf: () => ({ ceil: -100, floor: -500 }),
    validatePick: (...a) => ctx.validate(...a),
    bozoCaptureEntry: async (e, input) => ({ ok: true, p: { ...input, price: -150, priceOpp: 130, priceSource: 'captured' } }),
    royaleAliveKey: (state, key) => !((state.royale && state.royale.dead) || []).includes(key),
    royaleStatus: state => Object.fromEntries(((state.royale && state.royale.dead) || []).map(k => [k, { chopped: [1] }])),
    royaleRoster: state => Object.keys(state.members || {}).filter(k => !((state.royale && state.royale.dead) || []).includes(k)),
    selectionKeyOf: p => [p.eventId, p.mkt, p.side, p.line].join('|'),
    marketKeyOf: p => [p.eventId, p.mkt].join('|'),
    placeAndDraw: async () => { ctx.placed = true; return true; },
    bozoNullWriteTripwire: (route, auth, lid, nulled) => ctx.tripwires.push({ route, nulled }),
    crypto: globalThis.crypto,
    console: { log: m => ctx.logs.push(m) },
    Date, JSON, Math, Number, String, Object, Array, Error, Uint32Array, isNaN, isFinite,
  };
  vm.createContext(sandbox);
  vm.runInContext([
    'const LG = lid => "/bozo/leagues/" + lid;',
    'const playerName = k => { try { return decodeURIComponent(k); } catch { return k; } };',
    between('const memberRec = (lg, key)', '// Everything that existed before leagues belongs to DEFAULT_LEAGUE'),
    between('async function commitBozoLeg(', 'async function bozoPick('),
    between('async function bozoPick(', '/* ---------- the DraftKings SGP rule'),
    'this.api = { memberKeyOf, memberKeys, memberNameAt, isSiteAdmin, canActFor, memberKeyOfRef, bozoTargetSeat, bozoPick };',
  ].join('\n'), sandbox);
  const api = sandbox.api;
  const post = (auth, body) => { ctx.auth = auth; return api.bozoPick({ method: 'POST', body }, env, {}); };
  const submit = async (auth, extra = {}, pick = PICK) => {
    const p1 = await post(auth, { captureVersion: 1, pick, ...extra });
    if (p1.status !== 200) return p1;
    return post(auth, { confirm: p1.body.confirm_code, ...extra });
  };
  const seed = (over = {}) => fb.put('/bozo/leagues/main', {
    name: 'Test', managerUid: 'u_mgr', week: 2, status: 'open',
    members: { u_mgr: { name: 'Manny' }, u_rog: { name: 'Roger' }, u_sue: { name: 'Sue' }, u_ann: { name: 'Ann' } },
    ...over,
  });
  const league = () => fb.get('/bozo/leagues/main');
  const audit = () => Object.values((league().admin || {}).actions || {});
  return { api, env, ctx, kv, fb, post, submit, seed, league, audit };
}

const PICK = { sport: 'cfb', eventId: '401', game: 'UAB @ NAVY', mkt: 'ml', side: 'NAVY', line: 0, label: 'NAVY ML', startsAt: '2026-09-12T19:30:00.000Z' };
const MGR = { uid: 'u_mgr', name: 'Manny', user: { roles: {} } };
const ROGER = { uid: 'u_rog', name: 'Roger', user: {} };
const SUE = { uid: 'u_sue', name: 'Sue', user: {} };
const ADMIN = { uid: 'u_adm', name: 'Ada', user: { roles: { site_admin: true } } };   // not on the roster

test('proxy submit by the manager: 200, provenance stamped, real ts, proxy_submit audit row', async () => {
  const r = rig(); r.seed();
  const t0 = Date.now();
  const res = await r.submit(MGR, { forUid: 'u_rog' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.forName, 'Roger');
  assert.equal(res.body.commissionerModified, true);
  const leg = r.league().picks.u_rog;
  assert.equal(leg.who, 'Roger');
  assert.equal(leg.submittedBy, 'u_mgr');
  assert.equal(leg.submittedByName, 'Manny');
  assert.equal(leg.commissionerModified, true);
  assert.ok(leg.ts >= t0 && leg.ts <= Date.now(), 'server time at the manager\'s write, no backdating');
  assert.ok(!r.league().picks.u_mgr, 'the manager\'s own seat is untouched');
  const rows = r.audit();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'proxy_submit');
  assert.deepEqual([rows[0].byUid, rows[0].byName, rows[0].forUid, rows[0].forName, rows[0].leagueId, rows[0].week, rows[0].before, rows[0].ticketWasPlaced],
    ['u_mgr', 'Manny', 'u_rog', 'Roger', 'main', 2, null, false]);
  assert.equal(rows[0].after.label, 'NAVY ML');
});

test('proxy edit: the audit row is proxy_edit with before and after', async () => {
  const r = rig(); r.seed();
  assert.equal((await r.submit(MGR, { forUid: 'u_rog' })).status, 200);
  await new Promise(res => setTimeout(res, 2));   // distinct Date.now() audit keys
  const res = await r.submit(MGR, { forUid: 'u_rog' }, { ...PICK, label: 'NAVY -3.5', mkt: 'spread', line: -3.5 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const rows = r.audit();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].type, 'proxy_edit');
  assert.equal(rows[1].before.label, 'NAVY ML');
  assert.equal(rows[1].after.label, 'NAVY -3.5');
});

test('proxy remove: the target pick is deleted, the tripwire names the proxy route, audit row proxy_remove', async () => {
  const r = rig(); r.seed();
  assert.equal((await r.submit(MGR, { forUid: 'u_rog' })).status, 200);
  await new Promise(res => setTimeout(res, 2));
  const res = await r.post(MGR, { action: 'remove', forUid: 'u_rog' });
  assert.equal(res.status, 200);
  assert.equal(res.body.forName, 'Roger');
  assert.ok(!(r.league().picks || {}).u_rog);
  assert.deepEqual(JSON.parse(JSON.stringify(r.ctx.tripwires.at(-1))), { route: '/bozo/pick proxy remove', nulled: ['picks/u_rog'] });
  const rows = r.audit();
  assert.equal(rows.at(-1).type, 'proxy_remove');
  assert.equal(rows.at(-1).before.label, 'NAVY ML');
  assert.equal(rows.at(-1).after, null);
});

test('a plain member naming someone else: 403, nothing written, no audit row', async () => {
  const r = rig(); r.seed();
  const res = await r.submit(ROGER, { forUid: 'u_sue' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'Only the league manager can submit for another member.');
  assert.ok(!r.league().picks);
  assert.equal(r.audit().length, 0);
  assert.equal(r.kv.store.size, 0);
  const rm = await r.post(ROGER, { action: 'remove', forUid: 'u_sue' });
  assert.equal(rm.status, 403);
});

test('the site admin can act in a league they do not manage or sit in — by role flag, and by legacy BOZO_ADMIN name', async () => {
  const r = rig(); r.seed();
  const byRole = await r.submit(ADMIN, { forUid: 'u_sue' });
  assert.equal(byRole.status, 200, JSON.stringify(byRole.body));
  assert.equal(r.league().picks.u_sue.submittedBy, 'u_adm');
  assert.equal(r.league().picks.u_sue.commissionerModified, true);
  const legacy = { name: 'Kap' };   // name-only session, matches env.BOZO_ADMIN
  const byName = await r.submit(legacy, { forUid: 'Ann' });   // display name resolves too
  assert.equal(byName.status, 200, JSON.stringify(byName.body));
  assert.equal(r.league().picks.u_ann.commissionerModified, true);
  assert.equal(r.league().picks.u_ann.submittedByName, 'Kap');
});

test('manager with a forUid that is not on the roster: 404', async () => {
  const r = rig(); r.seed();
  const res = await r.submit(MGR, { forUid: 'u_nobody' });
  assert.equal(res.status, 404);
  assert.equal(r.audit().length, 0);
});

test('Royale: proxy for a chopped member is refused with 409', async () => {
  const r = rig(); r.seed({ format: 'royale', royale: { dead: ['u_rog'] } });
  const res = await r.submit(MGR, { forUid: 'u_rog' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Roger is out/);
  assert.ok(!r.league().picks);
});

test('allowEdit=false and the target already has a leg: 409 — no manager override here (Phase 6)', async () => {
  const r = rig(); r.seed({ allowEdit: false });
  assert.equal((await r.submit(MGR, { forUid: 'u_rog' })).status, 200);
  const res = await r.submit(MGR, { forUid: 'u_rog' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Roger's is already in/);
  assert.equal(r.audit().length, 1);
});

test('forUid naming yourself is a self-submit: no commissionerModified, no audit row', async () => {
  const r = rig(); r.seed();
  const res = await r.submit(ROGER, { forUid: 'u_rog' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.forName, undefined);
  const leg = r.league().picks.u_rog;
  assert.equal(leg.submittedBy, 'u_rog');
  assert.equal(leg.commissionerModified, undefined);
  assert.equal(leg.submittedByName, undefined);
  assert.equal(r.audit().length, 0);
});

test('a self-submit without forUid is unchanged in shape and stamps submittedBy = own uid', async () => {
  const r = rig(); r.seed();
  const res = await r.submit(ROGER);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body).sort(), ['leg', 'need', 'ok', 'placed', 'size', 'status', 'ts']);
  const leg = r.league().picks.u_rog;
  assert.equal(leg.submittedBy, 'u_rog');
  assert.equal('commissionerModified' in leg, false);
  assert.equal(r.audit().length, 0);
});

test('two proxy proposals for different targets inside five minutes hold distinct KV keys and both confirm', async () => {
  const r = rig(); r.seed();
  const a = await r.post(MGR, { captureVersion: 1, pick: PICK, forUid: 'u_rog' });
  const b = await r.post(MGR, { captureVersion: 1, pick: { ...PICK, eventId: '402', label: 'ARMY ML', side: 'ARMY' }, forUid: 'u_sue' });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const keys = [...r.kv.store.keys()].filter(k => k.startsWith('bozoconfirm:'));
  assert.deepEqual(keys.sort(), ['bozoconfirm:u_mgr:main:u_rog', 'bozoconfirm:u_mgr:main:u_sue']);
  // a confirm that forgets the target lands on a different key and cannot cross over
  const stray = await r.post(MGR, { confirm: a.body.confirm_code });
  assert.equal(stray.status, 409);
  assert.equal((await r.post(MGR, { confirm: a.body.confirm_code, forUid: 'u_rog' })).status, 200);
  assert.equal((await r.post(MGR, { confirm: b.body.confirm_code, forUid: 'u_sue' })).status, 200);
  assert.equal(r.league().picks.u_rog.label, 'NAVY ML');
  assert.equal(r.league().picks.u_sue.label, 'ARMY ML');
  assert.equal(r.audit().length, 2);
});

test('name-keyed league (manager string, no managerUid): the manager resolves through the fallback', async () => {
  const r = rig();
  r.seed({ managerUid: undefined, manager: 'Manny', members: { Manny: true, Roger: true, 'The%20Kid': true } });
  const mgr = { name: 'Manny' };   // legacy session: no uid
  assert.equal(r.api.canActFor(r.league(), mgr, r.env), true);
  assert.equal(r.api.canActFor(r.league(), { name: 'Roger' }, r.env), false);
  const res = await r.submit(mgr, { forUid: 'The Kid' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(r.league().picks['The%20Kid'].who, 'The Kid');
  assert.equal(r.league().picks['The%20Kid'].commissionerModified, true);
  assert.equal(r.audit()[0].forUid, 'The%20Kid');
});

test('canActFor: uid-keyed manager, managerUid-by-name fallback, and never from the body', () => {
  const r = rig();
  const lg = { managerUid: 'u_mgr', members: { u_mgr: { name: 'Manny' }, u_rog: { name: 'Roger' } } };
  assert.equal(r.api.canActFor(lg, { uid: 'u_mgr', name: 'Manny' }, r.env), true);
  assert.equal(r.api.canActFor(lg, { name: 'Manny' }, r.env), true, 'name-only session of the uid-keyed manager');
  assert.equal(r.api.canActFor(lg, { uid: 'u_rog', name: 'Roger', role: 'manager', siteAdmin: true }, r.env), false);
  assert.equal(r.api.canActFor(lg, { uid: 'u_x', name: 'Kap' }, r.env), true, 'legacy BOZO_ADMIN name');
  assert.equal(r.api.canActFor(lg, { uid: 'u_x', name: 'Kap' }, {}), false, 'no BOZO_ADMIN configured');
  assert.equal(r.api.isSiteAdmin({ uid: 'u_a', name: 'Ada', roles: { site_admin: true } }, {}), true, 'MCP caller shape');
  assert.equal(r.api.isSiteAdmin({ uid: 'u_a', name: 'Ada', user: { roles: { site_admin: 'yes' } } }, {}), false);
});

test('stillWaitingOn drops the target once a proxy leg lands for them', async () => {
  const r = rig(); r.seed();
  const waiting = () => { const lg = r.league(); const picks = lg.picks || {}; return r.api.memberKeys(lg).filter(k => !picks[k]).map(k => r.api.memberNameAt(lg, k)); };
  assert.deepEqual(waiting(), ['Manny', 'Roger', 'Sue', 'Ann']);
  assert.equal((await r.submit(MGR, { forUid: 'u_rog' })).status, 200);
  assert.deepEqual(waiting(), ['Manny', 'Sue', 'Ann']);
});

test('the board locks on the proxy leg that fills it, like any other', async () => {
  const r = rig(); r.seed({ members: { u_mgr: { name: 'Manny' }, u_rog: { name: 'Roger' } } });
  assert.equal((await r.submit(MGR)).status, 200);
  const res = await r.submit(MGR, { forUid: 'u_rog' });
  assert.equal(res.status, 200);
  assert.equal(res.body.placed, true);
  assert.equal(r.ctx.placed, true);
});
