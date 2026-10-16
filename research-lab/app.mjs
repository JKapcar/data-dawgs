import {validateTracking,summarize} from './tracking.mjs';
const $=s=>document.querySelector(s),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
let state,tracking,index=0,playing=false,timer,returnFocus,audioContext;
const notice=(message,error=false)=>{$('#notice').textContent=message;$('#notice').classList.toggle('error',error);};
async function api(url,body) {const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}
const command=(type,payload)=>api('/api/command',{type,payload,key:crypto.randomUUID()});
const action=(label,fn)=>{const b=el('button',label);b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){notice(e.message,true);}finally{b.disabled=false;}};return b;};
function drawer(title,build) {stop();const wasOpen=$('#drawer').open;if(!wasOpen)returnFocus=document.activeElement;const content=$('#drawer-content');content.replaceChildren(el('h2',title));build(content);if(!wasOpen)$('#drawer').showModal();else $('#drawer').querySelector('button,input,textarea')?.focus();}
$('#drawer').addEventListener('close',()=>returnFocus?.focus());
function form(container,fields,submitLabel,submit) {
  const f=el('form');f.dataset.ddbSkip='';
  for(const [name,label,type='text']of fields){const l=el('label',label);const input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.name=name;input.required=true;input.maxLength=type==='textarea'?4000:2000;l.append(input);f.append(l);}
  const b=el('button',submitLabel);b.type='submit';f.append(b);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{await submit(Object.fromEntries(new FormData(f)));$('#drawer').close();await refresh();}catch(error){notice(error.message,true);let err=f.querySelector('[role=alert]');if(!err){err=el('p');err.setAttribute('role','alert');f.append(err);}err.textContent=error.message;}finally{b.disabled=false;}};container.append(f);return f;
}
function hypothesisDetails(h) {const latest=h.revisions.at(-1);drawer(latest.title,c=>{
  c.append(el('p',`Revision ${latest.version} · exploratory · no verified/falsified verdict`),el('p',latest.method));
  c.append(action('Queue descriptive audit',async()=>{await command('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000});$('#drawer').close();await refresh();}));
  c.append(el('h3','Discussion & independent challenges'));
  for(const d of state.discussions.filter(d=>d.hypothesisId===h.id)){c.append(el('p',`${d.kind} · ${d.independent?'independent author':'same author / not independent'} · ${d.actor}`,'meta'),el('p',d.body));}
  const f=form(c,[['body','Challenge or observation','textarea']],'Record challenge',async p=>command('discussion',{...p,hypothesisId:h.id,kind:'challenge',evidenceIds:[]}));
  f.prepend(el('p','Local-owner challenges are explicitly marked not independent. External contributors are not connected.'));
  const history=el('details');history.append(el('summary','Revision history'),el('pre',JSON.stringify(h.revisions,null,2)));c.append(history);
  c.append(action('Revise hypothesis',()=>drawer('New hypothesis revision',c=>form(c,[['title','Title'],['method','Method and falsification criteria','textarea']],'Save revision',p=>command('hypothesis',{...p,id:h.id,expectedVersion:h.revisions.length})))));
});}
async function refresh() {
  state=await api('/api/state');$('#receipt-count').textContent=`${state.receipts.length} receipts`;
  $('#hypothesis-grid').replaceChildren(...state.hypotheses.map(h=>{const r=h.revisions.at(-1),n=el('article',undefined,'card');n.append(el('span',`EXPLORATORY / v${r.version}`,'meta'),el('h3',r.title),el('p',r.method),action('Open research record ↗',()=>hypothesisDetails(h)));return n;}));
  $('#tasks').replaceChildren(...state.tasks.map(t=>{const n=el('article',undefined,'task'),d=el('div');d.append(el('strong',state.hypotheses.find(h=>h.id===t.hypothesisId)?.revisions[t.hypothesisVersion-1]?.title||t.hypothesisId),el('small',`${t.status} · discovery · ${t.budgetMs}ms / ${t.maxObservations} observations · requires experiment:run`));n.append(d);if(t.status!=='completed')n.append(action(t.lease&&t.lease.expiresAt>Date.now()?'Resume owned lease':'Claim & run locally',async()=>{
    let claimed=t;if(!t.lease||t.lease.expiresAt<=Date.now())claimed=await command('claim',{taskId:t.id,leaseMs:60000});
    const receipt=await command('run',{taskId:t.id,leaseToken:claimed.lease.token,tracking});notice(`Receipt recorded: ${receipt.outcome}. Synthetic discovery; no hypothesis verdict.`);await refresh();
  }));return n;}));
  $('#receipts').replaceChildren(...state.receipts.map(r=>{const d=el('details');d.append(el('summary',`${r.outcome.toUpperCase()} · ${r.at} · ${r.id.slice(0,8)}`),el('pre',JSON.stringify(r,null,2)));return d;}));
  $('#evidence').replaceChildren(...state.evidence.map(e=>{const n=el('article'),a=el('a',e.title);a.href=e.url;a.target='_blank';a.rel='noopener noreferrer';n.append(a,el('p',e.excerpt),el('span',e.assessment,'meta'));return n;}));
  if(!state.evidence.length)$('#evidence').append(el('p','No cited evidence yet. Add a source and excerpt; claims remain unverified.'));
  $('#audit').replaceChildren(el('pre',JSON.stringify(state.audit,null,2)));
}
$('#new-hypothesis').onclick=()=>drawer('Propose a hypothesis',c=>form(c,[['title','Title'],['method','Method and falsification criteria','textarea']],'Save hypothesis',p=>command('hypothesis',p)));
$('#add-evidence').onclick=()=>drawer('Cite shared evidence',c=>form(c,[['title','Source title'],['url','Source URL','url'],['excerpt','Relevant excerpt and limitations','textarea']],'Save evidence',p=>command('evidence',p)));
$('#methods').onclick=()=>drawer('Methods & schema',c=>{
  c.append(el('p','Internal normalized contract v1. This is not a claimed 2027 competition schema. Adapters, credentials, agent scheduling and verified-data access are unconfigured.'),el('p','The local runner only accepts synthetic discovery data. Held-out data is rejected. Uploaded JSON stays in this local process and is never sent to an AI provider. Do not load restricted data into a public preview.'));
  const a=el('a','Read the API/MCP integration contract');a.href='/CONTRACT.md';a.target='_blank';a.rel='noopener';c.append(a);
  c.append(action('Download synthetic contract example',()=>{const blob=new Blob([JSON.stringify(tracking,null,2)],{type:'application/json'});const a=el('a');a.href=URL.createObjectURL(blob);a.download='synthetic-tracking.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}));
});
$('#load').onclick=()=>drawer('Load normalized tracking',c=>{c.append(el('p','JSON · max 2 MB · discovery only. Nulls and source frame IDs are retained. No conversion or inferred schema.'));
  const input=el('input');input.type='file';input.accept='.json,application/json';input.setAttribute('aria-label','Normalized tracking JSON');c.append(input);input.onchange=async()=>{try{const file=input.files[0];if(!file)return;if(file.size>2_000_000)throw new Error('File exceeds 2 MB');setTracking(validateTracking(JSON.parse(await file.text())));$('#drawer').close();notice('Tracking loaded locally. This does not verify provenance or create a research result.');}catch(e){c.append(el('p',e.message,'error'));}};
});
function setTracking(d) {stop();tracking=d;index=0;for(const id of ['scrub','jog']){$('#'+id).max=d.frames.length-1;$('#'+id).value=0;}
  $('#provenance').textContent=`${d.provenance.kind.toUpperCase()} / ${d.provenance.source}. ${d.provenance.note}`;
  $('#cohort-grid').replaceChildren(...summarize(d).map(g=>{const n=el('article',undefined,'card');n.append(el('span',g.cohort,'meta'),el('div',g.meanSpeed===null?'—':g.meanSpeed.toFixed(2),'metric'),el('p',`Mean speed · yards/s · ${g.speedCount} observations`),el('p',`Motion/body angle: ${g.meanMotionBodyAngle===null?'missing':g.meanMotionBodyAngle.toFixed(1)+'°'}. Missing fields: ${g.missingFields}.`));return n;}));render();}
function render() {
  if(!tracking)return;const f=tracking.frames[index];$('#frame-label').textContent=`${f.sourceFrameId} / ${f.timeMs} ms`;$('#events').textContent=f.events.join(' · ');
  const selected=$('#entity').value;$('#entity').replaceChildren(...f.entities.map(e=>{const o=el('option',e.id);o.value=e.id;return o;}));if(f.entities.some(e=>e.id===selected))$('#entity').value=selected;
  const e=f.entities.find(e=>e.id===$('#entity').value);$('#entity-details').textContent=e?`x ${e.x??'missing'} · y ${e.y??'missing'}\nSpeed ${e.speed??'missing'}\nMissing: ${e.missing.join(', ')||'none'}`:'Empty frame — no entities supplied';
  const canvas=$('#field'),rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,rect.width,rect.height);
  const scale=Math.min((rect.width-20)/120,(rect.height-20)/(160/3)),left=(rect.width-120*scale)/2,top=(rect.height-(160/3)*scale)/2;
  canvas.dataset.yardScale=String(scale);const xy=(x,y)=>[left+x*scale,top+(160/3-y)*scale];
  ctx.strokeStyle='#66745c';ctx.lineWidth=1;ctx.strokeRect(left,top,120*scale,(160/3)*scale);ctx.font='10px monospace';ctx.fillStyle='#9ca58c';
  for(let yard=10;yard<120;yard+=10){const x=left+yard*scale;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+(160/3)*scale);ctx.stroke();ctx.fillText(String(yard),x+3,top+13);}
  for(const p of f.entities){if(p.x===null||p.y===null)continue;const [x,y]=xy(p.x,p.y);ctx.fillStyle=p.kind==='ball'?'#f1e8d6':p.cohort==='Amber'?'#ffb300':'#2dd4ac';ctx.beginPath();ctx.arc(x,y,p.kind==='ball'?3:5,0,Math.PI*2);ctx.fill();if(p.id===e?.id){ctx.strokeStyle='#fff';ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.stroke();}if(p.o!==null){ctx.strokeStyle=ctx.fillStyle;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(p.o*Math.PI/180)*12,y-Math.sin(p.o*Math.PI/180)*12);ctx.stroke();}}
}
function step(i) {index=Math.max(0,Math.min(tracking.frames.length-1,i));$('#scrub').value=index;$('#jog').value=index;render();if($('#audio').checked){audioContext??=new AudioContext();const oscillator=audioContext.createOscillator(),gain=audioContext.createGain();gain.gain.value=.025;oscillator.frequency.value=220+index*5;oscillator.connect(gain).connect(audioContext.destination);oscillator.start();oscillator.stop(audioContext.currentTime+.025);}}
function stop(){playing=false;clearTimeout(timer);$('#play').textContent='Play';}
function tick(){if(!playing)return;if(index>=tracking.frames.length-1)return stop();const delay=tracking.frames[index+1].timeMs-tracking.frames[index].timeMs;timer=setTimeout(()=>{step(index+1);tick();},delay);}
$('#play').onclick=()=>{if(playing)return stop();if(index===tracking.frames.length-1)step(0);playing=true;$('#play').textContent='Pause';tick();};
$('#previous').onclick=()=>{stop();step(index-1);};$('#next').onclick=()=>{stop();step(index+1);};
for(const id of ['scrub','jog'])$('#'+id).oninput=e=>{stop();step(Number(e.target.value));};
$('#entity').onchange=render;new ResizeObserver(render).observe($('#field'));document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
try{setTracking(validateTracking(await api('/api/tracking')));await refresh();notice('Local runner ready. Synthetic discovery data only; external AIs and schedules are unconfigured.');}catch(e){notice('Local runner unavailable. Start node research-lab/server.mjs. '+e.message,true);}
