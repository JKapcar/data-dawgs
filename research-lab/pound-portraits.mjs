// Owner-only bounded attachments. Reserve in the existing workspace before writing R2.
// Every possible object has a retained reservation; no untracked uploads or public URLs.
export const PORTRAIT_LIMITS={bytes:524288,pixels:1048576,dimension:1024,versions:8};
export const PORTRAIT_WRITE_SCHEMA={type:'object',additionalProperties:false,required:['expected_revision','request_id','alt','png_base64'],properties:{expected_revision:{type:'integer',minimum:0},request_id:{type:'string',pattern:'^[A-Za-z0-9_-]{16,80}$'},alt:{type:'string',minLength:1,maxLength:200},png_base64:{type:'string',maxLength:699052,description:'Normalized PNG bytes; no data URL prefix. Strict raster validation also applies.'}}};
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const check=(ok,status,message)=>{if(!ok)fail(status,message);};
const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),n=>n.toString(16).padStart(2,'0')).join('');
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
async function bounded(stream,max){const r=stream?.getReader();check(r,400,'body_required');let size=0;const chunks=[];let timer;try{const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{r.cancel().catch(()=>{});reject(Object.assign(Error('body_timeout'),{status:408}));},15000);});for(;;){const {done,value}=await Promise.race([r.read(),timeout]);if(done)break;size+=value.length;check(size<=max,413,'size_limit');chunks.push(value);}const out=new Uint8Array(size);let p=0;for(const c of chunks){out.set(c,p);p+=c.length;}return out;}finally{clearTimeout(timer);await r.cancel().catch(()=>{});}}
export async function validatePortrait(bytes){
 check(bytes.length<=PORTRAIT_LIMITS.bytes&&bytes.length>=57,413,'image_size_limit');
 check([137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b),415,'normalized_png_required');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),idat=[];let p=8,width,height,color,ended=false,seenData=false;
 while(p<bytes.length){check(p+12<=bytes.length,415,'invalid_png');const len=v.getUint32(p),end=p+12+len;check(end<=bytes.length,415,'invalid_png');const type=String.fromCharCode(...bytes.slice(p+4,p+8));check(crc(bytes.slice(p+4,p+8+len))===v.getUint32(p+8+len),415,'invalid_png_crc');
  if(p===8){check(type==='IHDR'&&len===13,415,'invalid_png_header');width=v.getUint32(p+8);height=v.getUint32(p+12);color=bytes[p+17];check(width>0&&height>0&&width<=1024&&height<=1024&&width*height<=PORTRAIT_LIMITS.pixels,413,'image_dimensions');check(bytes[p+16]===8&&[2,6].includes(color)&&bytes[p+18]===0&&bytes[p+19]===0&&bytes[p+20]===0,415,'normalized_png_required');}
  else if(type==='IDAT'){check(!ended,415,'invalid_png');idat.push(bytes.slice(p+8,p+8+len));seenData=true;}
  else if(type==='IEND'){check(seenData&&len===0&&end===bytes.length,415,'invalid_png_end');ended=true;}
  else check(!seenData&&((type==='sRGB'&&len===1)||(type==='pHYs'&&len===9)),415,'unsupported_png_chunk');
  p=end;
 }
 check(ended,415,'invalid_png_end');const stride=width*(color===6?4:3)+1,expected=stride*height;
 let raw;try{raw=await bounded(new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate')),expected);}catch{fail(415,'invalid_png_pixels');}
 check(raw.length===expected,415,'invalid_png_pixels');for(let y=0;y<height;y++)check(raw[y*stride]<=4,415,'invalid_png_filter');
 return {width,height,sha256:await hash(bytes),size:bytes.length,type:'image/png'};
}
export function createPortraitGateway({fbGet,fbPut,ownerIdentity,now=()=>new Date().toISOString()}){
 return async(request,env)=>{
  const headers={'Content-Type':'application/json','Cache-Control':'private, no-store, max-age=0','Vary':'Origin, Authorization','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; sandbox"};
  const send=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  try{
   const origin=request.headers.get('Origin');check(!origin||['https://datadawgs216.com','https://www.datadawgs216.com'].includes(origin),403,'origin_denied');if(origin)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'});
   check(env.POUND_PORTRAITS_ENABLED==='true'&&env.DAWG_POUND_ENABLED==='true'&&env.RESEARCH_UPLOADS,503,'portraits_disabled');
   const url=new URL(request.url),m=url.pathname.match(/^\/pound-portraits\/v1\/(contexts|agents)\/(p_[a-f0-9-]{36})(?:\/image\/([A-Za-z0-9_-]{16,80}))?$/);check(m&&!url.search,404,'not_found');if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   check(['GET','POST'].includes(request.method)&&(!m[3]||request.method==='GET'),405,'method_denied');
   const uid=await ownerIdentity(request,env),path='/privatePounds/'+uid,target=m[1]+':'+m[2];
   const authorize=async()=>check(await ownerIdentity(request,env)===uid,401,'account_changed');
   const read=async()=>{const s=await fbGet(env,path,true);check(s.etag&&s.data?.owner_uid===uid,404,'workspace_unavailable');const state=JSON.parse(s.data.payload);check(state[m[1]]?.some(r=>r.id===m[2]&&!r.archived),404,'target_unavailable');return {...s,state};};
   const save=async s=>{await authorize();s.state.revision++;s.state.updated_at=now();const payload=JSON.stringify(s.state);check(new TextEncoder().encode(payload).length<=524288,413,'workspace_capacity');return fbPut(env,path,{...s.data,payload},s.etag);};
   const publicRecord=r=>({request_id:r.request_id,expected_revision:r.expected_revision,status:r.status,sha256:r.sha256,size:r.size,width:r.width,height:r.height,type:r.type,alt:r.alt,created_at:r.created_at});
   let s=await read();const records=()=>s.state.portraitUploads?.[target]||[];
   if(request.method==='GET'){
    if(m[3]){const r=records().find(r=>r.request_id===m[3]&&r.status==='ready');check(r,404,'portrait_not_found');const object=await env.RESEARCH_UPLOADS.get(r.key);check(object&&object.size===r.size,410,'portrait_unavailable');await authorize();return new Response(object.body,{headers:{...headers,'Content-Type':'image/png','Content-Length':String(r.size),'Content-Disposition':'inline; filename="portrait.png"'}});}
    return send({version:1,revision:s.state.revision,target:{kind:m[1],id:m[2]},limits:PORTRAIT_LIMITS,writeSchema:PORTRAIT_WRITE_SCHEMA,portraits:records().map(publicRecord),active:records().filter(r=>r.status==='ready').at(-1)?.request_id||null});
   }
   check(request.headers.get('Content-Type')?.split(';')[0]==='application/json',415,'json_required');let b;try{b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(request.body,710000)));}catch(e){if(e.status)throw e;fail(400,'invalid_json');}
   check(b&&Object.keys(b).sort().join()===['alt','expected_revision','png_base64','request_id'].sort().join()&&Number.isSafeInteger(b.expected_revision)&&b.expected_revision>=0&&/^[A-Za-z0-9_-]{16,80}$/.test(b.request_id)&&typeof b.alt==='string'&&b.alt.trim().length>0&&b.alt.length<=200&&!/[\x00-\x1f]/.test(b.alt)&&typeof b.png_base64==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(b.png_base64),400,'invalid_input');
   let bytes;try{bytes=Uint8Array.from(atob(b.png_base64),c=>c.charCodeAt(0));}catch{fail(400,'invalid_base64');}const image=await validatePortrait(bytes);
   const fingerprint=await hash(new TextEncoder().encode(JSON.stringify([target,b.expected_revision,b.alt,image.sha256])));
   let record=records().find(r=>r.request_id===b.request_id);
   if(record){check(record.fingerprint===fingerprint,409,'idempotency_conflict');if(record.status==='ready')return send({portrait:publicRecord(record),replayed:true,revision:s.state.revision});}
   else{
    check(s.state.revision===b.expected_revision,409,'revision_conflict');check(!records().some(r=>r.status==='pending'),409,'pending_upload_retry_original');check(records().length<PORTRAIT_LIMITS.versions,409,'portrait_history_full');
    record={...image,request_id:b.request_id,expected_revision:b.expected_revision,fingerprint,alt:b.alt,status:'pending',created_at:now(),key:'pound-portraits/'+uid+'/'+m[1]+'/'+m[2]+'/'+b.request_id+'.png'};
    s.state.portraitUploads??={};(s.state.portraitUploads[target]??=[]).push(record);check(await save(s),409,'revision_conflict');
   }
   // Reservation survives failures, revocation and ambiguous R2 responses. Retry identical bytes/key.
   await authorize();await env.RESEARCH_UPLOADS.put(record.key,bytes,{sha256:image.sha256,httpMetadata:{contentType:'image/png'},customMetadata:{owner:uid,target,sha256:image.sha256}});
   const stored=await env.RESEARCH_UPLOADS.get(record.key);check(stored&&stored.size===image.size,503,'upload_unverified');check(await hash(await stored.arrayBuffer())===image.sha256,503,'upload_unverified');
   for(let attempt=0;attempt<3;attempt++){s=await read();record=records().find(r=>r.request_id===b.request_id);check(record&&record.fingerprint===fingerprint,409,'reservation_changed');if(record.status==='ready')return send({portrait:publicRecord(record),replayed:true,revision:s.state.revision});record.status='ready';if(await save(s))return send({portrait:publicRecord(record),replayed:false,revision:s.state.revision},201);}
   fail(409,'finalize_retry_identical_request');
  }catch(e){return send({error:e.status||e.poundStatus?e.message:'portrait_temporarily_unavailable'},e.status||e.poundStatus||503);}
 };
}
