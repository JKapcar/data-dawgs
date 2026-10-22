/* RoboKap coordination core. Pure computation: no storage, network, clock or credentials.
 *
 * Canonical store is the EXISTING Pound record /privatePounds/<owner>. Pound keeps tasks,
 * messages and context versions in `payload`; this overlay keeps coordination records in
 * the sibling `robokap` key of the same record, so one ETag compare-and-swap covers both and
 * there is no second task store. The Lab stays authoritative for hypotheses, experiments and
 * findings: RoboKap stores references to Lab records and checks them read-only. Nothing here
 * writes the Lab, starts an experiment, schedules anything or grants access.
 *
 * Principals come from the caller layer, never from input:
 *   owner_session    the configured owner's signed site session. The only decider.
 *   owner_key        the owner's connector key. key_label is server-verified, but every key
 *                    carries owner authority, so it proves WHICH KEY acted, not which agent.
 *   delegated_agent  a separate least-privilege credential. Modelled for review independence;
 *                    no transport issues one for RoboKap yet.
 * Self-declared text (session_ref, summaries, notes, model names) is stored and labelled as
 * declared; it routes work but never authorizes it. */

const enc = new TextEncoder();
export const RK_SCHEMA_VERSION = 1;
export const RK_SEATS = Object.freeze(['claude', 'grok', 'gemini', 'muse', 'dot', 'owner']);
export const RK_AGENT_SEATS = Object.freeze(RK_SEATS.filter(s => s !== 'owner'));
export const RK_LIMITS = Object.freeze({
  pins: 48, plans: 160, roles: 48, claims: 300, receipts: 200, reviews: 200, decisions: 300,
  events: 200, idem: 256, bytes: 262144, request_bytes: 24576,
  artifacts: 8, depends: 8, acceptance: 8, summary: 2000, note: 500,
});
export const RK_OPS = Object.freeze(['rk.pin', 'rk.plan', 'rk.role.propose', 'rk.role.accept', 'rk.claim', 'rk.release', 'rk.report', 'rk.review', 'rk.decide']);
// Operations an owner connector key may perform. Pins and decisions stay with the signed owner.
export const RK_CONNECTOR_OPS = Object.freeze(['rk.plan', 'rk.role.propose', 'rk.role.accept', 'rk.claim', 'rk.release', 'rk.report', 'rk.review']);
export const RK_LANES = Object.freeze(['needs_you', 'ready', 'running', 'blocked', 'review']);
const PIN_KINDS = ['design_of_record', 'sourcebook', 'context'];
const REVIEW_MODES = ['none', 'advisory', 'independent'];
// The sealed 2025 holdout is deliberately not a choice. There is no scope that reaches it.
const DATA_SCOPES = ['none', 'synthetic', 'development'];
const OUTCOMES = ['succeeded', 'failed', 'uncertain'];
const ARTIFACT_KINDS = ['pound_context', 'lab_receipt', 'lab_discussion', 'github_commit', 'github_pr', 'claude_artifact', 'discord_message', 'url', 'note'];
const LISTS = ['pins', 'plans', 'roles', 'claims', 'receipts', 'reviews', 'decisions', 'events', 'idem'];
const RX = {
  task: /^p_[a-f0-9-]{36}$/, pin: /^pin_[a-f0-9-]{36}$/, role: /^rol_[a-f0-9-]{36}$/, claim: /^clm_[a-f0-9-]{36}$/,
  receipt: /^rcp_[a-f0-9-]{36}$/, request: /^[A-Za-z0-9_-]{16,80}$/, secret: /^[A-Za-z0-9_-]{22,80}$/,
  project: /^[a-z0-9][a-z0-9-]{1,62}$/, key: /^[A-Za-z0-9_-]{1,24}$/, sha: /^[a-f0-9]{64}$/, agent: /^[a-f0-9]{32}$/,
  labId: /^[A-Za-z0-9_-]{1,100}$/, snowflake: /^[0-9]{17,20}$/, commit: /^[a-f0-9]{40}$/,
};

export class RoboKapError extends Error {
  constructor(status, code, detail) { super(code); this.status = status; this.code = code; if (detail !== undefined) this.detail = detail; }
}
const fail = (status, code, detail) => { throw new RoboKapError(status, code, detail); };
const check = (ok, status, code, detail) => { if (!ok) fail(status, code, detail); };
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (v, max, min = 1) => typeof v === 'string' && v.trim().length >= min && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const int = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const iso = ms => new Date(ms).toISOString();
const latest = (rows, pred) => { let out = null; for (const r of rows) if (pred(r)) out = r; return out; };
const uuid = () => crypto.randomUUID();
function only(data, allowed, required = []) {
  check(isObj(data), 400, 'data_object_required');
  for (const k of Object.keys(data)) check(allowed.includes(k), 400, 'unknown_field', k);
  for (const k of required) check(Object.hasOwn(data, k), 400, 'missing_field', k);
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
// Same canonical form as Pound's poundCanonical: sorted object keys, arrays in order.
export function canonical(v) {
  if (v && typeof v === 'object') return Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
// A task's definition, not its bookkeeping. Status, assignment and planning edits never
// invalidate evidence; a changed title, brief or reference list does.
export const taskFingerprint = task => sha256Hex(canonical({ title: task?.title ?? '', body: task?.body ?? '', refs: task?.refs ?? [] }));

/* ---------------- store ---------------- */
export function rkEmpty() { return { v: RK_SCHEMA_VERSION, rev: 0, pins: [], plans: [], roles: [], claims: [], receipts: [], reviews: [], decisions: [], events: [], idem: [] }; }
export function rkParse(raw) {
  if (raw === undefined || raw === null) return rkEmpty();
  check(typeof raw === 'string' && enc.encode(raw).length <= RK_LIMITS.bytes, 503, 'robokap_store_invalid');
  let s; try { s = JSON.parse(raw); } catch { fail(503, 'robokap_store_invalid'); }
  check(isObj(s) && s.v === RK_SCHEMA_VERSION && Number.isSafeInteger(s.rev) && s.rev >= 0, 503, 'robokap_store_invalid');
  for (const k of LISTS) check(Array.isArray(s[k]), 503, 'robokap_store_invalid');
  return s;
}
export function rkSerialize(s) {
  const out = JSON.stringify(s);
  check(enc.encode(out).length <= RK_LIMITS.bytes, 507, 'robokap_capacity');
  return out;
}

/* ---------------- principals ---------------- */
export function principalLabel(p) {
  return p?.kind === 'owner_session' ? 'owner' : p?.kind === 'owner_key' ? 'key:' + p.key_label : p?.kind === 'delegated_agent' ? 'agent:' + p.agent_id : 'unknown';
}
const principalRecord = p => p.kind === 'owner_key' ? { kind: 'owner_key', key_label: p.key_label } : p.kind === 'delegated_agent' ? { kind: 'delegated_agent', agent_id: p.agent_id } : { kind: 'owner_session' };
function verifiedPrincipal(p) {
  check(isObj(p) && (p.kind === 'owner_session' || (p.kind === 'owner_key' && RX.key.test(p.key_label || '')) || (p.kind === 'delegated_agent' && RX.agent.test(p.agent_id || ''))), 401, 'verified_principal_required');
}
export function describePrincipal(p) {
  if (!p) return 'unknown';
  if (p.kind === 'owner_session') return 'you (signed session)';
  if (p.kind === 'owner_key') return 'connector key "' + p.key_label + '" (server-verified key, shared owner authority)';
  if (p.kind === 'delegated_agent') return 'delegated agent ' + p.agent_id + ' (separate credential)';
  return 'unknown';
}

/* ---------------- record lookups ---------------- */
const poundTasks = pound => Array.isArray(pound?.tasks) ? pound.tasks : [];
const poundContexts = pound => Array.isArray(pound?.contexts) ? pound.contexts : [];
const taskById = (pound, id) => poundTasks(pound).find(t => t.id === id) || null;
const approvedPlan = (rk, taskId) => latest(rk.plans, p => p.task_id === taskId && p.status === 'approved');
const pendingPlan = (rk, taskId) => latest(rk.plans, p => p.task_id === taskId && p.status === 'proposed');
const maxPlanVersion = (rk, taskId) => rk.plans.filter(p => p.task_id === taskId).reduce((m, p) => Math.max(m, p.version), 0);
const currentPin = (rk, project, kind) => latest(rk.pins, p => p.project_id === project && p.kind === kind);
const claimLive = (c, now) => c.state === 'active' && Date.parse(c.expires_at) > now;
// Renewals stop at four lease lengths after the claim; then the seat reports or lets go.
const LEASE_RENEWAL_FACTOR = 4;
const leaseCap = claim => iso(Date.parse(claim.claimed_at) + LEASE_RENEWAL_FACTOR * (claim.lease_minutes ?? 30) * 60000);
// Connector keys may fill three quarters of any list, so the owner always keeps room to decide.
const connectorLimit = list => Math.floor(RK_LIMITS[list] * 0.75);
const activeClaim = (rk, taskId, now) => latest(rk.claims, c => c.task_id === taskId && claimLive(c, now));
// A decision's own id is unique; subject_id names what it decides. (Early records kept the
// subject in `id`; read them the same way.)
const decisionOn = (rk, subject, id) => latest(rk.decisions, d => d.subject === subject && (d.subject_id ?? d.id) === id);
export function roleState(role) {
  if (role.revocation) return 'revoked';
  if (role.rejection) return 'rejected';
  if (role.approval && role.acceptance) return 'effective';
  if (role.acceptance) return 'accepted';
  return 'proposed';
}
const liveRole = r => !['revoked', 'rejected'].includes(roleState(r));
function seatKey(rk, seat) {
  const keys = [...new Set(rk.roles.filter(r => r.seat === seat && roleState(r) === 'effective').map(r => r.key_label))];
  return keys.length === 1 ? keys[0] : null;
}
const effectiveRole = (rk, seat, name) => latest(rk.roles, r => r.seat === seat && (!name || r.role === name) && roleState(r) === 'effective');
function attempts(rk, plan) {
  const used = rk.claims.filter(c => c.task_id === plan.task_id && c.plan_version === plan.version).length;
  const extra = rk.decisions.filter(d => d.subject === 'budget' && (d.subject_id ?? d.id) === plan.task_id && d.plan_version === plan.version).reduce((n, d) => n + d.attempts, 0);
  return { used, limit: plan.budget.attempts + extra };
}
function effectiveOutcome(rk, r) {
  if (r.outcome !== 'uncertain') return r.outcome;
  const d = decisionOn(rk, 'uncertain', r.id);
  return !d ? 'uncertain' : d.decision === 'landed' ? 'succeeded' : 'failed';
}
const latestReceipt = (rk, taskId, version) => latest(rk.receipts, r => r.task_id === taskId && r.plan_version === version && r.validity === 'current');
// Every uncertain outcome for a task, from any plan version and stale or not, waits for the
// owner: an amendment cannot erase an external effect that may already have landed.
const unreconciled = (rk, taskId) => rk.receipts.filter(r => r.task_id === taskId && r.outcome === 'uncertain' && !decisionOn(rk, 'uncertain', r.id));
// A reject or revise closes a receipt's review; later accepts cannot outvote it.
function reviewState(rk, plan, receipt) {
  if (plan.review === 'none') return { ok: true, review: null };
  const reviews = rk.reviews.filter(v => v.receipt_id === receipt.id);
  const closing = reviews.find(v => v.verdict === 'reject') || reviews.find(v => v.verdict === 'revise');
  if (closing) return { ok: false, verdict: closing.verdict, review: closing };
  const accepts = reviews.filter(v => v.verdict === 'accept');
  if (!accepts.length) return { ok: false, waiting: true, review: null };
  // Shared owner keys are advisory by construction: they can never stand in for independence.
  if (plan.review === 'independent') {
    const independent = latest(accepts, v => v.mode === 'independent');
    return independent ? { ok: true, review: independent } : { ok: false, needs_independent: true, review: accepts.at(-1) };
  }
  return { ok: true, review: accepts.at(-1) };
}
// Pound tasks that currently say they block this one. Archived tasks block nothing.
const liveBlockers = (pound, taskId) => poundTasks(pound).filter(t => !t.archived && t.id !== taskId && Array.isArray(t.blocks) && t.blocks.includes(taskId)).map(t => t.id);
// Dependencies: the owner-approved list, the Pound blockers recorded when the owner approved
// the plan, and every Pound blocker now. Adding a blocker in Pound takes effect at once;
// removing one changes nothing until the owner approves a new plan version.
function dependencies(rk, pound, taskId, plan) {
  const deps = new Set([...(plan?.depends_on || []), ...(plan?.pound_blockers || []), ...liveBlockers(pound, taskId)]);
  deps.delete(taskId);
  return [...deps];
}
// What an owner approval binds besides the plan itself: the task text and the Pound blockers the
// approval will record. The board sends the basis it showed, so a change made after it loaded is
// refused instead of being approved unseen.
const basisOf = (fp, pound, taskId) => sha256Hex(canonical({ task_fp: fp, blockers: liveBlockers(pound, taskId).sort() }));
export const planBasis = async (task, pound) => basisOf(await taskFingerprint(task), pound, task.id);
async function checkBasis(data, task, pound) {
  if (data.basis === undefined) return;
  check(typeof data.basis === 'string' && RX.sha.test(data.basis), 400, 'invalid_basis');
  check(data.basis === await planBasis(task, pound), 409, 'plan_basis_changed', 'The task text or its Pound blockers changed since the board loaded. Reload and review again.');
}
function cycleWith(rk, pound, taskId, newDeps) {
  const edges = id => id === taskId ? new Set([...newDeps, ...liveBlockers(pound, id)]) : new Set(dependencies(rk, pound, id, approvedPlan(rk, id)));
  const seen = new Set(), path = new Set();
  const walk = id => { if (path.has(id)) return true; if (seen.has(id)) return false; seen.add(id); path.add(id); for (const d of edges(id)) if (walk(d)) return true; path.delete(id); return false; };
  return walk(taskId);
}

/* ---------------- derivation: one source of truth for eligibility and lanes ---------------- */
function pinState(rk, pound, plan) {
  if (!plan.pin) return { code: null };
  const cur = currentPin(rk, plan.pin.project_id, plan.pin.kind);
  if (!cur) return { code: 'pin_missing' };
  if (cur.version !== plan.pin.version) return { code: 'pin_superseded', detail: { pinned: plan.pin.version, current: cur.version } };
  if (plan.pin.require === 'approved' && cur.status !== 'approved') return { code: 'pin_not_approved', detail: { version: cur.version, status: cur.status } };
  if (cur.ref.type === 'pound_context') {
    const c = poundContexts(pound).find(x => x.id === cur.ref.context_id);
    if (!c || c.archived) return { code: 'pin_context_missing' };
    const v = c.versions?.find(x => x.version === cur.ref.version);
    if (!v || v.sha256 !== cur.ref.sha256) return { code: 'pin_hash_mismatch' };
    if ((c.versions?.length || 0) > cur.ref.version) return { code: 'pin_behind_context', detail: { pinned: cur.ref.version, newest: c.versions.length } };
  }
  return { code: null, pin: cur };
}
function labState(plan, lab) {
  if (!plan.lab) return { code: null };
  if (!lab) return { code: 'lab_unverifiable', blocked: true };
  const h = lab.hypotheses.get(plan.lab.hypothesis_id);
  if (!h) return { code: 'lab_hypothesis_missing' };
  if (h.status === 'withdrawn') return { code: 'lab_hypothesis_withdrawn' };
  if (h.version !== plan.lab.hypothesis_version) return { code: 'lab_link_stale', detail: { linked: plan.lab.hypothesis_version, current: h.version } };
  return { code: null };
}
const NEEDS = 'needs_you', BLOCKED = 'blocked';
const REASONS = {
  plan_proposed: 'Approve or reject the proposed plan. Check its changes first.',
  plan_amendment_proposed: 'A plan amendment is waiting for your decision. Check its changes first.',
  task_changed: 'The task text changed after approval. Re-approve the plan so evidence binds to the new version.',
  pin_missing: 'The pinned context is missing. Pin it again.',
  pin_superseded: 'A newer pin exists. Amend the plan to the current version or restore the pin.',
  pin_not_approved: 'The plan requires an approved pin; the current pin is a draft.',
  pin_context_missing: 'The pinned context document is archived or missing.',
  pin_hash_mismatch: 'The pinned context version no longer matches its recorded hash.',
  pin_behind_context: 'The context has a newer version than the pin. Pin the version you approve, then amend the plan.',
  lab_unverifiable: 'The Lab link cannot be checked right now. Work waits rather than guessing.',
  lab_hypothesis_missing: 'The linked Lab hypothesis is missing.',
  lab_hypothesis_withdrawn: 'The linked Lab hypothesis was withdrawn.',
  lab_link_stale: 'The linked Lab hypothesis has a newer version. Amend the link.',
  reconcile_uncertain: 'An attempt reported an uncertain outcome. Record whether it landed before any retry.',
  decide_receipt: 'Review is satisfied. Accept, revise or reject the result.',
  review_rejected: 'A reviewer rejected the result. Decide what happens next.',
  propose_role: 'No role exists for this seat. Propose one.',
  awaiting_role_acceptance: 'The seat has not accepted its role from its own connector key.',
  approve_role: 'The seat accepted its role. Approve it or reject it.',
  role_key_ambiguous: 'This seat has effective roles on more than one key. Revoke one.',
  waiting_dependency: 'Waiting for a dependency to be accepted at its current version.',
  dependency_closed: 'A dependency was canceled or rejected. Amend the plan.',
  dependency_missing: 'A dependency was archived or deleted. Amend the plan to drop it.',
  dependency_cycle: 'Dependencies form a cycle. Amend a plan or a Pound blocks list.',
  budget_exhausted: 'All attempts for this plan version are used. Extend the budget or amend the plan.',
  owner_task: 'This task is yours to do. Claim it here and attach evidence when finished.',
  awaiting_review: 'Waiting for a reviewer.',
  needs_independent_review: 'Needs an independent reviewer. Shared owner keys only give advisory reviews, and no separate agent credential is connected.',
  review_revise: 'A revision was requested; a new attempt is open.',
  dependency_changed: 'A dependency was redone after this result. A new attempt is open.',
  lab_evidence_missing: 'The plan requires Lab evidence and this result has none that executed and did not fail. A new attempt is open.',
  lease_stale: 'Context changed during this lease. It cannot renew, and its report will be recorded as stale.',
};
const reason = (code, lane, actor, detail) => ({ code, lane, actor, text: REASONS[code] || code, ...(detail ? { detail } : {}) });

// Tasks inside a dependency cycle (strongly connected components larger than one node),
// over the same edges eligibility uses.
function cycleMembers(rk, pound, ids) {
  const live = new Set(ids), index = new Map(), low = new Map(), stack = [], onStack = new Set(), out = new Set();
  let counter = 0;
  const edges = id => dependencies(rk, pound, id, approvedPlan(rk, id)).filter(d => live.has(d));
  const visit = v => {
    index.set(v, counter); low.set(v, counter); counter++; stack.push(v); onStack.add(v);
    for (const w of edges(v)) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const component = [];
      let w; do { w = stack.pop(); onStack.delete(w); component.push(w); } while (w !== v);
      if (component.length > 1) for (const x of component) out.add(x);
    }
  };
  for (const id of ids) if (!index.has(id)) visit(id);
  return out;
}

// The dependencies a result relied on, as recorded at claim time, must still be accepted at
// the same evidence. Dependencies added later must be accepted too, but do not force a redo.
const depDrift = (recorded, deps) => (recorded || []).some(r => { const c = deps.find(x => x.id === r.task_id); return c && c.receipt_id !== r.receipt_id; });
// Why a lease (or a result from it) no longer matches what the owner approved.
function staleCauses(d, claim) {
  if (!d || !('depsOk' in d)) return [d?.task?.status === 'canceled' ? 'task_canceled' : 'task_unavailable'];
  const out = [];
  if (!d.plan || d.plan.version !== claim.plan_version) out.push('plan_changed');
  if (d.changed) out.push('task_changed');
  if (d.pin?.code) out.push(d.pin.code);
  // An unreadable Lab is not evidence of change; acceptance waits on it separately.
  if (d.lab?.code && d.lab.code !== 'lab_unverifiable') out.push(d.lab.code);
  if (!d.depsOk) out.push('dependency_not_accepted');
  else if (depDrift(claim.deps, d.deps)) out.push('dependency_changed');
  return out;
}

export async function rkDerive(rk, pound, now, ctx = {}) {
  const tasks = poundTasks(pound).filter(t => !t.archived);
  const fps = new Map(await Promise.all(tasks.map(async t => [t.id, await taskFingerprint(t)])));
  const cycles = cycleMembers(rk, pound, tasks.map(t => t.id));
  const memo = new Map(), visiting = new Set();
  const derive = id => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return { id, cycle: true, lane: NEEDS, accepted: false };
    visiting.add(id);
    const out = deriveOne(id);
    visiting.delete(id);
    memo.set(id, out);
    return out;
  };
  function deriveOne(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return { id, missing: true, lane: 'missing', accepted: false };
    const plan = approvedPlan(rk, id), pending = pendingPlan(rk, id);
    const open = unreconciled(rk, id);
    const base = { id, task, plan, pending, reasons: [], accepted: false, closed: false, unreconciled: open };
    const reconcile = open.length ? [reason('reconcile_uncertain', NEEDS, 'owner', { receipt_ids: open.map(r => r.id) })] : [];
    if (!plan) return { ...base, lane: pending ? NEEDS : 'unplanned', reasons: pending ? [reason('plan_proposed', NEEDS, 'owner', { version: pending.version })] : [] };
    // A canceled task needs nothing more, except the truth about an effect that may have landed.
    if (task.status === 'canceled') return { ...base, lane: open.length ? NEEDS : 'closed', closed: open.length ? false : 'canceled', reasons: reconcile };
    const recorded = new Set([...(plan.depends_on || []), ...(plan.pound_blockers || [])]);
    const deps = dependencies(rk, pound, id, plan).map(depId => {
      const d = derive(depId);
      return {
        id: depId, title: d.task?.title ?? taskById(pound, depId)?.title ?? null, lane: d.lane, accepted: d.accepted,
        receipt_id: d.accepted ? d.evidence.receipt.id : null, source: recorded.has(depId) ? 'approved' : 'pound_live',
        cycle: Boolean(d.cycle) || cycles.has(depId), closed: d.closed || false, missing: Boolean(d.missing),
      };
    });
    const depsOk = deps.every(d => d.accepted);
    const claim = activeClaim(rk, id, now);
    const receipt = latestReceipt(rk, id, plan.version);
    const outcome = receipt ? effectiveOutcome(rk, receipt) : null;
    const decision = receipt ? decisionOn(rk, 'receipt', receipt.id) : null;
    const review = receipt && outcome === 'succeeded' ? reviewState(rk, plan, receipt) : null;
    const changed = fps.get(id) !== plan.task_fp;
    const pin = pinState(rk, pound, plan), lab = labState(plan, ctx.lab);
    const budget = attempts(rk, plan);
    const versionOk = !changed && !pin.code && !lab.code;
    const drift = Boolean(receipt) && depDrift(receipt.deps, deps);
    // Required Lab evidence must be on the receipt itself, including a result reconciled as landed.
    const labOk = plan.lab?.evidence !== 'required' || Boolean(receipt?.artifacts?.some(labEvidence));
    // Evidence is current when it matches the approved task text, pin and Lab link, every
    // dependency is accepted now at the evidence the result relied on, and nothing is left
    // to reconcile.
    const evidenceCurrent = Boolean(receipt) && versionOk && depsOk && !drift && !open.length && labOk;
    const ownerOk = decision ? decision.decision === 'accept' : plan.decision === 'not_required';
    const accepted = Boolean(receipt && outcome === 'succeeded' && review?.ok && ownerOk && evidenceCurrent);
    const evidence = { receipt, outcome, review: review?.review ?? null, decision };
    const common = { ...base, claim, evidence, budget, pin, lab, changed, deps, depsOk, evidenceCurrent, fp: fps.get(id) };
    const amend = pending ? [reason('plan_amendment_proposed', NEEDS, 'owner', { version: pending.version })] : [];
    // A pending amendment always reaches the owner's inbox; accepted work stays accepted for its
    // dependents until the owner actually approves a new version.
    if (accepted) return { ...common, lane: pending ? NEEDS : 'done', accepted: true, reasons: amend };
    if (decision?.decision === 'reject') {
      const r = [...amend, ...reconcile];
      return { ...common, lane: r.length ? NEEDS : 'closed', closed: r.length ? false : 'rejected', reasons: r };
    }
    if (claim) {
      const causes = staleCauses(common, claim);
      // An owner decision outranks the lease: a pending amendment or an effect to reconcile goes
      // to your inbox even while a seat holds the task.
      const yours = [...amend, ...reconcile];
      return { ...common, lane: yours.length ? NEEDS : 'running', reasons: [...yours, ...(causes.length ? [reason('lease_stale', 'running', 'seat', { causes })] : [])] };
    }
    const reasons = [...amend, ...reconcile];
    if (changed) reasons.push(reason('task_changed', NEEDS, 'owner'));
    if (pin.code) reasons.push(reason(pin.code, NEEDS, 'owner', pin.detail));
    if (lab.code) reasons.push(reason(lab.code, lab.blocked ? BLOCKED : NEEDS, lab.blocked ? 'system' : 'owner', lab.detail));
    if (plan.seat !== 'owner') {
      const roles = rk.roles.filter(r => r.seat === plan.seat && liveRole(r) && (!plan.role || r.role === plan.role));
      if (!roles.some(r => roleState(r) === 'effective')) {
        if (roles.some(r => roleState(r) === 'accepted')) reasons.push(reason('approve_role', NEEDS, 'owner'));
        else if (roles.length) reasons.push(reason('awaiting_role_acceptance', BLOCKED, 'seat'));
        else reasons.push(reason('propose_role', NEEDS, 'owner'));
      } else if (!seatKey(rk, plan.seat)) reasons.push(reason('role_key_ambiguous', NEEDS, 'owner'));
    }
    // Dependency trouble the owner must resolve goes to Needs You; waiting is Blocked.
    if (cycles.has(id)) reasons.push(reason('dependency_cycle', NEEDS, 'owner'));
    if (deps.some(d => d.missing)) reasons.push(reason('dependency_missing', NEEDS, 'owner', { ids: deps.filter(d => d.missing).map(d => d.id) }));
    if (deps.some(d => d.closed)) reasons.push(reason('dependency_closed', NEEDS, 'owner', { ids: deps.filter(d => d.closed).map(d => d.id) }));
    if (deps.some(d => !d.accepted && !d.missing && !d.closed)) reasons.push(reason('waiting_dependency', BLOCKED, 'dependency', { waiting_on: deps.filter(d => !d.accepted && !d.missing && !d.closed).map(d => d.id) }));
    let inReview = false, redo = null;
    if (receipt && outcome === 'succeeded' && !open.length && depsOk) {
      if (drift) redo = 'dependency_changed';
      else if (!labOk) redo = 'lab_evidence_missing';
      else if (decision?.decision === 'revise' || review.verdict === 'revise') redo = 'review_revise';
      else if (review.verdict === 'reject') reasons.push(reason('review_rejected', NEEDS, 'owner', { receipt_id: receipt.id }));
      // Ask for the owner's decision only when it is the one thing left.
      else if (review.ok) { if (plan.decision === 'required' && !decision && versionOk) reasons.push(reason('decide_receipt', NEEDS, 'owner', { receipt_id: receipt.id })); }
      else if (versionOk) inReview = true;
    }
    // Budget matters only when the next step is another attempt under this plan version.
    const needsAttempt = !open.length && (!receipt || outcome !== 'succeeded' || Boolean(redo));
    if (needsAttempt && budget.used >= budget.limit) reasons.push(reason('budget_exhausted', NEEDS, 'owner', budget));
    let lane = reasons.some(r => r.lane === NEEDS) ? NEEDS : reasons.some(r => r.lane === BLOCKED) ? BLOCKED : inReview ? 'review' : 'ready';
    if (lane === 'review') return { ...common, lane, reasons: [reason(review.needs_independent || (plan.review === 'independent' && !review.review) ? 'needs_independent_review' : 'awaiting_review', 'review', 'reviewer', { receipt_id: receipt.id })] };
    if (lane === 'ready' && redo) reasons.push(reason(redo, 'ready', 'seat', { receipt_id: receipt.id }));
    const claimable = lane === 'ready';
    // Your own ready work belongs in your inbox.
    if (claimable && plan.seat === 'owner') { lane = NEEDS; reasons.push(reason('owner_task', NEEDS, 'owner')); }
    return { ...common, lane, reasons, claimable };
  }
  for (const t of tasks) derive(t.id);
  return { tasks: memo, fps };
}

/* ---------------- board and agent views ---------------- */
function lastVerified(rk, taskId) {
  const e = latest(rk.events, x => x.task_id === taskId);
  return e ? { op: e.op, at: e.at, by: e.by, by_text: describePrincipal(e.by), ...(e.session_ref_declared ? { session_ref_declared: e.session_ref_declared } : {}) } : null;
}
const PLAN_FIELDS = ['seat', 'session_ref', 'role', 'priority', 'depends_on', 'pin', 'acceptance', 'review', 'decision', 'lab', 'data_scope', 'budget', 'thread', 'note'];
// Everything an approver needs to see, and everything an amendment must carry forward.
function planView(p) {
  if (!p) return null;
  return {
    version: p.version, status: p.status, seat: p.seat, session_ref: p.session_ref || null, role: p.role || null, priority: p.priority ?? 3,
    depends_on: p.depends_on || [], pound_blockers: p.pound_blockers || [], pin: p.pin || null, acceptance: p.acceptance || [], review: p.review, decision: p.decision,
    lab: p.lab ? { hypothesis_id: p.lab.hypothesis_id, hypothesis_version: p.lab.hypothesis_version, evidence: p.lab.evidence } : null,
    data_scope: p.data_scope, budget: p.budget, thread: p.thread || null, note: p.note || null,
    by: describePrincipal(p.by), at: p.at, approved_at: p.approved_at || null,
  };
}
function planChanges(from, to) {
  const a = planView(from) || {}, b = planView(to);
  return PLAN_FIELDS.filter(k => canonical(a[k] ?? null) !== canonical(b[k] ?? null)).map(k => ({ field: k, from: a[k] ?? null, to: b[k] ?? null }));
}
// Dependencies the current plan enforces that approving `next` would stop enforcing. Shown before
// approval so a quiet Pound edit cannot ride along with an innocent-looking amendment.
function droppedDeps(pound, plan, next) {
  if (!plan) return [];
  const keep = new Set([...(next.depends_on || []), ...liveBlockers(pound, next.task_id)]);
  return [...new Set([...(plan.depends_on || []), ...(plan.pound_blockers || [])])].filter(id => !keep.has(id));
}
function cardFor(rk, pound, d, now) {
  const t = d.task, plan = d.plan;
  const receipt = d.evidence?.receipt || null;
  const roleKey = plan && plan.seat !== 'owner' ? seatKey(rk, plan.seat) : null;
  const role = plan && plan.seat !== 'owner' ? latest(rk.roles, r => r.seat === plan.seat && liveRole(r) && (!plan.role || r.role === plan.role)) : null;
  const next = d.reasons?.[0] || null;
  return {
    task_id: t.id, title: t.title, brief: typeof t.body === 'string' ? t.body : '', refs: Array.isArray(t.refs) ? t.refs : [],
    project: plan?.pin?.project_id || t.project_id || null, lane: d.lane, priority: plan?.priority ?? 3, max_plan_version: maxPlanVersion(rk, t.id),
    reported: { status: t.status, source: t.status_source || 'owner_reported', note: t.status === 'working' && !(d.claim) ? 'Reported working; no execution receipt or live lease.' : null },
    owner: plan ? { seat: plan.seat, key_label: plan.seat === 'owner' ? null : roleKey, role: role ? { id: role.id, name: role.role, state: roleState(role) } : null, session_ref_target: plan.session_ref || null } : null,
    next: next ? { code: next.code, text: next.text, actor: next.actor } : d.lane === 'ready' ? { code: 'claimable', text: 'Ready for ' + (plan.seat === 'owner' ? 'you' : plan.seat) + ' to claim.', actor: 'seat' } : d.lane === 'running' ? { code: 'running', text: 'Lease held. Progress is unverified until a receipt arrives.', actor: 'seat' } : null,
    reasons: d.reasons || [],
    dependencies: d.deps || [],
    plan: plan ? { ...planView(plan), attempts: d.budget } : null,
    // An approver sees the whole proposal and exactly what it changes, not just a version number.
    pending_plan: d.pending ? { ...planView(d.pending), proposed_by: describePrincipal(d.pending.by), changes: planChanges(plan, d.pending), drops_dependencies: droppedDeps(pound, plan, d.pending).map(id => ({ id, title: taskById(pound, id)?.title ?? null })) } : null,
    claim: d.claim ? { id: d.claim.id, seat: d.claim.seat, by: describePrincipal(d.claim.by), by_owner: d.claim.by.kind === 'owner_session', session_ref_declared: d.claim.session_ref, attempt: d.claim.attempt, claimed_at: d.claim.claimed_at, expires_at: d.claim.expires_at, max_expires_at: leaseCap(d.claim), minutes_left: Math.max(0, Math.round((Date.parse(d.claim.expires_at) - now) / 60000)) } : null,
    unreconciled: (d.unreconciled || []).map(r => ({ receipt_id: r.id, plan_version: r.plan_version, attempt: r.attempt, at: r.at, by: describePrincipal(r.by), summary: r.summary, artifacts: r.artifacts })),
    evidence: receipt ? {
      receipt_id: receipt.id, outcome: d.evidence.outcome, reported_outcome: receipt.outcome, at: receipt.at, by: describePrincipal(receipt.by), session_ref_declared: receipt.session_ref_declared,
      late: receipt.late, hash: receipt.hash, summary: receipt.summary, artifacts: receipt.artifacts, current: Boolean(d.evidenceCurrent),
      review: d.evidence.review ? { verdict: d.evidence.review.verdict, mode: d.evidence.review.mode, by: describePrincipal(d.evidence.review.by), at: d.evidence.review.at } : null,
      decision: d.evidence.decision ? { decision: d.evidence.decision.decision, at: d.evidence.decision.at } : null,
    } : null,
    last_verified: lastVerified(rk, t.id),
  };
}
// Priority 1 is first; ties keep a stable, readable order.
const byPriority = (a, b) => a.priority - b.priority || String(a.title).localeCompare(String(b.title));
export async function rkBoard(rk, pound, now, ctx = {}) {
  const { tasks, fps } = await rkDerive(rk, pound, now, ctx);
  const lanes = Object.fromEntries(RK_LANES.map(l => [l, []]));
  const done = [], closed = [], unplanned = [];
  for (const d of tasks.values()) {
    if (!d.task) continue;
    const card = { ...cardFor(rk, pound, d, now), basis: await basisOf(fps.get(d.id), pound, d.id) };
    if (lanes[d.lane]) lanes[d.lane].push(card);
    else if (d.lane === 'done') done.push(card);
    else if (d.lane === 'closed') closed.push({ ...card, closed: d.closed });
    else if (d.lane === 'unplanned') unplanned.push(card);
  }
  // An uncertain outcome on a task that was archived or deleted still needs your answer.
  const orphans = new Map();
  for (const r of rk.receipts) if (r.outcome === 'uncertain' && !tasks.get(r.task_id)?.task && !decisionOn(rk, 'uncertain', r.id)) orphans.set(r.task_id, [...(orphans.get(r.task_id) || []), r]);
  for (const [taskId, open] of orphans) {
    const t = taskById(pound, taskId), plan = approvedPlan(rk, taskId);
    const task = { id: taskId, title: t ? t.title + ' (archived)' : 'Deleted task', body: t?.body ?? '', refs: t?.refs ?? [], status: t?.status ?? null, status_source: t?.status_source };
    const d = { task, plan, pending: null, lane: NEEDS, deps: [], unreconciled: open, budget: plan ? attempts(rk, plan) : null, evidence: null, claim: null, reasons: [reason('reconcile_uncertain', NEEDS, 'owner', { receipt_ids: open.map(r => r.id) })] };
    lanes.needs_you.push({ ...cardFor(rk, pound, d, now), archived: true, basis: null });
  }
  for (const list of [...Object.values(lanes), done, closed, unplanned]) list.sort(byPriority);
  // Role decisions that are not tied to one task still belong in the owner's inbox.
  const roleInbox = rk.roles.filter(r => roleState(r) === 'accepted').map(r => ({ role_id: r.id, seat: r.seat, key_label: r.key_label, role: r.role, scope: r.scope || null, accepted: { by: describePrincipal(r.acceptance.by), tier: r.acceptance.tier, at: r.acceptance.at } }));
  const pins = [];
  for (const p of rk.pins) { const cur = currentPin(rk, p.project_id, p.kind); if (cur === p) pins.push({ ...p, by: describePrincipal(p.by), history: rk.pins.filter(x => x.project_id === p.project_id && x.kind === p.kind).length }); }
  return {
    as_of: iso(now), rk_revision: rk.rev, lanes, done, closed, unplanned,
    counts: { ...Object.fromEntries(RK_LANES.map(l => [l, lanes[l].length])), done: done.length, closed: closed.length, unplanned: unplanned.length, role_decisions: roleInbox.length },
    role_decisions: roleInbox,
    roles: rk.roles.map(r => ({ id: r.id, seat: r.seat, key_label: r.key_label, role: r.role, scope: r.scope || null, state: roleState(r), proposed: { by: describePrincipal(r.proposed.by), at: r.proposed.at }, acceptance: r.acceptance ? { by: describePrincipal(r.acceptance.by), tier: r.acceptance.tier, at: r.acceptance.at } : null })),
    pins,
    contexts: poundContexts(pound).filter(c => !c.archived).map(c => ({ id: c.id, title: c.title, versions: c.versions?.length || 0 })),
    lab: ctx.lab ? { status: 'checked', tenant: ctx.lab.tenant } : { status: 'unavailable' },
    capacity: Object.fromEntries(LISTS.filter(k => k !== 'events' && k !== 'idem').map(k => [k, { used: rk[k].length, limit: RK_LIMITS[k], connector_limit: connectorLimit(k) }])),
    honesty: [
      'Lanes come from server-recorded claims, receipts, reviews and decisions. Pound status is shown as reported.',
      'Running means a lease is held. Progress is unverified until a receipt arrives.',
      'Connector keys are server-verified, but every key carries owner authority: reviews from them are advisory and never independent.',
      'session_ref and summaries are declared by the session. Session targeting prevents accidental cross-session claims, not deliberate ones. Model identity is never verified.',
      'A Pound blocker added after a plan was approved applies at once, but any Pound writer can remove it until you approve a plan version that records it.',
    ],
  };
}
export async function rkWork(rk, pound, now, ctx, { key_label, session_ref }) {
  check(RX.key.test(key_label || ''), 401, 'verified_key_required');
  const { tasks } = await rkDerive(rk, pound, now, ctx);
  const seats = RK_AGENT_SEATS.filter(s => seatKey(rk, s) === key_label);
  const forMe = d => d.plan && seats.includes(d.plan.seat);
  const sessionOk = d => !d.plan.session_ref || d.plan.session_ref === session_ref;
  const ready = [], elsewhere = [], running = [], reviews = [];
  for (const d of tasks.values()) {
    if (!d.task) continue;
    if (d.lane === 'ready' && forMe(d)) (sessionOk(d) ? ready : elsewhere).push(d);
    if (d.claim && d.claim.by.kind === 'owner_key' && d.claim.by.key_label === key_label) running.push(d);
    if (d.lane === 'review' && d.evidence.receipt && !(d.evidence.receipt.by.kind === 'owner_key' && d.evidence.receipt.by.key_label === key_label)) reviews.push(d);
  }
  const order = (a, b) => (a.plan.priority ?? 3) - (b.plan.priority ?? 3) || String(a.task.title).localeCompare(String(b.task.title));
  ready.sort(order);
  const brief = d => ({
    task_id: d.task.id, title: d.task.title, brief: d.task.body, refs: d.task.refs || [], priority: d.plan.priority ?? 3, plan_version: d.plan.version, seat: d.plan.seat,
    pin: d.plan.pin ? { ...d.plan.pin, current: d.pin?.pin ? { id: d.pin.pin.id, status: d.pin.pin.status, ref: d.pin.pin.ref, verification: d.pin.pin.verification } : null } : null,
    lab: d.plan.lab, data_scope: d.plan.data_scope, acceptance: d.plan.acceptance, review: d.plan.review, budget: d.budget, lease_minutes: d.plan.budget.lease_minutes, session_ref_target: d.plan.session_ref || null,
    redo: d.reasons.find(r => r.code === 'review_revise' || r.code === 'dependency_changed')?.code ?? null,
    dependencies: (d.deps || []).map(x => ({ id: x.id, title: x.title, accepted: x.accepted })),
  });
  return {
    as_of: iso(now), rk_revision: rk.rev,
    identity: { key_label, key_label_trust: 'server_verified', session_ref_declared: session_ref ?? null, session_ref_trust: 'declared', model_identity: 'unverified' },
    seats,
    ready: ready.map(brief),
    targeted_to_other_sessions: elsewhere.map(d => ({ task_id: d.task.id, title: d.task.title, session_ref_target: d.plan.session_ref })),
    running: running.map(d => ({ task_id: d.task.id, title: d.task.title, claim_id: d.claim.id, session_ref_declared: d.claim.session_ref, expires_at: d.claim.expires_at, max_expires_at: leaseCap(d.claim), plan_version: d.claim.plan_version, attempt: d.claim.attempt, yours: d.claim.session_ref === session_ref, stale: d.reasons.find(r => r.code === 'lease_stale')?.detail?.causes ?? [] })),
    review_requests: reviews.map(d => ({ task_id: d.task.id, title: d.task.title, receipt_id: d.evidence.receipt.id, summary: d.evidence.receipt.summary, artifacts: d.evidence.receipt.artifacts, required: d.plan.review, note: 'Your review will be recorded as advisory: connector keys share owner authority.' })),
    role_offers: rk.roles.filter(r => r.key_label === key_label && roleState(r) === 'proposed').map(r => ({ role_id: r.id, seat: r.seat, role: r.role, scope: r.scope || null })),
    protocol: [
      '1. Accept a role offer for your seat with op rk.role.accept (only your own key can).',
      '2. Claim the first ready task (highest priority first) with op rk.claim: echo plan_version (and pin_version when pinned), declare session_ref, and send a fresh random lease_secret you keep for this claim.',
      '3. Do the work. Re-claim with the same lease_secret to renew before expires_at. Renewal stops at max_expires_at, or as soon as the task text, pin, Lab link or a dependency changes.',
      '4. Report with op rk.report: outcome succeeded | failed | uncertain, a summary and artifact references. Use uncertain when an external effect may or may not have landed.',
      '5. Read again for the next ready task. Stop when nothing is ready, a decision is pending, a version changed, or your budget is used.',
      'After a timeout, resend the identical request (same request_id) soon: replies are kept for the last 256 writes. If you lost the request_id, read first and reconcile; never claim again blindly.',
    ],
  };
}

/* ---------------- operations ---------------- */
function addEvent(rk, at, op, principal, extra) {
  rk.events.push({ at, op, by: principalRecord(principal), task_id: extra.task_id ?? null, subject: extra.subject ?? null, ...(extra.session_ref ? { session_ref_declared: extra.session_ref } : {}) });
  if (rk.events.length > RK_LIMITS.events) rk.events = rk.events.slice(-RK_LIMITS.events);
}
function cap(rk, list, principal, full = false) {
  const limit = principal.kind === 'owner_session' || full ? RK_LIMITS[list] : connectorLimit(list);
  check(rk[list].length < limit, 409, 'robokap_capacity', { list, used: rk[list].length, limit });
}
const ownerOnly = p => check(p.kind === 'owner_session', 403, 'owner_session_required');
const notDelegated = p => check(p.kind !== 'delegated_agent', 403, 'delegated_agents_not_connected_to_robokap');
function liveTask(pound, id) {
  check(typeof id === 'string' && RX.task.test(id), 400, 'invalid_task_id');
  const t = taskById(pound, id);
  check(t, 404, 'task_not_found');
  check(!t.archived, 409, 'task_archived');
  return t;
}
async function normalizePinRef(ref, pound) {
  check(isObj(ref) && typeof ref.type === 'string', 400, 'invalid_pin_ref');
  if (ref.type === 'claude_doc') {
    only(ref, ['type', 'id', 'rev'], ['type', 'id', 'rev']);
    check(/^[A-Za-z0-9-]{16,64}$/.test(ref.id) && int(ref.rev, 1, 1000000), 400, 'invalid_pin_ref');
    return { ref: { type: 'claude_doc', id: ref.id, rev: ref.rev }, verification: 'owner_attested' };
  }
  if (ref.type === 'repo_file') {
    only(ref, ['type', 'path', 'commit', 'sha256'], ['type', 'path', 'commit', 'sha256']);
    check(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(ref.path) && !ref.path.split('/').includes('..') && ref.path.length <= 200 && RX.commit.test(ref.commit) && RX.sha.test(ref.sha256), 400, 'invalid_pin_ref');
    return { ref: { type: 'repo_file', path: ref.path, commit: ref.commit, sha256: ref.sha256 }, verification: 'commit_and_hash_recorded' };
  }
  if (ref.type === 'pound_context') {
    only(ref, ['type', 'context_id', 'version'], ['type', 'context_id', 'version']);
    check(RX.task.test(ref.context_id) && int(ref.version, 1, 1000), 400, 'invalid_pin_ref');
    const c = poundContexts(pound).find(x => x.id === ref.context_id);
    check(c && !c.archived, 404, 'context_not_found');
    const v = c.versions?.find(x => x.version === ref.version);
    check(v, 404, 'context_version_not_found');
    return { ref: { type: 'pound_context', context_id: c.id, version: v.version, sha256: v.sha256 }, verification: 'server_verified' };
  }
  fail(400, 'invalid_pin_ref');
}
// Lab evidence for a successful report: verified, actually executed, and not a failed run.
// Null and inconclusive results are results.
const labEvidence = a => a.kind === 'lab_receipt' && a.verification === 'server_verified' && a.executed === true && a.lab_outcome !== 'failure';
async function verifyArtifact(a, { pound, lab, plan }) {
  check(isObj(a), 400, 'invalid_artifact');
  only(a, ['kind', 'ref', 'sha256', 'note'], ['kind']);
  check(ARTIFACT_KINDS.includes(a.kind), 400, 'unknown_artifact_kind');
  check(a.sha256 === undefined || RX.sha.test(a.sha256), 400, 'invalid_artifact_sha256');
  check(a.note === undefined || text(a.note, 300), 400, 'invalid_artifact_note');
  const out = { kind: a.kind, ...(a.ref !== undefined ? { ref: a.ref } : {}), ...(a.sha256 ? { sha256: a.sha256 } : {}), ...(a.note ? { note: a.note } : {}) };
  if (a.kind === 'note') { check(a.ref === undefined && a.note, 400, 'note_artifact_takes_note_only'); return { ...out, verification: 'claimed' }; }
  check(typeof a.ref === 'string' && a.ref.length <= 2000, 400, 'artifact_ref_required');
  if (a.kind === 'pound_context') {
    const m = /^(p_[a-f0-9-]{36})@([1-9][0-9]{0,3})$/.exec(a.ref);
    check(m, 400, 'invalid_artifact_ref');
    const c = poundContexts(pound).find(x => x.id === m[1]), v = c?.versions?.find(x => x.version === Number(m[2]));
    check(v, 400, 'artifact_not_found');
    check(!a.sha256 || a.sha256 === v.sha256, 400, 'artifact_hash_mismatch');
    return { ...out, sha256: v.sha256, verification: 'server_verified' };
  }
  if (a.kind === 'lab_receipt' || a.kind === 'lab_discussion') {
    check(RX.labId.test(a.ref), 400, 'invalid_artifact_ref');
    if (a.kind === 'lab_receipt') check(a.sha256, 400, 'lab_receipt_hash_required');
    // An unreadable Lab cannot vouch for a split or a hash. Retry the report when it is back.
    check(lab, 503, 'lab_unavailable', 'Lab references are verified when they are recorded. Resend this report when the Lab is reachable.');
    if (a.kind === 'lab_discussion') { const d = lab.discussions.get(a.ref); check(d, 400, 'artifact_not_found'); check(!plan.lab || d.hypothesisId === plan.lab.hypothesis_id, 400, 'lab_link_mismatch'); return { ...out, verification: 'server_verified' }; }
    const r = lab.receipts.get(a.ref);
    check(r, 400, 'artifact_not_found');
    check(r.receiptHash === a.sha256, 400, 'artifact_hash_mismatch');
    // Allow-list, not deny-list: anything other than a known non-holdout split is refused.
    check(['discovery', 'development'].includes(r.split), 403, 'holdout_sealed');
    check(!plan.lab || (r.hypothesisId === plan.lab.hypothesis_id && r.hypothesisVersion === plan.lab.hypothesis_version), 400, 'lab_link_mismatch');
    return { ...out, verification: 'server_verified', lab_outcome: r.outcome ?? null, executed: r.execution !== 'not_executed' };
  }
  let url; try { url = new URL(a.ref); } catch { fail(400, 'invalid_artifact_ref'); }
  check(url.protocol === 'https:' && !url.username && !url.password, 400, 'invalid_artifact_ref');
  const shapes = {
    github_commit: /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/commit\/[a-f0-9]{40}$/,
    github_pr: /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[0-9]{1,7}$/,
    claude_artifact: /^https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]{8,80}$/,
    discord_message: /^https:\/\/discord\.com\/channels\/([0-9]{17,20})\/([0-9]{17,20})\/([0-9]{17,20})$/,
  };
  if (shapes[a.kind]) check(shapes[a.kind].test(a.ref), 400, 'invalid_artifact_ref');
  if (a.kind === 'discord_message' && plan.thread) check(shapes.discord_message.exec(a.ref)[2] === plan.thread.discord_thread_id, 400, 'thread_mismatch');
  return { ...out, verification: 'format_checked' };
}

const OPS = {
  async 'rk.pin'({ rk, pound, data, principal, at }) {
    ownerOnly(principal);
    only(data, ['project_id', 'kind', 'status', 'ref', 'note'], ['project_id', 'kind', 'status', 'ref']);
    check(RX.project.test(data.project_id), 400, 'invalid_project_id');
    check(PIN_KINDS.includes(data.kind), 400, 'invalid_pin_kind');
    check(['draft', 'approved'].includes(data.status), 400, 'invalid_pin_status');
    check(data.note === undefined || text(data.note, RK_LIMITS.note), 400, 'invalid_note');
    const { ref, verification } = await normalizePinRef(data.ref, pound);
    cap(rk, 'pins', principal);
    const prev = currentPin(rk, data.project_id, data.kind);
    const pin = { id: 'pin_' + uuid(), project_id: data.project_id, kind: data.kind, version: (prev?.version || 0) + 1, status: data.status, ref, verification, ...(data.note ? { note: data.note } : {}), by: principalRecord(principal), at, supersedes: prev?.id || null };
    rk.pins.push(pin);
    return { subject: pin.id, pin: { id: pin.id, project_id: pin.project_id, kind: pin.kind, version: pin.version, status: pin.status, verification } };
  },
  async 'rk.plan'({ rk, pound, data, principal, at, now, ctx }) {
    notDelegated(principal);
    only(data, ['task_id', 'expected_plan_version', 'seat', 'session_ref', 'role', 'priority', 'depends_on', 'pin', 'acceptance', 'review', 'decision', 'lab', 'data_scope', 'budget', 'thread', 'note', 'basis'], ['task_id', 'expected_plan_version', 'seat', 'review', 'decision', 'data_scope']);
    const task = liveTask(pound, data.task_id);
    await checkBasis(data, task, pound);
    check(task.status !== 'canceled', 409, 'task_canceled');
    check(int(data.expected_plan_version, 0, 100000) && data.expected_plan_version === maxPlanVersion(rk, task.id), 409, 'plan_version_conflict', { current: maxPlanVersion(rk, task.id) });
    check(RK_SEATS.includes(data.seat), 400, 'invalid_seat');
    const agentSeat = data.seat !== 'owner';
    check(data.session_ref === undefined || (agentSeat && text(data.session_ref, 200)), 400, 'invalid_session_ref');
    check(data.role === undefined || (agentSeat && text(data.role, 60)), 400, 'invalid_role');
    check(data.priority === undefined || int(data.priority, 1, 5), 400, 'invalid_priority', '1 is most urgent, 5 least; default 3.');
    const deps = data.depends_on ?? [];
    check(Array.isArray(deps) && deps.length <= RK_LIMITS.depends && new Set(deps).size === deps.length, 400, 'invalid_depends_on');
    for (const d of deps) { check(d !== task.id, 400, 'self_dependency'); liveTask(pound, d); }
    let pin = null;
    if (data.pin !== undefined) {
      only(data.pin, ['project_id', 'kind', 'version', 'require'], ['kind', 'version', 'require']);
      const project = data.pin.project_id ?? task.project_id;
      check(typeof project === 'string' && RX.project.test(project), 400, 'pin_project_required');
      check(PIN_KINDS.includes(data.pin.kind) && int(data.pin.version, 1, 100000) && ['approved', 'any'].includes(data.pin.require), 400, 'invalid_plan_pin');
      check(rk.pins.some(p => p.project_id === project && p.kind === data.pin.kind && p.version === data.pin.version), 409, 'pin_not_found');
      pin = { project_id: project, kind: data.pin.kind, version: data.pin.version, require: data.pin.require };
    }
    const acceptance = data.acceptance ?? [];
    check(Array.isArray(acceptance) && acceptance.length <= RK_LIMITS.acceptance, 400, 'invalid_acceptance');
    for (const a of acceptance) { only(a, ['text', 'check_ref'], ['text']); check(text(a.text, 300) && (a.check_ref === undefined || text(a.check_ref, 300)), 400, 'invalid_acceptance'); }
    check(REVIEW_MODES.includes(data.review), 400, 'invalid_review_mode');
    check(['required', 'not_required'].includes(data.decision), 400, 'invalid_decision_mode');
    check(DATA_SCOPES.includes(data.data_scope), 400, 'invalid_data_scope', 'The 2025 holdout is sealed; no scope reaches it.');
    let lab = null;
    if (data.lab !== undefined) {
      only(data.lab, ['hypothesis_id', 'hypothesis_version', 'evidence'], ['hypothesis_id', 'hypothesis_version', 'evidence']);
      check(RX.labId.test(data.lab.hypothesis_id) && int(data.lab.hypothesis_version, 1, 100000) && ['required', 'optional'].includes(data.lab.evidence), 400, 'invalid_lab_link');
      if (ctx.lab) check(ctx.lab.hypotheses.has(data.lab.hypothesis_id), 409, 'lab_hypothesis_not_found');
      lab = { hypothesis_id: data.lab.hypothesis_id, hypothesis_version: data.lab.hypothesis_version, evidence: data.lab.evidence, checked_at_plan: ctx.lab ? 'server_checked' : 'unverified_lab_unavailable' };
    }
    const budget = { attempts: 3, lease_minutes: 30 };
    if (data.budget !== undefined) {
      only(data.budget, ['attempts', 'lease_minutes'], ['attempts', 'lease_minutes']);
      check(int(data.budget.attempts, 1, 5) && int(data.budget.lease_minutes, 5, 120), 400, 'invalid_budget');
      Object.assign(budget, data.budget);
    }
    let thread = null;
    if (data.thread !== undefined) { only(data.thread, ['discord_thread_id'], ['discord_thread_id']); check(RX.snowflake.test(data.thread.discord_thread_id), 400, 'invalid_thread'); thread = { discord_thread_id: data.thread.discord_thread_id }; }
    check(data.note === undefined || text(data.note, RK_LIMITS.note), 400, 'invalid_note');
    check(!cycleWith(rk, pound, task.id, deps), 400, 'dependency_cycle');
    const status = principal.kind === 'owner_session' ? 'approved' : 'proposed';
    // One open proposal per task. A key may replace its own; another key's waits for your decision,
    // so proposals cannot pile up faster than you decide them.
    const open = pendingPlan(rk, task.id);
    if (status === 'proposed' && open) check(principalLabel(open.by) === principalLabel(principal), 409, 'proposal_pending', 'Another proposal for this task is waiting for the owner.');
    if (!(status === 'proposed' && open)) cap(rk, 'plans', principal);
    const plan = {
      task_id: task.id, version: maxPlanVersion(rk, task.id) + 1, status, seat: data.seat, ...(data.session_ref ? { session_ref: data.session_ref } : {}), ...(data.role ? { role: data.role } : {}),
      priority: data.priority ?? 3, depends_on: deps, pin, acceptance, review: data.review, decision: data.decision, lab, data_scope: data.data_scope, budget, thread, ...(data.note ? { note: data.note } : {}),
      task_fp: await taskFingerprint(task), by: principalRecord(principal), at,
      // The owner's approval records the Pound blockers in force, so removing one later in Pound
      // does not unblock this task; only another approved plan version can.
      ...(status === 'approved' ? { approved_at: at, pound_blockers: liveBlockers(pound, task.id) } : {}),
    };
    for (const p of [...rk.plans]) {
      if (p.task_id !== task.id) continue;
      // A key's replaced open proposal was never decided, so it leaves no record; one you supersede
      // with your own plan keeps a fingerprint.
      if (p.status === 'proposed') { if (status === 'proposed') rk.plans.splice(rk.plans.indexOf(p), 1); else await retireProposal(p, 'superseded', at); }
      else if (status === 'approved' && p.status === 'approved') p.status = 'superseded';
    }
    if (status === 'approved') supersedeClaims(rk, task.id, now, at);
    rk.plans.push(plan);
    return { task_id: task.id, subject: 'plan', plan_version: plan.version, status };
  },
  async 'rk.role.propose'({ rk, data, principal, at }) {
    notDelegated(principal);
    only(data, ['seat', 'key_label', 'role', 'scope'], ['seat', 'key_label', 'role']);
    check(RK_AGENT_SEATS.includes(data.seat), 400, 'invalid_seat');
    check(RX.key.test(data.key_label), 400, 'invalid_key_label');
    // The primary key is shared by every client that holds it, so it cannot tell one session
    // or assistant from another. A seat needs its own key.
    check(data.key_label.toLowerCase() !== 'primary', 409, 'shared_primary_key_not_allowed', 'A seat needs its own connector key; the primary key is shared by every client that holds it.');
    check(text(data.role, 60) && (data.scope === undefined || text(data.scope, 300)), 400, 'invalid_role');
    const live = rk.roles.filter(r => r.seat === data.seat && liveRole(r));
    check(live.every(r => r.key_label === data.key_label), 409, 'seat_key_conflict', 'One connector key serves one seat. Revoke or reject the other role first.');
    const taken = rk.roles.filter(r => r.key_label === data.key_label && liveRole(r));
    check(taken.every(r => r.seat === data.seat), 409, 'key_serves_another_seat');
    check(!live.some(r => r.role === data.role), 409, 'role_exists');
    cap(rk, 'roles', principal);
    const role = { id: 'rol_' + uuid(), seat: data.seat, key_label: data.key_label, role: data.role, ...(data.scope ? { scope: data.scope } : {}), proposed: { by: principalRecord(principal), at }, acceptance: null, approval: null, rejection: null, revocation: null };
    rk.roles.push(role);
    return { subject: role.id, role_id: role.id, state: 'proposed' };
  },
  async 'rk.role.accept'({ rk, data, principal, at }) {
    only(data, ['role_id'], ['role_id']);
    check(RX.role.test(data.role_id), 400, 'invalid_role_id');
    const role = rk.roles.find(r => r.id === data.role_id);
    check(role, 404, 'role_not_found');
    check(roleState(role) === 'proposed', 409, 'role_not_open', roleState(role));
    // The owner cannot accept on a seat's behalf, and another seat's key cannot either.
    check(principal.kind === 'owner_key' && principal.key_label === role.key_label, 403, 'acceptance_must_come_from_the_seat_key');
    role.acceptance = { by: principalRecord(principal), tier: 'key_attested', at, note: 'Accepted with the seat\'s own connector key. That proves which key accepted, not which model.' };
    return { subject: role.id, role_id: role.id, state: roleState(role) };
  },
  async 'rk.claim'({ rk, pound, data, principal, at, now, ctx }) {
    only(data, ['task_id', 'plan_version', 'pin_version', 'session_ref', 'lease_secret'], ['task_id', 'plan_version', 'lease_secret']);
    check(principal.kind !== 'delegated_agent', 403, 'delegated_agents_not_connected_to_robokap');
    const task = liveTask(pound, data.task_id);
    check(typeof data.lease_secret === 'string' && RX.secret.test(data.lease_secret), 400, 'invalid_lease_secret');
    const plan = approvedPlan(rk, task.id);
    check(plan, 409, 'plan_not_approved');
    check(data.plan_version === plan.version, 409, 'stale_plan', { current: plan.version });
    if (plan.pin) check(data.pin_version === plan.pin.version, 409, 'stale_context', { pinned: plan.pin.version });
    else check(data.pin_version === undefined, 400, 'plan_has_no_pin');
    const agentSeat = plan.seat !== 'owner';
    if (agentSeat) check(text(data.session_ref, 200), 400, 'session_ref_required');
    else check(data.session_ref === undefined || text(data.session_ref, 200), 400, 'invalid_session_ref');
    const leaseHash = await sha256Hex(data.lease_secret);
    const live = activeClaim(rk, task.id, now);
    if (live) {
      const same = principalLabel(live.by) === principalLabel(principal) && live.session_ref === (data.session_ref ?? null) && live.lease_sha256 === leaseHash;
      check(same, 409, 'already_claimed', { seat: live.seat, session_ref_declared: live.session_ref, expires_at: live.expires_at });
      // A renewal re-checks everything the lease was granted on, and stops at a fixed ceiling.
      const { tasks } = await rkDerive(rk, pound, now, ctx);
      const causes = staleCauses(tasks.get(task.id), live);
      check(!causes.length, 409, 'lease_stale', causes);
      const ceiling = leaseCap(live);
      check(Date.parse(live.expires_at) < Date.parse(ceiling), 409, 'lease_limit_reached', { max_expires_at: ceiling });
      // Extend to one lease length from now, never past the ceiling and never shorter than before.
      const until = Math.max(Date.parse(live.expires_at), Math.min(now + (live.lease_minutes ?? plan.budget.lease_minutes) * 60000, Date.parse(ceiling)));
      live.expires_at = iso(until);
      live.renewed_at = at;
      return { task_id: task.id, subject: live.id, session_ref: live.session_ref, claim_id: live.id, attempt: live.attempt, expires_at: live.expires_at, max_expires_at: ceiling, renewed: true };
    }
    if (agentSeat) {
      check(principal.kind === 'owner_key', 403, 'target_mismatch', 'This task is for the ' + plan.seat + ' seat.');
      const key = seatKey(rk, plan.seat);
      check(key, 409, 'role_not_effective');
      check(principal.key_label === key, 403, 'target_mismatch', 'This task is for the ' + plan.seat + ' seat.');
      if (plan.role) check(effectiveRole(rk, plan.seat, plan.role), 409, 'role_not_effective');
      if (plan.session_ref) check(data.session_ref === plan.session_ref, 403, 'session_mismatch', 'This task is targeted to another session.');
    } else check(principal.kind === 'owner_session', 403, 'target_mismatch', 'This task is the owner\'s own work.');
    const { tasks } = await rkDerive(rk, pound, now, ctx);
    const d = tasks.get(task.id);
    check(d.claimable === true, 409, 'not_eligible', (d.reasons || []).map(r => r.code));
    for (const c of rk.claims) if (c.task_id === task.id && c.state === 'active') { c.state = 'expired'; c.closed_at = at; }
    cap(rk, 'claims', principal);
    const claim = {
      id: 'clm_' + uuid(), task_id: task.id, plan_version: plan.version, task_fp: plan.task_fp, pin: plan.pin ? { kind: plan.pin.kind, version: plan.pin.version, project_id: plan.pin.project_id } : null,
      seat: plan.seat, by: principalRecord(principal), session_ref: data.session_ref ?? null, lease_sha256: leaseHash, attempt: d.budget.used + 1,
      // The dependency evidence this attempt starts from. A result counts only while it still holds.
      deps: d.deps.map(x => ({ task_id: x.id, receipt_id: x.receipt_id })),
      lease_minutes: plan.budget.lease_minutes, claimed_at: at, renewed_at: at, expires_at: iso(now + plan.budget.lease_minutes * 60000), state: 'active',
    };
    rk.claims.push(claim);
    return { task_id: task.id, subject: claim.id, session_ref: claim.session_ref, claim_id: claim.id, attempt: claim.attempt, attempts_limit: d.budget.limit, expires_at: claim.expires_at, max_expires_at: leaseCap(claim), plan_version: plan.version, renewed: false };
  },
  async 'rk.release'({ rk, data, principal, at }) {
    // Stop control: the signed owner can end any active lease without its secret. The attempt
    // still counts, and a result that arrives afterwards is recorded as stale.
    if (principal.kind === 'owner_session' && data?.lease_secret === undefined) {
      only(data, ['task_id', 'claim_id'], ['task_id', 'claim_id']);
      check(RX.task.test(data.task_id || '') && RX.claim.test(data.claim_id || ''), 400, 'invalid_claim_reference');
      const claim = rk.claims.find(c => c.id === data.claim_id && c.task_id === data.task_id);
      check(claim, 404, 'claim_not_found');
      check(claim.state === 'active', 409, 'claim_closed', claim.state);
      Object.assign(claim, { state: 'released', closed_at: at, released_by: 'owner' });
      return { task_id: claim.task_id, subject: claim.id, claim_id: claim.id, state: 'released', stopped_by_owner: true };
    }
    only(data, ['task_id', 'claim_id', 'lease_secret'], ['task_id', 'claim_id', 'lease_secret']);
    const claim = await ownClaim(rk, data, principal);
    check(claim.state === 'active', 409, 'claim_closed', claim.state);
    Object.assign(claim, { state: 'released', closed_at: at, released_by: 'claimant' });
    return { task_id: claim.task_id, subject: claim.id, claim_id: claim.id, state: 'released' };
  },
  async 'rk.report'({ rk, pound, data, principal, at, now, ctx }) {
    only(data, ['task_id', 'claim_id', 'lease_secret', 'outcome', 'summary', 'artifacts'], ['task_id', 'claim_id', 'lease_secret', 'outcome', 'summary']);
    const claim = await ownClaim(rk, data, principal);
    if (claim.receipt_id) fail(409, 'already_reported', { receipt_id: claim.receipt_id });
    check(claim.state !== 'released' || claim.released_by === 'owner' || data.outcome === 'uncertain', 409, 'claim_released');
    check(OUTCOMES.includes(data.outcome), 400, 'invalid_outcome');
    const live = claim.state === 'active' && Date.parse(claim.expires_at) > now;
    const late = !live;
    // Claims are appended in order, so a later index is a later attempt even within one millisecond.
    const newer = !live && rk.claims.slice(rk.claims.indexOf(claim) + 1).some(c => c.task_id === claim.task_id);
    // A possible external effect is always recorded, whatever happened to the lease, so it can be
    // reconciled. Any other result from a lease that lost its place is refused.
    check(!newer || data.outcome === 'uncertain', 409, 'lease_superseded', 'The lease ended and another attempt started. This result was not recorded.');
    check(text(data.summary, RK_LIMITS.summary), 400, 'invalid_summary');
    const list = data.artifacts ?? [];
    check(Array.isArray(list) && list.length <= RK_LIMITS.artifacts, 400, 'invalid_artifacts');
    const task = taskById(pound, claim.task_id);
    const plan = approvedPlan(rk, claim.task_id);
    const artifacts = [];
    for (const a of list) artifacts.push(await verifyArtifact(a, { pound, lab: ctx.lab, plan: plan || { lab: null, thread: null } }));
    // The same staleness rules as renewal: plan, task text, pin, Lab link and dependencies.
    const d = task && !task.archived ? (await rkDerive(rk, pound, now, ctx)).tasks.get(claim.task_id) : null;
    const causes = d ? staleCauses(d, claim) : ['task_archived'];
    if (task?.status === 'canceled' && !causes.includes('task_canceled')) causes.push('task_canceled');
    if (['superseded', 'released'].includes(claim.state)) causes.push(claim.state === 'superseded' ? 'claim_superseded' : claim.released_by === 'owner' ? 'stopped_by_owner' : 'released_by_seat');
    if (newer) causes.push('lease_superseded');
    const current = !causes.length;
    if (current && plan.lab?.evidence === 'required' && data.outcome === 'succeeded') check(artifacts.some(labEvidence), 409, 'lab_evidence_required', 'Attach a server-verified Lab receipt that executed and did not fail.');
    cap(rk, 'receipts', principal, data.outcome === 'uncertain');
    const body = {
      id: 'rcp_' + uuid(), task_id: claim.task_id, claim_id: claim.id, plan_version: claim.plan_version, task_fp: claim.task_fp, pin: claim.pin, seat: claim.seat,
      outcome: data.outcome, summary: data.summary, summary_sha256: await sha256Hex(data.summary), artifacts, by: principalRecord(principal),
      session_ref_declared: claim.session_ref, attempt: claim.attempt, deps: claim.deps || [], at, late, validity: current ? 'current' : 'stale', ...(current ? {} : { stale_causes: causes }),
    };
    const prev = rk.receipts.at(-1)?.hash || null;
    const receipt = { ...body, prev, hash: await sha256Hex(canonical({ ...body, prev })) };
    rk.receipts.push(receipt);
    if (claim.state === 'active') { claim.state = 'reported'; claim.closed_at = at; }
    claim.receipt_id = receipt.id;
    claim.reported_at = at;
    return { task_id: claim.task_id, subject: receipt.id, session_ref: claim.session_ref, receipt_id: receipt.id, validity: receipt.validity, ...(current ? {} : { stale_causes: causes }), late, hash: receipt.hash, artifacts: artifacts.map(a => ({ kind: a.kind, verification: a.verification })) };
  },
  async 'rk.review'({ rk, data, principal, at }) {
    only(data, ['receipt_id', 'verdict', 'note'], ['receipt_id', 'verdict']);
    check(principal.kind !== 'owner_session', 403, 'owner_uses_decide', 'Your judgement is an owner decision, not a review.');
    check(RX.receipt.test(data.receipt_id), 400, 'invalid_receipt_id');
    check(['accept', 'revise', 'reject'].includes(data.verdict), 400, 'invalid_verdict');
    check(data.note === undefined || text(data.note, RK_LIMITS.summary), 400, 'invalid_note');
    const receipt = rk.receipts.find(r => r.id === data.receipt_id);
    check(receipt, 404, 'receipt_not_found');
    check(principalLabel(receipt.by) !== principalLabel(principal), 403, 'self_review');
    const plan = approvedPlan(rk, receipt.task_id);
    check(plan && receipt.validity === 'current' && plan.version === receipt.plan_version && latestReceipt(rk, receipt.task_id, plan.version)?.id === receipt.id && effectiveOutcome(rk, receipt) === 'succeeded', 409, 'receipt_not_reviewable');
    check(!decisionOn(rk, 'receipt', receipt.id), 409, 'receipt_already_decided');
    const prior = rk.reviews.filter(v => v.receipt_id === receipt.id);
    check(!prior.some(v => v.verdict !== 'accept'), 409, 'review_closed', 'A reviewer already asked for changes or rejected this result. The owner decides next.');
    check(!prior.some(v => principalLabel(v.by) === principalLabel(principal)), 409, 'already_reviewed');
    cap(rk, 'reviews', principal);
    const mode = principal.kind === 'delegated_agent' ? 'independent' : 'advisory';
    const review = { id: 'rvw_' + uuid(), receipt_id: receipt.id, task_id: receipt.task_id, plan_version: receipt.plan_version, verdict: data.verdict, mode, basis: mode === 'independent' ? 'separate_agent_credential' : 'shared_owner_credential', by: principalRecord(principal), at, ...(data.note ? { note: data.note } : {}) };
    rk.reviews.push(review);
    return { task_id: receipt.task_id, subject: review.id, review_id: review.id, mode, satisfies_independent: mode === 'independent' };
  },
  async 'rk.decide'({ rk, pound, data, principal, at, now, ctx }) {
    ownerOnly(principal);
    only(data, ['subject', 'id', 'decision', 'plan_version', 'attempts', 'note', 'basis'], ['subject', 'id', 'decision']);
    check(data.note === undefined || text(data.note, RK_LIMITS.note), 400, 'invalid_note');
    cap(rk, 'decisions', principal);
    check(typeof data.id === 'string' && data.id.length <= 80, 400, 'invalid_decision_subject_id');
    // A decision's own id is unique; subject_id is the plan's task, role, receipt or budget it decides.
    const record = extra => { const d = { id: 'dcs_' + uuid(), subject: data.subject, subject_id: data.id, decision: data.decision, ...extra, ...(data.note ? { note: data.note } : {}), by: principalRecord(principal), at }; rk.decisions.push(d); return d; };
    if (data.subject === 'plan') {
      check(['approve', 'reject'].includes(data.decision) && int(data.plan_version, 1, 100000), 400, 'invalid_decision');
      const task = liveTask(pound, data.id);
      const plan = rk.plans.find(p => p.task_id === task.id && p.version === data.plan_version);
      check(plan && plan.status === 'proposed', 409, 'plan_not_pending');
      if (data.decision === 'approve') {
        // Approving someone else's proposal must name what you saw (the card's basis).
        check(data.basis !== undefined, 400, 'basis_required', 'Send the basis shown on the card you are approving.');
        await checkBasis(data, task, pound);
        check(!cycleWith(rk, pound, task.id, plan.depends_on), 409, 'dependency_cycle');
        for (const p of rk.plans) if (p.task_id === task.id && p !== plan && p.status === 'approved') p.status = 'superseded';
        plan.status = 'approved';
        plan.approved_at = at;
        // Evidence binds to the task text the owner actually approved, and the approval records
        // the Pound blockers in force (see rk.plan).
        plan.task_fp = await taskFingerprint(task);
        plan.pound_blockers = liveBlockers(pound, task.id);
        supersedeClaims(rk, task.id, now, at);
      } else await retireProposal(plan, 'rejected', at);
      const d = record({ plan_version: plan.version });
      return { task_id: task.id, subject: d.id, decision_id: d.id, plan_status: plan.status };
    }
    if (data.subject === 'role') {
      check(['approve', 'reject', 'revoke'].includes(data.decision), 400, 'invalid_decision');
      const role = rk.roles.find(r => r.id === data.id);
      check(role, 404, 'role_not_found');
      const state = roleState(role);
      if (data.decision === 'approve') { check(state === 'accepted', 409, 'role_not_accepted', 'A role is approved only after the seat accepts it with its own key.'); }
      else if (data.decision === 'reject') check(['proposed', 'accepted'].includes(state), 409, 'role_not_open');
      else check(state === 'effective', 409, 'role_not_effective');
      const d = record({});
      role[{ approve: 'approval', reject: 'rejection', revoke: 'revocation' }[data.decision]] = { decision_id: d.id, at };
      if (data.decision === 'revoke') for (const c of rk.claims) if (c.state === 'active' && c.by.kind === 'owner_key' && c.by.key_label === role.key_label && c.seat === role.seat) { c.state = 'superseded'; c.closed_at = at; }
      return { subject: d.id, decision_id: d.id, role_id: role.id, state: roleState(role) };
    }
    if (data.subject === 'uncertain') {
      // Any uncertain outcome can be reconciled, from any plan version and whether or not it
      // still counts as evidence: the external effect is real either way.
      check(RX.receipt.test(data.id), 400, 'invalid_receipt_id');
      check(['landed', 'not_landed'].includes(data.decision), 400, 'invalid_decision');
      const receipt = rk.receipts.find(r => r.id === data.id);
      check(receipt, 404, 'receipt_not_found');
      check(receipt.outcome === 'uncertain' && !decisionOn(rk, 'uncertain', receipt.id), 409, 'nothing_to_reconcile');
      const d = record({ plan_version: receipt.plan_version });
      return { task_id: receipt.task_id, subject: d.id, decision_id: d.id };
    }
    if (data.subject === 'receipt') {
      check(RX.receipt.test(data.id), 400, 'invalid_receipt_id');
      check(['accept', 'revise', 'reject'].includes(data.decision), 400, 'invalid_decision');
      const receipt = rk.receipts.find(r => r.id === data.id);
      check(receipt, 404, 'receipt_not_found');
      const plan = approvedPlan(rk, receipt.task_id);
      check(plan && receipt.validity === 'current' && plan.version === receipt.plan_version && latestReceipt(rk, receipt.task_id, plan.version)?.id === receipt.id, 409, 'receipt_not_current');
      check(effectiveOutcome(rk, receipt) === 'succeeded', 409, 'receipt_not_successful');
      check(!decisionOn(rk, 'receipt', receipt.id), 409, 'receipt_already_decided');
      // No override: if the review requirement is wrong, amend the plan on the record.
      if (data.decision === 'accept') {
        check(reviewState(rk, plan, receipt).ok, 409, 'review_not_satisfied', plan.review);
        // Accept only what can make the task done now: the approved task text, pin and Lab link,
        // and every dependency accepted at the evidence this result relied on.
        const d = (await rkDerive(rk, pound, now, ctx)).tasks.get(receipt.task_id);
        check(d?.evidenceCurrent && d.evidence.receipt?.id === receipt.id, 409, 'receipt_not_current_version', (d?.reasons || []).map(r => r.code));
      }
      const d = record({ plan_version: receipt.plan_version });
      return { task_id: receipt.task_id, subject: d.id, decision_id: d.id };
    }
    if (data.subject === 'budget') {
      check(data.decision === 'extend' && int(data.attempts, 1, 3), 400, 'invalid_decision');
      const task = liveTask(pound, data.id);
      const plan = approvedPlan(rk, task.id);
      check(plan && data.plan_version === plan.version, 409, 'stale_plan');
      const d = record({ plan_version: plan.version, attempts: data.attempts });
      return { task_id: task.id, subject: d.id, decision_id: d.id };
    }
    fail(400, 'invalid_decision_subject');
  },
};
async function ownClaim(rk, data, principal) {
  check(RX.task.test(data.task_id || '') && RX.claim.test(data.claim_id || ''), 400, 'invalid_claim_reference');
  check(typeof data.lease_secret === 'string' && RX.secret.test(data.lease_secret), 400, 'invalid_lease_secret');
  const claim = rk.claims.find(c => c.id === data.claim_id && c.task_id === data.task_id);
  check(claim, 404, 'claim_not_found');
  check(principalLabel(claim.by) === principalLabel(principal), 403, 'claimant_mismatch');
  check(claim.lease_sha256 === await sha256Hex(data.lease_secret), 403, 'lease_secret_mismatch');
  return claim;
}
// A proposal that was never approved keeps a fingerprint once it is replaced or rejected, not its
// text: approved versions are the plan's history, and stale proposals must not fill the store.
async function retireProposal(p, status, at) {
  const kept = { task_id: p.task_id, version: p.version, status, by: p.by, at: p.at, retired_at: at, content_sha256: await sha256Hex(canonical(p)) };
  for (const k of Object.keys(p)) delete p[k];
  Object.assign(p, kept);
}
function supersedeClaims(rk, taskId, now, at) {
  for (const c of rk.claims) if (c.task_id === taskId && c.state === 'active') { c.state = claimLive(c, now) ? 'superseded' : 'expired'; c.closed_at = at; }
}

/* Apply one operation. Returns {rk, result, changed}. The input store object is never mutated,
 * so a failed check leaves nothing half-written for the caller to commit. */
export async function rkApply(rkIn, pound, input, principal, now, ctx = {}) {
  verifiedPrincipal(principal);
  check(isObj(input) && Object.keys(input).every(k => ['op', 'request_id', 'data'].includes(k)), 400, 'invalid_request');
  check(RK_OPS.includes(input.op), 400, 'unknown_operation');
  check(typeof input.request_id === 'string' && RX.request.test(input.request_id), 400, 'request_id_required');
  check(isObj(input.data), 400, 'data_object_required');
  check(enc.encode(JSON.stringify(input)).length <= RK_LIMITS.request_bytes, 413, 'request_too_large');
  if (principal.kind === 'owner_key') check(RK_CONNECTOR_OPS.includes(input.op), 403, 'owner_session_required');
  const who = principalLabel(principal);
  const fingerprint = await sha256Hex(canonical({ op: input.op, data: input.data }));
  const prior = rkIn.idem.find(x => x.p === who && x.k === input.request_id);
  if (prior) {
    check(prior.f === fingerprint, 409, 'idempotency_conflict');
    return { rk: rkIn, result: { ...prior.r, replayed: true }, changed: false };
  }
  const rk = structuredClone(rkIn);
  const at = iso(now);
  const out = await OPS[input.op]({ rk, pound, data: input.data, principal, now, at, ctx });
  // A possible external effect must always be recordable, so an uncertain report skips the headroom.
  if (principal.kind !== 'owner_session' && !(input.op === 'rk.report' && input.data.outcome === 'uncertain')) {
    const bytes = enc.encode(JSON.stringify(rk)).length, limit = Math.floor(RK_LIMITS.bytes * 0.75);
    check(bytes <= limit, 409, 'robokap_capacity', { list: 'bytes', used: bytes, limit });
  }
  rk.rev += 1;
  addEvent(rk, at, input.op, principal, { task_id: out.task_id, subject: out.subject, session_ref: out.session_ref });
  const { session_ref: _declared, ...visible } = out;
  const result = { ...visible, op: input.op, rk_revision: rk.rev };
  rk.idem.push({ p: who, k: input.request_id, f: fingerprint, r: result });
  // Over the limit, drop the oldest entry of whoever holds the most, so one busy key cannot push
  // the owner's or another key's recent requests out of the replay window.
  while (rk.idem.length > RK_LIMITS.idem) {
    const counts = new Map();
    for (const x of rk.idem) counts.set(x.p, (counts.get(x.p) || 0) + 1);
    let heavy = who;
    for (const [p, n] of counts) if (n > (counts.get(heavy) || 0)) heavy = p;
    rk.idem.splice(rk.idem.findIndex(x => x.p === heavy), 1);
  }
  return { rk, result: { ...result, replayed: false }, changed: true };
}

/* Flat tool input schemas: several MCP clients reject a top-level oneOf. Exact per-op rules
 * live in the descriptions and in server validation. */
export const RK_TOOL_DESCRIPTION = 'One RoboKap coordination write. Read first (dd_owner_robokap_read) for plan_version, pin versions and ids. '
  + 'Ops for a connector key: rk.role.accept {role_id} (only the key a role names can accept it); rk.claim {task_id, plan_version, pin_version (when the plan pins context), session_ref, lease_secret (fresh random 22-80 chars [A-Za-z0-9_-] you keep; resend the same values to renew until max_expires_at; renewal is refused once the task, pin, Lab link or a dependency changes)}; '
  + 'rk.release {task_id, claim_id, lease_secret}; rk.report {task_id, claim_id, lease_secret, outcome succeeded|failed|uncertain, summary 1-2000, artifacts? up to 8 of {kind pound_context|lab_receipt|lab_discussion|github_commit|github_pr|claude_artifact|discord_message|url|note, ref?, sha256?, note?}}; '
  + 'rk.review {receipt_id, verdict accept|revise|reject, note?} (connector-key reviews are advisory, never independent; a revise or reject closes review for the owner); rk.plan {task_id, expected_plan_version, seat claude|grok|gemini|muse|dot|owner, review none|advisory|independent, decision required|not_required, data_scope none|synthetic|development, priority? 1-5 (1 most urgent, default 3), session_ref?, role?, depends_on?, pin? {kind, version, require approved|any, project_id?}, acceptance? [{text, check_ref?}], lab? {hypothesis_id, hypothesis_version, evidence required|optional}, budget? {attempts 1-5, lease_minutes 5-120}, thread? {discord_thread_id}, note?} is recorded as a PROPOSAL for the owner; '
  + 'rk.role.propose {seat, key_label, role, scope?} is a proposal. Pins and decisions belong to the signed owner. After a timeout resend the identical call; after 409 read before acting. Text you send is stored as untrusted and labelled as declared.';
