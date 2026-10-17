# Staged Discord /ask queue

Depends on outbound PR #298 (shared hashing and assembler), but the ingestion and queue flags are separately disabled by default. No installation, command registration, linked-user grants, credentials, runner, model API or production tests were configured. The destination is the existing Data Dawgs `#skynet-robokap`; never create or rename it here.

## What this implements

`POST /discord/interactions` verifies Ed25519 over the exact timestamp + raw body with the configured Discord application public key, rejects timestamps more than five minutes away, and checks application, immutable guild and channel IDs. Only signed PING and the guild slash command `/ask question:<text>` are supported. Ordinary messages, DMs, components and other commands do not enqueue work. Questions are limited to 2,000 characters; bodies to 16 KiB.

An unexpired configured Discord user link supplies exactly `principal: "discord-user:<immutable user ID>"`, a constrained `project_id`, and scope `discord:ask`. These are queue namespaces, NOT owner account identity or permission to read any private project. No owner credential or private RoboKap/BDB/personal vault is touched. Receiving arbitrary text is not permission to obey it; queued content is explicitly untrusted, and no model or tool executes it.

CAS stores interaction IDs permanently for deduplication and binds them to question, user, project and destination. Replays return a factual stored-state acknowledgement and never enqueue twice; changed content conflicts. The ephemeral acknowledgement includes the request ID and explicitly says no Discord answer was delivered by this queue. A persisted queue write is not proof that Discord displayed the acknowledgement. Discord requires fast acknowledgements: production RTDB latency must be verified under its three-second response deadline before enablement. Timeouts can leave a queued request even when Discord shows a failed interaction; never recreate it blindly.

Limits: 10 queued requests per user per UTC clock hour, 60 global/hour, 1,000 retained jobs. No eviction; capacity fails closed pending reviewed retention/tombstone migration. Window boundaries can permit bursts. Do not delete IDs to free capacity because doing so reopens replay. Question/result text is retained privately; an approved retention policy is required before enabling for real users. Never submit FAA client or other restricted content.

## Narrow queue bookkeeping API

`POST /discord/queue` uses a separate `Authorization: Bearer ddq_<random>` credential. Owner, shared Toto, outbound ddc_, or Discord bot tokens cannot authorize this API. Both `DISCORD_INBOUND_ENABLED` and `DISCORD_QUEUE_ACCESS_ENABLED` must be literal `true`.

JSON actions:

- `{"action":"list"}` returns up to 20 active queued jobs or this caller's claimed jobs in its configured project. Completed jobs do not crowd active work. It is a bounded work queue, not a history browser.
- `{"action":"claim","id":"<interaction ID>"}` atomically claims a queued job. Repeat by the same credential is idempotent; another credential cannot steal it. Claimed is bookkeeping, not proof of execution.
- `{"action":"answer","id":"<interaction ID>","text":"explicit answer"}` records an answer only for that claimant. `answered` means an answer was recorded, **not delivered to Discord**. Execution/provenance remain claimant-reported; `delivery` stays `not_sent`.
- `{"action":"error","id":"<interaction ID>","text":"reason"}` records a claimant-reported error. Exact repeated completion is idempotent; altered completion conflicts.

User linking and expiry are rechecked on reads/writes. Removing a link prevents processing of its retained jobs. No claim timeout, stealing or automatic requeue is implemented; abandoned claims require a separately reviewed recovery operation. Credentials may rotate while retaining a stable grant ID. Grant IDs must be unique and never recycled. No scheduler, API-powered runner or billing is enabled.

## Later authorized setup

First obtain action-time authorization for persistent registration/grants. Configure `DISCORD_APPLICATION_ID`, public `DISCORD_APPLICATION_PUBLIC_KEY`, and the same immutable `DISCORD_GUILD_ID`/`DISCORD_CHANNEL_ID` as outbound. Register only a guild-scoped CHAT_INPUT `/ask` with one required string option `question` (max_length 2000); configure its HTTP endpoint `/discord/interactions`. Discord application command installation uses the `applications.commands` scope; channel members need Use Application Commands. No Gateway or Message Content privileged intent is needed. Preserve outbound's channel-scoped View Channel + Send Messages permissions if outbound is separately enabled.

Configure private `DISCORD_USER_LINKS` JSON entries with `discord_user_id`, matching `principal`, `project_id`, `scope:"discord:ask"`, ISO `expires_at`. Configure secret `DISCORD_QUEUE_GRANTS` entries with unique stable `id`, `project_id`, `scope:"discord:queue"`, ISO `expires_at`, and hex SHA-256 of a dedicated token. Generate token with 32+ cryptographically random bytes in base64url prefixed `ddq_`, delivered only through secure secret entry. Never put secrets into URLs, repo, logs or chat. Neither mapping creates or inherits owner/project API access.

Confirm `discord_queue_v1` denies all public/client access in RTDB rules and approve retention before setting flags. This PR does not inspect or change production rules.

## Response/thread and runner dependency

Every job keeps `correlation_id` equal to interaction ID and `thread_id:null`. No Discord thread is created. Interaction continuation tokens are deliberately discarded; no delayed interaction webhook reply is supported. Manual authorized sessions may claim work and record results. Any later delivery must be a separately authorized outbound message with request ID correlation, or a separately reviewed thread/callback adapter. This is not a complete automatic Discord assistant. An autonomous runner, project resource access and model spending each need a separate approved design/configuration.

Validation uses real ephemeral Ed25519 keys and mocked CAS only; no Discord network calls. Run `node --test tests/discord-inbound.test.cjs tests/discord-bridge.test.cjs tests/bozo-mcp-auth-status.test.js`, then `cd work; node assemble.mjs`.

Reference: [Discord receiving/responding to interactions](https://docs.discord.com/developers/interactions/receiving-and-responding).
