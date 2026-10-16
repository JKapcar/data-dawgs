const $=id=>document.getElementById(id),base='https://toto.jkapcar4.workers.dev/research-upload/v1/';
const token=()=>{try{return localStorage.getItem('dd-bozo-sess')||'';}catch{return '';}};
let state=null,busy=false,paused=false,credential='',generation=0;
function lock(){globalThis.DDAccount?.reset();generation++;paused=true;state=null;$('file').value='';$('receipt').textContent='';$('detail').textContent='';$('progress').value=0;for(const id of ['start','pause','remove','file'])$(id).disabled=true;$('status').textContent='Sign-in changed. Reload to continue.';}
async function request(route,{method='GET',body,headers={}}={}){
 if(!credential||credential!==token())throw Error('Sign in to your DataDawgs account, then reload.');const epoch=generation;
 const r=await fetch(base+route,{method,body,headers:{Authorization:'Bearer '+credential,...(!['status','create'].includes(route)?{'X-Upload-ID':state?.upload?.id||''}:{}),...headers},credentials:'omit',cache:'no-store',redirect:'error'});
 if(epoch!==generation||credential!==token()){lock();throw Error('Sign-in changed.');}const data=await r.json();if(epoch!==generation||credential!==token()){lock();throw Error('Sign-in changed.');}if(!r.ok){const error=Error(data.error);error.status=r.status;globalThis.DDAccount?.failed(r.status);throw error;}return data;
}
function show(){const d=state?.upload;$('remove').disabled=busy||!d;$('start').disabled=busy||!state?.configured||d?.status==='complete';$('file').disabled=busy||!state?.configured;$('pause').disabled=!busy;$('receipt').textContent=d?.status==='complete'?`Stored privately • ${d.size.toLocaleString()} bytes • inspection pending. ETag ${d.etag} (not a whole-file SHA-256).`:'';
 $('durableSection').hidden=d?.status!=='complete';$('promote').disabled=busy||d?.status!=='complete'||!!d?.durable;$('remove').disabled=$('remove').disabled||!!d?.durable;
 if(d?.durable)$('durable').textContent=`Durable private copy verified • ${d.durable.size.toLocaleString()} bytes • SHA-256 ${d.durable.sha256}`;}
async function refresh(){state=await request('status');globalThis.DDAccount?.verified(credential);$('status').textContent=state.upload?`Archive: ${state.upload.name} • ${state.upload.status}`:'Private storage ready for the authorized owner.';show();}
async function retry(route,options){for(let attempt=0;attempt<4;attempt++){try{return await request(route,options);}catch(e){if(paused||e.status&&![408,409,429,503].includes(e.status)||attempt===3)throw e;await new Promise(r=>setTimeout(r,1000*2**attempt));}}}
$('start').onclick=async()=>{
 const file=$('file').files[0];if(!file){$('status').textContent='Choose the ZIP to upload or resume.';return;}if(file.size>state.maxBytes||file.size<22||!file.name.toLowerCase().endsWith('.zip')){$('status').textContent='Choose a ZIP no larger than 10 GiB.';return;}
 busy=true;paused=false;show();const epoch=generation;
 try{
  const size=state.partBytes,hashes=[];
  for(let offset=0;offset<file.size;offset+=size){if(paused||epoch!==generation)throw Error('Paused. Choose the same file and resume when ready.');hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.slice(offset,offset+size).arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join(''));$('status').textContent='Checking file identity…';$('detail').textContent=`Hashed ${Math.min(offset+size,file.size).toLocaleString()} of ${file.size.toLocaleString()} bytes`;$('progress').value=Math.min(100,(offset+size)/file.size*100);}
  let d=state.upload;if(d&&(d.size!==file.size||JSON.stringify(d.hashes)!==JSON.stringify(hashes)))throw Error('This file differs from the saved upload. Choose the original file, or delete the saved archive first.');
  if(!d){d=await request('create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,size:file.size,hashes})});state.upload=d;}
  for(let i=0;i<hashes.length;i++){if(paused||epoch!==generation)throw Error('Paused. Your received parts are saved.');if(!d.parts[i+1]){const part=await retry('part',{method:'PUT',headers:{'Content-Type':'application/octet-stream','X-Upload-Part':String(i+1)},body:file.slice(i*size,Math.min((i+1)*size,file.size))});d.parts[i+1]=part;}$('status').textContent='Uploading privately…';$('progress').value=(i+1)/hashes.length*100;$('detail').textContent=`${i+1} / ${hashes.length} parts received • ${file.size.toLocaleString()} bytes total`;}
  if(paused)throw Error('Paused before completion. Resume to finish.');await retry('complete',{method:'POST'});await refresh();
 }catch(e){$('status').textContent=e.message;}finally{busy=false;show();}
};
$('promote').onclick=async()=>{
 const sha256=$('sha').value.trim().toLowerCase();if(!/^[a-f0-9]{64}$/.test(sha256)){$('durable').textContent='Enter the 64-character SHA-256 that archive.py printed for your local archive.';return;}
 busy=true;show();$('durable').textContent='Copying and verifying privately. A large archive can take a minute; keep this tab open.';
 // Promotion is idempotent server-side, so a retry after a dropped response is safe.
 try{const d=await retry('promote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sha256})});state.upload=d;}
 catch(e){$('durable').textContent=e.message==='checksum_mismatch'?'Not promoted: the uploaded bytes do not hash to that SHA-256. Nothing was changed.':'Not promoted: '+e.message+'. Nothing was marked durable.';}
 finally{busy=false;show();}
};
$('pause').onclick=()=>{paused=true;$('status').textContent='Pausing after the current part…';};
$('remove').onclick=async()=>{if(!confirm('Delete this private archive or cancel its incomplete upload? This cannot be undone.'))return;busy=true;show();try{await request('abort',{method:'POST'});await refresh();$('progress').value=0;$('detail').textContent='';}catch(e){$('status').textContent=e.message;}finally{busy=false;show();}};
window.addEventListener('storage',e=>{if(e.key==='dd-bozo-sess'||e.key===null)lock();});window.addEventListener('pagehide',lock);
credential=token();refresh().catch(e=>{globalThis.DDAccount?.failed(e.status);$('status').textContent=e.message==='private_upload_unconfigured'?'Private storage is not activated yet. No file has been uploaded.':e.message;});
