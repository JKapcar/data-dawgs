/* Filling a missing closing price by hand — the invariants a manager cannot see failing.
 *
 * Run: node test-bozo-close-fill.mjs
 *
 * ⚠️ WHY THIS IS ITS OWN SUITE. The failure mode here is silent by construction: a close
 * saved with only one side stores fine, renders a number back at you, and is STILL
 * dropped by the chart, because one side cannot be de-vigged. Nothing looks broken. The
 * only defence is refusing it at both ends and saying why, and these pin that.
 */
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const WORK = dirname(fileURLToPath(import.meta.url));
const worker = readFileSync(resolve(WORK, "..", "dawg-bot-worker.js"), "utf8");
const page = readFileSync(resolve(WORK, "..", "bozo.html"), "utf8");
const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, "");

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error("FAIL:", name); } };

/* ---- the server ---- */
ok(/async function bozoCloseFill/.test(worker), "the fill route exists");
ok(/async function bozoCloseGaps/.test(worker), "the gap list exists");
ok(/"\/bozo\/close"/.test(worker) && /"\/bozo\/close-gaps"/.test(worker), "both are routed");

/* ⚠️ THIS INVARIANT WAS DELIBERATELY REVERSED. A lone price used to be refused because
   it cannot be de-vigged — true, but the effect was that a leg whose other side nobody
   wrote down never counted at all. The other side is now SYNTHESISED at a standard hold
   and stamped "assumed". What must never happen is the two kinds of evidence becoming
   indistinguishable, so the stamp is the thing under test, not the refusal. */
ok(/function bozoAssumedOpposite/.test(worker) && /BOZO_DEFAULT_OVERROUND = 1\.047619/.test(worker),
   "a missing other side is assumed from a standard -110/-110 two-way market");
ok(/closeOppSource: oppAssumed \? "assumed" : "manual"/.test(worker),
   "an assumed other side is stamped apart from one read off the slip");
ok(/closeOverround: oppAssumed \? BOZO_DEFAULT_OVERROUND : null/.test(worker),
   "the assumption it was derived from is recorded, so it can be recomputed later");
ok(/too long to assume an other side for/.test(worker),
   "a price so long that no sane opposite is left is refused rather than invented");
ok(/can't be overwritten/.test(worker),
   "a close the cron observed at kickoff cannot be overwritten by hand");

/* ⚠️ Provenance must survive forever. A number read off a bet slip and a number snapped
   from a licensed feed are different kinds of evidence; the day they become
   indistinguishable in this column, every CLV figure built on them becomes unauditable. */
ok(/closeSource: "manual"/.test(worker), "a hand-entered close is stamped manual");
ok(/closeSource: "sgo"/.test(worker) || /both\("closeSource", "sgo"\)/.test(worker),
   "a captured close is stamped with the source it came through");
ok(/closeSource: null \}\s*:\s*\{ close, closeOpp/.test(worker) || /closeEnteredBy: auth\.name/.test(worker),
   "who typed it and when are recorded alongside the number");

/* The gap list has to use the SAME definition of "usable" the chart uses, or it will
   report a leg as done while the chart quietly ignores it. */
ok(/r\.close == null \|\| r\.closeOpp == null/.test(worker),
   "the gap list counts a one-sided close as missing, matching what the chart does");

/* ⚠️ "Unavailable" is not "captured". Conflating them locked out the one case that most
   needs a human — the cron could not match the market, so only a person can supply it. */
ok(/const capturedAlready = row\.closeObservedAt != null && row\.close != null && row\.closeOpp != null;/.test(worker),
   "only an OBSERVED close blocks a manual fill — an unavailable one stays fillable");

/* ⚠️ NOR IS HALF A CAPTURE A CAPTURE, and this is the sharpest edge on the whole route.
   closeObservedAt is stamped the moment the cron sees A price. If it saw one side and
   not the other, the row is unusable (one side cannot be de-vigged), is listed as a gap,
   and used to be refused by every route that could have fixed it — a permanent hole in
   the chart with no door back in. Both write paths must test the PAIR, not the stamp. */
ok(/row\.closeObservedAt != null && row\.close != null && row\.closeOpp != null/.test(worker),
   "the grade card treats only a COMPLETE captured pair as immutable");
ok(/const capturedComplete = row\.closeObservedAt != null && row\.close != null && row\.closeOpp != null;/.test(worker),
   "the manual fill route treats only a COMPLETE captured pair as immutable");
ok(/locked: r\.closeObservedAt != null && r\.close != null && r\.closeOpp != null/.test(worker),
   "the gap list marks locked with the same test the fill route refuses on");

/* Typing over half a capture makes the PAIR manual. Leaving the observation stamp on
   would re-lock the row AND let a hand-read number inherit a feed observation's
   authority — the exact provenance blur closeSource exists to prevent. */
ok(/closeObservedAt: null, closeUnavailableReason: null/.test(worker),
   "a hand-filled pair clears the observation stamp rather than inheriting it");
ok(/closeObservedAt: null, closeOppSource: null, closeOverround: null/.test(worker),
   "clearing a mistyped entry clears the observation stamp and the assumption with it");
ok(/upd\[`\$\{k\}\/closeUnavailableReason`\] = null;/.test(worker),
   "filling the gap clears the note describing the gap");

/* ---- the page ---- */
ok(/data-co=/.test(pageCode), "the grade card takes an opposite side, not just a close");
ok(/close===''\s*&&\s*opp!==''/.test(pageCode),
   "the panel refuses an other-side-only entry — the assumption runs from the close outwards");
ok(/assumedOpp/.test(pageCode),
   "the panel shows what a blank other side will become before the manager saves it");
ok(/id="gapBody"/.test(pageCode) && /close-gaps/.test(pageCode),
   "the panel that reaches past weeks exists and reads the ledger");
ok(/if\(i\.disabled\) return;/.test(pageCode),
   "a locked (captured) box is not sent back — it would only be rejected");
/* Still amber, never green: a lone close is not yet a usable close. What changed is what
   the amber SAYS — the other side is no longer demanded, it is assumed on save. */
ok(/cst warn/.test(pageCode) && /other side will be assumed on save/.test(pageCode),
   "a half-filled close is flagged amber, not green — and says the other side will be assumed");

/* ---- the CLV override reaches the LEDGER, for any week ----
 * ⚠️ THE BUG THIS PINS. clvPts shipped in #106 with exactly one surface that could set
 * it: the grade card, which writes results/<key>. /results is cleared when the week
 * advances, so a leg from week 1 became uneditable from anywhere on the site the moment
 * week 2 opened. That hit props hardest — a prop has no two-way market, so no close can
 * ever be captured or typed for it, and clvPts is the ONLY number it will ever have.
 * Squatch's leg was in precisely that state: visible on the chart as missing, with no
 * control anywhere that could fix it. */
ok(/hasClv/.test(worker) && /patch\.clvPts = clvPts/.test(worker),
   "the ledger fill route accepts a CLV override, so a past week is still reachable");
ok(/clvSource: null : "manual"/.test(worker) || /clvPts == null \? null : "manual"/.test(worker),
   "a hand-set CLV is stamped apart from a derived one");
ok(/const clvOnly = hasClv && clear/.test(worker),
   "a CLV-only save is legitimate — a leg with no capturable market has no close to type");
ok(/capturedComplete && !\(Object\.prototype\.hasOwnProperty\.call\(body, "clvPts"\)/.test(worker),
   "the capture lock guards the CLOSE, and does not block a CLV-only save");
ok(/mirror\.clvPts = clvPts/.test(worker),
   "the CLV mirrors onto the live week, so both screens agree about the same leg");
ok(/Nothing to save — fill in a closing price or a CLV/.test(worker),
   "an empty save is refused out loud rather than writing an empty patch");

/* The list has to REACH every leg or the box cannot exist for the leg that needs it. */
ok(/const every = Object\.entries\(ledger\)/.test(worker) && /all: every/.test(worker),
   "the ledger list returns every row, not only the ones missing a close");
ok(/gap: r\.close == null \|\| r\.closeOpp == null/.test(worker),
   "each row says whether it is a gap, so the old gaps-only list still works");
ok(/clvPts: r\.clvPts \?\? null/.test(worker),
   "each row carries its CLV, so the box renders what is already stored");

/* ---- the page ---- */
ok(/class="gclv clvin"/.test(pageCode),
   "every leg row on the CLV section has a CLV box");
ok(/payload\.clvPts = clvPts/.test(pageCode),
   "the page sends the CLV to the ledger route");
ok(/const had = vIn\.defaultValue\.trim\(\) !== ''/.test(pageCode),
   "an emptied CLV box CLEARS the override rather than being ignored — same rule as the grade card");
ok(/not the placed ticket/i.test(pageCode),
   "the copy no longer tells anyone to read a close off the placed ticket");
ok(!/Read them off the placed ticket/.test(pageCode),
   "the old placed-ticket instruction is gone");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
