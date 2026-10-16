# Research machine contract v1

## Run the preview

Node 22 or later, no npm dependencies:

```sh
node research-lab/server.mjs
# http://127.0.0.1:8788
node --test research-lab/lab.test.mjs
node research-lab/browser.test.mjs
node research-lab/replay.mjs PRIVATE_STATE_DIRECTORY RECEIPT_ID
```

`LAB_PORT` overrides the port. `LAB_STATE_DIR` selects a **private directory outside
the repository**. Default: OS temporary directory / datadawgs-research-lab. Preserve
that directory if you want durable research; OS temp cleanup can remove it. One
writer owns the directory. A crash leaves writer.lock; confirm no process is using
the directory before removing that lock. The JSONL journal verifies its chain on
startup and fails closed on corruption. It is append-only through this application,
not tamper-proof against a machine administrator. Receipts have no edit/delete API.
Input artifacts are retained beside the journal under their content hash. The replay
command verifies journal, receipt, input and current code hashes before comparing the
descriptive summary. It refuses changed code; check out the original source revision.
Failure replay checks integrity without claiming deterministic timing reproduction.

## Current trust boundary

The Node runner is a single-user loopback preview. No internet authentication or authorization grant
is configured. Host and Origin checks reject cross-site browser writes; the service
does not accept a requested tenant, role or capability. The trusted local principal
is selected in server code, and has a single tenant. Other local processes are inside
this trust boundary. Do not expose this server through a tunnel or remote binding.
The public page additionally offers a memory-only synthetic browser demo. Shared Worker packaging and the disabled activation boundary are documented in HOSTED-BOUNDARY.md. No grants, credentials or security rules are changed.

The reusable `transition(state, trustedPrincipal, command, now, codeHash)` function
enforces tenant ownership and capability scopes before mutation. `view` filters all
collections by tenant. The principal **must never come from an agent message or
request body**. The hosted gateway provides conditional tenant storage, existing identity verification, durable rate limits, revocation and atomic claim/commit; activation is separate. The file writer lock supplies single-process serialization locally.

## Authorized external AI / MCP adapter (unwired and unconfigured)

`gateway.mjs` now implements scoped HTTP and synchronous MCP dispatch plus an ETag
storage adapter. See `HOSTED-BOUNDARY.md` for executable routes, identity reuse,
tests, account-versus-agent limitations and the remaining Worker packaging boundary.
The browser still uses the local runner; no hosted route has been mounted or enabled.

A future gateway must verify audience, expiry, tenant, subject, allowed tool scopes
and revocation from a server-owned credential mapping. Existing website sessions or
Dawg Pound MCP tokens do not imply research access. No credentials are created here.
The adapter projects MCP tools onto the same operations below, derives principal
server-side, and never lets tool arguments widen grants. Reads require research:read.
Do not expose journal paths, other tenants, lease tokens belonging to other agents,
or raw held-out data. The current local dashboard is not that gateway.

| Operation / proposed MCP tool | Required scope | Payload |
|---|---|---|
| hypothesis / research_hypothesis_write | hypothesis:write | title, method; optional id + expectedVersion |
| evidence / research_evidence_add | evidence:write | http(s) url, title, excerpt |
| discussion / research_discussion_add | discussion:write | hypothesisId, kind note/challenge, body, evidenceIds |
| task / research_task_create | task:write | hypothesisId, split discovery, budgetMs, maxObservations |
| claim / research_task_claim | task:claim + task capabilities | taskId, leaseMs |
| run / research_experiment_run | experiment:run | taskId, leaseToken, tracking |

Local transport: GET `/api/state`, GET `/api/tracking`, POST `/api/command` with
`{type,key,payload}`. JSON body <=2 MB. Idempotency is scoped to tenant + actor + key:
same key and exact payload returns the original result; changed payload conflicts.
Lease tokens are random, owner-bound and expire. Expired tasks can be reclaimed.
Synthetic audit tasks freeze hypothesis revision and fixed method. Every accepted
run terminally records success, null, or failure. Invalid/unauthorized commands fail
without changing research state. Queue another task to retry a failed experiment.

Agent prose is untrusted data, rendered with textContent. No HTML/Markdown execution,
URL fetching, code execution, or instruction extraction. Challenges are independent
only when their actor is absent from the hypothesis authorship history. Identity
verification still belongs to the future gateway; this preview has one local owner.

## Tracking and statistical boundary

`tracking.mjs` exports the executable normalized v1 validator and deterministic
synthetic fixture. Explicit convention: yards, x right, y up; angles counterclockwise
from +x. Field bounds 120 × 53⅓ yards. No silent coordinate conversion. Frames retain
sourceFrameId and strictly increasing variable timeMs; empty entity arrays are legal.
Each entity identifies player/ball and cohort; x/y/speed/dir/o may be null. Omitted
measurements normalize to null; missing lists are derived per entity/frame. Events
are strings and supplied events are displayed. Provenance is required but unverified.
Licensed input can be inspected locally, but the runner rejects it until the audit
and verified-data adapter are implemented. Held-out input is rejected by the loader.

The fixed study reports descriptive speed means and motion/body angular alignment,
not hip–shoulder decoupling, EPA, completion probability, or a fitted baseline. Frame
observations are dependent. Uncertainty intervals are null, with an explanation.
Synthetic results never change a hypothesis to verified or falsified. Code, data and
config SHA-256 hashes accompany receipts; input hash uses exact JSON serialization,
so object ordering is significant. Runtime is checked around bounded synchronous
computation, not a hard subprocess deadline. Input and observation limits bound work.
No plugins, subprocesses, arbitrary methods or external model calls are executed.

## Held-out gate and future milestone

Held-out runs are unavailable to all local operations. A future independent gate must
freeze a preregistered protocol, split manifest, code/config hashes, discovery receipt
set and a human-approved access budget before granting a separate evaluation role.
Store held-out data outside exploratory credentials. Count all evaluations and publish
null/failure outcomes; one-use approvals must be transactionally consumed. Do not let
daily agents repeatedly inspect test metrics or select only successful receipts.

Real competition access, schema, licensing and study are blocked pending actual files.
The supplied competition URLs are references, not evidence of verified schema:
https://www.kaggle.com/competitions/nfl-big-data-bowl-2027 and
https://operations.nfl.com/programs-initiatives/innovation/big-data-bowl .
