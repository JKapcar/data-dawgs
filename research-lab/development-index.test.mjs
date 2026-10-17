import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {readDevelopmentData,SOURCE_SHA} from './development-data.mjs';
globalThis.crypto??=webcrypto;
function fixture(year='2023'){
 const objects=new Map();let reads=0;
 const put=v=>{const text=JSON.stringify(v),h=createHash('sha256').update(text).digest('hex');objects.set(h,text);return h;};
 const cols=['nfl_id','dd_season','dd_draft_year','time'];
 const artifact=put({version:2,sourceSha256:SOURCE_SHA,table:'game_tracking',columns:cols,rows:Array.from({length:256},(_,i)=>({nfl_id:'synthetic',dd_season:year,dd_draft_year:'2023',time:String(i)}))});
 const leaf=put({version:2,kind:'index',sourceSha256:SOURCE_SHA,table:'game_tracking',artifacts:[{sha256:artifact,rows:256}]});
 const root=put({version:2,kind:'index',sourceSha256:SOURCE_SHA,table:'game_tracking',children:[leaf]});
 const tables=Object.fromEntries(['players','combine_results','combine_tracking','games','player_play','game_tracking'].map(t=>[t,{root,depth:1,rows:256,columns:cols.map(name=>({name}))}]));
 const pin=put({version:2,sourceSha256:SOURCE_SHA,classes:['2023','2024'],seasons:['2023','2024'],policy:'development-cohort-only-v1',holdoutRead:false,tables});
 const env={RESEARCH_DEVELOPMENT_DATA_ENABLED:'true',RESEARCH_DEVELOPMENT_MANIFEST_SHA:pin,RESEARCH_UPLOAD_TENANT:'synthetic',RESEARCH_UPLOADS:{async get(key){reads++;assert.match(key,/^development\/owner\/synthetic\//);const text=objects.get(key.split('/').at(-1).slice(0,-5));return text===undefined?null:{size:Buffer.byteLength(text),body:new Response(text).body};}}};
 return {env,artifact,leaf,objects,reads:()=>reads,call:a=>readDevelopmentData(env,'owner',a)};
}
test('v2 traversal, full row pagination, filtering and exact artifact',async()=>{
 const f=fixture();assert.equal((await f.call({op:'catalog'})).version,2);
 assert.equal((await f.call({op:'index',table:'game_tracking'})).children.length,1);
 assert.equal((await f.call({op:'index',table:'game_tracking',path:[0]})).artifacts[0].sha256,f.artifact);
 const base={table:'game_tracking',path:[0],artifact:f.artifact};let offset=0,rows=[];
 do{const r=await f.call({op:'rows',...base,offset});rows.push(...r.rows);offset=r.nextOffset;}while(offset!==null);
 assert.deepEqual(rows.map(r=>r.time),Array.from({length:256},(_,i)=>String(i)));
 assert.equal((await f.call({op:'rows',...base,filters:{time:'42'}})).matched,1);
 const a=await f.call({op:'artifact',...base});assert.equal(createHash('sha256').update(a.text).digest('hex'),f.artifact);
});
test('v2 denies invalid paths, tables, hashes, SQL and bounds without arbitrary storage access',async()=>{
 const f=fixture(),base={op:'rows',table:'game_tracking',path:[0],artifact:f.artifact};
 for(const change of [{path:[64]},{path:[0,0]},{path:Array(7).fill(0)},{path:[]},{table:'game_tracking_2025'},{artifact:'../secret'},{filters:{sql:'select *'}},{limit:101},{offset:257},{sql:'select *'}])await assert.rejects(f.call({...base,...change}));
 f.objects.set(f.leaf,'{}');await assert.rejects(f.call(base),/integrity/);
});
test('v2 hash-valid holdout rows fail closed',async()=>{
 const f=fixture('2025');await assert.rejects(f.call({op:'artifact',table:'game_tracking',path:[0],artifact:f.artifact}),/non_development/);
});
