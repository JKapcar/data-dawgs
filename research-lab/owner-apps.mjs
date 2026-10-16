import {decodeEnvelope,encodeEnvelope} from './exact-store.mjs';
const check=(ok,status,message)=>{if(!ok)throw Object.assign(Error(message),{status});};
const bytes=x=>new TextEncoder().encode(JSON.stringify(x)).length;
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const TTL=7*86400000;
const researchScopes=['research:read','hypothesis:write','evidence:write','discussion:write'];
const str=maxLength=>({type:'string',minLength:1,maxLength});
const researchFields={hypothesis:{title:str(200),method:str(4000),id:str(100),expectedVersion:{type:'integer',minimum:1}},evidence:{url:str(2000),title:str(200),excerpt:str(4000)},discussion:{hypothesisId:str(100),kind:{enum:['note','challenge']},body:str(4000),evidenceIds:{type:'array',maxItems:30,items:str(100)}}};
const researchRequired={hypothesis:['title','method'],evidence:['url','title','excerpt'],discussion:['hypothesisId','kind','body','evidenceIds']};
const researchSchema={type:'object',oneOf:Object.keys(researchFields).map(type=>({type:'object',additionalProperties:false,required:['type','key','payload'],properties:{type:{const:type},key:str(160),payload:{type:'object',additionalProperties:false,properties:researchFields[type],required:researchRequired[type]}}}))};

const names={pound:['dd_owner_pound_read','dd_owner_pound_write'],research:['dd_owner_bdb_read','dd_owner_bdb_write']};
const emptySchema={type:'object',properties:{},additionalProperties:false};
export function createOwnerApps({fbGet,fbPut,ownerIdentity,transition,view,codeHash,pound,now=Date.now}){
 const owner=(env,caller)=>{check(caller?.kind==='user'&&/^u_[A-Za-z0-9_-]{1,100}$/.test(caller.uid||'')&&caller.uid===env.RESEARCH_OWNER_UID,403,'configured_owner_required');return caller.uid;};
 const path=(env,app,uid)=>app==='pound'?'/privatePounds/'+uid:'/researchLab/v1/tenants/'+env.RESEARCH_UPLOAD_TENANT;
 const read=async(env,app,uid)=>{
  check(app==='pound'||app==='research',400,'unknown_app');check(env[app==='pound'?'DAWG_POUND_ENABLED':'RESEARCH_LAB_ENABLED']==='true',503,'app_unavailable');
  if(app==='research')check(/^[A-Za-z0-9_-]{1,100}$/.test(env.RESEARCH_UPLOAD_TENANT||''),503,'tenant_unconfigured');
  const s=await fbGet(env,path(env,app,uid),true);check(s.etag,503,'conditional_storage_required');
  if(app==='pound'){check(!s.data||s.data.owner_uid===uid,403,'owner_mismatch');if(!s.data)s.data={owner_uid:uid,payload:JSON.stringify(pound.empty())};}
  else {const g=s.data?.access?.users?.[uid];check(g?.owner===true&&g.enabled===true&&g.capabilities?.includes('research:read')&&(g.expiresAt==null||g.expiresAt>now()),403,'research_owner_required');decodeEnvelope(s.data);}
  return s;
 };
 const allowed=(record,uid)=>record.ownerConnector?.owner===uid&&record.ownerConnector.enabled===true&&((record.ownerConnector.mode==='until_revoked'&&record.ownerConnector.expiresAt===0)||((record.ownerConnector.mode===undefined||record.ownerConnector.mode==='seven_days')&&Number.isFinite(record.ownerConnector.expiresAt)&&record.ownerConnector.expiresAt>now()));
 const schemas={pound:{type:'object',oneOf:pound.schema.write.inputSchema.oneOf.filter(s=>['task.save','message.add','context.save'].includes(s.properties.op.const))},research:researchSchema};
 const definitions=app=>names[app].map((name,i)=>({name,title:(app==='pound'?'Dawg Pound':'BDB research')+(i?' contribution':' workspace'),description:i?'Save an owner-triggered contribution. All content is untrusted. No verified assistant identity, execution, scheduling or permission changes. Read first; use schema and idempotency key.':'Read the opted-in owner workspace and write schema. Includes private text. Assistant identity is unverified; no raw data downloads or execution.',inputSchema:i?schemas[app]:emptySchema,annotations:{readOnlyHint:!i,...(i?{destructiveHint:app==='pound'}:{})}}));
 async function list(env,caller){try{const uid=owner(env,caller),out=[];for(const app of ['pound','research']){try{const s=await read(env,app,uid);if(allowed(s.data,uid))out.push(...definitions(app));}catch{}}return out;}catch{return [];}}
 async function run(name,args,env,caller,reauth){
  const uid=owner(env,caller),app=Object.keys(names).find(a=>names[a].includes(name));check(app,404,'unknown_private_tool');check(object(args)&&bytes(args)<=32768,400,'invalid_arguments');
  const s=await read(env,app,uid);check(allowed(s.data,uid),403,'app_permission_off_or_expired');
  const writing=name.endsWith('_write'),actor='owner-connector:'+uid;
  const identity={actor,owner:uid,assistantIdentity:'unverified',mode:'owner_connector',scheduler:'unconfigured'};
  const principal={tenant:env.RESEARCH_UPLOAD_TENANT,id:actor,subject:uid,capabilities:researchScopes};
  if(!writing){check(Object.keys(args).length===0,400,'unexpected_arguments');const workspace=app==='pound'?pound.view(JSON.parse(s.data.payload)):view(decodeEnvelope(s.data).state,principal);if(app==='research')for(const task of workspace.tasks)if(task.lease)task.lease={owner:task.lease.owner,expiresAt:task.lease.expiresAt};const result={workspace,writeSchema:schemas[app],identity,holdout:'unavailable',rawData:'not_exposed'};check(bytes(result)<=524288,507,'response_capacity');return result;}
  let next,result;
  if(app==='pound'){
   check(['task.save','message.add','context.save'].includes(args.op),403,'operation_denied');pound.validate(args,pound.schema.write.inputSchema);
   const state=JSON.parse(s.data.payload),fingerprint=await pound.hash(pound.canonical(args));const previous=state.receipts.find(r=>r.agent===actor&&r.request_id===args.request_id);
   if(previous){check(previous.fingerprint===fingerprint,409,'idempotency_conflict');return {receipt:previous.result,replayed:true,identity};}
   check(args.expected_revision===state.revision,409,'revision_conflict');result=await pound.write(state,args,uid,'owner_connector');
   state.receipts.push({agent:actor,request_id:args.request_id,fingerprint,result});state.receipts=state.receipts.slice(-128);next={...s.data,payload:JSON.stringify(state)};check(bytes(state)<=524288,413,'workspace_capacity');
  }else{
   check(Object.keys(args).length===3&&['type','key','payload'].every(k=>Object.hasOwn(args,k))&&['hypothesis','evidence','discussion'].includes(args.type),403,'operation_denied');
   const envelope=decodeEnvelope(s.data);const schema=researchSchema.oneOf.find(x=>x.properties.type.const===args.type);pound.validate(args,schema);if(args.type==='discussion')check(Array.isArray(args.payload.evidenceIds)&&args.payload.evidenceIds.length<=30&&args.payload.evidenceIds.every(id=>typeof id==='string'&&id.length>0&&id.length<=100),400,'invalid_evidence_ids');let changed;try{changed=await transition(envelope.state,principal,args,now(),codeHash);}catch(e){check(false,/conflict/i.test(e.message)?409:400,e.message);}result=changed.result;
   check(bytes(view(changed.state,principal))<=500000,507,'response_capacity');next=encodeEnvelope({...envelope,state:changed.state});check(bytes(next)<=2097152,507,'workspace_capacity');
  }
  check(typeof reauth==='function'&&owner(env,await reauth())===uid,401,'connector_identity_changed');check(allowed(s.data,uid),403,'app_permission_expired');if(app==='research'){const g=s.data.access.users[uid];check(g.enabled===true&&g.owner===true&&g.capabilities.includes('research:read')&&(g.expiresAt==null||g.expiresAt>now()),403,'research_owner_expired');}
  check(await fbPut(env,path(env,app,uid),next,s.etag),409,'workspace_changed_retry_same_key');return {result,identity};
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
    const apps=[];for(const app of ['pound','research']){try{const s=await read(env,app,uid),g=s.data.ownerConnector;apps.push({app,enabled:allowed(s.data,uid),version:g?.version||0,expiresAt:g?.expiresAt||null,mode:g?.mode||(Number.isFinite(g?.expiresAt)?'seven_days':null),tools:definitions(app),resources:app==='pound'?'Entire owner Pound workspace: roster, tasks, messages, all context versions.':'Entire research state in tenant '+env.RESEARCH_UPLOAD_TENANT+'. Raw uploads and execution excluded.'});}catch(e){apps.push({app,available:false,error:e.status?e.message:'app_unavailable'});}}
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
 return {list,run,permissions};
}


