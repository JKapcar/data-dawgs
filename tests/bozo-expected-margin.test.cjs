const test = require('node:test');
const assert = require('node:assert/strict');
const { page, worker, ui, server } = require('./fixtures/bozo-beat-harness.cjs');
const v2ui={beatOf:(x,r)=>ui.beatOf(x,r,null,'entry-normal-v2'),sdOf:x=>ui.sdOf(x,'entry-normal-v2')};
const v2server={royaleBeatDeficit:(x,r)=>server.royaleBeatDeficit(x,r,'entry-normal-v2'),rSd:server.rSd};
const vectors = require('./fixtures/bozo-expected-margin.json');
const vm = require('node:vm');

test('page and Worker carry the exact same moneyline implementation', () => {
  const helper = s => s.match(/function moneylineBeat\([\s\S]*?\n\}/)[0];
  assert.equal(helper(page), helper(worker));
});
test('shared golden vectors run through real UI and Worker entry points', () => {
  for (const {name, pick, result, expected} of vectors) {
    const a = v2ui.beatOf(pick, result), b = v2server.royaleBeatDeficit(pick, result).v;
    assert.equal(a, b, name + ' exact parity');
    if (expected == null) assert.equal(a, null, name);
    else assert.ok(Math.abs(a-expected)<1e-8, `${name}: ${a} vs ${expected}`);
  }
});
test('larger favorites with identical losing margins have worse beats', () => {
  const pick = {sport:'nfl',mkt:'ml',price:-218,entryPriceOpp:180};
  const r={actual:-7,result:'lost'};
  assert.ok(v2ui.beatOf({...pick,price:-395,entryPriceOpp:310},r)>v2ui.beatOf(pick,r));
});
test('no close, raw-implied, juice-heuristic, or invalid-price fallback', () => {
  const x={sport:'nfl',mkt:'ml',price:-395,entryPriceOpp:310};
  const r={actual:-5,result:'lost',close:-120,closeOpp:100};
  for (const patch of [{entryPriceOpp:null},{entryOppSource:'assumed'},{verificationStatus:'unverified'},
    {price:''},{price:0},{price:Infinity},{entryPriceOpp:'bad'},{entryPriceOpp:true}]) {
    const p={...x,...patch};
    assert.equal(v2ui.beatOf(p,r),null); assert.equal(v2server.royaleBeatDeficit(p,r).v,null);
  }
  assert.equal(v2ui.beatOf(x,r),v2ui.beatOf(x,{actual:-5}));
  assert.equal(v2ui.beatOf({...x,entryPriceOpp:undefined,priceOpp:310},r),v2ui.beatOf(x,r));
});
test('period SD and all sport/market SDs agree exactly', () => {
  for(const sport of ['nfl','cfb','nba','cbb','mlb','nhl']) for(const mkt of ['ml','spread','total']) {
    for(const period of ['game','1h','2h','1q','2q','3q','4q']) {
      const x={sport,mkt,period,price:-218,entryPriceOpp:180,line:3,dir:'over'};
      assert.equal(v2ui.sdOf(x),v2server.rSd(x));
      assert.equal(v2ui.beatOf(x,{actual:-7}),v2server.royaleBeatDeficit(x,{actual:-7}).v);
    }
  }
  const x={sport:'nfl',mkt:'ml',price:-218,entryPriceOpp:180};
  const a=v2server.royaleBeatDeficit(x,{actual:-3}), b=v2server.royaleBeatDeficit({...x,period:'1h'},{actual:-3});
  assert.equal(b.expectedMargin,a.expectedMargin*Math.sqrt(.5));
});
test('non-loss outcomes never score or enter the Worker loser pool', () => {
  for(const result of ['pending','push','void','won']) {
    const p={sport:'nfl',mkt:'ml',price:-395,entryPriceOpp:310};
    const r={actual:-5,result,won:false};
    assert.equal(v2ui.beatOf(p,r),null);assert.equal(v2server.royaleBeatDeficit(p,r).v,null);
    assert.equal(server.royaleDecideChop({picks:{a:p},results:{a:r}},[1]).ticketCashed,true);
  }
});
test('spread and total prices do not affect their deficit', () => {
  for(const mkt of ['spread','total']) for(const dir of ['over','under']) {
    const x={sport:'nfl',mkt,line:14.5,dir,price:-110};
    assert.equal(v2ui.beatOf(x,{actual:-16}),v2ui.beatOf({...x,price:-400},{actual:-16}));
  }
});
test('existing Worker cascade restarts all losers after a tie (documented, not changed)', () => {
  const picks={a:{mkt:'spread',sport:'nfl',line:0,ts:1},b:{mkt:'spread',sport:'nfl',line:0,ts:2},c:{mkt:'spread',sport:'nfl',line:0,ts:3}};
  const results={a:{result:'lost',actual:-9},b:{result:'lost',actual:-9},c:{result:'lost',actual:-1}};
  assert.equal(server.royaleDecideChop({picks,results},[1,2]).choppedKey,'c');
});
test('week 6 all-loser scenarios agree in real UI decide and Worker cascade for SF losses 1–15', async () => {
  const week = require('./fixtures/bozo-main-impact.json').weeks.find(w=>w.week===6);
  vm.runInContext(page.match(/async function decide\([\s\S]*?\n\}/)[0],ui);
  Object.assign(ui,{document:{querySelectorAll:()=>[]},gradeErr:()=>{},refresh:()=>{},
    LEVERS:[{k:'odds',name:'Shortest Odds'},{k:'beat',name:'Worst Beat'},{k:'last',name:'Last In'},{k:'clv',name:'Worst CLV'}]});
  let actual;
  ui.confirmGrade=async result=>{actual=result.bozo;return true;}; // local capture only
  for(let loss=1;loss<=15;loss++){
    const state={...week,season:2026,worstBeatPolicy:{version:'entry-normal-v2',season:2026,week:6},results:{...week.results,Kap:{actual:-loss,result:'lost',won:false}}};
    ui.S=state;
    await ui.decide();
    assert.equal(actual,loss>=5?'Kap':'WBeamen');
    assert.equal(actual,server.royaleDecideChop(state,state.order).choppedKey);
  }
});
