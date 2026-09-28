---
as_of: 2026-09-28
source: nflverse/nfl4th, nflverse/nflfastR, nflverse/fastrmodels; ESPN public play-by-play; nflverse schedules
---

# Fourth Down Lab

Data Dawgs' browser port of the open nfl4th decision model behind Ben Baldwin's
fourth-down bot. The calculator compares expected win probabilities for going,
attempting a field goal, and punting, averaging the modeled outcomes of each.
The recommendation's edge is measured in **percentage points** over the next-best
available choice. Decision cost compares the coach's choice with the best modeled
option before the play; the play's result does not determine its decision quality.

The conversion and field-goal sliders reweight the modeled win probabilities
conditional on success and failure. Each conditional outcome mix stays fixed.
The recommendation, outcome cards, win-probability chart, and copy/share actions
all use the selected scenario, clearly labelled separately from the model baseline.
Each available alternative has its own break-even line; unattainable thresholds
are stated explicitly. Changing FG probability changes the conversion threshold,
and vice versa. This does not retrain the model or predict a different play call.

## Comparable team history

`/data/fourth-down-rates.json` contains completed regular-season games from the
current and two previous seasons. The daily 12:23 UTC refresh replaces current
season counts; prior seasons are frozen unless explicitly rebuilt. Every season
has its source URL/hash, through date and completed game IDs. No-play penalties,
kneels, spikes and overtime are excluded. Fourth-down attempts require nflverse's
converted/failed flags. Field goals include made, missed and blocked attempts.

Conversion comparisons match yards to go (1–10 exactly; 11+ pooled) and field zone
(opponent 1–20, opponent 21–50, own territory). FG comparisons match a ten-yard
kick-distance band and open/closed roof. Retractable scenarios use closed-roof
history; actual games use the recorded open/closed roof. There is no adjustment
for opponent, play call, personnel or selection into attempting fourth downs.
The current snapshot includes later plays when exploring historical decisions;
it is not a pre-play backtest.

For each team with attempts, the descriptive estimate is
`(successes + 20 × other-teams' pooled rate) / (attempts + 20)`.
Twenty prior attempts is an explicit smoothing choice, not a fitted parameter.
The model default stays unchanged; applying a historical estimate is a user
scenario. Raw rates and counts are shown alongside smoothed estimates. A team
with no comparable attempts has no displayed estimate. The median is the
unweighted median across smoothed team rates with observations. Each distribution
dot is one such team, not an uncertainty sample from nfl4th. Wilson 95% intervals
refer to raw observed historical rates, not this play's conversion probability.
The percentile curve is the empirical cumulative distribution: the share of
comparison rates at or below each rate, including ties. It overlays each available
break-even threshold, the model rate, sample median and selected-team estimate.
The default compares the 32 observed smoothed team estimates; an alternate view
compares raw team-season rates with a selectable minimum of 1, 5 (default), or 10
attempts. Current seasons are partial. The sample changes when the minimum changes.
Rates below/above the entire sample are labelled outside its observed range; no
parametric tail or precise latent offense-strength percentile is fabricated.

Small samples, roster turnover and different attempted-play mixes limit these
comparisons. They are not independently calibrated team-specific forecasts.

## Inputs and assumptions

NFL regulation only: quarter, clock, field position, yards to go, score difference,
timeouts, home team, opening receiver, pregame spread/total, and roof. The browser
uses the same pinned trained models for every scenario. Team labels describe the
situation; they do not add team-specific injuries, personnel, or kicker skill.
There is no wind input. Inches and a long one yard are both entered as one yard.

The default preserves the upstream 25-yard post-score kickoff assumption to
reproduce the bot. The optional 35-yard spot is a user scenario, not a prediction
of the actual return. A play consumes six seconds. Optional additional runoff
applies to successful non-touchdown conversions. Late-game outcomes are sensitive
to those assumptions, timeouts, and whether a conversion allows kneeling.
At zero game time this port explicitly uses 1/0 for a lead/deficit and 0.5 for a
tie. No overtime model is supplied. Boundary clock cases can differ from upstream.

The field-goal model supplies make probability by distance and roof, including
the upstream linear extension for very long kicks. Attempts of 71+ yards are
excluded. The punt model has no estimates inside the opponent's 31. Missing
choices are unavailable, never zero-percent win probabilities.

## Weekly snapshot

ESPN supplies play identity, pre-play score, clock, field position, possession,
timeouts and the observed coach choice. nflverse schedules supply pregame lines,
venue roof and game IDs. The latest current regular-season week is refreshed by
a best-effort GitHub Actions schedule every 15 minutes during September–February
on game days. The page checks that snapshot every minute while visible; it does
not fetch live play-by-play directly. Use the overall **and per-game** capture times.

Failed game refreshes preserve prior dated rows and publish an error. A failed
whole refresh cannot erase the snapshot. No-plays, non-decisions, overtime and
fourth-quarter decisions with fewer than 15 seconds left are excluded, following
the source bot's weekly scope. Penalties and unusual feed representations may
still require review. Model-input errors remain visible as unavailable rows.
There is no push notification or social auto-posting service.

## Provenance and validation

Exported September 28, 2026; export date is not a model training date. MIT-licensed
sources and full copyright notices are in `/assets/fourth-down/LICENSES.txt`.
Exact source commits, artifact hashes, reproducible export instructions and
implementation notes are in the repository's `docs/fourth-down.md`.

Eight situations were checked against the published rbsdm weekly bot, including
the Browns' fourth-and-one at the Carolina 15, leading 21–18 with 1:05 left on
September 27, 2026: **94.0% go, 89.6% field goal, +4.4 percentage points**.
All eight match at the source display's one-decimal precision. This checks the
port, not predictive calibration. Data Dawgs has not independently calibrated or
prospectively graded this model. Tier: **Pup**.

- https://www.nfl4th.com/
- https://github.com/nflverse/nfl4th
- https://github.com/nflverse/nflfastR
- https://github.com/nflverse/fastrmodels
- https://rbsdm.com/stats/fourth_weekly/
- https://github.com/nflverse/nfldata/blob/master/data/games.csv

Scenario calculations stay in the browser. Dated public snapshots are available
at `/data/fourth-down.json`. There is no fourth-down MCP tool or REST calculator.
