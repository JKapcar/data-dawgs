# Bounded research workflow

This slice derives a dependency/evidence graph from the existing research-lab v1
hypotheses, discussions, tasks and immutable receipts. There is no new workflow
store, duplicated project charter, assignment record, scheduler or provider.
Project milestones and `depends_on` in `work/research-project.js` remain the
project-level source of truth; this graph describes one research attempt, not
project milestone acceptance. `RESEARCH_PROJECTS_ENABLED` stays false.

Open a hypothesis in the Lab or My Lab, then **Open dependency and evidence graph**.
The browser demo is memory-only. The loopback runner persists to its existing
private journal; My Lab uses the existing authenticated tenant gateway.

1. Question: an existing hypothesis revision.
2. Data check: `discussion.kind=data_check`, current `hypothesisVersion`, and
   synthetic discovery `tracking`. The existing validator checks schema; the
   discussion stores a data hash, implementation hash and observation count, not
   the tracking rows. This is explicitly NOT real development-data validation.
3. Experiment: `task.dataCheckId` binds the check. Existing claim/lease, observation
   (maximum 100,000) and runtime (maximum 5,000ms) limits apply. The input hash must
   match. Changed input yields a failed receipt; changed question/code refuses the
   stale task. Legacy tasks remain readable but cannot satisfy the bounded chain.
4. Separate review: a `review` discussion binds hypothesis version, receipt ID and
   receipt hash, with `ready` or `changes_requested`. The authenticated subject
   must differ from every question author and the runner. Delegated agent IDs and
   assistant labels do not establish a separate account reviewer. Distinct
   accounts still do not prove scientific independence. No review is fabricated.
5. Finding: a `finding` discussion binds the latest ready review and receipt.
   It is descriptive, with limitations in its body, not a hypothesis verdict.
6. Owner disposition: an `owner_decision` discussion binds the latest finding and
   review. Only a signed owner may `accept_descriptive`, `revise` or `defer`; each
   finding is decided once. It records `execution=not_executed`. Acceptance grants
   no access, triggers no work and does not set a scientific hypothesis verdict.

All new discussions use the existing `discussion:write` gate, tenant isolation,
idempotency, audit trail and storage compare-and-swap. Reference checks are
server-side. No additional capabilities or credentials are issued. The owner-apps
connector retains its existing note/challenge schema; these workflow operations
are available through the research gateway and dashboard, not implicitly added to
that connector. Existing owner-only hypothesis status operations remain separate.

The graph is a read-only projection, with linked prerequisite nodes, expandable
source records and safe citation links. Missing records, stale question/code,
failed execution, active leases, requested review changes and owner deferral are
shown separately. It uses a keyboard-accessible ordered list and mobile single
column, with text labels as well as border styles. Identity invalidation clears
its drawer. No private evidence is embedded in the public demo.

## October 18 readiness evidence and activation

The private readiness files were inspected locally, not copied into this public
repository. Receipt-to-report, receipt-to-inventory and configuration hashes match.
The receipt's code hash does NOT match the current local readiness audit script;
its hypothesis IDs have not been verified against live state. It therefore has
not been imported or labeled a verified development run. Its recorded status is
`descriptive_only_target_unresolved`, `baseline_fit=false`, `holdout_access=false`.
Recover the exact source matching the receipt hash and verify the live hypothesis
revision before designing a separately reviewed real receipt adapter. Hash matches
alone do not attest origin, source units, target validity, or scientific quality.

Unresolved owner design decisions: breaking-route mapping, T1 over-expected
construction and exposure weighting, source units/separation definition, and T2
snap denominator. Draft pick belongs only in a separately timed post-draft
comparison. No new predictive model fit is required before these decisions.

Required future actions, none performed by this PR:

- Merge the reviewed PR to publish Pages (main pushes deploy the site).
- Build `node research-lab/build-worker.mjs <private-candidate-directory>`, review
  its manifest/code hash, then explicitly authorize deployment of that candidate
  through the existing Worker release procedure. The generated candidate is not
  deployed by preparing this branch. Verify the private gateway after deployment.
- If no eligible separate account already has a valid research grant, the review
  stage stays blocked. Report and approve any exact grant change separately;
  this PR does not create a reviewer, accept an assignment or expand access.
- Verify old private receipt source/schema/provenance and current hypothesis
  bindings before approving a real development receipt adapter. That adapter is
  intentionally unconfigured; the synthetic adapter is not real modeling.
- No project flag, delegated-agent flag, credentials, persistent access, 2025
  holdout access/unlock, raw data publication, production deploy or merge is part
  of this implementation. Project-envelope activation is not needed for this
  per-hypothesis workflow and remains a separate owner decision.

## Verification

`node --test research-lab/workflow.test.mjs` exercises the full synthetic chain,
authenticated gateway, cross-tenant denial, self-review and label spoofing,
receipt hash/tamper checks, stale question/code, failed input, superseded review,
owner gate, repeated decision refusal, and exclusion of legacy tasks.

`node research-lab/workflow-browser.test.mjs` checks real dashboard interactions,
record links, blocked self-review, 1200/390/320px layout and page errors. Existing
lab, gateway, project, owner-apps, and exact-store regression suites are retained.
All test subjects, grants, data and results are synthetic fixtures. They are not
accepted real assignments or a completed real research review.
