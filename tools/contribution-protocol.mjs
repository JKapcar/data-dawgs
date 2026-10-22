// Offline document validator only. No store, network, authentication or migration.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function validateContribution(r) {
  const errors = [];
  const fail = (p, m) => errors.push(p + ': ' + m);
  const obj = (v, keys, p) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { fail(p, 'object required'); return {}; }
    for (const k of keys) if (!Object.hasOwn(v, k)) fail(p + '.' + k, 'required (use null for unknown where allowed)');
    for (const k of Object.keys(v)) if (!keys.includes(k)) fail(p + '.' + k, 'unknown field');
    return v;
  };
  const text = (v, p, nullable = false) => { if (!(nullable && v === null) && !(typeof v === 'string' && v.trim() && v.length <= 12000)) fail(p, 'nonempty text required'); };
  const one = (v, values, p) => { if (!values.includes(v)) fail(p, 'invalid value'); };
  const list = (v, p, f) => { if (!Array.isArray(v) || v.length > 100) fail(p, 'bounded array required'); else v.forEach((x, i) => f(x, p + '[' + i + ']')); };
  const utc = (v, p, nullable = false) => { if (nullable && v === null) return; if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v) || !Number.isFinite(Date.parse(v))) fail(p, 'UTC timestamp required'); };
  const hash = (v, p) => { if (v !== null && !/^[a-f0-9]{64}$/.test(v || '')) fail(p, 'SHA256 or null required'); };
  r = obj(r, ['schema_version','id','revision','supersedes','project_id','scope','kind','stage','synthetic','question','actor','data','method','judgment','execution','results','artifacts','reviews','owner_decision','timestamps','resources'], '$');
  if (r.schema_version !== 1) fail('schema_version', 'must be 1');
  text(r.id, 'id'); text(r.project_id, 'project_id'); text(r.supersedes, 'supersedes', true);
  if (!Number.isInteger(r.revision) || r.revision < 1) fail('revision', 'positive integer required');
  one(r.scope, ['public','private'], 'scope'); one(r.kind, ['infrastructure','research'], 'kind');
  one(r.stage, ['proposed','uncertain','performed','accepted'], 'stage');
  if (typeof r.synthetic !== 'boolean') fail('synthetic', 'boolean required');
  text(r.question, 'question');
  const a = obj(r.actor, ['label','model_self_reported','credential_identity','continuity_ref'], 'actor');
  for (const k of ['label','model_self_reported','continuity_ref']) text(a[k], 'actor.' + k, k !== 'label');
  if (a.credential_identity !== null) {
    const c = obj(a.credential_identity, ['kind','label','evidence_ref'], 'actor.credential_identity');
    one(c.kind, ['server_recorded_key','server_recorded_account'], 'actor.credential_identity.kind');
    text(c.label, 'actor.credential_identity.label'); text(c.evidence_ref, 'actor.credential_identity.evidence_ref');
  }
  const d = obj(r.data, ['dataset','version','split','sha256','holdout_accessed'], 'data');
  text(d.dataset, 'data.dataset', true); text(d.version, 'data.version', true); hash(d.sha256, 'data.sha256');
  one(d.split, [null,'synthetic','discovery','development','not_applicable'], 'data.split');
  if (d.holdout_accessed !== false) fail('data.holdout_accessed', 'must remain false; holdout is sealed');
  const m = obj(r.method, ['description','sources','code_ref','config_ref'], 'method');
  text(m.description, 'method.description'); list(m.sources, 'method.sources', text);
  text(m.code_ref, 'method.code_ref', true); text(m.config_ref, 'method.config_ref', true);
  const j = obj(r.judgment, ['basis','choice','tradeoffs','rejected_alternatives','assumptions'], 'judgment');
  one(j.basis, ['contributor_report','retrospective_diff','synthetic_example'], 'judgment.basis'); text(j.choice, 'judgment.choice');
  for (const k of ['tradeoffs','rejected_alternatives','assumptions']) if (j[k] !== null) list(j[k], 'judgment.' + k, text);
  const e = obj(r.execution, ['status','experiment_ref'], 'execution');
  one(e.status, ['not_run','completed','failed','unknown'], 'execution.status'); text(e.experiment_ref, 'execution.experiment_ref', true);
  const result = obj(r.results, ['outcome','summary'], 'results');
  one(result.outcome, ['unknown','success','null','failure','inconclusive'], 'results.outcome'); text(result.summary, 'results.summary', true);
  if (result.outcome === 'unknown' && result.summary !== null) fail('results.summary', 'unknown results must stay null');
  if (result.outcome !== 'unknown' && !result.summary) fail('results.summary', 'observed result explanation required');
  if (result.outcome !== 'unknown' && !['completed','failed'].includes(e.status)) fail('results.outcome', 'requires performed execution');
  if (e.status === 'failed' && !['failure','unknown'].includes(result.outcome)) fail('results.outcome', 'failed execution cannot claim successful, null or inconclusive results');
  if (result.outcome === 'failure' && e.status !== 'failed') fail('execution.status', 'failure result requires failed execution');
  if (r.stage === 'proposed' && (e.status !== 'not_run' || result.outcome !== 'unknown')) fail('stage', 'proposal must not imply execution or results');
  if (r.stage === 'uncertain' && (e.status !== 'unknown' || result.outcome !== 'unknown')) fail('stage', 'uncertain needs unknown execution/results');
  if (['performed','accepted'].includes(r.stage) && !['completed','failed'].includes(e.status)) fail('stage', 'performed/accepted requires execution evidence');
  list(r.artifacts, 'artifacts', (v, p) => { const x = obj(v, ['kind','ref','sha256','visibility'], p); text(x.kind,p+'.kind'); text(x.ref,p+'.ref'); hash(x.sha256,p+'.sha256'); one(x.visibility,['public','private'],p+'.visibility'); if (r.scope === 'public' && x.visibility !== 'public') fail(p, 'private artifact cannot enter public record'); });
  if (['performed','accepted'].includes(r.stage) && (!r.artifacts?.length || !e.experiment_ref)) fail('execution', 'performed work needs artifact and execution reference');
  if (r.reviews !== null) list(r.reviews,'reviews',(v,p) => { const x=obj(v,['ref','verdict','disagreement','at'],p); text(x.ref,p+'.ref'); text(x.verdict,p+'.verdict'); text(x.disagreement,p+'.disagreement',true); utc(x.at,p+'.at'); });
  if (r.owner_decision !== null) { const x=obj(r.owner_decision,['ref','decision','scope','at'],'owner_decision'); text(x.ref,'owner_decision.ref'); one(x.decision,['accept','revise','reject'],'owner_decision.decision'); text(x.scope,'owner_decision.scope'); utc(x.at,'owner_decision.at'); }
  if (r.stage === 'accepted' && r.owner_decision?.decision !== 'accept') fail('stage','acceptance needs a referenced owner acceptance with explicit scope');
  const t=obj(r.timestamps,['recorded_at','started_at','finished_at'],'timestamps'); utc(t.recorded_at,'timestamps.recorded_at'); utc(t.started_at,'timestamps.started_at',true); utc(t.finished_at,'timestamps.finished_at',true);
  const res=obj(r.resources,['elapsed_ms','cost_amount','currency','basis_ref'],'resources');
  for(const k of ['elapsed_ms','cost_amount']) if(res[k]!==null && !(typeof res[k]==='number' && Number.isFinite(res[k]) && res[k]>=0)) fail('resources.'+k,'nonnegative number or null required');
  text(res.currency,'resources.currency',true); text(res.basis_ref,'resources.basis_ref',true);
  if ((res.elapsed_ms!==null || res.cost_amount!==null) && !res.basis_ref) fail('resources.basis_ref','known time/cost requires evidence');
  if(res.cost_amount!==null && !res.currency) fail('resources.currency','known cost requires currency');
  return errors;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failures = 0;
  for (const file of process.argv.slice(2)) { const errors=validateContribution(JSON.parse(readFileSync(file,'utf8'))); for(const e of errors) console.error(file+': '+e); failures+=errors.length; }
  if(process.argv.length<3) { console.error('Usage: node tools/contribution-protocol.mjs record.json [...]'); process.exitCode=2; }
  else { console.log(failures ? failures+' validation errors' : 'Document structure valid; identity, evidence and publication permission NOT verified.'); process.exitCode=failures?1:0; }
}
