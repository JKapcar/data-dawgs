import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash,createHmac} from 'node:crypto';import {buildWorker} from '../research-lab/build-worker.mjs';
const require=createRequire(path.join(process.env.DD_NODE_MODULES,'resolver.cjs')),{Miniflare}=require('miniflare');
const sha=b=>createHash('sha256').update(b).digest('hex');
test('packaged Worker and real R2: max-sized byte roundtrip, concurrent/replayed commit and revoked owner',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'dd-owner-vault-'));let mf;
 try{
  buildWorker(directory);let row=null,revision=0,pv=1;const payload=Buffer.from(JSON.stringify({u:'u_owner',n:'Owner',i:Date.now(),e:Date.now()+600000,p:1})).toString('base64url'),token=payload+'.'+createHmac('sha256','fixture-pepper').update(payload).digest('base64url');
  mf=new Miniflare({modules:true,modulesRoot:directory,scriptPath:path.join(directory,'worker.mjs'),compatibilityDate:'2026-07-31',r2Buckets:['VAULT_BUCKET'],bindings:{VAULT_ENABLED:'true',VAULT_SHARING_ENABLED:'false',VAULT_OWNER_UID:'u_owner',BOZO_PEPPER:'fixture-pepper',FB_SECRET:'fixture'},outboundService:async request=>{
   const p=new URL(request.url).pathname.replace(/\.json$/,'');assert.ok(['/users/u_owner','/ownerVaults/u_owner'].includes(p));if(p==='/users/u_owner')return Response.json({name:'Owner',passwordSetAt:pv});
   if(request.method==='PUT'){const incoming=await request.json();if(request.headers.get('if-match')!==String(revision))return new Response('',{status:412});row=incoming;revision++;return Response.json(row);}return Response.json(row,{headers:{ETag:String(revision)}});
  }});
  const call=async(op,args={},auth=token)=>{const r=await mf.dispatchFetch('https://worker.invalid/api/vault',{method:'POST',headers:{Authorization:'Bearer '+auth},body:JSON.stringify({op,args})});return {status:r.status,body:await r.json()};};
  assert.equal((await call('status')).status,200);assert.equal((await call('status',{},'u_mcp_token')).status,401);
  const b=Buffer.alloc(8*1024*1024);for(let i=0;i<b.length;i++)b[i]=i%251;
  const metadata={name:'synthetic-8m.bin',sha256:sha(b),size:b.length,file_id:null,expected_version:null},request_id=sha(JSON.stringify(metadata));
  const stage=await call('stage_upload',{request_id,name:metadata.name,sha256:metadata.sha256,size:metadata.size,data_base64:b.toString('base64')});assert.equal(stage.status,200,JSON.stringify(stage.body));
  const commits=await Promise.all([call('commit',{request_id}),call('commit',{request_id})]);assert.ok(commits.every(x=>x.status===200));assert.equal(commits.filter(x=>!x.body.replayed).length,1);
  const read=await call('read',{file_id:request_id,version_id:request_id});assert.equal(read.status,200);assert.equal(sha(Buffer.from(read.body.data_base64,'base64')),metadata.sha256);assert.deepEqual(Buffer.from(read.body.data_base64,'base64'),b);
  assert.equal((await (await mf.getR2Bucket('VAULT_BUCKET')).list()).objects.length,1);assert.equal((await call('receipt',{request_id})).body.receipt.status,'committed');pv=2;assert.equal((await call('read',{file_id:request_id,version_id:request_id})).status,401);
 }finally{await mf?.dispose();rmSync(directory,{recursive:true,force:true});}
});
