---
as_of: "2026-08-08"
source: "Data Dawgs reimplementation of fivethirtyeight/nfl-elo-game at fbec1afa38ece5befe24fb21be8ddba8eb160fe6, extended with nflverse/nfldata at 30edeb4bf5e51d6334ef161a2e5c01c8d0961386."
---

# 538 Classic Elo methodology

This is a permanent simple benchmark, not a claim that an old model is the best current
NFL forecast. The implementation preserves the published FiveThirtyEight Classic Elo
mathematics: 65 Elo points for non-neutral home field, K = 20, a one-third offseason
reversion toward 1505, the Elo logistic win probability, and the published
margin-of-victory multiplier.

## Reproduction and current state

Every online refresh downloads two files from the exact FiveThirtyEight reference commit,
normalizes CSV line endings to the Git blob form, checks their SHA-256 hashes, and replays
all 16,810 published historical probabilities. The
maximum absolute difference from the published probabilities is 0.000001663 or less. That
small residual comes from early-era Elo seeds published to three decimals; it is under
0.0002 percentage point.

The replay ends after the 2020 season. Data Dawgs then applies the same mathematics to the
1,424 completed 2021–2025 games in the exact nflverse snapshot recorded by
`/data/nfl-schedule.json`. The resulting ratings receive the declared offseason reversion
before 2026 probabilities are generated.

The public `/data/538-classic.json` envelope contains the 32 input team ratings, all
currently prospective forecasts, exact upstream commits and source hashes. Its
`integrity.input_snapshot_id` covers the model constants, both source snapshots, canonical
schedule snapshot and target-season ratings.

## Receipts and limits

Forecasts are appended to `/data/model-receipts.json` before kickoff. Results will be
stored separately; published forecasts are never rewritten. The output is ungraded and
contains no quarterback, injury, weather or market adjustment. Expected margin, cover
probability and push probability remain null because Classic Elo does not produce them.

The code reference is MIT licensed. The preserved notice is in
`/docs/538-classic-MIT.txt`. The nflverse/nfldata repository's data license has not been
independently verified, so the envelope says that explicitly instead of inheriting the
code license.
