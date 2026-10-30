/* Pack Sled runner. Drives the existing claim → heartbeat → report and review protocol for one
 * worker session, with a persisted journal so an interrupted session can resume without losing
 * accepted work or repeating an external effect.
 *
 * What it guarantees:
 *   - Every write step has a request_id derived from the run id and the step name, and the exact
 *     data is journaled before it is sent. A resend after a timeout or a crash is the identical
 *     request, which the server replays instead of applying twice.
 *   - An external effect (anything outside Pack Sled, such as posting a message) is journaled as
 *     started before it runs. A crash between start and finish leaves it "unknown": the runner
 *     never runs it again and reports the attempt as uncertain for the owner to reconcile.
 *   - The lease secret is generated once per claim attempt and journaled, so a resumed session renews
 *     the same lease instead of claiming twice, and a retry after a failed attempt claims afresh. Each process gets a new execution id, so the board
 *     shows a resume.
 *
 * What it does not do: start, wake or schedule a session, hold credentials, or read mail. The
 * transport is supplied by the caller (an MCP client in a session, or a fake in tests).
 *
 * CLI (for a session that calls the connector itself and journals with this file):
 *   node pack-sled-runner.mjs begin  <journal.json> <run_id>
 *   node pack-sled-runner.mjs step   <journal.json> <step> <op> '<data json>'   prints the exact call to send
 *   node pack-sled-runner.mjs done   <journal.json> <step> '<result json>'
 *   node pack-sled-runner.mjs effect <journal.json> <name> start|done|status
 *   node pack-sled-runner.mjs secret <journal.json> <claim step>               prints the lease secret for that claim attempt
 *   node pack-sled-runner.mjs status <journal.json> */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';

const sha = s => createHash('sha256').update(s).digest('hex');
export const requestIdFor = (runId, step) => 'ps_' + sha(runId + '\u0000' + step).slice(0, 40);
const token = n => randomBytes(n).toString('base64url');

export class RunnerUncertain extends Error { constructor(step, cause) { super('write_outcome_unknown:' + step); this.code = 'write_outcome_unknown'; this.step = step; this.cause = cause; } }
export class EffectUnknown extends Error { constructor(name) { super('effect_outcome_unknown:' + name); this.code = 'effect_outcome_unknown'; this.effect = name; } }

export function memoryJournal(initial = null) {
  let saved = initial ? JSON.stringify(initial) : null;
  return { load: () => (saved ? JSON.parse(saved) : null), save: s => { saved = JSON.stringify(s); }, raw: () => saved };
}
// Atomic file journal: write a sibling file, then rename over the old one.
export function fileJournal(path) {
  return {
    load: () => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null),
    save: s => { const tmp = path + '.tmp'; writeFileSync(tmp, JSON.stringify(s, null, 1)); renameSync(tmp, path); },
  };
}

export class Journal {
  constructor(store, runId) {
    this.store = store;
    const s = store.load();
    if (s) { if (runId && s.run_id !== runId) throw new Error('journal_belongs_to_another_run'); this.s = s; }
    else { if (!runId) throw new Error('run_id_required'); this.s = { run_id: runId, steps: {}, effects: {}, secrets: {}, executions: [], beats: 0 }; }
  }
  save() { this.store.save(this.s); }
  // A new process on the same journal is a new execution of the same run.
  startExecution() { const e = 'exe_' + token(12); this.s.executions = [...this.s.executions, e].slice(-8); this.save(); return e; }
  get execution() { return this.s.executions.at(-1) || null; }
  // One secret per claim attempt (keyed by its step name), kept so a resumed session renews the same lease.
  leaseSecret(key) { if (!this.s.secrets[key]) { this.s.secrets[key] = 'ls_' + token(24); this.save(); } return this.s.secrets[key]; }
  // Journal the exact call before it is sent; a repeat returns the same call.
  prepare(step, op, data) {
    const prior = this.s.steps[step];
    if (prior) return { request_id: prior.request_id, op: prior.op, data: prior.data, status: prior.status, result: prior.result ?? null };
    const entry = { request_id: requestIdFor(this.s.run_id, step), op, data, status: 'sent' };
    this.s.steps[step] = entry;
    this.save();
    return { ...entry, result: null };
  }
  finish(step, result) { const e = this.s.steps[step]; if (!e) throw new Error('unknown_step'); e.status = 'done'; e.result = result; this.save(); }
  fail(step, error) { const e = this.s.steps[step]; if (!e) throw new Error('unknown_step'); e.status = 'refused'; e.error = error; this.save(); }
  effectStart(name) {
    const st = this.s.effects[name];
    if (st === 'done') return 'done';
    if (st === 'started') return 'unknown';
    this.s.effects[name] = 'started'; this.save(); return 'go';
  }
  effectDone(name) { this.s.effects[name] = 'done'; this.save(); }
  unknownEffects() { return Object.entries(this.s.effects).filter(([, v]) => v === 'started').map(([k]) => k); }
  nextBeat() { this.s.beats += 1; this.save(); return this.s.beats; }
}

const isTimeout = e => e && (e.timeout === true || e.code === 'timeout' || e.name === 'TimeoutError');

export function createRunner({ transport, store, runId, sessionRef, executor = 'pack-sled-runner', model, retries = 3 }) {
  const j = new Journal(store, runId);
  const execution = j.startExecution();
  const declared = { executor, ...(model ? { model } : {}) };

  // Send a journaled step. Timeouts resend the identical request; a refusal is final for the step.
  async function step(name, op, build) {
    const prior = j.s.steps[name];
    if (prior?.status === 'done') return prior.result;
    if (prior?.status === 'refused') throw Object.assign(new Error(prior.error.code), prior.error);
    const call = j.prepare(name, op, prior ? prior.data : build());
    let last;
    for (let i = 0; i <= retries; i++) {
      try {
        const result = await transport.write(call.op, call.request_id, call.data);
        j.finish(name, result);
        return result;
      } catch (e) {
        if (!isTimeout(e)) { j.fail(name, { code: e.code || e.message, status: e.status ?? null }); throw e; }
        last = e;
      }
    }
    // Still unknown. The journal keeps the call as sent, so the next execution resends it.
    throw new RunnerUncertain(name, last);
  }

  const remember = (name, data, res, brief) => {
    j.s.claim = { step: name, task_id: data.task_id, claim_id: res.claim_id, plan_version: data.plan_version, lease_secret: data.lease_secret, ...(brief ? { brief } : {}) };
    j.save();
    return j.s.claim;
  };
  async function claimNext() {
    if (j.s.claim && !j.s.claim.closed) return j.s.claim;
    // Resume first: a claim sent or granted by an earlier execution is resent with the same
    // request id and lease secret, which renews that lease instead of starting a second one.
    const closed = j.s.closed || [];
    const open = Object.entries(j.s.steps).find(([k, v]) => k.startsWith('claim:') && v.status !== 'refused' && !closed.includes(k));
    if (open) { const [name, v] = open; return remember(name, v.data, await step(name, 'rk.claim', () => v.data)); }
    const work = await transport.read(sessionRef);
    const t = work.ready?.[0];
    if (!t) return null;
    // Each attempt is its own step: a retry after a failed or refused attempt on the same plan
    // version gets a new request id and a new lease secret, so the server records a new claim
    // instead of replaying the closed one.
    const base = 'claim:' + t.task_id + ':v' + t.plan_version;
    const tried = Object.keys(j.s.steps).filter(k => k === base || k.startsWith(base + ':a')).length;
    const name = base + ':a' + (tried + 1);
    const lease_secret = j.leaseSecret(name);
    const data = { task_id: t.task_id, plan_version: t.plan_version, ...(t.pin ? { pin_version: t.pin.version } : {}), session_ref: sessionRef, lease_secret, ...declared };
    return remember(name, data, await step(name, 'rk.claim', () => data), t);
  }

  // Heartbeats are not journaled as steps: each one is fresh, and a lost one is harmless.
  async function heartbeat(checkpoint) {
    const c = j.s.claim;
    if (!c || c.closed) throw new Error('no_open_claim');
    const n = j.nextBeat();
    return transport.write('rk.heartbeat', requestIdFor(j.s.run_id, 'hb:' + n), { task_id: c.task_id, claim_id: c.claim_id, lease_secret: c.lease_secret, execution_id: execution, ...(checkpoint ? { checkpoint } : {}), ...declared });
  }

  // Run an external effect at most once across every execution of this run.
  async function effect(name, fn) {
    const st = j.effectStart(name);
    if (st === 'done') return { ran: false, already: true };
    if (st === 'unknown') throw new EffectUnknown(name);
    const out = await fn();
    j.effectDone(name);
    return { ran: true, result: out };
  }

  // An effect that started and never finished makes the attempt uncertain, whatever the caller says.
  async function report({ outcome, summary, evidence, artifacts }) {
    const c = j.s.claim;
    if (!c) throw new Error('no_open_claim');
    const unknown = j.unknownEffects();
    const forced = unknown.length && outcome !== 'uncertain';
    const data = {
      task_id: c.task_id, claim_id: c.claim_id, lease_secret: c.lease_secret,
      outcome: unknown.length ? 'uncertain' : outcome,
      summary: forced ? (summary + ' [Runner: an external step may have happened and was not repeated: ' + unknown.join(', ') + '.]').slice(0, 2000) : summary,
      ...(evidence && !unknown.length ? { evidence } : {}), ...(artifacts ? { artifacts } : {}),
    };
    const res = await step('report:' + c.claim_id, 'rk.report', () => data);
    c.closed = true; c.receipt_id = res.receipt_id; j.s.closed = [...(j.s.closed || []), c.step]; j.save();
    return res;
  }

  async function reviewNext(judge) {
    const work = await transport.read(sessionRef);
    const req = work.review_requests?.[0];
    if (!req) return null;
    const name = 'review:' + req.receipt_id;
    const prior = j.s.steps[name];
    // A verdict already journaled is resent as is, never re-judged.
    const verdict = prior ? null : await judge(req);
    return step(name, 'rk.review', () => ({ receipt_id: req.receipt_id, session_ref: sessionRef, ...verdict }));
  }

  return { step, claimNext, heartbeat, effect, report, reviewNext, journal: j, execution, get claim() { return j.s.claim; } };
}

/* ---------------- CLI ---------------- */
const isMain = typeof process !== 'undefined' && process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href;
if (isMain) {
  const [cmd, path, a, b, c] = process.argv.slice(2);
  const out = x => process.stdout.write(JSON.stringify(x, null, 1) + '\n');
  try {
    if (!cmd || !path) throw new Error('usage: begin|step|done|effect|secret|status <journal.json> ...');
    const store = fileJournal(path);
    if (cmd === 'begin') { const j = new Journal(store, a); out({ run_id: j.s.run_id, execution_id: j.startExecution(), steps: Object.keys(j.s.steps).length, unknown_effects: j.unknownEffects() }); }
    else {
      const j = new Journal(store);
      if (cmd === 'step') out(j.prepare(a, b, JSON.parse(c)));
      else if (cmd === 'done') { j.finish(a, JSON.parse(b)); out({ step: a, status: 'done' }); }
      else if (cmd === 'effect') { if (b === 'start') out({ effect: a, decision: j.effectStart(a) }); else if (b === 'done') { j.effectDone(a); out({ effect: a, status: 'done' }); } else out({ effect: a, status: j.s.effects[a] || 'not_started' }); }
      else if (cmd === 'secret') out({ step: a, lease_secret: j.leaseSecret(a) });
      else if (cmd === 'status') out({ run_id: j.s.run_id, execution_id: j.execution, steps: Object.fromEntries(Object.entries(j.s.steps).map(([k, v]) => [k, { op: v.op, status: v.status, request_id: v.request_id }])), unknown_effects: j.unknownEffects() });
      else throw new Error('unknown_command');
    }
  } catch (e) { process.stderr.write(String(e.message || e) + '\n'); process.exit(1); }
}
