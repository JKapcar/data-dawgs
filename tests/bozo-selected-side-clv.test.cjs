const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../bozo-effective-clv.js'),s=fs.readFileSync('dawg-bot-worker.js','utf8');
const cut=(a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
test('selected sides compute signed approximate CLV without stamps or invented prices',()=>{
 const p={price:-200,clvEligible:false,verificationStatus:'unverified'},r={close:-150},before=JSON.stringify([p,r]);
 const out=api.resolve(api.fromPick(p,r));assert.equal(out.kind,'estimated');assert.ok(Math.abs(out.point-(-6.666666666666665))<1e-10);
 assert.match(out.reason,/includes bookmaker margin/);assert.equal(JSON.stringify([p,r]),before);
 for(const close of [null,undefined,0,99,NaN,Infinity])assert.equal(api.resolve(api.fromPick(p,{close})).point,null);
 assert.equal(api.resolve(api.fromPick(p,{close:-200})).point,0);
});
test('server and browser use byte-identical resolver, no duplicate CLV formula',()=>{
 const block=cut('/* BEGIN SHARED BOZO CLV */','/* END SHARED BOZO CLV */');
 assert.ok(block.includes(fs.readFileSync('bozo-effective-clv.js','utf8').trimEnd()));
 assert.match(cut('function royaleApplyLever(','function royaleDecideChop('),/DDEffectiveClv.resolve/);
 assert.match(fs.readFileSync('bozo.html','utf8'),/DDEffectiveClv.resolve\(row\)/);
});
test('cross-book selected-side proxy never becomes paired measured CLV',()=>{
 const out=api.resolve({entryPrice:-200,entryPriceOpp:170,entryBook:'draftkings',closePrice:-150,closePriceOpp:130,closeBook:'fanduel'});
 assert.equal(out.kind,'estimated');assert.match(out.reason,/Cross-book fanduel/);
});
test('Royale compares all losing legs and blocks a missing close instead of choosing from partial coverage',()=>{
 const c={DDEffectiveClv:api};vm.createContext(c);vm.runInContext(cut('function royaleApplyLever(','function royaleDecideChop('),c);
 const picks={a:{price:-200},b:{price:-150}},results={a:{close:-150},b:{close:-200}};
 assert.equal(c.royaleApplyLever(3,['a','b'],picks,results).key,'a');
 assert.equal(c.royaleApplyLever(3,['a','b'],picks,{a:results.a}).blocked,true);
 assert.equal(c.royaleApplyLever(3,['a','b'],picks,{a:{close:-200},b:{close:-150}}).pass,'tie');
});
test('free-only policy rejects every paid Odds API caller even with a key and old enable flag',()=>{
 const c={};vm.createContext(c);vm.runInContext(cut('function bozoOddsApiAllowed(','const BOZO_ODDS_API_REASONS'),c);
 for(const caller of ['close','entry','submit',undefined])assert.equal(c.bozoOddsApiAllowed({ODDS_API_KEY:'fixture',BOZO_PAID_ODDS:'true'},caller),false);
});
test('100000 synthetic selected-side resolutions complete with finite values and no network',()=>{
 const begin=performance.now();let sum=0;
 for(let i=0;i<100000;i++){const out=api.resolve({entryPrice:-100-i%400,closePrice:-110-i%400});assert.equal(out.kind,'estimated');sum+=out.point;}
 assert.ok(Number.isFinite(sum));console.log(JSON.stringify({benchmark:'100000 in-memory CLV resolutions',milliseconds:performance.now()-begin,networkRequests:0,productionCapacityClaim:false}));
});
test('one free lookup across leagues survives failed writes and replays after kickoff without live fetches',async()=>{
 const start=Date.parse('2026-11-08T18:00:00Z'),p={sport:'nfl',eventId:'fixture',mkt:'ml',startsAt:new Date(start).toISOString(),price:-200};
 const leagues=Object.fromEntries(['main','royale'].map(lid=>[lid,{season:2026,week:9,picks:{a:p},results:{}}]));
 const targets=Object.keys(leagues).map(lid=>({lid,key:'a',season:2026,week:9,startMs:start,pick:p}));
 const receipts=new Map();let fetches=0,commit=false,writes=0;
 const c={Date,Map,JSON,console,SEASON:2026,BOZO_CLOSE_STALE_MS:1200000,BOZO_CLOSE_LAST_TICK_MS:300000,BOZO_CLOSE_BOOK:'draftkings',
 loadLeagues:async()=>leagues,bozoMissedCloses:()=>[],bozoPromoteAgentCloses:async()=>{},bozoCloseTargets:async()=>targets,
 bozoTeamRegistry:async()=>({}),bozoCaptureIdentity:()=>['fixture','ml'],sha256hex:async()=> 'fixture-hash',LG:x=>x,ledgerKey:()=> 'row',
 bozoEspnOddsSupports:()=>true,bozoEspnOddsCapture:async()=>{fetches++;return {ok:true,quote:{price:-150,opp:130,snapshotAt:new Date(start-120000).toISOString()}};},
 fbPut:async(_e,k,v)=>{receipts.set(k,v);return true;},fbGet:async(_e,k)=>({data:leagues[k]||receipts.get(k)||null}),
 bozoOddsApiAllowed:()=>false,bozoOddsApiMarkets:()=>null,bozoAgentReadHeld:()=>false,
 bozoCloseMutation:(_t,q)=>q?{'results/a/close':q.price,'results/a/closeOpp':q.opp}:{},bozoSame:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
 bozoGuardedPatch:async()=>{if(commit)writes++;return commit;},cfbMarketKV:()=>null};
 vm.createContext(c);vm.runInContext(cut('async function runBozoCloseCapture(','/* GET /bozo/clv'),c);
 await c.runBozoCloseCapture({},start-120000);assert.equal(fetches,1);assert.equal(writes,0);assert.equal(receipts.size,1);
 commit=true;const out=await c.runBozoCloseCapture({},start+60000);assert.equal(fetches,1);assert.equal(writes,2);assert.equal(out.captured,2);
});
