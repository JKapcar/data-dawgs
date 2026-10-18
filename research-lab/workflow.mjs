// Derived from the existing tenant view. No separate workflow store or progress flags.
export function workflowGraph(state,hypothesisId,now=Date.now()) {
 const h=state.hypotheses.find(h=>h.id===hypothesisId);if(!h)throw new Error('Hypothesis unavailable');
 const version=h.revisions.length, ds=state.discussions.filter(d=>d.hypothesisId===h.id), last=xs=>xs.at(-1);
 const check=last(ds.filter(d=>d.kind==='data_check'));
 const task=check&&last(state.tasks.filter(t=>t.hypothesisId===h.id&&t.dataCheckId===check?.id));
 const receipt=task&&last(state.receipts.filter(r=>r.taskId===task?.id));
 const review=receipt&&last(ds.filter(d=>d.kind==='review'&&d.receiptId===receipt?.id));
 const finding=review&&last(ds.filter(d=>d.kind==='finding'&&d.reviewId===review?.id));
 const decision=finding&&last(ds.filter(d=>d.kind==='owner_decision'&&d.findingId===finding?.id));
 const records=[h,check,receipt||task,review,finding,decision];
 const labels=['Question','Development-data check','Experiment','Separate review','Finding','Owner decision'];
 const reasons=['Question recorded; no scientific verdict.','Check the exact synthetic discovery input. Real development adapter is unconfigured.','Queue a bounded descriptive audit after a current data check.','A distinct verified account subject must review this receipt. Different assistant labels are insufficient.','Record a descriptive finding after a ready review.','Signed owner must accept the descriptive finding, request revision, or defer.'];
 const nodes=records.map((r,i)=>({id:'stage-'+i,label:labels[i],record:r||null,status:r?'recorded':'blocked',reason:reasons[i],dependsOn:i?['stage-'+(i-1)]:[],evidenceIds:r?.evidenceIds||[]}));
 let blocked=h.revisions.at(-1).status==='withdrawn';
 for(let i=0;i<nodes.length;i++){
  const n=nodes[i],r=n.record;
  if(i&&r?.hypothesisVersion!==undefined&&r.hypothesisVersion!==version){n.status='stale';n.reason=`Record binds v${r.hypothesisVersion}; question is v${version}. Recheck and rerun.`;blocked=true;continue;}
  if(i===1&&r&&state.codeHash&&r.codeHash!==state.codeHash){n.status='stale';n.reason='Implementation changed since data check. Recheck and rerun.';blocked=true;continue;}
  if(blocked){n.status='blocked';n.reason=i?'Upstream prerequisite is blocked or stale.':'Question withdrawn.';continue;}
  if(!r){blocked=true;continue;}
  if(i===1)n.reason='Synthetic input schema checked and hashed; baseline_fit=false. No real development validation.';
  if(i===2){
   n.reason=receipt?`SYNTHETIC ${receipt.outcome}; descriptive only, no fitted baseline.`:task.lease?.expiresAt>now?'Lease active; no execution receipt yet.':'Awaiting a valid claim and execution; no completed agent work.';
   if(!receipt||receipt.outcome==='failure'){n.status=receipt?'failed':'pending';n.reason=receipt?.error||n.reason;blocked=true;}
  }
  if(i===3){n.reason='Distinct account subject only; scientific independence is not established. '+review.disposition;if(review.disposition!=='ready'){n.status='blocked';blocked=true;}}
  if(i===4)n.reason='Descriptive interpretation; not a hypothesis verdict.';
  if(i===5){n.status=decision.disposition==='accept_descriptive'?'accepted':decision.disposition;n.reason='Owner disposition: '+decision.disposition+'. No execution, access grant, or scientific validation.';}
 }
 return {hypothesisId,version,nodes,legacyTasks:state.tasks.filter(t=>t.hypothesisId===h.id&&!t.dataCheckId).length};
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
  list.append(item);
 }
 container.append(make('p',`Question v${graph.version}. SYNTHETIC workflow. 2025 holdout unavailable. Review separation is account-based, not proof of scientific independence.`),list);
 if(graph.legacyTasks)container.append(make('p',`${graph.legacyTasks} legacy task(s) lack a bounded data-check link and do not satisfy this workflow.`));
}
