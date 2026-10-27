/* Pure mapping for a user-selected private audit packet. No records are bundled here. */
const JOBS_IMPORT=(()=>{
 'use strict';
 const fail=m=>{throw Error(m);};
 const cut=x=>String(x||'').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').slice(0,500);
 const iso=x=>{if(x===null||x===undefined)return null;if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(x)||!Number.isFinite(Date.parse(x)))fail('A timestamp needs reconciliation.');return new Date(x).toISOString();};
 const slug=x=>String(x).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);
 const status=(stage,outcome,at,verified,evidence_url,extra={})=>({stage,outcome,occurred_at:iso(at),verified_at:iso(verified),evidence_url:evidence_url||null,reason_kind:'unknown',reason:'',next_action:'',blocker:'',resume_version:'',...extra});
 function plan(p,sha){
  if(p?.schema_version!=='job-hunter-migration-evidence-v1'||!/^[a-f0-9]{64}$/.test(sha))fail('Unsupported private audit packet.');
  const apps=p.applications,targets=p.approved_batch_targets,intake=p.intake_targets||[],contacts=p.recruiter_contacts||[];
  if(![apps,targets,intake,contacts].every(Array.isArray)||apps.length+targets.length+intake.length+contacts.length>300)fail('Invalid audit collections.');
  const entities=[...apps,...targets,...intake,...contacts],ids=entities.map(x=>x.id);
  if(ids.some(x=>typeof x!=='string'||!/^[A-Za-z0-9:_-]{1,160}$/.test(x))||new Set(ids).size!==ids.length)fail('Duplicate or missing source identities.');
  const appIds=new Set(apps.map(x=>x.id));
  for(const t of targets)if(t.linked_application_id&&!appIds.has(t.linked_application_id))fail('A linked application is missing.');
  const result=[];
  function add(x,source_id,snapshot,entity_ids,type='job',url=null){
   const create={employer_key:slug(x.company),employer:x.company,role:x.title??null,requisition:x.requisition_id??null,url,url_verified_at:null,resume_version:'',next_action:cut(x.next_action),blocker:'',source_id,record_type:type,
    provenance:{kind:'audited_migration',packet_sha256:sha,entity_ids,snapshot}};
   const details={match:cut(x.fit_basis),gaps:cut(x.fit_gaps),resume_version:'',resume_sha256:'',answers_provenance:'Private audited source preserved with this record. Submitted answers and resume versions remain unknown unless the source states them.',next_action:create.next_action,deadline:null};
   const item={source_id,create,details,events:[]};result.push(item);return item;
  }
  for(const a of apps){
   if(a.submission_confirmed!==true)fail('Application lacks submission evidence.');
   const linked=targets.filter(t=>t.linked_application_id===a.id);
   if(linked.some(t=>slug(t.company)!==slug(a.company)||t.requisition_id!==a.requisition_id))fail('Linked target identity needs reconciliation.');
   const source_id=a.receipt_message_id?'receipt:'+a.receipt_message_id:'portal:'+a.id;
   const r=add(a,source_id,{application:a,approved_targets:linked},[a.id,...linked.map(t=>t.id)],'job',a.role_url||linked[0]?.official_role_url||null);
   const next=cut(a.required_next_step?.next_action||(a.status==='no_later_decision_found'?'No later decision found in the audited sources; reconcile any new outcome.':'Review the recorded outcome evidence.'));
   r.create.next_action=next;r.details.next_action=next;r.details.gaps=cut(linked.map(t=>t.fit_gaps).filter(Boolean).join(' '));
   r.details.resume_version=cut(a.submitted_resume?.filename);r.details.resume_sha256=a.submitted_resume?.sha256||'';
   const event=status('submitted',a.status==='no_later_decision_found'?'no_later_decision':'none',a.submitted_at_utc,a.latest_checked_at_utc,a.receipt_url,{next_action:next});
   if(!a.receipt_url){
    if(a.submission_evidence_type!=='historical_portal_success'||!a.source_notes?.length||!a.identity_and_evidence_limits)fail('Historical receipt provenance is incomplete.');
    event.evidence={kind:'historical_portal_acknowledgment',source_id,source_ref:a.source_notes[0],precision:a.submission_timestamp_precision,description:a.identity_and_evidence_limits};
   }
   r.events.push(event);
   if(a.status!=='no_later_decision_found'){
    const outcome={rejected:'rejected',position_filled:'position_closed',no_current_match:'no_current_match'}[a.status];
    if(!outcome||!a.decision_url)fail('Decision evidence needs reconciliation.');
    r.events.push(status('closed',outcome,a.decision_at_utc,a.latest_checked_at_utc,a.decision_url,{reason_kind:a.stated_decision_reason?'explicit':'unknown',reason:cut(a.stated_decision_reason),next_action:next}));
   }
  }
  for(const t of targets){
   if(t.linked_application_id)continue;
   const r=add(t,'target:'+t.batch_id+':'+t.id,{target:t},[t.id],'job',t.official_role_url||null);
   r.events.push(status('approved','none',t.approval?.at_utc,t.latest_mail_reconciled_at_utc,null,{next_action:cut(t.next_action)}));
   if(t.status==='closed_before_submission'){
    if(!t.source_refs?.length)fail('Closed target lacks its historical source.');
    r.events.push(status('closed','position_closed',null,t.latest_mail_reconciled_at_utc,null,{next_action:cut(t.next_action),evidence:{kind:'audited_status',source_id:r.source_id,source_ref:t.source_refs[0],precision:'unknown',description:'Audited closed-before-submission status. Event time unknown; see preserved source record.'}}));
   }else if(['awaiting_final_attestation_approval','incomplete_required_facts_missing','not_submitted_required_facts_missing'].includes(t.status)){
    const blocker=cut(t.latest_gate)||'Required step is incomplete in the audited source.';
    r.events.push(status('approved','blocked_not_submitted',null,t.latest_mail_reconciled_at_utc,null,{next_action:cut(t.next_action),blocker}));
   }
  }
  for(const x of intake){const r=add(x,'intake:'+x.id,{intake:x},[x.id],'job',x.official_role_url||null);r.details.next_action=cut([x.next_action,x.deadline_display].filter(Boolean).join(' Deadline as displayed: '));r.events.push(status('screened','none',null,null,null,{next_action:r.details.next_action}));}
  for(const c of contacts){const r=add(c,'contact:'+c.id,{contact:c},[c.id],'contact');r.details.gaps=cut(c.fit_limits);}
  if(result[0])result[0].create.provenance.snapshot.audit_context={scope_and_limits:p.scope_and_limits,import_rules:p.import_rules,resolved_gates:p.resolved_gates,resume_control:p.resume_control,source_notes:p.source_notes,counts:p.counts};
  if(new Set(result.map(x=>x.source_id)).size!==result.length)fail('Repeated source identity needs reconciliation.');
  return {sha,records:result,counts:{source_entities:ids.length,records:result.length,jobs:result.filter(x=>x.create.record_type==='job').length,contacts:contacts.length,submissions:apps.length,linked_targets:targets.filter(x=>x.linked_application_id).length,historical_acknowledgments:apps.filter(x=>x.submission_evidence_type==='historical_portal_success').length}};
 }
 // A resumed import may replay only an exact prefix of its own planned history.
 // Claims, corrections and intervening edits require human reconciliation.
 function compatible(row,item){
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  if(!row||Object.keys(item.create).some(k=>!equal(row[k],item.create[k])))return false;
  if(row.events.length>item.events.length+1)return false;
  return row.events.every((e,i)=>i===0?e.kind==='work_details'&&equal(e.details,item.details):
   !e.kind&&Object.keys(item.events[i-1]).every(k=>equal(e[k],item.events[i-1][k])));
 }
 return Object.freeze({plan,compatible});
})();
if(typeof module!=='undefined')module.exports=JOBS_IMPORT;
