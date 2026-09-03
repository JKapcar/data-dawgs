/* The cascade decides who wears it, and #dgTable used to show only its output — two
   simulated percentages per player. Four lever columns carry the standings now: two are
   readable off an open board (Shortest odds from the prices, Last in from the
   timestamps), and the two that cannot be computed before the games run keep their
   column rather than vanishing. These pin that, and pin the three ways the columns could
   quietly lie: ranking on a different quantity than the grader, numbering Last in from
   the wrong end, and reading like a verdict instead of a standing. */
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
  const head = bozo.match(/<th>Who<\/th>[\s\S]*?<th>Usually named by<\/th>/)[0];
  for (const col of ['I · Shortest odds', 'II · Worst beat', 'III · Last in', 'IV · Worst CLV'])
    assert.ok(head.includes(`<th>${col}</th>`), `${col} is a column`);
});

test('the seam and the mobile drops are renumbered together', () => {
  // nth-child counts DOM position, so hiding columns must not move the seam.
  assert.match(bozo, /#dgTable td:nth-child\(6\),#dgTable th:nth-child\(6\)\{border-left/);
  const mob = bozo.match(/#dgTable td:nth-child\(2\)[\s\S]*?display:none\}/)[0];
  assert.match(mob, /nth-child\(5\)/, 'killed it alone drops on a phone');
  assert.match(mob, /nth-child\(10\)/, 'usually named by drops on a phone');
  assert.doesNotMatch(mob, /nth-child\(7\)/, 'the old index would now hide a lever column');
});

test('the reported board: Kap 1st on odds at its de-vigged 67.5%, 3rd in on Last in', () => {
  // Kap, BUTTS, Tony from the screenshot — filed BUTTS, Tony, Kap in that order.
  const picks = [ML('Kap', -238, 195, 300), ML('BUTTS', -198, 165, 100), ML('Tony', -135, null, 200)];
  const L = standings(picks, {});

  assert.deepEqual([L.rank[0][0], L.rank[0][1], L.rank[0][2]], [1, 2, 3], 'chalkiest first');
  assert.ok(L.holds[0][0], 'Kap holds Shortest odds');
  assert.ok(Math.abs(L.d[0].shown - 0.6750) < 0.001, 'Kap -238/+195 de-vigs to ~67.5%');
  assert.equal(L.d[2].shown, null, 'Tony filed no other side');
  assert.equal(L.noOpp, 1);

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

test('Shortest odds places on the grader’s rule and prints the de-vigged number', () => {
  const sim = bozo.slice(bozo.indexOf('function simulate('));
  assert.match(sim.slice(0, sim.indexOf('\n// One definition of')), /k==='odds' \? \(i=>L\[i\]\.odds\)/);
  assert.match(bozo, /odds: imp\(x\.price\)/, 'the sim ranks on imp()');
  const fn = bozo.slice(bozo.indexOf('function leverStandings('));
  assert.match(fn, /place\(0, d\.slice\(\), r=>r\.raw,/, 'so the column places on imp() too');
  assert.match(fn, /raw: imp\(x\.price\)/);
  // Raw implied over-counts the favourite; that is why the printed figure is de-vigged.
  assert.ok(imp(-238) > devigP(-238, 195));
  assert.equal(devigP(-238, null), null, 'no opposite price is no de-vig, never a guess');
});

test('when de-vigging would reorder the pool, a flag says so', () => {
  // A shorter raw price in a fat market vs a longer one in a tight market.
  const L = standings([ML('A', -260, 200, 1), ML('B', -250, 280, 2)], {});
  assert.deepEqual([L.rank[0][0], L.rank[0][1]], [1, 2], 'placement follows the grader');
  assert.ok(L.d[1].shown > L.d[0].shown, 'but B prints the higher probability');
  assert.equal(L.disagree, true);
  assert.match(bozo, /De-vigging would reorder Shortest odds on this board/);
  assert.match(bozo, /levers\.includes\(0\) && LV\.disagree/, 'and only when it actually does');

  const agree = standings([ML('A', -310, 250, 1), ML('B', -150, 125, 2)], {});
  assert.equal(agree.disagree, false, 'no flag on a board where they agree');
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
  assert.match(fn, /const outCell = \(\) =>[\s\S]*?not in the draw/);
  for (const k of [0, 1, 2, 3])
    assert.match(fn, new RegExp(`levers\\.includes\\(${k}\\) \\? lvCell\\(${k},[\\s\\S]*?: outCell\\(\\)`));
});

test('the note calls the columns a standing, not a verdict', () => {
  const note = bozo.slice(bozo.indexOf('The four lever columns are standings'));
  assert.match(note, /Only legs that <b>lost<\/b> are eligible/);
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
  const src = bozo.match(/  const lvCell = \(k, i, val, muted\) => \{[\s\S]*?\n  \};/)[0]
            + '\n' + bozo.match(/  const outCell = \(\) => [\s\S]*?;\n/)[0];
  const c = vm.createContext({ LV, ordinal });
  vm.runInContext(src + '\nthis.OUT = ARG === null ? outCell() : lvCell(K, I, V, M);',
    Object.assign(c, { ARG: k, K: k, I: i, V: val, M: muted }));
  return c.OUT;
}

test('a cell prints its placement, and only the lever’s current stop is highlighted', () => {
  const LV = { rank: [{ 0: 1, 1: 3 }, {}, {}, {}], holds: [{ 0: true }, {}, {}, {}] };
  const first = renderCell(LV, 0, 0, '67.5%', false);
  assert.match(first, /<b class="lvr hot" title="This is where the lever stops right now\.">1st<\/b>/);
  assert.match(first, /<span class="lvv">67\.5%<\/span>/);

  const third = renderCell(LV, 0, 1, '58.0%', false);
  assert.match(third, /<b class="lvr">3rd<\/b>/, 'placed, but not the stop');
  assert.doesNotMatch(third, /hot/);
  assert.doesNotMatch(third, /title=/, 'no misleading tooltip on a row the lever passes over');

  // A leg this lever cannot rank takes an em dash — a different claim from placing last.
  const unranked = renderCell(LV, 1, 0, 'awaiting kickoff', true);
  assert.match(unranked, /^<td class="lv unr">/);
  assert.match(unranked, /<b class="lvr">—<\/b>/);
  assert.doesNotMatch(unranked, /\d(st|nd|rd|th)/);

  assert.match(renderCell(LV, null, 0, '', false), /not in the draw/);
});
