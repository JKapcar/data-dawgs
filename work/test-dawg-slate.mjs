import assert from "node:assert/strict";
import slate from "../dawg-slate.js";

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log("  ok   " + name); };

ok("summarize is pure across repeated calls", () => {
  const raw = { leagues: [{ id:"b", game:"bozo", name:"Later", member:true, settings:{deadline:"2026-08-20T00:00:00Z"} }] };
  const before = JSON.stringify(raw);
  assert.deepEqual(slate.summarize(raw), slate.summarize(raw));
  assert.equal(JSON.stringify(raw), before);
});

ok("deadline rows sort first and undated personal state follows", () => {
  const rows = slate.summarize({ leagues:[
    {id:"g",game:"guillotine",name:"Undated",member:true,settings:{}},
    {id:"a",game:"draft",name:"First",member:true,settings:{draftAt:"2026-08-14T00:00:00Z"}},
    {id:"b",game:"bozo",name:"Second",member:true,settings:{closesAt:"2026-08-15T00:00:00Z"}}
  ], connector:{active:true} });
  assert.deepEqual(rows.map(r=>r.title), ["First","Second","Undated","Your AI connector"]);
});

ok("non-members and non-personal Survivor/DFS rows never appear", () => {
  const rows = slate.summarize({ leagues:[
    {id:"x",game:"bozo",name:"Not mine",member:false},
    {id:"s",game:"survivor",name:"Modelled",member:true},
    {id:"d",game:"dfs",name:"Browser local",member:true}
  ] });
  assert.equal(rows.length, 0);
});

ok("unknown settings degrade honestly with no invented deadline", () => {
  const row = slate.summarize({ leagues:[{id:"x",game:"bozo",name:"Dawgs",member:true,settings:{}}] })[0];
  assert.equal(row.deadline, null);
  assert.equal(row.action, "Nothing needs you right now.");
});

console.log(`\n${pass} passed, 0 failed\n`);
