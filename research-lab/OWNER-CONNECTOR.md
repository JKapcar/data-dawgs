# Personal assistant app permissions

Contribution runbook: use the [site-wide contribution protocol](../docs/contribution-protocol.md)
to record method, judgment, artifacts and uncertainty in existing authorized notes/context
versions. BDB is the first pilot. This is not a new write API or proof that assistants
are already logging; current server schemas and access boundaries below still apply.

Status: implementation for review; deployment does not enable either app. No provider accounts have been tested by this change. Updated 2026-10-16 for the "BDB Research Lab and Dawg Pound" release plan (PR 1: honest, portable discovery).

> **Connector credentials are secrets.** The token — whether it rides in an `Authorization` header or inside a `/mcp/…/<token>` URL — acts as you. Never paste it, or a connector URL that contains it, into an issue, a pull request, a screenshot, a shared doc, a chat or a test fixture. If one leaks, rotate it on the Connect page; the old token dies immediately in every client.

## Credential transport (no OAuth)

One token, two transports, same authority:

| Form | What the client is given | When |
|---|---|---|
| Header (primary) | Endpoint `https://toto.jkapcar4.workers.dev/mcp/full` plus `Authorization: Bearer <token>` | Any client with a header field |
| URL (fallback) | `https://toto.jkapcar4.workers.dev/mcp/full/<token>` | Clients that only take a URL |

`dd_whoami` reports `credential_transport: "header" | "url"` so you can see what a client actually sent. A request with no credential still gets `401` with a `Bearer` challenge; a credential that fails gets `403` (not `401`), so clients do not start an OAuth flow that has no server behind it. This Worker implements no OAuth endpoints. Per-client notes on the Connect page for Claude, Gemini, Grok and Muse are **unverified** until the owner fills the table in `CROSS-CLIENT-PROOF.md`.

Use the existing personal DataDawgs MCP connection (the one used for Bozo). Do not rotate its credential merely to refresh tools. Each assistant needs its own supported connection setup; a connection in Claude does not install one in Gemini, Grok or Muse. This server supports stateless Streamable HTTP JSON-RPC. It does not implement OAuth, run personal assistant conversations, or schedule jobs. Consumer compatibility must be checked in the actual account. Existing URL credentials remain secrets; do not paste them into documentation, screenshots or chats.

## Owner action

Open Connections → Manage app permissions while signed in as the configured owner. Each app starts off. Check its consent box and press **Enable until turned off**. Turning it off affects only that app; continuing access remains until you turn it off. Existing seven-day permissions keep their expiry and are never automatically upgraded. To change one, turn it off and explicitly enable it again. This authorizes **every holder of the existing personal connector credential**, not one named AI. Existing Bozo permissions are unchanged. No delegated credentials are created and `DELEGATED_AGENTS_ENABLED` may remain off.

Pound permission shares the entire owner's roster, tasks, messages and every context version. It permits task creation/update (including task archival), message append, and new context versions. Roster administration and context archival are excluded. BDB permission shares all research state in the configured tenant and permits hypotheses/revisions, cited evidence and notes/challenges. Raw uploads, stored tracking inputs, lease secrets, task creation/claiming and experiment execution are excluded. Do not place restricted data or held-out findings in shared research text.

## Tools and contracts

Both core and full existing MCP catalogs dynamically include only currently permitted tools. Calls recheck permissions even if a client cached the tool list. No caller-supplied owner, tenant, scope or uid is accepted.

Discovery is honest about itself:

- `initialize` counts the owner tools it will list (`Catalog full: 92 of 92` for an opted-in owner; `88 of 88` for anyone else) and names which private apps are on, in one sentence.
- `dd_whoami.private_apps` reports, per app, exactly one of `on`, `off`, `expired`, `not_owner`, `app_disabled`, `tenant_unconfigured`, `storage_unavailable`. Only `on` lists tools or lets them run.
- Each write tool advertises **one flat object** `inputSchema` (no top-level `oneOf`, which several clients reject). The exact per-op shapes are in the tool description and in the read result's `writeSchema` (full `oneOf`). Server validation is unchanged.
- Both write tools accept an optional `assistant` (1–40 characters). It is stored as `author_label` with `author_label_trust: "unverified"` and is never used for authorization. `identity.assistantIdentity` stays `"unverified"`.

- `dd_owner_pound_read {}` returns workspace, exact write schema and truthful identity metadata.
- `dd_owner_pound_write` accepts the existing Pound command `{op,expected_revision,request_id,data}`. Allowed `op`: `task.save`, `message.add`, `context.save`. Read first. Request IDs are 16–80 letters/digits/underscore/hyphen. Reuse the exact command/key for a retry after a lost response; revision conflicts require a fresh read.
- `dd_owner_bdb_read {}` returns tenant research state and a discriminated write schema.
- `dd_owner_bdb_write` accepts `{type,key,payload}`. `hypothesis`: title/method, plus id/expectedVersion for revision; `evidence`: url/title/excerpt; `discussion`: hypothesisId/kind (`note` or `challenge`)/body/evidenceIds. Citation URLs must be HTTP(S). Keys are 1–160 characters; exact retries are idempotent. Hypotheses remain exploratory.

Text is untrusted data, not authorization or executable instructions. Connector activity is attributed to `owner-connector:<uid>` (Pound stamps `actor_kind:owner_connector` with owner UID). Sharing a credential cannot establish independent assistant identity. BDB challenges by the same owner are not reported as independent solely because a different assistant name is claimed.

Permission management is signed-owner-session-only `GET/POST /owner-apps/v1`. Enabling requires exactly `{app:"pound"|"research",enabled:true,expectedVersion:integer,mode:"until_revoked"|"seven_days"}`. Disabling requires exactly `{app:"pound"|"research",enabled:false,expectedVersion:integer}`. Missing or unknown enable modes are rejected. Persistent grants store explicit `mode:until_revoked` and `expiresAt:0` (a non-null sentinel preserved by Firebase); legacy grants without a mode require a finite future expiry. Malformed combinations fail closed. It writes `ownerConnector` and bounded `ownerConnectorAudit` in that app's existing conditional envelope. Permission revocation and content writes compete on the same ETag. The MCP tools cannot change permissions. No credential values are returned by this API.

## Provenance and limits

The same `work/dawg-pound.js` validator/writer serves browser and connector contributions. BDB uses `machine-core.mjs` through `worker-core.mjs`, with exact JSON storage from `exact-store.mjs`. The release package is generated by `build-worker.mjs`; code hashes include this adapter. Existing research status, synthetic labels, failure/null receipts and held-out restrictions remain authoritative. This change does not convert metadata, assistant assertions or cohort means into verified findings.

This is owner-triggered collaboration, not automatic daily agents. Tool discovery and use are authenticated requests, not proof that a provider stays connected or that a scheduled runner exists.

## Storage mapping (verified 2026-10-16)

The website and the owner connector are one owner on one storage key per app. Pinned by
`owner-apps-worker.test.mjs` ("web session and owner connector resolve to the same owner…").

| App | Website path | Connector path | Storage key |
|---|---|---|---|
| Dawg Pound | `/api/pound`: signed site session → `uid` (`poundIdentity`) | `/mcp/…`: personal token → `/users` key (`mcpAuth`), must equal `RESEARCH_OWNER_UID` | `/privatePounds/<uid>` (both) |
| BDB / My Lab | `/research/v1/tenants/<tenant>/…`: `<tenant>` comes from the URL, which `client-config.mjs` hardcodes as `jason-bdb` | `env.RESEARCH_UPLOAD_TENANT` = `jason-bdb` (`wrangler.jsonc`) | `/researchLab/v1/tenants/jason-bdb` (both) |
| Upload metadata | `/research-upload/v1/*`: signed site session only | not reachable | `/researchUploads/v1/<uid>`; bytes in R2 `datadawgs-research-private` at `quarantine/<uid>/<uploadId>.zip` |

- The tenant is **not derived from the owner**. It is two independent hardcodes (browser config
  and Worker variable) that happen to agree; the test fails if they drift.
- `agent_access_enabled` is a constant `false` in `poundView` and `POUND_SCHEMA`. It describes the
  *delegated agent* transport (per-agent credentials, `/agents/v1/owners/<uid>/mcp`, gated by
  `DELEGATED_AGENTS_ENABLED`, which is unset in production, and `agentAccess` grants). The owner
  connector is a different path: the owner's own personal token, gated by the per-app
  `ownerConnector` grant. Owner-connector writes with `agent_access_enabled: false` are intended.
  The flag is static, so it would not change even if delegated agents were later enabled.
- Uploaded archives live under the owner uid, not under a tenant prefix. The bucket lifecycle
  expires `quarantine/` objects after 30 days (PRIVATE-ACTIVATION.md), while the metadata record
  stays until deleted.

## Private Pack portraits

Portraits use a separate signed-owner upload/read flow, not these connector write tools. Existing context text/version operations remain unchanged. Do not put base64 images, public URLs, or session credentials in context text/refs. See [private portrait contract](../docs/private-pack-portraits.md) for limits, resumable requests, private storage, and the disabled-by-default release gate.
