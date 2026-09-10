/* Lineup Lab worker — projection vs ownership-product exploration.
   Showdown: EXACT enumeration of every legal (6 players × captain) lineup with salary
   pruning, then the exact Pareto frontier, a frontier band, and a stratified cloud
   sample. Classic: importance-weighted sampling (enumeration is infeasible).
   Ownership product is an independence proxy for duplication, not a probability:
   CPT slot uses captain ownership, FLEX uses total-minus-captain, both floored at
   OWN_FLOOR. Missing ownership is separately flagged by the input audit. */
(function(root){
'use strict';
var audit=typeof module!=='undefined'?require('./dfs-lab-audit.js'):root.DDLabAudit;
if(!audit&&typeof importScripts==='function'){importScripts('dfs-lab-audit.js?v=20260910-hygiene');audit=root.DDLabAudit;}
var OWN_FLOOR=audit.config.ownershipFloor;
var DEAD_PROJ=1.5; // diagnostic only; low positive projections stay eligible
function slotOwn(p,isCpt,sd,floor){return audit.ownership(p,isCpt,sd,floor||OWN_FLOOR);}
/* Back-compat: ownership(p,cpt,sd) returns a floored fraction (never null). */
function ownership(p,cpt,sd){return slotOwn(p,cpt,sd);}
function point(l,P,sd,i){
 
 var x=0;for(var k=0;k<l.ids.length;k++){var id=l.ids[k];x+=Math.log10(slotOwn(P[id],id===l.cpt,sd));}
 return {i:i,x:x,y:l.proj,l:l};
}
function frontier(points){var best=-Infinity;return points.slice().sort(function(a,b){return a.x-b.x||b.y-a.y;}).filter(function(p){if(p.y>best+1e-9){best=p.y;return true;}return false;});}
function cptSalOf(p){return p.cptSal||Math.round(p.sal*1.5);}
function cptProjOf(p){return Number.isFinite(p.cptProj)?p.cptProj:p.proj*1.5;}
function legal(ids,cpt,P,c){
 var sd=c.site==='dk_showdown';if(ids.length!==(sd?6:9)||new Set(ids).size!==ids.length)return false;
 if(P.some(function(p,i){return p.lock&&ids.indexOf(i)<0;}))return false;
 if(ids.some(function(i){return P[i].excl||!(P[i].proj>0);}))return false;
 var sal=ids.reduce(function(s,i){return s+(i===cpt?cptSalOf(P[i]):P[i].sal);},0);
 if(sal<(c.minSalary||0)||sal>Math.min(c.maxSalary||50000,50000))return false;
 var teams={},games={},pos={};for(var k=0;k<ids.length;k++){var p=P[ids[k]];teams[p.team]=(teams[p.team]||0)+1;games[p.gid]=(games[p.gid]||0)+1;pos[p.pos]=(pos[p.pos]||0)+1;}
 var tv=Object.keys(teams).map(function(t){return teams[t];});
 if(Object.keys(teams).length<2||tv.some(function(n){return n>(c.maxPerTeam||99);}))return false;
 if(sd)return ids.indexOf(cpt)>=0&&Object.keys(teams).length===2;
 if(Object.keys(games).length<2||Object.keys(games).some(function(g){return games[g]>(c.maxPerGame||99);}))return false;
 if(pos.QB!==1||pos.DST!==1||!(pos.RB>=2&&pos.WR>=3&&pos.TE>=1)||((pos.RB||0)+(pos.WR||0)+(pos.TE||0)!==7))return false;
 var q=ids.filter(function(i){return P[i].pos==='QB';})[0],st=c.stack||{};
 if(ids.filter(function(i){return i!==q&&P[i].team===P[q].team&&(st.qbPos||['WR','TE']).indexOf(P[i].pos)>=0;}).length<(st.qbMin||0))return false;
 if(ids.filter(function(i){return P[i].team===P[q].opp&&P[i].pos!=='DST';}).length<(st.bringBack||0))return false;
 var dst=ids.filter(function(i){return P[i].pos==='DST';})[0];
 if(st.noRbVsDst&&ids.some(function(i){return P[i].pos==='RB'&&P[i].opp===P[dst].team;}))return false;
 if(st.noOppDst&&ids.some(function(i){return i!==dst&&P[i].opp===P[dst].team;}))return false;
 return true;
}
function describe(ids,cpt,P,sd,floor){
 var sal=0,proj=0,ceil=0,own=0,x=0,dead=0,teams={},k;
 for(k=0;k<ids.length;k++){var i=ids[k],p=P[i],isC=(i===cpt);
  sal+=isC?cptSalOf(p):p.sal;proj+=isC?cptProjOf(p):p.proj;
  var ce=Number.isFinite(p.ceil)?p.ceil:(p.proj*1.6);ceil+=isC?ce*1.5:ce;
  var o=slotOwn(p,isC,sd,floor);own+=o*100;x+=Math.log10(o);
  if(p.proj<DEAD_PROJ)dead++;teams[p.team]=(teams[p.team]||0)+1;}
 var tk=Object.keys(teams),split=tk.length===2?(teams[tk[0]]+'-'+teams[tk[1]]):tk.map(function(t){return teams[t];}).join('-');
 return {ids:ids.slice(),cpt:cpt,sal:sal,proj:+proj.toFixed(2),ceil:+ceil.toFixed(1),own:+own.toFixed(1),x:x,dead:dead,split:split};
}
/* ---------- exact showdown enumeration ---------- */
function enumerateShowdown(P,c,progress){
 var cap=Math.min(c.maxSalary||50000,50000),minSal=c.minSalary||0,maxTeam=c.maxPerTeam||99,deadline=Date.now()+(c.timeLimitMs||45000);
 var pool=[];for(var i=0;i<P.length;i++)if(!P[i].excl&&P[i].proj>0&&P[i].sal>0)pool.push(i);
 if(P.some(function(p){return p.lock&&(p.excl||!(p.proj>0)||!(p.sal>0));}))return {out:{proj:[]},combos:0,legalN:0,capped:false,pool:pool.length};
 var lockPos=[];pool.forEach(function(id,j){if(P[id].lock)lockPos.push(j);});
 pool.sort(function(a,b){return P[a].sal-P[b].sal;});
 lockPos=pool.map(function(id,j){return P[id].lock?j:-1;}).filter(function(j){return j>=0;});
 var n=pool.length,sal=pool.map(function(i){return P[i].sal;}),extra=pool.map(function(i){return cptSalOf(P[i])-P[i].sal;});
 var team=pool.map(function(i){return P[i].team;}),tlist=[];team.forEach(function(t){if(tlist.indexOf(t)<0)tlist.push(t);});
 var tcode=team.map(function(t){return tlist.indexOf(t);});
 var minExtra=extra.length?Math.min.apply(null,extra):0;
 var out={ids:[],cpt:[],sal:[],proj:[],x:[],own:[],ceil:[],dead:[],split:[]};
 var combos=0,legalN=0,stop=false,pick=new Array(6),tc=new Array(tlist.length);
 function rec(depth,from,s){
  if(stop)return;
  if(depth===6){
   combos++;
   if(combos%50000===0){if(Date.now()>deadline){stop=true;return;}if(progress)progress(legalN,combos);}
   var t,k;for(t=0;t<tlist.length;t++)tc[t]=0;
   for(k=0;k<6;k++)tc[tcode[pick[k]]]++;
   var nteams=0;for(t=0;t<tlist.length;t++){if(tc[t]>0)nteams++;if(tc[t]>maxTeam)return;}
   if(nteams!==2)return;
   for(k=0;k<lockPos.length;k++)if(pick.indexOf(lockPos[k])<0)return;
   for(k=0;k<6;k++){var tot=s+extra[pick[k]];if(tot>cap||tot<minSal)continue;
    var ids=[pool[pick[0]],pool[pick[1]],pool[pick[2]],pool[pick[3]],pool[pick[4]],pool[pick[5]]];
    var d=describe(ids,pool[pick[k]],P,true,c.ownershipFloor);
    out.ids.push(d.ids);out.cpt.push(d.cpt);out.sal.push(d.sal);out.proj.push(d.proj);out.x.push(d.x);out.own.push(d.own);out.ceil.push(d.ceil);out.dead.push(d.dead);out.split.push(d.split);legalN++;}
   return;}
  for(var j=from;j<n-(5-depth);j++){
   var ns=s+sal[j],need=5-depth,cheapest=0;for(var q=1;q<=need;q++)cheapest+=sal[j+q];
   if(ns+cheapest+minExtra>cap)break;      // sorted ascending → nothing further fits
   pick[depth]=j;rec(depth+1,j+1,ns);if(stop)return;}
 }
 rec(0,0,0);
 return {out:out,combos:combos,legalN:legalN,capped:stop,pool:pool.length};
}
function packFrontier(out,c){
 var n=out.proj.length,i,order=Array.from({length:n},function(_,i){return i;});
 // Compare actual values: packed numeric keys lose index precision and round ownership.
 order.sort(function(a,b){return out.x[a]-out.x[b]||out.proj[b]-out.proj[a];});
 var band=Math.max(0,c.bandPts==null?3:+c.bandPts),front=[],inBand=[],best=-Infinity;
 for(i=0;i<n;i++){var idx=order[i],y=out.proj[idx];
  if(y>best+1e-9){best=y;front.push(idx);}
  if(y>=best-band)inBand.push(idx);}
 return {front:front,band:inBand};
}
function generateShowdown(P,c,progress){
 var e=enumerateShowdown(P,c,progress),out=e.out,n=out.proj.length;
 if(!n)return {lineups:[],trials:e.combos,capped:e.capped,stats:{legal:0,pool:e.pool,combos:e.combos,frontier:0,band:0,exact:!e.capped}};
 var f=packFrontier(out,c),maxBand=Math.max(50,c.maxBand||1500),cloudN=Math.max(0,c.cloud==null?3000:c.cloud),band=f.band;
 var fset={};f.front.forEach(function(i){fset[i]=1;});
 if(band.length>maxBand)band=band.filter(function(i){return !fset[i];}).sort(function(a,b){return out.proj[b]-out.proj[a];}).slice(0,Math.max(0,maxBand-f.front.length)).concat(f.front);
 var chosen={},list=[];function add(i,tag){if(chosen[i])return;chosen[i]=1;list.push(i);}
 f.front.forEach(function(i){add(i);});band.forEach(function(i){add(i);});
 var seed=c.seed||216;var rand=function(){seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/4294967296;};
 if(cloudN>0){var res=[];for(var i=0;i<n;i++){if(res.length<cloudN)res.push(i);else{var j=Math.floor(rand()*(i+1));if(j<cloudN)res[j]=i;}}res.forEach(function(i){add(i);});}
 var bset={};f.band.forEach(function(i){bset[i]=1;});
 var lineups=list.map(function(i){return {ids:out.ids[i],cpt:out.cpt[i],sal:out.sal[i],proj:out.proj[i],x:out.x[i],own:out.own[i],ceil:out.ceil[i],dead:out.dead[i],split:out.split[i],onFrontier:!!fset[i],inBand:!!bset[i]};});
 lineups.sort(function(a,b){return b.proj-a.proj;});
 return {lineups:lineups,trials:e.combos,capped:e.capped,stats:{legal:n,pool:e.pool,combos:e.combos,frontier:f.front.length,band:f.band.length,bandKept:band.length,cloud:cloudN,exact:!e.capped,ownFloor:OWN_FLOOR*100,deadProj:DEAD_PROJ}};
}
/* ---------- classic: importance-weighted sampling (floored ownership) ---------- */
function generateClassic(P,c,progress){
 var target=Math.min(25000,Math.max(1,c.count||5000)),deadline=Date.now()+(c.timeLimitMs||20000);
 var seed=c.seed||216;var rand=function(){seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/4294967296;};
 var pool=P.map(function(p,i){return i;}).filter(function(i){return !P[i].excl&&P[i].proj>0&&P[i].sal>0&&P[i].pos!=='K';});
 var result=[],seen={},trials=0;
 var add=function(ids){if(!legal(ids,undefined,P,c))return;var key=ids.slice().sort(function(a,b){return a-b;}).join(',');if(seen[key])return;seen[key]=1;result.push(describe(ids,undefined,P,false,c.ownershipFloor));};
 while(result.length<target&&trials<2000000&&Date.now()<deadline){trials++;var ids=[],mode=trials%4;
  var select=function(allowed){var a=pool.filter(function(i){return ids.indexOf(i)<0&&allowed(P[i]);});if(!a.length)return -1;var weights=a.map(function(i){return mode===0?1:mode===1?Math.pow(P[i].proj,2):mode===2?1/Math.sqrt(Math.max(0.1,P[i].own||0.1)):Math.pow(P[i].proj/P[i].sal*1000,2);});var tot=0;for(var w=0;w<weights.length;w++)tot+=weights[w];var r=rand()*tot;for(var j=0;j<a.length;j++){r-=weights[j];if(r<=0)return a[j];}return a[a.length-1];};
  pool.forEach(function(i){if(P[i].lock)ids.push(i);});
  [['QB',1],['RB',2],['WR',3],['TE',1],['DST',1]].forEach(function(pr){while(ids.filter(function(i){return P[i].pos===pr[0];}).length<pr[1]){var i=select(function(p){return p.pos===pr[0];});if(i<0)break;ids.push(i);}});
  if(ids.length===8){var fi=select(function(p){return ['RB','WR','TE'].indexOf(p.pos)>=0;});if(fi>=0)ids.push(fi);}
  add(ids);if(trials%10000===0&&progress)progress(result.length,target);}
 var pts=result.map(function(l,i){return point(l,P,false,i);}),fr=frontier(pts),fs={};fr.forEach(function(p){fs[p.i]=1;});
 result.forEach(function(l,i){l.onFrontier=!!fs[i];l.inBand=false;});
 return {lineups:result,trials:trials,capped:result.length<target,stats:{legal:result.length,frontier:fr.length,exact:false,ownFloor:OWN_FLOOR*100,deadProj:DEAD_PROJ}};
}
function generate(P,c,progress){return c.site==='dk_showdown'?generateShowdown(P,c,progress):generateClassic(P,c,progress);}
var api={ownership:ownership,slotOwn:slotOwn,point:point,frontier:frontier,legal:legal,generate:generate,describe:describe,OWN_FLOOR:OWN_FLOOR,DEAD_PROJ:DEAD_PROJ};
if(typeof module!=='undefined')module.exports=api;root.DDPareto=api;
if(typeof document==='undefined'&&typeof postMessage==='function')root.onmessage=function(e){try{var result=generate(e.data.players,e.data.cfg,function(n,t){postMessage({type:'progress',n:n,t:t});});result.audit=audit.reconcile(e.data.players,e.data.cfg,result);postMessage({type:'done',result:result});}catch(err){postMessage({type:'error',message:err.message});}};
})(typeof self!=='undefined'?self:globalThis);
