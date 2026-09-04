const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
const origin='https://datadawgs216.com';
const publicResponse=(body='ok', options={})=>new Response(body, {headers:{'content-type':'text/html'}, ...options});
function harness(){
  const listeners={}, entries=new Map(), stores=new Map(), calls=[], timers=new Map();
  let nextTimer=0, denied=false, net=async()=>publicResponse();
  const key=x=>new URL(typeof x==='string' ? x : x.url,origin).href;
  const cache={
    async match(x){ return entries.get(key(x))?.clone(); },
    async put(x,r){ entries.set(key(x),r.clone()); },
    async delete(x){ return entries.delete(key(x)); }
  };
  const context=vm.createContext({URL,Request,Response,Headers,Set,console,
    self:{location:{origin},addEventListener:(t,fn)=>listeners[t]=fn,skipWaiting(){},clients:{async claim(){}}},
    fetch:async(...args)=>{ calls.push(args); return net(...args); },
    setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    caches:{async open(n){if(denied)throw new Error('storage denied');stores.set(n,cache);return cache;},
      async keys(){return [...stores.keys()];},async delete(n){return stores.delete(n);}}
  });
  vm.runInContext(source,context);
  async function dispatch(url,init={}){
    let result;const lifetime=[];
    listeners.fetch({request:new Request(new URL(url,origin),init),respondWith:p=>result=p,waitUntil:p=>lifetime.push(p)});
    const response=await result;
    await Promise.all(lifetime);
    return response;
  }
  return {entries,stores,calls,timers,cache,key,dispatch,listeners,context,
    setNet:fn=>net=fn,deny:()=>denied=true};
}
test('unknown providers, APIs, data, private objects, and non-GET requests bypass all service-worker storage',async()=>{
  const h=harness();
  for(const url of ['/data/index.json','/llms.txt','/api/profile','/api/private.js','/uploads/receipt.png',
    'https://new-api.example/profile','https://toto.jkapcar4.workers.dev/status',
    'https://project.firebaseio.com/state.json','https://api.sleeper.app/v1/state/nfl',
    'https://example.com/board.html','/movie.mp4']){
    assert.equal(await h.dispatch(url),undefined,url);
  }
  assert.equal(await h.dispatch('/board.html',{method:'POST'}),undefined);
  assert.equal(h.stores.size,0);assert.equal(h.calls.length,0);
});
test('credential URLs, authorization, explicit no-store, and Range never read a cached public file',async()=>{
  const h=harness();
  await h.cache.put('/board.html',publicResponse('old'));
  for(const init of [{headers:{authorization:'Bearer test-only'}},{cache:'no-store'},
    {headers:{'cache-control':'no-cache'}},{headers:{range:'bytes=0-10'}}]){
    assert.equal(await h.dispatch('/board.html',init),undefined);
  }
  for(const url of ['/signon.html?token=test','/connect.html?key=test','/bozo.html?join=test'])
    assert.equal(await h.dispatch(url),undefined);
  assert.equal(h.stores.size,0);
});
test('public routing queries share a query-free HTML shell, not private data',async()=>{
  const h=harness();h.setNet(async()=>publicResponse('<body>shell</body>'));
  assert.equal((await h.dispatch('/board.html?room=test',{headers:{accept:'text/html'}})).status,200);
  assert.ok(h.entries.has(h.key('/board.html')));
  assert.ok(!h.entries.has(h.key('/board.html?room=test')));
  assert.equal(h.timers.size,0,'successful requests clear their timeout');
});
test('private/no-store/no-cache, credential-varying, redirected and JSON responses cannot enter public cache',async()=>{
  for(const headers of [{'cache-control':'private,max-age=60'},{'cache-control':'no-store'},
    {'cache-control':'public, no-cache="set-cookie"'},{vary:'Cookie'}, {vary:'Accept, Authorization'},
    {vary:'*'},{'content-type':'application/json'},{'content-type':'application/problem+json'},
    {'content-type':'text/event-stream'}]){
    const h=harness();await h.cache.put('/board.html',publicResponse('old'));
    h.setNet(async()=>publicResponse('private',{headers}));
    assert.equal(await (await h.dispatch('/board.html',{headers:{accept:'text/html'}})).text(),'private');
    assert.equal(h.entries.size,0,JSON.stringify(headers));
  }
  const h=harness();const response=publicResponse('redirect');
  Object.defineProperty(response,'redirected',{value:true});h.setNet(async()=>response);
  await h.dispatch('/board.html',{headers:{accept:'text/html'}});assert.equal(h.entries.size,0);
});
test('cache denied does not stop network HTML, scripts or images',async()=>{
  const h=harness();h.deny();
  for(const url of ['/board.html','/dd-live-state.js','/assets/icon-192.png']){
    assert.equal((await h.dispatch(url,{headers:{accept:url.endsWith('html')?'text/html':'*/*'}})).status,200);
  }
});
test('saved HTML is labelled, never silently replaced by the homepage, and fallback is not cached',async()=>{
  const h=harness();await h.cache.put('/board.html',publicResponse('<html><body>saved board</body></html>'));
  await h.cache.put('/index.html',publicResponse('<body>homepage</body>'));
  h.setNet(async()=>{throw new Error('offline');});
  const result=await h.dispatch('/board.html',{headers:{accept:'text/html'}});
  assert.equal(result.headers.get('x-dd-saved-copy'),'1');
  assert.match(await result.text(),/<body><div[^>]*role="status"[^>]*>Saved page/);
  assert.doesNotMatch(await (await h.cache.match('/board.html')).text(),/dd-offline-notice/);
  const missing=await h.dispatch('/uncached.html',{headers:{accept:'text/html'}});
  assert.equal(missing.status,503);assert.doesNotMatch(await missing.text(),/homepage/);
});
test('5xx can use a labelled saved page, but 401/403/404 cannot mask access or removal',async()=>{
  for(const status of [503,401,403,404]){
    const h=harness();await h.cache.put('/board.html',publicResponse('<body>old</body>'));
    h.setNet(async()=>publicResponse('error',{status}));
    const result=await h.dispatch('/board.html',{headers:{accept:'text/html'}});
    assert.equal(result.status,status===503?200:status);
    assert.equal(result.headers.get('x-dd-saved-copy'),status===503?'1':null);
  }
});
test('all local scripts refresh from network and retain an offline fallback',async()=>{
  const h=harness();await h.cache.put('/dd-live-state.js',new Response('old'));
  h.setNet(async()=>new Response('new',{headers:{'content-type':'text/javascript'}}));
  assert.equal(await (await h.dispatch('/dd-live-state.js')).text(),'new');
  h.setNet(async()=>{throw new Error('offline');});
  assert.equal(await (await h.dispatch('/dd-live-state.js')).text(),'new');
});
test('cache-first only admits public media; exact external celebration photos remain available',async()=>{
  const h=harness();h.setNet(async()=>new Response('image',{headers:{'content-type':'image/png'}}));
  await h.dispatch('/assets/icon-192.png');await h.dispatch('/assets/icon-192.png');
  assert.equal(h.calls.length,1);
  const photo=vm.runInContext('MEDIA[0]',h.context);
  assert.equal((await h.dispatch(photo)).status,200);
  assert.equal(await h.dispatch(photo+'?token=unexpected'),undefined);
});
test('the precached horn serves correct byte ranges offline without caching partial bodies',async()=>{
  const h=harness();await h.cache.put('/superbowlsuperbrowns.m4a',new Response('0123456789',{headers:{'content-type':'audio/mp4'}}));
  h.setNet(async()=>{throw new Error('offline');});
  for(const [range,expected,contentRange] of [['bytes=2-5','2345','bytes 2-5/10'],
    ['bytes=7-','789','bytes 7-9/10'],['bytes=-3','789','bytes 7-9/10']]){
    const response=await h.dispatch('/superbowlsuperbrowns.m4a',{headers:{range}});
    assert.equal(response.status,206);assert.equal(await response.text(),expected);
    assert.equal(response.headers.get('content-range'),contentRange);
  }
  const invalid=await h.dispatch('/superbowlsuperbrowns.m4a',{headers:{range:'bytes=12-20'}});
  assert.equal(invalid.status,416);
  assert.equal(await (await h.cache.match('/superbowlsuperbrowns.m4a')).text(),'0123456789');
});
test('activation evicts prior broad-policy caches and preserves other applications caches',async()=>{
  const h=harness();h.stores.set('dd-old',h.cache);h.stores.set('other-app',h.cache);
  const current=vm.runInContext('CACHE',h.context);h.stores.set(current,h.cache);
  let pending;h.listeners.activate({waitUntil:p=>pending=p});await pending;
  assert.deepEqual([...h.stores.keys()].sort(),[current,'other-app'].sort());
});
test('precache is per-file, rejects private responses and includes the live-state dependency',async()=>{
  const h=harness();h.setNet(async url=>{
    if(url==='/index.html')throw new Error('unavailable');
    return new Response('public',{headers: url==='/connect.html'?{'cache-control':'no-store'}:{}});
  });
  let pending;h.listeners.install({waitUntil:p=>pending=p});await pending;
  assert.ok(h.entries.has(h.key('/dd-live-state.js')));
  assert.ok(h.entries.has(h.key('/board.html')));
  assert.ok(!h.entries.has(h.key('/connect.html')));
});
