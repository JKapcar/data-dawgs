import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,transition,view,capabilities} from './machine.mjs';
import {syntheticTracking} from './tracking.mjs';
import {createContinuation} from './continuation.mjs';
function fixture(options={}) {
  let stored=initialState(),actor='owner',time=1000,code='a'.repeat(64),hook=async()=>{};
  const tracking=syntheticTracking(),calls=[],statuses=[];
  const principal=()=>({tenant:'synthetic',id:actor,capabilities});
  const command=(type,payload,key=crypto.randomUUID())=>{const out=transition(stored,principal(),{type,payload,key},time,code);stored=out.state;return out.result;};
  const h=command('hypothesis',{title:'Synthetic',method:'Descriptive only'});
  const check=command('discussion',{hypothesisId:h.id,hypothesisVersion:1,kind:'data_check',body:'Synthetic only',tracking,evidenceIds:[]});
  const task=(budgetMs=5000)=>command('task',{hypothesisId:h.id,dataCheckId:check.id,split:'discovery',budgetMs,maxObservations:10000});
  const client={mode:'browser',async state(){return {...view(stored,principal()),codeHash:code,mode:'browser-memory-demo',identity:{actor,tenant:'synthetic',kind:'demo'}};},async command(type,payload,key){calls.push({type,payload,key});await hook(type);return command(type,payload,key);}};
  const loop=createContinuation(client,{now:()=>time,onStatus:s=>statuses.push(s),...options});
  return {loop,task,command,client,tracking,calls,statuses,h,get stored(){return stored;},set actor(x){actor=x;},set time(x){time=x;},set hook(x){hook=x;},set code(x){code=x;}};
}
test('explicit approval only, one at a time, duplicate input/code/config skipped',async()=>{
  const f=fixture(),a=f.task(),b=f.task();f.task(4500);
  assert.throws(()=>f.loop.start(),/approval/);
  await f.loop.approve(a.id,f.tracking);await f.loop.approve(b.id,f.tracking);
  await f.loop.start();assert.equal(f.stored.receipts.length,1);assert.deepEqual(f.calls.map(c=>c.type),['claim','run']);
  await f.loop.start();assert.equal(f.calls.length,2);
});
test('dependencies execute in order even when approvals reversed',async()=>{
  const f=fixture(),a=f.task(),b=f.task(4500);
  await f.loop.approve(b.id,f.tracking,[a.id]);await f.loop.approve(a.id,f.tracking);
  await f.loop.start();assert.deepEqual(f.stored.receipts.map(r=>r.taskId),[a.id,b.id]);
});
test('missing dependency receipt leaves task blocked',async()=>{
  const f=fixture(),a=f.task(),b=f.task(4500);await f.loop.approve(b.id,f.tracking,[a.id]);await f.loop.start();assert.equal(f.calls.length,0);
});
test('stop during claim prevents run and stops further tasks',async()=>{
  const f=fixture(),a=f.task();await f.loop.approve(a.id,f.tracking);f.hook=async()=>f.loop.stop();await f.loop.start();assert.deepEqual(f.calls.map(c=>c.type),['claim']);assert.equal(f.stored.receipts.length,0);
});
test('foreign lease after approval is never resumed',async()=>{
  const f=fixture(),a=f.task();await f.loop.approve(a.id,f.tracking);f.actor='other';f.command('claim',{taskId:a.id,leaseMs:60000});f.actor='owner';await f.loop.start();assert.equal(f.calls.length,0);
});
test('canonical expired lease can be freshly claimed',async()=>{
  const f=fixture(),a=f.task();f.command('claim',{taskId:a.id,leaseMs:100});f.time=1200;await f.loop.approve(a.id,f.tracking);await f.loop.start();assert.equal(f.stored.receipts.length,1);
});
test('identity change between claim and run stops execution',async()=>{
  const f=fixture(),a=f.task();await f.loop.approve(a.id,f.tracking);f.hook=async()=>{f.actor='other';};await f.loop.start();assert.equal(f.calls.length,1);assert.equal(f.stored.receipts.length,0);assert.match(f.statuses.at(-1).reason,/Identity/);
});
test('uncertain run never automatically retries, even after backoff',async()=>{
  const f=fixture(),a=f.task();await f.loop.approve(a.id,f.tracking);f.hook=async type=>{if(type==='run')throw Error('Transport lost');};await f.loop.start();assert.equal(f.calls.length,2);assert.throws(()=>f.loop.start(),/reconcile/);f.time=100000;assert.throws(()=>f.loop.start(),/reconcile/);assert.equal(f.calls.length,2);
});
test('stale hypothesis and changed implementation stop approved work',async()=>{
  for(const change of ['hypothesis','code']){const f=fixture(),a=f.task();await f.loop.approve(a.id,f.tracking);if(change==='code')f.code='b'.repeat(64);else f.command('hypothesis',{id:f.h.id,expectedVersion:1,title:'Changed',method:'Changed'});await f.loop.start();assert.equal(f.calls.length,0);}
});
test('time and run budgets stop additional claims',async()=>{
  const f=fixture({maxRuns:1}),a=f.task(),b=f.task(4500);await f.loop.approve(a.id,f.tracking);await f.loop.approve(b.id,f.tracking);await f.loop.start();assert.equal(f.stored.receipts.length,1);
  const g=fixture(),t=g.task();await g.loop.approve(t.id,g.tracking);g.hook=async()=>{g.time=40000;};await g.loop.start();assert.equal(g.calls.length,1);
});
test('corrupt canonical receipt blocks selection and further execution',async()=>{
  const f=fixture(),a=f.task();await f.loop.approve(a.id,f.tracking);await f.loop.start();f.stored.receipts[0].receiptHash='b'.repeat(64);await f.loop.start();assert.equal(f.calls.length,2);assert.match(f.statuses.at(-1).reason,/verification failed/);
});
test('terminal failure receipt blocks duplicate combination',async()=>{
  const f=fixture(),a=f.task(1);await f.loop.approve(a.id,f.tracking);
  // Corrupt fixture input after data check to force canonical failure outside loop.
  const claim=f.command('claim',{taskId:a.id,leaseMs:60000});const invalid=structuredClone(f.tracking);invalid.frames=[];
  f.command('run',{taskId:a.id,leaseToken:claim.lease.token,tracking:invalid});
  await f.loop.start();assert.equal(f.calls.length,0);assert.match(f.statuses.at(-1).reason,/verification failed/);
});

test('canonical failure halts later work and enforces manual reconciliation',async()=>{
  const f=fixture(),a=f.task();f.stored.tasks[0].maxObservations=1;
  const claim=f.command('claim',{taskId:a.id,leaseMs:60000});
  f.command('run',{taskId:a.id,leaseToken:claim.lease.token,tracking:f.tracking});
  const b=f.task(4500);await f.loop.approve(b.id,f.tracking);await f.loop.start();
  assert.equal(f.calls.length,0);assert.match(f.statuses.at(-1).reason,/failure receipt/);assert.throws(()=>f.loop.start(),/reconcile/);
});
test('owner disposition stops approved work',async()=>{
  const f=fixture(),a=f.task();await f.loop.approve(a.id,f.tracking);
  f.stored.discussions.push({kind:'owner_decision',hypothesisId:f.h.id,hypothesisVersion:1,tenant:'synthetic'});
  await f.loop.start();assert.equal(f.calls.length,0);assert.match(f.statuses.at(-1).reason,/Owner decision/);
});
test('session read rejection sends no commands',async()=>{
  const f=fixture(),a=f.task();await f.loop.approve(a.id,f.tracking);f.client.state=async()=>{throw Error('Session expired');};
  await f.loop.start();assert.equal(f.calls.length,0);assert.match(f.statuses.at(-1).reason,/Session expired/);
});
test('lost committed run response reconciles before selecting next task',async()=>{
  const f=fixture(),a=f.task(),b=f.task(4500);await f.loop.approve(a.id,f.tracking);await f.loop.approve(b.id,f.tracking);
  const real=f.client.command;let lost=false;f.client.command=async(...args)=>{const result=await real(...args);if(args[0]==='run'&&!lost){lost=true;throw Error('Lost response');}return result;};
  await f.loop.start();assert.equal(f.stored.receipts.length,2);assert.equal(f.calls.filter(c=>c.type==='run').length,2);
});
test('double start coalesces and owner stop between receipts prevents next claim',async()=>{
  const f=fixture(),a=f.task(),b=f.task(4500);await f.loop.approve(a.id,f.tracking);await f.loop.approve(b.id,f.tracking);
  f.hook=async type=>{if(type==='run')f.loop.stop('Paused by owner');};
  const first=f.loop.start();assert.equal(first,f.loop.start());await first;assert.equal(f.stored.receipts.length,1);
  f.hook=async()=>{};await f.loop.start();assert.equal(f.stored.receipts.length,2);
});

test('active lease on equivalent work prevents dispatch under another task ID',async()=>{
  const f=fixture(),a=f.task(),b=f.task();await f.loop.approve(b.id,f.tracking);
  f.actor='other';f.command('claim',{taskId:a.id,leaseMs:60000});f.actor='owner';
  await f.loop.start();assert.equal(f.calls.length,0);
});

for(const mode of ['hosted','local',undefined])test('shared/unknown mode fails closed before any dispatch: '+mode,async()=>{
  const f=fixture(),a=f.task(),b=f.task();await f.loop.approve(a.id,f.tracking);
  const second=createContinuation(f.client);await second.approve(b.id,f.tracking);
  f.client.mode=mode;
  assert.throws(()=>f.loop.start(),/transactional/);assert.throws(()=>second.start(),/transactional/);
  assert.equal(f.calls.length,0);assert.equal(f.stored.receipts.length,0);
});
test('browser mode cannot turn a shared state response into isolated execution',async()=>{
  const f=fixture(),a=f.task();const real=f.client.state;
  f.client.state=async()=>({...await real(),mode:'shared-store'});
  await f.loop.approve(a.id,f.tracking);await f.loop.start();
  assert.equal(f.calls.length,0);assert.match(f.statuses.at(-1).reason,/transactional/);
});
test('mode changing during claim prevents the next command',async()=>{
  const f=fixture(),a=f.task();await f.loop.approve(a.id,f.tracking);
  f.hook=async()=>{f.client.mode='hosted';};await f.loop.start();
  assert.deepEqual(f.calls.map(c=>c.type),['claim']);assert.equal(f.stored.receipts.length,0);
});
