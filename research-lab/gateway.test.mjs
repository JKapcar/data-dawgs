import test from 'node:test';import assert from 'node:assert/strict';
import vm from 'node:vm';import {readFileSync} from 'node:fs';import {webcrypto} from 'node:crypto';
import {createResearchGateway} from './gateway.mjs';
import {initialState,transition,view,hash,capabilities} from './machine.mjs';
import {syntheticTracking} from './tracking.mjs';
import * as portable from './worker-core.mjs';
import {createClient} from './client.mjs';
import {fixture} from './gateway-fixture.mjs';
test('durable owner grant accepts signed Authorization session, never grants durable agent access',async()=>{
 const f=await fixture();f.env.RESEARCH_OWNER_UID='u_owner';const e=f.rows.get('/researchLab/v1/tenants/demo');e.access.users.u_owner.owner=true;delete e.access.users.u_owner.expiresAt;f.put('/researchLab/v1/tenants/demo',e);
 const r=await f.request('state',null,'Bearer '+f.session);assert.equal(r.status,200);
 f.env.RESEARCH_OWNER_UID='u_other';assert.equal((await f.request('state',null,'Bearer '+f.session)).status,403);
 e.access.agents.u_agent.owner=true;delete e.access.agents.u_agent.expiresAt;f.put('/researchLab/v1/tenants/demo',e);f.env.RESEARCH_OWNER_UID='u_agent';assert.equal((await f.request('state',null,'agent')).status,403);
});
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
test('MCP initialize/notification/version handling and private failure inputs',async()=>{
 const f=await fixture();const init=await f.request('mcp',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}},'agent');assert.equal(init.status,200);
 const notification=await f.request('mcp',{jsonrpc:'2.0',method:'notifications/initialized'},'agent');assert.equal(notification.status,202);assert.equal(await notification.text(),'');
 assert.equal((await f.request('mcp',{jsonrpc:'2.0',id:2,method:'tools/list'},'agent','demo',{'MCP-Protocol-Version':'invalid'})).status,400);
 const h=await(await f.command('hypothesis',{title:'A',method:'B'})).json(),t=await(await f.command('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000})).json(),claim=await(await f.command('claim',{taskId:t.id,leaseMs:60000})).json(),r=await(await f.command('run',{taskId:t.id,leaseToken:claim.lease.token})).json();
 assert.equal(r.outcome,'failure');assert.equal(f.rows.get('/researchLab/v1/tenants/demo').inputs[r.hashes.data],undefined);assert.equal(r.hashes.data,hash(undefined));
});

test('WebCrypto core produces verifiable hashes and actual receipts through shared gateway',async()=>{
 assert.equal(await portable.hash(undefined),hash(undefined));assert.equal(await portable.hash({unicode:'→',missing:null}),hash({unicode:'→',missing:null}));
 const f=await fixture(),handle=createResearchGateway({...f.dependencies,transition:portable.transition});
 let key=0;const send=async(type,payload)=>{const r=await handle(new Request('https://worker.invalid/research/v1/tenants/demo/command',{method:'POST',headers:{'X-Dawg-Session':f.session,'Content-Type':'application/json'},body:JSON.stringify({type,payload,key:String(++key)})}),f.env);assert.equal(r.status,200);return r.json();};
 const h=await send('hypothesis',{title:'Portable audit',method:'Synthetic only'}),t=await send('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000}),c=await send('claim',{taskId:t.id,leaseMs:60000}),r=await send('run',{taskId:t.id,leaseToken:c.lease.token,tracking:syntheticTracking()});
 const {receiptHash,...body}=r;assert.equal(receiptHash,hash(body));assert.equal(r.outcome,'success');
});

test('durable request limits persist across handlers, concurrent reservations and account transports',async()=>{
 const f=await fixture();const env=f.rows.get('/researchLab/v1/tenants/demo');env.access.agents.u_owner={...env.access.users.u_owner};f.put('/researchLab/v1/tenants/demo',env);
 const token='u_same-account';f.put('/users/u_owner',{name:'Owner',passwordSetAt:0,mcpToken:await f.context.hmac(f.env.BOZO_PEPPER,'mcp|'+token)});
 let clock=Date.now();const make=()=>createResearchGateway({...f.dependencies,subjectRequests:2,tenantRequests:3,now:()=>clock});
 const req=agent=>new Request('https://worker.invalid/research/v1/tenants/demo/state',{headers:agent?{Authorization:`Bearer ${token}`}:{'X-Dawg-Session':f.session}});
 const results=await Promise.all([make()(req(false),f.env),make()(req(true),f.env),make()(req(false),f.env)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,200,429]);
 assert.equal((await make()(req(false),f.env)).status,429);assert.equal(f.rows.get('/researchLab/v1/tenants/demo').quota.total,2);
 clock+=60000;assert.equal((await make()(req(false),f.env)).status,200);
 const capped=createResearchGateway({...f.dependencies,subjectRequests:100,tenantRequests:1,now:()=>clock});assert.equal((await capped(req(true),f.env)).status,429);
});

test('revocation during the command CAS prevents write even after quota reservation',async()=>{
 const f=await fixture();let revoked=false;
 const handle=createResearchGateway({...f.dependencies,fbPut:async(env,path,data,etag)=>{if(data.state.hypotheses.length&&!revoked){revoked=true;const e=structuredClone(f.rows.get(path));e.access.users.u_owner.enabled=false;f.put(path,e);}return f.dependencies.fbPut(env,path,data,etag);}});
 const r=await handle(new Request('https://worker.invalid/research/v1/tenants/demo/command',{method:'POST',headers:{'X-Dawg-Session':f.session,'Content-Type':'application/json'},body:JSON.stringify({type:'hypothesis',key:'revoked-after-quota',payload:{title:'A',method:'B'}})}),f.env);
 assert.equal(r.status,403);assert.equal(f.writes(),0);
});

test('request bytes, UTF-8, response capacity, credential size and stalled streams are bounded',async()=>{
 const f=await fixture(),url='https://worker.invalid/research/v1/tenants/demo/command',headers={'X-Dawg-Session':f.session,'Content-Type':'application/json'};
 const small=createResearchGateway({...f.dependencies,maxRequestBytes:100});assert.equal((await small(new Request(url,{method:'POST',headers,body:' '.repeat(101)}),f.env)).status,413);
 assert.equal((await small(new Request(url,{method:'POST',headers,body:new Uint8Array([255,255])}),f.env)).status,400);
 const bounded=createResearchGateway({...f.dependencies,maxResponseBytes:300});assert.equal((await bounded(new Request(url,{method:'POST',headers,body:JSON.stringify({type:'hypothesis',key:'large-response',payload:{title:'A',method:'B'.repeat(1000)}})}),f.env)).status,507);assert.equal(f.writes(),0);
 const timeout=createResearchGateway({...f.dependencies,bodyTimeoutMs:5});assert.equal((await timeout(new Request(url,{method:'POST',duplex:'half',headers,body:new ReadableStream({start(){}})}),f.env)).status,408);
 assert.equal((await f.request('state',null,'user','demo',{'X-Dawg-Session':'x'.repeat(4097)})).status,431);
});

test('hosted source-data privacy and malformed agent commands fail closed',async()=>{
 const f=await fixture(),h=await(await f.command('hypothesis',{title:'A',method:'B'})).json(),t=await(await f.command('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000})).json(),c=await(await f.command('claim',{taskId:t.id,leaseMs:60000},'agent')).json();
 const data=syntheticTracking();data.provenance.kind='licensed';assert.equal((await f.command('run',{taskId:t.id,leaseToken:c.lease.token,tracking:data},'agent')).status,403);
 data.provenance.kind='synthetic';data.split='heldout';assert.equal((await f.command('run',{taskId:t.id,leaseToken:c.lease.token,tracking:data},'agent')).status,403);
 data.split='discovery';data.hiddenSource='PRIVATE_SOURCE_CANARY';const r=await(await f.command('run',{taskId:t.id,leaseToken:c.lease.token,tracking:data},'agent')).json();assert.equal(r.outcome,'failure');
 assert(!JSON.stringify(f.rows.get('/researchLab/v1/tenants/demo')).includes('PRIVATE_SOURCE_CANARY'));assert.deepEqual(f.rows.get('/researchLab/v1/tenants/demo').inputs,{});
 for(const payload of [null,[],{hypothesisId:h.id,kind:'note',body:'x',evidenceIds:[],principal:'admin'}])assert.equal((await f.command('discussion',payload,'agent')).status,400);
 const read=await(await f.request('state',null,'agent')).json();assert.equal(read.access,undefined);assert.equal(read.inputs,undefined);assert.equal(read.idempotency,undefined);
});

test('browser client uses verified site session, explicit tenant, no fallback or stale identity response',async()=>{
 const f=await fixture();let token=f.session,calls=0;
 const handle=createResearchGateway(f.dependencies),client=createClient({mode:'hosted',workerOrigin:'https://toto.jkapcar4.workers.dev',tenant:'demo'},{origin:'https://datadawgs216.com',token:()=>token,fetcher:async(url,options)=>{calls++;return handle(new Request(url,{...options,headers:{...options.headers,Origin:'https://datadawgs216.com'}}),f.env);}});
 assert.equal((await client.state()).identity.actor,'user:u_owner');assert.equal((await client.command('hypothesis',{title:'From signed-in browser',method:'Test'})).tenant,'demo');
 token='invalid';await assert.rejects(()=>client.state(),/verified_uid_required/);assert.equal(calls,3);
 const disabled=createClient({mode:'disabled'},{origin:'https://datadawgs216.com',fetcher:()=>{throw Error('must not connect');}});await assert.rejects(()=>disabled.state(),/unconfigured/);
 assert.throws(()=>createClient({mode:'hosted',workerOrigin:'https://evil.invalid',tenant:'demo'},{origin:'https://datadawgs216.com'}),/denied/);
 let resolve;token=f.session;const stale=createClient({mode:'hosted',workerOrigin:'https://toto.jkapcar4.workers.dev',tenant:'demo'},{origin:'https://datadawgs216.com',token:()=>token,fetcher:()=>new Promise(r=>resolve=r)});const pending=stale.state();token='another-account';resolve(Response.json({secret:true}));await assert.rejects(()=>pending,/Identity changed/);
});

test('late JSON decode cannot restore signed-out state',async()=>{
 let token='before',resolve,decoding;const started=new Promise(r=>decoding=r);
 const client=createClient({mode:'hosted',workerOrigin:'https://toto.jkapcar4.workers.dev',tenant:'demo'},{origin:'https://datadawgs216.com',token:()=>token,fetcher:async()=>({ok:true,json:()=>{decoding();return new Promise(r=>resolve=r);}})});
 const pending=client.state();await started;token='after';client.invalidate();resolve({private:'before'});await assert.rejects(()=>pending,/Identity changed/);
});

test('readable-state capacity prevents growth from stranding the dashboard',async()=>{
 const f=await fixture(),handle=createResearchGateway({...f.dependencies,maxResponseBytes:4500});
 const send=key=>handle(new Request('https://worker.invalid/research/v1/tenants/demo/command',{method:'POST',headers:{'X-Dawg-Session':f.session,'Content-Type':'application/json'},body:JSON.stringify({type:'hypothesis',key,payload:{title:'A',method:'B'.repeat(1400)}})}),f.env);
 assert.equal((await send('first')).status,200);assert.equal((await send('second')).status,507);assert.equal(f.rows.get('/researchLab/v1/tenants/demo').state.hypotheses.length,1);
 assert.equal((await handle(new Request('https://worker.invalid/research/v1/tenants/demo/state',{headers:{'X-Dawg-Session':f.session}}),f.env)).status,200);
});

test('async execution cannot commit after lease expiry',async()=>{
 const f=await fixture(),h=await(await f.command('hypothesis',{title:'A',method:'B'})).json(),t=await(await f.command('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000})).json(),c=await(await f.command('claim',{taskId:t.id,leaseMs:60000})).json();let clock=Date.now();
 const handle=createResearchGateway({...f.dependencies,now:()=>clock,transition:async(...args)=>{const result=await portable.transition(...args);clock=c.lease.expiresAt+1;return result;}});
 const r=await handle(new Request('https://worker.invalid/research/v1/tenants/demo/command',{method:'POST',headers:{'X-Dawg-Session':f.session,'Content-Type':'application/json'},body:JSON.stringify({type:'run',key:'late',payload:{taskId:t.id,leaseToken:c.lease.token,tracking:syntheticTracking()}})}),f.env);assert.equal(r.status,409);assert.equal(f.rows.get('/researchLab/v1/tenants/demo').state.receipts.length,0);
});

test('malformed MCP names, arguments and oversized IDs return bounded client errors',async()=>{
 const f=await fixture();for(const params of [{name:3,arguments:{}},{name:'research_state',arguments:[]},{name:'constructor',arguments:{}},{name:'research_toString',arguments:{}}])assert.equal((await f.request('mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params},'agent')).status,400);
 assert.equal((await f.request('mcp',{jsonrpc:'2.0',id:'x'.repeat(161),method:'tools/list'},'agent')).status,400);
});
test('only the signed durable owner may register a hypothesis; an expiring user grant may only propose or withdraw',async()=>{
 const f=await fixture(),cmd=async(type,payload)=>{const r=await f.command(type,payload);return {status:r.status,body:await r.json()};},reg={title:'Registered study',method:'Pre-registered synthetic method',status:'registered',family:'speed-retention',target:'T1'};
 const denied=await cmd('hypothesis',reg);assert.equal(denied.status,400);assert.match(denied.body.error,/signed owner/);
 const proposed=await cmd('hypothesis',{title:'Proposal',method:'Exploratory synthetic method',family:'missingness'});assert.equal(proposed.status,200);assert.equal(proposed.body.revisions[0].status,'exploratory');
 const withdrawn=await cmd('hypothesis',{id:proposed.body.id,expectedVersion:1,title:'Proposal',method:'Exploratory synthetic method',status:'withdrawn'});assert.equal(withdrawn.status,200);
 f.env.RESEARCH_OWNER_UID='u_owner';const e=f.rows.get('/researchLab/v1/tenants/demo');e.access.users.u_owner.owner=true;delete e.access.users.u_owner.expiresAt;f.put('/researchLab/v1/tenants/demo',e);
 const ok=await cmd('hypothesis',reg);assert.equal(ok.status,200,JSON.stringify(ok.body));assert.equal(ok.body.revisions[0].status,'registered');assert.equal(ok.body.revisions[0].target,'T1');
});
