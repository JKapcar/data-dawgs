// RoboKap owner board. Private UI: memory only, no persistence, telemetry or third-party code.
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
const SEATS = { claude: 'Claude', grok: 'Grok', gemini: 'Gemini', muse: 'Muse', dot: 'Scout/dot', owner: 'You' };
let epoch = 0, board = null, lane = null, laneChosen = false, busy = false, pending = null, loadedToken = '';
// Your own tasks in flight: the lease secret and claim live in memory only, so a report that
// got no answer can be resent with the identical request.
const ownerFlows = new Map();

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
function note(text) { $('rkStatus').textContent = text; }
function clearView() {
  epoch++; board = null; pending = null; loadedToken = ''; laneChosen = false; ownerFlows.clear();
  for (const id of ['rkCards', 'rkRoleList', 'rkPinList', 'rkUnplannedList', 'rkTabs', 'rkBar']) $(id).replaceChildren();
  for (const id of ['rkSummary', 'rkLane', 'rkRoles', 'rkOwnerForms', 'rkPins', 'rkUnplanned']) $(id).hidden = true;
  globalThis.DDAccount?.reset();
}
async function request(body) {
  const credential = token(), generation = epoch;
  if (!credential) throw Object.assign(new Error('Sign in to DataDawgs in this browser, then return here.'), { status: 401 });
  const res = await fetch(API, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Authorization: 'Bearer ' + credential, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json();
  if (generation !== epoch || credential !== token() || document.hidden) throw Object.assign(new Error('Account changed. Refresh the board.'), { aborted: true });
  if (!res.ok) {
    globalThis.DDAccount?.failed(res.status);
    const known = { robokap_disabled: 'RoboKap coordination is not switched on for this Worker yet.', configured_owner_required: 'Only the configured owner can open this board.' };
    throw Object.assign(new Error(known[data.error] || (data.error || 'Request failed') + (data.detail ? ' · ' + (Array.isArray(data.detail) ? data.detail.join(', ') : typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : '')), { status: res.status });
  }
  globalThis.DDAccount?.verified(credential);
  loadedToken = credential;
  return data;
}
async function load() {
  clearView();
  if (!token()) { note('Sign in to open your board.'); return; }
  note('Loading your board…');
  try { const data = await request(); board = data.board; render(); note('Board as of ' + new Date(board.as_of).toLocaleString() + ' · revision ' + board.rk_revision); }
  catch (e) { if (!e.aborted) note(e.message); }
}
// One owner write. An uncertain network result keeps the identical request for an explicit retry.
async function act(op, data, label) {
  if (busy || !board) return false;
  const signature = JSON.stringify({ op, data });
  if (!pending || pending.signature !== signature) pending = { signature, label, body: { op, request_id: crypto.randomUUID(), data } };
  busy = true; document.body.classList.add('rk-busy'); note(label + ': sending…');
  try {
    const out = await request(pending.body);
    pending = null; board = out.board; render();
    note(label + ': saved' + (out.result?.replayed ? ' (already recorded)' : '') + '. Board revision ' + board.rk_revision + '.');
    return out.result;
  } catch (e) {
    if (e.aborted) return false;
    if (e.status) { pending = null; note(label + ': not saved · ' + e.message); }
    else note(label + ': no answer from the server. Nothing is assumed saved. Press the same button again to resend the identical request.');
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
    box.append(button('Approve plan v' + v, () => act('rk.decide', { subject: 'plan', id: card.task_id, plan_version: v, decision: 'approve' }, 'Approve plan')), button('Reject plan v' + v, () => act('rk.decide', { subject: 'plan', id: card.task_id, plan_version: v, decision: 'reject' }, 'Reject plan'), 'secondary'));
  }
  if (codes.has('decide_receipt') && receipt) box.append(button('Accept result', () => act('rk.decide', { subject: 'receipt', id: receipt, decision: 'accept' }, 'Accept result')), button('Ask for revision', () => act('rk.decide', { subject: 'receipt', id: receipt, decision: 'revise' }, 'Ask for revision'), 'secondary'), button('Reject', () => act('rk.decide', { subject: 'receipt', id: receipt, decision: 'reject' }, 'Reject result'), 'secondary'));
  if (codes.has('review_rejected') && receipt) box.append(button('Ask for revision', () => act('rk.decide', { subject: 'receipt', id: receipt, decision: 'revise' }, 'Ask for revision')), button('Close as rejected', () => act('rk.decide', { subject: 'receipt', id: receipt, decision: 'reject' }, 'Reject result'), 'secondary'));
  if (codes.has('reconcile_uncertain') && receipt) box.append(button('It landed', () => act('rk.decide', { subject: 'uncertain', id: receipt, decision: 'landed' }, 'Record: landed')), button('It did not land', () => act('rk.decide', { subject: 'uncertain', id: receipt, decision: 'not_landed' }, 'Record: not landed'), 'secondary'));
  if (codes.has('budget_exhausted') && card.plan) box.append(button('Allow one more attempt', () => act('rk.decide', { subject: 'budget', id: card.task_id, plan_version: card.plan.version, decision: 'extend', attempts: 1 }, 'Extend budget')));
  if (codes.has('owner_task') && card.plan) box.append(button('Record it done', () => ownerDone(card, box)));
  if (card.lane === 'running' && ownerFlows.has(card.task_id)) box.append(button('Finish recording', () => finishOwner(card.task_id)));
  if (['task_changed', 'pin_superseded', 'pin_not_approved', 'pin_missing', 'pin_behind_context', 'pin_context_missing', 'pin_hash_mismatch', 'lab_link_stale', 'lab_hypothesis_missing', 'lab_hypothesis_withdrawn', 'dependency_closed', 'dependency_missing', 'dependency_cycle', 'propose_role'].some(c => codes.has(c)) || card.lane === 'unplanned') box.append(button(card.plan ? 'Amend plan' : 'Plan this task', () => openPlan(card.task_id), 'secondary'));
  if (codes.has('approve_role')) box.append(button('Open role decisions', () => $('rkRoles').scrollIntoView({ block: 'start' }), 'secondary'));
  return box.childNodes.length ? box : null;
}
// Your own task: claim it as the owner, then report it with what you attach. Two recorded steps.
async function finishOwner(taskId) {
  const flow = ownerFlows.get(taskId);
  if (!flow?.claim) return;
  const done = await act('rk.report', { task_id: taskId, claim_id: flow.claim.claim_id, lease_secret: flow.lease, outcome: 'succeeded', summary: flow.summary, artifacts: flow.artifacts }, 'Record your task');
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
function cardView(card) {
  const owner = card.owner ? SEATS[card.owner.seat] + (card.owner.key_label ? ' · key ' + card.owner.key_label : '') + (card.owner.role ? ' · role ' + card.owner.role.state : '') : 'No plan';
  const chips = el('ul', { class: 'rk-chips' },
    card.project ? el('li', { class: 'rk-chip', text: card.project }) : null,
    el('li', { class: 'rk-chip strong', text: owner }),
    card.plan ? el('li', { class: 'rk-chip', text: 'plan v' + card.plan.version }) : null,
    card.plan && card.plan.review !== 'none' ? el('li', { class: 'rk-chip', text: card.plan.review + ' review' }) : null,
    card.plan && card.plan.decision === 'required' ? el('li', { class: 'rk-chip', text: 'your decision' }) : null,
    card.owner?.session_ref_target ? el('li', { class: 'rk-chip', text: 'session ' + card.owner.session_ref_target + ' (declared)' }) : null);
  const facts = el('dl', { class: 'rk-facts' });
  const fact = (k, v) => facts.append(el('dt', { text: k }), el('dd', {}, v));
  if (card.dependencies.length) fact('Depends on', el('ul', { class: 'rk-deps' }, card.dependencies.map(d => el('li', { class: 'rk-dep ' + (d.accepted ? 'ok' : d.closed || d.missing || d.cycle ? 'bad' : 'wait'), text: (d.title || d.id) + ' · ' + (d.accepted ? 'accepted' : d.cycle ? 'in a cycle' : d.closed ? d.closed : d.missing ? 'missing' : d.lane.replace('_', ' ')) }))));
  if (card.claim) fact('Lease', el('span', {}, card.claim.by + ' · session ' + (card.claim.session_ref_declared || 'none') + ' (declared) · attempt ' + card.claim.attempt + ' · expires ', when(card.claim.expires_at)));
  if (card.plan?.budget) fact('Attempts', document.createTextNode(card.plan.budget.used + ' of ' + card.plan.budget.limit + ' used'));
  fact('Last verified', card.last_verified ? el('span', {}, card.last_verified.op.replace('rk.', '') + ' · ' + card.last_verified.by_text + ' · ', when(card.last_verified.at)) : document.createTextNode('Nothing recorded yet'));
  fact('Reported', document.createTextNode((card.reported.status || 'no status') + ' · ' + (card.reported.source || '').replace(/_/g, ' ') + (card.reported.note ? ' · ' + card.reported.note : '')));
  const next = card.next ? el('p', { class: 'rk-next' }, el('b', { text: 'Next · ' + ({ owner: 'you', seat: 'the seat', reviewer: 'a reviewer', dependency: 'a dependency', system: 'a check' }[card.next.actor] || card.next.actor) }), card.next.text) : null;
  let evidence = null;
  if (card.evidence) {
    const ev = card.evidence;
    evidence = el('details', {}, el('summary', { text: 'Evidence · ' + ev.outcome + ' · ' + ev.artifacts.length + ' artifact' + (ev.artifacts.length === 1 ? '' : 's') + (ev.late ? ' · late' : '') }),
      el('p', {}, 'Receipt from ' + ev.by + ', session ' + (ev.session_ref_declared || 'none') + ' (declared), ', when(ev.at), '.'),
      el('p', { text: ev.summary }),
      el('ul', { class: 'rk-artifacts' }, ev.artifacts.map(a => el('li', {}, el('span', { text: a.kind.replace('_', ' ') + ': ' }), a.ref ? refText(a.ref) : document.createTextNode(a.note || ''), el('span', { class: 'rk-badge v-' + a.verification, text: VERIFY[a.verification] || a.verification })))),
      ev.review ? el('p', { text: 'Review: ' + ev.review.verdict + ' · ' + ev.review.mode + ' · ' + ev.review.by }) : null,
      ev.decision ? el('p', { text: 'Your decision: ' + ev.decision.decision }) : null,
      el('p', { class: 'rk-help', text: 'Receipt hash ' + ev.hash.slice(0, 16) + '…' }));
  }
  return el('li', { class: 'rk-card lane-' + (card.lane === 'unplanned' ? 'blocked' : card.lane) }, el('h3', { text: card.title }), chips, next, facts, evidence, actionsFor(card));
}
function render() {
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
  $('rkRoleList').replaceChildren(...board.role_decisions.map(r => el('li', {}, el('p', { text: SEATS[r.seat] + ' · key ' + r.key_label + ' · ' + r.role }), el('p', { class: 'rk-help', text: 'Accepted by ' + r.accepted.by + ' (' + r.accepted.tier.replace('_', ' ') + '). That proves which key accepted, not which model.' }), el('div', { class: 'rk-actions' }, button('Approve role', () => act('rk.decide', { subject: 'role', id: r.role_id, decision: 'approve' }, 'Approve role')), button('Reject', () => act('rk.decide', { subject: 'role', id: r.role_id, decision: 'reject' }, 'Reject role'), 'secondary')))));
  const others = board.roles.filter(r => r.state !== 'accepted');
  for (const r of others) $('rkRoleList').append(el('li', {}, el('p', { text: SEATS[r.seat] + ' · key ' + r.key_label + ' · ' + r.role + ' · ' + r.state }), r.state === 'effective' ? el('div', { class: 'rk-actions' }, button('Revoke role', () => act('rk.decide', { subject: 'role', id: r.id, decision: 'revoke' }, 'Revoke role'), 'secondary')) : null));
  $('rkRoles').hidden = !board.roles.length;
  $('rkPinList').replaceChildren(...board.pins.map(p => el('li', {}, el('p', { text: p.kind.replace(/_/g, ' ') + ' · ' + p.project_id + ' · v' + p.version + ' · ' + p.status }), el('p', { class: 'rk-help' }, (p.ref.type === 'claude_doc' ? 'Claude Doc ' + p.ref.id + ' revision ' + p.ref.rev : p.ref.type === 'repo_file' ? p.ref.path + ' @ ' + p.ref.commit.slice(0, 7) : 'RoboKap context version ' + p.ref.version), el('span', { class: 'rk-badge v-' + p.verification, text: VERIFY[p.verification] || p.verification }), ' · ' + p.history + ' version' + (p.history === 1 ? '' : 's') + ' kept'))));
  $('rkPins').hidden = !board.pins.length;
  $('rkUnplannedList').replaceChildren(...board.unplanned.map(c => el('li', {}, el('p', { text: c.title }), el('p', { class: 'rk-help', text: 'Reported ' + (c.reported.status || 'no status') + ' · ' + (c.reported.source || '').replace(/_/g, ' ') + (c.reported.note ? ' · ' + c.reported.note : '') }), el('div', { class: 'rk-actions' }, button('Plan this task', () => openPlan(c.task_id), 'secondary')))));
  $('rkUnplanned').hidden = !board.unplanned.length;
  $('rkHonesty').replaceChildren(...board.honesty.map(h => el('li', { text: h })), el('li', { text: 'Waking an assistant is unsupported: open the session and ask it to check its RoboKap queue.' }), el('li', { text: 'Lab checks: ' + (board.lab.status === 'checked' ? 'read-only, through your research access.' : 'unavailable right now, so Lab-linked work waits.') }));
  fillForms();
  $('rkOwnerForms').hidden = false;
}
const allCards = () => [...Object.values(board.lanes).flat(), ...board.done, ...board.closed, ...board.unplanned];
function fillForms() {
  const tasks = allCards().map(c => [c.task_id, c.title]);
  const plan = $('rkPlanForm').elements, keep = plan.task_id.value;
  plan.task_id.replaceChildren(...tasks.map(([v, t]) => el('option', { value: v, text: t })));
  if (keep) plan.task_id.value = keep;
  plan.depends_on.replaceChildren(...tasks.map(([v, t]) => el('option', { value: v, text: t })));
  plan.pin.replaceChildren(el('option', { value: '', text: 'No pin' }), ...board.pins.flatMap(p => [el('option', { value: JSON.stringify({ project_id: p.project_id, kind: p.kind, version: p.version, require: 'any' }), text: p.kind.replace(/_/g, ' ') + ' · ' + p.project_id + ' v' + p.version + ' · any status' }), el('option', { value: JSON.stringify({ project_id: p.project_id, kind: p.kind, version: p.version, require: 'approved' }), text: p.kind.replace(/_/g, ' ') + ' · ' + p.project_id + ' v' + p.version + ' · must be approved' })]));
  const pin = $('rkPinForm').elements;
  pin.context_id.replaceChildren(...board.contexts.map(c => el('option', { value: c.id, text: c.title + ' · ' + c.versions + ' version' + (c.versions === 1 ? '' : 's') })));
}
function openPlan(taskId) {
  $('rkPlanBox').open = true;
  const f = $('rkPlanForm').elements;
  f.task_id.value = taskId;
  const card = allCards().find(c => c.task_id === taskId);
  if (card?.plan) {
    f.seat.value = card.owner?.seat || 'claude';
    f.review.value = card.plan.review; f.decision.value = card.plan.decision; f.data_scope.value = card.plan.data_scope;
    f.attempts.value = card.plan.budget?.limit ? Math.min(5, card.plan.budget.limit) : 3; f.attemptsOut.value = f.attempts.value;
    for (const o of f.depends_on.options) o.selected = card.dependencies.some(d => d.id === o.value);
  }
  $('rkPlanBox').scrollIntoView({ block: 'start' });
  f.task_id.focus();
}
$('rkPlanForm').elements.attempts.addEventListener('input', e => { $('rkPlanForm').elements.attemptsOut.value = e.target.value; });
$('rkPlanForm').elements.lease_minutes.addEventListener('input', e => { $('rkPlanForm').elements.leaseOut.value = e.target.value; });
$('rkPlanForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements, card = allCards().find(c => c.task_id === f.task_id.value);
  if (!card) { note('Choose a task.'); return; }
  const data = { task_id: card.task_id, expected_plan_version: card.max_plan_version, seat: f.seat.value, review: f.review.value, decision: f.decision.value, data_scope: f.data_scope.value, budget: { attempts: Number(f.attempts.value), lease_minutes: Number(f.lease_minutes.value) } };
  const deps = [...f.depends_on.selectedOptions].map(o => o.value).filter(v => v !== card.task_id);
  if (deps.length) data.depends_on = deps;
  if (f.pin.value) data.pin = JSON.parse(f.pin.value);
  if (f.seat.value !== 'owner' && f.session_ref.value.trim()) data.session_ref = f.session_ref.value.trim();
  if (f.seat.value !== 'owner' && f.role.value.trim()) data.role = f.role.value.trim();
  if (f.acceptance.value.trim()) data.acceptance = [{ text: f.acceptance.value.trim() }];
  if (f.note.value.trim()) data.note = f.note.value.trim();
  if (await act('rk.plan', data, 'Save plan')) $('rkPlanBox').open = false;
});
$('rkPinForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements, type = f.ref_type.value, version = Number(f.version.value);
  const ref = type === 'pound_context' ? { type, context_id: f.context_id.value, version } : type === 'claude_doc' ? { type, id: f.doc_id.value.trim(), rev: version } : { type, path: f.path.value.trim(), commit: f.commit.value.trim(), sha256: f.sha256.value.trim() };
  if (await act('rk.pin', { project_id: f.project_id.value.trim(), kind: f.kind.value, status: f.status.value, ref }, 'Pin version')) $('rkPinBox').open = false;
});
$('rkRoleForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements;
  const data = { seat: f.seat.value, key_label: f.key_label.value.trim(), role: f.role.value.trim() };
  if (f.scope.value.trim()) data.scope = f.scope.value.trim();
  if (await act('rk.role.propose', data, 'Propose role')) $('rkRoleBox').open = false;
});
$('rkRefresh').addEventListener('click', load);
window.addEventListener('storage', e => { if (e.key === 'dd-bozo-sess' || e.key === null) load(); });
window.addEventListener('pagehide', clearView);
window.addEventListener('pageshow', e => { if (e.persisted) load(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearView(); note('Board hidden. Return to reload securely.'); } else load(); });
load();
