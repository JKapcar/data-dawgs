# Scoped agent connection pilot

This release is inactive unless `DELEGATED_AGENTS_ENABLED` is exactly `true`.
It creates no credential, grant, account, schedule, external call or OAuth service.
Existing signed owner access is preserved. The old `/mcp/pound` endpoint stays
disabled; a roster entry never establishes a connection. Start with one agent and
one explicit task/context allowlist before expanding to other clients.

## Trust and private grant contract

Authorization is `Bearer da1_<32 lowercase hex agent ID>_<43 base64url secret>`.
Activation must generate 32 random secret bytes with a cryptographic generator;
the grammar alone does not guarantee entropy. Store only SHA-256 of the complete
credential, never the credential itself, in each approved resource grant.
Use a distinct identity for each independent agent host, and preferably separate
credentials per audience. No owner session or personal site MCP token is suitable.
This credential format is rejected by the existing owner/public MCP verifiers.

Each grant has `enabled`, `expiresAt` (Unix milliseconds, mandatory), `audience`,
`credentialHash` and explicit `capabilities`. No wildcard scopes are supported.
Expiry and revocation are checked on every request and again before writes.
Grants live in the same ETag record as their workspace, so a concurrent revocation
prevents stale writes. In-flight reads may complete from the pre-revocation snapshot.
Disabling `DELEGATED_AGENTS_ENABLED` stops all delegated entry points. To revoke one
agent across both workspaces, disable its grant in **both** records; this is not a
cross-database atomic operation. Rotation changes the hash in each approved record.
There is no anonymous or agent-authorized administration endpoint. A separately
disabled owner setup pilot is described below.

## Owner-operated setup pilot (not activated)

`/research-lab/agent-setup.html` calls `/agent-setup/v1`. The server requires
`AGENT_SETUP_ENABLED=true` plus the existing signed site session for the exact
configured research owner. This flag is absent from the release configuration.
The independent `DELEGATED_AGENTS_ENABLED` switch still controls agent use.
No OAuth flow or provider account sign-in is implemented.

After separate approval and activation of setup, the owner loads existing resources,
selects the Claude roster, one assigned task/thread and one context version, checks
the consent box, and issues a Pound credential. A separate BDB credential grants
only the four research scopes. Expiry is fixed to seven days; callers cannot submit
custom scopes, target owners, expiry or arbitrary storage paths. One active Claude
pilot per audience is permitted, with at most sixteen retained grant records.
The page never creates workspace content. Create missing resources in Pound first.

Each secret is generated with 32 random bytes and displayed only in the successful
issuance response; storage retains its SHA-256 hash. Grant updates, bounded setup
audit metadata and existing data share one conditional write. The page uses no
analytics, external scripts, secret browser storage or automatic provider connection.
It clears the secret on hide/navigation/session change. User-operated clipboard copy
is optional; clipboard contents must be cleared by the user after pasting.

The owner pastes the connector URL and the Authorization header directly into
Claude's custom connector Request headers fields. Never use a credential URL.
Current Claude documentation explicitly describes this consumer-app option; its
availability in this user's account and actual end-to-end connector negotiation
have NOT been verified. The supported browser runtime currently fails before opening
an app (Windows HRESULT 0x80070003). If Request headers is unavailable, stop instead
of weakening authentication or placing a credential in a URL.

Issuance is never automatically retried. If a response is lost, load the grant list,
revoke the uncertain grant, and issue a replacement. Existing secrets cannot be read
back. Revocation is per audience; revoke both records for complete withdrawal.
The UI labels grants as issued, not connected, and preserves the separate disabled
execution switch. Expired/revoked owner research access cannot mint new research grants.
Signed-in live owner issuance and actual Claude use require explicit approval and
are not part of synthetic tests or preview screenshots.

### Pound

POST `/agents/v1/owners/{ownerUID}/mcp` supports MCP initialize, initialized
notification, tools/list and tools/call. It accepts Authorization only, rejects
URL credentials and legacy credential headers, and bounds JSON requests to 32 KiB
and ten seconds. The separate owner workspace flag must also be enabled.

Private `/privatePounds/{ownerUID}` envelope gains optional
`agentAccess[agentID]`. Audience must equal `pound:{ownerUID}`. Owner saves preserve
this metadata; it is never returned through the owner state payload or public tools.
Each grant also requires `rosterId`, `rosterIds`, `taskIds`, and `contextVersions`
(map of context ID to explicit version numbers). An empty array/map grants nothing.
Only non-archived tasks assigned to that roster ID are available. Archived agent
rosters deny tool execution. Text remains inert, untrusted content.

| Scope | Tool | Boundary |
|---|---|---|
| `pound:roster:read` | `pound_roster` | Selected roster IDs; names, roles, functions only |
| `pound:task:read` | `pound_tasks` | Selected assigned tasks and their message threads |
| `pound:context:read` | `pound_context` | Explicit document ID and exact approved version |
| `pound:message:append` | `pound_message` | Append to selected assigned task threads |
| `pound:task:update-own` | `pound_progress` | Mark assigned task working/done/blocked; agent-reported |

Reads return the workspace revision. Writes require that revision and an idempotency
key. Re-read after conflicts; uncertain responses retry the exact original request.
Receipts are actor-bound, bounded to the last 128, and stale revisions prevent older
retries from silently repeating. No roster edits, assignment changes, context writes,
deletion, credentials or cross-task discovery are available. New context proposals
can be posted as task messages; canonical context changes remain owner operations.
Status `authenticated_request` proves only that request authenticated; it does not
mean an agent is running, scheduled or currently online. Existing roster connection
labels remain owner-shell placeholders; no background heartbeat is fabricated.

### Research

Existing `/research/v1/tenants/{tenant}/mcp` accepts the new delegated format when
enabled. Its private envelope uses `access.delegated[agentID]`, audience
`research:{tenant}`. Allowed scopes are only `research:read`, `hypothesis:write`,
`evidence:write`, `discussion:write`. Unknown, execution and task scopes fail closed.
The state read covers the tenant's full research state, excluding raw inputs/grants
and other actors' lease secrets; approve that disclosure explicitly. Do not place
held-out findings or restricted raw rows in shared text. Hypothesis revisions are
restricted to that agent's original hypotheses. Separate agent subjects allow
independent challenges; model names alone are never proof of independence.
Existing bounded CAS, quotas and immutable audit/idempotency behavior remain.

## Consumer app setup research (checked 2026-10-16)

These are candidate connection paths, not tested or configured user accounts.

* **Claude web:** Customize > Connectors > Add custom connector. Current official
  documentation includes Request headers for fixed bearer credentials, with static
  authentication described as beta. Check availability in the actual account. For
  Team/Enterprise, everyone using a shared connector can exercise its credential;
  do not treat that as a distinct individual identity. OAuth is not implemented here.
  [Setup](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
  [Authentication](https://claude.com/docs/connectors/building/authentication)
* **Gemini:** CLI supports HTTP MCP with headers. Official custom MCP setup located
  for Gemini Enterprise Business; personal Gemini web compatibility has not been
  verified. Do not assume CLI or Enterprise is the user's intended app.
  [Enterprise setup](https://support.google.com/g/answer/17106276?hl=en)
  [CLI](https://geminicli.com/docs/tools/mcp-server/)
* **Grok:** Consumer app documents Custom connectors at grok.com/connectors; exact
  fixed-header authentication compatibility still needs a user-account check. The
  xAI API separately supports remote MCP authorization and explicit tool allowlists.
  [Consumer](https://docs.x.ai/grok/connectors)
  [API](https://docs.x.ai/developers/tools/remote-mcp)
* **Muse from Meta:** Official help documents user-created Custom Connectors using
  service API information and a secure credential store. Confirm the user's app and
  supported header/MCP request shape before setup. This documents Muse calling our
  service, not our service invoking a personal Muse agent.
  [Meta help](https://www.meta.com/help/artificial-intelligence/1687253048996149/)

## Exact activation approval still needed

Review and approve the PR/release, first client identity, owner/tenant, scopes,
specific roster/task IDs and context versions, seven-day pilot expiry (or another
explicit expiry), provider disclosure, private grant writes and secure credential
delivery. Verify private storage rules for the existing envelopes, enable the flag
through the full existing Worker manifest, then test read/write/replay/denial/revoke
with synthetic context using the actual client. Do not send a token through chat,
query strings, logs or a public repository. No schedule or provider API billing is
part of this release. Raw archive access, real-data execution and held-out evaluation
remain separate reviewed steps. Revert the release or disable the flag to stop access.
