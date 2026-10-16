# Durable collaboration adapter — executable code, not a live service

## What exists now

`gateway.mjs` exports an executable Request/Response handler. Its tests invoke the
actual repository `sessionAuth`, `readSession`, `mcpAuth`, `fbGet` and `fbPut` functions
extracted from the checked-out Worker, with an in-memory HTTP/ETag database replacing
network access. The tests do not contact Firebase or mint any real credential.

The local preview still uses `server.mjs` and its private disk journal. It has not
been switched to hosted storage. The new gateway is not imported by the Worker,
not assembled into `dawg-bot-worker.js`, and not reachable on production URLs.

## Smallest hosted storage path

Reuse existing Firebase RTDB conditional writes, rather than provision a new database.
One private node per tenant: `/researchLab/v1/tenants/{tenant}`. Its envelope contains
`version:1`, server-managed `access.users` / `access.agents`, research `state`, and
content-addressed synthetic `inputs`. Grants contain enabled, expiresAt and explicit
capabilities. There is no grant-write endpoint. An absent envelope/grant fails closed.

All commands, leases, hypothesis revisions, evidence, discussion, receipts, inputs
and audit records commit under the same ETag. Two clients racing for a task cannot
both claim it. A concurrent access revocation changes that same ETag; retries read
and reauthorize the new grant before committing. An 8 MB envelope limit rejects
further writes instead of truncating receipts or silently dropping failed trials.
This is a small-pilot architecture, not a high-volume archival store. Splitting
large inputs/receipts into object storage needs an explicit transactional design.

## Identity and scope

- Browser: existing `X-Dawg-Session` → `sessionAuth`; immutable UID required. Legacy
  display-name-only sessions are refused. Password resets retain existing revocation.
- AI transport: personal `Authorization: Bearer u_...` → existing `mcpAuth`, passed
  only a sanitized canonical `/mcp` request. Shared passwords, URL/query credentials
  and `X-Dawg-Pass` are refused. The usual token rotation/revocation still applies.
- Neither identity implies research access. The corresponding explicit, expiring
  grant must exist in that tenant. Tenant selection in a path is not a grant.
- Human actor is `user:{uid}`; MCP actor is `mcp:{uid}`. A single user's existing MCP
  credential is one identity, **not separately authenticated identities for each AI**.
  The gateway scopes that credential on research routes only; it does not narrow the
  credential's permissions on other existing site tools. Do not distribute an existing
  broad account token to every AI. True per-agent credentials/rotation need a separately
  approved delegated-identity design; none are created by this PR.
- Read requires `research:read`. Writes use the core operation-specific capabilities.
  Reads omit other actors' lease tokens. Access grants and raw stored inputs are not
  returned by the state projection. Content remains untrusted/inert.

## Executable adapter routes (only when mounted and enabled)

| Route | Behavior |
|---|---|
| GET `/research/v1/tenants/{tenant}/state` | Scoped shared state |
| POST `/research/v1/tenants/{tenant}/command` | Same validated research commands as the local core |
| POST `/research/v1/tenants/{tenant}/mcp` | JSON-RPC initialize, tools/list, tools/call using the same state and scopes |

The MCP subset is synchronous JSON request/response; no SSE, background jobs, provider
connection or scheduler is implemented. `research_state` and scoped `research_*`
operation tools are executable in the adapter tests, not merely names in a contract.
The default gate is `RESEARCH_LAB_ENABLED !== 'true'` → 503. No configuration changed.

## Before any external change

1. Finish Worker packaging: `gateway.mjs` itself is runtime-neutral, but the current
   core imports `node:crypto`. The existing manifest has no `nodejs_compat` flag.
   Port the hashing/UUID dependency or review a compatible bundle before integration;
   do not silently add a runtime compatibility setting.
2. Review the integration diff against the then-current Worker/assembler. Avoid the
   independent Dawg Pound PR; neither its unpublished identity changes nor its files
   are a dependency of this adapter.
3. Obtain explicit approval to mount/publish the routes, enable the feature, and create
   the named tenant/grants. Confirm the RTDB path is private under existing rules.
   If it is not already private, stop for security-rule approval rather than weaken
   checks. No secrets, tokens, grants or production records have been changed here.
4. Establish least-privilege independent agent identities before connecting external
   providers. No broad credentials should be handed out as a shortcut.
5. Connect the browser and test a controlled hosted round trip before describing state
   as hosted/shared. Real-data ingestion, held-out gate and scheduling remain disabled.

The architecture supports a durable multi-client state transition once integrated.
It does not establish that a deployed endpoint, production access policy, independent
AI identity or live provider connection currently exists.
