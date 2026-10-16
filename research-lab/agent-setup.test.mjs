import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createAgentSetup} from './agent-setup.mjs';
const rid='p_'+'a'.repeat(36),tid='p_'+'b'.repeat(36),cid='p_'+'c'.repeat(36);
function fixture(){
 let owner='u_owner',n=1,writes=0,race=false,lost=false,authCalls=0,revokeSession=false;
 const records={pound:{owner_uid:owner,payload:JSON.stringify({agents:[{id:rid,name:'Claude',archived:false}],tasks:[{id:tid,title:'Test',agent_id:rid,archived:false}],contexts:[{id:cid,title:'Brief',versions:[{version:1,text:'Approved'},{version:2,text:'Private'}]}],receipts:[]})},research:{version:1,access:{users:{u_owner:{enabled:true,owner:true,capabilities:['research:read']}}},payload:'{"state":{"version":1},"inputs":{}}'}};
 const env={AGENT_SETUP_ENABLED:'true',RESEARCH_OWNER_UID:'u_owner',RESEARCH_UPLOAD_TENANT:'test'};
 const handler=createAgentSetup({now:()=>1000,ownerIdentity:async()=>{authCalls++;return revokeSession&&authCalls>1?'u_changed':owner;},fbGet:async(e,p)=>({etag:String(n),data:structuredClone(records[p.startsWith('/private')?'pound':'research'])}),fbPut:async(e,p,v,tag)=>{if(race)n++;if(tag!==String(n))return false;records[p.startsWith('/private')?'pound':'research']=structuredClone(v);n++;writes++;if(lost)throw Error('lost');return true;}});
 const call=async(body,opts={})=>{const r=await handler(new Request(opts.url||'https://test/agent-setup/v1',{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...opts.headers},...(body?{body:JSON.stringify(body)}:{})}),opts.env||env);return {status:r.status,body:await r.json(),headers:r.headers};};
 return {call,records,env,get writes(){return writes;},foreign:()=>owner='u_other',race:()=>race=true,lost:()=>lost=true,revokeSession:()=>revokeSession=true};
}
const issue={action:'issue',audience:'pound',rosterId:rid,taskId:tid,contextId:cid,contextVersion:1};
test('setup default disabled, exact owner and origin boundary',async()=>{
 const f=fixture();assert.equal((await f.call(null,{env:{...f.env,AGENT_SETUP_ENABLED:undefined}})).status,503);
 assert.equal((await f.call(null,{headers:{Origin:'https://evil.test'}})).status,403);
 assert.equal((await f.call(null,{url:'https://test/agent-setup/v1?token=x'})).status,404);
 f.foreign();assert.equal((await f.call()).status,403);assert.equal(f.writes,0);
});
test('one-time secret, exact7day expiry, hash-only storage, resource selection and no enablement',async()=>{
 const f=fixture(),before=f.records.pound.payload,r=await f.call(issue);assert.equal(r.status,200);assert.match(r.body.secret,/^da1_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/);
 const grant=f.records.pound.agentAccess[r.body.id];assert.equal(grant.credentialHash,createHash('sha256').update(r.body.secret).digest('hex'));assert.equal(grant.expiresAt,1000+7*86400000);assert.deepEqual(grant.contextVersions,{[cid]:[1]});assert.deepEqual(grant.taskIds,[tid]);assert.equal(f.records.pound.payload,before);assert.equal(JSON.stringify(f.records).includes(r.body.secret),false);assert.equal(r.body.delegatedEnabled,false);
 const list=await f.call();assert.equal(JSON.stringify(list.body).includes(grant.credentialHash),false);assert.equal(JSON.stringify(list.body).includes('Approved'),false);assert.equal(list.body.grants[0].status,'issued_not_connection_verified');assert.match(r.headers.get('Cache-Control'),/no-store/);
 assert.equal((await f.call(issue)).status,409);
 const revoked=await f.call({action:'revoke',audience:'pound',agentId:r.body.id});assert.equal(revoked.status,200);assert.equal(f.records.pound.agentAccess[r.body.id].enabled,false);assert.equal(revoked.body.secret,undefined);
 assert.equal((await f.call(issue)).status,200);
});
test('arbitrary scopes, foreign resources, versions, target owners and lifetimes denied',async()=>{
 for(const b of [{...issue,scopes:['admin']},{...issue,expiresAt:99999999999},{...issue,owner:'u_other'},{...issue,contextVersion:3},{...issue,taskId:'p_foreign'}]){const f=fixture();assert.equal((await f.call(b)).status,400);assert.equal(f.writes,0);}
});
test('research issuance preserves state and owner grants; separate audience revocation',async()=>{
 const f=fixture(),before=structuredClone(f.records.research),r=await f.call({action:'issue',audience:'research'});assert.equal(r.status,200);
 assert.deepEqual(f.records.research.access.users,before.access.users);assert.equal(f.records.research.payload,before.payload);const g=f.records.research.access.delegated[r.body.id];assert.equal(g.audience,'research:test');assert.ok(!g.capabilities.includes('experiment:run'));
 assert.equal((await f.call({action:'revoke',audience:'pound',agentId:r.body.id})).status,404);assert.equal(g.enabled,true);
});
test('CAS conflict/session change cannot issue; lost response leaves one revocable grant',async()=>{
 const race=fixture();race.race();assert.equal((await race.call(issue)).status,409);assert.equal(race.writes,0);
 const auth=fixture();auth.revokeSession();assert.equal((await auth.call(issue)).status,401);assert.equal(auth.writes,0);
 const lost=fixture();lost.lost();assert.equal((await lost.call(issue)).status,503);assert.equal(lost.writes,1);assert.equal((await lost.call(issue)).status,409);assert.equal((await lost.call()).body.grants.length,1);
});

test('expired research owner cannot mint delegated access',async()=>{const f=fixture();f.records.research.access.users.u_owner.expiresAt=999;assert.equal((await f.call({action:'issue',audience:'research'})).status,403);assert.equal(f.writes,0);});
