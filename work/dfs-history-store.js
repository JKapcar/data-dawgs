/* Explicit, immutable private DFS archives. No automatic imports or account writes.
   Payload JSON preserves nulls, empty arrays and original source evidence in RTDB. */
const DFS_HISTORY_BYTES=8000000;
function dfsHistoryPayload(kind,payload){
 dfsAssert(['account_history','results_ledger','workspace'].includes(kind),'Unknown history kind');
 let nodes=0;
 const visit=(v,depth=0)=>{
  dfsAssert(++nodes<=750000&&depth<=24,'History is too large or deeply nested');
  if(v===null||typeof v==='boolean')return;
  if(typeof v==='number'){dfsAssert(Number.isFinite(v),'History numbers must be finite or null');return;}
  if(typeof v==='string'){dfsAssert(v.length<=4000000,'History text exceeds 4 MB');return;}
  dfsAssert(v&&typeof v==='object','History must contain JSON values');
  for(const [k,x] of Object.entries(v)){dfsAssert(!['__proto__','constructor','prototype'].includes(k),'Unsupported history key');visit(x,depth+1);}
 };
 visit(payload);dfsAssert(payload&&!Array.isArray(payload),'Supply a history object');
 const objects=a=>Array.isArray(a)&&a.every(v=>v&&typeof v==='object'&&!Array.isArray(v));
 if(kind==='account_history'){
  dfsAssert(payload.version===2&&objects(payload.records)&&Array.isArray(payload.legacy_archives),'Expected version 2 account history with records and legacy_archives');
  dfsAssert(payload.records.length>0||payload.legacy_archives.length>0,'History has no records to save');
 }else if(kind==='results_ledger'){
  dfsAssert(['dfs-ledger/1','dfs-ledger/2'].includes(payload.schema)&&payload.slate&&objects(payload.entries)&&objects(payload.contests)&&objects(payload.ownership),'Expected a complete results ledger');
  dfsAssert(payload.entries.length>0,'Ledger has no entries to save');
 }else dfsAssert(payload.version===1&&payload.workspace&&Array.isArray(payload.workspace.players)&&Array.isArray(payload.workspace.lineups),'Expected a saved workspace archive');
 const json=JSON.stringify(payload),bytes=new TextEncoder().encode(json).length;
 dfsAssert(bytes<=DFS_HISTORY_BYTES,'History exceeds 8 MB; export it privately and split the source by date');return {json,bytes};
}
async function dfsHistoryDigest(kind,json){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(kind+'\n'+json));return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');}
function dfsHistoryRoot(caller){return '/users/'+dfsUid(caller)+'/dfsHistory';}
function dfsHistoryId(id){dfsAssert(typeof id==='string'&&/^[a-f0-9]{64}$/.test(id),'Invalid history ID');return id;}
async function dfsHistorySave(env,caller,kind,title,payload,origin){
 title=mcpDfsString(title,'title',160);const {json,bytes}=dfsHistoryPayload(kind,payload),id=await dfsHistoryDigest(kind,json),base=dfsHistoryRoot(caller),path=base+'/records/'+id;
 const prior=await fbGet(env,path,true);let record=prior.data;
 if(!record){
  const records=kind==='account_history'?payload.records:kind==='results_ledger'?payload.entries:payload.workspace.lineups;
  const dates=records.map(r=>r.date).filter(v=>typeof v==='string'&&v).sort();
  const meta={id,kind,title,saved_at:new Date().toISOString(),entries:records.length,bytes,source_start:dates[0]||payload.slate?.date||payload.workspace?.as_of||null,source_end:dates.at(-1)||payload.slate?.date||payload.workspace?.as_of||null,origin};
  record={meta,payload_json:json};dfsAssert(prior.etag,'Storage did not return an ETag; refusing an unsafe history write');
  if(!await fbPut(env,path,record,prior.etag)){record=(await fbGet(env,path)).data;dfsAssert(record?.payload_json===json,'Archive conflict; original history retained');}
 }
 dfsAssert(record.payload_json===json&&record.meta?.kind===kind,'Archive conflict; original history retained');
 // A failed index write is repairable by retrying the identical payload. The archive never changes.
 try{await fbPut(env,base+'/index/'+id,record.meta);}catch{throw Error('Archive stored, but its history listing could not be saved. Retry the same save to finish; no duplicate will be created.');}
 return {saved:true,existing:!!prior.data,history:record.meta};
}
async function dfsHistoryRun(op,a,env,caller){
 const base=dfsHistoryRoot(caller),allowed={history_save:['kind','title','payload'],history_archive:['workspace_id','expected_revision','title'],history_list:['kind','limit','cursor'],history_get:['history_id']};
 dfsAssert(allowed[op],'Unknown history operation');dfsObj(a,allowed[op],'arguments');
 if(op==='history_save'){
  dfsAssert(['account_history','results_ledger'].includes(a.kind),'Use history_archive for server workspace evidence');
  return dfsHistorySave(env,caller,a.kind,a.title,a.payload,'user-supplied history; save time is not prediction time');
 }
 if(op==='history_archive'){
  const r=await dfsLoad(env,caller,a.workspace_id);dfsNum(a.expected_revision,1,2147483647,'expected_revision',true);dfsAssert(r.data.revision===a.expected_revision,'Revision conflict. Reload the workspace before archiving.');
  return dfsHistorySave(env,caller,'workspace',a.title,{version:1,workspace:r.data},'server workspace revision '+r.data.revision+'; original prediction provenance retained');
 }
 if(op==='history_get'){
  const record=(await fbGet(env,base+'/records/'+dfsHistoryId(a.history_id))).data;dfsAssert(record?.payload_json&&record.meta,'History not found');
  return {history:record.meta,payload:JSON.parse(record.payload_json)};
 }
 const limit=a.limit??25;dfsNum(limit,1,100,'limit',true);if(a.kind!=null)dfsAssert(['account_history','results_ledger','workspace'].includes(a.kind),'Unknown history kind');if(a.cursor!=null)dfsHistoryId(a.cursor);
 const rows=Object.values((await fbGet(env,base+'/index')).data||{}).filter(r=>!a.kind||r.kind===a.kind).sort((x,y)=>String(y.saved_at).localeCompare(String(x.saved_at))||y.id.localeCompare(x.id));
 const start=a.cursor==null?0:rows.findIndex(r=>r.id===a.cursor)+1;dfsAssert(a.cursor==null||start>0,'History cursor no longer exists; refresh the list');
 const page=rows.slice(start,start+limit);return {history:page,next_cursor:start+limit<rows.length?page.at(-1).id:null,total:rows.length};
}
function dfsHistorySchema(op){
 const s={type:'string'},k={type:'string',enum:['account_history','results_ledger','workspace']};
 const properties={history_save:{kind:{type:'string',enum:['account_history','results_ledger']},title:{type:'string',maxLength:160},payload:{type:'object'}},history_archive:{workspace_id:s,expected_revision:{type:'integer',minimum:1},title:{type:'string',maxLength:160}},history_list:{kind:k,limit:{type:'integer',minimum:1,maximum:100},cursor:s},history_get:{history_id:s}}[op];
 return {type:'object',properties,required:op==='history_list'?[]:Object.keys(properties),additionalProperties:false};
}
