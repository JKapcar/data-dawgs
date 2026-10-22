# Foreground synthetic continuation — local review patch

Base: `165bd6392644214a4e4f79bf29f9e996bf1e3aed`, PR327
(`codex/bdb-coordinator-repair`), inspected 2026-10-22. That PR was draft with
review/CI release gates open; this patch does not claim it is reviewed or released.
Isolated branch: `codex/bdb-session-continuation`. The base was deliberately pinned
instead of resetting to main, to follow the explicit isolated-coordinator task.
PR327's branch and release work were not modified. No push, merge or deployment.

## Review correction and current availability

Independent review found a P1 packaging omission: the mandatory continuation module
was absent from the local HTTP asset map and the Worker dashboard copy list. Both
paths now include it. The actual HTTP handler calls the exported `readLocalAsset`
resolver; socket-free tests recursively load its static module graph. A second test
invokes the real Worker builder and traverses the generated dashboard files, compares
source bytes, and proves removing continuation.mjs fails the closure check. These
checks use neither intercepted requests nor mock asset maps. No previously denied
loopback or packaged-runtime startup operation was retried.

**Hosted and local automatic continuation is now unavailable (fail closed).** Their
existing protocol has no atomic uniqueness/fencing constraint for code/input/config
across different task IDs. Two sessions may read before either claim is visible.
Per-task CAS, historical stopping, client leases and browser locks cannot close that
race across devices. Start refuses before any command; controls display the reason
and are disabled for shared/local stores. Unknown modes also refuse. Only the
isolated, memory-only browser demo can execute this continuation loop, and every
canonical state read must still identify `browser-memory-demo` / `kind=demo`.
Existing manually triggered execution is unchanged.

Required follow-up (not implemented): separately scoped server-side transactional
execution-identity uniqueness and fencing/reconciliation across task IDs, with
concurrent-client tests. This is a server execution-protocol change, not something
that new client permissions or a scheduling flag can fix. No grants are expanded;
there is no override option to enable automatic shared-store execution in this patch.

## What is implemented

The isolated demo Lab Queue has explicit per-task **Approve exact task for this session**,
**Start approved tasks**, and **Stop continuation** controls. Approval is tab memory,
bound to task/version, current code, exact synthetic input and configuration hashes.
It is a local demo selection restriction, not a new server grant or scientific approval.
Existing signed-session authorization remains enforced by the gateway on every manual read
and command; automatic hosted/local dispatch is disabled. `identity.kind=users` identifies the transport, not proof of owner-only
authority; the client does not invent an owner claim absent from the state response.

Only the existing descriptive synthetic discovery adapter runs. A fresh canonical
read and selection precedes each claim/run. PR327's coordinator preserves exact
idempotency keys and frozen payloads and verifies canonical receipt hashes/linkage.
The loop runs at most three audits and stops dispatch after 30 seconds. It never
polls, schedules, creates tasks/hypotheses/findings, grades findings, or calls AI.
An explicit Start can begin another bounded session after a clean stop.

Selection requires a current synthetic data check and skips terminal combinations
of code/input/config even when a duplicate task UUID exists. Data-check dependencies
are canonical; optional explicit task-ID dependencies in the module's approval API
must have verified nonfailure receipts. The current task schema has no task DAG;
the UI therefore adds no invented cross-task dependencies or persisted DAG fields.
Foreign active leases are excluded. Canonically expired leases may be freshly
claimed through the existing protocol, never by copying another actor's token.

Identity/session loss, stale bindings, owner-decision/finding boundaries, time/run
budgets, failed receipts and uncertain results stop dispatch. Page hide/close stops
the loop. Stop cannot cancel a command already submitted; canonical reconciliation
still determines its outcome. Browser throttling means no strict wall-clock promise
about an in-flight network request. Status explicitly says **session-bound, not 24/7**.

Failures/uncertainty latch the loop off for the remainder of that instance: at least
60 seconds of backoff and no automatic retry even after that interval. Inspect the
canonical record and reconcile with the existing manual coordinator before reload
and explicit reapproval. No credentials or pending attempts are persisted by this
patch. Lost committed responses can reconcile immediately without a second run.

Conservative limitation: selection verifies all visible receipts against the current
canonical state. An unanchored legacy receipt, stale historical receipt, invalid
receipt or failure can stop the entire loop. This is intentionally fail-closed, not
a claim that every production queue is executable. No live endpoint was exercised
and no production grants were checked or changed. Existing read/claim/run denials
surface as stops; resolving a grant denial is outside this patch.

Duplicate checks are a foreground client's canonical checks, not a new transactional
global uniqueness guarantee across independent sessions creating distinct tasks.
The server already serializes claims and commits per task. Automatic shared-store execution now refuses entirely; cross-task execution uniqueness
requires a separately reviewed server execution-identity constraint, not local storage
or credentials here. A promise to use one foreground session is insufficient.

## Durable runner requirements — NOT implemented or activated

1. Explicit owner approval of a service principal and least-privilege execution
   authority for a named tenant, adapter, task approval/version, data class, budgets
   and expiry. Existing owner connector contribution scopes do not authorize claims
   or experiments. Do not repurpose an owner session, GH_DISPATCH_TOKEN, or envelope
   repair to supply missing authority. A new grant requires separate authorization.
2. An approved secret store and credential issuance, rotation, revocation and expiry
   lifecycle. No browser token export or credential persistence as a substitute.
3. A reviewed supervised runtime and wake-up lifecycle, explicit enable/disable,
   shutdown/drain behavior, restart recovery, health ownership and operational alerts.
   Existing Worker sports/backup cron and PR CI are not a research scheduler.
4. Durable, version-bound execution approvals and dependency semantics, a transactional
   unique execution identity for code/input/config, fencing/leases, stable command
   identifiers, canonical receipt reconciliation and a policy for interrupted work.
   Exactly-once execution cannot be assumed from a process restart or an expired lease.
5. Bounded quotas, retry ceilings/backoff, dead-letter/manual reconciliation, revocation
   during execution, audit retention, receipt integrity and tested crash/network/clock
   failure behavior. Owner decisions must remain explicit stop gates.
6. Separate execution review for any new adapter, arbitrary code, real development
   data or external AI: sandbox, network/egress, data provenance/access, privacy and
   cost limits. Holdout access and scientific approvals remain separate authorities.
7. Independent code/security review, full CI/runtime tests, explicit deployment and
   activation approval, and an observed rollback/stop procedure before any activation.

None of these background lifecycle or authority changes are included. No cron,
schedule, flag, grant, credential, Worker authorization or repair path was changed.

## Validation

`node --test research-lab/asset-contract.test.mjs research-lab/continuation.test.mjs research-lab/coordinator.test.mjs research-lab/workflow.test.mjs research-lab/gateway.test.mjs`

The continuation tests use synthetic state-machine fixtures and cover approval,
dependency order, duplicates, pause/stop, leases, identity loss, stale versions,
receipt uncertainty, canonical failure and no-retry backoff. The intercepted browser
suite is `research-lab/continuation-browser.test.mjs`; it exercises the actual controls
including shared-mode refusal even when disabled controls are bypassed, plus unchanged
manual committed claim/run response reconciliation without contacting external services.
Existing PR-only CI includes these tests; no event trigger or schedule is added.


Review-fix validation: 96 socket-free synthetic/asset tests and the three guarded,
fully intercepted browser suites pass. The existing real local-server browser CI
suite also asserts shared/local continuation is disabled, but was not rerun here:
previous loopback/runtime denial was respected. Actual network serving and packaged
Worker runtime validation still require permitted CI; artifact module closure is
verified, not claimed as full runtime certification. PR327 and this follow-up remain
unreleased, with independent re-review required.
