// Synthetic, identical scoring draws and candidate rosters before/after. No private inputs.
const cp=require('node:child_process'),vm=require('node:vm'),assert=require('node:assert/strict');
const base='bb7f0ada236d210dae784c21f03a0be4c4049e33';
const context={module:{exports:{}}};vm.runInNewContext(cp.execFileSync('git',['show',base+':work/dfs-engine.js'],{encoding:'utf8'}),context);
const before=context.module.exports.DDFS,after=require('./dfs-engine.js').DDFS;
const P=require('./mkslate.js')(13);
const L=after.solveLineups(P,{site:'dk_classic',count:8,uniques:2,randomness:.25,minSalary:49000,maxPerTeam:4,stack:{qbMin:1,qbPos:['WR','TE']},timeLimitMs:90000,seed:42}).lineups;
assert.equal(L.length,8);
const cfg={site:'dk_classic',sims:1000,fieldSample:200,fieldSize:201,entryFee:20,seed:99,payout:{kind:'param',paidFrac:.2,alpha:1.15,rake:.15},opponentLineups:Array.from({length:200},(_,i)=>L[i%L.length])};
const original=after.simulate(P,L,cfg);
const strongest=original.perLineup.reduce((a,b)=>a.ev>b.ev?a:b).i;
const inputs=L.map((l,i)=>({...l,eDupes:i===strongest?100:0}));
const old=before.simulate(P,inputs,cfg),now=after.simulate(P,inputs,cfg);
const order=r=>r.perLineup.slice().sort((a,b)=>b.evAdj-a.evAdj||b.top10-a.top10).map(x=>x.i);
const rows=now.perLineup.map((r,i)=>{
 assert.equal(r.ev,old.perLineup[i].ev);assert.equal(r.mean,old.perLineup[i].mean);assert.equal(r.evAdj,r.ev);
 return {candidate:i,duplicatePrior:inputs[i].eDupes,oldAdjusted:old.perLineup[i].evAdj,settledEV:r.ev,mean:r.mean};
});
assert.notDeepEqual(order(old),order(now));
console.log(JSON.stringify({base,fixture:'Synthetic eight-roster Classic slate; deliberately varied prior, not calibrated duplicate forecasts',seed:99,sims:1000,beforeOrder:order(old),afterOrder:order(now),rows,currentLineupComparison:'Unavailable: no verified current candidate/projection inputs supplied'},null,2));
