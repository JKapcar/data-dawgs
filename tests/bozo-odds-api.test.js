const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const src=fs.readFileSync('dawg-bot-worker.js','utf8');
const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
const fixture=n=>JSON.parse(fs.readFileSync(`tests/fixtures/odds-api-${n}-20260924.json`,'utf8'));
const bills=fixture('bills'), lions=fixture('lions'), clemson=fixture('clemson'), history=fixture('lions-history');
const seed=fs.readFileSync('bozo-team-registry.mjs','utf8').match(/export const BOZO_ESPN_TEAM_SEED = ([\s\S]*);\s*$/)[1];
function rig(fetcher=async()=>{throw Error('Unexpected fetch')}) {
 const logs=[], ctx={Request,Response,URL,AbortController,setTimeout,clearTimeout,Date,fetch:fetcher,console:{log:(...x)=>logs.push(x)},BOZO_CLOSE_BOOK:'draftkings',SEASON:2026};
 vm.createContext(ctx);vm.runInContext([
 `const BOZO_ESPN_TEAM_SEED=${seed};`,
 cut('const BOZO_GRADEABLE_SPORTS','const ledgerKey'),
 cut('const bzNorm =','/* ---------------- player props'),
 cut('const bzAmerican =','/* Resolve one free-text prop'),
 cut('function bozoMatchEvent(','/* The cron body.'),
 'this.api={bozoBuildTeamRegistry,bozoOddsApiQuote,bozoOddsApiEvent,bozoOddsApiCapture,bozoOddsApiRequest,bozoCaptureEntry,bozoCloseMutation};',
 ].join('\n'),ctx);
 return {ctx,logs,...ctx.api,reg:s=>ctx.api.bozoBuildTeamRegistry(s).aliases};
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
 const out=await r.bozoCaptureEntry({ODDS_API_KEY:'test-key'},{...bp,typedPrice:-259,providerEventIds:{sgo:'forged'}});
 assert.equal(out.ok,true);assert.equal(out.p.priceSource,'captured');assert.equal(out.p.entryProvider,'odds_api');
 assert.equal(out.p.providerEventIds.odds_api,bills.data.id);assert.equal(out.p.providerEventIds.sgo,undefined);
 assert.equal(out.p.entrySnapshotAt,fresh.bookmakers[0].markets[3].last_update);assert.ok(out.p.fairEntry>0);
 assert.equal(calls,2);assert.equal(sgo,0);
});
test('paid-provider failure falls back to SGO and then actionable unverified manual entry',async()=>{
 const r=rig(async()=>new Response('',{status:429}));let sgo=0;
 r.ctx.bozoFetchEvents=async()=>{sgo++;throw Error('SGO 429');};
 const out=await r.bozoCaptureEntry({ODDS_API_KEY:'test-key'},{...bp,typedPrice:-259});
 assert.equal(sgo,1);assert.equal(out.p.priceSource,'self');assert.equal(out.p.clvEligible,false);
 assert.ok(!JSON.stringify(r.logs).includes('test-key'));
});
test('historical retrieval requests a pre-kickoff snapshot; in-play/stale history rejected',async()=>{
 // Shift the real historical response and kickoff together so this tests the close window.
 const h=structuredClone(history.data), start=Date.parse(h.timestamp)+120000;
 const p={...lp,startsAt:new Date(start).toISOString()};h.data.commence_time=p.startsAt;
 let urls=[];const r=rig(async url=>{urls.push(new URL(url));return Response.json(String(url).includes('/odds?')?h:{data:[h.data]});});
 const out=await r.bozoOddsApiCapture({ODDS_API_KEY:'test-key'},p,r.reg('nfl'),{caller:'close',nowMs:start+1000});
 assert.ok(out?.quote);assert.ok(urls.every(u=>u.pathname.includes('/historical/')&&Date.parse(u.searchParams.get('date'))===start-1000));
 h.data.bookmakers[0].markets[0].last_update=new Date(start+1).toISOString();
 assert.equal(await r.bozoOddsApiCapture({ODDS_API_KEY:'test-key'},p,r.reg('nfl'),{caller:'close',nowMs:start+1000}),null);
 h.data.bookmakers[0].markets[0].last_update=new Date(start-16*60000).toISOString();
 assert.equal(await r.bozoOddsApiCapture({ODDS_API_KEY:'test-key'},p,r.reg('nfl'),{caller:'close',nowMs:start+1000}),null);
});
test('cache preserves observation times and excludes credentials; receipt records source at both paths',async()=>{
 let calls=0,stored;const r=rig(async()=>{calls++;return Response.json([bills.data]);});
 r.ctx.caches={default:{match:async req=>{assert.ok(!req.url.includes('test-key'));return stored?.clone();},put:async(req,res)=>{assert.ok(!req.url.includes('apiKey'));stored=res;}}};
 const a=await r.bozoOddsApiRequest({ODDS_API_KEY:'test-key'},'sports/americanfootball_nfl/events',{});
 const b=await r.bozoOddsApiRequest({ODDS_API_KEY:'test-key'},'sports/americanfootball_nfl/events',{});
 assert.equal(calls,1);assert.equal(a.fetchedAt,b.fetchedAt);
 r.ctx.ledgerKey=(s,w,k)=>`${s}-w${w}-${k}`;
 const q=r.bozoOddsApiQuote(bills.data,bp,r.reg('nfl'));
 const patch=r.bozoCloseMutation({pick:bp,key:'pat',player:'Pat',uid:'pat',season:2026,week:3},q,null,'later');
 assert.equal(patch['results/pat/closeSource'],'odds_api');assert.equal(patch['ledger/2026-w3-pat/closeSource'],'odds_api');
 assert.equal(patch['results/pat/closeObservedAt'],q.snapshotAt);
});
test('closing cron uses the backup, writes both receipts, and never fetches live odds after kickoff',async()=>{
 const r=rig();let sgo=0,patches=[],capturedCalls=[];
 const start=Date.parse(bp.startsAt),q=r.bozoOddsApiQuote(bills.data,bp,r.reg('nfl'));
 q.snapshotAt=new Date(start-120000).toISOString();
 Object.assign(r.ctx,{
  bozoCloseTargets:async()=>[{pick:bp,key:'pat',player:'Pat',uid:'pat',lid:'main',season:2026,week:3,startMs:start}],
  bozoOddsApiCapture:async(e,p,reg,opt)=>{capturedCalls.push(opt);return {quote:q};},
  bozoFetchEvents:async()=>{sgo++;throw Error('SGO 429');},
  bozoTeamRegistry:async()=>r.reg('nfl'),ledgerKey:(s,w,k)=>`${s}-w${w}-${k}`,
  fbPatch:async(e,path,patch)=>patches.push(patch),LG:l=>l,cfbMarketKV:()=>null,
 });
 vm.runInContext(cut('async function runBozoCloseCapture(','/* GET /bozo/clv?')+'this.runClose=runBozoCloseCapture;',r.ctx);
 const out=await r.ctx.runClose({ODDS_API_KEY:'test-key'},start+1000);
 assert.equal(out.captured,1);assert.equal(sgo,0);assert.equal(capturedCalls[0].caller,'close');
 assert.equal(patches[0]['results/pat/closeSource'],'odds_api');
 r.ctx.bozoOddsApiCapture=async()=>null;patches=[];
 const missed=await r.ctx.runClose({ODDS_API_KEY:'test-key'},start+1000);
 assert.equal(missed.captured,0);assert.equal(sgo,0);assert.equal(patches.length,0);
});
