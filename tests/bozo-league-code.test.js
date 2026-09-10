const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'dawg-bot-worker.js'), 'utf8');
const bozo = fs.readFileSync(path.join(root, 'bozo.html'), 'utf8');
const signon = fs.readFileSync(path.join(root, 'signon.html'), 'utf8');

function section(start, end) {
  const a = worker.indexOf(start);
  const b = worker.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `section ${start} exists`);
  return worker.slice(a, b);
}

test('league passwords are case-sensitive, league-scoped and stored only as HMACs', () => {
  assert.match(worker, /bozo-league-password/);
  assert.match(worker, /lid \+ String\.fromCharCode\(0\) \+ normLeaguePassword\(password\)/);
  const manager = section('async function leagueAccess(request, env, cors)', '// Cached pages may still post');
  assert.match(manager, /passwordEnabled:/);
  assert.match(manager, /kv\.put\(JOIN_LG\(lid\), JSON\.stringify\(next\)\)/);
  assert.doesNotMatch(manager, /password:\s*password/);
});

test('league directory requires a session, allows listing, and caps results at 20', () => {
  const search = section('async function leagueSearch(request, env, cors)', '// POST /league/create');
  assert.match(search, /sessionAuth\(request, env\)/);
  assert.match(search, /!q \|\| name\.includes\(q\) \|\| id\.includes\(q\)/);
  assert.match(search, /slice\(0, 20\)/);
  assert.match(search, /total: matches\.length, limit: 20/);
  assert.doesNotMatch(search, /members:/);
});

test('joining authenticates first and verifies the chosen league password server-side', () => {
  const join = section('async function leagueJoin(request, env, cors)', '// POST /league/access');
  assert.ok(join.indexOf('sessionAuth(request, env)') < join.indexOf('readBody(request)'), 'auth happens before password redemption');
  assert.match(join, /body\.league/);
  assert.match(join, /body\.password/);
  assert.match(join, /timingSafeEqual\(currentHash, await leaguePasswordHash/);
  assert.match(join, /JOIN_REDEEM_PER_DAY/);
  assert.doesNotMatch(join, /body\.code|body\.leagueCode/);
});

test('per-person and reusable Bozo join links are retired', () => {
  assert.match(worker, /url\.pathname === "\/league\/invite"\) return retiredLeagueInvite/);
  assert.match(worker, /request\.method === "GET" \? retiredLeagueLink/);
  assert.match(worker, /Identity invitations create or recover an account only/);
  assert.match(worker, /stale pendingLeague.*cleared without granting membership/s);
  for (const retired of ['data-invite=', 'id="invGo"', 'id="jlGet"', 'id="jlRot"', 'id="jcSet"'])
    assert.ok(!bozo.includes(retired), `${retired} is gone from League Settings`);
});

test('manager and member UIs expose search plus shared-password workflow', () => {
  for (const id of ['lpPass', 'lpSet', 'lpOff', 'lpState', 'lpCap', 'lpVis'])
    assert.match(bozo, new RegExp(`id="${id}"`));
  assert.match(bozo, /wPost\('\/league\/access'/);
  for (const id of ['leagueDirectory', 'leagueSearch', 'leagueSearchGo', 'leaguePassword', 'leagueJoinGo', 'leagueOpen'])
    assert.match(signon, new RegExp(`id="${id}"`));
  assert.match(signon, /api\("\/league\/search",\{query:query\}\)/);
  assert.match(signon, /api\("\/league\/join",\{league:selectedLeague\.id,password:password\}\)/);
  // The retired "manager files a pick for someone" UI stays retired. (Filing a LEG for an
  // absent member is Phase 2.7's proxy submit, on the submit card, not a second form here.)
  assert.doesNotMatch(bozo, /id="addPick"|id="addGo"/);
  for (const id of ['joinLeague', 'jlDirectory', 'jlFilter', 'jlPassword', 'jlJoinGo', 'jlOpen'])
    assert.match(bozo, new RegExp(`id="${id}"`));
  assert.match(bozo, />Create a Bozo league</);
  assert.doesNotMatch(bozo, />Book a new bill</);

  /* ⚠️ THIS ASSERTION FLIPPED WITH D22 (Phase 2.9), deliberately. It used to read
     `body.action !== "remove"` plus no `loadUsers` — i.e. a manager could not seat
     anybody, because every non-manager had to arrive through search + shared password.
     A manager add now exists. What did NOT change, and is what the rest of this test
     is really defending, is that adding a SEAT never creates an IDENTITY: the target
     must already hold a uid account, and a name with no account is refused rather than
     seated under a name-shaped key. */
  const member = section('async function leagueMember(request, env, cors)', '// POST /league/lock');
  assert.match(member, /action !== "remove" && action !== "add"/);
  assert.match(member, /UID_RE\.test\(k\)/, 'a seat is only ever keyed by a real uid');
  assert.match(member, /doesn't have an account yet — they need to sign up first/);
  assert.doesNotMatch(member, /leaguePasswordHash|joinPassHash/, 'the manager path never checks or bypasses a password');
});
