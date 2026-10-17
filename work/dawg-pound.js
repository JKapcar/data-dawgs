/* Private owner workspace. No agent execution, credentials, grants or public discovery.
 * Release gate stays closed until RTDB rules and platform logging have been reviewed.
 * API schema and validation share the same definitions. MCP transport is deliberately inert. */
const POUND_LIMITS = Object.freeze({agents:24,tasks:40,messages:100,contexts:16,versions:8,activity:60,receipts:128,body_bytes:32768,state_bytes:524288});
const poundString = (maxLength,minLength=1)=>({type:'string',minLength,maxLength});
const poundId = {type:'string',pattern:'^p_[a-f0-9-]{36}$'};
// Additive, optional fields (2026-10-16). Every PR 276 payload still validates. refs are
// plain text references; the UI links only https URLs on an allowlist.
const poundRefs = {type:'array',maxItems:8,items:poundString(300)};
const POUND_MESSAGE_KINDS = ['question','finding','challenge','decision','note'];
const poundFields = {
  'agent.save': {id:poundId,name:poundString(60),role:poundString(100),function:poundString(500),capabilities:poundString(500,0),archived:{type:'boolean'}},
  'task.save': {id:poundId,title:poundString(120),body:poundString(2000,0),agent_id:{type:'string',pattern:'^(|p_[a-f0-9-]{36})$'},status:{enum:['queued','working','done','blocked']},archived:{type:'boolean'},refs:poundRefs,expected_task_revision:{type:'integer',minimum:1}},
  'message.add': {thread_id:poundId,text:poundString(2000),kind:{enum:POUND_MESSAGE_KINDS},refs:poundRefs},
  'context.save': {id:poundId,title:poundString(120),text:poundString(8000),refs:poundRefs},
  'context.archive': {id:poundId},
};
const poundRequired = {'agent.save':['name','role','function','capabilities','archived'],'task.save':['title','body','agent_id','status','archived'],'message.add':['thread_id','text'],'context.save':['title','text'],'context.archive':['id']};
const POUND_SCHEMA = {
  version:1,owner_transport:'/api/pound',agent_transport:'/mcp/pound',agent_access_enabled:false,
  authentication:{header:'Authorization',scheme:'Bearer',credential:'existing_signed_site_session',immutable_uid_required:true,rejected_headers:['X-Dawg-Session','X-Bozo-Session','X-Dawg-Pass'],query_credentials:false},
  limits:POUND_LIMITS,
  read:{method:'GET',path:'/api/pound',query_parameters:false},
  write:{method:'POST',path:'/api/pound',inputSchema:{oneOf:Object.keys(poundFields).map(op=>({type:'object',additionalProperties:false,required:['op','expected_revision','request_id','data'],properties:{op:{const:op},expected_revision:{type:'integer',minimum:0},request_id:{type:'string',pattern:'^[A-Za-z0-9_-]{16,80}$'},data:{type:'object',additionalProperties:false,required:poundRequired[op],properties:poundFields[op]}}}))}},
  mcp:{enabled:false,tools:[],reason:'Agent access requires separate explicit setup.'}
};
function poundFail(status,message){const e=new Error(message);e.poundStatus=status;throw e;}
function poundCheck(ok,status,message){if(!ok)poundFail(status,message);}
function poundValidate(value,schema){
  if(schema.oneOf){const match=schema.oneOf.find(s=>s.properties.op.const===value?.op);poundCheck(match,400,'Unknown operation');return poundValidate(value,match);}
  if(schema.const!==undefined)poundCheck(value===schema.const,400,'Invalid operation');
  if(schema.enum)poundCheck(schema.enum.includes(value),400,'Invalid status');
  if(schema.type==='object'){
    poundCheck(value&&typeof value==='object'&&!Array.isArray(value),400,'Object required');
    poundCheck(Object.keys(value).every(k=>Object.hasOwn(schema.properties,k)),400,'Unknown field');
    poundCheck(schema.required.every(k=>Object.hasOwn(value,k)),400,'Required field missing');
    for(const k of Object.keys(value))poundValidate(value[k],schema.properties[k]);
  }
  if(schema.type==='string'){
    poundCheck(typeof value==='string',400,'Text required');
    if(schema.minLength!==undefined)poundCheck(value.trim().length>=schema.minLength&&value.length<=schema.maxLength,400,'Text length outside limit');
    if(schema.pattern)poundCheck(new RegExp(schema.pattern).test(value),400,'Invalid identifier');
  }
  if(schema.type==='array'){poundCheck(Array.isArray(value)&&value.length<=schema.maxItems,400,'List outside limit');for(const item of value)poundValidate(item,schema.items);}
  if(schema.type==='boolean')poundCheck(typeof value==='boolean',400,'Boolean required');
  if(schema.type==='integer')poundCheck(Number.isSafeInteger(value)&&value>=schema.minimum,400,'Invalid revision');
}
async function poundBody(request){
  poundCheck((request.headers.get('Content-Type')||'').split(';')[0].trim()==='application/json',415,'JSON required');
  const reader=request.body?.getReader();poundCheck(reader,400,'JSON required');
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>POUND_LIMITS.body_bytes){await reader.cancel();poundFail(413,'Request too large');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{poundFail(400,'Invalid JSON');}
}
async function poundIdentity(request,env){
  // Presence (even empty) is a conflict. Never fall back to legacy/MCP credentials.
  poundCheck(!POUND_SCHEMA.authentication.rejected_headers.some(h=>request.headers.has(h)),401,'Use Authorization with your site session');
  // Exact signed-session shape also closes readSession's permissive extra-dot suffix.
  const match=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43})$/i.exec(request.headers.get('Authorization')||'');
  poundCheck(match,401,'Sign in again');
  const token=match[1];
  const signed=token?await readSession(env,token):null;
  poundCheck(signed&&/^u_[A-Za-z0-9_-]{1,100}$/.test(signed.u||''),401,'Sign in again');
  // In-memory adapter only: reuse the account/revocation verifier unchanged. This
  // object is never dispatched, fetched, logged or used to renew a response session.
  const auth=await sessionAuth({headers:new Headers({'X-Dawg-Session':token})},env);
  poundCheck(!auth.err&&auth.uid===signed.u,401,'Sign in again');
  return auth.uid;
}
function poundEmpty(){return {revision:0,updated_at:null,agents:[],tasks:[],messages:[],contexts:[],activity:[],receipts:[]};}
// Tasks saved before task revisions existed read as revision 1, which is what the next
// update must quote. Nothing is rewritten until that update commits.
function poundView(state){const {receipts,...view}=state;return {...view,tasks:view.tasks.map(t=>({...t,revision:t.revision||1})),agent_access_enabled:false};}
function poundItem(rows,id){const row=rows.find(r=>r.id===id);poundCheck(row,404,'Item not found');return row;}
async function poundHash(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}
function poundCanonical(v){return v&&typeof v==='object'?(Array.isArray(v)?'['+v.map(poundCanonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+poundCanonical(v[k])).join(',')+'}'):JSON.stringify(v);}
async function poundWrite(state,input,uid,actorKind='owner',authorLabel=null){
  const now=new Date().toISOString(),d=input.data,op=input.op;
  // Self-reported by the connector caller; recorded for humans, never trusted for access.
  const author=authorLabel?{author_label:authorLabel,author_label_trust:'unverified'}:{};
  const makeId=()=> 'p_'+crypto.randomUUID();let id=d.id;
  if(op==='agent.save'||op==='task.save'){
    const isAgent=op==='agent.save',rows=isAgent?state.agents:state.tasks;
    const {expected_task_revision:expected,...fields}=d;
    let row=id?poundItem(rows,id):null;
    // A task update must quote the task's own revision, so two writers editing the same
    // task cannot silently overwrite each other even when other work moved the workspace.
    if(!isAgent&&row)poundCheck(expected===(row.revision||1),409,'task_revision_conflict');
    if(!isAgent&&!row)poundCheck(expected===undefined,400,'expected_task_revision applies to updates only');
    if(!row){poundCheck(rows.length<POUND_LIMITS[isAgent?'agents':'tasks'],409,'Workspace item limit reached');row={id:makeId(),created_at:now};rows.push(row);}
    if(!isAgent&&d.agent_id)poundCheck(!poundItem(state.agents,d.agent_id).archived,409,'Agent is archived');
    if(!isAgent)row.revision=(row.revision||(row.updated_at?1:0))+1;
    Object.assign(row,fields,{updated_at:now});id=row.id;
    if(isAgent)Object.assign(row,{connection_status:'not_connected',last_seen:null,capabilities_source:'owner_declared'});
    else row.status_source=actorKind==='owner'?'owner_reported':'owner_connector_reported';
  }else if(op==='message.add'){
    poundCheck(!poundItem(state.tasks,d.thread_id).archived,409,'Task is archived');
    poundCheck(state.messages.length<POUND_LIMITS.messages,409,'Message limit reached');
    id=makeId();state.messages.push({id,...d,kind:d.kind||'note',actor_uid:uid,actor_kind:actorKind,...author,created_at:now});
  }else if(op==='context.save'){
    let row=id?poundItem(state.contexts,id):null;
    if(!row){poundCheck(state.contexts.length<POUND_LIMITS.contexts,409,'Context limit reached');row={id:makeId(),versions:[],created_at:now,archived:false};state.contexts.push(row);}
    poundCheck(!row.archived,409,'Context is archived');
    poundCheck(row.versions.length<POUND_LIMITS.versions,409,'Context version limit reached; create a new document');
    const version=row.versions.length+1;
    row.versions.push({version,text:d.text,title:d.title,sha256:await poundHash(d.text),created_at:now,actor_uid:uid,actor_kind:actorKind,...author,...(d.refs?{refs:d.refs}:{}),predecessor:version>1?version-1:null});
    row.title=d.title;row.active_version=version;row.updated_at=now;id=row.id;
  }else{const row=poundItem(state.contexts,id);row.archived=true;row.updated_at=now;}
  state.revision++;state.updated_at=now;
  state.activity.push({id:makeId(),operation:op,item_id:id,actor_uid:uid,actor_kind:actorKind,...author,at:now});
  state.activity=state.activity.slice(-POUND_LIMITS.activity);
  return {item_id:id,revision:state.revision};
}
async function handlePound(request,env){
  const url=new URL(request.url),origin=request.headers.get('Origin');
  const headers={'Content-Type':'application/json','Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Vary':'Origin, Authorization','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
  if(origin&&ORIGINS.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS'});
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  try{
    poundCheck(!origin||ORIGINS.includes(origin),403,'Origin denied');
    poundCheck(!url.search,400,'Query parameters are not accepted');
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    // Every /mcp/pound suffix is intercepted before the public MCP dispatcher.
    if(url.pathname==='/mcp/pound'||url.pathname.startsWith('/mcp/pound/')||url.pathname.startsWith('/api/pound/agents/'))return reply({error:'Agent access is not enabled'},503);
    poundCheck(['/api/pound','/api/pound/schema'].includes(url.pathname),404,'Route not found');
    const uid=await poundIdentity(request,env);
    if(url.pathname==='/api/pound/schema'){poundCheck(request.method==='GET',405,'GET required');return reply(POUND_SCHEMA);}
    poundCheck(env.DAWG_POUND_ENABLED==='true',503,'Dispatch is awaiting private workspace setup');
    poundCheck(request.method==='GET'||request.method==='POST',405,'GET or POST required');
    const writing=request.method==='POST',input=writing?await poundBody(request):null;
    if(writing)poundValidate(input,POUND_SCHEMA.write.inputSchema);
    const path='/privatePounds/'+uid;
    const saved=await fbGet(env,path,true);
    // JSON string preserves empty arrays exactly through RTDB's null/array normalization.
    const state=saved.data?JSON.parse(saved.data.payload):poundEmpty();
    poundCheck(!saved.data||saved.data.owner_uid===uid,503,'Workspace unavailable');
    if(!writing)return reply({workspace:poundView(state)});
    const fingerprint=await poundHash(poundCanonical(input));
    const previous=state.receipts.find(r=>!r.agent&&r.request_id===input.request_id);
    if(previous){poundCheck(previous.fingerprint===fingerprint,409,'Request ID already used');return reply({receipt:previous.result,replayed:true,workspace:poundView(state)});}
    poundCheck(input.expected_revision===state.revision,409,'Workspace changed. Refresh before saving.');
    const result=await poundWrite(state,input,uid);
    state.receipts.push({request_id:input.request_id,fingerprint,result});state.receipts=state.receipts.slice(-POUND_LIMITS.receipts);
    const payload=JSON.stringify(state);
    poundCheck(new TextEncoder().encode(payload).byteLength<=POUND_LIMITS.state_bytes,413,'Workspace storage limit reached');
    poundCheck(saved.etag,503,'Conditional storage unavailable');
    // Recheck password/account revocation immediately before the conditional commit.
    poundCheck(await poundIdentity(request,env)===uid,401,'Sign in again');
    poundCheck(await fbPut(env,path,{...saved.data,owner_uid:uid,payload},saved.etag),409,'Workspace changed. Refresh before saving.');
    return reply({receipt:result,replayed:false,workspace:poundView(state)});
  }catch(e){return reply({error:e.poundStatus?e.message:'Workspace temporarily unavailable'},e.poundStatus||503);}
}
