/* Dedicated outbound MCP: no owner credentials, private reads or caller-selected destinations. */
const DC_PATH='/discord_bridge_v1';
const dcCheck=(ok,message)=>{if(!ok)throw new Error(message);};
async function dcHash(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');}
const DC_TOOL={name:'dd_discord_post',description:'Send explicitly authorized text to the configured Data Dawgs channel. Never auto-copy private records. Retry only with the same request_id; uncertain delivery must not be resubmitted with a new key. Labels identify credentials, not verified models.',inputSchema:{type:'object',additionalProperties:false,required:['request_id','message'],properties:{request_id:{type:'string',pattern:'^[A-Za-z0-9_-]{16,80}$'},message:{type:'string',minLength:1,maxLength:1600},record_link:{type:'string',maxLength:300}}},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}};
async function handleDiscordBridge(request,env){
 let id=null;const reply=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 try{
  dcCheck(env.DISCORD_BRIDGE_ENABLED==='true','bridge_disabled');dcCheck(request.method==='POST','post_required');
  const token=request.headers.get('Authorization')?.match(/^Bearer (ddc_[A-Za-z0-9_-]{43,100})$/)?.[1];dcCheck(token,'dedicated_credential_required');
  const digest=await dcHash(token),grant=JSON.parse(env.DISCORD_BRIDGE_GRANTS||'[]').find(g=>g.sha256===digest);
  dcCheck(grant&&grant.scope==='discord:post'&&/^[A-Za-z0-9_-]{1,60}$/.test(grant.id)&&/^[A-Za-z0-9 _.-]{1,60}$/.test(grant.label)&&Date.parse(grant.expires_at)>Date.now(),'permission_denied');
  const guild=env.DISCORD_GUILD_ID,channel=env.DISCORD_CHANNEL_ID;
  dcCheck(/^\d{17,20}$/.test(guild)&&/^\d{17,20}$/.test(channel)&&env.DISCORD_BOT_TOKEN&&env.FB_SECRET,'configuration_required');
  const reader=request.body?.getReader();dcCheck(reader,'body_required');let size=0,chunks=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw new Error('body_too_large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const rpc=JSON.parse(new TextDecoder().decode(bytes));id=rpc.id??null;dcCheck(rpc.jsonrpc==='2.0','invalid_rpc');
  if(rpc.method==='notifications/initialized')return new Response(null,{status:202});
  if(rpc.method==='initialize')return reply({jsonrpc:'2.0',id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'toto-discord-outbound',version:'1'}}});
  if(rpc.method==='tools/list')return reply({jsonrpc:'2.0',id,result:{tools:[DC_TOOL]}});
  dcCheck(rpc.method==='tools/call'&&rpc.params?.name==='dd_discord_post','unknown_tool');const a=rpc.params.arguments;
  dcCheck(a&&Object.keys(a).every(k=>['request_id','message','record_link'].includes(k))&&/^[A-Za-z0-9_-]{16,80}$/.test(a.request_id)&&typeof a.message==='string'&&a.message.trim()&&a.message.length<=1600,'invalid_arguments');
  dcCheck(!/https?:|www\.|discord\.gg|<[@#]/i.test(a.message),'links_use_record_link');
  if(a.record_link!==undefined){dcCheck(typeof a.record_link==='string'&&a.record_link.length<=300,'invalid_record_link');const u=new URL(a.record_link);dcCheck(u.origin==='https://datadawgs216.com'&&!u.username&&!u.password&&!u.search&&['/research-lab/private.html','/research-lab/'].includes(u.pathname)&&/^$|^#p_[a-f0-9-]{36}$/.test(u.hash),'invalid_record_link');}
  const fingerprint=await dcHash(JSON.stringify([a.message,a.record_link||'',guild,channel])),key=await dcHash(grant.id+':'+a.request_id),now=Date.now();let state;
  for(let n=0;n<4;n++){
   const s=await fbGet(env,DC_PATH,true);dcCheck(s.etag,'receipt_store_unavailable');state=s.data||{version:1,receipts:{},windows:{}};dcCheck(state.version===1&&state.receipts&&state.windows,'receipt_store_invalid');
   const old=state.receipts[key];if(old){dcCheck(old.fingerprint===fingerprint,'idempotency_conflict');return reply({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify({...old,replayed:true})}]}});}
   dcCheck(Object.keys(state.receipts).length<10000,'receipt_capacity_reached');
   const hour=Math.floor(now/3600000),w=state.windows.hour===hour?state.windows:{hour,total:0,callers:{}};dcCheck(w.total<60&&(w.callers[grant.id]||0)<10,'hourly_rate_limit');w.total++;w.callers[grant.id]=(w.callers[grant.id]||0)+1;state.windows=w;
   state.receipts[key]={fingerprint,status:'uncertain',request_id:a.request_id,credential_id:grant.id,author_label:grant.label,provenance:'operator_declared_credential_label_not_verified_model',guild_id:guild,channel_id:channel,created_at:new Date(now).toISOString(),notice:'Reserved before delivery; retry this key only. Private links do not grant access.'};
   if(await fbPut(env,DC_PATH,state,s.etag))break;state=null;
  }
  dcCheck(state,'receipt_conflict_retry_same_key');let receipt=state.receipts[key];
  try{
   const headers={Authorization:'Bot '+env.DISCORD_BOT_TOKEN,'Content-Type':'application/json'};
   const target=await fetch('https://discord.com/api/v10/channels/'+channel,{headers,redirect:'manual',signal:AbortSignal.timeout(10000)}),meta=target.ok?await target.json():null;
   dcCheck(meta?.guild_id===guild&&meta?.id===channel&&meta?.type===0,'destination_verification_failed');
   const content='['+grant.label+' | credential label; model unverified]\n'+a.message+(a.record_link?'\nRecord (access required): <'+a.record_link+'>':'');
   const sent=await fetch('https://discord.com/api/v10/channels/'+channel+'/messages',{method:'POST',headers,redirect:'manual',signal:AbortSignal.timeout(10000),body:JSON.stringify({content,allowed_mentions:{parse:[],users:[],roles:[],replied_user:false},flags:4})}),result=sent.ok?await sent.json():null;
   if(sent.ok&&/^\d{17,20}$/.test(result?.id)&&result.channel_id===channel)receipt={...receipt,status:'delivered',message_id:result.id,url:'https://discord.com/channels/'+guild+'/'+channel+'/'+result.id};
  }catch{}
  for(let n=0;n<4;n++){const s=await fbGet(env,DC_PATH,true);if(!s.etag)break;if(await fbPut(env,DC_PATH,{...s.data,receipts:{...s.data.receipts,[key]:receipt}},s.etag))break;}
  return reply({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(receipt)}]}});
 }catch(e){const safe=/^(bridge_|post_|dedicated_|permission_|configuration_|body_|invalid_|unknown_|links_|receipt_|idempotency_|hourly_)/.test(e.message);return reply({jsonrpc:'2.0',id,error:{code:-32000,message:safe?e.message:'backend_unavailable_retry_same_key'}});}
}

// Queue-only adapter. Caller must first persist a one-shot delivery reservation.
// Unlike general outbound posts, this creates one request-named public thread.
async function dcPublishQueueAnswer(env,job,label,text){
 const receipt={delivery:'uncertain',thread_id:null,message_id:null,notice:'Do not retry delivery or create a replacement request; inspect Discord manually.'};
 try{
  dcCheck(env.DISCORD_QUEUE_DELIVERY_ENABLED==='true'&&env.DISCORD_BOT_TOKEN,'delivery_disabled');
  dcCheck(/^\d{17,20}$/.test(job.id)&&/^\d{17,20}$/.test(job.guild_id)&&/^\d{17,20}$/.test(job.channel_id)&&job.guild_id===env.DISCORD_GUILD_ID&&job.channel_id===env.DISCORD_CHANNEL_ID,'destination_denied');
  const headers={Authorization:'Bot '+env.DISCORD_BOT_TOKEN,'Content-Type':'application/json'};
  const call=(suffix,body)=>fetch('https://discord.com/api/v10/channels/'+suffix,{headers,redirect:'manual',signal:AbortSignal.timeout(10000),...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const origin=await call(job.channel_id),parent=origin.ok?await origin.json():null;
  dcCheck(parent?.id===job.channel_id&&parent?.guild_id===job.guild_id&&parent?.type===0,'destination_verification_failed');
  const created=await call(job.channel_id+'/threads',{name:'ask-'+job.id,type:11,auto_archive_duration:1440,rate_limit_per_user:5});
  const thread=created.ok?await created.json():null;
  dcCheck(/^\d{17,20}$/.test(thread?.id)&&thread?.guild_id===job.guild_id&&thread?.parent_id===job.channel_id&&thread?.type===11,'thread_creation_uncertain');
  receipt.thread_id=thread.id;
  const content='[Request '+job.id+' | '+label+' | credential label; model unverified]\n'+text;
  dcCheck(content.length<=2000,'answer_too_large');
  const sent=await call(thread.id+'/messages',{content,allowed_mentions:{parse:[],users:[],roles:[],replied_user:false},flags:4});
  const message=sent.ok?await sent.json():null;
  if(/^\d{17,20}$/.test(message?.id)&&message.channel_id===thread.id)Object.assign(receipt,{delivery:'delivered',message_id:message.id,url:'https://discord.com/channels/'+job.guild_id+'/'+thread.id+'/'+message.id,notice:'Discord accepted this answer in the request thread.'});
 }catch{}
 return receipt;
}
