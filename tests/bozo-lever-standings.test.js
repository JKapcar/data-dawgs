/* The cascade decides who wears it, and #dgTable used to show only its output — two
   simulated percentages per player. Four lever columns carry the standings now: two are
   readable off an open board (Shortest odds from the prices, Last in from the
   timestamps), and the two that cannot be computed before the games run keep their
   column rather than vanishing. These pin that, and pin the three ways the columns could
   quietly lie: printing a number the lever does not rank on, numbering Last in from the
   wrong end, and reading like a verdict instead of a standing. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bozo = fs.readFileSync(path.join(__dirname, '..', 'bozo.html'), 'utf8');

function lift(name) {
  const m = bozo.match(new RegExp(
    `(function ${name}\\([\\s\\S]*?\\n\\}|const ${name} += [\\s\\S]*?;\\n)`));
  assert.ok(m, `${name} is defined in bozo.html`);
  return m[1];
}

// leverStandings() reads S/ME and the page's odds helpers; nothing else.
function standings(picks, results) {
  const sandbox = { S: { results }, kEnc: n => n, sdOf: () => 10, dirOf: () => 'over',
    beatDeficit: (m, d, line, margin) => (margin - line) / -10 };
  const c = vm.createContext(sandbox);
  vm.runInContext(['imp', 'devigP', 'rankRows', 'leverStandings'].map(lift).join('\n')
    + '\nthis.RESULT = leverStandings(PICKS);', Object.assign(c, { PICKS: picks }));
  return sandbox.RESULT;
}
const ctx = vm.createContext({});
vm.runInContext(['imp', 'devigP', 'ordinal', 'rankRows'].map(lift).join('\n')
  + '\nthis.imp=imp; this.devigP=devigP; this.ordinal=ordinal; this.rankRows=rankRows;', ctx);
const { imp, devigP, ordinal, rankRows } = ctx;

const ML = (p, price, opp, ts) => ({ p, price, entryPriceOpp: opp, ts, mkt: 'ml', line: 0 });

test('it is one table with one row per person — no second stacked surface', () => {
  assert.doesNotMatch(bozo, /id="dgLevers"/, 'the standalone block is gone');
  assert.doesNotMatch(bozo, /paintLeverStandings/);
  // One list of headings feeds both the <th> row and every cell's data-l. Two copies
  // would drift, and the drifted one is the label a phone reads.
  const LVL = bozo.match(/const LVL = \[([^\]]*)\]/)[1];
  for (const col of ['I · Shortest odds', 'II · Worst beat', 'III · Last in', 'IV · Worst CLV'])
    assert.ok(LVL.includes(`'${col}'`), `${col} is in LVL`);
  assert.match(bozo, /\+ LVL\.map\(l=>`<th>\$\{l\}<\/th>`\)\.join\(''\)/, 'the header row is built from it');
  assert.match(bozo, /lvCell\(0, i, LVL\[0\]/, 'and so is each cell label');
});

test('every cell carries a label, because on a phone that is all there is', () => {
  // The header row is hidden at ≤640px and each cell draws its own label from data-l.
  // A cell without one renders a value with nothing saying what it is.
  const a = bozo.indexOf('return `<tr${mine}><td class="who">');
  const rowTpl = bozo.slice(a, bozo.indexOf('</tr>`;', a));
  const cells = rowTpl.match(/<td[^>]*>/g) || [];
  assert.ok(cells.length >= 6, `found the row template (${cells.length} cells)`);
  for (const td of cells) {
    if (/class="(who|pk)"/.test(td)) continue;      // name and leg lead the card unlabelled
    assert.match(td, /data-l=/, `unlabelled cell: ${td}`);
  }
  assert.match(bozo, /data-l="Leg wins"/);
  assert.match(bozo, /data-l="Bozo odds"/);
  assert.match(bozo, /data-l="Killed it alone"/);
  assert.match(bozo, /data-l="Usually named by"/);
  assert.match(bozo, /lvCell = \(k, i, lbl, val, muted\)[\s\S]*?data-l="\$\{lbl\}"/, 'lever cells too');
  assert.match(bozo, /outCell = lbl =>[\s\S]*?data-l="\$\{lbl\}"/, 'including a dropped lever');
});

test('on a phone it stays ONE table and pins the name column', () => {
  // It was cards for one release. That was the wrong read of "hard to tell which column
  // is which": the columns were illegible, not the wrong shape. Comparing two people on
  // one lever is the job, and a column does that for free.
  const mob = bozo.slice(bozo.indexOf('---- diagnostics on a phone: ONE table'));
  assert.doesNotMatch(bozo, /#dgTable,#dgTable tbody,#dgTable tr,#dgTable td\{display:block\}/,
    'the row is not turned into a card');
  assert.doesNotMatch(bozo, /#dgTable td::before\{content:attr\(data-l\)/,
    'labels do not replace the header row');
  assert.match(mob, /#dgTable\{min-width:640px\}/, 'the table keeps its width and scrolls');
  // Losing your place while scrolling right was the actual failure: the name rides along.
  assert.match(mob, /#dgTable td\.who,#dgTable th:first-child\{position:sticky;left:0/);
  assert.match(mob, /#dgTable td\+td,#dgTable th\+th\{border-left/, 'columns get an edge, not just a gap');
  // A sticky header would be a rule that looks like it works and doesn't — .tscroll sets
  // overflow-x, so overflow-y computes to auto and top:0 anchors to a container that
  // never scrolls vertically.
  assert.doesNotMatch(mob, /#dgTable th\{position:sticky;top:0/, 'no sticky header that cannot stick');
  assert.match(mob, /The header is NOT sticky, deliberately/, 'and the reason is written down');
  // Nothing is hidden: one table, every column, scrolled.
  assert.doesNotMatch(bozo, /#dgTable td:nth-child\(\d+\),#dgTable th:nth-child\(\d+\)\{display:none\}/);
});

test('the reported board: Kap 1st on odds at its de-vigged 67.5%, 3rd in on Last in', () => {
  // Kap, BUTTS, Tony from the screenshot — filed BUTTS, Tony, Kap in that order.
  const picks = [ML('Kap', -238, 195, 300), ML('BUTTS', -198, 165, 100), ML('Tony', -135, null, 200)];
  const L = standings(picks, {});

  assert.deepEqual([L.rank[0][0], L.rank[0][1], L.rank[0][2]], [1, 2, 3], 'chalkiest first');
  assert.ok(L.holds[0][0], 'Kap holds Shortest odds');
  // Tony filed no opposite price, which used to blank his cell. The column prints the
  // submitted price now, so every leg has both a placement and a number.
  assert.equal(L.rank[0][2], 3);
  assert.equal(L.d[2].clv, null, 'no other side is still no CLV — that de-vig is real work');

  // Last in is numbered in submission order, and the badge is at the other end.
  assert.deepEqual([L.rank[2][1], L.rank[2][2], L.rank[2][0]], [1, 2, 3], 'BUTTS 1st in, Kap 3rd');
  assert.ok(L.holds[2][0], 'Kap filed last, so Kap holds Last in');
  assert.ok(!L.holds[2][1], '1st in does not hold it');

  // The two that cannot compute rank nobody at all — which is not "ranked last".
  assert.equal(Object.keys(L.rank[1]).length, 0, 'Worst beat ranks nobody with no scores');
  assert.equal(Object.keys(L.rank[3]).length, 0, 'Worst CLV ranks nobody with no closes');
  assert.equal(L.scored, 0);
  assert.equal(L.withClv, 0);
});

test('Shortest odds prints the price it ranks on, so the two cannot come apart', () => {
  const sim = bozo.slice(bozo.indexOf('function simulate('));
  assert.match(sim.slice(0, sim.indexOf('\n// One definition of')), /k==='odds' \? \(i=>L\[i\]\.odds\)/);
  assert.match(bozo, /odds: imp\(x\.price\)/, 'the sim ranks on imp()');
  const fn = bozo.slice(bozo.indexOf('function leverStandings('));
  assert.match(fn, /place\(0, d\.slice\(\), r=>r\.raw,/, 'so the column places on imp() too');
  // and the cell prints x.price itself, not a derived figure
  assert.match(bozo, /lvCell\(0, i, LVL\[0\], \(x\.price>0\?'\+':''\)\+x\.price\)/);

  // The claim that makes this safe: imp() is monotonic in the American price, across the
  // sign boundary too. Shorter price, higher implied — so price order IS lever order.
  const ladder = [-100000, -900, -310, -238, -150, -101, 100, 150, 250, 100000];
  for (let i = 1; i < ladder.length; i++)
    assert.ok(imp(ladder[i - 1]) > imp(ladder[i]),
      `imp(${ladder[i - 1]}) must exceed imp(${ladder[i]})`);

  // A de-vigged probability would NOT have that property — this is the board that broke
  // it, and the reason the column no longer prints one.
  const A = devigP(-260, 200), B = devigP(-250, 280);
  assert.ok(imp(-260) > imp(-250) && A < B,
    'de-vigged, the 2nd-placed leg reads higher — which is why it is not what is shown');

  // No disagreement flag survives, because nothing can disagree any more.
  assert.doesNotMatch(bozo, /De-vigging would reorder/);
  assert.doesNotMatch(bozo, /LV\.disagree/);
  assert.doesNotMatch(bozo, /LV\.noOpp/);
});

test('placements are competition-ranked — a tie is a real tie', () => {
  const out = rankRows([{ v: 3 }, { v: 5 }, { v: 5 }, { v: 1 }], d => d.v);
  assert.deepEqual(out.map(d => d.rank), [1, 1, 3, 4], 'equal values share a place, the next skips');
  const tied = standings([ML('A', -200, 170, 1), ML('B', -200, 170, 2)], {});
  assert.deepEqual([tied.rank[0][0], tied.rank[0][1]], [1, 1], 'two legs at one price tie the lever');
});

test('Worst beat ranks once a score lands, and does not rank what it cannot score', () => {
  const picks = [
    { p: 'Kap', price: -200, entryPriceOpp: 170, ts: 1, mkt: 'spread', line: 3 },
    { p: 'BUTTS', price: -180, entryPriceOpp: 150, ts: 2, mkt: 'spread', line: 3 },
  ];
  const L = standings(picks, { Kap: { actual: -17 } });
  assert.equal(L.scored, 1);
  assert.equal(L.rank[1][0], 1, 'the scored leg places');
  assert.equal(L.rank[1][1], undefined, 'the unscored one is absent, not last');
  assert.ok(L.holds[1][0]);
  assert.equal(L.d[0].beat, 2);
});

test('Worst CLV drops a leg it cannot de-vig rather than scoring it zero', () => {
  const picks = [ML('A', -200, 170, 1), ML('B', -180, 150, 2), ML('C', -150, 130, 3)];
  const L = standings(picks, {
    A: { close: -150, closeOpp: 130 },   // drifted longer: the market moved against A
    B: { close: -260, closeOpp: 210 },   // shortened: the market moved toward B
    C: { close: -150 },                  // one side only: not de-viggable
  });
  assert.equal(L.withClv, 2);
  assert.ok(L.d[0].clv < 0 && L.d[1].clv > 0);
  assert.equal(L.rank[3][0], 1, 'the most negative CLV is first');
  assert.ok(L.holds[3][0]);
  assert.equal(L.rank[3][2], undefined, 'one side alone is unrankable, never zero');
  assert.match(bozo, /clv: \(pC==null\|\|pE==null\) \? null : \(pC-pE\)/);
});

test('a lever out of the draw gets a column saying so, not a blank', () => {
  const fn = bozo.slice(bozo.indexOf('function paintDiag('));
  assert.match(fn, /const outCell = lbl =>[\s\S]*?not in the draw/);
  for (const k of [0, 1, 2, 3])
    assert.match(fn, new RegExp(`levers\\.includes\\(${k}\\) \\? lvCell\\(${k},[\\s\\S]*?: outCell\\(LVL\\[${k}\\]\\)`));
});

test('the note calls the columns a standing, not a verdict', () => {
  const note = bozo.slice(bozo.indexOf('The four lever columns are standings'));
  assert.match(note, /Only legs that <b>lost<\/b> are eligible/);
  assert.match(note, /prints the submitted price, which is the\s+same number it ranks on/);
  assert.match(note, /the column and its order can\s+never come apart/);
  assert.match(note, /if your leg loses and the draw\s+reaches that lever, it stops on you/);
  assert.match(note, /the highlight sits at the\s+<em>bottom<\/em> of that column/, 'Last in is explained');
  assert.match(note, /dormant, not absent/);
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(11), '11th');
});

/* The data layer above is executed for real. This runs the cell renderer too, lifted out
   of paintDiag, so a placement that prints the wrong ordinal or loses its highlight is
   caught here rather than on somebody's phone. */
function renderCell(LV, k, i, val, muted) {
  const src = bozo.match(/  const lvCell = \(k, i, lbl, val, muted\) => \{[\s\S]*?\n  \};/)[0]
            + '\n' + bozo.match(/  const outCell = lbl => [\s\S]*?;\n/)[0];
  const c = vm.createContext({ LV, ordinal });
  vm.runInContext(src + '\nthis.OUT = ARG === null ? outCell(LBL) : lvCell(K, I, LBL, V, M);',
    Object.assign(c, { ARG: k, K: k, I: i, LBL: 'I · Shortest odds', V: val, M: muted }));
  return c.OUT;
}

test('a cell prints its placement, and only the lever’s current stop is highlighted', () => {
  const LV = { rank: [{ 0: 1, 1: 3 }, {}, {}, {}], holds: [{ 0: true }, {}, {}, {}] };
  const first = renderCell(LV, 0, 0, '-238', false);
  assert.match(first, /<b class="lvr hot" title="This is where the lever stops right now\.">1st<\/b>/);
  assert.match(first, /<span class="lvv">-238<\/span>/);
  assert.match(first, /data-l="I · Shortest odds"/, 'the label travels with the cell');

  const third = renderCell(LV, 0, 1, '-150', false);
  assert.match(third, /<b class="lvr">3rd<\/b>/, 'placed, but not the stop');
  assert.doesNotMatch(third, /hot/);
  assert.doesNotMatch(third, /title=/, 'no misleading tooltip on a row the lever passes over');
  assert.doesNotMatch(third, /unr/, 'a price is always known, so this cell is never muted');

  // A leg this lever cannot rank takes an em dash — a different claim from placing last.
  const unranked = renderCell(LV, 1, 0, 'awaiting kickoff', true);
  assert.match(unranked, /^<td class="lv unr" data-l="/);
  assert.match(unranked, /<b class="lvr">—<\/b>/);
  assert.doesNotMatch(unranked, /\d(st|nd|rd|th)/);

  assert.match(renderCell(LV, null, 0, '', false), /not in the draw/);
});
