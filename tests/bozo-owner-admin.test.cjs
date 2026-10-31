// The configured site owner is site admin in every league, on any of their own full-access
// keys, for every manager and admin action. A pack-… seat key carries the owner's uid and is
// never the owner. Fixtures only; extracted straight from the committed Worker.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const worker = fs.readFileSync('dawg-bot-worker.js', 'utf8');
const cut = (a, b) => { const i = worker.indexOf(a); assert.ok(i >= 0, a); return worker.slice(i, worker.indexOf(b, i)); };

const ctx = {};
vm.createContext(ctx);
vm.runInContext(cut('function isOwnerPrincipal(', 'function isLeagueOwner(') + '\n' +
  cut('function bozoCorrectionManager(', 'function bozoCanonical(') +
  '\nthis.api = { isOwnerPrincipal, isSiteAdmin, bozoCorrectionManager };', ctx);
const { isOwnerPrincipal, isSiteAdmin, bozoCorrectionManager } = ctx.api;

const OWNER = 'u_owner123';
const env = { RESEARCH_OWNER_UID: OWNER };
const owner = (x = {}) => ({ kind: 'user', uid: OWNER, name: 'Kap', keyLabel: 'primary', roles: null, ...x });
// A league the owner neither manages nor delegates in, with a legacy display-name manager.
const league = { manager: 'Someone', managerUid: 'u_someone', members: { u_someone: { name: 'Someone' }, u_member: { name: 'Member' } }, delegates: {} };

test('the owner MCP connection is site admin and may run manager-only Bozo actions in any league', () => {
  assert.equal(isOwnerPrincipal(owner(), env), true);
  assert.equal(isSiteAdmin(owner(), env), true);
  assert.equal(bozoCorrectionManager(league, owner(), env), true, 'main, Royale or any other league');
  assert.equal(bozoCorrectionManager({ ...league, managerUid: undefined }, owner(), env), true, 'leagues with no managerUid');
  assert.equal(bozoCorrectionManager(league, owner({ keyLabel: 'claude' }), env), true, 'a labelled per-AI owner key');
  assert.equal(bozoCorrectionManager(league, { uid: OWNER, name: 'Kap', user: { roles: {} } }, env), true, 'the owner site session');
});

test('pack seat keys never inherit owner power, even though they carry the owner uid', () => {
  for (const seat of [owner({ kind: 'pack_seat', keyLabel: 'pack-grok' }), owner({ keyLabel: 'pack-grok' }), owner({ keyLabel: 'PACK-x' })]) {
    assert.equal(isOwnerPrincipal(seat, env), false, JSON.stringify(seat));
    assert.equal(bozoCorrectionManager(league, seat, env), false, JSON.stringify(seat));
  }
  assert.equal(isSiteAdmin(owner({ kind: 'pack_seat', keyLabel: 'pack-grok', name: 'Grok' }), env), false);
});

test('nobody else is widened', () => {
  const jeff = { kind: 'user', uid: 'u_jeff', name: 'Jeff', keyLabel: 'primary', roles: null };
  assert.equal(isOwnerPrincipal(jeff, env), false);
  assert.equal(isSiteAdmin(jeff, env), false);
  assert.equal(bozoCorrectionManager(league, jeff, env), false);
  // A display name that matches the owner's is not the owner, here or in the manager gate.
  assert.equal(bozoCorrectionManager(league, { ...jeff, name: 'Kap' }, { ...env, BOZO_ADMIN: 'Kap' }), false);
  // The shared league password, an errored session and a missing or malformed owner var all fail closed.
  assert.equal(isOwnerPrincipal({ kind: 'shared', uid: OWNER }, env), false);
  assert.equal(isOwnerPrincipal(owner({ err: 'expired' }), env), false);
  assert.equal(isOwnerPrincipal(owner(), {}), false);
  assert.equal(isOwnerPrincipal(owner({ uid: '' }), { RESEARCH_OWNER_UID: '' }), false);
  assert.equal(isOwnerPrincipal(owner({ uid: 'x y' }), { RESEARCH_OWNER_UID: 'x y' }), false);
  assert.equal(bozoCorrectionManager(league, owner(), undefined), false);
});

test('managers, delegates and role-flagged admins keep working; MCP role flags now count', () => {
  assert.equal(bozoCorrectionManager(league, { uid: 'u_someone', name: 'Someone' }, env), true, 'manager by uid');
  assert.equal(bozoCorrectionManager({ ...league, delegates: { u_member: true } }, { uid: 'u_member', name: 'Member' }, env), true, 'delegate');
  assert.equal(bozoCorrectionManager(league, { uid: 'u_a', user: { roles: { site_admin: true } } }, env), true, 'site session role flag');
  assert.equal(bozoCorrectionManager(league, { kind: 'user', uid: 'u_a', roles: { site_admin: true } }, env), true, 'MCP role flag, read from the account record');
  assert.equal(bozoCorrectionManager(league, { kind: 'pack_seat', uid: 'u_a', roles: { site_admin: true } }, env), false, 'a seat never uses a role flag');
  assert.equal(bozoCorrectionManager(league, { kind: 'user', uid: 'u_a', roles: { site_admin: 'yes' } }, env), false);
});

test('every manager-only Bozo gate passes env, so the owner check can run', () => {
  const calls = worker.match(/bozoCorrectionManager\([^)]*\)/g);
  assert.ok(calls.length >= 4, calls.join(' '));
  for (const c of calls) assert.match(c, /, env\)$/, c);
});
