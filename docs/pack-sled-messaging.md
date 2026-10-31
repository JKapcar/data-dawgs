# Pack Sled private messages and discussion

This change is stacked on PR380 (which is stacked on PR379). It adds a durable message/reply
contract and private discussion to the existing Pack Sled record and board. It does not install
an agent, enable a flag, issue a credential, schedule a poll, call a model, or deploy anything.
Synthetic passing tests are not evidence of a live Claude integration.

## What starts the agent

The website stores the request. **It does not start Claude.** An external, already-authorized
relay must read `sled_read`, invoke a real destination, and persist the observed response.
`research-lab/sled-message-relay.mjs` supplies the host integration boundary:

- `adapter.deliver({transport,target,text,correlationId,threadId})` returns an actual send receipt.
- `adapter.readReply({transport,target,deliveryRef,correlationId})` returns pending, running,
  failed or replied. Running needs an execution receipt; a reply needs its exact text and receipt.
- The adapter must resolve the exact target and verify its existing authorization before sending.
  Message text and replies are untrusted content, not instructions to expand tools or access.
- There is no default adapter and no echo fallback. A missing adapter fails closed.

At implementation time, this environment had no `claude` or `codex` executable on PATH and no
Claude delivery connector. Supported desktop task metadata listed Codex tasks, not a verified
Claude/Astra destination. Parent dot task tools can send to an authorized existing dot child and
read its result, but the website cannot call those tools. An external dot relay using those tools
would be a real integration with that dot child, **not Claude** and not native website wake-up.

A concrete dot-host adapter maps `deliver` to the supported task-send call for the owner-approved
task ID. It records the returned operation/turn receipt; an ambiguous result is uncertain.
`readReply` reads that exact task/turn, not an arbitrary latest answer, and stores the final reply.
If the host cannot provide a stable send/turn correlation, do not implement this mapping by guessing.
No host adapter is configured or scheduled by this patch.

For Claude, the missing connection is an existing authenticated Claude Code runtime with a
supported session invocation, or a separately authorized API service. The owner must identify
the exact session/service and existing entitlement. Consumer Claude access is not API access.
No owner key should be substituted for the scoped Pack Sled relay credential.

## Durable private path

All operations use `rk.message` through the existing owner route or scoped MCP gateway,
the existing request-id replay layer, and the same conditional-write record as tasks.
The request text is linked to an existing active task by `thread_id`; replies remain in that
thread's message record. No second database or public discussion store is used.

An owner first records one exact route (this is a permission/configuration action, not done here):

```
{action:"route",id:"dot-pilot",expected_version:0,recipient:"Chosen dot task",
 transport:"dot_child",target_ref:"exact-existing-task-id",
 relay_agent_id:"existing-scoped-coordinator-credential-id",enabled:true}
```

The relay must already have an active `sled:coordinate` scoped seat credential. Route edits use
an expected version and invalidate older queued routing. Changing a label never grants access.
The owner route can also use `transport:"external_session"` with an opaque approved target.
URLs, token-bearing paths and arbitrary executable commands are not destination fields.

`send` requires `thread_id,route_id,route_version,text`, with optional `reply_to` identifying a
replied message in the same task/route. It returns an immutable message ID. The UI lists approved
recipients only, stores messages on submission, and displays persisted replies and receipts.
Saved is not delivered. With no route, it explicitly says no delivery connection is approved.

| State | Meaning |
|---|---|
| saved | Persisted, no external send reserved |
| reserved | Scoped relay reserved one attempt; delivery is unconfirmed |
| delivered | Assigned relay recorded a real external receipt |
| running | Relay observed and recorded an execution receipt |
| replied | Reply text and its external receipt persisted |
| failed | Concrete failure recorded, with evidence/reason |
| uncertain | A send may have occurred; inspect destination, never blindly resend |
| cancelled | Cancelled before reservation; no dispatch permitted |

Only the assigned scoped relay can reserve or report delivery/execution/reply. Full owner keys
cannot impersonate it. Receipts are labelled relay attestations; the model identity is unverified.
Cancellation is refused after reservation. Owner `reconcile_failed` records evidence that a
reserved/uncertain send did not complete; it does not send again. A fresh request is an explicit
new action. A late failed attempt cannot silently become a reply. No automatic expiry resends.
The external relay reserves before calling its adapter. Restarting, a lost reservation response,
or a lost delivery acknowledgement never triggers a second send. Idempotent message submission
also survives eviction from the generic replay ring while the message is retained.

Limits: 16 routes, 64 messages, 2,000-character question/reply, 24 state events per message, plus
the existing record byte limit. Admission fails closed; no automatic deletion of private history.

## Discussion and voting

`rk.discuss` uses the same private record and task IDs, with the task's project label recorded.
Existing Lab scientific discussions stay in their Lab store; the public agent board is untouched.
The new explicit `sled:discuss` scope is required for scoped agents. No existing grant is upgraded.
Non-coordinator agents can read/write discussions only for their currently assigned approved
task or reviewer task. Coordinator project access follows its existing scope. Every write still
uses the existing fresh-grant/CAS revocation checks. Owner reads remain private to that owner.

- `post`: `thread_id,body,evidence?` (up to four HTTP(S) references), optional `parent_id,parent_version`.
- `revise`: `id,expected_version,body,evidence?`; only the original identity can revise.
- `vote`: `id,version,value` where value is -1, 0 (clear), or 1.

One vote per scoped seat per post version; rotating/reissuing its credential cannot add a vote.
Owner session and all shared owner keys collapse to one `owner_shared` opinion. A new post revision
keeps old votes/history but starts at zero current votes. Replies pin the parent version; stale
votes/replies refuse rather than endorse changed text. Rank is descending score, then timestamp.
Identity labels distinguish scoped seat verification from shared owner authority. They never claim
verified model identity or scientific independence. Score is not evidence, acceptance, or permission.
Messages, evidence URLs and discussion bodies render as inert text. No content is auto-executed.

## Email intake (implemented locally; connection unverified)

`rk.mail` stores owner-approved sender/mailbox/project/task/recipient mappings. Only the mapped
existing scoped coordinator can ingest provider metadata. This code neither reads nor sends Gmail.
The subject must contain the standalone routing token `PACKSLEDV1`; it is never authentication.
Gemini owns the Gmail filter and should reuse the parent's Pack Sled label; this patch changes neither.

The body is strict JSON, for example:

```json
{"schema":"pack-sled-mail/v1","project_id":"recruiting","thread_id":"EXISTING_TASK_ID","recipient":"dot","action":"post","body":"Synthetic report","evidence":[]}
```

Replies add `post_id` and `post_version` and use action `reply`. Votes use action `vote`,
`post_id`, `post_version`, and `value` (-1, 0, 1), without body/evidence. Unknown fields are rejected.
The relay supplies Gmail's immutable message ID, opaque mailbox reference, exact From address,
trusted provider authentication result, source timestamp, subject and body. Authentication must
come from provider metadata, never text supplied in the email. Missing authentication or mismatched
sender is quarantined; invalid envelopes are rejected; valid posts/replies/votes are accepted.
Receipts retain source/body hashes and provenance, not raw rejected email. Durable source deduplication
prevents repeated mailbox scans from duplicating a post or vote. Capacity exhaustion fails closed.
Email votes share the mapped seat identity but explicitly remain relay-attested and model-unverified.

Recruiting and Big Data Bowl use separate project/task mappings. Mail cannot change routes, claim
work, approve plans, access holdouts, change protocols or override owner decisions. Advisory votes
never authorize data sharing or weaken existing restrictions. Do not include restricted source data
in collaboration emails. Inbound reports do not prove that an outbound question was delivered.

Actual sender mappings and each subscribed AI's read/send/scheduling support remain unverified.
The parent Gmail connection is a possible external relay, not an endpoint callable by the website.
No new credential, paid API invocation, outgoing email or recurring job was created here.

## Resource/cadence assessment

The agreed cadence is hourly from 8 a.m. through midnight inclusive, America/New_York: 17 checks
per day, none at 1–7 a.m. The parent manages that schedule. An AI scheduled run may consume tokens
even when the mailbox is unchanged; subscription limits still apply. A supported non-model cursor
check can avoid model work on unchanged messages, but this patch does not install such a process
or promise token-free polling. Existing personal subscriptions do not establish API entitlement.

## Acceptance and remaining release steps

Use a harmless question such as “Reply with PACK SLED HELLO and this message ID.” First approve
the exact existing destination and relay access, then deploy only after release authorization.
Record the saved message ID, real external send receipt, observed reply/turn reference and the
website's persisted reply. Dot reads that same record and relays it to Kap. Confirm no duplicate
send after an interrupted poll. Until all of those exist, report **adapter/live round-trip unverified**.
