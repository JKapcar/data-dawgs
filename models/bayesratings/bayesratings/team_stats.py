# Offensive/defensive strength (OS/DS) relative to league average.
#
# OS = points scored per game / league average (1.0 = average offense)
# DS = points allowed per game / league average (1.0 = average defense;
#      lower is better)

import numpy as np
import pandas as pd


def compute_team_stats(games: pd.DataFrame, sample_weight=None) -> dict:
    """Offensive and defensive strength from completed games.

    With `sample_weight`, each game counts in proportion to its weight (the
    same decay the rating fit uses). Without it, every game counts once and
    the result matches the original unweighted estimator.
    Returns {"team_stats": DataFrame, "league_avg_points": float}."""
    if len(games) == 0:
        raise ValueError("compute_team_stats(): no games supplied.")
    if sample_weight is not None:
        return _weighted_team_stats(games, sample_weight)

    n = len(games)
    league_avg_points = (
        games["home_score"].sum() + games["away_score"].sum()
    ) / (2 * n)

    home = pd.DataFrame({
        "team": games["home_team"],
        "scored": games["home_score"],
        "allowed": games["away_score"],
    })
    away = pd.DataFrame({
        "team": games["away_team"],
        "scored": games["away_score"],
        "allowed": games["home_score"],
    })
    both = pd.concat([home, away], ignore_index=True)

    agg = both.groupby("team", as_index=False).agg(
        pts_scored=("scored", "sum"),
        pts_allowed=("allowed", "sum"),
        games_played=("team", "size"),
    )
    agg["OS"] = agg["pts_scored"] / agg["games_played"] / league_avg_points
    agg["DS"] = agg["pts_allowed"] / agg["games_played"] / league_avg_points

    # sort by team for stable ordering (R groups return sorted keys)
    agg = agg.sort_values("team").reset_index(drop=True)
    return {"team_stats": agg, "league_avg_points": league_avg_points}


def _weighted_team_stats(games: pd.DataFrame, sample_weight) -> dict:
    w = np.asarray(sample_weight, dtype=float)
    if len(w) != len(games):
        raise ValueError("sample_weight must match games row for row.")
    hp = games["home_score"].to_numpy(dtype=float)
    ap = games["away_score"].to_numpy(dtype=float)
    league_avg_points = float(np.sum(w * (hp + ap)) / (2.0 * np.sum(w)))

    parts = []
    for team, scored, allowed in (
        (games["home_team"], hp, ap),
        (games["away_team"], ap, hp),
    ):
        ww = w
        parts.append(pd.DataFrame({
            "team": np.asarray(team),
            "ws": ww * scored,
            "wa": ww * allowed,
            "w": ww,
        }))
    both = pd.concat(parts, ignore_index=True)
    agg = both.groupby("team", as_index=False).agg(
        pts_scored=("ws", "sum"),
        pts_allowed=("wa", "sum"),
        games_played=("w", "sum"),
    )
    agg["OS"] = agg["pts_scored"] / agg["games_played"] / league_avg_points
    agg["DS"] = agg["pts_allowed"] / agg["games_played"] / league_avg_points
    agg = agg.sort_values("team").reset_index(drop=True)
    return {"team_stats": agg, "league_avg_points": league_avg_points}
