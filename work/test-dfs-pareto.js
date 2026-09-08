const assert=require('node:assert/strict'),P=require('../dfs-pareto.js'),I=require('./dfs-slate-ingest.js'),fs=require('fs');
const csv='Player,Pos,Team,Salary,Proj,Total Own,CPT Own,CPT Salary\n'+Array.from({length:10},(_,i)=>`Player ${i},${['QB','RB','WR','TE','K'][i%5]},${i<5?'AAA':'BBB'},${4000+i*500},${8+i},${40+i},${2+i},${(4000+i*500)*1.5}`).join('\n');
const players=I.readUpload(csv,[]).players,cfg={site:'dk_showdown',count:5000,minSalary:0,maxSalary:50000,maxPerTeam:5};
const r=P.generate(players,cfg);assert.ok(r.lineups.length>1000);assert.equal(new Set(r.lineups.map(l=>l.ids.slice().sort((a,b)=>a-b).join(',')+'|'+l.cpt)).size,r.lineups.length);
for(const l of r.lineups)assert.ok(P.legal(l.ids,l.cpt,players,cfg));
assert.equal(P.ownership({own:50,cptOwn:10},false,true),0.4);assert.equal(P.ownership({own:50,cptOwn:10},true,true),0.1);assert.equal(P.ownership({own:0},false,false),null);
const pts=[{x:1,y:10},{x:2,y:9},{x:2,y:12},{x:3,y:12},{x:4,y:13},{x:1,y:8}];assert.deepEqual(P.frontier(pts),[pts[0],pts[2],pts[4]]);
players[0].lock=true;players[1].excl=true;const locked=P.generate(players,{...cfg,count:100});assert.ok(locked.lineups.length);assert.ok(locked.lineups.every(l=>l.ids.includes(0)&&!l.ids.includes(1)));
console.log(`${r.lineups.length} distinct legal Showdown candidates; slot ownership, discrete frontier, locks and exclusions pass`);
