// Packaged Workerd with a synthetic owner and in-memory conditional database. No live traffic.
import test from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHmac,createHash} from 'node:crypto';
import {buildWorker} from './build-worker.mjs';import {OAUTH_ORIGIN,oauthResource} from './sled-oauth.mjs';
const require=createRequire(path.join(process.env.DD_NODE_MODULES,'resolver.cjs')),{Miniflare}=require('miniflare');
test('packaged OAuth owner consent, code exchange, MCP read, refresh and revocation',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'dd-sled-oauth-'));buildWorker(directory);
 const uid='u_owner',id='a'.repeat(32),pepper='synthetic-pepper',callback='https://chatgpt.com/connector_platform_oauth_redirect',verifier='V'.repeat(43);
 const payload=Buffer.from(JSON.stringify({u:uid,n:'Synthetic Owner',i:Date.now(),e:Date.now()+86400000,p:0})).toString('base64url'),session=payload+'.'+createHmac('sha256',pepper).update(payload).digest('base64url');
 const db=new Map([['/users/'+uid,{name:'Synthetic Owner',passwordSetAt:0}],['/privatePounds/'+uid,{owner_uid:uid,payload:JSON.stringify({tasks:[],contexts:[]}),agentAccess:{[id]:{enabled:true,audience:'sled:'+uid,seat:'dot',credentialHash:'b'.repeat(64),expiresAt:Date.now()+86400000,capabilities:['sled:work:read','sled:mail:ingest']}}}]]);let version=0;
 const mf=new Miniflare({modules:true,modulesRoot:directory,scriptPath:path.join(directory,'worker.mjs'),compatibilityDate:'2026-07-30',r2Buckets:['RESEARCH_UPLOADS'],bindings:{BOZO_PEPPER:pepper,FB_SECRET:'synthetic',RESEARCH_OWNER_UID:uid,SLED_OAUTH_CLIENTS:JSON.stringify([{client_id:'test-client',name:'Synthetic ChatGPT',redirect_uris:[callback]}]),...Object.fromEntries(['SLED_OAUTH_ENABLED','SLED_AGENTS_ENABLED','DELEGATED_AGENTS_ENABLED','ROBOKAP_ENABLED','DAWG_POUND_ENABLED'].map(k=>[k,'true']))},outboundService:async r=>{
  const key=new URL(r.url).pathname.replace(/\.json$/,'');assert.ok(db.has(key),'unexpected outbound path '+key);
  if(r.method==='PUT'){assert.equal(key,'/privatePounds/'+uid);if(r.headers.get('if-match')!=='"'+version+'"')return new Response('',{status:412});db.set(key,await r.json());version++;}
  else assert.equal(r.method,'GET');return Response.json(db.get(key),{headers:{ETag:'"'+version+'"'}});
 }});
 const call=async(p,b)=>{const consent=p.endsWith('/consent');const r=await mf.dispatchFetch(OAUTH_ORIGIN+p,{method:b?'POST':'GET',headers:b?{'Content-Type':consent?'application/json':'application/x-www-form-urlencoded',...(consent?{Origin:'https://datadawgs216.com',Authorization:'Bearer '+session}:{})}:{},...(b?{body:consent?JSON.stringify(b):new URLSearchParams(b).toString()}:{})});return {status:r.status,body:await r.json()};};
 try{
  assert.equal((await call('/.well-known/oauth-protected-resource')).status,200);
  const params={client_id:'test-client',redirect_uri:callback,response_type:'code',scope:'sled:work:read sled:mail:ingest',resource:oauthResource(uid),state:'synthetic-state-123456789',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'};
  const inspected=await call('/sled/oauth/consent',{action:'inspect',params});assert.equal(inspected.status,200,JSON.stringify(inspected));
  const approved=await call('/sled/oauth/consent',{action:'approve',transaction:inspected.body.transaction,csrf:inspected.body.csrf,grant_id:id});assert.equal(approved.status,200);
  const exchanged=await call('/sled/oauth/token',{grant_type:'authorization_code',client_id:'test-client',redirect_uri:callback,resource:params.resource,code:new URL(approved.body.redirect).searchParams.get('code'),code_verifier:verifier});assert.equal(exchanged.status,200);
  const rpc=async token=>{const r=await mf.dispatchFetch(params.resource,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'sled_read',arguments:{}}})});return {status:r.status,body:await r.json()};};
  const read=await rpc(exchanged.body.access_token);assert.equal(read.status,200);assert.equal(read.body.result.isError,false);assert.ok(read.body.result.structuredContent.mail);
  const refreshed=await call('/sled/oauth/token',{grant_type:'refresh_token',client_id:'test-client',resource:params.resource,refresh_token:exchanged.body.refresh_token});assert.equal(refreshed.status,200);
  assert.equal((await call('/sled/oauth/revoke',{client_id:'test-client',token:refreshed.body.refresh_token})).status,200);assert.equal((await rpc(refreshed.body.access_token)).status,401);
 }finally{await mf.dispose();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(directory,{recursive:true,force:true});}
});
