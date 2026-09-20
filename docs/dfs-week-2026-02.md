# Week 2 entry log — 2026-09-20

Format: DraftKings NFL Classic, main slate. Entries and contest sizes below are owner-reported; submission and contest results have not been independently verified. No entries were submitted by this implementation.

Source inputs: owner-uploaded `DraftKings NFL DFS Projections -- Main Slate (7).csv`. Private workspace target: `wk2-main-milly`, `dk_classic`. Projection filter: at least 6.0 points (173 of 365 rows). Raw paid projections stay outside the public repository.

| Entry | Contest | Fee | Field | Salary | Reported ACO | Reported P(score ≥250) |
|---|---|---:|---:|---:|---:|---:|
| A1 | Milly Maker | $20 | 176,470 | $50,000 | 115% | 0.07% |
| Baker | $100K Blind Side | $27 | 4,319 | $50,000 | 114% | 0.04% |

**A1:** QB Brock Purdy; RB Christian McCaffrey, Derrick Henry; WR Mike Evans, Parker Washington, Caleb Douglas; TE George Kittle; FLEX Aaron Jones Sr.; Panthers DST. CSV reconciliation: $50,000 and 114.9% ACO. C. Douglas resolves to Caleb Douglas in the supplied CSV.

**Baker:** QB Baker Mayfield; RB Derrick Henry, Javonte Williams; WR Emeka Egbuka, Chris Godwin Jr., Matthew Golden; TE Mark Andrews; FLEX Bucky Irving; Buccaneers DST. CSV reconciliation: $50,000 and 113.8% ACO.

## Owner's stated rationale (recorded, not independently validated)

A1 is the payout-weighted-ceiling build. The Baker build is a deliberate single-entry placement (Bucs DST + Baker versus CLE), **not a projection call**. Its reported p99.9 trails A1 by approximately 13 points and it belongs in the small field.

The Baker roster contains five Tampa Bay players, including DST, and no Cleveland bring-back. It is an explicit historical placement exception; the default engine (four per team, one bring-back) must reject it. Recording it does not silently relax generator constraints.

## Simulation provenance

The two probabilities and the approximately 13-point gap above are preserved from the work order's earlier local simulation. The original code and random-number draw ordering were not supplied. They are not represented as reproductions by the new engine.

The new score simulator runs 30,000 lognormal worlds at seed 216. Projection is the arithmetic mean (`mu = ln(proj) − sigma²/2`), with `sigma = max(0.25, ln(ceil/proj)/1.28)`. Independent residual variance completes each latent normal to unit variance. QB loadings were unspecified in the work order: the implementation explicitly assumes 0.35 game and 0.45 team, matching WR/TE. RB uses 0.30/0.25. DST uses −0.35 on its game and −0.20 on the opponent team. These are model assumptions, not validated DFS Bible findings. The supplied ceiling controls sigma; it is not forced to equal a lognormal percentile under the mean convention.

Probabilities of score thresholds are not contest win probabilities or payout-weighted EV. At a reported 0.07%, 30,000 worlds yield only about 21 hits; Monte Carlo error and model error matter. Zero ownership remains zero; its log proxy is negative infinity (serialized as null plus a zero-ownership flag).

## Engineering contract

Hard ACO caps are optional, explicit user constraints. The existing Bible's slate-adaptive diagnostic remains a separate hypothesis; the new control does not assert a universal ownership ceiling. The GPP objective is `0.3*proj + 0.7*ceil - 0.05*own`, not a payout optimizer. Missing inputs fail closed. Search timeout is reported separately from infeasibility.
