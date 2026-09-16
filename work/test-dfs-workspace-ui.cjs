// Optional DOM integration test. Install jsdom into a temporary directory and
// set DDFS_JSDOM to that module's absolute path. Worker transport is stubbed;
// the production engine, parser, chart and UI handlers run unchanged. Actual
// pointer interaction and deployment freshness are checked in the browser.
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require(process.env.DDFS_JSDOM||'jsdom');
const root=require('node:path').resolve(__dirname,'..');
const html=fs.readFileSync(root+'/dfs.html','utf8'),dom=new JSDOM(html,{url:'https://datadawgs216.com/dfs.html#exposure',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
const calls=[];let remote;
const errors=[];w.addEventListener('error',e=>{errors.push(e.error||e.message);});
w.HTMLElement.prototype.scrollIntoView=function(){};w.SVGElement.prototype.getScreenCTM=function(){return null;};w.fetch=async()=>({ok:false,json:async()=>({}),text:async()=>''});w.URL.createObjectURL=()=> 'blob:test';
Object.defineProperty(w.crypto,'subtle',{value:require('node:crypto').webcrypto.subtle});
Object.defineProperty(w.document.getElementById('rarityChart'),'clientWidth',{value:360});
const A=require(root+'/dfs-lab-audit.js'),P=require(root+'/dfs-pareto.js'),D=require(root+'/work/dfs-engine.js').DDFS;
w.Worker=class {constructor(url){this.url=url;}terminate(){this.stopped=true;}postMessage(d){setTimeout(()=>{try{const r=this.url.startsWith('dfs-pareto')?P.generate(d.players,d.cfg):D.simulate(d.players,d.lineups,d.cfg);if(this.url.startsWith('dfs-pareto'))r.audit=A.reconcile(d.players,d.cfg,r);if(!this.stopped)this.onmessage({data:{type:'done',result:r}});}catch(e){errors.push(e);this.onerror(e);}},0);}};
for(const file of ['dfs-lab-audit.js','dfs-lab-contests.js','dfs-pareto.js'])w.eval(fs.readFileSync(root+'/'+file,'utf8'));
for(const script of w.document.querySelectorAll('script'))if(!script.src&&!/text\/plain|application\/(?:ld\+)?json/i.test(script.type)){Object.defineProperty(w.document,'currentScript',{value:script,configurable:true});w.eval(script.textContent);}


const baseFetch=w.fetch;w.fetch=async(url,opts)=>{
 if(!String(url).includes('/api/dfs/'))return baseFetch(url,opts);
 const op=String(url).split('/').pop(),a=JSON.parse(opts.body);calls.push({op,a,headers:opts.headers});
 if(op==='create')return {ok:true,json:async()=>({revision:1})};
 if(op==='sync'){remote={id:a.workspace_id,site:'dk_showdown',players:a.players,settings:a.settings,lineups:a.lineups,total_lineups:a.lineups.length,source:a.source,as_of:a.as_of,revision:2};return {ok:true,json:async()=>({revision:2})};}
 if(op==='get')return {ok:true,json:async()=>remote};
 if(op==='list')return {ok:true,json:async()=>({workspaces:[]})};
 throw Error('unexpected op');
};
const tick=()=>new Promise(r=>setTimeout(r,30)),el=id=>w.document.getElementById(id);
(async()=>{
 await tick();w.DDAuth.token=()=> 'test-session';
 const csv='Name,Team,Position,Salary,Projection,CPT Salary,Total Own%,CPT Own%\n'+Array.from({length:12},(_,i)=>`Synthetic ${i},${i<6?'AAA':'BBB'},${['QB','RB','WR','TE','K','DST'][i%6]},6000,${10+i},9000,50,8`).join('\n');
 Object.defineProperty(el('salFile'),'files',{value:[new w.File([csv],'fixture.csv',{type:'text/csv'})],configurable:true});el('salFile').dispatchEvent(new w.Event('change',{bubbles:true}));await tick();await tick();
 el('dfsCloudSave').click();await tick();await tick();
 assert.equal(calls[0].op,'create');assert.equal(calls[1].op,'sync');assert.equal(calls[1].a.players.length,12);assert.equal(calls[1].a.settings.solver.timeLimitMs,5000);assert.equal(calls[1].headers['X-Bozo-Session'],'test-session');assert.match(el('dfsCloudNote').textContent,/Saved privately/);
 remote.players[0].proj=99;el('dfsCloudLoad').click();await tick();await tick();assert.match(el('dfsCloudNote').textContent,/Loaded/);await new Promise(r=>setTimeout(r,300));
 const state=JSON.parse(w.localStorage.getItem('dd-dfs-v1'));assert.equal(state.players[0].proj,99);assert.ok(w.localStorage.getItem('dd-dfs-before-cloud-load'));
 assert.equal(errors.length,0,errors.map(String).join('\n'));console.log('DFS browser private save/load, auth header, revision and local backup: PASS');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1;});
