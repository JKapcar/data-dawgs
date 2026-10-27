window.DD_BOTCTX={label:'Job Harness',sys:'Private job records must never be read or included in assistant context. No inbox or sync is connected. Never infer rejection or automation causes from timing or template emails.',ctx:()=> 'Job Harness: private workspace. Record contents are excluded.'};
/* No private content in storage, telemetry, assistant context, or public fixtures.
 * Status rules and the history fold come from jobs-core.js (JOBS_CORE), the same code the
 * Worker runs. This page renders and sends; the server decides what is stored. */
(()=>{'use strict';
const $=id=>document.getElementById(id),API='https://toto.jkapcar4.workers.dev/api/jobs/v1',C=JOBS_CORE;
const stages={opportunity:'Discovered',screened:'Screened',approved:'Approved to apply',prepared:'Prepared',submitted:'Submitted',interview:'Interview',offer:'Offer',closed:'Closed'};
const stageOne={opportunity:'Discovered',screened:'Screened',approved:'Approved to apply',prepared:'Prepared',submitted:'Submitted',interview:'Interview',offer:'Offer',closed:'Closed'};
const outcomes={none:'No decision recorded',no_later_decision:'No later decision found',rejected:'Rejected',position_closed:'Position closed',blocked_not_submitted:'Blocked · not submitted',withdrawn:'Withdrawn',accepted:'Offer accepted'};
const provenance={unknown:'Unknown / not stated',explicit:'Explicit in evidence',inferred:'Inferred hypothesis · not a fact'};
const labels={employer_key:'Employer key',employer:'Employer',role:'Role',requisition:'Requisition',url:'Listing link',url_verified_at:'Listing checked'};
// Fixed copy for every code the server can return. Unknown codes never reach the screen.
const MESSAGES={claim_confirmation_required:'This work is claimed. Open the latest record and review its claim before editing.',claim_changed:'The claim changed. Reopen the latest record.',work_already_claimed:'Another worker already claimed this record.',invalid_resume_hash:'Use the exact 64-character lowercase SHA-256 hash or leave it blank.',invalid_deadline:'Use an ISO UTC deadline such as 2026-12-01T12:00:00.000Z, or leave it blank.',
 revision_conflict:'This workspace changed in another tab or device. The latest history is loaded. Review it, then save again: the retry reuses this request, so it cannot be recorded twice.',
 request_id_reused:'That request was already used for different details. Nothing new was saved. Cancel and start the change again.',
 duplicate_requisition:'This employer and requisition are already tracked. Nothing new was saved.',
 duplicate_event:'That update is already in the history. Nothing new was saved.',
 older_evidence_requires_reconciliation:'This update is dated before the latest one. If an earlier update is wrong, use Correct on it instead.',
 stage_regression_requires_reconciliation:'This would move the application backward. If an earlier update is wrong, use Correct on it instead.',
 already_submitted:'A submission is already recorded, so this cannot be marked blocked · not submitted. If that submission is wrong, correct it first.',
 record_archived:'This record is archived. Restore it before changing it.',already_archived:'Already archived.',not_archived:'This record is not archived.',
 correction_conflicts_with_history:'That correction would put a later step before an earlier one. Correct the other update first.',
 correction_cannot_create_submission:'A correction cannot turn an unsubmitted attempt into a submission. Record a new update with the submission evidence instead.',
 correction_changes_nothing:'Nothing changed, so nothing was saved.',
 workspace_full:'This workspace has reached its storage limit. Nothing was saved.',record_limit:'Record limit reached (300). Nothing was saved.',history_limit:'This record’s history is full (300 entries). Nothing was saved.',
 record_not_found:'That record is no longer in this workspace. Reload it.',
 invalid_timestamp:'Check the times: they must be real, in the past, and verified cannot be earlier than happened.',
 verification_precedes_event:'Verified cannot be earlier than happened.',
 https_url_required:'Links must start with https and cannot contain a username or password.',
 submission_or_decision_evidence_required:'Submitted, interview and offer updates need an evidence link.',
 decision_evidence_required:'A rejection, closed position or accepted offer needs an evidence link.',
 explicit_reason_requires_evidence:'An explicit reason needs the evidence link that states it.',
 reason_required:'Add the reason, or set where it comes from to Unknown.',unknown_reason_must_be_empty:'Leave the reason empty when it is unknown.',
 invalid_blocked_status:'Blocked · not submitted needs a blocker and an Opportunity or Approved stage.',
 canonical_employer_key_required:'The employer key must be 2–80 lowercase letters, numbers and dashes.',
 invalid_text:'Check the text: required fields cannot be empty, and long fields have limits.',
 configured_owner_required:'Private access denied.',access_not_granted:'Private access denied.',private_setup_pending:'Private setup pending. No data loaded.'
};
// What the page may promise depends on whose workspace is open; neither claim outruns the server.
const DISCLAIMER={owner:'No inbox connected. No automatic applications. Friends cannot access this workspace.',
 member:'This workspace is yours alone in this app: other members cannot see it, and it is not shared with the site owner’s tracker. The site operator administers the database and can technically access stored data. No inbox connected. No automatic applications.'};
const BY_STATUS={400:'Check the required fields, dates and evidence.',401:'Sign in again.',403:'Private access denied.',404:'Not found. Reload the workspace.',409:'Record changed or duplicated. Reload before trying again.',413:'Workspace limit reached.',503:'Private setup pending. No data loaded.'};
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const button=(text,fn,cls)=>{const b=node('button',text,cls);b.type='button';b.onclick=fn;return b;};
let state=null,demo=false,epoch=0,token='',pending=null,mode=null,busy=false,controller=null,openId=null,confirmUrl='',opener=null;
const session=()=>{try{return localStorage.getItem('dd-bozo-sess')||'';}catch{return '';}};
const link=(url,label)=>{const a=node('a',label);try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)return node('span',label);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';}catch{return node('span',label);}return a;};
const host=url=>{try{return new URL(url).host;}catch{return 'link';}};
const pad=n=>String(n).padStart(2,'0');
const localInput=iso=>{const d=iso?new Date(iso):new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());};
const when=iso=>{const t=node('time',iso?new Date(iso).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Not recorded');if(iso){t.dateTime=iso;t.title=iso+' UTC';}return t;};
const zone=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'local time';}catch{return 'local time';}};
const row=id=>state?.records.find(r=>r.id===id)||null;
const archivedOf=r=>!!C.history(r).archived;
function clear(){epoch++;controller?.abort();controller=null;state=null;pending=null;mode=null;busy=false;token='';openId=null;confirmUrl='';$('summary').replaceChildren();$('due').replaceChildren();$('board').replaceChildren();$('detail').replaceChildren();$('detail').hidden=true;$('fields').replaceChildren();$('formTitle').textContent='Add opportunity';$('formHint').textContent='';$('error').textContent='';hideAction();$('editor').close();$('add').disabled=true;$('verified').textContent='Not available';$('health').textContent='Not connected';$('archivedCount').textContent='Archived';$('disclaimer').textContent=DISCLAIMER.owner;}
function hideAction(){const b=$('errorAction');b.hidden=true;b.textContent='';b.onclick=null;}
function showAction(text,fn){const b=$('errorAction');b.textContent=text;b.onclick=fn;b.hidden=false;}
const UNCONFIRMED='Could not confirm whether that saved. Save again to retry: it reuses the same request, so it cannot be recorded twice.';
// A 5xx after a POST may follow a write that landed, so it is reported as unconfirmed, never as "no data".
const messageFor=(status,code,post)=>Object.hasOwn(MESSAGES,code)?MESSAGES[code]:status>=500?(post?UNCONFIRMED:'The private workspace could not be reached. Nothing changed. Try again.'):BY_STATUS[status]||'Request could not be verified.';
async function request(body){
 const generation=epoch,captured=token;
 if(captured!==session()){clear();throw Error('Session changed. Reload workspace.');}
 controller=new AbortController();let res,out;
 try{res=await fetch(API,{method:body?'POST':'GET',cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal,headers:{Authorization:'Bearer '+captured,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});out=await res.json();}
 catch{if(generation!==epoch)throw Object.assign(Error('Request superseded.'),{superseded:true});throw Error(body?UNCONFIRMED:'Request could not be verified. Reload or retry the unchanged request.');}
 if(generation!==epoch)throw Object.assign(Error('Request superseded.'),{superseded:true});
 if(captured!==session()||document.hidden){clear();throw Error('Session changed. Reload workspace.');}
 if(!res.ok){const code=typeof out?.error==='string'?out.error:'';throw Object.assign(Error(messageFor(res.status,code,!!body)),{status:res.status,code,detail:{duplicate_of:typeof out?.duplicate_of==='string'?out.duplicate_of:null,archived:out?.archived===true}});}
 if(!out?.workspace||!Array.isArray(out.workspace.records))throw Error('Workspace response could not be verified.');
 return out;
}
async function load(){demo=false;clear();token=session();if(!token){$('status').textContent='Sign in to open your private workspace.';return;}$('status').textContent='Checking private access…';try{const out=await request();state=out.workspace;render();$('disclaimer').textContent=out.access==='member'?DISCLAIMER.member:DISCLAIMER.owner;$('status').textContent='Private workspace loaded. Inbox integration is pending.';}catch(e){if(e.superseded)return;clear();$('status').textContent=e.message;}}
// Same session, fresh data: keeps an open editor and its pending request.
async function refresh(){const out=await request();state=out.workspace;render();if(openId)detail(openId,false);}
function render(){
 $('board').replaceChildren();$('add').disabled=!state||busy;if(!state)return;
 const verified=state.records.flatMap(r=>[r.url_verified_at,...C.history(r).timeline.map(e=>e.verified_at)]).filter(Boolean).sort().at(-1);
 $('verified').textContent=verified?new Date(verified).toLocaleString()+(demo?' · synthetic':' · record evidence'):'Not available';$('health').textContent=demo?'Synthetic fixtures only':'Not connected';
 const funnel=C.funnel(state.records);$('summary').textContent=funnel.verified_submissions+' evidence-backed submissions / '+funnel.tracked+' tracked; '+funnel.interviews+' verified interviews / '+funnel.verified_submissions+' submissions; '+funnel.no_later_decision+' with no later decision found.';
 $('due').replaceChildren();const due=state.records.filter(r=>!archivedOf(r)).filter(r=>{const w=C.work(r).details;return C.current(r).blocker||(w.deadline&&Date.parse(w.deadline)<=Date.now());});
 if(due.length){$('due').append(node('h2','Needs attention'));for(const r of due){const action=card(r);action.classList.remove('job');action.classList.add('due-action');$('due').append(action);}}
 const archived=state.records.filter(archivedOf);$('archivedCount').textContent='Archived ('+archived.length+')';
 const filter=$('filter').value,lanes=filter==='archived'?[['archived','Archived']]:Object.entries(stages).filter(([key])=>filter==='all'||filter===key);
 for(const [key,label] of lanes){
  const lane=node('section','','lane'),rows=key==='archived'?archived:state.records.filter(r=>!archivedOf(r)&&C.current(r).stage===key),heading=node('h2',label),count=node('span',String(rows.length),'count');
  heading.append(count);lane.append(heading);if(!rows.length)lane.append(node('p',key==='archived'?'Nothing archived':'No records','empty'));
  for(const r of rows)lane.append(card(r));
  $('board').append(lane);
 }
}
function card(r){
 const c=C.current(r),b=button('',()=>detail(r.id,true),'job');
 for(const [tag,text,cls] of [['span',r.employer,'employer'],['strong',r.role,''],['span',outcomes[c.outcome]||'Status unavailable','badge'],['span',r.requisition,'meta'],['span',C.work(r).details.next_action||c.next_action||'Next action not set','meta']])b.append(node(tag,text,cls));
 const w=C.work(r);if(w.claim)b.append(node('span','Claimed: '+w.claim.label+' (self-reported)','meta'));if(w.details.deadline)b.append(times([['Due',w.details.deadline]]));
 if(archivedOf(r))b.append(node('span','Archived · '+stageOne[c.stage],'tag'));
 return b;
}
function times(pairs){const p=node('p','','times');pairs.filter(([,iso])=>iso!==undefined).forEach(([label,iso],i)=>{if(i)p.append(' · ');p.append(label+' ');p.append(when(iso));});return p;}
function working(target,e){const bits=[['Next',e.next_action],['Blocker',e.blocker],['Resume',e.resume_version]].filter(([,v])=>v);if(bits.length)target.append(node('p',bits.map(([k,v])=>k+': '+v).join(' · '),'fine'));}
function entry(r,e,i,h,archived){
 const kind=C.kindOf(e),li=node('li','',kind),top=node('p','','entry-head');li.dataset.at=String(i);top.append(node('span','#'+(i+1),'num'));li.append(top);
 if(kind==='status'){
  top.append(node('strong',(stageOne[e.stage]||'Unknown stage')+' · '+(outcomes[e.outcome]||'Unknown outcome')));
  const s=h.superseded.get(i);if(s){li.classList.add('superseded');top.append(node('span',(s.action==='void'?'Removed by #':'Corrected by #')+(s.by+1),'tag'));}
  li.append(times([['Happened',e.occurred_at],['Verified',e.verified_at],['Recorded',e.recorded_at]]),node('p','Reason ('+(provenance[e.reason_kind]||'Unknown')+'): '+(e.reason||'Not stated')));
  working(li,e);if(e.evidence_url)li.append(link(e.evidence_url,'Open evidence · '+host(e.evidence_url)));
  if(!archived)li.append(button('Correct #'+(i+1),()=>editor({op:'event.correct',id:r.id,target:i}),'small'));
 }else if(kind==='correction'){
  top.append(node('strong',(e.action==='void'?'Removed #':'Corrected #')+(Number(e.target)+1)));
  if(e.action==='replace'&&e.replacement){const n=e.replacement;li.append(node('p','Now: '+(stageOne[n.stage]||'Unknown stage')+' · '+(outcomes[n.outcome]||'Unknown outcome')),times([['Happened',n.occurred_at],['Verified',n.verified_at]]));working(li,n);if(n.evidence_url)li.append(link(n.evidence_url,'Open evidence · '+host(n.evidence_url)));}
  else li.append(node('p','Removed from the timeline. The original entry above is kept.'));
  li.append(node('p','Why: '+(e.note||'Not stated')),times([['Recorded',e.recorded_at]]));
 }else if(kind==='record_correction'){
  top.append(node('strong','Listing details fixed'));
  for(const [k,v] of Object.entries(e.changes||{}))li.append(node('p',(labels[k]||k)+': '+String(v?.from)+' → '+String(v?.to)));
  li.append(node('p','Why: '+(e.note||'Not stated')),times([['Recorded',e.recorded_at]]));
 }else{
  top.append(node('strong',kind==='archive'?'Archived':kind==='restore'?'Restored':kind==='claim'?'Claimed by '+e.actor_label+' (self-reported)':kind==='release'?'Claim released':kind==='work_details'?'Work details updated':'Unrecognized entry'));
  if(e.details)for(const [k,v] of Object.entries(e.details))if(v)li.append(node('p',k+': '+v));if(e.note)li.append(node('p','Note: '+e.note));li.append(times([['Recorded',e.recorded_at]]));
 }
 return li;
}
function detail(id,scroll){
 const r=row(id),box=$('detail');if(!r){box.hidden=true;box.replaceChildren();openId=null;return;}
 openId=id;const h=C.history(r),c=C.current(r),archived=!!h.archived;box.hidden=false;
 const head=node('h2',r.employer+' · '+r.role);head.tabIndex=-1;if(archived)head.append(node('span','Archived','tag'));box.replaceChildren(head);
 const now=node('p','','current');now.append(node('strong',stageOne[c.stage]+' · '+outcomes[c.outcome]));
 if(c.at===null)now.append(' — no updates yet. Nothing is recorded as submitted.');else{now.append(' — happened ');now.append(when(c.occurred_at));}
 const dl=node('dl');
 for(const [key,value] of [['Requisition',r.requisition],['Canonical employer',r.employer_key],['Verified listing',r.url],['URL checked',r.url_verified_at],['Resume version',c.resume_version||'Not recorded'],['Next action',c.next_action||'Not recorded'],['Blocker',c.blocker||'None recorded'],['Created',r.created_at]]){const dd=node('dd');dd.append(key==='Verified listing'?link(value,value):key==='URL checked'||key==='Created'?when(value):node('span',value));dl.append(node('dt',key),dd);}
 const w=C.work(r);for(const [k,v] of Object.entries(w.details)){if(v)dl.append(node('dt',k.replaceAll('_',' ')),node('dd',v));}
 if(w.claim)dl.append(node('dt','Work claim'),node('dd',w.claim.label+' (self-reported label; authenticated owner account)'));
 const actions=node('div','','toolbar');
 if(!archived){actions.append(button('Work details',()=>editor({op:'work.update',id})));actions.append(button(w.claim?'Release claim':'Claim work',()=>editor({op:w.claim?'work.release':'work.claim',id})));}
 if(archived)actions.append(button('Restore record',()=>editor({op:'record.restore',id})));
 else actions.append(button('Record verified update',()=>editor({op:'event.append',id})),button('Fix listing details',()=>editor({op:'record.correct',id})),button('Archive',()=>editor({op:'record.archive',id})));
 const list=node('ol','','log');r.events.forEach((e,i)=>list.append(entry(r,e,i,h,archived)));if(!r.events.length)list.append(node('li','Opportunity recorded. No submission evidence.'));
 const audit=node('details');audit.append(node('summary','Evidence & history'),list);box.append(now,dl,actions,audit);
 if(scroll)box.scrollIntoView({behavior:'instant',block:'start'});
}
const LIMITS={employer:200,role:200,requisition:200,url:2000,evidence_url:2000,employer_key:80};
function field(name,label,value='',options,hint){
 const l=node('label',label),input=document.createElement(options?'select':'input');input.name=name;
 if(options)for(const [v,t] of Object.entries(options)){const o=node('option',t);o.value=v;input.append(o);}
 else{input.type=name.endsWith('_at')?'datetime-local':name.endsWith('url')?'url':'text';input.maxLength=LIMITS[name]||500;}
 if(input.type==='datetime-local'){input.step='any';input.defaultValue=localInput(value);if(value)input.dataset.iso=value;}else input.value=value;
 l.append(input);if(hint)l.append(node('small',hint));$('fields').append(l);return input;
}
const slug=text=>String(text).normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);
function listingFields(r){
 const employer=field('employer','Employer',r?.employer||'',null,'As written on the listing.');
 const key=field('employer_key','Employer key',r?.employer_key||'',null,'Spots duplicates. The same company always gets the same key.');
 let touched=!!r;key.oninput=()=>{touched=true;};
 employer.oninput=()=>{if(touched)return;const name=employer.value.trim().toLowerCase(),same=state?.records.find(x=>x.employer.trim().toLowerCase()===name);key.value=same?same.employer_key:slug(employer.value);};
 field('role','Role',r?.role||'');
 field('requisition','Requisition or job ID',r?.requisition||'',null,'Copy it exactly. No ID? Use something unique to this posting, such as title and city.');
 field('url','Listing link (https)',r?.url||'');
 field('url_verified_at','Listing checked',r?.url_verified_at||'');
 if(!r)for(const [n,l] of [['resume_version','Resume version'],['next_action','Next action'],['blocker','Blocker']])field(n,l);
}
function statusFields(base,{noSubmission=false,minStage=null}={}){
 const allowed=Object.fromEntries(Object.entries(stageOne).filter(([k])=>!(noSubmission&&C.SUBMISSION_STAGES.includes(k))&&(minStage===null||C.stageRank(k)>=C.stageRank(minStage))));
 const stage=field('stage','Stage',Object.hasOwn(allowed,base.stage)?base.stage:Object.keys(allowed)[0],allowed,noSubmission?'This update is not a submission now, so a correction cannot make it one. Record a new update with the evidence instead, or restore the original entry if it was right.':'Submitted means the employer received it. An application that did not go through stays Approved · Blocked.');
 const outcome=field('outcome','Outcome','',{});
 // Defaults never assert an outcome: a closed stage starts on an explicit, required choice.
 const fill=()=>{const keep=outcome.value||base.outcome,choices=C.OUTCOMES_BY_STAGE[stage.value],neutral=choices.includes('none');outcome.replaceChildren();
  if(!neutral){const ask=node('option','Choose the outcome');ask.value='';ask.disabled=true;outcome.append(ask);}
  for(const o of choices){const opt=node('option',outcomes[o]);opt.value=o;outcome.append(opt);}
  outcome.value=choices.includes(keep)?keep:neutral?'none':'';outcome.required=!neutral;need();};
 field('occurred_at','Happened',base.occurred_at||'');field('verified_at','Verified',base.verified_at||'',null,'When you checked the evidence.');
 const evidence=field('evidence_url','Evidence link (https)',base.evidence_url||'');
 const kind=field('reason_kind','Where the reason comes from',base.reason_kind||'unknown',provenance);
 field('reason','Reason',base.reason||'',null,'Leave empty when unknown. Silence or a template email is not a reason.');
 for(const [n,l] of [['next_action','Next action'],['blocker','Blocker'],['resume_version','Resume version']])field(n,l,base[n]||'');
 const need=()=>{const required=C.SUBMISSION_STAGES.includes(stage.value)||['rejected','position_closed','accepted'].includes(outcome.value)||kind.value==='explicit';evidence.required=required;evidence.labels[0].firstChild.textContent=required?'Evidence link (https) · required':'Evidence link (https) · optional';};
 stage.onchange=fill;outcome.onchange=need;kind.onchange=need;fill();
}
function noteField(label,required){const n=field('note',label,'');n.required=required;return n;}
function editor(m){
 const r=m.id?row(m.id):null;if(m.id&&!r)return;
 m.claimId=r?C.work(r).claim?.id:null;mode=m;pending=null;confirmUrl='';$('error').textContent='';hideAction();$('fields').replaceChildren();
 const titles={'work.update':'Work details','work.claim':'Claim work','work.release':'Release claim','record.create':'Add an opportunity','event.append':'Append evidence','event.correct':'Correct update #'+((m.target??0)+1),'record.correct':'Fix listing details','record.archive':'Archive record','record.restore':'Restore record'};
 $('formTitle').textContent=titles[m.op]+(r?' · '+r.employer:'');$('save').textContent=m.op==='record.archive'?'Archive':m.op==='record.restore'?'Restore':'Save record';
 const zoneNote='Times are in '+zone()+'.';
 if(m.op==='work.update'){const w=C.work(r).details;for(const [n,l] of [['match','Match evidence'],['gaps','Gaps'],['resume_version','Resume version'],['resume_sha256','Resume SHA-256'],['answers_provenance','Answers provenance / source reference'],['next_action','Required next step'],['deadline','Deadline (ISO UTC; blank if unknown)']])field(n,l,w[n]||'');$('formHint').textContent='References only. Unknown hashes and deadlines stay blank. This does not change submission status.';}
 else if(m.op==='work.claim'){field('actor_label','Your work label (self-reported)');$('formHint').textContent='All claims use your authenticated owner account. Labels do not prove independent AI identities.';}
 else if(m.op==='work.release'){noteField('Reason for release',true);$('formHint').textContent='Releasing makes this record available for another worker.';}
 else if(m.op==='record.create'){$('formHint').textContent=zoneNote;listingFields(null);}
 else if(m.op==='event.append'){const c=C.current(r);$('formHint').textContent='Adds a dated entry. To fix an earlier update, use Correct on it instead. '+zoneNote;statusFields({...c,outcome:'none',occurred_at:'',verified_at:'',evidence_url:null,reason_kind:'unknown',reason:''},{minStage:c.stage});}
 else if(m.op==='event.correct'){
  const original=r.events[m.target],h=C.history(r),live=h.timeline.find(e=>e.at===m.target),effective=live||C.pick(original,C.STATUS_FIELDS),superseded=h.superseded.has(m.target);
  $('formHint').textContent='The original entry stays in the history; this adds a dated correction. '+zoneNote;
  const choice=node('fieldset','','choice');choice.append(node('legend','What should happen to #'+(m.target+1)+'?'));
  const options=[['replace','Replace it with the corrected details'],['void','Remove it from the timeline (it was recorded in error)']];
  if(superseded)options.push(['restore','Restore it exactly as originally recorded: '+(stageOne[original.stage]||'Unknown stage')+' · '+(outcomes[original.outcome]||'Unknown outcome')]);
  for(const [value,text] of options){const l=node('label'),input=document.createElement('input');input.type='radio';input.name='action';input.value=value;input.checked=value==='replace';l.append(input,' '+text);choice.append(l);}
  $('fields').append(choice);const details=node('fieldset','','details');$('fields').append(details);
  const holder=$('fields');statusFields(effective,{noSubmission:!(live&&C.SUBMISSION_STAGES.includes(live.stage))});
  for(const el of [...holder.children].filter(el=>el.tagName==='LABEL'))details.append(el);
  choice.onchange=()=>{details.disabled=choice.querySelector('input:checked')?.value!=='replace';};
  noteField('What was wrong? (required)',true);
 }
 else if(m.op==='record.correct'){m.base=C.pick(r,C.LISTING_FIELDS);$('formHint').textContent='Only changed fields are saved; the history keeps the old and new values. '+zoneNote;listingFields(r);noteField('What was wrong? (required)',true);}
 else{$('formHint').textContent=m.op==='record.archive'?'Archiving hides this from the board. History, receipts, dates and duplicate detection are kept, and you can restore it any time.':'Restoring puts this back on the board with its full history.';noteField('Note (optional)',false);}
 opener=document.activeElement instanceof HTMLElement?document.activeElement:null;$('editor').showModal();
}
function collect(){
 const f=$('form').elements,v=n=>{const el=f.namedItem(n);return el&&!el.disabled?String(el.value).trim():'';};
 const iso=n=>{const el=f.namedItem(n);if(!el)return '';if(el.dataset.iso&&el.value===el.defaultValue)return el.dataset.iso;const d=new Date(el.value);return el.value&&Number.isFinite(d.getTime())?d.toISOString():'';};
 const status=()=>({stage:v('stage'),outcome:v('outcome'),occurred_at:iso('occurred_at'),verified_at:iso('verified_at'),evidence_url:v('evidence_url')||null,reason_kind:v('reason_kind'),reason:v('reason'),next_action:v('next_action'),blocker:v('blocker'),resume_version:v('resume_version')});
 const m=mode;
 if(m.op==='work.claim')return {id:m.id,actor_label:v('actor_label')};
 if(m.op==='work.update')return {id:m.id,details:Object.fromEntries(['match','gaps','resume_version','resume_sha256','answers_provenance','next_action','deadline'].map(k=>[k,k==='deadline'?(v(k)||null):v(k)]))};
 if(m.op==='record.create')return {employer_key:v('employer_key'),employer:v('employer'),role:v('role'),requisition:v('requisition'),url:v('url'),url_verified_at:iso('url_verified_at'),resume_version:v('resume_version'),next_action:v('next_action'),blocker:v('blocker')};
 if(m.op==='event.append')return {id:m.id,...status()};
 if(m.op==='event.correct'){const choice=f.namedItem('action')?.value,original=row(m.id)?.events[m.target];
  if(choice==='restore'&&original)return {id:m.id,target:m.target,action:'replace',replacement:C.pick(original,C.STATUS_FIELDS),note:v('note')};
  const action=choice==='void'?'void':'replace';return {id:m.id,target:m.target,action,replacement:action==='void'?null:status(),note:v('note')};}
 // Diff against what the form opened with, never the latest record: after a 409 refresh an
 // untouched field must not travel back and undo another tab's edit.
 if(m.op==='record.correct'){const changes={};for(const k of C.LISTING_FIELDS){const value=k==='url_verified_at'?iso(k):v(k);if(value!==m.base[k])changes[k]=value;}return {id:m.id,changes,note:v('note')};}
 return {id:m.id,note:v('note')};
}
// After a 409 refresh: fields the user has not touched take the refreshed values, so the form
// shows what is stored now; edited fields keep the user's text. The pending request is unchanged.
function rebaseListing(){
 if(mode?.op!=='record.correct')return;const r=row(mode.id),f=$('form').elements;if(!r)return;
 for(const k of C.LISTING_FIELDS){const el=f.namedItem(k);if(!el)continue;const at=k==='url_verified_at',value=at?(el.dataset.iso&&el.value===el.defaultValue?el.dataset.iso:''):el.value.trim();
  if(value!==mode.base[k]||r[k]===mode.base[k])continue;
  if(at){el.defaultValue=localInput(r[k]);el.value=el.defaultValue;el.dataset.iso=r[k];}else el.value=r[k];mode.base[k]=r[k];}
}
function check(data){
 const stamps=[data.url_verified_at,data.occurred_at,data.verified_at,data.replacement?.occurred_at,data.replacement?.verified_at,data.changes?.url_verified_at].filter(x=>x!==undefined);
 if(stamps.some(x=>!x))return 'Enter a valid date and time.';if(stamps.some(x=>Date.parse(x)>Date.now()))return 'Times cannot be in the future.';
 const s=data.replacement||data;if(s.reason_kind==='unknown'&&s.reason)return MESSAGES.unknown_reason_must_be_empty;
 if(mode.op==='record.correct'&&!Object.keys(data.changes).length)return MESSAGES.correction_changes_nothing;
 if(mode.op==='record.create'){const key=C.listingKey(data.url),same=key&&state.records.find(r=>C.listingKey(r.url)===key);if(same&&confirmUrl!==key){confirmUrl=key;return 'Possible duplicate: '+same.employer+' · '+same.role+' uses the same listing link. If this is a different posting, press Save again.';}}
 return '';
}
function synthetic(){clear();demo=true;const at='2026-01-10T12:00:00.000Z',later='2026-01-12T12:00:00.000Z',fix='2026-01-13T12:00:00.000Z';state={revision:0,records:['opportunity','approved','submitted','interview','offer','closed'].map((stage,i)=>({id:'demo-'+i,employer_key:'example-'+i,employer:['Northstar Studio','Juniper Works','Orbit Analytics','Cedar Systems','Harbor Labs','Maple Research'][i],role:['Data analyst','Analytics engineer','Product analyst','Data scientist','Research engineer','Business analyst'][i],requisition:'SYN-'+(100+i),url:'https://example.com/jobs/'+i,url_verified_at:at,resume_version:'synthetic-v1',next_action:'Review role and evidence',blocker:'',created_at:at,events:stage==='opportunity'?[]:[{stage,outcome:stage==='submitted'?'no_later_decision':stage==='closed'?'rejected':'none',occurred_at:at,verified_at:at,evidence_url:'https://example.com/synthetic-receipt/'+i,reason_kind:'unknown',reason:'',resume_version:'synthetic-v1',next_action:stage==='interview'?'Prepare interview questions':'Review next step',blocker:'',recorded_at:at,actor_uid:'synthetic'}]}))};
 const blocked=structuredClone(state.records[1]);blocked.id='demo-blocked';blocked.requisition='SYN-106';blocked.employer='Birch Technology';Object.assign(blocked.events[0],{outcome:'blocked_not_submitted',blocker:'Portfolio link needed',next_action:'Add portfolio link',evidence_url:null});
 const closed=structuredClone(state.records[5]);closed.id='demo-position-closed';closed.requisition='SYN-107';closed.employer='Willow Data';Object.assign(closed.events[0],{outcome:'position_closed',reason_kind:'explicit',reason:'Synthetic notice says the position was closed.',next_action:'Archive after review'});
 const submitted=state.records[2];submitted.events.push({stage:'interview',outcome:'none',occurred_at:later,verified_at:later,evidence_url:'https://example.com/synthetic-receipt/interview',reason_kind:'unknown',reason:'',resume_version:'synthetic-v1',next_action:'Prepare',blocker:'',recorded_at:later,actor_uid:'synthetic'},{kind:'correction',target:1,action:'void',note:'Synthetic example: that interview belonged to a different application.',recorded_at:fix,actor_uid:'synthetic'});
 const archived=structuredClone(state.records[5]);archived.id='demo-archived';archived.requisition='SYN-108';archived.employer='Aspen Example Co';Object.assign(archived.events[0],{outcome:'withdrawn',evidence_url:null});archived.events.push({kind:'archive',note:'Synthetic example: withdrew and archived.',recorded_at:fix,actor_uid:'synthetic'});
 state.records.push(blocked,closed,archived);render();$('status').textContent='SYNTHETIC DEMO · invented employers and receipts. Read-only preview; nothing is saved.';}
 $('form').onsubmit=async event=>{event.preventDefault();if(busy||!state||!mode)return;
  if(demo){$('error').textContent='Preview is read-only. Private saving awaits setup and approval.';return;}
  const data=collect(),problem=check(data);hideAction();if(problem){$('error').textContent=problem;return;}
  const op=mode.op,signature=JSON.stringify({op,data});if(!pending||pending.signature!==signature)pending={signature,body:{op,data,expected_revision:state.revision,request_id:crypto.randomUUID(),...(mode.claimId?{claim_id:mode.claimId}:{})}};
  busy=true;$('save').disabled=true;$('cancel').disabled=true;
  try{const out=await request(pending.body);state=out.workspace;const saved=out.receipt?.id||mode?.id;pending=null;mode=null;opener=null;$('editor').close();render();if(saved){detail(saved,false);$('detail').querySelector('h2')?.focus();}$('status').textContent=(out.replayed?'Already saved':'Saved to your tracker')+' · revision '+state.revision+'. Saving records evidence; it never submits anything to an employer.';}
  catch(e){if(e.superseded)return;
   if(e.status===401||e.status===403){clear();$('status').textContent=e.message;return;}
   if(e.code==='revision_conflict'){try{await refresh();rebaseListing();if(pending)pending.body.expected_revision=state.revision;}catch(x){if(x.superseded)return;$('error').textContent=x.message;return;}}
   $('error').textContent=e.message;
   const dup=e.code==='duplicate_requisition'&&e.detail?.duplicate_of;
   if(dup)showAction(e.detail.archived?'Open the archived record':'Open the existing record',()=>{$('editor').close();mode=null;pending=null;if(e.detail.archived)$('filter').value='archived';render();detail(dup,true);});}
  finally{busy=false;$('save').disabled=false;$('cancel').disabled=false;$('add').disabled=!state;}};
 $('refresh').onclick=load;$('demo').onclick=synthetic;$('add').onclick=()=>editor({op:'record.create'});$('cancel').onclick=()=>$('editor').close();$('filter').onchange=render;
 // Keyboard users land back on the control that opened the dialog, if it still exists.
 $('editor').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 $('editor').addEventListener('close',()=>{if(!busy){mode=null;pending=null;}const back=opener;opener=null;if(back?.isConnected&&!back.disabled)back.focus();});
 addEventListener('storage',e=>{if(e.key===null||e.key==='dd-bozo-sess'){clear();$('status').textContent='Account changed. Reload private workspace.';}});addEventListener('pagehide',clear);document.addEventListener('visibilitychange',()=>{if(document.hidden&&!demo){clear();$('status').textContent='Workspace hidden. Reload to verify access.';}});
function checkSession(){if(!demo&&token&&token!==session()){clear();$('status').textContent='Account changed. Reload private workspace.';}}
addEventListener('focus',checkSession);addEventListener('pageshow',e=>{if(e.persisted){clear();$('status').textContent='Reload to verify private access.';}});setInterval(checkSession,500);
$('lock').onclick=()=>{demo=false;clear();$('status').textContent='Workspace locked. Records and drafts cleared from this page.';};
})();
