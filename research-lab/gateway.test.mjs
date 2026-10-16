import test from 'node:test';import assert from 'node:assert/strict';
import vm from 'node:vm';import {readFileSync} from 'node:fs';import {webcrypto} from 'node:crypto';
import {createResearchGateway} from './gateway.mjs';
import {initialState,transition,view,hash,capabilities} from './machine.mjs';
import {syntheticTracking} from './tracking.mjs';
// Execute the current repository's actual signed-session/MCP validators and RTDB
// plumbing. Only the HTTP database is replaced by an in-memory ETag test double.
const source=readFileSync(new URL('../dawg-bot-worker.js',import.meta.url),'utf8');
function extract(name){const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert(start>=0,name);const end=source.indexOf('\n}',start);return source.slice(start,end+2);}
async function fixture(){
 const env={RESEARCH_LAB_ENABLED:'true',FB_SECRET:'test-only',BOZO_PEPPER:'synthetic-test-pepper'},rows=new Map(),versions=new Map();let writes=0,onPut=null;
 const put=(path,value)=>{rows.set(path,structuredClone(value));versions.set(path,(versions.get(path)||0)+1);};
 const access={users:{u_owner:{enabled:true,expiresAt:Date.now()+600000,capabilities:['research:read',...capabilities]}},agents:{u_agent:{enabled:true,expiresAt:Date.now()+600000,capabilities:['research:read','task:claim','experiment:run','discussion:write']}}};
 put('/researchLab/v1/tenants/demo',{version:1,access,state:initialState(),inputs:{}});put('/users/u_owner',{name:'Owner',passwordSetAt:0});
 const fetch=async(url,options={})=>{const path=new URL(url).pathname.replace(/\.json$/,''),etag='"'+(versions.get(path)||0)+'"';
  if(options.method==='PUT'){if(onPut){const fn=onPut;onPut=null;fn();}if(options.headers['if-match']!=='"'+(versions.get(path)||0)+'"')return new Response('',{status:412});put(path,JSON.parse(options.body));writes++;return Response.json(rows.get(path));}
  return Response.json(rows.get(path)||null,{headers:{ETag:etag}});
 };
 const context=vm.createContext({Request,Response,URL,TextEncoder,TextDecoder,Uint8Array,Date,crypto:webcrypto,fetch,btoa,atob,encodeURIComponent,
  te:new TextEncoder(),SESSION_DAYS:30,DB:'https://db.invalid',b64:bytes=>Buffer.from(bytes).toString('base64'),b64urlStr:s=>Buffer.from(s).toString('base64url'),unb64urlStr:s=>Buffer.from(s,'base64url').toString(),
  playerName:x=>x,entitlementOf:()=>null,mcpRoute:()=>({rest:[]}),loadUsers:async()=>Object.fromEntries([...rows].filter(([k])=>k.startsWith('/users/')).map(([k,v])=>[k.slice(7),v]))});
 vm.runInContext("const fbUrl=(env,path)=>`${DB}${path}.json?auth=${env.FB_SECRET}`;\n"+['fbGet','fbPut','hmac','timingSafeEqual','makeSession','readSession','bozoConfig','sessionAuth','mcpPassOf','mcpAuth'].map(extract).join('\n')+'\nconst mcpTokenHash=(env,token)=>hmac(env.BOZO_PEPPER,"mcp|"+token);',context);
 const token='u_synthetic-agent-token',digest=await context.hmac(env.BOZO_PEPPER,'mcp|'+token);put('/users/u_agent',{name:'Agent',mcpToken:digest});
 const session=await context.makeSession(env,'Owner',0,'u_owner');
 const dependencies={fbGet:context.fbGet,fbPut:context.fbPut,sessionAuth:context.sessionAuth,mcpAuth:context.mcpAuth,transition,view,codeHash:hash('test-source')};
 let handler=createResearchGateway(dependencies);
 const request=async(route='state',body,identity='user',tenant='demo',extra={})=>handler(new Request(`https://worker.invalid/research/v1/tenants/${tenant}/${route}`,{method:body?'POST':'GET',headers:{...(identity==='user'?{'X-Dawg-Session':session}:identity==='agent'?{Authorization:`Bearer ${token}`}:{Authorization:identity}),'Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})}),env);
 let count=0;const command=(type,payload,identity='user',key=String(++count))=>request('command',{type,key,payload},identity);
 return {env,rows,put,request,command,dependencies,reset:()=>handler=createResearchGateway(dependencies),writes:()=>writes,onPut:fn=>onPut=fn,session,context};
}
test('closed by default; actual session signature/password revocation and MCP token checked',async()=>{
 const f=await fixture();f.env.RESEARCH_LAB_ENABLED='false';assert.equal((await f.request()).status,503);f.env.RESEARCH_LAB_ENABLED='true';assert.equal((await f.request()).status,200);
 assert.equal((await f.request('state',null,'user','demo',{'X-Dawg-Session':f.session+'x'})).status,401);
 f.put('/users/u_owner',{name:'Owner',passwordSetAt:1});assert.equal((await f.request()).status,401);
 assert.equal((await f.request('state',null,'agent')).status,200);f.put('/users/u_agent',{name:'Agent',mcpToken:'revoked'});assert.equal((await f.request('state',null,'agent')).status,401);assert.equal(f.writes(),0);
});
test('deny missing/expired grants, shared credentials, spoofing and cross-origin requests',async()=>{
 const f=await fixture();assert.equal((await f.request('state',null,'agent','other')).status,403);assert.equal((await f.request('state',null,'Bearer shared-password')).status,401);
 assert.equal((await f.request('state',null,'user','demo',{Origin:'https://evil.invalid'})).status,403);
 assert.equal((await f.request('command',{type:'hypothesis',key:'spoof',principal:{tenant:'other'},payload:{title:'A',method:'B'}})).status,400);
 const envelope=f.rows.get('/researchLab/v1/tenants/demo');envelope.access.users.u_owner.expiresAt=1;f.put('/researchLab/v1/tenants/demo',envelope);assert.equal((await f.request()).status,403);assert.equal(f.writes(),0);
});
test('two gateway instances share state; concurrent claim has exactly one winner; receipt atomic replay',async()=>{
 const f=await fixture(),h=await(await f.command('hypothesis',{title:'Candidate',method:'Descriptive only'})).json();
 const t=await(await f.command('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000})).json();f.reset();assert.equal((await(await f.request()).json()).tasks.length,1);
 const results=await Promise.all([f.command('claim',{taskId:t.id,leaseMs:60000},'agent'),f.command('claim',{taskId:t.id,leaseMs:60000},'user')]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const winner=results[0].status===200?'agent':'user',claimed=await results[winner==='agent'?0:1].json(),payload={taskId:t.id,leaseToken:claimed.lease.token,tracking:syntheticTracking()};
 const r=await(await f.command('run',payload,winner,'run-idempotent')).json();assert.equal(r.outcome,'success');
 const same=await(await f.command('run',payload,winner,'run-idempotent')).json();assert.equal(same.id,r.id);const stored=f.rows.get('/researchLab/v1/tenants/demo');assert.equal(stored.state.receipts.length,1);assert(stored.inputs[r.hashes.data]);assert.equal(stored.state.tasks[0].status,'completed');
});
test('CAS retries reauthorize a concurrent grant revocation before any write',async()=>{
 const f=await fixture();f.onPut(()=>{const e=f.rows.get('/researchLab/v1/tenants/demo');e.access.users.u_owner.enabled=false;f.put('/researchLab/v1/tenants/demo',e);});
 assert.equal((await f.command('hypothesis',{title:'A',method:'B'})).status,403);assert.equal(f.writes(),0);assert.equal(f.rows.get('/researchLab/v1/tenants/demo').state.hypotheses.length,0);
});
test('MCP list scopes and tools/call use the same durable state; others lease tokens hidden',async()=>{
 const f=await fixture(),h=await(await f.command('hypothesis',{title:'A',method:'B'})).json(),t=await(await f.command('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000})).json();await f.command('claim',{taskId:t.id,leaseMs:60000},'user');
 const state=await(await f.request('state',null,'agent')).json();assert.equal(state.tasks[0].lease.token,undefined);assert.equal(state.identity.actor,'mcp:u_agent');
 const catalog=await(await f.request('mcp',{jsonrpc:'2.0',id:1,method:'tools/list'},'agent')).json();assert(!catalog.result.tools.some(t=>t.name==='research_hypothesis'));assert(catalog.result.tools.some(t=>t.name==='research_discussion'));
 const denied=await f.request('mcp',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'research_hypothesis',arguments:{key:'forbidden',payload:{title:'A',method:'B'}}}},'agent');assert.equal(denied.status,403);
 const ok=await f.request('mcp',{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'research_discussion',arguments:{key:'challenge',payload:{hypothesisId:h.id,kind:'challenge',body:'Check measurement',evidenceIds:[]}}}},'agent');assert.equal(ok.status,200);assert.equal(f.rows.get('/researchLab/v1/tenants/demo').state.discussions[0].independent,true);
});
test('capacity gate and missing ETag fail closed without commits',async()=>{
 const f=await fixture(),handle=createResearchGateway({...f.dependencies,maxBytes:1});const req=new Request('https://worker.invalid/research/v1/tenants/demo/command',{method:'POST',headers:{'X-Dawg-Session':f.session,'Content-Type':'application/json'},body:JSON.stringify({type:'hypothesis',key:'cap',payload:{title:'A',method:'B'}})});assert.equal((await handle(req,f.env)).status,507);assert.equal(f.writes(),0);
 const unavailable=createResearchGateway({...f.dependencies,fbGet:async()=>({data:{}})});assert.equal((await unavailable(new Request('https://worker.invalid/research/v1/tenants/demo/state',{headers:{'X-Dawg-Session':f.session}}),f.env)).status,503);
});
test('grant expiry during streamed body is rechecked and cannot commit',async()=>{
 const f=await fixture();let clock=Date.now(),finish;const envelope=f.rows.get('/researchLab/v1/tenants/demo');envelope.access.users.u_owner.expiresAt=clock+10;f.put('/researchLab/v1/tenants/demo',envelope);
 const handle=createResearchGateway({...f.dependencies,now:()=>clock});
 const stream=new ReadableStream({start(controller){finish=()=>{clock+=20;controller.enqueue(new TextEncoder().encode(JSON.stringify({type:'hypothesis',key:'expired',payload:{title:'A',method:'B'}})));controller.close();};}});
 const pending=handle(new Request('https://worker.invalid/research/v1/tenants/demo/command',{method:'POST',duplex:'half',headers:{'X-Dawg-Session':f.session,'Content-Type':'application/json'},body:stream}),f.env);setTimeout(finish,10);assert.equal((await pending).status,403);assert.equal(f.writes(),0);
});
test('same account across browser/MCP is not an independent challenge',async()=>{
 const f=await fixture(),token='u_owner-mcp-token';const user=f.rows.get('/users/u_owner');user.mcpToken=await f.context.hmac(f.env.BOZO_PEPPER,'mcp|'+token);f.put('/users/u_owner',user);
 const e=f.rows.get('/researchLab/v1/tenants/demo');e.access.agents.u_owner={...e.access.users.u_owner};f.put('/researchLab/v1/tenants/demo',e);
 const h=await(await f.command('hypothesis',{title:'A',method:'B'})).json();const r=await f.command('discussion',{hypothesisId:h.id,kind:'challenge',body:'My own test',evidenceIds:[]},`Bearer ${token}`);assert.equal(r.status,200);assert.equal((await r.json()).independent,false);
});
test('MCP initialize/notification/version handling and archived omitted inputs',async()=>{
 const f=await fixture();const init=await f.request('mcp',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}},'agent');assert.equal(init.status,200);
 const notification=await f.request('mcp',{jsonrpc:'2.0',method:'notifications/initialized'},'agent');assert.equal(notification.status,202);assert.equal(await notification.text(),'');
 assert.equal((await f.request('mcp',{jsonrpc:'2.0',id:2,method:'tools/list'},'agent','demo',{'MCP-Protocol-Version':'invalid'})).status,400);
 const h=await(await f.command('hypothesis',{title:'A',method:'B'})).json(),t=await(await f.command('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000})).json(),claim=await(await f.command('claim',{taskId:t.id,leaseMs:60000})).json(),r=await(await f.command('run',{taskId:t.id,leaseToken:claim.lease.token})).json();
 assert.equal(r.outcome,'failure');assert.equal(hash(f.rows.get('/researchLab/v1/tenants/demo').inputs[r.hashes.data].tracking),r.hashes.data);
});
