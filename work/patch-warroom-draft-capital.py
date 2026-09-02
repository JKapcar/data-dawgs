#!/usr/bin/env python3
"""fantasy-warroom.html — draft capital for dynasty leagues.  Idempotent.

    python3 work/patch-warroom-draft-capital.py
    node work/test-draft-capital.mjs
    cd work && python3 stamp-sw-version.py && node verify-sw.mjs

Requires Commit 5 (per-horizon boards). No Worker change: `/dd/values` already returns a
`picks` array — the page simply never asked for it.

⚠️ IN A DYNASTY LEAGUE A ROSTER IS NOT A TEAM. Future picks are tradeable assets and they
move constantly: Hey Bing Bong alone has 86 traded picks on the books across 2026-2029. A
"team strength" number built only from rostered players tells a team that traded four firsts
for win-now help that it is identical to the team that hoarded them. Every value surface on
the Money tab was doing exactly that.

⚠️ CAPITAL IS SHOWN BESIDE ROSTER VALUE, NEVER FOLDED INTO IT. A team can be mid-table on
roster and first on capital — that gap IS the information. Summing them into one number
destroys the only thing worth reading.

OWNERSHIP, which Sleeper does not hand over directly:
  default   every roster owns its own pick in every season and round
  then      /league/<id>/traded_picks reassigns: {season, round, roster_id (originating),
            owner_id (holder now)}
So capital = own picks, minus those traded away, plus those acquired. The originating roster
matters for provenance but NOT for value here — the source prices picks by ROUND, not by
slot, so a 1st is a 1st whoever it came from. That is a real limitation, stated on the card:
a rebuilding team's 1st is worth more than a contender's and this cannot see the difference.

⚠️ UNPRICED IS NOT ZERO. The source covers 2027-2028, rounds 1-4. These leagues draft 5
rounds and Bing Bong already trades 2029 picks. A pick outside that range is UNPRICED and
counted separately — valuing it at $0 would read as "worthless" when it means "not covered".
"""
import pathlib, sys

PAGE = pathlib.Path("fantasy-warroom.html")
BASIS_TEST = pathlib.Path("work/test-datadawg-basis.mjs")

OLD_BASIS_ASSERT = 'ok("portfolio calculations swap DataDawg$ with state", /keepDD=DD;state=st;DD=st\\.ddValues\\|\\|null/.test(src));'
NEW_BASIS_ASSERT = 'ok("portfolio calculations swap DataDawg$ with state", /keepDD=DD,keepPicks=DDPICKS;state=st;DD=st\\.ddValues\\|\\|null;DDPICKS=st\\.ddPicks\\|\\|null/.test(src));'

OLD_WORKER_RET = """    const by=new Map();
    for(const k in j.values){const v=Number(j.values[k]&&j.values[k].v);if(Number.isFinite(v))by.set(k,v);}
    return by.size?{by,meta:j.dd}:null;"""
NEW_WORKER_RET = """    const by=new Map();
    for(const k in j.values){const v=Number(j.values[k]&&j.values[k].v);if(Number.isFinite(v))by.set(k,v);}
    /* the Worker has always returned these; the page just never took them */
    const picks=Array.isArray(j.picks)?j.picks:[];
    return by.size?{by,meta:j.dd,picks}:null;"""

OLD_HELPERS_TAIL = """function ddUnpriced(players,h){const b=ddBoard(h);
  return b?(players||[]).filter(p=>!b.by.has(ddKey(p))).length:0;}"""
NEW_HELPERS_TAIL = OLD_HELPERS_TAIL + """
/* ---- draft capital -------------------------------------------------------
   Dynasty only, Sleeper only (no other provider exposes pick ownership). Sleeper gives
   just the TRADES, so ownership is: every roster owns its own picks, then traded_picks
   reassigns. Priced by ROUND from the board, because that is how the source prices them. */
let DDPICKS=null;
async function loadDraftCapital(st=state){
  if(st===state)DDPICKS=null;
  const b=(st&&st.ddValues&&st.ddValues.dynasty)||(st===state?ddBoard('dynasty'):null);
  if(!st||!st.ref||st.ref.provider!=='sleeper'||!b||!Array.isArray(b.picks)||!b.picks.length){
    if(st)st.ddPicks=null;return null;
  }
  let traded=[];
  try{
    const r=await fetch(API+'/league/'+encodeURIComponent(st.ref.id)+'/traded_picks',{cache:'no-store'});
    if(!r.ok)return null;
    traded=await r.json(); if(!Array.isArray(traded))return null;
  }catch(e){ return null; }
  const price=new Map(), pricedSeasons=new Set(), pricedRounds=new Set();
  b.picks.forEach(p=>{const s=Number(p.season),rd=Number(p.round);
    if(!Number.isFinite(s)||!Number.isFinite(rd))return;
    const v=Number(p.v);if(!Number.isFinite(v))return;
    price.set(s+':'+rd,v); pricedSeasons.add(s); pricedRounds.add(rd);});
  /* Ownership has to include UNPRICED picks too. Use every priced future season plus any
     later season Sleeper says has traded picks; otherwise 2029 assets vanish. Rounds come
     from the league setting, not the board's coverage, so round 5 remains visible. */
  const thisSeason=Number(st.league&&st.league.season)||new Date().getFullYear();
  const tradedSeasons=traded.map(t=>Number(t.season)).filter(s=>Number.isFinite(s)&&s>thisSeason);
  const futures=[...new Set([...pricedSeasons,...tradedSeasons])].filter(s=>s>thisSeason).sort();
  const maxPriced=Math.max(0,...pricedRounds);
  const leagueRounds=Number(st.league&&st.league.settings&&st.league.settings.draft_rounds)||maxPriced;
  const roundList=Array.from({length:Math.max(leagueRounds,maxPriced)},(_,i)=>i+1);
  const ids=st.teams.map(t=>String(t.id));
  const own=new Map(ids.map(id=>[id,[]]));
  futures.forEach(s=>roundList.forEach(rd=>ids.forEach(id=>own.get(id).push({s,rd,from:id}))));
  /* apply trades: remove from the originating roster's holder, give to the new owner */
  traded.forEach(t=>{
    const s=Number(t.season),rd=Number(t.round),from=String(t.roster_id),to=String(t.owner_id);
    if(!futures.includes(s)||!roundList.includes(rd))return;
    for(const [id,list] of own){
      const i=list.findIndex(x=>x.s===s&&x.rd===rd&&x.from===from);
      if(i>=0){list.splice(i,1);break;}
    }
    if(own.has(to))own.get(to).push({s,rd,from});
  });
  /* Count OWNED unpriced assets after reassignment—not trade rows. One 2029 trade proves
     that season exists for every roster; all of those picks must remain visible. */
  let unpriced=0;
  const byTeam=new Map();
  for(const [id,list] of own){
    let v=0,missing=0; list.forEach(p=>{const k=p.s+':'+p.rd;
      if(price.has(k))v+=price.get(k);else{missing++;unpriced++;}});
    byTeam.set(id,{v,n:list.length,unpriced:missing,list});
  }
  const got={byTeam,seasons:futures,rounds:roundList,unpricedPicks:unpriced,
             asOf:(b.meta&&b.meta.as_of)||null};
  st.ddPicks=got;
  if(st===state)DDPICKS=got;
  return got;
}
function ddCapital(teamId){const c=DDPICKS&&DDPICKS.byTeam.get(String(teamId));return c?c.v:null;}"""

OLD_HOOK = "  await loadDD();   /* DataDawg$ if this league has a board; otherwise PMV stands */"
NEW_HOOK = ("  await loadDD();   /* DataDawg$ if this league has a board; otherwise PMV stands */\n"
            "  await loadDraftCapital();   /* dynasty only; picks are assets, not roster value */")

OLD_MARKUP = """      <article class="wr-card wr-full">
        <h3>Where the money is</h3>"""
NEW_MARKUP = """      <article class="wr-card wr-full wr-hide" id="mnCapCard">
        <h3>Draft capital <span class="wr-note" style="font-weight:400">Dynasty · beside roster value, not added to it</span></h3>
        <p class="wr-note" id="mnCapLead"></p>
        <div id="mnCapTab"></div>
        <p class="wr-note" id="mnCapNote"></p>
      </article>

""" + OLD_MARKUP

OLD_RENDER = """function renderMoney(){
  if(!state)return;"""
NEW_RENDER = """function paintDraftCapital(){
  const card=$('mnCapCard'); if(!card)return;
  if(!DDPICKS||!DDPICKS.byTeam||!DDPICKS.byTeam.size){card.classList.add('wr-hide');return;}
  card.classList.remove('wr-hide');
  const rows=state.teams.map(t=>({name:t.name,id:String(t.id),
      cap:ddCapital(t.id)||0,n:(DDPICKS.byTeam.get(String(t.id))||{}).n||0,
      unpriced:(DDPICKS.byTeam.get(String(t.id))||{}).unpriced||0}))
    .sort((a,b)=>b.cap-a.cap);
  const tot=rows.reduce((a,r)=>a+r.cap,0), avg=rows.length?tot/rows.length:0;
  const me=mnMe();
  $('mnCapLead').textContent='Future picks each team holds, priced by round. '
    +'Seasons '+DDPICKS.seasons.join(' and ')+', rounds '+DDPICKS.rounds.join('–')
    +'. League average '+fmt$(Math.round(avg))+'.';
  $('mnCapTab').innerHTML='<table class="wr-tab"><thead><tr><th>Team</th><th>Picks</th>'
    +'<th>Draft capital</th><th>vs average</th></tr></thead><tbody>'
    +rows.map(r=>'<tr'+(me&&r.name===me.name?' class="wr-me"':'')+'><td>'+esc(r.name)+'</td><td>'+r.n
      +(r.unpriced?' · '+r.unpriced+' unpriced':'')
      +'</td><td>'+fmt$(r.cap)+'</td><td>'+(r.cap-avg>=0?'+':'−')+fmt$(Math.abs(Math.round(r.cap-avg)))
      +'</td></tr>').join('')+'</tbody></table>';
  $('mnCapNote').innerHTML='⚠️ Priced by ROUND, not by slot — a rebuilding team\\u2019s first is worth more '
    +'than a contender\\u2019s and this cannot tell them apart. Deliberately NOT added to roster value: a team '
    +'can be mid-table on roster and first on capital, and that gap is the point. '
    +(DDPICKS.unpricedPicks?DDPICKS.unpricedPicks+' owned picks fall outside the priced seasons or rounds and are '
      +'counted, not valued — unpriced is not the same as worthless. ':'')
    +'DataDawg$ dynasty board, '+(DDPICKS.asOf||'undated')+', ungraded.';
}

function renderMoney(){
  if(!state)return;
  paintDraftCapital();"""

OLD_WITH_STATE = "function withState(st,fn){const keep=state,keepDD=DD;state=st;DD=st.ddValues||null;try{return fn()}finally{state=keep;DD=keepDD}}"
NEW_WITH_STATE = ("function withState(st,fn){const keep=state,keepDD=DD,keepPicks=DDPICKS;"
                  "state=st;DD=st.ddValues||null;DDPICKS=st.ddPicks||null;"
                  "try{return fn()}finally{state=keep;DD=keepDD;DDPICKS=keepPicks}}")
OLD_LOAD_ALL = "try{const st=await fetchLeague(x.leagueId);await loadDD(st);LOADED.set(keyOf('sleeper',x.leagueId),{state:st,sim:null})}"
NEW_LOAD_ALL = "try{const st=await fetchLeague(x.leagueId);await loadDD(st);await loadDraftCapital(st);LOADED.set(keyOf('sleeper',x.leagueId),{state:st,sim:null})}"
OLD_RESTORE = "state=entry.state;DD=state.ddValues||null;sim=entry.sim||null;tradeFilter=null;"
NEW_RESTORE = "state=entry.state;DD=state.ddValues||null;DDPICKS=state.ddPicks||null;sim=entry.sim||null;tradeFilter=null;"

# (old, new, description, expected occurrences) — the league-load hook exists TWICE
# because the page has two entry paths, and both must load capital or one of them shows a
# dynasty league with no picks and no explanation.
STEPS = [
    (OLD_WORKER_RET, NEW_WORKER_RET, "ddFromWorker keeps picks", 1),
    (OLD_HELPERS_TAIL, NEW_HELPERS_TAIL, "loadDraftCapital", 1),
    (OLD_HOOK, NEW_HOOK, "load hooks", 2),
    (OLD_MARKUP, NEW_MARKUP, "capital card markup", 1),
    (OLD_RENDER, NEW_RENDER, "paintDraftCapital", 1),
    (OLD_WITH_STATE, NEW_WITH_STATE, "draft-capital state isolation", 1),
    (OLD_LOAD_ALL, NEW_LOAD_ALL, "portfolio draft-capital load", 1),
    (OLD_RESTORE, NEW_RESTORE, "restore draft capital", 1),
]

def main():
    if not PAGE.exists(): sys.exit("run from the repo root")
    s = PAGE.read_text(encoding="utf-8")
    if "async function loadDraftCapital" in s:
        print("page already applied - no change")
    else:
        for old, new, what, want in STEPS:
            n = s.count(old)
            if n != want: sys.exit(f"{what}: expected {want} occurrence(s), found {n}. Page has drifted.")
            s = s.replace(old, new)
        PAGE.write_text(s, encoding="utf-8", newline="\n")
        print("patched: draft capital for dynasty leagues (owned picks, priced by round, shown beside roster value)")

    if not BASIS_TEST.exists(): sys.exit("missing work/test-datadawg-basis.mjs")
    t = BASIS_TEST.read_text(encoding="utf-8")
    if NEW_BASIS_ASSERT in t:
        print("basis test already updated - no change")
    elif t.count(OLD_BASIS_ASSERT) == 1:
        BASIS_TEST.write_text(t.replace(OLD_BASIS_ASSERT, NEW_BASIS_ASSERT), encoding="utf-8", newline="\n")
        print("updated: portfolio state-isolation assertion includes draft capital")
    else:
        sys.exit("basis test contract: expected one old assertion; test has drifted")
    print("NEXT: node work/test-draft-capital.mjs && cd work && python3 stamp-sw-version.py && node verify-sw.mjs")

if __name__ == "__main__": main()
