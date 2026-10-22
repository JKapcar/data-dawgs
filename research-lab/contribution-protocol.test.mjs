import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateContribution } from '../tools/contribution-protocol.mjs';

const fixture = name => JSON.parse(readFileSync(new URL('../docs/contributions/' + name + '.json', import.meta.url)));
const proposed = () => fixture('synthetic-proposal');
test('public examples are structurally valid without claiming identity verification', () => {
  for (const name of ['synthetic-proposal','synthetic-null','engineering-pr-333','engineering-pr-335']) {
    const r = fixture(name), before = JSON.stringify(r);
    assert.deepEqual(validateContribution(r), [], name);
    assert.equal(JSON.stringify(r), before, 'validation never fills missing evidence');
    assert.equal(r.actor.model_self_reported, null);
    assert.equal(r.actor.credential_identity, null);
    assert.equal(r.owner_decision, null);
    assert.equal(r.resources.cost_amount, null);
  }
});
test('required method, judgment, evidence and project boundaries cannot be omitted', () => {
  for (const key of ['method','judgment','artifacts','project_id','scope','results']) {
    const r = proposed(); delete r[key];
    assert.ok(validateContribution(r).some(e => e.includes(key)), key);
  }
  for (const key of ['choice','tradeoffs','rejected_alternatives','assumptions']) {
    const r=proposed(); delete r.judgment[key];
    assert.ok(validateContribution(r).some(e => e.includes(key)), key);
  }
});
test('unknown data, identity, cost and results remain unknown rather than defaulting to success or zero', () => {
  const r=proposed(); r.data.dataset=null; r.data.version=null; r.data.split=null;
  const before=JSON.stringify(r);
  assert.deepEqual(validateContribution(r), []);
  assert.equal(JSON.stringify(r), before);
  r.results.summary='No evidence, but probably successful';
  assert.ok(validateContribution(r).some(e=>e.includes('unknown results')));
  r.results.summary=null; r.actor.credential_identity={kind:'verified_model',label:'Invented model',evidence_ref:'self-claim'};
  assert.ok(validateContribution(r).some(e=>e.includes('credential_identity.kind')));
});
test('observed null and failure are distinct from unknown and cannot be fabricated on a proposal', () => {
  const r=fixture('synthetic-null'); assert.equal(r.results.outcome,'null');
  assert.deepEqual(validateContribution(r), []);
  r.stage='proposed'; assert.ok(validateContribution(r).some(e=>e.includes('proposal')));
  r.stage='performed'; r.results.outcome='failure'; r.execution.status='failed';
  assert.deepEqual(validateContribution(r), []);
  r.execution.experiment_ref=null;
  assert.ok(validateContribution(r).some(e=>e.includes('execution reference')));
});
test('acceptance requires a scoped owner record; credentials, names and merge links cannot supply it', () => {
  const r=fixture('engineering-pr-335'); r.stage='accepted';
  assert.ok(validateContribution(r).some(e=>e.includes('owner acceptance')));
  r.owner_decision={ref:'synthetic:owner-decision',decision:'accept',scope:'synthetic bookkeeping only',at:'2026-10-22T22:41:08Z'};
  assert.deepEqual(validateContribution(r), []); // Shape only; this does not verify the reference.
});
test('sealed holdout, explicit private artifacts and invented resource estimates fail the public format', () => {
  const r=fixture('engineering-pr-335'); r.data.split='holdout'; r.data.holdout_accessed=true;
  r.artifacts[0].visibility='private'; r.resources.elapsed_ms=1;
  const errors=validateContribution(r).join('\n');
  assert.match(errors,/data.split/); assert.match(errors,/holdout is sealed/);
  assert.match(errors,/private artifact/); assert.match(errors,/known time\/cost requires evidence/);
});

 test('uncertain attempts remain recordable without becoming performed or accepted', () => {
  const r=proposed(); r.stage='uncertain'; r.execution.status='unknown'; r.execution.experiment_ref='synthetic:lost-response-request';
  assert.deepEqual(validateContribution(r), []);
  r.stage='performed'; assert.ok(validateContribution(r).some(e=>e.includes('execution evidence')));
  r.stage='uncertain'; r.execution.experiment_ref=null;
  assert.deepEqual(validateContribution(r), [], 'missing reference remains unknown');
  r.results.outcome='success'; r.results.summary='Invented result';
  assert.ok(validateContribution(r).some(e=>e.includes('uncertain needs unknown')));
 });
 test('a failed execution cannot be relabelled as success, null or inconclusive', () => {
  for (const outcome of ['success','null','inconclusive']) {
    const r=fixture('synthetic-null'); r.execution.status='failed'; r.results.outcome=outcome;
    assert.ok(validateContribution(r).some(e=>e.includes('failed execution cannot')), outcome);
  }
 });
