"""
Toto follows the cheat sheet's new columns.

The board stopped rendering one "$ PPN" column and now renders three — DataDawg$, ESPN
and PFF. The assistant's draft context still priced from `lg` and called it "$ PPN", so
without this it would quote a column that no longer exists, which is the exact failure
the money-column branch was added to prevent.

AGENTS.md: the shared block is copy-pasted into every page, so this is one edit applied
to all of them in the same commit, and work/test-toto-surface.mjs asserts they stay
byte-identical.

Run:  cd work && python3 patch-toto-vendor-columns.py && python3 stamp-sw-version.py
"""
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
MARK = "/* ---------- Toto: shared draft assistant"

SUBS = [
  ('''    /* ⚠️ THE PPN ROOM RENDERS ONE MONEY COLUMN. board.html?league=pepperoninipples drops
       every generic MV column and shows `lg` — the Aug 24 snapshot re-priced for that
       league — on its own. Pricing from `half` there had Toto naming dollar figures that
       appear nowhere on the reader's screen. Follow the column the board is showing. */''',
   '''    /* ⚠️ THIS ROOM RENDERS THREE MONEY COLUMNS, NOT THE GENERIC ONES. board.html?league=
       pepperoninipples drops every generic MV column and shows DataDawg$, ESPN and PFF —
       all renormalized to this room's $2,800. Price from DataDawg$, the one this site
       actually built, and never quote a generic format the room does not display. */'''),
  ('''    const scoring = (lgRoom && POOL.some(p => p.lg !== undefined)) ? "lg" : (st.scoring || "half");
    const MV = scoring === "lg" ? "$ PPN" : "MV";''',
   '''    const scoring = (lgRoom && POOL.some(p => p.dd !== undefined)) ? "dd" : (st.scoring || "half");
    const MV = scoring === "dd" ? "DataDawg$" : "MV";'''),
  ('''    const pickVal = pk => scoring === "lg"''',
   '''    const pickVal = pk => scoring === "dd"'''),
  ('''    /* A pick stores `etr`, the value the OPERATOR's page held at the moment of the sale —
       and the operator page has no `lg` column. In the PPN room that would mix a generic
       MV into a sheet of $ PPN prices, so re-read the value from the pool this page has. */''',
   '''    /* A pick stores `etr`, the value the OPERATOR's page held at the moment of the sale —
       and the operator page has no DataDawg$ column. That would mix a generic MV into a
       sheet of DataDawg$ prices, so re-read the value from the pool this page has. */'''),
  ('''    L.push(scoring === "lg"
      ? `$ PPN = this room's own price: the Aug 24, 2026 Market Value snapshot re-priced for the pepperoninipples league by value over replacement. IT IS THE ONLY MONEY COLUMN THIS ROOM SHOWS — every dollar figure below is a $ PPN figure. Call it "$ PPN", never a generic market value, and never quote a number from a format this room does not display.`''',
   '''    L.push(scoring === "dd"
      ? `DataDawg$ = this site's own price: an ETR board converted for BOTH this league's budget and its custom scoring, summing to the room's $2,800. The board also shows ESPN and PFF beside it, renormalized to the same $2,800 but BUDGET-ONLY — their scoring shift is not modelled, so they are doing less work than DataDawg$, not disagreeing with it on equal footing. Say which board a number came from. Never quote a generic market value here, and never average the three.`'''),
]

MAP_OLD = ("datadawg-dollars.html — DataDawg$: our OWN converted auction dollars for one "
           "league room (Target $, conversion-sensitivity bands, delta vs the source price). It is "
           "NOT MV: MV is the dated market snapshot, DataDawg$ is this site's conversion of it, and "
           "the two are different numbers. Separate again from the $ PPN column on board.html, which "
           "re-prices a personal board for one league. Machine surfaces: /data/datadawg-dollars-values.json, "
           "/data/datadawg-dollars-method.json, /data/datadawg-dollars-method.md.")
MAP_NEW = ("datadawg-dollars.html — DataDawg$: our OWN converted auction dollars for one "
           "league room (Target $, conversion-sensitivity bands, delta vs the source price). It is "
           "NOT MV: MV is the dated market snapshot, DataDawg$ is this site's conversion of it. The "
           "league cheat sheet on board.html shows the same DataDawg$ alongside ESPN and PFF, all "
           "renormalized to that room's $2,800 — but ESPN and PFF are budget-only, with no custom-scoring "
           "shift, so they are not equivalent columns. Machine surfaces: /data/datadawg-dollars-values.json, "
           "/data/datadawg-dollars-method.json, /data/datadawg-dollars-method.md.")

pages = [p for p in sorted(REPO.glob("*.html")) if MARK in p.read_text(encoding="utf-8")]
# validate every page before writing any of them
for path in pages:
    s = path.read_text(encoding="utf-8")
    for old, _ in SUBS:
        if s.count(old) != 1:
            sys.exit(f"FAIL {path.name}: anchor matched {s.count(old)} times, expected 1\n  {old[:70]}…")
    if s.count(MAP_OLD) != 1:
        sys.exit(f"FAIL {path.name}: MAP entry matched {s.count(MAP_OLD)} times, expected 1")

for path in pages:
    s = path.read_text(encoding="utf-8")
    for old, new in SUBS:
        s = s.replace(old, new, 1)
    s = s.replace(MAP_OLD, MAP_NEW, 1)
    path.write_text(s, encoding="utf-8", newline="\n")

print(f"  Toto draft context + site map updated on {len(pages)} pages")
