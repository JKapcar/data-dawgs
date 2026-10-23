# Read-only toto inspection proposal

This is code for a separately reviewed, manual `worker-inspect` workflow. Do not
dispatch `worker-deploy` for inspection: `promote=false` still builds and uploads.
No deployment, migration, deletion, credentials, grants or settings are changed.
PR330 remains stopped. This patch does not alter the PR327/328 site or Worker code.

## Approval boundary

Before adding this workflow to main, review the complete workflow, script and tests
at the intended commit. Adding to main can trigger the repository's existing Pages
deployment, so merging/pushing is a separate approval boundary from this local patch.
Before a privileged dispatch, the owner/reviewer must approve the exact main commit
and this metadata-only scope. Do not run a modified branch with secrets. The main
and repository guards are defense in depth, not substitutes for source review.
No workflow has been dispatched as part of preparing this proposal.

The workflow uses only the two existing deployment secret references. Their values
must never be retrieved by an agent or copied into commands. Token validity remains
unknown; the historical October 19 run 39304078138 does not establish current access.
The existing token may permit writes: GET-only code does not narrow its permissions.
A failure must stop inspection, not trigger login, token rotation or expanded grants.

## Read path and output

Node 22 is already used in CI. Built-in fetch calls the official Cloudflare API;
no new package install or Wrangler process is needed. The two endpoints are:

- [List Worker Deployments](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/)
- [Get Worker Script Version](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/)

The first listed deployment is documented as actively serving traffic. Inspect only
its positive-traffic versions, then reread deployments and reject any changed active
deployment. This is a point-in-time consistency check, not an atomic snapshot or a
guarantee that traffic stays unchanged after completion. Historical deployments are
not reported. Unknown/missing binding shapes or types fail closed.

Only Worker name `toto`, version UUIDs, normalized deployment timestamp, traffic
percentages and binding names/types reach stdout. No feature flag values are needed.
Binding values (including plain text and JSON), resource IDs, authors, annotations,
account ID, script content and API diagnostics are omitted. Raw responses exist only
in bounded process memory; no raw logs, files, summaries or artifacts are written.
Sanitized stdout is retained in the usual Actions log and may be publicly visible;
reviewers must accept disclosure of binding names/types. Names are metadata, not a
guarantee against someone deliberately embedding sensitive text in a valid name.

Every request is GET to a fixed host and Worker, with redirects refused, a ten-second
deadline and a 1 MiB decoded body cap. There are at most 12 requests (two deployment
reads plus ten versions), 100 listed deployments, 256 bindings per version, no retries
and a five-minute job deadline. Account and version IDs are validated before use.
Failures emit one fixed message, never exception text, response bodies or partial
metadata. Checkout does not persist credentials; GitHub permission is contents:read.
Pinned actions run before Cloudflare credentials are supplied to the final step.

## What this cannot establish

Metadata cannot prove owner execution scopes, identity claims, per-user permissions,
effective authorization in application storage, working integrations, secret validity,
runtime health, successful scheduled jobs, routes/DNS coverage, or complete migration
dependencies. Binding presence is not proof that the resource is healthy or accessible.
This does not read D1/KV/R2/Firebase data, export anything, verify actual data backups,
check backup freshness/completeness, or demonstrate a successful restore. A safe exit
requires separately approved backup and restore verification and replacement-service
validation before any cutover or deletion. No promise of permanent authentication-free
operation follows from reusing CI credentials.

## Local validation

Run `node --test tests/worker-inspect.test.mjs` without Cloudflare credentials.
Synthetic fixtures cover private values in plaintext/JSON/secret bindings, arbitrary
errors, redirects, invalid IDs, bad schemas, size/count limits, traffic splits and
concurrent deployment changes. The mock transport rejects every request except the
allowlisted GET metadata paths. These are contract/security tests, not evidence of a
successful live API call. Do not invoke the inspector locally with production secrets.
