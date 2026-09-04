# Survivor automation — approved and verified September 4, 2026

Kap approved the results-only merge condition and modelled 2026 ownership. Implemented in `abf3933b0909a7fcb78b525f394e8d4ce54149e9`, with live-run fixes in `7b9e66fd25e0be8581dced213a493f6d485ce0df` and `7c21957fd16b691551a73bed9098b52e99da44d8`. Observations through 20:30 UTC.

**Routine weekly manual steps remaining: 0.** This counts ordinary refresh, capture, acceptance of new final results, grading, publication, and modelled ownership. It does not claim the first real final-result merge has happened before the games. Schedule changes, score corrections, and operational failures remain exceptions requiring review.

## Evidence by operation

| Operation | Routine manual steps | Evidence and limits |
|---|---:|---|
| Mirror nfelo and rebuild survivor | 0 | [Live nfelo run 33916381663](https://github.com/JKapcar/data-dawgs/actions/runs/33916381663) passed. All 32 upstream aliases validated. Upstream `e0c270a6` was already mirrored, so no new data commit was needed. Four daily schedules plus explicit dispatch remain enabled. |
| Accept new NFL finals | 0 | [Live NFL run 33916334418](https://github.com/JKapcar/data-dawgs/actions/runs/33916334418) passed the approved acceptance step, pinned source verification, and 45 Python tests. No games were final, so it correctly opened/merged no results PR. A real results-branch merge is still unobserved; fixture tests exercise allowed and rejected changes. |
| Capture and resolve | 0 | [Live receipt run 33916416333](https://github.com/JKapcar/data-dawgs/actions/runs/33916416333) passed after nfelo. Logged current-main checkout and input hashes. Correctly returned `0 resolved, 1 still waiting on results`; capture was outside the pregame window. The 40 CLI tests and 14 gate cases passed locally. |
| Publish and handle concurrent writers | 0 | Explicit token-authenticated Pages requests succeeded; [Pages run 33916434077](https://github.com/JKapcar/data-dawgs/actions/runs/33916434077) deployed `7c21957`. The nfelo Actions run executed the real rebase script against a temporary Git remote, forced a service-worker conflict, regenerated/amended/validated/pushed, preserved both writers, and left receipts unchanged. Its printed fixture commit is not a production data commit. |
| Field ownership | 0 | Public default and receipts explicitly use modelled ownership for 2026. Survivor page, bot instructions, and [dated Method amendment](https://datadawgs216.com/data/method.md) agree. `/survivor-picks` remains optional supplied data, with no claim of a real league feed or required weekly upload. |
| Detect failed or silent runs | 0 | An actual source-check failure opened [issue #66](https://github.com/JKapcar/data-dawgs/issues/66). After fixes, [watchdog run 33916435680](https://github.com/JKapcar/data-dawgs/actions/runs/33916435680) passed; the resolved issue was closed. Scheduled health checks cover missing runs, stale upstream/mirror data, missed capture, overdue grading, and publication drift. |

## Exact acceptance boundary

`scripts/nfl_results_automation.py` constructs a separate candidate from current main. Only already-scheduled games may transition from `(scheduled, null, null)` to `(final, nonnegative integer, nonnegative integer)` after kickoff. Game IDs/order, teams, kickoffs, season/week/type, rest days, venue/division flags, and other fields remain unchanged. Existing finals cannot be corrected automatically. Unrelated safe finals can proceed while structural differences stay in the full-source review PR.

Only the schedule and its four deterministic dependent JSON files may change. The driver reproduces the candidate byte-for-byte, validates immutable model receipts, runs the loader/model/global checks, verifies the bot PR identity/head, and records its verification status. A non-force merge push accepts only the exact validated main parent; a concurrent main change forces regeneration. Main was observed unprotected with no repository rulesets; no protection settings were changed or bypassed. Full-source PR #32 is still a review PR and is not the grading gate for eligible finals.

The source check compares canonical facts from the pinned nflverse CSV to nfelodcm output. Live testing caught empty CSV scores and the loader's documented-in-package `LA`→`LAR` / `LV`→`OAK` ID normalization. Empty scores now remain missing; fractional or nonfinite integer inputs fail. Each alias-bearing upstream ID must still validate against its canonical game ID.

## Grading proof without inventing a live result

`python3 work/test-nfl-results-roundtrip.py --inputs /tmp/nfl-auto-inputs` ran in an isolated clone with pinned reference CSVs. One synthetic final for the pending LAC claim went through the accepted-results projection, full 538 rebuild, receipt validation, and the real survivor resolver. It preserved all 1,088 existing model receipt objects, reproduced 16,810 historical probabilities within tolerance, and produced the correct survivor grade/Brier value. Repeating resolution changed no bytes. No synthetic result or grade was published.

That test also uncovered and fixed two existing blockers: the model refresher rejected an old snapshot before rebuilding it, and legacy receipt migration attempted to relabel old receipts with a new schedule hash. Existing receipt contents and their original provenance now remain immutable.

## Snapshot and live publication proof

The final receipt Actions run logged checkout `7c21957fd16b691551a73bed9098b52e99da44d8` and:

- Survivor input SHA-256: `80469d0eaea9d9eb35a54dd67f5151020c548c185d6935d7c40aae6e780d9cc6`.
- Survivor ledger SHA-256: `727edc866620ad5e23c9a0c1f1d71252ffad87be79b865fde780c7ad42b7fc29`.

The watchdog checked live nfelo, survivor, and receipt bytes against main and passed. Independent live HTTP checks also matched the updated survivor HTML and Method amendment. The August 28 Week 1 receipt retains its original `08c1f34f...` input hash; it must not be relabelled with today's input. Because today's mirror was a no-op and no new capture was due, this run proves the current-main checkout/read, not a newly captured receipt following a newly written mirror commit.

## Reliable workflow continuation

A bot-dispatched NFL run succeeded but did not emit the downstream completion runs observed for the user-triggered rerun. The final implementation uses explicit downstream dispatches and carries failure evidence to a dispatched watchdog for bot-triggered runs. This follows GitHub's explicit [workflow-dispatch exception for GITHUB_TOKEN](https://github.blog/changelog/2022-09-08-github-actions-use-github_token-with-workflow_dispatch-and-repository_dispatch/). Independent cron retries remain. No producer gained an `on: push` trigger. Rerunning an older NFL workflow can forward once to the current definition; current NFL refresh explicitly starts nfelo, whose bot-triggered success explicitly starts receipts.

**Current real ledger: 1 prospective receipt, 0 graded rows.** Waiting before the game is expected. The first actual finals-PR merge and live grade remain in-season observations; they require no planned weekly human action.
