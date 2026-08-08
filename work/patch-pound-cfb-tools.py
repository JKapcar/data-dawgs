"""
Make pound.html tell the truth about the sixteen production CFB MCP tools.

THE GAP. /data/pound-tools.json and /data/surfaces.json have recorded sixteen live CFB
MCP tools since c55ac6a. pound.html did not name one of them, and said three things that
had become false:

  1. the CFB count line ended "0 candidate CFB MCP tools callable" — a typed-in zero,
  2. every roadmap card labelled its tool names "Candidate MCP tools (not callable)",
     including the sixteen that are callable,
  3. the machine-readable bullet repeated "Candidate CFB MCP tool names are not callable".

⚠️ NOTHING IS TYPED IN, INCLUDING THE SIXTEEN. The page intersects the live roster in
/data/surfaces.json with the candidate names on the College Football roadmap cards, at
runtime. If a tool is retired the count falls on its own. A number keyed in here would be
the same bug again with a different value.

⚠️ WHAT "LIVE" MEANS HERE, EXACTLY. It means the tool is in `mcp.tools_live` in
/data/surfaces.json — a roster `node tools/validate-data.js` checks against every
per-surface claim and against `counts.mcp_tools_live`. This page does NOT call the Worker
and does not independently confirm anything is answering. The copy says so.

⚠️ pound.html IS THE SOURCE. work/build-pound.py is a historical bootstrap that
regenerates the page from nfelo.html and would delete the entire CFB section; this pass
adds a refusal to it so nobody finds that out the way I did.

Run:  cd work && python3 patch-pound-cfb-tools.py
"""
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent
page = REPO / "pound.html"
s = page.read_text(encoding="utf-8")


def once(old, new, label):
    global s
    n = s.count(old)
    assert n == 1, f"{label}: anchor appears {n} times in pound.html, expected 1"
    s = s.replace(old, new, 1)


# ------------------------------------------------------------------ 1. CSS ----
once(
    ".cfb-count{font-size:12px;color:var(--ink-3);margin:0 0 10px}",
    ".cfb-count{font-size:12px;color:var(--ink-3);margin:0 0 10px}\n"
    ".cfbt-box{border:1px solid var(--border);background:var(--surface-1);border-radius:12px;"
    "padding:16px 18px;margin:0 0 18px}\n"
    ".cfbt-box>h3{margin:0 0 6px;font:750 12px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;"
    "letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}\n"
    ".cfbt-box>p{margin:0 0 12px;color:var(--ink-2);font-size:13.5px;line-height:1.62;max-width:820px}\n"
    ".cfbt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:9px}\n"
    ".cfbt{border:1px solid var(--grid);border-radius:9px;padding:9px 11px;background:var(--page);min-width:0}\n"
    ".cfbt code{font-size:12px;color:var(--ink-1);font-weight:700;overflow-wrap:anywhere;display:block}\n"
    ".cfbt span{display:block;margin-top:4px;font-size:11.5px;line-height:1.5;color:var(--ink-3)}\n"
    ".cfbt-planned{margin:13px 0 0;font-size:12.5px;line-height:1.65;color:var(--ink-3);overflow-wrap:anywhere}\n"
    ".cfbt-planned code{font-size:11.5px}",
    "cfb tools css")

# ------------------------------------------------------------- 2. the block ----
once(
    '    <div class="cfb-filters">\n',
    '    <div class="cfbt-box" id="cfbTools">\n'
    '      <h3>Production College Football MCP tools</h3>\n'
    '      <p>The roadmap cards below are <em>ideas</em>. These are the ones an assistant can\n'
    '      actually call today. The split is read at runtime by intersecting the live tool roster in\n'
    '      <a href="/data/surfaces.json"><code>/data/surfaces.json</code></a> with the candidate names\n'
    '      on the cards, so it cannot drift from the data the way a typed count can.\n'
    '      <b>&ldquo;Live&rdquo; here means the roster says so</b> &mdash;\n'
    '      <code>node tools/validate-data.js</code> checks that roster against every per-surface claim,\n'
    '      but this page does not call the Worker and does not independently confirm anything answered.</p>\n'
    '      <div class="p-summary" id="cfbToolStats">'
    '<div class="p-stat"><b>&mdash;</b><span>callable now</span></div>'
    '<div class="p-stat"><b>&mdash;</b><span>named, not built</span></div>'
    '<div class="p-stat"><b>&mdash;</b><span>ideas with a live tool</span></div>'
    '<div class="p-stat"><b>0</b><span>that write anything</span></div></div>\n'
    '      <div class="cfbt-grid" id="cfbToolsLive"><div class="p-loading">Loading the live CFB tool roster&hellip;</div></div>\n'
    '      <p class="cfbt-planned" id="cfbToolsPlanned"></p>\n'
    '    </div>\n'
    '    <div class="cfb-filters">\n',
    "cfb tools block")

# ------------------------------------------------------- 3. the machines list ----
once(
    '<li><a href="/data/pound-tools.json"><code>/data/pound-tools.json</code></a> — full inventory: '
    'NFL tools (delivery status, blockers) plus evidence-backed College Football lifecycle under '
    '<code>cfb_roadmap</code> and <code>kind:"roadmap-idea"</code> entries. Candidate CFB MCP tool '
    'names are not callable.</li>',
    '<li><a href="/data/pound-tools.json"><code>/data/pound-tools.json</code></a> — full inventory: '
    'NFL tools (delivery status, blockers) plus evidence-backed College Football lifecycle under '
    '<code>cfb_roadmap</code> and <code>kind:"roadmap-idea"</code> entries. A card\'s '
    '<code>candidate_mcp_tools</code> names are reservations; which of them are callable is settled by '
    'the live roster in <a href="/data/surfaces.json"><code>/data/surfaces.json</code></a>, not by the '
    'card.</li>\n'
    '      <li id="cfbMachineTools"><code>/data/surfaces.json</code> — the live Worker tool roster, '
    'including the College Football tools listed in the CFB section above.</li>',
    "machines pound-tools bullet")

# --------------------------------------------------------------- 4. the JS ----
# 4a. the per-card label stops calling every named tool uncallable
once(
    '${i.candidate_mcp_tools&&i.candidate_mcp_tools.length?`<p class="meta-line">'
    '<b>Candidate MCP tools (not callable):</b> <code>${i.candidate_mcp_tools.map(esc).join("</code>, <code>")}</code></p>`:""}',
    '${(()=>{const t=i.candidate_mcp_tools||[],on=t.filter(x=>liveMcp.has(x)),off=t.filter(x=>!liveMcp.has(x));'
    'return (on.length?`<p class="meta-line"><b>Live over MCP:</b> <code>${on.map(esc).join("</code>, <code>")}</code></p>`:"")'
    '+(off.length?`<p class="meta-line"><b>Named, not callable:</b> <code>${off.map(esc).join("</code>, <code>")}</code></p>`:"")})()}',
    "per-card mcp label")

# 4b. the count line stops asserting zero
once(
    '$("cfbCount").textContent=`${rows.length} of ${cfbIdeas.length} ideas shown · '
    '${implemented} implemented artifacts · 0 candidate CFB MCP tools callable.`;',
    'const callable=cfbToolSplit().live.length;\n'
    '    $("cfbCount").textContent=`${rows.length} of ${cfbIdeas.length} ideas shown · '
    '${implemented} implemented artifacts · ${callable} CFB MCP tool${callable===1?"":"s"} callable now.`;',
    "cfb count line")

# 4c. the split + the renderer
once(
    '  let cfbIdeas=[],cfbSteps=[];\n',
    '  let cfbIdeas=[],cfbSteps=[],liveMcp=new Set();\n'
    '  /* ⚠️ The live/not-live split is COMPUTED, never listed. A card names candidate tools;\n'
    '     /data/surfaces.json names what is actually on the Worker. The intersection is the\n'
    '     honest answer to "what can I call", and it self-corrects when either file moves.\n'
    '     Typing the number in here is exactly the bug this replaced. */\n'
    '  function cfbToolSplit(){\n'
    '    const named=new Set();\n'
    '    cfbIdeas.forEach(i=>(i.candidate_mcp_tools||[]).forEach(t=>named.add(t)));\n'
    '    const all=[...named].sort();\n'
    '    return {live:all.filter(t=>liveMcp.has(t)), planned:all.filter(t=>!liveMcp.has(t))};\n'
    '  }\n'
    '  function renderCfbTools(){\n'
    '    const {live,planned}=cfbToolSplit();\n'
    '    /* Attribute each tool to the roadmap idea that owns it. cfb-mcp-layer lists every\n'
    '       tool by design, so it is the fallback rather than the answer — otherwise every\n'
    '       tool would be credited to the umbrella card and the mapping would say nothing. */\n'
    '    const owner={};\n'
    '    cfbIdeas.forEach(i=>{ if(i.id==="cfb-mcp-layer") return;\n'
    '      (i.candidate_mcp_tools||[]).forEach(t=>{ if(!owner[t]) owner[t]=i; }); });\n'
    '    const umbrella=cfbIdeas.find(i=>i.id==="cfb-mcp-layer")||null;\n'
    '    const ideasWithLive=new Set(live.map(t=>(owner[t]||umbrella||{}).id).filter(Boolean)).size;\n'
    '    $("cfbToolStats").innerHTML=`<div class="p-stat"><b>${live.length}</b><span>callable now</span></div>`\n'
    '      +`<div class="p-stat"><b>${planned.length}</b><span>named, not built</span></div>`\n'
    '      +`<div class="p-stat"><b>${ideasWithLive}</b><span>ideas with a live tool</span></div>`\n'
    '      +`<div class="p-stat"><b>0</b><span>that write anything</span></div>`;\n'
    '    $("cfbToolsLive").innerHTML=live.map(t=>{\n'
    '      const o=owner[t]||umbrella;\n'
    '      /* ⚠️ The lifecycle chip belongs to the roadmap IDEA, not to the tool. Say which,\n'
    '         or a live tool under a still-building idea reads as a tool that is not ready. */\n'
    '      return `<div class="cfbt"><code>${esc(t)}</code><span>${o?`roadmap idea: ${esc(o.name)}'
    '${o.lifecycle_status?` (that idea is ${esc(o.lifecycle_status)})`:""}`:"roadmap owner not recorded"}</span></div>`;\n'
    '    }).join("")||\'<div class="p-loading">The live roster names no College Football tools.</div>\';\n'
    '    $("cfbToolsPlanned").innerHTML=planned.length\n'
    '      ? `<b>Named on a card but not callable:</b> <code>${planned.map(esc).join("</code>, <code>")}</code>. '
    'These are reservations. They are not on the Worker and asking for one gets nothing.`\n'
    '      : "Every tool named on a card is callable.";\n'
    '    const mb=$("cfbMachineTools");\n'
    '    if(mb) mb.innerHTML=`<a href="/data/surfaces.json"><code>/data/surfaces.json</code></a> — the live '
    'Worker tool roster. ${live.length} of its entries are College Football tools: '
    '<code>${live.map(esc).join("</code>, <code>")}</code>. All read-only.`;\n'
    '  }\n',
    "cfb tool split + renderer")

# 4d. load surfaces.json beside the inventory, then render
once(
    '    const env=await json("/data/pound-tools.json");if(!Array.isArray(env.data))throw new Error("inventory payload is malformed");',
    '    const [env,surfaces]=await Promise.all([json("/data/pound-tools.json"),json("/data/surfaces.json")]);\n'
    '    if(!Array.isArray(env.data))throw new Error("inventory payload is malformed");\n'
    '    /* Fail loud rather than silently reporting zero callable tools — a missing roster is\n'
    '       not evidence that nothing is live, and the old zero was exactly that mistake. */\n'
    '    if(!surfaces||!surfaces.mcp||!Array.isArray(surfaces.mcp.tools_live))throw new Error("surfaces.json is missing its live MCP roster");\n'
    '    liveMcp=new Set(surfaces.mcp.tools_live);',
    "surfaces fetch")

once(
    '    $("cfbRec").addEventListener("change",renderCfb);\n    renderCfb();',
    '    $("cfbRec").addEventListener("change",renderCfb);\n    renderCfbTools();\n    renderCfb();',
    "render call")

once(
    "}catch(err){$(\"toolInventory\").innerHTML='<div class=\"p-error\">Inventory unavailable: '+esc(err.message)+"
    "'</div>';$(\"cfbGrid\").innerHTML='<div class=\"p-error\">CFB roadmap unavailable: '+esc(err.message)+'</div>'}}",
    "}catch(err){$(\"toolInventory\").innerHTML='<div class=\"p-error\">Inventory unavailable: '+esc(err.message)+"
    "'</div>';$(\"cfbGrid\").innerHTML='<div class=\"p-error\">CFB roadmap unavailable: '+esc(err.message)+'</div>';"
    "$(\"cfbToolsLive\").innerHTML='<div class=\"p-error\">Live CFB tool roster unavailable: '+esc(err.message)+"
    "' — this is not a claim that no tools are live.</div>'}}",
    "error path")

page.write_text(s, encoding="utf-8", newline="")

# ---- proofs ----
assert "0 candidate CFB MCP tools callable" not in s, "the typed zero survived"
assert "Candidate MCP tools (not callable)" not in s, "the blanket not-callable label survived"
assert "Candidate CFB MCP tool names are not callable" not in s, "the machines bullet survived"
for must in ["cfbToolSplit", "renderCfbTools", "cfbToolsLive", "cfbToolsPlanned",
             "cfbMachineTools", "/data/surfaces.json", "liveMcp"]:
    assert must in s, f"missing {must}"
print(f"pound.html patched ({len(s):,} chars)")

# ---- and fence off the bootstrap that would delete all of this ----
bp = REPO / "work" / "build-pound.py"
b = bp.read_text(encoding="utf-8")
GUARD = '''"""⚠️ HISTORICAL BOOTSTRAP. DO NOT RUN. ⚠️

This script built the FIRST version of pound.html, on 2026-08-07, out of nfelo.html plus
work/pound-core.js. pound.html has moved a long way since: the College Football roadmap
section, the live CFB MCP tool roster, the sitewide nav sweeps, the sign-on chip and
every later edit live in pound.html and NOWHERE ELSE. Per AGENTS.md, the flattened HTML
IS the source.

Running this file regenerates the page from the old template and DELETES all of that,
silently, with a cheerful success message. Confirmed on 2026-08-09 by running it — the
CFB section disappeared and the page shrank by 6,697 characters.

It is kept because it records how the shell, the CSS and the calculator core were
assembled, which is worth reading. It is not kept because it is runnable. Edit pound.html
directly, or write a patch script beside this one (patch-pound-cfb-tools.py is one).

To run it anyway, knowing it will overwrite the live page:
    DD_REBUILD_POUND=i-know-this-deletes-the-cfb-section python3 work/build-pound.py
"""
import os as _os
if _os.environ.get("DD_REBUILD_POUND") != "i-know-this-deletes-the-cfb-section":
    raise SystemExit(
        "build-pound.py refuses to run: it would regenerate pound.html from the 2026-08-07\\n"
        "template and delete the CFB section and every later edit. Read the docstring.")

'''
if "HISTORICAL BOOTSTRAP" not in b:
    head, sep, rest = b.partition('"""')
    _, sep2, rest2 = rest.partition('"""')
    bp.write_text(GUARD + rest2.lstrip("\n"), encoding="utf-8", newline="")
    print("build-pound.py fenced off")
else:
    print("build-pound.py already fenced off")
