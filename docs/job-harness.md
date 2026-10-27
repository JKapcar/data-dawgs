# Job Harness: local review version

## October 27 integration (not activated)

Reuses PR #325 and its reviewed hardening patch. The production activation flag and logging settings remain unchanged. The public page contains no real job records. Current additional functionality:

- Discovered (`opportunity`), screened, approved, prepared, submitted, interview, offer and closed stages; blocked and no-later-decision outcomes remain explicit.
- `work.update` adds an append-only preparation entry with match, gaps, resume version, optional exact SHA-256, answer-source reference, next step and nullable ISO UTC deadline. Each new status captures a preparation snapshot. These references are owner-entered; the app does not certify source authenticity or compute an uploaded resume hash.
- `work.claim` accepts `{id, actor_label}` and returns a workspace containing a server-generated claim ID. `work.release` accepts `{id, note}`. Existing claims require the observed `claim_id` on every record mutation, including archive and release. CAS arbitrates simultaneous claims; stale claim IDs fail. Claims do not expire automatically. The owner must explicitly review and release abandoned work.
- All claims share the authenticated owner's identity namespace. Actor labels are self-reported, never proof of distinct agents, and claim IDs are coordination preconditions visible to the owner, not credentials or new grants.
- Authenticated GET `/api/jobs/v1/schema` exposes JSON schemas for nine supported HTTP operations using the existing signed site session. It does not add an MCP adapter, connect external agents, accept owner-shared MCP keys, or expand connector permissions.
- The dashboard highlights due actions/blockers, uses receipt-backed submission denominators, and keeps audit history collapsed. A rejection alone or interview-only record does not invent an earlier submission. Archived records remain in funnel denominators.

Narrow launch checklist: reconcile latest main; pass unit, browser, backup, assembly/cache, data and CI checks on final commit; review current direct database denials and platform telemetry privacy; receive required activation/logging approval; verify candidate configuration preserves unrelated settings; promote verified Worker before publishing page; verify signed-out/unauthorized denials and authenticated synthetic save/reload with CAS/idempotency; only then import an approved private packet and verify its private readback. No live deployment or real import is claimed by local checks.

Remaining: production gates and private import; no inbox automation, no automatic employer submissions, no external-agent onboarding. Ambiguous employer/requisition matches require explicit reconciliation; canonical exact duplicates are rejected. Unknown resume hashes, receipt dates, and application answers remain unknown.

Proposed route: `/jobs.html`, consistent with the site's standalone app pages. This is a new app, not a migration from a vault or a claim that an old tracker has been imported. No global navigation, account permissions, connector grants, schedules or credentials change in this patch. Existing daily Gmail checking remains independent and must report website integration as pending.

## Privacy and release gate

The `/api/jobs/v1` route reuses `poundIdentity`: exact signed bearer session, account/revocation verification, and rejection of legacy headers. It then requires the existing configured `RESEARCH_OWNER_UID`, or (only when the separate member list is set; see Friends below) a listed member. `JOB_HARNESS_ENABLED` must equal `true`; it is deliberately absent from configuration. Other users cannot read or write, even with known record IDs. There is no friend enrollment path.

Storage is a separate `/privateJobs/v1/<verified uid>` envelope containing `owner_uid` and a JSON-string payload. The nightly backup keeps job data out of both general snapshots (`backup:<day>`, `backup:latest`); like Pound, each workspace gets one copy per day under `jobs-backup:v1:<uid>:<day>` that expires after 30 days, so deleted or removed data ages out of backups within 30 days. Owner identity is checked both outside and inside that payload. No client-supplied tenant or owner is accepted. No job data shares a research tenant, Pound record, or public data file. Responses are private/no-store; the service worker excludes the whole app (`jobs.html`, `jobs.js`, `jobs-core.js`, `jobs.css`) and the API. The browser keeps records only in memory, clears on hide/account change, renders text safely and excludes records from assistant context. It uses only the existing session key; no content is written to browser storage.

The Worker module is generated, not hand-placed: `work/assemble.mjs` injects `jobs-core.js` followed by `work/jobs.js` between the `DD-JOBS` markers, directly after the project block and above the MCP write-scope boundary (the module commits with `fbPut`), and puts the route between the Pound and project routes. Edit the sources, then run `cd work && node assemble.mjs`; CI fails if the committed Worker differs from the assembled output.

**Rules snapshot verified locally:** The parent inspected the complete displayed RTDB rules; the exact SHA-256 9507116bd03e832af8cb9ab084845f82c9e21f2c894cf6aa48ed6718c2b34179 snapshot passed 174 emulator permission checks (160 denials, 14 expected allows). No direct-client grant is needed. This does not verify deployed gateway behavior or rules freshness at release. **Activation remains gated:** deployed logging/privacy handling and private readback have not been verified. Before activating, obtain approval for any necessary security configuration; verify direct database anonymous and other-user reads/writes are denied, then deployed API isolation and private save/readback. This patch neither changes rules nor enables storage. Handler tests prove local behavior; separate rules-emulator tests prove only the inspected snapshot. No real records should be entered until this gate passes. Friends exist only through the separate member list described below, which is absent from configuration; never add them to the owner UID or share this owner's envelope.

## Friends: isolated member workspaces (separate gate, off)

Friends get their own workspaces, never access to the owner's. The non-secret variable `JOB_HARNESS_MEMBER_UIDS` lists exact account ids, comma-separated. When it is absent, as in `wrangler.jsonc` (and, because of `keep_vars`, it must also be absent from the dashboard), behaviour is the owner-only v1 behaviour. A malformed list admits nobody extra, and the owner is never affected. Turning it on is a configuration change that needs its own approval after the owner release has passed its checks. Signup is open, so membership must stay an explicit list, never "any signed-in account".

Every member's workspace is derived only from their verified session: `/privateJobs/v1/<their uid>`, with the same envelope checks as the owner's. No request field, query or path can name a tenant. Records, history, receipts, request keys and duplicate detection are all per workspace. The response carries `access: "owner" | "member"`, and a member sees a disclosure that the site operator administers the database and can technically access stored data. The page does not promise more than that.

Covered by `tests/jobs-members.test.cjs` and `tests/jobs-members-browser.cjs`:
- default owner-only;
- malformed lists;
- each identity sees only its own workspace, and the owner cannot read members through the app;
- strangers are refused before storage;
- no cross-member deduplication or inference;
- another member's record ids answer exactly like random ids;
- request keys never replay across workspaces;
- caller-chosen tenants are refused;
- wrong-uid envelopes are refused;
- the flag and removal both close access while stored data is kept;
- in one tab, a slow response for the previous account never repaints the next one.

There are no server-side export or search endpoints; the page's filter runs only over the signed-in account's own loaded workspace. Direct database rules are unchanged and still deny every ordinary client.

Not built, and decisions to make before inviting anyone:
- how a friend learns the account id to send you;
- what happens to a removed member's stored data (it is kept; deletion needs its own decision);
- whether per-member limits should differ from the owner's (300 records, 1 MiB).

## Stored contract

Workspace v1: `owner_uid`, monotonically increasing `revision`, `updated_at`, `records`, durable `receipts`, and `source: {health: "not_connected", last_verified_at: null, sync: "pending"}`. The UI's latest verified time is explicitly the latest record evidence date; it is not a successful inbox-sync timestamp.

A record holds its listing fields (`employer_key`, `employer`, `role`, `requisition`, `url`, `url_verified_at`), its starting `resume_version`, `next_action`, `blocker`, a server `id` and `created_at`, and `events`, an append-only log. Identity is the employer key plus the requisition in canonical form: Unicode NFKC, trimmed, runs of whitespace collapsed, lower-cased. Invisible format characters (zero-width spaces, joiners, bidi marks) are removed first. That is canonicalization, not fuzzy matching: `REQ-1` and `1` remain different requisitions, and employer aliases must still be reconciled to one stable key. Archived records keep their identity, so re-adding an archived requisition is refused with a pointer to it.

## History log

Nothing in `events` is ever edited or removed. Entry kinds (an entry without `kind` is a status update, the original v1 shape):

| kind | holds | effect |
|---|---|---|
| status | `stage`, `outcome`, `occurred_at`, `verified_at`, nullable `evidence_url`, `reason_kind`, `reason`, `next_action`, `blocker`, `resume_version` | one dated, evidenced step |
| `correction` | `target` (log index of a status entry), `action` (`replace` or `void`), `replacement` (replace only), required `note` | supersedes that one entry; the latest correction for a target wins |
| `record_correction` | `changes: {field: {from, to}}`, required `note` | listing fields change in place; the log keeps both values |
| `archive` / `restore` | optional `note` | hides or shows the record; nothing else changes |

Every entry carries server `recorded_at` and the verified `actor_uid`. The effective timeline is every status entry after corrections (voided ones dropped), ordered by `occurred_at`, then log position; the current status is its last step. `jobs-core.js` computes this once, for both the page and the Worker.

The server keeps the effective timeline consistent: stages never move backward, and nothing is blocked/not-submitted after a submission. Plain updates cannot break that, and corrections that would are refused (`correction_conflicts_with_history`, with the two log indices). A correction may assert submitted, interview or offer only where a submission is already effective for that entry, or by restoring the original entry exactly (`JOBS_CORE.correctionMaySubmit`, `correction_cannot_create_submission` otherwise): a downgraded or voided submission cannot be re-upgraded with new details, and only a new update with evidence says an application reached the employer. Downgrading a mistaken submission is allowed. Archived records are read-only until restored.

An absent reason stays `unknown` with empty text. `explicit` needs an evidence reference; `inferred` is a labeled hypothesis, never a factual cause. A template email or timing does not establish automation or rejection reasons. No response means `no_later_decision`, never rejected. A receipt reference is owner-verified input; the service does not fetch links or certify employer authenticity. Saving a record or a draft never submits anything to an employer, and the page says so.

## Operations

POST `{op, data, expected_revision, request_id}`; `data` must have exactly these keys.

| op | data | refused with |
|---|---|---|
| `record.create` | the six listing fields, `resume_version`, `next_action`, `blocker` | `duplicate_requisition` (+ `duplicate_of`, `archived`), `record_limit` |
| `event.append` | `id` + the ten status fields | `older_evidence_requires_reconciliation`, `stage_regression_requires_reconciliation`, `already_submitted`, `duplicate_event`, `record_archived` |
| `event.correct` | `id`, `target`, `action`, `replacement` (null for void), `note` | `invalid_correction_target`, `correction_cannot_create_submission`, `correction_changes_nothing`, `correction_conflicts_with_history`, `record_archived` |
| `record.correct` | `id`, `changes` (any non-empty subset of the listing fields), `note` | `duplicate_requisition`, `correction_changes_nothing`, `record_archived` |
| `record.archive` / `record.restore` | `id`, `note` (may be empty) | `already_archived` / `not_archived` |

Status rules: stages opportunity, approved, submitted, interview, offer, closed; outcomes none, no_later_decision, rejected, position_closed, blocked_not_submitted, withdrawn, accepted. URL fields must be strings, at most 2,000 characters, HTTPS without credentials, with no surrounding whitespace and no control or format characters; text fields refuse control characters and bidi overrides. Submission/decision stages and decision outcomes require evidence; closed stages require a closed outcome; blocked/not-submitted needs a blocker and an opportunity or approved stage. `JOBS_CORE.OUTCOMES_BY_STAGE` is the same table the page builds its menus from, and a test checks it against these rules. A new update starts at the current stage with no outcome asserted; a closed stage starts on an explicit, required choice. Error bodies carry a fixed code plus, at most, record ids, log indices and booleans; the page maps every code to fixed copy and never displays server text. There is no delete operation.

## Concurrency and idempotency

GET first. POST with the exact workspace revision and a 16–80 character idempotency key. The key names one logical operation: the receipt fingerprint covers `op`, `data` and the key, not the revision. An identical retry replays the stored result (`replayed: true`), including a retry sent with a newer `expected_revision` after a 409 re-read; the same key with different content is `request_id_reused`. CAS uses the Firebase ETag and rechecks session revocation immediately before commit.

The page keeps the pending request across failures, and a save in flight cannot be dismissed. A lost response, or a 5xx after a POST (the write may have landed), is reported as unconfirmed and retried with the same key and revision. On `revision_conflict` the page re-reads the workspace under the open dialog, keeps the draft and the key, and sends the retry with the new revision, so an operation that had in fact committed replays instead of applying twice. A listing fix diffs against the values its form opened with, so a refreshed field the user never touched is not sent back. Separately, `event.append` refuses a status fact that is already on the effective timeline: same stage, outcome, `occurred_at` and evidence. That catches an identical re-entry, not one with a different happened time. Locking, hiding the page or switching accounts discards a pending key by design (privacy first), so after an unconfirmed save, check the history before re-entering.

## Ingestion contract (pending)

A bounded design for importing confirmations and status emails as owner-approved proposals is in [`job-harness-inbox.md`](job-harness-inbox.md). It is a proposal only: nothing is connected or scheduled.

Keep source message/evidence ID to request-ID mapping in private ingestion storage. Never blindly retry an employer submission: this app has no submission feature. The future reconciler must verify authorized principal, source health, canonical employer/requisition, evidence URL, event date, resume version and explicit vs inferred reason before append. Deduplicate source events privately, preserve the original evidence reference, compare new evidence with the entire history, and queue ambiguous/backdated/correction cases for owner review. Partial failures must not advance a complete-sync watermark. A completed daily run will require a run ID, scanned window, source cursor, verified event IDs, failures and server readback revision/hash before claiming website synchronization. These run fields are a proposed separate adapter contract, not implemented writable fields or a scheduled job. Do not connect inboxes or create another automation as part of this patch.

## Limits

Limits fail closed at 300 records, 300 log entries per record (corrections and archive entries count), 2,000 durable receipts (`workspace_full`, 409) or a 1 MiB payload (`workspace_full`, 413). No history or replay key is pruned, so 2,000 writes is the workspace's lifetime capacity, and archiving does not free space. Raising that needs a separate storage design.

## Acceptance and local verification

- Signed-out and cross-user read/write denied before storage; mismatched owner envelopes denied.
- Disabled flag, revoked sessions, hostile origins, query/path tenant attempts and legacy credentials fail closed.
- Duplicate identity (canonical, archived included), receipt replay/conflict, replay after a 409 re-read, duplicate facts, stale revision, ETag race and missing evidence tested.
- Corrections keep the original and record before/after; no correction creates a submission; inconsistent timelines refused; archive/restore keeps history, receipts, dates and duplicate detection.
- Synthetic preview clearly labeled; no private records, inboxes, resumes or client data in fixtures.
- `tests/jobs-history-browser.cjs` drives the real page against the real handler (in-memory storage): staged menus, required evidence, lost-response replay, 409 recovery, corrections, listing fixes, archived duplicates, archive/restore, keyboard focus return, inert hostile text and links, and 390/320 px history layout.
- Run `node --test tests/jobs.test.cjs tests/jobs-history.test.cjs tests/jobs-members.test.cjs tests/jobs-privacy.test.cjs tests/dawg-pound.test.cjs tests/research-project.test.cjs`, then `node tests/jobs-browser.cjs`, `node tests/jobs-privacy-browser.cjs`, `node tests/jobs-history-browser.cjs` and `node tests/jobs-members-browser.cjs` with Playwright 1.56.1 on `NODE_PATH`. After any page or Worker change: `cd work && node assemble.mjs && python3 stamp-sw-version.py`, then `node work/verify-sw.mjs`.

Repository `AGENTS.md` and `docs/visual-interaction-design.md` were read. Independent review was completed for the disabled v1 implementation and rules-emulator evidence; the history and correction layer needs its own review before release. This version has no deployment, production readback, inbox connection, auto-apply, enabled friend access (the member list is absent), or external communications.

## Local logging/privacy review and bounded release scope

The job page loads only its own scripts and style, has no analytics/beacon/third-party script, uses a restrictive CSP and no-referrer policy, and never writes record content to web storage. Form autofill is disabled as a browser hint. The API URL is fixed; payloads are JSON bodies and the existing session is an Authorization header. Links use HTTPS with no embedded credentials and noreferrer. They open only after an explicit click; anything else renders as plain text. Error UI uses fixed messages, never raw response/parser text. Lock, logout/account changes (including storage.clear), hide and page restoration clear private DOM and drafts; pending requests are aborted and old responses cannot restore state. Same-tab changes are detected at next request/focus or within 500 ms while active.

Synthetic sentinel tests cover application console/error output, extra request destinations, URL/referrer leakage, local/session storage, cache, assistant context, and clearing behavior. Service-worker tests verify private requests bypass caching and private/JSON responses cannot be stored. Changed public assets contain only invented examples; no real records were imported or read. This review does not certify unrelated pre-existing public content.

The job route returns before other dispatch paths, contains no console or analytics call, and converts unexpected storage/parse failures to a generic error. Shared identity helpers do not log. The complete manifest enables observability with logs only. The shared fbUrl helper places the existing server credential in an outbound `auth` query parameter. Cloudflare's Workers Traces fetch spans record `url.full` and `url.query`; tracing is off unless `observability.traces.enabled` is set, and the manifest does not set it. `tests/jobs-privacy.test.cjs` fails if the manifest enables traces, Logpush, tail consumers or export destinations while fbUrl still sends the credential in the URL. What Workers Logs invocation logs store for incoming requests (headers, query strings) is not documented field by field, so application tests cannot certify it: before activation, inspect current logging/tracing/export settings and a synthetic observation for header/body/credential redaction. If any change is required, present its exact diff and obtain separate approval; no logging configuration changed here.

Residual, pre-existing and site-wide: the signed session lives in site-wide localStorage, so any script running on the origin can use it. `swoledawg.html` loads Chart.js from jsDelivr without an integrity hash; a compromised copy could call this API as the signed-in user. Recommended as its own change: pin it with SRI or self-host it.

Bounded approval target, once platform logging/privacy checks pass: release only this job page, its style and scripts, the Worker route/module and cache version using the complete existing manifest, then set the non-secret Worker variable `JOB_HARNESS_ENABLED="true"`. Keep `RESEARCH_OWNER_UID` unchanged. The manifest sets `keep_vars: true`, which keeps dashboard-set variables across deploys, so also confirm neither `JOB_HARNESS_ENABLED` nor `JOB_HARNESS_MEMBER_UIDS` is already set in the dashboard. Release order: upload and promote the Worker version first, then push the page (Pages deploys on push; the Worker deploys only on dispatch). The flag stays off until both are live. Any later `jobs-core.js` change likewise needs the Worker promoted before the page push; the server is authoritative either way. Reuse existing signed sessions and server storage authority; create no credential, grant, database rule or public job data. Verify a synthetic private save/readback and denied signed-out/other-user API access under the approved release test plan before importing real records. Roll back activation by removing the flag or setting it to "false"; preserve stored history. Do not disable worker-wide logs without separate approval.

Friend access remains rejected server-side unless the separate member list is approved and set. Inbox sync, connector access, daily reconciliation writes, new schedules, employer submissions/auto-apply, resume-file upload and any automated correction, deletion or archival remain unavailable; corrections and archival exist only as owner actions in the page. Approval for this release must not imply those capabilities or changes to other applications.
