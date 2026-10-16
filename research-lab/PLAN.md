# Agent-native research lab — preview milestone

> **Superseded (2026-10-16).** This document predates the "BDB Research Lab and Dawg Pound" release plan of 2026-10-16. Where they disagree, the plan and `OWNER-CONNECTOR.md` win. Kept for history; do not treat its status lines as current.

Isolated from production identity, Worker configuration, and Dawg Pound PR258.
No external agents, credentials, schedules, data grants, merge or deployment.

1. A versioned tracking contract, synthetic fixture and descriptive local study.
2. A shared research state machine: hypothesis revisions, cited evidence, challenges,
   capability-scoped task claims, expiring leases and idempotent writes.
3. Append-only local journal and immutable receipts with input/code/config hashes,
   uncertainty, baseline limitations, null/failure outcomes and resource limits.
4. A dashboard reading that state, with task execution, cohort summaries and tracking.
5. Contract/security/browser tests, independent review, screenshots and a draft PR.

Boundary: this is a single-user local runner with trusted process-side principals.
It is not an internet authentication service. External API/MCP adapters remain
unconfigured; a future gateway must verify scoped credentials and derive tenant and
capabilities server-side. Browser input and agent prose never confer authority.
Held-out runs are denied in this milestone; synthetic discovery results cannot
verify/falsify a hypothesis. Verified competition data and rules are still pending.
