import assert from 'node:assert/strict';
import test from 'node:test';
import {initialState,transition,capabilities} from './machine.mjs';
import {syntheticTracking} from './tracking.mjs';
import {workflowGraph} from './workflow.mjs';
const author={tenant:'synthetic-test',id:'author',subject:'account-a',capabilities};
const reviewer={...author,id:'reviewer',subject:'account-b'};
const owner={...author,signedOwner:true};
function fixture(){let s=initialState(),key=0;const call=(type,payload,actor=author)=>{const x=transition(s,actor,{type,payload,key:String(++key)},1000,'a'.repeat(64));s=x.state;return x.result;};
 const h=call('hypothesis',{title:'Synthetic question',method:'Descriptive only'}),tracking=syntheticTracking();
 const base={hypothesisId:h.id,hypothesisVersion:1,evidenceIds:[],body:'Synthetic test only'};
 const check=call('discussion',{...base,kind:'data_check',tracking});
 const t=call('task',{hypothesisId:h.id,dataCheckId:check.id,split:'discovery',budgetMs:5000,maxObservations:10000});
 const c=call('claim',{taskId:t.id,leaseMs:1000});const r=call('run',{taskId:t.id,leaseToken:c.lease.token,tracking});
 const refs={...base,receiptId:r.id,receiptHash:r.receiptHash};
 return {call,h,t,r,tracking,check,base,refs,state:()=>s};}
test('synthetic vertical slice reaches a signed descriptive disposition only',()=>{
 const x=fixture();assert.equal(x.r.outcome,'success');
 const rev=x.call('discussion',{...x.refs,kind:'review',disposition:'ready'},reviewer);
 const finding=x.call('discussion',{...x.refs,kind:'finding',reviewId:rev.id});
 const d=x.call('discussion',{...x.refs,kind:'owner_decision',reviewId:rev.id,findingId:finding.id,disposition:'accept_descriptive'},owner);
 assert.equal(d.execution,'not_executed');assert.equal(d.baseline_fit,false);
 assert.equal(x.state().hypotheses[0].revisions[0].status,'exploratory');
 assert.deepEqual(workflowGraph(x.state(),x.h.id).nodes.map(n=>n.status),['recorded','recorded','recorded','recorded','recorded','accepted']);
 assert.throws(()=>x.call('discussion',{...x.refs,kind:'owner_decision',reviewId:rev.id,findingId:finding.id,disposition:'defer'},owner),/already decided/);
});
test('self review and alternate labels on same subject cannot unlock findings',()=>{
 const x=fixture();for(const a of [author,{...author,id:'mcp:a',authorLabel:'Another AI'}])assert.throws(()=>x.call('discussion',{...x.refs,kind:'review',disposition:'ready'},a),/Separate verified subject/);
 assert.throws(()=>x.call('discussion',{...x.refs,kind:'finding',reviewId:'missing'}),/Resource unavailable/);
 const rev=x.call('discussion',{...x.refs,kind:'review',disposition:'changes_requested'},reviewer);
 assert.throws(()=>x.call('discussion',{...x.refs,kind:'finding',reviewId:rev.id}),/Ready receipt-specific review/);
 assert.equal(workflowGraph(x.state(),x.h.id).nodes[3].status,'blocked');
});
test('receipt hash, tenant, review version and signed owner gates fail closed',()=>{
 const x=fixture();assert.throws(()=>x.call('discussion',{...x.refs,receiptHash:'bad',kind:'review',disposition:'ready'},reviewer),/Receipt version mismatch/);
 assert.throws(()=>x.call('discussion',{...x.refs,kind:'review',disposition:'ready'},{...reviewer,tenant:'other'}),/Resource unavailable/);
 const rev=x.call('discussion',{...x.refs,kind:'review',disposition:'ready'},reviewer);
 const f=x.call('discussion',{...x.refs,kind:'finding',reviewId:rev.id});
 assert.throws(()=>x.call('discussion',{...x.refs,kind:'owner_decision',reviewId:rev.id,findingId:f.id,disposition:'accept_descriptive'}),/Signed owner/);
 x.call('discussion',{...x.refs,kind:'review',disposition:'changes_requested'},reviewer);
 assert.throws(()=>x.call('discussion',{...x.refs,kind:'owner_decision',reviewId:rev.id,findingId:f.id,disposition:'accept_descriptive'},owner),/Review superseded/);
});
test('question edits stale the chain and bounded execution; holdout and real inputs rejected',()=>{
 const x=fixture();x.call('hypothesis',{id:x.h.id,expectedVersion:1,title:'Changed question',method:'Changed target'});
 assert.equal(workflowGraph(x.state(),x.h.id).nodes[1].status,'stale');
 assert.throws(()=>x.call('discussion',{...x.refs,kind:'review',disposition:'ready'},reviewer),/Stale hypothesis/);
 assert.throws(()=>x.call('task',{hypothesisId:x.h.id,dataCheckId:x.check.id,split:'discovery',budgetMs:5000,maxObservations:10000}),/Current synthetic data check/);
 for(const mutate of [d=>d.split='holdout',d=>d.provenance.kind='verified']){const d=syntheticTracking();mutate(d);assert.throws(()=>x.call('discussion',{...x.base,hypothesisVersion:2,kind:'data_check',tracking:d}));}
});
test('changed input produces a failed immutable attempt and cannot be reviewed',()=>{
 const x=fixture(),t=x.call('task',{hypothesisId:x.h.id,dataCheckId:x.check.id,split:'discovery',budgetMs:5000,maxObservations:10000});
 const c=x.call('claim',{taskId:t.id,leaseMs:1000});const d=structuredClone(x.tracking);d.provenance.note+=' changed';
 const r=x.call('run',{taskId:t.id,leaseToken:c.lease.token,tracking:d});assert.equal(r.outcome,'failure');assert.match(r.error,/Data changed/);
 assert.throws(()=>x.call('discussion',{...x.refs,receiptId:r.id,receiptHash:r.receiptHash,kind:'review',disposition:'ready'},reviewer),/successful synthetic/);
});
test('legacy tasks and challenges do not count as bounded execution or review',()=>{
 let s=initialState();const h=transition(s,author,{type:'hypothesis',key:'h',payload:{title:'Legacy',method:'No gate'}});s=h.state;
 s=transition(s,author,{type:'task',key:'t',payload:{hypothesisId:h.result.id,split:'discovery',budgetMs:5000,maxObservations:10000}}).state;
 const g=workflowGraph(s,h.result.id);assert.equal(g.legacyTasks,1);assert.equal(g.nodes[2].record,null);assert.equal(g.nodes[1].status,'blocked');
});
import {fixture as gatewayFixture} from './gateway-fixture.mjs';
test('authenticated gateway carries the complete synthetic chain without new grants',async()=>{
 const x=await gatewayFixture(),path='/researchLab/v1/tenants/demo',env=x.rows.get(path);
 // Fixture-only authorization, never touches a deployed environment.
 env.access.users.u_owner.owner=true;delete env.access.users.u_owner.expiresAt;x.env.RESEARCH_OWNER_UID='u_owner';x.put(path,env);
 const call=async(type,payload,actor='user')=>{const res=await x.command(type,payload,actor);const result=await res.json();assert.equal(res.status,200,JSON.stringify(result));return result;};
 const h=await call('hypothesis',{title:'Synthetic gateway question',method:'No model fitting'}),base={hypothesisId:h.id,hypothesisVersion:1,body:'Synthetic fixture only',evidenceIds:[]},tracking=syntheticTracking();
 const check=await call('discussion',{...base,kind:'data_check',tracking}),t=await call('task',{hypothesisId:h.id,dataCheckId:check.id,split:'discovery',budgetMs:5000,maxObservations:10000}),lease=await call('claim',{taskId:t.id,leaseMs:60000}),r=await call('run',{taskId:t.id,leaseToken:lease.lease.token,tracking});
 const refs={...base,receiptId:r.id,receiptHash:r.receiptHash};
 const review=await call('discussion',{...refs,kind:'review',disposition:'ready'},'agent');
 const finding=await call('discussion',{...refs,kind:'finding',reviewId:review.id});
 const decision=await call('discussion',{...refs,kind:'owner_decision',reviewId:review.id,findingId:finding.id,disposition:'defer'});
 assert.equal(decision.ownerAuthorized,true);assert.equal(decision.execution,'not_executed');
});
test('stale code and tampered receipts cannot satisfy review',()=>{
 const x=fixture();
 assert.throws(()=>transition(x.state(),reviewer,{type:'discussion',key:'code-change',payload:{...x.refs,kind:'review',disposition:'ready'}},1000,'b'.repeat(64)),/code changed/);
 const s=structuredClone(x.state());s.receipts[0].summary=[];
 assert.throws(()=>transition(s,reviewer,{type:'discussion',key:'tamper',payload:{...x.refs,kind:'review',disposition:'ready'}},1000,'a'.repeat(64)),/integrity mismatch/);
 assert.equal(workflowGraph({...x.state(),codeHash:'b'.repeat(64)},x.h.id).nodes[1].status,'stale');
});
test('delegated agent labels cannot substitute for a separate account review',()=>{
 const x=fixture();assert.throws(()=>x.call('discussion',{...x.refs,kind:'review',disposition:'ready'},{...reviewer,subject:'agent:synthetic-test'}),/Delegated agent identity/);
});
