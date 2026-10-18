/* Explicit browser-session policy, separate from ddq_ grants. No arbitrary prompts or private reads. */
const DS_PROJECT='jason-discord-smoke',DS_QUESTION='Reply with pong.',DS_ANSWER='pong.';
function dsPolicy(env){
 dqCheck(env.DISCORD_OWNER_SMOKE_ENABLED==='true',503,'owner_smoke_disabled');
 let w;try{w=JSON.parse(env.DISCORD_SMOKE_WINDOW||'null');}catch{}
 const start=Date.parse(w?.starts_at),end=Date.parse(w?.expires_at),now=Date.now();
 dqCheck(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=1800000&&now>=start&&now<end,403,'smoke_window_closed');
 dqCheck(/^u_[A-Za-z0-9_-]{1,100}$/.test(env.RESEARCH_OWNER_UID||'')&&dqSnow(env.DISCORD_SMOKE_USER_ID)&&dqSnow(env.DISCORD_GUILD_ID)&&dqSnow(env.DISCORD_CHANNEL_ID)&&dqSnow(env.DISCORD_APPLICATION_ID),503,'smoke_configuration_required');
 return {owner:env.RESEARCH_OWNER_UID,user:env.DISCORD_SMOKE_USER_ID,project_id:DS_PROJECT,expires_at:w.expires_at};
}
function dsAdmission(env,event){
 const p=dsPolicy(env);
 dqCheck(event.member.user.id===p.user&&event.guild_id===env.DISCORD_GUILD_ID&&event.channel_id===env.DISCORD_CHANNEL_ID,403,'smoke_identity_denied');
 dqCheck(event.data.options[0].value===DS_QUESTION,400,'smoke_question_required');
 return {principal:'discord-user:'+p.user,project_id:DS_PROJECT,scope:'discord:ask',expires_at:p.expires_at};
}
async function handleDiscordOwnerSmoke(request,env){
 const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Origin, Authorization','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
 const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
 try{
  const origin=request.headers.get('Origin');dqCheck(!origin||['https://datadawgs216.com','https://www.datadawgs216.com'].includes(origin),403,'origin_denied');
  if(origin)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'});
  const url=new URL(request.url);dqCheck(url.pathname==='/discord/owner-smoke'&&!url.search,404,'not_found');
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  dqCheck(['GET','POST'].includes(request.method),405,'method_denied');
  const p=dsPolicy(env);
  const authorize=async()=>{dsPolicy(env);let uid;try{uid=await poundIdentity(request,env);}catch{dqFail(401,'site_session_required');}dqCheck(uid===p.owner,403,'owner_required');};
  await authorize();
  const path='/discord_queue_v1';
  const read=async()=>{const s=await fbGet(env,path,true);dqCheck(s.etag,503,'queue_store_unavailable');return {...s,data:dqStore(s.data)};};
  const allowed=j=>j.owner_smoke===true&&j.project_id===DS_PROJECT&&j.discord_user_id===p.user&&j.principal==='discord-user:'+p.user&&j.guild_id===env.DISCORD_GUILD_ID&&j.channel_id===env.DISCORD_CHANNEL_ID&&j.question===DS_QUESTION;
  const view=j=>j?{id:j.id,question:j.question,state:j.state,delivery:j.delivery,answer:j.result_text||null,thread_id:j.thread_id||null,url:j.url||null}:null;
  let snap=await read();
  if(request.method==='GET')return send({project_id:DS_PROJECT,user:p.user,guild:env.DISCORD_GUILD_ID,channel:env.DISCORD_CHANNEL_ID,expires_at:p.expires_at,question:DS_QUESTION,answer:DS_ANSWER,registration:snap.data.owner_smoke_registration?.status||'not_requested',job:view(Object.values(snap.data.jobs).find(allowed)),queue_enabled:env.DISCORD_INBOUND_ENABLED==='true'&&env.DISCORD_QUEUE_ACCESS_ENABLED==='true',delivery_enabled:env.DISCORD_QUEUE_DELIVERY_ENABLED==='true',mode:'deterministic_manual_smoke_not_model_execution'});
  dqCheck(request.headers.get('Content-Type')?.split(';')[0]==='application/json',415,'json_required');
  const a=JSON.parse(new TextDecoder().decode(await dqBytes(request)));
  dqCheck(a&&['register','claim','answer'].includes(a.action)&&Object.keys(a).every(k=>['action','id'].includes(k))&&(a.action==='register'?Object.keys(a).length===1:dqSnow(a.id)),400,'invalid_smoke_action');
  if(a.action==='register'){
   dqCheck(env.DISCORD_BOT_TOKEN,503,'bot_secret_required');
   const fingerprint=await dcHash(JSON.stringify([env.DISCORD_APPLICATION_ID,env.DISCORD_GUILD_ID,'ask',DS_PROJECT]));
   const old=snap.data.owner_smoke_registration;
   if(old){dqCheck(old.fingerprint===fingerprint,409,'registration_conflict');return send({registration:old.status,replayed:true});}
   snap.data.owner_smoke_registration={fingerprint,status:'uncertain'};await authorize();
   dqCheck(await fbPut(env,path,snap.data,snap.etag),409,'retry_read_state');
   // Only POST one named command; never bulk-overwrite other guild commands.
   const r=await fetch('https://discord.com/api/v10/applications/'+env.DISCORD_APPLICATION_ID+'/guilds/'+env.DISCORD_GUILD_ID+'/commands',{method:'POST',headers:{Authorization:'Bot '+env.DISCORD_BOT_TOKEN,'Content-Type':'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000),body:JSON.stringify({name:'ask',type:1,description:'Submit a request to an authorized manual session',default_member_permissions:'0',options:[{name:'question',description:'Question for the manual session',type:3,required:true,max_length:2000}]})});
   const result=r.ok?await r.json():null;
   dqCheck(result?.name==='ask'&&result.application_id===env.DISCORD_APPLICATION_ID&&result.guild_id===env.DISCORD_GUILD_ID&&dqSnow(result.id),502,'registration_uncertain');
   snap=await read();dqCheck(snap.data.owner_smoke_registration?.fingerprint===fingerprint,409,'registration_conflict');snap.data.owner_smoke_registration.status='registered';
   dqCheck(await fbPut(env,path,snap.data,snap.etag),503,'registration_receipt_uncertain');return send({registration:'registered'});
  }
  dqCheck(env.DISCORD_INBOUND_ENABLED==='true'&&env.DISCORD_QUEUE_ACCESS_ENABLED==='true',503,'queue_access_disabled');
  const j=snap.data.jobs[a.id];dqCheck(j&&allowed(j),403,'smoke_job_denied');
  if(a.action==='claim'){
   if(j.state==='claimed'&&j.claimed_by==='owner-smoke:'+p.owner)return send({job:view(j),replayed:true});
   dqCheck(j.state==='queued',409,'claim_required');Object.assign(j,{state:'claimed',claimed_by:'owner-smoke:'+p.owner,execution:'manual_deterministic_smoke'});
  }else{
   dqCheck(j.claimed_by==='owner-smoke:'+p.owner,409,'claim_required');
   if(['uncertain','delivered'].includes(j.delivery))return send({job:view(j),replayed:true});
   dqCheck(j.state==='claimed'&&env.DISCORD_QUEUE_DELIVERY_ENABLED==='true'&&env.DISCORD_BOT_TOKEN,403,'delivery_disabled');
   Object.assign(j,{result_text:DS_ANSWER,result_provenance:'deterministic_smoke_not_model_authored',delivery:'uncertain',delivery_reserved_at:new Date().toISOString()});
  }
  await authorize();dqCheck(await fbPut(env,path,snap.data,snap.etag),409,'retry_read_state');
  if(a.action==='answer'){
   const result=await dcPublishQueueAnswer(env,j,'Manual deterministic smoke',DS_ANSWER);
   snap=await read();const saved=snap.data.jobs[a.id];dqCheck(allowed(saved)&&saved.delivery==='uncertain',409,'receipt_conflict');Object.assign(saved,result,{state:result.delivery==='delivered'?'answered':'claimed'});
   dqCheck(await fbPut(env,path,snap.data,snap.etag),503,'delivery_receipt_uncertain');return send({job:view(saved)});
  }
  return send({job:view(j)});
 }catch(e){return send({error:e.dqStatus?e.message:'smoke_unavailable_check_state'},e.dqStatus||503);}
}
