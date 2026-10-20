const {test}=require('node:test');const assert=require('node:assert/strict');
const SD=require('../dfs-showdown.js');const {DDFS}=require('../work/dfs-engine.js');
test('cash-line precedence, exact sources and missing metadata',()=>{
 const c={fieldSize:200,payouts:Array(87).fill(2),paidPlaces:87,cashLinePct:43.5,cashLineSource:'synthetic supplied schedule'};
 for(const [key,source] of [['payouts','payouts'],['paidPlaces','paidPlaces'],['cashLinePct','cashLinePct']]){const r=SD.resolveCashLine(c);assert.equal(r.cashLine,.435);assert.equal(r.cashLineSource,source);delete c[key];}
 assert.equal(SD.resolveCashLine(c).cashLine,.22);assert.equal(SD.resolveCashLine(c).cashLineSource,'assumed');
 assert.equal(SD.resolveCashLine({payouts:[],cashLinePct:43.5}).cashLineSource,'cashLinePct');
 assert.equal(SD.resolveCashLine({fieldSize:200,payouts:[0]}).cashLine,0);
});
test('invalid or contradictory supplied evidence fails closed',()=>{
 for(const c of [{fieldSize:0,paidPlaces:1},{fieldSize:200,paidPlaces:87.5},{fieldSize:200,paidPlaces:201},{cashLinePct:'43.5'},{cashLinePct:Infinity},{cashLinePct:101},{cashLinePct:-1},{payouts:[2]},{fieldSize:2,payouts:[2,2,2]},{fieldSize:2,payouts:[1,2]},{fieldSize:2,payouts:[2],paidPlaces:2},{fieldSize:200,paidPlaces:87,cashLinePct:22},{fieldSize:2,payouts:[NaN]},{contestType:'unknown'}])assert.throws(()=>SD.resolveCashLine(c),/Cash line:/);
 assert.equal(SD.resolveCashLine({fieldSize:2,payouts:[2,2]}).flatPositivePrizes,true);
 assert.equal(SD.resolveCashLine({fieldSize:2,payouts:[2,1]}).flatPositivePrizes,false);
 assert.equal(SD.resolveCashLine({contestType:'cash'}).flatPositivePrizes,false);
});
test('classification respects cash and supplied fields without inventing prize pools',()=>{
 assert.equal(SD.classifyContest({name:'$5 Double Up',fieldSize:90000}),'cash');
 for(const name of ['50/50','Head-to-Head','Triple Up'])assert.equal(SD.classifyContest({name}),'cash');
 assert.equal(SD.classifyContest({contestType:'cash',name:'[Single Entry]'}),'cash');
 assert.equal(SD.classifyContest({name:'$1.5M Synthetic [$500K to 1st]',prizePool:1500000}),'flag');
 assert.equal(SD.classifyContest({name:'Synthetic [$50K to 1st]',prizePool:250000}),'flag');
 assert.equal(SD.classifyContest({name:'Synthetic [$50K to 1st]'}),'se');
 assert.equal(SD.classifyContest({name:'Synthetic [Single Entry]'}),'se');
 assert.equal(SD.classifyContest({name:'Synthetic [20 Entry Max]'}),'mid');
 assert.equal(SD.classifyContest({name:'Synthetic [1 Entry Max]'}),'se');
 assert.equal(SD.classifyContest({contestType:'gpp',fieldSize:20000}),'flag');
});
test('percentage display follows explicit examples and interval uses exact hits',()=>{
 assert.equal(SD.formatSimulationPct(99.4,2500),'99%');assert.equal(SD.formatSimulationPct(99.6,2500),'>99%');
 assert.equal(SD.formatSimulationPct(100,4999),'>99%');assert.equal(SD.formatSimulationPct(100,5000),'100% in simulation');
 assert.equal(SD.formatSimulationPct(.435*100,600),'44%');
 const ci=SD.wilson95(50,100);assert.ok(Math.abs(ci[0]-.40383)<.0001);assert.ok(Math.abs(ci[1]-.59617)<.0001);
 assert.ok(SD.wilson95(400,400)[0]<1);assert.equal(SD.wilson95(0,0),null);
});
test('entry-specific cash lines change accounting, not fixed bins or legacy grade weights',async()=>{
 const d=SD.demoSlate(),quick={engine:DDFS,worlds:600,fieldN:2000,seed:216};
 const cash={...d.entries[0],type:'cash',entrants:200,contestMeta:{contestType:'cash',fieldSize:200,paidPlaces:87}};
 const gpp={...d.entries[1],entrants:200,contestMeta:{contestType:'gpp',fieldSize:200,payouts:[50,20,...Array(42).fill(1)]}};
 const a=await SD.analyze({...d,entries:[cash,gpp]},quick);
 const b=await SD.analyze({...d,entries:[{...cash,contestMeta:{contestType:'cash',fieldSize:200}},gpp]},quick);
 assert.equal(a.entries[0].cashLine,.435);assert.equal(a.entries[0].cashLineSource,'paidPlaces');
 assert.equal(a.entries[1].cashLine,.22);assert.equal(a.entries[1].cashLineSource,'payouts');
 assert.ok(a.entries[0].cash.cash>b.entries[0].cash.cash);
 assert.ok(a.portfolio.pCash>=b.portfolio.pCash);
 assert.deepEqual(a.entries.map(e=>e.finish),b.entries.map(e=>e.finish));
 assert.deepEqual(a.entries[1].score,b.entries[1].score);
 for(const grade of Object.values(a.entries[0].score))assert.deepEqual(grade,{score:null,word:'Unavailable'});
 assert.equal(SD.SCORE_WEIGHTS.cash,undefined);
 assert.equal(a.entries[0].cash.cash,a.entries[0].cashHits.cash/a.worlds*100);
 assert.deepEqual(a.entries[0].cashInterval.cash,SD.wilson95(a.entries[0].cashHits.cash,a.worlds));
 console.log('SYNTHETIC EVIDENCE',JSON.stringify({cash43_5:a.entries[0].cash.cash,cash22:b.entries[0].cash.cash,any43_5:a.portfolio.pCash,any22:b.portfolio.pCash,worlds:a.worlds}));
 const duplicate=await SD.analyze({...d,entries:[cash,cash]},quick),single=await SD.analyze({...d,entries:[cash]},quick);
 assert.equal(duplicate.portfolio.pCash,single.portfolio.pCash);
});

 test('winner-take-all is not a flat multi-rank prize',()=>{assert.equal(SD.resolveCashLine({fieldSize:200,payouts:[100]}).flatPositivePrizes,false);});
