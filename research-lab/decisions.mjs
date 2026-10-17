import {mechanisms,validateAnswer,answerLabel} from './decision-controls.mjs';
const $=s=>document.querySelector(s),origin='https://toto.jkapcar4.workers.dev';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn,cls='')=>{const b=el('button',text,cls);b.type='button';b.onclick=fn;return b;};
const token=()=>globalThis.DDAccount?.token()||'';
let state=null,filter='all',pending=null,preview=null,loadedProject='',loadedToken='',busy=false;
const status=t=>{$('#status').textContent=t;};
async function request(body){
 const credential=token();if(!credential)throw Error('Sign in to read your private decisions.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{const r=await fetch(origin+'/api/project/v1/'+loadedProject,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+credential,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:controller.signal});
 if(token()!==credential)throw Error('Account changed. Reload before continuing.');
 const value=await r.json();if(!r.ok){globalThis.DDAccount?.failed(r.status);throw Object.assign(Error(value.error||'Request failed'),{status:r.status});}
 globalThis.DDAccount?.verified(credential);return value;
 }finally{clearTimeout(timer);}
}
function clear(){state=null;$('#cards').replaceChildren();$('#filters').replaceChildren();}
async function load(){
 if(busy||pending)return;clear();loadedProject=$('#project').value.trim();loadedToken=token();
 if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(loadedProject)){status('Enter a valid project ID.');return;}
 if(!loadedToken){status('Sign in to read this private project. No decision records are loaded.');return;}
 status('Reading private project…');busy=true;
 try{const out=await request();state=out.project;render();status(out.exists?'Project revision '+state.revision+' · '+state.decisions.filter(d=>d.deck&&!d.archived&&['proposed','voting'].includes(d.status)).length+' authored deck items.':'This project has no stored records. No decisions have been invented.');}
 catch(e){clear();status(e.message==='projects_disabled'?'Decision storage is not enabled. This page cannot save answers until the project backend is approved and activated.':e.message);}finally{busy=false;}
}
function render(){
 const rows=state.decisions.filter(d=>d.deck&&!d.archived&&['proposed','voting'].includes(d.status));
 const stages=['all','ready_for_decision','needs_research','proposed','answered','deferred','stale'];
 $('#filters').replaceChildren(...stages.map(s=>{const b=button(s.replaceAll('_',' '),()=>{filter=s;render();});b.setAttribute('aria-pressed',String(filter===s));return b;}));
 const visible=rows.filter(d=>filter==='all'||d.deck_status===filter);
 $('#cards').replaceChildren(...visible.map(card));
 if(!visible.length)$('#cards').append(el('p',rows.length?'No items in this status.':'No authored decision briefs yet. Existing tasks and legacy proposals are not automatically ready for a decision.','muted'));
}
function paragraph(parent,title,text){const p=el('p');p.append(el('strong',title+' '),document.createTextNode(text));parent.append(p);}
function link(url,label){const a=el('a',label);try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)return el('span',label+' (invalid link)');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';return a;}catch{return el('span',label+' (invalid link)');}}
function card(row){
 const d=row.deck,n=el('article',undefined,'card');n.dataset.id=row.id;
 n.append(el('span',row.deck_status.replaceAll('_',' '),'badge'),el('h2',row.title));
 const facts=el('div',undefined,'facts');paragraph(facts,'Why now:',d.why_now);paragraph(facts,'Deadline:',d.deadline||'No deadline specified.');paragraph(facts,'Consequence:',d.consequence);paragraph(facts,'Research checked:',d.researched_at);n.append(facts);
 const detail=el('details'),summary=el('summary','Understand this decision');detail.append(summary,el('p',d.lesson,'lesson'));
 if(row.context)paragraph(detail,'Context:',row.context);
 detail.append(el('h3','Options & tradeoffs'));for(const o of row.options){const box=el('div',undefined,'tradeoff');box.append(el('strong',o.text),el('p',o.consequences||'Tradeoff research missing.'));detail.append(box);}
 paragraph(detail,'Recommendation:',d.recommendation);paragraph(detail,'Strongest counterargument:',d.counterargument);paragraph(detail,'Uncertainty:',d.uncertainty);
 paragraph(detail,'Dependent work:',d.dependent_work.length?d.dependent_work.join(' · '):'None recorded.');paragraph(detail,'Review valid until:',d.valid_until);
 detail.append(el('h3','Sources & what they support'));if(!d.sources.length)detail.append(el('p','No sources attached; research is incomplete.'));
 for(const s of d.sources){const p=el('p');p.append(link(s.url,s.title),el('small',' · checked '+s.checked_at),el('br'),document.createTextNode(s.claim));detail.append(p);}n.append(detail);
 const response=(row.responses||[]).at(-1);if(response){const p=el('p',`Last record: ${response.disposition.replaceAll('_',' ')} · ${response.at} · ${response.by?.actor_kind||'unknown actor'} · ${response.by?.uid||'unknown'}${response.proposal_version!==row.proposal_version?' · earlier proposal version':''}`,'receipt');n.append(p);
  const context=response.answer_context||(response.proposal_version===row.proposal_version?{control:d.control,options:row.options}:null);
  if(response.disposition==='answer'&&context)n.append(el('pre','Recorded answer\n'+answerLabel(context.control,context.options,response.answer)));
  paragraph(n,'Recorded rationale:',response.rationale);
 }
 if(d.authorization.intent_only){const p=el('p','This is an intent record. The consequential action still needs its separate approval. ','warning');p.append(link(d.authorization.approval_url,'Open required approval'));n.append(p);}
 const form=el('form',undefined,'answer'),fieldset=el('fieldset');fieldset.append(el('legend',mechanisms[d.control.kind]?.label||'Unsupported control'));
 const ready=d.stage==='ready_for_decision'&&Date.parse(d.valid_until)>Date.now();
 if(!ready)form.append(el('p','Research must be ready and current before an answer can be confirmed. You can defer or request more information.','warning'));
 const read=renderControl(fieldset,row);fieldset.disabled=!ready;form.append(fieldset);
 const id='reason-'+row.id,label=el('label','Your rationale / information needed'),reason=el('textarea');label.htmlFor=id;reason.id=id;reason.maxLength=2000;reason.required=true;form.append(label,reason);
 const actions=el('div',undefined,'row'),error=el('p');error.setAttribute('role','status');
 function review(disposition){
  if(pending||busy)return;
  if(!reason.value.trim()){error.textContent='Add a rationale or say what information you need.';reason.focus();return;}
  const answer=disposition==='answer'?read():{};const problem=disposition==='answer'?validateAnswer(d.control,row.options,answer):null;
  if(problem){error.textContent=problem;return;}
  preview={row,disposition,answer,rationale:reason.value.trim()};$('#previewTitle').textContent='Review before saving';$('#previewItem').textContent=row.title;
  $('#previewAnswer').textContent=(disposition==='answer'?answerLabel(d.control,row.options,answer):disposition==='defer'?'Defer this decision':'Request more information')+'\n\n'+preview.rationale;
  $('#previewCaution').textContent='Proposal '+row.proposal_version.slice(0,12)+' · '+(d.authorization.intent_only?'Intent only; separate approval is still required.':'This records a decision only. It does not execute work.');
  $('#previewStatus').textContent='';$('#confirm').textContent='Confirm & save';$('#back').disabled=false;$('#preview').showModal();$('#back').focus();
 }
 const primary=button('Preview answer',()=>review('answer'));primary.disabled=!ready;actions.append(primary,button('Defer',()=>review('defer'),'secondary'),button('Need more information',()=>review('need_information'),'secondary'));form.append(actions,error);form.onsubmit=e=>{e.preventDefault();review('answer');};n.append(form);return n;
}
function renderControl(fieldset,row){
 const c=row.deck.control,options=row.options,inputs=[];
 if(c.kind==='choice'){
  for(const o of options){const label=el('label',undefined,'option'),input=el('input');input.type='radio';input.name='choice-'+row.id;input.value=o.id;label.append(input,el('span',o.text));fieldset.append(label);inputs.push(input);}
  return ()=>({choice:inputs.find(i=>i.checked)?.value||''});
 }
 if(c.kind==='scale'){
  const id='scale-'+row.id,label=el('label',`Value (${c.unit}) · ${c.min}–${c.max}, step ${c.step}`),number=el('input'),range=el('input'),hint=el('small','No value selected.');label.htmlFor=id;number.id=id;number.type='number';number.min=c.min;number.max=c.max;number.step=c.step;number.value='';range.type='range';range.min=c.min;range.max=c.max;range.step=c.step;range.value=c.min;range.setAttribute('aria-label',`Explore ${c.unit}; no answer selected until you move this slider or enter a number`);range.oninput=()=>{number.value=range.value;hint.textContent=range.value+' '+c.unit;};number.oninput=()=>{range.value=number.value||c.min;hint.textContent=number.value?number.value+' '+c.unit:'No value selected.';};fieldset.append(label,number,range,hint);return ()=>({number:number.value===''?null:Number(number.value)});
 }
 for(const [index,o] of options.entries()){
  const label=el('label',o.text),id='input-'+row.id+'-'+o.id,input=el(c.kind==='budget'?'input':'select');label.htmlFor=id;input.id=id;
  if(c.kind==='budget'){input.type='number';input.min=0;input.max=c.total;input.step=1;input.value='';}
  else{const empty=el('option','Choose…');empty.value='';input.append(empty);const choices=c.kind==='rank'?options.map((_,i)=>({id:String(i+1),label:'Position '+(i+1)})):c.buckets;for(const b of choices){const opt=el('option',b.label);opt.value=b.id;input.append(opt);}}
  inputs.push({id:o.id,input});fieldset.append(label,input);
 }
 if(c.kind==='budget'){const sum=el('p',`Allocate ${c.total} ${c.unit}. Nothing allocated yet.`);fieldset.append(sum);for(const {input} of inputs)input.oninput=()=>sum.textContent=`${inputs.reduce((n,x)=>n+Number(x.input.value||0),0)} / ${c.total} ${c.unit} allocated`;return ()=>({allocations:inputs.map(x=>({id:x.id,amount:x.input.value===''?null:Number(x.input.value)}))});}
 if(c.kind==='rank')return ()=>({order:inputs.every(x=>x.input.value)&&new Set(inputs.map(x=>x.input.value)).size===inputs.length?[...inputs].sort((a,b)=>Number(a.input.value)-Number(b.input.value)).map(x=>x.id):[]});
 return ()=>({assignments:inputs.map(x=>({id:x.id,bucket:x.input.value}))});
}
$('#back').onclick=()=>$('#preview').close();$('#preview').addEventListener('cancel',e=>{if(pending||busy)e.preventDefault();});
$('#confirm').onclick=async()=>{
 if(busy||!preview)return;
 if(token()!==loadedToken){$('#previewStatus').textContent='Account changed. Close and reload before saving.';return;}
 if(!pending)pending={op:'decision.respond',expected_revision:state.revision,request_id:crypto.randomUUID(),data:{id:preview.row.id,expected_record_revision:preview.row.revision,proposal_version:preview.row.proposal_version,disposition:preview.disposition,answer:preview.answer,rationale:preview.rationale}};
 busy=true;$('#confirm').disabled=true;$('#back').disabled=true;$('#previewStatus').textContent='Saving, then verifying the stored response…';
 try{const out=await request(pending),fresh=await request();const row=fresh.project.decisions.find(d=>d.id===pending.data.id),saved=row?.responses?.find(r=>r.request_id===pending.request_id);
  if(!saved||saved.proposal_version!==pending.data.proposal_version||row.revision<out.receipt.record_revision)throw Error('Write receipt received, but readback is not verified. Retry the same request.');
  state=fresh.project;const receipt=pending.request_id;pending=null;$('#preview').close();render();status('Saved and read back · request '+receipt+' · project revision '+state.revision+'. No action was executed.');
 }catch(e){if(e.status===409){pending=null;$('#back').disabled=false;$('#preview').close();clear();status('The project or proposal changed. Reopen the project, review the new version, then answer again.');}
  else{$('#previewStatus').textContent='Save not verified: '+e.message+' Retry uses the same request ID; do not submit a replacement.';$('#confirm').textContent='Retry & verify';}
 }finally{busy=false;$('#confirm').disabled=false;}
};
$('#projectForm').onsubmit=e=>{e.preventDefault();load();};
for(const m of Object.values(mechanisms))$('#mechanisms').append(el('span',m.label+' — '+m.status,'mechanism'));
window.addEventListener('storage',e=>{if(e.key==='dd-bozo-sess'||e.key===null){pending=null;preview=null;$('#preview').close();clear();status('Account changed. Reopen the project.');}});
load();
