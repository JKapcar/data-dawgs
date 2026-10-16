// Display only. Each page calls verified() after its existing authenticated response.
(() => {
 const token=()=>{try{return localStorage.getItem('dd-bozo-sess')||'';}catch{return '';}};
 const paint=(text,signIn)=>{const label=document.getElementById('accountLabel'),link=document.getElementById('accountLink');if(label)label.textContent=text;if(link){link.textContent=signIn?'Sign in':'Account';link.dataset.verified='false';}};
 const reset=()=>paint(token()?'Checking account':'Not signed in',!token());
 globalThis.DDAccount={token,reset,failed(status){paint(!token()?'Not signed in':status===401?'Sign in again':status===403?'Access not authorized':'Account not verified',!token()||status===401||status===403);},verified(expected){if(!expected||expected!==token()){reset();return;}let name='';try{const b=JSON.parse(atob(expected.split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));if(typeof b.n==='string')name=b.n.slice(0,80);}catch{}paint(name?'Signed in as '+name:'Signed in',false);const link=document.getElementById('accountLink');if(link)link.dataset.verified='true';}};
 reset();window.addEventListener('storage',e=>{if(e.key==='dd-bozo-sess'||e.key===null)reset();});window.addEventListener('pagehide',reset);
})();
