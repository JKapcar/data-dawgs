"""
Toto's site map learns the DataDawg$ board.

AGENTS.md: "The prompt also carries HELP (the draft-rig manual) and MAP (the site map).
Both are copy-pasted into every page. If the UI or the page list changes, change them in
the SAME commit or Toto starts confidently lying about it."

The DataDawg$ page shipped without that, because MAP lives in all 31 pages' assistant
block and the Toto audit (#46) was rewriting that same block wholesale — doing both at
once was a guaranteed conflict. #46 has now merged, so this is the follow-through.

The page carries no nav and no assistant of its own, deliberately, exactly like
draft-leagues.html. That is fine; what is not fine is Toto being unable to route anyone
to a page that exists. MAP is how he routes.

Run:  cd work && python3 patch-map-datadawg-dollars.py && python3 stamp-sw-version.py
"""
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
MARK = "/* ---------- Toto: shared draft assistant"

OLD = ("The draft rig: dashboard.html (a drafter's view), auction.html (the operator), "
       "board.html (read-only room view), bigboard.html (the projector), dataviz.html and "
       "report.html (afterwards), master.html (the player pool and scouting).")
NEW = (OLD + "\ndatadawg-dollars.html — DataDawg$: our OWN converted auction dollars for one "
       "league room (Target $, conversion-sensitivity bands, delta vs the source price). It is "
       "NOT MV: MV is the dated market snapshot, DataDawg$ is this site's conversion of it, and "
       "the two are different numbers. Separate again from the $ PPN column on board.html, which "
       "re-prices a personal board for one league. Machine surfaces: /data/datadawg-dollars-values.json, "
       "/data/datadawg-dollars-method.json, /data/datadawg-dollars-method.md.")

touched = 0
for path in sorted(REPO.glob("*.html")):
    s = path.read_text(encoding="utf-8")
    if MARK not in s:
        continue
    n = s.count(OLD)
    if n != 1:
        sys.exit(f"FAIL {path.name}: MAP draft-rig line matched {n} times, expected 1")
    path.write_text(s.replace(OLD, NEW, 1), encoding="utf-8", newline="\n")
    touched += 1

print(f"  MAP updated on {touched} pages")
