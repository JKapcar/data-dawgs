import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html = fs.readFileSync(new URL('../teamdraft.html', import.meta.url),'utf8');
const env = JSON.parse(fs.readFileSync(new URL('../data/draft-2026.json', import.meta.url)));
const elements = new Map();
const $ = id => {if(!elements.has(id)) elements.set(id,{innerHTML:'',textContent:'',querySelector:()=>null,replaceChildren(){this.innerHTML='';}});return elements.get(id);};
const context = vm.createContext({D:structuredClone(env.data), DATED:{built:env.built}, $, console,
 esc:String, n2:x=>Number(x).toFixed(2), sgn:x=>(x>0?'+':'')+Number(x).toFixed(2),
 sel:{d:new Set(),t:new Set()},selOwners:()=>new Set(),selEmpty:()=>true,selTeams:()=>[],oc:()=>'',ownerOf:()=>null,
 document:{hidden:false},spinning:false,mcRun:null,LAST_MC:{},spins:4,tieSpins:0,tally:{},
 buildGames(){},layout(){},renderAll(){},diagnostics(){},rules(){}});
function section(a,b){return html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));}
vm.runInContext(section('  function cards(){','  const REF ='),context);
vm.runInContext(section('  function ladder(){','  function matrix(){'),context);
// A fixture that deliberately reverses draft-day and current ranks catches frozen displays.
const names=context.D.draft_order;
for(const [i,n] of names.entries()){context.D.drafters[n].ew=60-i;context.D.drafters[n].projected=20+i;}
vm.runInContext('cards(); ladder();',context);
assert.ok($('tdCards').innerHTML.indexOf(names.at(-1)) < $('tdCards').innerHTML.indexOf(names[0]));
assert.ok($('tdCards').innerHTML.includes('<b>27.00</b><span>expected wins</span>'));
for(const t of Object.values(context.D.teams)) assert.ok($('tdLadder').innerHTML.includes(t.projected.toFixed(2)));
vm.runInContext(section('  let refreshing = false;','  async function load(){'),context);
context.fetch=async (url,opts)=>{assert.equal(opts.cache,'no-store');return {ok:true,json:async()=>env};};
await vm.runInContext('refreshData()',context);
assert.equal(context.D.drafters.Kap.projected,env.data.drafters.Kap.projected);
assert.equal(context.LAST_MC,null);
assert.match($('tdRefreshState').textContent,/Last checked/);
const previous=context.D;
context.fetch=async()=>{throw Error('offline');};
await vm.runInContext('refreshData()',context);
assert.equal(context.D,previous);
assert.match($('tdRefreshState').textContent,/Update unavailable/);
assert.ok(Math.abs(Object.values(env.data.drafters).reduce((s,t)=>s+t.projected,0)-272)<.01);
console.log('PASS: live ranking, expected-win displays, refresh, offline retention, and 272-win conservation');
