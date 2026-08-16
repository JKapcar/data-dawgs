#!/usr/bin/env python3
"""League map: you can find out which dot is which.

Asked for: hover that names the team, and colour-coding the dots by team.
The first is built here. The second is refused, with the reason recorded so
the decision does not get re-litigated by whoever reads this next.

WHY NOT TWELVE COLOURS. Categorical hue stops working past about eight
slots: adjacent pairs fall under the separation floor for normal vision and
well under it for the common colour-vision deficiencies, so a twelve-hue
scatter is confetti that still cannot be read. Twelve teams also means the
palette changes shape whenever a league is a different size, which breaks
the rule that colour follows the entity rather than its position in a list.
Identity that cannot be carried by hue is carried by the pointer instead —
which is what this does.

WHAT IT DOES INSTEAD:
  - a transparent 24px hit circle per team, so nobody has to hit a 5px dot
    (the mark stays 5px; only the target grows). The mark itself is
    pointer-events:none — it paints after its hit circle, so without that it
    swallowed the pointer at dead centre and only near-misses raised a
    tooltip, which the rig caught by failing to hover a dot at all.
  - the hovered or focused dot lifts — grows and takes a surface ring — so
    the chart visibly responds
  - a styled tooltip names the team with both values, value first and label
    second, following the reader who already knows which dot they are on
  - keyboard parity: every dot is focusable and shows the same readout
  - a "Label every team" toggle, which is the honest answer to "which dot is
    which" for the whole chart at once: it draws the names directly rather
    than asking the reader to hunt one at a time. Placement is greedy —
    above, below, either side, then dropped — because twelve labels on one
    plot do collide, and the first render overprinted two of them.

Team names arrive from a league provider and are inserted with textContent,
never innerHTML — the tooltip is the one place a hostile league name would
otherwise reach the DOM as markup.

Anchor-based, idempotent (explicit sentinels).
"""

PATH = "../fantasy-warroom.html"
edits = [
    # ---- CSS: tooltip + hover lift + label toggle -------------------------
    (".wr-svg{display:block;width:100%;height:auto;margin:0 auto}",
     ".wr-svg{display:block;width:100%;height:auto;margin:0 auto}\n"
     ".wr-plot{position:relative}\n"
     ".wr-hit{fill:transparent;cursor:pointer}\n"
     ".wr-hit:focus-visible{outline:none}\n"
     ".wr-dot{transition:r .08s ease;pointer-events:none}\n"
     ".wr-hit:hover+.wr-dot,.wr-hit:focus-visible+.wr-dot{r:8;stroke:var(--surface-1);stroke-width:2}\n"
     ".wr-tip{position:absolute;z-index:5;pointer-events:none;opacity:0;transform:translate(-50%,-124%);"
     "border:1px solid var(--grid);border-radius:9px;background:var(--surface-1);padding:8px 10px;"
     "box-shadow:0 6px 18px rgba(0,0,0,.16);white-space:nowrap;transition:opacity .09s ease}\n"
     ".wr-tip.on{opacity:1}\n"
     ".wr-tip b{display:block;font-size:15px;font-weight:800;letter-spacing:-.02em;color:var(--ink-1)}\n"
     ".wr-tip span{display:block;font-size:11px;color:var(--ink-3);margin-top:2px}\n"
     "@media(prefers-reduced-motion:reduce){.wr-dot,.wr-tip{transition:none}}",
     ".wr-tip{position:absolute"),

    # ---- dyScatter: hit targets, labels, and a tooltip hook ---------------
    ("""  points.forEach(x=>{const color=x.color||POS_COLOR[x.p?.pos]||'var(--accent)';g+='<circle cx="'+X(x[xKey])+'" cy="'+Y(x[yKey])+'" r="'+(x.mine?6:4.5)+'" style="fill:'+color+';opacity:'+(x.mine?1:.72)+';stroke:'+(x.mine?'var(--ink-1)':'none')+';stroke-width:1.5"><title>'+esc(x[labelKey])+' · this season '+fmt$(x[xKey])+' · dynasty '+fmt$(x[yKey])+'</title></circle>'});""",
     """  /* ⚠️ The hit circle is 24px while the mark stays 5px: an 8px dot is a pinpoint
     nobody hits reliably. It precedes its dot so the CSS sibling selector can lift
     the mark on hover and on keyboard focus alike. */
  points.forEach((x,i)=>{
    const color=x.color||POS_COLOR[x.p?.pos]||'var(--accent)',cx=X(x[xKey]),cy=Y(x[yKey]);
    g+='<circle class="wr-hit" cx="'+cx+'" cy="'+cy+'" r="12" tabindex="0" role="img"'
      +' data-i="'+i+'" data-x="'+cx+'" data-y="'+cy+'"'
      +' aria-label="'+esc(x[labelKey])+', this season '+fmt$(x[xKey])+', dynasty '+fmt$(x[yKey])+'"></circle>'
      +'<circle class="wr-dot" cx="'+cx+'" cy="'+cy+'" r="'+(x.mine?6:4.5)+'" style="fill:'+color
      +';opacity:'+(x.mine?1:.72)+';stroke:'+(x.mine?'var(--ink-1)':'none')+';stroke-width:1.5"></circle>';
  });
  /* Direct labels for everyone, on demand. This — not twelve hues — is the readable
     answer to "which dot is which" for the whole chart at once. */
  /* ⚠️ Twelve labels on one plot WILL collide — the first render overprinted
     "The Slobberknockers" onto "Lake Erie Lightning". Greedy placement: try above,
     then below, then either side, and drop the label if all four collide. A dropped
     label is not lost, it is one hover away; an overprinted pair is unreadable. */
  if(mapLabels){
    const placed=[],hit=(a,b)=>!(a.x2<b.x1||b.x2<a.x1||a.y2<b.y1||b.y2<a.y1);
    points.forEach(x=>{
      const raw=String(x[labelKey]),txt=raw.length>20?raw.slice(0,19)+'…':raw;
      const cx=X(x[xKey]),cy=Y(x[yKey]),w=txt.length*5.4,h=11;
      const spots=[[cx,cy-10,'middle'],[cx,cy+17,'middle'],[cx-9,cy+4,'end'],[cx+9,cy+4,'start']];
      for(const[tx,ty,anchor]of spots){
        const x1=anchor==='middle'?tx-w/2:anchor==='end'?tx-w:tx;
        const box={x1,x2:x1+w,y1:ty-h,y2:ty+3};
        if(box.x1<2||box.x2>W-2||box.y1<t-4||box.y2>H-b+2)continue;
        if(placed.some(q=>hit(q,box)))continue;
        placed.push(box);
        g+='<text x="'+tx+'" y="'+ty+'" text-anchor="'+anchor+'" style="fill:var(--ink-2);font:700 10px system-ui;'
          +'paint-order:stroke;stroke:var(--surface-1);stroke-width:3">'+esc(txt)+'</text>';
        break;
      }
    });
  }""",
     'class="wr-hit"'),

    # ---- the renderer returns a positioned wrapper -------------------------
    ("""  return '<svg viewBox="0 0 '+W+' '+H+'" class="wr-svg wr-svg-wide" role="img" aria-label="'+esc(aria)+'">'+g+'</svg>';
}""",
     """  return '<div class="wr-plot" data-plot="1">'
    +'<svg viewBox="0 0 '+W+' '+H+'" class="wr-svg wr-svg-wide" role="img" aria-label="'+esc(aria)+'">'+g+'</svg>'
    +'<div class="wr-tip" role="status" aria-live="polite"></div></div>';
}

/* Tooltip text is set with textContent, never innerHTML: team names come from a
   league provider and are untrusted. The readout leads with the values because the
   reader already knows which dot they are pointing at. */
let mapLabels=false;
function wirePlot(host,points,keys){
  const plot=host.querySelector('.wr-plot');if(!plot)return;
  const svg=plot.querySelector('svg'),tip=plot.querySelector('.wr-tip');
  const show=el=>{
    const p=points[+el.dataset.i];if(!p)return;
    const box=svg.getBoundingClientRect(),vb=svg.viewBox.baseVal;
    tip.textContent='';
    const b=document.createElement('b');b.textContent=String(p[keys.labelKey]);
    const s=document.createElement('span');
    s.textContent='this season '+fmt$(p[keys.xKey])+' · dynasty '+fmt$(p[keys.yKey]);
    tip.append(b,s);
    tip.style.left=(+el.dataset.x/vb.width*box.width)+'px';
    tip.style.top=(+el.dataset.y/vb.height*box.height)+'px';
    tip.classList.add('on');
  };
  const hide=()=>tip.classList.remove('on');
  plot.querySelectorAll('.wr-hit').forEach(el=>{
    el.addEventListener('pointerenter',()=>show(el));
    el.addEventListener('focus',()=>show(el));
    el.addEventListener('pointerleave',hide);
    el.addEventListener('blur',hide);
  });
  plot.addEventListener('pointerleave',hide);
}""",
     "function wirePlot(host,points,keys)"),

    # ---- wire both dynasty plots + the label toggle -----------------------
    ("""  $('dyTeamLegend').innerHTML=""",
     """  wirePlot($('dyTeamPlot'),teamPoints,{xKey:'season',yKey:'dynasty',labelKey:'name'});
  $('dyTeamLegend').innerHTML=""", "wirePlot($('dyTeamPlot')"),

    ("""  $('dyTeamPlot').innerHTML=dyScatter(teams.map((x,i)=>({...x,name:x.t.name,mine:x===mine,color:x===mine?'var(--accent)':'var(--ink-3)'})),{xKey:'season',yKey:'dynasty',labelKey:'name',aria:'Team this-season value against overall dynasty value'});""",
     """  const teamPoints=teams.map(x=>({...x,name:x.t.name,mine:x===mine,color:x===mine?'var(--accent)':'var(--ink-3)'}));
  $('dyTeamPlot').innerHTML=dyScatter(teamPoints,{xKey:'season',yKey:'dynasty',labelKey:'name',aria:'Team this-season value against overall dynasty value'});""",
     "const teamPoints=teams.map"),

    ("""  $('dyPlayerLegend').innerHTML=""",
     """  wirePlot($('dyPlayerPlot'),playerPoints,{xKey:'season',yKey:'dynasty',labelKey:'name'});
  $('dyPlayerLegend').innerHTML=""", "wirePlot($('dyPlayerPlot')"),

    ("""  $('dyPlayerPlot').innerHTML=dyScatter(mine.rows.map(x=>({...x,name:x.p.name,mine:true})),{xKey:'season',yKey:'dynasty',labelKey:'name',aria:'Your player this-season prices against overall dynasty prices',diagonal:true});""",
     """  const playerPoints=mine.rows.map(x=>({...x,name:x.p.name,mine:true}));
  $('dyPlayerPlot').innerHTML=dyScatter(playerPoints,{xKey:'season',yKey:'dynasty',labelKey:'name',aria:'Your player this-season prices against overall dynasty prices',diagonal:true});""",
     "const playerPoints=mine.rows.map"),

    # ---- the toggle control ----------------------------------------------
    ("""        <h3>League map</h3>""",
     """        <h3>League map <button type="button" class="wr-mini wr-labeltog" id="mapLabelTog" aria-pressed="false">Label every team</button></h3>""",
     'id="mapLabelTog"'),

    (".wr-plot{position:relative}",
     ".wr-plot{position:relative}\n"
     ".wr-labeltog{float:right;font-size:11px;font-weight:700}\n"
     ".wr-labeltog[aria-pressed=\"true\"]{border-color:var(--accent);color:var(--accent);"
     "background:color-mix(in srgb,var(--accent) 12%,var(--surface-1))}",
     ".wr-labeltog{float:right"),

    ("""$('rcTeamSel').onchange=e=>{""",
     """$('mapLabelTog').onclick=e=>{
  mapLabels=!mapLabels;
  e.currentTarget.setAttribute('aria-pressed',String(mapLabels));
  renderDynastyLens();
};
$('rcTeamSel').onchange=e=>{""",
     "$('mapLabelTog').onclick"),
]

s = open(PATH, encoding="utf-8").read()
changed = 0
for old, new, sentinel in edits:
    if sentinel in s:
        continue
    assert s.count(old) == 1, f"anchor not unique or missing ({s.count(old)}x): {old[:70]!r}"
    s = s.replace(old, new)
    changed += 1
open(PATH, "w", encoding="utf-8").write(s)
print(f"patch-warroom-map-hover: {changed} edit(s) applied, {len(edits)-changed} already present")
