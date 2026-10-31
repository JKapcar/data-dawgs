const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const worker = fs.readFileSync('dawg-bot-worker.js', 'utf8');
const block = fs.readFileSync('work/mcp-block.js', 'utf8');
const cut = (a,b) => worker.slice(worker.indexOf(a), worker.indexOf(b,worker.indexOf(a)));
const clone = x => JSON.parse(JSON.stringify(x));
const NOW = Date.parse('2026-10-16T12:00:00Z');
const mgr = { uid: 'u_mgr', name: 'Manager', user: { roles: {} } };
const pick = { sport:'nfl',eventId:'new',game:'A @ B',mkt:'ml',side:'B',line:0,label:'B ML',startsAt:new Date(NOW+3600000).toISOString() };
function rig(format='standard') {
  let now=NOW, revision=1, writes=0, captures=0, fail=false, race=null, scheduleHook=null, auth=mgr, quote={};
  const old={...pick,eventId:'old',side:'A',label:'A ML',price:-150,entryPriceOpp:130,ts:NOW-60000,who:'Member',submittedBy:'u_member',submissionId:'old'};
  let state={managerUid:'u_mgr',name:'Fixture',season:2026,week:6,status:'placed',order:[2,0,3,1],closeTs:NOW-30000,
    settings:{format,allowEdit:false},members:{u_mgr:{name:'Manager'},u_member:{name:'Member'},u_other:{name:'Other'}},
    picks:{u_member:old,u_other:{...old,eventId:'other',who:'Other',ts:NOW-30000}},
    ledger:{'2026-w6-u_member':{player:'Member',price:-150,ts:old.ts},'2026-w6-u_other':{unchanged:'other receipt'},'2026-w5-u_member':{unchanged:'prior week'}},
    royale:{history:{5:{chopped:'someone'}}},audit:{original:{type:'fixture'}}};
  const kv=new Map();
  const env={RL:{get:async k=>kv.get(k)||null,put:async(k,v)=>kv.set(k,v)}};
  class Clock extends Date { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} }
  const ctx={Date:Clock,crypto:webcrypto,console,SEASON:2026,TextEncoder,Uint8Array,
    json:(body,status,headers)=>({body,status,headers}),readBody:async r=>r.body,sessionAuth:async()=>auth,
    validLeagueId:s=>/^[a-z0-9-]+$/.test(s),LG:lid=>'/bozo/leagues/'+lid,
    sha256hex:async s=>createHash('sha256').update(s).digest('hex'),
    memberStatusAt:(s,k)=>s.members[k]?.status||'active',memberNameAt:(s,k)=>s.members[k]?.name,
    settingsOf:s=>s.settings,royaleAliveKey:(s,k)=>s.royale?.dead!==k,
    bandOf:()=>({floor:-500,ceil:-100}),validatePick:()=>null,
    bozoWeekGate:async()=>{if(scheduleHook)await scheduleHook();return {docs:{nfl:{}}};},
    bozoScheduleFindGame:(doc,p)=>doc?{startsAt:p.startsAt,completed:false}:null,
    bozoCaptureEntry:async(e,p)=>{captures++;return {ok:true,p:{...p,price:-180,priceOpp:155,priceSource:'captured',entrySnapshotAt:new Date(now).toISOString(),clvEligible:true,...quote}};},
    bozoLabelWithPeriod:x=>x,bozoPeriodOf:p=>p.period||'game',selectionKeyOf:p=>p.eventId+'|'+p.side,marketKeyOf:p=>p.eventId,
    playerName:k=>k,
    fbGet:async()=>({data:clone(state),etag:String(revision)}),
    fbPut:async(e,p,next,etag)=>{assert.equal(p,'/bozo/leagues/main');assert.ok(etag,'every write conditional');
      if(fail===true)throw new Error('audit/backend unavailable');if(race){const fn=race;race=null;await fn();}
      if(etag!==String(revision))return false;state=clone(next);revision++;writes++;if(fail==="after")throw new Error("response lost after commit");return true;},
  };
  vm.createContext(ctx);
  vm.runInContext(cut('function isOwnerPrincipal(','function isSiteAdmin(')+'\n'+cut('/* ================= manager pre-kickoff correction','/* =============================== /bozo/pick')+'\n'+
    cut('function buildBozoLeg(','async function bozoPick(')+'\n'+cut('const ledgerKey =','async function ledgerWriteEntries(')
      .split('async function ledgerWriteEntries(')[0]+'\nthis.api={bozoCorrectPickCore,bozoCorrectPick,bozoGuardedPatch,BOZO_CORRECTION_SCHEMA};',ctx);
  const at=block.indexOf('    name: "dd_correct_bozo_pick"');
  const tool=block.slice(block.lastIndexOf('  {',at),block.indexOf('\n  },',at)+5).trim().replace(/,$/,'');
  ctx.toolText=x=>x;ctx.toolErr=error=>({error});vm.runInContext('this.mcp=('+tool+');',ctx);
  const proposal={league:'main',forUid:'u_member',type:'replace_before_kickoff',reason:'Correct wrong side',pick};
  return {api:ctx.api,env,ctx,proposal,state:()=>clone(state),writes:()=>writes,captures:()=>captures,
    change:fn=>{fn(state);revision++;},tick:ms=>now+=ms,fail:(mode=true)=>fail=mode,race:fn=>race=fn,
    schedule:fn=>scheduleHook=fn,quote:q=>quote=q,expire:()=>kv.clear(),
    propose:(over={},who=mgr)=>ctx.api.bozoCorrectPickCore(env,who,{...proposal,...over}),
    confirm:(code,who=mgr)=>ctx.api.bozoCorrectPickCore(env,who,{league:'main',forUid:'u_member',type:'replace_before_kickoff',confirm:code}),
    post:(body,who=mgr)=>{auth=who;return ctx.api.bozoCorrectPick({method:'POST',body},env,{});},
    mcp:args=>ctx.mcp.run(args,env,{...mgr,kind:'user'}),
  };
}
for(const format of ['standard','royale']) test(format+': atomic replacement preserves draw, lock, others, prior weeks and original receipts',async()=>{
  const r=rig(format),before=r.state(),p=await r.propose();assert.equal(p.status,200,JSON.stringify(p));assert.equal(r.writes(),0);
  r.tick(1000);const out=await r.confirm(p.body.confirm_code);assert.equal(out.status,200,JSON.stringify(out));assert.equal(r.writes(),1);
  const after=r.state(),id=p.body.confirm_code,row=after.audit[id];
  assert.deepEqual(after.order,before.order);assert.equal(after.closeTs,before.closeTs);assert.equal(after.status,'placed');
  assert.deepEqual(after.picks.u_other,before.picks.u_other);assert.deepEqual(after.ledger['2026-w6-u_other'],before.ledger['2026-w6-u_other']);
  assert.deepEqual(after.ledger['2026-w5-u_member'],before.ledger['2026-w5-u_member']);assert.deepEqual(after.royale,before.royale);
  assert.deepEqual(row.before,before.picks.u_member);assert.deepEqual(row.beforeLedger,before.ledger['2026-w6-u_member']);
  assert.equal(row.reason,'Correct wrong side');assert.equal(row.actor,'u_mgr');assert.equal(row.forUid,'u_member');
  assert.equal(row.after.submittedBy,'u_mgr');assert.equal(row.after.who,'Member');assert.equal(row.after.ts,NOW+1000);
  assert.equal(row.after.closeState,'pending');assert.equal(row.after.price,-180);assert.equal(after.results,undefined);
  assert.equal(row.afterLedger.secToClose,-31);assert.equal(row.afterLedger.memberKey,'u_member');assert.equal(row.afterLedger.rank,2);
  r.expire();assert.deepEqual(clone(await r.confirm(id)),clone(out));assert.equal(r.writes(),1,'durable replay survives KV expiry');
  assert.equal(r.captures(),1,'confirmation approves exact captured proposal, without repricing');
});
for(const who of [{err:'signed out'}, {uid:'u_other',name:'Other'}, {uid:'intruder',name:'Manager'}, {name:'Manager'}])
  test('denies unauthorized identity '+JSON.stringify(who),async()=>{const r=rig();assert.ok((await r.propose({},who)).status>=400);assert.equal(r.writes(),0);assert.equal(r.captures(),0);});
for(const [label,mutate] of [
  ['started original',s=>s.picks.u_member.startsAt=new Date(NOW).toISOString()],
  ['another member started',s=>s.picks.u_other.startsAt=new Date(NOW-1).toISOString()],
  ['unknown kickoff',s=>delete s.picks.u_other.startsAt],
  ['scored',s=>s.results={u_other:{won:false}}],
  ['captured close',s=>s.results={u_member:{close:-180,closeOpp:150}}],
  ['graded',s=>s.status='graded'],['grading fence',s=>s.gradeStartedWeek=6],
  ['missing original ledger',s=>delete s.ledger['2026-w6-u_member']],
  ['ledger grading',s=>s.ledger['2026-w6-u_member'].actual=7],
  ['resolved Royale week',s=>s.royale.chops={6:{chopped:'u_other'}}],['eliminated',s=>s.royale.dead='u_member'],['pending seat',s=>s.members.u_member.status='pending'],
]) test('rejects '+label,async()=>{const r=rig('royale');r.change(mutate);const out=await r.propose();assert.equal(out.status,409,JSON.stringify(out));assert.equal(r.writes(),0);});
test('stale proposal crossing kickoff is rejected, including during async confirmation work',async()=>{
  for(const late of [false,true]){const r=rig();r.change(s=>{for(const p of Object.values(s.picks))p.startsAt=new Date(NOW+1000).toISOString();});
    const p=await r.propose({pick:{...pick,startsAt:new Date(NOW+1000).toISOString()}});assert.equal(p.status,200);
    if(late)r.schedule(()=>r.tick(1001));else r.tick(1001);
    assert.equal((await r.confirm(p.body.confirm_code)).status,409);assert.equal(r.writes(),0);}
});
test('quote must be fresh, captured and two-sided; input provenance cannot supply a usable fallback',async()=>{
  for(const q of [{priceSource:'self'},{priceOpp:null},{clvEligible:false},{entrySnapshotAt:new Date(NOW-300001).toISOString()}]){
    const r=rig();r.quote(q);assert.equal((await r.propose()).status,409);assert.equal(r.writes(),0);}
});
test('schedule changes at confirmation fail closed',async()=>{const r=rig();const p=await r.propose();r.ctx.bozoScheduleFindGame=()=>({startsAt:new Date(NOW-1).toISOString()});assert.equal((await r.confirm(p.body.confirm_code)).status,409);assert.equal(r.writes(),0);});
test('stale league version, expired proposal, permission revocation and changed target are rejected',async()=>{
  for(const mutate of [r=>r.change(s=>s.picks.u_other.label='Changed'),r=>r.change(s=>s.week++),r=>r.tick(300001),r=>r.change(s=>s.managerUid='u_new')]){
    const r=rig(),p=await r.propose();mutate(r);assert.ok((await r.confirm(p.body.confirm_code)).status>=400);assert.equal(r.writes(),0);}
});
test('audit/backend failure leaves pick, ledger and history completely unchanged',async()=>{const r=rig(),before=r.state(),p=await r.propose();r.fail();assert.equal((await r.confirm(p.body.confirm_code)).status,502);assert.deepEqual(r.state(),before);assert.equal(r.writes(),0);});
test('concurrent league mutation fails CAS without losing another write',async()=>{const r=rig(),p=await r.propose();r.race(()=>r.change(s=>s.name='New name'));assert.equal((await r.confirm(p.body.confirm_code)).status,409);assert.equal(r.state().name,'New name');assert.equal(r.state().picks.u_member.submissionId,'old');assert.equal(r.writes(),0);});
test('simultaneous duplicate confirmation writes exactly once',async()=>{const r=rig(),p=await r.propose();const out=await Promise.all([r.confirm(p.body.confirm_code),r.confirm(p.body.confirm_code)]);assert.equal(out[0].status,200);assert.deepEqual(clone(out[0]),clone(out[1]));assert.equal(r.writes(),1);});
test('HTTP and MCP use the same protocol and server actor',async()=>{for(const surface of ['http','mcp']){const r=rig();const p=surface==='http'?(await r.post(r.proposal)).body:await r.mcp(r.proposal);const req={league:'main',forUid:'u_member',type:'replace_before_kickoff',confirm:p.confirm_code};const out=surface==='http'?(await r.post(req)).body:await r.mcp(req);assert.equal(out.status,'corrected',JSON.stringify({surface,p,out}));assert.equal(r.state().picks.u_member.via,surface==='http'?'site':'mcp');}});
test('request schema rejects unsupported correction types, supplied actor and changed confirmation payload',async()=>{for(const extra of [{type:'retroactive'},{actor:'u_mgr'},{forUid:'Member'},{confirm:'bad',pick:undefined,reason:undefined}]){const r=rig();assert.ok((await r.propose(extra)).status>=400);assert.equal(r.writes(),0);}});
test('guarded background writes reject old pick snapshots and CAS races',async()=>{const r=rig(),old=r.state(),p=await r.propose();await r.confirm(p.body.confirm_code);assert.equal(await r.api.bozoGuardedPatch(r.env,'main',old,{'results/u_member/close':-300}),false);assert.equal(r.state().results,undefined);
  const fresh=r.state();r.race(()=>r.change(s=>s.picks.u_member.label='Later'));assert.equal(await r.api.bozoGuardedPatch(r.env,'main',fresh,{'results/u_member/close':-300}),false);assert.equal(r.state().results,undefined);});
test('placed removal cannot bypass the lock by supplying confirm',()=>{assert.match(worker,/body.confirm === undefined \|\| body.action === "remove"/);});
test('UI exposes correction reason and uses the shared two-phase route; MCP schema is shared',()=>{const page=fs.readFileSync('bozo.html','utf8');assert.match(page,/id="correctionFields"[^>]*data-ddb-skip/);assert.match(page,/route = correcting \? '\/bozo\/correct-pick'/);assert.match(page,/confirm:proposal.confirm_code, \.\.\.correctionTarget/);assert.match(block,/inputSchema: BOZO_CORRECTION_SCHEMA/);});

test('lost commit response recovers the atomic receipt without a second write',async()=>{const r=rig(),p=await r.propose();r.fail('after');assert.equal((await r.confirm(p.body.confirm_code)).status,502);assert.equal(r.writes(),1);assert.equal((await r.confirm(p.body.confirm_code)).status,200);assert.equal(r.writes(),1);});
 test('a second correction preserves both generations and replay cannot restore an older pick',async()=>{const r=rig(),a=await r.propose();await r.confirm(a.body.confirm_code);r.tick(1);const b=await r.propose({reason:'Second correction'});assert.equal(b.status,200);await r.confirm(b.body.confirm_code);const latest=r.state();assert.deepEqual(latest.audit[b.body.confirm_code].before,latest.audit[a.body.confirm_code].after);await r.confirm(a.body.confirm_code);assert.deepEqual(r.state(),latest);});
