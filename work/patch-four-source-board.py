"""
The cheat sheet becomes four sources on one scarcity curve.

Supersedes the budget-only conversion in the previous commit. That approach tried to
convert each vendor's DOLLARS into this room, which needs the custom-scoring VOR term,
which needs per-player stat components no vendor publishes — so ESPN and PFF could only
be budget-normalized and FantasyPros could not appear at all.

The four-source workbook takes a better route: every column uses the SAME 424-player,
$2,800 price curve, and a source only changes WHICH PLAYER RECEIVES WHICH PRICE. Dollar
differences then express ranking differences instead of vendor budget conventions, and
FantasyPros — which publishes ranks and no dollars — becomes expressible.

Verified independently before adopting, not taken on trust:
  · 424 rows; each of the four columns sums to exactly 2800 with 121 priced
  · each column is a PERMUTATION OF THE IDENTICAL PRICE MULTISET — the method's core claim
  · zero kickers, zero negatives, Jayden Higgins absent as a row
  · the workbook's ETR column matches the deployed DataDawg$ on all 424 rows, 0 mismatches

⚠️ WHAT THESE DOLLARS ARE. An ESPN/PFF/FP figure is the bid-equivalent of that source's
league-adjusted RANK on the ETR scarcity curve. It is not that vendor's own bid and not
four independent price models. The page has to say so, because a column of dollars that
is really a ranking is exactly the kind of number a reader will quote as a price.

⚠️ ONE ASYMMETRY WORTH KNOWING. The workbook applies a 50% format-delta adjustment to
ESPN and FantasyPros but none to PFF, on the stated ground that PFF is already synced to
the league. That rests on the commissioner's recollection, which was offered with "I'm
not sure if they adjusted for the league settings or not" — and our own measurement of
the PFF export (raw AV$ summing to 2323, 239 priced, blanks among high picks) is weak
evidence against it. If PFF turns out to be generic, its column is under-adjusted
relative to the other two. Recorded here rather than silently inherited.

Run:  cd work && python3 patch-four-source-board.py && python3 stamp-sw-version.py
"""
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
norm = lambda s: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\.?\b", "",
                                              s.lower().replace("’", "'")))

board = json.loads((REPO / "work/four-source-board.json").read_text(encoding="utf-8"))
vals = {norm(r["name"]): r for r in board}
for k in ("dd", "espn", "pff", "fp"):
    tot = sum(r[k] for r in board)
    if tot != 2800:
        sys.exit(f"FAIL {k} sums to {tot}, expected 2800")
print(f"  four columns × $2,800 over {len(board)} rows verified")

b = REPO / "board.html"
s = b.read_text(encoding="utf-8")

SUBS = [
  ('''  COLS.splice(4,0,{key:"dd",label:"DataDawg$",sortable:true},
                  {key:"espn",label:"ESPN",sortable:true},
                  {key:"pff",label:"PFF",sortable:true});
  MONEY_KEYS.length=0; MONEY_KEYS.push("dd","espn","pff");''',
   '''  COLS.splice(4,0,{key:"dd",label:"DataDawg$",sortable:true},
                  {key:"espn",label:"ESPN",sortable:true},
                  {key:"pff",label:"PFF",sortable:true},
                  {key:"fp",label:"FantasyPros",sortable:true});
  MONEY_KEYS.length=0; MONEY_KEYS.push("dd","espn","pff","fp");'''),
  ('''      ...(LGP ? [dollar(r.dd),dollar(r.espn),dollar(r.pff)] : [''',
   '''      ...(LGP ? [dollar(r.dd),dollar(r.espn),dollar(r.pff),dollar(r.fp)] : ['''),
  ('''    const CKEY=LGP?["rk","name","pos","team","dd","espn","pff","silva"]:''',
   '''    const CKEY=LGP?["rk","name","pos","team","dd","espn","pff","fp","silva"]:'''),
  ('''  /* Three boards, one room. DataDawg$ leads because it is the only one carrying the
     custom-scoring shift; ESPN and PFF are budget-normalized into the same $2,800 and
     are there to be disagreed with, not averaged in. */''',
   '''  /* Four sources, ONE scarcity curve. Every column is the same 424-player, $2,800 price
     distribution; a source only changes which player receives which price. So a column
     expresses that source's RANKING, priced on the ETR curve — not that vendor's own bid.
     DataDawg$ leads because it is the target; the rest are triangulation, not a vote. */'''),
]
for old, new in SUBS:
    if s.count(old) != 1:
        sys.exit(f"FAIL board.html: anchor matched {s.count(old)} times\n  {old[:70]}…")
    s = s.replace(old, new, 1)

INTRO = (
    "Priced for <b>this league</b> — 14-team Half PPR, custom scoring, "
    "lineup QB/2RB/2WR/TE/2FLEX/DEF. <b>No kicker slot — kickers are $0 here.</b> "
    "Four sources, <b>one price curve</b>: every column is the same 424-player, $2,800 "
    "distribution, and a source only changes <i>which player gets which price</i>. "
    "So an ESPN, PFF or FantasyPros dollar is <b>the bid-equivalent of that source&rsquo;s "
    "league-adjusted rank</b> on the DataDawg$ scarcity curve — <b>not that vendor&rsquo;s own "
    "bid, and not four independent price models</b>. Dollar gaps between columns are "
    "<i>ranking</i> disagreements. <b>DataDawg$ is the target</b>; the other three are "
    "triangulation, not a vote that overrules it. ESPN and FantasyPros carry a 50% "
    "format-delta adjustment; PFF is taken as already league-synced, so if that turns out "
    "to be wrong its column is under-adjusted. A dash means the player is unpriced on the "
    "curve. ESPN captured Aug 19, ETR Aug 24, FantasyPros Aug 28."
)
m = re.search(r"(\s*if\(intro\) intro\.innerHTML=')(.*?)(';\n)", s, re.S)
if not m:
    sys.exit("FAIL board.html: intro block not found")
s = s[:m.start(2)] + INTRO + s[m.end(2):]
b.write_text(s, encoding="utf-8", newline="\n")
print("  board.html: FantasyPros column, CSV export, cell render and intro updated")

def repoint(path, marker):
    p = REPO / path
    t = p.read_text(encoding="utf-8")
    i = t.index(marker) + len(marker)
    arr, end = json.JSONDecoder().raw_decode(t[i:])
    hit = 0
    for row in arr:
        for k in ("dd", "espn", "pff", "fp"):
            row.pop(k, None)
        r = vals.get(norm(row["name"]))
        if r:
            for k in ("dd", "espn", "pff", "fp"):
                if r[k]:
                    row[k] = r[k]
            hit += 1
    p.write_text(t[:i] + json.dumps(arr, separators=(",", ":"), ensure_ascii=False) + t[i + end:],
                 encoding="utf-8", newline="\n")
    print(f"  {path}: {len(arr)} rows, {hit} matched to the four-source board")

repoint("board.html", "SEED = ")
repoint("dashboard.html", "window.DD_POOL = ")
