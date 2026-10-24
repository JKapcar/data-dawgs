/* One private, singleton Discord Gateway client. No public ingest endpoint. */
const DM_ABORT=Symbol('discord_gateway_abort');
const DM_SINGLETON='robokap-mentions-v1',DM_MONTH_MS=2800000e3,DM_WINDOW_MS=120000;
function dmStub(env){dpCheck(env.DISCORD_GATEWAY,503,'mention_binding_missing');return env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName(DM_SINGLETON));}
async function dmOwner(env,action){const r=await dmStub(env).fetch(new Request('https://gateway.internal/',{method:'POST',body:JSON.stringify({action})}));dpCheck(r.ok,503,'mention_listener_unavailable');return r.json();}
function dmGatewayUrl(raw){const u=new URL(raw);dpCheck(u.protocol==='wss:'&&(u.hostname==='gateway.discord.gg'||/^gateway-[a-z0-9-]+\.discord\.gg$/.test(u.hostname))&&!u.port&&!u.username&&!u.password&&u.pathname==='/',503,'gateway_url_invalid');u.search='?v=10&encoding=json';u.hash='';return u.href;}
function dmMessage(d,env,bot,now){
 // Filter identity/destination BEFORE reading content or retaining any message data.
 if(d?.guild_id!==env.DISCORD_GUILD_ID||d?.channel_id!==env.DISCORD_CHANNEL_ID||d?.author?.id!==env.DISCORD_GROK_USER_ID||d.author.bot||d.webhook_id)return null;
 if(!dqSnow(d.id)||![0,19].includes(d.type)||!Array.isArray(d.mentions)||!d.mentions.some(m=>m.id===bot))return null;
 const at=Date.parse(d.timestamp);if(!Number.isFinite(at)||at>now+30000||now-at>120000)return null;
 if(typeof d.content!=='string')return null;
 const question=d.content.replace(new RegExp('<@!?'+bot+'>','g'),'').trim();if(!question||question.length>DP.question)return null;
 return {id:d.id,guild_id:d.guild_id,channel_id:d.channel_id,member:{user:{id:d.author.id,username:dpName({user:d.author})}},source_at:at,question};
}
export class DiscordMentionGateway {
 constructor(ctx,env){
  this.ctx=ctx;this.env=env;this.ws=null;this.serial=Promise.resolve();this.heartbeat=null;this.cutoff=null;this.ack=true;this.generation=0;
  this.valid=String(ctx.id)===String(env.DISCORD_GATEWAY.idFromName(DM_SINGLETON));
  this.ready=ctx.blockConcurrencyWhile(async()=>{this.s=this.valid?(await ctx.storage.get('state')||{enabled:false,reason:'not_started',seq:null}):{enabled:false,reason:'wrong_instance'};});
 }
 async save(){await this.ctx.storage.put('state',this.s);}
 enqueue(fn){const p=this.serial.then(fn);this.serial=p.catch(()=>{});return p;}
 view(){return {enabled:!!this.s.enabled,connected:!!this.ws&&this.ws.readyState===1,ready:!!this.s.ready,reason:this.s.reason,last_event_at:this.s.last_event_at??null,last_message_id:this.s.last_message_id??null,last_job_id:this.s.last_job_id??null,last_result:this.s.last_result??null,expires_at:this.s.expires_at??null,month:this.s.month??null,reserved_gb_seconds:Math.ceil((this.s.reserved_ms||0)/8000),budget_gb_seconds:350000};}
 async fetch(request){await this.ready;if(!this.valid)return new Response('denied',{status:403});
  if(request.method!=='POST')return new Response('denied',{status:405});
  let a;try{a=await request.json();}catch{return new Response('invalid',{status:400});}
  if(a.action==='stop'){await this.stop('owner_stopped');return Response.json(this.view());}
  if(a.action==='status')return Response.json(this.view());
  const requestedGeneration=this.generation;
  return this.enqueue(async()=>{if(requestedGeneration!==this.generation)return Response.json(this.view());if(a.action==='start'){
   if(!this.s.enabled){this.s.enabled=true;this.s.reason='starting';this.s.attempts=0;this.s.retry_at=0;this.s.started_at=Date.now();await this.save();}
   await this.tick();
  }else if(a.action!=='status')return new Response('invalid',{status:400});
  return Response.json(this.view());
 });}
 close(){this.generation++;this.io?.abort();clearTimeout(this.heartbeat);clearTimeout(this.cutoff);this.heartbeat=this.cutoff=null;const ws=this.ws;this.ws=null;if(ws)try{ws.close(4000,'reconnect');}catch{}this.s.ready=false;}
 async stop(reason){this.close();this.s.enabled=false;this.s.reason=reason;this.s.session=null;this.s.seq=null;await this.save();await this.ctx.storage.deleteAlarm();}
 async bounded(fn){const controller=new AbortController();this.io=controller;let timeout;const expiry=new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(Error('io_timeout'));},10000);});try{return await Promise.race([fn({...this.env,[DM_ABORT]:controller.signal}),expiry]);}finally{clearTimeout(timeout);if(this.io===controller)this.io=null;}}
 async allowed(e=this.env){
  const generation=this.generation,until=Date.parse(e.DISCORD_GROK_APPROVAL_EXPIRES_AT),now=Date.now();
  if(e.DISCORD_MENTIONS_ENABLED!=='true'||e.DISCORD_PACK_ENABLED!=='true'||e.DISCORD_PACK_DELIVERY_ENABLED!=='true'||e.DISCORD_GROK_WAKE_ENABLED!=='true')return 'disabled';
  if(!dqSnow(e.DISCORD_GUILD_ID)||!dqSnow(e.DISCORD_CHANNEL_ID)||!dqSnow(e.DISCORD_GROK_USER_ID)||!e.DISCORD_BOT_TOKEN||!Number.isFinite(until)||until<=now)return 'configuration_or_expiry';
  const snap=await fbGet(e,DP_PATH,true);if(!snap.etag)throw Error('store_unavailable');const state=dpStore(snap.data),link=state.links[e.DISCORD_GROK_USER_ID];
  if(!link||link.owner_uid!==e.RESEARCH_OWNER_UID||Date.parse(link.expires_at)<=now)return 'owner_link_expired';
  if(state.seats.grok?.stopped_at)return 'seat_stopped';
  if(!dgAdmissible(state,e,'grok',e.DISCORD_GROK_USER_ID,now))return 'wake_unavailable';
  if(!this.s.enabled||generation!==this.generation||e[DM_ABORT]?.aborted)return 'stopped';
  this.s.expires_at=dpIso(Math.min(until,Date.parse(link.expires_at)));return null;
 }
 async reserve(){
  const now=Date.now(),month=new Date(now).toISOString().slice(0,7),d=new Date(now),end=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);
  if(this.s.month!==month){this.s.month=month;this.s.reserved_ms=0;this.s.lease_until=0;}
  const until=Math.min(now+DM_WINDOW_MS,end,Date.parse(this.s.expires_at));
  const extra=Math.max(0,until-Math.max(now,this.s.lease_until||0));
  if(until<=now||(this.s.reserved_ms||0)+extra>DM_MONTH_MS){await this.stop('runtime_budget_exhausted');return false;}
  this.s.reserved_ms=(this.s.reserved_ms||0)+extra;this.s.lease_until=until;await this.save();
  clearTimeout(this.cutoff);this.cutoff=setTimeout(()=>this.ctx.waitUntil(this.stop('runtime_lease_expired')),Math.max(1,until-Date.now()));
  await this.ctx.storage.setAlarm(Math.min(now+60000,until));return true;
 }
 async alarm(){await this.ready;if(!this.valid)return;await this.enqueue(()=>this.tick());}
 async tick(){
  if(!this.s.enabled){this.close();await this.ctx.storage.deleteAlarm();return;}
  try{
   const until=Date.parse(this.env.DISCORD_GROK_APPROVAL_EXPIRES_AT);if(!Number.isFinite(until)||until<=Date.now()){await this.stop('configuration_or_expiry');return;}
   this.s.expires_at=dpIso(until);if(!await this.reserve())return;
   const denied=await this.bounded(e=>this.allowed(e));if(denied){await this.stop(denied);return;}
   if(this.ws&&!this.s.ready&&Date.now()-this.s.connect_at>60000)await this.disconnect('handshake_timeout');
   if(!this.ws&&Date.now()>=(this.s.retry_at||0))await this.connect();
  }catch{this.close();if(!this.s.enabled||Date.now()>=this.s.lease_until||Date.now()>=Date.parse(this.s.expires_at)){await this.stop('recovery_expired');return;}this.s.reason='recovery_wait';await this.save();await this.ctx.storage.setAlarm(Math.min(Date.now()+60000,this.s.lease_until));}
 }
 async connect(){
  const now=Date.now(),hour=Math.floor(now/3600e3);if(this.s.connect_hour!==hour){this.s.connect_hour=hour;this.s.connect_count=0;}
  if((this.s.connect_count||0)>=12){this.s.reason='reconnect_hour_limit';this.s.retry_at=(hour+1)*3600e3;await this.save();return;}
  this.s.connect_count=(this.s.connect_count||0)+1;this.s.reason='connecting';this.s.ready=false;await this.save();
  const before=this.generation;const r=await dpDiscord(this.env,'gateway/bot');if(!r.ok)throw Error('gateway_unavailable');const info=await r.json();if(!this.s.enabled||before!==this.generation||Date.now()>=this.s.lease_until)return;
  if(!this.s.session&&(!(info.session_start_limit?.remaining>0)||info.shards!==1)){await this.stop('gateway_session_limit');return;}
  const url=dmGatewayUrl(this.s.session?.url||info.url),ws=new WebSocket(url),generation=++this.generation;this.ws=ws;this.ack=true;
  // WebSocket callbacks are serialized, and fenced against superseded connections.
  ws.addEventListener('message',ev=>{this.ctx.waitUntil(this.enqueue(async()=>{if(this.ws!==ws||this.generation!==generation)return;try{await this.packet(ev.data);}catch{await this.disconnect('protocol_or_handler_error');}}));});
  ws.addEventListener('close',ev=>{this.ctx.waitUntil(this.enqueue(async()=>{if(this.ws!==ws)return;if([4004,4010,4011,4012,4013,4014].includes(ev.code)){await this.stop('gateway_rejected');return;}if([4007,4009].includes(ev.code)){this.s.session=null;this.s.seq=null;}await this.disconnect('disconnected');}));});
  ws.addEventListener('error',()=>{this.ctx.waitUntil(this.enqueue(async()=>{if(this.ws===ws)await this.disconnect('connection_error');}));});
  // Hello/Ready deadline; a socket that never completes its handshake cannot hang indefinitely.
  this.s.connect_at=now;await this.save();
  this.heartbeat=setTimeout(()=>this.ctx.waitUntil(this.enqueue(async()=>{if(this.ws===ws&&!this.s.ready)await this.disconnect('handshake_timeout');})),30000);
 }
 async disconnect(reason){this.close();this.s.reason=reason;this.s.attempts=Math.min(6,(this.s.attempts||0)+1);this.s.retry_at=Date.now()+Math.min(300000,5000*2**this.s.attempts);await this.save();if(this.s.enabled)await this.ctx.storage.setAlarm(Math.min(this.s.retry_at,Date.now()+60000));}
 send(op,d){if(this.ws?.readyState!==1)throw Error('socket_closed');this.ws.send(JSON.stringify({op,d}));}
 heartbeatLater(ms){clearTimeout(this.heartbeat);this.heartbeat=setTimeout(()=>this.ctx.waitUntil(this.enqueue(async()=>{try{if(!this.s.enabled||Date.now()>=this.s.lease_until){await this.stop('runtime_lease_expired');return;}if(!this.ack){await this.disconnect('heartbeat_unacknowledged');return;}this.ack=false;this.send(1,this.s.seq);this.heartbeatLater(this.interval);}catch{await this.disconnect('heartbeat_failed');}})),ms);}
 async packet(raw){
  if(typeof raw!=='string'||raw.length>1024*1024)throw Error('invalid_packet');const p=JSON.parse(raw);
  if(p.op===10){this.interval=p.d?.heartbeat_interval;if(!Number.isFinite(this.interval)||this.interval<1000||this.interval>120000)throw Error('invalid_interval');
   this.heartbeatLater(Math.floor(Math.random()*this.interval));
   if(this.s.session&&Number.isSafeInteger(this.s.seq))this.send(6,{token:this.env.DISCORD_BOT_TOKEN,session_id:this.s.session.id,seq:this.s.seq});
   else this.send(2,{token:this.env.DISCORD_BOT_TOKEN,intents:512,properties:{os:'linux',browser:'datadawgs',device:'datadawgs'}});return;
  }
  if(p.op===11){this.ack=true;return;}if(p.op===1){this.send(1,this.s.seq);return;}
  if(p.op===7){await this.disconnect('server_reconnect');return;}
  if(p.op===9){if(p.d!==true){this.s.session=null;this.s.seq=null;}await this.disconnect('invalid_session');return;}
  if(p.op!==0||!Number.isSafeInteger(p.s))return;
  if(p.t==='READY'){
   if(p.d?.application?.id!==this.env.DISCORD_APPLICATION_ID||!dqSnow(p.d?.user?.id)||p.d.user.bot!==true||typeof p.d.session_id!=='string')throw Error('identity_mismatch');
   this.s.bot_id=p.d.user.id;this.s.session={id:p.d.session_id,url:dmGatewayUrl(p.d.resume_gateway_url)};this.s.ready=true;this.s.reason='listening';this.s.attempts=0;
  }else if(p.t==='RESUMED'){this.s.ready=true;this.s.reason='listening';this.s.attempts=0;}
  else if(p.t==='MESSAGE_CREATE'&&this.s.ready){
   const m=dmMessage(p.d,this.env,this.s.bot_id,Date.now());if(m&&m.source_at>=this.s.started_at)await this.admit(m);
  }
  this.s.seq=p.s;this.s.last_event_at=dpIso(Date.now());await this.save();
 }
 async admit(m){
  if(!this.s.enabled||Date.now()>=this.s.lease_until)return;
  // No link challenge or content is published to a channel on rejected admission.
  const generation=this.generation,live=()=>this.s.enabled&&generation===this.generation&&Date.now()<this.s.lease_until;
  const denied=await this.bounded(e=>this.allowed(e));if(denied||!live()){if(denied)await this.stop(denied);return;}
  this.s.seen=this.s.seen||{};const now=Date.now();for(const [id,at] of Object.entries(this.s.seen))if(now-at>300000)delete this.s.seen[id];
  if(this.s.seen[m.id])return;if(Object.keys(this.s.seen).length>=100)return;
  await this.bounded(e=>dpAdmit(m,e,{question:m.question,to:'grok'},()=>live()&&!e[DM_ABORT].aborted));
  if(!live())return;
  const state=dpStore((await this.bounded(e=>fbGet(e,DP_PATH,true))).data),job=state.jobs[m.id];
  if(!live())return;
  this.s.seen[m.id]=now;this.s.last_message_id=m.id;this.s.last_result=job?'queued':'not_queued';if(job)this.s.last_job_id=m.id;await this.save();
  if(job&&live())await this.bounded(e=>dgDrain(e,m.id,()=>live()&&!e[DM_ABORT].aborted));
 }
}
