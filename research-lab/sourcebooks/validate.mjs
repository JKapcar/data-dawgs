import assert from 'node:assert/strict';
export function validateBook(d){
 assert.equal(d.schema_version,1);assert(['competition','template'].includes(d.kind));
 for(const k of ['id','name','objective'])assert.equal(typeof d.competition[k],'string');
 for(const z of d.competition.display_timezones)new Intl.DateTimeFormat('en',{timeZone:z});
 const date=v=>assert(/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v).toISOString().startsWith(v));
 const url=v=>assert.equal(new URL(v).protocol,'https:');
 const provenance=s=>{assert(['live_official_page','official_indexed_extract','unverified'].includes(s.evidence_level));if(d.kind==='competition'||s.evidence_level!=='unverified'){url(s.url);assert(s.section);date(s.checked_on);}};
 const status=(s,e)=>{assert(['unknown','not_started','in_progress','complete','blocked'].includes(s));if(s==='complete')assert(typeof e==='string'&&e.trim());};
 const ids=new Set();const id=i=>{assert(i&&!ids.has(i));ids.add(i);};
 for(const r of d.requirements){id(r.id);assert(r.text&&r.category);assert(['required','recommended','internal','to_verify'].includes(r.classification));provenance(r.source);status(r.readiness,r.completion_evidence);if(r.constraint){assert(['<','<=','=','>=','>'].includes(r.constraint.operator));assert(Number.isFinite(r.constraint.value));assert(r.constraint.unit);}}
 for(const t of d.timeline){id(t.id);assert(['official','recommended','internal'].includes(t.classification));assert(Boolean(t.instant)!==Boolean(t.date));if(t.instant){assert(t.instant.endsWith('Z'));assert(Number.isFinite(Date.parse(t.instant)));}else{date(t.date);if(t.end_date){date(t.end_date);assert(t.end_date>=t.date);}}provenance(t.source);}
 for(const l of d.lifecycle){id(l.id);assert(l.title&&l.required_record);assert.equal(l.classification,'internal');status(l.status,l.completion_evidence);}
 assert(Array.isArray(d.open_questions)&&Array.isArray(d.change_history));
 if(d.kind==='competition'){date(d.checked_on);url(d.competition.official_url);url(d.competition.rules_url);}
 return true;
}
