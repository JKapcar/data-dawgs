/* Every leg on the board can have its CLV set, whatever the ledger knows about it.
 *
 * Run: node test-bozo-clv-edit.mjs
 *
 * ⚠️ WHY THIS EXISTS. The CLV section was built from the ledger alone, so a leg whose
 * ledger row was never written — or was written under a key the page could not line up —
 * was not in the response, and a list built only from the response cannot render a leg it
 * never received. The member who most needed the screen was the one missing from it: his
 * leg was on the board, in the override panel, and absent here, with nothing on screen
 * admitting the gap. Renders the real paintGaps() against exactly that board.
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
  querySelectorAll: () => [], querySelector: () => null,
});

/* The ledger has six legs and knows nothing about Squatch or BUTTS — the shape that was
   on screen when this was reported. */
const LEDGER = ["ItzBornLegend", "JWhite", "Kap", "Roger", "Tony", "WBeamen"].map((p, i) => ({
  row: `2026-w1-${p}`, week: 1, player: p, label: `${p} leg`,
  price: -200 - i, priceOpp: 170 + i, close: -210 - i, closeOpp: 175 + i,
  locked: true, gap: false,
}));

const PICKS = {
  [SQUATCH]: { label: "Christian McCaffrey anytime TD o0.5", price: -155, mkt: "prop", ts: 1 },
  BUTTS: { label: "LAR ML", price: -115, mkt: "ml", ts: 2 },
};
for (const p of ["ItzBornLegend", "JWhite", "Kap", "Roger", "Tony", "WBeamen"])
  PICKS[p] = { label: `${p} leg`, price: -200, ts: 3 };

const S = { week: 1, season: 2026, picks: PICKS, results: {},
  members: { [SQUATCH]: { name: "Squatch" }, BUTTS: true, ItzBornLegend: true, JWhite: true,
             Kap: true, Roger: true, Tony: true, WBeamen: true } };

const ctx = vm.createContext({
  console, Object, Array, Number, JSON, Math, String, Boolean, Set, Map, Promise,
  document: { getElementById: el },
  esc: s => String(s == null ? "" : s),
  kDec: k => k,
  kEnc: p => (p === "Squatch" ? SQUATCH : p),
  memberLabel: k => (k === SQUATCH ? "Squatch" : k),
  teamOf: n => n,
  fmtPrice: n => (n > 0 ? "+" : "") + n,
  priceNum: v => Number(v),
  clvAssumedOpp: () => 120,
  clvPair: () => null,
  S, LID: "l1", CLV: { data: null },
  CLVSUM: { data: null },
  stateMembers: () => Object.keys(S.members).map(k => (k === SQUATCH ? "Squatch" : k)),
  wGet: async () => ({ all: LEDGER, rows: [], total: LEDGER.length }),
  wPost: async () => ({ ok: true }),
  godWrite: async () => ({ ok: true }),
  refresh: async () => {},
  paintClvSummary: async () => {},
});
vm.runInContext(grab("function ledgerWho(v){", "function clvSummaryRows(")
  + grab("async function paintGaps(){", "/* ==================== Bozo Royale")
  + "\nglobalThis.__paint = paintGaps;", ctx);

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error("FAIL:", name); } };

await ctx.__paint();
const html = nodes["gapBody"].innerHTML;
const note = nodes["gapNote"].innerHTML;

/* ⚠️ THE INVARIANT. A leg on the board is on this screen, ledger row or not. */
ok(html.includes("Christian McCaffrey anytime TD o0.5"),
   "a leg with no ledger row is still listed — the ticket is the list, not the ledger");
ok(html.includes(">Squatch<"), "and it is listed under its member's name, not a uid");
/* The uid is legitimate as the write key — it is the identifier the Worker stores
   results under, and the grade card carries it the same way. What must never happen is
   the uid being shown to a reader WHERE A NAME GOES. */
{
  const cells = (html.match(/<td>[^<]*<\/td>/g) || []).join(" ");
  ok(!cells.includes(SQUATCH), "the raw uid is never rendered where a name goes");
  ok(html.includes(`data-key="${SQUATCH}"`), "but it is carried as the write key, which is what saves the leg");
}
ok(html.includes("LAR ML"), "the other ledger-less leg is listed too");

/* The whole point: the box has to be there for the leg that needs it. */
const sqRow = html.split("<tr").find(r => r.includes("McCaffrey"));
ok(!!sqRow && /class="gclv clvin"/.test(sqRow), "that leg has a CLV box");
ok(!!sqRow && /class="gc"/.test(sqRow) && /class="go"/.test(sqRow),
   "and both close boxes, so a close can be overridden by hand");
ok(!!sqRow && /class="btn ghost sm gsave"/.test(sqRow), "and its own Save");
ok(!!sqRow && /data-src="pick"/.test(sqRow),
   "it saves through the pick key, the identifier guaranteed to exist");

/* Eight legs on the board, eight rows. Nobody silently absent. */
ok((html.match(/data-src=/g) || []).length === 8, "all eight legs render, none dropped");

/* ⚠️ A LEG WITH NO CLOSE MUST NOT SAY "close captured". The flag is derived from the
   prices, never taken from the payload — an older Worker does not send it, and an absent
   flag read as false is a confident lie in the one column that has to be honest. */
ok(/no close captured yet/.test(sqRow || ""),
   "a leg with no close says so rather than claiming a capture");
ok(/2 of 8 legs/.test(note), "the count is derived from the prices, not from a payload flag");

/* A captured close stays editable here, because a capture says nothing about CLV. */
const kapRow = html.split("<tr").find(r => r.includes("Kap leg"));
ok(!!kapRow && /class="gclv clvin"/.test(kapRow),
   "a leg whose close WAS captured still has a CLV box");

/* Copy: the placed-ticket instruction is gone for good. */
ok(/not the placed ticket/.test(note) && !/Read them off the placed ticket/.test(note),
   "the copy names a kickoff screenshot and rules out the placed ticket");

/* ⚠️ Nobody vanishes even with nothing to edit. */
{
  nodes["gapBody"].innerHTML = ""; nodes["gapNote"].innerHTML = "";
  const only = { ...S, picks: {} };
  ctx.S.picks = {};
  await ctx.__paint();
  const h2 = nodes["gapBody"].innerHTML;
  ok(h2.includes("Squatch") && /nothing to set/.test(h2),
     "a member with no leg anywhere gets a row stating that, not an absence");
  ctx.S.picks = PICKS;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
