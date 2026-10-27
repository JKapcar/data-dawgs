// Corrections, archive/restore, replay-after-refresh and deduplication for the job harness.
// Synthetic identities and invented records only; storage and sessions are in-memory mocks.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const source=['jobs-core.js','work/dawg-pound.js','work/jobs.js'].map(f=>fs.readFileSync(f,'utf8')).join('\n');
function rig(){
 const db=new Map(),writes=[];let version=0;const env={RESEARCH_OWNER_UID:'u_owner',JOB_HARNESS_ENABLED:'true'};
 const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Request,Response,Headers,URL,Date,ORIGINS:['https://datadawgs216.com'],
  readSession:async(e,t)=>['u_owner','u_other'].includes(t.split('.')[0])?{u:t.split('.')[0]}:null,
  sessionAuth:async r=>({uid:r.headers.get('X-Dawg-Session').split('.')[0]}),
  fbGet:async(e,p)=>({data:db.get(p)||null,etag:String(version)}),
  fbPut:async(e,p,v,etag)=>{if(etag!==String(version))return false;db.set(p,v);writes.push(p);version++;return true;}};
 vm.createContext(context);vm.runInContext(source+'\nthis.handle=handleJobs;this.core=JOBS_CORE;',context);
 const send=async(body,user='u_owner')=>{const headers={Authorization:'Bearer '+user+'.'+'x'.repeat(43),...(body?{'Content-Type':'application/json'}:{})};
  const r=await context.handle(new Request('https://worker.test/api/jobs/v1',{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})}),env);
  const text=await r.text();return {status:r.status,body:JSON.parse(text),text};};
 let n=0,revision=0;
 const cmd=(op,data,rev=revision)=>({op,data,expected_revision:rev,request_id:'synthetic_history_'+String(++n).padStart(4,'0')});
 const ok=async body=>{const r=await send(body);assert.equal(r.status,200,r.text);revision=r.body.workspace.revision;return r;};
 const state=()=>JSON.parse(db.get('/privateJobs/v1/u_owner').payload);
 const row=id=>state().records.find(r=>r.id===id);
 return {send,cmd,ok,db,writes,env,state,row,core:context.core,rev:()=>revision,setRev:v=>revision=v};
}
const T=d=>`2026-0${d<10?1:2}-${String(d<10?d:d-9).padStart(2,'0')}T12:00:00.000Z`; // T(1)..T(9) Jan, T(10).. Feb
const listing={employer_key:'synthetic-studio',employer:'Synthetic Studio',role:'Analyst',requisition:'TEST-001',url:'https://example.com/jobs/1',url_verified_at:T(1),resume_version:'synthetic-v1',next_action:'Review',blocker:''};
const status=(stage,outcome,day,extra={})=>({stage,outcome,occurred_at:T(day),verified_at:T(day),evidence_url:['submitted','interview','offer'].includes(stage)||['rejected','position_closed','accepted'].includes(outcome)?'https://example.com/receipt/'+stage+day:null,reason_kind:'unknown',reason:'',next_action:'',blocker:'',resume_version:'synthetic-v1',...extra});
const ev=(id,...a)=>({id,...status(...a)});
async function withRecord(){const r=rig(),a=await r.ok(r.cmd('record.create',listing));return {...r,id:a.body.receipt.id};}

test('a retry after a 409 re-read keeps its key and replays instead of applying twice',async()=>{
 const r=await withRecord(),first=r.cmd('event.append',ev(r.id,'submitted','none',2));
 assert.equal((await r.send(first)).status,200);                      // committed; the response is "lost"
 const retry={...first,expected_revision:r.rev()+1};                   // client re-read, same logical op
 const again=await r.send(retry);assert.equal(again.status,200);assert.equal(again.body.replayed,true);
 assert.equal(r.row(r.id).events.length,1);assert.equal(r.writes.length,2);
 assert.equal((await r.send({...retry,data:{...retry.data,next_action:'changed'}})).status,409,'same key, different content');
});
test('two writers on one revision: one commits, the stale one 409s, then succeeds once with its own key',async()=>{
 const r=await withRecord(),base=r.rev();
 const a=r.cmd('event.append',ev(r.id,'submitted','none',2),base),b=r.cmd('event.append',ev(r.id,'interview','none',3),base);
 assert.equal((await r.send(a)).status,200);
 const stale=await r.send(b);assert.equal(stale.status,409);assert.equal(stale.body.error,'revision_conflict');
 const fresh=await r.send({...b,expected_revision:base+1});assert.equal(fresh.status,200);assert.equal(fresh.body.replayed,false);
 assert.equal((await r.send({...b,expected_revision:base+2})).body.replayed,true);
 assert.deepEqual(r.row(r.id).events.map(e=>e.stage),['submitted','interview']);
});
test('re-entering an already recorded fact under a new key is refused',async()=>{
 const r=await withRecord();await r.ok(r.cmd('event.append',ev(r.id,'submitted','none',2)));
 const dup=await r.send(r.cmd('event.append',ev(r.id,'submitted','none',2,{next_action:'different words',verified_at:T(3)})));
 assert.equal(dup.status,409);assert.equal(dup.body.error,'duplicate_event');assert.equal(r.row(r.id).events.length,1);
 await r.ok(r.cmd('event.append',ev(r.id,'submitted','no_later_decision',4)));       // a genuinely new fact
});
test('replace correction keeps the original entry and records before/after with attribution',async()=>{
 const r=await withRecord();await r.ok(r.cmd('event.append',ev(r.id,'submitted','none',3)));await r.ok(r.cmd('event.append',ev(r.id,'interview','none',5)));
 const original=structuredClone(r.row(r.id).events[0]);
 const replacement=status('submitted','none',2,{evidence_url:'https://example.com/receipt/corrected'});
 const c=await r.ok(r.cmd('event.correct',{id:r.id,target:0,action:'replace',replacement,note:'Receipt shows the 2nd, not the 3rd.'}));
 const row=r.row(r.id);assert.deepEqual(row.events[0],original,'original evidence untouched');
 const fix=row.events[2];assert.equal(fix.kind,'correction');assert.equal(fix.target,0);assert.equal(fix.action,'replace');assert.equal(fix.actor_uid,'u_owner');
 assert.match(fix.recorded_at,/^\d{4}-\d{2}-\d{2}T/);assert.deepEqual(fix.replacement,replacement);assert.equal(fix.note,'Receipt shows the 2nd, not the 3rd.');
 const h=r.core.history(row);assert.equal(h.current.stage,'interview');assert.equal(h.timeline[0].occurred_at,T(2));assert.equal(h.timeline[0].corrected_by,2);
 assert.equal(c.body.receipt.id,r.id);
});
test('a correction can never turn an attempt into a submission; a new evidenced update can',async()=>{
 const r=await withRecord();await r.ok(r.cmd('event.append',ev(r.id,'approved','blocked_not_submitted',2,{blocker:'Portal error'})));
 for(const stage of ['submitted','interview','offer']){
  const res=await r.send(r.cmd('event.correct',{id:r.id,target:0,action:'replace',replacement:status(stage,'none',2),note:'It went through'}));
  assert.equal(res.status,409,stage);assert.equal(res.body.error,'correction_cannot_create_submission');}
 assert.equal(r.row(r.id).events.length,1);
 await r.ok(r.cmd('event.append',ev(r.id,'submitted','none',4)));
 assert.equal(r.core.current(r.row(r.id)).stage,'submitted');
});
test('void removes a mistaken update from the timeline; it can be reinstated; no-op corrections refused',async()=>{
 const r=await withRecord();await r.ok(r.cmd('event.append',ev(r.id,'submitted','none',2)));await r.ok(r.cmd('event.append',ev(r.id,'interview','none',4)));
 await r.ok(r.cmd('event.correct',{id:r.id,target:1,action:'void',replacement:null,note:'That interview was a different employer.'}));
 assert.equal(r.core.current(r.row(r.id)).stage,'submitted');
 const twice=await r.send(r.cmd('event.correct',{id:r.id,target:1,action:'void',replacement:null,note:'again'}));assert.equal(twice.body.error,'correction_changes_nothing');
 await r.ok(r.cmd('event.correct',{id:r.id,target:1,action:'replace',replacement:status('interview','none',4),note:'It was this employer after all.'}));
 assert.equal(r.core.current(r.row(r.id)).stage,'interview');
 const same=await r.send(r.cmd('event.correct',{id:r.id,target:1,action:'replace',replacement:status('interview','none',4),note:'no change'}));
 assert.equal(same.status,409);assert.equal(same.body.error,'correction_changes_nothing');
 assert.equal((await r.send(r.cmd('event.correct',{id:r.id,target:1,action:'void',replacement:status('interview','none',4),note:'x'}))).status,400,'void carries no replacement');
});
test('corrections that would make the timeline contradict itself are refused with indices only',async()=>{
 const r=await withRecord();await r.ok(r.cmd('event.append',ev(r.id,'submitted','none',2)));await r.ok(r.cmd('event.append',ev(r.id,'interview','none',4)));
 const before=structuredClone(r.state());
 const res=await r.send(r.cmd('event.correct',{id:r.id,target:0,action:'replace',replacement:status('submitted','none',6),note:'Typo in the date'}));
 assert.equal(res.status,409);assert.equal(res.body.error,'correction_conflicts_with_history');
 assert.deepEqual(res.body.conflict,{kind:'stage_regression',before:1,after:0});
 assert.deepEqual(Object.keys(res.body).sort(),['conflict','error']);assert.deepEqual(r.state(),before);
 // Fix the later entry first, then the earlier one: both succeed.
 await r.ok(r.cmd('event.correct',{id:r.id,target:1,action:'replace',replacement:status('interview','none',8),note:'Interview was the 8th'}));
 await r.ok(r.cmd('event.correct',{id:r.id,target:0,action:'replace',replacement:status('submitted','none',6),note:'Submitted the 6th'}));
 assert.equal(r.core.conflict(r.core.history(r.row(r.id)).timeline),null);
});
test('backdated or regressing updates still need the correction path',async()=>{
 const r=await withRecord();await r.ok(r.cmd('event.append',ev(r.id,'interview','none',5)));
 assert.equal((await r.send(r.cmd('event.append',ev(r.id,'submitted','none',3)))).body.error,'older_evidence_requires_reconciliation');
 assert.equal((await r.send(r.cmd('event.append',ev(r.id,'submitted','none',6)))).body.error,'stage_regression_requires_reconciliation');
 await r.ok(r.cmd('event.correct',{id:r.id,target:0,action:'replace',replacement:status('submitted','none',5),note:'It was only a recruiter screen'}));
 assert.equal(r.core.current(r.row(r.id)).stage,'submitted');
});
test('correction input is validated: note, action, target kind and range, replacement rules',async()=>{
 const r=await withRecord();await r.ok(r.cmd('event.append',ev(r.id,'submitted','none',2)));await r.ok(r.cmd('record.archive',{id:r.id,note:''}));await r.ok(r.cmd('record.restore',{id:r.id,note:''}));
 const base={id:r.id,target:0,action:'replace',replacement:status('submitted','no_later_decision',2),note:'Clarify'};
 for(const [change,code] of [[{note:''},'invalid_text'],[{note:'x'.repeat(501)},'invalid_text'],[{action:'delete'},'invalid_correction_action'],[{target:1},'invalid_correction_target'],
   [{target:2},'invalid_correction_target'],[{target:9},'invalid_correction_target'],[{target:-1},'invalid_correction_target'],[{target:'0'},'invalid_correction_target'],
   [{replacement:{...status('submitted','none',2),evidence_url:null}},'submission_or_decision_evidence_required'],[{replacement:{...status('submitted','none',2),evidence_url:'javascript:alert(1)'}},'https_url_required'],
   [{replacement:{...status('submitted','none',2),occurred_at:'2999-01-01T00:00:00.000Z'}},'invalid_timestamp'],[{replacement:null},'invalid_fields'],[{id:'missing'},'record_not_found'],[{extra:1},'invalid_fields']]){
  const res=await r.send(r.cmd('event.correct',{...base,...change}));assert.equal(res.body.error,code,JSON.stringify(change));}
 assert.equal(r.row(r.id).events.length,3);
});
test('listing corrections keep from/to, re-check identity and never collide with another record',async()=>{
 const r=await withRecord(),b=await r.ok(r.cmd('record.create',{...listing,requisition:'TEST-002',role:'Engineer'}));
 await r.ok(r.cmd('record.correct',{id:r.id,changes:{role:'Senior Analyst',url:'https://example.com/jobs/1b'},note:'Title was updated on the listing'}));
 const row=r.row(r.id),log=row.events.at(-1);assert.equal(row.role,'Senior Analyst');assert.equal(log.kind,'record_correction');
 assert.deepEqual(log.changes,{role:{from:'Analyst',to:'Senior Analyst'},url:{from:'https://example.com/jobs/1',to:'https://example.com/jobs/1b'}});
 const clash=await r.send(r.cmd('record.correct',{id:r.id,changes:{requisition:' test-002 '},note:'typo'}));
 assert.equal(clash.status,409);assert.deepEqual(clash.body,{error:'duplicate_requisition',duplicate_of:b.body.receipt.id,archived:false});
 await r.ok(r.cmd('record.correct',{id:r.id,changes:{requisition:'TEST-003'},note:'Requisition was mistyped'}));
 assert.equal(r.row(r.id).identity,'synthetic-studio|test-003');
 await r.ok(r.cmd('record.create',listing));                                       // the old identity is free again
 for(const [changes,code] of [[{},'invalid_fields'],[{owner_uid:'u_other'},'invalid_fields'],[{__proto__:null,constructor:'x'},'invalid_fields'],[{role:'Senior Analyst'},'correction_changes_nothing'],
   [{url:'http://example.com/x'},'https_url_required'],[{url:'https://user:pw@example.com/x'},'https_url_required'],[{employer_key:'Bad Key'},'canonical_employer_key_required'],[{employer:'a\u0007b'},'invalid_text']]){
  const res=await r.send(r.cmd('record.correct',{id:r.id,changes,note:'n'}));assert.equal(res.body.error,code,JSON.stringify(changes));}
 assert.equal((await r.send(r.cmd('record.correct',{id:r.id,changes:{role:'X'},note:''}))).body.error,'invalid_text','note required');
});
test('archive hides nothing it should keep: history, receipts, dates and duplicate detection survive; restore reopens',async()=>{
 const r=await withRecord(),create=r.cmd('event.append',ev(r.id,'submitted','none',2));await r.ok(create);
 const before=structuredClone(r.row(r.id).events),receipts=r.state().receipts.length;
 await r.ok(r.cmd('record.archive',{id:r.id,note:'Moved on'}));
 const archived=r.row(r.id);assert.deepEqual(archived.events.slice(0,1),before);assert.equal(archived.events[1].kind,'archive');assert.equal(archived.created_at,r.row(r.id).created_at);
 assert.ok(r.core.history(archived).archived);assert.equal(r.state().receipts.length,receipts+1);
 const view=(await r.send()).body.workspace.records.find(x=>x.id===r.id);assert.equal(view.events.length,2,'archived records stay readable');
 for(const [op,data] of [['event.append',ev(r.id,'interview','none',4)],['event.correct',{id:r.id,target:0,action:'void',replacement:null,note:'n'}],['record.correct',{id:r.id,changes:{role:'Y'},note:'n'}]])
  assert.equal((await r.send(r.cmd(op,data))).body.error,'record_archived',op);
 const dup=await r.send(r.cmd('record.create',{...listing,requisition:'test-001'}));assert.deepEqual(dup.body,{error:'duplicate_requisition',duplicate_of:r.id,archived:true});
 assert.equal((await r.send(r.cmd('record.archive',{id:r.id,note:''}))).body.error,'already_archived');
 const replay=await r.send({...create,expected_revision:r.rev()});assert.equal(replay.body.replayed,true,'receipts survive archive');
 await r.ok(r.cmd('record.restore',{id:r.id,note:'Recruiter reached out again'}));
 assert.equal(r.core.history(r.row(r.id)).archived,null);assert.equal((await r.send(r.cmd('record.restore',{id:r.id,note:''}))).body.error,'not_archived');
 await r.ok(r.cmd('event.append',ev(r.id,'interview','none',4)));
 assert.deepEqual(r.row(r.id).events.map(e=>e.kind||'status'),['status','archive','restore','status']);
});
test('requisition identity is canonical, not fuzzy',async()=>{
 const r=await withRecord();
 for(const req of ['ＴＥＳＴ－００１',' test-001','TEST-001 ','Test-001']){const res=await r.send(r.cmd('record.create',{...listing,requisition:req}));assert.equal(res.body.error,'duplicate_requisition',JSON.stringify(req));}
 await r.ok(r.cmd('record.create',{...listing,requisition:'TEST  002'}));
 assert.equal((await r.send(r.cmd('record.create',{...listing,requisition:'test 002'}))).body.error,'duplicate_requisition','whitespace runs collapse');
 for(const req of ['TEST-0001','REQ TEST-001','TEST-001-B'])await r.ok(r.cmd('record.create',{...listing,requisition:req}));
 await r.ok(r.cmd('record.create',{...listing,employer_key:'other-studio'}));          // same req, different employer
 assert.equal((await r.send(r.cmd('record.create',{...listing,employer_key:12}))).body.error,'canonical_employer_key_required','non-string key');
});
test('operation names cannot reach inherited members; unknown ops are 400 without a write',async()=>{
 const r=await withRecord(),writes=r.writes.length;
 for(const op of ['constructor','__proto__','toString','hasOwnProperty','record.delete','event.delete',1,null])
  assert.equal((await r.send({op,data:{},expected_revision:r.rev(),request_id:'synthetic_op_probe_'+String(op).replace(/\W/g,'_').padEnd(8,'x')})).body.error,'invalid_operation',String(op));
 assert.equal(r.writes.length,writes);
});
test('capacity fails closed without pruning: receipts and payload limits',async()=>{
 const r=await withRecord(),s=r.state();
 s.receipts=Array.from({length:2000},(_,i)=>({request_id:'synthetic_fill_'+String(i).padStart(6,'0'),fingerprint:'0'.repeat(64),result:{id:r.id,revision:1}}));
 r.db.set('/privateJobs/v1/u_owner',{owner_uid:'u_owner',payload:JSON.stringify(s)});
 const full=await r.send(r.cmd('event.append',ev(r.id,'submitted','none',2)));assert.equal(full.status,409);assert.equal(full.body.error,'workspace_full');
 s.receipts=[];s.records[0].next_action='x'.repeat(500);s.records.push(...Array.from({length:299},(_,i)=>({...s.records[0],id:'filler-'+i,identity:'filler|'+i,requisition:'F'+i,next_action:'y'.repeat(500),events:Array.from({length:8},()=>({...ev('filler-'+i,'submitted','none',2,{next_action:'w'.repeat(500)}),recorded_at:T(2),actor_uid:'u_owner'}))})));
 r.db.set('/privateJobs/v1/u_owner',{owner_uid:'u_owner',payload:JSON.stringify(s)});
 const big=await r.send(r.cmd('event.append',ev(r.id,'submitted','none',2,{next_action:'z'.repeat(500)})));assert.equal(big.status,413);assert.equal(big.body.error,'workspace_full');
});
test('error bodies carry codes, ids and indices only — never stored text',async()=>{
 const secret='SYNTHETIC_PRIVATE_NOTE_SENTINEL';const r=rig();
 const a=await r.ok(r.cmd('record.create',{...listing,role:secret,next_action:secret}));const id=a.body.receipt.id;
 await r.ok(r.cmd('event.append',ev(id,'submitted','none',2,{next_action:secret})));await r.ok(r.cmd('event.append',ev(id,'interview','none',4,{next_action:secret})));
 const probes=[r.cmd('record.create',{...listing,role:secret}),r.cmd('event.correct',{id,target:0,action:'replace',replacement:status('submitted','none',6,{next_action:secret}),note:secret}),
  r.cmd('event.append',ev(id,'submitted','none',1,{reason_kind:'inferred',reason:secret})),r.cmd('record.correct',{id,changes:{role:secret},note:secret})];
 for(const p of probes){const res=await r.send(p);assert.notEqual(res.status,200);assert.ok(!res.text.includes(secret),res.text);}
});
test('history core is deterministic and agrees with the stored log',()=>{
 const {core}=rig(),at=d=>T(d),plain=x=>JSON.parse(JSON.stringify(x)); // values cross the VM realm boundary
 const rec={next_action:'n',blocker:'',resume_version:'v',events:[
  {...status('submitted','none',3),recorded_at:at(3)},{...status('interview','none',5),recorded_at:at(5)},
  {kind:'correction',target:0,action:'replace',replacement:status('submitted','none',2),note:'n',recorded_at:at(6)},
  {kind:'correction',target:1,action:'void',note:'n',recorded_at:at(7)},{kind:'archive',note:'',recorded_at:at(8)}]};
 const h=core.history(rec);assert.deepEqual(plain(h.timeline.map(e=>[e.at,e.occurred_at,e.corrected_by])),[[0,at(2),2]]);
 assert.deepEqual(plain(h.archived),{at:4,recorded_at:at(8)});assert.deepEqual(plain([...h.superseded]),[[0,{by:2,action:'replace'}],[1,{by:3,action:'void'}]]);
 assert.equal(core.current({next_action:'n',events:[]}).stage,'opportunity');
 assert.equal(core.conflict([{stage:'submitted',outcome:'none',at:0},{stage:'approved',outcome:'blocked_not_submitted',at:1}]).kind,'stage_regression');
 assert.equal(core.conflict([{stage:'submitted',outcome:'none',at:0},{stage:'submitted',outcome:'none',at:1}]),null);
 for(const [stage,outcomes] of Object.entries(core.OUTCOMES_BY_STAGE))for(const o of core.OUTCOMES)assert.equal(outcomes.includes(o),valid(stage,o),stage+'/'+o);
 function valid(stage,outcome){if(['rejected','position_closed','no_current_match','withdrawn','accepted'].includes(outcome))return stage==='closed';if(stage==='closed')return false;if(outcome==='blocked_not_submitted')return ['opportunity','screened','approved','prepared'].includes(stage);if(outcome==='no_later_decision')return ['submitted','interview'].includes(stage);return true;}
});
// Review findings, 2026-10-20: each case below was reproduced against the previous rule.
test('a downgraded or voided submission cannot be re-upgraded by correction; exact restore can',async()=>{
 const r=await withRecord();await r.ok(r.cmd('event.append',ev(r.id,'submitted','none',2)));
 const original=r.row(r.id).events[0];
 await r.ok(r.cmd('event.correct',{id:r.id,target:0,action:'replace',replacement:status('approved','blocked_not_submitted',2,{blocker:'Portal error'}),note:'It never went through'}));
 for(const [stage,day,evidence] of [['offer',9,'https://example.com/other-evidence'],['interview',3,'https://example.com/x'],['submitted',2,'https://example.com/receipt/new']]){
  const res=await r.send(r.cmd('event.correct',{id:r.id,target:0,action:'replace',replacement:status(stage,'none',day,{evidence_url:evidence}),note:'re-upgrade'}));
  assert.equal(res.body.error,'correction_cannot_create_submission',stage);}
 assert.equal(r.core.current(r.row(r.id)).stage,'approved');
 await r.ok(r.cmd('event.correct',{id:r.id,target:0,action:'replace',replacement:r.core.pick(original,r.core.STATUS_FIELDS),note:'The original entry was right'}));
 assert.equal(r.core.current(r.row(r.id)).stage,'submitted');
 // voided submission + later blocked update: replacing the voided entry with a new interview is refused
 const v=await withRecord();await v.ok(v.cmd('event.append',ev(v.id,'submitted','none',2)));
 await v.ok(v.cmd('event.correct',{id:v.id,target:0,action:'void',replacement:null,note:'Wrong employer'}));
 await v.ok(v.cmd('event.append',ev(v.id,'approved','blocked_not_submitted',3,{blocker:'Missing transcript'})));
 assert.equal((await v.send(v.cmd('event.correct',{id:v.id,target:0,action:'replace',replacement:status('interview','none',5),note:'x'}))).body.error,'correction_cannot_create_submission');
 assert.equal(v.core.current(v.row(v.id)).outcome,'blocked_not_submitted');
});
test('URL fields and request keys must be strings; arrays and padded or invisible-character URLs are refused',async()=>{
 const r=await withRecord(),writes=r.writes.length;
 for(const url of [['https://example.com/a'],['https://example.com/'+'a'.repeat(20000)],' https://example.com/a','https://example.com/a\n','\thttps://example.com/a','https://exam\tple.com/a','https://example.com/a​','https://example.com/‮a'])
  assert.equal((await r.send(r.cmd('record.create',{...listing,requisition:'U-'+r.writes.length+Math.random(),url}))).body.error,'https_url_required',JSON.stringify(url).slice(0,60));
 assert.equal((await r.send(r.cmd('event.append',ev(r.id,'submitted','none',2,{evidence_url:['https://example.com/r']})))).body.error,'https_url_required');
 const keyed=r.cmd('event.append',ev(r.id,'submitted','none',2));keyed.request_id=['synthetic_array_key_000001'];
 assert.equal((await r.send(keyed)).body.error,'invalid_revision_or_request');assert.equal(r.writes.length,writes);
});
test('invisible format characters cannot split a requisition identity; bidi controls are refused in text',async()=>{
 const r=await withRecord();
 for(const req of ['TEST​-001','TEST-­001','﻿TEST-001','TEST-001⁠'])assert.equal((await r.send(r.cmd('record.create',{...listing,requisition:req}))).body.error,'duplicate_requisition',JSON.stringify(req));
 for(const text of ['Analyst ‮gnirih','A⁦b','Del\u007f'])assert.equal((await r.send(r.cmd('record.create',{...listing,requisition:'B-'+text.length,role:text}))).body.error,'invalid_text',JSON.stringify(text));
});
