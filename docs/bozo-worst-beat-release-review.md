# PR 323 safety review — 2026-10-19

## Rollout is inactive

The first draft had two release blockers despite green CI: no historical version
boundary, and a new unmeasurable moneyline could be dropped from the Worker's
Worst Beat candidate set. This revision addresses both without activating the rule.

`worstBeatRuleFor` is identical in the browser and Worker. The default is
`legacy-v1`, including historical rows with no version. An owner-approved
`worstBeatPolicy: {version: "entry-normal-v2", season: 2026, week: 6}` would opt in
only that exact week; this PR does **not** set one in any league. Choosing a future
week instead leaves week 6 unchanged. The policy does not carry into week 7.
There is no automatic future-season or other-league rollout.

The shared grade commit stamps a season/week-scoped `worstBeatReceipt` and row-level
`worstBeatRule`; later policy changes cannot override that receipt. A completed
unstamped week, an already-named reopened week, or legacy-stamped results remain
legacy. Grade confirmation binds the resolved version and rejects a changed policy.
The version is chosen from server-loaded league state, never from client grade
fields. The page's legacy CFB SD stays 16/14; v2 uses Worker 16.5/13. Historical
resampling explicitly uses each row's version rather than the currently active week.
No old rows are migrated or rewritten by this change.

## Exact behavior when inputs are missing

For v2, if the cascade **reaches Worst Beat** with multiple losing candidates and
any moneyline candidate lacks a valid recorded entry pair or settled actual margin,
the Worker returns a blocked decision. It does not drop that candidate, choose a
measurable loser, or advance to another lever. A uniquely decisive earlier lever
and a single-loser week do not need a Worst Beat comparison and retain prior behavior.

The automatic grader leaves the week ungraded; valid individual schedule results
may still be saved by its existing result-update path, but it does not write a bozo,
final status, chop, redeploy, or final-grade receipt. The manager route returns 409
`worst_beat_unmeasurable` without a confirmation token. The shared commit checks
again before writes, protecting confirmed/stale/manual-standard requests too.
The browser's Decide button blocks before confirmation. Fully measurable numerical
ties retain the existing cascade rules; this is not a general tie-rule repair.

The weekly simulator conservatively withholds Bozo probabilities when Worst Beat
is enabled and a potential losing v2 moneyline lacks a pair, or a settled loser
lacks an actual. Missing, explicit null, blank and whitespace actuals are never
zero-filled or sampled as measured settled evidence. Pending games with a usable
pair still receive modelled simulations. Historical Royale projection is likewise
withheld when a v2 resampling row lacks the required facts; it is not silently
dropped from the projection's candidate set.

## Snapshot coverage

The audited main-league snapshot has five current moneylines, all with recorded
pairs: Kap, Squatch, JWhite, Tony and WBeamen. Kap is pending and may be simulated;
the settled current moneylines have actual margins. Thus there is no missing-pair
blocker in the recorded current week. The five completed weeks contain nine
moneylines, all with paired entry quotes; week-1 WBeamen is a losing moneyline with
no actual. JWhite's week-1 winning moneyline also has no actual and is ineligible
for Worst Beat. All 40 completed ledger rows lack period, and all nine historical
moneylines lack an explicit `entryOppSource` field. None is silently promoted to v2.

Verified provider capture now stamps `entryOppSource: "captured"` only after the
actual paired quote passes validation. The real pick builder preserves that stamp;
unverified fallback clears it and submitter-supplied provenance is stripped.
Explicit two-phase manager verification stamps `"manual-verified"`, distinguished
from a provider observation, with its existing original-quote audit receipt.
Future ledger creation copies the pick's period and `entryOppSource`, and `/bozo/clv`
forwards them plus the stored rule version. Unknown historical provenance and old
frozen captures remain null; no automatic backfill occurs. A v2 historical row without period
or provenance is unmeasurable for resampling, even if its live paired-price score
was available. The user must review verified source evidence before filling gaps;
this patch supplies no repair or historical backfill operation.

Production-path fixtures exercise real provider capture and new-pick construction,
and fallback capture followed by explicit manager verification, through ledger,
CLV, and historical scoring. Both produce exactly the live UI/Worker score. The
focused scoring/safety/provider/verification suite passes 47/47; capture and
correction regression tests pass 38/38. These fixtures make no live writes.

## Eight baseline failures

All eight reproduce on untouched main with jsdom installed. No assertion was
removed and no required check was bypassed.

| Test | Diagnosis | Relevance |
|---|---|---|
| Lever standings: score lands | Fixture supplies `actual` but no losing outcome. Current renderer intentionally requires `won === false`. | Existing fixture contract mismatch; new tests cover explicit losing outcomes. |
| Lever standings: CLV missing pair | Behavioral assertions pass; final source regex expects inline CLV arithmetic that was moved into `clvDeltaOf`. | Stale structural assertion, not a new CLV behavior regression. |
| Period grade: SD document/page | SD equality assertions pass; later regex expects obsolete `const need = live.filter(isManualLeg);`. | Does not indicate an SD mismatch introduced here; v2 SD parity is independently exercised. |
| Period market: SGO capture | Signature regex omits the existing trailing `options = {}` parameter. | Stale signature assertion; paired-quote selection is unchanged by this PR. |
| Pending seat submission | Fixture omits required `clientBuild`; returns `page_out_of_date` before membership validation. | Does not exercise its intended membership path. |
| Leaving seat submission | Same missing-build failure precedes the expected leaving-seat error. | Same fixture problem. |
| Active seat submission | Missing build returns 409 rather than expected 200. | Same fixture problem. |
| Reopened promoted seat submission | Missing build returns 409 rather than expected 200. | Same fixture problem. |

The initial commit's CI completed successfully: Worker validation, site verification,
DFS diagnostics and EPA verification passed; EPA refresh was intentionally skipped
for the pull request. The safety revision must pass those same checks before release.

## Remaining decision

Jason must choose the effective week. No policy, current-week grade, historical
record, wager, credential, permission, or deployment has been changed. The general
tie-cascade discrepancy remains a separate review item. Even green CI is not
authorization to activate this rule or deploy.
