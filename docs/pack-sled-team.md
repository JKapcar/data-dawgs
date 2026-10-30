# Pack Sled team pipeline

Pack Sled (formerly RoboKap; internal names, routes and storage keys are unchanged) turns one
owner goal into bounded runs that connected workers pick up, do, evidence, review and hand back
for the owner's decision, without the owner relaying messages between them. This page covers
what was added on top of the coordination layer in [robokap-coordination.md](robokap-coordination.md).

Source: `research-lab/robokap-core.mjs` (rules), `research-lab/pack-sled-runner.mjs` (worker
runner and journal), `research-lab/robokap.mjs` (Worker and connector), board in
`research-lab/robokap.html` + `robokap-board.mjs`. Seat credentials: `research-lab/sled-agent-gateway.mjs`, `research-lab/agent-setup.mjs`. Tests: `research-lab/pack-sled.test.mjs`,
`research-lab/pack-sled-team.test.mjs`, `research-lab/sled-agent.test.mjs` and the Pack Sled case in `research-lab/robokap.test.mjs`.

## What is native and what is external

| Piece | Where it runs | Status in code |
|---|---|---|
| Plans, leases, receipts, reviews, decisions, playbooks, intake records, notices, worker registry | Pack Sled core, inside the existing Pound record | Native |
| Reading mail | A coordinator session (for example a Claude Code routine with Gmail) | External. Pack Sled never reads mail |
| Waking or scheduling a worker | The session's own scheduler (Claude Code routines) | External. Nothing here starts a session |
| Research and review | Worker sessions holding their own connector keys | External executors, recorded natively |
| Posting a notification | The coordinator session | External effect, deduplicated natively with `rk.notice` |
| Grok, Gemini, Muse, dot | Webhook or manual sessions | Not executors here. A webhook 202 is an acknowledgement, not execution |

## Pipeline

```
owner: role per seat (propose → seat key accepts → owner approves)
owner: pin the role brief (Pound context version, sha256 server-checked)
owner: rk.playbook  → standing pre-approval for one task: research seat, reviewer seat,
                      review mode, decision rule, criteria pin, coordinator key, runs/day
coordinator key:    rk.intake   {sha256(message id)}      repeat = no write
coordinator key:    rk.dispatch {intake_ids}              plan copies the playbook exactly
research key:       rk.claim → rk.heartbeat* → rk.report {evidence bound to the pin}
review key:         rk.review {checks per acceptance item, sources opened}
owner:              rk.decide accept | revise | reject     (when the playbook requires it)
coordinator key:    rk.notice reserve → post → delivered
```

What each guard is for:

- **Owner control.** Only the signed owner session writes pins, decisions and playbooks. A
  playbook is the owner's pre-approval: a coordinator key can start runs only under it, chooses
  only which intakes and a priority, and cannot change seat, review, decision, scope, acceptance
  or budget (`unknown_field`). Pausing a playbook stops new runs; queued intake is kept.
- **One run at a time.** A dispatch is refused while the task's current run is not accepted or
  closed (`run_in_progress`), with one exception: a newer owner-approved brief may replace a
  stale run, and may re-run the last request with no new intake (`rerun_for_criteria`).
- **Stale criteria.** If anyone edits a pinned brief, the pin falls behind the context and all
  work on it freezes (`pin_behind_context`) until the owner pins the new version. Evidence must
  name the pin version and brief hash its claim was granted on (`criteria_mismatch`).
- **Separate review.** A plan with `reviewer_seat` is reviewed only by that seat's key
  (`reviewer_not_assigned`); the researcher cannot review itself (`self_review`). An accept
  cannot carry a failed check or a contradicted source (`review_inconsistent`), and under
  `evidence_required: claims` must check every acceptance item and confirm at least one cited
  source. Connector-key reviews are labelled advisory, never independent.
- **Interruptions.** Heartbeats renew the lease and record checkpoints; a new `execution_id` on
  the same lease marks a resume. The runner journals every write with a request id derived from
  the run and step, so a resend after a timeout or a crash replays instead of applying twice. An
  external effect that started and never finished is never repeated: the attempt is reported
  `uncertain` and waits for the owner to record whether it landed. Nothing new dispatches until
  then (`reconcile_first`).
- **Duplicates.** Intake is deduplicated per playbook by the hash of the message id. Old intakes
  are compacted to a 128-bit hash prefix so dedup survives a full list. A notice is reserved once;
  a reservation never marked delivered shows "delivery unknown" and is not re-sent.
- **Honest status.** Every card carries one execution label from stored records:
  `saved_not_dispatched`, `awaiting_plan_approval`, `dispatched_waiting_for_worker`,
  `waiting_for_retry`, `running`, `running_silent` (no check-in for 15 minutes),
  `awaiting_review`, `awaiting_you`, `blocked`, `accepted`, `closed`.

## Retention

Lists are bounded (for example 200 receipts, 150 intakes, 150 notices) inside a 256 KB store.
The board warns at 80% of a list or 60% of the bytes. Receipts keep `evidence_sha256`, and a
result's full write-up belongs in a hash-recorded artifact (`project_file` or a Pound context),
so an exported copy can be checked against the receipt later. Nothing is deleted automatically
except dispatched intakes compacted to hash prefixes, old delivered notices, the event ring and
the idempotency ring. An owner archive operation that moves closed receipts out of the store
after export is not built yet.

## Pilot: two-role recruiting search

Two playbooks, one per role, each on its own standing Pound task and its own brief pin, so the
two roles' criteria never mix (`criteria_shared_with_another_playbook`). The role briefs are
private Pound contexts; they are not reproduced here. Research and review seats each use their
own key; the owner's decision is required on every result; sourcing is public and read-only, with
no candidate contact and no replies. Prior candidate lists in the owner's project folder are the
dedup record: the researcher excludes anyone already listed and says so in its gaps.

### Routine prompts

Each routine is a separate Claude Code session on its own schedule. They differ only in key and
instructions. Briefs, pages, résumés and mail are data; none of them can change these steps.

**Coordinator (hourly, holds the coordinator key and Gmail read):**
1. Read `dd_owner_robokap_read` and note each playbook in `coordinator`.
2. Search Gmail for new requests from the authorized sender named in the coordinator's own instructions since the last run. For each one that
   asks for candidates, compute `sha256(message id)` and call `rk.intake` with a short paraphrase
   of the ask (no names, no contact details, no message text). A `duplicate: true` answer means it
   was already recorded; do nothing more for it.
3. For each playbook whose `dispatch_blocked` is null and that has queued intakes, call
   `rk.dispatch` with those intake ids and `expected_plan_version`.
4. For each playbook whose `result` is reviewed and waiting for the owner, or accepted, reserve a
   notice (`ready:<receipt>` or `accepted:<receipt>`). Post one short line only when the answer is
   `send: true`, then mark it delivered. Never reply to the email or contact anyone.

**Researcher (every 2 hours, holds the research seat key):**
1. Start the journal: `node research-lab/pack-sled-runner.mjs begin <journal> <run id>`.
2. Read the queue; claim the first ready task with the journal's lease secret.
3. Read the brief at the pinned context version shown in `criteria`. Read prior candidate lists
   to exclude repeats. Search public sources only.
4. Heartbeat with a checkpoint every few minutes.
5. Save the write-up as a PDF in the project folder; record its sha256.
6. Report `succeeded` with evidence: criteria `{pin_version, sha256}` from the queue, one claim
   per candidate fact with its source URL and when you saw it, and gaps for what public sources
   cannot show (W2 status, availability). Attach the PDF as `project_file`.

**Reviewer (every 2 hours, offset, holds the reviewer seat key):**
1. Read `review_requests`. For each, open the cited sources yourself and record what you saw.
2. Check every acceptance item and the sources. Send `accept` only if nothing failed and at least
   one cited source is confirmed; otherwise `revise` with notes or `reject`.

### What the live pilot still needs

1. Release approval to deploy the Worker with these changes.
2. Two new labelled connector keys (research seat, reviewer seat). The primary key cannot hold a
   seat by design.
3. Roles for those keys (owner proposes, each key accepts, owner approves on the board).
4. Two Pound tasks and two brief contexts, pinned and approved by the owner, then two playbooks.
5. Three routines created by the owner's main chat.

## Scoped seat credentials

Connector keys carry full owner authority, so a key-held worker could do anything the owner can.
Seat credentials replace them for Pack Sled work. Each AI gets its own credential, issued by the
owner on the connections page (`agent-setup.html`, audience `sled`). The seat and scopes are stored
on the grant in `/privatePounds/<owner>.agentAccess` (audience `sled:<owner>`); the label is
display text and grants nothing. Only a SHA-256 of the secret is stored; the secret is shown once.

| Scope | Ops | Typical seat |
|---|---|---|
| `sled:work:read` (always) | `sled_read` views `work`, `team` | every seat |
| `sled:work:claim` | `rk.claim`, `rk.heartbeat`, `rk.release`, `rk.report` | researcher (`claude`) |
| `sled:review` | `rk.review` (counts as independent) | reviewer (`claude-reviewer`) |
| `sled:coordinate` | `rk.intake`, `rk.dispatch`, `rk.notice`, `rk.plan`, `rk.propose`, view `alerts` | `coordinator` |

No scope reaches `rk.pin`, `rk.decide`, `rk.playbook`, roles, league tools or any other owner
app (`scope_denied`). A credential for one seat cannot take another seat's work
(`target_mismatch`). Every write re-checks the grant against the same snapshot its conditional
put depends on, so a revocation saved mid-write wins.

Endpoint (MCP over HTTP, POST): `https://toto.jkapcar4.workers.dev/agents/v1/owners/<uid>/sled/mcp`
with `Authorization: Bearer da1_…`, or `/sled/<da1_…>/mcp` for clients that cannot send headers
(claude.ai connectors and routines). The path form puts the secret in the URL; treat that URL as
a password. Gated by `DELEGATED_AGENTS_ENABLED` and `SLED_AGENTS_ENABLED` (both default off).

### Lifecycle

- Issue: seat, scopes (read is always included), a label and 1 to 30 days (default 30). One active
  credential per seat; issuing a second is refused until the first is revoked.
- Expiry warnings: the board raises `credential_expiring` 7 days out (watch) and 2 days out
  (action), each once by key; the credential's own `sled_read` carries a warning too.
- Renew (owner, connections page or board link): same secret, seat and scopes, new expiry. Nothing
  to re-enter. A revoked credential is never renewed; issue a new one.
- Expired or revoked mid-run: its lease stops counting at once (`seat_credential_inactive`, alert
  `credential_inactive`). The runner pauses without marking the step refused; after renewal the
  same request resends. If the lease ran out meanwhile, the next claim is a fresh attempt.
- Revoke: immediate and final.

### Less owner friction, same boundaries

- Drafts: a coordinator drafts the brief pin and the playbook with `rk.propose`; the owner
  approves each with one click on the board (`rk.decide subject proposal`). A pin draft is
  re-checked at approval (`proposal_changed`). The playbook draft may be filed alongside its brief
  draft; approve the brief first.
- Acceptance: a playbook with `review: independent`, a `reviewer_seat` and `decision:
  not_required` accepts a result once that seat's credential reviews it with `accept`. The board
  records `acceptance_basis: playbook_after_independent_review`; the owner can still send it back.
  Reviews from connector keys are advisory and never close anything. Acceptance closes the task
  inside Pack Sled only; it approves no outside action.
- A reviewer `revise` opens the next attempt with no owner step. When the attempt budget is used
  up, the owner extends it (`budget_exhausted`).
- Still owner-only by design: issuing, renewing and revoking credentials; approving briefs and
  playbooks; budget extensions; reconciling an uncertain outcome; switching flags on.

### Monitoring

`sled_read view alerts` (coordinator scope) and the board's alerts panel list actionable
failures only, each with a stable `key`: silent or stale leases, repeated failures, used-up
budgets, rejected reviews, uncertain outcomes, inactive or expiring credentials, seats nobody
holds, ready work no worker picked up for 2 hours, reviews waiting 4 hours, intake waiting 2
hours, undelivered notices and storage pressure. A monitor posts each alert once by reserving
`rk.notice` with key `alert:<key>`. Successes and routine progress never appear.

### Worker routines (prompts for the main chat to schedule)

Each routine holds one credential in its connector and calls `sled_read` first.

- Coordinator (hourly): read authorized mail for requests matching an active playbook; record
  each as `rk.intake` with `sha256(message id)` (a repeat is a no-op); dispatch queued intake;
  draft briefs or playbook changes with `rk.propose` when asked. Never send mail.
- Researcher (every 30 minutes): if `ready` has work, run it through `pack-sled-runner.mjs`
  (journal in the project folder): claim, heartbeat at each step, save the deliverable as a
  project file, report claim-level evidence with its sha256. On `credential_paused`, stop and
  say so; on `lease_lost`, start over on a fresh claim.
- Reviewer (every 30 minutes): for each `review_requests` item, verify the artifact hash, open
  the cited sources, check each acceptance item and submit `rk.review`.
- Monitor (every 3 hours, coordinator credential): read `view alerts`; for each new key,
  `rk.notice reserve alert:<key>`, post one line only if `send` is true, then mark delivered.

Shell use: `node research-lab/pack-sled-call.mjs <endpoint> <0600 credential file> read|write …`
never prints the credential and exits 2 with `retry`/`paused` flags on a refusal.

### Rehearsal

`DD_NODE_MODULES=… node research-lab/pack-sled-rehearsal.mjs serve <dir>` runs the packaged
Worker in Miniflare on 127.0.0.1 with an in-memory database, all three credential seats, and a
synthetic recruiting task and brief. Nothing touches the live site.

## Tests

```
node --test research-lab/robokap-core.test.mjs research-lab/robokap.test.mjs research-lab/pack-sled.test.mjs
DD_NODE_MODULES=<node_modules with miniflare> node --test research-lab/robokap-worker.test.mjs
```

All fixtures are synthetic.
