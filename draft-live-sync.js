(function(root){
  "use strict";

  function reconcilePicks(existing,incoming){
    /* ⚠️ This used to keep every existing row whose source !== "sleeper", on the
       assumption that the only synced rows were Sleeper's. ESPN rows carry a
       providerPickId but NO source field, so every ESPN pick already in state read
       as "manual", was preserved, and then the same picks were concatenated again
       from the fresh poll — 24 more rows every 4 seconds, unbounded. A live board
       reached 3,984 picks and every team's max bid went five figures negative.
       A manual entry is one with no providerPickId. That is provider-agnostic, and
       it drops the duplicated rows on the first poll after this ships. */
    const manual=(Array.isArray(existing)?existing:[]).filter(p=>p&&!p.providerPickId);
    const unique=new Map();
    (Array.isArray(incoming)?incoming:[]).forEach(p=>{
      if(p&&p.providerPickId&&!unique.has(p.providerPickId)) unique.set(p.providerPickId,p);
    });
    const external=[...unique.values()].sort((a,b)=>(a.pickNo||0)-(b.pickNo||0));
    return manual.concat(external);
  }

  function samePicks(a,b){
    try{return JSON.stringify(a||[])===JSON.stringify(b||[]);}catch(e){return false;}
  }

  if(typeof module!=="undefined"&&module.exports) module.exports={reconcilePicks,samePicks};
  if(typeof window==="undefined") return;

  const page=location.pathname.split("/").pop()||"";
  if(!["dashboard.html","auction.html"].includes(page) || new URLSearchParams(location.search).get("embed")==="1") return;

  let timer=null,failures=0,running=false,started=false,lastOK=0,lastError="",draftComplete=false;

  function league(){ return root.DDLeague&&DDLeague.current; }
  /* ESPN joins on the same terms as Sleeper: a live-read league whose picks this
     device may poll. ESPN has no separate draftId — the league id is the draft. */
  function providerOf(){ const L=league(); return L&&L.provider&&L.provider.name||""; }
  function enabled(){
    const L=league();
    if(!L||L.provider.syncMode!=="live-read") return false;
    if(L.provider.name==="sleeper") return !!L.provider.draftId;
    if(L.provider.name==="espn") return !!L.provider.leagueId;
    return false;
  }
  function providerLabel(){ return providerOf()==="espn" ? "ESPN" : "Sleeper"; }
  function stateKey(){ return DDLeague.storageKey("dd-auction-v1"); }
  function readState(){ try{return JSON.parse(localStorage.getItem(stateKey())||"null");}catch(e){return null;} }

  function mount(){
    if(!enabled() && !document.getElementById("ddExternalSync")) return;
    let panel=document.getElementById("ddExternalSync");
    if(!panel){
      const style=document.createElement("style");
      style.textContent="#ddExternalSync{position:fixed;z-index:9997;right:12px;bottom:58px;max-width:min(360px,calc(100vw - 24px));padding:9px 11px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:rgba(20,19,17,.94);color:#f6f1e7;box-shadow:0 5px 24px rgba(0,0,0,.28);font:650 12px/1.35 system-ui,sans-serif}#ddExternalSync .ddes-top{display:flex;align-items:center;gap:8px}#ddExternalSync .ddes-dot{width:8px;height:8px;border-radius:50%;background:#55c693}#ddExternalSync.err .ddes-dot{background:#eb7777}#ddExternalSync .ddes-msg{flex:1}#ddExternalSync button{margin-top:7px;padding:5px 8px;border:1px solid rgba(255,255,255,.2);border-radius:7px;background:transparent;color:#ff9a55;font:inherit;cursor:pointer}";
      document.head.appendChild(style);
      panel=document.createElement("aside"); panel.id="ddExternalSync";
      panel.innerHTML='<div class="ddes-top"><span class="ddes-dot"></span><span class="ddes-msg"></span></div><button type="button">Take Over Manually</button>';
      panel.querySelector("button").addEventListener("click",takeOver);
      document.body.appendChild(panel);
    }
    renderStatus();
  }

  function renderStatus(){
    const panel=document.getElementById("ddExternalSync"); if(!panel) return;
    const L=league(),unresolved=L&&L.provider.diagnostics&&L.provider.diagnostics.unresolvedMappings||[];
    let message=providerLabel()+" live read-sync";
    if(!enabled()) message=providerLabel()+" sync stopped — manual control";
    else if(running) message="Syncing "+providerLabel()+"…";
    else if(lastError) message=providerLabel()+` unavailable — using local draft state (${lastError})`;
    else if(lastOK) message=`Last synced ${Math.max(0,Math.floor((Date.now()-lastOK)/1000))} sec ago${draftComplete?" · draft complete":""}`;
    if(unresolved.length) message+=` · ${unresolved.length} unmapped`;
    panel.classList.toggle("err",!!lastError);
    panel.querySelector(".ddes-msg").textContent=message;
    panel.querySelector("button").hidden=!enabled();
  }

  function contextFor(L){
    const teamIndexByRoster={},teamIdByRoster={};
    L.config.teams.forEach((team,index)=>{teamIndexByRoster[String(team.providerId)]=index;teamIdByRoster[String(team.providerId)]=team.id;});
    return {draftId:L.provider.draftId,pool:root.DD_POOL||[],teamIndexByRoster,teamIdByRoster};
  }

  function schedule(delay){ clearTimeout(timer); if(enabled()) timer=setTimeout(poll,delay); }

  async function poll(){
    if(running||!enabled()) return;
    running=true;lastError="";mount();
    const L=league();
    try{
      let draft, incoming, unresolvedRows;
      if(providerOf()==="espn"){
        /* The Worker has already normalised these, including the team-index mapping,
           so there is no per-pick player lookup to do here. A pick whose name has not
           landed yet is held back rather than written as a blank row. */
        const res=await DDProviders.espn.fetchPicks();
        draft={status:res.complete?"complete":res.inProgress?"drafting":"ready"};
        incoming=(res.picks||[]).filter(p=>p.player&&Number.isInteger(p.ti)).map(p=>({
          providerPickId:p.providerPickId, player:p.player, pos:p.pos, ti:p.ti,
          price:p.price==null?0:p.price, nfl:p.nfl, keeper:!!p.keeper, mapping:"mapped"
        }));
        /* ⚠️ Before a draft ESPN lists EVERY remaining slot as a pick with playerId "-1"
           and no name. Counting those as unresolved made an undrafted 12-team league
           announce "180 players could not be mapped" — an empty board reported as a
           broken one, and a number that would have sat there shrinking all draft night.
           Only a pick with a real player id and no name is genuinely unresolved. */
        unresolvedRows=(res.picks||[]).filter(p=>!p.player&&p.playerId!=="-1"&&p.playerId!=="0").map(p=>({
          providerPickId:p.providerPickId, playerName:"", position:p.pos||"", nflTeam:p.nfl||""}));
      }else{
      const [d,rawPicks]=await Promise.all([DDProviders.sleeper.fetchDraft(L),DDProviders.sleeper.fetchPicks(L)]);
      draft=d;
      const ctx=contextFor(L);
      incoming=(rawPicks||[]).map(p=>DDProviders.sleeper.normalizePick(p,ctx)).filter(p=>p.player&&Number.isInteger(p.ti));
      }
      const current=readState()||DDLeague.stateFromLeague(L);
      const next=Object.assign({},current,{picks:reconcilePicks(current.picks,incoming),ts:Date.now()});
      const unresolved=unresolvedRows||incoming.filter(p=>p.mapping!=="mapped").map(p=>({providerPickId:p.providerPickId,playerName:p.playerName,position:p.position,nflTeam:p.nflTeam}));
      L.provider.lastSyncedAt=Date.now();L.provider.lastError=null;L.provider.status=draft.status||"ready";
      L.provider.diagnostics=L.provider.diagnostics||{};L.provider.diagnostics.unresolvedMappings=unresolved;
      DDLeague.save(L);
      const changed=!samePicks(current.picks,next.picks);
      if(changed){
        // local state, then same-page UI, then best-effort Firebase mirror
        localStorage.setItem(stateKey(),JSON.stringify(next));
        if(typeof root.DDApplyExternalState==="function") root.DDApplyExternalState(next);
        root.dispatchEvent(new CustomEvent("ddexternalsyncstate",{detail:{state:next}}));
        if(root.DDSync&&DDSync.on) DDSync.push(next);
      }
      failures=0;lastOK=Date.now();draftComplete=draft.status==="complete";running=false;renderStatus();
      schedule(draftComplete?60000:4000);
    }catch(error){
      failures++;lastError=error&&error.message?error.message:"request failed";
      const currentLeague=league();
      if(currentLeague){currentLeague.provider.lastError=lastError;currentLeague.provider.status="stale";DDLeague.save(currentLeague);}
      running=false;
      renderStatus();schedule(Math.min(60000,4000*Math.pow(2,Math.min(failures,4))));
    }
  }

  function takeOver(){
    const L=league(); if(!L) return;
    L.provider.syncMode="manual";L.provider.status="ready";L.provider.lastError=null;
    DDLeague.save(L);clearTimeout(timer);renderStatus();
    const state=readState();if(state&&root.DDSync&&DDSync.on)DDSync.push(state);
    root.dispatchEvent(new CustomEvent("ddexternaltakeover"));
  }

  root.DDExternalSync={get isAuthoritative(){return enabled();},poll,takeOver,warnManual(){mount();const panel=document.getElementById("ddExternalSync");if(panel){panel.classList.add("err");panel.querySelector(".ddes-msg").textContent=providerLabel()+" is authoritative. Use Take Over Manually before recording Data Dawgs picks.";}}};
  const start=()=>{started=true;mount();if(enabled())poll();};
  if(document.readyState==="complete") start(); else addEventListener("load",start,{once:true});
  addEventListener("ddleaguechange",()=>{mount();if(started&&enabled()&&!timer&&!running)poll();});
  setInterval(renderStatus,1000);
})(typeof window!=="undefined"?window:globalThis);
