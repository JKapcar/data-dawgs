const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'dawg-bot-worker.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'bozo.html'), 'utf8');

test('league directory filters on the Worker before serialising', () => {
  assert.match(worker, /leagueList\(request, env, cors\)/);
  // ⚠️ ONE hardcoded public room. The seeded Royale demo was the second and is deleted;
  // a hardcoded id for a league that no longer exists publishes a 404 to every unsigned
  // browser that reads the directory.
  assert.match(worker, /PUBLIC_BOZO_LEAGUES = new Set\(\[DEFAULT_LEAGUE\]\)/);
  // The id must be gone from the CODE, not from the file — the comment above the set
  // explains why the second room went, and that note is worth keeping. Strip comments
  // and require nothing executable still names it.
  const code = worker.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /demo-royale/, 'no live reference to the deleted league');
  assert.match(worker, /Object\.entries\(leagues\)\.filter\(visible\)\.map/);
  assert.match(worker, /lg\.manager === viewer \|\| isMember\(lg, viewer\)/);
});

test('unsigned or invalid sessions fall back to the public catalog', () => {
  const directory = worker.slice(
    worker.indexOf('async function leagueList(request, env, cors)'),
    worker.indexOf('// POST /league/search', worker.indexOf('async function leagueList(request, env, cors)')),
  );
  assert.match(directory, /let viewer = null;/);
  assert.match(directory, /if \(hasSession\) \{[\s\S]*if \(!auth\.err\) viewer = auth\.name;[\s\S]*\}/);
  assert.doesNotMatch(directory, /if \(auth\.err\) return/);
});

test('directory reads capture the initiating identity and never reuse another session', async () => {
  const vm=require('node:vm'),calls=[];
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const context={ME:{session:'synthetic-account-a'},WORKER:'https://synthetic.invalid',bust:()=> 'fixture=1',AbortController,setTimeout,clearTimeout,
    fetch:async(url,options)=>{calls.push({url,options});if(calls.length===1)await pending;return {ok:true,json:async()=>({leagues:[]})};}};
  vm.createContext(context);
  vm.runInContext(page.match(/async function wGet\(path\)\{[\s\S]*?\n\}/)[0],context);
  const first=context.wGet('/league/list');
  context.ME={session:'synthetic-account-b'};await context.wGet('/league/list');
  context.ME=null;await context.wGet('/league/list');
  release();await first;
  assert.deepEqual(calls.map(c=>c.options.headers['X-Bozo-Session']),['synthetic-account-a','synthetic-account-b',undefined]);
  for(const {url,options} of calls){
    assert.equal(url,'https://synthetic.invalid/league/list?fixture=1');
    assert.equal(options.cache,'no-store');assert.ok(options.signal instanceof AbortSignal);
    assert.equal(Object.hasOwn(options.headers,'Authorization'),false);
  }
});
