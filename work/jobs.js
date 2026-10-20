/* Private job harness. Flattened into the Worker; no connector grants or submissions. */
const JOB_STAGES=['opportunity','approved','submitted','interview','offer','closed'];
const JOB_OUTCOMES=['none','no_later_decision','rejected','position_closed','blocked_not_submitted','withdrawn','accepted'];
const jobCheck=(ok,status,message)=>{if(!ok)throw Object.assign(Error(message),{jobStatus:status});};
function jobFields(x,keys){jobCheck(x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(x,k)),400,'invalid_fields');}
function jobText(x,max=200,empty=false){jobCheck(typeof x==='string'&&x.length<=max&&(empty||x.trim().length>0)&&!/[\u0000-\u001f]/.test(x),400,'invalid_text');}
function jobDate(x,nullable=false){if(nullable&&x===null)return;jobCheck(typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x&&Date.parse(x)<=Date.now(),400,'invalid_timestamp');}
function jobURL(x,nullable=false){if(nullable&&x===null)return;let u;try{u=new URL(x);}catch{}jobCheck(u&&u.protocol==='https:'&&!u.username&&!u.password&&x.length<=2000,400,'https_url_required');}
function jobRecord(d){
 jobFields(d,['employer_key','employer','role','requisition','url','url_verified_at','resume_version','next_action','blocker']);
 jobCheck(/^[a-z0-9][a-z0-9-]{1,79}$/.test(d.employer_key),400,'canonical_employer_key_required');
 for(const k of ['employer','role','requisition'])jobText(d[k]);
 for(const k of ['resume_version','next_action','blocker'])jobText(d[k],500,true);
 jobURL(d.url);jobDate(d.url_verified_at);
 return d;
}
function jobEvent(d){
 jobFields(d,['id','stage','outcome','occurred_at','verified_at','evidence_url','reason_kind','reason','next_action','blocker','resume_version']);
 jobText(d.id,80);jobCheck(JOB_STAGES.includes(d.stage)&&JOB_OUTCOMES.includes(d.outcome),400,'invalid_status');
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
function jobEmpty(uid){return {version:1,owner_uid:uid,revision:0,updated_at:null,records:[],receipts:[],source:{health:'not_connected',last_verified_at:null,sync:'pending'}};}
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
  jobCheck(['record.create','event.append'].includes(input.op),400,'invalid_operation');
  jobCheck(Number.isSafeInteger(input.expected_revision)&&input.expected_revision>=0&&/^[A-Za-z0-9_-]{16,80}$/.test(input.request_id),400,'invalid_revision_or_request');
  const fingerprint=await poundHash(poundCanonical(input)),prior=state.receipts.find(r=>r.request_id===input.request_id);
  if(prior){jobCheck(prior.fingerprint===fingerprint,409,'request_id_reused');return reply({...view(),receipt:prior.result,replayed:true});}
  jobCheck(input.expected_revision===state.revision,409,'revision_conflict');
  // Preserve history and deduplication receipts: stop at the bounded capacity, never prune.
  jobCheck(state.receipts.length<2000,409,'archive_required');
  const now=new Date().toISOString();let id;
  if(input.op==='record.create'){
   const d=jobRecord(input.data),identity=d.employer_key+'|'+d.requisition.trim().toLowerCase();
   jobCheck(!state.records.some(r=>r.identity===identity),409,'duplicate_requisition');
   jobCheck(state.records.length<300,409,'record_limit');id=crypto.randomUUID();
   state.records.push({id,identity,...d,created_at:now,events:[]});
  }else{
   const d=jobEvent(input.data),row=state.records.find(r=>r.id===d.id);jobCheck(row,404,'record_not_found');
   jobCheck(row.events.length<300,409,'history_limit');
   const last=row.events.at(-1);jobCheck(!last||d.occurred_at>=last.occurred_at,409,'older_evidence_requires_reconciliation');
   jobCheck(!last||JOB_STAGES.indexOf(d.stage)>=JOB_STAGES.indexOf(last.stage),409,'stage_regression_requires_reconciliation');
   jobCheck(d.outcome!=='blocked_not_submitted'||!row.events.some(e=>['submitted','interview','offer'].includes(e.stage)),409,'already_submitted');
   id=row.id;row.events.push({...d,recorded_at:now,actor_uid:uid});
  }
  state.revision++;state.updated_at=now;
  const result={id,revision:state.revision};state.receipts.push({request_id:input.request_id,fingerprint,result});
  const payload=JSON.stringify(state);jobCheck(new TextEncoder().encode(payload).length<=1048576,413,'archive_required');
  jobCheck(saved.etag,503,'conditional_storage_unavailable');
  jobCheck(await poundIdentity(request,env)===uid,401,'sign_in_again');
  jobCheck(await fbPut(env,path,{owner_uid:uid,payload},saved.etag),409,'revision_conflict');
  return reply({...view(),receipt:result,replayed:false});
 }catch(e){const status=e.jobStatus||e.poundStatus;return reply({error:status?e.message:'jobs_unavailable'},status||503);}
}
