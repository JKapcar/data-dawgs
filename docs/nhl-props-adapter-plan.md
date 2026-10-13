# Optional NHL props adapter — design only

Historical event rates remain the default. The user supplied a Google Sheet described as FanDuel NHL props; a separate read-only research task is verifying its actual contents. This document does not claim that the sheet has paired odds, complete markets, reliable timestamps, or usable historical coverage. No sheet ingestion or prop-derived projection is implemented in this preview.

## Reported workbook inspection (October 13, 2026)

The parent research task reports `fd_nhl_props_2026-10-13.xlsx`, with Summary, All Props and 16 matchup sheets. The workbook claims an Ohio capture at 13:50:44 EDT and source `sbapi.oh.sportsbook.fanduel.com`; this is workbook-provided provenance, not independently verified live-feed freshness.

Of 11,339 rows, the researcher identified 251 paired over/under markets: 128 shots-on-goal, 110 goals and 13 goalie saves. Assists and points are Yes-only milestones, not clean two-sided markets. There are no block or power-play-point markets. The export lacks NHL/event/market/selection IDs, a team column, per-row source URLs and collection logs. Another 165 rows labeled Player Shots on Goal are Yes-only specials, including multi-player combinations and team shots.

Importer consequence: validate **both market semantics and player identity**; a shots-on-goal label alone is insufficient. Exclude combination/team/milestone specials from single-player O/U fitting. Missing IDs/team evidence must be resolved against the exact historical/slate identity graph, never guessed from a fuzzy name. Preserve the capture claim separately from independently verified quote time. Exact column names and sample fits remain pending, so no blind workbook acceptance is implemented.

The eventual mode must be labeled **partial market-informed projection**: fitted eligible markets can supply individual event components under a named distribution assumption, with historical components retained for absent categories. Preserve each component's origin and fit diagnostics. Any blend of a fitted and historical estimate needs explicit, versioned weights validated out of time; paired prices do not justify a complete projection or calibrated variance on their own.

## Normalized private evidence

An adapter should emit one record per *paired* market:

```json
{
  "version": 1,
  "player": {"nhlId": null, "platformId": null, "name": "", "team": ""},
  "event": "sog",
  "gameId": "",
  "platform": "fd",
  "line": null,
  "overPrice": null,
  "underPrice": null,
  "oddsFormat": "american",
  "bookmaker": "",
  "marketId": "",
  "sourceUrl": "",
  "sourceRow": "",
  "observedAt": null,
  "quotedAt": null,
  "settlement": {"overtimeIncluded": null, "pushRule": null},
  "distribution": {"family": null, "dispersionSource": null},
  "sourceStatus": "unverified"
}
```

Player identity, opponent/game, market type, threshold, book, settlement convention and timestamp must agree before prices are paired. Missing sides remain null. A fetch/import timestamp is `observedAt`, not `quotedAt`; it does not prove freshness. Duplicate/conflicting rows are rejected or explicitly resolved. Data as-of and source retention rules are independent of the fantasy slate's lock.

## Probability and distribution are separate steps

Convert both side prices to implied probabilities. An optional proportional de-vig assumption gives `pOver = qOver / (qOver + qUnder)`; preserve the raw prices, raw implied probabilities, overround and chosen method. Alternative vig allocation methods require separate labels. Never manufacture the missing opposite price.

The line itself is a threshold, not an expected event count. Under an explicitly chosen Poisson model and a half-integer threshold, solve `P(X > line | lambda) = pOver` numerically for lambda. Reject integer-line markets until push treatment is modeled. One market probability does not identify a general distribution's mean and variance.

Season-long variance cannot simply be added to a market-implied mean. A negative-binomial option could use a prior estimate of count dispersion from strictly pre-as-of games, conditioned on comparable role/minutes and appearance, then solve for the mean with that dispersion held fixed. Require sample size, role drift diagnostics, shrinkage, and out-of-time calibration. Use Poisson only as a visible assumption, not a fact. Underdispersion, zero inflation, scratches and goalie start uncertainty need explicit treatment.

Compute fantasy event means and bonus threshold probabilities from the same distribution. Retain separate playing/start probabilities. Total fantasy-point variance also needs event covariance (goals/shots, goals/assists, goalie saves/goals allowed); summing marginal variances or inventing independent ceilings is insufficient.

## Integration and gates

Keep the one DFS CSV as the slate/player/salary pool. A single advanced source disclosure can attach validated prop evidence to exact identities and games, compare historical versus market-derived components, and show unresolved coverage. Do not silently blend; an explicit versioned method must define weights, missing-market fallback and staleness handling. Store evidence and assumptions in the existing private NHL draft after extending its strict validator; preserve source time and revision semantics. No new grant or unauthenticated endpoint is needed.

Before enabling: verify the sheet schema and permissions; test paired-price conversions, missing sides, duplicates, pushes, impossible distributions, identity conflicts, quote timestamps and as-of cutoffs; then run chronological holdouts against the historical baseline. Unknown ownership stays unknown. This adapter does not create a field model, contest simulator, betting recommendation or contest entry.
