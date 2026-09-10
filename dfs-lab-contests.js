/* Contest comparison: choose on training worlds, report held-out worlds.
   These are model candidates, not a calibrated betting recommendation. */
(function(root){
'use strict';
const config={maxOwnershipError:5};
const defaults=[
 {key:'cash',label:'Cash / double-up',short:'C',fieldSize:50,paidPlaces:22,multiplier:2,metric:'cash',metricLabel:'cash rate'},
 {key:'three',label:'3× multiplier',short:'3',fieldSize:250,paidPlaces:75,multiplier:3,metric:'cutoffShare',metricLabel:'paid-slot share'},
 {key:'five',label:'5× multiplier',short:'5',fieldSize:250,paidPlaces:45,multiplier:5,metric:'cutoffShare',metricLabel:'paid-slot share'},
 {key:'milly',label:'Milly / GPP',short:'M',fieldSize:132000,paidPlaces:26400,multiplier:null,metric:'top1Share',metricLabel:'dupe-adjusted top-1%'}
];
function profiles(saved={}){
 return defaults.map(d=>{const v=saved[d.key]||{};const fieldSize=Math.max(2,Math.min(10000000,Math.round(v.fieldSize||d.fieldSize)));
  const paidPlaces=Math.max(1,Math.min(fieldSize,Math.round(v.paidPlaces||d.paidPlaces)));
  return {...d,label:d.key==='milly'&&fieldSize<100000?'GPP':d.label,fieldSize,paidPlaces,entryFee:1,payout:d.multiplier?{kind:'table',rows:[{from:1,to:paidPlaces,prize:d.multiplier}]}:{kind:'param',paidFrac:paidPlaces/fieldSize,alpha:1.15,rake:.15}};
 });
}
function traits(l,P){
 const c=P[l.cpt],ids=l.ids,pass=p=>p.pos==='WR'||p.pos==='TE';if(!c)return {};
 const ownQB=ids.find(i=>P[i].team===c.team&&P[i].pos==='QB'&&i!==l.cpt);
 const catchers=ids.filter(i=>i!==l.cpt&&P[i].team===c.team&&pass(P[i]));
 const bringBack=ids.some(i=>P[i].team!==c.team&&['QB','RB','WR','TE'].includes(P[i].pos));
 const passStack=(c.pos==='QB'&&catchers.length>0)||(pass(c)&&ownQB!=null);
 const rbDst=ids.some(i=>P[i].pos==='RB'&&ids.some(j=>P[j].team===P[i].team&&P[j].pos==='DST'));
 const againstDST=ids.some(i=>P[i].pos==='QB'&&ids.some(j=>P[j].pos==='DST'&&P[j].team!==P[i].team));
 return {c,ownQB,catchers,bringBack,passStack,rbDst,againstDST};
}
function matches(l,P,script){const t=traits(l,P);return !script||script==='any'||script==='pass'&&t.passStack||script==='back'&&t.passStack&&t.bringBack||script==='run'&&t.rbDst;}
function story(l,P){
 const t=traits(l,P);if(!t.c)return 'Inspect the roster and its simulated outcomes.';
 let text=t.c.pos==='QB'?'Needs '+t.c.name+' to drive the scoring through the passing game.':
  ['WR','TE'].includes(t.c.pos)?'Needs '+t.c.name+' to capture a large share of receiving production.':
  t.c.pos==='RB'?'Needs '+t.c.name+' to turn touches and scoring opportunities into a big game.':
  t.c.pos==='DST'?'Needs sacks, turnovers or a defensive score from '+t.c.name+'.':
  'Needs repeated scoring opportunities for '+t.c.name+'.';
 if(t.passStack)text+=' The captain-side QB/receiver stack can score together.';
 if(t.bringBack)text+=' Opposing skill players give this build a path in a competitive game.';
 if(t.rbDst)text+=' The same-team RB/DST pairing fits a lead with rushing volume and defensive pressure.';
 if(t.againstDST)text+=' A QB faces the opposing DST in this roster; those outcomes usually pull in different directions.';
 return text;
}
function select(sim,lineups,P,script,configs=profiles()){
 return configs.map(c=>{
  const result=sim&&sim.contests&&sim.contests[c.key];
  if(!result)return {...c,unavailable:'Run the contest comparison.'};
  if(c.key==='milly'&&!result.meta.top1Resolved)return {...c,unavailable:'Increase the opponent sample to resolve the top 1%.'};
  const rows=result.perLineup.filter(r=>lineups[r.i]&&matches(lineups[r.i],P,script)&&Number.isFinite(r.train&&r.train[c.metric]));
  rows.sort((a,b)=>b.train[c.metric]-a.train[c.metric]||lineups[b.i].proj-lineups[a.i].proj||a.i-b.i);
  if(!rows.length)return {...c,unavailable:'No candidate matches this game plan.'};
  const best=rows[0],next=rows[1],v=best.validation,ci=v.ci[c.metric],nci=next&&next.validation.ci[c.metric];
  return {...c,i:best.i,training:best.train[c.metric],value:v[c.metric],ci,validation:v,dupes:best.dupes,dupeCI:best.dupeCI,runnerUp:next&&next.i,overlap:!!(ci&&nci&&ci[0]<=nci[1]&&nci[0]<=ci[1]),meta:result.meta};
 });
}
const api={config,defaults,profiles,traits,matches,story,select};if(typeof module!=='undefined')module.exports=api;root.DDLabContests=api;
})(typeof self!=='undefined'?self:globalThis);
