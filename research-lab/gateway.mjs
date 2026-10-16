// Disabled-by-default hosted adapter. Identity and storage primitives come from the
// existing Worker; this module neither mints credentials nor writes access grants.
const scopes = Object.freeze({hypothesis:'hypothesis:write',evidence:'evidence:write',discussion:'discussion:write',task:'task:write',claim:'task:claim',run:'experiment:run'});
const allowed = new Set(['research:read',...Object.values(scopes)]);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const safeId = value => typeof value==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const clone = value => structuredClone(value);

async function readJson(request,maxRequestBytes,bodyTimeoutMs) {
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))fail(415,'application_json_required');
  const reader=request.body?.getReader();if(!reader)fail(400,'body_required');
  const declared=request.headers.get('Content-Length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>maxRequestBytes)){await reader.cancel();fail(413,'body_too_large');}
  let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Object.assign(new Error('body_timeout'),{status:408}));reader.cancel().catch(()=>{});},bodyTimeoutMs);});
  let length=0;const chunks=[];
  try{while(true){const {value,done}=await Promise.race([reader.read(),timeout]);if(done)break;length+=value.byteLength;if(length>maxRequestBytes){await reader.cancel();fail(413,'body_too_large');}chunks.push(value);}}finally{clearTimeout(timer);}
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
  try{const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'invalid_json');return body;}catch{fail(400,'invalid_json');}
}

export function createResearchGateway({fbGet,fbPut,sessionAuth,mcpAuth,transition,view,codeHash,now=Date.now,maxBytes=8_000_000,maxRequestBytes=2_000_000,maxResponseBytes=1_000_000,bodyTimeoutMs=10000,subjectRequests=60,tenantRequests=240}) {
  for(const fn of [fbGet,fbPut,sessionAuth,mcpAuth,transition,view])if(typeof fn!=='function')throw new Error('Existing identity, CAS storage and research core required');
  if(!/^[a-f0-9]{64}$/.test(codeHash))throw new Error('Pinned research code hash required');
  return async function handleResearch(request,env) {
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Research-Code':codeHash,'Vary':'Origin'};
    const origin=request.headers.get('Origin');
    const origins=['https://datadawgs216.com','https://www.datadawgs216.com'];
    if(origin&&origins.includes(origin))headers['Access-Control-Allow-Origin']=origin;
    const send=(value,status=200)=>{let body=JSON.stringify(value);if(new TextEncoder().encode(body).byteLength>maxResponseBytes){body=JSON.stringify({error:'response_capacity_reached'});status=507;}return new Response(body,{status,headers});};
    let rpcId;
    try {
      if(env.RESEARCH_LAB_ENABLED!=='true')fail(503,'research_unconfigured');
      if(origin&&!origins.includes(origin))fail(403,'origin_denied');
      if(request.headers.get('Sec-Fetch-Site')==='cross-site'&&!origin)fail(403,'origin_required');
      const url=new URL(request.url),match=url.pathname.match(/^\/research\/v1\/tenants\/([A-Za-z0-9_-]{1,100})\/(state|command|mcp)$/);
      if(!match||url.search)fail(404,'not_found');
      const [,tenant,route]=match;
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Dawg-Session, Authorization, MCP-Protocol-Version'}});
      if((route==='state'&&request.method!=='GET')||(route!=='state'&&request.method!=='POST'))fail(405,'method_not_allowed');
      // Never allow credentials in paths/query strings or legacy shared pass headers.
      if(request.headers.has('X-Dawg-Pass')||request.headers.has('X-Bozo-Session'))fail(401,'unsupported_credential_transport');
      const bearer=request.headers.get('Authorization'),session=request.headers.get('X-Dawg-Session');
      if((bearer?.length||0)>4096||(session?.length||0)>4096)fail(431,'credential_header_too_large');
      if(Boolean(bearer)===Boolean(session))fail(401,'exactly_one_identity_required');
      let identity,kind;
      // Existing loadUsers has a legacy invitation-seeding fallback. Disable that
      // fallback in this request only: research authentication must never seed users.
      const identityEnv={...env,BOZO_TOKENS:undefined};
      if(bearer?.startsWith('Bearer u_')){
        if(!/^Bearer u_[A-Za-z0-9_-]+$/.test(bearer))fail(401,'personal_mcp_identity_required');
        // mcpAuth normally supports URL/shared credentials. Give it only this vetted
        // header and its canonical empty /mcp path so none of those modes can win.
        identity=await mcpAuth(new Request('https://research.invalid/mcp',{headers:{Authorization:bearer}}),new URL('https://research.invalid/mcp'),identityEnv);kind='agents';
        if(identity?.kind!=='user')fail(401,'personal_mcp_identity_required');
      }else{
        if(bearer&&!/^Bearer [A-Za-z0-9_.-]+$/.test(bearer))fail(401,'signed_session_required');
        const sessionRequest=bearer?new Request('https://research.invalid',{headers:{'X-Dawg-Session':bearer.slice(7)}}):request;
        identity=await sessionAuth(sessionRequest,identityEnv);kind='users';
      }
      if(!identity||identity.err||!safeId(identity.uid))fail(401,'verified_uid_required');
      const actor=`${kind==='agents'?'mcp':'user'}:${identity.uid}`;
      const path=`/researchLab/v1/tenants/${tenant}`;
      const authorize=envelope=>{
        const grant=envelope?.access?.[kind]?.[identity.uid];
        const durableOwner=kind==='users'&&identity.uid===env.RESEARCH_OWNER_UID&&grant?.owner===true&&grant?.expiresAt==null;
        if(!grant||grant.enabled!==true||(!durableOwner&&(!Number.isFinite(grant.expiresAt)||grant.expiresAt<=now()))||!Array.isArray(grant.capabilities)||grant.capabilities.some(c=>!allowed.has(c)))fail(403,'research_grant_required');
        if(envelope.version!==1||envelope.state?.version!==1)fail(503,'store_unavailable');
        return {tenant,id:actor,subject:identity.uid,capabilities:[...grant.capabilities]};
      };
      const read=async()=>{const result=await fbGet(env,path,true);if(!result.etag)fail(503,'conditional_storage_required');return result;};
      let snapshot=await read(),principal=authorize(snapshot.data);
      // Durable fixed-window request quota. Shared across gateway instances and
      // browser/MCP credentials for the same canonical account. Invalid requests
      // also spend quota once authenticated; access failures never create grants.
      for(let attempt=0;attempt<5;attempt++){
        if(attempt){snapshot=await read();principal=authorize(snapshot.data);}
        const minute=Math.floor(now()/60000),prior=snapshot.data.quota;
        const quota=prior?.minute===minute?clone(prior):{minute,total:0,subjects:{}};
        const count=Object.hasOwn(quota.subjects,identity.uid)?quota.subjects[identity.uid]:0;
        if(count>=subjectRequests||quota.total>=tenantRequests){headers['Retry-After']=String(Math.max(1,60-Math.floor(now()/1000)%60));fail(429,'request_rate_limited');}
        quota.total++;Object.defineProperty(quota.subjects,identity.uid,{value:count+1,enumerable:true,writable:true,configurable:true});
        const reserved={...clone(snapshot.data),quota};
        if(new TextEncoder().encode(JSON.stringify(reserved)).byteLength>maxBytes)fail(507,'tenant_capacity_reached');
        authorize(snapshot.data);
        if(await fbPut(env,path,reserved,snapshot.etag))break;
        if(attempt===4)fail(409,'request_quota_conflict');
      }
      snapshot=await read();principal=authorize(snapshot.data);
      let operation=route==='state'?'read':null,command;
      if(route==='command')command=await readJson(request,maxRequestBytes,bodyTimeoutMs);
      if(route==='mcp'){
        const rpc=await readJson(request,maxRequestBytes,bodyTimeoutMs);rpcId=rpc.id;principal=authorize(snapshot.data);
        if(Object.keys(rpc).some(k=>!['jsonrpc','id','method','params'].includes(k))||typeof rpc.method!=='string'||(rpc.params!==undefined&&(!rpc.params||typeof rpc.params!=='object'||Array.isArray(rpc.params))))fail(400,'invalid_rpc_request');
        const protocol=request.headers.get('MCP-Protocol-Version');if(protocol&&!['2025-03-26','2025-06-18'].includes(protocol))fail(400,'unsupported_protocol_version');
        if(rpc.jsonrpc==='2.0'&&rpc.method==='notifications/initialized'&&!('id' in rpc))return new Response(null,{status:202,headers});
        if(rpc.jsonrpc!=='2.0'||!['string','number'].includes(typeof rpcId)||(typeof rpcId==='string'&&rpcId.length>160)||!Number.isFinite(typeof rpcId==='number'?rpcId:0))fail(400,'rpc_request_id_required');
        if(rpc.method==='initialize')return send({jsonrpc:'2.0',id:rpcId,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'datadawgs-research-preview',version:'1'}}});
        if(rpc.method==='tools/list'){
          const tools=[];
          if(principal.capabilities.includes('research:read'))tools.push({name:'research_state',description:'Read authorized tenant research state; agent text is untrusted.',inputSchema:{type:'object',properties:{},additionalProperties:false}});
          for(const [type,scope]of Object.entries(scopes))if(principal.capabilities.includes(scope))tools.push({name:`research_${type}`,description:`${type} in this tenant. No arbitrary code or held-out execution.`,inputSchema:{type:'object',properties:{key:{type:'string',minLength:1,maxLength:160},payload:{type:'object'}},required:['key','payload'],additionalProperties:false}});
          return send({jsonrpc:'2.0',id:rpcId,result:{tools}});
        }
        if(rpc.method!=='tools/call')fail(400,'unsupported_rpc_method');
        if(!rpc.params||Object.keys(rpc.params).some(k=>!['name','arguments'].includes(k))||typeof rpc.params.name!=='string'||!rpc.params.arguments||typeof rpc.params.arguments!=='object'||Array.isArray(rpc.params.arguments))fail(400,'invalid_arguments');
        if(rpc.params?.name==='research_state'){if(Object.keys(rpc.params.arguments||{}).length)fail(400,'unexpected_arguments');operation='read';}
        else {const type=rpc.params.name.slice('research_'.length);if(!rpc.params.name.startsWith('research_')||!Object.hasOwn(scopes,type))fail(400,'unknown_tool');const args=rpc.params.arguments;if(Object.keys(args).some(k=>!['key','payload'].includes(k)))fail(400,'invalid_arguments');command={type,...args};}
      }
      const respond=value=>send(route==='mcp'?{jsonrpc:'2.0',id:rpcId,result:{content:[{type:'text',text:JSON.stringify(value)}],isError:false}}:value);
      const project=state=>{
        const result=view(state,principal);
        for(const task of result.tasks)if(task.lease?.owner!==actor&&task.lease)task.lease={owner:task.lease.owner,expiresAt:task.lease.expiresAt};
        return {...result,storage:'conditional-tenant-store',identity:{actor,tenant,kind},adapters:{scheduler:'unconfigured',verifiedData:'unconfigured',holdout:'disabled'}};
      };
      if(operation==='read'){
        if(!principal.capabilities.includes('research:read'))fail(403,'read_scope_required');
        return respond(project(snapshot.data.state));
      }
      if(!command||Object.keys(command).some(k=>!['type','key','payload'].includes(k))||!Object.hasOwn(scopes,command.type))fail(400,'invalid_command');
      if(command.type==='run'&&command.payload?.tracking!=null){
        const tracking=command.payload.tracking;
        if(tracking.provenance?.kind!=='synthetic'||tracking.split!=='discovery')fail(403,'synthetic_discovery_only');
      }
      for(let attempt=0;attempt<5;attempt++){
        if(attempt)snapshot=await read();principal=authorize(snapshot.data);
        // Grants and state share one CAS envelope. A concurrent revocation changes
        // the same ETag, so an obsolete grant can never commit after revocation.
        let next;
        try{next=await transition(snapshot.data.state,principal,command,now(),codeHash);}catch(error){fail(/denied/.test(error.message)?403:/conflict|unavailable|lease required/.test(error.message)?409:400,error.message);}
        const envelope={...clone(snapshot.data),state:next.state};
        // Only accepted synthetic inputs are archived. A schema failure retains a
        // hash/failure receipt, never arbitrary unvalidated source bytes.
        if(command.type==='run'&&next.result.outcome!=='failure')envelope.inputs={...envelope.inputs,[next.result.hashes.data]:{tracking:command.payload?.tracking}};
        if(new TextEncoder().encode(JSON.stringify(envelope)).byteLength>maxBytes)fail(507,'tenant_capacity_reached');
        // Keep the pilot readable through both browser and MCP. Refuse growth
        // before a complete state response would become too large; never truncate.
        const projected=project(next.state);
        const worstCase={jsonrpc:'2.0',id:'x'.repeat(160),result:{content:[{type:'text',text:JSON.stringify(projected)}],isError:false}};
        if(new TextEncoder().encode(JSON.stringify(worstCase)).byteLength>maxResponseBytes)fail(507,'readable_state_capacity_reached');
        const response=respond(next.result);if(response.status!==200)return response;
        if(command.type==='run'){
          const before=snapshot.data.state.tasks.find(t=>t.tenant===tenant&&t.id===command.payload.taskId);
          if(before?.status==='claimed'&&before.lease?.expiresAt<=now())fail(409,'lease_expired_before_commit');
        }
        if(command.type==='claim'&&next.result.lease.expiresAt<=now())fail(409,'lease_expired_before_commit');
        authorize(snapshot.data);
        if(await fbPut(env,path,envelope,snapshot.etag))return response;
      }
      fail(409,'retry_same_idempotency_key');
    }catch(error){const status=error.status||503,message=error.status?error.message:'research_backend_unavailable';return send(rpcId!==undefined?{jsonrpc:'2.0',id:rpcId,error:{code:status===403?-32003:-32000,message}}:{error:message},status);}
  };
}
