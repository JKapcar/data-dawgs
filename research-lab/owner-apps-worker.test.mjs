import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHmac,createHash} from 'node:crypto';import {SOURCE_SHA} from './development-data.mjs';import {buildWorker} from './build-worker.mjs';import {initialState} from './worker-core.mjs';import {encodeEnvelope} from './exact-store.mjs';
const require=createRequire(path.join(process.env.DD_NODE_MODULES,'resolver.cjs'));const {Miniflare}=require('miniflare');
test('real packaged MCP authenticates existing credentials, discovers only opted-in tools and preserves Bozo',async()=>{const directory=mkdtempSync(path.join(os.tmpdir(),'dd-owner-mcp-'));let mf;try{buildWorker(directory);const pepper='synthetic-pepper',token='u_synthetic-personal',other='u_other-personal',uid='u_owner';let revoked=false,version=0,writes=0;const grant={owner:uid,enabled:true,expiresAt:0,mode:'until_revoked',version:1};const db=new Map([['/privatePounds/'+uid,{owner_uid:uid,payload:JSON.stringify({revision:0,updated_at:null,agents:[],tasks:[],messages:[],contexts:[],activity:[],receipts:[]})}],['/researchLab/v1/tenants/test',encodeEnvelope({version:1,access:{users:{[uid]:{owner:true,enabled:true,capabilities:['research:read']}}},state:initialState(),inputs:{}})]]);
 mf=new Miniflare({modules:true,modulesRoot:directory,scriptPath:path.join(directory,'worker.mjs'),compatibilityDate:'2026-07-30',bindings:{RESEARCH_OWNER_UID:uid,RESEARCH_UPLOAD_TENANT:'test',RESEARCH_LAB_ENABLED:'true',DAWG_POUND_ENABLED:'true',BOZO_PEPPER:pepper,DAWG_PASS:'synthetic-shared',FB_SECRET:'synthetic'},outboundService:async req=>{const p=new URL(req.url).pathname.replace(/\.json$/,'');if(p==='/users')return Response.json({[uid]:{name:'Synthetic Owner',mcpToken:revoked?'revoked':createHmac('sha256',pepper).update('mcp|'+token).digest('base64url')},u_other:{name:'Other',mcpToken:createHmac('sha256',pepper).update('mcp|'+other).digest('base64url')}});assert.ok(db.has(p),'unexpected private path '+p);if(req.method==='PUT'){assert.equal(req.headers.get('if-match'),'"'+version+'"');const next=await req.json();db.set(p,next);version++;writes++;return Response.json(next);}assert.equal(req.method,'GET');return Response.json(db.get(p),{headers:{ETag:'"'+version+'"'}});}});
 const rpc=async(method,params={},credential=token,catalog='core')=>{const response=await mf.dispatchFetch('https://test/mcp/'+catalog+'/'+credential,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return {status:response.status,body:await response.json()};};
 let list=(await rpc('tools/list')).body.result.tools;assert.ok(list.some(t=>t.name==='dd_submit_bozo_leg'));assert.ok(!list.some(t=>t.name.startsWith('dd_owner_')));assert.equal((await rpc('tools/call',{name:'dd_owner_pound_read',arguments:{}})).body.result.isError,true);db.get('/privatePounds/'+uid).ownerConnector=grant;db.get('/researchLab/v1/tenants/test').ownerConnector=grant;
 for(const catalog of ['core','full']){list=(await rpc('tools/list',{},token,catalog)).body.result.tools;assert.equal(list.filter(t=>t.name.startsWith('dd_owner_')).length,4);assert.ok(list.filter(t=>t.name.startsWith('dd_owner_')).every(t=>t.inputSchema.type==='object'));}
 for(const credential of [other,'synthetic-shared']){assert.ok(!(await rpc('tools/list',{},credential)).body.result.tools.some(t=>t.name.startsWith('dd_owner_')));assert.equal((await rpc('tools/call',{name:'dd_owner_pound_read',arguments:{}},credential)).body.result.isError,true);}
 const saved=await rpc('tools/call',{name:'dd_owner_bdb_write',arguments:{type:'hypothesis',key:'packaged1',payload:{title:'Synthetic hypothesis',method:'Review measurement'}}});assert.ok(!saved.body.result.isError,JSON.stringify(saved));assert.equal(writes,1);db.get('/researchLab/v1/tenants/test').ownerConnector={...grant,enabled:false};assert.equal((await rpc('tools/call',{name:'dd_owner_bdb_read',arguments:{}})).body.result.isError,true);assert.equal((await mf.dispatchFetch('https://test/owner-apps/v1')).status,401);revoked=true;assert.equal((await rpc('tools/list')).status,403);
 }finally{await mf?.dispose();const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(resolved,{recursive:true,force:true});}});

// Shared synthetic rig for the PR 1 discovery and boundary proofs. Every credential here is
// invented; the outbound service is the only "database" and it refuses unexpected paths.
async function boot({grants=true,dataBindings={}}={}){const directory=mkdtempSync(path.join(os.tmpdir(),'dd-owner-mcp-'));buildWorker(directory);const pepper='synthetic-pepper',token='u_synthetic-personal',other='u_other-personal',uid='u_owner';const state={version:0,writes:0,reads:[]};const grant={owner:uid,enabled:true,expiresAt:0,mode:'until_revoked',version:1};const db=new Map([['/privatePounds/'+uid,{owner_uid:uid,payload:JSON.stringify({revision:0,updated_at:null,agents:[],tasks:[],messages:[],contexts:[],activity:[],receipts:[]}),...(grants?{ownerConnector:grant}:{})}],['/researchLab/v1/tenants/test',{...encodeEnvelope({version:1,access:{users:{[uid]:{owner:true,enabled:true,capabilities:['research:read']}}},state:initialState(),inputs:{}}),...(grants?{ownerConnector:grant}:{})}]]);
 const mf=new Miniflare({modules:true,modulesRoot:directory,scriptPath:path.join(directory,'worker.mjs'),compatibilityDate:'2026-07-30',r2Buckets:['RESEARCH_UPLOADS'],bindings:{RESEARCH_OWNER_UID:uid,RESEARCH_UPLOAD_TENANT:'test',RESEARCH_LAB_ENABLED:'true',RESEARCH_UPLOAD_ENABLED:'true',DAWG_POUND_ENABLED:'true',BOZO_PEPPER:pepper,DAWG_PASS:'synthetic-shared',FB_SECRET:'synthetic',...dataBindings},outboundService:async req=>{const p=new URL(req.url).pathname.replace(/\.json$/,'');state.reads.push(p);if(p==='/users')return Response.json({[uid]:{name:'Synthetic Owner',mcpToken:createHmac('sha256',pepper).update('mcp|'+token).digest('base64url'),mcpTokens:{unlisted_client:{hash:createHmac('sha256',pepper).update('mcp|u_synthetic-unlisted').digest('base64url')}}},u_other:{name:'Other',mcpToken:createHmac('sha256',pepper).update('mcp|'+other).digest('base64url')}});if(p.startsWith('/users/'))return Response.json(null);assert.ok(db.has(p),'unexpected private path '+p);if(req.method==='PUT'){assert.equal(req.headers.get('if-match'),'"'+state.version+'"');const next=await req.json();db.set(p,next);state.version++;state.writes++;return Response.json(next);}assert.equal(req.method,'GET');return Response.json(db.get(p),{headers:{ETag:'"'+state.version+'"'}});}});
 const rpc=async(method,params={},{credential=token,catalog='full',header=false}={})=>{const response=await mf.dispatchFetch('https://test/mcp/'+catalog+(header?'':'/'+credential),{method:'POST',headers:{'Content-Type':'application/json',...(header?{Authorization:'Bearer '+credential}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return {status:response.status,body:await response.json()};};
 const close=async()=>{await mf.dispose();const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(resolved,{recursive:true,force:true});};
 return {mf,rpc,db,state,token,other,uid,grant,close};}
const callText=r=>JSON.parse(r.body.result.content[0].text);
import {v3Fixture} from './development-v3-fixture.mjs';
test('packaged v3 compressed partitions preserve owner auth, pagination and revocation',async()=>{
 const f=v3Fixture({policy:'all-position-development-v1',seasonType:'POST',position:'QB',draftYear:'2024'}),w=await boot({dataBindings:{RESEARCH_DEVELOPMENT_DATA_ENABLED:'true',RESEARCH_DEVELOPMENT_MANIFEST_SHA:f.env.RESEARCH_DEVELOPMENT_MANIFEST_SHA}});
 try{
  const bucket=await w.mf.getR2Bucket('RESEARCH_UPLOADS');
  for(const [name,bytes] of f.objects)await bucket.put('development/'+w.uid+'/test/'+SOURCE_SHA+'/'+name,bytes);
  const args={op:'rows',table:'game_tracking',selector:f.selector,artifact:f.descriptor.sha256};
  for(const catalog of ['core','full']){
   assert.ok((await w.rpc('tools/list',{},{catalog})).body.result.tools.some(t=>t.name==='dd_owner_bdb_data'));
   const discovery=callText(await w.rpc('tools/call',{name:'dd_owner_bdb_data',arguments:{op:'lookup',table:'game_tracking',selector:{}}},{catalog}));assert.deepEqual(discovery.children,[{season:'2023'}]);
   const first=callText(await w.rpc('tools/call',{name:'dd_owner_bdb_data',arguments:args},{catalog}));assert.equal(first.rows.length,100);assert.equal(first.nextOffset,100);assert.ok(first.rows.every(r=>r.nfl_id==='wr'));
   const last=callText(await w.rpc('tools/call',{name:'dd_owner_bdb_data',arguments:{...args,offset:200}},{catalog}));assert.equal(last.rows.length,1);assert.equal(last.nextOffset,null);
   const exact=callText(await w.rpc('tools/call',{name:'dd_owner_bdb_data',arguments:{...args,op:'artifact'}},{catalog}));assert.equal(createHash('sha256').update(Buffer.from(exact.data,'base64')).digest('hex'),f.descriptor.sha256);
  }
  for(const credential of [w.other,'synthetic-shared'])assert.equal((await w.rpc('tools/call',{name:'dd_owner_bdb_data',arguments:args},{credential})).body.result.isError,true);
  w.db.get('/researchLab/v1/tenants/test').ownerConnector.enabled=false;
  assert.equal((await w.rpc('tools/call',{name:'dd_owner_bdb_data',arguments:args})).body.result.isError,true);
  assert.ok(!(await w.rpc('tools/list')).body.result.tools.some(t=>t.name==='dd_owner_bdb_data'));assert.equal(w.state.writes,0);
 }finally{await w.close();}
});

test('packaged v2 indexed data uses existing owner permissions for both catalogs',async()=>{
 const objects=new Map(),put=v=>{const text=JSON.stringify(v),h=createHash('sha256').update(text).digest('hex');objects.set(h,text);return h;};
 const artifact=put({version:2,sourceSha256:SOURCE_SHA,table:'players',columns:['draft_year','nfl_id'],rows:[{draft_year:'2023',nfl_id:'synthetic'}]});
 const root=put({version:2,kind:'index',sourceSha256:SOURCE_SHA,table:'players',artifacts:[{sha256:artifact,rows:1}]});
 const tables=Object.fromEntries(['players','combine_results','combine_tracking','games','player_play','game_tracking'].map(t=>[t,{root,depth:0,rows:1,columns:[{name:'draft_year'},{name:'nfl_id'}]}]));
 const pin=put({version:2,sourceSha256:SOURCE_SHA,classes:['2023','2024'],seasons:['2023','2024'],policy:'development-cohort-only-v1',holdoutRead:false,tables});
 const w=await boot({dataBindings:{RESEARCH_DEVELOPMENT_DATA_ENABLED:'true',RESEARCH_DEVELOPMENT_MANIFEST_SHA:pin}});
 try{
  const bucket=await w.mf.getR2Bucket('RESEARCH_UPLOADS');for(const [h,text] of objects)await bucket.put('development/'+w.uid+'/test/'+SOURCE_SHA+'/'+h+'.json',text);
  const args={op:'rows',table:'players',path:[],artifact};
  for(const catalog of ['core','full']){
   assert.ok((await w.rpc('tools/list',{},{catalog})).body.result.tools.some(t=>t.name==='dd_owner_bdb_data'));
   assert.equal(callText(await w.rpc('tools/call',{name:'dd_owner_bdb_data',arguments:args},{catalog})).rows.length,1);
  }
  for(const credential of [w.other,'synthetic-shared'])assert.equal((await w.rpc('tools/call',{name:'dd_owner_bdb_data',arguments:args},{credential})).body.result.isError,true);
  w.db.get('/researchLab/v1/tenants/test').ownerConnector={...w.grant,enabled:false};
  assert.equal((await w.rpc('tools/call',{name:'dd_owner_bdb_data',arguments:args})).body.result.isError,true);
  assert.equal(w.state.writes,0);
 }finally{await w.close();}
});

test('packaged initialize count, tools/list and dd_whoami agree for owner, non-owner and shared',async()=>{const w=await boot();try{
 for(const catalog of ['core','full'])for(const header of [false,true]){
  const init=await w.rpc('initialize',{protocolVersion:'2025-06-18'},{catalog,header}),list=(await w.rpc('tools/list',{},{catalog,header})).body.result.tools,full=(await w.rpc('tools/list',{},{catalog:'full',header})).body.result.tools;
  const m=/Catalog `(\w+)`: (\d+) of (\d+) tools are callable here/.exec(init.body.result.instructions);assert.ok(m,init.body.result.instructions.slice(0,200));assert.equal(m[1],catalog);assert.equal(Number(m[2]),list.length);assert.equal(Number(m[3]),full.length);
  assert.match(init.body.result.instructions,/Private owner apps on for this connection: Dispatch and BDB research \(4 dd_owner_\* tools/);
  for(const t of list.filter(t=>t.name.startsWith('dd_owner_'))){assert.equal(t.inputSchema.type,'object');for(const k of ['oneOf','anyOf','allOf'])assert.equal(t.inputSchema[k],undefined);}
  const who=callText(await w.rpc('tools/call',{name:'dd_whoami',arguments:{}},{catalog,header}));assert.deepEqual(who.private_apps,{pound:'on',research:'on'});assert.equal(who.credential_transport,header?'header':'url');}
 for(const credential of [w.other,'synthetic-shared']){const init=await w.rpc('initialize',{},{credential}),list=(await w.rpc('tools/list',{},{credential})).body.result.tools;const m=/(\d+) of (\d+) tools/.exec(init.body.result.instructions);assert.equal(Number(m[1]),list.length);assert.equal(Number(m[2]),list.length);assert.ok(!list.some(t=>t.name.startsWith('dd_owner_')));assert.match(init.body.result.instructions,/No private owner apps are on for this connection\./);const who=callText(await w.rpc('tools/call',{name:'dd_whoami',arguments:{}},{credential}));assert.deepEqual(who.private_apps,{pound:'not_owner',research:'not_owner'});for(const name of ['dd_owner_pound_read','dd_owner_bdb_read','dd_owner_pound_write','dd_owner_bdb_write'])assert.equal((await w.rpc('tools/call',{name,arguments:{}},{credential})).body.result.isError,true);}
 const map=callText(await w.rpc('tools/call',{name:'dd_site_map',arguments:{}}));assert.ok(map.pages['dawghouse.html']&&!map.pages['pound.html']&&map.privateSurfaces['dawg-pound.html']&&map.privateSurfaces['research-lab/private.html']);
 w.db.get('/privatePounds/'+w.uid).ownerConnector={...w.grant,enabled:false,version:2};const init=await w.rpc('initialize');assert.match(init.body.result.instructions,/Private owner apps on for this connection: BDB research \(2 dd_owner_\* tools/);assert.deepEqual(callText(await w.rpc('tools/call',{name:'dd_whoami',arguments:{}})).private_apps,{pound:'off',research:'on'});
}finally{await w.close();}});

test('packaged flat and legacy writes succeed, replay exactly, and keep the label unverified',async()=>{const w=await boot();try{
 const legacy=await w.rpc('tools/call',{name:'dd_owner_pound_write',arguments:{op:'task.save',expected_revision:0,request_id:'packaged_task_000001',data:{title:'Synthetic task',body:'',agent_id:'',status:'queued',archived:false}}});assert.ok(!legacy.body.result.isError,JSON.stringify(legacy.body));
 const thread=JSON.parse(w.db.get('/privatePounds/'+w.uid).payload).tasks[0].id,flat={op:'message.add',expected_revision:1,request_id:'packaged_message_0001',data:{thread_id:thread,text:'Synthetic finding'},assistant:'Claude'};
 const first=callText(await w.rpc('tools/call',{name:'dd_owner_pound_write',arguments:flat})),again=callText(await w.rpc('tools/call',{name:'dd_owner_pound_write',arguments:flat}));assert.equal(first.identity.assistantIdentity,'unverified');assert.equal(first.identity.author_label_trust,'unverified');assert.equal(again.replayed,true);
 const bdb=callText(await w.rpc('tools/call',{name:'dd_owner_bdb_write',arguments:{type:'hypothesis',key:'packaged-flat-1',payload:{title:'Synthetic hypothesis',method:'Review measurement'},assistant:'Claude'}}));assert.equal(bdb.result.revisions[0].author_label,'Claude');assert.equal(w.state.writes,3);
}finally{await w.close();}});

test('direct private routes deny the personal MCP bearer; denied operations stay denied over MCP',async()=>{const w=await boot();try{
 const routes=[['GET','/api/pound'],['POST','/api/pound'],['GET','/research/v1/tenants/test/state'],['POST','/research/v1/tenants/test/command'],['POST','/research/v1/tenants/test/mcp'],['GET','/research-upload/v1/status'],['POST','/research-upload/v1/create'],['GET','/research-upload/v1/download'],['POST','/agents/v1/owners/u_owner/mcp'],['GET','/owner-apps/v1'],['POST','/owner-apps/v1']];
 for(const credential of [w.token,'synthetic-shared'])for(const [method,route] of routes){const before=w.state.writes;const res=await w.mf.dispatchFetch('https://test'+route,{method,headers:{Authorization:'Bearer '+credential,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify({app:'pound',enabled:true,expectedVersion:1,mode:'until_revoked'})}:{})});if(process.env.DD_SHOW_STATUS)console.log(credential===w.token?'personal':'shared',method,route,res.status,(await res.clone().text()).slice(0,90));assert.ok([401,403,404,503].includes(res.status),method+' '+route+' gave '+res.status);assert.notEqual(res.status,200);assert.equal(w.state.writes,before);}
 for(const op of ['agent.save','context.archive'])assert.match((await w.rpc('tools/call',{name:'dd_owner_pound_write',arguments:{op,expected_revision:0,request_id:'packaged_denied_0001',data:{}}})).body.result.content[0].text,/operation_denied/);
 for(const type of ['task','claim','run','permissions'])assert.match((await w.rpc('tools/call',{name:'dd_owner_bdb_write',arguments:{type,key:'denied',payload:{}}})).body.result.content[0].text,/operation_denied/);
 assert.equal(w.state.writes,0);
}finally{await w.close();}});

// ---- 2026-10-16: the website session and the owner connector are one owner, one tenant, one storage key ----
// Real packaged Worker, real session signatures, synthetic credentials. Tenant mirrors production
// (wrangler.jsonc RESEARCH_UPLOAD_TENANT and research-lab/client-config.mjs must agree).
import {readFileSync} from 'node:fs';
const b64u=s=>Buffer.from(s).toString('base64url');
test('web session and owner connector resolve to the same owner, tenant and storage key for Pound and BDB',async()=>{
 const wrangler=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8')),tenant=wrangler.vars.RESEARCH_UPLOAD_TENANT;
 assert.match(readFileSync(new URL('./client-config.mjs',import.meta.url),'utf8'),new RegExp(`tenant:'${tenant}'`),'browser tenant must equal the Worker tenant');
 const directory=mkdtempSync(path.join(os.tmpdir(),'dd-owner-same-'));let mf;try{buildWorker(directory);
  const pepper='synthetic-pepper',token='u_synthetic-personal',uid='u_owner',paths=[];let version=0;
  const grant={owner:uid,enabled:true,expiresAt:0,mode:'until_revoked',version:1};
  const db=new Map([['/users/'+uid,{name:'Synthetic Owner',passwordSetAt:0,mcpToken:createHmac('sha256',pepper).update('mcp|'+token).digest('base64url')}],
   ['/privatePounds/'+uid,{owner_uid:uid,payload:JSON.stringify({revision:0,updated_at:null,agents:[],tasks:[],messages:[],contexts:[],activity:[],receipts:[]}),ownerConnector:grant}],
   ['/researchLab/v1/tenants/'+tenant,{...encodeEnvelope({version:1,access:{users:{[uid]:{owner:true,enabled:true,capabilities:['research:read','hypothesis:write','evidence:write','discussion:write']}}},state:initialState(),inputs:{}}),ownerConnector:grant}]]);
  mf=new Miniflare({modules:true,modulesRoot:directory,scriptPath:path.join(directory,'worker.mjs'),compatibilityDate:'2026-07-30',bindings:{RESEARCH_OWNER_UID:uid,RESEARCH_UPLOAD_TENANT:tenant,RESEARCH_LAB_ENABLED:'true',DAWG_POUND_ENABLED:'true',BOZO_PEPPER:pepper,DAWG_PASS:'synthetic-shared',FB_SECRET:'synthetic'},
   outboundService:async req=>{const p=decodeURIComponent(new URL(req.url).pathname.replace(/\.json$/,''));if(p==='/users')return Response.json({[uid]:db.get('/users/'+uid)});paths.push(req.method+' '+p);assert.ok(db.has(p),'unexpected path '+p);
    if(req.method==='PUT'){assert.equal(req.headers.get('if-match'),'"'+version+'"');db.set(p,await req.json());version++;return Response.json(db.get(p));}return Response.json(db.get(p),{headers:{ETag:'"'+version+'"'}});}});
  const payload=b64u(JSON.stringify({u:uid,n:'Synthetic Owner',i:Date.now(),e:Date.now()+864e5,p:0})),session=payload+'.'+createHmac('sha256',pepper).update(payload).digest('base64url');
  const web=async(route,body)=>{const r=await mf.dispatchFetch('https://test'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+session,Origin:'https://datadawgs216.com',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const mcp=async(name,args={})=>{const r=await mf.dispatchFetch('https://test/mcp/full/'+token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});const j=await r.json();assert.ok(!j.result.isError,j.result.content[0].text);return JSON.parse(j.result.content[0].text);};
  const touched=fn=>{paths.length=0;return fn().then(v=>({v,keys:[...new Set(paths.map(p=>p.split(' ')[1]).filter(p=>!p.startsWith('/users')))]}));};

  // Pound: connector write -> web read, and web write -> connector read, on one key.
  const c=await touched(()=>mcp('dd_owner_pound_write',{op:'context.save',expected_revision:0,request_id:'same_owner_context_01',data:{title:'Connector note',text:'Written by the connector'},assistant:'Claude'}));
  assert.deepEqual(c.keys,['/privatePounds/'+uid]);
  const w=await touched(()=>web('/api/pound'));assert.equal(w.v.status,200,JSON.stringify(w.v.body));assert.deepEqual(w.keys,['/privatePounds/'+uid]);
  const ctx=w.v.body.workspace.contexts[0];assert.equal(ctx.id,c.v.result.item_id);assert.equal(ctx.versions[0].actor_uid,uid);assert.equal(ctx.versions[0].actor_kind,'owner_connector');
  const ww=await web('/api/pound',{op:'context.save',expected_revision:1,request_id:'same_owner_context_02',data:{id:ctx.id,title:'Web edit',text:'Written on the website'}});assert.equal(ww.status,200);
  const back=await mcp('dd_owner_pound_read');assert.equal(back.identity.owner,uid);assert.equal(back.workspace.contexts[0].versions.length,2);assert.equal(back.workspace.contexts[0].versions[1].actor_kind,'owner');

  // BDB: connector write -> web read, and web write -> connector read, on one tenant key.
  const e=await touched(()=>mcp('dd_owner_bdb_write',{type:'evidence',key:'same-owner-e1',payload:{url:'https://datadawgs216.com/',title:'Connector evidence',excerpt:'Synthetic'}}));
  assert.deepEqual(e.keys,['/researchLab/v1/tenants/'+tenant]);assert.equal(e.v.result.tenant,tenant);
  const s=await touched(()=>web('/research/v1/tenants/'+tenant+'/state'));assert.equal(s.v.status,200,JSON.stringify(s.v.body));assert.deepEqual(s.keys,['/researchLab/v1/tenants/'+tenant]);
  assert.ok(s.v.body.evidence.some(x=>x.id===e.v.result.id&&x.subject===uid&&x.actor==='owner-connector:'+uid));
  const h=await web('/research/v1/tenants/'+tenant+'/command',{type:'hypothesis',key:'same-owner-h1',payload:{title:'Web hypothesis',method:'Synthetic'}});assert.equal(h.status,200,JSON.stringify(h.body));
  const r=await mcp('dd_owner_bdb_read');assert.ok(r.workspace.hypotheses.some(x=>x.id===h.body.id&&x.revisions[0].subject===uid));assert.ok(r.workspace.evidence.some(x=>x.id===e.v.result.id));
 }finally{await mf?.dispose();rmSync(path.resolve(directory),{recursive:true,force:true});}
});
test('packaged BDB read reports a real R2 object by metadata only',async()=>{const w=await boot();try{
 const key='quarantine/'+w.uid+'/22222222-2222-4222-8222-222222222222.zip',bytes=new Uint8Array(1024).fill(7);bytes.set([80,75,3,4]);
 await (await w.mf.getR2Bucket('RESEARCH_UPLOADS')).put(key,bytes);
 w.db.set('/researchUploads/v1/'+w.uid,{version:1,owner_uid:w.uid,payload:JSON.stringify({id:'22222222-2222-4222-8222-222222222222',name:'synthetic.zip',size:1024,hashes:['c'.repeat(64)],key,uploadId:'u',status:'complete',parts:{1:{}},createdAt:Date.now(),completedAt:Date.now()})});
 const r=await w.rpc('tools/call',{name:'dd_owner_bdb_read',arguments:{}});const d=callText(r).dataset;
 assert.equal(d.object,'present');assert.equal(d.objectSize,1024);assert.equal(d.objectMatchesRecordedSize,true);assert.equal(d.lifecycle.durable,false);assert.ok(Date.parse(d.lifecycle.expiresAt)>Date.now());
 assert.ok(!r.body.result.content[0].text.includes('PK'),'no archive bytes in the response');
}finally{await w.close();}});

test('packaged development data uses existing MCP auth, R2 and revocation without writes',async()=>{
 const sha=s=>createHash('sha256').update(s).digest('hex');
 const artifact=JSON.stringify({version:1,sourceSha256:SOURCE_SHA,table:'players',columns:['draft_year','nfl_id'],rows:[{draft_year:'2023',nfl_id:'synthetic'}]}),id=sha(artifact);
 const manifest=JSON.stringify({version:1,sourceSha256:SOURCE_SHA,classes:['2023','2024'],holdoutRead:false,artifacts:[{table:'players',sha256:id,rows:1}]}),mid=sha(manifest);
 const w=await boot({dataBindings:{RESEARCH_DEVELOPMENT_DATA_ENABLED:'true',RESEARCH_DEVELOPMENT_MANIFEST_SHA:mid}});
 try{
  const bucket=await w.mf.getR2Bucket('RESEARCH_UPLOADS'),prefix='development/'+w.uid+'/test/'+SOURCE_SHA+'/';
  await bucket.put(prefix+id+'.json',artifact);await bucket.put(prefix+mid+'.json',manifest);
  for(const catalog of ['core','full']){
   const listed=(await w.rpc('tools/list',{},{catalog,header:true})).body.result.tools;
   assert.ok(listed.some(t=>t.name==='dd_owner_bdb_data'));
   const result=callText(await w.rpc('tools/call',{name:'dd_owner_bdb_data',arguments:{op:'rows',artifact:id}},{catalog,header:true}));assert.equal(result.rows[0].nfl_id,'synthetic');
  }
  for(const credential of [w.other,'synthetic-shared'])assert.equal((await w.rpc('tools/call',{name:'dd_owner_bdb_data',arguments:{op:'catalog'}},{credential})).body.result.isError,true);
  const unlisted=callText(await w.rpc('tools/call',{name:'dd_owner_bdb_data',arguments:{op:'rows',artifact:id}},{credential:'u_synthetic-unlisted',header:true}));assert.equal(unlisted.rows[0].nfl_id,'synthetic','owner keys are not restricted to five named clients');
  const exact=callText(await w.rpc('tools/call',{name:'dd_owner_bdb_data',arguments:{op:'artifact',artifact:id}}));assert.equal(sha(exact.text),id);
  w.db.get('/researchLab/v1/tenants/test').ownerConnector.enabled=false;
  assert.equal((await w.rpc('tools/call',{name:'dd_owner_bdb_data',arguments:{op:'catalog'}})).body.result.isError,true);
  assert.ok(!(await w.rpc('tools/list')).body.result.tools.some(t=>t.name==='dd_owner_bdb_data'));assert.equal(w.state.writes,0);
 }finally{await w.close();}
});
