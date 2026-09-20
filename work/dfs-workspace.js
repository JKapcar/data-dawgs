/* Private DFS workspaces. Browser and MCP share this boundary and the existing engines.
   No paid inputs are public. ETag + revision makes every mutation compare-and-swap. */
const DFS_LIMITS = {players:220, lineups:5000, solveMs:5000, worlds:16000, sample:10000, work:32000000, bytes:2000000};
const DFS_PLAYER_FIELDS = ['id','name','pos','team','opp','gid','sal','proj','own','cptOwn','flexOwn','cptProj','cptSal','ceil','dkId','cptId','kickoff','lock','excl','maxExp'];
const DFS_SOLVER_DEFAULT = {count:20,minSalary:0,maxSalary:50000,uniques:1,randomness:0,seed:216,maxPerTeam:5,maxPerGame:9,timeLimitMs:3000,acoCap:null,objective:null,stack:{qbMin:0,qbPos:['WR','TE'],bringBack:0,noRbVsDst:false,noOppDst:false,noQbVsDst:false},groups:[]};
const DFS_SIM_DEFAULT = {mode:'contest',sims:1600,fieldSize:5300,entryFee:1,fieldSample:2000,seed:216,fieldMinSalary:48000,fieldStackRate:.6,ownershipFloor:.0025,payout:{kind:'param',paidFrac:.2,alpha:1.15,rake:.15}};
const DFS_LAB_DEFAULT = {minSalary:44000,maxSalary:50000,maxPerTeam:5,ownershipFloor:.0025,count:5000,cloud:1000,maxBand:500,bandPts:3,seed:216,timeLimitMs:3000};
function dfsAssert(ok,message){if(!ok)throw new Error(message);}
function dfsObj(v,keys,label){mcpDfsKnown(v,keys,label);return v;}
function dfsNum(v,lo,hi,label,integer=false){mcpDfsNumber(v,label,lo,hi);if(integer)dfsAssert(Number.isInteger(v),label+' must be an integer');return v;}
function dfsKey(v,label='workspace_id'){dfsAssert(typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v),label+' must contain 1–80 letters, numbers, underscores or hyphens');return v;}
function dfsUid(caller){dfsAssert(caller&&caller.kind==='user'&&caller.uid,'Use your personal Data Dawgs connector; a verified account UID is required.');return dfsKey(caller.uid,'account UID');}
function dfsPath(caller,id){return '/users/'+dfsUid(caller)+'/dfsWorkspaces/'+dfsKey(id);}
function dfsClone(v){return JSON.parse(JSON.stringify(v));}
function dfsPlayers(input,site){
 dfsAssert(Array.isArray(input)&&input.length>0&&input.length<=DFS_LIMITS.players,'Supply 1–220 players');
 if(site==='dk_showdown'){dfsAssert(new Set(input.map(p=>p.team)).size===2&&new Set(input.map(p=>p.gid)).size===1,'Showdown requires one game and exactly two teams');}
 const ids=new Set();return input.map((raw,i)=>{
  dfsObj(raw,DFS_PLAYER_FIELDS,'player '+i);const p={...raw};
  for(const k of ['name','team','opp','gid'])p[k]=mcpDfsString(p[k],'player '+i+'.'+k,100);
  p.id=p.id||p.dkId||p.team+':'+p.name;p.id=mcpDfsString(p.id,'player id',150);
  dfsAssert(!ids.has(p.id),'Duplicate player id: '+p.id);ids.add(p.id);
  dfsAssert((site==='dk_showdown'?['QB','RB','WR','TE','DST','K']:['QB','RB','WR','TE','DST']).includes(p.pos),'Invalid position for '+site);
  dfsNum(p.sal,100,50000,'salary',true);dfsAssert(p.sal%100===0,'FLEX salary must be a multiple of 100');
  for(const k of ['proj','cptProj','ceil'])if(p[k]!=null)dfsNum(p[k],0,200,k);
  for(const k of ['own','cptOwn','flexOwn'])if(p[k]!=null)dfsNum(p[k],0,100,k);
  if(p.cptSal===0)p.cptSal=null;
  if(p.cptSal!=null)dfsNum(p.cptSal,100,75000,'cptSal',true);
  if(p.maxExp!=null)dfsNum(p.maxExp,0,1,'maxExp');
  for(const k of ['lock','excl'])if(p[k]!=null)dfsAssert(typeof p[k]==='boolean',k+' must be boolean');
  dfsAssert(!(p.lock&&(p.excl||p.maxExp===0)),'Locked player cannot be excluded');
  if(p.maxExp===0)p.excl=true;
  for(const k of ['dkId','cptId'])if(p[k])dfsAssert(/^\d{1,30}$/.test(String(p[k])),k+' must be an official numeric DraftKings ID');
  return p;
 });
}
function dfsSettings(w,section,patch){
 const defs={solver:DFS_SOLVER_DEFAULT,simulation:DFS_SIM_DEFAULT,lab:DFS_LAB_DEFAULT};
 dfsAssert(defs[section],'section must be solver, simulation or lab');dfsObj(patch,Object.keys(defs[section]),section);
 const c={...defs[section],...w.settings[section],...patch};
 if(section==='solver'){
  for(const [k,lo,hi] of [['count',1,150],['minSalary',0,50000],['maxSalary',100,50000],['uniques',0,w.site==='dk_showdown'?6:9],['seed',1,2147483647],['maxPerTeam',1,9],['maxPerGame',1,9],['timeLimitMs',100,DFS_LIMITS.solveMs]])dfsNum(c[k],lo,hi,k,true);
  dfsAssert(c.minSalary<=c.maxSalary&&c.minSalary%100===0&&c.maxSalary%100===0,'Invalid salary range');dfsNum(c.randomness,0,.6,'randomness');
  if(w.site==='dk_classic')dfsAssert(c.maxPerTeam<=5,'Classic maxPerTeam cannot exceed 5; default is 4');
  if(c.acoCap!=null)dfsNum(c.acoCap,0,900,'acoCap');
  if(c.objective!=null){dfsObj(c.objective,['proj','ceil','own'],'objective');for(const k of ['proj','ceil','own'])dfsNum(c.objective[k],-100,100,'objective.'+k);}
  if(w.site==='dk_showdown')dfsAssert(c.acoCap==null&&c.objective==null,'ACO/weighted objective requires Classic');
  dfsObj(c.stack,Object.keys(DFS_SOLVER_DEFAULT.stack),'stack');c.stack={...DFS_SOLVER_DEFAULT.stack,...c.stack};
  dfsNum(c.stack.qbMin,0,3,'qbMin',true);dfsNum(c.stack.bringBack,0,3,'bringBack',true);
  dfsAssert(Array.isArray(c.stack.qbPos)&&c.stack.qbPos.length&&c.stack.qbPos.every(x=>['RB','WR','TE'].includes(x)),'Invalid qbPos');
  for(const k of ['noRbVsDst','noOppDst','noQbVsDst'])dfsAssert(typeof c.stack[k]==='boolean',k+' must be boolean');
  dfsAssert(Array.isArray(c.groups)&&c.groups.length<=20,'At most 20 player groups');
  for(const g of c.groups){dfsObj(g,['mode','n','ids'],'group');dfsAssert(['atMost','atLeast','exactly'].includes(g.mode),'Invalid group mode');dfsNum(g.n,0,9,'group n',true);dfsAssert(Array.isArray(g.ids)&&g.ids.length<=220&&new Set(g.ids).size===g.ids.length&&g.ids.every(id=>w.players.some(p=>p.id===id)),'Group IDs must be unique player IDs');}
  if(w.site==='dk_showdown')dfsAssert(!c.groups.length&&!c.stack.qbMin&&!c.stack.bringBack&&!c.stack.noRbVsDst&&!c.stack.noOppDst,'Showdown solver does not implement Classic stacks/groups');
 }else if(section==='simulation'){
  dfsAssert(['contest','score_tail'].includes(c.mode),'Invalid simulation mode');
  dfsAssert(c.mode!=='score_tail'||w.site==='dk_classic','Score tails require Classic');
  for(const [k,lo,hi] of [['sims',200,c.mode==='score_tail'?30000:DFS_LIMITS.worlds],['fieldSize',2,1000000],['fieldSample',1,DFS_LIMITS.sample],['seed',1,2147483647],['fieldMinSalary',0,50000]])dfsNum(c[k],lo,hi,k,true);
  dfsNum(c.entryFee,.01,100000,'entryFee');dfsNum(c.fieldStackRate,0,1,'fieldStackRate');dfsNum(c.ownershipFloor,.00001,.1,'ownershipFloor');
  dfsObj(c.payout,['kind','paidFrac','alpha','rake','rows'],'payout');dfsAssert(['param','flat','table'].includes(c.payout.kind),'Invalid payout kind');
  if(c.payout.kind==='table'){dfsAssert(Array.isArray(c.payout.rows)&&c.payout.rows.length>0&&c.payout.rows.length<=1000,'Supply 1–1000 payout tiers');for(const r of c.payout.rows)dfsObj(r,['from','to','prize'],'payout row');}
  else {dfsNum(c.payout.paidFrac,.000001,1,'paidFrac');dfsNum(c.payout.alpha,0,5,'alpha');dfsNum(c.payout.rake,0,.99,'rake');}
  mcpDdfsRoot.DDFS.payoutFn(c.payout,c.fieldSize,c.entryFee);
 }else {dfsNum(c.ownershipFloor,.00001,.1,'ownershipFloor');dfsAssert(c.minSalary<=c.maxSalary&&c.minSalary%100===0&&c.maxSalary%100===0,'Invalid lab salary range');for(const [k,lo,hi] of [['minSalary',0,50000],['maxSalary',100,50000],['maxPerTeam',1,6],['count',1,5000],['cloud',0,3000],['maxBand',50,1500],['bandPts',0,20],['seed',1,2147483647],['timeLimitMs',100,DFS_LIMITS.solveMs]])dfsNum(c[k],lo,hi,k,k!=='bandPts');}
 return c;
}
function dfsAudit(w){
 const warnings=[],active=w.players.filter(p=>!p.excl);
 const missing=active.filter(p=>p.proj==null).map(p=>p.id);
 if(missing.length)warnings.push('Missing projections are excluded from compute; they are not zero projections.');
 if(active.some(p=>p.own==null))warnings.push('Missing ownership: simulations are unavailable until supplied.');
 if(w.site==='dk_showdown'&&active.some(p=>p.cptOwn==null))warnings.push('Missing captain ownership: Showdown simulations are unavailable until supplied.');
 if(Date.now()-Date.parse(w.as_of)>6*3600000)warnings.push('Source timestamp is more than six hours old; verify slate freshness.');
 if(w.site==='dk_showdown'&&active.some(p=>p.cptProj!=null&&Math.abs(p.cptProj-1.5*p.proj)>.15))warnings.push('Captain projections disagree with 1.5× FLEX scoring.');
 return {players:w.players.length,missing_projections:missing,warnings,source:w.source,as_of:w.as_of,revision:w.revision};
}
function dfsEngineInput(w){const players=w.players.map(p=>({...p,excl:p.excl||p.proj==null||p.maxExp===0}));const cfg={...w.settings.solver,site:w.site,groups:(w.settings.solver.groups||[]).map(g=>({...g,ids:g.ids.map(id=>players.findIndex(p=>p.id===id))}))};return {players,cfg};}
function dfsValidateLineups(w,ls){
 dfsAssert(Array.isArray(ls)&&ls.length<=DFS_LIMITS.lineups,'At most 5000 lineups');
 const {players,cfg}=dfsEngineInput(w);const seen=new Set();return ls.map(l=>{
  dfsAssert(l&&Array.isArray(l.ids)&&l.ids.every(i=>Number.isInteger(i)&&i>=0&&i<players.length),'Invalid lineup player index');
  dfsAssert(dfsModules.DDPareto.legal(l.ids,l.cpt,players,cfg),'Illegal lineup or violated constraints');
  for(const g of cfg.groups){const n=l.ids.filter(i=>g.ids.includes(i)).length;dfsAssert(g.mode==='atMost'?n<=g.n:g.mode==='atLeast'?n>=g.n:n===g.n,'Lineup violates player group');}
  const key=mcpDdfsRoot.DDFS.lineupKey(l);dfsAssert(!seen.has(key),'Duplicate lineup');seen.add(key);
  return {...l,sal:l.ids.reduce((s,i)=>s+(i===l.cpt?(players[i].cptSal||Math.round(players[i].sal*1.5)):players[i].sal),0),proj:l.ids.reduce((s,i)=>s+players[i].proj*(i===l.cpt?1.5:1),0)};
 });
}
function dfsExposure(w){
 const n=w.lineups.length,players=w.players.map(p=>({id:p.id,name:p.name,total:0,captain:0,flex:0,max:p.maxExp??null})),teams={},games={};
 for(const l of w.lineups){for(const i of l.ids){players[i].total++;players[i][i===l.cpt?'captain':'flex']++;}for(const t of new Set(l.ids.map(i=>w.players[i].team)))teams[t]=(teams[t]||0)+1;for(const g of new Set(l.ids.map(i=>w.players[i].gid)))games[g]=(games[g]||0)+1;}
 return {lineups:n,players:players.map(p=>({...p,rate:n?p.total/n:0,captain_rate:n?p.captain/n:0,violates_max:n>0&&p.max!=null&&p.total/n>p.max+1e-9})),teams,games,note:'Team/game counts are lineups containing that team/game. Rates are fractions. Solver exposure caps are sequential heuristics; inspect final violations.'};
}
async function dfsLoad(env,caller,id){const path=dfsPath(caller,id),r=await fbGet(env,path,true);dfsAssert(r.data,'Workspace not found');return {path,...r};}
async function dfsCommit(env,r,w,revision){
 dfsNum(revision,0,2147483647,'expected_revision',true);dfsAssert((r.data?.revision||0)===revision,'Revision conflict. Read workspace and retry with the current revision.');
 w.revision=revision+1;w.updated_at=new Date().toISOString();const clean=dfsClone(w);dfsAssert(JSON.stringify(clean).length<=DFS_LIMITS.bytes,'Workspace exceeds 2 MB; reduce candidate count');
 dfsAssert(r.etag,'Storage did not return an ETag; refusing an unsafe write');dfsAssert(await fbPut(env,r.path,clean,r.etag),'Revision conflict. No changes saved.');return {workspace_id:w.id,revision:w.revision,updated_at:w.updated_at,audit:dfsAudit(w)};
}
async function dfsRun(op,a,env,caller){
 dfsUid(caller);
 const allowed={compare:['workspace_id','expected_revision','indices','profiles','script'],sync:['workspace_id','expected_revision','players','lineups','settings','source','as_of'],list:[],get:['workspace_id','offset','limit','include_results'],create:['workspace_id','site','source','as_of'],upload:['workspace_id','expected_revision','csv','source','as_of','commit'],players:['workspace_id','expected_revision','players'],settings:['workspace_id','expected_revision','section','patch'],solve:['workspace_id','expected_revision'],explore:['workspace_id','expected_revision'],simulate:['workspace_id','expected_revision','indices'],exposure:['workspace_id'],select:['workspace_id','expected_revision','indices'],export:['workspace_id'],delete:['workspace_id','expected_revision'],schema:[]};
 dfsAssert(allowed[op],'Unknown DFS operation');dfsObj(a,allowed[op],'arguments');
 if(op==='schema')return {version:1,limits:DFS_LIMITS,player_fields:DFS_PLAYER_FIELDS,required_player_fields:['name','pos','team','opp','gid','sal'],field_notes:{proj:'Nullable FLEX points; missing projections are excluded.',own:'Total player ownership percent; Classic position or Showdown total across slots.',cptOwn:'Showdown captain ownership percent; must not exceed total.',maxExp:'Sequential solver cap fraction; final violations are reported.',dkId:'Official FLEX ID required for entry CSV.',cptId:'Official captain ID required for Showdown entry CSV.',gid:'Shared stable game identifier; never guess missing games.'},defaults:{solver:DFS_SOLVER_DEFAULT,simulation:DFS_SIM_DEFAULT,lab:DFS_LAB_DEFAULT},units:{own:'percent 0–100',cptOwn:'percent 0–100',flexOwn:'percent 0–100',maxExp:'fraction 0–1',randomness:'fraction 0–0.6'},workflow:['create','upload (commit=false to preview)','upload (commit=true)','players/settings','solve or explore','simulate','exposure','select','export'],notes:['Every write requires expected_revision.','Read get with include_results=true for simulations.','Use player IDs in groups; lineup ids are indexes into the saved players array.','Results are model-conditional; no guarantee of profitability.']};
 if(op==='list'){const r=await fbGet(env,'/users/'+dfsUid(caller)+'/dfsWorkspaces');return {workspaces:Object.values(r.data||{}).map(w=>({workspace_id:w.id,site:w.site,source:w.source,as_of:w.as_of,revision:w.revision,players:(w.players||[]).length,lineups:(w.lineups||[]).length,updated_at:w.updated_at}))};}
 if(op==='create'){
  const path=dfsPath(caller,a.workspace_id),r={...await fbGet(env,path,true),path};dfsAssert(!r.data,'Workspace already exists');dfsAssert(['dk_classic','dk_showdown'].includes(a.site),'Choose dk_classic or dk_showdown');
  const w={id:a.workspace_id,site:a.site,source:mcpDfsString(a.source,'source',200),as_of:dfsDate(a.as_of),players:[],lineups:[],settings:dfsClone({solver:DFS_SOLVER_DEFAULT,simulation:DFS_SIM_DEFAULT,lab:DFS_LAB_DEFAULT}),revision:0};if(a.site==='dk_classic')Object.assign(w.settings.solver,{minSalary:48500,uniques:3,maxPerTeam:4,objective:{proj:.3,ceil:.7,own:-.05},stack:{qbMin:2,qbPos:['WR','TE'],bringBack:1,noRbVsDst:true,noOppDst:false,noQbVsDst:true}});return dfsCommit(env,r,w,0);
 }
 const r=await dfsLoad(env,caller,a.workspace_id),w=dfsClone(r.data);w.lineups=w.lineups||[];w.players=w.players||[];w.settings={solver:{...dfsClone(DFS_SOLVER_DEFAULT),...w.settings.solver},simulation:{...dfsClone(DFS_SIM_DEFAULT),...w.settings.simulation},lab:{...dfsClone(DFS_LAB_DEFAULT),...w.settings.lab}};
 if(op==='get'){const offset=a.offset??0,limit=a.limit??100;dfsNum(offset,0,5000,'offset',true);dfsNum(limit,1,500,'limit',true);if(a.include_results!=null)dfsAssert(typeof a.include_results==='boolean','include_results must be boolean');const {lineups,simulation,...rest}=w;return {...rest,lineups:lineups.slice(offset,offset+limit),total_lineups:lineups.length,simulation:a.include_results?simulation||null:undefined,audit:dfsAudit(w)};}
 if(op==='exposure')return dfsExposure(w);
 if(op==='export')return dfsExport(w);
 dfsNum(a.expected_revision,1,2147483647,'expected_revision',true);dfsAssert(a.expected_revision===w.revision,'Revision conflict. Read workspace first.');
 if(op==='delete'){dfsAssert(r.etag,'Missing ETag');dfsAssert(await fbDelete(env,r.path,r.etag),'Revision conflict');return {deleted:w.id};}
 let result={};
 if(op==='upload'){
  dfsAssert(typeof a.csv==='string'&&a.csv.length>0&&a.csv.length<=500000,'CSV must be 1–500000 characters');dfsAssert(typeof a.commit==='boolean','Set commit=false to preview or true to save');
  const parsed=dfsModules.DDFSIngest.readUpload(a.csv,w.players);dfsAssert(!parsed.error,parsed.error);
  // Parser may retain metadata fields irrelevant to the shared engine. Normalize explicitly.
  w.players=dfsPlayers(parsed.players.map(p=>Object.fromEntries(DFS_PLAYER_FIELDS.filter(k=>p[k]!==undefined).map(k=>[k,p[k]]))),w.site);
  w.source=mcpDfsString(a.source,'source',200);w.as_of=dfsDate(a.as_of);result={warnings:parsed.warnings,projectionInfo:parsed.projectionInfo||null,dropped:parsed.dropped||{},audit:dfsAudit(w)};
  if(!a.commit)return {preview:true,...result,players:w.players};w.lineups=[];delete w.simulation;delete w.comparison;delete w.compute;
 }else if(op==='sync'){
  w.players=dfsPlayers(a.players,w.site);dfsObj(a.settings,['solver','simulation','lab'],'settings');
  for(const section of Object.keys(a.settings))w.settings[section]=dfsSettings(w,section,a.settings[section]);
  w.lineups=dfsValidateLineups(w,a.lineups);w.lineup_rules=w.settings.solver;w.source=mcpDfsString(a.source,'source',200);w.as_of=dfsDate(a.as_of);delete w.simulation;delete w.comparison;delete w.compute;
 }else if(op==='players'){
  w.players=dfsPlayers(a.players,w.site);w.lineups=[];delete w.simulation;delete w.comparison;delete w.compute;
 }else if(op==='settings'){
  w.settings[a.section]=dfsSettings(w,a.section,a.patch);delete w.simulation;delete w.comparison;
  if(a.section==='solver'){w.lineups=[];delete w.compute;}
 }else if(op==='solve'||op==='explore'){
  dfsAssert(w.players.length,'Upload a slate first');const {players,cfg}=dfsEngineInput(w);
  dfsAssert(players.some(p=>!p.excl&&p.proj>0),'Supply usable projections');
  if(w.site==='dk_showdown')for(const p of players)dfsAssert(p.cptSal==null||p.cptSal===Math.round(p.sal*1.5),'Reconcile captain salary with 1.5× FLEX before computing');
  if(op==='explore')dfsAssert(!cfg.groups.length,'Exploration does not support player groups; clear groups or use solve');
  const started=Date.now(),out=op==='solve'?mcpDdfsRoot.DDFS.solveLineups(players,cfg):dfsModules.DDPareto.generate(players,{...cfg,...w.settings.lab,maxStored:100000});
  dfsAssert(out.lineups.length<=DFS_LIMITS.lineups,'Generated pool exceeds 5000; reduce cloud/band size');
  const validationWorkspace=op==='explore'?{...w,settings:{...w.settings,solver:{...w.settings.solver,...w.settings.lab}}}:w;
  w.lineups=dfsValidateLineups(validationWorkspace,out.lineups);w.lineup_rules=validationWorkspace.settings.solver;delete w.simulation;delete w.comparison;
  w.compute={operation:op,input_revision:a.expected_revision,elapsed_ms:Date.now()-started,timed_out:!!(out.timedOut||out.capped),infeasible:out.infeasible||null,stats:out.stats||null};result={compute:w.compute,lineups:w.lineups.length,exposure:dfsExposure(w)};
 }else if(op==='simulate'||op==='compare'){
  dfsAssert(w.lineups.length,'Generate lineups first');const indices=dfsIndices(a.indices,w.lineups.length),ls=indices.map(i=>w.lineups[i]);const {players}=dfsEngineInput(w),c={...w.settings.simulation,site:w.site};
  dfsAssert(ls.length<=200,'Simulate at most 200 candidates per run; pass indices');
  dfsAssert(c.sims*(c.mode==='score_tail'?players.length+ls.length:Math.min(c.fieldSample,c.fieldSize-1)+ls.length)<=DFS_LIMITS.work,'Compute budget exceeded; reduce worlds, opponent sample or candidate count');
  let profiles=null;
  if(op==='compare'){
   dfsAssert(c.mode!=='score_tail','Score tails do not estimate contest placement; use contest mode for compare');
   dfsAssert(['any','pass','back','run'].includes(a.script||'any'),'Invalid game plan');
   dfsObj(a.profiles||{},['cash','three','five','milly'],'profiles');
   for(const v of Object.values(a.profiles||{})){dfsObj(v,['fieldSize','paidPlaces'],'profile');dfsNum(v.fieldSize,2,1000000,'fieldSize',true);dfsNum(v.paidPlaces,1,v.fieldSize,'paidPlaces',true);}
   profiles=dfsModules.DDLabContests.profiles(a.profiles||{});c.contestProfiles=profiles;
   dfsAssert(c.sims*(Math.min(c.fieldSample,Math.max(c.fieldSize,...profiles.map(p=>p.fieldSize))-1)+ls.length)*5<=DFS_LIMITS.work,'Comparison budget exceeded; reduce worlds or sample');
  }
  const active=players.filter(p=>!p.excl&&p.proj>0);dfsAssert(active.every(p=>Number.isFinite(p.own)),'Supply ownership for every active player');
  if(w.site==='dk_showdown')dfsAssert(active.every(p=>Number.isFinite(p.cptOwn)&&p.cptOwn<=p.own&&(p.cptProj==null||Math.abs(p.cptProj-1.5*p.proj)<=.15)),'Supply valid captain ownership and reconcile captain projections');
  const dupePriors=ls.map(l=>dfsModules.DDFSDupe.expectedDupes(l,w.players,{entries:c.fieldSize,showdown:w.site==='dk_showdown'}));
  const simulationLineups=ls.map((l,i)=>({...l,eDupes:Math.max(0,dupePriors[i]?.eDupes||0)}));
  const started=Date.now();w.simulation=dfsClone(c.mode==='score_tail'?mcpDdfsRoot.DDFS.simulateTail(players,ls,c):mcpDdfsRoot.DDFS.simulate(players,simulationLineups,c));w.simulation.dupe_prior=true;w.simulation.workspace_indices=indices;w.simulation.input_revision=a.expected_revision;w.simulation.elapsed_ms=Date.now()-started;result={simulation:w.simulation};
  if(profiles){const m=w.simulation.meta;const gate=Number.isFinite(m.fieldOwnershipError)&&m.fieldOwnershipError<=5&&!m.correlationFailed&&!m.captainProjectionMismatch;
   result.comparison={model_gate_pass:gate,selections:gate?dfsModules.DDLabContests.select(w.simulation,ls,players,a.script||'any',profiles).map(r=>({...r,workspace_index:r.i==null?null:indices[r.i]})):[],note:'Model candidates selected on training worlds and reported on held-out worlds. Uncalibrated estimates, not proven returns.'};w.comparison=result.comparison;
  }
 }else if(op==='select'){
  const indices=dfsIndices(a.indices,w.lineups.length);w.lineups=indices.map(i=>w.lineups[i]);delete w.simulation;delete w.comparison;result={exposure:dfsExposure(w)};
 }
 return {...await dfsCommit(env,r,w,a.expected_revision),...result};
}
function dfsDate(s){dfsAssert(typeof s==='string'&&Number.isFinite(Date.parse(s)),'as_of must be a source timestamp');return new Date(s).toISOString();}
function dfsIndices(v,n){const ids=v===undefined?Array.from({length:n},(_,i)=>i):v;dfsAssert(Array.isArray(ids)&&ids.length>0&&new Set(ids).size===ids.length&&ids.every(i=>Number.isInteger(i)&&i>=0&&i<n),'indices must be unique in-range lineup indexes');return ids;}
function dfsExport(w){
 dfsAssert(w.lineups.length,'No lineups to export');const ls=dfsValidateLineups({...w,settings:{...w.settings,solver:w.lineup_rules||w.settings.solver}},w.lineups);const rows=[w.site==='dk_showdown'?['CPT','FLEX','FLEX','FLEX','FLEX','FLEX']:['QB','RB','RB','WR','WR','WR','TE','FLEX','DST']];
 for(const l of ls){const slots=mcpDfsSlots(l,w.players,w.site);rows.push(slots.map(({slot,i})=>{const p=w.players[i],id=slot==='CPT'?p.cptId:p.dkId;dfsAssert(id&&/^\d+$/.test(String(id)),'Missing official '+slot+' ID for '+p.name);return String(id);}));}
 return {filename:w.id+'-draftkings.csv',csv:rows.map(r=>r.join(',')).join('\r\n')+'\r\n',lineups:ls.length,revision:w.revision,note:'Export only. No contest entries were submitted.'};
}
async function handleDfsWorkspace(request,url,env,cors){
 const auth=await sessionAuth(request,env);if(auth.err)return json({error:auth.err},auth.code||401,cors);
 if(request.method!=='POST')return json({error:'POST only'},405,cors);
 try{const body=await readCappedJson(request,600000);dfsAssert(!body.tooLarge&&!body.malformed,'Invalid or oversized JSON body');return json(await dfsRun(url.pathname.split('/').pop(),body.value,env,{kind:'user',uid:auth.uid}),200,cors);}catch(e){return json({error:e.message},400,cors);}
}
function dfsToolSchema(op){
 const s={type:'string'},num={type:'integer'},id={type:'string',pattern:'^[A-Za-z0-9_-]{1,80}$'},obj={type:'object'};
 const common={workspace_id:id,expected_revision:{type:'integer',minimum:1}};
 const props={compare:{...common,indices:{type:'array',items:num,maxItems:200},profiles:obj,script:{type:'string',enum:['any','pass','back','run']}},sync:{...common,players:{type:'array',items:obj},lineups:{type:'array',items:obj},settings:obj,source:s,as_of:s},schema:{},list:{},get:{workspace_id:id,offset:num,limit:num,include_results:{type:'boolean'}},create:{workspace_id:id,site:{enum:['dk_classic','dk_showdown'],type:'string'},source:s,as_of:s},upload:{...common,csv:{type:'string',maxLength:500000},source:s,as_of:s,commit:{type:'boolean'}},players:{...common,players:{type:'array',items:obj,minItems:1,maxItems:220}},settings:{...common,section:{type:'string',enum:['solver','simulation','lab']},patch:obj},solve:common,explore:common,simulate:{...common,indices:{type:'array',items:num,maxItems:200}},select:{...common,indices:{type:'array',items:num}},exposure:{workspace_id:id},export:{workspace_id:id},delete:common};
 const optional={get:['offset','limit','include_results'],simulate:['indices'],compare:['indices','profiles','script']};return {type:'object',properties:props[op],required:Object.keys(props[op]).filter(k=>!(optional[op]||[]).includes(k)),additionalProperties:false};
}
