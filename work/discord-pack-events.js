/* Native ChatGPT MCP Events. Off by default; never invokes a model itself.
 * Callback credentials are encrypted at rest. PACK_EVENT_EGRESS is a trusted
 * service binding implementing the DNS-pinned HTTPS contract in the runbook.
 * There is deliberately NO fallback to ordinary fetch for callback URLs. */
const DPE_NAME='pack.request.created';
const DPE={ttl:3600e3,maxTtl:86400e3,rotation:300e3,deadline:20*60e3,maxAttempts:3};
function dpeEnabled(env){return env.DISCORD_PACK_EVENTS_ENABLED==='true'&&env.DISCORD_PACK_ENABLED==='true';}
function dpeReady(env){return dpeEnabled(env)&&!!env.PACK_EVENT_EGRESS?.fetch&&typeof env.PACK_EVENT_ENCRYPTION_KEY==='string'&&!!env.PACK_EVENT_CALLBACK_ORIGINS;}
function dpeExact(x,keys){return dpObj(x)&&Object.keys(x).every(k=>keys.includes(k));}
function dpeBytes(s){try{return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}catch{dpFail(400,'invalid_event_secret');}}
function dpeBase64(b){return btoa(String.fromCharCode(...new Uint8Array(b)));}
function dpeSecret(s){dpCheck(typeof s==='string'&&s.length<=94&&/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(s),400,'invalid_event_secret');const b=dpeBytes(s.slice(6));dpCheck(b.length>=24&&b.length<=64,400,'invalid_event_secret');return b;}
async function dpeCrypt(env,id,value,decrypt=false){
 const bytes=dpeBytes(env.PACK_EVENT_ENCRYPTION_KEY||'');dpCheck(bytes.length===32,503,'event_encryption_unconfigured');
 const key=await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,[decrypt?'decrypt':'encrypt']);
 const iv=decrypt?dpeBytes(value.iv):crypto.getRandomValues(new Uint8Array(12));
 const alg={name:'AES-GCM',iv,additionalData:new TextEncoder().encode('pack-event:'+id)};
 if(decrypt)return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt(alg,key,dpeBytes(value.ciphertext))));
 return {iv:dpeBase64(iv),ciphertext:dpeBase64(await crypto.subtle.encrypt(alg,key,new TextEncoder().encode(JSON.stringify(value))))};
}
function dpeUrl(env,value){
 let u,origins;try{u=new URL(value);origins=JSON.parse(env.PACK_EVENT_CALLBACK_ORIGINS||'[]');}catch{dpFail(400,'callback_denied');}
 dpCheck(typeof value==='string'&&value.length<=2048&&u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&(!u.port||u.port==='443')&&Array.isArray(origins)&&origins.includes(u.origin),400,'callback_denied');
 // The allowlist is deployment-controlled, never supplied by an event subscriber.
 dpCheck(!/^\[|^[\d.]+$/.test(u.hostname)&&u.hostname.includes('.')&&!u.hostname.endsWith('.local')&&!u.hostname.endsWith('.localhost'),400,'callback_denied');
 return u.href;
}
function dpeFilters(env,caller,args){
 const seat=dpSeatForCaller(env,caller);
 dpCheck(seat==='dot'&&caller.transport==='header'&&typeof caller.credentialHash==='string',403,'event_seat_denied');
 dpCheck(dpeExact(args,['owner_uid','seat','guild_id','channel_id','discord_user_id'])&&Object.keys(args).length===5&&args.owner_uid===caller.uid&&args.seat===seat&&args.guild_id===env.DISCORD_GUILD_ID&&args.channel_id===env.DISCORD_CHANNEL_ID&&dqSnow(args.discord_user_id),400,'event_filters_denied');
 return {owner_uid:caller.uid,seat,guild_id:env.DISCORD_GUILD_ID,channel_id:env.DISCORD_CHANNEL_ID,discord_user_id:args.discord_user_id};
}
function dpeLink(s,env,filters,now){const l=s.links[filters.discord_user_id];return l?.owner_uid===env.RESEARCH_OWNER_UID&&Date.parse(l.expires_at)>now&&!s.seats[filters.seat]?.stopped_at;}
async function dpeCredential(env,sub){
 if(!dpeReady(env)||sub.owner_uid!==env.RESEARCH_OWNER_UID||sub.filters.owner_uid!==env.RESEARCH_OWNER_UID||sub.filters.seat!=='dot'||sub.filters.guild_id!==env.DISCORD_GUILD_ID||sub.filters.channel_id!==env.DISCORD_CHANNEL_ID||dpSeatConfig(env)[sub.filters.seat]?.key_label!==sub.key_label)return false;
 // Read the source of truth, never token-map fallbacks or a cached auth principal.
 const users=(await fbGet(env,'/users')).data;
 return typeof users?.[sub.owner_uid]?.mcpTokens?.[sub.key_label]?.hash==='string'&&users[sub.owner_uid].mcpTokens[sub.key_label].hash===sub.credential_hash;
}
function dpeDefinition(env,caller){return {name:DPE_NAME,description:'A linked Discord owner submitted a request to this dot seat in its permitted channel. Payload contains only a job ID; retrieve it with the seat tools. Webhook receipt is not execution.',delivery:['webhook'],
 inputSchema:{type:'object',additionalProperties:false,required:['owner_uid','seat','guild_id','channel_id','discord_user_id'],properties:{owner_uid:{type:'string',const:caller.uid},seat:{type:'string',const:'dot'},guild_id:{type:'string',const:env.DISCORD_GUILD_ID},channel_id:{type:'string',const:env.DISCORD_CHANNEL_ID},discord_user_id:dpIdArg}},
 payloadSchema:{type:'object',additionalProperties:false,required:['job_id'],properties:{job_id:dpIdArg}}};}
async function dpeSigned(env,id,url,secrets,eventId,body){
 dpCheck(dpeReady(env),503,'event_transport_unconfigured');dpeUrl(env,url);
 const stamp=String(Math.floor(Date.now()/1000)),data=new TextEncoder().encode(eventId+'.'+stamp+'.'+body),signatures=[];
 for(const secret of secrets){const k=await crypto.subtle.importKey('raw',dpeSecret(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);signatures.push('v1,'+dpeBase64(await crypto.subtle.sign('HMAC',k,data)));}
 // Service-only request. Its implementation MUST pin validated public DNS results
 // for each connection, preserve TLS hostname verification, and refuse redirects.
 return env.PACK_EVENT_EGRESS.fetch(new Request(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','webhook-id':eventId,'webhook-timestamp':stamp,'webhook-signature':signatures.join(' '),'X-MCP-Subscription-Id':id},body}));
}
async function dpeSmallJson(response){
 const reader=response.body?.getReader();if(!reader)return null;const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;dpCheck(size<=4096,400,'callback_response_too_large');chunks.push(value);}const bytes=new Uint8Array(size);let n=0;for(const c of chunks){bytes.set(c,n);n+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));}finally{await reader.cancel().catch(()=>{});}
}
async function dpeMethods(m,env,caller,reauth){
 const ok=result=>({jsonrpc:'2.0',id:m.id,result});
 try{
  dpCheck(dpeEnabled(env)&&dpSeatForCaller(env,caller)==='dot'&&caller.transport==='header'&&caller.credentialHash,403,'event_seat_denied');
  if(m.method==='server/discover')return ok({resultType:'complete',supportedVersions:['2026-07-28'],capabilities:{tools:{},events:{}}});
  if(m.method==='events/list'){dpCheck(!m.params||dpeExact(m.params,[])||(dpeExact(m.params,['cursor'])&&m.params.cursor===null),400,'event_cursor_unsupported');return ok({events:[dpeDefinition(env,caller)]});}
  dpCheck(['events/subscribe','events/unsubscribe'].includes(m.method),400,'event_method_denied');
  const p=m.params;dpCheck(dpeExact(p,['name','arguments','delivery','cursor','ttlMs'])&&p.name===DPE_NAME&&p.cursor==null,400,'event_parameters_invalid');
  const filters=dpeFilters(env,caller,p.arguments);dpCheck(dpeExact(p.delivery,['mode','url','secret'])&&p.delivery.mode==='webhook',400,'event_delivery_invalid');
  const url=dpeUrl(env,p.delivery.url),id='sub_'+await dcHash(JSON.stringify([caller.uid,caller.keyLabel,url,DPE_NAME,filters]));
  const check=async()=>{dpCheck(typeof reauth==='function',401,'event_reauth_required');const fresh=await reauth();dpCheck(dpSeatForCaller(env,fresh)==='dot'&&fresh?.uid===caller.uid&&fresh?.keyLabel===caller.keyLabel&&fresh?.credentialHash===caller.credentialHash&&fresh?.transport==='header',401,'event_credential_revoked');};
  await check();
  if(m.method==='events/unsubscribe')return ok(await dpTxn(env,s=>{if(!s.subscriptions?.[id])return {result:{},write:false};delete s.subscriptions[id];return {result:{},write:true};}));
  dpCheck(dpeReady(env),503,'event_transport_unconfigured');dpeSecret(p.delivery.secret);
  dpCheck(p.ttlMs==null||(Number.isSafeInteger(p.ttlMs)&&p.ttlMs>0),400,'event_ttl_invalid');
  const now=Date.now(),expires=now+Math.min(p.ttlMs??DPE.ttl,DPE.maxTtl);
  const snap=dpStore((await fbGet(env,DP_PATH)).data),old=snap.subscriptions?.[id];
  dpCheck(dpeLink(snap,env,filters,now),403,'event_link_required');
  const previous=old?await dpeCrypt(env,id,old.sealed,true):null;
  // Callback verification is cached only for the same principal, URL AND secret.
  const cached=old&&previous.secret===p.delivery.secret&&old.credential_hash===caller.credentialHash&&now-old.verified_ms<DPE.rotation;
  if(!cached){
   const challenge=dpRandom(32),body=JSON.stringify({type:'verification',challenge});let r,echo;
   try{r=await dpeSigned(env,id,url,[p.delivery.secret],'verify_'+dpRandom(24),body);if(r.ok)echo=(await dpeSmallJson(r))?.challenge;}catch{throw Object.assign(new Error('callback_verification_failed'),{eventReason:'timeout'});}
   // Fixed-length comparison avoids secret-dependent early returns.
   let diff=typeof echo==='string'?echo.length^challenge.length:1;for(let i=0;i<challenge.length;i++)diff|=challenge.charCodeAt(i)^(typeof echo==='string'?echo.charCodeAt(i)||0:0);
   if(!r?.ok||diff)throw Object.assign(new Error('callback_verification_failed'),{eventReason:'challenge_failed'});
  }
  const rotated=previous&&previous.secret!==p.delivery.secret;
  const sealed=await dpeCrypt(env,id,{url,secret:p.delivery.secret,...(rotated?{previous:previous.secret,rotate_until:now+DPE.rotation}:previous?.rotate_until>now?{previous:previous.previous,rotate_until:previous.rotate_until}:{})});
  await check();
  return ok(await dpTxn(env,s=>{
   dpCheck(dpeLink(s,env,filters,Date.now()),403,'event_link_required');s.subscriptions??={};
   // Exactly one destination per seat: refreshing it is safe; a second subscriber
   // must explicitly unsubscribe the first rather than fan out private work.
   dpCheck(!Object.values(s.subscriptions).some(x=>x.id!==id&&x.filters.seat===filters.seat&&x.expires_ms>Date.now()),409,'event_seat_already_subscribed');
   dpCheck((s.subscriptions[id]?.revision??0)===(old?.revision??0),409,'event_subscription_changed_retry');
   for(const [k,v] of Object.entries(s.subscriptions))if(v.expires_ms<=Date.now())delete s.subscriptions[k];
   s.subscriptions[id]={id,owner_uid:caller.uid,key_label:caller.keyLabel,credential_hash:caller.credentialHash,filters,sealed,expires_ms:expires,verified_ms:cached?old.verified_ms:now,revision:dpRandom(24)};
   return {result:{id,refreshBefore:dpIso(expires),cursor:null,truncated:false},write:true};
  }));
 }catch(e){return {jsonrpc:'2.0',id:m.id,error:{code:e.eventReason?-32015:-32602,message:e.eventReason?'Callback verification failed':e.dqStatus?e.message:'Event operation unavailable',...(e.eventReason?{data:{reason:e.eventReason}}:{})}};}
}
function dpeSubscription(s,env,seat,uid,now){
 if(!dpeReady(env)||seat!=='dot')return null;
 return Object.values(s.subscriptions??{}).find(x=>x.owner_uid===env.RESEARCH_OWNER_UID&&x.filters.seat===seat&&x.filters.discord_user_id===uid&&x.filters.guild_id===env.DISCORD_GUILD_ID&&x.filters.channel_id===env.DISCORD_CHANNEL_ID&&x.key_label===dpSeatConfig(env)[seat]?.key_label&&x.expires_ms>now&&dpeLink(s,env,x.filters,now))??null;
}
function dpeStage(job,sub,now){job.wake={mechanism:'mcp_event',subscription_id:sub.id,event_id:'pack_'+job.id,status:'pending',attempts:0,due_ms:now,deadline_ms:now+DPE.deadline};}
function dpeView(j,now){const w=j.wake;if(!w)return {performed:false,mechanism:'session_polling',execution_verified:false};return {mechanism:'mcp_event',status:w.status==='sending'&&now-w.reserved_ms>10000?'uncertain':w.status,attempts:w.attempts,event_id:w.event_id,receipt_acknowledged:w.status==='accepted',execution_verified:false,execution_status:j.delivery==='delivered'?'reply_delivered':now>w.deadline_ms?(j.claim?'timed_out_no_reply':'timed_out_no_claim'):j.claim?'claimed_not_execution_proof':'awaiting_claim',run_evidence:j.run_evidence??null};}
async function dpeDrain(env,onlyId){
 if(!dpeReady(env))return;
 const snapshot=dpStore((await fbGet(env,DP_PATH)).data);
 const ids=Object.values(snapshot.jobs).filter(j=>(!onlyId||j.id===onlyId)&&j.wake&&['pending','retry'].includes(j.wake.status)&&j.wake.due_ms<=Date.now()).slice(0,10).map(j=>j.id);
 for(const id of ids){
  const sub=snapshot.subscriptions?.[snapshot.jobs[id].wake.subscription_id];let authorized=false;
  try{authorized=!!sub&&await dpeCredential(env,sub);}catch{continue;} // outage: keep durable pending state
  const plan=await dpTxn(env,s=>{
   const j=s.jobs[id],w=j?.wake,current=s.subscriptions?.[w?.subscription_id],now=Date.now();
   if(!w||!['pending','retry'].includes(w.status)||w.due_ms>now)return {write:false};
   if(current&&sub&&current.revision!==sub.revision)return {write:false}; // refresh race: reload on next drain
   if(!authorized||!current||current.expires_ms<=now||!dpeLink(s,env,current.filters,now)||j.requester_id!==current.filters.discord_user_id||j.guild_id!==current.filters.guild_id||j.parent_id!==current.filters.channel_id){w.status='cancelled';return {write:true};}
   if(now>w.deadline_ms){w.status='timed_out';return {write:true};}
   if(j.state!=='queued'){w.status='not_needed';return {write:true};}
   w.status='sending';w.attempts++;w.reserved_ms=now;
   return {write:true,result:{sub:structuredClone(current),event:{eventId:w.event_id,name:DPE_NAME,timestamp:j.created_at,data:{job_id:id},cursor:null},attempt:w.attempts}};
  });
  if(!plan)continue;
  let status='uncertain',http=null;
  try{
   const credentials=await dpeCrypt(env,plan.sub.id,plan.sub.sealed,true);
   // Recheck after reservation so revocation during storage work cannot dispatch.
   const latest=dpStore((await fbGet(env,DP_PATH)).data),live=latest.subscriptions?.[plan.sub.id];
   if(live&&live.revision!==plan.sub.revision)status='retry'; // no network call occurred; reload refreshed credentials
   else if(!live||live.expires_ms<=Date.now()||!dpeLink(latest,env,live.filters,Date.now())||!await dpeCredential(env,plan.sub))status='cancelled';
   else{const secrets=[credentials.secret,...(credentials.rotate_until>Date.now()&&credentials.previous?[credentials.previous]:[])];const r=await dpeSigned(env,plan.sub.id,credentials.url,secrets,plan.event.eventId,JSON.stringify(plan.event));http=r.status;status=r.ok?'accepted':r.status===429&&plan.attempt<DPE.maxAttempts?'retry':r.status>=500?'uncertain':'rejected';}
  }catch{status='uncertain';} // timeout/lost response never blindly retried
  await dpTxn(env,s=>{const w=s.jobs[id]?.wake;if(!w||w.status!=='sending'||w.attempts!==plan.attempt)return {write:false};Object.assign(w,{status,http_status:http,updated_at:dpIso(Date.now()),due_ms:Date.now()+60000*2**(plan.attempt-1)});if(http===410&&s.subscriptions?.[plan.sub.id]?.revision===plan.sub.revision)delete s.subscriptions[plan.sub.id];return {write:true};});
 }
}
