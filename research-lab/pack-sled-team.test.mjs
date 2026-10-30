// Pack Sled team suite: scoped seat credentials, automatic routine collaboration inside an approved
// playbook, credential lifecycle, recovery, the board as the source of truth, and failure-only
// alerts. Everything here is synthetic: ids, briefs, credentials, sources and clocks are invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rkApply, rkBoard, rkWork, rkAlerts, rkEmpty, rkParse, rkSerialize, sha256Hex, RoboKapError, RK_AGENT_OPS, RK_OPS } from './robokap-core.mjs';
import { createRunner, memoryJournal, RunnerPaused, LeaseLost } from './pack-sled-runner.mjs';

const T0 = Date.parse('2026-10-31T15:00:00Z'), MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const owner = { kind: 'owner_session' };
const primary = { kind: 'owner_key', key_label: 'primary' };
const agent = (n, seat, scopes, label) => ({ kind: 'delegated_agent', agent_id: String(n).repeat(32).slice(0, 32), seat, scopes, label });
// The label a credential carries is display text. A label that sounds powerful grants nothing.
const coordinator = agent(1, 'coordinator', ['sled:work:read', 'sled:coordinate'], 'Claude coordinator');
const research = agent(2, 'claude', ['sled:work:read', 'sled:work:claim'], 'Claude research');
const reviewer = agent(3, 'claude-reviewer', ['sled:work:read', 'sled:review'], 'Claude review');
const impostor = agent(4, 'grok', ['sled:work:read', 'sled:work:claim', 'sled:review'], 'PackResearch owner admin');
const id = n => 'p_' + String(n).padStart(8, '0') + '-0000-4000-8000-000000000000';
const TR = id(2), OTHER = id(3), SAVED = id(4), BRIEF = id(12);
const RS = 'claude-code:research', VS = 'claude-code:review', CS = 'claude-code:coordinator';
const BRIEF_TEXT = 'Synthetic Total Rewards brief v1: public read-only sourcing; nobody contacted.';
const ACCEPT = [{ text: 'Every claim cites a public source and when it was seen' }, { text: 'Gaps are listed instead of guessed' }];
const secret = n => 'lease_secret_' + String(n).padStart(12, '0');
const sha = async s => sha256Hex(s);

async function world() {
  let rk = rkEmpty(), clock = T0, n = 0;
  const pound = {
    revision: 3,
    tasks: [
      { id: TR, title: 'Synthetic recruiting: Total Rewards', body: 'Synthetic standing task', agent_id: '', status: 'queued', archived: false, project_id: 'synthetic-tr' },
      { id: OTHER, title: 'Synthetic other task', body: 'Another planned task', agent_id: '', status: 'queued', archived: false },
      { id: SAVED, title: 'Synthetic saved idea', body: 'Private, never planned', agent_id: '', status: 'queued', archived: false },
    ],
    contexts: [{ id: BRIEF, title: 'Synthetic TR brief', archived: false, active_version: 1, versions: [{ version: 1, title: 'Synthetic TR brief', text: BRIEF_TEXT, sha256: await sha(BRIEF_TEXT) }] }],
    messages: [], agents: [], activity: [],
  };
  // Credentials as the Worker reads them from the stored grants. Tests change status and expiry.
  const grants = new Map([coordinator, research, reviewer].map(a => [a.agent_id, { agent_id: a.agent_id, seat: a.seat, label: a.label, scopes: a.scopes, expires_at: T0 + 30 * DAY, status: 'active' }]));
  const ctx = { get agents() { return [...grants.values()].map(g => ({ ...g, status: g.status === 'active' && g.expires_at <= clock ? 'expired' : g.status })); } };
  const apply = async (who, op, data, request_id) => {
    const out = await rkApply(rk, pound, { op, request_id: request_id || 'req_' + String(++n).padStart(14, '0'), data }, who, clock, ctx);
    if (out.changed) rk = rkParse(rkSerialize(out.rk));
    return out.result;
  };
  const refused = async (who, op, data, status, code) => {
    const before = JSON.stringify(rk);
    await assert.rejects(apply(who, op, data), e => e instanceof RoboKapError && e.status === status && e.code === code, op + ' should fail with ' + code);
    assert.equal(JSON.stringify(rk), before, 'a refused write changes nothing');
  };
  const board = () => rkBoard(rk, pound, clock, ctx);
  const work = (who, session) => rkWork(rk, pound, clock, ctx, { principal: who, session_ref: session });
  const card = async taskId => { const b = await board(); return [...Object.values(b.lanes).flat(), ...b.done, ...b.closed, ...b.unplanned].find(c => c.task_id === taskId); };
  return { pound, ctx, grants, apply, refused, board, work, card, alerts: () => rkAlerts(rk, pound, clock, ctx), tick: ms => { clock += ms; }, get now() { return clock; }, get rk() { return rk; } };
}

const PLAYBOOK = { playbook_id: 'synthetic-tr', expected_version: 0, status: 'active', task_id: TR, seat: 'claude', reviewer_seat: 'claude-reviewer', review: 'independent', decision: 'not_required', data_scope: 'none', criteria: { project_id: 'synthetic-tr', kind: 'sourcebook' }, coordinator_seat: 'coordinator', intake: { source: 'gmail' }, acceptance: ACCEPT, budget: { attempts: 3, lease_minutes: 30 }, max_runs_per_day: 4 };

// The coordinator drafts the brief pin and the playbook; the owner approves each with one decision.
async function approvedSetup(w) {
  const pinDraft = await w.apply(coordinator, 'rk.propose', { kind: 'pin', project_id: 'synthetic-tr', pin_kind: 'sourcebook', ref: { type: 'pound_context', context_id: BRIEF, version: 1 } });
  await w.apply(owner, 'rk.decide', { subject: 'proposal', id: pinDraft.proposal_id, decision: 'approve' });
  const pbDraft = await w.apply(coordinator, 'rk.propose', { kind: 'playbook', playbook: PLAYBOOK });
  await w.apply(owner, 'rk.decide', { subject: 'proposal', id: pbDraft.proposal_id, decision: 'approve' });
}
async function intakeAndDispatch(w, message = 'synthetic-message-1') {
  const intake = await w.apply(coordinator, 'rk.intake', { playbook_id: 'synthetic-tr', source: 'gmail', message_sha256: await sha(message), received_at: new Date(w.now - MIN).toISOString(), ask: 'Synthetic ask', session_ref: CS });
  const view = await w.work(coordinator, CS);
  const pb = view.coordinator[0];
  return w.apply(coordinator, 'rk.dispatch', { playbook_id: 'synthetic-tr', intake_ids: [intake.intake_id], expected_plan_version: pb.expected_plan_version, session_ref: CS });
}
async function evidenceFor(w) {
  const pin = w.rk.pins.at(-1);
  return { criteria: { pin_version: pin.version, sha256: pin.ref.sha256 }, claims: [{ text: 'Synthetic claim with a source', support: 'source', sources: [{ url: 'https://example.com/synthetic', observed_at: new Date(w.now).toISOString() }] }], gaps: ['Synthetic gap'] };
}
async function claimAndReport(w, outcome, n) {
  const t = (await w.work(research, RS)).ready[0];
  const c = await w.apply(research, 'rk.claim', { task_id: t.task_id, plan_version: t.plan_version, pin_version: t.pin.version, session_ref: RS, lease_secret: secret(n) });
  const r = await w.apply(research, 'rk.report', { task_id: t.task_id, claim_id: c.claim_id, lease_secret: secret(n), outcome, summary: 'Synthetic attempt ' + n, ...(outcome === 'succeeded' ? { evidence: await evidenceFor(w), artifacts: [{ kind: 'project_file', ref: '/mnt/project-files/pack-sled/synthetic.pdf', sha256: 'a'.repeat(64) }] } : {}) });
  return { claim: c, receipt: r };
}
const fullReview = receipt_id => ({ receipt_id, verdict: 'accept', session_ref: VS, checks: [{ criterion: 0, result: 'pass' }, { criterion: 1, result: 'pass' }, { criterion: 'sources', result: 'pass' }], sources_checked: [{ url: 'https://example.com/synthetic', observed_at: new Date(T0).toISOString(), result: 'confirmed' }] });

test('each seat credential can do only what its stored scopes allow, whatever its label says', async () => {
  const w = await world();
  // Owner powers are never available to a credential, under any scope.
  for (const who of [coordinator, research, reviewer, impostor]) {
    await w.refused(who, 'rk.pin', { project_id: 'synthetic-tr', kind: 'sourcebook', status: 'approved', ref: { type: 'pound_context', context_id: BRIEF, version: 1 } }, 403, 'scope_denied');
    await w.refused(who, 'rk.decide', { subject: 'budget', id: TR, decision: 'extend', attempts: 1, plan_version: 1 }, 403, 'scope_denied');
    await w.refused(who, 'rk.playbook', PLAYBOOK, 403, 'scope_denied');
    await w.refused(who, 'rk.role.propose', { seat: 'claude', key_label: 'Anything', role: 'x' }, 403, 'scope_denied');
  }
  for (const op of ['rk.pin', 'rk.decide', 'rk.playbook', 'rk.role.propose', 'rk.role.accept']) assert.ok(!RK_AGENT_OPS.includes(op) && RK_OPS.includes(op));
  await approvedSetup(w);
  await intakeAndDispatch(w);
  // Research cannot coordinate or review; review cannot claim or coordinate; the coordinator cannot work or review.
  await w.refused(research, 'rk.intake', { playbook_id: 'synthetic-tr', source: 'gmail', message_sha256: 'b'.repeat(64), received_at: new Date(T0).toISOString() }, 403, 'scope_denied');
  await w.refused(reviewer, 'rk.claim', { task_id: TR, plan_version: 1, pin_version: 1, session_ref: VS, lease_secret: secret(9) }, 403, 'scope_denied');
  await w.refused(coordinator, 'rk.claim', { task_id: TR, plan_version: 1, pin_version: 1, session_ref: CS, lease_secret: secret(9) }, 403, 'scope_denied');
  // A credential for another seat cannot take this seat's work, even with every work scope.
  await w.refused(impostor, 'rk.claim', { task_id: TR, plan_version: 1, pin_version: 1, session_ref: RS, lease_secret: secret(9) }, 403, 'target_mismatch');
  const { receipt } = await claimAndReport(w, 'succeeded', 1);
  await w.refused(impostor, 'rk.review', fullReview(receipt.receipt_id), 403, 'reviewer_not_assigned');
  await w.refused(coordinator, 'rk.review', fullReview(receipt.receipt_id), 403, 'scope_denied');
  const view = await w.work(research, RS);
  assert.equal(view.identity.credential_trust, 'server_verified_scoped_credential');
  assert.deepEqual(view.review_requests, [], 'research sees no reviews');
  assert.deepEqual(view.coordinator, [], 'research does not coordinate');
});

test('a goal given once runs to a saved, reviewed result with no owner step after setup, and the owner can still send it back', async () => {
  const w = await world();
  // Without an independent reviewer seat a playbook cannot skip the owner's decision.
  await w.refused(owner, 'rk.playbook', { ...PLAYBOOK, review: 'advisory' }, 400, 'owner_decision_required');
  await w.refused(owner, 'rk.playbook', { ...PLAYBOOK, reviewer_seat: undefined }, 400, 'owner_decision_required');
  const before = (await w.board()).counts.needs_you;
  await approvedSetup(w);
  const planned = await intakeAndDispatch(w);
  assert.equal(planned.approved_via, 'playbook');
  assert.equal((await w.card(TR)).execution.state, 'dispatched_waiting_for_worker');
  const { receipt } = await claimAndReport(w, 'succeeded', 1);
  assert.equal((await w.card(TR)).lane, 'review');
  const rv = await w.apply(reviewer, 'rk.review', fullReview(receipt.receipt_id));
  assert.equal(rv.mode, 'independent');
  const done = await w.card(TR);
  assert.equal(done.lane, 'done');
  assert.equal(done.evidence.acceptance_basis, 'playbook_after_independent_review');
  assert.equal((await w.board()).counts.needs_you, before, 'nothing reached the owner during the run');
  assert.deepEqual(await w.alerts(), [], 'a healthy run raises no alerts');
  // The owner keeps the last word on the deliverable.
  await w.apply(owner, 'rk.decide', { subject: 'receipt', id: receipt.receipt_id, decision: 'revise', note: 'Synthetic: tighten the gaps' });
  const back = await w.card(TR);
  assert.equal(back.lane, 'ready');
  assert.equal(back.execution.state, 'retry_after_revision');
});

test('drafts change nothing until the owner approves them, and a draft against a changed brief is refused', async () => {
  const w = await world();
  const pinDraft = await w.apply(coordinator, 'rk.propose', { kind: 'pin', project_id: 'synthetic-tr', pin_kind: 'sourcebook', ref: { type: 'pound_context', context_id: BRIEF, version: 1 } });
  assert.equal(w.rk.pins.length, 0, 'a draft is not a pin');
  const b = await w.board();
  assert.equal(b.proposals.length, 1);
  assert.equal(b.proposals[0].type, 'pin');
  // Another proposer cannot pile a second draft on top; the same proposer replaces its own.
  await w.refused(primary, 'rk.propose', { kind: 'pin', project_id: 'synthetic-tr', pin_kind: 'sourcebook', ref: { type: 'pound_context', context_id: BRIEF, version: 1 } }, 409, 'proposal_pending');
  const again = await w.apply(coordinator, 'rk.propose', { kind: 'pin', project_id: 'synthetic-tr', pin_kind: 'sourcebook', ref: { type: 'pound_context', context_id: BRIEF, version: 1 }, note: 'Synthetic replacement' });
  await w.refused(owner, 'rk.decide', { subject: 'proposal', id: pinDraft.proposal_id, decision: 'approve' }, 409, 'proposal_not_open');
  // The brief's stored hash changed after the draft: approving it would approve something unseen.
  const c = w.pound.contexts[0];
  const original = c.versions[0].sha256;
  c.versions[0].sha256 = await sha('tampered');
  await w.refused(owner, 'rk.decide', { subject: 'proposal', id: again.proposal_id, decision: 'approve' }, 409, 'proposal_changed');
  c.versions[0].sha256 = original;
  const ok = await w.apply(owner, 'rk.decide', { subject: 'proposal', id: again.proposal_id, decision: 'approve' });
  assert.equal(ok.pin.version, 1);
  assert.equal(w.rk.pins[0].status, 'approved');
  // A playbook draft is validated exactly as the owner's save would be.
  await w.refused(coordinator, 'rk.propose', { kind: 'playbook', playbook: { ...PLAYBOOK, review: 'advisory' } }, 400, 'owner_decision_required');
  const pb = await w.apply(coordinator, 'rk.propose', { kind: 'playbook', playbook: PLAYBOOK });
  assert.equal(w.rk.playbooks.length, 0);
  await w.apply(owner, 'rk.decide', { subject: 'proposal', id: pb.proposal_id, decision: 'reject' });
  assert.equal(w.rk.playbooks.length, 0);
  assert.equal((await w.board()).proposals.length, 0);
});

test('duplicate requests and intakes create no duplicate work; failures retry on fresh claims; the board says why', async () => {
  const w = await world();
  await approvedSetup(w);
  await intakeAndDispatch(w, 'synthetic-message-1');
  const dup = await w.apply(coordinator, 'rk.intake', { playbook_id: 'synthetic-tr', source: 'gmail', message_sha256: await sha('synthetic-message-1'), received_at: new Date(w.now - MIN).toISOString() });
  assert.equal(dup.duplicate, true);
  // The same request id replays instead of applying twice.
  const t = (await w.work(research, RS)).ready[0];
  const call = { task_id: t.task_id, plan_version: t.plan_version, pin_version: t.pin.version, session_ref: RS, lease_secret: secret(1) };
  const c1 = await w.apply(research, 'rk.claim', call, 'req_claim_attempt_1');
  const c1again = await w.apply(research, 'rk.claim', call, 'req_claim_attempt_1');
  assert.equal(c1again.replayed, true);
  assert.equal(c1again.claim_id, c1.claim_id);
  await w.apply(research, 'rk.report', { task_id: TR, claim_id: c1.claim_id, lease_secret: secret(1), outcome: 'failed', summary: 'Synthetic injected failure' });
  const afterFail = await w.card(TR);
  assert.equal(afterFail.execution.state, 'retry_after_failure');
  assert.equal((await w.work(research, RS)).ready[0].previous_attempts[0].outcome, 'failed', 'the next attempt sees what failed');
  // A worker that stops without reporting: the lease ends and the board says so.
  const c2 = await w.apply(research, 'rk.claim', { ...call, lease_secret: secret(2) });
  assert.notEqual(c2.claim_id, c1.claim_id);
  assert.equal(c2.attempt, 2);
  w.tick(31 * MIN);
  assert.equal((await w.card(TR)).execution.state, 'retry_after_lost_lease');
  await w.refused(research, 'rk.heartbeat', { task_id: TR, claim_id: c2.claim_id, lease_secret: secret(2), execution_id: 'exe_synthetic_1' }, 409, 'lease_not_live');
  const third = await claimAndReport(w, 'succeeded', 3);
  assert.equal(third.claim.attempt, 3);
  await w.apply(reviewer, 'rk.review', fullReview(third.receipt.receipt_id));
  const b = await w.board();
  assert.equal(b.done.length, 1);
  assert.equal(w.rk.receipts.filter(r => r.outcome === 'succeeded').length, 1, 'exactly one successful outcome');
  assert.equal(w.rk.plans.filter(p => p.status === 'approved').length, 1, 'one run, not one per duplicate');
});

test('an expired or revoked credential stops its lease, the board asks for renewal, and renewal resumes work', async () => {
  const w = await world();
  await approvedSetup(w);
  await intakeAndDispatch(w);
  const t = (await w.work(research, RS)).ready[0];
  const c = await w.apply(research, 'rk.claim', { task_id: TR, plan_version: t.plan_version, pin_version: t.pin.version, session_ref: RS, lease_secret: secret(1) });
  assert.equal((await w.card(TR)).lane, 'running');
  w.grants.get(research.agent_id).status = 'revoked';
  const card = await w.card(TR);
  assert.notEqual(card.lane, 'running', 'a revoked credential no longer holds the task');
  assert.deepEqual(card.reasons.map(r => r.code), ['seat_credential_inactive']);
  assert.ok((await w.alerts()).some(a => a.code === 'credential_inactive' && a.severity === 'action'));
  await w.refused(research, 'rk.heartbeat', { task_id: TR, claim_id: c.claim_id, lease_secret: secret(1), execution_id: 'exe_synthetic_1' }, 409, 'lease_not_live');
  // Renewed inside the lease: the same claim resumes, so no second attempt exists.
  Object.assign(w.grants.get(research.agent_id), { status: 'active', expires_at: w.now + 30 * DAY });
  assert.equal((await w.card(TR)).lane, 'running');
  await w.apply(research, 'rk.heartbeat', { task_id: TR, claim_id: c.claim_id, lease_secret: secret(1), execution_id: 'exe_synthetic_1' });
  // Lapsed again past the lease: renewal makes the task claimable on a fresh claim.
  w.grants.get(research.agent_id).status = 'revoked';
  w.tick(3 * 60 * 60000);
  Object.assign(w.grants.get(research.agent_id), { status: 'active', expires_at: w.now + 30 * DAY });
  assert.equal((await w.card(TR)).lane, 'ready');
  // A second credential for the same seat is ambiguous until one is revoked.
  w.grants.set('5'.repeat(32), { agent_id: '5'.repeat(32), seat: 'claude', label: 'Second research', scopes: ['sled:work:read', 'sled:work:claim'], expires_at: w.now + DAY, status: 'active' });
  assert.ok((await w.card(TR)).reasons.some(r => r.code === 'role_key_ambiguous'));
  w.grants.get('5'.repeat(32)).status = 'revoked';
  const again = await w.apply(research, 'rk.claim', { task_id: TR, plan_version: t.plan_version, pin_version: t.pin.version, session_ref: RS, lease_secret: secret(2) });
  assert.equal(again.attempt, 2);
});

test('expiry is warned ahead of time to the owner and to the agent itself', async () => {
  const w = await world();
  await approvedSetup(w);
  w.tick(24 * DAY);
  const warn = (await w.alerts()).filter(a => a.code === 'credential_expiring');
  assert.equal(warn.length, 3);
  assert.ok(warn.every(a => a.severity === 'warn'));
  const self = await w.work(research, RS);
  assert.equal(self.identity.days_left, 6);
  assert.match(self.identity.warning, /expires in 6 days/);
  w.tick(4.5 * DAY);
  assert.ok((await w.alerts()).filter(a => a.code === 'credential_expiring').every(a => a.severity === 'action' && a.key.endsWith(':2')), 'two days out it becomes an action with a new key');
  w.tick(2 * DAY);
  const creds = (await w.board()).credentials;
  assert.ok(creds.every(c => c.status === 'expired'));
  assert.ok((await w.alerts()).some(a => a.code === 'credential_inactive'));
});

test('alerts name actionable failures once each, and routine progress raises none', async () => {
  const w = await world();
  await approvedSetup(w);
  assert.deepEqual(await w.alerts(), []);
  const intake = await w.apply(coordinator, 'rk.intake', { playbook_id: 'synthetic-tr', source: 'gmail', message_sha256: await sha('m2'), received_at: new Date(w.now).toISOString() });
  w.tick(3 * HOUR);
  assert.deepEqual((await w.alerts()).map(a => a.code), ['intake_waiting']);
  const pb = (await w.work(coordinator, CS)).coordinator[0];
  await w.apply(coordinator, 'rk.dispatch', { playbook_id: 'synthetic-tr', intake_ids: [intake.intake_id], expected_plan_version: pb.expected_plan_version });
  assert.deepEqual(await w.alerts(), [], 'a fresh dispatch is not a failure');
  w.tick(3 * HOUR);
  assert.deepEqual((await w.alerts()).map(a => a.code), ['no_worker']);
  await claimAndReport(w, 'failed', 1);
  assert.deepEqual(await w.alerts(), [], 'one failure retries quietly');
  await claimAndReport(w, 'failed', 2);
  assert.deepEqual((await w.alerts()).map(a => a.code), ['repeated_failures']);
  await claimAndReport(w, 'failed', 3);
  const codes = (await w.alerts()).map(a => a.code);
  assert.deepEqual(codes, ['budget_exhausted', 'repeated_failures']);
  const keys = (await w.alerts()).map(a => a.key);
  assert.equal(new Set(keys).size, keys.length, 'keys are unique, so a monitor posts each once');
  // A silent lease is a warning on its own.
  await w.apply(owner, 'rk.decide', { subject: 'budget', id: TR, decision: 'extend', attempts: 1, plan_version: 1 });
  const t = (await w.work(research, RS)).ready[0];
  await w.apply(research, 'rk.claim', { task_id: TR, plan_version: t.plan_version, pin_version: t.pin.version, session_ref: RS, lease_secret: secret(4) });
  w.tick(20 * MIN);
  assert.ok((await w.alerts()).some(a => a.code === 'lease_silent'));
});

test('every worker sees finished team work and nothing unplanned or private', async () => {
  const w = await world();
  await approvedSetup(w);
  await intakeAndDispatch(w);
  const { receipt } = await claimAndReport(w, 'succeeded', 1);
  await w.apply(reviewer, 'rk.review', fullReview(receipt.receipt_id));
  for (const who of [research, reviewer, coordinator, impostor]) {
    const view = await w.work(who, 'claude-code:any');
    assert.deepEqual(view.team.map(x => x.task_id), [TR], 'unplanned Pound items stay out');
    assert.equal(view.team[0].accepted, true);
    assert.equal(view.team[0].result.artifacts[0].sha256, 'a'.repeat(64));
  }
  const board = await w.board();
  assert.deepEqual(board.workers.map(x => x.status).sort(), ['idle', 'idle', 'idle']);
  assert.ok(board.workers.every(x => x.agent_id && x.trust.startsWith('scoped credential')));
  assert.equal(board.credentials.length, 3);
  assert.deepEqual(board.credentials.find(c => c.seat === 'claude').used_by, ['synthetic-tr']);
  const tr = await w.card(TR);
  assert.equal(tr.owner.holder, 'Claude research (scoped credential)');
  assert.equal(tr.owner.reviewer, 'Claude review (scoped credential)');
});

/* ---------------- the runner against these rules ---------------- */
// A transport that behaves like the scoped gateway: an inactive credential is refused before the
// board sees the call, and injected faults model a busy service, a lost response and a crash.
function gatewayTransport(w, who, session, faults = []) {
  const live = () => w.ctx.agents.find(a => a.agent_id === who.agent_id)?.status === 'active';
  const gate = () => { if (!live()) throw Object.assign(new Error('agent_grant_required'), { status: 403, code: 'agent_grant_required' }); };
  const sent = [];
  return {
    sent,
    read: async () => { gate(); return w.work(who, session); },
    write: async (op, request_id, data) => {
      sent.push({ op, request_id });
      const f = faults.find(x => x.op === op && x.left > 0);
      if (f) f.left--;
      if (f?.kind === 'busy') throw Object.assign(new Error('busy'), { status: f.status || 503, code: 'busy' });
      if (f?.kind === 'timeout_before') throw Object.assign(new Error('timeout'), { timeout: true });
      gate();
      try {
        const out = await w.apply(who, op, data, request_id);
        if (f?.kind === 'lost_response') throw Object.assign(new Error('timeout'), { timeout: true });
        return out;
      } catch (e) { if (e instanceof RoboKapError) throw Object.assign(new Error(e.code), { status: e.status, code: e.code, detail: e.detail }); throw e; }
    },
  };
}
const quick = { backoffMs: 0, sleep: async () => {} };
const deliverable = async w => ({ outcome: 'succeeded', summary: 'Synthetic deliverable', evidence: await evidenceFor(w), artifacts: [{ kind: 'project_file', ref: '/mnt/project-files/pack-sled/synthetic.pdf', sha256: 'a'.repeat(64) }] });

test('runner: lost responses and a busy service are retried as the identical request and record one outcome', async () => {
  const w = await world();
  await approvedSetup(w);
  await intakeAndDispatch(w);
  const faults = [{ op: 'rk.claim', kind: 'lost_response', left: 1 }, { op: 'rk.report', kind: 'busy', status: 503, left: 1 }, { op: 'rk.report', kind: 'busy', status: 429, left: 1 }, { op: 'rk.report', kind: 'timeout_before', left: 1 }];
  const tx = gatewayTransport(w, research, RS, faults);
  const run = createRunner({ transport: tx, store: memoryJournal(), runId: 'run-synthetic-retry', sessionRef: RS, retries: 4, ...quick });
  const c = await run.claimNext();
  assert.equal(c.task_id, TR);
  await run.report(await deliverable(w));
  const claims = tx.sent.filter(x => x.op === 'rk.claim'), reports = tx.sent.filter(x => x.op === 'rk.report');
  assert.equal(new Set(claims.map(x => x.request_id)).size, 1, 'the claim resend was identical');
  assert.equal(reports.length, 4);
  assert.equal(new Set(reports.map(x => x.request_id)).size, 1, 'every report resend was identical');
  assert.equal(w.rk.claims.length, 1);
  assert.equal(w.rk.receipts.length, 1);
});

test('runner: an expired credential pauses the run; after renewal a restarted session resends the same report once', async () => {
  const w = await world();
  await approvedSetup(w);
  await intakeAndDispatch(w);
  const store = memoryJournal();
  const first = createRunner({ transport: gatewayTransport(w, research, RS), store, runId: 'run-synthetic-pause', sessionRef: RS, ...quick });
  await first.claimNext();
  w.grants.get(research.agent_id).status = 'revoked';
  await assert.rejects(first.report(await deliverable(w)), e => e instanceof RunnerPaused);
  assert.equal(first.paused.code, 'agent_grant_required');
  assert.equal(Object.values(store.load().steps).find(x => x.op === 'rk.report').status, 'sent', 'not marked refused');
  assert.equal(w.rk.receipts.length, 0);
  // The owner renews; the session restarts on the same journal (a crash or a new routine run).
  Object.assign(w.grants.get(research.agent_id), { status: 'active', expires_at: w.now + 30 * DAY });
  const tx = gatewayTransport(w, research, RS);
  const second = createRunner({ transport: tx, store, runId: 'run-synthetic-pause', sessionRef: RS, ...quick });
  assert.notEqual(second.execution, first.execution);
  await second.claimNext();
  await second.report(await deliverable(w));
  assert.equal(w.rk.claims.length, 1, 'the resumed session kept its lease');
  assert.equal(w.rk.receipts.length, 1);
  assert.equal(second.paused, null);
});

test('runner: a lease that ended while the session was away is abandoned and the work restarts on a fresh claim', async () => {
  const w = await world();
  await approvedSetup(w);
  await intakeAndDispatch(w);
  const store = memoryJournal();
  const run = createRunner({ transport: gatewayTransport(w, research, RS), store, runId: 'run-synthetic-lost', sessionRef: RS, ...quick });
  const old = await run.claimNext();
  w.tick(3 * HOUR);
  await assert.rejects(run.heartbeat(), e => e instanceof LeaseLost && e.cause === 'lease_not_live');
  const fresh = await run.claimNext();
  assert.notEqual(fresh.claim_id, old.claim_id);
  assert.notEqual(fresh.lease_secret, old.lease_secret);
  await run.report(await deliverable(w));
  assert.equal(w.rk.receipts.length, 1, 'one result, from the fresh attempt');
  assert.equal(w.rk.receipts[0].claim_id, fresh.claim_id);
});
