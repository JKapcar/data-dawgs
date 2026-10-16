// Private, owner-only pilot. No bucket, grants, public URLs or credentials created here.
export const PART_BYTES=8*1024*1024, MAX_BYTES=10*1024*1024*1024;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const digest=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
async function bounded(request,max,timeout=60000){
 const reader=request.body?.getReader();if(!reader)fail(400,'body_required');let size=0,timer;
 const chunks=[],deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reader.cancel().catch(()=>{});reject(Object.assign(new Error('body_timeout'),{status:408}));},timeout);});
 try{while(true){const {done,value}=await Promise.race([reader.read(),deadline]);if(done)break;size+=value.length;if(size>max){await reader.cancel();fail(413,'body_too_large');}chunks.push(value);}}finally{clearTimeout(timer);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export function createUploadGateway({fbGet,fbPut,sessionAuth,now=Date.now}){
 return async(request,env)=>{
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  const send=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  try{
   if(env.RESEARCH_UPLOAD_ENABLED!=='true'||!env.RESEARCH_UPLOADS||!/^u_[A-Za-z0-9_-]+$/.test(env.RESEARCH_OWNER_UID||''))fail(503,'private_upload_unconfigured');
   const origin=request.headers.get('Origin');if(origin&&!['https://datadawgs216.com','https://www.datadawgs216.com'].includes(origin))fail(403,'origin_denied');
   if(origin)headers['Access-Control-Allow-Origin']=origin;
   if(!origin&&request.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'origin_required');
   const url=new URL(request.url),match=url.pathname.match(/^\/research-upload\/v1\/(status|create|part|complete|abort|download|promote)$/);
   if(!match||url.search)fail(404,'not_found');const route=match[1];
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, X-Upload-Part, X-Upload-ID'}});
   if(request.method!==({status:'GET',download:'GET',part:'PUT'}[route]||'POST'))fail(405,'method_not_allowed');
   const authorization=request.headers.get('Authorization')||'';
   if(!authorization.startsWith('Bearer ')||authorization.length>4096||request.headers.has('X-Dawg-Session')||request.headers.has('X-Dawg-Pass')||request.headers.has('X-Bozo-Session'))fail(401,'signed_session_required');
   // Only a signed site session. Personal MCP tokens and shared passwords cannot pass.
   const authRequest=new Request('https://identity.invalid',{headers:{'X-Dawg-Session':authorization.slice(7)}});
   const identity=await sessionAuth(authRequest,{...env,BOZO_TOKENS:undefined});
   if(identity?.err||identity?.uid!==env.RESEARCH_OWNER_UID)fail(403,'owner_required');
   const path='/researchUploads/v1/'+identity.uid;
   const read=async()=>{const r=await fbGet(env,path,true);if(!r.etag)fail(503,'conditional_storage_required');return {...r,data:r.data?.payload?JSON.parse(r.data.payload):null};};
   const write=async(snapshot,data)=>fbPut(env,path,{version:1,owner_uid:identity.uid,payload:JSON.stringify(data)},snapshot.etag);
   const authorize=async()=>{const grant=(await fbGet(env,'/researchLab/v1/tenants/'+(env.RESEARCH_UPLOAD_TENANT||'jason-bdb'))).data?.access?.users?.[identity.uid];const durable=grant?.owner===true&&grant?.expiresAt==null;if(grant?.enabled!==true||(!durable&&!(grant.expiresAt>now()))||!grant.capabilities?.includes('research:read'))fail(403,'owner_grant_required');};
   await authorize();let snapshot=await read();const bucket=env.RESEARCH_UPLOADS;
   const project=d=>d?{id:d.id,name:d.name,size:d.size,partBytes:PART_BYTES,hashes:d.hashes,parts:d.parts,status:d.status,expiresAt:d.expiresAt,inspection:'pending_local_inspection',integrity:'per-part-sha256-verified-on-receipt',etag:d.etag||null,durable:d.durable||null}:null;
   if(route==='status')return send({configured:true,upload:project(snapshot.data),maxBytes:MAX_BYTES,partBytes:PART_BYTES});
   if(route==='create'){
    if(snapshot.data)fail(409,'one_archive_limit_abort_existing_first');
    let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(request,100000,10000)));}catch(e){if(e.status)throw e;fail(400,'invalid_manifest');}
    if(Object.keys(body).some(k=>!['name','size','hashes'].includes(k))||typeof body.name!=='string'||!/^.{1,180}\.zip$/i.test(body.name)||/[\x00-\x1f/\\]/.test(body.name)||!Number.isSafeInteger(body.size)||body.size<22||body.size>MAX_BYTES||!Array.isArray(body.hashes)||body.hashes.length!==Math.ceil(body.size/PART_BYTES)||body.hashes.some(h=>typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h)))fail(400,'invalid_manifest');
    const id=crypto.randomUUID(),key='quarantine/'+identity.uid+'/'+id+'.zip';
    const upload=await bucket.createMultipartUpload(key,{httpMetadata:{contentType:'application/zip'},customMetadata:{owner:identity.uid,upload:id,inspection:'pending'}});
    const data={...body,id,key,uploadId:upload.uploadId,status:'uploading',parts:{},createdAt:now(),expiresAt:now()+6*86400000};
    try{await authorize();if(!await write(snapshot,data))fail(409,'retry_status');}catch(e){await upload.abort();throw e;}return send(project(data),201);
   }
   if(!snapshot.data)fail(404,'upload_not_found');let d=snapshot.data;
   if(request.headers.get('X-Upload-ID')!==d.id)fail(409,'upload_changed_refresh_status');
   const upload=bucket.resumeMultipartUpload(d.key,d.uploadId);
   if(route==='download'){
    if(d.status!=='complete')fail(409,'upload_incomplete');const object=await bucket.get(d.durable?.key||d.key);if(!object)fail(410,'object_expired');
    await authorize();return new Response(object.body,{headers:{...headers,'Content-Type':'application/zip','Content-Length':String(object.size),'Content-Disposition':'attachment; filename="competition-data.zip"'}});
   }
   // Promotion = a verified copy into durable private storage. The quarantine original is never
   // modified or deleted here; its bucket lifecycle rule cleans it up later. The destination is
   // content-addressed (datasets/<uid>/<sha256>.zip), R2 rejects the write unless the bytes hash
   // to the supplied SHA-256, and the record is marked durable only after a re-read of the
   // destination's size and stored checksum. Every step is safe to retry.
   if(route==='promote'){
    if(d.status!=='complete')fail(409,'upload_incomplete');
    let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(request,1000,10000)));}catch(e){if(e.status)throw e;fail(400,'invalid_request');}
    if(!body||typeof body!=='object'||Object.keys(body).join()!=='sha256'||!/^[a-f0-9]{64}$/.test(body.sha256))fail(400,'sha256_required');
    const sha=body.sha256,dest='datasets/'+identity.uid+'/'+sha+'.zip';
    if(d.durable&&d.durable.sha256!==sha)fail(409,'durable_copy_has_other_checksum');
    const verified=h=>!!h&&h.size===d.size&&!!h.checksums?.sha256&&hex(h.checksums.sha256)===sha;
    let head=await bucket.head(dest);
    if(head&&!verified(head))fail(409,'destination_conflict');
    if(!head){
     const source=await bucket.get(d.key);if(!source)fail(410,'object_expired');if(source.size!==d.size)fail(422,'object_size_mismatch');
     await authorize();
     const {readable,writable}=new FixedLengthStream(d.size);const piping=source.body.pipeTo(writable).catch(()=>{});
     try{await bucket.put(dest,readable,{sha256:sha,httpMetadata:{contentType:'application/zip'},customMetadata:{owner:identity.uid,upload:d.id,source:d.key}});}
     catch{await piping;fail(422,'checksum_mismatch');}
     await piping;head=await bucket.head(dest);
     if(!verified(head))fail(422,'destination_verification_failed');
    }
    for(let attempt=0;attempt<5;attempt++){
     snapshot=await read();await authorize();if(snapshot.data?.id!==d.id||snapshot.data.status!=='complete')fail(409,'upload_changed');
     if(snapshot.data.durable?.sha256===sha&&snapshot.data.durable.key===dest)return send(project(snapshot.data));
     const next={...snapshot.data,durable:{key:dest,sha256:sha,size:head.size,etag:head.etag,promotedAt:now(),verification:'R2 checked SHA-256 on write; size and stored checksum re-read before marking durable'}};
     if(await write(snapshot,next))return send(project(next));
    }
    fail(409,'retry_promote');
   }
   if(route==='abort'){
    // A durable copy is the dataset of record. Removing it is a separate, deliberate decision.
    if(d.durable)fail(409,'durable_copy_exists');
    // Tombstone before provider cleanup: retries can finish cleanup after a network failure.
    if(d.status!=='aborting'){d={...d,wasComplete:d.status==='complete',status:'aborting'};await authorize();if(!await write(snapshot,d))fail(409,'retry_status');}
    if(!d.wasComplete)try{await upload.abort();}catch(e){if(!/NoSuchUpload|specified multipart upload does not exist/i.test(e.message))throw e;}
    await bucket.delete(d.key);snapshot=await read();await authorize();
    if(!snapshot.data)return send({deleted:true});
    if(snapshot.data.id!==d.id||snapshot.data.status!=='aborting')fail(409,'upload_changed');
    if(!await write(snapshot,null))fail(409,'retry_status');return send({deleted:true});
   }
   if(now()>=d.expiresAt&&d.status!=='complete')fail(410,'upload_expired_abort_and_restart');
   if(route==='part'){
    if(d.status!=='uploading')fail(409,'upload_not_writable');
    const number=Number(request.headers.get('X-Upload-Part'));if(!Number.isSafeInteger(number)||number<1||number>d.hashes.length)fail(400,'invalid_part');
    const expected=Math.min(PART_BYTES,d.size-(number-1)*PART_BYTES),bytes=await bounded(request,expected);
    if(bytes.length!==expected||await digest(bytes)!==d.hashes[number-1])fail(422,'part_integrity_mismatch');
    if(number===1&&!(bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4))fail(422,'zip_header_required');
    await authorize();snapshot=await read();if(snapshot.data?.id!==d.id||snapshot.data.status!=='uploading')fail(409,'upload_changed');
    if(snapshot.data.parts[number])return send(snapshot.data.parts[number]);
    const part=await upload.uploadPart(number,bytes);
    for(let attempt=0;attempt<5;attempt++){snapshot=await read();await authorize();if(snapshot.data?.id!==d.id||snapshot.data.status!=='uploading')fail(409,'upload_changed');const next={...snapshot.data,parts:{...snapshot.data.parts,[number]:part}};if(await write(snapshot,next))return send(part);}fail(409,'retry_same_part');
   }
   if(route==='complete'){
    if(d.status==='complete')return send(project(d));
    if(!['uploading','completing'].includes(d.status)||d.hashes.some((_,i)=>!d.parts[i+1]))fail(409,'missing_parts');
    if(d.status==='uploading'){d={...d,status:'completing'};await authorize();if(!await write(snapshot,d))fail(409,'retry_status');}
    // Recover a successful provider completion whose metadata response was lost.
    let object=await bucket.head(d.key);if(!object)object=await upload.complete(d.hashes.map((_,i)=>d.parts[i+1]));
    if(object.size!==d.size)fail(422,'object_size_mismatch');
    snapshot=await read();await authorize();if(snapshot.data?.id!==d.id||snapshot.data.status!=='completing')fail(409,'upload_changed');d={...snapshot.data,status:'complete',etag:object.etag,completedAt:now()};if(!await write(snapshot,d))fail(409,'retry_complete');return send(project(d));
   }
  }catch(e){return send({error:e.status?e.message:'private_upload_backend_unavailable'},e.status||503);}
 };
}
