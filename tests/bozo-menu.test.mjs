import test from 'node:test';
import assert from 'node:assert/strict';
import {runMenu,quoteState} from '../bozo-menu.mjs';
const now=Date.parse('2026-10-05T18:00:00Z');
const caller={kind:'user',uid:'u_kap'};
const row={id:'cfb-away',event:'Away at Home',sport:'cfb',market:'spread',selection:'Away +7',status:'keep',reason:'Both teams screened; no new material changes.',kickoff:'2026-10-10T17:00:00Z',screened_at:'2026-10-05T17:30:00Z',base:{line:7,odds:-110,book:'Example book',quoted_at:'2026-10-05T17:30:00Z'},alternate:{line:13.5,odds:-250,book:'Example book',quoted_at:'2026-10-05T17:30:00Z'},edge:{value:3,unit:'points',definition:'Model spread minus selected-team market spread advantage'},sources:[{name:'Example model',as_of:'2026-10-05T12:00:00Z',evidence:'Fixture only',weight:1}]};
function storage(){const db=new Map();let writes=0;return {db,get:async path=>({data:structuredClone(db.get(path)?.data||null),etag:String(db.get(path)?.rev||0)}),put:async(path,data,etag)=>{if(etag!==String(db.get(path)?.rev||0))return false;db.set(path,{data:structuredClone(data),rev:Number(etag)+1});writes++;return true;},get writes(){return writes;}};}
const payload=(c=row,revision=0,week='2026-10-05')=>({week,expected_revision:revision,candidates:[c]});
test('private account and week isolation; upserts preserve omitted rows and revisions',async()=>{
 const store=storage();await runMenu('save',payload(),caller,store,now);
 let menu=await runMenu('save',payload({...row,id:'second'},1),caller,store,now);assert.equal(menu.candidates.length,2);
 menu=await runMenu('save',payload({...row,status:'scratch',reason:'New QB injury'},2),caller,store,now);assert.equal(menu.candidates.length,2);assert.equal(menu.candidates.find(c=>c.id===row.id).quote_state,'Scratched');
 assert.equal((await runMenu('get',{week:'2026-10-12'},caller,store,now)).candidates.length,0);
 assert.equal((await runMenu('list',{}, {...caller,uid:'u_other'},store,now)).weeks.length,0);
 assert.equal((await runMenu('list',{},caller,store,now)).weeks[0].revision,3);
 assert.ok([...store.db.keys()].every(k=>k==='/users/u_kap/bozoMenus'));
});
test('shared, anonymous and invalid UID credentials cannot read or write',async()=>{
 for(const who of [null,{kind:'shared'},{kind:'user',uid:'../other'},{kind:'user'}])for(const op of ['list','save'])await assert.rejects(runMenu(op,op==='list'?{}:payload(),who,storage(),now),e=>e.status===401);
});
test('stale revision and simultaneous saves refuse lost updates',async()=>{
 const store=storage();await runMenu('save',payload(),caller,store,now);
 await assert.rejects(runMenu('save',payload(),caller,store,now),e=>e.status===409);
 const results=await Promise.allSettled([runMenu('save',payload({...row,id:'a'},1),caller,store,now),runMenu('save',payload({...row,id:'b'},1),caller,store,now)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);assert.equal(store.writes,2);
});
test('invalid candidates never partially commit a batch',async()=>{
 const variants=[payload({...row,alternate:{...row.alternate,odds:0}}),payload({...row,alternate:{...row.alternate,quoted_at:'2027-01-01T00:00:00Z'}}),payload({...row,edge:{...row.edge,unit:'wins'}}),payload({...row,kickoff:'Saturday'}),payload({...row,sources:[{...row.sources[0],url:'javascript:alert(1)'}]}),payload({...row,alternate:{...row.alternate,line:null}}),payload(row,0,'2026-10-06'),{...payload(),uid:'someone-else'},{...payload(),candidates:[row,row]}, {...payload(),candidates:[row,{...row,id:'other',status:'ready'}]}];
 for(const args of variants){const store=storage();await assert.rejects(runMenu('save',args,caller,store,now));assert.equal(store.writes,0);}
});
test('provisional research accepted without invented odds; quote states are conditional',async()=>{
 const c={...row};delete c.alternate;delete c.base;const saved=await runMenu('save',payload(c),caller,storage(),now);assert.equal(saved.candidates[0].quote_state,'Needs alternate quote');
 for(const odds of [-200,-500])assert.match(quoteState({...row,alternate:{...row.alternate,odds}},now),/target band/);
 for(const odds of [-199,-501,200])assert.match(quoteState({...row,alternate:{...row.alternate,odds}},now),/Outside/);
 assert.equal(quoteState(row,now+7200000),'Recheck price');assert.equal(quoteState({...row,status:'hold'},now),'On hold');assert.equal(quoteState(row,now+10*86400000),'Started / archived');
});
