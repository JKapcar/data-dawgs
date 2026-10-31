// Task/project-scoped discussion in the same private Pack Sled record. Scores are opinions.
const check=(ok,status,code)=>{if(!ok)throw Object.assign(new Error(code),{status,code});};
const identity=p=>p.kind==='email_agent'?{id:'seat:'+p.seat,seat:p.seat,sender_route:p.sender_route,trust:'allowlisted_email_sender_relay_attested_model_unverified'}:p.kind==='delegated_agent'?{id:'seat:'+p.seat,seat:p.seat,credential_id:p.agent_id,trust:'scoped_seat_verified_model_unverified'}:{id:'owner_shared',trust:'owner_shared_not_independent'};
const accessible=(rk,task,p)=>p.kind==='email_agent'?p.thread_id===task:p.kind!=='delegated_agent'||p.scopes.includes('sled:coordinate')||(()=>{const x=rk.plans.findLast(x=>x.task_id===task&&x.status==='approved');return x&&(x.seat===p.seat||x.reviewer_seat===p.seat);})();
const bodyOK=x=>typeof x==='string'&&x.trim()&&x.length<=2000;
export function discussionView(rk,principal={kind:'owner_session'}) {
 const me=identity(principal).id;
 return {identity:identity(principal),score_is_proof:false,posts:(rk.discussion_posts||[]).filter(p=>accessible(rk,p.thread_id,principal)).map(p=>{
   const version=p.revisions.length,votes=(rk.discussion_votes||[]).filter(v=>v.post_id===p.id&&v.version===version);
   return {...structuredClone(p),version,score:votes.reduce((n,v)=>n+v.value,0),scoped_seat_votes:votes.filter(v=>v.by.trust==='scoped_seat_verified_model_unverified'&&v.value!==0).length,email_sender_votes:votes.filter(v=>v.by.trust==='allowlisted_email_sender_relay_attested_model_unverified'&&v.value!==0).length,owner_shared_vote:votes.find(v=>v.by.id==='owner_shared')?.value||0,my_vote:votes.find(v=>v.by.id===me)?.value||0};
 }).sort((a,b)=>b.score-a.score||b.at.localeCompare(a.at))};
}
export function applyDiscussion({rk,pound,data:d,principal:p,at,request_id}) {
 rk.discussion_posts??=[];rk.discussion_votes??=[];
 const by=identity(p),allowed={post:['action','thread_id','body','evidence','parent_id','parent_version'],revise:['action','id','expected_version','body','evidence'],vote:['action','id','version','value']}[d.action];
 check(allowed&&Object.keys(d).every(k=>allowed.includes(k)),400,'invalid_discussion_fields');
 if(d.action==='post') {
  const task=pound.tasks?.find(t=>t.id===d.thread_id&&!t.archived);check(task,409,'discussion_thread_unavailable');check(accessible(rk,d.thread_id,p),403,'discussion_project_denied');
  const prior=rk.discussion_posts.find(x=>x.submission_key===request_id&&x.by.id===by.id);
  if(prior){check(prior.revisions[0].body===d.body&&prior.thread_id===d.thread_id&&JSON.stringify(prior.revisions[0].evidence)===JSON.stringify(d.evidence||[])&&prior.parent_id===(d.parent_id||null)&&prior.parent_version===(d.parent_version||null),409,'idempotency_conflict');return {post:prior,noop:true};}
 }
 let post=d.action==='post'?null:rk.discussion_posts.find(x=>x.id===d.id);if(d.action!=='post'){check(post,404,'discussion_not_found');check(accessible(rk,post.thread_id,p),403,'discussion_project_denied');check(pound.tasks?.some(t=>t.id===post.thread_id&&!t.archived),409,'discussion_thread_unavailable');}
 if(d.action==='vote') {
  check(d.version===post.revisions.length,409,'discussion_version_changed');check([-1,0,1].includes(d.value),400,'invalid_vote');
  let v=rk.discussion_votes.find(x=>x.post_id===post.id&&x.version===d.version&&x.by.id===by.id);
  check(v||rk.discussion_votes.length<256,409,'discussion_vote_capacity');
  const next={post_id:post.id,version:d.version,value:d.value,by,at};if(v)Object.assign(v,next);else rk.discussion_votes.push(next);
  return {vote:next,subject:post.id,task_id:post.thread_id};
 }
 check(bodyOK(d.body),400,'invalid_discussion_body');
 const evidence=d.evidence||[];check(Array.isArray(evidence)&&evidence.length<=4&&evidence.every(x=>typeof x==='string'&&x.length<=1000&&/^https?:\/\/[^\s]+$/.test(x)),400,'invalid_discussion_evidence');
 const revision={body:d.body,evidence:[...evidence],at,by};
 if(d.action==='post') {
  if(d.parent_id){const parent=rk.discussion_posts.find(x=>x.id===d.parent_id);check(parent&&parent.thread_id===d.thread_id&&d.parent_version===parent.revisions.length,409,'discussion_parent_changed');}
  else check(d.parent_version===undefined,400,'discussion_parent_required');
  check(rk.discussion_posts.length<64,409,'discussion_capacity');
  const task=pound.tasks.find(t=>t.id===d.thread_id);
  post={id:'post_'+crypto.randomUUID(),submission_key:request_id,thread_id:d.thread_id,project_id:task.project_id||null,by,at,parent_id:d.parent_id||null,parent_version:d.parent_version||null,revisions:[revision]};rk.discussion_posts.push(post);
 } else {
  check(post.by.id===by.id,403,'discussion_author_required');check(d.expected_version===post.revisions.length,409,'discussion_version_changed');check(post.revisions.length<8,409,'discussion_revision_capacity');post.revisions.push(revision);
 }
 return {post,subject:post.id,task_id:post.thread_id};
}
