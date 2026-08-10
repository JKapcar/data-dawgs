"""
CEP-5A Stage 7 — the nav flip. THE one true sitewide sweep of this reorg.

Kap's locked top-level order:  Sign in · Receipts · Arena · NFL · CFB · Data · Dawgs

⚠️ THE DISCIPLINE (AGENTS.md rule 2, and the reason this script exists):
every edit below is applied to ALL 25 nav pages with an EXACT expected count per file,
computed first. If ANY file disagrees on ANY anchor, the script prints the disagreement
and writes NOTHING. A half-applied nav is worse than no nav change: the flattened HTML is
the source, and the pages would silently disagree about what the site contains.

⚠️ WHAT DOES NOT MOVE. Machine values keep their names — tier is still "pound",
/data/pound-tools.json keeps its filename, and the nav keys below keep their historical
spellings (`pound-provenance`). A tier is a maturity claim; the nav is an address. Keeping
those two apart is the whole of CEP-5A, so renaming a stored value to match a menu would
be the exact mistake this stage exists to undo.

⚠️ auction.html and bigboard.html stay deliberately UNLINKED (AGENTS.md / the old nav
comment). They are operator pages that run draft night. Do not "restore" them here.

⚠️ THE DAWGHOUSE AND LABS LEAVE THE MENU. That was the point: a shelf of blocked work is
not a destination people should be routed to. The DawgHouse becomes reachable from the
foot of EVERY page (the .udfoot row, which the shared nav script injects sitewide and is
the only footer markup identical on all 28 files) and from the lifecycle section on
index.html#tiers, which is where "where ideas go when the evidence says stop" belongs.

⚠️ "Sign in" IS THE navauth SECTION, not a seventh dropdown. The banner has carried
sign-in as its own section since 8/7; it is appended to the nav BEFORE the links, it
routes to signon.html?next=, and it shows who you are once you are signed in. Adding a
menu item with the same label would put two identical controls in one bar and make the
signed-in state ambiguous. The locked order is satisfied by the section that already
holds that position and already carries the state.

Run:  cd work && python3 patch-nav-flip.py
"""
import pathlib, sys

REPO = pathlib.Path(__file__).resolve().parent.parent
PAGES = sorted(p for p in REPO.glob("*.html"))

NAV_START = "  /* ⚠️ 8/5, second nav change today"
NAV_END = "\n  ];"

NEW_NAV = '''  /* ⚠️ CEP-5A Stage 7, 2026-08-09. THE NAV IS NO LONGER THE TIER LADDER. It supersedes
     the 8/5 note that said it was. Kap's locked order:
         Sign in · Receipts · Arena · NFL · CFB · Data · Dawgs
     The menu now answers "what kind of thing is this", and the CHIP on each page answers
     "how far along is it". Those had been collapsed onto one axis since 8/5, which is how
     a shelf of blocked work ended up being a top-level destination.

     ⚠️ NO "Home" ITEM — the wordmark is already an <a> to index.html.
     ⚠️ NO "Sign in" ITEM — sign-in is its own banner section (.navauth, 8/7), appended
        before these links, routing to signon.html?next= and showing who you are once you
        are in. A menu item with the same label would be a second identical control.
     ⚠️ NO LIVE DRAFT top-level item — the pill was retired 8/1; Live is a Dashboard tab.
     ⚠️ THE DAWGHOUSE AND LABS ARE OFF-NAV. The shelf is linked from the .udfoot row at
        the foot of every page and from the lifecycle section on index.html#tiers.
     ⚠️ auction.html and bigboard.html stay deliberately unlinked. They run draft night
        from the operator machine. Do not "restore" them here.
     ⚠️ Machine values did not move: tier is still "pound" and the keys below keep their
        historical spellings.
     Keep this array identical on every page; the flattened HTML is the source. */
  const NAV = [
    {label:"Receipts", href:"receipts.html", key:"receipts", items:[
      ["receipts.html","Pre-registered calls","receipts"],
      ["receipts.html#scoreboard","Scoreboard","receipts-scoreboard"],
      ["receipts.html#models","What models believe","receipts-models"],
      ["receipts.html#provenance","Provenance","pound-provenance"],
    ]},
    /* Arena = the surfaces where a person competes against other people. */
    {label:"Arena", href:"arena.html", key:"arena", items:[
      ["arena.html","All the games","arena"],
      ["bozo.html","Bozo","bozo"],
      ["dashboard.html","Fantasy Draft Dashboard","dashboard","hot"],
      ["dfs.html","DFS Solver","dfs"],
      ["draft-leagues.html","League setup","draft-leagues"],
      ["guillotine.html","Guillotine Companion","guillotine"],
      ["survivor.html","Survivor","survivor"],
    ]},
    {label:"NFL", href:"nfl.html", key:"nfl", items:[
      ["nfl.html","The NFL work","nfl"],
      ["stats.html","NFL EPA Stats","stats"],
      ["nfelo.html","nfelo Power Ratings","nfelo"],
      ["calculators.html","Calculators · NFL","calculators"],
    ]},
    {label:"CFB", href:"cfb.html", key:"cfb", items:[
      ["cfb.html","College Football Lab","cfb"],
      ["cfb.html#matchup","Calculators · CFB matchup","cfb-matchup"],
      ["cfb.html#roadmap","Build roadmap","cfb-roadmap"],
    ]},
    {label:"Data", href:"data.html", key:"data", items:[
      ["data.html","The Library","data"],
      ["master.html","Master Data","master"],
      ["strategy.html","2026 Strategy","strategy"],
    ]},
    {label:"Dawgs", href:"index.html#tiers", items:[
      ["index.html#tiers","How the tiers work","tiers"],
      ["dawgs.html","Rollo · OG Data Dawg","dawgs"],
    ]},
  ];'''

CSS_OLD = ".udfoot{display:flex;justify-content:center;padding:20px 0 4px}"
CSS_NEW = (".udfoot{display:flex;justify-content:center;align-items:center;gap:10px;flex-wrap:wrap;padding:20px 0 4px}\n"
           "/* ⚠️ CEP-5A Stage 7: the DawgHouse link lives in this row because the row is the only\n"
           "   footer markup identical on all 28 pages — the <footer> elements themselves are not.\n"
           "   The shelf is off-nav on purpose; this is how it stays reachable. */\n"
           ".udhouse{border:1px dashed var(--border);border-radius:8px;color:var(--ink-3);text-decoration:none;"
           "padding:5px 10px;font:700 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace}\n"
           ".udhouse:hover{border-color:var(--accent);color:var(--accent)}\n"
           ':root[data-theme="light"] .udhouse{border-color:rgba(236,223,201,0.40);color:var(--navink2)}\n'
           ':root[data-theme="light"] .udhouse:hover{border-color:#ff8a4d;color:#ff8a4d}')

JS_OLD = "  udrow.appendChild(udb);"
JS_NEW = ('''  /* ⚠️ CEP-5A Stage 7: THE DAWGHOUSE LIVES HERE NOW, not in the menu. A shelf of blocked
     work is not somewhere to route people; it is somewhere to be able to look. This row is
     injected on every page, so one edit here reaches all 28 — the <footer> elements are not
     identical and could not carry it. */
  const udh = document.createElement("a");
  udh.className = "udhouse"; udh.href = "dawghouse.html";
  udh.textContent = "The DawgHouse";
  udh.title = "The shelf: work that is blocked, with the reason and the way back attached";
  udrow.appendChild(udh);
  udrow.appendChild(udb);''')

# index.html only — the lifecycle section is the other half of "off-nav, not unreachable"
IDX_OLD = ('            <span class="lc-chip">The DawgHouse</span>\n'
           '            <h3>The DawgHouse</h3>\n')
IDX_NEW = ('            <span class="lc-chip">The DawgHouse</span>\n'
           '            <h3><a href="dawghouse.html">The DawgHouse</a></h3>\n')


# ⚠️ THE ROW WAS RE-MEASURED, BECAUSE ITS CONTENTS CHANGED.
# The old 419px comment ends: "Re-measure all three if anything is ever added to this row
# again." Stage 7 went from five groups to six, so it was. Measured on the flipped nav,
# element-vs-element (nothing overflows the document, so the 320/390/1280 sweep in
# test-udfoot.mjs stays green through every one of these):
#     320px  auth chip painted over by the links run, 49.5 x 23.0 px
#     360px  16.3 x 23.0
#     420px  the wordmark comes back and there is no room for it, 45.0 x 23.5
#     460px  26.8 x 23.5
# .links is flex:1 1 auto with min-width:0 and justify-content:flex-end, so when it does
# not fit it is SQUEEZED and spills LEFT over the brand and the sign-in chip. A bounds
# check cannot see that. Same lesson as the fixed-element collision tests.
#
# Two fixes, each with its reason:
#  1. The wordmark stays hidden to 519px instead of 419px. It is the only thing on the bar
#     duplicated by something beside it (the logo mark), and dropping it is what closes the
#     420-519 deficit.
#  2. Below 420px the links take their own row. Six groups plus a sign-in chip plus a theme
#     button do not fit one 320px bar at a legible size — closing a 49px gap with type
#     alone needs ~7.6px text. The one-row rule above was written for FIVE shorter groups
#     and still holds from 420 up.
RESP_OLD_MEDIA = "@media(max-width:419px){\n  .sitenav .brand .logo{display:none}"
RESP_NEW_MEDIA = ("@media(max-width:519px){\n  .sitenav .brand .logo{display:none}\n}\n"
                  "@media(max-width:419px){\n"
                  "  /* ⚠️ CEP-5A Stage 7: the links get their own row here. See the note above. */\n"
                  "  .sitenav{flex-wrap:wrap}\n"
                  "  .sitenav .links{flex:1 1 100%;margin-left:0;justify-content:flex-start;flex-wrap:wrap;gap:2px 5px;padding-top:3px}\n"
                  "  /* ⚠️ NO margin-left:auto on the theme button here. In a WRAPPING flex row an\n"
                  "     auto margin eats every pixel of free space, which forced a third line at 320px\n"
                  "     with 16px to spare. Let it sit inline with the links. */\n"
                  "  .sitenav .links .theme-btn{margin-left:2px}")
RESP_OLD_PAD = "  .sitenav .links a,.sitenav .links .grpbtn{padding:4px 2px}"
RESP_NEW_PAD = "  .sitenav .links a,.sitenav .links .grpbtn{padding:4px 4px;font-size:11px}"

def nav_block(text):
    i = text.find(NAV_START)
    if i < 0:
        return None
    j = text.find(NAV_END, i)
    if j < 0:
        return None
    return text[i:j + len(NAV_END)]


# ------------------------------------------------------------------ survey ----
# Count every anchor on every file BEFORE writing anything. This is the step that
# makes a sitewide sweep safe: a page that has drifted shows up here, not halfway
# through a set of writes.
plan, problems, skipped = {}, [], []
navs = set()
for p in PAGES:
    s = p.read_text(encoding="utf-8")
    has_nav = "  const NAV = [\n" in s
    if not has_nav:
        skipped.append(p.name)
        for anchor, name in ((CSS_OLD, "udfoot css"), (JS_OLD, "udrow js")):
            if anchor in s:
                problems.append(f"{p.name}: has {name} but no NAV — unexpected shape")
        continue
    blk = nav_block(s)
    if blk is None:
        problems.append(f"{p.name}: NAV present but the 8/5 comment header is missing")
        continue
    navs.add(blk)
    counts = {"nav": s.count(blk), "css": s.count(CSS_OLD), "js": s.count(JS_OLD),
              "419 media": s.count(RESP_OLD_MEDIA), "link padding": s.count(RESP_OLD_PAD)}
    for k, n in counts.items():
        if n != 1:
            problems.append(f"{p.name}: {k} anchor appears {n} times, expected 1")
    plan[p] = (s, blk)

if len(navs) != 1:
    problems.append(f"the NAV block is NOT identical across pages: {len(navs)} variants")
if len(plan) != 25:
    problems.append(f"expected 25 nav pages, found {len(plan)}")
if sorted(skipped) != ["draft-leagues.html", "pound.html", "survivor-settings.html"]:
    problems.append(f"unexpected set of nav-less pages: {sorted(skipped)}")

idx = REPO / "index.html"
if idx.read_text(encoding="utf-8").count(IDX_OLD) != 1:
    problems.append("index.html: the lifecycle DawgHouse heading anchor is not unique")

if problems:
    print("ABORTED — nothing written:")
    for x in problems:
        print("  " + x)
    sys.exit(1)

# ------------------------------------------------------- build, THEN write ----
# ⚠️ Build every output in memory and check it BEFORE the first write. The survey above
# catches drift in the inputs; this catches a bad transform. If either fires halfway
# through a write loop the tree is left half-flipped, which is the one outcome a sitewide
# sweep must never produce.
built = {}
for p, (s, blk) in plan.items():
    out = (s.replace(blk, NEW_NAV, 1).replace(CSS_OLD, CSS_NEW, 1).replace(JS_OLD, JS_NEW, 1)
           .replace(RESP_OLD_MEDIA, RESP_NEW_MEDIA, 1).replace(RESP_OLD_PAD, RESP_NEW_PAD, 1))
    checks = {
        "NAV survived": "  const NAV = [\n" in out,
        "DawgHouse label gone": 'label:"The DawgHouse"' not in out,
        "DawgHouse nav href gone": 'href:"dawghouse.html"' not in out,
        "Labs group gone": 'label:"Labs"' not in out,
        "no Home item": '{label:"Home"' not in out,
        "six groups": sum(out.count('{label:"%s"' % g) for g in
                          ("Receipts", "Arena", "NFL", "CFB", "Data", "Dawgs")) == 6,
        "shelf link added once": out.count('udh.href = "dawghouse.html";') == 1,
        "shelf css added once": out.count("\n.udhouse{") == 1,
        "auction stays unlinked": '"auction.html"' not in out.split("const NAV = [")[1].split("\n  ];")[0],
        "bigboard stays unlinked": '"bigboard.html"' not in out.split("const NAV = [")[1].split("\n  ];")[0],
        "all-LF": "\r" not in out,
        "wordmark hidden to 519": out.count("@media(max-width:519px){") == 1,
        "links wrap below 420": out.count(".sitenav{flex-wrap:wrap}") == 1,
        "old 419 wordmark rule replaced": out.count(RESP_OLD_MEDIA) == 0,
    }
    bad = [k for k, v in checks.items() if not v]
    if bad:
        problems.append(f"{p.name}: transform failed — {', '.join(bad)}")
    built[p] = out

if problems:
    print("ABORTED after building — nothing written:")
    for x in problems:
        print("  " + x)
    sys.exit(1)

for p, out in built.items():
    p.write_text(out, encoding="utf-8")
idx.write_text(idx.read_text(encoding="utf-8").replace(IDX_OLD, IDX_NEW, 1), encoding="utf-8")

print(f"nav flipped on {len(plan)} pages; {len(skipped)} nav-less pages untouched ({', '.join(sorted(skipped))})")
print("index.html lifecycle card now links the shelf")
