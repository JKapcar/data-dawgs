const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const worker = fs.readFileSync(path.join(__dirname, '..', 'dawg-bot-worker.js'), 'utf8');

test('every Bozo collection clear emits the structured null-write tripwire', () => {
  assert.match(worker, /event: "bozo-null-write"/);
  assert.match(worker, /route,\s*callerUid: \(auth && auth\.uid\) \|\| null,\s*league: lid,\s*nulled,\s*at:/s);

  for (const route of [
    '/league/create rollback',
    '/league/delete',
    '/league/member',
    '/bozo/pick remove',
    '/bozo/next',
  ]) {
    assert.match(worker, new RegExp(`bozoNullWriteTripwire\\("${route.replace('/', '\\/')}`), route);
  }
});

test('kickoff capture creates an attributable ledger receipt', () => {
  assert.match(worker, /const uidByName = new Map\(\)/);
  assert.match(worker, /uidByName\.set\(accountName\(uid, rec\), uid\)/);
  assert.match(worker, /const player = p\.who \|\| memberNameAt\(lg, key\) \|\| playerName\(key\)/);
  assert.match(worker, /const uid = UID_RE\.test\(key\) \? key : \(uidByName\.get\(player\) \|\| null\)/);
  assert.match(worker, /if \(!t \|\| !t\.pick \|\| !t\.key \|\| !t\.player \|\| !t\.uid\) return null/);
  assert.match(worker, /patch\[`\$\{lrow\}\/player`\] = t\.player/);
  assert.match(worker, /patch\[`\$\{lrow\}\/uid`\] = t\.uid/);
});
