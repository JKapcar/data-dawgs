/* Explicit conditional model for the session-private builder. No network/storage.
   Reuses historical tables and legal roster sampling, not legacy rank scaling. */
(function(root){'use strict';
const node=typeof module!=='undefined'&&module.exports;
const E=node?require('./work/dfs-engine.js').DDFS:root.DDFS;
const D=node?require('./dfs-diagnostics.js'):root.DDFSDiagnostics;
const F=node?require('./work/dfs-field-sim.js'):root.DDFSFieldSim;
const H=E.modelHelpers,VERSION='builder-conditional-v1',finite=Number.isFinite;
const need=(ok,text)=>{if(!ok)throw Error(text);},copy=x=>JSON.parse(JSON.stringify(x));
const pause=()=>new Promise(r=>setTimeout(r,0));
function aborted(signal){if(signal?.aborted)throw Object.assign(Error('Simulation cancelled.'),{name:'AbortError'});}
const zValues={'0.75':.6744897502,'0.85':1.0364333895,'0.9':1.2815515655,'0.95':1.644853627,'0.975':1.9599639845};
function margin(p,c){
 const log=c.distribution==='lognormal'&&!['DST','K'].includes(p.pos),mean=p.proj;
 need(!log||mean>=0,p.name+': negative projection needs the Gaussian model.');
 let sd,sigma=0,cv=null,basis;
 if(c.variance==='ceiling'){
  const z=zValues[String(c.ceilingQuantile)];need(z,'Choose the assumed ceiling percentile explicitly.');
  need(finite(p.ceil)&&p.ceil>mean,p.name+': ceiling must be supplied and above the mean.');
  if(log){need(mean>0,p.name+': lognormal ceiling fit needs a positive mean.');const discriminant=z*z-2*Math.log(p.ceil/mean);need(discriminant>=0,p.name+': mean/ceiling cannot fit this lognormal percentile; choose Gaussian or another explicit percentile.');sigma=z-Math.sqrt(discriminant);sd=mean*Math.sqrt(Math.expm1(sigma*sigma));}
  else sd=(p.ceil-mean)/z;
  basis='supplied ceiling interpreted as p'+Math.round(c.ceilingQuantile*100)+'; projection interpreted as mean';
 }else{
  if(c.variance==='historical'&&E.CORR.cv[p.pos]){cv=H.cvFor(p.pos,Math.max(0,mean));basis='nflverse position/mean CV bin (nearest bin outside range)';}
  else {cv=p.pos==='K'?c.kickerCV:c.customCV;basis=p.pos==='K'?'user-set kicker CV; no historical kicker table':'user-set position-neutral CV';}
  sd=Math.max(c.sdFloor,Math.abs(mean)*cv);
  if(log&&mean>0)sigma=Math.sqrt(Math.log1p((sd/mean)**2));
 }
 sd*=c.varianceScale;if(log&&mean>0)sigma=Math.sqrt(Math.log1p((sd/mean)**2));
 if(log&&mean===0){sd=0;sigma=0;basis+='; zero nonnegative mean is fixed at zero';}
 return {mean,sd,sigma,kind:log?'lognormal':'normal',basis,cv};
}
function ordered(pool,ids,cpt){
 const slots=D.rules[pool.site].slots.slice();if(pool.site==='dk_showdown')return {ids:[cpt,...ids.filter(id=>id!==cpt)],slots,cpt};
 const remaining=ids.slice(),orderedIds=slots.map(slot=>{if(slot==='FLEX')return null;const at=remaining.findIndex(id=>pool.players[id].pos===slot);need(at>=0,'Sampled roster cannot fill '+slot);return remaining.splice(at,1)[0];});
 need(remaining.length===1&&['RB','WR','TE'].includes(pool.players[remaining[0]].pos),'Sampled FLEX is invalid.');orderedIds[slots.indexOf('FLEX')]=remaining[0];return {ids:orderedIds,slots};
}
function validateRoster(pool,e){const titles=['Roster & eligibility','Salary','Showdown teams','Showdown matchup','Classic game count','Team / opponent mapping'];const bad=D.roster(pool,e).filter(x=>titles.includes(x.title)&&x.state!=='pass');need(!bad.length,bad.map(x=>x.title+': '+x.evidence).join('; '));}
function prepare(input){
 const {pool,roster,config:c}=input;need(pool&&D.rules[pool.site],'Load a confirmed DK NFL Classic or Showdown slate.');
 need(c?.acknowledged===true,'Confirm the displayed model assumptions and full eligible player pool.');
 need(['illustrative','supplied_contest'].includes(c.contestKind),'Confirm whether the contest counts are illustrative or supplied.');
 need(['lognormal','normal'].includes(c.distribution)&&['historical','ceiling','custom'].includes(c.variance),'Choose a distribution and variance model.');
 need(['historical','independent'].includes(c.correlation),'Choose the correlation model explicitly.');
 for(const [key,lo,hi]of [['customCV',.05,2],['kickerCV',.05,2],['sdFloor',0,20],['varianceScale',.25,3],['correlationScale',0,1],['ownershipFloor',0,5],['stackRate',0,1],['salaryFloor',0,50000]])need(finite(c[key])&&c[key]>=lo&&c[key]<=hi,'Invalid '+key+' assumption.');
 need(Number.isInteger(c.seed)&&c.seed>=0&&c.seed<=0xffffffff,'Seed must be an unsigned 32-bit integer (zero is allowed).');
 need(Number.isInteger(c.iterations)&&c.iterations>=200&&c.iterations<=5000,'Use 200–5,000 independent worlds.');
 need(Array.isArray(c.contests)&&c.contests.length>0&&c.contests.length<=3,'Select one to three contest profiles.');
 let work=0;for(const contest of c.contests){need(Number.isInteger(contest.fieldSize)&&contest.fieldSize>=2&&contest.fieldSize<=20000,'Each field must have 2–20,000 entries.');need(contest.paidPlaces==null||Number.isInteger(contest.paidPlaces)&&contest.paidPlaces>=0&&contest.paidPlaces<=contest.fieldSize,'Paid places must be blank or an integer from zero through field size.');work+=contest.fieldSize*c.iterations;}
 need(work<=F.LIMITS.work,'Full-field run exceeds 40 million entry-worlds. Reduce worlds or field sizes; ranks are never scaled from a smaller sample.');
 need(pool.players.length>0&&pool.players.length<=220,'Use 1–220 players.');
 const players=pool.players.map((p,id)=>({...p,uid:p.uid||('player-'+id),gid:D.game(p)})),sd=pool.site==='dk_showdown';
 for(const p of players){
  need(['QB','RB','WR','TE','DST',...(sd?['K']:[])].includes(p.pos),p.name+': simulation needs one supported DK position.');
  need(p.team&&p.opp&&p.gid,p.name+': explicit team/opponent mapping is missing.');
  need(finite(p.proj)&&Number.isInteger(p.sal)&&p.sal>0,p.name+': projection or salary missing.');
  for(const key of sd?['flexOwn','cptOwn']:['own'])need(finite(p[key])&&p[key]>=0&&p[key]<=100,p.name+': '+key+' is missing or invalid. Zero is known; unknown is not zero.');
  // Independent one-decimal rounding of base and CPT can differ by up to 0.125.
  // Preserve source projections for arithmetic; sample official 1.5x outcomes once.
  if(sd){need(Number.isInteger(p.cptSal)&&p.cptSal>0,p.name+': CPT salary missing.');if(finite(p.cptProj)&&Math.abs(p.cptProj-1.5*p.proj)>.15000001)need(c.ackCaptain===true,'CPT projections differ materially from 1.5× base (beyond rounding). Explicitly accept official 1.5× outcome scoring, or reconcile the source.');}
 }
 if(c.contestKind==='supplied_contest')need(pool.slate?.trim(),'Verify the slate identity before matching an actual contest.');
 const modelPool={...copy(pool),slate:pool.slate||'Exploratory pool — slate/date unverified',players};need(Array.isArray(roster)&&roster.length===D.rules[pool.site].slots.length&&roster.every(id=>Number.isInteger(id)&&players[id]),'Complete the candidate roster first.');
 const candidate={ids:roster.slice(),slots:D.rules[pool.site].slots.slice(),...(sd?{cpt:roster[0]}:{})};validateRoster(modelPool,candidate);
 // Validate reciprocal team mappings across the entire input pool, not just the candidate.
 const opponents=new Map();for(const p of players){need(!opponents.has(p.team)||opponents.get(p.team)===p.opp,'Conflicting opponents for '+p.team);opponents.set(p.team,p.opp);}for(const [team,opp]of opponents)need(!opponents.has(opp)||opponents.get(opp)===team,'Non-reciprocal matchup '+team+' / '+opp);
 if(sd)need(new Set(players.map(p=>p.gid)).size===1&&new Set(players.map(p=>p.team)).size===2,'Showdown needs exactly one confirmed two-team game.');
 const margins=players.map(p=>margin(p,c)),roles=H.assignRoles(players),games=new Map();players.forEach((p,i)=>{if(!games.has(p.gid))games.set(p.gid,[]);games.get(p.gid).push(i);});
 const correlations=[...games].map(([game,ids])=>{const n=ids.length,M=new Float64Array(n*n);for(let a=0;a<n;a++)for(let b=0;b<n;b++){const same=players[ids[a]].team===players[ids[b]].team;M[a*n+b]=a===b?1:c.correlation==='independent'?0:H.corrBetween(roles[ids[a]],roles[ids[b]],same,same&&roles[ids[a]]===roles[ids[b]])*c.correlationScale;}const chol=H.cholesky(M,n);need(!chol.failed,'Correlation matrix failed for '+game+'. Choose explicit independence or revise the model; no fallback was applied.');return {game,ids,n,L:chol.L,jitter:chol.jitter};});
 return {pool:modelPool,candidate,config:c,margins,roles,correlations};
}
function assess(input){try{const p=prepare(input);return {status:'ready',warnings:[...new Set(p.margins.map(m=>m.basis))]};}catch(e){return {status:'unavailable',reasons:[e.message]};}}
function normal(random){return Math.sqrt(-2*Math.log(Math.max(Number.MIN_VALUE,random())))*Math.cos(2*Math.PI*random());}
async function buildWorlds(p,{signal,onProgress}={}){const random=H.rng(p.config.seed^0x124ea915),worlds=[];for(let k=0;k<p.config.iterations;k++){aborted(signal);const scores=Array(p.pool.players.length);for(const g of p.correlations){const z=Array.from({length:g.n},()=>normal(random));for(let a=0;a<g.n;a++){let latent=0;for(let b=0;b<=a;b++)latent+=g.L[a*g.n+b]*z[b];latent/=Math.sqrt(1+g.jitter);const m=p.margins[g.ids[a]],v=m.kind==='normal'?m.mean+m.sd*latent:m.mean*Math.exp(-m.sigma*m.sigma/2+m.sigma*latent);need(finite(v)&&Math.abs(v)<=1000,'A sampled score exceeded the supported ±1,000 range. Revise variance assumptions; no clipping was applied.');scores[g.ids[a]]=Math.round(v*100)/100;}}
 worlds.push({weight:1,scores});if(k%64===0){onProgress?.({phase:'score worlds',completed:k,total:p.config.iterations});await pause();}}
 return worlds;
}
async function buildField(p,{signal,onProgress}={}){
 const {players}=p.pool,c=p.config,sd=p.pool.site==='dk_showdown',n=Math.max(...c.contests.map(x=>x.fieldSize))-1,random=H.rng(c.seed^0x58ac13),target=players.map(x=>(sd?x.flexOwn:x.own)/100),ct=players.map(x=>sd?x.cptOwn/100:0),floor=c.ownershipFloor/100;
 let weights=target.map(v=>Math.max(floor,v)),captainWeights=ct.map(v=>Math.max(floor,v));const byPos={QB:[],RB:[],WR:[],TE:[],DST:[]},eligible=players.map((_,i)=>i);eligible.forEach(i=>byPos[players[i].pos]?.push(i));
 let field=[],ownError=0,cptError=null;const cache=new Map();
 for(let pass=0;pass<3;pass++){
  field=[];let tries=0;while(field.length<n&&tries<Math.max(3000,n*35)){
   aborted(signal);tries++;const l=sd?H.sampleShowdown(players,byPos,weights,50000,random,E.SITES.dk_showdown,eligible,c.salaryFloor,captainWeights):H.sampleClassic(players,p.roles,byPos,weights,50000,random,c.stackRate,c.salaryFloor);
   if(l&&l.sal>=c.salaryFloor){const key=(l.cpt??'classic')+'|'+l.slice().sort((a,b)=>a-b).join(',');let e=cache.get(key);if(!e){e=ordered(p.pool,l,l.cpt);try{validateRoster(p.pool,e);}catch{e=null;}if(e)cache.set(key,e);}if(e)field.push(e);}
   if(tries%200===0){onProgress?.({phase:'legal field '+(pass+1)+'/3',completed:field.length,total:n});await pause();}
   if(tries===3000&&field.length<Math.min(20,n))break;
  }
  need(field.length===n,'Could not sample a complete legal field under these assumptions. Check ownership coverage, player pool and salary floor; no partial-field rates are shown.');
  const got=Array(players.length).fill(0),cap=got.slice();for(const e of field)for(const id of e.ids){got[id]++;if(id===e.cpt)cap[id]++;}
  ownError=0;cptError=sd?0:null;for(let i=0;i<players.length;i++){const observed=(got[i]-cap[i])/n,observedCpt=cap[i]/n;ownError+=Math.abs(observed-target[i])*100/players.length;if(sd)cptError+=Math.abs(observedCpt-ct[i])*100/players.length;const adjust=(wanted,actual)=>Math.min(3,Math.max(.33,actual>1e-9?wanted/actual:3));if(pass<2){weights[i]=Math.max(floor,target[i])===0?0:Math.max(1e-8,weights[i]*adjust(Math.max(floor,target[i]),observed));captainWeights[i]=Math.max(floor,ct[i])===0?0:Math.max(1e-8,captainWeights[i]*adjust(Math.max(floor,ct[i]),observedCpt));}}
  await pause();
 }
 const salary=field.map(e=>e.ids.reduce((s,id)=>s+(id===e.cpt?players[id].cptSal:players[id].sal),0)).sort((a,b)=>a-b);
 return {entries:field,diagnostics:{ownershipMAEpp:ownError,captainOwnershipMAEpp:cptError,uniqueRosters:new Set(field.map(e=>(e.cpt??'classic')+'|'+e.ids.slice().sort((a,b)=>a-b))).size,salaryMin:salary[0],salaryMedian:salary[Math.floor(salary.length/2)],salaryMax:salary.at(-1),assumption:'Independent legal opponent entries; one seeded field held fixed across score worlds. Three ownership reweighting passes; selected CSV ownership column is used for every profile. No entrant portfolio behavior is modeled.'}};
}
async function run(input,{signal,onProgress}={}){
 aborted(signal);const snapshot=copy(input),inputHash=await F.fingerprint({adapter:VERSION,...snapshot});let p;try{p=prepare(snapshot);}catch(e){return {status:'unavailable',inputHash,modelVersion:VERSION,reasons:[e.message]};}
 const worlds=await buildWorlds(p,{signal,onProgress}),field=await buildField(p,{signal,onProgress});aborted(signal);
 const now=new Date().toISOString(),source={name:'Locally generated conditional model',version:VERSION,asOf:now},pool={...p.pool,source:{name:'Frozen local inputs; provider time is retained separately',version:inputHash,asOf:now}};
 const request={version:1,pool,candidates:[{id:'current-build',participantId:'candidate',...p.candidate}],settings:{seed:p.config.seed,iterations:p.config.iterations,evaluatedAt:now,maxAgeHours:1},scoreModel:{type:'joint_worlds',basis:p.pool.synthetic?'synthetic':'forecast_scenarios',sampling:'generated_independent_once',source,projectionVersion:inputHash,playerIds:pool.players.map(x=>x.uid),scoreDecimals:2,captainPolicy:'official_1_5',worlds},contests:p.config.contests.map((c,i)=>({id:'profile-'+i,kind:p.config.contestKind,site:pool.site,slate:pool.slate,source,fieldSize:c.fieldSize,paidPlaces:c.paidPlaces,entryLimit:1,tiePayoutRule:'pool_occupied_places_equally',field:{mode:'complete',source,scoreRelationship:'fixed_before_outcomes',entries:field.entries.slice(0,c.fieldSize-1).map((e,j)=>({...e,participantId:'modeled-opponent-'+j}))}}))};
 const result=await F.run(request,{signal,onProgress:progress=>onProgress?.({...progress,phase:'shared score worlds'}),batchSize:16});aborted(signal);
 return {...result,inputHash,coreInputHash:result.inputHash,modelVersion:VERSION,model:{assumptions:copy(p.config),providerSource:copy(p.pool.source||{}),importedAt:p.pool.importedAt||null,historical:E.CORR.meta,correlation:p.config.correlation==='historical'?'Historical score correlations used as Gaussian latent correlations; lognormal score correlations differ. Projection rank assigns roles; historical roles used season usage. Kicker dependence is explicitly zero.':'Explicit independent score model',correlationJitter:p.correlations.map(g=>({game:g.game,jitter:g.jitter})),marginals:p.margins.map((m,i)=>({name:p.pool.players[i].name,...m})),field:field.diagnostics,uncertainty:'Intervals cover score-world Monte Carlo error conditional on this one modeled field. They exclude projection, ceiling-percentile, correlation, field-selection and calibration error. Rerun with a different seed or assumptions to assess sensitivity.'}};
}
root.DDFSBuilderSim={VERSION,assess,run,margin,prepare,buildWorlds};if(node)module.exports=root.DDFSBuilderSim;
})(typeof globalThis!=='undefined'?globalThis:this);
