// Research project envelope (WO-01). Synthetic records only: every uid, title and id here is
// invented. Mirrors tests/dawg-pound.test.cjs: the Worker blocks run in a vm with mock storage.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const source=fs.readFileSync('work/dawg-pound.js','utf8')+'\n'+fs.readFileSync('work/research-project.js','utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const mockToken=user=>user+'.'+'x'.repeat(43);
const OWNER='u_owner',PATH='/researchProjects/v1/synthetic/bdb-test';
function rig(){
  const db=new Map(),reads=[],writes=[];let revision=0,revoke=false,race=false;
  const env={RESEARCH_PROJECTS_ENABLED:'true',RESEARCH_OWNER_UID:OWNER,RESEARCH_UPLOAD_TENANT:'synthetic'};
  const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Request,Response,Headers,URL,Date,
    ORIGINS:['https://datadawgs216.com'],
    readSession:async(e,t)=>['u_owner','u_other'].some(u=>mockToken(u)===t)?{u:t.split('.')[0]}:null,
    sessionAuth:async r=>revoke?{err:'revoked'}:{uid:r.headers.get('X-Dawg-Session').split('.')[0]},
    fbGet:async(e,p)=>{reads.push(p);return {data:db.has(p)?clone(db.get(p)):null,etag:String(revision)};},
    fbPut:async(e,p,v,etag)=>{if(race){race=false;revision++;}if(etag!==String(revision))return false;db.set(p,clone(v));revision++;writes.push(p);return true;}
  };vm.createContext(context);
  vm.runInContext(source+'\nthis.api={handleProject,projectApply,projectEmpty,projectView,projectRead,projectTally,PROJECT_SCHEMA,PROJECT_LIMITS,poundCanonical};',context);
  const send=async(body,options={})=>{
    const user=options.user===undefined?OWNER:options.user;
    const headers={...(user?{Authorization:'Bearer '+mockToken(user)}:{}),...options.headers};
    if(body!==undefined)headers['Content-Type']='application/json';
    const req=new Request('https://worker.test'+(options.path||'/api/project/v1/bdb-test'),{method:options.method||(body===undefined?'GET':'POST'),headers,...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
    const res=await context.api.handleProject(req,env);return {status:res.status,headers:res.headers,body:res.status===204?null:await res.json()};
  };
  const state=()=>JSON.parse(db.get(PATH).payload);
  let n=0;const command=(op,data,rev=db.has(PATH)?state().revision:0)=>({op,data,expected_revision:rev,request_id:'request_'+String(++n).padStart(16,'0')});
  return {send,command,state,env,db,reads,writes,api:context.api,revoke:()=>revoke=true,race:()=>race=true};
}
const charter={title:'Synthetic study',question:'Does a synthetic signal hold?',audience:'Test readers',success_criteria:['One measurable synthetic criterion'],scope:{in:['synthetic'],out:['real data']},status:'active',target_date:'2027-01-08'};
const decisionBody={title:'Pick a synthetic option',options:[{id:'a',text:'Option A'},{id:'b',text:'Option B'}],proposal_text:'Adopt option A for the synthetic study.'};
const deckFixture=(control={kind:'choice'})=>({version:1,stage:'ready_for_decision',why_now:'Synthetic study needs an explicit choice.',deadline:'No fixed deadline',consequence:'Only this synthetic test changes.',lesson:'An invented lesson for tests, not a research claim.',recommendation:'Compare both options.',counterargument:'More evidence could change the choice.',uncertainty:'Synthetic inputs only.',dependent_work:[],researched_at:'2026-01-01T00:00:00Z',valid_until:'2099-01-01T00:00:00Z',sources:[{title:'Synthetic source',url:'https://example.com/research',checked_at:'2026-01-01T00:00:00Z',claim:'Fixture only.'}],authorization:{intent_only:false,approval_url:''},control});
const deckBody=control=>({...decisionBody,options:decisionBody.options.map(o=>({...o,consequences:'Synthetic tradeoff.'})),deck:deckFixture(control)});
async function seeded(){
  const r=rig();assert.equal((await r.send(r.command('project.save',charter,0))).status,200);
  const m=await r.send(r.command('milestone.save',{title:'Synthetic milestone',due_planned:'2026-12-01'}));
  const d=await r.send(r.command('decision.save',decisionBody));
  const q=await r.send(r.command('question.save',{text:'Synthetic question?',priority:'normal'}));
  const role=await r.send(r.command('role.propose',{role_name:'coordinator',principal:'synthetic-agent',responsibilities:['keep records complete']}));
  const deck=await r.send(r.command('decision.save',deckBody()));assert.equal(deck.status,200,JSON.stringify(deck.body));
  return {r,deck:deck.body.receipt.item_id,milestone:m.body.receipt.item_id,decision:d.body.receipt.item_id,question:q.body.receipt.item_id,role:role.body.receipt.item_id};
}
// One valid payload per v1 op, against the seeded project above.
function samples(s){const st=s.r.state(),dv=st.decisions[0].proposal_version;return {
  'project.save':{...charter,expected_record_revision:st.project.revision},
  'project.health':{value:'at_risk',note:'synthetic'},
  'milestone.save':{title:'Second synthetic milestone',due_planned:'2026-12-15'},
  'check.set':{milestone_id:s.milestone,text:'Synthetic check',verifier:'owner',evidence_required:'receipt',status:'unchecked'},
  'question.save':{text:'Another synthetic question?',priority:'low'},
  'question.answer':{id:s.question,expected_record_revision:1,text:'Synthetic answer'},
  'decision.save':{...decisionBody,title:'Second synthetic decision'},
  'decision.respond':{id:s.deck,expected_record_revision:1,proposal_version:st.decisions.find(d=>d.id===s.deck).proposal_version,disposition:'answer',answer:{choice:'a'},rationale:'Synthetic informed choice'},
  'decision.resolve':{id:s.decision,expected_record_revision:1,proposal_version:dv,status:'accepted',option_id:'a',rationale:'Synthetic rationale'},
  'vote.cast':{decision_id:s.decision,proposal_version:dv,value:1},
  'role.propose':{role_name:'critic',principal:'synthetic-critic',responsibilities:['review']},
  'role.accept':{id:s.role,expected_record_revision:1,status:'accepted',verification_ref:'synthetic-proof-row'},
  'policy.save':{action:'check.set',trigger_check:[],required_evidence:'receipt',credential:'synthetic',max_per_day:5,status:'draft'},
};}

// ---- J.1 1: every v1 op has a schema test ----
test('J.1-1 every v1 op: valid payload commits; unknown field and missing required field are 400 without a write',async()=>{
  const ops=Object.keys(samples(await seeded()));
  assert.deepEqual(ops.sort(),clone(rig().api.PROJECT_SCHEMA.write.inputSchema.oneOf.map(s=>s.properties.op.const)).sort());
  for(const op of ops){
    const s=await seeded(),data=samples(s)[op],before=s.r.writes.length;
    assert.equal((await s.r.send(s.r.command(op,{...data,owner_uid:'u_other'}))).status,400,op+' unknown field');
    const required=s.r.api.PROJECT_SCHEMA.write.inputSchema.oneOf.find(x=>x.properties.op.const===op).properties.data.required;
    for(const k of required){const {[k]:_,...rest}=data;const out=await s.r.send(s.r.command(op,rest));assert.equal(out.status,400,op+' missing '+k);assert.match(out.body.error,/required_missing/);}
    assert.equal(s.r.writes.length,before,op+' rejected payloads never reach storage');
    const ok=await s.r.send(s.r.command(op,data));assert.equal(ok.status,200,op+' '+JSON.stringify(ok.body));
  }
});
test('J.1-1 envelope: unknown op, unknown envelope field, bad request id and bad dates are 400',async()=>{
  const {r}=await seeded(),before=r.writes.length;
  for(const bad of [{...r.command('task.save',{}),op:'task.save'},{...r.command('question.save',{text:'Q',priority:'low'}),owner:'u_other'},{...r.command('question.save',{text:'Q',priority:'low'}),request_id:'short'},r.command('milestone.save',{title:'M',due_planned:'Dec 1'}),r.command('question.save',{text:'Q',priority:'someday'}),r.command('vote.cast',{decision_id:'r_x',proposal_version:'0'.repeat(64),value:2})])
    assert.equal((await r.send(bad)).status,400,JSON.stringify(bad));
  assert.equal(r.writes.length,before);
});
test('J.1-1 limits: collection caps are 409, oversized bodies and envelopes are 413',async()=>{
  const {r}=await seeded(),st=r.state();
  for(let i=st.milestones.length;i<r.api.PROJECT_LIMITS.milestones;i++)st.milestones.push({id:'r_'+webcrypto.randomUUID(),type:'milestone',title:'filler',due_planned:'2026-12-01',depends_on:[],revision:1});
  r.db.get(PATH).payload=JSON.stringify(st);
  const capped=await r.send(r.command('milestone.save',{title:'One too many',due_planned:'2026-12-01'}));assert.equal(capped.status,409);assert.equal(capped.body.error,'limit_reached:milestones');
  const big=await r.send(r.command('question.save',{text:'x'.repeat(900),priority:'low',context_ref:'y'.repeat(40000)}));assert.equal(big.status,413);
  const long=await r.send(r.command('question.save',{text:'x'.repeat(1001),priority:'low'}));assert.equal(long.status,400);
  const full=r.state();full.audit=[{pad:'z'.repeat(2100000)}];r.db.get(PATH).payload=JSON.stringify(full);
  const over=await r.send(r.command('question.save',{text:'Synthetic?',priority:'low'}));assert.equal(over.status,413);assert.equal(over.body.error,'project_capacity');
});

// ---- J.1 2: CAS ----
test('J.1-2 two writers on the same expected_revision: exactly one commits, the other 409s, a retry with a new id succeeds',async()=>{
  const {r}=await seeded(),rev=r.state().revision;
  const a=r.command('question.save',{text:'Writer A',priority:'low'},rev),b=r.command('question.save',{text:'Writer B',priority:'low'},rev);
  assert.equal((await r.send(a)).status,200);
  const lost=await r.send(b);assert.equal(lost.status,409);assert.equal(lost.body.error,'revision_conflict');
  const retry={...b,request_id:b.request_id+'_r2',expected_revision:r.state().revision};assert.equal((await r.send(retry)).status,200);
  assert.deepEqual(r.state().questions.map(q=>q.text).slice(-2),['Writer A','Writer B']);
  // Storage-level race: the etag moved between read and commit.
  r.race();const raced=await r.send(r.command('question.save',{text:'Raced',priority:'low'}));assert.equal(raced.status,409);assert.ok(!r.state().questions.some(q=>q.text==='Raced'));
});
test('J.1-2 record revisions guard updates to the same record',async()=>{
  const s=await seeded(),r=s.r;
  const stale=await r.send(r.command('milestone.save',{id:s.milestone,expected_record_revision:7,title:'Renamed',due_planned:'2026-12-01'}));assert.equal(stale.status,409);assert.equal(stale.body.error,'record_revision_conflict');
  assert.equal((await r.send(r.command('milestone.save',{id:s.milestone,expected_record_revision:1,title:'Renamed',due_planned:'2026-12-01'}))).status,200);
  assert.equal((await r.send(r.command('milestone.save',{expected_record_revision:1,title:'New',due_planned:'2026-12-01'}))).status,400);
});

// ---- J.1 3: idempotency ----
test('J.1-3 identical resend replays without a second record; a reused id with a different payload is 409',async()=>{
  const {r}=await seeded(),cmd=r.command('question.save',{text:'Once only',priority:'high'});
  const first=await r.send(cmd);assert.equal(first.body.replayed,false);
  const again=await r.send(cmd);assert.equal(again.status,200);assert.equal(again.body.replayed,true);assert.deepEqual(again.body.receipt,first.body.receipt);
  assert.equal(r.state().questions.filter(q=>q.text==='Once only').length,1);
  const conflict=await r.send({...cmd,data:{...cmd.data,text:'Changed'}});assert.equal(conflict.status,409);assert.equal(conflict.body.error,'idempotency_conflict');
});

// ---- J.1 6: votes ----
test('J.1-6 votes: -1 needs a rationale; a changed vote supersedes; a revised proposal starts a new tally; AI votes never bind',async()=>{
  const s=await seeded(),r=s.r,api=r.api,v1=r.state().decisions[0].proposal_version;
  const noWhy=await r.send(r.command('vote.cast',{decision_id:s.decision,proposal_version:v1,value:-1}));assert.equal(noWhy.status,400);assert.equal(noWhy.body.error,'rationale_required');
  const first=await r.send(r.command('vote.cast',{decision_id:s.decision,proposal_version:v1,value:-1,rationale:'Synthetic concern'}));assert.equal(first.status,200);
  const same=await r.send(r.command('vote.cast',{decision_id:s.decision,proposal_version:v1,value:-1,rationale:'Synthetic concern'}));assert.equal(same.body.unchanged,true);assert.equal(r.state().votes.length,1);
  const changed=await r.send(r.command('vote.cast',{decision_id:s.decision,proposal_version:v1,value:1}));assert.equal(changed.status,200);
  let votes=r.state().votes;assert.equal(votes.length,2);assert.equal(votes[0].superseded,true);assert.equal(votes[0].superseded_by,votes[1].id);assert.equal(votes[1].supersedes_vote_id,votes[0].id);assert.equal(votes[1].binding,true);
  // An AI (owner-connector) vote on the same version is advisory, never binding.
  const st=r.state(),cmd=r.command('vote.cast',{decision_id:s.decision,proposal_version:v1,value:-1,rationale:'Model concern'});
  const out=await api.projectApply(st,cmd,{uid:OWNER,actor_kind:'owner_connector',credential_label:'Claude',author_label:'Claude'});assert.equal(out.replayed,false);
  const ai=st.votes.at(-1);assert.equal(ai.binding,false);assert.equal(ai.actor.credential_label,'Claude');assert.equal(ai.actor.author_label_trust,'unverified');
  const tally=api.projectTally(st,st.decisions[0]);assert.deepEqual(clone(tally.binding),{'+1':1});assert.deepEqual(clone(tally.advisory_ai),{'-1':1});assert.deepEqual(clone(tally.missing),[]);
  r.db.get(PATH).payload=JSON.stringify(st);
  // Revising the proposal changes proposal_version: a fresh tally, old votes kept under v1.
  const rev=await r.send(r.command('decision.save',{...decisionBody,id:s.decision,expected_record_revision:1,proposal_text:'Adopt option B instead.'}));assert.equal(rev.status,200);
  const d=r.state().decisions[0];assert.notEqual(d.proposal_version,v1);assert.equal(d.proposal_history.length,2);
  const read=(await r.send()).body.project.decisions[0];assert.equal(read.tally.proposal_version,d.proposal_version);assert.deepEqual(read.tally.binding,{});assert.deepEqual(read.tally.missing,['owner']);
  assert.deepEqual(clone(api.projectTally(r.state(),d,v1).binding),{'+1':1});
  const stale=await r.send(r.command('vote.cast',{decision_id:s.decision,proposal_version:v1,value:1}));assert.equal(stale.status,409);assert.equal(stale.body.error,'proposal_changed');
  // Only the owner resolves, on the version shown, naming an option.
  const wrong=await r.send(r.command('decision.resolve',{id:s.decision,expected_record_revision:2,proposal_version:v1,status:'accepted',option_id:'a',rationale:'R'}));assert.equal(wrong.status,409);
  const ok=await r.send(r.command('decision.resolve',{id:s.decision,expected_record_revision:2,proposal_version:d.proposal_version,status:'accepted',option_id:'b',rationale:'Synthetic rationale'}));assert.equal(ok.status,200);
  assert.equal(r.state().decisions[0].outcome.proposal_version,d.proposal_version);
  assert.equal((await r.send(r.command('vote.cast',{decision_id:s.decision,proposal_version:d.proposal_version,value:1}))).status,409);
});

// ---- J.1 9: policy gate stub ----
test('J.1-9 an automation write naming no, a disabled, a mismatched or an unevaluable policy is 403',async()=>{
  const s=await seeded(),r=s.r,api=r.api,auto={uid:OWNER,actor_kind:'automation',credential_label:'dot'};
  await r.send(r.command('policy.save',{action:'question.save',trigger_check:[],required_evidence:'',credential:'dot',max_per_day:1,status:'disabled'}));
  await r.send(r.command('policy.save',{action:'question.save',trigger_check:['task_queued_1h'],required_evidence:'',credential:'dot',max_per_day:1,status:'enabled'}));
  await r.send(r.command('policy.save',{action:'question.save',trigger_check:[],required_evidence:'',credential:'dot',max_per_day:1,status:'enabled'}));
  const [disabled,unevaluable,open]=r.state().policies.map(p=>p.id);
  const attempt=async(policy_id,op='question.save',data={text:'Automated question',priority:'low'})=>{const st=r.state();const cmd={...r.command(op,data,st.revision),...(policy_id?{policy_id}:{})};try{await api.projectApply(st,cmd,auto);return st;}catch(e){return e;}};
  for(const [pid,code] of [[undefined,'policy_required'],[disabled,'policy_not_enabled'],[unevaluable,'policy_trigger_failed'],['r_00000000-0000-4000-8000-000000000000','policy_not_enabled']]){const e=await attempt(pid);assert.equal(e.projectStatus,403,code);assert.equal(e.message,code);}
  const mismatch=await attempt(open,'role.propose',{role_name:'x',principal:'y',responsibilities:[]});assert.equal(mismatch.message,'policy_action_mismatch');
  const allowed=await attempt(open);assert.equal(allowed.questions.at(-1).policy_id,open);assert.equal(allowed.questions.at(-1).actor.actor_kind,'automation');
  // Only automation may name a policy, and automation never performs a binding action.
  const ownerWithPolicy=await r.send({...r.command('question.save',{text:'Q',priority:'low'}),policy_id:open});assert.equal(ownerWithPolicy.status,400);
  await r.send(r.command('policy.save',{action:'project.health',trigger_check:[],required_evidence:'',credential:'dot',max_per_day:1,status:'enabled'}));
  const health=await attempt(r.state().policies.at(-1).id,'project.health',{value:'off_track'});assert.equal(health.message,'owner_only:project.health');
});

// ---- J.4 20: provenance stamp ----
test('J.4-20 every stored record carries actor uid, kind, credential label and request id; no principal, no storage',async()=>{
  const s=await seeded(),r=s.r,st=r.state();
  for(const rows of [[st.project],st.milestones,st.decisions,st.questions,st.roles])for(const rec of rows){assert.match(rec.actor.uid,/^u_/);assert.equal(rec.actor.actor_kind,'owner');assert.equal(rec.actor.credential_label,null);assert.match(rec.request_id,/^request_/);assert.match(rec.id,/^r_/);assert.equal(rec.project_id,'bdb-test');}
  const api=r.api,cmd=()=>r.command('question.save',{text:'Q',priority:'low'},st.revision);
  for(const p of [null,{},{uid:'u_owner'},{uid:'nobody',actor_kind:'owner'},{uid:OWNER,actor_kind:'owner_connector'},{uid:OWNER,actor_kind:'owner_connector',credential_label:''},{uid:OWNER,actor_kind:'owner_connector',credential_label:'has space'},{uid:OWNER,actor_kind:'owner',credential_label:'primary'},{uid:OWNER,actor_kind:'root'}])
    await assert.rejects(api.projectApply(clone(st),cmd(),p),e=>e.projectStatus===401,JSON.stringify(p));
  const conn=clone(st);await api.projectApply(conn,cmd(),{uid:OWNER,actor_kind:'owner_connector',credential_label:'primary',author_label:'Gemini'});
  const q=conn.questions.at(-1);assert.deepEqual(clone(q.actor),{uid:OWNER,actor_kind:'owner_connector',credential_label:'primary',author_label:'Gemini',author_label_trust:'unverified'});
  const hostile=await r.send(r.command('question.save',{text:'Q',priority:'low',actor:{uid:'u_other'}}));assert.equal(hostile.status,400);
});
test('J.4-22 read-back: the returned record_sha256 is the hash of the canonical stored record',async()=>{
  const {r}=await seeded(),out=await r.send(r.command('question.save',{text:'Hash me',priority:'urgent'}));
  const rec=r.state().questions.find(q=>q.id===out.body.receipt.item_id);
  assert.equal(out.body.receipt.record_sha256,createHash('sha256').update(r.api.poundCanonical(rec)).digest('hex'));
  assert.equal(out.body.receipt.revision,r.state().revision);assert.equal(r.state().audit.at(-1).record_sha256,out.body.receipt.record_sha256);
});

// ---- binding actions and record rules ----
test('connector proposals: binding ops 403, checks limited to evidence states, accepted milestones locked',async()=>{
  const s=await seeded(),r=s.r,api=r.api,conn={uid:OWNER,actor_kind:'owner_connector',credential_label:'primary'};
  const data=samples(s);
  for(const op of ['project.save','project.health','question.answer','decision.resolve','decision.respond','role.accept','policy.save']){const st=r.state();await assert.rejects(api.projectApply(st,r.command(op,data[op],st.revision),conn),e=>e.projectStatus===403&&e.message==='owner_only:'+op,op);}
  let st=r.state();await assert.rejects(api.projectApply(st,r.command('check.set',{...data['check.set'],status:'passed',evidence_refs:['receipt:x']},st.revision),conn),/verifier_required/);
  st=r.state();await assert.rejects(api.projectApply(st,r.command('check.set',{...data['check.set'],status:'evidence_attached'},st.revision),conn),/evidence_required/);
  st=r.state();await api.projectApply(st,r.command('check.set',{...data['check.set'],status:'evidence_attached',evidence_refs:['receipt:synthetic']},st.revision),conn);
  const check=st.checks[0];assert.equal(check.checked_by,null);
  await assert.rejects(api.projectApply(st,r.command('check.set',{...data['check.set'],id:check.id,expected_record_revision:1,verifier:'coordinator',status:'unchecked'},st.revision),conn),/owner_only:check_definition/);
  // The owner-accepted milestone cannot be edited by a connector; its own proposal can.
  await assert.rejects(api.projectApply(st,r.command('milestone.save',{id:s.milestone,expected_record_revision:1,title:'Moved',due_planned:'2027-01-01'},st.revision),conn),/owner_only:accepted_milestone/);
  await api.projectApply(st,r.command('milestone.save',{title:'Proposed',due_planned:'2027-01-01'},st.revision),conn);assert.equal(st.milestones.at(-1).accepted,false);
});
test('owner check decisions: passed needs evidence, waived needs a reason, progress counts passed/total with waived and failed apart',async()=>{
  const s=await seeded(),r=s.r,base={milestone_id:s.milestone,text:'C',verifier:'owner',evidence_required:'receipt'};
  assert.equal((await r.send(r.command('check.set',{...base,status:'passed'}))).status,400);
  assert.equal((await r.send(r.command('check.set',{...base,status:'waived'}))).status,400);
  for(const extra of [{status:'passed',evidence_refs:['receipt:a']},{status:'passed',evidence_refs:['receipt:b']},{status:'waived',waiver_reason:'Out of scope'},{status:'failed'}])assert.equal((await r.send(r.command('check.set',{...base,...extra}))).status,200);
  const m=(await r.send()).body.project.milestones[0];assert.equal(m.progress.label,'2 / 4 · waived 1 · failed 1');assert.equal(r.state().checks[0].checked_by.actor_kind,'owner');
});
test('milestone dependency cycles and missing dependencies are rejected',async()=>{
  const s=await seeded(),r=s.r;
  const b=(await r.send(r.command('milestone.save',{title:'B',due_planned:'2026-12-10',depends_on:[s.milestone]}))).body.receipt.item_id;
  const cyc=await r.send(r.command('milestone.save',{id:s.milestone,expected_record_revision:1,title:'A',due_planned:'2026-12-01',depends_on:[b]}));assert.equal(cyc.status,400);assert.equal(cyc.body.error,'milestone_dependency_cycle');
  assert.equal((await r.send(r.command('milestone.save',{title:'C',due_planned:'2026-12-10',depends_on:['r_00000000-0000-4000-8000-000000000000']}))).status,404);
});
test('only records exist after the charter; scope_version moves only when scope does',async()=>{
  const r=rig();const early=await r.send(r.command('question.save',{text:'Q',priority:'low'},0));assert.equal(early.status,409);assert.equal(early.body.error,'project_not_created');
  await r.send(r.command('project.save',charter,0));assert.equal(r.state().project.scope_version,1);
  await r.send(r.command('project.save',{...charter,title:'Renamed',expected_record_revision:1}));assert.equal(r.state().project.scope_version,1);
  await r.send(r.command('project.save',{...charter,scope:{in:['synthetic','more'],out:[]},expected_record_revision:2}));assert.equal(r.state().project.scope_version,2);
  assert.equal(r.state().project.decision_authority,'owner');
});

// ---- J.5 26: transport ----
test('J.5-26 private no-store; query parameters, legacy headers, foreign origins and non-owner sessions refused before storage',async()=>{
  const r=rig(),ok=await r.send();assert.equal(ok.status,200);assert.match(ok.headers.get('cache-control'),/private, no-store/);assert.equal(ok.body.exists,false);assert.equal(ok.body.project.receipts,undefined);
  const before=r.reads.length;
  for(const [opts,status] of [[{path:'/api/project/v1/bdb-test?owner=u_other'},400],[{headers:{'X-Dawg-Session':mockToken(OWNER)}},401],[{headers:{'X-Dawg-Pass':'x'}},401],[{user:''},401],[{headers:{Authorization:'Bearer invented'}},401],[{headers:{Origin:'https://evil.test'}},403],[{user:'u_other'},403],[{path:'/api/project/v1/..%2Fother'},404],[{path:'/api/project/v1/Bad_Id'},404],[{path:'/api/project/v1'},404],[{path:'/api/project/v1/bdb-test/extra'},404],[{method:'DELETE'},405]]){
    const out=await r.send(undefined,opts);assert.equal(out.status,status,JSON.stringify(opts));assert.match(out.headers.get('cache-control'),/no-store/);}
  assert.equal(r.reads.length,before);
  const pre=await r.send(undefined,{method:'OPTIONS',headers:{Origin:'https://datadawgs216.com'}});assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),'https://datadawgs216.com');
});
test('default off: no flag, no storage I/O; unconfigured tenant fails closed',async()=>{
  const r=rig();delete r.env.RESEARCH_PROJECTS_ENABLED;const off=await r.send();assert.equal(off.status,503);assert.equal(off.body.error,'projects_disabled');
  r.env.RESEARCH_PROJECTS_ENABLED='false';assert.equal((await r.send(r.command('project.save',charter,0))).status,503);assert.equal(r.reads.length,0);
  r.env.RESEARCH_PROJECTS_ENABLED='true';r.env.RESEARCH_UPLOAD_TENANT='bad tenant';assert.equal((await r.send()).status,503);assert.equal(r.reads.length,0);
});
test('J.5-27 a record stored under another tenant or owner is refused; session revocation before commit stops the write',async()=>{
  const {r}=await seeded(),rec=r.db.get(PATH);
  r.db.set(PATH,{...rec,tenant:'other'});assert.equal((await r.send()).status,403);
  r.db.set(PATH,{...rec,owner_uid:'u_other'});assert.equal((await r.send()).status,403);
  r.db.set(PATH,rec);const writes=r.writes.length;r.revoke();
  assert.equal((await r.send(r.command('question.save',{text:'Q',priority:'low'}))).status,401);assert.equal(r.writes.length,writes);
});
test('section reads page lists and the summary reports capacity against the 1 MiB target',async()=>{
  const {r}=await seeded(),st=r.state(),api=r.api;
  const sum=api.projectRead(st,{});assert.equal(sum.section,'summary');assert.equal(sum.counts.milestones,1);assert.equal(sum.capacity.target,1048576);assert.equal(sum.capacity.over_target,false);
  const audit=api.projectRead(st,{section:'audit',offset:0,limit:2});assert.equal(audit.total,6);assert.equal(audit.items.length,2);assert.equal(audit.items[0].op,'decision.save');
  for(const bad of [{section:'secrets'},{limit:0},{limit:201},{offset:-1}])assert.throws(()=>api.projectRead(st,bad),e=>e.projectStatus===400);
});
test('project.health uses on_track / at_risk / off_track; the old colour names are rejected',async()=>{
  const {r}=await seeded(),props=r.api.PROJECT_SCHEMA.write.inputSchema.oneOf.find(s=>s.properties.op.const==='project.health').properties.data.properties;
  assert.deepEqual(clone(props.value.enum),['on_track','at_risk','off_track']);
  for(const old of ['green','amber','red']){const out=await r.send(r.command('project.health',{value:old}));assert.equal(out.status,400,old);assert.equal(out.body.error,'invalid_value:value');}
  for(const value of ['on_track','at_risk','off_track'])assert.equal((await r.send(r.command('project.health',{value}))).status,200,value);
  assert.equal(r.state().project.health.value,'off_track');assert.equal(r.state().project.health.set_by.actor_kind,'owner');
});


test('decision deck: five answer contracts reject invalid values and stamp intent-only owner responses',async()=>{
 const cases=[
  [{kind:'choice'},{choice:'a'},{choice:'missing'}],
  [{kind:'scale',min:10,max:20,step:2,unit:'trials'},{number:14},{number:13}],
  [{kind:'rank'},{order:['b','a']},{order:['a','a']}],
  [{kind:'budget',unit:'hours',total:10},{allocations:[{id:'a',amount:3},{id:'b',amount:7}]},{allocations:[{id:'a',amount:3},{id:'b',amount:8}]}],
  [{kind:'buckets',buckets:[{id:'now',label:'Now'},{id:'later',label:'Later'}]},{assignments:[{id:'a',bucket:'now'},{id:'b',bucket:'later'}]},{assignments:[{id:'a',bucket:'missing'},{id:'b',bucket:'later'}]}]
 ];
 for(const [control,answer,bad] of cases){const {r}=await seeded(),body=deckBody(control);body.deck.authorization={intent_only:true,approval_url:'https://example.com/approval'};
  const created=await r.send(r.command('decision.save',body));assert.equal(created.status,200,JSON.stringify(created.body));const row=r.state().decisions.at(-1);
  const payload={id:row.id,expected_record_revision:row.revision,proposal_version:row.proposal_version,disposition:'answer',answer,rationale:'Synthetic rationale'};
  assert.equal((await r.send(r.command('decision.respond',{...payload,answer:bad}))).status,400);
  const command=r.command('decision.respond',payload),result=await r.send(command);assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal((await r.send(command)).body.replayed,true);const stored=r.state().decisions.at(-1);assert.equal(stored.responses.length,1);assert.deepEqual(stored.responses[0].answer,answer);assert.equal(stored.responses[0].by.uid,OWNER);assert.equal(stored.responses[0].intent_only,true);assert.equal(stored.responses[0].execution,'not_executed');
  assert.equal((await r.send()).body.project.decisions.at(-1).deck_status,'answered');
 }
});
test('decision deck: complete research, valid control and source dates required; legacy proposals remain valid',async()=>{
 const {r}=await seeded();
 for(const mutate of [d=>d.sources=[],d=>d.sources[0].url='javascript:alert(1)',d=>d.valid_until='not-a-date',d=>d.sources[0].checked_at='2099-01-01T00:00:00Z',d=>d.control={kind:'forecast'},d=>d.control={kind:'scale',min:10,max:5,step:1,unit:'hours'},d=>d.authorization={intent_only:true,approval_url:''}]){const b=deckBody();mutate(b.deck);assert.equal((await r.send(r.command('decision.save',b))).status,400);}
 assert.equal((await r.send(r.command('decision.save',decisionBody))).status,200);
});
test('decision deck: deferred, research-needed and stale states; old proposal and racing writes cannot answer',async()=>{
 const {r,deck}=await seeded();let row=r.state().decisions.find(d=>d.id===deck);
 const payload=()=>({id:deck,expected_record_revision:row.revision,proposal_version:row.proposal_version,disposition:'defer',answer:{},rationale:'Need time.'});
 assert.equal((await r.send(r.command('decision.respond',payload()))).status,200);assert.equal((await r.send()).body.project.decisions.find(d=>d.id===deck).deck_status,'deferred');
 row=r.state().decisions.find(d=>d.id===deck);assert.equal((await r.send(r.command('decision.respond',{...payload(),disposition:'need_information'}))).status,200);assert.equal((await r.send()).body.project.decisions.find(d=>d.id===deck).deck_status,'needs_research');
 row=r.state().decisions.find(d=>d.id===deck);const old=row.proposal_version;
 const changed=deckBody();changed.deck.lesson='Updated lesson changes the proposal hash.';assert.equal((await r.send(r.command('decision.save',{...changed,id:deck,expected_record_revision:row.revision}))).status,200);
 row=r.state().decisions.find(d=>d.id===deck);assert.notEqual(row.proposal_version,old);assert.equal((await r.send()).body.project.decisions.find(d=>d.id===deck).deck_status,'stale');
 assert.equal((await r.send(r.command('decision.respond',{...payload(),proposal_version:old}))).status,409);
 r.race();assert.equal((await r.send(r.command('decision.respond',payload()))).status,409);
 const stale=deckBody();stale.deck.valid_until='2026-01-02T00:00:00Z';stale.deck.stage='needs_research';assert.equal((await r.send(r.command('decision.save',stale))).status,200);const late=r.state().decisions.at(-1);
 assert.equal((await r.send(r.command('decision.respond',{id:late.id,expected_record_revision:late.revision,proposal_version:late.proposal_version,disposition:'answer',answer:{choice:'a'},rationale:'Cannot answer stale.'}))).status,409);
});
