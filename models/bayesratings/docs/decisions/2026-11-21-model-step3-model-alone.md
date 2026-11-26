# 2026-11-21 — Publish the model alone

Step 3 of the player-level overhaul. The published win chance, margin and
total are the model's own. Not a refit: no walk-forward, no replay, no new
Stan fit.

## What changed

- A live forecast shows the model's own `home_prob`, `home_spread` and
  `total_pred`.
- `lock_due` still freezes a forecast shortly before the start, into
  `forecast_locks` (this package's name for that row), with
  `INSERT OR IGNORE`. A new row stores the model's own chance, margin and
  total.
- A game with no lock is read from the forecast row, which is the model.

## What stayed

Recorded rows are not rewritten. `forecast_snapshots` and
`upcoming_forecasts` are not recomputed by this change. Team ratings never
see anything but the games and the player tables.

The owner decided the published number is the model's own.
