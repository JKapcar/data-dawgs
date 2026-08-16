#!/usr/bin/env python3
"""The value matrix is the one wide table without a scroll wrapper.

Sweep of the four sheets not previously reviewed found desktop clean
everywhere and one real defect: on a 390px viewport the Rosters sheet
measures 603px of document width. Every other wide table on the page
(wr-money, the dynasty trade table) sits inside an overflow-x:auto
wrapper and scrolls within its card; wr-matrix was emitted bare, so it
pushed the document instead of scrolling itself.

Same wrapper, same min-width convention as table.wr-money: the columns
keep a legible width and the card scrolls horizontally on a phone
rather than the whole page drifting.

Anchor-based, idempotent.
"""

PATH = "../fantasy-warroom.html"
edits = [
    ('      <table class="wr-matrix"><thead id="matrixHead"></thead><tbody id="matrix"></tbody></table>',
     '      <div class="wr-tablewrap"><table class="wr-matrix"><thead id="matrixHead"></thead><tbody id="matrix"></tbody></table></div>'),

    (".wr-matrix td[data-pos]{cursor:pointer}",
     ".wr-tablewrap{overflow-x:auto}\n"
     "table.wr-matrix{min-width:520px}\n"
     ".wr-matrix td[data-pos]{cursor:pointer}"),
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
print(f"patch-warroom-mobile-5: {changed} edit(s) applied, {len(edits)-changed} already present")
