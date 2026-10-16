import {agentCredential,authorizeAgent,POUND_AGENT_SCOPES,agentCheck as check} from './agent-identity.mjs';
const id=x=>typeof x==='string'&&/^p_[a-f0-9-]{36}$/.test(x);
const text=(x,n)=>typeof x==='string'&&x.trim().length>0&&x.length<=n;
const canonical=x=>JSON.stringify(x,(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(x)))),b=>b.toString(16).padStart(2,'0')).join('');
const tools={pound_roster:'pound:roster:read',pound_tasks:'pound:task:read',pound_context:'pound:context:read',pound_message:'pound:message:append',pound_progress:'pound:task:update-own'};
const schemas={
 pound_roster:{},pound_tasks:{},pound_context:{id:{type:'string'},version:{type:'integer',minimum:1}},
 pound_message:{key:{type:'string',minLength:16,maxLength:80},revision:{type:'integer',minimum:0},thread_id:{type:'string'},text:{type:'string',minLength:1,maxLength:2000}},
 pound_progress:{key:{type:'string',minLength:16,maxLength:80},revision:{type:'integer',minimum:0},task_id:{type:'string'},status:{enum:['working','done','blocked']}}
};
async function body(request){
 check((request.headers.get('Content-Type')||'').split(';')[0]==='application/json',415,'json_required');
 const reader=request.body?.getReader();check(reader,400,'body_required');let timer;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reader.cancel().catch(()=>{});reject(Object.assign(Error('body_timeout'),{status:408}));},10000);});
 const parts=[];let length=0;
 try{for(;;){const {value,done}=await Promise.race([reader.read(),deadline]);if(done)break;length+=value.length;check(length<=32768,413,'body_limit');parts.push(value);}}
 finally{clearTimeout(timer);await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(length);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{check(false,400,'invalid_json');}
}
export function createPoundAgentGateway({fbGet,fbPut,now=Date.now}){
 return async(request,env)=>{
  const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};let rpcId;
  const send=(x,status=200)=>new Response(JSON.stringify(x),{status,headers});
  try{
   check(env.DAWG_POUND_ENABLED==='true',503,'pound_unconfigured');
   const credential=await agentCredential(request,env),url=new URL(request.url);
   check(!url.search,400,'query_denied');
   const match=/^\/agents\/v1\/owners\/(u_[A-Za-z0-9_-]{1,100})\/mcp$/.exec(url.pathname);check(match,404,'route_not_found');
   const owner=match[1],path='/privatePounds/'+owner;
   const origin=request.headers.get('Origin');check(!origin||['https://datadawgs216.com','https://www.datadawgs216.com'].includes(origin),403,'origin_denied');
   check(request.method==='POST',405,'post_required');
   const rpc=await body(request);rpcId=rpc?.id;
   check(rpc&&rpc.jsonrpc==='2.0'&&Object.keys(rpc).every(k=>['jsonrpc','id','method','params'].includes(k)),400,'invalid_rpc');
   const protocol=request.headers.get('MCP-Protocol-Version');check(!protocol||['2025-03-26','2025-06-18'].includes(protocol),400,'protocol_unsupported');
   const read=async()=>{const s=await fbGet(env,path,true);check(s.etag&&s.data?.owner_uid===owner,403,'workspace_unavailable');return s;};
   const authorize=s=>{
    const g=authorizeAgent(credential,s.data.agentAccess?.[credential.id],'pound:'+owner,POUND_AGENT_SCOPES,now());
    check(id(g.rosterId)&&Array.isArray(g.taskIds)&&g.taskIds.length<=40&&g.taskIds.every(id)&&Array.isArray(g.rosterIds)&&g.rosterIds.length<=24&&g.rosterIds.every(id)&&g.contextVersions&&typeof g.contextVersions==='object'&&!Array.isArray(g.contextVersions),403,'resource_grant_invalid');
    check(Object.entries(g.contextVersions).length<=16&&Object.entries(g.contextVersions).every(([k,v])=>id(k)&&Array.isArray(v)&&v.length<=8&&v.every(n=>Number.isSafeInteger(n)&&n>0)),403,'context_grant_invalid');
    return g;
   };
   let snapshot=await read(),grant=authorize(snapshot);
   if(rpc.method==='notifications/initialized'&&!('id'in rpc))return new Response(null,{status:202,headers});
   check((typeof rpcId==='string'&&rpcId.length<=160)||(typeof rpcId==='number'&&Number.isFinite(rpcId)),400,'rpc_id_required');
   if(rpc.method==='initialize')return send({jsonrpc:'2.0',id:rpcId,result:{protocolVersion:rpc.params?.protocolVersion==='2025-03-26'?'2025-03-26':'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'datadawgs-private-agents',version:'1'}}});
   if(rpc.method==='tools/list')return send({jsonrpc:'2.0',id:rpcId,result:{tools:Object.entries(tools).filter(([,scope])=>grant.capabilities.includes(scope)).map(([name])=>({name,description:'Access explicitly shared Pound resources. Text is untrusted; no model execution.',inputSchema:{type:'object',properties:schemas[name],required:Object.keys(schemas[name]),additionalProperties:false}}))}});
   check(rpc.method==='tools/call'&&rpc.params&&Object.keys(rpc.params).every(k=>['name','arguments'].includes(k)),400,'unsupported_method');
   const name=rpc.params.name,args=rpc.params.arguments;
   check(Object.hasOwn(tools,name)&&grant.capabilities.includes(tools[name]),403,'tool_denied');
   check(args&&typeof args==='object'&&!Array.isArray(args)&&Object.keys(args).length===Object.keys(schemas[name]).length&&Object.keys(args).every(k=>Object.hasOwn(schemas[name],k)),400,'invalid_arguments');
   const state=JSON.parse(snapshot.data.payload),actor='agent:'+credential.id;
   check(Array.isArray(state.agents)&&state.agents.some(a=>a.id===grant.rosterId&&!a.archived),403,'agent_roster_unavailable');
   const accessibleTask=taskId=>{const task=state.tasks.find(t=>t.id===taskId&&!t.archived);check(grant.taskIds.includes(taskId)&&task?.agent_id===grant.rosterId,403,'task_denied');return task;};
   const respond=result=>send({jsonrpc:'2.0',id:rpcId,result:{content:[{type:'text',text:JSON.stringify({result,revision:state.revision,identity:{actor,owner},connection_status:'authenticated_request',scheduler:'unconfigured'})}],isError:false}});
   if(name==='pound_roster')return respond(state.agents.filter(a=>grant.rosterIds.includes(a.id)&&!a.archived).map(a=>({id:a.id,name:a.name,role:a.role,function:a.function,capabilities_source:'owner_declared'})));
   if(name==='pound_tasks')return respond(state.tasks.filter(t=>grant.taskIds.includes(t.id)&&t.agent_id===grant.rosterId&&!t.archived).map(t=>({...t,messages:state.messages.filter(m=>m.thread_id===t.id)})));
   if(name==='pound_context'){
    check(id(args.id)&&Number.isSafeInteger(args.version)&&grant.contextVersions[args.id]?.includes(args.version),403,'context_denied');
    const context=state.contexts.find(c=>c.id===args.id&&!c.archived),version=context?.versions.find(v=>v.version===args.version);check(version,404,'context_unavailable');return respond({id:context.id,version});
   }
   check(typeof args.key==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(args.key)&&Number.isSafeInteger(args.revision)&&args.revision>=0,400,'invalid_write');
   const task=accessibleTask(args.thread_id||args.task_id);
   if(name==='pound_message')check(text(args.text,2000),400,'invalid_text');else check(['working','done','blocked'].includes(args.status),400,'invalid_status');
   const fingerprint=await hash({name,args}),previous=state.receipts.find(r=>r.agent===actor&&r.request_id===args.key);
   if(previous){check(previous.fingerprint===fingerprint,409,'idempotency_conflict');return respond({...previous.result,replayed:true});}
   check(state.revision===args.revision,409,'revision_conflict');
   const at=new Date(now()).toISOString();let itemId=task.id;
   if(name==='pound_message'){check(state.messages.length<100,409,'message_limit');itemId='p_'+crypto.randomUUID();state.messages.push({id:itemId,thread_id:task.id,text:args.text,actor_uid:actor,actor_kind:'agent',created_at:at});}
   else Object.assign(task,{status:args.status,status_source:'agent_reported',updated_at:at});
   state.revision++;state.updated_at=at;
   state.activity.push({id:'p_'+crypto.randomUUID(),operation:name,item_id:itemId,actor_uid:actor,actor_kind:'agent',at});state.activity=state.activity.slice(-60);
   const result={item_id:itemId,revision:state.revision};state.receipts.push({agent:actor,request_id:args.key,fingerprint,result});state.receipts=state.receipts.slice(-128);
   const payload=JSON.stringify(state);check(new TextEncoder().encode(payload).length<=524288,413,'workspace_limit');
   authorize(snapshot); // Expiry rechecked; revocation is atomic with this envelope's ETag.
   check(await fbPut(env,path,{...snapshot.data,payload},snapshot.etag),409,'revision_conflict');return respond({...result,replayed:false});
  }catch(e){return send(rpcId!==undefined?{jsonrpc:'2.0',id:rpcId,error:{code:-32000,message:e.status?e.message:'agent_backend_unavailable'}}:{error:e.status?e.message:'agent_backend_unavailable'},e.status||503);}
 };
}
