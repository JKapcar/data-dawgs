#!/usr/bin/env python3
"""War room: league-card buttons stop stretching to half the card.

Round 2 stacked the league shelf cards and flexed their two buttons to fill
the row, which reads well in a four-across grid and badly with one league
saved: the card spans the full page and "Refresh"/"Remove" become two
900px-wide bars, the loudest elements on the sheet.

Buttons size to their labels now and sit left. The phone rule that already
flexes them to fill (max-width:760px) is untouched, where full-width tap
targets are the right call.

Anchor-based, idempotent.
"""

PATH = "../fantasy-warroom.html"
old = ".wr-leaguehub .wr-league-actions{margin-left:0;margin-top:auto}.wr-leaguehub .wr-league-actions .wr-mini{flex:1}"
new = ".wr-leaguehub .wr-league-actions{margin-left:0;margin-top:auto;flex-wrap:wrap}"

s = open(PATH, encoding="utf-8").read()
if new in s and old not in s:
    print("patch-warroom-visual-4: already applied")
else:
    assert s.count(old) == 1, f"anchor not unique or missing ({s.count(old)}x)"
    s = s.replace(old, new)
    open(PATH, "w", encoding="utf-8").write(s)
    print("patch-warroom-visual-4: 1 edit applied")
