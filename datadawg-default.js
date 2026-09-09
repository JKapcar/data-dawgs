/* Default season DataDawg$: supplied auction priors, standard format/depth conversion.
   No provider projection blend and no implied dynasty or one-week forecast. */
(function(root){
'use strict';
const POS=['QB','RB','WR','TE','K','DST'];
const eligible=(p,s)=>p===s||s==='FLEX'&&['RB','WR','TE'].includes(p)||s==='SUPERFLEX'&&['QB','RB','WR','TE'].includes(p)||s==='REC_FLEX'&&['WR','TE'].includes(p)||s==='WRRB_FLEX'&&['WR','RB'].includes(p);
function build(source,config){
 const n=Number(config.teams),rec=Number(config.ppr),slots=config.slots||{};
 if(!Number.isInteger(n)||n<2||n>32||!Number.isFinite(rec)||rec<0||rec>1)throw Error('Default values require 2–32 teams and reception scoring between 0 and 1.');
 const sf=!!slots.SUPERFLEX||Number(slots.QB)>1;
 // Source has no standard-scoring superflex column: preserve disclosed half-PPR prior.
 const basis=sf?(rec>=0.75?'sfFull':'sfHalf'):(rec<0.25?'std':rec>0.75?'full':'half');
 const baseSlots={QB:1,RB:2,WR:2,TE:1,FLEX:1,K:1,DST:1,...(sf?{SUPERFLEX:1}:{} )};
 const records=source.players.map(p=>({...p,value:Number(p.values[basis])}));
 if(records.some(p=>!Number.isFinite(p.value)||p.value<0))throw Error('Invalid default source values.');
 function demand(shape,teams){
  const used=new Set(),out={};
  const ordered=[...POS,...Object.keys(shape).filter(s=>!POS.includes(s)&&!['BN','IR','TAXI'].includes(s))];
  for(const slot of ordered){
   if(!POS.includes(slot)&&!['FLEX','SUPERFLEX','REC_FLEX','WRRB_FLEX'].includes(slot)&&shape[slot])throw Error('Unsupported starter slot: '+slot);
   const candidates=records.filter(p=>eligible(p.pos,slot)).sort((a,b)=>b.value-a.value||a.id.localeCompare(b.id));
   let remaining=(Number(shape[slot])||0)*teams;
   for(const p of candidates){if(!remaining)break;if(!used.has(p.id)){used.add(p.id);remaining--;}}
   if(remaining)throw Error('Source does not cover required '+slot+' starters.');
  }
  for(const pos of POS)out[pos]=Math.max(0,...records.filter(p=>p.pos===pos&&!used.has(p.id)).map(p=>p.value));
  return out;
 }
 const base=demand(baseSlots,12),target=demand(slots,n);
 const active=p=>Object.keys(slots).some(s=>!['BN','IR','TAXI'].includes(s)&&slots[s]>0&&eligible(p.pos,s));
 const count=n*Object.entries(slots).filter(([s])=>!['IR','TAXI'].includes(s)).reduce((a,[,v])=>a+Number(v),0);
 if(!Number.isInteger(count)||count<1)throw Error('Roster size unavailable.');
 const budget=Number(config.budget)>0?Number(config.budget):200;
 const floor=config.floor===0?0:1,totalCents=Math.round(n*budget*100);
 const ranked=records.filter(active).map(p=>({...p,weight:Math.max(0,p.value-1+0.5*(base[p.pos]-target[p.pos]))})).sort((a,b)=>b.weight-a.weight||b.value-a.value||a.id.localeCompare(b.id));
 if(ranked.length<count)throw Error('Source player coverage is smaller than the league roster capacity.');
 const paid=ranked.slice(0,count),reserve=count*floor*100,weight=paid.reduce((a,p)=>a+p.weight,0);
 if(totalCents<reserve||weight<=0)throw Error('Budget or positive source weights unavailable.');
 const rows=paid.map(p=>{const exact=floor*100+(totalCents-reserve)*p.weight/weight;return {p,cents:Math.floor(exact),fraction:exact-Math.floor(exact)};});
 let remainder=totalCents-rows.reduce((a,r)=>a+r.cents,0);
 for(const r of rows.slice().sort((a,b)=>b.fraction-a.fraction||a.p.id.localeCompare(b.p.id))){if(remainder--<=0)break;r.cents++;}
 const values=new Map(ranked.map(p=>[p.id,0]));rows.forEach(r=>values.set(r.p.id,r.cents/100));
 return {players:ranked.map(p=>({...p,target:values.get(p.id)})),meta:{model_id:'datadawg-default-season-v1',basis,as_of:source.received_at,source_published_at:source.published_at||null,source_sha256:source.sha256,horizon:'season',tier:'labs',graded:false,teams:n,budget_per_team:budget,budget_kind:config.budget>0?'reported auction budget':'nominal comparison scale',depth_pass_through:0.5,roster_slots:count,
 note:'Default DataDawg$: supplied ETR auction inputs; 50% of the change in positional replacement value; normalized across roster capacity. Received '+source.received_at+'; source publication date unavailable. Season comparison only, not weekly or dynasty values. Standard format approximation: custom scoring bonuses, keeper inflation and guillotine survival are not modeled.'+(sf&&rec!==0.5&&rec!==1?' Superflex uses nearest supplied PPR format.':!sf&&![0,0.5,1].includes(rec)?' Uses nearest supplied PPR format.':'')}};
}
root.DDDefault={build};
})(typeof module!=='undefined'?module.exports:window);
