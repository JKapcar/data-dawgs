#!/usr/bin/env python3
"""fantasy-warroom.html — carry ESPN's reception value into scoring_settings.  Idempotent.

    python3 work/patch-warroom-espn-rec.py
    node work/test-pmv-column.mjs        # 27 assertions
    cd work && python3 stamp-sw-version.py && node verify-sw.mjs

⚠️ SHIP THIS BEFORE (OR WITH) THE NEXT sw.js BUMP. It repairs a latent regression that the
service-worker cache is currently hiding.

WHAT WENT WRONG
Commit 1 rewrote mvColumn() to resolve a PMV column from (teams, reception points,
superflex) and to return null - "unpriced" - when a room matches no published column. That
is correct for Sleeper, whose scoring_settings comes straight from the Sleeper API.

But fetchLeagueEspn() builds `scoring_settings:{}` - literally empty - and throws away the
reception value the Worker already sends as feed.league.scoring.ppr. So for EVERY ESPN
league, mvColumn() reads rec = undefined, fails Number.isFinite, and returns null. The
Money tab would go blank on a league that used to price fine.

It has not surfaced yet only because sw.js still serves the pre-Commit-1 page from cache:
the deployed HTML resolves sfhalf12, the running page resolves sf. The moment sw.js is
bumped for any reason, the new code activates and every ESPN league goes unpriced. The
recommended sw bump would have triggered it.

WHY THE TEST DID NOT CATCH IT
work/test-pmv-column.mjs built its fixture state by hand with scoring_settings.rec set. The
real ESPN path never has that field. The fixture asserted what the function does, not what
the app supplies to it. The added assertions below construct state the way fetchLeagueEspn
actually does, from the Worker's real feed shape.
"""
import pathlib, sys

PAGE = pathlib.Path("fantasy-warroom.html")

OLD = "    roster_positions:positions, scoring_settings:{},"
NEW = ("""    roster_positions:positions,
    /* ⚠️ NOT {} - mvColumn() resolves the PMV column from the reception value, and an empty
       scoring_settings made every ESPN league read as unpriced. The Worker already sends this
       as feed.league.scoring.ppr (espnScoring(), statId 53); map it onto Sleeper's `rec` key,
       which is the vocabulary the rest of this page speaks. Left undefined only when ESPN
       genuinely did not say - in which case abstaining is the right answer. */
    scoring_settings:(()=>{
      const ppr=Number(L.scoring&&L.scoring.ppr);
      return Number.isFinite(ppr)?{rec:ppr}:{};
    })(),""")

def main():
    if not PAGE.exists(): sys.exit("run from the repo root (fantasy-warroom.html not found)")
    s = PAGE.read_text(encoding="utf-8")
    if "mvColumn() resolves the PMV column from the reception value" in s:
        print("already applied - no change"); return
    n = s.count(OLD)
    if n != 1: sys.exit(f"expected 1 occurrence of the ESPN scoring_settings line, found {n}")
    PAGE.write_text(s.replace(OLD, NEW), encoding="utf-8", newline="\n")
    print("patched fetchLeagueEspn(): ESPN reception value now reaches scoring_settings.rec")
    print("NEXT, same commit: node work/test-pmv-column.mjs && cd work && python3 stamp-sw-version.py && node verify-sw.mjs")

if __name__ == "__main__": main()
