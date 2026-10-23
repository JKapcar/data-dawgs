// Synthetic native-event lifecycle. No production credentials, callback or model.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{webcrypto,createHmac}=require('node:crypto');
const G='23456789012345678',C='34567890123456789',U='45678901234567890',ID='71111111111111111';
const SECRET='whsec_'+Buffer.alloc(32,4).toString('base64'),URL_='https://callback.example.test/events/one';
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 let now=Date.UTC(2026,9,23),version=0,state=null,revoked=false,mode='ok',during=null;
 const calls=[];class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
 const env={DISCORD_PACK_ENABLED:'true',DISCORD_PACK_EVENTS_ENABLED:'true',DISCORD_PACK_DELIVERY_ENABLED:'true',DISCORD_BOT_TOKEN:'synthetic',FB_SECRET:'synthetic',RESEARCH_OWNER_UID:'u_owner',DISCORD_GUILD_ID:G,DISCORD_CHANNEL_ID:C,DISCORD_PACK_SEATS:JSON.stringify({dot:{key_label:'pack-dot'},grok:{key_label:'pack-grok'}}),PACK_EVENT_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('base64'),PACK_EVENT_CALLBACK_ORIGINS:JSON.stringify(['https://callback.example.test'])};
 const caller={kind:'pack_seat',uid:'u_owner',keyLabel:'pack-dot',transport:'header',credentialHash:'synthetic-hash'};
 const ctx={crypto:webcrypto,Date:Clock,TextEncoder,TextDecoder,URL,Request,Response,AbortSignal,Uint8Array,atob,btoa,structuredClone,
  dqSnow:x=>typeof x==='string'&&/^\d{17,20}$/.test(x),dcHash:async s=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex'),
  fbGet:async(e,path)=>path==='/users'?{data:{u_owner:{mcpTokens:revoked?{}:{'pack-dot':{hash:'synthetic-hash'}}}}}:{data:structuredClone(state),etag:String(version)},
  fbPut:async(e,path,value,etag)=>{if(etag!==String(version))return false;state=structuredClone(value);version++;return true;}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('work/discord-pack.js','utf8')+'\n'+fs.readFileSync('work/discord-pack-events.js','utf8'),ctx);
 env.PACK_EVENT_EGRESS={fetch:async req=>{const body=await req.text();calls.push({url:req.url,body,headers:Object.fromEntries(req.headers)});const data=JSON.parse(body);if(during)await during(data);
  if(mode==='timeout')throw Error('synthetic lost response');if(mode==='oversize')return new Response('x'.repeat(5000));if(mode==='bad-challenge')return Response.json({challenge:'wrong'});if(mode!=='ok')return new Response('',{status:Number(mode)});return Response.json(data.type==='verification'?{challenge:data.challenge}:{received:true});}};
 const args={owner_uid:'u_owner',seat:'dot',guild_id:G,channel_id:C,discord_user_id:U};
 const params=()=>({name:'pack.request.created',arguments:{...args},delivery:{mode:'webhook',url:URL_,secret:SECRET},cursor:null});
 const rpc=(method,p=params(),who=caller)=>ctx.dpeMethods({jsonrpc:'2.0',id:1,method,params:p},env,who,async()=>revoked?null:who);
 const link=async()=>ctx.dpTxn(env,s=>{s.links[U]={owner_uid:'u_owner',expires_at:new Date(now+86400e3).toISOString()};return {write:true};});
 const admit=async(id=ID,patch={})=>ctx.dpAdmit({id,guild_id:G,channel_id:C,member:{user:{id:U,username:'Kap'}},...patch},env,{question:'PRIVATE-QUESTION-NOT-IN-WEBHOOK',to:'dot'});
 return {ctx,env,caller,calls,args,params,rpc,link,admit,drain:()=>ctx.dpeDrain(env),state:()=>state,advance:ms=>now+=ms,set revoked(x){revoked=x;},set mode(x){mode=x;},set during(x){during=x;},get now(){return now;}};
}
test('default disabled; full owner, cross-seat and URL credentials cannot discover events',async()=>{
 const f=fixture();delete f.env.DISCORD_PACK_EVENTS_ENABLED;assert.ok((await f.rpc('events/list',{})).error);await f.drain();assert.equal(f.state(),null);assert.equal(f.calls.length,0);
 f.env.DISCORD_PACK_EVENTS_ENABLED='true';for(const who of [{...f.caller,kind:'user'},{...f.caller,uid:'u_other'},{...f.caller,keyLabel:'pack-grok'},{...f.caller,transport:'url'}])assert.ok((await f.rpc('events/list',{},who)).error);
 assert.deepEqual(plain((await f.rpc('server/discover',{})).result),{resultType:'complete',supportedVersions:['2026-07-28'],capabilities:{tools:{},events:{}}});
 assert.equal((await f.rpc('events/list',{})).result.events[0].name,'pack.request.created');assert.equal(f.ctx.dpMcpTools(f.env,f.caller).length,6);
});
test('subscription validates linked owner filters and exact callback origin; no unsafe fetch fallback',async()=>{
 const f=fixture();assert.ok((await f.rpc('events/subscribe')).error);await f.link();
 for(const url of ['http://callback.example.test/','https://127.0.0.1/','https://callback.example.test.evil/','https://user@callback.example.test/','https://callback.example.test:444/','https://callback.example.test/#x']){const p=f.params();p.delivery.url=url;assert.ok((await f.rpc('events/subscribe',p)).error,url);}
 for(const [key,value] of [['owner_uid','u_other'],['seat','grok'],['channel_id',U],['discord_user_id',C]]){const p=f.params();p.arguments[key]=value;assert.ok((await f.rpc('events/subscribe',p)).error);}
 assert.equal(f.calls.length,0);delete f.env.PACK_EVENT_EGRESS;assert.match((await f.rpc('events/subscribe')).error.message,/unconfigured/);
});
test('challenge signature matches Standard Webhooks; secrets encrypted, refresh idempotent and cache bounded',async()=>{
 const f=fixture();await f.link();const first=await f.rpc('events/subscribe');assert.ok(first.result,JSON.stringify(first));
 const c=f.calls[0],h=c.headers,expected=createHmac('sha256',Buffer.alloc(32,4)).update(h['webhook-id']+'.'+h['webhook-timestamp']+'.'+c.body).digest('base64');assert.equal(h['webhook-signature'],'v1,'+expected);
 const stored=JSON.stringify(f.state());assert.ok(!stored.includes(SECRET)&&!stored.includes(URL_));
 f.advance(240000);assert.equal((await f.rpc('events/subscribe')).result.id,first.result.id);assert.equal(f.calls.length,1);
 f.advance(120000);assert.equal((await f.rpc('events/subscribe')).result.id,first.result.id);assert.equal(f.calls.length,2,'cache expires from real verification, not refresh');
 const p=f.params();p.delivery.url+='two';assert.match((await f.rpc('events/subscribe',p)).error.message,/already_subscribed/);
});
test('wrong or oversized verification response cannot activate subscription',async()=>{
 for(const mode of ['bad-challenge','oversize','timeout','302']){const f=fixture();await f.link();f.mode=mode;const r=await f.rpc('events/subscribe');assert.equal(r.error.code,-32015);assert.equal(Object.keys(f.state().subscriptions??{}).length,0);}
});
test('persist before dispatch, idle seat admission, minimal payload, duplicate drains and interactions',async()=>{
 const f=fixture();await f.link();await f.rpc('events/subscribe');assert.match(await f.admit(),/^Queued/);assert.ok(f.state().jobs[ID].wake);assert.equal(f.state().seats.dot,undefined);
 f.during=data=>{if(!data.type)assert.equal(f.state().jobs[ID].wake.status,'sending');};
 await Promise.all([f.drain(),f.drain()]);assert.equal(f.calls.filter(x=>!JSON.parse(x.body).type).length,1);assert.equal(f.state().jobs[ID].wake.status,'accepted');
 const event=JSON.parse(f.calls.at(-1).body);assert.deepEqual(event.data,{job_id:ID});assert.ok(!f.calls.at(-1).body.includes('PRIVATE'));assert.equal(event.eventId,'pack_'+ID);
 assert.match(await f.admit(),/^Already received/);await f.drain();assert.equal(f.calls.length,2);
 const view=f.ctx.dpeView(f.state().jobs[ID],f.now);assert.equal(view.execution_verified,false);assert.equal(view.execution_status,'awaiting_claim');f.advance(21*60000);assert.equal(f.ctx.dpeView(f.state().jobs[ID],f.now).execution_status,'timed_out_no_claim');
});
test('429 retries bounded with stable IDs and fresh signatures; ambiguous errors never retried',async()=>{
 const f=fixture();await f.link();await f.rpc('events/subscribe');await f.admit();f.mode='429';
 await f.drain();assert.equal(f.state().jobs[ID].wake.status,'retry');await f.drain();assert.equal(f.calls.length,2);f.advance(60000);await f.drain();f.advance(120000);await f.drain();assert.equal(f.state().jobs[ID].wake.status,'rejected');assert.equal(f.state().jobs[ID].wake.attempts,3);
 assert.equal(new Set(f.calls.slice(1).map(c=>c.headers['webhook-id'])).size,1);assert.equal(new Set(f.calls.slice(1).map(c=>c.headers['webhook-signature'])).size,3);
 for(const mode of ['timeout','500','410','413','302']){const g=fixture();await g.link();await g.rpc('events/subscribe');await g.admit();g.mode=mode;await g.drain();g.advance(600000);await g.drain();assert.equal(g.calls.length,2,mode);assert.equal(g.state().jobs[ID].wake.status,['timeout','500'].includes(mode)?'uncertain':'rejected');}
});
test('unsubscribe, expiry, credential revocation, unlink and owner stop suppress pending dispatch',async()=>{
 for(const change of ['unsubscribe','expiry','revoke','unlink','stop','channel','guild']){const f=fixture();await f.link();await f.rpc('events/subscribe');await f.admit();
  if(change==='unsubscribe'){assert.ok((await f.rpc('events/unsubscribe')).result);assert.ok((await f.rpc('events/unsubscribe')).result);}
  if(change==='expiry')f.advance(3600001);if(change==='revoke')f.revoked=true;
  if(change==='unlink')delete f.state().links[U];if(change==='stop')f.state().seats.dot={stopped_at:'now'};
  if(change==='channel')f.env.DISCORD_CHANNEL_ID=U;if(change==='guild')f.env.DISCORD_GUILD_ID=U;
  await f.drain();assert.equal(f.calls.length,1,change);assert.equal(f.state().jobs[ID].wake.status,'cancelled',change);
 }
});
test('restart retains encrypted subscription and outbox; short TTL honored and rotation dual-signs',async()=>{
 const f=fixture();await f.link();let p=f.params();p.ttlMs=1000;let r=await f.rpc('events/subscribe',p);assert.equal(Date.parse(r.result.refreshBefore),f.now+1000);
 p=f.params();p.delivery.secret='whsec_'+Buffer.alloc(32,5).toString('base64');await f.rpc('events/subscribe',p);await f.admit();await f.drain();assert.equal(f.calls.at(-1).headers['webhook-signature'].split(' ').length,2);
 const sub=Object.values(f.state().subscriptions)[0];assert.equal((await f.ctx.dpeCrypt(f.env,sub.id,sub.sealed,true)).secret,p.delivery.secret);
 await assert.rejects(f.ctx.dpeCrypt(f.env,'different-id',sub.sealed,true));
});
test('persisted sending reservation is never retried after crash and appears uncertain',async()=>{
 const f=fixture();await f.link();await f.rpc('events/subscribe');await f.admit();Object.assign(f.state().jobs[ID].wake,{status:'sending',reserved_ms:f.now,attempts:1});f.advance(11000);await f.drain();assert.equal(f.calls.length,1);assert.equal(f.ctx.dpeView(f.state().jobs[ID],f.now).status,'uncertain');
});
test('unsubscribe/recreate gets a fresh generation and expired claims show no-reply timeout',async()=>{
 const f=fixture();await f.link();await f.rpc('events/subscribe');const old=Object.values(f.state().subscriptions)[0].revision;await f.rpc('events/unsubscribe');await f.rpc('events/subscribe');assert.notEqual(Object.values(f.state().subscriptions)[0].revision,old);
 await f.admit();f.state().jobs[ID].claim={expires_at:new Date(f.now+1000).toISOString()};f.advance(21*60000);assert.equal(f.ctx.dpeView(f.state().jobs[ID],f.now).execution_status,'timed_out_no_reply');
});
test('event answers require run reference and retain self-reported evidence separately from delivery',async()=>{
 const f=fixture();await f.link();await f.rpc('events/subscribe');await f.admit();
 const auth=async()=>f.caller;const lease=(await f.ctx.dpMcpRun('dd_pack_bind',{},f.env,f.caller,auth)).lease;
 await f.ctx.dpMcpRun('dd_pack_claim',{lease,id:ID},f.env,f.caller,auth);
 await assert.rejects(f.ctx.dpMcpRun('dd_pack_answer',{lease,id:ID,text:'pong.'},f.env,f.caller,auth),/event_run_reference_required/);
 vm.runInContext('dpDeliver=async()=>({delivered:false,certain_not_sent:true,error:"synthetic_403"})',f.ctx);
 await f.ctx.dpMcpRun('dd_pack_answer',{lease,id:ID,text:'pong.',run_ref:'failed-run'},f.env,f.caller,auth);
 assert.equal(f.state().jobs[ID].run_evidence,undefined);assert.equal(f.state().jobs[ID].prior_run_evidence.reference,'failed-run');
 // Isolate evidence plumbing from the separately tested real Discord delivery path.
 vm.runInContext('dpDeliver=async()=>({thread_id:"81111111111111111",message_id:"91111111111111111",delivered:true})',f.ctx);
 const r=await f.ctx.dpMcpRun('dd_pack_answer',{lease,id:ID,text:'pong.',run_ref:'synthetic-run-1'},f.env,f.caller,auth);
 assert.equal(r.job.delivery,'delivered');assert.equal(r.job.wake.execution_verified,false);assert.equal(r.job.wake.run_evidence.trust,'seat_claimant_reported');assert.equal(r.job.wake.run_evidence.reference,'synthetic-run-1');
 await assert.rejects(f.ctx.dpMcpRun('dd_pack_answer',{lease,id:ID,text:'pong.',run_ref:'different'},f.env,f.caller,auth),/event_run_reference_conflict/);
});
