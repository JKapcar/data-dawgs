/* Build league-specific auction values for pepperoninipples (Yahoo 773763,
   JohnMaddenPepperoniNipplesXV): 14-team half-PPR, heavily custom scoring, no K slot.

   BASE — the owner's personal value board (an ETR auction export he supplies), NOT the
   site's MV snapshot. He named it the bible for this league; the CSV itself is paid
   content and MUST NEVER be committed or published — only the derived, renormalized
   dollars are baked into the pages, and the public label says "personal board", never
   the vendor. Pass the CSV path as argv[2]; defaults to the session scratchpad copy.

   METHOD — one ratio absorbs everything that separates his board's frame from this
   league. The board prices a generic 12-team half-PPR room (assumed QB/2RB/3WR/TE/FLEX);
   this league is 14 teams, QB/2RB/2WR/TE/2FLEX/DEF, and scores completions (+.25),
   incompletions (-.5), 20 pass yds/pt, -2.5 INT, +.25 per rushing AND receiving first
   down, +1 per 40-yard catch, -2.5 fumbles. So:

       lg = ETRhalf x ( VOR[14tm, league lineup, league scoring]
                      / VOR[12tm, 3WR lineup,   generic half  ] ),

   both VORs from the SAME Sleeper season projection stat lines, then renormalized so the
   whole pool sums to the room's real budget, 14 x $200 = $2800. Ratio-on-his-dollars
   keeps his board's market judgement; the ratio moves only what the frame change moves.

   HONEST HOLES (stated on the board): sacks taken, 40-yd runs/completions, return yards
   and Yahoo's whole-point rounding are not projected/modeled; DST scoring is custom but
   board DSTs are ~$1 and stay as priced; players his board prices at 0 stay 0 even
   though a 14-team room reaches deeper — the bible is the bible.

       node work/build-ppn-values.mjs [path-to-csv]
*/
import fs from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CSV = process.argv[2] ||
  "C:/Users/jkapc/AppData/Local/Temp/claude/C--Users-jkapc-data-dawgs/8f5623b8-32e7-4b85-888f-719f5b85c92b/scratchpad/etr-today.csv";
const BUDGET = 14 * 200;
const LG_SLOTS  = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2 };   // this league, 14 teams
const GEN_SLOTS = { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 };   // the board's assumed room, 12

/* ---- scoring -------------------------------------------------------------- */
const n = v => Number(v) || 0;
function leaguePts(st) {
  const inc = Math.max(0, n(st.pass_att) - n(st.pass_cmp));
  return 0.25 * n(st.pass_cmp) - 0.5 * inc + n(st.pass_yd) / 20 + 4 * n(st.pass_td)
    - 2.5 * n(st.pass_int)
    + n(st.rush_yd) / 10 + 6 * n(st.rush_td) + 0.25 * n(st.rush_fd)
    + 0.5 * n(st.rec) + n(st.rec_yd) / 10 + 6 * n(st.rec_td) + 0.25 * n(st.rec_fd)
    + 1 * n(st.rec_40p)
    + 2 * (n(st.pass_2pt) + n(st.rush_2pt) + n(st.rec_2pt))
    - 2.5 * n(st.fum_lost);
}
function halfPts(st) {
  return n(st.pass_yd) / 25 + 4 * n(st.pass_td) - 1 * n(st.pass_int)
    + n(st.rush_yd) / 10 + 6 * n(st.rush_td)
    + 0.5 * n(st.rec) + n(st.rec_yd) / 10 + 6 * n(st.rec_td)
    + 2 * (n(st.pass_2pt) + n(st.rush_2pt) + n(st.rec_2pt))
    - 2 * n(st.fum_lost);
}

/* ---- names ---------------------------------------------------------------- */
/* Aliases earn their line only when real dollars hang on them. */
const ALIAS = {
  kennethgainwell: "kennygainwell",
  hollywoodbrown: "marquisebrown",
  camward: "cameronward",
  chigoziemokonkwo: "chigokonkwo",
};
const norm = s => {
  const k = String(s).toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
  return ALIAS[k] || k;
};

/* ---- projections ----------------------------------------------------------- */
const url = "https://api.sleeper.app/projections/nfl/2026?season_type=regular"
  + ["QB","RB","WR","TE"].map(p => "&position[]=" + p).join("") + "&order_by=pts_half_ppr";
const rows = await (await fetch(url)).json();
const players = rows
  .filter(r => r.player && ["QB","RB","WR","TE"].includes(r.player.position) && r.stats)
  .map(r => ({
    name: (r.player.full_name || ((r.player.first_name||"") + " " + (r.player.last_name||"")).trim()),
    pos: r.player.position, L: leaguePts(r.stats), H: halfPts(r.stats),
  }))
  .filter(p => p.H > 0);
const projByKey = new Map();
players.forEach(p => projByKey.set(norm(p.name) + "|" + p.pos, p));

/* ---- replacement, parameterised by room ------------------------------------ */
function replacement(key, teams, slots) {
  const byPos = {};
  ["QB","RB","WR","TE"].forEach(p =>
    byPos[p] = players.filter(x => x.pos === p).map(x => x[key]).sort((a,b) => b - a));
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
const repL = replacement("L", 14, LG_SLOTS);
const repG = replacement("H", 12, GEN_SLOTS);

/* Guards: a near-zero generic VOR turns rounding noise into a 5x price, and a scoring
   sheet changes how much a player is worth, not what species he is. */
const ratioOf = p => {
  const vL = p.L - repL[p.pos], vG = p.H - repG[p.pos];
  if (vG < 8 || vL < 0) return 1;
  return Math.min(1.8, Math.max(0.6, vL / vG));
};

/* ---- the personal board ----------------------------------------------------- */
const csvLines = fs.readFileSync(CSV, "utf8").trim().split(/\r?\n/);
const H = csvLines[0].split(",").map(x => x.replace(/^"|"$/g, ""));
const ix = { name: H.indexOf("Player"), pos: H.indexOf("Position"), half: H.indexOf("ETR Half PPR") };
const board = new Map();
csvLines.slice(1).forEach(l => {
  const c = l.split(",").map(x => x.replace(/^"|"$/g, ""));
  board.set(norm(c[ix.name]) + "|" + c[ix.pos], Number(c[ix.half]) || 0);
});
const AS_OF = new Date().toISOString().slice(0, 10);

/* ---- bake into both inline pools -------------------------------------------- */
function bake(file, marker) {
  let s = fs.readFileSync(ROOT + "/" + file, "utf8");
  const i = s.indexOf(marker);
  if (i < 0) throw new Error(file + ": marker not found");
  const j = s.indexOf("];", i);
  const arr = JSON.parse(s.slice(i + marker.length - 1, j + 1));
  let onBoard = 0, missProj = [];
  const raw = arr.map(r => {
    if (r.pos === "K") return 0;                     // no kicker slot in this league
    /* The board writes "BUF DST"; the pool writes "Buffalo Bills DST" with team=BUF.
       Match DSTs on the team code — name-normalizing city names is a mug's game. */
    const key = r.pos === "DST" ? norm(r.team + " DST") + "|DST" : norm(r.name) + "|" + r.pos;
    const base = board.get(key);
    if (base == null || base <= 0) return 0;         // the bible prices him at nothing
    onBoard++;
    if (r.pos === "DST") return base;                // board DSTs ride as priced (~$1)
    const hit = projByKey.get(key);
    if (!hit) { missProj.push(r.name); return base; }
    return base * ratioOf(hit);
  });
  const sumRaw = raw.reduce((a, v) => a + v, 0);
  const scale = BUDGET / sumRaw;
  arr.forEach((r, i2) => { r.lg = Math.round(raw[i2] * scale * 10) / 10; });
  s = s.slice(0, i + marker.length - 1) + JSON.stringify(arr) + s.slice(j + 1);
  fs.writeFileSync(ROOT + "/" + file, s);
  return { arr, onBoard, missProj };
}

const { arr, onBoard, missProj } = bake("board.html", "const SEED = [");
bake("dashboard.html", "window.DD_POOL = [");

/* ---- sanity out loud --------------------------------------------------------- */
const sumLg = arr.reduce((a, r) => a + (r.lg || 0), 0);
console.log(`as_of ${AS_OF} · ${onBoard} pool players priced on the personal board · budget -> $${sumLg.toFixed(0)} (target ${BUDGET})`);
if (missProj.length) console.log("on the board but no projection (kept at board price):", missProj.join("; "));
const priced = [...board.entries()].filter(([,v]) => v > 0).length;
console.log(`board rows priced: ${priced} · pool players the board does not price: ${arr.filter(r=>!["K"].includes(r.pos)&&!r.lg).length} (at $0)`);
console.log("\nreplacement league(14):", JSON.stringify(repL,(k,v)=>typeof v==="number"?+v.toFixed(1):v),
            "\nreplacement generic(12):", JSON.stringify(repG,(k,v)=>typeof v==="number"?+v.toFixed(1):v));
const top = arr.filter(r => r.lg >= 3).sort((a, b) => b.lg - a.lg);
console.log("\ntop 15:");
top.slice(0, 15).forEach(r => console.log(`  ${r.name.padEnd(24)} ${r.pos}  $${r.lg}`));
const qb = top.filter(r => r.pos === "QB").slice(0, 5);
console.log("top QBs:", qb.map(r => `${r.name} $${r.lg}`).join(" | "));
