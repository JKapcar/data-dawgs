# Dawg Pound — private owner workspace, phase one

`dawg-pound.html` is a standalone private workspace shell. The historical `pound.html`
redirect remains unchanged. Existing sign-in supplies the session; there is no second
identity system, agent runtime, token minting, grant management, file upload or vault binding.

## Release status

**Disabled by default. This PR must not be merged or deployed without approval.**
`DAWG_POUND_ENABLED` is intentionally absent from `wrangler.jsonc`. Merely deploying
the code does not activate storage. No production rules or logging settings were changed.
The shell contains no private or example workspace data. Local preview screenshots use
synthetic data intercepted entirely in memory, not live users or agents.

Before enabling, obtain explicit approval and verify:

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
3. Review RTDB quota, retention and backup policy for this private namespace. This code
   creates no service or paid resource; do not assume that existing capacity is unlimited.
4. Approve the exact frontend/Worker release and any required security configuration.
   Then use the complete manifest and existing Worker deploy runbook. Enable the flag
   only after the preceding checks pass. Do not enable agent access or vault storage.

## Identity and transport

Only the `X-Dawg-Session` site header is accepted. A signed immutable `u_…` UID is
required before calling the existing account/password-revocation check. Name-only
sessions, shared connector/bearer credentials and supplied identity fields are rejected.
Every read and write is scoped to `/privatePounds/<verified UID>`. Recheck the account
immediately before committing. This has the same narrow check-to-commit revocation window
as existing session-based writes; no distributed transaction spans account and workspace.

All responses, including errors, use `private, no-store`, `nosniff`, no-referrer and
restricted origin headers. Query parameters are rejected. Private content never enters
the public board, `/data`, feeds, public MCP tools, Toto's DOM reader or application logs.
The shell has a restrictive CSP, no bot/analytics scripts, no content persistence and a
service-worker network-only exclusion. Only the existing session is read from storage.

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
