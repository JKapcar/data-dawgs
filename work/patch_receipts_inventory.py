#!/usr/bin/env python3
"""Stage RI — Receipts gains an aggregate INVENTORY, and still refuses to score across domains.

The ruling (see memory tiers-ia-subscription): top-level Receipts is an aggregate of every
receipt the site has registered, but there is NO honest single Brier across domains, so the
aggregate is an INVENTORY -- registered / resolved / pending -- and scoring stays per-domain
in the sheets below.

⚠️ THE THING THIS STAGE IS REALLY ABOUT: the ledgers OVERLAP. receipts.json's 272 calls and
model-receipts.json's 272 nfelo rows are the SAME forecasts; 538-classic.json's 272 and
model-receipts.json's 272 538-classic rows are likewise the same. Summing the Registered
column counts NFL forecasts up to three times. The panel therefore derives the naive sum,
prints it, and says out loud that it is wrong -- because an inventory invites a total, and a
reader who adds the column up needs to meet that correction before they trust it.

Nothing is typed. Every number arrives from a fetch, so no count on this page can go stale.
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def patch(relpath, pairs):
    p = ROOT / relpath
    src = p.read_text(encoding="utf-8")
    out = src
    for old, new, count in pairs:
        found = out.count(old)
        if found != count:
            sys.exit(f"ANCHOR FAIL {relpath}: expected {count}x, found {found}x:\n  {old[:110]!r}")
        out = out.replace(old, new)
    p.write_text(out, encoding="utf-8", newline="\n")
    print(f"  patched {relpath}")


# ------------------------------------------------------------------ 1. CSS
patch("receipts.html", [(
    "/* ---- CEP-5A 1b: the DawgHouse evidence (models sheet + provenance sheet) ----",
    """/* ---- Stage RI: the inventory sheet ---------------------------------------
   Scoped under #sheetInv so nothing leaks into the cards, same discipline as
   #sheetModels below. The aggregate row deliberately reuses the .p-stat look so
   an inventory number is visually the same KIND of thing as a grading number --
   it just never carries a score. */
#sheetInv .inv-agg{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0}
#sheetInv .inv-stat{border:1px solid var(--border);background:var(--surface-1);border-radius:10px;padding:13px}
#sheetInv .inv-stat b{display:block;font-size:25px;line-height:1;color:var(--ink-1)}
#sheetInv .inv-stat span{display:block;color:var(--ink-3);font:650 11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;margin-top:6px;text-transform:uppercase}
#sheetInv .inv-wrap{overflow:auto;border:1px solid var(--border);border-radius:11px;background:var(--surface-1)}
#sheetInv table.inv-tbl{width:100%;border-collapse:collapse;font-size:13.5px}
#sheetInv .inv-tbl th,#sheetInv .inv-tbl td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--border);vertical-align:top}
#sheetInv .inv-tbl th{font:800 10.5px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;
  letter-spacing:.07em;text-transform:uppercase;color:var(--ink-3);white-space:nowrap}
#sheetInv .inv-tbl tbody tr:last-child td{border-bottom:0}
#sheetInv .inv-tbl td.inv-n{font:700 14px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;
  text-align:right;white-space:nowrap}
#sheetInv .inv-what{color:var(--ink-3);font-size:12.5px;display:block;margin-top:3px}
#sheetInv .inv-load{padding:16px;color:var(--ink-3);font-size:13px}
#sheetInv .inv-err{color:#d13a00;font-weight:700}
#sheetInv .inv-warn{border-left:3px solid var(--accent);padding:11px 0 11px 13px;margin:16px 0 0}
#sheetInv .inv-aside{border:1px dashed var(--border);border-radius:11px;padding:13px 15px;margin:18px 0 0}
#sheetInv .inv-aside h3{margin:0 0 6px;font-size:14.5px}
@media(max-width:760px){#sheetInv .inv-agg{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:430px){#sheetInv .inv-agg{grid-template-columns:1fr 1fr}}

/* ---- CEP-5A 1b: the DawgHouse evidence (models sheet + provenance sheet) ----""", 1)])

# ------------------------------------------------------- 2. the panel, FIRST
patch("receipts.html", [('<div id="sheetScore">', """<div id="sheetInv">
  <div class="card">
    <h2>Every receipt this site has registered</h2>
    <p class="muted" style="margin-top:0">This is a count, not a grade. It says what has been
    written down and locked, how much of it has been settled, and where each ledger lives so
    you can read it yourself.</p>
    <p class="muted"><b>There is deliberately no single score here.</b> An NFL win
    probability, a college-football forecast and a verdict about whether one of our own tools
    deserves a collar are different kinds of claim with different base rates. A Brier score
    blended across them would look like a grade and mean nothing, so grading stays inside the
    per-domain sheets, next to the assumptions it depends on.</p>

    <div class="inv-agg" id="invAgg">
      <div class="inv-stat"><b id="invForecasts">&mdash;</b><span>forecasts registered</span></div>
      <div class="inv-stat"><b id="invGames">&mdash;</b><span>games covered</span></div>
      <div class="inv-stat"><b id="invResolved">&mdash;</b><span>settled</span></div>
      <div class="inv-stat"><b id="invPending">&mdash;</b><span>awaiting a result</span></div>
    </div>

    <div class="inv-wrap">
      <div class="inv-load" id="invLoad" role="status">Reading the ledgers&hellip;</div>
      <table class="inv-tbl" id="invTable" aria-label="Registered receipts by ledger" hidden>
        <thead><tr><th>Ledger</th><th>Registered</th><th>Settled</th><th>Pending</th><th>Machine read</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>

    <p class="muted inv-warn" id="invOverlap"></p>

    <div class="inv-aside">
      <h3>The tier audit is counted separately, on purpose</h3>
      <p class="muted" style="margin:0" id="invAudit">Loading the audit&hellip;</p>
    </div>

    <p class="muted">Nothing above is graded yet, and that is the correct state: the season
    has not started. A receipt written now is worth something precisely because it cannot be
    edited later. Every number on this sheet is read from the published payloads at page
    load, so none of it can drift from the files.</p>
  </div>
</div>

<div id="sheetScore">""", 1)])

# ------------------------------------------------------------ 3. the loader
patch("receipts.html", [(
    "let auLoaded=false;\nasync function loadAudit(){",
    """let invLoaded=false;
/* Stage RI. Every ledger the site keeps, in one table, with no score column.
   ⚠️ REGISTERED COUNTS OVERLAP ACROSS ROWS -- see the note this builds at the end. */
const INV_LEDGERS=[
  {file:"/data/model-receipts.json",name:"NFL model receipts",sheet:"models",
   what:"Append-only prospective forecasts, one row per model per game. This is the superset the others are views of.",
   rows:e=>e.data},
  {file:"/data/receipts.json",name:"NFL pre-registered calls",sheet:"receipts",
   what:"The locked, SHA-256 hashed nfelo set. Same forecasts as the nfelo half of the ledger above, fixed in place so they cannot be edited after a result.",
   rows:e=>e.data},
  {file:"/data/538-classic.json",name:"538 Classic beliefs",sheet:"classic",
   what:"A deliberately simple Elo benchmark with no QB, injury, weather or market adjustment.",
   rows:e=>(e.data&&e.data.forecasts)||[]},
  {file:"/data/cfb-model-receipts.json",name:"CFB model receipts",sheet:"cfbrec",
   what:"The college-football contract. Empty by design: no CFB forecast has been frozen before a kickoff yet.",
   rows:e=>e.data},
];
/* A row is settled when it carries a result. No payload carries one today, so this
   returns 0 -- but it will start counting the moment grading lands, with no edit here.
   That is why it probes for the field rather than hardcoding a zero. */
const INV_RESOLVED_KEYS=["resolved_at","graded_at","outcome","result","actual","final"];
const invSettled=rows=>rows.filter(r=>r&&typeof r==="object"&&
  INV_RESOLVED_KEYS.some(k=>r[k]!==undefined&&r[k]!==null&&r[k]!=="")).length;
const invNum=n=>n.toLocaleString("en-US");

async function loadInventory(){
  if(invLoaded)return;invLoaded=true;
  try{
    const envs=await Promise.all(INV_LEDGERS.map(l=>mdlJson(l.file)));
    const led=INV_LEDGERS.map((l,i)=>{
      const rows=l.rows(envs[i]);
      if(!Array.isArray(rows))throw new Error(l.file+" did not yield an array of rows");
      const settled=invSettled(rows);
      return {...l,n:rows.length,settled,pending:rows.length-settled,as_of:envs[i].as_of,rows};
    });

    mdlEl("invTable").querySelector("tbody").innerHTML=led.map(l=>
      `<tr><td><b>${mdlEsc(l.name)}</b><span class="inv-what">${mdlEsc(l.what)}</span></td>`+
      `<td class="inv-n">${invNum(l.n)}</td><td class="inv-n">${invNum(l.settled)}</td>`+
      `<td class="inv-n">${invNum(l.pending)}</td>`+
      `<td><a href="#${mdlEsc(l.sheet)}">sheet</a> &middot; `+
      `<a href="${mdlEsc(l.file)}"><code>${mdlEsc(l.file.replace("/data/",""))}</code></a>`+
      `<span class="inv-what">as of ${mdlEsc(l.as_of||"undated")}</span></td></tr>`).join("");
    mdlEl("invLoad").hidden=true;
    mdlEl("invTable").hidden=false;

    /* The two aggregates that are actually true. The superset ledger defines both:
       every distinct forecast is a (model, game) pair in it, and every covered game
       is a distinct game_id in it. Nothing is added across rows. */
    const sup=led[0].rows;
    const forecasts=sup.length;
    const games=new Set(sup.map(r=>r.game_id).filter(Boolean)).size;
    const settled=led.reduce((a,l)=>a+l.settled,0);
    mdlEl("invForecasts").textContent=invNum(forecasts);
    mdlEl("invGames").textContent=invNum(games);
    mdlEl("invResolved").textContent=invNum(settled);
    mdlEl("invPending").textContent=invNum(forecasts-settled);

    /* ⚠️ The correction that makes the table honest. Derived, never typed. */
    const naive=led.reduce((a,l)=>a+l.n,0);
    mdlEl("invOverlap").innerHTML=
      `<b>Do not add the Registered column up.</b> It comes to ${invNum(naive)}, which counts `+
      `the same NFL forecast more than once: the pre-registered calls and the 538 Classic `+
      `beliefs are both views of rows already inside the append-only ledger, not extra `+
      `forecasts alongside it. The honest aggregates are the two on the left &mdash; `+
      `${invNum(forecasts)} distinct forecasts across ${invNum(games)} games &mdash; and they `+
      `are counted from that one superset, never summed across ledgers.`;
  }catch(err){
    invLoaded=false;
    mdlEl("invLoad").className="inv-err";
    mdlEl("invLoad").textContent="Inventory unavailable: "+err.message;
  }
}

/* The audit is a JUDGMENT, not a forecast: one reviewer, one day, no kickoff, and it can
   never be "settled". It gets its own box so its 11 never joins a forecast column. */
let invAuLoaded=false;
async function loadInventoryAudit(){
  if(invAuLoaded)return;invAuLoaded=true;
  try{
    const env=await mdlJson("/data/tier-audit.json");
    const c=env.counts||{};
    mdlEl("invAudit").innerHTML=
      `<b>${invNum((env.data||[]).length)} tools audited</b> on ${mdlEsc(env.as_of||"an undated day")}, `+
      `by one reviewer in one day &mdash; a judgment, not a measurement. `+
      `${invNum(c.dawgs||0)} hold a collar; ${invNum(c.outside_the_tier_system||0)} sit outside the `+
      `tier system entirely. It is counted here and nowhere else on this sheet, because a `+
      `verdict about our own tools is not a forecast and must never share a column with one. `+
      `<a href="#audit">Read the audit</a>.`;
  }catch(err){
    invAuLoaded=false;
    mdlEl("invAudit").className="inv-err";
    mdlEl("invAudit").textContent="Tier audit unavailable: "+err.message;
  }
}
let auLoaded=false;
async function loadAudit(){""", 1)])

# --------------------------------------------------- 4. register the sheet
patch("receipts.html", [
    ('sheets:[{id:"scoreboard",label:"Grading",panel:"#sheetScore"},',
     'sheets:[{id:"inventory",label:"Inventory",panel:"#sheetInv"},\n'
     '          {id:"scoreboard",label:"Grading",panel:"#sheetScore"},', 1),
    ('onShow(id){ if(id==="scoreboard") drawCal(resolved()); if(id==="models") loadModels();',
     'onShow(id){ if(id==="inventory"){ loadInventory(); loadInventoryAudit(); }\n'
     '    if(id==="scoreboard") drawCal(resolved()); if(id==="models") loadModels();', 1),
])

# ------------------------------------------- 5. the tab-order assertion moves
patch("work/test-receipts-sheets.mjs", [
    ('JSON.stringify(models.tabs) === JSON.stringify(["scoreboard", "models", "classic", "cfbrec", "calls", "provenance", "audit", "receipts"]),',
     'JSON.stringify(models.tabs) === JSON.stringify(["inventory", "scoreboard", "models", "classic", "cfbrec", "calls", "provenance", "audit", "receipts"]),', 1),
])

print("done")
