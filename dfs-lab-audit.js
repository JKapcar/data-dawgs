/* Lineup Lab input checks. Pure functions; separate search from dfs-pareto's
   six-player-set enumeration. A PASS concerns this loaded snapshot and rules,
   never an unavailable CSV or the provider's latest projections. */
(function(root){
'use strict';
const config={ownershipFloor:0.0025,coreDropN:1,logDominanceCap:0.50,stalenessHours:6};
function rawOwn(p,captain,showdown){
 if(!p)return null;
 if(!showdown)return Number.isFinite(p.own)?p.own/100:null;
 if(captain)return Number.isFinite(p.cptOwn)?p.cptOwn/100:null;
 if(Number.isFinite(p.flexOwn))return p.flexOwn/100;
 return Number.isFinite(p.own)&&Number.isFinite(p.cptOwn)?(p.own-p.cptOwn)/100:null;
}
function ownership(p,captain,showdown,floor=config.ownershipFloor){
 const raw=rawOwn(p,captain,showdown);return Math.max(floor,raw==null?0:Math.min(1,raw));
}
function evidence(lineup,players,showdown,floor=config.ownershipFloor){
 const slots=lineup.ids.map(id=>({id,raw:rawOwn(players[id],id===lineup.cpt,showdown),used:ownership(players[id],id===lineup.cpt,showdown,floor)}));
 const log=slots.reduce((s,p)=>s+Math.log10(p.used),0);
 slots.forEach(p=>{p.logShare=log<0?Math.log10(p.used)/log:0;p.floored=p.raw!=null&&p.raw<floor;});
 const sorted=slots.slice().sort((a,b)=>b.used-a.used);
 return {slots,product:Math.pow(10,log),log,coreProduct:sorted.slice(0,Math.max(1,slots.length-config.coreDropN)).reduce((s,p)=>s*p.used,1),maxLogShare:Math.max(...slots.map(p=>p.logShare))};
}
function inspect(players,showdown){
 const active=players.map((p,id)=>({p,id})).filter(({p})=>!p.excl&&p.proj>0&&p.sal>0);
 const errors=[],floored=[];
 active.forEach(({p,id})=>{
  for(const captain of showdown?[false,true]:[false]){
   const v=rawOwn(p,captain,showdown),slot=captain?'CPT':'FLEX';
   if(v==null||v<0||v>1)errors.push({id,slot,reason:v==null?'missing ownership':'invalid ownership'});
   else if(v<config.ownershipFloor)floored.push({id,slot,raw:v});
  }
  if(!p.team)errors.push({id,reason:'missing team'});
 });
 return {playerCount:players.length,active:active.length,errors,floored,pass:errors.length===0};
}
function optimum(players,cfg){
 if(cfg.site!=='dk_showdown')return {status:'UNAVAILABLE',reason:'Independent maximum check currently supports Showdown.'};
 const cap=Math.min(50000,cfg.maxSalary||50000),floor=cfg.minSalary||0,maxTeam=cfg.maxPerTeam||5;
 const locks=players.map((p,i)=>p.lock?i:-1).filter(i=>i>=0);
 const pool=players.map((p,i)=>i).filter(i=>!players[i].excl&&players[i].proj>0&&players[i].sal>0);
 if(locks.some(i=>!pool.includes(i))||locks.length>6)return {status:'INFEASIBLE'};
 const deadline=Date.now()+(cfg.auditTimeLimitMs||10000);let best=null,nodes=0,aborted=false;
 for(const cpt of pool){
  if(Date.now()>deadline){aborted=true;break;}
  const p=players[cpt],cSal=Number.isFinite(p.cptSal)&&p.cptSal>0?p.cptSal:Math.round(p.sal*1.5),cProj=Number.isFinite(p.cptProj)?p.cptProj:p.proj*1.5;
  const flex=pool.filter(i=>i!==cpt).sort((a,b)=>players[b].proj-players[a].proj),picked=[cpt],teams=new Map([[p.team,1]]);
  function visit(from,need,salary,projection){
   if(aborted)return;
   if((++nodes&1023)===0&&Date.now()>deadline){aborted=true;return;}
   if(salary>cap||flex.length-from<need)return;
   if(!need){
    if(salary<floor||teams.size!==2||locks.some(i=>!picked.includes(i)))return;
    if(!best||projection>best.proj)best={ids:picked.slice(),cpt,sal:salary,proj:projection};
    return;
   }
   let upper=projection;for(let j=0;j<need;j++)upper+=players[flex[from+j]].proj;
   if(best&&upper<=best.proj+1e-10)return;
   for(let j=from;j<=flex.length-need;j++){
    const id=flex[j],q=players[id],ct=teams.get(q.team)||0;
    if(ct>=maxTeam||(!ct&&teams.size===2))continue;
    picked.push(id);teams.set(q.team,ct+1);visit(j+1,need-1,salary+q.sal,projection+q.proj);
    picked.pop();if(ct)teams.set(q.team,ct);else teams.delete(q.team);
   }
  }
  visit(0,5,cSal,cProj);if(aborted)break;
 }
 return {status:aborted?'INCOMPLETE':best?'COMPLETE':'INFEASIBLE',lineup:best,nodes};
}
function reconcile(players,cfg,result){
 const input=inspect(players,cfg.site==='dk_showdown'),proof=optimum(players,cfg);
 const displayed=result.lineups.length?Math.max(...result.lineups.map(l=>l.proj)):null;
 const maxPass=proof.status==='COMPLETE'&&Math.abs(proof.lineup.proj-displayed)<=0.0100001;
 const checks=result.lineups.length?[0,Math.floor(result.lineups.length/2),result.lineups.length-1].map(i=>{
  const l=result.lineups[i],e=evidence(l,players,cfg.site==='dk_showdown',cfg.ownershipFloor||config.ownershipFloor);
  return {i,pass:Math.abs(e.log-l.x)<1e-9&&e.slots.every(s=>s.used>0)};
 }):[];
 return {input,proof,displayed,maxStatus:proof.status==='COMPLETE'?(maxPass?'PASS':'FAIL'):proof.status,productPass:checks.length>0&&checks.every(c=>c.pass),checks,pass:input.pass&&maxPass&&checks.length>0&&checks.every(c=>c.pass)};
}
const api={config,rawOwn,ownership,evidence,inspect,optimum,reconcile};
if(typeof module!=='undefined')module.exports=api;root.DDLabAudit=api;
})(typeof self!=='undefined'?self:globalThis);
