// Phase 2.9 (D22) — roster changes at any time. Membership is independent of the live
// ticket: a seat taken while a ticket is placed is `pending` (on the roster, sees the
// board, cannot submit, does NOT move the lock threshold), a seat removed while its leg
// is on a placed ticket becomes `leaving` (the leg still grades), and /bozo/next resolves
// both. The gate that used to refuse the whole roster change is gone; what protects the
// board is the threshold counting ACTIVE seats only.
//
// The routes run for real inside a vm sandbox — the actual memberStatusAt / activeNames /
// leagueJoin / leagueMember / leagueMemberAdd / bozoNext / bozoTargetSeat from the Worker
// source, over an in-memory Firebase and KV. Password hashing, capture and pick
// validation are stubbed; they are not what is under test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.join(__dirname, '..', 'dawg-bot-worker.js'), 'utf8');
const block = fs.readFileSync(path.join(__dirname, '..', 'work', 'mcp-block.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'bozo.html'), 'utf8');

function between(start, end) {
  const a = worker.indexOf(start);
  const b = worker.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source markers exist: ${start} … ${end}`);
  return worker.slice(a, b);
}

/* ---------------- source-level invariants ---------------- */

test('the mid-week status gate is gone from both roster routes', () => {
  const join = between('async function leagueJoin(request, env, cors) {', '// POST /league/access');
  const member = between('async function leagueMember(request, env, cors) {', '// POST /league/lock {league}');
  for (const [name, src] of [['join', join], ['member', member]])
    assert.doesNotMatch(src, /roster changes wait for next week|you can join once next week opens/i,
      `${name} no longer refuses on league status`);
  // and both still read the status — to CHOOSE the seat's status, not to refuse
  for (const src of [join, member]) assert.match(src, /=== "open" \? "active" : "pending"/);
});

test('every threshold counts active seats, never the raw member count', () => {
  // the site commit path and both MCP tools
  assert.doesNotMatch(worker, /const size = set\.format === "royale" \? royaleRoster\((state|lg)\)\.length : memberNames\(/);
  assert.doesNotMatch(worker, /const size = memberNames\(lg\)\.length;\n\s+const need =/);
  assert.match(worker, /const size = set\.format === "royale" \? royaleRoster\(state\)\.length : activeNames\(state\)\.length;/);
  // royale's alive roster is alive AND active
  assert.match(worker, /\.filter\(\(\[k, s\]\) => s\.alive && memberIsActive\(state, k\)\)/);
  // nobody is left computing a waiting list off every seat
  assert.doesNotMatch(worker, /memberKeys\(lg\)\.filter\(k => !picks\[k\]\)/);
  assert.equal((worker.match(/waitingKeys\(/g) || []).length >= 3, true);
});

test('absent status reads as active — the normaliser never passes a value through', () => {
  const helpers = between('const MEMBER_STATUSES = [', 'const memberIsActive');
  assert.match(helpers, /MEMBER_STATUSES\.includes\(s\) \? s : "active"/);
});

test('the MCP surface exposes seat status on both league readers', () => {
  assert.match(block, /memberStatus: Object\.fromEntries\(memberKeys\(lg\)\.map\(k => \[memberNameAt\(lg, k\), memberStatusAt\(lg, k\)\]\)\)/);
  assert.match(block, /pending: memberKeys\(lg\)\.filter\(k => memberStatusAt\(lg, k\) === "pending"\)/);
  assert.match(block, /leaving: memberKeys\(lg\)\.filter\(k => memberStatusAt\(lg, k\) === "leaving"\)/);
  assert.doesNotMatch(block, /memberKeys\(lg\)\.filter\(k => !picks\[k\]\)/);
  // the assembled Worker carries the same block
  assert.ok(worker.includes('pending: memberKeys(lg).filter(k => memberStatusAt(lg, k) === "pending")'));
});

test('the page reads seat status from both sources and defaults to active', () => {
  assert.match(page, /const seatStatusOf = n => \{/);
  assert.match(page, /return dir \? String\(dir\) : 'active';/);
  assert.match(page, /const activeNames = \(\) => names\(\)\.filter\(isActiveSeat\);/);
  // no denominator is taken off the full roster any more
  assert.doesNotMatch(page, /const size = isRoyale\(\) \? royaleAliveNames\(\)\.length : names\(\)\.length;/);
  assert.match(page, /action:'add'/);
});

/* ---------------- the routes, live in a sandbox ---------------- */

// ⚠️ Values returned from the sandbox carry ITS realm's Array/Object prototypes, so
// deepStrictEqual on them fails on identity even when the structure matches. Round-trip.
const plain = v => JSON.parse(JSON.stringify(v));

function tree() {
  const root = {};
  const segs = p => p.split('/').filter(Boolean);
  const clone = v => JSON.parse(JSON.stringify(v));
  return {
    put(p, v) {
      const s = segs(p); let n = root;
      for (const k of s.slice(0, -1)) n = (n[k] && typeof n[k] === 'object') ? n[k] : (n[k] = {});
      if (v === null) delete n[s[s.length - 1]]; else n[s[s.length - 1]] = clone(v);
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
  const ctx = { auth: null, tripwires: [], logs: [], placed: 0, cap: 8, passwordOk: true };
  const kv = { store: new Map(), async get(k) { return this.store.has(k) ? this.store.get(k) : null; }, async put(k, v) { this.store.set(k, v); } };
  const env = { RL: kv, JOIN: kv, BOZO_ADMIN: 'Kap' };

  const sandbox = {
    fbPut: async (e, p, v) => { fb.put(p, v); return true; },
    fbPatch: async (e, p, o) => { fb.patch(p, o); return true; },
    fbGet: async (e, p) => ({ data: fb.get(p) }),
    fbDelete: async (e, p) => { fb.del(p); return true; },
    json: (body, status) => ({ status, body }),
    sessionAuth: async () => ctx.auth,
    requireManager: async (req, e, lid) => {
      const lg = fb.get('/bozo/leagues/' + lid);
      if (!ctx.auth || ctx.auth.err) return { err: 'Sign in.', code: 401 };
      const ok = lg && (lg.managerUid === ctx.auth.uid || lg.manager === ctx.auth.name
        || (ctx.auth.user && ctx.auth.user.roles && ctx.auth.user.roles.site_admin));
      return ok ? { ...ctx.auth, league: lg } : { err: 'That league is managed by another account.', code: 403 };
    },
    readBody: async req => req.body,
    leagueOf: body => (body && body.league) || 'main',
    loadLeague: async (e, lid) => fb.get('/bozo/leagues/' + lid),
    loadLeagues: async () => fb.get('/bozo/leagues'),
    loadUsers: async () => fb.get('/users') || {},
    settingsOf: lg => ({ format: lg.format || 'standard', allowEdit: lg.allowEdit !== false, lockRule: 'all', levers: [] }),
    bandOf: () => ({ ceil: -100, floor: -500 }),
    validatePick: () => null,
    bozoCaptureEntry: async (e, input) => ({ ok: true, p: { ...input, price: -150, priceOpp: 130, priceSource: 'captured' } }),
    royaleAliveKey: () => true,
    royaleStatus: () => ({}),
    selectionKeyOf: p => [p.eventId, p.mkt, p.side, p.line].join('|'),
    marketKeyOf: p => [p.eventId, p.mkt].join('|'),
    placeAndDraw: async () => { ctx.placed++; return true; },
    bozoNullWriteTripwire: (route, auth, lid, nulled) => ctx.tripwires.push({ route, nulled }),
    // join plumbing
    JOIN_KV: () => kv,
    JOIN_LG: lid => 'joinlg:' + lid,
    JOIN_REDEEM_PER_DAY: 50,
    normLeaguePassword: v => String(v || ''),
    validLeagueId: id => /^[a-z0-9-]{2,40}$/.test(String(id || '')),
    validLeaguePassword: v => String(v || '').length >= 6,
    joinCapOf: () => ctx.cap,
    leaguePasswordHash: async () => 'H',
    joinPassHash: async () => 'H',
    timingSafeEqual: () => ctx.passwordOk,
    accountName: (key, rec) => String((rec && rec.name) || key || ''),
    UID_RE: /^u_[a-z0-9]+$/,
    SEASON: 2026,
    crypto: globalThis.crypto,
    console: { log: m => ctx.logs.push(m) },
    Date, JSON, Math, Number, String, Object, Array, Error, Uint32Array, isNaN, isFinite, parseInt, RegExp,
  };
  vm.createContext(sandbox);
  vm.runInContext([
    'const LG = lid => "/bozo/leagues/" + lid;',
    'const playerName = k => { try { return decodeURIComponent(k); } catch { return k; } };',
    between('const memberRec = (lg, key)', '// Everything that existed before leagues belongs to DEFAULT_LEAGUE'),
    between('const BOZO_PERIODS = [', '/* ---------------- player props ----------------'),
    between('async function leagueMember(request, env, cors) {', '// POST /league/lock {league}'),
    between('async function leagueJoin(request, env, cors) {', '// POST /league/access'),
    between('async function bozoNext(request, env, cors) {', '/* ================================= util'),
    between('async function leagueReopen(request, env, cors) {', '/* ============================ the betslip link'),
    between('async function commitBozoLeg(', 'async function bozoPick('),
    between('async function bozoPick(', '/* ---------- the DraftKings SGP rule'),
    'this.api = { memberStatusAt, memberIsActive, activeNames, activeKeys, waitingKeys, memberNames,'
      + ' leagueMember, leagueJoin, bozoNext, bozoPick, bozoTargetSeat, leagueReopen };',
  ].join('\n'), sandbox);

  const api = sandbox.api;
  const call = (fn, auth, body) => { ctx.auth = auth; return api[fn]({ method: 'POST', body, headers: new Map() }, env, {}); };
  const seed = (over = {}) => {
    kv.store.set('joinlg:main', JSON.stringify({ passwordHash: 'H', cap: 8 }));
    fb.put('/users', {
      u_mgr: { name: 'Manny' }, u_rog: { name: 'Roger' }, u_sue: { name: 'Sue' },
      u_new: { name: 'Nina' }, u_two: { name: 'Otto' },
      'Legacy%20Len': { name: 'Legacy Len' },     // an account that predates the uid re-key
    });
    fb.put('/bozo/leagues/main', {
      name: 'Test', manager: 'Manny', managerUid: 'u_mgr', week: 2, status: 'open',
      members: { u_mgr: { name: 'Manny' }, u_rog: { name: 'Roger' }, u_sue: { name: 'Sue' } },
      ...over,
    });
  };
  const league = () => fb.get('/bozo/leagues/main');
  const audit = () => Object.values((league().admin || {}).actions || {});
  return { api, env, ctx, fb, call, seed, league, audit };
}

const MGR = { uid: 'u_mgr', name: 'Manny', user: { roles: {} } };
const ROGER = { uid: 'u_rog', name: 'Roger', user: {} };
const NINA = { uid: 'u_new', name: 'Nina', user: {} };
const LEG = { sport: 'cfb', eventId: '401', game: 'UAB @ NAVY', mkt: 'ml', side: 'NAVY', line: 0, label: 'NAVY ML', startsAt: '2026-09-12T19:30:00.000Z' };

/* ---------------- join ---------------- */

test('join while the ticket is placed: 200, the seat is pending, need does not move', async () => {
  const r = rig(); r.seed({ status: 'placed', picks: { u_mgr: {}, u_rog: {}, u_sue: {} } });
  const before = r.api.activeNames(r.league()).length;
  const res = await r.call('leagueJoin', NINA, { league: 'main', password: 'passw0rd' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'pending');
  assert.match(res.body.note, /first leg is due when the next week opens/);
  assert.equal(r.league().members.u_new.status, 'pending');
  assert.equal(r.api.activeNames(r.league()).length, before, 'the lock threshold is unchanged');
  assert.equal(r.ctx.placed, 0, 'nothing was placed by a join');
});

test('join on an open board: active, exactly as before', async () => {
  const r = rig(); r.seed();
  const res = await r.call('leagueJoin', NINA, { league: 'main', password: 'passw0rd' });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'active');
  assert.equal(res.body.note, null);
  assert.equal(r.league().members.u_new.status, 'active');
  assert.equal(r.api.activeNames(r.league()).length, 4);
});

test('a pending member re-joining is told what their seat means, not refused', async () => {
  const r = rig(); r.seed({ status: 'placed' });
  await r.call('leagueJoin', NINA, { league: 'main', password: 'passw0rd' });
  const res = await r.call('leagueJoin', NINA, { league: 'main', password: 'passw0rd' });
  assert.equal(res.status, 200);
  assert.equal(res.body.already, true);
  assert.equal(res.body.status, 'pending');
});

/* ---------------- manager add ---------------- */

test('manager add while placed: pending seat, addedBy stamped, roster_add audit row', async () => {
  const r = rig(); r.seed({ status: 'placed' });
  const res = await r.call('leagueMember', MGR, { league: 'main', action: 'add', player: 'Nina' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'pending');
  const seat = r.league().members.u_new;
  assert.deepEqual([seat.name, seat.status, seat.addedBy], ['Nina', 'pending', 'u_mgr']);
  const row = r.audit().at(-1);
  assert.equal(row.type, 'roster_add');
  assert.deepEqual([row.byName, row.forUid, row.forName, row.ticketWasPlaced], ['Manny', 'u_new', 'Nina', true]);
});

test('manager add on an open board: active immediately and counted', async () => {
  const r = rig(); r.seed();
  const res = await r.call('leagueMember', MGR, { league: 'main', action: 'add', player: 'Nina' });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'active');
  assert.equal(r.api.activeNames(r.league()).length, 4);
});

test('add is refused for a non-manager, for an unknown name, for a legacy account, and over the cap', async () => {
  { const r = rig(); r.seed();
    const res = await r.call('leagueMember', ROGER, { league: 'main', action: 'add', player: 'Nina' });
    assert.equal(res.status, 403);
    assert.ok(!r.league().members.u_new); }
  { const r = rig(); r.seed();
    const res = await r.call('leagueMember', MGR, { league: 'main', action: 'add', player: 'Ghost' });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /doesn't have an account yet/); }
  { const r = rig(); r.seed();
    const res = await r.call('leagueMember', MGR, { league: 'main', action: 'add', player: 'Legacy Len' });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /predates the current account system/);
    assert.deepEqual(plain(Object.keys(r.league().members)), ['u_mgr', 'u_rog', 'u_sue'], 'no name-shaped key was invented'); }
  { const r = rig(); r.seed(); r.ctx.cap = 3;
    const res = await r.call('leagueMember', MGR, { league: 'main', action: 'add', player: 'Nina' });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /full \(3 members\)/); }
  { const r = rig(); r.seed();
    const res = await r.call('leagueMember', MGR, { league: 'main', action: 'add', player: 'Roger' });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /already in this league/); }
});

/* ---------------- manager remove ---------------- */

test('remove a member whose leg is on the PLACED ticket: the seat is retired, the leg survives', async () => {
  const r = rig(); r.seed({ status: 'placed', picks: { u_rog: { label: 'NAVY ML', who: 'Roger' } } });
  const res = await r.call('leagueMember', MGR, { league: 'main', action: 'remove', player: 'Roger' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'leaving');
  assert.equal(r.league().members.u_rog.status, 'leaving');
  assert.equal(r.league().picks.u_rog.label, 'NAVY ML', 'the leg on the struck ticket is untouched');
  assert.ok(!r.api.activeNames(r.league()).includes('Roger'));
  assert.equal(r.audit().at(-1).type, 'roster_remove');
});

test('remove a member with a leg on an OPEN board still refuses, and names the way out', async () => {
  const r = rig(); r.seed({ picks: { u_rog: { label: 'NAVY ML' } } });
  const res = await r.call('leagueMember', MGR, { league: 'main', action: 'remove', player: 'Roger' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Remove the leg first/);
  assert.ok(r.league().members.u_rog, 'the seat is intact');
});

test('the same removal succeeds once the manager has proxy-removed the leg', async () => {
  const r = rig(); r.seed({ picks: { u_rog: { label: 'NAVY ML' } } });
  assert.equal((await r.call('leagueMember', MGR, { league: 'main', action: 'remove', player: 'Roger' })).status, 409);
  const gone = await r.call('bozoPick', MGR, { league: 'main', action: 'remove', forUid: 'u_rog' });
  assert.equal(gone.status, 200);
  const res = await r.call('leagueMember', MGR, { league: 'main', action: 'remove', player: 'Roger' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'removed');
  assert.ok(!r.league().members.u_rog);
});

test('remove with no leg while placed deletes the seat outright, and the manager cannot leave', async () => {
  { const r = rig(); r.seed({ status: 'placed', picks: { u_mgr: {} } });
    const res = await r.call('leagueMember', MGR, { league: 'main', action: 'remove', player: 'Roger' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'removed');
    assert.ok(!r.league().members.u_rog);
    assert.deepEqual(JSON.parse(JSON.stringify(r.ctx.tripwires.at(-1))),
      { route: '/league/member', nulled: ['members/u_rog'] }); }
  { const r = rig(); r.seed();
    const res = await r.call('leagueMember', MGR, { league: 'main', action: 'remove', player: 'Manny' });
    assert.equal(res.status, 400); }
});

test('a removal that completes the board locks it, off the ACTIVE count', async () => {
  const r = rig(); r.seed({
    picks: { u_mgr: {}, u_rog: {} },
    members: { u_mgr: { name: 'Manny' }, u_rog: { name: 'Roger' }, u_sue: { name: 'Sue' }, u_new: { name: 'Nina', status: 'pending' } },
  });
  const res = await r.call('leagueMember', MGR, { league: 'main', action: 'remove', player: 'Sue' });
  assert.equal(res.status, 200);
  assert.equal(res.body.placed, true, 'two legs fill a two-active-seat board — the pending seat is not counted');
  assert.equal(r.ctx.placed, 1);
});

/* ---------------- submission gate ---------------- */

test('a pending seat cannot submit, and neither can the manager for them', async () => {
  const r = rig(); r.seed({
    members: { u_mgr: { name: 'Manny' }, u_rog: { name: 'Roger' }, u_new: { name: 'Nina', status: 'pending' } },
  });
  const own = await r.call('bozoPick', NINA, { league: 'main', captureVersion: 1, pick: LEG });
  assert.equal(own.status, 409);
  assert.match(own.body.error, /you joined after this week's board opened/i);
  const proxy = await r.call('bozoPick', MGR, { league: 'main', captureVersion: 1, pick: LEG, forUid: 'u_new' });
  assert.equal(proxy.status, 409);
  assert.match(proxy.body.error, /Nina joined after this week's board opened/);
  assert.ok(!(r.league().picks || {}).u_new, 'nothing was written for the pending seat');
});

test('a leaving seat cannot submit either', async () => {
  const r = rig(); r.seed({
    members: { u_mgr: { name: 'Manny' }, u_rog: { name: 'Roger', status: 'leaving' } },
  });
  const res = await r.call('bozoPick', ROGER, { league: 'main', captureVersion: 1, pick: LEG });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /leaving this league/);
});

test('an active seat is unaffected — a plain self-submit still lands', async () => {
  const r = rig(); r.seed({
    members: { u_mgr: { name: 'Manny' }, u_rog: { name: 'Roger' }, u_sue: { name: 'Sue' }, u_new: { name: 'Nina', status: 'pending' } },
  });
  const p1 = await r.call('bozoPick', ROGER, { league: 'main', captureVersion: 1, pick: LEG });
  assert.equal(p1.status, 200, JSON.stringify(p1.body));
  const p2 = await r.call('bozoPick', ROGER, { league: 'main', confirm: p1.body.confirm_code });
  assert.equal(p2.status, 200, JSON.stringify(p2.body));
  assert.equal(p2.body.size, 3, 'the board is three active seats, not four members');
  assert.equal(p2.body.need, 3);
});

/* ---------------- the roll ---------------- */

test('/bozo/next promotes pending, drops leaving, and the new week counts them all', async () => {
  const r = rig(); r.seed({
    status: 'placed', week: 2,
    picks: { u_rog: { label: 'NAVY ML' } },
    members: {
      u_mgr: { name: 'Manny' }, u_rog: { name: 'Roger', status: 'leaving' },
      u_sue: { name: 'Sue' }, u_new: { name: 'Nina', status: 'pending' }, u_two: { name: 'Otto', status: 'pending' },
    },
  });
  const res = await r.call('bozoNext', MGR, { league: 'main' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.week, 3);
  assert.deepEqual(plain(res.body.promoted).sort(), ['Nina', 'Otto']);
  assert.deepEqual(plain(res.body.departed), ['Roger']);

  const after = r.league();
  assert.equal(after.status, 'open');
  assert.ok(!after.members.u_rog, 'the leaving seat is gone');
  assert.equal(after.members.u_new.status, 'active');
  assert.equal(after.members.u_two.status, 'active');
  assert.equal(after.members.u_new.name, 'Nina', 'promotion patches the status only, not the whole seat');
  assert.deepEqual(plain(r.api.activeNames(after)).sort(), ['Manny', 'Nina', 'Otto', 'Sue']);
  assert.equal(after.picks ?? null, null, 'the week still clears');
  assert.ok(r.ctx.tripwires.at(-1).nulled.includes('members/u_rog'));
});

test('a roll with nothing transitional is byte-identical to the old behaviour', async () => {
  const r = rig(); r.seed({ status: 'placed', picks: { u_rog: {} } });
  const res = await r.call('bozoNext', MGR, { league: 'main' });
  assert.equal(res.status, 200);
  assert.deepEqual(plain([res.body.promoted, res.body.departed]), [[], []]);
  assert.deepEqual(r.league().members,
    { u_mgr: { name: 'Manny' }, u_rog: { name: 'Roger' }, u_sue: { name: 'Sue' } },
    'no status field is invented on a seat that never had one');
});

/* ---------------- no migration ---------------- */

test('every legacy seat shape reads as active', () => {
  const r = rig();
  const lg = { members: { u_a: { name: 'A' }, 'Legacy%20Len': true, Plain: { name: 'Plain', status: 'bogus' } } };
  assert.deepEqual(plain(r.api.activeNames(lg)).sort(), ['A', 'Legacy Len', 'Plain']);
  assert.equal(r.api.memberStatusAt(lg, 'Legacy%20Len'), 'active');
  assert.equal(r.api.memberStatusAt(lg, 'Plain'), 'active', 'an unrecognised string normalises, it does not pass through');
  assert.equal(r.api.memberStatusAt(lg, 'nobody'), 'active');
  assert.deepEqual(plain(r.api.memberNames(lg, { activeOnly: true })), plain(r.api.activeNames(lg)));
});

test('waitingKeys lists active seats without a leg, and nobody else', () => {
  const r = rig();
  const lg = { members: { u_a: { name: 'A' }, u_b: { name: 'B' }, u_c: { name: 'C', status: 'pending' }, u_d: { name: 'D', status: 'leaving' } } };
  assert.deepEqual(plain(r.api.waitingKeys(lg, { u_a: {} })), ['u_b']);
  assert.deepEqual(plain(r.api.waitingKeys(lg, {})), ['u_a', 'u_b']);
});

/* ---------------- unlocking a placed week ---------------- */

const FUTURE = '2099-09-13T17:00:00.000Z', PAST = '2000-01-01T00:00:00.000Z';
const placedBoard = (over = {}) => ({
  status: 'placed', order: [0, 2, 1, 3], closeTs: 1789054193721,
  picks: { u_mgr: { who: 'Manny', game: 'CHI @ CAR', startsAt: FUTURE, ts: 1 },
           u_rog: { who: 'Roger', game: 'MIA @ LV', startsAt: FUTURE, ts: 2 } },
  members: { u_mgr: { name: 'Manny' }, u_rog: { name: 'Roger' }, u_new: { name: 'Nina', status: 'pending' } },
  ...over,
});

test('reopen clears exactly the lock — status, order, closeTs — keeps every leg, promotes pending seats', async () => {
  const r = rig(); r.seed(placedBoard());
  const res = await r.call('leagueReopen', MGR, { league: 'main' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const lg = r.league();
  assert.equal(lg.status, 'open');
  assert.equal(lg.order ?? null, null, 'order MUST go, or placeAndDraw never places again');
  assert.equal(lg.closeTs ?? null, null);
  assert.deepEqual(plain(Object.keys(lg.picks)).sort(), ['u_mgr', 'u_rog'], 'no leg is touched');
  assert.equal(lg.picks.u_rog.ts, 2, 'submission clocks survive — Last In is still real');
  assert.equal(lg.members.u_new.status, 'active', 'the mid-week joiner plays this week');
  assert.deepEqual(plain(res.body.promoted), ['Nina']);
  assert.deepEqual(plain(res.body.waitingOn), ['Nina']);
  assert.equal(res.body.seats, 3);
  const row = r.audit().at(-1);
  assert.equal(row.type, 'reopen');
  assert.deepEqual(plain(row.before), { status: 'placed', order: [0, 2, 1, 3], closeTs: 1789054193721 });
  assert.deepEqual(plain(r.ctx.tripwires.at(-1)), { route: '/league/reopen', nulled: ['order', 'closeTs'] });
});

test('after a reopen, the promoted member can submit for real', async () => {
  const r = rig(); r.seed(placedBoard());
  assert.equal((await r.call('leagueReopen', MGR, { league: 'main' })).status, 200);
  const p1 = await r.call('bozoPick', NINA, { league: 'main', captureVersion: 1, pick: LEG });
  assert.equal(p1.status, 200, JSON.stringify(p1.body));
  const p2 = await r.call('bozoPick', NINA, { league: 'main', confirm: p1.body.confirm_code });
  assert.equal(p2.status, 200, JSON.stringify(p2.body));
  assert.equal(r.league().picks.u_new.who, 'Nina');
  assert.equal(r.ctx.placed, 1, 'the third leg fills a three-seat board and it locks again');
});

test('reopen is refused for a member, on an open board, on a graded week, and after kickoff', async () => {
  { const r = rig(); r.seed(placedBoard());
    const res = await r.call('leagueReopen', ROGER, { league: 'main' });
    assert.equal(res.status, 403);
    assert.equal(r.league().status, 'placed'); }
  { const r = rig(); r.seed();
    const res = await r.call('leagueReopen', MGR, { league: 'main' });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /already open/); }
  { const r = rig(); r.seed(placedBoard({ results: { u_mgr: { won: true } } }));
    const res = await r.call('leagueReopen', MGR, { league: 'main' });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /already been graded/); }
  { const r = rig(); r.seed(placedBoard({ status: 'graded' }));
    assert.equal((await r.call('leagueReopen', MGR, { league: 'main' })).status, 409); }
  { const r = rig();
    const b = placedBoard(); b.picks.u_rog.startsAt = PAST; r.seed(b);
    const res = await r.call('leagueReopen', MGR, { league: 'main' });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /already kicked off: Roger \(MIA @ LV\)/);
    const lg = r.league();
    assert.equal(lg.status, 'placed');
    assert.deepEqual(plain(lg.order), [0, 2, 1, 3], 'a refused reopen writes nothing'); }
});

test('reopen is refused while a seat is leaving with a leg on the ticket', async () => {
  const r = rig();
  const b = placedBoard(); b.members.u_rog.status = 'leaving'; r.seed(b);
  const res = await r.call('leagueReopen', MGR, { league: 'main' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Roger is leaving/);
  assert.equal(r.league().status, 'placed');
});

test('the page offers the unlock only on a placed, ungraded board', () => {
  assert.match(page, /id="reopenGo"/);
  assert.match(page, /wPost\('\/league\/reopen',\{\}\)/);
  assert.match(page, /\(S\.status\|\|'open'\)==='placed' && !Object\.keys\(S\.results\|\|\{\}\)\.length/);
  assert.match(worker, /url\.pathname === "\/league\/reopen"\) return leagueReopen\(request, env, cors\);/);
});
