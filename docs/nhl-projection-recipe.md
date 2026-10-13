# NHL Projection Recipe

Run this from the DataDawgs checkout using Node.js 22+. No account, API key or subscription is required. Output must be a new directory outside this public repository so raw source files stay private.

```sh
node tools/nhl-refresh.cjs --download --as-of 2026-10-13T20:21:00Z --output ../nhl-runs/2026-10-13
```

Choose a non-future ISO cutoff with timezone and a unique output folder. The entire cutoff UTC date is excluded. Download mode retrieves the twelve published CSVs listed in `nhl-projection-recipe.json`; season keys are ending years. No schedule or deployment is created. Network/source failures stop the command and leave the partial run for inspection; use a new directory for a retry. It never overwrites an earlier run.

For deterministic offline reproduction, replace `--download` with `--inputs path/to/prior-run/inputs`, retain the same cutoff, and use `--seed path/to/prior-run/identity-seed.json --previous path/to/prior-run/previous-model.json`. Source URLs alone are mutable; the saved bytes and SHA-256 receipts establish exactly what was used. Compare output hashes in audit.json. The same inputs, seed, parameters and implementation must reproduce the same model and projection CSV.

The default identity seed and prior comparison are the bundled model. `--seed` accepts a trusted model JSON/JS; `--previous` chooses a prior model JSON/JS. The seed supplies the included NHL IDs, full names and current-team labels. This is deliberately not automatic roster discovery: independently verify an updated seed before introducing new players or changed teams. The fixed 2025/2026/2027 window requires an explicit reviewed recipe and builder update when a new season begins.

## What the command does

1. Preserves raw input bytes, identity seed and previous model in the private run directory.
2. Validates seasons, regular-season game type, completed-game evidence, cutoff, minutes, duplicates and goalie arithmetic/decisions using the existing pipeline.
3. Calculates each player's observed-component DK mean, actual threshold bonuses, sample variance/SD and sample counts. Goalies use starts including pulled starts; relief is separate. No position shrinkage is applied.
4. Runs the date-ordered backtest, withholding all same-day targets. At least ten prior observations are required. It compares player mean, prior-season mean with fallback, last-10/20, EWMA20 and capped recent-minutes adjustment; it does not tune or automatically promote a winner.
5. Validates the model, including component-to-mean reconciliation and no post-cutoff history, then writes the outputs below.

| Output | Purpose |
|---|---|
| projections.csv | Player means, SD, variance, sample counts, score sums/squared sums and component contributions; missing values remain blank |
| model.json | Full machine-readable baseline, season splits, relief samples, missing-component coverage and attribution |
| audit.json | Recipe/scoring/parameter snapshots, implementation hashes, input/output hashes, source freshness, validation counts and remaining missing inputs |
| backtest.json | Chronological MAE, RMSE, bias and descriptive prior-P10/P90 interval coverage |
| comparison.json | Prior/current sample count, mean and team per NHL ID; added/removed/uncomparable entries are explicit |
| workbook-data.json | Model, backtest, comparison and limitations for audit-workbook creation; this is data, not an Excel workbook |

Use `(ScoreSumSquares - ScoreSum^2 / SampleN) / (SampleN - 1)` to independently check sample variance when n > 1. SD is game-to-game variation, not standard error. Review changed sample counts, means, teams, exclusions, source dates and missing components before accepting a refreshed model. Source changes can include corrections to older games.

## Refresh versus slate readiness

A successful generator run does not establish a valid current slate. It supplies no salaries, verified DK slot eligibility, starting-goalie probability, injuries, line/PP assignments, ownership or contest simulations. SH points, shootout goals and absent goalie offensive stats remain unobserved; outputs are partial DK scores. The existing app supports separately timestamped overrides. Prior means and historical quantiles are not guaranteed forecasts.

The browser displays the recipe and exports the bundled CSV; it does not run Node, fetch new history or save accounts. An authorized local AI assistant can execute this documented command and inspect the audit. No working cloud refresh API is advertised. The historical baseline and this recipe are live on the NHL DFS page following the approved deployment of PR #243. Refreshes are manual: run the command locally, review the generated audit and comparisons, then publish accepted changes through a separately reviewed code/data update.

Source attribution and statistical details: [NHL methodology](nhl-preview.md). Data publication follows the documented SportsDataverse CC BY 4.0 attribution route; raw run directories are not committed or republished.
