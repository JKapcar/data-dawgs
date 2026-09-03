/* The cascade decides who wears it, and the board used to show only its output — a
   simulated percentage. Two of the four levers are readable straight off an open board
   (Shortest Odds from the prices, Last In from the timestamps); the other two cannot be
   computed before the games run and have to hold their place rather than vanish. These
   pin that, and pin the two ways the section could quietly lie: ranking on a different
   quantity than the grader, and reading like a verdict instead of a standing. */
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
const ctx = vm.createContext({});
vm.runInContext(['imp', 'devigP', 'ordinal', 'rankRows'].map(lift).join('\n')
  + '\nthis.imp = imp; this.devigP = devigP; this.ordinal = ordinal; this.rankRows = rankRows;', ctx);
const { imp, devigP, ordinal, rankRows } = ctx;

test('every lever keeps a block, including the two that cannot compute yet', () => {
  const fn = bozo.slice(bozo.indexOf('function paintLeverStandings('));
  const body = fn.slice(0, fn.indexOf('\n/* Who is holding the belt'));
  // The two knowable now
  assert.match(body, /levers\.includes\(0\)/, 'Shortest Odds is read off the prices');
  assert.match(body, /levers\.includes\(2\)/, 'Last In is read off the timestamps');
  // The two that hold a spot rather than disappearing
  assert.match(body, /'needs a final score'/, 'Worst Beat says what it is waiting for');
  assert.match(body, /'closes land at kickoff'/, 'Worst CLV says what it is waiting for');
  // and all four are concatenated into the output, unconditionally
  assert.match(body, /shortest \+ worst \+ lastIn \+ clv/);
  // a lever the league dropped is shown as dropped, not omitted
  assert.match(body, /'not in the draw'/);
});

test('the section says it is a standing, not a verdict', () => {
  const fn = bozo.slice(bozo.indexOf('function paintLeverStandings('));
  const body = fn.slice(0, fn.indexOf('\n/* Who is holding the belt'));
  assert.match(body, /Only legs that <b>lost<\/b> are eligible/,
    'a ranked list with your name on top reads as an accusation unless told otherwise');
  assert.match(body, /not a forecast of who wears it/);
});

test('Shortest Odds places on the grader’s rule and prints the de-vigged number', () => {
  // The grader (simulate + decide) ranks this lever on RAW implied probability.
  const sim = bozo.slice(bozo.indexOf('function simulate('));
  assert.match(sim.slice(0, sim.indexOf('\n// One definition of')), /k==='odds' \? \(i=>L\[i\]\.odds\)/);
  assert.match(bozo, /odds: imp\(x\.price\)/, 'the sim ranks on imp()');
  const fn = bozo.slice(bozo.indexOf('function paintLeverStandings('));
  assert.match(fn, /rankRows\(rows\.map\(d=>\(\{\.\.\.d\}\)\), d=>d\.raw\)/, 'so the standings rank on imp() too');
  assert.match(fn, /raw: imp\(x\.price\)/);
  assert.match(fn, /shown: pE/, 'and print the de-vigged figure');
  assert.match(fn, /These two disagree on this board/, 'and say so when the two orders differ');
});

test('the reported leg de-vigs to a real win probability', () => {
  // Kap's leg from the board: GT ML at -238, other side +195.
  const p = devigP(-238, 195);
  assert.ok(Math.abs(p - 0.6750) < 0.001, `expected ~67.5%, got ${(p * 100).toFixed(2)}%`);
  // Raw implied over-counts it by roughly the hold — which is why the printed number
  // is the de-vigged one and not this.
  assert.ok(imp(-238) > p);
  assert.equal(devigP(-238, null), null, 'no opposite price is no de-vig, never a guess');
});

test('placements are competition-ranked — a tie is a real tie', () => {
  const rows = [{ v: 3 }, { v: 5 }, { v: 5 }, { v: 1 }];
  const out = rankRows(rows, d => d.v);
  assert.deepEqual(out.map(d => d.rank), [1, 1, 3, 4], 'equal values share a place, the next skips');
  assert.deepEqual(out.map(d => d.v), [5, 5, 3, 1], 'sorted descending');
});

test('Last In is numbered in submission order, and the badge marks the other end', () => {
  const fn = bozo.slice(bozo.indexOf('function paintLeverStandings('));
  const lastIn = fn.slice(fn.indexOf('III · Last In'), fn.indexOf('IV · Worst CLV'));
  assert.match(lastIn, /sort\(\(a,b\)=>a\.ts-b\.ts\)/, 'earliest filed is 1st in');
  assert.match(lastIn, /d\.ts===latest/, 'the badge goes to the newest leg, the end the lever reads');
  assert.match(lastIn, /reads the <b>bottom<\/b> of that list/);
  // same wording the leg preview uses, so one list under one name can't mean two orders
  assert.match(bozo, /You'd be <b>\$\{ordinal\(wouldBe\)\}<\/b> of \$\{size\} in\./);
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(11), '11th');
});

test('Worst CLV drops a leg it cannot de-vig rather than scoring it zero', () => {
  const fn = bozo.slice(bozo.indexOf('function paintLeverStandings('));
  assert.match(fn, /clv: \(pC==null\|\|pE==null\) \? null : \(pC-pE\)/);
  assert.match(fn, /no de-viggable close/);
  assert.match(fn, /rather than\s+scoring it zero/);
});

/* The tests above read the source. This one RUNS paintLeverStandings against the board
   from the bug report, with the page's own imp/devigP/ordinal/rankRows and a DOM stub
   standing in for the four things it touches. Source assertions cannot catch a throw. */
function renderStandings(picks, results, levers, me) {
  const sandbox = {
    S: { results },
    ME: me ? { name: me } : null,
    LEVERS: [{ k: 'odds', name: 'Shortest Odds' }, { k: 'beat', name: 'Worst Beat' },
             { k: 'last', name: 'Last In' }, { k: 'clv', name: 'Worst CLV' }],
    esc: v => String(v),
    teamOf: n => n,
    kEnc: n => n,
    when: ts => 'filed@' + ts,
    sdOf: () => 10,
    dirOf: () => 'over',
    beatDeficit: (m, d, line, margin) => (margin - line) / -10,
    out: null,
    document: { getElementById: () => ({ set innerHTML(v) { sandbox.out = v; } }) },
  };
  const c = vm.createContext(sandbox);
  vm.runInContext(['imp', 'devigP', 'ordinal', 'rankRows', 'ROMAN', 'paintLeverStandings']
    .map(lift).join('\n') + '\npaintLeverStandings(PICKS, LEVERS_IN);', 
    Object.assign(c, { PICKS: picks, LEVERS_IN: levers }));
  return sandbox.out;
}

test('it renders the reported board: Kap 3rd in, −238 shown as its de-vigged 67.5%', () => {
  // Tony, Kap, BUTTS — filed in that order, exactly as the board showed them.
  const picks = [
    { p: 'Tony',  price: -310, entryPriceOpp: 250, ts: 100, mkt: 'ml', line: 0 },
    { p: 'Kap',   price: -238, entryPriceOpp: 195, ts: 200, mkt: 'ml', line: 0 },
    { p: 'BUTTS', price: -150, entryPriceOpp: 125, ts: 300, mkt: 'ml', line: 0 },
  ];
  const html = renderStandings(picks, {}, [0, 1, 2, 3], 'Kap');

  // I · Shortest Odds — biggest favourite first, with the de-vigged percentage
  assert.match(html, /Shortest Odds/);
  assert.match(html, /-238 · 67\.5%/, 'the de-vigged number, not raw implied 70.4%');
  const short = html.slice(html.indexOf('Shortest Odds'), html.indexOf('Worst Beat'));
  assert.deepEqual(short.match(/>(Tony|Kap|BUTTS)</g).map(s => s.slice(1, -1)),
    ['Tony', 'Kap', 'BUTTS'], 'chalkiest leg is 1st');
  assert.match(short, /<span class="pos">1st<\/span><span class="nm">Tony/);
  assert.match(short, /Tony<\/span><span class="holds">holds it<\/span>/, 'the badge is on the leader');

  // III · Last In — submission order, Kap 2nd of 3 here; the badge is at the other end
  const last = html.slice(html.indexOf('Last In'), html.indexOf('Worst CLV'));
  assert.match(last, /<span class="pos">1st<\/span><span class="nm">Tony/);
  assert.match(last, /<span class="pos">3rd<\/span><span class="nm">BUTTS/);
  assert.match(last, /BUTTS<\/span><span class="holds">holds it<\/span>/, 'newest leg holds Last In');
  assert.doesNotMatch(last, /Tony<\/span><span class="holds">/, '1st in does NOT hold it');

  // the viewer's own row is marked
  assert.match(html, /<div class="lvrow me"><span class="pos">2nd<\/span><span class="nm">Kap/);

  // II and IV hold their place and say what they are waiting for
  assert.match(html, /needs a final score/);
  assert.match(html, /awaiting kickoff/);
  assert.match(html, /closes land at kickoff/);
  assert.match(html, /awaiting close/);
});

test('a lever the league dropped is shown as dropped, not silently missing', () => {
  const picks = [{ p: 'Kap', price: -200, entryPriceOpp: 170, ts: 1, mkt: 'ml', line: 0 }];
  const html = renderStandings(picks, {}, [0, 2], 'Kap');
  assert.equal((html.match(/not in the draw/g) || []).length, 2, 'Worst Beat and Worst CLV');
  assert.match(html, /running 2 of 4 levers/);
  assert.match(html, /Shortest Odds/);
  assert.match(html, /Last In/);
});

test('Worst Beat ranks once a score lands, and still lists the legs it cannot score', () => {
  const picks = [
    { p: 'Kap',   price: -200, entryPriceOpp: 170, ts: 1, mkt: 'spread', line: 3 },
    { p: 'BUTTS', price: -180, entryPriceOpp: 150, ts: 2, mkt: 'spread', line: 3 },
  ];
  const html = renderStandings(picks, { Kap: { actual: -17 } }, [0, 1, 2, 3], 'Kap');
  const beat = html.slice(html.indexOf('Worst Beat'), html.indexOf('Last In'));
  assert.match(beat, /1 of 2/, 'the chip says how much is measurable');
  assert.match(beat, /2\.00 SD/, 'the scored leg gets a real number');
  assert.match(beat, /BUTTS<\/span><span class="val">no final score yet/, 'the rest are still listed');
});

test('when de-vigging would reorder the pool, the block says so', () => {
  // A shorter raw price in a fat market against a longer one in a tight market: raw
  // implied puts A first, de-vigging puts B first. The printed number and the placement
  // genuinely disagree here, and the placement follows the grader.
  const picks = [
    { p: 'A', price: -260, entryPriceOpp: 200, ts: 1, mkt: 'ml', line: 0 },
    { p: 'B', price: -250, entryPriceOpp: 280, ts: 2, mkt: 'ml', line: 0 },
  ];
  const html = renderStandings(picks, {}, [0, 1, 2, 3], 'A');
  const short = html.slice(html.indexOf('Shortest Odds'), html.indexOf('Worst Beat'));
  assert.deepEqual(short.match(/>(A|B)</g).map(s => s.slice(1, -1)), ['A', 'B'],
    'placement follows raw implied, which is what the grader ranks on');
  assert.match(short, /-260 · 68\.4%/);
  assert.match(short, /-250 · 73\.1%/, 'B prints the higher probability while placing 2nd');
  assert.match(short, /These two disagree on this board/, 'and that is stated, not hidden');
});

test('a leg with no opposite price still places, and says why it has no percentage', () => {
  const picks = [
    { p: 'A', price: -300, entryPriceOpp: 240, ts: 1, mkt: 'ml', line: 0 },
    { p: 'B', price: -200, entryPriceOpp: null, ts: 2, mkt: 'ml', line: 0 },
  ];
  const short = renderStandings(picks, {}, [0, 1, 2, 3], 'A');
  assert.match(short, /-200 · —/, 'no de-vig is shown as nothing, never as a raw number');
  assert.match(short, /1 leg has no opposite price filed/);
  assert.match(short, /the placement still stands/);
});
