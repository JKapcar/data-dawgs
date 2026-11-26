# End-to-end orchestrator: games DataFrame in, forecasts out.

import warnings

import pandas as pd

from .games import validate_games, completed_games, upcoming_games
from .ratings import (
    attach_b2b, get_bt_model, fit_bt_ratings, posterior_home_prob,
)
from .team_stats import compute_team_stats
from .hybrid import fit_hybrid_models
from .forecast import forecast_games, apply_home_probs
from .weights import decay_window


def select_rating_season(completed: pd.DataFrame, season_override=None,
                         min_current_games=None) -> int:
    """The old single-season rule: the latest season with enough completed
    games, else the season before it. "Enough" defaults to one game per team
    appearing in that season.

    `run_model` no longer uses this. The fit is a time-decay window across
    seasons. Kept so the R-equivalence check can still name the season the
    original pipeline would have picked."""
    if season_override is not None:
        if season_override not in set(completed["season"]):
            raise ValueError(
                f"season_override {season_override} has no completed games."
            )
        return int(season_override)

    for s in sorted(completed["season"].unique(), reverse=True):
        season_games = completed[completed["season"] == s]
        threshold = min_current_games
        if threshold is None:
            threshold = pd.unique(pd.concat([season_games["home_team"],
                                             season_games["away_team"]])).size
        if len(season_games) >= threshold:
            return int(s)

    fallback = int(completed["season"].max())
    warnings.warn(
        f"No season meets the minimum-games threshold; using season "
        f"{fallback} anyway."
    )
    return fallback


def run_model(games: pd.DataFrame, schedule=None, from_date=None, to_date=None,
              season_override=None, min_current_games=None, w_totals=0.6,
              stan_model=None, evaluate=True, points_model="ols",
              half_life_days=None, min_weight=None, b2b: bool = False,
              sigma_scale: float = 1.0, margin_home: bool = False,
              starter: bool = False, **kwargs) -> dict:
    """Run the full model for one league. Returns a dict with forecast,
    ratings, home_adv, team_stats, league_avg_points, hybrid, eval,
    rating_season, n_fit_games, and fit (the CmdStanMCMC).

    Ratings, offensive/defensive strength, and the spread/total regressions
    all use the same time-decay window. The published win probability is the
    posterior predictive from the Stan fit; the hybrid win-probability GLM is
    still fit, and is not what `forecast["home_prob"]` reports.

    `min_current_games` is the old season-switch threshold. Decay replaced
    that switch; passing it has no effect."""
    if min_current_games is not None:
        warnings.warn(
            "min_current_games no longer selects a season; the fit uses a "
            "time-decay window.",
            stacklevel=2,
        )
    games = validate_games(games)
    completed = completed_games(games)
    if len(completed) == 0:
        raise ValueError("`games` contains no completed games.")
    # Flags from every completed game, so a game at the edge of the decay
    # window still sees the day before it. MLB and NFL leave the columns off
    # and the Stan data is zeros.
    if b2b:
        completed = attach_b2b(completed)

    window_kw = {}
    if half_life_days is not None:
        window_kw["half_life_days"] = half_life_days
    if min_weight is not None:
        window_kw["min_weight"] = min_weight
    window = decay_window(completed, season_override=season_override, **window_kw)
    rating_season = int(window.loc[window["date"].idxmax(), "season"])
    weights = window["time_weight"].to_numpy()

    if stan_model is None:
        stan_model = get_bt_model()

    ratings_fit = fit_bt_ratings(window, stan_model, evaluate=evaluate,
                                 b2b=b2b, sigma_scale=sigma_scale,
                                 margin_home=margin_home, starter=starter, **kwargs)
    stats = compute_team_stats(window, sample_weight=weights)
    hybrid = fit_hybrid_models(window, ratings_fit["ratings"],
                               stats["team_stats"], points_model=points_model,
                               sample_weight=weights)

    if schedule is None:
        schedule = upcoming_games(games, from_date, to_date)
    else:
        schedule = validate_games(schedule)
        if from_date is not None:
            schedule = schedule[schedule["date"] >= pd.to_datetime(from_date)]
        if to_date is not None:
            schedule = schedule[schedule["date"] <= pd.to_datetime(to_date)]
        schedule = schedule.reset_index(drop=True)
    if b2b and len(schedule) and "home_b2b" not in schedule.columns:
        # Earlier completed games, then earlier rows of this schedule, so a
        # game later in the window sees a back-to-back that has not been
        # played yet. Pre-set columns are kept (a weekly refit passes flags
        # that include games after the fit cutoff).
        schedule = attach_b2b(schedule, history=completed)

    forecast = _forecast(schedule, ratings_fit, stats, hybrid, w_totals,
                         apply_starter=starter)

    return {
        "forecast": forecast,
        "ratings": ratings_fit["ratings"],
        "home_adv": ratings_fit["home_adv"],
        "team_stats": stats["team_stats"],
        "league_avg_points": stats["league_avg_points"],
        "hybrid": hybrid,
        "eval": ratings_fit["eval"],
        "rating_season": rating_season,
        "n_fit_games": int(len(window)),
        "fit": ratings_fit["fit"],
        "teams": ratings_fit["teams"],
        "w_totals": w_totals,
        "apply_starter": bool(starter),
    }


def _forecast(schedule, ratings_fit, stats, hybrid, w_totals, apply_starter=False):
    if len(schedule) == 0:
        return None
    forecast = forecast_games(schedule, ratings_fit["ratings"],
                              stats["team_stats"], hybrid,
                              stats["league_avg_points"], w_totals)
    home_b2b = (schedule["home_b2b"].to_numpy()
                if "home_b2b" in schedule.columns else None)
    away_b2b = (schedule["away_b2b"].to_numpy()
                if "away_b2b" in schedule.columns else None)
    starter_edge = None
    if apply_starter and "starter_edge" in schedule.columns:
        starter_edge = schedule["starter_edge"].fillna(0).to_numpy()
    p = posterior_home_prob(
        ratings_fit["fit"], schedule["home_team"], schedule["away_team"],
        schedule["neutral"].to_numpy(), ratings_fit["teams"],
        home_b2b, away_b2b, starter_edge)
    return apply_home_probs(forecast, p)


def forecast_from_fit(res: dict, schedule: pd.DataFrame) -> dict:
    """Forecast a new schedule from an earlier run_model result, without
    refitting. Used for weekly refits: fit once, forecast each day from it.
    Returns a copy of `res` with `forecast` replaced."""
    schedule = validate_games(schedule).reset_index(drop=True)
    ratings_fit = {"ratings": res["ratings"], "fit": res["fit"],
                   "teams": res["teams"]}
    stats = {"team_stats": res["team_stats"],
             "league_avg_points": res["league_avg_points"]}
    out = dict(res)
    out["forecast"] = _forecast(schedule, ratings_fit, stats, res["hybrid"],
                                res.get("w_totals", 0.6),
                                apply_starter=bool(res.get("apply_starter")))
    return out
