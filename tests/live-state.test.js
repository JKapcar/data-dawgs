const test=require('node:test');
const assert=require('node:assert/strict');
const {DDLiveState}=require('../dd-live-state.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(options={}){
  const reads=[], values=[], statuses=[], streams=[], intervals=new Map(), deadlines=new Map(), events=new Map();
  let clock=1000, id=0;
  const navigator={onLine:true};
  class Stream{
    constructor(url){this.url=url;this.handlers={};streams.push(this);}
    addEventListener(name,fn){this.handlers[name]=fn;}
    emit(name,data){this.handlers[name]({data:JSON.stringify(data)});}
    close(){this.closed=true;}
  }
  const reader=DDLiveState.create({url:'https://example.test/state.json',EventSource:Stream,
    now:()=>clock,navigator,onData:x=>values.push(x),onStatus:x=>statuses.push(x),
    setInterval:fn=>{intervals.set(++id,fn);return id;},clearInterval:n=>intervals.delete(n),
    setTimeout:fn=>{deadlines.set(++id,fn);return id;},clearTimeout:n=>deadlines.delete(n),
    events:{addEventListener:(k,fn)=>events.set(k,fn),removeEventListener:k=>events.delete(k)},
    fetch:(url,init)=>new Promise((resolve,reject)=>{
      reads.push({url,init,resolve:value=>resolve(new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}})),
        response:resolve,reject});
      if(!options.ignoreAbort)init.signal.addEventListener('abort',()=>reject(new Error('aborted')));
    }),...options.overrides});
  return {reader,reads,values,statuses,streams,intervals,deadlines,events,navigator,
    advance:ms=>clock+=ms};
}
test('HTTP failure/malformed state preserve the last good snapshot and expose stale status',async t=>{
  const h=harness();t.after(()=>h.reader.stop());h.reader.start();
  h.reads[0].resolve({revision:1});await tick();
  assert.deepEqual(h.values,[{revision:1}]);
  for(const response of [new Response('{"error":"denied"}',{status:403}),new Response('broken JSON'),
    new Response('[]'),new Response('{"error":"unavailable"}')]){
    const pending=h.reader.refresh();h.reads.at(-1).response(response);await pending;
    assert.equal(h.reader.snapshot().state,'stale');
    assert.deepEqual(h.values,[{revision:1}]);
  }
});
test('newer full stream state invalidates an older HTTP read',async t=>{
  const h=harness();t.after(()=>h.reader.stop());h.reader.start();
  h.streams[0].emit('put',{path:'/',data:{revision:2}});
  h.reads[0].resolve({revision:1});await tick();
  assert.deepEqual(h.values,[{revision:2}]);assert.equal(h.reader.snapshot().state,'fresh');
});
test('partial stream updates invalidate an in-flight poll and queue a fresh read',async t=>{
  const h=harness();t.after(()=>h.reader.stop());h.reader.start();
  h.streams[0].emit('patch',{path:'/members',data:{a:true}});
  h.streams[0].emit('put',{path:'/members/a',data:true});
  assert.equal(h.reads.length,1,'updates coalesce');
  h.reads[0].resolve({revision:1});await tick();
  assert.equal(h.reads.length,2);assert.equal(h.values.length,0);
  h.reads[1].resolve({revision:3});await tick();assert.deepEqual(h.values,[{revision:3}]);
});
test('poll-only browsers recover and never cache live JSON responses',async t=>{
  const h=harness({overrides:{EventSource:null}});t.after(()=>h.reader.stop());h.reader.start();
  h.reads[0].reject(new Error('offline'));await tick();assert.equal(h.reader.snapshot().state,'error');
  for(const interval of h.intervals.values())interval();
  assert.equal(h.reads[1].init.cache,'no-store');
  h.reads[1].resolve({revision:2});await tick();assert.equal(h.reader.snapshot().state,'fresh');
});
test('concurrent refreshes are coalesced and repeated start does not add subscriptions',async t=>{
  const h=harness();t.after(()=>h.reader.stop());h.reader.start();h.reader.start();
  const a=h.reader.refresh(),b=h.reader.refresh();
  assert.equal(h.reads.length,1);assert.equal(h.streams.length,1);assert.equal(h.intervals.size,1);
  h.reads[0].resolve({});await Promise.all([a,b]);assert.equal(h.values.length,1);
});
test('stopped/restarted subscriptions cannot accept late data or late stream events',async t=>{
  const h=harness({ignoreAbort:true});t.after(()=>h.reader.stop());h.reader.start();h.reader.stop();h.reader.start();
  h.streams[0].emit('put',{path:'/',data:{wrong:true}});
  h.reads[0].resolve({wrong:true});await tick();
  h.reads[1].resolve({current:true});await tick();
  assert.deepEqual(h.values,[{current:true}]);assert.equal(h.streams[0].closed,true);
});
test('offline and stale-age signals are visible; reconnect performs a fresh read',async t=>{
  const h=harness();t.after(()=>h.reader.stop());h.reader.start();h.reads[0].resolve({});await tick();
  h.navigator.onLine=false;h.events.get('offline')();assert.equal(h.reader.snapshot().state,'offline');
  h.navigator.onLine=true;h.events.get('online')();h.reads[1].resolve({});await tick();
  assert.equal(h.reader.snapshot().state,'fresh');
  h.advance(46000);for(const interval of h.intervals.values())interval();
  assert.equal(h.reader.snapshot().state,'stale');h.reads[2].resolve({});await tick();
  assert.equal(h.reader.snapshot().state,'fresh');
});
test('expired requests abort and free the next retry; stop removes listeners and timers',async()=>{
  const h=harness();h.reader.start();for(const deadline of [...h.deadlines.values()])deadline();await tick();
  assert.equal(h.reads[0].init.signal.aborted,true);assert.equal(h.reader.snapshot().state,'error');
  const retry=h.reader.refresh();h.reads[1].resolve({});await retry;h.reader.stop();await tick();
  assert.equal(h.events.size,0);assert.equal(h.intervals.size,0);assert.equal(h.deadlines.size,0);
});
test('a failed old HTTP request cannot mark a newer stream snapshot stale',async t=>{
  const h=harness();t.after(()=>h.reader.stop());h.reader.start();
  h.streams[0].emit('put',{path:'/',data:{revision:2}});h.reads[0].reject(new Error('old request failed'));await tick();
  assert.equal(h.reader.snapshot().state,'fresh');assert.deepEqual(h.values,[{revision:2}]);
});
test('null is an empty record; malformed stream data requests a validated reload',async t=>{
  const h=harness();t.after(()=>h.reader.stop());h.reader.start();h.reads[0].resolve(null);await tick();
  assert.deepEqual(h.values,[{}]);h.streams[0].emit('put',{path:'/',data:['invalid']});
  h.reads[1].resolve({restored:true});await tick();assert.deepEqual(h.values,[{},{restored:true}]);
});
test('consumer rendering failures remain visible instead of being reported as a network failure',async()=>{
  const h=harness({overrides:{onData(){throw new Error('render bug');}}});h.reader.start();
  assert.throws(()=>h.streams[0].emit('put',{path:'/',data:{}}),/render bug/);
  h.reader.stop();await tick();
});
