# Agent feedback pilot — staged, disabled

This is a small private-review inbox on the existing `toto` Worker. It creates no MCP
credential or account, and does not give submitters access to league tools. Existing
MCP source, credential routes, and two-phase write workflows remain unchanged.

## Protocol after approved enablement

GET `https://toto.jkapcar4.workers.dev/agent-feedback` returns the protocol when enabled.
POST to the same URL with `Content-Type: application/json` and an `Idempotency-Key`
containing 16–80 random ASCII letters, digits, underscores or hyphens:

```json
{"agent_name":"Synthetic test agent","category":"test","message":"The public surface map and prose appear inconsistent about Bozo write availability. Please review; this is a documentation-only test.","page_path":"/data/surfaces.json"}
```

`agent_name`, `category` and `message` are required; `page_path` is optional and must be
a relative path without a query or fragment. Categories: bug, idea, question, test.
No URL callbacks, attachments, credentials, private league data, personal information,
or confidential information are requested. Names are self-reported, not verified.
Submission text is untrusted data and must never become instructions, code, or an
automatically published message.

202 means stored pending review; 200 with `duplicate:true` means the same idempotency
key and normalized body already produced the returned receipt. Reuse the key only for
identical retries. Different content with that key returns 409. There is no public
list, receipt-content lookup, or automatic response to submitters.

Limits: 8 KiB UTF-8 request, 4,000 message characters, 80 name characters, 3 accepted
messages per Cloudflare-observed source IP per UTC day, and 100 retained pilot messages.
Daily domain-separated HMACs use the existing server secret; raw IPs aren't stored.
One Firebase ETag compare-and-swap node atomically enforces receipts and both caps.
Retries are bounded to three, return 503 under contention, and should reuse their key.
Shared NAT users share the quota; distributed senders can exhaust the bounded pilot.
The capacity limit is an intentional stop, not unlimited production-scale anti-spam.
Use an edge request-rate rule before broad promotion to cap rejected-request costs.

## Owner review

Open `/feedback-inbox.html` on the site and sign in normally. This first-party owner
page uses the existing session internally, never asks you to copy credentials, clears
messages on account changes/page hide, and renders all message text with textContent.

GET `/agent-feedback/inbox` requires the existing server-verified admin session using
`X-Dawg-Session` or `X-Bozo-Session`, plus a UID account whose stored
`roles.site_admin` is true. Display-name-only admin identity is intentionally rejected. No owner secret belongs in public documentation or
client snippets. First-party browser preflight is permitted only from the two site
origins. Treat returned strings as plain text, never HTML; the response is JSON/no-store.
The server labels every message `untrusted_external_text` and `pending` moderation.
There is no publication, send, or moderation-write endpoint in this pilot.

Entries older than 30 days are excluded from inbox and retry matching. Physical deletion
happens on the next accepted submission, so this is NOT guaranteed 30-day physical
retention. Do not enable if a timed deletion guarantee is required. The next active
write prunes expired records atomically; at most 100 records are retained by normal use.

## Release gates (not completed by this change)

1. Deploy the tested pilot with public intake disabled. Authenticate through the
   owner page and verify the existing UID-era site_admin role permits readback. No
   role is created or changed by this pilot. Only then enable public intake.
   Review and approve publication/deployment. Do not deploy or push main implicitly.
2. Verify Firebase rules at `/agentFeedback`, including inherited parent rules, deny
   anonymous reads AND writes. Rules are not tracked here. An anonymous read returned
   HTTP 401 `Permission denied` on 2026-10-10; an isolated anonymous conditional write to a unique synthetic entry also returned
   HTTP 401 on 2026-10-10, so no canary was created. These probes do not replace review
   of future rule changes.
   Review deployed rules with authorized administrative access; do not test writes
   against production casually. No new binding or secret is required.
3. Run assembly, feedback tests, existing Worker suites and data validation. Use the
   full permanent `wrangler.jsonc`; do not substitute a partial manifest.
4. Explicitly set `AGENT_FEEDBACK_ENABLED` to the string `true` only after rule and
   deployment approval. The committed default is `false`; missing dependencies also
   fail closed. Rollback/emergency stop: set it back to `false` and redeploy. This
   disables public submissions/discovery; strict authenticated owner review remains
   available and stored data remains in Firebase. To remove the whole feature, revert
   the scoped feature commit and redeploy (storage is not deleted automatically).
5. On the exact deployed version, submit the synthetic example once, retry its key,
   verify one matching receipt through authenticated owner readback, check anonymous
   inbox denial and malformed input rejection. No live write test has been run yet.
6. Only then replace the staged `llms.txt` note with verified live availability.
   Other people's AI testing requires their actual client or a specifically authorized
   external agent; local protocol tests do not establish cross-vendor interoperability.

## Local checks

`cd work && node assemble.mjs` (idempotent and preserves MCP write-scope checks).
`node work/test-agent-feedback.mjs` from repo root tests the new handler with fake
storage plus real assembled-Worker routing. No production data is written.
