# Cross-client proof — Dawg Pound over the personal connector

Written 2026-10-16 for the "BDB Research Lab and Dawg Pound" release plan (PR 2).
**No client has passed this script yet.** The results table at the bottom is empty on
purpose: the owner fills it in from their own accounts. Nothing in this repository claims a
result for any client until a row is filled with a date, a commit and a captured artifact.

## Before you start

- The Worker build under test must include PR 1 and PR 2 (flat tool schemas, `private_apps`,
  `credential_transport`, message `kind`, task revisions). Record the deployed Worker version.
- Turn **Dawg Pound** on at Connections → Manage app permissions. BDB can stay off.
- Use a scratch task in your own Pound. Do not use real private content in this script.
- **Connector tokens and connector URLs are credentials.** Never paste them into this file, an
  issue, a pull request, a screenshot or a shared doc. Record results only; redact anything
  that shows the token. If one leaks, rotate it on the Connect page.

## Per-client setup (all unverified until a row below is filled)

Endpoint: `https://toto.jkapcar4.workers.dev/mcp/full`. Header: `Authorization: Bearer <token>`.
Fallback URL: `https://toto.jkapcar4.workers.dev/mcp/full/<token>` (same token, inside the URL).

| Client | Setup | Prefer |
|---|---|---|
| Claude | Settings → Connectors → Add custom connector. If the dialog has no header field, use the fallback URL. Enable the connector in the conversation. | header if offered, else URL |
| Gemini | Spark on the web → Settings & help → Connected Apps → Custom apps for Spark. Use the header if the form offers one, else the fallback URL. Spark currently requires a US personal account, 18+, English and Keep Activity on. | header if offered, else URL |
| Grok | Wherever Grok accepts a remote MCP server: endpoint plus Authorization header; fallback URL only if it has no header field. | header |
| Muse | If Muse can add a remote (Streamable HTTP) MCP server: endpoint plus Authorization header; otherwise the fallback URL. | header |

## The script

Ask the assistant to make each call **exactly** as written and to show you the raw result.
Replace `<…>` placeholders with values from the previous step. Use a fresh `request_id` per
client (keep the client name in it so receipts are traceable), at least 16 characters.

### Step 0 — identity and transport

```json
{"tool": "dd_whoami", "arguments": {}}
```

Expect `private_apps.pound: "on"` and `credential_transport` of `"header"` or `"url"`.
Record the transport. If `pound` is anything other than `on`, stop: the reason code says why
(`off`, `expired`, `not_owner`, `app_disabled`, `tenant_unconfigured`, `storage_unavailable`).

### Step 1 — read

```json
{"tool": "dd_owner_pound_read", "arguments": {}}
```

Record `workspace.revision` as `<R>`. Pick a non-archived task id as `<TASK>` and note its
`revision` as `<TR>`. If there is no task, create one first with `task.save` (no `id`).

### Step 2 — message.add, kind finding, with an assistant label

```json
{"tool": "dd_owner_pound_write", "arguments": {
  "op": "message.add",
  "expected_revision": <R>,
  "request_id": "xclient_<client>_msg_0001",
  "data": {"thread_id": "<TASK>", "text": "Cross-client proof: synthetic finding.", "kind": "finding"},
  "assistant": "<client name>"
}}
```

Expect a receipt with a new `revision` (`<R+1>`) and `identity.author_label_trust: "unverified"`.
In the Pound page the message shows `finding · your connector · "<client name>" (unverified)`.

### Step 3 — context.save

```json
{"tool": "dd_owner_pound_write", "arguments": {
  "op": "context.save",
  "expected_revision": <R+1>,
  "request_id": "xclient_<client>_ctx_0001",
  "data": {"title": "Cross-client proof", "text": "Synthetic context written by <client name>."},
  "assistant": "<client name>"
}}
```

Expect a new context with `active_version: 1` and version 1 `predecessor: null`.

### Step 4 — exact replay

Repeat **Step 3 byte for byte** (same `request_id`, same `expected_revision`, same data).

Expect `"replayed": true` and no second context or version.

### Step 5 — task.save with a wrong task revision

```json
{"tool": "dd_owner_pound_write", "arguments": {
  "op": "task.save",
  "expected_revision": <R+2>,
  "request_id": "xclient_<client>_task_0001",
  "data": {"id": "<TASK>", "title": "<unchanged title>", "body": "<unchanged body>", "agent_id": "<unchanged>",
           "status": "working", "archived": false, "expected_task_revision": <TR + 7>}
}}
```

Expect an error whose text is `task_revision_conflict` (HTTP-equivalent 409) and no change to
the task.

### Pass rule

A client passes only if all six steps behave as expected **and** you keep an artifact: the
raw tool results (token redacted) or a screenshot with no credential visible. The artifact's
location goes in the table.

## Results (owner fills in; empty means not tested)

| Client | Date | Worker version | Transport (Step 0) | S1 read | S2 finding | S3 context | S4 replayed:true | S5 409 | Artifact | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| Claude | | | | | | | | | | not tested |
| Gemini | | | | | | | | | | not tested |
| Grok | | | | | | | | | | not tested |
| Muse | | | | | | | | | | not tested |
