import {validateTracking, summarize} from './tracking.mjs';
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
  const fields={hypothesis:['id','expectedVersion','title','method','status','family',...HYPOTHESIS_DESIGN_FIELDS],evidence:['url','title','excerpt','kind'],discussion:['hypothesisId','kind','body','evidenceIds'],task:['hypothesisId','split','budgetMs','maxObservations'],claim:['taskId','leaseMs'],run:['taskId','leaseToken','tracking']}[type];
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
    requireThat(['note','challenge'].includes(p.kind),'Discussion kind required');
    requireThat(Array.isArray(p.evidenceIds)&&p.evidenceIds.length<=30,'Evidence IDs required');p.evidenceIds.forEach(id=>own('evidence',id));
    result={id:crypto.randomUUID(),...stamp,hypothesisId:h.id,kind:p.kind,body:text(p.body),evidenceIds:p.evidenceIds,
      independent:p.kind==='challenge'&&!h.revisions.some(r=>(r.subject||r.actor)===(principal.subject||principal.id)),trust:'untrusted content'};s.discussions.push(result);
  }
  if(type==='task') {
    const h=own('hypotheses',p.hypothesisId);
    requireThat(p.split==='discovery','Held-out execution unavailable');
    requireThat(Number.isInteger(p.budgetMs)&&p.budgetMs>=1&&p.budgetMs<=5000,'Runtime budget must be 1–5000ms');
    requireThat(Number.isInteger(p.maxObservations)&&p.maxObservations>=1&&p.maxObservations<=100000,'Observation budget invalid');
    result={id:crypto.randomUUID(),...stamp,hypothesisId:h.id,hypothesisVersion:h.revisions.length,method:'descriptive-cohorts-v1',split:p.split,
      requiredCapabilities:['experiment:run'],budgetMs:p.budgetMs,maxObservations:p.maxObservations,status:'queued',lease:null};s.tasks.push(result);
  }
  if(type==='claim') {
    const task=own('tasks',p.taskId);
    requireThat(task.requiredCapabilities.every(c=>principal.capabilities.includes(c)),'Runner capability denied');
    requireThat(task.status!=='completed'&&(!task.lease||task.lease.expiresAt<=now),'Task unavailable');
    requireThat(Number.isInteger(p.leaseMs)&&p.leaseMs>=100&&p.leaseMs<=60000,'Lease must be 100–60000ms');
    task.status='claimed';task.lease={owner:principal.id,token:crypto.randomUUID(),expiresAt:now+p.leaseMs};result=task;
  }
  if(type==='run') {
    const task=own('tasks',p.taskId);
    requireThat(task.status==='claimed'&&task.lease?.owner===principal.id&&task.lease.token===p.leaseToken&&task.lease.expiresAt>now,'Valid owned lease required');
    const started=performance.now();let outcome='success',summary=null,error=null,provenance=null,reason=null;
    try {
      const d=validateTracking(p.tracking);provenance=d.provenance;
      requireThat(d.provenance.kind==='synthetic','Verified-data adapter is not configured');
      requireThat(d.frames.reduce((n,f)=>n+f.entities.length,0)<=task.maxObservations,'Observation budget exceeded');
      summary=summarize(d);
      if(!summary.some(x=>x.speedCount>0)) outcome='null';
      // A comparison needs two cohorts with speed observations; one is not a null result.
      else if(summary.filter(x=>x.speedCount>0).length<2){outcome='inconclusive';reason='fewer_than_two_cohorts_with_speed_observations';}
      requireThat(performance.now()-started<=task.budgetMs,'Runtime budget exceeded');
    } catch(e) {outcome='failure';error=e.message;summary=null;reason=null;}
    result={id:crypto.randomUUID(),...stamp,taskId:task.id,hypothesisId:task.hypothesisId,hypothesisVersion:task.hypothesisVersion,
      split:task.split,synthetic:provenance?.kind==='synthetic',provenance,outcome,reason,error,summary,
      hashes:{data:(yield p.tracking),code:codeHash,config:(yield {method:task.method,split:task.split,budgetMs:task.budgetMs,maxObservations:task.maxObservations})},
      baseline:{kind:'none',note:'Cohort means are descriptive, not fitted baselines.'},
      uncertainty:{interval:null,note:'Repeated frame observations are dependent; no inferential interval or hypothesis verdict.'},
      limits:{runtimeMs:task.budgetMs,maxObservations:task.maxObservations},elapsedMs:performance.now()-started};
    result.receiptHash=yield result;s.receipts.push(result);task.status='completed';task.lease=null;
  }
  s.audit.push({id:crypto.randomUUID(),...stamp,type,resourceId:result.id,previousHash:s.audit.at(-1)?.hash||null});
  s.audit.at(-1).hash=yield s.audit.at(-1);
  s.idempotency.push({tenant,actor:principal.id,key,fingerprint,result:structuredClone(result)});
  return {state:s,result:structuredClone(result)};
}
