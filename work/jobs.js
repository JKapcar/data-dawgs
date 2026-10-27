/* Private job harness. Flattened into the Worker; no connector grants or submissions.
 * Status vocabulary and the history fold are shared with the page through /jobs-core.js
 * (JOBS_CORE), which work/assemble.mjs injects into this block ahead of this file. */
const JOB_STAGES=JOBS_CORE.STAGES;
const JOB_OUTCOMES=JOBS_CORE.OUTCOMES;
// detail carries ids, indices and booleans only — never stored text.
const jobErrors=new WeakSet();
const jobCheck=(ok,status,message,detail)=>{if(!ok){const e=Object.assign(Error(message),{jobStatus:status,jobDetail:detail||null});jobErrors.add(e);throw e;}};
function jobFields(x,keys,optional=[]){jobCheck(x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>keys.includes(k)||optional.includes(k))&&keys.every(k=>Object.hasOwn(x,k)),400,'invalid_fields');}
function jobText(x,max=200,empty=false){jobCheck(typeof x==='string'&&x.length<=max&&(empty||x.trim().length>0)&&!/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(x),400,'invalid_text');}
function jobDate(x,nullable=false){if(nullable&&x===null)return;jobCheck(typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x&&Date.parse(x)<=Date.now(),400,'invalid_timestamp');}
function jobURL(x,nullable=false){if(nullable&&x===null)return;jobCheck(typeof x==='string'&&x.length<=2000&&x===x.trim()&&!/[\u0000-\u0020\u007f\p{Cf}]/u.test(x),400,'https_url_required');let u;try{u=new URL(x);}catch{}jobCheck(u&&u.protocol==='https:'&&!u.username&&!u.password,400,'https_url_required');}
// One rule per listing field, shared by record.create and record.correct.
const JOB_LISTING_RULES=Object.freeze({
 employer_key:x=>jobCheck(typeof x==='string'&&/^[a-z0-9][a-z0-9-]{1,79}$/.test(x),400,'canonical_employer_key_required'),
 employer:x=>jobText(x),role:x=>{if(x!==null)jobText(x);},requisition:x=>{if(x!==null)jobText(x);},url:x=>jobURL(x,true),url_verified_at:x=>jobDate(x,true)
});
function jobRecord(d){
 jobFields(d,['employer_key','employer','role','requisition','url','url_verified_at','resume_version','next_action','blocker'],['source_id','record_type','provenance']);
 for(const k of JOBS_CORE.LISTING_FIELDS)JOB_LISTING_RULES[k](d[k]);
 if(d.source_id!==undefined)jobCheck(typeof d.source_id==='string'&&/^[A-Za-z0-9:_-]{1,160}$/.test(d.source_id),400,'invalid_source_identity');
 jobCheck(d.requisition!==null||d.source_id,400,'source_identity_required');
 jobCheck(d.url!==null||d.url_verified_at===null,400,'missing_url_cannot_be_verified');
 jobCheck(d.record_type===undefined||['job','contact'].includes(d.record_type),400,'invalid_record_type');
 if(d.provenance!==undefined){
  const p=d.provenance;jobFields(p,['kind','packet_sha256','entity_ids','snapshot']);
  jobCheck(p.kind==='audited_migration'&&typeof p.packet_sha256==='string'&&/^[a-f0-9]{64}$/.test(p.packet_sha256),400,'invalid_provenance');
  jobCheck(Array.isArray(p.entity_ids)&&p.entity_ids.length>0&&p.entity_ids.length<=10&&p.entity_ids.every(x=>typeof x==='string'&&/^[A-Za-z0-9:_-]{1,160}$/.test(x)),400,'invalid_provenance');
  jobCheck(p.snapshot&&typeof p.snapshot==='object'&&!Array.isArray(p.snapshot)&&JSON.stringify(p.snapshot).length<=16000,400,'invalid_provenance');
 }
 for(const k of ['resume_version','next_action','blocker'])jobText(d[k],500,true);
 return d;
}
function jobStatus(d){
 jobFields(d,JOBS_CORE.STATUS_FIELDS,['evidence']);
 jobCheck(JOB_STAGES.includes(d.stage)&&JOB_OUTCOMES.includes(d.outcome),400,'invalid_status');
 jobDate(d.occurred_at,true);jobDate(d.verified_at,true);jobCheck(!d.occurred_at||!d.verified_at||d.occurred_at<=d.verified_at,400,'verification_precedes_event');jobURL(d.evidence_url,true);
 jobCheck(!JOBS_CORE.SUBMISSION_STAGES.includes(d.stage)||(d.occurred_at&&d.verified_at),400,'submission_timestamps_required');
 if(d.evidence!==undefined){const e=d.evidence;jobFields(e,['kind','source_id','source_ref','precision','description']);jobCheck(['historical_portal_acknowledgment','audited_status'].includes(e.kind),400,'invalid_evidence_kind');for(const k of ['source_id','source_ref','description'])jobText(e[k],1000);jobCheck(['second','minute','unknown'].includes(e.precision),400,'invalid_evidence_precision');jobCheck(d.evidence_url===null,400,'ambiguous_evidence');}
 const evidence=d.evidence_url||d.evidence;
 for(const k of ['reason','next_action','blocker','resume_version'])jobText(d[k],500,true);
 jobCheck(['unknown','explicit','inferred'].includes(d.reason_kind),400,'invalid_reason_kind');
 jobCheck(d.reason_kind!=='unknown'||d.reason==='',400,'unknown_reason_must_be_empty');
 jobCheck(d.reason_kind==='unknown'||d.reason.length>0,400,'reason_required');
 jobCheck(d.reason_kind!=='explicit'||evidence,400,'explicit_reason_requires_evidence');
 jobCheck(!['submitted','interview','offer'].includes(d.stage)||evidence,400,'submission_or_decision_evidence_required');
 jobCheck(!['rejected','position_closed','no_current_match','accepted'].includes(d.outcome)||evidence,400,'decision_evidence_required');
 jobCheck(d.outcome!=='blocked_not_submitted'||(['opportunity','screened','approved','prepared'].includes(d.stage)&&d.blocker),400,'invalid_blocked_status');
 jobCheck(d.outcome!=='no_later_decision'||['submitted','interview'].includes(d.stage),400,'invalid_unknown_status');
 jobCheck(!['rejected','position_closed','no_current_match','withdrawn','accepted'].includes(d.outcome)||d.stage==='closed',400,'closed_stage_required');
 jobCheck(d.stage!=='closed'||['rejected','position_closed','no_current_match','withdrawn','accepted'].includes(d.outcome),400,'closed_outcome_required');
 return d;
}
function jobEvent(d){jobFields(d,['id',...JOBS_CORE.STATUS_FIELDS],['evidence']);jobText(d.id,80);const {id,...status}=d;jobStatus(status);return d;}
function jobEvidence(row,d){
 jobCheck(row.record_type!=='contact',400,'contact_has_no_application_status');
 if(!d.evidence)return;
 const e=d.evidence,p=row.provenance,s=p?.snapshot;
 jobCheck(p?.kind==='audited_migration'&&e.source_id===row.source_id,400,'unbound_private_evidence');
 if(e.kind==='historical_portal_acknowledgment'){
  const a=s?.application;
  jobCheck(a?.submission_confirmed===true&&a.submission_evidence_type==='historical_portal_success'&&a.receipt_url===null&&Array.isArray(a.source_notes)&&a.source_notes.includes(e.source_ref),400,'unverified_portal_acknowledgment');
  jobCheck(d.stage==='submitted'&&a.company===row.employer&&a.title===row.role&&a.requisition_id===row.requisition&&Number.isFinite(Date.parse(a.submitted_at_utc))&&new Date(a.submitted_at_utc).toISOString()===d.occurred_at&&e.precision===a.submission_timestamp_precision&&e.description===a.identity_and_evidence_limits,400,'portal_acknowledgment_mismatch');
 }else{
  const t=s?.target;
  jobCheck(t?.status==='closed_before_submission'&&Array.isArray(t.source_refs)&&t.source_refs.includes(e.source_ref)&&t.company===row.employer&&t.requisition_id===row.requisition&&d.stage==='closed'&&d.outcome==='position_closed'&&d.occurred_at===null&&e.precision==='unknown',400,'unverified_historical_status');
 }
}
function jobEmpty(uid){return {version:1,owner_uid:uid,revision:0,updated_at:null,records:[],receipts:[],source:{health:'not_connected',last_verified_at:null,sync:'pending'}};}
function jobRow(state,id){jobText(id,80);const row=state.records.find(r=>r.id===id);jobCheck(row,404,'record_not_found');return row;}
// Archived records are read-only until restored; every log entry counts toward the cap.
function jobWritable(row){jobCheck(!JOBS_CORE.history(row).archived,409,'record_archived');jobCheck(row.events.length<300,409,'history_limit');}
// Archived records still count: re-adding an archived requisition points at it instead.
function jobDuplicate(state,identity,self){const hit=state.records.find(r=>r!==self&&JOBS_CORE.identityOf(r)===identity);jobCheck(!hit,409,'duplicate_requisition',hit?{duplicate_of:hit.id,archived:!!JOBS_CORE.history(hit).archived}:null);}
// Each operation mutates the in-memory state and returns the record id. Null prototype:
// an op name can never resolve to an inherited Object member.
const JOB_OPS=Object.assign(Object.create(null),{
 'work.update'(state,data,uid,now){
  jobFields(data,['id','details']);const row=jobRow(state,data.id);jobWritable(row);
  const d=data.details;jobFields(d,['match','gaps','resume_version','resume_sha256','answers_provenance','next_action','deadline']);
  for(const k of ['match','gaps','resume_version','answers_provenance','next_action'])jobText(d[k],500,true);
  jobCheck(typeof d.resume_sha256==='string'&&/^(|[a-f0-9]{64})$/.test(d.resume_sha256),400,'invalid_resume_hash');
  jobCheck(!d.resume_sha256||d.resume_version.trim(),400,'resume_version_required');
  jobCheck(d.deadline===null||(typeof d.deadline==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(d.deadline)&&Number.isFinite(Date.parse(d.deadline))&&new Date(d.deadline).toISOString()===d.deadline),400,'invalid_deadline');
  row.events.push({kind:'work_details',details:{...d},recorded_at:now,actor_uid:uid});return row.id;
 },
 'work.claim'(state,data,uid,now){
  jobFields(data,['id','actor_label']);const row=jobRow(state,data.id);jobWritable(row);jobText(data.actor_label,80);
  jobCheck(!JOBS_CORE.work(row).claim,409,'work_already_claimed');
  row.events.push({kind:'claim',claim_id:crypto.randomUUID(),actor_label:data.actor_label,actor_uid:uid,recorded_at:now});return row.id;
 },
 'work.release'(state,data,uid,now){
  jobFields(data,['id','note']);const row=jobRow(state,data.id);jobWritable(row);jobText(data.note,500);
  jobCheck(JOBS_CORE.work(row).claim,409,'work_not_claimed');
  row.events.push({kind:'release',note:data.note,actor_uid:uid,recorded_at:now});return row.id;
 },
 'record.create'(state,data,uid,now){
  const d=jobRecord(data),identity=JOBS_CORE.identityOf(d);jobDuplicate(state,identity,null);
  const sameSource=d.source_id&&state.records.find(r=>r.source_id===d.source_id);jobCheck(!sameSource,409,'duplicate_source_identity',sameSource?{duplicate_of:sameSource.id,archived:!!JOBS_CORE.history(sameSource).archived}:null);
  jobCheck(state.records.length<300,409,'record_limit');const id=crypto.randomUUID();
  state.records.push({id,identity,...d,created_at:now,events:[]});return id;
 },
 'event.append'(state,data,uid,now){
  const d=jobEvent(data),row=jobRow(state,d.id);jobWritable(row);jobEvidence(row,d);
  const {timeline}=JOBS_CORE.history(row),last=timeline.at(-1);
  const lastDated=timeline.filter(e=>e.occurred_at).at(-1);
  jobCheck(!lastDated||!d.occurred_at||d.occurred_at>=lastDated.occurred_at,409,'older_evidence_requires_reconciliation');
  jobCheck(!last||JOBS_CORE.stageRank(d.stage)>=JOBS_CORE.stageRank(last.stage),409,'stage_regression_requires_reconciliation');
  jobCheck(d.outcome!=='blocked_not_submitted'||!timeline.some(e=>JOBS_CORE.SUBMISSION_STAGES.includes(e.stage)),409,'already_submitted');
  // A lost-response re-entry of the same fact is refused rather than recorded twice.
  jobCheck(!timeline.some(e=>JOBS_CORE.sameFact(e,d)),409,'duplicate_event');
  row.events.push({...d,preparation:{...JOBS_CORE.work(row).details},recorded_at:now,actor_uid:uid});return row.id;
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
   const r=jobStatus(data.replacement),effective=before.timeline.find(e=>e.at===data.target);jobEvidence(row,r);
   // Only a NEW update with evidence can say an application reached the employer.
   jobCheck(JOBS_CORE.correctionMaySubmit(original,effective,r),409,'correction_cannot_create_submission');
   jobCheck(!effective||JOBS_CORE.STATUS_FIELDS.some(k=>effective[k]!==r[k]),409,'correction_changes_nothing');
   entry={kind:'correction',target:data.target,action:'replace',replacement:{...JOBS_CORE.pick(r,JOBS_CORE.STATUS_FIELDS),...(r.evidence?{evidence:r.evidence}:{})},note:data.note};
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
  jobCheck((Object.hasOwn(c,'url')?c.url:row.url)!==null||(Object.hasOwn(c,'url_verified_at')?c.url_verified_at:row.url_verified_at)===null,400,'missing_url_cannot_be_verified');
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
// Who may use the harness: the configured owner always; anyone else only when the non-secret
// JOB_HARNESS_MEMBER_UIDS lists their exact uid (comma-separated). Absent or empty means owner
// only, the v1 behaviour. Each identity gets its own envelope at /privateJobs/v1/<own uid>,
// derived from the verified session; nothing is shared, and a malformed list admits nobody extra.
function jobAccess(uid,env){
 if(uid===env.RESEARCH_OWNER_UID)return 'owner';
 const raw=typeof env.JOB_HARNESS_MEMBER_UIDS==='string'?env.JOB_HARNESS_MEMBER_UIDS.trim():'';
 if(!raw)return null;
 const list=raw.split(',').map(x=>x.trim());
 return list.every(x=>/^u_[A-Za-z0-9_-]{1,100}$/.test(x))&&list.includes(uid)?'member':null;
}
// Authenticated discovery describes the real HTTP API, not an installed MCP tool.
function jobSchema(){
 const text={type:'string',maxLength:500},id={type:'string',minLength:1,maxLength:80};
 const date={type:'string',format:'date-time'},url={type:'string',format:'uri',maxLength:2000,pattern:'^https://'};
 const object=(properties,optional={})=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties:{...properties,...optional}}),nullable=x=>({anyOf:[x,{type:'null'}]});
 const source_id={type:'string',pattern:'^[A-Za-z0-9:_-]{1,160}$'};
 const provenance=object({kind:{const:'audited_migration'},packet_sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},entity_ids:{type:'array',minItems:1,maxItems:10,items:source_id},snapshot:{type:'object',description:'Immutable private audit snapshot; serialized length at most 16000 characters. Not freshly retrieved or independently certified.'}});
 const evidence=object({kind:{enum:['historical_portal_acknowledgment','audited_status']},source_id,source_ref:{type:'string',minLength:1,maxLength:1000},precision:{enum:['second','minute','unknown']},description:{type:'string',minLength:1,maxLength:1000}});
 const listing={employer_key:{type:'string',pattern:'^[a-z0-9][a-z0-9-]{1,79}$'},employer:{...text,maxLength:200},role:nullable({...text,maxLength:200}),requisition:nullable({...text,maxLength:200}),url:nullable(url),url_verified_at:nullable(date)};
 const status={stage:{enum:JOB_STAGES},outcome:{enum:JOB_OUTCOMES},occurred_at:nullable(date),verified_at:nullable(date),evidence_url:nullable(url),reason_kind:{enum:['unknown','explicit','inferred']},reason:text,next_action:text,blocker:text,resume_version:text};
 const details={match:text,gaps:text,resume_version:text,resume_sha256:{type:'string',pattern:'^(|[a-f0-9]{64})$'},answers_provenance:text,next_action:text,deadline:{anyOf:[date,{type:'null'}]}};
 const shapes={'record.create':object({...listing,resume_version:text,next_action:text,blocker:text},{source_id,record_type:{enum:['job','contact']},provenance}),
 'event.append':object({id,...status},{evidence}),'event.correct':object({id,target:{type:'integer',minimum:0},action:{enum:['replace','void']},replacement:{anyOf:[object(status,{evidence}),{type:'null'}]},note:text}),
 'record.correct':object({id,changes:{...object(listing),required:[],minProperties:1},note:text}),
 'record.archive':object({id,note:text}),'record.restore':object({id,note:text}),
 'work.update':object({id,details:object(details)}),'work.claim':object({id,actor_label:{type:'string',minLength:1,maxLength:80}}),'work.release':object({id,note:{...text,minLength:1}})};
 return {version:1,transport:'/api/jobs/v1',schema_path:'/api/jobs/v1/schema',authentication:'existing_signed_site_session',mcp_enabled:false,independent_agent_identity:false,
 claim_semantics:'Owner-scoped coordination only. actor_label is self-reported. Review current claim and include claim_id on mutations; no new access is granted.',
 evidence_semantics:'Links are not fetched or certified. Submission requires timestamps and either an HTTPS receipt or a typed historical portal acknowledgment bound to an immutable audited source. Historical provenance is not current portal verification. Contacts cannot receive application statuses. Unknown dates, postings and requisitions remain null; a missing requisition requires a stable source_id.',
 inputSchema:{oneOf:Object.entries(shapes).map(([op,data])=>({...object({op:{const:op},data,expected_revision:{type:'integer',minimum:0},request_id:{type:'string',pattern:'^[A-Za-z0-9_-]{16,80}$'}}),properties:{op:{const:op},data,expected_revision:{type:'integer',minimum:0},request_id:{type:'string',pattern:'^[A-Za-z0-9_-]{16,80}$'},claim_id:id}}))}};
}
async function handleJobs(request,env){
 const url=new URL(request.url),origin=request.headers.get('Origin');
 const headers={'Content-Type':'application/json','Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Vary':'Origin, Authorization','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
 if(origin&&ORIGINS.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS'});
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
 try{
  jobCheck(!origin||ORIGINS.includes(origin),403,'origin_denied');jobCheck(!url.search,400,'query_denied');
  jobCheck(['/api/jobs/v1','/api/jobs/v1/schema'].includes(url.pathname),404,'route_not_found');
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  jobCheck(['GET','POST'].includes(request.method),405,'method_denied');
  // Fail closed before identity lookup or any storage access while disabled.
  jobCheck(env.JOB_HARNESS_ENABLED==='true',503,'private_setup_pending');
  const uid=await poundIdentity(request,env);
  const access=jobAccess(uid,env);jobCheck(access,403,'access_not_granted');
  if(url.pathname==='/api/jobs/v1/schema'){jobCheck(request.method==='GET',405,'method_denied');return reply({schema:jobSchema()});}
  const path='/privateJobs/v1/'+uid,saved=await fbGet(env,path,true);
  jobCheck(!saved.data||saved.data.owner_uid===uid,403,'owner_mismatch');
  const state=saved.data?JSON.parse(saved.data.payload):jobEmpty(uid);
  jobCheck(state.owner_uid===uid&&state.version===1,403,'owner_mismatch');
  const view=()=>{const {receipts,...workspace}=state;return {workspace,access};};
  if(request.method==='GET')return reply(view());
  const input=await poundBody(request);jobFields(input,['op','data','expected_revision','request_id',...(Object.hasOwn(input||{},'claim_id')?['claim_id']:[])]);
  if(Object.hasOwn(input,'claim_id'))jobText(input.claim_id,80);
  jobCheck(typeof input.op==='string'&&Object.hasOwn(JOB_OPS,input.op),400,'invalid_operation');
  jobCheck(Number.isSafeInteger(input.expected_revision)&&input.expected_revision>=0&&typeof input.request_id==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(input.request_id),400,'invalid_revision_or_request');
  // The key names one logical operation; the revision is only its precondition. A retry
  // after a 409 re-read keeps the key, so an op that already committed replays instead
  // of being applied twice.
  const fingerprint=await poundHash(poundCanonical({op:input.op,data:input.data,request_id:input.request_id,...(input.claim_id?{claim_id:input.claim_id}:{})})),prior=state.receipts.find(r=>r.request_id===input.request_id);
  if(prior){jobCheck(prior.fingerprint===fingerprint,409,'request_id_reused');return reply({...view(),receipt:prior.result,replayed:true});}
  jobCheck(input.expected_revision===state.revision,409,'revision_conflict');
  if(input.op!=='record.create'&&input.op!=='work.claim'){
   const claim=JOBS_CORE.work(jobRow(state,input.data?.id)).claim;
   jobCheck(!claim||input.claim_id===claim.id,409,'claim_confirmation_required');
   jobCheck(!input.claim_id||claim?.id===input.claim_id,409,'claim_changed');
  }
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
 }catch(e){
  // Only locally-created validation errors may carry detail. Shared helper errors
  // get fixed messages; arbitrary thrown values/properties never reach the response.
  if(jobErrors.has(e))return reply({error:e.message,...(e.jobDetail||{})},e.jobStatus);
  const shared={400:'Invalid JSON',401:'Sign in again',413:'Body too large',415:'JSON required'};
  const status=e?.poundStatus;
  if(Object.hasOwn(shared,status))return reply({error:shared[status]},Number(status));
  return reply({error:'jobs_unavailable'},503);
 }
}
