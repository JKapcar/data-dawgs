"""
Weak Spots V2, the sheet itself.

V1's two observed columns stay and are still labelled observed; they simply do not exist
before two completed weeks. The four V2 components are roster-derived and render in BOTH
modes, so the sheet stops being dark all preseason.

Each component gets its own column. A single blended flag with no components would be an
opaque verdict, and the whole point is that a reader can see WHICH weakness is driving it.

    cd work && py patch-lds-weakspots-render.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "guillotine.html"
s = PAGE.read_text(encoding="utf-8")

old_proj = ('    if(G.mode==="projected"){f.innerHTML=\'<tbody><tr><td style="text-align:left">Weak Spots '
            'needs observed weeks. In projection mode every team carries the same assumed ±21 spread, '
            'so volatility and floor cannot be measured — this fills in on its own once games are '
            'played.</td></tr></tbody>\';}')
assert s.count(old_proj) == 1, "projected-mode branch"

old_obs_head = ("    else f.innerHTML='<thead><tr><th>Team</th><th>Observed volatility</th>"
                "<th>Observed floor</th><th>V1 flag</th></tr></thead><tbody>'")
assert s.count(old_obs_head) == 1, "observed-mode branch"

new = r'''    /* ⚠ V1 is an OBSERVED instrument and stays that way: volatility and floor cannot
       exist before games are played, and inventing them would be lying with a number.
       V2's four components are ROSTER-derived, so they render in both modes -- which is
       the point, because the preseason is when you can still fix a weak spot. */
    (function(){
      var WS=(G&&G.ws)||{}, obs=(G.mode!=="projected");
      var pc=function(v){ return (v==null||isNaN(v))?"—":Math.round(v*100)+"%"; };
      var head='<thead><tr><th>Team</th>'
        +(obs?'<th>Observed volatility</th><th>Observed floor</th>':'')
        +'<th>Injury</th><th>Bye risk</th><th>Depth drop</th><th>Star reliance</th><th>V2 flag</th></tr></thead>';
      var rows=teams.slice().map(function(t){ return {t:t, w:WS[t.rid]||null}; });
      /* Sort by the V2 score so the sheet answers "who is most fragile" on open. Teams with
         no projectable roster sort last rather than to the top on a zero. */
      rows.sort(function(a,b){ return ((b.w&&b.w.score)||-1)-((a.w&&a.w.score)||-1); });
      var body=rows.map(function(r){
        var t=r.t, w=r.w, x=obs?(t.sd+t.mean-t.low):null;
        if(!w) return '<tr><td>'+esc(t.name)+'</td>'
          +(obs?'<td>'+t.sd.toFixed(1)+'</td><td>'+t.low.toFixed(1)+'</td>':'')
          +'<td colspan="5" style="text-align:left;color:var(--ink-3)">No projectable roster — nothing to measure</td></tr>';
        return '<tr><td>'+esc(t.name)+'</td>'
          +(obs?'<td>'+t.sd.toFixed(1)+'</td><td>'+t.low.toFixed(1)+'</td>':'')
          +'<td>'+pc(w.inj)+'</td>'
          +'<td>'+pc(w.bye)+(w.bye>0&&w.byeWk?' <span class="samp">wk '+w.byeWk+'</span>':'')+'</td>'
          +'<td>'+pc(w.depth)+'</td><td>'+pc(w.conc)+'</td>'
          +'<td>'+w.flag+(obs&&x!=null?' <span class="samp">V1 '+(x>35?'High':x>22?'Watch':'Lower')+'</span>':'')+'</td></tr>';
      }).join("");
      f.innerHTML=head+'<tbody>'+body+'</tbody>';
      var note=document.getElementById("gxFragilityNote");
      if(note) note.innerHTML='Four roster-derived measures, each a share where higher means more fragile. '
        +'<b>Injury</b> is the share of projected starter points carrying an injury designation, weighted by severity '
        +'(out 100%, doubtful 75%, questionable 40%). <b>Bye risk</b> is the worst single week in the next four. '
        +'<b>Depth drop</b> is how far each starter falls to his best same-slot replacement — an empty bench scores the maximum. '
        +'<b>Star reliance</b> is the top two starters’ share, normalised against an evenly-shared lineup of this league’s size. '
        +'These describe a roster’s shape from Sleeper season projections and the site’s own schedule; they are not predictions, '
        +'and they cannot see depth-chart roles, snap share or a coach’s intent. '
        +(obs?'Observed volatility and floor are this league’s own completed scores.'
             :'Observed volatility and floor need two completed weeks and are not shown yet.');
    })();'''

# splice: replace the whole two-branch block with the new one
start = s.index(old_proj)
end = s.index(old_obs_head)
end = s.index("+'</tbody>';", end) + len("+'</tbody>';")
s = s[:start] + new + s[end:]

PAGE.write_text(s, encoding="utf-8", newline=NL)
print("patch-lds-weakspots-render: ok")
