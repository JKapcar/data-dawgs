const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'dawg-bot-worker.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'bozo.html'), 'utf8');

test('league directory filters on the Worker before serialising', () => {
  assert.match(worker, /leagueList\(request, env, cors\)/);
  assert.match(worker, /PUBLIC_BOZO_LEAGUES = new Set\(\[DEFAULT_LEAGUE, "demo-royale"\]\)/);
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

test('the page sends its existing session on directory GETs', () => {
  assert.match(page, /if\(ME\) h\['X-Bozo-Session'\] = ME\.session;/);
  assert.match(page, /fetch\(WORKER \+ path[\s\S]*\{headers:h\}\)/);
});
