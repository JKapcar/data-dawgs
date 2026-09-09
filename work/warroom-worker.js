/* Account selection stays separate from the public Sleeper adapter. A saved roster
   is a viewing preference, never evidence that a user controls that Sleeper team. */
const WR_PUBLIC_CACHE=new Map(), WR_CONTEXT_CACHE=new Map();
function wrCachePut(cache,key,value,ttl){
  if(cache.size>=32)cache.delete(cache.keys().next().value);
  cache.set(key,{value,expires:Date.now()+ttl});
}
async function wrPublicGet(url,ttl=0){
  const hit=WR_PUBLIC_CACHE.get(url);
  if(ttl&&hit?.expires>Date.now())return hit.value;
  const r=await fetch(url,{signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('Source request failed ('+r.status+').');
  const value={data:await r.json(),fetchedAt:new Date().toISOString()};
  if(ttl)wrCachePut(WR_PUBLIC_CACHE,url,value,ttl);
  return value;
}
async function wrSleeperFeed(env,uid,input){
  // The lookup key includes the requested season/week; the stored key also carries
  // the resolved season/week. Current-week requests cannot survive an NFL rollover
  // for longer than this 30-second cache. No stale result is returned after failure.
  const prefix=JSON.stringify([uid||'public','sleeper',String(input.leagueId),input.season||'current',input.week||'current']);
  const cached=[...WR_CONTEXT_CACHE.values()].find(entry=>entry.lookup===prefix&&entry.expires>Date.now());
  let body;
  if(!input.refresh&&cached?.expires>Date.now())body=structuredClone(cached.value);
  else{
    body=await wrSleeperRoot.DDSleeper.load(input,wrPublicGet,wrWeeklyRoot.DDWeekly);
    body.cache={key:JSON.stringify(['sleeper',body.identity.leagueId,body.identity.season,body.identity.week]),maxAgeSeconds:30};
    const key=JSON.stringify([uid||'public','sleeper',body.identity.leagueId,body.identity.season,body.identity.week]);
    wrCachePut(WR_CONTEXT_CACHE,key,structuredClone(body),30000);
    WR_CONTEXT_CACHE.get(key).lookup=prefix;
  }
  // Custom boards retain the existing authenticated-only boundary. The public
  // fallback uses the exact same default engine and inputs as the browser.
  if(body.identity.season!=='2026'){body.dd={matched:0,unmatched:body.pool.length,horizon:'season',error:'The available dollar inputs cover 2026 only.'};return body;}
  const board=uid?await ddLoadBoard(env,'sleeper',body.leagueId,'season'):null;
  if(board)ddDecorateBody(board,body);
  else{
    try{
      const source=(await wrPublicGet('https://datadawgs216.com/data/datadawg-default.json',3600000)).data;
      const result=wrDefaultRoot.DDDefault.build(source.data,{teams:body.teams.length,ppr:body.league.scoring_settings.rec,slots:body.slots,budget:null});
      const by=new Map(result.players.map(p=>[ddPlayerKey(p),{v:p.target}]));
      ddDecorateBody({by,meta:{...result.meta,provider:'sleeper',league_id:body.leagueId,league:body.league.name}},body);
    }catch(e){body.dd={matched:0,unmatched:body.pool.length,horizon:'season',error:e.message};}
  }
  return body;
}
async function handleSleeperWarroom(request,url,env,cors){
  if(request.method!=='GET')return json({error:'Use GET.'},405,cors);
  let uid=null;
  if(request.headers.has('X-Bozo-Session')){
    const auth=await sessionAuth(request,env);
    if(auth.err||!auth.uid)return json({error:auth.err||'Sign in with a UID account.'},auth.code||401,cors);
    uid=auth.uid;
  }
  try{
    const body=await wrSleeperFeed(env,uid,{leagueId:url.searchParams.get('leagueId'),season:url.searchParams.get('season')||undefined,week:url.searchParams.get('week')||undefined,refresh:url.searchParams.get('refresh')==='1'});
    return json(body,200,{...cors,'Cache-Control':'private, no-store'});
  }catch(e){return json({error:e.message},502,{...cors,'Cache-Control':'no-store'});}
}
async function wrConnections(env,uid,provider){
  const rows=[];
  if(!provider||provider==='sleeper'){
    const result=await fbGet(env,'/users/'+encodeURIComponent(uid)+'/guillotineState');
    if(result.ok===false)throw Error('The account league shelf could not be read.');
    const state=salvageGuillotineState(result.data?.state||{leagues:[]});
    for(const league of state.leagues)rows.push({provider:'sleeper',leagueId:league.leagueId,teamId:league.focusRosterId,selection:'Saved viewing preference; ownership unverified.'});
  }
  if(!provider||provider==='yahoo'){
    const c=await yahooStored(env.RL,uid);
    if(c)rows.push({provider:'yahoo',leagueId:String(c.leagueId),season:c.season||null,teamId:c.teamId??null,credential:c});
  }
  if(!provider||provider==='espn'){
    const keys=await espnListKeys(env.RL,'espn:league:'+uid+':');
    const all=[await espnStored(env,uid)];
    for(const k of keys){const parts=k.split(':');const season=parts[parts.length-2],id=parts[parts.length-1];all.push(await espnStored(env,uid,id,season));}
    const seen=new Set();
    for(const c of all){if(!c)continue;const key=String(c.season)+':'+c.leagueId;if(seen.has(key))continue;seen.add(key);rows.push({provider:'espn',leagueId:String(c.leagueId),season:String(c.season),teamId:c.teamId??null,credential:c});}
  }
  return rows;
}
function wrPublicConnections(rows){return rows.map(({credential,...r})=>r);}
function wrSlice(body,args,selectedTeam){
  const teams=body.teams||[],teamId=args.team_id!=null?String(args.team_id):selectedTeam!=null?String(selectedTeam):null;
  if(teamId!=null&&!teams.some(t=>String(t.id)===teamId))throw Error('That team is not in the selected league. Choose one of teams[].id.');
  const held=new Set(teams.flatMap(t=>(t.players||[]).map(String))),all=body.pool||[];
  const scope=args.scope||'rosters',offset=args.offset||0,limit=args.limit||50;
  let pool=scope==='rosters'?all.filter(p=>held.has(String(p.id))):scope==='available'?all.filter(p=>!held.has(String(p.id))):all;
  if(args.position)pool=pool.filter(p=>p.pos===args.position);
  if(scope==='available')pool.sort((a,b)=>(b.weeklyPoints??-Infinity)-(a.weeklyPoints??-Infinity)||String(a.id).localeCompare(String(b.id)));
  const total=pool.length;
  if(scope!=='rosters')pool=pool.slice(offset,offset+limit);
  const returned=new Set(pool.map(p=>String(p.id)));
  const weekly=body.weekly?{...body.weekly,points:Object.fromEntries(Object.entries(body.weekly.points||{}).filter(([id])=>returned.has(id)))}:undefined;
  let lineup;
  if(body.provider==='sleeper'&&teamId!=null){
    const team=teams.find(t=>String(t.id)===teamId),excluded=new Set([...(team.reserve||[]),...(team.taxi||[])]);
    const players=all.filter(p=>team.players.includes(p.id)&&!excluded.has(p.id));
    const points=new Map(Object.entries(body.weekly?.points||{}));
    const candidate=body.weekly?.ready?wrWeeklyRoot.DDWeekly.optimize(players,body.league.roster_positions,points):{ready:false,error:body.weekly?.error};
    const actual=team.startingSlots||team.starters||[];
    const actualComplete=actual.length>0&&actual.every(id=>id!=null&&points.has(id));
    lineup={teamId,actualStarters:actual,actualProjectedPoints:actualComplete?actual.reduce((n,id)=>n+points.get(id),0):null,
      candidateReady:candidate.ready,candidateProjectedPoints:candidate.points??null,
      candidateAssignments:(candidate.assignments||[]).map(a=>({slot:a.slot,playerId:a.player.id,points:a.points})),error:candidate.error||null,
      note:'Same weekly optimizer as the Money sheet. IR/taxi excluded. Game locks and injury availability are not enforced: inspect the provider before acting. This is not a submitted lineup.'};
  }
  return {...body,users:undefined,lineup,you:teamId,teamSelection:teamId==null?'Choose team_id before personalized advice.':'Viewing preference; ownership unverified.',pool,weekly,
    dd:{...(body.dd||{}),returnedRows:pool.length,returnedWithDollars:pool.filter(p=>p.dd!=null).length},
    scope:{returned:scope,total,returnedRows:pool.length,offset:scope==='rosters'?0:offset,nextOffset:scope!=='rosters'&&offset+pool.length<total?offset+pool.length:null,
      freeAgentsOmitted:scope==='rosters'?all.filter(p=>!held.has(String(p.id))).length:undefined,
      note:scope==='available'?'Unrostered players ordered by weekly projected points, missing projections last. This is not a waiver recommendation; verify claim eligibility in the provider.':undefined}};
}

function wrArgs(args,discovery=false){
  if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Arguments must be an object.');
  const allowed=discovery?['provider']:['provider','league_id','season','week','team_id','scope','position','limit','offset','refresh'];
  if(Object.keys(args).some(k=>!allowed.includes(k)))throw Error('Unsupported argument.');
  if(args.provider!=null&&!['sleeper','espn','yahoo'].includes(args.provider))throw Error('Unsupported provider.');
  if(args.scope!=null&&!['rosters','available','full'].includes(args.scope))throw Error('Unsupported scope.');
  if(args.position!=null&&!['QB','RB','WR','TE','K','DST'].includes(args.position))throw Error('Unsupported position.');
  for(const [key,min,max] of [['limit',1,100],['offset',0,100000],['week',1,18]])if(args[key]!=null&&(!Number.isInteger(args[key])||args[key]<min||args[key]>max))throw Error('Invalid '+key+'.');
  for(const key of ['league_id','team_id'])if(args[key]!=null&&(typeof args[key]!=='string'||!/^[a-zA-Z0-9_.-]{1,40}$/.test(args[key])))throw Error('Invalid '+key+'.');
  if(args.season!=null&&(typeof args.season!=='string'||!/^\d{4}$/.test(args.season)))throw Error('Invalid season.');
  if(args.refresh!=null&&typeof args.refresh!=='boolean')throw Error('refresh must be boolean.');
  return args;
}
