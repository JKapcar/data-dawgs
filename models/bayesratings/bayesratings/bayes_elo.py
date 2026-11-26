"""Dynamic Bayesian Elo, the second forecast in the published win probability.

The Bayesian logit (ratings.py) stays the stored team rating. Each
daily run also fits stan/bayes_elo_dynamic.stan per league and blends its win
probability in:

    published home_prob = (1 - w) * p_logit + w * p_elo

p_logit is the live forecast after the MLB/NHL starter adjustment. w is one
weight per league and season (WEIGHTS below).

The Elo model (BSMR chapter 13, made dynamic): ratings update game by game
inside the Stan likelihood, so the update size K is estimated per league. The
update is scaled by a margin multiplier ((1 + ln(1 + |margin|)) / (1 + mean))
^ lambda, overtime and shootout results count fully (same weights as the
logit), neutral sites get no home edge, and at each team's first game of a
new season its rating regresses
toward 1500 by `carry`. Priors: rating0 ~ normal(1500, 50), home_adv ~
normal(50, 25) (>= 0), K ~ lognormal(log 20, 1), lambda ~ half-normal(0, 1),
carry ~ beta(6, 3). This is the model backtested in Oct 2026.

Data: completed regular and postseason games before the fit cutoff (the
same cutoff as the logit; `WEEKLY_REFIT` is empty, so that cutoff is today),
exhibition teams excluded, from the latest season and the SEASONS_BACK
seasons before it.

Forecasts use the posterior ratings after the last fitted game, with a team's
offseason regression applied when the game is in a later season than its last
fitted game, averaged over draws.

Robustness: any error, too few games, max R-hat above MAX_RHAT or too many
divergences -> no p_elo for that league; the logit is published alone
(elo_weight 0) and the daily status line says "WARN elo fallback", which the
pipeline check (prelog check) reports as a WARN.

Weights (WEIGHTS): the stacking weight that maximizes the summed log score of
the stack over every earlier walk-forward out-of-sample season (no
lookahead), the same rule in every league. Refit at each league's season
start, once the previous season is complete:
  1. Walk the finished season forward so its out-of-sample p_elo exists.
  2. Fit the stacking weight on every out-of-sample season so far.
  3. Add a WEIGHTS entry for (league, new season) with fit_seasons and
     n_games, and bump WEIGHTS_VERSION.
A season with no entry uses the latest earlier season's weight (noted in the
daily run notes).
"""

import logging
import time
from pathlib import Path

import numpy as np
import pandas as pd
from cmdstanpy import CmdStanModel

from . import db
from .forecast import apply_home_probs
from .weights import result_weights

STAN_FILE = Path(__file__).resolve().parent.parent / "stan" / "bayes_elo_dynamic.stan"
ELO_VERSION = "bayeselo-dyn-v1"
WEIGHTS_VERSION = "2026-10-17"
C = np.log(10) / 400
SEASONS_BACK = 5          # latest season + 5 before it (the backtest's ~5 seasons)
CHAINS, WARMUP, SAMPLES = 4, 500, 500
MAX_RHAT = 1.05           # on K, lambda, carry, home_adv and the final ratings
MAX_DIV_FRAC = 0.005      # divergent transitions / post-warmup draws
MIN_GAMES = 100
PARS = ("K", "lambda", "carry", "home_adv")
AUDIT_COLS = ("p_logit", "p_elo", "elo_weight", "model_version")

# One stacking weight on p_elo per (league, season it applies to). Fit by
# the Oct 2026 walk-forward (see the module docstring) on every out-of-sample
# out-of-sample season through the latest complete one. NBA: set to 0.5
# (Oct 17 2026; the fit gave 1.0) so the logit keeps half the NBA win chance.
WEIGHTS = {
    ("mlb", 2026): {"w": 0.2415, "fit_seasons": (2022, 2025), "n_games": 9890},
    ("nba", 2027): {"w": 0.5, "fit_seasons": (2023, 2026), "n_games": 5258},
    ("nfl", 2026): {"w": 0.8315, "fit_seasons": (2022, 2025), "n_games": 1136},
    ("nhl", 2027): {"w": 0.1033, "fit_seasons": (2023, 2026), "n_games": 5591},
}

_MODEL = None


def get_elo_model(stan_file=STAN_FILE) -> CmdStanModel:
    """Compiled once; cmdstanpy keeps the binary next to the .stan file
    (stan/bayes_elo_dynamic, gitignored), so later runs only load it."""
    global _MODEL
    if Path(stan_file) != STAN_FILE:
        return CmdStanModel(stan_file=str(stan_file))
    if _MODEL is None:
        _MODEL = CmdStanModel(stan_file=str(STAN_FILE))
    return _MODEL


def weight_for(league: str, season: int):
    """(w, note). The entry for `season`, else the latest earlier season's
    (note says so), else no weight (w=None)."""
    if (league, season) in WEIGHTS:
        return WEIGHTS[(league, season)]["w"], None
    older = sorted(s for (lg, s) in WEIGHTS if lg == league and s < season)
    if older:
        return WEIGHTS[(league, older[-1])]["w"], f"elo weight from {older[-1]} (no {season} entry)"
    return None, f"no elo weight for {league} {season}"


# ---------------------------------------------------------------- data

def load_games(conn, league: str, cutoff: str) -> pd.DataFrame:
    """Completed regular/postseason games before `cutoff` (ISO date), in start
    order, from the latest SEASONS_BACK + 1 seasons. Same filter as the
    backtest (exhibition teams excluded)."""
    nx = db.not_exhibition_sql(db.exhibition_team_ids(conn, league))
    g = pd.read_sql_query(
        "SELECT espn_event_id, season, game_date AS date, "
        "home_team_id AS home, away_team_id AS away, home_score, away_score, "
        "COALESCE(neutral_site, 0) AS neutral, ending FROM games "
        f"WHERE league = ? AND season_type IN (2, 3) AND completed = 1 AND {nx} "
        "AND home_score IS NOT NULL AND away_score IS NOT NULL AND game_date < ? "
        "ORDER BY start_time_utc, espn_event_id", conn, params=(league, cutoff))
    if len(g):
        g = g[g["season"] >= int(g["season"].max()) - SEASONS_BACK]
    return prepare(g)


def prepare(g: pd.DataFrame) -> pd.DataFrame:
    g = g.reset_index(drop=True).copy()
    g["margin"] = (g["home_score"] - g["away_score"]).astype(float)
    g["y"] = np.where(g["margin"] > 0, 1.0, np.where(g["margin"] < 0, 0.0, 0.5))
    # Same multipliers as the logit (weights.result_weights): overtime and
    # shootout count fully. A frame with no `ending` column counts every game fully.
    if "ending" not in g.columns:
        g["ending"] = ""
    g["w"] = result_weights(g)
    g["neutral"] = g["neutral"].fillna(0).astype(int).clip(0, 1)
    return g


def new_season_flags(g: pd.DataFrame):
    """1 at a team's first game of a season if it played in an earlier season
    of this frame (never at its first game ever)."""
    last, hf, af = {}, np.zeros(len(g), int), np.zeros(len(g), int)
    for i, (h, a, s) in enumerate(zip(g["home"].to_numpy(), g["away"].to_numpy(),
                                      g["season"].to_numpy())):
        for t, out in ((int(h), hf), (int(a), af)):
            if t in last and last[t] != s:
                out[i] = 1
            last[t] = s
    return hf, af


def stan_data(train: pd.DataFrame, sched: pd.DataFrame):
    """Stan data for the fit, and team id -> 1-based index. Teams only in the
    schedule are included and keep their prior (mean 1500)."""
    ids = pd.unique(pd.concat([train["home"], train["away"],
                               sched["home"], sched["away"]]).astype(int))
    teams = {int(t): i + 1 for i, t in enumerate(ids)}
    hf, af = new_season_flags(train)
    d = {"N": int(len(train)), "T": int(len(teams)),
         "home": [teams[int(t)] for t in train["home"]],
         "away": [teams[int(t)] for t in train["away"]],
         "score": train["y"].astype(float).tolist(),
         "margin": train["margin"].astype(float).tolist(),
         "neutral": train["neutral"].astype(int).tolist(),
         "result_weight": train["w"].astype(float).tolist(),
         "home_new_season": hf.tolist(), "away_new_season": af.tolist(),
         "N_new": 0, "home_new": [], "away_new": [], "neutral_new": [],
         "new_season_new": []}
    return d, teams


# ---------------------------------------------------------------- fit + forecast

def fit(model, train, sched, seed: int = 20261017):
    """Sample the posterior. Returns (draws, teams, diag)."""
    d, teams = stan_data(train, sched)
    f = model.sample(data=d, chains=CHAINS, parallel_chains=CHAINS,
                     iter_warmup=WARMUP, iter_sampling=SAMPLES, seed=seed,
                     show_progress=False)
    draws = {p: f.stan_variable(p) for p in PARS + ("final_rating",)}
    s = f.summary()
    keys = [i for i in s.index if i in PARS or i.startswith("final_rating")]
    div = int(f.method_variables()["divergent__"].sum())
    diag = {"max_rhat": float(s.loc[keys, "R_hat"].max()),
            "divergences": div, "n_draws": int(CHAINS * SAMPLES),
            "n_games": d["N"], **{p: float(draws[p].mean()) for p in PARS}}
    return draws, teams, diag


def check(diag: dict) -> list:
    """Reasons the fit must not be used (empty = OK)."""
    bad = []
    if not np.isfinite(diag["max_rhat"]) or diag["max_rhat"] > MAX_RHAT:
        bad.append(f"R-hat {diag['max_rhat']:.3f} > {MAX_RHAT}")
    if diag["divergences"] > MAX_DIV_FRAC * diag["n_draws"]:
        bad.append(f"{diag['divergences']} divergences")
    return bad


def forecast_probs(draws, teams, train, sched) -> np.ndarray:
    """Posterior-mean P(home win) per schedule row from the final ratings,
    with each team's offseason regression applied if the game is in a later
    season than that team's last fitted game."""
    R = draws["final_rating"]
    carry, hadv = draws["carry"], draws["home_adv"]
    last = {}
    for h, a, s in zip(train["home"], train["away"], train["season"]):
        last[int(h)] = s
        last[int(a)] = s
    out = np.empty(len(sched))
    for j, (h, a, s, neu) in enumerate(zip(sched["home"], sched["away"],
                                           sched["season"], sched["neutral"])):
        rh = R[:, teams[int(h)] - 1]
        ra = R[:, teams[int(a)] - 1]
        if int(h) in last and last[int(h)] != s:
            rh = 1500 + carry * (rh - 1500)
        if int(a) in last and last[int(a)] != s:
            ra = 1500 + carry * (ra - 1500)
        edge = rh - ra + hadv * (1 - int(neu))
        out[j] = float((1 / (1 + np.exp(-C * edge))).mean())
    return out


def stack(p_logit, p_elo, w: float) -> np.ndarray:
    return (1 - w) * np.asarray(p_logit, float) + w * np.asarray(p_elo, float)


def schedule_frame(sched: pd.DataFrame) -> pd.DataFrame:
    """daily.todays_schedule rows -> home/away ints, season, neutral."""
    return pd.DataFrame({"home": sched["home_team"].astype(int).to_numpy(),
                         "away": sched["away_team"].astype(int).to_numpy(),
                         "season": sched["season"].astype(int).to_numpy(),
                         "neutral": pd.to_numeric(sched["neutral"], errors="coerce")
                         .fillna(0).astype(int).clip(0, 1).to_numpy()})


def elo_probs(conn, league: str, sched: pd.DataFrame, cutoff: str, model=None) -> dict:
    """p_elo for every schedule row, or p_elo=None with the reason. Never
    raises: any failure is a fallback."""
    out = {"p_elo": None, "notes": [], "diag": None}
    try:
        train = load_games(conn, league, cutoff)
        if len(train) < MIN_GAMES:
            out["notes"].append(f"elo fallback: {len(train)} games")
            return out
        sf = schedule_frame(sched)
        seed = int(cutoff.replace("-", "")) % 2**31
        t0 = time.monotonic()
        draws, teams, diag = fit(model or get_elo_model(), train, sf, seed=seed)
        diag["seconds"] = round(time.monotonic() - t0, 1)
        out["diag"] = diag
        bad = check(diag)
        if bad:
            out["notes"].append("elo fallback: " + ", ".join(bad))
            return out
        p = forecast_probs(draws, teams, train, sf)
        if not np.isfinite(p).all():
            out["notes"].append("elo fallback: non-finite forecast")
            return out
        out["p_elo"] = p
    except Exception as e:  # the 6 AM run must never fail because of Elo
        logging.getLogger(__name__).exception("bayes elo failed")
        out["notes"].append(f"elo fallback: {type(e).__name__}: {e}"[:200])
    return out


def apply_stack(forecast: pd.DataFrame, sched: pd.DataFrame, league: str, p_elo):
    """Publish the stacked win chance and attach AUDIT_COLS. With p_elo None
    (fallback) the logit is published unchanged, elo_weight 0.
    Returns (forecast, notes)."""
    f = forecast.copy()
    p_logit = f["home_prob"].to_numpy(float)
    seasons = sched["season"].astype(int).to_numpy()
    notes = []
    w = np.zeros(len(f))
    if p_elo is not None:
        for s in sorted(set(seasons)):
            ws, note = weight_for(league, int(s))
            if note:
                notes.append(note)
            w[seasons == s] = ws if ws is not None else 0.0
    if p_elo is not None and (w > 0).any():
        f = apply_home_probs(f, stack(p_logit, p_elo, w))
    f["p_logit"] = p_logit
    f["p_elo"] = np.asarray(p_elo, float) if p_elo is not None else np.nan
    f["elo_weight"] = w
    f["model_version"] = (f"logit+{ELO_VERSION}/w{WEIGHTS_VERSION}" if p_elo is not None
                          else "logit-only:elo-fallback")
    return f, notes
