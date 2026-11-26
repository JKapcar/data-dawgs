"""Neutral-site games get no home edge: in the rating fit data, the forecast
layer's training rows, and the forecast itself (symmetric when teams swap)."""
import numpy as np
import pandas as pd
from bayesratings.ratings import bt_stan_data
from bayesratings.games import validate_games
from bayesratings.forecast import forecast_games
from bayesratings.hybrid import fit_hybrid_models
from bayesratings.team_stats import compute_team_stats

rng = np.random.default_rng(0)
teams = [str(i) for i in range(8)]
strength = dict(zip(teams, rng.normal(0, 3, 8)))
rows = []
for k in range(400):
    h, a = rng.choice(teams, 2, replace=False)
    neutral = int(k % 10 == 0)
    edge = 0 if neutral else 3.0
    m = strength[h] - strength[a] + edge + rng.normal(0, 10)
    hs = 20 + max(m, 0) + rng.integers(0, 5); as_ = 20 + max(-m, 0) + rng.integers(0, 5)
    if hs == as_: hs += 1
    rows.append({"season": 2026, "date": f"2026-01-{1 + k % 28:02d}", "home_team": h,
                 "away_team": a, "home_score": hs, "away_score": as_, "neutral": neutral})
games = validate_games(pd.DataFrame(rows))

# 1. Stan data carries the neutral flag; missing column = no neutral games
data = bt_stan_data(games, {t: i + 1 for i, t in enumerate(sorted(teams))})
assert data["neutral"] == games["neutral"].tolist() and sum(data["neutral"]) == 40
assert bt_stan_data(games.drop(columns="neutral"), {t: i + 1 for i, t in enumerate(sorted(teams))})["neutral"] == [0] * 400
print("ok stan data has neutral flags")

# 2. forecasts: a neutral game is symmetric, a home game keeps the home edge
ratings = pd.Series({t: (strength[t] - np.mean(list(strength.values()))) / 10 for t in teams})
stats = compute_team_stats(games)
hyb = fit_hybrid_models(games, ratings, stats["team_stats"])
def fc(h, a, n):
    s = pd.DataFrame([{"season": 2026, "date": "2026-02-01", "home_team": h, "away_team": a,
                       "home_score": np.nan, "away_score": np.nan, "neutral": n}])
    return forecast_games(validate_games(s), ratings, stats["team_stats"], hyb,
                          stats["league_avg_points"]).iloc[0]
ab, ba = fc("1", "2", 1), fc("2", "1", 1)
assert abs(ab.home_prob - ba.away_prob) < 1e-3, (ab.home_prob, ba.away_prob)
assert abs(ab.home_spread + ba.home_spread) < 0.11
assert abs(ab.total_pred - ba.total_pred) < 0.11
assert abs(ab.home_total_pred - ba.away_total_pred) < 0.11
home_ab = fc("1", "2", 0)
assert home_ab.home_prob > ab.home_prob, (home_ab.home_prob, ab.home_prob)
print("ok neutral forecast symmetric; home game keeps its edge")

# 3. same team vs itself-strength: equal ratings at a neutral site -> 50%
ratings2 = ratings.copy(); ratings2["2"] = ratings2["1"]
st2 = stats["team_stats"].copy()
st2.loc[st2.team == "2", ["OS", "DS"]] = st2.loc[st2.team == "1", ["OS", "DS"]].values
s = pd.DataFrame([{"season": 2026, "date": "2026-02-01", "home_team": "1", "away_team": "2",
                   "home_score": np.nan, "away_score": np.nan, "neutral": 1}])
f = forecast_games(validate_games(s), ratings2, st2, hyb, stats["league_avg_points"]).iloc[0]
assert abs(f.home_prob - 0.5) < 1e-3, f.home_prob
print("ok equal teams at a neutral site = 50%")
