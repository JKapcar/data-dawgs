// Synthetic jsdom integration: real page handlers/engine, stubbed Worker transport.
// DDFS_JSDOM selects the repository-pinned external jsdom installation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require(process.env.DDFS_JSDOM||'jsdom');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(root+'/dfs.html','utf8');
const dom=new JSDOM(html,{url:'https://datadawgs216.com/dfs.html?resume=1#sim',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
const errors=[];w.addEventListener('error',e=>errors.push(e.error||e.message));
w.HTMLElement.prototype.scrollIntoView=function(){};w.SVGElement.prototype.getScreenCTM=()=>null;
w.fetch=async()=>({ok:false,json:async()=>({}),text:async()=>''});w.URL.createObjectURL=()=> 'blob:test';
Object.defineProperty(w.crypto,'subtle',{value:require('node:crypto').webcrypto.subtle});
const E=require('./dfs-engine.js').DDFS;
let partial=false,lastInput,lastOutput;
w.Worker=class{terminate(){}postMessage(d){lastInput=d;setTimeout(()=>{
 try{const l=d.lineups[0],cfg={...d.cfg,sims:200,fieldSize:partial?10000:10,fieldSample:9,entryFee:10,payout:{kind:'table',rows:[{from:1,to:1,prize:80}]},opponentLineups:Array.from({length:9},()=>l)};
 lastOutput=E.simulate(d.players,d.lineups,cfg);this.onmessage({data:{type:'done',result:lastOutput}});
 }catch(e){errors.push(e);this.onmessage({data:{type:'error',message:e.message}});}
 },0);}};
for(const file of ['dfs-lab-audit.js','dfs-lab-contests.js','dfs-pareto.js'])w.eval(fs.readFileSync(root+'/'+file,'utf8'));
for(const script of w.document.querySelectorAll('script'))if(!script.src&&!/text\/plain|application\/(?:ld\+)?json/i.test(script.type)){
 Object.defineProperty(w.document,'currentScript',{value:script,configurable:true});
 w.eval(script.textContent.replace('function runSim() {','window.payoutTestAccess=()=>({S,runSim}); function runSim() {'));
}
const sleep=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
 await sleep();const {S}=w.payoutTestAccess();
 S.site='dk_showdown';S.players=['QB','WR','RB','TE','K','DST'].map((pos,i)=>({name:'Synthetic '+i,pos,team:i<3?'AAA':'BBB',opp:i<3?'BBB':'AAA',gid:'AAA@BBB',sal:5000,proj:10+i,own:60,flexOwn:60,cptOwn:20}));
 S.lineups=[{ids:[0,1,2,3,4,5],cpt:0,proj:80,sal:32500}];
 for(const sampled of [false,true]){
  partial=sampled;lastOutput=null;w.document.getElementById('simGo').click();
  for(let i=0;i<100&&!lastOutput;i++)await sleep();assert.ok(lastOutput,'standard button completed');
  assert.ok(lastInput.lineups[0].eDupes>0,'standard caller supplies positive prior');
  const row=lastOutput.perLineup[0],table=w.document.getElementById('simTab').textContent,cards=w.document.getElementById('luList').textContent;
  assert.match(table,/Modelled EV/);assert.doesNotMatch(table,/dupe-adj/);
  if(sampled){assert.equal(row.evAdj,null);assert.match(table,/Unavailable/);assert.match(cards,/EV unavailable; Top-10 proxy rank/);}
  else{assert.equal(row.ev,8);assert.equal(row.evAdj,8);assert.match(table,/\$8\.00/);assert.match(cards,/\$8\.00 modelled EV/);}
 }
 assert.deepEqual(errors,[]);console.log('PASS: standard button -> positive prior -> engine -> table/cards; complete $8 settlement and sampled unavailable EV/Top-10 proxy. Worker transport stubbed; no browser/network certification.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>dom.window.close());
