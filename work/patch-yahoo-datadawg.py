from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "fantasy-warroom.html"


def replace(old, new, sentinel):
    src = PAGE.read_bytes().decode("utf-8")
    if sentinel in src:
        print("=", sentinel)
        return
    count = src.count(old)
    assert count == 1, f"anchor count {count}: {old[:100]!r}"
    PAGE.write_bytes(src.replace(old, new).encode("utf-8"))
    print("+", sentinel)


replace(
'''/* DataDawg$ — private, league-specific, served by the Worker. Never a static file, never
   in the repo. Null until a board is found for the open league; the page then runs on PMV. */''',
'''/* DataDawg$ is league-specific. Most boards are private Worker responses, but Yahoo
   773763 has a published, reproducible board in /data because it was built for that exact
   room. Null until a matching board is found; only then may the page fall back to PMV. */''',
"773763 has a published, reproducible board",
)

replace(
'''/* ESPN and Yahoo arrive with values already attached by the Worker. */
function ddFromFeed(pool){''',
'''/* The published 2026 board belongs to exactly one room. It must not leak into another
   Yahoo league merely because the players look alike. Commit 5 replaces this temporary
   name join with Yahoo id -> Sleeper id -> GSIS id; the room gate stays. */
async function ddFromYahooPublic(provider,leagueId){
  if(provider!=='yahoo'||String(leagueId)!=='773763')return null;
  try{
    const r=await fetch('data/datadawg-dollars-values.json',{cache:'no-cache'});
    if(!r.ok)return null;
    const j=await r.json(),rows=j&&j.data&&Array.isArray(j.data.players)?j.data.players:[];
    const by=new Map();
    rows.forEach(x=>{
      const v=Number(x&&x.target),k=ddKey({name:x&&x.player,pos:x&&x.pos,team:x&&x.team});
      if(k&&Number.isFinite(v))by.set(k,v);
    });
    if(!by.size)return null;
    return {by,meta:{as_of:j.as_of||j.data.as_of||null,tier:j.tier||j.data.tier||null,
      graded:j.graded===true,model_id:j.data.model_id||null,note:j.note||'',
      interval_meaning:j.data.interval_meaning||'',validation:j.data.validation||null},public:true};
  }catch(e){return null}
}
/* ESPN and Yahoo arrive with values already attached by the Worker. */
function ddFromFeed(pool){''',
"async function ddFromYahooPublic(provider,leagueId)",
)

replace(
'''  const dyn=wantDyn?await ddFromWorker(prov,st.ref.id,st.pool,'dynasty',st.teams):null;
  const got=feed?ddFromFeed(st.pool):await ddFromWorker(prov,st.ref.id,st.pool,'season',st.teams);''',
'''  const dyn=wantDyn?await ddFromWorker(prov,st.ref.id,st.pool,'dynasty',st.teams):null;
  const published=await ddFromYahooPublic(prov,st.ref.id);
  const got=published||(feed?ddFromFeed(st.pool):await ddFromWorker(prov,st.ref.id,st.pool,'season',st.teams));''',
"const published=await ddFromYahooPublic(prov,st.ref.id)",
)

replace(
'''function ddAsOf(h){const b=ddBoard(h);return (b&&b.meta&&b.meta.as_of)||null;}''',
'''function ddAsOf(h){const b=ddBoard(h);return (b&&b.meta&&b.meta.as_of)||null;}
function ddDisclosure(h){
  const b=ddBoard(h),m=b&&b.meta;
  if(!m||m.model_id!=='datadawgs-datadawg-dollars-2026-v4')return '';
  return 'DataDawg$ dated '+(m.as_of||'unknown')+' · tier labs · graded: false. '
    +'It is an opening-state auction target, not a clearing price and not a max bid. '
    +'Low/high are conversion-sensitivity bands, not bid ceilings or player-outcome intervals. '
    +'Keeper inflation is unmodelled (keeper deadline 2026-09-08). '
    +'A share of the priced board is not a share of what was spent.';
}''',
"function ddDisclosure(h)",
)

replace(
'''        <h3>What you paid vs what the market says now</h3>''',
'''        <h3>What you paid vs the active price board</h3>''',
"What you paid vs the active price board",
)

replace(
'''    ['Your rank',rank+' of '+M.length,leagueTotal>0?(mine.total/leagueTotal*100).toFixed(1)+'% of all money':'no priced players yet'],''',
'''    ['Your rank',rank+' of '+M.length,leagueTotal>0?(mine.total/leagueTotal*100).toFixed(1)+(ddActive(mnH)?'% share of priced board held':'% of all money'):'no priced players yet'],''',
"% share of priced board held",
)

replace(
'''    +'so a team full of deep waiver adds will read leaner than it is. Per-axis scaling on the radars is relative to this league, '
    +'so a shape maxed at a position only means nobody else spent there either.';''',
'''    +'so a team full of deep waiver adds will read leaner than it is. Per-axis scaling on the radars is relative to this league, '
    +'so a shape maxed at a position only means nobody else spent there either.'
    +(ddDisclosure(mnH)?' '+ddDisclosure(mnH):'');''',
"+(ddDisclosure(mnH)?' '+ddDisclosure(mnH):'')",
)

replace(
'''      +(mnPaidLab==='top'?' The '+MN_LABEL_TOP+' biggest gaps are labelled \\u2014 switch to Label all for the rest.':'');''',
'''      +(mnPaidLab==='top'?' The '+MN_LABEL_TOP+' biggest gaps are labelled \\u2014 switch to Label all for the rest.':'')
      +(ddActive(mnH)?' Pick grade is DataDawg$ minus paid: positive is value bought below target; negative is cost above target.':'');''',
"Pick grade is DataDawg$ minus paid",
)

replace(
'''    :type===1?'<div class="wr-warn"><b>Keeper league detected.</b> Keeper duration and cost rules are unavailable, so this view remains this-season market value rather than pretending to know the keeper horizon.</div>':'';''',
'''    :type===1?'<div class="wr-warn"><b>Keeper league detected.</b> '+(ddActive(mnH)?'This room uses its dated DataDawg$ opening-state target, but keeper inflation is unmodelled; the keeper deadline is 2026-09-08.':'Keeper duration and cost rules are unavailable, so this view remains this-season market value rather than pretending to know the keeper horizon.')+'</div>':'';''',
"This room uses its dated DataDawg$ opening-state target",
)

replace(
'''within <code>max($4, 35% of the dearer player)</code> of each other in <b>Public Market Value</b> — the
        auction dollars in <a href="/data/pool.json"><code>/data/pool.json</code></a>, maintained by hand each week,
        in whichever column matches this league (full PPR, half, or superflex). If either player has no published''',
'''within <code>max($4, 35% of the dearer player)</code> of each other on the active price board. Yahoo 773763 uses
        <b>DataDawg$</b> from <a href="/data/datadawg-dollars-values.json"><code>/data/datadawg-dollars-values.json</code></a>;
        other redraft rooms use the matching <b>Public Market Value</b> column in <a href="/data/pool.json"><code>/data/pool.json</code></a>.
        If either player has no published''',
"Yahoo 773763 uses\n        <b>DataDawg$</b>",
)

replace(
'''- NOT MODELED: injuries, byes, trades, waivers, lineup decisions, in-season projection updates, and correlation between the two teams in a matchup. Before three completed weeks, σ is a stated generic assumption rather than an estimate from the league.''',
'''- NOT MODELED: injuries, byes, trades, waivers, lineup decisions, in-season projection updates, and correlation between the two teams in a matchup. Before three completed weeks, σ is a stated generic assumption rather than an estimate from the league.
- YAHOO 773763 PRICING uses DataDawg$ dated 2026-08-28, tier labs, graded: false. It is an OPENING-STATE AUCTION TARGET, not a clearing price and not a max bid. Low/high are conversion-sensitivity bands, never bid ceilings or player-outcome intervals. Keeper inflation is unmodelled; the keeper deadline is 2026-09-08. The chart grades a buy as DataDawg$ minus paid. A roster's share of the priced board is NOT the share of what the league spent.''',
"YAHOO 773763 PRICING uses DataDawg$",
)

print("Yahoo DataDawg$ page patch complete")
