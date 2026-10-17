/* Research project envelope (design 2026-10-17, WO-01). One record per project at
 * /researchProjects/v1/<tenant>/<project_id>. The owner-session HTTP route and the owner
 * connector (research-lab/owner-apps.mjs) share this validator, projectApply() and the Pound
 * canonical hash. Default off: RESEARCH_PROJECTS_ENABLED. No UI, ledger, task fields or seed
 * data here; collaborator and agent credentials are not issued by anything in this block. */
const PROJECT_LIMITS = Object.freeze({milestones:60,checks:600,questions:400,decisions:300,votes:3000,roles:40,policies:40,audit:200,receipts:256,body_bytes:32768,state_target_bytes:1048576,state_bytes:2097152,read_bytes:524288,page:200});
const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const PROJECT_ACTOR_KINDS = ['owner','owner_connector','collaborator','automation'];
const PROJECT_CHECK_STATUSES = ['unchecked','evidence_attached','passed','failed','waived'];
const PROJECT_SECTIONS = ['summary','milestones','checks','questions','decisions','votes','roles','policies','audit'];
const projectStr = (maxLength,minLength=1)=>({type:'string',minLength,maxLength});
const projectRecordId = {type:'string',pattern:'^r_[a-f0-9-]{36}$'};
const projectDate = {type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'};
const projectSha = {type:'string',pattern:'^[a-f0-9]{64}$'};
const projectRev = {type:'integer',minimum:1};
const projectList = (maxItems,items,minItems=0)=>({type:'array',minItems,maxItems,items});
const projectFields = {
  'project.save': {title:projectStr(120),question:projectStr(300),audience:projectStr(300),success_criteria:projectList(8,projectStr(300),1),scope:{type:'object',additionalProperties:false,required:['in','out'],properties:{in:projectList(20,projectStr(200)),out:projectList(20,projectStr(200))}},status:{enum:['proposed','active','paused','submitted','archived']},records_reliable_from:projectDate,started_planned:projectDate,target_date:projectDate,template:{type:'object',additionalProperties:false,required:['name','version'],properties:{name:projectStr(60),version:projectStr(20)}},expected_record_revision:projectRev},
  'project.health': {value:{enum:['green','amber','red']},note:projectStr(300,0),expected_record_revision:projectRev},
  'milestone.save': {id:projectRecordId,expected_record_revision:projectRev,title:projectStr(120),due_planned:projectDate,depends_on:projectList(8,projectRecordId),order:{type:'integer',minimum:0,maximum:999},cut_line:projectStr(300,0),archived:{type:'boolean'}},
  'check.set': {id:projectRecordId,expected_record_revision:projectRev,milestone_id:projectRecordId,text:projectStr(300),verifier:{type:'string',pattern:'^[a-z][a-z0-9_-]{0,39}$'},evidence_required:projectStr(60),status:{enum:PROJECT_CHECK_STATUSES},evidence_refs:projectList(8,projectStr(300)),waiver_reason:projectStr(300)},
  'question.save': {id:projectRecordId,expected_record_revision:projectRev,text:projectStr(1000),context_ref:projectStr(300),priority:{enum:['low','normal','high','urgent']},status:{enum:['open','withdrawn']}},
  'question.answer': {id:projectRecordId,expected_record_revision:projectRev,text:projectStr(2000),decision_id:projectRecordId},
  'decision.save': {id:projectRecordId,expected_record_revision:projectRev,title:projectStr(120),context:projectStr(2000,0),drivers:projectList(8,projectStr(300)),options:projectList(8,{type:'object',additionalProperties:false,required:['id','text'],properties:{id:{type:'string',pattern:'^[a-z0-9_-]{1,20}$'},text:projectStr(500),consequences:projectStr(500,0)}},2),proposal_text:projectStr(4000),status:{enum:['proposed','withdrawn']}},
  'decision.resolve': {id:projectRecordId,expected_record_revision:projectRev,proposal_version:projectSha,status:{enum:['accepted','rejected']},option_id:{type:'string',pattern:'^[a-z0-9_-]{1,20}$'},rationale:projectStr(2000)},
  'vote.cast': {decision_id:projectRecordId,proposal_version:projectSha,value:{enum:[1,0,-1,'abstain']},rationale:projectStr(2000)},
  'role.propose': {id:projectRecordId,expected_record_revision:projectRev,role_name:projectStr(60),principal:projectStr(100),responsibilities:projectList(8,projectStr(300))},
  'role.accept': {id:projectRecordId,expected_record_revision:projectRev,status:{enum:['accepted','revoked']},verification_ref:projectStr(300)},
  'policy.save': {id:projectRecordId,expected_record_revision:projectRev,action:{enum:[]},trigger_check:projectList(8,projectStr(120)),required_evidence:projectStr(300,0),credential:projectStr(100),max_per_day:{type:'integer',minimum:0,maximum:1000},status:{enum:['draft','enabled','disabled']}},
};
projectFields['policy.save'].action.enum = Object.keys(projectFields);
const projectRequired = {'project.save':['title','question','audience','success_criteria','scope','status','target_date'],'project.health':['value'],'milestone.save':['title','due_planned'],'check.set':['milestone_id','text','verifier','evidence_required','status'],'question.save':['text','priority'],'question.answer':['id','expected_record_revision','text'],'decision.save':['title','options','proposal_text'],'decision.resolve':['id','expected_record_revision','proposal_version','status','rationale'],'vote.cast':['decision_id','proposal_version','value'],'role.propose':['role_name','principal','responsibilities'],'role.accept':['id','expected_record_revision','status'],'policy.save':['action','trigger_check','required_evidence','credential','max_per_day','status']};
// Binding actions (E.2). Every other op is open to any authenticated contributor, with the
// per-record limits enforced in the op itself (check statuses, accepted milestones, authorship).
const PROJECT_OWNER_ONLY = new Set(['project.save','project.health','question.answer','decision.resolve','role.accept','policy.save']);
const PROJECT_SCHEMA = {
  version:1,record:'dd-project/1',transport:'/api/project/v1/<project_id>',enabled_flag:'RESEARCH_PROJECTS_ENABLED',
  authentication:{header:'Authorization',scheme:'Bearer',credential:'existing_signed_site_session',owner_uid:'RESEARCH_OWNER_UID',rejected_headers:['X-Dawg-Session','X-Bozo-Session','X-Dawg-Pass'],query_credentials:false},
  limits:PROJECT_LIMITS,sections:PROJECT_SECTIONS,owner_only:[...PROJECT_OWNER_ONLY],
  write:{inputSchema:{oneOf:Object.keys(projectFields).map(op=>({type:'object',additionalProperties:false,required:['op','expected_revision','request_id','data'],properties:{op:{const:op},expected_revision:{type:'integer',minimum:0},request_id:{type:'string',pattern:'^[A-Za-z0-9_-]{16,80}$'},policy_id:projectRecordId,data:{type:'object',additionalProperties:false,required:projectRequired[op],properties:projectFields[op]}}}))}},
};
function projectFail(status,message){const e=new Error(message);e.projectStatus=e.status=status;throw e;}
function projectCheck(ok,status,message){if(!ok)projectFail(status,message);}
function projectValidate(value,schema,at='input'){
  if(schema.oneOf){const match=schema.oneOf.find(s=>s.properties.op.const===value?.op);projectCheck(match,400,'unknown_operation');return projectValidate(value,match,at);}
  if(schema.const!==undefined)projectCheck(value===schema.const,400,'invalid_operation');
  if(schema.enum)projectCheck(schema.enum.includes(value),400,'invalid_value:'+at);
  if(schema.type==='object'){
    projectCheck(value&&typeof value==='object'&&!Array.isArray(value),400,'object_required:'+at);
    for(const k of Object.keys(value))projectCheck(Object.hasOwn(schema.properties,k),400,'unknown_field:'+k);
    for(const k of schema.required)projectCheck(Object.hasOwn(value,k),400,'required_missing:'+k);
    for(const k of Object.keys(value))projectValidate(value[k],schema.properties[k],k);
  }
  if(schema.type==='string'){
    projectCheck(typeof value==='string',400,'text_required:'+at);
    if(schema.minLength!==undefined)projectCheck(value.trim().length>=schema.minLength&&value.length<=schema.maxLength,400,'text_length:'+at);
    if(schema.pattern)projectCheck(new RegExp(schema.pattern).test(value),400,'invalid_format:'+at);
  }
  if(schema.type==='array'){projectCheck(Array.isArray(value)&&value.length>=schema.minItems&&value.length<=schema.maxItems,400,'list_length:'+at);for(const item of value)projectValidate(item,schema.items,at);}
  if(schema.type==='boolean')projectCheck(typeof value==='boolean',400,'boolean_required:'+at);
  if(schema.type==='integer')projectCheck(Number.isSafeInteger(value)&&value>=schema.minimum&&(schema.maximum===undefined||value<=schema.maximum),400,'invalid_integer:'+at);
}
function projectEnabled(env){return env.RESEARCH_PROJECTS_ENABLED==='true';}
function projectTenant(env){const t=env.RESEARCH_UPLOAD_TENANT||'';projectCheck(/^[A-Za-z0-9_-]{1,100}$/.test(t),503,'tenant_unconfigured');return t;}
function projectPath(env,id){projectCheck(typeof id==='string'&&PROJECT_ID_RE.test(id),400,'invalid_project_id');return '/researchProjects/v1/'+projectTenant(env)+'/'+id;}
function projectEmpty(id,tenant){return {record:'dd-project/1',project_id:id,tenant,revision:0,updated_at:null,project:null,milestones:[],checks:[],questions:[],decisions:[],votes:[],roles:[],policies:[],audit:[],receipts:[]};}
// The server writes the stamp from the authenticated principal. author_label is the only
// caller-supplied identity and is never trusted. A connector or agent without a verified
// credential label never reaches storage (J.4 20).
function projectActor(p){
  projectCheck(p&&/^u_[A-Za-z0-9_-]{1,100}$/.test(p.uid||'')&&PROJECT_ACTOR_KINDS.includes(p.actor_kind),401,'authenticated_principal_required');
  if(p.actor_kind==='owner')projectCheck(p.credential_label==null,401,'authenticated_principal_required');
  else projectCheck(typeof p.credential_label==='string'&&/^[A-Za-z0-9_-]{1,24}$/.test(p.credential_label),401,'verified_credential_label_required');
  return {uid:p.uid,actor_kind:p.actor_kind,credential_label:p.actor_kind==='owner'?null:p.credential_label,author_label:p.author_label??null,author_label_trust:'unverified'};
}
const projectCredential = a=>a.actor_kind+':'+a.uid+':'+(a.credential_label||'');
async function projectLoad(env,id,uid){
  const path=projectPath(env,id),tenant=projectTenant(env);
  const saved=await fbGet(env,path,true);projectCheck(saved&&saved.etag,503,'conditional_storage_required');
  if(!saved.data)return {saved,state:projectEmpty(id,tenant)};
  projectCheck(saved.data.tenant===tenant&&saved.data.project_id===id,403,'tenant_mismatch');
  projectCheck(saved.data.owner_uid===uid,403,'owner_mismatch');
  const state=JSON.parse(saved.data.payload);projectCheck(state.tenant===tenant&&state.project_id===id,403,'tenant_mismatch');
  return {saved,state};
}
async function projectCommit(env,id,saved,state,uid){
  const payload=JSON.stringify(state);
  projectCheck(new TextEncoder().encode(payload).byteLength<=PROJECT_LIMITS.state_bytes,413,'project_capacity');
  return fbPut(env,projectPath(env,id),{version:1,tenant:projectTenant(env),project_id:id,owner_uid:uid,payload},saved.etag);
}
// Policy gate stub (J.1 9). Automation has no transport yet (delegated credentials are off);
// this is the boundary it will meet. No trigger check is evaluable in v1, so a policy naming
// any check fails closed. The ledger entry for a refusal arrives with the ledger (WO-05).
const PROJECT_TRIGGER_CHECKS = Object.freeze({});
function projectPolicyGate(state,input,actor){
  if(actor.actor_kind!=='automation'){projectCheck(input.policy_id===undefined,400,'policy_id_applies_to_automation');return;}
  projectCheck(input.policy_id,403,'policy_required');
  const p=state.policies.find(x=>x.id===input.policy_id);
  projectCheck(p&&p.status==='enabled'&&!p.archived,403,'policy_not_enabled');
  projectCheck(p.action===input.op,403,'policy_action_mismatch');
  projectCheck(p.trigger_check.every(name=>Object.hasOwn(PROJECT_TRIGGER_CHECKS,name)&&PROJECT_TRIGGER_CHECKS[name](state,input)),403,'policy_trigger_failed');
}
function projectCycle(rows,id,deps){
  const edges=new Map(rows.map(r=>[r.id,r.id===id?deps:r.depends_on||[]]));if(!edges.has(id))edges.set(id,deps);
  const seen=new Set(),walk=(n,path)=>{if(path.has(n))return true;if(seen.has(n))return false;seen.add(n);path.add(n);for(const m of edges.get(n)||[])if(walk(m,path))return true;path.delete(n);return false;};
  return walk(id,new Set());
}
async function projectProposalVersion(d){return poundHash(poundCanonical({title:d.title,context:d.context,drivers:d.drivers,options:d.options,proposal_text:d.proposal_text}));}
async function projectApply(state,input,principal,nowMs=Date.now()){
  projectValidate(input,PROJECT_SCHEMA.write.inputSchema);
  const actor=projectActor(principal),owner=actor.actor_kind==='owner',now=new Date(nowMs).toISOString(),d=input.data,op=input.op,credential=projectCredential(actor);
  const fingerprint=await poundHash(poundCanonical({input,author_label:actor.author_label}));
  const previous=state.receipts.find(r=>r.credential===credential&&r.request_id===input.request_id);
  if(previous){projectCheck(previous.fingerprint===fingerprint,409,'idempotency_conflict');return {receipt:previous.receipt,replayed:true};}
  projectCheck(input.expected_revision===state.revision,409,'revision_conflict');
  projectPolicyGate(state,input,actor);
  projectCheck(!PROJECT_OWNER_ONLY.has(op)||owner,403,'owner_only:'+op);
  projectCheck(op==='project.save'||state.project,409,'project_not_created');
  const {id,expected_record_revision:expected,...fields}=d;
  const find=(rows,rid,what)=>{const row=rows.find(r=>r.id===rid);projectCheck(row,404,what+'_not_found');return row;};
  const sameAuthor=row=>owner||projectCredential(row.created_by)===credential;
  const upsert=(collection,type)=>{
    const rows=state[collection];
    if(id){const row=find(rows,id,type);projectCheck(expected===row.revision,409,'record_revision_conflict');return row;}
    projectCheck(expected===undefined,400,'expected_record_revision_applies_to_updates_only');
    projectCheck(rows.length<PROJECT_LIMITS[collection],409,'limit_reached:'+collection);
    const row={id:'r_'+crypto.randomUUID(),type,project_id:state.project_id,revision:0,created_at:now,created_by:actor,supersedes:null,archived:false};rows.push(row);return row;
  };
  let row,extra;
  if(op==='project.save'){
    if(state.project){projectCheck(expected===state.project.revision,409,'record_revision_conflict');row=state.project;}
    else{projectCheck(expected===undefined,400,'expected_record_revision_applies_to_updates_only');row=state.project={id:'r_'+crypto.randomUUID(),type:'project',project_id:state.project_id,slug:state.project_id,revision:0,created_at:now,created_by:actor,supersedes:null,archived:false,decision_authority:'owner',health:null,scope_version:0};}
    const scopeChanged=!row.scope||poundCanonical(row.scope)!==poundCanonical(fields.scope);
    Object.assign(row,fields,{scope_version:row.scope_version+(scopeChanged?1:0)});
  }else if(op==='project.health'){
    row=state.project;if(expected!==undefined)projectCheck(expected===row.revision,409,'record_revision_conflict');
    row.health={value:fields.value,note:fields.note||'',set_by:actor,set_at:now};
  }else if(op==='milestone.save'){
    row=upsert('milestones','milestone');
    projectCheck(owner||row.revision===0||!row.accepted,403,'owner_only:accepted_milestone');
    const deps=fields.depends_on||[];
    for(const dep of deps){projectCheck(dep!==row.id,400,'milestone_dependency_cycle');find(state.milestones,dep,'milestone');}
    projectCheck(!projectCycle(state.milestones,row.id,deps),400,'milestone_dependency_cycle');
    Object.assign(row,fields,{depends_on:deps,order:fields.order??row.order??state.milestones.length-1,accepted:owner});
  }else if(op==='check.set'){
    projectCheck(!find(state.milestones,fields.milestone_id,'milestone').archived,409,'milestone_archived');
    row=upsert('checks','acceptance_check');
    // Connectors attach evidence; the named verifier (owner-verified: signed session only)
    // decides. No role verifier exists until agent credentials and policies are enabled.
    projectCheck(owner||['unchecked','evidence_attached'].includes(fields.status),403,'verifier_required');
    if(!owner&&row.revision>0)projectCheck(row.verifier===fields.verifier&&row.text===fields.text&&row.milestone_id===fields.milestone_id,403,'owner_only:check_definition');
    const refs=fields.evidence_refs||[];
    projectCheck(!['evidence_attached','passed'].includes(fields.status)||refs.length>0,400,'evidence_required');
    projectCheck(fields.status!=='waived'||fields.waiver_reason,400,'waiver_reason_required');
    const decided=['passed','failed','waived'].includes(fields.status);
    Object.assign(row,{waiver_reason:null},fields,{evidence_refs:refs,checked_by:decided?actor:null,checked_at:decided?now:null});
  }else if(op==='question.save'){
    row=upsert('questions','question');
    if(row.revision>0){projectCheck(sameAuthor(row),403,'asker_or_owner_only');projectCheck(row.status==='open',409,'question_closed');}
    Object.assign(row,fields,{status:fields.status||'open',recipient:'owner',asked_by:row.created_by,answer:null});
  }else if(op==='question.answer'){
    row=find(state.questions,id,'question');projectCheck(expected===row.revision,409,'record_revision_conflict');projectCheck(row.status==='open',409,'question_closed');
    if(fields.decision_id)find(state.decisions,fields.decision_id,'decision');
    Object.assign(row,{status:'answered',answer:{text:fields.text,decision_id:fields.decision_id||null,by:actor,at:now}});
  }else if(op==='decision.save'){
    row=upsert('decisions','decision');
    if(row.revision>0){projectCheck(['proposed','voting'].includes(row.status),409,'decision_closed');projectCheck(fields.status!=='withdrawn'||sameAuthor(row),403,'author_or_owner_only');}
    const body={title:fields.title,context:fields.context||'',drivers:fields.drivers||[],options:fields.options,proposal_text:fields.proposal_text};
    const version=await projectProposalVersion(body);
    const history=row.proposal_history||[];if(row.proposal_version!==version)history.push({proposal_version:version,at:now,by:actor});
    Object.assign(row,body,{status:fields.status||'proposed',proposal_version:version,proposal_history:history,outcome:null,decided_by:null,decided_at:null});
  }else if(op==='decision.resolve'){
    row=find(state.decisions,id,'decision');projectCheck(expected===row.revision,409,'record_revision_conflict');
    projectCheck(['proposed','voting'].includes(row.status),409,'decision_closed');projectCheck(fields.proposal_version===row.proposal_version,409,'proposal_changed');
    projectCheck(fields.status!=='accepted'||row.options.some(o=>o.id===fields.option_id),400,'option_required');
    Object.assign(row,{status:fields.status,outcome:{option_id:fields.option_id||null,rationale:fields.rationale,proposal_version:row.proposal_version},decided_by:actor,decided_at:now});
  }else if(op==='vote.cast'){
    const decision=find(state.decisions,fields.decision_id,'decision');
    projectCheck(['proposed','voting'].includes(decision.status),409,'decision_closed');projectCheck(fields.proposal_version===decision.proposal_version,409,'proposal_changed');
    projectCheck(fields.value!==-1||fields.rationale,400,'rationale_required');
    const prior=state.votes.find(v=>v.decision_id===decision.id&&v.proposal_version===fields.proposal_version&&!v.superseded&&projectCredential(v.actor)===credential);
    // Same voter, same version, same vote: an idempotent no-op, never a second record (E.5.5).
    if(prior&&prior.value===fields.value&&(prior.rationale||null)===(fields.rationale||null))return {receipt:{item_id:prior.id,revision:state.revision,record_revision:prior.revision,record_sha256:await poundHash(poundCanonical(prior))},replayed:false,unchanged:true};
    projectCheck(state.votes.length<PROJECT_LIMITS.votes,409,'limit_reached:votes');
    row={id:'r_'+crypto.randomUUID(),type:'vote',project_id:state.project_id,revision:0,created_at:now,created_by:actor,supersedes:prior?prior.id:null,archived:false,decision_id:decision.id,proposal_version:fields.proposal_version,value:fields.value,rationale:fields.rationale||null,binding:owner,superseded:false,supersedes_vote_id:prior?prior.id:null};
    state.votes.push(row);
    if(prior){Object.assign(prior,{superseded:true,superseded_by:row.id,revision:prior.revision+1,updated_at:now});extra=prior;}
  }else if(op==='role.propose'){
    row=upsert('roles','role_acceptance');
    if(row.revision>0){projectCheck(sameAuthor(row),403,'proposer_or_owner_only');projectCheck(row.status==='proposed',409,'role_not_proposed');}
    Object.assign(row,fields,{status:'proposed',proposed_by:row.created_by,accepted_by:null,accepted_at:null,verification_ref:null});
  }else if(op==='role.accept'){
    row=find(state.roles,id,'role');projectCheck(expected===row.revision,409,'record_revision_conflict');projectCheck(row.status!=='revoked',409,'role_revoked');
    projectCheck(fields.status!=='accepted'||fields.verification_ref||row.principal===actor.uid,400,'verification_ref_required');
    Object.assign(row,{status:fields.status},fields.status==='accepted'?{accepted_by:actor,accepted_at:now,verification_ref:fields.verification_ref||null}:{revoked_by:actor,revoked_at:now});
  }else{
    row=upsert('policies','policy');Object.assign(row,fields,{enabled:fields.status==='enabled'});
  }
  row.revision++;Object.assign(row,{updated_at:now,actor,request_id:input.request_id,...(input.policy_id?{policy_id:input.policy_id}:{})});
  state.revision++;state.updated_at=now;
  const record_sha256=await poundHash(poundCanonical(row));
  const receipt={item_id:row.id,revision:state.revision,record_revision:row.revision,record_sha256};
  state.audit.push({at:now,op,item_id:row.id,record_revision:row.revision,revision:state.revision,actor,request_id:input.request_id,record_sha256,...(extra?{superseded:extra.id}:{})});
  state.audit=state.audit.slice(-PROJECT_LIMITS.audit);
  state.receipts.push({credential,request_id:input.request_id,fingerprint,receipt});state.receipts=state.receipts.slice(-PROJECT_LIMITS.receipts);
  return {receipt,replayed:false};
}
// Tallies are per proposal_version and never mix binding with advisory votes (E.5.6).
function projectTally(state,decision,version=decision.proposal_version){
  const t={proposal_version:version,binding:{},advisory_human:{},advisory_ai:{},abstain:0,missing:[]};
  const votes=state.votes.filter(v=>v.decision_id===decision.id&&v.proposal_version===version&&!v.superseded);
  for(const v of votes){if(v.value==='abstain'){t.abstain++;continue;}const bucket=v.binding?'binding':v.actor.actor_kind==='collaborator'?'advisory_human':'advisory_ai',key=v.value>0?'+1':String(v.value);t[bucket][key]=(t[bucket][key]||0)+1;}
  if(!votes.some(v=>v.binding))t.missing.push('owner');
  return t;
}
function projectMilestone(state,m,today){
  const checks=state.checks.filter(c=>c.milestone_id===m.id&&!c.archived),n=s=>checks.filter(c=>c.status===s).length;
  const passed=n('passed'),waived=n('waived'),failed=n('failed'),total=checks.length,done=total>0&&passed+waived===total;
  const status=done?'passed':m.due_planned<today?'missed':checks.some(c=>c.status!=='unchecked')?'in_progress':'not_started';
  const due_actual=done?checks.map(c=>c.checked_at).sort().at(-1):null;
  return {...m,status,due_actual,progress:{passed,total,waived,failed,label:passed+' / '+total+' · waived '+waived+' · failed '+failed}};
}
function projectView(state,nowMs=Date.now()){
  const {receipts,...view}=state,today=new Date(nowMs).toISOString().slice(0,10);
  return {...view,milestones:state.milestones.map(m=>projectMilestone(state,m,today)),decisions:state.decisions.map(d=>({...d,status:d.status==='proposed'&&state.votes.some(v=>v.decision_id===d.id&&v.proposal_version===d.proposal_version)?'voting':d.status,tally:projectTally(state,d)}))};
}
function projectRead(state,{section='summary',offset=0,limit=50}={},nowMs=Date.now()){
  projectCheck(PROJECT_SECTIONS.includes(section),400,'invalid_section');
  projectCheck(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=PROJECT_LIMITS.page,400,'invalid_page');
  const view=projectView(state,nowMs),bytes=new TextEncoder().encode(JSON.stringify(state)).byteLength;
  const head={project_id:state.project_id,revision:state.revision,as_of:state.updated_at,section};
  if(section==='summary')return {...head,project:view.project,counts:Object.fromEntries(['milestones','checks','questions','decisions','votes','roles','policies'].map(k=>[k,state[k].length])),open_questions:state.questions.filter(q=>q.status==='open').length,milestones:view.milestones.map(m=>({id:m.id,title:m.title,due_planned:m.due_planned,status:m.status,progress:m.progress,accepted:m.accepted})),capacity:{bytes,target:PROJECT_LIMITS.state_target_bytes,hard:PROJECT_LIMITS.state_bytes,over_target:bytes>PROJECT_LIMITS.state_target_bytes}};
  const rows=section==='audit'?[...view.audit].reverse():view[section];
  return {...head,total:rows.length,offset,limit,items:rows.slice(offset,offset+limit)};
}
async function handleProject(request,env){
  const url=new URL(request.url),origin=request.headers.get('Origin');
  const headers={'Content-Type':'application/json','Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Vary':'Origin, Authorization','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
  if(origin&&ORIGINS.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS'});
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  try{
    projectCheck(!origin||ORIGINS.includes(origin),403,'origin_denied');
    projectCheck(!url.search,400,'query_parameters_rejected');
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    projectCheck(projectEnabled(env),503,'projects_disabled');
    const match=/^\/api\/project\/v1\/([^/]+)$/.exec(url.pathname);projectCheck(match&&PROJECT_ID_RE.test(match[1]),404,'route_not_found');
    projectCheck(request.method==='GET'||request.method==='POST',405,'method_denied');
    const uid=await poundIdentity(request,env);projectCheck(uid===env.RESEARCH_OWNER_UID,403,'configured_owner_required');
    const id=match[1],input=request.method==='POST'?await poundBody(request):null;
    if(input)projectValidate(input,PROJECT_SCHEMA.write.inputSchema);
    const {saved,state}=await projectLoad(env,id,uid);
    if(!input)return reply({project:projectView(state),exists:state.revision>0,writeSchema:PROJECT_SCHEMA.write.inputSchema});
    const out=await projectApply(state,input,{uid,actor_kind:'owner'});
    if(out.replayed||out.unchanged)return reply({...out,as_of:state.updated_at});
    // Recheck the session (password change, revocation) immediately before the conditional commit.
    projectCheck(await poundIdentity(request,env)===uid,401,'sign_in_again');
    projectCheck(await projectCommit(env,id,saved,state,uid),409,'revision_conflict');
    return reply({...out,as_of:state.updated_at});
  }catch(e){const status=e.projectStatus||e.poundStatus;return reply({error:status?e.message:'project_unavailable'},status||503);}
}
