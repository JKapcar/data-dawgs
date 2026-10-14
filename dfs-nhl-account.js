/* Reuses the site's personal session and private DFS routes. */
(function(){'use strict';
const token=()=>{try{return localStorage.getItem('dd-bozo-sess')||'';}catch{return '';}};
async function request(op,args){
 if(!['schema','draft','get','list'].includes(op))throw Error('Unsupported hockey workspace operation');
 const session=token();if(!session)throw Error('Sign in to your Data Dawgs account first.');
 const r=await fetch('https://toto.jkapcar4.workers.dev/api/dfs/'+op,{method:'POST',headers:{'Content-Type':'application/json','X-Bozo-Session':session},body:JSON.stringify(args)});
 let out;try{out=await r.json();}catch{throw Error('Workspace service unavailable; local work is unchanged.');}
 if(token()!==session)throw Error('Account changed during request; reopen the workspace.');
 if(!r.ok||out.error)throw Error(out.error||'Workspace request failed');return out;
}
let observed=token();
function refresh(){const current=token();if(current!==observed){observed=current;window.dispatchEvent(new StorageEvent('storage',{key:'dd-bozo-sess'}));}}
if(window.addEventListener){window.addEventListener('storage',e=>{if(e.key==='dd-bozo-sess')observed=token();});window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);}
window.DDNHLAccount=Object.freeze({signedIn:()=>Boolean(token()),request});
})();
