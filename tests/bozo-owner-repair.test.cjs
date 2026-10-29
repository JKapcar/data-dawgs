const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const worker=fs.readFileSync('dawg-bot-worker.js','utf8');
const cut=(a,b)=>worker.slice(worker.indexOf(a),worker.indexOf(b,worker.indexOf(a)));
const copy=x=>JSON.parse(JSON.stringify(x));
const NOW=Date.parse('2026-10-29T12:00:00Z');
const owner={uid:'u_y9Pgnfml5AlhtotzlailibDR',name:'Synthetic Owner',user:{roles:{site_admin:true}}};
function rig(format='royale'){
  let now=NOW,rev=1,writes=0,failure=false,race=null,scheduleHook=null,auth=owner;
  const old={sport:'nfl',eventId:'synthetic-event',game:'AAA @ BBB',mkt:'spread',side:'AAA',line:4,price:-175,label:'AAA -4',period:'game',
    startsAt:new Date(NOW+86400000).toISOString(),ts:NOW-60000,who:'Synthetic Member',submissionId:'original',submittedBy:'u_member',
    priceSource:'captured',verificationStatus:'verified',entryPriceOpp:150,priceOpp:150,entryOppSource:'captured',clvEligible:true,
    entryProvider:'synthetic',entrySnapshotAt:new Date(NOW-60000).toISOString(),fairEntry:0.6,entryHold:0.04,canonicalKey:'old',
    entryVerification:{receipt:'old'},providerEventIds:{synthetic:'old'}};
  let state={status:'placed',season:2026,week:8,order:[2,0,3,1],closeTs:NOW-30000,settings:{format,stake:50,allowEdit:false},
    members:{u_member:{name:'Synthetic Member'},u_other:{name:'Synthetic Other'}},picks:{u_member:old,u_other:{...old,side:'CCC',submissionId:'other'}},
    ledger:{'2026-w8-u_member':{price:-175,ts:old.ts,stake:50},'2026-w7-u_member':{original:'prior'}},
    funding:{paid:20},royale:{history:{7:{chopped:'synthetic-prior'}}},audit:{original:{retained:true}},admin:{actions:{old:{retained:true}}}};
  const kv=new Map();
  const env={RL:{get:async k=>kv.get(k)||null,put:async(k,v)=>kv.set(k,v)}};
  class Clock extends Date {constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
  const ctx={Date:Clock,crypto:webcrypto,console,SEASON:2026,
    validLeagueId:s=>/^[a-z0-9-]+$/.test(s),LG:id=>'/bozo/leagues/'+id,
    json:(body,status,headers)=>({body,status,headers}),readBody:async r=>r.body,sessionAuth:async()=>auth,
    sha256hex:async s=>createHash('sha256').update(s).digest('hex'),
    memberStatusAt:(s,k)=>s.members[k]?.status||'active',memberNameAt:(s,k)=>s.members[k]?.name,
    settingsOf:s=>s.settings,royaleAliveKey:(s,k)=>s.royale.dead!==k,
    bozoWeekGate:async()=>{if(scheduleHook)await scheduleHook();return {docs:{nfl:{}}};},
    bozoScheduleFindGame:(doc,p)=>doc?{startsAt:p.startsAt}:null,
    ledgerKey:(s,w,k)=>`${s}-w${w}-${k}`,
    bozoLabelWithPeriod:(l,p)=>p==='game'?l:l+' ('+p+')',bozoPeriodOf:p=>p.period||'game',
    selectionKeyOf:p=>[p.eventId,p.mkt,p.side,p.line].join('|'),marketKeyOf:p=>[p.eventId,p.mkt,p.line].join('|'),
    bozoCaptureEntry:()=>{throw new Error('Provider capture is forbidden in owner ruling');},
    fbGet:async(e,path)=>({data:copy(state),etag:String(rev)}),
    fbPut:async(e,path,next,etag)=>{
      assert.equal(path,'/bozo/leagues/main');assert.ok(etag);
      if(failure===true)throw new Error('failed');if(race){const fn=race;race=null;await fn();}
      if(etag!==String(rev))return false;state=copy(next);rev++;writes++;if(failure==='after')throw new Error('lost response');return true;
    },
  };
  vm.createContext(ctx);
  vm.runInContext(cut('/* ================= owner ruling:','/* =============================== /bozo/pick')+'\nthis.api={bozoOwnerRepairCore,bozoOwnerRepair,bozoGuardedPatch};',ctx);
  const proposal={league:'main',forUid:'u_member',line:3.5,price:-202,timestampMode:'confirm_time',reason:'Synthetic entry mistake',evidenceReference:'Synthetic owner decision',observedAt:null};
  return {ctx,env,proposal,state:()=>copy(state),writes:()=>writes,change:fn=>{fn(state);rev++;},tick:n=>now+=n,expire:()=>kv.clear(),
    fail:v=>failure=v,race:fn=>race=fn,schedule:fn=>scheduleHook=fn,
    propose:(extra={},who=owner)=>ctx.api.bozoOwnerRepairCore(env,who,{...proposal,...extra}),
    confirm:(id,extra={},who=owner)=>ctx.api.bozoOwnerRepairCore(env,who,{league:'main',forUid:'u_member',confirm:id,...extra}),
    http:(method,body,who=owner)=>{auth=who;return ctx.api.bozoOwnerRepair({method,body},env,{});}};
}
for(const format of ['standard','royale'])for(const mode of ['preserve','confirm_time'])test(`${format} ${mode}: isolated atomic ruling and original receipts retained`,async()=>{
  const r=rig(format),before=r.state(),p=await r.propose({timestampMode:mode,observedAt:new Date(NOW-10000).toISOString()});
  assert.equal(p.status,200,JSON.stringify(p));assert.equal(r.writes(),0);assert.match(p.body.echo,/OWNER RULING/);
  r.tick(1000);const out=await r.confirm(p.body.confirm_code);assert.equal(out.status,200,JSON.stringify(out));assert.equal(r.writes(),1);
  const after=r.state(),pick=after.picks.u_member,receipt=after.audit[p.body.confirm_code];
  for(const k of ['ledger','order','closeTs','settings','funding','royale','members','status'])assert.deepEqual(after[k],before[k],k);
  assert.deepEqual(after.picks.u_other,before.picks.u_other);assert.deepEqual(after.audit.original,before.audit.original);assert.deepEqual(after.admin.actions.old,before.admin.actions.old);
  assert.equal(after.results,undefined);assert.deepEqual(receipt.before,before.picks.u_member);assert.deepEqual(receipt.after,pick);
  assert.deepEqual(receipt.beforeLedger,receipt.afterLedger);assert.equal(pick.line,-3.5);assert.equal(pick.price,-202);assert.equal(pick.label,'AAA +3.5');
  for(const k of ['eventId','game','side','mkt','sport','period','startsAt','who'])assert.equal(pick[k],before.picks.u_member[k],k);
  assert.equal(pick.ts,mode==='preserve'?before.picks.u_member.ts:NOW+1000);assert.equal(pick.ownerRuling.confirmedAt,NOW+1000);assert.equal(receipt.ts,NOW+1000);
  assert.equal(pick.ownerRuling.enteredAt,NOW);assert.equal(pick.ownerRuling.observedAt,new Date(NOW-10000).toISOString());
  assert.equal(pick.priceSource,'owner_ruling');assert.equal(pick.verificationStatus,'unverified');assert.equal(pick.clvEligible,false);
  for(const k of ['entryPriceOpp','priceOpp','entryProvider','entrySnapshotAt','fairEntry','entryHold','canonicalKey'])assert.equal(pick[k],null,k);
  assert.equal(pick.entryVerification,undefined);assert.deepEqual(pick.providerEventIds,{});
  r.expire();assert.deepEqual(copy(await r.confirm(p.body.confirm_code)),copy(out));assert.equal(r.writes(),1);
});
for(const who of [null,{err:'signed out'}, {name:'Kap'}, {uid:'u_other',name:'Kap',user:{roles:{site_admin:true}}},
  {uid:owner.uid,name:'Kap'}, {uid:owner.uid,user:{roles:{site_admin:false}}}, {uid:owner.uid,roles:{site_admin:true}}])
  test('reject unauthorized or wrong auth shape '+JSON.stringify(who),async()=>{const r=rig();assert.equal((await r.propose({},who)).status,403);assert.equal(r.writes(),0);});
test('HTTP capability is server authorized, no-store, and uses same two phases',async()=>{
  const r=rig();assert.equal((await r.http('GET',null,{uid:'other'})).status,403);
  assert.equal((await r.http('GET')).body.ownerRepair,true);assert.equal((await r.http('GET')).headers['Cache-Control'],'private, no-store');
  assert.equal((await r.http('DELETE')).status,405);
  const p=await r.http('POST',r.proposal);assert.equal(p.status,200);
  assert.equal((await r.http('POST',{league:'main',forUid:'u_member',confirm:p.body.confirm_code})).body.status,'owner_repaired');
});
for(const extra of [{price:0},{price:-99},{price:-175.5},{line:Infinity},{line:'3.5'},{timestampMode:''},{reason:'no'},{evidenceReference:''},{observedAt:'yesterday'},
  {observedAt:new Date(NOW+1).toISOString()},{actor:owner.uid},{stake:10},{pick:{}},{type:'replace_before_kickoff'},{forUid:'Synthetic Member'}])
  test('invalid or out-of-scope field '+JSON.stringify(extra),async()=>{const r=rig();assert.equal((await r.propose(extra)).status,400);assert.equal(r.writes(),0);});
test('altered confirm payload, target and league cannot reuse proposal or durable receipt',async()=>{
  const r=rig(),p=await r.propose(),id=p.body.confirm_code;
  for(const extra of [{line:9},{timestampMode:'preserve'},{price:-100}])assert.equal((await r.confirm(id,extra)).status,400);
  assert.ok((await r.confirm(id,{league:'other'})).status>=400);assert.ok((await r.confirm(id,{forUid:'u_other'})).status>=400);
  assert.equal(r.writes(),0);assert.equal((await r.confirm(id)).status,200);
  assert.ok((await r.confirm(id,{league:'other'})).status>=400);assert.ok((await r.confirm(id,{forUid:'u_other'})).status>=400);assert.equal(r.writes(),1);
});
for(const [name,mutate] of [
  ['open',s=>s.status='open'],['graded',s=>s.status='graded'],['started',s=>s.picks.u_other.startsAt=new Date(NOW).toISOString()],
  ['unknown kickoff',s=>delete s.picks.u_other.startsAt],['results',s=>s.results={u_other:{won:true}}],['grade fence',s=>s.gradeStartedWeek=8],
  ['elimination',s=>s.royale.chops={8:{chopped:'u_other'}}],['dead member',s=>s.royale.dead='u_member'],
  ['pending seat',s=>s.members.u_member.status='pending'],['ledger close',s=>s.ledger['2026-w8-u_member'].close=-170],
  ['missing ledger',s=>delete s.ledger['2026-w8-u_member']],['prop',s=>s.picks.u_member.mkt='prop']])
  test('gate preserves '+name,async()=>{const r=rig();r.change(mutate);const before=r.state();assert.equal((await r.propose()).status,409);assert.deepEqual(r.state(),before);});
test('stale state, expiration, revoked role and schedule changes fail closed',async()=>{
  for(const change of [r=>r.change(s=>s.name='Changed'),r=>r.tick(300001),r=>{r.ctx.bozoScheduleFindGame=()=>null;}]){
    const r=rig(),p=await r.propose();change(r);assert.equal((await r.confirm(p.body.confirm_code)).status,409);assert.equal(r.writes(),0);
  }
  const r=rig(),p=await r.propose();assert.equal((await r.confirm(p.body.confirm_code,{}, {...owner,user:{roles:{}}})).status,403);assert.equal(r.writes(),0);
});
test('expiration during asynchronous work fails closed',async()=>{const r=rig(),p=await r.propose();r.schedule(()=>r.tick(300001));assert.equal((await r.confirm(p.body.confirm_code)).status,409);assert.equal(r.writes(),0);});
test('failed write rolls back entirely; lost response recovers durable receipt',async()=>{
  for(const mode of [true,'after']){const r=rig(),before=r.state(),p=await r.propose();r.fail(mode);assert.equal((await r.confirm(p.body.confirm_code)).status,502);
    if(mode===true){assert.equal(r.writes(),0);assert.deepEqual(r.state(),before);}else{assert.equal(r.writes(),1);assert.equal((await r.confirm(p.body.confirm_code)).status,200);assert.equal(r.writes(),1);}}
});
test('CAS race retains other mutation; simultaneous confirm writes once',async()=>{
  const r=rig(),p=await r.propose();r.race(()=>r.change(s=>s.funding.paid=30));assert.equal((await r.confirm(p.body.confirm_code)).status,409);assert.equal(r.state().funding.paid,30);assert.equal(r.writes(),0);
  const r2=rig(),p2=await r2.propose();const out=await Promise.all([r2.confirm(p2.body.confirm_code),r2.confirm(p2.body.confirm_code)]);assert.equal(out[0].status,200);assert.deepEqual(copy(out[0]),copy(out[1]));assert.equal(r2.writes(),1);
});
test('later ruling retains history and replay cannot roll back; background old-selection write rejected',async()=>{
  const r=rig(),before=r.state(),p=await r.propose();await r.confirm(p.body.confirm_code);r.tick(1);
  const q=await r.propose({line:4.5,timestampMode:'preserve'});await r.confirm(q.body.confirm_code);const latest=r.state();
  assert.deepEqual(latest.audit[q.body.confirm_code].before,latest.audit[p.body.confirm_code].after);
  await r.confirm(p.body.confirm_code);assert.deepEqual(r.state(),latest);
  assert.equal(await r.ctx.api.bozoGuardedPatch(r.env,'main',before,{'results/u_member/close':-200}),false);
});
test('moneyline cannot change line; total and non-game period label remain truthful',async()=>{
  const r=rig();r.change(s=>{s.picks.u_member.mkt='ml';s.picks.u_member.line=0;});assert.equal((await r.propose()).status,400);
  assert.equal((await r.propose({line:0})).status,200);
  const t=rig();t.change(s=>{s.picks.u_member.mkt='total';s.picks.u_member.side='over';s.picks.u_member.period='h1';});const p=await t.propose({line:24.5});assert.equal(p.body.after.label,'over 24.5 (h1)');
});
test('UI is a separate manual flow with server capability, durable audit and reload recovery',()=>{
  const page=fs.readFileSync('bozo.html','utf8');assert.match(page,/id="ownerRepairCard" hidden data-ddb-skip/);
  assert.match(page,/wGet\('\/bozo\/owner-repair'\)/);assert.match(page,/sessionStorage\.setItem\('bozo-owner-repair:'/);
  assert.match(page,/r\.type==='owner_pick_ruling'/);assert.match(page,/Original ledger retained; automatic no-vig CLV unavailable/);
  assert.match(page,/const route = correcting \? '\/bozo\/correct-pick'/);
  assert.match(worker,/if \(url.pathname === "\/bozo\/owner-repair"\) return bozoOwnerRepair/);
});
test('posted spread signs agree with the real grading sign tripwire',async()=>{
  const ctx={BOZO_SPREAD_PK:/\bPK\b/i,BOZO_SPREAD_RULE:'internal sign convention'};vm.createContext(ctx);
  vm.runInContext(cut('function bozoSpreadSignError(p)', '// The market phrase for a phase-one echo.')+'\nthis.check=bozoSpreadSignError;',ctx);
  for(const line of [-7.5,0,3.5]){
    const r=rig(),p=await r.propose({line});assert.equal(p.status,200);
    assert.equal(ctx.check(p.body.after),null);assert.equal(p.body.after.line,line===0?0:-line);
  }
});
