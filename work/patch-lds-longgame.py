#!/usr/bin/env python3
"""The Long Game: season Monte Carlo — survival decay + likely finish.

Rolls the SAME weekly model forward: each simulated season draws every live
team's week from Normal(mean, sd), chops the lowest, repeats until one dawg
stands (or the week-17 cap). 5,000 seasons give, per team: the survival curve
through every remaining week (the decay), win odds, and a median finish.

Honesty notes that must survive future edits:
- ⚠️ Rosters are FROZEN. The model carries today's mean/sd through December —
  no waivers, no injuries, no byes, and no chopped-roster talent
  redistribution, which is the defining dynamic of the format. Every weekly
  caveat compounds with each simulated week. This ships as a modeled
  illustration, never a forecast.
- Finishing places are among the SIMULATED teams only; already-chopped teams
  hold the bottom places and excluded teams (under 2 weeks of scores) are not
  placed at all.
- The honesty card stops listing "season championship Monte Carlo" as Planned
  in the same commit the module ships — a stale Planned chip is a lie with a
  date on it.

Run from repo root:  python3 work/patch-lds-longgame.py
"""
import pathlib

P = pathlib.Path("guillotine.html")
s = P.read_text(encoding="utf-8")


def sub(old, new, label):
    global s
    n = s.count(old)
    assert n == 1, f"{label}: expected 1 occurrence, found {n}"
    s = s.replace(old, new)
    print(f"  ok  {label}")


# ------------------------------------------------------------------ CSS ----
sub(".gx-stage h2.pt-title .samp{display:block;margin:8px 0 0;width:fit-content;max-width:100%}",
    """.gx-stage h2.pt-title .samp{display:block;margin:8px 0 0;width:fit-content;max-width:100%}
/* ------------------------- The Long Game (season MC) --------------------- */
#gxSeasonChart{margin:16px 0 6px}
#gxSeasonChart svg{display:block;width:100%;height:auto}
#gxSeasonTab td,#gxSeasonTab th{white-space:nowrap;font-variant-numeric:tabular-nums}
#gxSeasonTab tbody tr{cursor:pointer}
#gxSeasonTab tbody tr:hover td{background:color-mix(in srgb,var(--accent) 7%,transparent)}
#gxSeasonTab td.me{font-weight:800;color:var(--accent)}
#gxSeasonTab td.hm{color:var(--ink-1)}
@media(max-width:640px){#gxSeasonTab td,#gxSeasonTab th{padding:6px 6px;font-size:11px}}""",
    "CSS: season chart + heat matrix")

# --------------------------------------------------------------- markup ----
sub('    <div class="hero-card"><h2>The Long Game <span class="samp">Shareable framework</span></h2><div id="gxSeasonOutlook" class="statrow"></div><p class="legend">Weekly survival compounds, but a full season championship Monte Carlo is <span class="gx-planned">Planned</span>. This sheet does not pretend the current weekly baseline is a championship forecast.</p></div>',
    """    <div class="hero-card"><h2>The Long Game <span class="samp">Season Monte Carlo &middot; modeled</span></h2>
      <div class="statrow" id="gxSeasonCard"></div>
      <div id="gxSeasonChart"></div>
      <div class="tscroll"><table class="dtab" id="gxSeasonTab"></table></div>
      <p class="legend" id="gxSeasonNote">Turns on once two completed weeks exist &mdash; the same gate as the weekly odds.</p>
    </div>""",
    "markup: season sheet becomes the Monte Carlo")

# ------------------------------------------------------------------- JS ----
SEASON_JS = '''  function ord(n){var v=n%100,sfx=(v>=11&&v<=13)?"th":({1:"st",2:"nd",3:"rd"}[n%10]||"th");return n+sfx;}
  /* ---------------------- The Long Game: season Monte Carlo ---------------
     The weekly model, rolled forward. Each simulated season: draw every live
     team's week from Normal(mean, sd), chop the lowest, repeat until one
     remains or the week-17 cap. Nothing else is modeled — rosters are FROZEN,
     so no waivers, injuries, byes, or chopped-roster talent redistribution,
     and every weekly assumption compounds with each simulated week. That is
     why the sheet says "modeled illustration", not "forecast". */
  var SEASON_SIMS=5000;
  function simulateSeason(G){
    var src=(G.teams||[]).filter(function(t){return t.sd>0;}),n=src.length;
    if(n<2)return null;
    var rem=Math.max(1,Math.min(17-G.done,n-1));
    var elim=[],winN=new Array(n).fill(0),i,k;
    for(i=0;i<n;i++)elim.push(new Array(rem).fill(0));
    var sp=null;
    function g(){if(sp!==null){var v=sp;sp=null;return v;}var u,w,q;do{u=Math.random()*2-1;w=Math.random()*2-1;q=u*u+w*w;}while(q>=1||q===0);var m=Math.sqrt(-2*Math.log(q)/q);sp=w*m;return u*m;}
    for(var s2=0;s2<SEASON_SIMS;s2++){
      var alive=[];for(i=0;i<n;i++)alive.push(i);
      for(var w2=0;w2<rem&&alive.length>1;w2++){
        var lo=Infinity,li=0;
        for(var a=0;a<alive.length;a++){var t=src[alive[a]],x=t.mean+g()*t.sd;if(x<lo){lo=x;li=a;}}
        elim[alive[li]][w2]++;alive.splice(li,1);
      }
      for(var a2=0;a2<alive.length;a2++)winN[alive[a2]]++;
    }
    var weeks=[];for(k=0;k<rem;k++)weeks.push(G.done+1+k);
    var rows=src.map(function(t,ix){
      var curve=[],aliveCt=SEASON_SIMS;
      for(k=0;k<rem;k++){aliveCt-=elim[ix][k];curve.push(aliveCt/SEASON_SIMS);}
      var half=SEASON_SIMS/2,acc=0,med=1,found=false;
      for(k=0;k<rem;k++){acc+=elim[ix][k];if(acc>=half){med=n-k;found=true;break;}}
      if(!found)med=1;
      return {rid:t.rid,name:t.name,win:winN[ix]/SEASON_SIMS,curve:curve,med:med};
    });
    rows.sort(function(a,b){return b.win-a.win;});
    return {sims:SEASON_SIMS,weeks:weeks,rows:rows,teams:n,
            excluded:(G.teams||[]).length-n,chopped:G.chopped||0,capped:rem<n-1};
  }
  function heatBg(v){return v>=2/3?"rgba(63,163,125,.16)":v>=1/3?"rgba(233,161,61,.20)":"rgba(255,86,86,.24)";}
  function seasonPaint(G){
    var S=G.mc,card=document.getElementById("gxSeasonCard"),chart=document.getElementById("gxSeasonChart"),
        tabEl=document.getElementById("gxSeasonTab"),note=document.getElementById("gxSeasonNote");
    if(!card||!S)return;
    var meRid=G.me&&G.me.rid,rem=S.weeks.length;
    var mine=null;for(var i=0;i<S.rows.length;i++)if(S.rows[i].rid===meRid)mine=S.rows[i];
    card.innerHTML=(mine
      ? tile(Math.round(mine.win*100)+"%","Modeled odds "+esc(mine.name)+" wins it all")
        +tile(ord(mine.med),"Their median simulated finish")
      : tile("Pick a focus team","Tap any row below"))
      +tile(rem,"Chop weeks simulated")+tile(S.sims.toLocaleString(),"Simulated seasons");
    /* chart: every team's survival curve; the field in faint ink, focus in accent */
    var W=560,H=210,x0=42,x1=552,y0=14,y1=182;
    function X(k){return x0+(x1-x0)*k/rem;}          // k=0 is now
    function Y(p){return y0+(1-p)*(y1-y0);}
    function pts(r){var out=[X(0)+","+Y(1)];for(var k=0;k<rem;k++)out.push(X(k+1)+","+Y(r.curve[k]));return out.join(" ");}
    var svg=['<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Modeled survival probability by week for every simulated team">'];
    [[1,"100%"],[.5,"50%"],[0,"0%"]].forEach(function(gset){
      svg.push('<line x1="'+x0+'" y1="'+Y(gset[0])+'" x2="'+x1+'" y2="'+Y(gset[0])+'" stroke="var(--grid)" stroke-width="1"'+(gset[0]===0.5?' stroke-dasharray="3 4"':'')+'/>');
      svg.push('<text x="'+(x0-6)+'" y="'+(Y(gset[0])+3)+'" text-anchor="end" font-size="9" fill="var(--ink-3)">'+gset[1]+'</text>');
    });
    svg.push('<text x="'+x0+'" y="'+(H-4)+'" font-size="9" fill="var(--ink-3)">now</text>');
    svg.push('<text x="'+X(rem)+'" y="'+(H-4)+'" text-anchor="end" font-size="9" fill="var(--ink-3)">wk '+S.weeks[rem-1]+'</text>');
    if(rem>3)svg.push('<text x="'+X(Math.ceil(rem/2))+'" y="'+(H-4)+'" text-anchor="middle" font-size="9" fill="var(--ink-3)">wk '+S.weeks[Math.ceil(rem/2)-1]+'</text>');
    S.rows.forEach(function(r){if(r.rid!==meRid)svg.push('<polyline points="'+pts(r)+'" fill="none" stroke="var(--ink-3)" stroke-opacity=".33" stroke-width="1.5" stroke-linejoin="round"/>');});
    if(mine){
      svg.push('<polyline points="'+pts(mine)+'" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>');
      svg.push('<circle cx="'+X(rem)+'" cy="'+Y(mine.curve[rem-1])+'" r="3.5" fill="var(--accent)"/>');
      svg.push('<text x="'+(X(rem)-6)+'" y="'+Math.max(10,Y(mine.curve[rem-1])-8)+'" text-anchor="end" font-size="10" font-weight="800" fill="var(--accent)">'+esc(mine.name)+" "+Math.round(mine.curve[rem-1]*100)+'%</text>');
    }
    svg.push('</svg>');
    chart.innerHTML=svg.join("");
    /* matrix: the decay, week by week, for everyone */
    var head='<thead><tr><th>Team</th><th>Wins it all</th><th>Median finish</th>'
      +S.weeks.map(function(w){return '<th>Wk '+w+'</th>';}).join("")+'</tr></thead>';
    var body=S.rows.map(function(r){
      var me=r.rid===meRid;
      return '<tr data-rid="'+r.rid+'"><td class="'+(me?'me':'')+'">'+esc(r.name)+'</td>'
        +'<td>'+Math.round(r.win*100)+'%</td><td>'+ord(r.med)+'</td>'
        +r.curve.map(function(v){return '<td class="hm" style="background:'+heatBg(v)+'">'+Math.round(v*100)+'%</td>';}).join("")
        +'</tr>';
    }).join("");
    tabEl.innerHTML=head+'<tbody>'+body+'</tbody>';
    Array.prototype.forEach.call(tabEl.querySelectorAll("tbody tr"),function(tr){
      tr.onclick=function(){focus(Number(tr.getAttribute("data-rid")));};});
    note.innerHTML="Each cell is the modeled chance that team is still alive after that week&rsquo;s chop, from "
      +S.sims.toLocaleString()+" simulated seasons of the same weekly model. ⚠️ Rosters are frozen at today&rsquo;s scoring form &mdash; "
      +"no waivers, injuries, byes, or the talent redistribution every chop causes &mdash; and those omissions compound each week, "
      +"so treat this as a modeled illustration, not a forecast. Finishing places are among the "+S.teams+" simulated teams"
      +(S.chopped?"; "+S.chopped+" chopped team(s) already hold the bottom places":"")
      +(S.excluded?"; "+S.excluded+" team(s) with under 2 weeks of scores are not simulated":"")
      +(S.capped?"; the season ends at week 17 with more than one dawg standing, so &ldquo;wins&rdquo; means alive at the end":"")+". Tap a row to make that team your focus.";
  }
'''
sub("  function paint(G){ladder(G);",
    SEASON_JS + "  function paint(G){ladder(G);",
    "JS: simulateSeason + seasonPaint")

sub('var left=Math.max(1,Math.min(17-G.done,teams.length-1)),out=document.getElementById("gxSeasonOutlook");out.innerHTML=(me?tile(Math.round(Math.pow(me.surv,left)*100)+"%","Repeated-week illustration"):tile("Pick a focus team","Personal illustration"))+tile(left,"Remaining eliminations")+tile("Planned","Championship Monte Carlo");var sel=',
    '''/* season MC is cached on the stash: focus taps repaint without re-simulating */
    if(!G.mc)G.mc=simulateSeason(G);
    seasonPaint(G);var sel=''',
    "JS: paint wires the season MC")

# -------------------------------------------------------- honesty card -----
sub("Projection-driven FAAB bid recommendations, full conditional waiver optimization, season championship Monte Carlo, Universal Data Vault, and injury, bye-week, positional-depth and player-concentration fragility components are all <span class=\"gx-planned\">Planned</span>.",
    "Projection-driven FAAB bid recommendations, full conditional waiver optimization, Universal Data Vault, and injury, bye-week, positional-depth and player-concentration fragility components are all <span class=\"gx-planned\">Planned</span>. The Long Game&rsquo;s season Monte Carlo rolls the weekly model forward with rosters frozen at their current mean and spread &mdash; it cannot see waivers, injuries, byes, or the talent redistribution every chop causes, those omissions compound with every simulated week, and its finishing places cover the simulated teams only.",
    "honesty: season MC is shipped, with its compounding caveat")

# ------------------------------------------------------------- Toto --------
sub("- The FAAB WAR PLAN card is a dated editorial framework calibrated to ONE room's observed 2025 winning bids plus published case studies. Quote its ranges as opinion with the date. The standing rule holds: never dress a specific bid recommendation up as maths.`,",
    """- The FAAB WAR PLAN card is a dated editorial framework calibrated to ONE room's observed 2025 winning bids plus published case studies. Quote its ranges as opinion with the date. The standing rule holds: never dress a specific bid recommendation up as maths.
- THE LONG GAME sheet is a SEASON Monte Carlo: thousands of simulated seasons rolling the same weekly model forward, chopping the lowest each week. ⚠️ Rosters are FROZEN at today's mean and spread — no waivers, no injuries, no byes, and no chopped-roster talent redistribution, which is the defining dynamic of this format — and every weekly assumption COMPOUNDS with each simulated week. Quote win odds and survival curves as a modeled illustration, never as a forecast. Finishing places are among the simulated teams only.`,""",
    "Toto sys: season MC caveats")

sub("    if(G.done < 4) L.push(`⚠️ ONLY ${G.done} COMPLETED WEEK(S).",
    """    if(G.mc && G.mc.weeks){
      const S = G.mc;
      L.push(`SEASON MONTE CARLO (modeled; ${S.sims} simulated seasons; rosters FROZEN at current form — no waivers/injuries/byes/redistribution; finishes among the ${S.teams} simulated teams):`);
      L.push('team | win% | median finish | alive through wk ' + S.weeks[S.weeks.length-1]);
      S.rows.forEach(r => L.push(`${r.name} | ${Math.round(r.win*100)}% | ${r.med} | ${Math.round(r.curve[r.curve.length-1]*100)}%`));
    }
    if(G.done < 4) L.push(`⚠️ ONLY ${G.done} COMPLETED WEEK(S).""",
    "Toto ctx: season table")

P.write_text(s, encoding="utf-8")
print("\nguillotine.html patched (The Long Game).")
