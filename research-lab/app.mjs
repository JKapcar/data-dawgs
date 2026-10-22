import {workflowGraph,renderWorkflow} from './workflow.mjs';
import config from './client-config.mjs';
import {createClient} from './client.mjs';
import {createCoordinator,taskState} from './coordinator.mjs';
import {createContinuation,SHARED_CONTINUATION_BLOCKED} from './continuation.mjs';
const client=createClient(config,{onInvalidated:clearVisibleState,onVerified:t=>globalThis.DDAccount?.verified(t),onRejected:s=>globalThis.DDAccount?.failed(s)});
const coordinator=createCoordinator(client);
import {validateTracking,summarize} from './tracking.mjs';
const $=s=>document.querySelector(s),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
let renderEpoch=0;
let state,tracking,index=0,playing=false,timer,returnFocus,audioContext,realData=false;
// Mirrors machine-core.mjs HYPOTHESIS_FAMILIES; revisions saved before families existed group under other.
const FAMILIES=[['speed-retention','Speed retention'],['accel-decel-cut','Accel / decel / cut'],['missingness','Missingness'],['external-market','External market'],['other','Other']];
const chip=status=>el('span',status.toUpperCase(),'meta status-chip status-'+status);
const tabs=[...document.querySelectorAll('[role=tab]')];
function activateTab(tab,focus=false){stop();if(tab.id==='tab-real')loadRealData();if(tab.id==='tab-inspector')$('#panel-inspector').append($('#inspector'));else if(tab.id==='tab-research')$('#instruments').prepend($('#inspector'));for(const t of tabs){const active=t===tab;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;document.getElementById(t.getAttribute('aria-controls')).hidden=!active;}if(focus)tab.focus();render();}
for(const tab of tabs){tab.onclick=()=>activateTab(tab);tab.onkeydown=e=>{const i=tabs.indexOf(tab),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:e.key==='ArrowRight'?(i+1)%tabs.length:e.key==='ArrowLeft'?(i+tabs.length-1)%tabs.length:null;if(next!==null){e.preventDefault();activateTab(tabs[next],true);}};}
const notice=(message,error=false)=>{$('#notice').textContent=message;$('#notice').classList.toggle('error',error);};
const command=(type,payload)=>{if(continuing)throw Error('Stop continuation before changing research records');return client.command(type,payload);};
const action=(label,fn)=>{const b=el('button',label);b.onclick=async()=>{try{const pending=fn();if(pending&&typeof pending.then==='function'){b.disabled=true;await pending;}}catch(e){notice(e.message,true);}finally{b.disabled=false;}};return b;};
let continuing=false,manualRunning=false;
const continuationStatus=el('p',client.mode==='browser'?'Session-bound, not 24/7. Isolated demo only. Approve exact tasks below, then start. Maximum 3 audits / 30 seconds.':'Session-bound, not 24/7. '+SHARED_CONTINUATION_BLOCKED);
continuationStatus.setAttribute('role','status');
const continuation=createContinuation(client,{onStatus:s=>{continuing=s.active;continuationStatus.textContent=s.label+' — '+s.reason+' — '+s.count+' verified runs. Stop prevents the next command; an already submitted command may finish.';}});
const continuationStart=action('Start approved tasks',async()=>{if(manualRunning)throw Error('Wait for the manual attempt to reconcile');await continuation.start();await refresh();});
continuationStart.disabled=client.mode!=='browser';
const continuationPanel=el('section');continuationPanel.setAttribute('aria-label','Foreground synthetic continuation');
continuationPanel.append(el('h3','Continue approved synthetic audits'),continuationStatus,
  continuationStart,
  action('Stop continuation',()=>continuation.stop()));
$('#tasks').before(continuationPanel);
addEventListener('pagehide',()=>continuation.stop('Page closed'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)continuation.stop('Page hidden');});
function drawer(title,build) {stop();const wasOpen=$('#drawer').open;if(!wasOpen)returnFocus=document.activeElement?.id==='methods'?$('.dd-apps > summary'):document.activeElement;const content=$('#drawer-content');content.replaceChildren(el('h2',title));build(content);if(!wasOpen)$('#drawer').showModal();else $('#drawer').querySelector('button,input,textarea')?.focus();}
$('#drawer').addEventListener('close',()=>{const target=returnFocus?.getClientRects().length?returnFocus:$('.dd-apps > summary');target?.focus();});
function form(container,fields,submitLabel,submit) {
  const f=el('form');f.dataset.ddbSkip='';
  for(const [name,label,type='text']of fields){const l=el('label',label);const input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.name=name;input.required=true;input.maxLength=type==='textarea'?4000:2000;l.append(input);f.append(l);}
  const b=el('button',submitLabel);b.type='submit';f.append(b);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{await submit(Object.fromEntries(new FormData(f)));$('#drawer').close();await refresh();}catch(error){notice(error.message,true);let err=f.querySelector('[role=alert]');if(!err){err=el('p');err.setAttribute('role','alert');f.append(err);}err.textContent=error.message;}finally{b.disabled=false;}};container.append(f);return f;
}
// Verified key label (server-stamped) first, then the self-reported assistant name, marked as such.
function who(x){return x.actor+(x.credential_label?` · key ${x.credential_label} (verified)`:'')+(x.author_label?` · says "${x.author_label}" (unverified)`:'');}
function workflowDetails(h,attemptId=null){drawer('Bounded research workflow',c=>{
 const graph=workflowGraph(state,h.id,Date.now(),attemptId),box=el('div');
 if(graph.attempts.length){const label=el('label','Research attempt history'),select=el('select');select.id='workflow-attempt';for(const a of graph.attempts){const option=el('option',a.label);option.value=a.id;option.selected=a.id===graph.attemptId;select.append(option);}select.onchange=()=>workflowDetails(h,select.value);label.append(select);c.append(label);}
 renderWorkflow(box,graph,state);c.append(box);
 const [question,check,experiment,review,finding,decision]=graph.nodes;
 const base={hypothesisId:h.id,hypothesisVersion:h.revisions.length,evidenceIds:[]};
 c.append(action('Add non-independent advisory review',()=>drawer('Advisory review',c=>{
  c.append(el('p','Pack contributions are welcome under existing discussion access. This is non-independent advice. A receipt-bound advisory may inform a descriptive finding and owner disposition, but cannot satisfy scientific or holdout gates.'));
  const r=experiment.record,refs=r?.receiptHash&&r.hypothesisVersion===h.revisions.length?{receiptId:r.id,receiptHash:r.receiptHash}:{};
  form(c,[['body','Advice, concerns and limitations','textarea']],'Record advisory review',p=>command('discussion',{...base,...refs,...p,kind:'advisory_review'}));
 })));
 c.append(action('Check current synthetic input',async()=>{const checked=await command('discussion',{...base,kind:'data_check',body:'Schema and provenance check of the loaded synthetic discovery fixture. Not real development data.',tracking});await refresh();workflowDetails(state.hypotheses.find(x=>x.id===h.id),checked.id);}));
 if(check.status==='recorded')c.append(action('Queue bounded synthetic audit',async()=>{const queued=await command('task',{hypothesisId:h.id,dataCheckId:check.record.id,split:'discovery',budgetMs:5000,maxObservations:10000});await refresh();workflowDetails(state.hypotheses.find(x=>x.id===h.id),queued.id);}));
 if(experiment.status==='recorded'){
  const r=experiment.record,refs={...base,receiptId:r.id,receiptHash:r.receiptHash};
  c.append(action('Submit separate review',()=>drawer('Review this synthetic receipt',c=>{
   c.append(el('p','Requires a verified account subject distinct from the question authors and runner. Same-account assistants cannot satisfy this gate.'));
   form(c,[['body','Review rationale and limitations','textarea'],['disposition','Disposition: ready or changes_requested']],'Record review',p=>command('discussion',{...refs,...p,kind:'review'}));
  })));
  if(['recorded','advisory'].includes(review.status))c.append(action('Record descriptive finding',()=>drawer('Descriptive finding',c=>form(c,[['body','Finding and limitations; no scientific verdict','textarea']],'Record finding',p=>command('discussion',{...refs,...p,kind:'finding',reviewId:review.record.id})))));
  if(finding.status==='recorded'&&!decision.record)c.append(action('Owner decision',()=>drawer('Signed owner decision',c=>{
   c.append(el('p',review.record.kind==='advisory_review'?'Review basis: NON-INDEPENDENT advisory. Separate-account review is not satisfied.':'Review basis: distinct account subject only; scientific independence is not established.'));
   c.append(el('p','This records a disposition only. It does not authorize model fitting, access, deployment, or holdout use.'));
   form(c,[['body','Rationale','textarea'],['disposition','Disposition: accept_descriptive, revise, or defer']],'Record owner decision',p=>command('discussion',{...refs,...p,kind:'owner_decision',reviewId:review.record.id,findingId:finding.record.id}));
  })));
 }
});}
function hypothesisDetails(h) {const latest=h.revisions.at(-1);drawer(latest.title,c=>{
  c.append(el('p',`Revision ${latest.version} · ${latest.status||'exploratory'} · ${latest.family||'other'} · ${['supported','null','inconclusive'].includes(latest.status)?'owner-recorded verdict':'no verified/falsified verdict'}`),el('p',latest.method));
  const design=['target','predictionTime','cohort','featureCutoff','splitPolicy','baseline','metric','exclusions'].filter(k=>latest[k]);if(design.length){const dl=el('dl');for(const k of design)dl.append(el('dt',k),el('dd',latest[k]));c.append(dl);}
  c.append(action('Open dependency and evidence graph',()=>workflowDetails(h)));
  c.append(action('Queue descriptive audit',async()=>{await command('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000});$('#drawer').close();await refresh();}));
  c.append(el('h3','Discussion & independent challenges'));
  for(const d of state.discussions.filter(d=>d.hypothesisId===h.id)){c.append(el('p',`${d.kind} · ${d.separation|| (d.independent?'distinct account author; independence unproven':'same author / not independent')} · ${who(d)}`,'meta'),el('p',d.body));}
  const f=form(c,[['body','Challenge or observation','textarea']],'Record challenge',async p=>command('discussion',{...p,hypothesisId:h.id,kind:'challenge',evidenceIds:[]}));
  f.prepend(el('p','Independence compares verified account identities, not model names. Multiple AIs using one account are the same author.'));
  const history=el('details');history.append(el('summary','Revision history'),el('pre',JSON.stringify(h.revisions,null,2)));c.append(history);
  c.append(action('Revise hypothesis',()=>drawer('New hypothesis revision',c=>form(c,[['title','Title'],['method','Method and falsification criteria','textarea']],'Save revision',p=>command('hypothesis',{...p,id:h.id,expectedVersion:h.revisions.length})))));
});}
async function refresh() {
  const epoch=++renderEpoch,snapshot=await client.state();
  for(const t of snapshot.tasks){
    if(epoch!==renderEpoch)return;
    t.executionState=taskState(snapshot,t);
    if(t.executionState==='unverified'){
      try{const r=snapshot.receipts.find(r=>r.taskId===t.id);await coordinator.verifyReceipt(snapshot,t,r);t.executionState=r.outcome==='failure'?'failed':'completed';}
      catch{t.executionState='unverified';}
    }
  }
  if(epoch!==renderEpoch)return;
  snapshot.verifiedReceiptIds=snapshot.tasks.filter(t=>['completed','failed'].includes(t.executionState)).flatMap(t=>snapshot.receipts.filter(r=>r.taskId===t.id).map(r=>r.id));
  state=snapshot;$('.machine-status').dataset.ready='true';$('#receipt-count').textContent=`${state.receipts.length} ${state.receipts.length===1?'receipt':'receipts'}`;
  const active=state.tasks.filter(t=>['queued','expired','owned','foreign'].includes(t.executionState)),claimed=active.filter(t=>t.lease?.expiresAt>Date.now()).length;$('#queue-count').textContent=active.length;$('#active-tasks').textContent=`${active.length} active ${active.length===1?'task':'tasks'} / ${claimed} leased / ${active.length-claimed} awaiting claim`;
  const groups=FAMILIES.map(([family,label])=>[label,state.hypotheses.filter(h=>(h.revisions.at(-1).family||'other')===family)]).filter(([,list])=>list.length);
  $('#hypothesis-grid').replaceChildren(...groups.map(([label,list])=>{const g=el('section',undefined,'family-group'),grid=el('div',undefined,'grid');g.append(el('h3',`${label} · ${list.length}`,'eyebrow'),grid);grid.append(...list.map(h=>{const r=h.revisions.at(-1),n=el('article',undefined,'card');n.dataset.status=r.status||'exploratory';n.append(chip(r.status||'exploratory'),el('span',` v${r.version}`,'meta'),el('h3',r.title),el('p',r.method),action('Open research record ↗',()=>hypothesisDetails(h)));return n;}));return g;}));
  $('#tasks').replaceChildren(...state.tasks.map(t=>{const n=el('article',undefined,'task'),d=el('div'),status=t.executionState;n.dataset.status=status;
    d.append(el('strong',state.hypotheses.find(h=>h.id===t.hypothesisId)?.revisions[t.hypothesisVersion-1]?.title||t.hypothesisId),el('small',`${status}${coordinator.attemptState(t.id)?' · attempt: '+coordinator.attemptState(t.id):''} · reported: ${t.status} · discovery · ${t.budgetMs}ms / ${t.maxObservations} observations · requires experiment:run`));n.append(d);
    if(['queued','expired','owned'].includes(status))n.append(action(coordinator.pending(t.id)?'Reconcile pending attempt':status==='owned'?'Resume owned lease':client.mode==='hosted'?'Claim & run shared audit':client.mode==='browser'?'Run synthetic demo':'Claim & run locally',async()=>{
      if(continuing)throw Error('Stop continuation before a manual run');
      notice('Pending canonical claim / receipt verification. No completed work yet.');
      manualRunning=true;
      try{const result=await coordinator.run(t.id,tracking);notice(result.status==='failed'?`Audit failed: ${result.receipt.error}`:`Receipt recorded: ${result.receipt.outcome}. Verified synthetic discovery receipt; no hypothesis verdict.`,result.status==='failed');}
      finally{manualRunning=false;await refresh();}
    }));
    if(client.mode==='browser'&&t.dataCheckId&&['queued','expired','owned'].includes(status))n.append(action('Approve exact task for this session',()=>continuation.approve(t.id,tracking)));
    return n;}));
  $('#receipts').replaceChildren(...state.receipts.map(r=>{const d=el('details'),s=el('summary');s.append(...(r.synthetic?[el('span','SYNTHETIC','tag synthetic-badge'),' ']:[]),`${state.verifiedReceiptIds.includes(r.id)?'VERIFIED RECEIPT':'UNVERIFIED / HISTORICAL RECORD'} · ${r.outcome.toUpperCase()}${r.reason?' ('+r.reason+')':''} · ${r.at} · ${r.id.slice(0,8)}`);d.append(s,el('pre',JSON.stringify(r,null,2)));return d;}));
  $('#evidence').replaceChildren(...state.evidence.map(e=>{const n=el('article'),a=el('a',e.title);a.href=e.url;a.target='_blank';a.rel='noopener noreferrer';n.append(a,el('p',e.excerpt),el('span',e.assessment+' · '+who(e),'meta'));return n;}));
  if(!state.evidence.length)$('#evidence').append(el('p','No cited evidence yet. Add a source and excerpt; claims remain unverified.'));
  $('#audit').replaceChildren(el('pre',JSON.stringify(state.audit,null,2)));
}
$('#new-hypothesis').onclick=()=>drawer('Propose a hypothesis',c=>form(c,[['title','Title'],['method','Method and falsification criteria','textarea']],'Save hypothesis',p=>command('hypothesis',p)));
$('#add-evidence').onclick=()=>drawer('Cite shared evidence',c=>form(c,[['title','Source title'],['url','Source URL','url'],['excerpt','Relevant excerpt and limitations','textarea']],'Save evidence',p=>command('evidence',p)));
$('#methods').onclick=()=>drawer('Methods & schema',c=>{
  c.append(el('p','Internal normalized contract v1. This is not a claimed 2027 competition schema. Adapters, credentials, agent scheduling and verified-data access are unconfigured.'),el('p','The local runner only accepts synthetic discovery data. Held-out data is rejected. Uploaded JSON stays in your browser until you run an audit; accepted synthetic input then goes to the selected runner. No AI provider is connected. Do not load restricted data into a public preview.'));
  c.append(el('p','Archive verified: 512,718,566 bytes, nine CSV files, SHA-256 27d52f594d6d31d4f617f9c94b0b37d11e280397ad8293c0987da5f91a8d0ced. That verifies the bytes only. Per-file schema, units and sampling rate have not been profiled in this lab; measurements unverified. The archive stays on the owner\'s machine and is never uploaded here.'));const source=el('a','Official competition data listing');source.href='https://www.kaggle.com/competitions/nfl-big-data-bowl-2027/data';source.target='_blank';source.rel='noopener noreferrer';c.append(source);
  const a=el('a','Read the API/MCP integration contract');a.href='CONTRACT.md';a.target='_blank';a.rel='noopener';c.append(a);
  c.append(action('Download synthetic contract example',()=>{const blob=new Blob([JSON.stringify(tracking,null,2)],{type:'application/json'});const a=el('a');a.href=URL.createObjectURL(blob);a.download='synthetic-tracking.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}));
});
$('#load').onclick=()=>drawer('Load normalized tracking',c=>{c.append(el('p','JSON · max 2 MB · discovery only. Nulls and source frame IDs are retained. No conversion or inferred schema.'));
  const input=el('input');input.type='file';input.accept='.json,application/json';input.setAttribute('aria-label','Normalized tracking JSON');c.append(input);input.onchange=async()=>{try{const file=input.files[0];if(!file)return;if(file.size>2_000_000)throw new Error('File exceeds 2 MB');setTracking(validateTracking(JSON.parse(await file.text())));$('#drawer').close();notice('Tracking loaded locally. This does not verify provenance or create a research result.');}catch(e){c.append(el('p',e.message,'error'));}};
});
function setTracking(d) {stop();tracking=d;index=0;$('#scrub').max=d.frames.length-1;$('#scrub').value=0;$('#jog').setAttribute('aria-valuemax',d.frames.length-1);$('#jog').setAttribute('aria-valuenow','0');$('#jog').style.setProperty('--rotation','-150deg');$('.machine-status .tag').textContent=`${d.provenance.kind.toUpperCase()} / DISCOVERY`;
  $('#provenance').textContent=`${d.provenance.kind.toUpperCase()} / ${d.provenance.source}. ${d.provenance.note}`;
  $('#cohort-grid').replaceChildren(...summarize(d).map(g=>{const n=el('article',undefined,'card'),meter=el('meter');meter.min=0;meter.max=30;meter.value=g.meanSpeed??0;meter.setAttribute('aria-label',`${g.cohort} mean speed in yards per second`);n.dataset.cohort=g.cohort.toLowerCase();n.append(el('span',g.cohort,'meta'),el('div',g.meanSpeed===null?'—':g.meanSpeed.toFixed(2),'metric'),el('p',`Mean speed · yards/s · ${g.speedCount} observations`),meter,el('p',`Motion/body angle: ${g.meanMotionBodyAngle===null?'missing':g.meanMotionBodyAngle.toFixed(1)+'°'}. Missing fields: ${g.missingFields}.`));return n;}));render();}
function render() {
  if(!tracking)return;const f=tracking.frames[index];$('#frame-label').textContent=`${f.sourceFrameId} / ${f.timeMs} ms`;$('#events').textContent=f.events.join(' · ');
  const selected=$('#entity').value;$('#entity').replaceChildren(...f.entities.map(e=>{const o=el('option',e.id);o.value=e.id;return o;}));if(f.entities.some(e=>e.id===selected))$('#entity').value=selected;
  const entityFocus=$('#entity-switches').contains(document.activeElement)?document.activeElement.textContent:null;
  $('#entity-switches').replaceChildren(...f.entities.map(e=>{const b=el('button',e.id);b.setAttribute('aria-pressed',String(e.id===$('#entity').value));b.onclick=()=>{$('#entity').value=e.id;render();$('#entity-switches').querySelectorAll('button')[f.entities.indexOf(e)]?.focus();};return b;}));
  if(entityFocus)[...$('#entity-switches').querySelectorAll('button')].find(b=>b.textContent===entityFocus)?.focus({preventScroll:true});
  const e=f.entities.find(e=>e.id===$('#entity').value);$('#entity-details').textContent=e?`x ${e.x??'missing'} · y ${e.y??'missing'}\nSpeed ${e.speed??'missing'}\nMissing: ${e.missing.join(', ')||'none'}`:'Empty frame — no entities supplied';
  const canvas=$('#field'),rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;if(!rect.width||!rect.height)return;canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,rect.width,rect.height);
  const scale=Math.min((rect.width-20)/120,(rect.height-20)/(160/3)),left=(rect.width-120*scale)/2,top=(rect.height-(160/3)*scale)/2;
  canvas.dataset.yardScale=String(scale);const xy=(x,y)=>[left+x*scale,top+(160/3-y)*scale];
  ctx.strokeStyle='#66745c';ctx.lineWidth=1;ctx.strokeRect(left,top,120*scale,(160/3)*scale);ctx.font='10px monospace';ctx.fillStyle='#9ca58c';
  for(let yard=10;yard<120;yard+=10){const x=left+yard*scale;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+(160/3)*scale);ctx.stroke();ctx.fillText(String(yard),x+3,top+13);}
  for(const p of f.entities){if(p.x===null||p.y===null)continue;const [x,y]=xy(p.x,p.y);ctx.fillStyle=p.kind==='ball'?'#f1e8d6':p.cohort==='Amber'?'#ffb300':'#2dd4ac';ctx.beginPath();ctx.arc(x,y,p.kind==='ball'?3:5,0,Math.PI*2);ctx.fill();if(p.id===e?.id){ctx.strokeStyle='#fff';ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.stroke();}if(p.o!==null){ctx.strokeStyle=ctx.fillStyle;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(p.o*Math.PI/180)*12,y-Math.sin(p.o*Math.PI/180)*12);ctx.stroke();}}
}
function step(i) {index=Math.max(0,Math.min(tracking.frames.length-1,i));$('#scrub').value=index;$('#jog').setAttribute('aria-valuenow',index);$('#jog').setAttribute('aria-valuetext',`Frame ${index+1} of ${tracking.frames.length}`);$('#jog').style.setProperty('--rotation',`${index/Math.max(1,tracking.frames.length-1)*300-150}deg`);render();if($('#audio').checked){audioContext??=new AudioContext();const oscillator=audioContext.createOscillator(),gain=audioContext.createGain();gain.gain.value=.025;oscillator.frequency.value=220+index*5;oscillator.connect(gain).connect(audioContext.destination);oscillator.start();oscillator.stop(audioContext.currentTime+.025);}}
function stop(){playing=false;clearTimeout(timer);$('#play').textContent='Play';}
function tick(){if(!playing)return;if(index>=tracking.frames.length-1)return stop();const delay=tracking.frames[index+1].timeMs-tracking.frames[index].timeMs;timer=setTimeout(()=>{step(index+1);tick();},delay);}
$('#play').onclick=()=>{if(playing)return stop();if(index===tracking.frames.length-1)step(0);playing=true;$('#play').textContent='Pause';tick();};
$('#previous').onclick=()=>{stop();step(index-1);};$('#next').onclick=()=>{stop();step(index+1);};
$('#scrub').oninput=e=>{stop();step(Number(e.target.value));};
$('#jog').onkeydown=e=>{const next=e.key==='Home'?0:e.key==='End'?tracking.frames.length-1:['ArrowRight','ArrowUp'].includes(e.key)?index+1:['ArrowLeft','ArrowDown'].includes(e.key)?index-1:null;if(next!==null){e.preventDefault();stop();step(next);}};
function turnWheel(e){const r=$('#jog').getBoundingClientRect(),degrees=Math.atan2(e.clientY-r.top-r.height/2,e.clientX-r.left-r.width/2)*180/Math.PI+90,angle=((degrees+180+360)%360)-180;step(Math.round((Math.max(-150,Math.min(150,angle))+150)/300*(tracking.frames.length-1)));}
$('#jog').onpointerdown=e=>{stop();$('#jog').focus();$('#jog').setPointerCapture(e.pointerId);turnWheel(e);};$('#jog').onpointermove=e=>{if($('#jog').hasPointerCapture(e.pointerId))turnWheel(e);};$('#jog').onpointerup=e=>{if($('#jog').hasPointerCapture(e.pointerId))$('#jog').releasePointerCapture(e.pointerId);};
$('#entity').onchange=render;new ResizeObserver(render).observe($('#field'));document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
try{setTracking(validateTracking(await client.tracking()));await refresh();notice(`${client.mode==='hosted'?'Shared':client.mode==='browser'?'Browser demo':'Local'} runner ready. Synthetic discovery only; external AIs and schedules are unconfigured.${client.mode==='browser'?' Demo records reset when this page reloads.':''}`);$('.machine-status small').textContent=`${client.mode==='hosted'?'Shared':client.mode==='browser'?'Browser demo':'Local'} runner · external AIs unconfigured · holdout disabled`;$('#queue .tag').textContent=client.mode==='hosted'?'SHARED FIXED AUDIT':client.mode==='browser'?'THIS TAB / MEMORY ONLY':'LOCAL BUILT-IN RUNNER';}catch(e){if(client.mode==='hosted')globalThis.DDAccount?.failed(e.status);notice(e.message,true);}

// Real data: renders research-lab/data/manifest-summary.json and nothing else. The summary is
// written by the owner's local manifest.py; raw rows never reach this page.
async function loadRealData(){
  const box=$('#real-data');if(!box||realData)return;realData=true;box.replaceChildren(el('p','Checking for a manifest summary…'));
  let summary=null;try{const r=await fetch('data/manifest-summary.json',{cache:'no-store'});if(r.ok)summary=await r.json();}catch{}
  if(!summary||!Array.isArray(summary.files)){box.replaceChildren(el('p','No manifest summary is published here yet. The owner runs research-lab/data/manifest.py on their own machine; only its redacted summary would appear in this tab. No raw data is loaded.'));return;}
  const head=el('p',`Archive ${summary.archive?.sha256?summary.archive.sha256.slice(0,12)+'…':'unhashed'} · ${summary.files.length} files · generated ${summary.generated_at||'unknown'} · ${summary.note||'counts only'}`);
  const table=el('table'),hr=el('tr');for(const h of ['File','Bytes','Rows','Columns','Key unique','Max null share','SHA-256'])hr.append(el('th',h));table.append(hr);
  for(const f of summary.files){const tr=el('tr');for(const v of [f.file,f.bytes?.toLocaleString?.()??f.bytes,f.rows?.toLocaleString?.()??f.rows,f.columns,f.key_unique===undefined?'—':String(f.key_unique),f.max_null_share===undefined?'—':String(f.max_null_share),f.sha256?f.sha256.slice(0,12)+'…':'—'])tr.append(el('td',v===undefined||v===null?'—':String(v)));table.append(tr);}
  box.replaceChildren(head,table,el('p','Counts and shapes only. Not a finding, not a fitted baseline, and not evidence for any hypothesis.','meta'));
}
function clearVisibleState(){continuation.clear();renderEpoch++;coordinator.clear();globalThis.DDAccount?.reset();state=null;stop();$('.machine-status').dataset.ready='false';for(const id of ['hypothesis-grid','tasks','receipts','evidence','audit'])$('#'+id).replaceChildren();if($('#real-data')){$('#real-data').replaceChildren();realData=false;}$('#receipt-count').textContent='State cleared';$('#drawer').close();$('#drawer-content').replaceChildren();notice('Identity changed. Reload to verify research access.',true);}
window.addEventListener('storage',e=>{if(e.key==='dd-bozo-sess'||e.key===null)client.invalidate();});
