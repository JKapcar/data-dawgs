// Read-only local proof; never contacts R2 or uses a credential.
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash,webcrypto} from 'node:crypto';
import {readDevelopmentData} from './development-data.mjs';
globalThis.crypto??=webcrypto;
const [directory,pin]=process.argv.slice(2);
if(!directory||!/^[a-f0-9]{64}$/.test(pin||''))throw Error('directory and manifest SHA-256 required');
const cache=new Map();let reads=0;
const env={RESEARCH_DEVELOPMENT_DATA_ENABLED:'true',RESEARCH_DEVELOPMENT_MANIFEST_SHA:pin,RESEARCH_UPLOAD_TENANT:'offline',RESEARCH_UPLOADS:{async get(key){
 const h=key.split('/').at(-1);if(!/^[a-f0-9]{64}\.json$/.test(h))throw Error('invalid hash');
 const file=path.join(directory,h);let raw=cache.get(h);
 if(!raw){raw=await readFile(file);if(raw.length<=65536&&(!raw.includes(Buffer.from('"rows":['))))cache.set(h,raw);}
 reads++;return {size:(await stat(file)).size,body:new Response(raw).body};
}}};
const call=args=>readDevelopmentData(env,'local-verification',args);
const m=await call({op:'catalog'}),report={manifestSha256:pin,localOnly:true,authenticatedClientProof:false,tables:{}};
for(const table of Object.keys(m.tables)){
 let rows=0,artifacts=0;const visited=new Set();
 async function walk(p){
  const index=await call({op:'index',table,path:p});
  if(visited.has(index.indexSha256))throw Error('duplicate index');visited.add(index.indexSha256);
  if(index.children){for(let i=0;i<index.children.length;i++)await walk([...p,i]);return;}
  for(const a of index.artifacts){
   const exact=await call({op:'artifact',table,path:p,artifact:a.sha256});
   if(createHash('sha256').update(exact.text).digest('hex')!==a.sha256)throw Error('hash mismatch');
   const decoded=JSON.parse(exact.text);rows+=decoded.rows.length;
   if(artifacts===0){let offset=0,got=[];do{const page=await call({op:'rows',table,path:p,artifact:a.sha256,offset});got.push(...page.rows);offset=page.nextOffset;}while(offset!==null);if(JSON.stringify(got)!==JSON.stringify(decoded.rows))throw Error('pagination mismatch');}
   artifacts++;
  }
 }
 await walk([]);
 if(rows!==m.tables[table].rows)throw Error('incomplete table');
 report.tables[table]={rows,artifacts,indexes:visited.size};
 console.error(table+': '+rows+' verified rows');
}
report.objectReads=reads;console.log(JSON.stringify(report,null,2));
