# Dawg Pound — private owner workspace, phase one

`dawg-pound.html` is a standalone private workspace shell. The historical `pound.html`
redirect remains unchanged. Existing sign-in supplies the session; there is no second
identity system, agent runtime, token minting, grant management, file upload or vault binding.

## Release status

**Owner release approval received on 2026-10-16.** The release manifest now explicitly
sets `DAWG_POUND_ENABLED=true` for private owner workspaces and the approved 30-day
backup policy. The handler still fails closed when that flag is absent or false.
This approval does not enable private MCP, external AI grants or vault storage.
No production database rules or logging settings are changed by this release.
The shell contains no private or example workspace data. Local preview screenshots use
synthetic data intercepted entirely in memory, not live users or agents.

Release verification requirements (approval received; runtime evidence is reported separately):

1. RTDB `/privatePounds` and every ancestor deny all unauthenticated and browser-client
   reads/writes, including collection reads and guessed child paths. RTDB ancestor allows
   override child denies: a child-only deny is insufficient. Test rules with the emulator
   and read-only production probes. The existing Worker `FB_SECRET` is the only storage
   access path; no new credential is required or created by this change.
2. Platform invocation/request logging, traces, analytics, exception capture and backup
   exports do not disclose private request bodies, credentials or content. Review URL
   capture too: rejecting query credentials cannot erase an upstream request log.
   The existing Worker has logging enabled. This PR does **not** claim route-level
   suppression exists. Keep activation closed if adequate isolation requires a separately
   approved Worker/logging configuration. No broad logging changes are part of this PR.
3. The owner approved separate private backup copies with rolling 30-day retention.
   Review capacity for the existing KV namespace before activation. This code creates
   no service or credential and does not alter access permissions.
4. Approve the exact frontend/Worker release and any required security configuration.
   Then use the complete manifest and existing Worker deploy runbook. Enable the flag
   only after the preceding checks pass. Do not enable agent access or vault storage.

## Identity and transport

Pound alone accepts `Authorization: Bearer <existing signed site session>` (the scheme
is case-insensitive). The browser reads the same existing sign-in session; no token is
minted or granted by Pound. The token must have exactly the existing two base64url
components, including the 43-character HMAC signature. Comma-combined/duplicate bearer
values, extra suffixes, name-only sessions and invalid/expired signatures are rejected.
`X-Dawg-Session`, `X-Bozo-Session` and `X-Dawg-Pass` are rejected by presence, even empty
or accompanying an otherwise valid Authorization value. There is no credential fallback.

A signed immutable `u_` UID is required before calling the existing account/password
revocation verifier. An in-memory header adapter supplies that verifier's existing input;
it is never fetched, dispatched or logged and cannot emit a custom session-renewal header.
The shared verifier, other applications' transport and public MCP auth are unchanged.
Although public MCP also uses Bearer, its connector tokens/shared passphrases are not
signed site sessions and cannot authorize Pound. `/mcp/pound` is intercepted before the
public MCP dispatcher and stays disabled. Caller-supplied identity fields remain rejected.
Every read and write is scoped to `/privatePounds/<verified UID>`. Recheck the account
immediately before committing. This has the same narrow check-to-commit revocation window
as existing session-based writes; no distributed transaction spans account and workspace.

All responses, including errors, use `private, no-store`, `nosniff`, no-referrer and
restricted origin headers. Query parameters are rejected. Private content never enters
the public board, `/data`, feeds, public MCP tools, Toto's DOM reader or application logs.
The shell has a restrictive CSP, no bot/analytics scripts, no content persistence and a
service-worker network-only exclusion. Only the existing session is read from storage.
Pound CORS permits only `Content-Type, Authorization`; the schema declares this exact
transport. The browser uses a fixed URL, JSON bodies, omitted cookies and refused redirects.

| Route | Behavior |
|---|---|
| `GET /api/pound` | Read the authenticated owner's complete bounded workspace |
| `POST /api/pound` | One validated owner mutation; revision and request ID required |
| `GET /api/pound/schema` | Authenticated schema, derived from the exact validator definitions |
| `/mcp/pound` and every suffix | Always 503; no tools or anonymous discovery |
| `/api/pound/agents/*` | Always 503; no persistent agent access |

`work/dawg-pound.js` owns validation and execution. `work/assemble.mjs` inserts it above
the public MCP write boundary. The owner schema includes an explicit disabled MCP
descriptor with no advertised tools. Future agent transports must use the same operation
definitions, add explicit least-privilege authorization, and receive separate approval.

## Measured platform logging check (2026-10-16 UTC)

An owner-approved disposable Worker, separate from production `toto`, received ten
synthetic requests: five with the production logging settings and five with query-string
redaction enabled only on the fixture. Both phases kept invocation logging/persistence
enabled at 100% sampling and traces disabled. There were no storage bindings, real
credentials or user content. All ten live-tail and all ten persisted invocation events
were inspected; persisted events were untruncated.

| Synthetic value | Live tail | Persisted invocation logs |
|---|---|---|
| `X-Dawg-Session` | Visible in both phases | Visible in both phases |
| `Authorization` | Value hidden in both phases | Value hidden in both phases |
| Request body and response body markers | Absent | Absent |
| Query value, redaction disabled | Visible | Visible |
| Query value, redaction enabled | Still visible | Hidden |

This measured leak is why Pound now uses Authorization and rejects legacy credential
headers. Rejecting a request cannot erase its upstream log, so callers must not send
credentials or content in custom headers or URLs in the first place. The fixture and
tail were deleted after 86 seconds; the script settings API returned 404 afterward.
Production settings/deployments were unchanged. No new grants or billing upgrade were
required; actual incremental billing was not measured. Raw logs were never saved locally;
only sanitized findings were retained. Provider-retained synthetic logs follow the existing
retention policy; deleting the Worker does not prove immediate log deletion.

This is evidence for the tested platform configuration, not a guarantee for every future
runtime, proxy, analytics export, exception trace or administrator-added log sink. The
fixture returned generic 200/400/401/500 responses and did not exercise uncaught exceptions.
No production logging configuration was changed, and other applications' custom-header
auth is outside this repair. Private content remains in bodies and errors remain generic.
The isolated test itself did not authorize deployment. The later owner release approval
covers Pound activation only, not new log sinks, external AI grants or vault storage.


## Writes, versions and limits

POST envelope: `{op, expected_revision, request_id, data}`. Operations are `agent.save`,
`task.save`, `message.add`, `context.save`, `context.archive`. Unknown properties fail.
Create IDs are server-generated; updates must reference an item in the verified owner's
workspace. No arbitrary object path or caller-provided owner is accepted.

One bounded JSON payload preserves RTDB empty arrays without normalization loss. A
whole-workspace ETag compare-and-swap commits the mutation, revision, owner-attributed
activity and idempotency receipt atomically. No silent last-write-wins retries. The last
128 request receipts replay identical requests and reject reused IDs with different input;
older retries fail their stale revision. The browser retains the same request after an
uncertain response. Small explicit saves are one-phase conditional writes; there is no
staging capability that could act as a persistent access grant.

Text context versions retain exact text, version title, SHA-256 of UTF-8 bytes, server
time and actor UID. Retrieval includes all retained versions; markup is rendered as text.
No model or external agent is invoked. Agent capabilities are owner-declared, connection
status is always `not_connected`, and `last_seen` is null. Task statuses are owner-reported.

Phase-one limits: 24 roster records, 40 tasks, 100 notes across all threads, 16 context
documents, 8 versions per document, 8,000 characters per version, 32 KiB request and
512 KiB serialized workspace. Archiving hides records; it does not free quota or erase
history. These are **lifetime workspace limits in this phase**, not rolling limits.
There is no UI purge/restore yet. The latest 60 activity entries and 128 replay receipts
are bounded rolling metadata. Explicit owner-controlled export/cleanup is future work.

Mobile hiding clears the sensitive DOM but retains unsaved drafts and uncertain requests
only in memory, bound to the original session and edit revision. Revalidation precedes
restoration; account changes and page navigation erase drafts. Another tab's edit causes
a conflict, not an overwrite. Archived-thread drafts retain their original thread and
remain available to copy; they never move to a different task.

## Private backups

The nightly job still reads RTDB once. It omits the top-level `privatePounds` subtree
from both newly written general backups (`backup:<day>` and `backup:latest`). All other
database content and its existing retention behavior remain unchanged: general dated
copies expire in 180 days; the general latest copy remains without expiry.

Each private workspace is copied separately to the existing private `RL` KV binding at
`pound-backup:v1:<verified-record-owner-uid>:<YYYY-MM-DD>`. Each write sets
`expirationTtl: 2592000` (30 days). No Pound `latest` key is created. Same-day retries
replace that day's key and restart its 30-day TTL; different days have independently
expiring copies. The snapshot includes its capture time, schema version, owner UID
and exact saved workspace record, including context history and revision.

These are separate logical backup objects in the existing namespace, not a new namespace
or permission boundary. No HTTP/MCP retrieval route is added. Access remains through
the owner's existing Cloudflare administrative access. No security-setting change,
credential, new resource or data deletion is required by this implementation.

General backup writes complete before private copies. A private write failure fails the
cron with a sanitized error; it never falls back to embedding Pound in general backups.
Earlier successful owner copies may remain after a partial run; retry uses the same keys.
The job has no RTDB write/delete operation and never expires active workspace records.
It does not delete or rewrite historical backups to remove any old content. This policy
only governs newly written backup copies after an explicitly approved deployment.

## Verification

`node --test tests/dawg-pound.test.cjs tests/service-worker.test.js`

`node work/test-identity.mjs` and `node work/test-mcp.mjs` verify existing identity and
public MCP behavior. Assemble twice through `cd work && node assemble.mjs` (built-in
idempotency proof), then run the usual Worker validation and data validator.

`tests/dawg-pound-ui.cjs` uses installed Chrome and `playwright-core`. Set
`POUND_PLAYWRIGHT_MODULE` to a test dependency path if needed and `POUND_CHROME` to the
browser executable. It intercepts every request, permits no live network, renders
desktop/mobile/context screenshots outside the repository, and exercises account changes,
safe text, mobile draft restoration, concurrent edits and exact uncertain-request replay.
The preview shows synthetic roles; it is not a deployed or connected-agent claim.
