/* Nightly RTDB backup — the scheduled() handler against the ASSEMBLED Worker,
   with only the network and KV faked. The backup is the last line of defence
   for the only unrecoverable data on the site, so the suite asserts not just
   that it writes, but that it stays READ-ONLY against Firebase and that a
   failed run leaves a post-mortem trail instead of dying silently.

   Run:  cd work && node test-backup.mjs
*/
import { webcrypto } from "crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import worker from "../dawg-bot-worker.js";

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log("  ok   " + n)) : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };

const DB = "https://data-dawgs-draft-default-rtdb.firebaseio.com";
const WHOLE_DB = {
  bozo: { leagues: { main: { name: "Data Dawgs", week: 3 } } },
  drafts: { pepperoninipples: { simulated: true } },
  users: { Kap: { hash: "not-a-real-hash" } },
};

let netMode = "normal";                  // normal | denied
const fbRequests = [];                   // every RTDB call, with method
globalThis.fetch = async (input, init) => {
  const u = String(input instanceof URL ? input.href : (input && input.url) || input);
  const method = (init && init.method) || (input && input.method) || "GET";
  if (u.startsWith(DB)) {
    fbRequests.push({ u, method });
    if (netMode === "denied") return new Response('{"error":"Permission denied"}', { status: 401 });
    return new Response(JSON.stringify(WHOLE_DB), { status: 200 });
  }
  throw new Error("unexpected fetch: " + u);
};

// KV fake that records puts verbatim, options included.
const makeKV = () => {
  const store = new Map(), puts = [];
  return {
    store, puts,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v, opts) { store.set(k, v); puts.push({ k, v, opts }); },
  };
};

const T0 = Date.parse("2026-09-15T09:00:00Z");

// -- a normal nightly run ----------------------------------------------------
{
  const kv = makeKV();
  await worker.scheduled({ scheduledTime: T0 }, { FB_SECRET: "s", RL: kv }, {});
  const dated = kv.puts.find((p) => p.k === "backup:2026-09-15");
  const latest = kv.puts.find((p) => p.k === "backup:latest");
  ok("dated snapshot written under backup:<day>", !!dated);
  ok("dated snapshot expires (180d), so KV prunes itself",
     dated && dated.opts && dated.opts.expirationTtl === 15552000);
  ok("backup:latest written with NO expiry — the floor never falls out",
     latest && !latest.opts);
  const parsed = dated && JSON.parse(dated.v);
  ok("payload records when it was taken", parsed && parsed.taken === "2026-09-15T09:00:00.000Z");
  ok("payload is the WHOLE database — users and bozoauth included, not a path list to forget",
     parsed && parsed.db && parsed.db.users && parsed.db.bozo && parsed.db.drafts && true);
  // Caught live 8/7: fbGet(env, "") builds `${DB}.json` — ".json" glued onto the
  // HOSTNAME, which DNS-fails as a Cloudflare 530. The root read must be "/" so the
  // URL is `${DB}/.json`. Assert the exact shape, not a prefix a mangled host also matches.
  ok("one RTDB read, at the root, host intact",
     fbRequests.length === 1 && fbRequests[0].u.startsWith(DB + "/.json?"));
  ok("backup is READ-ONLY against Firebase — no PUT/PATCH/DELETE ever",
     fbRequests.every((r) => r.method === "GET"));
  ok("no error key on a clean run", !kv.store.has("backup:lasterror"));
}

// -- second run same day overwrites, different day adds ----------------------
{
  const kv = makeKV();
  await worker.scheduled({ scheduledTime: T0 }, { FB_SECRET: "s", RL: kv }, {});
  await worker.scheduled({ scheduledTime: T0 + 86400000 }, { FB_SECRET: "s", RL: kv }, {});
  ok("next day gets its own key", kv.store.has("backup:2026-09-15") && kv.store.has("backup:2026-09-16"));
}

// -- a bound DD_KV is IGNORED; RL is named explicitly (same rule as survivor) -
/* ⚠️ THIS ASSERTION IS THE INVERSE OF WHAT IT USED TO BE, DELIBERATELY.
 * It once asserted DD_KV was PREFERRED over RL — the `env.DD_KV || env.RL` shape, whose
 * stated intent was "prefer a dedicated namespace if one is ever bound". That is a trap:
 * the live data is in RL, so binding a fresh empty DD_KV in the dashboard would have
 * silently repointed the backups — and survivor, the CFB market receipts, the player
 * index and every league join link — at an empty store. No exception, no 500, just blank
 * reads, discovered on the day the backup was needed. Binding is a dashboard action taken
 * by someone who is not reading this file, so the code must not be steerable from there.
 * The test now proves the opposite property: DD_KV can be bound and is ignored. */
{
  const dd = makeKV(), rl = makeKV();
  await worker.scheduled({ scheduledTime: T0 }, { FB_SECRET: "s", DD_KV: dd, RL: rl }, {});
  ok("a bound DD_KV is ignored — RL is named explicitly", rl.puts.length > 0 && dd.puts.length === 0);
}

// -- a failed run must scream, not shrug -------------------------------------
{
  netMode = "denied";
  const kv = makeKV();
  let threw = false;
  try { await worker.scheduled({ scheduledTime: T0 }, { FB_SECRET: "s", RL: kv }, {}); }
  catch (e) { threw = true; }
  ok("RTDB failure propagates so the cron log shows a failed run", threw);
  const err = kv.store.get("backup:lasterror");
  ok("…and leaves backup:lasterror for the post-mortem", !!err && /401/.test(err));
  ok("…without writing a corrupt snapshot", !kv.store.has("backup:2026-09-15") && !kv.store.has("backup:latest"));
  netMode = "normal";
}

// -- no KV binding is a hard error, not a silent no-op -----------------------
{
  let threw = false;
  try { await worker.scheduled({ scheduledTime: T0 }, { FB_SECRET: "s" }, {}); }
  catch (e) { threw = /no KV binding/.test(e.message); }
  ok("missing KV binding throws by name", threw);
}

// -- Pound copies: private per-owner keys, 30-day expiry, no indefinite copy --
{
  WHOLE_DB.privatePounds = {
    u_one: {owner_uid: "u_one", payload: JSON.stringify({revision: 3, text: "Owner one private context"})},
    u_two: {owner_uid: "u_two", payload: JSON.stringify({revision: 7, text: "Owner two private context"})},
  };
  const original = JSON.stringify(WHOLE_DB), kv = makeKV();
  kv.store.set("backup:historic", "existing backup must survive");
  await worker.scheduled({scheduledTime: T0}, {FB_SECRET: "s", RL: kv}, {});
  const general = kv.puts.filter(p => p.k.startsWith("backup:") && p.k !== "backup:lasterror");
  ok("both new general backup forms exclude privatePounds", general.length === 2 && general.every(p => !Object.hasOwn(JSON.parse(p.v).db, "privatePounds")));
  const expected = {...WHOLE_DB};delete expected.privatePounds;
  ok("unrelated database content preserved exactly", general.every(p => JSON.stringify(JSON.parse(p.v).db) === JSON.stringify(expected)));
  const privateCopies = kv.puts.filter(p => p.k.startsWith("pound-backup:"));
  ok("one private snapshot per verified owner and date", privateCopies.length === 2 && privateCopies.every(p => /^pound-backup:v1:u_(one|two):2026-09-15$/.test(p.k)));
  ok("every private snapshot expires in exactly 30 days", privateCopies.every(p => p.opts?.expirationTtl === 30 * 86400));
  ok("no everlasting private latest copy", !kv.puts.some(p => p.k.startsWith("pound-backup:") && (!p.opts?.expirationTtl || p.k.endsWith(":latest"))));
  ok("owner copies contain exact payloads and never the other owner's record", privateCopies.every(p => {const v=JSON.parse(p.v);return v.taken === new Date(T0).toISOString() && v.version === 1 && JSON.stringify(v.workspace) === JSON.stringify(WHOLE_DB.privatePounds[v.owner_uid]) && !Object.hasOwn(v, "db");}));
  ok("active workspace input remains untouched", JSON.stringify(WHOLE_DB) === original);
  ok("existing historical backup untouched", kv.store.get("backup:historic") === "existing backup must survive");
  ok("Pound backup uses only existing RL binding", privateCopies.length === 2);
  await worker.scheduled({scheduledTime: T0}, {FB_SECRET: "s", RL: kv}, {});
  ok("same-day retry replaces identical private day keys", [...kv.store.keys()].filter(k => k.startsWith("pound-backup:")).length === 2);
  await worker.scheduled({scheduledTime: T0+86400000}, {FB_SECRET: "s", RL: kv}, {});
  ok("following day creates independently expiring private copies", [...kv.store.keys()].filter(k => k.startsWith("pound-backup:")).length === 4 && kv.puts.filter(p=>p.k.startsWith("pound-backup:")).every(p=>p.opts.expirationTtl===2592000));
  ok("private backup never writes or deletes active Firebase records", fbRequests.every(r=>r.method === "GET"));
  // Simulate provider TTL expiry: the records in RTDB remain independently active.
  const expired = new Map(privateCopies.map(p => [p.k,{value:p.v,expires:T0+p.opts.expirationTtl*1000}]));
  ok("private copies expire at day 30 while active records remain", [...expired.values()].every(p=>T0+30*86400000>=p.expires) && JSON.stringify(WHOLE_DB)===original);
  delete WHOLE_DB.privatePounds;
}

// -- private copy failure must not contaminate general backups or expose content --
{
  WHOLE_DB.privatePounds={u_one:{owner_uid:"u_one",payload:"private-canary"}};
  const kv=makeKV(),basePut=kv.put.bind(kv);kv.put=async(k,v,o)=>{if(k.startsWith("pound-backup:"))throw new Error("provider exposed private-canary");return basePut(k,v,o);};
  let message="";try{await worker.scheduled({scheduledTime:T0},{FB_SECRET:"s",RL:kv},{});}catch(e){message=e.message;}
  ok("private failure propagates with a sanitized message",message==="Private workspace backup write failed");
  ok("failure leaves general backup working and Pound-free",kv.store.has("backup:latest")&&!Object.hasOwn(JSON.parse(kv.store.get("backup:latest")).db,"privatePounds"));
  ok("post-mortem never contains private provider payload",!kv.store.get("backup:lasterror").includes("private-canary"));
  ok("failed private snapshot never becomes an unbounded fallback",!kv.puts.some(p=>p.k.startsWith("pound-backup:")));
  delete WHOLE_DB.privatePounds;
}

// -- malformed owner records fail closed without leaking into general snapshots --
{
  WHOLE_DB.privatePounds={u_one:{owner_uid:"u_other",payload:"private-canary"}};
  const kv=makeKV();let threw=false;try{await worker.scheduled({scheduledTime:T0},{FB_SECRET:"s",RL:kv},{});}catch{threw=true;}
  ok("mismatched owner is not written under another owner's key",threw&&!kv.puts.some(p=>p.k.startsWith("pound-backup:")));
  ok("malformed private records remain excluded from general backups",!Object.hasOwn(JSON.parse(kv.store.get("backup:latest")).db,"privatePounds"));
  delete WHOLE_DB.privatePounds;
}

// Research payloads and upload metadata get distinct expiring copies, never a
// general backup or an archive-byte copy. This tests the assembled Worker.
{
  WHOLE_DB.researchLab={v1:{tenants:{jason_bdb:{version:1,payload:'{"state":{"nullable":null},"inputs":{}}'}}}};
  WHOLE_DB.researchUploads={v1:{u_owner:{version:1,owner_uid:'u_owner',payload:'{"name":"private.zip"}'}}};
  const original=JSON.stringify(WHOLE_DB),kv=makeKV();
  await worker.scheduled({scheduledTime:T0},{FB_SECRET:'s',RL:kv},{});
  const copies=kv.puts.filter(p=>p.k.startsWith('research-backup:'));
  ok('research gets two separate 30-day metadata copies',copies.length===2&&copies.every(p=>p.opts.expirationTtl===2592000));
  ok('research never enters dated or permanent general backups',kv.puts.filter(p=>p.k.startsWith('backup:')).every(p=>!JSON.parse(p.v).db?.researchLab&&!JSON.parse(p.v).db?.researchUploads));
  ok('research payloads retained exactly and active data unchanged',JSON.stringify(WHOLE_DB)===original&&JSON.parse(copies[0].v).record.payload===WHOLE_DB.researchLab.v1.tenants.jason_bdb.payload);
  delete WHOLE_DB.researchLab;delete WHOLE_DB.researchUploads;
}
// Research project envelopes (WO-01): same rule, one expiring copy per project. Synthetic.
{
  WHOLE_DB.researchProjects={v1:{synthetic:{'bdb-test':{version:1,tenant:'synthetic',project_id:'bdb-test',owner_uid:'u_owner',payload:'{"questions":[{"text":"private synthetic"}]}'}}}};
  const original=JSON.stringify(WHOLE_DB),kv=makeKV();
  await worker.scheduled({scheduledTime:T0},{FB_SECRET:'s',RL:kv},{});
  const copies=kv.puts.filter(p=>p.k.startsWith('research-backup:v1:project:'));
  ok('each research project gets one 30-day private copy',copies.length===1&&copies[0].k==='research-backup:v1:project:synthetic:bdb-test:'+new Date(T0).toISOString().slice(0,10)&&copies[0].opts.expirationTtl===2592000);
  ok('research projects never enter dated or permanent general backups',kv.puts.filter(p=>p.k.startsWith('backup:')).every(p=>!JSON.parse(p.v).db?.researchProjects&&!p.v.includes('private synthetic')));
  ok('project payload retained exactly and active data unchanged',JSON.stringify(WHOLE_DB)===original&&JSON.parse(copies[0].v).record.payload===WHOLE_DB.researchProjects.v1.synthetic['bdb-test'].payload);
  WHOLE_DB.researchProjects.v1.synthetic['bdb-test'].tenant='other';const bad=makeKV();
  let threw=false;try{await worker.scheduled({scheduledTime:T0},{FB_SECRET:'s',RL:bad},{});}catch{threw=true;}
  ok('a project copy whose envelope names another tenant is refused, never written',threw&&!bad.puts.some(p=>p.k.startsWith('research-backup:v1:project:'))&&!JSON.parse(bad.store.get('backup:latest')).db.researchProjects);
  delete WHOLE_DB.researchProjects;
}
// Actual incident shape: the complete tenant envelope was stored as a STRING.
// Use synthetic content only. Rejection must preserve data and never leak it.
{
 const envelope={version:1,access:{users:{u_synthetic:{enabled:true,owner:true}}},payload:'{"state":{"version":1,"nullable":null,"tasks":[]},"inputs":{}}'};
 WHOLE_DB.researchLab={v1:{tenants:{'synthetic-tenant':JSON.stringify(envelope)}}};
 const original=JSON.stringify(WHOLE_DB),kv=makeKV();let message='';
 try{await worker.scheduled({scheduledTime:T0},{FB_SECRET:'s',RL:kv},{});}catch(e){message=e.message;}
 ok('outer-string incident rejects with sanitized type diagnostic',message==='Private research backup envelope must be an object');
 ok('invalid tenant remains unchanged, with no fallback private copy',JSON.stringify(WHOLE_DB)===original&&!kv.puts.some(p=>p.k.startsWith('research-backup:')));
 ok('invalid tenant never enters general backup or error content',!JSON.parse(kv.store.get('backup:latest')).db.researchLab&&!kv.store.get('backup:lasterror').includes('synthetic-tenant'));
 // A separately authorized repair parses only the outer envelope, never payload.
 WHOLE_DB.researchLab.v1.tenants['synthetic-tenant']=JSON.parse(WHOLE_DB.researchLab.v1.tenants['synthetic-tenant']);
 const repaired=JSON.stringify(WHOLE_DB),after=makeKV();
 await worker.scheduled({scheduledTime:T0},{FB_SECRET:'s',RL:after},{});
 const copies=after.puts.filter(p=>p.k.startsWith('research-backup:'));
 ok('native envelope backup keeps exact inner payload and 30-day expiry',copies.length===1&&copies[0].opts.expirationTtl===2592000&&JSON.parse(copies[0].v).record.payload===envelope.payload);
 ok('successful backup does not alter repaired active data',JSON.stringify(WHOLE_DB)===repaired);
 delete WHOLE_DB.researchLab;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
