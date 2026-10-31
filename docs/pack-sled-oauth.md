# Pack Sled OAuth connection: release and acceptance contract

Status: draft implementation, default off. No production client, grant, flag, connector or
sender mapping is created by this change. Synthetic tests are not a live ChatGPT connection.

## Profile and boundaries

This implements a deliberately restricted OAuth authorization-code profile for one existing
private HTTP MCP resource. It follows the current [OpenAI authentication requirements](https://developers.openai.com/plugins/build/auth),
[PKCE S256](https://www.rfc-editor.org/rfc/rfc7636),
[resource indicators](https://www.rfc-editor.org/rfc/rfc8707), and
[OAuth security guidance](https://www.rfc-editor.org/rfc/rfc9700).
It is not a claim of certification, comprehensive OAuth conformance, or verified compatibility
with every ChatGPT account or scheduled-task host.

An established authorization provider is normally preferable. This bounded implementation uses
Worker-native WebCrypto for random opaque credentials, SHA-256 and HMAC-SHA-256, and the repository's existing
conditional private store and owner sign-in. There is no custom JWT cryptography, remote client
metadata fetching, dynamic registration, password grant, implicit flow, machine-to-machine flow,
or new owner-level authority. No new service/account/library or paid API is required.

Only a pre-registered public client (`token_endpoint_auth_method=none`) can connect. The owner's
existing active `dot` grant must have exactly `sled:work:read` and `sled:mail:ingest`, audience
`sled:<owner>`. OAuth neither creates that grant nor widens it. The existing route mapping and
current-task project checks apply to every read/import. Other projects, planning, dispatch,
messages, direct discussion writes, owner decisions, permissions and BDB holdout access remain
unavailable. A grant revoke, expiry, secret rotation or scope change invalidates OAuth access.
Legacy `da1` clients are unchanged; OAuth credentials are accepted only in a Bearer header on
the canonical resource, never in a URL.

## Protocol and storage

* Issuer: `https://toto.jkapcar4.workers.dev/sled/oauth`.
* Resource: `https://toto.jkapcar4.workers.dev/agents/v1/owners/<owner>/sled/mcp`.
* Discovery: `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-authorization-server/sled/oauth`. HTTP 401 challenges identify resource
  metadata; protected tools expose OAuth scopes. No registration endpoint is advertised.
* Authorization requires exact operator-configured HTTPS callback, matching resource, both mail
  scopes, opaque client state (16–512 non-whitespace characters), and S256 challenge. Duplicate
  or unexpected parameters are refused. No redirect occurs for an invalid callback/client.
* Consent uses `research-lab/sled-connect.html`, the existing owner session in an Authorization
  header, exact first-party Origin, a ten-minute transaction, random CSRF nonce and same-session
  hash. Inspecting is not consent. Approval explicitly selects an existing mail-only grant.
  Cancellation consumes the transaction and returns `access_denied`, original state and issuer.
* Authorization codes are random, hashed at rest, expire in 60 seconds, and are redeemed once
  with the original client, callback, resource and verifier. Atomic CAS resolves races. Correctly
  authenticated code replay revokes the resulting token family. Incorrect verifier does not
  consume a code. Responses carry `iss` to support issuer identification.
* Access tokens expire in five minutes or earlier grant/family expiry. Refresh tokens rotate on
  every successful exchange. Reuse revokes the entire family, including its latest access and
  refresh tokens. There is no replay grace: an uncertain refresh response requires reconnecting.
  Concurrent refreshes must be serialized by the client. Refresh cannot change scopes/resource,
  renew the underlying grant, or extend seven days from initial consent.
  A refresh credential carries a random family ID, generation and HMAC; the client treats it
  as opaque. The HMAC uses existing `BOZO_PEPPER` with the distinct
  `pack-sled-oauth-refresh-v1` purpose, bound to owner, client and canonical resource. No new
  secret or live binding is added. Only the current generation is stored per family. A valid
  older generation revokes the family; an invalid signature is rejected before database access.
  Conditional writes serialize generation advancement. This preserves detection of the oldest
  issued token without retaining thousands of hashes or imposing a lifetime renewal quota.
  Rotating `BOZO_PEPPER` invalidates refresh credentials; existing access tokens still expire
  within five minutes (or can be stopped immediately by revoking the underlying grant).
* Revocation accepts an access or refresh token plus its client ID and revokes that family;
  unknown tokens return success without writes. Grant revocation remains the owner's immediate
  stop switch. Client removal or disabling any required flag fails closed too.
* Store: `sledOAuth` sibling in the existing `/privatePounds/<owner>` envelope. Hashes only for
  authorization codes, access tokens, CSRF nonce and owner session. Refresh tokens are not stored;
  their authenticated generation is checked against the family counter. Existing
  envelope fields are preserved. The store contains client state, callback, PKCE challenge and
  bound grant metadata; treat it and its existing private backups as private authentication data.
* Bounds: 16 consent transactions, 32 code tombstones, 32 unexpired access tokens and 16 families.
  Expired entries are pruned on mutation; family counters remain until expiry. There is no
  256-renewal cap. A simulation covers 2,016 generations over seven days at five-minute cadence,
  then detects replay of generation one; its entire OAuth state remains under 4 KiB.
  Capacity fails closed and requires expiry/reconnect, not history deletion. Request bodies
  are bounded to 8 KiB and ten seconds.
* Public token/revoke fields, configured client, exact target/callback and refresh signatures
  are validated before private reads. Malformed requests and unknown/unverifiable refresh
  revocations cause zero private reads/writes. Well-formed unknown opaque codes/access tokens
  still require a lookup. Existing Worker `authLookup` uses route-specific `RL` KV quotas;
  it does not cover these separately dispatched OAuth routes. No global OAuth IP quota or
  live edge/WAF protection has been verified or changed by this PR. The prevalidation and
  body limits reduce needless reads but are not a claim of comprehensive flood protection.

No access/refresh credential appears in a URL, HTML, application log or stored plaintext.
OAuth authorization-code flow **does** return its single-use, PKCE-bound code in the exact
ChatGPT callback query, as the protocol requires. It may be visible to the callback provider's
request logging/browser history; it is not a reusable bearer credential. State/challenge appear
in the authorization request. Responses use no-store/no-referrer. Consent clears its fragment
immediately, renders labels as text, does not load analytics/bots, and clears pending state on
session change, hiding or navigation. Platform-level log retention must be checked before live
enablement; this code cannot guarantee a hosting provider never records protocol requests.

## Separate approval and exact connection steps

1. Review the draft and exact-head CI. Separately approve merging and releasing Pages plus the
   assembled Worker. The current implementation does not alter the production manifest or flags.
2. Separately approve the limited live setup: `SLED_OAUTH_ENABLED=true` plus existing
   `SLED_AGENTS_ENABLED`, `DELEGATED_AGENTS_ENABLED`, `ROBOKAP_ENABLED`, `DAWG_POUND_ENABLED`.
   Configure `SLED_OAUTH_CLIENTS` as a JSON array with a nonsecret client ID, display name and
   exact `redirect_uris`. No client secret is used. Example placeholders only:
   `[{"client_id":"<approved-public-client-id>","name":"ChatGPT Pack Sled mail","redirect_uris":["<exact-ChatGPT-callback>"]}]`.
   For ChatGPT, use the documented stable
   `https://chatgpt.com/connector_platform_oauth_redirect` or the exact account-specific
   `https://chatgpt.com/connector/oauth/<callback_id>`. Copy the actual management-page callback;
   never authorize a wildcard or guessed callback. Predefined public-client configuration must
   actually be available in the account's advanced OAuth form; otherwise stop and report the
   mismatch, not substitute an owner key or a secret URL.
3. With separate owner approval, reuse/create one active `dot` mail-only grant through existing
   owner setup, bounded to approved expiry. Configure only approved project/thread/sender routes
   for that grant. Existing server preset `mail` has the exact two scopes. No broad coordinator
   grant is an acceptable substitute. OAuth setup itself does not issue a `da1` credential.
4. In ChatGPT Plugins → Add → Add custom MCP server: use the canonical resource URL, OAuth,
   and the approved predefined public client ID. The actual form was observed read-only;
   submitting/installing it is a separate approval. Follow the owner consent page, review the
   scopes, select the existing mail-only grant, and allow. If signed out, sign in to DataDawgs
   and restart from ChatGPT. A hidden/interrupted consent page requires restarting.
5. Verify interactive initialize/list/read against the real connection and confirm only assigned
   routes are visible. Verify a harmless synthetic mail post and persisted receipt under an
   explicitly approved test route. Revocation/reconnect and refresh must work in the real client.
6. **Separate scheduled acceptance:** confirm the already approved dot automation can actually
   select/call this custom plugin and refresh it in its cloud execution host. Do not infer this
   from interactive success or local Miniflare. No schedule is created/changed by this PR.
7. **Separate source acceptance:** use real authorized collaboration mail to verify available
   provider message ID, internal timestamp, expected sender and aligned authentication verdict.
   Current Gmail schema/empty inbox has not proven those fields. Missing authentication remains
   quarantined; never manufacture `aligned_provider_pass`. Then prove one source email produces
   one persisted post/reply/vote and receipt, and replay does not duplicate it.

No paid API route, external agent wake-up, outbound Claude invocation, or verified model identity
is implied. Email reports still require each sender's independently verified read/send support.

## Verification commands

`node --test research-lab/sled-oauth.test.mjs research-lab/sled-agent.test.mjs`

With the repository's test dependencies in `DD_NODE_MODULES`:

* `node --test research-lab/sled-oauth-worker.test.mjs` runs the assembled Worker with a synthetic
  signed owner and an in-memory ETag database; unexpected outbound paths fail.
* `node research-lab/sled-oauth-browser.test.mjs` intercepts all browser requests; covers signed-out,
  explicit consent, cancel, missing grant, inert labels, narrow screens, session changes and
  interrupted navigation. No live connection is made.

The existing Pack Sled/agent regression suites and service-worker/data checks remain required.

## Future provider registration (not enabled)

Callback validation and consent return are provider-neutral: every client has its own exact,
operator-approved HTTPS callback list; there are no wildcard/default Google registrations.
The consent browser returns only to the exact callback validated during inspection.
[Google documents private custom MCP testing](https://developers.google.com/connected-apps/mcp/dev-mode/usage)
and [pre-registered OAuth clients or DCR](https://developers.google.com/connected-apps/mcp/oauth).
This draft supports public-client `none` only. Google's documented client-secret requirement
and nested discovery behavior need a separately reviewed extension/compatibility test if its
actual private-client form cannot use that profile. No Google client, secret, grant or app is
created here; do not claim Gemini compatibility from generic protocol support. Gemini write
confirmation and scheduled-task support remain separate limitations; unattended posting/voting
has not been verified. Primary acceptance remains ChatGPT cloud.
