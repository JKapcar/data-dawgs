import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../fantasy-warroom.html',import.meta.url),'utf8');
function fn(name){const a=html.indexOf('function '+name+'(');let i=html.indexOf('{',a),depth=1,j=i+1;for(;depth;j++){if(html[j]==='{')depth++;if(html[j]==='}')depth--;}return html.slice(a,j);}
const els=new Proxy({}, {get(o,k){return o[k] ||= {innerHTML:'OLD PLAYER',textContent:'OLD SOURCE',classList:{add(){},toggle(){}},closest(){return this}};}});
const base={$:id=>els[id],state:{ref:{provider:'sleeper',id:'B'},league:{name:'League B'},teams:[{}]},LOADED:new Map(),mnTeam:'ALL',mnPaidPos:new Set(['QB']),mnPaidLab:'top',keyOf:(p,id)=>p+':'+id,paintDraftCapital(){},hz:()=> 'season',ddBoard:()=>null,stDefaultError:()=>'',mnMe:()=>null,teamMoney:()=>({}),renderWeeklyMoney:()=>false};
vm.createContext(base);
vm.runInContext(fn('clearMoneyCards')+';let moneyFilterKey=null;'+fn('syncMoneyFilters'),base);
let a=html.indexOf('function renderMoney(){'),b=html.indexOf('  const totals=',a);
vm.runInContext(html.slice(a,b)+'};renderMoney()',base);
assert.equal(els.mnBest.innerHTML,'');assert.equal(els.mnWorst.innerHTML,'');assert.match(els.mnBestNote.textContent,/League B/);
base.state={ref:{provider:'espn',id:'A'},teams:[{},{}]};base.LOADED.set('espn:A',{state:base.state});
vm.runInContext('syncMoneyFilters();mnTeam="1";mnPaidPos=new Set(["RB"]);',base);
base.state={ref:{provider:'sleeper',id:'B'},teams:[{},{}]};base.LOADED.set('sleeper:B',{state:base.state});vm.runInContext('syncMoneyFilters()',base);assert.equal(base.mnTeam,'ALL');assert.equal(base.mnPaidPos.size,6);
base.state=base.LOADED.get('espn:A').state;vm.runInContext('syncMoneyFilters()',base);assert.equal(base.mnTeam,'1');assert.deepEqual([...base.mnPaidPos],['RB']);
// Deferred network completion: latest selected league wins even if the first finishes last.
const pending={};const mk=id=>({ref:{provider:'sleeper',id},league:{name:id,settings:{}},settings:{},teams:[{name:id}],ddValues:{id},ddPicks:null});
Object.assign(base,{parseWarroomInput:id=>({provider:'sleeper',id}),window:{DDProviders:{parse:id=>({provider:'sleeper',id})}},document:{querySelectorAll:()=>[]},fetchLeague:id=>new Promise(resolve=>pending[id]=resolve),loadMV:async()=>{},loadDynastyMV:async()=>{},loadDD:async()=>{},loadDraftCapital:async()=>{},pickMyTeam:()=>0,rememberLeague(){},setLoaded(){},render(){},esc:x=>x,URL,location:{href:'https://example.test/'},history:{replaceState(){}},DD:null,DDPICKS:null,sim:null,tradeFilter:null});
a=html.indexOf('let leagueLoadGeneration=0;');b=html.indexOf('\n/* Restore a league',a);vm.runInContext(html.slice(a,b),base);
const first=vm.runInContext('connect("first")',base),second=vm.runInContext('connect("second")',base);
pending.second(mk('second'));assert.equal(await second,true);pending.first(mk('first'));assert.equal(await first,false);assert.equal(base.state.ref.id,'second');assert.equal(base.DD.id,'second');
// Display names can collide; account changes must be identified by immutable UID.
let session=Buffer.from(JSON.stringify({u:'alice',n:'Matt'})).toString('base64url')+'.synthetic';
base.window.DDAuth={me:()=>({name:'Matt'}),token:()=>session};base.atob=atob;
vm.runInContext(fn('wrAccountKey'),base);assert.equal(base.wrAccountKey(),'uid:alice');
session=Buffer.from(JSON.stringify({u:'bob',n:'Matt'})).toString('base64url')+'.synthetic';assert.equal(base.wrAccountKey(),'uid:bob');
// Parse every inline executable script after editing.
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){if(/application\/ld\+json/.test(m[1]))continue;new vm.Script(m[2]);}
console.log('War Room isolation: stale cards cleared; filters isolated/restored; late response rejected; inline scripts parse.');
