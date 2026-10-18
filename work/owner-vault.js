/* Owner-only immutable files. No sharing, Access, MCP, deletion or public URLs.
 * RTDB CAS is the publication authority; R2 stores private content-addressed bytes.
 * Request IDs are SHA-256 of canonical metadata, so a lost stage response is recoverable. */
const OWNER_VAULT_LIMITS=Object.freeze({file_bytes:8*1024*1024,state_bytes:2*1024*1024,requests:2000,page:50});
function ovCheck(ok,status,message){if(!ok){const e=new Error(message);e.ovStatus=status;throw e;}}
const ovHash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
const ovID=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function ovFields(a,required,optional=[]){ovCheck(a&&typeof a==='object'&&!Array.isArray(a)&&Object.keys(a).every(k=>[...required,...optional].includes(k))&&required.every(k=>Object.hasOwn(a,k)),400,'Invalid fields');}
function ovText(v,max){return typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);}
function ovEncode(b){let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);}
async function ovBody(request){
 const reader=request.body?.getReader();ovCheck(reader,400,'JSON body required');let length=0;const chunks=[];
 for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>Math.ceil(OWNER_VAULT_LIMITS.file_bytes/3)*4+8192){await reader.cancel();ovCheck(false,413,'Request too large');}chunks.push(value);}
 const bytes=new Uint8Array(length);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{ovCheck(false,400,'Invalid JSON');}
}
async function handleOwnerVault(request,env){
 const url=new URL(request.url),origin=request.headers.get('Origin');
 const headers={'Content-Type':'application/json','Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Vary':'Origin, Authorization','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"sandbox; default-src 'none'"};
 if(origin&&ORIGINS.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'});
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
 try{
  ovCheck(!origin||ORIGINS.includes(origin),403,'Origin denied');ovCheck(!url.search,400,'Query parameters are not accepted');
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  // This handler also intercepts all suffixes before any general MCP dispatch.
  ovCheck(url.pathname==='/api/vault',503,'Vault sharing and MCP are not enabled');
  ovCheck(env.VAULT_ENABLED==='true'&&env.VAULT_SHARING_ENABLED!=='true'&&env.VAULT_BUCKET&&/^u_[A-Za-z0-9_-]{1,100}$/.test(env.VAULT_OWNER_UID||''),503,'Owner vault is not enabled');
  ovCheck(request.method==='POST',405,'POST required');
  const uid=await poundIdentity(request,env);ovCheck(uid===env.VAULT_OWNER_UID,403,'Owner access required');
  const reauth=async()=>{ovCheck(env.VAULT_ENABLED==='true'&&env.VAULT_SHARING_ENABLED!=='true'&&env.VAULT_OWNER_UID===uid,503,'Owner vault is not enabled');ovCheck(await poundIdentity(request,env)===uid,401,'Sign in again');};
  const input=await ovBody(request);ovFields(input,['op','args']);await reauth();const a=input.args,op=input.op;
  ovCheck(['status','list','read','stage_upload','commit','receipt'].includes(op),400,'Unknown operation');
  const path='/ownerVaults/'+uid;
  async function load(){
   const row=await fbGet(env,path,true);await reauth();ovCheck(row&&typeof row.etag==='string'&&row.etag,503,'Conditional storage unavailable');
   let state={format:1,revision:0,files:{},requests:{}};
   if(row.data!=null){ovCheck(row.data.owner_uid===uid&&typeof row.data.payload==='string'&&new TextEncoder().encode(row.data.payload).length<=OWNER_VAULT_LIMITS.state_bytes,503,'Vault metadata unavailable');state=JSON.parse(row.data.payload);ovCheck(state.format===1&&Number.isSafeInteger(state.revision)&&state.files&&state.requests,503,'Vault metadata unavailable');}
   return {row,state};
  }
  async function change(fn){
   for(let attempt=0;attempt<8;attempt++){
    const {row,state}=await load(),result=fn(state);if(!result.changed)return result.value;
    state.revision++;const payload=JSON.stringify(state);ovCheck(new TextEncoder().encode(payload).length<=OWNER_VAULT_LIMITS.state_bytes,409,'Vault catalog capacity reached');
    await reauth();if(await fbPut(env,path,{owner_uid:uid,payload},row.etag)){await reauth();return result.value;}
   }ovCheck(false,409,'Concurrent change; retry the same request');
  }
  const key=sha=>'owner-vault/v1/'+uid+'/sha256/'+sha;
  async function bytes(sha,size){const obj=await env.VAULT_BUCKET.get(key(sha));ovCheck(obj,503,'Stored bytes unavailable');ovCheck(obj.size===undefined||obj.size===size,503,'Stored size mismatch');const b=new Uint8Array(await obj.arrayBuffer());ovCheck(b.length===size&&await ovHash(b)===sha,503,'Stored checksum mismatch');await reauth();return b;}
  const receipt=r=>({request_id:r.request_id,file_id:r.file_id,version_id:r.request_id,sha256:r.metadata.sha256,size:r.metadata.size,status:r.status,committed_at:r.committed_at||null});
  if(op==='status'){ovFields(a,[]);await reauth();return reply({owner_uid:uid,is_owner:true,sharing_enabled:false,folder:'Main',limits:OWNER_VAULT_LIMITS});}
  if(op==='list'){
   ovFields(a,[],['after']);ovCheck(a.after===undefined||ovID(a.after),400,'Invalid cursor');const {state}=await load();
   const ids=Object.keys(state.files).sort().filter(id=>!a.after||id>a.after),page=ids.slice(0,OWNER_VAULT_LIMITS.page);
   const files=page.map(id=>({file_id:id,head:state.files[id].head,versions:state.files[id].versions.map(v=>({...state.requests[v].metadata,version_id:v,committed_at:state.requests[v].committed_at}))}));
   await reauth();return reply({revision:state.revision,files,next_after:ids.length>page.length?page.at(-1):null});
  }
  if(op==='read'){
   ovFields(a,['file_id','version_id']);ovCheck(ovID(a.file_id)&&ovID(a.version_id),400,'Invalid ID');const {state}=await load(),file=state.files[a.file_id],r=state.requests[a.version_id];
   ovCheck(file&&file.versions.includes(a.version_id)&&r?.status==='committed'&&r.file_id===a.file_id,404,'Version not found');const b=await bytes(r.metadata.sha256,r.metadata.size);await reauth();return reply({receipt:receipt(r),metadata:r.metadata,data_base64:ovEncode(b)});
  }
  if(op==='receipt'){ovFields(a,['request_id']);ovCheck(ovID(a.request_id),400,'Invalid request ID');const {state}=await load(),r=state.requests[a.request_id];ovCheck(r,404,'Request not found');await reauth();return reply({receipt:receipt(r)});}
  if(op==='stage_upload'){
   ovFields(a,['request_id','name','sha256','size','data_base64'],['file_id','expected_version']);ovCheck(ovID(a.request_id)&&ovID(a.sha256),400,'Invalid hash');
   ovCheck(ovText(a.name,180)&&!/[\\/]/.test(a.name),400,'Invalid name');ovCheck(Number.isSafeInteger(a.size)&&a.size>=0&&a.size<=OWNER_VAULT_LIMITS.file_bytes,413,'File exceeds 8 MiB');
   ovCheck((a.file_id===undefined&&a.expected_version===undefined)||(ovID(a.file_id)&&ovID(a.expected_version)),400,'Append requires file and expected version');
   ovCheck(typeof a.data_base64==='string'&&a.data_base64.length<=Math.ceil(OWNER_VAULT_LIMITS.file_bytes/3)*4&&a.data_base64.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(a.data_base64),400,'Invalid base64');
   let b;try{b=Uint8Array.from(atob(a.data_base64),c=>c.charCodeAt(0));}catch{ovCheck(false,400,'Invalid base64');}
   ovCheck(b.length===a.size&&await ovHash(b)===a.sha256,400,'Checksum mismatch');
   // Fixed property order is the public fingerprint contract (UTF-8 JSON, no whitespace).
   const metadata={name:a.name,sha256:a.sha256,size:a.size,file_id:a.file_id||null,expected_version:a.expected_version||null};
   const fingerprint=await ovHash(new TextEncoder().encode(JSON.stringify(metadata)));ovCheck(fingerprint===a.request_id,409,'Request ID does not match metadata');
   const r=await change(state=>{
    const prior=state.requests[a.request_id];if(prior){ovCheck(JSON.stringify(prior.metadata)===JSON.stringify(metadata),409,'Idempotency conflict');return {changed:false,value:prior};}
    ovCheck(Object.keys(state.requests).length<OWNER_VAULT_LIMITS.requests,409,'Vault request capacity reached');
    if(a.file_id)ovCheck(state.files[a.file_id]?.head===a.expected_version,409,'File version changed');
    const next={request_id:a.request_id,file_id:a.file_id||a.request_id,metadata,status:'staged',created_at:new Date().toISOString()};state.requests[a.request_id]=next;return {changed:true,value:next};
   });
   if(r.status==='committed'){await bytes(r.metadata.sha256,r.metadata.size);return reply({receipt:receipt(r),replayed:true});}
   await reauth();await env.VAULT_BUCKET.put(key(a.sha256),b,{httpMetadata:{contentType:'application/octet-stream'}});await bytes(a.sha256,a.size);await reauth();return reply({receipt:receipt(r)});
  }
  ovFields(a,['request_id']);ovCheck(ovID(a.request_id),400,'Invalid request ID');const {state}=await load(),staged=state.requests[a.request_id];ovCheck(staged,404,'Request not found');
  await bytes(staged.metadata.sha256,staged.metadata.size);
  const result=await change(s=>{
   const r=s.requests[a.request_id];ovCheck(r,404,'Request not found');if(r.status==='committed')return {changed:false,value:{receipt:receipt(r),replayed:true}};
   if(r.metadata.file_id)ovCheck(s.files[r.file_id]?.head===r.metadata.expected_version,409,'File version changed');
   else ovCheck(!s.files[r.file_id],409,'File already exists');
   const file=s.files[r.file_id]||(s.files[r.file_id]={head:null,versions:[]});file.versions.push(r.request_id);file.head=r.request_id;r.status='committed';r.committed_at=new Date().toISOString();return {changed:true,value:{receipt:receipt(r),replayed:false}};
  });await reauth();return reply(result);
 }catch(e){return reply({error:e.ovStatus||e.poundStatus?e.message:'Vault temporarily unavailable'},e.ovStatus||e.poundStatus||503);}
}
