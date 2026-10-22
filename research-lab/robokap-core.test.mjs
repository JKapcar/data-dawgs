// Synthetic acceptance suite for the RoboKap coordination core. Every task, key, session,
// hypothesis and receipt here is invented. No storage, network or real agent is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rkApply, rkBoard, rkWork, rkEmpty, rkParse, rkSerialize, rkDerive, sha256Hex, canonical, RK_LIMITS, RoboKapError } from './robokap-core.mjs';

const T0 = Date.parse('2026-10-22T12:00:00Z');
const owner = { kind: 'owner_session' };
const claude = { kind: 'owner_key', key_label: 'Claude' };
const grok = { kind: 'owner_key', key_label: 'Grok' };
const gemini = { kind: 'owner_key', key_label: 'Gemini' };
const reviewer = { kind: 'delegated_agent', agent_id: 'a'.repeat(32) };
const id = n => 'p_' + String(n).padStart(8, '0') + '-0000-4000-8000-000000000000';
const A = id(1), B = id(2), C = id(3), CTX = id(9);
const S1 = 'claude-code:session-one', S2 = 'claude-ai:chat-two';
const secret = n => ('lease_secret_' + n + '_').padEnd(32, 'x');
const LAB_H = 'h-synthetic-q1';

function poundFixture() {
  return {
    revision: 7,
    tasks: [
      { id: A, title: 'Audit develop data coverage', body: 'Synthetic brief A', agent_id: '', status: 'queued', archived: false, revision: 1, project_id: 'bdb-test' },
      { id: B, title: 'Draft Break Cost feature notes', body: 'Synthetic brief B', agent_id: '', status: 'queued', archived: false, revision: 1, project_id: 'bdb-test' },
      { id: C, title: 'Unplanned idea', body: 'Synthetic brief C', agent_id: '', status: 'working', status_source: 'owner_connector_reported', archived: false, revision: 1 },
    ],
    contexts: [{ id: CTX, title: 'Design of record (synthetic)', archived: false, active_version: 1, versions: [{ version: 1, title: 'v1', sha256: 'c'.repeat(64), text: 'synthetic' }] }],
    messages: [], agents: [], activity: [],
  };
}
function labFixture() {
  return {
    tenant: 'synthetic',
    hypotheses: new Map([[LAB_H, { version: 2, status: 'exploratory' }]]),
    receipts: new Map([
      ['lab-rcpt-1', { receiptHash: 'd'.repeat(64), hypothesisId: LAB_H, hypothesisVersion: 2, split: 'discovery', taskId: 'lab-task-1' }],
      ['lab-rcpt-holdout', { receiptHash: 'e'.repeat(64), hypothesisId: LAB_H, hypothesisVersion: 2, split: 'holdout', taskId: 'lab-task-2' }],
    ]),
    discussions: new Map([['lab-note-1', { hypothesisId: LAB_H, kind: 'note' }]]),
  };
}
function rig({ lab = labFixture() } = {}) {
  let rk = rkEmpty(), clock = T0, n = 0;
  const pound = poundFixture();
  const ctx = { lab };
  const apply = async (principal, op, data, requestId) => {
    const out = await rkApply(rk, pound, { op, request_id: requestId || 'req_' + String(++n).padStart(14, '0'), data }, principal, clock, ctx);
    rk = out.rk;
    // Every committed state must round-trip through the stored string form.
    rk = rkParse(rkSerialize(rk));
    return out.result;
  };
  const refused = async (principal, op, data, status, code) => {
    const before = JSON.stringify(rk);
    await assert.rejects(apply(principal, op, data), e => e instanceof RoboKapError && e.status === status && e.code === code, op + ' should fail ' + code);
    assert.equal(JSON.stringify(rk), before, 'a refused operation changes nothing');
  };
  const board = () => rkBoard(rk, pound, clock, ctx);
  const lane = async taskId => { const b = await board(); for (const [name, cards] of Object.entries({ ...b.lanes, done: b.done, closed: b.closed, unplanned: b.unplanned })) if (cards.some(c => c.task_id === taskId)) return name; return null; };
  const card = async taskId => { const b = await board(); return [...Object.values(b.lanes).flat(), ...b.done, ...b.closed, ...b.unplanned].find(c => c.task_id === taskId); };
  return { pound, ctx, apply, refused, board, lane, card, get rk() { return rk; }, set rk(v) { rk = v; }, tick: ms => { clock += ms; }, get now() { return clock; } };
}
async function claudeRole(r) {
  const role = await r.apply(owner, 'rk.role.propose', { seat: 'claude', key_label: 'Claude', role: 'BDB coordinator', scope: 'Synthetic test scope' });
  await r.apply(claude, 'rk.role.accept', { role_id: role.role_id });
  await r.apply(owner, 'rk.decide', { subject: 'role', id: role.role_id, decision: 'approve' });
  return role.role_id;
}
async function standardPlans(r, { aReview = 'advisory', bExtra = {} } = {}) {
  const pin = await r.apply(owner, 'rk.pin', { project_id: 'bdb-test', kind: 'design_of_record', status: 'draft', ref: { type: 'pound_context', context_id: CTX, version: 1 } });
  await r.apply(owner, 'rk.plan', { task_id: A, expected_plan_version: 0, seat: 'claude', review: aReview, decision: 'required', data_scope: 'development', pin: { kind: 'design_of_record', version: pin.pin.version, require: 'any' }, acceptance: [{ text: 'Coverage table attached' }] });
  await r.apply(owner, 'rk.plan', { task_id: B, expected_plan_version: 0, seat: 'claude', review: 'none', decision: 'required', data_scope: 'synthetic', depends_on: [A], ...bExtra });
  return pin;
}
const claimA = (r, who = claude, session = S1, s = secret(1), extra = {}) => r.apply(who, 'rk.claim', { task_id: A, plan_version: 1, pin_version: 1, session_ref: session, lease_secret: s, ...extra });
const reportA = (r, claim, extra = {}, who = claude, s = secret(1)) => r.apply(who, 'rk.report', { task_id: A, claim_id: claim.claim_id, lease_secret: s, outcome: 'succeeded', summary: 'Synthetic coverage audit complete.', artifacts: [{ kind: 'pound_context', ref: CTX + '@1' }, { kind: 'github_commit', ref: 'https://github.com/JKapcar/data-dawgs/commit/' + 'f'.repeat(40) }], ...extra });

test('complete workflow: A is claimed, evidenced, reviewed and accepted before B becomes eligible', async () => {
  const r = rig();
  await claudeRole(r);
  await standardPlans(r);
  assert.equal(await r.lane(A), 'ready');
  assert.equal(await r.lane(B), 'blocked');
  assert.deepEqual((await r.card(B)).reasons.map(x => x.code), ['waiting_dependency']);
  const work = await rkWork(r.rk, r.pound, r.now, r.ctx, { key_label: 'Claude', session_ref: S1 });
  assert.deepEqual(work.ready.map(t => t.task_id), [A]);
  assert.equal(work.identity.model_identity, 'unverified');
  const claim = await claimA(r);
  assert.equal(claim.attempt, 1);
  assert.equal(await r.lane(A), 'running');
  assert.match((await r.card(A)).next.text, /Progress is unverified until a receipt/);
  const receipt = await reportA(r, claim);
  assert.equal(receipt.validity, 'current');
  assert.deepEqual(receipt.artifacts.map(a => a.verification), ['server_verified', 'format_checked']);
  assert.equal(await r.lane(A), 'review');
  assert.equal(await r.lane(B), 'blocked', 'B stays blocked while A waits for review');
  await r.apply(grok, 'rk.review', { receipt_id: receipt.receipt_id, verdict: 'accept', note: 'Advisory synthetic review' });
  assert.equal(await r.lane(A), 'needs_you');
  assert.deepEqual((await r.card(A)).reasons.map(x => x.code), ['decide_receipt']);
  assert.equal(await r.lane(B), 'blocked', 'B stays blocked until the owner decides A');
  await r.apply(owner, 'rk.decide', { subject: 'receipt', id: receipt.receipt_id, decision: 'accept' });
  assert.equal(await r.lane(A), 'done');
  assert.equal(await r.lane(B), 'ready', 'eligibility recomputed once A has current-version evidence and approvals');
  const next = await rkWork(r.rk, r.pound, r.now, r.ctx, { key_label: 'Claude', session_ref: S1 });
  assert.deepEqual(next.ready.map(t => t.task_id), [B], 'the same session continues to the next eligible task');
  const cb = await r.apply(claude, 'rk.claim', { task_id: B, plan_version: 1, session_ref: S1, lease_secret: secret(2) });
  const rb = await r.apply(claude, 'rk.report', { task_id: B, claim_id: cb.claim_id, lease_secret: secret(2), outcome: 'succeeded', summary: 'Synthetic notes drafted.', artifacts: [{ kind: 'note', note: 'Draft lives in the synthetic thread.' }] });
  assert.equal(await r.lane(B), 'needs_you');
  await r.apply(owner, 'rk.decide', { subject: 'receipt', id: rb.receipt_id, decision: 'accept' });
  assert.equal(await r.lane(B), 'done');
  const evidence = (await r.card(A)).evidence;
  assert.equal(evidence.review.mode, 'advisory');
  assert.equal(evidence.decision.decision, 'accept');
  assert.equal((await r.card(A)).last_verified.op, 'rk.decide');
});

test('B stays blocked through every partial or stale state of A', async () => {
  const r = rig();
  await claudeRole(r);
  await standardPlans(r);
  const claim = await claimA(r);
  assert.equal(await r.lane(B), 'blocked');
  const receipt = await reportA(r, claim);
  assert.equal(await r.lane(B), 'blocked');
  await r.apply(grok, 'rk.review', { receipt_id: receipt.receipt_id, verdict: 'accept' });
  assert.equal(await r.lane(B), 'blocked');
  await r.apply(owner, 'rk.decide', { subject: 'receipt', id: receipt.receipt_id, decision: 'accept' });
  assert.equal(await r.lane(B), 'ready');
  // The owner edits A's brief: A's acceptance no longer describes the current task.
  r.pound.tasks.find(t => t.id === A).body = 'Synthetic brief A, revised';
  assert.equal(await r.lane(A), 'needs_you');
  assert.ok((await r.card(A)).reasons.some(x => x.code === 'task_changed'));
  assert.equal(await r.lane(B), 'blocked', 'stale dependency blocks B again');
  r.pound.tasks.find(t => t.id === A).body = 'Synthetic brief A';
  assert.equal(await r.lane(B), 'ready');
  // A newer design-of-record pin makes A's evidence stale until its plan is amended.
  await r.apply(owner, 'rk.pin', { project_id: 'bdb-test', kind: 'design_of_record', status: 'approved', ref: { type: 'claude_doc', id: 'SyntheticDocId00000000', rev: 46 } });
  assert.equal(await r.lane(A), 'needs_you');
  assert.ok((await r.card(A)).reasons.some(x => x.code === 'pin_superseded'));
  assert.equal(await r.lane(B), 'blocked');
  // Status-only Pound edits do not invalidate evidence.
  r.pound.tasks.find(t => t.id === B).status = 'working';
  assert.equal((await r.card(B)).reported.status, 'working');
  assert.match((await r.card(B)).reported.note, /no execution receipt/);
});

test('duplicate claims: one lease per task, replay is idempotent, renew needs the same secret', async () => {
  const r = rig();
  await claudeRole(r);
  await standardPlans(r);
  const first = await claimA(r, claude, S1, secret(1), {});
  await r.refused(claude, 'rk.claim', { task_id: A, plan_version: 1, pin_version: 1, session_ref: S2, lease_secret: secret(2) }, 409, 'already_claimed');
  await r.refused(claude, 'rk.claim', { task_id: A, plan_version: 1, pin_version: 1, session_ref: S1, lease_secret: secret(3) }, 409, 'already_claimed');
  const replay = await r.apply(claude, 'rk.claim', { task_id: A, plan_version: 1, pin_version: 1, session_ref: S1, lease_secret: secret(9) }, 'req_claim_replay_0001').catch(e => e);
  assert.equal(replay.code, 'already_claimed');
  r.tick(10 * 60000);
  const renewed = await claimA(r, claude, S1, secret(1));
  assert.equal(renewed.renewed, true);
  assert.equal(renewed.claim_id, first.claim_id);
  assert.ok(Date.parse(renewed.expires_at) > Date.parse(first.expires_at));
  assert.equal(r.rk.claims.length, 1);
  // An identical resend after a lost response replays without a second lease.
  const r2 = rig();
  await claudeRole(r2);
  await standardPlans(r2);
  const body = { task_id: A, plan_version: 1, pin_version: 1, session_ref: S1, lease_secret: secret(1) };
  const a = await r2.apply(claude, 'rk.claim', body, 'req_same_claim_000001');
  const b = await r2.apply(claude, 'rk.claim', body, 'req_same_claim_000001');
  assert.equal(b.replayed, true);
  assert.equal(b.claim_id, a.claim_id);
  assert.equal(r2.rk.claims.length, 1);
  await r2.refused(claude, 'rk.claim', { ...body, session_ref: S2 }, 409, 'already_claimed');
  await assert.rejects(r2.apply(claude, 'rk.claim', { ...body, lease_secret: secret(5) }, 'req_same_claim_000001'), e => e.code === 'idempotency_conflict');
});

test('lost responses: identical report resend replays; a new request id never doubles evidence', async () => {
  const r = rig();
  await claudeRole(r);
  await standardPlans(r);
  const claim = await claimA(r);
  const body = { task_id: A, claim_id: claim.claim_id, lease_secret: secret(1), outcome: 'succeeded', summary: 'Synthetic result' };
  const first = await r.apply(claude, 'rk.report', body, 'req_report_lost_00001');
  const again = await r.apply(claude, 'rk.report', body, 'req_report_lost_00001');
  assert.equal(again.replayed, true);
  assert.equal(again.receipt_id, first.receipt_id);
  await r.refused(claude, 'rk.report', body, 409, 'already_reported');
  assert.equal(r.rk.receipts.length, 1);
  // Receipts form a verifiable hash chain.
  const [rc] = r.rk.receipts;
  const { hash, ...rest } = rc;
  assert.equal(await sha256Hex(canonical(rest)), hash);
});

test('stale versions stop claims and make mid-lease evidence stale instead of counting', async () => {
  const r = rig();
  await claudeRole(r);
  await standardPlans(r);
  await r.refused(claude, 'rk.claim', { task_id: A, plan_version: 0, pin_version: 1, session_ref: S1, lease_secret: secret(1) }, 409, 'stale_plan');
  await r.refused(claude, 'rk.claim', { task_id: A, plan_version: 1, pin_version: 0, session_ref: S1, lease_secret: secret(1) }, 409, 'stale_context');
  // Context gains a newer version than the pin: work waits for the owner.
  r.pound.contexts[0].versions.push({ version: 2, title: 'v2', sha256: '9'.repeat(64), text: 'synthetic v2' });
  assert.ok((await r.card(A)).reasons.some(x => x.code === 'pin_behind_context'));
  await r.refused(claude, 'rk.claim', { task_id: A, plan_version: 1, pin_version: 1, session_ref: S1, lease_secret: secret(1) }, 409, 'not_eligible');
  r.pound.contexts[0].versions.pop();
  const claim = await claimA(r);
  // The owner re-pins during the lease: the receipt is recorded, labelled stale and not counted.
  await r.apply(owner, 'rk.pin', { project_id: 'bdb-test', kind: 'design_of_record', status: 'approved', ref: { type: 'pound_context', context_id: CTX, version: 1 } });
  const stale = await reportA(r, claim);
  assert.equal(stale.validity, 'stale');
  assert.equal(await r.lane(A), 'needs_you');
  assert.equal(await r.lane(B), 'blocked');
  // Approving a new plan version mid-lease closes the old lease.
  await r.apply(owner, 'rk.plan', { task_id: A, expected_plan_version: 1, seat: 'claude', review: 'none', decision: 'not_required', data_scope: 'development', pin: { kind: 'design_of_record', version: 2, require: 'approved' } });
  const c2 = await r.apply(claude, 'rk.claim', { task_id: A, plan_version: 2, pin_version: 2, session_ref: S1, lease_secret: secret(4) });
  await r.apply(owner, 'rk.plan', { task_id: A, expected_plan_version: 2, seat: 'claude', review: 'none', decision: 'not_required', data_scope: 'development', pin: { kind: 'design_of_record', version: 2, require: 'approved' }, note: 'Amended mid-lease' });
  await r.refused(claude, 'rk.report', { task_id: A, claim_id: c2.claim_id, lease_secret: secret(4), outcome: 'succeeded', summary: 'x' }, 409, 'claim_superseded');
  assert.equal(r.rk.plans.filter(p => p.task_id === A).map(p => p.status).join(','), 'superseded,superseded,approved', 'amendments are recorded, never overwritten');
});

test('lease expiry returns work; a late result is refused once another attempt started', async () => {
  const r = rig();
  await claudeRole(r);
  await standardPlans(r);
  const c1 = await claimA(r, claude, S1, secret(1));
  r.tick(31 * 60000);
  assert.equal(await r.lane(A), 'ready', 'an expired lease is not running');
  const c2 = await claimA(r, claude, S2, secret(2));
  assert.equal(c2.attempt, 2);
  await r.refused(claude, 'rk.report', { task_id: A, claim_id: c1.claim_id, lease_secret: secret(1), outcome: 'succeeded', summary: 'late' }, 409, 'lease_superseded');
  // Without a newer attempt, a late report is kept and labelled late.
  const r2 = rig();
  await claudeRole(r2);
  await standardPlans(r2);
  const c = await claimA(r2);
  r2.tick(45 * 60000);
  const late = await reportA(r2, c);
  assert.equal(late.late, true);
  assert.equal(late.validity, 'current');
  assert.equal((await r2.card(A)).evidence.late, true);
});

test('unauthorized principals are refused before any state changes', async () => {
  const r = rig();
  const roleId = await claudeRole(r);
  await standardPlans(r);
  await r.refused(claude, 'rk.decide', { subject: 'role', id: roleId, decision: 'revoke' }, 403, 'owner_session_required');
  await r.refused(grok, 'rk.pin', { project_id: 'bdb-test', kind: 'sourcebook', status: 'approved', ref: { type: 'claude_doc', id: 'SyntheticDocId00000000', rev: 1 } }, 403, 'owner_session_required');
  await r.refused(gemini, 'rk.claim', { task_id: A, plan_version: 1, pin_version: 1, session_ref: S1, lease_secret: secret(1) }, 403, 'target_mismatch');
  await r.refused(owner, 'rk.claim', { task_id: A, plan_version: 1, pin_version: 1, session_ref: S1, lease_secret: secret(1) }, 403, 'target_mismatch');
  await r.refused(reviewer, 'rk.claim', { task_id: A, plan_version: 1, pin_version: 1, session_ref: S1, lease_secret: secret(1) }, 403, 'delegated_agents_not_connected_to_robokap');
  await r.refused({ kind: 'owner_key', key_label: 'bad label!' }, 'rk.plan', {}, 401, 'verified_principal_required');
  await r.refused({ kind: 'anonymous' }, 'rk.claim', {}, 401, 'verified_principal_required');
  const claim = await claimA(r);
  await r.refused(grok, 'rk.report', { task_id: A, claim_id: claim.claim_id, lease_secret: secret(1), outcome: 'succeeded', summary: 'steal' }, 403, 'claimant_mismatch');
  await r.refused(claude, 'rk.report', { task_id: A, claim_id: claim.claim_id, lease_secret: secret(7), outcome: 'succeeded', summary: 'wrong secret' }, 403, 'lease_secret_mismatch');
  await r.refused(claude, 'rk.release', { task_id: A, claim_id: claim.claim_id, lease_secret: secret(7) }, 403, 'lease_secret_mismatch');
  const receipt = await reportA(r, claim);
  await r.refused(owner, 'rk.review', { receipt_id: receipt.receipt_id, verdict: 'accept' }, 403, 'owner_uses_decide');
  await r.refused(claude, 'rk.review', { receipt_id: receipt.receipt_id, verdict: 'accept' }, 403, 'self_review');
  // A connector-proposed plan is only a proposal, even for the task it would unblock.
  await r.apply(claude, 'rk.plan', { task_id: B, expected_plan_version: 1, seat: 'claude', review: 'none', decision: 'not_required', data_scope: 'synthetic' });
  assert.equal(await r.lane(B), 'needs_you', 'the proposal waits for the owner');
  assert.deepEqual((await r.card(B)).reasons.map(x => x.code), ['plan_amendment_proposed', 'waiting_dependency'], 'the approved plan, with its dependency on A, stays in force');
  await r.refused(claude, 'rk.claim', { task_id: B, plan_version: 2, session_ref: S1, lease_secret: secret(5) }, 409, 'stale_plan');
});

test('mismatched target sessions cannot take each other\'s work', async () => {
  const r = rig();
  await claudeRole(r);
  await r.apply(owner, 'rk.plan', { task_id: C, expected_plan_version: 0, seat: 'claude', session_ref: 'claude-code:pilot', review: 'none', decision: 'not_required', data_scope: 'none' });
  await r.refused(claude, 'rk.claim', { task_id: C, plan_version: 1, session_ref: 'claude-ai:other', lease_secret: secret(1) }, 403, 'session_mismatch');
  const other = await rkWork(r.rk, r.pound, r.now, r.ctx, { key_label: 'Claude', session_ref: 'claude-ai:other' });
  assert.deepEqual(other.ready, []);
  assert.deepEqual(other.targeted_to_other_sessions.map(t => t.task_id), [C]);
  const pilot = await rkWork(r.rk, r.pound, r.now, r.ctx, { key_label: 'Claude', session_ref: 'claude-code:pilot' });
  assert.deepEqual(pilot.ready.map(t => t.task_id), [C]);
  const grokView = await rkWork(r.rk, r.pound, r.now, r.ctx, { key_label: 'Grok', session_ref: 'x' });
  assert.deepEqual(grokView.ready, [], 'another key never sees a seat it does not hold');
  const claim = await r.apply(claude, 'rk.claim', { task_id: C, plan_version: 1, session_ref: 'claude-code:pilot', lease_secret: secret(1) });
  assert.equal(claim.attempt, 1);
});

test('uncertain outcomes stop retries until the owner reconciles them', async () => {
  const r = rig();
  await claudeRole(r);
  await standardPlans(r);
  const c1 = await claimA(r);
  const unsure = await reportA(r, c1, { outcome: 'uncertain', summary: 'Post may or may not have landed', artifacts: [] });
  assert.equal(await r.lane(A), 'needs_you');
  assert.deepEqual((await r.card(A)).reasons.map(x => x.code), ['reconcile_uncertain']);
  await r.refused(claude, 'rk.claim', { task_id: A, plan_version: 1, pin_version: 1, session_ref: S1, lease_secret: secret(2) }, 409, 'not_eligible');
  await r.apply(owner, 'rk.decide', { subject: 'uncertain', id: unsure.receipt_id, decision: 'not_landed' });
  assert.equal(await r.lane(A), 'ready');
  const c2 = await claimA(r, claude, S1, secret(2));
  assert.equal(c2.attempt, 2);
  const unsure2 = await reportA(r, c2, { outcome: 'uncertain', summary: 'Second attempt unclear' }, claude, secret(2));
  await r.apply(owner, 'rk.decide', { subject: 'uncertain', id: unsure2.receipt_id, decision: 'landed' });
  assert.equal(await r.lane(A), 'review', 'a landed outcome still needs its review');
});

test('shared-owner reviews never satisfy an independent-review requirement', async () => {
  const r = rig();
  await claudeRole(r);
  await standardPlans(r, { aReview: 'independent' });
  const receipt = await reportA(r, await claimA(r));
  assert.match((await r.card(A)).reasons[0].text, /independent reviewer/);
  for (const key of [grok, gemini]) {
    const out = await r.apply(key, 'rk.review', { receipt_id: receipt.receipt_id, verdict: 'accept' });
    assert.equal(out.mode, 'advisory');
    assert.equal(out.satisfies_independent, false);
  }
  assert.equal(await r.lane(A), 'review');
  await r.refused(owner, 'rk.decide', { subject: 'receipt', id: receipt.receipt_id, decision: 'accept' }, 409, 'review_not_satisfied');
  // A separate agent credential (modelled here; not wired to RoboKap) is what independence takes.
  const independent = await r.apply(reviewer, 'rk.review', { receipt_id: receipt.receipt_id, verdict: 'accept' });
  assert.equal(independent.mode, 'independent');
  await r.apply(owner, 'rk.decide', { subject: 'receipt', id: receipt.receipt_id, decision: 'accept' });
  assert.equal(await r.lane(A), 'done');
});

test('roles: proposal, acceptance by the seat\'s own key, and owner approval stay separate', async () => {
  const r = rig();
  const role = await r.apply(claude, 'rk.role.propose', { seat: 'gemini', key_label: 'Gemini', role: 'Methodology red-team', scope: 'Synthetic' });
  assert.equal(role.state, 'proposed', 'a sign-up through any connector is only a proposal');
  await r.refused(owner, 'rk.role.accept', { role_id: role.role_id }, 403, 'acceptance_must_come_from_the_seat_key');
  await r.refused(claude, 'rk.role.accept', { role_id: role.role_id }, 403, 'acceptance_must_come_from_the_seat_key');
  await r.refused(owner, 'rk.decide', { subject: 'role', id: role.role_id, decision: 'approve' }, 409, 'role_not_accepted');
  const accepted = await r.apply(gemini, 'rk.role.accept', { role_id: role.role_id });
  assert.equal(accepted.state, 'accepted');
  const b = await r.board();
  assert.equal(b.role_decisions.length, 1);
  assert.equal(b.roles[0].acceptance.tier, 'key_attested');
  await r.apply(owner, 'rk.decide', { subject: 'role', id: role.role_id, decision: 'approve' });
  assert.equal((await r.board()).roles[0].state, 'effective');
  await r.refused(owner, 'rk.role.propose', { seat: 'gemini', key_label: 'Other', role: 'Second key' }, 409, 'seat_key_conflict');
  await r.refused(owner, 'rk.role.propose', { seat: 'grok', key_label: 'Gemini', role: 'Key reuse' }, 409, 'key_serves_another_seat');
  // Plan for a seat whose role is only proposed: blocked on the seat, never silently assigned.
  const grokRole = await r.apply(owner, 'rk.role.propose', { seat: 'grok', key_label: 'Grok', role: 'Synthetic reviewer' });
  await r.apply(owner, 'rk.plan', { task_id: C, expected_plan_version: 0, seat: 'grok', review: 'none', decision: 'not_required', data_scope: 'none' });
  assert.equal(await r.lane(C), 'blocked');
  assert.deepEqual((await r.card(C)).reasons.map(x => x.code), ['awaiting_role_acceptance']);
  await r.apply(grok, 'rk.role.accept', { role_id: grokRole.role_id });
  assert.deepEqual((await r.card(C)).reasons.map(x => x.code), ['approve_role']);
  assert.equal(await r.lane(C), 'needs_you');
});

test('dependency cycles are rejected at plan time and caught when Pound edits create one later', async () => {
  const r = rig();
  await claudeRole(r);
  await r.apply(owner, 'rk.plan', { task_id: A, expected_plan_version: 0, seat: 'claude', review: 'none', decision: 'not_required', data_scope: 'none', depends_on: [B] });
  await r.refused(owner, 'rk.plan', { task_id: B, expected_plan_version: 0, seat: 'claude', review: 'none', decision: 'not_required', data_scope: 'none', depends_on: [A] }, 400, 'dependency_cycle');
  await r.apply(owner, 'rk.plan', { task_id: B, expected_plan_version: 0, seat: 'claude', review: 'none', decision: 'not_required', data_scope: 'none' });
  assert.equal(await r.lane(A), 'blocked');
  // Pound's own `blocks` list now says A blocks B, closing a loop outside RoboKap.
  r.pound.tasks.find(t => t.id === A).blocks = [B];
  assert.ok((await r.card(A)).reasons.some(x => x.code === 'dependency_cycle'));
  assert.ok((await r.card(B)).reasons.some(x => x.code === 'dependency_cycle'));
  await r.refused(owner, 'rk.plan', { task_id: A, expected_plan_version: 0, seat: 'claude', review: 'none', decision: 'not_required', data_scope: 'none' }, 409, 'plan_version_conflict');
  await r.refused(owner, 'rk.plan', { task_id: A, expected_plan_version: 1, seat: 'claude', review: 'none', decision: 'not_required', data_scope: 'none', depends_on: [A] }, 400, 'self_dependency');
});

test('budget limits stop retries until the owner extends them', async () => {
  const r = rig();
  await claudeRole(r);
  await r.apply(owner, 'rk.plan', { task_id: C, expected_plan_version: 0, seat: 'claude', review: 'none', decision: 'not_required', data_scope: 'none', budget: { attempts: 1, lease_minutes: 5 } });
  const c = await r.apply(claude, 'rk.claim', { task_id: C, plan_version: 1, session_ref: S1, lease_secret: secret(1) });
  await r.apply(claude, 'rk.report', { task_id: C, claim_id: c.claim_id, lease_secret: secret(1), outcome: 'failed', summary: 'Synthetic failure' });
  assert.equal(await r.lane(C), 'needs_you');
  assert.deepEqual((await r.card(C)).reasons.map(x => x.code), ['budget_exhausted']);
  await r.refused(claude, 'rk.claim', { task_id: C, plan_version: 1, session_ref: S1, lease_secret: secret(2) }, 409, 'not_eligible');
  await r.apply(owner, 'rk.decide', { subject: 'budget', id: C, plan_version: 1, decision: 'extend', attempts: 1 });
  assert.equal(await r.lane(C), 'ready');
  const c2 = await r.apply(claude, 'rk.claim', { task_id: C, plan_version: 1, session_ref: S1, lease_secret: secret(2) });
  assert.equal(c2.attempt, 2);
  await r.apply(claude, 'rk.report', { task_id: C, claim_id: c2.claim_id, lease_secret: secret(2), outcome: 'succeeded', summary: 'Second attempt' });
  assert.equal(await r.lane(C), 'done', 'review none and decision not_required accept on a current receipt');
});

test('Pound–Lab contract: links are read-only checks, stale links stop work and the holdout stays sealed', async () => {
  const r = rig();
  await claudeRole(r);
  await r.refused(owner, 'rk.plan', { task_id: A, expected_plan_version: 0, seat: 'claude', review: 'none', decision: 'not_required', data_scope: 'holdout' }, 400, 'invalid_data_scope');
  await r.refused(owner, 'rk.plan', { task_id: A, expected_plan_version: 0, seat: 'claude', review: 'none', decision: 'not_required', data_scope: 'none', lab: { hypothesis_id: 'missing', hypothesis_version: 1, evidence: 'optional' } }, 409, 'lab_hypothesis_not_found');
  await r.apply(owner, 'rk.plan', { task_id: A, expected_plan_version: 0, seat: 'claude', review: 'none', decision: 'not_required', data_scope: 'synthetic', lab: { hypothesis_id: LAB_H, hypothesis_version: 2, evidence: 'required' } });
  assert.equal(await r.lane(A), 'ready');
  const labBefore = JSON.stringify([...r.ctx.lab.receipts]);
  const c = await r.apply(claude, 'rk.claim', { task_id: A, plan_version: 1, session_ref: S1, lease_secret: secret(1) });
  assert.equal(JSON.stringify([...r.ctx.lab.receipts]), labBefore, 'claiming coordination work launches nothing in the Lab');
  await r.refused(claude, 'rk.report', { task_id: A, claim_id: c.claim_id, lease_secret: secret(1), outcome: 'succeeded', summary: 'No Lab evidence' }, 409, 'lab_evidence_required');
  await r.refused(claude, 'rk.report', { task_id: A, claim_id: c.claim_id, lease_secret: secret(1), outcome: 'succeeded', summary: 'Holdout', artifacts: [{ kind: 'lab_receipt', ref: 'lab-rcpt-holdout', sha256: 'e'.repeat(64) }] }, 403, 'holdout_sealed');
  await r.refused(claude, 'rk.report', { task_id: A, claim_id: c.claim_id, lease_secret: secret(1), outcome: 'succeeded', summary: 'Bad hash', artifacts: [{ kind: 'lab_receipt', ref: 'lab-rcpt-1', sha256: '0'.repeat(64) }] }, 400, 'artifact_hash_mismatch');
  const ok = await r.apply(claude, 'rk.report', { task_id: A, claim_id: c.claim_id, lease_secret: secret(1), outcome: 'succeeded', summary: 'Linked Lab receipt', artifacts: [{ kind: 'lab_receipt', ref: 'lab-rcpt-1', sha256: 'd'.repeat(64) }, { kind: 'lab_discussion', ref: 'lab-note-1' }] });
  assert.deepEqual(ok.artifacts.map(a => a.verification), ['server_verified', 'server_verified']);
  assert.equal(await r.lane(A), 'done');
  // The Lab moves on: the hypothesis is revised, so the link and everything resting on it go stale.
  r.ctx.lab.hypotheses.set(LAB_H, { version: 3, status: 'exploratory' });
  assert.ok((await r.card(A)).reasons.some(x => x.code === 'lab_link_stale'));
  // Lab unavailable: work waits instead of guessing.
  r.ctx.lab = null;
  assert.equal(await r.lane(A), 'blocked');
  assert.ok((await r.card(A)).reasons.some(x => x.code === 'lab_unverifiable'));
});

test('owner-seat tasks land in Needs You and carry owner evidence', async () => {
  const r = rig();
  await r.apply(owner, 'rk.plan', { task_id: C, expected_plan_version: 0, seat: 'owner', review: 'none', decision: 'not_required', data_scope: 'none', acceptance: [{ text: 'Rules accepted on Kaggle' }] });
  assert.equal(await r.lane(C), 'needs_you');
  assert.deepEqual((await r.card(C)).reasons.map(x => x.code), ['owner_task']);
  await r.refused(claude, 'rk.claim', { task_id: C, plan_version: 1, session_ref: S1, lease_secret: secret(1) }, 403, 'target_mismatch');
  const c = await r.apply(owner, 'rk.claim', { task_id: C, plan_version: 1, lease_secret: secret(1) });
  await r.apply(owner, 'rk.report', { task_id: C, claim_id: c.claim_id, lease_secret: secret(1), outcome: 'succeeded', summary: 'Done by hand', artifacts: [{ kind: 'url', ref: 'https://www.kaggle.com/competitions/example' }] });
  assert.equal(await r.lane(C), 'done');
});

test('Discord thread references must match the planned thread', async () => {
  const r = rig();
  await claudeRole(r);
  await r.apply(owner, 'rk.plan', { task_id: C, expected_plan_version: 0, seat: 'claude', review: 'none', decision: 'not_required', data_scope: 'none', thread: { discord_thread_id: '111111111111111111' } });
  const c = await r.apply(claude, 'rk.claim', { task_id: C, plan_version: 1, session_ref: S1, lease_secret: secret(1) });
  const wrong = 'https://discord.com/channels/222222222222222222/333333333333333333/444444444444444444';
  await r.refused(claude, 'rk.report', { task_id: C, claim_id: c.claim_id, lease_secret: secret(1), outcome: 'succeeded', summary: 'x', artifacts: [{ kind: 'discord_message', ref: wrong }] }, 400, 'thread_mismatch');
  const right = 'https://discord.com/channels/222222222222222222/111111111111111111/444444444444444444';
  const out = await r.apply(claude, 'rk.report', { task_id: C, claim_id: c.claim_id, lease_secret: secret(1), outcome: 'succeeded', summary: 'x', artifacts: [{ kind: 'discord_message', ref: right }] });
  assert.deepEqual(out.artifacts, [{ kind: 'discord_message', verification: 'format_checked' }]);
});

test('unplanned Pound work stays reported only; nothing is inferred from a status', async () => {
  const r = rig();
  const b = await r.board();
  assert.deepEqual(b.unplanned.map(c => c.task_id).sort(), [A, B, C].sort());
  const c = b.unplanned.find(x => x.task_id === C);
  assert.equal(c.reported.status, 'working');
  assert.equal(c.reported.source, 'owner_connector_reported');
  assert.match(c.reported.note, /no execution receipt/);
  for (const lane of Object.values(b.lanes)) assert.deepEqual(lane, []);
  assert.ok(b.honesty.some(h => /Running means a lease is held/.test(h)));
});

test('request hygiene: unknown ops, fields and oversized bodies fail closed; capacity is bounded', async () => {
  const r = rig();
  await r.refused(owner, 'rk.nope', {}, 400, 'unknown_operation');
  await r.refused(owner, 'rk.pin', { project_id: 'bdb-test', kind: 'design_of_record', status: 'draft', ref: { type: 'claude_doc', id: 'SyntheticDocId00000000', rev: 1 }, owner_uid: 'u_x' }, 400, 'unknown_field');
  await r.refused(owner, 'rk.pin', { project_id: 'bdb-test', kind: 'design_of_record', status: 'draft', ref: { type: 'repo_file', path: '../etc/passwd', commit: 'a'.repeat(40), sha256: 'b'.repeat(64) } }, 400, 'invalid_pin_ref');
  await r.refused(owner, 'rk.pin', { project_id: 'bdb-test', kind: 'design_of_record', status: 'draft', ref: { type: 'claude_doc', id: 'x'.repeat(30000), rev: 1 } }, 413, 'request_too_large');
  await assert.rejects(rkApply(rkEmpty(), poundFixture(), { op: 'rk.pin', request_id: 'short', data: {} }, owner, T0), e => e.code === 'request_id_required');
  const full = rkEmpty();
  for (let i = 0; i < RK_LIMITS.pins; i++) full.pins.push({ id: 'pin_x', project_id: 'p' + i, kind: 'context', version: 1, status: 'draft', ref: { type: 'claude_doc', id: 'SyntheticDocId00000000', rev: 1 } });
  await assert.rejects(rkApply(full, poundFixture(), { op: 'rk.pin', request_id: 'req_capacity_000001', data: { project_id: 'bdb-test', kind: 'sourcebook', status: 'approved', ref: { type: 'claude_doc', id: 'SyntheticDocId00000000', rev: 1 } } }, owner, T0), e => e.status === 409 && e.code === 'robokap_capacity');
  assert.throws(() => rkParse('{"v":2}'), e => e.code === 'robokap_store_invalid');
  assert.deepEqual(rkParse(undefined), rkEmpty());
});

test('derivation is deterministic and never writes', async () => {
  const r = rig();
  await claudeRole(r);
  await standardPlans(r);
  const before = JSON.stringify(r.rk);
  const one = await rkDerive(r.rk, r.pound, r.now, r.ctx);
  const two = await rkDerive(r.rk, r.pound, r.now, r.ctx);
  assert.deepEqual([...one.tasks.keys()], [...two.tasks.keys()]);
  assert.deepEqual([...one.tasks.values()].map(d => d.lane), [...two.tasks.values()].map(d => d.lane));
  assert.equal(JSON.stringify(r.rk), before);
});

test('amendments reach the owner without silently undoing accepted work; stale evidence cannot be accepted', async () => {
  const r = rig();
  await claudeRole(r);
  await standardPlans(r);
  const receipt = await reportA(r, await claimA(r));
  await r.apply(grok, 'rk.review', { receipt_id: receipt.receipt_id, verdict: 'accept' });
  // The brief changes before the owner decides: accepting that receipt would describe old work.
  r.pound.tasks.find(t => t.id === A).body = 'Synthetic brief A, changed before the decision';
  assert.ok(!(await r.card(A)).reasons.some(x => x.code === 'decide_receipt'), 'no accept prompt for stale evidence');
  await r.refused(owner, 'rk.decide', { subject: 'receipt', id: receipt.receipt_id, decision: 'accept' }, 409, 'receipt_not_current_version');
  r.pound.tasks.find(t => t.id === A).body = 'Synthetic brief A';
  await r.apply(owner, 'rk.decide', { subject: 'receipt', id: receipt.receipt_id, decision: 'accept' });
  assert.equal(await r.lane(A), 'done');
  // A connector proposes an amendment to accepted work: it lands in Needs You, and B stays eligible.
  await r.apply(claude, 'rk.plan', { task_id: A, expected_plan_version: 1, seat: 'claude', review: 'none', decision: 'not_required', data_scope: 'none' });
  assert.equal(await r.lane(A), 'needs_you');
  assert.deepEqual((await r.card(A)).reasons.map(x => x.code), ['plan_amendment_proposed']);
  assert.equal(await r.lane(B), 'ready', 'accepted evidence still stands until the owner approves a new version');
  await r.apply(owner, 'rk.decide', { subject: 'plan', id: A, plan_version: 2, decision: 'reject' });
  assert.equal(await r.lane(A), 'done');
});

test('a seat never binds to the shared primary key', async () => {
  const r = rig();
  for (const label of ['primary', 'Primary', 'PRIMARY']) {
    await r.refused(owner, 'rk.role.propose', { seat: 'claude', key_label: label, role: 'Shared key seat' }, 409, 'shared_primary_key_not_allowed');
    await r.refused(grok, 'rk.role.propose', { seat: 'claude', key_label: label, role: 'Shared key seat' }, 409, 'shared_primary_key_not_allowed');
  }
  const role = await r.apply(owner, 'rk.role.propose', { seat: 'claude', key_label: 'Claude', role: 'Own key seat' });
  await r.refused({ kind: 'owner_key', key_label: 'primary' }, 'rk.role.accept', { role_id: role.role_id }, 403, 'acceptance_must_come_from_the_seat_key');
});
