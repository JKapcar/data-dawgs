// Derived from the existing tenant view. No separate workflow store or progress flags.
export function workflowGraph(state,hypothesisId,now=Date.now(),attemptId=null) {
 const h=state.hypotheses.find(h=>h.id===hypothesisId);if(!h)throw new Error('Hypothesis unavailable');
 const version=h.revisions.length, ds=state.discussions.filter(d=>d.hypothesisId===h.id), last=xs=>xs.at(-1);
 const checks=ds.filter(d=>d.kind==='data_check');
 const attempts=checks.flatMap(c=>{
  const tasks=state.tasks.filter(t=>t.hypothesisId===h.id&&t.dataCheckId===c.id);
  return (tasks.length?tasks:[null]).map(t=>{
   const r=state.receipts.find(r=>r.taskId===t?.id),d=last(ds.filter(d=>d.kind==='owner_decision'&&d.receiptId===r?.id));
   return {id:t?.id||c.id,checkId:c.id,taskId:t?.id||null,hypothesisVersion:c.hypothesisVersion,codeHash:c.codeHash,accepted:d?.disposition==='accept_descriptive',label:`v${c.hypothesisVersion} / ${t?.status||'checked, not queued'} / ${d?'last recorded: '+d.disposition:'no owner decision'} / ${(t?.id||c.id).slice(0,8)}`};
  });
 });
 const selected=attempts.find(a=>a.id===attemptId)||last(attempts.filter(a=>a.accepted&&a.hypothesisVersion===version&&(!state.codeHash||a.codeHash===state.codeHash)))||last(attempts);
 const check=checks.find(c=>c.id===selected?.checkId);
 const task=state.tasks.find(t=>t.id===selected?.taskId);
 const receipt=task&&last(state.receipts.filter(r=>r.taskId===task?.id));
 const review=receipt&&last(ds.filter(d=>['review','advisory_review'].includes(d.kind)&&d.receiptId===receipt?.id));
 const finding=review&&last(ds.filter(d=>d.kind==='finding'&&d.reviewId===review?.id));
 const decision=finding&&last(ds.filter(d=>d.kind==='owner_decision'&&d.findingId===finding?.id));
 const history=receipt?ds.filter(d=>['review','advisory_review','finding','owner_decision'].includes(d.kind)&&d.receiptId===receipt.id):[];
 const recordedDecision=last(history.filter(d=>d.kind==='owner_decision'))||null;
 const records=[h,check,receipt||task,review,finding,decision];
 const labels=['Question','Development-data check','Experiment','Separate review','Finding','Owner decision'];
 const reasons=['Question recorded; no scientific verdict.','Check the exact synthetic discovery input. Real development adapter is unconfigured.','Queue a bounded descriptive audit after a current data check.','Record a receipt-bound advisory review, or use a distinct verified account for separate review. Assistant labels do not establish independence.','Record a descriptive finding after a receipt-bound review; advisory findings stay non-independent.','Signed owner must accept the descriptive finding, request revision, or defer.'];
 const nodes=records.map((r,i)=>({id:'stage-'+i,label:labels[i],record:r||null,status:r?'recorded':'blocked',reason:reasons[i],dependsOn:i?['stage-'+(i-1)]:[],evidenceIds:r?.evidenceIds||[]}));
 nodes[3].advisories=ds.filter(d=>d.kind==='advisory_review'&&(!d.receiptId||d.receiptId===receipt?.id));
 let blocked=h.revisions.at(-1).status==='withdrawn';
 for(let i=0;i<nodes.length;i++){
  const n=nodes[i],r=n.record;
  if(i&&r?.hypothesisVersion!==undefined&&r.hypothesisVersion!==version){n.status='stale';n.reason=`Record binds v${r.hypothesisVersion}; question is v${version}. Recheck and rerun.`;blocked=true;continue;}
  if(i===1&&r&&state.codeHash&&r.codeHash!==state.codeHash){n.status='stale';n.reason='Implementation changed since data check. Recheck and rerun.';blocked=true;continue;}
  if(blocked){n.status='blocked';n.reason=i?'Upstream prerequisite is blocked or stale.':'Question withdrawn.';continue;}
  if(!r){blocked=true;continue;}
  if(i===1)n.reason='Synthetic input schema checked and hashed; baseline_fit=false. No real development validation.';
  if(i===2){
   if(receipt&&state.verifiedReceiptIds&&!state.verifiedReceiptIds.includes(receipt.id)){n.status='unverified';n.reason='Historical receipt retained; canonical linkage and hashes are not verified for the current attempt.';blocked=true;continue;}
   n.reason=receipt?`SYNTHETIC ${receipt.outcome}; descriptive only, no fitted baseline.`:task.lease?.expiresAt>now?'Lease active; no execution receipt yet.':'Awaiting a valid claim and execution; no completed agent work.';
   if(!receipt||receipt.outcome==='failure'){n.status=task?.status==='stale'?'stale':receipt?'failed':'pending';n.reason=task?.staleReason||receipt?.error||n.reason;blocked=true;}
  }
  if(i===3&&review.kind==='advisory_review'){n.status='advisory';n.reason='Non-independent advisory review. Descriptive finding and owner disposition only; separate-account, scientific and holdout gates remain unsatisfied.';}
  else if(i===3){n.reason='Distinct account subject only; scientific independence is not established. '+review.disposition;if(review.disposition!=='ready'){n.status='blocked';blocked=true;}}
  if(i===4)n.reason=(finding.reviewMode==='advisory_not_independent'?'ADVISORY / NON-INDEPENDENT. ':'')+'Descriptive interpretation; not a hypothesis verdict.';
  if(i===5){n.status=decision.disposition==='accept_descriptive'?'accepted':decision.disposition;n.reason=(decision.reviewMode==='advisory_not_independent'?'ADVISORY / NON-INDEPENDENT BASIS. ':'')+'Owner disposition: '+decision.disposition+'. No execution, access grant, or scientific validation.';}
 }
 if(recordedDecision&&!decision)nodes[5].reason='No owner disposition for the current review/finding. Earlier owner dispositions remain in the recorded history; they do not decide newer advice.';
 return {hypothesisId,version,nodes,history,recordedDecision,attempts,attemptId:selected?.id||null,legacyTasks:state.tasks.filter(t=>t.hypothesisId===h.id&&!t.dataCheckId).length};
}
export function renderWorkflow(container,graph,state){
 const doc=container.ownerDocument,make=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 container.replaceChildren();const list=make('ol');list.className='workflow-graph';list.setAttribute('aria-label','Research dependency and evidence graph');
 for(const [i,n]of graph.nodes.entries()){
  const item=make('li');item.id=n.id;item.dataset.status=n.status;
  const heading=make('h3',`${i+1}. ${n.label}`);item.append(heading,make('strong',n.status.toUpperCase()),make('p',n.reason));
  if(i){const dep=make('a',`Requires ${graph.nodes[i-1].label}`);dep.href='#stage-'+(i-1);item.append(dep);}
  if(n.record){const details=make('details');details.id='workflow-record-'+(n.record.id||i);details.append(make('summary','Evidence record / version / provenance'),make('pre',JSON.stringify(n.record,null,2)));item.append(details);}
  for(const id of n.evidenceIds){const e=state.evidence.find(e=>e.id===id);if(!e){item.append(make('p','Evidence unavailable: '+id));continue;}try{const url=new URL(e.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw 0;const a=make('a',e.title+' (unverified source claim)');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';item.append(a);}catch{item.append(make('p','Evidence link unavailable'));}}
  if(n.advisories?.length){
   const aside=make('aside');aside.append(make('h4','Advisory reviews — non-independent'),make('p','These contributions may inform descriptive owner decisions, but do not satisfy separate-account, scientific or holdout gates.'));
   for(const a of n.advisories){const d=make('details');d.append(make('summary',`${a.hypothesisVersion===graph.version?'Advisory':'STALE advisory'} / question v${a.hypothesisVersion} / ${a.actor}`),make('p',a.body),make('pre',JSON.stringify(a,null,2)));aside.append(d);}
   item.append(aside);
  }
  if(i===5&&graph.recordedDecision){const prior=make('a','View last recorded owner disposition: '+graph.recordedDecision.disposition);prior.href='#workflow-history-'+graph.recordedDecision.id;item.append(prior);}
  list.append(item);
 }
 container.append(make('p',`Question v${graph.version}. SYNTHETIC workflow. 2025 holdout unavailable. Review separation is account-based, not proof of scientific independence.`),list);
 if(graph.history.length){
  const section=make('section');section.id='workflow-history';section.setAttribute('aria-label','Recorded review and decision history');section.append(make('h3','Recorded review and decision history'),make('p','Immutable records for this attempt. New advice does not erase or inherit an earlier owner disposition. Historical decisions do not authorize scientific validation or holdout access.'));
  for(const record of graph.history){
   const details=make('details');details.id='workflow-history-'+record.id;
   const stale=record.hypothesisVersion!==graph.version?' / STALE question version':'';
   details.append(make('summary',`${record.kind}${record.disposition?' / '+record.disposition:''} / ${record.at}${stale}`),make('p',record.body),make('p',record.reviewMode||record.separation||'No independence claim'));
   for(const [key,label]of [['reviewId','Linked review'],['findingId','Linked finding']])if(record[key]){const a=make('a',label);a.href='#workflow-history-'+record[key];details.append(a);}
   details.append(make('pre',JSON.stringify(record,null,2)));section.append(details);
  }
  container.append(section);
 }
 if(graph.legacyTasks)container.append(make('p',`${graph.legacyTasks} legacy task(s) lack a bounded data-check link and do not satisfy this workflow.`));
}
