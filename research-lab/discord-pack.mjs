// Owner page for Pack seats. Every server string is rendered with textContent, never as HTML.
const $=id=>document.getElementById(id),api='https://toto.jkapcar4.workers.dev/discord/owner-pack';
let data=null,busy=false,epoch=0,preview=null,codeUsed=false;
// The one-time link code lives only in memory; it is removed from the address bar immediately.
const code=(()=>{const m=/^#link=([A-Za-z0-9_-]{32})$/.exec(location.hash);if(m)history.replaceState(null,'',location.pathname);return m?m[1]:null;})();
const token=()=>globalThis.DDAccount.token();
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
async function request(body){const auth=token(),generation=epoch;if(!auth)throw Error('Sign in to DataDawgs as the site owner, then return here.');
 const r=await fetch(api,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',cache:'no-store'});
 const result=await r.json();if(auth!==token()||generation!==epoch)throw Error('Account changed. Load status again.');if(!r.ok){DDAccount.failed(r.status);throw Error(result.error||'Request failed');}DDAccount.verified(auth);return result;}
function controls(){const ok=!busy&&!!data&&$('consent').checked;$('register').disabled=!ok||!data.flags.pack;$('inspect').disabled=busy||!data||!data.flags.pack;$('confirmLink').disabled=!ok||!preview;$('load').disabled=busy;
 for(const b of document.querySelectorAll('[data-act]'))b.disabled=!ok;}
function clear(){epoch++;data=null;$('panel').hidden=true;$('consent').checked=false;controls();}
function render(){
 const seats=$('seats');seats.replaceChildren();
 for(const s of data.seats){const row=el('div',null,'seat'),title=el('strong',s.display+' ');
  const state=s.stopped_at?['stopped by you','warn']:!s.configured_key?['not connected','']:!s.binding?['no session bound','warn']:s.binding.live?['session bound','ok']:['session idle','warn'];
  title.append(el('span',state[0],'tag '+state[1]),' ',el('span',s.verified?'passed end-to-end test':'not yet tested','tag '+(s.verified?'ok':'')));row.append(title);
  if(s.configured_key)row.append(el('span','Connector key: '+s.configured_key+' (server-verified)','small'));
  if(s.binding)row.append(el('span','Binding '+s.binding.number+' · session (self-declared): '+(s.binding.session_ref||'not given')+' · last check-in '+s.binding.last_seen_at,'small'));
  if(s.stopped_at||s.configured_key||s.binding){const stop=!s.stopped_at,b=el('button',(stop?'Stop ':'Allow ')+s.display+(stop?'':' again'));b.dataset.act=stop?'stop':'allow';b.onclick=()=>act({action:stop?'stop':'allow',seat:s.seat},(stop?'Stopped ':'Allowed ')+s.display+'.');row.append(b);}
  if(s.verified?.url){const a=el('a','Test reply in Discord');a.href=s.verified.url;a.rel='noreferrer';a.target='_blank';row.append(a);}
  seats.append(row);}
 const jobs=$('jobs');jobs.replaceChildren();
 if(!data.jobs.length)jobs.append(el('p','No requests yet.','small'));
 for(const j of data.jobs){const row=el('div',null,'job');row.append(el('div',j.id+' · '+j.seat+' · '+j.kind+' · '+j.state+' · delivery '+j.delivery),el('div',[j.next,j.last_error&&('last error: '+j.last_error),j.resolution&&('owner recorded: '+j.resolution.observed)].filter(Boolean).join(' · '),'small'));
  if(j.url){const a=el('a','Open reply');a.href=j.url;a.rel='noreferrer';a.target='_blank';row.append(a);}
  if(j.delivery==='uncertain'){const box=el('div',null,'actions');for(const [observed,label] of [['present','It is in Discord'],['absent','Not in Discord']]){const b=el('button',label);b.dataset.act='resolve';b.onclick=()=>act({action:'resolve',id:j.id,observed},'Recorded.');box.append(b);}row.append(box);}
  jobs.append(row);}
 $('command').textContent=data.command?JSON.stringify(data.command,null,2):'Not registered.';
 $('links').textContent=data.links.length?data.links.map(l=>l.name+' · '+l.discord_user_id+' · until '+l.expires_at).join('\n'):'None.';
 $('panel').hidden=false;controls();
}
async function load(){data=await request();render();
 $('status').textContent='Pack '+(data.flags.pack?'on':'off')+' · delivery '+(data.flags.delivery?'on':'off')+' · bot secret '+(data.flags.bot_secret_bound?'bound':'missing')+'.';
 if(code&&!codeUsed&&data.flags.pack&&!preview){$('linkPanel').hidden=false;try{preview=await request({action:'link_preview',code});$('linkWho').textContent='Discord account: '+preview.name+'\nDiscord user ID: '+preview.discord_user_id+'\nCode expires: '+preview.expires_at;$('confirmLink').hidden=false;}catch(e){$('linkWho').textContent='This link code is unknown or expired. Run /pack again in Discord for a new one.';}}
 controls();}
async function act(body,done){if(busy)return;busy=true;controls();try{if(body){if(!$('consent').checked)throw Error('Tick the approval box first.');const r=await request(body);$('status').textContent=done+' '+JSON.stringify(r);}$('consent').checked=false;if(body?.action==='link_confirm'){codeUsed=true;preview=null;$('confirmLink').hidden=true;$('linkPanel').hidden=true;}const note=$('status').textContent;await load();if(body)$('status').textContent=note;}
 catch(e){clear();$('status').textContent=e.message+' Load status before another action.';}finally{busy=false;controls();}}
$('load').onclick=()=>act();$('consent').onchange=controls;
$('register').onclick=()=>act({action:'register'},'Registration:');
$('inspect').onclick=async()=>{if(busy||!data)return;busy=true;controls();try{$('command').textContent=JSON.stringify(await request({action:'inspect_command'}),null,2);$('status').textContent='Read-only inspection complete.';}catch(e){$('status').textContent=e.message;}finally{busy=false;controls();}};
$('confirmLink').onclick=()=>act({action:'link_confirm',code},'Linked.');
window.addEventListener('storage',e=>{if(e.key==='dd-bozo-sess'||e.key===null)clear();});window.addEventListener('dd-auth',clear);window.addEventListener('pagehide',clear);
if(code)$('status').textContent='Link code received. Load status to review it.';controls();
