"""
The cheat sheet stops showing "$ PPN" and starts showing three boards side by side.

$ PPN was always this site's own number wearing a league's abbreviation. It is replaced
by DataDawg$, and two outside boards are converted into the same room and set beside it
so a row reads as three comparable prices for one player:

    DataDawg$   our conversion of the ETR board, budget + custom-scoring (v3, 0.5/0.5)
    ESPN        ESPN Draft Kit, 10tm/$200/full PPR/with kicker -> this room, budget only
    PFF         PFF export, ~12tm/$200 -> this room, budget only

⚠️ THE THREE COLUMNS ARE NOT THE SAME TREATMENT AND THE PAGE MUST SAY SO. DataDawg$
carries the custom-scoring shift; ESPN and PFF are budget-normalized only, because the
scoring term needs per-player stat components that neither sheet publishes. Labelling
them as equivalent would be the exact overclaim the /data/ layer exists to prevent, so
the intro states it and the column headers carry the distinction.

Coverage differs on purpose: DataDawg$ prices 424 of the 613 pool players, ESPN 121,
PFF 159. A blank is "this board did not price him", which is information, not a gap to
fill with a zero.

Run:  cd work && python3 patch-board-vendor-columns.py && python3 stamp-sw-version.py
"""
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
norm = lambda s: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\.?\b", "",
                                              s.lower().replace("’", "'")))

vendor = json.loads((REPO / "work/vendor-dollars.json").read_text(encoding="utf-8"))
espn = {r["key"]: r["target"] for r in vendor["espn"] if r["target"] > 0}
pff = {r["key"]: r["target"] for r in vendor["pff"] if r["target"] > 0}
ddsrc = json.loads((REPO / "data/datadawg-dollars-values.json").read_text(encoding="utf-8"))["data"]["players"]
dd = {norm(p["player"]): p["target"] for p in ddsrc if p["target"] > 0}

print(f"  DataDawg$ {len(dd)} priced · ESPN {len(espn)} · PFF {len(pff)}")

def repoint(path, marker):
    """Swap each pool row's `lg` for dd/espn/pff. The pool is one JSON array literal."""
    p = REPO / path
    s = p.read_text(encoding="utf-8")
    i = s.index(marker) + len(marker)
    dec = json.JSONDecoder()
    arr, end = dec.raw_decode(s[i:])
    hit = 0
    for row in arr:
        row.pop("lg", None)
        k = norm(row["name"])
        for key, src in (("dd", dd), ("espn", espn), ("pff", pff)):
            if k in src:
                row[key] = src[k]
                hit += 1
    out = json.dumps(arr, separators=(",", ":"), ensure_ascii=False)
    p.write_text(s[:i] + out + s[i + end:], encoding="utf-8", newline="\n")
    print(f"  {path}: {len(arr)} rows, {hit} vendor prices attached")

# ---- the column block -------------------------------------------------------------
b = REPO / "board.html"
s = b.read_text(encoding="utf-8")

OLD_COL = '''  COLS.splice(4,0,{key:"lg",label:"$ PPN 14t",sortable:true});
  MONEY_KEYS.length=0; MONEY_KEYS.push("lg");
  state.sort={key:"lg",dir:-1};'''
NEW_COL = '''  /* Three boards, one room. DataDawg$ leads because it is the only one carrying the
     custom-scoring shift; ESPN and PFF are budget-normalized into the same $2,800 and
     are there to be disagreed with, not averaged in. */
  COLS.splice(4,0,{key:"dd",label:"DataDawg$",sortable:true},
                  {key:"espn",label:"ESPN",sortable:true},
                  {key:"pff",label:"PFF",sortable:true});
  MONEY_KEYS.length=0; MONEY_KEYS.push("dd","espn","pff");
  state.sort={key:"dd",dir:-1};'''
if s.count(OLD_COL) != 1:
    sys.exit(f"FAIL board.html: column block matched {s.count(OLD_COL)} times, expected 1")
s = s.replace(OLD_COL, NEW_COL, 1)

OLD_OPT = '''    const o=document.createElement("option"); o.value="lg"; o.textContent="$ PPN";'''
NEW_OPT = '''    const o=document.createElement("option"); o.value="dd"; o.textContent="DataDawg$";'''
if s.count(OLD_OPT) != 1:
    sys.exit(f"FAIL board.html: sort option matched {s.count(OLD_OPT)} times, expected 1")
s = s.replace(OLD_OPT, NEW_OPT, 1)

OLD_SCORING = '''  const SCORING = LGP ? "lg" : (MONEY_KEYS.includes(A.scoring) ? A.scoring : "half");'''
NEW_SCORING = '''  const SCORING = LGP ? "dd" : (MONEY_KEYS.includes(A.scoring) ? A.scoring : "half");'''
if s.count(OLD_SCORING) != 1:
    sys.exit("FAIL board.html: SCORING line not unique")
s = s.replace(OLD_SCORING, NEW_SCORING, 1)

OLD_CELL = '''      ...(LGP ? [["$"+(+r.lg||0),false,true]] : ['''
NEW_CELL = '''      ...(LGP ? [dollar(r.dd),dollar(r.espn),dollar(r.pff)] : ['''
if s.count(OLD_CELL) != 1:
    sys.exit("FAIL board.html: row-cell block not unique")
s = s.replace(OLD_CELL, NEW_CELL, 1)

OLD_CKEY = '''    const CKEY=LGP?["rk","name","pos","team","lg","silva"]:'''
NEW_CKEY = '''    const CKEY=LGP?["rk","name","pos","team","dd","espn","pff","silva"]:'''
if s.count(OLD_CKEY) != 1:
    sys.exit("FAIL board.html: CSV key list not unique")
s = s.replace(OLD_CKEY, NEW_CKEY, 1)

# a blank is "not priced by this board", never a zero
HELPER = '''  /* A board that did not price a player renders blank, not $0. "$0" is a claim that he
     is worthless; blank is the truth, which is that this board is silent about him. */
  const dollar = v => [(+v ? "$"+(+v) : "—"), false, true];
'''
ANCHOR = "  const SCORING = LGP ?"
if s.count(ANCHOR) != 1:
    sys.exit("FAIL board.html: helper anchor not unique")
s = s.replace(ANCHOR, HELPER + ANCHOR, 1)

# ---- the intro copy ---------------------------------------------------------------
m = re.search(r"(\s*if\(intro\) intro\.innerHTML=')(.*?)(';\n)", s, re.S)
if not m:
    sys.exit("FAIL board.html: intro copy block not found")
NEW_INTRO = (
    "Priced for <b>this league</b> — 14-team Half PPR, custom scoring, "
    "lineup QB/2RB/2WR/TE/2FLEX/DEF. <b>No kicker slot — kickers are $0 here.</b> "
    "Three boards, each renormalized to this room&rsquo;s $2,800. "
    "<b>DataDawg$</b> is ours: the ETR board converted for both budget <i>and</i> this "
    "league&rsquo;s custom scoring (sacks, INTs, first downs). "
    "<b>ESPN</b> (10-team, $200, full PPR, with a kicker) and <b>PFF</b> (12-team, $200) are "
    "<b>budget-normalized only</b> — their scoring shift is not modelled, because neither "
    "sheet publishes the per-player stat components it needs. So DataDawg$ is doing strictly "
    "more work than the two beside it; read a disagreement as a disagreement, not as one "
    "board being wrong. A dash means that board did not price the player at all. "
    "ESPN captured Aug 19, ETR Aug 24, PFF undated on export."
)
s = s[:m.start(2)] + NEW_INTRO + s[m.end(2):]

b.write_text(s, encoding="utf-8", newline="\n")
print("  board.html: columns, sort, CSV export, cell render and intro copy updated")

# Pools last: every board.html anchor is proven above, so a failure cannot leave the
# tree half-patched with rewritten pools and the old single-column renderer.
repoint("board.html", "SEED = ")
repoint("dashboard.html", "window.DD_POOL = ")
