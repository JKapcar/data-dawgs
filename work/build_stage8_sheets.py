#!/usr/bin/env python3
"""CEP-5A Stage 8 — the per-tool Receipts sheets.

Adds three sheets to receipts.html's existing DDSheets family, each rendered lazily
from that tool's OWN /data/ file:

  #classic  538 Classic          <- /data/538-classic.json          BELIEF side
  #cfbrec   CFB Receipts         <- /data/cfb-model-receipts.json    BELIEF side, ZERO rows
  #audit    Tier Audit           <- /data/tier-audit.json            NEITHER side (stated)

THE LINE: `models` is what models BELIEVE, `scoreboard` is how our pre-registered calls
GRADE. `classic` and `cfbrec` are beliefs and say so. `tier-audit` grades our own tools
against a governance gate, not predictions against outcomes -- it lands on NEITHER side,
so the sheet says that out loud rather than splitting the difference.

Nothing is graded. The 2026 season has not started. No sheet may imply a result.

Every anchor is asserted to occur exactly once. Nothing is written unless all pass.
"""
import sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "receipts.html"

s = SRC.read_text(encoding="utf-8")
orig = s
edits = []


def sub(anchor, new, why):
    """Anchored single-occurrence replacement. Function-style: no $-expansion risk."""
    global s
    n = s.count(anchor)
    assert n == 1, f"anchor x{n} (want 1): {why}\n  {anchor[:110]!r}"
    s = s.replace(anchor, new, 1)
    edits.append(why)


# ---------------------------------------------------------------- 1. scoped CSS
# EVERY selector on every line is scoped to a Stage 8 panel. This stylesheet packs
# several rules per line and an unscoped one would leak onto the other five sheets.
CSS_ANCHOR = "@media(max-width:430px){#sheetModels .p-summary{grid-template-columns:1fr 1fr}}"
CSS_NEW = CSS_ANCHOR + """
/* ---- CEP-5A Stage 8 — per-tool sheets ------------------------------------
   #sheetClassic / #sheetCfbRec / #sheetAudit. Every selector below is scoped to
   one of those three; nothing here may reach the other five sheets. */
#sheetClassic .s8-sum,#sheetAudit .s8-sum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0}
#sheetClassic .s8-stat,#sheetCfbRec .s8-stat,#sheetAudit .s8-stat{border:1px solid var(--border);background:var(--surface-1);border-radius:10px;padding:13px}
#sheetClassic .s8-stat b,#sheetCfbRec .s8-stat b,#sheetAudit .s8-stat b{display:block;font-size:25px;line-height:1;color:var(--ink-1)}
#sheetClassic .s8-stat span,#sheetCfbRec .s8-stat span,#sheetAudit .s8-stat span{display:block;color:var(--ink-3);font:650 11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;margin-top:6px;text-transform:uppercase}
#sheetClassic .s8-wrap,#sheetAudit .s8-wrap{overflow:auto;border:1px solid var(--border);border-radius:11px;background:var(--surface-1)}
#sheetClassic .s8-tbl,#sheetAudit .s8-tbl{width:100%;border-collapse:collapse;min-width:min(620px,100%);font-variant-numeric:tabular-nums}
#sheetClassic .s8-tbl th,#sheetAudit .s8-tbl th{position:sticky;top:0;background:var(--surface-1);color:var(--ink-3);font:750 10.5px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;letter-spacing:.04em;padding:10px;text-align:right;border-bottom:1px solid var(--grid)}
#sheetClassic .s8-tbl th:first-child,#sheetAudit .s8-tbl th:first-child,#sheetClassic .s8-tbl td:first-child,#sheetAudit .s8-tbl td:first-child{text-align:left}
#sheetClassic .s8-tbl td,#sheetAudit .s8-tbl td{padding:11px 10px;border-bottom:1px solid var(--grid);text-align:right}
#sheetClassic .s8-tbl tr:last-child td,#sheetAudit .s8-tbl tr:last-child td{border-bottom:0}
#sheetClassic .s8-tbl .game{font-weight:800}
#sheetClassic .s8-tbl .date{display:block;color:var(--ink-3);font:11px ui-monospace,SFMono-Regular,Consolas,monospace;margin-top:2px}
#sheetClassic .s8-load,#sheetCfbRec .s8-load,#sheetAudit .s8-load{padding:20px;color:var(--ink-3)}
#sheetClassic .s8-err,#sheetCfbRec .s8-err,#sheetAudit .s8-err{padding:20px;color:var(--bad)}
#sheetClassic .s8-params,#sheetCfbRec .s8-terms{margin:16px 0 0;padding:0;list-style:none;display:grid;gap:7px}
#sheetClassic .s8-params li,#sheetCfbRec .s8-terms li{color:var(--ink-3);font-size:12.5px;line-height:1.55;padding-left:15px;position:relative}
#sheetClassic .s8-params li::before,#sheetCfbRec .s8-terms li::before{content:"\\203A";position:absolute;left:0;color:var(--accent);font-weight:800}
#sheetCfbRec .s8-zero{border:1px solid var(--border);border-left:3px solid var(--accent);background:color-mix(in srgb,var(--accent) 5%,var(--surface-1));border-radius:11px;padding:20px;margin:18px 0}
#sheetCfbRec .s8-zero b.s8-n{display:block;font-size:52px;line-height:1;color:var(--ink-1);font-variant-numeric:tabular-nums}
#sheetCfbRec .s8-zero .s8-lbl{display:block;color:var(--ink-3);font:750 11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;letter-spacing:.05em;margin-top:8px}
#sheetAudit .s8-verdict{display:inline-block;font:800 10.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;letter-spacing:.05em;border-radius:5px;padding:4px 7px;border:1px solid var(--border);color:var(--ink-2)}
#sheetAudit .s8-verdict.s8-stands{color:var(--good,var(--accent));border-color:color-mix(in srgb,var(--good,var(--accent)) 45%,transparent)}
#sheetAudit .s8-verdict.s8-outside{color:var(--ink-3)}
#sheetAudit .s8-lane{font:700 11px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3);text-transform:uppercase}
#sheetAudit .s8-neither{border:1px solid var(--border);border-left:3px solid var(--warn);background:color-mix(in srgb,var(--warn) 6%,var(--surface-1));border-radius:11px;padding:15px 18px;margin:0 0 18px;font-size:13.5px;line-height:1.62;color:var(--ink-2)}
#sheetAudit .s8-neither b{color:var(--ink-1)}
#sheetAudit .s8-owed{display:block;color:var(--ink-3);font-size:11.5px;line-height:1.5;margin-top:5px}
@media(max-width:760px){#sheetClassic .s8-sum,#sheetAudit .s8-sum{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:430px){#sheetClassic .s8-sum,#sheetAudit .s8-sum{grid-template-columns:1fr 1fr}#sheetCfbRec .s8-zero b.s8-n{font-size:42px}}"""
sub(CSS_ANCHOR, CSS_NEW, "scoped Stage 8 CSS")


# ------------------------------------------------------- 2. the three panels
PANELS = """<div id="sheetClassic">
  <div class="card">
    <h2>538 Classic &mdash; what a deliberately simple benchmark believes</h2>
    <p class="muted" style="margin-top:0">This sheet is a <em>belief</em>, on the same side of
    the line as Models. It is not a grade: none of these forecasts has been scored, because
    the 2026 season has not started. 538 Classic is the original FiveThirtyEight Elo
    mathematics with no QB, injury, weather or market adjustment &mdash; a permanent simple
    benchmark to beat, not a claim that it is any good. Rendered from its own file when you
    open this sheet.</p>
    <div class="s8-sum" id="clSum"><div class="s8-stat"><b>&mdash;</b><span>forecasts</span></div><div class="s8-stat"><b>&mdash;</b><span>teams rated</span></div><div class="s8-stat"><b>&mdash;</b><span>weeks covered</span></div><div class="s8-stat"><b>0</b><span>graded</span></div></div>
    <div class="s8-wrap"><div class="s8-load" id="clLoad" role="status">Loading 538 Classic beliefs&hellip;</div><table class="s8-tbl" id="clTable" aria-label="538 Classic Week 1 home win probabilities" hidden><thead><tr><th>Game</th><th>Home Elo</th><th>Away Elo</th><th>Home win p</th></tr></thead><tbody></tbody></table></div>
    <p class="muted" id="clValid">&nbsp;</p>
    <ul class="s8-params" id="clParams"></ul>
    <p class="muted"><b>What the reproduction check does and does not say.</b> It says our
    implementation reproduces the published 538 mathematics. It says nothing about whether
    those mathematics predict 2026 well; the file sets
    <code>independent_skill_claim: false</code> for exactly that reason. Machine read:
    <a href="/data/538-classic.json"><code>/data/538-classic.json</code></a>.</p>
  </div>
</div>

<div id="sheetCfbRec">
  <div class="card">
    <h2>CFB receipts &mdash; the contract, and nothing in it yet</h2>
    <p class="muted" style="margin-top:0">A <em>belief</em> ledger, on the Models side of the
    line: it is where college-football forecasts get frozen before kickoff so they can be
    graded later. It is empty. That is the honest state, not a loading failure &mdash; no CFB
    forecast has been frozen before a kickoff yet, and back-filling the completed 2025 season
    would be inventing a receipt nobody wrote.</p>
    <div class="s8-zero" id="cfrZero"><b class="s8-n" id="cfrCount">&mdash;</b><span class="s8-lbl" id="cfrLbl">rows in the ledger</span><p class="muted" id="cfrNote" style="margin:12px 0 0">Loading the CFB receipt contract&hellip;</p></div>
    <ul class="s8-terms" id="cfrTerms"></ul>
    <p class="muted">The CFB work that <em>does</em> have published numbers lives on the
    <a href="cfb.html">CFB Lab</a>; none of it is a pre-registered receipt, which is the
    distinction this sheet exists to hold. Machine read:
    <a href="/data/cfb-model-receipts.json"><code>/data/cfb-model-receipts.json</code></a>.</p>
  </div>
</div>

<div id="sheetAudit">
  <div class="card">
    <h2>Tier audit &mdash; our own tools, against our own gate</h2>
    <div class="s8-neither"><b>This sheet sits on neither side of the line.</b> Models is what
    models believe; Scoreboard is how our pre-registered calls grade. This is neither: it is a
    judgment about whether each of our tools deserves the tier it claims, reasoned from the
    code and the published data by <b>one reviewer in one day</b>. It grades tools against a
    governance gate, not predictions against outcomes. It is published rather than held
    precisely because that single-reviewer weakness is the thing most worth disclosing.</div>
    <p class="muted" style="margin-top:0" id="auGate">&nbsp;</p>
    <div class="s8-sum" id="auSum"><div class="s8-stat"><b>&mdash;</b><span>audited</span></div><div class="s8-stat"><b>&mdash;</b><span>promotions</span></div><div class="s8-stat"><b>&mdash;</b><span>demotions</span></div><div class="s8-stat"><b>&mdash;</b><span>in the pound</span></div></div>
    <p class="muted" id="auHead">&nbsp;</p>
    <div class="s8-wrap"><div class="s8-load" id="auLoad" role="status">Loading the tier audit&hellip;</div><table class="s8-tbl" id="auTable" aria-label="Tier audit verdicts by tool" hidden><thead><tr><th>Tool</th><th>Lane</th><th>Verdict</th></tr></thead><tbody></tbody></table></div>
    <p class="muted">Machine read: <a href="/data/tier-audit.json"><code>/data/tier-audit.json</code></a>
    &middot; the gate itself is on <a href="index.html#tiers">the homepage</a>.</p>
  </div>
</div>

<div id="sheetMethod">"""
sub('<div id="sheetMethod">', PANELS, "three Stage 8 panels")


# ------------------------------------------------------------ 3. the loaders
LOADERS = """/* ---------- CEP-5A Stage 8 — per-tool sheets, each from its own file ----------
   Lazily loaded, driven by the sheet bar's onShow and NOTHING else. There is no
   viewport test here on purpose: a hidden panel's rect is 0x0 AT THE DOCUMENT
   ORIGIN, so every "is it near the viewport" helper reads TRUE for it and fires on
   load — which is exactly how cfb.html's lazy loader silently stopped being lazy.
   Opening a sheet IS the visibility event. */
let clLoaded=false;
async function loadClassic(){
  if(clLoaded)return;clLoaded=true;
  try{
    const env=await mdlJson("/data/538-classic.json");
    const d=env.data||{},fc=d.forecasts||[],teams=d.teams||[];
    if(!Array.isArray(fc)||!fc.length)throw new Error("538 Classic forecasts are missing");
    const weeks=new Set(fc.map(f=>f.week)).size;
    mdlEl("clSum").innerHTML=`<div class="s8-stat"><b>${fc.length}</b><span>forecasts</span></div>`
      +`<div class="s8-stat"><b>${teams.length}</b><span>teams rated</span></div>`
      +`<div class="s8-stat"><b>${weeks}</b><span>weeks covered</span></div>`
      +`<div class="s8-stat"><b>${env.graded?"&mdash;":0}</b><span>graded</span></div>`;
    const wk1=fc.filter(f=>f.week===1).sort((a,b)=>a.game_id<b.game_id?-1:1);
    mdlEl("clTable").querySelector("tbody").innerHTML=wk1.map(f=>
      `<tr><td><span class="game">${mdlEsc(f.away_team)} @ ${mdlEsc(f.home_team)}</span>`
      +`<span class="date">${mdlEsc(String(f.kickoff_at).slice(0,10))} &middot; ${mdlEsc(f.game_id)}</span></td>`
      +`<td>${f.home_elo.toFixed(1)}</td><td>${f.away_elo.toFixed(1)}</td>`
      +`<td>${(f.home_win_probability*100).toFixed(1)}%</td></tr>`).join("");
    const v=env.validation||{};
    mdlEl("clValid").innerHTML=`Week 1 shown (${wk1.length} games); the file carries all `
      +`${fc.length}. Reproduction check: <b>${mdlEsc(v.status||"unstated")}</b> against `
      +`${Number(v.official_probabilities_compared||0).toLocaleString()} official probabilities, `
      +`max absolute error ${Number(v.max_absolute_probability_error||0).toExponential(2)}. `
      +`Snapshot <code>${mdlEsc(String((env.integrity||{}).snapshot_id||"").slice(0,14))}&hellip;</code> &middot; as of ${mdlEsc(env.as_of)}.`;
    const m=env.methodology||{};
    mdlEl("clParams").innerHTML=[["Home-field Elo",m.home_field_elo],["K factor",m.k_factor],
      ["Offseason reversion",typeof m.offseason_reversion==="number"?m.offseason_reversion.toFixed(4):m.offseason_reversion],
      ["Reversion baseline",m.reversion_baseline]]
      .filter(([,val])=>val!==undefined&&val!==null)
      .map(([k,val])=>`<li><b>${mdlEsc(k)}:</b> <code>${mdlEsc(val)}</code></li>`).join("");
    mdlEl("clLoad").hidden=true;mdlEl("clTable").hidden=false;
  }catch(err){clLoaded=false;mdlEl("clLoad").className="s8-err";mdlEl("clLoad").textContent="538 Classic unavailable: "+err.message}
}
let cfrLoaded=false;
async function loadCfbReceipts(){
  if(cfrLoaded)return;cfrLoaded=true;
  try{
    const env=await mdlJson("/data/cfb-model-receipts.json");
    const rows=env.data;
    if(!Array.isArray(rows))throw new Error("the CFB receipt ledger is not an array");
    /* A zero-row file must render a STATED zero. An empty table reads as "nothing
       happened yet"; the count reads as "we looked, and the answer is none". */
    mdlEl("cfrCount").textContent=String(rows.length);
    mdlEl("cfrLbl").textContent=rows.length===1?"row in the ledger":"rows in the ledger";
    mdlEl("cfrNote").textContent=env.note||"";
    const c=env.contract||{};
    mdlEl("cfrTerms").innerHTML=[["Forecast status",c.forecast_status],["Immutability",c.immutability],
      ["Grading",c.grading],["Required input snapshots",(c.required_input_snapshots||[]).join(", ")],
      ["Schema version",c.schema_version]]
      .filter(([,val])=>val!==undefined&&val!==null&&val!=="")
      .map(([k,val])=>`<li><b>${mdlEsc(k)}:</b> ${mdlEsc(val)}</li>`).join("");
  }catch(err){cfrLoaded=false;mdlEl("cfrNote").className="s8-err";mdlEl("cfrNote").textContent="CFB receipt contract unavailable: "+err.message}
}
let auLoaded=false;
async function loadAudit(){
  if(auLoaded)return;auLoaded=true;
  try{
    const env=await mdlJson("/data/tier-audit.json");
    const rows=env.data||[],c=env.counts||{};
    if(!Array.isArray(rows)||!rows.length)throw new Error("the tier audit has no rows");
    mdlEl("auGate").innerHTML=`<b>The gate:</b> ${mdlEsc(env.gate||"")} Audited ${mdlEsc(env.as_of)}.`;
    mdlEl("auSum").innerHTML=`<div class="s8-stat"><b>${c.audited}</b><span>audited</span></div>`
      +`<div class="s8-stat"><b>${c.promotions_recommended}</b><span>promotions</span></div>`
      +`<div class="s8-stat"><b>${c.demotions_recommended}</b><span>demotions</span></div>`
      +`<div class="s8-stat"><b>${c.pound}</b><span>in the pound</span></div>`;
    mdlEl("auHead").innerHTML=`<b>Headline finding.</b> ${mdlEsc(env.headline_finding||"")}`;
    const wwc=env.what_would_change_our_mind||{};
    mdlEl("auTable").querySelector("tbody").innerHTML=rows.map(r=>{
      const cls=r.verdict==="stands"?"s8-stands":r.verdict==="outside"?"s8-outside":"";
      const owed=r.owed||wwc[r.id];
      return `<tr><td><a href="${mdlEsc(r.page)}">${mdlEsc(r.name)}</a>`
        +(owed?`<span class="s8-owed">${mdlEsc(owed)}</span>`:"")+`</td>`
        +`<td><span class="s8-lane">${mdlEsc(r.lane)}</span></td>`
        +`<td><span class="s8-verdict ${cls}">${mdlEsc(r.verdict)}</span></td></tr>`;}).join("");
    mdlEl("auLoad").hidden=true;mdlEl("auTable").hidden=false;
  }catch(err){auLoaded=false;mdlEl("auLoad").className="s8-err";mdlEl("auLoad").textContent="Tier audit unavailable: "+err.message}
}
/* Stale #method deep links follow the sheet to its new id."""
sub("/* Stale #method deep links follow the sheet to its new id.", LOADERS,
    "three Stage 8 lazy loaders")


# ------------------------------------------- 4. hash forwarding on hashchange too
# ⚠️ A hash-only navigation does NOT reload the document, so a forward that only runs
# at load never fires for a same-page link or the back button. Register BEFORE
# DDSheets so DDSheets' own hashchange handler reads the corrected value.
FWD_OLD = 'if(location.hash==="#method")history.replaceState(null,"","#receipts");'
FWD_NEW = ('(function(){function s8fwd(){if(location.hash==="#method")'
           'history.replaceState(null,"","#receipts");}s8fwd();'
           'addEventListener("hashchange",s8fwd);})();')
sub(FWD_OLD, FWD_NEW, "#method forward also runs on hashchange")


# --------------------------------------------------- 5. register the sheets
SHEETS_OLD = '{id:"provenance",label:"Provenance",panel:"#sheetProv"},'
SHEETS_NEW = ('{id:"provenance",label:"Provenance",panel:"#sheetProv"},\n'
              '          {id:"audit",label:"Tier Audit",panel:"#sheetAudit"},')
sub(SHEETS_OLD, SHEETS_NEW, "audit sheet registered before receipts")

MODELS_OLD = '{id:"models",label:"Models",panel:"#sheetModels"},'
MODELS_NEW = ('{id:"models",label:"Models",panel:"#sheetModels"},\n'
              '          {id:"classic",label:"538 Classic",panel:"#sheetClassic"},\n'
              '          {id:"cfbrec",label:"CFB Receipts",panel:"#sheetCfbRec"},')
sub(MODELS_OLD, MODELS_NEW, "belief sheets registered beside models")

ONSHOW_OLD = ('onShow(id){ if(id==="scoreboard") drawCal(resolved()); if(id==="models") '
              'loadModels(); if(id==="provenance") loadProvenance(); }});')
ONSHOW_NEW = ('onShow(id){ if(id==="scoreboard") drawCal(resolved()); if(id==="models") '
              'loadModels(); if(id==="provenance") loadProvenance();\n'
              '    if(id==="classic") loadClassic(); if(id==="cfbrec") loadCfbReceipts(); '
              'if(id==="audit") loadAudit(); }});')
sub(ONSHOW_OLD, ONSHOW_NEW, "onShow drives all three new loaders")


# ------------------------------------------------------------------ guards
assert s != orig, "nothing changed"
for need in ['id="sheetClassic"', 'id="sheetCfbRec"', 'id="sheetAudit"',
             "function loadClassic", "function loadCfbReceipts", "function loadAudit"]:
    assert s.count(need) == 1, f"post-check failed: {need} x{s.count(need)}"
# the method sheet must still be LAST in the array
assert '{id:"receipts",label:"Receipts & Method",panel:"#sheetMethod",hint:"pre-registered"}]' in s, \
    "the receipts/method sheet stopped being last"
# helpers the loaders depend on must still be there
for need in ["const mdlEl=", "const mdlEsc=", "const mdlJson="]:
    assert need in s, f"helper vanished: {need}"

if "--check" in sys.argv:
    print("all anchors resolve; %d edits; %d -> %d bytes" % (len(edits), len(orig), len(s)))
    sys.exit(0)

SRC.write_text(s, encoding="utf-8")
for e in edits:
    print("  +", e)
print("receipts.html %d -> %d bytes (+%d)" % (len(orig), len(s), len(s) - len(orig)))
