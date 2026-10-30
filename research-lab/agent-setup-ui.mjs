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
function clearSecret(){$('secret').value='';$('endpoint').value='';$('pathUrl').value='';$('pathRow').hidden=true;$('secret').type='password';$('pathUrl').type='password';$('secretPanel').hidden=true;}
function invalidate(){generation++;data=null;identity=null;clearSecret();$('setup').hidden=true;$('grantsPanel').hidden=true;$('grants').replaceChildren();}
async function request(body){
 const auth=token();if(!auth){invalidate();throw Error('Sign in on DataDawgs first, then return here.');}
 if(identity&&identity!==auth)invalidate();identity=auth;const epoch=generation;
 const r=await fetch(API,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',cache:'no-store',redirect:'error'});
 const result=await r.json();if(epoch!==generation||token()!==auth){invalidate();throw Error('Session changed. Reload setup.');}
 if(!r.ok){const error=new Error(r.status===401?'Your sign-in has expired or is no longer valid. Sign in again.':r.status===403?'This account cannot manage Connections. Use the configured owner account.':result.error||'Request failed');error.status=r.status;throw error;}return result;
}
function options(target,rows,label){$(target).replaceChildren(...rows.map(r=>{const o=document.createElement('option');o.value=String(r.id??r);o.textContent=label?label(r):String(r);return o;}));}
const SCOPE_TEXT={'sled:work:read':'Read its own work and finished team work','sled:work:claim':'Claim, check in on and report work for its seat','sled:review':'Review results assigned to its seat','sled:coordinate':'Draft briefs and playbooks, record requests, start runs'};
const sledScopes=()=>[...$('sledScopes').querySelectorAll('input:checked')].map(x=>x.value);
function preset(){const p=data.sled.presets[$('preset').value];$('seat').value=p.seat;for(const box of $('sledScopes').querySelectorAll('input'))box.checked=p.scopes.includes(box.value);$('sledLabel').value=($('preset').selectedOptions[0]?.textContent||'').split(':')[0];sledText();}
function sledText(){const days=Number($('sledDays').value)||30;$('scope').textContent='Exact scopes: '+sledScopes().join(', ')+' · seat '+$('seat').value+' · '+days+' days';$('consent').checked=false;enable();}
function scope(){const a=$('audience').value;$('pound').hidden=a!=='pound';$('sled').hidden=a!=='sled';if(a==='sled')return sledText();$('scope').textContent='Exact scopes: '+data.scopes[a].join(', ');$('consent').checked=false;enable();}
function tasks(){options('task',data.resources.tasks.filter(t=>t.agent_id===$('roster').value),t=>t.title+' · '+t.id);$('consent').checked=false;enable();}
function versions(){options('version',data.resources.contexts.find(c=>c.id===$('context').value)?.versions||[]);$('consent').checked=false;enable();}
function enable(){const a=$('audience').value,days=Number($('sledDays').value);$('issue').disabled=busy||!data||!$('consent').checked||(a==='pound'&&(!$('roster').value||!$('task').value||!$('context').value||!$('version').value))||(a==='sled'&&(!sledScopes().includes('sled:work:read')||!$('sledLabel').value.trim()||!Number.isInteger(days)||days<1||days>30));}
function renderGrants(){
 $('grants').replaceChildren(...data.grants.map(g=>{const li=document.createElement('li'),text=document.createElement('span');text.textContent=`${g.label} · ${g.audience}${g.seat?' · seat '+g.seat:''} · ${g.id} · ${g.status} · expires ${new Date(g.expiresAt).toISOString()}${g.daysLeft!=null?' ('+g.daysLeft+' days left)':''}`;li.append(text);if(g.enabled&&g.audience==='sled'){const r=document.createElement('button');r.textContent='Renew 30 days';r.addEventListener('click',()=>act(async()=>{clearSecret();await request({action:'renew',audience:'sled',agentId:g.id,ttlDays:30});await load();status('Renewed. The same secret keeps working; nothing to re-enter.');}));li.append(r);}if(g.enabled){const b=document.createElement('button');b.textContent='Revoke '+g.audience;b.addEventListener('click',()=>act(async()=>{clearSecret();await request({action:'revoke',audience:g.audience,agentId:g.id});await load();status('Grant revoked for '+g.audience+'.');}));li.append(b);}return li;}));$('grantsPanel').hidden=false;
}
function sledSetup(){const on=Boolean(data.sled);$('audience').querySelector('option[value=sled]').hidden=!on;if(!on){if($('audience').value==='sled')$('audience').value='pound';return;}options('seat',data.sled.seats);$('sledScopes').replaceChildren(document.createElement('legend'),...data.sled.scopes.map(x=>{const l=document.createElement('label'),b=document.createElement('input');b.type='checkbox';b.value=x;b.onchange=sledText;l.append(b,' '+(SCOPE_TEXT[x]||x));return l;}));$('sledScopes').firstChild.textContent='Allowed actions';preset();}
async function load(){invalidate();data=await request();sledSetup();account(sessionLabel()?'Signed in as '+sessionLabel():'Signed in - owner verified');options('roster',data.resources.roster,r=>r.name+' · '+r.id);options('context',data.resources.contexts,c=>c.title+' · '+c.id);tasks();versions();scope();renderGrants();$('setup').hidden=false;status(data.delegatedEnabled?'Delegated access is enabled; grants determine access.'+(data.sled&&!data.sledEnabled?' Pack Sled seat credentials stay unusable until Pack Sled agent access is switched on.':''):'Delegated access is OFF. Issued credentials cannot be used until separately activated.');}
async function act(fn,issuing=false){if(busy)return;busy=true;enable();$('load').disabled=true;try{await fn();}catch(e){clearSecret();if(e.status===401||e.status===403){invalidate();account(e.status===401?'Sign in again':'Owner access required',true);}else if(fn===load){account('Sign-in could not be verified');}status(e.message+(issuing?' If issuance may have completed, load grants and revoke it before trying again.':''));}finally{busy=false;$('load').disabled=!token();enable();if(refreshQueued){refreshQueued=false;refreshSession();}}}
$('load').onclick=()=>act(load);$('audience').onchange=scope;$('preset').onchange=preset;$('seat').onchange=$('sledLabel').oninput=$('sledDays').oninput=sledText;$('roster').onchange=tasks;$('context').onchange=versions;$('task').onchange=$('version').onchange=()=>{$('consent').checked=false;enable();};$('consent').onchange=enable;
$('issue').onclick=()=>act(async()=>{
 clearSecret();const audience=$('audience').value,b={action:'issue',audience};if(audience==='pound')Object.assign(b,{rosterId:$('roster').value,taskId:$('task').value,contextId:$('context').value,contextVersion:Number($('version').value)});
 if(audience==='sled')Object.assign(b,{seat:$('seat').value,scopes:sledScopes(),label:$('sledLabel').value.trim(),ttlDays:Number($('sledDays').value)});
 $('consent').checked=false;const result=await request(b);$('endpoint').value=result.endpoint;$('secret').value='Bearer '+result.secret;
 if(audience==='sled'&&/\/sled\/mcp$/.test(result.endpoint)){$('pathUrl').value=result.endpoint.replace(/\/mcp$/,'/'+result.secret+'/mcp');$('pathRow').hidden=false;}
 $('secretPanel').hidden=false;$('secret').focus();
 data.grants.push({id:result.id,label:audience==='sled'?b.label:'Claude pilot',audience,seat:b.seat,expiresAt:result.expiresAt,enabled:true,status:'issued_not_connection_verified'});renderGrants();status('Credential created. Expires '+new Date(result.expiresAt).toISOString()+'. No connection has been verified.');
},true);
$('clear').onclick=clearSecret;$('reveal').onclick=()=>{const t=$('secret').type==='password'?'text':'password';$('secret').type=t;$('pathUrl').type=t;};
$('copy').onclick=async()=>{if(!identity||token()!==identity){invalidate();status('Session changed.');return;}try{await navigator.clipboard.writeText($('secret').value);status('Copied. Paste directly into Claude’s Authorization field, then clear your clipboard.');}catch{status('Clipboard unavailable. Select and copy the field manually.');}};
document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate();else refreshSession();});window.addEventListener('pagehide',invalidate);window.addEventListener('pageshow',e=>{if(e.persisted)refreshSession();});window.addEventListener('storage',e=>{if(e.key==='dd-bozo-sess'||e.key===null)refreshSession();});window.addEventListener('dd-auth',refreshSession);
refreshSession();
