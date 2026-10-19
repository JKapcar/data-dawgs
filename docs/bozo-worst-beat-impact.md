# Read-only rule impact — 2026-10-19

Source: https://data-dawgs-draft-default-rtdb.firebaseio.com/bozo/leagues/main.json; baseline commit d9f20d47. No records regraded.

## Week 6: SF hypothetical loss

All four losing candidates included. Other winners excluded. SF remains pending in the source; these are scenarios.

| SF loses by | Old UI Kap SD | Old Worker Kap SD | Proposed Kap SD | Will SD | Tony SD | ItzBornLegend SD | Proposed Worker selection |
|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 0.074074 | 0.074074 | 0.799492 | 1.072249 | 0.720321 | 0.111111 | WBeamen |
| 2 | 0.148148 | 0.148148 | 0.873566 | 1.072249 | 0.720321 | 0.111111 | WBeamen |
| 3 | 0.222222 | 0.222222 | 0.947640 | 1.072249 | 0.720321 | 0.111111 | WBeamen |
| 4 | 0.296296 | 0.296296 | 1.021714 | 1.072249 | 0.720321 | 0.111111 | WBeamen |
| 5 | 0.370370 | 0.370370 | 1.095788 | 1.072249 | 0.720321 | 0.111111 | Kap |
| 6 | 0.444444 | 0.444444 | 1.169862 | 1.072249 | 0.720321 | 0.111111 | Kap |
| 7 | 0.518519 | 0.518519 | 1.243936 | 1.072249 | 0.720321 | 0.111111 | Kap |
| 8 | 0.592593 | 0.592593 | 1.318010 | 1.072249 | 0.720321 | 0.111111 | Kap |
| 9 | 0.666667 | 0.666667 | 1.392084 | 1.072249 | 0.720321 | 0.111111 | Kap |
| 10 | 0.740741 | 0.740741 | 1.466158 | 1.072249 | 0.720321 | 0.111111 | Kap |
| 11 | 0.814815 | 0.814815 | 1.540233 | 1.072249 | 0.720321 | 0.111111 | Kap |
| 12 | 0.888889 | 0.888889 | 1.614307 | 1.072249 | 0.720321 | 0.111111 | Kap |
| 13 | 0.962963 | 0.962963 | 1.688381 | 1.072249 | 0.720321 | 0.111111 | Kap |
| 14 | 1.037037 | 1.037037 | 1.762455 | 1.072249 | 0.720321 | 0.111111 | Kap |
| 15 | 1.111111 | 1.111111 | 1.836529 | 1.072249 | 0.720321 | 0.111111 | Kap |

Old UI Will = 0.687500; old Worker Will = 0.666667. Old UI threshold: 10; old Worker: tie at 9, Kap at 10+. Proposed threshold: 5.

At SF -9 the old Worker ties Kap/Will at 2/3 SD and restarts Last In across all losers, selecting Tony. The old UI uses CFB SD 16 (Will = 0.6875), so Will wins outright. Even after SD alignment, UI narrows to ties/unmeasurable legs while Worker restarts all losers. This PR preserves that cascade discrepancy; missing-price legs can also expose it.

## Completed-week replay from available ledger fields

| Week | Recorded bozo | Baseline Worker replay | Proposed Worker replay | Losing ML scores changed |
|---:|---|---|---|---|
| 1 | WBeamen | Squatch | Squatch | BUTTS: 1.481481 → 1.831677 |
| 2 | ItzBornLegend | ItzBornLegend | ItzBornLegend | none |
| 3 | Squatch | Squatch | Squatch | none |
| 4 | Squatch | Squatch | Squatch | Squatch: 0.222222 → 0.811252 |
| 5 | ItzBornLegend | ItzBornLegend | ItzBornLegend | none |

Scope: 40 completed ledger rows, 5 stored historical bozos, plus 8 current picks. No proposed Worker selection changes in this limited replay. Week 1 already disagrees with its stored bozo under the baseline; do not infer historical correctness from this replay. Historical ledger rows omit period and may omit quote provenance (all 40 lack period), so archived full-state evidence is needed before any retrospective ruling. Numeric historical displays may change when recomputed: BUTTS week 1 and Squatch week 4 moneylines, plus CFB page SD normalization. Stored records are untouched. No other leagues audited.
