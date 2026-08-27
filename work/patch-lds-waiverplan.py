"""
The Waiver Plan: conditional targets with modelled bid ranges.

This is planned items 1 and 2 together, because they are one feature. A bid figure with no
target list is unusable, and a target list with no budget attached is what the page already
had.

CONDITIONAL is the whole point and it is what "full conditional waiver optimization" means
here. Claims are not independent: the second-best free agent is only worth what he adds
AFTER you have won the first, and if you lose the first he is worth more, not less. So the
plan is a SEQUENCE. Each step re-runs the lineup with the previous winner already on the
roster, and each step names the fallback if that claim is lost.

BIDS ARE RANGES, NEVER A FIGURE. The standing rule was "never dress a specific bid
recommendation up as maths"; this ships ranges with the assumptions on the card and the
rule amended in the same commit, because leaving the old rule while shipping the opposite
is how a page starts lying about itself.

Allocation is proportional to each step's share of total modelled gain, spending at most
SPEND of what is left so the plan never advises going all-in, with a +/-25% band. That
policy is stated on the card rather than hidden here -- a reader who disagrees with it can
see exactly what to discount.

The free-agent pool is derived, not fetched: /players/nfl is deliberately not pulled (5MB),
so the universe is the projection rows minus every id on every roster in this league.

    cd work && py patch-lds-waiverplan.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "guillotine.html"
s = PAGE.read_text(encoding="utf-8")

# ---- 1. engine, placed beside weakSpots so they share lineupShape -----------
anchor = "  async function weakSpots(league, rosters, teamList, done){"
assert s.count(anchor) == 1, "weakSpots anchor"

engine = r'''  /* Shared player map: id -> per-game points, position, injury, nfl team. Built once from
     the same projection rows Weak Spots uses, so the two features cannot disagree about
     what a player is worth. */
  function playerMap(league, rows){
    var rec=(league.scoring_settings && typeof league.scoring_settings.rec==="number")?league.scoring_settings.rec:0.5;
    var key = rec>=1 ? "pts_ppr" : rec>0 ? "pts_half_ppr" : "pts_std";
    var P={};
    (rows||[]).forEach(function(row){
      var st=row&&row.stats; if(!st||typeof st[key]!=="number")return;
      var g=(typeof st.gp==="number"&&st.gp>0)?st.gp:17;
      P[row.player_id]={id:String(row.player_id), pg:st[key]/g,
                        name:(row.player&&(row.player.full_name||((row.player.first_name||"")+" "+(row.player.last_name||"")).trim()))||String(row.player_id),
                        pos:(row.player&&row.player.position)||"",
                        inj:(row.player&&row.player.injury_status)||"", tm:ab(row.player&&row.player.team)};
    });
    return P;
  }

  /* How much a single free agent would add to THIS lineup, in points per week. Not his
     projection -- the lineup delta, which is zero for a player who would not start. */
  function lineupGain(mine, cand, slots, base){
    var sh=lineupShape(mine.concat([cand]), slots);
    return sh ? (sh.total - base) : 0;
  }

  var PLAN_STEPS = 4, PLAN_SPEND = 0.70, PLAN_BAND = 0.25;
  async function waiverPlan(league, rosters, meRid, done){
    if(meRid==null) return null;
    var rows; try{ rows = await projRows(league.season); }catch(e){ return null; }
    var P=playerMap(league, rows), slots=lineupSlots(league.roster_positions);
    var taken={}, myIds=null, myUsed=0;
    (rosters||[]).forEach(function(r){
      (r.players||[]).forEach(function(id){ taken[id]=1; });
      if(String(r.roster_id)===String(meRid)){
        myIds=(r.players||[]).slice();
        myUsed=(r.settings && r.settings.waiver_budget_used) || 0;
      }
    });
    if(!myIds) return null;
    var mine=myIds.map(function(id){ return P[id]; }).filter(function(p){ return p && p.pg>0; });
    var pool=Object.keys(P).filter(function(id){ return !taken[id] && P[id].pg>0; })
                           .map(function(id){ return P[id]; });
    if(!mine.length || !pool.length) return null;
    var budget=(league.settings && league.settings.waiver_budget) || 0;
    var left=Math.max(0, budget-myUsed);
    var sh=lineupShape(mine, slots);
    if(!sh) return null;
    var base=sh.total, steps=[], used={};
    for(var k=0;k<PLAN_STEPS;k++){
      var best=null, second=null;
      pool.forEach(function(c){
        if(used[c.id]) return;
        var g=lineupGain(mine, c, slots, base);
        if(!best || g>best.g){ second=best; best={c:c, g:g}; }
        else if(!second || g>second.g){ second={c:c, g:g}; }
      });
      /* Below a quarter point a week it is noise, and printing it would dress rounding
         error up as a recommendation. */
      if(!best || best.g < 0.25) break;
      steps.push({id:best.c.id, name:best.c.name, pos:best.c.pos, tm:best.c.tm,
                  gain:best.g, inj:best.c.inj,
                  alt: second && second.g>=0.25 ? {name:second.c.name, pos:second.c.pos, gain:second.g} : null});
      used[best.c.id]=1;
      mine=mine.concat([best.c]);
      base=lineupShape(mine, slots).total;
    }
    if(!steps.length) return null;
    var tot=steps.reduce(function(a,x){ return a+x.gain; },0) || 1;
    steps.forEach(function(x){
      var alloc = left * PLAN_SPEND * (x.gain/tot);
      x.lo = Math.max(1, Math.round(alloc*(1-PLAN_BAND)));
      x.hi = Math.max(x.lo+1, Math.round(alloc*(1+PLAN_BAND)));
      if(x.hi>left) x.hi=Math.max(1,left);
      if(x.lo>x.hi) x.lo=x.hi;
      x.pct = left>0 ? (alloc/left) : 0;
    });
    return {steps:steps, left:left, budget:budget, spend:PLAN_SPEND, band:PLAN_BAND,
            reserve:Math.max(0, Math.round(left*(1-PLAN_SPEND)))};
  }

'''
s = s.replace(anchor, engine + anchor, 1)

# weakSpots should use the shared map rather than keeping its own copy
old = r'''    var rec=(league.scoring_settings && typeof league.scoring_settings.rec==="number")?league.scoring_settings.rec:0.5;
    var key = rec>=1 ? "pts_ppr" : rec>0 ? "pts_half_ppr" : "pts_std";
    var P={};
    (rows||[]).forEach(function(row){
      var st=row&&row.stats; if(!st||typeof st[key]!=="number")return;
      var g=(typeof st.gp==="number"&&st.gp>0)?st.gp:17;
      P[row.player_id]={pg:st[key]/g, pos:(row.player&&row.player.position)||"",
                        inj:(row.player&&row.player.injury_status)||"", tm:ab(row.player&&row.player.team)};
    });'''
assert s.count(old) == 1, "weakSpots player map"
s = s.replace(old, "    var P=playerMap(league, rows);", 1)

# ---- 2. compute it alongside Weak Spots -------------------------------------
old = "    try{ WS = await weakSpots(league, rosters, alive, done); }catch(e){ WS = null; }"
new = (old + NL +
       "    var WP = null;" + NL +
       "    /* cfg(), not `saved`: that var is declared further down this same function, so at" + NL +
       "       this point hoisting has it as undefined and .me would throw straight into the" + NL +
       "       catch, silently yielding no plan at all. */" + NL +
       "    try{ WP = await waiverPlan(league, rosters, cfg().me, done); }catch(e){ WP = null; }")
assert s.count(old) == 1, "WS call anchor"
s = s.replace(old, new, 1)

old = "      done: done, mode: MODE, ws: WS, chop: res.chop,"
new = "      done: done, mode: MODE, ws: WS, plan: WP, chop: res.chop,"
assert s.count(old) == 1, "stash anchor"
s = s.replace(old, new, 1)

# ---- 3. the card ------------------------------------------------------------
old = '  <div class="hero-card" id="gxWvCard" style="display:none">'
card = r'''  <div class="hero-card" id="gxPlanCard">
    <h2>The Waiver Plan <span class="samp">Modelled &middot; ranges, not prices</span></h2>
    <p class="wr-note" id="gxPlanLead"></p>
    <div class="tscroll"><table class="dtab" id="gxPlanTab"></table></div>
    <p class="legend" id="gxPlanNote"></p>
  </div>
'''
assert s.count(old) == 1, "waiver card anchor"
s = s.replace(old, card + old, 1)

# ---- 4. render --------------------------------------------------------------
old = '    var f=document.getElementById("gxFragilityTab");'
render = r'''    (function(){
      var P=(G&&G.plan)||null, t=document.getElementById("gxPlanTab"),
          lead=document.getElementById("gxPlanLead"), note=document.getElementById("gxPlanNote");
      if(!t) return;
      if(!P){
        t.innerHTML='<tbody><tr><td style="text-align:left">No plan yet — this needs a focus team, a connected league and Sleeper projections. Pick your team from the ladder above.</td></tr></tbody>';
        if(lead) lead.textContent="";
        if(note) note.textContent="";
        return;
      }
      /* Order matters and is the feature: step 2 is priced on the assumption that step 1
         was WON. Presenting these as an unordered shopping list would misprice every row
         after the first. */
      t.innerHTML='<thead><tr><th>#</th><th>Target</th><th>Adds /wk</th><th>Bid range</th><th>If you miss him</th></tr></thead><tbody>'
        +P.steps.map(function(x,i){
          return '<tr><td>'+(i+1)+'</td><td>'+esc(x.name)+' <span class="samp">'+esc(x.pos)+(x.tm?' '+esc(x.tm):'')
            +(x.inj?' · '+esc(x.inj):'')+'</span></td>'
            +'<td>+'+x.gain.toFixed(1)+'</td>'
            +'<td>$'+x.lo+'–$'+x.hi+' <span class="samp">'+Math.round(x.pct*100)+'% of left</span></td>'
            +'<td>'+(x.alt?esc(x.alt.name)+' <span class="samp">+'+x.alt.gain.toFixed(1)+'</span>':'—')+'</td></tr>';
        }).join("")+'</tbody>';
      if(lead) lead.innerHTML='<b>$'+P.left+'</b> of your FAAB is unspent. This plan commits at most '
        +Math.round(P.spend*100)+'% of it and keeps <b>$'+P.reserve+'</b> back.';
      if(note) note.innerHTML='Each step is priced ASSUMING the steps above it were won — that is what makes it a plan '
        +'rather than a shopping list, and it is why step 2 is worth less here than it would be on its own. '
        +'“Adds /wk” is the change to your best starting lineup, not the player’s projection: a player who would not '
        +'start adds nothing. Ranges are a share of what you have left, proportional to each step’s share of the '
        +'modelled gain, ±'+Math.round(P.band*100)+'%. '
        +'⚠️ These are modelled ranges, not prices and not a bid engine. They cannot see what anyone else intends to '
        +'bid, roster need around the league, or a run on a position — the three things that actually set a winning '
        +'bid. Nothing here is graded. Treat the ordering as the useful part and the dollars as a starting point.';
    })();

''' + old
assert s.count(old) == 1, "render anchor"
s = s.replace(old, render, 1)

PAGE.write_text(s, encoding="utf-8", newline=NL)
print("patch-lds-waiverplan: ok")
