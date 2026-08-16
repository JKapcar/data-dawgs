#!/usr/bin/env python3
"""War room scatters: axis labels that collide or run off the canvas.

Two defects visible once the phone geometry landed (rig, 390px viewport):

1. The rotated "Overall dynasty value" caption sits in the same 10-unit band
   as the right-anchored tick labels, so on the narrow canvas "$195" printed
   through the word "value". The card's own prose already states what both
   axes mean ("Right means more this-season value; up means more dynasty
   value"), so the narrow layout drops the rotated caption rather than
   fighting for the space. Desktop keeps it.

2. The first and last x-axis ticks are centred on the canvas edges, so half
   of "$218" fell outside the viewBox and rendered clipped. End ticks now
   anchor inward — start for the first, end for the last — which also stops
   the first tick colliding with the y-axis labels.

Anchor-based, idempotent (skips any edit whose new text is already present).
"""

PATH = "../fantasy-warroom.html"
edits = [
    # x ticks: anchor the end ticks inward instead of centring them off-canvas
    ("""  ticks(x0,x1).forEach(v=>{g+='<line x1="'+X(v)+'" y1="'+t+'" x2="'+X(v)+'" y2="'+(H-b)+'" style="stroke:var(--grid);opacity:.7"/>'
    +'<text x="'+X(v)+'" y="'+(H-b+15)+'" text-anchor="middle" style="fill:var(--ink-3);font:600 10px system-ui">'+fmt$(Math.round(v))+'</text>'});""",
     """  ticks(x0,x1).forEach((v,i,all)=>{const anchor=i===0?'start':i===all.length-1?'end':'middle';
    g+='<line x1="'+X(v)+'" y1="'+t+'" x2="'+X(v)+'" y2="'+(H-b)+'" style="stroke:var(--grid);opacity:.7"/>'
    +'<text x="'+X(v)+'" y="'+(H-b+15)+'" text-anchor="'+anchor+'" style="fill:var(--ink-3);font:600 10px system-ui">'+fmt$(Math.round(v))+'</text>'});"""),

    # y caption: drop it on the narrow canvas, where it overprints the tick labels
    ("""  g+='<text x="'+((l+W-r)/2)+'" y="'+(H-4)+'" text-anchor="middle" style="fill:var(--ink-3);font:700 11px system-ui">This-season value →</text>'+
    '<text x="13" y="'+((t+H-b)/2)+'" text-anchor="middle" transform="rotate(-90 13 '+((t+H-b)/2)+')" style="fill:var(--ink-3);font:700 11px system-ui">Overall dynasty value →</text>';""",
     """  g+='<text x="'+((l+W-r)/2)+'" y="'+(H-4)+'" text-anchor="middle" style="fill:var(--ink-3);font:700 11px system-ui">This-season value →</text>'
    /* The rotated caption shares a band with the right-anchored tick labels. There is
       room for it on the desktop canvas and not on the phone one, and the card's prose
       already names both axes — so the narrow layout goes without. */
    +(NARROW()?'':'<text x="13" y="'+((t+H-b)/2)+'" text-anchor="middle" transform="rotate(-90 13 '+((t+H-b)/2)+')" style="fill:var(--ink-3);font:700 11px system-ui">Overall dynasty value →</text>');"""),
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
print(f"patch-warroom-mobile-3: {changed} edit(s) applied, {len(edits)-changed} already present")
