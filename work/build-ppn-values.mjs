/* Build league-specific auction values for pepperoninipples (Yahoo 773763,
   JohnMaddenPepperoniNipplesXV): 14-team half-PPR, heavily custom scoring, no K slot.

   BASE — the owner's personal value board (an auction export he supplies). Paid content:
   the CSV itself is NEVER committed or published — only derived, renormalized dollars are
   baked into the pages, and the public label says "personal board", never the vendor.
   Pass the CSV path as argv[2]; defaults to the session scratchpad copy.

   METHOD (v2, 2026-08-27 — additive, floored, tail-minded). v1 multiplied the board
   price by a clamped VOR ratio and renormalized the raw sum; that inflated the top
   (Gibbs $91 was a normalization artifact, not an opinion) and mis-signed QBs by not
   modeling sacks. v2, after a side-by-side with an independent implementation of the
   same task:

     score_i  = max(0, board_i - 1)  +  beta * (VOR_league_i - VOR_generic_i)
     price_i  = $1 floor + cashAboveReserve * score_i / sum(score)

   where beta converts VOR points to dollars at the board's own rate (sum of board
   premiums / sum of generic VOR over the priced pool), VOR_generic is the board's
   assumed room (12 teams, QB/2RB/3WR/TE/FLEX, generic half) and VOR_league is this
   room (14 teams, QB/2RB/2WR/TE/2FLEX/DEF, full custom scoring). Floors reserve $1 for
   every priced player; only the cash ABOVE the reserve is distributed, which compresses
   the top mechanically instead of letting renormalization inflate it.

   TAIL RULES, applied on the owner's instruction ("ask whether unusually high numbers
   are earned given the uncertainty"):
     - every backfilled component is SHRUNK: per-QB 2025 sack rates (nflverse, real
       spread 3.5%-11.7% per dropback) shrink toward the position median over k=200
       dropbacks; 40-yard runs and completions use POSITION MEANS ONLY, because
       per-player 2025 rates there are noise wearing a number;
     - every price gets a low/high band from scaling the whole league adjustment
       (L - H) by 0.5x / 1.5x; the builder prints the top-15 bands and WARNS on any
       top-15 price whose band is wider than 35% of the price, or that exceeds the
       naive 14-team scale-up of its board price — a boost resting on soft components
       must be looked at, not shipped silently;
     - the output is cross-checked against the independent implementation's board
       (scratchpad/sol-board.json) and the top-20 mean absolute difference is printed.

   SCORING modeled: +.25/cmp, -.5/inc, 1pt/20 pass yd, 4/pass TD, -2.5 INT, -1/sack
   (shrunk 2025 rates), 1pt/10 rush-rec yd, 6/TD, .5/rec, +.25 per rushing AND
   receiving first down (projected), +1 per 40-yd catch (projected) and 40-yd run
   (position mean), +.5 per 40-yd completion (position mean), 2pt conv, -2.5 fum.
   Still not modeled, still stated on the board: return yards, pick-six extra,
   whole-point rounding. DSTs ride at the board's ~$1. Kickers $0 — no K slot.

       node work/build-ppn-values.mjs [path-to-csv]
*/
import fs from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SCRATCH = "C:/Users/jkapc/AppData/Local/Temp/claude/C--Users-jkapc-data-dawgs/8f5623b8-32e7-4b85-888f-719f5b85c92b/scratchpad";
const CSV = process.argv[2] || SCRATCH + "/etr-today.csv";
const BUDGET = 14 * 200;
const LG_SLOTS  = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2 };   // this league, 14 teams
const GEN_SLOTS = { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 };   // the board's assumed room, 12

/* ---- 2025 observed rates (nflverse via the comparison workbook; open data) --- */
const NV = JSON.parse(fs.readFileSync(SCRATCH + "/nflverse-2025.json", "utf8"));
const SACK_K = 200, SACK_MEDIAN = 0.066;
const P40_RATE = NV.pos40.pass40_per_att;        // ~0.0133 per attempt, position mean
const R40_RATE = NV.pos40.rush40_per_carry_RB;   // ~0.0060 per carry, position mean

/* ---- names ------------------------------------------------------------------ */
const ALIAS = {
  kennethgainwell: "kennygainwell", hollywoodbrown: "marquisebrown",
  camward: "cameronward", chigoziemokonkwo: "chigokonkwo",
};
const norm = s => {
  const k = String(s).toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
  return ALIAS[k] || k;
};
const sackRate = new Map();
NV.qb_sacks.forEach(q => {
  const att = Number(q.att) || 0, sk = Number(q.sacks) || 0, db = att + sk;
  sackRate.set(norm(q.name), (sk + SACK_K * SACK_MEDIAN) / (db + SACK_K));   // shrunk
});

/* ---- scoring ---------------------------------------------------------------- */
const n = v => Number(v) || 0;
function leagueAdj(st, name) {                     // the league-specific ADJUSTMENT, L = H + adj
  const att = n(st.pass_att), cmp = n(st.pass_cmp), inc = Math.max(0, att - cmp);
  const r = sackRate.get(norm(name)) ?? SACK_MEDIAN;
  const sacks = att > 0 ? att * r / (1 - r) : 0;   // rate is per dropback
  return 0.25 * cmp - 0.5 * inc                    // completions / incompletions
    + n(st.pass_yd) * (1/20 - 1/25)                // 20 yds/pt vs 25
    - 1.5 * n(st.pass_int)                         // -2.5 vs -1
    - 1 * sacks                                    // -1/sack, shrunk 2025 rate
    + 0.25 * (n(st.rush_fd) + n(st.rec_fd))        // first downs, projected
    + 1 * n(st.rec_40p)                            // 40-yd catches, projected
    + 1 * n(st.rush_att) * R40_RATE                // 40-yd runs, position mean
    + 0.5 * att * P40_RATE                         // 40-yd completions, position mean
    - 0.5 * n(st.fum_lost);                        // -2.5 vs -2
}
function halfPts(st) {
  return n(st.pass_yd) / 25 + 4 * n(st.pass_td) - 1 * n(st.pass_int)
    + n(st.rush_yd) / 10 + 6 * n(st.rush_td)
    + 0.5 * n(st.rec) + n(st.rec_yd) / 10 + 6 * n(st.rec_td)
    + 2 * (n(st.pass_2pt) + n(st.rush_2pt) + n(st.rec_2pt))
    - 2 * n(st.fum_lost);
}

/* ---- projections ------------------------------------------------------------- */
const url = "https://api.sleeper.app/projections/nfl/2026?season_type=regular"
  + ["QB","RB","WR","TE"].map(p => "&position[]=" + p).join("") + "&order_by=pts_half_ppr";
const rows = await (await fetch(url)).json();
const players = rows
  .filter(r => r.player && ["QB","RB","WR","TE"].includes(r.player.position) && r.stats)
  .map(r => {
    const name = r.player.full_name || ((r.player.first_name||"") + " " + (r.player.last_name||"")).trim();
    const H = halfPts(r.stats), A = leagueAdj(r.stats, name);
    return { name, pos: r.player.position, H, A };
  })
  .filter(p => p.H > 0);
const projByKey = new Map();
players.forEach(p => projByKey.set(norm(p.name) + "|" + p.pos, p));

/* ---- replacement, parameterised by room and by adjustment scale -------------- */
function replacement(teams, slots, scale) {        // scale: 0 = generic H, 1 = full league
  const byPos = {};
  ["QB","RB","WR","TE"].forEach(p =>
    byPos[p] = players.filter(x => x.pos === p).map(x => x.H + scale * x.A).sort((a,b) => b - a));
  const used = {}; for (const p of ["QB","RB","WR","TE"]) used[p] = (slots[p]||0) * teams;
  for (let i = 0; i < (slots.FLEX||0) * teams; i++) {
    let best = null, bp = null;
    ["RB","WR","TE"].forEach(p => {
      const c = byPos[p][used[p]];
      if (c != null && (best == null || c > best)) { best = c; bp = p; }
    });
    if (bp) used[bp]++;
  }
  const rep = {};
  for (const p of ["QB","RB","WR","TE"]) rep[p] = byPos[p][used[p]] ?? 0;
  return rep;
}
const repG = replacement(12, GEN_SLOTS, 0);

/* ---- the personal board ------------------------------------------------------ */
const csvLines = fs.readFileSync(CSV, "utf8").trim().split(/\r?\n/);
const HD = csvLines[0].split(",").map(x => x.replace(/^"|"$/g, ""));
const ix = { name: HD.indexOf("Player"), pos: HD.indexOf("Position"), half: HD.indexOf("ETR Half PPR") };
const board = new Map();
csvLines.slice(1).forEach(l => {
  const c = l.split(",").map(x => x.replace(/^"|"$/g, ""));
  board.set(norm(c[ix.name]) + "|" + c[ix.pos], Number(c[ix.half]) || 0);
});
const AS_OF = new Date().toISOString().slice(0, 10);

/* ---- price the pool at a given adjustment scale ------------------------------ */
function priceAll(arr, scale) {
  const repL = replacement(14, LG_SLOTS, scale);
  const rowsX = arr.map(r => {
    if (r.pos === "K") return { base: 0, dst: false, score: 0, eligible: false };
    const key = r.pos === "DST" ? norm(r.team + " DST") + "|DST" : norm(r.name) + "|" + r.pos;
    const base = board.get(key) ?? 0;
    if (r.pos === "DST") return { base, dst: true, score: 0, eligible: base > 0 };
    const hit = projByKey.get(key);
    if (!hit) return { base, dst: false, score: Math.max(0, base - 1), eligible: base > 0 };
    const vG = hit.H - repG[hit.pos];
    const vL = (hit.H + scale * hit.A) - repL[hit.pos];
    return { base, dst: false, vG, vL, hit, eligible: base > 0 };
  });
  /* beta: the board's own dollars-per-generic-VOR-point, from its priced pool */
  let prem = 0, vg = 0;
  rowsX.forEach(x => { if (x.eligible && !x.dst && x.vG > 0) { prem += Math.max(0, x.base - 1); vg += x.vG; } });
  const beta = vg > 0 ? prem / vg : 0;
  rowsX.forEach(x => {
    if (!x.eligible || x.dst) { x.score = x.score ?? 0; return; }
    const delta = x.hit ? beta * (x.vL - x.vG) : 0;
    x.score = Math.max(0, Math.max(0, x.base - 1) + delta);
  });
  const nPriced = rowsX.filter(x => x.eligible).length;      // every priced player holds a $1 floor
  const cashAbove = BUDGET - nPriced;
  const sumScore = rowsX.reduce((a, x) => a + (x.eligible && !x.dst ? x.score : 0), 0);
  return rowsX.map(x => {
    if (!x.eligible) return 0;
    if (x.dst) return Math.round(x.base * 10) / 10;          // DSTs ride at the board's ~$1
    return Math.round((1 + cashAbove * x.score / sumScore) * 10) / 10;
  });
}

/* ---- bake into both inline pools --------------------------------------------- */
function bake(file, marker, prices) {
  let s = fs.readFileSync(ROOT + "/" + file, "utf8");
  const i = s.indexOf(marker);
  if (i < 0) throw new Error(file + ": marker not found");
  const j = s.indexOf("];", i);
  const arr = JSON.parse(s.slice(i + marker.length - 1, j + 1));
  if (prices.length !== arr.length) throw new Error(file + ": pool size changed between bakes");
  arr.forEach((r, k) => { r.lg = prices[k]; });
  s = s.slice(0, i + marker.length - 1) + JSON.stringify(arr) + s.slice(j + 1);
  fs.writeFileSync(ROOT + "/" + file, s);
  return arr;
}

const boardSrc = fs.readFileSync(ROOT + "/board.html", "utf8");
const bi = boardSrc.indexOf("const SEED = [");
const poolArr = JSON.parse(boardSrc.slice(bi + 13, boardSrc.indexOf("];", bi) + 1));
const central = priceAll(poolArr, 1);
const lo = priceAll(poolArr, 0.5), hi = priceAll(poolArr, 1.5);
const arr = bake("board.html", "const SEED = [", central);
bake("dashboard.html", "window.DD_POOL = [", central);

/* ---- sanity, tails, and the cross-check -------------------------------------- */
const sum = central.reduce((a, v) => a + v, 0);
console.log(`as_of ${AS_OF} · budget -> $${sum.toFixed(0)} (target ${BUDGET})`);
const idx = arr.map((r, i) => ({ r, i })).filter(x => x.r.lg > 0).sort((a, b) => b.r.lg - a.r.lg);
console.log("\ntop 15 with stress bands (adjustment x0.5 / x1.5):");
let warns = 0;
idx.slice(0, 15).forEach(({ r, i }) => {
  const band = [Math.min(lo[i], hi[i]), Math.max(lo[i], hi[i])];
  const key = r.pos === "DST" ? norm(r.team + " DST") + "|DST" : norm(r.name) + "|" + r.pos;
  const base = board.get(key) ?? 0;
  const naive = base * BUDGET / 2400;                       // 14-team scale-up of the board price
  const wide = (band[1] - band[0]) / r.lg > 0.35;
  const over = naive > 0 && r.lg > naive;
  if (wide || over) warns++;
  console.log(`  ${r.name.padEnd(24)} ${r.pos}  $${String(r.lg).padStart(5)}  [${band[0]}-${band[1]}]`
    + (wide ? "  ⚠ WIDE BAND — soft components carry this price" : "")
    + (over ? `  ⚠ ABOVE naive 14t scale-up ($${naive.toFixed(0)}) — is this earned?` : ""));
});
console.log(warns ? `\n⚠ ${warns} tail warning(s) above — look before shipping.` : "\ntails clean: no top-15 price is wide-banded or above its naive scale-up.");
const qbs = idx.filter(x => x.r.pos === "QB").slice(0, 5);
console.log("\ntop QBs:", qbs.map(x => `${x.r.name} $${x.r.lg}`).join(" | "));

/* independent implementation of the same task, same inputs */
try {
  const sol = JSON.parse(fs.readFileSync(SCRATCH + "/sol-board.json", "utf8"));
  const solBy = new Map(sol.map(x => [norm(x.name) + "|" + x.pos, x.target]));
  const diffs = idx.slice(0, 20).map(({ r }) => {
    const key = r.pos === "DST" ? norm(r.team + " DST") + "|DST" : norm(r.name) + "|" + r.pos;
    const t = solBy.get(key);
    return t == null ? null : { name: r.name, mine: r.lg, sol: t, d: +(r.lg - t).toFixed(1) };
  }).filter(Boolean);
  const mad = diffs.reduce((a, x) => a + Math.abs(x.d), 0) / diffs.length;
  console.log(`\ncross-check vs the independent board — top-20 mean abs diff: $${mad.toFixed(1)}`);
  diffs.filter(x => Math.abs(x.d) >= 4).forEach(x => console.log(`  disagree: ${x.name}  mine $${x.mine} vs $${x.sol}`));
} catch (e) { console.log("\n(no independent board to cross-check against)"); }
