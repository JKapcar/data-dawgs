import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),B=require('../dfs-builder.js');
const source=fs.readFileSync(new URL('../dawg-bot-worker.js',import.meta.url),'utf8').replace(/^import .*;$/m,'const BOZO_ESPN_TEAM_SEED = {};').replace('export default','const worker =');
const context=vm.createContext({console,Date,URL,Response,Request,Headers,TextEncoder,TextDecoder,crypto:globalThis.crypto,AbortController,setTimeout,clearTimeout});
vm.runInContext(source+`\nglobalThis.api={run:dfsRun,tools:MCP_TOOLS,route:handleDfsWorkspace};fbGet=async(e,p)=>({data:e.rows[p]||null,etag:String(e.versions[p]||0)});fbPut=async(e,p,v,t)=>{if(String(e.versions[p]||0)!==t)return false;e.rows[p]=JSON.parse(JSON.stringify(v));e.versions[p]=(e.versions[p]||0)+1;return true;};`,context);
const env={rows:{},versions:{}},caller={kind:'user',uid:'userA'},run=(op,args={},who=caller)=>context.api.run(op,args,env,who),clone=x=>JSON.parse(JSON.stringify(x));
const i=B.inspect('Player,DKPos,Team,Opp,DKSalary,DKProj,SmallField,LargeField\nSynthetic A,QB,AAA,BBB,6000,20,0%,30%\nSynthetic B,RB,BBB,AAA,5000,18,,20%'),pool=B.importPool(i,{...i.defaults,filename:'synthetic.csv'}),draft={version:1,pool,roster:[0,null,null,null,null,null,null,null,null],preset:'small',settings:{ownershipSource:'small',fieldSize:100,paidFraction:.2}};
const id='shared-manual',args={workspace_id:id,expected_revision:0,draft};let checks=0;
async function reject(op,a,re,who){await assert.rejects(run(op,a,who),re);checks++;}
await reject('draft',args,/personal/,{kind:'shared'});await reject('draft',{...args,uid:'userB'},/unsupported/);await reject('draft',{...args,workspace_id:'../userB'},/workspace_id/);
let r=await run('draft',args);assert.equal(r.revision,1);checks++;
await reject('get',{workspace_id:id},/not found/,{kind:'user',uid:'userB'});await reject('draft',{...args,expected_revision:1},/Revision conflict/,{kind:'user',uid:'userB'});await reject('draft',args,/Revision conflict/);
let w=await run('get',{workspace_id:id});assert.equal(w.draft.pool.players[0].own,0);assert.equal(w.draft.pool.players[1].own,null);assert.equal(w.draft.pool.source.asOf,null);assert.equal(w.draft.pool.filename,'synthetic.csv');assert.equal(w.draft.roster[0],0);assert.equal(env.rows['/users/userA/dfsWorkspaces/'+id].builder.pool.players,undefined);checks+=6;
// The AI edits the exact draft returned by get. Browser load receives that revision/state.
const edit=clone(w.draft);edit.roster[1]=1;edit.preset='large';edit.settings.ownershipSource='large';edit.settings.fieldSize=10000;
r=await run('draft',{workspace_id:id,expected_revision:1,draft:edit});w=await run('get',{workspace_id:id});assert.equal(w.revision,2);assert.equal(w.draft.roster[1],1);assert.equal(w.draft.pool.players[0].own,30);assert.equal(w.players[0].own,30);assert.equal(w.draft.settings.fieldSize,10000);checks+=5;
const race=await Promise.allSettled([run('draft',{workspace_id:id,expected_revision:2,draft:edit}),run('draft',{workspace_id:id,expected_revision:2,draft:edit})]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);checks++;
const row=env.rows['/users/userA/dfsWorkspaces/'+id];row.builder.rosterIds={0:row.players[0].id};w=await run('get',{workspace_id:id});assert.equal(w.draft.roster.length,9);assert.equal(w.draft.roster[1],null);delete row.builder.rosterIds;assert.equal((await run('get',{workspace_id:id})).draft.roster.every(x=>x===null),true);checks+=3;
const bad=clone(edit);bad.roster[1]=0;await reject('draft',{workspace_id:id,expected_revision:3,draft:bad},/duplicate/);bad.roster[1]=null;bad.settings.paidFraction=2;await reject('draft',{workspace_id:id,expected_revision:3,draft:bad},/paidFraction/);
await run('draft',{...args,workspace_id:'separate'});assert.equal((await run('get',{workspace_id:id})).revision,3);checks++;
const tool=context.api.tools.find(t=>t.name==='dd_dfs_draft');assert.equal(tool.readOnlyHint,false);assert.equal(tool.inputSchema.properties.expected_revision.minimum,0);assert.equal((await run('schema')).draft_schema.version,1);checks+=3;
vm.runInContext('sessionAuth=async(r)=>r.headers.get("X-Bozo-Session")==="fixture"?{uid:"userA"}:{err:"unauthorized",code:401};',context);
const url=new URL('https://worker.invalid/api/dfs/draft');let http=await context.api.route(new Request(url,{method:'POST',body:JSON.stringify({...args,expected_revision:3})}),url,env,{});assert.equal(http.status,401);checks++;
http=await context.api.route(new Request(url,{method:'POST',headers:{'X-Bozo-Session':'fixture'},body:JSON.stringify({...args,expected_revision:1})}),url,env,{});assert.equal(http.status,400);assert.match((await http.json()).error,/Revision conflict/);checks++;
console.log('PASS',checks,'shared draft checks: manual/AI round-trip, account isolation, authenticated REST, stale/concurrent writes, sparse storage, strict schema.');
