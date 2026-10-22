// Foreground convenience only. All authority remains in the existing gateway.
import {createCoordinator, taskState, digest, verifyReceipt} from './coordinator.mjs';
import {validateTracking} from './tracking.mjs';
const identity=s=>s?.identity?.actor&&s?.identity?.tenant?JSON.stringify(s.identity):null;
const configuration=t=>({method:t.method,split:t.split,budgetMs:t.budgetMs,maxObservations:t.maxObservations});
export const SHARED_CONTINUATION_BLOCKED='Automatic continuation unavailable: shared stores lack transactional code/input/config deduplication. Use the existing manual controls.';
export async function binding(s,t) {
  const check=s.discussions.find(d=>d.id===t.dataCheckId&&d.tenant===t.tenant);
  if(!check||check.synthetic!==true||check.kind!=='data_check'||check.codeHash!==s.codeHash||check.hypothesisVersion!==t.hypothesisVersion||check.hypothesisId!==t.hypothesisId)throw Error('Current synthetic data check required');
  return {taskId:t.id,version:t.hypothesisVersion,code:s.codeHash,data:check.dataHash,config:await digest(configuration(t))};
}
export async function selectApproved(s,approvals,now=Date.now()) {
  const verified=new Map();
  for(const r of s.receipts){
    const t=s.tasks.find(t=>t.id===r.taskId);
    // Any receipt uncertainty stops selection, including old versions: reconcile first.
    await verifyReceipt(s,t,r);verified.set(t.id,r);
    if(r.outcome==='failure')throw Error('Canonical failure receipt; owner reconciliation required');
  }
  for(const a of approvals){
    const t=s.tasks.find(t=>t.id===a.taskId);
    if(!t||JSON.stringify(await binding(s,t))!==JSON.stringify(a.binding))throw Error('Approved task changed; reapproval required');
    if(s.discussions.some(d=>d.hypothesisId===t.hypothesisId&&['finding','owner_decision'].includes(d.kind)&&d.hypothesisVersion===t.hypothesisVersion))throw Error('Owner decision boundary; stopped');
    if(verified.has(t.id))continue;
    const status=taskState(s,t,now);
    if(status==='stale')throw Error('Stale approved version; stopped');
    if(!['queued','owned','expired'].includes(status))continue;
    if(t.split!=='discovery'||t.method!=='descriptive-cohorts-v1')throw Error('Unsupported adapter');
    const check=s.discussions.find(d=>d.id===t.dataCheckId);
    if(!Number.isInteger(t.budgetMs)||t.budgetMs<1||t.budgetMs>5000||!Number.isInteger(t.maxObservations)||t.maxObservations<1||t.maxObservations>100000||!Number.isInteger(check.observations)||check.observations>t.maxObservations)throw Error('Task/data budget invalid');
    if(a.dependencies.some(id=>!verified.has(id)||verified.get(id).outcome==='failure'))continue;
    // Duplicate work is defined by executed input/code/config, not task UUID.
    if(s.receipts.some(r=>r.hashes.code===a.binding.code&&r.hashes.data===a.binding.data&&r.hashes.config===a.binding.config))continue;
    let leasedDuplicate=false;
    for(const other of s.tasks.filter(x=>x.id!==t.id&&x.lease?.expiresAt>now)){
      const b=await binding(s,other);
      if(b.code===a.binding.code&&b.data===a.binding.data&&b.config===a.binding.config)leasedDuplicate=true;
    }
    if(leasedDuplicate)continue;
    return t;
  }
  return null;
}
export function createContinuation(client,{now=Date.now,onStatus=()=>{},maxRuns=3,maxMs=30000,backoffMs=60000}={}) {
  if(!Number.isInteger(maxRuns)||maxRuns<1||maxRuns>3||!Number.isFinite(maxMs)||maxMs<1||maxMs>30000||backoffMs<60000)throw Error('Invalid continuation budget');
  let approvals=[],owner=null,input=null,active=false,flight=null,started=0,count=0,blocked=false,retryAt=0;
  const report=reason=>onStatus({active,reason,count,label:'Session-bound, not 24/7'});
  const stop=(reason='Stopped by owner')=>{active=false;report(reason);};
  const isolated=s=>{if(client.mode!=='browser'||s?.identity?.kind!=='demo'||s?.mode!=='browser-memory-demo')throw Error(SHARED_CONTINUATION_BLOCKED);};
  const check=()=>{if(client.mode!=='browser')throw Error(SHARED_CONTINUATION_BLOCKED);if(!active)throw Error('Continuation stopped');if(now()-started>=maxMs)throw Error('Session time budget exhausted');};
  const state=async()=>{const s=await client.state();if(identity(s)!==owner)throw Error('Identity/session changed');isolated(s);return s;};
  const coordinator=createCoordinator({state,command:async(type,payload,key)=>{
    check();const s=await state();check();
    const t=await selectApproved(s,approvals,now());check();
    if(t?.id!==payload.taskId)throw Error('Selection changed; reconcile before continuing');
    return client.command(type,payload,key);
  }},{now});
  return {
    stop,
    clear(){stop('Identity/session lost');approvals=[];owner=null;input=null;blocked=true;coordinator.clear();},
    async approve(taskId,tracking,dependencies=[]) {
      if(flight||blocked)throw Error('Stop or reconcile the previous session first');
      const s=await client.state(),who=identity(s);
      if(!who||!['users','local','demo'].includes(s.identity.kind))throw Error('Signed session required');
      if(owner&&owner!==who){this.clear();throw Error('Identity changed');}
      const checked=validateTracking(tracking);
      if(checked.provenance.kind!=='synthetic'||checked.split!=='discovery')throw Error('Synthetic discovery only');
      const frozen=structuredClone(tracking),data=await digest(frozen),t=s.tasks.find(t=>t.id===taskId);
      if(!t||!['queued','owned','expired'].includes(taskState(s,t,now())))throw Error('Task unavailable for approval');
      const b=await binding(s,t);
      if(b.data!==data||input&&await digest(input)!==data)throw Error('Input changed; use a fresh session');
      if(!Array.isArray(dependencies)||dependencies.some(id=>typeof id!=='string'||id===taskId||!s.tasks.some(t=>t.id===id)))throw Error('Invalid dependencies');
      owner=who;input=frozen;approvals=approvals.filter(a=>a.taskId!==taskId);
      approvals.push({taskId,binding:b,dependencies:[...dependencies]});report(`${approvals.length} exact task(s) approved in this tab`);
    },
    start(){
      // No client-side lease read, BroadcastChannel or browser lock can fence
      // another device. Until the server has execution-identity uniqueness,
      // automatic continuation is limited to the unshared browser demo.
      if(client.mode!=='browser'){stop(SHARED_CONTINUATION_BLOCKED);throw Error(SHARED_CONTINUATION_BLOCKED);}
      if(flight)return flight;
      if(blocked||now()<retryAt)throw Error('Stopped after failure or uncertainty; reconcile and reload before reapproval');
      if(!approvals.length)throw Error('Explicit task approval required');
      active=true;started=now();count=0;report('Running approved synthetic tasks');
      flight=(async()=>{
        try {
          while(active){
            check();if(count>=maxRuns){stop('Run budget exhausted');break;}
            const s=await state();check();const t=await selectApproved(s,approvals,now());check();
            if(!t){stop('No eligible approved tasks');break;}
            const result=await coordinator.run(t.id,input);count++;
            if(result.status==='failed')throw Error('Canonical failure receipt; no automatic retry');
            if(active)report('Verified synthetic receipt; checking next task');
          }
        } catch(error){blocked=true;retryAt=now()+backoffMs;stop(error.message+'; reconciliation required. No automatic retry.');}
        finally{active=false;flight=null;}
      })();return flight;
    }
  };
}
