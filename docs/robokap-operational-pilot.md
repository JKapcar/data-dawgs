# RoboKap operational pilot

Local draft based on main `499655fac560b3b787c0d47a99fa726960dedef6`.
No live pilot has been run by this change. Production acceptance remains 0/2 tasks.
The 2025 holdout remains sealed; this pilot makes no BDB scientific acceptance claim.

## Existing capabilities and this change

The existing graph handles role acceptance, owner approval, dependencies, bounded
leases/attempts, evidence, advisory review, owner decisions and uncertain outcomes.
This change adds a snapshot evidence summary to the owner page and extends the
packaged authenticated fixture through both tasks. It changes no Worker logic,
permissions, grants or schema. A lease is not execution; a key label is not a model
identity; a saved session reference is not a connection or wake mechanism.

## Two-task contract

Use invented task text and synthetic inputs only. A produces a short synthetic BDB
validation specification; B depends on accepted A and checks that specification.
The automated fixture uses note artifacts, proving coordination rather than artifact
correctness. A real pilot must additionally inspect its saved artifact content.

Before any live write: verify the signed owner's successful `/robokap/v1` read,
current tool schema, existing eligible labelled key, and connector readback from
the actual foreground session. Do not use the shared primary key. Reuse an effective
role if appropriate; otherwise owner proposal, same-key acceptance and owner approval
are three separate steps. No new key or access grant is part of this plan.

Commands use existing `dd_owner_robokap_write` with `{op, request_id, data}`;
owner-only operations use the signed owner route. Keep request IDs stable when an
answer is lost; never turn uncertainty into a fresh attempt automatically.

1. Owner plans A: `rk.plan`, task ID, expected plan version 0, selected seat,
   `review: advisory`, `decision: required`, `data_scope: synthetic`,
   budget `{attempts: 1, lease_minutes: 5}`.
2. Owner plans B with `depends_on: [A]`, `review: none`, `decision: required`,
   `data_scope: none`, budget `{attempts: 2, lease_minutes: 5}`.
3. Session reads queue; A eligible, B blocked. It claims A with plan version 1,
   declared session reference and an ephemeral lease secret. It reports artifact
   and outcome. A different existing key may provide an advisory review; this is
   not independent identity verification. Owner inspects and accepts A's receipt.
4. B becomes eligible. Claim B, then owner stops it with `rk.release` containing
   only task and claim IDs. A late uncertain report must be stale and block retry.
   Owner reconciles with `rk.decide`, subject `uncertain`, receipt ID and decision
   `not_landed` only after checking that no effect occurred.
5. Claim B again: attempt 2. Report its synthetic result. Replay the identical
   report request: same receipt, no second write. Owner inspects and accepts B.
6. Read back: exactly A and B accepted at current versions, no eligible pilot work.

The packaged fixture is executable in `research-lab/robokap-worker.test.mjs`.
Core tests separately cover voluntary release, expiry, stale dependencies, attempt
exhaustion and lost responses. Cancellation closes a lease, not a running process;
the human/session must stop execution too.

## Acceptance and receipts

Denominators: 2/2 current task receipts accepted; 1/1 dependency gate enforced;
1/1 owner stop recorded; 1/1 uncertain result reconciled before retry;
1/1 duplicate report returns the original receipt without another write;
0 unauthorized writes; 0 holdout reads; 0 new credentials or paid calls.
For the live pilot record task/plan/claim/receipt/decision IDs, source revision,
timestamps and artifact hashes in the private workspace, never private content in
this repository. A passing synthetic fixture does not satisfy live acceptance.

Stop after two accepted tasks, B's second attempt, a five-minute lease expiry,
any changed dependency/schema/access, uncertain effect or request for new access.
Human work budget: 20 minutes total; no renewals during the pilot. Do not extend a
budget silently. If interrupted before a result, release; if an effect is uncertain,
report uncertainty and wait for owner reconciliation. Lease secrets stay in memory.

## Execution path and gates

Today: a person opens an existing supported assistant session and asks it to read,
claim, work and report using its already authorized tools. This worker cannot verify
an actual Pack connection from repository code. The owner board cannot wake agents.
The private Pound and research Lab remain separate; a Lab link is a read-only check,
not permission to dispatch research or access the holdout.

Next gate is the authenticated foreground pilot, not a new scheduler. A future runner
needs a documented supported runtime, verified session/tool identity, cancellation
acknowledgment, bounded dispatch and evidence-backed liveness. Task-scoped credentials
would be a separate security design and approval; existing owner-authority labels
must not be described as task-scoped. No background service, subscription, API model
substitute, arbitrary webhook or assistant-wake API is introduced here.

Release this page/test-only draft only after review and normal CI. Worker deployment
is unnecessary for these changes; no publication is authorized by this local draft.
