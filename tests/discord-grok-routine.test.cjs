const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// Reuse the existing signed Discord + CAS RTDB harness, without registering its tests.
const base=fs.readFileSync('tests/discord-pack.test.cjs','utf8').split("\ntest('")[0];
const fixture=new Function('require',base+'\nreturn fixture;')(require);
async function ready(){
 const f=await fixture();vm.runInContext(fs.readFileSync('work/discord-grok-routine.js','utf8'),f.ctx);
 await f.link();Object.assign(f.env,{DISCORD_GROK_WAKE_ENABLED:'true',DISCORD_GROK_INCLUDED_USAGE_CONFIRMED:'true',DISCORD_GROK_USER_ID:'45678901234567890',DISCORD_GROK_APPROVAL_EXPIRES_AT:new Date(f.now+3600e3).toISOString(),GROK_ROUTINE_URL:'https://routine.example.com/opaque',GROK_ROUTINE_ORIGIN:'https://routine.example.com',GROK_ROUTINE_TOKEN:'synthetic-secret-not-real',DISCORD_PACK_SEATS:JSON.stringify({grok:{key_label:'pack-grok'}})});
 f.callers.owner.keyLabel='pack-grok';const get=f.ctx.fbGet,fetch=f.ctx.fetch;f.hash='test-hash';f.wakes=[];f.response=200;
 f.ctx.fbGet=async(e,path,...args)=>path==='/users'?{data:{u_owner:{mcpTokens:{'pack-grok':{hash:f.hash}}}}}:get(e,path,...args);
 f.ctx.fetch=async(url,opts)=>{if(url!==f.env.GROK_ROUTINE_URL)return fetch(url,opts);const body=JSON.parse(opts.body);assert.deepEqual(Object.keys(body),['job_id']);assert.equal(f.store().jobs[body.job_id].wake.status,'sending');f.wakes.push(body);assert.equal(opts.redirect,'manual');if(f.response==='lost')throw Error('uncertain');return new Response(null,{status:f.response});};
 f.ask=opts=>f.slash({to:'grok',...opts});return f;
}
test('default off, billing confirmation and approval expiry fail closed',async()=>{
 for(const key of ['DISCORD_GROK_WAKE_ENABLED','DISCORD_GROK_INCLUDED_USAGE_CONFIRMED','DISCORD_GROK_APPROVAL_EXPIRES_AT']){const f=await ready();delete f.env[key];assert.match((await f.ask()).text,/Nothing was queued/);assert.equal(f.wakes.length,0);}
});
test('persist before wake without polling lease; duplicate interaction wakes once',async()=>{
 const f=await ready();const q=await f.ask();assert.equal(f.wakes.length,1);assert.equal(f.store().jobs[q.id].wake.status,'accepted');await f.ask({interaction:q.id});assert.equal(f.wakes.length,1);
 const lease=await f.bind();assert.equal((await f.tool('owner','dd_pack_read',{lease,id:q.id})).body.job.wake.receipt_acknowledged,true);
 assert.ok((await f.tool('owner','dd_pack_claim',{lease,id:q.id})).ok);
 assert.ok((await f.tool('owner','dd_pack_answer',{lease,id:q.id,text:'Synthetic pong.'})).ok);
 const read=await f.tool('owner','dd_pack_read',{lease,id:q.id});assert.equal(read.body.job.delivery,'delivered');assert.equal(read.body.job.wake.execution_verified,false);
 const next=await f.ask({to:null,channel:read.body.job.thread_id});assert.ok(next.id);assert.equal(f.wakes.length,2);
});
test('concurrent requests serialize; timeout does not permit another wake',async()=>{
 const f=await ready();await Promise.all([f.ask(),f.ask()]);assert.equal(f.wakes.length,1);f.advance(21*60e3);await f.ctx.dgDrain(f.env);assert.equal(f.wakes.length,1);
});
test('429 retries bounded; timeout, 500 and redirect never retried',async()=>{
 const f=await ready();f.response=429;const q=await f.ask();for(let n=0;n<5;n++){f.advance(120000);await f.ctx.dgDrain(f.env);}assert.equal(f.wakes.length,3);assert.equal(f.store().jobs[q.id].wake.status,'rejected');
 for(const response of ['lost',500,302]){const a=await ready();a.response=response;await a.ask();a.advance(120000);await a.ctx.dgDrain(a.env);assert.equal(a.wakes.length,1);}
});
test('revocation, wrong user/channel and stopped seat block dispatch',async()=>{
 const f=await ready();f.hash=null;await f.ask();assert.equal(f.wakes.length,0);f.hash='restored';f.store().seats??={};f.store().seats.grok={stopped_at:new Date(f.now).toISOString()};await f.ctx.dgDrain(f.env);assert.equal(f.wakes.length,0);
 const a=await ready();await a.ask({user:'45678901234567891'});await a.ask({channel:'99999999999999999'});assert.equal(a.wakes.length,0);
});
test('fixed endpoint rejects unapproved origins and non HTTPS',async()=>{
 for(const url of ['http://routine.example.com/a','https://other.example.com/a','https://127.0.0.1/a']){const f=await ready();f.env.GROK_ROUTINE_URL=url;await f.ask();assert.equal(f.wakes.length,0);}
});

test('UTC hourly and daily attempt caps survive stored state',async()=>{
 const f=await ready();f.response=429;await f.ask();f.advance(120000);await f.ctx.dgDrain(f.env);f.advance(120000);await f.ctx.dgDrain(f.env);assert.equal(f.wakes.length,3);
 await f.ask();assert.equal(f.wakes.length,3);
 f.store().windows.grok.hourly=0;f.store().windows.grok.daily=10;await f.ctx.dgDrain(f.env);assert.equal(f.wakes.length,3);
});
test('lost final reservation receipt remains sending and cannot replay after recovery',async()=>{
 const f=await ready();f.failPut=s=>Object.values(s.jobs??{}).some(j=>j.wake?.status==='accepted');await f.ask();assert.equal(f.wakes.length,1);assert.equal(Object.values(f.store().jobs)[0].wake.status,'sending');f.failPut=null;f.advance(120000);await f.ctx.dgDrain(f.env);assert.equal(f.wakes.length,1);
});
