const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const worker = fs.readFileSync('dawg-bot-worker.js','utf8');
const page = fs.readFileSync('bozo.html','utf8');
const cut=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const base={sport:'nfl',eventId:'game-1',game:'A @ B',mkt:'ml',side:'B',line:0,label:'B ML',
 startsAt:'2026-09-27T17:00:00.000Z',typedPrice:-150,ts:1790000000000,who:'Pat'};
function rig(){
 let state={week:4,season:2026,status:'placed',picks:{pat:{...base,price:-150,priceSource:'self',verificationStatus:'unverified',entryPriceOpp:null}},
  ledger:{'2026-w4-pat':{player:'Pat',price:-150,priceOpp:null,ts:base.ts,close:-170,closeOpp:145}}};
 let writes=0,deny=false,conflict=false,requests=0,fail='429';
 const kv=new Map(); const env={RL:{get:async k=>kv.get(k),put:async(k,v)=>kv.set(k,v)}};
 const ctx={crypto,console,Date,Request,Response,SEASON:2026,BOZO_CLOSE_BOOK:'draftkings',
  BOZO_GRADEABLE_SPORTS:new Set(['nfl','cfb']),LEAGUE:{nfl:'NFL',cfb:'CFB'},MARKETS:['ml','spread','total','prop','other'],
  json:(body,status)=>({body,status}),readBody:async r=>r.body,leagueOf:b=>b.league||'main',
  requireManager:async()=>deny?{err:'Forbidden',code:403}:{uid:'kap',name:'Kap'},LG:l=>'/bozo/leagues/'+l,
  fbGet:async()=>({data:structuredClone(state),etag:'v1'}),
  fbPut:async(e,p,v,etag)=>{assert.equal(etag,'v1');if(conflict)return false;state=structuredClone(v);writes++;return true;},
  bozoFetchEvents:async()=>{requests++;if(fail)throw new Error('SGO '+fail);return[];},
  bozoTeamRegistry:async()=>({}),bozoMatchEvent:()=>null,
  bozoPeriodOf:p=>p.period||'game',bozoPeriodError:()=>null,bozoSpreadSignError:()=>null,
  bozoWeekGateError:()=>null,playerName:x=>x,
 };
 vm.createContext(ctx);
 vm.runInContext([
  cut(worker,'const bzAmerican =','/* Resolve one free-text prop'),
  cut(worker,'const bozoRawImplied =','function bozoCanonicalKey('),
  cut(worker,'function bozoSelfPricedEntry(','/* Build one close mutation'),
  cut(worker,'const selectionKeyOf =','// Server-side Fisher'),
  'const ledgerKey=(s,w,k)=>`${s}-w${w}-${k}`;',
  cut(worker,'async function bozoVerifyEntry(','async function bozoAdmin('),
  'this.api={bozoCaptureEntry,validatePick,bozoVerifyEntry};'
 ].join('\n'),ctx);
 return{api:ctx.api,env,state:()=>state,writes:()=>writes,requests:()=>requests,
  deny:()=>deny=true,conflict:()=>conflict=true,change:fn=>fn(state),
  post:b=>ctx.api.bozoVerifyEntry({method:'POST',body:b},env,{}),
  capture:p=>ctx.api.bozoCaptureEntry(env,{...base,...p})};
}
test('429/network failures accept manual odds; blank price remains actionable and provenance cannot be forged',async()=>{
 const r=rig();const out=await r.capture({verificationStatus:'verified',priceSource:'captured',entryVerification:{byName:'forged'},clvEligible:true});
 assert.equal(out.ok,true);assert.equal(out.p.price,-150);assert.equal(out.p.verificationStatus,'unverified');
 assert.equal(out.p.priceSource,'self');assert.equal(out.p.clvEligible,false);assert.equal(out.p.entryVerification,null);
 assert.equal(out.p.priceOpp,null);assert.match(out.p.captureFailureReason,/429/);assert.equal(r.writes(),0);
 const empty=await r.capture({typedPrice:undefined});assert.equal(empty.ok,false);assert.match(empty.error,/Enter the DraftKings odds/);
 const v=r.api.validatePick; const band={ceil:-100,floor:-500};
 assert.equal(v(out.p,'Pat',{},band,'standard','pat'),null);
 assert.match(v({...out.p,price:-600},'Pat',{},band,'standard','pat'),/outside/);
 assert.match(v(out.p,'Pat',{someone:{...out.p,who:'Someone'}},band,'standard','pat'),/exact selection/);
 assert.match(v(out.p,'Pat',{someone:{...out.p,who:'Someone',side:'A'}},band,'standard','pat'),/other side/);
});
test('verification requires manager and both real prices; cannot change the submitted price',async()=>{
 const r=rig();const input={forUid:'pat',week:4,ts:base.ts,price:-150,priceOpp:130};
 for(const value of [null,'',0,'nope']){assert.equal((await r.post({...input,priceOpp:value})).status,400);}
 assert.equal((await r.post({...input,price:-160})).status,400);
 r.deny();assert.equal((await r.post(input)).status,403);assert.equal(r.writes(),0);
});
test('two-phase verification updates pick, ledger and audit atomically, preserves clock and closing quote, and replays safely',async()=>{
 const r=rig();const proposal=await r.post({forUid:'pat',week:4,ts:base.ts,price:-150,priceOpp:130});
 assert.equal(proposal.status,200);assert.equal(r.writes(),0);
 const req={forUid:'pat',confirm:proposal.body.confirm_code};assert.equal((await r.post(req)).status,200);
 const s=r.state(),pick=s.picks.pat,row=s.ledger['2026-w4-pat'];
 assert.equal(pick.ts,base.ts);assert.equal(pick.price,-150);assert.equal(pick.priceSource,'manual');
 assert.equal(pick.entryPriceOpp,130);assert.equal(pick.clvEligible,true);assert.equal(pick.verificationStatus,'verified');
 assert.equal(row.priceOpp,130);assert.equal(row.ts,base.ts);assert.equal(row.close,-170);
 assert.equal(pick.entryVerification.byName,'Kap');assert.equal(Object.keys(s.audit).length,1);
 assert.equal((await r.post(req)).body.replayed,true);assert.equal(r.writes(),1);
});
test('changed pick/week and concurrent writes cannot verify the wrong entry',async()=>{
 for(const mutation of [s=>s.week++,s=>s.picks.pat.ts++]){
  const r=rig();const p=await r.post({forUid:'pat',week:4,ts:base.ts,price:-150,priceOpp:130});r.change(mutation);
  assert.equal((await r.post({forUid:'pat',confirm:p.body.confirm_code})).status,409);assert.equal(r.writes(),0);
 }
 const r=rig(),p=await r.post({forUid:'pat',week:4,ts:base.ts,price:-150,priceOpp:130});r.conflict();
 assert.equal((await r.post({forUid:'pat',confirm:p.body.confirm_code})).status,409);assert.equal(r.writes(),0);
});
test('unverified entries do not gain automatic CLV; manual verification enables it with both closing sides; overrides survive',()=>{
 const ctx={devigP:(a,b)=>a==null||b==null?null:(a<0?-a/(100-a):100/(100+a))/((a<0?-a/(100-a):100/(100+a))+(b<0?-b/(100-b):100/(100+b)))};
 vm.createContext(ctx);vm.runInContext(cut(page,'function clvDeltaOf(','const amer =')+'this.delta=clvDeltaOf;',ctx);
 const p={price:-150,entryPriceOpp:130,priceSource:'self',verificationStatus:'unverified'};
 assert.equal(ctx.delta(p,{close:-170,closeOpp:145}),null);
 assert.equal(ctx.delta(p,{clvPts:0}),0);
 p.priceSource='manual';p.verificationStatus='verified';assert.ok(ctx.delta(p,{close:-170,closeOpp:145})>0);
 assert.equal(ctx.delta(p,{close:-170}),null);
});
