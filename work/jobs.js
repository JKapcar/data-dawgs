/* Private job harness. Flattened into the Worker; no connector grants or submissions.
 * Status vocabulary and the history fold are shared with the page through /jobs-core.js
 * (JOBS_CORE), which work/assemble.mjs injects into this block ahead of this file. */
const JOB_STAGES=JOBS_CORE.STAGES;
const JOB_OUTCOMES=JOBS_CORE.OUTCOMES;
// detail carries ids, indices and booleans only — never stored text.
const jobCheck=(ok,status,message,detail)=>{if(!ok)throw Object.assign(Error(message),{jobStatus:status,jobDetail:detail||null});};
function jobFields(x,keys){jobCheck(x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(x,k)),400,'invalid_fields');}
function jobText(x,max=200,empty=false){jobCheck(typeof x==='string'&&x.length<=max&&(empty||x.trim().length>0)&&!/[\u0000-\u001f]/.test(x),400,'invalid_text');}
function jobDate(x,nullable=false){if(nullable&&x===null)return;jobCheck(typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x&&Date.parse(x)<=Date.now(),400,'invalid_timestamp');}
function jobURL(x,nullable=false){if(nullable&&x===null)return;let u;try{u=new URL(x);}catch{}jobCheck(u&&u.protocol==='https:'&&!u.username&&!u.password&&x.length<=2000,400,'https_url_required');}
// One rule per listing field, shared by record.create and record.correct.
const JOB_LISTING_RULES=Object.freeze({
 employer_key:x=>jobCheck(typeof x==='string'&&/^[a-z0-9][a-z0-9-]{1,79}$/.test(x),400,'canonical_employer_key_required'),
 employer:x=>jobText(x),role:x=>jobText(x),requisition:x=>jobText(x),url:x=>jobURL(x),url_verified_at:x=>jobDate(x)
});
function jobRecord(d){
 jobFields(d,['employer_key','employer','role','requisition','url','url_verified_at','resume_version','next_action','blocker']);
 for(const k of JOBS_CORE.LISTING_FIELDS)JOB_LISTING_RULES[k](d[k]);
 for(const k of ['resume_version','next_action','blocker'])jobText(d[k],500,true);
 return d;
}
function jobStatus(d){
 jobFields(d,JOBS_CORE.STATUS_FIELDS);
 jobCheck(JOB_STAGES.includes(d.stage)&&JOB_OUTCOMES.includes(d.outcome),400,'invalid_status');
 jobDate(d.occurred_at);jobDate(d.verified_at);jobCheck(d.occurred_at<=d.verified_at,400,'verification_precedes_event');jobURL(d.evidence_url,true);
 for(const k of ['reason','next_action','blocker','resume_version'])jobText(d[k],500,true);
 jobCheck(['unknown','explicit','inferred'].includes(d.reason_kind),400,'invalid_reason_kind');
 jobCheck(d.reason_kind!=='unknown'||d.reason==='',400,'unknown_reason_must_be_empty');
 jobCheck(d.reason_kind==='unknown'||d.reason.length>0,400,'reason_required');
 jobCheck(d.reason_kind!=='explicit'||d.evidence_url,400,'explicit_reason_requires_evidence');
 jobCheck(!['submitted','interview','offer'].includes(d.stage)||d.evidence_url,400,'submission_or_decision_evidence_required');
 jobCheck(!['rejected','position_closed','accepted'].includes(d.outcome)||d.evidence_url,400,'decision_evidence_required');
 jobCheck(d.outcome!=='blocked_not_submitted'||(['opportunity','approved'].includes(d.stage)&&d.blocker),400,'invalid_blocked_status');
 jobCheck(d.outcome!=='no_later_decision'||['submitted','interview'].includes(d.stage),400,'invalid_unknown_status');
 jobCheck(!['rejected','position_closed','withdrawn','accepted'].includes(d.outcome)||d.stage==='closed',400,'closed_stage_required');
 jobCheck(d.stage!=='closed'||['rejected','position_closed','withdrawn','accepted'].includes(d.outcome),400,'closed_outcome_required');
 return d;
}
function jobEvent(d){jobFields(d,['id',...JOBS_CORE.STATUS_FIELDS]);jobText(d.id,80);const {id,...status}=d;jobStatus(status);return d;}
function jobEmpty(uid){return {version:1,owner_uid:uid,revision:0,updated_at:null,records:[],receipts:[],source:{health:'not_connected',last_verified_at:null,sync:'pending'}};}
function jobRow(state,id){jobText(id,80);const row=state.records.find(r=>r.id===id);jobCheck(row,404,'record_not_found');return row;}
// Archived records are read-only until restored; every log entry counts toward the cap.
function jobWritable(row){jobCheck(!JOBS_CORE.history(row).archived,409,'record_archived');jobCheck(row.events.length<300,409,'history_limit');}
// Archived records still count: re-adding an archived requisition points at it instead.
function jobDuplicate(state,identity,self){const hit=state.records.find(r=>r!==self&&JOBS_CORE.identityOf(r)===identity);jobCheck(!hit,409,'duplicate_requisition',hit?{duplicate_of:hit.id,archived:!!JOBS_CORE.history(hit).archived}:null);}
// Each operation mutates the in-memory state and returns the record id. Null prototype:
// an op name can never resolve to an inherited Object member.
const JOB_OPS=Object.assign(Object.create(null),{
 'record.create'(state,data,uid,now){
  const d=jobRecord(data),identity=JOBS_CORE.identityOf(d);jobDuplicate(state,identity,null);
  jobCheck(state.records.length<300,409,'record_limit');const id=crypto.randomUUID();
  state.records.push({id,identity,...d,created_at:now,events:[]});return id;
 },
 'event.append'(state,data,uid,now){
  const d=jobEvent(data),row=jobRow(state,d.id);jobWritable(row);
  const {timeline}=JOBS_CORE.history(row),last=timeline.at(-1);
  jobCheck(!last||d.occurred_at>=last.occurred_at,409,'older_evidence_requires_reconciliation');
  jobCheck(!last||JOBS_CORE.stageRank(d.stage)>=JOBS_CORE.stageRank(last.stage),409,'stage_regression_requires_reconciliation');
  jobCheck(d.outcome!=='blocked_not_submitted'||!timeline.some(e=>JOBS_CORE.SUBMISSION_STAGES.includes(e.stage)),409,'already_submitted');
  // A lost-response re-entry of the same fact is refused rather than recorded twice.
  jobCheck(!timeline.some(e=>JOBS_CORE.sameFact(e,d)),409,'duplicate_event');
  row.events.push({...d,recorded_at:now,actor_uid:uid});return row.id;
 },
 // Replaces or voids one earlier status entry. The original stays in the log; the
 // correction is its own attributable, dated entry with a required note.
 'event.correct'(state,data,uid,now){
  jobFields(data,['id','target','action','replacement','note']);
  const row=jobRow(state,data.id);jobWritable(row);
  jobCheck(Number.isSafeInteger(data.target)&&data.target>=0&&data.target<row.events.length&&JOBS_CORE.kindOf(row.events[data.target])==='status',400,'invalid_correction_target');
  jobCheck(data.action==='replace'||data.action==='void',400,'invalid_correction_action');jobText(data.note,500);
  const before=JOBS_CORE.history(row),prior=before.superseded.get(data.target),original=row.events[data.target];let entry;
  if(data.action==='void'){
   jobCheck(data.replacement===null,400,'invalid_fields');
   jobCheck(!prior||prior.action!=='void',409,'correction_changes_nothing');
   entry={kind:'correction',target:data.target,action:'void',note:data.note};
  }else{
   const r=jobStatus(data.replacement),effective=before.timeline.find(e=>e.at===data.target);
   // Only a NEW update with evidence can say an application reached the employer.
   jobCheck(JOBS_CORE.SUBMISSION_STAGES.includes(original.stage)||!JOBS_CORE.SUBMISSION_STAGES.includes(r.stage),409,'correction_cannot_create_submission');
   jobCheck(!effective||JOBS_CORE.STATUS_FIELDS.some(k=>effective[k]!==r[k]),409,'correction_changes_nothing');
   entry={kind:'correction',target:data.target,action:'replace',replacement:JOBS_CORE.pick(r,JOBS_CORE.STATUS_FIELDS),note:data.note};
  }
  const clash=JOBS_CORE.conflict(JOBS_CORE.history({events:[...row.events,entry]}).timeline);
  jobCheck(!clash,409,'correction_conflicts_with_history',clash?{conflict:clash}:null);
  row.events.push({...entry,recorded_at:now,actor_uid:uid});return row.id;
 },
 // Listing fields change in place; the log keeps every {from, to}.
 'record.correct'(state,data,uid,now){
  jobFields(data,['id','changes','note']);const row=jobRow(state,data.id);jobWritable(row);jobText(data.note,500);
  const c=data.changes;
  jobCheck(c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).length>0&&Object.keys(c).every(k=>JOBS_CORE.LISTING_FIELDS.includes(k)),400,'invalid_fields');
  for(const [k,v] of Object.entries(c))JOB_LISTING_RULES[k](v);
  const diff=Object.fromEntries(Object.entries(c).filter(([k,v])=>row[k]!==v).map(([k,v])=>[k,{from:row[k],to:v}]));
  jobCheck(Object.keys(diff).length>0,409,'correction_changes_nothing');
  const identity=JOBS_CORE.identityOf({...row,...Object.fromEntries(Object.entries(diff).map(([k,v])=>[k,v.to]))});jobDuplicate(state,identity,row);
  for(const [k,v] of Object.entries(diff))row[k]=v.to;row.identity=identity;
  row.events.push({kind:'record_correction',changes:diff,note:data.note,recorded_at:now,actor_uid:uid});return row.id;
 },
 'record.archive'(state,data,uid,now){
  jobFields(data,['id','note']);const row=jobRow(state,data.id);jobText(data.note,500,true);
  jobCheck(!JOBS_CORE.history(row).archived,409,'already_archived');jobCheck(row.events.length<300,409,'history_limit');
  row.events.push({kind:'archive',note:data.note,recorded_at:now,actor_uid:uid});return row.id;
 },
 'record.restore'(state,data,uid,now){
  jobFields(data,['id','note']);const row=jobRow(state,data.id);jobText(data.note,500,true);
  jobCheck(JOBS_CORE.history(row).archived,409,'not_archived');jobCheck(row.events.length<300,409,'history_limit');
  row.events.push({kind:'restore',note:data.note,recorded_at:now,actor_uid:uid});return row.id;
 }
});
async function handleJobs(request,env){
 const url=new URL(request.url),origin=request.headers.get('Origin');
 const headers={'Content-Type':'application/json','Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Vary':'Origin, Authorization','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
 if(origin&&ORIGINS.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS'});
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
 try{
  jobCheck(!origin||ORIGINS.includes(origin),403,'origin_denied');jobCheck(!url.search,400,'query_denied');
  jobCheck(url.pathname==='/api/jobs/v1',404,'route_not_found');
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  jobCheck(['GET','POST'].includes(request.method),405,'method_denied');
  const uid=await poundIdentity(request,env);
  jobCheck(uid===env.RESEARCH_OWNER_UID,403,'configured_owner_required');
  jobCheck(env.JOB_HARNESS_ENABLED==='true',503,'private_setup_pending');
  const path='/privateJobs/v1/'+uid,saved=await fbGet(env,path,true);
  jobCheck(!saved.data||saved.data.owner_uid===uid,403,'owner_mismatch');
  const state=saved.data?JSON.parse(saved.data.payload):jobEmpty(uid);
  jobCheck(state.owner_uid===uid&&state.version===1,403,'owner_mismatch');
  const view=()=>{const {receipts,...workspace}=state;return {workspace};};
  if(request.method==='GET')return reply(view());
  const input=await poundBody(request);jobFields(input,['op','data','expected_revision','request_id']);
  jobCheck(typeof input.op==='string'&&Object.hasOwn(JOB_OPS,input.op),400,'invalid_operation');
  jobCheck(Number.isSafeInteger(input.expected_revision)&&input.expected_revision>=0&&/^[A-Za-z0-9_-]{16,80}$/.test(input.request_id),400,'invalid_revision_or_request');
  // The key names one logical operation; the revision is only its precondition. A retry
  // after a 409 re-read keeps the key, so an op that already committed replays instead
  // of being applied twice.
  const fingerprint=await poundHash(poundCanonical({op:input.op,data:input.data,request_id:input.request_id})),prior=state.receipts.find(r=>r.request_id===input.request_id);
  if(prior){jobCheck(prior.fingerprint===fingerprint,409,'request_id_reused');return reply({...view(),receipt:prior.result,replayed:true});}
  jobCheck(input.expected_revision===state.revision,409,'revision_conflict');
  // Preserve history and deduplication receipts: stop at the bounded capacity, never prune.
  jobCheck(state.receipts.length<2000,409,'workspace_full');
  const now=new Date().toISOString(),id=JOB_OPS[input.op](state,input.data,uid,now);
  state.revision++;state.updated_at=now;
  const result={id,revision:state.revision};state.receipts.push({request_id:input.request_id,fingerprint,result});
  const payload=JSON.stringify(state);jobCheck(new TextEncoder().encode(payload).length<=1048576,413,'workspace_full');
  jobCheck(saved.etag,503,'conditional_storage_unavailable');
  jobCheck(await poundIdentity(request,env)===uid,401,'sign_in_again');
  jobCheck(await fbPut(env,path,{owner_uid:uid,payload},saved.etag),409,'revision_conflict');
  return reply({...view(),receipt:result,replayed:false});
 }catch(e){const status=e.jobStatus||e.poundStatus;return reply({error:status?e.message:'jobs_unavailable',...(e.jobStatus&&e.jobDetail?e.jobDetail:{})},status||503);}
}
