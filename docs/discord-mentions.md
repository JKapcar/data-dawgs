# RoboKap mention intake

One SQLite Durable Object (`DiscordMentionGateway`, binding `DISCORD_GATEWAY`) owns the fixed `robokap-mentions-v1` identity. Other object identities cannot connect. There is no public message-ingestion endpoint. Existing signed interactions remain independent.

## Activation

Deploy the reviewed migration/code with `DISCORD_MENTIONS_ENABLED=false`. After coordinated approval and current account-capacity verification, set that flag true and use **Start mention listener** in the authenticated owner Pack manager. Status reports connected/ready separately; only `ready=true` and `reason=listening` indicate a completed Gateway handshake. The existing `DISCORD_BOT_TOKEN` is reused in memory. No token replacement, new credential, privileged Message Content intent, or permission expansion is needed.

The Gateway uses only `GUILD_MESSAGES` (512). Accept new explicit mentions of the bot identity verified in READY, from `DISCORD_GROK_USER_ID`, in `DISCORD_CHANNEL_ID` / `DISCORD_GUILD_ID`. Reject bots, webhooks, stale messages and messages older than manual activation. No history fetch or backfill. Other received events retain only the transport sequence needed to resume; other message content is neither logged nor stored. Configured scope changes require separate authorization.

Accepted messages reuse the exact Discord message ID as Pack job ID. Existing Pack CAS deduplication, owner linkage, stopped-seat checks, six-tool credential isolation, Grok attempt caps (3/hour, 10/day), reply receipts and approval expiry remain in force. A second delivery is never inferred from a missing acknowledgment. Replies use the existing Pack thread flow; no repeated launcher or automatic private-lineup selection.

## Recovery and limits

Persist resume URL/session/sequence only in private Durable Object storage; owner status excludes these and all credentials. Reconnect with backoff, at most 12 connection attempts/hour; respect Discord session-start availability and one-shard requirement. Missing heartbeat ACK and handshake timeout reconnect. A one-minute recovery alarm repairs interrupted connections; deployments can interrupt the socket.

Reserve wall-clock runtime in two-minute windows before network activity. Limit reservations to 350,000 GB-seconds per UTC month for the singleton, below the verified 400,000 included account allowance. Recovery windows count too. Stop automatically when the current Grok approval expires, owner link expires, seat is stopped, feature is disabled, or budget is exhausted. Owner stop and lease cutoff close the socket and abort I/O outside the serialized processing queue. RTDB reads/CAS writes and wake requests carry a per-operation abort signal; late work is fenced before admission/wake. Stopping intake does not cancel jobs already durably admitted.

This internal budget is not a Cloudflare billing cap. Other account usage, request/storage charges and service billing must still be monitored; no paid upgrade or overage is authorized. The current authorization expires at `2026-10-24T23:40:00.000Z`; this feature does not renew it.

## Acceptance

After `ready=true`, the parent coordinates one newly posted owner mention in the approved channel. Correlate message ID to one Pack job, accepted Grok webhook, actual claim/reply and Discord delivery receipt. Do not process the earlier pre-activation mention. Test unrelated-channel/user filtering, stale/replayed dispatch, reconnect/resume, hung I/O, expiry, budget and owner stop with synthetic fixtures. No real unrelated messages or private lineup data are used by tests.
