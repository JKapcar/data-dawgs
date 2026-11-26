# The model

How a game forecast is made, from games in to the row `daily` stores.

The published win chance, margin, and total are the model's own. Team
ratings and the published forecast use only the model.

## Overview

```
completed games (ESPN) + MLB/NHL starter edge (earlier games only)
        │
        ▼
time-decay window ──► Stan Bradley-Terry fit ──► team ratings (logit)
        │                     │     eta includes starter_coef * starter_edge
        │                     │     MLB margin uses home_margin, not home_adv
        │                     └─► posterior win chance p_logit
        ▼
team stats + hybrid regressions ──► expected margin, total, team totals
        │                            (not shifted by the starter coefficient)
        ▼
player-level adjustment, all leagues (win chance, margin, total)
        │
dynamic Bayesian Elo stack: p_model = (1 - w) p_logit + w p_elo
        │   (stored in forecast_snapshots / upcoming_forecasts)
        ▼
published number = that model forecast (chance, margin, total)
The published number is the model's own. A lock 10 min before start records it.
```

The published team rating is always the Bradley-Terry **logit
rating**. The starter covariate changes those ratings, because it is inside
the fit. Elo and the player adjustment change game chances, not the stored
team rating. Nothing else changes the stored team rating.

## 1. Input: the games contract

`bayesratings/games.py`, `db.read_games`. One row per game: `season`, `date`,
`home_team`, `away_team` (our `team_id` as text), `home_score`,
`away_score` (NaN = unplayed), plus `neutral` and `ending` (NHL `ot` /
`shootout`). `validate_games` enforces: both scores or neither, a team can't
play itself, exact duplicates are legal (doubleheaders). Exhibition teams and
removed / postponed games are left out. Ties count as home losses
(`home_score > away_score`).

`read_games` does not carry venue coordinates. `bayesratings/travel.py`
joins `games.venue` to `venue_coords` (loaded from
`bayesratings/data/venues.csv`) and, for each team-game, the previous
game's venue, the great-circle distance in kilometres, the time-zone
hours shifted, and days of rest. The NBA and NHL player training frames
(`nba_player.build_feature_frame`, `nhl_player.games_frame`) carry the
home and away copies: `h_prev_venue`, `a_prev_venue`, `h_travel_km`,
`a_travel_km`, `h_tz_shift_hours`, `a_tz_shift_hours`, `h_rest_days`,
`a_rest_days`. `travel.team_games` is the same row for every league, for
a later team-model join. None of these columns is an input to the logit,
the Elo fit, the hybrid regressions, or a player ridge. `h_rest` /
`a_rest` are unchanged.

## 2. Time decay

`bayesratings/weights.py`. Each game's weight is `0.5 ** (age_days /
half_life)`, age measured from the newest game.

| League | Half-life | Window (weight ≥ 0.05) |
|---|---|---|
| NBA | **90 days** | about 1.1 years |
| MLB, NFL, NHL | **180 days** | about 2.1 years |

There is no season switch: last season fades through the new one. NHL
overtime and shootout results count fully on the win/loss term (the same
as regulation). The margin term is not scaled by the result weight either
way. MLB, NFL and NBA leave `ending` empty, so every result already counted
fully.

## 3. Ratings: Bayesian Bradley-Terry in Stan

`stan/bt_logit.stan`, fit by `bayesratings/ratings.py` with cmdstanpy (4
chains, 500 warmup + 1500 draws, seed 123; compiled once to `stan/bt_logit`,
gitignored). For game n:

```
base = rating[home] - rating[away]
       + b2b_home * home_b2b + b2b_away * away_b2b
       + starter_coef * starter_edge
eta  = base + home_adv * (1 - neutral)
mu   = margin_scale * (base + (1 - margin_home) * home_adv * (1 - neutral))
       + margin_home * home_margin * (1 - neutral)
target += time_weight * result_weight * bernoulli_logit(outcome | eta)
target += time_weight * normal(margin | mu, sigma_margin)
priors: rating ~ student_t(3, 0, sigma),
        sigma ~ student_t(3, 0, sigma_scale),   # sigma_scale = 0.5 for MLB and NHL, else 1
        home_adv ~ normal(0, 0.5),
        b2b_home ~ normal(0, 0.5), b2b_away ~ normal(0, 0.5),
        starter_coef ~ normal(0, 0.5),
        home_margin ~ normal(0, 10),
        margin_scale ~ normal(0, 10), sigma_margin ~ normal(0, 15)
```

`margin_home` is 1 for MLB and 0 otherwise. When it is 0, `mu` is
`margin_scale * eta`, the same shared home edge as before. When it is 1
the margin's home edge is `home_margin` in runs, and `home_adv` stays on
the win/loss term only. `home_margin` does not enter the published win
probability except through the ratings it helps estimate.

`starter_edge` is home starter team-relative quality minus away. It is
passed for MLB and NHL (`weights.use_starter`). NBA and NFL pass zeros, so
`starter_coef` stays at its prior and does not move a probability. The
formula for the edge is in section 5.

- `home_b2b` / `away_b2b` are 1 when that team played on the previous
  calendar day (the game's date column; US local / CT). Only earlier games
  count, including an earlier game on the upcoming slate that has not been
  played yet. A same-day doubleheader is not a back-to-back. NBA and NHL
  pass the flags (`weights.use_b2b`). MLB and NFL pass zeros, so those
  coefficients stay at the prior and do not move a probability. The same
  flags are applied when an upcoming game is forecast. Reference effects
  from the prior research, not used as priors: NBA home on a back-to-back
  about −0.37 logit, away on a back-to-back +0.24; NHL away on a
  back-to-back +0.35.
- MLB and NHL use a rating-scale prior of half the default (`sigma_scale`
  0.5). NBA and NFL stay at 1. The step-1 walk-forward (NBA half-life,
  back-to-back flags, full overtime weight, NHL prior) is in
  `docs/decisions/2026-11-21-model-tuneups-step1.md`. The step-2 changes
  (MLB margin home edge, in-model starter, MLB prior) are in
  `docs/decisions/2026-11-21-model-step2-starters.md`.

- The score margin shares the same latent edge, so a blowout moves a rating
  more than a one-point win; how much is learned per fit.
- Ratings are zero-centered posterior means (0 = average team). The daily job
  also stores the posterior sd and 5% / 95% quantiles (`rating_snapshots`).
- `p_logit` is the **mean over posterior draws** of `inv_logit(eta)`, not the
  logit of the mean rating.
- A divergence check runs after every fit.

## 4. Margin, totals and team totals: the hybrid layer

`team_stats.py`, `hybrid.py`, `forecast.py`, all fit on the same decay
window and weights, with the posterior-mean ratings as features.

- **Margin:** weighted OLS (`mov_fit`). `home_spread = -margin` (negative =
  home favored).
- **Expected points** per side, by league (`POINTS_MODELS` in `hybrid.py`,
  chosen by the Oct 2026 walk-forward backtest):

  | League | Points model |
  |---|---|
  | MLB | negative binomial GLM (log link, IRLS; dispersion estimated) |
  | NHL | Poisson GLM (log link) |
  | NBA, NFL | OLS, blended: `0.6 × regression + 0.4 × league_avg × OS × DS` (`w_totals = 0.6`; OS/DS = weighted offensive / defensive strength) |

- **Total** = home points + away points. **Team totals** are then reconciled
  with the margin: `home = clip((total + margin) / 2, 0, total)`, away = the
  rest.
- Neutral-site games average the game as listed with the teams swapped.
- A binomial GLM win model is still fit but is **not** the published chance.
- American odds are derived from the win chance after rounding to 4 decimals.
  Keep that order.

## 5. Starter covariate (MLB pitchers, NHL goalies)

`bayesratings/starters.py`. The quality is a covariate inside the Stan fit
(`starter_coef`, prior `normal(0, 0.5)`), not a shift applied after it.
The daily job does not call `adjust_forecast`. Replay does not join the
logs, so a rebuilt row has starter edge 0 and NULL starter audit columns.
MLB's separate margin home edge is on in a replay.

Quality uses earlier dates only. The league rate uses the same half-life,
so it is the current rate. A debut still gets the shrunk prior. A team
with no earlier start has relative quality 0. A missing side contributes 0.

- **MLB** (half-life 180 days, first pitcher listed): decayed
  `runs_allowed` and `outs`. `lg = runs / outs`.
  `rate = (sum_runs + 150 * lg * 1.08) / (sum_outs + 150)`.
  `q = (lg - rate) * 16.5` (runs saved per typical start).
- **NHL** (half-life 365 days, first goalie listed, not most time on ice):
  decayed `saves` and `shots_against`. `lg = saves / shots`.
  `sv = (saves + 1500 * (lg - 0.003)) / (shots + 1500)`.
  `q = (sv - lg) * 28`.
- **Team-relative:** `rel = q -` the team's decayed average `q` of its
  earlier starters (half-life 60 days, one weight per start).
  `starter_edge = home_rel - away_rel`.
- Completed games use the pitcher or goalie who started. An unplayed game
  uses the probable known at forecast time (`starters.SOURCES`, first match
  wins): MLB = ESPN probable (`game_probables`), else MLB Stats API slot 0
  (`mlb_lineup_states`); NHL = Daily Faceoff Confirmed / Likely
  (`nhl_goalie_states`), else ESPN probable. The 04:30 forecast uses what
  is known then (the 04:15 goalies pass feeds it).
- On an MLB game day, `prelog mlb-probables` (cron at :15 and :45,
  08:00–22:59 CT) refetches the ESPN scoreboard into `game_probables`. When
  a probable pitcher's athlete id changed, unlocked forecasts for that
  game are rewritten from `home_prob_base` and the morning mean
  `starter_coef`, then the player term and the stack are reapplied from
  the stored bases. A game inside the 5-minute lock margin, a started
  game, and any row in `forecast_locks` are left as stored.
  No MLB game is a no-op. The 07:30 check WARNs when a game within 3
  hours of first pitch has a probable missing or last seen more than
  150 minutes ago.
- The published win chance is the posterior mean of `inv_logit(eta)`, and
  eta includes the term. The hybrid spread and total are not shifted by
  `starter_coef`. They are an average-starter spread and total; the old
  outside total coefficient is not applied on top.
- Audit columns, written without a second shift: `home/away_starter_id`,
  `_src`, `_rel`, `home_prob_base` (the same posterior with the edge set
  to 0; back-to-back flags stay), `total_pred_base` (the total at that
  point, which the coefficient did not move).
- `quality()` and `COEFS` (MLB win 0.0957, total 0.2465; NHL win 0.5824,
  total 0.6386) are the old outside adjustment. `player_values.py` still
  uses them for the stored per-player value. Forecasts do not.

## 5b. Player-level adjustment (all four leagues)

`bayesratings/player_adj.py`, applied by the daily job after the rating fit
(the starter covariate is already in `p_logit`) and before the Elo stack
(not by replay). The coefficients below are the ones stored in
`player_adj.py`. Each side gets a team-relative value `x`
(positive = stronger than the team's usual players), from box lines before
the forecast day only:

| League | `x` | Who is playing (pre-game) |
|---|---|---|
| NBA | -(missing value - team's decayed average, 120-day half-life). Missing value = sum over rotation players who are out of max(Game Score per minute - replacement, 0) × expected minutes (rate decayed 180 days, shrunk with k = 1000 minutes to 0.8 × league; rotation = latest game for this team, within its last 10 games, ≥ 10 expected minutes). The team average is over earlier games' report-based missing value. | Out or Doubtful (not Questionable) on the latest official NBA injury report known at forecast time (`nba_injury_states`). No report covering the game = no adjustment. |
| NHL | Same form for skaters: (0.5 goals + 0.5 shots × league shooting %) per 60, forwards and defense separately (365 days, k = 200 minutes, replacement 0.5 × league, ≥ 8 minutes). Team average over earlier games' who-played missing value (180 days). On top of the goalie adjustment. | Daily Faceoff lines (`nhl_line_states` f1-f4, d1-d4, ≥ 15 skaters, seen within 3 days): rotation players not in them are out. Else ESPN roster (`roster_states`) Out / Injured Reserve / Suspension. Players no longer on the team's current roster are not counted. |
| NFL | Starting QB value - team's decayed average starter value (180 days). QB value = (shrunk ANY/A per dropback - league) × 34 dropbacks; ANY/A decayed 365 days, shrunk with k = 600 dropbacks toward league - 2. | Highest QB on the current depth chart (`nfl_depth_states`) who is not Out/Doubtful on that week's injury report (`nfl_injury_report_states`, only a report from the 6 days before the game), not Out/Doubtful/IR/suspended on the roster, and not on the game's inactive list (`nfl_inactives`); else last game's starter. |
| MLB | Two values. Lineup = sum over the nine of (shrunk linear-weights runs per PA - league) × slot PA (4.65 for 1st ... 3.85 for 9th); 1460 days, k = 500 PA toward 0.95 × league; minus team's decayed average (180 days). Bullpen = (league - usage-weighted shrunk relief runs per out) × 9.5 outs (365 days, k = 150 outs, usage 14-day half-life), team-relative the same way. On top of the starting pitcher. This is the current path. Section 5f replaces the published chance once both lineups are posted and both starters are known. | Posted lineup (MLB Stats API `mlb_lineup_states` slots 1-9, else ESPN `pregame_lineups`), else the team's most recent lineup. Bullpen from history only. |

Applied with the walk-forward coefficients of the latest fit (`COEFS`), per
value: `xd = x_home - x_away`, `xs = x_home + x_away`:

| League | win `b` | total `c` | margin `m` |
|---|---|---|---|
| NBA | 0.0710 | 0.1541 | 0.5558 |
| NHL | 0.0107 | 0.0058 | 0.0160 |
| NFL | 0.0212 | 0.0592 | 0.1132 |
| MLB lineup / bullpen | 0.2551 / 0.1996 | 0.5062 / 0.9310 | 0.6017 / 0.6002 |

- `total += c × xs`, `margin += m × xd`, team totals follow (as starters).
- Win: the coefficients were fit on the published chance. For NBA, NHL and
  MLB the term goes into `p_logit` before the stack, solved so the published
  chance moves by exactly `logit += b × xd`:
  `p_logit' = (sigmoid(logit(p_pub) + b × xd) - w × p_elo) / (1 - w)`, kept in
  0.0001–0.9999. On an Elo fallback (`w = 0`) it is the plain logit shift.
  For NFL the same shift is added to the blended chance,
  `sigmoid(logit(p_pub) + b × xd)`, and `p_logit` stays the team chance.
  That is the number used when the quarterback ridge does not publish.
- A side with no player information gets `x = 0`; no information for either
  side = the forecast is unchanged.
- **Intraday refresh** (`player_adj.refresh`, last job of prelog `pregame`
  every 10 minutes, and of `nbainj` after each NBA report): today's game-day
  forecasts that start more than 5 minutes later and have no forecast
  lock are recomputed from the stored pre-player values when the league's
  inputs changed (`player_inputs` fingerprint: injury report, lines, roster,
  depth chart, inactives, lineups). Only changed rows are rewritten.
  `lock_due` freezes the model's own forecast about ten minutes before the
  start (`forecast_locks`) and that row is not replaced. The refresh itself
  stops five minutes before the start (`player_adj.LOCK_MARGIN`). Upcoming (later-day)
  rows for MLB are computed at 06:00 only. NBA, NHL and NFL upcoming rows
  are refreshed with that league's player ridge (sections 5c, 5d and 5e).
- Audit columns: `home/away_player_x` (MLB: lineup), `home/away_player_x2`
  (MLB bullpen), `home/away_player_id` (NFL QB), `home/away_player_src`
  (`report`, `lines`, `roster`, `depth`, `last`, `posted`, `usual`; NULL = no
  information), `player_prob_base`, `player_spread_base`,
  `player_total_base`, `player_home_total_base`, `player_away_total_base`
  (values before the player term, after starters), `player_inputs`.
- Backtest (pooled log-loss change, negative = better): NBA -0.0096 with who
  actually played, -0.0041 (not significant) with the injury report as used
  live; NFL -0.0166; NHL -0.0011 and MLB lineup -0.0003 (not significant);
  MLB bullpen +0.0001.

MLB extra-base hits, the other box-score counts ESPN does not store, and
Statcast batted balls (`sources/mlb_box.py`, `sources/mlb_statcast.py`;
tables `mlb_box_players`, `mlb_batted_balls`, `mlb_batted_players`) are
stored and are not an input to this adjustment or to the published chance.

## 5c. NBA player ridge

`bayesratings/nba_player.py`. For NBA, the published win chance is this
ridge when it can run. It is a standalone L2 logistic regression on
player aggregates plus rest, back-to-back and neutral site. No team rating
is an input, and nothing is stacked on the ridge chance. The current NBA
path (sections 5b and 6) still runs every morning. It is what gets
published when the ridge cannot run, and it is stored on the row as
`nba_team_prob`.

| Case, at forecast time | Published home win chance | `nba_model_src` |
|---|---|---|
| Both teams have a submitted line on the latest official injury report, each side has a current-season box with minutes, and neither side puts more than 10% of its minute weight on players with no game for that team this season | Ridge B | `ridge_b` |
| Both teams have a submitted line, but a side has no current-season box or that share is above 10%, and ridge C can run | Ridge C | `ridge_c` |
| Either team is NOT YET SUBMITTED, or no report covers the game | Ridge C, both sides | `ridge_c` |
| No stored fit for that version, either team has no box score from this season or last, or the lineup above cannot be built | Current NBA path, unchanged | `team` |

The spread follows the published chance from the current path's margin, at
`margin.SLOPE` points per unit of home logit (the same rule as
`forecast.carry_margin`, applied once from the margin that path already
carries). Team totals follow the margin. The total stays the current path's
total. `home_prob` is the ridge chance rounded the same way as every other
published chance.

Features, half-lives, shrinkage, and the estimator live in `nba_player.py`:

- Per-minute rates, long form (half-life 180 days, shrunk with K = 400
  minutes toward a replacement prior) and short form (half-life 21 days,
  K = 150, shrunk toward the long rate). The twelve metrics are Game Score,
  possessions used, assists, offensive and defensive rebounds, stocks,
  turnovers, three-point attempts, free-throw attempts, points, true-shooting
  attempts and plus-minus. Replacement is 0.8 times the league rate for Game
  Score, points, assists, stocks and both rebounds, the league rate
  otherwise, and −2 per 48 for plus-minus. True shooting uses the shrinkage
  in that code: `(p + 200 × 1.12) / (2t + 200 × 2 × 0.56)`.
- Team aggregate is the minutes-weighted mean times 5 (a per-48 rate). True
  shooting is not multiplied by 5. `unknown_share` is the weight on players
  with under 300 long-form minutes. `top3_gmsc` is the top three players'
  minutes-scaled Game Score.
- The design matrix is home minus away of those aggregates, then `h_b2b`,
  `a_b2b`, `rest_d` (home rest clipped to 1–4 minus away rest clipped to
  1–4) and `neutral`. Rest is days since the previous final or scheduled
  game, missing means 7, clipped to 0–7. Back-to-back means rest = 1.
- Estimator: `StandardScaler` then
  `LogisticRegressionCV(Cs=np.logspace(-3, 1, 9), cv=5, scoring="neg_log_loss", max_iter=2000)`,
  scikit-learn 1.9.1. The scaler is fit on the full training set, as in the
  research pipeline. Stored: feature order, scaler mean and scale,
  coefficients, intercept, the chosen C, and the sklearn version.
- Training games are completed NBA games with box lines, from 2021-12-01
  through the day before the fit. Version B weights the pregame pool by
  expected minutes. A status from `nba_injury_states` whose report time is
  strictly before tip decides it: out and doubtful are left out, and
  questionable, probable and available stay in, including a player who
  recorded no minutes. A player the report does not name, and a game with
  no report before tip, keeps who played (minutes > 0). Version C weights
  the previous game's rotation by expected minutes. A player in that
  rotation but missing from the current box keeps the previous game's
  pregame row.

Live pool. Expected minutes are `0.7 × previous + 0.3 × last game`, DNP
counted as 0, 12 before a first game, and at least 1. On the live B lineup
those minutes then halve every 21 days since the player's last game (the
same window as the short-form rate), and the floor of 1 is applied after
that. A debut, or a listed starter with no box for the team, stays at 12.
The decay is live only. The stored fit is not refit, and the training rows
still use the undecayed average.

Ridge B auto-includes a player only when his latest box is still with this
team and he has a box with minutes greater than 0 for this team in the
current season (`player_game_nba`, season types 2 and 3, dated before the
slate day). A player whose last box for the team was last season, and who
has not played for it this season, stays out. Listed starters are still
added. A listed starter with no box for the team in this season or last is
weighted at 12 minutes. Out and Doubtful are removed. Questionable,
Probable and Available stay.

Each side logs the share of its minute weight on players with no game for
that team this season (`nba lineup event=… team=… no_season_share=…`).
Ridge B is published only when both sides can be built: the team has at
least one current-season box with minutes, and that share is 10% or less.
Otherwise the game uses ridge C, the previous game's rotation, with Out
and Doubtful from the open report rows for that team removed. Those rows
apply even when the team's report is not fully submitted. Questionable,
Probable and Available stay. If C cannot run, the current path is published.
Opening night, before any current-season box, takes that fallback. A side
that is mostly listed players who have not played for the team this season
does too.

Ridge C is the previous game's rotation (minutes > 0) minus anyone Out or
Doubtful on the open report rows for that team, including a report that is
not fully submitted, and it does not apply the 21-day minute decay. Rates are
decayed from `nba_player_state` to the game date. That state is replaced
each morning from box lines dated before that day, so a forecast does not
see the game it is scoring or any later one. The league prior is
recomputed each morning from those same lines. Past forecast rows and
existing locks are not rewritten when a lineup is rebuilt.

The fit is stored in `nba_ridge_fits`. Monday's daily run (04:30 CT) refits
both versions. The first run with nothing stored fits immediately. A same-day Monday rerun does not fit again once both versions are
stored for that date. A failed refit keeps the last stored fit. With no fit
stored, the current path is published.

`nba_player.refresh` runs from `player_adj.refresh` (prelog `pregame` and
`nbainj`). It rebuilds the current path, then replaces the published chance
where the ridge runs, for NBA games that have not started and are not
locked (more than 5 minutes before the start). Past `forecast_snapshots`
rows and existing locks are not read. Other leagues are unchanged.

A new lock stores whatever `home_prob` is at lock time. When the ridge ran,
that is the ridge chance. Older locks stay as recorded.

The training frame also carries the travel columns in section 1. They are
not in `feature_columns` and a missing distance does not drop a row.

## 5d. NHL player ridge

`bayesratings/nhl_player.py`. For NHL, the published win chance is this
ridge when it can run. It is a standalone L2 logistic regression on
skater and goalie aggregates plus rest, back-to-back and neutral site. No
team rating is an input, and nothing is stacked on the ridge chance. The
current NHL path (sections 5b and 6, including the in-model starting goalie)
still runs every morning. It is what gets published when the ridge cannot
run, and it is stored on the row as `nhl_team_prob`.

| Case, at forecast time | Published home win chance | `nhl_model_src` |
|---|---|---|
| Both teams have a fresh dressed chart and a Confirmed Daily Faceoff goalie | Ridge B | `ridge_b` |
| Lines or the confirmed goalie are missing, or the B fit is missing, and both teams have a previous skater box | Ridge C | `ridge_c` |
| No stored fit, either team has no skater box from this season or last, the starter is unknown, a named starter has no saved goalie line, or that version's feature row cannot be built | Current NHL path, unchanged | `team` |

A game that qualifies for B and then cannot build a finite feature row is
published on the current path. It is not switched to C. A named starter
with no row in `nhl_goalie_state` leaves the ridge the same way an unknown
starter does, and the current path is published.

The puck line follows the published chance from the current path's margin,
at `margin.SLOPE` goals per unit of home logit (the same rule as
`forecast.carry_margin`, applied once from the margin that path already
carries). Team totals follow the margin. The total stays the current path's
total. `home_prob` is the ridge chance rounded the same way as every other
published chance.

Features, half-lives, shrinkage, and the estimator live in `nhl_player.py`, for
the version that produced the reported result (B) and the no-lineup version
(C). Version A (actual minutes and the actual starter) is built in the
feature frame so the parity test can see it. It is not fit and not published.

- Skater rates are per 60 minutes: goals, assists, shots, missed shots,
  plus-minus, takeaways minus giveaways, blocks, hits, faceoffs won and
  faceoffs lost. Long form: 365-day half-life, shrunk with K = 300 minutes.
  Replacement is 0.8 times the league rate for goals, assists and shots, the
  league rate otherwise, and −0.1 per 60 for plus-minus. Short form, for
  points, shots and plus-minus: 30-day half-life, K = 100, shrunk toward the
  league points rate, the league shot rate, and 0.
- A team aggregate rescales the expected minutes to 300 skater-minutes.
  Each rate is that weighted sum divided by 60. Forward and defense
  plus-minus are kept separate (`pm_F`, `pm_D`). `unknown` is the share of
  those minutes on skaters with under 200 long-form minutes.
- The goalie feature is goals saved above average per 30 shots: save rate
  versus the league, 365-day half-life, shrunk with K = 1500 shots toward
  the league save rate minus 0.003. `gexp` is the log of one plus the
  decayed shots faced. There is no expected-goals term.
- Expected time on ice is the exponential average of minutes (alpha 0.3).
  With no earlier game it is the position median (defense and forward
  separately). The live score uses the morning's post-game average, decayed
  to the game date, and the group median when the skater has no state.
- The design matrix is home minus away of those aggregates, then `h_b2b`,
  `a_b2b`, `rest_d` (home rest clipped to 1–4 minus away rest clipped to
  1–4) and `neutral`. Rest is days since the previous final or scheduled
  game, missing means 7, clipped to 0–14. Back-to-back means rest = 1.
  Ties are left out of the training rows.
- Estimator: `StandardScaler` then
  `LogisticRegressionCV(Cs=np.logspace(-3, 1, 9), cv=5, scoring="neg_log_loss", max_iter=3000)`,
  scikit-learn 1.9.1. The scaler is fit on the full training set, as in the
  research pipeline. Stored: feature order, scaler mean and scale,
  coefficients, intercept, the chosen C, and the sklearn version.
- Training games are completed non-tie NHL games with box lines, from
  2021-12-01 through the day before the fit. Version B weights the skaters
  who played by their pregame expected minutes and uses the starter (most
  time on ice). Version C weights the previous game's skaters by expected
  minutes. A skater from that game who did not play this one keeps the
  previous game's pregame row, and the goalie is the one with the most
  starts in the previous 10 (a tie takes the smaller athlete id), with his
  state as of that earlier row. The live score decays the morning's
  post-game sums to the forecast date instead. The coefficients stay the
  ones fit on the training rows.

Live pool. Ridge B requires both teams. A dressed chart is Daily Faceoff
groups `f1`–`f4` and `d1`–`d4`, injury status other than out, an ESPN
athlete id, at least 15 distinct skaters, and `last_seen` within 36 hours.
A confirmed goalie is the goalie `starters.known_starters` would name from
Daily Faceoff, whose open `nhl_goalie_states` row has strength `Confirmed`
for that same athlete, also within 36 hours. Likely, Unconfirmed and an
ESPN probable are not confirmed. A skater with a box keeps that position;
a skater with no box takes the chart (a `d` group is defense). The B gate
is unchanged: both teams need that chart and a Confirmed goalie.

Ridge C runs when that gate fails and both teams have a previous skater
box. Its skaters are separate from the goalie. When a team's chart is
fresh (`last_seen` within the same 36 hours), C uses today's even-strength
skaters and drops anyone who will not dress: injury status out, the same
rule as B, plus IR, injured, LTIR, injured reserve, suspension and
scratched, and anyone on the IR group. The chart can be shorter than B's
15 skaters. Daily Faceoff's `gtd` flag is stored and is not a scratch; B
does not read it, and C does not drop a game-time decision either. When
the chart is missing or older than 36 hours, C uses the previous game's
skaters with time on ice and still removes anyone that chart lists as out
or injured. Position is the box `is_d` when the skater has a box,
otherwise the chart `d1`–`d4` groups, the same rule as B.

The C goalie is `expected_goalie`: Daily Faceoff Confirmed, then Likely,
then the ESPN probable, then the most-used goalie in the previous 10
starts (a tie takes the smaller athlete id). That is the team-model
starter order, plus the old most-used fallback. A candidate the line chart
lists for another team is skipped. When this team has a goalie listing
(the chart's goalie rows, or the open Daily Faceoff goalie rows when the
chart has none), a goalie who is not on it is skipped. With no listing, a
goalie whose latest appearance is for another team is skipped. The source
(`confirmed`, `likely`, `espn`, `most_used`) is stored on `nhl_inputs`.
When that starter has no saved goalie line, and when no starter qualifies,
the ridge steps aside and the current path is published. The C
coefficients are unchanged.

Rates come from `nhl_player_state` and `nhl_goalie_state`, replaced each
morning from box lines dated before that day. The league prior and the
position medians are recomputed each morning from those same lines.

The fit is stored in `nhl_ridge_fits`. Monday's daily run (04:30 CT) refits
both versions. The first run with nothing stored fits immediately. A same-day Monday rerun does not fit again once both versions are
stored for that date. A failed refit keeps the last stored fit. With no fit
stored, the current path is published.

`nhl_player.refresh` runs from `player_adj.refresh` (prelog `pregame`, and
`nhl-slate` after the Daily Faceoff pass). It rebuilds the current path,
then replaces the published chance where the ridge runs, for NHL games that
have not started and are not locked (more than 5 minutes before the start).
Past `forecast_snapshots` rows and existing locks are not read. Other
leagues are unchanged.

The chart and the goalie feed come from `sources/dfo.py`. The existing
goalie times and the 16:10 lines pass stay. On an NHL game day, `slate_pass`
(`prelog nhl-slate`) refetches a feed whose newest row is older than 45
minutes: 03:50 CT, so the 04:30 forecast can see the lines, and every 30
minutes from 08:00 to 22:59 CT. Pages stay 3 seconds apart, robots.txt is
checked, and the User-Agent identifies this checkout. A failure is logged and
the forecast keeps ridge C, or the current path when C cannot run.

A new lock stores whatever `home_prob` is at lock time. When the ridge ran,
that is the ridge chance. Older locks stay as recorded.

Shot location and a separate logistic expected-goals model
(`sources/nhl_pbp.py`, tables `nhl_shots`, `nhl_player_xg`, `nhl_xg_model`)
are stored and are not an input to this ridge or to the published chance.

The training frame also carries the travel columns in section 1. They are
not in `feature_columns` and a missing distance does not drop a row.

## 5e. NFL quarterback ridge

`bayesratings/nfl_player.py`. For NFL, the published win chance is this
ridge when both starters are confirmed. It is an L2 logistic regression on
the logit of the team chance plus the confirmed starter's pre-game EPA per
dropback, completion percentage over expected, and log experience, and
whether that starter differs from the previous game's starter. The current
NFL path (section 5b) still runs every morning. It is what gets published
when the ridge cannot run, and it is stored on the row as `nfl_team_prob`.

| Case, at forecast time | Published home win chance | `nfl_model_src` |
|---|---|---|
| Both teams have a confirmed starter, a stored fit of at least 2,000 games, and play-by-play state | The quarterback ridge | `ridge_qb` |
| Either starter is not confirmed, the fit has fewer than 2,000 games, the fit or the play-by-play is missing, or the team chance to stack on is missing | Current NFL path, unchanged | `team` |

The previous game's starter is not a confirmed starter and is not a fallback.
A depth-chart quarterback who is not ruled out is confirmed. A posted starter
on the posted lineup comes first, then a scoreboard probable, then that depth-chart
quarterback. The ESPN athlete is joined to the nflverse id from the weekly
roster or the id map. An athlete with no nflverse id publishes the current
path. An id with no dropback history is the replacement level, and the ridge
still runs.

The spread follows the published chance from the current path's margin, at
`margin.SLOPE` points per unit of home logit (the same rule as
`forecast.carry_margin`, applied once from the margin that path already
carries). Team totals follow the margin. The total stays the current path's
total. `home_prob` is the ridge chance rounded the same way as every other
published chance.

Features and the estimator live in `nfl_player.py`, the `ridge_stack_qbA`
variant.

- Dropbacks are plays with `qb_dropback` of 1, excluding kickoffs, punts,
  field goals and extra points. EPA is the sum. Completion percentage over
  expected is summed with a missing value as 0 in the numerator and left out
  of the count. The quarterback is the passer, or the rusher when the passer
  is missing.
- EPA per dropback: 365-day half-life, shrunk with K = 250 toward the league
  rate minus 0.10. Completion percentage over expected: 365-day half-life,
  K = 300, shrunk toward −2. Experience is the log of one plus the decayed
  dropback count. Rates use strictly earlier games. The league rate is the
  EPA per dropback on the scored games through the day before the fit.
- On a completed game the feature is that game's pre-game rate. On a game
  still to be played it is the last game's pre-game rate updated with that
  game's dropbacks, with the gap's decay left off, and the completion rate
  left at the last game's pre-game rate. A quarterback with no earlier
  dropback is the replacement level.
- The team chance in the logit is `player_prob_base` when that row has one.
  A stored row that this ridge did not replace, and whose stored home chance
  is still the team chance, uses that stored home chance. Ties are left out.
  Training games are completed non-tie regular-season and postseason games
  from the 2007 season on, through the day before the fit. From 2025-09-04
  on, the team chance is the game-day snapshot. Earlier games use
  `nfl_team_chance_hist` when no snapshot is stored (a walk-forward MAP
  replay of the team logit, `nfl_team_hist.py`, fit on earlier games only).
  The starter is the quarterback who played, unless an open nflverse injury row lists him out or doubtful.
  Then the side uses the previous game's starter, when that quarterback is
  not himself out or doubtful. With no report, or when the previous starter
  is also ruled out, the quarterback who played stays. The previous starter
  is the starter of that franchise's previous scored game, home or away. A
  missing previous starter is not a change. Oakland and Las Vegas, San Diego
  and the Chargers, St. Louis and the Rams, and the two Washington
  abbreviations share a franchise. The live confirmed starter is unchanged.
- The design matrix, in order, is `lt`, `qbA_epa_d`, `qbA_cpoe_d`,
  `qbA_exp_d`, `chg_d`: the logit of the team chance clipped to
  [0.0001, 0.9999], then home minus away for the three quarterback features,
  then home changed minus away changed.
- Estimator: `StandardScaler` then
  `LogisticRegressionCV(Cs=np.logspace(-3, 1, 9), cv=5, scoring="neg_log_loss", max_iter=3000)`.
  The scaler is fit on the full training set, as in the research pipeline.
  Stored: feature order, scaler mean and scale, coefficients, intercept, the
  chosen C, and the sklearn version. Version label `qbA`.

The fit is stored in `nfl_ridge_fits`. Quarterback state is replaced every
morning in `nfl_qb_state` from play-by-play dated before that day, and again
when the 04:00 CT play-by-play pass loads newly completed games.
`nfl_schedule` holds the starter and the ESPN event id from the nflverse
schedule. That file also has spread, total, and moneyline columns. This
package does not store them. A contributor can add them. `nfl_pbp_qb` holds
one row per quarterback per game.
Tuesday's daily run
(04:30 CT) refits. The first run with nothing stored fits immediately. A same-day Tuesday rerun does not fit again once version `qbA` is
stored for that date. Monday's 04:30 run does not refit. The 04:00 CT
`nfl-pbp` pass refits, rebuilds quarterback state, and refreshes unlocked
NFL forecasts when it loaded newly completed games. A failed refit keeps the
last stored fit and the state rebuild still runs. With no fit stored, fewer
than 10 training games, or a stored fit of fewer than 2,000 games, the
current path is published. Each forecast row's `nfl_inputs` records `n` (the
stored fit's `n_games`) and `c` (the chosen C). The refit prints `n`, `C`
and the coefficients.

`nfl_player.refresh` runs from `player_adj.refresh` (prelog `pregame`). It
rebuilds the current path, then replaces the published chance where both
starters are confirmed and the stored fit has at least 2,000 games, for NFL games that have not started and are not
locked (more than 5 minutes before the start). Past `forecast_snapshots`
rows and existing locks are not read. Other leagues are unchanged.

Play-by-play is `sources/nfl_pbp.py`. The current season and the schedule
are fetched at 04:00 CT (`prelog nfl-pbp`), from the public nflverse release
files, with a gap between requests, robots.txt checked, and a content hash
so an unchanged season is not rewritten. A failed download or an unreadable
file leaves that season's rows in place. A current-season file that is not
published yet is skipped. History from 2006 is a one-time backfill, not a
cron job. The schedule file's spread, total, and moneyline columns are not
stored. A contributor can add them.

Which quarterback was used is stored on the forecast row (`nfl_inputs`):
the ESPN athlete id and the source (`lineup`, `probable` or `depth`) for
each side, plus `n` and `c` from the stored fit.

The 07:30 CT check WARNs, and names the game, when an unplayed NFL forecast's
ridge chance differs from the team chance by more than 10 points or the two
disagree on the favorite.

A new lock stores whatever `home_prob` is at lock time. When the ridge ran,
that is the ridge chance. Older locks stay as recorded. New locks keep
`source = "model"`.

## 5f. MLB player stack

`bayesratings/mlb_player.py`. For MLB, the published win chance is stack B
when both posted lineups and both starters are known. It is an L2 logistic
regression on the logit of the production team+starter win probability plus
the lineup, the platoon against the opposing starter's hand, the starting
pitcher, and the bullpen. The team+starter probability is `player_prob_base`:
the rating model's win chance with the starter in the fit, rating prior
scale 0.5, before the player term in section 5b and before the Elo stack.
The reference fit used a 0.40 prior. This module does not refit that rating
model. The fitted variant is stack B, in `mlb_player.py`.

Rates use strictly earlier games, time-decayed and shrunk the same way as
that recipe. Lineup batting is wOBA, walk, strikeout and home-run rates,
contact rate, barrel rate and hard-hit rate. The starter is a FIP-like rate,
strikeout minus walk rate, contact allowed, and expected outs. The bullpen
is reliever quality and pitches over the previous 14, 3 and 1 days, not
including the game date. The current path in sections 5 and 5b still runs
every morning. It is what gets published when the stack cannot run, and it
is stored on the row as `mlb_team_prob`.

| Case, at forecast time | Published home win chance | `mlb_model_src` |
|---|---|---|
| Both lineups posted, both starters known, a stored fit of at least 2,000 games whose in-sample predicted probabilities keep at least 0.6 of the team-probability spread and whose mean is within 0.03 of the home win rate, and a team+starter probability to stack on | Stack B | `stack_b` |
| A lineup or a starter is missing, the fit has fewer than 2,000 games, the predicted probabilities are squeezed, the mean sits more than 0.03 from the home win rate, the fit or the player state is missing, or a feature is missing | Current MLB path, unchanged | `team` |

The spread follows that chance from the current path's margin, at
`margin.SLOPE["mlb"]` points per unit of home logit, with the
same favorite check as `forecast.carry_margin`. Team totals follow. The
total stays the current path's total. Nothing else is stacked on this

Training games are completed non-tie regular-season and postseason games
from 2022 on that have a production team+starter probability. The game-day
snapshot wins (`forecast_snapshots.player_prob_base`, or `home_prob` when
that row was not an Elo blend and was not already stack B). Games without
one use `mlb_team_chance_hist`. Counting stats before 2022 still feed the
rates. A row this stack already replaced is not reused as a team
probability. The history table is a training input only. The live forecast
does not read it.

`mlb_team_chance_hist` is a walk-forward replay of this same probability
(rating prior scale 0.5, starter in the model, margin home edge) for every
completed game from 2022 on. Each game day is fit on games and starts dated
before that day. A day that already has the probability on its game-day
snapshot is copied and not fit again. A rating snapshot stores
posterior-mean ratings, not the posterior win chance, so a day with
ratings and no stored probability is fit rather than inverted at the mean.
Replay leaves the starter covariate at zero, so its rows are not copied.
The command is `python -m bayesratings.mlb_team_hist`.

The research stack was scored on 9,827 games from 2023 through 2026, the
games in that window with a walk-forward probability plus a lineup and a
starter on both sides. Player box scores linked to ESPN games cover
2021–2026, and batted balls cover 2015–2026. Before this table the fit
could see only the seasons that had a stored snapshot, about 2,427 games,
one season. With the history table filled, the same
filters cover the 2022–2026 games that have a lineup and a starter on both
sides. The 2023–2026 portion of that is about 9,800 games, and 2022 adds
the rest of the training rows. The refit prints the exact `n`.

Tuesday's daily run refits while MLB is in season, and the first morning
with no fit stored fits immediately. A same-day Tuesday rerun does not fit
again once version `stack_b` is stored. The morning also replaces
`mlb_player_state` and `mlb_relief_log`. The refit uses the research
estimator: a standard scaler, then L2 logistic regression with
`C` on a grid from `1e-3` to `10` (nine values), five-fold
`neg_log_loss`, and `max_iter=3000`. The label is the home win. `lt` is
the logit of the home team+starter probability, clipped to `[1e-4, 1-1e-4]`.
A stored probability outside `(0, 1)` is left out of the frame. Training
rows are ordered by date before the cross-validation. The refit line prints
`n`, the chosen `C`, the standard deviation of the fitted probabilities on
the training rows (`sd_p`), the standard deviation of the team+starter
probabilities on those rows (`sd_team`), their ratio, the standardized
weight on `lt`, and the coefficients. A fit is stored and does not publish
when it has fewer than 2,000 games, when `sd_p` is below 0.6 times
`sd_team`, or when the absolute difference between the mean fitted
probability and the home win rate on those rows is above 0.03. The chosen
`C` and the weight on `lt` are printed and do not decide publication. The
line says `WARN unpublished` with the reason when a fit is held back, and
the current path stays published. A failure leaves the previous fit and
publishes the current path. The morning check still flags a published
chance that moves more than 10 points from the team chance, or flips the
favorite.

`mlb_player.refresh` runs from `player_adj.refresh` (prelog `pregame`,
which already loads MLB lineups) and from `starters.refresh_mlb` when a
probable pitcher changed. It rewrites only games that have not started and
are not locked. Recorded locks and older forecast rows are not rewritten.
Replay does not apply it.

The box and batted-ball tables (`mlb_box_players`, `mlb_batted_players`,
`player_game_mlb_batting`, `player_game_mlb_pitching`) are the inputs. The
nightly `mlb-extra` pass only stores them. It does not itself change a
published number.

Which path ran is stored on the forecast row (`mlb_model_src`,
`mlb_ridge_prob`, `mlb_team_prob`, `mlb_ridge_fit_id`, `mlb_inputs`).
The in-memory `era` label on that frame is `player_model` for `stack_b` and
`team_model` for `team`. It is not a column in `forecast_snapshots`.
`model_version` stays the Elo stack's version.

The 07:30 CT check WARNs, and names the game, when an unplayed MLB forecast's
stack chance differs from the team chance by more than 10 points or the two
disagree on the favorite. A gap of exactly 10 points does not.

A new lock stores whatever `home_prob` is at lock time. When the stack ran,
that is the stack chance. Older locks stay as recorded.

Commands, after `init_db`, in this order. The history backfill is once.
It skips games already stored. The refit then fits, replaces the state, and
refreshes unlocked forecasts. Past rows and existing locks stay. A stored
fit with fewer than 2,000 games does not publish. With the history table
filled, the refit `n` should be about 9,800 games from 2023 through 2026
plus the 2022 rows that have a lineup and a starter on both sides.

    python -m bayesratings.mlb_team_hist --db data/bayesratings.db
    python -m bayesratings.mlb_player --db data/bayesratings.db

## 6. Dynamic Bayesian Elo stack

`bayesratings/bayes_elo.py`, `stan/bayes_elo_dynamic.stan`. Fit each morning
per league on the latest season plus the 5 before it, same cutoff as the
logit. Ratings update game by game inside the likelihood (K estimated, a
margin multiplier, overtime and shootout results at full weight (same as
the logit), season carryover toward 1500).

```
p_model = (1 - w) × p_logit + w × p_elo
```

| League (season) | w |
|---|---|
| MLB 2026 | 0.2415 |
| NFL 2026 | 0.8315 |
| NHL 2026-27 | 0.1033 |
| NBA 2026-27 | 0.5 (the fit gave 1.0) |

Weights are refit at each league's season start (procedure in the module
docstring). If the Elo fit errors, has R-hat > 1.05 or too many divergences,
the logit is published alone (`elo_weight = 0`) and the status line says
`WARN elo fallback`. Stored per forecast row: `p_logit`, `p_elo`,
`elo_weight`, `model_version`. `home_prob` in `forecast_snapshots` is
`p_model`. `p_logit` includes the in-model starter covariate and the player
adjustment. Spreads and totals are unchanged by the stack. The hybrid
spread and total are also not shifted by the starter coefficient.

## Published number

The number `daily` stores is the model's own win chance, margin, and total
(`home_prob`, `home_spread`, `total_pred`).

- NBA: `home_prob` is the player ridge when `nba_model_src` is `ridge_b` or
  `ridge_c`, and the team path when it is `team` (section 5c).
- NHL: the player ridge when `nhl_model_src` is `ridge_b` or `ridge_c`, and
  the team path when it is `team` (section 5d).
- NFL: the quarterback ridge when `nfl_model_src` is `ridge_qb`, and the
  team path when it is `team` (section 5e).
- MLB: the player stack when `mlb_model_src` is `stack_b`, and the team
  path when it is `team` (section 5f).

The spread names that same favorite. The total stays the team path's total.
Rows already written, and existing locks, are not rewritten.

`bayesratings/lock.py` freezes that forecast about ten minutes before the
scheduled start (`LOCK_BEFORE` is ten minutes; a game that started up to an
hour ago without a lock is caught up, `LOCK_LATE`) into `forecast_locks`
(`INSERT OR IGNORE`, never replaced). The live refresh calls `lock_due`.
A game with no lock is the row in `forecast_snapshots`.

## Replay

`bayesratings/replay.py` rebuilds past days walk-forward (`backfilled = 1`),
team model only. MLB's margin home edge is on. The starter covariate is
zero because the box-score logs are not joined. There is no player
adjustment, no Elo stack, and no league player model. The ridge audit
columns stay null on replayed rows. A live row (`backfilled = 0`) is never
overwritten. The 2026-10-13 rating-model change is in
`docs/decisions/2026-10-13-model-rebuild.md`.

    python -m bayesratings.replay --db data/bayesratings.db --leagues nhl

