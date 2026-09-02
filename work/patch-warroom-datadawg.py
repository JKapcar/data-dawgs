#!/usr/bin/env python3
"""fantasy-warroom.html — DataDawg$ as the valuation basis, PMV as the fallback. Idempotent.

    python3 work/patch-warroom-datadawg.py
    node work/test-datadawg-basis.mjs
    cd work && python3 stamp-sw-version.py && node verify-sw.mjs

Kap's rule: DataDawg$ is the private, league-specific valuation and the source of truth for
grading and team strength. PMV (data/pool.json) is what we can build from free public
sources, and is the fallback where no DataDawg$ board exists.

HOW THE VALUES ARRIVE - two paths, because the two provider families load differently:
  ESPN / Yahoo   the page fetches the league THROUGH the Worker, so values ride along
                 inline on each pool player as `p.dd` (shipped in c3e91d4).
  Sleeper        the page talks to Sleeper directly and never passes through the Worker,
                 so it POSTs the player keys it holds to /dd/values and gets back values
                 for those keys only. Signed-in callers only; no board is ever returned
                 whole. A signed-out reader simply gets PMV.

⚠️ mvOf() IS THE RESOLVER, NOT THE CALL SITES. There are eleven callers - money table,
starter/bench split, surplus, trade finder, the arbitrage pass. Repointing eleven call
sites is eleven chances to miss one and silently leave a surface on the wrong basis.
Resolving inside mvOf() means every surface moves together or none does.

⚠️ NO MIXING INSIDE ONE NUMBER. When a DataDawg$ board is loaded for this league, DD$ is
the basis for the whole page: a player the board prices uses that price (INCLUDING $0,
which is a real statement in a floored board, not a missing value), and a player the board
does not carry at all is UNPRICED - it does not quietly fall back to PMV. A roster total
that is part DataDawg$ and part market value is neither, and nobody could tell by looking.
The unpriced count is surfaced instead.
"""
import pathlib, sys

PAGE = pathlib.Path("fantasy-warroom.html")

ANCHOR_STATE = "let MV=null,DYNASTY_MV=null;"
BLOCK = ANCHOR_STATE + r"""
/* DataDawg$ — private, league-specific, served by the Worker. Never a static file, never
   in the repo. Null until a board is found for the open league; the page then runs on PMV. */
let DD=null;
const DD_WORKER='https://toto.jkapcar4.workers.dev';
/* Mirrors the Worker's ddPlayerKey(). Defenses key by team because they share no id across
   sources; everyone else by the same normalised name PMV already joins on. */
const DD_KEY_TEAM_ALIAS={LAR:'LA',JAC:'JAX',WSH:'WAS',OAK:'LV',SD:'LAC',STL:'LA'};
const DD_KEY_NAME_ALIAS={'kenneth gainwell':'kenny gainwell','cameron ward':'cam ward'};
function ddKey(p){
  if(!p)return null;
  const pos=String(p.pos||'').toUpperCase();
  if(pos==='DST'||pos==='DEF'){
    const t=String(p.team||'').toUpperCase();return t?'dst:'+(DD_KEY_TEAM_ALIAS[t]||t):null;
  }
  const k=mvKey(p.name);return k?'name:'+(DD_KEY_NAME_ALIAS[k]||k):null;
}
/* ESPN and Yahoo arrive with values already attached by the Worker. */
function ddFromFeed(pool){
  const by=new Map();let meta=null;
  (pool||[]).forEach(p=>{if(p&&p.dd&&Number.isFinite(Number(p.dd.v))){const k=ddKey(p);if(k)by.set(k,Number(p.dd.v));}});
  return by.size?{by,meta}:null;
}
/* Sleeper never touches the Worker, so ask for exactly the keys this page holds. */
async function ddFromWorker(provider,leagueId,pool){
  const tok=(window.DDAuth&&DDAuth.token&&DDAuth.token())||'';
  if(!tok)return null;                       /* signed out: PMV, silently and correctly */
  const keys=[...new Set((pool||[]).map(ddKey).filter(Boolean))];
  if(!keys.length)return null;
  try{
    const r=await fetch(DD_WORKER+'/dd/values',{method:'POST',
      headers:{'Content-Type':'application/json','X-Bozo-Session':tok},
      body:JSON.stringify({provider,leagueId:String(leagueId),keys})});
    if(!r.ok)return null;
    const j=await r.json();
    if(!j||!j.values||!j.dd)return null;
    const by=new Map();
    for(const k in j.values){const v=Number(j.values[k]&&j.values[k].v);if(Number.isFinite(v))by.set(k,v);}
    return by.size?{by,meta:j.dd}:null;
  }catch(e){ return null; }
}
async function loadDD(st=state){
  if(!st||!st.ref){if(st===state)DD=null;return null;}
  const prov=st.ref.provider;
  const got=(prov==='espn'||prov==='yahoo')?ddFromFeed(st.pool):await ddFromWorker(prov,st.ref.id,st.pool);
  /* the feed path carries no meta block of its own, so take it off the feed body */
  if(got&&!got.meta&&st.dd)got.meta=st.dd;
  st.ddValues=got;
  if(st===state)DD=got;
  return got;
}
function ddActive(){return !!(DD&&DD.by&&DD.by.size);}
function ddAsOf(){return (DD&&DD.meta&&DD.meta.as_of)||null;}
function ddUnpriced(players){return (players||[]).filter(p=>!DD.by.has(ddKey(p))).length;}"""

OLD_MVOF_TAIL = """  if(!MV||!MV.by.size)return null;
  const row=p.pos==='DST'?MV.by.get('dst:'+String(p.team||'').toUpperCase()):MV.by.get(mvKey(p.name));
  if(!row)return null;
  const v=Number(row[mvColumn()]);
  return Number.isFinite(v)?v:null;"""
NEW_MVOF_TAIL = """  /* ⚠️ DataDawg$ FIRST, and exclusively, when a board is loaded for this league. A player
     the board carries uses that price even when it is $0 - in a floored board $0 means
     "below the last roster spot", which is a real statement, not a missing value. A player
     the board does NOT carry is unpriced rather than quietly priced from PMV: one number
     built from two bases is neither, and it would be invisible on the page. */
  if(ddActive()){
    const k=ddKey(p);
    if(k&&DD.by.has(k))return DD.by.get(k);
    return null;
  }
  if(!MV||!MV.by.size)return null;
  const row=p.pos==='DST'?MV.by.get('dst:'+String(p.team||'').toUpperCase()):MV.by.get(mvKey(p.name));
  if(!row)return null;
  const v=Number(row[mvColumn()]);
  return Number.isFinite(v)?v:null;"""

OLD_LABEL = """function labelFor(h){return h==='dynasty'?'Overall dynasty value':'Public Market Value'}
function asOfFor(h){return (h==='dynasty'?DYNASTY_MV:MV)?.asOf||null}"""
NEW_LABEL = """/* ⚠️ The label must name the basis that actually resolved, with its date. A page showing
   DataDawg$ under a "Public Market Value" heading is the same class of error as showing a
   14-team league 12-team prices: right arithmetic, wrong question, and unfalsifiable from
   the outside. DataDawg$ is ungraded (tier: labs) and the copy says so. */
function labelFor(h){
  if(h!=='dynasty'&&ddActive())return 'DataDawg$';
  return h==='dynasty'?'Overall dynasty value':'PMV (Public Market Value)';
}
function asOfFor(h){
  if(h!=='dynasty'&&ddActive())return ddAsOf();
  return (h==='dynasty'?DYNASTY_MV:MV)?.asOf||null;
}"""

OLD_HOOK = "  await loadMV();if(isDynastyLeague())await loadDynastyMV();"
NEW_HOOK = ("  await loadMV();if(isDynastyLeague())await loadDynastyMV();\n"
            "  await loadDD();   /* DataDawg$ if this league has a board; otherwise PMV stands */")

OLD_ESPN_PLAYER = "    paid:(p.paid==null||!isFinite(p.paid))?null:Number(p.paid),team:p.team}));"
NEW_ESPN_PLAYER = "    paid:(p.paid==null||!isFinite(p.paid))?null:Number(p.paid),team:p.team,dd:p.dd}));"
OLD_ESPN_STATE = "    defaults:null, diagnostics:feed.diagnostics||null};"
NEW_ESPN_STATE = "    defaults:null, diagnostics:feed.diagnostics||null,dd:feed.dd||null};"
OLD_WITH_STATE = "function withState(st,fn){const keep=state;state=st;try{return fn()}finally{state=keep}}"
NEW_WITH_STATE = ("function withState(st,fn){const keep=state,keepDD=DD;state=st;DD=st.ddValues||null;"
                  "try{return fn()}finally{state=keep;DD=keepDD}}")
OLD_LOAD_ALL = "    try{const st=await fetchLeague(x.leagueId);LOADED.set(keyOf('sleeper',x.leagueId),{state:st,sim:null})}"
NEW_LOAD_ALL = ("    try{const st=await fetchLeague(x.leagueId);await loadDD(st);"
                "LOADED.set(keyOf('sleeper',x.leagueId),{state:st,sim:null})}")
OLD_RESTORE = "  state=entry.state;sim=entry.sim||null;tradeFilter=null;"
NEW_RESTORE = "  state=entry.state;DD=state.ddValues||null;sim=entry.sim||null;tradeFilter=null;"

def once(s, old, new, what):
    if new in s: return s, False
    n = s.count(old)
    if n < 1: sys.exit(f"{what}: anchor not found. Page has drifted; re-read before patching.")
    return s.replace(old, new), True

def main():
    if not PAGE.exists(): sys.exit("run from the repo root")
    s = PAGE.read_text(encoding="utf-8")
    changed = False
    n = 0
    if not ("let DD=null;" in s and "if(ddActive()){" in s):
        if s.count(ANCHOR_STATE) != 1: sys.exit("MV state declaration not unique")
        s = s.replace(ANCHOR_STATE, BLOCK)
        s, _ = once(s, OLD_MVOF_TAIL, NEW_MVOF_TAIL, "mvOf resolver")
        s, _ = once(s, OLD_LABEL, NEW_LABEL, "basis labels")
        n = s.count(OLD_HOOK)
        if n != 2: sys.exit(f"expected 2 league-load hooks, found {n}")
        s = s.replace(OLD_HOOK, NEW_HOOK)
        changed = True
    s, c = once(s, OLD_ESPN_PLAYER, NEW_ESPN_PLAYER, "ESPN inline player values")
    changed = changed or c
    s, c = once(s, OLD_ESPN_STATE, NEW_ESPN_STATE, "ESPN inline valuation metadata")
    changed = changed or c
    s, c = once(s, OLD_WITH_STATE, NEW_WITH_STATE, "portfolio valuation state")
    changed = changed or c
    s, c = once(s, OLD_LOAD_ALL, NEW_LOAD_ALL, "portfolio DataDawg$ load")
    changed = changed or c
    s, c = once(s, OLD_RESTORE, NEW_RESTORE, "restored league valuation state")
    changed = changed or c
    if not changed:
        print("already applied - no change"); return
    PAGE.write_text(s, encoding="utf-8", newline="\n")
    print(f"patched: DD$ loader, mvOf resolver, basis labels, {n or 2} load hooks, ESPN feed values")
    print("NEXT: node work/test-datadawg-basis.mjs && cd work && python3 stamp-sw-version.py && node verify-sw.mjs")

if __name__ == "__main__": main()
