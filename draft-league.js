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

  let canonicalRequest=null;
  function fetchCanonical(){
    if(canonicalRequest) return canonicalRequest;
    if(!hasWindow || typeof fetch!=="function") return (canonicalRequest=Promise.resolve(null));
    return (canonicalRequest=fetch("data/leagues/pepperoninipples.json")
      .then(r=>r.ok?r.json():Promise.reject(new Error(String(r.status)))).catch(()=>null));
  }

  function seedLegacyLeague(){
    const existing=loadLeague(LEGACY_ROOM);
    if(existing) return Promise.resolve(existing);
    return fetchCanonical().then(record=>record?saveLeague(leagueFromCanonical(record)):null).catch(()=>null);
  }

  /* A FINISHED DRAFT IS NOT ALLOWED TO LIVE ONLY IN THE FIREBASE ROOM. The mirror is
     write-through and unauthenticated: it is one PUT away from being empty, and a phone
     that never had the room open has nothing local either. So the completed auction is
     committed to data/leagues/ as canon, and any rig page can rebuild the whole board
     from it. That is what makes the results readable by every leaguemate rather than by
     whoever happens to still have draft night in localStorage.

     `etr` stays 0 on every rebuilt pick. It means "the value the OPERATOR's page held at
     the moment of the sale", which nobody recorded — and in this room the surfaces read
     DataDawg$ out of the pool by name anyway (see pickVal on the board and the sheet).
     Backfilling today's number into a field that claims to be a sale-time number would
     be inventing evidence. */
  function stateFromCanonical(record){
    const league=leagueFromCanonical(record);
    const state=stateFromLeague(league);
    const draft=(record&&record.draft)||{};
    const at=Date.parse(draft.completed_at||"")||0;
    const slot={};
    league.config.teams.forEach((team,index)=>{ if(team.providerId!=null) slot[team.providerId]=index; });
    state.picks=(Array.isArray(draft.picks)?draft.picks:[])
      .filter(pick=>pick && slot[String(pick.team_id)]!==undefined)
      .map(pick=>({player:String(pick.player||""), pos:String(pick.pos||""), ti:slot[String(pick.team_id)],
        price:Math.max(0,Math.round(Number(pick.price)||0)), keeper:!!pick.keeper,
        etr:0, nfl:pick.nfl||"", ts:at}));
    state.ts=at;
    return state;
  }

  /* What this device held BEFORE any page script ran. draft-league.js loads ahead of the
     page's own code, and that code is local-first: auction.html, finding nothing, builds a
     fresh empty board and saves it stamped now — which is indistinguishable, by timestamp
     alone, from a board somebody deliberately reset. The snapshot keeps the two apart. */
  const stateAtLoad={};
  function snapshotState(){
    if(!hasWindow) return;
    [storageKey("dd-auction-v1", activeLeagueId()), storageKey("dd-auction-v1", LEGACY_ROOM)]
      .forEach(key=>{ if(!(key in stateAtLoad)) stateAtLoad[key]=getJSON(key,null); });
  }

  /* Install the committed results on this device unless the device already holds
     something better. "Better" is deliberately narrow: a state stamped at or after the
     final sale, or one carrying at least as many picks. Both guards matter — the first
     keeps next season's fresh, empty board from being refilled with this year's draft,
     the second keeps a live operator from having their board shrunk mid-sale. */
  function seedPublishedDraft(){
    const id=activeLeagueId();
    if(id && id!==LEGACY_ROOM) return Promise.resolve(null);
    return fetchCanonical().then(record=>{
      if(!record || !record.draft || record.draft.status!=="complete") return null;
      const published=stateFromCanonical(record);
      if(!published.picks.length || !published.ts) return null;
      /* Two keys, one room. The legacy room predates ?league= and still answers on the
         unscoped key, and the dashboard rewrites its own URL to the scoped one mid-load —
         so a page can read whichever of the two the seed did not write. Fill both. */
      const keys=[storageKey("dd-auction-v1", id), storageKey("dd-auction-v1", LEGACY_ROOM)]
        .filter((key,index,all)=>all.indexOf(key)===index);
      let seeded=null, needsReload=false;
      for(const key of keys){
        const local=getJSON(key,null), atLoad=(key in stateAtLoad) ? stateAtLoad[key] : local;
        if(atLoad && (Number(atLoad.ts)||0) >= published.ts) continue;
        if(local && Array.isArray(local.picks) && local.picks.length >= published.picks.length) continue;
        if(!setJSON(key,published)) continue;
        seeded=published;
        // The page already rendered the empty board it just built for itself; a repaint
        // hook is not enough, it has to read the state again from the top.
        if(!atLoad && local && Array.isArray(local.picks) && !local.picks.length) needsReload=true;
        /* Every rig page already repaints on a storage event for this key — that is how the
           embedded views hear the operator. Fire one here so a page that seeded itself
           repaints too: a same-document write raises no storage event on its own. */
        try{ window.dispatchEvent(new StorageEvent("storage",{key,newValue:JSON.stringify(published)})); }catch(e){}
      }
      if(!seeded) return null;
      if(typeof window.DDApplyExternalState==="function"){ try{ window.DDApplyExternalState(published); }catch(e){} }
      window.dispatchEvent(new CustomEvent("ddleagueseed",{detail:{state:published}}));
      // Once, ever, per tab: a reload that somehow finds nothing seeded must not loop.
      if(needsReload && hasWindow){
        let already=false;
        try{ already=!!sessionStorage.getItem("dd-seed-reload"); sessionStorage.setItem("dd-seed-reload","1"); }catch(e){ already=true; }
        if(!already) location.reload();
      }
      return seeded;
    }).catch(()=>null);
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
    const page=location.pathname.split("/").pop();
    const rigPages=new Set(["dashboard.html","auction.html","board.html","bigboard.html","dataviz.html","report.html","master.html"]);
    if(!rigPages.has(page)) return;
    /* The draft rig is a working surface, not a sitewide landing page. The fixed league
       bar and the footer utility strip covered the board on phones and duplicated
       controls the rig already has, so they go: league administration now lives in the
       dashboard's Settings tab.

       ⚠️ TOTO'S LAUNCHER AND THE IDENTITY CHIP STAY. They were briefly hidden here too,
       and neither is duplicated anywhere in the rig — #ddbLaunch is the ONLY way to open
       the assistant, so hiding it made him unreachable on the seven pages he has the most
       to say about. #ddmeChip is worse than unreachable: Toto's own no-identity reply is
       "Tap the 'Who are you?' chip at the bottom-left, then ask again", so hiding it left
       him giving an instruction that could not be followed. Anything hidden here must be
       reachable somewhere else on the same page — that is the whole test. */
    let clean=document.getElementById("ddDraftClean");
    if(!clean){
      clean=document.createElement("style"); clean.id="ddDraftClean";
      clean.textContent="#ddLeagueIndicator,.udfoot{display:none!important}";
      document.head.appendChild(clean);
    }
    const old=document.getElementById("ddLeagueIndicator"); if(old) old.remove();
    const league=DDLeague.current;
    if(!league) return;
    document.documentElement.style.setProperty("--dd-team-count",league.config.teamCount);
    document.documentElement.style.setProperty("--dd-matrix-min",`${30+league.config.teamCount*89}px`);
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
    /* Never let an older envelope overwrite a newer local copy. The subscribers have
       applied this rule for a while (the mirror round-trips ~1s behind the operator);
       first-load hydration did not, so a room left holding a half-finished draft — or
       cleared — could wipe the committed results a device had just seeded. */
    if(state && activeLeagueId()){
      const key = storageKey("dd-auction-v1");
      const local = getJSON(key, null);
      const incoming = Number(envelope.ts) || Number(state.ts) || 0;
      if(!(local && (Number(local.ts)||0) > incoming)) setJSON(key, state);
    }
    return {league,state,ts:envelope.ts || 0};
  }

  const DDLeague = {
    FIREBASE_URL, LEGACY_ROOM, LEAGUE_RE,
    get id(){ return activeLeagueId(); },
    get current(){ const id=activeLeagueId(); return loadLeague(id || LEGACY_ROOM); },
    get isInstance(){ return !!activeLeagueId(); },
    activeLeagueId, generateId, normalize:normalizeLeague, normalizeDraftState, stateFromLeague, stateFromCanonical,
    storageKey, list, remember, save:saveLeague, load:loadLeague, removeLocal,
    createManual, saveState, leagueURL, remoteEndpoint, publishLeague, hydrateEnvelope, mountIndicator, decorateDraftLinks,
    leagueFromCanonical, seedLegacyLeague, seedPublishedDraft
  };

  root.DDLeague = DDLeague;

  if(hasWindow){
    let cachedCfg = null, pushTimer = null, lastState = "", pushSequence = 0;

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
    snapshotState();
    seedLegacyLeague();
    if(rigPages.has(startupPage) || startupPage==="master.html") seedPublishedDraft();

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
      // The production draft rig has one canonical legacy room. A stale dd-sync-v1
      // value from setup/testing must never silently send the auctioneer to another
      // room while the projector reads pepperoninipples. An explicit capability token
      // still wins; local overrides remain available off the production hostname.
      if(!config && location.hostname !== "datadawgs216.com") config = getJSON(LEGACY_SYNC_KEY, null);
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
        const sequence=++pushSequence;
        const attempt=(number,body)=>{
          if(sequence!==pushSequence) return;
          fetch(endpoint,{method:"PUT",body,headers:{"Content-Type":"application/json"}})
            .then(r=>{ if(!r.ok) throw new Error(String(r.status));
              if(sequence!==pushSequence) return;
              lastState=body;
              window.dispatchEvent(new CustomEvent("ddsync",{detail:{ok:true,dir:"up",attempt:number}}));
            })
            .catch(()=>{
              if(sequence!==pushSequence) return;
              window.dispatchEvent(new CustomEvent("ddsync",{detail:{ok:false,dir:"up",attempt:number}}));
              // Keep the newest complete draft queued across venue Wi-Fi drops.
              // A later SOLD supersedes this sequence and starts its own retry clock.
              if(number<8) pushTimer=setTimeout(()=>attempt(number+1,body),Math.min(30000,1000*Math.pow(2,number)));
            });
        };
        pushTimer=setTimeout(()=>{
          let body;
          try{
            const league=DDLeague.current;
            body=JSON.stringify(league ? {ts:now(),league,state} : {ts:now(),state});
          }catch(e){ return; }
          if(body===lastState) return;
          attempt(0,body);
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
    module.exports={activeLeagueId,generateId,normalizeLeague,normalizeDraftState,stateFromLeague,stateFromCanonical,storageKey,LEAGUE_RE,LEAGUE_ID_PATTERN,leagueFromCanonical};
  }
})(typeof window !== "undefined" ? window : globalThis);
