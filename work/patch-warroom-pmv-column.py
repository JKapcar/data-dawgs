#!/usr/bin/env python3
"""fantasy-warroom.html — correct the PMV column picker.  Idempotent.

    python3 work/patch-warroom-pmv-column.py

data/pool.json ships EIGHT columns (full, half, half14, std, sf, sfhalf12, ppr10, ppr14)
and mvColumn() chose from three. Consequences, both silent:

  * a superflex HALF league read the superflex FULL column
  * a 14-team half league read the 12-team half column

Measured on PFL (ESPN 110404, 12-team superflex half): the top roster reads $283 instead
of $289 and FOUR teams swap places in the money table. Nothing errored; the page just
ranked the league wrong under a heading that says "YOUR RANK 1 of 12".

draft-providers.js:espnScoringKey() already resolved sfhalf12 correctly, so the two code
paths disagreed about the same league - the drift AGENTS.md warns about.

⚠️ The new picker returns null when the room matches no published column, rather than
falling back to the nearest one. mvOf() already turns that into "unpriced", which the
page reports and counts. Explicit abstention over an unsupported answer: a wrong price
propagates into replacement level, VOR, surplus and the trade finder, where it can no
longer be seen.
"""
import io, re, sys, pathlib

PAGE = pathlib.Path("fantasy-warroom.html")

OLD = """function mvColumn(){
  if(state.slots.SUPERFLEX)return 'sf';
  const rec=Number(state.league?.scoring_settings?.rec);
  return rec>=1?'full':'half';
}"""

NEW = """function mvColumn(){
  /* ⚠️ Eight columns exist in pool.json; this used to pick from three, so a superflex
     HALF league silently read the superflex FULL column and a 14-team half league read the
     12-team one. Measured on PFL: +$6 on the top roster and four teams swapping rank.
     Only an EXACT format match returns a column. Anything else returns null, which mvOf()
     already reports as unpriced - a wrong price disappears into replacement level and VOR
     where nobody can see it, so abstain instead. DataDawg$ is the primary basis anyway;
     PMV is the documented fallback. */
  const teams=(state.teams&&state.teams.length)||0;
  const rec=Number(state.league?.scoring_settings?.rec);
  const sf=!!state.slots.SUPERFLEX;
  if(!Number.isFinite(rec))return null;
  if(sf)return (rec===0.5&&teams===12)?'sfhalf12':(rec===1&&teams===12)?'sf':null;
  if(rec===1)return teams===10?'ppr10':teams===12?'full':teams===14?'ppr14':null;
  if(rec===0.5)return teams===12?'half':teams===14?'half14':null;
  if(rec===0)return teams===12?'std':null;
  return null;
}"""

def main():
    if not PAGE.exists():
        sys.exit("run this from the repo root (fantasy-warroom.html not found)")
    s = PAGE.read_text(encoding="utf-8")
    if NEW in s:
        print("already applied - no change"); return
    n = s.count(OLD)
    if n != 1:
        sys.exit(f"expected exactly 1 occurrence of mvColumn(), found {n}. "
                 "The page has drifted; re-read it before patching.")
    PAGE.write_text(s.replace(OLD, NEW), encoding="utf-8", newline="\n")
    print("patched mvColumn() in fantasy-warroom.html")
    print("NEXT, same commit: cd work && python3 stamp-sw-version.py && node verify-sw.mjs")

if __name__ == "__main__":
    main()
