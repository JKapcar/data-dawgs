import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createPoundAgentGateway} from './pound-agent-gateway.mjs';
import {createResearchGateway} from './gateway.mjs';import {transition,view} from './worker-core.mjs';import {initialState} from './machine-core.mjs';
const aid='a'.repeat(32),token='da1_'+aid+'_'+'x'.repeat(43),credentialHash=createHash('sha256').update(token).digest('hex');
const owner='u_owner',roster='p_'+'a'.repeat(36),task='p_'+'b'.repeat(36),context='p_'+'c'.repeat(36),other='p_'+'d'.repeat(36);
const env={DAWG_POUND_ENABLED:'true',DELEGATED_AGENTS_ENABLED:'true',RESEARCH_LAB_ENABLED:'true'};
function fixture(research=false){
 let clock=1000,etag=1,puts=0,beforePut;
 const grant={enabled:true,expiresAt:100000,credentialHash,audience:research?'research:test':'pound:'+owner,capabilities:research?['research:read','hypothesis:write','evidence:write','discussion:write']:['pound:roster:read','pound:task:read','pound:context:read','pound:message:append','pound:task:update-own'],rosterId:roster,rosterIds:[roster],taskIds:[task],contextVersions:{[context]:[1]}};
 let record=research?{version:1,access:{delegated:{[aid]:grant}},state:initialState(),inputs:{}}:{owner_uid:owner,agentAccess:{[aid]:grant},payload:JSON.stringify({revision:0,agents:[{id:roster,name:'Test agent',role:'Researcher',archived:false},{id:other,name:'Private'}],tasks:[{id:task,agent_id:roster,title:'Shared',archived:false},{id:other,agent_id:other,title:'Secret'}],messages:[],contexts:[{id:context,versions:[{version:1,text:'Approved'},{version:2,text:'Not approved'}]}],activity:[],receipts:[]})};
 const deps={now:()=>clock,fbGet:async(e,path)=>({data:structuredClone(record),etag:String(etag)}),fbPut:async(e,path,data,tag)=>{if(beforePut){const f=beforePut;beforePut=null;f();}if(tag!==String(etag))return false;record=structuredClone(data);etag++;puts++;return true;}};
 const handler=research?createResearchGateway({...deps,sessionAuth:()=>{throw Error('Owner auth must not run');},mcpAuth:()=>{throw Error('Broad MCP must not run');},transition,view,codeHash:'a'.repeat(64)}):createPoundAgentGateway(deps);
 const url=research?'https://test/research/v1/tenants/test/mcp':'https://test/agents/v1/owners/'+owner+'/mcp';
 const call=async(name,args={},opts={})=>{const r=await handler(new Request(opts.url||url,{method:'POST',headers:{Authorization:'Bearer '+(opts.token||token),'Content-Type':'application/json',...opts.headers},body:JSON.stringify(opts.rpc||{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),opts.env||env);return {status:r.status,data:r.status===202?null:await r.json()};};
 return {call,get record(){return record;},get grant(){return research?record.access.delegated[aid]:record.agentAccess[aid];},get puts(){return puts;},advance:()=>clock=100001,revoke:()=>{(research?record.access.delegated[aid]:record.agentAccess[aid]).enabled=false;etag++;},race:f=>beforePut=f};
}
const result=r=>JSON.parse(r.data.result.content[0].text);
test('disabled, wrong token/audience, expired and revoked agents fail closed',async()=>{
 for(const research of [false,true]){
  const f=fixture(research),name=research?'research_state':'pound_tasks';
  assert.equal((await f.call(name,{}, {env:{...env,DELEGATED_AGENTS_ENABLED:'false'}})).status,503);
  assert.equal((await f.call(name,{}, {token:token.slice(0,-1)+'z'})).status,403);
  assert.equal((await f.call(name,{}, {url:research?'https://test/research/v1/tenants/foreign/mcp':'https://test/agents/v1/owners/u_foreign/mcp'})).status,403);
  f.advance();assert.equal((await f.call(name)).status,403);
  const r=fixture(research);r.revoke();assert.equal((await r.call(name)).status,403);
 }
});
test('Pound shares only assigned resources and selected context versions',async()=>{
 const f=fixture();assert.equal(result(await f.call('pound_roster')).result.length,1);
 assert.equal(result(await f.call('pound_tasks')).result.length,1);
 assert.equal(result(await f.call('pound_context',{id:context,version:1})).result.version.text,'Approved');
 assert.equal((await f.call('pound_context',{id:context,version:2})).status,403);
 assert.equal((await f.call('pound_context',{id:other,version:1})).status,403);
 assert.equal((await f.call('pound_message',{key:'request_1234567890',revision:0,thread_id:other,text:'No'})).status,403);
 assert.equal(result(await f.call('pound_tasks')).connection_status,'authenticated_request');
 assert.equal(f.puts,0);
});
test('Pound attributed write, replay, conflict and atomic revocation',async()=>{
 const f=fixture(),args={key:'request_1234567890',revision:0,thread_id:task,text:'<script>untrusted</script>'};
 assert.equal((await f.call('pound_message',args)).status,200);
 assert.equal(result(await f.call('pound_message',args)).result.replayed,true);assert.equal(f.puts,1);
 assert.equal((await f.call('pound_message',{...args,text:'different'})).status,409);
 const state=JSON.parse(f.record.payload);assert.equal(state.messages[0].actor_uid,'agent:'+aid);assert.equal(state.messages[0].text,args.text);assert.equal(f.grant.enabled,true);
 const race=fixture();race.race(()=>race.revoke());assert.equal((await race.call('pound_message',args)).status,409);assert.equal(race.puts,0);
 assert.equal((await race.call('pound_message',args)).status,403);
});
test('MCP notifications, discovery allowlists and excluded execution',async()=>{
 for(const research of [false,true]){
  const f=fixture(research);assert.equal((await f.call('',{}, {rpc:{jsonrpc:'2.0',method:'notifications/initialized'}})).status,202);
  const list=await f.call('',{}, {rpc:{jsonrpc:'2.0',id:2,method:'tools/list'}});assert.equal(list.status,200);
  assert.ok(!list.data.result.tools.some(t=>/run|claim|grant|download/.test(t.name)));
  assert.equal((await f.call(research?'research_run':'pound_grant',{})).status,research?403:403);
 }
});
test('research identities retain independent attribution and replay; deny others hypotheses',async()=>{
 const f=fixture(true),args={key:'h1',payload:{title:'Question',method:'Exploratory'}};
 const one=await f.call('research_hypothesis',args);assert.equal(one.status,200);const h=result(one);
 assert.equal(h.revisions[0].subject,'agent:'+aid);
 assert.equal(result(await f.call('research_hypothesis',args)).id,h.id);
 f.record.state.hypotheses[0].revisions[0].subject='other';
 assert.equal((await f.call('research_hypothesis',{key:'h2',payload:{id:h.id,expectedVersion:1,title:'Overwrite',method:'No'}})).status,403);
});
test('research revocation racing conditional writes cannot commit',async()=>{
 const f=fixture(true);f.race(()=>f.revoke());
 assert.equal((await f.call('research_hypothesis',{key:'h1',payload:{title:'Question',method:'Test'}})).status,403);
 assert.equal(f.record.state.hypotheses.length,0);
});
test('Pound agent learns revision from scoped reads and recovers after owner changes',async()=>{
 const f=fixture(),read=()=>f.call('pound_tasks');
 const revision=result(await read()).revision;
 assert.equal((await f.call('pound_progress',{key:'progress_12345678',revision,task_id:task,status:'working'})).status,200);
 const state=JSON.parse(f.record.payload);state.revision++;f.record.payload=JSON.stringify(state);
 assert.equal((await f.call('pound_progress',{key:'progress_23456789',revision:revision+1,task_id:task,status:'done'})).status,409);
 const fresh=result(await read()).revision;
 assert.equal((await f.call('pound_progress',{key:'progress_23456789',revision:fresh,task_id:task,status:'done'})).status,200);
});
