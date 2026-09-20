const assert=require('node:assert/strict'),E=require('./dfs-engine.js').DDFS;
const specs=[['QB','A','B'],['QB','C','D'],['RB','A','B'],['RB','B','A'],['RB','C','D'],['RB','D','C'],['WR','A','B'],['WR','A','B'],['WR','B','A'],['WR','C','D'],['WR','C','D'],['WR','D','C'],['TE','A','B'],['TE','B','A'],['TE','C','D'],['TE','D','C'],['DST','B','A'],['DST','D','C']];
const P=specs.map(([pos,team,opp],i)=>({name:'Synthetic '+i,id:String(100+i),dkId:String(100+i),pos,team,opp,gid:[team,opp].sort().join('@'),sal:5400,proj:10+i/3,ceil:20+(i*7)%13,own:2+(i*3)%19}));
const cfg={site:'dk_classic',count:2,minSalary:48500,maxSalary:50000,uniques:3,randomness:0,seed:216,maxPerTeam:4,maxPerGame:9,timeLimitMs:20000,acoCap:100,objective:{proj:.3,ceil:.7,own:-.05},stack:{qbMin:2,qbPos:['WR','TE'],bringBack:1,noRbVsDst:true,noQbVsDst:true}};
// Independent exhaustive oracle: no shared legality or solver helpers.
function valid(ids,c){const ps=ids.map(i=>P[i]),ct=pos=>ps.filter(p=>p.pos===pos).length,sal=ps.reduce((s,p)=>s+p.sal,0);if(ct('QB')!==1||ct('DST')!==1||ct('RB')<2||ct('RB')>3||ct('WR')<3||ct('WR')>4||ct('TE')<1||ct('TE')>2||sal<c.minSalary||sal>c.maxSalary)return false;
if(new Set(ps.map(p=>p.gid)).size<2||['A','B','C','D'].some(t=>ps.filter(p=>p.team===t).length>c.maxPerTeam))return false;
const q=ps.find(p=>p.pos==='QB'),d=ps.find(p=>p.pos==='DST');if(ps.filter(p=>p.team===q.team&&['WR','TE'].includes(p.pos)).length<2||!ps.some(p=>p.team===q.opp&&p.pos!=='DST')||ps.some(p=>['QB','RB'].includes(p.pos)&&p.opp===d.team))return false;
return c.acoCap==null||ps.reduce((s,p)=>s+p.own,0)<=c.acoCap;}
const score=(ids,w)=>ids.reduce((s,i)=>s+w.proj*P[i].proj+w.ceil*P[i].ceil+w.own*P[i].own,0),all=[];
function combos(ids,start){if(ids.length===9){if(valid(ids,cfg))all.push(ids.slice());return;}for(let i=start;i<=P.length-(9-ids.length);i++){ids.push(i);combos(ids,i+1);ids.pop();}}combos([],0);assert.ok(all.length);
const r=E.solveLineups(P,cfg);assert.equal(r.timedOut,false);assert.equal(r.lineups.length,2);const eligible=all.slice();for(const l of r.lineups){assert.ok(valid(l.ids,cfg));assert.ok(Math.abs(score(l.ids,cfg.objective)-Math.max(...eligible.map(ids=>score(ids,cfg.objective))))<1e-8);for(let j=eligible.length-1;j>=0;j--)if(eligible[j].filter(i=>l.ids.includes(i)).length>6)eligible.splice(j,1);}
const neg={proj:-1,ceil:0,own:0},n=E.solveLineups(P,{...cfg,count:1,objective:neg});assert.ok(Math.abs(score(n.lineups[0].ids,neg)-Math.max(...all.map(ids=>score(ids,neg))))<1e-8);
const impossible=E.solveLineups(P,{...cfg,acoCap:0});assert.equal(impossible.lineups.length,0);assert.ok(impossible.infeasible);assert.equal(impossible.timedOut,false);
assert.throws(()=>E.solveLineups(P.map((p,i)=>i? p:{...p,own:null}),cfg),/ownership/);
assert.throws(()=>E.solveLineups(P.map((p,i)=>i? p:{...p,ceil:null}),cfg),/ceiling/);
const a=E.simulateTail(P,r.lineups,{site:'dk_classic'}),b=E.simulateTail(P,r.lineups,{site:'dk_classic'});assert.deepEqual(a,b);assert.equal(a.meta.sims,30000);assert.equal(a.meta.seed,216);
for(const x of a.perLineup){assert.ok(x.median<x.p90&&x.p90<x.p99&&x.p99<x.p999);assert.ok(x.p230>=x.p250);assert.equal(x.p250,x.hits250/30000);assert.ok(x.aco<=100);}
const zero=P.map(p=>({...p,own:0}));const z=E.simulateTail(zero,r.lineups,{sims:200});assert.equal(z.perLineup[0].logOwn,null);assert.equal(z.perLineup[0].zeroOwnership,true);
assert.deepEqual(E.tailLoadings('DST'),[-.35,-.20]);assert.deepEqual(E.tailLoadings('RB'),[.30,.25]);
const csv=E.classicExport(P,r.lineups);assert.match(csv,/^QB,RB,RB,WR,WR,WR,TE,FLEX,DST/);assert.ok(csv.trim().split('\r\n').slice(1).every(row=>/^\d+(,\d+){8}$/.test(row)));
const broken=P.map(p=>({...p}));broken[r.lineups[0].ids[0]].dkId='bad';assert.throws(()=>E.classicExport(broken,r.lineups),/numeric/);delete broken[r.lineups[0].ids[0]].dkId;assert.throws(()=>E.classicExport(broken,r.lineups),/numeric/);
console.log('PASS: exhaustive optimum, negative weights, hard ACO infeasibility, uniqueness, team/DST/stack rules, seeded tails and fail-closed CSV.');
