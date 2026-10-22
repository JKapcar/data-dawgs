// Foreground convenience only. All authority remains in the existing gateway.
import {createCoordinator, taskState, digest, verifyReceipt} from './coordinator.mjs';
import {validateTracking} from './tracking.mjs';
import {EXECUTION_POLICY,experimentBasis,rerunBasis} from './execution-identity.mjs';
const identity=s=>s?.identity?.actor&&s?.identity?.tenant?JSON.stringify(s.identity):null;
const configuration=t=>({method:t.method,split:t.split,budgetMs:t.budgetMs,maxObservations:t.maxObservations});
export const SHARED_CONTINUATION_BLOCKED='Automatic continuation unavailable: server execution-identity guarantee not verified. Use the existing manual controls.';
export const continuationAvailable=(s,mode)=>s?.executionPolicy===EXECUTION_POLICY&&s?.identity?.kind===({hosted:'users',local:'local',browser:'demo'}[mode])&&['hosted','local','browser'].includes(mode);
export async function binding(s,t) {
  const check=s.discussions.find(d=>d.id===t.dataCheckId&&d.tenant===t.tenant);
  if(!check||check.synthetic!==true||check.kind!=='data_check'||check.codeHash!==s.codeHash||check.hypothesisVersion!==t.hypothesisVersion||check.hypothesisId!==t.hypothesisId)throw Error('Current synthetic data check required');
  const experimentId=await digest(experimentBasis(t,s.codeHash,check.dataHash));
  const executionId=t.rerunOf?await digest(rerunBasis(experimentId,t.rerunOf)):experimentId;
  if(t.executionId&&(t.executionId!==executionId||t.experimentId!==experimentId))throw Error('Execution identity changed; reconcile');
  return {taskId:t.id,version:t.hypothesisVersion,code:s.codeHash,data:check.dataHash,config:await digest(configuration(t)),experimentId,executionId};
}
// Failed attempts can have malformed input/provenance. Their canonical identity
// and checksum establish terminal failure, never successful scientific evidence.
async function terminalReceipt(s,t,r,b){
  if((r.executionId!==undefined||r.experimentId!==undefined)&&(r.executionId!==b.executionId||r.experimentId!==b.experimentId))throw Error('Receipt execution identity mismatch; reconcile');
  if(r.outcome!=='failure')return verifyReceipt(s,t,r);
  try{return await verifyReceipt(s,t,r);}catch(error){
    const {receiptHash,...body}=r;
    if(t.status!=='completed'||r.execution==='not_executed'||r.tenant!==s.identity.tenant||r.taskId!==t.id||r.hypothesisId!==t.hypothesisId||r.hypothesisVersion!==t.hypothesisVersion||r.split!=='discovery'||r.experimentId!==b.experimentId||r.executionId!==b.executionId||r.hashes?.code!==b.code||r.hashes?.config!==b.config||!/^[a-f0-9]{64}$/.test(r.hashes?.data)||await digest(body)!==receiptHash||s.receipts.filter(x=>x.taskId===t.id).length!==1)throw error;
    return r;
  }
}
export async function selectApproved(s,approvals,now=Date.now()) {
  const bindings=new Map();
  for(const a of approvals){
    const t=s.tasks.find(t=>t.id===a.taskId);
    if(!t||JSON.stringify(await binding(s,t))!==JSON.stringify(a.binding))throw Error('Approved task changed; reapproval required');
    if(taskState(s,t,now)==='stale')throw Error('Stale approved version; stopped');
    bindings.set(t.id,a.binding);
  }
  const verified=new Map(),terminals=new Map();
  for(const r of s.receipts){
    const t=s.tasks.find(t=>t.id===r.taskId);
    const related=approvals.some(a=>a.dependencies.includes(r.taskId)||s.tasks.some(task=>task.id===a.taskId&&task.hypothesisId===r.hypothesisId&&task.hypothesisVersion===r.hypothesisVersion&&a.binding.code===r.hashes?.code));
    if(!related)continue; // Unrelated/versioned history cannot authorize this run.
    if(r.execution==='not_executed')continue;
    if(!t)throw Error('Receipt task unavailable; reconcile');
    const b=await binding(s,t);await terminalReceipt(s,t,r,b);
    if(terminals.has(b.executionId))throw Error('Duplicate execution receipts; reconcile');
    terminals.set(b.executionId,r);verified.set(t.id,r);
  }
  for(const a of approvals){
    const t=s.tasks.find(t=>t.id===a.taskId),b=bindings.get(t.id),terminal=terminals.get(b.executionId);
    if(terminal){if(terminal.outcome==='failure')throw Error('Canonical failure receipt; explicit owner rerun required');continue;}
    const status=taskState(s,t,now);
    if(!['queued','owned','expired'].includes(status))continue;
    if(t.split!=='discovery'||t.method!=='descriptive-cohorts-v1')throw Error('Unsupported adapter');
    if(s.discussions.some(d=>d.hypothesisId===t.hypothesisId&&['finding','owner_decision'].includes(d.kind)&&d.hypothesisVersion===t.hypothesisVersion)&&!t.rerunOf)throw Error('Owner decision boundary; stopped');
    if(t.rerunOf){
      const prior=s.receipts.find(r=>r.id===t.rerunOf);
      if(!prior||!verified.has(prior.taskId)||!t.rerunAuthorizedBy||typeof t.rerunReason!=='string'||!t.rerunReason.trim())throw Error('Explicit owner rerun unavailable; reconcile');
    }
    const check=s.discussions.find(d=>d.id===t.dataCheckId);
    if(!Number.isInteger(t.budgetMs)||t.budgetMs<1||t.budgetMs>5000||!Number.isInteger(t.maxObservations)||t.maxObservations<1||t.maxObservations>100000||!Number.isInteger(check.observations)||check.observations>t.maxObservations)throw Error('Task/data budget invalid');
    if(a.dependencies.some(id=>!verified.has(id)||verified.get(id).outcome==='failure'))continue;
    let leasedDuplicate=false;
    for(const other of s.tasks.filter(x=>x.id!==t.id&&x.lease?.expiresAt>now)){
      if((await binding(s,other)).executionId===b.executionId)leasedDuplicate=true;
    }
    if(leasedDuplicate)continue;
    return t;
  }
  return null;
}
export function createContinuation(client,{now=Date.now,onStatus=()=>{},maxRuns=3,maxMs=30000,backoffMs=60000}={}) {
  if(!Number.isInteger(maxRuns)||maxRuns<1||maxRuns>3||!Number.isFinite(maxMs)||maxMs<1||maxMs>30000||backoffMs<60000)throw Error('Invalid continuation budget');
  let approvals=[],owner=null,input=null,active=false,flight=null,started=0,count=0,blocked=false,retryAt=0,approvedMode=null;
  const report=reason=>onStatus({active,reason,count,label:'Session-bound, not 24/7'});
  const stop=(reason='Stopped by owner')=>{active=false;report(reason);};
  const supported=s=>{if(!continuationAvailable(s,client.mode)||client.mode!==approvedMode)throw Error(SHARED_CONTINUATION_BLOCKED);};
  const check=()=>{if(client.mode!==approvedMode)throw Error(SHARED_CONTINUATION_BLOCKED);if(!active)throw Error('Continuation stopped');if(now()-started>=maxMs)throw Error('Session time budget exhausted');};
  const state=async()=>{const s=await client.state();if(identity(s)!==owner)throw Error('Identity/session changed');supported(s);return s;};
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
      if(!who||!continuationAvailable(s,client.mode))throw Error(SHARED_CONTINUATION_BLOCKED);
      if(approvedMode&&approvedMode!==client.mode)throw Error('Client mode changed');
      if(owner&&owner!==who){this.clear();throw Error('Identity changed');}
      const checked=validateTracking(tracking);
      if(checked.provenance.kind!=='synthetic'||checked.split!=='discovery')throw Error('Synthetic discovery only');
      const frozen=structuredClone(tracking),data=await digest(frozen),t=s.tasks.find(t=>t.id===taskId);
      if(!t||!['queued','owned','expired'].includes(taskState(s,t,now())))throw Error('Task unavailable for approval');
      const b=await binding(s,t);
      if(b.data!==data||input&&await digest(input)!==data)throw Error('Input changed; use a fresh session');
      if(!Array.isArray(dependencies)||dependencies.some(id=>typeof id!=='string'||id===taskId||!s.tasks.some(t=>t.id===id)))throw Error('Invalid dependencies');
      owner=who;approvedMode=client.mode;input=frozen;approvals=approvals.filter(a=>a.taskId!==taskId);
      approvals.push({taskId,binding:b,dependencies:[...dependencies]});report(`${approvals.length} exact task(s) approved in this tab`);
    },
    start(){
      // A prior approval and every subsequent read must verify the actual server
      // contract. No client override can enable an older gateway.
      if(approvedMode&&client.mode!==approvedMode){stop(SHARED_CONTINUATION_BLOCKED);throw Error(SHARED_CONTINUATION_BLOCKED);}
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
