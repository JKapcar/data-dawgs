// Optional DOM integration test for the results-ledger panel. Set DDFS_JSDOM like
// test-dfs-workspace-ui.cjs. Worker transport is stubbed with the synthetic fixture.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require(process.env.DDFS_JSDOM||'jsdom');
const root=path.resolve(__dirname,'..'),fx=f=>fs.readFileSync(path.join(root,'tests/fixtures/dfs-ledger',f),'utf8');
const html=fs.readFileSync(root+'/dfs.html','utf8'),dom=new JSDOM(html,{url:'https://datadawgs216.com/dfs.html#standings',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
const errors=[],calls=[];w.addEventListener('error',e=>errors.push(e.error||e.message));
w.HTMLElement.prototype.scrollIntoView=function(){};w.URL.createObjectURL=()=>'blob:test';w.URL.revokeObjectURL=()=>{};
const ws=JSON.parse(fx('snapshot.json')),metas=JSON.parse(fx('contests.json'));
w.fetch=async(url,opts)=>{url=String(url);
 if(url.includes('/dk/contest?id=')){const id=url.split('=').pop(),m=metas[id];calls.push('dk:'+id);return m?{ok:true,json:async()=>({id:+id,name:m.name,startTime:'2026-09-07T17:00:00.0000000Z',entryFee:m.entry_fee,maxEntries:m.max_entries,maxEntriesPerUser:m.max_entries_per_user,payout:m.payout.map(r=>({fromPlace:r.from,toPlace:r.to,prize:r.prize}))})}:{ok:false,json:async()=>({error:'not found'})};}
 if(url.includes('/api/dfs/')){const op=url.split('/').pop(),a=JSON.parse(opts.body);calls.push(op);assert.equal(opts.headers['X-Bozo-Session'],'test-session');
  if(op==='list')return {ok:true,json:async()=>({workspaces:[{workspace_id:ws.id,revision:ws.revision,lineups:ws.lineups.length,updated_at:ws.updated_at}]})};
  if(op==='get'){assert.equal(a.include_results,true);return {ok:true,json:async()=>ws};}}
 return {ok:false,json:async()=>({})};
};
for(const f of ['dfs-lab-audit.js','dfs-lab-contests.js','dfs-pareto.js','dfs-ledger.js'])w.eval(fs.readFileSync(root+'/'+f,'utf8'));
for(const s of w.document.querySelectorAll('script'))if(!s.src&&!/text\/plain|application\/(?:ld\+)?json/i.test(s.type)){Object.defineProperty(w.document,'currentScript',{value:s,configurable:true});w.eval(s.textContent);}
w.eval(fs.readFileSync(root+'/dfs-ledger-ui.js','utf8'));
const el=id=>w.document.getElementById(id),tick=()=>new Promise(r=>setTimeout(r,30));
(async()=>{
 await tick();w.DDAuth.token=()=>'test-session';
 el('lgList').click();await tick();assert.equal(el('lgWs').value,'fixture-showdown');
 el('lgUser').value='ddtester';
 const files=['100000001','100000002','100000003'].map(id=>new w.File([fx('contest-standings-'+id+'.csv')],'contest-standings-'+id+'.csv',{type:'text/csv'}));
 Object.defineProperty(el('lgFiles'),'files',{value:files,configurable:true});
 let saved=null;w.HTMLAnchorElement.prototype.click=function(){saved=this.download;};
 el('lgBuild').click();for(let i=0;i<10&&!el('lgTab').querySelector('tbody tr');i++)await tick();
 const rows=[...el('lgTab').querySelectorAll('tbody tr')];
 assert.equal(rows.length,5,el('lgWarn').textContent);
 assert.deepEqual([...el('lgTab').querySelectorAll('thead th')].map(t=>t.textContent).slice(0,4),['Contest','CPT','FLEX','Salary']);
 assert.match(rows[0].textContent,/Fixture GPP \$20.*Chris Vale/);
 assert.match(el('lgNote').textContent,/3 joined.*\(before lock\)/);
 assert.match(el('lgWarn').textContent,/100000003/);
 assert.ok(calls.includes('dk:100000001')&&calls.includes('get'));
 el('lgCsv').click();assert.equal(saved,'fixture-showdown-audit.csv');
 el('lgKeep').click();assert.ok(w.localStorage.getItem('dd-dfs-ledger-v1:fixture-showdown'));
 assert.equal(errors.length,0,errors.map(String).join('\n'));
 console.log('DFS results ledger panel: list, build, audit table, CSV export, keep: PASS');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1;});
