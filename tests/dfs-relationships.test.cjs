const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../dfs-builder-sim.js'),E=require('../work/dfs-engine.js').DDFS;
function prepared(correlation='historical',scale=1){
 const players=[['Q','QB','A','B',20],['W1','WR','A','B',19],['W2','WR','A','B',15],['D','DST','A','B',9],['OD','DST','B','A',8],['K','K','A','B',7],['X','WR','C','D',10]].map(([name,pos,team,opp,proj])=>({name,pos,team,opp,proj}));
 const roles=E.assignRoles(players),ids=[0,1,2,3,4,5],n=ids.length,M=new Float64Array(n*n);
 for(let a=0;a<n;a++)for(let b=0;b<n;b++)M[a*n+b]=a===b?1:correlation==='independent'?0:E.modelHelpers.corrBetween(roles[a],roles[b],players[a].team===players[b].team,roles[a]===roles[b])*scale;
 const chol=E.modelHelpers.cholesky(M,n);assert.equal(chol.failed,undefined);
 return {pool:{players},candidate:{ids:[0,2,3,4,5,6]},roles,config:{correlation,correlationScale:scale},correlations:[{ids,n,...chol}]};
}
test('receipt follows real role table and actual normalized factor, without teaching coefficients',()=>{
 const p=prepared(),r=S.relationships(p),pairs=r.pairs;
 assert.equal(pairs.length,15);assert.equal(pairs[0].table,.3134);assert.equal(pairs[1].table,-.1101);assert.equal(pairs[2].table,-.3114);
 for(const pair of pairs.slice(0,3))assert.ok(Math.abs(pair.applied-pair.table)<1e-10);
 assert.match(pairs[3].basis,/No historical/);assert.equal(pairs[3].table,null);assert.equal(pairs[3].applied,0);
 assert.match(pairs[4].basis,/Different games/);assert.equal(pairs[4].applied,0);
 assert.deepEqual(r.source,E.CORR.meta);
});
test('explicit independence and multiplier are reported without substituting historical values',()=>{
 assert.ok(S.relationships(prepared('independent')).pairs.every(x=>x.applied===0));
 const r=S.relationships(prepared('historical',.5));assert.ok(Math.abs(r.pairs[0].applied-.3134*.5)<1e-10);assert.equal(r.pairs[0].table,.3134);
});
test('stabilization normalization reports what sampling uses',()=>{
 const p=prepared();p.correlations[0].jitter=.1;
 assert.ok(Math.abs(S.relationships(p).pairs[0].applied-.3134/1.1)<1e-10);
});

test('duplicate depth roles remain marked as assumptions rather than measured self-correlation',()=>{
 const p=prepared();p.roles[0]='WRx';p.roles[2]='WRx';
 const row=S.relationships(p).pairs[0];assert.equal(row.table,null);assert.match(row.basis,/fallback assumption/);
 assert.equal(E.modelHelpers.corrBetween('WRx','WRx',true,true),.03);
});
