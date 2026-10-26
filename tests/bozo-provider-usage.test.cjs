const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('dawg-bot-worker.js','utf8');
const start=source.indexOf('function bozoSgoUsageProjection('),end=source.indexOf('async function requireAdmin(',start);
const fixture=()=>({success:true,data:{isActive:true,keyID:'PRIVATE_KEY_ID',customerID:'PRIVATE_CUSTOMER',apiKey:'SECRET',rateLimits:{'per-minute':{maxRequestsPerInterval:100,currentIntervalRequests:3,maxEntitiesPerInterval:'unlimited',currentIntervalEntities:'n/a',currentIntervalEndTime:'2026-10-25T05:00:00Z'},'per-month':{maxEntitiesPerInterval:2500,currentIntervalEntities:2500,maxRequestsPerInterval:'unlimited',currentIntervalRequests:17},'secret-interval':{secret:'SECRET'}}},notice:'PRIVATE_NOTICE'});
function rig({uid='u_owner',response=()=>Response.json(fixture()),identityError=false,timeout=false}={}){
 const calls=[],writes=[],timers=[];
 const context=vm.createContext({URL,Request,Response,AbortController,Date,Number,Array,JSON,Promise,setTimeout:timeout?(fn=>{timers.push(fn);return 1;}):setTimeout,clearTimeout:timeout?(()=>{}):clearTimeout,
  json:(body,status,headers)=>Response.json(body,{status,headers}),poundIdentity:async()=>{if(identityError)throw Error('PRIVATE_AUTH');return uid;},fetch:async(url,init)=>{calls.push({url,init});return response(url,init);}});
 vm.runInContext(source.slice(start,end)+';this.handle=handleSgoUsageDiagnostic;this.project=bozoSgoUsageProjection;',context);
 const env={RESEARCH_OWNER_UID:'u_owner',SGO_KEY:'SECRET',RL:{put:()=>writes.push('kv')},FB_SECRET:'UNRELATED_SECRET'};
 const request=(method='GET',suffix='',origin='https://datadawgs216.com')=>new Request('https://worker.invalid/ops/provider-usage/sgo'+suffix,{method,headers:{Origin:origin,Authorization:'Bearer FIXTURE'}});
 return {...context,env,calls,writes,timers,request};
}
test('exact route uses existing site-owner identity and denies unauthenticated/nonowner before fetch',async()=>{
 assert.match(source,/url.pathname === "\/ops\/provider-usage\/sgo"\) return handleSgoUsageDiagnostic/);
 for(const opts of [{identityError:true},{uid:'u_other'}]){const r=rig(opts),res=await r.handle(r.request(),r.env);assert.equal(res.status,opts.identityError?401:403);assert.equal(r.calls.length,0);assert.ok(!JSON.stringify(await res.json()).includes('PRIVATE'));}
});
test('method, origin, parameters, unconfigured owner/key fail closed without upstream calls',async()=>{
 for(const mode of ['method','origin','parameters','owner','key']){const r=rig();if(mode==='owner')delete r.env.RESEARCH_OWNER_UID;if(mode==='key')delete r.env.SGO_KEY;
 const req=r.request(mode==='method'?'POST':'GET',mode==='parameters'?'?url=https://evil.invalid':'',mode==='origin'?'https://evil.invalid':'https://datadawgs216.com');
 assert.ok((await r.handle(req,r.env)).status>=400);assert.equal(r.calls.length,0);}
});
test('usage read is one fixed GET with header key, redirect rejection, no writes or raw account fields',async()=>{
 const r=rig(),res=await r.handle(r.request(),r.env),body=await res.json();assert.equal(res.status,200);
 assert.equal(r.calls.length,1);assert.equal(r.calls[0].url,'https://api.sportsgameodds.com/v2/account/usage');
 assert.equal(r.calls[0].init.method,'GET');assert.equal(r.calls[0].init.headers['X-Api-Key'],'SECRET');assert.equal(r.calls[0].init.redirect,'error');
 assert.match(res.headers.get('cache-control'),/private, no-store/);assert.equal(body.active,true);assert.equal(body.scoreEntitlement,null);assert.ok(Number.isFinite(Date.parse(body.observedAt)));
 assert.equal(body.limits['per-minute'].requestsRemaining,97);assert.equal(body.limits['per-minute'].objectsUnlimited,true);assert.equal(body.limits['per-minute'].objects,null);
 assert.equal(body.limits['per-month'].objectsRemaining,0);assert.deepEqual(r.writes,[]);
 for(const sentinel of ['SECRET','PRIVATE','keyID','customerID','notice','secret-interval'])assert.ok(!JSON.stringify(body).includes(sentinel),sentinel);
});
test('allowlist refuses malformed numeric data and never infers entitlement or unlimited from missing values',()=>{
 const r=rig(),data=fixture();data.data.isActive=false;data.data.rateLimits['per-minute']={currentIntervalRequests:-1,maxRequestsPerInterval:'SECRET',currentIntervalEntities:NaN,maxEntitiesPerInterval:Infinity,currentIntervalEndTime:'PRIVATE'};
 const body=r.project(data,'2026-10-25T04:00:00Z'),row=body.limits['per-minute'];assert.equal(body.active,false);assert.equal(row.requests,null);assert.equal(row.requestLimit,null);assert.equal(row.objectsUnlimited,false);assert.equal(row.resetsAt,null);
 for(const data of [{},{success:true,data:{}},{success:true,data:{isActive:true,rateLimits:[]}}])assert.equal(r.project(data,'now'),null);
});
test('401/403/429/server failures expose fixed status only and never parse provider body or retry',async()=>{
 for(const status of [401,403,429,500]){let parsed=false;const r=rig({response:()=>({ok:false,status,json:()=>{parsed=true;throw Error('SECRET');}})});const res=await r.handle(r.request(),r.env),body=await res.json();assert.equal(res.status,status===429?429:502);assert.equal(body.httpStatus,status);assert.equal(parsed,false);assert.equal(r.calls.length,1);assert.ok(!JSON.stringify(body).includes('SECRET'));}
});
test('timeout aborts fixed request, never retries, and response remains no-store',async()=>{
 const r=rig({timeout:true,response:()=>new Promise(()=>{})}),pending=r.handle(r.request(),r.env);await new Promise(setImmediate);r.timers[0]();const res=await pending;assert.equal(res.status,504);assert.equal(r.calls[0].init.signal.aborted,true);assert.equal(r.calls.length,1);assert.equal((await res.json()).error,'provider_timeout');
});
test('network failures and malformed success do not expose raw error, token or body',async()=>{
 for(const response of [()=>{throw Error('SECRET PRIVATE_URL');},()=>new Response('SECRET'),()=>Response.json({success:false,message:'SECRET'})]){const r=rig({response}),res=await r.handle(r.request(),r.env);assert.equal(res.status,502);assert.ok(!JSON.stringify(await res.json()).includes('SECRET'));assert.equal(r.calls.length,1);}
});
test('no provider cache or stored secret is introduced',()=>{
 const block=source.slice(start,end);assert.doesNotMatch(block,/console\.|\.put\(|cache\.put|caches\.|fbPut|fbPatch/);assert.match(block,/await poundIdentity\(request, env\)/);
});
