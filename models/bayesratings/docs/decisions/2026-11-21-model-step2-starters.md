# 2026-11-21 — Team-model tuneups, step 2

MLB margin home edge, and an in-model starting pitcher and starting goalie.
The Elo weights are unchanged.

## What changed

- MLB's margin term has its own home edge, in runs. The win/loss term still
  uses `home_adv`. The margin mean is
  `margin_scale * base + home_margin * (1 - neutral)`, where `base` is the
  rating difference plus the covariate terms and does not include
  `home_adv`. Prior: `home_margin ~ normal(0, 10)`. Other leagues keep
  `mu = margin_scale * eta` (`weights.use_margin_home` is on for MLB only).
  `home_margin` does not enter the published win probability except through
  the ratings the margin likelihood estimates.
- MLB starting pitcher and NHL starting goalie are a covariate on the
  rating edge. `starter_edge` is home team-relative quality minus away,
  and 0 on a side with no starter. The coefficient is estimated in the fit,
  prior `normal(0, 0.5)`. NBA and NFL pass zeros
  (`weights.use_starter`). The daily job no longer applies the old
  outside starter shift, so the term is not counted twice. Hybrid spreads
  and totals are not shifted by the coefficient. Replay does not join the
  box-score logs, so a rebuilt row has edge 0; MLB's margin home edge is
  still on, because it needs no extra data.
- Quality uses earlier dates only. MLB: decayed runs allowed and outs
  (half-life 180 days), league rate on the same half-life,
  `rate = (sum_runs + 150 * lg * 1.08) / (sum_outs + 150)`,
  `q = (lg - rate) * 16.5`. NHL: decayed saves and shots (half-life 365
  days), first goalie listed, `sv = (saves + 1500 * (lg - 0.003)) / (shots + 1500)`,
  `q = (sv - lg) * 28`. Team-relative quality subtracts that team's
  decayed average starter (half-life 60 days, one weight per start).
  Completed games use the pitcher or goalie who started. An unplayed game
  uses the probable known at forecast time.
- MLB's rating-scale prior is `sigma ~ student_t(3, 0, 0.5)`, the same
  tightening step 1 gave NHL. NBA and NFL stay at scale 1.

Step 1 is unchanged: NBA half-life 90, overtime and shootout weight 1,
NBA and NHL back-to-back terms, NHL `sigma_scale` 0.5.

## Evidence

These settings are the ones the out-of-sample research kept. That check
change versus the previous model, negative meaning better, 95% interval
from a bootstrap by game day. The MLB rows are cumulative.

| League | Change | Δ log loss | 95% CI |
|---|---|---:|---|
| MLB | starter in the model | -0.0013 | [-0.0023, -0.0002] |
| MLB | plus the separate margin home edge | -0.0018 | [-0.0030, -0.0006] |
| MLB | plus the tighter rating prior | -0.0026 | [-0.0039, -0.0013] |
| NHL | goalie in the model | -0.0010 | [-0.0018, -0.0002] |

The tighter MLB prior is on because that last step improved log loss
(the interval excludes zero). NBA and NFL forecasts are unchanged by
construction: both flags are off, the new covariates are zero, and the
rating-scale prior stays 1. `tests/test_model_changes.py` locks that.
