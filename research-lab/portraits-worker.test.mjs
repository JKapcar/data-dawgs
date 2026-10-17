import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {buildWorker} from './build-worker.mjs';import {fixture} from './gateway-fixture.mjs';import {png} from './portrait-fixture.mjs';
const require=createRequire(path.join(process.env.DD_NODE_MODULES,'resolver.cjs')),{Miniflare}=require('miniflare');
test('packaged signed-owner route stores verified PNG in real R2; no private bytes in workspace',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'dd-portraits-'));let mf;
 try{buildWorker(directory);const f=await fixture(),id='p_00000000-0000-4000-8000-000000000001',rows=new Map(),versions=new Map();
  rows.set('/users/u_owner',{name:'Owner',passwordSetAt:0});rows.set('/privatePounds/u_owner',{owner_uid:'u_owner',payload:JSON.stringify({revision:0,contexts:[{id,archived:false,versions:[{version:1,text:'Synthetic original'}]}],agents:[],tasks:[],messages:[],activity:[],receipts:[]})});
  mf=new Miniflare({modules:true,modulesRoot:directory,scriptPath:path.join(directory,'worker.mjs'),compatibilityDate:'2026-07-31',r2Buckets:['RESEARCH_UPLOADS'],bindings:{POUND_PORTRAITS_ENABLED:'true',DAWG_POUND_ENABLED:'true',BOZO_PEPPER:f.env.BOZO_PEPPER,FB_SECRET:'synthetic-only'},outboundService:async request=>{const p=new URL(request.url).pathname.replace(/\.json$/,'');assert(['/users/u_owner','/privatePounds/u_owner'].includes(p));const v=versions.get(p)||0;if(request.method==='PUT'){if(request.headers.get('if-match')!==String(v))return new Response('',{status:412});rows.set(p,await request.json());versions.set(p,v+1);}return Response.json(rows.get(p)||null,{headers:{ETag:String(versions.get(p)||0)}});}});
  const url='https://worker.invalid/pound-portraits/v1/contexts/'+id,headers={Authorization:'Bearer '+f.session,'Content-Type':'application/json'};
  assert.equal((await mf.dispatchFetch(url)).status,401);
  const input={expected_revision:0,request_id:'synthetic_portrait_0001',alt:'Synthetic square',png_base64:png().toString('base64')};
  const uploaded=await mf.dispatchFetch(url,{method:'POST',headers,body:JSON.stringify(input)});assert.equal(uploaded.status,201,await uploaded.clone().text());
  const image=await mf.dispatchFetch(url+'/image/'+input.request_id,{headers});assert.equal(image.status,200);assert.deepEqual(Buffer.from(await image.arrayBuffer()),png());
  const replay=await mf.dispatchFetch(url,{method:'POST',headers,body:JSON.stringify(input)});assert.equal((await replay.json()).replayed,true);
  const bucket=await mf.getR2Bucket('RESEARCH_UPLOADS');assert.equal((await bucket.list()).objects.length,1);
  const saved=JSON.parse(rows.get('/privatePounds/u_owner').payload);assert.equal(saved.contexts[0].versions.length,1);assert.equal(saved.contexts[0].versions[0].text,'Synthetic original');assert(!rows.get('/privatePounds/u_owner').payload.includes(input.png_base64));
  const view=await(await mf.dispatchFetch('https://worker.invalid/api/pound',{headers})).json();assert(!Object.hasOwn(view.workspace,'portraitUploads'));
 }finally{await mf?.dispose();rmSync(directory,{recursive:true,force:true});}
});
