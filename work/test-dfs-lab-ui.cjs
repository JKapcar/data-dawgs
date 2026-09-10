// Optional DOM integration test. Install jsdom into a temporary directory and
// set DDFS_JSDOM to that module's absolute path. Worker transport is stubbed;
// the production engine, parser, chart and UI handlers run unchanged. Actual
// pointer interaction and deployment freshness are checked in the browser.
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require(process.env.DDFS_JSDOM||'jsdom');
const root=require('node:path').resolve(__dirname,'..');
const html=fs.readFileSync(root+'/dfs.html','utf8'),dom=new JSDOM(html,{url:'https://datadawgs216.com/dfs.html#exposure',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
const errors=[];w.addEventListener('error',e=>{errors.push(e.error||e.message);});
w.HTMLElement.prototype.scrollIntoView=function(){};w.SVGElement.prototype.getScreenCTM=function(){return null;};w.fetch=async()=>({ok:false,json:async()=>({}),text:async()=>''});w.URL.createObjectURL=()=> 'blob:test';
Object.defineProperty(w.crypto,'subtle',{value:require('node:crypto').webcrypto.subtle});
Object.defineProperty(w.document.getElementById('rarityChart'),'clientWidth',{value:360});
const A=require(root+'/dfs-lab-audit.js'),P=require(root+'/dfs-pareto.js'),D=require(root+'/work/dfs-engine.js').DDFS;
w.Worker=class {constructor(url){this.url=url;}terminate(){this.stopped=true;}postMessage(d){setTimeout(()=>{try{const r=this.url.startsWith('dfs-pareto')?P.generate(d.players,d.cfg):D.simulate(d.players,d.lineups,d.cfg);if(this.url.startsWith('dfs-pareto'))r.audit=A.reconcile(d.players,d.cfg,r);if(!this.stopped)this.onmessage({data:{type:'done',result:r}});}catch(e){errors.push(e);this.onerror(e);}},0);}};
for(const file of ['dfs-lab-audit.js','dfs-lab-contests.js','dfs-pareto.js'])w.eval(fs.readFileSync(root+'/'+file,'utf8'));
for(const script of w.document.querySelectorAll('script'))if(!script.src&&!/text\/plain|application\/(?:ld\+)?json/i.test(script.type)){Object.defineProperty(w.document,'currentScript',{value:script,configurable:true});w.eval(script.textContent);}

const tick=()=>new Promise(r=>setTimeout(r,10)),el=id=>w.document.getElementById(id),change=(id,value)=>{el(id).value=value;el(id).dispatchEvent(new w.Event('change',{bubbles:true}));};
const projs=[.3,8,12,11,5,7,20,16,21,14,8,6];
const csv='Name,Team,Position,Salary,Projection,Total Own%,CPT Own%\n'+projs.map((p,i)=>`Synthetic ${i},${i<6?'AAA':'BBB'},${['QB','RB','WR','TE','K','DST'][i%6]},7000,${p},${i?54.5:.5},${i?100/11:0}`).join('\n');
if(process.argv[2])fs.writeFileSync(process.argv[2],csv);
(async()=>{
 await tick();
 el('salPaste').value=csv;el('salGo').click();await tick();
 el('rarityGo').click();await tick();
 assert.match(el('labAuditNote').textContent,/Max-projection check: PASS/);
 assert.match(el('rarityNote').textContent,/Exact frontier over every legal lineup/);
 change('labMinSal','43000');
 assert.match(el('labAuditNote').textContent,/PENDING/);
 assert.doesNotMatch(el('rarityNote').textContent,/Exact frontier over every legal lineup/);
 assert.match(el('rarityState').textContent,/Previous pool/);
 change('labMinSal','44000');
 assert.equal(el('paretoSvg').getAttribute('viewBox'),'0 0 360 380');
 change('labWorlds','1600');change('labOpponents','2000');el('paretoSim').click();await tick();
 assert.equal(w.document.querySelectorAll('button[data-lab-goal]').length,4,el('labRecommendations').textContent);
 w.document.querySelector('[data-lab-goal="milly"]').click();
 assert.match(el('rarityDetail').textContent,/Conservative top-1% share/);
 assert.match(el('rarityDetail').textContent,/upper 95% estimate/);
 assert.doesNotMatch(el('rarityDetail').textContent,/denominator here is 1\./);
 w.document.querySelector('[data-lab-goal="cash"]').click();
 assert.match(el('rarityDetail').textContent,/What this lineup needs/);assert.match(el('rarityDetail').textContent,/held-out worlds/);
 assert.match(el('rarityDetail').textContent,/Core product/);assert.equal(el('labTarget').value,'cash');
 change('labContest','custom');assert.equal(el('labCustomWrap').hidden,false);
 change('labCustomField','235');assert.equal(el('labCustomField').value,'235');
 assert.match(el('labRecommendations').textContent,/Run the comparison/);
 change('labPaidPlaces','100');
 assert.ok(errors.length===0,errors.map(String).join('\n'));
 console.log('DOM flow: import → source audit → stale-rule gate → 360px chart → four contests → conservative GPP and cash inspection → custom-size invalidation: PASS');
 dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
