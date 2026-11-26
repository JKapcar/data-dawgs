"""bayesRatings — sport-agnostic Bayesian ratings pipeline.

The ratings are a Bayesian Bradley-Terry model in stan/bt_logit.stan, driven
by cmdstanpy: time-decayed across seasons, with the score margin in the
likelihood and the published win chance averaged over the posterior. The
hybrid regression layer is least squares and IRLS on numpy when called without
sample weights. The only
third-party deps are cmdstanpy, numpy, and pandas. Public entry point:
run_model. The unweighted regression layer is a numpy port of the same
least-squares and IRLS steps. """

from .games import (
    REQUIRED_GAME_COLS,
    validate_games,
    completed_games,
    upcoming_games,
)
from .team_stats import compute_team_stats
from .ratings import get_bt_model, bt_stan_data, fit_bt_ratings
from .hybrid import build_features, fit_hybrid_models
from .forecast import prob_to_american_odds, forecast_games
from .pipeline import select_rating_season, run_model

__all__ = [
    "REQUIRED_GAME_COLS",
    "validate_games",
    "completed_games",
    "upcoming_games",
    "compute_team_stats",
    "get_bt_model",
    "bt_stan_data",
    "fit_bt_ratings",
    "build_features",
    "fit_hybrid_models",
    "prob_to_american_odds",
    "forecast_games",
    "select_rating_season",
    "run_model",
]
