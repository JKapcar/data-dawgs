# Toto Discord outbound connector (disabled)

This isolated connector is `/mcp/discord`, using an Authorization Bearer header with a dedicated posting credential. Its one tool is `dd_discord_post`. Existing Toto catalogs and owner/private connectors retain their behavior. Clients must support custom bearer headers; there is no URL credential or OAuth fallback. Connecting this scoped endpoint does not grant private RoboKap access.

Jason confirmed the existing Data Dawgs `skynet` channel and plans to rename it to `Skynet-RoboKap`. This change neither creates nor renames channels. Immutable guild/channel IDs are still required. No installation, credentials, grants, production posts, merge or deployment were performed.

## Explicit later setup

Obtain action-time authorization for installation and persistent access first. The smallest supported setup is a dedicated Discord bot installed in the confirmed server, with View Channel and Send Messages allowed only in that existing text channel. No Administrator, Manage Webhooks, Read Message History, privileged intents, incoming listener or model API is required. A server administrator must approve the install and channel permission overrides. Use the official Discord developer portal and Cloudflare secret entry UI; never paste secrets into chat, public files, URLs or logs.

Configure immutable `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID`, and secret `DISCORD_BOT_TOKEN`. The bot verifies the channel's guild and type before each send. Configure secret `DISCORD_BRIDGE_GRANTS` as a JSON array of entries with `id`, `label`, `scope: "discord:post"`, `expires_at` (ISO date), and `sha256` (hex SHA-256 of the dedicated bearer token). Generate each token from at least 32 cryptographically random bytes, base64url encoded and prefixed `ddc_`; securely enter it only in its intended client's bearer credential field. Never reuse owner/account credentials. Grant IDs must be unique stable identifiers and must not be recycled. Rotations retain their ID so replay protection survives rotation. Labels are operator declarations, never model identity verification. Removing an entry revokes subsequent requests; an already reserved/in-flight send may complete.

Review RTDB rules and ensure `discord_bridge_v1` has no client read/write grants; it uses existing Worker server-side FB_SECRET access. Then separately approve rollout and set `DISCORD_BRIDGE_ENABLED` to the literal string `true`. Missing flag is off. Disable the flag to stop subsequent requests. Existing in-flight sends may finish.

## Delivery policy

Explicit `message` only, 1–1600 characters. Optional `record_link` accepts HTTPS datadawgs216.com research-lab/private.html or research-lab/ and optional p_ record fragment, without queries or credentials. No private record lookup or mirroring occurs. Private links do not grant Discord recipients access. Do not include FAA client information or other restricted/private material in the explicit body. This API does not classify sensitive text; the sending session must obtain authorization for the exact content.

Messages show configured credential label plus “model unverified.” Mentions and embeds are suppressed. Other link-like content is rejected; destinations cannot be supplied by callers. Rate limits: 10 reservations per credential and 60 total per UTC clock hour, atomically persisted. These are fixed windows, so boundary bursts remain possible. Discord may enforce additional limits.

The separate additive RTDB envelope contains version, receipt map and current hourly counters. A CAS reservation precedes every Discord request. Receipts bind request ID, stable credential ID, body/link fingerprint and destination. Retries with the same key return the receipt; changed content conflicts. No receipts are evicted: a 10,000 receipt capacity stops sending pending an explicitly reviewed migration that preserves replay protection. Bodies and secrets are not stored in receipts.

A receipt is `delivered` only when Discord returns a matching channel and message ID; it includes a Discord URL. Timeout, malformed response, backend failure, rate-limit response, or uncertain persistence remains `uncertain`. This favors avoiding duplicates over delivery. Never create a new key to bypass uncertainty: inspect Discord manually and reconcile separately. There is no automatic retry, incoming message reader or reconciliation tool. A failed post-send receipt write may leave durable uncertainty even if the response already showed delivered. This is not exactly-once delivery.

## Validation

`node --test tests/discord-bridge.test.cjs` uses only fake Discord and in-memory CAS storage. `cd work; node assemble.mjs` assembles source and proves parse/idempotency/write boundaries. No new dependencies.

Discord references: [message API and allowed mentions](https://docs.discord.com/developers/resources/message), [permissions](https://docs.discord.com/developers/topics/permissions). No production test messages should be sent without a separate explicit approval.

## Separate inbound follow-on

The user subsequently approved a staged inbound design for existing `#skynet-robokap`. It is not implemented in this outbound PR. Prefer signed HTTP `/ask` interactions with Discord signature/timestamp verification, immutable guild/channel checks, linked constrained user grants, queue idempotency states queued/claimed/answered/error and thread correlation. Ordinary messages must not execute anything. A runner remains a separate choice: manually claim queued requests in an authorized Pack session, or later approve a scheduled/API runner and its spending/access. No runner, listener, extra grants or model spend is configured here.
