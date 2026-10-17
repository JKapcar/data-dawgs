const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const source=fs.readFileSync('work/dawg-pound.js','utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const mockToken=user=>user+'.'+'x'.repeat(43);
function rig(){
  const db=new Map(),reads=[],writes=[];let revision=0,revoke=false,race=false,lost=false,noEtag=false,revokeOnRead=false;
  const env={DAWG_POUND_ENABLED:'true'};
  const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Request,Response,Headers,URL,Date,
    ORIGINS:['https://datadawgs216.com'],
    readSession:async(e,t)=>t===mockToken('legacy')?{n:'same-name'}:['u_one','u_two'].some(u=>mockToken(u)===t)?{u:t.split('.')[0]}:null,
    sessionAuth:async r=>revoke?{err:'revoked'}:{uid:r.headers.get('X-Dawg-Session').split('.')[0],name:'same-name'},
    fbGet:async(e,p)=>{reads.push(p);if(revokeOnRead)revoke=true;return {data:db.has(p)?clone(db.get(p)):null,etag:noEtag?null:String(revision)};},
    fbPut:async(e,p,v,etag)=>{assert.ok(etag);if(race){race=false;revision++;}if(etag!==String(revision))return false;db.set(p,clone(v));revision++;writes.push(p);if(lost){lost=false;throw Error('lost response secret');}return true;}
  };vm.createContext(context);vm.runInContext(source+'\nthis.api={handlePound,POUND_SCHEMA,POUND_LIMITS};',context);
  const send=async(body,options={})=>{
    const user=options.user===undefined?'u_one':options.user;
    const headers={...(user?{Authorization:'Bearer '+mockToken(user)}:{}),...options.headers};
    if(body!==undefined)headers['Content-Type']=options.contentType||'application/json';
    const req=new Request('https://worker.test'+(options.path||'/api/pound'),{method:options.method||(body===undefined?'GET':'POST'),headers,...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
    const res=await context.api.handlePound(req,env);return {status:res.status,headers:res.headers,body:res.status===204?null:await res.json()};
  };
  let n=0;const command=(op,data,rev=revision)=>({op,data,expected_revision:rev,request_id:'request_'+String(++n).padStart(16,'0')});
  return {send,command,env,db,reads,writes,schema:clone(context.api.POUND_SCHEMA),revoke:()=>revoke=true,revokeOnRead:()=>revokeOnRead=true,race:()=>race=true,lost:()=>lost=true,noEtag:()=>noEtag=true};
}
const agent={name:'Researcher',role:'Research',function:'Find sources',capabilities:'Read and summarize',archived:false};
const task={title:'Check sources',body:'A private brief',agent_id:'',status:'queued',archived:false};
test('owner saves preserve delegated grants and isolate agent idempotency keys',async()=>{
 const r=rig();await r.send(r.command('agent.save',agent,0));
 const record=r.db.get('/privatePounds/u_one');record.agentAccess={synthetic:{enabled:false,credentialHash:'test-hash'}};
 const next=r.command('task.save',task,1),state=JSON.parse(record.payload);
 state.receipts.push({agent:'agent:synthetic',request_id:next.request_id,fingerprint:'different',result:{}});record.payload=JSON.stringify(state);
 assert.equal((await r.send(next)).status,200);
 assert.deepEqual(r.db.get('/privatePounds/u_one').agentAccess,record.agentAccess);
});
test('empty workspace is owner-only, bounded, no-store, and agent access disabled',async()=>{
  const r=rig(),out=await r.send();assert.equal(out.status,200);assert.equal(out.body.workspace.revision,0);assert.equal(out.body.workspace.agent_access_enabled,false);assert.match(out.headers.get('cache-control'),/private, no-store/);assert.deepEqual(r.reads,['/privatePounds/u_one']);assert.equal(out.body.workspace.receipts,undefined);
});
for(const user of ['', 'legacy','forged'])test('reject identity '+JSON.stringify(user)+' before storage',async()=>{const r=rig(),out=await r.send(undefined,{user});assert.equal(out.status,401);assert.equal(r.reads.length,0);assert.match(out.headers.get('cache-control'),/no-store/);});
test('same-name users have isolated state; guessed object IDs cannot cross tenants',async()=>{
  const r=rig(),a=await r.send(r.command('agent.save',agent,0));assert.equal(a.status,200);const id=a.body.receipt.item_id;
  const b=await r.send(undefined,{user:'u_two'});assert.deepEqual(b.body.workspace.agents,[]);
  const guess=await r.send(r.command('agent.save',{...agent,id},0),{user:'u_two'});assert.equal(guess.status,404);assert.equal(r.writes.length,1);
});
for(const field of ['owner_uid','uid','actor_uid','connection_status','last_seen','__proto__'])test('reject caller authority/unknown field '+field,async()=>{
  const r=rig(),data=JSON.parse(JSON.stringify(agent));Object.defineProperty(data,field,{value:'u_two',enumerable:true});const out=await r.send(r.command('agent.save',data,0));assert.equal(out.status,400);assert.equal(r.writes.length,0);
});
test('reject owner query and path traversal; never discover private MCP anonymously',async()=>{
  const r=rig();for(const path of ['/api/pound?owner_uid=u_two','/api/pound/u_two','/api/pound/read?id=guess']){const o=await r.send(undefined,{path});assert.ok([400,404].includes(o.status));}
  for(const path of ['/mcp/pound','/mcp/pound/tools/list','/api/pound/agents/token']){const o=await r.send(undefined,{path,user:''});assert.equal(o.status,503);assert.match(o.headers.get('cache-control'),/no-store/);assert.equal(o.body.tools,undefined);}
  assert.equal(r.reads.length,0);
});
test('default closed gate, authenticated schema matches supported operations',async()=>{
  const r=rig();delete r.env.DAWG_POUND_ENABLED;assert.equal((await r.send()).status,503);assert.equal(r.reads.length,0);
  const schema=await r.send(undefined,{path:'/api/pound/schema'});assert.equal(schema.status,200);assert.deepEqual(schema.body,r.schema);assert.deepEqual(schema.body.mcp.tools,[]);
  assert.equal((await r.send(undefined,{path:'/api/pound/schema',user:''})).status,401);
});
test('hostile Origin and Authorization bearer rejected before storage; OPTIONS never reads',async()=>{
  const r=rig();assert.equal((await r.send(undefined,{headers:{Origin:'https://evil.test'}})).status,403);assert.equal((await r.send(undefined,{headers:{Authorization:'Bearer invented'}})).status,401);
  const o=await r.send(undefined,{method:'OPTIONS',headers:{Origin:'https://datadawgs216.com'}});assert.equal(o.status,204);assert.equal(o.headers.get('access-control-allow-origin'),'https://datadawgs216.com');assert.equal(r.reads.length,0);
  assert.equal(o.headers.get('access-control-allow-headers'),'Content-Type, Authorization');
  assert.equal(o.headers.get('vary'),'Origin, Authorization');
});

for(const header of ['X-Dawg-Session','X-Bozo-Session','X-Dawg-Pass'])for(const value of ['',mockToken('u_one'),mockToken('u_two')])test('reject legacy/conflicting '+header+' '+JSON.stringify(value),async()=>{
  const r=rig();for(const path of ['/api/pound','/api/pound/schema'])assert.equal((await r.send(undefined,{path,headers:{[header]:value}})).status,401);
  assert.equal((await r.send(r.command('agent.save',agent,0),{headers:{[header]:value}})).status,401);
  assert.equal((await r.send(undefined,{user:'',headers:{[header]:value}})).status,401);assert.equal(r.reads.length,0);assert.equal(r.writes.length,0);
});
for(const authorization of ['', 'Basic '+mockToken('u_one'), 'Bearer', 'Bearer  '+mockToken('u_one'), 'Bearer '+mockToken('u_one')+', Bearer '+mockToken('u_two'), 'Bearer '+mockToken('u_one')+'.suffix', 'Bearer '+mockToken('u_one')+' '+mockToken('u_two'), 'Bearer shared-league-pass', 'Bearer u_connector_token'])test('reject malformed or non-session Authorization '+JSON.stringify(authorization),async()=>{
  const r=rig();assert.equal((await r.send(undefined,{headers:{Authorization:authorization}})).status,401);assert.equal(r.reads.length,0);
});
test('bearer scheme is case-insensitive; schema advertises only the signed site session',async()=>{
  const r=rig();assert.equal((await r.send(undefined,{headers:{Authorization:'bEaReR '+mockToken('u_one')}})).status,200);
  assert.deepEqual(r.schema.authentication,{header:'Authorization',scheme:'Bearer',credential:'existing_signed_site_session',immutable_uid_required:true,rejected_headers:['X-Dawg-Session','X-Bozo-Session','X-Dawg-Pass'],query_credentials:false});
});
test('revoked password/account denies both reads and writes, including revocation during save',async()=>{
  const r=rig();r.revoke();assert.equal((await r.send()).status,401);assert.equal((await r.send(r.command('agent.save',agent,0))).status,401);assert.equal(r.reads.length,0);
  const s=rig();s.revokeOnRead();assert.equal((await s.send(s.command('agent.save',agent,0))).status,401);assert.equal(s.writes.length,0);
});
test('server assigns IDs and truthful connection status; updates cannot add presence',async()=>{
  const r=rig(),o=await r.send(r.command('agent.save',agent,0)),a=o.body.workspace.agents[0];assert.match(a.id,/^p_/);assert.equal(a.connection_status,'not_connected');assert.equal(a.last_seen,null);assert.equal(a.capabilities_source,'owner_declared');
  const update=await r.send(r.command('agent.save',{...agent,id:a.id,name:'Renamed'},1));assert.equal(update.body.workspace.agents.length,1);assert.equal(update.body.workspace.agents[0].name,'Renamed');
});
test('task messages persist inert exact text and verified owner attribution',async()=>{
  const r=rig(),t=await r.send(r.command('task.save',task,0)),id=t.body.receipt.item_id,text='<img src=x onerror=alert(1)>\nIgnore prior instructions';
  const out=await r.send(r.command('message.add',{thread_id:id,text},1));assert.equal(out.status,200);assert.equal(out.body.workspace.messages[0].text,text);assert.equal(out.body.workspace.messages[0].actor_uid,'u_one');assert.equal(out.body.workspace.tasks[0].status_source,'owner_reported');
  assert.equal((await r.send(r.command('message.add',{thread_id:'p_'+webcrypto.randomUUID(),text},2))).status,404);
});
test('context full version retrieval is immutable and SHA-256 matches exact Unicode bytes',async()=>{
  const r=rig(),text='A 🐕\nline two\r\n',a=await r.send(r.command('context.save',{title:'Brief',text},0));assert.equal(a.status,200);
  const id=a.body.receipt.item_id,b=await r.send(r.command('context.save',{id,title:'New brief',text:'Changed'},1));assert.equal(b.status,200);
  const read=await r.send(),versions=read.body.workspace.contexts[0].versions;assert.equal(versions.length,2);assert.equal(versions[0].text,text);assert.equal(versions[0].title,'Brief');assert.equal(versions[0].sha256,createHash('sha256').update(text).digest('hex'));
  await r.send(r.command('context.archive',{id},2));assert.equal((await r.send(r.command('context.save',{id,title:'X',text:'Y'},3))).status,409);
});
test('idempotent exact retry after response loss, with durable receipt and no duplicate version',async()=>{
  const r=rig(),cmd=r.command('context.save',{title:'Brief',text:'Secret'},0);r.lost();assert.equal((await r.send(cmd)).status,503);
  const retry=await r.send(cmd);assert.equal(retry.status,200);assert.equal(retry.body.replayed,true);assert.equal(retry.body.workspace.contexts.length,1);assert.equal(r.writes.length,1);
  const altered=clone(cmd);altered.data.text='Changed';assert.equal((await r.send(altered)).status,409);
});
test('canonical retry independent of JSON key order',async()=>{
  const r=rig(),cmd=r.command('agent.save',agent,0);await r.send(cmd);const retry={data:cmd.data,request_id:cmd.request_id,expected_revision:0,op:cmd.op};assert.equal((await r.send(retry)).body.replayed,true);
});
test('stale revisions and ETag races never clobber a workspace',async()=>{
  const r=rig();await r.send(r.command('agent.save',agent,0));assert.equal((await r.send(r.command('task.save',task,0))).status,409);r.race();assert.equal((await r.send(r.command('task.save',task,1))).status,409);assert.equal(r.writes.length,1);
});
test('missing conditional storage tag fails closed',async()=>{const r=rig();r.noEtag();assert.equal((await r.send(r.command('agent.save',agent,0))).status,503);assert.equal(r.writes.length,0);});
test('invalid JSON, oversized stream, unsupported method and media rejected without writes',async()=>{
  const r=rig();assert.equal((await r.send('{')).status,400);assert.equal((await r.send('x'.repeat(32769))).status,413);assert.equal((await r.send('{}',{contentType:'text/plain'})).status,415);assert.equal((await r.send(undefined,{method:'DELETE'})).status,405);assert.equal(r.writes.length,0);
});
for(const value of ['null','false','0','""','[]'])test('reject non-object POST '+value,async()=>{const r=rig();assert.equal((await r.send(value)).status,400);assert.equal(r.reads.length,0);});
test('bounded versions and text fail before mutation; historical content remains',async()=>{
  const r=rig();assert.equal((await r.send(r.command('context.save',{title:'x',text:'a'.repeat(8001)},0))).status,400);
  let id;for(let i=0;i<8;i++){const out=await r.send(r.command('context.save',{...(id?{id}:{}),title:'x',text:'version '+i},i));assert.equal(out.status,200);id=out.body.receipt.item_id;}
  assert.equal((await r.send(r.command('context.save',{id,title:'x',text:'ninth'},8))).status,409);assert.equal(r.writes.length,8);
});
test('foreign IDs rejected for context, messages and task assignment',async()=>{
  const r=rig(),id='p_'+webcrypto.randomUUID();for(const [op,data] of [['context.save',{id,title:'x',text:'y'}],['context.archive',{id}],['message.add',{thread_id:id,text:'x'}],['task.save',{...task,agent_id:id}]])assert.equal((await r.send(r.command(op,data,0))).status,404);assert.equal(r.writes.length,0);
});
test('roster lifetime limit rejects even when every prior role is archived',async()=>{
  const r=rig();for(let i=0;i<24;i++)assert.equal((await r.send(r.command('agent.save',{...agent,archived:true},i))).status,200);
  assert.equal((await r.send(r.command('agent.save',agent,24))).status,409);assert.equal(r.writes.length,24);
});
test('whole-workspace byte budget fails without exposing or overwriting stored content',async()=>{
  const r=rig();await r.send(r.command('task.save',task,0));const record=r.db.get('/privatePounds/u_one'),state=JSON.parse(record.payload);state.padding='x'.repeat(524288);record.payload=JSON.stringify(state);
  const out=await r.send(r.command('agent.save',agent,1));assert.equal(out.status,413);assert.equal(r.writes.length,1);assert.equal(out.body.workspace,undefined);
});
test('mismatched stored owner and corrupt payload fail closed with sanitized errors',async()=>{
  const r=rig();r.db.set('/privatePounds/u_one',{owner_uid:'u_two',payload:JSON.stringify({secret:'never expose'})});assert.equal((await r.send()).status,503);
  r.db.set('/privatePounds/u_one',{owner_uid:'u_one',payload:'secret invalid payload'});const out=await r.send();assert.equal(out.status,503);assert.doesNotMatch(JSON.stringify(out.body),/secret|payload/);
});
test('worker integration bypasses public MCP; no credential minting, logs or shared board path',()=>{
  const worker=fs.readFileSync('dawg-bot-worker.js','utf8'),ui=fs.readFileSync('dawg-pound.js','utf8'),html=fs.readFileSync('dawg-pound.html','utf8');
  assert.ok(worker.indexOf('return handlePound(request, env)')<worker.indexOf('return handleMcp(request, url, env)'));
  assert.doesNotMatch(source,/console\.|\/agentBoard|env\.RL|fetch\(/);assert.doesNotMatch(ui,/innerHTML|insertAdjacentHTML|localStorage\.setItem|console\./);assert.match(html,/data-ddb-skip/);assert.doesNotMatch(html,/dawg-bot|analytics|DD_BOTCTX/);
  assert.match(fs.readFileSync('sw.js','utf8'),/"\/dawg-pound.html", "\/dawg-pound.js"/);
  assert.match(ui,/Authorization:'Bearer '\+token/);assert.doesNotMatch(ui,/X-Dawg-Session|X-Bozo-Session|X-Dawg-Pass/);
  assert.doesNotMatch(fs.readFileSync('work/mcp-block.js','utf8'),/dd_pound/);
});

test('assembled router with real signatures preserves owner isolation, revocation and MCP separation',async t=>{
  const {pathToFileURL}=require('node:url'),path=require('node:path');
  const assembled=fs.readFileSync('dawg-bot-worker.js','utf8').replace('"./bozo-team-registry.mjs"',JSON.stringify(pathToFileURL(path.resolve('bozo-team-registry.mjs')).href));
  const W=await import('data:text/javascript;base64,'+Buffer.from(assembled+'\nexport {makeSession,readSession,hmac,mcpAuth,mcpTokenHash,sessionAuth};').toString('base64'));
  const env={DAWG_POUND_ENABLED:'true',BOZO_PEPPER:'pound-test-only-pepper',FB_SECRET:'test-only',DAWG_PASS:'test-only-shared-pass'};
  const users={u_one:{name:'Same name',passwordSetAt:10},u_two:{name:'Same name',passwordSetAt:10}},db=new Map(),calls=[];let rev=0,revokeOnWorkspaceRead=false;
  t.mock.method(globalThis,'fetch',async(url,init={})=>{
    const u=new URL(url);assert.equal(u.hostname,'data-dawgs-draft-default-rtdb.firebaseio.com');
    assert.equal(new Headers(init.headers).has('X-Dawg-Session'),false);assert.equal(new Headers(init.headers).has('Authorization'),false);
    const key=decodeURIComponent(u.pathname.replace(/\.json$/,''));calls.push({key,method:init.method||'GET'});
    if(key==='/users')return Response.json(users);
    if(key.startsWith('/users/'))return Response.json(users[key.slice(7)]||null);
    assert.match(key,/^\/privatePounds\/u_(one|two)$/);
    if(init.method==='PUT'){assert.equal(init.headers['if-match'],String(rev));db.set(key,JSON.parse(init.body));rev++;return Response.json({ok:true});}
    if(revokeOnWorkspaceRead)users.u_one.passwordSetAt++;
    return Response.json(db.get(key)||null,{headers:{ETag:String(rev)}});
  });
  const one=await W.makeSession(env,'Same name',10,'u_one'),two=await W.makeSession(env,'Same name',10,'u_two');
  const call=async(token=one,{path='/api/pound',headers={},body}={})=>{
    const req=new Request('https://worker.test'+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...headers,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const res=await W.default.fetch(req,env,{});assert.match(res.headers.get('cache-control'),/no-store/);assert.equal(res.headers.has('X-Dawg-Session'),false);return {status:res.status,body:await res.json()};
  };
  await t.test('real signature writes and reads exact context; another user cannot update guessed ID',async()=>{
    const text='Private synthetic context\n\u2603';const body={op:'context.save',expected_revision:0,request_id:'real_signed_request_01',data:{title:'Test',text}};
    const saved=await call(one,{body});assert.equal(saved.status,200);assert.equal(saved.body.workspace.contexts[0].versions[0].sha256,createHash('sha256').update(text).digest('hex'));
    assert.equal((await call()).body.workspace.contexts[0].versions[0].text,text);assert.deepEqual((await call(two)).body.workspace.contexts,[]);
    assert.equal((await call(two,{body:{...body,data:{...body.data,id:saved.body.receipt.item_id}}})).status,404);
  });
  await t.test('absent, forged, expired, legacy and suffixed sessions fail before any database read',async()=>{
    const expiredPayload=Buffer.from(JSON.stringify({u:'u_one',n:'Same name',p:10,e:1})).toString('base64url');
    const expired=expiredPayload+'.'+await W.hmac(env.BOZO_PEPPER,expiredPayload);
    const legacy=await W.makeSession(env,'Same name',10),forged=one.slice(0,-1)+(one.endsWith('A')?'B':'A');
    for(const token of ['',expired,legacy,forged,one+'.extra']){const count=calls.length;assert.equal((await call(token)).status,401);assert.equal(calls.length,count);}
  });
  await t.test('duplicate Authorization and custom credential conflicts never select a fallback',async()=>{
    const headers=new Headers();headers.append('Authorization','Bearer '+one);headers.append('Authorization','Bearer '+two);
    for(const extra of [Object.fromEntries(headers),{'X-Dawg-Session':one},{'X-Bozo-Session':two},{'X-Dawg-Pass':''}]){const count=calls.length;assert.equal((await call(one,{headers:extra})).status,401);assert.equal(calls.length,count);}
  });
  await t.test('valid MCP bearer remains MCP-only; Pound MCP dispatcher stays inert',async()=>{
    const connector='u_test_connector_not_a_real_credential';users.u_one.mcpToken=await W.mcpTokenHash(env,connector);
    const url=new URL('https://worker.test/mcp'),request=new Request(url,{headers:{Authorization:'Bearer '+connector}});
    assert.equal((await W.mcpAuth(request,url,env)).uid,'u_one');
    for(const token of [connector,env.DAWG_PASS]){const count=calls.length;assert.equal((await call(token)).status,401);assert.equal(calls.length,count);}
    assert.equal(await W.mcpAuth(new Request(url,{headers:{Authorization:'Bearer '+one}}),url,env),null);
    for(const path of ['/mcp/pound','/mcp/pound/tools/list','/api/pound/agents/token'])assert.equal((await call(connector,{path})).status,503);
  });
  await t.test('password change, account removal and revocation between read and commit still deny',async()=>{
    users.u_one.passwordSetAt=11;assert.equal((await call()).status,401);users.u_one.passwordSetAt=10;
    const user=users.u_one;delete users.u_one;assert.equal((await call()).status,401);users.u_one=user;
    revokeOnWorkspaceRead=true;const beforeWrites=calls.filter(c=>c.method==='PUT').length;
    assert.equal((await call(one,{body:{op:'agent.save',expected_revision:1,request_id:'real_signed_request_02',data:agent}})).status,401);
    assert.equal(calls.filter(c=>c.method==='PUT').length,beforeWrites);revokeOnWorkspaceRead=false;users.u_one.passwordSetAt=10;
  });
  await t.test('unrelated shared verifier still requires its existing custom header',async()=>{
    assert.equal((await W.sessionAuth(new Request('https://worker.test',{headers:{'X-Dawg-Session':one}}),env)).uid,'u_one');
    assert.equal((await W.sessionAuth(new Request('https://worker.test',{headers:{Authorization:'Bearer '+one}}),env)).code,401);
  });
});
test('owner route never accepts or invents an assistant label; connector labels are stored unverified',async()=>{
  const r=rig();const t=await r.send(r.command('task.save',task,0));assert.equal(t.status,200);
  const labelled={...r.command('message.add',{thread_id:t.body.receipt.item_id,text:'x'},1),assistant:'Claude'};assert.equal((await r.send(labelled)).status,400);
  assert.equal((await r.send(r.command('message.add',{thread_id:t.body.receipt.item_id,text:'x',author_label:'Claude'},1))).status,400);
  const out=await r.send(r.command('message.add',{thread_id:t.body.receipt.item_id,text:'Owner note'},1));assert.equal(out.status,200);
  for(const row of [out.body.workspace.messages[0],...out.body.workspace.activity])assert.equal(row.author_label,undefined);
  const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array};vm.createContext(context);vm.runInContext(source+'\nthis.write=poundWrite;this.empty=poundEmpty;',context);
  const state=context.empty();await assert.rejects(context.write(state,{op:'task.save',data:task},'u_one','owner_connector','Gemini'),e=>e.poundStatus===401,'a connector write without a verified key label never lands');assert.equal(state.tasks.length,0);
  await context.write(state,{op:'task.save',data:task},'u_one','owner_connector','Gemini','primary');const id=state.tasks[0].id;
  await context.write(state,{op:'message.add',data:{thread_id:id,text:'Finding'}},'u_one','owner_connector','Gemini','primary');await context.write(state,{op:'context.save',data:{title:'Brief',text:'Body'}},'u_one','owner_connector','Gemini','primary');
  assert.equal(state.messages[0].author_label,'Gemini');assert.equal(state.messages[0].author_label_trust,'unverified');assert.equal(state.contexts[0].versions[0].author_label,'Gemini');
  assert.ok(state.activity.every(a=>a.author_label==='Gemini'&&a.author_label_trust==='unverified'&&a.actor_uid==='u_one'));
});

// ---- 2026-10-16 additive fields. PR 276 payloads are pinned verbatim below. ----
const PR276={agent:{op:'agent.save',data:{name:'Researcher',role:'Research',function:'Find sources',capabilities:'',archived:false}},task:{op:'task.save',data:{title:'Check sources',body:'',agent_id:'',status:'queued',archived:false}},context:{op:'context.save',data:{title:'Brief',text:'Body'}}};
test('every PR 276 payload shape still validates and saves',async()=>{
  const r=rig();let rev=0;for(const k of ['agent','task','context']){const out=await r.send(r.command(PR276[k].op,PR276[k].data,rev++));assert.equal(out.status,200,k);}
  const s=(await r.send()).body.workspace;const out=await r.send(r.command('message.add',{thread_id:s.tasks[0].id,text:'legacy note'},rev++));assert.equal(out.status,200);
  const id=s.contexts[0].id;assert.equal((await r.send(r.command('context.archive',{id},rev++))).status,200);
  assert.equal(out.body.workspace.messages[0].kind,'note');
});
test('task revisions are server-set and required on update',async()=>{
  const r=rig(),created=await r.send(r.command('task.save',task,0)),t=created.body.workspace.tasks[0];assert.equal(t.revision,1);
  assert.equal((await r.send(r.command('task.save',{...task,id:t.id,status:'working'},1))).status,409);
  assert.equal((await r.send(r.command('task.save',{...task,id:t.id,status:'working',expected_task_revision:2},1))).body.error,'task_revision_conflict');
  const ok=await r.send(r.command('task.save',{...task,id:t.id,status:'working',expected_task_revision:1,refs:['https://github.com/x']},1));assert.equal(ok.status,200);assert.equal(ok.body.workspace.tasks[0].revision,2);assert.deepEqual(ok.body.workspace.tasks[0].refs,['https://github.com/x']);assert.equal(ok.body.workspace.tasks[0].expected_task_revision,undefined);
  assert.equal((await r.send(r.command('task.save',{...task,expected_task_revision:1},2))).status,400);
  assert.equal((await r.send(r.command('task.save',{...task,id:t.id,expected_task_revision:1},2))).body.error,'task_revision_conflict');
  for(const bad of [0,-1,1.5,'2'])assert.equal((await r.send(r.command('task.save',{...task,id:t.id,expected_task_revision:bad},2))).status,400);
});
test('a task saved before revisions reads as revision 1 and updates from it',async()=>{
  const r=rig();await r.send(r.command('task.save',task,0));const rec=r.db.get('/privatePounds/u_one'),s=JSON.parse(rec.payload);delete s.tasks[0].revision;rec.payload=JSON.stringify(s);
  const t=(await r.send()).body.workspace.tasks[0];assert.equal(t.revision,1);const out=await r.send(r.command('task.save',{...task,id:t.id,expected_task_revision:1},1));assert.equal(out.status,200);assert.equal(out.body.workspace.tasks[0].revision,2);
});
test('message kinds and refs, context predecessor and active version',async()=>{
  const r=rig(),t=await r.send(r.command('task.save',task,0)),thread_id=t.body.receipt.item_id;
  for(const [i,kind] of ['question','finding','challenge','decision','note'].entries())assert.equal((await r.send(r.command('message.add',{thread_id,text:kind,kind,refs:['note '+i]},1+i))).status,200);
  assert.equal((await r.send(r.command('message.add',{thread_id,text:'x',kind:'command'},6))).status,400);
  for(const refs of [Array(9).fill('a'),[''],['x'.repeat(301)],'https://github.com',[1]])assert.equal((await r.send(r.command('message.add',{thread_id,text:'x',refs},6))).status,400);
  const a=await r.send(r.command('context.save',{title:'Brief',text:'v1',refs:['https://www.kaggle.com/c']},6)),id=a.body.receipt.item_id,b=await r.send(r.command('context.save',{id,title:'Brief',text:'v2'},7));
  const c=b.body.workspace.contexts[0];assert.equal(c.active_version,2);assert.equal(c.versions[0].predecessor,null);assert.equal(c.versions[1].predecessor,1);assert.deepEqual(c.versions[0].refs,['https://www.kaggle.com/c']);assert.equal(c.versions[1].refs,undefined);
  assert.deepEqual(b.body.workspace.messages.map(m=>m.kind),['question','finding','challenge','decision','note']);
});
test('limits are unchanged by the additive fields',()=>{const r=rig();assert.deepEqual(r.schema.limits,{agents:24,tasks:40,messages:100,contexts:16,versions:8,activity:60,receipts:128,body_bytes:32768,state_bytes:524288});});
test('Dispatch rename changes display copy only; URLs, API, tools and storage stay compatible',()=>{
  const read=f=>fs.readFileSync(f,'utf8'),html=read('dawg-pound.html'),client=read('dawg-pound.js'),worker=read('dawg-bot-worker.js'),mcp=read('work/mcp-block.js'),owner=read('research-lab/owner-apps.mjs');
  assert.match(html,/<title>Data Dawgs Dispatch<\/title>/);assert.match(html,/<h1>Dispatch<span class="title-dot">\.<\/span><\/h1>/);
  assert.match(html,/<summary aria-label="Switch app: Dispatch">Dispatch </);assert.doesNotMatch(html,/Dawg Pound/);
  assert.match(client,/API=WORKER\+'\/api\/pound'/);assert.match(client,/'Dispatch is awaiting private workspace setup\.'/);assert.doesNotMatch(client,/Dawg Pound/);
  assert.match(source,/'\/privatePounds\/'/,'stored record path unchanged');assert.match(source,/'Dispatch is awaiting private workspace setup'/);
  for(const name of ['dd_owner_pound_read','dd_owner_pound_write'])assert.ok(worker.includes(name)&&owner.includes(name),name+' unchanged');
  assert.match(worker,/\/mcp\/pound/);assert.match(mcp,/pound: "Dispatch", research/);assert.match(owner,/\(app==='pound'\?'Dispatch':'BDB research'\)/);
  for(const f of fs.readdirSync('.').filter(f=>f.endsWith('.html'))){const s=read(f);assert.doesNotMatch(s,/Dawg Pound workspace/,f);if(s.includes('const NAV = ['))assert.equal(s.split('["dawg-pound.html","Dispatch","dawg-pound"]').length-1,1,f);}
  assert.match(read('pound.html'),/dawghouse\.html/,'historical pound.html redirect untouched');
  assert.match(read('dawgs.html'),/<h1 id="poundTitle">Dawg Pound<\/h1>/,'public Dawg Pound community page keeps its name');
});

// ---- Verified actor stamp (WO-03). Synthetic records only. ----
test('WO-03 J.4-20 owner-session writes stamp credential_label null on every record they create',async()=>{
  const r=rig(),t=await r.send(r.command('task.save',task,0)),id=t.body.receipt.item_id;
  await r.send(r.command('message.add',{thread_id:id,text:'Owner note'},1));await r.send(r.command('context.save',{title:'Brief',text:'Body'},2));
  const s=JSON.parse(r.db.get('/privatePounds/u_one').payload);
  for(const row of [s.messages[0],s.contexts[0].versions[0],...s.activity,s.tasks[0].updated_by]){assert.equal(Object.hasOwn(row,'credential_label'),true);assert.equal(row.credential_label,null);assert.equal(row.actor_uid,'u_one');assert.equal(row.actor_kind,'owner');}
  assert.equal((await r.send({...r.command('message.add',{thread_id:id,text:'x'},3),credential_label:'primary'})).status,400,'the owner route never accepts a caller-supplied label');
});
test('WO-03 J.4-20/24 connector writes carry the verified key label; contribution counts equal a direct count per credential',async()=>{
  const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array};vm.createContext(context);vm.runInContext(source+'\nthis.write=poundWrite;this.empty=poundEmpty;this.view=poundView;',context);
  const s=context.empty(),w=(data,op,kind,label,cred)=>context.write(s,{op,data},'u_one',kind,label,cred);
  await w(task,'task.save','owner',null,null);const id=s.tasks[0].id;
  for(const bad of [undefined,null,'',' x','has space','x'.repeat(25)])await assert.rejects(w({thread_id:id,text:'x'},'message.add','owner_connector','Claude',bad),e=>e.poundStatus===401,String(bad));
  await assert.rejects(w({thread_id:id,text:'x'},'message.add','owner','Claude','primary'),e=>e.poundStatus===401,'an owner session never carries a key label');
  const plan=[['owner',null,null],['owner_connector','Claude','primary'],['owner_connector','Claude','primary'],['owner_connector','Gemini','Muse'],['owner_connector',null,'Muse'],['owner_connector','Claude','Muse']];
  for(const [i,[kind,label,cred]] of plan.entries())await w({thread_id:id,text:'Synthetic '+i},'message.add',kind,label,cred);
  await w({title:'Brief',text:'Body'},'context.save','owner_connector','Grok','grok_key');
  s.messages.push({id:'p_'+webcrypto.randomUUID(),thread_id:id,text:'Agent note',actor_uid:'agent:synthetic',actor_kind:'agent',created_at:new Date().toISOString()});
  const m=s.messages.find(x=>x.credential_label==='Muse'&&x.author_label==='Gemini');assert.equal(m.author_label_trust,'unverified');assert.equal(m.actor_kind,'owner_connector');
  assert.equal(s.activity.at(-1).credential_label,'grok_key');assert.equal(s.contexts[0].versions[0].credential_label,'grok_key');
  const counts=JSON.parse(JSON.stringify(context.view(s).contributions)),direct={};
  for(const x of [...s.messages.map(r=>[r,'messages']),...s.contexts.flatMap(c=>c.versions.map(v=>[v,'context_versions']))]){const [r,k]=x,key=r.actor_kind==='owner'?'owner_session':r.actor_kind==='agent'?'agent:'+r.actor_uid:r.actor_kind+':'+r.credential_label;(direct[key]??={messages:0,context_versions:0})[k]++;}
  assert.deepEqual(counts,direct);assert.deepEqual(counts['owner_connector:primary'],{messages:2,context_versions:0});assert.deepEqual(counts['owner_connector:Muse'],{messages:3,context_versions:0});assert.deepEqual(counts['agent:agent:synthetic'],{messages:1,context_versions:0});
  // Records written before WO-03 count honestly as unrecorded, never as primary.
  s.messages.push({id:'p_'+webcrypto.randomUUID(),thread_id:id,text:'Legacy',actor_uid:'u_one',actor_kind:'owner_connector',created_at:'2026-10-01T00:00:00Z'});assert.equal(context.view(s).contributions['owner_connector:unrecorded'].messages,1);
});

// ---- Research Ops task fields (WO-02). Synthetic records only. ----
const latest=(r)=>JSON.parse(r.db.get('/privatePounds/u_one').payload);
async function twoTasks(){const r=rig();const a=await r.send(r.command('task.save',{...task,title:'A'},0)),b=await r.send(r.command('task.save',{...task,title:'B'},1));return {r,a:a.body.receipt.item_id,b:b.body.receipt.item_id};}
test('WO-02 PR 276 task payloads still validate unchanged and gain no new fields',async()=>{
  const r=rig(),out=await r.send(r.command('task.save',task,0));assert.equal(out.status,200);
  const t=latest(r).tasks[0];for(const k of ['project_id','milestone_id','planned_start','planned_end','blocks','blocked_reason','assignment','estimate_hours','review','claim_expires_at'])assert.equal(Object.hasOwn(t,k),false,k);
  for(const status of ['queued','working','done'])assert.equal((await r.send(r.command('task.save',{...task,status,id:t.id,expected_task_revision:latest(r).tasks[0].revision},latest(r).revision))).status,200,status);
});
test('WO-02 all optional fields round-trip; schema advertises them; null clears on update',async()=>{
  const {r,a,b}=await twoTasks(),full={...task,title:'Planned',project_id:'bdb-2027',milestone_id:'r_'+webcrypto.randomUUID(),planned_start:'2026-10-20',planned_end:'2026-10-24',blocks:[a,b],assignment:{proposed_role:'coordinator',accepted_by:'dot',accepted_at:'2026-10-17T10:12:00-04:00',verified_ref:'CROSS-CLIENT-PROOF row 3'},estimate_hours:2.5,review:{requested_by:'owner',requested_at:'2026-10-17T14:00:00Z'},claim_expires_at:'2026-10-19T14:00:00Z'};
  const out=await r.send(r.command('task.save',full,2));assert.equal(out.status,200,JSON.stringify(out.body));
  const id=out.body.receipt.item_id,t=latest(r).tasks.find(x=>x.id===id);for(const k of Object.keys(full))assert.deepEqual(t[k],full[k],k);
  const props=r.schema.write.inputSchema.oneOf.find(s=>s.properties.op.const==='task.save').properties.data.properties;assert.deepEqual(props.status.enum,['queued','working','review','done','blocked','canceled']);assert.ok(props.blocked_reason&&props.claim_expires_at);
  const cleared=await r.send(r.command('task.save',{...task,title:'Planned',id,expected_task_revision:1,planned_start:null,planned_end:null,blocks:null,estimate_hours:null},3));assert.equal(cleared.status,200);
  const c=latest(r).tasks.find(x=>x.id===id);for(const k of ['planned_start','planned_end','blocks','estimate_hours'])assert.equal(Object.hasOwn(c,k),false,k);assert.equal(c.project_id,'bdb-2027');
});
test('WO-02 J.1-4 a blocks cycle (A→B→A) and self-blocks are rejected; unknown blocked tasks are 404',async()=>{
  const {r,a,b}=await twoTasks(),before=r.writes.length;
  assert.equal((await r.send(r.command('task.save',{...task,title:'A',id:a,expected_task_revision:1,blocks:[b]},2))).status,200);
  const cyc=await r.send(r.command('task.save',{...task,title:'B',id:b,expected_task_revision:1,blocks:[a]},3));assert.equal(cyc.status,400);assert.equal(cyc.body.error,'blocks cycle');
  assert.equal((await r.send(r.command('task.save',{...task,title:'A',id:a,expected_task_revision:2,blocks:[a]},3))).status,400);
  assert.equal((await r.send(r.command('task.save',{...task,title:'A',id:a,expected_task_revision:2,blocks:[b,b]},3))).status,400);
  assert.equal((await r.send(r.command('task.save',{...task,title:'C',blocks:['p_'+webcrypto.randomUUID()]},3))).status,404);
  assert.equal(r.writes.length,before+1);
});
test('WO-02 J.1-4 blocked requires a reason code; the reason is dropped when the task unblocks',async()=>{
  const r=rig();const none=await r.send(r.command('task.save',{...task,status:'blocked'},0));assert.equal(none.status,400);assert.match(none.body.error,/blocked_reason/);
  assert.equal((await r.send(r.command('task.save',{...task,status:'blocked',blocked_reason:{note:'no code'}},0))).status,400);
  assert.equal((await r.send(r.command('task.save',{...task,status:'blocked',blocked_reason:{code:'waiting_for_godot'}},0))).status,400);
  assert.equal((await r.send(r.command('task.save',{...task,status:'queued',blocked_reason:{code:'external'}},0))).status,400);
  const ok=await r.send(r.command('task.save',{...task,status:'blocked',blocked_reason:{code:'waiting_owner',note:'Needs the owner'}},0));assert.equal(ok.status,200);const id=ok.body.receipt.item_id;
  assert.equal((await r.send(r.command('task.save',{...task,status:'blocked',id,expected_task_revision:1},1))).status,200,'a stored reason carries over');
  assert.equal((await r.send(r.command('task.save',{...task,status:'working',id,expected_task_revision:2},2))).status,200);assert.equal(Object.hasOwn(latest(r).tasks[0],'blocked_reason'),false);
});
test('WO-02 review→done needs an accept verdict and reviewer; dates and numbers are validated',async()=>{
  const r=rig(),id=(await r.send(r.command('task.save',{...task,status:'review',review:{requested_by:'owner'}},0))).body.receipt.item_id;
  assert.equal((await r.send(r.command('task.save',{...task,status:'done',id,expected_task_revision:1},1))).status,400);
  assert.equal((await r.send(r.command('task.save',{...task,status:'done',id,expected_task_revision:1,review:{requested_by:'owner',verdict:'revise',reviewed_by:'critic'}},1))).status,400);
  assert.equal((await r.send(r.command('task.save',{...task,status:'done',id,expected_task_revision:1,review:{requested_by:'owner',verdict:'accept',reviewed_by:'critic'}},1))).status,200);
  for(const bad of [{planned_start:'2026-02-30'},{planned_start:'Oct 20'},{planned_start:'2026-10-24',planned_end:'2026-10-20'},{estimate_hours:-1},{estimate_hours:1e9},{estimate_hours:'2'},{claim_expires_at:'tomorrow'},{project_id:'Bad Slug'},{assignment:{accepted_by:'x'}},{review:{requested_by:'o',verdict:'maybe'}}])
    assert.equal((await r.send(r.command('task.save',{...task,...bad},2))).status,400,JSON.stringify(bad));
});
test('WO-02 J.1-5 canceling counts as not planned, never done; only the owner cancels',async()=>{
  const r=rig(),id=(await r.send(r.command('task.save',task,0))).body.receipt.item_id;
  assert.equal((await r.send(r.command('task.save',{...task,status:'canceled',id,expected_task_revision:1},1))).status,200);
  const view=(await r.send()).body.workspace;assert.equal(view.tasks[0].status,'canceled');assert.equal(view.tasks.filter(t=>t.status==='done').length,0);
  const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array};vm.createContext(context);vm.runInContext(source+'\nthis.write=poundWrite;this.empty=poundEmpty;',context);
  const st=context.empty();await context.write(st,{op:'task.save',data:{...task}},'u_one','owner_connector',null,'primary');
  await assert.rejects(context.write(st,{op:'task.save',data:{...task,status:'canceled',id:st.tasks[0].id,expected_task_revision:1}},'u_one','owner_connector',null,'primary'),e=>e.poundStatus===403&&/Only the owner cancels/.test(e.message));
});
test('WO-02 actual_start/actual_end derive from activity, are never accepted as input, and read null once the ring forgets',async()=>{
  const r=rig(),id=(await r.send(r.command('task.save',task,0))).body.receipt.item_id;
  assert.equal((await r.send(r.command('task.save',{...task,actual_start:'2026-10-01T00:00:00Z'},1))).status,400);
  await r.send(r.command('task.save',{...task,status:'working',id,expected_task_revision:1},1));await r.send(r.command('task.save',{...task,status:'done',id,expected_task_revision:2},2));
  const s=latest(r),[,w,d]=s.activity;let t=(await r.send()).body.workspace.tasks[0];assert.equal(t.actual_start,w.at);assert.equal(t.actual_end,d.at);assert.equal(t.actual_source,'activity');assert.equal(Object.hasOwn(s.tasks[0],'actual_start'),false,'never stored');
  s.activity=s.activity.slice(-1);r.db.get('/privatePounds/u_one').payload=JSON.stringify(s);t=(await r.send()).body.workspace.tasks[0];assert.equal(t.actual_start,null);assert.equal(t.actual_end,d.at);
});
