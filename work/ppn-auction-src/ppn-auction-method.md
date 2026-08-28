# datadawgs-ppn-auction-2026-v3 — method contract

**As of:** 2026-08-28 · **Status:** reproducible conversion; not outcome-validated

Translate ETR 12-team half-PPR auction values into the PPN league without replacing ETR player judgment.

## League
{
 "teams": 14,
 "budget_per_team": 200,
 "minimum_bid": 0,
 "paid_slots_per_team": 15,
 "total_budget": 2800,
 "starters": {
  "QB": 1,
  "RB": 2,
  "WR": 2,
  "TE": 1,
  "FLEX_RB_WR_TE": 2,
  "DST": 1
 },
 "bench": 6,
 "IR": 2,
 "kicker": false
}

## Scoring
{
 "completion": 0.25,
 "incompletion": -0.5,
 "passing_yards_per_point": 20,
 "passing_td": 4,
 "interception": -2.5,
 "sack_taken": -1,
 "rushing_yards_per_point": 10,
 "rushing_td": 6,
 "reception": 0.5,
 "receiving_yards_per_point": 10,
 "receiving_td": 6,
 "return_yards_per_point": 25,
 "return_td": 6,
 "fumble_lost": -2.5,
 "pick_six_thrown": -1,
 "completion_40_plus": 0.5,
 "rush_40_plus": 1,
 "reception_40_plus": 1,
 "rushing_first_down": 0.25,
 "receiving_first_down": 0.25,
 "fractional_yardage": false
}

## Authoritative prior
{
 "provider": "Establish The Run",
 "input": "ETR Half PPR auction dollars",
 "source_snapshot_sha256": "1d772b1db0b5e79a06835b89d0589c5cc469930910798fef86d0975c3b511b8c",
 "source_rows": 456,
 "public_raw_source": false,
 "rule": "ETR controls player preference; outside projections may alter only league-format deltas."
}

## Method
{
 "source_floor": 1,
 "baseline_premium": "max(ETR_half - 1, 0)",
 "beta": 0.5325254870874315,
 "depth_pass_through": 0.5,
 "scoring_pass_through": 0.5,
 "central_weight": "max(0, baseline_premium + beta * [0.5*(VOR_14_standard - VOR_12_standard) + 0.5*(VOR_14_custom - VOR_14_standard)])",
 "exact_price": "2800 * central_weight / sum(central_weight for eligible, non-overridden players)",
 "rounding": "Hamilton/largest remainder to exact integer total of 2800",
 "replacement": "Fill mandatory starters, then allocate 28 flex positions to the highest projected RB/WR/TE; replacement is the best unselected player at each position.",
 "priced_pool": {
  "QB": 26,
  "RB": 68,
  "WR": 78,
  "TE": 24,
  "DST": 14
 },
 "sensitivity_scenarios": [
  "budget_only 0/0",
  "cautious 0.25/0.25",
  "central 0.5/0.5",
  "full_depth 1/0.5",
  "full_conversion 1/1",
  "no_returns",
  "full_return_role",
  "ETR_INT_minus_1"
 ],
 "interval_meaning": "model_low/model_high are conversion-assumption sensitivity bounds, not player-outcome confidence intervals and not bid ceilings."
}

## Auxiliary inputs
{
 "season_projection": "FFToday 2026 raw component projections; used only for deltas",
 "event_rates": "2025 nflverse sacks, first downs, 40+ plays and fumbles; shrunk toward position means",
 "return_roles": "uncertain; no standalone return-TD premium"
}

## Manual overrides
[
 {
  "player": "Jayden Higgins",
  "id": "00-0038130",
  "target": 0,
  "reason": "Torn ACL; out for 2026 season",
  "source": "https://www.nfl.com/news/texans-wr-jayden-higgins-torn-acl-out-2026-season"
 }
]

**Amendment (2026-08-28, Claude):** Jayden Higgins does not exist as a row in the ETR source snapshot or the final board; the override is recorded for audit but zeroes nothing. Gate rewritten as 'Jayden Higgins absent or $0'.

## Rejected adjustments
- positional games-played haircut (double-count risk)
- concave price exponent labeled as certainty pricing
- hand-set QB multipliers
- uniform 14/12 price scaling
- forced $1 league floor
- arbitrary star cap

## Validation
{
 "rows": 424,
 "non_kickers": 424,
 "positive_prices": 121,
 "target_sum": 2800,
 "duplicate_ids": [],
 "negative_prices": 0,
 "top_player": {
  "player": "Jahmyr Gibbs",
  "target": 90
 }
}

## Limitations
- No keeper list or costs; values are pre-keeper inflation.
- The 50% pass-through is declared shrinkage, not an empirically optimized coefficient.
- One outside mean-projection system cannot reproduce ETR injury, ceiling or qualitative judgment.
- No historical PPN auction-clearing data was supplied.
- D/ST is left at $0 rather than inventing precision from unavailable rare-event forecasts.

## Falsification & update
- Recompute when the ETR snapshot changes.
- Recompute after keeper names/costs are known.
- Track actual clearing prices and season outcomes; estimate pass-through and tail concentration next season.
- A source hash, row count, total-budget or duplicate-ID failure blocks publication.