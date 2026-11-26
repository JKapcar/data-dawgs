# 2026-11-21 — Team-model tuneups, step 1

Walk-forward of the Bradley-Terry model alone. No Elo stack and no starter covariate.

## What changed

- NHL overtime and shootout results count fully on the win/loss term
  (`OT_RESULT_WEIGHT` and `SHOOTOUT_RESULT_WEIGHT` are 1). The Elo model
  uses the same multipliers. The margin term was never scaled by them.
- NBA half-life is 90 days (was 120). MLB, NFL, and NHL stay at 180.
- NBA and NHL: home and away back-to-back flags on the rating edge, each
  with a `normal(0, 0.5)` prior. A flag is 1 when that team played on the
  previous calendar day. Only earlier games count, including an earlier
  unplayed game on the upcoming slate. A same-day doubleheader is not a
  back-to-back. MLB and NFL pass zeros.
- NHL rating-scale prior is `sigma ~ student_t(3, 0, 0.5)` (was scale 1).
  Other leagues stay at 1.

The published win probability is the posterior mean of `inv_logit(eta)`,
and eta includes the flags. The hybrid spread and total are not shifted by
the back-to-back coefficients at forecast time.

## How it was scored

Weekly refit. Train on games dated before Tuesday, score that week's games.
Seasons scored are 2023-24 through the latest game in the files. NBA and
NHL season labels are the year the season ends (2024 = 2023-24).

Each change is one variant. Baseline is the previous settings on the same
Stan program: NBA half-life 120, overtime 0.5 and shootout 0.25, no
back-to-back, rating-scale prior 1. Flags of zero keep the extra
coefficients out of the edge. Sampling is HMC, 2 chains, 200 warmup, 400
draws. No week had a divergent transition (432 NBA fits, 580 NHL fits).

Log loss is the mean of `-(y log p + (1-y) log(1-p))` on the posterior
home-win probability. The 95% intervals are a cluster bootstrap by game
day, 2000 resamples, seed 20261121. Delta is after minus baseline on the
same games (negative is better). The calibration slope is the slope from a
logistic regression of the home-win outcome on `logit(p)`, with a free
intercept. Below 1 is overconfident.

Games were regular season and postseason, with exhibition teams left out.
NBA runs through 2026-11-20 (4,179 scored games). NHL
runs through 2026-11-19 (4,550 scored games). MLB and NFL are unchanged
by construction: half-life 180, no overtime ending, back-to-back off,
rating-scale prior 1. `tests/test_model_changes.py` locks that.

## Log loss

| League | Season | Variant | Games | Days | Log loss | 95% CI | Δ vs baseline | Δ 95% CI |
|---|---|---|---:|---:|---:|---|---:|---|
| nba | 2024 | baseline | 1313 | 205 | 0.6124 | [0.5950, 0.6304] | +0.0000 | [+0.0000, +0.0000] |
| nba | 2025 | baseline | 1315 | 211 | 0.6150 | [0.5955, 0.6346] | +0.0000 | [+0.0000, +0.0000] |
| nba | 2026 | baseline | 1316 | 209 | 0.6103 | [0.5904, 0.6301] | +0.0000 | [+0.0000, +0.0000] |
| nba | 2027 | baseline | 235 | 31 | 0.6045 | [0.5507, 0.6591] | +0.0000 | [+0.0000, +0.0000] |
| nba | all | baseline | 4179 | 656 | 0.6121 | [0.6017, 0.6228] | +0.0000 | [+0.0000, +0.0000] |
| nba | 2024 | half_life_90 | 1313 | 205 | 0.6114 | [0.5923, 0.6312] | -0.0011 | [-0.0035, +0.0014] |
| nba | 2025 | half_life_90 | 1315 | 211 | 0.6126 | [0.5936, 0.6321] | -0.0023 | [-0.0049, +0.0003] |
| nba | 2026 | half_life_90 | 1316 | 209 | 0.6063 | [0.5860, 0.6279] | -0.0040 | [-0.0066, -0.0015] |
| nba | 2027 | half_life_90 | 235 | 31 | 0.6065 | [0.5533, 0.6609] | +0.0021 | [-0.0035, +0.0082] |
| nba | all | half_life_90 | 4179 | 656 | 0.6099 | [0.5997, 0.6207] | -0.0022 | [-0.0036, -0.0008] |
| nba | 2024 | b2b | 1313 | 205 | 0.6095 | [0.5916, 0.6288] | -0.0029 | [-0.0079, +0.0023] |
| nba | 2025 | b2b | 1315 | 211 | 0.6118 | [0.5933, 0.6332] | -0.0031 | [-0.0072, +0.0010] |
| nba | 2026 | b2b | 1316 | 209 | 0.6104 | [0.5913, 0.6317] | +0.0000 | [-0.0029, +0.0029] |
| nba | 2027 | b2b | 235 | 31 | 0.6033 | [0.5472, 0.6605] | -0.0011 | [-0.0083, +0.0074] |
| nba | all | b2b | 4179 | 656 | 0.6102 | [0.5990, 0.6219] | -0.0020 | [-0.0041, +0.0003] |
| nba | 2024 | combined | 1313 | 205 | 0.6093 | [0.5889, 0.6291] | -0.0032 | [-0.0089, +0.0025] |
| nba | 2025 | combined | 1315 | 211 | 0.6096 | [0.5895, 0.6296] | -0.0054 | [-0.0101, -0.0003] |
| nba | 2026 | combined | 1316 | 209 | 0.6060 | [0.5861, 0.6272] | -0.0043 | [-0.0082, -0.0003] |
| nba | 2027 | combined | 235 | 31 | 0.6066 | [0.5481, 0.6599] | +0.0022 | [-0.0087, +0.0149] |
| nba | all | combined | 4179 | 656 | 0.6082 | [0.5963, 0.6195] | -0.0039 | [-0.0068, -0.0010] |
| nhl | 2024 | baseline | 1400 | 232 | 0.6621 | [0.6487, 0.6753] | +0.0000 | [+0.0000, +0.0000] |
| nhl | 2025 | baseline | 1398 | 224 | 0.6664 | [0.6540, 0.6794] | +0.0000 | [+0.0000, +0.0000] |
| nhl | 2026 | baseline | 1394 | 211 | 0.6898 | [0.6798, 0.6992] | +0.0000 | [+0.0000, +0.0000] |
| nhl | 2027 | baseline | 358 | 52 | 0.6685 | [0.6487, 0.6894] | +0.0000 | [+0.0000, +0.0000] |
| nhl | all | baseline | 4550 | 719 | 0.6724 | [0.6658, 0.6791] | +0.0000 | [+0.0000, +0.0000] |
| nhl | 2024 | ot_full | 1400 | 232 | 0.6616 | [0.6496, 0.6742] | -0.0005 | [-0.0021, +0.0010] |
| nhl | 2025 | ot_full | 1398 | 224 | 0.6664 | [0.6547, 0.6782] | +0.0000 | [-0.0011, +0.0010] |
| nhl | 2026 | ot_full | 1394 | 211 | 0.6889 | [0.6804, 0.6980] | -0.0009 | [-0.0023, +0.0005] |
| nhl | 2027 | ot_full | 358 | 52 | 0.6701 | [0.6537, 0.6879] | +0.0016 | [-0.0013, +0.0044] |
| nhl | all | ot_full | 4550 | 719 | 0.6721 | [0.6661, 0.6784] | -0.0003 | [-0.0011, +0.0004] |
| nhl | 2024 | b2b | 1400 | 232 | 0.6618 | [0.6474, 0.6761] | -0.0003 | [-0.0035, +0.0031] |
| nhl | 2025 | b2b | 1398 | 224 | 0.6637 | [0.6498, 0.6771] | -0.0026 | [-0.0066, +0.0013] |
| nhl | 2026 | b2b | 1394 | 211 | 0.6880 | [0.6772, 0.6997] | -0.0017 | [-0.0058, +0.0027] |
| nhl | 2027 | b2b | 358 | 52 | 0.6655 | [0.6456, 0.6863] | -0.0030 | [-0.0092, +0.0028] |
| nhl | all | b2b | 4550 | 719 | 0.6707 | [0.6638, 0.6780] | -0.0017 | [-0.0038, +0.0005] |
| nhl | 2024 | sigma_half | 1400 | 232 | 0.6623 | [0.6489, 0.6758] | +0.0002 | [-0.0002, +0.0005] |
| nhl | 2025 | sigma_half | 1398 | 224 | 0.6664 | [0.6535, 0.6793] | +0.0000 | [-0.0003, +0.0004] |
| nhl | 2026 | sigma_half | 1394 | 211 | 0.6898 | [0.6802, 0.6993] | +0.0000 | [-0.0003, +0.0003] |
| nhl | 2027 | sigma_half | 358 | 52 | 0.6683 | [0.6489, 0.6880] | -0.0003 | [-0.0008, +0.0003] |
| nhl | all | sigma_half | 4550 | 719 | 0.6724 | [0.6655, 0.6790] | +0.0000 | [-0.0001, +0.0002] |
| nhl | 2024 | combined | 1400 | 232 | 0.6612 | [0.6478, 0.6747] | -0.0009 | [-0.0043, +0.0026] |
| nhl | 2025 | combined | 1398 | 224 | 0.6635 | [0.6501, 0.6762] | -0.0029 | [-0.0067, +0.0009] |
| nhl | 2026 | combined | 1394 | 211 | 0.6866 | [0.6765, 0.6976] | -0.0032 | [-0.0072, +0.0009] |
| nhl | 2027 | combined | 358 | 52 | 0.6669 | [0.6481, 0.6853] | -0.0016 | [-0.0079, +0.0048] |
| nhl | all | combined | 4550 | 719 | 0.6701 | [0.6637, 0.6768] | -0.0022 | [-0.0043, -0.0002] |

Combined is better in both leagues, and those two intervals exclude zero.
NBA half-life alone also excludes zero. The NBA back-to-back interval and
every single NHL change include zero. NHL overtime weight and the tighter
prior barely move log loss.

## Coefficients

Mean posterior mean across weeks. Signs match the earlier research
(NBA home about −0.37, NBA away about +0.24, NHL away about +0.35).

| League | Variant | Weeks | Mean b2b_home | Mean b2b_away | Weeks with a divergence |
|---|---|---:|---:|---:|---:|
| nba | b2b | 108 | -0.338 | +0.284 | 0 |
| nba | combined | 108 | -0.330 | +0.270 | 0 |
| nhl | b2b | 116 | -0.243 | +0.347 | 0 |
| nhl | combined | 116 | -0.232 | +0.330 | 0 |

## NHL calibration

All scored games, 2000 day resamples:

| Variant | Games | Slope | 95% CI | Intercept |
|---|---:|---:|---|---:|
| baseline | 4550 | 0.864 | [0.727, 1.002] | +0.018 |
| ot_full | 4550 | 0.946 | [0.799, 1.100] | +0.016 |
| b2b | 4550 | 0.849 | [0.714, 0.984] | +0.019 |
| sigma_half | 4550 | 0.867 | [0.732, 1.014] | +0.017 |
| combined | 4550 | 0.933 | [0.780, 1.070] | +0.016 |

By season, 1000 day resamples. The slope near 0.70 is the 2025-26 point
estimate, not the four-season pool. Every one of these intervals includes 1.

| Season | baseline | sigma_half | ot_full | combined |
|---|---|---|---|---|
| 2023-24 | 0.910 [0.722, 1.130] | 0.914 [0.692, 1.137] | 1.008 [0.789, 1.242] | 0.973 [0.767, 1.203] |
| 2024-25 | 0.858 [0.637, 1.103] | 0.860 [0.624, 1.099] | 0.913 [0.638, 1.193] | 0.919 [0.683, 1.172] |
| 2025-26 | 0.655 [0.326, 1.013] | 0.657 [0.321, 1.026] | 0.722 [0.346, 1.099] | 0.753 [0.418, 1.068] |
| 2026-27 (partial) | 1.222 [0.679, 1.852] | 1.238 [0.654, 1.823] | 1.375 [0.771, 2.155] | 1.325 [0.775, 1.918] |

Halving the prior scale does not move the slope. On the window ending
2026-04-20 (3,147 games, same sampler), posterior `sigma` was 0.229
(scale 1) and 0.224 (scale 0.5). The prior sits well above the posterior,
so the games determine the spread. Counting overtime and shootouts fully
moves the slope more than the prior does.

`tests/test_model_changes.py` locks the settings this walk-forward kept.
