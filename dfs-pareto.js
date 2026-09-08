/* Candidate exploration: the nondominated frontier of tested lineups, not a proof
   over all possible lineups. Ownership products are independence proxies. */
(function(root){
'use strict';
function ownership(p,cpt,sd){
 const n=sd?(cpt?p.cptOwn:(p.flexOwn!=null?p.flexOwn:(p.cptOwn!=null?p.own-p.cptOwn:null))):p.own;
 return Number.isFinite(n)&&n>0&&n<=100?n/100:null;
}
function point(l,P,sd,i){let x=0;for(const id of l.ids){const o=ownership(P[id],id===l.cpt,sd);if(o==null)return null;x+=Math.log10(o);}return {i,x,y:l.proj,l};}
function frontier(points){let best=-Infinity;return points.slice().sort((a,b)=>a.x-b.x||b.y-a.y).filter(p=>{if(p.y>best+1e-9){best=p.y;return true;}return false;});}
function legal(ids,cpt,P,c){
 const sd=c.site==='dk_showdown';if(ids.length!==(sd?6:9)||new Set(ids).size!==ids.length)return false;
 if(P.some((p,i)=>p.lock&&!ids.includes(i)))return false;
 if(ids.some(i=>P[i].excl||!(P[i].proj>0)))return false;
 const sal=ids.reduce((s,i)=>s+(i===cpt?(P[i].cptSal||P[i].sal*1.5):P[i].sal),0);
 if(sal<(c.minSalary||0)||sal>Math.min(c.maxSalary||50000,50000))return false;
 const teams={},games={},pos={};for(const i of ids){const p=P[i];teams[p.team]=(teams[p.team]||0)+1;games[p.gid]=(games[p.gid]||0)+1;pos[p.pos]=(pos[p.pos]||0)+1;}
 if(Object.keys(teams).length<2||Object.values(teams).some(n=>n>(c.maxPerTeam||99)))return false;
 if(sd)return ids.includes(cpt)&&Object.keys(teams).length===2;
 if(Object.keys(games).length<2||Object.values(games).some(n=>n>(c.maxPerGame||99)))return false;
 if(pos.QB!==1||pos.DST!==1||!(pos.RB>=2&&pos.WR>=3&&pos.TE>=1)||((pos.RB||0)+(pos.WR||0)+(pos.TE||0)!==7))return false;
 const q=ids.find(i=>P[i].pos==='QB'),st=c.stack||{};
 if(ids.filter(i=>i!==q&&P[i].team===P[q].team&&(st.qbPos||['WR','TE']).includes(P[i].pos)).length<(st.qbMin||0))return false;
 if(ids.filter(i=>P[i].team===P[q].opp&&P[i].pos!=='DST').length<(st.bringBack||0))return false;
 const dst=ids.find(i=>P[i].pos==='DST');
 if(st.noRbVsDst&&ids.some(i=>P[i].pos==='RB'&&P[i].opp===P[dst].team))return false;
 if(st.noOppDst&&ids.some(i=>i!==dst&&P[i].opp===P[dst].team))return false;
 return true;
}
function generate(P,c,progress){
 const sd=c.site==='dk_showdown',target=Math.min(25000,Math.max(1,c.count||5000)),deadline=Date.now()+(c.timeLimitMs||20000);
 let seed=c.seed||216;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/4294967296;};
 const pool=P.map((p,i)=>i).filter(i=>!P[i].excl&&P[i].proj>0&&P[i].sal>0&&(sd||P[i].pos!=='K'));
 const result=[],seen=new Set();let trials=0,accepted=0;const enumerating=sd&&pool.length<=18;
 const add=(ids,cpt)=>{if(!legal(ids,cpt,P,c))return;const key=ids.slice().sort((a,b)=>a-b).join(',')+'|'+cpt;if(seen.has(key))return;seen.add(key);accepted++;const lineup={ids:ids.slice(),cpt, sal:ids.reduce((s,i)=>s+(i===cpt?(P[i].cptSal||P[i].sal*1.5):P[i].sal),0),proj:ids.reduce((s,i)=>s+(i===cpt?P[i].proj*1.5:P[i].proj),0)};if(result.length<target)result.push(lineup);else if(enumerating){const j=Math.floor(rand()*accepted);if(j<target)result[j]=lineup;}};
 // Small Showdown pools can be enumerated exactly; retain distinct captain choices.
 if(enumerating){const choose=(a,from)=>{if(Date.now()>deadline)return;if(a.length===6){for(const i of a){add(a,i);}return;}for(let j=from;j<pool.length;j++)choose(a.concat(pool[j]),j+1);};choose([],0);return {lineups:result,trials:seen.size,capped:Date.now()>deadline};}
 while(result.length<target&&trials<2000000&&Date.now()<deadline){trials++;const ids=[],mode=trials%4;
 const select=(allowed)=>{const a=pool.filter(i=>!ids.includes(i)&&allowed(P[i]));if(!a.length)return -1;const weights=a.map(i=>mode===0?1:mode===1?Math.pow(P[i].proj,2):mode===2?1/Math.sqrt(Math.max(0.1,P[i].own||0.1)):Math.pow(P[i].proj/P[i].sal*1000,2));let n=rand()*weights.reduce((a,b)=>a+b,0);for(let j=0;j<a.length;j++){n-=weights[j];if(n<=0)return a[j];}return a[a.length-1];};
 for(const i of pool)if(P[i].lock)ids.push(i);
 let cpt;
 if(sd){while(ids.length<6){const i=select(()=>true);if(i<0)break;ids.push(i);}cpt=ids[Math.floor(rand()*ids.length)];}
 else{for(const [pos,n] of [['QB',1],['RB',2],['WR',3],['TE',1],['DST',1]])while(ids.filter(i=>P[i].pos===pos).length<n){const i=select(p=>p.pos===pos);if(i<0)break;ids.push(i);}if(ids.length===8){const i=select(p=>['RB','WR','TE'].includes(p.pos));if(i>=0)ids.push(i);}}
 add(ids,cpt);if(trials%10000===0&&progress)progress(result.length,target);
 }
 return {lineups:result,trials,capped:result.length<target};
}
const api={ownership,point,frontier,legal,generate};if(typeof module!=='undefined')module.exports=api;root.DDPareto=api;
if(typeof document==='undefined'&&typeof postMessage==='function')root.onmessage=e=>{try{postMessage({type:'done',result:generate(e.data.players,e.data.cfg,(n,t)=>postMessage({type:'progress',n,t}))});}catch(e){postMessage({type:'error',message:e.message});}};
})(typeof self!=='undefined'?self:globalThis);
