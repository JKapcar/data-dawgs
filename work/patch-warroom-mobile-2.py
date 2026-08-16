#!/usr/bin/env python3
"""War room: charts stay legible on a phone.

Round 3 made every SVG fluid, which fixed the layout and created a legibility
problem: font sizes live in viewBox units, so a 640-unit chart shown in a
~350px column scales every label by 0.55. Ten-pixel tick text lands at five
and a half real pixels — visible, unreadable.

The fix is to draw a narrower chart rather than shrink a wide one. NARROW()
matches the same 760px breakpoint the CSS uses, and each renderer picks its
geometry from it, so on a phone the viewBox is close to 1:1 with the CSS
pixels and a 10px label renders at 10px. Desktop geometry is untouched.

Row-label gutters shrink with the canvas (a 120-unit name column inside a
360-unit chart would leave nothing for the bar), and the stacked-bar and
diverge charts keep their squeeze-to-fit label behaviour from round 1.

Because the breakpoint is only read at draw time, a rotation or a desktop
window drag across 760px would leave the previous geometry on screen. A
debounced media-query listener re-renders on the crossing only — not on
every resize event, which would rerun the whole pipeline while dragging.

Anchor-based, idempotent (skips any edit whose new text is already present).
"""

PATH = "../fantasy-warroom.html"
edits = [
    # NARROW helper, next to the other chart constants
    ("function svgDiverge(rows){\n  const W=340,rh=30,pad=96,H=rows.length*rh+16;",
     "/* Chart geometry is chosen per draw: a phone gets a narrower viewBox rather than a\n"
     "   shrunken wide one, so label sizes survive. Same 760px breakpoint as the CSS. */\n"
     "const NARROW=()=>window.matchMedia('(max-width:760px)').matches;\n"
     "function svgDiverge(rows){\n"
     "  const W=NARROW()?300:340,rh=30,pad=NARROW()?78:96,H=rows.length*rh+16;"),

    # depth split bars
    ("  const W=420,H=104,pad=104,bar=W-pad-58;",
     "  const W=NARROW()?320:420,H=104,pad=NARROW()?84:104,bar=W-pad-58;"),

    # stacked money bars
    ("  const W=560,rh=26,pad=120,barW=W-pad-58,H=rows.length*rh+26;",
     "  const W=NARROW()?340:560,rh=26,pad=NARROW()?92:120,barW=W-pad-58,H=rows.length*rh+26;"),

    # price-against-production scatter
    ("  const W=560,H=300,l=46,b=34;",
     "  const W=NARROW()?340:560,H=NARROW()?260:300,l=NARROW()?38:46,b=34;"),

    # dynasty scatters
    ("  const W=640,H=380,l=56,r=18,t=18,b=46;",
     "  const W=NARROW()?340:640,H=NARROW()?300:380,l=NARROW()?44:56,r=NARROW()?10:18,t=14,b=46;"),

    # re-render when the breakpoint is actually crossed
    ("""$('rcTeamSel').onchange=e=>{""",
     """/* Geometry is picked at draw time, so a rotation or a window drag across the
   breakpoint would strand the previous chart shape on screen. Redraw on the
   crossing only — a raw resize listener would rerun the pipeline mid-drag. */
try{
  const mq=window.matchMedia('(max-width:760px)');
  const redraw=()=>{if(state)render()};
  mq.addEventListener?mq.addEventListener('change',redraw):mq.addListener(redraw);
}catch(e){}
$('rcTeamSel').onchange=e=>{"""),
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
print(f"patch-warroom-mobile-2: {changed} edit(s) applied, {len(edits)-changed} already present")
