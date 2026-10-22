# Pack seats: Discord requests addressed to one bound assistant session

Disabled by default (`DISCORD_PACK_ENABLED`, `DISCORD_PACK_DELIVERY_ENABLED` are `"false"`,
`DISCORD_PACK_SEATS` is `{}`). The Worker never runs a model and never acts as a runner: a
bound assistant session reads, answers and delivers through the Data Dawgs connector it
already uses. Source: `work/discord-pack.js`. Owner page: `research-lab/discord-pack.html`.

## What it does

1. In `#skynet-robokap`: `/pack to:Claude question:<text>`.
2. Toto verifies Discord's signature, the linked requester and the seat, then queues a request
   addressed to that seat. The requester sees an ephemeral receipt: queued, nothing has run,
   when the seat last checked in.
3. The one session bound to that seat polls, claims and answers with `dd_pack_*` tools on the
   main connector, from its own context.
4. Toto posts the reply in a public thread named `Claude · <request id>`, labelled
   `[Claude seat · request … · binding N · key "pack-claude" server-verified · model unverified]`,
   and returns a receipt with the Discord message URL.
5. `/pack question:<text>` inside that thread continues with the same seat. The session sees the
   thread's earlier turns. Ordinary thread messages are **not** read (no Gateway, no Message
   Content intent).

A seat with no configured key, or with no session checking in, is refused with a plain
message and nothing is queued. A seat is described as tested only after its first reply
delivered with a Discord API receipt.

## What is verified and what is declared

| Fact | How it is established |
|---|---|
| Discord requester | Ed25519-signed interaction, plus a link the owner confirmed from a signed site session |
| Seat consumer | A dedicated owner key labelled `pack-…` that `DISCORD_PACK_SEATS[seat].key_label` names — server-verified credential, not proof of which model holds it |
| One consumer per seat | Lease from `dd_pack_bind`; binding again supersedes the old session and returns its unsent claims |
| Which session | `session_ref` — self-declared, shown as such |
| Which model | Not verified. Every reply says so |
| Question text | Untrusted data, never instructions; never copied into Discord by Toto |

## Seat keys: what they can and cannot do

A seat needs its own key minted on `connect.html` with a label starting `pack-` (for example
`pack-claude`). For the configured owner, `mcpAuth` returns such a key as a seat-only identity,
never as the owner:

| Surface | `pack-…` seat key |
|---|---|
| `dd_pack_*` for its own configured seat | yes |
| Every other connector tool (league data, Bozo submit, DFS, SwoleDawg, `dd_whoami`) | refused |
| Private owner apps (RoboKap Pound, BDB research) | refused |
| Research gateway (`personal_mcp_identity_required`) | refused |
| Another seat's requests or lease | refused |

The restriction comes from the label, not from `DISCORD_PACK_SEATS`: removing a seat leaves its
key with no tools rather than widening it, and deleting the key on `connect.html` ends it. The
shared `primary` key and existing full-access keys (such as `Gemini` or `Grok`) are rejected as
seat keys and keep their current behaviour.

## Seat tools

Served only to the seat key of a configured seat. `dd_pack_bind`,
`dd_pack_poll` (check-in + open work + deliveries needing attention), `dd_pack_read`,
`dd_pack_claim` (20 minutes, renewable), `dd_pack_answer` (`outcome: "failed"` posts a
could-not-complete notice), `dd_pack_release`. Replies: 1-1,800 characters, no links, no raw
mentions; all pings are suppressed.

## Delivery and uncertainty

1. The exact reply and an `uncertain` reservation are stored before any Discord call.
2. Pre-flight failures and Discord 4xx responses are certain non-sends: the reservation is
   cleared, the claim stays, and a later attempt is not a duplicate.
3. Timeouts, 5xx and unverifiable responses stay `uncertain`. Replaying `dd_pack_answer` with
   identical text resends **only** when one of these holds:
   - within 90 seconds of the reservation, with the same `nonce` and `enforce_nonce: true`
     (Discord returns the existing message instead of creating another);
   - Discord shows no thread for the request, or the request's own new thread is empty.
4. Anything else waits for the owner, who checks Discord and records "in Discord" or
   "not in Discord" on the Pack page (refused for two minutes after the reservation, while a send
   may still be in flight). "Not in Discord" returns the request for one fresh attempt with a new
   nonce.
5. A thread-creation attempt younger than 20 seconds is treated as possibly in flight.

This avoids duplicates in preference to guaranteeing delivery. It is not exactly-once.

## Configuration

- Vars (`wrangler.jsonc`): `DISCORD_PACK_ENABLED`, `DISCORD_PACK_DELIVERY_ENABLED`,
  `DISCORD_PACK_SEATS` such as `{"claude":{"key_label":"pack-claude"}}`. Labels must match
  `pack-[a-z0-9-]{1,19}`; one key serves one seat.
- Reused: `DISCORD_INBOUND_ENABLED`, `DISCORD_APPLICATION_ID`, `DISCORD_APPLICATION_PUBLIC_KEY`,
  `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID`, `RESEARCH_OWNER_UID`, secret `DISCORD_BOT_TOKEN`.
  No new secret.
- Store: RTDB `/discord_pack_v1`, written only by the Worker with `FB_SECRET`. Public and client
  rules must deny it.
- Discord: Interactions Endpoint URL `https://toto.jkapcar4.workers.dev/discord/interactions`;
  bot permissions in the one channel: View Channel, Create Public Threads, Send Messages in
  Threads. Not needed: Administrator, Manage Threads, Read Message History, Message Content.
- `/pack` is registered from the owner page (one guild command; administrators by default).

## Linking a Discord account

An unlinked requester gets an ephemeral one-time link (10 minutes) to the owner page. The
signed-in owner sees the Discord name and ID and confirms. Only hashes of codes are stored.
Requests made before linking are not queued. Every linked account can reach every bound seat,
and the seat answers from its own session's context, so link other members only if that session
should answer them; replies are always visible to the server.

## Acceptance test for any seat

A seat counts as connected only after all of these pass for that seat:

1. The assistant session binds with its own key and records a session reference.
2. `/pack to:<seat>` is queued; the receipt names the seat and its last check-in.
3. The session claims and answers from its own context; the reply appears in the request
   thread with the label above; the tool returns a receipt URL that opens that message.
4. `/pack` inside the thread is answered by the same seat in the same thread.
5. Rebinding from another session makes the first session's lease fail.

## Rollback

- Stop everything: set `DISCORD_PACK_ENABLED` to `"false"` and deploy, or roll traffic back
  to the previous Worker version in the deploy workflow.
- Stop sends only: `DISCORD_PACK_DELIVERY_ENABLED` to `"false"`.
- Stop one seat: "Stop" on the owner page. The lease ends, unsent claims return to the queue,
  and the seat refuses to bind until "Allow" is pressed; a session cannot undo it. Removing the
  seat from `DISCORD_PACK_SEATS` also works but needs a deploy.
- Stored requests and receipts are kept; nothing is deleted or migrated. Discord threads and
  the `/pack` command remain until removed in Discord.

## Limits and known gaps

- 400 retained requests, then admission fails closed; retention is a later owner decision.
- Archived threads (7 days idle) do not accept commands; any message unarchives the thread.
- A seat key identifies a credential, not a model. Whoever holds the `pack-claude` URL can bind
  the Claude seat; a takeover is visible (the old lease fails) and stoppable, not prevented.
  Each key must live only in its intended assistant's connector settings.
- Thread adoption after a lost response assumes the bot user ID equals the application ID.
- Polling cadence is the session's own; Toto cannot wake a session.

## Tests

`node --test tests/discord-pack.test.cjs tests/discord-pack-mcp.test.mjs` — fake Discord, fake
RTDB with ETag compare-and-swap, a controllable clock, real Ed25519 signatures, the real
site-session verifier and the real assembled connector. `cd work && node assemble.mjs` proves
assembly, parsing, idempotency and the MCP write-scope boundary.
