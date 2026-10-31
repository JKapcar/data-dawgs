import test from 'node:test';
import assert from 'node:assert/strict';
import {rkEmpty,rkApply} from './robokap-core.mjs';
const owner={kind:'owner_session'},relay={kind:'delegated_agent',agent_id:'a'.repeat(32),seat:'dot',scopes:['sled:coordinate']};
const thread='p_00000001-0000-4000-8000-000000000000';
async function fixture(){let rk=rkEmpty(),n=0;const pound={tasks:[{id:thread,project_id:'recruiting',archived:false}]};const call=async(data,p=relay)=>{const out=await rkApply(rk,pound,{op:'rk.mail',request_id:'mail_test_request_'+(++n),data},p,Date.now(),{agents:[{...relay,status:'active'}]});rk=out.rk;return out.result;};
await call({action:'route',id:'claude-mail',expected_version:0,sender_address:'agent@example.com',seat:'claude',thread_id:thread,project_id:'recruiting',recipient:'dot',mailbox_ref:'mailbox-test',relay_agent_id:relay.agent_id,enabled:true},owner);
const envelope={schema:'pack-sled-mail/v1',project_id:'recruiting',thread_id:thread,recipient:'dot',action:'post',body:'Synthetic report',evidence:[]};
const input={action:'ingest',route_id:'claude-mail',route_version:1,gmail_message_id:'message1',mailbox_ref:'mailbox-test',sender_address:'agent@example.com',sender_auth:'aligned_provider_pass',subject:'PACKSLEDV1 report',body:JSON.stringify(envelope),received_at:'2026-10-31T00:00:00Z'};
return {call,input,envelope,get rk(){return rk;}};}
test('email report, reply, changeable versioned vote and durable source dedup',async()=>{const f=await fixture();const r=await f.call(f.input);assert.equal(r.receipt.status,'accepted');assert.equal(f.rk.discussion_posts.length,1);f.rk.idem=[];await f.call(f.input);assert.equal(f.rk.discussion_posts.length,1);
const send=(id,e)=>f.call({...f.input,gmail_message_id:id,body:JSON.stringify(e)});
let reply=await send('message2',{...f.envelope,action:'reply',post_id:r.receipt.post_id,post_version:1});assert.equal(reply.receipt.status,'accepted');
const {body,evidence,...vote}=f.envelope;await send('message3',{...vote,action:'vote',post_id:r.receipt.post_id,post_version:1,value:1});await send('message4',{...vote,action:'vote',post_id:r.receipt.post_id,post_version:1,value:-1});assert.equal(f.rk.discussion_votes.length,1);assert.equal(f.rk.discussion_votes[0].value,-1);
await assert.rejects(f.call({...f.input,body:'changed'}),/mail_source_changed/);});
test('subject is not identity; missing authentication quarantines',async()=>{for(const change of [{sender_address:'attacker@example.com'},{sender_auth:'unknown'},{subject:'[PACK-SLED] report'}]){const f=await fixture();const r=await f.call({...f.input,...change});assert.equal(r.receipt.status,'quarantined');assert.equal(f.rk.discussion_posts.length,0);}});
test('reject cross-project data, arbitrary actions, extra fields and malformed bodies',async()=>{for(const body of ['bad',JSON.stringify({schema:'pack-sled-mail/v1',action:'route'}),null]){const f=await fixture();const r=await f.call({...f.input,body});assert.equal(r.receipt.status,'rejected');}
for(const change of [{project_id:'bdb'},{thread_id:'other'},{recipient:'astra'},{execute:'grant access'}]){const f=await fixture();const r=await f.call({...f.input,body:JSON.stringify({...f.envelope,...change})});assert.equal(r.receipt.status,'rejected');assert.equal(f.rk.discussion_posts.length,0);}});
test('only assigned scoped relay ingests; owner cannot impersonate sender',async()=>{const f=await fixture();await assert.rejects(f.call(f.input,owner),/scoped_mail_relay_required/);await assert.rejects(f.call(f.input,{...relay,agent_id:'b'.repeat(32)}),/scoped_mail_relay_required/);});
