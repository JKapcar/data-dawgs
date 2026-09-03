/* The War Room was reachable by humans and invisible to machines: absent from llms.txt,
   from surfaces.json, from the page→data mirror every page inlines, and from dd_site_map.
   A connected model could not even establish the page was a surface, let alone read the
   league behind it. These pin the fix, and pin the two things about it that are easy to
   get wrong later: the league rows must stay private, and Sleeper must stay named as
   unreachable rather than reported as "not connected". */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const worker = read('dawg-bot-worker.js');
const page = read('fantasy-warroom.html');
const surfaces = JSON.parse(read('data/surfaces.json'));
const entry = surfaces.data.find(s => s.id === 'war-room');

test('the War Room is discoverable in every index a machine reads', () => {
  assert.ok(entry, 'surfaces.json carries a war-room entry');
  assert.equal(entry.page, '/fantasy-warroom.html');
  assert.match(read('llms.txt'), /\/fantasy-warroom\.html/, 'llms.txt names the page');
  assert.match(worker, /"fantasy-warroom\.html": "Fantasy War Room/, 'dd_site_map lists it');
});

test('the mirror map is a SITEWIDE edit — every page that carries it got the key', () => {
  // The nav script is inlined into each page, so a partial pass leaves pages disagreeing
  // about what the site publishes. AGENTS.md rule 2.
  const files = fs.readdirSync(root).filter(f => f.endsWith('.html'));
  const carriers = files.filter(f => read(f).includes('"dashboard":"/data/league.json"'));
  assert.ok(carriers.length > 25, `expected the map on most pages, found ${carriers.length}`);
  for (const f of carriers)
    assert.match(read(f), /"fantasy-warroom":"\/data\/datadawg-dollars-method\.json"/,
      `${f} carries the mirror map but not the war-room key`);
});

test('the league rows stay private — the surface is a tool, not a file', () => {
  const kinds = entry.machine.map(m => m.kind);
  assert.ok(kinds.includes('mcp'), 'machine access is an authenticated tool');
  assert.equal(entry.machine.find(m => m.kind === 'mcp').tool, 'dd_war_room');
  // Every published file on this entry is METHOD, never league data.
  for (const m of entry.machine.filter(m => m.kind !== 'mcp'))
    assert.match(m.url, /datadawg-dollars-method/, `${m.url} is not a method file`);
  assert.match(entry.gap, /no public JSON/i, 'and the registry says why');
  assert.doesNotMatch(JSON.stringify(entry), /\/data\/war-?room/,
    'no war-room data file is claimed to exist');
});

test('dd_war_room reads the caller’s own connection and refuses to guess', () => {
  const i = worker.indexOf('name: "dd_war_room"');
  assert.ok(i > 0, 'the tool is registered');
  const tool = worker.slice(i, worker.indexOf('name: "dd_draft_pool"', i));
  assert.match(tool, /readOnlyHint: true/);
  // No leagueId argument: the credential decides which league this answers about, so the
  // tool can never be pointed at a league id somebody guessed.
  assert.doesNotMatch(tool, /leagueId: \{/, 'accepts no league id');
  assert.match(tool, /caller\.kind !== "user"/, 'the shared connector has no league');
  assert.match(tool, /const uid = caller\.uid \|\| caller\.name;/, 'keyed by uid, not display name');
  // Two connections and no provider is ambiguous — answering about the wrong league is
  // worse than answering about neither.
  assert.match(tool, /if \(!want && yahoo && espn\)/);
  assert.match(tool, /You have both a Yahoo and an ESPN league connected/);
  // One code path with the page, so a number here cannot disagree with the screen.
  assert.match(tool, /ddDecorateBody\(await ddLoadBoard\(env, provider, cred\.leagueId, "season"\)/);
});

test('Sleeper is named as unreachable, never reported as not connected', () => {
  const i = worker.indexOf('name: "dd_war_room"');
  const tool = worker.slice(i, worker.indexOf('name: "dd_draft_pool"', i));
  for (const [what, text] of [['the tool', tool], ['the page', page], ['the registry', entry.gap]])
    assert.match(text, /Sleeper/, `${what} should say what happens to a Sleeper league`);
  assert.match(tool, /cannot be read by this tool even while the page is showing it/);
  assert.match(entry.gap, /read client-side/);
});

test('the page itself tells a machine where to go', () => {
  const method = page.slice(page.indexOf('<dt>Machine access</dt>'), page.indexOf('<dt>Receipts</dt>'));
  assert.ok(method.length > 100, 'the method sheet has a Machine access entry');
  assert.match(method, /dd_war_room/);
  assert.match(method, /datadawg-dollars-method\.md/, 'the public method is linked');
  assert.match(method, /surfaces\.json/, 'and the registry that grades every surface');
  assert.match(method, /no public JSON/, 'the gap is stated, so a model stops hunting');
});
