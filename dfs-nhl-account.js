/* Standalone hockey app: reuse the site's existing session and private DFS boundary.
   Identity workflows remain on signon.html; no new grant or background uploads. */
(function(){'use strict';
const key='dd-bozo-sess',token=()=>{try{return localStorage.getItem(key)||'';}catch{return '';}},preview=new URLSearchParams(location.search).get('dfs_preview'),origin=preview&&/^[a-f0-9]{8}$/.test(preview)?'https://'+preview+'-toto.jkapcar4.workers.dev':'https://toto.jkapcar4.workers.dev';
let account=token(),busy=false;
function check(){const next=token();if(next!==account){account=next;window.dispatchEvent(new Event('nhl-account-change'));}const link=document.getElementById('accountLink');if(link)link.textContent=next?'My account':'Sign in';return next;}
window.addEventListener('storage',e=>{if(e.key===key)check();});window.addEventListener('focus',check);
window.DDNHLAccount={signedIn:()=>!!check(),async request(op,args){
 const allowed={list:'list',load:'get',save:'draft','nhl-model':'nhl_model'};if(!allowed[op])throw Error('Unsupported hockey account action');const auth=check();if(!auth)throw Error('Sign in to save or load your private hockey lineup.');if(busy)throw Error('An account request is already running.');
 let body;if(op==='list')body={};else if(op==='load')body={workspace_id:args.workspace_id,limit:1};else if(op==='save'){if(args.draft?.sport!=='nhl'||args.draft.platform!=='dk')throw Error('This app saves DraftKings hockey lineups only');body={workspace_id:args.workspace_id,expected_revision:args.expected_revision,draft:args.draft};}else body={as_of:args.as_of,season:args.season,game_type:args.game_type};
 busy=true;try{const r=await fetch(origin+'/api/dfs/'+allowed[op],{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','X-Bozo-Session':auth},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const result=await r.json();if(check()!==auth)throw Error('Account changed. Load for the current account before saving.');if(!r.ok||result.error)throw Error(result.error||'Private hockey request failed');return result;}finally{busy=false;}
 }};check();
})();
