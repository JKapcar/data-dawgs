"""
Stage 2 — graft the four browser-side tools onto the Stage 1 section shells.

build_section_hub.py stamped markets.html and ai.html DELIBERATELY EMPTY. This script is
the change that makes them not empty: it lifts the DDSheets page-family component out of
cfb.html (the same way build_section_hub.py lifts the under-construction CSS out of
arena.html), appends the tools' panel CSS, and rebuilds each page's <main> so the tool
panels sit under the hero. Nothing is sliced by line number — every cut is a content
marker asserted to occur exactly once, because a line-number slice is exactly what broke
the first build of these pages, twice.

WHAT CHANGES, AND WHAT DOES NOT:
  - The `.notbuilt` banner GOES. Once a tool ships, "nothing here is built yet" is a false
    claim on a site whose whole argument is that claims must be checkable. The tier chip in
    the hero and the per-panel `.ddwarn` caveats the tools already carry replace it.
  - The Stage 1 `#plan` and `#machines` sections GO. `#plan` lists "Calibration" as a
    future item and says "None of this is built"; the calibration pass is now live. `#machines`
    says the hub "has no row in the map"; Stage 2 adds four rows. Both would be false. Their
    content is superseded by each tool's own Method sheet and by the surfaces directory below.
  - The `#live` surfaces grid — the EMPTY-STATE MACHINERY — STAYS. Its loader still branches
    read-failed / zero-rows / rows into three visibly different states, and test-section-hubs.mjs
    still defends all three. The section id is renamed `live` -> `surfaces` so it cannot collide
    with the DDSheets sheet whose hash is #live, and its dek is rewritten: rows now exist, and
    they declare `machine: []` because these tools compute in the visitor's browser from a third
    party's API and publish no machine surface of their own.

Run:  cd work && python build_section_tools.py
      cd work && python build_section_tools.py --check   (asserts, writes nothing)
"""
import pathlib, re, sys

REPO = pathlib.Path(__file__).resolve().parent.parent
SRC = pathlib.Path(__file__).resolve().parent / "section-tools"
CFB = REPO / "cfb.html"


def once(hay, needle, what, where=""):
    n = hay.count(needle)
    assert n == 1, f"marker {what!r} appears {n} times in {where}, expected 1"
    return hay.index(needle)


def sub1(hay, old, new, what):
    n = hay.count(old)
    assert n == 1, f"anchor {what!r} appears {n} times, expected 1"
    return hay.replace(old, new, 1)


cfb = CFB.read_text(encoding="utf-8")

# ---- DDSheets, lifted verbatim from cfb.html ---------------------------------
CSS_A = "/* ---- page-family sheets"
CSS_B = "/* ---- Stage 3: the roadmap sheet"
SHEET_CSS = cfb[once(cfb, CSS_A, "sheet css start", "cfb.html"):once(cfb, CSS_B, "sheet css end", "cfb.html")].rstrip() + "\n"
assert ".sheetbar{" in SHEET_CSS and ".sheet-tab{" in SHEET_CSS and "[role=tabpanel][hidden]" in SHEET_CSS

JS_A = "window.DDSheets = function(cfg){"
js_start = once(cfb, JS_A, "DDSheets start", "cfb.html")
js_end = cfb.index("\n};\n", js_start) + len("\n};")
DDSHEETS_JS = cfb[js_start:js_end]
assert DDSHEETS_JS.count("window.DDSheets") == 1 and 'class="sheet-tab"' in DDSHEETS_JS
assert DDSHEETS_JS.rstrip().endswith("};"), "DDSheets slice did not end on the function close"

# ---- utilities the tools reference, not in the section shell's site.css ------
#   .rt / .fi / .fi:focus / .btn.ghost / .good / .bad — lifted verbatim from cfb.html.
#   Audited absent from markets.html/ai.html (which carry .card/.lead/.sub/.btn/.chip already).
BASE_CSS = """/* ---- Stage 2: utilities the section tools reference, verbatim from cfb.html ---- */
.rt{float:right;text-transform:none;letter-spacing:0;font-weight:650;color:var(--ink-1)}
.fi{width:100%;box-sizing:border-box;background:var(--page);border:1px solid var(--grid);border-radius:9px;
  color:var(--ink-1);font:inherit;font-size:14px;padding:9px 11px}
.fi:focus{outline:2px solid color-mix(in srgb,var(--accent) 55%,transparent);outline-offset:1px}
.btn.ghost{background:none;color:var(--ink-2);border:1px solid var(--border);font-weight:700;font-size:13px;padding:9px 14px}
.good{color:var(--good)}
.bad{color:var(--bad)}
"""

EXTRA_CSS = (SRC / "extra.css.txt").read_text(encoding="utf-8").rstrip() + "\n"

# The surfaces directory — the kept empty-state machinery, re-dek'd for the rows-now-exist world.
SURFACES_SECTION = """  <section class="p-section" id="surfaces">
    <header><div><h2>This section, for machines</h2><p class="dek">One card per row in
      <a href="/data/surfaces.json"><code>/data/surfaces.json</code></a> carrying
      <code>domain: &quot;%(domain)s&quot;</code>. The count is the file&rsquo;s count, not a number typed
      into this page. Every tool here computes in <em>your</em> browser from a third party&rsquo;s
      public API, so none publishes a machine surface of its own &mdash; each card says exactly that,
      and the panels above name the upstream every number comes from.</p></div>
      <div class="p-meta" id="secCount" aria-live="polite">reading /data/surfaces.json&hellip;</div></header>
    <div class="inventory" id="secCards"><div class="p-loading">Reading the surfaces map&hellip;</div></div>
  </section>"""

# The tool sources live beside this script as *.txt (the repo's build-fragment convention,
# same as navauth.js.txt) so no *.html / *.js / *.css gate — verify-sw hashes tracked *.html —
# ever picks a build input up as if it were a served page.
PAGES = [
    dict(stem="markets", domain="markets", body="markets_body.html.txt", script="markets_script.js.txt",
         sheets=["#sheetLive", "#sheetCal", "#sheetDomains", "#sheetMkMethod"]),
    dict(stem="ai", domain="ai", body="ai_body.html.txt", script="ai_script.js.txt",
         sheets=["#sheetModels", "#sheetFrontier", "#sheetForecasts", "#sheetAiMethod"]),
]

for p in PAGES:
    page = REPO / f"{p['stem']}.html"
    src = page.read_text(encoding="utf-8")
    orig = src

    # ---------------------------------------------------------------- 1. CSS ----
    inject = "\n" + SHEET_CSS + BASE_CSS + EXTRA_CSS
    src = src[:once(src, "</style>", "style close", page.name)] + inject + src[once(src, "</style>", "style close", page.name):]

    # -------------------------------------------------------------- 2. <main> ----
    # Extract the hero (drop its .notbuilt banner) and the disclosure from the shell,
    # keeping their per-page prose verbatim. Everything between the disclosure and the
    # old <main> close is replaced.
    h0 = once(src, '<header class="p-hero">', "hero open", page.name)
    h1e = src.index("</header>", h0) + len("</header>")
    hero = src[h0:h1e]
    hero, nb = re.subn(r'\s*<div class="notbuilt">.*?</div>\n', "\n", hero, count=1, flags=re.S)
    assert nb == 1, f"{page.name}: expected exactly one .notbuilt banner in the hero"
    assert "notbuilt" not in hero

    d0 = once(src, '<div class="p-disclosure">', "disclosure open", page.name)
    j0 = once(src, '<nav class="p-jump"', "p-jump open", page.name)
    disclosure = src[d0:j0].rstrip()

    body = (SRC / p["body"]).read_text(encoding="utf-8")
    panels = body[once(body, '<div id="sheets">', "sheets mount", p["body"]):].rstrip()

    new_main = (
        "<main>\n"
        "  " + hero.strip() + "\n"
        "  " + disclosure + "\n\n"
        + panels + "\n\n"
        + SURFACES_SECTION % p + "\n"
        "</main>"
    )
    m0 = once(src, "<main>", "main open", page.name)
    m1 = src.index("</main>", m0) + len("</main>")
    src = src[:m0] + new_main + src[m1:]

    # ------------------------------------------------------------- 3. scripts ----
    # DDSheets component, then the tool script, ahead of the kept surfaces loader.
    tool_js = (SRC / p["script"]).read_text(encoding="utf-8").rstrip()
    loader = once(src, f"/* {p['stem']}.html — a section hub with nothing in it yet.", "surfaces loader", page.name)
    loader = src.rfind("<script>", 0, loader)
    assert loader != -1
    scripts = (
        "<script>\n"
        "/* DDSheets — the page-family component, lifted verbatim from cfb.html by\n"
        "   work/build_section_tools.py. See cfb.html for the design notes. */\n"
        + DDSHEETS_JS + "\n</script>\n"
        "<script>\n" + tool_js + "\n</script>\n"
    )
    src = src[:loader] + scripts + src[loader:]

    # --------------------------------------------------------------- 4. guards ----
    assert src != orig, f"{page.name}: nothing changed"
    assert src.count("<main>") == 1 and src.count("</main>") == 1
    assert src.count('id="secCards"') == 1 and src.count('id="secCount"') == 1
    assert src.count('id="sheets"') == 1
    assert '<div class="notbuilt"' not in src, "the notbuilt banner survived"
    assert 'id="plan"' not in src and 'id="machines"' not in src, "a stale stated-intent section survived"
    assert '<nav class="p-jump"' not in src, "the p-jump nav survived"
    assert src.count("window.DDSheets = function") == 1
    assert src.count("DDSheets({key:") == 1, "the tool script's DDSheets() call is missing or doubled"
    assert ".sheetbar{" in src and ".ddstat{" in src and ".ddfig svg" in src, "tool CSS did not land"
    for sh in p["sheets"]:
        assert src.count(f'id="{sh[1:]}"') == 1, f"panel {sh} missing/doubled"
    # the three empty-state strings the suite asserts must all survive as literal copy
    assert "Nothing is built yet." in src and "could not be read" in src
    # no MCP tool id may appear anywhere in the rendered body — these tools have none
    assert not re.search(r"\bdd_[a-z_]+", src[src.index("<main>"):src.index("</main>")]), "an MCP tool id leaked into <main>"
    assert "\r" not in src
    assert src.endswith("</html>\n") or src.endswith("</html>")

    if "--check" not in sys.argv:
        # newline="\n": Path.write_text otherwise translates every \n to the platform
        # newline (\r\n on Windows), which would CRLF the whole file — the Stage 1 pages are
        # LF because their build ran on Linux, and verify-sw hashes them byte-for-byte.
        page.write_text(src, encoding="utf-8", newline="\n")
    print(f"{'checked' if '--check' in sys.argv else 'wrote'} {page.name}: "
          f"{len(orig.encode('utf-8'))} -> {len(src.encode('utf-8'))} bytes "
          f"(+{len(src.encode('utf-8')) - len(orig.encode('utf-8'))})")
