const assert=require('node:assert/strict');
const A=require('../dfs-lab-audit.js'),P=require('../dfs-pareto.js');
const players=Array.from({length:11},(_,i)=>({name:'Fixture '+i,pos:['QB','RB','WR','TE','K'][i%5],team:i<5?'A':'B',sal:1200+i*800,proj:0.3+i*1.9,own:i===0?0.3:35+i,cptOwn:i===0?0:2+i}));
// Explicit CPT inputs differ from the 1.5x fallback and must survive reconciliation.
players[8].cptSal=9000;players[8].cptProj=35.17;
const cfg={site:'dk_showdown',minSalary:33000,maxSalary:48000,maxPerTeam:4,cloud:5000};
for(const rules of [cfg,{...cfg,minSalary:0,maxPerTeam:3},{...cfg,minSalary:38500}]){
 const result=P.generate(players,rules),audit=A.reconcile(players,rules,result);
 assert.equal(audit.maxStatus,'PASS');assert.equal(audit.productPass,true);assert.equal(audit.pass,true);
 const broken={...result,lineups:result.lineups.map((l,i)=>i?l:{...l,proj:l.proj+0.8})};
 assert.equal(A.reconcile(players,rules,broken).maxStatus,'FAIL');
 const brokenProduct={...result,lineups:result.lineups.map((l,i)=>i?l:{...l,x:l.x+1})};
 assert.equal(A.reconcile(players,rules,brokenProduct).productPass,false);
}
players[0].lock=true;players[3].excl=true;
assert.equal(A.reconcile(players,cfg,P.generate(players,cfg)).maxStatus,'PASS');
players[0].excl=true;assert.equal(A.optimum(players,cfg).status,'INFEASIBLE');
players[0].excl=false;players[3].excl=false;
assert.equal(A.ownership(players[0],true,true),0.0025);
assert.equal(A.inspect(players,true).pass,true); // a reported zero is distinct from missing
const copy=players.map(p=>({...p}));delete copy[1].cptOwn;
assert.equal(A.inspect(copy,true).pass,false);
copy[1].cptOwn=99;assert.equal(A.inspect(copy,true).pass,false);
const lineup=P.generate(players,cfg).lineups.find(l=>l.cpt===0);
assert.ok(lineup,'A low-projection, low-owned captain stays in the candidate pool');
const e=A.evidence(lineup,players,true);
assert.ok(e.slots.every(s=>s.used>=0.0025));
assert.ok(Math.abs(e.slots.reduce((s,p)=>s+p.logShare,0)-1)<1e-12);
// The two suggested punt guards are not equivalent: log share can be <=50%
// even when the companion five-slot product is dominated. We display both,
// never use either to silently exclude candidates.
assert.ok(e.coreProduct>=e.product);
console.log('Independent maximum, custom CPT fields, changed rules, corrupted outputs, zero/missing ownership, and retained punts pass');

const fallback=players.map(p=>({...p,cptSal:0,cptProj:undefined,lock:false,excl:false}));
assert.equal(A.reconcile(fallback,cfg,P.generate(fallback,cfg)).maxStatus,'PASS');
console.log('Missing captain salaries use the legal 1.5× fallback in both independent searches');
