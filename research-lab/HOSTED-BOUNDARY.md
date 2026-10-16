# Shared research release and activation boundary

## Release contents

The public `/research-lab/` dashboard runs the fixed synthetic audit in this tab's
memory. Receipts are real WebCrypto-hashed execution records; reload resets this
demo. It uses no account token, persistent storage, provider or shared service.
The Node loopback runner retains durable private journals and input-backed replay.

`build-worker.mjs` packages the current assembled production Worker with the research
gateway and native WebCrypto core, writing an isolated ignored artifact and a source
hash manifest. It never edits the root Worker or assembler. The existing manual
`worker-deploy` workflow uses the full unchanged `wrangler.jsonc` for dry-run, upload
and promotion. Bindings, encrypted secrets and existing schedules are preserved.
`X-Research-Code` identifies the packaged source hash.

Shared routes are disabled unless `RESEARCH_LAB_ENABLED` is exactly `true`.
The public client selects browser demo mode with `sharedEnabled:false`.
No research feature flag, grant, credential or schedule is activated by this release.

## Shared API and trust boundary

After approved activation, GET `/research/v1/tenants/{tenant}/state` and POST
`/research/v1/tenants/{tenant}/command` expose the same state/commands as the dashboard.
POST `/research/v1/tenants/{tenant}/mcp` supports JSON-RPC initialize, tools/list and
tools/call. No SSE, arbitrary code, external model call or background job executes.

Browser identity uses the existing signed session in Authorization: Bearer; the
older X-Dawg-Session transport remains compatible. Personal Bearer u_ tokens use
the separate existing MCP verifier.
Browser clients accept only the real site origins and existing Worker origin, reuse
the sign-in session and never fall back to local state after an authorization error.
Account changes invalidate pending responses, including JSON still being decoded.
No credential input UI is added. Legacy invitation seeding is disabled in research
authentication. Legacy name-only sessions and shared credentials are refused.

Every identity needs an enabled tenant grant with exact capabilities. Agent grants
must expire. Only the environment's exact RESEARCH_OWNER_UID may use an explicit
owner:true grant without expiry; existing session expiry still applies.
There is no grant-write endpoint. Independence compares canonical UID: several AIs
sharing a user token are one author, not independently authenticated agents. Research
scopes do not restrict that token on other site tools. Never distribute a broad
account token as a shortcut for delegated agent identity.

One private RTDB node `/researchLab/v1/tenants/{tenant}` contains version, grants,
an exact JSON payload for state/accepted synthetic inputs, and quota. The exact
encoding preserves nulls and empty collections through Firebase. Legacy raw
envelopes fail closed and require an explicit reviewed migration; none is automatic.
ETag conditional writes atomically commit
tasks, receipts, inputs, idempotency and audit. Revocation changes the same ETag;
conflicts re-read and reauthorize. Lease expiry is checked again before commit.

Limits: 2 MB UTF-8 request, 10-second body read, 4 KB credential header, 1 MB response,
8 MB store, five CAS attempts, 60 requests/account/minute and 240/tenant/minute.
Durable fixed-window quotas span gateway instances and browser/MCP identities for
one account. Authenticated malformed requests spend quota. Unauthenticated requests
create no records; existing edge infrastructure governs that traffic. Writes stop
before state exceeds the bounded readable response. Pagination and archival-scale
storage are future work; this design is a small pilot.

State reads omit grants, raw inputs and other actors' lease tokens. Only schema-valid
synthetic discovery input is archived. Malformed trials retain hash/failure receipts,
not raw unvalidated bytes, so hosted failure inputs cannot be replayed. Synthetic
provenance is caller-asserted, not verified fact. Licensed and held-out data cannot
run through the hosted adapter. Unknown fields are rejected. Messages remain inert,
untrusted content and never confer authority.

## Activation checklist — separate approval required

1. Verify deployed hash, current identity behavior and private RTDB path policy.
   If that path is not private already, stop for a security-rule review; do not
   weaken rules or expose research data.
2. Approve a named tenant, initial empty envelope, named UID grants, exact scopes
   and agent expiry through an authorized administration path. Durable owner access
   and private archive intake are specified in PRIVATE-ACTIVATION.md. No production records or
   grants are seeded by this release.
3. Review least-privilege delegated agent credentials, rotation and revocation before
   connecting independent AIs. Personal MCP transport is not per-model identity.
4. Approve the Worker feature flag and dashboard hosted configuration (mode, existing
   workerOrigin, tenant). Test signed-in write/read/reload, foreign-tenant denial,
   expired/revoked grants, duplicate claims and unauthenticated denial using synthetic
   data. A tenant selector must never grant access.
5. Before scheduling, approve provider identities, capabilities, tasks, budgets,
   cadence/timezone, retry/idempotency policy, delivery destination and stop switch.
   Test one synthetic invocation. No scheduler is configured today.
6. Real data requires verified access, licensing, schema and measurement audit, plus
   a reviewed adapter. Held-out evaluation needs a separate role/store, frozen
   protocol and split manifest, one-use approval budget and complete null/failure
   reporting. Daily exploratory identities must never see held-out data.

## Verification and rollback

Contract tests execute real repository identity/storage functions against an
intercepted ETag database. The generated full Worker runs in workerd with no Node
compatibility flag and intercepted outbound traffic. Hosted-browser tests exercise
signed-in UI, WebCrypto, CAS, receipts, reload and revocation. Public-browser tests
verify actual in-tab execution/hashes, reload reset, no backend traffic and responsive
layouts. Synthetic results never produce verified/falsified verdicts.

Release uses PR CI, Pages' main-branch build and the existing manual Worker workflow.
Record Pages commit and Worker version/hash after promotion. Roll back Worker traffic
to the previously serving version with `wrangler versions deploy OLD_ID@100% --name
toto`; revert this release through the normal PR path to roll back Pages. No data
migration is needed while shared access stays disabled. Do not delete unrelated state.

## Source audit update — 2026-10-16

The authorized data audit verified official Kaggle UI metadata: nine CSVs and a rounded displayed total of 2.31 GB. This verifies the manifest only. Schema remains pending, actual bytes and release hashes unavailable, and measurements unverified. No row counts, units, sampling frequency, key uniqueness or untouched holdout status are asserted. A missing writeup says nothing about rules acceptance. The UI metadata source is https://www.kaggle.com/competitions/nfl-big-data-bowl-2027/data . No competition data is included in this release.
