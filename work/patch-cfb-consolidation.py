"""
CEP-5A Stage 3 — the College Football roadmap leaves dawghouse.html for cfb.html,
and cfb.html consolidates into five sheets.

cfb.html becomes a DDSheets page family (the receipts.html pattern, component copied
verbatim): Matchup / Teams / Elo / Divergence / Roadmap. Existing content moves into
panels untouched; old anchors forward (#explorer -> #teams, #expected/#baseline ->
#elo); the nav's cfb.html#matchup deep link is now the Matchup sheet id, so it keeps
working with no sweep. The Roadmap sheet carries the dawghouse #cfb section's markup
and loader verbatim (live/not-live split stays COMPUTED from surfaces.json), with the
one id rename the move forces: the roadmap count is cfbRmCount because cfb.html
already owns #cfbCount. dawghouse.html keeps only the shelf and machine box and
forwards #cfb to cfb.html#roadmap.

Same discipline as 1a/1b/Stage 2: strict extraction, exact expected count per edit,
nothing written unless every file agrees. Run from the repo root at main 538332c.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHIP = "2026-08-09"

dawg = (ROOT / "dawghouse.html").read_text(encoding="utf-8")
cfb = (ROOT / "cfb.html").read_text(encoding="utf-8")
receipts = (ROOT / "receipts.html").read_text(encoding="utf-8")


def between(text, start_marker, end_marker, include_end=True, include_start=True):
    start = text.index(start_marker)
    end = text.index(end_marker, start + len(start_marker))
    if include_end:
        end += len(end_marker)
    if not include_start:
        start += len(start_marker)
    return text[start:end]


def apply(text, edits, label):
    for old, new, n in edits:
        found = text.count(old)
        if found != n:
            raise SystemExit(f"ABORT {label}: expected {n}, found {found}: {old[:90]!r}")
        text = text.replace(old, new)
    return text

# ---------------------------------------------------------------------------
# Extract the travelling pieces from dawghouse.html.

CFB_SECTION = between(dawg, '  <section class="p-section" id="cfb">', "  </section>")
CFBT_BOX = between(CFB_SECTION, '    <div class="cfbt-box" id="cfbTools">', '    <div class="cfb-filters">', include_end=False)
CFB_FILTERS = between(CFB_SECTION, '    <div class="cfb-filters">', "    </div>")
CFB_ASSUMPTION = between(CFB_SECTION, '    <p class="assumption"><b>Ordering:</b>', "</p>")
assert 'id="cfbToolStats"' in CFBT_BOX and 'id="cfbToolsPlanned"' in CFBT_BOX
assert CFBT_BOX.rstrip().endswith("</div>")

MACHINE_LI = between(dawg, '      <li id="cfbMachineTools">', "</li>\n")
GRID_LINE = ('    <p class="cfb-count" id="cfbCount" aria-live="polite"></p>\n'
             '    <div class="inventory" id="cfbGrid"><div class="p-loading">Loading the College Football roadmap…</div></div>\n')
assert GRID_LINE in CFB_SECTION

# The roadmap JS: split-computation + renderers, verbatim.
RM_SPLIT = between(dawg, "  let cfbIdeas=[],cfbSteps=[],liveMcp=new Set();", "  const recLabel=", include_end=False)
RM_RENDER = between(dawg, "  const recLabel=", "  async function loadInventory(){", include_end=False)
assert "cfbToolSplit" in RM_SPLIT and "renderCfbTools" in RM_SPLIT and "renderCfb" in RM_RENDER
OLD_LOADER = between(dawg, "  async function loadInventory(){", "\n  loadInventory();")

# The roadmap CSS rules that travel, scoped under #roadmap so nothing on cfb.html
# (which already owns .cfbt for its tables) can collide.
# Whole stylesheet LINES travel (the file packs several rules per line); every
# selector on each line is scoped under #roadmap.
def scope_line(line):
    def repl(m):
        sel = ",".join("#roadmap " + s.strip() for s in m.group(3).split(","))
        return m.group(1) + m.group(2) + sel + "{"
    return re.sub(r"(^|\})(\s*)([^{}@]+)\{", repl, line)

CSS_RULES = []
for start in [".p-summary{", ".p-stat{", ".p-stat b{", ".p-stat span{",
              ".p-loading,.p-error{", ".field{", ".field input,.field select{",
              ".assumption{", ".p-filter{", ".inventory{", ".tool{", ".status{",
              ".rec-build{", ".lifecycle-chip{", ".cfb-filters{", ".cfb-count{",
              ".cfbt-box{", ".cfbt-box>h3{", ".cfbt-box>p{", ".cfbt-grid{", ".cfbt{",
              ".cfbt code{", ".cfbt span{", ".cfbt-planned{", ".cfbt-planned code{",
              ".tool .meta-line{", ".tool .components{"]:
    i = dawg.index("\n" + start) + 1
    j = dawg.index("\n", i)
    CSS_RULES.append(scope_line(dawg[i:j]))

SHEET_CSS = between(receipts, "/* ---- page-family sheets ---", "/* ---- receipts ---", include_end=False).rstrip() + "\n"
assert ".sheetbar{" in SHEET_CSS and "[role=tabpanel][hidden]{display:none}" in SHEET_CSS

DDSHEETS = between(receipts, "<script>\n/* ============================================================================\n   DDSheets", "</script>")
assert "window.DDSheets = function(cfg)" in DDSHEETS

ROADMAP_CSS = ("\n/* ---- Stage 3: the roadmap sheet, moved from The DawgHouse 2026-08-09.\n"
               "   Rules travel verbatim but scoped under #roadmap: cfb.html already owns .cfbt\n"
               "   (its tables), and an unscoped copy would restyle them. ---- */\n"
               + "\n".join(CSS_RULES) + "\n"
               # ⚠️ The live-tool grid's 268px track minimum is wider than the content box
               # at 320px, so the GRID pushed the document 14px sideways — caught by the
               # per-sheet overflow check. min() lets the track collapse to the column.
               + "#roadmap .cfbt-grid{grid-template-columns:repeat(auto-fill,minmax(min(268px,100%),1fr))}\n"
               + "@media(max-width:760px){#roadmap .p-summary{grid-template-columns:repeat(2,minmax(0,1fr))}#roadmap .inventory{grid-template-columns:1fr}}\n"
               + "@media(max-width:430px){#roadmap .p-summary{grid-template-columns:1fr 1fr}}\n")

# ---------------------------------------------------------------------------
# cfb.html — five sheets.

ROADMAP_MARKUP = '''  <div id="sheetRoadmap">
  <!-- ================= roadmap (moved from The DawgHouse 2026-08-09) ================= -->
  <div class="card" id="roadmap">
    <h3>College Football roadmap <span class="rt">roadmap reconciled 2026-08-08 &middot; moved from The DawgHouse 2026-08-09</span></h3>
    <p class="sub">The complete identified CFB opportunity set &mdash; roadmap ideas, not automatically tools.
    Shipped data and model artifacts carry evidence-backed lifecycle state; every remaining card
    records what we could build, why, what it depends on, and how we would know whether it worked.</p>
    <div class="banner"><b>Map, not territory.</b> Lifecycle and implementation state describe the
    artifact named by a card, not predictive proof. Candidate MCP tool names remain reservations and are
    not callable unless the separate Worker registry says they are live. Recommendations can change, and
    retired ideas move to a Graveyard with their history intact rather than being deleted.</div>
''' + CFBT_BOX.replace('      <p class="cfbt-planned" id="cfbToolsPlanned"></p>\n',
                       '      <p class="cfbt-planned" id="cfbToolsPlanned"></p>\n'
                       '      <p class="cfbt-planned" id="cfbMachineTools"><a href="/data/surfaces.json"><code>/data/surfaces.json</code></a> &mdash; the live Worker tool roster, including the College Football tools above.</p>\n') + CFB_FILTERS + "\n" \
    + GRID_LINE.replace('id="cfbCount"', 'id="cfbRmCount"') \
    + "    " + CFB_ASSUMPTION + "\n  </div>\n  </div>\n"

RM_JS = ("<script>\n"
         "/* ---------------- Stage 3: the roadmap sheet's loader ----------------\n"
         "   Moved from dawghouse.html on 2026-08-09 with the split-computation intact:\n"
         "   the live/not-live tool split is COMPUTED from /data/surfaces.json against the\n"
         "   cards, never typed in. Fail-loud rules unchanged: a missing roster is not\n"
         "   evidence that nothing is live. */\n"
         "(function(){\n"
         "  const $=id=>document.getElementById(id);\n"
         '  const esc=s=>String(s==null?"":s).replace(/[&<>"\']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;","\'":"&#39;"}[c]));\n'
         "  async function json(url){const r=await fetch(url);if(!r.ok)throw new Error(`${url} returned ${r.status}`);return r.json()}\n"
         + RM_SPLIT + RM_RENDER.replace('$("cfbCount")', '$("cfbRmCount")')
         + """  async function loadRoadmap(){try{
    const [env,surfaces]=await Promise.all([json("/data/pound-tools.json"),json("/data/surfaces.json")]);
    if(!Array.isArray(env.data))throw new Error("roadmap payload is malformed");
    /* Fail loud rather than silently reporting zero callable tools — a missing roster is
       not evidence that nothing is live, and the old zero was exactly that mistake. */
    if(!surfaces||!surfaces.mcp||!Array.isArray(surfaces.mcp.tools_live))throw new Error("surfaces.json is missing its live MCP roster");
    liveMcp=new Set(surfaces.mcp.tools_live);
    cfbIdeas=env.data.filter(t=>t.kind==="roadmap-idea");cfbSteps=(env.cfb_roadmap&&env.cfb_roadmap.steps)||[];
    const addOpts=(id,vals,label)=>{const sel=$(id);vals.forEach(v=>{const o=document.createElement("option");o.value=String(v);o.textContent=label?label(v):String(v);sel.appendChild(o)});sel.addEventListener("change",renderCfb)};
    addOpts("cfbCat",[...new Set(cfbIdeas.map(i=>i.category))],catLabel);
    addOpts("cfbLife",[...new Set(cfbIdeas.map(i=>i.lifecycle_status))]);
    addOpts("cfbStep",cfbSteps.map(s=>s.step),v=>{const s=cfbSteps.find(x=>x.step===v);return `${v} · ${s?s.title:""}`});
    $("cfbRec").addEventListener("change",renderCfb);
    renderCfbTools();
    renderCfb();
    window.__CFBRM={ideas:cfbIdeas.length,live:cfbToolSplit().live.length};
  }catch(err){$("cfbGrid").innerHTML='<div class="p-error">CFB roadmap unavailable: '+esc(err.message)+'</div>';$("cfbToolsLive").innerHTML='<div class="p-error">Live CFB tool roster unavailable: '+esc(err.message)+' — this is not a claim that no tools are live.</div>'}}
  loadRoadmap();

  /* Old anchors follow the content into sheets; the sheet ids "matchup" and
     "divergence" ARE the old anchors, so only these three need a forward.
     ⚠️ ON hashchange TOO, not just at load. A link from one part of the page to
     cfb.html#explorer is a SAME-DOCUMENT navigation: nothing reloads, this script
     never re-runs, and DDSheets sees an id it does not know and stays put. This
     listener is registered BEFORE DDSheets', so it rewrites the hash first and
     DDSheets reads the corrected one. */
  var fwd={explorer:"teams",expected:"elo",baseline:"elo"};
  function fwdHash(){
    var h=(location.hash||"").replace(/^#/,"");
    if(!fwd[h]) return;
    try{history.replaceState(null,"","#"+fwd[h]);}catch(e){}
  }
  fwdHash();
  addEventListener("hashchange", fwdHash);
  DDSheets({key:"cfb",mount:"#sheets",sheets:[
    {id:"matchup",label:"Matchup",panel:"#sheetMatchup"},
    {id:"teams",label:"Teams",panel:"#sheetTeams"},
    {id:"elo",label:"Elo",panel:"#sheetElo"},
    {id:"divergence",label:"Divergence",panel:"#sheetDiv"},
    {id:"roadmap",label:"Roadmap",panel:"#sheetRoadmap"}],
    /* the lazy Elo/divergence fetches were scroll-triggered; a sheet opening is the
       new visibility event, so it triggers the same latched loader directly */
    onShow:function(id){if((id==="elo"||id==="divergence")&&window.ddCfbLoadLazy)window.ddCfbLoadLazy();}
  });
})();
</script>
""")

CFB_EDITS = [
    # CSS: sheets + scoped roadmap rules
    ("\n</style>", "\n" + SHEET_CSS + ROADMAP_CSS + "</style>", 1),
    # the page intro learns the roadmap arrived
    ("Everything on this page is the\n  same data the CFB tools serve to machines, drawn for people.</p>",
     "Everything on this page is the\n  same data the CFB tools serve to machines, drawn for people. The build roadmap moved here\n"
     "  from <a href=\"dawghouse.html\">The DawgHouse</a> on 2026-08-09.</p>", 1),
    # sheet bar mounts after the banner
    ("can compute is a hypothetical: what this rating would have said about two teams meeting during\n  the 2025 rating period.</div>",
     "can compute is a hypothetical: what this rating would have said about two teams meeting during\n  the 2025 rating period.</div>\n\n  <div id=\"sheets\"></div>", 1),
    # panel wrappers
    ("  <!-- ================= matchup calculator ================= -->",
     "  <div id=\"sheetMatchup\">\n  <!-- ================= matchup calculator ================= -->", 1),
    ("  <!-- ================= one filter row, scoping everything below ================= -->",
     "  </div>\n\n  <div id=\"sheetTeams\">\n  <!-- ================= one filter row, scoping everything below ================= -->", 1),
    ("  <!-- ================= expected vs observed ================= -->",
     "  </div>\n\n  <div id=\"sheetElo\">\n  <!-- ================= expected vs observed ================= -->", 1),
    ("  <!-- ================= divergence ================= -->",
     "  </div>\n\n  <div id=\"sheetDiv\">\n  <!-- ================= divergence ================= -->", 1),
    ("  <!-- ================= honesty ================= -->",
     "  </div>\n\n" + ROADMAP_MARKUP + "\n  <!-- ================= honesty ================= -->", 1),
    # the filter's claim follows the layout
    ("<p class=\"sub\">One filter for the whole page below: the team table, the expected-versus-observed\n    chart and the divergence table all redraw against the same slice.</p>",
     "<p class=\"sub\">One filter across the data sheets: the team table here, the expected-versus-observed\n    chart on the Elo sheet and the divergence table on its sheet all redraw against the same slice.</p>", 1),
    # ⚠️ Stage 3 REGRESSION, caught by test-cfb-page: an element inside a hidden sheet
    # panel reports a 0x0 rect at the document origin, and "0 < vh+400 && 0 > -400" is
    # true — so every page load fetched cfb-elo.json and the divergence files
    # immediately, whichever sheet was open. A panel that is not open is not near view.
    ("  function nearView(){\n    var el = $(\"baseline\");\n    if(!el) return false;\n"
     "    var r = el.getBoundingClientRect(), vh = window.innerHeight || 800;",
     "  function nearView(){\n    var el = $(\"baseline\");\n    if(!el) return false;\n"
     "    /* Stage 3: a hidden sheet panel has no layout box, so its rect is 0x0 at the\n"
     "       origin and would read as \"near the viewport\" forever. */\n"
     "    if(!el.offsetParent && getComputedStyle(el).position !== \"fixed\") return false;\n"
     "    var r = el.getBoundingClientRect(), vh = window.innerHeight || 800;", 1),
    # expose the latched lazy loader for the sheet bar
    ("  function maybeLazy(){ if(nearView()) loadLazy(); }",
     "  function maybeLazy(){ if(nearView()) loadLazy(); }\n"
     "  window.ddCfbLoadLazy = loadLazy;   /* Stage 3: opening the Elo/Divergence sheet is a visibility event too */", 1),
    # DDSheets + roadmap loader, before Toto's surface block
    ("<script>\n/* ---------------- Toto's surface: the College Football lab ----------------",
     DDSHEETS + "\n" + RM_JS + "<script>\n/* ---------------- Toto's surface: the College Football lab ----------------", 1),
    # Toto learns the roadmap sheet and its limits
    ("- The rating sees game results, margin and site. It does NOT see recruiting, the portal, rosters, injuries, weather, travel, play-by-play efficiency or opponent strength adjustment.`,",
     "- The rating sees game results, margin and site. It does NOT see recruiting, the portal, rosters, injuries, weather, travel, play-by-play efficiency or opponent strength adjustment.\n"
     "- ⚠️ THE ROADMAP SHEET IS A PLAN, NOT A CAPABILITY LIST. Its cards are ideas; a candidate tool name is a reservation unless the live roster in /data/surfaces.json says it is callable. Never promise a roadmap feature exists.`,", 1),
    ("    if(w.backtest) L.push('PUBLISHED 2025 BACKTEST (retrodictive): ' + w.backtest);",
     "    if(w.backtest) L.push('PUBLISHED 2025 BACKTEST (retrodictive): ' + w.backtest);\n"
     "    if(window.__CFBRM) L.push('ROADMAP SHEET: ' + window.__CFBRM.ideas + ' build ideas; ' + window.__CFBRM.live + ' candidate tools callable now per the live roster. Ideas are plans, not capabilities.');", 1),
]

new_cfb = apply(cfb, CFB_EDITS, "cfb.html")
for needle in ('id="cfbRmCount"', 'id="cfbMachineTools"', 'id="sheetRoadmap"', "window.DDSheets = function(cfg)"):
    assert needle in new_cfb, needle
assert new_cfb.count('id="cfbCount"') == 1   # the Teams filter count only

# ---------------------------------------------------------------------------
# dawghouse.html — the roadmap leaves.

NEW_LOADER = """  async function loadInventory(){try{
    const env=await json("/data/pound-tools.json");
    if(!Array.isArray(env.data))throw new Error("inventory payload is malformed");
    allTools=env.data.filter(t=>(t.kind||"tool")==="tool"&&t.status!=="complete");renderTools("all");$("toolFilter").addEventListener("change",e=>renderTools(e.target.value));
  }catch(err){$("toolInventory").innerHTML='<div class="p-error">Inventory unavailable: '+esc(err.message)+'</div>'}}
  loadInventory();"""

DAWG_EDITS = [
    # ⚠️ The forward has to run on hashchange as well as at load. Arriving at
    # dawghouse.html#cfb from a link on the page itself, or from browser history, is a
    # SAME-DOCUMENT navigation: the head script never re-runs and the reader lands on a
    # section that is not there. Same gap existed for the 1b forwards; fixed for all four.
    ('(function(){var h=location.hash;\n'
     'if(h==="#scoreboard")location.replace("receipts.html#models");\n'
     'else if(h==="#provenance")location.replace("receipts.html#provenance");\n'
     'else if(h==="#calculators")location.replace("calculators.html");})();</script>',
     '(function(){function go(){var h=location.hash;\n'
     'if(h==="#scoreboard")location.replace("receipts.html#models");\n'
     'else if(h==="#provenance")location.replace("receipts.html#provenance");\n'
     'else if(h==="#calculators")location.replace("calculators.html");\n'
     'else if(h==="#cfb")location.replace("cfb.html#roadmap");}\n'
     'go();addEventListener("hashchange",go);})();</script>', 1),
    ('<p class="p-lead">The shelf of blocked work and the College Football roadmap. Useful now; '
     'still earning their collar. Missing data, licensing limits and ungraded claims stay visible. '
     'The deterministic calculators moved to <a href="calculators.html">Calculators</a> and the '
     'model scoreboard and upstream provenance to <a href="receipts.html#models">Receipts</a> as '
     'of 2026-08-09.</p>',
     '<p class="p-lead">The shelf of blocked work: every entry keeps its exact blocker and its '
     'minimum path back. Missing data, licensing limits and ungraded claims stay visible. The '
     'deterministic calculators moved to <a href="calculators.html">Calculators</a>, the College '
     'Football roadmap to the <a href="cfb.html#roadmap">CFB Lab</a>, and the model scoreboard '
     'and upstream provenance to <a href="receipts.html#models">Receipts</a> as of 2026-08-09.</p>', 1),
    ('<a href="#inventory">The shelf</a><a href="#cfb">CFB roadmap</a><a href="#machines">For machines</a>',
     '<a href="#inventory">The shelf</a><a href="#machines">For machines</a>', 1),
    ('<a href="calculators.html">Calculators &rarr;</a>',
     '<a href="calculators.html">Calculators &rarr;</a><a href="cfb.html#roadmap">CFB roadmap &rarr;</a>', 1),
    (CFB_SECTION + "\n\n\n", "", 1),
    ('<p class="dek">Assistants should read deterministic state, not scrape the cards above. '
     'The model scoreboard and upstream provenance render in Receipts, and the deterministic '
     'calculators with their contracts on <a href="calculators.html">calculators.html</a>, as of '
     '2026-08-09.</p>',
     '<p class="dek">Assistants should read deterministic state, not scrape the cards above. '
     'The model scoreboard and upstream provenance render in Receipts, the deterministic '
     'calculators with their contracts on <a href="calculators.html">calculators.html</a>, and '
     'the College Football roadmap with the live CFB tool roster on '
     '<a href="cfb.html#roadmap">cfb.html</a>, as of 2026-08-09.</p>', 1),
    (MACHINE_LI, "", 1),
    # ⚠️ The shelf's status filter REPLACES the inventory's contents, and with the
    # calculators and the roadmap gone this page has no live region left at all — a
    # screen-reader user filtering the shelf now gets silence. Announce the region
    # rather than lowering the assertion that caught it.
    ('<div class="inventory" id="toolInventory">',
     '<div class="inventory" id="toolInventory" aria-live="polite">', 1),
    (RM_SPLIT, "", 1),
    (RM_RENDER, "", 1),
    (OLD_LOADER, NEW_LOADER, 1),
]

new_dawg = apply(dawg, DAWG_EDITS, "dawghouse.html")
assert 'id="cfbGrid"' not in new_dawg and "cfbToolSplit" not in new_dawg
assert 't.status!=="complete"' in new_dawg
assert "async function json(url)" in new_dawg

# ---------------------------------------------------------------------------
# tools/build-data.js — cfb.html becomes its own surface; the pound row keeps only
# what its page still holds.

BUILD = (ROOT / "tools" / "build-data.js").read_text(encoding="utf-8")

CFB_FILES = between(BUILD, "              { kind: 'json', url: '/data/cfb-schedule.json'",
                    "covers: 'published blocked model-versus-market probe naming the missing observation timestamp and exact unblock condition' },\n")
CFB_MCP_SPREAD = ("              ...MCP_CFB_LIVE.map(tool => ({ kind: 'mcp', tool, status: 'live',\n"
                  "                covers: 'bounded read-only CFB evidence or deterministic rating-period calculation; inputs and results are not stored' }))")
assert BUILD.count(CFB_MCP_SPREAD) == 1

POUND_GAP_OLD = ("    gap: 'The model scoreboard and provenance render on /receipts.html and the "
                 "deterministic calculators on /calculators.html since 2026-08-09; the calculator "
                 "contracts and Worker tools are listed on the calculators surface. Sixteen "
                 "bounded CFB tools and the timestamped 24-hour market collector are live; the "
                 "first market observation waits on an eligible 2026 event, and no CFB model "
                 "forecast receipt has been frozen yet.' },")

CFB_ROW = ("""  { id: 'cfb', name: 'College Football Lab — 2025 results, retrodictive Elo and the build roadmap', page: '/cfb.html',
    /* CEP-5A Stage 3: the roadmap renders on /cfb.html now, so the CFB files and the
       sixteen CFB Worker tools are this surface's claims, not the DawgHouse's. */
    machine: [{ kind: 'json', url: '/data/pound-tools.json', status: 'live', covers: 'the 44-idea College Football roadmap under cfb_roadmap and kind:"roadmap-idea" entries — the same file also carries the NFL inventory listed on the DawgHouse surface' },
"""
           + "              { kind: 'json', url: '/data/cfb-schedule.json'"
           + CFB_FILES[len("              { kind: 'json', url: '/data/cfb-schedule.json'"):]
           + CFB_MCP_SPREAD + "],\n"
           + "    planned: [],\n"
           + "    gap: 'Sixteen bounded CFB tools and the timestamped 24-hour market collector are live; the first market observation waits on an eligible 2026 event, and no CFB model forecast receipt has been frozen yet.' },\n")

BUILD_EDITS = [
    ("'The DawgHouse shelf and College Football roadmap (formerly The Pound)'",
     "'The DawgHouse shelf (formerly The Pound)'", 1),
    ("{ kind: 'json', url: '/data/pound-tools.json', status: 'live', covers: 'complete NFL tool "
     "inventory plus the College Football roadmap with evidence-backed lifecycle state and sixteen "
     "production CFB MCP tools' },\n" + CFB_FILES,
     "{ kind: 'json', url: '/data/pound-tools.json', status: 'live', covers: 'complete NFL tool "
     "inventory (delivery status, blockers) — the College Football roadmap in the same file is "
     "listed on the cfb surface, where it renders' }],\n", 1),
    ("              " + CFB_MCP_SPREAD.strip() + "],\n", "", 1),
    (POUND_GAP_OLD,
     "    gap: 'The model scoreboard and provenance render on /receipts.html, the deterministic "
     "calculators on /calculators.html, and the College Football roadmap on /cfb.html since "
     "2026-08-09; each surface lists its own files and Worker tools.' },", 1),
    ("  { id: 'calculators', name: 'NFL calculators', page: '/calculators.html',",
     CFB_ROW + "  { id: 'calculators', name: 'NFL calculators', page: '/calculators.html',", 1),
]

# ---------------------------------------------------------------------------
# sitemap + llms.txt

SITEMAP_EDITS = [
    ("  <url><loc>https://datadawgs216.com/cfb.html</loc><lastmod>2026-08-08</lastmod></url>\n",
     f"  <url><loc>https://datadawgs216.com/cfb.html</loc><lastmod>{SHIP}</lastmod></url>\n", 1),
]
LLMS_EDITS = [
    ("- [Workbench](/dawghouse.html): the shelf of blocked work and the CFB roadmap.",
     "- [Workbench](/dawghouse.html): the shelf of blocked work.", 1),
    ("## College football\n\n",
     "## College football\n\n"
     "- [CFB Lab](/cfb.html): explorer, matchup calculator, Elo backtest, divergence, and the 44-idea build roadmap (moved from the workbench 2026-08-09).\n", 1),
]

# ---------------------------------------------------------------------------
# Dry-run everything, then write everything.

results = {
    str(ROOT / "cfb.html"): new_cfb,
    str(ROOT / "dawghouse.html"): new_dawg,
    str(ROOT / "tools" / "build-data.js"): apply(BUILD, BUILD_EDITS, "build-data.js"),
    str(ROOT / "sitemap.xml"): apply((ROOT / "sitemap.xml").read_text(encoding="utf-8"), SITEMAP_EDITS, "sitemap.xml"),
    str(ROOT / "llms.txt"): apply((ROOT / "llms.txt").read_text(encoding="utf-8"), LLMS_EDITS, "llms.txt"),
}

llms_bytes = len(results[str(ROOT / "llms.txt")].encode("utf-8"))
assert llms_bytes / 1024 <= 5, f"llms.txt would be {llms_bytes} B — over the 5 KB budget"

for path, text in results.items():
    pathlib.Path(path).write_text(text, encoding="utf-8", newline="\n")
print(f"wrote {len(results)} files (llms.txt {llms_bytes} B); "
      "now: rebuild data, bump sw VERSION, update the suites, run everything")
