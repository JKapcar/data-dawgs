// Private weekly research library. This module cannot reach Bozo contest writes.
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
