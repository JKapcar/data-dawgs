const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
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
  const c=vm.createContext({Response,Request,Date,console,
    rImp:a=>a<0?Math.abs(a)/(Math.abs(a)+100):100/(a+100),playerName:k=>k,
    ROYALE_LEVER_NAMES:['Shortest Odds','Worst Beat','Last In','Worst CLV'],
    readBody:r=>r.json(),leagueOf:()=> 'royale',requireManager:async()=>({league:state}),
    bozoGradeFromScheduleKv:async()=>({results,pending:[],sources:{}}),
    bozoGradeConfirmCode:async(_env,p)=>{signed=p;return 'test-confirm';},
    LG:l=>'/bozo/leagues/'+l,json:(v,s=200)=>new Response(JSON.stringify(v),{status:s})
  });
  vm.runInContext(slice('function royaleApplyLever(', '/* ---------------- roster state')+'\n'+slice('async function bozoGrade(', 'async function bozoNext('),c);
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
