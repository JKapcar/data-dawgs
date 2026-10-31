import test from 'node:test';
import assert from 'node:assert/strict';
import {rkEmpty,rkApply,rkParse,rkSerialize,rkWork,rkBoard} from './robokap-core.mjs';
import {createMessageRelay} from './sled-message-relay.mjs';
const owner={kind:'owner_session'},relay={kind:'delegated_agent',agent_id:'a'.repeat(32),seat:'coordinator',scopes:['sled:work:read','sled:coordinate']};
const other={...relay,agent_id:'b'.repeat(32)},tid='p_00000001-0000-4000-8000-000000000000';
async function fixture(){
 let rk=rkEmpty(),seq=0;const pound={tasks:[{id:tid,title:'Synthetic hello',body:'No private data',archived:false}],contexts:[]};
 const ctx={agents:[{agent_id:relay.agent_id,seat:relay.seat,status:'active',scopes:relay.scopes,expires_at:Date.now()+86400000}]};
 const call=async(data,p=owner,k='synthetic_request_'+(++seq))=>{const o=await rkApply(rk,pound,{op:'rk.message',request_id:k,data},p,Date.now(),ctx);rk=rkParse(rkSerialize(o.rk));return o.result;};
 const route={action:'route',id:'dot-demo',expected_version:0,recipient:'Synthetic dot task',transport:'dot_child',target_ref:'synthetic-child-id',relay_agent_id:relay.agent_id,enabled:true};
 await call(route);
 const send=()=>call({action:'send',thread_id:tid,route_id:route.id,route_version:1,text:'Reply with hello.'});
 const transport={read:()=>rkWork(rk,pound,Date.now(),ctx,{principal:relay}),write:(_op,k,data)=>call(data,relay,k)};
 return {call,send,transport,route,ctx,pound,get rk(){return rk;}};
}
test('durable addressed thread, delivery and actual adapter reply remain distinct and idempotent',async()=>{
 const f=await fixture(),m=(await f.send()).message;let sends=0,read=0;
 const run=createMessageRelay({transport:f.transport,adapter:{deliver:async x=>{sends++;assert.equal(x.target,'synthetic-child-id');assert.equal(x.correlationId,m.id);return {receipt:'synthetic-send:1'};},readReply:async()=>++read===1?{state:'running',receipt:'synthetic-run:1'}:{state:'replied',receipt:'synthetic-turn:2',text:'Hello from a synthetic adapter.'}}});
 assert.equal(f.rk.messages[0].state,'saved');assert.equal((await run(m.id)).state,'delivered');assert.equal((await run(m.id)).state,'running');assert.equal((await run(m.id)).state,'replied');await run(m.id);assert.equal(sends,1);
 const view=await rkBoard(f.rk,f.pound,Date.now(),f.ctx);assert.equal(view.messaging.messages[0].reply.text,'Hello from a synthetic adapter.');assert.equal(view.messaging.messages[0].thread_id,tid);assert.equal(view.messaging.native_wakeup,false);
});
test('unknown external send never repeats across polls or relay restart',async()=>{
 const f=await fixture(),m=(await f.send()).message;let sends=0;const adapter={deliver:async()=>{sends++;throw Error('lost response');},readReply:async()=>null};
 await createMessageRelay({transport:f.transport,adapter})(m.id);await createMessageRelay({transport:f.transport,adapter})(m.id);assert.equal(sends,1);assert.equal(f.rk.messages[0].state,'uncertain');
 await assert.rejects(f.call({action:'reserve',id:m.id,attempt_id:'another_attempt_123'},relay),/message_already_reserved/);
});
test('lost reservation response or lost delivered persistence does not resend',async()=>{
 for(const lost of ['reserve','delivered']){
  const f=await fixture(),m=(await f.send()).message;let sends=0;
  const transport={...f.transport,write:async(op,k,d)=>{const out=await f.transport.write(op,k,d);if(d.action===lost)throw Error('lost persisted response');return out;}};
  const adapter={deliver:async()=>{sends++;return {receipt:'synthetic-send'};},readReply:async()=>null};
  await assert.rejects(createMessageRelay({transport,adapter})(m.id));await createMessageRelay({transport:f.transport,adapter})(m.id);assert.equal(sends,lost==='reserve'?0:1);
 }
});
test('only assigned scoped relay records delivery; another agent cannot read or mutate it',async()=>{
 const f=await fixture(),m=(await f.send()).message;
 const args={action:'reserve',id:m.id,attempt_id:'synthetic_attempt_1'};
 await assert.rejects(f.call(args,other),/scoped_message_relay_required/);await assert.rejects(f.call(args,{kind:'owner_key',key_label:'primary'}),/scoped_message_relay_required/);
 const view=await rkWork(f.rk,f.pound,Date.now(),f.ctx,{principal:other});assert.equal(view.messaging.messages.length,0);assert.equal(view.messaging.routes.length,0);
 await assert.rejects(f.call({...f.route,expected_version:1},relay),/owner_session_required/);
});
test('cancel before reservation, route changes and archived threads stop dispatch',async()=>{
 const f=await fixture(),m=(await f.send()).message;await f.call({action:'cancel',id:m.id});assert.equal(f.rk.messages[0].state,'cancelled');
 await assert.rejects(f.call({action:'reserve',id:m.id,attempt_id:'synthetic_attempt_1'},relay),/message_already_reserved/);
 const next=(await f.send()).message;await f.call({...f.route,expected_version:1,enabled:false});await assert.rejects(f.call({action:'reserve',id:next.id,attempt_id:'synthetic_attempt_2'},relay),/message_route_changed/);
});
test('cannot invent running/reply before delivery; duplicate send and reply are replayed once',async()=>{
 const f=await fixture(),send={action:'send',thread_id:tid,route_id:'dot-demo',route_version:1,text:'Synthetic'},first=await f.call(send,owner,'repeat_send_key_123');await f.call(send,owner,'repeat_send_key_123');f.rk.idem=[];await f.call(send,owner,'repeat_send_key_123');assert.equal(f.rk.messages.length,1);
 const d={id:first.message.id,attempt_id:'synthetic_attempt_1'};await f.call({...d,action:'reserve'},relay);
 await assert.rejects(f.call({...d,action:'reply',text:'Fake',receipt:'x'},relay),/invalid_message_transition/);
 await f.call({...d,action:'delivered',receipt:'synthetic-send'},relay);const reply={...d,action:'reply',text:'Hello',receipt:'synthetic-turn'};await f.call(reply,relay,'repeat_reply_key_123');await f.call(reply,relay,'repeat_reply_key_123');assert.equal(f.rk.messages[0].events.filter(e=>e.state==='replied').length,1);
 await assert.rejects(f.call({...reply,text:'Changed'},relay,'repeat_reply_key_123'),/idempotency_conflict/);
});
test('missing adapter fails closed rather than echoing or claiming delivery',()=>{assert.throws(()=>createMessageRelay({transport:{read(){},write(){}}}),/authorized_message_adapter_required/);});
