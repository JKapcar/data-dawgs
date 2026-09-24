const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('dawg-bot-worker.js','utf8');
const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function rig(sequence){
 let calls=0,reads=0,writes=0;const map=new Map();
 const cache={match:async key=>{reads++;return map.get(key.url)?.clone();},put:async(key,res)=>{writes++;map.set(key.url,res.clone());}};
 const ctx={console:{log:()=>{}},Date,Request,Response,URL,TextEncoder,crypto:require('node:crypto').webcrypto,AbortController,setTimeout,clearTimeout,caches:{default:cache},
 fetch:async(...args)=>{const action=sequence[Math.min(calls++,sequence.length-1)];return typeof action==='function'?action(...args):new Response(action.body??'{"data":[]}',{status:action.status||200,headers:action.headers});}};
 vm.createContext(ctx);vm.runInContext(slice('async function bozoSgoFailure(', 'async function bozoFetchEvents(')+'this.request=bozoSgoRequest;',ctx);
 const env={SGO_KEY:'synthetic-fixture-key'},url=new URL('https://example.test/events?leagueID=NFL&oddID=spread&includeAltLines=true');
 return {ctx,map,url,request:(caller='submit',options={})=>ctx.request(env,url,{caller,sport:'nfl',needProps:false},options),stats:()=>({calls,reads,writes})};
}
test('transient 429 retries; known monthly quota, long Retry-After and terminal 4xx fall back without retry',async()=>{
 const r=rig([{status:429,body:'slow down',headers:{'retry-after':'0'}},{body:'{"data":[{"eventID":"one"}]}'}]);
 assert.equal((await r.request())[0].eventID,'one');assert.equal(r.stats().calls,2);
 for(const [response,code] of [[{status:429,body:'monthly object quota exceeded'},'quota_exceeded'],[{status:429,headers:{'retry-after':'8'}},'rate_limited'],[{status:401},'provider_rejected']]){
  const q=rig([response]);await assert.rejects(q.request(),e=>e.code===code);assert.equal(q.stats().calls,1);assert.equal(q.stats().writes,0);
 }
 const date=rig([{status:429,headers:{'retry-after':new Date(Date.now()+15000).toUTCString()}}]);
 await assert.rejects(date.request(),e=>e.code==='rate_limited');assert.equal(date.stats().calls,1);
});
test('deadline includes stalled response bodies and never exceeds its budget by starting another retry',async()=>{
 const r=rig([async()=>({ok:true,json:()=>new Promise(()=>{})})]);const start=Date.now();
 await assert.rejects(r.request('submit',{deadline:start+60}),e=>e.code==='timeout');
 assert.ok(Date.now()-start<600);assert.equal(r.stats().calls,1);
});
test('successful submit/draft cache shares canonical request, retains fetchedAt, expires at 60s, close bypasses',async()=>{
 const r=rig([{body:'{"data":[{"eventID":"same"}]}'}]);const first=await r.request(),second=await r.request('draft');
 assert.equal(r.stats().calls,1);assert.equal(first.fetchedAt,second.fetchedAt);assert.equal(r.stats().writes,1);
 await r.request('close');await r.request('close');assert.deepEqual(r.stats(),{calls:3,reads:2,writes:1});
 const key=[...r.map.keys()][0];assert.ok(!key.includes('synthetic-fixture-key'));
 r.map.set(key,new Response(JSON.stringify({events:[],fetchedAt:new Date(Date.now()-60001).toISOString()})));
 await r.request();assert.equal(r.stats().calls,4);
 r.url.searchParams.set('oddID','total');await r.request();assert.equal(r.stats().calls,5);
});
test('failure responses and malformed JSON never cache; cache outages do not block live capture',async()=>{
 const r=rig([{status:400}]);for(let n=0;n<2;n++)await assert.rejects(r.request());assert.equal(r.stats().writes,0);assert.equal(r.stats().calls,2);
 const bad=rig([{body:'not json'}]);await assert.rejects(bad.request(),e=>e.code==='invalid_response');assert.equal(bad.stats().writes,0);
 const cacheDown=rig([{}]);cacheDown.ctx.caches.default.match=async()=>{throw Error('cache down');};assert.equal((await cacheDown.request()).length,0);
});
