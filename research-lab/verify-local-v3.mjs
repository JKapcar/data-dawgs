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
 let raw=cache.get(name);if(raw){cache.delete(name);cache.set(name,raw);}else{raw=await readFile(path.join(directory,name));if(name.endsWith('.json')){cache.set(name,raw);if(cache.size>1024)cache.delete(cache.keys().next().value);}}
 reached.add(name);reads++;return {size:raw.length,body:new Response(raw).body};
}}};
const call=args=>readDevelopmentData(env,'local-verification',args);
const m=await call({op:'catalog'}),report={manifestSha256:pin,policy:m.policy,localOnly:true,authenticatedClientProof:false,tables:{}};
const canonical=s=>JSON.stringify(Object.fromEntries(Object.keys(s).sort().map(k=>[k,s[k]])));
report.verificationMethod='Every index via production reader; complete prefix/page graph and descriptor ranges; each unique shard via production artifact reader once; every original range checked; representative lookup/row pagination. Source population equality is a separate sorted-row-fingerprint proof.';
for(const table of Object.keys(m.tables)){
 let rows=0,partitions=0,descriptorOccurrences=0,lookups=0,sampleLookupObjectReads=null,samplePreviewObjectReads=null,indexCalls=0;
 const entries=new Map(),references=new Map(),visited=new Set();
 async function indexes(p){
  const n=await call({op:'index',table,path:p});indexCalls++;
  if(n.children){for(let i=0;i<n.children.length;i++)await indexes([...p,i]);return;}
  for(const e of n.entries){const key=canonical(e.selector);if(sha(Buffer.from(key))!==e.key||entries.has(key))throw Error('duplicate or invalid selector identity');entries.set(key,e);}
 }
 await indexes([]);
 async function discover(selector){
  const key=canonical(selector),e=entries.get(key);
  if(!e){if(m.tables[table].rows===0&&Object.keys(selector).length===0)return;throw Error('missing prefix');}
  if(visited.has(key))throw Error('repeated discovery child');visited.add(key);
  const fields=m.tables[table].selector,n=Object.keys(selector).length;
  if(n>fields.length||!fields.slice(0,n).every(k=>Object.hasOwn(selector,k)))throw Error('invalid selector prefix');
  const pages=e.values?[e.values]:[];
  if(e.pages){for(let page=0;page<e.pages.length;page++){const r=await call({op:'lookup',table,selector,page});lookups++;if(!r.found||r.nextPage!==(page+1<e.pages.length?page+1:null))throw Error('incomplete page links');pages.push(r[e.kind]);}}
  if(e.kind==='children'){
   for(const values of pages){if(!values||values.length>64)throw Error('child page bound');for(const child of values){if(Object.keys(child).length!==n+1||!Object.keys(selector).every(k=>child[k]===selector[k]))throw Error('child prefix mismatch');await discover(child);}}
  }else if(e.kind==='shards'){
   if(n!==fields.length)throw Error('incomplete full selector');partitions++;let total=0;
   if(sampleLookupObjectReads===null){const before=reads,r=await call({op:'lookup',table,selector});lookups++;sampleLookupObjectReads=reads-before;if(!r.found||!r.shards)throw Error('lookup failed');}
   for(let page=0;page<pages.length;page++)for(const d of pages[page]){
    if(!Number.isSafeInteger(d.count)||d.count<1||!Number.isSafeInteger(d.start)||d.start<0||d.start+d.count>d.rows)throw Error('invalid range');
    const list=references.get(d.sha256)||[];list.push({d,selector,page});references.set(d.sha256,list);descriptorOccurrences++;total+=d.count;
   }
   if(total!==e.rows)throw Error('partition row total');
  }else throw Error('invalid entry kind');
 }
 await discover({});if(visited.size!==entries.size)throw Error('unreachable selector entry');
 let checkedPagination=false;
 for(const [hash,occurrences] of references){
  const first=occurrences[0],base={table,selector:first.selector,page:first.page,artifact:hash};
  const exact=await call({op:'artifact',...base}),compressed=Buffer.from(exact.data,'base64');
  if(sha(compressed)!==hash)throw Error('compressed hash mismatch');
  const raw=gunzipSync(compressed,{maxOutputLength:1048576});if(sha(raw)!==first.d.decodedSha256)throw Error('decoded hash mismatch');
  const decoded=JSON.parse(raw);
  for(const {d,selector} of occurrences){
   if(['decodedSha256','compressedBytes','decodedBytes','rows'].some(k=>d[k]!==first.d[k]))throw Error('conflicting shared descriptor');
   const selected=decoded.rows.slice(d.start,d.start+d.count);
   if(selected.length!==d.count||!selected.every(r=>Object.entries(selector).every(([k,v])=>r[k==='season'&&table!=='games'?'dd_season':k==='season_type'&&table!=='games'?'dd_season_type':k]===v)))throw Error('partition mismatch');
   rows+=selected.length;
  }
  if(!checkedPagination){
   let offset=0,got=[];do{const before=reads,r=await call({op:'rows',...base,offset});if(samplePreviewObjectReads===null)samplePreviewObjectReads=reads-before;got.push(...r.rows);offset=r.nextOffset;}while(offset!==null);
   if(JSON.stringify(got)!==JSON.stringify(decoded.rows.slice(first.d.start,first.d.start+first.d.count)))throw Error('pagination mismatch');checkedPagination=true;
  }
 }
 if(rows!==m.tables[table].rows||partitions!==m.tables[table].partitions)throw Error('incomplete table '+table);
 report.tables[table]={rows,partitions,shards:references.size,descriptorOccurrences,lookups,indexCalls,sampleLookupObjectReads,samplePreviewObjectReads};
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
