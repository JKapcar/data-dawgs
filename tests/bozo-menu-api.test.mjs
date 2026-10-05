import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import worker from '../dawg-bot-worker.js';
const pepper='fixture-pepper',uid='u_menu_test',token='u_menu_fixture';
const sign=s=>createHmac('sha256',pepper).update(s).digest('base64url');
const account={name:'Kap',passwordSetAt:1,mcpToken:sign('mcp|'+token)};
const body=Buffer.from(JSON.stringify({u:uid,n:'Kap',p:1,i:Date.now(),e:Date.now()+86400000})).toString('base64url');
const session=body+'.'+sign(body);
const env={BOZO_PEPPER:pepper,FB_SECRET:'fixture-secret',DAWG_PASS:'fixture-shared',RL:{get:async()=>null,put:async()=>{}}};
test('browser API and personal MCP share records; no public or shared access and no contest writes',async()=>{
 const real=globalThis.fetch;let library=null,version=0;const writes=[];
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(input);assert.equal(url.hostname,'data-dawgs-draft-default-rtdb.firebaseio.com');const path=url.pathname.replace(/\.json$/,'');
  if(init.method==='PUT'){assert.equal(path,'/users/'+uid+'/bozoMenus');assert.equal(init.headers['if-match'],String(version));writes.push(path);library=JSON.parse(init.body);version++;return Response.json(library);}
  const data=path==='/users'?{[uid]:account}:path==='/users/'+uid?account:path==='/users/'+uid+'/bozoMenus'?library:null;
  return Response.json(data,{headers:{ETag:String(version)}});
 };
 const api=(op,args,auth=session)=>worker.fetch(new Request('https://toto.jkapcar4.workers.dev/api/bozo-menu/'+op+(op==='get'?'?week=2026-10-05':''),{method:op==='save'?'POST':'GET',headers:{Origin:'https://datadawgs216.com',...(auth?{'X-Bozo-Session':auth}:{}),'Content-Type':'application/json'},...(op==='save'?{body:JSON.stringify(args)}:{})}),env);
 const mcp=(op,args,credential=token)=>worker.fetch(new Request('https://toto.jkapcar4.workers.dev/mcp/core/'+credential,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'dd_bozo_menu_'+op,arguments:args}})}),env);
 try{
  assert.equal((await api('list',{},null)).status,401);
  assert.equal((await api('get')).status,200);
  const payload={week:'2026-10-05',expected_revision:0,candidates:[{id:'a',event:'A at B',sport:'cfb',market:'spread',selection:'A +7',status:'hold',reason:'Awaiting injury screen'}]};
  assert.equal((await api('save',payload)).status,200);
  const read=await (await mcp('get',{week:payload.week})).json();assert.equal(JSON.parse(read.result.content[0].text).candidates[0].id,'a');
  const shared=await (await mcp('list',{},'fixture-shared')).json();assert.ok(shared.result?.isError||shared.error);
  const saved=await (await mcp('save',{...payload,expected_revision:1,candidates:[{...payload.candidates[0],status:'scratch'}]})).json();assert.ok(!saved.error&&!saved.result.isError);
  const reread=await (await api('get')).json();assert.equal(reread.revision,2);assert.equal(reread.candidates[0].status,'scratch');
  assert.equal((await api('save',payload)).status,409);assert.equal(writes.length,2);
  const res=await api('list');assert.match(res.headers.get('Cache-Control'),/no-store/);
 }finally{globalThis.fetch=real;}
});

test('anonymous full feeds, explicit publication, publisher-only writes and revision protection',async()=>{
 const original=globalThis.fetch,db=new Map(),writes=[];let version=0;
 const friendUid='u_friend',friendBody=Buffer.from(JSON.stringify({u:friendUid,n:'Friend',p:1,i:Date.now(),e:Date.now()+86400000})).toString('base64url');
 const friendSession=friendBody+'.'+sign(friendBody);
 const cfg={...env,BOZO_ADMIN:'Kap'};
 globalThis.fetch=async(input,init={})=>{const path=new URL(input).pathname.replace(/\.json$/,'');if(init.method==='PUT'){assert.ok(['/publishedBozoMenus','/users/'+uid+'/bozoMenus'].includes(path));if(init.headers['if-match']!==String(version))return new Response('',{status:412});db.set(path,JSON.parse(init.body));writes.push(path);version++;return Response.json(true);}return Response.json(path==='/users'?{[uid]:account}:path==='/users/'+uid?account:path==='/users/'+friendUid?{name:'Friend',passwordSetAt:1}:db.get(path)||null,{headers:{ETag:String(version)}});};
 const request=(path,{auth,method='GET',data}={})=>worker.fetch(new Request('https://toto.jkapcar4.workers.dev'+path,{method,headers:{'Content-Type':'application/json',...(auth?{'X-Bozo-Session':auth}:{})},...(data?{body:JSON.stringify(data)}:{})}),cfg);
 const candidates=Array.from({length:200},(_,i)=>({id:'pick-'+i,event:'A at B',sport:'cfb',market:'spread',selection:'Pick '+i,status:i===199?'scratch':'hold',reason:'Public authored screening summary'}));
 const payload={week:'2026-10-05',expected_revision:0,candidates};
 try{
  const empty=await (await request('/bozo/menu.json')).json();assert.equal(empty.status,'unpublished');assert.equal(empty.candidates.length,0);
  assert.equal((await request('/api/bozo-menu/save',{auth:session,method:'POST',data:{...payload,candidates:[{...candidates[0],notes:'private-only'}]}})).status,200);
  assert.equal((await (await request('/bozo/menu.json')).json()).status,'unpublished');
  assert.equal((await request('/api/bozo-menu/publish',{method:'POST',data:payload})).status,401);
  assert.equal((await request('/api/bozo-menu/publish',{auth:friendSession,method:'POST',data:payload})).status,403);
  assert.equal((await request('/api/bozo-menu/publish',{auth:session,method:'POST',data:{...payload,candidates:[{...candidates[0],notes:'private-only'}]}})).status,400);
  assert.equal((await request('/api/bozo-menu/publish',{auth:session,method:'POST',data:payload})).status,200);
  const full=await (await request('/bozo/menu.json')).json();assert.equal(full.candidates.length,200);assert.equal(full.revision,1);assert.equal(full.week,'2026-10-05');assert.ok(!JSON.stringify(full).includes('published_by'));assert.ok(!JSON.stringify(full).includes('private-only'));
  const md=await (await request('/bozo/menu.md')).text();assert.match(md,/Pick 199/);assert.match(md,/scratch/);
  const html=await (await request('/bozo/menu')).text();assert.match(html,/Pick 199/);assert.equal((html.match(/<article>/g)||[]).length,200);
  assert.equal((await request('/bozo/menu.json',{method:'POST',data:payload})).status,405);
  assert.equal((await request('/api/bozo-menu/publish',{auth:session,method:'POST',data:payload})).status,409);
  assert.equal((await request('/bozo/menu.json?week=../../users')).status,400);
  assert.equal((await (await request('/bozo/menu.json?week=2026-10-12')).json()).status,'unpublished');
  const rpc=await (await request('/mcp/core/fixture-shared',{method:'POST',data:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'dd_bozo_menu_public',arguments:{}}}})).json();assert.equal(JSON.parse(rpc.result.content[0].text).candidates.length,200);
  assert.equal(writes.filter(p=>p==='/publishedBozoMenus').length,1);
 }finally{globalThis.fetch=original;}
});
