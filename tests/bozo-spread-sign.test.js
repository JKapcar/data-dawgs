/* The spread sign tripwire. Bozo stores `line` as points the side GIVES UP (positive lays,
   negative takes) while a DraftKings slip prints the display number ("CLE +8.5"). The form
   builds its label from the stored line so the two cannot disagree; the MCP tools take both
   from the caller, and on 2026-09-16 a live audit sent line 8.5 for "CLE +8.5" and captured
   CLE -8.5 at +710. Only the price band caught it. These pin the cross-check that catches it
   on any spread, the echo that spells the number out, and the schema text that teaches the
   convention before a caller gets it wrong. The real functions are lifted out of the Worker,
   not retyped. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.join(__dirname, '..', 'dawg-bot-worker.js'), 'utf8');

function between(start, end) {
  const a = worker.indexOf(start);
  const b = worker.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source markers exist: ${start} … ${end}`);
  return worker.slice(a, b);
}

const sandbox = {
  LEAGUE: { nfl: 1, cfb: 1, nba: 1, cbb: 1, mlb: 1, nhl: 1 },
  BOZO_GRADEABLE_SPORTS: new Set(['nfl', 'cfb', 'nba', 'cbb', 'mlb', 'nhl']),
  MARKETS: ['spread', 'ml', 'total', 'prop', 'other'],
  BOZO_CLOSE_BOOK: 'draftkings',
  bzAmerican: v => { const n = Number(v); return Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null; },
  assertQuote: () => null,
  bozoTeamNorm: s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
  playerName: k => { try { return decodeURIComponent(k); } catch { return k; } },
  encodeURIComponent, Number, String, Object, Array, Math, JSON, Date, isNaN, isFinite, RegExp,
};
vm.createContext(sandbox);
vm.runInContext([
  between('const BOZO_PERIODS = [', '/* ---------------- player props ----------------'),
  between('const selectionKeyOf = p => [', '// Server-side Fisher'),
  'this.api = { bozoSpreadSignError, bozoMarketPhrase, validatePick };',
].join('\n'), sandbox);
const { bozoSpreadSignError: err, bozoMarketPhrase: phrase, validatePick } = sandbox.api;

const spread = (label, line, side = label.split(' ')[0]) => ({ mkt: 'spread', label, line, side });

test('the live-audit case: "CLE +8.5" with line 8.5 is a sign conflict, and the message teaches the rule', () => {
  const e = err(spread('CLE +8.5', 8.5));
  assert.match(e, /^Spread sign conflict/);
  assert.match(e, /CLE takes 8\.5 points/, 'what the label says');
  assert.match(e, /line 8\.5 means CLE lays 8\.5 points/, 'what the number says');
  assert.match(e, /that is CLE -8\.5/, 'names the market the caller would have bought');
  assert.match(e, /GIVES UP: positive lays, negative takes/, 'states the convention');
  assert.match(e, /Send line -8\.5 for CLE \+8\.5/, 'gives the exact correction');
  assert.match(e, /Nothing was submitted\.$/);
});

test('the four sign combinations: agree passes, disagree fails, in both directions', () => {
  assert.equal(err(spread('CLE +8.5', -8.5)), null, 'dog: +8.5 on the slip is stored -8.5');
  assert.equal(err(spread('TB -8.5', 8.5)), null, 'favourite: -8.5 on the slip is stored 8.5');
  assert.match(err(spread('TB -8.5', -8.5)), /^Spread sign conflict/, 'favourite typed as a dog');
  assert.match(err(spread('CLE +8.5', 8.5)), /^Spread sign conflict/, 'dog typed as a favourite');
});

test('the band-legal runline: "NYY +1.5" is line -1.5, "NYY -1.5" is line 1.5', () => {
  assert.equal(err(spread('NYY +1.5', -1.5)), null);
  assert.equal(err(spread('NYY -1.5', 1.5)), null);
  assert.match(err(spread('NYY +1.5', 1.5)), /NYY lays 1\.5 points/);
});

test('label spellings that mean the same thing all pass', () => {
  assert.equal(err(spread('SYR +10.5 · 1st half', -10.5)), null, 'period suffix; "1st" carries no sign');
  assert.equal(err(spread('TB-8.5', 8.5)), null, 'sign glued to the team');
  assert.equal(err(spread('TB \u22128.5', 8.5)), null, 'Unicode minus');
  assert.equal(err(spread('TB \u20138.5', 8.5)), null, 'en dash');
  assert.equal(err(spread('TB -8.5 (-112)', 8.5)), null, 'a price in the label is not the line');
  assert.equal(err(spread('Buccaneers -8.5', 8.5, 'TB')), null, 'side and label need not share a spelling');
});

test('pick\'em: +0, -0 and PK all agree with a stored 0', () => {
  assert.equal(err(spread('PIT +0', 0)), null);
  assert.equal(err(spread('PIT -0', 0)), null);
  assert.equal(err(spread('PIT PK', 0)), null);
  assert.equal(err(spread("PIT pick'em", 0)), null);
});

test('a spread label with no sign cannot be cross-checked and is refused', () => {
  const e = err(spread('CLE 8.5', -8.5));
  assert.match(e, /must carry its sign/);
  assert.match(e, /e\.g\. "CLE \+8\.5"/, 'shows the canonical form for the number it was given');
  assert.match(err(spread('Browns', -8.5)), /must carry its sign/);
});

test('a label whose number differs from line is refused as a number mismatch, not a sign one', () => {
  const e = err(spread('CLE +7.5', -8.5));
  assert.match(e, /says \+7\.5 but line -8\.5 is CLE \+8\.5/);
  assert.match(e, /number does not match/);
  assert.match(err(spread('TB -3', 8.5)), /number does not match/);
});

test('a label carrying the number with both signs is refused', () => {
  assert.match(err(spread('TB -8.5 / +8.5', 8.5)), /both signs/);
});

test('a sign between digits is arithmetic, not a handicap', () => {
  // "10-3" must not be read as -3; with no other signed number the label has no sign at all.
  assert.match(err(spread('PIT 10-3', 3)), /must carry its sign/);
});

test('only spreads are judged; a missing number is left to validatePick', () => {
  assert.equal(err({ mkt: 'total', label: 'MIN @ CHI u53.5', line: 53.5, side: 'under' }), null);
  assert.equal(err({ mkt: 'ml', label: 'CLE ML', line: 0, side: 'CLE' }), null);
  assert.equal(err({ mkt: 'prop', label: 'Kelce o62.5', line: 62.5, side: 'over' }), null);
  assert.equal(err({ mkt: 'other', label: 'ARI 1H TT o10.5', line: 10.5, side: 'over' }), null);
  assert.equal(err(spread('CLE +8.5', undefined)), null);
  assert.equal(err(spread('CLE +8.5', 'x')), null);
  assert.equal(err(null), null);
});

test('validatePick runs the same check as its backstop', () => {
  const band = { ceil: -100, floor: -500 };
  const base = { sport: 'nfl', eventId: '401872935', game: 'CLE @ TB', side: 'CLE', mkt: 'spread',
    startsAt: '2026-09-20T17:00:00.000Z', price: -112, priceOpp: -108, priceSource: 'captured',
    entrySnapshotAt: '2026-09-16T12:00:00.000Z', providerEventIds: { sgo: 'qX8Dxew47C3mQnpzlm7j' } };
  const v = p => validatePick(p, 'Kap', {}, band, 'standard', 'u_kap');
  assert.equal(v({ ...base, label: 'CLE +8.5', line: -8.5 }), null);
  assert.match(v({ ...base, label: 'CLE +8.5', line: 8.5 }), /^Spread sign conflict/);
  assert.match(v({ ...base, label: 'CLE 8.5', line: -8.5 }), /must carry its sign/);
  // the missing-number message still wins when there is no line at all
  assert.equal(v({ ...base, label: 'CLE +8.5', line: undefined }), 'Number is required for that market.');
});

test('the capture path refuses before it spends a fetch, with its own reason code', () => {
  const fn = between('async function bozoCaptureEntry(', 'function bozoCloseMutation(');
  const check = fn.indexOf('bozoSpreadSignError(p)');
  const fetch = fn.indexOf('bozoFetchEvents(');
  assert.ok(check > 0, 'bozoCaptureEntry calls the tripwire');
  assert.ok(fetch > check, 'and does so before the odds fetch');
  assert.match(fn, /reason: "spread_sign_conflict"/);
});

test('the phase-one echo spells the spread out instead of printing the stored line', () => {
  assert.equal(phrase({ mkt: 'spread', side: 'CLE', line: -8.5 }), 'spread — CLE takes 8.5 points (stored line -8.5)');
  assert.equal(phrase({ mkt: 'spread', side: 'TB', line: 8.5 }), 'spread — TB lays 8.5 points (stored line 8.5)');
  assert.equal(phrase({ mkt: 'spread', side: 'PIT', line: 0 }), "spread — pick'em (stored line 0)");
  assert.equal(phrase({ mkt: 'ml', line: 0 }), 'moneyline');
  assert.equal(phrase({ mkt: 'total', line: 53.5 }), 'total 53.5');
  // both echo sites — /bozo/pick and the MCP submit — use it
  assert.equal(worker.split('bozoMarketPhrase(p)').length - 1, 2, 'two echo call sites');
  assert.doesNotMatch(worker, /p\.mkt === "ml" \? "moneyline" : p\.mkt \+ " " \+ p\.line/, 'the old phrase is gone');
});

test('the tool schemas and the initialize instructions teach the convention', () => {
  const lineDocs = worker.match(/line: \{ type: "number", description: "[^"]*GIVES UP[^"]*" \}/g) || [];
  assert.equal(lineDocs.length, 2, 'dd_draft_bozo_leg and dd_submit_bozo_leg both document line');
  for (const d of lineDocs) {
    assert.match(d, /CLE \+8\.5 on the slip is line -8\.5/);
    assert.match(d, /rejects a conflict/);
  }
  const labelDocs = worker.match(/label: \{ type: "string", description: "How the leg reads on the DraftKings slip, sign included(?:[^"\\]|\\.)*" \}/g) || [];
  assert.equal(labelDocs.length, 2, 'both tools say the label is the slip display, sign included');
  assert.match(worker, /On a spread leg `line` is points the side gives up \(positive lays, negative takes\) while `label` reads as the slip prints it/,
    'initialize instructions carry the rule, so every session sees it before its first call');
});
