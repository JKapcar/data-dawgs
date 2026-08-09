"""
CEP-5A Stage 1b — Receipts absorbs the DawgHouse evidence.

The model scoreboard moves to receipts.html as its own sheet, hash #models — NOT onto
the existing #scoreboard sheet, which is the FORECAST GRADING scoreboard. Landing one on
the other conflates "did our forecasts grade well" with "what do the models believe",
the exact boundary CEP-5A exists to enforce. Provenance moves as #provenance. The
`method` sheet becomes `receipts` (label "Receipts & Method", hash #receipts, always
last) with #method hash forwarding. dawghouse.html keeps calculators, the shelf, the
CFB roadmap and the machine box; old #scoreboard/#provenance deep links forward.

Same discipline as 1a: exact expected count per replacement, nothing written unless
every file agrees. Run from the repo root.
"""
import glob
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Sitewide nav sweep (21 pages): the DawgHouse group stops advertising a scoreboard
# it no longer holds, and Provenance follows the content to Receipts.
SWEEP = [
    ('["dawghouse.html","Tools & Scoreboard","pound","hot"],',
     '["dawghouse.html","Workbench","pound","hot"],', 1),
    ('["dawghouse.html#provenance","Provenance","pound-provenance"],',
     '["receipts.html#provenance","Provenance","pound-provenance"],', 1),
    ("The DawgHouse now has a shelf: scoreboard, deterministic calculators, inventory and\n"
     "     provenance. Keep this group identical on every page; the flattened HTML is the source. */",
     "The DawgHouse holds the calculators, the shelf and the CFB roadmap; the model\n"
     "     scoreboard and provenance moved to Receipts (CEP-5A 1b, 2026-08-09). Keep this\n"
     "     group identical on every page; the flattened HTML is the source. */", 1),
]
NAV_PAGES = sorted(
    f for f in glob.glob(str(ROOT / "*.html"))
    if pathlib.Path(f).name not in ("draft-leagues.html", "survivor-settings.html", "pound.html")
)

# ---------------------------------------------------------------------------
# dawghouse.html — sections leave, deep links forward.
SCOREBOARD_SECTION = pathlib.Path("/tmp/scoreboard-section.txt").read_text()
PROVENANCE_SECTION = pathlib.Path("/tmp/provenance-section.txt").read_text()
LOAD_SCOREBOARD = pathlib.Path("/tmp/loadScoreboard.txt").read_text()
LOAD_PROVENANCE = pathlib.Path("/tmp/loadProvenance.txt").read_text()

DAWGHOUSE_EDITS = [
    ("<title>The DawgHouse · Data Dawgs</title>",
     "<title>The DawgHouse · Data Dawgs</title>\n"
     "<script>/* CEP-5A 1b: the model scoreboard and provenance render in Receipts now.\n"
     "     Old deep links (and pound.html's stub, which passes its hash through) follow\n"
     "     the content instead of landing on a section that no longer exists. */\n"
     '(function(){var h=location.hash;\n'
     'if(h==="#scoreboard")location.replace("receipts.html#models");\n'
     'else if(h==="#provenance")location.replace("receipts.html#provenance");})();</script>', 1),
    ('<p class="p-lead">A transparent model scoreboard and a set of deterministic football calculators. '
     'Useful now; still earning their collar. Missing data, licensing limits and ungraded claims stay visible.</p>',
     '<p class="p-lead">Deterministic football calculators, the shelf of blocked work and the College '
     'Football roadmap. Useful now; still earning their collar. Missing data, licensing limits and '
     'ungraded claims stay visible. The model scoreboard and upstream provenance live in '
     '<a href="receipts.html#models">Receipts</a> as of 2026-08-09.</p>', 1),
    ('<a href="#scoreboard">Scoreboard</a><a href="#calculators">Calculators</a>'
     '<a href="#inventory">The shelf</a><a href="#cfb">CFB roadmap</a>'
     '<a href="#provenance">Provenance</a><a href="#machines">For machines</a>',
     '<a href="#calculators">Calculators</a><a href="#inventory">The shelf</a>'
     '<a href="#cfb">CFB roadmap</a><a href="#machines">For machines</a>'
     '<a href="receipts.html#models">Scoreboard &rarr;</a><a href="receipts.html#provenance">Provenance &rarr;</a>', 1),
    (SCOREBOARD_SECTION + "\n\n", "", 1),
    ("\n" + PROVENANCE_SECTION, "", 1),
    ('<header><div><h2>The same evidence for machines</h2><p class="dek">Assistants should read '
     'deterministic state, not scrape the cards above.</p></div></header>',
     '<header><div><h2>The same evidence for machines</h2><p class="dek">Assistants should read '
     'deterministic state, not scrape the cards above. The model scoreboard and upstream provenance '
     'render in Receipts as of 2026-08-09; the data files below did not move.</p></div></header>', 1),
    (LOAD_SCOREBOARD, "  ", 1),
    (LOAD_PROVENANCE, "  ", 1),
    ("\n  loadScoreboard();loadInventory();loadProvenance();", "\n  loadInventory();", 1),
]

# ---------------------------------------------------------------------------
# receipts.html — CSS, two sheet panels, loaders, DDSheets config.
RECEIPTS_CSS = """
/* ---- CEP-5A 1b: the DawgHouse evidence (models sheet + provenance sheet) ----
   Brought with the content from dawghouse.html. The p- prefix does not collide here;
   rules are scoped under the two sheet panels so they cannot leak into the cards. */
#sheetModels .p-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0}
#sheetModels .p-stat{border:1px solid var(--border);background:var(--surface-1);border-radius:10px;padding:13px}
#sheetModels .p-stat b{display:block;font-size:25px;line-height:1;color:var(--ink-1)}
#sheetModels .p-stat span{display:block;color:var(--ink-3);font:650 11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;margin-top:6px;text-transform:uppercase}
#sheetModels .p-table-wrap{overflow:auto;border:1px solid var(--border);border-radius:11px;background:var(--surface-1)}
#sheetModels .p-table{width:100%;border-collapse:collapse;min-width:820px;font-variant-numeric:tabular-nums}
#sheetModels .p-table th{position:sticky;top:0;background:var(--surface-1);color:var(--ink-3);font:750 10.5px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;letter-spacing:.04em;text-align:right;padding:10px;border-bottom:1px solid var(--grid)}
#sheetModels .p-table th:first-child,#sheetModels .p-table td:first-child{text-align:left}
#sheetModels .p-table td{padding:11px 10px;border-bottom:1px solid var(--grid);text-align:right}
#sheetModels .p-table tr:last-child td{border-bottom:0}
#sheetModels .p-table .game{font-weight:800}
#sheetModels .p-table .date{display:block;color:var(--ink-3);font:11px ui-monospace,SFMono-Regular,Consolas,monospace;margin-top:2px}
#sheetModels .p-table .hot{color:var(--warn);font-weight:800}
#sheetModels .p-table .cross{color:var(--bad);font-weight:800}
#sheetModels .p-loading,#sheetProv .p-loading{padding:20px;color:var(--ink-3)}
#sheetModels .p-error,#sheetProv .p-error{padding:20px;color:var(--bad)}
#sheetProv .provenance{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
#sheetProv .prov{border:1px solid var(--border);border-radius:10px;padding:13px;background:var(--surface-1)}
#sheetProv .prov h3{margin:0 0 6px;font-size:15px}
#sheetProv .prov p{margin:4px 0;color:var(--ink-3);font-size:12px}
#sheetProv .prov a{color:var(--accent)}
@media(max-width:760px){#sheetModels .p-summary{grid-template-columns:repeat(2,minmax(0,1fr))}#sheetProv .provenance{grid-template-columns:1fr}}
@media(max-width:430px){#sheetModels .p-summary{grid-template-columns:1fr 1fr}}
"""

RECEIPTS_MARKUP = """
<div id="sheetModels">
  <div class="card">
    <h2>Model scoreboard &mdash; what the models believe</h2>
    <p class="muted" style="margin-top:0">Current Week 1 beliefs, normalized to home win
    probability. The equal-weight mean, range and standard deviation are descriptive &mdash;
    not a validated consensus blend or confidence score. This sheet is what the models
    <em>believe</em>; the Scoreboard sheet is how our pre-registered calls <em>grade</em>.
    Keeping those apart is the point of this page. nfelo locked 2026-08-06 &middot;
    538 Classic locked 2026-08-08 &middot; moved here from The DawgHouse 2026-08-09.</p>
    <div class="p-summary" id="scoreSummary"><div class="p-stat"><b>&mdash;</b><span>games</span></div><div class="p-stat"><b>2</b><span>available beliefs</span></div><div class="p-stat"><b>0</b><span>prospectively graded models</span></div><div class="p-stat"><b>&mdash;</b><span>largest range</span></div></div>
    <div class="p-table-wrap"><div class="p-loading" id="scoreLoad" role="status">Loading the public dated receipts&hellip;</div><table class="p-table" id="scoreTable" aria-label="Week 1 nfelo and 538 Classic belief scoreboard" hidden><thead><tr><th>Game</th><th>nfelo</th><th>538 Classic</th><th>Mean</th><th>Range</th><th>Std dev</th><th>50% split?</th></tr></thead><tbody></tbody></table></div>
    <p class="muted"><b>Important:</b> two models are not independent confirmation and their
    equal-weight mean is not a validated ensemble. nfelo uses market-informed machinery;
    538 Classic deliberately omits QB, injury, weather and market adjustments. SRS, Units,
    WEPA and QB-adjusted columns remain absent until lawful normalized forecasts exist.
    Machine reads: <a href="/data/model-receipts.json"><code>/data/model-receipts.json</code></a>
    &middot; <a href="/data/nfl-schedule.json"><code>/data/nfl-schedule.json</code></a>
    &middot; <code>dd_model_scoreboard</code> over MCP.</p>
  </div>
</div>

<div id="sheetProv">
  <div class="card">
    <h2>Provenance before claims</h2>
    <p class="muted" style="margin-top:0">A public repository is not automatically reusable
    software. Integration mode follows the verified license. Captured 2026-08-07 &middot;
    primary repositories inspected &middot; moved here from The DawgHouse 2026-08-09.
    Machine read: <a href="/data/upstream-models.json"><code>/data/upstream-models.json</code></a>.</p>
    <div class="provenance" id="provGrid"><div class="p-loading">Loading upstream provenance&hellip;</div></div>
  </div>
</div>
"""

RECEIPTS_JS = """
/* ---------- CEP-5A 1b: the DawgHouse evidence, rendered here ----------
   Two lazy sheets. Each loads on first open, not on page load, so a reader landing on
   the grading scoreboard costs zero extra requests.
   ⚠️ mdlBeliefs mirrors beliefSummary in work/pound-core.js (the testable source, also
   inlined in dawghouse.html). work/test-receipts-sheets.mjs asserts the two agree on
   sample inputs, so a drift between the copies goes red instead of unnoticed. */
const mdlEl=id=>document.getElementById(id);
const mdlEsc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const mdlJson=async u=>{const r=await fetch(u,{cache:"no-store"});if(!r.ok)throw new Error(u+" -> HTTP "+r.status);return r.json()};
function mdlBeliefs(values){
  if(!Array.isArray(values)||!values.length)throw new Error("enter at least one probability");
  const xs=values.map(v=>{const n=Number(v);if(!Number.isFinite(n)||n<0||n>1)throw new Error("probability must be between 0 and 1");return n}).sort((a,b)=>a-b);
  const mean=xs.reduce((s,v)=>s+v,0)/xs.length;
  const median=xs.length%2?xs[(xs.length-1)/2]:(xs[xs.length/2-1]+xs[xs.length/2])/2;
  const variance=xs.reduce((s,v)=>s+(v-mean)**2,0)/xs.length;
  return {count:xs.length,mean,median,min:xs[0],max:xs[xs.length-1],range:xs[xs.length-1]-xs[0],
    standard_deviation:Math.sqrt(variance),crosses_50:xs[0]<0.5&&xs[xs.length-1]>0.5};
}
let mdlLoaded=false;
async function loadModels(){
  if(mdlLoaded)return;mdlLoaded=true;
  try{
    const [receiptEnv,scheduleEnv]=await Promise.all([mdlJson("/data/model-receipts.json"),mdlJson("/data/nfl-schedule.json")]);
    const receipts=(receiptEnv.data||[]).filter(r=>r.forecast_status==="prospective"&&r.week===1&&(r.model_id==="nfelo"||r.model_id==="538-classic"));
    const games=(scheduleEnv.data?.games||[]).filter(g=>g.week===1);
    if(!Array.isArray(receipts)||!Array.isArray(games)||!games.length)throw new Error("normalized Week 1 receipts are missing")
    const latest=new Map();
    for(const r of receipts){const key=r.game_id+"|"+r.model_id,prior=latest.get(key);if(!prior||r.captured_at>prior.captured_at)latest.set(key,r)}
    const rows=games.map(g=>{const nf=latest.get(g.game_id+"|nfelo"),classic=latest.get(g.game_id+"|538-classic"),beliefs=[nf?.home_win_probability,classic?.home_win_probability].filter(v=>Number.isFinite(v));const summary=beliefs.length?mdlBeliefs(beliefs):null;return {g,nf,classic,summary};}).sort((x,y)=>(y.summary?.range??-1)-(x.summary?.range??-1));
    const max=rows.reduce((a,r)=>Math.max(a,r.summary?.range||0),0), splits=rows.filter(r=>r.summary?.crosses_50).length, maxBeliefs=rows.reduce((a,r)=>Math.max(a,r.summary?.count||0),0);
    mdlEl("scoreSummary").innerHTML=`<div class="p-stat"><b>${rows.length}</b><span>games</span></div><div class="p-stat"><b>${maxBeliefs}</b><span>max beliefs / game</span></div><div class="p-stat"><b>0</b><span>prospectively graded models</span></div><div class="p-stat"><b>${(max*100).toFixed(1)} pp</b><span>largest range &middot; ${splits} 50% splits</span></div>`;
    mdlEl("scoreTable").querySelector("tbody").innerHTML=rows.map(({g,nf,classic,summary:s})=>`<tr><td><span class="game">${mdlEsc(g.away_team)} @ ${mdlEsc(g.home_team)}</span><span class="date">${mdlEsc(g.kickoff_at.slice(0,10))} &middot; ${mdlEsc(g.game_id)}</span></td><td>${Number.isFinite(nf?.home_win_probability)?pct(nf.home_win_probability):"&mdash;"}</td><td>${Number.isFinite(classic?.home_win_probability)?pct(classic.home_win_probability):"&mdash;"}</td><td><b>${s?pct(s.mean):"&mdash;"}</b></td><td class="${s&&s.range>=.05?"hot":""}">${s?(s.range*100).toFixed(1)+" pp":"&mdash;"}</td><td>${s?(s.standard_deviation*100).toFixed(1)+" pp":"&mdash;"}</td><td class="${s&&s.crosses_50?"cross":""}">${s?(s.crosses_50?"YES":"no"):"&mdash;"}</td></tr>`).join("");
    mdlEl("scoreLoad").hidden=true;mdlEl("scoreTable").hidden=false;
  }catch(err){mdlLoaded=false;mdlEl("scoreLoad").className="p-error";mdlEl("scoreLoad").textContent="Scoreboard unavailable: "+err.message}
}
let provLoaded=false;
async function loadProvenance(){
  if(provLoaded)return;provLoaded=true;
  try{
    const env=await mdlJson("/data/upstream-models.json");
    if(!Array.isArray(env.data))throw new Error("provenance payload is malformed");
    mdlEl("provGrid").innerHTML=env.data.map(x=>`<article class="prov"><h3>${mdlEsc(x.id)}</h3><p><a href="https://github.com/${mdlEsc(x.repository)}" target="_blank" rel="noopener">${mdlEsc(x.repository)}</a></p><p><b>License:</b> ${mdlEsc(x.license||"unverified")} &middot; ${mdlEsc(x.license_status)}</p><p><b>Mode:</b> ${mdlEsc(x.integration_mode)}</p><p>${mdlEsc(x.notes)}</p></article>`).join("")
  }catch(err){provLoaded=false;mdlEl("provGrid").innerHTML='<div class="p-error">Provenance unavailable: '+mdlEsc(err.message)+'</div>'}
}
/* Stale #method deep links follow the sheet to its new id. A stale localStorage id is
   harmless (DDSheets falls back to the first sheet); a stale HASH is not. */
if(location.hash==="#method")history.replaceState(null,"","#receipts");

/* ---------- sheets ---------- */"""

RECEIPTS_EDITS = [
    # CSS before the single closing </style>
    ("\n</style>", RECEIPTS_CSS + "</style>", 1),
    # panels between sheetCalls and sheetMethod
    ('\n<div id="sheetMethod">', RECEIPTS_MARKUP + '\n<div id="sheetMethod">', 1),
    # loaders + forwarding, replacing the sheets banner comment
    ("\n/* ---------- sheets ---------- */", "\n" + RECEIPTS_JS, 1),
    # the DDSheets config itself
    ('DDSheets({key:"receipts",mount:"#sheets",\n'
     '  sheets:[{id:"scoreboard",label:"Scoreboard",panel:"#sheetScore"},\n'
     '          {id:"calls",label:"Calls",panel:"#sheetCalls"},\n'
     '          {id:"method",label:"Method",panel:"#sheetMethod",hint:"pre-registered"}],\n'
     '  onShow(id){ if(id==="scoreboard") drawCal(resolved()); }});',
     'DDSheets({key:"receipts",mount:"#sheets",\n'
     '  /* `receipts` (the method sheet) stays LAST by design; `models` sits beside the\n'
     '     grading scoreboard precisely so nobody mistakes one for the other. */\n'
     '  sheets:[{id:"scoreboard",label:"Scoreboard",panel:"#sheetScore"},\n'
     '          {id:"models",label:"Models",panel:"#sheetModels"},\n'
     '          {id:"calls",label:"Calls",panel:"#sheetCalls"},\n'
     '          {id:"provenance",label:"Provenance",panel:"#sheetProv"},\n'
     '          {id:"receipts",label:"Receipts & Method",panel:"#sheetMethod",hint:"pre-registered"}],\n'
     '  onShow(id){ if(id==="scoreboard") drawCal(resolved()); if(id==="models") loadModels(); if(id==="provenance") loadProvenance(); }});', 1),
]

# ---------------------------------------------------------------------------
# tools/build-data.js — surfaces.json follows the content.
BUILD_DATA_EDITS = [
    ("const MCP_POUND_LIVE = ['dd_model_scoreboard', 'dd_convert_odds', 'dd_devig_market', 'dd_price_parlay',",
     "/* dd_model_scoreboard moved to the receipts surface with the models sheet (CEP-5A 1b). */\n"
     "const MCP_POUND_LIVE = ['dd_convert_odds', 'dd_devig_market', 'dd_price_parlay',", 1),
    ("for (const n of [...MCP_POUND_LIVE, ...MCP_CFB_LIVE])",
     "for (const n of [...MCP_POUND_LIVE, ...MCP_CFB_LIVE, 'dd_model_scoreboard'])", 1),
    ("  { id: 'pound', name: 'The DawgHouse model and calculator workbench (formerly The Pound)', page: '/dawghouse.html',",
     "  { id: 'pound', name: 'The DawgHouse calculator workbench and shelf (formerly The Pound)', page: '/dawghouse.html',", 1),
    # the four scoreboard/provenance data files leave the pound row...
    ("              { kind: 'json', url: '/data/upstream-models.json', status: 'live', covers: 'source, commit and license provenance' },\n"
     "              { kind: 'json', url: '/data/nfl-schedule.json', status: 'live', covers: 'canonical schedule with exact upstream commit and snapshot hash' },\n"
     "              { kind: 'json', url: '/data/model-receipts.json', status: 'live', covers: '544 append-only normalized prospective receipts across nfelo and 538 Classic' },\n"
     "              { kind: 'json', url: '/data/538-classic.json', status: 'live', covers: 'reproduced 538 Classic methodology, 32 target-season ratings and 272 prospective forecasts' },\n"
     "              { kind: 'markdown', url: '/data/538-classic-methodology.md', status: 'live', covers: 'model mathematics, provenance, reproduction tolerance, receipts and limits' },\n",
     "", 1),
    # ...and land on the receipts row, which now renders them
    ("  { id: 'receipts', name: 'Pre-registered forecasts', page: '/receipts.html',\n"
     "    machine: [{ kind: 'json', url: '/data/receipts.json', status: 'live' },",
     "  { id: 'receipts', name: 'Pre-registered forecasts, the model scoreboard and provenance', page: '/receipts.html',\n"
     "    machine: [{ kind: 'json', url: '/data/receipts.json', status: 'live' },\n"
     "              // CEP-5A 1b: the models sheet and provenance sheet render these here now\n"
     "              { kind: 'json', url: '/data/model-receipts.json', status: 'live', covers: '544 append-only normalized prospective receipts across nfelo and 538 Classic — the models sheet' },\n"
     "              { kind: 'json', url: '/data/nfl-schedule.json', status: 'live', covers: 'canonical schedule with exact upstream commit and snapshot hash' },\n"
     "              { kind: 'json', url: '/data/538-classic.json', status: 'live', covers: 'reproduced 538 Classic methodology, 32 target-season ratings and 272 prospective forecasts' },\n"
     "              { kind: 'markdown', url: '/data/538-classic-methodology.md', status: 'live', covers: 'model mathematics, provenance, reproduction tolerance, receipts and limits' },\n"
     "              { kind: 'json', url: '/data/upstream-models.json', status: 'live', covers: 'source, commit and license provenance — the provenance sheet' },\n"
     "              { kind: 'mcp', tool: 'dd_model_scoreboard', status: 'live', covers: 'bounded read-only query over dated prospective receipts; filters and results are not stored' },", 1),
    # the pound row's covers ternary loses its dead scoreboard branch
    ("              ...MCP_POUND_LIVE.map(tool => ({ kind: 'mcp', tool, status: 'live', covers: tool === 'dd_model_scoreboard'\n"
     "                ? 'bounded read-only query over dated prospective receipts; filters and results are not stored'\n"
     "                : 'deterministic calculation over caller-supplied inputs; inputs and results are not stored' })),",
     "              ...MCP_POUND_LIVE.map(tool => ({ kind: 'mcp', tool, status: 'live',\n"
     "                covers: 'deterministic calculation over caller-supplied inputs; inputs and results are not stored' })),", 1),
    ("    gap: 'Two NFL prospective model feeds are live and ungraded. Sixteen bounded CFB tools",
     "    gap: 'The model scoreboard and provenance render on /receipts.html since 2026-08-09; their data files are unchanged. Sixteen bounded CFB tools", 1),
]

LLMS_EDITS = [
    ("- [Workbench](/dawghouse.html): model scoreboard and deterministic calculators.",
     "- [Workbench](/dawghouse.html): deterministic calculators, the shelf of blocked work, CFB roadmap.", 1),
    ("The 10 calculators cover odds, vig, EV, hedging, passer rating, Elo, margin translation\n"
     "and forecast scoring. Inputs are not stored. The scoreboard is descriptive and ungraded.",
     "The 10 calculators cover odds, vig, EV, hedging, passer rating, Elo, margin translation\n"
     "and forecast scoring. Inputs are not stored. The model scoreboard (descriptive, ungraded)\n"
     "and upstream provenance render on /receipts.html since 2026-08-09.", 1),
]

SITEMAP_EDITS = [
    ("<url><loc>https://datadawgs216.com/receipts.html</loc><lastmod>2026-08-08</lastmod></url>",
     "<url><loc>https://datadawgs216.com/receipts.html</loc><lastmod>2026-08-09</lastmod></url>", 0),
]


def apply(text, edits, label):
    for old, new, count in edits:
        n = text.count(old)
        if count == 0:  # optional edit: apply if present once, skip if absent
            if n > 1:
                sys.exit(f"ABORT: {label}: optional edit matched {n} times")
            if n == 0:
                continue
        elif n != count:
            sys.exit(f"ABORT (nothing written): {label}: {n} of expected {count} for\n  {old[:100]!r}")
        text = text.replace(old, new)
    return text


def main():
    staged = {}
    for f in NAV_PAGES:
        p = pathlib.Path(f)
        staged[p] = apply(p.read_text(encoding="utf-8"), SWEEP, p.name)

    dh = ROOT / "dawghouse.html"
    staged[dh] = apply(staged[dh], DAWGHOUSE_EDITS, "dawghouse.html")
    for gone in ('id="scoreboard"', 'id="provenance"', "loadScoreboard", "loadProvenance"):
        if gone in staged[dh]:
            sys.exit(f"ABORT: dawghouse.html still contains {gone}")

    rc = ROOT / "receipts.html"
    staged[rc] = apply(staged[rc], RECEIPTS_EDITS, "receipts.html")

    bd = ROOT / "tools" / "build-data.js"
    staged[bd] = apply(bd.read_text(encoding="utf-8"), BUILD_DATA_EDITS, "build-data.js")

    for name, edits in (("llms.txt", LLMS_EDITS), ("sitemap.xml", SITEMAP_EDITS)):
        p = ROOT / name
        staged[p] = apply(p.read_text(encoding="utf-8"), edits, name)

    for p, s in staged.items():
        p.write_text(s, encoding="utf-8")
    print(f"wrote {len(staged)} files")
    print("now: DD_BUILD_DATE=2026-08-09 node tools/build-data.js && node tools/validate-data.js")


if __name__ == "__main__":
    main()
