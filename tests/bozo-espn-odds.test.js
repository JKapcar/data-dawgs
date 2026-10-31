const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const src=fs.readFileSync('dawg-bot-worker.js','utf8');
const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
const espn=JSON.parse(fs.readFileSync('tests/fixtures/espn-odds-dk-401873024-20261028.json','utf8')).data;
const seed=fs.readFileSync('bozo-team-registry.mjs','utf8').match(/export const BOZO_ESPN_TEAM_SEED = ([\s\S]*);\s*$/)[1];
const start=new Date(Date.now()+3600000).toISOString();
const game={espnEventId:'401873024',startsAt:start,home:{name:'DAL',abbr:'DAL'},away:{name:'ARI',abbr:'ARI'}};
function rig(fetcher=async()=>{throw Error('Unexpected fetch')}) {
 const db=new Map(),versions=new Map(),urls=[];
 const ctx={sha256hex:async s=>require('node:crypto').createHash('sha256').update(s).digest('hex'),selectionKeyOf:p=>[p.eventId,p.mkt,p.side,p.line,p.period].join('|'),fbGet:async(_e,k)=>({data:db.get(k)||null,etag:String(versions.get(k)||0)}),fbPut:async(_e,k,v,tag)=>{if(tag!==undefined&&tag!==String(versions.get(k)||0))return false;db.set(k,structuredClone(v));versions.set(k,(versions.get(k)||0)+1);return true;},Request,Response,URL,AbortController,setTimeout,clearTimeout,Date,fetch:async(u,o)=>{urls.push(String(u));return fetcher(u,o);},console:{log:()=>{}},BOZO_CLOSE_BOOK:'draftkings',SEASON:2026};
 vm.createContext(ctx);vm.runInContext([
 `const BOZO_ESPN_TEAM_SEED=${seed};`,
 cut('const BOZO_GRADEABLE_SPORTS','const ledgerKey'),
 cut('const bzNorm =','/* ---------------- player props'),
 cut('const bzAmerican =','/* Resolve one free-text prop'),
 cut('function bozoMatchEvent(','/* The cron body.'),
 'this.api={bozoBuildTeamRegistry,bozoOddsApiQuote,bozoEspnOddsEvent,bozoEspnOddsCapture,bozoCaptureEntry};',
 ].join('\n'),ctx);
 // The real schedule reader needs KV; the leg's scheduled game is the only input it gives.
 ctx.bozoScheduleDoc=async()=>({games:[game]});
 return {ctx,urls,...ctx.api,entry:(env,p)=>ctx.api.bozoCaptureEntry(env,p,{committed:true}),reg:s=>ctx.api.bozoBuildTeamRegistry(s).aliases};
}
const dal={sport:'nfl',game:'ARI @ DAL',side:'DAL',mkt:'ml',line:0,period:'game',eventId:'401873024',startsAt:start,label:'DAL ML'};
const at=new Date().toISOString();

test('the real ESPN DraftKings row prices both sides of every main market at its exact number',()=>{
 const r=rig(),raw=r.bozoEspnOddsEvent(espn.items[0],game,'401873024',at),reg=r.reg('nfl');
 const q=(p)=>r.bozoOddsApiQuote(raw,{...dal,...p},reg);
 assert.deepEqual([q({}).price,q({}).opp],[-500,380]);
 assert.deepEqual([q({side:'ARI'}).price,q({side:'ARI'}).opp],[380,-500]);
 // Bozo's spread line is points given up: DAL -10.5 lays 10.5, ARI +10.5 takes it.
 assert.deepEqual([q({mkt:'spread',line:10.5}).price,q({mkt:'spread',line:10.5}).opp],[-110,-110]);
 assert.equal(q({mkt:'spread',side:'ARI',line:-10.5}).line,-10.5);
 assert.equal(q({mkt:'total',side:'over',dir:'over',line:47.5}).price,-110);
 assert.ok(q({mkt:'total',side:'over',dir:'over',line:49.5}).reason,'the opening total is not the current number');
 assert.ok(q({mkt:'spread',line:7.5}).reason,'an alternate number never matches the main line');
});
test('capture stamps the fetch time, names ESPN, and reads the right league path',async()=>{
 const r=rig(async()=>Response.json(espn)),now=Date.now();
 const out=await r.bozoEspnOddsCapture({},dal,r.reg('nfl'),{nowMs:now});
 assert.equal(out.ok,true);assert.equal(out.quote.provider,'espn');assert.equal(out.quote.snapshotAt,new Date(now).toISOString());
 assert.equal(r.urls[0],'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/401873024/competitions/401873024/odds');
});
test('no request at or after kickoff, for another book, or without an ESPN id',async()=>{
 const r=rig(async()=>Response.json({items:[{...espn.items[0],provider:{id:'58',name:'ESPN BET'}}]}));
 assert.equal((await r.bozoEspnOddsCapture({},dal,r.reg('nfl'),{nowMs:Date.parse(start)})).code,'window_closed');
 assert.equal((await r.bozoEspnOddsCapture({},{...dal,eventId:'espn-bills'},r.reg('nfl'))).code,'unsupported_market');
 assert.equal(r.urls.length,0);
 assert.equal((await r.bozoEspnOddsCapture({},dal,r.reg('nfl'))).code,'book_missing');
});
test('entry capture verifies from ESPN with no paid request',async()=>{
 let sgo=0;const r=rig(async u=>{if(!String(u).includes('espn.com'))throw Error('paid request');return Response.json(espn);});
 r.ctx.bozoFetchEvents=async()=>{sgo++;throw Error('SGO 429');};
 const out=await r.entry({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'dead-key',SGO_KEY:'quota-spent'},{...dal,typedPrice:-500});
 assert.equal(out.ok,true);assert.equal(out.p.priceSource,'captured');assert.equal(out.p.entryProvider,'espn');
 assert.equal(out.p.providerEventIds.espn,'401873024');assert.equal(out.p.clvEligible,true);
 assert.deepEqual([out.p.price,out.p.priceOpp],[-500,380]);assert.equal(sgo,0);assert.equal(r.urls.length,1);
});
test('an ESPN miss falls through to one paid provider and keeps both attempts',async()=>{
 let sgo=0;const r=rig(async u=>String(u).includes('espn.com')?Response.json(espn):new Response('',{status:401}));
 r.ctx.bozoFetchEvents=async()=>{sgo++;throw Error('SGO 429');};
 const out=await r.entry({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'dead-key'},{...dal,mkt:'spread',line:7.5,label:'DAL -7.5',typedPrice:-150});
 assert.equal(out.p.priceSource,'self');assert.equal(sgo,0);
 assert.deepEqual(Array.from(out.p.captureAttempts,a=>a.provider),['espn','odds_api']);
});
test('the close cron takes ESPN pregame and never calls a paid provider',async()=>{
 const r=rig(async()=>Response.json(espn));let paid=0,patches=[];
 const dbRead=r.ctx.fbGet;
 Object.assign(r.ctx,{
  bozoCloseTargets:async()=>[{pick:dal,key:'kap',player:'Kap',uid:'kap',lid:'main',season:2026,week:8,startMs:Date.parse(start)}],
  bozoOddsApiCapture:async()=>{paid++;return {ok:false};},bozoFetchEvents:async()=>{paid++;throw Error('SGO 429');},
  bozoTeamRegistry:async()=>r.reg('nfl'),ledgerKey:(s,w,k)=>`${s}-w${w}-${k}`,
  fbGet:async(e,path,tag)=>path==='main'?{data:{week:8,season:2026,picks:{kap:dal}}}:path==='main/results/kap'?{data:null}:dbRead(e,path,tag),
  bozoSame:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
  bozoGuardedPatch:async(e,lid,state,patch)=>{patches.push(patch);return true;},LG:l=>l,cfbMarketKV:()=>null,
 });
 vm.runInContext(cut('async function runBozoCloseCapture(','/* GET /bozo/clv?')+'this.runClose=runBozoCloseCapture;',r.ctx);
 const out=await r.ctx.runClose({BOZO_PAID_ODDS:'true',ODDS_API_KEY:'dead-key',SGO_KEY:'quota-spent'},Date.parse(start)-300000);
 assert.equal(out.captured,1);assert.equal(paid,0);
 assert.equal(patches[0]['results/kap/closeSource'],'espn');assert.equal(patches[0]['results/kap/close'],-500);
 assert.equal(patches[0]['results/kap/closeOpp'],380);
});
