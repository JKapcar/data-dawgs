import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fingerprint, compare, preflight, snapshot, verify } from '../tools/worker-config-guard.mjs';
const oldId = 'c531aa77-fae9-4f43-8bd6-dd052537dc50', newId = '11111111-1111-4111-8111-111111111111', dep = '22222222-2222-4222-8222-222222222222';
const names = ['ROBOKAP_ENABLED', 'DISCORD_MENTIONS_ENABLED', 'DISCORD_GROK_WAKE_ENABLED', 'DISCORD_GROK_INCLUDED_USAGE_CONFIRMED', 'DISCORD_PACK_ENABLED', 'DISCORD_RETRIEVAL_ENABLED', 'DISCORD_DFS_SHARE_ENABLED', 'DISCORD_PACK_DELIVERY_ENABLED'];
const v = (enabled = false) => ({ id: enabled ? newId : oldId, resources: { bindings: [...names.map(name => ({ name, type: 'plain_text', text: String(enabled) })), { name: 'DISCORD_PACK_SEATS', type: 'plain_text', text: enabled ? '{"grok":{"key_label":"pack-grok"}}' : '{}' }, { name: 'DISCORD_GROK_APPROVAL_EXPIRES_AT', type: 'plain_text', text: '2026-10-24T23:40:00.000Z' }, { name: 'PRIVATE', type: 'plain_text', text: 'never-print-this' }, { name: 'TOKEN', type: 'secret_text' }], script_runtime: { compatibility_date: '2026-07-31', limits: { cpu_ms: 30000 } }, script: { handlers: ['fetch', 'scheduled'] } } });
test('only complete approved repair from exact regressed version passes', () => {
  assert.equal(compare(fingerprint(v()), fingerprint(v(true))).length, 9);
  const wrong = v(); wrong.id = newId; assert.throws(() => compare(fingerprint(wrong), fingerprint(v(true))));
  const partial = v(); partial.resources.bindings[0].text = 'true'; assert.throws(() => compare(fingerprint(v()), fingerprint(partial)));
});
test('future unchanged releases pass; regressions, expiry extensions and added/removed bindings fail', () => {
  const good = v(true); assert.deepEqual(compare(fingerprint(good), fingerprint(good)), []);
  for (const change of [x => x.resources.bindings[0].text = 'false', x => x.resources.bindings.find(b => b.name.endsWith('EXPIRES_AT')).text = '2027-01-01', x => x.resources.bindings.pop(), x => x.resources.bindings.push({ name: 'NEW', type: 'plain_text', text: 'true' }), x => x.resources.script_runtime.limits.cpu_ms++, x => x.resources.script.handlers.push('email')]) {
    const bad = structuredClone(good); change(bad); assert.throws(() => compare(fingerprint(good), fingerprint(bad)));
  }
});
test('order-independent binding fingerprints do not expose private values', () => {
  const a = v(true), b = v(true); b.resources.bindings.reverse();
  assert.deepEqual(compare(fingerprint(a), fingerprint(b)), []);
  assert.ok(!JSON.stringify(fingerprint(a)).includes('never-print-this'));
  b.resources.bindings.push(b.resources.bindings[0]); assert.throws(() => fingerprint(b));
});
test('preflight catches committed defaults and preserves remote-only variables', () => {
  const manifest = { name: 'toto', keep_vars: true, vars: Object.fromEntries(v(true).resources.bindings.filter(b => names.includes(b.name) || b.name === 'DISCORD_PACK_SEATS').map(b => [b.name, b.text])) };
  assert.equal(preflight(fingerprint(v()), manifest).length, 9);
  manifest.vars.ROBOKAP_ENABLED = 'false'; assert.throws(() => preflight(fingerprint(v()), manifest));
});
function options(results) { return { account: 'a'.repeat(32), token: 'synthetic_only_token', fetcher: async (url, o) => { assert.equal(o.method, 'GET'); assert.equal(o.redirect, 'error'); assert.match(url, /\/(deployments|versions\/[a-f0-9-]+)$/); return Response.json({ success: true, result: results.shift() }); } }; }
const deployment = (id = oldId) => ({ deployments: [{ id: dep, versions: [{ version_id: id, percentage: 100 }] }] });

test('Job Hunter approval permits only absent-to-true activation from the exact baseline',()=>{
 const before=v(true);before.id='f0b1a335-6182-4365-9b40-9c8ca6ce90be';const after=structuredClone(before);after.id=newId;
 after.resources.bindings.push({name:'JOB_HARNESS_ENABLED',type:'plain_text',text:'true'});
 assert.deepEqual(compare(fingerprint(before),fingerprint(after)),['JOB_HARNESS_ENABLED']);
 for(const mutate of [x=>x.resources.bindings.push({name:'JOB_HARNESS_MEMBER_UIDS',type:'plain_text',text:'u_other'}),x=>x.resources.bindings[0].text='false',x=>x.resources.bindings.at(-1).text='false']){
 const bad=structuredClone(after);mutate(bad);assert.throws(()=>compare(fingerprint(before),fingerprint(bad)));
 }
 const stale=structuredClone(before);stale.id=newId;assert.throws(()=>compare(fingerprint(stale),fingerprint(after)));
 assert.deepEqual(compare(fingerprint(after),fingerprint(after)),[]);
});
test('GET-only snapshot and candidate verification detect concurrent deployment', async () => {
  const before = await snapshot(options([deployment(), v(), deployment()]));
  assert.equal((await verify(options([deployment(), v(), deployment(), v(true), deployment()]), before, newId)).changed_bindings.length, 9);
  await assert.rejects(verify(options([deployment(newId), v(true), deployment(newId)]), before, newId));
  await assert.rejects(snapshot(options([deployment(), v(), deployment(newId)])));
});
test('failed metadata and mismatched candidate fail closed', async () => {
  await assert.rejects(snapshot(options([{}])));
  const before = { ...fingerprint(v()), deployment_id: dep };
  await assert.rejects(verify(options([deployment(), v(), deployment(), v()]), before, newId));
});
test('workflow gates promotion after upload; committed restoration preserves bounded expiry remotely', () => {
  const workflow = readFileSync('.github/workflows/worker-deploy.yml', 'utf8');
  assert.ok(workflow.includes('worker-config-guard.mjs snapshot') && workflow.includes('worker-config-guard.mjs verify'));
  assert.ok(workflow.indexOf('worker-config-guard.mjs snapshot') < workflow.indexOf('npx wrangler@4 versions upload'));
  assert.ok(workflow.indexOf('worker-config-guard.mjs verify') < workflow.indexOf('npx wrangler@4 versions deploy'));
  const manifest = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  for (const name of names) assert.equal(manifest.vars[name], 'true');
  assert.equal(manifest.vars.DISCORD_PACK_SEATS, '{"grok":{"key_label":"pack-grok"}}');
  assert.equal(manifest.vars.DISCORD_GROK_APPROVAL_EXPIRES_AT, undefined);
  assert.equal(manifest.keep_vars, true);
});
