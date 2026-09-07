---
as_of: 2026-09-07
source: User-supplied ETR and ESPN ownership snapshots; linked primary research.
---

# Survivor ownership — Week 1, 2026

As of: 2026-09-07 (ingestion date; exact source observation times unavailable).

Data Dawgs estimates the pick mix of a generic mixed survivor field. These are
modelled shares, not measured submissions in your pool, Splash or Circa.

## Inputs and research

- ETR's user-supplied `NFL Survivor – Splash.csv`: 28 projected team shares,
  summing to 100%. The user identified this as the current week; all 28 matchups
  were checked against the site's 2026 Week 1 schedule.
- Six user-supplied ESPN NFL Survivor screenshots: all 32 teams, summing to
  100.01% due to rounding. The screenshots explicitly show Week 1, September
  9–14, 2026. These are pre-lock picks, not final counts. Sample size is unknown.
- [ESPN](https://fantasy.espn.com/games/nfl-survivor-2026/howtoplay)
  advertises a free contest and up to 25 entries per person. Its entrants need
  not behave like a paid pool's entrants; entries are not independent people.
- [Splash's settings](https://intercom.help/splashsports-helpcenter/en/articles/15924964-nfl-survivor-splash-managed-new-settings-for-2026)
  allow individual games to be excluded. The ETR CSV omits NE, SEA, SF and LAR,
  exactly the Wednesday/Thursday games. We do not know why this particular
  export omits them, and do not interpret their missing rows as zero ownership.
- [PoolGenius, September 3](https://poolgenius.teamrankings.com/nfl-survivor-pool-picks/articles/week-1-strategy-advice-help-2026/)
  projects LAC 34%, JAX 26%, DET 13%, LV 8%, PHI 5% and PIT 4%. This corroborates
  the concentration in large favorites. It is not added as a third full-field
  source: the public list is partial and expert forecasts may be correlated.

## Reproducible blend

Normalize ESPN's 100.01% to 100%. Call each resulting share E(t).
Let M be ESPN's total share for the four teams missing from ETR (about 10.67%).
Normalize the ETR shares over its 28 covered teams to obtain X(t).

- For NE, SEA, SF and LAR: Data Dawgs share = E(t).
- For each covered team: Data Dawgs share = 0.5 × E(t) + 0.5 × (1 − M) × X(t).

This preserves the early-game mass and blends the other 28 teams on a common
denominator. All 32 results sum to 100%. Equal weighting is a declared judgment,
not a fitted optimum or a claim of independent evidence. The downloadable
snapshot also includes 25% and 75% ETR scenarios; these are sensitivity checks,
not statistical confidence intervals. No stake size or Circa-specific behavior
is inferred from either input.

## Application and limits

The blend replaces the probability-power fallback only for 2026 Week 1.
Later weeks retain the existing chalk model. Local supplied-pick overrides
still take precedence. The chalk-exponent dial does not change the dated blend.
Shares renormalize when the model is explicitly asked to restrict available
teams. Win probabilities, game lines and future-value calculations are unchanged.

The daily snapshot builder preserves/rebuilds this input automatically. This
does not create an automated ESPN or ETR collector; another upload is needed
to revise this source snapshot. The as-of date does not advance with nfelo.

New prospective public receipts use this declared model and retain its model
metadata. Existing receipts and grades are unchanged. Source-backed modelling
does not establish a measured ownership edge, and a rare pick is not necessarily
a good pick.

Raw percentage inputs: [JSON](survivor-ownership-inputs.json).
Model output and sensitivity: [survivor.json](survivor.json), `data.ownership`.
