// Local readback only. No network, credentials, upload or activation.
import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash,webcrypto} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readDevelopmentData} from './development-data.mjs';
globalThis.crypto??=webcrypto;
const [directory,pin,receiptPath]=process.argv.slice(2);
if(!directory||!/^[a-f0-9]{64}$/.test(pin||'')||!receiptPath)throw Error('directory, manifest SHA and outside-Git receipt path required');
for(let p=path.resolve(receiptPath);;p=path.dirname(p)){try{await stat(path.join(p,'.git'));throw Error('receipt must be outside Git');}catch(e){if(e.message==='receipt must be outside Git')throw e;if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')throw e;}if(path.dirname(p)===p)break;}
const sha=b=>createHash('sha256').update(b).digest('hex');
const cache=new Map(),reached=new Set();let reads=0;
const env={RESEARCH_DEVELOPMENT_DATA_ENABLED:'true',RESEARCH_DEVELOPMENT_MANIFEST_SHA:pin,RESEARCH_UPLOAD_TENANT:'offline',RESEARCH_UPLOADS:{async get(key){
 const name=key.split('/').at(-1);if(!/^[a-f0-9]{64}\.(json|gz)$/.test(name))throw Error('invalid filename');
 let raw=cache.get(name);if(!raw){raw=await readFile(path.join(directory,name));if(name.endsWith('.json'))cache.set(name,raw);}
 reached.add(name);reads++;return {size:raw.length,body:new Response(raw).body};
}}};
const call=args=>readDevelopmentData(env,'local-verification',args);
const m=await call({op:'catalog'}),report={manifestSha256:pin,policy:m.policy,localOnly:true,authenticatedClientProof:false,tables:{}};
for(const table of Object.keys(m.tables)){
 let rows=0,partitions=0,descriptorOccurrences=0,lookups=0,sampleLookupObjectReads=null,samplePreviewObjectReads=null;
 const decodedCache=new Map();
 const shards=new Set();
 async function visit(selector){
  let page=0;
  do{
   const beforeLookup=reads;
   const result=await call({op:'lookup',table,selector,page});lookups++;
   if(!result.found){if(m.tables[table].rows!==0)throw Error('missing partition');return;}
   if(result.children){for(const child of result.children)await visit(child);}
   else{
    if(sampleLookupObjectReads===null)sampleLookupObjectReads=reads-beforeLookup;
    if(page===0)partitions++;
    for(const d of result.shards){
     const base={table,selector,page,artifact:d.sha256};
     let decoded=decodedCache.get(d.sha256);
     if(!decoded){
      const a=await call({op:'artifact',...base}),compressed=Buffer.from(a.data,'base64');
      if(sha(compressed)!==d.sha256)throw Error('compressed hash mismatch');
      const raw=gunzipSync(compressed,{maxOutputLength:1048576});if(sha(raw)!==d.decodedSha256)throw Error('decoded hash mismatch');
      decoded=JSON.parse(raw);decodedCache.set(d.sha256,decoded);if(decodedCache.size>64)decodedCache.delete(decodedCache.keys().next().value);
     }
     const selected=decoded.rows.slice(d.start,d.start+d.count);
     if(selected.length!==d.count||!selected.every(r=>Object.entries(selector).every(([k,v])=>r[k==='season'&&table!=='games'?'dd_season':k==='season_type'&&table!=='games'?'dd_season_type':k]===v)))throw Error('partition mismatch');
     rows+=selected.length;descriptorOccurrences++;shards.add(d.sha256);
     if(partitions===1){let offset=0,got=[];do{const before=reads;const r=await call({op:'rows',...base,offset});if(samplePreviewObjectReads===null)samplePreviewObjectReads=reads-before;got.push(...r.rows);offset=r.nextOffset;}while(offset!==null);if(JSON.stringify(got)!==JSON.stringify(selected))throw Error('pagination mismatch');}
    }
   }
   page=result.nextPage;
  }while(page!==null);
 }
 await visit({});
 if(rows!==m.tables[table].rows||partitions!==m.tables[table].partitions)throw Error('incomplete table '+table);
 report.tables[table]={rows,partitions,shards:shards.size,descriptorOccurrences,lookups,sampleLookupObjectReads,samplePreviewObjectReads};
 console.error(table+': '+rows+' verified rows');
}
const inventory=[];
for(const name of (await readdir(directory)).sort()){
 if(!/^[a-f0-9]{64}\.(json|gz)$/.test(name))throw Error('unexpected output entry');
 const raw=await readFile(path.join(directory,name));if(sha(raw)!==name.split('.')[0])throw Error('inventory hash mismatch');
 inventory.push({name,sha256:sha(raw),bytes:raw.length,reached:reached.has(name)});
}
if(inventory.some(o=>!o.reached))throw Error('unreachable artifact');
report.objectReads=reads;report.objects=inventory.length;report.bytes=inventory.reduce((n,o)=>n+o.bytes,0);report.inventory=inventory;
await writeFile(receiptPath,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,inventory:undefined},null,2));
