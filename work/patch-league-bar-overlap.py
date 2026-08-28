"""
The league bar stops sitting on top of Toto and the team picker.

Reported from a phone on dashboard.html in the pepperoninipples league: the "Ask Toto"
launcher is visibly BEHIND the league bar and the "You: …" chip is clipped by it.

Four fixed elements were competing for the same corner:

  #ddLeagueIndicator  right:12 bottom:12, max-width:calc(100vw - 24px)   z-index 9998
  #ddbLaunch          bottom:18 (12 on mobile)                           z-index 58
  #ddmeChip           bottom:18 (12 on mobile)                           z-index 58
  #ddbDock            bottom:0, full width on mobile                     z-index 60

A long league name makes the bar span the whole phone at exactly the height of the two
chips, and 9998 paints it over all three. On a phone, in a league, that means the
assistant cannot be tapped, the team picker cannot be tapped, and if the dock were open
its composer would be underneath the bar too. This is a draft-night bug: the board is
the one page fourteen people open on their phones.

Fixed two ways, because either alone leaves a hole:

  1. SPATIALLY — the two chips lift clear of the bar's strip, so they no longer occupy
     the same pixels whatever the stacking order. Written as `body #ddbLaunch` rather
     than `#ddbLaunch` so it out-specifies the mobile rule in the page's own #ddbCSS
     block regardless of which <style> lands in the head first; relying on document
     order between two independently-injected stylesheets is how this comes back.

  2. BY STACKING — the bar drops from 9998 to 57, under the chips (58), the team panel
     (59) and the dock (60). 9998 also put it over every modal on the rig; the backdrop
     at 999 and the auth modal at 9500 should both cover a status bar, and now do. It
     stays above ordinary page content, which is all this bar ever needed.

Run:  cd work && python3 patch-league-bar-overlap.py && python3 stamp-sw-version.py
"""
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
lib = REPO / "draft-league.js"
s = lib.read_text(encoding="utf-8")

OLD_Z = "#ddLeagueIndicator{position:fixed;z-index:9998;right:12px;bottom:12px;"
NEW_Z = "#ddLeagueIndicator{position:fixed;z-index:57;right:12px;bottom:12px;"
if s.count(OLD_Z) != 1:
    sys.exit(f"FAIL draft-league.js: indicator z-index anchor matched {s.count(OLD_Z)} times, expected 1")
s = s.replace(OLD_Z, NEW_Z, 1)

OLD_TAIL = '@media(max-width:600px){#ddLeagueIndicator .ddli-meta{display:none}}"'
NEW_TAIL = ('@media(max-width:600px){#ddLeagueIndicator .ddli-meta{display:none}}'
            '/* The bar owns the bottom strip, so lift the two chips that also live there. '
            '`body #id` out-specifies the mobile rule in the page\'s own #ddbCSS block, which is '
            'injected separately and in no guaranteed order relative to this one. */'
            'body #ddbLaunch,body #ddmeChip{bottom:58px}'
            '@media print{#ddLeagueIndicator{display:none!important}}"')
if s.count(OLD_TAIL) != 1:
    sys.exit(f"FAIL draft-league.js: indicator style tail matched {s.count(OLD_TAIL)} times, expected 1")
s = s.replace(OLD_TAIL, NEW_TAIL, 1)

lib.write_text(s, encoding="utf-8", newline="\n")
print("  draft-league.js")
print("      - league bar z-index 9998 -> 57 (under the chips, the panel, the dock and every modal)")
print("      - #ddbLaunch and #ddmeChip lift to bottom:58px so nothing overlaps in space")
print("      - the bar is hidden in print, like the chips already were")
