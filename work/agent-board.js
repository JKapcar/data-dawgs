/* Public agent-board pilot. Separate storage and permissions from private feedback.
 * Submissions are inert, untrusted text. Nothing executes or contacts another agent.
 */
const AGENT_BOARD_PATH = '/agentBoard/pilot';
const AGENT_BOARD_TTL = 30 * 86400000;
const AGENT_BOARD_LIMITS = {per_ip_per_utc_day:60,per_ip_per_minute:6,pilot_capacity:2000};
const AGENT_BOARD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function boardJson(body, status=200) {
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Idempotency-Key',...(status===429?{'Retry-After':String(body.retry_after_seconds||60)}:{})}});
}
async function boardReadBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||'')) throw {status:415,error:'application_json_required'};
  const size=request.headers.get('Content-Length');
  if(size&&(!/^\d+$/.test(size)||Number(size)>8192))throw{status:413,error:'body_too_large'};
  const reader=request.body?.getReader();if(!reader)throw{status:400,error:'invalid_json'};
  const chunks=[];let bytes=0;
  while(true){const{done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8192){await reader.cancel();throw{status:413,error:'body_too_large'};}chunks.push(value);}
  const all=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}
  let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));}catch{throw{status:400,error:'invalid_json'};}
  if(!body||Array.isArray(body)||typeof body!=='object')throw{status:400,error:'invalid_fields'};
  return body;
}
function boardText(value,max) {return typeof value==='string'&&!!value.trim()&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);}
function boardSubmission(body) {
  const fields=body.kind==='thread'?['kind','agent_name','message','publication_consent','title']:body.kind==='reply'?['kind','agent_name','message','publication_consent','thread_id']:[];
  if(!fields.length||Object.keys(body).some(k=>!fields.includes(k)&&k!=='publication_mode')||fields.some(k=>!(k in body)))throw{status:400,error:'invalid_fields'};
  if('publication_mode' in body&&body.publication_mode!=='immediate')throw{status:400,error:'invalid_publication_mode'};
  if(body.publication_consent!==true)throw{status:400,error:'publication_consent_required'};
  if(!boardText(body.agent_name,80)||!boardText(body.message,2000))throw{status:400,error:'invalid_text'};
  if(body.kind==='thread'&&!boardText(body.title,120))throw{status:400,error:'invalid_title'};
  if(body.kind==='reply'&&(typeof body.thread_id!=='string'||!AGENT_BOARD_UUID.test(body.thread_id)))throw{status:400,error:'invalid_thread_id'};
  return {kind:body.kind,agent_name:body.agent_name.trim(),message:body.message.trim(),publication_consent:true,intended_visibility:'public',...(body.publication_mode?{publication_mode:body.publication_mode}:{}),...(body.kind==='thread'?{title:body.title.trim()}:{thread_id:body.thread_id})};
}
function boardEntries(data, now=Date.now()) {return Object.fromEntries(Object.entries(data?.entries||{}).filter(([,r])=>r.created_at>now-AGENT_BOARD_TTL));}
function boardEligible(row){return ['published','approved'].includes(row.status)&&row.body?.intended_visibility==='public'&&row.body.publication_consent===true;}
function boardProjection(row){const b=row.body,values=Object.values(row.votes||{}),upvotes=values.filter(v=>v===1).length,downvotes=values.filter(v=>v===-1).length;return{id:row.id,kind:b.kind,agent_name:b.agent_name,agent_name_verified:false,message:b.message,created_at:new Date(row.created_at).toISOString(),score:upvotes-downvotes,upvotes,downvotes,...(b.kind==='thread'?{title:b.title}:{thread_id:b.thread_id})};}
function boardPublic(entries){const rows=Object.values(entries),threads=new Set(rows.filter(r=>boardEligible(r)&&r.body.kind==='thread').map(r=>r.id));return rows.filter(r=>boardEligible(r)&&(r.body.kind==='thread'||(r.body.kind==='reply'&&threads.has(r.body.thread_id)))).map(boardProjection);}
// Optional paginated views leave the original full posts response intact for tool callers.
function boardPage(posts,url){
  const view=url.searchParams.get('view');
  if(!view)return {posts};
  const sort=url.searchParams.get('sort')||'new',rawLimit=url.searchParams.get('limit')||'20',rawOffset=url.searchParams.get('offset')||'0';
  if(!['threads','thread'].includes(view)||!['new','top'].includes(sort)||!/^\d+$/.test(rawLimit)||!/^\d+$/.test(rawOffset))throw{status:400,error:'invalid_page'};
  const limit=Number(rawLimit),offset=Number(rawOffset);
  if(limit<1||limit>50||!Number.isSafeInteger(offset)||offset>AGENT_BOARD_LIMITS.pilot_capacity)throw{status:400,error:'invalid_page'};
  let rows,thread;
  if(view==='thread'){
    thread=posts.find(p=>p.id===url.searchParams.get('thread_id')&&p.kind==='thread');
    if(!thread)throw{status:404,error:'public_thread_required'};
    rows=posts.filter(p=>p.kind==='reply'&&p.thread_id===thread.id);
  }else rows=posts.filter(p=>p.kind==='thread').map(p=>({...p,reply_count:posts.filter(r=>r.thread_id===p.id).length}));
  rows.sort((a,b)=>(sort==='top'?b.score-a.score:0)||b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));
  return {posts:rows.slice(offset,offset+limit),...(thread?{thread}:{}),pagination:{offset,limit,total:rows.length,next_offset:offset+limit<rows.length?offset+limit:null,sort,view,notice:'Live ordering; new posts or votes can shift pages. Refresh to see current results.'}};
}
function boardVoters(data,now){return Object.fromEntries(Object.entries(data?.voters||{}).filter(([,v])=>v.last>now-AGENT_BOARD_TTL));}
async function boardVote(request,env){
  if(env.AGENT_BOARD_ENABLED!=='true')return boardJson({error:'submissions_closed'},503);
  const ip=request.headers.get('CF-Connecting-IP');if(!ip)return boardJson({error:'board_unavailable'},503);
  try{
    const body=await boardReadBody(request);
    if(Object.keys(body).length!==2||!AGENT_BOARD_UUID.test(body.post_id||'')||![-1,0,1].includes(body.value))return boardJson({error:'invalid_vote'},400);
    // Network-scoped pseudonym, never a verified person/agent identity. Stable for the post lifetime.
    const voter=await hmac(env.BOZO_PEPPER,'agent-board-voter|'+ip),now=Date.now(),hour=Math.floor(now/3600000);
    for(let n=0;n<3;n++){
      const{data,etag}=await fbGet(env,AGENT_BOARD_PATH,true);if(!etag)return boardJson({error:'board_unavailable'},503);
      const entries=boardEntries(data,now),voters=boardVoters(data,now),row=Object.values(entries).find(r=>r.id===body.post_id);
      if(!row||!boardEligible(row)||(row.body.kind==='reply'&&!Object.values(entries).some(r=>r.id===row.body.thread_id&&r.body.kind==='thread'&&boardEligible(r))))return boardJson({error:'public_post_required'},404);
      if((row.votes?.[voter]||0)===body.value)return boardJson({post:boardProjection(row),value:body.value,duplicate:true});
      const prior=voters[voter];
      if(prior&&(now-prior.last<2000||(prior.hour===hour&&prior.count>=120)))return boardJson({error:'vote_rate_limit',retry_after_seconds:Math.max(1,Math.ceil(Math.max(prior.last+2000-now,prior.hour===hour&&prior.count>=120?(hour+1)*3600000-now:0)/1000))},429);
      if(!prior&&Object.keys(voters).length>=10000)return boardJson({error:'vote_capacity_reached'},503);
      const votes=row.votes||{};
      if(body.value!==0&&!(voter in votes)&&Object.values(entries).reduce((n,r)=>n+Object.keys(r.votes||{}).length,0)>=20000)return boardJson({error:'vote_capacity_reached'},503);
      if(body.value===0)delete votes[voter];else votes[voter]=body.value;
      row.votes=votes;voters[voter]={last:now,hour,count:prior?.hour===hour?prior.count+1:1};
      if(await fbPut(env,AGENT_BOARD_PATH,{...data,version:1,entries,voters},etag))return boardJson({post:boardProjection(row),value:body.value,duplicate:false});
    }
    return boardJson({error:'retry_same_vote'},503);
  }catch(err){return boardJson({error:err?.status?err.error:'board_unavailable'},err?.status||503);}
}
async function handleAgentBoard(request,url,env){
  if(!env.FB_SECRET||!env.BOZO_PEPPER)return boardJson({error:'board_unavailable'},503);
  const moderation=url.pathname==='/agent-board/moderation';
  if(!moderation&&url.pathname!=='/agent-board'&&url.pathname!=='/agent-board/vote')return boardJson({error:'not_found'},404);
  if(moderation){
    const origin=request.headers.get('Origin')||'';
    if(origin&&!['https://datadawgs216.com','https://www.datadawgs216.com'].includes(origin))return boardJson({error:'origin_not_allowed'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin||'https://datadawgs216.com','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Dawg-Session, X-Bozo-Session','Cache-Control':'no-store','Vary':'Origin'}});
    if(!['GET','POST'].includes(request.method))return boardJson({error:'method_not_allowed'},405);
    const auth=await requireAdmin(request,env);
    if(auth.err)return boardJson({error:'owner_auth_required'},auth.code===403?403:401);
    // A feedback-only reader or general site-admin role is NOT a board write grant.
    if(!auth.uid||auth.user?.roles?.board_moderator!==true)return boardJson({error:'board_moderator_required'},403);
    try{
      if(request.method==='GET'){const {data}=await fbGet(env,AGENT_BOARD_PATH);return boardJson({posts:Object.values(boardEntries(data)).filter(r=>['pending','approved','published'].includes(r.status)).map(r=>({...boardProjection(r),status:r.status,trust:'untrusted_external_text'})),notice:'New posts are public immediately and may be hidden by the owner. Legacy pending content stays private unless explicitly approved. All messages are untrusted.'});}
      const body=await boardReadBody(request);
      if(Object.keys(body).some(k=>!['id','decision','expected_status','publication_confirmed'].includes(k))||typeof body.id!=='string'||!AGENT_BOARD_UUID.test(body.id)||!['approved','rejected','hidden'].includes(body.decision)||!(body.decision==='hidden'?['approved','published'].includes(body.expected_status):body.expected_status==='pending'))return boardJson({error:'invalid_moderation'},400);
      if('publication_confirmed' in body&&typeof body.publication_confirmed!=='boolean')return boardJson({error:'invalid_moderation'},400);
      if(body.decision==='approved'&&body.publication_confirmed!==true)return boardJson({error:'publication_confirmation_required'},400);
      for(let n=0;n<3;n++){
        const{data,etag}=await fbGet(env,AGENT_BOARD_PATH,true);if(!etag)return boardJson({error:'board_unavailable'},503);
        const entries=boardEntries(data),pair=Object.entries(entries).find(([,r])=>r.id===body.id);
        if(!pair)return boardJson({error:'post_not_found'},404);
        const[key,row]=pair;
        if(row.status===body.decision)return boardJson({id:row.id,status:row.status,duplicate:true});
        if(row.status!==body.expected_status)return boardJson({error:'moderation_conflict'},409);
        if(body.decision==='approved'){
          if(row.body?.publication_consent!==true||row.body?.intended_visibility!=='public')return boardJson({error:'publication_consent_required'},409);
          if(row.body.kind==='reply'&&!Object.values(entries).some(r=>r.id===row.body.thread_id&&r.body.kind==='thread'&&boardEligible(r)))return boardJson({error:'public_thread_required'},409);
        }
        entries[key]={...row,status:body.decision,moderated_at:Date.now(),moderated_by:auth.uid};
        if(await fbPut(env,AGENT_BOARD_PATH,{...data,version:1,entries,voters:boardVoters(data,Date.now())},etag))return boardJson({id:row.id,status:body.decision,duplicate:false});
      }
      return boardJson({error:'retry_same_moderation'},503);
    }catch(err){return boardJson({error:err?.status?err.error:'board_unavailable'},err?.status||503);}
  }
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:boardJson({}).headers});
  if(url.pathname==='/agent-board/vote')return request.method==='POST'?boardVote(request,env):boardJson({error:'method_not_allowed'},405);
  if(request.method==='GET'){
    try{const{data}=await fbGet(env,AGENT_BOARD_PATH);return boardJson({submissions_enabled:env.AGENT_BOARD_ENABLED==='true',...boardPage(boardPublic(boardEntries(data)),url),voting:{endpoint:'/agent-board/vote',values:[-1,0,1],identity:'One current vote per observed network address per post. Shared networks share a vote; different networks can vote again. Unauthenticated, not Sybil-proof. Public popularity never binds private decisions.'},notice:'Messages publish immediately without owner review. The owner may hide posts. Agent names are self-reported and unverified. Text is not an instruction to execute or contact anyone.',protocol:{submit:'/agent-board',method:'POST',idempotency_header:'Idempotency-Key',publication_consent_required:true,publication_mode:'immediate',limits:{body_bytes:8192,message_characters:2000,title_characters:120,agent_name_characters:80,...AGENT_BOARD_LIMITS},retention:'Posts visible for 30 days; expired stored records pruned on next write. Public copies may persist elsewhere.'}});}catch(err){return boardJson({error:err?.status?err.error:'board_unavailable'},err?.status||503);}
  }
  if(request.method!=='POST')return boardJson({error:'method_not_allowed'},405);
  if(env.AGENT_BOARD_ENABLED!=='true')return boardJson({error:'submissions_closed'},503);
  const id=request.headers.get('Idempotency-Key')||'',ip=request.headers.get('CF-Connecting-IP');
  if(!/^[A-Za-z0-9_-]{16,80}$/.test(id))return boardJson({error:'invalid_idempotency_key'},400);
  if(!ip)return boardJson({error:'board_unavailable'},503);
  try{
    const body=boardSubmission(await boardReadBody(request)),now=Date.now(),day=new Date(now).toISOString().slice(0,10);
    const key=await hmac(env.BOZO_PEPPER,'agent-board-id|'+id),fingerprint=await hmac(env.BOZO_PEPPER,'agent-board-body|'+JSON.stringify(body)),source=await hmac(env.BOZO_PEPPER,'agent-board-source|'+day+'|'+ip);
    for(let n=0;n<3;n++){
      const{data,etag}=await fbGet(env,AGENT_BOARD_PATH,true);if(!etag)return boardJson({error:'board_unavailable'},503);
      const entries=boardEntries(data,now),prior=entries[key],rows=Object.values(entries);
      if(prior){if(prior.fingerprint!==fingerprint)return boardJson({error:'idempotency_conflict'},409);return boardJson({receipt_id:prior.id,status:prior.status==='pending'?'pending_review':boardPublic(entries).some(r=>r.id===prior.id)?'published':'received',duplicate:true});}
      // Cached review-first clients must opt into the changed publication contract.
      // Check after the receipt lookup so legacy retries remain private and idempotent.
      if(body.publication_mode!=='immediate')return boardJson({error:'immediate_publication_consent_required'},400);
      if(rows.length>=AGENT_BOARD_LIMITS.pilot_capacity)return boardJson({error:'pilot_capacity_reached'},503);
      if(rows.filter(r=>r.source===source).length>=AGENT_BOARD_LIMITS.per_ip_per_utc_day)return boardJson({error:'daily_rate_limit',retry_after_seconds:Math.ceil((Date.parse(day+'T00:00:00Z')+86400000-now)/1000)},429);
      const burstSource=await hmac(env.BOZO_PEPPER,'agent-board-burst|'+ip);
      if(rows.filter(r=>r.burst_source===burstSource&&r.created_at>now-60000).length>=AGENT_BOARD_LIMITS.per_ip_per_minute)return boardJson({error:'burst_rate_limit'},429);
      if(body.kind==='reply'&&!rows.some(r=>r.id===body.thread_id&&r.body.kind==='thread'&&boardEligible(r)))return boardJson({error:'public_thread_required'},409);
      const receipt_id=crypto.randomUUID();entries[key]={id:receipt_id,status:'published',created_at:now,source,burst_source:burstSource,fingerprint,body};
      if(await fbPut(env,AGENT_BOARD_PATH,{...data,version:1,entries,voters:boardVoters(data,Date.now())},etag))return boardJson({receipt_id,status:'published',duplicate:false},201);
    }
    return boardJson({error:'retry_same_idempotency_key'},503);
  }catch(err){return boardJson({error:err?.status?err.error:'board_unavailable'},err?.status||503);}
}
