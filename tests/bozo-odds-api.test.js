const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const src=fs.readFileSync('dawg-bot-worker.js','utf8');
const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
const fixture=n=>JSON.parse(fs.readFileSync(`tests/fixtures/odds-api-${n}-20260924.json`,'utf8'));
const bills=fixture('bills'), lions=fixture('lions'), clemson=fixture('clemson'), history=fixture('lions-history');
for(const f of [bills,lions,clemson])f.data.commence_time=new Date(Date.now()+3600000).toISOString();
const {buildPick,assertHistorical}=require('./fixtures/bozo-provenance-pipeline.cjs');
const seed=fs.readFileSync('bozo-team-registry.mjs','utf8').match(/export const BOZO_ESPN_TEAM_SEED = ([\s\S]*);\s*$/)[1];
function rig(fetcher=async()=>{throw Error('Unexpected fetch')}) {
 const db=new Map(),versions=new Map();
 const logs=[], ctx={sha256hex:async s=>require('node:crypto').createHash('sha256').update(s).digest('hex'),selectionKeyOf:p=>[p.eventId,p.mkt,p.side,p.line,p.period].join('|'),fbGet:async(_e,k)=>({data:db.get(k)||null,etag:String(versions.get(k)||0)}),fbPut:async(_e,k,v,tag)=>{if(tag!==undefined&&tag!==String(versions.get(k)||0))return false;db.set(k,structuredClone(v));versions.set(k,(versions.get(k)||0)+1);return true;},Request,Response,URL,AbortController,setTimeout,clearTimeout,Date,fetch:fetcher,console:{log:(...x)=>logs.push(x)},BOZO_CLOSE_BOOK:'draftkings',SEASON:2026};
 vm.createContext(ctx);vm.runInContext([
 `const BOZO_ESPN_TEAM_SEED=${seed};`,
 cut('const BOZO_GRADEABLE_SPORTS','const ledgerKey'),
 cut('const bzNorm =','/* ---------------- player props'),
 cut('const bzAmerican =','/* Resolve one free-text prop'),
 cut('function bozoMatchEvent(','/* The cron body.'),
 'this.api={bozoBuildTeamRegistry,bozoOddsApiQuote,bozoOddsApiEvent,bozoOddsApiCapture,bozoOddsApiRequest,bozoOddsApiRequestRaw,bozoCaptureEntry,bozoCloseMutation};',
 ].join('\n'),ctx);
 return {ctx,logs,...ctx.api,bozoCaptureEntry:(env,p)=>ctx.api.bozoCaptureEntry(env,p,{committed:true}),reg:s=>ctx.api.bozoBuildTeamRegistry(s).aliases};
}
const bp={sport:'nfl',game:'LAC @ BUF',side:'BUF',mkt:'spread',line:2.5,startsAt:bills.data.commence_time,eventId:'espn-bills',label:'BUF -2.5'};
const lp={...bp,game:'NYJ @ DET',side:'DET',line:1.5,startsAt:lions.data.commence_time};
test('real DK alternate spreads match BOTH exact sides and preserve inverted Bozo line',()=>{
 const r=rig(),q=r.bozoOddsApiQuote(bills.data,bp,r.reg('nfl'));
 assert.equal(q.price,-259);assert.equal(q.opp,187);assert.equal(q.line,2.5);assert.equal(q.provider,'odds_api');
 const other=r.bozoOddsApiQuote(bills.data,{...bp,side:'LAC',line:-2.5},r.reg('nfl'));
 assert.equal(other.price,187);assert.equal(other.opp,-259);
 assert.ok(r.bozoOddsApiQuote(bills.data,{...bp,line:2},r.reg('nfl')).reason);
 assert.ok(r.bozoOddsApiQuote(bills.data,{...bp,side:'DET'},r.reg('nfl')).reason);
});
test('real CFB names join ESPN abbreviations, exact totals orient correctly, periods stay unsupported',()=>{
 const r=rig();const q=r.bozoOddsApiQuote(clemson.data,{sport:'cfb',mkt:'ml',side:'CLEM',line:0},r.reg('cfb'));
 assert.equal(q.price,-112);assert.equal(q.opp,-108);
 for(const [dir,price,opp] of [['over',-204,151],['under',151,-204]]) {
  const q=r.bozoOddsApiQuote(bills.data,{...bp,mkt:'total',dir,line:45.5},r.reg('nfl'));
  assert.equal(q.price,price);assert.equal(q.opp,opp);
 }
 assert.ok(r.bozoOddsApiQuote(bills.data,{...bp,period:'1h'},r.reg('nfl')).reason);
 const broken=structuredClone(bills.data);broken.bookmakers[0].markets.find(x=>x.key==='alternate_spreads').outcomes=broken.bookmakers[0].markets.find(x=>x.key==='alternate_spreads').outcomes.filter(x=>!(x.name==='Los Angeles Chargers'&&x.point===2.5));
 assert.ok(r.bozoOddsApiQuote(broken,bp,r.reg('nfl')).reason);
});
test('entry integration uses paid source without SGO, strips forged receipt, keeps timestamps and exact quote',async()=>{
 let calls=0,sgo=0;
 const fresh=structuredClone(bills.data);fresh.bookmakers[0].markets.forEach(m=>m.last_update=new Date().toISOString());
 const r=rig(async url=>{calls++;return Response.json(String(url).includes('/odds?')?fresh:[fresh]);});
 r.ctx.bozoFetchEvents=async()=>{sgo++;throw Error('SGO 429');};
 const out=await r.bozoCaptureEntry({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'test-key'},{...bp,typedPrice:-259,providerEventIds:{sgo:'forged'}});
 assert.equal(out.ok,true);assert.equal(out.p.priceSource,'captured');assert.equal(out.p.entryProvider,'odds_api');
 assert.equal(out.p.providerEventIds.odds_api,bills.data.id);assert.equal(out.p.providerEventIds.sgo,undefined);
 assert.equal(out.p.entrySnapshotAt,fresh.bookmakers[0].markets[3].last_update);assert.ok(out.p.fairEntry>0);
 assert.equal(calls,2);assert.equal(sgo,0);
});
test('paid-provider failure stops spending and returns actionable manual entry',async()=>{
 const r=rig(async()=>new Response('',{status:429}));let sgo=0;
 r.ctx.bozoFetchEvents=async()=>{sgo++;throw Error('SGO 429');};
 const out=await r.bozoCaptureEntry({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'test-key'},{...bp,typedPrice:-259});
 assert.equal(sgo,0);assert.equal(out.p.priceSource,'self');assert.equal(out.p.clvEligible,false);
 assert.ok(!JSON.stringify(r.logs).includes('test-key'));
});

test('observed ML capture survives real pick builder, ledger, CLV and historical v2 scorer',async()=>{
 const fresh=structuredClone(clemson.data);fresh.bookmakers[0].markets.forEach(m=>m.last_update=new Date().toISOString());
 const r=rig(async url=>Response.json(String(url).includes('/odds?')?fresh:[fresh]));
 const out=await r.bozoCaptureEntry({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'test-key'},{sport:'cfb',mkt:'ml',side:'CLEM',line:0,
  game:'CLEM @ CAL',eventId:'espn-clemson',startsAt:fresh.commence_time,label:'CLEM ML',typedPrice:-112,entryOppSource:'forged'});
 assert.equal(out.ok,true);assert.equal(out.p.entryOppSource,'captured');assert.equal(out.p.price,-112);assert.equal(out.p.priceOpp,-108);
 const pick=buildPick(out.p);assert.equal(pick.entryOppSource,'captured');
 await assertHistorical(pick,'captured');
 assert.equal(buildPick({...out.p,entryOppSource:undefined}).entryOppSource,null,'old frozen captures are not backfilled');
});
test('historical retrieval is disabled at and after kickoff with zero requests',async()=>{
 let calls=0;const r=rig(async()=>{calls++;throw Error('No historical requests');});
 for(const offset of [0,1000,86400000]){const start=Date.now()-1000;const out=await r.bozoOddsApiCapture({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'fixture'},{...lp,startsAt:new Date(start).toISOString()},r.reg('nfl'),{caller:'close',nowMs:start+offset});assert.equal(out.code,'window_closed');}
 assert.equal(calls,0);
});
test('cache preserves observation times and excludes credentials; receipt records source at both paths',async()=>{
 let calls=0,stored;const r=rig(async()=>{calls++;return Response.json([bills.data]);});
 r.ctx.caches={default:{match:async req=>{assert.ok(!req.url.includes('test-key'));return stored?.clone();},put:async(req,res)=>{assert.ok(!req.url.includes('apiKey'));stored=res;}}};
 const a=await r.bozoOddsApiRequest({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'test-key'},'sports/americanfootball_nfl/events',{});
 const b=await r.bozoOddsApiRequest({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'test-key'},'sports/americanfootball_nfl/events',{});
 assert.equal(calls,1);assert.equal(a.fetchedAt,b.fetchedAt);
 r.ctx.ledgerKey=(s,w,k)=>`${s}-w${w}-${k}`;
 const q=r.bozoOddsApiQuote(bills.data,bp,r.reg('nfl'));
 const patch=r.bozoCloseMutation({pick:bp,key:'pat',player:'Pat',uid:'pat',season:2026,week:3},q,null,'later');
 assert.equal(patch['results/pat/closeSource'],'odds_api');assert.equal(patch['ledger/2026-w3-pat/closeSource'],'odds_api');
 assert.equal(patch['results/pat/closeObservedAt'],q.snapshotAt);
});
test('closing cron uses the backup, writes both receipts, and never fetches live odds after kickoff',async()=>{
 const r=rig();let sgo=0,patches=[],capturedCalls=[];
 const dbRead=r.ctx.fbGet;
 const start=Date.parse(bp.startsAt),q=r.bozoOddsApiQuote(bills.data,bp,r.reg('nfl'));
 q.snapshotAt=new Date(start-120000).toISOString();
 Object.assign(r.ctx,{
  bozoCloseTargets:async()=>[{pick:bp,key:'pat',player:'Pat',uid:'pat',lid:'main',season:2026,week:3,startMs:start}],
  bozoOddsApiCapture:async(e,p,reg,opt)=>{capturedCalls.push(opt);return {ok:true,quote:q};},
  bozoFetchEvents:async()=>{sgo++;throw Error('SGO 429');},
  bozoTeamRegistry:async()=>r.reg('nfl'),ledgerKey:(s,w,k)=>`${s}-w${w}-${k}`,
  fbGet:async(e,path,tag)=>path==='main'?{data:{week:3,season:2026,picks:{pat:bp}}}:path==='main/results/pat'?{data:null}:dbRead(e,path,tag),
  bozoSame:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
  bozoGuardedPatch:async(e,lid,state,patch)=>{patches.push(patch);return true;},LG:l=>l,cfbMarketKV:()=>null,
 });
 vm.runInContext(cut('const BOZO_CLOSE_LAST_TICK_MS','/* GET /bozo/clv?')+'this.runClose=runBozoCloseCapture;',r.ctx);
 const out=await r.ctx.runClose({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'test-key'},start-1000);
 assert.equal(out.captured,1);assert.equal(sgo,0);assert.equal(capturedCalls[0].caller,'close');
 assert.equal(patches[0]['results/pat/closeSource'],'odds_api');
 r.ctx.bozoOddsApiCapture=async()=>null;patches=[];
 const reused=await r.ctx.runClose({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'test-key'},start-500);
 assert.equal(reused.captured,1);assert.equal(sgo,0);assert.equal(capturedCalls.length,1);
 r.ctx.bozoGuardedPatch=async()=>false;
 const conflict=await r.ctx.runClose({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'test-key'},start-400);
 assert.equal(conflict.captured,0);assert.equal(conflict.skipped,1);assert.equal(capturedCalls.length,1);
});

test('first provider failure survives manual fallback without cascading spend',async()=>{
 const r=rig(async()=>Response.json([]));
 r.ctx.bozoFetchEvents=async()=>{throw Object.assign(Error('SGO 429'),{code:'rate_limited'});};
 const out=await r.bozoCaptureEntry({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'fixture'},{...bp,typedPrice:-259});
 assert.equal(out.p.priceSource,'self');
 assert.deepEqual(Array.from(out.p.captureAttempts,a=>a.code),['event_not_matched']);
 assert.match(out.captureWarning,/odds_api: event_not_matched/);
 assert.equal(out.p.captureFailureReason,out.captureWarning);
});
test('provider name fixtures resolve SHSU and both accent spellings of SJSU without merging Ohio State',()=>{
 const r=rig(), reg=r.reg('cfb');
 const rows=JSON.parse(fs.readFileSync('tests/fixtures/bozo-provider-team-names.json','utf8'));
 for(const row of rows) {
   const ev={id:'synthetic',home_team:row.provider,away_team:'Liberty Flames',commence_time:'2026-10-08T23:00:00Z'};
   const pick={game:row.espn+' @ LIB',startsAt:ev.commence_time};
   assert.ok(r.ctx.bozoMatchEvent([r.bozoOddsApiEvent(ev)],pick,reg),row.provider);
 }
 assert.notEqual(reg.ohio,reg.ohiostate);
});
test('all Odds API miss exits are explicit and typed',async()=>{
 const fresh=structuredClone(bills.data);fresh.bookmakers[0].markets.forEach(m=>m.last_update=new Date().toISOString());
 for(const [mode,expected] of [['mismatch','event_mismatch'],['market','market_missing'],['stale','stale_snapshot'],['rate','rate_limited'],['bad','provider_error']]) {
  const data=structuredClone(fresh);
  if(mode==='mismatch')data.home_team='Dallas Cowboys';
  if(mode==='market')data.bookmakers=[];
  if(mode==='stale')data.bookmakers[0].markets.forEach(m=>m.last_update='2020-01-01T00:00:00Z');
  const r=rig(async url=>mode==='rate'?new Response('',{status:429}):mode==='bad'?Response.json({}):Response.json(String(url).includes('/odds?')?data:[fresh]));
  const out=await r.bozoOddsApiCapture({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'fixture'},bp,r.reg('nfl'));
  assert.equal(out.ok,false);assert.equal(out.code,expected);assert.ok(out.reason);
 }
 const r=rig();assert.equal((await r.bozoOddsApiCapture({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'fixture'},bp,r.reg('nfl'),{deadline:Date.now()-1})).code,'timeout');
});

test('canonical event and schedule keys use the UTC day for offset-bearing timestamps',()=>{
 const r=rig(),start='2026-10-08T21:00:00-04:00';
 const expected='cfb|libertyflames~samhoustonbearkats|2026-10-09';
 assert.equal(r.ctx.bozoCanonicalScheduleKey('cfb','SHSU','LIB',start),expected);
 assert.equal(r.ctx.bozoCanonicalKey('cfb',r.bozoOddsApiEvent({home_team:'Liberty Flames',away_team:'Sam Houston Bearkats',commence_time:start}),r.reg('cfb')),expected);
});

test('request diagnostics preserve HTTP status and quota, never response bodies or credential URLs', async()=>{
 for(const status of [401,403,429,500,503]) {
  const r=rig(async()=>new Response('private provider message apiKey=test-key',{status,headers:{'x-requests-remaining':'0'}}));
  await assert.rejects(r.bozoOddsApiRequestRaw({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'test-key'},'sports/americanfootball_ncaaf/events',{}),e=>{
   assert.equal(e.httpStatus,status);assert.equal(e.failureKind,'http_error');
   assert.equal(e.code,status===429?'rate_limited':status===401?'unauthorized':'provider_error');
   assert.equal(e.quota['x-requests-remaining'],0);
   assert.ok(!String(e).includes('test-key'));assert.ok(!JSON.stringify(e).includes('private provider'));
   return true;
  });
 }
});
test('request diagnostics distinguish malformed JSON, network failure and deadline without cache writes', async()=>{
 for(const mode of ['json','network','deadline']) {
  let puts=0;
  const r=rig(async()=>{
   if(mode==='network')throw Object.assign(Error('https://private.invalid/?apiKey=test-key'),{code:'ENOTFOUND'});
   return new Response('not json test-key',{headers:{'x-requests-remaining':'432'}});
  });
  r.ctx.caches={default:{match:async()=>null,put:async()=>{puts++;}}};
  await assert.rejects(r.bozoOddsApiRequestRaw({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'test-key'},'sports/americanfootball_ncaaf/events',{},
   mode==='deadline'?{deadline:Date.now()-1}:{}),e=>{
    assert.equal(e.failureKind,mode==='json'?'invalid_response':mode==='network'?'network_error':'timeout');
    assert.equal(e.httpStatus,mode==='json'?200:undefined);
    assert.equal(e.code,mode==='deadline'?'timeout':'provider_error');
    if(mode==='json')assert.equal(e.quota['x-requests-remaining'],432);
    assert.ok(!String(e).includes('test-key'));assert.ok(!JSON.stringify(e).includes('test-key'));
    return true;
   });
  assert.equal(puts,0);
 }
});
