# Staged Discord /ask and manual-session answers

Depends on outbound PR #298. Inbound, queue access and answer delivery are independently disabled by default. This implements a manual connected-session flow: signed `/ask` -> queue -> authorized session reads/claims -> explicit answer -> a request-correlated public thread in the originating channel. There is no autonomous runner, model API, ordinary-message listener or model spend. No installation, grants, secrets, production tests, merge or deployment were performed.

## Request admission

`POST /discord/interactions` verifies Ed25519 over timestamp + exact raw body, rejects timestamps more than five minutes away, and checks application, immutable guild and channel IDs. Only signed PING, the guild CHAT_INPUT `/ask question:<text>` and the separately gated `/pack` (addressed Pack seats, see [discord-pack.md](discord-pack.md)) are supported. DMs, ordinary messages, components and other commands cannot enqueue work. Maximum question: 2,000 characters; body: 16 KiB.

An unexpired configured link maps the immutable Discord user to exactly `principal: "discord-user:<ID>"`, a constrained `project_id` and `scope:"discord:ask"`. The project is a queue namespace, not a private RoboKap resource grant. No owner credentials or private RoboKap/BDB/personal-vault data are read. Questions are explicitly untrusted data, not instructions or authority to access anything. No question is automatically copied into a public reply.

Interaction ID is a permanent CAS deduplication key bound to question, user, project and destination. Replays return the stored state; altered payloads conflict. The initial ephemeral response gives the request ID and says it is queued, not executed. Interaction continuation tokens are discarded. Discord's three-second acknowledgement deadline still requires runtime latency validation before rollout. A backend commit can succeed even when Discord does not display its acknowledgement.

Admission is limited to 10/user and 60 global per UTC clock hour. 1,000 retained jobs maximum, failing closed without eviction. Retention/tombstone policy must be approved before real-user enablement: deleting IDs reopens replay. Question and answer text are stored privately. Never submit FAA client information or other restricted material.

## Connected manual-session tools

Use `/mcp/discord-queue` with a dedicated `Authorization: Bearer ddq_<random>` credential. Custom bearer-header support is required. Tools:

- `dd_discord_requests`: list up to 20 active scoped jobs; `after` accepts `next_cursor` for the next page.
- `dd_discord_request`: read one scoped job, including delivery receipt.
- `dd_discord_claim`: atomically claim a queued request. Another credential cannot steal it; repeated claim by the same credential is idempotent.
- `dd_discord_answer`: send the explicitly authorized answer (1–1,600 characters) for this session's claim. Requires both the separate delivery flag and `can_deliver:true` on its queue grant.
- `dd_discord_error`: record a claimant-reported error before delivery was reserved. This cannot reset an uncertain delivery.

Equivalent `POST /discord/queue` JSON actions remain `list`, `read`, `claim`, `answer`, `error`; arguments use `id` and, for answer/error, `text`. Listing optionally accepts `after`. Owner tokens, generic Toto tokens, outbound ddc_ credentials and Discord bot tokens cannot authorize these interfaces. Current user links, expiry, project and originating configured guild/channel are checked on each operation. Revocation stops new operations; an already reserved network request can finish.

Claiming is bookkeeping, not evidence of execution. A permitted human-directed session acts as the runner and decides how to answer within its separately granted resources. The Worker does not inherit owner identity or invoke a model. `result_provenance` remains claimant-reported even after delivery.

## Thread-aware delivery and receipts

The outbound adapter in `work/discord-bridge.js` verifies the original configured channel's guild/type, creates a public thread named `ask-<interaction ID>` under that same channel, validates its parent/guild/type, and sends one explicit answer into it. Thread names and message prefix carry the request ID. The message shows the configured credential label with “model unverified.” Mentions and embeds are disabled, and answer URLs are currently rejected. There is no arbitrary channel/webhook argument.

The thread is created at answer time, keeping thread network calls out of the initial interaction acknowledgement. This is a new request-correlated thread in `#skynet-robokap`, not an edit to the original ephemeral acknowledgement. The original interaction is not updated and the requester is not pinged; locate the `ask-<ID>` thread or use the returned receipt URL. Thread creation and delivery require their additional explicitly approved permissions below.

Before any Discord call, CAS persists the exact answer and an `uncertain` reservation. Concurrent calls, retries, crashes and changed answers cannot create another thread or post. A timeout during thread creation remains uncertain and must not be retried blindly, even if the thread ID was never returned. A confirmed thread ID is retained if sending the message later fails. `answered` plus `delivery:delivered` requires a successful Discord response with matching thread/message IDs; the receipt includes an actual Discord URL. Otherwise the job remains claimed with uncertain delivery. A final store failure leaves durable uncertainty even if Discord accepted the answer. Manual reconciliation is required; no automatic retry/reset is exposed. This favors avoiding duplicates over guaranteed delivery and is not exactly-once delivery.

Answer reservations have their own atomic budget of 10/credential and 60 global per UTC clock hour. These are separate from inbound admission and general outbound-post limits; fixed windows allow boundary bursts. Abandoned claims have no automatic stealing/requeue. Existing pre-delivery prototype `answered/not_sent` rows are not silently published by the new code.

## Authorized rollout order

1. Review/merge outbound #298 first, then this stacked PR; separately approve deployment. Neither PR authorizes deployment or configuration.
2. Obtain action-time authorization for persistent Discord application setup, command registration and grants. Keep the existing Data Dawgs `#skynet-robokap`; configure its immutable guild/channel IDs. Do not rename/create the parent channel.
3. Configure `DISCORD_APPLICATION_ID`, public `DISCORD_APPLICATION_PUBLIC_KEY`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID`; register guild-only `/ask` with required string `question`, maximum length 2000, and HTTP endpoint `/discord/interactions`. Installation uses `applications.commands`; members need Use Application Commands. No Gateway or privileged Message Content intent is needed.
4. For public-thread replies, approve bot permissions **View Channel, Create Public Threads, Send Messages in Threads**, confined to the one channel. Retain **Send Messages** only if general outbound posting is also enabled. No Administrator, Manage Threads or Manage Webhooks is needed. Configure `DISCORD_BOT_TOKEN` through secure Cloudflare secret entry.
5. Privately configure `DISCORD_USER_LINKS`: `discord_user_id`, matching `principal`, `project_id`, `scope:"discord:ask"`, ISO `expires_at`. Configure secret `DISCORD_QUEUE_GRANTS`: unique stable `id`, `label`, `project_id`, `scope:"discord:queue"`, ISO `expires_at`, hex `sha256`, and explicit `can_deliver:true` only for approved posting sessions. Mint tokens from 32+ random bytes, base64url with `ddq_` prefix; enter only through the intended client's secure bearer field. Do not put secrets in chat, logs, URLs or repo. Stable IDs must not be recycled; rotation preserves IDs for claims/deduplication.
6. Verify `discord_queue_v1` and outbound receipts deny all public/client RTDB access, approve retention, and validate acknowledgement latency. Then separately approve flags `DISCORD_INBOUND_ENABLED`, `DISCORD_QUEUE_ACCESS_ENABLED`, `DISCORD_QUEUE_DELIVERY_ENABLED` set to literal `true`. Missing flags are off. Delivery does not require opening the general outbound-post connector.

No autonomous runner or model spending is required for a manual session. Scheduling or API-powered execution remains a separate explicitly approved integration.

## Validation

`node --test tests/discord-inbound.test.cjs tests/discord-bridge.test.cjs tests/bozo-mcp-auth-status.test.js` uses real ephemeral Ed25519 keys and mocked CAS/Discord only. CI runs these suites. `cd work; node assemble.mjs` verifies generated-source parity, syntax and idempotency. No dependencies added.

References: [Discord interactions](https://docs.discord.com/developers/interactions/receiving-and-responding), [thread creation](https://docs.discord.com/developers/resources/channel#start-thread-without-message).

The stored `discord_queue_v1` requests are **not RoboKap dashboard tasks** and are not visible in its private task UI. They are a separate constrained manual queue exposed by the five MCP tools above. Linking an existing authorized private task or adding a dashboard projection is a remaining integration; no private task/owner write grant has been created or inherited here.
