import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {v3Fixture,sha,canonicalSelector} from './development-v3-fixture.mjs';

test('V3 selective prefix discovery and complete range pagination exclude adjacent rows',async()=>{
 const f=v3Fixture();assert.equal((await f.call({op:'catalog'})).version,3);
 let selector={};
 for(let i=0;i<5;i++){const r=await f.call({op:'lookup',table:'game_tracking',selector});assert.equal(r.children.length,1);selector=r.children[0];}
 const found=await f.call({op:'lookup',table:'game_tracking',selector});assert.deepEqual(found.shards,[f.descriptor]);
 const base={table:'game_tracking',selector,artifact:f.descriptor.sha256};let offset=0,rows=[];
 do{const r=await f.call({op:'rows',...base,offset});assert.ok(r.rows.length<=100);rows.push(...r.rows);offset=r.nextOffset;}while(offset!==null);
 assert.equal(rows.length,201);assert.ok(rows.every(r=>r.nfl_id==='wr'));assert.deepEqual(rows.map(r=>r.time),Array.from({length:201},(_,i)=>String(i)));
 const a=await f.call({op:'artifact',...base}),bytes=Buffer.from(a.data,'base64');assert.equal(sha(bytes),a.sha256);assert.equal(sha(gunzipSync(bytes)),a.decodedSha256);assert.deepEqual(a.range,{start:1,count:201});
 const before=f.reads.length;assert.equal((await f.call({op:'lookup',table:'game_tracking',selector:{season:'2024'}})).found,false);assert.equal(f.reads.length-before,2);
});

test('V3 bounded trie and external descriptor pages preserve repeated shard ranges',async()=>{
 const f=v3Fixture(),entry=f.node.entries.at(-1),pageBase={version:3,kind:'page',sourceSha256:f.manifest.sourceSha256,table:'game_tracking',selector:f.selector};
 entry.pages=[f.put({...pageBase,shards:Array(64).fill(f.descriptor)}),f.put({...pageBase,shards:[f.descriptor]})];delete entry.values;
 const leaf=f.put(f.node),prefix=entry.key[0];f.node={};
 const root=f.put({version:3,kind:'lookup',sourceSha256:f.manifest.sourceSha256,table:'game_tracking',children:[{prefix,sha256:leaf}]});
 f.manifest.tables.game_tracking.root=root;f.env.RESEARCH_DEVELOPMENT_MANIFEST_SHA=f.put(f.manifest);
 let page=0,count=0;do{const r=await f.call({op:'lookup',table:'game_tracking',selector:f.selector,page});count+=r.shards.length;page=r.nextPage;}while(page!==null);assert.equal(count,65);
 const r=await f.call({op:'rows',table:'game_tracking',selector:f.selector,page:1,artifact:f.descriptor.sha256,offset:200});assert.equal(r.rows.length,1);assert.equal(r.nextOffset,null);
});

test('V3 rejects holdout, partial/gapped selectors, bad ranges, keys and limits',async()=>{
 const f=v3Fixture(),base={op:'rows',table:'game_tracking',selector:f.selector,artifact:f.descriptor.sha256};
 for(const change of [{selector:{...f.selector,season:'2025'}},{selector:{...f.selector,season_type:'PRE'}},{selector:{nfl_id:'wr'}},{selector:{...f.selector,sql:'select'}},{path:[]},{artifact:'../other'},{offset:2049},{limit:101},{page:256}])await assert.rejects(f.call({...base,...change}));
 f.descriptor.start=0;f.descriptor.count=201;f.repin();await assert.rejects(f.call(base),/partition_range/);
});

test('V3 validates compressed and decoded identity and rejects hash-valid out-of-scope data',async()=>{
 for(const mode of ['compressed','decoded','holdout','position','season_type']){
  const f=v3Fixture();
  if(mode==='compressed')f.objects.set(f.descriptor.sha256+'.gz',Buffer.alloc(f.descriptor.compressedBytes));
  else if(mode==='decoded'){f.descriptor.decodedSha256='0'.repeat(64);f.repin();}
  else{const r=f.artifact.rows[0];if(mode==='holdout')r.dd_season='2025';if(mode==='position')r.dd_nfl_position='CB';if(mode==='season_type')r.dd_season_type='POST';const raw=Buffer.from(JSON.stringify(f.artifact)),gz=gzipSync(raw);Object.assign(f.descriptor,{sha256:f.put(gz,'gz'),decodedSha256:sha(raw),decodedBytes:raw.length,compressedBytes:gz.length});f.repin();}
  await assert.rejects(f.call({op:'artifact',table:'game_tracking',selector:f.selector,artifact:f.descriptor.sha256}),mode==='compressed'?/integrity/:mode==='decoded'?/decoded_integrity/:/non_development/);
 }
});

test('V3 enforces streaming decoded bound before JSON parse',async()=>{
 const f=v3Fixture(),raw=Buffer.alloc(1048577,32),gz=gzipSync(raw);
 Object.assign(f.descriptor,{sha256:f.put(gz,'gz'),compressedBytes:gz.length,decodedBytes:1048576,decodedSha256:sha(raw)});f.repin();
 await assert.rejects(f.call({op:'artifact',table:'game_tracking',selector:f.selector,artifact:f.descriptor.sha256}),/artifact_too_large/);
});


test('all-position policy preserves non-WR, PRE/POST and cross-draft-year seasons; rejects holdout',async()=>{
 for(const seasonType of ['PRE','REG','POST']){
  const f=v3Fixture({policy:'all-position-development-v1',seasonType,position:'CB',draftYear:'2024'});
  const args={op:'rows',table:'game_tracking',selector:f.selector,artifact:f.descriptor.sha256};
  const r=await f.call(args);assert.equal(r.rows.length,100);assert.ok(r.rows.every(x=>x.dd_nfl_position==='CB'&&x.dd_season_type===seasonType&&x.dd_draft_year==='2024'&&x.dd_season==='2023'));
  await assert.rejects(f.call({...args,selector:{...f.selector,season:'2025'}}),/non_development/);
 }
 const f=v3Fixture({policy:'all-position-development-v1',position:'QB',draftYear:'2025'});
 await assert.rejects(f.call({op:'rows',table:'game_tracking',selector:f.selector,artifact:f.descriptor.sha256}),/non_development/);
});

test('V3 metadata leaves accept 128 entries but reject 129 within the byte cap',async()=>{
 const f=v3Fixture();
 while(f.node.entries.length<128){const i=f.node.entries.length;f.node.entries.push({key:sha('synthetic-'+i),selector:{season:'2024',season_type:'REG',game_id:'g'+i},kind:'children',rows:null,values:[{season:'2024',season_type:'REG',game_id:'g'+i,play_id:'p'}]});}
 f.repin();assert.ok((await f.call({op:'lookup',table:'game_tracking',selector:f.selector})).shards.length);
 f.node.entries.push(f.node.entries[0]);f.repin();await assert.rejects(f.call({op:'lookup',table:'game_tracking',selector:f.selector}),/invalid_index/);
});
