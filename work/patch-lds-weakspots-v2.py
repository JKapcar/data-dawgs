"""
Weak Spots V2: injury, bye, positional depth and player concentration.

V1 measures OBSERVED team-score volatility and an observed low-week floor, so the sheet is
dark until two completed weeks exist -- i.e. dark right through the preseason, which is
exactly when someone wants to know where a roster is thin. The four V2 components are all
ROSTER-derived, so they work today and keep working all season alongside V1.

Data already on hand, no new dependency:
  injury  -- Sleeper's season projections carry player.injury_status
  bye     -- derived from the repo's own /data/nfl-schedule.json (272 games, 18 weeks):
             a team's bye is the week it does not appear
  depth   -- drop-off from each starter to his best same-slot replacement
  conc    -- how much of the projected lineup sits in the top two players

The projections fetch used to run ONLY in projection mode. V2 needs it in both, so it sits
behind a promise cache and is requested once per load either way. Without that, Weak Spots
V2 would have gone dark the moment the season started -- backwards.

Every component is a share in 0..1 where HIGHER MEANS MORE FRAGILE, and each gets its own
column so a reader can see which one drives the flag. They describe a roster's shape. They
are not predictions.

    cd work && py patch-lds-weakspots-v2.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "guillotine.html"
s = PAGE.read_text(encoding="utf-8")

# ---- 1. share the projections fetch ----------------------------------------
old = (
'    var r = await fetch("https://api.sleeper.app/projections/nfl/"+league.season' + NL +
'      +"?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE");' + NL +
'    if(!r.ok) throw new Error("projections http "+r.status);' + NL +
'    var rows = await r.json();'
)
assert s.count(old) == 1, "projection fetch anchor"
s = s.replace(old, "    var rows = await projRows(league.season);", 1)

# ---- 2. the shared fetch + the V2 engine, above projectTeams ---------------
anchor = "  async function projectTeams(league, rosters, aliveTeams){"
assert s.count(anchor) == 1, "projectTeams anchor"

engine = r'''  /* One projections request per page load, shared by projection mode and Weak Spots.
     A promise, not a result, so two callers racing still make one request. */
  var PROJ_P = null;
  function projRows(season){
    if(!PROJ_P) PROJ_P = fetch("https://api.sleeper.app/projections/nfl/"+season
        +"?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE")
      .then(function(r){ if(!r.ok) throw new Error("projections http "+r.status); return r.json(); });
    return PROJ_P;
  }

  /* Byes come from the site's own canonical schedule, not from Sleeper: a team's bye is
     the week it does not appear across 272 games. Abbreviations differ between the two
     sources in a few places, so they are aliased rather than silently missed. */
  var BYE_P = null, TEAM_ALIAS = {LA:"LAR", STL:"LAR", WSH:"WAS", JAC:"JAX", OAK:"LV", SD:"LAC"};
  function ab(t){ t=String(t||"").toUpperCase(); return TEAM_ALIAS[t]||t; }
  function byeWeeks(){
    if(!BYE_P) BYE_P = fetch("/data/nfl-schedule.json", {cache:"no-cache"})
      .then(function(r){ return r.json(); })
      .then(function(j){
        var games=(j&&j.data&&j.data.games)||[], seen={}, weeks={};
        games.forEach(function(g){
          if(String(g.season_type||"REG")!=="REG") return;
          weeks[g.week]=1;
          [g.away_team,g.home_team].forEach(function(t){ (seen[ab(t)]=seen[ab(t)]||{})[g.week]=1; });
        });
        var all=Object.keys(weeks).map(Number).sort(function(a,b){return a-b;}), bye={};
        Object.keys(seen).forEach(function(t){
          for(var i=0;i<all.length;i++) if(!seen[t][all[i]]){ bye[t]=all[i]; break; }
        });
        return bye;
      }).catch(function(){
        /* ⚠ Do NOT keep a failed lookup. Caching the rejection would mean one network
           blip silently pins every bye risk at 0% for the rest of the session, with no
           retry and nothing on screen saying the number is missing rather than zero. */
        BYE_P = null; return {};
      });
    return BYE_P;
  }

  /* Severity, not a binary. A Questionable starter is not an absent one, and treating him
     as absent would make every roster in September look broken. */
  var INJ_W = {OUT:1, IR:1, PUP:1, NA:1, SUS:1, DOUBTFUL:.75, QUESTIONABLE:.4, PROBABLE:.15};
  function injW(x){ return INJ_W[String(x||"").toUpperCase()] || 0; }

  /* Fills the league's own starting slots greedily, then reports what the lineup is made
     of. Returns null when a roster has no projectable players at all -- a zero there would
     read as "perfectly sturdy", which is the opposite of what it means. */
  function lineupShape(players, slots){
    var pool=players.slice().sort(function(a,b){ return b.pg-a.pg; }), used={}, start=[], bench=[];
    function take(ok, n){
      for(var i=0;i<n;i++){
        var pick=-1;
        for(var j=0;j<pool.length;j++) if(!used[j] && ok(pool[j].pos)){ pick=j; break; }
        if(pick<0) continue;
        used[pick]=1; start.push(pool[pick]);
      }
    }
    take(function(p){return p==="QB";}, slots.QB||0);
    take(function(p){return p==="RB";}, slots.RB||0);
    take(function(p){return p==="WR";}, slots.WR||0);
    take(function(p){return p==="TE";}, slots.TE||0);
    take(function(p){return p==="RB"||p==="WR"||p==="TE";}, slots.FLEX||0);
    take(function(p){return p==="QB"||p==="RB"||p==="WR"||p==="TE";}, slots.SFLX||0);
    for(var j2=0;j2<pool.length;j2++) if(!used[j2]) bench.push(pool[j2]);
    if(!start.length) return null;
    return {start:start, bench:bench, total:start.reduce(function(a,p){return a+p.pg;},0)};
  }

  async function weakSpots(league, rosters, teamList, done){
    var rows, bye;
    try{ rows = await projRows(league.season); bye = await byeWeeks(); }
    catch(e){ return null; }
    var rec=(league.scoring_settings && typeof league.scoring_settings.rec==="number")?league.scoring_settings.rec:0.5;
    var key = rec>=1 ? "pts_ppr" : rec>0 ? "pts_half_ppr" : "pts_std";
    var P={};
    (rows||[]).forEach(function(row){
      var st=row&&row.stats; if(!st||typeof st[key]!=="number")return;
      var g=(typeof st.gp==="number"&&st.gp>0)?st.gp:17;
      P[row.player_id]={pg:st[key]/g, pos:(row.player&&row.player.position)||"",
                        inj:(row.player&&row.player.injury_status)||"", tm:ab(row.player&&row.player.team)};
    });
    var slots=lineupSlots(league.roster_positions);
    var byR={}; (rosters||[]).forEach(function(r){ byR[r.roster_id]=r.players||[]; });
    /* Four weeks, not one: a bye you can see coming is the one worth planning for, and in
       this format one bad week ends you. */
    var wk=Math.max(1, Number(done||0)+1), horizon=[wk,wk+1,wk+2,wk+3];
    var out={};
    (teamList||[]).forEach(function(t){
      var ps=(byR[t.rid]||[]).map(function(id){ return P[id]; })
                             .filter(function(p){ return p && p.pg>0; });
      var sh=ps.length?lineupShape(ps, slots):null;
      if(!sh || !sh.total){ out[t.rid]=null; return; }
      var tot=sh.total;
      var inj=sh.start.reduce(function(a,p){ return a+p.pg*injW(p.inj); },0)/tot;
      var worst=0, worstWk=null;
      horizon.forEach(function(w){
        var share=sh.start.reduce(function(a,p){ return a+(bye[p.tm]===w?p.pg:0); },0)/tot;
        if(share>worst){ worst=share; worstWk=w; }
      });
      /* Depth is the drop to the best SAME-SLOT replacement. No replacement at all is the
         maximum drop, not a skipped row -- an empty bench IS the fragility. */
      var dsum=0;
      sh.start.forEach(function(p){
        var rep=0;
        sh.bench.forEach(function(b){ if(b.pos===p.pos && b.pg>rep) rep=b.pg; });
        dsum += p.pg * (p.pg>0 ? Math.max(0,(p.pg-rep)/p.pg) : 0);
      });
      var depth=dsum/tot;
      var top2=sh.start.slice().sort(function(a,b){return b.pg-a.pg;}).slice(0,2)
                 .reduce(function(a,p){return a+p.pg;},0)/tot;
      /* Normalised against an evenly-shared lineup, so "concentrated" means concentrated
         relative to this league's own slot count rather than to an arbitrary constant. */
      var floor=Math.min(1, 2/Math.max(1,sh.start.length));
      var conc=Math.max(0,(top2-floor)/Math.max(1e-6,1-floor));
      var score=inj*.30 + worst*.25 + depth*.25 + conc*.20;
      out[t.rid]={inj:inj, bye:worst, byeWk:worstWk, depth:depth, conc:conc, score:score,
                  n:sh.start.length,
                  flag: score>=.55?"Brittle" : score>=.38?"Exposed" : "Sturdy"};
    });
    return out;
  }

'''
s = s.replace(anchor, engine + anchor, 1)

# ---- 3. compute in BOTH modes ----------------------------------------------
old = '    var MODE = "observed";'
new = ("    /* Runs in BOTH modes on purpose -- see the note on projRows. */" + NL +
       "    var WS = null;" + NL +
       "    try{ WS = await weakSpots(league, rosters, alive, done); }catch(e){ WS = null; }" + NL +
       NL + old)
assert s.count(old) == 1, "MODE anchor"
s = s.replace(old, new, 1)

old = '      done: done, mode: MODE, chop: res.chop, chopLo: res.chopLo, chopHi: res.chopHi,'
new = '      done: done, mode: MODE, ws: WS, chop: res.chop, chopLo: res.chopLo, chopHi: res.chopHi,'
assert s.count(old) == 1, "stash anchor"
s = s.replace(old, new, 1)

PAGE.write_text(s, encoding="utf-8", newline=NL)
print("patch-lds-weakspots-v2 (engine): ok")
