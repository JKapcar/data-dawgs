import {renderMessages,renderDiscussion,renderMail} from './sled-message-ui.mjs';

// Pack Sled owner board. Private UI: memory only, no persistence, telemetry or third-party code.
// Lanes are computed by the Worker from recorded claims, receipts, reviews and decisions;
// this page renders them and sends owner decisions. Success is shown only after the server says so.
const API = 'https://toto.jkapcar4.workers.dev/robokap/v1';
const $ = id => document.getElementById(id);
const LANES = [
  ['needs_you', 'Needs you', 'Decisions, re-approvals and your own tasks.'],
  ['review', 'Review', 'A result is in and waits for its required review.'],
  ['running', 'Running', 'A lease is held. Progress is unverified until a receipt arrives.'],
  ['ready', 'Ready', 'Approved and unblocked. Waiting for the named seat to claim it.'],
  ['blocked', 'Blocked', 'Waiting on a dependency, a seat\'s acceptance or a check that cannot run.'],
  ['done', 'Done', 'Accepted at the current version, with evidence.'],
];
const ORDER = ['needs_you', 'ready', 'running', 'blocked', 'review', 'done'];
const LINK_HOSTS = ['github.com', 'claude.ai', 'discord.com', 'www.kaggle.com', 'kaggle.com', 'datadawgs216.com', 'www.datadawgs216.com'];
const VERIFY = { server_verified: 'server-verified', format_checked: 'format checked', commit_and_hash_recorded: 'commit and hash recorded', owner_attested: 'your attestation', claimed: 'declared', unverified_lab_unavailable: 'Lab unavailable: unchecked' };
const SEATS = { claude: 'Claude', 'claude-reviewer': 'Claude reviewer', coordinator: 'Coordinator', grok: 'Grok', gemini: 'Gemini', muse: 'Muse', dot: 'Scout/dot', owner: 'You' };
const SCOPES = { 'sled:work:read': 'read', 'sled:work:claim': 'claim and report', 'sled:review': 'review', 'sled:coordinate': 'coordinate' };
const BASIS = { owner_decision: 'accepted by you', playbook_after_independent_review: 'accepted by your playbook after an independent review', plan_without_owner_decision: 'accepted under a plan that needed no decision' };
const WORKER = { idle: 'idle', working: 'working', silent: 'silent: no recent check-in', credential_inactive: 'credential expired or revoked' };
const VERIFY_EXTRA = { hash_recorded: 'hash recorded' };
const FIELD = { reviewer_seat: 'Reviewer seat', evidence_required: 'Evidence', seat: 'Seat', session_ref: 'Target session', role: 'Required role', priority: 'Priority', depends_on: 'Depends on', pin: 'Pinned context', acceptance: 'Acceptance', review: 'Review', decision: 'Your decision', lab: 'Lab link', data_scope: 'Data scope', budget: 'Budget', thread: 'Discord thread', note: 'Note' };
const CAUSE = { plan_changed: 'the plan changed', task_changed: 'the task text changed', dependency_not_accepted: 'a dependency is no longer accepted', dependency_changed: 'a dependency was redone', lab_link_stale: 'the Lab hypothesis moved on', pin_superseded: 'a newer pin exists', pin_not_approved: 'the pin is a draft', pin_behind_context: 'the context has a newer version', pin_missing: 'the pin is missing', pin_context_missing: 'the pinned context is gone', pin_hash_mismatch: 'the pinned context hash changed' };
let epoch = 0, board = null, lane = null, laneChosen = false, busy = false;
// Writes that got no definite answer, and your own tasks in flight (lease secret and claim), live in
// memory only. They survive hiding the tab for the same account, so a resend is the identical
// request, and are dropped when the account changes or signs out.
let pending = null, flowToken = '';
const ownerFlows = new Map();
// The current plan an amendment starts from, so fields the form cannot edit are carried, not dropped.
let carry = null;

const token = () => { try { return localStorage.getItem('dd-bozo-sess') || ''; } catch { return ''; } };
function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v; else if (k === 'on') for (const [e, f] of Object.entries(v)) n.addEventListener(e, f); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}
function ago(at) {
  const ms = Date.now() - Date.parse(at);
  if (!Number.isFinite(ms)) return 'unknown time';
  const m = Math.round(Math.abs(ms) / 60000), past = ms >= 0;
  const span = m < 1 ? 'under a minute' : m < 90 ? m + ' min' : m < 2880 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' days';
  return past ? span + ' ago' : 'in ' + span;
}
const when = at => el('time', { datetime: at, title: at, text: ago(at) });
function refText(ref) {
  let url = null; try { url = new URL(ref); } catch {}
  if (url && url.protocol === 'https:' && LINK_HOSTS.includes(url.hostname) && !url.username && !url.password) return el('a', { href: url.href, target: '_blank', rel: 'noopener noreferrer', text: ref });
  return document.createTextNode(ref);
}
function note(text) { $('rkStatus').textContent = text; showResend(); }
// A write with no definite answer can be resent from here even after its card has changed.
function showResend() {
  const b = $('rkResend');
  b.hidden = !(pending && board);
  if (pending) b.textContent = 'Resend "' + pending.label + '"';
}
// Drop in-memory work when the signed-in account is no longer the one it was made under.
function forgetIfAccountChanged() {
  if (flowToken && flowToken !== token()) { pending = null; ownerFlows.clear(); carry = null; }
  flowToken = token();
}
function clearView() {
  $('rkMail').hidden=true; $('rkMailList').replaceChildren();
  $('rkDiscussion').hidden=true; $('rkDiscussionList').replaceChildren(); $('rkDiscussionForm').reset(); $('rkDiscussionForm').elements.thread_id.replaceChildren();
  $('rkMessages').hidden=true; $('rkMessageList').replaceChildren(); $('rkMessageForm').reset(); $('rkMessageForm').elements.route_id.replaceChildren(); $('rkMessageForm').elements.thread_id.replaceChildren();

  epoch++; board = null; laneChosen = false; carry = null;
  for (const id of ['rkCards', 'rkRoleList', 'rkPinList', 'rkUnplannedList', 'rkTabs', 'rkBar', 'rkEvidenceList', 'rkPlaybookList', 'rkWorkerList', 'rkIntakeList', 'rkNoticeList', 'rkCapacity']) $(id).replaceChildren();
  $('rkEvidence').hidden = true;
  for (const id of ['rkSummary', 'rkLane', 'rkRoles', 'rkOwnerForms', 'rkPins', 'rkUnplanned', 'rkResend', 'rkTeam', 'rkCapacity']) $(id).hidden = true;
  // Forms and the task lists inside them hold private titles: reset and empty them too.
  for (const id of ['rkPlanForm', 'rkPinForm', 'rkRoleForm', 'rkPlaybookForm']) $(id).reset();
  const f = $('rkPlanForm').elements;
  for (const s of [f.task_id, f.depends_on, f.pin, $('rkPinForm').elements.context_id, $('rkPlaybookForm').elements.task_id, $('rkPlaybookForm').elements.criteria]) s.replaceChildren();
  $('rkPlanCarry').replaceChildren();
  $('rkPlanCarry').hidden = true;
  for (const id of ['rkPlanBox', 'rkPinBox', 'rkRoleBox', 'rkPlaybookBox']) $(id).open = false;
  globalThis.DDAccount?.reset();
}
async function request(body) {
  const credential = token(), generation = epoch;
  if (!credential) throw Object.assign(new Error('Sign in to DataDawgs in this browser, then return here.'), { status: 401 });
  const res = await fetch(API, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Authorization: 'Bearer ' + credential, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let data = null;
  try { data = await res.json(); } catch { if (res.ok) throw Object.assign(new Error('Unreadable answer from the server.'), { uncertain: true }); }
  if (generation !== epoch || credential !== token() || document.hidden) throw Object.assign(new Error('Account changed. Refresh the board.'), { aborted: true });
  if (!res.ok) {
    globalThis.DDAccount?.failed(res.status);
    const known = { robokap_disabled: 'Pack Sled coordination is not switched on for this Worker yet.', configured_owner_required: 'Only the configured owner can open this board.' };
    const detail = data?.detail;
    throw Object.assign(new Error(known[data?.error] || (data?.error || 'Request failed') + (detail ? ' · ' + (Array.isArray(detail) ? detail.join(', ') : typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')), { status: res.status });
  }
  globalThis.DDAccount?.verified(credential);
  return data;
}
async function load(prefix = '') {
  clearView();
  forgetIfAccountChanged();
  if (!token()) { note('Sign in to open your board.'); return; }
  note(prefix + 'Loading your board…');
  try { const data = await request(); board = data.board; render(); note(prefix + 'Board as of ' + new Date(board.as_of).toLocaleString() + ' · revision ' + board.rk_revision + (pending ? ' · "' + pending.label + '" is waiting for a resend.' : '')); }
  catch (e) { if (!e.aborted) note(prefix + e.message); }
}
// One owner write. A server error or no answer keeps the identical request for an explicit retry:
// the server replays a request it already committed instead of acting twice.
async function act(op, data, label) {
  if (busy || !board) return false;
  const signature = JSON.stringify({ op, data });
  if (!pending || pending.signature !== signature) pending = { signature, label, body: { op, request_id: crypto.randomUUID(), data } };
  busy = true; document.body.classList.add('rk-busy'); note(label + ': sending…');
  try {
    const out = await request(pending.body);
    pending = null;
    if (out.board) { board = out.board; render(); note(label + ': saved' + (out.result?.replayed ? ' (already recorded)' : '') + '. Board revision ' + board.rk_revision + '.'); }
    else { const saved = label + ': saved' + (out.result?.replayed ? ' (already recorded)' : '') + '. '; note(saved + 'Reloading the board…'); setTimeout(() => load(saved), 0); }
    return out.result;
  } catch (e) {
    if (e.aborted) return false;
    if (e.status && e.status < 500) { pending = null; note(label + ': not saved · ' + e.message); }
    else note(label + ': ' + (e.status ? 'the server could not confirm it (' + e.message + ')' : 'no answer from the server') + '. Nothing is assumed saved. Press the same button again to resend the identical request.');
    return false;
  } finally { busy = false; document.body.classList.remove('rk-busy'); }
}
const button = (text, onClick, cls) => el('button', { type: 'button', class: cls, text, on: { click: onClick } });
const randomSecret = () => { const b = crypto.getRandomValues(new Uint8Array(24)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

function actionsFor(card) {
  const box = el('div', { class: 'rk-actions' }), codes = new Set(card.reasons.map(r => r.code));
  const receipt = card.evidence?.receipt_id;
  if ((codes.has('plan_proposed') || codes.has('plan_amendment_proposed')) && card.pending_plan) {
    const v = card.pending_plan.version;
    // The approval names what you saw: if the task text or its Pound blockers changed since, it is refused.
    box.append(button('Approve plan v' + v, () => act('rk.decide', { subject: 'plan', id: card.task_id, plan_version: v, decision: 'approve', ...(card.basis ? { basis: card.basis } : {}) }, 'Approve plan')), button('Reject plan v' + v, () => act('rk.decide', { subject: 'plan', id: card.task_id, plan_version: v, decision: 'reject' }, 'Reject plan'), 'secondary'));
  }
  if (codes.has('decide_receipt') && receipt) box.append(button('Accept result', () => act('rk.decide', { subject: 'receipt', id: receipt, decision: 'accept' }, 'Accept result')), button('Ask for revision', () => act('rk.decide', { subject: 'receipt', id: receipt, decision: 'revise' }, 'Ask for revision'), 'secondary'), button('Reject', () => act('rk.decide', { subject: 'receipt', id: receipt, decision: 'reject' }, 'Reject result'), 'secondary'));
  if (codes.has('review_rejected') && receipt) box.append(button('Ask for revision', () => act('rk.decide', { subject: 'receipt', id: receipt, decision: 'revise' }, 'Ask for revision')), button('Close as rejected', () => act('rk.decide', { subject: 'receipt', id: receipt, decision: 'reject' }, 'Reject result'), 'secondary'));
  // Accepted work that needed no decision can still be sent back.
  if (card.lane === 'done' && receipt && !card.evidence.decision) box.append(button('Send back for revision', () => act('rk.decide', { subject: 'receipt', id: receipt, decision: 'revise' }, 'Ask for revision'), 'secondary'));
  if (codes.has('budget_exhausted') && card.plan) box.append(button('Allow one more attempt', () => act('rk.decide', { subject: 'budget', id: card.task_id, plan_version: card.plan.version, decision: 'extend', attempts: 1 }, 'Extend budget')));
  if (codes.has('owner_task') && card.plan && !card.claim) box.append(button('Record it done', () => ownerDone(card, box)));
  if (card.claim?.by_owner && ownerFlows.has(card.task_id)) box.append(button('Finish recording', () => finishOwner(card.task_id)));
  if (card.claim) box.append(button('Stop this lease', () => act('rk.release', { task_id: card.task_id, claim_id: card.claim.id }, 'Stop lease').then(done => { if (done) ownerFlows.delete(card.task_id); }), 'secondary'));
  if (['task_changed', 'pin_superseded', 'pin_not_approved', 'pin_missing', 'pin_behind_context', 'pin_context_missing', 'pin_hash_mismatch', 'lab_link_stale', 'lab_hypothesis_missing', 'lab_hypothesis_withdrawn', 'dependency_closed', 'dependency_missing', 'dependency_cycle', 'propose_role'].some(c => codes.has(c)) || card.lane === 'unplanned') box.append(button(card.plan ? 'Amend plan' : 'Plan this task', () => openPlan(card.task_id), 'secondary'));
  if (codes.has('approve_role')) box.append(button('Open role decisions', () => $('rkRoles').scrollIntoView({ block: 'start' }), 'secondary'));
  return box.childNodes.length ? box : null;
}
// Your own task: claim it as the owner, then report it with what you attach. Two recorded steps.
// If the claim's answer was lost, the board still shows the lease, and the secret is still here.
async function finishOwner(taskId) {
  const flow = ownerFlows.get(taskId), card = allCards().find(c => c.task_id === taskId);
  const claimId = flow?.claim?.claim_id || (card?.claim?.by_owner ? card.claim.id : null);
  if (!flow || !claimId) return;
  const done = await act('rk.report', { task_id: taskId, claim_id: claimId, lease_secret: flow.lease, outcome: 'succeeded', summary: flow.summary, artifacts: flow.artifacts }, 'Record your task');
  if (done) ownerFlows.delete(taskId);
}
function ownerDone(card, box) {
  if (box.querySelector('form')) return;
  const summary = el('textarea', { rows: '3', maxlength: '2000', required: true, 'aria-label': 'What you did' });
  const link = el('input', { type: 'url', maxlength: '2000', placeholder: 'https:// evidence link (optional)', 'aria-label': 'Evidence link' });
  const form = el('form', { class: 'rk-inline', novalidate: true }, el('label', { text: 'What you did' }, summary), el('label', { text: 'Evidence link' }, link), el('button', { type: 'submit', text: 'Save as done' }));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!summary.value.trim()) { note('Describe what you did first.'); return; }
    const flow = ownerFlows.get(card.task_id) || { lease: randomSecret() };
    flow.summary = summary.value.trim();
    flow.artifacts = link.value.trim() ? [{ kind: 'url', ref: link.value.trim() }] : [{ kind: 'note', note: 'Recorded by the owner on the board.' }];
    ownerFlows.set(card.task_id, flow);
    if (!flow.claim) {
      const claimed = await act('rk.claim', { task_id: card.task_id, plan_version: card.plan.version, ...(card.plan.pin ? { pin_version: card.plan.pin.version } : {}), lease_secret: flow.lease }, 'Start your task');
      if (!claimed) return;
      flow.claim = claimed;
    }
    await finishOwner(card.task_id);
  });
  box.append(form);
  summary.focus();
}
const show = v => v === null || v === undefined ? 'none' : Array.isArray(v) ? (v.length ? v.map(show).join('; ') : 'none') : typeof v === 'object' ? (v.text ?? (v.kind ? v.kind.replace(/_/g, ' ') + ' v' + v.version + (v.require ? ' (' + v.require + ')' : '') : v.hypothesis_id ? v.hypothesis_id + ' v' + v.hypothesis_version + ' · evidence ' + v.evidence : v.attempts ? v.attempts + ' attempts · ' + v.lease_minutes + ' min leases' : v.discord_thread_id ?? JSON.stringify(v))) : String(v);
const titleOf = taskId => allCards().find(c => c.task_id === taskId)?.title || taskId;
function pendingView(card) {
  const p = card.pending_plan;
  const rows = el('dl', { class: 'rk-facts' });
  for (const c of p.changes) rows.append(el('dt', { text: FIELD[c.field] || c.field }), el('dd', {}, el('s', { text: c.field === 'depends_on' ? show((c.from || []).map(titleOf)) : show(c.from) }), ' → ', el('b', { text: c.field === 'depends_on' ? show((c.to || []).map(titleOf)) : show(c.to) })));
  return el('details', { class: 'rk-proposal', open: true }, el('summary', { text: 'Proposed plan v' + p.version + ' · ' + p.proposed_by }),
    p.changes.length ? rows : el('p', { class: 'rk-help', text: card.plan ? 'Same fields as the current plan.' : 'A first plan for this task.' }),
    p.drops_dependencies.length ? el('p', { class: 'rk-warn', text: 'Approving this stops enforcing: ' + p.drops_dependencies.map(d => d.title || d.id).join(', ') + '. Those blockers were removed outside the plan.' }) : null,
    card.plan ? null : el('p', { class: 'rk-help', text: SEATS[p.seat] + ' · review ' + p.review + ' · your decision ' + p.decision.replace('_', ' ') + ' · data ' + p.data_scope + ' · priority ' + p.priority }));
}
function cardView(card) {
  const owner = card.owner ? SEATS[card.owner.seat] + (card.owner.holder ? ' · ' + card.owner.holder : card.owner.key_label ? ' · key ' + card.owner.key_label : '') + (card.owner.role ? ' · role ' + card.owner.role.state : '') : 'No plan';
  const chips = el('ul', { class: 'rk-chips' },
    card.plan ? el('li', { class: 'rk-chip', text: 'P' + card.priority }) : null,
    card.project ? el('li', { class: 'rk-chip', text: card.project }) : null,
    el('li', { class: 'rk-chip strong', text: owner }),
    card.plan ? el('li', { class: 'rk-chip', text: 'plan v' + card.plan.version }) : null,
    card.plan && card.plan.review !== 'none' ? el('li', { class: 'rk-chip', text: card.plan.review + ' review' }) : null,
    card.plan && card.plan.decision === 'required' ? el('li', { class: 'rk-chip', text: 'your decision' }) : null,
    card.owner?.session_ref_target ? el('li', { class: 'rk-chip', text: 'session ' + card.owner.session_ref_target + ' (declared)' }) : null,
    card.plan?.approved_via?.kind === 'owner_playbook' ? el('li', { class: 'rk-chip', text: 'via playbook ' + card.plan.approved_via.playbook_id + ' v' + card.plan.approved_via.playbook_version }) : null,
    card.plan?.reviewer_seat ? el('li', { class: 'rk-chip', text: 'reviewer ' + (SEATS[card.plan.reviewer_seat] || card.plan.reviewer_seat) }) : null);
  // What is really happening, from stored records only.
  const exec = card.execution ? el('p', { class: 'rk-exec x-' + card.execution.state }, el('b', { text: card.execution.state.replace(/_/g, ' ') }), ' · ' + card.execution.text) : null;
  const facts = el('dl', { class: 'rk-facts' });
  const fact = (k, v) => facts.append(el('dt', { text: k }), el('dd', {}, v));
  if (card.dependencies.length) fact('Depends on', el('ul', { class: 'rk-deps' }, card.dependencies.map(d => el('li', { class: 'rk-dep ' + (d.accepted ? 'ok' : d.closed || d.missing || d.cycle ? 'bad' : 'wait'), text: (d.title || d.id) + ' · ' + (d.accepted ? 'accepted' : d.cycle ? 'in a cycle' : d.closed ? d.closed : d.missing ? 'missing' : d.lane.replace('_', ' ')) + (d.source === 'pound_live' ? ' · live Pound edge, not yet in an approved plan' : '') }))));
  if (card.claim) {
    fact('Lease', el('span', {}, card.claim.by + ' · session ' + (card.claim.session_ref_declared || 'none') + ' (declared) · attempt ' + card.claim.attempt + ' · expires ', when(card.claim.expires_at), ' · renewals stop ', when(card.claim.max_expires_at)));
    fact('Executor', document.createTextNode((card.claim.executor_declared || 'not declared') + (card.claim.model_declared ? ' · model ' + card.claim.model_declared : '') + ' (declared, unverified)' + (card.claim.resumes ? ' · resumed ' + card.claim.resumes + ' time' + (card.claim.resumes === 1 ? '' : 's') : '')));
    fact('Last check-in', card.claim.heartbeat_at ? when(card.claim.heartbeat_at) : document.createTextNode('none yet'));
    if (card.claim.checkpoints.length) fact('Checkpoints', el('ol', { class: 'rk-steps' }, card.claim.checkpoints.map(c => el('li', {}, c.step + (c.note ? ' · ' + c.note : '') + ' · ', when(c.at)))));
  }
  const stale = card.reasons.find(r => r.code === 'lease_stale');
  if (stale) fact('Lease is stale', document.createTextNode((stale.detail?.causes || []).map(c => CAUSE[c] || c.replace(/_/g, ' ')).join('; ') + '. Its result will not count.'));
  if (card.plan?.attempts) fact('Attempts', document.createTextNode(card.plan.attempts.used + ' of ' + card.plan.attempts.limit + ' used'));
  fact('Last verified', card.last_verified ? el('span', {}, card.last_verified.op.replace('rk.', '') + ' · ' + card.last_verified.by_text + ' · ', when(card.last_verified.at)) : document.createTextNode('Nothing recorded yet'));
  fact('Reported', document.createTextNode((card.reported.status || 'no status') + ' · ' + (card.reported.source || '').replace(/_/g, ' ') + (card.reported.note ? ' · ' + card.reported.note : '')));
  const next = card.next ? el('p', { class: 'rk-next' }, el('b', { text: 'Next · ' + ({ owner: 'you', seat: 'the seat', reviewer: 'a reviewer', dependency: 'a dependency', system: 'a check' }[card.next.actor] || card.next.actor) }), card.next.text) : null;
  const brief = card.brief ? el('details', {}, el('summary', { text: 'Task brief' }), el('p', { class: 'rk-brief', text: card.brief }), card.refs.length ? el('ul', { class: 'rk-artifacts' }, card.refs.map(r => el('li', {}, refText(String(r))))) : null) : null;
  const unsure = card.unreconciled.length ? el('div', { class: 'rk-reconcile' }, card.unreconciled.map(u => el('div', {},
    el('p', {}, el('b', { text: 'Did it land? ' }), 'Attempt ' + u.attempt + ' (plan v' + u.plan_version + ') by ' + u.by + ', ', when(u.at), ': ' + u.summary),
    el('div', { class: 'rk-actions' }, button('It landed', () => act('rk.decide', { subject: 'uncertain', id: u.receipt_id, decision: 'landed' }, 'Record: landed')), button('It did not land', () => act('rk.decide', { subject: 'uncertain', id: u.receipt_id, decision: 'not_landed' }, 'Record: not landed'), 'secondary'))))) : null;
  let evidence = null;
  if (card.evidence) {
    const ev = card.evidence;
    evidence = el('details', {}, el('summary', { text: 'Evidence · ' + ev.outcome + ' · ' + ev.artifacts.length + ' artifact' + (ev.artifacts.length === 1 ? '' : 's') + (ev.late ? ' · late' : '') + (ev.current ? '' : ' · does not count now') }),
      el('p', {}, 'Receipt from ' + ev.by + ', session ' + (ev.session_ref_declared || 'none') + ' (declared), ', when(ev.at), '.'),
      el('p', { text: ev.summary }),
      el('ul', { class: 'rk-artifacts' }, ev.artifacts.map(a => el('li', {}, el('span', { text: a.kind.replace('_', ' ') + ': ' }), a.ref ? refText(a.ref) : document.createTextNode(a.note || ''), el('span', { class: 'rk-badge v-' + a.verification, text: VERIFY[a.verification] || VERIFY_EXTRA[a.verification] || a.verification })))),
      ev.criteria ? el('p', { class: 'rk-help', text: 'Bound to brief v' + ev.criteria.pin_version + (ev.criteria.sha256 ? ' · ' + ev.criteria.sha256.slice(0, 12) + '…' : '') }) : null,
      ev.claims.length ? el('ol', { class: 'rk-claims' }, ev.claims.map(c => el('li', { class: 'support-' + c.support }, el('span', { class: 'rk-badge', text: c.support }), ' ' + c.text, c.sources.length ? el('ul', {}, c.sources.map(x => el('li', {}, refText(x.url), ' · seen ', when(x.observed_at)))) : null))) : null,
      ev.gaps.length ? el('div', {}, el('b', { text: 'Still unknown' }), el('ul', {}, ev.gaps.map(g => el('li', { text: g })))) : null,
      ...(ev.reviews || []).map(v => el('div', { class: 'rk-review' }, el('p', { text: 'Review: ' + v.verdict + ' · ' + v.mode + ' · ' + v.by + (v.note ? ' · ' + v.note : '') }),
        v.checks.length ? el('ul', {}, v.checks.map(c => el('li', { class: 'check-' + c.result, text: (typeof c.criterion === 'number' ? 'Acceptance ' + (c.criterion + 1) + (card.plan?.acceptance?.[c.criterion] ? ' (' + card.plan.acceptance[c.criterion].text + ')' : '') : c.criterion) + ': ' + c.result + (c.note ? ' · ' + c.note : '') }))) : null,
        v.sources_checked.length ? el('p', { class: 'rk-help', text: 'Sources opened: ' + v.sources_checked.map(x => x.result + (x.cited ? '' : ' (not cited)')).join(', ') }) : null)),
      ev.decision ? el('p', { text: 'Your decision: ' + ev.decision.decision }) : null,
      ev.acceptance_basis ? el('p', { class: 'rk-help', text: 'How it was accepted: ' + (BASIS[ev.acceptance_basis] || ev.acceptance_basis.replace(/_/g, ' ')) + '.' }) : null,
      el('p', { class: 'rk-help', text: 'Receipt hash ' + ev.hash.slice(0, 16) + '…' }));
  }
  return el('li', { class: 'rk-card lane-' + (card.lane === 'unplanned' ? 'blocked' : card.lane), 'data-task': card.task_id }, el('h3', { text: card.title }), chips, exec, next, card.pending_plan ? pendingView(card) : null, unsure, facts, brief, evidence, actionsFor(card));
}
function renderAlerts() {
  const alerts = board.alerts || [];
  $('rkAlertList').replaceChildren(...alerts.map(a => el('li', { class: 'rk-alert s-' + a.severity }, el('b', { text: a.severity === 'action' ? 'Action · ' : 'Watch · ' }), a.text)));
  $('rkAlerts').hidden = !alerts.length;
  const drafts = board.proposals || [];
  $('rkProposalList').replaceChildren(...drafts.map(d => el('li', {},
    el('p', {}, el('b', { text: d.type === 'pin' ? 'Brief pin · ' + d.project_id + ' · ' + d.pin_kind.replace(/_/g, ' ') : 'Playbook · ' + d.playbook.playbook_id + ' v' + (d.current_version + 1) }), ' · drafted by ' + d.by + ' ', when(d.at)),
    d.type === 'pin' ? el('p', { class: 'rk-help' }, refText(d.ref.type === 'pound_context' ? 'Pack Sled context version ' + d.ref.version : d.ref.type === 'claude_doc' ? 'Claude Doc ' + d.ref.id + ' revision ' + d.ref.rev : d.ref.path + ' @ ' + d.ref.commit.slice(0, 7)), d.verification ? el('span', { class: 'rk-badge v-' + d.verification, text: VERIFY[d.verification] || d.verification }) : null, d.current_version ? ' · replaces v' + d.current_version : '')
      : el('p', { class: 'rk-help', text: 'Research ' + (SEATS[d.playbook.seat] || d.playbook.seat) + ' · review ' + d.playbook.review + (d.playbook.reviewer_seat ? ' by ' + (SEATS[d.playbook.reviewer_seat] || d.playbook.reviewer_seat) : '') + ' · your decision ' + d.playbook.decision.replace('_', ' ') + ' · coordinator ' + (d.playbook.coordinator_seat ? SEATS[d.playbook.coordinator_seat] || d.playbook.coordinator_seat : 'key ' + d.playbook.coordinator_key) + ' · ' + (d.playbook.acceptance || []).length + ' acceptance checks · ' + d.playbook.max_runs_per_day + ' runs a day' }),
    d.note ? el('p', { class: 'rk-help', text: 'Note: ' + d.note }) : null,
    el('div', { class: 'rk-actions' }, button('Approve', () => act('rk.decide', { subject: 'proposal', id: d.id, decision: 'approve' }, 'Approve draft')), button('Reject', () => act('rk.decide', { subject: 'proposal', id: d.id, decision: 'reject' }, 'Reject draft'), 'secondary')))));
  $('rkProposals').hidden = !drafts.length;
}
function render() {
  renderAlerts();
  renderEvidence();
  const counts = board.counts, total = ORDER.reduce((n, k) => n + (counts[k] || 0), 0);
  const bar = $('rkBar');
  // CSSOM, not a style attribute: the page CSP refuses inline styles.
  bar.replaceChildren(...ORDER.filter(k => counts[k]).map(k => { const seg = el('span', { class: 'lane-' + k }); seg.style.flexGrow = String(counts[k]); return seg; }));
  bar.setAttribute('aria-label', ORDER.map(k => LANES.find(l => l[0] === k)[1] + ' ' + (counts[k] || 0)).join(', ') + (total ? '' : '. No planned work yet.'));
  if (!laneChosen) lane = ['needs_you', 'review', 'running', 'ready', 'blocked', 'done'].find(k => counts[k]) || 'needs_you';
  $('rkTabs').replaceChildren(...LANES.map(([k, label]) => el('button', { type: 'button', class: 'rk-tab lane-' + k, 'aria-pressed': String(k === lane), on: { click: () => { lane = k; laneChosen = true; render(); } } }, el('b', { text: String(counts[k] || 0) }), el('span', { text: label }))));
  $('rkSummary').hidden = false;
  const [, title, help] = LANES.find(l => l[0] === lane);
  $('rkLaneTitle').textContent = title;
  $('rkLaneHelp').textContent = help;
  const cards = lane === 'done' ? board.done : board.lanes[lane];
  $('rkCards').replaceChildren(...(cards.length ? cards.map(cardView) : [el('li', { class: 'rk-empty', text: lane === 'needs_you' ? 'Nothing needs you right now.' : 'Nothing here.' })]));
  $('rkLane').hidden = false;
  $('rkRoleList').replaceChildren(...board.role_decisions.map(r => el('li', {}, el('p', { text: SEATS[r.seat] + ' · key ' + r.key_label + ' · ' + r.role + (r.scope ? ' · ' + r.scope : '') }), el('p', { class: 'rk-help', text: 'Accepted by ' + r.accepted.by + ' (' + r.accepted.tier.replace('_', ' ') + '). That proves which key accepted, not which model.' }), el('div', { class: 'rk-actions' }, button('Approve role', () => act('rk.decide', { subject: 'role', id: r.role_id, decision: 'approve' }, 'Approve role')), button('Reject', () => act('rk.decide', { subject: 'role', id: r.role_id, decision: 'reject' }, 'Reject role'), 'secondary')))));
  const others = board.roles.filter(r => r.state !== 'accepted');
  for (const r of others) $('rkRoleList').append(el('li', {}, el('p', { text: SEATS[r.seat] + ' · key ' + r.key_label + ' · ' + r.role + ' · ' + r.state }), r.state === 'effective' ? el('div', { class: 'rk-actions' }, button('Revoke role', () => act('rk.decide', { subject: 'role', id: r.id, decision: 'revoke' }, 'Revoke role'), 'secondary')) : null));
  $('rkRoles').hidden = !board.roles.length;
  $('rkPinList').replaceChildren(...board.pins.map(p => el('li', {}, el('p', { text: p.kind.replace(/_/g, ' ') + ' · ' + p.project_id + ' · v' + p.version + ' · ' + p.status }), el('p', { class: 'rk-help' }, (p.ref.type === 'claude_doc' ? 'Claude Doc ' + p.ref.id + ' revision ' + p.ref.rev : p.ref.type === 'repo_file' ? p.ref.path + ' @ ' + p.ref.commit.slice(0, 7) : 'Pack Sled context version ' + p.ref.version), el('span', { class: 'rk-badge v-' + p.verification, text: VERIFY[p.verification] || p.verification }), ' · ' + p.history + ' version' + (p.history === 1 ? '' : 's') + ' kept'))));
  $('rkPins').hidden = !board.pins.length;
  $('rkUnplannedList').replaceChildren(...board.unplanned.map(c => el('li', {}, el('p', { text: c.title }), el('p', { class: 'rk-help', text: 'Reported ' + (c.reported.status || 'no status') + ' · ' + (c.reported.source || '').replace(/_/g, ' ') + (c.reported.note ? ' · ' + c.reported.note : '') }), el('div', { class: 'rk-actions' }, button('Plan this task', () => openPlan(c.task_id), 'secondary')))));
  $('rkUnplanned').hidden = !board.unplanned.length;
  $('rkHonesty').replaceChildren(...board.honesty.map(h => el('li', { text: h })), el('li', { text: 'Waking an assistant is unsupported here. Scheduled sessions such as Claude Code routines check the queue on their own timers; anything else needs you to open the session.' }), el('li', { text: 'Lab checks: ' + (board.lab.status === 'checked' ? 'read-only, through your research access.' : 'unavailable right now, so Lab-linked work waits.') }));
  renderTeam();
  $('rkMail').hidden=false; renderMail(board,$('rkMailList'));
  $('rkDiscussion').hidden=false; renderDiscussion(board,{root:$('rkDiscussionList'),form:$('rkDiscussionForm'),act});
  $('rkMessages').hidden=false;

  renderMessages(board,{root:$('rkMessageList'),form:$('rkMessageForm'),act});

  fillForms();
  $('rkOwnerForms').hidden = false;
  // Forget finished flows of your own: no lease on the board and nothing left to resend.
  for (const taskId of [...ownerFlows.keys()]) if (!allCards().find(c => c.task_id === taskId)?.claim && pending?.body.data.task_id !== taskId) ownerFlows.delete(taskId);
  showResend();
}
function renderTeam() {
  const pb = board.playbooks || [];
  $('rkPlaybookList').replaceChildren(...(pb.length ? pb.map(p => el('li', {},
    el('p', {}, el('b', { text: p.playbook_id }), ' v' + p.version + ' · ' + p.status + ' · ' + titleOf(p.task_id)),
    el('p', { class: 'rk-help', text: 'Research ' + (SEATS[p.seat] || p.seat) + ' · review ' + p.review + (p.reviewer_seat ? ' by ' + (SEATS[p.reviewer_seat] || p.reviewer_seat) : '') + ' · your decision ' + p.decision.replace('_', ' ') + ' · brief ' + p.criteria.project_id + (p.criteria_pin ? ' v' + p.criteria_pin.version + ' ' + p.criteria_pin.status : ' (no pin)') + ' · coordinator ' + (p.coordinator_seat ? SEATS[p.coordinator_seat] || p.coordinator_seat : 'key ' + p.coordinator_key) + ' · ' + p.runs_last_day + ' of ' + p.max_runs_per_day + ' runs in the last day · ' + p.queued_intakes.length + ' queued' }),
    el('div', { class: 'rk-actions' }, button(p.status === 'active' ? 'Pause playbook' : 'Resume playbook', () => act('rk.playbook', playbookData(p, { status: p.status === 'active' ? 'paused' : 'active' }), p.status === 'active' ? 'Pause playbook' : 'Resume playbook'), 'secondary'))))
    : [el('li', { class: 'rk-empty', text: 'No playbooks yet. Without one, every plan from a key waits for your approval.' })]));
  const workers = board.workers || [];
  const creds = board.credentials || [];
  $('rkCredentialList').replaceChildren(...(creds.length ? creds.map(c => el('li', { class: c.status !== 'active' || c.expiring ? 'rk-warn' : '' }, el('b', { text: (c.label || SEATS[c.seat] || c.seat) }), ' · seat ' + (SEATS[c.seat] || c.seat) + ' · may ' + c.scopes.map(x => SCOPES[x] || x).join(', ') + ' · ' + (c.status === 'active' ? c.days_left + ' day' + (c.days_left === 1 ? '' : 's') + ' left' : c.status) + (c.used_by.length ? ' · used by ' + c.used_by.join(', ') : ''))) : [el('li', { class: 'rk-empty', text: 'No seat credentials. Workers using connector keys carry owner authority; issue scoped credentials on the connections page.' })]));
  $('rkWorkerList').replaceChildren(...(workers.length ? workers.map(w => el('li', {}, (w.agent_id ? (w.label || 'Credential') + ' (' + (SEATS[w.seat] || w.seat) + ' seat)' : 'Key ' + w.key_label) + ' · ' + (WORKER[w.status] || w.status || 'seen') + ' · session ' + (w.session_ref_declared || 'none') + (w.executor_declared ? ' · ' + w.executor_declared : '') + (w.model_declared ? ' · ' + w.model_declared : '') + ' · last ' + w.last_op.replace('rk.', '') + ' ', when(w.last_seen))) : [el('li', { class: 'rk-empty', text: 'No worker has acted yet.' })]));
  const intakes = board.intakes || [];
  $('rkIntakeList').replaceChildren(...(intakes.length ? intakes.map(x => el('li', {}, x.playbook_id + ' · message ' + x.message + '… · ' + x.state + (x.plan_version ? ' as plan v' + x.plan_version : '') + ' · received ', when(x.received_at), x.ask_declared ? el('p', { class: 'rk-help', text: 'Declared ask: ' + x.ask_declared }) : null)) : [el('li', { class: 'rk-empty', text: 'No intake recorded.' })]));
  const notices = board.notices || [];
  $('rkNoticeList').replaceChildren(...(notices.length ? notices.map(n => el('li', {}, n.key + ' · ' + n.state.replace(/_/g, ' ') + ' · ', when(n.at))) : [el('li', { class: 'rk-empty', text: 'No notifications recorded.' })]));
  const warn = board.capacity_warnings || [];
  $('rkCapacity').replaceChildren(...(warn.length ? ['Storage is filling: ' + warn.map(w => w.list + ' ' + w.used + ' of ' + w.limit).join(', ') + '. Export or archive before it refuses new work.'] : []));
  $('rkCapacity').hidden = !warn.length;
  $('rkTeam').hidden = false;
}
// A playbook change resends the whole current version with your edits, so nothing is dropped.
function playbookData(p, change) {
  const keep = ['playbook_id', 'status', 'task_id', 'seat', 'role', 'reviewer_seat', 'review', 'decision', 'data_scope', 'acceptance', 'budget', 'criteria', 'coordinator_key', 'coordinator_seat', 'max_runs_per_day', 'evidence_required', 'note'];
  const data = Object.fromEntries(keep.filter(k => p[k] !== undefined && p[k] !== null).map(k => [k, p[k]]));
  return { ...data, intake: { source: p.intake.source, ...(p.intake.note ? { note: p.intake.note } : {}) }, expected_version: p.version, ...change };
}
const allCards = () => board ? [...Object.values(board.lanes).flat(), ...board.done, ...board.closed, ...board.unplanned] : [];
function renderEvidence() {
  const cards = allCards(), counts = board.counts;
  const latest = cards.map(c => c.last_verified).filter(e => e?.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  $('rkEvidenceList').replaceChildren(
    el('li', {}, 'Installed and enabled: this Worker answered an authenticated owner request. Snapshot ', when(board.as_of), '.'),
    el('li', { text: 'Workers seen: ' + ((board.workers || []).length ? board.workers.length + ' key and session pairs have acted. That shows past activity, not that a session is online now.' : 'none yet. Key acceptance records do not prove a session is online.') }),
    el('li', { text: 'Executing: ' + cards.filter(c => c.execution?.state === 'running').length + ' leases checked in within 15 minutes; ' + cards.filter(c => c.execution?.state === 'running_silent').length + ' silent; ' + cards.filter(c => c.execution?.state === 'dispatched_waiting_for_worker').length + ' dispatched with no worker yet; ' + (counts.done || 0) + ' tasks in Done.' }),
    el('li', { text: 'Waiting: ' + (counts.ready || 0) + ' ready for a foreground session; ' + (counts.blocked || 0) + ' blocked; ' + (counts.needs_you || 0) + ' need you. Open a task for its exact next action.' }),
    latest ? el('li', {}, 'Latest retained task event: ' + latest.op + ' by ' + latest.by_text + ', ', when(latest.at), '. This is recorded activity, not a heartbeat.') : el('li', { text: 'No retained coordination event for these tasks yet.' })
  );
  $('rkEvidence').hidden = false;
}
const pinValue = p => JSON.stringify({ project_id: p.project_id, kind: p.kind, version: p.version, require: p.require });
// Re-rendering refreshes the lists but keeps what is selected in them, so switching lanes or
// saving something else never silently drops a dependency or pin from a plan being edited.
function fillForms() {
  const tasks = allCards().filter(c => !c.archived).map(c => [c.task_id, c.title]);
  const plan = $('rkPlanForm').elements, keep = plan.task_id.value;
  const keepDeps = new Set([...plan.depends_on.selectedOptions].map(o => o.value));
  const keepPin = plan.pin.value, keepPinText = plan.pin.selectedOptions[0]?.textContent;
  plan.task_id.replaceChildren(...tasks.map(([v, t]) => el('option', { value: v, text: t })));
  if (keep) plan.task_id.value = keep;
  plan.depends_on.replaceChildren(...tasks.map(([v, t]) => el('option', { value: v, text: t, selected: keepDeps.has(v) })));
  plan.pin.replaceChildren(el('option', { value: '', text: 'No pin' }), ...board.pins.flatMap(p => ['any', 'approved'].map(require => el('option', { value: pinValue({ ...p, require }), text: p.kind.replace(/_/g, ' ') + ' · ' + p.project_id + ' v' + p.version + (require === 'any' ? ' · any status' : ' · must be approved') }))));
  if (keepPin && ![...plan.pin.options].some(o => o.value === keepPin)) plan.pin.append(el('option', { value: keepPin, text: keepPinText || keepPin }));
  plan.pin.value = keepPin;
  const pf = $('rkPlaybookForm').elements, keepTask = pf.task_id.value, keepCriteria = pf.criteria.value;
  pf.task_id.replaceChildren(...tasks.map(([v, t]) => el('option', { value: v, text: t })));
  if (keepTask) pf.task_id.value = keepTask;
  const projects = [...new Map(board.pins.map(p => [p.project_id + '|' + p.kind, p])).values()];
  pf.criteria.replaceChildren(...projects.map(p => el('option', { value: JSON.stringify({ project_id: p.project_id, kind: p.kind }), text: p.kind.replace(/_/g, ' ') + ' · ' + p.project_id + ' (now v' + p.version + ', ' + p.status + ')' })));
  if (keepCriteria) pf.criteria.value = keepCriteria;
  const pin = $('rkPinForm').elements, keepContext = pin.context_id.value;
  pin.context_id.replaceChildren(...board.contexts.map(c => el('option', { value: c.id, text: c.title + ' · ' + c.versions + ' version' + (c.versions === 1 ? '' : 's') })));
  if (keepContext) pin.context_id.value = keepContext;
}
// Amending starts from the whole current plan. Fields this form cannot edit are shown and kept.
function openPlan(taskId) {
  $('rkPlanBox').open = true;
  const f = $('rkPlanForm').elements;
  f.task_id.value = taskId;
  const card = allCards().find(c => c.task_id === taskId), p = card?.plan;
  carry = null;
  $('rkPlanCarry').replaceChildren();
  $('rkPlanCarry').hidden = true;
  if (p) {
    f.seat.value = p.seat;
    f.session_ref.value = p.session_ref || '';
    f.role.value = p.role || '';
    f.priority.value = String(p.priority);
    f.review.value = p.review; f.decision.value = p.decision; f.data_scope.value = p.data_scope;
    f.attempts.value = p.budget.attempts; f.attemptsOut.value = f.attempts.value;
    f.lease_minutes.value = p.budget.lease_minutes; f.leaseOut.value = f.lease_minutes.value;
    // Keep every dependency the current plan enforces, including Pound blockers it recorded.
    const recorded = new Set([...p.depends_on, ...p.pound_blockers]);
    for (const o of f.depends_on.options) o.selected = recorded.has(o.value);
    if (p.pin) {
      const value = pinValue(p.pin);
      if (![...f.pin.options].some(o => o.value === value)) f.pin.append(el('option', { value, text: p.pin.kind.replace(/_/g, ' ') + ' · ' + p.pin.project_id + ' v' + p.pin.version + ' · from the current plan (no longer the current pin)' }));
      f.pin.value = value;
    } else f.pin.value = '';
    f.acceptance.value = p.acceptance[0]?.text || '';
    f.note.value = p.note || '';
    carry = { task_id: taskId, lab: p.lab, thread: p.thread, acceptance: p.acceptance.slice(1), first_check: p.acceptance[0]?.check_ref };
    const kept = [p.lab ? 'Lab link ' + show(p.lab) : null, p.thread ? 'Discord thread ' + p.thread.discord_thread_id : null, carry.acceptance.length ? carry.acceptance.length + ' more acceptance check' + (carry.acceptance.length === 1 ? '' : 's') : null].filter(Boolean);
    if (kept.length) { $('rkPlanCarry').replaceChildren(el('b', { text: 'Kept from plan v' + p.version + ': ' }), kept.join(' · ')); $('rkPlanCarry').hidden = false; }
  }
  $('rkPlanBox').scrollIntoView({ block: 'start' });
  f.task_id.focus();
}
$('rkPlanForm').elements.task_id.addEventListener('change', e => { if (carry && carry.task_id !== e.target.value) { carry = null; $('rkPlanCarry').hidden = true; } });
$('rkPlanForm').elements.attempts.addEventListener('input', e => { $('rkPlanForm').elements.attemptsOut.value = e.target.value; });
$('rkPlanForm').elements.lease_minutes.addEventListener('input', e => { $('rkPlanForm').elements.leaseOut.value = e.target.value; });
$('rkPlanForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements, card = allCards().find(c => c.task_id === f.task_id.value);
  if (!card) { note('Choose a task.'); return; }
  const data = { task_id: card.task_id, expected_plan_version: card.max_plan_version, seat: f.seat.value, review: f.review.value, decision: f.decision.value, data_scope: f.data_scope.value, budget: { attempts: Number(f.attempts.value), lease_minutes: Number(f.lease_minutes.value) }, ...(card.basis ? { basis: card.basis } : {}) };
  if (f.priority.value !== '3') data.priority = Number(f.priority.value);
  const deps = [...f.depends_on.selectedOptions].map(o => o.value).filter(v => v !== card.task_id);
  if (deps.length) data.depends_on = deps;
  if (f.pin.value) data.pin = JSON.parse(f.pin.value);
  if (f.seat.value !== 'owner' && f.session_ref.value.trim()) data.session_ref = f.session_ref.value.trim();
  if (f.seat.value !== 'owner' && f.role.value.trim()) data.role = f.role.value.trim();
  const kept = carry && carry.task_id === card.task_id ? carry : null;
  const acceptance = [...(f.acceptance.value.trim() ? [{ text: f.acceptance.value.trim(), ...(kept?.first_check ? { check_ref: kept.first_check } : {}) }] : []), ...(kept?.acceptance || [])];
  if (acceptance.length) data.acceptance = acceptance;
  if (kept?.lab) data.lab = kept.lab;
  if (kept?.thread) data.thread = kept.thread;
  if (f.note.value.trim()) data.note = f.note.value.trim();
  if (await act('rk.plan', data, 'Save plan')) $('rkPlanBox').open = false;
});
$('rkPinForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements, type = f.ref_type.value, version = Number(f.version.value);
  const ref = type === 'pound_context' ? { type, context_id: f.context_id.value, version } : type === 'claude_doc' ? { type, id: f.doc_id.value.trim(), rev: version } : { type, path: f.path.value.trim(), commit: f.commit.value.trim(), sha256: f.sha256.value.trim() };
  if (await act('rk.pin', { project_id: f.project_id.value.trim(), kind: f.kind.value, status: f.status.value, ref }, 'Pin version')) $('rkPinBox').open = false;
});
$('rkPlaybookForm').elements.max_runs_per_day.addEventListener('input', e => { $('rkPlaybookForm').elements.runsOut.value = e.target.value; });
$('rkPlaybookForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements, id = f.playbook_id.value.trim();
  if (!f.task_id.value || !f.criteria.value) { note('Choose a task and a criteria pin. Pin the brief first if none is listed.'); return; }
  if (!f.coordinator_seat.value && !f.coordinator_key.value.trim()) { note('Choose a coordinator seat or enter a coordinator key.'); return; }
  const prev = (board.playbooks || []).find(p => p.playbook_id === id);
  const acceptance = f.acceptance.value.split('\n').map(x => x.trim()).filter(Boolean).map(text => ({ text }));
  const data = {
    playbook_id: id, expected_version: prev?.version || 0, status: f.status.value, task_id: f.task_id.value, seat: f.seat.value, review: f.review.value, decision: f.decision.value, data_scope: prev?.data_scope || 'none',
    criteria: JSON.parse(f.criteria.value), ...(f.coordinator_seat.value ? { coordinator_seat: f.coordinator_seat.value } : { coordinator_key: f.coordinator_key.value.trim() }), intake: prev ? { source: prev.intake.source, ...(prev.intake.note ? { note: prev.intake.note } : {}) } : { source: 'gmail', note: 'External mail check by a session; not native intake.' },
    max_runs_per_day: Number(f.max_runs_per_day.value), ...(acceptance.length ? { acceptance } : {}), ...(f.reviewer_seat.value ? { reviewer_seat: f.reviewer_seat.value } : {}), ...(prev?.budget ? { budget: prev.budget } : {}),
  };
  if (await act('rk.playbook', data, 'Save playbook')) $('rkPlaybookBox').open = false;
});
$('rkRoleForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements;
  const data = { seat: f.seat.value, key_label: f.key_label.value.trim(), role: f.role.value.trim() };
  if (f.scope.value.trim()) data.scope = f.scope.value.trim();
  if (await act('rk.role.propose', data, 'Propose role')) $('rkRoleBox').open = false;
});
$('rkRefresh').addEventListener('click', () => load());
$('rkResend').addEventListener('click', () => { if (pending) act(pending.body.op, pending.body.data, pending.label); });
window.addEventListener('storage', e => { if (e.key === 'dd-bozo-sess' || e.key === null) load(); });
window.addEventListener('pagehide', clearView);
window.addEventListener('pageshow', e => { if (e.persisted) load(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearView(); note('Board hidden. Return to reload securely.' + (pending ? ' "' + pending.label + '" is kept for a resend.' : '')); } else load(); });
load();
$('rkMessageForm').addEventListener('submit', async e => {

 e.preventDefault();if(!board||busy||pending)return;const f=e.currentTarget.elements,route=board.messaging?.routes.find(r=>r.id===f.route_id.value&&r.enabled);

 if(!route)return note('No approved delivery connection.');const text=f.text.value;

 const out=await act('rk.message',{action:'send',thread_id:f.thread_id.value,route_id:route.id,route_version:route.version,text},'Message to '+route.recipient);

 if(out&&f.text.value===text)f.text.value='';

});

$('rkDiscussionForm').addEventListener('submit',async e=>{e.preventDefault();if(!board||busy||pending)return;const f=e.currentTarget.elements,body=f.body.value,evidence=f.evidence.value.split('\n').map(s=>s.trim()).filter(Boolean);const out=await act('rk.discuss',{action:'post',thread_id:f.thread_id.value,body,evidence},'Post discussion');if(out&&f.body.value===body){f.body.value='';f.evidence.value='';}});
