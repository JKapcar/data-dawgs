#!/usr/bin/env python3
"""No gate + compare curves.

1. PROJECTION MODE. The two-completed-weeks gate goes away: when observed
   history can't carry the maths, sync() pulls Sleeper's season player
   projections (one fetch, the same public API the league sync uses), builds
   each roster's best projected lineup from the league's own slot list, and
   runs the identical pipeline — ladder, wheel, weekly odds, season Monte
   Carlo — with every team carrying an ASSUMED ±21-point weekly spread.
   ⚠️ Every projected surface says so: "projected", assumed spread, byes and
   injuries not modeled. Observed scoring takes over by itself at two
   completed weeks. If projections are unreachable or rosters are empty
   (pre-draft), the old honest empty state remains the fallback.

2. COMPARE CHIPS on The Long Game chart. One chip per team above the decay
   chart; tapping overlays that team's curve in its own colour with an
   end label (focus team is always drawn, in accent). Selection persists
   per league on this device. Kap's ask: "compare my team and emads on a
   decay function."

Run from repo root:  python3 work/patch-lds-nogate.py
"""
import pathlib

P = pathlib.Path("guillotine.html")
s = P.read_text(encoding="utf-8")


def sub(old, new, label, count=1):
    global s
    n = s.count(old)
    assert n == count, f"{label}: expected {count} occurrence(s), found {n}"
    s = s.replace(old, new)
    print(f"  ok  {label}")


# ------------------------------------------------------------------ CSS ----
sub("@media(max-width:640px){#gxSeasonTab td,#gxSeasonTab th{padding:6px 6px;font-size:11px}}",
    """@media(max-width:640px){#gxSeasonTab td,#gxSeasonTab th{padding:6px 6px;font-size:11px}}
.gx-cmp{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 2px}
.gx-cmp button{border:1px solid var(--grid);background:var(--surface-1);color:var(--ink-2);
  border-radius:999px;padding:5px 11px;font:700 11px/1.2 inherit;cursor:pointer}
.gx-cmp button.on{border-color:currentColor}
.gx-cmp button.me{color:var(--accent);border-color:var(--accent);font-weight:800;cursor:default}""",
    "CSS: compare chips")

# ---------------------------------------------------------------- banner ----
sub("The weekly odds and Chop Wheel are simulations from completed history&mdash;not live in-game scores or ownership verification.",
    "The weekly odds and Chop Wheel are simulations &mdash; from completed history once two weeks exist, from Sleeper player projections before that &mdash; not live in-game scores or ownership verification.",
    "banner: projections named")

# ---------------------------------------------------------------- markup ----
sub('      <div class="statrow" id="gxSeasonCard"></div>\n      <div id="gxSeasonChart"></div>',
    '      <div class="statrow" id="gxSeasonCard"></div>\n      <div class="gx-cmp" id="gxCmp"></div>\n      <div id="gxSeasonChart"></div>',
    "markup: compare chip row")

# ----------------------------------------------- sync: projection helpers ----
sub("  async function sync(id){",
    '''  /* ------------------------- projection mode -------------------------------
     NO GATE. When observed history cannot carry the maths (< 2 completed
     weeks), team strength comes from Sleeper's season player projections:
     one public fetch, each roster's best projected lineup under this
     league's own slot list, per-game points = season points / projected gp.
     ⚠️ The spread is ASSUMED — a flat ±21 for every team, a typical weekly
     half-PPR swing — because projections carry no variance. Byes, injuries
     and schedule are not modeled. Every surface in this mode says
     "projected"; observed scoring takes over by itself at two weeks. */
  var PROJ_SD = 21;
  function lineupSlots(positions){
    var sl={QB:0,RB:0,WR:0,TE:0,FLEX:0,SFLX:0};
    (positions||[]).forEach(function(p){
      if(p==="QB")sl.QB++; else if(p==="RB")sl.RB++; else if(p==="WR")sl.WR++; else if(p==="TE")sl.TE++;
      else if(p==="FLEX"||p==="W/R/T"||p==="WRRB_FLEX"||p==="REC_FLEX")sl.FLEX++;
      else if(p==="SUPER_FLEX")sl.SFLX++;
    });
    return sl;
  }
  async function projectTeams(league, rosters, aliveTeams){
    var r = await fetch("https://api.sleeper.app/projections/nfl/"+league.season
      +"?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE");
    if(!r.ok) throw new Error("projections http "+r.status);
    var rows = await r.json();
    var rec = (league.scoring_settings && typeof league.scoring_settings.rec==="number") ? league.scoring_settings.rec : 0.5;
    var key = rec>=1 ? "pts_ppr" : rec>0 ? "pts_half_ppr" : "pts_std";
    var pg={}, ppos={};
    (rows||[]).forEach(function(row){
      var st=row&&row.stats; if(!st||typeof st[key]!=="number")return;
      var games=(typeof st.gp==="number"&&st.gp>0)?st.gp:17;
      pg[row.player_id]=st[key]/games;
      ppos[row.player_id]=(row.player&&row.player.position)||"";
    });
    var slots=lineupSlots(league.roster_positions);
    var byR={}; (rosters||[]).forEach(function(row){ byR[row.roster_id]=row.players||[]; });
    var out=[];
    aliveTeams.forEach(function(t){
      var ps=(byR[t.rid]||[]).map(function(p){ return {pos:ppos[p]||"", pg:pg[p]||0}; })
                             .filter(function(p){ return p.pg>0; });
      if(!ps.length) return;
      var by={QB:[],RB:[],WR:[],TE:[]};
      ps.forEach(function(p){ if(by[p.pos]) by[p.pos].push(p.pg); });
      for(var k in by) by[k].sort(function(a,b){ return b-a; });
      var mean=0, flexPool=[];
      ["QB","RB","WR","TE"].forEach(function(k2){
        var take=slots[k2]||0;
        by[k2].forEach(function(v,ix){
          if(ix<take) mean+=v;
          else if(k2!=="QB"||slots.SFLX>0) flexPool.push(v);
        });
      });
      flexPool.sort(function(a,b){ return b-a; });
      for(var f=0; f<slots.FLEX+slots.SFLX && f<flexPool.length; f++) mean+=flexPool[f];
      // ⚠️ low/last stay null in projection mode — nothing has been observed,
      // and fabricating an "observed low" would be lying with a number.
      t.mean=mean; t.sd=PROJ_SD; t.n=0; t.low=null; t.last=null; t.proj=true;
      out.push(t);
    });
    return out;
  }
  async function sync(id){''',
    "sync: projectTeams helper")

# --------------------------------------------- sync: the gate becomes a mode -
sub("""    if(live.length < 2){
      paintEmpty(league, teams, done,""",
    """    var MODE = "observed";
    if(live.length < 2){
      var projected = null;
      try{ projected = await projectTeams(league, rosters, alive); }catch(e){ projected = null; }
      if(projected && projected.length >= 2){ MODE = "projected"; live = projected; }
      else {
      paintEmpty(league, teams, done,""",
    "sync: projection branch")

sub("""      msg("Connected to <b>"+esc(league.name)+"</b> — "+teams.length+" teams.");
      return;
    }
""",
    """      msg("Connected to <b>"+esc(league.name)+"</b> — "+teams.length+" teams. Projections attach as soon as rosters exist.");
      return;
      }
    }
""",
    "sync: fallback keeps the honest empty state")

# ------------------------------------------------- sync: mode-aware labels ---
sub('    elState.textContent = me ? "Modeled week · focus selected" : "Modeled week · pick a focus team";',
    '    elState.textContent = (MODE==="projected" ? "Projected · " : "Modeled week · ") + (me ? "focus selected" : "pick a focus team");',
    "labels: state chip")

sub('''      elPctL.innerHTML = "chance <b>"+esc(me.name)+"</b> survives week "+(done+1)
        + " — the probability of not being the lowest scorer, from "+done+" weeks of this league's own scoring.";''',
    '''      elPctL.innerHTML = "chance <b>"+esc(me.name)+"</b> survives week "+(done+1)
        + (MODE==="projected"
          ? " — modeled from Sleeper player projections with an assumed ±"+PROJ_SD+"-point spread. Nothing observed yet."
          : " — the probability of not being the lowest scorer, from "+done+" weeks of this league's own scoring.");''',
    "labels: hero sentence")

sub('        + tile(live.length,"Teams simulated") + tile(done,"Weeks of history");\n    } else {',
    '        + tile(live.length,"Teams simulated") + (MODE==="projected"?tile("Sleeper","Projection source"):tile(done,"Weeks of history"));\n    } else {',
    "labels: focus tiles")

sub('        + tile(live.length,"Teams simulated") + tile(done,"Weeks of history");\n    }\n',
    '        + tile(live.length,"Teams simulated") + (MODE==="projected"?tile("Sleeper","Projection source"):tile(done,"Weeks of history"));\n    }\n',
    "labels: no-focus tiles")

sub('    elTab.innerHTML = "<thead><tr><th>Team</th><th>Avg</th><th>Std dev</th><th>Low</th><th>Last</th><th>Survive</th></tr></thead><tbody>"',
    '    elTab.innerHTML = "<thead><tr><th>Team</th><th>"+(MODE==="projected"?"Proj avg":"Avg")+"</th><th>"+(MODE==="projected"?"Assumed spread":"Std dev")+"</th><th>Low</th><th>Last</th><th>Survive</th></tr></thead><tbody>"',
    "labels: weekly table head")

sub('''            + "<td>"+t.mean.toFixed(1)+"</td><td>"+t.sd.toFixed(1)+"</td><td>"+t.low.toFixed(1)+"</td>"
            + "<td>"+t.last.toFixed(1)+"</td><td class='"''',
    '''            + "<td>"+t.mean.toFixed(1)+"</td><td>"+t.sd.toFixed(1)+"</td><td>"+(t.low==null?"—":t.low.toFixed(1))+"</td>"
            + "<td>"+(t.last==null?"—":t.last.toFixed(1))+"</td><td class='"''',
    "labels: weekly table nulls")

sub('''    elNote.innerHTML = "⚠️ "+SIMS.toLocaleString()+" simulated weeks from each team's own mean and spread over "
      + done + " completed week" + (done===1?"":"s") + "."''',
    '''    elNote.innerHTML = "⚠️ "+SIMS.toLocaleString()+(MODE==="projected"
      ? " simulated weeks from Sleeper season player projections — best projected lineup per roster, an assumed ±"+PROJ_SD+"-point spread for every team; byes, injuries and schedule are not modeled. Your league's own observed scoring takes over at two completed weeks."
      : " simulated weeks from each team's own mean and spread over "+done+" completed week"+(done===1?"":"s")+".")''',
    "labels: weekly note")

sub('    msg("Connected to <b>"+esc(league.name)+"</b> — "+teams.length+" teams, "+done+" completed weeks.");',
    '    msg("Connected to <b>"+esc(league.name)+"</b> — "+teams.length+" teams, "+(MODE==="projected"?"projection mode (no scores yet)":done+" completed weeks")+".");',
    "labels: connect message")

sub("      done: done, chop: res.chop, chopLo: res.chopLo, chopHi: res.chopHi,",
    '      done: done, mode: MODE, chop: res.chop, chopLo: res.chopLo, chopHi: res.chopHi,',
    "stash: mode travels")

# --------------------------------------------- view block: mode-aware bits ---
sub("card.innerHTML=me?tile(esc(me.name),\"Focus team\")+tile(Math.round(me.surv*100)+\"%\",\"Modeled weekly survival\")+tile((me.mean-G.chop>=0?\"+\":\"\")+(me.mean-G.chop).toFixed(1),\"Avg vs modeled chop\")+tile(G.done,\"Observed weeks\"):tile(\"Not selected\",\"Focus team\")+tile(G.done,\"Observed weeks\");",
    "card.innerHTML=me?tile(esc(me.name),\"Focus team\")+tile(Math.round(me.surv*100)+\"%\",G.mode===\"projected\"?\"Projected weekly survival\":\"Modeled weekly survival\")+tile((me.mean-G.chop>=0?\"+\":\"\")+(me.mean-G.chop).toFixed(1),G.mode===\"projected\"?\"Proj avg vs chop\":\"Avg vs modeled chop\")+(G.mode===\"projected\"?tile(\"Projections\",\"Running on\"):tile(G.done,\"Observed weeks\")):tile(\"Not selected\",\"Focus team\")+(G.mode===\"projected\"?tile(\"Projections\",\"Running on\"):tile(G.done,\"Observed weeks\"));",
    "view: survival card mode labels")

sub("d.innerHTML='<thead><tr><th>Team</th><th>Modeled chop risk</th><th>Risk</th><th>Observed avg</th><th>Observed low</th></tr></thead><tbody>'",
    "d.innerHTML='<thead><tr><th>Team</th><th>Modeled chop risk</th><th>Risk</th><th>'+(G.mode===\"projected\"?\"Projected avg\":\"Observed avg\")+'</th><th>Observed low</th></tr></thead><tbody>'",
    "view: danger table head")

sub("+t.mean.toFixed(1)+'</td><td>'+t.low.toFixed(1)+'</td></tr>';}).join(\"\")+'</tbody>';d.querySelectorAll",
    "+t.mean.toFixed(1)+'</td><td>'+(t.low==null?\"—\":t.low.toFixed(1))+'</td></tr>';}).join(\"\")+'</tbody>';d.querySelectorAll",
    "view: danger table nulls")

sub("var f=document.getElementById(\"gxFragilityTab\");f.innerHTML='<thead><tr><th>Team</th><th>Observed volatility</th><th>Observed floor</th><th>V1 flag</th></tr></thead><tbody>'",
    """var f=document.getElementById("gxFragilityTab");
    /* fragility is an OBSERVED instrument — in projection mode every team carries
       the same assumed spread, so there is no volatility to measure yet. */
    if(G.mode==="projected"){f.innerHTML='<tbody><tr><td style="text-align:left">Weak Spots needs observed weeks. In projection mode every team carries the same assumed ±21 spread, so volatility and floor cannot be measured — this fills in on its own once games are played.</td></tr></tbody>';}
    else f.innerHTML='<thead><tr><th>Team</th><th>Observed volatility</th><th>Observed floor</th><th>V1 flag</th></tr></thead><tbody>'""",
    "view: fragility guard")

sub('''      if(flat)flat.innerHTML="Modeled from "+G.done+" completed week"+(G.done===1?"":"s")
        +" — a simulation, not live scores. Tap a bar to make that team your focus.";''',
    '''      if(flat)flat.innerHTML=(G.mode==="projected"
        ? "Modeled from Sleeper player projections — assumed ±21 spread, byes and injuries not modeled; observed scoring takes over at two completed weeks."
        : "Modeled from "+G.done+" completed week"+(G.done===1?"":"s")+" — a simulation, not live scores.")
        +" Tap a bar to make that team your focus.";''',
    "view: ladder note")

# ------------------------------------- view block: compare chips + curves ----
sub("  function heatBg(v){",
    '''  var CMPKEY="dd-guillotine-cmp-v1",
      CMPPAL=["#4FA3E3","#2FD4A6","#8E7BE0","#E4386B","#F2B33D","#3F9E86"];
  function cmpList(lg){try{var m=JSON.parse(localStorage.getItem(CMPKEY)||"{}");return (m[lg]||[]).slice(0,8);}catch(e){return [];}}
  function cmpToggle(lg,rid){try{var m=JSON.parse(localStorage.getItem(CMPKEY)||"{}");var a=m[lg]||[],ix=a.indexOf(rid);
    if(ix>-1)a.splice(ix,1);else a.push(rid);m[lg]=a.slice(-8);localStorage.setItem(CMPKEY,JSON.stringify(m));}catch(e){}}
  function heatBg(v){''',
    "view: compare state")

sub('''    S.rows.forEach(function(r){if(r.rid!==meRid)svg.push('<polyline points="'+pts(r)+'" fill="none" stroke="var(--ink-3)" stroke-opacity=".33" stroke-width="1.5" stroke-linejoin="round"/>');});
    if(mine){
      svg.push('<polyline points="'+pts(mine)+'" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>');
      svg.push('<circle cx="'+X(rem)+'" cy="'+Y(mine.curve[rem-1])+'" r="3.5" fill="var(--accent)"/>');
      svg.push('<text x="'+(X(rem)-6)+'" y="'+Math.max(10,Y(mine.curve[rem-1])-8)+'" text-anchor="end" font-size="10" font-weight="800" fill="var(--accent)">'+esc(mine.name)+" "+Math.round(mine.curve[rem-1]*100)+'%</text>');
    }
    svg.push('</svg>');
    chart.innerHTML=svg.join("");''',
    '''    /* compare overlays: field faint, chosen teams in their chip colour, focus on top */
    var cmp=cmpList(G.leagueId),colorOf={};
    cmp.forEach(function(rid,ix){ colorOf[rid]=CMPPAL[ix%CMPPAL.length]; });
    var labels=[];
    S.rows.forEach(function(r){if(r.rid!==meRid&&colorOf[r.rid]===undefined)svg.push('<polyline points="'+pts(r)+'" fill="none" stroke="var(--ink-3)" stroke-opacity=".33" stroke-width="1.5" stroke-linejoin="round"/>');});
    S.rows.forEach(function(r){var c=colorOf[r.rid];if(c===undefined||r.rid===meRid)return;
      svg.push('<polyline points="'+pts(r)+'" fill="none" stroke="'+c+'" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>');
      svg.push('<circle cx="'+X(rem)+'" cy="'+Y(r.curve[rem-1])+'" r="3" fill="'+c+'"/>');
      labels.push({y:Y(r.curve[rem-1]),text:r.name+" "+Math.round(r.curve[rem-1]*100)+"%",color:c,w:600});});
    if(mine){
      svg.push('<polyline points="'+pts(mine)+'" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>');
      svg.push('<circle cx="'+X(rem)+'" cy="'+Y(mine.curve[rem-1])+'" r="3.5" fill="var(--accent)"/>');
      labels.push({y:Y(mine.curve[rem-1]),text:mine.name+" "+Math.round(mine.curve[rem-1]*100)+"%",color:"var(--accent)",w:800});
    }
    /* end labels collide when curves converge — nudge them 12px apart, top-down */
    labels.sort(function(a,b){return a.y-b.y;});
    for(var li=0;li<labels.length;li++){
      if(li>0&&labels[li].y-labels[li-1].y<12)labels[li].y=labels[li-1].y+12;
      var lb=labels[li];
      svg.push('<text x="'+(X(rem)-7)+'" y="'+Math.max(10,lb.y-6)+'" text-anchor="end" font-size="10" font-weight="'+lb.w+'" fill="'+lb.color+'">'+esc(lb.text)+'</text>');
    }
    svg.push('</svg>');
    chart.innerHTML=svg.join("");
    /* the chips: tap to overlay a team's curve; the focus team is always drawn */
    var chipsEl=document.getElementById("gxCmp");
    if(chipsEl){
      chipsEl.innerHTML=S.rows.map(function(r){
        var isMe=r.rid===meRid,on=colorOf[r.rid]!==undefined;
        return '<button type="button" data-rid="'+r.rid+'" class="'+(isMe?"me":(on?"on":""))+'"'
          +(on&&!isMe?' style="color:'+colorOf[r.rid]+'"':'')+'>'+esc(r.name)+'</button>';
      }).join("");
      Array.prototype.forEach.call(chipsEl.querySelectorAll("button"),function(b){
        b.onclick=function(){var rid=Number(b.getAttribute("data-rid"));if(rid===meRid)return;
          cmpToggle(G.leagueId,rid);seasonPaint(G);};
      });
    }''',
    "view: compare chips + labelled overlays")

sub('+(S.capped?"; the season ends at week 17 with more than one dawg standing, so &ldquo;wins&rdquo; means alive at the end":"")+". Tap a row to make that team your focus.";',
    '+(S.capped?"; the season ends at week 17 with more than one dawg standing, so &ldquo;wins&rdquo; means alive at the end":"")'
    '+(G.mode==="projected"?". ⚠️ Projection mode: team strength is Sleeper season projections with an assumed ±21 spread — nothing observed yet":"")'
    +'+". Tap a team name above the chart to overlay its curve and compare decay side by side; tap a row to make that team your focus.";',
    "view: season note + compare hint")

# --------------------------------------------------------------- Toto -------
sub("Finishing places are among the simulated teams only.`,",
    """Finishing places are among the simulated teams only.
- PROJECTION MODE: before two completed weeks exist, team means come from SLEEPER SEASON PLAYER PROJECTIONS — the best projected lineup per roster under this league's slot list — and every team carries an ASSUMED ±21-point weekly spread; byes, injuries and schedule are NOT modeled. Call every number in this mode "projected", never "observed". The page switches to the league's own scoring by itself at two completed weeks.`,""",
    "Toto sys: projection mode")

sub("    L.push(`LEAGUE: ${G.league} (${G.season}). ${G.teamCount} teams, ${G.done} completed week(s) of scoring history. Next week is week ${G.done+1}.`);",
    """    L.push(`LEAGUE: ${G.league} (${G.season}). ${G.teamCount} teams, ${G.done} completed week(s) of scoring history. Next week is week ${G.done+1}.`);
    if(G.mode === "projected")
      L.push(`⚠️ PROJECTION MODE — no observed scoring yet. Every team mean below is Sleeper season player projections (best projected lineup per roster); every team carries an ASSUMED ±21-point spread; byes, injuries and schedule are not modeled. Quote all of it as projected.`);""",
    "Toto ctx: mode banner")

sub("G.teams.forEach(t=>L.push(`${t.name} | ${t.owner} | ${Math.round(t.surv*100)}% | ${t.mean.toFixed(1)} | ${t.sd.toFixed(1)} | ${t.low.toFixed(1)} | ${t.last.toFixed(1)}`));",
    "G.teams.forEach(t=>L.push(`${t.name} | ${t.owner} | ${Math.round(t.surv*100)}% | ${t.mean.toFixed(1)} | ${t.sd.toFixed(1)} | ${t.low==null?'—':t.low.toFixed(1)} | ${t.last==null?'—':t.last.toFixed(1)}`));",
    "Toto ctx: null guards")

sub("    if(G.done < 4) L.push(`⚠️ ONLY ${G.done} COMPLETED WEEK(S).",
    "    if(G.mode !== \"projected\" && G.done < 4) L.push(`⚠️ ONLY ${G.done} COMPLETED WEEK(S).",
    "Toto ctx: thin-history warning is observed-only")

# -------------------------------------------------------------- honesty -----
sub("Survival odds are a simulation from completed-score history and its variance &mdash; they assume the next week plays like a typical past week.",
    "Survival odds are a simulation from completed-score history and its variance &mdash; they assume the next week plays like a typical past week. Before two completed weeks exist the page runs in projection mode instead: Sleeper season player projections build each roster&rsquo;s best projected lineup and every team carries an assumed ±21-point spread &mdash; byes, injuries and schedule are not modeled there, and nothing in that mode is observed.",
    "honesty: projection mode named")

P.write_text(s, encoding="utf-8")
print("\nguillotine.html patched (no gate + compare).")
