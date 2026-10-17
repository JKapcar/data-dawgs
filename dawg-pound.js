/* Private UI: no content persistence, telemetry, third-party scripts, or agent contact. */
(() => {
'use strict';
const WORKER='https://toto.jkapcar4.workers.dev',API=WORKER+'/api/pound', $=id=>document.getElementById(id);
// References are inert text unless they are https links to one of these hosts.
const LINK_HOSTS=['datadawgs216.com','www.datadawgs216.com','github.com','www.github.com','kaggle.com','www.kaggle.com'];
const OPEN=['queued','working','blocked'];
let state=null,retrievedAt=0,epoch=0,controller=null,busy=false,activeTask='',activeContext='',edit=null,pending=null,loadedToken='',suspended=null;
const session=()=>{try{return localStorage.getItem('dd-bozo-sess')||'';}catch{return '';}};
const node=(tag,text,cls)=>{const el=document.createElement(tag);el.textContent=text??'';if(cls)el.className=cls;return el;};
const date=value=>value?new Date(value).toLocaleString(): 'Never';
const action=(label,fn,cls='quiet')=>{const b=node('button',label,cls);b.type='button';b.onclick=fn;return b;};
function note(text){$('status').textContent=text;}
function clear(){
  epoch++;controller?.abort();controller=null;state=null;retrievedAt=0;busy=false;edit=null;pending=null;activeTask='';activeContext='';loadedToken='';setBusy(false);
  for(const id of ['roster','taskSelect','taskDetail','messages','activity','contextList','contextVersions','editorFields','needsYou','projectSummary','work','verified','contextShelf','recentMessages','diagOut'])$(id).replaceChildren();
  $('messageText').value='';$('messageRef').value='';$('messageKind').value='note';$('diagnostics').open=false;$('contextText').textContent='';$('contextHash').textContent='';$('editorError').textContent='';
  for(const id of ['editor','library'])if($(id).open)$(id).close();
  $('workspace').hidden=true;$('welcome').hidden=false;$('contextReader').hidden=true;$('openLibrary').disabled=true;$('addTask').disabled=true;$('contextCount').textContent='0';$('agentCount').textContent='0 / 24';globalThis.DDAccount?.reset();
}
async function request(method,body,generation,token){
  const res=await fetch(API,{method,cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await res.json();
  if(generation!==epoch||token!==session()||document.hidden)throw new DOMException('Account changed','AbortError');
  if(!res.ok){const e=new Error(res.status===401?'Sign in again to open your workspace.':res.status===503?'Dispatch is awaiting private workspace setup.':result.error||'The request could not be completed.');e.status=res.status;throw e;}
  return result;
}
async function load(){
  const draft=suspended;clear();const generation=epoch,token=session();
  if(draft?.token!==token)suspended=null;
  if(!token){note('Sign in to open your private workspace.');return;}
  controller=new AbortController();note('Opening your workspace…');
  try{const result=await request('GET',null,generation,token);state=result.workspace;retrievedAt=Date.now();loadedToken=token;render();note('Private workspace · saved '+(state.updated_at?date(state.updated_at):'when you add your first item'));if(draft?.token===token)restoreDraft(draft);suspended=null;}
  catch(e){if(generation===epoch&&e.name!=='AbortError'){if(e.status===401||e.status===403)suspended=null;globalThis.DDAccount?.failed(e.status);note(e.message);}}
}
function suspend(){
  if(loadedToken&&session()===loadedToken)suspended={token:loadedToken,activeTask,activeContext,message:$('messageText').value,kind:$('messageKind').value,ref:$('messageRef').value,pending,library:$('library').open,editor:$('editor').open&&edit?{...edit,fields:Object.fromEntries(new FormData($('editForm')))}:null};
  clear();note('Workspace hidden. Return to reload securely.');
}
function restoreDraft(draft){
  activeTask=draft.activeTask;activeContext=draft.activeContext;pending=draft.pending;render();
  if(draft.message){activeTask=draft.activeTask;renderThread();$('messageText').value=draft.message;$('messageKind').value=draft.kind||'note';$('messageRef').value=draft.ref||'';if(state.tasks.find(t=>t.id===activeTask)?.archived)note('Your draft belongs to an archived thread. Copy it before refreshing; it has not moved to another task.');}
  if(draft.library)$('library').showModal();
  if(draft.editor){const e=draft.editor,rows=state[e.kind==='agent'?'agents':e.kind==='task'?'tasks':'contexts'],row=e.id?rows.find(r=>r.id===e.id):null;if(!e.id||row){editor(e.kind,row);edit.baseRevision=e.baseRevision;for(const [name,value] of Object.entries(e.fields)){const field=$('editForm').elements.namedItem(name);if(field)field.value=value;}}}
}
function setBusy(value){busy=value;for(const id of ['saveEdit','sendMessage','addAgent','addTask','addContext','archiveContext','reviseContext','refresh'])$(id).disabled=value;}
async function save(op,data,baseRevision=state?.revision){
  if(!state||busy)return false;
  if(session()!==loadedToken){await load();return false;}
  const generation=epoch,token=session();
  // An uncertain network response retries the exact request/revision, never creates a second note/version.
  const signature=JSON.stringify({op,data});
  if(!pending||pending.signature!==signature)pending={signature,body:{op,data,expected_revision:baseRevision,request_id:crypto.randomUUID()}};
  setBusy(true);$('editorError').textContent='';note('Saving…');
  try{
    const result=await request('POST',pending.body,generation,token);state=result.workspace;retrievedAt=Date.now();pending=null;
    if(op==='task.save')activeTask=result.receipt.item_id;
    if(op==='context.save')activeContext=result.receipt.item_id;
    render();note('Saved · '+date(state.updated_at));return true;
  }catch(e){
    if(generation!==epoch||e.name==='AbortError')return false;
    if(e.status===401||e.status===403){clear();globalThis.DDAccount?.failed(e.status);note(e.message);return false;}
    if(e.status===409){pending=null;note(e.message+' Your text is still in the editor; copy it before refreshing.');}
    else note(e.status?e.message:'Connection interrupted. Retry Save to check the same request.');
    $('editorError').textContent=$('status').textContent;return false;
  }finally{if(generation===epoch)setBusy(false);}
}
function render(){
  $('workspace').hidden=false;$('welcome').hidden=true;$('openLibrary').disabled=false;$('addTask').disabled=busy;globalThis.DDAccount?.verified(loadedToken);
  const agents=state.agents.filter(a=>!a.archived);$('agentCount').textContent=state.agents.length+' / 24';$('roster').replaceChildren();
  for(const a of agents){const card=node('article',null,'agent'),bar=node('div',null,'bar');bar.append(node('h3',a.name),action('Edit',()=>editor('agent',a)));card.append(bar,node('p',a.role),node('p',a.function,'muted'),node('p','Declared capabilities: '+(a.capabilities||'Not specified'),'muted'),node('span','Not connected','badge'),node('p','Last seen: never','muted'));$('roster').append(card);}
  if(!agents.length)$('roster').append(node('p','Start with a name and a role. Your roster stays private.','empty'));
  const tasks=state.tasks.filter(t=>!t.archived);if(!tasks.some(t=>t.id===activeTask)){activeTask=tasks[0]?.id||'';$('messageText').value='';}
  $('taskSelect').replaceChildren();for(const t of tasks){const option=node('option',t.title);option.value=t.id;$('taskSelect').append(option);}$('taskSelect').value=activeTask;$('taskSelect').disabled=!tasks.length;
  renderThread();renderNow();$('activity').replaceChildren();
  for(const event of [...state.activity].reverse())$('activity').append(node('div',ACTIVITY_LABELS[event.operation]+' · '+who(event)+' · '+date(event.at),'event'));
  renderLibrary();
}
// Who wrote it, honestly: the signed owner, or the owner's connector with a self-reported label.
function who(row){return row.actor_kind==='owner_connector'?'your connector'+(row.author_label?' · "'+row.author_label+'" (unverified)':''):'you';}
function refList(refs){
  const list=node('ul',null,'refs');
  for(const ref of refs||[]){const li=node('li');let url=null;try{url=new URL(ref);}catch{}
    if(url&&url.protocol==='https:'&&LINK_HOSTS.includes(url.hostname)&&!url.username&&!url.password){const a=node('a',ref);a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';li.append(a);}else li.textContent=ref;
    list.append(li);}
  return list;
}
// Work is the default view. Saved questions and context open through explicit view controls.
// Every figure comes from a stored field; unsupported capabilities stay in the compact
// capability disclosure and are never inferred from prose.
const STATUS_ORDER=['blocked','working','queued','done'],STATUS_LABEL={blocked:'Blocked',working:'Working',queued:'Queued',done:'Done'};
const ACTIVITY_LABELS={'agent.save':'Roster updated','task.save':'Task updated','message.add':'Message posted','context.save':'Context version saved','context.archive':'Context archived'};
function openThread(id){$('evidenceDrawer').open=true;activeTask=id;$('taskSelect').value=id;renderThread();const detail=$('taskDetail');detail.focus({preventScroll:true});detail.scrollIntoView({block:'start',behavior:'instant'});}
function openContext(id){activeContext=id;renderReader();if(!$('library').open)$('library').showModal();}
function unavailable(text){return node('p',text,'unavailable');}
function renderNow(){
  const tasks=state.tasks.filter(t=>!t.archived),live=new Set(tasks.map(t=>t.id)),agents=new Map(state.agents.map(a=>[a.id,a]));
  // 1. Needs you. Messages carry no recipient, pending or resolved field, so nothing is inferred from kind.
  const needs=$('needsYou');needs.replaceChildren(node('span','Not tracked yet','chip'),node('p','No recipient or resolved field is stored, so nothing here is inferred.','muted'));
  const asks=state.messages.filter(m=>live.has(m.thread_id)&&(m.kind==='question'||m.kind==='decision')&&m.text.trim()).slice(-3).reverse();
  if(asks.length){const ol=node('ol',null,'compact');for(const m of asks){const li=node('li'),task=tasks.find(t=>t.id===m.thread_id);li.append(node('small',m.kind+' · '+(task?task.title:'')+' · '+who(m)+' · '+date(m.created_at),'kind kind-'+m.kind),action(m.text.length>140?m.text.slice(0,140)+'…':m.text,()=>openThread(m.thread_id),'quiet item'));ol.append(li);}needs.append(node('h4','Saved questions and decisions · resolution untracked'),ol);}
  // 2. Project summary: stored task status only.
  const counts=Object.fromEntries(STATUS_ORDER.map(s=>[s,tasks.filter(t=>t.status===s).length])),sum=$('projectSummary');sum.replaceChildren();
  if(tasks.length){const bar=node('div',null,'status-bar');bar.setAttribute('role','img');bar.setAttribute('aria-label','Stored task status: '+STATUS_ORDER.map(s=>counts[s]+' '+s).join(', '));for(const s of STATUS_ORDER)if(counts[s]){const seg=node('span',null,'seg seg-'+s);seg.style.flexGrow=counts[s];bar.append(seg);}sum.append(bar);}
  const tally=node('dl',null,'tally');for(const s of STATUS_ORDER){const d=node('div',null,'tally-'+s+(s==='blocked'&&counts[s]?' hot':''));d.append(node('dt',STATUS_LABEL[s]),node('dd',String(counts[s])));tally.append(d);}sum.append(tally);
  const assigned=tasks.filter(t=>t.agent_id&&agents.has(t.agent_id)).length;
  sum.append(node('p',tasks.length+' stored tasks · '+assigned+' role assignments','muted'));
  // 3. Work, blocked first. Unsupported review status is explained in the capability disclosure.
  const work=$('work');work.replaceChildren(node('p','Saved statuses · working is self-reported.','muted'));
  const groups=[...STATUS_ORDER.map(s=>[STATUS_LABEL[s],s,tasks.filter(t=>t.status===s)]),['Status not saved','none',tasks.filter(t=>!STATUS_ORDER.includes(t.status))]];
  for(const [label,s,rows] of groups){if(!rows.length)continue;const group=node('section',null,'work-group work-'+s);const ol=node('ol');
    for(const t of rows){const li=node('li'),agent=agents.get(t.agent_id);li.append(action(t.title,()=>openThread(t.id),'quiet item'),node('span',' '+(t.status||'no status'),'badge'),node('small',(agent?'Assigned: '+agent.name+(agent.archived?' (archived)':''):'Unassigned')+' · saved '+date(t.updated_at||t.created_at),'meta'));ol.append(li);}
    group.append(node('h4',label+' · '+rows.length),ol);work.append(group);}
  if(!tasks.length)work.append(node('p','No tasks yet.','empty'));

  // 4. Dependencies and last verified activity.
  const verified=$('verified'),acts=[...state.activity].slice(-3).reverse();verified.replaceChildren(unavailable('Dependencies: not tracked. Tasks have no dependency field.'));
  if(acts.length){const ol=node('ol',null,'compact');for(const e of acts)ol.append(node('li',(ACTIVITY_LABELS[e.operation]||e.operation)+' · '+who(e)+' · '+date(e.at)));verified.append(node('h4','Last saved activity'),ol);}
  else verified.append(node('p','No saved activity yet.','empty'));
  verified.append(node('p','Last successful refresh · '+(retrievedAt?date(retrievedAt):'not yet')+'. This confirms the page retrieved your saved workspace, not that any agent ran.','muted'));
  // 5. Context library on demand: titles, versions and dates; full text opens in the reader.
  const docs=state.contexts.filter(c=>!c.archived).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at))),shelf=$('contextShelf');shelf.replaceChildren();
  if(docs.length){const ol=node('ol',null,'compact');for(const c of docs.slice(0,5)){const li=node('li');li.append(action(c.title,()=>openContext(c.id),'quiet item'),node('small','Version '+(c.active_version||c.versions.length)+' of '+c.versions.length+' · '+date(c.updated_at),'meta'));ol.append(li);}shelf.append(ol);if(docs.length>5)shelf.append(node('p','+'+(docs.length-5)+' more in the context library','muted'));}
  else shelf.append(node('p','No context yet. Open the context library to add a brief.','empty'));
  // 6. Discussion stays secondary to the work.
  const recent=state.messages.filter(m=>live.has(m.thread_id)&&m.text.trim()).slice(-5).reverse();$('recentMessages').replaceChildren();
  for(const m of recent){const li=node('li'),task=state.tasks.find(t=>t.id===m.thread_id);li.append(node('small',(m.kind||'note')+' · '+(task?task.title:'')+' · '+who(m),'kind kind-'+(m.kind||'note')),node('p',m.text.length>240?m.text.slice(0,240)+'…':m.text));$('recentMessages').append(li);}
  if(!recent.length)$('recentMessages').append(node('li','Nothing posted yet.','empty'));
}
function renderThread(){
  $('taskDetail').replaceChildren();$('messages').replaceChildren();const task=state.tasks.find(t=>t.id===activeTask);
  $('messageForm').hidden=!task;
  if(!task){$('taskDetail').append(node('h3','Make room for the next good idea.'),node('p','Create a task to keep its brief, decisions and notes in one thread.','muted'));return;}
  const bar=node('div',null,'bar');bar.append(node('h2',task.title),action('Edit task',()=>editor('task',task)));$('taskDetail').append(bar,node('p',task.body));
  const agent=state.agents.find(a=>a.id===task.agent_id);
  $('taskDetail').append(node('span',task.status+' · owner reported','badge'),node('p',(agent?'Assigned role: '+agent.name:'No role assigned')+' · no agent has been contacted','muted'));
  const messages=state.messages.filter(m=>m.thread_id===task.id);if(!messages.length)$('messages').append(node('p','The thread is ready. Add your first note below.','empty'));
  for(const message of messages){const card=node('article',null,'message');card.append(node('small',(message.kind||'note')+' · '+who(message)+' · '+date(message.created_at),'kind kind-'+(message.kind||'note')),node('p',message.text));if(message.refs)card.append(refList(message.refs));$('messages').append(card);}
  if(task.refs)$('taskDetail').append(refList(task.refs));
}
function renderLibrary(){
  const docs=state.contexts.filter(c=>!c.archived);$('contextCount').textContent=docs.length;$('contextList').replaceChildren();
  for(const c of docs){const row=node('div',null,'context-row');row.append(action(c.title,()=>{activeContext=c.id;renderReader();}),node('p',c.versions.length+' saved versions · '+date(c.updated_at),'muted'));$('contextList').append(row);}
  if(!docs.length)$('contextList').append(node('p','Add a brief, a working agreement, or a reference note. Up to 16 documents, 8 versions each.','empty'));
  renderReader();
}
function renderReader(){
  const c=state?.contexts.find(c=>c.id===activeContext&&!c.archived);$('contextReader').hidden=!c;$('contextVersions').replaceChildren();$('contextText').textContent='';$('contextHash').textContent='';if(!c)return;
  for(const v of [...c.versions].reverse()){const option=node('option','Version '+v.version+' · '+v.title+' · '+date(v.created_at));option.value=v.version;$('contextVersions').append(option);}readVersion();
}
function readVersion(){const c=state?.contexts.find(c=>c.id===activeContext),v=c?.versions.find(v=>v.version===Number($('contextVersions').value));$('contextText').textContent=v?.text||'';$('contextHash').textContent=v?'SHA-256 · '+v.sha256:'';}
function field(key,label,value,max,multiline=false,choices=null){
  const wrap=node('label',label),input=document.createElement(choices?'select':multiline?'textarea':'input');input.name=key;
  if(choices)for(const [value,text] of choices){const o=node('option',text);o.value=value;input.append(o);}
  else{input.maxLength=max;input.autocomplete='off';input.required=!['capabilities','body','refs'].includes(key);}
  input.value=value??'';wrap.append(input);$('editorFields').append(wrap);
}
function editor(kind,row){
  if(busy)return;edit={kind,id:row?.id,baseRevision:state.revision,taskRevision:kind==='task'&&row?row.revision||1:undefined};$('editorFields').replaceChildren();$('editorError').textContent='';
  $('editorTitle').textContent=(row?'Edit ':'New ')+(kind==='agent'?'agent role':kind==='task'?'task':'context');
  if(kind==='agent'){
    field('name','Name',row?.name,60);field('role','Role',row?.role,100);field('function','What this role does',row?.function,500,true);field('capabilities','Declared capabilities',row?.capabilities,500,true);
    $('editorHint').textContent='Registers a role. No connection or access is created.';
  }else if(kind==='task'){
    field('title','Task title',row?.title,120);field('body','Brief',row?.body,2000,true);field('agent_id','Assigned role',row?.agent_id,0,false,[['','Unassigned'],...state.agents.filter(a=>!a.archived||a.id===row?.agent_id).map(a=>[a.id,a.name])]);field('status','Status · reported by you',row?.status||'queued',0,false,['queued','working','done','blocked'].map(s=>[s,s]));field('refs','References · one per line, up to 8',(row?.refs||[]).join('\n'),2700,true);$('editorHint').textContent='A queued task waits here. It does not start an agent.';
  }else{
    const latest=row?.versions.at(-1);field('title','Document title',row?.title,120);field('text','Context · up to 8,000 characters',latest?.text,8000,true);$('editorHint').textContent='Saves an immutable version. Plain text only.';
  }
  if(row&&kind!=='context')field('archived','Visibility',String(row.archived||false),0,false,[['false','Active'],['true','Archived']]);
  $('editor').showModal();$('editorFields').querySelector('input,textarea')?.focus();
}
$('editForm').onsubmit=async event=>{event.preventDefault();if(!edit)return;const current={...edit},data=Object.fromEntries(new FormData(event.target));if(current.id)data.id=current.id;if(current.kind!=='context')data.archived=data.archived==='true';if(current.kind==='task'){const refs=String(data.refs||'').split('\n').map(r=>r.trim()).filter(Boolean);delete data.refs;if(refs.length)data.refs=refs;if(current.id)data.expected_task_revision=current.taskRevision;}const op=current.kind+'.save';if(await save(op,data,current.baseRevision)){if($('editor').open)$('editor').close();edit=null;}};
$('messageForm').onsubmit=async event=>{event.preventDefault();const text=$('messageText').value,thread_id=activeTask,kind=$('messageKind').value,ref=$('messageRef').value.trim(),data={thread_id,text,kind};if(ref)data.refs=[ref];if(await save('message.add',data)){$('messageText').value='';$('messageRef').value='';$('messageKind').value='note';}};
// Diagnostics: read-only permission state with reason codes. Never sent anywhere else.
$('diagnostics').addEventListener('toggle',async()=>{
  if(!$('diagnostics').open||!loadedToken)return;const generation=epoch,token=loadedToken;$('diagOut').textContent='Checking…';
  try{const res=await fetch(WORKER+'/owner-apps/v1',{cache:'no-store',credentials:'omit',redirect:'error',headers:{Authorization:'Bearer '+token}}),body=await res.json();if(generation!==epoch||token!==session())return;
    if(!res.ok){$('diagOut').textContent='owner-apps/v1 → HTTP '+res.status+' · '+(body.error||'unavailable')+(body.error==='configured_owner_required'?'\nThis account is not the configured owner: every private app reads not_owner.':'');return;}
    $('diagOut').textContent=body.apps.map(a=>a.app+': '+(a.status||(a.enabled?'on':'off'))+(a.available===false?' · '+(a.error||''):'')+(a.mode?' · mode '+a.mode:'')+(a.version!==undefined?' · grant v'+a.version:'')).join('\n')+'\nAssistant identity: '+body.assistantIdentity+'.';
  }catch{if(generation===epoch)$('diagOut').textContent='owner-apps/v1 unreachable · storage_unavailable or offline';}
});
for(const name of ['Work','Needs','Context'])$('view'+name).onclick=()=>{for(const [n,p] of [['Work','workPane'],['Needs','needsPane'],['Context','contextPane']]){$('view'+n).setAttribute('aria-pressed',String(n===name));$(p).hidden=n!==name;}};
$('taskSelect').onchange=()=>{activeTask=$('taskSelect').value;$('messageText').value='';renderThread();};
$('contextVersions').onchange=readVersion;
$('refresh').onclick=load;$('addAgent').onclick=()=>editor('agent');$('addTask').onclick=()=>editor('task');$('addContext').onclick=()=>editor('context');
$('openLibrary').onclick=()=>{$('library').showModal();};$('closeLibrary').onclick=()=> $('library').close();$('closeEditor').onclick=()=> $('editor').close();
$('reviseContext').onclick=()=>editor('context',state.contexts.find(c=>c.id===activeContext));
$('archiveContext').onclick=()=>save('context.archive',{id:activeContext});
window.addEventListener('storage',e=>{if(e.key==='dd-bozo-sess'||e.key===null){suspended=null;load();}});
window.addEventListener('pagehide',()=>{suspended=null;clear();});window.addEventListener('pageshow',e=>{if(e.persisted)load();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();else load();});
// Same-document identity code also changes storage; check before any operation/response.
load();
})();
