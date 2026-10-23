// Integration through the real assembled Worker: mcpAuth → key label → Pack seat → tools/list and
// tools/call, plus the /discord/interactions and /discord/owner-pack routes. Fake RTDB and Discord.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dawg-bot-worker.js';

const DB='https://data-dawgs-draft-default-rtdb.firebaseio.com',PEPPER='pack-test-pepper';
const APP='12345678901234567',GUILD='23456789012345678',CHANNEL='34567890123456789',KAP='45678901234567890';
const hmac=async(secret,msg)=>{const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Buffer.from(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(msg))).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const USERS={u_owner:{name:'Kap',mcpToken:await hmac(PEPPER,'mcp|u_primarytoken'),mcpTokens:{Gemini:{hash:await hmac(PEPPER,'mcp|u_geminitoken'),ts:1},'pack-claude':{hash:await hmac(PEPPER,'mcp|u_packclaudetoken'),ts:2},'pack-gemini':{hash:await hmac(PEPPER,'mcp|u_packgeminitoken'),ts:3}}},u_jeff:{name:'Jeff',mcpToken:await hmac(PEPPER,'mcp|u_jefftoken'),mcpTokens:{'pack-claude':{hash:await hmac(PEPPER,'mcp|u_jeffpacktoken'),ts:4}}}};
const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']),pub=Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('hex');
const env={BOZO_PEPPER:PEPPER,FB_SECRET:'mock',RL:{async get(){return null;},async put(){},async delete(){}},RESEARCH_OWNER_UID:'u_owner',
 DISCORD_INBOUND_ENABLED:'true',DISCORD_APPLICATION_ID:APP,DISCORD_APPLICATION_PUBLIC_KEY:pub,DISCORD_GUILD_ID:GUILD,DISCORD_CHANNEL_ID:CHANNEL,DISCORD_USER_LINKS:'[]',DISCORD_BOT_TOKEN:'fake-test-only',
 DISCORD_PACK_ENABLED:'true',DISCORD_PACK_DELIVERY_ENABLED:'false',DISCORD_PACK_SEATS:JSON.stringify({claude:{key_label:'pack-claude'},gemini:{key_label:'pack-gemini'}})};
let pack=null,etag=0;const nonGet=[];
globalThis.fetch=async(input,init={})=>{
 const url=String(input instanceof Request?input.url:input),method=init.method||'GET';
 if(url.startsWith(DB+'/users.json'))return Response.json(USERS);
 if(url.startsWith(DB+'/discord_pack_v1.json')){
  if(method==='GET')return new Response(JSON.stringify(pack),{headers:{ETag:String(etag)}});
  if(method==='PUT'){nonGet.push(url.split('?')[0]);if(init.headers?.['if-match']!==String(etag))return new Response('',{status:412});pack=JSON.parse(init.body);etag++;return Response.json(pack);}
 }
 if(url.includes('/webhooks/'))return new Response(null,{status:200});
 throw new Error('TEST: unexpected fetch '+method+' '+url);
};
const rpc=(token,method,params,id=1)=>worker.fetch(new Request('https://toto.jkapcar4.workers.dev/mcp/'+token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})}),env).then(r=>r.json());
const names=async token=>(await rpc(token,'tools/list',{})).result.tools.map(t=>t.name).filter(n=>n.startsWith('dd_pack_'));
const call=async(token,name,args)=>{const r=await rpc(token,'tools/call',{name,arguments:args});return {isError:r.result.isError===true,body:r.result.content[0].text};};

const allNames=async token=>(await rpc(token,'tools/list',{})).result?.tools?.map(t=>t.name)??[];

test('native event discovery traverses real header authentication; legacy and full-owner paths stay isolated',async()=>{
 USERS.u_owner.mcpTokens['pack-dot']={hash:await hmac(PEPPER,'mcp|u_packdottoken'),ts:5};
 const saved=env.DISCORD_PACK_SEATS;env.DISCORD_PACK_SEATS=JSON.stringify({...JSON.parse(saved),dot:{key_label:'pack-dot'}});env.DISCORD_PACK_EVENTS_ENABLED='true';
 const headerRpc=async(token,method)=>{const r=await worker.fetch(new Request('https://toto.jkapcar4.workers.dev/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{}})}),env);return r.json();};
 const discover=await headerRpc('u_packdottoken','server/discover');assert.deepEqual(discover.result.supportedVersions,['2026-07-28']);
 const list=await headerRpc('u_packdottoken','events/list');assert.equal(list.result.events.length,1);assert.equal(list.result.events[0].name,'pack.request.created');assert.ok(!JSON.stringify(list).includes(USERS.u_owner.mcpTokens['pack-dot'].hash));
 assert.ok((await rpc('u_packdottoken','events/list',{})).error,'URL credential denied for events');assert.ok((await headerRpc('u_primarytoken','events/list')).error,'owner not a seat');
 assert.equal((await headerRpc('u_packdottoken','tools/list')).result.tools.length,6);
 const init=await rpc('u_packdottoken','initialize',{protocolVersion:'2025-06-18'});assert.equal(init.result.protocolVersion,'2025-06-18');
 delete USERS.u_owner.mcpTokens['pack-dot'];assert.ok((await headerRpc('u_packdottoken','events/list')).error);env.DISCORD_PACK_SEATS=saved;delete env.DISCORD_PACK_EVENTS_ENABLED;
});
test('seat keys are seat-only credentials; full-access keys never get seat tools',async()=>{
 for(const token of ['u_primarytoken','u_geminitoken','u_jefftoken']){const n=await allNames(token);assert.ok(n.includes('dd_whoami'),token+' keeps its normal catalog');assert.equal(n.filter(x=>x.startsWith('dd_pack_')).length,0,token+' gets no seat tools');}
 assert.deepEqual(await allNames('u_packclaudetoken'),['dd_pack_bind','dd_pack_poll','dd_pack_read','dd_pack_claim','dd_pack_answer','dd_pack_release']);
 const init=await rpc('u_packclaudetoken','initialize',{protocolVersion:'2025-06-18'});assert.match(init.result.instructions,/no league, private workspace or research access/);
 for(const name of ['dd_whoami','dd_owner_pound_read','dd_submit_bozo_leg','dd_league_overview']){const r=await rpc('u_packclaudetoken','tools/call',{name,arguments:{}});assert.equal(r.error?.code,-32602,name);}
 const verdict=await (await worker.fetch(new Request('https://toto.jkapcar4.workers.dev/mcp/u_packclaudetoken',{headers:{Accept:'application/json'}}),env)).json();assert.equal(verdict.kind,'pack_seat');assert.equal(verdict.tools,6);assert.match(verdict.note,/only dd_pack_\* tools/);
 env.DISCORD_PACK_ENABLED='false';assert.deepEqual(await allNames('u_packclaudetoken'),[],'disabled: nothing, still not elevated');env.DISCORD_PACK_ENABLED='true';
});
test('pack- keys stay seat-only on every connector path and whatever the owner setting says',async()=>{
 const owner=env.RESEARCH_OWNER_UID,seatOnly=async(token,opts={})=>{const path=opts.path??'/mcp/'+token,headers={'Content-Type':'application/json',...(opts.headers||{})};
  const list=await (await worker.fetch(new Request('https://toto.jkapcar4.workers.dev'+path,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}),env)).json();
  const names=(list.result?.tools||[]).map(t=>t.name);assert.ok(names.every(n=>n.startsWith('dd_pack_')),JSON.stringify(names).slice(0,120));
  const call=await (await worker.fetch(new Request('https://toto.jkapcar4.workers.dev'+path,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'dd_whoami',arguments:{}}})}),env)).json();
  assert.equal(call.error?.code,-32602,'dd_whoami refused');return names.length;};
 for(const [label,opts] of [['url full',{}],['url core',{path:'/mcp/core/u_packclaudetoken'}],['url explicit full',{path:'/mcp/full/u_packclaudetoken'}],['bearer header',{path:'/mcp',headers:{Authorization:'Bearer u_packclaudetoken'}}],['bearer header core',{path:'/mcp/core',headers:{Authorization:'Bearer u_packclaudetoken'}}],['x-api-key',{path:'/mcp',headers:{'X-Api-Key':'u_packclaudetoken'}}]])
  assert.equal(await seatOnly('u_packclaudetoken',opts),6,label);
 for(const value of [undefined,'','u_someone_else']){env.RESEARCH_OWNER_UID=value;assert.equal(await seatOnly('u_packclaudetoken'),0,'owner='+value+': no tools, never a full key');}
 env.RESEARCH_OWNER_UID=owner;assert.equal(await seatOnly('u_jeffpacktoken'),0,"another member's pack- key is seat-only too");
});
test('bind and poll run through JSON-RPC with server-verified key labels',async()=>{
 const bound=await call('u_packclaudetoken','dd_pack_bind',{session_ref:'synthetic session',poll_minutes:10});assert.equal(bound.isError,false,bound.body);
 const {lease,seat,binding}=JSON.parse(bound.body);assert.equal(seat,'claude');assert.equal(binding,1);assert.match(lease,/^dpl_[A-Za-z0-9_-]{43}$/);
 assert.equal(pack.seats.claude.key_label,'pack-claude');assert.ok(!JSON.stringify(pack).includes(lease),'only the lease hash is stored');
 const gem=JSON.parse((await call('u_packgeminitoken','dd_pack_bind',{})).body);assert.equal(gem.seat,'gemini');
 const crossed=await call('u_packgeminitoken','dd_pack_poll',{lease});assert.equal(crossed.isError,true);assert.match(crossed.body,/lease_invalid/);
 const poll=JSON.parse((await call('u_packclaudetoken','dd_pack_poll',{lease})).body);assert.deepEqual([poll.seat,poll.jobs.length],['claude',0]);
 assert.ok(nonGet.every(u=>u===DB+'/discord_pack_v1.json'),'Pack tools write only their own store');
});
test('revocation: removing the seat never widens the key; removing the key ends access',async()=>{
 const saved=env.DISCORD_PACK_SEATS;env.DISCORD_PACK_SEATS=JSON.stringify({gemini:{key_label:'pack-gemini'}});
 assert.deepEqual(await allNames('u_packclaudetoken'),[]);const r=await rpc('u_packclaudetoken','tools/call',{name:'dd_whoami',arguments:{}});assert.equal(r.error?.code,-32602);
 env.DISCORD_PACK_SEATS=saved;const key=USERS.u_owner.mcpTokens['pack-claude'];delete USERS.u_owner.mcpTokens['pack-claude'];
 const gone=await worker.fetch(new Request('https://toto.jkapcar4.workers.dev/mcp/u_packclaudetoken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}),env);assert.equal(gone.status,403);
 USERS.u_owner.mcpTokens['pack-claude']=key;
});
test('interactions route reaches the Pack admission path; owner route requires a site session',async()=>{
 const event={id:'71234567890123456',application_id:APP,type:2,guild_id:GUILD,channel_id:CHANNEL,token:'interaction-token-'+'t'.repeat(40),member:{user:{id:KAP,username:'kap'}},data:{type:1,name:'pack',options:[{name:'question',type:3,value:'hello'},{name:'to',type:3,value:'claude'}]}};
 const raw=JSON.stringify(event),stamp=String(Math.floor(Date.now()/1000)),sig=Buffer.from(await crypto.subtle.sign('Ed25519',pair.privateKey,new TextEncoder().encode(stamp+raw))).toString('hex');
 const pending=[];const r=await worker.fetch(new Request('https://toto.jkapcar4.workers.dev/discord/interactions',{method:'POST',headers:{'X-Signature-Timestamp':stamp,'X-Signature-Ed25519':sig},body:raw}),env,{waitUntil:p=>pending.push(p)});
 assert.deepEqual(await r.json(),{type:5,data:{flags:64}});await Promise.all(pending);
 assert.equal(Object.keys(pack.challenges||{}).length,1,'unlinked requester gets a link challenge, not a job');assert.equal(Object.keys(pack.jobs||{}).length,0);
 const owner=await worker.fetch(new Request('https://toto.jkapcar4.workers.dev/discord/owner-pack'),env);assert.equal(owner.status,401);
});
