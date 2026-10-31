// Gmail ingestion boundary. The external host reads authorized Gmail metadata; email text is data.
// Never executes text, sends email, changes inbox labels, invokes a model or creates a schedule.
import {applyDiscussion} from './sled-discussions.mjs';
const check=(ok,status,code)=>{if(!ok)throw Object.assign(new Error(code),{status,code});};
const hash=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x))),b=>b.toString(16).padStart(2,'0')).join('');
const email=x=>typeof x==='string'&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(x)&&x.length<=254;
export function mailView(rk,p={kind:'owner_session'}) {
 const owner=p.kind==='owner_session'||p.kind==='owner_key';
 const routes=(rk.mail_routes||[]).filter(r=>owner||r.relay_agent_id===p.agent_id);
 return {marker:'PACKSLEDV1',routes:structuredClone(routes),receipts:structuredClone((rk.mail_receipts||[]).filter(x=>owner||routes.some(r=>r.id===x.route_id))),transport:'external_gmail_relay',scheduling:'not_configured_by_this_code'};
}
export async function applyMail({rk,pound,data:d,principal:p,at,ctx}) {
 rk.mail_routes??=[];rk.mail_receipts??=[];
 if(d.action==='route') {
  check(p.kind==='owner_session',403,'owner_session_required');
  const fields=['action','id','expected_version','sender_address','seat','thread_id','project_id','recipient','mailbox_ref','relay_agent_id','enabled'];
  check(Object.keys(d).length===fields.length&&fields.every(k=>Object.hasOwn(d,k)),400,'invalid_mail_route_fields');
  check(/^[a-z][a-z0-9-]{1,39}$/.test(d.id)&&email(d.sender_address)&&/^[a-z][a-z0-9-]{1,39}$/.test(d.seat)&&typeof d.enabled==='boolean',400,'invalid_mail_route');
  check(/^[A-Za-z0-9:_-]{1,100}$/.test(d.mailbox_ref||'')&&d.recipient==='dot',400,'invalid_mail_destination');
  const task=pound.tasks?.find(t=>t.id===d.thread_id&&!t.archived&&t.project_id===d.project_id);check(task,409,'mail_project_task_required');
  check(!d.enabled||(ctx.agents||[]).some(g=>g.agent_id===d.relay_agent_id&&g.status==='active'&&g.scopes.includes('sled:coordinate')),409,'active_scoped_relay_required');
  check(!d.enabled||!rk.mail_routes.some(r=>r.id!==d.id&&r.enabled&&r.mailbox_ref===d.mailbox_ref&&r.sender_address===d.sender_address.toLowerCase()&&r.seat!==d.seat),409,'mail_sender_identity_conflict');
  const old=rk.mail_routes.find(r=>r.id===d.id);check(d.expected_version===(old?.version||0),409,'mail_route_changed');check(old||rk.mail_routes.length<24,409,'mail_route_capacity');
  const {action,expected_version,...route}=d;route.sender_address=route.sender_address.toLowerCase();route.version=(old?.version||0)+1;route.approved_at=at;
  if(old)Object.assign(old,route);else rk.mail_routes.push(route);return {route,subject:d.id};
 }
 check(d.action==='ingest'&&Object.keys(d).every(k=>['action','route_id','route_version','gmail_message_id','mailbox_ref','sender_address','sender_auth','subject','body','received_at'].includes(k)),400,'invalid_mail_ingest');
 const route=rk.mail_routes.find(r=>r.id===d.route_id&&r.enabled);check(route&&route.version===d.route_version,409,'mail_route_changed');
 check(p.kind==='delegated_agent'&&p.agent_id===route.relay_agent_id,403,'scoped_mail_relay_required');
 check(/^[A-Za-z0-9_-]{1,200}$/.test(d.gmail_message_id||'')&&d.mailbox_ref===route.mailbox_ref,400,'invalid_gmail_identity');
 const source_key=await hash(d.mailbox_ref+'\0'+d.gmail_message_id),body_sha256=await hash(String(d.body));
 const prior=rk.mail_receipts.find(x=>x.source_key===source_key);
 if(prior){check(prior.route_id===route.id&&prior.body_sha256===body_sha256,409,'mail_source_changed');return {receipt:prior,noop:true};}
 check(rk.mail_receipts.length<128,409,'mail_receipt_capacity');
 const receipt={id:'mail_'+crypto.randomUUID(),route_id:route.id,route_version:route.version,source_key,body_sha256,at,by:p.agent_id,status:'quarantined',sender_provenance:'expected_address_and_provider_auth_relay_attested'};
 // Unauthenticated or mismatched sender is quarantined. A subject tag never establishes identity.
 if(d.sender_address?.toLowerCase()!==route.sender_address||d.sender_auth!=='aligned_provider_pass')receipt.reason='sender_verification_required';
 else if(typeof d.subject!=='string'||!/(?:^|\s)PACKSLEDV1(?:\s|$)/.test(d.subject))receipt.reason='routing_marker_missing';
 else {
  try {
   check(typeof d.body==='string'&&d.body.length<=12000,400,'mail_body_limit');
   let e;try{e=JSON.parse(d.body);}catch{check(false,400,'mail_envelope_json_required');}
   check(e&&typeof e==='object'&&!Array.isArray(e),400,'mail_envelope_required');
   const allowed=['schema','project_id','thread_id','recipient','action',...(e.action==='vote'?['post_id','post_version','value']:e.action==='reply'?['post_id','post_version','body','evidence']:['body','evidence'])];
   check(Object.keys(e).every(k=>allowed.includes(k))&&e.schema==='pack-sled-mail/v1'&&['post','reply','vote'].includes(e.action),400,'invalid_mail_envelope');
   check(e.thread_id===route.thread_id&&e.project_id===route.project_id&&e.recipient===route.recipient&&pound.tasks?.some(t=>t.id===route.thread_id&&!t.archived&&t.project_id===route.project_id),403,'mail_task_correlation_mismatch');
   check(Number.isFinite(Date.parse(d.received_at)),400,'mail_source_timestamp_required');
   const data=e.action==='vote'?{action:'vote',id:e.post_id,version:e.post_version,value:e.value}:e.action==='reply'?{action:'post',thread_id:e.thread_id,body:e.body,evidence:e.evidence||[],parent_id:e.post_id,parent_version:e.post_version}:{action:'post',thread_id:e.thread_id,body:e.body,evidence:e.evidence||[]};
   // Only these three discussion actions are reachable. Mail cannot claim work, approve a plan,
   // configure routes, read a different project, or grant itself permissions.
   const result=applyDiscussion({rk,pound,data,principal:{kind:'email_agent',seat:route.seat,thread_id:route.thread_id,sender_route:route.id},at,request_id:'mail_'+source_key});
   receipt.status='accepted';receipt.source_received_at=d.received_at;receipt.action=e.action;receipt.thread_id=e.thread_id;receipt.post_id=result.post?.id||result.vote?.post_id;receipt.post_version=result.post?.revisions.length||result.vote?.version;
  } catch(e) {receipt.status='rejected';receipt.reason=e.code||'invalid_mail_envelope';}
 }
 rk.mail_receipts.push(receipt);return {receipt,subject:receipt.id,task_id:receipt.thread_id};
}
