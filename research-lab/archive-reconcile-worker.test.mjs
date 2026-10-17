import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
import {mkdtempSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
const require=createRequire(path.join(process.env.DD_NODE_MODULES,'resolver.cjs')),{Miniflare}=require('miniflare');
test('native workerd reconciles the full 512 MiB bound with small streamed chunks',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'archive-digest-'));let mf;
 try{
  const size=512*1024*1024,chunk=new Uint8Array(65536),hash=createHash('sha256');for(let n=0;n<size;n+=chunk.length)hash.update(chunk);const expected=hash.digest('hex');
  copyFileSync(new URL('./upload-gateway.mjs',import.meta.url),path.join(dir,'upload-gateway.mjs'));
  writeFileSync(path.join(dir,'worker.mjs'),`import {verifyExistingArchive} from './upload-gateway.mjs';
   export default {async fetch(request){let bytes=0;const head={size:${size},version:'synthetic-v1',etag:'synthetic-etag',checksums:{}},bucket={head:async()=>head,get:async()=>({...head,body:new ReadableStream({pull(c){const length=Math.min(65536,head.size-bytes);if(!length){c.close();return;}bytes+=length;c.enqueue(new Uint8Array(length));}})})};await verifyExistingArchive(bucket,'synthetic',head,head.size,'${expected}',request.signal);return Response.json({bytes,verified:true});}};`);
  mf=new Miniflare({modules:true,modulesRoot:dir,scriptPath:path.join(dir,'worker.mjs'),compatibilityDate:'2026-07-31'});await mf.ready;
  const start=performance.now(),response=await mf.dispatchFetch('https://synthetic.invalid');assert.equal(response.status,200,await response.clone().text());assert.deepEqual(await response.json(),{bytes:size,verified:true});
  console.log(JSON.stringify({syntheticBytes:size,localWorkerdWallMs:Math.round(performance.now()-start),productionCpuMeasured:false}));
 }finally{await mf?.dispose();rmSync(dir,{recursive:true,force:true});}
});
