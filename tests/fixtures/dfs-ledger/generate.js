// Regenerates this fixture: cd tests/fixtures/dfs-ledger && node generate.js
// Deterministic synthetic fixture: invented players, invented users. No ETR, no DK data.
const fs=require('fs');
const P=[
 ['Alex Quill','QB','AAA',10000,18.2,30.1,60.0,22.0],
 ['Blake Torren','QB','BBB',9000,15.1,26.0,40.0,10.0],
 ['Chris Vale','RB','AAA',11000,20.4,33.5,70.0,25.0],
 ['Drew Holm','RB','BBB',8000,12.0,22.0,35.0,6.0],
 ['Evan Pike','WR','AAA',9400,14.5,27.9,55.0,12.0],
 ['Finn Ortega','WR','BBB',7200,11.2,21.4,38.0,7.0],
 ['Gabe Niles','WR','AAA',6000,9.1,19.0,30.0,4.0],
 ['Hugo Remy','TE','AAA',6400,10.0,19.5,32.0,4.0],
 ['Ivan Cole','TE','BBB',4400,7.2,15.0,20.0,2.0],
 ['Jess Marlow','K','AAA',5000,8.0,13.0,28.0,2.5],
 ['Kai Brandt','K','BBB',4800,7.1,12.0,22.0,1.5],
 ['BBB Hawks','DST','BBB',3800,5.5,13.0,18.0,1.0],
 ['AAA Owls','DST','AAA',4200,6.4,14.0,24.0,2.0],
].map(([name,pos,team,sal,proj,ceil,own,cptOwn])=>({id:team+':'+name,name,pos,team,opp:team==='AAA'?'BBB':'AAA',gid:'AAA-BBB',sal:Math.round(sal*.8/100)*100,cptSal:Math.round(sal*.8/100)*150,proj,cptProj:+(proj*1.5).toFixed(2),ceil,own,cptOwn}));
const L=[ // workspace lineups (index → {cpt, ids})
 {cpt:0,ids:[0,2,4,5,7,9]},
 {cpt:2,ids:[2,0,4,1,9,12]},
 {cpt:4,ids:[4,0,1,5,8,10]},
 {cpt:1,ids:[1,5,3,0,4,11]},
];
const sal=l=>l.ids.reduce((s,i)=>s+(i===l.cpt?P[i].cptSal:P[i].sal),0);
const proj=l=>+l.ids.reduce((s,i)=>s+P[i].proj*(i===l.cpt?1.5:1),0).toFixed(2);
const lineups=L.map(l=>({...l,sal:sal(l),proj:proj(l)}));
lineups.forEach(l=>{if(l.sal>50000)throw Error('salary '+l.sal)});
const per=[ // simulation perLineup for workspace indices 0,1,2 (3 deliberately not simulated)
 {i:0,mean:101.2,sd:24.0,cash:.31,top1:.020,top10:.0010,meanRank:5000,dupes:40.0,eDupes:35.0,top1Share:.020/41},
 {i:1,mean:98.4,sd:27.5,cash:.27,top1:.024,top10:.0015,meanRank:6000,dupes:12.0,eDupes:10.0,top1Share:.024/13},
 {i:2,mean:90.1,sd:29.0,cash:.20,top1:.016,top10:.0008,meanRank:8000,dupes:2.0,eDupes:1.5,top1Share:.016/3},
];
const ws={id:'fixture-showdown',site:'dk_showdown',source:'synthetic fixture (invented players)',as_of:'2026-09-07T15:00:00.000Z',revision:5,updated_at:'2026-09-07T16:30:00.000Z',
 players:P,lineups,total_lineups:lineups.length,
 simulation:{workspace_indices:[0,1,2],input_revision:4,dupe_prior:true,perLineup:per,
  meta:{engineVersion:2,sims:1600,seed:216,fieldSize:20001,entryFee:20,paidPlaces:4000,fieldSample:4000,rankMethod:'scaled empirical opponent field',payout:{kind:'param',paidFrac:.2,alpha:1.15,rake:.15}}}};
fs.writeFileSync('snapshot.json',JSON.stringify(ws,null,1)+'\n');
// standings
const nm=i=>P[i].name;
const lineStr=l=>'CPT '+nm(l.cpt)+' '+l.ids.filter(i=>i!==l.cpt).map(i=>'FLEX '+nm(i)).join(' ');
const other=[{cpt:3,ids:[3,1,5,8,11,10]},{cpt:5,ids:[5,1,3,8,10,11]},{cpt:7,ids:[7,0,2,4,6,9]},{cpt:9,ids:[9,0,2,4,5,12]}];
function standings(rows,own){
 const head='Rank,EntryId,EntryName,TimeRemaining,Points,Lineup,,Player,Roster Position,%Drafted,FPTS';
 const out=[head];const n=Math.max(rows.length,own.length);
 for(let k=0;k<n;k++){const r=rows[k],o=own[k];
  const left=r?[r.rank,r.id,r.name,0,r.pts.toFixed(2),r.line]:['','','','','',''];
  const right=o?[o[0],o[1],o[2].toFixed(2)+'%',o[3].toFixed(2)]:['','','',''];
  out.push(left.concat([''],right).map(x=>/[",]/.test(String(x))?'"'+x+'"':x).join(','));}
 return out.join('\r\n')+'\r\n';
}
function ownTable(seed){return P.flatMap((p,i)=>[[p.name,'CPT',Math.max(.1,p.cptOwn+((i*7+seed)%5)-2),p.proj*1.5],[p.name,'FLEX',Math.max(.1,p.own-p.cptOwn+((i*3+seed)%7)-3),p.proj]]);}
// Contest A: 20 entries, large-ish GPP, 2 of ours (lineups 0 and 1), lineup 0 duplicated 3 times total, tie at 9th.
function contest(spec){const rows=[];spec.forEach((s,k)=>rows.push({rank:0,id:String(5000000+s.id*100+k),name:s.u,pts:s.pts,line:s.l===null?'':lineStr(s.l)}));
 rows.sort((a,b)=>b.pts-a.pts);rows.forEach((r,k)=>{r.rank=k&&rows[k-1].pts===r.pts?rows[k-1].rank:k+1;});return rows;}
const A=[];const sc=[150.2,148.0,140.5,139.9,133.3,130.0,128.8,126.1,120.0,120.0,118.4,115.0,112.7,110.0,104.3,101.0,99.5,96.4,90.0,85.5];
const users=['ddtester (1/2)','rival1','ddtester (2/2)','rival2 (1/3)','rival2 (2/3)','rival2 (3/3)','shark','fish1','fish2','fish3','fish4','fish5','fish6','fish7','fish8','fish9','fish10','fish11','fish12','fish13'];
const lus=[L[1],other[0],L[0],L[0],L[0],other[1],other[2],other[3],other[0],other[1],other[2],other[3],other[0],other[1],other[2],other[3],other[0],other[1],other[2],other[3]];
// ours: index0 = L[1] 150.2 rank1 ; index2 = L[0] score 140.5, tied? no. rival2 (L[0]) copies -> copies 3 total for L[0]
const ptsMap=[150.2,148.0,120.0,120.0,120.0,139.9,133.3,130.0,128.8,126.1,118.4,115.0,112.7,110.0,104.3,101.0,99.5,96.4,90.0,85.5];
const specA=users.map((u,k)=>({u,pts:ptsMap[k],l:lus[k],id:1}));
fs.writeFileSync('contest-standings-100000001.csv',standings(contest(specA),ownTable(1)));
// Contest B: 10 entries, single-entry; our lineup 2 (not simulated? no, simulated) finishing mid
const specB=[['ddtester',L[2],101.1],['a1',other[0],140.0],['a2',other[1],131.0],['a3',other[2],125.5],['a4',other[3],118.0],['a5',L[0],111.0],['a6',other[0],99.0],['a7',other[1],95.0],['a8',other[2],90.0],['a9',other[3],80.0]].map(([u,l,p])=>({u,l,pts:p,id:2}));
fs.writeFileSync('contest-standings-100000002.csv',standings(contest(specB),ownTable(2)));
// Contest C: 8 entries; ours: L[3] (in snapshot, not simulated) and a manual lineup not in snapshot; no metadata supplied for C.
const manual={cpt:6,ids:[6,0,2,4,5,9]};
const specC=[['ddtester (1/2)',L[3],77.0],['ddtester (2/2)',manual,88.0],['b1',other[0],120.0],['b2',other[1],110.0],['b3',other[2],100.0],['b4',other[3],95.0],['b5',L[3],77.0],['b6',other[0],60.0]].map(([u,l,p])=>({u,l,pts:p,id:3}));
fs.writeFileSync('contest-standings-100000003.csv',standings(contest(specC),ownTable(3)));
fs.writeFileSync('contests.json',JSON.stringify({
 '100000001':{name:'Fixture GPP $20',entry_fee:20,max_entries:20,max_entries_per_user:3,payout:[{from:1,to:1,prize:150},{from:2,to:2,prize:60},{from:3,to:4,prize:30},{from:5,to:10,prize:10}]},
 '100000002':{name:'Fixture Single Entry $5',entry_fee:5,max_entries:10,max_entries_per_user:1,payout:[{from:1,to:1,prize:20},{from:2,to:3,prize:10}]}
},null,1)+'\n');
