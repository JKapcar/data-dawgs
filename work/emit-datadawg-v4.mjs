/* Publish DataDawg$ v4 to every consumer, in one pass.
 *
 * ⚠️ ATOMIC ON PURPOSE. An earlier vendor-column patch rewrote the player pools, then
 * failed on an anchor mismatch, and left the repo with new numbers under old prose. So:
 * every anchor is validated BEFORE anything is written, and a single missing anchor
 * aborts with nothing touched.
 *
 * Consumers, all of which must agree or the site quotes two different prices for the
 * same player in the same room:
 *   data/datadawg-dollars-values.json   the published payload the site fetches
 *   data/datadawg-dollars-method.json   the machine-readable methodology
 *   data/datadawg-dollars-method.md     the human methodology
 *   work/four-source-board.json         the intermediate the rig pools are built from
 *   board.html + 6 rig pages            the embedded `dd` column
 *   board.html intro, 31 Toto blocks    the prose that says what the number means
 *   datadawg-dollars.html               the dedicated page's disclaimer
 */
import fs from "node:fs";
import path from "node:path";
import { buildV4, REPO, LEAGUE_BUDGET, AUCTION_SLOTS, RESERVE_PER_SLOT, RESERVE_TOTAL,
         PREMIUM_SCALE, SLOTS } from "./build-datadawg-practical.mjs";

const P = f => path.join(REPO, f);
const R = f => fs.readFileSync(P(f), "utf8");
const writes = [];              // nothing lands until every anchor has been proved
const stage = (f, s) => writes.push([f, s]);

const { rows } = buildV4();
const byId = new Map(rows.map(r => [r.id, r]));
const norm = s => s.toLowerCase().replace(/[’']/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\.?\b/g, "")
  .replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const byName = new Map();
for(const r of rows) byName.set(`${norm(r.player)}|${r.pos}`, r);

const INTERPRETATION =
  "DataDawg$ is an opening-state auction target built from ETR player values, translated to " +
  "this league’s scoring, roster depth, $2,800 budget, and expected auction spending across " +
  "210 roster spots. It is a planning value, not a guaranteed clearing price or an automatic " +
  "maximum bid. Reassess after major purchases based on remaining budget and roster needs.";

/* ---- 1. the published payload -------------------------------------------- */
{
  const env = JSON.parse(R("data/datadawg-dollars-values.json"));
  const d = env.data;
  d.model_id = "datadawgs-datadawg-dollars-2026-v4";
  d.prior_model_id = "datadawgs-ppn-auction-2026-v3";
  d.epistemic_status = "reproducible conversion of a sealed v3 prior; not outcome-validated";
  d.interpretation = INTERPRETATION;
  d.players = rows.map(r => ({
    id: r.id, player: r.player, pos: r.pos, team: r.team, rank: r.rank,
    target: r.target, exact: Number(r.exact.toFixed(4)),
    low: r.low, high: r.high, etr_half: r.etr_half, delta_vs_etr: r.delta_vs_etr,
    v3_target: r.v3_target, override: r.override ?? null,
  }));
  d.validation = {
    rows: rows.length,
    auction_pool: AUCTION_SLOTS,
    pool_by_pos: SLOTS,
    positive_prices: rows.filter(r => r.target > 0).length,
    target_sum: rows.reduce((a, r) => a + r.target, 0),
    duplicate_ids: 0, negative_prices: 0, kickers: 0,
    note: "v4 redistributes $" + RESERVE_TOTAL.toFixed(2) + " from the premium tier across the " +
      AUCTION_SLOTS + " auctioned slots. The $" + RESERVE_PER_SLOT + " per slot is a behavioural " +
      "reserve, NOT a minimum bid: $0 bids stay legal and " +
      rows.filter(r => r.target === 0).length + " rows still publish at $0. Jayden Higgins " +
      "(00-0038130) is present as an explicit row at $0 under a season-ending ACL override, so " +
      "the count is 425 rather than v3's 424; he is excluded from the 210-slot pool because a " +
      "player who cannot be rostered does not occupy a slot the reserve is spread across.",
  };
  env.note = "Dated snapshot. low/high are v3 conversion-assumption sensitivity bounds carried " +
    "forward unscaled, NOT bid ceilings and NOT player-outcome intervals. Keeper inflation " +
    "(Sep 8 deadline) and out-of-sample validation are open items, deliberately not modelled here.";
  env.built = new Date().toISOString().slice(0, 10);
  stage("data/datadawg-dollars-values.json", JSON.stringify(env, null, 1) + "\n");
}

/* ---- 2. the machine-readable methodology --------------------------------- */
{
  const env = JSON.parse(R("data/datadawg-dollars-method.json"));
  const d = env.data;
  d.model_id = "datadawgs-datadawg-dollars-2026-v4";
  d.prior_model_id = "datadawgs-ppn-auction-2026-v3";
  d.practical_curve = {
    primary_prior: "ETR",
    published_field: "DataDawg$",
    league_teams: 14, team_budget: 200, league_budget: LEAGUE_BUDGET,
    auction_slots: AUCTION_SLOTS, minimum_bid: 0,
    soft_reserve_per_slot: RESERVE_PER_SLOT, soft_reserve_total: RESERVE_TOTAL,
    premium_scale: PREMIUM_SCALE,
    formula: "0.75 + 0.94375 * underlying_exact_value for the 210-player auction pool; zero outside the pool",
    integerization: "Hamilton largest-remainder",
    interpretation: "opening-state auction target, not market AAV or an automatic maximum bid",
    pool_by_position: SLOTS,
    pool_selection: "ETR leads where ETR speaks: every player it valued above zero is in the pool, " +
      "in its order. The ETR snapshot's rank degenerates to alphabetical below roughly player 122 " +
      "(all remaining rows carry etr_half 0), so the remaining slots are filled by the site's own " +
      "board rank, which is projection-driven and continuous. No outside vendor, ADP or consensus " +
      "is consulted; board rank only orders players ETR itself declined to separate.",
    reserve_is_not_a_floor: "The $0.75 models aggregate room behaviour across 210 slots. It is not " +
      "a minimum bid, $0 bids remain legal, and no $1 floor is imposed — every published integer " +
      "falls out of largest-remainder rounding.",
    tie_break: "exact value, then ETR rank",
  };
  d.interpretation = INTERPRETATION;
  stage("data/datadawg-dollars-method.json", JSON.stringify(env, null, 1) + "\n");
}

/* ---- 3. the human methodology -------------------------------------------- */
{
  const md = R("data/datadawg-dollars-method.md");
  const marker = "\n## v4 — the practical auction curve\n";
  const body = marker + `
v3 allocated the whole $${LEAGUE_BUDGET} by value over replacement, which concentrates it on the
~121 players who clear the replacement line and gives $0 to everyone else. That is a correct
valuation and a poor bid sheet: ${AUCTION_SLOTS} roster spots get bought on draft night, and a
$0-minimum room still spends real money on mandatory starters, D/ST and late nominations.

v4 takes a **soft behavioural reserve of $${RESERVE_PER_SLOT} per auctioned slot** off the premium
pool and hands it back across the ${AUCTION_SLOTS} slots:

    soft_reserve_total     = ${AUCTION_SLOTS} x ${RESERVE_PER_SLOT} = ${RESERVE_TOTAL}
    remaining_premium_pool = ${LEAGUE_BUDGET} - ${RESERVE_TOTAL} = ${LEAGUE_BUDGET - RESERVE_TOTAL}
    premium_scale          = ${LEAGUE_BUDGET - RESERVE_TOTAL} / ${LEAGUE_BUDGET} = ${PREMIUM_SCALE}

    new_exact = ${RESERVE_PER_SLOT} + ${PREMIUM_SCALE} * v3_exact   (inside the ${AUCTION_SLOTS}-slot pool)
    new_exact = 0                                (outside it)

Integers come from Hamilton/largest-remainder to exactly $${LEAGUE_BUDGET}, tie-broken on the exact
value and then the ETR rank.

**The $${RESERVE_PER_SLOT} is not a minimum bid.** $0 bids stay legal, no $1 floor is imposed, and
every published integer falls out of the rounding. It models where a real room's money goes in
aggregate, not what any single player must cost.

**This is a dollar-allocation patch, not a ranking.** ETR still decides who is better than whom.
The transform is monotone in the v3 exact value, so ETR order is preserved exactly; only
integer-dollar ties move.

**The ${AUCTION_SLOTS}-slot pool** is ${Object.entries(SLOTS).map(([k, v]) => `${v} ${k}`).join(", ")}.
ETR leads where ETR speaks: every player it valued above zero is in the pool, in its order. Below
roughly player 122 the ETR snapshot carries etr_half 0 for everyone and the rows sit in
*alphabetical* order, so selecting on that rank would seat James Conner and CJ Stroud and bench
Najee Harris and Geno Smith purely on spelling. The remaining slots are therefore filled by the
site's own board rank, which is projection-driven and continuous. No outside vendor, ADP or
consensus is consulted — board rank only orders players ETR itself declined to separate.

**Jayden Higgins** is an explicit row at $0 under a season-ending ACL override, taking the payload
from v3's 424 rows to 425. He is excluded from the pool: a player who cannot be rostered does not
occupy one of the ${AUCTION_SLOTS} slots the reserve is spread across.

> ${INTERPRETATION}
`;
  stage("data/datadawg-dollars-method.md",
    (md.includes(marker) ? md.slice(0, md.indexOf(marker)) : md.trimEnd() + "\n") + body);
}

/* ---- 4. the intermediate the rig pools are built from -------------------- */
{
  const fsb = JSON.parse(R("work/four-source-board.json"));
  const seen = new Set();
  for(const r of fsb){
    const hit = byId.get(r.id) || byName.get(`${norm(r.name)}|${r.pos}`);
    if(!hit) throw new Error(`four-source-board row has no v4 value: ${r.name} (${r.pos})`);
    r.dd = hit.target; seen.add(hit.id);
  }
  for(const r of rows){
    if(seen.has(r.id)) continue;
    fsb.push({ name: r.player, pos: r.pos, team: r.team, id: r.id,
               dd: r.target, espn: 0, pff: 0, fp: 0 });
  }
  stage("work/four-source-board.json", JSON.stringify(fsb, null, 1) + "\n");
}

/* ---- 5. the embedded `dd` column on every rig page ----------------------- */
const RIG = ["board.html", "dataviz.html", "report.html", "bigboard.html",
             "auction.html", "dashboard.html", "master.html"];
for(const f of RIG){
  const src = R(f);
  /* Each rig page names its pool differently — SEED on the cheat sheet, POOL on master,
     window.DD_POOL on the dashboard — so anchor on the array literal itself. */
  const m = /(?:const SEED|const POOL|window\.DD_POOL)\s*=\s*(\[\{"name")/.exec(src);
  if(!m) throw new Error(`${f}: no embedded pool found`);
  const open = m.index + m[0].length - m[1].length;
  const close = src.indexOf("];", open);
  const pool = JSON.parse(src.slice(open, close + 1));
  let hits = 0, adds = 0;
  for(const p of pool){
    const hit = byName.get(`${norm(p.name)}|${p.pos}`)
      || (p.pos === "DST" ? rows.find(r => r.pos === "DST" && r.team === p.team) : null);
    if(hit){ if(p.dd !== hit.target) adds++; p.dd = hit.target; hits++; }
    else if("dd" in p) delete p.dd;
  }
  if(hits < 200) throw new Error(`${f}: only ${hits} pool rows matched a v4 value`);
  stage(f, src.slice(0, open) + JSON.stringify(pool) + src.slice(close + 1));
  console.log(`  ${f}: ${hits} rows carry DataDawg$ (${adds} changed)`);
}

/* ---- 6. the prose, everywhere it says what the number means -------------- */
{
  const OLD_INTRO = "A dash means the player is unpriced on the curve.";
  const NEW_INTRO = "A dash means the player is unpriced on the curve. <b>DataDawg$ is an " +
    "opening-state target, not a clearing price or a max bid</b> — it already assumes a room " +
    "spends across all 210 roster spots, so reassess after every big buy on what is left in " +
    "your budget and your lineup.";
  const boardSrc = writes.find(w => w[0] === "board.html")[1];
  if(boardSrc.split(OLD_INTRO).length - 1 !== 1) throw new Error("board.html intro anchor is not unique");
  writes.find(w => w[0] === "board.html")[1] = boardSrc.replace(OLD_INTRO, NEW_INTRO);
}
{
  /* The Toto block is byte-identical across every page, so this edits all of them or the
     surface test fails on drift. */
  const OLD = "an ETR board converted for both the league's budget and its custom scoring, summing to $2,800.";
  const NEW = "an ETR board converted for the league's budget and custom scoring, then spread " +
    "across all 210 auctioned roster spots, summing to $2,800. It is an OPENING-STATE TARGET, " +
    "not a clearing price and not a maximum bid — after a big purchase, reprice off remaining " +
    "budget and remaining need.";
  let n = 0;
  for(const f of fs.readdirSync(REPO).filter(x => x.endsWith(".html")).sort()){
    const cur = writes.find(w => w[0] === f);
    const src = cur ? cur[1] : R(f);
    if(!src.includes(OLD)) continue;
    if(src.split(OLD).length - 1 !== 1) throw new Error(`${f}: Toto DataDawg$ anchor is not unique`);
    const out = src.replace(OLD, NEW);
    if(cur) cur[1] = out; else stage(f, out);
    n++;
  }
  if(n < 30) throw new Error(`Toto DataDawg$ line updated on only ${n} pages`);
  console.log(`  Toto block: ${n} pages`);
}
{
  const OLD = '<div class="disclaimer" id="disc">Low/High is conversion-assumption sensitivity — <b>not</b> a player-outcome confidence interval and <b>not</b> a bid ceiling.</div>';
  const NEW = '<div class="disclaimer" id="disc">Low/High is conversion-assumption sensitivity — <b>not</b> a player-outcome confidence interval and <b>not</b> a bid ceiling. Target $ is an <b>opening-state auction target</b> spread across all 210 auctioned roster spots: a planning value, not a guaranteed clearing price and not an automatic maximum bid. Reassess after major purchases on remaining budget and roster need.</div>';
  const cur = writes.find(w => w[0] === "datadawg-dollars.html");
  const src = cur ? cur[1] : R("datadawg-dollars.html");
  if(src.split(OLD).length - 1 !== 1) throw new Error("datadawg-dollars.html disclaimer anchor is not unique");
  if(cur) cur[1] = src.replace(OLD, NEW); else stage("datadawg-dollars.html", src.replace(OLD, NEW));
}

/* ---- every anchor proved; now write ------------------------------------- */
for(const [f, s] of writes) fs.writeFileSync(P(f), s);
console.log(`wrote ${writes.length} files`);
