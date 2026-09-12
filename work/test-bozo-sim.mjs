/* The weekly simulation, conditioned on what is already known.
 *
 * Run: node test-bozo-sim.mjs
 *
 * ⚠️ WHY THIS IS A BEHAVIOURAL SUITE AND NOT A GREP. Every other Bozo suite pins shapes
 * in the source, which is enough for a route or a stamp. Bozo odds are a number a person
 * reads off the board and believes, and the failure that prompted this was not a crash or
 * a missing field — it was 20,000 runs still rolling dice over a game that had already
 * finished, producing a number that looked freshly computed and described a world that no
 * longer existed. The only way to catch that is to run the real function and check the
 * odds actually move.
 *
 * simulate() is lifted out of bozo.html by content markers and run in a VM with the few
 * helpers it reads stubbed. It is the shipped code, not a paraphrase.
 */
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import vm from "node:vm";

const WORK = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(resolve(WORK, "..", "bozo.html"), "utf8");

function grab(startMarker, endMarker) {
  const a = page.indexOf(startMarker);
  if (a < 0) throw new Error("fixture: marker moved — " + startMarker);
  const b = page.indexOf(endMarker, a);
  if (b < 0) throw new Error("fixture: end marker moved — " + endMarker);
  return page.slice(a, b);
}

/* ⚠️ legRow is lifted in rather than stubbed. It is how the simulation finds a leg's
   results row, and stubbing it would let the suite keep passing if that lookup broke —
   which is exactly the failure that put a hand-set CLV on one screen and nowhere else. */
const src = grab("function beatDeficit(mkt, dir, line, margin, total, sd){", "\n/* The leg exactly as the board")
  + "\n" + grab("function binaryBeatOf(p){", "\n/* ⚠️ ONE WORST-BEAT RULE")
  + "\n" + grab("function legRow(x){", "/* ⚠️ A HAND-SET CLV OUTRANKS")
  + "\n" + grab("function clvDeltaOf(x, r){", "\nconst amer = d =>")
  + "\n" + grab("function gauss(){", "const devig = px")
  + "\n" + grab("function simulate(live, levers){", "\n// One definition of")
  + "\n" + grab("function clvDevig(price, opp){", "/** did either side")
  + "\n" + grab("function clvPair(l){", "const clvGraded =");

const ctx = vm.createContext({
  SIMS: 20000,
  LEVERS: [{ k: "odds" }, { k: "beat" }, { k: "last" }, { k: "clv" }],
  Math, JSON, Array, Number, Infinity, console,
  kEnc: p => p,
  imp: o => (o < 0 ? -o / (-o + 100) : 100 / (o + 100)),
  devigP: (a, b) => {
    if (a == null || b == null) return null;
    const ia = a < 0 ? -a / (-a + 100) : 100 / (a + 100);
    const ib = b < 0 ? -b / (-b + 100) : 100 / (b + 100);
    return ia / (ia + ib);
  },
  dirOf: x => ((x && (x.dir || x.side)) === "under" ? "under" : "over"),
  legEdge: () => 0,
  clvImp: o => (o < 0 ? -o / (-o + 100) : 100 / (o + 100)),
  clvAm: pr => (pr >= 0.5 ? Math.round((-100 * pr) / (1 - pr)) : Math.round((100 * (1 - pr)) / pr)),
  CLV_OVERROUND: 1.047619,
  sdOf: () => 13.5,
  isRoyale: () => false,
  invNorm: p => { const a=[-39.69683028665376,220.9460984245205,-275.9285104469687,138.357751867269,-30.66479806614716,2.506628277459239],
    b=[-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572],
    c=[-0.007784894002430293,-0.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783],
    d=[0.007784695709041462,0.3224671290700398,2.445134137142996,3.754408661907416]; const pl=0.02425; let q,r;
    if(p<pl){q=Math.sqrt(-2*Math.log(p));return(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
    if(p>1-pl){q=Math.sqrt(-2*Math.log(1-p));return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
    q=p-0.5;r=q*q;return(((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1); },
  expected: x => x.exp,
  S: { results: {}, picks: {} },
});
vm.runInContext(src + "\nglobalThis.__sim = simulate; globalThis.__pair = clvPair; globalThis.__delta = clvDeltaOf;", ctx);
const simulate = ctx.__sim, clvPair = ctx.__pair, clvDeltaOf = ctx.__delta;

const legs = Array.from({ length: 8 }, (_, i) => ({
  p: "P" + i, price: -150 - i * 10, ts: 1000 + i, line: 0, mkt: "ml",
  side: "over", sport: "nfl", exp: 3 + i * 0.25, entryPriceOpp: 130,
}));
const run = results => { ctx.S.results = results; return simulate(legs, [0, 1, 2, 3]); };

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error("FAIL:", name); } };

const before = run({});
const afterLoss = run({ P0: { result: "lost", won: false }, P1: { result: "won", won: true } });
const afterPush = run({ P0: { result: "lost", won: false }, P1: { result: "won", won: true },
                        P2: { result: "push", won: null } });

ok(before.settled === 0, "an ungraded board holds nothing fixed");
ok(before.cash > 0, "...and its ticket can still cash");

/* ⚠️ THE BUG. A graded leg used to keep its pre-kickoff win probability, so the player
   certainly in the pool read the same as before the ball was kicked. */
ok(afterLoss.win[0] === 0, "a leg graded lost never wins in any run");
ok(afterLoss.win[1] === 1, "a leg graded won wins in every run");
ok(afterLoss.bozo[1] === 0, "a leg graded won can never wear it");
ok(afterLoss.bozo[0] > before.bozo[0] * 2,
   "the lost leg's bozo odds rise sharply once the loss is known");
ok(afterLoss.cash === 0, "one lost leg means the ticket cannot cash");
ok(afterLoss.settled === 2, "the settled count tracks graded legs");

/* Somebody always wears it once a leg has lost — the distribution must still be proper,
   or the meters are drawn against a total that is not 1. */
ok(Math.abs(afterLoss.bozo.reduce((a, b) => a + b, 0) - 1) < 1e-9,
   "bozo odds sum to 1 once any leg has lost");

/* A push voids the leg: it is not the loss that makes you the bozo, and it does not stop
   the rest of the ticket. Coercing it to a loss would eliminate someone under Royale. */
ok(afterPush.win[2] === 1, "a push voids the leg — it is never a loser");
ok(afterPush.bozo[2] === 0, "a push can never make you the bozo");
ok(afterPush.settled === 3, "a push counts as settled");

/* An unsettled leg must still be simulated — conditioning is not freezing the board. */
ok(afterLoss.win[7] > 0.3 && afterLoss.win[7] < 0.95,
   "an unsettled leg is still drawn, not pinned");

/* Known actual drives Worst Beat off the real number rather than a draw, exactly as
   decide() does when it grades for real. Two runs with the same actuals must agree
   far more closely than two runs that redraw them. */
const withActual = () => run({
  P0: { result: "lost", won: false, actual: -21 },
  P1: { result: "lost", won: false, actual: -1 },
});
const a1 = withActual(), a2 = withActual();
ok(Math.abs(a1.bozo[0] - a2.bozo[0]) < 0.02,
   "a graded leg with a known actual gives a stable Worst Beat ranking across runs");
ok(a1.bozo[0] > a1.bozo[1],
   "...and the leg that missed by more is likelier to wear it");

/* ⚠️ The memo key has to notice a grade or none of the above ever reaches the screen:
   the cache outlives the fact that invalidated it. */
const keySrc = page.slice(page.indexOf("const simKeyFor"), page.indexOf("const pct = v =>"));
ok(/r\.result\?\?''/.test(keySrc.replace(/\s+/g, "")) || /r\.result/.test(keySrc),
   "the sim cache key includes the result");
ok(/r\.actual/.test(keySrc), "...and the actual");
ok(/r\.won/.test(keySrc), "...and won");

/* ---- the manager's CLV override ---- */

/* ⚠️ WHY AN OVERRIDE EXISTS AT ALL. A close is EVIDENCE of CLV, not the definition of
   it. When DraftKings pulls a market, or never had a two-sided price to capture, the leg
   still has a CLV the manager can read off the slip — and the machinery had no way to be
   told. It was dropped from the chart and from n instead: honest about the gap, useless
   for closing it. */
ok(clvDeltaOf({ price: -150, entryPriceOpp: 130 }, { clvPts: 0 }) === 0,
   "an override of 0 reads as exactly zero CLV, not as missing");
ok(clvDeltaOf({ price: -150, entryPriceOpp: 130 }, {}) === null,
   "...and with no override and no close it is still unmeasurable, never zero");
ok(Math.abs(clvDeltaOf({ price: -150, entryPriceOpp: 130 }, { clvPts: -2.5 }) + 0.025) < 1e-12,
   "points convert to probability: -2.5 pts is -0.025");
ok(clvDeltaOf({ price: -150, entryPriceOpp: 130 }, { clvPts: 1, close: -200, closeOpp: 170 }) === 0.01,
   "the manager's number outranks a captured close when both exist");

/* An override implies a closing probability too — a CLV of X points means the de-vigged
   close was X points above entry — so the leg becomes chartable on BOTH axes. That
   identity is the reason this can be stored as one number. */
{
  const leg = { result: "win", entryPrice: -150, entryPriceOpp: 130, closePrice: null,
                closePriceOpp: null, clvPts: 0 };
  const pair = clvPair(leg);
  ok(pair != null, "a leg with an override and no close is chartable");
  ok(pair.clv === 0 && Math.abs(pair.pC - pair.pE) < 1e-12,
     "...at zero CLV, with a closing probability equal to entry");
  ok(pair.manual === true, "...and it is flagged as set by hand, never mixed with a capture");
  ok(clvPair({ result: "win", entryPrice: null, clvPts: 0 }) == null,
     "an override without an entry price is still unmeasurable — there is nothing to be relative to");
  const derived = clvPair({ result: "win", entryPrice: -150, entryPriceOpp: 130,
                            closePrice: -200, closePriceOpp: 170 });
  ok(derived != null && derived.manual === false,
     "a leg with a real close still derives, and is not flagged manual");
}

/* The CLV lever in the sim must see the override, or the number on the diagnostics panel
   and the number that decides a chop disagree. */
{
  const legs2 = Array.from({ length: 3 }, (_, i) => ({
    p: "Q" + i, price: -150, ts: 1000 + i, line: 0, mkt: "ml",
    side: "over", sport: "nfl", exp: 3, entryPriceOpp: 130,
  }));
  ctx.S.results = {
    Q0: { result: "lost", won: false, clvPts: -8 },
    Q1: { result: "lost", won: false, clvPts: 0 },
    Q2: { result: "lost", won: false, clvPts: +4 },
  };
  const R = simulate(legs2, [3]);          // Worst CLV only
  ok(R.bozo[0] > 0.99,
     "with only the CLV lever live, the worst overridden CLV wears it every time");
  ok(R.bozo[2] === 0, "the best CLV never does");
}

/* ⚠️ THE DRAWN HIERARCHY IS A FACT, AND A LOSER BEATEN ON THE FIRST LEVER READS 0%.
 * The server draws ONE permutation when the board locks and writes it to S.order;
 * decide(), the real grader, walks exactly that order. This function drew a fresh one on
 * every run, so after the lock the odds described 20,000 different weeks, none of them
 * the week being played — and a player who could not possibly wear it was shown a
 * double-digit chance of wearing it. That is what was reported, with two losers on the
 * ticket and a 26% next to the safe one.
 */
{
  const both = [
    // Squatch: lost, CLV 0.00 set by hand — the worst CLV of the two.
    { p: "Squatch", price: -145, ts: 9, mkt: "other", exp: 0, line: 0,
      res: { result: "lost", clvPts: 0 } },
    // BUTTS: lost, CLV +2.06 from a captured close — better on the CLV lever.
    { p: "BUTTS", price: -198, entryPriceOpp: 164, ts: 2, mkt: "ml", exp: 0, line: 0,
      res: { result: "lost", close: -218, closeOpp: 180 } },
  ];
  ctx.S.results = { Squatch: both[0].res, BUTTS: both[1].res };
  ctx.S.picks = { Squatch: both[0], BUTTS: both[1] };
  const live = both.map(x => ({ ...x }));

  // Worst CLV first in the drawn order. Squatch is worse, so he wears it every run.
  ctx.S.order = [3, 0, 1, 2];
  const r1 = simulate(live, [0, 1, 2, 3]);
  const iSq = 0, iBu = 1;
  ok(r1.bozo[iSq] === 1, "with Worst CLV drawn first, the worse CLV wears it every run");
  ok(r1.bozo[iBu] === 0,
     "and the loser beaten on that lever reads 0% — he cannot be the bozo, so he is not shown as able to be");

  /* The order is the fact, not the outcome: draw a different first lever and the answer
     changes, deterministically, exactly as the grader would. */
  ctx.S.order = [0, 3, 1, 2];                   // Shortest odds first
  const r2 = simulate(live, [0, 1, 2, 3]);
  ok(r2.bozo[iSq] + r2.bozo[iBu] === 1, "a different drawn order still resolves to one certain bozo");
  ok(r2.bozo[iSq] !== r1.bozo[iSq],
     "and it resolves to the other player, because Shortest odds ranks them the other way");

  /* ⚠️ Before the lock there is no order to know, and the fresh permutation is right. */
  delete ctx.S.order;
  const r3 = simulate(live, [0, 1, 2, 3]);
  ok(r3.bozo[iSq] > 0 && r3.bozo[iBu] > 0,
     "with no hierarchy drawn yet, both losers keep a share — every permutation is still in play");
  ctx.S.results = {}; ctx.S.picks = {};
}

/* ⚠️ AN UNMEASURED LEG IS NOT A SAFE LEG.
 * Worst CLV drawn first, two legs measurable out of eight, six games not yet kicked off.
 * The lever used to narrow the pool to the MEASURED legs only, so the worse of the two
 * wore it in every run — 100% — while six legs that could close worse were ruled out by a
 * lever that had no opinion about them. Being unmeasurable is not evidence.
 */
{
  const board = [
    // measured, worse of the two
    { p: "Squatch", price: -145, ts: 9, mkt: "other", exp: 0, line: 0,
      res: { result: "lost", clvPts: 0 } },
    // measured, better — this one the lever CAN rule out, and should
    { p: "BUTTS", price: -198, entryPriceOpp: 164, ts: 2, mkt: "ml", exp: 0, line: 0,
      res: { result: "lost", close: -218, closeOpp: 180 } },
  ];
  // six unmeasured legs whose games have not been played: no result, no close
  for (let i = 0; i < 6; i++)
    board.push({ p: "open" + i, price: -150, entryPriceOpp: 130, ts: 3 + i, mkt: "ml",
                 exp: 0, line: 0, res: {} });

  ctx.S.results = {}; ctx.S.picks = {};
  for (const b of board) { ctx.S.results[b.p] = b.res; ctx.S.picks[b.p] = b; }
  const live = board.map(x => ({ ...x }));
  ctx.S.order = [3, 0, 1, 2];                       // Worst CLV first

  const r = simulate(live, [0, 1, 2, 3]);
  ok(r.bozo[0] < 1,
     "the worst MEASURED CLV is not certain to wear it while six legs are unmeasured");
  ok(r.bozo.slice(2).some(v => v > 0),
     "a leg the lever cannot measure keeps a real chance — it is carried forward, not ruled safe");
  ok(r.bozo[1] === 0,
     "but a measured leg beaten by another measured leg IS eliminated — that holds whatever the rest do");

  /* ⚠️ The sim and the grader must answer one week one way. decide() has always passed
     when a lever scores nothing (`if(!scored.length) continue;`); the sim used to pick
     uniformly at random instead, inventing a verdict out of no information. */
  ctx.S.results = { a: { result: "lost" }, b: { result: "lost" } };
  ctx.S.picks = { a: {}, b: {} };
  const none = [
    { p: "a", price: -150, ts: 1, mkt: "ml", exp: 0, line: 0 },
    { p: "b", price: -150, ts: 2, mkt: "ml", exp: 0, line: 0 },
  ];
  const r2 = simulate(none.map(x => ({ ...x })), [3]);   // CLV only, nothing measurable
  ok(r2.bozo[0] + r2.bozo[1] === 1, "with the only lever unmeasurable the week still resolves");
  ok(r2.by.every(b => b === null),
     "and no lever claims to have named it — the cascade passed, it did not coin-flip");

  ctx.S.results = {}; ctx.S.picks = {}; delete ctx.S.order;
}

/* ⚠️ A BINARY LEG TAKES ITS MARGIN FROM ITS OWN DE-VIGGED PRICE, IN BOTH FORMATS.
 * Kap's call, 2026-09-12, replacing three rules that disagreed about one leg: decide()
 * floored a binary leg at 999 (the worst possible beat), simulate() ranked it off a margin
 * it does not have, and only Royale did this. The same leg read "1st 999.00 SD" in one
 * league and "2nd 0.49 SD" in another — because the 999 branch compared `r.actual === 0`
 * strictly and a text box stores the string "0", so which rule a player got depended on
 * which control last wrote the number.
 *
 * The property that matters: the penalty scales with how chalky the prop was. A near-miss
 * coin flip and a busted heavy favourite must NOT rank the same, which is exactly what the
 * floor did.
 */
{
  ctx.S.results = {}; ctx.S.picks = { chalk: {}, flip: {} };
  const props = [
    { p: "chalk", price: -400, entryPriceOpp: 320, ts: 1, mkt: "prop", line: 0.5, exp: 0 },
    { p: "flip", price: -110, entryPriceOpp: -110, ts: 2, mkt: "prop", line: 0.5, exp: 0 },
  ];
  ctx.S.order = [1, 0, 2, 3];                       // Worst Beat first
  ctx.S.results = { chalk: { result: "lost" }, flip: { result: "lost" } };
  const r = simulate(props.map(x => ({ ...x })), [1]);
  ok(r.bozo[0] === 1 && r.bozo[1] === 0,
     "a busted -400 prop is a worse beat than a busted coin flip — the penalty scales with the price");

  /* ⚠️ And it is finite and comparable, not a sentinel. A binary leg must be rankable
     ALONGSIDE margin legs, which is what the 999 floor destroyed. */
  ctx.S.picks = { prop: {}, side: {} };
  ctx.S.results = { prop: { result: "lost" }, side: { result: "lost", actual: -30 } };
  const mixed = [
    { p: "prop", price: -145, entryPriceOpp: null, ts: 1, mkt: "other", line: 0.5, exp: 0 },
    { p: "side", price: -110, entryPriceOpp: -110, ts: 2, mkt: "spread", line: 0, exp: 0 },
  ];
  const r2 = simulate(mixed.map(x => ({ ...x })), [1]);
  ok(r2.bozo[1] === 1,
     "a spread that missed by 30 outranks a mildly-priced prop that busted, as it should");
  ok(r2.bozo[0] === 0, "...and the prop is not floored past it by a sentinel");

  /* ⚠️ THE EXPECTED MISS, NOT THE THRESHOLD. invNorm(p) is where a leg priced at p sits
     exactly on its line. A margin leg that loses is drawn from ABOVE that, so scoring a
     binary leg at the threshold parked it at the very bottom of the range a comparable
     margin leg occupies — a busted prop read as a milder miss than ANY lost spread priced
     the same way. That is how a player whose leg had already lost sat below one whose
     game had not kicked off. */
  const bb = ctx.binaryBeatOf ?? vm.runInContext("binaryBeatOf", ctx);
  for(const p of [0.524, 0.565, 0.64, 0.80]){
    const k = ctx.invNorm(p);
    ok(bb(p) > k, `a binary leg priced at ${p} scores above its threshold, not at it`);
  }
  ok(Math.abs(bb(0.64) - 1.039) < 0.01, "-145 de-vigged to .64 scores about 1.04 SD, not 0.36");
  ok(Math.abs(bb(0.80) - 1.400) < 0.01, "a -400 prop scores about 1.40 SD");
  ok(bb(0.80) > bb(0.64) && bb(0.64) > bb(0.524),
     "and the chalkier the prop, the worse the beat — the ordering Kap asked for survives");
  ok(bb(0) === null && bb(1) === null, "an unpriceable leg is null, never a number");

  ctx.S.results = {}; ctx.S.picks = {}; delete ctx.S.order;
}

/* Nothing anywhere may floor a binary leg at a fake standard deviation again. */
{
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/999/.test(code.slice(code.indexOf("function beatOf("), code.indexOf("function beatOf(") + 1400)),
     "beatOf has no sentinel");
  ok(/const binary = x\.mkt === 'prop' \|\| x\.mkt === 'other';/.test(code)
     && !/if\(!isRoyale\(\)\) return null;/.test(code),
     "and the rule is the same in Standard and Royale, not two rules");
}

/* ⚠️ AND THE MARGIN IS MEASURED FROM THE LEG'S OWN NUMBER, not from the price-shifted
 * expectation. Folding the price in made the same miss score worse for a heavy favourite
 * than for a coin flip, so Worst Beat duplicated Shortest Odds — and a randomised
 * hierarchy is only interesting while its levers are independent.
 *
 * Asserted on the formula rather than on bozo odds, deliberately: a leg's price sets BOTH
 * how often it loses and (under the old rule) how far under it scores, so any behavioural
 * comparison entangles the two and can pass while the bug is live. The property is simply
 * that the index does not read the expectation at all. */
{
  const simSrc = page.slice(page.indexOf("function simulate(live, levers){"),
                            page.indexOf("\n// One definition of"));
  const idxLine = simSrc.slice(simSrc.indexOf("idx[i] ="), simSrc.indexOf(";", simSrc.indexOf("idx[i] =")));
  ok(!/l\.exp/.test(idxLine),
     "the Bozo Index is measured from the leg's own number, never from the price-shifted expectation");
  ok(/l\.base/.test(idxLine), "...which is l.base — the line the leg was taken at");
  ok(/l\.binary/.test(idxLine), "and a binary leg is left unscored for the cascade to carry forward");
}

/* ---- the grader stopped scoring an unmeasurable leg as the safest ---- */
{
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/beatDeficit\([^)]*\) \?\? 0/.test(code) && !/let beat=0;/.test(code),
     "decide() no longer defaults an unscoreable beat to 0, which ranked it safest");
  ok(!/beat=999/.test(code) && !/return 999;/.test(code),
     "and nothing floors a binary leg at the worst possible beat any more");
  ok(/const beat = beatOf\(x, r, sd\);/.test(code),
     "it reads the one shared rule instead of its own copy");
  ok((code.match(/function beatOf\(/g) || []).length === 1
     && (code.match(/=== 'over'\)\n    return 999;|return 999;/g) || []).length <= 2,
     "there is exactly one definition of the worst-beat rule");
  ok(/const scored = pool\.filter\(i=>Number\.isFinite\(f\(i\)\)\);/.test(code),
     "and a leg with no SD is carried forward by the sim rather than losing every comparison as NaN");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
