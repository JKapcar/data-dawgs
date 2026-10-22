import {validateTracking, summarize} from './tracking.mjs';
import {experimentBasis,rerunBasis,executionConfig} from './execution-identity.mjs';
const requireThat = (ok, message) => {if (!ok) throw new Error(message);};
const text = (v,max=4000) => {requireThat(typeof v==='string' && v.trim().length>0 && v.length<=max,'Invalid text');return v;};
export const capabilities = ['hypothesis:write','evidence:write','discussion:write','task:write','task:claim','experiment:run'];
// Additive hypothesis/evidence fields (2026-10-16). State and envelope stay version 1.
export const HYPOTHESIS_STATUSES = ['exploratory','registered','confirmatory','supported','null','inconclusive','withdrawn'];
export const HYPOTHESIS_FAMILIES = ['speed-retention','accel-decel-cut','missingness','external-market','other'];
export const HYPOTHESIS_DESIGN_FIELDS = ['target','predictionTime','cohort','featureCutoff','splitPolicy','baseline','metric','exclusions'];
export const EVIDENCE_KINDS = ['paper','data','code','post','other'];
// Registration and verdicts belong to the signed owner. Anyone else who may write a
// hypothesis can propose (exploratory) or withdraw, never register or grade.
const OWNER_ONLY_STATUSES = ['registered','confirmatory','supported','null','inconclusive'];
export function initialState() {return {version:1, hypotheses:[], evidence:[], discussions:[], tasks:[], receipts:[], audit:[], idempotency:[]};}
export function view(state, principal) {
  requireThat(principal?.tenant && principal?.id,'Trusted principal required');
  return Object.fromEntries(['hypotheses','evidence','discussions','tasks','receipts','audit'].map(k=>[k,structuredClone(state[k].filter(x=>x.tenant===principal.tenant))]));
}
export function* transitionSteps(state, principal, command, now=Date.now(), codeHash='unconfigured') {
  requireThat(principal?.tenant && principal?.id && Array.isArray(principal.capabilities),'Trusted principal required');
  requireThat(command&&typeof command==='object'&&!Array.isArray(command)&&Object.keys(command).every(k=>['type','key','payload'].includes(k)),'Invalid command');
  const s=structuredClone(state), tenant=principal.tenant;
  const {type, key, payload:p={}}=command;
  const fields={hypothesis:['id','expectedVersion','title','method','status','family',...HYPOTHESIS_DESIGN_FIELDS],evidence:['url','title','excerpt','kind'],discussion:['hypothesisId','kind','body','evidenceIds','hypothesisVersion','tracking','receiptId','receiptHash','reviewId','findingId','disposition'],task:['hypothesisId','split','budgetMs','maxObservations','dataCheckId','rerunOf','rerunReason'],claim:['taskId','leaseMs'],run:['taskId','leaseToken','tracking']}[type];
  requireThat(fields&&p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).every(k=>fields.includes(k)),'Invalid payload fields');
  text(key,160);
  const scope={hypothesis:'hypothesis:write',evidence:'evidence:write',discussion:'discussion:write',task:'task:write',claim:'task:claim',run:'experiment:run'}[type];
  requireThat(scope && principal.capabilities.includes(scope),'Capability denied');
  const fingerprint=yield {type,p};
  const replay=s.idempotency.find(x=>x.tenant===tenant && x.actor===principal.id && x.key===key);
  if(replay) {requireThat(replay.fingerprint===fingerprint,'Idempotency key conflict');return {state:s,result:structuredClone(replay.result)};}
  const own=(collection,id)=>{const x=s[collection].find(x=>x.tenant===tenant&&x.id===id);requireThat(x,'Resource unavailable');return x;};
  // credential_label: server-verified connector key label; null for signed sessions and synthetic runs.
  const stamp={tenant,actor:principal.id,subject:principal.subject||principal.id,at:new Date(now).toISOString(),credential_label:typeof principal.credentialLabel==='string'?principal.credentialLabel:null,...(principal.authorLabel?{author_label:principal.authorLabel,author_label_trust:'unverified'}:{})};
  const staleTaskReason=task=>{
    if(!task.dataCheckId)return null;
    const h=own('hypotheses',task.hypothesisId),check=own('discussions',task.dataCheckId);
    if(h.revisions.length!==task.hypothesisVersion)return 'hypothesis_version_changed';
    if(h.revisions.at(-1).status==='withdrawn')return 'hypothesis_withdrawn';
    if(check.codeHash!==codeHash)return 'implementation_changed';
    return null;
  };
  // These reservations live inside the same tenant state/CAS as task leases,
  // receipts and grants. Different task IDs cannot own the same attempt at once.
  function* experiment(task,data,code=codeHash){
    const check=task.dataCheckId&&own('discussions',task.dataCheckId);
    return yield experimentBasis(task,code,check?check.dataHash:data);
  }
  function* execution(task,data,code=codeHash){
    const experimentId=yield* experiment(task,data,code);
    const executionId=task.rerunOf?(yield rerunBasis(experimentId,task.rerunOf)):experimentId;
    return {experimentId,executionId};
  }
  function* terminal(r){
    const task=own('tasks',r.taskId),{receiptHash,...body}=r;
    requireThat((yield body)===receiptHash,'Execution receipt integrity conflict; reconcile');
    requireThat(r.hypothesisId===task.hypothesisId&&r.hypothesisVersion===task.hypothesisVersion&&r.split===task.split&&['success','null','inconclusive','failure'].includes(r.outcome)&&['completed','stale'].includes(task.status)&&r.hashes?.config===(yield executionConfig(task))&&/^[a-f0-9]{64}$/.test(r.hashes?.data),'Execution receipt linkage conflict; reconcile');
    const experimentId=yield* experiment(task,r.hashes.data,r.hashes.code);
    const executionId=task.rerunOf?(yield rerunBasis(experimentId,task.rerunOf)):experimentId;
    requireThat(r.executionId===undefined&&r.experimentId===undefined||r.executionId===executionId&&r.experimentId===experimentId,'Execution receipt identity conflict; reconcile');
    return {experimentId,executionId};
  }
  function* available(task,ids){
    for(const r of s.receipts.filter(r=>r.tenant===tenant&&r.hypothesisId===task.hypothesisId&&r.hypothesisVersion===task.hypothesisVersion&&r.execution!=='not_executed')){
      const previous=yield* terminal(r);
      requireThat(previous.executionId!==ids.executionId,'Experiment terminal conflict; explicit owner rerun required');
    }
    for(const other of s.tasks.filter(t=>t.tenant===tenant&&t.id!==task.id&&t.lease?.expiresAt>now)){
      // Legacy unbound tasks cannot reserve input identity at claim time. Their
      // run still checks receipts atomically; continuation requires a data check.
      if(!other.dataCheckId&&!other.executionId)continue;
      const previous=other.dataCheckId?yield* execution(other,undefined,own('discussions',other.dataCheckId).codeHash):other;
      requireThat(!other.executionId||other.executionId===previous.executionId,'Execution reservation integrity conflict; reconcile');
      requireThat(previous.executionId!==ids.executionId,'Experiment lease unavailable');
    }
  }
  let result;
  if(type==='hypothesis') {
    const previous=p.id?own('hypotheses',p.id):null;
    if(previous) requireThat(p.expectedVersion===previous.revisions.length,'Revision conflict');
    const status=p.status===undefined?'exploratory':p.status;
    requireThat(HYPOTHESIS_STATUSES.includes(status),'Invalid hypothesis status');
    requireThat(!OWNER_ONLY_STATUSES.includes(status)||principal.signedOwner===true,'Only the signed owner may set status '+status);
    requireThat(p.family===undefined||HYPOTHESIS_FAMILIES.includes(p.family),'Invalid hypothesis family');
    const design=Object.fromEntries(HYPOTHESIS_DESIGN_FIELDS.filter(k=>p[k]!==undefined).map(k=>[k,text(p[k],500)]));
    const revision={version:(previous?.revisions.length||0)+1,title:text(p.title,200),method:text(p.method),status,...(p.family!==undefined?{family:p.family}:{}),...design,...stamp};
    if(previous) {previous.revisions.push(revision);result=previous;} else {result={id:crypto.randomUUID(),tenant,revisions:[revision]};s.hypotheses.push(result);}
  }
  if(type==='evidence') {
    const url=new URL(text(p.url,2000)); requireThat(['http:','https:'].includes(url.protocol),'Citation URL must be http(s)');
    requireThat(p.kind===undefined||EVIDENCE_KINDS.includes(p.kind),'Invalid evidence kind');
    result={id:crypto.randomUUID(),...stamp,url:url.href,title:text(p.title,200),excerpt:text(p.excerpt),kind:p.kind??'other',assessment:'unverified source claim'};s.evidence.push(result);
  }
  if(type==='discussion') {
    const h=own('hypotheses',p.hypothesisId);
    requireThat(['note','challenge','data_check','review','finding','owner_decision','advisory_review'].includes(p.kind),'Discussion kind required');
    requireThat(Array.isArray(p.evidenceIds)&&p.evidenceIds.length<=30,'Evidence IDs required');p.evidenceIds.forEach(id=>own('evidence',id));
    const workflow=['data_check','review','finding','owner_decision'].includes(p.kind);
    const extra={};
    if(workflow){
      requireThat(p.hypothesisVersion===h.revisions.length,'Stale hypothesis version');
      requireThat(h.revisions.at(-1).status!=='withdrawn','Hypothesis withdrawn');
      extra.hypothesisVersion=p.hypothesisVersion;
      extra.workflow='bounded-synthetic-v1';
      const allowed={data_check:['tracking'],review:['receiptId','receiptHash','disposition'],finding:['receiptId','receiptHash','reviewId'],owner_decision:['receiptId','receiptHash','reviewId','findingId','disposition']}[p.kind];
      requireThat(Object.keys(p).every(k=>['hypothesisId','kind','body','evidenceIds','hypothesisVersion',...allowed].includes(k)),'Fields do not match workflow stage');
      if(p.kind==='data_check'){
        const d=validateTracking(p.tracking);
        requireThat(d.provenance.kind==='synthetic'&&d.split==='discovery','Synthetic discovery only');
        extra.codeHash=codeHash;extra.dataHash=yield p.tracking;extra.synthetic=true;extra.baseline_fit=false;
        extra.observations=d.frames.reduce((n,f)=>n+f.entities.length,0);
      }else{
        const r=own('receipts',p.receiptId),task=own('tasks',r.taskId);
        requireThat(r.hypothesisId===h.id&&r.hypothesisVersion===p.hypothesisVersion&&r.receiptHash===p.receiptHash,'Receipt version mismatch');
        const {receiptHash,...receiptBody}=r;
        requireThat((yield receiptBody)===receiptHash,'Receipt integrity mismatch');
        requireThat(r.hashes.code===codeHash,'Receipt code changed; rerun current implementation');
        requireThat(task.dataCheckId&&r.synthetic===true&&r.outcome!=='failure','Bounded successful synthetic attempt required');
        Object.assign(extra,{receiptId:r.id,receiptHash:r.receiptHash,synthetic:true,baseline_fit:false});
        if(p.kind==='review'){
          const subject=principal.subject||principal.id;
          requireThat(!subject.startsWith('agent:'),'Delegated agent identity does not establish a separate account reviewer');
          requireThat(!h.revisions.some(v=>(v.subject||v.actor)===subject)&&(r.subject||r.actor)!==subject,'Separate verified subject required; labels do not establish independence');
          requireThat(['ready','changes_requested'].includes(p.disposition),'Review disposition required');
          extra.separation='distinct_account_subject_only';extra.disposition=p.disposition;
        }else{
          const review=own('discussions',p.reviewId);
          const advisory=review.kind==='advisory_review';
          requireThat((advisory||review.kind==='review'&&review.disposition==='ready')&&review.receiptId===r.id&&review.receiptHash===r.receiptHash&&review.hypothesisVersion===p.hypothesisVersion,'Ready receipt-specific review or explicit advisory required');
          requireThat(s.discussions.filter(d=>['review','advisory_review'].includes(d.kind)&&d.receiptId===r.id).at(-1)?.id===review.id,'Review superseded');
          Object.assign(extra,{reviewId:review.id,reviewMode:advisory?'advisory_not_independent':'distinct_account_subject_only',separateAccountReviewSatisfied:!advisory,scientificGate:'not_satisfied',holdout:'unavailable'});
          if(p.kind==='owner_decision'){
            requireThat(principal.signedOwner===true,'Signed owner decision required');
            const finding=own('discussions',p.findingId);
            requireThat(finding.kind==='finding'&&finding.reviewId===review.id&&finding.receiptId===r.id&&finding.hypothesisVersion===p.hypothesisVersion,'Current finding required');
            requireThat(s.discussions.filter(d=>d.kind==='finding'&&d.reviewId===review.id).at(-1)?.id===finding.id,'Finding superseded');
            requireThat(['accept_descriptive','revise','defer'].includes(p.disposition),'Owner disposition required');
            requireThat(!s.discussions.some(d=>d.kind==='owner_decision'&&d.findingId===finding.id),'Finding already decided');
            Object.assign(extra,{findingId:finding.id,disposition:p.disposition,ownerAuthorized:true,execution:'not_executed'});
          }
        }
      }
    }else if(p.kind==='advisory_review'){
      requireThat(Object.keys(p).every(k=>['hypothesisId','hypothesisVersion','kind','body','evidenceIds','receiptId','receiptHash'].includes(k)),'Fields do not match advisory review');
      requireThat(p.hypothesisVersion===h.revisions.length,'Stale hypothesis version');
      Object.assign(extra,{hypothesisVersion:p.hypothesisVersion,separation:'advisory_not_independent',authority:'nonbinding'});
      if(p.receiptId!==undefined||p.receiptHash!==undefined){
        const r=own('receipts',p.receiptId),{receiptHash,...body}=r;
        requireThat(r.hypothesisId===h.id&&r.hypothesisVersion===p.hypothesisVersion&&r.receiptHash===p.receiptHash,'Receipt version mismatch');
        requireThat((yield body)===receiptHash,'Receipt integrity mismatch');
        Object.assign(extra,{receiptId:r.id,receiptHash,sourceCodeHash:r.hashes.code});
      }
    }else requireThat(Object.keys(p).every(k=>['hypothesisId','kind','body','evidenceIds'].includes(k)),'Fields do not match discussion');
    result={id:crypto.randomUUID(),...stamp,...extra,hypothesisId:h.id,kind:p.kind,body:text(p.body),evidenceIds:p.evidenceIds,
      independent:p.kind==='challenge'&&!h.revisions.some(r=>(r.subject||r.actor)===(principal.subject||principal.id)),trust:'untrusted content'};s.discussions.push(result);
  }
  if(type==='task') {
    const h=own('hypotheses',p.hypothesisId);
    requireThat(p.split==='discovery','Held-out execution unavailable');
    requireThat(Number.isInteger(p.budgetMs)&&p.budgetMs>=1&&p.budgetMs<=5000,'Runtime budget must be 1–5000ms');
    requireThat(Number.isInteger(p.maxObservations)&&p.maxObservations>=1&&p.maxObservations<=100000,'Observation budget invalid');
    if(p.dataCheckId!==undefined){
      const check=own('discussions',p.dataCheckId);
      requireThat(check.kind==='data_check'&&check.hypothesisId===h.id&&check.hypothesisVersion===h.revisions.length&&check.synthetic===true,'Current synthetic data check required');
      requireThat(check.codeHash===codeHash,'Data check code changed');
      requireThat(check.observations<=p.maxObservations,'Observation budget exceeded');
      requireThat(h.revisions.at(-1).status!=='withdrawn','Hypothesis withdrawn');
    }
    result={id:crypto.randomUUID(),...stamp,...(p.dataCheckId?{dataCheckId:p.dataCheckId}:{}),hypothesisId:h.id,hypothesisVersion:h.revisions.length,method:'descriptive-cohorts-v1',split:p.split,
      requiredCapabilities:['experiment:run'],budgetMs:p.budgetMs,maxObservations:p.maxObservations,status:'queued',lease:null};
    if(p.rerunOf!==undefined||p.rerunReason!==undefined){
      requireThat(principal.signedOwner===true,'Signed owner rerun denied');
      requireThat(result.dataCheckId,'Current data check required for rerun');
      const prior=own('receipts',p.rerunOf),ids=yield* terminal(prior),experimentId=yield* experiment(result);
      requireThat(prior.execution!=='not_executed','Prior attempt was not executed; queue normally');
      requireThat(ids.experimentId===experimentId,'Rerun must match current experiment; queue changed experiments normally');
      requireThat(!s.receipts.some(r=>r.tenant===tenant&&s.tasks.some(t=>t.id===r.taskId&&t.rerunOf===prior.id)),'Rerun successor already terminal; select its receipt');
      Object.assign(result,{rerunOf:prior.id,rerunReason:text(p.rerunReason,500),rerunAuthorizedBy:principal.id});
    }
    if(result.dataCheckId)Object.assign(result,yield* execution(result));
    s.tasks.push(result);
  }
  if(type==='claim') {
    const task=own('tasks',p.taskId);
    requireThat(task.requiredCapabilities.every(c=>principal.capabilities.includes(c)),'Runner capability denied');
    requireThat(!['completed','stale'].includes(task.status),'Task unavailable');
    requireThat(Number.isInteger(p.leaseMs)&&p.leaseMs>=100&&p.leaseMs<=60000,'Lease must be 100–60000ms');
    const staleReason=staleTaskReason(task);
    if(staleReason)Object.assign(task,{status:'stale',lease:null,staleReason,staleAt:stamp.at});
    else {
      requireThat(!task.lease||task.lease.expiresAt<=now,'Task unavailable');
      if(task.dataCheckId){
        const ids=yield* execution(task);yield* available(task,ids);
        // Fence every expired equivalent claim when ownership transfers. Old
        // tokens cannot execute after a different task takes the reservation.
        for(const other of s.tasks.filter(t=>t.tenant===tenant&&t.id!==task.id&&t.lease&&t.lease.expiresAt<=now)){
          if(other.executionId===ids.executionId){other.lease=null;other.status='queued';}
        }
        Object.assign(task,ids);
      }
      task.status='claimed';task.lease={owner:principal.id,token:crypto.randomUUID(),expiresAt:now+p.leaseMs};
    }
    result=task;
  }
  if(type==='run') {
    const task=own('tasks',p.taskId);
    requireThat(task.status==='claimed'&&task.lease?.owner===principal.id&&task.lease.token===p.leaseToken&&task.lease.expiresAt>now,'Valid owned lease required');
    const staleReason=staleTaskReason(task);
    const ids=yield* execution(task,yield p.tracking);
    // Never run an old lease against changed code or input identity. Stale runs
    // retain the preexisting not_executed receipt behavior for audit history.
    if(!staleReason){
      requireThat(!task.executionId||task.executionId===ids.executionId,'Execution identity conflict; reclaim required');
      yield* available(task,ids);
    }
    const started=performance.now();let outcome='success',summary=null,error=null,provenance=null,reason=null;
    try {
      requireThat(!staleReason,'Stale task: '+staleReason);
      const d=validateTracking(p.tracking);provenance=d.provenance;
      if(task.dataCheckId)requireThat((yield p.tracking)===own('discussions',task.dataCheckId).dataHash,'Data changed since check');
      requireThat(d.provenance.kind==='synthetic','Verified-data adapter is not configured');
      requireThat(d.frames.reduce((n,f)=>n+f.entities.length,0)<=task.maxObservations,'Observation budget exceeded');
      summary=summarize(d);
      if(!summary.some(x=>x.speedCount>0)) outcome='null';
      // A comparison needs two cohorts with speed observations; one is not a null result.
      else if(summary.filter(x=>x.speedCount>0).length<2){outcome='inconclusive';reason='fewer_than_two_cohorts_with_speed_observations';}
      requireThat(performance.now()-started<=task.budgetMs,'Runtime budget exceeded');
    } catch(e) {outcome='failure';error=e.message;summary=null;reason=null;}
    if(staleReason)reason=staleReason;
    result={id:crypto.randomUUID(),...stamp,...ids,...(staleReason?{execution:'not_executed'}:{}),taskId:task.id,hypothesisId:task.hypothesisId,hypothesisVersion:task.hypothesisVersion,
      split:task.split,synthetic:provenance?.kind==='synthetic',provenance,outcome,reason,error,summary,
      hashes:{data:(yield p.tracking),code:codeHash,config:(yield executionConfig(task))},
      baseline:{kind:'none',note:'Cohort means are descriptive, not fitted baselines.'},
      uncertainty:{interval:null,note:'Repeated frame observations are dependent; no inferential interval or hypothesis verdict.'},
      limits:{runtimeMs:task.budgetMs,maxObservations:task.maxObservations},elapsedMs:performance.now()-started};
    result.receiptHash=yield result;s.receipts.push(result);task.status=staleReason?'stale':'completed';task.lease=null;
    if(staleReason)Object.assign(task,{staleReason,staleAt:stamp.at});
  }
  s.audit.push({id:crypto.randomUUID(),...stamp,type,resourceId:result.id,previousHash:s.audit.at(-1)?.hash||null});
  s.audit.at(-1).hash=yield s.audit.at(-1);
  s.idempotency.push({tenant,actor:principal.id,key,fingerprint,result:structuredClone(result)});
  return {state:s,result:structuredClone(result)};
}
