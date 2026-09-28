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

The conversion slider reweights the modeled win probabilities conditional on
success and failure. It holds each conditional outcome mix fixed. It does not
retrain the model or predict a different play call.

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
