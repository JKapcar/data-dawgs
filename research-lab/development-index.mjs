// V2 bounded Merkle index. Existing v1 manifest pins continue using the old reader.
const TABLES=['players','combine_results','combine_tracking','games','player_play','game_tracking'];
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export async function readIndexedDevelopment({m,args,root,manifestSha,load,check,env,sourceSha}) {
 check(m.policy==='development-cohort-only-v1'&&JSON.stringify(m.seasons)==='["2023","2024"]'&&m.tables&&Object.keys(m.tables).length===6&&TABLES.every(t=>Object.hasOwn(m.tables,t)),'invalid_manifest');
 for(const t of TABLES){const d=m.tables[t];check(hash(d.root)&&Number.isSafeInteger(d.rows)&&d.rows>=0&&Number.isSafeInteger(d.depth)&&d.depth>=0&&d.depth<=6&&Array.isArray(d.columns)&&d.columns.length<=100,'invalid_manifest');}
 if(args.op==='catalog')return {manifestSha256:manifestSha,...m};
 check(TABLES.includes(args.table),'invalid_table');
 const path=args.path??[];check(Array.isArray(path)&&path.length<=6&&path.every(x=>Number.isSafeInteger(x)&&x>=0&&x<64),'invalid_path');
 const schema=m.tables[args.table];let current=schema.root;
 for(let level=0;;level++){
  const {value:n}=await load(env.RESEARCH_UPLOADS,root+current+'.json',current,65536);
  check(n.version===2&&n.kind==='index'&&n.sourceSha256===sourceSha&&n.table===args.table,'invalid_index');
  const leaf=level===schema.depth;
  check(leaf?Array.isArray(n.artifacts)&&n.artifacts.length<=64&&!n.children:Array.isArray(n.children)&&n.children.length>0&&n.children.length<=64&&n.children.every(hash)&&!n.artifacts,'invalid_index');
  // Repeated descriptors preserve source row multiplicity; hashes identify content, not occurrences.
  if(leaf)for(const a of n.artifacts)check(hash(a.sha256)&&Number.isSafeInteger(a.rows)&&a.rows>0&&a.rows<=256,'invalid_index');
  if(level===path.length){
   if(args.op==='index')return {manifestSha256:manifestSha,indexSha256:current,path,...n};
   check(leaf,'leaf_path_required');
   const descriptor=n.artifacts.find(a=>a.sha256===args.artifact);check(descriptor,'unknown_artifact');
   const {text,value:a}=await load(env.RESEARCH_UPLOADS,root+descriptor.sha256+'.json',descriptor.sha256,131072);
   const cols=schema.columns.map(c=>c.name);
   check(cols.every(c=>typeof c==='string'&&/^[a-z][a-z0-9_]*$/.test(c))&&new Set(cols).size===cols.length,'invalid_columns');
   check(a.version===2&&a.sourceSha256===sourceSha&&a.table===args.table&&JSON.stringify(a.columns)===JSON.stringify(cols)&&Array.isArray(a.rows)&&a.rows.length===descriptor.rows,'invalid_artifact');
   for(const r of a.rows){
    check(r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).length===cols.length&&cols.every(c=>Object.hasOwn(r,c)&&(r[c]===null||typeof r[c]==='string')),'invalid_row');
    const years=args.table==='games'?[r.season]:['game_tracking','player_play'].includes(args.table)?[r.dd_season,r.dd_draft_year]:[r.draft_year];
    check(years.every(y=>['2023','2024'].includes(y)),'non_development_row');
   }
   if(args.op==='artifact')return {sha256:descriptor.sha256,encoding:'utf-8',text};
   const filters=args.filters??{},offset=args.offset??0,limit=args.limit??100;
   check(filters&&typeof filters==='object'&&!Array.isArray(filters)&&Object.keys(filters).length<=4&&Object.entries(filters).every(([k,v])=>cols.includes(k)&&(v===null||typeof v==='string'&&v.length<=200)),'invalid_filters');
   check(Number.isSafeInteger(offset)&&offset>=0&&offset<=256&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'invalid_bounds');
   const rows=a.rows.filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v));
   return {manifestSha256:manifestSha,artifactSha256:descriptor.sha256,table:args.table,columns:cols,rows:rows.slice(offset,offset+limit),matched:rows.length,nextOffset:offset+limit<rows.length?offset+limit:null,holdoutRead:false,units:'unverified',missing:'null; no imputation'};
  }
  check(!leaf&&path[level]<n.children.length,'invalid_path');current=n.children[path[level]];
 }
}
