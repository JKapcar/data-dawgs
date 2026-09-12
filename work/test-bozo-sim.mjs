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

const src = grab("function clvDeltaOf(x, r){", "\nconst amer = d =>")
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
  clvImp: o => (o < 0 ? -o / (-o + 100) : 100 / (o + 100)),
  clvAm: pr => (pr >= 0.5 ? Math.round((-100 * pr) / (1 - pr)) : Math.round((100 * (1 - pr)) / pr)),
  CLV_OVERROUND: 1.047619,
  sdOf: () => 13.5,
  expected: x => x.exp,
  S: { results: {} },
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
