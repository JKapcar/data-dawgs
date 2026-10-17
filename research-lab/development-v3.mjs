// Private, immutable WR draft-season REG partitions. No storage key or URL input.
const TABLES=['players','combine_results','combine_tracking','games','player_play','game_tracking'];
const POLICY='wr-draft-season-reg-v1';
const FIELDS=t=>t==='games'?['season','season_type','game_id']:['player_play','game_tracking'].includes(t)?['season','season_type','game_id','play_id','nfl_id']:['draft_year','nfl_id'];
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const canonical=s=>JSON.stringify(Object.fromEntries(Object.keys(s).sort().map(k=>[k,s[k]])));
const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
async function bounded(stream,max,check){
 const reader=stream.getReader(),parts=[];let size=0;
 try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;check(size<=max,'artifact_too_large');parts.push(r.value);}}finally{await reader.cancel();}
 const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.byteLength;}return bytes;
}
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
export async function readDevelopmentV3({m,args,root,manifestSha,load,check,env,sourceSha}){
 check(m.policy===POLICY&&JSON.stringify(m.seasons)==='["2023","2024"]'&&m.tables&&Object.keys(m.tables).length===TABLES.length&&TABLES.every(t=>Object.hasOwn(m.tables,t)),'invalid_manifest');
 for(const t of TABLES){const d=m.tables[t];check(d&&hash(d.root)&&integer(d.rows,0,Number.MAX_SAFE_INTEGER)&&Array.isArray(d.columns)&&d.columns.length<=100&&JSON.stringify(d.selector)===JSON.stringify(FIELDS(t)),'invalid_manifest');}
 if(args.op==='catalog')return {manifestSha256:manifestSha,...m};
 check(TABLES.includes(args.table),'invalid_table');
 const table=args.table,schema=m.tables[table],fields=FIELDS(table);
 const select=args.selector??{};
 check(select&&typeof select==='object'&&!Array.isArray(select)&&Object.keys(select).length<=fields.length&&fields.slice(0,Object.keys(select).length).every(k=>Object.hasOwn(select,k))&&Object.entries(select).every(([k,v])=>fields.includes(k)&&typeof v==='string'&&v.length>0&&v.length<=200),'invalid_selector');
 if(Object.hasOwn(select,'season'))check(['2023','2024'].includes(select.season),'non_development_selector');
 if(Object.hasOwn(select,'draft_year'))check(['2023','2024'].includes(select.draft_year),'non_development_selector');
 if(Object.hasOwn(select,'season_type'))check(select.season_type==='REG','non_development_selector');
 const path=args.path??[];check(Array.isArray(path)&&path.length<=6&&path.every(x=>integer(x,0,15)),'invalid_path');
 check(args.op==='index'||!Object.hasOwn(args,'path'),'unexpected_arguments');
 const key=await digest(new TextEncoder().encode(canonical(select)));let current=schema.root;
 let entry;
 for(let level=0;level<=6;level++){
  const {value:n}=await load(env.RESEARCH_UPLOADS,root+current+'.json',current,65536);
  check(n.version===3&&n.kind==='lookup'&&n.sourceSha256===sourceSha&&n.table===table,'invalid_index');
  check((Array.isArray(n.children)&&!n.entries&&n.children.length>0&&n.children.length<=16)||(Array.isArray(n.entries)&&!n.children&&n.entries.length<=32),'invalid_index');
  if(n.children)check(n.children.every(c=>c&&typeof c.prefix==='string'&&/^[a-f0-9]$/.test(c.prefix)&&hash(c.sha256))&&new Set(n.children.map(c=>c.prefix)).size===n.children.length,'invalid_index');
  if(args.op==='index'){
   if(level===path.length)return {manifestSha256:manifestSha,indexSha256:current,path,...n};
   check(n.children&&path[level]<n.children.length,'invalid_path');current=n.children[path[level]].sha256;continue;
  }
  if(n.entries){
   entry=n.entries.find(e=>e?.key===key&&canonical(e.selector)===canonical(select));break;
  }
  const child=n.children.find(c=>c.prefix===key[level]);
  if(!child)break;
  check(level<6,'invalid_index');current=child.sha256;
 }
 if(!entry){check(args.op==='lookup','unknown_partition');return {manifestSha256:manifestSha,table,selector:select,found:false};}
 check(['children','shards'].includes(entry.kind),'invalid_index');
 const inline=Array.isArray(entry.values),totalPages=inline?1:entry.pages?.length;
 check(inline?!entry.pages:Array.isArray(entry.pages)&&entry.pages.length>0&&entry.pages.length<=256&&entry.pages.every(hash)&&!entry.values,'invalid_index');
 const page=args.page??0;check(integer(page,0,255)&&page<totalPages,'invalid_page');
 let values=entry.values;
 if(!inline){
  const pageHash=entry.pages[page];
  const {value:p}=await load(env.RESEARCH_UPLOADS,root+pageHash+'.json',pageHash,65536);
  check(p.version===3&&p.kind==='page'&&p.sourceSha256===sourceSha&&p.table===table&&canonical(p.selector)===canonical(select),'invalid_page');values=p[entry.kind];
 }
 check(Array.isArray(values)&&values.length>0&&values.length<=64,'invalid_page');
 if(entry.kind==='children'){
  check(values.every(c=>c&&Object.keys(c).length===Object.keys(select).length+1&&fields.slice(0,Object.keys(c).length).every(k=>typeof c[k]==='string'&&c[k].length>0&&c[k].length<=200)&&Object.keys(select).every(k=>c[k]===select[k])),'invalid_page');
 }else{
  check(Object.keys(select).length===fields.length&&values.every(d=>d&&hash(d.sha256)&&hash(d.decodedSha256)&&integer(d.compressedBytes,1,262144)&&integer(d.decodedBytes,1,1048576)&&integer(d.rows,1,2048)&&integer(d.start,0,d.rows-1)&&integer(d.count,1,d.rows-d.start)),'invalid_descriptor');
 }
 const info={manifestSha256:manifestSha,table,selector:select,found:true,page,nextPage:page+1<totalPages?page+1:null,totalPages,rows:entry.rows};
 if(args.op==='lookup')return {...info,[entry.kind]:values};
 check(entry.kind==='shards','full_selector_required');
 const descriptor=values.find(d=>d.sha256===args.artifact);check(descriptor,'unknown_artifact');
 const o=await env.RESEARCH_UPLOADS.get(root+descriptor.sha256+'.gz');check(o&&o.size===descriptor.compressedBytes,'artifact_unavailable');
 const compressed=await bounded(o.body,262144,check);
 check(compressed.byteLength===descriptor.compressedBytes&&await digest(compressed)===descriptor.sha256,'artifact_integrity_failed');
 const stream=new Response(compressed).body.pipeThrough(new DecompressionStream('gzip'));
 const raw=await bounded(stream,1048576,check);
 check(raw.byteLength===descriptor.decodedBytes&&await digest(raw)===descriptor.decodedSha256,'decoded_integrity_failed');
 const a=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),cols=schema.columns.map(c=>c.name);
 check(cols.every(c=>typeof c==='string'&&/^[a-z][a-z0-9_]*$/.test(c))&&new Set(cols).size===cols.length,'invalid_columns');
 check(a.version===3&&a.sourceSha256===sourceSha&&a.policy===POLICY&&a.table===table&&JSON.stringify(a.columns)===JSON.stringify(cols)&&Array.isArray(a.rows)&&a.rows.length===descriptor.rows,'invalid_artifact');
 for(const r of a.rows){
  check(r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).length===cols.length&&cols.every(c=>Object.hasOwn(r,c)&&(r[c]===null||typeof r[c]==='string')),'invalid_row');
  if(table==='games')check(['2023','2024'].includes(r.season)&&r.season_type==='REG','non_development_row');
  else if(['player_play','game_tracking'].includes(table))check(['2023','2024'].includes(r.dd_season)&&r.dd_season===r.dd_draft_year&&r.dd_season_type==='REG'&&r.dd_nfl_position==='WR','non_development_row');
  else check(['2023','2024'].includes(r.draft_year)&&(table==='players'?r.nfl_position:r.dd_nfl_position)==='WR','non_development_row');
 }
 const selected=a.rows.slice(descriptor.start,descriptor.start+descriptor.count);
 function rowSelector(r){if(table==='games')return Object.fromEntries(fields.map(k=>[k,r[k]]));if(['player_play','game_tracking'].includes(table))return {season:r.dd_season,season_type:r.dd_season_type,game_id:r.game_id,play_id:r.play_id,nfl_id:r.nfl_id};return {draft_year:r.draft_year,nfl_id:r.nfl_id};}
 check(selected.every(r=>canonical(rowSelector(r))===canonical(select)),'partition_range_mismatch');
 if(args.op==='artifact')return {...info,encoding:'gzip+base64',sha256:descriptor.sha256,decodedSha256:descriptor.decodedSha256,compressedBytes:compressed.length,decodedBytes:raw.length,range:{start:descriptor.start,count:descriptor.count},scope:'Shared shard may contain adjacent eligible WR partitions; range selects the requested partition.',data:base64(compressed)};
 check(args.op==='rows','invalid_operation');
 const offset=args.offset??0,limit=args.limit??100,filters=args.filters??{};
 check(integer(offset,0,2048)&&integer(limit,1,100),'invalid_bounds');
 check(filters&&typeof filters==='object'&&!Array.isArray(filters)&&Object.keys(filters).length<=4&&Object.entries(filters).every(([k,v])=>cols.includes(k)&&(v===null||typeof v==='string'&&v.length<=200)),'invalid_filters');
 const filtered=selected.filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v));
 return {...info,artifactSha256:descriptor.sha256,columns:cols,rows:filtered.slice(offset,offset+limit),matched:filtered.length,nextOffset:offset+limit<filtered.length?offset+limit:null,units:'unverified',missing:'null; no imputation',holdoutRead:false};
}
