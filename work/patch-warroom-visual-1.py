#!/usr/bin/env python3
"""War room visual round 1 — clipped labels and truncated names.

Anchor-based and idempotent: each replacement asserts exactly one occurrence
of the old string, or (on a re-run) verifies the new string is already there.

Fixes, all observed on the 2026-08-16 screenshot rig (synthetic league):
1. svgSplit: the total label on the longest depth bar overflowed the viewBox
   ("You $215" rendered as "$2"). Reserve a right gutter for it.
2. svgRadar: side axis labels (SUPERFLEX) clipped at the canvas edge.
   Clamp label x into the canvas instead of centering blindly.
3. Money tiles: roster names hard-sliced to 14 chars mid-word. Full name,
   sized down, wrapping allowed.
4. mnStackedBars: row labels sliced to 16 chars. Squeeze long names with
   textLength instead of truncating.
5. Radar small-multiple titles sliced to 18 chars. Full name + ellipsis + title.
6. "rosters frozen" stamp carried seconds; short date/time is enough.
"""
import sys

PATH = "../fantasy-warroom.html"
edits = [
    # 1 — depth-bar right gutter
    ("const W=420,H=104,pad=104,bar=W-pad-10;",
     "const W=420,H=104,pad=104,bar=W-pad-58;"),

    # 2 — radar labels clamped into canvas
    ("""    const[lx,ly]=pt(i,R+18);
    g+='<text x="'+lx+'" y="'+ly+'" text-anchor="middle" dominant-baseline="middle" style="fill:var(--ink-3);font:700 11px system-ui">'+a+'</text>'});""",
     """    const[lx,ly]=pt(i,R+18);
    const aw=a.length*6.6,tx=Math.max(2,Math.min(S-2-aw,lx-aw/2));
    g+='<text x="'+tx+'" y="'+ly+'" dominant-baseline="middle" style="fill:var(--ink-3);font:700 11px system-ui">'+a+'</text>'});"""),

    # 3 — money tiles: full roster names
    ("""    ['Richest roster',esc(richest.t.name).slice(0,14),fmt$(richest.total)],
    ['Leanest roster',esc(leanest.t.name).slice(0,14),fmt$(leanest.total)],""",
     """    ['Richest roster','<span class="tname">'+esc(richest.t.name)+'</span>',fmt$(richest.total)],
    ['Leanest roster','<span class="tname">'+esc(leanest.t.name)+'</span>',fmt$(leanest.total)],"""),

    (".wr-tile .td{font-size:12px;color:var(--ink-3)}",
     ".wr-tile .td{font-size:12px;color:var(--ink-3)}\n"
     ".wr-tile .tv .tname{display:block;font-size:17px;line-height:1.25;letter-spacing:-.02em;overflow-wrap:anywhere;padding:3px 0 2px}"),

    # 4 — stacked-bar row labels squeezed, never truncated
    ("""g+='<text x="0" y="'+(y+13)+'" style="fill:var(--ink-2);font:'+(r.t===mnMe()?'800':'600')+' 12px system-ui">'+esc(r.t.name).slice(0,16)+'</text>';""",
     """g+='<text x="0" y="'+(y+13)+'"'+(r.t.name.length>15?' textLength="'+(pad-8)+'" lengthAdjust="spacingAndGlyphs"':'')+' style="fill:var(--ink-2);font:'+(r.t===mnMe()?'800':'600')+' '+(r.t.name.length>15?11:12)+'px system-ui">'+esc(r.t.name)+'</text>';"""),

    # 5 — radar card titles: full name, ellipsis, hover title
    ("""'<div class="rn">'+esc(r.t.name).slice(0,18)+'</div>'""",
     """'<div class="rn" title="'+esc(r.t.name)+'">'+esc(r.t.name)+'</div>'"""),

    (".wr-radarcard .rn{font-size:12px;font-weight:700;margin-bottom:2px}",
     ".wr-radarcard .rn{font-size:12px;font-weight:700;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"),

    # 6 — frozen stamp without seconds
    ("rosters frozen '+new Date().toLocaleString()",
     "rosters frozen '+new Date().toLocaleString([],{dateStyle:'short',timeStyle:'short'})"),
]

s = open(PATH, encoding="utf-8").read()
changed = 0
for old, new in edits:
    if new in s:
        continue  # already applied (old may be a substring of new — never re-apply)
    assert s.count(old) == 1, f"anchor not unique or missing ({s.count(old)}x): {old[:70]!r}"
    s = s.replace(old, new)
    changed += 1
open(PATH, "w", encoding="utf-8").write(s)
print(f"patch-warroom-visual-1: {changed} edit(s) applied, {len(edits)-changed} already present")
