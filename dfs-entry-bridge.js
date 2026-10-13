/* Host bridge for explicit account actions. The sandbox has no network/auth access.
   Exact child + opaque origin + per-session nonce + operation/size whitelist.
   Never mirrors the pool into legacy localStorage or Toto context. */
(function(){'use strict';
const frame=document.getElementById('diagnosticsFrame');if(!frame)return;
let nonce='',epoch=0,busy=false,lastAuth=null;
const preview=new URLSearchParams(location.search).get('dfs_preview');
const origin=preview&&/^[a-f0-9]{8}$/.test(preview)?'https://'+preview+'-toto.jkapcar4.workers.dev':'https://toto.jkapcar4.workers.dev';
const token=()=>window.DDAuth?.token?.()||null;
function ready(){const accountChanged=lastAuth!==null&&lastAuth!==token();lastAuth=token();epoch++;busy=false;nonce=Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,'0')).join('');frame.contentWindow.postMessage({type:'dfs-private-ready',nonce,signedIn:!!token(),accountChanged},'*');}
async function call(op,args,auth){const response=await fetch(origin+'/api/dfs/'+op,{method:'POST',headers:{'Content-Type':'application/json','X-Bozo-Session':auth},body:JSON.stringify(args)});const out=await response.json();if(token()!==auth)throw Error('Account changed. Load for the current account.');if(!response.ok||out.error)throw Error(out.error||'Private workspace request failed.');return out;}
window.addEventListener('message',async e=>{
 if(e.source!==frame.contentWindow||e.origin!=='null')return;
 const m=e.data;if(m?.type==='dfs-desk-ready'){ready();return;}
 if(m?.type!=='dfs-private-request'||m.nonce!==nonce)return;
 const reply=(body,n=nonce)=>frame.contentWindow.postMessage({type:'dfs-private-result',nonce:n,requestId:m.requestId,...body},'*');
 if(busy){reply({error:'A private request is already running.'});return;}
 const requestEpoch=epoch,requestNonce=nonce;try{
  if(!m||typeof m!=='object'||Object.keys(m).some(k=>!['type','nonce','requestId','op','workspace_id','expected_revision','draft','portfolio'].includes(k)))throw Error('Unsupported private request.');
  if(typeof m.requestId!=='string'||m.requestId.length>40||!['list','load','save','portfolio-load','portfolio-save'].includes(m.op)||JSON.stringify(m).length>550000)throw Error('Invalid or oversized private request.');
  if(m.op!=='list'&&(typeof m.workspace_id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(m.workspace_id)))throw Error('Invalid workspace name.');
  const auth=token();if(!auth)throw Error('Sign in on the main page, then retry. Your local draft is unchanged.');
  if(m.op==='save'&&(!Number.isInteger(m.expected_revision)||m.expected_revision<0||!m.draft||m.draft.version!==1))throw Error('Invalid draft or revision.');
  if(m.op==='portfolio-save'&&(!Number.isInteger(m.expected_revision)||m.expected_revision<0||!m.portfolio||m.portfolio.version!==1))throw Error('Invalid portfolio or revision.');
  const portfolio=m.op.startsWith('portfolio-'),save=m.op==='save'||m.op==='portfolio-save',load=m.op==='load'||m.op==='portfolio-load';
  busy=true;let result=await call(save?(portfolio?'portfolio':'draft'):load?'get':'list',save?{workspace_id:m.workspace_id,expected_revision:m.expected_revision,[portfolio?'portfolio':'draft']:portfolio?m.portfolio:m.draft}:load?{workspace_id:m.workspace_id,limit:1}:{},auth);
  if(m.op==='portfolio-load')result={workspace_id:result.id,revision:result.revision,portfolio:result.portfolio};
  if(requestEpoch===epoch&&token()===auth)reply({result},requestNonce);
 }catch(err){if(requestEpoch===epoch)reply({error:err.message},requestNonce);}finally{if(requestEpoch===epoch)busy=false;}
});
frame.addEventListener('load',ready);window.addEventListener('dd-auth',ready);
// Retained historical links focus the single primary importer, never a second pool.
const open=()=>{document.getElementById('legacyTools').open=false;history.replaceState(null,'',location.pathname+location.search+'#builder');frame.scrollIntoView({block:'start'});frame.contentWindow.postMessage({type:'dfs-builder-open'},'*');};
const legacy=document.getElementById('legacyTools');if(window.DDFS_ENTRY_ROUTE&&window.DDFS_ENTRY_ROUTE!=='#builder'||new URLSearchParams(location.search).get('demo')==='1')legacy.open=true;
else history.replaceState(null,'',location.pathname+location.search+'#builder');
// Legacy boot runs on DOMContentLoaded and normalizes its own sheet hash.
// Restore the explicitly chosen entry route afterwards, so refresh stays clean.
const finishRoute=()=>{if((!window.DDFS_ENTRY_ROUTE||window.DDFS_ENTRY_ROUTE==='#builder')&&new URLSearchParams(location.search).get('demo')!=='1')history.replaceState(null,'',location.pathname+location.search+'#builder');};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',finishRoute);else finishRoute();
const oldFile=document.getElementById('salFile');if(oldFile)oldFile.onchange=()=>{const file=oldFile.files[0];oldFile.value='';if(file){open();frame.contentWindow.postMessage({type:'dfs-import-file',file},'*');}};
if(window.DDFS_ENTRY_ROUTE==='#csvUploadCard'){open();}
window.addEventListener('hashchange',event=>{const hash=new URL(event.newURL).hash;if(!hash||hash==='#builder'||hash==='#csvUploadCard')open();else legacy.open=true;});
for(const id of ['labsUpload','labsBuilder']){const el=document.getElementById(id);if(el)el.onclick=open;}
})();
