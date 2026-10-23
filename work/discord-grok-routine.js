/* Grok Bot routine wake, disabled by default. Fixed operator-configured endpoint;
 * never an interaction-supplied URL. Credentials are Worker secrets, not RTDB. */
function dgConfig(env){
 if(env.DISCORD_PACK_ENABLED!=='true'||env.DISCORD_PACK_DELIVERY_ENABLED!=='true'||env.DISCORD_GROK_WAKE_ENABLED!=='true'||env.DISCORD_GROK_INCLUDED_USAGE_CONFIRMED!=='true'||dpSeatConfig(env).grok?.key_label!=='pack-grok')return null;
 const until=Date.parse(env.DISCORD_GROK_APPROVAL_EXPIRES_AT),now=Date.now();
 if(!Number.isFinite(until)||until<=now||until>now+86400e3||!dqSnow(env.DISCORD_GROK_USER_ID))return null;
 let u;try{u=new URL(env.GROK_ROUTINE_URL);}catch{return null;}
 if(u.protocol!=='https:'||u.origin!==env.GROK_ROUTINE_ORIGIN||u.username||u.password||u.hash||u.port||!u.hostname.includes('.')||/^[\d.]+$|^\[|\.(local|localhost|internal)$/.test(u.hostname)||typeof env.GROK_ROUTINE_TOKEN!=='string'||env.GROK_ROUTINE_TOKEN.length<20||/[\r\n]/.test(env.GROK_ROUTINE_TOKEN))return null;
 return {url:u.href,until};
}
function dgAdmissible(s,env,seat,uid,now){return seat==='grok'&&uid===env.DISCORD_GROK_USER_ID&&!!dgConfig(env)&&!s.seats.grok?.stopped_at&&s.links[uid]?.owner_uid===env.RESEARCH_OWNER_UID&&Date.parse(s.links[uid].expires_at)>now;}
function dgStage(j,now){j.wake={mechanism:'grok_routine',status:'pending',attempts:0,due_ms:now,deadline_ms:now+20*60e3};}
function dgView(j,now){const w=j.wake;return {mechanism:'grok_routine',status:w.status==='sending'&&now-w.reserved_ms>10000?'uncertain':w.status,attempts:w.attempts,receipt_acknowledged:w.status==='accepted',execution_verified:false,execution_status:j.delivery==='delivered'?'reply_delivered':now>w.deadline_ms?'timed_out_requires_owner_review':j.claim?'claimed_not_execution_proof':'awaiting_claim'};}
async function dgKey(env){const users=(await fbGet(env,'/users')).data;return users?.[env.RESEARCH_OWNER_UID]?.mcpTokens?.['pack-grok']?.hash??null;}
async function dgDrain(env,onlyId){
 const cfg=dgConfig(env);if(!cfg)return;
 const hash=await dgKey(env);if(typeof hash!=='string'||!hash)return;
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
  w.status='sending';w.attempts++;w.reserved_ms=now;
  return {write:true,result:{id:j.id,attempt:w.attempts,hash}};
 });
 if(!plan)return;
 let status='uncertain',http=null;
 try{
  const s=dpStore((await fbGet(env,DP_PATH)).data),j=s.jobs[plan.id],fresh=dgConfig(env);
  if(!fresh||fresh.url!==cfg.url||await dgKey(env)!==plan.hash||!j||!dgAdmissible(s,env,j.seat,j.requester_id,Date.now())||j.guild_id!==env.DISCORD_GUILD_ID||j.parent_id!==env.DISCORD_CHANNEL_ID)status='cancelled';
  else {
   const r=await fetch(cfg.url,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bearer '+env.GROK_ROUTINE_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({job_id:plan.id})});
   http=r.status;void r.body?.cancel().catch(()=>{});
   // Only documented HTTP 200 means started. Explicit 429 is known not-started.
   // Network/5xx outcomes remain uncertain; never blindly replay them.
   status=http===200?'accepted':http===429?(plan.attempt<3?'retry':'rejected'):'uncertain';
  }
 }catch{status='uncertain';}
 await dpTxn(env,s=>{const w=s.jobs[plan.id]?.wake;if(w?.status!=='sending'||w.attempts!==plan.attempt)return {write:false};Object.assign(w,{status,http_status:http,updated_at:dpIso(Date.now()),due_ms:Date.now()+60000*2**(plan.attempt-1)});return {write:true};});
}
