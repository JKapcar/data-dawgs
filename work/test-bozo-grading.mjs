/* Grading — the three bugs the simulator warned about, pinned so they cannot come back.
 *
 * Run: node test-bozo-grading.mjs
 *
 * ⚠️ ALL THREE ARE SILENT. None throws, none logs, none renders wrong. They produce a
 * confident, plausible, incorrect answer about who lost — which in Standard names the
 * wrong bozo and in Bozo Royale eliminates the wrong person. Tests are the only place
 * they are visible.
 */
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const WORK = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(resolve(WORK, "..", "bozo.html"), "utf8");
const worker = readFileSync(resolve(WORK, "..", "dawg-bot-worker.js"), "utf8");

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) pass++; else { fail++; console.error("FAIL:", n, x === undefined ? "" : "→ " + x); } };

/* ---- lift a top-level function out of the page and run it FOR REAL ----
   ⚠️ Lifted, never re-implemented. A second copy of this arithmetic written here would be
   exactly as wrong as the original and would agree with it perfectly — which is the one
   thing a test must never do. Plain string search rather than a regex: the bodies contain
   braces, slashes and template literals, and escaping all of those correctly is its own
   source of bugs. */
function src(name) {
  const at = page.indexOf("function " + name + "(");
  if (at < 0) throw new Error("could not find " + name + " in bozo.html — renamed?");
  const end = page.indexOf("\n}", at);
  if (end < 0) throw new Error("could not find the end of " + name);
  return page.slice(at, end + 2);
}
// Several of these call each other, so they are lifted together into one scope rather
// than one at a time — a lifted function whose dependency is missing throws at call
// time, which looks like a broken test rather than a broken lift.
function lift(name, ...deps) {
  const body = [...deps.map(src), src(name)].join("\n");
  return new Function(body + "\nreturn " + name + ";")();
}

const legLabel = lift("legLabel");
ok(typeof legLabel === "function", "legLabel is liftable from the page");

/* =================== 1. the spread sign =====================================
   `line` is what THIS SIDE GIVES UP: positive lays, negative takes. The label has to
   invert it, because the number is a handicap and the label is what you'd read on a
   bet slip. Getting this backwards is how an MLB/NHL dog at +1.5 becomes a lay. */
ok(legLabel("spread", "DET", 8.5) === "DET -8.5", "laying 8.5 prints as -8.5", legLabel("spread", "DET", 8.5));
ok(legLabel("spread", "PIT", -1.5) === "PIT +1.5", "taking 1.5 prints as +1.5, not a bare 1.5",
   legLabel("spread", "PIT", -1.5));
ok(legLabel("ml", "CLE") === "CLE ML", "a moneyline has no number");
ok(legLabel("total", "over", 47.5, null, "DET@GB") === "DET@GB o47.5", "a total names the game");

/* =================== 2. push handling =======================================
   The grader used `m > x.line`, which has no third state. Landing exactly on the number
   is a PUSH: the stake comes back, the leg voids on the ticket, and it says nothing
   about whether you beat the number. Scored as a loss it makes you eligible to wear it. */
const grade = lift("gradeLeg", "legEdge");
ok(typeof grade === "function", "gradeLeg is liftable from the page");
const beatDeficit = lift("beatDeficit", "legEdge");
ok(typeof beatDeficit === "function", "beatDeficit is liftable too");

ok(/results\[p\]\.result = outcome;/.test(page), "autoGrade stores the three-state result");
ok(/results\[p\]\.won\s+= outcome==='won' \? true : outcome==='lost' \? false : null;/.test(page),
   "…and `won` is NULL on a push, so nothing downstream reads it as a loss");
ok(/outcome = gradeLeg\(/.test(page), "autoGrade calls the same function this test does");

ok(grade("spread", "over", 8.5, 9) === "won",  "DET -8.5 winning by 9 covers");
ok(grade("spread", "over", 8.5, 8) === "lost", "…by 8 does not");
ok(grade("spread", "over", 8.5, 8.5) === "push", "…by exactly 8.5 is a push, not a loss");
ok(grade("spread", "over", 7, 7) === "push", "a whole-number spread landed on exactly is a push");
ok(grade("total", "over", 47.5, null, 48) === "won", "over 47.5 with 48 wins");
ok(grade("total", "under", 47, null, 47) === "push", "under 47 with exactly 47 is a push");
ok(grade("ml", "over", 0, 0) === "push", "a drawn game is a push on the moneyline, not a loss");
ok(grade("ml", "over", 0, -3) === "lost", "losing by 3 loses the moneyline");

/* The MLB/NHL case the handoff called out by name: the band-legal bet is the DOG at
   +1.5 priced short, stored as -1.5 because it TAKES a run. */
ok(grade("spread", "over", -1.5, -1) === "won",
   "a puckline dog at +1.5 losing by 1 still covers");
ok(grade("spread", "over", -1.5, -2) === "lost",
   "…losing by 2 does not");
ok(grade("spread", "over", -1.5, 3) === "won",
   "…and winning outright obviously covers");

/* ⚠️ The regression itself: under the old comparison every push above scored as a loss. */
for (const [mkt, dir, line, m, tot] of [["spread","over",8.5,8.5,null],["total","under",47,null,47],["ml","over",0,0,null]]) {
  const old = mkt === "total" ? (dir === "over" ? tot > line : tot < line) : (mkt === "ml" ? m > 0 : m > line);
  ok(old === false && grade(mkt, dir, line, m, tot) === "push",
     `the old grader called this ${mkt} push a loss; the new one does not`);
}

/* =================== 3. one event, one outcome ==============================
   Props are hand-graded per player. Two people on the same selection share one
   real-world fact, so they cannot be graded apart. */
ok(/same selection/.test(worker) && /only have one outcome/.test(worker),
   "the Worker refuses a divergent grade on one selection");
ok(/p\.mkt !== "prop" && p\.mkt !== "other"/.test(worker),
   "…scoped to the hand-graded markets, since game markets read one outcome per event anyway");
ok(/\[p\.eventId, p\.mkt, p\.prop \|\| "", p\.line \?\? "", p\.side \?\? ""\]/.test(worker),
   "…keyed on the selection, not on the leg");
ok(/return json\(\{ error:[\s\S]{0,400}Fix the odd one out/.test(worker),
   "…and refuses rather than picking a winner, which would be inventing the result");
const code = page.replace(/\/\*[\s\S]*?\*\//g, "");
ok(/twinnote/.test(code) && /graded together/.test(code),
   "the page mirrors the answer across the group and says why the boxes move together");

/* Push must be expressible by hand too — a scratched prop is void, not lost. */
ok(/<option value="p">Push \/ void<\/option>/.test(page),
   "manual grading offers Push / void");
ok(/r\.result = s\.value==='1' \? 'won' : s\.value==='0' \? 'lost' : 'push';/.test(code),
   "…and carries it through as the three-state result");

/* =============== 4. Worst Beat measures from the NUMBER ==================
   ⚠️ THE CORRECTION. This used to measure the gap to expected(), which folds the price
   in — so a −400 favourite missing by three scored worse than a −110 missing by three.
   But SHORTEST ODDS is already the lever that punishes chalk, and pricing it in here too
   made two of the four levers measure overlapping things. A randomised hierarchy is only
   interesting while its levers stay independent. The rule text says "furthest under its
   number, in standard deviations", and that is now literally what it computes. */
{
  const SD = 13.5;   // nfl
  const a = beatDeficit("spread", "over", 3, -1, null, SD);
  ok(Math.abs(a - 4 / SD) < 1e-9, "the deficit is exactly the points missed, over the SD", a);

  ok(beatDeficit("spread", "over", 3, -10, null, SD) > beatDeficit("spread", "over", 3, -1, null, SD),
     "missing by more is a worse beat");
  ok(beatDeficit("spread", "over", 3, 9, null, SD) < 0, "a leg that covered has a negative deficit");

  // It is the grader's own edge, negated — one definition of "missed", not two.
  for (const [mkt, dir, line, m, tot] of [
    ["spread","over",3,-1,null], ["ml","over",0,-6,null],
    ["total","over",47.5,null,41], ["total","under",47.5,null,55], ["spread","over",-1.5,-4,null]]) {
    const d = beatDeficit(mkt, dir, line, m, tot, SD);
    const g = grade(mkt, dir, line, m, tot);
    ok((d > 0) === (g === "lost"), `${mkt} ${dir}: a positive deficit means exactly 'lost'`, `${d} / ${g}`);
  }

  // The MLB/NHL runline dog: it TAKES 1.5, so losing by 1 covered and the deficit must
  // be negative even though the margin is.
  ok(beatDeficit("spread", "over", -1.5, -1, null, 2.2) < 0,
     "a puckline dog that covered has a negative deficit despite losing the game");

  ok(beatDeficit("spread", "over", 3, -1, null, 0) === null, "a zero SD yields null, not Infinity");

  const body = page.slice(page.indexOf("function beatDeficit"), page.indexOf("function beatDeficit") + 300);
  ok(!/expected\(/.test(body), "beatDeficit no longer consults the price-implied expectation");
}

/* =============== 5. the lever ==========================================
   ⚠️ It has to be pullable. Twice now this has been "simplified" into an auto-paint and
   twice the result was that nobody saw the reels move — most recently because every
   board that exists is either graded (auto-revealed) or undrawn (lever disabled). */
{
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");
  ok(!/hasSeenDraw|markDrawSeen|SEEN_KEY/.test(code),
     "the once-per-draw localStorage memory is gone — every load gets the pull");
  ok(/let drawnOrder = null;/.test(code),
     "…replaced by a page-lifetime flag, so a reload is a new show");
  ok(/if\(pendingDraw===key\) return;/.test(code) && /if\(drawnOrder===key\)/.test(code),
     "a draw always arms unless THIS load already revealed it");
  /* ⚠️ SCOPED to paintMachine, not to the whole page. When this was written that
     expression existed only in the auto-paint, so grepping the file was the same thing as
     grepping the reveal path. 952e932 added the betslip bar, and paintSlipBar() computes
     the identical expression for an unrelated and entirely correct reason — a graded week
     cannot accept a new slip. The guard then failed on code 1,500 lines from the reels,
     which reads like the auto-reveal came back when it never did. Ask the reveal path. */
  const mStart = code.indexOf("function paintMachine(");
  ok(mStart > 0, "paintMachine is still there to be checked");
  const mEnd = code.indexOf("\nfunction ", mStart + 1);
  const machine = code.slice(mStart, mEnd === -1 ? undefined : mEnd);
  ok(!/const graded = \(S\.status\|\|'open'\)==='graded'/.test(machine),
     "a graded week no longer auto-reveals — the reels show the whole order, the verdict names one lever");
  // The poll must not blank the reels under the reader's cursor.
  ok(/drawnOrder=order\.join\(','\);/.test(code),
     "pulling records the reveal for this load, so render() on the 15s poll repaints statically");
  ok(/pendingDraw=null; drawnOrder=null;/.test(code),
     "…and clearing the machine resets it, so a new week does not inherit the last one's reveal");

  // ---- v2 machine invariants ----
  // The lever decides nothing, so there is no state in which it is refused. The
  // only guard is against pulling reels that are already moving.
  ok(!/lv\.disabled=cfg\[1\][\s\S]{0,400}idle:\['[^']*',\s*true/.test(code)
     && /idle:\['Pull',\s*false/.test(code),
     "the lever is live on an undrawn board — a pull reveals, it never decides");
  ok(/busy:\['[^']*',\s*true/.test(code),
     "…and is inert only while its own reels are still moving");
  // Before the draw exists there is nothing to stop on, so the reels must come back.
  ok(/function emptySpin\(\)/.test(code) && /function emptyEnd\(run\)/.test(code),
     "a pull on an undrawn board spins and returns to idle rather than stopping");
  // scope the check to the two function bodies rather than a span of source
  const body = n => (code.match(new RegExp("function " + n + "\\([^)]*\\)\\{[\\s\\S]*?\\n\\}")) || [""])[0];
  const empties = body("emptySpin") + body("emptyEnd");
  ok(empties.length > 0 && !/paintOrder|revealSpin|addOrd|lockReel/.test(empties),
     "…and never paints an order, because none has been written");
  ok(/if\(!ord\|\|!ord\.length\)\{ emptySpin\(\); return; \}/.test(code),
     "one pull, two outcomes, chosen by whether the server wrote an order");
  // Cell height must not be read while the cabinet is mid-rotation.
  ok(/offsetHeight/.test(code) && !/\.win'\)\.getBoundingClientRect/.test(code),
     "cell height is measured with offsetHeight, so a rotating cabinet cannot skew the payline");
  // The near-miss is the one casino mechanic that is off the table here.
  ok(!/tease|nearMiss|near_miss/i.test(code),
     "no reel tease — the reels never park on a lever the server did not draw");
  // A <button> driven only by Pointer Events ignores anything that ACTIVATES it
  // rather than pointing at it: screen readers, voice control, element.click().
  ok(/lever\.addEventListener\('click'/.test(code),
     "the lever answers a plain click, so assistive tech can activate it");
  ok(/performance\.now\(\)-handledAt < 600/.test(code),
     "…without double-firing on the click the browser sends after pointerup");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
