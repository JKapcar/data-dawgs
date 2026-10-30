// Explicit owner-operated issuance only. No model calls, auto-activation or secret logging.
import {agentCheck as check,RESEARCH_AGENT_SCOPES} from './agent-identity.mjs';
import {RK_AGENT_SEATS,RK_AGENT_SCOPES} from './robokap-core.mjs';
// Pack Sled seat credentials: the seat and scopes are stored on the grant and enforced by the
// server. Presets are suggestions the owner picks from; the scopes saved are the ones shown.
export const SLED_PRESETS={researcher:{seat:'claude',scopes:['sled:work:read','sled:work:claim']},reviewer:{seat:'claude-reviewer',scopes:['sled:work:read','sled:review']},coordinator:{seat:'coordinator',scopes:['sled:work:read','sled:coordinate']}};
export const SLED_MAX_DAYS=30,SLED_ACTIVE_LIMIT=12;
const scopes=['pound:roster:read','pound:task:read','pound:context:read','pound:message:append'];
const uid=x=>typeof x==='string'&&/^u_[A-Za-z0-9_-]{1,100}$/.test(x);
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const endpoint=(audience,owner,tenant)=>audience==='pound'?`https://toto.jkapcar4.workers.dev/agents/v1/owners/${owner}/mcp`:audience==='sled'?`https://toto.jkapcar4.workers.dev/agents/v1/owners/${owner}/sled/mcp`:`https://toto.jkapcar4.workers.dev/research/v1/tenants/${tenant}/mcp`;
const label=x=>typeof x==='string'&&x.trim().length>0&&x.length<=40&&!/[\u0000-\u001f\u007f<>]/.test(x);
async function json(request){
 check((request.headers.get('Content-Type')||'').split(';')[0]==='application/json',415,'json_required');
 const reader=request.body?.getReader();check(reader,400,'body_required');let timer;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reader.cancel().catch(()=>{});reject(Object.assign(Error('body_timeout'),{status:408}));},10000);});
 let length=0;const chunks=[];
 try{for(;;){const {done,value}=await Promise.race([reader.read(),timeout]);if(done)break;length+=value.length;check(length<=4096,413,'body_limit');chunks.push(value);}}finally{clearTimeout(timer);await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{check(false,400,'invalid_json');}
}
export function createAgentSetup({fbGet,fbPut,ownerIdentity,now=Date.now}){
 return async(request,env)=>{
  const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Vary':'Origin, Authorization'};
  const send=(x,status=200)=>new Response(JSON.stringify(x),{status,headers});
  try{
   check(env.AGENT_SETUP_ENABLED==='true',503,'setup_unconfigured');
   const origin=request.headers.get('Origin');check(!origin||['https://datadawgs216.com','https://www.datadawgs216.com'].includes(origin),403,'origin_denied');
   if(origin)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'});
   check(!request.headers.has('Sec-Fetch-Site')||request.headers.get('Sec-Fetch-Site')!=='cross-site'||origin,403,'origin_required');
   const url=new URL(request.url);check(url.pathname==='/agent-setup/v1'&&!url.search,404,'route_denied');
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   check(['GET','POST'].includes(request.method),405,'method_denied');
   check(uid(env.RESEARCH_OWNER_UID)&&/^[A-Za-z0-9_-]{1,100}$/.test(env.RESEARCH_UPLOAD_TENANT||''),503,'owner_unconfigured');
   const owner=await ownerIdentity(request,env);check(owner===env.RESEARCH_OWNER_UID,403,'owner_required');
   const tenant=env.RESEARCH_UPLOAD_TENANT;
   const paths={pound:'/privatePounds/'+owner,sled:'/privatePounds/'+owner,research:'/researchLab/v1/tenants/'+tenant},sledAud='sled:'+owner;
   const read=async audience=>{const s=await fbGet(env,paths[audience],true);check(s.etag&&s.data&&typeof s.data==='object'&&!Array.isArray(s.data)&&typeof s.data.payload==='string',503,'workspace_unavailable');if(audience!=='research')check(s.data.owner_uid===owner,403,'owner_required');else {const g=s.data.access?.users?.[owner];check(g?.enabled===true&&g.owner===true&&g.capabilities?.includes('research:read')&&(g.expiresAt==null||(Number.isFinite(g.expiresAt)&&g.expiresAt>now())),403,'research_owner_required');}return s;};
   // Pound and Pack Sled grants share the private record's agentAccess; the audience tells them apart.
   const all=s=>s.data.agentAccess||{};
   const grants=(s,a)=>a==='research'?(s.data.access?.delegated||{}):Object.fromEntries(Object.entries(all(s)).filter(([,g])=>(g?.audience===sledAud)===(a==='sled')));
   const daysLeft=g=>Math.max(0,Math.floor((g.expiresAt-now())/86400000));
   const list=(s,a)=>Object.entries(grants(s,a)).map(([id,g])=>({id,label:g.label||'Existing agent',enabled:g.enabled===true,expiresAt:g.expiresAt,capabilities:g.capabilities,audience:a,status:g.enabled!==true?'revoked':g.expiresAt<=now()?'expired':'issued_not_connection_verified',...(a==='sled'?{seat:g.seat,daysLeft:g.enabled===true?daysLeft(g):null,renewedAt:g.renewedAt??null}:{})}));
   if(request.method==='GET'){
    const p=await read('pound'),r=await read('research'),state=JSON.parse(p.data.payload);
    return send({owner,tenant,delegatedEnabled:env.DELEGATED_AGENTS_ENABLED==='true',sledEnabled:env.SLED_AGENTS_ENABLED==='true',ttlDays:7,sled:{maxDays:SLED_MAX_DAYS,seats:RK_AGENT_SEATS,scopes:RK_AGENT_SCOPES,presets:SLED_PRESETS,endpoint:endpoint('sled',owner,tenant)},scopes:{pound:scopes,research:RESEARCH_AGENT_SCOPES},resources:{roster:state.agents.filter(x=>!x.archived).map(x=>({id:x.id,name:x.name})),tasks:state.tasks.filter(x=>!x.archived).map(x=>({id:x.id,title:x.title,agent_id:x.agent_id})),contexts:state.contexts.filter(x=>!x.archived).map(x=>({id:x.id,title:x.title,versions:x.versions.map(v=>v.version)}))},grants:[...list(p,'pound'),...list(p,'sled'),...list(r,'research')]});
   }
   const b=await json(request);check(b&&typeof b==='object'&&!Array.isArray(b)&&['pound','research','sled'].includes(b.audience)&&['issue','revoke','renew'].includes(b.action)&&(b.action!=='renew'||b.audience==='sled'),400,'invalid_action');
   const fields=b.action==='revoke'?['action','audience','agentId']:b.action==='renew'?['action','audience','agentId','ttlDays']:b.audience==='pound'?['action','audience','rosterId','taskId','contextId','contextVersion']:b.audience==='sled'?['action','audience','seat','scopes','label','ttlDays']:['action','audience'];
   check(Object.keys(b).length===fields.length&&Object.keys(b).every(k=>fields.includes(k)),400,'invalid_fields');
   check(!('ttlDays'in b)||(Number.isSafeInteger(b.ttlDays)&&b.ttlDays>=1&&b.ttlDays<=SLED_MAX_DAYS),400,'invalid_ttl');
   const s=await read(b.audience),entries=grants(s,b.audience);let secret=null,agentId,grant;
   if(b.action==='revoke'){
    check(typeof b.agentId==='string'&&/^[a-f0-9]{32}$/.test(b.agentId)&&Object.hasOwn(entries,b.agentId),404,'grant_unavailable');agentId=b.agentId;grant={...entries[agentId],enabled:false,revokedAt:now()};
   }else if(b.action==='renew'){
    // Renewal keeps the same secret, seat and scopes and moves only the expiry. A revoked
    // credential is never renewed; issue a new one instead.
    check(typeof b.agentId==='string'&&/^[a-f0-9]{32}$/.test(b.agentId)&&Object.hasOwn(entries,b.agentId),404,'grant_unavailable');agentId=b.agentId;
    check(entries[agentId].enabled===true,409,'revoked_credential_issue_new');
    check(!Object.entries(entries).some(([id,g])=>id!==agentId&&g.seat===entries[agentId].seat&&g.enabled===true&&g.expiresAt>now()),409,'another_active_credential_for_seat');
    grant={...entries[agentId],expiresAt:now()+b.ttlDays*86400000,renewedAt:now()};
   }else if(b.audience==='sled'){
    check(RK_AGENT_SEATS.includes(b.seat),400,'invalid_seat');
    check(Array.isArray(b.scopes)&&b.scopes.length>0&&b.scopes.length<=RK_AGENT_SCOPES.length&&new Set(b.scopes).size===b.scopes.length&&b.scopes.every(x=>RK_AGENT_SCOPES.includes(x))&&b.scopes.includes('sled:work:read'),400,'invalid_scopes');
    check(label(b.label),400,'invalid_label');
    check(!Object.values(entries).some(g=>g.seat===b.seat&&g.enabled===true&&g.expiresAt>now()),409,'active_seat_credential_exists_renew_or_revoke');
    check(Object.values(entries).filter(g=>g.enabled===true).length<SLED_ACTIVE_LIMIT,409,'grant_limit');
    grant={label:b.label.trim(),enabled:true,audience:sledAud,seat:b.seat,capabilities:RK_AGENT_SCOPES.filter(x=>b.scopes.includes(x)),createdAt:now(),expiresAt:now()+b.ttlDays*86400000};
   }else{
    check(Object.keys(entries).length<16,409,'grant_limit');
    check(!Object.values(entries).some(g=>g.label==='Claude pilot'&&g.enabled===true&&g.expiresAt>now()),409,'active_pilot_exists_revoke_before_reissue');
    grant={label:'Claude pilot',enabled:true,audience:b.audience==='pound'?'pound:'+owner:'research:'+tenant,capabilities:b.audience==='pound'?[...scopes]:[...RESEARCH_AGENT_SCOPES],createdAt:now(),expiresAt:now()+7*86400000};
    if(b.audience==='pound'){
     const state=JSON.parse(s.data.payload),roster=state.agents.find(x=>x.id===b.rosterId&&!x.archived),task=state.tasks.find(x=>x.id===b.taskId&&!x.archived&&x.agent_id===b.rosterId),context=state.contexts.find(x=>x.id===b.contextId&&!x.archived);
     check(roster&&task&&Number.isSafeInteger(b.contextVersion)&&context?.versions.some(v=>v.version===b.contextVersion),400,'select_existing_assigned_resources');
     Object.assign(grant,{rosterId:b.rosterId,rosterIds:[b.rosterId],taskIds:[b.taskId],contextVersions:{[b.contextId]:[b.contextVersion]}});
    }
   }
   if(b.action==='issue'){
    agentId=crypto.randomUUID().replaceAll('-','');const bytes=crypto.getRandomValues(new Uint8Array(32));
    secret='da1_'+agentId+'_'+btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');grant.credentialHash=await hash(secret);
   }
   const next=structuredClone(s.data);if(b.audience!=='research')next.agentAccess={...all(s),[agentId]:grant};else next.access={...next.access,delegated:{...entries,[agentId]:grant}};
   const audit=Array.isArray(next.agentSetupAudit)?next.agentSetupAudit:[];next.agentSetupAudit=[...audit,{action:b.action,agentId,actor:owner,at:now(),audience:b.audience,...(b.audience==='sled'?{seat:grant.seat,expiresAt:grant.expiresAt}:{})}].slice(-64);
   check(await ownerIdentity(request,env)===owner,401,'owner_session_changed');
   if(b.audience==='research'){const g=s.data.access.users[owner];check(g.expiresAt==null||(Number.isFinite(g.expiresAt)&&g.expiresAt>now()),403,'research_owner_required');}
   check(await fbPut(env,paths[b.audience],next,s.etag),409,'workspace_changed_refresh');
   return send({action:b.action,id:agentId,audience:b.audience,expiresAt:grant.expiresAt,endpoint:endpoint(b.audience,owner,tenant),...(b.audience==='sled'?{seat:grant.seat,capabilities:grant.capabilities}:{}),...(secret?{secret,shownOnce:true}:b.action==='renew'?{renewed:true}:{revoked:true}),delegatedEnabled:env.DELEGATED_AGENTS_ENABLED==='true',sledEnabled:env.SLED_AGENTS_ENABLED==='true'});
  }catch(e){return send({error:e.status?e.message:e.poundStatus?'owner_session_required':'setup_backend_unavailable'},e.status||e.poundStatus||503);}
 };
}
