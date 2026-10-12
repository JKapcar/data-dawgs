/* Mechanical regression evidence for the EXISTING engine; not calibration.
   The builder deliberately does not present these conditional rates as live results. */
const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../work/dfs-engine.js').DDFS;
const players=['QB','WR','RB','TE','K','DST'].map((pos,i)=>({name:'Synthetic '+i,pos,team:i<3?'AAA':'BBB',opp:i<3?'BBB':'AAA',gid:'AAA@BBB',sal:5000,proj:10+i,own:30,flexOwn:30,cptOwn:10}));
const lineup={ids:[0,1,2,3,4,5],cpt:0};
const config=fieldSize=>({site:'dk_showdown',sims:200,seed:216,fieldSize,fieldSample:fieldSize-1,entryFee:10,payout:{kind:'table',rows:[{from:1,to:1,prize:fieldSize*8}]},opponentLineups:Array.from({length:fieldSize-1},()=>({...lineup,ids:[5,4,3,2,1,0]}))});
test('existing shared outcomes reproduce with seed; duplicate ties split prizes once',()=>{
 const a=E.simulate(players,[lineup],config(10)),b=E.simulate(players,[lineup],config(10));assert.deepEqual(a,b);assert.equal(a.meta.seed,216);assert.equal(a.meta.sims,200);assert.equal(a.perLineup[0].ev,8);assert.equal(a.perLineup[0].cash,1);assert.equal(a.perLineup[0].profit,0);assert.ok(Math.abs(a.perLineup[0].firstShare-.1)<1e-12);assert.equal(a.perLineup[0].dupes,9);
});
test('existing small-field top-1% includes at least first place; tied rank is not outright win',()=>{
 for(const n of [2,99,100,101,200]){const result=E.simulate(players,[lineup],config(n));assert.equal(result.perLineup[0].top1,1);assert.equal(result.meta.top1Resolved,true);assert.ok(Math.abs(result.perLineup[0].firstShare-1/n)<1e-12);assert.equal(result.perLineup[0].win,1);assert.notEqual(result.perLineup[0].win,result.perLineup[0].firstShare);}
});
test('existing partial-field tail gate withholds first-place and top-heavy ROI',()=>{
 const c=config(10000);c.opponentLineups=c.opponentLineups.slice(0,20);c.fieldSample=20;const r=E.simulate(players,[lineup],c);assert.equal(r.meta.fullField,false);assert.equal(r.meta.top1Resolved,false);assert.equal(r.perLineup[0].win,null);assert.equal(r.perLineup[0].roi,null);assert.ok(r.perLineup[0].ci.cash[0]<1);assert.match(r.meta.uncertainty,/not model-error/);
});
