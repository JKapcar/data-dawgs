# Last Dawg Standing weekly engine

Default dashboard: `guillotine.html`. Existing account shelves, historical scores and legacy tools remain at `guillotine.html?view=history`. Only one mode executes. Weekly Sleeper roster/user/transaction reads stay in the browser. No ownership identities, names or rosters are published in the daily feed or receipts.

## Calculations

- Expected player points are weekly raw Sleeper projected statistics multiplied by DawgPound Royale's actual scoring settings. Fantasy-position eligibility handles multi-position players, including Travis Hunter. Missing projections fail closed; observed zero is valid. Out/IR/PUP/suspended/inactive and byes score zero. Questionable is not assigned an invented availability probability.
- Player score deviations use historical residual RMS by position and weekly projected-point bucket, with 40 observations of shrinkage toward the position pool. Residuals are normal with an estimated, nonnegative same-NFL-team common factor capped at 0.25. Historical projections can have postgame revisions; this is descriptive uncertainty, not a clean backtest. Opponent/negative teammate correlation and injury probabilities are omitted.
- Weekly survival uses 3,000 deterministic joint player draws against current opponent starters. One team is chopped per draw. Week 1 ties chop the better draft position; later ties use cumulative season points. Unresolved ties split probability. The optimizer evaluates legal combinations with fixed kickoff locks; search limits are exposed. If no complete lineup exists, an expected-points partial lineup with explicit empty slots is evaluated, not called a complete legal lineup.
- Waivers compare acquisition lineups against the optimized current roster. All available positive-projection players are screened by expected-lineup fit; up to 40 are simulated. Each returned row is a separate one-add alternative. Drop choices favor this week, not future player value. Budget ceiling = chosen fraction of remaining FAAB times the fraction of baseline chop risk removed, bounded by the chosen cycle cap. This is a budgeting heuristic, not a price. Own-league completed same-position winners produce a descriptive IQR after five observations; losing bids are unobservable. Case's linked 2025 season (17 teams, full PPR) is a separately labeled stage reference, never silently pooled with the current room.
- Season outlook repeats current weekly player strength and injuries, applies future scheduled byes, and selects expected-points lineups with explicit zero-point holes. One team is removed per week, at most Week 18. It is a fixed-roster scenario, not a forecast of future waivers or a calibrated championship probability.

## Operations

`guillotine-refresh.yml` runs daily at 14:15 UTC, plus manual dispatch. It collects weekly projections, checks the Case history reference, captures/grades receipts, regenerates the manifest, validates, commits, and requests Pages publication. Failed input refreshes do not publish partial data. The browser refuses feeds over 48 hours old or for the wrong week/scoring. Roster changes require dashboard refresh; player inputs remain the dated daily snapshot.

`guillotine-receipts.cjs` captures 10,000-draw current-starter forecasts only within 24 hours before the first kickoff. No missed prediction is backfilled. Publication has a second pre-kickoff gate immediately before each automated push. Grades require the NFL week to advance, all recorded roster scores, and at least 12 hours after the last kickoff. Completed grades are immutable. Multiclass Brier is the sum of squared chop-probability errors; it is not a claimed edge over a benchmark. Initial tier remains Labs, unvalidated.

## Verification

`node --test tests/guillotine-weekly.test.cjs` covers scoring, position eligibility, unique assignments, locks, incomplete lineups, conservation of one chop, missing data, FAAB zero budgets, prospective deadlines and grading. Existing historical tools retain their 136 checks and 21 valuation checks. `node tools/validate-data.js`, service-worker verification, and concurrent publication recovery remain release gates.
