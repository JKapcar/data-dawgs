import {DATA_TOOL,dataEnabled,readDevelopmentData} from './development-data.mjs';
import {decodeEnvelope,encodeEnvelope} from './exact-store.mjs';
import {HYPOTHESIS_STATUSES,HYPOTHESIS_FAMILIES,HYPOTHESIS_DESIGN_FIELDS,EVIDENCE_KINDS} from './machine-core.mjs';
const check=(ok,status,message)=>{if(!ok)throw Object.assign(Error(message),{status});};
const bytes=x=>new TextEncoder().encode(JSON.stringify(x)).length;
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const TTL=7*86400000;
const researchScopes=['research:read','hypothesis:write','evidence:write','discussion:write'];
const str=maxLength=>({type:'string',minLength:1,maxLength});
const researchFields={hypothesis:{title:str(200),method:str(4000),id:str(100),expectedVersion:{type:'integer',minimum:1},status:{enum:HYPOTHESIS_STATUSES},family:{enum:HYPOTHESIS_FAMILIES},...Object.fromEntries(HYPOTHESIS_DESIGN_FIELDS.map(k=>[k,str(500)]))},evidence:{url:str(2000),title:str(200),excerpt:str(4000),kind:{enum:EVIDENCE_KINDS}},discussion:{hypothesisId:str(100),kind:{enum:['note','challenge','advisory_review','finding']},hypothesisVersion:{type:'integer',minimum:1},receiptId:str(100),reviewId:str(100),receiptHash:{type:'string',pattern:'^[a-f0-9]{64}$'},body:str(4000),evidenceIds:{type:'array',maxItems:30,items:str(100)}}};
const researchRequired={hypothesis:['title','method'],evidence:['url','title','excerpt'],discussion:['hypothesisId','kind','body','evidenceIds']};
const researchSchema={type:'object',oneOf:Object.keys(researchFields).map(type=>({type:'object',additionalProperties:false,required:['type','key','payload'],properties:{type:{const:type},key:str(160),payload:{type:'object',additionalProperties:false,properties:researchFields[type],required:researchRequired[type]}}}))};
// Unverified free-text label a caller may attach to a contribution. Stored, never trusted.
const assistant={type:'string',minLength:1,maxLength:40,description:'Optional self-reported assistant name (1-40 chars). Stored as author_label with author_label_trust "unverified"; never used for authorization.'};
const poundOps=['task.save','message.add','context.save'];
// Tool inputSchemas are ONE flat object each: several clients reject a top-level oneOf.
// The exact per-op shapes stay in the read result's writeSchema and in server validation.
const flat={
 pound:{type:'object',additionalProperties:false,required:['op','expected_revision','request_id','data'],description:'One Pound write. Read first (dd_owner_pound_read) for expected_revision and the exact per-op writeSchema. data shapes by op: task.save {title 1-120, body 0-2000, agent_id "" or p_<uuid>, status queued|working|review|done|blocked|canceled (blocked needs blocked_reason {code waiting_task|waiting_owner|waiting_data|waiting_access|external, note?}; canceled is the signed owner\'s; done after review needs review {verdict accept, reviewed_by}), archived boolean, refs? up to 8 strings of 1-300, id? p_<uuid> to update, expected_task_revision required with id (the task\'s revision from the read; a mismatch is 409 task_revision_conflict); optional planning fields, null clears on update: project_id, milestone_id, planned_start/planned_end YYYY-MM-DD, blocks up to 8 task ids (no cycles), assignment {proposed_role}, estimate_hours 0-1000, review {requested_by, verdict?, reviewed_by?}, claim_expires_at; actual_start/actual_end are derived, never written}; message.add {thread_id p_<uuid> of a task, text 1-2000, kind? question|finding|challenge|decision|note (default note), refs?}; context.save {title 1-120, text 1-8000, refs?, id? p_<uuid> to add a version}. Unknown fields are rejected.',properties:{op:{enum:poundOps},expected_revision:{type:'integer',minimum:0,description:'workspace.revision from the latest read'},request_id:{type:'string',pattern:'^[A-Za-z0-9_-]{16,80}$',description:'Idempotency key, 16-80 chars. Resend the exact same call to replay safely.'},data:{type:'object',description:'Per-op fields; see this tool description or writeSchema from the read tool.'},assistant}},
 research:{type:'object',additionalProperties:false,required:['type','key','payload'],description:'One BDB research contribution. payload shapes by type: hypothesis {title 1-200, method 1-4000, id? + expectedVersion? to revise, status? exploratory|withdrawn (registered, confirmatory and verdicts are the signed owner\'s, not this connector\'s), family? speed-retention|accel-decel-cut|missingness|external-market|other, optional design text up to 500 each: target, predictionTime, cohort, featureCutoff, splitPolicy, baseline, metric, exclusions}; evidence {url http(s) 1-2000, title 1-200, excerpt 1-4000, kind? paper|data|code|post|other}; discussion {hypothesisId, kind note|challenge|advisory_review|finding, body 1-4000, evidenceIds array of up to 30 ids; advisory_review requires current hypothesisVersion and optionally a matching receiptId + receiptHash pair. Advisory reviews are non-independent, nonbinding, and never satisfy scientific or holdout gates. A finding requires hypothesisVersion, receiptId, receiptHash and reviewId; advisory-derived findings remain explicitly non-independent. Binding owner decisions are denied}. Tasks, claims, runs and permission changes are denied.',properties:{type:{enum:Object.keys(researchFields)},key:{...str(160),description:'Idempotency key; resend the exact call to replay safely.'},payload:{type:'object',description:'Per-type fields; see this tool description or writeSchema from the read tool.'},assistant}}
};
// Research project tools (WO-01). Listed only when the research app is on AND the Worker has
// RESEARCH_PROJECTS_ENABLED=true; they ride the research grant, so revoking it removes them.
const projectNames=['dd_owner_project_read','dd_owner_project_write'];
const projectArg={type:'string',pattern:'^[a-z0-9][a-z0-9-]{1,62}$',description:'Project slug, e.g. bdb-2027.'};
const projectOps=['project.save','project.health','milestone.save','check.set','question.save','question.answer','decision.save','decision.resolve','vote.cast','role.propose','role.accept','policy.save'];
const projectFlat={
 read:{type:'object',additionalProperties:false,description:'Read one research project record. Omit project_id to get only the write schema and section list. section: summary (default) | milestones | checks | questions | decisions | votes | roles | policies | audit; offset/limit page the list sections (limit 1-200).',properties:{project_id:projectArg,section:{type:'string',enum:['summary','milestones','checks','questions','decisions','votes','roles','policies','audit']},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200}}},
 write:{type:'object',additionalProperties:false,required:['project_id','op','expected_revision','request_id','data'],description:'One research project write. Read first for expected_revision (the project revision) and the exact per-op writeSchema. Proposals only: project.save, project.health, question.answer, decision.resolve, decision.respond, role.accept and policy.save are the signed owner\'s and are refused here. check.set may set unchecked or evidence_attached (with evidence_refs) only; votes are advisory. vote.cast {decision_id, proposal_version (from the read), value 1|0|-1|abstain, rationale required for -1}. Updates quote expected_record_revision. After 409 revision_conflict re-read and retry with a NEW request_id; resend the identical call only after a lost response. Unknown fields are rejected.',properties:{project_id:projectArg,op:{enum:projectOps},expected_revision:{type:'integer',minimum:0,description:'project revision from the latest read'},request_id:{type:'string',pattern:'^[A-Za-z0-9_-]{16,80}$',description:'Idempotency key, 16-80 chars.'},data:{type:'object',description:'Per-op fields; see writeSchema from the read tool.'},assistant}}
};
const withAssistant=schema=>({...schema,oneOf:schema.oneOf.map(s=>({...s,properties:{...s.properties,assistant}}))});
const label=args=>{if(!Object.hasOwn(args,'assistant'))return null;const v=args.assistant;check(typeof v==='string'&&v.trim().length>=1&&v.length<=40&&!/[\u0000-\u001f\u007f]/.test(v),400,'invalid_assistant_label');return v;};
const without=(args,key)=>{const {[key]:_,...rest}=args;return rest;};
// Uploaded archive: metadata only. The connector never streams, copies or links the bytes.
// Lifecycle is the bucket rule documented in PRIVATE-ACTIVATION.md (quarantine/ expires 30 days
// after upload); it is stated, not read from Cloudflare.
export const QUARANTINE_DAYS=30,UPLOAD_PART_BYTES=8*1024*1024;
const sha256Hex=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
async function datasetStatus(fbGet,env,uid){
 try{
  const r=await fbGet(env,'/researchUploads/v1/'+uid,true),d=r?.data?.payload?JSON.parse(r.data.payload):null;
  if(!d)return {status:'none',note:'No archive upload recorded for this owner.',rawData:'not_exposed'};
  const out={status:d.status,name:d.name,size:d.size,parts:Array.isArray(d.hashes)?d.hashes.length:null,partBytes:UPLOAD_PART_BYTES,
   partHashesSha256:Array.isArray(d.hashes)?await sha256Hex(d.hashes.join('\n')):null,
   createdAt:d.createdAt?new Date(d.createdAt).toISOString():null,completedAt:d.completedAt?new Date(d.completedAt).toISOString():null,
   storage:{bucket:'datadawgs-research-private',key:d.key,prefix:String(d.key||'').split('/')[0]+'/'},object:'not_checked',rawData:'not_exposed',
   integrity:'Each 8 MiB part was SHA-256 verified on receipt. Compare partHashesSha256 with research-lab/data/archive.py verify on the local copy.'};
  if(d.durable?.key){
   // Promoted: report the durable copy as the dataset of record; the quarantine original is left to its lifecycle rule.
   out.durable={key:d.durable.key,sha256:d.durable.sha256,size:d.durable.size,promotedAt:d.durable.promotedAt?new Date(d.durable.promotedAt).toISOString():null,verification:d.durable.verification||null};
   if(env.RESEARCH_UPLOADS){const h=await env.RESEARCH_UPLOADS.head(d.durable.key);out.durable.object=h?'present':'missing';if(h)out.durable.objectMatchesRecordedSize=h.size===d.size;}
  }
  if(env.RESEARCH_UPLOADS&&d.key){const head=await env.RESEARCH_UPLOADS.head(d.key);
   if(!head)out.object=out.durable?.object==='present'?'quarantine_copy_expired_durable_copy_present':'missing';
   else{const uploaded=head.uploaded instanceof Date?head.uploaded:new Date(head.uploaded);Object.assign(out,{object:'present',objectSize:head.size,objectMatchesRecordedSize:head.size===d.size,objectUploadedAt:uploaded.toISOString(),
    lifecycle:out.storage.prefix==='quarantine/'?{rule:'quarantine/ objects expire '+QUARANTINE_DAYS+' days after upload (documented bucket rule, not read from Cloudflare)',expiresAt:new Date(uploaded.getTime()+QUARANTINE_DAYS*86400000).toISOString(),durable:out.durable?.object==='present'}:{durable:true}});}}
  if(out.durable?.object==='present'&&!out.lifecycle)out.lifecycle={durable:true};
  return out;
 }catch{return {status:'unavailable',rawData:'not_exposed'};}
}
export const OWNER_APP_STATUSES=['on','off','expired','not_owner','app_disabled','tenant_unconfigured','storage_unavailable'];

const names={pound:['dd_owner_pound_read','dd_owner_pound_write'],research:['dd_owner_bdb_read','dd_owner_bdb_write','dd_owner_bdb_data']};
const emptySchema={type:'object',properties:{},additionalProperties:false};
export function createOwnerApps({fbGet,fbPut,ownerIdentity,transition,view,codeHash,pound,project,now=Date.now}){
 const owner=(env,caller)=>{check(caller?.kind==='user'&&/^u_[A-Za-z0-9_-]{1,100}$/.test(caller.uid||'')&&caller.uid===env.RESEARCH_OWNER_UID,403,'configured_owner_required');return caller.uid;};
 const path=(env,app,uid)=>app==='pound'?'/privatePounds/'+uid:'/researchLab/v1/tenants/'+env.RESEARCH_UPLOAD_TENANT;
 const read=async(env,app,uid)=>{
  check(app==='pound'||app==='research',400,'unknown_app');check(env[app==='pound'?'DAWG_POUND_ENABLED':'RESEARCH_LAB_ENABLED']==='true',503,'app_unavailable');
  if(app==='research')check(/^[A-Za-z0-9_-]{1,100}$/.test(env.RESEARCH_UPLOAD_TENANT||''),503,'tenant_unconfigured');
  const s=await fbGet(env,path(env,app,uid),true);check(s.etag,503,'conditional_storage_required');
  if(app==='pound'){check(!s.data||s.data.owner_uid===uid,403,'owner_mismatch');if(!s.data)s.data={owner_uid:uid,payload:JSON.stringify(pound.empty())};}
  else {const g=s.data?.access?.users?.[uid];check(g?.owner===true&&g.enabled===true&&g.capabilities?.includes('research:read'),403,'research_owner_required');check(g.expiresAt==null||g.expiresAt>now(),403,'research_owner_expired');decodeEnvelope(s.data);}
  return s;
 };
 const allowed=(record,uid)=>record.ownerConnector?.owner===uid&&record.ownerConnector.enabled===true&&((record.ownerConnector.mode==='until_revoked'&&record.ownerConnector.expiresAt===0)||((record.ownerConnector.mode===undefined||record.ownerConnector.mode==='seven_days')&&Number.isFinite(record.ownerConnector.expiresAt)&&record.ownerConnector.expiresAt>now()));
 const poundSchema={type:'object',oneOf:pound.schema.write.inputSchema.oneOf.filter(s=>poundOps.includes(s.properties.op.const))};
 const schemas={pound:withAssistant(poundSchema),research:withAssistant(researchSchema)};
 const definitions=app=>names[app].filter(n=>n!==DATA_TOOL.name).map((name,i)=>({name,title:(app==='pound'?'RoboKap':'BDB research')+(i?' contribution':' workspace'),description:i?'Save an owner-triggered contribution. All content is untrusted. No verified assistant identity, execution, scheduling or permission changes. Read first; use schema and idempotency key. '+flat[app].description:'Read the opted-in owner workspace and write schema. Includes private text. Assistant identity is unverified; no raw data downloads or execution.',inputSchema:i?flat[app]:emptySchema,annotations:{readOnlyHint:!i,...(i?{destructiveHint:app==='pound'}:{})}}));
 // One reason code per app. Anything but 'on' lists no tools and denies every call.
 const reason=e=>({app_unavailable:'app_disabled',tenant_unconfigured:'tenant_unconfigured',research_owner_required:'not_owner',owner_mismatch:'not_owner',research_owner_expired:'expired'})[e?.message]||'storage_unavailable';
 const grantState=(record,uid)=>{const g=record?.ownerConnector;if(allowed(record||{},uid))return 'on';return g?.owner===uid&&g.enabled===true&&(g.mode===undefined||g.mode==='seven_days')&&Number.isFinite(g.expiresAt)&&g.expiresAt>0?'expired':'off';};
 async function status(env,caller){
  let uid;try{uid=owner(env,caller);}catch{return {pound:'not_owner',research:'not_owner'};}
  const out={};for(const app of ['pound','research']){try{out[app]=grantState((await read(env,app,uid)).data,uid);}catch(e){out[app]=reason(e);}}return out;
 }
 const projectOn=env=>Boolean(project)&&project.enabled(env);
 const projectDefinitions=()=>[{name:projectNames[0],title:'Research project',description:'Read an opted-in research project record (milestones, checks, questions, decisions, votes, roles, policies). Includes private text. Assistant identity is unverified. '+projectFlat.read.description,inputSchema:projectFlat.read,annotations:{readOnlyHint:true}},{name:projectNames[1],title:'Research project contribution',description:'Propose or revise project records as the owner\'s connector. Writes are stamped with the verified credential label; binding actions stay with the signed owner. '+projectFlat.write.description,inputSchema:projectFlat.write,annotations:{readOnlyHint:false,destructiveHint:false}}];
 async function list(env,caller){try{const state=await status(env,caller);return ['pound','research'].filter(app=>state[app]==='on').flatMap(app=>[...definitions(app),...(app==='research'&&dataEnabled(env)?[DATA_TOOL]:[]),...(app==='research'&&projectOn(env)?projectDefinitions():[])]);}catch{return [];}}
 // Grant and expiry are checked before storage I/O, then again after it: before returning a
 // read and immediately before a commit (J.5 27).
 const researchGrant=async(env,uid)=>{const s=await read(env,'research',uid);check(allowed(s.data,uid),403,'app_permission_off_or_expired');return s;};
 const regrant=(s,uid)=>{check(allowed(s.data,uid),403,'app_permission_expired');const g=s.data.access.users[uid];check(g.enabled===true&&g.owner===true&&g.capabilities.includes('research:read')&&(g.expiresAt==null||g.expiresAt>now()),403,'research_owner_expired');};
 async function runProject(name,args,env,caller,reauth,uid){
  check(projectOn(env),503,'app_unavailable');const grant=await researchGrant(env,uid);
  const identity={actor:'owner-connector:'+uid,owner:uid,assistantIdentity:'unverified',credential_label:caller.keyLabel??null,mode:'owner_connector'};
  if(name===projectNames[0]){
   check(Object.keys(args).every(k=>Object.hasOwn(projectFlat.read.properties,k)),400,'unexpected_arguments');
   if(!Object.hasOwn(args,'project_id'))return {writeSchema:project.schema.write.inputSchema,sections:project.sections,limits:project.limits,identity};
   const {state}=await project.load(env,args.project_id,uid);const result={project:project.read(state,args,now()),writeSchema:project.schema.write.inputSchema,identity};
   regrant(grant,uid);check(bytes(result)<=524288,507,'response_capacity');return result;
  }
  const authorLabel=label(args);args=without(args,'assistant');
  check(Object.keys(args).every(k=>Object.hasOwn(projectFlat.write.properties,k)),400,'unexpected_arguments');check(typeof args.project_id==='string',400,'project_id_required');
  const {project_id,...input}=args,loaded=await project.load(env,project_id,uid);
  const out=await project.apply(loaded.state,input,{uid,actor_kind:'owner_connector',credential_label:caller.keyLabel??null,author_label:authorLabel},now());
  const stamped=authorLabel?{...identity,author_label:authorLabel,author_label_trust:'unverified'}:identity;
  if(out.replayed||out.unchanged)return {...out,as_of:loaded.state.updated_at,identity:stamped};
  const again=typeof reauth==='function'?await reauth():null;check(owner(env,again)===uid&&(again.keyLabel??null)===(caller.keyLabel??null),401,'connector_identity_changed');
  regrant(grant,uid);
  check(await project.commit(env,project_id,loaded.saved,loaded.state,uid),409,'revision_conflict');
  return {...out,as_of:loaded.state.updated_at,identity:stamped};
 }
 async function run(name,args,env,caller,reauth){
  const uid=owner(env,caller);if(projectNames.includes(name)){check(object(args)&&bytes(args)<=32768,400,'invalid_arguments');return runProject(name,args,env,caller,reauth,uid);}
  const app=Object.keys(names).find(a=>names[a].includes(name));check(app,404,'unknown_private_tool');check(object(args)&&bytes(args)<=32768,400,'invalid_arguments');
  const s=await read(env,app,uid);check(allowed(s.data,uid),403,'app_permission_off_or_expired');
  if(name===DATA_TOOL.name){
   const result=await readDevelopmentData(env,uid,args);
   check(typeof reauth==='function'&&owner(env,await reauth())===uid,401,'connector_identity_changed');
   check(allowed((await read(env,app,uid)).data,uid),403,'app_permission_off_or_expired');
   return result;
  }
  const writing=name.endsWith('_write'),actor='owner-connector:'+uid,authorLabel=writing?label(args):null;if(writing)args=without(args,'assistant');
  // The verified key label from mcpAuth (work/mcp-block.js). Display and attribution only: it
  // grants nothing, and every authorization check below is unchanged.
  const credentialLabel=caller.keyLabel??null;if(writing)check(typeof credentialLabel==='string'&&/^[A-Za-z0-9_-]{1,24}$/.test(credentialLabel),401,'verified_credential_label_required');
  const identity={actor,owner:uid,assistantIdentity:'unverified',credential_label:credentialLabel,mode:'owner_connector',scheduler:'unconfigured'};
  const principal={tenant:env.RESEARCH_UPLOAD_TENANT,id:actor,subject:uid,capabilities:researchScopes,credentialLabel};
  if(!writing){check(Object.keys(args).length===0,400,'unexpected_arguments');const workspace=app==='pound'?pound.view(JSON.parse(s.data.payload)):view(decodeEnvelope(s.data).state,principal);if(app==='research')for(const task of workspace.tasks)if(task.lease)task.lease={owner:task.lease.owner,expiresAt:task.lease.expiresAt};const result={workspace,writeSchema:schemas[app],identity,holdout:'unavailable',rawData:'not_exposed',...(app==='research'?{dataset:await datasetStatus(fbGet,env,uid)}:{})};check(bytes(result)<=524288,507,'response_capacity');return result;}
  let next,result;
  if(app==='pound'){
   check(poundOps.includes(args.op),403,'operation_denied');pound.validate(args,pound.schema.write.inputSchema);
   const state=JSON.parse(s.data.payload),fingerprint=await pound.hash(pound.canonical(args));const previous=state.receipts.find(r=>r.agent===actor&&r.request_id===args.request_id);
   if(previous){check(previous.fingerprint===fingerprint,409,'idempotency_conflict');return {receipt:previous.result,replayed:true,identity};}
   check(args.expected_revision===state.revision,409,'revision_conflict');result=await pound.write(state,args,uid,'owner_connector',authorLabel,credentialLabel);
   state.receipts.push({agent:actor,request_id:args.request_id,fingerprint,result});state.receipts=state.receipts.slice(-128);next={...s.data,payload:JSON.stringify(state)};check(bytes(state)<=524288,413,'workspace_capacity');
  }else{
   check(Object.keys(args).length===3&&['type','key','payload'].every(k=>Object.hasOwn(args,k))&&['hypothesis','evidence','discussion'].includes(args.type),403,'operation_denied');
   const envelope=decodeEnvelope(s.data);const schema=researchSchema.oneOf.find(x=>x.properties.type.const===args.type);pound.validate(args,schema);if(args.type==='discussion')check(Array.isArray(args.payload.evidenceIds)&&args.payload.evidenceIds.length<=30&&args.payload.evidenceIds.every(id=>typeof id==='string'&&id.length>0&&id.length<=100),400,'invalid_evidence_ids');let changed;try{changed=await transition(envelope.state,authorLabel?{...principal,authorLabel}:principal,args,now(),codeHash);}catch(e){check(false,/conflict/i.test(e.message)?409:400,e.message);}result=changed.result;
   check(bytes(view(changed.state,principal))<=500000,507,'response_capacity');next=encodeEnvelope({...envelope,state:changed.state});check(bytes(next)<=2097152,507,'workspace_capacity');
  }
  {const again=typeof reauth==='function'?await reauth():null;check(owner(env,again)===uid&&(again.keyLabel??null)===credentialLabel,401,'connector_identity_changed');}check(allowed(s.data,uid),403,'app_permission_expired');if(app==='research'){const g=s.data.access.users[uid];check(g.enabled===true&&g.owner===true&&g.capabilities.includes('research:read')&&(g.expiresAt==null||g.expiresAt>now()),403,'research_owner_expired');}
  check(await fbPut(env,path(env,app,uid),next,s.etag),409,'workspace_changed_retry_same_key');return {result,identity:authorLabel?{...identity,author_label:authorLabel,author_label_trust:'unverified'}:identity};
 }
 async function permissions(request,env){
  const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','Vary':'Origin, Authorization'};
  const send=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  try{
   const url=new URL(request.url),origin=request.headers.get('Origin');check(url.pathname==='/owner-apps/v1'&&!url.search,404,'route_denied');check(!origin||['https://datadawgs216.com','https://www.datadawgs216.com'].includes(origin),403,'origin_denied');
   if(origin)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'});
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers});check(['GET','POST'].includes(request.method),405,'method_denied');
   const uid=owner(env,{kind:'user',uid:await ownerIdentity(request,env)});
   if(request.method==='GET'){
    const apps=[];for(const app of ['pound','research']){try{const s=await read(env,app,uid),g=s.data.ownerConnector;apps.push({app,status:grantState(s.data,uid),enabled:allowed(s.data,uid),version:g?.version||0,expiresAt:g?.expiresAt||null,mode:g?.mode||(Number.isFinite(g?.expiresAt)?'seven_days':null),tools:definitions(app),resources:app==='pound'?'Entire owner RoboKap workspace: roster, tasks, messages, all context versions.':'Entire research state in tenant '+env.RESEARCH_UPLOAD_TENANT+'. Raw uploads and execution excluded.'});}catch(e){apps.push({app,available:false,status:reason(e),error:e.status?e.message:'app_unavailable'});}}
    return send({owner:uid,tenant:env.RESEARCH_UPLOAD_TENANT,ttlDays:7,modes:['seven_days','until_revoked'],apps,assistantIdentity:'unverified',affects:'Every holder of your existing personal DataDawgs connector credential.'});
   }
   check((request.headers.get('Content-Type')||'').split(';')[0]==='application/json',415,'json_required');
   const reader=request.body?.getReader();check(reader,400,'body_required');let size=0,chunks=[],timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reader.cancel().catch(()=>{});reject(Object.assign(Error('body_timeout'),{status:408}));},10000);});
   try{for(;;){const {done,value}=await Promise.race([reader.read(),timeout]);if(done)break;size+=value.length;check(size<=2048,413,'body_limit');chunks.push(value);}}finally{clearTimeout(timer);await reader.cancel().catch(()=>{});}
   const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}let b;try{b=JSON.parse(new TextDecoder().decode(raw));}catch{check(false,400,'invalid_json');}
   check(object(b)&&Object.keys(b).length===(b.enabled?4:3)&&['app','enabled','expectedVersion'].every(k=>Object.hasOwn(b,k))&&typeof b.enabled==='boolean'&&Number.isSafeInteger(b.expectedVersion)&&b.expectedVersion>=0&&(!b.enabled||['seven_days','until_revoked'].includes(b.mode)),400,'invalid_fields');
   const s=await read(env,b.app,uid);check((s.data.ownerConnector?.version||0)===b.expectedVersion,409,'permission_changed_refresh');
   const at=now(),grant={owner:uid,enabled:b.enabled,...(b.enabled?{mode:b.mode,expiresAt:b.mode==='until_revoked'?0:at+TTL}:{expiresAt:null}),version:b.expectedVersion+1};const next={...s.data,ownerConnector:grant,ownerConnectorAudit:[...(s.data.ownerConnectorAudit||[]),{actor:uid,app:b.app,enabled:b.enabled,at,version:grant.version,expiresAt:grant.expiresAt,...(grant.mode?{mode:grant.mode}:{})}].slice(-64)};
   check(await ownerIdentity(request,env)===uid,401,'owner_session_changed');if(b.app==='research'){const g=s.data.access.users[uid];check(g.expiresAt==null||g.expiresAt>now(),403,'research_owner_expired');}check(await fbPut(env,path(env,b.app,uid),next,s.etag),409,'workspace_changed_refresh');return send({app:b.app,...grant});
  }catch(e){return send({error:e.status||e.poundStatus?e.message:'owner_apps_unavailable'},e.status||e.poundStatus||503);}
 }
 return {list,status,run,permissions};
}


