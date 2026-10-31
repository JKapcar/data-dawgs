import test from 'node:test';
import assert from 'node:assert/strict';
import {createSledOAuth,oauthHash,oauthResource,resolveOAuthCredential,OAUTH_ISSUER,OAUTH_ORIGIN} from './sled-oauth.mjs';
import {createRoboKap} from './robokap.mjs';
import {createSledAgentGateway} from './sled-agent-gateway.mjs';
const uid='u_owner',id='a'.repeat(32),callback='https://chatgpt.com/connector_platform_oauth_redirect',verifier='V'.repeat(43);
const pkce=async s=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('base64url');
async function rig(){
 let at=1800000000000,version=0,hook=null;
 let db={owner_uid:uid,payload:JSON.stringify({tasks:[],contexts:[]}),untouched:{picks:'preserved'},agentAccess:{[id]:{enabled:true,audience:'sled:'+uid,seat:'dot',credentialHash:'b'.repeat(64),capabilities:['sled:work:read','sled:mail:ingest'],expiresAt:at+86400000,label:'Mail relay'}}};
 const env={RESEARCH_OWNER_UID:uid,SLED_OAUTH_CLIENTS:JSON.stringify([{client_id:'test-client',name:'Test ChatGPT',redirect_uris:[callback]}]),...Object.fromEntries(['SLED_OAUTH_ENABLED','SLED_AGENTS_ENABLED','DELEGATED_AGENTS_ENABLED','ROBOKAP_ENABLED','DAWG_POUND_ENABLED'].map(k=>[k,'true']))};
 const deps={now:()=>at,ownerIdentity:async r=>r.headers.get('Authorization')==='Bearer owner-session'?uid:null,fbGet:async()=>({data:structuredClone(db),etag:String(version)}),fbPut:async(e,p,d,v)=>{if(hook){const h=hook;hook=null;h(db);version++;}if(v!==String(version))return false;db=structuredClone(d);version++;return true;}};
 const handler=createSledOAuth(deps),gateway=createSledAgentGateway({robokap:createRoboKap(deps)});
 const params={client_id:'test-client',redirect_uri:callback,response_type:'code',scope:'sled:work:read sled:mail:ingest',resource:oauthResource(uid),state:'random-client-state-123456789',code_challenge:await pkce(verifier),code_challenge_method:'S256'};
 async function call(path,body,headers={},method=body?'POST':'GET'){
  const consent=path==='/sled/oauth/consent';const r=await handler(new Request(OAUTH_ORIGIN+path,{method,headers:{...(body?{'Content-Type':consent?'application/json':'application/x-www-form-urlencoded'}:{}),...(consent?{Origin:'https://datadawgs216.com',Authorization:'Bearer owner-session'}:{}),...headers},...(body?{body:consent?JSON.stringify(body):new URLSearchParams(body)}:{})}),env);
  return {status:r.status,headers:r.headers,body:await r.json().catch(()=>null)};
 }
 const inspect=p=>call('/sled/oauth/consent',{action:'inspect',params:p||params});
 async function consent(action='approve',p=params){const t=await inspect(p);assert.equal(t.status,200);const r=await call('/sled/oauth/consent',{action,transaction:t.body.transaction,csrf:t.body.csrf,grant_id:id});return {...r,transaction:t.body};}
 async function code(){const r=await consent();assert.equal(r.status,200);return new URL(r.body.redirect).searchParams.get('code');}
 const exchange=(code,over={})=>call('/sled/oauth/token',{grant_type:'authorization_code',client_id:params.client_id,redirect_uri:callback,resource:params.resource,code,code_verifier:verifier,...over});
 const rpc=(token,name='sled_read',args={})=>gateway(new Request(params.resource,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),env);
 return {env,params,call,inspect,consent,code,exchange,rpc,db:()=>db,tick:n=>{at+=n;},mutate:f=>{f(db);version++;},race:f=>{hook=f;},credential:async token=>({oauthHash:await oauthHash(token)}),resolve:async token=>resolveOAuthCredential(db,uid,{oauthHash:await oauthHash(token)},env,at)};
}
test('discovery is gated, pinned to canonical issuer/resource, S256 and public code flow only',async()=>{
 const w=await rig();let r=await w.call('/.well-known/oauth-authorization-server/sled/oauth');assert.equal(r.body.issuer,OAUTH_ISSUER);assert.deepEqual(r.body.code_challenge_methods_supported,['S256']);assert.deepEqual(r.body.grant_types_supported,['authorization_code','refresh_token']);assert.equal(r.body.registration_endpoint,undefined);
 r=await w.call('/.well-known/oauth-protected-resource');assert.equal(r.body.resource,w.params.resource);assert.deepEqual(r.body.bearer_methods_supported,['header']);
 const unauth=await w.rpc();assert.equal(unauth.status,401);assert.match(unauth.headers.get('WWW-Authenticate'),/resource_metadata=/);
 for(const flag of ['SLED_OAUTH_ENABLED','SLED_AGENTS_ENABLED','DELEGATED_AGENTS_ENABLED','ROBOKAP_ENABLED','DAWG_POUND_ENABLED']){w.env[flag]='false';assert.equal((await w.call('/.well-known/oauth-protected-resource')).status,503);w.env[flag]='true';}
});
test('authorization rejects unknown client, redirect variants, target/scope escalation, non-S256 and duplicates',async()=>{
 const w=await rig();for(const change of [{client_id:'unknown-client'},{redirect_uri:callback+'/'},{redirect_uri:callback+'?next=evil'},{redirect_uri:'https://chatgpt.com.evil.test/connector_platform_oauth_redirect'},{resource:w.params.resource+'/'},{scope:'sled:work:read sled:coordinate'},{code_challenge_method:'plain'},{code_challenge:'short'},{state:''},{response_type:'token'},{unexpected:'x'}])assert.notEqual((await w.inspect({...w.params,...change})).status,200);
 const query=new URLSearchParams(w.params);query.append('client_id','test-client');assert.equal((await w.call('/sled/oauth/authorize?'+query)).status,400);
 const r=await w.call('/sled/oauth/authorize?'+new URLSearchParams(w.params));assert.equal(r.status,303);assert.match(r.headers.get('Location'),/^https:\/\/datadawgs216.com\/research-lab\/sled-connect.html#/);assert.equal(w.db().sledOAuth,undefined);
 const denied=await w.call('/sled/oauth/authorize?'+new URLSearchParams({...w.params,scope:'sled:coordinate'})),target=new URL(denied.headers.get('Location'));assert.equal(denied.status,303);assert.equal(target.origin,'https://chatgpt.com');assert.equal(target.searchParams.get('error'),'invalid_scope');assert.equal(target.searchParams.get('iss'),OAUTH_ISSUER);
 assert.equal((await w.call('/sled/oauth/authorize?'+new URLSearchParams({...w.params,redirect_uri:'https://evil.test'}))).headers.get('Location'),null);
});
test('consent is explicit, origin/session/CSRF bound, single use and expiring; deny returns state and issuer',async()=>{
 const w=await rig(),t=(await w.inspect()).body,b={action:'approve',transaction:t.transaction,csrf:t.csrf,grant_id:id};
 assert.equal((await w.call('/sled/oauth/consent',b,{Origin:'https://evil.test'})).status,403);
 assert.equal((await w.call('/sled/oauth/consent',b,{Authorization:'Bearer other-session'})).status,403);
 assert.equal((await w.call('/sled/oauth/consent',{...b,csrf:'incorrect'})).status,403);
 assert.equal((await w.call('/sled/oauth/consent',{...b,action:'deny'})).status,200);
 assert.equal((await w.call('/sled/oauth/consent',b)).status,403);
 const denied=await w.consent('deny'),u=new URL(denied.body.redirect);assert.equal(u.searchParams.get('error'),'access_denied');assert.equal(u.searchParams.get('state'),w.params.state);assert.equal(u.searchParams.get('iss'),OAUTH_ISSUER);
 const expired=(await w.inspect()).body;w.tick(600000);assert.equal((await w.call('/sled/oauth/consent',{...b,transaction:expired.transaction,csrf:expired.csrf})).status,403);
});
test('only existing dot mail-only grant qualifies; no issue, widening or owner authority',async()=>{
 for(const mutate of [g=>g.enabled=false,g=>g.seat='coordinator',g=>g.capabilities.push('sled:coordinate'),g=>g.audience='pound',g=>g.expiresAt=0]){const w=await rig();w.mutate(d=>mutate(d.agentAccess[id]));const r=await w.consent();assert.equal(r.status,403);assert.equal(Object.keys(w.db().agentAccess).length,1);}
});
test('code is single-use, one minute, bound to verifier/client/redirect/resource; replay revokes token',async()=>{
 const w=await rig(),code=await w.code();
 for(const over of [{code_verifier:'W'.repeat(43)},{client_id:'different-client'},{redirect_uri:callback+'/'},{resource:w.params.resource+'/other'}])assert.equal((await w.exchange(code,over)).status,400);
 const r=await w.exchange(code);assert.equal(r.status,200);assert.equal(r.body.expires_in,300);assert.match(r.body.refresh_token,/^psr_/);assert.equal(r.body.token_type,'Bearer');
 assert.equal((await w.resolve(r.body.access_token)).id,id);
 const stored=JSON.stringify(w.db());assert.ok(!stored.includes(r.body.access_token));assert.ok(!stored.includes(code));assert.ok(!stored.includes('owner-session'));assert.deepEqual(w.db().untouched,{picks:'preserved'});
 assert.equal((await w.exchange(code)).status,400);await assert.rejects(w.resolve(r.body.access_token),/invalid_token/);
 const expired=await w.code();w.tick(60000);assert.equal((await w.exchange(expired)).status,400);
});
test('concurrent code redemption yields at most one token and replay disables it',async()=>{
 const w=await rig(),code=await w.code(),results=await Promise.all([w.exchange(code),w.exchange(code)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);await assert.rejects(w.resolve(results.find(r=>r.status===200).body.access_token),/invalid_token/);
});
test('access expiry, configured client removal, grant revocation/rotation/widening all fail closed',async()=>{
 for(const change of [w=>w.tick(300000),w=>w.env.SLED_OAUTH_CLIENTS='[]',w=>w.mutate(d=>d.agentAccess[id].enabled=false),w=>w.mutate(d=>d.agentAccess[id].credentialHash='c'.repeat(64)),w=>w.mutate(d=>d.agentAccess[id].capabilities.push('sled:coordinate'))]){const w=await rig(),r=await w.exchange(await w.code());change(w);await assert.rejects(w.resolve(r.body.access_token));}
 const w=await rig(),r=await w.exchange(await w.code());assert.equal((await w.call('/sled/oauth/revoke',{client_id:'test-client',token:r.body.access_token})).status,200);await assert.rejects(w.resolve(r.body.access_token));assert.equal((await w.call('/sled/oauth/revoke',{client_id:'test-client',token:'unknown'})).status,200);
});
test('CAS preserves concurrent changes and refuses grants revoked during approval',async()=>{
 const w=await rig(),t=(await w.inspect()).body;w.race(d=>{d.agentAccess[id].enabled=false;d.untouched.picks='new';});
 const r=await w.call('/sled/oauth/consent',{action:'approve',transaction:t.transaction,csrf:t.csrf,grant_id:id});assert.equal(r.status,403);assert.equal(w.db().untouched.picks,'new');assert.equal(Object.keys(w.db().sledOAuth.codes).length,0);
});
test('OAuth token reaches only route-scoped mail tools; planning, dispatch, messages, owner tools refused',async()=>{
 const w=await rig(),r=await w.exchange(await w.code()),token=r.body.access_token;
 let response=await w.rpc(token);assert.equal(response.status,200);const data=(await response.json()).result.structuredContent;assert.ok(data.mail);assert.equal(data.team,undefined);assert.equal(data.lab,undefined);
 for(const op of ['rk.plan','rk.dispatch','rk.message']){response=await w.rpc(token,'sled_write',{op,request_id:'request_1234567890',data:{}});const result=(await response.json()).result;assert.equal(result.isError,true);assert.equal(result.structuredContent.status,403);}
 response=await w.rpc(token,'dd_owner_robokap_read');assert.equal(response.status,403);
 response=await w.rpc(token,'sled_read',{view:'team'});assert.equal((await response.json()).result.isError,true);
});
test('token endpoint refuses browser origin, query credentials, unknown grants and oversized bodies',async()=>{
 const w=await rig();assert.equal((await w.call('/sled/oauth/token',{grant_type:'refresh_token'})).status,400);
 assert.equal((await w.call('/sled/oauth/token',{grant_type:'authorization_code'},{Origin:'https://evil.test'})).status,403);
 assert.equal((await w.call('/sled/oauth/token?access_token=redacted',{grant_type:'authorization_code'})).status,400);
 assert.equal((await w.call('/sled/oauth/token',{code:'x'.repeat(9000)})).status,413);
});
test('refresh rotates once; replay revokes the entire family, including the replacement',async()=>{
 const w=await rig(),first=(await w.exchange(await w.code())).body;
 const refresh=(token,over={})=>w.call('/sled/oauth/token',{grant_type:'refresh_token',client_id:'test-client',resource:w.params.resource,refresh_token:token,...over});
 assert.equal((await refresh(first.refresh_token,{resource:w.params.resource+'/other'})).status,400);
 assert.equal((await refresh(first.refresh_token,{scope:'sled:coordinate'})).status,400);
 assert.equal((await refresh(first.refresh_token,{client_id:'wrong-client'})).status,400);
 w.tick(300001);await assert.rejects(w.resolve(first.access_token));
 const second=await refresh(first.refresh_token);assert.equal(second.status,200);assert.notEqual(second.body.refresh_token,first.refresh_token);assert.equal((await w.resolve(second.body.access_token)).id,id);
 assert.equal((await refresh(first.refresh_token)).status,400);await assert.rejects(w.resolve(second.body.access_token));assert.equal((await refresh(second.body.refresh_token)).status,400);
 const stored=JSON.stringify(w.db());for(const secret of [first.refresh_token,second.body.refresh_token,second.body.access_token])assert.ok(!stored.includes(secret));
});
test('refresh races fail closed, grant expiry and explicit revocation stop refresh',async()=>{
 for(const mode of ['race','expire','revoke','grant']){
  const w=await rig(),first=(await w.exchange(await w.code())).body;
  const refresh=()=>w.call('/sled/oauth/token',{grant_type:'refresh_token',client_id:'test-client',resource:w.params.resource,refresh_token:first.refresh_token});
  if(mode==='race'){const results=await Promise.all([refresh(),refresh()]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);await assert.rejects(w.resolve(results.find(r=>r.status===200).body.access_token));}
  else{if(mode==='expire')w.tick(86400000);if(mode==='revoke')await w.call('/sled/oauth/revoke',{client_id:'test-client',token:first.refresh_token});if(mode==='grant')w.mutate(d=>d.agentAccess[id].enabled=false);assert.notEqual((await refresh()).status,200);}
 }
});
