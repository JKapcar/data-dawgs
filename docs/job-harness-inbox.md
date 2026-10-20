# Job Harness: inbox reconciliation (proposal, not built)

Status: design only. Nothing here is implemented, connected or scheduled. Each of these needs its own explicit approval before any building starts: connector access, where the reconciler runs, private storage for proposals, any write path, any schedule. Sending email, applying, uploading résumés and auto-replying are out of scope permanently, not just for now.

## What it is for

Turn application confirmations and status emails into **proposed** history entries that the owner approves one by one. An email is evidence, never authority to act. The tracker's existing rules still decide what can be stored (`docs/job-harness.md`).

## Classification

| class | example | if approved |
|---|---|---|
| `submission_receipt` | "We received your application for Data Analyst (REQ-123)" | `event.append`: submitted · none, evidence = the message link |
| `generic_acknowledgment` | "Thanks for your interest", talent-community welcome | **no status change**: it does not prove which application, or that one was submitted |
| `draft_or_reminder` | "Finish your application", "your draft is saved" | **no status change**; at most a blocker note the owner writes |
| `interview_request` | scheduling link, interview invitation | interview · none |
| `rejection` | "we will not be moving forward" | closed · rejected; `reason_kind: explicit` only if the email states a reason, else `unknown` with empty text |
| `position_closed` | "the position has been filled / cancelled" | closed · position_closed |
| `offer` | offer letter or call to discuss an offer | offer · none |
| `withdrawal_confirmation` | confirms the owner withdrew | closed · withdrawn |
| `marketing`, `job_alert`, `recruiter_outreach`, `other` | newsletters, saved-search digests, cold outreach | review only; never a status |

Rules that do not bend:
- Only `submission_receipt` can propose a submission, and only when the message names the role or requisition. A marketing email, an application draft or a generic thank-you never marks anything submitted.
- Silence is never imported. `no_later_decision` stays the owner's explicit choice.
- Unknown or conflicting outcomes go to review. The reconciler does not resolve them.
- Records are never created from email. A message that matches no record waits for the owner, who can add the opportunity themselves.

## Matching

An exact match is the employer key plus the canonical requisition, using the same `JOBS_CORE.identityOf` rule the tracker uses, and it applies only when the message carries a requisition. Otherwise the reconciler lists candidates (same employer key, open records), and the owner picks one or none. There is no fuzzy auto-match and no inferred merge.

## Proposal record (private storage, separate from the workspace)

`{proposal_id, source: {kind, message_ref_hash, thread_ref_hash, received_at, sender_domain}, class, confidence, extracted: {employer_text, role_text, requisition_text}, match: {record_id | null, method: exact | candidate | none}, proposed: {op, data}, status: pending | approved | dismissed | superseded, reviewed_at, reviewer_uid}`

- The evidence link is the owner's own mailbox permalink (HTTPS), so only they can open it. No message body, attachment, signature block or contact detail is stored.
- `confidence` is reported, never acted on. It sorts the review queue.
- On approval, the page sends the ordinary operation with `request_id = "inbox_" + first 32 hex of sha256(message_ref + class)`. Approving twice replays. The tracker's `duplicate_event` guard backs that up.
- Evidence older than the record's current step is offered as a correction of a chosen entry, or dismissed, never as a plain append, because the tracker would refuse it anyway.

## Runs

A run records `{run_id, started_at, finished_at, window: {from, to}, source_cursor, scanned, proposed, failures: [{message_ref_hash, code}], readback: {revision, sha256}}`.

- A run is complete only when every message in the window was processed and the proposal-store readback matches.
- A partial failure never advances the cursor.
- The page's WEBSITE SYNC tile shows the last complete run. Until one exists it stays "Pending integration", and the existing daily Gmail check keeps reporting website sync as pending.

## Where it should run (recommendation)

Start on demand, with a person in the loop. A Claude session uses the already-connected Gmail connector for read-only search of candidate messages, and proposes entries in chat. On the owner's explicit approval, it writes through a new owner-only, two-phase tool: echo, then confirm with a code. That is the same pattern as `dd_submit_bozo_leg`. It needs no new credential in the Worker, no stored mailbox token and no schedule. A scheduled or Worker-side reconciler would need a new mailbox credential and its own security review. Revisit it only after the on-demand flow has a clean record.

## Safety

- Email text is untrusted input. Instructions inside a message are content to classify, never commands. A proposal never triggers an action by itself.
- Proposals are private data: same no-log rule, no public data files, and the provider-export guard in `tests/jobs-privacy.test.cjs` applies.
- The connector scope is read-only search. No send, no labels, no filters, no forwarding rules unless separately approved.

## Acceptance tests (when built)

Use invented fixtures only:
- a receipt with a requisition, and one with a role but no ID;
- a generic thank-you, a talent-community welcome and a draft reminder;
- a rejection with a stated reason and one without;
- a closed position, an interview invite and an offer;
- marketing and a job alert;
- a forwarded chain, an HTML-only message and a non-English message.

Expect:
- the classes above;
- zero automatic writes;
- approval twice replays;
- conflicts queue instead of resolving;
- a partial run leaves the cursor in place;
- no private text in logs or errors.
