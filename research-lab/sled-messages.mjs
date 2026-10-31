// Private addressed messages inside the existing Pack Sled CAS record. No network or keys.

// A relay receipt is an authenticated relay's attestation, never proof of model identity.

const key = p => p.kind === 'delegated_agent' ? 'agent:'+p.agent_id : p.kind === 'owner_key' ? 'key:'+p.key_label : 'owner';

const check = (ok,status,code) => { if(!ok) throw Object.assign(new Error(code),{status,code}); };

const text = (x,n) => typeof x==='string' && x.trim().length>0 && x.length<=n && !/[\u0000-\u001f\u007f]/.test(x.replace(/\n/g,''));

function fields(d,allowed,required=allowed){check(Object.keys(d).every(k=>allowed.includes(k)),400,'unknown_message_field');check(required.every(k=>Object.hasOwn(d,k)),400,'missing_message_field');}

const active = (ctx,id) => (ctx.agents||[]).some(g=>g.agent_id===id && g.status==='active' && g.scopes?.includes('sled:coordinate'));

export function messageView(rk,principal={kind:'owner_session'}) {

  const owner=principal.kind==='owner_session'||principal.kind==='owner_key';

  const routes=(rk.message_routes||[]).filter(r=>owner||r.relay_agent_id===principal.agent_id);

  const messages=(rk.messages||[]).filter(m=>owner||m.by===key(principal)||routes.some(r=>r.id===m.route.id));

  return {routes:structuredClone(routes),messages:structuredClone(messages),transport:'external_relay',model_identity:'unverified',native_wakeup:false};

}

export function applyMessage({rk,pound,data:d,principal:p,at,ctx,request_id}) {

  rk.message_routes??=[];rk.messages??=[];

  const owner=p.kind==='owner_session';

  if(d.action==='route') {

    check(owner,403,'owner_session_required');

    fields(d,['action','id','expected_version','recipient','transport','target_ref','relay_agent_id','enabled']);

    check(/^[a-z][a-z0-9-]{1,39}$/.test(d.id),400,'invalid_route_id');

    check(text(d.recipient,60)&&/^[A-Za-z0-9:_-]{1,200}$/.test(d.target_ref||''),400,'invalid_destination');

    check(['dot_child','external_session'].includes(d.transport),400,'unsupported_message_transport');

    check(/^[a-f0-9]{32}$/.test(d.relay_agent_id)&&typeof d.enabled==='boolean',400,'invalid_relay');

    const r=rk.message_routes.find(r=>r.id===d.id);

    check(d.expected_version===(r?.version||0),409,'message_route_changed');

    check(!d.enabled||active(ctx,d.relay_agent_id),409,'active_scoped_relay_required');

    check(r||rk.message_routes.length<16,409,'message_route_capacity');

    const next={id:d.id,version:(r?.version||0)+1,recipient:d.recipient,transport:d.transport,target_ref:d.target_ref,relay_agent_id:d.relay_agent_id,enabled:d.enabled,approved_at:at};

    if(r)Object.assign(r,next);else rk.message_routes.push(next);

    return {route:next,subject:d.id};

  }

  if(d.action==='send') {

    fields(d,['action','thread_id','route_id','route_version','text','reply_to'],['action','thread_id','route_id','route_version','text']);

    check(text(d.text,2000),400,'invalid_message_text');
    const existing=rk.messages.find(m=>m.submission_key===request_id&&m.by===key(p));
    if(existing){check(existing.text===d.text&&existing.thread_id===d.thread_id&&existing.route.id===d.route_id&&existing.route.version===d.route_version&&existing.reply_to===(d.reply_to||null),409,'idempotency_conflict');return {message:existing,subject:existing.id,task_id:existing.thread_id,noop:true};}


    const task=pound.tasks?.find(t=>t.id===d.thread_id&&!t.archived);

    check(task,409,'message_thread_unavailable');

    const route=rk.message_routes.find(r=>r.id===d.route_id&&r.enabled);

    check(route&&route.version===d.route_version,409,'message_route_changed');

    check(owner||p.kind==='owner_key'||(p.kind==='delegated_agent'&&p.agent_id===route.relay_agent_id),403,'message_relay_mismatch');

    check(!d.reply_to||rk.messages.some(m=>m.id===d.reply_to&&m.thread_id===d.thread_id&&m.route.id===route.id&&m.state==='replied'),409,'message_reply_parent_invalid');

    check(rk.messages.length<64,409,'message_capacity');

    const message={id:'msg_'+crypto.randomUUID(),submission_key:request_id,thread_id:d.thread_id,route:structuredClone(route),text:d.text,reply_to:d.reply_to||null,by:key(p),state:'saved',at,events:[{state:'saved',at,by:key(p)}]};

    rk.messages.push(message);return {message,subject:message.id,task_id:message.thread_id};

  }

  fields(d,['action','id','attempt_id','receipt','text','reason'],['action','id']);

  const m=rk.messages.find(m=>m.id===d.id);check(m,404,'message_not_found');

  const route=rk.message_routes.find(r=>r.id===m.route.id);

  const update=(state,extra={})=>{m.state=state;Object.assign(m,extra);m.events.push({state,at,by:key(p)});check(m.events.length<=24,409,'message_event_capacity');return {message:m,subject:m.id,task_id:m.thread_id};};

  if(d.action==='cancel') {check(owner||m.by===key(p),403,'message_sender_required');check(m.state==='saved',409,'message_may_have_been_sent');return update('cancelled');}

  // Reconciliation never resends. An uncertain message must be inspected at its exact destination.

  if(d.action==='reconcile_failed') {check(owner,403,'owner_session_required');check(m.state==='reserved'||m.state==='uncertain',409,'message_not_uncertain');check(text(d.reason,500),400,'reconciliation_reason_required');return update('failed',{reason:d.reason});}

  check(p.kind==='delegated_agent'&&p.agent_id===m.route.relay_agent_id,403,'scoped_message_relay_required');

  check(route?.enabled&&route.version===m.route.version,409,'message_route_changed');

  if(d.action==='reserve') {

    check(m.state==='saved',409,'message_already_reserved');

    check(/^[A-Za-z0-9_-]{16,80}$/.test(d.attempt_id||''),400,'message_attempt_required');

    check(pound.tasks?.some(t=>t.id===m.thread_id&&!t.archived),409,'message_thread_unavailable');

    return update('reserved',{attempt_id:d.attempt_id});

  }

  check(d.attempt_id===m.attempt_id,409,'message_attempt_mismatch');

  if(d.action==='uncertain') {check(m.state==='reserved',409,'invalid_message_transition');return update('uncertain',{reason:'Delivery outcome unknown. Inspect the destination; do not resend.'});}

  if(d.action==='delivered') {

    check(['reserved','uncertain'].includes(m.state),409,'invalid_message_transition');

    check(text(d.receipt,200),400,'delivery_receipt_required');

    return update('delivered',{delivery:{ref:d.receipt,at,by:key(p),trust:'relay_attested'}});

  }

  if(d.action==='running') {check(m.state==='delivered',409,'invalid_message_transition');check(text(d.receipt,200),400,'execution_receipt_required');return update('running',{execution:{ref:d.receipt,at,trust:'relay_attested'}});}

  if(d.action==='reply') {

    check(['delivered','running'].includes(m.state),409,'invalid_message_transition');

    check(text(d.text,2000)&&text(d.receipt,200),400,'reply_evidence_required');

    return update('replied',{reply:{text:d.text,ref:d.receipt,at,by:key(p),trust:'relay_attested',model_identity:'unverified'}});

  }

  if(d.action==='failed') {check(['reserved','delivered','running'].includes(m.state),409,'invalid_message_transition');check(text(d.reason,500)&&text(d.receipt,200),400,'failure_evidence_required');return update('failed',{reason:d.reason,failure_ref:d.receipt});}

  check(false,400,'unknown_message_action');

}
