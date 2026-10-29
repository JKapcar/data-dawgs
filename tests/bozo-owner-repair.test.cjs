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
    entryVerification:{receipt:'old'},entryCapture:{ok:true,price:-175,opp:150,line:4,provider:'synthetic'},providerEventIds:{synthetic:'old'}};
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
    playerName:k=>k,
    bozoLabelWithPeriod:(l,p)=>p==='game'?l:l+' ('+p+')',bozoPeriodOf:p=>p.period||'game',
    selectionKeyOf:p=>[p.eventId,p.mkt,p.side,p.line].join('|'),marketKeyOf:p=>[p.eventId,p.mkt,p.line].join('|'),
    bozoCaptureEntry:()=>{throw new Error('Provider capture is forbidden in owner ruling');},
    fbGet:async(e,path)=>({data:copy(path.endsWith('/ledger')?state.ledger:state),etag:String(rev)}),
    fbPatch:async(e,path,patch)=>{const root=path.endsWith('/ledger')?state.ledger:state;for(const [p,v] of Object.entries(patch)){const parts=p.split('/');let n=root;for(const k of parts.slice(0,-1))n=n[k]||={};if(v===null)delete n[parts.at(-1)];else n[parts.at(-1)]=copy(v);}rev++;},
    fbPut:async(e,path,next,etag)=>{
      assert.equal(path,'/bozo/leagues/main');assert.ok(etag);
      if(failure===true)throw new Error('failed');if(race){const fn=race;race=null;await fn();}
      if(etag!==String(rev))return false;state=copy(next);rev++;writes++;if(failure==='after')throw new Error('lost response');return true;
    },
  };
  vm.createContext(ctx);
  vm.runInContext(cut('function ledgerEntries(', 'async function ledgerWriteEntries('),ctx);
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
  for(const k of ['order','closeTs','settings','funding','royale','members','status'])assert.deepEqual(after[k],before[k],k);
  assert.deepEqual(after.ledger['2026-w7-u_member'],before.ledger['2026-w7-u_member']);
  assert.deepEqual(after.picks.u_other,before.picks.u_other);assert.deepEqual(after.audit.original,before.audit.original);assert.deepEqual(after.admin.actions.old,before.admin.actions.old);
  assert.equal(after.results,undefined);assert.deepEqual(receipt.before,before.picks.u_member);assert.deepEqual(receipt.after,pick);
  assert.deepEqual(receipt.beforeLedger,before.ledger['2026-w8-u_member']);
  assert.deepEqual(after.ledgerEntryHistory['2026-w8-u_member'].original,receipt.beforeLedger);
  assert.deepEqual(receipt.afterLedger,after.ledger['2026-w8-u_member']);assert.equal(receipt.afterLedger.stake,50);
  assert.equal(receipt.afterLedger.price,-202);assert.equal(receipt.afterLedger.priceOpp,null);assert.equal(receipt.afterLedger.entryRevision,p.body.confirm_code);
  assert.equal(pick.line,-3.5);assert.equal(pick.price,-202);assert.equal(pick.label,'AAA +3.5');
  for(const k of ['eventId','game','side','mkt','sport','period','startsAt','who'])assert.equal(pick[k],before.picks.u_member[k],k);
  assert.equal(pick.ts,mode==='preserve'?before.picks.u_member.ts:NOW+1000);assert.equal(pick.ownerRuling.confirmedAt,NOW+1000);assert.equal(receipt.ts,NOW+1000);
  assert.equal(pick.ownerRuling.enteredAt,NOW);assert.equal(pick.ownerRuling.observedAt,new Date(NOW-10000).toISOString());
  assert.equal(pick.priceSource,'owner_ruling');assert.equal(pick.verificationStatus,'unverified');assert.equal(pick.clvEligible,false);
  for(const k of ['entryPriceOpp','priceOpp','entryProvider','entrySnapshotAt','fairEntry','entryHold','canonicalKey'])assert.equal(pick[k],null,k);
  assert.equal(pick.entryVerification,undefined);assert.equal(pick.entryCapture,undefined);assert.deepEqual(pick.providerEventIds,{});
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
test('moneyline fails preview rather than creating a Worst Beat settlement dead end',async()=>{
  const r=rig();r.change(s=>{s.picks.u_member.mkt='ml';s.picks.u_member.line=0;});const out=await r.propose({line:0});assert.equal(out.status,409);assert.match(out.body.error,/Worst Beat settlement/);assert.equal(r.writes(),0);
  const t=rig();t.change(s=>{s.picks.u_member.mkt='total';s.picks.u_member.side='over';s.picks.u_member.period='h1';});const p=await t.propose({line:24.5});assert.equal(p.body.after.label,'over 24.5 (h1)');
});
test('UI is a separate manual flow with server capability, durable audit and reload recovery',()=>{
  const page=fs.readFileSync('bozo.html','utf8');assert.match(page,/id="ownerRepairCard" hidden data-ddb-skip/);
  assert.match(page,/wGet\('\/bozo\/owner-repair'\)/);assert.match(page,/sessionStorage\.setItem\('bozo-owner-repair:'/);
  assert.match(page,/r\.type==='owner_pick_ruling'/);assert.match(page,/Original ledger archived; current projection follows ruling/);
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
test('repair → real close mutation → grade commit → CLV uses one revised entry, with immutable original history',async()=>{
  const r=rig('standard'),ctx=r.ctx,rowKey='2026-w8-u_member';
  r.change(s=>{s.ledger[rowKey]={...ctx.ledgerEntries('main',2026,8,s.picks,s.order)[rowKey],stake:50,slipKey:'original-slip',actualWagerId:'synthetic-ticket',funded:20};});
  const original=r.state(),p=await r.propose();assert.equal((await r.confirm(p.body.confirm_code)).status,200);
  const repaired=r.state(),immutable=copy(repaired.ledgerEntryHistory);
  Object.assign(ctx,{BOZO_CLOSE_BOOK:'draftkings',DEFAULT_LEAGUE:'main',
    loadLeague:async()=>r.state(),memberNames:s=>Object.values(s.members).map(m=>m.name),ticketPricing:()=>({}),
    worstBeatRuleFor:()=> 'legacy-v1',bozoIsManualLeg:()=>false,rSd:()=>13.5,bozoBeatBasis:()=> 'sd'});
  vm.runInContext(cut('function bozoCloseMutation(', '// BEGIN BOZO CAPTURE RECEIPTS')+
    cut('async function ledgerBackfill(', '/* ========================= Bozo closing-price capture')+
    cut('async function bozoCommitGrade(', '/* ===================== the manager\'s override')+
    cut('function bozoEstimateSettledRow(', 'function bozoEstimateBasis(')+
    cut('async function bozoClv(', '/* ---------------- the parlay price,'),ctx);
  const target={season:2026,week:8,key:'u_member',uid:'u_member',player:'Synthetic Member',pick:repaired.picks.u_member};
  const patch=ctx.bozoCloseMutation(target,{price:-210,opp:175,provider:'synthetic',snapshotAt:new Date(NOW+1000).toISOString()},null,new Date(NOW+1000).toISOString());
  assert.equal(await ctx.bozoGuardedPatch(r.env,'main',original,patch),false,'stale original pick cannot attach close');
  assert.equal(await ctx.bozoGuardedPatch(r.env,'main',repaired,patch),true);
  const closed=r.state();assert.equal(closed.ledger[rowKey].price,-202);assert.equal(closed.ledger[rowKey].line,-3.5);assert.equal(closed.ledger[rowKey].close,-210);
  const results={u_member:{...closed.results.u_member,result:'lost',won:false,actual:-7}};
  const graded=await ctx.bozoCommitGrade(r.env,'main',closed,{results,graded:true},'placed');assert.equal(graded.conflict,undefined);
  const after=r.state(),row=after.ledger[rowKey];assert.equal(row.result,'lost');assert.equal(row.actual,-7);assert.ok(row.gradedAt);
  assert.equal(row.entryRevision,p.body.confirm_code);assert.equal(row.entryCapture,null);assert.equal(row.clvEligible,false);
  for(const key of ['stake','slipKey','actualWagerId','funded'])assert.equal(row[key],original.ledger[rowKey][key]);
  assert.deepEqual(after.ledgerEntryHistory,immutable);assert.deepEqual(after.ledgerEntryHistory[rowKey].original,original.ledger[rowKey]);
  const response=await ctx.bozoClv({},new URL('https://fixture/bozo/clv?league=main'),r.env,{});
  const leg=response.body.legs.find(l=>l.player==='Synthetic Member');
  assert.equal(leg.entryPrice,-202);assert.equal(leg.line,-3.5);assert.equal(leg.closePrice,-210);assert.equal(leg.result,'loss');assert.equal(leg.actual,-7);
  assert.equal(leg.entryPriceOpp,null);assert.equal(leg.entryCapture,null);assert.equal(leg.verificationStatus,'unverified');assert.equal(leg.clvEligible,false);assert.equal(leg.entryRevision,p.body.confirm_code);
  const effective=require('../bozo-effective-clv.js');assert.equal(effective.resolve(copy(leg)).kind,'unknown');
  r.change(s=>{s.week=9;s.picks={};s.results={};});
  const historical=(await ctx.bozoClv({},new URL('https://fixture/bozo/clv?league=main'),r.env,{})).body.legs.find(l=>l.player==='Synthetic Member');
  assert.equal(historical.entryPrice,-202);assert.equal(historical.entryPriceOpp,null);assert.equal(historical.result,'loss');assert.equal(effective.resolve(copy(historical)).kind,'unknown');
  assert.deepEqual(r.state().ledgerEntryHistory,immutable);
});
test('old proposal protocol cannot authorize changed ledger consequences',async()=>{
  const r=rig(),p=await r.propose(),key='bozo-owner-repair:'+owner.uid+':main:u_member';
  const pending=JSON.parse(await r.env.RL.get(key));delete pending.protocolVersion;await r.env.RL.put(key,JSON.stringify(pending));
  assert.equal((await r.confirm(p.body.confirm_code)).status,409);assert.equal(r.writes(),0);
});
test('archived original cannot be overwritten, and repeated repairs retain each ledger revision',async()=>{
  const bad=rig();bad.change(s=>s.ledgerEntryHistory={'2026-w8-u_member':{original:{different:true}}});
  const p=await bad.propose(),before=bad.state();assert.equal((await bad.confirm(p.body.confirm_code)).status,409);assert.deepEqual(bad.state(),before);
  const r=rig(),a=await r.propose();await r.confirm(a.body.confirm_code);const first=r.state();
  const b=await r.propose({line:4.5});await r.confirm(b.body.confirm_code);const next=r.state();
  assert.deepEqual(next.ledgerEntryHistory['2026-w8-u_member'].original,first.ledgerEntryHistory['2026-w8-u_member'].original);
  assert.deepEqual(next.ledgerEntryHistory['2026-w8-u_member'][a.body.confirm_code],first.ledger['2026-w8-u_member']);
  assert.equal(next.ledger['2026-w8-u_member'].supersedesEntryRevision,a.body.confirm_code);
});
