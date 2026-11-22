const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const clvContext=(c={})=>vm.createContext(Object.assign(c,{DDEffectiveClv:require('../bozo-effective-clv.js'),window:{DDEffectiveClv:require('../bozo-effective-clv.js')}}));
const source = fs.readFileSync(require('node:path').join(__dirname, '../dawg-bot-worker.js'), 'utf8');
const slice = (a,b) => source.slice(source.indexOf(a), source.indexOf(b,source.indexOf(a)));
function setup(unsettled=false) {
  const state={format:'royale',week:1,status:'placed',order:[0,2,1,3],picks:{
    legend:{who:'ItzBornLegend',price:-258,label:'DEN +7.5',ts:1},
    beamen:{who:'WBeamen',price:-250,label:'BYU ML · 1st half',ts:2},
    winner:{who:'Tony',price:-440,label:'JAX ML',ts:3}
  }};
  const results={legend:{result:'lost',won:false},beamen:unsettled?{}:{result:'lost',won:false},winner:{result:'won',won:true}};
  let signed;
  const c=clvContext({Response,Request,Date,console,
    rImp:a=>a<0?Math.abs(a)/(Math.abs(a)+100):100/(a+100),playerName:k=>k,
    ROYALE_LEVER_NAMES:['Shortest Odds','Worst Beat','Last In','Worst CLV'],
    readBody:r=>r.json(),leagueOf:()=> 'royale',requireManager:async()=>({league:state}),
    bozoGradeFromScheduleKv:async()=>({results,pending:[],sources:{}}),
    bozoGradeConfirmCode:async(_env,p)=>{signed=p;return 'test-confirm';},
    LG:l=>'/bozo/leagues/'+l,json:(v,s=200)=>new Response(JSON.stringify(v),{status:s})
  });
  vm.runInContext(slice('function worstBeatRuleFor(', 'function moneylineBeat(')+'\n'+slice('function royaleApplyLever(', '/* ---------------- roster state')+'\n'+slice('async function bozoGrade(', 'async function bozoNext('),c);
  return {c,get signed(){return signed;}};
}
test('Royale signs refreshed -258 loser, not stale browser -250 verdict',async()=>{
 const f=setup();
 const response=await f.c.bozoGrade(new Request('https://example.test',{method:'POST',body:JSON.stringify({graded:true,bozo:'beamen',bozoWhy:'stale',results:{beamen:{won:false}}})}),{},{});
 const p=await response.json();
 assert.equal(response.status,200); assert.equal(p.bozo,'legend');
 assert.match(p.bozoWhy,/Shortest Odds.*-258/); assert.equal(f.signed.body.bozo,'legend');
});
test('unsettled manual leg cannot produce a final Royale verdict',async()=>{
 const f=setup(true);
 const r=await f.c.bozoGrade(new Request('https://example.test',{method:'POST',body:JSON.stringify({graded:true,bozo:'legend'})}),{},{});
 assert.equal(r.status,409); assert.equal(f.signed,undefined);
});

function finalTwo(status = {}, chops = {}) {
  const patches = [];
  const c = vm.createContext({
    Date, console, SEASON: 2026,
    playerName: key => key,
    memberIsActive: () => true,
    settingsOf: () => ({ buyback: 0 }),
    LG: lid => '/bozo/leagues/' + lid,
    ROYALE_LEVER_NAMES: ['Shortest Odds', 'Worst Beat', 'Last In', 'Worst CLV'],
    royaleDecideChop: () => ({
      ticketCashed: false, choppedKey: 'first', chopped: 'first',
      decidedBy: 'Worst Beat', leversPassed: [{ lever: 'Worst CLV', why: 'tie' }],
      losers: ['first', 'other'],
    }),
    fbPatch: async (_env, path, values) => patches.push({ path, values }),
  });
  vm.runInContext(slice('function royaleStatus(', '/* POST /bozo/buyback'), c);
  const state = {
    format: 'royale', season: 2026, week: 11,
    members: { first: {}, other: {}, eliminated: {} },
    royale: { status: { first: status, other: { alive: true }, eliminated: { alive: false } }, chops },
  };
  return { state, patches, resolve: () => c.royaleResolveWeek({}, 'test-royale', state) };
}

test('first chop at final two uses free redeploy; retains both players without declaring a survivor', async () => {
  const f = finalTwo();
  const rec = await f.resolve();
  assert.equal(f.patches.length, 1);
  const { path, values: p } = f.patches[0];
  assert.equal(path, '/bozo/leagues/test-royale');
  assert.equal(p['royale/status/first/alive'], true);
  assert.equal(p['royale/status/first/eliminatedWeek'], null);
  assert.equal(p['royale/status/first/redeploysLeft'], 0);
  assert.equal(p['royale/status/first/buybacksLeft'], 0);
  assert.deepEqual(Array.from(p['royale/status/first/redeployed']), [11]);
  assert.deepEqual(Array.from(p['royale/status/first/boughtBack']), [11]);
  assert.deepEqual(Array.from(p['royale/status/first/chopped']), [11]);
  assert.equal(rec.redeployed, true);
  assert.equal(rec.cost, 0);
  assert.equal(rec.fundsNextTicket, 'first');
  assert.equal(p['royale/survivor'], undefined);
  assert.equal(p['royale/endedWeek'], undefined);
  assert.equal(rec.survivor, undefined);
  assert.equal(p['royale/chops/w11'], rec);
});

test('next chop at final two ends the season, including legacy redeploy history without counters', async () => {
  for (const st of [
    { chopped: [10], redeploysLeft: 0, redeployed: [10] },
    { chopped: [10], boughtBack: [10] },
  ]) {
    const f = finalTwo(st);
    const rec = await f.resolve();
    const { values: p } = f.patches[0];
    assert.equal(p['royale/status/first/alive'], false);
    assert.equal(p['royale/status/first/eliminatedWeek'], 11);
    assert.deepEqual(Array.from(p['royale/status/first/chopped']), [10, 11]);
    assert.equal(rec.hadParachute, true);
    assert.equal(rec.redeployed, false);
    assert.equal(rec.survivor, 'other');
    assert.equal(p['royale/survivor'], 'other');
    assert.equal(p['royale/endedWeek'], 11);
  }
});

test('already resolved week does not write or spend a redeploy again', async () => {
  for (const key of ['w11', '11']) {
    const f = finalTwo({}, { [key]: { chopped: 'first' } });
    assert.equal(await f.resolve(), null);
    assert.equal(f.patches.length, 0);
  }
});
