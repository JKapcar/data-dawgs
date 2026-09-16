/* Inlined inside dfs.html's state closure. Explicit private save/load, never background upload. */
let dfsCloudRevision=null,dfsCloudLoadedId=null,dfsCloudAuth=null;
async function dfsCloudCall(op,args){
 const token=window.DDAuth&&DDAuth.token();if(!token)throw new Error('Sign in to save a private workspace.');
 const r=await fetch('https://toto.jkapcar4.workers.dev/api/dfs/'+op,{method:'POST',headers:{'Content-Type':'application/json','X-Bozo-Session':token},body:JSON.stringify(args)});
 let out;try{out=await r.json();}catch{throw new Error('Workspace service is unavailable. Your local slate is unchanged.');}
 if(DDAuth.token()!==token)throw new Error('Account changed during request; load again.');
 if(!r.ok||out.error)throw new Error(out.error||'Workspace request failed');return out;
}
function dfsCloudBoot(){
 const note=$('dfsCloudNote');const report=s=>note.textContent=s;
 const current=()=>{const token=DDAuth.token();if(token!==dfsCloudAuth){dfsCloudRevision=null;dfsCloudLoadedId=null;dfsCloudAuth=token;}const id=$('dfsCloudId').value.trim();if(!/^[A-Za-z0-9_-]{1,80}$/.test(id))throw new Error('Enter a workspace name using letters, numbers, underscores or hyphens.');return id;};
 const busy=async fn=>{for(const id of ['dfsCloudSave','dfsCloudLoad','dfsCloudList'])$(id).disabled=true;try{await fn();}catch(e){report(e.message);}finally{for(const id of ['dfsCloudSave','dfsCloudLoad','dfsCloudList'])$(id).disabled=false;}};
 $('dfsCloudList').onclick=()=>busy(async()=>{current();const r=await dfsCloudCall('list',{});$('dfsCloudChoices').replaceChildren(...r.workspaces.map(w=>{const o=document.createElement('option');o.value=w.workspace_id;o.label=w.site+' · '+w.players+' players';return o;}));report(r.workspaces.length? 'Saved workspaces: '+r.workspaces.map(w=>w.workspace_id).join(', '):'No saved workspaces yet.');});
 $('dfsCloudSave').onclick=()=>busy(async()=>{
  const id=current();readCfg();readSim();if(!S.players.length)throw new Error('Load a CSV first.');
  const source=S.slate&&S.slate.source||'User-supplied browser slate';const as_of=S.slate&&S.slate.loadedAt?new Date(S.slate.loadedAt).toISOString():new Date().toISOString();
  if(dfsCloudLoadedId!==id||dfsCloudRevision==null){const r=await dfsCloudCall('create',{workspace_id:id,site:S.site,source,as_of});dfsCloudRevision=r.revision;dfsCloudLoadedId=id;}
  const fields=['id','name','pos','team','opp','gid','sal','proj','own','cptOwn','flexOwn','cptProj','cptSal','ceil','dkId','cptId','kickoff','lock','excl'];
  const players=S.players.map(p=>({...Object.fromEntries(fields.filter(k=>p[k]!==undefined).map(k=>[k,p[k]])),maxExp:p.maxExp!=null?p.maxExp/100:(S.cfg.maxExp??100)/100}));
  const solver={count:S.cfg.count,minSalary:S.cfg.minSal,maxSalary:S.cfg.maxSal,uniques:S.cfg.uniq,randomness:S.cfg.rand/100,seed:216,maxPerTeam:S.cfg.team,maxPerGame:S.cfg.game,timeLimitMs:Math.min(5000,S.cfg.time*1000),stack:{qbMin:S.cfg.qbMin,qbPos:S.cfg.qbPos.split(','),bringBack:S.cfg.bring,noRbVsDst:!!S.cfg.noRbDst,noOppDst:!!S.cfg.noOppDst},groups:[]};
  if(S.site==='dk_showdown')solver.stack={qbMin:0,qbPos:['WR','TE'],bringBack:0,noRbVsDst:false,noOppDst:false};
  const payout=S.sim.payout==='custom'?{kind:'table',rows:parsePayoutTable(S.sim.custom)}:{kind:['cash','gppflat'].includes(S.sim.payout)?'flat':'param',paidFrac:S.sim.paid/100,alpha:S.sim.alpha,rake:S.sim.rake/100};
  const simulation={sims:S.sim.sims,fieldSize:S.sim.field,fieldSample:S.sim.sample,entryFee:S.sim.fee,fieldStackRate:S.sim.stack/100,fieldMinSalary:S.sim.fieldSal,seed:216,ownershipFloor:.0025,payout};
  const lab={minSalary:+$('labMinSal').value,maxSalary:50000,maxPerTeam:+$('labMaxTeam').value,ownershipFloor:+$('labOwnFloor').value/100,count:+$('paretoCount').value,cloud:+$('labCloud').value,maxBand:500,bandPts:+$('labBand').value,seed:216,timeLimitMs:3000};
  const r=await dfsCloudCall('sync',{workspace_id:id,expected_revision:dfsCloudRevision,players,lineups:S.lineups,settings:{solver,simulation,lab},source,as_of});dfsCloudRevision=r.revision;
  report('Saved privately: '+id+' · revision '+r.revision+'. Available to your Data Dawgs MCP connection. Remote search has a 5-second limit.');
 });
 $('dfsCloudLoad').onclick=()=>busy(async()=>{
  const id=current();let w=await dfsCloudCall('get',{workspace_id:id,limit:500,include_results:true});if((w.settings.solver.groups||[]).length)throw new Error('This workspace uses player groups that the browser controls cannot yet represent. Use the MCP tools to edit it.');const all=w.lineups.slice();
  while(all.length<w.total_lineups){const page=await dfsCloudCall('get',{workspace_id:id,offset:all.length,limit:500});if(page.revision!==w.revision)throw new Error('Workspace changed while loading; try again.');all.push(...page.lineups);}
  // Preserve the previous local state for recovery before replacing it.
  try{localStorage.setItem('dd-dfs-before-cloud-load',JSON.stringify(S));}catch{throw new Error('Could not back up this device’s current slate; load cancelled.');}
  S.site=w.site;S.players=w.players.map(p=>({...p,maxExp:p.maxExp==null?null:p.maxExp*100}));S.lineups=all;S.demo=false;S.labPins=[];S.lab=null;S.lineupsMeta={stamp:Date.now(),site:S.site,asked:all.length,cloud:true};
  const c=w.settings.solver,t=w.settings.simulation;Object.assign(S.cfg,{count:c.count,minSal:c.minSalary,maxSal:c.maxSalary,uniq:c.uniques,rand:c.randomness*100,maxExp:100,team:c.maxPerTeam,game:c.maxPerGame,time:c.timeLimitMs/1000,qbMin:c.stack.qbMin,qbPos:c.stack.qbPos.join(','),bring:c.stack.bringBack,noRbDst:c.stack.noRbVsDst,noOppDst:c.stack.noOppDst});
  Object.assign(S.sim,{field:t.fieldSize,fee:t.entryFee,sims:t.sims,sample:t.fieldSample,stack:t.fieldStackRate*100,fieldSal:t.fieldMinSalary,payout:t.payout.kind==='table'?'custom':t.payout.kind==='flat'?'cash':'gpp',paid:(t.payout.paidFrac||.2)*100,alpha:t.payout.alpha??1.15,rake:(t.payout.rake??.15)*100,custom:(t.payout.rows||[]).map(r=>[r.from,r.to,r.prize].join(',')).join('\n')});
  S.slate={...S.slate,source:w.source,loadedAt:Date.parse(w.as_of),stale:false};SIM=null;
  if(w.simulation&&w.simulation.workspace_indices.length===all.length&&w.simulation.workspace_indices.every((v,i)=>v===i)){SIM=w.simulation;SIM.ms=SIM.elapsed_ms;}
  dfsCloudLoadedId=id;dfsCloudRevision=w.revision;save();writeCfg();renderStrip();renderPool();renderLineups();renderSolveStats();renderExposure();renderSim();report('Loaded '+id+' · revision '+w.revision+'. Previous local slate is backed up on this device.');
 });
 window.addEventListener('dd-auth',()=>{dfsCloudRevision=null;dfsCloudLoadedId=null;report('Account changed. Load or create a workspace for this account.');});
}
