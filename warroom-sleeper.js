/* One public Sleeper snapshot for the Worker and the War Room. No account secrets,
   no ownership inference, and no season averages substituted for weekly points. */
(function(root){
'use strict';
const API='https://api.sleeper.app/v1', PROJ='https://api.sleeper.app/projections/nfl/';
const POS=['QB','RB','WR','TE','K','DEF'];
const num=x=>x==null||x===''||!Number.isFinite(Number(x))?null:Number(x);
const ids=xs=>[...new Set((xs||[]).filter(x=>x!=null&&String(x)!=='0').map(String))];
function slots(raw){const out={};for(let s of raw||[]){s=({'W/R/T':'FLEX',SUPER_FLEX:'SUPERFLEX',DEF:'DST'}[s]||s);out[s]=(out[s]||0)+1;}return out;}
async function load(input,get,weeklyEngine){
  const leagueId=String(input.leagueId||'');
  if(!/^\d{6,24}$/.test(leagueId))throw Error('Invalid Sleeper league ID.');
  const sources={}, coverage={};
  async function read(key,url,optional=false,ttl=0){
    try{const r=await get(url,ttl);sources[key]={url,fetchedAt:r.fetchedAt};coverage[key]={status:'available'};return r.data;}
    catch(e){if(!optional)throw Error(key+': '+e.message);coverage[key]={status:'unavailable',reason:e.message};sources[key]={url,fetchedAt:null};return null;}
  }
  const [raw,nfl,users,rosters]=await Promise.all([
    read('league',API+'/league/'+leagueId),read('nflState',API+'/state/nfl'),
    read('users',API+'/league/'+leagueId+'/users'),read('rosters',API+'/league/'+leagueId+'/rosters')]);
  if(String(raw?.league_id)!==leagueId||!Array.isArray(users)||!Array.isArray(rosters)||!rosters.length)throw Error('Sleeper returned an incomplete or different league.');
  if(rosters.some(r=>r.league_id!=null&&String(r.league_id)!==leagueId))throw Error('Sleeper returned rosters from a different league.');
  const season=String(raw.season||'');
  if(!/^\d{4}$/.test(season)||(input.season!=null&&String(input.season)!==season))throw Error('The requested season does not match this league.');
  const current=season===String(nfl?.season)&&['regular','pre'].includes(nfl?.season_type);
  const week=current?(nfl.season_type==='pre'?1:Number(nfl.week)):null;
  if(week!=null&&(!Number.isInteger(week)||week<1||week>18))throw Error('Sleeper has not identified a current regular-season week.');
  if(input.week!=null&&Number(input.week)!==week)throw Error('This feed supports the current week only; it cannot attach current rosters to a historical week.');
  const playoffStart=Number(raw.settings?.playoff_week_start)||19, weeks=Math.max(1,Math.min(18,playoffStart-1));
  const projURL=PROJ+season+'?season_type=regular&order_by=pts_ppr'+POS.map(p=>'&position[]='+p).join('');
  const weekURL=PROJ+season+'/'+week+'?season_type=regular&order_by=pts_ppr'+POS.map(p=>'&position[]='+p).join('');
  const [seasonRows,weeklyRows,dictionary,transactions,matches,playoffMatchups]=await Promise.all([
    read('seasonProjections',projURL,true,3600000),
    week==null?null:read('weeklyProjections',weekURL,true),
    read('playerStatus',API+'/players/nfl',true,300000),
    week==null?null:read('transactions',API+'/league/'+leagueId+'/transactions/'+week,true),
    Promise.all(Array.from({length:weeks},(_,i)=>read('matchupsWeek'+(i+1),API+'/league/'+leagueId+'/matchups/'+(i+1),true))),
    week>weeks?read('matchupsWeek'+week,API+'/league/'+leagueId+'/matchups/'+week,true):null
  ]);
  const safeUsers=users.map(u=>({user_id:String(u.user_id),display_name:u.display_name||null,metadata:{team_name:u.metadata?.team_name||null}}));
  const user=new Map(safeUsers.map(u=>[u.user_id,u])), byId=new Map();
  function player(id,p={}){
    id=String(id);const d=dictionary?.[id]||{}, info={...d,...p};
    if(!byId.has(id))byId.set(id,{id,name:info.full_name||[info.first_name,info.last_name].filter(Boolean).join(' ')||'Sleeper player '+id,
      pos:info.position==='DEF'?'DST':info.position||'Unknown',positions:info.fantasy_positions||[info.position||'Unknown'],team:info.team||null,
      p:null,weeklyPoints:null,injuryStatus:d.injury_status||null,status:d.status||null,gameLocked:null,byeWeek:num(d.bye_week)});
    return byId.get(id);
  }
  for(const [id,p] of Object.entries(dictionary||{}))if(p.active!==false&&POS.includes(p.position))player(id,p);
  for(const row of Array.isArray(seasonRows)?seasonRows:[]){if(row.player_id==null)continue;const p=player(row.player_id,row.player);p.p=weeklyEngine.score(row,raw.scoring_settings);if(p.p!=null)p.p/=weeks;}
  const weeklyPoints={};
  for(const row of Array.isArray(weeklyRows)?weeklyRows:[]){if(row.player_id==null)continue;const p=player(row.player_id,row.player);p.weeklyPoints=weeklyEngine.score(row,raw.scoring_settings);if(p.weeklyPoints!=null)weeklyPoints[p.id]=p.weeklyPoints;}
  const teams=rosters.map(r=>{
    const held=ids([...(r.players||[]),...(r.reserve||[]),...(r.taxi||[]),...(r.starters||[])]);held.forEach(id=>player(id));
    const starters=ids(r.starters),reserve=ids(r.reserve),taxi=ids(r.taxi),s=r.settings||{};
    const decimal=(whole,fraction)=>num(s[whole])==null?null:num(s[whole])+(num(s[fraction])||0)/100;
    return {id:String(r.roster_id),owner:String(r.owner_id||''),name:user.get(String(r.owner_id))?.metadata.team_name||user.get(String(r.owner_id))?.display_name||'Roster '+r.roster_id,
      players:held,starters,startingSlots:(r.starters||[]).map(x=>String(x)==='0'?null:String(x)),reserve,taxi,
      bench:held.filter(id=>!starters.includes(id)&&!reserve.includes(id)&&!taxi.includes(id)),
      standings:{wins:num(s.wins),losses:num(s.losses),ties:num(s.ties),pointsFor:decimal('fpts','fpts_decimal'),pointsAgainst:decimal('fpts_against','fpts_against_decimal')},
      faab:{initialBudget:num(raw.settings?.waiver_budget),used:num(s.waiver_budget_used),remaining:null,reason:'Current spendable balance is not reported; budget transfers are not reconstructed.'},waiverPosition:num(s.waiver_position)};
  });
  const held=new Set(teams.flatMap(t=>t.players)),pool=[...byId.values()].map(p=>({...p,rostered:held.has(p.id)}));
  const schedule=matches.map(rows=>{const groups={};for(const m of Array.isArray(rows)?rows:[])if(m.matchup_id!=null)(groups[m.matchup_id]||=[]).push(String(m.roster_id));return Object.values(groups).filter(x=>x.length===2);});
  const matchupRows=week==null?null:week>weeks?playoffMatchups:matches[week-1];
  const matchups=Array.isArray(matchupRows)?matchupRows.map(m=>({teamId:String(m.roster_id),matchupId:m.matchup_id,points:num(m.points),customPoints:num(m.custom_points),starters:ids(m.starters),players:ids(m.players),playerPoints:m.players_points||null})):null;
  const ready=Object.keys(weeklyPoints).length>0;
  const weekly={ready,season,week,points:weeklyPoints,capturedAt:sources.weeklyProjections?.fetchedAt||null,source:sources.weeklyProjections?.url||null,
    error:ready?null:coverage.weeklyProjections?.reason||'Current-week projections matching this league scoring are unavailable.'};
  coverage.weeklyProjections={status:ready?'available':'unavailable',reason:weekly.error};
  coverage.injuries={status:dictionary?'partial':'unavailable',reason:'Provider injury/status labels when reported; null is unknown, not healthy.'};
  coverage.byes={status:'partial',reason:'Bye week only when explicitly reported in player metadata; missing is unknown.'};
  coverage.rosterEligibility={status:raw.roster_positions?.length?'available':'unavailable',reason:'Exact roster slots and provider position eligibility, including restricted flex slots.'};
  coverage.availablePlayers={status:dictionary?'partial':'unavailable',reason:'Unrostered players only. Pending claims, add eligibility, and game locks are not exposed.'};
  coverage.gameLocks={status:'unavailable',reason:'No authoritative game-lock state in this feed.'};
  coverage.faab={status:'partial',reason:'Initial budget and amount used are reported; spendable balance after transfers is unknown.'};
  coverage.deadlines={status:'unavailable',reason:'Raw waiver settings and trade deadline week are reported; exact timestamp and timezone are not established.'};
  coverage.standings={status:'partial',reason:'Provider wins, losses, ties and points; official tiebreak order is not reconstructed.'};
  coverage.lineups={status:'available',reason:'Actual starters, bench, IR and taxi; selected roster does not prove account ownership.'};
  coverage.matchups={status:matchups?.length?'available':'unavailable',reason:matchups?.length?null:'No current-week matchup rows were returned.'};
  if(!Array.isArray(transactions))coverage.transactions={status:'unavailable',reason:'Current-week transactions unavailable.'};
  if(!Array.isArray(seasonRows)||!seasonRows.length)coverage.seasonProjections={status:'unavailable',reason:'No season projection rows returned.'};
  const settings=raw.settings||{};
  const rules=Object.fromEntries(Object.entries(settings).filter(([k])=>/waiver|trade_deadline|trade_review|reserve|taxi|lock|disable_adds|disable_trades|elimination|type/.test(k)));
  return {provider:'sleeper',leagueId,identity:{provider:'sleeper',leagueId,season,week},fetchedAt:new Date().toISOString(),
    league:{id:leagueId,league_id:leagueId,name:raw.name,season,sport:raw.sport,status:raw.status,settings,scoring_settings:raw.scoring_settings||{},roster_positions:raw.roster_positions||[],auction_budget:null},
    users:safeUsers,teams,pool,slots:slots(raw.roster_positions),schedule,weekly,
    context:{matchups,transactions:Array.isArray(transactions)?transactions.map(t=>({id:t.transaction_id,type:t.type,status:t.status,created:t.created,updated:t.status_updated,rosterIds:t.roster_ids,adds:t.adds,drops:t.drops,waiverBudget:t.waiver_budget,draftPicks:t.draft_picks})):null,
      waiverRules:rules,exactDeadlines:null,coverage,sources,availabilityMeaning:'Unrostered does not mean immediately claimable.'}};
}
function hydrate(feed){
  const pool=feed.pool||[],byId=new Map(pool.map(p=>[String(p.id),p]));
  return {...feed,teams:feed.teams.map(t=>({...t,ownerId:t.owner,players:t.players.map(id=>byId.get(String(id))).filter(Boolean),starters:new Set(t.starters)})),
    weekly:{...feed.weekly,byId:new Map(Object.entries(feed.weekly.points||{})),players:byId}};
}
root.DDSleeper={load,hydrate,slots};
})(typeof module!=='undefined'?module.exports:globalThis);
