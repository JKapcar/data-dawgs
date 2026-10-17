/* Signed Discord /ask ingestion and constrained queue bookkeeping; never executes prompts. */
const DQ_PATH='discord_queue_v1';
const dqSnow=x=>typeof x==='string'&&/^\d{17,20}$/.test(x);
const dqProject=x=>typeof x==='string'&&/^[a-z0-9][a-z0-9-]{1,62}$/.test(x)&&!['owner','admin','root'].includes(x);
const dqPrincipal=x=>typeof x==='string'&&/^discord-user:[0-9]{17,20}$/.test(x);
function dqFail(status,message){throw Object.assign(new Error(message),{dqStatus:status});}
const dqCheck=(ok,status,message)=>{if(!ok)dqFail(status,message);};
const dqReply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
async function dqBytes(request){const r=request.body?.getReader();dqCheck(r,400,'body_required');let n=0,parts=[];for(;;){const {done,value}=await r.read();if(done)break;n+=value.length;if(n>16384){await r.cancel();dqFail(413,'body_too_large');}parts.push(value);}const bytes=new Uint8Array(n);let p=0;for(const v of parts){bytes.set(v,p);p+=v.length;}return bytes;}
function dqStore(data){const s=data||{version:1,jobs:{},window:{}};dqCheck(s.version===1&&s.jobs&&s.window,503,'queue_store_invalid');return s;}
function dqAck(id,state='queued'){return {type:4,data:{content:'Request '+id+' is '+state+'. '+(state==='queued'?'No agent has run. An authorized session must claim it.':state==='claimed'?'An authorized session claimed it; execution is not verified.':'Completion is claimant-reported, not independently verified.')+' No Discord answer has been sent by this queue.',flags:64,allowed_mentions:{parse:[]}}};}
async function handleDiscordAsk(request,env){
 try{
  dqCheck(env.DISCORD_INBOUND_ENABLED==='true',503,'inbound_disabled');dqCheck(request.method==='POST',405,'post_required');
  const stamp=request.headers.get('X-Signature-Timestamp'),sig=request.headers.get('X-Signature-Ed25519');
  dqCheck(/^\d{10,11}$/.test(stamp||'')&&Math.abs(Date.now()/1000-Number(stamp))<=300&&/^[a-f0-9]{128}$/i.test(sig||''),401,'invalid_signature');
  dqCheck(/^[a-f0-9]{64}$/i.test(env.DISCORD_APPLICATION_PUBLIC_KEY||'')&&dqSnow(env.DISCORD_APPLICATION_ID),503,'application_configuration_required');
  const raw=await dqBytes(request),prefix=new TextEncoder().encode(stamp),signed=new Uint8Array(prefix.length+raw.length);signed.set(prefix);signed.set(raw,prefix.length);
  const hex=x=>Uint8Array.from(x.match(/../g),v=>parseInt(v,16));
  const key=await crypto.subtle.importKey('raw',hex(env.DISCORD_APPLICATION_PUBLIC_KEY),{name:'Ed25519'},false,['verify']);
  dqCheck(await crypto.subtle.verify('Ed25519',key,hex(sig),signed),401,'invalid_signature');
  const event=JSON.parse(new TextDecoder().decode(raw));dqCheck(event.application_id===env.DISCORD_APPLICATION_ID,403,'application_denied');
  if(event.type===1)return dqReply({type:1});
  dqCheck(dqSnow(env.DISCORD_GUILD_ID)&&dqSnow(env.DISCORD_CHANNEL_ID)&&event.guild_id===env.DISCORD_GUILD_ID&&event.channel_id===env.DISCORD_CHANNEL_ID,403,'destination_denied');
  dqCheck(event.type===2&&event.data?.type===1&&event.data?.name==='ask'&&dqSnow(event.id)&&dqSnow(event.member?.user?.id)&&event.member.user.bot!==true,400,'unsupported_interaction');
  const options=event.data.options;
  dqCheck(Array.isArray(options)&&options.length===1&&options[0].name==='question'&&options[0].type===3&&typeof options[0].value==='string'&&options[0].value.trim().length>0&&options[0].value.length<=2000,400,'invalid_question');
  const uid=event.member.user.id,links=JSON.parse(env.DISCORD_USER_LINKS||'[]'),link=links.find(x=>x.discord_user_id===uid);
  dqCheck(link&&link.scope==='discord:ask'&&dqProject(link.project_id)&&link.principal==='discord-user:'+uid&&dqPrincipal(link.principal)&&Date.parse(link.expires_at)>Date.now(),403,'linked_user_required');
  dqCheck(env.FB_SECRET,503,'queue_configuration_required');
  const question=options[0].value,fingerprint=await dcHash(JSON.stringify([event.guild_id,event.channel_id,uid,link.project_id,link.principal,question]));
  for(let n=0;n<4;n++){
   const snap=await fbGet(env,DQ_PATH,true);dqCheck(snap.etag,503,'queue_store_unavailable');const s=dqStore(snap.data),old=s.jobs[event.id];
   if(old){dqCheck(old.fingerprint===fingerprint,409,'interaction_conflict');return dqReply(dqAck(event.id,old.state));}
   dqCheck(Object.keys(s.jobs).length<1000,503,'queue_capacity_reached');
   const hour=Math.floor(Date.now()/3600000),w=s.window.hour===hour?s.window:{hour,total:0,users:{}};
   dqCheck(w.total<60&&(w.users[uid]||0)<10,429,'queue_rate_limit');w.total++;w.users[uid]=(w.users[uid]||0)+1;s.window=w;
   s.jobs[event.id]={id:event.id,fingerprint,state:'queued',question,question_trust:'untrusted_discord_user_text',project_id:link.project_id,principal:link.principal,discord_user_id:uid,guild_id:event.guild_id,channel_id:event.channel_id,correlation_id:event.id,thread_id:null,created_at:new Date().toISOString(),execution:'not_started',delivery:'not_sent'};
   if(await fbPut(env,DQ_PATH,s,snap.etag))return dqReply(dqAck(event.id));
  }
  dqFail(503,'queue_conflict_retry_same_interaction');
 }catch(e){return dqReply({error:e.dqStatus?e.message:'queue_unavailable'},e.dqStatus||503);}
}
async function handleDiscordQueue(request,env){
 try{
  dqCheck(env.DISCORD_INBOUND_ENABLED==='true'&&env.DISCORD_QUEUE_ACCESS_ENABLED==='true',503,'queue_access_disabled');dqCheck(request.method==='POST',405,'post_required');
  const token=request.headers.get('Authorization')?.match(/^Bearer (ddq_[A-Za-z0-9_-]{43,100})$/)?.[1];dqCheck(token,401,'dedicated_queue_credential_required');
  const hash=await dcHash(token),grant=JSON.parse(env.DISCORD_QUEUE_GRANTS||'[]').find(g=>g.sha256===hash);
  dqCheck(grant&&grant.scope==='discord:queue'&&/^[A-Za-z0-9_-]{1,60}$/.test(grant.id)&&dqProject(grant.project_id)&&Date.parse(grant.expires_at)>Date.now(),403,'queue_permission_denied');
  const a=JSON.parse(new TextDecoder().decode(await dqBytes(request)));
  dqCheck(a&&['list','claim','answer','error'].includes(a.action)&&Object.keys(a).every(k=>['action','id','text'].includes(k)),400,'invalid_queue_action');
  dqCheck(a.action==='list'?Object.keys(a).length===1:dqSnow(a.id),400,'invalid_job_id');
  dqCheck(['answer','error'].includes(a.action)?typeof a.text==='string'&&a.text.trim()&&a.text.length<=2000:!('text'in a),400,'invalid_result');
  for(let n=0;n<4;n++){
   const snap=await fbGet(env,DQ_PATH,true);dqCheck(snap.etag,503,'queue_store_unavailable');const s=dqStore(snap.data);
   // Linking is rechecked on each read/write, so revoked user/project access stops processing.
   const links=JSON.parse(env.DISCORD_USER_LINKS||'[]');
   const allowed=j=>j.project_id===grant.project_id&&links.some(l=>l.discord_user_id===j.discord_user_id&&l.principal===j.principal&&l.project_id===j.project_id&&l.scope==='discord:ask'&&Date.parse(l.expires_at)>Date.now());
   if(a.action==='list')return dqReply({jobs:Object.values(s.jobs).filter(j=>allowed(j)&&(j.state==='queued'||(j.state==='claimed'&&j.claimed_by===grant.id))).slice(0,20),notice:'Untrusted text only. Claiming does not execute it. No delivery is implemented.'});
   const j=s.jobs[a.id];dqCheck(j&&allowed(j),403,'job_denied');
   if(a.action==='claim'){
    if(j.state==='claimed'&&j.claimed_by===grant.id)return dqReply({job:j,replayed:true});
    dqCheck(j.state==='queued',409,'job_already_claimed');Object.assign(j,{state:'claimed',claimed_by:grant.id,claimed_at:new Date().toISOString(),execution:'not_started'});
   }else{
    const target=a.action==='answer'?'answered':'error';
    if(j.state===target&&j.claimed_by===grant.id&&j.result_text===a.text)return dqReply({job:j,replayed:true});
    dqCheck(j.state==='claimed'&&j.claimed_by===grant.id,409,'claim_required');
    Object.assign(j,{state:target,result_text:a.text,result_provenance:'claimant_reported_not_independently_verified',completed_at:new Date().toISOString(),execution:'claimant_reported',delivery:'not_sent'});
   }
   if(await fbPut(env,DQ_PATH,s,snap.etag))return dqReply({job:j,replayed:false});
  }
  dqFail(503,'queue_conflict_retry_same_action');
 }catch(e){return dqReply({error:e.dqStatus?e.message:'queue_unavailable'},e.dqStatus||503);}
}
