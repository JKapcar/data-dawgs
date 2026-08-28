"""
Every draft-room surface prices in DataDawg$, not the generic MV column.

The cheat sheet moved to DataDawg$; nothing else did. Audited on the merged main:

    board.html      r.dd / MONEY_KEYS        DataDawg$   ✓
    dashboard.html  p[scoring]  (= "half")   generic     ✗
    dataviz.html    p[S.settings.scoring]    generic     ✗
    report.html     p[S.settings.scoring]    generic     ✗
    bigboard.html   p[S.settings.scoring]    generic     ✗
    auction.html    p[S.settings.scoring]    generic     ✗

Worse than a wrong key: five of those files carried ZERO DataDawg$ values — 613 pool
rows, 0 with `dd` — so the numbers were not merely unused, they were absent. Every
chart, the projector, the report card and THE OPERATOR'S OWN MATHS were pricing in a
currency the board had stopped using. Gibbs read $76.4 on the charts and $90 on the
sheet, in the same room, at the same moment.

This injects the DataDawg$ column into those pools and switches each page's money
accessor to it when the room is active.

⚠️ THE KEY IS DECIDED ONCE FOR THE WHOLE POOL, never per player. DataDawg$ prices 121
players and the generic column prices ~450, so a per-player fallback would sum two
different currencies into one total and call it "value remaining".

⚠️ THIS ALSO CORRECTS THE INFLATION MATH, which is the part that reaches bids. The room
holds $2,800 and the generic half column totals about $2,400, so the operator's
inflation started near 1.17x before a single player was sold — an artefact of comparing
a 14-team budget against a 12-team price list. DataDawg$ sums to exactly $2,800, so
inflation starts at 1.00x and means what it says.

Run:  cd work && python3 patch-rig-datadawg-dollars.py && python3 stamp-sw-version.py
"""
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
norm = lambda s: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\.?\b", "",
                                              s.lower().replace("’", "'")))
board = json.loads((REPO / "work/four-source-board.json").read_text(encoding="utf-8"))
dd = {norm(r["name"]): r["dd"] for r in board if r["dd"]}
print(f"  DataDawg$ carries {len(dd)} priced players")

RESOLVE = '''/* ⚠️ THIS ROOM PRICES IN DataDawg$. S.settings.scoring is "half" here — the generic
   12-team column — so this surface was pricing in a currency the cheat sheet had
   stopped using. Decide the money key ONCE for the whole pool: DataDawg$ prices 121
   players and the generic column ~450, so a per-player fallback would add two
   currencies together and call the result "value remaining". */
const DD_ROOM = ((window.DDLeague && DDLeague.id === "pepperoninipples")
  || new URLSearchParams(location.search).get("league") === "pepperoninipples")
  && POOL.some(p => p.dd !== undefined);
const MONEYK = () => DD_ROOM ? "dd" : S.settings.scoring;
const MONEY_LABEL = DD_ROOM ? "DataDawg$" : "MV";
'''

EDITS = {
  "dataviz.html": [("const val=p=>+p[S.settings.scoring]||0;",
                    RESOLVE + "const val=p=>+p[MONEYK()]||0;")],
  "bigboard.html": [("const val = p => p ? (+p[S.settings.scoring]||0) : 0;",
                     RESOLVE + "const val = p => p ? (+p[MONEYK()]||0) : 0;")],
  "auction.html": [("const val = p => p ? (+p[S.settings.scoring]||0) : 0;",
                    RESOLVE + "const val = p => p ? (+p[MONEYK()]||0) : 0;")],
  "report.html": [("  return p ? (+p[S.settings.scoring]||0) : 0;",
                   "  return p ? (+p[MONEYK()]||0) : 0;")],
  "dashboard.html": [('''    const scoring = st.scoring || "half";
    const POOL = window.DD_POOL || [];
    const val = p => +p[scoring] || 0;''',
                      '''    /* ⚠️ DataDawg$, not the generic column — see work/patch-rig-datadawg-dollars.py.
       Decided once for the pool, never per player. */
    const POOL = window.DD_POOL || [];
    const ddRoom = ((window.DDLeague && DDLeague.id === "pepperoninipples")
      || new URLSearchParams(location.search).get("league") === "pepperoninipples")
      && POOL.some(p => p.dd !== undefined);
    const scoring = ddRoom ? "dd" : (st.scoring || "half");
    const val = p => +p[scoring] || 0;''')],
}
# report.html needs the resolver too, placed before the function that uses it
EDITS["report.html"].insert(0, ("const byName={}; POOL.forEach(p=>byName[p.name]=p);\nfunction etrOf(pk){",
                                RESOLVE + "const byName={}; POOL.forEach(p=>byName[p.name]=p);\nfunction etrOf(pk){"))

# ---- validate every anchor before writing anything ----
staged = {}
for name, subs in EDITS.items():
    p = REPO / name
    s = p.read_text(encoding="utf-8")
    for old, new in subs:
        if s.count(old) != 1:
            sys.exit(f"FAIL {name}: anchor matched {s.count(old)} times, expected 1\n  {old[:70]}…")
        s = s.replace(old, new, 1)
    staged[name] = s

def inject(name, s):
    m = re.search(r"(SEED|POOL|window\.DD_POOL) ?= ?", s)
    i = s.index('[{"name"', m.start())
    arr, end = json.JSONDecoder().raw_decode(s[i:])
    hit = 0
    for row in arr:
        v = dd.get(norm(row["name"]))
        if v:
            row["dd"] = v
            hit += 1
    return s[:i] + json.dumps(arr, separators=(",", ":"), ensure_ascii=False) + s[i + end:], hit, len(arr)

for name in ["dataviz.html", "report.html", "bigboard.html", "auction.html", "master.html"]:
    s = staged.get(name) or (REPO / name).read_text(encoding="utf-8")
    s, hit, n = inject(name, s)
    staged[name] = s
    print(f"  {name}: {n} pool rows, dd on {hit}")

for name, s in staged.items():
    (REPO / name).write_text(s, encoding="utf-8", newline="\n")
print(f"  wrote {len(staged)} files")
