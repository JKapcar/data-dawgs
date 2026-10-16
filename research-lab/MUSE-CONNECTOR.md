# Connecting Muse to Data Dawgs (header credential, no URL token)

Written 2026-10-16 from the server source (`work/mcp-block.js`, `mcpRoute` / `mcpPassOf` /
`mcpAuth`). It was checked against the assembled Worker with a synthetic credential.
**Muse has not been tested end to end yet.** Record the result in `CROSS-CLIENT-PROOF.md`.

This guide contains no credential. Placeholders look like `<THIS>`.

## The one rule

Claude's working connection carries the token **inside its URL path**. Muse must not get that
URL. Give Muse the endpoint below, and enter the token **only** in Muse's secure
credential/header field. Never paste a token, or a connector URL containing one, into
Muse's chat, an issue, a PR, a screenshot or a shared doc.

It is the same personal token Claude uses, so no rotation is needed, and none should be done:
rotating would break Claude's connection. Nothing in this guide changes any permission.

## Connection settings

| Setting | Value |
|---|---|
| Transport | Streamable HTTP over HTTPS (port 443). Stateless JSON-RPC 2.0 over `POST`; no session ID, no SSE stream (`GET` with `Accept: text/event-stream` returns 405). |
| Endpoint | `https://toto.jkapcar4.workers.dev/mcp/core` |
| Header name | `Authorization` |
| Header value | `Bearer <PERSONAL_CONNECTOR_TOKEN>`, where `Bearer` is spelled exactly like that (case-sensitive) with one space |
| Alternative header | `X-Dawg-Pass: <PERSONAL_CONNECTOR_TOKEN>` (same token, no `Bearer`). Use it only if Muse cannot set `Authorization`. |
| OAuth | None. The server has no OAuth endpoints. |
| Protocol versions | `2025-03-26`, `2025-06-18`, `2026-07-28`; anything else falls back to `2025-06-18`. |

Notes on the endpoint:
- `/mcp/core` is the smaller catalog (57 tools plus the owner tools), so it costs Muse less context. All three tools below are in it.
- `/mcp/full` is the larger catalog (88 plus the owner tools); `/mcp` with no suffix also serves the full catalog.
- `<PERSONAL_CONNECTOR_TOKEN>` is the token from DataDawgs → Connect Your Dawg. It starts with `u_`. Enter it only in Muse's secure field.

### If it fails

| What Muse reports | Meaning |
|---|---|
| 403 "credential not recognised" on `/mcp/core` or `/mcp/full` | The header was **not sent**, or the token is wrong. Without a header, the server reads the word after `/mcp/` as the credential and rejects it with a 403, not with a 401 challenge. |
| 401 with `WWW-Authenticate: Bearer` | No credential at all, on the bare `/mcp` endpoint. |
| A Muse OAuth prompt | Muse is trying OAuth because the header was missing. This server has no OAuth, so fix the header instead. |
| `dd_owner_pound_*` missing from the tool list | Either the credential isn't the owner's, or the Pound permission is off. `dd_whoami.private_apps.pound` says which. |

## The three tools

### 1. `dd_whoami`: check the connection first

Call it with no arguments: `{}`. Expect:
- `player` is the owner's display name;
- `anonymous: false`;
- `credential_transport: "header"` (proves the token came from the header, not a URL);
- `private_apps.pound: "on"`. Any other value names the reason: `off`, `expired`, `not_owner`, `app_disabled`, `storage_unavailable`.

### 2. `dd_owner_pound_read`: read before every write

Call it with no arguments: `{}`. It returns:
- `workspace`: tasks, messages, contexts and their versions, and `revision`;
- `writeSchema`: the exact per-operation shapes;
- `identity`: `assistantIdentity: "unverified"`.

Use `workspace.revision` as `expected_revision`. Use a task's `id` as `thread_id`, and its `revision` as `expected_task_revision` when updating it.

### 3. `dd_owner_pound_write`: one change per call

Arguments are one flat object:

```json
{
  "op": "message.add",
  "expected_revision": <workspace.revision from the read>,
  "request_id": "<16-80 chars of A-Z a-z 0-9 _ ->",
  "data": { "thread_id": "<task id, p_...>", "text": "<1-2000 chars>", "kind": "finding" },
  "assistant": "Muse"
}
```

| `op` | `data` |
|---|---|
| `task.save` | `title` (1–120), `body` (0–2000), `agent_id` (`""` or `p_…`), `status` (`queued`, `working`, `done` or `blocked`), `archived` (boolean), optional `refs` (up to 8, each ≤300). To update, add `id` plus `expected_task_revision`. |
| `message.add` | `thread_id`, `text`, optional `kind` (`question`, `finding`, `challenge`, `decision` or `note`; default `note`), optional `refs`. |
| `context.save` | `title` (1–120), `text` (1–8000), optional `refs`. Add `id` to save a new version of an existing document. |

- **`assistant`** is optional (1–40 chars). It is stored as `author_label` with `author_label_trust: "unverified"`, and is never used for access.
- **Retries:** to retry after a lost response, resend the **identical** call with the same `request_id`. The answer comes back with `replayed: true` and nothing is written twice.
- **409 `revision_conflict`:** read again and use the new `revision`.
- **409 `task_revision_conflict`:** someone changed that task; read again.
- **Refused:** roster changes (`agent.save`), context archiving, scheduling and permission changes all return `operation_denied`. That is by design.

## After connecting

Run the five steps in `CROSS-CLIENT-PROOF.md` with assistant label `Muse`, and fill in Muse's row there. That row includes the transport `dd_whoami` reports, and it should say `header`.
