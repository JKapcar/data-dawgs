const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const source=fs.readFileSync('work/dawg-pound.js','utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
function rig(){
  const db=new Map(),reads=[],writes=[];let revision=0,revoke=false,race=false,lost=false,noEtag=false,revokeOnRead=false;
  const env={DAWG_POUND_ENABLED:'true'};
  const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Request,Response,URL,Date,
    ORIGINS:['https://datadawgs216.com'],
    readSession:async(e,t)=>t==='legacy'?{n:'same-name'}:['u_one','u_two'].includes(t)?{u:t}:null,
    sessionAuth:async r=>revoke?{err:'revoked'}:{uid:r.headers.get('X-Dawg-Session'),name:'same-name'},
    fbGet:async(e,p)=>{reads.push(p);if(revokeOnRead)revoke=true;return {data:db.has(p)?clone(db.get(p)):null,etag:noEtag?null:String(revision)};},
    fbPut:async(e,p,v,etag)=>{assert.ok(etag);if(race){race=false;revision++;}if(etag!==String(revision))return false;db.set(p,clone(v));revision++;writes.push(p);if(lost){lost=false;throw Error('lost response secret');}return true;}
  };vm.createContext(context);vm.runInContext(source+'\nthis.api={handlePound,POUND_SCHEMA,POUND_LIMITS};',context);
  const send=async(body,options={})=>{
    const headers={'X-Dawg-Session':options.user===undefined?'u_one':options.user,...options.headers};
    if(body!==undefined)headers['Content-Type']=options.contentType||'application/json';
    const req=new Request('https://worker.test'+(options.path||'/api/pound'),{method:options.method||(body===undefined?'GET':'POST'),headers,...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
    const res=await context.api.handlePound(req,env);return {status:res.status,headers:res.headers,body:res.status===204?null:await res.json()};
  };
  let n=0;const command=(op,data,rev=revision)=>({op,data,expected_revision:rev,request_id:'request_'+String(++n).padStart(16,'0')});
  return {send,command,env,db,reads,writes,schema:clone(context.api.POUND_SCHEMA),revoke:()=>revoke=true,revokeOnRead:()=>revokeOnRead=true,race:()=>race=true,lost:()=>lost=true,noEtag:()=>noEtag=true};
}
const agent={name:'Researcher',role:'Research',function:'Find sources',capabilities:'Read and summarize',archived:false};
const task={title:'Check sources',body:'A private brief',agent_id:'',status:'queued',archived:false};
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
  assert.doesNotMatch(fs.readFileSync('work/mcp-block.js','utf8'),/dd_pound/);
});
