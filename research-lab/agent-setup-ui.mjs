const $=id=>document.getElementById(id),API='https://toto.jkapcar4.workers.dev/agent-setup/v1';
let data=null,busy=false,generation=0,identity=null,refreshQueued=false;
const token=()=>{try{return localStorage.getItem('dd-bozo-sess')||'';}catch{return '';}};
function sessionLabel(){try{const b=JSON.parse(atob(token().split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));return typeof b.n==='string'?b.n.slice(0,80):'';}catch{return '';}}
function account(text,signIn=false){$('sessionStatus').textContent=text;$('accountLink').textContent=signIn?'Sign in':'Account';$('signinHelp').hidden=!signIn;}
function refreshSession(){
 invalidate();
 if(busy)refreshQueued=true;
 if(!token()){account('Not signed in in this browser',true);status('Sign in to DataDawgs to open Connections.');$('load').disabled=true;return;}
 account('Checking saved sign-in');status('Checking your DataDawgs sign-in.');
 if(busy){refreshQueued=true;return;}
 act(load);
}
const status=s=>{$('status').textContent=s;};
function clearSecret(){$('secret').value='';$('endpoint').value='';$('secret').type='password';$('secretPanel').hidden=true;}
function invalidate(){generation++;data=null;identity=null;clearSecret();$('setup').hidden=true;$('grantsPanel').hidden=true;$('grants').replaceChildren();}
async function request(body){
 const auth=token();if(!auth){invalidate();throw Error('Sign in on DataDawgs first, then return here.');}
 if(identity&&identity!==auth)invalidate();identity=auth;const epoch=generation;
 const r=await fetch(API,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',cache:'no-store',redirect:'error'});
 const result=await r.json();if(epoch!==generation||token()!==auth){invalidate();throw Error('Session changed. Reload setup.');}
 if(!r.ok){const error=new Error(r.status===401?'Your sign-in has expired or is no longer valid. Sign in again.':r.status===403?'This account cannot manage Connections. Use the configured owner account.':result.error||'Request failed');error.status=r.status;throw error;}return result;
}
function options(target,rows,label){$(target).replaceChildren(...rows.map(r=>{const o=document.createElement('option');o.value=String(r.id??r);o.textContent=label?label(r):String(r);return o;}));}
function scope(){const a=$('audience').value;$('pound').hidden=a!=='pound';$('scope').textContent='Exact scopes: '+data.scopes[a].join(', ');$('consent').checked=false;enable();}
function tasks(){options('task',data.resources.tasks.filter(t=>t.agent_id===$('roster').value),t=>t.title+' · '+t.id);$('consent').checked=false;enable();}
function versions(){options('version',data.resources.contexts.find(c=>c.id===$('context').value)?.versions||[]);$('consent').checked=false;enable();}
function enable(){$('issue').disabled=busy||!data||!$('consent').checked||($('audience').value==='pound'&&(!$('roster').value||!$('task').value||!$('context').value||!$('version').value));}
function renderGrants(){
 $('grants').replaceChildren(...data.grants.map(g=>{const li=document.createElement('li'),text=document.createElement('span');text.textContent=`${g.label} · ${g.audience} · ${g.id} · ${g.status} · expires ${new Date(g.expiresAt).toISOString()}`;li.append(text);if(g.enabled){const b=document.createElement('button');b.textContent='Revoke '+g.audience;b.addEventListener('click',()=>act(async()=>{clearSecret();await request({action:'revoke',audience:g.audience,agentId:g.id});await load();status('Grant revoked for '+g.audience+'.');}));li.append(b);}return li;}));$('grantsPanel').hidden=false;
}
async function load(){invalidate();data=await request();account(sessionLabel()?'Signed in as '+sessionLabel():'Signed in - owner verified');options('roster',data.resources.roster,r=>r.name+' · '+r.id);options('context',data.resources.contexts,c=>c.title+' · '+c.id);tasks();versions();scope();renderGrants();$('setup').hidden=false;status(data.delegatedEnabled?'Delegated access is enabled; grants determine access.':'Delegated access is OFF. Issued credentials cannot be used until separately activated.');}
async function act(fn,issuing=false){if(busy)return;busy=true;enable();$('load').disabled=true;try{await fn();}catch(e){clearSecret();if(e.status===401||e.status===403){invalidate();account(e.status===401?'Sign in again':'Owner access required',true);}else if(fn===load){account('Sign-in could not be verified');}status(e.message+(issuing?' If issuance may have completed, load grants and revoke it before trying again.':''));}finally{busy=false;$('load').disabled=!token();enable();if(refreshQueued){refreshQueued=false;refreshSession();}}}
$('load').onclick=()=>act(load);$('audience').onchange=scope;$('roster').onchange=tasks;$('context').onchange=versions;$('task').onchange=$('version').onchange=()=>{$('consent').checked=false;enable();};$('consent').onchange=enable;
$('issue').onclick=()=>act(async()=>{
 clearSecret();const audience=$('audience').value,b={action:'issue',audience};if(audience==='pound')Object.assign(b,{rosterId:$('roster').value,taskId:$('task').value,contextId:$('context').value,contextVersion:Number($('version').value)});
 $('consent').checked=false;const result=await request(b);$('endpoint').value=result.endpoint;$('secret').value='Bearer '+result.secret;$('secretPanel').hidden=false;$('secret').focus();
 data.grants.push({id:result.id,label:'Claude pilot',audience,expiresAt:result.expiresAt,enabled:true,status:'issued_not_connection_verified'});renderGrants();status('Credential created. Expires '+new Date(result.expiresAt).toISOString()+'. No connection has been verified.');
},true);
$('clear').onclick=clearSecret;$('reveal').onclick=()=>{$('secret').type=$('secret').type==='password'?'text':'password';};
$('copy').onclick=async()=>{if(!identity||token()!==identity){invalidate();status('Session changed.');return;}try{await navigator.clipboard.writeText($('secret').value);status('Copied. Paste directly into Claude’s Authorization field, then clear your clipboard.');}catch{status('Clipboard unavailable. Select and copy the field manually.');}};
document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate();else refreshSession();});window.addEventListener('pagehide',invalidate);window.addEventListener('pageshow',e=>{if(e.persisted)refreshSession();});window.addEventListener('storage',e=>{if(e.key==='dd-bozo-sess'||e.key===null)refreshSession();});window.addEventListener('dd-auth',refreshSession);
refreshSession();
