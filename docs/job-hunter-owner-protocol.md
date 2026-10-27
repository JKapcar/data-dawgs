# Private owner Job Hunter protocol

This describes the application HTTP API. It is not an MCP integration or evidence that any external AI is connected. Existing shared owner credentials do not establish independent agent identities. Do not copy session credentials into prompts, URLs, logs or records.

Use an already authorized owner session through a client that supports that session. If the client cannot authenticate, stop; this protocol grants no access. The server checks the authenticated identity and selects its private storage namespace. A self-reported work label is only a label.

Base URL: `https://toto.jkapcar4.workers.dev/api/jobs/v1`.

1. GET `/schema` using the existing session's Bearer authorization header to obtain exact input schemas. GET the base URL to read the workspace and current revision. Never put credentials or records in query strings.
2. POST the base URL with JSON `{ "op": "<operation>", "data": {}, "expected_revision": 0, "request_id": "<stable-unique-request-id>" }`. Fill `data` from the live schema and use the revision just read. Request IDs contain 16–80 ASCII letters, digits, underscores or dashes.
3. Claim a record before coordinated work. Use the returned claim ID in the top-level `claim_id` for subsequent mutations. Re-read on a conflict; never take over another claim silently. Release with a reason when finished.
4. Preserve the same operation, data and request ID after an uncertain result. A confirmed replay is success, not a second write. On revision conflict, read again and reconcile changes before resending with the same request ID and refreshed revision. Do not change the request content under that ID.
5. Read back and verify the persisted history, evidence and receipt. Reporting a submission requires actual submission evidence, never a prepared draft or an intention to apply.

| Operation | Purpose |
| --- | --- |
| `record.create` | Create one distinct job or contact |
| `event.append` | Append a status and its evidence |
| `event.correct` | Append a correction without deleting the original |
| `record.correct` | Correct listing fields with an audit note |
| `record.archive` | Hide a record while preserving history |
| `record.restore` | Restore an archived record |
| `work.update` | Record match, gaps, resume references, answers provenance, next step and deadline |
| `work.claim` | Claim work with a self-reported label |
| `work.release` | Release the current claim with a reason |

Unknown requisitions, posting links and times remain null. A stable source identity prevents missing requisitions from collapsing distinct records. Missing posting links cannot be marked verified. Contact records stay outside the application funnel.

An audited migration can preserve a historical portal acknowledgment with its immutable private source reference, timestamp precision and limitations. That evidence is not a current portal check and cannot establish an interview. Historical closed-before-submission evidence likewise does not create a submission. An audit snapshot is owner-provided provenance, not independent certification by this service.

The private file importer computes the packet hash locally, deduplicates linked targets and uses the same nine operations with deterministic request IDs. It stops for intervening edits, claims, corrections or conflicting identities. It does not submit applications or contact employers. Re-selecting the same file after a reload safely resumes confirmed operations; unresolved conflicts require reconciliation.

Keep audit packets outside Git, public hosting assets and CI logs. The browser clears loaded records and selected import data when locked, hidden or the session changes. No automated inbox synchronization is implied.
