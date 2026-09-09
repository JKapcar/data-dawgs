/* Last Dawg Standing weekly decision engine. Pure, deterministic and shared by browser/receipts. */
(function(root){
'use strict';
const VERSION='guillotine-weekly-v1';
const POS={QB:['QB'],RB:['RB'],WR:['WR'],TE:['TE'],FLEX:['RB','WR','TE'],SUPER_FLEX:['QB','RB','WR','TE'],WRRB_FLEX:['WR','RB'],REC_FLEX:['WR','TE']};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function score(stats,scoring){if(!stats||typeof stats!=='object')return null;let n=0;for(const [k,w] of Object.entries(scoring)){if(!Number.isFinite(w))throw Error('Invalid scoring weight');const v=stats[k];if(v!=null&&!Number.isFinite(v))throw Error('Invalid player stat '+k);n+=(v??0)*w;}return n;}
function rng(seed){let a=seed>>>0;return ()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
function hash(s){let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
function normals(n,seed){const r=rng(seed),a=new Float64Array(n);for(let i=0;i<n;i+=2){const z=Math.sqrt(-2*Math.log(Math.max(1e-12,r()))),t=2*Math.PI*r();a[i]=z*Math.cos(t);if(i+1<n)a[i+1]=z*Math.sin(t);}return a;}
function quantile(a,p){const b=Array.from(a).sort((x,y)=>x-y);return b[Math.floor((b.length-1)*p)]??null;}
function slots(league){const s=league.roster_positions.filter(x=>!['BN','IR'].includes(x));for(const p of s)if(!POS[p])throw Error('Unsupported starting slot '+p);return s;}
function makePlayers(feed,league,now=Date.now()){
 const C=feed.calibration;if(!C||!Array.isArray(feed.players))throw Error('Missing weekly player inputs');if(JSON.stringify(Object.entries(C.scoring).sort())!==JSON.stringify(Object.entries(league.scoring_settings).filter(([k,v])=>v!==0&&!/^(def_|pts_allow|fg|xp|st_|sack$|int$|ff$|fum_rec$|safe$|blk_kick$)/.test(k)).sort()))throw Error('Scoring changed: refresh the calibration for this league before using odds');
 const out={};for(const row of feed.players){const mu=score(row.stats,league.scoring_settings),pos=row.position;if(!POS.SUPER_FLEX.includes(pos)||mu===null||row.has_projection===false)continue;const bucket=C.buckets[pos+':'+(mu>=15?'high':mu>=7?'mid':'low')]||C.buckets[pos];if(!bucket)throw Error('Missing uncertainty for '+pos);
 const unavailable=['Out','IR','PUP','Suspended','Inactive'].some(x=>x.toLowerCase()===String(row.injury||'').toLowerCase())||!row.opponent;
 out[row.id]={...row,mean:unavailable?0:mu,sd:unavailable?0:bucket.sd,uncertaintyN:bucket.n,unavailable,started:Number.isFinite(Date.parse(row.kickoff))&&Date.parse(row.kickoff)<=now};}
 return out;
}
function eligible(p,slot){return p&&(p.positions||[p.position]).some(x=>POS[slot].includes(x));}
function enumerate(ids,slotList,players,locked={},limit=30000){
 let candidates=[],truncated=false,used=new Set(),line=[];
 function visit(k){if(candidates.length>=limit){truncated=true;return;}if(k===slotList.length){candidates.push(line.slice());return;}
 const options=locked[k]?[locked[k]]:ids.filter(id=>players[id]&&!players[id].unavailable&&eligible(players[id],slotList[k])&&!players[id].started);
 for(const id of options){if(used.has(id)||!eligible(players[id],slotList[k]))continue;
 // Identical adjacent slots are unordered unless either slot is locked.
 if(k&&slotList[k]===slotList[k-1]&&!locked[k]&&!locked[k-1]&&id<line[k-1])continue;
 used.add(id);line.push(id);visit(k+1);line.pop();used.delete(id);}
 }
 visit(0);return {candidates,truncated};
}
function lockedSlots(roster,players){const l={};(roster.starters||[]).forEach((id,i)=>{if(players[id]?.started)l[i]=id;});return l;}
function meanLineup(roster,slotList,players){const e=enumerate(roster.players||[],slotList,players,lockedSlots(roster,players));let best=null,mean=-Infinity;for(const ids of e.candidates){const m=ids.reduce((s,id)=>s+players[id].mean,0);if(m>mean){mean=m;best=ids;}}return {ids:best,mean,truncated:e.truncated,count:e.candidates.length};}
// Maximum expected points with explicit empty slots; used only when a full lineup is impossible.
function partialLineup(roster,slotList,players){
 const locks=lockedSlots(roster,players),start=Array(slotList.length).fill('0');let mask=0,mean=0;
 for(const [k,id] of Object.entries(locks)){start[k]=id;mask|=1<<Number(k);mean+=players[id].mean;}
 let dp=new Map([[mask,{ids:start,mean}]]),lockedIds=new Set(Object.values(locks));
 for(const id of roster.players||[]){const p=players[id];if(!p||p.unavailable||p.started||lockedIds.has(id))continue;
  for(const [m,v] of Array.from(dp))for(let k=0;k<slotList.length;k++)if(!(m&(1<<k))&&eligible(p,slotList[k])){
   const next=m|(1<<k),value=v.mean+p.mean;if(!dp.has(next)||value>dp.get(next).mean){const ids=v.ids.slice();ids[k]=id;dp.set(next,{ids,mean:value});}
  }
 }
 return Array.from(dp.values()).sort((a,b)=>b.mean-a.mean||a.ids.filter(x=>x==='0').length-b.ids.filter(x=>x==='0').length)[0];
}
function samples(players,n,seed,rho=0){const out={},teams={};for(const p of Object.values(players)){if(!teams[p.team])teams[p.team]=normals(n,hash(seed+':team:'+p.team));const z=normals(n,hash(seed+':'+p.id)),a=new Float64Array(n);for(let i=0;i<n;i++)a[i]=p.mean+p.sd*(Math.sqrt(rho)*teams[p.team][i]+Math.sqrt(1-rho)*z[i]);out[p.id]=a;}return out;}
function total(ids,draws,n){const t=new Float64Array(n);for(const id of ids||[]){if(id==='0')continue;if(!draws[id])throw Error('Missing weekly projection for starter '+id);for(let i=0;i<n;i++)t[i]+=draws[id][i];}return t;}
function tieLoser(rosters,indexes,week){if(indexes.length===1)return indexes[0];if(week===1){let best=Infinity,who=null;for(const i of indexes){const v=rosters[i].settings?.draft_position;if(!Number.isFinite(v))return null;if(v<best){best=v;who=i;}else if(v===best)who=null;}return who;}let low=Infinity,who=null;for(const i of indexes){const s=rosters[i].settings||{},v=(s.fpts??0)+(s.fpts_decimal??0)/100;if(v<low){low=v;who=i;}else if(v===low)who=null;}return who;}
function board(rosters,players,league,options={}){const n=options.n||3000,draws=samples(players,n,options.seed||VERSION+league.league_id,options.rho??0),active=rosters.filter(r=>!options.excluded?.includes(String(r.roster_id)));if(active.length<2)throw Error('At least two surviving teams are needed');const ss=slots(league),totals=active.map(r=>{if((r.starters||[]).length!==ss.length)throw Error('Starter slots are incomplete for roster '+r.roster_id);return total(r.starters,draws,n);}),loss=new Array(active.length).fill(0),mins=new Float64Array(n);
 for(let k=0;k<n;k++){let lo=Infinity,idx=[];totals.forEach((t,i)=>{const x=Math.round(t[k]*100);if(x<lo){lo=x;idx=[i];}else if(x===lo)idx.push(i);});mins[k]=lo/100;const who=tieLoser(active,idx,options.week||1);if(who==null)for(const i of idx)loss[i]+=1/idx.length;else loss[who]++;}
 const rows=active.map((r,i)=>({rid:r.roster_id,mean:Array.from(totals[i]).reduce((a,b)=>a+b,0)/n,lo:quantile(totals[i],.1),hi:quantile(totals[i],.9),risk:loss[i]/n,survival:1-loss[i]/n})).sort((a,b)=>a.risk-b.risk);
 return {rows,chop:quantile(mins,.5),lo:quantile(mins,.1),hi:quantile(mins,.9),draws,totals,active,n,week:options.week||1};}
function evaluate(ids,B,rid){const ix=B.active.findIndex(r=>String(r.roster_id)===String(rid));if(ix<0)throw Error('Focus team is not active');const t=total(ids,B.draws,B.n);B.thresholds=B.thresholds||{};let threshold=B.thresholds[ix];if(!threshold){threshold=new Float64Array(B.n);threshold.fill(Infinity);for(let j=0;j<B.totals.length;j++)if(j!==ix)for(let k=0;k<B.n;k++)threshold[k]=Math.min(threshold[k],Math.round(B.totals[j][k]*100));B.thresholds[ix]=threshold;}let wins=0;for(let k=0;k<B.n;k++){const mine=Math.round(t[k]*100),lo=threshold[k];if(mine>lo)wins++;else if(mine===lo){const ties=[ix];for(let j=0;j<B.totals.length;j++)if(j!==ix&&Math.round(B.totals[j][k]*100)===lo)ties.push(j);const loser=tieLoser(B.active,ties,B.week);wins+=loser==null?1-1/ties.length:loser===ix?0:1;}}return {survival:wins/B.n,mean:ids.reduce((s,id)=>s+(B.players?.[id]?.mean||0),0)};}
function optimize(roster,players,league,B){B.players=players;const e=enumerate(roster.players,slots(league),players,lockedSlots(roster,players));let best=null;const incomplete=e.candidates.length===0;if(incomplete)e.candidates.push(partialLineup(roster,slots(league),players).ids);for(const ids of e.candidates){const v=evaluate(ids,B,roster.roster_id);if(!best||v.survival>best.survival||v.survival===best.survival&&v.mean>best.mean)best={ids,...v};}return {best,tested:e.candidates.length,truncated:e.truncated,incomplete};}
function budget(r,league){return Math.max(0,(league.settings.waiver_budget||0)-(r.settings?.waiver_budget_used||0));}
function waiver(roster,rosters,players,league,B,transactions,capFraction=.15){const owned=new Set(rosters.flatMap(r=>r.players||[])),base=optimize(roster,players,league,B),candidates=Object.values(players).filter(p=>!owned.has(p.id)&&!p.unavailable&&!p.started&&p.mean>0).sort((a,b)=>b.mean-a.mean),left=budget(roster,league),cap=Math.floor(left*capFraction),rows=[];
 if(!base.best)return {rows:[],base,left,cap,error:'No complete legal lineup is available'};
 // Screen every free agent by its best expected-points lineup, then simulate the top 40.
 const screen=[];for(const p of candidates){const extended={...roster,players:roster.players.concat(p.id)};let quick=meanLineup(extended,slots(league),players);if(!quick.ids)quick=partialLineup(extended,slots(league),players);if(quick.ids?.includes(p.id))screen.push({p,extended,quick});}screen.sort((a,b)=>b.quick.mean-a.quick.mean);
 for(const {p,extended} of screen.slice(0,40)){const result=optimize(extended,players,league,B);if(!result.best?.ids.includes(p.id))continue;
 const unused=roster.players.filter(id=>!result.best.ids.includes(id)&&!players[id]?.started).sort((a,b)=>(players[a]?.mean??0)-(players[b]?.mean??0));if(!unused.length)continue;const delta=result.best.survival-base.best.survival;if(delta<=0)continue;
 let competitors=0,maxRival=0;for(const r of B.active){if(r.roster_id===roster.roster_id)continue;const a=meanLineup(r,slots(league),players),b=meanLineup({...r,players:r.players.concat(p.id)},slots(league),players);if(b.ids?.includes(p.id)&&b.mean>(a.mean||0)+.25){competitors++;maxRival=Math.max(maxRival,budget(r,league));}}
 const bids=transactions.filter(t=>t.type==='waiver'&&t.status==='complete'&&t.settings?.waiver_bid!=null&&Object.keys(t.adds||{}).some(id=>players[id]?.position===p.position)).map(t=>Number(t.settings.waiver_bid)).filter(Number.isFinite).sort((a,b)=>a-b);
 const cost=bids.length>=5?[quantile(bids,.25),quantile(bids,.75)]:null;
 const valueCap=Math.min(cap,Math.round(cap*clamp(delta/Math.max(.01,1-base.best.survival),0,1)));const suggested=cost?Math.min(valueCap,Math.ceil(cost[1])+1):null;
 rows.push({id:p.id,drop:unused[0],mean:p.mean,delta,survival:result.best.survival,competitors,maxRival,cost,bidN:bids.length,valueCap,suggested,lineup:result.best.ids});}
 rows.sort((a,b)=>b.delta-a.delta);return {rows:rows.slice(0,15),base,left,cap,reserve:left-cap,screened:screen.length,evaluated:Math.min(screen.length,40),fraction:capFraction};}
return root.GXEngine={VERSION,score,slots,makePlayers,enumerate,meanLineup,partialLineup,samples,total,board,optimize,evaluate,waiver,budget,quantile,tieLoser,hash};
})(typeof self!=='undefined'?self:globalThis);
if(typeof module!=='undefined')module.exports=globalThis.GXEngine;
