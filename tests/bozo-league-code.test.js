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

test('typed league codes are normalized and stored only as peppered HMAC lookups', () => {
  assert.match(worker, /const normJoinPass = \(c\) => String\(c \|\| ""\)\.trim\(\)\.toUpperCase\(\)/);
  assert.match(worker, /hmac\(env\.BOZO_PEPPER, "bozo-league-code"/);
  assert.match(worker, /const JOIN_PASS = \(hash\) => "joinpass:code:" \+ hash/);

  const manager = section('async function leagueJoinCode(request, env, cors)', '/* ========================== the forecasting challenge');
  assert.match(manager, /passHash, passChangedTs/);
  assert.match(manager, /kv\.put\(JOIN_PASS\(passHash\), lid\)/);
  assert.match(manager, /if \(next\.code\) await kv\.put\(JOIN_CODE\(next\.code\), lid\)/);
  assert.doesNotMatch(manager, /leagueCode:\s*pass/);
});

test('joining requires a valid session and resolves the shared code server-side', () => {
  const join = section('async function leagueJoin(request, env, cors)', '// POST /league/join-code');
  assert.ok(join.indexOf('sessionAuth(request, env)') < join.indexOf('readBody(request)'), 'auth happens before code redemption');
  assert.match(join, /body\.leagueCode/);
  assert.match(join, /JOIN_PASS\(await joinPassHash\(env, pass\)\)/);
  assert.match(join, /JOIN_REDEEM_PER_DAY/);
  assert.match(join, /isMember\(lg, auth\.name\)/);
});

test('manager can replace or disable a code and league deletion revokes it', () => {
  assert.match(worker, /"league-code", "league-code-off"/);
  assert.match(worker, /That league code is already in use/);
  const deletion = section('async function leagueDelete(request, env, cors)', '// League settings');
  assert.match(deletion, /kv\.delete\(JOIN_PASS\(rec\.passHash\)\)/);
});

test('manager and signed-in member UIs expose the code workflow', () => {
  for (const id of ['jcPass', 'jcSet', 'jcOff', 'jcState']) assert.match(bozo, new RegExp(`id="${id}"`));
  assert.match(bozo, /action:'league-code',leagueCode/);
  for (const id of ['leaguePass', 'leaguePassGo', 'leaguePassOpen', 'leaguePassMsg']) assert.match(signon, new RegExp(`id="${id}"`));
  assert.match(signon, /api\("\/league\/join",\{leagueCode:code\}\)/);
});
