import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as identity from '../bozo-owner-confirmation.mjs';
const source=readFileSync('dawg-bot-worker.js','utf8');
const core=source.slice(source.indexOf('async function bozoOwnerConfirmationCore('),source.indexOf('// Verify a manually entered ORIGINAL quote'));
test('browser and Worker identity definitions remain identical',()=>{
 const module=readFileSync('bozo-owner-confirmation.mjs','utf8').replaceAll('export function','function').replaceAll('FIELDS','OWNER_CONFIRMATION_FIELDS');
 assert.ok(source.startsWith(module));
 assert.ok(readFileSync('bozo.html','utf8').includes(module));
});
function rig(){
 let state={season:2026,week:9,status:'placed',picks:{pat:{submissionId:'TEST01',ts:123,who:'Pat',label:'B ML',game:'A @ B',price:-150,verificationStatus:'unverified',priceSource:'self',clvEligible:false,closeState:'pending',captureFailureCode:'rate_limited'}},ledger:{x:{stake:10,result:null}},funds:100,eliminations:[]};
 let writes=0,conflict=false;const kv=new Map(),auth={uid:'owner',name:'Owner'};
 const env={RL:{get:async k=>kv.get(k),put:async(k,v)=>kv.set(k,v)}};
 const ctx={...identity,crypto:webcrypto,Date,SEASON:2026,isSiteAdmin:a=>a.uid==='owner',leagueOf:b=>b?.league||'main',LG:l=>l,
 fbGet:async()=>({data:structuredClone(state),etag:'v1'}),fbPut:async(e,p,s,tag)=>{assert.equal(tag,'v1');if(conflict)return false;state=structuredClone(s);writes++;return true;}};
 vm.createContext(ctx);vm.runInContext(core+'this.run=bozoOwnerConfirmationCore',ctx);
 const expected=()=>identity.ownerConfirmationIdentity('main',state.season,state.week,'pat',state.picks.pat);
 return {state:()=>state,writes:()=>writes,change:fn=>fn(state),conflict:()=>conflict=true,expected,
 post:(b,a=auth)=>ctx.run(env,a,b),get:code=>ctx.run(env,auth,{receiptId:code},'GET'),
 propose:()=>ctx.run(env,auth,{forUid:'pat',expected:expected(),evidenceRef:'private-fixture-reference'})};
}
test('owner confirmation is two phase, audited, private and inert; replay reads same receipt',async()=>{
 const r=rig(),before=structuredClone(r.state()),p=await r.propose();assert.equal(p.status,200);assert.equal(r.writes(),0);
 const code=p.body.confirm_code,s=await r.post({forUid:'pat',confirm:code});assert.equal(s.status,200);assert.equal(r.writes(),1);
 const after=structuredClone(r.state());delete after.ownerConfirmations;delete after.audit;assert.deepEqual(after,before);
 assert.ok(!JSON.stringify(r.state()).includes('private-fixture-reference'));
 const read=await r.get(code);assert.equal(read.body.current,true);assert.equal(read.body.evidenceRef,'private-fixture-reference');
 assert.equal((await r.post({forUid:'pat',confirm:code})).body.receipt.receiptId,code);assert.equal(r.writes(),1);
});
test('unauthorized, missing identity, evidence and unrelated member cannot annotate',async()=>{
 const r=rig();assert.equal((await r.post({}, {uid:'other'})).status,403);
 assert.equal((await r.post({forUid:'other'})).status,404);
 assert.equal((await r.post({forUid:'pat',expected:{}})).status,409);
 assert.equal((await r.post({forUid:'pat',expected:r.expected()})).status,400);assert.equal(r.writes(),0);
});
test('material changes and week changes invalidate confirmation and pending writes',async()=>{
 for(const change of [s=>s.week++,s=>s.picks.pat.ts++,s=>s.picks.pat.price=-160,s=>s.picks.pat.label='A ML',s=>s.picks.pat.submissionId='OTHER']){
  const r=rig(),p=await r.propose();r.change(change);assert.equal((await r.post({forUid:'pat',confirm:p.body.confirm_code})).status,409);assert.equal(r.writes(),0);
  const q=rig(),proposed=await q.propose(),saved=await q.post({forUid:'pat',confirm:proposed.body.confirm_code});q.change(change);
  assert.equal(identity.ownerConfirmationMatches(saved.body.receipt,q.expected()),false);
  assert.equal((await q.get(proposed.body.confirm_code)).body.current,false);
 }
});
test('CAS conflict creates no visible seal or successful readback',async()=>{
 const r=rig(),p=await r.propose();r.conflict();assert.equal((await r.post({forUid:'pat',confirm:p.body.confirm_code})).status,409);
 assert.equal(r.writes(),0);assert.equal(r.state().ownerConfirmations,undefined);assert.equal((await r.get(p.body.confirm_code)).status,404);
});
test('badge requires exact identity and leaves quote-unverified status visible',async()=>{
 const page=readFileSync('bozo.html','utf8'),r=rig(),p=await r.propose();await r.post({forUid:'pat',confirm:p.body.confirm_code});
 const ctx={window:{DDBozoOwner:identity},LID:'main',S:r.state(),kEnc:x=>x,legRow:()=>null};vm.createContext(ctx);
 const start=page.indexOf('function ownerConfirmationFor('),end=page.indexOf('\n};',page.indexOf('const quoteSourceBadge =',start))+3;
 vm.runInContext(page.slice(start,end)+';this.badge=priceSourceBadge;',ctx);
 assert.match(ctx.badge({...r.state().picks.pat,key:'pat'}),/Owner approved.*Quote unverified/);
 assert.doesNotMatch(ctx.badge({...r.state().picks.pat,key:'other'}),/Owner approved/);
 assert.doesNotMatch(ctx.badge({...r.state().picks.pat,key:'pat',price:-151}),/Owner approved/);
});
