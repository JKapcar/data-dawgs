"""
The chart copy names the currency it is actually drawing.

The previous patch put every rig surface on DataDawg$ but left the labels reading "MV"
and "market value". Numbers from one column under another column's name is worse than
the bug it replaced: before, the charts were consistently wrong; after, they were right
and described wrongly, which is the version a reader believes.

MONEY_LABEL is already resolved per page ("DataDawg$" in this room, "MV" otherwise), so
the labels follow the data instead of being hardcoded to either.

Run:  cd work && python3 patch-rig-money-labels.py && python3 stamp-sw-version.py
"""
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent

EDITS = {
  "dataviz.html": [
    ("Sum of MV $ still on the board per position",
     "Sum of ${MONEY_LABEL} still on the board per position"),
    ("Only players still on the board, ranked by market value",
     "Only players still on the board, ranked by ${MONEY_LABEL}"),
    ('worth $1+, ranked by market value.',
     'worth $1+, ranked by ${MONEY_LABEL}.'),
  ],
  "report.html": [
    ('dl.textContent="paid = market value";', 'dl.textContent="paid = "+MONEY_LABEL;'),
    ('xt.textContent="market value →";', 'xt.textContent=MONEY_LABEL+" →";'),
  ],
}

staged = {}
for name, subs in EDITS.items():
    p = REPO / name
    s = p.read_text(encoding="utf-8")
    for old, new in subs:
        if s.count(old) != 1:
            sys.exit(f"FAIL {name}: label anchor matched {s.count(old)} times, expected 1\n  {old[:60]}…")
        s = s.replace(old, new, 1)
    staged[name] = s

for name, s in staged.items():
    (REPO / name).write_text(s, encoding="utf-8", newline="\n")
    print(f"  {name}: {len(EDITS[name])} money labels now follow MONEY_LABEL")
