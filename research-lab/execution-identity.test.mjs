import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './gateway-fixture.mjs';
import {transition as portableTransition} from './worker-core.mjs';
import {createResearchGateway} from './gateway.mjs';
import {createContinuation} from './continuation.mjs';
import {syntheticTracking} from './tracking.mjs';
import {EXECUTION_POLICY,experimentBasis,rerunBasis} from './execution-identity.mjs';
import {hash} from './machine.mjs';
import {localCodeHash} from './server.mjs';
import {replay} from './replay.mjs';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

async function setup(){
  const f=await fixture(),path='/researchLab/v1/tenants/demo',tracking=syntheticTracking();
  // Fixture-only durable signed owner, same existing grant semantics as production.
  const e=f.rows.get(path);e.access.users.u_owner.owner=true;delete e.access.users.u_owner.expiresAt;f.env.RESEARCH_OWNER_UID='u_owner';f.put(path,e);
  f.dependencies.transition=portableTransition;f.reset();
  const call=async(type,payload,identity='user',key=crypto.randomUUID())=>{
    const response=await f.command(type,payload,identity,key),body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body));return body;
  };
  const h=await call('hypothesis',{title:'Synthetic concurrency',method:'No external effects'});
  const check=await call('discussion',{hypothesisId:h.id,hypothesisVersion:1,kind:'data_check',body:'Exact synthetic input',evidenceIds:[],tracking});
  const payload={hypothesisId:h.id,dataCheckId:check.id,split:'discovery',budgetMs:5000,maxObservations:10000};
  const task=extra=>call('task',{...payload,...extra});
  const state=()=>f.rows.get(path).state;
  const run=async(t,input=tracking,key=crypto.randomUUID())=>{
    const c=await call('claim',{taskId:t.id,leaseMs:60000});
    return call('run',{taskId:t.id,leaseToken:c.lease.token,tracking:input},'user',key);
  };
  return {f,path,tracking,h,check,payload,call,task,state,run};
}

test('canonical identity includes tenant, hypothesis/version, code/input/config and fixed null seed',async()=>{
  const x=await setup(),a=await x.task(),b=await x.task();
  const basis=experimentBasis(a,x.f.dependencies.codeHash,hash(x.tracking));
  assert.equal(a.experimentId,hash(basis));assert.equal(a.executionId,a.experimentId);assert.equal(b.executionId,a.executionId);assert.equal(basis.seed,null);
  for(const field of ['tenant','hypothesisId','hypothesisVersion','code','data','config','seed'])assert.notEqual(hash({...basis,[field]:'different'}),a.experimentId,field);
  assert.equal((await (await x.f.request()).json()).executionPolicy,EXECUTION_POLICY);
  for(const extra of [{executionId:'chosen'},{seed:7},{rerunAuthorizedBy:'owner'}])assert.equal((await x.f.command('task',{...x.payload,...extra})).status,400);
});

test('simultaneous distinct equivalent task IDs have one CAS reservation winner',async()=>{
  const x=await setup(),a=await x.task(),b=await x.task();let arrivals=0,release;
  const barrier=new Promise(resolve=>release=resolve);
  x.f.dependencies.transition=async(...args)=>{
    const result=await portableTransition(...args);
    if(args[2].type==='claim'&&arrivals<2){arrivals++;if(arrivals===2)release();await barrier;}
    return result;
  };x.f.reset();
  const responses=await Promise.all([x.f.command('claim',{taskId:a.id,leaseMs:60000},'user'),x.f.command('claim',{taskId:b.id,leaseMs:60000},'agent')]);
  assert.equal(arrivals,2);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal(x.state().tasks.filter(t=>t.lease).length,1);
  const winner=responses[0].status===200?0:1,c=await responses[winner].json();
  const payload={taskId:c.id,leaseToken:c.lease.token,tracking:x.tracking},who=winner===0?'user':'agent';
  const done=await x.call('run',payload,who,'stable-run');
  assert.equal((await x.call('run',payload,who,'stable-run')).id,done.id);
  assert.equal(x.state().receipts.length,1);
  const loser=winner===0?b:a;
  assert.equal((await x.f.command('claim',{taskId:loser.id,leaseMs:60000})).status,409);
});

test('same task simultaneous run retries produce one canonical terminal receipt',async()=>{
  const x=await setup(),a=await x.task(),c=await x.call('claim',{taskId:a.id,leaseMs:60000});
  const p={taskId:a.id,leaseToken:c.lease.token,tracking:x.tracking};
  const responses=await Promise.all([x.f.command('run',p,'user','same-run'),x.f.command('run',p,'user','same-run')]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(x.state().receipts.length,1);
  const bodies=await Promise.all(responses.map(r=>r.json()));assert.equal(bodies[0].id,bodies[1].id);
});

test('expired equivalent lease transfer fences old token and old claim-key replay',async()=>{
  const x=await setup(),a=await x.task(),b=await x.task();let time=Date.now();
  const handler=createResearchGateway({...x.f.dependencies,now:()=>time});
  const call=async(type,payload,key)=>handler(new Request('https://worker.invalid/research/v1/tenants/demo/command',{method:'POST',headers:{Authorization:'Bearer '+x.f.session,'Content-Type':'application/json'},body:JSON.stringify({type,payload,key})}),x.f.env);
  const original=await(await call('claim',{taskId:a.id,leaseMs:100},'old-claim')).json();
  time+=101;const next=await call('claim',{taskId:b.id,leaseMs:60000},'new-claim');assert.equal(next.status,200);
  assert.equal(x.state().tasks.find(t=>t.id===a.id).lease,null);
  assert.equal((await call('claim',{taskId:a.id,leaseMs:100},'old-claim')).status,409,'expired replay cannot renew authority');
  assert.equal((await call('run',{taskId:a.id,leaseToken:original.lease.token,tracking:x.tracking},'old-run')).status,409);
  const claimed=await next.json();assert.equal((await call('run',{taskId:b.id,leaseToken:claimed.lease.token,tracking:x.tracking},'new-run')).status,200);
  assert.equal(x.state().receipts.length,1);
});

for(const outcome of ['success','failure'])test('terminal '+outcome+' blocks default duplicates; explicit owner rerun is a separate deduplicated attempt',async()=>{
  const x=await setup(),a=await x.task(),duplicate=await x.task(),input=structuredClone(x.tracking);
  if(outcome==='failure')input.frames=[];
  const first=await x.run(a,input);assert.equal(first.outcome,outcome);
  assert.equal((await x.f.command('claim',{taskId:duplicate.id,leaseMs:60000})).status,409);
  const rerun={rerunOf:first.id,rerunReason:'Owner requests one deliberate repeat'};
  const next=await x.task(rerun),same=await x.task(rerun);
  assert.equal(next.experimentId,a.experimentId);assert.equal(next.executionId,hash(rerunBasis(a.experimentId,first.id)));assert.equal(same.executionId,next.executionId);
  assert.notEqual(next.executionId,a.executionId);assert.equal(next.rerunAuthorizedBy,'user:u_owner');
  const second=await x.run(next);assert.equal(second.outcome,'success');
  assert.equal((await x.f.command('claim',{taskId:same.id,leaseMs:60000})).status,409);
  assert.equal((await x.f.command('task',{...x.payload,...rerun})).status,400,'must select successor receipt to repeat again');
  const thirdTask=await x.task({rerunOf:second.id,rerunReason:'Second explicit owner repeat'});await x.run(thirdTask);
  assert.equal(x.state().receipts.length,3);
});

test('rerun preserves signed-owner and task-write authorization and requires exact terminal experiment',async()=>{
  const x=await setup(),a=await x.task(),r=await x.run(a),p={...x.payload,rerunOf:r.id,rerunReason:'Explicit'};
  const e=x.f.rows.get(x.path);e.access.agents.u_agent.capabilities.push('task:write');x.f.put(x.path,e);
  assert.equal((await x.f.command('task',p,'agent')).status,403,'task scope alone does not confer signed-owner rerun authority');
  for(const [extra,status] of [[{rerunReason:''},400],[{rerunOf:'missing'},409],[{budgetMs:4500},400]])assert.equal((await x.f.command('task',{...p,...extra})).status,status);
  const denied=x.f.rows.get(x.path);denied.access.users.u_owner.capabilities=denied.access.users.u_owner.capabilities.filter(c=>c!=='task:write');x.f.put(x.path,denied);
  assert.equal((await x.f.command('task',p)).status,403);
});

test('hypothesis revision and genuinely changed config/input/code are new experiments',async()=>{
  const x=await setup(),a=await x.task();await x.run(a);
  const config=await x.task({budgetMs:4500});assert.notEqual(config.executionId,a.executionId);await x.run(config);
  const tracking=structuredClone(x.tracking);tracking.provenance.note+=' new registered input';
  const check=await x.call('discussion',{hypothesisId:x.h.id,hypothesisVersion:1,kind:'data_check',body:'Changed input',evidenceIds:[],tracking});
  const changed=await x.task({dataCheckId:check.id});assert.notEqual(changed.executionId,a.executionId);await x.run(changed,tracking);
  await x.call('hypothesis',{id:x.h.id,expectedVersion:1,title:'New question version',method:'Explicit revision'});
  const check2=await x.call('discussion',{hypothesisId:x.h.id,hypothesisVersion:2,kind:'data_check',body:'New version',evidenceIds:[],tracking:x.tracking});
  const version=await x.task({dataCheckId:check2.id});assert.notEqual(version.executionId,a.executionId);await x.run(version);
  x.f.dependencies.codeHash='b'.repeat(64);x.f.reset();
  const check3=await x.call('discussion',{hypothesisId:x.h.id,hypothesisVersion:2,kind:'data_check',body:'New implementation',evidenceIds:[],tracking:x.tracking});
  const code=await x.task({dataCheckId:check3.id});assert.notEqual(code.executionId,version.executionId);await x.run(code);
  assert.equal(x.state().receipts.length,5);
});

test('two owner-session loops with equivalent tasks dispatch at most one canonical experiment',async()=>{
  const x=await setup(),a=await x.task(),b=await x.task();
  const client={mode:'hosted',state:async()=>{const r=await x.f.request();assert.equal(r.status,200);return r.json();},command:async(type,payload,key)=>{const r=await x.f.command(type,payload,'user',key),body=await r.json();if(!r.ok)throw Object.assign(Error(body.error),{status:r.status});return body;}};
  const first=createContinuation(client),second=createContinuation(client);
  await first.approve(a.id,x.tracking);await second.approve(b.id,x.tracking);
  await Promise.all([first.start(),second.start()]);
  assert.equal(x.state().receipts.length,1);assert.equal(x.state().receipts[0].outcome,'success');
});

test('legacy bounded tasks and receipts acquire/retain identity without rewriting history',async()=>{
  const x=await setup(),a=await x.task(),b=await x.task();
  const legacy=x.f.rows.get(x.path);for(const t of legacy.state.tasks){delete t.experimentId;delete t.executionId;}x.f.put(x.path,legacy);
  const first=await x.run(a);
  const historical=x.f.rows.get(x.path),receipt=historical.state.receipts[0];
  delete receipt.experimentId;delete receipt.executionId;delete receipt.receiptHash;receipt.receiptHash=hash(receipt);x.f.put(x.path,historical);
  const before=structuredClone(receipt);
  assert.equal((await x.f.command('claim',{taskId:b.id,leaseMs:60000})).status,409);
  const rerun=await x.task({rerunOf:first.id,rerunReason:'Explicit repeat of legacy terminal attempt'});await x.run(rerun);
  assert.deepEqual(x.state().receipts[0],before);assert.equal(x.state().receipts.length,2);
});

test('stale non-execution receipt does not consume a new implementation attempt',async()=>{
  const x=await setup(),a=await x.task(),claimed=await x.call('claim',{taskId:a.id,leaseMs:60000});
  x.f.dependencies.codeHash='b'.repeat(64);x.f.reset();
  const stale=await x.call('run',{taskId:a.id,leaseToken:claimed.lease.token,tracking:x.tracking});
  assert.equal(stale.execution,'not_executed');assert.equal(stale.outcome,'failure');
  const check=await x.call('discussion',{hypothesisId:x.h.id,hypothesisVersion:1,kind:'data_check',body:'Current implementation',evidenceIds:[],tracking:x.tracking});
  const current=await x.task({dataCheckId:check.id});await x.run(current);
  assert.equal(x.state().receipts[1].outcome,'success');
});

test('grant revocation competing with identity reservation prevents its commit',async()=>{
  const x=await setup(),a=await x.task();let armed=true;
  x.f.dependencies.transition=async(...args)=>{
    const out=await portableTransition(...args);
    if(args[2].type==='claim'&&armed){armed=false;x.f.onPut(()=>{const e=x.f.rows.get(x.path);e.access.users.u_owner.enabled=false;x.f.put(x.path,e);});}
    return out;
  };x.f.reset();
  assert.equal((await x.f.command('claim',{taskId:a.id,leaseMs:60000})).status,403);
  assert.equal(x.state().tasks[0].lease,null);assert.equal(x.state().receipts.length,0);
});

test('local receipt replay shares the actual updated server source hash without socket startup',async()=>{
  const x=await setup();x.f.dependencies.codeHash=localCodeHash();x.f.reset();
  const check=await x.call('discussion',{hypothesisId:x.h.id,hypothesisVersion:1,kind:'data_check',body:'Local source hash',evidenceIds:[],tracking:x.tracking});
  const t=await x.task({dataCheckId:check.id}),r=await x.run(t),directory=mkdtempSync(path.join(tmpdir(),'bdb-identity-replay-'));
  const body={previous:null,state:x.state()};
  writeFileSync(path.join(directory,'journal.jsonl'),JSON.stringify({...body,checksum:hash(body)})+'\n');
  writeFileSync(path.join(directory,r.hashes.data+'.input.json'),JSON.stringify({tracking:x.tracking}));
  assert.equal(replay(directory,r.id).reproduced,true);
});
