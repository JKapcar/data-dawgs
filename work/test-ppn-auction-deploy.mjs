/* Handoff §3 — build-blocking tests. Any failure blocks the deploy. */
import fs from "node:fs";
import { createHash } from "node:crypto";

/* Handoff §3 gates, run against the DEPLOYED envelope — not the staged artifact — so this
   also proves the envelope wrapper did not disturb a single value. */
const ENV = JSON.parse(fs.readFileSync(new URL("../data/ppn-auction-values.json", import.meta.url), "utf8"));
const SRC = fs.readFileSync(new URL("./ppn-auction-src/ppn-auction-values.json", import.meta.url), "utf8");
const V = ENV.data;
const P = V.players;
let pass = 0; const fails = [];
const t = (name, cond, detail="") => { if(cond){ pass++; console.log("  ok   "+name); }
  else { fails.push(name+(detail?" — "+detail:"")); console.log("  FAIL "+name+(detail?" — "+detail:"")); } };

t("players.length == 424", P.length === 424, `got ${P.length}`);
const ks = P.filter(p => String(p.pos).toUpperCase() === "K");
t("zero kickers", ks.length === 0, `got ${ks.length}`);
const ids = P.map(p => p.id); const dupes = ids.filter((x,i)=>ids.indexOf(x)!==i);
t("zero duplicate ids", dupes.length === 0, dupes.join(","));
const neg = P.filter(p => p.target < 0);
t("zero negative targets", neg.length === 0, neg.map(p=>p.player).join(","));

const sum = P.reduce((a,p)=>a+p.target,0);
t("sum(target) == 2800 exactly", sum === 2800, `got ${sum}`);
const pos = P.filter(p => p.target > 0);
t("121 players with target > 0", pos.length === 121, `got ${pos.length}`);

for(const [name, want] of [["Jahmyr Gibbs",90],["Bijan Robinson",85],["Puka Nacua",76]]){
  const row = P.find(p => p.player === name);
  t(`${name} == ${want}`, row && row.target === want, row ? `got ${row.target}` : "row missing");
}
for(const [name, want] of [["Jaxon Smith-Njigba",77],["Ja'Marr Chase",77]]){
  const row = P.find(p => p.player === name);
  t(`${name} == ${want}`, row && row.target === want, row ? `got ${row.target}` : "row missing");
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

const dst = P.filter(p => String(p.pos).toUpperCase() === "DST");
t("all DST targets == 0", dst.length > 0 && dst.every(p=>p.target===0), `${dst.length} DST rows`);
const band = pos.filter(p => !(p.low <= p.target && p.target <= p.high));
t("every positive target satisfies low <= target <= high",
  band.length === 0, band.slice(0,5).map(p=>`${p.player} ${p.low}/${p.target}/${p.high}`).join("; "));

t("source_snapshot_sha256 matches",
  V.source_snapshot_sha256 === "1d772b1db0b5e79a06835b89d0589c5cc469930910798fef86d0975c3b511b8c",
  V.source_snapshot_sha256);

/* AMENDED GATE: Higgins absent-or-$0. Absent is the passing state; do not add a row. */
/* Key on the NFL id, and on the exact name — "Higgins" alone also matches Tee and
   Elijah Higgins, who are different players with legitimate prices. */
const hig = P.filter(p => p.id === "00-0038130" || /^jayden\s+higgins$/i.test((p.player||"").trim()));
const higOk = hig.length === 0 || hig.every(p => p.target === 0);
t("AMENDED GATE: Jayden Higgins (00-0038130) absent-or-$0",
  higOk, hig.length ? hig.map(p=>`${p.player} ${p.id} $${p.target}`).join("; ") : "absent (expected)");

/* The envelope's payload must equal the source artifact exactly. This is the guarantee
   that "do not recompute, smooth, cap or merge" survived packaging. */
t("envelope data is the source artifact verbatim",
  JSON.stringify(V) === JSON.stringify(JSON.parse(SRC)), "payload drifted from work/ppn-auction-src/");
t("envelope carries the /data/ contract fields",
  !!(ENV.as_of && ENV.source && ENV.tier && typeof ENV.graded === "boolean" && ENV.tier_meaning),
  "missing one of as_of/source/tier/graded/tier_meaning");
const board = fs.readFileSync(new URL("../ppn-auction-board.html", import.meta.url), "utf8");
t("board unwraps the envelope once", board.includes(").json()).data;"), "accessor not patched");

console.log(`\n${pass} passed, ${fails.length} failed`);
if(fails.length){ console.log("BLOCKING:\n - " + fails.join("\n - ")); process.exit(1); }
console.log("all build-blocking tests pass");
