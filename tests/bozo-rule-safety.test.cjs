const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {build,page,worker}=require('./fixtures/bozo-beat-harness.cjs');
const lift=(s,n)=>s.match(new RegExp(`(?:async )?function ${n}\\([\\s\\S]*?\\n\\}`))[0];
const policy={version:'entry-normal-v2',season:2026,week:6};
const state=(over={})=>({season:2026,week:6,status:'placed',worstBeatPolicy:policy,order:[1,2,0,3],
  picks:{missing:{sport:'nfl',mkt:'ml',price:-400,ts:2},measured:{sport:'nfl',mkt:'ml',price:-120,entryPriceOpp:100,ts:1}},
  results:{missing:{result:'lost',won:false,actual:-40},measured:{result:'lost',won:false,actual:-1}},...over});

test('activation is exact-week only; unversioned and completed historical states stay legacy',()=>{
 const {ui,server}=build(page,worker);
 for(const c of [ui,server]){
  assert.equal(c.worstBeatRuleFor(state()),'entry-normal-v2');
  for(const s of [state({worstBeatPolicy:null}),state({week:7}),state({season:2027}),state({status:'graded'})])
   assert.equal(c.worstBeatRuleFor(s),'legacy-v1');
  assert.equal(c.worstBeatRuleFor(state({worstBeatReceipt:{version:'legacy-v1',season:2026,week:6}})),'legacy-v1','activation cannot override an existing receipt');
  assert.equal(c.worstBeatRuleFor(state({bozoWhy:'already decided'})),'legacy-v1','reopened historical week stays legacy');
  assert.equal(c.worstBeatRuleFor(state({week:7,worstBeatReceipt:{version:'entry-normal-v2',season:2026,week:6}})),'legacy-v1','receipt cannot leak into next week');
  assert.equal(c.worstBeatRuleFor(state({status:'graded',results:{a:{worstBeatRule:'entry-normal-v2'}}})),'entry-normal-v2');
 }
 const p={sport:'cfb',mkt:'ml',price:-218,entryPriceOpp:180};
 ui.S=state({status:'graded'});
 assert.equal(ui.beatOf(p,{actual:-11}),11/16,'legacy page SD and zero-margin rule');
 assert.equal(server.royaleBeatDeficit(p,{actual:-11}).v,11/16.5,'legacy Worker unchanged');
 ui.S=state();assert.ok(ui.beatOf(p,{actual:-11})>1);
});

test('the rule resolver itself is identical in page and Worker',()=>{
 assert.equal(lift(page,'worstBeatRuleFor'),lift(worker,'worstBeatRuleFor'));
});

test('a concurrent policy change prevents the conditional grading write',async()=>{
 const {server}=build(page,worker);vm.runInContext(lift(worker,'bozoGuardedPatch'),server);
 const s=state();let writes=0;
 Object.assign(server,{SEASON:2026,LG:()=>'/test',bozoSame:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
  fbGet:async()=>({data:{...s,worstBeatPolicy:null},etag:'etag'}),fbPut:async()=>{writes++;}});
 assert.equal(await server.bozoGuardedPatch({},'main',s,{bozo:'measured'}),false);assert.equal(writes,0);
});

test('all 40 completed snapshot rows preserve exact baseline page and Worker scores',()=>{
 const golden=require('./fixtures/bozo-legacy-scores.json').rows;
 const current=build(page,worker);let count=0;
 for(const w of require('./fixtures/bozo-main-impact.json').weeks.filter(w=>w.week<6)){
  current.ui.S={...w,status:'graded'};
  for(const [n,p]of Object.entries(w.picks)){
   const expected=golden.find(r=>r.week===w.week&&r.player===n);
   assert.equal(current.ui.beatOf(p,w.results[n]),expected.uiScore,`${w.week}/${n} page`);
   assert.equal(current.server.royaleBeatDeficit(p,w.results[n]).v,expected.workerScore,`${w.week}/${n} Worker`);count++;
  }
 }
 assert.equal(count,40);
});

test('v2 blocks at Worst Beat on missing inputs; legacy and earlier decisive levers keep prior behavior',()=>{
 const {server}=build(page,worker);
 const s=state();
 assert.equal(server.royaleDecideChop(s,s.order).blocked,true);
 const old=server.royaleDecideChop({...s,worstBeatPolicy:null},s.order);
 assert.equal(old.choppedKey,'missing');
 assert.equal(server.royaleDecideChop(s,[0,1]).choppedKey,'missing','an earlier unique lever does not need Worst Beat');
 assert.equal(server.royaleDecideChop({...s,picks:{missing:s.picks.missing}},[1]).choppedKey,'missing','only loser needs no comparison');
 for(const actual of [undefined,null,'','  ']){
  const t=state();t.picks.missing.entryPriceOpp=300;t.results.missing.actual=actual;
  assert.equal(server.royaleDecideChop(t,t.order).blocked,true);
 }
});

test('shared grade commit blocks standard and Royale before any write',async()=>{
 const {server}=build(page,worker);
 vm.runInContext(lift(worker,'bozoCommitGrade'),server);
 let writes=0;
 for(const name of ['fbPut','fbPatch','bozoGuardedPatch','ledgerBackfill'])server[name]=async()=>{writes++;throw Error('unexpected write');};
 for(const format of ['standard','royale']){
  const s=state({format});
  const out=await server.bozoCommitGrade({},'main',s,{graded:true,bozo:'measured',results:s.results},'placed');
  assert.equal(out.blocked,true);assert.match(out.conflict,/unmeasurable/);
 }
 assert.equal(writes,0);
});

test('automatic grade keeps an unmeasurable v2 week ungraded and never commits a verdict',async()=>{
 const {server}=build(page,worker);vm.runInContext(lift(worker,'bozoAutoGradeOne'),server);
 const s=state();let commits=0;
 server.bozoGradeFromScheduleKv=async()=>({results:s.results,pending:[]});
 server.bozoCommitGrade=async()=>{commits++;throw Error('unexpected commit');};
 const out=await server.bozoAutoGradeOne({},'main',s,0);
 assert.equal(out.graded,false);assert.equal(out.blocked,true);assert.equal(commits,0);
});

test('manager preview refuses an unmeasurable v2 verdict without issuing a confirmation',async()=>{
 const {server}=build(page,worker);vm.runInContext(lift(worker,'bozoGrade'),server);
 const s=state();let signed=0;
 Object.assign(server,{readBody:r=>r.json(),leagueOf:()=> 'main',requireManager:async()=>({league:s}),
  bozoGradeFromScheduleKv:async()=>({results:s.results,pending:[]}),bozoGradeConfirmCode:async()=>{signed++;},
  json:(body,status=200)=>({body,status})});
 const out=await server.bozoGrade({method:'POST',json:async()=>({graded:true,bozo:'measured'})},{},{});
 assert.equal(out.status,409);assert.equal(out.body.code,'worst_beat_unmeasurable');assert.equal(signed,0);
});

test('UI refuses the same missing-data grade before confirmGrade',async()=>{
 const {ui}=build(page,worker);vm.runInContext(lift(page,'decide'),ui);
 let writes=0,error='';Object.assign(ui,{S:state(),document:{querySelectorAll:()=>[]},
  LEVERS:[{k:'odds'},{k:'beat'},{k:'last'},{k:'clv'}],gradeErr:e=>{error=e;},
  confirmGrade:async()=>{writes++;},refresh:()=>{}});
 await ui.decide();assert.equal(writes,0);assert.match(error,/No grade was written/);
});

test('future ledger entries preserve period and assumed provenance; CLV forwards absence honestly',async()=>{
 const {server}=build(page,worker);
 for(const n of ['ledgerEntries','bozoClv'])vm.runInContext(lift(worker,n),server);
 Object.assign(server,{ledgerKey:(s,w,n)=>`${s}-${w}-${n}`,validLeagueId:()=>true,loadLeague:async()=>({season:2026,week:6}),
  LG:()=>'/test',settingsOf:()=>({format:'standard'}),memberNames:()=>[],ticketPricing:()=>[],BOZO_CLOSE_BOOK:'draftkings',json:x=>x});
 const pick={sport:'nfl',mkt:'ml',period:'1h',entryOppSource:'assumed',price:-200,entryPriceOpp:170,ts:1};
 const rows=server.ledgerEntries('main',2026,6,{a:pick},[1]);
 assert.equal(rows['2026-6-a'].period,'1h');assert.equal(rows['2026-6-a'].entryOppSource,'assumed');
 const row={...rows['2026-6-a'],worstBeatRule:'entry-normal-v2',result:'lost',actual:-3};
 server.fbGet=async()=>({data:{new:row,old:{...row,period:undefined,entryOppSource:undefined,worstBeatRule:undefined,player:'old'}}});
 const out=await server.bozoClv({},new URL('https://example.test?league=main'),{},{});
 assert.equal(out.legs[0].period,'1h');assert.equal(out.legs[0].entryOppSource,'assumed');
 assert.equal(out.legs[0].worstBeatRule,'entry-normal-v2');
 assert.equal(out.legs[1].period,null);assert.equal(out.legs[1].entryOppSource,null);assert.equal(out.legs[1].worstBeatRule,'legacy-v1');
});

test('historical resampling uses its own version and does not invent missing v2 period or provenance',()=>{
 const {ui}=build(page,worker);vm.runInContext(lift(page,'royalePool')+'\n globalThis.clvDevig=devigP;',ui);
 const row={player:'A',sport:'nfl',mkt:'ml',entryPrice:-200,entryPriceOpp:170,result:'loss',actual:-3,
  period:'1h',entryOppSource:'captured',worstBeatRule:'entry-normal-v2'};
 Object.assign(ui,{S:state(),CLV:{data:{legs:[row]}}});
 assert.equal(ui.royalePool('A')[0].beat,ui.beatOf({sport:'nfl',mkt:'ml',price:-200,entryPriceOpp:170,period:'1h'},{actual:-3}));
 for(const patch of [{period:undefined},{entryOppSource:undefined},{entryOppSource:'assumed'},{actual:null},{actual:''}]){
  ui.CLV.data.legs=[{...row,...patch}];assert.equal(ui.royalePool('A')[0].beat,null);
 }
 ui.CLV.data.legs=[{...row,worstBeatRule:undefined,period:undefined}];
 assert.equal(ui.royalePool('A')[0].beat,3/13.5,'an active v2 week cannot reinterpret an old row');
 ui.CLV.data.legs=[{...row,sport:'cfb',mkt:'spread',line:3,period:'game'}];
 assert.equal(ui.royalePool('A')[0].beat,6/16.5,'v2 CFB resampling retains its versioned SD');
});
