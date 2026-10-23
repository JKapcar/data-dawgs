// Synthetic tests for addressed Pack seats (work/discord-pack.js). Fake Discord, fake RTDB
// with ETag CAS and RTDB's empty-map omission, a controllable clock, real Ed25519 signatures
// and the real site-session verifier. No network, model, credential or production store.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{webcrypto}=require('node:crypto');
const APP='12345678901234567',GUILD='23456789012345678',CHANNEL='34567890123456789',KAP='45678901234567890',JEFF='45678901234567891';
const SESSION='Bearer session.'+'s'.repeat(43);
// RTDB drops empty maps/arrays and undefined; emulate it so normalisation is exercised.
function rtdb(v){if(Array.isArray(v)){const a=v.map(rtdb).filter(x=>x!==undefined);return a.length?a:undefined;}if(v&&typeof v==='object'){const o={};for(const [k,x] of Object.entries(v)){const y=rtdb(x);if(y!==undefined&&y!==null)o[k]=y;}return Object.keys(o).length?o:undefined;}return v===null?undefined:v;}
async function fixture(){
 const pair=await webcrypto.subtle.generateKey('Ed25519',true,['sign','verify']),pub=Buffer.from(await webcrypto.subtle.exportKey('raw',pair.publicKey)).toString('hex');
 const env={DISCORD_INBOUND_ENABLED:'true',DISCORD_APPLICATION_PUBLIC_KEY:pub,DISCORD_APPLICATION_ID:APP,DISCORD_GUILD_ID:GUILD,DISCORD_CHANNEL_ID:CHANNEL,FB_SECRET:'mock',DISCORD_BOT_TOKEN:'fake-test-only',DISCORD_USER_LINKS:'[]',
  DISCORD_PACK_ENABLED:'true',DISCORD_PACK_DELIVERY_ENABLED:'true',DISCORD_PACK_SEATS:JSON.stringify({claude:{key_label:'pack-claude'},gemini:{key_label:'pack-gemini'}}),RESEARCH_OWNER_UID:'u_owner'};
 let now=Date.UTC(2026,9,22,12,0,0),seq=70000000000000000n;
 class FakeDate extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
 const db={},rev={},faults=[],calls=[],patches=[],threads={},byNonce={},messages={},commands=[];let writes=0,failPut=null,sessionUid='u_owner';
 const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'Content-Type':'application/json'}});
 const take=kind=>{const i=faults.findIndex(f=>f[0]===kind);return i<0?null:faults.splice(i,1)[0][1];};
 const id=()=>String(seq++);
 const ctx={Headers,TextEncoder,TextDecoder,Request,Response,URL,AbortSignal,structuredClone,btoa,console:{warn(){},log(){}},crypto:webcrypto,Date:FakeDate,
  readSession:async(e,t)=>t==='session.'+'s'.repeat(43)?{u:sessionUid}:null,sessionAuth:async()=>({uid:sessionUid}),POUND_SCHEMA:{authentication:{rejected_headers:['X-Dawg-Session','X-Dawg-Key']}},poundCheck:(ok,status,message)=>{if(!ok)throw Error(message);},
  fbGet:async(e,path)=>({data:structuredClone(db[path]??null),etag:String(rev[path]??0)}),
  fbPut:async(e,path,value,etag)=>{if(failPut&&failPut(value))throw Error('synthetic store outage');if(etag!==String(rev[path]??0))return false;db[path]=rtdb(JSON.parse(JSON.stringify(value)));rev[path]=(rev[path]??0)+1;writes++;return true;},
  fetch:async(url,options={})=>{
   const method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({method,url,body,headers:options.headers});
   if(url.includes('/webhooks/')){patches.push({url,body});return new Response(null,{status:200});}
   if(url.endsWith('/commands')){if(method==='GET')return json(commands);const f=take('command');if(f==='timeout')throw Error('timeout');const c={id:id(),...body,application_id:APP,guild_id:GUILD};commands.push(c);return json(c);}
   if(/\/guilds\/\d+\/threads\/active$/.test(url))return json({threads:Object.values(threads),members:[]});
   let m=url.match(/\/channels\/(\d+)$/);
   if(m&&method==='GET'){if(m[1]===CHANNEL)return json({id:CHANNEL,guild_id:GUILD,type:0});return threads[m[1]]?json(threads[m[1]]):json({message:'Unknown Channel'},404);}
   m=url.match(/\/channels\/(\d+)\/threads$/);
   if(m){const f=take('thread');if(f==='timeout')throw Error('timeout');if(f==='403')return json({message:'Missing Permissions'},403);if(f==='500')return json({message:'server'},500);
    const t={id:id(),guild_id:GUILD,parent_id:m[1],type:body.type,name:body.name,owner_id:APP,message_count:0,total_message_sent:0,thread_metadata:{locked:false,archived:false,auto_archive_duration:body.auto_archive_duration}};threads[t.id]=t;
    if(f==='lost')throw Error('timeout after create');return json(t);}
   m=url.match(/\/channels\/(\d+)\/messages$/);
   if(m){assert.ok(threads[m[1]],'messages only go to threads');const f=take('message');if(f==='timeout')throw Error('timeout');if(f==='403')return json({message:'Missing Permissions'},403);
    if(body.enforce_nonce&&byNonce[m[1]+'|'+body.nonce])return json(byNonce[m[1]+'|'+body.nonce]);
    const msg={id:id(),channel_id:m[1],content:body.content};messages[msg.id]={...msg,body};byNonce[m[1]+'|'+body.nonce]=msg;threads[m[1]].message_count++;threads[m[1]].total_message_sent++;
    if(f==='lost')throw Error('timeout after create');return json(msg);}
   throw Error('unexpected fetch '+method+' '+url);
  }};
 const worker=fs.readFileSync('dawg-bot-worker.js','utf8');vm.createContext(ctx);
 vm.runInContext(worker.slice(worker.indexOf('async function poundIdentity('),worker.indexOf('function poundEmpty(')),ctx);
 vm.runInContext(['work/discord-bridge.js','work/discord-inbound.js','work/discord-owner-smoke.js','work/discord-pack.js'].map(f=>fs.readFileSync(f,'utf8')).join('\n'),ctx);
 const callers={owner:{kind:'pack_seat',uid:'u_owner',keyLabel:'pack-claude',name:'Kap'},ownerGemini:{kind:'pack_seat',uid:'u_owner',keyLabel:'pack-gemini',name:'Kap'},ownerMuse:{kind:'pack_seat',uid:'u_owner',keyLabel:'pack-muse',name:'Kap'},ownerPrimary:{kind:'user',uid:'u_owner',keyLabel:'primary',name:'Kap'},ownerFullKey:{kind:'user',uid:'u_owner',keyLabel:'pack-claude',name:'Kap'},jeff:{kind:'pack_seat',uid:'u_jeff',keyLabel:'pack-claude',name:'Jeff'},shared:{kind:'shared'}};
 async function slash({to='claude',question='What is the plan?',channel=CHANNEL,user=KAP,interaction=id(),options,execution,patch={}}={}){
  const opts=options??[{name:'question',type:3,value:question},...(to?[{name:'to',type:3,value:to}]:[])];
  const event={id:interaction,application_id:APP,type:2,guild_id:GUILD,channel_id:channel,token:'interaction-token-'+'t'.repeat(40),member:{nick:user===KAP?'Kap':'Jeff',user:{id:user,username:user===KAP?'kap':'jeff'}},data:{type:1,name:'pack',options:opts},...patch};
  const raw=JSON.stringify(event),stamp=String(Math.floor(now/1000)),sig=Buffer.from(await webcrypto.subtle.sign('Ed25519',pair.privateKey,new TextEncoder().encode(stamp+raw))).toString('hex');
  const r=await ctx.handleDiscordAsk(new Request('https://worker/discord/interactions',{method:'POST',headers:{'X-Signature-Timestamp':stamp,'X-Signature-Ed25519':sig},body:raw}),env,execution);
  const out=await r.json();return {status:r.status,body:out,id:interaction,text:out?.data?.content||''};
 }
 async function tool(caller,name,args={}){try{return {ok:true,body:await ctx.dpMcpRun(name,args,env,callers[caller]??caller,async()=>callers[caller]??caller)};}catch(e){return {ok:false,error:e.message,status:e.dqStatus};}}
 async function owner(body,headers={}){const r=await ctx.handleDiscordPackOwner(new Request('https://worker/discord/owner-pack',{method:body?'POST':'GET',headers:{Authorization:SESSION,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),env);return {status:r.status,body:await r.json()};}
 async function link(user=KAP){const r=await slash({user});const code=r.text.match(/#link=([A-Za-z0-9_-]{32})/)?.[1];assert.ok(code,'link code issued: '+r.text);const c=await owner({action:'link_confirm',code});assert.equal(c.status,200,JSON.stringify(c.body));return code;}
 async function bind(caller='owner',args={session_ref:'claude.ai session (synthetic)',poll_minutes:10}){const r=await tool(caller,'dd_pack_bind',args);assert.ok(r.ok,r.error);return r.body.lease;}
 async function ready(){await link();return bind();}
 const store=()=>db['/discord_pack_v1'];
 return {ctx,env,slash,tool,owner,link,bind,ready,store,faults,calls,patches,threads,messages,commands,callers,
  advance(ms){now+=ms;},get now(){return now;},set failPut(f){failPut=f;},set sessionUid(u){sessionUid=u;},get writes(){return writes;},
  discordCalls:()=>calls.filter(c=>!c.url.includes('/webhooks/')),created:()=>({threads:Object.keys(threads).length,messages:Object.keys(messages).length})};
}
const plain=x=>JSON.parse(JSON.stringify(x));
const reply=(f,lease,jobId,text='Synthetic reply.',extra={})=>f.tool('owner','dd_pack_answer',{lease,id:jobId,text,...extra});
async function claimed(f,lease,opts){const q=await f.slash(opts);assert.match(q.text,/^Queued/);const c=await f.tool('owner','dd_pack_claim',{lease,id:q.id});assert.ok(c.ok,c.error);return q.id;}

test('off by default: no admission, no seat tools, no writes',async()=>{
 const f=await fixture();f.env.DISCORD_PACK_ENABLED=undefined;
 const r=await f.slash();assert.equal(r.body.type,4);assert.equal(r.body.data.flags,64);assert.match(r.text,/turned off/);
 assert.deepEqual(plain(f.ctx.dpMcpTools(f.env,f.callers.owner)),[]);assert.equal((await f.tool('owner','dd_pack_bind')).status,403);assert.equal(f.writes,0);
});
test('authorization: only the configured owner key assigned to a seat sees or runs seat tools',async()=>{
 const f=await fixture();
 assert.deepEqual(plain(f.ctx.dpMcpTools(f.env,f.callers.owner).map(t=>t.name)),['dd_pack_bind','dd_pack_poll','dd_pack_read','dd_pack_claim','dd_pack_answer','dd_pack_release']);
 assert.match(f.ctx.dpMcpTools(f.env,f.callers.ownerGemini)[0].title,/Gemini/);
 for(const c of ['jeff','shared','ownerMuse','ownerPrimary','ownerFullKey']){assert.deepEqual(plain(f.ctx.dpMcpTools(f.env,f.callers[c])),[]);assert.equal((await f.tool(c,'dd_pack_bind')).status,403);}
 f.env.DISCORD_PACK_SEATS=JSON.stringify({claude:{key_label:'pack-claude'},gemini:{key_label:'pack-claude'}});assert.deepEqual(plain(f.ctx.dpMcpTools(f.env,f.callers.owner)),[],'one key cannot serve two seats');
 for(const label of ['primary','Primary','Gemini','pack-','pack-UPPER','pack-'+'x'.repeat(20)]){f.env.DISCORD_PACK_SEATS=JSON.stringify({claude:{key_label:label}});assert.deepEqual(plain(f.ctx.dpSeatConfig(f.env)),{},label+' must never serve a seat');}
 f.env.DISCORD_PACK_SEATS='not json';assert.deepEqual(plain(f.ctx.dpMcpTools(f.env,f.callers.owner)),[]);
 const g=await fixture();await g.bind();const seat={kind:'pack_seat',uid:'u_owner',keyLabel:'pack-claude'};
 const r=await g.ctx.dpMcpRun('dd_pack_bind',{},g.env,seat,async()=>null).catch(e=>e);assert.equal(r.message,'connector_identity_changed');
 assert.equal((await g.tool('owner','dd_pack_bind',{surprise:1})).error,'invalid_arguments');
});
test('linking: ephemeral one-time code, owner site session confirms, nothing queued before',async()=>{
 const f=await fixture();const r=await f.slash();assert.match(r.text,/not linked/);assert.equal(r.body.data.flags,64);assert.equal(Object.keys(f.store().jobs??{}).length,0);
 const code=r.text.match(/#link=([A-Za-z0-9_-]{32})/)[1];
 assert.equal((await f.owner({action:'link_confirm',code},{Origin:'https://evil.test'})).status,403);
 f.sessionUid='u_other';assert.equal((await f.owner({action:'link_confirm',code})).status,403);f.sessionUid='u_owner';
 assert.equal((await f.owner({action:'link_confirm',code},{Authorization:'Bearer u_owner-connector-key'})).status,401);
 const p=await f.owner({action:'link_preview',code});assert.equal(p.body.discord_user_id,KAP);assert.equal(p.body.name,'Kap');
 assert.equal((await f.owner({action:'link_confirm',code})).body.linked,KAP);assert.equal((await f.owner({action:'link_confirm',code})).status,404,'single use');
 const late=await f.slash({user:JEFF});const c2=late.text.match(/#link=([A-Za-z0-9_-]{32})/)[1];f.advance(11*60e3);assert.equal((await f.owner({action:'link_confirm',code:c2})).status,404,'expired');
 assert.ok(!JSON.stringify(f.store()).includes(code)&&!JSON.stringify(f.store()).includes(c2),'only hashes of link codes are stored');
});
test('addressing: unconfigured and unbound seats are refused truthfully; bound seats queue',async()=>{
 const f=await fixture();await f.link();
 let r=await f.slash({to:'grok'});assert.match(r.text,/Grok has no supported incoming connection configured/);
 r=await f.slash({to:'claude'});assert.match(r.text,/no session is bound/);
 r=await f.slash({to:null});assert.match(r.text,/Choose who to ask/);
 assert.equal(Object.keys(f.store().jobs??{}).length,0);
 const lease=await f.bind();r=await f.slash();assert.match(r.text,/^Queued: request \d+ for Claude is queued; nothing has run yet/);assert.match(r.text,/has not passed an end-to-end test yet/);assert.match(r.text,/model identity is not verified/);
 const job=f.store().jobs[r.id];assert.equal(job.seat,'claude');assert.equal(job.execution,'not_started');assert.equal(job.question_trust,'untrusted_discord_user_text');
 f.advance(27*3600e3);r=await f.slash();assert.match(r.text,/no session is bound/,'lease idles out');
 assert.equal((await f.tool('owner','dd_pack_poll',{lease})).error,'lease_expired_rebind');
});
test('end-to-end: claim and answer create one labelled thread reply with a verified receipt',async()=>{
 const f=await fixture();const lease=await f.ready();const q=await f.slash({question:'SECRET-QUESTION-TEXT'});
 const poll=(await f.tool('owner','dd_pack_poll',{lease})).body;assert.equal(poll.jobs.length,1);assert.equal(poll.jobs[0].question,'SECRET-QUESTION-TEXT');
 assert.equal((await reply(f,lease,q.id)).error,'claim_required');
 assert.ok((await f.tool('owner','dd_pack_claim',{lease,id:q.id})).ok);
 const a=(await reply(f,lease,q.id,'Here is the plan @everyone')).body;assert.equal(a.job.delivery,'delivered');assert.equal(a.job.state,'answered');
 assert.match(a.job.receipt.url,new RegExp('^https://discord.com/channels/'+GUILD+'/\\d+/\\d+$'));assert.equal(a.job.receipt.evidence,'discord_api_response');
 assert.deepEqual(f.created(),{threads:1,messages:1});const t=Object.values(f.threads)[0];assert.equal(t.name,'Claude · '+q.id);assert.equal(t.parent_id,CHANNEL);assert.equal(t.thread_metadata.auto_archive_duration,10080);
 const m=Object.values(f.messages)[0];assert.match(m.content,/^\[Claude seat · request \d+ · binding 1 · key "pack-claude" server-verified · model unverified\]\nHere is the plan @everyone$/);
 assert.deepEqual(m.body.allowed_mentions,{parse:[],users:[],roles:[],replied_user:false});assert.equal(m.body.flags,4);assert.equal(m.body.enforce_nonce,true);assert.equal(m.body.nonce,'p'+q.id+'a1');
 assert.ok(!m.content.includes('SECRET-QUESTION-TEXT'),'question is never copied into Discord');
 assert.equal(f.store().seats.claude.verified.request_id,q.id);
 const replay=await f.slash({interaction:q.id,question:'SECRET-QUESTION-TEXT'});assert.match(replay.text,/Already received.*answered.*Delivered: https:\/\/discord.com/);
});
test('duplicate interactions: concurrent replays store one job; altered payload conflicts',async()=>{
 const f=await fixture();await f.ready();const before=f.writes;const interaction='71111111111111111';
 const rs=await Promise.all([f.slash({interaction}),f.slash({interaction}),f.slash({interaction})]);
 assert.equal(rs.filter(r=>/^Queued/.test(r.text)).length,1);assert.equal(rs.filter(r=>/^Already received/.test(r.text)).length,2);assert.equal(f.writes-before,1);
 assert.match((await f.slash({interaction,question:'changed'})).text,/already used with different content/);
});
test('thread continuity: /pack inside the thread routes to the same seat, with history, into the same thread',async()=>{
 const f=await fixture();const lease=await f.ready();const first=await claimed(f,lease,{question:'Q1'});await reply(f,lease,first,'A1');
 const thread=Object.keys(f.threads)[0];
 const q2=await f.slash({channel:thread,to:null,question:'Q2'});assert.match(q2.text,/^Queued.*for Claude.*in this thread/);
 assert.match((await f.slash({channel:thread,to:'gemini',question:'Q3'})).text,/with a different Pack member/);
 const p=(await f.tool('owner','dd_pack_poll',{lease})).body.jobs.find(j=>j.id===q2.id);assert.equal(p.kind,'follow_up');assert.equal(p.thread_id,thread);assert.deepEqual(p.history.map(h=>[h.question,h.reply]),[['Q1','A1']]);
 await f.tool('owner','dd_pack_claim',{lease,id:q2.id});const a=(await reply(f,lease,q2.id,'A2')).body;assert.equal(a.job.receipt.thread_id,thread);
 assert.deepEqual(f.created(),{threads:1,messages:2});
 assert.match((await f.slash({channel:'99999999999999999',to:null})).text,/Use \/pack in the Pack channel/);
});
test('cross-user and cross-seat isolation',async()=>{
 const f=await fixture();const lease=await f.ready();const first=await claimed(f,lease);await reply(f,lease,first);const thread=Object.keys(f.threads)[0];
 await f.link(JEFF);const j=await f.slash({user:JEFF,channel:thread,to:null});assert.match(j.text,/Only the member who started this Pack thread/);
 const gem=await f.bind('ownerGemini');const q=await f.slash();
 assert.equal((await f.tool('ownerGemini','dd_pack_read',{lease:gem,id:q.id})).error,'request_not_found_for_this_seat');
 assert.equal((await f.tool('ownerGemini','dd_pack_claim',{lease:gem,id:q.id})).error,'request_not_found_for_this_seat');
 assert.equal((await f.tool('ownerGemini','dd_pack_poll',{lease:gem})).body.jobs.length,0);
 assert.equal((await f.tool('owner','dd_pack_poll',{lease:gem})).error,'lease_invalid','a Gemini lease is not a Claude lease');
 assert.equal((await f.tool('jeff','dd_pack_poll',{lease})).status,403);
 const status=(await f.owner()).body;assert.equal(status.links.length,2);assert.ok(!JSON.stringify(status).includes('lease_sha256'));
});
test('single consumer: rebinding supersedes the old session and returns its unsent claims',async()=>{
 const f=await fixture();const a=await f.ready();const q=await claimed(f,a);
 const b=await f.bind('owner',{session_ref:'another session'});
 assert.equal((await f.tool('owner','dd_pack_poll',{lease:a})).error,'lease_superseded_by_another_session');
 assert.equal((await reply(f,a,q)).error,'lease_superseded_by_another_session');
 const list=(await f.tool('owner','dd_pack_poll',{lease:b})).body.jobs;assert.equal(list[0].state,'queued');
 await f.tool('owner','dd_pack_claim',{lease:b,id:q});assert.equal((await reply(f,b,q)).body.job.author.epoch,2);assert.deepEqual(f.created(),{threads:1,messages:1});
});
test('expired claims: late answers are refused, re-claim and renewal work',async()=>{
 const f=await fixture();const lease=await f.ready();const q=await claimed(f,lease);
 f.advance(19*60e3);const renew=(await f.tool('owner','dd_pack_claim',{lease,id:q})).body;assert.equal(renew.renewed,true);
 f.advance(21*60e3);assert.equal((await reply(f,lease,q)).error,'claim_expired_claim_again');assert.equal(f.created().threads,0);
 assert.equal((await f.tool('owner','dd_pack_poll',{lease})).body.jobs[0].claim.expired,true);
 assert.ok((await f.tool('owner','dd_pack_claim',{lease,id:q})).ok);assert.equal((await reply(f,lease,q)).body.job.delivery,'delivered');
 const r=await claimed(f,lease);assert.equal((await f.tool('owner','dd_pack_release',{lease,id:r})).body.job.state,'queued');
});
test('reconnects and replays: identical replay never resends; changed text conflicts',async()=>{
 const f=await fixture();const lease=await f.ready();const q=await claimed(f,lease);await reply(f,lease,q,'Final');const n=f.discordCalls().length;
 const again=(await reply(f,lease,q,'Final')).body;assert.equal(again.replayed,true);assert.equal(f.discordCalls().length,n,'no network on replay');
 assert.equal((await reply(f,lease,q,'Different')).error,'reply_conflict');
 assert.equal((await f.tool('owner','dd_pack_read',{lease,id:q})).body.job.receipt.message_id,Object.keys(f.messages)[0]);
});
test('failed execution posts a labelled could-not-complete notice and does not verify the seat',async()=>{
 const f=await fixture();const lease=await f.ready();const q=await claimed(f,lease);
 const r=(await reply(f,lease,q,'Could not reach the data I needed.',{outcome:'failed'})).body;assert.equal(r.job.state,'failed');
 assert.match(Object.values(f.messages)[0].content,/^\[Claude seat could not complete request/);assert.equal(f.store().seats.claude.verified,undefined);
 assert.match((await f.slash({interaction:q,question:'What is the plan?'})).text,/reported as not completed/);
});
test('uncertain message that landed: replay inside the nonce window resolves without a duplicate',async()=>{
 const f=await fixture();const lease=await f.ready();const q=await claimed(f,lease);f.faults.push(['message','lost']);
 const first=(await reply(f,lease,q)).body.job;assert.equal(first.delivery,'uncertain');assert.equal(first.delivery_stage,'message');assert.match(first.next,/nonce/);
 f.advance(30e3);const second=(await reply(f,lease,q)).body.job;assert.equal(second.delivery,'delivered');assert.deepEqual(f.created(),{threads:1,messages:1});
 const posts=f.discordCalls().filter(c=>c.url.endsWith('/messages'));assert.equal(posts.length,2);assert.equal(posts[0].body.nonce,posts[1].body.nonce);
});
test('uncertain follow-up outside the nonce window waits for the owner; owner resolution is recorded',async()=>{
 const f=await fixture();const lease=await f.ready();const first=await claimed(f,lease);await reply(f,lease,first);const thread=Object.keys(f.threads)[0];
 const q=await f.slash({channel:thread,to:null});await f.tool('owner','dd_pack_claim',{lease,id:q.id});f.faults.push(['message','timeout']);
 assert.equal((await reply(f,lease,q.id)).body.job.delivery,'uncertain');
 assert.equal((await f.owner({action:'resolve',id:q.id,observed:'absent'})).body.error,'delivery_may_still_be_in_flight_wait_two_minutes','no owner resolution while a send may be in flight');
 f.advance(5*60e3);const n=f.discordCalls().length;
 const held=(await reply(f,lease,q.id)).body;assert.match(held.notice,/Not resent: outside_nonce_window/);assert.equal(f.discordCalls().length,n,'no send outside the window');
 const absent=(await f.owner({action:'resolve',id:q.id,observed:'absent'})).body;assert.deepEqual([absent.state,absent.attempt],['queued',2]);
 await f.tool('owner','dd_pack_claim',{lease,id:q.id});const done=(await reply(f,lease,q.id,'Retry after owner check')).body.job;assert.equal(done.delivery,'delivered');
 assert.equal(Object.values(f.messages).at(-1).body.nonce,'p'+q.id+'a2');
 const q3=await f.slash({channel:thread,to:null,question:'third'});await f.tool('owner','dd_pack_claim',{lease,id:q3.id});f.faults.push(['message','lost']);await reply(f,lease,q3.id);f.advance(5*60e3);
 const present=(await f.owner({action:'resolve',id:q3.id,observed:'present'})).body;assert.equal(present.delivery,'delivered');
 assert.equal((await f.tool('owner','dd_pack_read',{lease,id:q3.id})).body.job.receipt.evidence,'owner_observed_in_discord');
});
test('uncertain new-thread message outside the window resends only when Discord shows the thread empty',async()=>{
 const f=await fixture();const lease=await f.ready();const q=await claimed(f,lease);f.faults.push(['message','timeout']);
 await reply(f,lease,q);f.advance(5*60e3);assert.equal((await reply(f,lease,q)).body.job.delivery,'delivered');assert.deepEqual(f.created(),{threads:1,messages:1});
 const g=await fixture();const l2=await g.ready();const q2=await claimed(g,l2);g.faults.push(['message','lost']);await reply(g,l2,q2);g.advance(5*60e3);
 assert.match((await reply(g,l2,q2)).body.notice,/outside_nonce_window/);assert.deepEqual(g.created(),{threads:1,messages:1});
});
test('lost thread creation: wait, then adopt the existing empty thread; never a second thread',async()=>{
 const f=await fixture();const lease=await f.ready();const q=await claimed(f,lease);f.faults.push(['thread','lost']);
 const first=(await reply(f,lease,q)).body.job;assert.deepEqual([first.delivery,first.delivery_stage],['uncertain','thread']);
 const n=f.discordCalls().length;assert.match((await reply(f,lease,q)).body.notice,/less than 20 seconds old/);assert.equal(f.discordCalls().length,n);
 f.advance(61e3);const done=(await reply(f,lease,q)).body.job;assert.equal(done.delivery,'delivered');assert.deepEqual(f.created(),{threads:1,messages:1});
 const g=await fixture();const l2=await g.ready();const q2=await claimed(g,l2);g.faults.push(['thread','timeout']);await reply(g,l2,q2);g.advance(61e3);
 assert.match((await reply(g,l2,q2)).body.notice,/thread_absence_unproven/);assert.deepEqual(g.created(),{threads:0,messages:0},'active-thread absence cannot authorize a second create');
 const h=await fixture();const l3=await h.ready();const q3=await claimed(h,l3);h.faults.push(['thread','lost']);await reply(h,l3,q3);Object.values(h.threads)[0].message_count=1;Object.values(h.threads)[0].total_message_sent=1;h.advance(120e3);
 const held=(await reply(h,l3,q3)).body;assert.match(held.notice,/thread_has_messages/);assert.equal(Object.keys(h.messages).length,0);assert.equal(held.job.thread_id,Object.keys(h.threads)[0]);
});
test('Discord rejections are certain non-sends: the claim stays and a later answer reuses the thread',async()=>{
 const f=await fixture();const lease=await f.ready();const q=await claimed(f,lease);f.faults.push(['message','403']);
 const r=(await reply(f,lease,q)).body.job;assert.equal(r.delivery,'not_sent');assert.equal(r.last_error,'message_create_403');assert.equal(r.state,'claimed');
 assert.equal((await reply(f,lease,q,'Second try')).body.job.delivery,'delivered');assert.deepEqual(f.created(),{threads:1,messages:1});
 const g=await fixture();const l2=await g.ready();const q2=await claimed(g,l2);g.faults.push(['thread','403']);assert.equal((await reply(g,l2,q2)).body.job.last_error,'thread_create_403');assert.equal(g.created().threads,0);
 g.faults.push(['thread','500']);assert.equal((await reply(g,l2,q2)).body.job.delivery,'uncertain','5xx stays uncertain');
});
test('receipt persistence failure after Discord accepted: nonce-covered replay records it, no duplicate',async()=>{
 const f=await fixture();const lease=await f.ready();const q=await claimed(f,lease);f.failPut=v=>Object.values(v.jobs||{}).some(j=>j.delivery==='delivered');
 const r=(await reply(f,lease,q)).body;assert.equal(r.receipt_persisted,false);assert.equal(r.job.delivery,'delivered_but_receipt_not_saved');
 f.failPut=null;f.advance(25e3);assert.equal((await reply(f,lease,q)).body.job.delivery,'delivered');assert.deepEqual(f.created(),{threads:1,messages:1});
});
test('concurrent answers create exactly one thread and one message',async()=>{
 const f=await fixture();const lease=await f.ready();const q=await claimed(f,lease);
 const rs=await Promise.all([reply(f,lease,q),reply(f,lease,q),reply(f,lease,q)]);assert.ok(rs.every(r=>r.ok),JSON.stringify(rs));assert.deepEqual(f.created(),{threads:1,messages:1});
});
test('rate limits, reply rules and the delivery flag fail closed without side effects',async()=>{
 const f=await fixture();const lease=await f.ready();
 for(let n=0;n<20;n++)assert.match((await f.slash()).text,/^Queued/);assert.match((await f.slash()).text,/Too many Pack requests/);
 const q=Object.keys(f.store().jobs)[0];await f.tool('owner','dd_pack_claim',{lease,id:q});
 for(const text of ['see https://evil.test','<@123> hi','x'.repeat(1801),'bad\u0007char'])assert.ok(!(await reply(f,lease,q,text)).ok,text);
 f.env.DISCORD_PACK_DELIVERY_ENABLED='false';assert.equal((await reply(f,lease,q)).error,'pack_delivery_disabled');assert.equal(f.discordCalls().length,0);
});
test('command registration is reserved, single-shot and settled only by observation',async()=>{
 const f=await fixture();assert.equal((await f.owner({action:'register',guild_id:'999'})).status,400);
 f.faults.push(['command','timeout']);assert.equal((await f.owner({action:'register'})).status,502);
 const again=(await f.owner({action:'register'})).body;assert.equal(again.registration,'uncertain');assert.equal(f.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/commands')).length,1,'no blind re-registration');
 assert.equal((await f.owner({action:'inspect_command'})).body.observed,'absent');
 const ok=(await f.owner({action:'register'})).body;assert.equal(ok.registration,'registered');
 const sent=f.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/commands')).at(-1);assert.equal(sent.url,'https://discord.com/api/v10/applications/'+APP+'/guilds/'+GUILD+'/commands');
 assert.equal(sent.body.name,'pack');assert.equal(sent.body.default_member_permissions,'0');assert.deepEqual(sent.body.options.map(o=>[o.name,o.required]),[['question',true],['to',false]]);
 assert.deepEqual(sent.body.options[1].choices.map(c=>c.value),['claude','gemini','grok','muse','dot']);
 assert.equal((await f.owner({action:'register'})).body.replayed,true);assert.equal((await f.owner({action:'inspect_command'})).body.observed,'registered');
 assert.ok(!JSON.stringify(await f.owner()).includes('fake-test-only'),'bot secret never echoed');
});
test('production path defers ephemerally, edits the original once, and never stores the interaction token',async()=>{
 const f=await fixture();await f.ready();const pending=[];const r=await f.slash({execution:{waitUntil:p=>pending.push(p)}});
 assert.deepEqual(r.body,{type:5,data:{flags:64}});await Promise.all(pending);
 assert.equal(f.patches.length,1);assert.match(f.patches[0].url,new RegExp('/webhooks/'+APP+'/interaction-token-t+/messages/@original$'));assert.match(f.patches[0].body.content,/^Queued: request/);assert.deepEqual(f.patches[0].body.allowed_mentions,{parse:[]});
 assert.ok(!JSON.stringify(f.store()).includes('interaction-token'),'token never persisted');
 const bad=await f.slash({to:'nobody',execution:{waitUntil:p=>pending.push(p)}});assert.equal(bad.body.type,4);assert.match(bad.text,/Unknown Pack member/);
});
test('owner stop is a hard stop: lease ends, claims return, binding refused until allowed',async()=>{
 const f=await fixture();const lease=await f.ready();const q=await claimed(f,lease);
 assert.deepEqual(plain((await f.owner({action:'stop',seat:'claude'})).body.released),[q]);
 assert.equal((await f.tool('owner','dd_pack_poll',{lease})).error,'seat_stopped_by_owner');
 assert.equal((await f.tool('owner','dd_pack_bind')).error,'seat_stopped_by_owner','a session cannot quietly rebind after an owner stop');
 assert.match((await f.slash()).text,/stopped by the site owner/);assert.equal((await reply(f,lease,q)).error,'seat_stopped_by_owner');
 const s=(await f.owner()).body.seats.find(x=>x.seat==='claude');assert.ok(s.stopped_at);assert.equal(s.binding,null);
 assert.equal((await f.owner({action:'allow',seat:'claude'})).body.allowed,true);
 assert.equal((await f.tool('owner','dd_pack_poll',{lease})).error,'lease_ended_by_owner_stop','the old lease stays dead after allow');
 const fresh=await f.bind();assert.equal((await f.tool('owner','dd_pack_poll',{lease:fresh})).body.jobs[0].id,q);
 assert.equal((await f.owner({action:'stop',seat:'grok'})).body.stopped,true,'an unbound seat can be stopped pre-emptively');
});
test('store normalisation tolerates RTDB omissions and fails closed when malformed',()=>{
 return fixture().then(f=>{const n=f.ctx.dpStore;assert.deepEqual(plain(Object.keys(n(null))),['version','seats','jobs','threads','links','challenges','windows']);
  const s=n({version:1,threads:{'1':{root_id:'1'}},seats:{claude:{epoch:1}}});assert.deepEqual(plain(s.threads['1'].turns),[]);assert.deepEqual(plain(s.seats.claude.history),[]);
  for(const bad of [false,[],{},{version:2},{version:1,jobs:[]},{version:1,seats:'x'}])assert.throws(()=>n(bad),/pack_store_invalid/);});
});
test('seat-key dispatcher serves only its own dd_pack_* tools',async()=>{
 const f=await fixture();const call=(caller,method,params)=>f.ctx.dpSeatDispatch({jsonrpc:'2.0',id:7,method,params},f.env,f.callers[caller],async()=>f.callers[caller]);
 assert.match((await call('owner','initialize',{})).result.instructions,/no league, private workspace or research access/);
 assert.deepEqual(plain((await call('owner','tools/list',{})).result.tools.map(t=>t.name)),['dd_pack_bind','dd_pack_poll','dd_pack_read','dd_pack_claim','dd_pack_answer','dd_pack_release']);
 for(const name of ['dd_owner_pound_read','dd_whoami','dd_submit_bozo_leg','dd_pack_nope'])assert.equal((await call('owner','tools/call',{name,arguments:{}})).error.code,-32602,name);
 assert.deepEqual(plain((await call('ownerMuse','tools/list',{})).result.tools),[],'an unassigned pack- key gets nothing, not the full catalog');
 assert.equal((await call('owner','resources/list',{})).error.code,-32601);
 const bound=JSON.parse((await call('owner','tools/call',{name:'dd_pack_bind',arguments:{}})).result.content[0].text);assert.equal(bound.seat,'claude');
});
test('legacy /ask is untouched and the Pack module is assembled exactly once with its hooks',()=>{
 const worker=fs.readFileSync('dawg-bot-worker.js','utf8'),source=fs.readFileSync('work/discord-pack.js','utf8').trim();
 assert.equal(worker.split(source).length,2);assert.equal(worker.split('handleDiscordPackOwner(request, env); // DD-DISCORD-QUEUE-ROUTE').length,2);
 const block=worker.slice(worker.indexOf('/* ===== DD-MCP-BLOCK START'));assert.equal((block.match(/dpMcpRun\(/g)||[]).length,0);assert.equal((block.match(/dpSeatDispatch\(/g)||[]).length,1);assert.ok(!/fbPut\(/.test(block));
 assert.ok(worker.indexOf('async function dpMcpRun(')<worker.indexOf('/* ===== DD-MCP-BLOCK START'));
});

 test('archived thread missing from active listing cannot authorize duplicate creation',async()=>{
 const f=await fixture(),lease=await f.ready(),id=await claimed(f,lease);f.faults.push(['thread','lost']);await reply(f,lease,id);
 const thread=Object.values(f.threads)[0];delete f.threads[thread.id];f.advance(61e3);
 const before=f.discordCalls().filter(c=>c.method==='POST').length;const r=await reply(f,lease,id);assert.match(r.body.notice,/thread_absence_unproven/);assert.equal(f.discordCalls().filter(c=>c.method==='POST').length,before);
 });
 test('receipts explicitly distinguish polling from wake and verification is binding-specific',async()=>{
 const f=await fixture(),lease=await f.ready(),id=await claimed(f,lease);const r=await reply(f,lease,id);
 assert.equal(r.body.job.execution,'claimant_reported');assert.deepEqual(plain(r.body.job.wake),{performed:false,mechanism:'session_polling',execution_verified:false});
 assert.ok(f.store().seats.claude.verified);await f.bind();assert.equal(f.store().seats.claude.verified,undefined);
 });

test('late receipt from an old binding never verifies its replacement',async()=>{
 const f=await fixture(),lease=await f.ready(),id=await claimed(f,lease);
 const original=f.ctx.dpDeliver;f.ctx.dpDeliver=async(...args)=>{const result=await original(...args);await f.bind();return result;};
 const result=await reply(f,lease,id);assert.equal(result.body.job.delivery,'delivered');assert.equal(f.store().seats.claude.epoch,2);assert.equal(f.store().seats.claude.verified,undefined);
});
test('revocation at mutation reauthorization prevents binding and sends',async()=>{
 const f=await fixture();await assert.rejects(f.ctx.dpMcpRun('dd_pack_bind',{},f.env,f.callers.owner,async()=>null),/connector_identity_changed/);
 const lease=await f.ready(),id=await claimed(f,lease);await assert.rejects(f.ctx.dpMcpRun('dd_pack_answer',{lease,id,text:'Synthetic.'},f.env,f.callers.owner,async()=>null),/connector_identity_changed/);assert.deepEqual(f.created(),{threads:0,messages:0});
});

test('owner can inspect command while Pack is off without enabling registration',async()=>{
 const f=await fixture();f.env.DISCORD_PACK_ENABLED='false';const inspected=await f.owner({action:'inspect_command'});assert.equal(inspected.status,200);assert.equal(inspected.body.observed,'absent');assert.ok(f.discordCalls().every(c=>c.method==='GET'));
 const registered=await f.owner({action:'register'});assert.equal(registered.status,503);assert.equal(registered.body.error,'pack_disabled');assert.ok(f.discordCalls().every(c=>c.method==='GET'));
});
