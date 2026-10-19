# Moneyline Worst Beat proposal — 2026-10-19

**Review required before merge or deploy. No regrading or live data writes.**

For a moneyline, let `I(a) = -a / (100-a)` for negative American odds and
`I(a) = 100 / (100+a)` for positive odds. Use the recorded entry quote and the
recorded opposite quote from the same two-way market and period:

```
p = I(entry) / (I(entry) + I(opposite entry))
sigma = sport margin SD * sqrt(period fraction)
expected margin = sigma * inverseNormal(p)
Worst Beat = (expected margin - actual selected-team margin) / sigma
```

Higher means worse. This is a normal-distribution model of margin, **not an observed
spread**. It ignores discrete scoring, key numbers, ties and sport-specific skew.
The probability is a proportional de-vig estimate, not a calibrated win forecast.
The [normal quantile identity](https://statproofbook.github.io/P/norm-qf.html) supports
the conversion; [Pinnacle's margin explanation](https://www.pinnacle.com/betting-resources/en/betting-strategy/betting-odds-explained-how-do-odds-work/qen2dcqrvncnv4jf)
explains why raw implied probabilities include a bookmaker margin. Neither source
validates the sport SD assumptions used here.

The chosen probability source is entry, not close: this measures underperformance
against the strength of the leg selected. `entryPriceOpp` takes precedence; legacy
`priceOpp` is accepted as the recorded opposite entry. Missing, blank, malformed,
non-finite or invalid American odds, `entryOppSource: assumed`, and an explicitly
unverified entry produce `null` with basis `entry-unpriced`. There is no raw-implied,
closing-price or fixed-juice fallback and no artificial 2%/98% clipping. Prices
are assumed to have been captured for the same market by the existing submission
pipeline; this patch does not reconstruct or manufacture quote provenance.

Only losses are eligible. Explicit pending, won, push and void rows never score;
missing actuals never score. Helpers accept an actual without a status for internal
simulation; live ranking still filters to losses. SD and expected margin use the
same period units as the entered actual, never the full-game score for a half.

The Worker table is authoritative per `docs/bozo-sd.json`: NFL 13.5, CFB 16.5,
NBA 11.5, CBB 10.5, MLB 4.4, NHL 2.3. These are existing uncalibrated assumptions,
not newly fitted values. The page adopts CFB 16.5 instead of 16, and CFB total SD
13 instead of 14, so both paths agree. This explicit normalization also changes
page-only CFB spread/total scores and simulation distributions; Worker spread/total
rules do not change. Half SD = game SD × sqrt(.5); quarter SD = game SD × .5.

Spreads and totals retain distance from their posted line, without price adjustment:
their selected handicap/total already defines the threshold. Applying a second
price shift to those markets is a separate rules decision. Binary props retain
their current price-derived inverse-Mills rule and source order. This creates
intentional overlap with Shortest Odds for moneylines, reversing the August 12
decision in `61e742f3d02f05f43cf50a94085c4b7d3c120a3f` at Jason's request;
it does not revive the older `.022` juice heuristic.

## Impact and release decisions

See [the full 1–15 point table and historical audit](bozo-worst-beat-impact.md).
Kap's SF pair -395/+310 gives p = .7659021045164341, expected NFL margin ≈ 9.79314.
Will's Baylor pair -218/+180 gives p = .6574752261956054, expected CFB margin ≈ 6.69211.
Will's 11-point loss scores 1.072249 SD. Kap crosses at a 4.682221-point loss,
so an integer **5-point SF loss** is sufficient under the proposal. All current
losers are checked; Tony scores .720321 and ItzBornLegend .111111 SD.

The existing tie cascade remains discrepant: the Worker restarts each lever with
all losers, while the page narrows to ties plus unmeasurable legs. The standard
auto-grader also invokes that Worker cascade. Missing prices can therefore produce
different final decisions despite identical per-leg scores. The old Worker at SF
-9 selects Tony after a Worst Beat tie; the old UI selects Will outright because
of its CFB SD. This patch documents and tests that discrepancy without changing it.

Before release, review (1) the entry-only/missing-price policy, (2) the intentional
CFB SD normalization, (3) which week the rule becomes effective, including whether
to apply it to the already-open week 6, and (4) a separate tie-cascade fix. A merge
deploys Pages; Worker promotion is separate. Coordinate both only after approval
to avoid a period where their rules differ. Historical displays recompute scores;
stored verdicts are not migrated. Five completed-week ledger replays preserve
baseline Worker selections, but week 1 already differs from its stored verdict
and all historical ledger rows omit period. This is not sufficient evidence for
retroactive regrading, and no other leagues were audited.

## Verification

`node --test tests/bozo-expected-margin.test.cjs` runs shared golden vectors through
the actual page and Worker entry points, exact numeric parity for every sport,
market and period, stronger-favorite ordering, missing-price and non-loss handling,
and the existing Worker tie behavior. `node work/test-bozo-sim.mjs` exercises the
actual browser simulator. `node tools/bozo-rule-impact.cjs` reproduces the impact
report entirely offline from a minimal public scoring snapshot and baseline Git
commit. It has no live-write path.

Validation on 2026-10-19: 9 new scoring/decision tests pass; browser simulation
81/81, auto-grade 61/61, close-fill 38/38, CLV plumbing 19/19, override 28/28.
The broad Bozo suite runs with temporary jsdom dependencies: 305/313 pass, with
the same 8 failures reproduced on unchanged main (296/304). Those existing failures
are two lever-standings assertions, one stale period/manual-leg assertion, one
period-capture assertion, and four roster assertions including outdated client
build fixtures. No new broad-suite failures remain. Data validation passes with
existing warnings; Worker assembly is idempotent and the script parses.
