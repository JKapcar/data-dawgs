"""
CEP-5A Stage 1a — The Pound is renamed The DawgHouse.

Human-facing labels only. Machine values do NOT move (invariant 13): `tier` stays
"pound", /data/pound-tools.json keeps its name, nav keys stay pound-*. The page moves
to dawghouse.html and pound.html becomes a redirect stub (survivor-settings.html
precedent). The shelf is reduced to genuinely blocked work: complete tools leave.

AGENTS.md rule 2 discipline: every replacement asserts its exact expected count in
every file it touches, and NOTHING is written unless every file agrees. Run from the
repo root:  python3 work/patch-dawghouse-rename.py
"""
import glob
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TODAY = "2026-08-09"

# ---------------------------------------------------------------------------
# The sitewide sweep: the shared nav block, identical on every nav page.
# (old, new, expected-count) — count asserted per file.
SWEEP = [
    ("a plain <a> (Home, The Pound), an",
     "a plain <a> (Home, The DawgHouse), an", None),  # 1 on 20 pages, 0 on bozo.html
    ("— Home · The Pound · Labs · Data · Dawgs. This SUPERSEDES",
     "— Home · The DawgHouse · Labs · Data · Dawgs. This SUPERSEDES", 1),
    ("The Pound now has a shelf: scoreboard, deterministic calculators, inventory and",
     "The DawgHouse now has a shelf: scoreboard, deterministic calculators, inventory and", 1),
    ("`Pound` stays shortened on phones",
     "`DawgHouse` stays shortened on phones", 1),
    ('{label:"The Pound", short:"Pound", href:"pound.html", key:"pound", items:[',
     '{label:"The DawgHouse", short:"DawgHouse", href:"dawghouse.html", key:"pound", items:[', 1),
    ('["pound.html","Tools & Scoreboard","pound","hot"],',
     '["dawghouse.html","Tools & Scoreboard","pound","hot"],', 1),
    ('["pound.html#inventory","Tool Inventory","pound-inventory"],',
     '["dawghouse.html#inventory","The Shelf","pound-inventory"],', 1),
    ('["pound.html#provenance","Provenance","pound-provenance"],',
     '["dawghouse.html#provenance","Provenance","pound-provenance"],', 1),
    ('["pound.html#calculators","Calculators · NFL","pound-calculators"],',
     '["dawghouse.html#calculators","Calculators · NFL","pound-calculators"],', 1),
    ("The calculators live HERE, not in The Pound (Kap, 8/8)",
     "The calculators live HERE, not in The DawgHouse (Kap, 8/8)", 1),
    ('width renders "The PoundPound". */',
     'width renders "The DawgHouseDawgHouse". */', 1),
]

# Pages carrying the shared nav (everything except the two nav-less pages and the
# stub this script itself creates).
NAV_PAGES = sorted(
    f for f in glob.glob(str(ROOT / "*.html"))
    if pathlib.Path(f).name not in ("draft-leagues.html", "survivor-settings.html")
)

# ---------------------------------------------------------------------------
# index.html — the lifecycle card and the manifesto sentence. Kap approved the
# replacement wording on 8/9: "The Pound is no longer empty; every tenant keeps its
# reason and its way back." — adapted to the DawgHouse name, cadence kept.
INDEX_EDITS = [
    ("it goes to The Pound with the reason attached.",
     "it goes to The DawgHouse with the reason attached.", 1),
    ("<!-- The Pound: a kennel run with the gate standing open -->",
     "<!-- The DawgHouse: a kennel run with the gate standing open -->", 1),
    ('<span class="lc-chip">The Pound</span>',
     '<span class="lc-chip">The DawgHouse</span>', 1),
    ("<h3>The Pound</h3>", "<h3>The DawgHouse</h3>", 1),
    ("that's why they go to the Dawg Pound, with the failure, the reason, and the "
     "condition that could reopen the case kept attached. The Pound is empty today. "
     "It will not stay that way forever.</p>",
     "that's why they go to The DawgHouse, with the failure, the reason, and the "
     "condition that could reopen the case kept attached. "
     '<a href="dawghouse.html" style="color:var(--accent);font-weight:700;'
     'text-decoration:none">The DawgHouse</a> is no longer empty; every tenant keeps '
     "its reason and its way back.</p>", 1),
    # The 2026-08-07 update note is deleted outright: the sentence it corrected now
    # says the true thing itself.
    ('\n            <p class="udnote"><b>Update · 2026-08-07:</b> the shelf is no '
     'longer empty. <a href="pound.html" style="color:var(--accent);font-weight:700">'
     "Open the model and calculator workbench</a>; every blocked tool keeps its reason "
     "and minimum rehabilitation path attached.</p>", "", 1),
]

# ---------------------------------------------------------------------------
# dawghouse.html — derived from pound.html (after the sweep), page-specific edits.
DAWGHOUSE_EDITS = [
    ("<title>The Pound · Data Dawgs</title>",
     "<title>The DawgHouse · Data Dawgs</title>", 1),
    ("/* ---- The Pound --------------------------------------------------------- */",
     "/* ---- The DawgHouse ------------------------------------------------------ */", 1),
    ('<div class="p-kicker">The Pound · Worker tools live 2026-08-07 · forecasts locked 2026-08-08</div>',
     '<div class="p-kicker">The DawgHouse · Worker tools live 2026-08-07 · forecasts locked 2026-08-08</div>', 1),
    ('title="Why this work is in The Pound">The Pound</a></h1>',
     'title="Why this work is in The DawgHouse">The DawgHouse</a></h1>', 1),
    ('aria-label="The Pound sections"', 'aria-label="The DawgHouse sections"', 1),
    # The Upside Down map keys are filename stems; this page's stem changed.
    ('"pound":"/data/pound-tools.json"', '"dawghouse":"/data/pound-tools.json"', 1),
    ('"pound":["/data/model-contracts.json","/data/upstream-models.json"],',
     '"dawghouse":["/data/model-contracts.json","/data/upstream-models.json"],', 1),
    ('<a href="#inventory">Tool inventory</a>', '<a href="#inventory">The shelf</a>', 1),
    # The shelf holds only blocked work now. The complete tools leave; the full
    # inventory, complete rows included, stays machine-readable in pound-tools.json.
    ("<header><div><h2>Every requested tool</h2><p class=\"dek\">Nothing disappears "
     "because it is hard. Complete means the requested human, contract and MCP layers "
     "are live; blocked work keeps its exact blocker and minimum path.</p></div>"
     "<label class=\"p-meta\" for=\"toolFilter\">Filter status<br><select "
     "class=\"p-filter\" id=\"toolFilter\"><option value=\"all\">All</option>"
     "<option>complete</option><option>ready</option><option>frontend-only</option>"
     "<option>backend-blocked</option><option>data-blocked</option></select></label></header>",
     "<header><div><h2>The shelf</h2><p class=\"dek\">Nothing disappears because it is "
     "hard: only blocked work lives here, and every entry keeps its exact blocker and "
     "minimum path back. The complete NFL tools left the shelf on 2026-08-09 — they "
     "work where they live. The full inventory, complete rows included, stays "
     "machine-readable in <a href=\"/data/pound-tools.json\"><code>/data/pound-tools.json"
     "</code></a>.</p></div><label class=\"p-meta\" for=\"toolFilter\">Filter status<br>"
     "<select class=\"p-filter\" id=\"toolFilter\"><option value=\"all\">All</option>"
     "<option>frontend-only</option><option>backend-blocked</option>"
     "<option>data-blocked</option></select></label></header>", 1),
    ('allTools=env.data.filter(t=>(t.kind||"tool")==="tool");',
     'allTools=env.data.filter(t=>(t.kind||"tool")==="tool"&&t.status!=="complete");', 1),
]

POUND_STUB = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Pound is now The DawgHouse · Data Dawgs</title>
<link rel="canonical" href="https://datadawgs216.com/dawghouse.html">
<meta name="robots" content="noindex">
<!-- The Pound was renamed The DawgHouse on 8/9/26; the rename is recorded in Receipts
     as a material change. This stub stays because the old URL was live, sat in sw.js
     CORE, and may be bookmarked or already cached on a phone. Deleting it would 404
     those; a redirect costs 1.5 KB. Machine surfaces deliberately keep the stored
     value `pound`: /data/pound-tools.json and tier:"pound" did not move.
     ⚠️ replace(), not href = — assigning would leave the stub in history and trap the
     back button in a loop between the two. -->
<script>/* The hash survives the hop on purpose: every section id this page ever had
     (#scoreboard, #calculators, #inventory, #cfb, #provenance, #machines) exists
     unchanged on dawghouse.html. Query string goes BEFORE the fragment — same trap
     survivor-settings.html documents. */
location.replace("dawghouse.html"+location.search+location.hash);</script>
<meta http-equiv="refresh" content="0;url=dawghouse.html">
<style>body{font:15px system-ui,sans-serif;background:#161009;color:#c8c1b4;margin:0;
  display:grid;place-items:center;height:100vh;text-align:center;padding:24px}
a{color:#ff6a02}</style>
</head>
<body>
<p>The Pound is now The DawgHouse.<br>
<a href="dawghouse.html">Continue &rarr;</a></p>
</body>
</html>
"""

# ---------------------------------------------------------------------------
# receipts.html — the rename recorded as a material change, in the Method sheet.
RECEIPTS_CARD = """
  <div class="card">
    <h2>Material changes</h2>
    <p class="muted" style="margin-top:0">Changes to how this site names or frames its
    claims, recorded here rather than applied silently. The forecast rows are covered by
    the hash above; this list covers what the hash cannot see.</p>
    <p><b>2026-08-09 &mdash; The Pound is renamed The DawgHouse.</b> Human-facing labels
    only: the shelf tier reads &ldquo;The DawgHouse&rdquo; wherever a person sees it, and
    /pound.html forwards to /dawghouse.html. Stored machine values did not move &mdash;
    <code>tier</code> stays <code>"pound"</code> and /data/pound-tools.json keeps its
    name &mdash; so nothing downstream re-keys. No forecast, probability or benchmark
    changed. The same day, the shelf was reduced to genuinely blocked work: the complete
    NFL tools left it, and the full inventory stays machine-readable in
    <a href="/data/pound-tools.json"><code>/data/pound-tools.json</code></a>.</p>
  </div>
"""
RECEIPTS_ANCHOR = "receipts against a benchmark declared in advance.</p>\n  </div>\n</div>"

RECEIPTS_METHOD_MD = """
## Material changes

Changes to how this site names or frames its claims, recorded rather than applied
silently. The forecast rows are covered by the hash above; this list covers what the
hash cannot see.

- **2026-08-09 — The Pound is renamed The DawgHouse.** Human-facing labels only:
  /pound.html forwards to /dawghouse.html. Stored machine values did not move — `tier`
  stays `pound` and /data/pound-tools.json keeps its name. No forecast, probability or
  benchmark changed. The same day the shelf was reduced to genuinely blocked work; the
  complete NFL tools left it. Full inventory: /data/pound-tools.json.
"""

LLMS_EDITS = [
    ("Tiers: `labs` is challenged; `dawg` validated; `pound` shelved.",
     "Tiers: `labs` is challenged; `dawg` validated; `pound` shelved — The DawgHouse.", 1),
    ("## The Pound", "## The DawgHouse", 1),
    ("- [Workbench](https://datadawgs216.com/pound.html): model scoreboard and deterministic calculators.",
     "- [Workbench](/dawghouse.html): model scoreboard and deterministic calculators.", 1),
]

SITEMAP_EDITS = [
    ("<url><loc>https://datadawgs216.com/pound.html</loc><lastmod>2026-08-08</lastmod></url>",
     "<url><loc>https://datadawgs216.com/dawghouse.html</loc><lastmod>2026-08-09</lastmod></url>", 1),
]

SW_EDITS = [
    ('"/survivor-settings.html", "/pound.html",',
     '"/survivor-settings.html", "/pound.html", "/dawghouse.html",', 1),
]

BUILD_DATA_EDITS = [
    ("  pound: 'The Pound — shelved, with the reason attached.',",
     "  pound: 'The DawgHouse (formerly The Pound) — shelved, with the reason attached.',", 1),
    ("""  if (label.startsWith('dawg')) return TIERS.dawg;
  if (label.includes('pound')) return TIERS.pound;""",
     """  /* ⚠️ ORDER MATTERS. "The DawgHouse" starts with "dawg" — test the shelf tier
     first, or the shelved page is promoted to a collar by its own rename. */
  if (label.includes('dawghouse') || label.includes('pound')) return TIERS.pound;
  if (label.startsWith('dawg')) return TIERS.dawg;""", 1),
    ("{ id: 'pound', name: 'The Pound model and calculator workbench', page: '/pound.html',",
     "{ id: 'pound', name: 'The DawgHouse model and calculator workbench (formerly The Pound)', page: '/dawghouse.html',", 1),
    ("existing_website_implementation: id === 'nfelo' ? '/nfelo.html + /pound.html#scoreboard'",
     "existing_website_implementation: id === 'nfelo' ? '/nfelo.html + /dawghouse.html#scoreboard'", 1),
    (": id === 'model-scoreboard' ? '/pound.html#scoreboard'",
     ": id === 'model-scoreboard' ? '/dawghouse.html#scoreboard'", 1),
    (": id === 'disagreement' ? '/pound.html#scoreboard + /pound.html#calculators'",
     ": id === 'disagreement' ? '/dawghouse.html#scoreboard + /dawghouse.html#calculators'", 1),
    (": calculatorIds.has(id) ? '/pound.html#calculators' : '/pound.html#inventory',",
     ": calculatorIds.has(id) ? '/dawghouse.html#calculators' : '/dawghouse.html#inventory',", 1),
    ("notes: 'The Pound includes an independent transparent HFA calculator",
     "notes: 'The DawgHouse includes an independent transparent HFA calculator", 1),
    ("notes: 'The Pound implementation uses Data Dawgs published normal-margin parameters",
     "notes: 'The DawgHouse implementation uses Data Dawgs published normal-margin parameters", 1),
    ("The Pound does not copy it and clearly labels its simpler pregame approximation",
     "The DawgHouse does not copy it and clearly labels its simpler pregame approximation", 1),
]


def apply(text, edits, label):
    """Apply (old, new, count) pairs; None count means 0-or-1. Abort on any mismatch."""
    for old, new, count in edits:
        n = text.count(old)
        want = "0 or 1" if count is None else str(count)
        if (count is None and n > 1) or (count is not None and n != count):
            sys.exit(f"ABORT (nothing written): {label}: {n} of expected {want} for\n  {old[:90]!r}")
        if n:
            text = text.replace(old, new)
    return text


def main():
    staged = {}

    # 1. sweep every nav page (pound.html transforms in memory, then becomes the base
    #    for dawghouse.html)
    for f in NAV_PAGES:
        p = pathlib.Path(f)
        s = p.read_text(encoding="utf-8")
        s = apply(s, SWEEP, p.name)
        staged[p] = s

    # box-models comment coverage check: exactly one page (bozo) legitimately lacks it
    missing = [p.name for p, s in staged.items()
               if "a plain <a> (Home, The DawgHouse), an" not in s]
    if missing != ["bozo.html"]:
        sys.exit(f"ABORT: box-models comment coverage unexpected: {missing}")

    # 2. index.html extras
    idx = ROOT / "index.html"
    staged[idx] = apply(staged[idx], INDEX_EDITS, "index.html")
    if "Update · 2026-08-07" in staged[idx]:
        sys.exit("ABORT: the 2026-08-07 update note survived deletion")

    # 3. dawghouse.html derived from swept pound.html; pound.html becomes the stub
    pound = ROOT / "pound.html"
    dawghouse = ROOT / "dawghouse.html"
    if dawghouse.exists():
        sys.exit("ABORT: dawghouse.html already exists")
    staged[dawghouse] = apply(staged[pound], DAWGHOUSE_EDITS, "dawghouse.html")
    staged[pound] = POUND_STUB

    # 4. receipts.html material-change card
    rc = ROOT / "receipts.html"
    if staged[rc].count(RECEIPTS_ANCHOR) != 1:
        sys.exit("ABORT: receipts.html sheetMethod anchor not unique")
    staged[rc] = staged[rc].replace(
        RECEIPTS_ANCHOR,
        "receipts against a benchmark declared in advance.</p>\n  </div>\n"
        + RECEIPTS_CARD + "</div>")

    # 5. receipts-method.md mirror
    md = ROOT / "data" / "receipts-method.md"
    mds = md.read_text(encoding="utf-8")
    if "## Material changes" in mds:
        sys.exit("ABORT: receipts-method.md already has a Material changes section")
    staged[md] = mds.rstrip("\n") + "\n" + RECEIPTS_METHOD_MD

    # 6. llms.txt, sitemap.xml, sw.js CORE
    for name, edits in (("llms.txt", LLMS_EDITS), ("sitemap.xml", SITEMAP_EDITS),
                        ("sw.js", SW_EDITS)):
        p = ROOT / name
        staged[p] = apply(p.read_text(encoding="utf-8"), edits, name)

    # 7. tools/build-data.js
    bd = ROOT / "tools" / "build-data.js"
    staged[bd] = apply(bd.read_text(encoding="utf-8"), BUILD_DATA_EDITS, "build-data.js")

    # everything verified — now write
    for p, s in staged.items():
        p.write_text(s, encoding="utf-8")
    print(f"wrote {len(staged)} files "
          f"({len(NAV_PAGES)} swept pages + stub, receipts card, md mirror, "
          f"llms/sitemap/sw, build-data)")
    print("now run: DD_BUILD_DATE=%s node tools/build-data.js && node tools/validate-data.js" % TODAY)


if __name__ == "__main__":
    main()
