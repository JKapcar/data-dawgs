(function(root){
  "use strict";

  const FIREBASE_URL = "https://data-dawgs-draft-default-rtdb.firebaseio.com";
  const LEGACY_ROOM = "pepperoninipples";
  const LEAGUE_DIR_KEY = "dd-leagues-v1";
  const LEAGUE_KEY_PREFIX = "dd-league-v2:";
  const LEGACY_SYNC_KEY = "dd-sync-v1";
  // Generation and every draft-league route share this bounded contract. The Worker
  // contract test compares this source string with DRAFT_LEAGUE_ID_PATTERN so neither
  // side can widen or narrow it alone.
  const LEAGUE_ID_PATTERN = "^(dd_[A-Za-z0-9_-]{22,64}|pepperoninipples)$";
  const LEAGUE_RE = new RegExp(LEAGUE_ID_PATTERN);

  const hasWindow = typeof window !== "undefined" && root === window;
  const storage = hasWindow ? window.localStorage : null;
  const now = ()=>Date.now();
  const clone = value=>value == null ? value : JSON.parse(JSON.stringify(value));

  // Firebase Realtime Database omits empty arrays when it serializes an object.
  // Restore the draft-state contract before page code or sync subscribers see it.
  function normalizeDraftState(state){
    if(!state || typeof state !== "object") return state;
    const normalized = clone(state);
    if(normalized.settings && !Array.isArray(normalized.picks)) normalized.picks = [];
    return normalized;
  }

  function getJSON(key, fallback){
    if(!storage) return fallback;
    try{
      const value = JSON.parse(storage.getItem(key));
      return value == null ? fallback : value;
    }catch(e){ return fallback; }
  }

  function setJSON(key, value){
    if(!storage) return false;
    try{ storage.setItem(key, JSON.stringify(value)); return true; }catch(e){ return false; }
  }

  function activeLeagueId(search){
    if(search === undefined) search = hasWindow ? location.search : "";
    try{
      const id = new URLSearchParams(search).get("league") || "";
      return LEAGUE_RE.test(id) ? id : null;
    }catch(e){ return null; }
  }

  function generateId(cryptoImpl){
    const source = cryptoImpl || root.crypto;
    if(!source || typeof source.getRandomValues !== "function"){
      throw new Error("Secure browser randomness is required to create a league.");
    }
    const bytes = new Uint8Array(16);
    source.getRandomValues(bytes);
    return "dd_" + Array.from(bytes, b=>b.toString(16).padStart(2,"0")).join("");
  }

  function normalizeSlot(slot){
    const name = String((slot && slot.slot) || "").trim().toUpperCase();
    const count = Math.max(0, Math.floor(Number(slot && slot.count) || 0));
    return name && count ? {slot:name, count} : null;
  }

  function normalizeLeague(input){
    const source = input || {};
    const config = source.config || {};
    const teams = Array.isArray(config.teams) ? config.teams : [];
    const rosterSlots = (Array.isArray(config.rosterSlots) ? config.rosterSlots : [])
      .map(normalizeSlot).filter(Boolean);
    const scoring = config.scoring || {};
    const provider = source.provider || {};
    const id = LEAGUE_RE.test(source.id || "") ? source.id : generateId();
    return {
      schemaVersion: 2,
      id,
      name: String(source.name || "Untitled League").trim().slice(0,100) || "Untitled League",
      season: Math.max(2000, Math.min(2100, Math.floor(Number(source.season) || new Date().getFullYear()))),
      provider: {
        name: ["manual","sleeper","yahoo","espn"].includes(provider.name) ? provider.name : "manual",
        leagueId: provider.leagueId == null ? null : String(provider.leagueId),
        draftId: provider.draftId == null ? null : String(provider.draftId),
        sourceUrl: provider.sourceUrl || null,
        syncMode: ["manual","config-only","live-read"].includes(provider.syncMode) ? provider.syncMode : "manual",
        status: provider.status || "ready",
        lastSyncedAt: provider.lastSyncedAt || null,
        lastError: provider.lastError || null,
        diagnostics: provider.diagnostics && typeof provider.diagnostics==="object" ? clone(provider.diagnostics) : {unresolvedMappings:[],warnings:[]}
      },
      config: {
        draftType: config.draftType === "snake" ? "snake" : "auction",
        teamCount: Math.max(2, Math.min(32, Math.floor(Number(config.teamCount) || teams.length || 12))),
        budget: config.draftType === "snake" ? null : Math.max(1, Math.floor(Number(config.budget) || 200)),
        rosterSlots: rosterSlots.length ? rosterSlots : [
          {slot:"QB",count:1},{slot:"RB",count:2},{slot:"WR",count:2},
          {slot:"TE",count:1},{slot:"FLEX",count:2},{slot:"DST",count:1},{slot:"BN",count:6}
        ],
        scoring: {
          mode: ["half14","half","full","sf","sfhalf12","custom"].includes(scoring.mode) ? scoring.mode : "custom",
          ppr: Number.isFinite(Number(scoring.ppr)) ? Number(scoring.ppr) : null,
          superflex: !!scoring.superflex,
          raw: scoring.raw && typeof scoring.raw === "object" ? clone(scoring.raw) : {}
        },
        teams: Array.from({length:Math.max(2, Math.min(32, Math.floor(Number(config.teamCount) || teams.length || 12)))}, (_,i)=>{
          const team = teams[i] || {};
          return {
            id: team.id || `team_${i+1}`,
            name: String(team.name || `Team ${i+1}`).trim().slice(0,80) || `Team ${i+1}`,
            owner: ownerName(team.owner),
            providerId: team.providerId == null ? null : String(team.providerId),
            draftSlot: team.draftSlot == null ? null : Number(team.draftSlot)
          };
        })
      },
      raw: source.raw && typeof source.raw === "object" ? clone(source.raw) : undefined
    };
  }

  /* ⚠️ `owner` is a HUMAN-READABLE NAME and nothing else. Sleeper sends a display name,
     but ESPN sends an account GUID — "{1CBEB244-0BFD-4259-AF54-4D364717C1EA}" — and that
     GUID was being written straight into the Firebase mirror, which is anonymously
     readable, and printed next to team names in the rig. It is not a name or an email,
     but it identifies a real person's ESPN account and nothing on our side needs it.
     Drop it at the normalizer so it never reaches storage, the mirror or a payload;
     `providerId` is what the UI actually joins on. */
  const OPAQUE_ID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
  function ownerName(value){
    const v = String(value == null ? "" : value).trim();
    return OPAQUE_ID.test(v) ? "" : v.slice(0,80);
  }

  function leagueFromCanonical(record){
    if(!record || record.canon_version!==1 || record.dd_id!==LEGACY_ROOM) throw new Error("Invalid seeded league record.");
    const slots=record.settings&&record.settings.roster_slots||{};
    return normalizeLeague({
      id:record.dd_id,name:record.name,season:record.season,
      provider:{name:record.provider,leagueId:record.provider_league_id,sourceUrl:record.source&&record.source.url,
        syncMode:"config-only",status:"settings-only",lastSyncedAt:record.source&&record.source.captured_at,
        diagnostics:{unresolvedMappings:[],warnings:(record.diagnostics&&record.diagnostics.missing_inputs)||[]}},
      config:{draftType:record.settings&&record.settings.draft_type,teamCount:record.settings&&record.settings.team_count,
        budget:record.settings&&record.settings.budget,
        rosterSlots:Object.entries(slots).map(([slot,count])=>({slot,count})),
        scoring:{mode:record.settings&&record.settings.scoring&&record.settings.scoring.mode,
          ppr:record.settings&&record.settings.scoring&&record.settings.scoring.ppr,
          raw:record.settings&&record.settings.scoring&&record.settings.scoring.raw||{}},
        teams:(record.teams||[]).map(t=>({id:t.team_id,name:t.name||`Team ${t.team_id}`,owner:t.owner||"",providerId:t.team_id}))},
      raw:{canonical:record}
    });
  }

  function seedLegacyLeague(){
    const existing=loadLeague(LEGACY_ROOM);
    if(existing) return Promise.resolve(existing);
    if(!hasWindow || typeof fetch!=="function") return Promise.resolve(null);
    return fetch("data/leagues/pepperoninipples.json").then(r=>r.ok?r.json():Promise.reject(new Error(String(r.status))))
      .then(record=>saveLeague(leagueFromCanonical(record))).catch(()=>null);
  }

  function stateFromLeague(league){
    const L = normalizeLeague(league);
    const scoring = L.config.scoring.mode === "custom" ? "half" : L.config.scoring.mode;
    return {
      v: 2,
      leagueId: L.id,
      settings: {
        budget: L.config.budget == null ? 200 : L.config.budget,
        spots: L.config.rosterSlots.reduce((sum,s)=>sum+s.count,0),
        scoring,
        scoringConfig: clone(L.config.scoring),
        draftType: L.config.draftType,
        rosterSlots: clone(L.config.rosterSlots),
        timerSecs: 15,
        myTeam: 0,
        announcer: true,
        snark: true,
        voiceName: "",
        teams: L.config.teams.map(t=>({
          id:t.id, name:t.name, owner:t.owner, providerId:t.providerId, draftSlot:t.draftSlot
        }))
      },
      picks: [], nomIdx: 0, timerEnd: 0, projView: "board", queue: [], onBlock: null, ts: now()
    };
  }

  function storageKey(base, id){
    const leagueId = id === undefined ? activeLeagueId() : id;
    return leagueId ? `${base}:${leagueId}` : base;
  }

  function list(){
    const rows = getJSON(LEAGUE_DIR_KEY, []);
    return Array.isArray(rows) ? rows.sort((a,b)=>(b.lastOpened||0)-(a.lastOpened||0)) : [];
  }

  function remember(league){
    const L = normalizeLeague(league);
    const row = {id:L.id,name:L.name,provider:L.provider.name,season:L.season,lastOpened:now()};
    const rows = list().filter(x=>x && x.id !== L.id);
    rows.unshift(row);
    setJSON(LEAGUE_DIR_KEY, rows.slice(0,50));
    return row;
  }

  function saveLeague(league, options){
    const L = normalizeLeague(league);
    setJSON(LEAGUE_KEY_PREFIX + L.id, L);
    if(!options || options.remember !== false) remember(L);
    if(hasWindow) window.dispatchEvent(new CustomEvent("ddleaguechange", {detail:{league:clone(L)}}));
    return L;
  }

  function loadLeague(id){
    if(!LEAGUE_RE.test(id || "")) return null;
    const value = getJSON(LEAGUE_KEY_PREFIX + id, null);
    return value ? normalizeLeague(value) : null;
  }

  function removeLocal(id){
    setJSON(LEAGUE_DIR_KEY, list().filter(x=>x && x.id !== id));
    if(storage){ try{ storage.removeItem(LEAGUE_KEY_PREFIX + id); }catch(e){} }
  }

  function leagueURL(page, id, origin){
    const base = origin || (hasWindow ? location.origin : "https://datadawgs216.com");
    const url = new URL(page || "/dashboard.html", base);
    url.searchParams.set("league", id);
    return url.toString();
  }

  function mountIndicator(){
    if(!hasWindow || new URLSearchParams(location.search).get("embed") === "1") return;
    const league=DDLeague.current;
    let bar=document.getElementById("ddLeagueIndicator");
    if(!bar){
      const style=document.createElement("style");
      style.textContent="#ddLeagueIndicator{position:fixed;z-index:57;right:12px;bottom:12px;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 24px);padding:8px 10px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:rgba(20,19,17,.94);color:#f6f1e7;box-shadow:0 5px 24px rgba(0,0,0,.28);font:700 12px/1.25 system-ui,sans-serif}#ddLeagueIndicator .ddli-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#ddLeagueIndicator .ddli-meta{color:#aaa397;font-weight:600;text-transform:capitalize}#ddLeagueIndicator a{color:#ff8a33;text-decoration:none;white-space:nowrap}@media(max-width:600px){#ddLeagueIndicator .ddli-meta{display:none}}/* The bar owns the bottom strip, so lift the two chips that also live there. `body #id` out-specifies the mobile rule in the page's own #ddbCSS block, which is injected separately and in no guaranteed order relative to this one. */body #ddbLaunch,body #ddmeChip{bottom:58px}@media print{#ddLeagueIndicator{display:none!important}}";
      document.head.appendChild(style);
      bar=document.createElement("aside"); bar.id="ddLeagueIndicator"; document.body.appendChild(bar);
    }
    if(!league){
      bar.innerHTML='<span class="ddli-name">No league selected</span><a href="draft-leagues.html">Choose league</a>';
      return;
    }
    document.documentElement.style.setProperty("--dd-team-count",league.config.teamCount);
    document.documentElement.style.setProperty("--dd-matrix-min",`${30+league.config.teamCount*89}px`);
    const custom=league.config.scoring.mode==="custom" ? " · Custom scoring — verify settings" : "";
    const unresolved=league.provider.diagnostics&&league.provider.diagnostics.unresolvedMappings||[];
    const mapping=unresolved.length ? ` · ${unresolved.length} player${unresolved.length===1?"":"s"} could not be mapped` : "";
    bar.innerHTML=`<span class="ddli-name"></span><span class="ddli-meta"></span><a href="draft-leagues.html">Switch League</a>`;
    bar.querySelector(".ddli-name").textContent=league.name;
    bar.querySelector(".ddli-meta").textContent=`${league.config.teamCount} teams · ${league.provider.name}${custom}${mapping}`;
  }

  function decorateDraftLinks(){
    if(!hasWindow || !DDLeague.id) return;
    /* ⚠️ master.html BELONGS HERE and did not used to. It sets window.DD_POOL, so Toto and
       the "Who are you?" chip take the DRAFT surface there — and with no ?league= on the
       link they resolved against the legacy unscoped keys, which for a league instance is
       an empty team list and an assistant that refuses to answer. It stays out of the
       rigPages picker redirect above: the player pool is worth reading league-free. */
    const pages=new Set(["dashboard.html","auction.html","board.html","bigboard.html","dataviz.html","report.html","master.html"]);
    document.querySelectorAll("a[href]").forEach(anchor=>{
      let url; try{ url=new URL(anchor.getAttribute("href"),location.href); }catch(e){ return; }
      const page=url.pathname.split("/").pop();
      if(url.origin===location.origin && pages.has(page) && !url.searchParams.has("league")){
        url.searchParams.set("league",DDLeague.id);
        anchor.href=url.toString();
      }
    });
  }

  function remoteEndpoint(id){
    return `${FIREBASE_URL}/drafts/${encodeURIComponent(id)}.json`;
  }

  function publishLeague(league, state){
    const L = normalizeLeague(league);
    if(!hasWindow || typeof fetch !== "function") return Promise.resolve(false);
    const body = JSON.stringify({ts:now(),league:L,state:state || stateFromLeague(L)});
    return fetch(remoteEndpoint(L.id), {method:"PUT",body,headers:{"Content-Type":"application/json"}})
      .then(r=>r.ok).catch(()=>false);
  }

  function createManual(input){
    const config = input || {};
    const L = saveLeague(normalizeLeague({
      id: generateId(), name: config.name, season: config.season,
      provider:{name:"manual",syncMode:"manual",status:"ready"},
      config
    }));
    const state = stateFromLeague(L);
    setJSON(storageKey("dd-auction-v1", L.id), state);
    publishLeague(L, state);
    return L;
  }

  function saveState(id,state){
    if(!LEAGUE_RE.test(id||"") || !state || typeof state!=="object") return false;
    return setJSON(storageKey("dd-auction-v1",id),state);
  }

  function hydrateEnvelope(envelope){
    if(!envelope || typeof envelope !== "object") return null;
    let league = null;
    const state = normalizeDraftState(envelope.state || null);
    if(envelope.league) league = saveLeague(envelope.league);
    if(state && activeLeagueId()) setJSON(storageKey("dd-auction-v1"), state);
    return {league,state,ts:envelope.ts || 0};
  }

  const DDLeague = {
    FIREBASE_URL, LEGACY_ROOM, LEAGUE_RE,
    get id(){ return activeLeagueId(); },
    get current(){ const id=activeLeagueId(); return loadLeague(id || LEGACY_ROOM); },
    get isInstance(){ return !!activeLeagueId(); },
    activeLeagueId, generateId, normalize:normalizeLeague, normalizeDraftState, stateFromLeague,
    storageKey, list, remember, save:saveLeague, load:loadLeague, removeLocal,
    createManual, saveState, leagueURL, remoteEndpoint, publishLeague, hydrateEnvelope, mountIndicator, decorateDraftLinks,
    leagueFromCanonical, seedLegacyLeague
  };

  root.DDLeague = DDLeague;

  if(hasWindow){
    let cachedCfg = null, pushTimer = null, lastState = "";

    const startupParams=new URLSearchParams(location.search);
    const startupPage=location.pathname.split("/").pop();
    const rigPages=new Set(["dashboard.html","auction.html","board.html","bigboard.html","dataviz.html","report.html"]);
    /* The picker is only worth showing to someone who has leagues to pick between.
       A phone that has never opened the rig has an EMPTY directory, so bouncing it here
       replaces the board with a create-a-league form — which is what a leaguemate opening
       the live board link on draft night would have got. Let that device through instead:
       seedLegacyLeague() below pulls the canonical league from data/leagues/, which is
       exactly the room they were trying to reach.
       The operator's own machine never hit this, because it has dd-auction-v1 already. */
    if(rigPages.has(startupPage) && !startupParams.has("league") && !startupParams.has("sync") &&
       startupParams.get("embed")!=="1" && !getJSON("dd-auction-v1",null) && list().length){
      const back=location.pathname+location.hash;
      location.replace("draft-leagues.html?return="+encodeURIComponent(back));
    }
    seedLegacyLeague();

    function decodeLegacyToken(token){
      try{
        const padded = String(token).replace(/-/g,"+").replace(/_/g,"/");
        return JSON.parse(atob(padded));
      }catch(e){ return null; }
    }

    function readSyncConfig(){
      if(cachedCfg) return cachedCfg;
      const leagueId = activeLeagueId();
      if(leagueId) return (cachedCfg={url:FIREBASE_URL,room:leagueId,leagueId,isLeague:true});
      let config = null;
      const token = new URLSearchParams(location.search).get("sync");
      if(token){
        config = decodeLegacyToken(token);
        if(config && config.url) setJSON(LEGACY_SYNC_KEY, config);
      }
      if(!config) config = getJSON(LEGACY_SYNC_KEY, null);
      if(!config || !config.url) config = {url:FIREBASE_URL,room:LEGACY_ROOM};
      config.url = String(config.url || "").replace(/\/+$/,"");
      config.room = String(config.room || LEGACY_ROOM).replace(/[.#$\[\]\/]/g,"-");
      return (cachedCfg=config);
    }

    window.DDSync = {
      get config(){ return readSyncConfig(); },
      get on(){ return !!readSyncConfig().url; },
      save(url, room){
        if(activeLeagueId()) return readSyncConfig();
        setJSON(LEGACY_SYNC_KEY,{url:String(url||"").trim().replace(/\/+$/,"") ,room:String(room||LEGACY_ROOM).trim()});
        cachedCfg=null; return readSyncConfig();
      },
      endpoint(){ const c=readSyncConfig(); return c.url ? `${c.url}/drafts/${encodeURIComponent(c.room)}.json` : null; },
      link(page){
        const c=readSyncConfig();
        const target = new URL(page || "board.html?view=live", location.origin + "/");
        if(c.isLeague){ target.searchParams.set("league",c.leagueId); return target.toString(); }
        if(!c.url) return target.toString();
        const token=btoa(JSON.stringify({url:c.url,room:c.room})).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
        target.searchParams.set("sync",token); return target.toString();
      },
      push(state){
        const endpoint=this.endpoint(); if(!endpoint) return;
        clearTimeout(pushTimer);
        pushTimer=setTimeout(()=>{
          let body;
          try{
            const league=DDLeague.current;
            body=JSON.stringify(league ? {ts:now(),league,state} : {ts:now(),state});
          }catch(e){ return; }
          if(body===lastState) return;
          lastState=body;
          fetch(endpoint,{method:"PUT",body,headers:{"Content-Type":"application/json"}})
            .then(r=>{ if(!r.ok) throw new Error(String(r.status)); window.dispatchEvent(new CustomEvent("ddsync",{detail:{ok:true,dir:"up"}})); })
            .catch(()=>window.dispatchEvent(new CustomEvent("ddsync",{detail:{ok:false,dir:"up"}})));
        },500);
      },
      get connected(){
        return !!(this._es && this._es.readyState===1) || now()-(this._lastHeard||0)<30000;
      },
      subscribe(callback){
        const endpoint=this.endpoint(); if(!endpoint) return null;
        const self=this; let source,lastTs=0,retry=0,closed=false;
        const open=()=>{
          if(closed) return;
          try{ source=new EventSource(endpoint); self._es=source; }catch(e){ return; }
          source.addEventListener("open",()=>{ retry=0; self._lastHeard=now(); window.dispatchEvent(new CustomEvent("ddsync",{detail:{ok:true,dir:"down"}})); });
          const handle=event=>{
            self._lastHeard=now();
            let message; try{ message=JSON.parse(event.data); }catch(e){ return; }
            const data=message && message.data;
            if(!data) return;
            if(data.league) saveLeague(data.league);
            const payload=normalizeDraftState(data.state || (data.ts ? null : data));
            const ts=data.ts || now();
            if(!payload || ts<=lastTs) return;
            lastTs=ts;
            window.dispatchEvent(new CustomEvent("ddsync",{detail:{ok:true,dir:"down"}}));
            try{ callback(payload,data); }catch(e){}
          };
          source.addEventListener("put",handle);
          source.addEventListener("patch",handle);
          source.addEventListener("error",()=>{
            try{ source.close(); }catch(e){}
            retry=Math.min(retry+1,6);
            setTimeout(open,1000*retry);
            setTimeout(()=>window.dispatchEvent(new CustomEvent("ddsync",{detail:{ok:self.connected,dir:"down"}})),1200);
          });
        };
        open();
        return ()=>{ closed=true; try{ source.close(); }catch(e){} };
      }
    };

    // The historical sync client is inlined later in each flattened HTML page. Keep the
    // shared implementation authoritative while those duplicated blocks are retired in
    // a separate cleanup; non-strict legacy assignments fail harmlessly.
    try{ Object.defineProperty(window,"DDSync",{value:window.DDSync,writable:false,configurable:false}); }catch(e){}

    const id=activeLeagueId();
    if(id){
      const hadLocalState=!!getJSON(storageKey("dd-auction-v1",id),null);
      const local=loadLeague(id); if(local) remember(local);
      fetch(remoteEndpoint(id)).then(r=>r.ok?r.json():null).then(envelope=>{
        if(!envelope) return;
        hydrateEnvelope(envelope);
        window.dispatchEvent(new CustomEvent("ddleaguehydrate",{detail:{envelope}}));
        // A capability link may be this browser's first contact with the league. Page
        // scripts are intentionally synchronous/local-first, so reload once after the
        // first remote hydration and let them start from the now-local state.
        if(!hadLocalState && envelope.state) location.reload();
      }).catch(()=>{});
    }
    const decorate=()=>{ mountIndicator(); decorateDraftLinks(); };
    if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",decorate);
    else decorate();
    window.addEventListener("ddleaguechange",decorate);
  }

  if(typeof module !== "undefined" && module.exports){
    module.exports={activeLeagueId,generateId,normalizeLeague,normalizeDraftState,stateFromLeague,storageKey,LEAGUE_RE,LEAGUE_ID_PATTERN,leagueFromCanonical};
  }
})(typeof window !== "undefined" ? window : globalThis);
