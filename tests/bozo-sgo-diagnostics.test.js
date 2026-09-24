const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('dawg-bot-worker.js','utf8');
function rig(){const logs=[];const ctx={Date,Error,console:{log:s=>logs.push(JSON.parse(s))}};vm.createContext(ctx);vm.runInContext(src.slice(src.indexOf('async function bozoSgoFailure('),src.indexOf('async function bozoFetchEvents('))+'this.fail=bozoSgoFailure;',ctx);return{logs,fail:ctx.fail};}
test('non-2xx diagnostics preserve safe body, rate headers, status and all four callers',async()=>{
 for(const caller of ['submit','draft','close','cfb-market'])for(const status of [429,401,503]){
 const r=rig();const e=await r.fail(new Response('monthly quota exhausted '+ 'x'.repeat(400),{status,headers:{'Retry-After':'60','X-RateLimit-Remaining':'0','Set-Cookie':'secret'}}),{}, {caller,sport:'nfl',needProps:true});
 assert.equal(e.status,status);assert.equal(e.detail.length,240);assert.equal(e.headers['retry-after'],'60');assert.equal(e.headers['x-ratelimit-remaining'],'0');assert.equal(e.headers['set-cookie'],undefined);assert.equal(e.caller,caller);assert.equal(r.logs.length,1);assert.equal(r.logs[0].event,'bozo-sgo-error');
 }});
test('empty, unreadable and non-JSON bodies remain diagnostic; secrets are redacted before truncation',async()=>{
 const r=rig(),context={caller:'close',sport:'cfb',needProps:false};
 const e=await r.fail(new Response('<html>apiKey=fixture-key-value x-api-key: another-secret</html>',{status:429,headers:{'X-RateLimit-Detail':'fixture-key-value'}}),{SGO_KEY:'fixture-key-value'},context);
 assert.doesNotMatch(JSON.stringify(e),/fixture-key-value|another-secret/);
 assert.equal((await r.fail(new Response('',{status:503}),{},context)).detail,'');
 const broken={status:429,headers:new Headers(),text:async()=>{throw Error('broken')}};
 assert.match((await r.fail(broken,{},context)).detail,/unavailable/);
});
