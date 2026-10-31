// Pure DOM rendering. Writes use the board's existing same-request retry and account guards.
export function renderMessages(board,{root,form,act}) {
  const doc=root.ownerDocument,create=(tag,text)=>{const n=doc.createElement(tag);n.textContent=text;return n;};
  const messaging=board.messaging||{routes:[],messages:[]};
  const routes=messaging.routes.filter(r=>r.enabled),old=form.elements.route_id.value;
  form.elements.route_id.replaceChildren(...routes.map(r=>{const o=create('option',r.recipient+' · external relay');o.value=r.id;return o;}));
  if(routes.some(r=>r.id===old))form.elements.route_id.value=old;
  const cards=[...Object.values(board.lanes||{}).flat(),...(board.unplanned||[]),...(board.done||[])];
  const tasks=[...new Map(cards.filter(t=>!t.archived).map(t=>[t.task_id,t])).values()],previous=form.elements.thread_id.value;
  form.elements.thread_id.replaceChildren(...tasks.map(t=>{const o=create('option',t.title);o.value=t.task_id;return o;}));
  if(tasks.some(t=>t.task_id===previous))form.elements.thread_id.value=previous;
  form.querySelector('button[type=submit]').disabled=!routes.length||!tasks.length;
  root.replaceChildren();
  if(!routes.length)root.append(create('p','No approved delivery connection. Saving a board note cannot reach an agent. An owner must identify a target session and an existing scoped relay.'));
  const labels={saved:'Saved · not delivered',reserved:'Reserved · delivery not confirmed',uncertain:'Delivery uncertain · do not resend',delivered:'Delivered · reply pending',running:'Running · reported by relay',replied:'Reply saved',failed:'Failed',cancelled:'Cancelled before delivery'};
  for(const m of [...messaging.messages].reverse()) {
    const item=create('article','');item.className='rk-panel';item.dataset.messageId=m.id;
    item.append(create('h3',m.route.recipient+' · '+(labels[m.state]||m.state)),create('p',m.text),create('p','Thread '+m.thread_id+' · Message '+m.id),create('p','Saved '+m.at));
    if(m.delivery)item.append(create('p','Delivery receipt: '+m.delivery.ref+' · '+m.delivery.at+' · relay attestation'));
    if(m.reply)item.append(create('blockquote',m.reply.text),create('p','Reply receipt: '+m.reply.ref+' · '+m.reply.at+' · model identity unverified'));
    if(m.reason)item.append(create('p',m.reason));
    if(m.state==='saved'){const b=create('button','Cancel before delivery');b.type='button';b.onclick=()=>act('rk.message',{action:'cancel',id:m.id},'Cancel message');item.append(b);}
    root.append(item);
  }
}
export function renderDiscussion(board,{root,form,act}) {
  const doc=root.ownerDocument,create=(tag,text)=>{const n=doc.createElement(tag);n.textContent=text;return n;};
  const cards=[...Object.values(board.lanes||{}).flat(),...(board.unplanned||[]),...(board.done||[])];
  const tasks=[...new Map(cards.filter(t=>!t.archived).map(t=>[t.task_id,t])).values()],prev=form.elements.thread_id.value;
  form.elements.thread_id.replaceChildren(...tasks.map(t=>{const o=create('option',t.title);o.value=t.task_id;return o;}));
  if(tasks.some(t=>t.task_id===prev))form.elements.thread_id.value=prev;
  form.querySelector('button[type=submit]').disabled=!tasks.length;
  root.replaceChildren();
  for(const p of board.discussion?.posts||[]) {
    const r=p.revisions.at(-1),item=create('article','');item.className='rk-panel';item.dataset.postId=p.id;
    item.append(create('h3','Score '+p.score+' · version '+p.version),create('p',r.body),create('p',(p.project_id||'Task thread')+' · '+p.thread_id),create('p',p.by.id+' · '+p.by.trust.replaceAll('_',' ')),create('p',p.scoped_seat_votes+' scoped-seat opinions · '+(p.email_sender_votes||0)+' email-sender opinions · owner/shared opinion '+p.owner_shared_vote));
    if(p.parent_id)item.append(create('p','Reply to '+p.parent_id+' version '+p.parent_version));
    for(const ref of r.evidence)item.append(create('p','Evidence: '+ref)); // Inert text, not permission to fetch.
    for(const [label,value] of [['Upvote',1],['Downvote',-1],['Clear vote',0]]){const b=create('button',label);b.type='button';b.setAttribute('aria-pressed',String(p.my_vote===value));b.onclick=()=>act('rk.discuss',{action:'vote',id:p.id,version:p.version,value},label);item.append(b);}
    const reply=create('textarea','');reply.maxLength=2000;reply.rows=2;reply.setAttribute('aria-label','Reply or disagreement');item.append(reply);
    const b=create('button','Post reply');b.type='button';b.onclick=async()=>{if(!reply.value.trim())return;const out=await act('rk.discuss',{action:'post',thread_id:p.thread_id,body:reply.value,parent_id:p.id,parent_version:p.version},'Post reply');if(out)reply.value='';};item.append(b);
    root.append(item);
  }
  if(!root.children.length)root.append(create('p','No discussion yet. Scores reflect recorded opinions, not verified evidence or independent review.'));
}

export function renderMail(board,root) {
 const doc=root.ownerDocument;root.replaceChildren();
 const rows=board.mail?.receipts||[];
 if(!rows.length){const p=doc.createElement('p');p.textContent='No email ingested. Expected sender and task mappings must be approved before an external Gmail reader can ingest reports.';root.append(p);}
 for(const r of [...rows].reverse()){const p=doc.createElement('p');p.textContent=r.status.toUpperCase()+' · '+r.id+' · '+r.at+' · '+(r.reason||r.action+' → '+r.post_id+' v'+r.post_version)+' · source '+r.source_key.slice(0,12);root.append(p);}
}
