/* Private UI: no content persistence, telemetry, third-party scripts, or agent contact. */
(() => {
'use strict';
const API='https://toto.jkapcar4.workers.dev/api/pound', $=id=>document.getElementById(id);
let state=null,epoch=0,controller=null,busy=false,activeTask='',activeContext='',edit=null,pending=null,loadedToken='',suspended=null;
const session=()=>{try{return localStorage.getItem('dd-bozo-sess')||'';}catch{return '';}};
const node=(tag,text,cls)=>{const el=document.createElement(tag);el.textContent=text??'';if(cls)el.className=cls;return el;};
const date=value=>value?new Date(value).toLocaleString(): 'Never';
const action=(label,fn,cls='quiet')=>{const b=node('button',label,cls);b.type='button';b.onclick=fn;return b;};
function note(text){$('status').textContent=text;}
function clear(){
  epoch++;controller?.abort();controller=null;state=null;busy=false;edit=null;pending=null;activeTask='';activeContext='';loadedToken='';setBusy(false);
  for(const id of ['roster','taskSelect','taskDetail','messages','activity','contextList','contextVersions','editorFields'])$(id).replaceChildren();
  $('messageText').value='';$('contextText').textContent='';$('contextHash').textContent='';$('editorError').textContent='';
  for(const id of ['editor','library'])if($(id).open)$(id).close();
  $('workspace').hidden=true;$('welcome').hidden=false;$('contextReader').hidden=true;$('openLibrary').disabled=true;$('contextCount').textContent='0';$('agentCount').textContent='0 / 24';$('accountLabel').textContent='Private workspace';
}
async function request(method,body,generation,token){
  const res=await fetch(API,{method,cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await res.json();
  if(generation!==epoch||token!==session()||document.hidden)throw new DOMException('Account changed','AbortError');
  if(!res.ok){const e=new Error(res.status===401?'Sign in again to open your workspace.':res.status===503?'Dawg Pound is awaiting private workspace setup.':result.error||'The request could not be completed.');e.status=res.status;throw e;}
  return result;
}
async function load(){
  const draft=suspended;clear();const generation=epoch,token=session();
  if(draft?.token!==token)suspended=null;
  if(!token){note('Sign in to open your private workspace.');return;}
  controller=new AbortController();note('Opening your workspace…');
  try{const result=await request('GET',null,generation,token);state=result.workspace;loadedToken=token;render();note('Private workspace · saved '+(state.updated_at?date(state.updated_at):'when you add your first item'));if(draft?.token===token)restoreDraft(draft);suspended=null;}
  catch(e){if(generation===epoch&&e.name!=='AbortError'){if(e.status===401||e.status===403)suspended=null;note(e.message);}}
}
function suspend(){
  if(loadedToken&&session()===loadedToken)suspended={token:loadedToken,activeTask,activeContext,message:$('messageText').value,pending,library:$('library').open,editor:$('editor').open&&edit?{...edit,fields:Object.fromEntries(new FormData($('editForm')))}:null};
  clear();note('Workspace hidden. Return to reload securely.');
}
function restoreDraft(draft){
  activeTask=draft.activeTask;activeContext=draft.activeContext;pending=draft.pending;render();
  if(draft.message){activeTask=draft.activeTask;renderThread();$('messageText').value=draft.message;if(state.tasks.find(t=>t.id===activeTask)?.archived)note('Your draft belongs to an archived thread. Copy it before refreshing; it has not moved to another task.');}
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
    const result=await request('POST',pending.body,generation,token);state=result.workspace;pending=null;
    if(op==='task.save')activeTask=result.receipt.item_id;
    if(op==='context.save')activeContext=result.receipt.item_id;
    render();note('Saved · '+date(state.updated_at));return true;
  }catch(e){
    if(generation!==epoch||e.name==='AbortError')return false;
    if(e.status===401||e.status===403){clear();note(e.message);return false;}
    if(e.status===409){pending=null;note(e.message+' Your text is still in the editor; copy it before refreshing.');}
    else note(e.status?e.message:'Connection interrupted. Retry Save to check the same request.');
    $('editorError').textContent=$('status').textContent;return false;
  }finally{if(generation===epoch)setBusy(false);}
}
function render(){
  $('workspace').hidden=false;$('welcome').hidden=true;$('openLibrary').disabled=false;$('accountLabel').textContent='Owner workspace';
  const agents=state.agents.filter(a=>!a.archived);$('agentCount').textContent=state.agents.length+' / 24';$('roster').replaceChildren();
  for(const a of agents){const card=node('article',null,'agent'),bar=node('div',null,'bar');bar.append(node('h3',a.name),action('Edit',()=>editor('agent',a)));card.append(bar,node('p',a.role),node('p',a.function,'muted'),node('p','Declared capabilities: '+(a.capabilities||'Not specified'),'muted'),node('span','Not connected','badge'),node('p','Last seen: never','muted'));$('roster').append(card);}
  if(!agents.length)$('roster').append(node('p','Start with a name and a role. Your roster stays private.','empty'));
  const tasks=state.tasks.filter(t=>!t.archived);if(!tasks.some(t=>t.id===activeTask)){activeTask=tasks[0]?.id||'';$('messageText').value='';}
  $('taskSelect').replaceChildren();for(const t of tasks){const option=node('option',t.title);option.value=t.id;$('taskSelect').append(option);}$('taskSelect').value=activeTask;$('taskSelect').disabled=!tasks.length;
  renderThread();$('activity').replaceChildren();
  const labels={'agent.save':'Roster updated','task.save':'Task updated','message.add':'Note posted','context.save':'Context version saved','context.archive':'Context archived'};
  for(const event of [...state.activity].reverse())$('activity').append(node('div',labels[event.operation]+' · you · '+date(event.at),'event'));
  renderLibrary();
}
function renderThread(){
  $('taskDetail').replaceChildren();$('messages').replaceChildren();const task=state.tasks.find(t=>t.id===activeTask);
  $('messageForm').hidden=!task;
  if(!task){$('taskDetail').append(node('h3','Make room for the next good idea.'),node('p','Create a task to keep its brief, decisions and notes in one thread.','muted'));return;}
  const bar=node('div',null,'bar');bar.append(node('h2',task.title),action('Edit task',()=>editor('task',task)));$('taskDetail').append(bar,node('p',task.body));
  const agent=state.agents.find(a=>a.id===task.agent_id);
  $('taskDetail').append(node('span',task.status+' · owner reported','badge'),node('p',(agent?'Assigned role: '+agent.name:'No role assigned')+' · no agent has been contacted','muted'));
  const messages=state.messages.filter(m=>m.thread_id===task.id);if(!messages.length)$('messages').append(node('p','The thread is ready. Add your first note below.','empty'));
  for(const message of messages){const card=node('article',null,'message');card.append(node('small','You · '+date(message.created_at)),node('p',message.text));$('messages').append(card);}
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
  else{input.maxLength=max;input.autocomplete='off';input.required=!['capabilities','body'].includes(key);}
  input.value=value??'';wrap.append(input);$('editorFields').append(wrap);
}
function editor(kind,row){
  if(busy)return;edit={kind,id:row?.id,baseRevision:state.revision};$('editorFields').replaceChildren();$('editorError').textContent='';
  $('editorTitle').textContent=(row?'Edit ':'New ')+(kind==='agent'?'agent role':kind==='task'?'task':'context');
  if(kind==='agent'){
    field('name','Name',row?.name,60);field('role','Role',row?.role,100);field('function','What this role does',row?.function,500,true);field('capabilities','Declared capabilities',row?.capabilities,500,true);
    $('editorHint').textContent='Registers a role. No connection or access is created.';
  }else if(kind==='task'){
    field('title','Task title',row?.title,120);field('body','Brief',row?.body,2000,true);field('agent_id','Assigned role',row?.agent_id,0,false,[['','Unassigned'],...state.agents.filter(a=>!a.archived||a.id===row?.agent_id).map(a=>[a.id,a.name])]);field('status','Status · reported by you',row?.status||'queued',0,false,['queued','working','done','blocked'].map(s=>[s,s]));$('editorHint').textContent='A queued task waits here. It does not start an agent.';
  }else{
    const latest=row?.versions.at(-1);field('title','Document title',row?.title,120);field('text','Context · up to 8,000 characters',latest?.text,8000,true);$('editorHint').textContent='Saves an immutable version. Plain text only.';
  }
  if(row&&kind!=='context')field('archived','Visibility',String(row.archived||false),0,false,[['false','Active'],['true','Archived']]);
  $('editor').showModal();$('editorFields').querySelector('input,textarea')?.focus();
}
$('editForm').onsubmit=async event=>{event.preventDefault();if(!edit)return;const current={...edit},data=Object.fromEntries(new FormData(event.target));if(current.id)data.id=current.id;if(current.kind!=='context')data.archived=data.archived==='true';const op=current.kind+'.save';if(await save(op,data,current.baseRevision)){if($('editor').open)$('editor').close();edit=null;}};
$('messageForm').onsubmit=async event=>{event.preventDefault();const text=$('messageText').value,thread_id=activeTask;if(await save('message.add',{thread_id,text}))$('messageText').value='';};
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
