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

test('promotion is a verified, idempotent copy into durable private storage that never touches the quarantine original',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'dd-promote-'));let mf;
 try{
  buildWorker(directory);const f=await fixture(),rows=new Map(),versions=new Map();
  rows.set('/users/u_owner',{name:'Owner',passwordSetAt:0});
  rows.set('/researchLab/v1/tenants/jason-bdb',{access:{users:{u_owner:{enabled:true,owner:true,capabilities:['research:read']}}}});
  mf=new Miniflare({modules:true,modulesRoot:directory,scriptPath:path.join(directory,'worker.mjs'),compatibilityDate:'2026-07-30',r2Buckets:['RESEARCH_UPLOADS'],bindings:{RESEARCH_UPLOAD_ENABLED:'true',RESEARCH_OWNER_UID:'u_owner',BOZO_PEPPER:f.env.BOZO_PEPPER,FB_SECRET:'fake-test-only'},outboundService:async request=>{
   const p=new URL(request.url).pathname.replace(/\.json$/,'');const version=versions.get(p)||0;
   if(request.method==='PUT'){if(request.headers.get('if-match')!==String(version))return new Response('',{status:412});rows.set(p,await request.json());versions.set(p,version+1);return Response.json(rows.get(p));}
   return Response.json(rows.get(p)||null,{headers:{ETag:String(version)}});
  }});
  const record=()=>JSON.parse(rows.get('/researchUploads/v1/u_owner')?.payload||'null');
  const call=(route,body,extra={})=>mf.dispatchFetch('https://worker.invalid/research-upload/v1/'+route,{method:route==='status'||route==='download'?'GET':route==='part'?'PUT':'POST',headers:{Authorization:'Bearer '+f.session,'X-Upload-ID':record()?.id||'',...extra},...(body?{body}:{})});
  const promote=async sha256=>{const r=await call('promote',JSON.stringify({sha256}),{'Content-Type':'application/json'});return {status:r.status,body:await r.json()};};
  const a=new Uint8Array(PART_BYTES).map((_,i)=>i%251),b=new Uint8Array(4096).map((_,i)=>i%13);a.set([80,75,3,4]);
  const hex=async v=>Buffer.from(await crypto.subtle.digest('SHA-256',v)).toString('hex'),whole=new Uint8Array(a.length+b.length);whole.set(a);whole.set(b,a.length);
  const sha=await hex(whole),other='0'.repeat(64);
  assert.equal((await call('create',JSON.stringify({name:'synthetic.zip',size:whole.length,hashes:[await hex(a),await hex(b)]}))).status,201);
  assert.equal((await promote(sha)).body.error,'upload_incomplete');
  for(const [index,part] of [a,b].entries())assert.equal((await call('part',part,{'X-Upload-Part':String(index+1)})).status,200);
  assert.equal((await call('complete')).status,200);
  const bucket=await mf.getR2Bucket('RESEARCH_UPLOADS'),quarantine=record().key,keys=async()=>(await bucket.list()).objects.map(o=>o.key).sort();
  const original=await (await bucket.get(quarantine)).arrayBuffer();
  for(const bad of ['', 'XYZ', sha.toUpperCase(), sha+'0'])assert.equal((await promote(bad)).status,400);
  assert.equal((await call('promote',JSON.stringify({sha256:sha,extra:1}),{'Content-Type':'application/json'})).status,400);
  // Wrong checksum: R2 refuses the write, nothing is marked durable, the original is untouched.
  const wrong=await promote(other);assert.equal(wrong.status,422,JSON.stringify(wrong.body));assert.equal(wrong.body.error,'checksum_mismatch');
  assert.deepEqual(await keys(),[quarantine]);assert.equal(record().durable,undefined);
  // An unexpected object already at a content-addressed key is never trusted or overwritten.
  const squat='a'.repeat(64);await bucket.put('datasets/u_owner/'+squat+'.zip',new Uint8Array(5));
  assert.equal((await promote(squat)).body.error,'destination_conflict');await bucket.delete('datasets/u_owner/'+squat+'.zip');
  // Success: verified copy, record marked durable, original still in quarantine byte-for-byte.
  const ok=await promote(sha);assert.equal(ok.status,200,JSON.stringify(ok.body));const dest='datasets/u_owner/'+sha+'.zip';
  assert.deepEqual(ok.body.durable&&{key:ok.body.durable.key,sha256:ok.body.durable.sha256,size:ok.body.durable.size},{key:dest,sha256:sha,size:whole.length});
  assert.deepEqual(await keys(),[dest,quarantine].sort());assert.deepEqual(new Uint8Array(await (await bucket.get(quarantine)).arrayBuffer()),new Uint8Array(original));
  const stored=await bucket.head(dest);assert.equal(Buffer.from(stored.checksums.sha256).toString('hex'),sha);
  // Retries are safe: same answer, no second object; a different checksum is refused.
  const again=await promote(sha);assert.equal(again.status,200);assert.equal(again.body.durable.promotedAt,ok.body.durable.promotedAt);assert.deepEqual(await keys(),[dest,quarantine].sort());
  assert.equal((await promote(other)).body.error,'durable_copy_has_other_checksum');
  // A lost metadata write after a successful copy: the retry reuses the verified destination.
  const rec=record();delete rec.durable;rows.set('/researchUploads/v1/u_owner',{version:1,owner_uid:'u_owner',payload:JSON.stringify(rec)});versions.set('/researchUploads/v1/u_owner',(versions.get('/researchUploads/v1/u_owner')||0)+1);
  assert.equal((await promote(sha)).status,200);assert.equal(record().durable.key,dest);assert.deepEqual(await keys(),[dest,quarantine].sort());
  // Downloads read the durable copy; delete is refused while a durable copy exists.
  const dl=await call('download');assert.equal(dl.status,200);assert.deepEqual(new Uint8Array(await dl.arrayBuffer()),whole);
  await bucket.delete(quarantine);assert.equal((await call('download')).status,200);
  assert.equal((await call('abort')).status,409);assert.deepEqual(await keys(),[dest]);
  // Only the signed owner session can promote; personal MCP tokens and shared passwords cannot.
  for(const auth of ['Bearer u_not-a-session','Bearer shared'])assert.equal((await mf.dispatchFetch('https://worker.invalid/research-upload/v1/promote',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({sha256:sha})})).status,403);
 }finally{await mf?.dispose();rmSync(directory,{recursive:true,force:true});}
});
