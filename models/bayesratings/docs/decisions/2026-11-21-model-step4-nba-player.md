# 2026-11-21 — NBA player ridge is the published NBA win chance

Step 4 of the player-level overhaul. Issue #189. The published NBA win
chance is the ridge Data tested. The work is the implementation of that
model. No backtest was run for this change, and the recorded track record
is not rescored.

## What changed

- For a new NBA forecast, `home_prob` is ridge B when both teams have a
  submitted line on the latest official injury report, and ridge C (both
  sides) when either team is not yet submitted or no report covers the
  game. The current NBA path is published when no fit is stored for that
  version, or either team has no box score from this season or last
  (`nba_model_src` = `team`).
- The ridge in `nba_player.py` uses the same features, half-lives,
  shrinkage, C grid, and training start as the model that was tested.
  Nothing else is mixed in.
- The spread follows the published chance from the current path's margin
  (`forecast.carry_margin`'s points-per-logit rule, applied from the
  margin that path already carries). Team totals follow. The total stays
  the current path's total.
- Fits live in `nba_ridge_fits`. Player rate state lives in
  `nba_player_state`, replaced each morning from box lines before that
  day. Monday's 04:30 CT daily run refits. The first run with no fit
  stored fits immediately. A failed refit keeps the last stored fit.
- `nba_player.refresh` rewrites unlocked NBA forecasts that have not
  started, including upcoming rows, when the injury report or the lineup
  states changed. The lock about ten minutes before tip still freezes `home_prob`.
  A new lock is the ridge chance when the ridge ran.

## What stayed

Recorded `forecast_snapshots` rows, `upcoming_forecasts` rows, and
`forecast_locks` rows are not rewritten. Replay does not apply the ridge.
Other leagues are unchanged. The current NBA path still runs every
morning. It is the fallback and the stored `nba_team_prob`.
