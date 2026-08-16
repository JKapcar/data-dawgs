#!/usr/bin/env python3
"""War room visual round 2 — scatter domains, axis ticks, league cards.

Two problems, both observed on real and synthetic leagues:

1. dyScatter (League map, Your roster's price gaps) anchored both axes at
   zero and scaled to the max, so a league whose teams sit between $128 and
   $224 drew every point in the top-right eighth of a 640x380 canvas, with
   the rest empty. It also had no tick labels at all: the reader could see
   shape but could not read a value off either axis.

   Now the domain is the data range padded 8%, and the two axes share one
   domain whenever the y=x diagonal is drawn (a 45-degree reference line is
   a lie unless the scales match). Four ticks per axis carry dollar labels.
   Zero stays included only when the data actually reaches it.

2. League shelf cards squeezed the league name between the card edge and the
   Open/Remove buttons, so "The Kayfabe Dynasty" rendered "The Kayfab…" —
   in a 4-across grid the buttons take most of the row. The card stacks now:
   name and ID get the full width, actions sit beneath them, and a long name
   wraps to two lines instead of truncating.

Anchor-based, idempotent (skips any edit whose new text is already present).
"""

PATH = "../fantasy-warroom.html"
edits = [
    # 1 — data-driven domains + ticks
    ("""function dyScatter(points,{xKey,yKey,labelKey,aria,diagonal=false}){
  if(!points.length)return '<p class="wr-note">No players are priced in both views.</p>';
  const W=640,H=380,l=48,r=18,t=18,b=42,xm=Math.max(1,...points.map(x=>x[xKey])),ym=Math.max(1,...points.map(x=>x[yKey]));
  const X=v=>l+v/xm*(W-l-r),Y=v=>H-b-v/ym*(H-t-b),avgX=points.reduce((a,x)=>a+x[xKey],0)/points.length,avgY=points.reduce((a,x)=>a+x[yKey],0)/points.length;
  let g=diagonal?'<line x1="'+X(0)+'" y1="'+Y(0)+'" x2="'+X(Math.min(xm,ym))+'" y2="'+Y(Math.min(xm,ym))+'" style="stroke:var(--ink-3);stroke-dasharray:6 4;opacity:.7"/>'
    :'<line x1="'+X(avgX)+'" y1="'+t+'" x2="'+X(avgX)+'" y2="'+(H-b)+'" style="stroke:var(--ink-3);stroke-dasharray:5 4;opacity:.55"/><line x1="'+l+'" y1="'+Y(avgY)+'" x2="'+(W-r)+'" y2="'+Y(avgY)+'" style="stroke:var(--ink-3);stroke-dasharray:5 4;opacity:.55"/>';""",
     """function dyScatter(points,{xKey,yKey,labelKey,aria,diagonal=false}){
  if(!points.length)return '<p class="wr-note">No players are priced in both views.</p>';
  const W=640,H=380,l=56,r=18,t=18,b=46;
  /* ⚠️ Zero-anchored axes drew a league of $128–$224 teams into one corner of an
     empty canvas. Fit the domain to the data with an 8% margin instead. Where the
     y=x diagonal is drawn, both axes MUST share a domain or the 45° line lies. */
  const span=vals=>{const lo=Math.min(...vals),hi=Math.max(...vals),pad=Math.max(1,(hi-lo)*.08);
    return [Math.max(0,lo-pad),hi+pad]};
  let[x0,x1]=span(points.map(p=>p[xKey])),[y0,y1]=span(points.map(p=>p[yKey]));
  if(diagonal){const lo=Math.min(x0,y0),hi=Math.max(x1,y1);x0=y0=lo;x1=y1=hi}
  const X=v=>l+(v-x0)/((x1-x0)||1)*(W-l-r),Y=v=>H-b-(v-y0)/((y1-y0)||1)*(H-t-b);
  const avgX=points.reduce((a,x)=>a+x[xKey],0)/points.length,avgY=points.reduce((a,x)=>a+x[yKey],0)/points.length;
  const ticks=(lo,hi)=>[0,1,2,3].map(i=>lo+(hi-lo)*i/3);
  let g='';
  ticks(x0,x1).forEach(v=>{g+='<line x1="'+X(v)+'" y1="'+t+'" x2="'+X(v)+'" y2="'+(H-b)+'" style="stroke:var(--grid);opacity:.7"/>'
    +'<text x="'+X(v)+'" y="'+(H-b+15)+'" text-anchor="middle" style="fill:var(--ink-3);font:600 10px system-ui">'+fmt$(Math.round(v))+'</text>'});
  ticks(y0,y1).forEach(v=>{g+='<line x1="'+l+'" y1="'+Y(v)+'" x2="'+(W-r)+'" y2="'+Y(v)+'" style="stroke:var(--grid);opacity:.7"/>'
    +'<text x="'+(l-6)+'" y="'+(Y(v)+3.5)+'" text-anchor="end" style="fill:var(--ink-3);font:600 10px system-ui">'+fmt$(Math.round(v))+'</text>'});
  g+=diagonal?'<line x1="'+X(x0)+'" y1="'+Y(y0)+'" x2="'+X(x1)+'" y2="'+Y(y1)+'" style="stroke:var(--ink-3);stroke-dasharray:6 4;opacity:.7"/>'
    :'<line x1="'+X(avgX)+'" y1="'+t+'" x2="'+X(avgX)+'" y2="'+(H-b)+'" style="stroke:var(--ink-3);stroke-dasharray:5 4;opacity:.55"/><line x1="'+l+'" y1="'+Y(avgY)+'" x2="'+(W-r)+'" y2="'+Y(avgY)+'" style="stroke:var(--ink-3);stroke-dasharray:5 4;opacity:.55"/>';"""),

    # 1b — axis captions follow the new geometry
    ("""  g+='<text x="'+((l+W-r)/2)+'" y="'+(H-7)+'" text-anchor="middle" style="fill:var(--ink-3);font:700 11px system-ui">This-season value →</text>'+
    '<text x="14" y="'+((t+H-b)/2)+'" text-anchor="middle" transform="rotate(-90 14 '+((t+H-b)/2)+')" style="fill:var(--ink-3);font:700 11px system-ui">Overall dynasty value →</text>';""",
     """  g+='<text x="'+((l+W-r)/2)+'" y="'+(H-4)+'" text-anchor="middle" style="fill:var(--ink-3);font:700 11px system-ui">This-season value →</text>'+
    '<text x="13" y="'+((t+H-b)/2)+'" text-anchor="middle" transform="rotate(-90 13 '+((t+H-b)/2)+')" style="fill:var(--ink-3);font:700 11px system-ui">Overall dynasty value →</text>';"""),

    # 2 — league shelf cards stack; the name owns the full width
    (".wr-leaguehub .wr-row{min-height:86px;border-radius:11px;padding:12px;flex-wrap:wrap}",
     ".wr-leaguehub .wr-row{min-height:86px;border-radius:11px;padding:12px;flex-direction:column;align-items:stretch;gap:10px}\n"
     ".wr-leaguehub .wr-row .wr-grow b{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;line-height:1.25}"),

    (".wr-leaguehub .wr-row small{display:block;margin-top:4px}.wr-league-actions{display:flex;gap:7px;margin-left:auto}",
     ".wr-leaguehub .wr-row small{display:block;margin-top:4px}.wr-league-actions{display:flex;gap:7px;margin-left:auto}\n"
     ".wr-leaguehub .wr-league-actions{margin-left:0;margin-top:auto}.wr-leaguehub .wr-league-actions .wr-mini{flex:1}"),
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
print(f"patch-warroom-visual-2: {changed} edit(s) applied, {len(edits)-changed} already present")
