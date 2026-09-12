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

/* The members map the page resolves uids through. Squatch's row is the case that
   started this: his pick is keyed by uid, and the card used to reach it only by walking
   the roster and translating a display name — so when that translation missed, his leg
   was on the ticket and nowhere on the card. */
const ctxMembers = { u_E6WLsRi0flMHptt7KIK00zpd: "Squatch" };

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
  memberLabel: k => (ctxMembers[k] || null),
  kDec: k => k,
  fmtPrice: n => (n > 0 ? "+" : "") + n,
  decide: () => {},
  saveLeg: () => {},
  S: { results: { Kap: { close: -235, closeOpp: 190, result: "lost", won: false } } },
});
vm.runInContext(grab("function paintManual(live, roster){", "\n/* Write ONE leg, now.")
  + "\nglobalThis.__paint = paintManual;", ctx);

/* Deliberately mixed: a prop and a period leg (the two the old card handled in a
   different list from everyone else) alongside ordinary game markets. */
/* ⚠️ SQUATCH'S KEY IS A UID AND HIS ROW CARRIES NO `who`. That is the exact shape that
   broke: nothing on the card could name him except the members map, and the old code
   reached his pick only by translating a roster name into that uid. Everyone else here is
   name-keyed, so a bug that hides only him passes every other assertion. */
const picks = {
  u_E6WLsRi0flMHptt7KIK00zpd: { label: "Christian McCaffrey anytime TD o0.5", mkt: "prop", price: -155, sport: "nfl", ts: 1, eventId: "e1" },
  WBeamen: { who: "WBeamen", label: "UAB ML · 1st half", mkt: "ml", period: "1h", price: -130, sport: "cfb", ts: 2, eventId: "e2" },
  Kap: { who: "Kap", label: "CHI @ CAR u53.5", mkt: "total", side: "under", price: -240, entryPriceOpp: 174, sport: "nfl", ts: 3, eventId: "e3" },
  Roger: { who: "Roger", label: "BUF ML", mkt: "ml", price: -300, sport: "nfl", ts: 4, eventId: "e4" },
  JWhite: { who: "JWhite", label: "KC -3.5", mkt: "spread", line: -3.5, price: -110, sport: "nfl", ts: 5, eventId: "e5" },
  Tony: { who: "Tony", label: "SF ML", mkt: "ml", price: -210, sport: "nfl", ts: 6, eventId: "e6" },
  ItzBornLegend: { who: "ItzBornLegend", label: "DAL -1.5", mkt: "spread", line: -1.5, price: -120, sport: "nfl", ts: 7, eventId: "e7" },
  BUTTS: { who: "BUTTS", label: "GB o47.5", mkt: "total", side: "over", line: 47.5, price: -115, sport: "nfl", ts: 8, eventId: "e8" },
};
ctx.S.picks = picks;
const keys = Object.keys(picks);
const roster = ["Squatch", "WBeamen", "Kap", "Roger", "JWhite", "Tony", "ItzBornLegend", "BUTTS"];

/* `live` deliberately MISSES Squatch — the roster-walk that produced it is what dropped
   him. Building the card from the ticket has to put him back. */
const live = keys.filter(k => k !== "u_E6WLsRi0flMHptt7KIK00zpd")
  .map(k => ({ ...picks[k], p: picks[k].who }));

ctx.__paint(live, roster);
const html = nodes["manual"].innerHTML;

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error("FAIL:", name); } };

/* ⚠️ ONE list. Two was how a leg went missing from one of them. */
ok((html.match(/class="lil"/g) || []).length === 1,
   "the card renders exactly one section, not a manual list and a prices list");

/* Every control is keyed by the PICK KEY — the one identifier guaranteed to exist and to
   match what the Worker writes results under. Keying by display name is the translation
   that lost a member. */
for (const k of keys) {
  ok(html.includes(`data-leg="${k}"`), `${k} has a row`);
  ok(html.includes(`data-clv="${k}"`), `${k} has a CLV box`);
  ok(html.includes(`data-c="${k}"`), `${k} has a closing price box`);
  ok(html.includes(`data-w="${k}"`), `${k} has a result dropdown`);
  ok(html.includes(`data-save="${k}"`), `${k} has its own Save`);
}

ok((html.match(/data-leg=/g) || []).length === keys.length,
   "every leg on the TICKET is rendered, none dropped");

/* ⚠️ THE REGRESSION. Squatch reached the card only through a name-to-uid translation, and
   when it missed he vanished while all seven other names worked. */
ok(html.includes('data-leg="u_E6WLsRi0flMHptt7KIK00zpd"'),
   "a uid-keyed leg missing from `live` is still rendered, from the ticket");
ok(html.includes(">Squatch<"),
   "...and is labelled from the members map, not left as a raw uid");
ok(html.includes('title="writes results/u_E6WLsRi0flMHptt7KIK00zpd"'),
   "...and its Save names the uid path the Worker actually keys results under");
ok(!/data-ghost="Squatch"/.test(html),
   "...and he is not reported as missing, because he is not");

/* The prop and the period leg additionally get an actual box; a plain game market does
   not need one, because the schedule feed supplies it. */
ok(html.includes('data-a="u_E6WLsRi0flMHptt7KIK00zpd"') && html.includes('data-a="WBeamen"'),
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
  ctx.S.picks = { Kap: picks.Kap, Nobody: { who: "Nobody", label: "no price", mkt: "ml", ts: 9 } };
  ctx.__paint([], ["Kap", "Nobody", "Absent"]);
  const h2 = nodes["manual"].innerHTML;
  ok(/data-ghost="Absent"/.test(h2), "a roster member with no leg still gets a row");
  ok(/no leg on this ticket/.test(h2), "...saying nothing was filed");
  ok(/data-ghost="Nobody"/.test(h2), "a filed leg with no price also gets a row");
  ok(/carries no price/.test(h2), "...saying that is why it cannot be graded");
  ok(!/data-save="Absent"/.test(h2), "...and neither gets a Save, there is nothing to write");
  ok((h2.match(/data-leg="Kap"/g) || []).length === 1, "the real leg is unaffected");
  ctx.S.picks = picks;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
