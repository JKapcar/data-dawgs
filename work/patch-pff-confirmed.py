"""
PFF is confirmed league-synced, so stop hedging about it.

The four-source board applies a 50% format-delta adjustment to ESPN and FantasyPros but
none to PFF, on the ground that PFF's export is already synced to the league. When that
shipped it rested on a recollection offered as "I'm not sure if they adjusted for the
league settings or not", so the page and Toto both carried a caveat: if the assumption is
wrong, the PFF column is under-adjusted.

The commissioner has now confirmed it. The caveat is retired rather than left standing —
a hedge kept after the question is settled reads as a live doubt and quietly discounts a
column people should be using at full weight.

⚠️ WHAT DOES NOT CHANGE: the numbers. PFF's column is still its RANK priced on the shared
DataDawg$ curve, exactly as before; only the sentence describing our confidence in its
input moves. Nothing is recomputed here.

Run:  cd work && python3 patch-pff-confirmed.py && python3 stamp-sw-version.py
"""
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent

OLD_INTRO = ("ESPN and FantasyPros carry a 50% "
             "format-delta adjustment; PFF is taken as already league-synced, so if that turns out "
             "to be wrong its column is under-adjusted. ")
NEW_INTRO = ("ESPN and FantasyPros carry a 50% "
             "format-delta adjustment into this room; PFF needs none — its export is synced to the "
             "league, confirmed by the commissioner. ")

b = REPO / "board.html"
s = b.read_text(encoding="utf-8")
if s.count(OLD_INTRO) != 1:
    sys.exit(f"FAIL board.html: intro caveat matched {s.count(OLD_INTRO)} times, expected 1")
b.write_text(s.replace(OLD_INTRO, NEW_INTRO, 1), encoding="utf-8", newline="\n")
print("  board.html: intro states PFF is confirmed synced")

OLD_TOTO = (" PFF is taken as already league-synced on the commissioner's recollection — if that is "
            "wrong its column is under-adjusted, so do not treat it as the most authoritative when "
            "it disagrees.")
NEW_TOTO = (" PFF needs no format adjustment because its export is synced to this league, confirmed "
            "by the commissioner; ESPN and FantasyPros carry a 50% format-delta into the room. All "
            "three are still rank-on-curve, so a gap is a ranking disagreement.")
n = 0
for p in sorted(REPO.glob("*.html")):
    t = p.read_text(encoding="utf-8")
    if t.count(OLD_TOTO) != 1:
        continue
    p.write_text(t.replace(OLD_TOTO, NEW_TOTO, 1), encoding="utf-8", newline="\n")
    n += 1
print(f"  Toto state block updated on {n} pages")
if n != 31:
    sys.exit(f"FAIL expected 31 pages carrying the assistant, updated {n}")
