import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readDevelopmentData,SOURCE_SHA} from './development-data.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(year='2023'){
 const a={version:1,sourceSha256:SOURCE_SHA,table:'players',columns:['draft_year','nfl_id','value'],rows:[{draft_year:year,nfl_id:'synthetic',value:null},{draft_year:'2024',nfl_id:'synthetic2',value:'2'}]};
 const text=JSON.stringify(a),id=hash(text),m=JSON.stringify({version:1,sourceSha256:SOURCE_SHA,classes:['2023','2024'],holdoutRead:false,artifacts:[{table:'players',sha256:id,rows:2}]}),mid=hash(m),calls=[];
 const prefix='development/u_test/test/'+SOURCE_SHA+'/',objects=new Map([[prefix+id+'.json',text],[prefix+mid+'.json',m]]);
 const env={RESEARCH_DEVELOPMENT_DATA_ENABLED:'true',RESEARCH_DEVELOPMENT_MANIFEST_SHA:mid,RESEARCH_UPLOAD_TENANT:'test',RESEARCH_UPLOADS:{get:async key=>{calls.push(key);const s=objects.get(key);return s===undefined?null:{size:Buffer.byteLength(s),body:new Response(s).body};}}};
 return {env,id,mid,text,calls,objects,prefix,run:args=>readDevelopmentData(env,'u_test',args)};
}
test('catalog, null filters, bounded pagination and exact reproducible artifact',async()=>{
 const f=fixture();assert.equal((await f.run({op:'catalog'})).manifestSha256,f.mid);
 const rows=await f.run({op:'rows',artifact:f.id,filters:{value:null},limit:1});assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].nfl_id,'synthetic');assert.equal(rows.nextOffset,null);
 const page=await f.run({op:'rows',artifact:f.id,limit:1});assert.equal(page.nextOffset,1);assert.equal((await f.run({op:'rows',artifact:f.id,offset:1})).rows[0].draft_year,'2024');
 const a=await f.run({op:'artifact',artifact:f.id});assert.equal(a.text,f.text);assert.equal(hash(a.text),a.sha256);assert.ok(f.calls.every(k=>k.startsWith(f.prefix)));
});
test('off or unpinned reads do not contact storage',async()=>{for(const field of ['RESEARCH_DEVELOPMENT_DATA_ENABLED','RESEARCH_DEVELOPMENT_MANIFEST_SHA']){const f=fixture();delete f.env[field];await assert.rejects(f.run({op:'catalog'}),/disabled/);assert.equal(f.calls.length,0);}});
test('reject path injection, SQL, arbitrary fields, bad filters and bounds',async()=>{const f=fixture();for(const args of [{op:'sql'},{op:'catalog',tenant:'other'},{op:'artifact',artifact:'../../secret'},{op:'artifact',artifact:f.id,limit:1},{op:'rows',artifact:f.id,filters:{unknown:'x'}},{op:'rows',artifact:f.id,filters:{value:3}},{op:'rows',artifact:f.id,limit:101},{op:'rows',artifact:f.id,offset:-1},{op:'rows',artifact:f.id,limit:1.5}])await assert.rejects(f.run(args));});
test('holdout row rejected even in a hash-valid artifact',async()=>{const f=fixture('2025');for(const op of ['rows','artifact'])await assert.rejects(f.run({op,artifact:f.id}),/non_development/);});
test('missing and tampered objects fail closed',async()=>{const f=fixture();f.objects.set(f.prefix+f.id+'.json',f.text+' ');await assert.rejects(f.run({op:'rows',artifact:f.id}),/integrity/);f.objects.delete(f.prefix+f.id+'.json');await assert.rejects(f.run({op:'artifact',artifact:f.id}),/unavailable/);});
test('oversized body refused even when storage size lies',async()=>{const f=fixture();f.env.RESEARCH_UPLOADS.get=async()=>({size:1,body:new Response('x'.repeat(65537)).body});await assert.rejects(f.run({op:'catalog'}),/too_large/);});
