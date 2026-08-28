/* DataDawg$ v4 — the practical auction curve.
 *
 * WHAT CHANGED AND WHY. v3 was a pure value-over-replacement allocation: it handed the
 * whole $2,800 to the ~121 players who clear replacement level and $0 to everyone else.
 * As a valuation that is right. As a BID SHEET it is not, because 210 roster spots get
 * bought on draft night and a $0-minimum room still leaks real money into mandatory
 * starters, the D/ST nobody wants, and the last four rounds of nominations. A sheet that
 * says that money does not exist will have you outbid on the tail with a budget you
 * already spent at the top.
 *
 * So a soft behavioural reserve of $0.75 per auctioned slot comes off the premium pool
 * and is handed back across the 210 slots:
 *
 *     new_exact = 0.75 + 0.94375 * v3_exact      (inside the 210-slot pool)
 *     new_exact = 0                              (outside it)
 *
 * ⚠️ THE $0.75 IS NOT A MINIMUM BID and this patch does not impose one. $0 bids stay
 * legal and most of the tail still publishes at $0 after rounding. It is an aggregate
 * model of where a real room's money goes, not a per-player floor.
 *
 * ⚠️ THIS IS A DOLLAR-ALLOCATION PATCH, NOT A RANKING. ETR still decides who is better
 * than whom. The transform is monotone in v3_exact, so ETR order is preserved exactly;
 * only integer ties move, and those are broken on the exact value then the ETR rank.
 *
 * ⚠️ HOW THE 210-SLOT POOL IS PICKED, and the one judgement call in this file.
 * The repo defines no 210-player pool, so it is constructed per position — 26/68/78/24/14
 * — from the ETR-led ranking. But the ETR snapshot's `rank` is only a RANKING down to
 * about player 122: below that every remaining player carries etr_half 0 and the rows sit
 * in ALPHABETICAL order. Selecting "top 68 RB by rank" off that list puts James Conner and
 * CJ Stroud in the pool and leaves Najee Harris and Geno Smith out, purely on spelling.
 * That is not an ETR opinion — ETR has no opinion here, it priced them all at zero.
 *
 * So: ETR leads where ETR speaks. Every player it valued above zero is in the pool, in its
 * order. The remaining slots are filled by the SITE'S OWN board rank (board.html SEED),
 * which is projection-driven and continuous all the way down. No outside vendor, ADP or
 * consensus is consulted — board rank is the same ETR-led ranking the site already
 * publishes, and it is used only to order players ETR itself declined to separate.
 *
 * Run:  node work/build-datadawg-practical.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = p => fs.readFileSync(path.join(REPO, p), "utf8");

export const LEAGUE_BUDGET = 2800;
export const AUCTION_SLOTS = 210;
export const RESERVE_PER_SLOT = 0.75;
export const RESERVE_TOTAL = AUCTION_SLOTS * RESERVE_PER_SLOT;          // 157.5
export const PREMIUM_SCALE = (LEAGUE_BUDGET - RESERVE_TOTAL) / LEAGUE_BUDGET; // 0.94375
export const SLOTS = { QB: 26, RB: 68, WR: 78, TE: 24, DST: 14 };

/* The season-ending ACL is the one documented player override. It is applied by removing
   him from the pool, not by pricing him and then zeroing him: a player who cannot be
   rostered does not occupy one of the 210 slots the reserve is spread across. */
const OVERRIDES = {
  "00-0038130": { player: "Jayden Higgins", pos: "WR", team: "HOU",
                  status: "injury override", reason: "season-ending ACL" },
};

const norm = s => s.toLowerCase().replace(/[’']/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\.?\b/g, "")
  .replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

export function buildV4(){
  /* ---- inputs -------------------------------------------------------------- */
  const sealed = JSON.parse(R("work/ppn-auction-src/ppn-auction-values.json"));
  const V3 = sealed.players;

  const boardSrc = R("board.html");
  const bi = boardSrc.indexOf("const SEED = [");
  const BOARD = JSON.parse(boardSrc.slice(bi + 12, boardSrc.indexOf("];", bi) + 1));

  /* board rank, for ordering the players ETR priced at zero. DST names differ between the
     two sources ("ARI DST" vs "Arizona Cardinals DST"), so they join on team abbreviation. */
  const TEAMWORD = {};
  for(const b of BOARD){
    if(b.pos === "DST") TEAMWORD[norm(b.name).replace(/ dst$/, "")] = b;
  }
  const byName = new Map();
  for(const b of BOARD) byName.set(`${norm(b.name)}|${b.pos}`, b);

  const boardRank = v => {
    if(v.pos === "DST"){
      const hit = BOARD.find(b => b.pos === "DST" && b.team === v.team);
      return hit ? hit.rank : Infinity;
    }
    const hit = byName.get(`${norm(v.player)}|${v.pos}`);
    return hit ? hit.rank : Infinity;
  };

  /* ---- 1. the 425-row canonical roster ------------------------------------- */
  const rows = V3.map(p => ({ ...p }));
  if(!rows.some(p => p.id === "00-0038130")){
    const o = OVERRIDES["00-0038130"];
    rows.push({ id: "00-0038130", player: o.player, pos: o.pos, team: o.team,
      rank: rows.length + 1, target: 0, exact: 0, low: 0, high: 0,
      etr_half: null, delta_vs_etr: null,
      override: { status: o.status, reason: o.reason } });
  }
  for(const p of rows){
    const o = OVERRIDES[p.id];
    if(o) p.override = { status: o.status, reason: o.reason };
  }

  /* ---- 2. the 210-slot pool ------------------------------------------------ */
  const pool = new Set();
  const poolByPos = {};
  for(const [pos, n] of Object.entries(SLOTS)){
    const cands = rows.filter(p => p.pos === pos && !p.override)
      .sort((a, b) => (b.exact - a.exact) || (boardRank(a) - boardRank(b)) || (a.rank - b.rank));
    if(cands.length < n) throw new Error(`${pos}: only ${cands.length} candidates for ${n} slots`);
    poolByPos[pos] = cands.slice(0, n);
    for(const p of poolByPos[pos]) pool.add(p.id);
  }
  if(pool.size !== AUCTION_SLOTS) throw new Error(`pool is ${pool.size}, expected ${AUCTION_SLOTS}`);

  /* Every dollar of v3 must land inside the pool, or the transform silently loses money. */
  const outsideMoney = rows.filter(p => !pool.has(p.id)).reduce((a, p) => a + p.exact, 0);
  if(outsideMoney > 1e-6) throw new Error(`$${outsideMoney.toFixed(4)} of v3 value sits outside the pool`);

  /* ---- 3. the transform ---------------------------------------------------- */
  for(const p of rows){
    p.v3_exact = p.exact;
    p.v3_target = p.target;
    p.exact = pool.has(p.id) ? RESERVE_PER_SLOT + PREMIUM_SCALE * p.v3_exact : 0;
  }

  /* ---- 4. Hamilton / largest remainder to exactly $2,800 -------------------- */
  const priced = rows.filter(p => p.exact > 0);
  for(const p of rows) p.target = Math.floor(p.exact);
  let left = LEAGUE_BUDGET - rows.reduce((a, p) => a + p.target, 0);
  if(left < 0) throw new Error(`floors already exceed the budget by ${-left}`);
  const queue = priced.slice().sort((a, b) =>
    ((b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)))
    || (b.exact - a.exact) || (a.rank - b.rank));
  if(left > queue.length) throw new Error(`${left} dollars left but only ${queue.length} candidates`);
  for(let i = 0; i < left; i++) queue[i].target += 1;

  const total = rows.reduce((a, p) => a + p.target, 0);
  if(total !== LEAGUE_BUDGET) throw new Error(`sum is ${total}, not ${LEAGUE_BUDGET}`);

  return { rows, pool, poolByPos, sealed, total };
}

/* ---- 5. report ----------------------------------------------------------- */
if(process.argv[1] && process.argv[1].endsWith("build-datadawg-practical.mjs")){
  const { rows, pool, total } = buildV4();
  const V3 = JSON.parse(R("work/ppn-auction-src/ppn-auction-values.json")).players;
  rows.sort((a, b) => (b.exact - a.exact) || (a.rank - b.rank));
  console.log(`pool ${pool.size} = ` + Object.entries(SLOTS).map(([k, n]) => `${n} ${k}`).join(", "));
  console.log(`v3 sum ${V3.reduce((a, p) => a + p.exact, 0).toFixed(4)} -> ` +
    `v4 exact ${rows.reduce((a, p) => a + p.exact, 0).toFixed(4)}, published ${total}`);
  console.log(`positive: v3 ${V3.filter(p => p.target > 0).length} -> v4 ${rows.filter(p => p.target > 0).length}` +
    `   zero: v3 ${V3.filter(p => p.target === 0).length} -> v4 ${rows.filter(p => p.target === 0).length}`);
  for(const p of rows.slice(0, 25)){
    console.log(`  ${String(p.v3_target).padStart(3)} -> ${String(p.target).padStart(3)}  ${p.player} (${p.pos})`);
  }
}
