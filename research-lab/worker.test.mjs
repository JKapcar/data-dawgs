import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHmac,createHash} from 'node:crypto';
import {buildWorker} from './build-worker.mjs';import {initialState,capabilities,hash} from './machine.mjs';import {syntheticTracking} from './tracking.mjs';
import {encodeEnvelope,decodeEnvelope} from './exact-store.mjs';
const require=createRequire(process.env.DD_NODE_MODULES?path.join(process.env.DD_NODE_MODULES,'resolver.cjs'):import.meta.url);
const {Miniflare}=require('miniflare');
test('packaged delegated routes are closed by default and use isolated scoped identity',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'dd-agent-worker-'));let mf;
 try{
  buildWorker(directory);const id='a'.repeat(32),token='da1_'+id+'_'+'x'.repeat(43),credentialHash=createHash('sha256').update(token).digest('hex');
  const shared={enabled:true,expiresAt:Date.now()+600000,credentialHash};let reads=0;
  const options={modules:true,modulesRoot:directory,scriptPath:path.join(directory,'worker.mjs'),compatibilityDate:'2026-07-30',bindings:{DAWG_POUND_ENABLED:'true',RESEARCH_LAB_ENABLED:'true',FB_SECRET:'fake'},outboundService:async r=>{
   reads++;const p=new URL(r.url).pathname;assert.equal(r.method,'GET');assert.equal(p,'/privatePounds/u_test.json');
   return Response.json({owner_uid:'u_test',agentAccess:{[id]:{...shared,audience:'pound:u_test',capabilities:['pound:task:read'],rosterId:'p_'+'a'.repeat(36),rosterIds:[],taskIds:[],contextVersions:{}}},payload:'{}'},{headers:{ETag:'"1"'}});
  }};
  mf=new Miniflare(options);const url='https://test/agents/v1/owners/u_test/mcp',request={method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})};
  assert.equal((await mf.dispatchFetch('https://test/agent-setup/v1')).status,503);
  assert.equal((await mf.dispatchFetch(url,request)).status,503);assert.equal(reads,0);
  await mf.setOptions({...options,bindings:{...options.bindings,DELEGATED_AGENTS_ENABLED:'true'}});
  const r=await mf.dispatchFetch(url,request);assert.equal(r.status,200);assert.deepEqual((await r.json()).result.tools.map(t=>t.name),['pound_tasks']);assert.equal(reads,1);
  assert.equal((await mf.dispatchFetch('https://test/api/pound',{headers:request.headers})).status,401);
  await mf.setOptions({...options,bindings:{...options.bindings,AGENT_SETUP_ENABLED:'true',RESEARCH_OWNER_UID:'u_test',RESEARCH_UPLOAD_TENANT:'test'}});
  assert.equal((await mf.dispatchFetch('https://test/agent-setup/v1',{headers:request.headers})).status,401);
  assert.equal(reads,1,'agent credentials cannot reach owner setup storage');
 }finally{await mf?.dispose();rmSync(directory,{recursive:true,force:true});}
});
test('generated production-source Worker loads without Node compatibility and runs a real synthetic audit',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'dd-worker-'));let mf;
 try{
  const build=buildWorker(directory),store='/researchLab/v1/tenants/demo',pepper='test-only-pepper',token='u_test-worker',uid='u_test';let version=1;
  let envelope={version:1,access:{agents:{[uid]:{enabled:true,expiresAt:Date.now()+600000,capabilities:['research:read',...capabilities]}}},state:initialState(),inputs:{}};
  let writes=0;
  const options={modules:true,modulesRoot:directory,scriptPath:path.join(directory,'worker.mjs'),compatibilityDate:'2026-07-30',outboundService:async request=>{
   const p=new URL(request.url).pathname.replace(/\.json$/,'');
   if(p==='/users')return Response.json({[uid]:{name:'Synthetic test agent',mcpToken:createHmac('sha256',pepper).update('mcp|'+token).digest('base64url')}});
   assert.equal(p,store,'no production/network endpoint is allowed');
   if(request.method==='PUT'){assert.equal(request.headers.get('if-match'),`"${version}"`);envelope=await request.json();version++;writes++;return Response.json(envelope);}
   assert.equal(request.method,'GET');return Response.json(envelope.payload?envelope:encodeEnvelope(envelope),{headers:{ETag:`"${version}"`}});
  }};
  mf=new Miniflare({...options,bindings:{}});
  assert.equal((await mf.dispatchFetch('https://worker.invalid/research/v1/tenants/demo/state')).status,503);assert.equal(writes,0);
  await mf.setOptions({...options,bindings:{RESEARCH_LAB_ENABLED:'true',BOZO_PEPPER:pepper,FB_SECRET:'fake-test-secret',BOZO_TOKENS:'{"never-seed":"Unexpected"}'}});
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};let key=0;
  const command=async(type,payload)=>{const r=await mf.dispatchFetch('https://worker.invalid/research/v1/tenants/demo/command',{method:'POST',headers,body:JSON.stringify({type,payload,key:String(++key)})});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;};
  const h=await command('hypothesis',{title:'Worker runtime audit',method:'Descriptive synthetic only'}),t=await command('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000}),c=await command('claim',{taskId:t.id,leaseMs:60000}),r=await command('run',{taskId:t.id,leaseToken:c.lease.token,tracking:syntheticTracking()});
  assert.equal(r.outcome,'success');assert.equal(r.hashes.code,build.codeHash);assert.equal(r.hashes.data,hash(syntheticTracking()));const {receiptHash,...receipt}=r;assert.equal(receiptHash,hash(receipt));assert.equal(decodeEnvelope(envelope).state.receipts.length,1);
  const state=await(await mf.dispatchFetch('https://worker.invalid/research/v1/tenants/demo/state',{headers})).json();assert.equal(state.receipts[0].id,r.id);assert.equal(state.inputs,undefined);
  assert.equal(readFileSync(path.join(directory,'dashboard/client-config.mjs'),'utf8').includes("sharedEnabled:false"),true);
 }finally{await mf?.dispose();rmSync(directory,{recursive:true,force:true});}
});
