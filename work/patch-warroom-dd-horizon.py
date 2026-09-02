#!/usr/bin/env python3
"""fantasy-warroom.html — DataDawg$ per horizon, and an honest basis qualifier. Idempotent.

    python3 work/patch-warroom-dd-horizon.py
    node work/test-dd-horizon.mjs
    node work/test-datadawg-basis.mjs && node work/test-pmv-column.mjs
    cd work && python3 stamp-sw-version.py && node verify-sw.mjs

⚠️ SUPERSEDES the separate "Commit 5 / basis label" patch — that fix is folded in here,
because both changes rewrite the same four functions and splitting them would conflict.

=== 1. THE STRUCTURAL BUG: dynasty leagues can never reach their own board ===

mvOf() is ordered:

    if(dynasty){ ...DYNASTY_MV... return }      <-- returns here, always
    if(ddActive()){ ...DataDawg$... }           <-- unreachable when horizon is dynasty

So a dynasty league is priced off data/dynasty-ranks.json (public, generic) while its own
DataDawg$ board sits unread in KV. That is not a cosmetic problem: the trade finder, the
positional radars and the surplus columns are all VALUE surfaces. Feeding them generic
public market value in a room that has a purpose-built board makes their output confidently
wrong rather than merely coarse — a trade the finder calls even can be lopsided on the board
that actually governs the league.

Fix: DD becomes one board PER HORIZON, and mvOf() checks the board for the horizon it was
ASKED for, before any PMV path. Kayfabe, Hey Bing Bong and Jomo are dynasty leagues
(Sleeper type 2) and the War Room defaults every module to the dynasty horizon for them, so
today they get none of this.

=== 2. THE CRASH, folded in from the superseded patch ===

The caveat built ' (' + mvColumn().toUpperCase() + ')'. Commit 1 made mvColumn() return NULL
for a room with no exact published PMV column, so the 18-team guillotine league — the very
room that abstention protects — throws a TypeError while painting the caveat explaining it.

=== 3. THE MISLEADING LABEL, also folded in ===

That qualifier is a PMV concept: pool.json ships one column per league shape, so "(SFHALF12)"
names WHICH public column was read. A DataDawg$ board is built for one room; there is no
column to cite, and printing one implies a source that was not used. Live today the page
reads "Prices are DataDawg$ (SFHALF12)".
"""
import pathlib, sys

PAGE = pathlib.Path("fantasy-warroom.html")

OLD_STATE = "let DD=null;"
NEW_STATE = """/* ⚠️ ONE BOARD PER HORIZON, not one board. A dynasty league has a season board AND a
   dynasty board and the War Room can show either per module, so a single global would
   answer the wrong question for whichever module it was not loaded for. */
let DD={season:null,dynasty:null};"""

OLD_HELPERS = """function ddActive(){return !!(DD&&DD.by&&DD.by.size);}
function ddAsOf(){return (DD&&DD.meta&&DD.meta.as_of)||null;}
function ddUnpriced(players){return (players||[]).filter(p=>!DD.by.has(ddKey(p))).length;}"""
NEW_HELPERS = """function ddBoard(h){return (DD&&DD[h==='dynasty'?'dynasty':'season'])||null;}
function ddActive(h){const b=ddBoard(h);return !!(b&&b.by&&b.by.size);}
function ddAsOf(h){const b=ddBoard(h);return (b&&b.meta&&b.meta.as_of)||null;}
function ddUnpriced(players,h){const b=ddBoard(h);
  return b?(players||[]).filter(p=>!b.by.has(ddKey(p))).length:0;}"""

OLD_WORKER_SIG = """async function ddFromWorker(provider,leagueId,pool){"""
NEW_WORKER_SIG = """async function ddFromWorker(provider,leagueId,pool,horizon){"""
OLD_WORKER_BODY = """      body:JSON.stringify({provider,leagueId:String(leagueId),keys})});"""
NEW_WORKER_BODY = """      body:JSON.stringify({provider,leagueId:String(leagueId),keys,horizon:horizon==='dynasty'?'dynasty':'season'})});"""

OLD_LOAD = """async function loadDD(st=state){
  if(!st||!st.ref){if(st===state)DD=null;return null;}
  const prov=st.ref.provider;
  const got=(prov==='espn'||prov==='yahoo')?ddFromFeed(st.pool):await ddFromWorker(prov,st.ref.id,st.pool);"""
NEW_LOAD = """async function loadDD(st=state){
  if(!st||!st.ref){if(st===state)DD={season:null,dynasty:null};return null;}
  const prov=st.ref.provider;
  const feed=(prov==='espn'||prov==='yahoo');
  /* ⚠️ A dynasty league needs BOTH boards: the horizon is per module, so a manager can be
     looking at season money and dynasty trades in the same session. The feed path carries
     only the season board — ESPN and Yahoo dynasty rooms would need the Worker path too,
     and neither exists today, so that stays a lookup rather than an assumption. */
  /* Use the state being loaded, not global `state`: portfolio loading resolves saved
     leagues off-screen, and the active league may have a different type. */
  const wantDyn=Number(st&&st.league&&st.league.settings&&st.league.settings.type)===2&&!feed;
  const dyn=wantDyn?await ddFromWorker(prov,st.ref.id,st.pool,'dynasty'):null;
  const got=feed?ddFromFeed(st.pool):await ddFromWorker(prov,st.ref.id,st.pool,'season');"""

OLD_LOAD_TAIL = """  st.ddValues=got;
  if(st===state)DD=got;
  return got;
}"""
NEW_LOAD_TAIL = """  if(dyn&&!dyn.meta&&st.dd)dyn.meta=st.dd;
  const boards={season:got||null,dynasty:dyn||null};
  st.ddValues=boards;
  if(st===state)DD=boards;
  return boards;
}"""

OLD_MVOF = """  const dynasty=horizon==='dynasty';
  if(dynasty){
    if(!DYNASTY_MV||!DYNASTY_MV.by.size)return null;
    const row=DYNASTY_MV.by.get(mvKey(p.name));if(!row)return null;
    const v=Number(state.slots.SUPERFLEX?row.two_qb_auction:row.one_qb_auction);
    return Number.isFinite(v)?v:null;
  }"""
NEW_MVOF = """  const dynasty=horizon==='dynasty';
  /* ⚠️ THE BOARD FOR THE HORIZON ASKED FOR, BEFORE ANY PMV PATH. This used to sit AFTER the
     dynasty block, which returned unconditionally — so a dynasty league could never reach
     its own DataDawg$ board and every value surface (trade finder, radars, surplus) ran on
     generic public market value while a purpose-built board went unread. */
  const board=ddBoard(horizon);
  if(board&&board.by&&board.by.size){
    const k=ddKey(p);
    if(k&&board.by.has(k))return board.by.get(k);
    return null;                       /* on the board's basis or unpriced — never mixed */
  }
  if(dynasty){
    if(!DYNASTY_MV||!DYNASTY_MV.by.size)return null;
    const row=DYNASTY_MV.by.get(mvKey(p.name));if(!row)return null;
    const v=Number(state.slots.SUPERFLEX?row.two_qb_auction:row.one_qb_auction);
    return Number.isFinite(v)?v:null;
  }"""

OLD_DDBLOCK = """  if(ddActive()){
    const k=ddKey(p);
    if(k&&DD.by.has(k))return DD.by.get(k);
    return null;
  }
"""
NEW_DDBLOCK = ""

OLD_LABELS = """function labelFor(h){
  if(h!=='dynasty'&&ddActive())return 'DataDawg$';
  return h==='dynasty'?'Overall dynasty value':'PMV (Public Market Value)';
}
function asOfFor(h){
  if(h!=='dynasty'&&ddActive())return ddAsOf();
  return (h==='dynasty'?DYNASTY_MV:MV)?.asOf||null;
}"""
NEW_LABELS = """function labelFor(h){
  if(ddActive(h))return 'DataDawg$';
  return h==='dynasty'?'Overall dynasty value':'PMV (Public Market Value)';
}
function asOfFor(h){
  if(ddActive(h))return ddAsOf(h);
  return (h==='dynasty'?DYNASTY_MV:MV)?.asOf||null;
}
/* ⚠️ The format qualifier belongs to PMV and only to PMV. pool.json ships one column per
   league shape, so "(SFHALF12)" names WHICH public column was read — real information. A
   DataDawg$ board is built for one room: there is no column to cite, and printing one
   implies a source that was not used. And mvColumn() returns null for a room with no
   published column (Commit 1's abstention), so the old expression called .toUpperCase() on
   null and threw while painting the caveat that explains the abstention. */
function basisQualifier(mod){
  const h=hz(mod);
  if(ddActive(h))return '';
  if(usesDynasty(mod))return ' ('+(state.slots.SUPERFLEX?'SF / 2QB':'1QB')+')';
  const c=mvColumn();
  return c?' ('+String(c).toUpperCase()+')':'';
}"""

OLD_MONEY_Q = ("(usesDynasty('money')?' ('+(state.slots.SUPERFLEX?'SF / 2QB':'1QB')+')':"
               "' ('+mvColumn().toUpperCase()+')')")
NEW_MONEY_Q = "basisQualifier('money')"
OLD_TRADES_Q = ("(usesDynasty('trades')?' ('+(state.slots.SUPERFLEX?'SF / 2QB':'1QB')+')':"
                "' ('+esc(mvColumn().toUpperCase())+')')")
NEW_TRADES_Q = "esc(basisQualifier('trades'))"

STEPS = [
    (OLD_STATE, NEW_STATE, "DD state"),
    (OLD_HELPERS, NEW_HELPERS, "DD helpers"),
    (OLD_WORKER_SIG, NEW_WORKER_SIG, "ddFromWorker signature"),
    (OLD_WORKER_BODY, NEW_WORKER_BODY, "ddFromWorker request body"),
    (OLD_LOAD, NEW_LOAD, "loadDD head"),
    (OLD_LOAD_TAIL, NEW_LOAD_TAIL, "loadDD tail"),
    (OLD_MVOF, NEW_MVOF, "mvOf horizon board"),
    (OLD_DDBLOCK, NEW_DDBLOCK, "old season-only DD block"),
    (OLD_LABELS, NEW_LABELS, "labels + basisQualifier"),
    (OLD_MONEY_Q, NEW_MONEY_Q, "money qualifier"),
    (OLD_TRADES_Q, NEW_TRADES_Q, "trades qualifier"),
]


# ---------------------------------------------------------------- the sibling test ----
# ⚠️ This patch CHANGES A CONTRACT that work/test-datadawg-basis.mjs asserts (DD is now a
# per-horizon map, and loadDD caches `boards` rather than `got`). Updating that test here is
# part of the change, not an afterthought: shipping a patch that leaves a sibling suite red
# trains everyone to ignore red.
TEST = pathlib.Path("work/test-datadawg-basis.mjs")
TEST_STEPS = [
    ('${lift("ddKey")} ${lift("ddActive")}',
     '${lift("ddKey")} ${lift("ddBoard")} ${lift("ddActive")}',
     "lift ddBoard"),
    ("    DD: dd, MV: mv, DYNASTY_MV: null,",
     "    /* DD is a per-horizon map now; these fixtures are season boards. */\n"
     "    DD: (dd && dd.by) ? { season: dd, dynasty: null } : dd, MV: mv, DYNASTY_MV: null,",
     "per-horizon fixture"),
    (r'ok("loadDD caches the resolved board on its league state", /st\.ddValues=got/.test(src));',
     r'ok("loadDD caches the resolved boards on its league state", /st\.ddValues=boards/.test(src));',
     "ddValues assertion"),
]

def patch_test():
    if not TEST.exists():
        print("  (work/test-datadawg-basis.mjs absent - skipped)"); return
    t = TEST.read_text(encoding="utf-8")
    if 'lift("ddBoard")' in t:
        print("  sibling test already updated"); return
    for old, new, what in TEST_STEPS:
        n = t.count(old)
        if n != 1: sys.exit(f"test {what}: expected 1 occurrence, found {n}")
        t = t.replace(old, new)
    TEST.write_text(t, encoding="utf-8", newline="\n")
    print("  updated work/test-datadawg-basis.mjs for the new per-horizon contract")

def main():
    if not PAGE.exists(): sys.exit("run from the repo root")
    s = PAGE.read_text(encoding="utf-8")
    if "function ddBoard(h)" in s and "function basisQualifier(mod)" in s:
        print("already applied - no change"); return
    for old, new, what in STEPS:
        n = s.count(old)
        if n != 1: sys.exit(f"{what}: expected 1 occurrence, found {n}. Page has drifted — re-read before patching.")
        s = s.replace(old, new)
    PAGE.write_text(s, encoding="utf-8", newline="\n")
    print("patched: per-horizon DataDawg$ boards, mvOf reordered, basisQualifier (crash + label)")
    patch_test()
    print("NEXT: node work/test-dd-horizon.mjs && cd work && python3 stamp-sw-version.py && node verify-sw.mjs")

if __name__ == "__main__": main()
