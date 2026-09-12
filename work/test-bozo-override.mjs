/* Manager Override settles a week: result, actual, closing price, and the CLV that falls
 * out of it — for EVERY leg, in ONE place.
 *
 * Run: node test-bozo-override.mjs
 *
 * ⚠️ WHY THIS REPLACES THREE SUITES. Result, closing price and CLV used to be spread over
 * three screens — the grade card on This Week, a CLV section in League settings, and the
 * result buttons here. Each answered "does this leg have a CLV" its own way, so a close
 * typed on one read as "no CLV" on another, and the leg that most needed fixing was the
 * one missing from whichever list you happened to open. One panel, one rule, one test.
 *
 * The CLV is never typed. It is derived by clvDeltaOf from the prices — the same function
 * the simulation and the grader read — so a fourth opinion about one fact is impossible.
 */
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import vm from "node:vm";

const WORK = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(resolve(WORK, "..", "bozo.html"), "utf8");
const grab = (a, b) => {
  const i = page.indexOf(a);
  if (i < 0) throw new Error("fixture: marker moved — " + a);
  const j = page.indexOf(b, i);
  if (j < 0) throw new Error("fixture: end marker moved — " + b);
  return page.slice(i, j);
};

const SQUATCH = "u_E6WLsRi0flMHptt7KIK00zpd";
const nodes = {};
const el = id => (nodes[id] = nodes[id] || {
  id, innerHTML: "", textContent: "", className: "", style: {},
  querySelectorAll: () => [], querySelector: () => null, onclick: null,
});

/* The real board. Squatch is a uid-keyed, self-priced prop with NO opposite side on the
   entry — the leg every earlier attempt lost — and BUTTS has a captured two-sided close. */
const S = {
  week: 1, season: 2026,
  picks: {
    [SQUATCH]: { who: "Squatch", label: "Christian McCaffrey anytime TD o0.5",
                 price: -145, entryPriceOpp: null, mkt: "other", priceSource: "self", ts: 9 },
    BUTTS: { who: "BUTTS", label: "LAR ML", price: -198, entryPriceOpp: 164,
             mkt: "ml", priceSource: "captured", ts: 2 },
  },
  results: {
    [SQUATCH]: { result: "lost", won: false, actual: 0 },
    BUTTS: { result: "lost", won: false, close: -218, closeOpp: 180 },
  },
  members: { [SQUATCH]: { name: "Squatch" }, BUTTS: true },
};

const ctx = vm.createContext({
  console, Object, Array, Number, JSON, Math, String, Boolean,
  document: { getElementById: el, querySelectorAll: () => [] },
  S,
  esc: s => String(s == null ? "" : s),
  kDec: k => k,
  kEnc: p => (p === "Squatch" ? SQUATCH : p),
  memberLabel: k => (k === SQUATCH ? "Squatch" : k),
  fmtPrice: n => (n > 0 ? "+" : "") + n,
  priceNum: v => Number(v),
  isManualLeg: x => !!x && (x.mkt === "prop" || x.mkt === "other"),
  imp: a => (a < 0 ? Math.abs(a) / (Math.abs(a) + 100) : 100 / (a + 100)),
  clvImp: o => (o < 0 ? -o / (-o + 100) : 100 / (o + 100)),
  clvAm: pr => (pr >= 0.5 ? Math.round((-100 * pr) / (1 - pr)) : Math.round((100 * (1 - pr)) / pr)),
  CLV_OVERROUND: 1.047619,
  godErr: () => {}, godWrite: async () => ({}), refresh: async () => {},
  paintGod: () => {}, decide: () => {},
});
vm.runInContext(
  grab("function clvAssumedOpp(price){", "\n/** proportional de-vig")
  + grab("const devigP = (a,b) => {", "/* The CLV a leg carries right now")
  + grab("function legRow(x){", "/* ⚠️ A HAND-SET CLV OUTRANKS")
  + grab("function clvDeltaOf(x, r){", "const amer =")
  + grab("function paintGodResults(){", "async function paintGodAudit(){")
  + "\nglobalThis.__paint = paintGodResults; globalThis.__delta = clvDeltaOf;"
  + "\nglobalThis.__devig = devigP;", ctx);

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error("FAIL:", name); } };

/* ⚠️ A MISSING OPPOSITE SIDE IS ASSUMED AT STANDARD JUICE, not refused. This is the whole
   reason a closing price alone can now produce a CLV: Squatch's entry is -145 with no
   other side, and while devigP refused that, no number typed into any close box anywhere
   could make the board produce a CLV for him. */
ok(ctx.__devig(-145, null) != null,
   "a price with no opposite side de-vigs against an assumed standard-juice book");
ok(ctx.__devig(-145, 200) !== ctx.__devig(-145, null),
   "and a real opposite side still gives a different, better answer");
ok(ctx.__devig(null, 200) === null, "a missing price itself is still refused");

/* The payoff: one close, and the leg has a CLV. */
ok(ctx.__delta({ price: -145, entryPriceOpp: null }, { close: -175, closeOpp: null }) != null,
   "one closing price on a self-priced prop yields a CLV — nothing else to type");

ctx.__paint();
const html = nodes["godResults"].innerHTML;

/* ⚠️ EVERY LEG, AND THE ONE THAT KEPT GOING MISSING FIRST. */
ok(html.includes("Christian McCaffrey anytime TD o0.5"), "the uid-keyed prop is on the panel");
ok(html.includes(">Squatch<") || html.includes("Squatch"), "under its member's name");
ok(html.includes("LAR ML"), "and so is every other leg");
ok((html.match(/data-god=/g) || []).length === 2, "one row per leg, none dropped");

/* Result, actual, close, other side — all of it, here. */
const sq = html.split("<div class=\"gr leg\"").find(r => r.includes("McCaffrey"));
ok(/class="btn ghost sm godr"/.test(sq) && /data-v="lost"/.test(sq),
   "the leg has its result buttons");
ok(/class="gdc"/.test(sq) && /class="gdo"/.test(sq), "a closing price box and an other-side box");
ok(/class="gda"/.test(sq), "and an actual box, because the schedule cannot grade a prop");
ok(/class="btn ghost sm gdsave"/.test(sq), "and its own Save");

/* ⚠️ THE CLV IS DERIVED AND SHOWN, NEVER TYPED. A typed CLV is a fourth opinion about a
   fact the prices already settle. */
ok(!/clv pts|class="clvin"/.test(html), "there is no CLV input anywhere on the panel");
ok(/CLV/.test(sq), "the CLV is reported on the row");
ok(/enter a closing price/.test(sq),
   "a leg with no close says what to type rather than showing a zero");

const butts = html.split("<div class=\"gr leg\"").find(r => r.includes("LAR ML"));
ok(/CLV [+-]/.test(butts), "a leg with a captured close shows its derived CLV");
ok(/from the close/.test(butts), "and says the number came from the close");

/* Name the bozo moved here, with the controls that settle the legs. */
ok(/id="finish"/.test(html), "Name the bozo lives in the override panel");
ok(/Needs every leg settled/.test(html), "and still states what it needs");

/* ---- the surfaces that were folded in are gone, not hidden ---- */
ok(!/id="manual"/.test(page), "the This Week per-leg editor is removed");
ok(!/id="clvSumBody"/.test(page), "the settings CLV summary is removed");
ok(!/id="gapBody"/.test(page), "the settings missing-closing-prices list is removed");
ok(!/function paintManual\(/.test(page) && !/function paintGaps\(/.test(page),
   "and their code is deleted rather than left orphaned");

/* ⚠️ decide() may no longer find those boxes in the DOM. It must still work, because the
   override writes every value to S.results on Save instead of leaving it in a box. */
ok(/document\.querySelectorAll\('\[data-w\]'\)/.test(page),
   "decide still reads any DOM boxes it finds");
ok(/const results = JSON\.parse\(JSON\.stringify\(S\.results\|\|\{\}\)\)/.test(page),
   "but starts from S.results, which the override panel has already written");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
