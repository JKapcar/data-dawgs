// Integration through the real assembled Worker: mcpAuth → key label → Pack seat → tools/list and
// tools/call, plus the /discord/interactions and /discord/owner-pack routes. Fake RTDB and Discord.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dawg-bot-worker.js';

const DB='https://data-dawgs-draft-default-rtdb.firebaseio.com',PEPPER='pack-test-pepper';
const APP='12345678901234567',GUILD='23456789012345678',CHANNEL='34567890123456789',KAP='45678901234567890';
const hmac=async(secret,msg)=>{const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Buffer.from(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(msg))).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const USERS={u_owner:{name:'Kap',mcpToken:await hmac(PEPPER,'mcp|u_primarytoken'),mcpTokens:{Gemini:{hash:await hmac(PEPPER,'mcp|u_geminitoken'),ts:1}}},u_jeff:{name:'Jeff',mcpToken:await hmac(PEPPER,'mcp|u_jefftoken')}};
const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']),pub=Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('hex');
const env={BOZO_PEPPER:PEPPER,FB_SECRET:'mock',RL:{async get(){return null;},async put(){},async delete(){}},RESEARCH_OWNER_UID:'u_owner',
 DISCORD_INBOUND_ENABLED:'true',DISCORD_APPLICATION_ID:APP,DISCORD_APPLICATION_PUBLIC_KEY:pub,DISCORD_GUILD_ID:GUILD,DISCORD_CHANNEL_ID:CHANNEL,DISCORD_USER_LINKS:'[]',DISCORD_BOT_TOKEN:'fake-test-only',
 DISCORD_PACK_ENABLED:'true',DISCORD_PACK_DELIVERY_ENABLED:'false',DISCORD_PACK_SEATS:JSON.stringify({claude:{key_label:'primary'},gemini:{key_label:'Gemini'}})};
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

test('main connector lists Pack seat tools only for the owner key assigned to a seat',async()=>{
 assert.deepEqual(await names('u_primarytoken'),['dd_pack_bind','dd_pack_poll','dd_pack_read','dd_pack_claim','dd_pack_answer','dd_pack_release']);
 assert.equal((await names('u_geminitoken')).length,6);assert.deepEqual(await names('u_jefftoken'),[]);
 const init=await rpc('u_primarytoken','initialize',{protocolVersion:'2025-06-18'});assert.match(init.result.instructions,/assigned a Pack seat \(6 dd_pack_\* tools\)/);
 const jeffInit=await rpc('u_jefftoken','initialize',{protocolVersion:'2025-06-18'});assert.doesNotMatch(jeffInit.result.instructions,/Pack seat/);
 const denied=await call('u_jefftoken','dd_pack_bind',{});assert.equal(denied.isError,true);assert.match(denied.body,/pack_seat_not_available/);
 env.DISCORD_PACK_ENABLED='false';assert.deepEqual(await names('u_primarytoken'),[]);env.DISCORD_PACK_ENABLED='true';
});
test('bind and poll run through JSON-RPC with server-verified key labels',async()=>{
 const bound=await call('u_primarytoken','dd_pack_bind',{session_ref:'synthetic session',poll_minutes:10});assert.equal(bound.isError,false,bound.body);
 const {lease,seat,binding}=JSON.parse(bound.body);assert.equal(seat,'claude');assert.equal(binding,1);assert.match(lease,/^dpl_[A-Za-z0-9_-]{43}$/);
 assert.equal(pack.seats.claude.key_label,'primary');assert.ok(!JSON.stringify(pack).includes(lease),'only the lease hash is stored');
 const gem=JSON.parse((await call('u_geminitoken','dd_pack_bind',{})).body);assert.equal(gem.seat,'gemini');
 const crossed=await call('u_geminitoken','dd_pack_poll',{lease});assert.equal(crossed.isError,true);assert.match(crossed.body,/lease_invalid/);
 const poll=JSON.parse((await call('u_primarytoken','dd_pack_poll',{lease})).body);assert.deepEqual([poll.seat,poll.jobs.length],['claude',0]);
 assert.ok(nonGet.every(u=>u===DB+'/discord_pack_v1.json'),'Pack tools write only their own store');
});
test('interactions route reaches the Pack admission path; owner route requires a site session',async()=>{
 const event={id:'71234567890123456',application_id:APP,type:2,guild_id:GUILD,channel_id:CHANNEL,token:'interaction-token-'+'t'.repeat(40),member:{user:{id:KAP,username:'kap'}},data:{type:1,name:'pack',options:[{name:'question',type:3,value:'hello'},{name:'to',type:3,value:'claude'}]}};
 const raw=JSON.stringify(event),stamp=String(Math.floor(Date.now()/1000)),sig=Buffer.from(await crypto.subtle.sign('Ed25519',pair.privateKey,new TextEncoder().encode(stamp+raw))).toString('hex');
 const pending=[];const r=await worker.fetch(new Request('https://toto.jkapcar4.workers.dev/discord/interactions',{method:'POST',headers:{'X-Signature-Timestamp':stamp,'X-Signature-Ed25519':sig},body:raw}),env,{waitUntil:p=>pending.push(p)});
 assert.deepEqual(await r.json(),{type:5,data:{flags:64}});await Promise.all(pending);
 assert.equal(Object.keys(pack.challenges||{}).length,1,'unlinked requester gets a link challenge, not a job');assert.equal(Object.keys(pack.jobs||{}).length,0);
 const owner=await worker.fetch(new Request('https://toto.jkapcar4.workers.dev/discord/owner-pack'),env);assert.equal(owner.status,401);
});
