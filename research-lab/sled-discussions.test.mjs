import test from 'node:test';
import assert from 'node:assert/strict';
import {rkEmpty,rkApply,rkSerialize,rkParse} from './robokap-core.mjs';
import {discussionView} from './sled-discussions.mjs';
const owner={kind:'owner_session'},a={kind:'delegated_agent',agent_id:'a'.repeat(32),seat:'claude',scopes:['sled:work:read','sled:discuss']},b={...a,agent_id:'b'.repeat(32),seat:'grok'};
const thread='p_00000001-0000-4000-8000-000000000000',other='p_00000002-0000-4000-8000-000000000000';
function fixture(){let rk=rkEmpty(),n=0;const pound={tasks:[{id:thread,title:'Synthetic question',project_id:'synthetic-project',archived:false},{id:other,title:'Other private project',project_id:'other',archived:false}]};rk.plans.push({task_id:thread,status:'approved',seat:'claude',reviewer_seat:'grok'});
 return {get rk(){return rk;},call:async(data,p=owner,k='discussion_test_'+(++n))=>{const out=await rkApply(rk,pound,{op:'rk.discuss',request_id:k,data},p,Date.now());rk=rkParse(rkSerialize(out.rk));return out.result;}};}
test('changeable seat vote; reissued credentials cannot cast a second vote; shared keys count once',async()=>{
 const f=fixture(),post=(await f.call({action:'post',thread_id:thread,body:'Synthetic question',evidence:['https://example.com/evidence']},a)).post;
 const vote=(value,p)=>f.call({action:'vote',id:post.id,version:1,value},p);
 await vote(1,b);await vote(-1,{...b,agent_id:'c'.repeat(32)});assert.equal(f.rk.discussion_votes.length,1);
 await vote(1,{kind:'owner_key',key_label:'Claude'});await vote(-1,{kind:'owner_key',key_label:'Astra'});await vote(1,owner);
 let v=discussionView(f.rk).posts[0];assert.equal(v.score,0);assert.equal(v.scoped_seat_votes,1);assert.equal(v.owner_shared_vote,1);assert.equal(f.rk.discussion_votes.length,2);
 await vote(0,b);assert.equal(discussionView(f.rk).posts[0].score,1);
});
test('revision preserves evidence history and requires new votes; stale votes and replies fail closed',async()=>{
 const f=fixture(),post=(await f.call({action:'post',thread_id:thread,body:'Original'},a)).post;
 await f.call({action:'vote',id:post.id,version:1,value:1},b);await f.call({action:'revise',id:post.id,expected_version:1,body:'Revised'},a);
 assert.equal(discussionView(f.rk).posts[0].score,0);assert.equal(f.rk.discussion_posts[0].revisions.length,2);
 await assert.rejects(f.call({action:'vote',id:post.id,version:1,value:1},b),/discussion_version_changed/);
 await assert.rejects(f.call({action:'post',thread_id:thread,body:'Stale reply',parent_id:post.id,parent_version:1},b),/discussion_parent_changed/);
 const reply=(await f.call({action:'post',thread_id:thread,body:'Disagreement with evidence',parent_id:post.id,parent_version:2,evidence:['https://example.com/counter']},b)).post;assert.equal(reply.parent_version,2);
});
test('project/task boundary, author and explicit discussion scope are enforced',async()=>{
 const f=fixture();await assert.rejects(f.call({action:'post',thread_id:other,body:'Unauthorized'},a),/discussion_project_denied/);
 await assert.rejects(f.call({action:'post',thread_id:thread,body:'Readonly'},{...a,scopes:['sled:work:read']}),/scope_denied/);
 const post=(await f.call({action:'post',thread_id:thread,body:'Own'},a)).post;
 await assert.rejects(f.call({action:'revise',id:post.id,expected_version:1,body:'Other author'},b),/discussion_author_required/);
 assert.equal(discussionView(f.rk,{...b,seat:'muse'}).posts.length,0);
 f.rk.plans.push({task_id:thread,status:'approved',seat:'gemini'});assert.equal(discussionView(f.rk,a).posts.length,0);
});
test('post dedup survives idempotency-ring eviction and rejects changed content',async()=>{
 const f=fixture(),d={action:'post',thread_id:thread,body:'One post'};await f.call(d,a,'durable_post_key_123');f.rk.idem=[];await f.call(d,a,'durable_post_key_123');assert.equal(f.rk.discussion_posts.length,1);
 await assert.rejects(f.call({...d,body:'Different'},a,'durable_post_key_123'),/idempotency_conflict/);
});
