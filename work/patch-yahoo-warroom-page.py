from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def replace(rel, old, new, sentinel):
    p = ROOT / rel
    s = p.read_bytes().decode("utf-8")
    if sentinel in s:
        print("=", rel, sentinel)
        return
    n = s.count(old)
    assert n == 1, f"{rel}: anchor count {n} for {old[:80]!r}"
    p.write_bytes(s.replace(old, new).encode("utf-8"))
    print("+", rel, sentinel)

# Provider calls: same authenticated/public split as ESPN, but no cookie fields.
replace("draft-providers.js",
'''  /* The Worker already returns the site's league shape, so importing is a rename
     into the envelope the rest of the rig expects rather than a second parse. */''',
'''  /* ---------------- Yahoo public leagues ---------------------------------
     Yahoo's browser API is not used. The Worker reads only server-rendered PUBLIC
     league pages; private leagues fail closed with a clear refusal. */
  async function yahooCall(path, init){
    const fetchImpl=(init&&init.fetch)||root.fetch;
    if(typeof fetchImpl!=="function") throw new Error("Fetch is unavailable.");
    const token=espnSession();
    if(!token) throw new Error("Sign in first — Yahoo is connected to your account, not to this device.");
    const res=await fetchImpl(ESPN_WORKER+path,{
      method:(init&&init.method)||"GET",
      headers:Object.assign({"X-Bozo-Session":token},(init&&init.body)?{"Content-Type":"application/json"}:{}),
      body:(init&&init.body)?JSON.stringify(init.body):undefined
    });
    let data={}; try{data=await res.json()}catch(e){}
    if(!res.ok){const err=new Error(data.error||`Yahoo request failed (${res.status}).`);err.status=res.status;throw err}
    return data;
  }
  function connectYahoo(input,options){
    const leagueId=clean(input&&input.leagueId),teamId=clean(input&&input.teamId);
    if(!/^\\d{1,12}$/.test(leagueId)) return Promise.reject(new Error("That does not look like a Yahoo league id."));
    if(teamId&&!/^\\d{1,4}$/.test(teamId)) return Promise.reject(new Error("That does not look like a Yahoo team id."));
    return yahooCall("/yahoo/connect",{method:"POST",body:{leagueId,teamId:teamId||null},fetch:options&&options.fetch});
  }
  function yahooStatus(options){return yahooCall("/yahoo/connect",{fetch:options&&options.fetch})}
  function disconnectYahoo(options){return yahooCall("/yahoo/connect",{method:"DELETE",fetch:options&&options.fetch})}
  /* A share token is deliberately public. Never send the session header here: doing so
     makes a link work for its owner and fail for every person it was made for. */
  async function yahooPublicCall(path,init){
    const fetchImpl=(init&&init.fetch)||root.fetch;
    if(typeof fetchImpl!=="function") throw new Error("Fetch is unavailable.");
    const res=await fetchImpl(ESPN_WORKER+path,{method:"GET"});
    let data={}; try{data=await res.json()}catch(e){}
    if(!res.ok){const err=new Error(data.error||`Shared Yahoo league request failed (${res.status}).`);err.status=res.status;throw err}
    return data;
  }
  function fetchYahooWarroom(options){
    const share=options&&options.share;
    if(share)return yahooPublicCall("/yahoo/share/"+encodeURIComponent(share),{fetch:options&&options.fetch});
    return yahooCall("/yahoo/warroom",{fetch:options&&options.fetch});
  }
  function yahooShareStatus(options){return yahooCall("/yahoo/share",{fetch:options&&options.fetch})}
  function yahooShareCreate(options){return yahooCall("/yahoo/share",{method:"POST",body:{},fetch:options&&options.fetch})}
  function yahooShareRevoke(options){return yahooCall("/yahoo/share",{method:"DELETE",fetch:options&&options.fetch})}

  /* The Worker already returns the site's league shape, so importing is a rename
     into the envelope the rest of the rig expects rather than a second parse. */''',
"/* ---------------- Yahoo public leagues")

replace("draft-providers.js",
'''    yahoo:{detect:input=>!!parseYahoo(input),parse:parseYahoo},''',
'''    yahoo:{detect:input=>!!parseYahoo(input),parse:parseYahoo,connect:connectYahoo,status:yahooStatus,
      disconnect:disconnectYahoo,warroom:fetchYahooWarroom,
      shareStatus:yahooShareStatus,shareCreate:yahooShareCreate,shareRevoke:yahooShareRevoke},''',
"connect:connectYahoo,status:yahooStatus")

# War Room UI and provider labels.
replace("fantasy-warroom.html",
'''        <input id="leagueInput" inputmode="url" autocomplete="url" placeholder="Sleeper league URL or ID, or an ESPN league URL" aria-label="League URL or Sleeper ID">
        <button class="wr-btn">Add league</button>
      </form>
      <p class="wr-status" id="connectionStatus">Sleeper leagues connect without a Sleeper login. ESPN reads the league you already connected in the <a href="draft-league.html">draft room</a>.</p>
    </div>
    <div class="wr-saved" id="savedList"></div>''',
'''        <input id="leagueInput" inputmode="url" autocomplete="url" placeholder="Sleeper, ESPN, or public Yahoo league URL" aria-label="Fantasy league URL or Sleeper ID">
        <button class="wr-btn">Add league</button>
      </form>
      <p class="wr-status" id="connectionStatus">Sleeper connects directly. Public Yahoo leagues are read without a cookie; their projections come from Sleeper's season feed. ESPN uses the connection in the <a href="draft-leagues.html">draft room</a>.</p>
    </div>
    <div class="wr-saved" id="seededLeague"></div>
    <div class="wr-saved" id="savedList"></div>''',
"id=\"seededLeague\"")

replace("fantasy-warroom.html",
'''function provName(){return state&&state.ref&&state.ref.provider==='espn'?'ESPN':'Sleeper'}''',
'''/* Yahoo supplies rosters and paid prices, not projections. The far side of the
   disagreement chart is Sleeper's season projection for a Yahoo league. */
function provName(){return state&&state.ref&&state.ref.provider==='espn'?'ESPN':'Sleeper'}''',
"Yahoo supplies rosters and paid prices")

replace("fantasy-warroom.html",
'''    const prov=x.provider==='espn'?'espn':'sleeper';''',
'''    const prov=x.provider==='espn'?'espn':x.provider==='yahoo'?'yahoo':'sleeper';''',
"x.provider==='yahoo'?'yahoo'")

replace("fantasy-warroom.html",
'''      <small>${x.provider==='espn'?'ESPN':'Sleeper'} · ${esc(x.leagueId)}${on?' · open now':''}</small>''',
'''      <small>${x.provider==='espn'?'ESPN':x.provider==='yahoo'?'Yahoo':'Sleeper'} · ${esc(x.leagueId)}${on?' · open now':''}</small>''',
"x.provider==='yahoo'?'Yahoo'")

replace("fantasy-warroom.html",
'''/* ⚠️ THE YAHOO ROW IS DELIBERATELY GONE. It rendered the seeded league as
   "settings captured 8/25 · rosters: not connected" beside four working Sleeper leagues and
   a working ESPN one, next to controls that lead nowhere — Yahoo has no read API we can use,
   so it can never produce a roster, a grade or odds. A row that cannot do the thing the page
   is for reads as broken rather than unsupported, so it is not shown at all.
   The league itself is untouched: data/leagues/pepperoninipples.json still exists and
   dashboard.html?league=<dd_id> still opens the rig for anyone holding the link. If Yahoo
   ever gains a read path, restore the row rather than reviving this placeholder. */''',
'''/* The measured public Yahoo room is a permanent starting row, backed by its canonical
   settings file. It opens the live Worker read; the draft rig remains a separate surface. */
fetch('data/leagues/pepperoninipples.json').then(r=>r.ok?r.json():null).then(x=>{
  if(!x||!$('seededLeague'))return;
  $('seededLeague').innerHTML=`<div class="wr-row"><div class="wr-grow"><b>${esc(x.name)}</b>
    <small>Yahoo · ${esc(x.provider_league_id)} · public live read · settings checked ${esc(x.source&&x.source.captured_at?x.source.captured_at.slice(0,10):'')}</small></div>
    <div class="wr-league-actions"><button class="wr-mini" data-load="${esc(x.provider_league_id)}" data-provider="yahoo">Open league</button></div></div>`;
}).catch(()=>{});''',
"public live read · settings checked")

# Portfolio can load any provider; its per-row key must preserve the provider.
replace("fantasy-warroom.html",
'''    return {name:st.league.name,id:st.ref.id,teamName:me.name,teams:st.teams.length,
      grade:letter(z),vor:me.total,rank:rk,odds,st:money.st,bn:money.bn,total:money.total,players:me.players.slice()};''',
'''    return {name:st.league.name,id:st.ref.id,provider:st.ref.provider,teamName:me.name,teams:st.teams.length,
      grade:letter(z),vor:me.total,rank:rk,odds,st:money.st,bn:money.bn,total:money.total,players:me.players.slice()};''',
"provider:st.ref.provider,teamName")

replace("fantasy-warroom.html",
'''  const todo=readShelf().filter(x=>x.provider==='sleeper'&&!LOADED.has(keyOf(x.provider,x.leagueId)));
  let done=0;
  for(const x of todo){
    $('pfStatus').textContent='Reading '+x.name+'… ('+(++done)+' of '+todo.length+')';
    try{const st=await fetchLeague(x.leagueId);await loadDD(st);await loadDraftCapital(st);LOADED.set(keyOf('sleeper',x.leagueId),{state:st,sim:null})}
    catch(e){$('pfStatus').textContent='Could not read '+x.name+': '+e.message}
  }''',
'''  const todo=readShelf().filter(x=>!LOADED.has(keyOf(x.provider,x.leagueId)));
  let done=0;
  for(const x of todo){
    $('pfStatus').textContent='Reading '+x.name+'… ('+(++done)+' of '+todo.length+')';
    try{
      const st=x.provider==='espn'?await fetchLeagueEspn(x.leagueId):x.provider==='yahoo'?await fetchLeagueYahoo(x.leagueId):await fetchLeague(x.leagueId);
      await loadDD(st);await loadDraftCapital(st);LOADED.set(keyOf(x.provider,x.leagueId),{state:st,sim:null});
    }catch(e){$('pfStatus').textContent='Could not read '+x.name+': '+e.message}
  }''',
"const todo=readShelf().filter(x=>!LOADED.has")

replace("fantasy-warroom.html",
'''    const e=LOADED.get(keyOf(x.provider,x.leagueId));return e?leagueRow(e):{name:x.name,id:x.leagueId,unloaded:true};''',
'''    const e=LOADED.get(keyOf(x.provider,x.leagueId));return e?leagueRow(e):{name:x.name,id:x.leagueId,provider:x.provider,unloaded:true};''',
"provider:x.provider,unloaded:true")

replace("fantasy-warroom.html",
'''    +rows.map(r=>r.unloaded?'<tr><td>'+esc(r.name)+'</td><td colspan="5" style="text-align:left;color:var(--ink-3)">not loaded this session</td><td><button class="wr-mini" data-load="'+esc(r.id)+'" data-provider="sleeper">Load</button></td></tr>''',
'''    +rows.map(r=>r.unloaded?'<tr><td>'+esc(r.name)+'</td><td colspan="5" style="text-align:left;color:var(--ink-3)">not loaded this session</td><td><button class="wr-mini" data-load="'+esc(r.id)+'" data-provider="'+esc(r.provider)+'">Load</button></td></tr>''',
"data-provider=\"'+esc(r.provider)+'\"")

replace("fantasy-warroom.html",
'''  loaded.forEach(r=>r.players.forEach(p=>{const k=mvKey(p.name)+'|'+p.pos;if(!held.has(k))held.set(k,{name:p.name,pos:p.pos,mv:withState(LOADED.get(keyOf('sleeper',r.id)).state,()=>mvOf(p,'season')),leagues:[]});held.get(k).leagues.push(r.name)}));''',
'''  loaded.forEach(r=>r.players.forEach(p=>{const k=mvKey(p.name)+'|'+p.pos;if(!held.has(k))held.set(k,{name:p.name,pos:p.pos,mv:withState(LOADED.get(keyOf(r.provider,r.id)).state,()=>mvOf(p,'season')),leagues:[]});held.get(k).leagues.push(r.name)}));''',
"keyOf(r.provider,r.id)")

# Share controls choose the current feed adapter. Public reads never carry a session.
replace("fantasy-warroom.html",
'''/* ⚠️ Sharing is ESPN-only and owner-only. The link reads through the owner's sealed ESPN
   credential, so there is nothing to share for a Sleeper league (its API is already public)
   and nothing to share from inside a shared view. */
async function paintShare(){
  const box=$('shareBox');
  if(!box)return;
  const eligible=!SHARED&&state&&state.ref.provider==='espn'&&window.DDProviders?.espn?.shareStatus;
  box.hidden=!eligible;
  if(!eligible)return;
  let st=null;
  try{ st=await DDProviders.espn.shareStatus(); }catch(e){ return }
  paintShareUrl(st&&st.url?st.url:null);
}''',
'''/* ESPN and Yahoo share through the current account connection. Sleeper needs no token;
   its upstream is already public. Shared readers never receive a session header. */
function shareAdapter(){
  const p=state&&state.ref&&state.ref.provider;
  return p&&(p==='espn'||p==='yahoo')&&window.DDProviders?DDProviders[p]:null;
}
async function paintShare(){
  const box=$('shareBox'),adapter=shareAdapter();
  if(!box)return;
  const eligible=!SHARED&&adapter&&adapter.shareStatus;
  box.hidden=!eligible;
  if(!eligible)return;
  let st=null;
  try{ st=await adapter.shareStatus(); }catch(e){ return }
  paintShareUrl(st&&st.url?st.url:null);
}''',
"function shareAdapter()")

replace("fantasy-warroom.html",
'''    try{ const r=await DDProviders.espn.shareCreate(); paintShareUrl(r.url); }''',
'''    try{ const r=await shareAdapter().shareCreate(); paintShareUrl(r.url); }''',
"shareAdapter().shareCreate()")
replace("fantasy-warroom.html",
'''    try{ await DDProviders.espn.shareRevoke(); paintShareUrl(null); }''',
'''    try{ await shareAdapter().shareRevoke(); paintShareUrl(null); }''',
"shareAdapter().shareRevoke()")

# Yahoo page adapter: intentionally mirrors fetchLeagueEspn's output contract.
replace("fantasy-warroom.html",
'''async function connect(input){''',
'''async function fetchLeagueYahoo(id,share){
  if(!(window.DDProviders&&DDProviders.yahoo&&DDProviders.yahoo.warroom))
    throw Error('This build has no Yahoo War Room adapter.');
  if(!share)await DDProviders.yahoo.connect({leagueId:String(id)});
  const feed=await DDProviders.yahoo.warroom(share?{share:share}:undefined);
  const L=feed.league||{};
  const ref={provider:'yahoo',id:String(id!=null?id:(L.id||''))};
  const pool=(feed.pool||[]).map(p=>({id:String(p.id),name:p.name,pos:p.pos,
    p:(p.p==null||!isFinite(p.p))?null:Number(p.p),
    paid:(p.paid==null||!isFinite(p.paid))?null:Number(p.paid),team:p.team,dd:p.dd}));
  const byId=Object.fromEntries(pool.map(p=>[p.id,p]));
  const teams=(feed.teams||[]).map(t=>({
    id:String(t.id),ownerId:String(t.owner||''),name:t.name,
    players:(t.players||[]).map(pid=>byId[String(pid)]).filter(Boolean),
    starters:new Set((t.starters||[]).map(String))
  }));
  const positions=[];
  (L.slots||[]).forEach(x=>{for(let i=0;i<x.count;i++)positions.push(x.slot==='BENCH'?'BN':x.slot)});
  const ppr=Number(L.scoring&&L.scoring.ppr);
  const league={
    name:L.name||'Yahoo league',league_id:String(L.id||id),season:L.season,
    roster_positions:positions,
    /* Feed fixtures deliberately do not supply scoring_settings. This mapping is the
       source of truth for mvColumn(); losing rec silently unprices the Money tab. */
    scoring_settings:Number.isFinite(ppr)?{rec:ppr}:{},
    settings:{type:0,playoff_teams:L.playoffTeams,playoff_week_start:L.playoffStart}
  };
  const st={ref,league,users:[],slots:slots(positions),pool,teams,schedule:feed.schedule||[],
    horizon:(()=>{
      const saved=(readShelf().find(x=>x.provider==='yahoo'&&x.leagueId===String(id))||{}).horizon||{};
      const ok=v=>v==='season'?v:'season';
      return {report:ok(saved.report),money:ok(saved.money),trades:ok(saved.trades)};
    })(),
    settings:{playoffSpots:Number(L.playoffTeams)||Math.max(2,Math.round(teams.length/3)),
      playoffStart:Number(L.playoffStart)||15,sigma:20},
    defaults:null,diagnostics:feed.diagnostics||null,dd:feed.dd||null};
  st.defaults=JSON.stringify(st.settings);
  return st;
}

async function connect(input){''',
"async function fetchLeagueYahoo(id,share)")

replace("fantasy-warroom.html",
'''  if(ref.provider==='yahoo')throw Error('Yahoo was recognized (league '+ref.id+'), but it has no read API we can use. Sleeper and ESPN are live.');
  if(ref.provider!=='sleeper'&&ref.provider!=='espn')throw Error(ref.provider.toUpperCase()+' is not connected yet.');
  const svc=ref.provider==='espn'?'ESPN':'Sleeper';
  $('connectionStatus').className='wr-status';$('connectionStatus').textContent='Reading '+svc+' league '+ref.id+'…';
  state=ref.provider==='espn'?await fetchLeagueEspn(ref.id):await fetchLeague(ref.id);''',
'''  if(!['sleeper','espn','yahoo'].includes(ref.provider))throw Error(ref.provider.toUpperCase()+' is not connected yet.');
  const svc=ref.provider==='espn'?'ESPN':ref.provider==='yahoo'?'Yahoo':'Sleeper';
  $('connectionStatus').className='wr-status';$('connectionStatus').textContent='Reading '+svc+' league '+ref.id+'…';
  state=ref.provider==='espn'?await fetchLeagueEspn(ref.id):ref.provider==='yahoo'?await fetchLeagueYahoo(ref.id):await fetchLeague(ref.id);''',
"ref.provider==='yahoo'?await fetchLeagueYahoo")

replace("fantasy-warroom.html",
'''async function openShared(token){
  SHARED=token;''',
'''async function openShared(token,provider){
  SHARED=token;
  const sharedProvider=provider==='yahoo'?'yahoo':'espn';''',
"const sharedProvider=provider==='yahoo'")
replace("fantasy-warroom.html",
'''    state=await fetchLeagueEspn(null,token);''',
'''    state=sharedProvider==='yahoo'?await fetchLeagueYahoo(null,token):await fetchLeagueEspn(null,token);''',
"sharedProvider==='yahoo'?await fetchLeagueYahoo")
replace("fantasy-warroom.html",
'''  LOADED.set(keyOf('espn',state.ref.id),{state,sim:null});''',
'''  LOADED.set(keyOf(state.ref.provider,state.ref.id),{state,sim:null});''',
"LOADED.set(keyOf(state.ref.provider,state.ref.id)")
replace("fantasy-warroom.html",
'''  shareBar('<b>Shared league \\u00b7 read-only.</b> '+esc(state.league.name||'ESPN league')''',
'''  shareBar('<b>Shared league \\u00b7 read-only.</b> '+esc(state.league.name||'Fantasy league')''',
"state.league.name||'Fantasy league'")

replace("fantasy-warroom.html",
'''  if(provider==='espn')return 'https://fantasy.espn.com/football/league?leagueId='+id;
  return String(id);''',
'''  if(provider==='espn')return 'https://fantasy.espn.com/football/league?leagueId='+id;
  if(provider==='yahoo')return 'https://football.fantasysports.yahoo.com/f1/'+id;
  return String(id);''',
"if(provider==='yahoo')return 'https://football")

replace("fantasy-warroom.html",
'''  if(share){ if(SHEETS.current==='leagues')SHEETS.show('report'); openShared(share); return }''',
'''  if(share){ if(SHEETS.current==='leagues')SHEETS.show('report'); openShared(share,deepProv); return }''',
"openShared(share,deepProv)")

replace("fantasy-warroom.html",
'''  $('provenance').textContent='Rosters and settings: '+state.ref.provider+' · Projections: '+(state.ref.provider==='espn'?'ESPN season total':'Sleeper season total')+', 2026, spread over the league’s regular season · Seed: '+(sim?.seed??'not run')+' · σ: '+state.settings.sigma+' (generic preseason assumption) · injuries not modeled.';''',
'''  $('provenance').textContent='Rosters and settings: '+state.ref.provider+' · Projections: '+(state.ref.provider==='espn'?'ESPN season total':'Sleeper season total')+(state.ref.provider==='yahoo'?' (Yahoo supplies no projection)':'')+', 2026, spread over the league’s regular season · Seed: '+(sim?.seed??'not run')+' · σ: '+state.settings.sigma+' (generic preseason assumption) · injuries not modeled.';''',
"Yahoo supplies no projection")

# User-visible method and Toto must agree about the new capability and its limit.
replace("fantasy-warroom.html",
'''        <dd>Rest-of-season or per-week projections · ESPN and Yahoo authenticated reads · the man-games replacement''',
'''        <dd>Rest-of-season or per-week projections · private Yahoo league reads · the man-games replacement''',
"private Yahoo league reads")
replace("fantasy-warroom.html",
'''- INPUTS ARE THIRD-PARTY AND FROZEN. Rosters, scoring and schedule come from the provider at the moment of connection. Projections are the provider's own full-season numbers — ESPN's season split, or Sleeper's season projection — unaudited, spread evenly over the league's regular season, and this page produces none of its own. ⚠️ EVERY SIMULATED WEEK REUSES THAT ONE SEASON AVERAGE — no byes, no opponent adjustment, no rest-of-season curve. Say so whenever anyone asks how much the playoff odds are worth.''',
'''- INPUTS ARE THIRD-PARTY AND FROZEN. Rosters, scoring and schedule come from the provider at the moment of connection. Projections are ESPN's own season split for ESPN, and Sleeper's season projection for both Sleeper and Yahoo — Yahoo supplies no projections. On a Yahoo disagreement chart the far side is therefore SLEEPER, never Yahoo. Those inputs are unaudited, spread evenly over the league's regular season, and this page produces none of its own. ⚠️ EVERY SIMULATED WEEK REUSES THAT ONE SEASON AVERAGE — no byes, no opponent adjustment, no rest-of-season curve. Say so whenever anyone asks how much the playoff odds are worth.''',
"On a Yahoo disagreement chart the far side is therefore SLEEPER")
replace("fantasy-warroom.html",
'''- NOT BUILT: ESPN and Yahoo authenticated reads, the man-games baseline, multi-player trades, and Stage 2 playoff re-simulation. Say so plainly rather than describing how to use them.''',
'''- NOT BUILT: private Yahoo league reads, Yahoo write access, the man-games baseline, multi-player trades, and Stage 2 playoff re-simulation. Say so plainly rather than describing how to use them.''',
"private Yahoo league reads, Yahoo write access")

# Draft-leagues gets a real Yahoo account connection, not an import placeholder.
replace("draft-leagues.html",
'''    <section class="card">
      <h2>Connect League</h2>''',
'''    <section class="card">
      <h2>Connect Yahoo</h2>
      <form id="yahooForm">
        <div class="form-grid">
          <div><label for="yahooLeagueId">Yahoo league id</label><input id="yahooLeagueId" inputmode="numeric" placeholder="773763" required></div>
          <div><label for="yahooTeamId">Your team id <span class="muted">(optional)</span></label><input id="yahooTeamId" inputmode="numeric" placeholder="1"></div>
        </div>
        <p class="notice">Public leagues only. The Worker reads Yahoo's server-rendered pages without a cookie or API key. A private league is refused rather than partially imported.</p>
        <p><button class="primary" type="submit">Connect Yahoo</button>
           <button type="button" id="yahooDisconnect" hidden>Disconnect</button></p>
        <div class="notice" id="yahooMsg" aria-live="polite">Yahoo is connected to your Data Dawgs account, not to this device, so sign in first.</div>
      </form>
    </section>

    <section class="card">
      <h2>Connect League</h2>''',
"id=\"yahooForm\"")

replace("draft-leagues.html",
'''        <input id="providerUrl" inputmode="url" placeholder="Sleeper league URL (Yahoo and ESPN: set up manually)">
        <p><button type="submit">Recognize League</button></p>
        <div class="notice" id="connectMsg">Sleeper leagues import through its public read-only API — teams, roster slots, scoring and live picks. Yahoo and ESPN have no public read API we can use, so a link from either is recognised but not imported: build those leagues manually above.</div>''',
'''        <input id="providerUrl" inputmode="url" placeholder="Sleeper or public Yahoo league URL (ESPN: form above)">
        <p><button type="submit">Recognize League</button></p>
        <div class="notice" id="connectMsg">Sleeper imports into the draft rig. A public Yahoo URL connects the live War Room; Yahoo write access and private-league reads are not available. ESPN uses the form above.</div>''',
"A public Yahoo URL connects the live War Room")

replace("draft-leagues.html",
'''    if(ref.provider==="yahoo"){ $("connectMsg").className="notice"; $("connectMsg").textContent="Yahoo connection isn't configured on this deployment yet."; return; }''',
'''    if(ref.provider==="yahoo"){
      $("connectMsg").className="notice"; $("connectMsg").textContent="Checking Yahoo's public league page…";
      try{await DDProviders.yahoo.connect({leagueId:ref.id});location.href="fantasy-warroom.html?provider=yahoo&league="+encodeURIComponent(ref.id)}
      catch(error){$("connectMsg").className="notice err";$("connectMsg").textContent=error&&error.message?error.message:"Yahoo is unavailable right now."}
      return;
    }''',
"Checking Yahoo's public league page")
replace("draft-leagues.html",
'''    if(ref.provider==="espn"){ $("connectMsg").className="notice"; $("connectMsg").textContent="ESPN automatic import is unavailable for this league. Create this league manually for now."; return; }''',
'''    if(ref.provider==="espn"){ $("connectMsg").className="notice"; $("connectMsg").textContent="Use the Connect ESPN form above; it supports public and private ESPN leagues."; return; }''',
"Use the Connect ESPN form above")

replace("draft-leagues.html",
'''  /* ---- ESPN ---------------------------------------------------------------
     The credentials the human types go straight to the Worker and are not kept''',
'''  /* ---- Yahoo -------------------------------------------------------------- */
  const yahooMsg=(text,kind)=>{const el=$("yahooMsg");el.className="notice"+(kind?" "+kind:"");el.textContent=text};
  async function yahooRefreshStatus(){
    if(!(window.DDProviders&&DDProviders.yahoo&&DDProviders.yahoo.status))return;
    try{const st=await DDProviders.yahoo.status();if(st.connected){
      $("yahooDisconnect").hidden=false;$("yahooLeagueId").value=st.leagueId||"";$("yahooTeamId").value=st.teamId||"";
      yahooMsg(`Connected to public Yahoo league ${st.leagueId}. Press Connect Yahoo to open its live War Room.`,"ok");
    }else $("yahooDisconnect").hidden=true}catch(e){}
  }
  $("yahooForm").addEventListener("submit",async event=>{
    event.preventDefault();const button=event.submitter;button.disabled=true;yahooMsg("Checking Yahoo's public league page…");
    try{const st=await DDProviders.yahoo.connect({leagueId:$("yahooLeagueId").value,teamId:$("yahooTeamId").value});
      $("yahooDisconnect").hidden=false;yahooMsg(`Connected to Yahoo league ${st.leagueId}. Opening the live War Room…`,"ok");
      location.href="fantasy-warroom.html?provider=yahoo&league="+encodeURIComponent(st.leagueId)
    }catch(error){yahooMsg(error&&error.message?error.message:"Yahoo is unavailable right now.","err");button.disabled=false}
  });
  $("yahooDisconnect").addEventListener("click",async()=>{
    try{await DDProviders.yahoo.disconnect();$("yahooDisconnect").hidden=true;yahooMsg("Disconnected. The saved Yahoo league and its share link were removed.","ok")}
    catch(e){yahooMsg(e&&e.message?e.message:"Could not disconnect.","err")}
  });
  yahooRefreshStatus();

  /* ---- ESPN ---------------------------------------------------------------
     The credentials the human types go straight to the Worker and are not kept''',
"const yahooMsg=(text,kind)")

# HELP and MAP are copied into each Toto-enabled page. Change every exact copy together.
help_old = '''CONNECT LEAGUE: paste a Sleeper league URL and press "Recognize League" to import teams and settings. Yahoo and ESPN are not imported this way and are set up by hand. There is a separate "Connect ESPN" form taking an ESPN league id, season and the espn_s2 / SWID cookies.'''
help_new = '''CONNECT LEAGUE: paste a Sleeper league URL to import teams and settings. A PUBLIC Yahoo league can connect to the live War Room from its numeric league URL with no cookie or API key; private Yahoo leagues are refused. ESPN has a separate form for its league id, season and optional espn_s2 / SWID cookies.'''
map_old = '''rankings.html — the Dog Track: ranking services graded against actual finishes. draft-leagues.html — create or join a draft league, and import a Sleeper league (Yahoo and ESPN are manual). cfb-power.html — CFB conference power curves. radar.html — the radar view.'''
map_new = '''rankings.html — the Dog Track: ranking services graded against actual finishes. draft-leagues.html — create or join a draft league, import Sleeper, connect public Yahoo, or connect ESPN. cfb-power.html — CFB conference power curves. radar.html — the radar view.'''
for p in sorted(ROOT.glob("*.html")):
    s = p.read_bytes().decode("utf-8")
    changed = False
    for old, new, sentinel in ((help_old, help_new, "A PUBLIC Yahoo league can connect"),
                               (map_old, map_new, "import Sleeper, connect public Yahoo")):
        if sentinel in s:
            continue
        if old in s:
            assert s.count(old) == 1, f"{p.name}: sitewide anchor ambiguous"
            s = s.replace(old, new)
            changed = True
    if changed:
        p.write_bytes(s.encode("utf-8"))
        print("+", p.name, "HELP/MAP")

# The shared assistant guard hashes raw bytes. bozo.html arrived with CRLF while the
# other flattened pages use LF, making byte-identical shared blocks appear divergent.
# Normalize only Toto-enabled pages owned by this sitewide patch; content is unchanged.
for p in sorted(ROOT.glob("*.html")):
    raw = p.read_bytes()
    if b"/* ---------- Toto: shared draft assistant" not in raw:
        continue
    normalized = raw.replace(b"\r\n", b"\n")
    if normalized != raw:
        p.write_bytes(normalized)
        print("+", p.name, "LF line endings")

print("page patch complete")
