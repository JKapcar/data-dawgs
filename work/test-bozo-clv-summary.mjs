/* The CLV summary on the league card names EVERY member of the roster.
 *
 * Run: node test-bozo-clv-summary.mjs
 *
 * ⚠️ WHY THIS IS ITS OWN SUITE. The section it guards used to be the gap list alone, so
 * the number of names on screen was the number of people with an unfilled closing price.
 * In a league of eight that reads as a roster of three, and a member who is absent
 * because all of their closes were captured is indistinguishable from a member the page
 * lost — the same failure shape test-bozo-gradecard guards on the grade card, one screen
 * over. Grepping proves the table exists; only running the real row builder against a
 * roster whose members deliberately differ (some with gaps, some clean, one with no legs
 * at all) proves nobody falls out of it.
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

/* S.members is the uid -> member map the real page carries. Squatch is deliberately
   uid-keyed here, because that is the shape that broke. */
const SQUATCH_UID = "u_E6WLsRi0flMHptt7KIK00zpd";
const ctx = vm.createContext({
  console, Object, Array, Number, JSON, Math, String, Boolean,
  esc: s => String(s == null ? "" : s),
  teamOf: n => n,
  S: { members: { [SQUATCH_UID]: { name: "Squatch" }, Kap: true, JWhite: true, Roger: true,
                  Tony: true, BUTTS: true, WBeamen: true, ItzBornLegend: true } },
  memberLabel: k => {
    const v = ({ [SQUATCH_UID]: { name: "Squatch" } })[k];
    return v && v.name ? v.name : k;
  },
  kEnc: p => (p === "Squatch" ? SQUATCH_UID : p),
});
// The chart's own CLV math, verbatim — this table must never derive a leg differently
// from the chart it summarises.
vm.runInContext(grab("const clvImp = o =>", "const CLV_SHAPES"), ctx);
vm.runInContext(grab("function ledgerWho(v){", "async function paintClvSummary(")
  + "\nglobalThis.__rows = clvSummaryRows; globalThis.__html = clvSummaryHtml;", ctx);

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error("FAIL:", name); } };

const ROSTER = ["Kap", "JWhite", "Squatch", "Roger", "Tony", "BUTTS", "WBeamen", "ItzBornLegend"];

/* Deliberately uneven: two legs with a complete captured pair, one leg whose other side
   has to be assumed, one carrying a manager's CLV override, two graded legs with no
   close at all, one ungraded leg, and three members with nothing in the ledger. */
const legs = [
  { player: "Kap", week: 1, result: "win",  entryPrice: -240, entryPriceOpp: 174, closePrice: -260, closePriceOpp: 190 },
  { player: "Kap", week: 2, result: "loss", entryPrice: -110, entryPriceOpp: -110, closePrice: -105, closePriceOpp: -115 },
  { player: "JWhite", week: 1, result: "loss", entryPrice: -230, entryPriceOpp: 190, closePrice: -250, closePriceOpp: null },
  { player: "Squatch", week: 1, result: "win", entryPrice: -155, entryPriceOpp: 130, closePrice: null, closePriceOpp: null, clvPts: 3.5 },
  { player: "Roger", week: 1, result: "loss", entryPrice: -300, entryPriceOpp: 240, closePrice: null, closePriceOpp: null },
  { player: "Tony", week: 1, result: "win", entryPrice: -210, entryPriceOpp: 175, closePrice: null, closePriceOpp: null },
  { player: "BUTTS", week: 1, result: null, entryPrice: -115, entryPriceOpp: -105, closePrice: null, closePriceOpp: null },
];

const rows = ctx.__rows(legs, ROSTER);

/* ⚠️ THE INVARIANT. Eight on the roster, eight on the table, whatever the ledger says. */
ok(rows.length === 8, "every roster member gets a row, not just the ones with gaps");
for (const n of ROSTER) ok(rows.some(r => r.player === n), `${n} is on the summary`);

const by = n => rows.find(r => r.player === n);

/* Members with no legs at all are the ones a ledger-driven list drops silently. */
for (const n of ["WBeamen", "ItzBornLegend"])
  ok(by(n).legs === 0 && by(n).avg === null, `${n} has no legs and says so rather than vanishing`);

ok(by("Kap").charted === 2 && by("Kap").missing === 0 && by("Kap").assumed === 0,
   "two complete captured pairs are both on the chart, neither assumed");
ok(by("JWhite").charted === 1 && by("JWhite").assumed === 1,
   "a one-sided close counts, and is marked as resting on an assumed other side");
ok(by("Squatch").charted === 1 && by("Squatch").manual === 1,
   "a manager's CLV override counts, and is marked as the manager's number");

/* ⚠️ A graded leg with no usable close is OFF the chart and out of n. The whole point of
   the section below this table is to close that hole, so the count has to be per person
   and it has to be honest. */
ok(by("Roger").graded === 1 && by("Roger").charted === 0 && by("Roger").missing === 1,
   "a graded leg with no close is counted as missing, not quietly averaged in");
ok(by("Roger").avg === null && by("Tony").avg === null,
   "no CLV is invented for a player with nothing chartable");

/* An ungraded leg is not a gap — it has not had its chance yet. */
ok(by("BUTTS").legs === 1 && by("BUTTS").graded === 0 && by("BUTTS").missing === 0,
   "an ungraded leg is not counted as a missing close");

/* ⚠️ A name in the ledger that the roster no longer carries is NOT a member, so it is
   not on the table — listing them as one overstates the league. It is also not deleted:
   their legs are still in the season's averages, and silently dropping them would hide
   where those numbers came from. Off the table, counted by name underneath. */
{
  const withLeaver = ctx.__rows(legs.concat(
    [{ player: "Gone", week: 1, result: "win", entryPrice: -120, entryPriceOpp: 100, closePrice: -140, closePriceOpp: 115 }]), ROSTER);
  ok(withLeaver.length === 9 && withLeaver.some(r => r.player === "Gone"),
     "a former member still in the ledger is computed, not dropped");
  ok(withLeaver.find(r => r.player === "Gone").onRoster === false
     && withLeaver.filter(r => r.onRoster).length === 8,
     "they are flagged off-roster, and the eight seats stay eight");
  const h = ctx.__html(withLeaver);
  ok((h.match(/data-sum=/g) || []).length === 8 && !h.includes('data-sum="Gone"'),
     "the table is the roster — a former member is not a row on it");
  ok(/no longer on the roster/.test(h) && /Gone/.test(h),
     "they are accounted for by name under the table, not silently deleted");
  ok(ctx.__html([]).includes("Nobody is on this roster yet"),
     "an empty roster still says so");
}

/* Ordering: a number beats no number, then best CLV first. Nobody is sorted off. */
ok(rows.slice(0, 3).every(r => r.avg !== null) && rows.slice(3).every(r => r.avg === null),
   "players with a CLV sort above players without one");
ok(rows[0].avg >= rows[1].avg, "the best CLV leads");

const html = ctx.__html(rows);
for (const n of ROSTER) ok(html.includes(`data-sum="${n}"`), `${n} is rendered into the table`);
ok((html.match(/data-sum=/g) || []).length === 8, "eight rows rendered, none dropped");
ok(/nothing graded yet/.test(html), "a member with nothing graded says why the cell is empty");
ok(/no leg has a usable close/.test(html), "a member whose legs all lack a close says so");
ok(/assumed other side/.test(html) && /manager's CLV/.test(html),
   "weaker evidence is labelled on the row, never averaged in silently");
ok(ctx.__html([]).includes("Nobody is on this roster yet"),
   "an empty roster says so rather than rendering an empty table");

/* ---- the section it lives in ---- */
ok(/>CLV summary</.test(page), "the section is named CLV summary");
ok(/id="clvSumBody"/.test(page), "the table has a mount point");
ok(/paintClvSummary\(\);\n?\s*\/\/ Manager-only/.test(page.replace(/\r/g, "")) || /paintClvSummary\(\);/.test(page),
   "the league card paints it");
/* It reads the same public feed as the chart, so a non-manager sees the standings even
   though only a manager gets the boxes that write. */
ok(/'\/bozo\/clv\?league='/.test(page), "it reads the ledger through the public CLV feed");

/* ⚠️ A UID-KEYED LEDGER ROW BELONGS TO ITS MEMBER, NOT TO A HEX STRING.
 * The Worker writes a ledger row's player as `x.who || playerName(pickKey)`, so a leg
 * filed without `who` in a uid-keyed league lands with the raw uid. Untranslated, the
 * roster-built member table matched nobody: the real member showed zero legs and
 * "nothing graded yet", while their actual legs collected under the uid — which is not
 * on the roster, so they were swept into the off-roster footnote and off the table.
 * That is exactly how Squatch's prop became uneditable while appearing to be present.
 */
{
  const uidLegs = [
    { player: SQUATCH_UID, week: 1, result: "win", entryPrice: -155, entryPriceOpp: 130,
      closePrice: null, closePriceOpp: null, clvPts: 3.5 },
  ];
  const r = ctx.__rows(uidLegs, ROSTER.map(n => (n === "Squatch" ? "Squatch" : n)));
  const sq = r.find(x => x.player === "Squatch");
  ok(!!sq, "a uid-keyed ledger row resolves to its member's display name");
  ok(sq && sq.legs === 1 && sq.graded === 1,
     "the leg lands on the member's own row rather than a separate hex-string row");
  ok(!r.some(x => x.player === SQUATCH_UID),
     "no row is rendered under the raw uid");
  ok(r.length === 8 && r.every(x => x.onRoster),
     "the roster stays eight, and nobody is pushed into the off-roster footnote by a uid");
  const h = ctx.__html(r);
  ok(h.includes('data-sum="Squatch"') && !h.includes(SQUATCH_UID),
     "the table names the member, never the uid");
  ok(!/no longer on the roster/.test(h),
     "a uid-keyed member is not mistaken for a leaver");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
