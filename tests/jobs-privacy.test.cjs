const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const sentinel='SYNTHETIC_PRIVATE_SENTINEL_contact@example.invalid_resume_evidence';
test('job handler errors never echo private payloads, credentials or unexpected storage exceptions; no console output',async()=>{
 const logs=[],db=new Map();let failure=false;const env={RESEARCH_OWNER_UID:'u_owner',JOB_HARNESS_ENABLED:'true',FB_SECRET:sentinel};
 const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Request,Response,Headers,URL,Date,ORIGINS:[],console:Object.fromEntries(['log','warn','error','info','debug'].map(k=>[k,(...x)=>logs.push(x)])),readSession:async()=>({u:'u_owner'}),sessionAuth:async()=>({uid:'u_owner'}),fbGet:async()=>{if(failure)throw Error(sentinel);return {data:db.get('state')||null,etag:'synthetic-etag'};},fbPut:async(e,p,v)=>{db.set('state',v);return true;}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('jobs-core.js','utf8')+'\n'+fs.readFileSync('work/dawg-pound.js','utf8')+'\n'+fs.readFileSync('work/jobs.js','utf8')+'\nthis.handle=handleJobs;',context);
 const send=async(body,auth=true)=>{const req=new Request('https://worker.test/api/jobs/v1',{method:body===undefined?'GET':'POST',headers:{...(auth?{Authorization:'Bearer u_owner.'+'x'.repeat(43)}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});const r=await context.handle(req,env);assert.match(r.headers.get('Cache-Control'),/private, no-store/);assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');const text=await r.text();assert.ok(!text.includes(sentinel));assert.ok(!text.includes('x'.repeat(43)));return r.status;};
 assert.equal(await send('{"secret":"'+sentinel+'"'),400);
 assert.equal(await send({op:'record.create',expected_revision:0,request_id:'synthetic-request-01',data:{contact:sentinel,resume:sentinel,evidence:sentinel}}),400);
 assert.equal(await send(undefined,false),401);failure=true;assert.equal(await send(),503);
 db.set('state',{owner_uid:'u_owner',payload:sentinel});failure=false;assert.equal(await send(),503);
 assert.deepEqual(logs,[]);
});
test('SW bypasses private job requests before cache access and refuses all private/JSON responses',()=>{
 const handlers={};let cacheCalls=0;const context={URL,Request,Response,Headers,console, self:{location:{origin:'https://site.test'},addEventListener:(n,fn)=>handlers[n]=fn},caches:{open:()=>{cacheCalls++;throw Error('private cache access');}}};vm.createContext(context);vm.runInContext(fs.readFileSync('sw.js','utf8')+'\nthis.api={publicRequest,canStore};',context);
 for(const path of ['/jobs.html','/jobs.js','/jobs-core.js','/jobs-import.js','/jobs.css','/api/jobs/v1','/api/jobs/v1?synthetic=private']){const request=new Request('https://site.test'+path);assert.equal(context.api.publicRequest(request),false);handlers.fetch({request,respondWith:()=>assert.fail('private fetch intercepted')});}
 assert.equal(context.api.publicRequest(new Request('https://site.test/public.html',{headers:{Authorization:'Bearer synthetic'}})),false);
 for(const headers of [{'Cache-Control':'private, no-store'},{'Content-Type':'application/json'},{Vary:'Authorization'}])assert.equal(context.api.canStore(new Response('{}',{headers})),false);
 assert.equal(cacheCalls,0);
});
test('public job shell has no analytics, form navigation, embedded records or third-party scripts',()=>{
 const html=fs.readFileSync('jobs.html','utf8'),ui=fs.readFileSync('jobs.js','utf8')+'\n'+fs.readFileSync('jobs-core.js','utf8');
 assert.deepEqual([...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(x=>x[1]),['jobs-core.js','jobs-import.js','jobs.js']);
 assert.match(html,/form-action 'none'/);assert.match(html,/autocomplete="off"/);assert.match(html,/name="referrer" content="no-referrer"/);
 for(const pattern of [/console\./,/sendBeacon/,/localStorage\.setItem/,/sessionStorage/,/indexedDB/,/innerHTML/,/document\.cookie/])assert.ok(!pattern.test(ui),String(pattern));
 const urls=[...ui.matchAll(/https:\/\/[^'"`\s]+/g)].map(x=>x[0]);assert.ok(urls.every(u=>u.startsWith('https://example.com/')||u==='https://toto.jkapcar4.workers.dev/api/jobs/v1'));
 assert.ok(!html.includes(sentinel));assert.ok(!ui.includes(sentinel));
});
test('provider export cannot silently capture the outbound database credential',()=>{
 // Workers Traces fetch spans record url.full and url.query, so while fbUrl sends the database
 // credential as ?auth=, enabling telemetry/export requires a separate privacy review.
 // This is a conservative configuration guard, not proof that every sink records subrequests.
 // Read-only check of the committed manifest; it changes no configuration. docs/job-harness.md.
 const manifest=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8')),o=manifest.observability||{};
 const worker=fs.readFileSync('dawg-bot-worker.js','utf8'),credentialInUrl=/const fbUrl = \(env, path\) => `\$\{DB\}\$\{path\}\.json\?auth=\$\{env\.FB_SECRET\}`;/.test(worker);
 const exporting={traces:o.traces?.enabled===true,logpush:manifest.logpush===true,tail_consumers:(manifest.tail_consumers||[]).length>0,
  destinations:[o.traces?.destinations,o.logs?.destinations].some(d=>Array.isArray(d)&&d.length>0)};
 assert.ok(credentialInUrl||!worker.includes('?auth=${env.FB_SECRET}'),'fbUrl changed shape: update this guard to match');
 if(credentialInUrl)assert.deepEqual(exporting,{traces:false,logpush:false,tail_consumers:false,destinations:false},
  'An export path is enabled while fbUrl still puts FB_SECRET in the URL. Move the credential out of the URL first, or get explicit approval: see docs/job-harness.md.');
 // The job module itself never writes logs, whatever the platform keeps.
 assert.ok(!/console\./.test(fs.readFileSync('work/jobs.js','utf8')));
});
