/* Private Stage archive transport. No provider submissions or production setup.
 * Content addressing provides integrity, NOT proof of exhaustive enumeration. */
const STAGE_CAPS=Object.freeze({manifest:262144,chunk:2097152,decoded:8388608,total:134217728,players:64});
function stageCheck(ok,message,status=400){if(!ok)throw Object.assign(new Error(message),{status});}
function stageKeys(o,keys){stageCheck(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===keys.slice().sort().join('|'),'Unexpected archive schema');}
function stageText(s,n=2000){return typeof s==='string'&&s.length>0&&s.length<=n&&!/[\u0000-\u0008]/.test(s);}
function stageInt(n,min,max){return Number.isSafeInteger(n)&&n>=min&&n<=max;}
async function stageHash(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function stageBytes(stream,limit){
 const chunks=[];let size=0;if(!stream)return new Uint8Array();const reader=stream.getReader();
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;stageCheck(size<=limit,'Archive body exceeds size cap',413);chunks.push(value);}}
 catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}return bytes;
}
function stageManifest(m){
 stageKeys(m,['format','record','source','game','rules','identity_method','flex','partitions','total_lineups']);stageCheck(m.format==='showdown-stage/1','Unsupported archive format');
 stageKeys(m.record,['struct','bytes','compression','captain','flex_indices','salary']);
 stageCheck(m.record.struct==='<5BH'&&m.record.bytes===7&&m.record.compression==='gzip'&&m.record.captain==='implicit per partition'&&m.record.flex_indices==='strictly increasing zero-based indices into flex dictionary'&&m.record.salary==='uint16 little-endian total dollars','Unsupported record layout');
 stageKeys(m.source,['file_name','sha256','provenance','official','sample_only']);stageCheck(stageText(m.source.file_name,240)&&/^[a-f0-9]{64}$/.test(m.source.sha256)&&stageText(m.source.provenance)&&typeof m.source.official==='boolean'&&typeof m.source.sample_only==='boolean','Invalid provenance');
 stageCheck(!m.source.sample_only||!m.source.official,'Sample cannot claim official source');
 stageKeys(m.game,['requested','observed','teams','validation']);stageCheck(stageText(m.game.requested,120)&&Array.isArray(m.game.observed)&&m.game.observed.length>0&&m.game.observed.length<=64&&m.game.observed.every(s=>stageText(s,240))&&Array.isArray(m.game.teams)&&m.game.teams.length===2&&m.game.teams.every(s=>/^[A-Z0-9]{2,5}$/.test(s))&&m.game.teams[0]!==m.game.teams[1]&&m.game.validation==='passed','Invalid game evidence');
 stageKeys(m.rules,['salary_cap','distinct_athletes','captains','flex','both_teams_required','additional_filters']);stageCheck(m.rules.salary_cap===50000&&m.rules.distinct_athletes===6&&m.rules.captains===1&&m.rules.flex===5&&m.rules.both_teams_required===true&&Array.isArray(m.rules.additional_filters)&&m.rules.additional_filters.length===0,'Unsupported rules');
 stageCheck(stageText(m.identity_method)&&Array.isArray(m.flex)&&m.flex.length>=6&&m.flex.length<=STAGE_CAPS.players,'Invalid dictionary');
 const ids=new Set(),athletes=new Set();for(const p of m.flex){stageKeys(p,['identity','name','team','roles']);stageCheck(stageText(p.identity,240)&&stageText(p.name,160)&&m.game.teams.includes(p.team)&&!athletes.has(p.identity),'Invalid or duplicate athlete');athletes.add(p.identity);stageKeys(p.roles,['CPT','FLEX']);for(const role of ['CPT','FLEX']){const r=p.roles[role];stageKeys(r,['id','salary','name_plus_id']);stageCheck(stageText(r.id,100)&&!ids.has(r.id)&&stageText(r.name_plus_id,300)&&stageInt(r.salary,0,50000),'Invalid slot identity');ids.add(r.id);if(m.source.official)stageCheck(/^\d+$/.test(r.id),'Official slot IDs must be numeric');}stageCheck(p.roles.CPT.salary===p.roles.FLEX.salary*1.5,'Captain salary mismatch');}
 stageCheck(Array.isArray(m.partitions)&&m.partitions.length===m.flex.length,'One partition per captain required');let count=0,size=0;const captains=new Set();for(const p of m.partitions){stageKeys(p,['captain_index','captain_id','file','count','uncompressed_bytes','compressed_bytes','sha256']);stageCheck(stageInt(p.captain_index,0,m.flex.length-1)&&!captains.has(p.captain_index),'Invalid captain index');captains.add(p.captain_index);stageCheck(p.captain_id===m.flex[p.captain_index].roles.CPT.id&&p.file==='captain_'+String(p.captain_index).padStart(3,'0')+'.bin.gz'&&stageInt(p.count,0,Math.floor(STAGE_CAPS.decoded/7))&&p.uncompressed_bytes===p.count*7&&stageInt(p.compressed_bytes,20,STAGE_CAPS.chunk)&&/^[a-f0-9]{64}$/.test(p.sha256),'Invalid partition');count+=p.count;size+=p.compressed_bytes;}
 stageCheck(count===m.total_lineups&&size<=STAGE_CAPS.total,'Invalid archive totals');return m;
}
// A separate model version never changes legal-universe identity or completeness.
function stageMetrics(v,m,archive){
 stageKeys(v,['format','manifest_sha256','source','definitions','units','players']);stageCheck(v.format==='showdown-stage-metrics/1'&&v.manifest_sha256===archive,'Model archive join mismatch');
 stageKeys(v.units,['ceiling','ownership']);stageCheck(v.units.ceiling==='DK fantasy points'&&v.units.ownership==='fraction','Invalid model units');
 stageKeys(v.source,['provider','snapshot_label','observed_at','sample_only','official','workbook_sha256']);const src=v.source;
 stageCheck(stageText(src.provider,120)&&stageText(src.snapshot_label,240)&&typeof src.sample_only==='boolean'&&typeof src.official==='boolean'&&(!src.sample_only||!src.official)&&/^[a-f0-9]{64}$/.test(src.workbook_sha256),'Invalid model provenance');
 stageCheck(src.observed_at===null||(typeof src.observed_at==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(src.observed_at)&&Number.isFinite(Date.parse(src.observed_at))),'Invalid model timestamp');
 stageCheck(!m.source.sample_only||src.sample_only,'Sample archive requires sample model labeling');
 const definitions={ceiling:'Summed ceiling (not simulated)',ownership:'Summed ownership; not duplication probability',cpt_ceiling:'1.5 × FLEX ceiling (derived)',flex_ownership:'Total Own minus CPT Own'};
 stageKeys(v.definitions,Object.keys(definitions));stageCheck(Object.entries(definitions).every(([k,x])=>v.definitions[k]===x),'Unsupported model definitions');
 stageCheck(Array.isArray(v.players)&&v.players.length===m.flex.length,'Model must cover every dictionary index');const seen=new Set();
 const value=(x,max)=>x===null||(typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=max);
 for(const p of v.players){stageKeys(p,['index','identity','CPT','FLEX']);stageCheck(stageInt(p.index,0,m.flex.length-1)&&!seen.has(p.index),'Duplicate or invalid model index');seen.add(p.index);const athlete=m.flex[p.index];stageCheck(p.identity===athlete.identity,'Model identity mismatch');
  for(const role of ['CPT','FLEX']){const r=p[role];stageKeys(r,['role_id','ceiling','ownership','ceiling_method']);stageCheck(r.role_id===athlete.roles[role].id&&value(r.ceiling,role==='CPT'?1500:1000)&&value(r.ownership,1)&&r.ceiling_method===(role==='CPT'?'derived_1.5x_flex':'provider'),'Invalid model role or metric');}
  stageCheck(p.CPT.ceiling===null||(p.FLEX.ceiling!==null&&Math.abs(p.CPT.ceiling-1.5*p.FLEX.ceiling)<=1e-8),'Captain ceiling derivation mismatch');
  stageCheck(p.CPT.ownership===null||p.FLEX.ownership===null||p.CPT.ownership+p.FLEX.ownership<=1+1e-10,'Combined role ownership exceeds one');
 }
 return v;
}
async function stageReadManifest(bucket,key,id){const obj=await bucket.get(key);stageCheck(obj,'Archive not found',404);const bytes=await stageBytes(obj.body,STAGE_CAPS.manifest);stageCheck(await stageHash(bytes)===id,'Stored manifest integrity failure',409);return stageManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}
async function stageImmutable(bucket,key,bytes,hash,type,format='showdown-stage/1'){
 const result=await bucket.put(key,bytes,{onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:type},customMetadata:{sha256:hash,format}});
 // Read back even on duplicate/retry; never overwrite an existing object.
 const stored=await bucket.get(key);stageCheck(stored,'Archive readback failed',409);const back=await stageBytes(stored.body,bytes.length);stageCheck(back.length===bytes.length&&await stageHash(back)===hash,'Immutable archive conflict',409);return !!result;
}
async function stageValidateChunk(bytes,p,m){
 stageCheck(bytes.length===p.compressed_bytes&&await stageHash(bytes)===p.sha256,'Chunk hash or length mismatch');
 const decoded=await stageBytes(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),p.uncompressed_bytes);stageCheck(decoded.length===p.uncompressed_bytes,'Decoded length mismatch');
 // Validate every stored roster; ordering prevents duplicate records within a partition.
 let previous=null;for(let at=0;at<decoded.length;at+=7){const flex=Array.from(decoded.subarray(at,at+5));stageCheck(flex.every((i,j)=>i<m.flex.length&&i!==p.captain_index&&(j===0||i>flex[j-1])),'Invalid roster indices');
  if(previous){let cmp=0;for(let j=0;j<5&&!cmp;j++)cmp=flex[j]-previous[j];stageCheck(cmp>0,'Duplicate or unordered roster');}previous=flex;
  const roster=[p.captain_index,...flex],salary=m.flex[p.captain_index].roles.CPT.salary+flex.reduce((s,i)=>s+m.flex[i].roles.FLEX.salary,0);stageCheck(salary<=50000&&salary===decoded[at+5]+256*decoded[at+6]&&new Set(roster.map(i=>m.flex[i].team)).size===2,'Illegal roster salary or teams');
 }
}
async function handleShowdownStage(request,url,env,cors){
 const headers={...cors,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 try{
  const auth=await sessionAuth(request,env);stageCheck(!auth.err,auth.err||'Sign in required',auth.code||401);
  stageCheck(/^u_[A-Za-z0-9_-]{1,100}$/.test(env.RESEARCH_OWNER_UID||'')&&auth.uid===env.RESEARCH_OWNER_UID,'Owner session required',403);stageCheck(env.RESEARCH_UPLOADS,'Private storage unavailable',503);
  const kind=url.pathname.slice('/api/dfs/stage/'.length);stageCheck(['manifest','chunk','model'].includes(kind),'Unknown Stage route',404);stageCheck(['GET','PUT'].includes(request.method),'GET or PUT required',405);
  stageCheck([...url.searchParams.keys()].sort().join('|')===(kind==='manifest'?'archive':kind==='model'?'archive|model':'archive|index'),'Unexpected query');const id=url.searchParams.get('archive');stageCheck(/^[a-f0-9]{64}$/.test(id||''),'Invalid archive ID');
  const base='showdown-stage/v1/'+auth.uid+'/'+id+'/',key=base+'manifest.json',bucket=env.RESEARCH_UPLOADS;
  if(kind==='manifest'&&request.method==='PUT'){
   const bytes=await stageBytes(request.body,STAGE_CAPS.manifest);stageCheck(await stageHash(bytes)===id,'Manifest hash mismatch');const m=stageManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));const created=await stageImmutable(bucket,key,bytes,id,'application/json');return json({archive:id,created,verified_readback:true,audit:{source:m.source,enumeration_verified:false,source_claims_verified:false,notice:'Integrity and roster legality only; completeness is not independently certified.'}},200,headers);
  }
  const m=await stageReadManifest(bucket,key,id);
  if(kind==='model'){
   const model=url.searchParams.get('model');stageCheck(/^[a-f0-9]{64}$/.test(model||''),'Invalid model ID');const modelKey=base+'models/'+model+'.json';
   const audit={model_certified:false,source_claims_verified:false,notice:'Provider claims and derived metrics only. Ceiling is not simulated; summed ownership is not duplication probability.'};
   if(request.method==='PUT'){const bytes=await stageBytes(request.body,STAGE_CAPS.manifest);stageCheck(await stageHash(bytes)===model,'Model hash mismatch');const metrics=stageMetrics(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),m,id);const created=await stageImmutable(bucket,modelKey,bytes,model,'application/json','showdown-stage-metrics/1');return json({archive:id,model,created,verified_readback:true,audit:{...audit,source:metrics.source}},200,headers);}
   const obj=await bucket.get(modelKey);stageCheck(obj,'Model not found',404);const bytes=await stageBytes(obj.body,STAGE_CAPS.manifest);stageCheck(await stageHash(bytes)===model,'Stored model integrity failure',409);const metrics=stageMetrics(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),m,id);return json({archive:id,model,metrics,audit:{...audit,source:metrics.source}},200,headers);
  }
  if(kind==='manifest'){
   const chunks=[];for(const p of m.partitions){const h=await bucket.head(base+p.file);chunks.push({index:p.captain_index,present:!!h,verified:!!h&&h.size===p.compressed_bytes&&h.customMetadata?.sha256===p.sha256});}
   return json({archive:id,manifest:m,chunks,complete:chunks.every(c=>c.verified),audit:{source:m.source,enumeration_verified:false,source_claims_verified:false,notice:'Complete means all declared chunks stored, not proof of exhaustive enumeration.'}},200,headers);
  }
  const index=url.searchParams.get('index');stageCheck(/^(0|[1-9]\d?)$/.test(index||''),'Invalid partition index');const p=m.partitions.find(p=>p.captain_index===Number(index));stageCheck(p,'Partition not found',404);
  if(request.method==='PUT'){const bytes=await stageBytes(request.body,STAGE_CAPS.chunk);await stageValidateChunk(bytes,p,m);const created=await stageImmutable(bucket,base+p.file,bytes,p.sha256,'application/octet-stream');return json({archive:id,index:Number(index),created,verified_readback:true,sha256:p.sha256},200,headers);}
  const obj=await bucket.get(base+p.file);stageCheck(obj,'Chunk not found',404);const bytes=await stageBytes(obj.body,STAGE_CAPS.chunk);stageCheck(bytes.length===p.compressed_bytes&&await stageHash(bytes)===p.sha256,'Stored chunk integrity failure',409);return new Response(bytes,{headers:{...headers,'Content-Type':'application/octet-stream','X-Stage-SHA256':p.sha256}});
 }catch(e){return json({error:e.status?e.message:'Invalid archive payload'},e.status||400,headers);}
}
