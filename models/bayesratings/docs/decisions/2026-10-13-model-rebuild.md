# 2026-10-13 — New rating model

The rating model changed on 2026-10-13. Later changes are in
`docs/model.md`. Every league now refits on each daily run
(`WEEKLY_REFIT` in `bayesratings/runtime.py` is empty). NBA's half-life
is 90 days. Overtime and shootout results count fully.

## What changed

- Time decay with a 180-day half-life, instead of a hard switch at the
  season boundary.
- The score margin is in the Stan likelihood, sharing the latent edge
  with the win/loss term.
- The published win chance is the mean of the inverse-logit over posterior
  draws, not the plug-in at the posterior mean.

## Replay

`bayesratings/replay.py` can rebuild past days with `backfilled = 1`. It
takes the shared writer lock only while it saves a day. A live row
(`backfilled = 0`) is never overwritten. New options from that work:
`--refit weekly`, `--since YYYY-MM-DD`, `--lock`.

    python -m bayesratings.replay --db data/bayesratings.db --leagues nhl --since 2026-10-14
