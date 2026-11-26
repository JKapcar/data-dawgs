# Hybrid regression layer on top of the Bayesian ratings.
# Numpy least squares and IRLS, the same steps as an unweighted lm/glm.
#
# Four models on the same feature frame:
#   mov_fit      OLS: home margin of victory  -> spreads
#   home_pts_fit OLS: home points             -> totals
#   away_pts_fit OLS: away points             -> totals
#   winprob_fit  logistic GLM: home win       -> win probability
#
# Least squares for the continuous fits, IRLS for the binomial GLM.
# No statsmodels dependency.

import warnings

import numpy as np
import pandas as pd

# design-matrix column order; the intercept column is named "(Intercept)"
FEATURE_TERMS = ["(Intercept)", "diff_rating",
                 "home_OS", "home_DS", "away_OS", "away_DS"]


def build_features(games: pd.DataFrame, ratings: pd.Series,
                   team_stats: pd.DataFrame, warn_unknown=True) -> pd.DataFrame:
    """Attach model features to a games frame (completed games or a schedule
    with NaN scores): rating difference, both teams' OS/DS, and — where scores
    exist — home margin of victory and win indicator.

    Teams missing from `ratings` or `team_stats` get rating 0 and OS = DS = 1
    with a warning, never a hard stop."""
    game_teams = pd.unique(pd.concat([games["home_team"], games["away_team"]]))
    known = set(ratings.index) & set(team_stats["team"])
    unknown = [t for t in game_teams if t not in known]
    if unknown and warn_unknown:
        warnings.warn(
            "Teams without ratings/stats (using rating 0, OS = DS = 1): "
            + ", ".join(map(str, unknown))
        )

    def rating_of(teams):
        return ratings.reindex(teams).fillna(0.0).values

    stats = team_stats.set_index("team")
    feats = pd.DataFrame({
        "season": games["season"].values,
        "date": games["date"].values,
        "home_team": games["home_team"].values,
        "away_team": games["away_team"].values,
        "home_score": games["home_score"].values,
        "away_score": games["away_score"].values,
    })
    feats["diff_rating"] = rating_of(games["home_team"]) - rating_of(games["away_team"])
    feats["h_mov"] = feats["home_score"] - feats["away_score"]
    feats["h_win"] = (feats["home_score"] > feats["away_score"]).astype(float)

    feats["home_OS"] = stats["OS"].reindex(games["home_team"]).fillna(1.0).values
    feats["home_DS"] = stats["DS"].reindex(games["home_team"]).fillna(1.0).values
    feats["away_OS"] = stats["OS"].reindex(games["away_team"]).fillna(1.0).values
    feats["away_DS"] = stats["DS"].reindex(games["away_team"]).fillna(1.0).values
    return feats


def _design(feats: pd.DataFrame) -> np.ndarray:
    return np.column_stack([
        np.ones(len(feats)),
        feats["diff_rating"].values,
        feats["home_OS"].values,
        feats["home_DS"].values,
        feats["away_OS"].values,
        feats["away_DS"].values,
    ])


def _fit_ols(X, y, sample_weight=None):
    y = np.asarray(y, dtype=float)
    if sample_weight is None:
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        return beta
    sw = np.sqrt(np.asarray(sample_weight, dtype=float))
    beta, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
    return beta


def _fit_logistic(X, y, max_iter=100, tol=1e-11, sample_weight=None):
    """Binomial GLM via IRLS. Converges to the
    maximum-likelihood estimate. `sample_weight` multiplies the IRLS
    observation weight and does not enter the working response."""
    y = np.asarray(y, dtype=float)
    sw = None if sample_weight is None else np.asarray(sample_weight, dtype=float)
    beta = np.zeros(X.shape[1])
    for _ in range(max_iter):
        eta = X @ beta
        mu = 1.0 / (1.0 + np.exp(-eta))
        var_w = np.clip(mu * (1.0 - mu), 1e-12, None)
        z = eta + (y - mu) / var_w
        obs_w = var_w if sw is None else var_w * sw
        xtw = X.T * obs_w
        beta_new = np.linalg.solve(xtw @ X, xtw @ z)
        if np.max(np.abs(beta_new - beta)) < tol:
            return beta_new
        beta = beta_new
    return beta


class _LinearModel:
    """Fitted OLS: coefficients + predict on a feature frame (like predict.lm)."""
    def __init__(self, beta):
        self.params = pd.Series(beta, index=FEATURE_TERMS)

    def predict(self, feats):
        return _design(feats) @ self.params.values


def _fit_poisson(X, y, max_iter=100, tol=1e-10, sample_weight=None):
    """Poisson GLM with log link via IRLS."""
    y = np.asarray(y, dtype=float)
    sw = None if sample_weight is None else np.asarray(sample_weight, dtype=float)
    beta = np.zeros(X.shape[1])
    beta[0] = np.log(max(y.mean(), 1e-3))
    for _ in range(max_iter):
        eta = X @ beta
        mu = np.exp(eta)
        z = eta + (y - mu) / mu
        obs_w = mu if sw is None else mu * sw
        xtw = X.T * obs_w
        beta_new = np.linalg.solve(xtw @ X + 1e-8 * np.eye(X.shape[1]), xtw @ z)
        if np.max(np.abs(beta_new - beta)) < tol:
            return beta_new
        beta = beta_new
    return beta


def _nb_alpha(y, mu, sample_weight=None):
    """Moment estimate of negative binomial (NB2) dispersion:
    Var = mu + alpha * mu^2. alpha = 0 means plain Poisson."""
    y = np.asarray(y, dtype=float)
    if sample_weight is None:
        return max(0.0, float(np.sum((y - mu) ** 2 - mu) / np.sum(mu ** 2)))
    w = np.asarray(sample_weight, dtype=float)
    return max(0.0, float(np.sum(w * ((y - mu) ** 2 - mu)) / np.sum(w * mu ** 2)))


class _CountModel:
    """Fitted log-link count GLM (Poisson, or negative binomial when alpha > 0).
    predict returns the expected count. Both families share the same mean
    model; negative binomial adds the dispersion alpha."""
    def __init__(self, beta, family, alpha=0.0):
        self.params = pd.Series(beta, index=FEATURE_TERMS)
        self.family = family
        self.alpha = alpha

    def predict(self, feats):
        return np.exp(_design(feats) @ self.params.values)


class _LogisticModel:
    """Fitted binomial GLM; predict returns probabilities (type='response')."""
    def __init__(self, beta):
        self.params = pd.Series(beta, index=FEATURE_TERMS)

    def predict(self, feats):
        eta = _design(feats) @ self.params.values
        return 1.0 / (1.0 + np.exp(-eta))


# Expected-points model per league, chosen by the 2026-10 walk-forward backtest.
# Leagues not listed keep the OLS blend.
POINTS_MODELS = {"mlb": "negbin", "nhl": "poisson"}
VALID_POINTS_MODELS = ("ols", "poisson", "negbin")


def points_model_for(league) -> str:
    return POINTS_MODELS.get(str(league).lower(), "ols")


def fit_hybrid_models(games: pd.DataFrame, ratings: pd.Series,
                      team_stats: pd.DataFrame, points_model: str = "ols",
                      sample_weight=None) -> dict:
    """Fit the four hybrid models on the games passed in.

    `sample_weight` (one per row, same order as `games`) is the time-decay
    weight. The features are the current ratings and the current OS/DS, so
    the weights are what keep an old game from counting like yesterday: the
    caller passes the same window the rating fit used. Neutral-site rows are
    dropped, and their weights with them. Past teams with no rating get
    rating 0 and OS = DS = 1 without a warning; forecast still warns."""
    w = None if sample_weight is None else np.asarray(sample_weight, dtype=float)
    if w is not None and len(w) != len(games):
        raise ValueError("sample_weight must match games row for row.")
    if "neutral" in games.columns:
        # a "home" label at a neutral site means nothing; don't learn home edge from it
        keep = games["neutral"].fillna(0).astype(int).to_numpy() == 0
        games = games.iloc[np.flatnonzero(keep)]
        if w is not None:
            w = w[keep]
    feats = build_features(games, ratings, team_stats, warn_unknown=False)
    X = _design(feats)
    if points_model not in VALID_POINTS_MODELS:
        raise ValueError(f"unknown points_model: {points_model!r}")
    out = {
        "points_model": points_model,
        "mov_fit": _LinearModel(_fit_ols(X, feats["h_mov"], w)),
        "home_pts_fit": _LinearModel(_fit_ols(X, feats["home_score"], w)),
        "away_pts_fit": _LinearModel(_fit_ols(X, feats["away_score"], w)),
        "winprob_fit": _LogisticModel(_fit_logistic(X, feats["h_win"], sample_weight=w)),
    }
    if points_model != "ols":
        for key, col in (("home_count_fit", "home_score"), ("away_count_fit", "away_score")):
            y = feats[col].values.astype(float)
            beta = _fit_poisson(X, y, sample_weight=w)
            alpha = (_nb_alpha(y, np.exp(X @ beta), w) if points_model == "negbin"
                     else 0.0)
            out[key] = _CountModel(beta, points_model, alpha)
    return out
