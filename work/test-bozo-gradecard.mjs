/* The grade card renders EVERY leg, in ONE section, each with its own controls.
 *
 * Run: node test-bozo-gradecard.mjs
 *
 * ⚠️ WHY THIS EXISTS. The card used to be two lists — manual results for props, other
 * markets and period legs, then closing prices — and the split was invisible in the
 * source but obvious on screen: a leg could appear in one and not the other, and the only
 * way to notice was to go looking for a player and not find them. That is the bug this
 * guards. It renders the real paintManual() against a board that deliberately mixes a
 * prop, a period leg and ordinary game markets, and checks that all of them come back
 * with a result dropdown, a close, a CLV box and a Save.
 *
 * It is a DOM-level test on purpose. Grepping the source proves the template contains a
 * CLV box; only rendering proves every leg reaches it.
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

const nodes = {};
const el = id => (nodes[id] = nodes[id] || {
  id, innerHTML: "", textContent: "", style: {},
  querySelectorAll: () => [], querySelector: () => null,
  insertAdjacentHTML: () => {}, closest: () => null,
});

const ctx = vm.createContext({
  console, Object, Array, Number, JSON, Math, String,
  document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null },
  CSS: { escape: s => s },
  esc: s => String(s == null ? "" : s),
  kEnc: p => p,
  isManualLeg: x => !!x && (x.mkt === "prop" || x.mkt === "other" || (x.period && x.period !== "game")),
  PERIOD_LABEL: { game: "Full game", "1h": "1st half" },
  devigP: (a, b) => {
    if (a == null || b == null) return null;
    const ia = a < 0 ? -a / (-a + 100) : 100 / (a + 100);
    const ib = b < 0 ? -b / (-b + 100) : 100 / (b + 100);
    return ia / (ia + ib);
  },
  clvAssumedOpp: c => (c == null ? null : 120),
  fmtPrice: n => (n > 0 ? "+" : "") + n,
  decide: () => {},
  saveLeg: () => {},
  S: { results: { Kap: { close: -235, closeOpp: 190, result: "lost", won: false } } },
});
vm.runInContext(grab("function paintManual(live, roster){", "\n/* Write ONE leg, now.")
  + "\nglobalThis.__paint = paintManual;", ctx);

/* Deliberately mixed: a prop and a period leg (the two the old card handled in a
   different list from everyone else) alongside ordinary game markets. */
const live = [
  { p: "Squatch", label: "Christian McCaffrey anytime TD o0.5", mkt: "prop", price: -155, sport: "nfl", ts: 1, eventId: "e1" },
  { p: "WBeamen", label: "UAB ML · 1st half", mkt: "ml", period: "1h", price: -130, sport: "cfb", ts: 2, eventId: "e2" },
  { p: "Kap", label: "CHI @ CAR u53.5", mkt: "total", side: "under", price: -240, entryPriceOpp: 174, sport: "nfl", ts: 3, eventId: "e3" },
  { p: "Roger", label: "BUF ML", mkt: "ml", price: -300, sport: "nfl", ts: 4, eventId: "e4" },
  { p: "JWhite", label: "KC -3.5", mkt: "spread", line: -3.5, price: -110, sport: "nfl", ts: 5, eventId: "e5" },
  { p: "Tony", label: "SF ML", mkt: "ml", price: -210, sport: "nfl", ts: 6, eventId: "e6" },
  { p: "ItzBornLegend", label: "DAL -1.5", mkt: "spread", line: -1.5, price: -120, sport: "nfl", ts: 7, eventId: "e7" },
  { p: "BUTTS", label: "GB o47.5", mkt: "total", side: "over", line: 47.5, price: -115, sport: "nfl", ts: 8, eventId: "e8" },
];

const roster = live.map(l => l.p);
ctx.__paint(live, roster);
const html = nodes["manual"].innerHTML;

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error("FAIL:", name); } };

/* ⚠️ ONE list. Two was how a leg went missing from one of them. */
ok((html.match(/class="lil"/g) || []).length === 1,
   "the card renders exactly one section, not a manual list and a prices list");

for (const l of live) {
  ok(html.includes(`data-leg="${l.p}"`), `${l.p} has a row`);
  ok(html.includes(`data-clv="${l.p}"`), `${l.p} has a CLV box`);
  ok(html.includes(`data-c="${l.p}"`), `${l.p} has a closing price box`);
  ok(html.includes(`data-w="${l.p}"`), `${l.p} has a result dropdown`);
  ok(html.includes(`data-save="${l.p}"`), `${l.p} has its own Save`);
}

ok((html.match(/data-leg=/g) || []).length === live.length,
   "every leg on the board is rendered, none dropped");

/* The prop and the period leg additionally get an actual box; a plain game market does
   not need one, because the schedule feed supplies it. */
ok(html.includes('data-a="Squatch"') && html.includes('data-a="WBeamen"'),
   "hand-graded legs get an actual box");
ok(!html.includes('data-a="Roger"'),
   "a game market does not — the schedule supplies its actual");

/* The heading has to name CLV. It holds the CLV boxes, and saying only "closing price"
   is a fair way to conclude CLV lives on some other screen. */
ok(/result, actual, closing price and CLV/.test(html),
   "the heading names CLV, so the boxes are findable");
ok(/leglegend/.test(html), "the controls are labelled");

/* ⚠️ NO SILENT EXCLUSIONS. `live` is the roster filtered to members whose pick resolved
   AND carries a price, so a member the board cannot match to a pick used to simply not be
   here: no row, no boxes, no reason. Every other name works and one name is absent, which
   is indistinguishable from "the feature is broken for him" — the single hardest bug shape
   to diagnose from a screenshot. A row stating the reason is worth more than no row. */
{
  nodes["manual"].innerHTML = "";
  const short = live.slice(0, 6);                       // two members drop out of `live`
  ctx.__paint(short, live.map(l => l.p));
  const h2 = nodes["manual"].innerHTML;
  ok(/data-ghost="ItzBornLegend"/.test(h2) && /data-ghost="BUTTS"/.test(h2),
     "a member missing from the live legs still gets a row");
  ok(/not gradeable/.test(h2), "...marked as not gradeable");
  ok(/no leg found on this ticket/.test(h2), "...with the reason stated");
  ok(!/data-save="BUTTS"/.test(h2), "...and no Save, because there is nothing to write");
  ok((h2.match(/data-leg=/g) || []).length === short.length,
     "the real legs are unaffected");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
