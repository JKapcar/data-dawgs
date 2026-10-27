# Selected Bozo capture policy (local implementation)

Paid capture is limited to committed Bozo selections, at entry and once within the existing pregame close window. NFL and college selections use the same policy. Drafts and phase-one submissions use entered odds without spending. After a successful commit, entry observations are saved as `entryCapture` evidence; the confirmed price, timestamp, stakes, results and decision inputs are not rewritten. A matching fresh entry observation may support the presentation-only CLV resolver.

`bozoCaptureReceipts/v1/<sha256>` is a cross-league Firebase ETag claim. The claim precedes the provider request. Success, exact-line misses, errors and pending/uncertain attempts are terminal for that identity. No TTL permits the same immutable request to be bought again. An uncertain process termination can therefore leave a manual-evidence gap; it must not automatically re-buy. Provider responses are also shared by stage, event and market. Event discovery is keyed by kickoff date. No broad SGO kickoff-window query remains; SGO requires a known provider event ID.

The hourly college collector and all-game near-close collector now return a skipped result. Their saved archives and readers remain intact. Automatic historical odds purchases and paid score fallbacks are disabled. Free ESPN, schedule refresh, existing score archives and grading remain available. Provider exhaustion records a durable budget stop. Clearing that stop requires separate operational approval after confirming quota recovery; neither a new tick nor a new selection resets it.

## Historical exchange evidence

The authenticated manager `POST /bozo/close-fill` estimate route accepts `method: historical_exchange_probability_v1` on an exact historical ledger row. Its existing revision/CAS and idempotency checks still apply. The normal manager form treats this method as read-only; submit reviewed structured evidence through the manager API.

The request's `estimate` contains `method`, `rationale`, and `evidence`. Evidence requires:

- Exact `selectionKey`, `eventId`, `startsAt`, `period`, `overtime`, and `originalOvertime`.
- Public HTTPS `sourceUrl`, `historyUrl`, and `originalRulesUrl`, with no credentials, query or fragment.
- `quotedAt` within 15 minutes strictly before kickoff, and `retrievedAt` after the quote and no later than current time.
- A probability strictly between zero and one, explicit `feeRate` from zero through 0.2, `liquidity` (`thin`, `liquid`, or `unknown`), and written settlement `rules`.
- An observed original entry pair already present in the ledger. Missing entry evidence remains unresolved.

The adapter computes a fee-adjusted break-even probability assuming commission on net winnings, then subtracts the original de-vigged entry probability. It records actor, manual provenance, URLs, times and original evidence. It never fills `close`, `closeOpp`, numeric overrides or outcomes. A captured closing pair takes precedence. Identity changes make the evidence stale. Push-zero remains a separate convention.

Human main/Royale CLV rendering no longer emits the accounting table or methodology/source disclosures. Compact labels distinguish measured, estimated, overrides, convention and unresolved records. Unplottable legs remain visible without invented coordinates. The read model and manager evidence access retain full provenance.

## Review limitations

The pre-kickoff correction route retains its existing fresh captured two-sided-pair gate. It now reads an existing exact-selection entry receipt only. Missing, partial, wrong-line, stale, future, or post-kickoff evidence fails closed as manual-pending, without provider requests. No unverified correction is permitted. The rejected proposal to weaken this gate was not applied or retried.

All 28 initial legacy failures were investigated: ten Odds API fixtures needed the durable-store harness and committed/pregame policy; four SGO fixtures needed the budget harness and single-attempt refusal policy; thirteen score/archive fixtures expected retired paid refreshes and now test retained archived evidence or zero-spend behavior; one period-grade assertion was already stale on the base revision and now checks the existing per-leg manual-grade condition. Transport diagnostics, timestamp checks, alias matching and archived grading assertions remain covered. This investigation also found and fixed missing leading slashes on new Firebase paths and duplicated failure diagnostics.

Final validation covers 214 passing fixture tests, including 20 separate VM isolates sharing the actual Firebase ETag GET/conditional PUT helpers against a mocked server. The existing `FB_SECRET` service and RTDB endpoint are reused; there is no new credential, permission or deployment binding. Claims are made with `If-Match`, and a 412 or uncertain outcome cannot start another provider request. A failed league CAS cannot count as a successful capture.

Mocked Chromium checks passed for main and Royale at 390px and 1280px. All page requests were intercepted, all writes blocked, no JavaScript errors or horizontal card overflow occurred, and screenshots were inspected. The CLV accounting/methodology disclosures are absent; estimate, unresolved, pending and push-convention distinctions remain.

Remaining acceptance checks require separate release approval: review/apply the local patch against the then-current main revision; verify the deployed Worker has the same existing RTDB access; and verify read-only live rendering after authorized deployment. No live integration, provider quota consumption, live record writes, push, merge or deployment was performed. A crash after claiming a capture intentionally leaves a manual-pending gap rather than purchasing the same request again.


Release verification follow-up: all 51 unique Worker CI/deploy commands pass locally (fixture network only). The expanded sweep also migrated retired-purchase expectations in MCP, CFB cron, operations health and close-repair tests. Windows CRLF checkout initially broke generated-block comparisons; normalized working text produces an idempotent assembly. The unrelated forecast-live fixture now rewinds a covered historical game in memory rather than requiring the current nfelo mirror to overlap an unfinished game; production forecast code/data are unchanged. Localhost gateway tests pass outside the restricted socket sandbox.

Exchange evidence supports separate selected/opposite historical timestamps and URLs, fee exclusion distinct from a commission calculation, archive time distinct from an unknown HTTP receipt time, contract identity, liquidity and rule caveats. The manager-only reviewed JSON path uses the existing authenticated revision/CAS/readback flow. Firebase removes null properties; explicit feeTreatment=excluded therefore permits absent/null applied feeRate, never a numeric fee coefficient. No original prices or decisions are changed.
