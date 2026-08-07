(function(root){
  "use strict";

  const API="https://api.sleeper.app/v1";
  const numeric=/^\d{6,30}$/;

  function clean(value){ return String(value||"").trim(); }
  function parseURL(value){ try{ return new URL(value); }catch(e){ return null; } }

  function parseSleeper(input){
    const value=clean(input);
    if(numeric.test(value)) return {provider:"sleeper",kind:"league",id:value,sourceUrl:null};
    const url=parseURL(value); if(!url) return null;
    if(!/(^|\.)(sleeper\.com|sleeper\.app)$/.test(url.hostname.toLowerCase())) return null;
    const parts=url.pathname.split("/").filter(Boolean);
    const draftAt=parts.findIndex(x=>x.toLowerCase()==="draft");
    const leagueAt=parts.findIndex(x=>/^leagues?$/i.test(x));
    if(draftAt>=0){
      const id=parts.slice(draftAt+1).find(n=>numeric.test(n));
      return id ? {provider:"sleeper",kind:"draft",id,sourceUrl:value} : null;
    }
    if(leagueAt>=0){
      const id=parts.slice(leagueAt+1).find(n=>numeric.test(n));
      return id ? {provider:"sleeper",kind:"league",id,sourceUrl:value} : null;
    }
    return null;
  }

  function parseYahoo(input){
    const value=clean(input),url=parseURL(value); if(!url || !/(^|\.)yahoo\.com$/.test(url.hostname.toLowerCase())) return null;
    const match=url.pathname.match(/\/f1\/(\d+)/i) || url.pathname.match(/\/league\/([^/]+)/i);
    return match ? {provider:"yahoo",kind:"league",id:match[1],sourceUrl:value} : null;
  }

  function parseEspn(input){
    const value=clean(input),url=parseURL(value); if(!url || !/(^|\.)espn\.com$/.test(url.hostname.toLowerCase())) return null;
    const id=url.searchParams.get("leagueId") || (url.pathname.match(/\/league\/[^/]*\/?(\d+)/i)||[])[1];
    return id && /^\d+$/.test(id) ? {provider:"espn",kind:"league",id,sourceUrl:value} : null;
  }

  function parseProvider(input){ return parseSleeper(input)||parseYahoo(input)||parseEspn(input); }
  function endpoint(path){ return API+path; }
  function getJSON(fetchImpl,path){
    return fetchImpl(endpoint(path),{headers:{Accept:"application/json"}}).then(response=>{
      if(!response.ok) throw new Error(`Sleeper request failed (${response.status}).`);
      return response.json();
    });
  }

  function rosterSlots(positions){
    const aliases={"W/R/T":"FLEX","WRRB_FLEX":"FLEX","REC_FLEX":"FLEX","SUPER_FLEX":"SUPERFLEX","DEF":"DST"};
    const order=[];
    (positions||[]).forEach(raw=>{
      const slot=aliases[raw]||String(raw||"").toUpperCase(); if(!slot) return;
      let row=order.find(x=>x.slot===slot); if(!row){row={slot,count:0};order.push(row);} row.count++;
    });
    return order;
  }

  function scoringConfig(settings,positions){
    const raw=settings&&typeof settings==="object"?settings:{};
    const ppr=Number(raw.rec);
    const superflex=(positions||[]).includes("SUPER_FLEX");
    const unfamiliar=Object.keys(raw).some(key=>/(bonus|premium|first_down|rec_[0-9]|pass_cmp)/i.test(key));
    let mode="custom";
    if(!unfamiliar && superflex && [0,.5,1].includes(ppr)) mode="sf";
    else if(!unfamiliar && ppr===.5) mode="half";
    else if(!unfamiliar && ppr===1) mode="full";
    return {mode,ppr:Number.isFinite(ppr)?ppr:null,superflex,raw};
  }

  function draftSlotFor(roster,draft){
    const owner=String(roster.owner_id||"");
    const order=draft&&draft.draft_order||{};
    if(order[owner]!=null) return Number(order[owner]);
    const slots=draft&&draft.slot_to_roster_id||{};
    const match=Object.keys(slots).find(slot=>String(slots[slot])===String(roster.roster_id));
    return match==null?null:Number(match);
  }

  function normalizeName(name){
    return clean(name).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
      .replace(/\b(jr|sr|ii|iii|iv)\.?$/g,"").replace(/[^a-z0-9]+/g," ").trim();
  }

  function mapPlayer(meta,playerId,pool){
    const name=clean(`${meta.first_name||""} ${meta.last_name||""}`)||clean(meta.player_name||meta.name);
    const pos=clean(meta.position).toUpperCase().replace("DEF","DST");
    const team=clean(meta.team).toUpperCase();
    const candidates=Array.isArray(pool)?pool:[];
    const known=candidates.find(p=>String(p.sleeperId||p.providerId||"")===String(playerId));
    if(known) return {status:"mapped",strategy:"provider-id",player:known,name,pos,team};
    const sameName=candidates.filter(p=>normalizeName(p.name)===normalizeName(name) && String(p.pos||"").toUpperCase().replace("D","DST")===pos);
    const exact=sameName.find(p=>String(p.team||"").toUpperCase()===team);
    if(exact) return {status:"mapped",strategy:"name-position-team",player:exact,name,pos,team};
    if(sameName.length===1) return {status:"mapped",strategy:"name-position",player:sameName[0],name,pos,team};
    return {status:"unresolved",strategy:candidates.length?"no-confident-match":"pool-unavailable",player:null,name,pos,team};
  }

  function normalizePick(pick,context){
    const meta=pick.metadata||{};
    const mapped=mapPlayer(meta,pick.player_id,context.pool);
    const rosterId=String(pick.roster_id==null?"":pick.roster_id);
    const teamIndex=context.teamIndexByRoster[rosterId];
    const amount=pick.amount!=null?pick.amount:meta.amount;
    const price=amount==null||amount===""?null:Number(amount);
    const pickNo=Number(pick.pick_no);
    const providerPickId=`sleeper:${context.draftId}:${pickNo}`;
    return {
      id:providerPickId,source:"sleeper",providerPickId,pickNo,
      round:Number(pick.round)||null,slot:Number(pick.draft_slot)||null,
      teamId:context.teamIdByRoster[rosterId]||null,
      playerId:mapped.player?(mapped.player.id||mapped.player.playerId||mapped.player.name):null,
      playerName:mapped.player?mapped.player.name:mapped.name,
      position:mapped.player?mapped.player.pos:mapped.pos,
      nflTeam:mapped.player?mapped.player.team:mapped.team,
      price:Number.isFinite(price)?price:null,
      timestamp:Number(pick.picked_at)||null,
      mapping:mapped.status,
      mappingStrategy:mapped.strategy,
      player:mapped.player?mapped.player.name:mapped.name,
      pos:mapped.player?mapped.player.pos:mapped.pos,
      ti:Number.isInteger(teamIndex)?teamIndex:null,
      etr:mapped.player?Number(mapped.player.half)||0:0
    };
  }

  function chooseDraft(drafts,ref){
    const rows=Array.isArray(drafts)?drafts:[];
    if(ref.kind==="draft") return rows.find(d=>String(d.draft_id)===ref.id)||null;
    return rows.find(d=>d.status==="drafting") || rows.find(d=>d.status==="pre_draft") || rows.slice().sort((a,b)=>(b.created||0)-(a.created||0))[0] || null;
  }

  function normalizeImport(payload,options){
    const leagueRaw=payload.league||{},users=payload.users||[],rosters=payload.rosters||[],draft=payload.draft||null;
    const userById=Object.fromEntries(users.map(u=>[String(u.user_id),u]));
    const ordered=rosters.slice().sort((a,b)=>(draftSlotFor(a,draft)||999)-(draftSlotFor(b,draft)||999)||(a.roster_id-b.roster_id));
    const teams=ordered.map((roster,index)=>{
      const user=userById[String(roster.owner_id)]||{};
      return {id:`team_${roster.roster_id}`,name:clean(user.metadata&&user.metadata.team_name)||clean(user.display_name)||`Team ${index+1}`,owner:clean(user.display_name),providerId:String(roster.roster_id),draftSlot:draftSlotFor(roster,draft)};
    });
    const draftType=draft&&draft.type==="auction"?"auction":"snake";
    const slots=rosterSlots(leagueRaw.roster_positions);
    const diagnostics={unresolvedMappings:[],warnings:[]};
    const league=root.DDLeague.normalize({
      name:leagueRaw.name||"Sleeper League",season:leagueRaw.season,
      provider:{name:"sleeper",leagueId:leagueRaw.league_id,draftId:draft&&draft.draft_id,sourceUrl:payload.ref.sourceUrl,syncMode:draft?"live-read":"config-only",status:"ready",lastSyncedAt:Date.now(),lastError:null,diagnostics},
      config:{draftType,teamCount:Number(leagueRaw.total_rosters)||teams.length,budget:draftType==="auction"?Number(draft.settings&&draft.settings.budget)||200:null,rosterSlots:slots,scoring:scoringConfig(leagueRaw.scoring_settings,leagueRaw.roster_positions),teams},
      raw:{league:leagueRaw,users,rosters,draft}
    });
    const teamIndexByRoster={},teamIdByRoster={};
    league.config.teams.forEach((team,index)=>{teamIndexByRoster[String(team.providerId)]=index;teamIdByRoster[String(team.providerId)]=team.id;});
    const context={draftId:draft&&draft.draft_id,pool:options&&options.pool,teamIndexByRoster,teamIdByRoster};
    const picks=(payload.picks||[]).map(p=>normalizePick(p,context)).filter(p=>p.player&&Number.isInteger(p.ti));
    diagnostics.unresolvedMappings=picks.filter(p=>p.mapping!=="mapped").map(p=>({providerPickId:p.providerPickId,playerName:p.playerName,position:p.position,nflTeam:p.nflTeam}));
    league.provider.diagnostics=diagnostics;
    const state=root.DDLeague.stateFromLeague(league); state.picks=picks; state.ts=Date.now();
    return {league,state,picks,diagnostics};
  }

  async function importSleeper(ref,options){
    if(!ref || ref.provider!=="sleeper") throw new Error("A Sleeper league or draft URL is required.");
    const fetchImpl=(options&&options.fetch)||root.fetch;
    if(typeof fetchImpl!=="function") throw new Error("Fetch is unavailable.");
    let draftFromRef=null,leagueId=ref.kind==="league"?ref.id:null;
    if(ref.kind==="draft"){
      draftFromRef=await getJSON(fetchImpl,`/draft/${encodeURIComponent(ref.id)}`);
      leagueId=String(draftFromRef.league_id||"");
    }
    if(!leagueId) throw new Error("Sleeper did not identify a league for that draft.");
    const [league,users,rosters,drafts]=await Promise.all([
      getJSON(fetchImpl,`/league/${encodeURIComponent(leagueId)}`),
      getJSON(fetchImpl,`/league/${encodeURIComponent(leagueId)}/users`),
      getJSON(fetchImpl,`/league/${encodeURIComponent(leagueId)}/rosters`),
      getJSON(fetchImpl,`/league/${encodeURIComponent(leagueId)}/drafts`)
    ]);
    let draft=draftFromRef||chooseDraft(drafts,ref);
    if(draft && !draft.draft_order){ try{ draft=await getJSON(fetchImpl,`/draft/${encodeURIComponent(draft.draft_id)}`); }catch(e){} }
    const picks=draft?await getJSON(fetchImpl,`/draft/${encodeURIComponent(draft.draft_id)}/picks`):[];
    return normalizeImport({ref,league,users,rosters,draft,picks},options||{});
  }

  const providers={
    parse:parseProvider,
    sleeper:{detect:input=>!!parseSleeper(input),parse:parseSleeper,importLeague:importSleeper,normalize:normalizeImport,mapPlayer,normalizePick,rosterSlots,scoringConfig},
    yahoo:{detect:input=>!!parseYahoo(input),parse:parseYahoo},
    espn:{detect:input=>!!parseEspn(input),parse:parseEspn}
  };
  root.DDProviders=providers;
  if(typeof module!=="undefined"&&module.exports) module.exports={parseProvider,parseSleeper,parseYahoo,parseEspn,rosterSlots,scoringConfig,mapPlayer,normalizePick,normalizeImport,chooseDraft};
})(typeof window!=="undefined"?window:globalThis);
