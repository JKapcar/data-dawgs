#!/usr/bin/env python3
"""Release 1 — human-first navigation.

Site-wide mutation across every root *.html that carries a `const NAV` block.
Restores six human-facing groups in the locked order

    Receipts · Arena · NFL · CFB · Data · Dawgs

by demoting Prediction Markets under Arena, the A.I. Model Board under Data,
splitting Sports back into NFL and CFB, and promoting Receipts to top level.
Every page keeps a byte-identical NAV block; the asserts below are the whole
point, per AGENTS.md rule 2 — a page that has drifted fails loudly rather than
silently keeping the old bar.

Toto's MAP is duplicated into the same 29 files and is mutated in the same
pass, so his site map cannot describe a hierarchy the banner no longer has.
"""
import glob
import re
import sys

OLD_NAV_HEAD = '  const NAV = [\n'
NAV_RE = re.compile(r"  const NAV = \[.*?\n  \];\n", re.S)

NEW_NAV = '''  const NAV = [
    /* Receipts is top-level because it is the page the whole site is judged against.
       Burying it under Data made the ledger look like one more dataset. The hashes are
       DDSheets sheet ids, already routed by receipts.html — see its DDSheets({key:"receipts"}). */
    {label:"Receipts", href:"receipts.html", key:"receipts", items:[
      ["receipts.html","Receipts home","receipts"],
      ["receipts.html#scoreboard","Scoreboard","receipts-scoreboard"],
      ["receipts.html#calls","Registered calls","receipts-calls"],
      ["receipts.html#models","Model beliefs","receipts-models"],
      ["receipts.html#provenance","Provenance","pound-provenance"],
    ]},
    /* Arena is split so games can have a little casino character without making tools noisy.
       Prediction Markets sits at the end of Tools: it is a place you go to play, not a domain
       of the site, and a near-empty section does not earn a slot in the banner. */
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
      ["markets.html","Prediction Markets","markets"],
    ]},
    /* NFL and CFB are separate top-level groups again. One "Sports" group meant every
       college reader opened a dropdown built for the NFL and scrolled past it. */
    {label:"NFL", href:"nfl.html", key:"nfl", items:[
      ["nfl.html","NFL hub","nfl"],
      ["stats.html","NFL EPA Stats","stats"],
      ["nfelo.html","nfelo Power Ratings","nfelo"],
      ["calculators.html","NFL Calculators","calculators"],
    ]},
    /* The build roadmap is off the visible dropdown deliberately: it is our own planning
       surface, not a destination. It stays reachable at cfb.html#roadmap and through the
       machine surfaces — removing the nav entry does not remove the page. */
    {label:"CFB", href:"cfb.html", key:"cfb", items:[
      ["cfb.html","College Football Lab","cfb"],
      ["cfb.html#matchup","CFB Matchup Calculator","cfb-matchup"],
    ]},
    {label:"Data", href:"data.html", key:"data", items:[
      ["data.html","The Library","data"],
      ["ai.html","A.I. Model Board","ai"],
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

OLD_MAP_LINES = [
    ("cfb.html — the College Football lab: 2025 results, one retrodictive Elo, "
     "a matchup calculator, the build roadmap.\n"),
    ("markets.html — the prediction-markets section. ai.html — the A.I. section. "
     "Both are deliberately near-empty and say so above the fold; do not imply "
     "either has tools yet.\n"),
    ("signon.html — sign in, sign up, recover an account; every other page's "
     "sign-in chip lands here. dawgs.html — Rollo, the OG Data Dawg.\n"),
]

NEW_MAP_LINES = [
    ("cfb.html — the College Football lab: 2025 results, one retrodictive Elo, "
     "a matchup calculator. Its build roadmap is at cfb.html#roadmap and is our own "
     "planning surface, not a public destination.\n"),
    ("markets.html — the prediction-markets section, reached under Arena. "
     "ai.html — the A.I. Model Board, reached under Data. Neither is a top-level "
     "section. Both are deliberately near-empty and say so above the fold; do not "
     "imply either has tools yet.\n"),
    ("signon.html — sign in, sign up, recover an account; every other page's "
     "sign-in chip lands here. dawgs.html — the Dawg Pound: Rollo, the OG Data Dawg, "
     "and the DDCC profile. swoledawg.html — body and training. "
     "fantasy-warroom.html — the fantasy league war room.\n"),
]

NAV_LINE = (
    "NAVIGATION: the banner is Sign in/account, then exactly six groups — Receipts, "
    "Arena, NFL, CFB, Data, Dawgs — then the theme button. The wordmark is Home. "
    "There is no top-level Sports, Prediction Markets or A.I. group: NFL and CFB are "
    "separate groups, markets.html lives under Arena, and ai.html lives under Data.\n"
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
        for old, new in zip(OLD_MAP_LINES, NEW_MAP_LINES):
            assert new_map.count(old) == 1, f"{f}: MAP line drifted: {old[:48]!r}"
            new_map = new_map.replace(old, new)
        assert new_map.count(NAV_LINE) == 0, f"{f}: MAP already has the nav line"
        anchor = "TIERS: Pup = live and useful"
        assert new_map.count(anchor) == 1, f"{f}: MAP tiers anchor drifted"
        new_map = new_map.replace(anchor, NAV_LINE + anchor)
        s = s.replace(old_map, new_map, 1)

        # newline="" — this repo is LF and Python would otherwise rewrite every
        # line ending on Windows, which corrupts the byte-hash gates.
        with open(f, "w", encoding="utf-8", newline="") as fh:
            fh.write(s)

    print(f"nav + map rewritten in {len(files)} files")


if __name__ == "__main__":
    main()
