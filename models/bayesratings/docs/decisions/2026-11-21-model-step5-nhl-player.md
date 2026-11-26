# 2026-11-21 — NHL player ridge is the published NHL win chance

Step 5 of the player-level overhaul. Issue #190. The published NHL win
chance is the ridge Data tested: dressed skaters and a confirmed goalie,
with the no-lineup version when that information is missing. The work is
the implementation of that model. No backtest was run for this change, and
the recorded track record is not rescored.

Issue #190 records the tested result on 4,548 games, 2023-24 through
2026-27. Ridge with dressed skaters and a confirmed goalie: log loss 0.6663
against production 0.6756, a change of −0.0093 [−0.0134, −0.0049], and
−0.0040 [−0.0072, −0.0008] against the full audit team model. Calibration
slope 0.99 against production 0.70. With no lineup information: −0.0066
[−0.0111, −0.0019] against production. Those numbers are the research
result. This change does not recompute them.

## What changed

- For a new NHL forecast, `home_prob` is ridge B when both teams have a
  fresh Daily Faceoff dressed chart and a Confirmed starting goalie, and
  ridge C when the lines or the confirmed goalie are missing. The current
  NHL path is published when no fit is stored for that version, either team
  has no skater box from this season or last, or the feature row cannot be
  built (`nhl_model_src` = `team`). A game that qualifies for B and then
  cannot build a finite row stays on the current path.
- The ridge in `nhl_player.py` uses the same features, half-lives,
  shrinkage, C grid (`max_iter=3000`), and training start (2021-12-01).
  Version B is the reported result. Version C is the no-lineup fallback.
  Version A is not fit and not published. Nothing else is stacked on the
  ridge chance.
- The puck line follows the published chance from the current path's margin
  (`forecast.carry_margin`'s goals-per-logit rule, applied from the
  margin that path already carries). Team totals follow. The total stays
  the current path's total.
- Fits live in `nhl_ridge_fits`. Skater rate state lives in
  `nhl_player_state` and goalie rate state in `nhl_goalie_state`, replaced
  each morning from box lines before that day. Monday's 04:30 CT daily run
  refits. The first run with no fit stored fits immediately. A failed refit
  keeps the last stored fit.
- The dressed chart and the Confirmed goalie come from Daily Faceoff.
  `sources/dfo.py` `slate_pass` runs at 03:50 CT and every 30 minutes from
  08:00 to 22:59 CT on NHL game days, skips a feed fetched in the last 45
  minutes, waits 3 seconds between pages, sends an identifying User-Agent,
  and checks robots.txt. A failure is logged and the forecast uses ridge C,
  or the current path when C cannot run. The existing goalie times and the
  16:10 lines pass stay. The goalie identity reuses `starters.known_starters`
  (source `dfo`); strength must be `Confirmed`.
- `nhl_player.refresh` rewrites unlocked NHL forecasts that have not
  started, including upcoming rows, when the line or goalie fingerprint
  changed. The lock a few minutes before puck drop still freezes
  `home_prob`. A new lock is the ridge chance when the ridge ran.

## What stayed

Recorded `forecast_snapshots` rows, `upcoming_forecasts` rows, and
`forecast_locks` rows stay as stored. Replay does not apply the ridge.
Other leagues are unchanged. The current NHL path still runs every
morning. It is the fallback and the stored `nhl_team_prob`.
