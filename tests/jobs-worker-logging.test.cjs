const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const secret='SYNTHETIC_FAKE_CREDENTIAL',privateText='SYNTHETIC_PRIVATE_RESUME_CONTACT_EVIDENCE';
function rig(){
 const logs=[],calls=[];let responder=async()=>new Response('null');
 const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Request,Response,Headers,URL,Date,AbortController,setTimeout,clearTimeout,atob,btoa,
 console:Object.fromEntries(['log','warn','error','info','debug'].map(k=>[k,(...args)=>logs.push(args)])),fetch:async(...args)=>{calls.push(args);return responder(...args);}};
 vm.createContext(context);
 const source=fs.readFileSync('dawg-bot-worker.js','utf8').replace(/^import .*;\r?\n/m,'const BOZO_ESPN_TEAM_SEED = {};\n').replace(/^export class /gm,'class ').replace('export default {','const worker = {');
 vm.runInContext(source+'\nthis.api={worker,fbGet,fbPut,fbPatch,fbDelete,fbPost};',context);
 return {context,logs,calls,api:context.api,respond:fn=>responder=fn};
}
test('shared RTDB errors exclude transport URL, credential, body, cause and parser text',async()=>{
 const r=rig(),env={FB_SECRET:secret};
 const actions=[()=>r.api.fbGet(env,'/privateJobs/v1/u_synthetic',true),()=>r.api.fbPut(env,'/synthetic',privateText,'etag'),()=>r.api.fbPatch(env,'/synthetic',privateText),()=>r.api.fbDelete(env,'/synthetic','etag'),()=>r.api.fbPost(env,'/synthetic',privateText)];
 r.respond(async()=>{throw Error('https://synthetic.invalid/?auth='+secret+' '+privateText);});
 for(const action of actions)await assert.rejects(action,e=>{assert.equal(e.message,'RTDB transport unavailable');assert.equal(e.cause,undefined);assert.ok(!e.stack.includes(secret));return true;});
 assert.ok(r.calls.every(([,options])=>options.redirect==='error'));
 r.respond(async()=>new Response(privateText));
 for(const action of [actions[0],actions[4]])await assert.rejects(action,/^Error: RTDB invalid response$/);
 await assert.rejects(()=>r.api.fbPut(env,'/synthetic',{toJSON(){throw Error(privateText);}}),/^Error: RTDB invalid request$/);
 assert.deepEqual(r.logs,[]);
});
test('RTDB helpers preserve ETag, CAS conflict, JSON body, append ID and status-only failures',async()=>{
 const r=rig(),env={FB_SECRET:secret};r.respond(async()=>new Response('{"safe":true}',{headers:{ETag:'synthetic-etag'}}));
 const got=await r.api.fbGet(env,'/synthetic',true);assert.equal(got.etag,'synthetic-etag');assert.equal(got.data.safe,true);assert.equal(r.calls.at(-1)[1].headers['X-Firebase-ETag'],'true');
 await r.api.fbPut(env,'/synthetic',{safe:true},'synthetic-etag');assert.equal(r.calls.at(-1)[1].headers['if-match'],'synthetic-etag');assert.equal(r.calls.at(-1)[1].body,'{"safe":true}');
 r.respond(async()=>new Response(privateText,{status:412}));assert.equal(await r.api.fbPut(env,'/synthetic',{},'etag'),false);assert.equal(await r.api.fbDelete(env,'/synthetic','etag'),false);
 r.respond(async()=>new Response('{"name":"synthetic-event"}'));assert.equal(await r.api.fbPost(env,'/synthetic',{}),'synthetic-event');
 r.respond(async()=>new Response(privateText,{status:403}));await assert.rejects(()=>r.api.fbGet(env,'/synthetic'),/^Error: RTDB read 403$/);
});
test('assembled jobs dispatch fails closed before identity/storage and never logs credentials',async()=>{
 const r=rig();
 for(const flag of [undefined,false,true,'false','TRUE','1','']){
 const response=await r.api.worker.fetch(new Request('https://synthetic.invalid/api/jobs/v1',{headers:{Authorization:'Bearer '+secret}}),{JOB_HARNESS_ENABLED:flag});
 assert.equal(response.status,503);assert.equal(await response.text(),'{"error":"private_setup_pending"}');
 }
 assert.equal(r.calls.length,0);
 for(const authorization of [secret,'Bearer '+secret,'Bearer a.'+'x'.repeat(43)+'.extra']){
 const response=await r.api.worker.fetch(new Request('https://synthetic.invalid/api/jobs/v1',{headers:{Authorization:authorization}}),{JOB_HARNESS_ENABLED:'true'});assert.equal(response.status,401);
 }
 assert.equal(r.calls.length,0);assert.deepEqual(r.logs,[]);
});
test('job boundary suppresses null and forged error status/detail containing private fields',async()=>{
 const r=rig();vm.runInContext("poundIdentity=async()=> 'u_synthetic';",r.context);
 for(const failure of [null,privateText,{jobStatus:400,message:privateText,jobDetail:{resume:privateText}}, {poundStatus:400,message:privateText}]){
 r.context.failure=failure;vm.runInContext('fbGet=async()=>{throw failure;};',r.context);
 const response=await r.api.worker.fetch(new Request('https://synthetic.invalid/api/jobs/v1'),{JOB_HARNESS_ENABLED:'true',RESEARCH_OWNER_UID:'u_synthetic'});
 const body=await response.text();assert.ok(!body.includes(privateText));assert.ok([400,503].includes(response.status));assert.match(response.headers.get('Cache-Control'),/private, no-store/);
 }
 assert.deepEqual(r.logs,[]);
});
