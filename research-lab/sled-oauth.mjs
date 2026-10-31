// Fixed public-client authorization-code profile. No registration, JWT,
// owner authority, credential URL or automatic grant issuance. Default off.
import {agentCheck as check} from './agent-identity.mjs';
export const OAUTH_ORIGIN='https://toto.jkapcar4.workers.dev';
export const OAUTH_ISSUER=OAUTH_ORIGIN+'/sled/oauth';
export const OAUTH_SCOPES=['sled:work:read','sled:mail:ingest'];
const SITE='https://datadawgs216.com', META='/.well-known/oauth-protected-resource';
const AS_META='/.well-known/oauth-authorization-server/sled/oauth';
const opaque=/^[A-Za-z0-9_-]{43}$/, hex=/^[a-f0-9]{64}$/;
export const oauthHash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
const challenge=async s=>b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;};
// Operator-supplied exact callbacks, never request-supplied registrations or wildcards.
// No callback is fetched by this server. Provider-specific client authentication is separate.
function validRedirect(value){try{const u=new URL(value);return typeof value==='string'&&value.length<=512&&u.href===value&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&!value.includes('*')&&/^[a-z0-9.-]+$/.test(u.hostname)&&u.hostname.includes('.')&&!/^(?:\d+\.){3}\d+$/.test(u.hostname)&&!u.hostname.endsWith('.localhost')&&!u.hostname.endsWith('.local');}catch{return false;}}
export const oauthResource=uid=>OAUTH_ORIGIN+'/agents/v1/owners/'+uid+'/sled/mcp';
export const oauthRoute=p=>p===META||p===AS_META||p.startsWith('/sled/oauth/');
export const oauthEnabled=env=>['SLED_OAUTH_ENABLED','SLED_AGENTS_ENABLED','DELEGATED_AGENTS_ENABLED','ROBOKAP_ENABLED','DAWG_POUND_ENABLED'].every(k=>env[k]==='true');
function clients(env){
 let list;try{list=JSON.parse(env.SLED_OAUTH_CLIENTS||'[]');}catch{check(false,503,'oauth_unconfigured');}
 check(Array.isArray(list)&&list.length>0&&list.length<=8,503,'oauth_unconfigured');
 for(const c of list){
  check(c&&/^[A-Za-z0-9_-]{8,100}$/.test(c.client_id)&&typeof c.name==='string'&&c.name.length<=80&&Array.isArray(c.redirect_uris)&&c.redirect_uris.length>0&&c.redirect_uris.length<=4,503,'oauth_unconfigured');
  check(c.redirect_uris.every(validRedirect),503,'oauth_unconfigured');
 }
 check(new Set(list.map(c=>c.client_id)).size===list.length,503,'oauth_unconfigured');return list;
}
const client=(env,id)=>{const c=clients(env).find(c=>c.client_id===id);check(c,400,'invalid_client');return c;};
const scope=s=>typeof s==='string'&&s.split(' ').length===2&&OAUTH_SCOPES.every(x=>s.split(' ').includes(x));
function parameters(p,env){
 check(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).every(k=>['client_id','redirect_uri','response_type','scope','resource','state','code_challenge','code_challenge_method'].includes(k)),400,'invalid_request');
 const c=client(env,p.client_id);
 check(c.redirect_uris.includes(p.redirect_uri),400,'invalid_redirect_uri');
 check(p.response_type==='code',400,'unsupported_response_type');
 check(p.resource===oauthResource(env.RESEARCH_OWNER_UID),400,'invalid_target');
 check(scope(p.scope),400,'invalid_scope');
 check(typeof p.state==='string'&&p.state.length>=16&&p.state.length<=512&&!/[\x00-\x20\x7f]/.test(p.state),400,'invalid_state');
 check(opaque.test(p.code_challenge||'')&&p.code_challenge_method==='S256',400,'invalid_pkce');
 return {...p,scope:OAUTH_SCOPES.join(' ')};
}
function mailGrant(data,id,uid,at){
 const g=data?.agentAccess?.[id];
 check(/^[a-f0-9]{32}$/.test(id||'')&&g?.enabled===true&&g.audience==='sled:'+uid&&g.seat==='dot'&&Number.isFinite(g.expiresAt)&&g.expiresAt>at&&hex.test(g.credentialHash||'')&&Array.isArray(g.capabilities)&&g.capabilities.length===2&&OAUTH_SCOPES.every(s=>g.capabilities.includes(s)),403,'mail_grant_required');
 return g;
}
// Called against the fresh conditional-write snapshot too. Existing grant validation still runs.
export function resolveOAuthCredential(data,uid,credential,env,at){
 try{
 check(oauthEnabled(env)&&uid===env.RESEARCH_OWNER_UID,401,'invalid_token');
 const t=data?.sledOAuth?.tokens?.[credential.oauthHash];
 check(t&&!t.revoked&&t.expires>at&&t.resource===oauthResource(uid),401,'invalid_token');
 const family=data.sledOAuth.families?.[t.family];
 check(family&&!family.revoked&&family.expires>at,401,'invalid_token');
 client(env,t.client_id);
 const g=mailGrant(data,t.grant_id,uid,at);
 check(same(t.grant_hash,g.credentialHash),401,'invalid_token');
 return {id:t.grant_id,hash:g.credentialHash};
 }catch{check(false,401,'invalid_token');}
}
function unique(params){const out=Object.create(null);for(const [k,v]of params){check(!Object.hasOwn(out,k),400,'invalid_request');out[k]=v;}return out;}
async function body(request,json){
 check((request.headers.get('Content-Type')||'').split(';')[0].trim()===(json?'application/json':'application/x-www-form-urlencoded'),415,'invalid_request');
 const reader=request.body?.getReader();check(reader,400,'invalid_request');let size=0,timer;const chunks=[];
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reader.cancel().catch(()=>{});reject(Object.assign(Error('request_timeout'),{status:408}));},10000);});
 try{for(;;){const {value,done}=await Promise.race([reader.read(),deadline]);if(done)break;size+=value.length;check(size<=8192,413,'invalid_request');chunks.push(value);}}
 finally{clearTimeout(timer);await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return json?JSON.parse(text):unique(new URLSearchParams(text));}catch(e){if(e.status)throw e;check(false,400,'invalid_request');}
}
export function createSledOAuth({fbGet,fbPut,ownerIdentity,now=Date.now}){
 return async(request,env)=>{
  const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"};
  const send=(x,status=200)=>new Response(JSON.stringify(x),{status,headers});
  try{
   check(oauthEnabled(env),503,'oauth_disabled');clients(env);
   check(/^u_[A-Za-z0-9_-]{1,100}$/.test(env.RESEARCH_OWNER_UID||''),503,'oauth_unconfigured');
   const url=new URL(request.url),p=url.pathname,uid=env.RESEARCH_OWNER_UID;
   check(url.origin===OAUTH_ORIGIN,400,'invalid_target');
   const resource=oauthResource(uid);
   if(p===META||p===AS_META){
    check(request.method==='GET'&&!url.search,405,'invalid_request');
    return send(p===META?{resource,authorization_servers:[OAUTH_ISSUER],scopes_supported:OAUTH_SCOPES,bearer_methods_supported:['header']}:{issuer:OAUTH_ISSUER,authorization_endpoint:OAUTH_ISSUER+'/authorize',token_endpoint:OAUTH_ISSUER+'/token',revocation_endpoint:OAUTH_ISSUER+'/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:OAUTH_SCOPES,authorization_response_iss_parameter_supported:true});
   }
   if(p==='/sled/oauth/authorize'){
    check(request.method==='GET'&&url.search.length<=4096,400,'invalid_request');
    const params=parameters(unique(url.searchParams),env);
    return new Response(null,{status:303,headers:{...headers,Location:SITE+'/research-lab/sled-connect.html#'+new URLSearchParams(params)}});
   }
   check(!url.search,400,'invalid_request');
   check(['/sled/oauth/consent','/sled/oauth/token','/sled/oauth/revoke'].includes(p),404,'not_found');
   const consent=p.endsWith('/consent'),origin=request.headers.get('Origin');
   if(consent){
    check(origin===SITE,403,'origin_denied');
    Object.assign(headers,{'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin, Authorization'});
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   }else check(!origin,403,'server_client_required');
   check(request.method==='POST',405,'invalid_request');
   if(!consent)check(!request.headers.has('Authorization'),400,'invalid_client');
   const b=await body(request,consent);check(b&&typeof b==='object'&&!Array.isArray(b),400,'invalid_request');
   let sessionHash;
   if(consent){check(await ownerIdentity(request,env)===uid,403,'owner_required');const auth=request.headers.get('Authorization');check(/^Bearer \S+$/.test(auth||''),401,'owner_required');sessionHash=await oauthHash(auth);}
   const path='/privatePounds/'+uid;
   for(let attempt=0;attempt<4;attempt++){
    const snap=await fbGet(env,path,true);check(snap?.etag&&snap.data?.owner_uid===uid&&typeof snap.data.payload==='string',503,'workspace_unavailable');
    const data=structuredClone(snap.data),at=now(),state=data.sledOAuth??{transactions:{},codes:{},tokens:{},families:{},refresh:{}};
    data.sledOAuth=state;
    // Retain consumed-code tombstones until the access token expires to detect replay.
    for(const [k,v]of Object.entries(state.transactions))if(v.expires<=at)delete state.transactions[k];
    for(const [k,v]of Object.entries(state.codes))if(v.retainUntil<=at)delete state.codes[k];
    for(const [k,v]of Object.entries(state.tokens))if(v.expires<=at)delete state.tokens[k];
    for(const [k,v]of Object.entries(state.families))if(v.expires<=at)delete state.families[k];
    for(const [k,v]of Object.entries(state.refresh))if(!state.families[v.family])delete state.refresh[k];
    async function mint(familyId){
     const f=state.families[familyId],g=mailGrant(data,f.grant_id,uid,at);
     check(same(g.credentialHash,f.grant_hash),400,'invalid_grant');
     check(Object.keys(state.tokens).length<32&&f.rotations<256,429,'connection_capacity');
     const token='pso_'+random(),refresh='psr_'+random(),tokenHash=await oauthHash(token),expires=Math.min(at+300000,g.expiresAt,f.expires);
     state.tokens[tokenHash]={client_id:f.client_id,resource,grant_id:f.grant_id,grant_hash:g.credentialHash,expires,revoked:false,family:familyId};
     state.refresh[await oauthHash(refresh)]={family:familyId,used:false};f.rotations++;
     return {tokenHash,result:{access_token:token,refresh_token:refresh,token_type:'Bearer',expires_in:Math.floor((expires-at)/1000),scope:OAUTH_SCOPES.join(' ')}};
    }
    let result,status=200;
    if(consent){
     if(b.action==='inspect'){
      check(Object.keys(b).every(k=>['action','params'].includes(k)),400,'invalid_request');
      const params=parameters(b.params,env),id=random(),csrf=random();
      check(Object.keys(state.transactions).length<16,429,'consent_capacity');
      state.transactions[id]={params,sessionHash,csrfHash:await oauthHash(csrf),expires:at+600000};
      const grants=Object.entries(data.agentAccess||{}).flatMap(([id,g])=>{try{mailGrant(data,id,uid,at);return [{id,label:g.label||'dot mail relay',expiresAt:g.expiresAt}];}catch{return [];}});
      result={transaction:id,csrf,client_name:client(env,params.client_id).name,resource,scopes:OAUTH_SCOPES,grants,expires_in:600,access_expires_in:300,connection_max_days:7};
     }else{
      check(['approve','deny'].includes(b.action)&&Object.keys(b).every(k=>['action','transaction','csrf','grant_id'].includes(k)),400,'invalid_request');
      const t=state.transactions[b.transaction];check(t&&t.expires>at&&same(t.sessionHash,sessionHash)&&same(t.csrfHash,await oauthHash(String(b.csrf||''))),403,'consent_invalid');
      const params=parameters(t.params,env),redirect=new URL(params.redirect_uri);redirect.searchParams.set('state',params.state);redirect.searchParams.set('iss',OAUTH_ISSUER);
      if(b.action==='deny')redirect.searchParams.set('error','access_denied');
      else{
       const grant=mailGrant(data,b.grant_id,uid,at);check(Object.keys(state.codes).length<32&&Object.keys(state.tokens).length<32&&Object.keys(state.families).length<16,429,'connection_capacity');
       const code=random();state.codes[await oauthHash(code)]={params,grant_id:b.grant_id,grant_hash:grant.credentialHash,approvedAt:at,expires:at+60000,retainUntil:at+360000,used:false};redirect.searchParams.set('code',code);
      }
      delete state.transactions[b.transaction];result={redirect:redirect.href};
     }
    }else if(p.endsWith('/token')){
     check(['authorization_code','refresh_token'].includes(b.grant_type),400,'unsupported_grant_type');client(env,b.client_id);
     if(b.grant_type==='refresh_token'){
      check(Object.keys(b).every(k=>['grant_type','client_id','resource','refresh_token','scope'].includes(k)),400,'invalid_request');
      check(/^psr_[A-Za-z0-9_-]{43}$/.test(b.refresh_token||'')&&b.resource===resource&&(b.scope===undefined||scope(b.scope)),400,'invalid_grant');
      const r=state.refresh[await oauthHash(b.refresh_token)],f=r&&state.families[r.family];
      check(f&&!f.revoked&&f.expires>at&&f.client_id===b.client_id&&f.resource===resource,400,'invalid_grant');
      if(r.used){f.revoked=true;result={error:'invalid_grant'};status=400;}
      else{const minted=await mint(r.family);r.used=true;result=minted.result;}
     }else{
     check(Object.keys(b).every(k=>['grant_type','client_id','redirect_uri','resource','code','code_verifier'].includes(k)),400,'invalid_request');
     check(opaque.test(b.code||'')&&/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier||''),400,'invalid_grant');
     const c=state.codes[await oauthHash(b.code)];
     check(c&&c.params.client_id===b.client_id&&c.params.redirect_uri===b.redirect_uri&&c.params.resource===b.resource&&same(c.params.code_challenge,await challenge(b.code_verifier)),400,'invalid_grant');
     parameters(c.params,env);
     if(c.used){if(c.family&&state.families[c.family])state.families[c.family].revoked=true;result={error:'invalid_grant'};status=400;}
     else{
      check(c.expires>at,400,'invalid_grant');const g=mailGrant(data,c.grant_id,uid,at);check(same(g.credentialHash,c.grant_hash),400,'invalid_grant');
      check(Object.keys(state.families).length<16,429,'connection_capacity');
      const family=random();state.families[family]={client_id:b.client_id,resource,grant_id:c.grant_id,grant_hash:g.credentialHash,approvedAt:c.approvedAt,expires:Math.min(c.approvedAt+7*86400000,g.expiresAt),rotations:0,revoked:false};
      const minted=await mint(family);c.used=true;c.family=family;c.retainUntil=state.families[family].expires;result=minted.result;
     }
     }
    }else{
     check(Object.keys(b).every(k=>['client_id','token','token_type_hint'].includes(k))&&typeof b.token==='string'&&b.token.length<=256,400,'invalid_request');client(env,b.client_id);
     const digest=await oauthHash(b.token),t=state.tokens[digest]||state.refresh[digest],f=t&&state.families[t.family];if(!f||f.client_id!==b.client_id)return send({});f.revoked=true;result={};
    }
    if(consent)check(await ownerIdentity(request,env)===uid,403,'owner_required');
    if(await fbPut(env,path,data,snap.etag))return send(result,status);
   }
   check(false,409,'temporarily_unavailable');
  }catch(e){
   // Once the client/callback/state are trustworthy, protocol errors return to that
   // exact callback with issuer identification. Never redirect malformed/unknown clients.
   const url=new URL(request.url);
   if(oauthEnabled(env)&&url.origin===OAUTH_ORIGIN&&url.pathname==='/sled/oauth/authorize'&&request.method==='GET'){
    try{
     const p=unique(url.searchParams),c=client(env,p.client_id);
     if(c.redirect_uris.includes(p.redirect_uri)&&typeof p.state==='string'&&p.state.length>=16&&p.state.length<=512&&!/[\x00-\x20\x7f]/.test(p.state)){
      const target=new URL(p.redirect_uri);target.searchParams.set('state',p.state);target.searchParams.set('iss',OAUTH_ISSUER);
      target.searchParams.set('error',['invalid_scope','invalid_target','unsupported_response_type'].includes(e.message)?e.message:'invalid_request');
      return new Response(null,{status:303,headers:{...headers,Location:target.href}});
     }
    }catch{/* Invalid client parameters must stay local. */}
   }
   if(url.pathname==='/sled/oauth/token'&&e.message==='mail_grant_required')return send({error:'invalid_grant'},400);
   return send({error:e.status?e.message:'server_error'},e.status||503);
  }
 };
}
