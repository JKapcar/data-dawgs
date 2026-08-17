#!/usr/bin/env python3
"""Release 1b — Kap's correction to the Release 1 banner, 2026-08-17.

Release 1 shipped the shape its handoff locked: Receipts promoted to top level,
Prediction Markets demoted under Arena, the A.I. Model Board demoted under Data.
Kap read it live and reversed three of those calls the same day. The banner is now

    Arena · Markets · A.I. · NFL · CFB · Data · Dawgs

Markets and A.I. are top-level sections again, sitting between Arena and the sport
groups — the "not football" block, where they were before Release 1. Receipts goes
back to being an item inside Data. What Release 1 keeps: NFL and CFB stay split,
the CFB build roadmap stays off the visible dropdown, and the Dawgs dropdown stays
at its five destinations rather than the old thirteen.

The top-level label is "Markets", not "Prediction Markets" — Kap's call. Seven
groups do not fit one row at 1100px while that label carries the longer word;
work/test-nav-fit.mjs names it as the single change that recovers the row. The
phone label stays "Mkts" via `short`.
"""
import glob
import re
import sys

OLD_NAV_HEAD = '  const NAV = [\n'
NAV_RE = re.compile(r"  const NAV = \[.*?\n  \];\n", re.S)

NEW_NAV = '''  const NAV = [
    /* Arena is split so games can have a little casino character without making tools noisy. */
    {label:"Arena", href:"arena.html", key:"arena", items:[
      ["arena.html","Arena home","arena"],
      ["#","Games","nav-section"],
      ["dashboard.html","Fantasy Draft Dashboard","dashboard","hot"],
      ["bozo.html","Bozo","bozo"],
      ["challenge.html","NFL Forecasting Challenge","challenge"],
      ["teamdraft.html","NFL Team Draft","teamdraft"],
      ["#","Tools","nav-section"],
      ["dfs.html","DFS Solver","dfs"],
      ["fantasy-warroom.html","Fantasy League War Room","fantasy-warroom"],
      ["guillotine.html","Last Dawg Standing","guillotine"],
      ["survivor.html","Survivor","survivor"],
    ]},
    /* Two sections that are not football, placed where they were asked for: after the
       games people play against each other, before the sport pages. Release 1 demoted
       both and Kap reversed it the same day — they are domains of the site, not tools
       inside somebody else's group.
       ⚠️ The label is "Markets", not "Prediction Markets". Seven groups only hold one
       row at 1100px with the short form; see the 1100 note in work/test-nav-fit.mjs. */
    {label:"Markets", short:"Mkts", href:"markets.html", key:"markets", items:[
      ["markets.html","The markets work","markets"],
    ]},
    {label:"A.I.", href:"ai.html", key:"ai", items:[
      ["ai.html","A.I. Model Board","ai"],
    ]},
    /* NFL and CFB are separate top-level groups. One "Sports" group meant every college
       reader opened a dropdown built for the NFL and scrolled past it. */
    {label:"NFL", href:"nfl.html", key:"nfl", items:[
      ["nfl.html","NFL hub","nfl"],
      ["stats.html","NFL EPA Stats","stats"],
      ["nfelo.html","nfelo Power Ratings","nfelo"],
      ["calculators.html","NFL Calculators","calculators"],
    ]},
    /* The build roadmap is off the visible dropdown deliberately: it is our own planning
       surface, not a destination. It stays reachable on the page and through the machine
       surfaces — removing the nav entry does not remove it. */
    {label:"CFB", href:"cfb.html", key:"cfb", items:[
      ["cfb.html","College Football Lab","cfb"],
      ["cfb.html#matchup","CFB Matchup Calculator","cfb-matchup"],
    ]},
    /* Receipts is an item here, not a top-level group. Release 1 promoted it on the
       argument that it is the page the site is judged against; Kap's ruling is that
       being the evidence does not make it a domain, and it reads as one of the Library's
       holdings. The deep links into its sheets went with the promotion — receipts.html
       carries its own sheet bar, which is the better place for them. */
    {label:"Data", href:"data.html", key:"data", items:[
      ["data.html","The Library","data"],
      ["receipts.html","Receipts","receipts"],
      ["master.html","Master Data","master"],
      ["strategy.html","2026 Strategy","strategy"],
    ]},
    /* Was thirteen entries, nine of them deep links into one DawgHouse page. The shelf
       inventory belongs on the shelf, not in a dropdown nobody could read on a phone. */
    {label:"Dawgs", href:"dawgs.html", key:"dawgs", items:[
      ["dawgs.html","The Dawg Pound","dawgs"],
      ["dawgs.html#rollo","Rollo · OG Data Dawg","dawgs-rollo"],
      ["dawgs.html#ddcc","DDCC Profile","dawgs-ddcc"],
      ["swoledawg.html","SwoleDawg · Body & Training","swoledawg"],
      ["dawghouse.html","The DawgHouse","pound"],
    ]},
  ];
'''

MAP_RE = re.compile(r"const MAP = `SITE MAP.*?`;\n", re.S)

OLD_MAP_NAV = (
    "NAVIGATION: the banner is Sign in/account, then exactly six groups — Receipts, "
    "Arena, NFL, CFB, Data, Dawgs — then the theme button. The wordmark is Home. "
    "There is no top-level Sports, Prediction Markets or A.I. group: NFL and CFB are "
    "separate groups, markets.html lives under Arena, and ai.html lives under Data.\n"
)
NEW_MAP_NAV = (
    "NAVIGATION: the banner is Sign in/account, then exactly seven groups — Arena, "
    "Markets, A.I., NFL, CFB, Data, Dawgs — then the theme button. The wordmark is Home. "
    "There is no top-level Sports group and no top-level Receipts group: NFL and CFB are "
    "separate groups, and receipts.html is an item under Data.\n"
)

OLD_MAP_SECTIONS = (
    "markets.html — the prediction-markets section, reached under Arena. "
    "ai.html — the A.I. Model Board, reached under Data. Neither is a top-level "
    "section. Both are deliberately near-empty and say so above the fold; do not "
    "imply either has tools yet.\n"
)
NEW_MAP_SECTIONS = (
    "markets.html — the prediction-markets section, its own top-level group labelled "
    "Markets. ai.html — the A.I. Model Board, its own top-level group. Both are "
    "deliberately near-empty and say so above the fold; do not imply either has tools yet.\n"
)


def main():
    files = sorted(f for f in glob.glob("*.html")
                   if OLD_NAV_HEAD in open(f, encoding="utf-8").read())
    if not files:
        sys.exit("no page carries a NAV block — wrong directory?")

    for f in files:
        s = open(f, encoding="utf-8").read()

        assert len(NAV_RE.findall(s)) == 1, f"{f}: NAV block count != 1"
        s = NAV_RE.sub(lambda _m: NEW_NAV, s, count=1)

        assert len(MAP_RE.findall(s)) == 1, f"{f}: MAP block count != 1"
        old_map = MAP_RE.search(s).group(0)
        new_map = old_map
        for old, new in ((OLD_MAP_NAV, NEW_MAP_NAV), (OLD_MAP_SECTIONS, NEW_MAP_SECTIONS)):
            assert new_map.count(old) == 1, f"{f}: MAP line drifted: {old[:48]!r}"
            new_map = new_map.replace(old, new)
        s = s.replace(old_map, new_map, 1)

        # newline="" — this repo is LF; Python would otherwise rewrite every line
        # ending on Windows and corrupt the byte-hash gates.
        with open(f, "w", encoding="utf-8", newline="") as fh:
            fh.write(s)

    print(f"nav + map rewritten in {len(files)} files")


if __name__ == "__main__":
    main()
