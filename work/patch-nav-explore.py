"""
Data Explorer (2026-10-09): add explore.html to the Data group of the shared nav and to
Toto's MAP, on every page that carries them. AGENTS.md rule 2: a sitewide change is the
same edit on every *.html, asserted once per file so a drifted page fails loudly.

Idempotent: a page that already carries both edits is left alone.

    cd work && python3 patch-nav-explore.py
"""
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent

NAV_OLD = '      ["data.html","The Library","data"],\n      ["receipts.html","Receipts","receipts"],\n'
NAV_NEW = ('      ["data.html","The Library","data"],\n      ["explore.html","Data Explorer (Pup)","explore"],\n'
           '      ["receipts.html","Receipts","receipts"],\n')
MAP_OLD = "data.html — the Library: every machine-readable file, shelved by the surface that owns it. "
MAP_NEW = (MAP_OLD + "explore.html — the Data Explorer (Pup): in-browser DuckDB SQL and a simple chart builder "
           "over the public /data JSON; pure query, no forecasts, every result cites its file and as_of; "
           "no public closing-market line exists for an nfelo-vs-close query. ")

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
