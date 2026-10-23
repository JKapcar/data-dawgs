/* Grok Bot routine wake, disabled by default. Fixed operator-configured endpoint;
 * never an interaction-supplied URL. Credentials are Worker secrets, not RTDB. */
function dgSigningKey(secret){
 try{if(typeof secret!=='string'||!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))return null;const raw=atob(secret.slice(6));if(raw.length<16||raw.length>128)return null;return Uint8Array.from(raw,c=>c.charCodeAt(0));}catch{return null;}
}
async function dgSignedHeaders(secret,id,timestamp,body){
 const bytes=dgSigningKey(secret);if(!bytes)throw Error('grok_signing_secret_invalid');
 const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(id+'.'+timestamp+'.'+body)));
 let binary='';for(const b of digest)binary+=String.fromCharCode(b);
 return {'Content-Type':'application/json','webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':'v1,'+btoa(binary)};
}
// Fixed reason codes only: never expose configuration values or secret details.
function dgConfigFailures(env){
 const failures=[];
 for(const [key,code] of [['DISCORD_PACK_ENABLED','pack_disabled'],['DISCORD_PACK_DELIVERY_ENABLED','delivery_disabled'],['DISCORD_GROK_WAKE_ENABLED','wake_disabled'],['DISCORD_GROK_INCLUDED_USAGE_CONFIRMED','included_usage_unconfirmed']])if(env[key]!=='true')failures.push(code);
 if(dpSeatConfig(env).grok?.key_label!=='pack-grok')failures.push('seat_configuration_invalid');
 const until=Date.parse(env.DISCORD_GROK_APPROVAL_EXPIRES_AT),now=Date.now();
 if(!Number.isFinite(until)||until<=now||until>now+86400e3)failures.push('approval_window_invalid');
 if(!dqSnow(env.DISCORD_GROK_USER_ID))failures.push('requester_configuration_invalid');
 let u;try{u=new URL(env.GROK_ROUTINE_URL);}catch{}
 if(!u||u.protocol!=='https:'||u.origin!==env.GROK_ROUTINE_ORIGIN||u.username||u.password||u.hash||u.port||!u.hostname.includes('.')||/^[\d.]+$|^\[|\.(local|localhost|internal)$/.test(u.hostname))failures.push('endpoint_configuration_invalid');
 if(!dgSigningKey(env.GROK_WEBHOOK_SIGNING_SECRET))failures.push('signing_configuration_invalid');
 return failures;
}
function dgConfig(env){return dgConfigFailures(env).length?null:{url:new URL(env.GROK_ROUTINE_URL).href,until:Date.parse(env.DISCORD_GROK_APPROVAL_EXPIRES_AT)};}
function dgOwnerDiagnostics(s,env,now){
 const failures=dgConfigFailures(env),uid=env.DISCORD_GROK_USER_ID;
 if(s.seats.grok?.stopped_at)failures.push('seat_stopped');
 if(!(s.links[uid]?.owner_uid===env.RESEARCH_OWNER_UID&&Date.parse(s.links[uid].expires_at)>now))failures.push('configured_requester_link_invalid');
 return {ready:failures.length===0,failures};
}
function dgAdmissible(s,env,seat,uid,now){return seat==='grok'&&uid===env.DISCORD_GROK_USER_ID&&!!dgConfig(env)&&!s.seats.grok?.stopped_at&&s.links[uid]?.owner_uid===env.RESEARCH_OWNER_UID&&Date.parse(s.links[uid].expires_at)>now;}
function dgStage(j,now){j.wake={mechanism:'grok_routine',status:'pending',attempts:0,due_ms:now,deadline_ms:now+20*60e3};}
function dgView(j,now){const w=j.wake;return {mechanism:'grok_routine',status:w.status==='sending'&&now-w.reserved_ms>10000?'uncertain':w.status,attempts:w.attempts,receipt_acknowledged:w.status==='accepted',execution_verified:false,execution_status:j.delivery==='delivered'?'reply_delivered':now>w.deadline_ms?'timed_out_requires_owner_review':j.claim?'claimed_not_execution_proof':'awaiting_claim'};}
async function dgKey(env){const users=(await fbGet(env,'/users')).data;return users?.[env.RESEARCH_OWNER_UID]?.mcpTokens?.['pack-grok']?.hash??null;}
async function dgDrain(env,onlyId){
 const cfg=dgConfig(env);if(!cfg)return;
 const hash=await dgKey(env);if(typeof hash!=='string'||!hash)return;
 const admission='dga_'+dpRandom(32),admissionHash=await dcHash(admission),deliveryId='msg_'+dpRandom(16);
 const plan=await dpTxn(env,s=>{
  const now=Date.now(),jobs=Object.values(s.jobs);
  // One outstanding unanswered wake. Delivery does not prove the external run ended.
  // Ambiguous or expired accepted wakes stop further wakes;
  // an owner must inspect them. A timeout never proves a run has ended.
  if(jobs.some(j=>j.wake?.mechanism==='grok_routine'&&['sending','accepted','uncertain'].includes(j.wake.status)&&j.delivery!=='delivered'))return {write:false};
  const j=jobs.filter(j=>(!onlyId||j.id===onlyId)&&j.wake?.mechanism==='grok_routine'&&['pending','retry'].includes(j.wake.status)&&j.wake.due_ms<=now).sort(dpById)[0];
  if(!j)return {write:false};const w=j.wake;
  if(!dgAdmissible(s,env,j.seat,j.requester_id,now)||j.guild_id!==env.DISCORD_GUILD_ID||j.parent_id!==env.DISCORD_CHANNEL_ID){w.status='cancelled';return {write:true};}
  if(now>w.deadline_ms){w.status='timed_out';return {write:true};}
  if(j.state!=='queued'){w.status='not_needed';return {write:true};}
  const day=Math.floor(now/86400e3),hour=Math.floor(now/3600e3),budget=s.windows.grok??{};
  if(budget.day!==day){budget.day=day;budget.daily=0;}if(budget.hour!==hour){budget.hour=hour;budget.hourly=0;}
  if(budget.daily>=10||budget.hourly>=3)return {write:false};
  budget.daily++;budget.hourly++;s.windows.grok=budget;
  w.status='sending';w.attempts++;w.reserved_ms=now;w.admission_sha256=admissionHash;w.delivery_id=deliveryId;
  return {write:true,result:{id:j.id,attempt:w.attempts,hash}};
 });
 if(!plan)return;
 let status='uncertain',http=null;
 try{
  const s=dpStore((await fbGet(env,DP_PATH)).data),j=s.jobs[plan.id],fresh=dgConfig(env);
  if(!fresh||fresh.url!==cfg.url||await dgKey(env)!==plan.hash||!j||!dgAdmissible(s,env,j.seat,j.requester_id,Date.now())||j.guild_id!==env.DISCORD_GUILD_ID||j.parent_id!==env.DISCORD_CHANNEL_ID)status='cancelled';
  else {
   const body=JSON.stringify({job_id:plan.id,admission}),timestamp=String(Math.floor(Date.now()/1000));
   const headers=await dgSignedHeaders(env.GROK_WEBHOOK_SIGNING_SECRET,deliveryId,timestamp,body);
   const r=await fetch(cfg.url,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),headers,body});
   http=r.status;void r.body?.cancel().catch(()=>{});
   // 202 acknowledges asynchronous acceptance, not completion. Documented 429/503
   // are retryable rejections. Other ambiguous outcomes must never be replayed.
   status=http===202?'accepted':[429,503].includes(http)?(plan.attempt<3?'retry':'rejected'):[400,401,413].includes(http)?'rejected':'uncertain';
  }
 }catch{status='uncertain';}
 await dpTxn(env,s=>{const w=s.jobs[plan.id]?.wake;if(w?.status!=='sending'||w.attempts!==plan.attempt)return {write:false};Object.assign(w,{status,http_status:http,updated_at:dpIso(Date.now()),due_ms:Date.now()+60000*2**(plan.attempt-1)});return {write:true};});
}
