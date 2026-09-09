/* Runtime side: public machine packet, private entries, immutable kickoff locks,
 * independent outcome receipts, derived scores. Original /forecast entries survive. */
const FCL_ROOT = '/forecast/live';
const fclRoot = season => FCL_ROOT+'/nfl/'+season;
async function fclReadJson(path) {
  const r=await fetch(SITE+path,{cf:{cacheTtl:60,cacheEverything:true}});
  if(!r.ok)throw new Error(path+' HTTP '+r.status);
  const j=await r.json(); if(!j.as_of||!j.source)throw new Error(path+' invalid envelope'); return j;
}
async function fclOnce(env,path,row) {
  const hit=await fbGet(env,path,true);
  if(hit.data)return hit.data;
  if(!hit.etag)throw new Error('Immutable write requires database ETag');
  if(await fbPut(env,path,row,hit.etag))return row;
  return (await fbGet(env,path)).data;
}
async function fclInputs() {
  const [schedule,nfelo,classic]=await Promise.all([
    fclReadJson('/data/nfl-schedule.json'),fclReadJson('/data/nfelo.json'),fclReadJson('/data/538-classic.json')]);
  const games=schedule.data?.games;
  if(!Array.isArray(games)||games.length!==272||new Set(games.map(g=>g.game_id)).size!==272)throw new Error('Canonical NFL slate invalid');
  const season=schedule.data.season||games[0].season;
  if(games.some(g=>g.season!==season||!Number.isFinite(Date.parse(g.kickoff_at))))throw new Error('Mixed or invalid NFL slate');
  return {schedule,nfelo,classic,games,season};
}
async function fclCollectResults(env,games,now) {
  // Reuse the existing Worker-reachable nflverse adapter. No ESPN dependency.
  // Keep finals in a different node from forecast locks. A conflicting correction
  // raises an alert rather than silently rewriting a previous grade.
  const season=games[0].season;
  let doc=await bozoScheduleDoc(env,'nfl',season);
  const waiting=games.some(g=>Date.parse(g.kickoff_at)+2*3600e3<now && g.status!=='final');
  if(waiting && (!doc||now-Date.parse(doc.fetchedAt)>5*60e3)) {
    await bozoRefreshOneSchedule(env,'nfl',season,now);
    doc=await bozoScheduleDoc(env,'nfl',season);
  }
  const prior=(await fbGet(env,fclRoot(season)+'/outcomes')).data||{};
  const finals={...prior}, conflicts=[];
  for(const g of games) {
    if(Date.parse(g.kickoff_at)>=now)continue;
    let result=g.status==='final'?{...g,source:'/data/nfl-schedule.json'}:null;
    const upstream=(doc?.games||[]).find(x=>x.seasonType==='REG' && x.week===g.week &&
      fclTeam(x.home.abbr)===g.home_team && fclTeam(x.away.abbr)===g.away_team && Date.parse(x.startsAt)===Date.parse(g.kickoff_at));
    if(upstream?.completed && Number.isInteger(upstream.homeScore)&&Number.isInteger(upstream.awayScore))
      result={...g,status:'final',home_score:upstream.homeScore,away_score:upstream.awayScore,source:doc.source};
    if(!result||!Number.isInteger(result.home_score)||!Number.isInteger(result.away_score))continue;
    if(prior[g.game_id] && (prior[g.game_id].home_score!==result.home_score||prior[g.game_id].away_score!==result.away_score)) {
      conflicts.push(g.game_id);continue;
    }
    if(!prior[g.game_id])finals[g.game_id]=await fclOnce(env,fclRoot(season)+'/outcomes/'+g.game_id,
      {...result,observed_at:fclIso(now),source_snapshot_id:await sha256hex(JSON.stringify(result))});
  }
  return {finals,conflicts};
}
async function runForecastLive(env) {
  const started=Date.now(), leasePath=FCL_ROOT+'/lease';
  const lease=await fbGet(env,leasePath,true);
  if(lease.data?.until>started)return {status:'already_running'};
  if(!lease.etag)throw new Error('Forecast lease requires database ETag');
  const leaseId=crypto.randomUUID();
  if(!await fbPut(env,leasePath,{id:leaseId,until:started+240e3},lease.etag))return {status:'already_running'};
  try {
    const input=await fclInputs(),{season,nfelo,classic}=input,root=fclRoot(season);
    const {finals,conflicts}=await fclCollectResults(env,input.games,Date.now());
    const games=input.games.map(g=>finals[g.game_id]||g), ratings=fclRatings(classic,games);
    const old=(await fbGet(env,root+'/models')).data||{}, locks=(await fbGet(env,root+'/locks')).data||{};
    const entryTree=(await fbGet(env,FC_ROOT+'/entries/nfl/'+season)).data||{};
    const modelDigest=await sha256hex(JSON.stringify({nfelo:nfelo.data.meta,ratings,finals:Object.keys(finals),schedule:input.schedule.integrity}));
    let toto=null,totoError=null;
    try {toto=await fclReadJson('/data/forecast-toto.json');}catch(e){totoError=e.message;}
    let updated=0,locked=0;
    for(const game of games) {
      const gid=game.game_id,now=Date.now(),kick=Date.parse(game.kickoff_at);
      if(locks[gid])continue;
      if(kick>now && kick-now<=8*86400e3) {
        const rows=fclCandidates(game,nfelo,ratings,now,modelDigest);
        const pick=(toto?.data?.forecasts||[]).find(p=>p.game_id===gid);
        if(pick && toto.data.entrant==='Toto' && fclProb(pick.home_win_probability) &&
          pick.home_team===game.home_team && pick.away_team===game.away_team &&
          fclTime(pick.captured_at)>0 && fclTime(pick.captured_at)<=now && fclTime(pick.captured_at)<kick &&
          typeof pick.rationale==='string' && typeof pick.input_snapshot_id==='string') {
          rows.push({...pick,game_id:gid,season,week:game.week,kickoff_at:game.kickoff_at,
            model_id:'toto',model_name:'Toto',model_version:toto.data.model_version||'ChatGPT — model unspecified',
            captured_at:fclIso(now),source_capture_at:pick.captured_at,
            input_snapshot_id:pick.input_snapshot_id,source:'ChatGPT/Codex authored forecast; imported before kickoff'});
        }
        const previous=old[gid]||{};
        for(const row of rows) {
          const id=row.model_id, comparison=r=>[r.home_win_probability,r.input_snapshot_id,r.source_capture_at,r.model_version,r.rationale];
          // 538 checked_at must not manufacture a new receipt every five minutes.
          const same=previous[id] && previous[id].input_snapshot_id===row.input_snapshot_id &&
            previous[id].home_win_probability===row.home_win_probability && previous[id].model_version===row.model_version;
          if(same)continue;
          if(Date.now()>=kick)continue; // network work cannot carry a receipt past lock
          row.forecast_id=await sha256hex(JSON.stringify([gid,id,comparison(row),row.captured_at]));
          await fclOnce(env,root+'/history/'+gid+'/'+id+'/'+row.forecast_id,row);
          if(Date.now()>=kick)continue;
          await fbPut(env,root+'/models/'+gid+'/'+id,row);
          previous[id]=row;updated++;
        }
        old[gid]=previous;
      } else if(kick<=now) {
        const forecasts=[];
        for(const r of Object.values(old[gid]||{})) {
          if(!fclProb(r.home_win_probability)||fclTime(r.captured_at)>=kick||r.kickoff_at!==game.kickoff_at)continue;
          forecasts.push({...r,entrant_key:fclModelKey(r.model_id),entrant:r.model_name,
            entrant_kind:r.model_id==='toto'?'agent':'model',owner:r.model_id==='toto'?'Kap':null});
        }
        const humans=[];
        for(const entries of Object.values(entryTree[game.week]||{})) {
          const e=entries?.[encodeURIComponent(gid)];
          if(!fclValidEntry(e,game))continue;
          const row={...e,entrant_key:fclHumanKey(e)};
          forecasts.push(row); if(e.entrant_kind!=='agent')humans.push(e);
        }
        const agg=fcAggregate(humans);
        if(agg) {
          const crowd={model_id:'dd-crowd-nfl',model_name:'Data Dawgs Crowd',model_version:FC_CROWD_VERSION,
            sport:'nfl',season,week:game.week,game_id:gid,home_team:game.home_team,away_team:game.away_team,
            kickoff_at:game.kickoff_at,home_win_probability:agg.home_win_probability,
            captured_at:fclIso(Math.max(...agg.contributors.map(e=>fclTime(e.submitted_at)))),sealed_at:fclIso(now),
            n_touched:agg.n_touched,n_used:agg.n_used,contributors:agg.contributors.map(e=>e.entrant),
            contributors_sha256:await sha256hex(agg.contributors.map(fcCanonicalRow).join('\n'))};
          const sealed=await fclOnce(env,fcSealPath('nfl',season,game.week,gid),crowd);
          forecasts.push({...sealed,entrant_key:fclModelKey('dd-crowd-nfl'),entrant:'Data Dawgs Crowd',entrant_kind:'crowd'});
        }
        const lock={version:FCL_VERSION,game_id:gid,kickoff_at:game.kickoff_at,sealed_at:fclIso(now),forecasts,
          forecasts_sha256:await sha256hex(JSON.stringify(forecasts)),
          missing_models:FCL_MODELS.filter(m=>m.kind!=='crowd'&&!forecasts.some(r=>r.model_id===m.id)).map(m=>m.id)};
        locks[gid]=await fclOnce(env,root+'/locks/'+gid,lock); locked++;
      }
    }
    const imminent=games.filter(g=>Date.parse(g.kickoff_at)>Date.now()&&Date.parse(g.kickoff_at)-Date.now()<86400e3);
    const missing=imminent.flatMap(g=>FCL_MODELS.filter(m=>m.kind!=='crowd'&&!old[g.game_id]?.[m.id]).map(m=>({game_id:g.game_id,model_id:m.id})));
    const health={version:FCL_VERSION,checked_at:fclIso(Date.now()),status:conflicts.length||missing.length||totoError?'attention':'ok',missing_upcoming:missing,
      nfelo_captured_at:nfelo.data.meta.captured_at,nfelo_version:nfelo.data.meta.model_version,
      nfelo_stale:Date.now()-Date.parse(nfelo.data.meta.captured_at)>36*3600e3,
      updated,locked,finals:Object.keys(finals).length,correction_conflicts:conflicts,toto_error:totoError};
    await fbPut(env,root+'/health',health);return health;
  } catch(e) {
    await fbPut(env,FCL_ROOT+'/error',{at:fclIso(Date.now()),error:String(e.message||e)});throw e;
  } finally {
    const held=await fbGet(env,leasePath,true);
    if(held.data?.id===leaseId && held.etag)await fbPut(env,leasePath,{id:leaseId,until:0},held.etag);
  }
}

async function forecastLiveRoute(request,url,env,cors) {
  if(url.pathname==='/forecast/run') {
    if(request.method!=='POST')return json({error:'POST only'},405,cors);
    const auth=await requireAdmin(request,env);if(auth.err)return json({error:auth.err},auth.code,cors);
    try{return json({ok:true,...await runForecastLive(env)},200,cors);}catch(e){return json({error:e.message},502,cors);}
  }
  if(request.method!=='GET')return json({error:'GET only'},405,cors);
  const season=Number(url.searchParams.get('season')||2026);
  if(season!==2026)return json({error:'This contest covers NFL 2026.'},400,cors);
  try {
    const schedule=await fclReadJson('/data/nfl-schedule.json'),games=schedule.data.games,now=Date.now();
    // Never load the growing history ledger for a dashboard request.
    const [md,lk,oc,hc,entryData,botsData,errorData]=await Promise.all([
      ...['models','locks','outcomes','health'].map(k=>fbGet(env,fclRoot(season)+'/'+k)),
      fbGet(env,FC_ROOT+'/entries/nfl/'+season),fbGet(env,fcBotPath(null)),fbGet(env,FCL_ROOT+'/error')]);
    const live={health:hc.data},models=md.data||{},locks=lk.data||{},outcomes=oc.data||{};
    const map=new Map(FCL_MODELS.map(m=>[fclModelKey(m.id),{key:fclModelKey(m.id),name:m.name,kind:m.kind,displayed:m.displayed,submitted:0,last_submitted_at:null}]));
    const seen=new Map();
    for(const weeks of Object.values(entryData.data||{}))for(const entries of Object.values(weeks||{}))for(const e of Object.values(entries||{})) {
      if(!e||!e.entrant)continue;
      const key=fclHumanKey(e);if(!seen.has(key))seen.set(key,[]);seen.get(key).push(e);
    }
    for(const [key,entries] of seen) {
      const e=entries[0],valid=entries.filter(x=>x.touched===true);
      map.set(key,{key,name:e.entrant,kind:e.entrant_kind||'human',owner:e.owner,displayed:true,submitted:valid.length,
        last_submitted_at:valid.length?fclIso(Math.max(...valid.map(r=>fclTime(r.submitted_at)))):null});
    }
    for(const b of Object.values(botsData.data||{})) {
      const key='agent:'+b.bot_name;
      if(!map.has(key))map.set(key,{key,name:b.bot_name,kind:'agent',owner:b.owner,displayed:true,submitted:0,last_submitted_at:null,revoked:b.revoked===true});
    }
    const modelRows=[],grades=[],publicGames=[];
    for(const g of games) {
      const lock=locks[g.game_id],isLocked=now>=Date.parse(g.kickoff_at),outcome=outcomes[g.game_id]||g;
      const rows=lock?lock.forecasts.filter(r=>r.model_id):Object.values(models[g.game_id]||{});
      for(const r of rows) {
        const k=fclModelKey(r.model_id),entry=map.get(k);if(!entry)continue;
        entry.submitted++;if(!entry.last_submitted_at||r.captured_at>entry.last_submitted_at)entry.last_submitted_at=r.captured_at;
        modelRows.push({...r,locked:isLocked});
      }
      if(lock)grades.push(...fclGrade(lock,outcome));
      publicGames.push({...g,status:outcome.status,home_score:outcome.home_score,away_score:outcome.away_score,
        locked:isLocked,sealed:!!lock,missing_models:lock?.missing_models||[],
        // No private human probabilities or rationale before kickoff, including packet.
        forecasts:isLocked&&lock?lock.forecasts.map(fclPublicRow):[],lock_hash:lock?.forecasts_sha256||null});
    }
    const entrants=[...map.values()],finalCount=publicGames.filter(g=>g.status==='final'&&g.home_score!==g.away_score).length;
    const nextGame=[...games].filter(g=>Date.parse(g.kickoff_at)>now).sort((a,b)=>a.kickoff_at.localeCompare(b.kickoff_at))[0]||null;
    for(const e of entrants) {
      e.next_game_id=nextGame?.game_id||null;
      e.next_game_submitted=!!nextGame && (e.key.startsWith('model:')
        ? modelRows.some(r=>r.game_id===nextGame.game_id&&fclModelKey(r.model_id)===e.key)
        : (seen.get(e.key)||[]).some(r=>fclValidEntry(r,nextGame)));
    }
    const health={...live.health,stale:!live.health?.checked_at||now-Date.parse(live.health.checked_at)>15*60e3,
      last_error:errorData.data && (!live.health?.checked_at||errorData.data.at>live.health.checked_at)?errorData.data:null};
    const data={version:FCL_VERSION,season,health,next_game:nextGame,games:publicGames,models:modelRows,entrants,grades,
      boards:fclBoards(grades,entrants,finalCount),
      rules:{points:'25 - 100 * (p - result)^2',ties:'void',lock:'per game at kickoff',
        archive:'/data/model-receipts.json',live_records:'Worker /forecast/live/nfl/2026',
        crowd:'At least three touched human entries; robust log-odds aggregation, bots excluded. Humans may see model hints; independence is not guaranteed.'}};
    if(url.pathname==='/forecast/packet') {
      const [nfelo,classic]=await Promise.all([fclReadJson('/data/nfelo.json'),fclReadJson('/data/538-classic.json')]);
      data.inputs={nfelo,classic,source_pages:['/data/nfelo.json','/data/538-classic.json','/data/nfl-schedule.json']};
      data.games=data.games.filter(g=>Date.parse(g.kickoff_at)>now && Date.parse(g.kickoff_at)-now<=8*86400e3);
      delete data.grades;delete data.boards;
      data.input_snapshot_id=await sha256hex(JSON.stringify({schedule:schedule.integrity,nfelo:nfelo.data.meta,classic:classic.integrity,models:modelRows}));
    }
    return json({as_of:fclIso(now).slice(0,10),source:'Data Dawgs live NFL forecast store + separately observed NFL results',
      built:fclIso(now),canonical_url:'https://toto.jkapcar4.workers.dev'+url.pathname,data},200,cors);
  }catch(e){return json({error:'Forecast contest unavailable: '+e.message},502,cors);}
}
