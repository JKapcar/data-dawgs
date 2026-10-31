const $=id=>document.getElementById(id),API='https://toto.jkapcar4.workers.dev/sled/oauth/consent';
let transaction=null,busy=false,generation=0,controller=null,expectedCallback=null;
const token=()=>{try{return localStorage.getItem('dd-bozo-sess')||'';}catch{return '';}};
function clear(message){generation++;controller?.abort();transaction=null;$('consent').hidden=true;$('confirm').checked=false;$('grant').replaceChildren();$('status').textContent=message;}
function enable(){$('approve').disabled=busy||!transaction||!$('grant').value||!$('confirm').checked;$('deny').disabled=busy||!transaction;}
async function request(body){
 const auth=token(),epoch=generation;if(!auth){$('signin').hidden=false;throw Error('Sign in first, then restart from the requesting app.');}
 controller=new AbortController();const timer=setTimeout(()=>controller?.abort(),15000);
 try{
  const r=await fetch(API,{method:'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
  const out=await r.json();if(epoch!==generation||token()!==auth)throw Error('Sign-in changed. Restart from the app that requested this connection.');
  if(!r.ok)throw Error(r.status===401||r.status===403?'Sign in as the owner and restart the connection.':out.error||'Connection request failed.');return out;
 }finally{clearTimeout(timer);}
}
async function act(fn){if(busy)return;busy=true;enable();try{await fn();}catch(e){clear(e.name==='AbortError'?'Request interrupted. Restart from the requesting app; no automatic retry was sent.':e.message);}finally{busy=false;enable();}}
async function finish(action){
 const out=await request({action,transaction:transaction.transaction,csrf:transaction.csrf,...(action==='approve'?{grant_id:$('grant').value}:{})});
 const u=new URL(out.redirect);
 const base=new URL(u);base.search='';
 if(u.protocol!=='https:'||base.href!==expectedCallback||u.hash||u.username||u.password)throw Error('Invalid return destination. Restart the connection.');
 clear('Returning to ChatGPT.');location.replace(u.href);
}
$('confirm').addEventListener('change',enable);$('grant').addEventListener('change',()=>{$('confirm').checked=false;enable();});
$('approve').addEventListener('click',()=>act(()=>finish('approve')));$('deny').addEventListener('click',()=>act(()=>finish('deny')));
addEventListener('storage',e=>{if(e.key==='dd-bozo-sess'||e.key===null)clear('Sign-in changed. Restart from the app that requested this connection.');});
addEventListener('pagehide',()=>clear('Restart from the app that requested this connection.'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)clear('Page hidden. Restart from the app that requested this connection.');});
const raw=location.hash.slice(1);history.replaceState(null,'',location.pathname);
act(async()=>{
 if(window.top!==window.self)throw Error('Open this connection in its own tab.');
 if(!raw||raw.length>4096)throw Error('Start this connection from your app.');
 const entries=[...new URLSearchParams(raw)];if(new Set(entries.map(([k])=>k)).size!==entries.length)throw Error('Invalid connection request.');
 const params=Object.fromEntries(entries),out=await request({action:'inspect',params});transaction=out;expectedCallback=params.redirect_uri;
 $('client').textContent='Connect '+out.client_name+'?';$('details').textContent='The connection lasts at most seven days, or until the selected grant expires or is revoked. Short-lived access renews automatically within that limit. Scheduled use still requires separate verification in ChatGPT.';
 $('grant').replaceChildren(...out.grants.map(g=>{const o=document.createElement('option');o.value=g.id;o.textContent=g.label+' — expires '+new Date(g.expiresAt).toLocaleString();return o;}));
 $('missing').hidden=out.grants.length>0;$('consent').hidden=false;$('status').textContent='Review the requested access.';
});
