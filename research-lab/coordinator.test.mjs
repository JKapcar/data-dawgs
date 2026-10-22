import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,transition,view,capabilities,hash} from './machine.mjs';
import {syntheticTracking} from './tracking.mjs';
import {createCoordinator,taskState,verifyReceipt} from './coordinator.mjs';
import {createClient} from './client.mjs';
import {workflowGraph} from './workflow.mjs';
import {readFileSync} from 'node:fs';
import {createBrowserRunner} from './browser-runner.mjs';
import {transition as workerTransition} from './worker-core.mjs';

function fixture({bounded=false}={}){
 let state=initialState(),time=1000,codeHash='a'.repeat(64),actor='owner',fail=null,readFail=false;
 const tracking=syntheticTracking(),calls=[],principal=()=>({tenant:'synthetic',id:actor,capabilities});
 function command(type,payload,key=crypto.randomUUID()){
  const next=transition(state,principal(),{type,payload,key},time,codeHash);state=next.state;return next.result;
 }
 const h=command('hypothesis',{title:'Synthetic question',method:'Descriptive fixture only'});
 const check=bounded?command('discussion',{hypothesisId:h.id,hypothesisVersion:1,kind:'data_check',body:'Synthetic check',evidenceIds:[],tracking}):null;
 const task=command('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000,...(check?{dataCheckId:check.id}:{})});
 const canonical=()=>{const s={...view(state,principal()),codeHash,identity:{tenant:'synthetic',actor}};for(const t of s.tasks)if(t.lease&&t.lease.owner!==actor)delete t.lease.token;return s;};
 const client={async state(){if(readFail){readFail=false;throw Error('Read response lost');}return canonical();},async command(type,payload,key){calls.push({type,payload:structuredClone(payload),key});if(fail===type+'-before'){fail=null;throw Error('Transport failed before commit');}const r=command(type,payload,key);if(fail===type){fail=null;throw Error('Response lost after commit');}if(fail===type+'-and-read'){fail=null;readFail=true;throw Error('Response lost after commit');}return r;}};
 const coordinator=createCoordinator(client,{now:()=>time});
 return {client,coordinator,tracking,task,h,check,calls,command,canonical,get state(){return state;},set actor(v){actor=v;},set time(v){time=v;},set code(v){codeHash=v;},lose:v=>fail=v};
}
test('happy path verifies one canonical receipt and coalesces double clicks',async()=>{
 const f=fixture({bounded:true}),a=f.coordinator.run(f.task.id,f.tracking),b=f.coordinator.run(f.task.id,f.tracking);assert.equal(a,b);
 const result=await a;assert.equal(result.status,'completed');assert.equal(f.state.receipts.length,1);assert.deepEqual(f.calls.map(x=>x.type),['claim','run']);
 assert.equal((await f.coordinator.run(f.task.id,f.tracking)).receipt.id,result.receipt.id);assert.equal(f.calls.length,2);
});
for(const stage of ['claim','run'])test('lost '+stage+' response reconciles without duplicate execution',async()=>{
 const f=fixture();f.lose(stage);assert.equal((await f.coordinator.run(f.task.id,f.tracking)).status,'completed');assert.equal(f.state.receipts.length,1);assert.equal(f.calls.filter(x=>x.type===stage).length,1);
});
for(const stage of ['claim','run'])test(stage+' retry preserves key and frozen payload',async()=>{
 const f=fixture();f.lose(stage+'-before');const original=structuredClone(f.tracking);
 await assert.rejects(f.coordinator.run(f.task.id,f.tracking),/Transport/);f.tracking.provenance.note='Changed after uncertain attempt';
 assert.equal((await f.coordinator.run(f.task.id,f.tracking)).status,'completed');
 const calls=f.calls.filter(x=>x.type===stage);assert.equal(calls.length,2);assert.equal(calls[0].key,calls[1].key);assert.deepEqual(calls[0].payload,calls[1].payload);assert.equal(f.state.receipts[0].hashes.data,hash(original));assert.equal(f.state.receipts.length,1);
});
test('lost run and reconciliation read recovers from canonical receipt on next click',async()=>{
 const f=fixture();f.lose('run-and-read');await assert.rejects(f.coordinator.run(f.task.id,f.tracking),/Read response/);
 assert.equal((await f.coordinator.run(f.task.id,f.tracking)).status,'completed');assert.equal(f.calls.filter(x=>x.type==='run').length,1);
});
test('expired claim-only attempt recovers after both claim response and reconciliation read are lost',async()=>{
 const f=fixture({bounded:true}),input=structuredClone(f.tracking);f.lose('claim-and-read');
 await assert.rejects(f.coordinator.run(f.task.id,f.tracking),/Read response lost/);
 assert.equal(f.calls.filter(x=>x.type==='run').length,0);f.time=62000;f.tracking.provenance.note='Changed after uncertain claim';
 assert.equal((await f.coordinator.run(f.task.id,f.tracking)).status,'completed');
 const claims=f.calls.filter(x=>x.type==='claim');assert.equal(claims.length,2);assert.notEqual(claims[0].key,claims[1].key);assert.deepEqual(claims[0].payload,claims[1].payload);
 assert.equal(f.calls.filter(x=>x.type==='run').length,1);assert.equal(f.state.receipts.length,1);assert.equal(f.state.receipts[0].hashes.data,hash(input));
});
test('late receipt snapshot verification cannot clear a newer identity pending attempt',async()=>{
 const f=fixture({bounded:true});await f.coordinator.run(f.task.id,f.tracking);const old=f.canonical();f.coordinator.clear();f.actor='next-owner';
 const task=f.command('task',{hypothesisId:f.h.id,dataCheckId:f.check.id,split:'discovery',budgetMs:5000,maxObservations:10000});f.lose('run-before');
 await assert.rejects(f.coordinator.run(task.id,f.tracking),/Transport/);assert.equal(f.coordinator.pending(task.id),true);
 await f.coordinator.verifyReceipt(old,old.tasks[0],old.receipts[0]);assert.equal(f.coordinator.pending(task.id),true);
});
test('foreign lease is not resumable and redacted token never enters a command',async()=>{
 const f=fixture();f.actor='other';const claimed=f.command('claim',{taskId:f.task.id,leaseMs:60000});f.actor='owner';
 const s=f.canonical();assert.equal(taskState(s,s.tasks[0],1000),'foreign');assert.equal(s.tasks[0].lease.token,undefined);
 await assert.rejects(f.coordinator.run(f.task.id,f.tracking),/foreign/);assert.equal(f.calls.length,0);assert.ok(!JSON.stringify(s).includes(claimed.lease.token));
});
test('same owner without usable token is unavailable',()=>{const f=fixture();f.command('claim',{taskId:f.task.id,leaseMs:60000});const s=f.canonical();delete s.tasks[0].lease.token;assert.equal(taskState(s,s.tasks[0],1000),'unavailable');});
test('expired lease can be freshly claimed but an uncertain run never switches leases',async()=>{
 const f=fixture();f.command('claim',{taskId:f.task.id,leaseMs:100});f.time=1200;assert.equal(taskState(f.canonical(),f.canonical().tasks[0],1200),'expired');assert.equal((await f.coordinator.run(f.task.id,f.tracking)).status,'completed');
 const g=fixture();g.lose('run-before');await assert.rejects(g.coordinator.run(g.task.id,g.tracking));g.time=70000;await assert.rejects(g.coordinator.run(g.task.id,g.tracking),/Pending run/);assert.equal(g.state.receipts.length,0);
});
for(const kind of ['revision','input','code'])test(kind+' mismatch prevents execution',async()=>{
 const f=fixture({bounded:true});if(kind==='revision')f.command('hypothesis',{id:f.h.id,expectedVersion:1,title:'Revised',method:'New'});if(kind==='input')f.tracking.provenance.note='changed';if(kind==='code')f.code='b'.repeat(64);
 await assert.rejects(f.coordinator.run(f.task.id,f.tracking),/stale|changed/);assert.equal(f.calls.length,0);assert.equal(f.state.receipts.length,0);
});
test('CAS-style claim conflict reconciles foreign winner without run',async()=>{
 const f=fixture();f.client.command=async()=>{f.actor='winner';f.command('claim',{taskId:f.task.id,leaseMs:60000});f.actor='owner';throw Object.assign(Error('CAS conflict'),{status:409});};
 await assert.rejects(f.coordinator.run(f.task.id,f.tracking),/CAS/);assert.equal(f.state.receipts.length,0);
});
for(const kind of ['body','tenant','task','data','code','config','revision'])test('tampered or mismatched receipt fails closed: '+kind,async()=>{
 const f=fixture({bounded:true});await f.coordinator.run(f.task.id,f.tracking);const s=f.canonical(),r=s.receipts[0],t=s.tasks[0];
 if(kind==='body')r.summary=[];if(kind==='tenant')r.tenant='foreign';if(kind==='task')r.taskId='other';if(['data','code','config'].includes(kind))r.hashes[kind]='b'.repeat(64);if(kind==='revision')r.hypothesisVersion=2;
 if(kind!=='body'){const {receiptHash,...body}=r;r.receiptHash=hash(body);}
 await assert.rejects(verifyReceipt(s,t,r),/verification failed/);
});
test('failure receipt is failed, never successful completion',async()=>{const f=fixture();f.state.tasks[0].maxObservations=1;const r=await f.coordinator.run(f.task.id,f.tracking);assert.equal(r.status,'failed');assert.equal(r.receipt.outcome,'failure');});
test('identity invalidation clears pending work and suppresses late response',async()=>{
 const f=fixture();let release;const real=f.client.command;f.client.command=async(...args)=>{await new Promise(r=>release=r);return real(...args);};
 const pending=f.coordinator.run(f.task.id,f.tracking);while(!release)await new Promise(r=>setImmediate(r));f.coordinator.clear();assert.equal(f.coordinator.pending(f.task.id),false);release();await assert.rejects(pending,/Identity changed/);assert.equal(f.state.receipts.length,0);
});
test('hosted client rejects identity switch while reading response',async()=>{
 let token='first',resolve,cleared=0;const client=createClient({mode:'hosted',workerOrigin:'https://toto.jkapcar4.workers.dev',tenant:'synthetic'},{origin:'https://datadawgs216.com',token:()=>token,onInvalidated:()=>cleared++,fetcher:async()=>new Promise(r=>resolve=r)});
 const pending=client.state();token='second';resolve(Response.json({}));await assert.rejects(pending,/Identity changed/);assert.equal(cleared,1);
});
test('identity switch before command cannot send an old pending payload as the new actor',async()=>{
 let token='first',sent=0,cleared=0;const client=createClient({mode:'hosted',workerOrigin:'https://toto.jkapcar4.workers.dev',tenant:'synthetic'},{origin:'https://datadawgs216.com',token:()=>token,onInvalidated:()=>cleared++,fetcher:async()=>{sent++;return Response.json({});}});
 await client.state();token='second';await assert.rejects(client.command('run',{taskId:'synthetic',leaseToken:'old-lease'},'stable-key'),/Identity changed/);assert.equal(sent,1);assert.equal(cleared,1);
});
test('unverified receipt blocks workflow without deleting historical disposition',async()=>{
 const f=fixture({bounded:true});await f.coordinator.run(f.task.id,f.tracking);const s=f.canonical();s.verifiedReceiptIds=[];assert.equal(workflowGraph(s,f.h.id).nodes[2].status,'unverified');assert.equal(s.receipts.length,1);
});
test('board Working remains reported status and navigation is not dispatch',()=>{
 const html=readFileSync(new URL('../dawg-pound.html',import.meta.url),'utf8');assert.match(html,/Working is reported status, not observed execution/);assert.match(html,/does not dispatch a runner/);assert.match(html,/href="research-lab\/private.html"/);
 const js=readFileSync(new URL('../dawg-pound.js',import.meta.url),'utf8');assert.ok(!js.includes('coordinator.mjs'));
});
test('real data, holdout and delegated capabilities remain denied by core',()=>{
 const f=fixture();assert.throws(()=>f.command('task',{hypothesisId:f.h.id,split:'2025-holdout',budgetMs:1,maxObservations:1}),/Held-out/);
 assert.throws(()=>transition(f.state,{tenant:'synthetic',id:'agent:test',capabilities:['research:read']},{type:'claim',key:'denied',payload:{taskId:f.task.id,leaseMs:100}},1000,'a'.repeat(64)),/Capability denied/);
 const claimed=f.command('claim',{taskId:f.task.id,leaseMs:100});f.tracking.provenance.kind='verified';const r=f.command('run',{taskId:f.task.id,leaseToken:claimed.lease.token,tracking:f.tracking});assert.equal(r.outcome,'failure');
});
test('coordinator rejects non-synthetic input before any claim or run',async()=>{
 const f=fixture();f.tracking.provenance.kind='licensed';await assert.rejects(f.coordinator.run(f.task.id,f.tracking),/Synthetic discovery/);assert.equal(f.calls.length,0);
});
test('legacy receipt needs this-tab input evidence; identity clear removes it',async()=>{
 const f=fixture();await f.coordinator.run(f.task.id,f.tracking);const s=f.canonical();
 await f.coordinator.verifyReceipt(s,s.tasks[0],s.receipts[0]);f.coordinator.clear();
 await assert.rejects(f.coordinator.verifyReceipt(s,s.tasks[0],s.receipts[0]),/verification failed/);
 assert.equal(s.tasks[0].status,'completed');assert.equal(s.receipts.length,1);
});
test('definite denial is failed while an uncertain response stays pending',async()=>{
 const f=fixture();f.client.command=async()=>{throw Object.assign(Error('Denied'),{status:403});};await assert.rejects(f.coordinator.run(f.task.id,f.tracking));assert.equal(f.coordinator.attemptState(f.task.id),'failed');
 const g=fixture();g.lose('run-before');await assert.rejects(g.coordinator.run(g.task.id,g.tracking));assert.equal(g.coordinator.attemptState(g.task.id),'pending');
});
test('generated browser engine and Worker core produce equivalent verified synthetic evidence',async()=>{
 const demo=await createBrowserRunner(),s=await demo.state();const result=await createCoordinator(demo).run(s.tasks[0].id,syntheticTracking());assert.equal(result.status,'completed');
 let state=initialState();const principal={tenant:'synthetic',id:'owner',capabilities},code=s.codeHash;
 const call=async(type,payload)=>{const next=await workerTransition(state,principal,{type,payload,key:crypto.randomUUID()},Date.now(),code);state=next.state;return next.result;};
 const h=await call('hypothesis',{title:'Parity',method:'Synthetic'}),task=await call('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000});
 const worker={state:async()=>({...view(state,principal),codeHash:code,identity:{tenant:principal.tenant,actor:principal.id}}),command:call};
 const r=await createCoordinator(worker).run(task.id,syntheticTracking());assert.equal(r.status,'completed');assert.deepEqual(r.receipt.summary,result.receipt.summary);assert.deepEqual(r.receipt.hashes,result.receipt.hashes);assert.equal(state.receipts.length,1);
});
