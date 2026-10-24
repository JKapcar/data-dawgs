# Missing historical Bozo results

Status: implemented for review; not deployed or verified in a connected client.

Use the existing `dd_bozo_week` read. Each leg exposes its exact `memberKey`,
event/ESPN ID, market, period, stored line, result and `resultRevision`.
`pendingResult` means a missing grade, not a final game. `fallbackBlockedReason`
explains unsupported ticket/leg state. Positive spread lines mean points GIVEN.

`dd_record_bozo_result` adds one narrow core-catalog write, using the existing
personal account and verified manager/delegate/site-admin authorization. It fills
only a missing full-game NFL/CFB spread, moneyline or total result on a current
placed ticket. Existing grades/manual stamps, unsupported periods, unknown
identity, future kickoff and completed/settling tickets fail closed.

1. Read the current leg and inspect the exact ESPN game page. Verify Final or
   Final/OT, home/away identities and scores. Do not infer finality from elapsed
   time or from a missing grade. If the source is unavailable or ambiguous, stop.
2. Preview with `league`, exact `forUid`, `revision`, a specific `reason`, and
   `evidence`: `sourceUrl`, `eventId`, `completed:true`, `status`, `observedAt`,
   `homeTeam`, `awayTeam`, integer `homeScore` and `awayScore`. Evidence must have
   been observed within 30 minutes. Review the returned selection and arithmetic.
3. Within explicit user authorization for historical grading, confirm using only
   `league`, `forUid` and the returned `confirm_code` as `confirm`. Code expires
   after five minutes. The server rechecks authority, revision and evidence.
4. Require `committed:true` and `matchesRecorded:true`, then reread
   `dd_bozo_week`. The confirmation response includes its stored audit summary;
   the leg's `resultEvidence` retains its source and reason. A readback failure
   is explicitly reported; it must not be described as a verified result.

The score is **manager-attested**, not fetched or independently verified by this
tool. The server checks exact schedule identity, score shape, kickoff and conflicts
with an available cached official final, then calculates the result. This permits
recovery when the automatic score feed failed without pretending that the feed
verified the evidence. For a synthetic IU -3.5 example, 13-6 gives margin 7;
7 minus stored line 3.5 gives +3.5, won. For totals, actual is the combined score;
under uses line minus actual, over uses actual minus line. Zero is a push.

Confirmation performs one conditional league write containing only the target
result and its audit receipt; it preserves the rest of the fresh state. It does
not place bets or change selections, prices, stakes, ledger, elimination, status,
funding or payouts, and does not invoke week resolution. Normal downstream grading
continues separately. A concurrent write returns a conflict. After an uncertain
response, retry **the same code**, never make a fresh preview: the durable audit
receipt makes this idempotent even after the preview expires. If the later current
state differs, `matchesRecorded:false` reports that fact without restoring it.

## Deployment and client activation are separate

The existing hosted Streamable HTTP JSON-RPC endpoint is on
`https://toto.jkapcar4.workers.dev`. Existing personal connector routes are
`/mcp/core/<personal-credential>` and `/mcp/full/<personal-credential>`; `/mcp/<personal-credential>`
uses the full catalog. The credential is secret: never put the resolved URL in a
commit, report, screenshot or log. Shared legacy credentials cannot perform this
write. The site's `connect.html` is the existing connector setup UI, not proof that
any particular assistant has an installed connection.

After separate owner approval, release through the existing guarded Worker workflow
in [worker-deploy.md](worker-deploy.md). Keep the full manifest and configuration
guard: preserve active RoboKap/Discord flags, Pack seat and the existing listener
approval expiry (including the October 24 23:40 UTC expiry); do not renew it.
This change modifies no configuration, grants, secrets, cron or listener settings.
The existing guard tests cover expiry preservation and reject configuration drift.

Refresh an already authorized personal connection's tool catalog, if that client
supports it. Verify actual authenticated `initialize`, `tools/list`, `dd_whoami`
and `dd_bozo_week` calls through that client's connector. The new tool must appear
in core/full with the intended identity; listing the server implementation is not
enough. If no custom connection is installed, the owner must approve and perform
the client's existing custom-MCP connection flow using their existing credential.
Do not mint credentials or broaden grants to solve discovery. This development
session has no callable Data Dawgs connector, so end-to-end client activation
remains unverified. No new daemon or schedule is included.

The existing fallback schedule can use the read/verify/preview/confirm/readback
sequence after deployment and connector verification, within its explicit grading
authorization. Report ambiguous games and conflicts instead of guessing. Keep the
tool marked staged in the public surface manifest until live verification succeeds.
