/* A CLV the manager sets by hand reaches EVERY surface that reads a CLV.
 *
 * Run: node test-bozo-clv-pipes.mjs
 *
 * ⚠️ WHY THIS EXISTS. clvPts was honoured by clvDeltaOf and clvPair, and by nothing else.
 * Four other surfaces computed their own answer to "does this leg have a CLV" out of the
 * captured close alone — the one input that is absent in exactly the case clvPts exists
 * for. So a CLV typed on the grade card was stored, confirmed on that screen, and then:
 * the ticket still branded the leg "no CLV", the lever flag still said it was measured on
 * one fewer leg than the lever was actually ranking, and the diagnostics column that
 * explains the lever said "awaiting close". Nothing errored. Every screen disagreed.
 *
 * Each surface must derive from ONE rule. These pin that.
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

/* Squatch's leg, exactly as the board carries it: self-priced prop, no opposite side on
   the entry, no close that can ever be captured, and a CLV of 0.00 set by hand. Keyed by
   uid, which is the shape that defeats a display-name lookup. */
const S = {
  picks: {
    [SQUATCH]: { label: "Christian McCaffrey anytime TD o0.5", price: -145,
                 entryPriceOpp: null, mkt: "other", priceSource: "self", ts: 9 },
    Kap: { label: "CHI @ CAR u53.5", price: -240, entryPriceOpp: 174,
           mkt: "total", side: "under", line: 53.5, priceSource: "captured", ts: 3 },
  },
  results: {
    [SQUATCH]: { result: "lost", won: false, clvPts: 0, clvSource: "manual" },
    Kap: { close: -260, closeOpp: 190 },
  },
  members: { [SQUATCH]: { name: "Squatch" }, Kap: true },
};

const ctx = vm.createContext({
  console, Object, Array, Number, JSON, Math, String, Boolean,
  S,
  esc: s => String(s == null ? "" : s),
  kDec: k => k,
  memberLabel: k => (k === SQUATCH ? "Squatch" : k),
  // The display-name lookup this board has always used. It resolves Squatch correctly
  // here; the point is that every surface must agree even when it does not.
  kEnc: p => (p === "Squatch" ? SQUATCH : p),
  imp: o => (o < 0 ? -o / (-o + 100) : 100 / (o + 100)),
});
vm.runInContext(
  "const devigP = (a,b) => (a==null||b==null) ? null : (imp(a)/(imp(a)+imp(b)));\n"
  + grab("function legRow(x){", "/* ⚠️ A HAND-SET CLV OUTRANKS")
  + grab("const priceSourceBadge = x => {", "\n// Server capture replaced")
  + grab("function clvDeltaOf(x, r){", "const amer =")
  + "\nglobalThis.__legRow = legRow; globalThis.__badge = priceSourceBadge;"
  + "\nglobalThis.__delta = clvDeltaOf;", ctx);

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error("FAIL:", name); } };

const sq = { p: "Squatch", ...S.picks[SQUATCH] };
const kap = { p: "Kap", ...S.picks.Kap };

/* ⚠️ ZERO IS A VALUE. A CLV of exactly 0.00 is the most likely number a manager types for
   a leg that never moved, and every one of these surfaces has to treat it as present
   rather than as absent. A truthiness check anywhere here reads 0 as "no CLV". */
ok(ctx.__delta(sq, ctx.__legRow(sq)) === 0,
   "a hand-set CLV of exactly 0.00 is a CLV, not a missing one");
ok(ctx.__delta(kap, ctx.__legRow(kap)) != null,
   "a captured close still produces a CLV the ordinary way");

/* The row lookup has to find a uid-keyed leg. */
ok(ctx.__legRow(sq).clvPts === 0, "the results row is found for a uid-keyed leg");
ok(ctx.__legRow({ label: "Christian McCaffrey anytime TD o0.5" }).clvPts === 0,
   "and is found from the leg itself when no name or key is available");

/* ⚠️ THE TICKET MUST NOT CONTRADICT THE GRADE CARD. */
const badge = ctx.__badge(sq);
ok(!/no CLV/.test(badge),
   "a leg with a hand-set CLV is no longer branded 'no CLV' on the ticket");
ok(/set by hand/.test(badge),
   "it says the CLV was set by hand, so the weaker evidence is still visible");
ok(/no CLV/.test(ctx.__badge({ p: "Nobody", label: "x", priceSource: "self" })),
   "a self-priced leg with no CLV at all still says so");
ok(/DK captured/.test(ctx.__badge(kap)), "a captured entry still reads DK captured");

/* ---- one definition, not five ---- */
const code = page.replace(/\/\*[\s\S]*?\*\//g, "");
ok(/const withClv = live\.filter\(x=>clvDeltaOf\(x, legRow\(x\)\) != null\)/.test(code),
   "the lever's coverage flag counts with clvDeltaOf, the rule the simulation uses");
ok(!/const withClv = live\.filter\(x=>\{[^]*?devigP\(r\.close/.test(code),
   "it no longer hand-rolls its own test out of the close alone");
ok(/clv: clvDeltaOf\(x, r\)/.test(code) && /const r = legRow\(x\);/.test(code),
   "the simulation reads the same row through the same lookup");
ok(/r\.clvPts != null && Number\.isFinite\(\+r\.clvPts\)/.test(code.split("const clvText")[1] || ""),
   "the diagnostics CLV column reports a hand-set CLV instead of 'awaiting close'");

/* ⚠️ NO SURFACE MAY REACH A RESULTS ROW BY DISPLAY NAME ALONE. The name is allowed as a
   FALLBACK behind the pick key — that is what paintManual's rowOf does, deliberately,
   since #109 — but a lookup whose only key is the display name returns an empty object
   for a uid-keyed leg and renders it as "nothing set" with no error anywhere. */
{
  const bare = code.match(/(?:res|\(S\.results\|\|\{\}\))\[kEnc\(x\.p\)\]\s*\|\|\s*\{\}/g) || [];
  ok(bare.length === 0,
     "no consumer resolves a results row by display name alone");
  ok(/if\(x && x\.key && \(res\[x\.key\] \|\| picks\[x\.key\]\)\) return res\[x\.key\] \|\| \{\};/.test(code),
     "the one lookup tries the pick key first and the display name only after it");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
