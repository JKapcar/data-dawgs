# Correcting one placed Bozo pick

`POST /bozo/correct-pick` and MCP `dd_correct_bozo_pick` share one implementation
and `BOZO_CORRECTION_SCHEMA`. The placed-board form uses that same endpoint.
This flow replaces exactly one member's selection without reopening the board.
It does not change a real sportsbook ticket; the manager must handle that separately.

## Permitted correction

The only type is `replace_before_kickoff`. A personal authenticated UID must be the
stored `managerUid`, a UID-keyed delegate, or a verified site-admin role. Display
names, shared connectors and request-supplied actor fields grant no authority.
Legacy name-only manager records must first be reconciled through the existing
identity workflow; this endpoint does not silently grant them new access.

The ticket must be placed, with a draw, lock timestamp and target ledger receipt.
The exact target member key must be active and, in Royale, alive. Every original
ticket game and the replacement must have an unstarted schedule match. Any live
results (including close data), grading fence, resolved Royale chop or target
ledger grading/close data blocks this correction. Open-board edits use the
existing submission flow. Started/scored selections, retrospective quote repairs,
elimination changes and reopening are deliberately not correction types here.

## Two phases

Propose with the existing session header (`X-Bozo-Session`) or personal MCP identity:

```json
{
  "league": "example-league",
  "forUid": "exact-stored-member-key",
  "type": "replace_before_kickoff",
  "reason": "Wrong side was entered",
  "pick": {
    "sport": "nfl", "eventId": "schedule-event-id", "game": "AWAY @ HOME",
    "mkt": "ml", "side": "HOME", "line": 0, "label": "HOME ML",
    "startsAt": "schedule-provided-ISO-time"
  }
}
```

The server captures a fresh two-sided quote. Manual fallback, missing opposite
prices, ineligible CLV and snapshots older than five minutes are refused. Phase one
only stages an actor/league/member-bound KV proposal. Show its complete `echo` to
the manager. It includes the old and new selection, captured price and timestamp,
reason, and impact on Last In, shortest odds, CLV and Worst Beat.

After approval, send only `league`, `forUid`, `type` and the returned `confirm` code.
The proposal expires within five minutes (sooner if the quote reaches that age).
Confirmation rechecks authorization, the entire league version, schedule and
current server time after asynchronous validation. It approves the quoted price;
it never silently reprices. HTTP failures use 400/401/403/409/502/503 with an error;
MCP returns the same error as an error tool result. HTTP responses are private/no-store.

## Receipts and preserved state

One conditional RTDB league write commits the new pick, **one** current ledger row,
and both durable audit and commissioner-log entries. The receipt at `audit/<code>`
contains original and replacement picks and ledger rows, exact actor/member keys
and display names, reason, source surface, server confirmation time, draw and
original lock time. Read it through manager `GET /bozo/admin?league=...&path=audit/<code>`.
The append-only audit is protected by the existing admin path guard and survives
week advancement. Subsequent corrections create another receipt; they do not
overwrite earlier generations. Reasons are league audit content, not private notes.

No original grading/closing fields are inherited. The new pick is pending close
capture. Original draw/order, status, lock metadata, membership, Royale state,
all other member picks/ledger rows, and prior weeks remain unchanged.
The member's new `ts` is confirmation time, never the time a message was sent.
The replacement ledger's rank/shortest-odds fields describe the correction-time
snapshot (`rankBasis: correction_time`); other ledger rows retain their original
lock snapshots. Its `secToClose` is relative to the preserved original lock and
can therefore be negative. Live tiebreakers use current picks, not these old ranks.

Concurrent changes fail the ETag comparison rather than overwriting state. Audit
failure cannot leave a successful unaudited correction. Retrying the same code
recovers the durable result even after KV expiry or a lost response. Authorization
is checked before replay; an older receipt replay never restores an older pick.

Close capture, manual close fill and grade writes compare the pick snapshot and
use conditional league writes. Signed grade previews also bind the pick snapshot,
so old prices/results cannot be attached to a replacement by an in-flight job.
Existing raw admin remains a privileged repair tool, not this correction workflow;
it must not be used as a shortcut around these guards.

## Release and validation

No live picks, leagues, credentials or vault storage were changed while developing
this feature. Merge publishes GitHub Pages; Worker traffic changes require a separate
explicit release authorization under [the Worker runbook](worker-deploy.md).
Release the matching Worker before enabling the site form; an older Worker will
refuse its new route. The vault remains disabled and its work is separate.

Run `node --test tests/bozo-correction.test.cjs` plus the existing proxy, schedule-grade,
Odds API, CLV repair and form-spread suites. The new suite is included in Worker
validation/deployment CI. Fixtures are synthetic and transports are in memory.
Use the repository runbook for assembly, identity/MCP and other required checks.

Local validation on 2026-10-16: 120 targeted correction/proxy/grade/capture/DOM
tests and 14 service-worker tests passed. The broad Bozo suite passed 283 of 291;
the same eight failures occur on untouched base `d18a7bb` (249 of 257 passed).
Those failures concern two lever metrics, the SD documentation assertion, an
older capture-signature assertion, and four stale roster submission fixtures.
MCP (459), identity (144), backup (14), CFB capture (29), SwoleDawg (91),
autograde (61), close fill (38), CLV plumbing (19), simulation (69) and override
(28) checks passed. Assembly/idempotency, data validation and Wrangler dry-run
passed; dry-run retains the existing CommonJS-in-ESM warning. No version was uploaded.

Limits: this uses an RTDB whole-league CAS, matching the existing verification flow;
large league/audit histories may eventually need a more granular transaction store.
It intentionally refuses any existing result/close rather than clearing historical
evidence. The local native browser runtime was unavailable; UI verification used
the real page functions and DOM in jsdom, not a live authenticated session.
