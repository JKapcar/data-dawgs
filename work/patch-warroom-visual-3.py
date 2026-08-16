#!/usr/bin/env python3
"""War room visual round 3 — charts fill the card they live in.

Every SVG the page draws carried a fixed pixel width equal to its viewBox
(420–640px). In a full-width card on a desktop that leaves most of the card
empty to the right, which reads as a broken layout rather than a small chart —
and on a narrow phone the fixed width forces horizontal overflow.

The fix is one shared class: width 100%, height auto, and a per-chart
max-width so a two-row bar chart cannot stretch to 1800px and look absurd.
The viewBox is unchanged, so every coordinate the renderers compute still
lands where it did — only the presentation box is fluid.

Caps, chosen by what the chart has to say:
  scatter plots  1100px — more room genuinely separates more points
  stacked bars    980px — one row per team, longer bars stay readable
  radar           320px — a shape does not benefit from being huge
  gain/lose, depth bars 620px — few rows, nothing to gain past that

Anchor-based, idempotent (skips any edit whose new text is already present).
"""

PATH = "../fantasy-warroom.html"

CSS_ANCHOR = ".wr-radarcard .rf{font-size:11px;color:var(--ink-3);margin-top:3px}"
CSS_NEW = (CSS_ANCHOR + "\n"
           ".wr-svg{display:block;width:100%;height:auto;margin:0 auto}\n"
           ".wr-svg-wide{max-width:1100px}.wr-svg-bars{max-width:980px}"
           ".wr-svg-small{max-width:620px}.wr-svg-radar{max-width:320px}")

# (line-identifying fragment, css class for that chart)
charts = [
    ('aria-label="Points per week above or below the league average by position"', "wr-svg wr-svg-small"),
    ('aria-label="Starter and bench market value against the league average"', "wr-svg wr-svg-small"),
    ('aria-label="Starting-lineup market value by position, by team"', "wr-svg wr-svg-bars"),
    ('aria-label="Market value against projected value over replacement"', "wr-svg wr-svg-wide"),
    ("aria-label=\"'+esc(aria)+'\"", "wr-svg wr-svg-wide"),
]

s = open(PATH, encoding="utf-8").read()
changed = 0

if CSS_NEW not in s:
    assert s.count(CSS_ANCHOR) == 1, "radar-card CSS anchor missing"
    s = s.replace(CSS_ANCHOR, CSS_NEW)
    changed += 1

for frag, cls in charts:
    old = '\'<svg viewBox="0 0 \'+W+\' \'+H+\'" width="\'+W+\'" role="img" ' + frag
    new = '\'<svg viewBox="0 0 \'+W+\' \'+H+\'" class="' + cls + '" role="img" ' + frag
    if new in s:
        continue
    assert s.count(old) == 1, f"chart anchor not unique or missing ({s.count(old)}x): {frag[:50]!r}"
    s = s.replace(old, new)
    changed += 1

# The radar is emitted at width S and re-sized by a string replace in the
# small-multiples path; keep that contract working by class, not by width.
radar_old = ('return \'<svg viewBox="0 0 \'+S+\' \'+S+\'" width="\'+S+\'" role="img" '
             'aria-label="Positional shape against the league average">\'+g+')
radar_new = ('return \'<svg viewBox="0 0 \'+S+\' \'+S+\'" class="wr-svg wr-svg-radar" role="img" '
             'aria-label="Positional shape against the league average">\'+g+')
if radar_new not in s:
    assert s.count(radar_old) == 1, "radar anchor missing"
    s = s.replace(radar_old, radar_new)
    changed += 1

# The small-multiple grid shrank the radar with .replace('width="250"','width="150"'),
# which no longer matches now that the width attribute is gone. Size by CSS instead.
sm_old = """.replace('width="250"','width="150"')"""
sm_new = """.replace('wr-svg-radar','wr-svg-radar wr-svg-mini')"""
if sm_new not in s:
    assert s.count(sm_old) == 1, "small-multiple resize anchor missing"
    s = s.replace(sm_old, sm_new)
    changed += 1

mini_css = ".wr-svg-radar{max-width:320px}"
if ".wr-svg-mini{max-width:150px}" not in s:
    assert s.count(mini_css) == 1, "radar cap anchor missing"
    s = s.replace(mini_css, mini_css + "\n.wr-svg-mini{max-width:150px}")
    changed += 1

open(PATH, "w", encoding="utf-8").write(s)
print(f"patch-warroom-visual-3: {changed} edit(s) applied")
