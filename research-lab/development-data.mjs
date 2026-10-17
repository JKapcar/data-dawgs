import {readDevelopmentV3} from './development-v3.mjs';
import {readIndexedDevelopment} from './development-index.mjs';
// Read-only, bounded, immutable development artifacts. No caller-selected storage keys.
export const SOURCE_SHA='27d52f594d6d31d4f617f9c94b0b37d11e280397ad8293c0987da5f91a8d0ced';
export const DATA_TOOL={name:'dd_owner_bdb_data',description:'Read private development (draft classes 2023-2024) artifacts. catalog lists schemas, missingness and explicitly unverified units. rows reads one catalog artifact with optional exact string/null filters, offset and limit. artifact returns reproducible bytes and SHA-256 (V1/V2 JSON text; V3 bounded gzip+base64). No SQL, URLs, holdout or execution. Use catalog for the active tables. V2 index traverses bounded table/path pages; rows/artifact require their leaf path and hash. Filters apply within one artifact; enumerate every index page for a complete scan. V3 lookup accepts a prefix selector (season, season_type, game_id, play_id, nfl_id for NFL; draft_year, nfl_id for combine) and page; discover children until full selector yields bounded shard descriptors. V3 rows/artifact use full selector, page, artifact; offset applies within its range. V3 artifact returns bounded gzip+base64 with compressed/decoded hashes and may contain adjacent eligible WR partitions. V3 is REG draft-season WR only. Career outcomes are excluded.',inputSchema:{type:'object',additionalProperties:false,required:['op'],properties:{op:{enum:['catalog','index','lookup','rows','artifact']},table:{enum:['players','combine_results','combine_tracking','games','player_play','game_tracking']},selector:{type:'object',maxProperties:5,additionalProperties:{type:'string'}},page:{type:'integer',minimum:0,maximum:255},path:{type:'array',maxItems:6,items:{type:'integer',minimum:0,maximum:63}},artifact:{type:'string',pattern:'^[a-f0-9]{64}$'},filters:{type:'object',maxProperties:4,additionalProperties:{type:['string','null']}},offset:{type:'integer',minimum:0,maximum:2048},limit:{type:'integer',minimum:1,maximum:100}}},annotations:{readOnlyHint:true}};
const check=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{status:400});};
const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
export const dataEnabled=env=>env.RESEARCH_DEVELOPMENT_DATA_ENABLED==='true'&&!!env.RESEARCH_UPLOADS&&/^[a-f0-9]{64}$/.test(env.RESEARCH_DEVELOPMENT_MANIFEST_SHA||'');
async function load(bucket,key,hash,max){
 const o=await bucket.get(key);check(o&&Number.isSafeInteger(o.size)&&o.size<=max,'artifact_unavailable');
 const reader=o.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;check(size<=max,'artifact_too_large');chunks.push(value);}}finally{await reader.cancel();}
 const b=new Uint8Array(size);let offset=0;for(const c of chunks){b.set(c,offset);offset+=c.length;}check(await sha(b)===hash,'artifact_integrity_failed');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(b);return {text,value:JSON.parse(text)};
}
export async function readDevelopmentData(env,uid,args){
 check(dataEnabled(env),'development_data_disabled');
 check(args&&typeof args==='object'&&!Array.isArray(args),'invalid_arguments');
 const keys=Object.keys(args),op=args.op;check(['catalog','index','lookup','rows','artifact'].includes(op),'invalid_operation');
 check(keys.every(k=>(op==='catalog'?['op']:op==='index'?['op','table','path']:op==='lookup'?['op','table','selector','page']:op==='artifact'?['op','table','path','selector','page','artifact']:['op','table','path','selector','page','artifact','filters','offset','limit']).includes(k)),'unexpected_arguments');
 const root='development/'+uid+'/'+env.RESEARCH_UPLOAD_TENANT+'/'+SOURCE_SHA+'/';
 const manifestSha=env.RESEARCH_DEVELOPMENT_MANIFEST_SHA;
 const {value:m}=await load(env.RESEARCH_UPLOADS,root+manifestSha+'.json',manifestSha,65536);
 check(m.sourceSha256===SOURCE_SHA&&JSON.stringify(m.classes)==='["2023","2024"]'&&m.holdoutRead===false,'invalid_manifest');
 if(m.version===3)return readDevelopmentV3({m,args,root,manifestSha,load,check,env,sourceSha:SOURCE_SHA});
 check(op!=='lookup'&&!['selector','page'].some(k=>Object.hasOwn(args,k)),'invalid_legacy_arguments');
 if(m.version===2)return readIndexedDevelopment({m,args,root,manifestSha,load,check,env,sourceSha:SOURCE_SHA});
 check(!['table','path'].some(k=>Object.hasOwn(args,k))&&op!=='index','invalid_v1_arguments');
 check(m.version===1&&m.sourceSha256===SOURCE_SHA&&JSON.stringify(m.classes)===JSON.stringify(['2023','2024'])&&m.holdoutRead===false&&Array.isArray(m.artifacts)&&m.artifacts.length<=32,'invalid_manifest');
 const seen=new Set();for(const a of m.artifacts){check(/^[a-f0-9]{64}$/.test(a.sha256)&&!seen.has(a.sha256)&&['players','combine_results'].includes(a.table)&&Number.isSafeInteger(a.rows)&&a.rows>0&&a.rows<=256,'invalid_manifest');seen.add(a.sha256);}
 if(op==='catalog')return {manifestSha256:manifestSha,...m};
 check(typeof args.artifact==='string'&&seen.has(args.artifact),'unknown_artifact');
 const descriptor=m.artifacts.find(a=>a.sha256===args.artifact);
 const {text,value:a}=await load(env.RESEARCH_UPLOADS,root+descriptor.sha256+'.json',descriptor.sha256,131072);
 check(a.version===1&&a.sourceSha256===SOURCE_SHA&&a.table===descriptor.table&&Array.isArray(a.rows)&&a.rows.length===descriptor.rows&&Array.isArray(a.columns)&&a.columns.includes('draft_year')&&new Set(a.columns).size===a.columns.length,'invalid_artifact');
 check(a.columns.every(c=>typeof c==='string'&&/^[a-z][a-z0-9_]*$/.test(c)),'invalid_columns');
 for(const row of a.rows)check(row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).length===a.columns.length&&a.columns.every(c=>Object.hasOwn(row,c)&&(row[c]===null||typeof row[c]==='string'))&&['2023','2024'].includes(row.draft_year),'non_development_row');
 if(op==='artifact')return {sha256:descriptor.sha256,encoding:'utf-8',text};
 const filters=args.filters??{},offset=args.offset??0,limit=args.limit??100;
 check(filters&&typeof filters==='object'&&!Array.isArray(filters)&&Object.keys(filters).length<=4&&Object.entries(filters).every(([k,v])=>a.columns.includes(k)&&(v===null||typeof v==='string'&&v.length<=200)),'invalid_filters');
 check(Number.isSafeInteger(offset)&&offset>=0&&offset<=256&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'invalid_bounds');
 const rows=a.rows.filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v));
 return {manifestSha256:manifestSha,artifactSha256:descriptor.sha256,table:a.table,columns:a.columns,rows:rows.slice(offset,offset+limit),matched:rows.length,nextOffset:offset+limit<rows.length?offset+limit:null,units:'unverified; see catalog',missing:'null; no imputation',holdoutRead:false};
}
