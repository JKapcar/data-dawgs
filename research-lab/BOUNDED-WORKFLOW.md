# Bounded research workflow

The dependency/evidence graph is derived from existing research-lab v1 hypotheses,
discussions, tasks and immutable receipts. It adds no workflow store, project
charter, assignment record, scheduler or provider. Project milestones and
`depends_on` in `work/research-project.js` remain the project-level source of
truth. `RESEARCH_PROJECTS_ENABLED` stays false.

Open a hypothesis in Lab or My Lab, then **Open dependency and evidence graph**.
The public demo is memory-only; the loopback runner uses its existing private
journal; My Lab uses the existing authenticated tenant gateway.

1. Question: an existing hypothesis revision.
2. Data check: `discussion.kind=data_check`, current `hypothesisVersion`, and
   synthetic discovery `tracking`. The existing validator checks the schema. The
   stored record contains hashes and observation count, not tracking rows. This
   does not validate real development data.
3. Experiment: `task.dataCheckId` binds the check. Claim/lease, observation (at most
   100,000) and runtime (at most 5,000ms) limits apply. Input hashes must match.
   Legacy tasks cannot satisfy the bounded chain. If the question, withdrawal
   status or implementation invalidates a task, claiming terminates it as `stale`.
   An already leased stale run records a terminal failed refusal with
   `execution=not_executed`, clears the lease and marks the task stale. It archives
   no input. History remains; stale tasks leave active counts and cannot rerun.
4. Review has two explicitly different modes:
   - `review` requires a distinct authenticated account subject from the question
     authors and runner, and a receipt-bound `ready` or `changes_requested`
     disposition. Delegated agent IDs and assistant labels cannot establish that
     separation. Even account separation is not proof of scientific independence.
   - `advisory_review` accepts same-owner Pack contributions under the existing
     discussion scope. It is server-stamped `advisory_not_independent`,
     `authority=nonbinding`, `independent=false`. It requires the current question
     version. Optional receipt ID/hash must be a matching pair; only a
     receipt-bound advisory can support a workflow finding.
5. Finding: a `finding` discussion binds the latest receipt-specific review.
   A ready separate-account review or an explicit advisory may support a
   descriptive finding. Advisory-derived findings retain their non-independent
   label and cannot be silently upgraded by a different assistant name.
6. Owner disposition: `owner_decision` binds the latest finding and review. Only a
   signed owner may `accept_descriptive`, `revise` or `defer`; each finding is
   decided once. It preserves `reviewMode`, `separateAccountReviewSatisfied`,
   `scientificGate=not_satisfied`, `holdout=unavailable`, and
   `execution=not_executed`. It sets no scientific hypothesis verdict and grants
   no access, execution, fitting or deployment permission.

The local signed-owner runner can finish the advisory path without inventing a
second reviewer. The public demo can record advice/findings but cannot invent a
signed owner. Owner-connected Pack tools can write advisory reviews and findings;
owner decisions remain with the signed owner. Existing notes/challenges remain
valid. No existing policy prohibits non-independent advice: owner-apps already
permits discussion contributions and explicitly denies binding owner actions.
This slice makes advice and its limitations typed and visible.

The existing tenant isolation, idempotency, audit, capacity and compare-and-swap
rules still apply. No new capability strings, credentials, grants or permission
flags are issued. The owner-apps read schema describes advisory/finding fields;
its write schema still rejects `review`, `owner_decision`, tasks, claims and runs.
Existing owner-only hypothesis status operations remain separate.

The graph provides linked prerequisites, expandable records, safe citation links,
text status labels, keyboard access and a mobile single column. The attempt
selector preserves every data-check/task chain. A current accepted attempt stays
selected by default after another check; a user can explicitly select the new
attempt or any historical chain. A check/queue button selects the attempt it just
created. Question/code changes visibly stale historical records rather than
rewriting them. Each attempt also retains linked review/finding/decision history.
New advice leaves the earlier disposition visible as a historical record while
the current path honestly waits for its own finding and owner decision. Attempt
labels explicitly describe the last recorded disposition, not approval of newer
advice. Identity invalidation clears the drawer.

## Private evidence

Private receipt reconciliation belongs in the owner's private evidence records,
not this public repository. No private source snapshots, receipts, inventories,
per-athlete outputs or reconciliation details are included here. Local artifact
integrity does not itself establish scientific correctness or a live hypothesis
binding. Historical evidence must remain immutable.

## Real descriptive adapter: feasible, not activated

A descriptive receipt adapter does not need to fit or choose T1. It can safely
represent coverage, missingness, duplicate-key checks and descriptive measurement
summaries with `synthetic=false`, `baseline_fit=false`, no model metrics, and
explicit unresolved target/units. It must be a distinct, reviewed method/schema;
the current synthetic tracking adapter must never be relabeled as real modeling.
The existing machine still rejects real tracking runs. No live import was made.

Before a schema-valid import or real run can be recorded, require:

- An authenticated read of the intended tenant and canonical hypothesis ID, its
  latest revision/version and design fingerprint. The prior local seed IDs are
  not verified live bindings. The owner must confirm whether the old descriptive
  audit is evidence for that question; do not retroactively claim it tested T1.
- A bounded task/method explicitly representing a readiness audit, bound to that
  revision, the pinned development manifest, exact code/config hashes, table and
  year allowlists, and budgets. An imported historical receipt must state
  `historical_import`, original run timestamps and later import time separately;
  never fabricate a lease, execution actor, assignment, or earlier binding.
- Strict receipt/report/config/inventory schema validation, expected source and
  method pins supplied independently of the uploaded claims, byte hashes and
  private-output checks. Reject unknown flags, fitting/target claims, 2025 scope,
  non-null predictive metrics and unresolved/mismatched bindings. A client JSON
  assertion alone is not trusted provenance.
- References to private evidence, not raw rows, per-athlete exports, local file
  URLs or public archive links. Hash consistency is necessary but does not prove
  source units, scientific validity or independent execution.
- A fresh version/CAS check at import and an idempotency key. Preserve original
  receipts as immutable evidence and keep advisory versus separate-account
  review labels through any subsequent finding/owner disposition.

No authenticated BDB read tool was available in this execution context, so no live
hypothesis revision, task binding or reviewer availability is asserted. There is
no reason to rerun an audit just to compensate for an unverified live binding.

Owner design decisions still needed: breaking-route taxonomy, T1 over-expected
construction and exposure weighting, release-linked units/separation definition,
and T2 denominator. Draft pick is only a separately timed post-draft comparator.
No target selection or predictive fit is made here.

## Activation and verification

After code review: merge to publish Pages (main deploys the site); separately
build/review and authorize deployment of the Worker candidate using
`node research-lab/build-worker.mjs <private-candidate-directory>`. New connector
schemas become live only with that approved deployment. Existing Pack note/challenge
contributions remain available before it. If separate-account review is required
and no eligible grant exists, report the exact missing grant for approval; the
advisory path does not create or replace that grant. Real receipt import requires
the bindings and separately reviewed adapter above. No flags need changing for
this per-hypothesis slice. No deployment, merge, access change or holdout unlock
was performed.

Core and gateway tests cover both review modes, owner gates, hashes, stale tasks,
immutable attempt history, and unchanged connector grants. Browser tests exercise
successful advisory and separate-account review/finding/owner flows, self-review
refusal, stale queue removal, history selection, and 320/390px layouts. Test data,
subjects and grants are explicitly synthetic and do not constitute real review.
