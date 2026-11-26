# Bayesian Bradley-Terry ratings via Stan.
#
# The fit is still the Bayesian logit in stan/bt_logit.stan, driven by
# cmdstanpy. Games are time-weighted, the score margin shares the latent edge, and
# overtime and shootout results count fully on the win/loss term. NBA and NHL
# add a home and an away back-to-back shift on the same edge. MLB gives the
# margin term its own home edge, in runs. MLB and NHL add a starter covariate
# (starting pitcher, starting goalie) on the edge; the coefficient is estimated
# in the fit. The published win probability is the mean of the inverse-logit
# over posterior draws, not the inverse-logit of the mean rating.

import logging
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from cmdstanpy import CmdStanModel

from .weights import result_weights

STAN_FILE = Path(__file__).resolve().parent.parent / "stan" / "bt_logit.stan"


def _quiet_cmdstanpy():
    """Silence cmdstanpy's console chatter: the per-chain INFO lines and the
    benign "Non-fatal error … Scale parameter is 0/inf" rejections Stan emits
    while adapting a hierarchical scale parameter. They are step
    rejections during warmup, not fit problems. We replace this noise with an
    explicit divergence check after the fit, so real trouble still surfaces.
    The handler level is the reliable lever — cmdstanpy resets the logger level
    itself."""
    lg = logging.getLogger("cmdstanpy")
    lg.setLevel(logging.ERROR)
    for h in lg.handlers:
        h.setLevel(logging.ERROR)


_quiet_cmdstanpy()


def get_bt_model(stan_file=STAN_FILE) -> CmdStanModel:
    """Compile (or load the cached build of) the rating model. cmdstanpy caches
    the compiled binary next to the .stan file, so compilation is paid once and
    one compiled model serves every league."""
    return CmdStanModel(stan_file=str(stan_file))


def back_to_back_flags(games: pd.DataFrame, history: pd.DataFrame = None):
    """Home and away back-to-back flags, aligned to `games`.

    A side is 1 when that team has a game on the previous calendar day.
    Only games dated strictly before the row count: `history` first, then
    earlier dates in `games`. A same-day doubleheader is not a back-to-back.
    The date column is the calendar game date (US local / CT is fine).
    """
    n = len(games)
    home_b2b = np.zeros(n, dtype=int)
    away_b2b = np.zeros(n, dtype=int)
    played = {}

    def add_pairs(teams, dates):
        for team, d in zip(teams, dates):
            played.setdefault(str(team), set()).add(np.datetime64(d, "D"))

    if history is not None and len(history):
        hd = pd.to_datetime(history["date"]).dt.normalize()
        add_pairs(history["home_team"].to_numpy(), hd.to_numpy())
        add_pairs(history["away_team"].to_numpy(), hd.to_numpy())
    if n == 0:
        return home_b2b, away_b2b

    dates = pd.to_datetime(games["date"]).dt.normalize().to_numpy()
    home = games["home_team"].astype(str).to_numpy()
    away = games["away_team"].astype(str).to_numpy()
    order = np.argsort(dates, kind="mergesort")
    i = 0
    while i < len(order):
        j = i + 1
        day = np.datetime64(dates[order[i]], "D")
        while j < len(order) and np.datetime64(dates[order[j]], "D") == day:
            j += 1
        prev = day - np.timedelta64(1, "D")
        for k in order[i:j]:
            if prev in played.get(home[k], ()):
                home_b2b[k] = 1
            if prev in played.get(away[k], ()):
                away_b2b[k] = 1
        for k in order[i:j]:
            played.setdefault(home[k], set()).add(day)
            played.setdefault(away[k], set()).add(day)
        i = j
    return home_b2b, away_b2b


def attach_b2b(games: pd.DataFrame, history: pd.DataFrame = None) -> pd.DataFrame:
    """Copy `games` with `home_b2b` and `away_b2b` columns."""
    g = games.copy()
    home_b2b, away_b2b = back_to_back_flags(g, history)
    g["home_b2b"] = home_b2b
    g["away_b2b"] = away_b2b
    return g


def _b2b_lists(games: pd.DataFrame):
    """Stan back-to-back vectors. Missing columns are zeros (MLB, NFL)."""
    n = len(games)
    if "home_b2b" not in games.columns or "away_b2b" not in games.columns:
        return [0] * n, [0] * n
    home_b2b = games["home_b2b"].fillna(0).astype(int).clip(0, 1).tolist()
    away_b2b = games["away_b2b"].fillna(0).astype(int).clip(0, 1).tolist()
    return home_b2b, away_b2b


def _starter_list(games: pd.DataFrame, starter: bool) -> list:
    """Stan starter-edge vector. Off, or a missing column, is zeros."""
    n = len(games)
    if not starter or "starter_edge" not in games.columns:
        return [0.0] * n
    return games["starter_edge"].fillna(0).astype(float).tolist()


def bt_stan_data(games: pd.DataFrame, team_ids: dict, sigma_scale: float = 1.0,
                 ot_weight=None, so_weight=None, margin_home: bool = False,
                 starter: bool = False) -> dict:
    """Build the Stan data dict from completed games. Ties count as home
    losses, matching the h_win = (mov > 0) definition. Missing time weights
    count every game fully. Missing back-to-back columns are zeros.
    `sigma_scale` is the prior scale of the team-rating sd (1, or 0.5 for MLB and NHL).
    `ot_weight` / `so_weight` override the live result multipliers.
    `margin_home` gives the margin term its own home edge (MLB). `starter`
    passes `starter_edge` (home relative quality minus away); otherwise the
    covariate is zero and its coefficient does not move a probability."""
    n = len(games)
    if "time_weight" in games.columns:
        time_weight = games["time_weight"].to_numpy(dtype=float).tolist()
    else:
        time_weight = [1.0] * n
    margin = (games["home_score"].to_numpy(dtype=float)
              - games["away_score"].to_numpy(dtype=float))
    home_b2b, away_b2b = _b2b_lists(games)
    return {
        "N": int(n),
        "T": int(len(team_ids)),
        "home_team": [team_ids[t] for t in games["home_team"]],
        "away_team": [team_ids[t] for t in games["away_team"]],
        "outcome": (games["home_score"].to_numpy() > games["away_score"].to_numpy()).astype(int).tolist(),
        "neutral": neutral_flags(games),
        "time_weight": time_weight,
        "result_weight": result_weights(games, ot=ot_weight, shootout=so_weight).tolist(),
        "margin": margin.tolist(),
        "home_b2b": home_b2b,
        "away_b2b": away_b2b,
        "starter_edge": _starter_list(games, starter),
        "margin_home": int(bool(margin_home)),
        "sigma_scale": float(sigma_scale),
    }


def neutral_flags(games: pd.DataFrame) -> list:
    """1 for neutral-site games (no home edge), else 0. Missing column = all 0."""
    if "neutral" not in games.columns:
        return [0] * len(games)
    return games["neutral"].fillna(0).astype(int).clip(0, 1).tolist()


def _point_estimates(fit, teams) -> dict:
    """Posterior means for the rating vector (named by team) and home_adv."""
    ratings = fit.stan_variable("rating").mean(axis=0)
    home_adv = float(fit.stan_variable("home_adv").mean())
    return {
        "ratings": pd.Series(ratings, index=teams),
        "home_adv": home_adv,
    }


def _sample(stan_model, data, iter_sampling, iter_warmup, chains, seed,
            parallel_chains=None):
    _quiet_cmdstanpy()  # cmdstanpy can re-raise its log level per call
    kw = dict(
        data=data,
        iter_sampling=iter_sampling,
        iter_warmup=iter_warmup,
        chains=chains,
        seed=seed,
        show_progress=False,
        show_console=False,
    )
    # None keeps cmdstanpy's default (every chain at once). The history
    # A history backfill passes 1 so the chains run one at a time.
    if parallel_chains is not None:
        kw["parallel_chains"] = int(parallel_chains)
    return stan_model.sample(**kw)


def _data_kwargs(sigma_scale, ot_weight, so_weight, margin_home, starter) -> dict:
    return {"sigma_scale": sigma_scale, "ot_weight": ot_weight, "so_weight": so_weight,
            "margin_home": margin_home, "starter": starter}


def _b2b_args(games):
    if "home_b2b" not in games.columns:
        return None, None
    return games["home_b2b"].to_numpy(), games["away_b2b"].to_numpy()


def _starter_arg(games, starter):
    if not starter or "starter_edge" not in games.columns:
        return None
    return games["starter_edge"].fillna(0).to_numpy()


def fit_bt_ratings(games: pd.DataFrame, stan_model,
                   evaluate=True, holdout_frac=0.2,
                   iter=2000, warmup=500, chains=4, seed=123,
                   eval_iter=2000, sigma_scale: float = 1.0,
                   b2b: bool = False, ot_weight=None, so_weight=None,
                   margin_home: bool = False, starter: bool = False,
                   parallel_chains=None) -> dict:
    """Fit Bayesian ratings on completed games.

    Evaluation uses a chronological holdout: train on the first
    (1 - holdout_frac) of games by date, score the rest — a random split would
    leak future results into training.

    Returns {ratings, home_adv, eval, fit, teams}:
      ratings  zero-centered posterior means, indexed by team (pandas Series)
      home_adv posterior mean (logit scale)
      eval     {log_loss, accuracy, n_train, n_test} or None. log loss is the
               posterior-averaged win probability, not the plug-in at the mean
      fit      the full-data CmdStanMCMC (diagnostics + posterior draws)
      teams    column order of the rating draws
    """
    games = games.sort_values("date").reset_index(drop=True)
    if b2b and "home_b2b" not in games.columns:
        games = attach_b2b(games)
    data_kw = _data_kwargs(sigma_scale, ot_weight, so_weight, margin_home, starter)

    n_ties = int((games["home_score"] == games["away_score"]).sum())
    if n_ties > 0:
        warnings.warn(
            f"{n_ties} tied game(s) treated as home losses; forecasts are "
            "outright home-win probabilities (away_prob includes draws)."
        )

    teams = sorted(pd.unique(pd.concat([games["home_team"], games["away_team"]])))
    team_ids = {t: i + 1 for i, t in enumerate(teams)}  # Stan is 1-indexed

    eval_result = None
    if evaluate:
        n_train = int(np.floor((1 - holdout_frac) * len(games)))
        if 10 <= n_train < len(games):
            train = games.iloc[:n_train]
            test = games.iloc[n_train:]
            train_fit = _sample(
                stan_model, bt_stan_data(train, team_ids, **data_kw),
                iter_sampling=eval_iter - eval_iter // 2,
                iter_warmup=eval_iter // 2, chains=chains, seed=seed,
                parallel_chains=parallel_chains,
            )
            # score the posterior predictive, the same probability the
            # forecast publishes, not the inverse-logit of the mean rating
            home_b2b, away_b2b = _b2b_args(test)
            prob = posterior_home_prob(
                train_fit, test["home_team"], test["away_team"],
                neutral_flags(test), teams, home_b2b, away_b2b,
                _starter_arg(test, starter))
            eps = np.finfo(float).eps
            prob = np.clip(prob, eps, 1 - eps)
            h_win = (test["home_score"].values > test["away_score"].values).astype(int)
            eval_result = {
                "log_loss": float(np.mean(-(h_win * np.log(prob)
                                            + (1 - h_win) * np.log(1 - prob)))),
                "accuracy": float(np.mean((prob > 0.5).astype(int) == h_win)),
                "n_train": int(len(train)),
                "n_test": int(len(test)),
            }
        else:
            warnings.warn("Too few games for a holdout evaluation; skipping.")

    fit = _sample(
        stan_model, bt_stan_data(games, team_ids, **data_kw),
        iter_sampling=iter - warmup, iter_warmup=warmup, chains=chains, seed=seed,
        parallel_chains=parallel_chains,
    )

    # real convergence signal, since we silence cmdstanpy's per-step noise
    try:
        n_div = int(fit.method_variables()["divergent__"].sum())
        if n_div > 0:
            warnings.warn(
                f"{n_div} divergent transition(s) in the ratings fit — "
                "inspect diagnostics before trusting the posterior."
            )
    except Exception:
        pass

    est = _point_estimates(fit, teams)

    return {
        "ratings": est["ratings"] - est["ratings"].mean(),  # zero-centered
        "home_adv": est["home_adv"],
        "eval": eval_result,
        "fit": fit,
        "teams": teams,
    }


def _coef(fit, name: str, n_draws: int) -> np.ndarray:
    """Posterior draws of one scalar, or zeros when the fit has no such parameter."""
    try:
        return np.ravel(np.asarray(fit.stan_variable(name), dtype=float))
    except Exception:
        return np.zeros(n_draws)


def posterior_home_prob(fit, home_team, away_team, neutral, teams,
                        home_b2b=None, away_b2b=None, starter_edge=None) -> np.ndarray:
    """P(home win) averaged over posterior draws of ratings and home edge.

    Each draw is zero-centered first, so a team absent from the fit (filled
    with 0) is an average team, matching the centered point ratings. The
    difference between two teams that are in the fit is unchanged by that
    centering. `home_b2b` / `away_b2b` add the back-to-back shifts.
    `starter_edge` adds the starter coefficient times that covariate.
    Omitted flags, a zero covariate, or a fit without those coefficients,
    leave the edge unchanged. The margin's own home edge does not enter
    this probability; it only changes the ratings through the fit."""
    draws = np.asarray(fit.stan_variable("rating"), dtype=float)
    draws = draws - draws.mean(axis=1, keepdims=True)
    ha = np.ravel(np.asarray(fit.stan_variable("home_adv"), dtype=float))
    index = {str(t): i for i, t in enumerate(teams)}

    def take(names):
        cols = np.zeros((draws.shape[0], len(names)))
        for j, name in enumerate(names):
            i = index.get(str(name))
            if i is not None:
                cols[:, j] = draws[:, i]
        return cols

    neut = np.asarray(neutral, dtype=float).reshape(-1)
    eta = (take(list(home_team)) - take(list(away_team))
           + ha[:, None] * (1.0 - neut)[None, :])
    n_games = eta.shape[1]
    hb = (np.zeros(n_games) if home_b2b is None
          else np.asarray(home_b2b, dtype=float).reshape(-1))
    ab = (np.zeros(n_games) if away_b2b is None
          else np.asarray(away_b2b, dtype=float).reshape(-1))
    if len(hb) != n_games or len(ab) != n_games:
        raise ValueError("back-to-back flags must match the number of games.")
    if hb.any() or ab.any():
        eta = (eta
               + _coef(fit, "b2b_home", draws.shape[0])[:, None] * hb[None, :]
               + _coef(fit, "b2b_away", draws.shape[0])[:, None] * ab[None, :])
    if starter_edge is not None:
        se = np.asarray(starter_edge, dtype=float).reshape(-1)
        if len(se) != n_games:
            raise ValueError("starter edge must match the number of games.")
        if np.any(se):
            eta = eta + _coef(fit, "starter_coef", draws.shape[0])[:, None] * se[None, :]
    return (1.0 / (1.0 + np.exp(-eta))).mean(axis=0)
