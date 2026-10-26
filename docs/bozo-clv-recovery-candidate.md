# Supplemental CLV recovery candidate — 2026-10-26

Release candidate rebased on main 6885a367. Historical record writes are separate from code publication. No credentials or private league records are included.

## Evidence contract

Existing manager-only POST /bozo/close, CAS revision, request-ID idempotency and audit remain unchanged. Saves touch only the target row's `clvEstimate` plus audit. `close`, `closeOpp`, `clvPts`, picks, outcomes and financial/contest decisions are not changed.

- Existing `closeQuote`/`scenarios`/`rationale` input remains compatible. `book` is now an explicit lowercase source-book slug, not forced to DraftKings. Cross-book quotes require both observed sides. Return `provenance` distinguishes same-book reconstruction and cross-book proxy. `unknown` means unidentified source book, never silently DK.
- `method: opposite_ladder_proxy_v1` takes `closeQuote` with `price: null` and an observed `opposite`, plus 2–8 `calibrationPairs` (`selectionKey`, American `price`, `opposite`). All calibration markets must be distinct, same exact event, market, side, prop and period with distinct finite alternate lines, and observed from the stated source/book/time context. Manager must verify period, overtime rules and surrounding alternate-line appropriateness; key match is necessary but not sufficient semantic verification.
- This model computes each hold as implied(paired side A)+implied(paired side B)-1, bounds it to 0–30%, infers selected fair probability as 1−implied(observed opposite)/(1+hold), and subtracts de-vigged entry fair probability in percentage points. It requires an observed entry pair. Returned selected quote remains null. Range is calibration sensitivity, NOT a statistical confidence interval or observed close. No arbitrary client point accepted.
- Optional `originalDecimal: {price, opposite}` retains the original decimal pair and must match the supplied unrounded American conversion exactly. Rounded substitutions are rejected.

All quotes preserve source URL, quotedAt versus retrievedAt, exact selection identity and evidence type. Untimed quotes must have null quotedAt. Known quote time must precede known kickoff and not follow retrieval. QuotedAt null remains visibly unknown, not a fabricated close timestamp.
- `method: owner_push_zero_v1` + rationale is an explicit manager-authored per-row display convention allowed only for a recorded push. The resolver returns `kind: convention`, never measured/estimated, and no binary outcome axis. It does not zero-fill ordinary missing legs. For the user-requested Smith push, save only to the reviewed exact row IDs, preserving recorded 6.6 line and result.
- No Polymarket adapter was added: different resolution rules/fees/timing must not be silently treated as identical sportsbook prices. No provider access or capture retries added.

## Lifecycle and presentation

Estimate basis always compares selection, entry and close fields, verification, kickoff and result. When both snapshots contain transient settlement wrappers, material wrapper fields still compare (observation refresh time ignored). When finalization removes that wrapper, unchanged canonical basis stays valid. Actual is canonicalized from the legacy wrapper or final row: actual corrections invalidate even if the won/lost outcome remains unchanged. New bases carry basisVersion 2, so Firebase null omission cannot make a new unknown actual look legacy. Legacy finalized estimates that never stored an actual retain their original comparison contract with an explicit visible warning that score/stat changes cannot be checked until reviewed. Known actuals and transient wrappers remain strict; all recorded market/entry/result fields remain material. Re-read legacy rows and perform an evidence-reviewed CAS refresh when owner access is available. No ledger mutation repairs the stale flag.

Every-bet accounting is now available to ordinary viewers, not agent-only. Coverage distinguishes measured, estimated, overrides, owner-convention zeros and unknown. Empty-chart text states missing usable evidence rather than falsely saying no graded legs. Cross-book/model and quote/retrieval timing remain visible.

## Verification

36 targeted estimate/resolver/manager tests pass, including nine new lifecycle, cross-book, model and convention regressions. Broad Bozo suite: 331 pass / 11 fail; clean dbdab404 baseline: 322 pass / same 11 fail. Existing failures include missing extracted fixture blocks and stale submission-build fixtures; no new failures. Inline page JavaScript parsing is covered. Fixture browser QA attempted: loader initially did not discover Chromium; retry with installed /usr/bin/chromium reached launch but sandbox denied socket() (Operation not permitted) and Chromium exited. No visual-readback success claimed; no sandbox bypass attempted. Service-worker key restamped using repository script. All new fixtures synthetic.

Independent peer re-review reproduced unchanged-finalization acceptance, changed-actual rejection and wrong-side/period rejection; 36 targeted tests and diff-check passed. No remaining blocking code defect was found within the reviewed patch scope. Browser verification remains blocked.

## Required before release / data writes

Review patch and live manager contract; rebase against concurrent main; validate browser visuals on desktop/mobile; authorize and perform approved release with correct Worker and Pages configuration; read back actual published assets. Then authenticate existing owner access, re-read each exact ledger row and revision, submit verified evidence individually with unique request IDs, and read back both persisted estimate and visible board. Do not claim all finished games covered until every row is reconciled. This candidate alone changes no live CLV.

## October 26 release integration

The manager form now preserves the explicit source book, requires observed pairs for cross-book proxies, supports owner push-zero conventions, preserves original decimal quotes, and refuses model-record editing rather than silently changing its method. Browser fixtures cover these formats and ordinary-view accounting visibility. Local Chromium launch remains blocked by the execution sandbox; CI browser checks must pass before release. Baseline and candidate broad Bozo suites share eight existing failures with jsdom installed; no blanket all-tests-pass claim is made.
