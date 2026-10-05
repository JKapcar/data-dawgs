// Private drafts and explicitly published weekly research. No Bozo contest writes.
const key = {type:'string',pattern:'^[A-Za-z0-9_-]{1,80}$'};
const text = {type:'string',maxLength:1600};
const stamp = {type:'string',format:'date-time'};
const quote = {type:'object',additionalProperties:false,required:['line','odds','book','quoted_at'],properties:{line:{type:['number','null']},odds:{type:'integer'},book:text,quoted_at:stamp}};
const edge = {type:'object',additionalProperties:false,required:['value','unit','definition'],properties:{value:{type:'number'},unit:{type:'string',enum:['points','percentage_points','percent_ev','provider_defined']},definition:text}};
export const candidateSchema = {type:'object',additionalProperties:false,required:['id','event','sport','market','selection','status','reason'],properties:{
 id:key,event:text,sport:text,market:text,selection:text,kickoff:stamp,rank:{type:'integer',minimum:1,maximum:200},
 base:quote,alternate:quote,edge,adjusted_edge:edge,
 status:{type:'string',enum:['keep','downgrade','hold','scratch']},reason:text,screened_at:stamp,
 sources:{type:'array',maxItems:10,items:{type:'object',additionalProperties:false,required:['name','as_of','evidence'],properties:{name:text,as_of:stamp,evidence:text,weight:{type:'number',minimum:0,maximum:1},url:{type:'string',format:'uri'}}}},
 probability:{type:'object',additionalProperties:false,required:['value','basis'],properties:{value:{type:'number',minimum:0,maximum:1},basis:text}},
 worst_acceptable:text,result:{type:'string',enum:['pending','win','loss','push','void']},notes:text
}};
export function menuSchema(op){
 const common={week:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$',description:'Monday date for the menu week, Eastern Time calendar.'}};
 const properties=op==='list'?{}:op==='get'?common:{...common,expected_revision:{type:'integer',minimum:0},title:{type:'string',maxLength:120},candidates:{type:'array',minItems:1,maxItems:200,items:candidateSchema}};
 return {type:'object',additionalProperties:false,properties,required:Object.keys(properties).filter(k=>k!=='title')};
}
function fail(message,code=400){throw Object.assign(new Error(message),{status:code});}
// Same schema is enforced for browser, direct API and MCP callers.
function validate(value,s,path='arguments'){
 if(s.type){const types=Array.isArray(s.type)?s.type:[s.type];if(!types.some(t=>t==='null'?value===null:t==='array'?Array.isArray(value):t==='integer'?Number.isInteger(value):t==='number'?typeof value==='number'&&Number.isFinite(value):t==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):typeof value===t))fail(path+': invalid type');}
 if(s.enum&&!s.enum.includes(value))fail(path+': invalid value');
 if(typeof value==='string'){
  if(!value.trim()||value.length>(s.maxLength||1600))fail(path+': empty or too long');
  if(s.pattern&&!new RegExp(s.pattern).test(value))fail(path+': invalid format');
  if(s.format==='date-time'&&(!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value))))fail(path+': supply a timestamp with timezone');
  if(s.format==='uri'){try{if(new URL(value).protocol!=='https:')throw 0;}catch{fail(path+': HTTPS URL required');}}
 }
 if(typeof value==='number'&&((s.minimum!=null&&value<s.minimum)||(s.maximum!=null&&value>s.maximum)))fail(path+': outside bounds');
 if(Array.isArray(value)){if(value.length<(s.minItems||0)||value.length>(s.maxItems||200))fail(path+': too many or too few items');value.forEach((v,i)=>validate(v,s.items,path+'['+i+']'));}
 if(s.type==='object'){
  for(const k of s.required||[])if(value[k]===undefined)fail(path+'.'+k+': required');
  for(const k of Object.keys(value)){if(!Object.hasOwn(s.properties,k))fail(path+'.'+k+': unknown field');validate(value[k],s.properties[k],path+'.'+k);}
 }
}
export function quoteState(c,now=Date.now()){
 if(c.status==='scratch')return 'Scratched';
 if(c.kickoff&&Date.parse(c.kickoff)<=now)return 'Started / archived';
 if(c.status==='hold')return 'On hold';
 if(!c.alternate)return 'Needs alternate quote';
 if(c.alternate.odds < -500 || c.alternate.odds > -200)return 'Outside −200 to −500';
 if(!c.kickoff||!c.screened_at)return 'Needs screening / kickoff';
 if(now-Date.parse(c.alternate.quoted_at)>60*60*1000)return 'Recheck price';
 return 'Quoted in target band · verify contest rules';
}
export async function runMenu(op,args,caller,store,now=Date.now()){
 if(caller?.kind!=='user'||!caller.uid||!/^[A-Za-z0-9_-]{1,80}$/.test(caller.uid))fail('Sign in with a personal Data Dawgs account.',401);
 if(!['list','get','save'].includes(op))fail('Unknown menu operation',404);
 validate(args,menuSchema(op));
 if(args.week){const d=new Date(args.week+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==args.week||d.getUTCDay()!==1)fail('week must be a valid Monday date (YYYY-MM-DD).');}
 const path='/users/'+caller.uid+'/bozoMenus';
 const saved=await store.get(path,op==='save');
 const weeks=saved.data?.weeks||{};
 if(op==='list')return {weeks:Object.values(weeks).map(w=>({week:w.week,title:w.title,revision:w.revision,updated_at:w.updated_at,count:(w.candidates||[]).length})).sort((a,b)=>b.week.localeCompare(a.week))};
 const existing=weeks[args.week]||{week:args.week,title:'Week of '+args.week,revision:0,candidates:[]};
 const output=w=>({...w,candidates:(w.candidates||[]).map(c=>({...c,quote_state:quoteState(c,now)})),scope:'private account research; no contest picks submitted'});
 if(op==='get')return output(existing);
 if(args.expected_revision!==existing.revision)fail('Menu changed. Reload it before saving; nothing was overwritten.',409);
 const ids=new Set();
 for(const c of args.candidates){
  if(ids.has(c.id))fail('Duplicate candidate id: '+c.id);ids.add(c.id);
  for(const q of [c.base,c.alternate].filter(Boolean)){
   if(Math.abs(q.odds)<100||Math.abs(q.odds)>100000)fail(c.id+': invalid American odds');
   if(Date.parse(q.quoted_at)>now+300000)fail(c.id+': quote timestamp is in the future');
   if(c.market!=='moneyline'&&q.line===null)fail(c.id+': this market requires a line');
  }
  if(c.screened_at&&Date.parse(c.screened_at)>now+300000)fail(c.id+': screening timestamp is in the future');
 }
 const candidates=new Map((existing.candidates||[]).map(c=>[c.id,c]));
 for(const c of args.candidates)candidates.set(c.id,{...c,updated_at:new Date(now).toISOString()});
 if(candidates.size>200)fail('At most 200 candidates per week.');
 const week={...existing,title:args.title||existing.title,revision:existing.revision+1,updated_at:new Date(now).toISOString(),candidates:[...candidates.values()].sort((a,b)=>(a.rank||200)-(b.rank||200)||a.id.localeCompare(b.id))};
 const library={version:1,weeks:{...weeks,[args.week]:week}};
 if(Object.keys(library.weeks).length>104||new TextEncoder().encode(JSON.stringify(library)).byteLength>2000000)fail('Library limit reached (104 weeks / 2 MB). Export your archive.');
 if(!saved.etag)fail('Storage did not provide a revision lock. Nothing saved.',503);
 if(!await store.put(path,library,saved.etag))fail('Library changed while saving. Reload and retry.',409);
 return output(week);
}

// Publishing is explicit. The public store never reads a personal library.
const publicProperties={...candidateSchema.properties};
delete publicProperties.notes;
publicProperties.edge={...edge,description:'Data Dawgs authored/derived estimate only; never a raw paid-provider export.'};
publicProperties.sources={type:'array',maxItems:10,items:{type:'object',additionalProperties:false,required:['name','as_of'],properties:{name:text,as_of:stamp,weight:{type:'number',minimum:0,maximum:1},url:{type:'string',format:'uri'}}}};
const publicCandidateSchema={...candidateSchema,properties:publicProperties};
export function publicMenuSchema(publish=false){
 const week=menuSchema('get').properties.week;
 return publish?{...menuSchema('save'),properties:{...menuSchema('save').properties,candidates:{type:'array',minItems:1,maxItems:200,items:publicCandidateSchema}}}:{type:'object',additionalProperties:false,properties:{week},required:[]};
}
function validMenuWeek(week){if(!week)return;const d=new Date(week+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==week||d.getUTCDay()!==1)fail('week must be a valid Monday date.');}
export async function getPublicMenu(args,store,now=Date.now()){
 validate(args,publicMenuSchema());validMenuWeek(args.week);
 const weeks=(await store.get('/publishedBozoMenus')).data?.weeks||{};
 const keys=Object.keys(weeks).sort().reverse();const selected=args.week||keys[0];const w=weeks[selected];
 return {title:w?.title||'The Bozo Menu',week:selected||null,revision:w?.revision||0,published_at:w?.published_at||null,retrieved_at:new Date(now).toISOString(),status:w?'published':'unpublished',
 scope:'Public Data Dawgs research. Saved quotes, not guaranteed current offers. No contest picks submitted.',
 candidates:(w?.candidates||[]).map(c=>({...c,quote_state:quoteState(c,now)})),
 published_weeks:keys.map(week=>({week,title:weeks[week].title,revision:weeks[week].revision,published_at:weeks[week].published_at}))};
}
export async function publishMenu(args,caller,store,now=Date.now()){
 if(caller?.kind!=='user'||!caller.uid||caller.site_admin!==true)fail('Only the Data Dawgs publisher can publish the shared menu.',403);
 validate(args,publicMenuSchema(true));validMenuWeek(args.week);
 // Reuse private-row semantic validation without reading or writing a private account.
 const normalized=args.candidates.map(c=>({...c,...(c.sources?{sources:c.sources.map(s=>({...s,evidence:'Public source attribution'}))}:{})}));
 await runMenu('save',{...args,expected_revision:0,candidates:normalized},caller,{get:async()=>({data:null,etag:'validation'}),put:async()=>true},now);
 const path='/publishedBozoMenus',saved=await store.get(path,true),weeks=saved.data?.weeks||{},old=weeks[args.week];
 if((old?.revision||0)!==args.expected_revision)fail('Published menu changed. Read its revision and retry.',409);
 const published={week:args.week,title:args.title||'The Bozo Menu · '+args.week,revision:args.expected_revision+1,published_at:new Date(now).toISOString(),published_by:caller.uid,candidates:structuredClone(args.candidates)};
 const library={version:1,weeks:{...weeks,[args.week]:published}};
 if(Object.keys(library.weeks).length>104||new TextEncoder().encode(JSON.stringify(library)).byteLength>2000000)fail('Public archive limit reached (104 weeks / 2 MB).');
 if(!saved.etag)fail('Storage did not provide a revision lock.',503);
 if(!await store.put(path,library,saved.etag))fail('Public archive changed. Read its revision and retry.',409);
 return getPublicMenu({week:args.week},store,now);
}
export function renderPublicMenu(menu,format='html'){
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=s=>s?new Date(s).toLocaleString('en-US',{timeZone:'America/New_York',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET':'Not supplied';
 const quote=q=>q?`${q.line??'Moneyline'} at ${q.odds>0?'+':''}${q.odds} · ${q.book} · quoted ${date(q.quoted_at)}`:'Not supplied';
 const estimate=e=>e?`${e.value} ${e.unit.replaceAll('_',' ')} — ${e.definition}`:'Not supplied for sharing';
 const header=[menu.title,`Week beginning ${menu.week||'not yet published'} · revision ${menu.revision}`,`Published ${date(menu.published_at)} · retrieved ${date(menu.retrieved_at)}`,menu.scope,`${menu.candidates.length} candidates. Keep, downgrade, hold and scratch are screening decisions; scratched/held rows are not active recommendations.`];
 const sections=menu.candidates.map((c,i)=>({title:`${c.rank||i+1}. ${c.selection} — ${c.status}`,lines:[`${c.sport} · ${c.event} · ${c.market} · ${date(c.kickoff)}`,`Base bet: ${quote(c.base)}`,`Data Dawgs edge estimate: ${estimate(c.edge)}`,...(c.adjusted_edge?[`Adjusted edge (judgment): ${estimate(c.adjusted_edge)}`]:[]),`Alternate offer: ${quote(c.alternate)}`,`Quote status: ${c.quote_state}`,`Screen: ${c.reason} · checked ${date(c.screened_at)}`,...(c.probability?[`Estimated hit probability: ${(c.probability.value*100).toFixed(1)}% — ${c.probability.basis}`]:[]),...(c.worst_acceptable?[`Worst acceptable offer: ${c.worst_acceptable}`]:[]),...(c.sources||[]).map(s=>`Source: ${s.name} · ${date(s.as_of)}${s.weight!=null?' · weight '+Math.round(s.weight*100)+'%':''}${s.url?' · '+s.url:''}`),`Result: ${c.result||'pending'}`]}));
 if(format==='md')return '# '+header[0]+'\n\n'+header.slice(1).join('\n\n')+'\n\n'+sections.map(s=>'## '+s.title+'\n\n'+s.lines.map(l=>'- '+l.replace(/\n/g,' ')).join('\n')).join('\n\n');
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Bozo Menu · Data Dawgs</title><style>body{margin:auto;max-width:1100px;padding:24px;background:#17120e;color:#f5efe3;font:16px/1.6 system-ui}a{color:#ffb365}h1{font-size:38px}article{padding:20px;border:1px solid #624832;border-radius:12px;background:#231a13;overflow-wrap:anywhere}article p{margin:10px 0}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:18px}nav{display:flex;gap:16px;flex-wrap:wrap;margin:20px 0}</style></head><body><a href="https://datadawgs216.com/bozo.html#bozoMenu">Data Dawgs · Bozo</a><h1>'+escape(header[0])+'</h1>'+header.slice(1).map(l=>'<p>'+escape(l)+'</p>').join('')+'<nav><a href="/bozo/menu.md'+(menu.week?'?week='+menu.week:'')+'">Full menu for AI / text</a><a href="/bozo/menu.json'+(menu.week?'?week='+menu.week:'')+'">JSON</a><a href="/bozo/menu">Latest published</a></nav><nav>'+menu.published_weeks.map(w=>'<a href="?week='+w.week+'">'+escape(w.week)+'</a>').join('')+'</nav><main>'+sections.map(s=>'<article><h2>'+escape(s.title)+'</h2>'+s.lines.map(l=>'<p>'+escape(l)+'</p>').join('')+'</article>').join('')+'</main>'+(menu.status==='unpublished'?'<p>No menu has been published for this week.</p>':'')+'</body></html>';
}
