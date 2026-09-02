#!/usr/bin/env python3
"""guillotine.html — DataDawg$ roster value on Last Dawg Standing.  Idempotent.

    python3 work/patch-guillotine-datadawg.py
    node work/test-guillotine-dd.mjs
    cd work && python3 stamp-sw-version.py && node verify-sw.mjs

The Money sheet already answers "how much money is left" (FAAB pacing, observed) and
"what should a chopped player cost" (the War Plan, an editorial % -of-budget framework).
It has never answered "what is a roster WORTH", and the FAAB board built for this league
had no consumer on this page at all.

⚠️ THE UNIT IS THE POINT. This league's DataDawg$ board is denominated in the league's own
currency: 18 live teams x $1,000 FAAB = $18,000, so the league-average roster is exactly
$1,000 - one team's budget. That makes one number do both jobs the room needs:
  * team strength  - sum a roster and compare it to $1,000
  * bid guidance   - a player's number IS his share of a full budget
It also makes the War Plan card directly checkable rather than decorative: that table says
top-15 talent is worth 30-52% of budget in Weeks 2-4, and this board prices the top player
at ~40%. Two independent routes to the same place is the useful kind of agreement.

⚠️ WHAT THIS CARD MUST NOT CLAIM. Guillotine is won by not being last in ANY week, which
rewards weekly floor. This prices season-total value. It is a roster-strength and bid
comparator and it says so; the Chop Wheel and survival odds remain the tools for who dies.
Do not let this number migrate into the survival maths.

⚠️ Signed-out readers see nothing here, by design: DataDawg$ is private, the Worker requires
a session, and there is no public fallback for an 18-team room (pool.json has no 18-team
column). The card hides itself rather than showing a wrong number.
"""
import pathlib, sys

PAGE = pathlib.Path("guillotine.html")

MARKUP_ANCHOR = """  <div class="hero-card" id="gxPlanCard">"""
MARKUP = """  <div class="hero-card" id="gxDdCard" style="display:none">
    <h2>Roster value &middot; DataDawg$ <span class="samp" id="gxDdState">Private &middot; ungraded</span></h2>
    <p class="legend" style="margin:0 0 12px" id="gxDdLead"></p>
    <div class="statrow" id="gxDdStats"></div>
    <div class="tscroll" style="margin-top:16px"><table class="dtab" id="gxDdTab"></table></div>
    <p class="legend" id="gxDdNote"></p>
  </div>

""" + MARKUP_ANCHOR

JS_ANCHOR = """  /* ------------------------------ Waiver value -----------------------------"""
JS = r"""  /* --------------------------- DataDawg$ roster value ----------------------
     Private, league-specific valuation served by the Worker. Never a static file and
     never public: the Worker answers only for the player keys this page already holds,
     and only to a signed-in caller. A signed-out reader gets no card at all rather than
     a wrong number - there is no PMV fallback for an 18-team room. */
  var elDdCard=document.getElementById("gxDdCard"), elDdStats=document.getElementById("gxDdStats"),
      elDdTab=document.getElementById("gxDdTab"), elDdNote=document.getElementById("gxDdNote"),
      elDdLead=document.getElementById("gxDdLead"), elDdState=document.getElementById("gxDdState");

  function ddKeyOf(name,pos,team){
    var p=String(pos||"").toUpperCase();
    var teamAlias={LAR:"LA",JAC:"JAX",WSH:"WAS",OAK:"LV",SD:"LAC",STL:"LA"};
    if(p==="DST"||p==="DEF"){
      var t=String(team||"").toUpperCase(); return t?"dst:"+(teamAlias[t]||t):null;
    }
    var k=String(name||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase()
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g,"").replace(/[^a-z ]/g,"").replace(/\s+/g," ").trim();
    var nameAlias={"kenneth gainwell":"kenny gainwell","cameron ward":"cam ward"};
    return k?"name:"+(nameAlias[k]||k):null;
  }

  async function renderDd(league, teams, budget){
    if(!elDdCard) return null;
    var tok=(window.DDAuth&&DDAuth.token&&DDAuth.token())||"";
    if(!tok||!teams||!teams.length) return null;

    var names=null;
    try{ var r=await fetch(WV_WORKER+"/sleeper/players-slim");
         if(r.ok){ var j=await r.json(); names=(j&&j.data&&j.data.players)||null; } }catch(e){}
    if(!names) return null;

    /* every key this page holds: rostered players plus anyone the board might price */
    var keyOfPid={}, allKeys={};
    teams.forEach(function(t){ (t.pids||[]).forEach(function(pid){
      var p=names[pid]; if(!p) return;
      var k=ddKeyOf(p[0],p[1],p[2]); if(!k) return;
      keyOfPid[pid]=k; allKeys[k]=1; }); });
    Object.keys(names).forEach(function(pid){
      var p=names[pid]; if(!p) return; var k=ddKeyOf(p[0],p[1],p[2]); if(k) allKeys[k]=1; });
    var keys=Object.keys(allKeys);
    if(!keys.length) return null;

    var vals=null, meta=null;
    try{
      var res=await fetch(WV_WORKER+"/dd/values",{method:"POST",
        headers:{"Content-Type":"application/json","X-Bozo-Session":tok},
        body:JSON.stringify({provider:"sleeper",leagueId:String(league.league_id||league.id||""),keys:keys.slice(0,700)})});
      if(!res.ok) return null;
      var body=await res.json(); vals=body&&body.values; meta=body&&body.dd;
    }catch(e){ return null; }
    if(!vals||!meta) return null;
    var val=function(k){ var v=vals[k]; v=v&&Number(v.v); return Number.isFinite(v)?v:0; };

    var rows=teams.map(function(t){
      var sum=0,n=0;
      (t.pids||[]).forEach(function(pid){ var k=keyOfPid[pid]; if(k&&vals[k]){ sum+=val(k); n++; } });
      return {name:t.name, rid:t.rid, dead:!!t.dead, v:sum, n:n, of:(t.pids||[]).length};
    }).sort(function(a,b){ return b.v-a.v; });

    var live=rows.filter(function(r){ return !r.dead; });
    var avg=live.length?live.reduce(function(a,r){return a+r.v;},0)/live.length:0;
    /* value sitting on nobody's roster: in this format that IS the bid list */
    var held={}; teams.forEach(function(t){ (t.pids||[]).forEach(function(pid){ if(keyOfPid[pid]) held[keyOfPid[pid]]=1; }); });
    var faPool=0, faN=0;
    keys.forEach(function(k){ if(!held[k]){ var v=val(k); if(v>0){ faPool+=v; faN++; } } });

    elDdCard.style.display="";
    elDdState.textContent = "Private · " + (meta.as_of||"undated") + " · ungraded";
    elDdLead.innerHTML = "Denominated in this league&rsquo;s own currency: $"+(budget||1000).toLocaleString()
      + " FAAB a team, so the average roster is one full budget and a player&rsquo;s dollars are his share of one. "
      + "That is what makes it read as both team strength and a bid.";
    elDdStats.innerHTML =
      tile("$"+Math.round(avg).toLocaleString(), "Average live roster")
      + tile("$"+Math.round(rows[0]?rows[0].v:0).toLocaleString(), "Strongest roster")
      + tile("$"+Math.round(faPool).toLocaleString(), "Value unrostered ("+faN+" players)")
      + tile(meta.matched!=null?meta.matched:"—", "Players priced");
    elDdTab.innerHTML = "<thead><tr><th>Team</th><th>DataDawg$</th><th>vs average</th><th>Share of league</th></tr></thead><tbody>"
      + rows.map(function(r){
          var d=Math.round(r.v-avg), tot=rows.reduce(function(a,x){return a+x.v;},0);
          return "<tr><td class='"+(r.dead?"":"")+"'>"+esc(r.name)+(r.dead?" <span class='samp'>chopped</span>":"")
            + "</td><td>$"+Math.round(r.v).toLocaleString()+"</td><td>"+(d>=0?"+":"−")+"$"+Math.abs(d).toLocaleString()
            + "</td><td>"+(tot?(100*r.v/tot).toFixed(1):"—")+"%</td></tr>";
        }).join("") + "</tbody>";
    elDdNote.innerHTML = "⚠️ This prices SEASON-TOTAL value. Guillotine is won by not being last in any single "
      + "week, which rewards weekly floor — so this is a roster-strength and bid comparator, not a survival tool. "
      + "The Chop Wheel and the weekly odds above remain the answer to who dies. DataDawg$ is a private, dated, "
      + "ungraded valuation built for this room; it is not published and not a market price. "
      + "Unrostered value is what the pool is worth right now — it climbs every time a roster hits waivers.";
    return {avg:Math.round(avg), top:rows[0]&&Math.round(rows[0].v), faPool:Math.round(faPool), priced:meta.matched};
  }

""" + JS_ANCHOR

OLD_TEAMS = """      return { rid:r.roster_id, name:nm, owner:u.display_name||"—",
               roster:(r.players||[]).length, scores:[],
               faabUsed:(r.settings && r.settings.waiver_budget_used) || 0 };"""
NEW_TEAMS = """      return { rid:r.roster_id, name:nm, owner:u.display_name||"—",
               roster:(r.players||[]).length, scores:[],
               /* ⚠️ Keep the ids, not just the count: DataDawg$ needs to know WHICH players
                  are on each roster, and this map used to throw that away. */
               pids:(r.players||[]).slice(),
               faabUsed:(r.settings && r.settings.waiver_budget_used) || 0 };"""

OLD_CALL = "    var faab = renderFaab(league, faabBudget, alive, teams.length - alive.length, done);"
NEW_CALL = ("    var faab = renderFaab(league, faabBudget, alive, teams.length - alive.length, done);\n"
            "    var ddRoster = await renderDd(league, teams, faabBudget);   /* null when signed out or no board */")

def once(s, old, new, what):
    if new in s: return s
    n = s.count(old)
    if n != 1: sys.exit(f"{what}: expected 1 anchor, found {n}. Page has drifted.")
    return s.replace(old, new)

def main():
    if not PAGE.exists(): sys.exit("run from the repo root (guillotine.html not found)")
    s = PAGE.read_text(encoding="utf-8")
    if 'id="gxDdCard"' in s and "async function renderDd" in s:
        print("already applied - no change"); return
    s = once(s, MARKUP_ANCHOR, MARKUP, "Money-sheet markup")
    s = once(s, JS_ANCHOR, JS, "renderDd module")
    s = once(s, OLD_TEAMS, NEW_TEAMS, "team objects keep player ids")
    s = once(s, OLD_CALL, NEW_CALL, "render call")
    PAGE.write_text(s, encoding="utf-8", newline="\n")
    print("patched guillotine.html: DataDawg$ roster-value card on The Money")
    print("NEXT: node work/test-guillotine-dd.mjs && cd work && python3 stamp-sw-version.py && node verify-sw.mjs")

if __name__ == "__main__": main()
