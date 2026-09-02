#!/usr/bin/env python3
"""Cap /dd/values requests, with the target league's roster first. Idempotent."""
import pathlib, sys

PAGE = pathlib.Path("fantasy-warroom.html")
HORIZON_TEST = pathlib.Path("work/test-dd-horizon.mjs")

OLD_HORIZON_ASSERT = 'ok("dynasty board is requested for dynasty leagues", /ddFromWorker\\(prov,st\\.ref\\.id,st\\.pool,\'dynasty\'\\)/.test(src));'
NEW_HORIZON_ASSERT = 'ok("dynasty board is requested with the target league\'s teams", /ddFromWorker\\(prov,st\\.ref\\.id,st\\.pool,\'dynasty\',st\\.teams\\)/.test(src));'

OLD_SIG = "async function ddFromWorker(provider,leagueId,pool,horizon){"
NEW_SIG = "async function ddFromWorker(provider,leagueId,pool,horizon,teams){"

OLD_KEYS = """  const keys=[...new Set((pool||[]).map(ddKey).filter(Boolean))];
  if(!keys.length)return null;"""
NEW_KEYS = """  /* ⚠️ CAP, AND PRIORITISE. A Sleeper pool is the whole NFL (~3,200), the Worker accepts 700,
     and it answers 413 — which ddFromWorker turns into a silent PMV fallback. That is how
     every Sleeper league ran on PMV while ESPN worked: ESPN's pool is ~500 and fits.
     Rostered players from the TARGET league go first because they are what the money and
     trade surfaces price; the rest of the pool fills the remaining budget by projection. */
  const DD_MAX_KEYS=700;
  const rostered=new Set();
  (teams||[]).forEach(t=>(t.players||[]).forEach(p=>{const k=ddKey(p);if(k)rostered.add(k);}));
  const rest=[...(pool||[])].filter(p=>{const k=ddKey(p);return k&&!rostered.has(k);})
    .sort((a,b)=>(Number(b&&b.p)||0)-(Number(a&&a.p)||0));
  const keys=[...rostered];
  for(const p of rest){ if(keys.length>=DD_MAX_KEYS)break; const k=ddKey(p); if(k&&!keys.includes(k))keys.push(k); }
  if(!keys.length)return null;
  if(keys.length>DD_MAX_KEYS)keys.length=DD_MAX_KEYS;"""

OLD_FAIL = """      body:JSON.stringify({provider,leagueId:String(leagueId),keys,horizon:horizon==='dynasty'?'dynasty':'season'})});
    if(!r.ok)return null;"""
NEW_FAIL = """      body:JSON.stringify({provider,leagueId:String(leagueId),keys,horizon:horizon==='dynasty'?'dynasty':'season'})});
    /* A refusal used to look exactly like a league with no board. Keep the fallback, but
       leave an actionable diagnostic instead of swallowing the reason. */
    if(!r.ok){ try{ console.warn('[DataDawg$] /dd/values '+r.status+' for '+provider+':'+leagueId
      +' ('+keys.length+' keys, '+(horizon||'season')+') — falling back to PMV'); }catch(e){} return null; }"""

OLD_CALLS = """  const dyn=wantDyn?await ddFromWorker(prov,st.ref.id,st.pool,'dynasty'):null;
  const got=feed?ddFromFeed(st.pool):await ddFromWorker(prov,st.ref.id,st.pool,'season');"""
NEW_CALLS = """  const dyn=wantDyn?await ddFromWorker(prov,st.ref.id,st.pool,'dynasty',st.teams):null;
  const got=feed?ddFromFeed(st.pool):await ddFromWorker(prov,st.ref.id,st.pool,'season',st.teams);"""

STEPS = [
    (OLD_SIG, NEW_SIG, "target-team parameter"),
    (OLD_KEYS, NEW_KEYS, "rostered-first key cap"),
    (OLD_FAIL, NEW_FAIL, "loud refusal"),
    (OLD_CALLS, NEW_CALLS, "target league call sites"),
]

def main():
    if not PAGE.exists(): sys.exit("run from the repo root")
    s = PAGE.read_text(encoding="utf-8")
    if "const DD_MAX_KEYS=700;" in s:
        print("page already applied - no change")
    else:
        for old, new, what in STEPS:
            n = s.count(old)
            if n != 1: sys.exit(f"{what}: expected 1 occurrence, found {n}. Page has drifted.")
            s = s.replace(old, new)
        PAGE.write_text(s, encoding="utf-8", newline="\n")
        print("patched: target roster first, capped at Worker limit; refusals logged")

    if not HORIZON_TEST.exists(): sys.exit("missing work/test-dd-horizon.mjs")
    t = HORIZON_TEST.read_text(encoding="utf-8")
    if NEW_HORIZON_ASSERT in t:
        print("horizon test already updated - no change")
    elif t.count(OLD_HORIZON_ASSERT) == 1:
        HORIZON_TEST.write_text(t.replace(OLD_HORIZON_ASSERT, NEW_HORIZON_ASSERT), encoding="utf-8", newline="\n")
        print("updated: dynasty request assertion includes target league teams")
    else:
        sys.exit("horizon test contract: expected one old assertion; test has drifted")

if __name__ == "__main__": main()
