const $=id=>document.getElementById(id);
let generation=0;
function clear(){$('accountId').value='';$('copyAccountId').disabled=true;}
async function start(){
 const current=++generation,token=localStorage.getItem('dd-bozo-sess')||'';clear();
 if(!token){$('accountStatus').textContent='Sign in above, then return here to copy your account ID.';return;}
 $('accountStatus').textContent='Checking your sign-in.';
 try{
  const r=await fetch('https://toto.jkapcar4.workers.dev/auth/self',{method:'GET',cache:'no-store',credentials:'omit',headers:{'X-Dawg-Session':token}}),body=await r.json();
  if(current!==generation||token!==(localStorage.getItem('dd-bozo-sess')||''))return;
  if(!r.ok)throw Error(body.error||'Sign in again to view your account ID');
  if(!/^u_[A-Za-z0-9_-]+$/.test(body.uid||''))throw Error('Account verification failed');
  $('accountId').value=body.uid;$('copyAccountId').disabled=false;$('accountStatus').textContent='Verified. Tap Copy account ID and share that ID to finish setup.';
 }catch(e){if(current===generation)$('accountStatus').textContent=e.message;}
}
$('copyAccountId').onclick=async()=>{if(!$('accountId').value)return;try{await navigator.clipboard.writeText($('accountId').value);$('accountStatus').textContent='Account ID copied.';}catch{$('accountId').focus();$('accountId').select();$('accountStatus').textContent='Press and hold the selected ID, then tap Copy.';}};
window.addEventListener('pagehide',()=>{generation++;clear();});
window.addEventListener('pageshow',e=>{if(e.persisted)start();});
window.addEventListener('storage',e=>{if(e.key==='dd-bozo-sess')start();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){generation++;clear();}else start();});
start();
