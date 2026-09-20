import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../dawg-bot-worker.js',import.meta.url),'utf8').replace(/^import .*;$/m,'const BOZO_ESPN_TEAM_SEED = {};').replace('export default','const worker =');
const context=vm.createContext({console,Date,URL,Response,Request,Headers,TextEncoder,TextDecoder,crypto:globalThis.crypto,AbortController,setTimeout,clearTimeout});
vm.runInContext(source+`\nglobalThis.api={run:dfsRun,tools:MCP_TOOLS,engine:mcpDdfsRoot.DDFS,dupe:dfsModules.DDFSDupe,route:handleDfsWorkspace};\nfbGet=async(e,p)=>({data:e.rows[p]||null,etag:String(e.versions[p]||0)});fbPut=async(e,p,v,t)=>{if(String(e.versions[p]||0)!==t)return false;e.rows[p]=JSON.parse(JSON.stringify(v));e.versions[p]=(e.versions[p]||0)+1;return true;};fbDelete=async(e,p,t)=>{if(String(e.versions[p]||0)!==t)return false;delete e.rows[p];return true;};`,context);
const env={rows:{},versions:{}},caller={kind:'user',uid:'userA'},run=(op,args={},who=caller)=>context.api.run(op,args,env,who);
let checks=0;async function reject(op,args,re,who){await assert.rejects(run(op,args,who),re);checks++;}
assert.equal(context.api.dupe.ownFrac({own:.5}),.005);assert.equal(context.api.dupe.ownFrac({own:1}),.01);checks+=2;
const workspace_id='test-sd';let rev=1;
await reject('create',{workspace_id,site:'dk_showdown',source:'fixture',as_of:'2026-09-16'},/personal/,{kind:'shared'});
await run('create',{workspace_id,site:'dk_showdown',source:'fixture',as_of:'2026-09-16'});
await reject('get',{workspace_id},/not found/,{kind:'user',uid:'userB'});await reject('get',{workspace_id:'../userA'},/workspace_id/);
const players=Array.from({length:12},(_,i)=>({id:'p'+i,name:'Player '+i,pos:i%6===0?'QB':i%6===5?'K':i%2?'WR':'RB',team:i<6?'AAA':'BBB',opp:i<6?'BBB':'AAA',gid:'AAA-BBB',sal:5000+i*200,proj:8+i,own:50,cptOwn:100/12,cptSal:(5000+i*200)*1.5,dkId:String(1000+i),cptId:String(2000+i)}));
async function write(op,args={}){const r=await run(op,{workspace_id,expected_revision:rev,...args});rev=r.revision;return r;}
await write('players',{players});await reject('settings',{workspace_id,expected_revision:1,section:'solver',patch:{count:2}},/Revision conflict/);
await reject('settings',{workspace_id,expected_revision:rev,section:'solver',patch:{unknown:1}},/unsupported/);
await write('settings',{section:'solver',patch:{count:3}});let r=await write('solve');assert.equal(r.lineups,3);checks++;
let w=await run('get',{workspace_id,include_results:true});const direct=context.api.engine.solveLineups(players,{...w.settings.solver,site:w.site});assert.equal(JSON.stringify(w.lineups),JSON.stringify(direct.lineups));checks++;
const exp=await run('exposure',{workspace_id});assert.equal(exp.players.reduce((s,p)=>s+p.total,0),18);assert.equal(exp.players.reduce((s,p)=>s+p.captain,0),3);checks++;
const csv=await run('export',{workspace_id});assert.equal(csv.csv.split('\r\n').length,5);checks++;
await write('settings',{section:'simulation',patch:{sims:200,fieldSize:50,fieldSample:49,fieldMinSalary:0,payout:{kind:'flat',paidFrac:.4,alpha:1,rake:.15}}});r=await write('simulate');assert.equal(r.simulation.meta.fullField,true);assert.equal(r.simulation.perLineup.length,3);checks++;
r=await write('compare');assert.ok(r.comparison);checks++;
await reject('select',{workspace_id,expected_revision:rev,indices:[999]},/indices/);await write('select',{indices:[0,2]});w=await run('get',{workspace_id,include_results:true});assert.equal(w.simulation,null);assert.equal(w.lineups.length,2);checks++;
const up='Player,Pos,Team,Salary,Proj,CPT Salary,Total Own,CPT Own\nAlpha,QB,AAA,6000,20,9000,60%,20%\nBeta,WR,BBB,5000,10,7500,30%,5%';
r=await run('upload',{workspace_id,expected_revision:rev,csv:up,source:'fixture',as_of:'2026-09-16',commit:false});assert.equal(r.preview,true);assert.equal((await run('get',{workspace_id})).revision,rev);checks++;
await reject('players',{workspace_id,expected_revision:rev,players:[...players,players[0]]},/Duplicate/);
await write('sync',{players,lineups:w.lineups,settings:w.settings,source:'fixture',as_of:'2026-09-16'});
const pair=await Promise.allSettled([run('settings',{workspace_id,expected_revision:rev,section:'solver',patch:{count:2}}),run('settings',{workspace_id,expected_revision:rev,section:'solver',patch:{count:4}})]);assert.equal(pair.filter(p=>p.status==='fulfilled').length,1);checks++;
for(const t of context.api.tools.filter(t=>t.name.startsWith('dd_dfs_')&&t.name!=='dd_dfs_correlations')){assert.equal(t.catalog,'core');assert.ok(t.inputSchema);}
// REST uses the same account-scoped functions, and rejects malformed bodies.
vm.runInContext('sessionAuth=async(r)=>r.headers.get("X-Bozo-Session")==="fixture"?{uid:"userA"}:{err:"unauthorized",code:401};',context);
const url=new URL('https://worker.invalid/api/dfs/get');
let http=await context.api.route(new Request(url,{method:'POST',body:JSON.stringify({workspace_id})}),url,env,{});assert.equal(http.status,401);checks++;
http=await context.api.route(new Request(url,{method:'POST',headers:{'X-Bozo-Session':'fixture'},body:JSON.stringify({workspace_id})}),url,env,{});assert.equal(http.status,200);assert.equal((await http.json()).id,workspace_id);checks++;
http=await context.api.route(new Request(url,{method:'POST',headers:{'X-Bozo-Session':'fixture'},body:'{'}),url,env,{});assert.equal(http.status,400);checks++;
// Firebase removes empty arrays; defaults must survive a storage round-trip.
const row=env.rows['/users/userA/dfsWorkspaces/'+workspace_id];delete row.settings.solver.groups;delete row.lineups;
assert.equal((await run('get',{workspace_id})).lineups.length,0);checks++;
console.log('PASS',checks,'DFS checks;',context.api.tools.length,'tools;',context.api.tools.filter(t=>t.catalog==='core').length,'core');
// Classic settings and 30k score-tail mode persist through the authenticated boundary.
const classicId='test-classic';await run('create',{workspace_id:classicId,site:'dk_classic',source:'Synthetic tests',as_of:'2026-09-20'});
let cw=await run('get',{workspace_id:classicId});assert.equal(cw.settings.solver.maxPerTeam,4);assert.equal(cw.settings.solver.uniques,3);assert.equal(cw.settings.solver.stack.qbMin,2);
const cp=[['QB','A','B'],['RB','A','B'],['RB','C','D'],['WR','A','B'],['WR','A','B'],['WR','B','A'],['TE','C','D'],['RB','B','A'],['DST','C','D']].map(([pos,team,opp],i)=>({id:String(100+i),dkId:String(100+i),name:'Synthetic Classic '+i,pos,team,opp,gid:[team,opp].sort().join('@'),sal:5500,proj:15,ceil:25,own:10}));
let cr=await run('players',{workspace_id:classicId,expected_revision:1,players:cp});assert.equal(cr.audit.missing_projections.length,0);
cr=await run('settings',{workspace_id:classicId,expected_revision:cr.revision,section:'solver',patch:{count:1,acoCap:90}});
cr=await run('solve',{workspace_id:classicId,expected_revision:cr.revision});assert.equal(cr.lineups,1);
cr=await run('settings',{workspace_id:classicId,expected_revision:cr.revision,section:'simulation',patch:{mode:'score_tail',sims:30000,seed:216}});
cr=await run('simulate',{workspace_id:classicId,expected_revision:cr.revision});assert.equal(cr.simulation.meta.sims,30000);assert.equal(cr.simulation.perLineup[0].aco,90);
await reject('compare',{workspace_id:classicId,expected_revision:cr.revision},/Score tails/);
const ce=await run('export',{workspace_id:classicId});assert.match(ce.csv.split('\r\n')[1],/^\d+(,\d+){8}$/);
cr=await run('settings',{workspace_id:classicId,expected_revision:cr.revision,section:'solver',patch:{acoCap:89}});
cr=await run('solve',{workspace_id:classicId,expected_revision:cr.revision});assert.equal(cr.lineups,0);assert.ok(cr.compute.infeasible);
console.log('PASS Classic workspace revision/audit, weighted solve, hard ACO, score-tail settings/compute and numeric export.');
