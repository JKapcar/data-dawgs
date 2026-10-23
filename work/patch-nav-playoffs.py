"""
Playoff Leverage (2026-10-23): add playoffs.html to the NFL group of the shared nav and to
Toto's MAP, on every page that carries them. AGENTS.md rule 2: a sitewide change is the
same edit on every *.html, asserted once per file so a drifted page fails loudly.

Idempotent: a page that already carries both edits is left alone. Run it BEFORE
build_playoffs.py, which stamps the new page from a template that must already list it.

    cd work && python3 patch-nav-playoffs.py
"""
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent

NAV_OLD = '      ["nfelo.html","nfelo Power Ratings","nfelo"],\n      ["calculators.html","NFL Calculators","calculators"],\n'
NAV_NEW = ('      ["nfelo.html","nfelo Power Ratings","nfelo"],\n      ["playoffs.html","Playoff Leverage","playoffs"],\n'
           '      ["calculators.html","NFL Calculators","calculators"],\n')
MAP_OLD = "nfelo.html — nfelo power ratings and their backtest. "
MAP_NEW = (MAP_OLD + "playoffs.html — Playoff Leverage (Pup): this week's unplayed games ranked by how much each "
           "result moves both teams' playoff chances (if they lose / now / if they win), a one-game-at-a-time "
           "result switch, a root-for guide and all-32 odds; a daily 100,000-season simulation over nfelo game "
           "probabilities and real results, ungraded. ")

changed = 0
for f in sorted(REPO.glob("*.html")):
    s = f.read_text(encoding="utf-8")
    if NAV_NEW in s and MAP_NEW in s:
        continue
    if s.count(NAV_OLD) == 0 and s.count(MAP_OLD) == 0:
        continue  # pages without the shared nav (stubs, standalone tools)
    assert s.count(NAV_OLD) == 1, f"{f.name}: nav anchor count {s.count(NAV_OLD)}"
    assert s.count(MAP_OLD) == 1, f"{f.name}: MAP anchor count {s.count(MAP_OLD)}"
    s = s.replace(NAV_OLD, NAV_NEW, 1).replace(MAP_OLD, MAP_NEW, 1)
    f.write_text(s, encoding="utf-8", newline="\n")
    changed += 1
print(f"  nav + MAP updated on {changed} page(s)")
