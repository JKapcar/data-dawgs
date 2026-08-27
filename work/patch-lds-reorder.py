"""
Am I Safe?: reorder the sheet, split the decay views, and add a single simulated season.

Order is now wheel -> who is dying -> decay curve -> decay matrix -> one simulated season.
The wheel leads because it is the thing people open the page to look at, and the two decay
views are split because they answer different questions: the curve is shape over time, the
matrix is a number per team per week. They were sharing one card and one heading.

THE SIMULATED SEASON is the new view. Every other panel here reports a DISTRIBUTION -- 5,000
seasons averaged into curves and percentages -- which answers "how often" and never "what
does a season actually look like". One draw from the same model, printed as a finishing
order, does. It is explicitly ONE sample: reloading gives a different answer, and the card
says so, because a single draw presented without that warning is the easiest number on the
page to mistake for a prediction.

    cd work && py patch-lds-reorder.py
"""
import pathlib
import re

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "guillotine.html"
s = PAGE.read_text(encoding="utf-8")

# ---- 1. split The Long Game into curve + matrix, and add the result card ----
old = ('    <div class="hero-card"><h2>The Long Game <span class="samp">Season Monte Carlo &middot; modeled</span></h2>' + NL +
       '      <div class="statrow" id="gxSeasonCard"></div>' + NL +
       '      <div class="gx-cmp" id="gxCmp"></div>' + NL +
       '      <div id="gxSeasonChart"></div>' + NL +
       '      <div class="tscroll"><table class="dtab" id="gxSeasonTab"></table></div>' + NL +
       '      <p class="legend" id="gxSeasonNote">Turns on once two completed weeks exist &mdash; the same gate as the weekly odds.</p>' + NL +
       '    </div>')
assert s.count(old) == 1, "long game card"

new = ('    <div class="hero-card"><h2>The Long Game <span class="samp">Season Monte Carlo &middot; modeled</span></h2>' + NL +
       '      <div class="statrow" id="gxSeasonCard"></div>' + NL +
       '      <div class="gx-cmp" id="gxCmp"></div>' + NL +
       '      <div id="gxSeasonChart"></div>' + NL +
       '      <p class="legend">Each line is one team&rsquo;s modeled chance of still being alive, week by week. Tap a name above to overlay it.</p>' + NL +
       '    </div>' + NL + NL +
       '    <div class="hero-card"><h2>Week-by-week decay <span class="samp">Same model, per team</span></h2>' + NL +
       '      <div class="tscroll"><table class="dtab" id="gxSeasonTab"></table></div>' + NL +
       '      <p class="legend" id="gxSeasonNote">Turns on once two completed weeks exist &mdash; the same gate as the weekly odds.</p>' + NL +
       '    </div>' + NL + NL +
       '    <div class="hero-card"><h2>One simulated season <span class="samp">A single draw &middot; not a forecast</span></h2>' + NL +
       '      <p class="legend" style="margin:0 0 12px">Everything above averages thousands of seasons. This runs <b>one</b> and prints how it finished &mdash; press it again and it will differ, which is the point.</p>' + NL +
       '      <button class="btn" id="gxOneRun" type="button" disabled>Run one season</button>' + NL +
       '      <div class="tscroll" style="margin-top:12px"><table class="dtab" id="gxOneTab"></table></div>' + NL +
       '      <p class="legend" id="gxOneNote"></p>' + NL +
       '    </div>')
s = s.replace(old, new, 1)

# ---- 2. wheel first, then the two survival cards ---------------------------
sec = re.search(r'(  <section class="gx-sheet" id="gxSheetSurvival"[^>]*>\n)(.*?)(\n  </section>\n)', s, re.S)
assert sec, "survival section"
body = sec.group(2)

wheel = re.search(r'\n    <div class="hero-card">\n      <h2>The Chop Wheel.*?\n    </div>\n', body, re.S)
assert wheel, "wheel card"
wheel_html = wheel.group(0)
body_wo = body.replace(wheel_html, NL, 1)
# the wheel leads; everything else keeps its relative order
new_body = wheel_html.rstrip(NL) + NL + body_wo.lstrip(NL)
s = s.replace(sec.group(0), sec.group(1) + new_body + sec.group(3), 1)

# ---- 3. one-season engine ---------------------------------------------------
anchor = "  var CMPKEY=\"dd-guillotine-cmp-v1\","
assert s.count(anchor) == 1, "cmp key anchor"
engine = r'''  /* ONE season off the same maths as simulateSeason: same means, same spreads, same
     lowest-score-goes rule. Deliberately its own function rather than a flag on the big
     simulator -- that one accumulates 5,000 runs into counters and has no notion of a
     single path, and bolting one on would have meant threading sample state through the
     hot loop for the sake of a display. */
  function simulateOne(G){
    var src=(G.teams||[]).filter(function(t){return t.sd>0;}), n=src.length;
    if(n<2) return null;
    var rem=Math.max(1,Math.min(17-G.done,n-1)), sp=null;
    function g(){
      if(sp!==null){var v=sp;sp=null;return v;}
      var u,w,q;do{u=Math.random()*2-1;w=Math.random()*2-1;q=u*u+w*w;}while(q>=1||q===0);
      var m=Math.sqrt(-2*Math.log(q)/q);sp=w*m;return u*m;
    }
    var alive=[],out=[],i;
    for(i=0;i<n;i++)alive.push(i);
    for(var wk=0; wk<rem && alive.length>1; wk++){
      var lo=Infinity, li=0, sc=[];
      for(var a=0;a<alive.length;a++){
        var t=src[alive[a]], x=t.mean+g()*t.sd;
        sc.push(x);
        if(x<lo){lo=x;li=a;}
      }
      out.push({rid:src[alive[li]].rid, name:src[alive[li]].name, week:G.done+1+wk, score:lo});
      alive.splice(li,1);
    }
    var left=alive.map(function(ix){ return {rid:src[ix].rid, name:src[ix].name, week:null, score:null}; });
    /* Finish order: whoever is still standing takes the top places, then the chopped in
       reverse -- the last one cut finished higher than the first. */
    var order=left.concat(out.slice().reverse());
    return {order:order, weeks:rem, survivors:left.length, capped:rem < n-1};
  }

'''
s = s.replace(anchor, engine + anchor, 1)

# ---- 4. wire the button -----------------------------------------------------
anchor = '  var conf'
if anchor not in s:
    anchor = '  function receipt(){'
assert s.count(anchor) >= 1, "wire anchor"
wire = r'''  function onePaint(G){
    var btn=document.getElementById("gxOneRun"), tab=document.getElementById("gxOneTab"),
        note=document.getElementById("gxOneNote");
    if(!btn||!tab) return;
    var ok=!!(G&&G.teams&&G.teams.length>1);
    btn.disabled=!ok;
    if(!ok){ tab.innerHTML=""; if(note) note.textContent="Needs a connected league with at least two teams still alive."; return; }
    btn.onclick=function(){
      var R=simulateOne(G);
      if(!R){ tab.innerHTML=""; return; }
      tab.innerHTML='<thead><tr><th>Finish</th><th>Team</th><th>Chopped</th></tr></thead><tbody>'
        +R.order.map(function(x,i){
          var me=G.me&&x.rid===G.me.rid;
          return '<tr'+(me?' class="gx-danger"':'')+'><td>'+ord(i+1)+'</td>'
            +'<td'+(me?' style="color:var(--accent);font-weight:800"':'')+'>'+esc(x.name)+'</td>'
            +'<td>'+(x.week==null?'<span class="samp">still standing</span>':'week '+x.week)+'</td></tr>';
        }).join("")+'</tbody>';
      if(note) note.innerHTML='One draw from the same model the curves above are built from &mdash; '
        +R.weeks+' chop week(s) simulated'
        +(R.survivors>1?', '+R.survivors+' still standing when the season ran out':'')
        +'. ⚠️ It is a SAMPLE, not a prediction: run it again and the order changes. Nothing here is graded.';
    };
  }

''' + anchor
s = s.replace(anchor, wire, 1)

# call it wherever the season paints
old = "    seasonPaint(G);"
assert s.count(old) == 1, "seasonPaint call"
s = s.replace(old, old + "onePaint(G);", 1)

PAGE.write_text(s, encoding="utf-8", newline=NL)
print("patch-lds-reorder: ok")
