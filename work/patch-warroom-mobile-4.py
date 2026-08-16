#!/usr/bin/env python3
"""War room Receipt: the grade box on a phone.

.wr-gradenote carries min-width:220px, so on a 350px column the flex row
wraps and the grade box gets a full-width line to itself: a 76px letter in
a 132px-wide bordered box, roughly 250px tall, sitting above the team name
it grades. The first thing on the sheet became a giant B.

At phone width the box shrinks to a 46px letter and sits beside the name
rather than above it, which is the desktop relationship at phone scale.
The sub-grade tiles drop their 104px floor so four of them fit two-up
instead of stretching.

Anchor-based, idempotent.
"""

PATH = "../fantasy-warroom.html"

ANCHOR = "  .wr-grid{grid-template-columns:minmax(0,1fr)}"
NEW = (ANCHOR + "\n"
       "  /* Keep the grade beside the name at phone width: letting the row wrap gives a\n"
       "     76px letter its own full-width line above the team it grades. */\n"
       "  .wr-gradewrap{gap:13px;align-items:flex-start;flex-wrap:nowrap}\n"
       "  .wr-gradenote{min-width:0}\n"
       "  .wr-grade{font-size:46px;border-width:2px;border-radius:12px;padding:7px 12px;min-width:76px}\n"
       "  .wr-gradelab{margin-top:5px}\n"
       "  .wr-sub{min-width:0;flex:1 1 40%}")

s = open(PATH, encoding="utf-8").read()
if NEW in s:
    print("patch-warroom-mobile-4: already applied")
else:
    assert s.count(ANCHOR) == 1, f"anchor not unique or missing ({s.count(ANCHOR)}x)"
    s = s.replace(ANCHOR, NEW)
    open(PATH, "w", encoding="utf-8").write(s)
    print("patch-warroom-mobile-4: 1 edit applied")
