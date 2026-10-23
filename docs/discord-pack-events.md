# Native Dot events: disabled implementation candidate

This adapter targets the actual subscribed ChatGPT Work chat or dot. It does not call a model API or impersonate a model. Live installation, account eligibility, secure bearer entry, MCP 2.0 interoperability and actual Dot execution remain unverified.

## What the code implements

The same authenticated `/mcp` endpoint serves `server/discover` (MCP 2.0 `2026-07-28`), `events/list`, `events/subscribe`, and `events/unsubscribe` to the configured owner's **header-authenticated pack-dot seat only**. Existing MCP initialization and the six seat tools remain available. Full owner, shared, other-seat, and URL credentials cannot use events. No seventh tool or private-data access is added.

The `pack.request.created` subscription requires exact owner UID, dot seat, guild, parent channel and verified linked Discord user filters. A signed `/pack` request persists its job and event record atomically before dispatch. An active subscription permits admission without an already-live polling lease. The event contains only `data.job_id`; the authenticated seat must bind, read, claim and answer. The reply requires an opaque `run_ref`, explicitly stored as claimant-reported rather than proof of a model identity.

Callbacks are challenge-verified and HMAC-signed using Standard Webhooks. IDs are deterministic; subscription refresh uses a fresh generation, bounded verification caching and a five-minute dual-signature rotation window. Callback URL and signing secrets are AES-GCM encrypted with subscription-ID authenticated data. Subscriptions expire (one hour default, at most one day), stop on unsubscribe, and are rechecked against current key hash, owner linkage, seat stop, guild/channel and configuration before delivery.

One callback per seat is allowed. Event records survive restarts. Admission attempts immediate delivery; the existing five-minute scheduled tick recovers pending work in its own failure domain, ten records per pass. Only explicit 429 responses retry automatically, up to three attempts with backoff and stable event ID. 410/413/redirects are terminal. Timeouts, lost replies and 5xx responses are uncertain and are not blindly retried. A persisted in-flight reservation is never resent after a crash. Capacity remains bounded by the existing 400-job store limit. There is no historical event replay (`cursor:null`).

An acknowledged webhook is not proof of a run. Owner status and seat reads distinguish pending, accepted, uncertain, claim, no-reply timeout and Discord delivery. Claims and run references remain self-reported. A delivery receipt proves only the Discord API result.

## Required safe callback transport — not supplied or deployed

`PACK_EVENT_EGRESS` must be a trusted service binding with a Fetch-compatible interface. It receives the callback Request, including signature headers, and returns the actual upstream Response. It must:

- Permit only deployment-approved exact HTTPS origins; never credentials in URLs, non-443 ports or redirects.
- Resolve DNS at **each connection**, reject every private/local/reserved/non-public address (IPv4 and IPv6, including mapped forms), connect to the validated address, and preserve original-host TLS/SNI and certificate verification. A DNS preflight followed by an independent normal fetch is insufficient.
- Bound connection and response time, request size and response size; never log callback paths, signatures, bodies or credentials.
- Propagate actual status and challenge response; never synthesize a successful acknowledgement.
- Be callable only by the authorized Worker, not a public arbitrary-URL proxy.

No such deployed binding is verified. Ordinary Worker `fetch` is deliberately not a fallback. The adapter refuses subscriptions and dispatch without this binding. Selecting, implementing and reviewing a supported deployment for this transport is a remaining technical gate, not a user dashboard task. DNS-rebinding, mixed public/private answers, TLS mismatch and redirect tests must pass against that implementation before activation.

## Configuration and installation gates

Defaults: `DISCORD_PACK_EVENTS_ENABLED=false`, `PACK_EVENT_CALLBACK_ORIGINS=[]`. No service binding or secret is added to the manifest. Activation also needs Pack and dot-seat configuration, a signed owner link, the existing delivery flag and existing Discord permissions.

After scoped approval, configure a new 32-byte base64 `PACK_EVENT_ENCRYPTION_KEY` through the supported secret mechanism, the vetted egress binding, and only the real callback origin obtained from supported ChatGPT setup. Never guess callback hosts or paste secrets into chat, logs, files or URLs. Changing encryption keys requires an explicit migration/re-subscription plan; old ciphertext cannot be read with a new key.

`plugins/data-dawgs-pack/` is a portable package candidate with a bearer API-key declaration and no credential. The package does not install itself or enable events. Official documentation supports that declaration but states the public submission portal connection form does **not** support API-key declarations. Verify that the intended cloud Dot's supported private installation flow accepts the dedicated seat credential securely. If not, stop; adding OAuth is a separate implementation and access decision. Do not substitute the owner's primary key.

Minimum owner-side setup, after the technical gates are complete: authorize the supported private plugin connection; attach its dedicated pack-dot credential through secure input; confirm the signed Discord identity link; and ask the actual target Dot to subscribe with the exact filters and permission to reply only in the approved Pack channel/thread. ChatGPT supplies the callback and signing secret through `events/subscribe`. These are persistent access and subscription changes and are not created by this PR. No new model API spending is introduced.

## Live acceptance after separate release/activation approval

1. Inspect production and deploy only this reviewed delta, preserving concurrent releases. Verify the exact version and default-off state.
2. Confirm the actual Dot connection discovers exactly six tools and one event. Full owner/other seat connections must not see the event.
3. Link the immutable Discord user through the signed flow. Subscribe in the actual Dot; verify challenge, encrypted persistence and matching filter receipts without printing secrets.
4. Send the already approved labeled test in the permitted channel. Observe signed Discord admission, persisted job, callback acknowledgement, actual Dot run in that subscribed conversation, authenticated claim/run reference, and Discord `pong.` receipt. A 2xx alone is not success.
5. Repeat the approved follow-up `follow-up pong.` in the resulting thread; verify continuity and suppressed mentions. Reject other users/channels/seats.
6. Test duplicate callbacks, temporary failures, expiry/refresh, revocation, unsubscribe, batching and reconnects. Verify no duplicate reply and no private tool access. Confirm no-reply timeout is visible. Do not retry an uncertain callback merely to obtain a green test.

## Official references

- [MCP Events contract and callback security](https://developers.openai.com/plugins/build/mcp-events)
- [Portable package and API-key declaration](https://developers.openai.com/plugins/build/plugins)
- [Connect and test, subject to account/workspace policy](https://developers.openai.com/plugins/deploy/connect-chatgpt)
