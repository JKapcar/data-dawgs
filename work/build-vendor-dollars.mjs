/* Convert outside auction boards into THIS league's room, so the cheat sheet can show
 * three comparable dollar columns instead of one.
 *
 * ⚠️ WHAT THIS DOES AND DOES NOT DO. datadawgs-ppn-auction-2026-v3 converts a board with
 * central_weight = max(0, (src-1) + beta*[0.5*(VOR_14std - VOR_12std) + 0.5*(VOR_14custom
 * - VOR_14std)]) — a budget/depth term AND a custom-scoring term. The scoring term needs
 * per-player STAT COMPONENTS (completions, sacks, first downs, 40+ plays); the method
 * contract names FFToday component projections and nflverse event rates as its inputs.
 * Neither is available here, and neither ESPN nor the CSV carries components — only
 * dollars. Backing the adjustment out of the published v3 payload is underdetermined
 * (w_i = exact_i*S/2800 leaves S free; the recovered position signs flip with S), so it
 * is not reconstructable either.
 *
 * Therefore these two columns run at the method's OWN "budget_only 0/0" sensitivity
 * scenario — a named corner of its documented space, not something invented here:
 *
 *     weight_i = max(src_i - 1, 0);  exact_i = 2800 * weight_i / sum(weight)
 *     Hamilton/largest-remainder to an integer total of exactly 2800
 *
 * That makes ESPN and PFF apples-to-apples with each other and with the room's budget.
 * It does NOT apply the custom-scoring shift, which is exactly what DataDawg$ adds on
 * top. The board must say so per column; a budget conversion wearing a scoring
 * conversion's label is the overclaim this whole /data/ layer exists to prevent.
 *
 * Kickers are dropped (no K slot in this league) and their budget redistributes. DST is
 * priced 0, matching v3, which prices no defense.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOTAL = 2800;

/* Names differ across vendors: "James Cook III" vs "James Cook", "JAC" vs "JAX".
   Normalize hard, then report what still failed rather than dropping it silently. */
const norm = s => String(s).toLowerCase()
  .replace(/’/g, "'")
  .replace(/\b(jr|sr|ii|iii|iv|v)\.?\b/g, "")
  .replace(/[^a-z]/g, "");

function hamilton(rows, total) {
  const sum = rows.reduce((a, r) => a + r.w, 0);
  if (sum <= 0) return rows.map(r => ({ ...r, target: 0, exact: 0 }));
  const out = rows.map(r => {
    const exact = total * r.w / sum;
    return { ...r, exact, fl: Math.floor(exact) };
  });
  let short = total - out.reduce((a, r) => a + r.fl, 0);
  const order = [...out].sort((a, b) => (b.exact - b.fl) - (a.exact - a.fl) || b.exact - a.exact);
  const bump = new Set();
  for (const r of order) { if (short <= 0) break; bump.add(r.key); short--; }
  return out.map(r => ({ ...r, target: r.fl + (bump.has(r.key) ? 1 : 0) }));
}

function convert(src) {
  // src: [{key, name, pos, team, price}] in the vendor's own room
  const live = src.filter(r => r.pos !== "K");
  const rows = live.map(r => ({ ...r, w: r.pos === "DST" ? 0 : Math.max(r.price - 1, 0) }));
  return hamilton(rows, TOTAL);
}

/* ---------- ESPN: 2026 ESPN Fantasy Football Draft Kit, PPR cheat sheet ----------
   Its own footer: "10 teams/$200", "1 QB, 2 RB, 2 WR, 1 TE, 1 Flex, 1 K, 1 D/ST, 7 bench",
   "1 PPR", updated 2026-08-19. Rows read "12. (21) Kenneth Walker III, KC $34 5". */
function parseEspn(txt) {
  const rx = /(\d+)\.\s*\((\d+)\)\s*([^,]+?),\s*([A-Z]{2,3})\s*\$(\d+)\s*(\d+)/g;
  const seen = new Map();
  for (let m; (m = rx.exec(txt)); ) {
    const name = m[3].trim();
    seen.set(norm(name), { key: norm(name), name, team: m[4], price: +m[5], overall: +m[2] });
  }
  return [...seen.values()];
}

/* ---------- the CSV board ---------- */
function parseCsv(txt) {
  const lines = txt.replace(/\r/g, "").split("\n");
  const head = lines.findIndex(l => l.startsWith("Overall Rank"));
  const cols = lines[head].split(",");
  const iName = cols.indexOf("Full Name"), iPos = cols.indexOf("Position"),
        iTeam = cols.indexOf("Team Abbreviation"), iVal = cols.indexOf("Auction Value");
  const out = [];
  for (const line of lines.slice(head + 1)) {
    if (!line.trim()) continue;
    const c = []; let cur = "", q = false;
    for (const ch of line) {
      if (q) { if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { c.push(cur); cur = ""; }
      else cur += ch;
    }
    c.push(cur);
    const v = c[iVal];
    if (!c[iName]) continue;
    out.push({ key: norm(c[iName]), name: c[iName], team: c[iTeam], pos: c[iPos],
               price: (v === "N/A" || v === "") ? 0 : +v });
  }
  return out;
}

const espnTxt = fs.readFileSync(process.argv[2], "utf8");
const csvTxt  = fs.readFileSync(process.argv[3], "utf8");

/* ESPN's text gives no position column; take it from the DataDawg$ pool, which is the
   join target anyway. Anything unmatched is reported, never silently priced. */
const dd = JSON.parse(fs.readFileSync(path.join(ROOT, "data/datadawg-dollars-values.json"), "utf8")).data.players;
const posByKey = new Map(dd.map(p => [norm(p.player), p.pos]));

const espnRaw = parseEspn(espnTxt).map(r => ({ ...r, pos: posByKey.get(r.key) || "UNK" }));
const csvRaw  = parseCsv(csvTxt);

const espn = convert(espnRaw.filter(r => r.pos !== "UNK"));
const pff  = convert(csvRaw);

const report = (label, raw, conv) => {
  const priced = conv.filter(r => r.target > 0);
  console.log(`${label}: ${raw.length} parsed → ${conv.length} eligible → ${priced.length} priced, `
    + `total $${conv.reduce((a, r) => a + r.target, 0)}`);
  console.log("   top:", priced.sort((a, b) => b.target - a.target).slice(0, 6)
    .map(r => `${r.name} $${r.target}`).join(", "));
};
report("ESPN", espnRaw, espn);
report("CSV ", csvRaw, pff);

const unmatchedEspn = espnRaw.filter(r => r.pos === "UNK");
console.log(`\nESPN rows with no match in the DataDawg$ pool: ${unmatchedEspn.length}`);
if (unmatchedEspn.length) console.log("   " + unmatchedEspn.slice(0, 12).map(r => r.name).join(", "));

const ddKeys = new Set(dd.map(p => norm(p.player)));
const csvMiss = pff.filter(r => r.target > 0 && !ddKeys.has(r.key));
console.log(`CSV priced rows with no match in the DataDawg$ pool: ${csvMiss.length}`);
if (csvMiss.length) console.log("   " + csvMiss.slice(0, 12).map(r => r.name).join(", "));

fs.writeFileSync(path.join(ROOT, "work/vendor-dollars.json"),
  JSON.stringify({ espn: espn.map(r => ({ key: r.key, name: r.name, pos: r.pos, target: r.target })),
                   pff:  pff.map(r => ({ key: r.key, name: r.name, pos: r.pos, target: r.target })) }, null, 1));
console.log("\nwrote work/vendor-dollars.json");
