import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHmac} from 'node:crypto';
import {buildWorker} from './build-worker.mjs';import {initialState,capabilities,hash} from './machine.mjs';import {syntheticTracking} from './tracking.mjs';
import {encodeEnvelope,decodeEnvelope} from './exact-store.mjs';
const require=createRequire(process.env.DD_NODE_MODULES?path.join(process.env.DD_NODE_MODULES,'resolver.cjs'):import.meta.url);
const {Miniflare}=require('miniflare');
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
