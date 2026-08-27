(function(root){
  "use strict";

  const WORKER = "https://toto.jkapcar4.workers.dev";
  const SESSION_KEY = "dd-bozo-sess";
  const META_KEY = "dd-draft-sync-v1";
  const KEEPER_KEY = "dd-keepers-v1";
  const LOCAL_MARK_VALUES = Object.freeze(["mine", "taken"]);
  const MARK_TO_WIRE = Object.freeze({ mine:"target", taken:"taken" });
  const WIRE_TO_MARK = Object.freeze({ target:"mine", taken:"taken" });
  const PLAYER_ID_RE=/^[a-z0-9][a-z0-9._:-]{0,63}$/;
  // "lg" is the pepperoninipples league-adjusted column; test-draft-state pins this
  // list to the Worker's DRAFT_SORT_KEYS and the board's sortable COLS — all three move together.
  const SORT_KEYS=Object.freeze(["rank","name","pos","team","half14","full","half","sfhalf12","sf","silva","lg"]);

  function assertMarkMapping(values){
    const actual = values || LOCAL_MARK_VALUES;
    const missing = actual.filter(value=>!Object.prototype.hasOwnProperty.call(MARK_TO_WIRE,value));
    const orphaned = Object.keys(MARK_TO_WIRE).filter(value=>!actual.includes(value));
    if(missing.length || orphaned.length){
      throw new Error("Draft mark wire map is not exhaustive: missing="+missing.join(",")+" orphaned="+orphaned.join(","));
    }
    return true;
  }

  async function playerId(name, cryptoImpl){
    const source=cryptoImpl || root.crypto;
    if(!source || !source.subtle) throw new Error("Web Crypto is required for draft-state player IDs.");
    const normalized=String(name||"").normalize("NFKC").trim().toLowerCase();
    const hash=await source.subtle.digest("SHA-256",new TextEncoder().encode(normalized));
    return "p:"+Array.from(new Uint8Array(hash).slice(0,16),b=>b.toString(16).padStart(2,"0")).join("");
  }

  async function marksToWire(marks, idForName){
    assertMarkMapping(LOCAL_MARK_VALUES);
    const out=[];
    for(const [name,mark] of Object.entries(marks||{})){
      if(mark == null) continue;
      if(!Object.prototype.hasOwnProperty.call(MARK_TO_WIRE,mark))
        throw new Error("Unsupported local draft mark: "+mark);
      out.push({playerId:await idForName(name),mark:MARK_TO_WIRE[mark]});
    }
    return out.sort((a,b)=>a.playerId.localeCompare(b.playerId));
  }

  async function marksFromWire(rows, board, idForName){
    const names=new Map();
    for(const row of board||[]) names.set(await idForName(row.name),row.name);
    const out={};
    for(const row of rows||[]){
      const name=names.get(row.playerId), mark=WIRE_TO_MARK[row.mark];
      if(name && mark) out[name]=mark;
    }
    return out;
  }

  function normalizeKeeperIds(value){
    if(!Array.isArray(value)) return [];
    return [...new Set(value.filter(id=>typeof id==="string"&&PLAYER_ID_RE.test(id)))].sort().slice(0,32);
  }

  function assertSortKeys(values){
    if(JSON.stringify([...(values||[])].sort())!==JSON.stringify([...SORT_KEYS].sort()))
      throw new Error("Draft sort-key contract drifted from the board columns.");
    return true;
  }

  function exactDefault(state){
    return JSON.stringify(state)===JSON.stringify({
      filters:{query:"",position:"ALL",hideTaken:false,taggedOnly:false,sort:{key:"rank",direction:"asc"}},
      marks:[],keeperIds:[]
    });
  }

  class DraftPersonalSync {
    constructor(options){
      this.options=options;
      this.storage=options.storage || root.localStorage;
      this.fetch=options.fetch || root.fetch.bind(root);
      this.timer=null;
      this.saving=false;
      this.pending=false;
      this.retryDelay=1500;
      this.meta=this.readMeta();
    }
    metaKey(){ return this.options.metaKey || `${META_KEY}:${this.options.leagueId}`; }
    readMeta(){
      try{
        const row=JSON.parse(this.storage.getItem(this.metaKey())||"null");
        if(row && Number.isSafeInteger(row.serverVersion) && row.serverVersion>=0 &&
           typeof row.dirty==="boolean" && Number.isSafeInteger(row.editSeq) && row.editSeq>=0) return row;
      }catch(e){}
      return {serverVersion:0,dirty:false,editSeq:0};
    }
    writeMeta(){ try{ this.storage.setItem(this.metaKey(),JSON.stringify(this.meta)); }catch(e){} }
    token(){ try{ return this.storage.getItem(SESSION_KEY)||""; }catch(e){ return ""; } }
    endpoint(){ return `${this.options.worker || WORKER}/auth/draft-state?league_id=${encodeURIComponent(this.options.leagueId)}`; }
    status(value){ if(this.options.onStatus) this.options.onStatus(value); }
    headers(){ return {"X-Bozo-Session":this.token()}; }
    schedule(delay){
      clearTimeout(this.timer);
      this.timer=setTimeout(()=>this.save(false),delay==null?750:delay);
    }
    markDirty(){
      if(!this.token()) return;
      this.meta.editSeq++;
      this.meta.dirty=true;
      this.writeMeta();
      this.status("local only");
      this.schedule(750);
    }
    async start(){
      if(!this.token() || !this.options.leagueId){ this.status("local only"); return false; }
      let local;
      try{ local=await this.options.capture(); }
      catch(e){ this.status("local only"); return false; }
      if(this.storage.getItem(this.metaKey())==null && !exactDefault(local)){
        this.meta.dirty=true;
        this.writeMeta();
      }
      let response, remote;
      try{
        response=await this.fetch(this.endpoint(),{method:"GET",headers:this.headers(),cache:"no-store"});
        remote=await response.json();
      }catch(e){ this.status("local only"); return false; }
      if(!response.ok || !remote || remote.ok!==true){ this.status("local only"); return false; }

      if(this.meta.dirty){
        // Local intent wins only for this private scratchpad. Shared game state uses
        // append-only events and must never copy this whole-replacement policy.
        this.schedule(0);
      }else if(remote.exists){
        try{ await this.options.apply(remote.state); }
        catch(e){ this.status("local only"); return false; }
        this.meta.serverVersion=remote.version;
        this.meta.dirty=false;
        this.writeMeta();
        this.status("synced");
      }else if(!exactDefault(local)){
        this.meta.dirty=true;
        this.writeMeta();
        this.schedule(0);
      }else{
        this.meta.serverVersion=0;
        this.writeMeta();
        this.status("synced");
      }
      return true;
    }
    async save(retried){
      if(!this.meta.dirty || !this.token()) return;
      if(this.saving){ this.pending=true; return; }
      this.saving=true;
      const sentSeq=this.meta.editSeq;
      let state,response,body;
      try{
        state=await this.options.capture();
        response=await this.fetch(this.endpoint(),{
          method:"PUT",
          headers:{...this.headers(),"Content-Type":"application/json"},
          body:JSON.stringify({baseVersion:this.meta.serverVersion,state}),
          cache:"no-store"
        });
        body=await response.json();
      }catch(e){
        this.saving=false;
        this.status("local only");
        this.schedule(this.retryDelay);
        this.retryDelay=Math.min(this.retryDelay*2,30000);
        return;
      }
      if(response.status===409 && body && body.current){
        this.meta.serverVersion=body.current.version;
        this.meta.dirty=true;
        this.writeMeta();
        this.saving=false;
        if(!retried) return this.save(true);
        this.status("local only");
        this.schedule(this.retryDelay);
        this.retryDelay=Math.min(this.retryDelay*2,30000);
        return;
      }
      if(!response.ok || !body || body.ok!==true){
        this.saving=false;
        this.status("local only");
        // A currently deployed pre-Tranche-B Worker returns a permanent route error.
        // Stay local and wait for the next edit/page load rather than polling it forever.
        if(response.status===429 || response.status>=500){
          this.schedule(this.retryDelay);
          this.retryDelay=Math.min(this.retryDelay*2,30000);
        }
        return;
      }
      this.retryDelay=1500;
      this.meta.serverVersion=body.version;
      this.meta.dirty=this.meta.editSeq!==sentSeq;
      this.writeMeta();
      this.saving=false;
      this.status(this.meta.dirty?"local only":"synced");
      if(this.meta.dirty || this.pending){ this.pending=false; this.schedule(0); }
    }
  }

  const api={
    WORKER,SESSION_KEY,META_KEY,KEEPER_KEY,LOCAL_MARK_VALUES,MARK_TO_WIRE,WIRE_TO_MARK,SORT_KEYS,
    assertMarkMapping,assertSortKeys,playerId,marksToWire,marksFromWire,normalizeKeeperIds,exactDefault,
    create:options=>new DraftPersonalSync(options)
  };
  root.DDDraftPersonal=api;
  if(typeof module!=="undefined" && module.exports) module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
