#!/usr/bin/env python3
"""
Stage NB — the nav batch. One commit, three IA decisions from 2026-08-10.

  1. The model scoreboard goes FRONT AND CENTRE: receipts.html#models becomes the first
     item in the Receipts group and is labelled what it is.
  2. The DawgHouse comes back into the menu, UNDER RECEIPTS. This reverses the CEP-5A
     Stage 7 off-nav decision on Kap's 8/10 ruling: the shelf is evidence, so it belongs
     with the evidence. It stays its own page; it does not become a sheet.
  3. draft-leagues.html LEAVES the Arena group and moves into the draft hub
     (dashboard.html), where the rooms it creates are actually used.

⚠️ The nav item key for the shelf is "pound", NOT "dawghouse". dawghouse.html declares
   `data-page="pound"`, and the nav highlights an item by `it[2] === page`. A key of
   "dawghouse" would render the item and never light it up, and the Receipts group would
   not read as active on the shelf page. Precedent: "pound-provenance" was kept for
   exactly this reason. Change display labels, not ids.

⚠️ The grading sheet's nav label becomes "Grading" so it stops colliding with the model
   scoreboard. The SHEET TAB on receipts.html still says "Scoreboard" — that relabel
   belongs to the scoreboard stage, which rewrites that panel and its tests. The
   mismatch is deliberate and temporary; both entries deep-link correctly today.

Idempotent-hostile by design: every anchor must appear exactly once or nothing is written.
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
EDITS = []


def stage(name, s, old, new, why):
    n = s.count(old)
    if n != 1:
        raise SystemExit("ANCHOR %s in %s appears %d times, expected 1" % (why, name, n))
    EDITS.append((name, why))
    return s.replace(old, new, 1)


# ---------------------------------------------------------------- the nav pair
RECEIPTS_OLD = '''    {label:"Receipts", href:"receipts.html", key:"receipts", items:[
      ["receipts.html","Pre-registered calls","receipts"],
      ["receipts.html#scoreboard","Scoreboard","receipts-scoreboard"],
      ["receipts.html#models","What models believe","receipts-models"],
      ["receipts.html#provenance","Provenance","pound-provenance"],
    ]},'''

RECEIPTS_NEW = '''    {label:"Receipts", href:"receipts.html", key:"receipts", items:[
      ["receipts.html#models","Model scoreboard","receipts-models"],
      ["receipts.html","Pre-registered calls","receipts"],
      ["receipts.html#scoreboard","Grading","receipts-scoreboard"],
      ["receipts.html#provenance","Provenance","pound-provenance"],
      ["dawghouse.html","The DawgHouse","pound"],
    ]},'''

ARENA_OLD = '''      ["dfs.html","DFS Solver","dfs"],
      ["draft-leagues.html","League setup","draft-leagues"],
      ["guillotine.html","Guillotine Companion","guillotine"],'''

ARENA_NEW = '''      ["dfs.html","DFS Solver","dfs"],
      ["guillotine.html","Guillotine Companion","guillotine"],'''

# --------------------------------------------------- the draft hub takes it in
HUB_OLD = '''    <span class="who" id="dbWho"></span>
  </div>'''

HUB_NEW = '''    <a class="dbsetup" href="draft-leagues.html">League setup &rarr;</a>
    <span class="who" id="dbWho"></span>
  </div>'''

HUB_CSS_OLD = '.dbhead .who{margin-left:auto;font-size:12.5px;color:var(--ink-3)}'
HUB_CSS_NEW = ('.dbhead .who{margin-left:auto;font-size:12.5px;color:var(--ink-3)}\n'
               '/* ⚠️ Sits BEFORE .who in the DOM, so .who keeps the margin-left:auto that pushes the\n'
               '   identity to the far right. Putting the link after .who would move the auto gap and\n'
               '   the two would swap sides. */\n'
               '.dbhead .dbsetup{font-size:12.5px;font-weight:700;color:var(--accent);'
               'text-decoration:none;white-space:nowrap}\n'
               '.dbhead .dbsetup:hover{text-decoration:underline}')

CHIPTAG = re.compile(r'<[a-z]+[^>]*class="tierchip[^"]*"[^>]*>')


def main():
    check = "--check" in sys.argv
    out = {}

    pages = sorted(p for p in ROOT.glob("*.html")
                   if "  const NAV = [\n" in p.read_text(encoding="utf-8"))
    if len(pages) != 25:
        raise SystemExit("expected 25 shared-nav pages, found %d" % len(pages))

    for p in pages:
        s = p.read_text(encoding="utf-8")
        s = stage(p.name, s, RECEIPTS_OLD, RECEIPTS_NEW, "receipts group")
        s = stage(p.name, s, ARENA_OLD, ARENA_NEW, "arena loses league setup")
        out[p] = s

    dash = ROOT / "dashboard.html"
    s = out[dash]
    s = stage(dash.name, s, HUB_OLD, HUB_NEW, "draft hub link")
    s = stage(dash.name, s, HUB_CSS_OLD, HUB_CSS_NEW, "draft hub link css")
    out[dash] = s

    # ---------------------------------------------------------------- postchecks
    blocks = set()
    for p, s in out.items():
        i = s.index("  const NAV = [\n")
        block = s[i:s.index("\n  ];", i)]
        blocks.add(block)
        if '"draft-leagues.html"' in block:
            raise SystemExit("%s: draft-leagues survived in the nav" % p.name)
        if block.count('["dawghouse.html","The DawgHouse","pound"],') != 1:
            raise SystemExit("%s: the shelf item is not in the nav exactly once" % p.name)
        if 'key:"receipts", items:[\n      ["receipts.html#models","Model scoreboard"' not in block:
            raise SystemExit("%s: the model scoreboard is not the first Receipts item" % p.name)
        if s.count('udh.href = "dawghouse.html";') != 1:
            raise SystemExit("%s: the footer shelf link moved" % p.name)
        # the collar work must survive untouched
        tags = CHIPTAG.findall(s)
        if len(tags) > 1:
            raise SystemExit("%s: more than one tier chip" % p.name)
        if tags and 'data-tier="' not in tags[0]:
            raise SystemExit("%s: tier chip lost its data-tier" % p.name)
    if len(blocks) != 1:
        raise SystemExit("the NAV array is no longer identical across pages")

    d = out[dash]
    if d.count('href="draft-leagues.html"') != 1:
        raise SystemExit("dashboard.html does not link draft-leagues exactly once")
    arena = (ROOT / "arena.html").read_text(encoding="utf-8")
    if 'href="draft-leagues.html"' not in arena:
        raise SystemExit("arena.html stopped linking draft-leagues")

    if check:
        for name, why in EDITS:
            print("  %-22s %s" % (name, why))
        print("%d edits across %d files — nothing written" % (len(EDITS), len(out)))
        return
    for p, s in out.items():
        p.write_text(s, encoding="utf-8", newline="")
    print("wrote %d files, %d edits" % (len(out), len(EDITS)))


main()
