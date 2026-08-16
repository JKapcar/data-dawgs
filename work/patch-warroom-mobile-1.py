#!/usr/bin/env python3
"""War room: stop the page scrolling sideways on a phone.

Measured in the rig at a 390px viewport with a 12-team league connected:
Overview scrollWidth 432, Dynasty lens 741, Money 643. Nearly two screens
wide on the Dynasty sheet — every vertical scroll drifts the content
sideways, which is the single worst thing a phone page can do.

Every cause was the same CSS mistake in four places: a grid track sized
`1fr` or `minmax(FIXEDpx,1fr)` is floored by its content's min-width, so a
560px-min table or a 150px tile refuses to shrink and pushes its ancestors
past the viewport. `minmax(0,...)` and `min(FIXED,100%)` let the track
actually reach zero, at which point the child's own overflow-x wrapper
(already present on the wide tables) does its job.

  .wr-grid mobile track  1fr  -> minmax(0,1fr)   (the Money table's 560px min)
  .wr-tiles              150  -> min(150px,100%) (4 stat tiles on Dynasty lens)
  .wr-radars             168  -> min(168px,100%) (12 small-multiple radars)
  .wr-leaguehub .wr-saved 250 -> min(250px,100%) (the league shelf cards)

`.wr-card{min-width:0}` is the belt to that braces: a card can never be
wider than the column it was given.

Anchor-based, idempotent (skips any edit whose new text is already present).
"""

PATH = "../fantasy-warroom.html"
edits = [
    ("  .wr-grid{grid-template-columns:1fr}",
     "  .wr-grid{grid-template-columns:minmax(0,1fr)}"),

    (".wr-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}",
     ".wr-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr));gap:12px;margin-bottom:16px}"),

    (".wr-radars{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px}",
     ".wr-radars{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(168px,100%),1fr));gap:12px}"),

    (".wr-leaguehub .wr-saved{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));margin-top:16px}",
     ".wr-leaguehub .wr-saved{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(250px,100%),1fr));margin-top:16px}"),

    (".wr-card{background:var(--surface-1);border:1px solid var(--grid);border-radius:12px;padding:18px}",
     ".wr-card{background:var(--surface-1);border:1px solid var(--grid);border-radius:12px;padding:18px;min-width:0}"),
]

s = open(PATH, encoding="utf-8").read()
changed = 0
for old, new in edits:
    if new in s:
        continue
    assert s.count(old) == 1, f"anchor not unique or missing ({s.count(old)}x): {old[:70]!r}"
    s = s.replace(old, new)
    changed += 1
open(PATH, "w", encoding="utf-8").write(s)
print(f"patch-warroom-mobile-1: {changed} edit(s) applied, {len(edits)-changed} already present")
