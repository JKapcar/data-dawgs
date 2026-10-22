# Foreground synthetic continuation - local review patch

## Base and release status

Isolated branch: `codex/bdb-session-continuation`. Original base was PR327 commit
`165bd6392644214a4e4f79bf29f9e996bf1e3aed`. The original patch and validation artifacts
were copied before further work. PR327 was verified merged, and only this isolated
branch was rebased onto its merge commit `1dd7e86623b46887840bc0e3fb5e4c2836fb0783`.
The earlier continuation/asset correction is commit `54ff003`; the server identity
constraint is separate commit `e0ff27e`. Merge commit `7823bef` reconciles current main
`bf915f1433a1a15b14f1339864d9c7229b012fe2` including Bozo PR328. Its delayed-receipt
test, exact presentation-asset routing and service-worker behavior are preserved.
Neither upstream branch was modified.

This is a usable, tested implementation for an updated synthetic gateway, **not an
active production runner**. No push, deployment, grant, credential, flag, schedule,
real data, holdout, AI service or repair path was changed. Old gateways remain
fail-closed: the client requires the exact `tenant-cas-experiment-v1` executionPolicy
on approval and every canonical read. It cannot enable itself with a local flag.
Release needs independent review, full CI and separately authorized deployment of
the reviewed Worker artifact and static assets. No production permissions were read
or changed; existing missing scopes still reject commands.

## Existing atomic boundary is sufficient

The gateway already commits the entire tenant state and its grants under one ETag
CAS. The Node preview already serializes synchronous transitions under its exclusive
writer lock. This patch adds no storage collection, external lock, service principal,
permission or migration job. Reservations use the existing task lease and immutable
receipt records inside those transactions. Conflict retries re-read and reauthorize.

`experimentId` is SHA-256 of the fixed-order, versioned `experimentBasis` object:
verified tenant, hypothesis ID and version, current implementation hash, canonical
synthetic data-check hash, method/split/runtime/observation configuration, and
`seed: null`. The existing adapter is deterministic and accepts no seed or arbitrary
code. Check IDs and task UUIDs are intentionally not experiment identity fields.
A new question/version, implementation, checked input or configuration is a distinct
experiment; unchanged input under a fresh task UUID is not.

The default `executionId` is the experiment ID. Claim derives the identity on the
server and checks all equivalent terminal attempts and active leases. Different
task IDs racing for the same attempt can produce only one committed reservation.
An expired equivalent reservation may transfer, clearing the former task lease;
old tokens and expired claim-key replays cannot authorize execution. Run rechecks
reservation/terminal state. Both success and failure are terminal for that attempt.
Grant revocation competes on the same CAS and prevents a stale reservation commit.

The guarantee is one **canonical committed outcome** per execution identity. CAS
retries can speculatively recompute the bounded, pure synthetic summary before one
commit wins, including concurrent requests using one owned task lease. This is not
an exactly-once evaluation guarantee for arbitrary code or external side effects;
neither is permitted. Only checked synthetic tasks enter automatic continuation.
Legacy unbound manual tasks cannot reserve a data identity at claim time, but their
run still checks terminal identity before committing. Existing bounded task/receipt
identities are derived when absent; history is not rewritten. Corrupt or conflicting
canonical linkage stops the operation. A stale `execution:not_executed` receipt does
not consume a new experiment attempt.

## Explicit reruns, not automatic retries

A signed owner with the existing `task:write` scope can submit the existing task
command with `rerunOf` (a terminal receipt ID) and a nonempty `rerunReason` of at most
500 characters. The server checks receipt integrity and exact current experiment
identity and stamps `rerunAuthorizedBy`. No client-provided identity/owner/seed field
is accepted. A contribution connector or agent with task-writing scope alone cannot
claim signed-owner rerun authority.

Rerun execution identity is SHA-256 of `{experimentId, rerunOf}`. Concurrent requests
using the same predecessor therefore share one attempt and one reservation. After
that successor is terminal, another deliberate repeat must link the successor receipt,
not silently branch from the old predecessor. Command-key retries return the same
record. Failed attempts can be deliberately repeated; successful/null/inconclusive
experiments are not permanently forbidden either. Changed experiments queue normally.

The workflow drawer exposes **Request explicit owner rerun**, records a reason and
queues a task through that command. It does not start it. The owner must separately
approve the exact task in the Queue and press Start. A loop instance stopped on a
failure/uncertain response still requires reconciliation/reload and reapproval;
creating a rerun is not a way to bypass a pending uncertain command.

## Foreground behavior and limits

The Queue offers **Approve exact task for this session**, **Start approved tasks**,
and **Stop continuation**. Approvals and frozen inputs are tab memory, bound to task,
version, code/data/config and execution identity. They restrict selection without
changing the server authorization model. `identity.kind=users` identifies a signed
transport; it is not a new client assertion of owner authority. The gateway enforces
all existing read/claim/run scopes, and only its signedOwner principal can create a
rerun. A missing protocol guarantee disables Start and approval controls.

One audit runs at a time, at most three audits per Start, with a 30-second dispatch
budget. PR327's coordinator keeps stable idempotency keys and reconciles canonical
receipts before advancing. Selection requires a current synthetic data check and
eligible lease state. Optional explicit task-ID dependencies in the approval API
require verified nonfailure receipts; the UI invents no persistent task DAG.
Terminal duplicates are skipped; a terminal failure for the approved attempt stops
it. An explicitly authorized new attempt may proceed. Receipt verification is scoped
to relevant current-version experiments and dependencies, so unrelated historical
failures/versions do not silently prohibit new research. Relevant corrupt or
unanchored evidence still stops for reconciliation. An explicit owner rerun can
advance beyond an earlier finding/disposition; ordinary work stops at that boundary.

Identity/session loss, changed versions/inputs/code, failed or uncertain commands,
owner stops, budgets and page hide/close stop further dispatch. Stop cannot cancel
a command already submitted. In-flight results are reconciled; browser throttling
means no strict wall-clock cancellation promise. Failures latch the instance off,
with at least 60 seconds of backoff and no automatic retry after it expires. Clean
stops can be explicitly restarted. Status says **session-bound, not 24/7**. No
hypotheses/findings are created or approved by the loop, and nothing wakes it later.

## Packaging and validation

The local HTTP handler uses the same actual `readLocalAsset` resolver tested by the
socket-free module-closure test. The real Worker builder is invoked to verify both
the generated Worker and dashboard import closures and source parity. Removing the
packaged continuation module deliberately fails that test. New execution identity
code is included in browser generation, Worker source hashes, dashboard assets and
local receipt/replay source hashing. No intercepted browser route can substitute for
these package checks.

Core validation command:

`node --test research-lab/asset-contract.test.mjs research-lab/execution-identity.test.mjs research-lab/continuation.test.mjs research-lab/coordinator.test.mjs research-lab/workflow.test.mjs research-lab/gateway.test.mjs`

Concurrency tests force two transitions to read before either commits and use the
actual gateway/WebCrypto core with a conditional-storage fixture. Tests cover lease
fencing, same-key retries, terminal failures, explicit reruns and scope rejection,
legacy rows, stale non-execution, competing revocation, and two foreground loops.
The intercepted browser suite covers old-server refusal, supported shared execution,
lost responses, and the explicit signed-owner rerun UI. Existing manual/workflow
browser suites remain in CI. Test logs report actual counts and outcomes.

A legacy lab-test command attempted to exclude socket tests, but its filter did not
apply and three loopback-dependent cases failed with EACCES. Those failures are
retained in the validation log; no override or further runtime retry was attempted.
Packaged Worker startup was not attempted. Actual network serving and packaged
Worker runtime tests remain CI gates; package closure and mocked transport tests do
not claim runtime certification.

## Durable background runner requirements - NOT implemented or activated

A truly durable runner still requires separately approved service-principal execution
authority (tenant, adapter, data class, budgets, expiry), secret issuance/storage/
rotation/revocation, supervised process and wake-up lifecycle, restart/drain recovery,
health ownership and alerts, durable version-bound approvals/dependencies, bounded
retry/dead-letter policy, audit retention and operational stop/rollback procedures.
The transaction constraint here solves canonical experiment identity, not that lifecycle.
Exactly-once external effects would require a separately reviewed execution protocol.

Existing owner connector contribution scopes do not authorize task claims/runs. Do
not repurpose owner sessions, GH_DISPATCH_TOKEN, repairOwnerEnvelope, sports/backup
cron or PR CI. New adapters, arbitrary code, real development data, external AI and
holdout require their own execution/data authority and review. No such expansion,
background service or scheduler is included, and no activation has occurred.


## Worker versus Pages release order and live prerequisites

This PR is **not covered by PR327's static-only release clearance**. It changes the
research server state machine. The PR does not alter `dawg-bot-worker.js`, live
settings or `wrangler.jsonc`; `build-worker.mjs` produces the isolated integrated
Worker candidate. Read-only inspection confirms the existing worker-deploy workflow builds and explicitly uploads `work/artifacts/research-lab/worker.mjs` with the full `wrangler.jsonc`. Its dispatch remains a separate release action, not PR validation.
The release owner must verify the reviewed artifact/entrypoint and complete existing
manifest/bindings before using a separately approved Worker release procedure.

Required sequence after independent review and exact-head CI:

1. Pin the approved commit and build/hash the full integrated Worker artifact.
   Check that existing bindings, routes, compatibility settings, secrets references
   and access settings are preserved. Do not use a partial manifest or silently
   enable an unset research flag. Upload/validate the Worker candidate through the
   approved procedure before traffic promotion; these are deployment actions and
   were not performed by this PR preparation.
2. Deploy/promote the approved Worker first, then use the owner's existing signed
   session for read-only `GET /research/v1/tenants/jason-bdb/state`. Confirm 200,
   canonical tenant/actor/kind, exact `executionPolicy:tenant-cas-experiment-v1`,
   and the expected candidate `codeHash`. Confirm the complete canonical response
   and existing CAS-backed store are healthy; missing policy or a stale hash blocks
   continuation. Do not expose/copy the session credential into logs or artifacts.
3. Publish the reviewed Pages/client assets with the recomputed SW cache version.
   Main merges publish the static site, so coordinate merge timing with the Worker
   rollout. A client arriving before the Worker stays fail-closed; do not treat
   that safe fallback as a successful feature release. Verify fresh and SW-controlled
   loads show the expected policy and truthful foreground status.
4. Only after separate execution authorization, validate one explicitly approved,
   current-code synthetic task end-to-end and reconcile its receipt. A changed
   Worker hash requires a new current synthetic data check/task; do not auto-create
   or auto-approve them. Stop on permission errors or uncertainty. Rollback must
   restore the reviewed Worker/static versions without modifying grants or data.

Read-only live prerequisites still to verify (not performed here): correct existing
research tenant/configuration and enabled endpoint; an existing authenticated user
session; existing `research:read`, `task:claim` and `experiment:run` capabilities;
existing `discussion:write` / `task:write` only if the owner explicitly creates a
check/task; and existing signedOwner authority for an explicit rerun. The state API
need not expose grant details, so use authorized release-side inspection of the
existing grant if scope verification is required. A 401/403/503 is a blocker, not
permission to repair envelopes, enable flags or expand access. Confirm no foreign
active lease or unresolved relevant receipt, the correct synthetic discovery input,
current hypothesis version and bounded budgets. No real data or holdout is needed.
