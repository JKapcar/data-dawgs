"""
CEP-5A Stage 2 — the ten NFL calculators leave dawghouse.html for a canonical
calculators.html.

calculators.html is DERIVED from dawghouse.html (same shared head/nav/style block),
keeping the calculator section, the inlined DDPound core and the calculator wiring;
dawghouse.html keeps the shelf, the CFB roadmap and the machine box, and forwards
#calculators the way 1b forwards #scoreboard/#provenance. The chip on the new page is
"Labs", not a collar: complete deterministic calculators with contracts are still
ungraded work, and promotion is Kap's call, not a page move's side effect.

Same discipline as 1a/1b: sections are EXTRACTED from the live file with strict
markers, every replacement asserts its exact expected count, and nothing is written
unless every file agrees. Run from the repo root, on a tree where dawghouse.html still
carries the calculators (base 63f8fd0).
"""
import glob
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHIP = "2026-08-09"

dawg = (ROOT / "dawghouse.html").read_text(encoding="utf-8")

# ---------------------------------------------------------------------------
# Strict extraction helpers. A drifted marker aborts the whole run.

def section(text, dom_id):
    start = text.index(f'  <section class="p-section" id="{dom_id}">')
    end = text.index("  </section>", start) + len("  </section>")
    return text[start:end]

def between(text, start_marker, end_marker, include_end=True):
    start = text.index(start_marker)
    end = text.index(end_marker, start + len(start_marker))
    if include_end:
        end += len(end_marker)
    return text[start:end]

CALC_SECTION = section(dawg, "calculators")
INVENTORY_SECTION = section(dawg, "inventory")
CFB_SECTION = section(dawg, "cfb")
MACHINES_SECTION = section(dawg, "machines")
assert '<form class="calc" id="consForm">' in CALC_SECTION
assert CALC_SECTION.count('class="calc"') == 10, CALC_SECTION.count('class="calc"')

# the four script blocks: 1b-forward, shared nav, DDPound core, page wiring
BLOCKS = re.findall(r"<script(?:\s[^>]*)?>[\s\S]*?</script>", dawg)
assert len(BLOCKS) == 4, len(BLOCKS)
FORWARD_BLOCK, NAV_BLOCK, CORE_BLOCK, WIRE_BLOCK = BLOCKS
assert FORWARD_BLOCK.startswith("<script>/* CEP-5A 1b")
assert CORE_BLOCK.startswith("<script>\n/* Data Dawgs Pound calculators")
assert WIRE_BLOCK.startswith("<script>\n\n(function(){\n  const P=window.DDPound")

# the calculator wiring region inside the last block (helpers american/values/wire +
# the ten wire() calls), and the inventory/CFB region that stays behind
CALC_JS = between(
    WIRE_BLOCK,
    '  const american=v=>(v>=0?"+":"")+Math.round(v);',
    'wire("consForm","consOut",()=>{const r=P.beliefSummary(values("consP").map(v=>v/100));'
    'return `<b>${pct(r.mean)} mean · ${pct(r.median)} median</b><br>range ${pct(r.min)}–${pct(r.max)} '
    '(${(r.range*100).toFixed(1)} pp) · SD ${(r.standard_deviation*100).toFixed(1)} pp · '
    '50% split ${r.crosses_50?"yes":"no"}`});',
)
assert CALC_JS.count("wire(") == 11, CALC_JS.count("wire(")  # function def + 10 calls
INV_JS = between(WIRE_BLOCK, "\n  let allTools=[];", "\n  loadInventory();")

HERO_KICKER = ('<div class="p-kicker">The DawgHouse · Worker tools live 2026-08-07 · '
               'forecasts locked 2026-08-08</div>')
HERO_H1 = ('<h1>Tools that show their work. <a class="tierchip" href="index.html#tiers" '
           'title="Why this work is in The DawgHouse">The DawgHouse</a></h1>')
HERO_LEAD = ('<p class="p-lead">Deterministic football calculators, the shelf of blocked work '
             'and the College Football roadmap. Useful now; still earning their collar. Missing '
             'data, licensing limits and ungraded claims stay visible. The model scoreboard and '
             'upstream provenance live in <a href="receipts.html#models">Receipts</a> as of '
             '2026-08-09.</p>')
DISCLOSURE = ('<div class="p-disclosure"><b>No oracle lives here.</b> Current game numbers are '
              'dated 2026 inputs. Calculator output is arithmetic or explicitly <b>MODELLED</b>. '
              'Nothing on this page has established betting profitability, and the multi-model '
              'system has not yet been graded prospectively.</div>')
PJUMP = ('<nav class="p-jump" aria-label="The DawgHouse sections">\n'
         '    <a href="#calculators">Calculators</a><a href="#inventory">The shelf</a>'
         '<a href="#cfb">CFB roadmap</a><a href="#machines">For machines</a>'
         '<a href="receipts.html#models">Scoreboard &rarr;</a>'
         '<a href="receipts.html#provenance">Provenance &rarr;</a>\n  </nav>')
for needle in (HERO_KICKER, HERO_H1, HERO_LEAD, DISCLOSURE, PJUMP):
    assert dawg.count(needle) == 1, needle[:70]

CONTRACTS_BULLET = ('      <li><a href="/data/model-contracts.json"><code>/data/model-contracts.json'
                    '</code></a> — normalized forecast, receipt and calculator contracts.</li>\n')
CALC_TOOLS_BULLET = ('      <li><code>dd_elo_game</code>, <code>dd_translate_probability</code>, '
                     '<code>dd_convert_odds</code>, <code>dd_devig_market</code>, '
                     '<code>dd_price_parlay</code>, <code>dd_calculate_bet_ev</code>, '
                     '<code>dd_calculate_hedge</code>, <code>dd_nfl_passer_rating</code>, '
                     '<code>dd_score_forecast</code> and <code>dd_summarize_beliefs</code> — live, '
                     'read-only Worker tools for deterministic calculations over caller-supplied '
                     'inputs.</li>\n')
assert dawg.count(CONTRACTS_BULLET) == 1
assert dawg.count(CALC_TOOLS_BULLET) == 1

# ---------------------------------------------------------------------------
# apply(): the 1a/1b engine — exact expected count per edit, abort on any mismatch.

def apply(text, edits, label):
    for old, new, n in edits:
        found = text.count(old)
        if found != n:
            raise SystemExit(f"ABORT {label}: expected {n}, found {found}: {old[:90]!r}")
        text = text.replace(old, new)
    return text

# ---------------------------------------------------------------------------
# 1. calculators.html — built from the BASE dawghouse.html text, so the deploy can
#    derive it from the sibling blob with DD_DERIVE="calculators.html=dawghouse.html".

NEW_MACHINES = '''  <section class="p-section" id="machines">
    <header><div><h2>The same calculators for machines</h2><p class="dek">Assistants should call the Worker tools or read the contracts, not scrape the forms above.</p></div></header>
    <div class="machine-box"><ul>
      <li><a href="/data/model-contracts.json"><code>/data/model-contracts.json</code></a> — normalized forecast, receipt and calculator contracts; the calculator I/O contracts are the ones these forms implement.</li>
''' + CALC_TOOLS_BULLET + '''    </ul><p class="assumption">The AI explains these outputs. It does not invent the underlying number, fill nulls or promote an ungraded tool.</p></div>
  </section>'''

calc_page = apply(dawg, [
    ("<title>The DawgHouse · Data Dawgs</title>",
     "<title>NFL Calculators · Data Dawgs</title>", 1),
    (FORWARD_BLOCK + "\n", "", 1),                       # no old deep links land here
    ('<script data-page="pound">', '<script data-page="calculators">', 1),
    (HERO_KICKER,
     '<div class="p-kicker">NFL Calculators · deterministic · live over MCP since 2026-08-07</div>', 1),
    (HERO_H1,
     '<h1>Deterministic football calculators. <a class="tierchip" href="index.html#tiers" '
     'title="Why this work is in Labs">Labs</a></h1>', 1),
    (HERO_LEAD,
     '<p class="p-lead">Pure functions; inputs stay in this browser; every result names the '
     'assumption it uses. All ten are contract-tested and live over MCP. They moved here from '
     '<a href="dawghouse.html">The DawgHouse</a> on 2026-08-09. Deterministic and contract-tested '
     'is not prospectively graded, so no collar is claimed.</p>', 1),
    (DISCLOSURE,
     '<div class="p-disclosure"><b>No oracle lives here.</b> Calculator output is arithmetic or '
     'explicitly <b>MODELLED</b>. A probability you type in is your input, not something these '
     'calculators discovered, and nothing on this page has established betting profitability.</div>', 1),
    ("  " + PJUMP + "\n\n", "", 1),
    (INVENTORY_SECTION + "\n\n", "", 1),
    (CFB_SECTION + "\n\n", "", 1),
    (MACHINES_SECTION, NEW_MACHINES, 1),
    (INV_JS, "", 1),                                     # wiring stays, inventory/CFB JS goes
    # the Upside Down mirror: the map is keyed by each page's own filename stem, so only
    # this page needs the new entry (survey 2026-08-09: no other page carries "dawghouse")
    ('"dawghouse":"/data/pound-tools.json"\n    },',
     '"dawghouse":"/data/pound-tools.json",\n      "calculators":"/data/model-contracts.json"\n    },', 1),
], "calculators.html")
assert calc_page.count('class="calc"') == 10
assert "DDPound = api" in calc_page

# ---------------------------------------------------------------------------
# 2. dawghouse.html — the calculators leave, the deep link forwards.

DAWGHOUSE_EDITS = [
    ('else if(h==="#provenance")location.replace("receipts.html#provenance");})();</script>',
     'else if(h==="#provenance")location.replace("receipts.html#provenance");\n'
     'else if(h==="#calculators")location.replace("calculators.html");})();</script>', 1),
    (HERO_LEAD,
     '<p class="p-lead">The shelf of blocked work and the College Football roadmap. Useful now; '
     'still earning their collar. Missing data, licensing limits and ungraded claims stay visible. '
     'The deterministic calculators moved to <a href="calculators.html">Calculators</a> and the '
     'model scoreboard and upstream provenance to <a href="receipts.html#models">Receipts</a> as '
     'of 2026-08-09.</p>', 1),
    (DISCLOSURE,
     '<div class="p-disclosure"><b>No oracle lives here.</b> Current game numbers are dated 2026 '
     'inputs. Nothing on this page has established betting profitability, and the multi-model '
     'system has not yet been graded prospectively.</div>', 1),
    ('<a href="#calculators">Calculators</a><a href="#inventory">The shelf</a>',
     '<a href="#inventory">The shelf</a>', 1),
    ('<a href="receipts.html#models">Scoreboard &rarr;</a>',
     '<a href="calculators.html">Calculators &rarr;</a><a href="receipts.html#models">Scoreboard &rarr;</a>', 1),
    (CALC_SECTION + "\n\n", "", 1),
    ('<p class="dek">Assistants should read deterministic state, not scrape the cards above. '
     'The model scoreboard and upstream provenance render in Receipts as of 2026-08-09; the data '
     'files below did not move.</p>',
     '<p class="dek">Assistants should read deterministic state, not scrape the cards above. '
     'The model scoreboard and upstream provenance render in Receipts, and the deterministic '
     'calculators with their contracts on <a href="calculators.html">calculators.html</a>, as of '
     '2026-08-09.</p>', 1),
    (CONTRACTS_BULLET, "", 1),
    (CALC_TOOLS_BULLET, "", 1),
    # the Upside Down's secondary mirrors: the contracts follow the calculators (and
    # upstream-models followed provenance to Receipts in 1b); the live roster this page
    # actually fetches is the honest remaining secondary
    ('"dawghouse":["/data/model-contracts.json","/data/upstream-models.json"],',
     '"dawghouse":["/data/surfaces.json"],', 1),
    (CORE_BLOCK + "\n", "", 1),                          # the inlined DDPound core leaves
    ("const P=window.DDPound, $=id=>document.getElementById(id);\n"
     '  const n=id=>Number($(id).value), pct=v=>(v*100).toFixed(2)+"%", '
     'signed=(v,digits=1)=>(v>=0?"+":"")+v.toFixed(digits);\n  const esc=',
     "const $=id=>document.getElementById(id);\n  const esc=", 1),
    # CALC_JS spans american/values/json/wire; json() is the one helper the inventory
    # and CFB loaders still call, so it is re-inserted rather than lost with the rest
    # (proven the hard way: without this, loadInventory renders "json is not defined")
    (CALC_JS + "\n\n  \n",
     "  async function json(url){const r=await fetch(url);"
     "if(!r.ok)throw new Error(`${url} returned ${r.status}`);return r.json()}\n", 1),
]
new_dawg = apply(dawg, DAWGHOUSE_EDITS, "dawghouse.html")
assert "async function json(url)" in new_dawg
assert new_dawg.count('class="calc"') == 0
assert "DDPound" not in new_dawg, "dawghouse still references DDPound"

# ---------------------------------------------------------------------------
# 3. Sitewide nav sweep — the Dawgs-group item points at the canonical page, and the
#    Upside Down learns the new page's machine mirror. calculators.html (already built
#    from the base text) gets the identical treatment.

SWEEP = [
    ('["dawghouse.html#calculators","Calculators · NFL","pound-calculators"],',
     '["calculators.html","Calculators · NFL","calculators"],', 1),
]
NAV_PAGES = sorted(
    f for f in glob.glob(str(ROOT / "*.html"))
    if pathlib.Path(f).name not in ("draft-leagues.html", "survivor-settings.html", "pound.html")
)
assert len(NAV_PAGES) == 21, len(NAV_PAGES)

# ---------------------------------------------------------------------------
# 4. tools/build-data.js — the calculators become their own surface.

BUILD = (ROOT / "tools" / "build-data.js").read_text(encoding="utf-8")

POUND_GAP_OLD = ("    gap: 'The model scoreboard and provenance render on /receipts.html since "
                 "2026-08-09; their data files are unchanged. Sixteen bounded CFB tools and the "
                 "timestamped 24-hour market collector are live; the first market observation "
                 "waits on an eligible 2026 event, and no CFB model forecast receipt has been "
                 "frozen yet.' },")
POUND_GAP_NEW = ("    gap: 'The model scoreboard and provenance render on /receipts.html and the "
                 "deterministic calculators on /calculators.html since 2026-08-09; the calculator "
                 "contracts and Worker tools are listed on the calculators surface. Sixteen "
                 "bounded CFB tools and the timestamped 24-hour market collector are live; the "
                 "first market observation waits on an eligible 2026 event, and no CFB model "
                 "forecast receipt has been frozen yet.' },")

CALCULATORS_ROW = """  { id: 'calculators', name: 'NFL calculators', page: '/calculators.html',
    /* CEP-5A Stage 2: the ten deterministic calculators moved off the DawgHouse page.
       Their contracts file and Worker tools moved with them — a surface lists what its
       page actually holds, and /dawghouse.html no longer holds the forms. */
    machine: [{ kind: 'json', url: '/data/model-contracts.json', status: 'live', covers: 'forecast, receipt and calculator contracts — the calculator I/O contracts are the ones the page implements' },
              ...MCP_POUND_LIVE.map(tool => ({ kind: 'mcp', tool, status: 'live',
                covers: 'deterministic calculation over caller-supplied inputs; inputs and results are not stored' }))],
    planned: [] },
"""

BUILD_EDITS = [
    ("      : id === 'disagreement' ? '/dawghouse.html#scoreboard + /dawghouse.html#calculators'",
     "      : id === 'disagreement' ? '/receipts.html#models + /calculators.html'", 1),
    ("      : calculatorIds.has(id) ? '/dawghouse.html#calculators' : '/dawghouse.html#inventory',",
     "      : calculatorIds.has(id) ? '/calculators.html' : '/dawghouse.html#inventory',", 1),
    ("'The DawgHouse calculator workbench and shelf (formerly The Pound)'",
     "'The DawgHouse shelf and College Football roadmap (formerly The Pound)'", 1),
    ("              { kind: 'json', url: '/data/model-contracts.json', status: 'live', "
     "covers: 'forecast, receipt and calculator contracts' },\n", "", 1),
    ("              ...MCP_POUND_LIVE.map(tool => ({ kind: 'mcp', tool, status: 'live',\n"
     "                covers: 'deterministic calculation over caller-supplied inputs; inputs and "
     "results are not stored' })),\n", "", 1),
    (POUND_GAP_OLD, POUND_GAP_NEW, 1),
    ("  { id: 'method', name: 'How this site reasons', page: '/index.html',",
     CALCULATORS_ROW + "  { id: 'method', name: 'How this site reasons', page: '/index.html',", 1),
]

# ---------------------------------------------------------------------------
# 5. sitemap.xml + llms.txt + sw.js CORE (VERSION is bumped separately, from the
#    staged tree, so verify-sw grades the same bytes that ship).

SITEMAP_EDITS = [
    ('  <url><loc>https://datadawgs216.com/bozo.html</loc><lastmod>2026-08-08</lastmod></url>\n',
     '  <url><loc>https://datadawgs216.com/bozo.html</loc><lastmod>2026-08-08</lastmod></url>\n'
     f'  <url><loc>https://datadawgs216.com/calculators.html</loc><lastmod>{SHIP}</lastmod></url>\n', 1),
]
LLMS_EDITS = [
    ("- [Workbench](/dawghouse.html): deterministic calculators, the shelf of blocked work, CFB roadmap.",
     "- [Workbench](/dawghouse.html): the shelf of blocked work and the CFB roadmap.", 1),
    ("The 10 calculators cover odds, vig, EV, hedging, passer rating, Elo, margin translation\n"
     "and forecast scoring. Inputs are not stored. The model scoreboard (descriptive, ungraded)\n"
     "and upstream provenance render on /receipts.html since 2026-08-09.",
     "- [Calculators](/calculators.html): the 10 deterministic calculators — odds, vig, EV,\n"
     "hedging, passer rating, Elo, margin translation, forecast scoring, belief summary.\n"
     "Inputs are not stored. The model scoreboard (descriptive, ungraded) and upstream\n"
     "provenance render on /receipts.html since 2026-08-09.", 1),
]
SW_EDITS = [
    ('"/cfb.html"\n]', '"/cfb.html", "/calculators.html"\n]', 1),
]

# ---------------------------------------------------------------------------
# Dry-run everything, then write everything. Nothing lands if any file disagrees.

results = {}
for page in NAV_PAGES:
    name = pathlib.Path(page).name
    text = new_dawg if name == "dawghouse.html" else pathlib.Path(page).read_text(encoding="utf-8")
    results[page] = apply(text, SWEEP, name)
results[str(ROOT / "calculators.html")] = apply(calc_page, SWEEP, "calculators.html")
results[str(ROOT / "tools" / "build-data.js")] = apply(BUILD, BUILD_EDITS, "build-data.js")
results[str(ROOT / "sitemap.xml")] = apply(
    (ROOT / "sitemap.xml").read_text(encoding="utf-8"), SITEMAP_EDITS, "sitemap.xml")
results[str(ROOT / "llms.txt")] = apply(
    (ROOT / "llms.txt").read_text(encoding="utf-8"), LLMS_EDITS, "llms.txt")
results[str(ROOT / "sw.js")] = apply(
    (ROOT / "sw.js").read_text(encoding="utf-8"), SW_EDITS, "sw.js")

llms_bytes = len(results[str(ROOT / "llms.txt")].encode("utf-8"))
assert llms_bytes / 1024 <= 5, f"llms.txt would be {llms_bytes} B — over the 5 KB budget"

for path, text in results.items():
    pathlib.Path(path).write_text(text, encoding="utf-8", newline="\n")
print(f"wrote {len(results)} files (llms.txt {llms_bytes} B); "
      "now: rebuild data, bump sw VERSION from the staged tree, run the suites")
