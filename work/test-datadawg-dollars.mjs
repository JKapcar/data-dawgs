/* DataDawg$ — handoff §3 build-blocking tests. Any failure blocks the deploy.
 *
 * Published as DataDawg$ (the site's own converted dollars) rather than "PPN": that is a
 * league abbreviation and this conversion is method-general. The SEALED payload keeps its
 * own model_id (datadawgs-ppn-auction-2026-v3) — that is the receipt for the computation
 * and is what work/ppn-auction-src/ is diffed against, so it is not cosmetic to rename.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";

/* Handoff §3 gates, run against the DEPLOYED envelope — not the staged artifact — so this
   also proves the envelope wrapper did not disturb a single value. */
const ENV = JSON.parse(fs.readFileSync(new URL("../data/datadawg-dollars-values.json", import.meta.url), "utf8"));
const SRC = fs.readFileSync(new URL("./ppn-auction-src/ppn-auction-values.json", import.meta.url), "utf8");
/* v4 is a DERIVED payload, so it cannot be byte-compared against a sealed artifact the way
   v3 was. The stronger check replaces it: the builder is re-run here and the published file
   must equal what it produces — which proves the shipped numbers really are 0.75 +
   0.94375 x the sealed v3 exacts over the 210-slot pool, and nothing else. */
const { buildV4, LEAGUE_BUDGET, AUCTION_SLOTS, RESERVE_PER_SLOT, PREMIUM_SCALE, SLOTS }
  = await import("./build-datadawg-practical.mjs");
const V = ENV.data;
const P = V.players;
let pass = 0; const fails = [];
const t = (name, cond, detail="") => { if(cond){ pass++; console.log("  ok   "+name); }
  else { fails.push(name+(detail?" — "+detail:"")); console.log("  FAIL "+name+(detail?" — "+detail:"")); } };

/* 425, not 424: Jayden Higgins is now an explicit $0 row rather than an absence. The old
   count was preserved by omitting him, which let the override pass vacuously. */
t("players.length == 425", P.length === 425, `got ${P.length}`);
const ks = P.filter(p => String(p.pos).toUpperCase() === "K");
t("zero kickers", ks.length === 0, `got ${ks.length}`);
const ids = P.map(p => p.id); const dupes = ids.filter((x,i)=>ids.indexOf(x)!==i);
t("zero duplicate ids", dupes.length === 0, dupes.join(","));
const neg = P.filter(p => p.target < 0);
t("zero negative targets", neg.length === 0, neg.map(p=>p.player).join(","));

const sum = P.reduce((a,p)=>a+p.target,0);
t("sum(target) == 2800 exactly", sum === 2800, `got ${sum}`);
const pos = P.filter(p => p.target > 0);
/* Every one of the 210 auctioned slots clears $1 after rounding. That is an OUTCOME of
   largest-remainder over a 0.75 remainder, not an imposed floor — nothing in the build
   sets a minimum, and $0 bids stay legal. */
t("210 players with target > 0", pos.length === 210, `got ${pos.length}`);
t("every positive row is in the 210-slot pool and vice versa",
  pos.length === AUCTION_SLOTS, `${pos.length} vs ${AUCTION_SLOTS}`);
{
  const byPos = {};
  for(const p of pos) byPos[p.pos] = (byPos[p.pos]||0)+1;
  for(const [k,n] of Object.entries(SLOTS))
    t(`pool holds ${n} ${k}`, byPos[k] === n, `got ${byPos[k]}`);
}
t("no $1 floor is imposed — the tail is still allowed to be $0",
  P.filter(p => p.target === 0).length > 0, "every row is priced, which means a floor crept in");

/* Landmarks are +/-$1 because largest-remainder decides the last dollar; they are a
   sanity check on the transform, never hand-set values. */
for(const [name, want] of [["Jahmyr Gibbs",86],["Bijan Robinson",81],["Puka Nacua",72],
    ["Christian McCaffrey",67],["Jonathan Taylor",63],["Justin Jefferson",61],
    ["Amon-Ra St Brown",59],["CeeDee Lamb",55],["James Cook",54],["Derrick Henry",53]]){
  const row = P.find(p => p.player === name);
  t(`${name} ~= ${want}`, row && Math.abs(row.target - want) <= 1,
    row ? `got ${row.target}` : "row missing");
}
for(const [name, want] of [["Jaxon Smith-Njigba",73],["Ja'Marr Chase",73]]){
  const row = P.find(p => p.player === name);
  t(`${name} ~= ${want}`, row && Math.abs(row.target - want) <= 1, row ? `got ${row.target}` : "row missing");
}

/* Hamilton: floor(exact) + largest-remainder over the shortfall must reproduce every target. */
const rows = P.map(p => ({...p, fl: Math.floor(p.exact)}));
const base = rows.reduce((a,r)=>a+r.fl,0);
let short = 2800 - base;
const order = [...rows].sort((a,b)=>{
  const ra = a.exact - a.fl, rb = b.exact - b.fl;
  if(rb !== ra) return rb - ra;
  return b.exact - a.exact;
});
const got = new Map(rows.map(r=>[r.id, r.fl]));
for(const r of order){ if(short<=0) break; got.set(r.id, got.get(r.id)+1); short--; }
const mismatch = rows.filter(r => got.get(r.id) !== r.target);
t("Hamilton floor+largest-remainder reproduces every target",
  mismatch.length === 0, mismatch.slice(0,5).map(r=>`${r.player}: want ${r.target} got ${got.get(r.id)}`).join("; "));

/* v3 gave D/ST nothing because they never clear replacement. v4 seats 14 of them, which is
   the whole point: a D/ST slot IS bought, so the sheet has to admit it costs something. */
const dst = P.filter(p => String(p.pos).toUpperCase() === "DST");
t("14 DST rows are priced", dst.filter(p=>p.target>0).length === 14,
  `${dst.filter(p=>p.target>0).length} priced of ${dst.length}`);
/* low/high are v3 sensitivity bounds carried forward unscaled, so they no longer bracket a
   v4 target and are NOT re-derived here — inventing scaled bounds would be a new claim. */

t("source_snapshot_sha256 matches",
  V.source_snapshot_sha256 === "1d772b1db0b5e79a06835b89d0589c5cc469930910798fef86d0975c3b511b8c",
  V.source_snapshot_sha256);

/* GATE, tightened: absence used to pass, which meant the override could never actually be
   checked. He must now be PRESENT, exactly once, at $0, carrying his reason.
   Key on the NFL id and the exact name — "Higgins" alone also matches Tee and Elijah
   Higgins, who are different players with legitimate prices. */
const hig = P.filter(p => p.id === "00-0038130" || /^jayden\s+higgins$/i.test((p.player||"").trim()));
t("Jayden Higgins (00-0038130) exists exactly once", hig.length === 1, `found ${hig.length}`);
t("Jayden Higgins is $0", hig.length === 1 && hig[0].target === 0, hig.length ? `$${hig[0].target}` : "absent");
t("Jayden Higgins carries the injury override",
  hig.length === 1 && hig[0].override && hig[0].override.status === "injury override"
  && /acl/i.test(hig[0].override.reason || ""), JSON.stringify(hig[0] && hig[0].override));

/* The published payload must be exactly what the documented transform produces from the
   sealed v3 prior. This is the guarantee that no value was hand-set, smoothed or capped. */
{
  const built = new Map(buildV4().rows.map(r => [r.id, r]));
  const bad = P.filter(p => { const b = built.get(p.id);
    return !b || b.target !== p.target || Number(b.exact.toFixed(4)) !== p.exact; });
  t("every published value is the documented transform of the sealed v3 prior",
    bad.length === 0 && built.size === P.length,
    bad.slice(0,5).map(p=>p.player).join("; ") || `built ${built.size} vs published ${P.length}`);
  const V3 = JSON.parse(SRC).players;
  const v3sum = V3.reduce((a,p)=>a+p.exact,0);
  t("the v3 prior it derives from still sums to $2,800", Math.abs(v3sum - 2800) < 0.01, v3sum.toFixed(4));
  /* Monotone in the v3 exact, so ETR order survives; only integer ties can move. */
  const v3by = new Map(V3.map(p=>[p.id,p.exact]));
  const inv = P.filter(p=>p.target>0).sort((a,b)=>b.exact-a.exact)
    .filter((p,i,arr)=> i && (v3by.get(p.id) ?? 0) > (v3by.get(arr[i-1].id) ?? 0) + 1e-9);
  t("ETR order is preserved — no player passes another on the v3 exact",
    inv.length === 0, inv.slice(0,5).map(p=>p.player).join("; "));
}
t("the methodology payload discloses the transform", (()=>{
  const m = JSON.parse(fs.readFileSync(new URL("../data/datadawg-dollars-method.json", import.meta.url),"utf8")).data.practical_curve;
  return m && m.league_budget === LEAGUE_BUDGET && m.auction_slots === AUCTION_SLOTS
    && m.soft_reserve_per_slot === RESERVE_PER_SLOT && m.premium_scale === PREMIUM_SCALE
    && m.minimum_bid === 0 && /Hamilton/i.test(m.integerization);
})(), "data/datadawg-dollars-method.json is missing or disagrees with the build");
t("envelope carries the /data/ contract fields",
  !!(ENV.as_of && ENV.source && ENV.tier && typeof ENV.graded === "boolean" && ENV.tier_meaning),
  "missing one of as_of/source/tier/graded/tier_meaning");
const board = fs.readFileSync(new URL("../datadawg-dollars.html", import.meta.url), "utf8");
t("board unwraps the envelope once", board.includes(").json()).data;"), "accessor not patched");
t("board reads the renamed payload", board.includes("data/datadawg-dollars-values.json"), "board still points at the old path");
t("board carries the product name", /<h1>DataDawg\$/.test(board), "h1 not renamed");
/* th/td are white-space:nowrap, so the table lays out ~696px. Without its own scroller the
   PAGE scrolls sideways at 390px and drags the header and disclaimer off with it. Measured
   in Chromium: scrollWidth 696 vs clientWidth 390 before, 390/390 after. */
t("wide table scrolls inside its own container, not the page",
  board.includes('<div class="twrap"><table>') && board.includes("</table></div>")
  && /\.twrap\{overflow-x:auto/.test(board),
  "table is not wrapped in an overflow-x scroller");
/* The published payload is v4 now, but it must still NAME the sealed v3 computation it
   derives from — that id is the receipt work/ppn-auction-src/ is the artifact for, so
   dropping it would leave the numbers with no traceable prior. */
t("payload is v4", V.model_id === "datadawgs-datadawg-dollars-2026-v4", V.model_id);
t("payload still names its sealed v3 provenance",
  V.prior_model_id === "datadawgs-ppn-auction-2026-v3", V.prior_model_id);

console.log(`\n${pass} passed, ${fails.length} failed`);
if(fails.length){ console.log("BLOCKING:\n - " + fails.join("\n - ")); process.exit(1); }
console.log("all build-blocking tests pass");
