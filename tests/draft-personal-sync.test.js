const assert=require("node:assert/strict");
const fs=require("node:fs");
const {webcrypto}=require("node:crypto");
if(!globalThis.crypto) globalThis.crypto=webcrypto;
const sync=require("../draft-personal-sync.js");

const EMPTY={
  filters:{query:"",position:"ALL",hideTaken:false,taggedOnly:false,sort:{key:"rank",direction:"asc"}},
  marks:[],keeperIds:[]
};

assert.equal(sync.assertMarkMapping(sync.LOCAL_MARK_VALUES),true);
assert.throws(()=>sync.assertMarkMapping(["mine","taken","future"]),/not exhaustive/);

// Exhaustiveness is pinned to values the rig actually produces, not just to the map's
// own keys. Adding a third literal to a marks[...] assignment fails this test until a
// wire mapping is deliberately chosen.
const boardSource=fs.readFileSync(require.resolve("../board.html"),"utf8");
const rigValues=new Set();
for(const line of boardSource.split(/\r?\n/)){
  if(!line.includes("marks[") && !line.includes("BOARD_MARK_VALUES")) continue;
  for(const match of line.matchAll(/"([a-z]+)"/g)){
    if(["mine","taken","target"].includes(match[1])) rigValues.add(match[1]);
  }
}
assert.deepEqual([...rigValues].sort(),["mine","taken"],"the rig's complete local mark vocabulary is mapped");
assert.equal(sync.assertMarkMapping([...rigValues]),true);
assert.equal(sync.assertSortKeys(sync.SORT_KEYS),true);
assert.throws(()=>sync.assertSortKeys([...sync.SORT_KEYS,"future"]),/sort-key contract/);

(async()=>{
  const id=await sync.playerId("Justin Jefferson",webcrypto);
  assert.match(id,/^p:[a-f0-9]{32}$/);
  assert.equal(id,await sync.playerId("  JUSTIN JEFFERSON  ",webcrypto),"player identity is normalized and stable");

  const scratch=await sync.marksToWire({"Justin Jefferson":"taken"},name=>sync.playerId(name,webcrypto));
  assert.deepEqual(scratch,[{playerId:id,mark:"taken"}],"taken is a personal manual scratch mark");
  assert.equal(JSON.stringify(scratch).includes("picks"),false,"shared picks are not an input or mirror field");
  assert.deepEqual(sync.normalizeKeeperIds([id,"bad id",id]),[id],"keeper IDs are bounded, unique contract IDs");

  const makeStorage=(rows={})=>{
    const values=new Map(Object.entries(rows));
    return {values,getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value))};
  };
  const response=(status,body)=>({ok:status>=200&&status<300,status,async json(){return body;}});
  const league="dd_"+"a".repeat(32), metaKey="dd-draft-sync-v1:"+league;

  // Signed-out behavior stays byte-identical: no sync metadata or network work. If the
  // user signs in on this page, start() sees the non-default local snapshot as dirty.
  {
    const storage=makeStorage();
    const client=sync.create({leagueId:league,storage,fetch:async()=>{throw new Error("no network");},
      capture:async()=>EMPTY,apply:async()=>{},onStatus:()=>{}});
    client.markDirty();
    assert.equal(storage.getItem(metaKey),null);
    assert.equal(client.timer,null,"signed-out edits never make a network attempt");
  }

  // Clean local means a higher server version hydrates down.
  {
    const storage=makeStorage({"dd-bozo-sess":"session"});
    let applied=null;
    const client=sync.create({leagueId:league,storage,fetch:async()=>response(200,{ok:true,exists:true,version:4,updatedAt:999,state:EMPTY}),
      capture:async()=>EMPTY,apply:async state=>{applied=state;},onStatus:()=>{}});
    assert.equal(await client.start(),true);
    assert.deepEqual(applied,EMPTY);
    assert.deepEqual(JSON.parse(storage.getItem(metaKey)),{serverVersion:4,dirty:false,editSeq:0});
  }

  // Dirty local never compares clocks: it gets a 409, explicitly rebases, then becomes
  // the last accepted private write. Remote state is not applied during that sequence.
  {
    const storage=makeStorage({"dd-bozo-sess":"session",[metaKey]:JSON.stringify({serverVersion:4,dirty:true,editSeq:3})});
    const bodies=[]; let applied=false;
    const fetch=async(_url,init)=>{
      if(init.method==="GET") return response(200,{ok:true,exists:true,version:5,updatedAt:10,state:EMPTY});
      const sent=JSON.parse(init.body); bodies.push(sent);
      if(bodies.length===1) return response(409,{ok:false,current:{version:5,updatedAt:11,state:EMPTY}});
      return response(200,{ok:true,version:6,updatedAt:12,state:sent.state});
    };
    const local={...EMPTY,filters:{...EMPTY.filters,query:"local"}};
    const client=sync.create({leagueId:league,storage,fetch,capture:async()=>local,apply:async()=>{applied=true;},onStatus:()=>{}});
    await client.start();
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.deepEqual(bodies.map(body=>body.baseVersion),[4,5]);
    assert.equal(applied,false);
    assert.deepEqual(JSON.parse(storage.getItem(metaKey)),{serverVersion:6,dirty:false,editSeq:3});
  }

  // An edit made while PUT is in flight cannot be cleared by that older response.
  {
    const storage=makeStorage({"dd-bozo-sess":"session",[metaKey]:JSON.stringify({serverVersion:1,dirty:true,editSeq:7})});
    let release;
    const fetch=async(_url,init)=>{
      if(init.method!=="PUT") throw new Error("unexpected GET");
      await new Promise(resolve=>{release=resolve;});
      return response(200,{ok:true,version:2,updatedAt:100,state:EMPTY});
    };
    const client=sync.create({leagueId:league,storage,fetch,capture:async()=>EMPTY,apply:async()=>{},onStatus:()=>{}});
    const saving=client.save(false);
    while(!release) await Promise.resolve();
    client.markDirty();
    release();
    await saving;
    assert.equal(client.meta.dirty,true,"step-9 editSeq guard retains the newer local edit");
    assert.equal(client.meta.editSeq,8);
    clearTimeout(client.timer);
  }

  // A permanent pre-Tranche-B route miss degrades honestly and does not poll forever.
  {
    const storage=makeStorage({"dd-bozo-sess":"session",[metaKey]:JSON.stringify({serverVersion:0,dirty:true,editSeq:1})});
    const client=sync.create({leagueId:league,storage,fetch:async()=>response(404,{ok:false,error:"not_found"}),
      capture:async()=>EMPTY,apply:async()=>{},onStatus:()=>{}});
    await client.save(false);
    assert.equal(client.meta.dirty,true);
    assert.equal(client.timer,null,"permanent route errors wait for a later edit or page load");
  }

  const source=fs.readFileSync(require.resolve("../draft-personal-sync.js"),"utf8");
  assert.equal(source.includes("Date.now("),false,"client clocks never choose a winner");
  assert.match(source,/Shared game state uses\s*\/\/ append-only events/,
    "dirty-local full replacement is explicitly scoped away from shared state");

  console.log("draft personal sync tests: ok");
})().catch(error=>{console.error(error);process.exitCode=1;});
