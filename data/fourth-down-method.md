---
as_of: 2026-10-10
source: nflverse/nfl4th, nflverse/nflfastR, nflverse/fastrmodels; ESPN public play-by-play; nflverse schedules; nflverse play-by-play 2016-2025
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

## Goal lens

The calculator's recommendation maximises win probability and nothing else. The
goal lens scores the **same outcome lots** (each modelled result of each choice,
with its probability, the win probability after it and the clock left) against a
different objective. It changes no probability and no win probability, and it is
never the recommendation.

Every time-based goal reduces to one function: the expected share of the next
H seconds with win probability above a line x, starting from win probability p
with T seconds left. The time-average of any u(WP) is u(0) plus the integral of
u'(x) times that share, so a new goal is a new u, not a new model.

| Goal | What is scored | Unit |
|---|---|---|
| Win the game | win probability after each outcome | win probability |
| Average win probability | time-average of win probability, rest of game | win probability |
| Time above a line | share of the horizon with WP above x (5–95%) | share of clock |
| Keep it a game | share of the horizon with WP between 50−w and 50+w | share of clock |
| Hate falling behind | WP change, with time below the reference counted k× (1–4) | felt points |

**Average win probability cannot change a call.** A win probability is a
forecast of the final result, so its expected value at any later moment equals
its value now, and averaging over the rest of the game returns the same number.
Checked on 955,892 play-sides, 2016–2025: within each tenth of starting win
probability, the realised time-average of win probability over the rest of the
game was within 0.4 points of the starting value. The lens shows this goal with
the standard numbers and says so.

**The path is modelled.** nfl4th prices one play; it does not say how win
probability travels afterwards. `/data/fourth-down-paths.json` holds a diffusion
in probit space on a measured information clock V(t), the share of the game's
remaining uncertainty still unresolved with t seconds left:
WP at clock b given p at clock a is `Φ(Φ⁻¹(p)·√(V(a)/V(b)) + √(V(a)/V(b) − 1)·Z)`.
It is a martingale by construction. V was fitted to nflfastR spread-adjusted home
win probability in 1,906 games from 2016–2022 and every error below is from the
855 games of 2023–2025, which the fit never saw:

- Clock shares miss by 1.0 points (RMSE) outside the final 30 seconds; the
  median cell misses by 0.6, the 99th percentile by 7.6, the worst by 8.9.
- Inside the final 30 seconds the miss is 9.9 points. **The lens does not answer
  there.**
- On fourth downs from the offence's side, outside that window: 1.2 points.
- Shorter horizons, never used in the fit: 1.2 points over the next five
  minutes, 1.1 over the next fifteen.
- A plain random walk (V linear in the clock) misses by 4.2 points; a
  one-parameter power clock by 2.0.

The measured clock is not linear: 7% of the game's uncertainty is still
unresolved with 15 seconds left and 21% with five minutes left. The published
file carries the knots, a 70-cell observed-versus-modelled calibration table,
per-season source hashes and reference integrals the browser is tested against.

Limits. The path model was fitted to nflfastR's win probability, not the nfl4th
blend the calculator uses for outcomes. It sees only win probability and the
clock, not possession, field position or timeouts, so it describes typical
paths, not this game's. Regulation only. A lens edge smaller than the 1.0-point
held-out error is shown as too close to call, not as a winner. Horizon "the
moment after this play" uses no path model: it is the chance the play itself
leaves win probability on the right side of the line. Clock shares are weighted
by the seconds each outcome leaves, so an outcome that ends the game adds no
time. "Hate falling behind" measures drops against the win probability of the
best available call; its multiplier is the reader's assumption, not a measured
preference. Touchdown outcomes keep nfl4th's extra-point or two-point choice.

Nothing here estimates what coaches or fans actually optimise: no goal is fitted
to observed decisions. Score-based goals (margin, cover) are not offered because
there is no score-path model. The lens has not been prospectively graded.
Rebuild with `python tools/fourth-down-paths.py`; it is not on a schedule.

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

Scenario and goal-lens calculations stay in the browser. Dated public snapshots
are available at `/data/fourth-down.json`; the path model at
`/data/fourth-down-paths.json`. There is no fourth-down MCP tool or REST calculator.
