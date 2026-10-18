const $=id=>document.getElementById(id),endpoint='https://toto.jkapcar4.workers.dev/api/vault';
let epoch=0,controller=new AbortController(),catalog=[],plans=null,enabled=false;
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
function clear(){epoch++;controller.abort();controller=new AbortController();catalog=[];plans=null;enabled=false;$('files').replaceChildren();$('fileInput').value='';$('target').replaceChildren(new Option('New files',''));$('accountId').textContent='';$('save').disabled=true;$('fileInput').disabled=false;$('target').disabled=false;}
function check(g,token){if(g!==epoch||token!==(localStorage.getItem('dd-bozo-sess')||''))throw Error('Account changed. Refresh the vault.');}
async function api(op,args,g,token){check(g,token);const r=await fetch(endpoint,{method:'POST',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({op,args})});const body=await r.json();check(g,token);if(!r.ok)throw Error(body.error||'Vault request failed');return body;}
function info(message){$('status').textContent=message;}
async function refresh(){
 clear();const g=epoch,token=localStorage.getItem('dd-bozo-sess')||'';
 if(!token){info('Sign in to open your private vault.');return;}
 try{
  const status=await api('status',{},g,token);if(!status.is_owner||status.sharing_enabled)throw Error('Owner-only verification failed');
  $('accountId').textContent=status.owner_uid;let after;
  do{const page=await api('list',after?{after}:{},g,token);catalog.push(...page.files);after=page.next_after;}while(after);
  check(g,token);enabled=true;$('save').disabled=false;
  for(const file of catalog){const current=file.versions.find(v=>v.version_id===file.head);$('target').add(new Option(current.name,file.file_id));const card=document.createElement('article'),title=document.createElement('h3');title.textContent=current.name;card.append(title);
   for(const version of file.versions){const row=document.createElement('p'),label=document.createElement('span'),button=document.createElement('button');label.textContent=`${version.committed_at} · ${version.size.toLocaleString()} bytes · SHA-256 ${version.sha256}`;button.textContent='Download this version';button.onclick=()=>download(file.file_id,version,g,token);row.append(label,button);card.append(row);}$('files').append(card);
  }
  info(`${catalog.length} private files. Sharing is off. Originals and earlier versions are retained.`);
 }catch(e){if(g===epoch){enabled=false;$('save').disabled=true;info(e.message);}}
}
async function verifiedRead(file_id,version_id,expected,g,token){const r=await api('read',{file_id,version_id},g,token);const b=Uint8Array.from(atob(r.data_base64),c=>c.charCodeAt(0));if(r.receipt.file_id!==file_id||r.receipt.version_id!==version_id||r.receipt.sha256!==expected.sha256||b.length!==expected.size||await hash(b)!==expected.sha256)throw Error('Readback verification failed');check(g,token);return b;}
async function download(file_id,version,g,token){try{const b=await verifiedRead(file_id,version.version_id,version,g,token);const url=URL.createObjectURL(new Blob([b],{type:'application/octet-stream'})),a=document.createElement('a');a.href=url;a.download=version.name;a.click();URL.revokeObjectURL(url);info('Downloaded with verified SHA-256.');}catch(e){if(g===epoch)info(e.message);}}
async function save(){
 if(!enabled||$('save').disabled)return;const g=epoch,token=localStorage.getItem('dd-bozo-sess')||'';$('save').disabled=true;$('fileInput').disabled=true;$('target').disabled=true;
 try{
  if(!plans){const selected=Array.from($('fileInput').files),target=catalog.find(f=>f.file_id===$('target').value);if(!selected.length)throw Error('Choose a file first.');if(target&&selected.length!==1)throw Error('Choose one file when adding a version.');const prepared=[];
   for(const file of selected){if(file.size>8*1024*1024)throw Error('Each file must be 8 MiB or smaller.');const bytes=new Uint8Array(await file.arrayBuffer());check(g,token);const sha256=await hash(bytes),head=target?.versions.find(v=>v.version_id===target.head);
    if(head&&head.sha256===sha256&&head.size===file.size){prepared.push({skip:true,file_id:target.file_id,version_id:head.version_id,sha256,size:file.size});continue;}
    const metadata={name:file.name,sha256,size:file.size,file_id:target?.file_id||null,expected_version:target?.head||null},request_id=await hash(new TextEncoder().encode(JSON.stringify(metadata)));let raw='';for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));
    prepared.push({request_id,name:file.name,sha256,size:file.size,data_base64:btoa(raw),...(target?{file_id:target.file_id,expected_version:target.head}:{})});
   }
   check(g,token);plans=prepared;
  }
  const batch=plans;let count=0;for(const plan of batch){check(g,token);if(plan.skip){await verifiedRead(plan.file_id,plan.version_id,plan,g,token);}else{await api('stage_upload',plan,g,token);const result=await api('commit',{request_id:plan.request_id},g,token);await verifiedRead(result.receipt.file_id,result.receipt.version_id,plan,g,token);}info(`Verified ${++count} of ${batch.length} files.`);}
  const countSaved=batch.length;await refresh();if(enabled&&token===(localStorage.getItem('dd-bozo-sess')||''))info(`Verified ${countSaved} files by reading their exact bytes back. Existing identical versions were reused.`);
 }catch(e){if(g===epoch){info(e.message+' Retry keeps the same import IDs. Refresh only to resolve a version conflict.');$('save').disabled=false;}}finally{if(g===epoch){$('fileInput').disabled=false;$('target').disabled=false;}}
}
$('refresh').onclick=refresh;$('save').onclick=save;$('fileInput').onchange=()=>{plans=null;};$('target').onchange=()=>{plans=null;};
window.addEventListener('pagehide',clear);window.addEventListener('pageshow',e=>{if(e.persisted)refresh();});window.addEventListener('storage',e=>{if(e.key==='dd-bozo-sess')refresh();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clear();info('Private view cleared. Refresh when ready.');}});
refresh();
