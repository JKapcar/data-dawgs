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

/* dd_war_room returned the whole feed on its first live call: 93 KB, of which the pool
   was 86 KB — 629 player rows for a league where 161 are rostered. That is ~23k tokens,
   which overflows a tool-result budget outright, so the answer never arrived and the
   context needed to reason with it was gone. A tool nobody can afford to call is not a
   live tool. These pin the trim, and pin the thing that breaks if the trim is done
   carelessly: teams[].players holds IDS, so every rostered id must still resolve. */
function trimPool(body, args) {
  // The exact block from work/mcp-block.js, lifted rather than retyped.
  const src = read('work/mcp-block.js');
  const a = src.indexOf('      const full = (args && args.scope) === "full";');
  const b = src.indexOf('      const withDd =', a);
  assert.ok(a > 0 && b > a, 'the trim block is where the test thinks it is');
  const fn = new Function('args', 'feed', src.slice(a, b) + '\n return {pool, omitted};');
  return fn(args, { body });
}

test('the pool is trimmed to rostered players by default', () => {
  const body = {
    teams: [{ id: '1', players: ['p1', 'p2'] }, { id: '2', players: ['p3'] }],
    pool: [{ id: 'p1', dd: { v: 9 } }, { id: 'p2', dd: { v: 4 } }, { id: 'p3', dd: { v: 1 } },
           { id: 'fa1' }, { id: 'fa2' }, { id: 'fa3' }, { id: 'fa4' }],
  };
  const def = trimPool(body, {});
  assert.equal(def.pool.length, 3, 'only the rostered players come back');
  assert.equal(def.omitted, 4, 'and the free agents are counted, not silently dropped');

  // THE invariant: teams[].players are ids, so a roster is unreadable if its ids do not
  // resolve. This is what a careless filter breaks.
  const ids = new Set(def.pool.map(p => p.id));
  for (const t of body.teams)
    for (const id of t.players)
      assert.ok(ids.has(id), `roster id ${id} no longer resolves`);

  const full = trimPool(body, { scope: 'full' });
  assert.equal(full.pool.length, 7, 'scope:"full" is untouched');
  assert.equal(full.omitted, 0);
});

test('a league that reports no rosters keeps its whole pool', () => {
  // Filtering on an empty roster set would return an empty pool and read as "your league
  // is empty", which is a worse answer than a large one.
  const body = { teams: [], pool: [{ id: 'a' }, { id: 'b' }] };
  const out = trimPool(body, {});
  assert.equal(out.pool.length, 2, 'no rosters means no filtering');
  assert.equal(out.omitted, 0);
});

test('the trim is declared where a caller decides, and the counts describe what came back', () => {
  const block = read('work/mcp-block.js');
  const i = block.indexOf('name: "dd_war_room"');
  const tool = block.slice(i, block.indexOf('name: "dd_draft_pool"', i));
  assert.match(tool, /scope: \{[\s\S]*?enum: \["rosters", "full"\]/, 'scope is a declared argument');
  assert.match(tool, /Returns ROSTERED players only by default/, 'and the description says so');
  // League-wide matched/unmatched beside a trimmed pool invites the wrong conclusion, so
  // the payload carries counts named for what it actually contains.
  assert.match(tool, /returnedRows: pool\.length/);
  assert.match(tool, /returnedWithDollars: withDd/);
  assert.match(tool, /freeAgentsOmitted/);
  assert.match(tool, /howToGetThem/, 'and says how to get the rest');
  // The generated Worker must carry it too — dawg-bot-worker.js is assembled, not edited.
  assert.match(read('dawg-bot-worker.js'), /returnedWithDollars: withDd/,
    'run `cd work && node assemble.mjs` — the Worker is generated from mcp-block.js');
});
