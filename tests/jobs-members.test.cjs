// Friend (member) isolation for the job harness. Synthetic identities only; in-memory storage.
// Members exist only when JOB_HARNESS_MEMBER_UIDS lists them; each gets /privateJobs/v1/<own uid>.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const source=['jobs-core.js','work/dawg-pound.js','work/jobs.js'].map(f=>fs.readFileSync(f,'utf8')).join('\n');
const USERS=['u_owner','u_member_a','u_member_b','u_stranger'];
function rig(members='u_member_a,u_member_b'){
 const db=new Map(),reads=[],writes=[],etags=new Map();const env={RESEARCH_OWNER_UID:'u_owner',JOB_HARNESS_ENABLED:'true',...(members===null?{}:{JOB_HARNESS_MEMBER_UIDS:members})};
 const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Request,Response,Headers,URL,Date,ORIGINS:['https://datadawgs216.com'],
  readSession:async(e,t)=>USERS.includes(t.split('.')[0])?{u:t.split('.')[0]}:null,sessionAuth:async r=>({uid:r.headers.get('X-Dawg-Session').split('.')[0]}),
  fbGet:async(e,p)=>{reads.push(p);return {data:db.get(p)||null,etag:String(etags.get(p)||0)};},
  fbPut:async(e,p,v,etag)=>{if(etag!==String(etags.get(p)||0))return false;db.set(p,v);etags.set(p,(etags.get(p)||0)+1);writes.push(p);return true;}};
 vm.createContext(context);vm.runInContext(source+'\nthis.handle=handleJobs;',context);
 const revs=new Map();let n=0;
 const send=async(user,body,path='/api/jobs/v1')=>{const r=await context.handle(new Request('https://worker.test'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+user+'.'+'x'.repeat(43),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);const text=await r.text();const out={status:r.status,body:JSON.parse(text),text};if(out.body.workspace)revs.set(user,out.body.workspace.revision);return out;};
 const cmd=(user,op,data,request_id)=>({op,data,expected_revision:revs.get(user)||0,request_id:request_id||'synthetic_member_'+String(++n).padStart(4,'0')});
 const ok=async(user,op,data,id)=>{const r=await send(user,cmd(user,op,data,id));assert.equal(r.status,200,user+' '+op+' '+r.text);return r;};
 return {send,cmd,ok,db,reads,writes,env};
}
const T=d=>`2026-01-${String(d).padStart(2,'0')}T12:00:00.000Z`;
const listing=(req,extra={})=>({employer_key:'synthetic-co',employer:'Synthetic Co',role:'Analyst',requisition:req,url:'https://example.com/jobs/'+req,url_verified_at:T(1),resume_version:'v1',next_action:'Review',blocker:'',...extra});
const ev=(id,day)=>({id,stage:'submitted',outcome:'none',occurred_at:T(day),verified_at:T(day),evidence_url:'https://example.com/receipt/'+day,reason_kind:'unknown',reason:'',next_action:'',blocker:'',resume_version:'v1'});

test('default is owner only: without the member list, friends are refused before any storage read',async()=>{
 const r=rig(null);                                    // variable absent, as in wrangler.jsonc today
 for(const user of ['u_member_a','u_stranger']){for(const body of [undefined,r.cmd(user,'record.create',listing('X-1'))]){const res=await r.send(user,body);assert.equal(res.status,403);assert.deepEqual(res.body,{error:'access_not_granted'});}}
 assert.deepEqual(r.reads,[]);assert.equal((await r.send('u_owner')).body.access,'owner');
});
test('a malformed or empty member list admits nobody extra; the owner is unaffected',async()=>{
 for(const members of ['', '  ', 'u_member_a, not-a-uid', 'u_member_a;u_member_b', 'u_member_a,,u_member_b', 'u_member_a/x']){
  const r=rig(members);assert.equal((await r.send('u_member_a')).status,403,JSON.stringify(members));assert.equal((await r.send('u_owner')).status,200);assert.ok(!r.reads.includes('/privateJobs/v1/u_member_a'));}
 const r=rig(' u_member_a , u_member_b ');assert.equal((await r.send('u_member_a')).body.access,'member','whitespace around entries is fine');
});
test('members and the owner each see only their own workspace; strangers stay out',async()=>{
 const r=rig();
 await r.ok('u_member_a','record.create',listing('A-1',{role:'SYNTHETIC_A_ONLY'}));
 await r.ok('u_owner','record.create',listing('O-1',{role:'SYNTHETIC_OWNER_ONLY'}));
 const a=await r.send('u_member_a'),b=await r.send('u_member_b'),o=await r.send('u_owner');
 assert.equal(a.body.access,'member');assert.deepEqual(a.body.workspace.records.map(x=>x.requisition),['A-1']);assert.equal(a.body.workspace.owner_uid,'u_member_a');
 assert.deepEqual(b.body.workspace.records,[]);assert.ok(!b.text.includes('SYNTHETIC_A_ONLY')&&!b.text.includes('SYNTHETIC_OWNER_ONLY'));
 assert.deepEqual(o.body.workspace.records.map(x=>x.requisition),['O-1']);assert.ok(!o.text.includes('SYNTHETIC_A_ONLY'),'the owner cannot read members through the app');
 const s=await r.send('u_stranger');assert.equal(s.status,403);assert.ok(!r.reads.includes('/privateJobs/v1/u_stranger'));
 assert.deepEqual([...new Set(r.writes)].sort(),['/privateJobs/v1/u_member_a','/privateJobs/v1/u_owner']);
});
test('no cross-tenant deduplication: the same requisition is independent per member, and nothing is inferable',async()=>{
 const r=rig();await r.ok('u_member_a','record.create',listing('SHARED-1'));
 const b=await r.send('u_member_b',r.cmd('u_member_b','record.create',listing('SHARED-1')));assert.equal(b.status,200,'B is not told A tracks it');
 assert.equal((await r.send('u_member_b',r.cmd('u_member_b','record.create',listing('SHARED-1')))).body.error,'duplicate_requisition','B dedups against B only');
});
test("guessed or known record ids from another member behave exactly like random ids",async()=>{
 const r=rig(),a=await r.ok('u_member_a','record.create',listing('A-1'));const id=a.body.receipt.id;await r.ok('u_member_a','event.append',ev(id,2));
 const before=r.db.get('/privateJobs/v1/u_member_a').payload;await r.ok('u_member_b','record.create',listing('B-1'));
 const probes=id2=>[['event.append',ev(id2,3)],['event.correct',{id:id2,target:0,action:'void',replacement:null,note:'x'}],['record.correct',{id:id2,changes:{role:'Y'},note:'x'}],['record.archive',{id:id2,note:''}],['record.restore',{id:id2,note:''}]];
 for(const [i,[op,data]] of probes(id).entries()){
  const known=await r.send('u_member_b',r.cmd('u_member_b',op,data)),random=await r.send('u_member_b',r.cmd('u_member_b',op,probes('00000000-0000-4000-8000-000000000000')[i][1]));
  assert.equal(known.status,404,op);assert.deepEqual(known.body,random.body,op+': same answer as a random id');}
 assert.equal(r.db.get('/privateJobs/v1/u_member_a').payload,before,"A's workspace untouched");
});
test('request ids and receipts are per workspace: replaying another member’s key never returns their result',async()=>{
 const r=rig(),key='synthetic_shared_key_0001',a=await r.ok('u_member_a','record.create',listing('K-1'),key);
 const b=await r.send('u_member_b',r.cmd('u_member_b','record.create',listing('K-1'),key));
 assert.equal(b.status,200);assert.equal(b.body.replayed,false);assert.notEqual(b.body.receipt.id,a.body.receipt.id);
});
test('tenant cannot be chosen by the caller: body, query and path attempts are refused',async()=>{
 const r=rig(),writes=r.writes.length;
 for(const field of ['owner_uid','uid','actor_uid','tenant'])assert.equal((await r.send('u_member_b',r.cmd('u_member_b','record.create',{...listing('Z-1'),[field]:'u_member_a'}))).status,400,field);
 assert.equal((await r.send('u_member_b',undefined,'/api/jobs/v1?uid=u_member_a')).status,400);
 assert.equal((await r.send('u_member_b',undefined,'/api/jobs/v1/u_member_a')).status,404);
 assert.equal(r.writes.length,writes);assert.ok(!r.reads.includes('/privateJobs/v1/u_member_a'));
});
test('an envelope written under the wrong uid is refused, not served',async()=>{
 const r=rig();await r.ok('u_member_a','record.create',listing('A-1'));
 r.db.set('/privateJobs/v1/u_member_b',r.db.get('/privateJobs/v1/u_member_a'));
 const res=await r.send('u_member_b');assert.equal(res.status,403);assert.deepEqual(res.body,{error:'owner_mismatch'});
});
test('the disabled flag closes members too; removal from the list ends access but keeps their data',async()=>{
 const r=rig();await r.ok('u_member_a','record.create',listing('A-1'));const kept=r.db.get('/privateJobs/v1/u_member_a');
 r.env.JOB_HARNESS_ENABLED='false';assert.equal((await r.send('u_member_a')).status,503);r.env.JOB_HARNESS_ENABLED='true';
 r.env.JOB_HARNESS_MEMBER_UIDS='u_member_b';assert.equal((await r.send('u_member_a')).status,403);assert.equal(r.db.get('/privateJobs/v1/u_member_a'),kept);
});
