// SportsGameOdds' free tier for Bozo closes (BOZO_SGO_CLOSE): Kap's order is ESPN free, the
// held agent read, SGO free, then the Odds API backup. SGO is the only free source that
// carries DraftKings alternate numbers and props.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','dawg-bot-worker.js'),'utf8');
const cut=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,a);return source.slice(i,j);};
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','sgo-ncaaf-2026-09-05.json'),'utf8'));
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const gate=()=>{const c={};vm.createContext(c);vm.runInContext(cut('function bozoSgoAllowed(','// Shared 60-second KV cache'),c);return c;};

test('BOZO_SGO_CLOSE opens SportsGameOdds for the close caller only; BOZO_PAID_ODDS still opens all',()=>{
 const {bozoSgoAllowed:ok}=gate();
 assert.equal(ok({BOZO_SGO_CLOSE:'true'},'close'),true);
 for(const caller of ['submit','draft','entry','cfb-market',undefined])assert.equal(ok({BOZO_SGO_CLOSE:'true'},caller),false,String(caller));
 for(const v of ['false',true,'TRUE','',undefined])assert.equal(ok({BOZO_SGO_CLOSE:v},'close'),false,String(v));
 assert.equal(ok({BOZO_PAID_ODDS:'true'},'submit'),true);
 assert.match(fs.readFileSync(path.join(__dirname,'..','wrangler.jsonc'),'utf8'),/"BOZO_SGO_CLOSE": "true"/,'the close switch ships on, in the manifest');
});

function fetchRig(env){
 const urls=[];const c={URL,Number,Date,Object,Set,BOZO_CLOSE_API:'https://api.sportsgameodds.com/v2/events',BOZO_SGO_LEAGUE:{nfl:'NFL',cfb:'NCAAF'},
  bozoOddIds:(m,pd)=>[`points-home-${pd}-${m}-home`,`points-away-${pd}-${m}-away`],
  bozoCaptureOnce:async(_e,_id,work)=>work(),
  bozoSgoRequest:async(_e,url)=>{urls.push(new URL(url));const ev=[];Object.defineProperty(ev,'fetchedAt',{value:'2026-11-08T17:55:00.000Z',configurable:true});return ev;}};
 vm.createContext(c);vm.runInContext(cut('function bozoSgoAllowed(','// Shared 60-second KV cache')+cut('async function bozoFetchEvents(','// Join an ESPN'),c);
 return {fetch:(...a)=>c.bozoFetchEvents(env,...a),urls};
}
test('a close with no stored SGO id asks for the games within 15 minutes of its kickoff',async()=>{
 const kickoff=Date.parse('2026-11-08T18:00:00Z'),r=fetchRig({SGO_KEY:'fixture',BOZO_SGO_CLOSE:'true'});
 await r.fetch('nfl',kickoff,false,['game'],{caller:'close'});
 const u=r.urls[0];
 assert.equal(u.searchParams.get('leagueID'),'NFL');assert.equal(u.searchParams.get('eventID'),null);
 assert.equal(u.searchParams.get('startsAfter'),'2026-11-08T17:45:00.000Z');assert.equal(u.searchParams.get('startsBefore'),'2026-11-08T18:15:00.000Z');
 assert.equal(u.searchParams.get('includeAltLines'),'true','alternate numbers are the point');
 // A prop leg drops the odd-id filter, as before.
 await r.fetch('nfl',kickoff,true,['game'],{caller:'close'});assert.equal(r.urls[1].searchParams.get('oddID'),null);
 // Two legs at one kickoff build one URL, so the receipt and cache share the request.
 await r.fetch('nfl',kickoff,false,['game'],{caller:'close'});assert.equal(r.urls[2].toString(),u.toString());
 // A stored id is still asked by id, with no window.
 await r.fetch('nfl',kickoff,false,['game'],{caller:'close',eventId:'sgo-1'});
 assert.equal(r.urls[3].searchParams.get('eventID'),'sgo-1');assert.equal(r.urls[3].searchParams.get('startsAfter'),null);
 // Any other caller without an id asks nothing, and the close switch never opens it.
 assert.equal((await fetchRig({SGO_KEY:'fixture',BOZO_PAID_ODDS:'true'}).fetch('nfl',kickoff,false,['game'],{caller:'submit'})).length,0);
 await assert.rejects(fetchRig({SGO_KEY:'fixture',BOZO_SGO_CLOSE:'true'}).fetch('nfl',kickoff,false,['game'],{caller:'submit',eventId:'sgo-1'}),e=>e.code==='paid_feeds_off');
});

function quoteRig(events,fail){
 const asked=[];const c={Date,Number,String,Math,Object,Array,JSON,isNaN,BOZO_CLOSE_BOOK:'draftkings',BOZO_SGO_CLOSE_MAX_AGE_MS:15*60000,
  bzAmerican:v=>{const n=Number(v);return Number.isFinite(n)&&Math.abs(n)>=100?Math.round(n):null;},bozoTeamNorm:s=>norm(s),
  bozoFetchEvents:async(...a)=>{asked.push(a);if(fail)throw fail;return events;}};
 vm.createContext(c);
 vm.runInContext([cut('const BOZO_PERIODS = [','/* ---------------- player props ----------------'),cut('function bozoDkOutcome(','/* Resolve one free-text prop'),
  cut('// Join an ESPN-sourced pick','function bozoCanonicalKey('),cut('/* One SportsGameOdds DraftKings close for a leg','async function runBozoCloseCapture(')].join('\n'),c);
 return {c,asked};
}
// Miami at Stanford, Sep 5 2026: Miami -24.5 is DraftKings' main number; -16.5 is an alternate.
function shifted(kickoffIso,ageMs){
 const ev=structuredClone(fixture.data[0]);ev.status.startsAt=kickoffIso;const at=new Date(Date.parse(kickoffIso)-ageMs).toISOString();
 const walk=o=>{if(o&&typeof o==='object')for(const k of Object.keys(o)){if(k==='lastUpdatedAt')o[k]=at;else walk(o[k]);}};walk(ev.odds);return [ev];
}
const kickoffIso='2026-09-05T01:00:00.000Z';
const leg=(over={})=>({lid:'main',key:'a',startMs:Date.parse(kickoffIso),pick:{sport:'cfb',mkt:'spread',side:'Miami',line:16.5,period:'game',game:'Miami @ Stanford',startsAt:kickoffIso,eventId:'401',...over}});
test('an alternate-number spread closes at its exact DraftKings number, both sides, from SGO',async()=>{
 const r=quoteRig(shifted(kickoffIso,8*60000));
 const out=await r.c.bozoSgoCloseQuote({},leg(),{});
 assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.quote.price,-272);assert.equal(out.quote.opp,195);assert.equal(out.quote.line,16.5);
 assert.equal(r.asked[0][5].caller,'close');assert.equal(r.asked[0][5].eventId,undefined,'no stored id: the window query');
});
test('SGO misses are typed and never throw: stale snapshot, number not offered, game missing, provider refusal',async()=>{
 assert.equal((await quoteRig(shifted(kickoffIso,16*60000)).c.bozoSgoCloseQuote({},leg(),{})).code,'stale_snapshot');
 const odd=await quoteRig(shifted(kickoffIso,8*60000)).c.bozoSgoCloseQuote({},leg({line:16}),{});
 assert.equal(odd.ok,false);assert.match(odd.reason,/no two-sided spread market|different number/);
 assert.equal((await quoteRig(shifted(kickoffIso,8*60000)).c.bozoSgoCloseQuote({},leg({game:'Ohio State @ Michigan'}),{})).code,'event_not_matched');
 const refused=await quoteRig([],Object.assign(Error('SGO 429'),{code:'quota_exceeded'})).c.bozoSgoCloseQuote({},leg(),{});
 assert.deepEqual([refused.ok,refused.reason],[false,'allowance used up']);
});

const ledgerKey=(s,w,k)=>`${s}-w${w}-${k}`,iso=ms=>new Date(ms).toISOString(),kickoff=Date.parse('2026-11-08T18:00:00Z');
function cascadeRig({sgo,odds,mkt='spread',leagues={}}){
 const calls={sgo:0,odds:0,once:0},patches=[];
 const t={lid:'main',key:'a',player:'Kap',uid:'u_kap',season:2026,week:9,startMs:kickoff,pick:{sport:'nfl',mkt,eventId:'1',startsAt:iso(kickoff)}};
 const c={SEASON:2026,Date,JSON,console:{log:()=>{}},BOZO_CLOSE_BOOK:'draftkings',ledgerKey,LG:x=>'/bozo/leagues/'+x,
  loadLeagues:async()=>structuredClone(leagues),bozoCloseTargets:async()=>[t],bozoTeamRegistry:async()=>({}),bozoEspnOddsSupports:()=>mkt!=='prop',
  bozoEspnOddsCapture:async()=>({ok:false,code:'line_missing'}),bozoCaptureIdentity:()=>[],
  bozoCaptureOnce:async(_e,_id,work)=>{calls.once++;return work();},
  bozoOddsApiMarkets:p=>p.mkt==='spread'?['spreads','alternate_spreads']:null,
  fbGet:async(_e,k)=>({data:String(k).endsWith('/main')?{week:9,season:2026,picks:{a:t.pick},results:{},ledger:{}}:{}}),
  bozoSame:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
  bozoCloseMutation:(_t,q,reason)=>q?{'results/a/close':q.price,'results/a/closeOpp':q.opp,'results/a/closeSource':q.provider}:{'results/a/closeUnavailableReason':reason},
  bozoGuardedPatch:async(_e,_l,_s,p)=>{patches.push(p);return true;},cfbMarketKV:()=>null,bozoPromoteAgentCloses:async()=>0};
 vm.createContext(c);vm.runInContext(cut('const BOZO_MISSED_CLOSE_GRACE_MS','/* GET /bozo/clv'),c);
 c.bozoSgoCloseQuote=async()=>{calls.sgo++;return sgo;};
 c.bozoOddsApiCapture=async()=>{calls.odds++;return odds||{ok:false,reason:'Odds API refused the key'};};
 c.bozoFetchEvents=async()=>{throw Error('the free path must go through bozoSgoCloseQuote');};
 return {c,calls,patches};
}
const env={SGO_KEY:'k',BOZO_SGO_CLOSE:'true',ODDS_API_KEY:'k'};
const sgoHit={ok:true,quote:{price:-272,opp:195,line:16.5,provider:'sgo',snapshotAt:iso(kickoff-6*60000)}};
test('order: SGO free first; a hit means the Odds API backup is never asked',async()=>{
 const r=cascadeRig({sgo:sgoHit});
 await r.c.runBozoCloseCapture(env,kickoff-7*60000);
 assert.deepEqual(r.calls,{sgo:0,odds:0,once:0},'nothing before the last tick');
 const out=await r.c.runBozoCloseCapture(env,kickoff-2*60000);
 assert.deepEqual(r.calls,{sgo:1,odds:0,once:1});assert.equal(out.captured,1);
 assert.equal(r.patches[0]['results/a/close'],-272);assert.equal(r.patches[0]['results/a/closeSource'],'sgo');
});
test('an SGO miss falls through to the Odds API backup, and the reason keeps both',async()=>{
 const miss={ok:false,code:'quota_exceeded',reason:'allowance used up'};
 let r=cascadeRig({sgo:miss,odds:{ok:true,quote:{price:-270,opp:220,provider:'odds_api'}}});
 let out=await r.c.runBozoCloseCapture(env,kickoff-2*60000);
 assert.deepEqual(r.calls,{sgo:1,odds:1,once:1});assert.equal(out.captured,1);assert.equal(r.patches[0]['results/a/closeSource'],'odds_api');
 r=cascadeRig({sgo:miss});
 await r.c.runBozoCloseCapture(env,kickoff-2*60000);
 assert.match(r.patches[0]['results/a/closeUnavailableReason'],/SportsGameOdds free tier: allowance used up; Odds API backup failed: Odds API refused the key/);
 r=cascadeRig({sgo:miss});
 await r.c.runBozoCloseCapture({SGO_KEY:'k',BOZO_SGO_CLOSE:'true'},kickoff-2*60000);
 assert.equal(r.calls.odds,0,'no key, no backup');assert.match(r.patches[0]['results/a/closeUnavailableReason'],/SportsGameOdds free tier: allowance used up$/);
});
test('a prop leg, which neither ESPN nor the Odds API can price, still gets the SGO free read',async()=>{
 const r=cascadeRig({sgo:{...sgoHit},mkt:'prop'});
 const out=await r.c.runBozoCloseCapture(env,kickoff-2*60000);
 assert.deepEqual(r.calls,{sgo:1,odds:0,once:1});assert.equal(out.captured,1);
});
test('a held agent read still comes first: no SGO and no Odds API call',async()=>{
 const cand={close:-112,closeOpp:-108,readAt:iso(kickoff-30*60000),requestId:'r'.repeat(16)};
 const r=cascadeRig({sgo:sgoHit,leagues:{main:{ledger:{'2026-w9-a':{agentCloseCandidate:cand}}}}});
 await r.c.runBozoCloseCapture(env,kickoff-2*60000);
 assert.deepEqual(r.calls,{sgo:0,odds:0,once:0});
});

test('a day-old SGO exhausted flag is retried; a fresh one still stops the call',async()=>{
 const budget=new Map();let calls=0;
 const c={fbGet:async(_e,k)=>({data:budget.get(k)}),fbPut:async(_e,k,v)=>{budget.set(k,v);return true;},console:{log:()=>{}},Date,URL,TextEncoder,
  crypto:require('node:crypto').webcrypto,AbortController,setTimeout,clearTimeout,Response,
  fetch:async()=>{calls++;return new Response('{"data":[]}');}};
 vm.createContext(c);vm.runInContext(cut('async function bozoSgoFailure(','async function bozoFetchEvents('),c);
 const e={SGO_KEY:'fixture',BOZO_SGO_CLOSE:'true'},url=new URL('https://example.test/events?leagueID=NFL');
 budget.set('/bozoCaptureBudget/sgo',{exhausted:true,at:new Date(Date.now()-3600000).toISOString()});
 await assert.rejects(c.bozoSgoRequest(e,url,{caller:'close'}),x=>x.code==='quota_exceeded');assert.equal(calls,0);
 budget.set('/bozoCaptureBudget/sgo',{exhausted:true,at:new Date(Date.now()-25*3600000).toISOString()});
 assert.equal((await c.bozoSgoRequest(e,url,{caller:'close'})).length,0);assert.equal(calls,1);
 // Same rule as the Odds API's flag: one with no date is treated as old and retried.
 budget.set('/bozoCaptureBudget/sgo',{exhausted:true});
 await c.bozoSgoRequest(e,new URL('https://example.test/events?leagueID=NCAAF'),{caller:'close'});assert.equal(calls,2);
 await assert.rejects(c.bozoSgoRequest(e,url,{caller:'submit'}),x=>x.code==='paid_feeds_off');
});
