import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {buildWorker} from './build-worker.mjs';import {fixture} from './gateway-fixture.mjs';import {PART_BYTES} from './upload-gateway.mjs';
const require=createRequire(path.join(process.env.DD_NODE_MODULES,'resolver.cjs')),{Miniflare}=require('miniflare');
test('actual Worker identity and R2 binding support multipart, recovery and repeated cancellation',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'dd-upload-'));let mf;
 try{
  buildWorker(directory);const f=await fixture(),rows=new Map(),versions=new Map();
  rows.set('/users/u_owner',{name:'Owner',passwordSetAt:0});
  rows.set('/researchLab/v1/tenants/jason-bdb',{access:{users:{u_owner:{enabled:true,owner:true,capabilities:['research:read']}}}});
  mf=new Miniflare({modules:true,modulesRoot:directory,scriptPath:path.join(directory,'worker.mjs'),compatibilityDate:'2026-07-30',r2Buckets:['RESEARCH_UPLOADS'],bindings:{RESEARCH_UPLOAD_ENABLED:'true',RESEARCH_OWNER_UID:'u_owner',BOZO_PEPPER:f.env.BOZO_PEPPER,FB_SECRET:'fake-test-only'},outboundService:async request=>{
   const p=new URL(request.url).pathname.replace(/\.json$/,'');assert(['/users/u_owner','/researchLab/v1/tenants/jason-bdb','/researchUploads/v1/u_owner'].includes(p));const version=versions.get(p)||0;
   if(request.method==='PUT'){if(request.headers.get('if-match')!==String(version))return new Response('',{status:412});rows.set(p,await request.json());versions.set(p,version+1);return Response.json(rows.get(p));}
   return Response.json(rows.get(p)||null,{headers:{ETag:String(version)}});
  }});
  const call=(route,body,extra={})=>mf.dispatchFetch('https://worker.invalid/research-upload/v1/'+route,{method:route==='status'?'GET':route==='part'?'PUT':'POST',headers:{Authorization:'Bearer '+f.session,'X-Upload-ID':JSON.parse(rows.get('/researchUploads/v1/u_owner')?.payload||'null')?.id||'',...extra},...(body?{body}:{})});
  assert.equal((await call('status')).status,200);
  const a=new Uint8Array(PART_BYTES),b=new Uint8Array(22);a.set([80,75,3,4]);
  const hashes=await Promise.all([a,b].map(async v=>Buffer.from(await crypto.subtle.digest('SHA-256',v)).toString('hex')));
  const manifest=JSON.stringify({name:'synthetic.zip',size:a.length+b.length,hashes});
  assert.equal((await call('create',manifest)).status,201);
  for(const [index,part] of [a,b].entries())assert.equal((await call('part',part,{'X-Upload-Part':String(index+1)})).status,200);
  const completed=await call('complete');assert.equal(completed.status,200,await completed.text());
  assert.equal((await call('abort')).status,200);
  assert.equal((await call('create',manifest)).status,201);
  assert.equal((await call('abort')).status,200);
  const bucket=await mf.getR2Bucket('RESEARCH_UPLOADS');assert.equal((await bucket.list()).objects.length,0);
 }finally{await mf?.dispose();rmSync(directory,{recursive:true,force:true});}
});
