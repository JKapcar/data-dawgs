"""
Sitewide nav pass for cfb.html, plus the Upside Down mirror entry.

⚠️ AGENTS.md rule 2: a sitewide change is the SAME edit on every *.html, applied with
`assert s.count(old) == 1` per file. The assert is the whole point — it catches a page
that has drifted, and a partial nav edit silently reverts upstream work with no conflict.

Four changes, five anchored pairs, applied to the 21 files that carry the nav
(draft-leagues.html and survivor-settings.html do not).

⚠️ RUN build_cfb.py FIRST. cfb.html is stamped from connect.html, so it is born with the
OLD nav; this pass is what gives it the new one. Run it second and the new page is the
only page in the site with a stale menu.

 1. The Pound loses its Calculators entry.
 2. Labs gains College Football.
 3. Dawgs gains BOTH calculators, grouped.
 4. The Upside Down map learns cfb → /data/cfb-teams.json, with three secondary mirrors.

WHY THE CALCULATORS MOVED. Kap, 2026-08-08: "Calculators belong in the dawgs section
grouped all as calculators. I'm sure these work, and we can demote them if they don't."
Dawgs is the earned tier per the NAV comment, so this is a promotion on trust, reversible
by moving the same two lines back.

⚠️ NOT using the `sep` flag on the calculator entries. It renders an "operator" badge via
`.grpmenu a.sep::after`, which is auctioneer territory and would be a lie here.

Run:  cd work && python3 patch-cfb-nav.py
"""
import glob, pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent

PAIRS = [
    # 1. The Pound: Calculators leaves.
    ('      ["pound.html","Tools & Scoreboard","pound","hot"],\n'
     '      ["pound.html#calculators","Calculators","pound-calculators"],\n'
     '      ["pound.html#inventory","Tool Inventory","pound-inventory"],\n',
     '      ["pound.html","Tools & Scoreboard","pound","hot"],\n'
     '      ["pound.html#inventory","Tool Inventory","pound-inventory"],\n'),

    # 2. Labs: College Football, alphabetical among its siblings.
    ('    {label:"Labs", href:"index.html#tiers", items:[\n'
     '      ["bozo.html","Bozo","bozo"],\n'
     '      ["dfs.html","DFS Solver","dfs"],\n',
     '    {label:"Labs", href:"index.html#tiers", items:[\n'
     '      ["bozo.html","Bozo","bozo"],\n'
     '      ["cfb.html","College Football","cfb"],\n'
     '      ["dfs.html","DFS Solver","dfs"],\n'),

    # 3. Dawgs: both calculators, together, at the foot of the group.
    ('      ["dashboard.html","Fantasy Draft Dashboard","dashboard","hot"],\n'
     '      ["dawgs.html","Rollo · OG Data Dawg","dawgs"],\n'
     '    ]},\n',
     '      ["dashboard.html","Fantasy Draft Dashboard","dashboard","hot"],\n'
     '      ["dawgs.html","Rollo · OG Data Dawg","dawgs"],\n'
     '      /* ⚠️ The calculators live HERE, not in The Pound (Kap, 8/8): "calculators\n'
     '         belong in the dawgs section grouped all as calculators." They are grouped\n'
     '         by their labels rather than by a `sep` rule — `sep` renders an "operator"\n'
     '         badge, which is auctioneer territory and would be wrong on these. */\n'
     '      ["pound.html#calculators","Calculators · NFL","pound-calculators"],\n'
     '      ["cfb.html#matchup","Calculators · CFB matchup","cfb-matchup"],\n'
     '    ]},\n'),

    # 4. The Upside Down: cfb.html's machine mirror is real, so point at it rather than
    #    falling through to llms.txt. cfb-teams.json is status:live in surfaces.json.
    ('      "bozo":"/data/bozo-rules.json",\n'
     '      "strategy":"/data/strategy.md"',
     '      "bozo":"/data/bozo-rules.json",\n'
     '      "cfb":"/data/cfb-teams.json",\n'
     '      "strategy":"/data/strategy.md"'),

    # ⚠️ This pair carries the FOLLOWING line too. Without it the old form is a prefix of
    #    the new one, so a second run matches again and inserts a duplicate — which is
    #    exactly what happened the first time this script was made re-runnable.
    ('      "receipts":["/data/receipts-method.md","/data/tier-audit.json"],\n'
     '      "nfelo":["/data/models.json"],\n',
     '      "receipts":["/data/receipts-method.md","/data/tier-audit.json"],\n'
     '      "cfb":["/data/cfb-elo.json","/data/cfb-record-divergence.json","/data/cfb-model-cards.json"],\n'
     '      "nfelo":["/data/models.json"],\n'),
]

files = sorted(p.name for p in REPO.glob("*.html"))
touched, skipped = [], []
for name in files:
    p = REPO / name
    s = p.read_text(encoding="utf-8")
    if "const NAV = [" not in s:
        skipped.append(name)
        continue
    for old, new in PAIRS:
        n, already = s.count(old), s.count(new)
        # ⚠️ Re-runnable ON PURPOSE. build_cfb.py stamps cfb.html out of connect.html, so
        # once this pass has run, re-running the pair reproduces the committed tree and the
        # anchor is legitimately already in its new form. What must NEVER be tolerated is
        # neither form being present exactly once — that is a page that has drifted, and it
        # is the case AGENTS.md rule 2 exists to catch.
        if n == 0 and already == 1:
            continue
        assert n == 1, f"{name}: anchor appears {n} times (new form {already}), expected 1 — this page has drifted"
        s = s.replace(old, new, 1)
    # proofs per file, so a bad pair cannot reach 20 files before anyone notices
    assert s.count('["cfb.html","College Football","cfb"]') == 1, name
    assert s.count('["cfb.html#matchup","Calculators · CFB matchup","cfb-matchup"]') == 1, name
    assert s.count('["pound.html#calculators"') == 1, f"{name}: calculators entry duplicated or lost"
    assert s.count('"cfb":"/data/cfb-teams.json"') == 1, name
    assert s.count('"cfb":["/data/cfb-elo.json"') == 1, f"{name}: secondary mirror duplicated or lost"
    p.write_text(s, encoding="utf-8", newline="")
    touched.append(name)

print(f"nav patched in {len(touched)} files; {len(skipped)} skipped (no nav): {', '.join(skipped)}")
assert len(touched) == 21, f"expected 21 nav-bearing pages (20 existing + cfb.html), patched {len(touched)}"
