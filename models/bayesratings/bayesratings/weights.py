# Time-decay and result weights for the rating likelihood.
#
# The model stays sport-agnostic: it never sees a league name. Decay is a
# function of the game date. `ending` of "ot" or "shootout" (NHL games; the
# other leagues leave it empty) selects the overtime and shootout multipliers.
# Those multipliers are 1: an overtime or shootout result counts fully on the
# win/loss term. The margin term is not scaled by them either way.

import numpy as np
import pandas as pd

# A game one half-life old counts half as much as a game today. 180 days
# keeps most of last season in the fit on opening day and lets it fade
# through the new season, with no hard switch.
HALF_LIFE_DAYS = 180
# Per-league overrides, passed in by the caller (the model never sees a
# league). NBA form turns over faster. A 2025-26 checkpoint scored 120 days
# best; the 2026-11 tuneup moved NBA to 90. MLB, NFL and NHL stay at 180.
HALF_LIFE_BY_LEAGUE = {"nba": 90}
# Drop games that would count less than this. At a 180-day half-life that
# is about 2.1 years back (about 1.1 years at 90), so the fit is a rolling
# window, not the full archive.
MIN_WEIGHT = 0.05

# Multipliers on the win/loss term only. The score margin is not scaled by
# these: a one-goal overtime game remains a close game. Both are 1, so an
# overtime or shootout result counts the same as regulation.
OT_RESULT_WEIGHT = 1.0
SHOOTOUT_RESULT_WEIGHT = 1.0

# Prior scale for the team-rating sd in the Stan model:
# sigma ~ student_t(3, 0, scale). NHL and MLB use half the default.
# NBA and NFL stay at 1.
SIGMA_SCALE = 1.0
SIGMA_SCALE_BY_LEAGUE = {"nhl": 0.5, "mlb": 0.5}

# Leagues whose game edge includes a home and an away back-to-back flag.
# MLB and NFL pass zeros.
B2B_LEAGUES = frozenset({"nba", "nhl"})

# MLB's margin term has its own home edge, in runs. Other leagues keep
# the win/loss home edge on the margin (margin_scale * eta).
MARGIN_HOME_LEAGUES = frozenset({"mlb"})

# MLB starting pitcher and NHL starting goalie enter the rating edge.
# NBA and NFL pass a zero covariate.
STARTER_LEAGUES = frozenset({"mlb", "nhl"})


def half_life_for(league: str) -> int:
    """Half-life in days for a league; HALF_LIFE_DAYS unless overridden."""
    return HALF_LIFE_BY_LEAGUE.get(str(league).lower(), HALF_LIFE_DAYS)


def sigma_scale_for(league: str) -> float:
    """Prior scale of the team-rating sd. SIGMA_SCALE unless overridden."""
    return float(SIGMA_SCALE_BY_LEAGUE.get(str(league).lower(), SIGMA_SCALE))


def use_b2b(league: str) -> bool:
    """True when the league's rating edge includes back-to-back flags."""
    return str(league).lower() in B2B_LEAGUES


def use_margin_home(league: str) -> bool:
    """True when the margin term has its own home edge, in points."""
    return str(league).lower() in MARGIN_HOME_LEAGUES


def use_starter(league: str) -> bool:
    """True when starter quality is a covariate on the rating edge."""
    return str(league).lower() in STARTER_LEAGUES


def league_fit_kwargs(league: str) -> dict:
    """Arguments `run_model` takes so a league uses its half-life, back-to-back
    covariates, margin home edge, starter covariate, and rating-scale prior.
    NBA keeps the step-1 settings (90 days, back-to-back, no starter, unit
    rating-scale prior). NFL stays on the defaults. NHL adds the goalie
    covariate on top of the step-1 settings (half-life 180, back-to-back,
    rating-scale prior 0.5). MLB adds the margin home edge, the
    starting-pitcher covariate, and the same 0.5 rating-scale prior."""
    return {
        "half_life_days": half_life_for(league),
        "b2b": use_b2b(league),
        "sigma_scale": sigma_scale_for(league),
        "margin_home": use_margin_home(league),
        "starter": use_starter(league),
    }


def time_weights(dates, as_of=None, half_life_days=HALF_LIFE_DAYS) -> np.ndarray:
    """Exponential decay by calendar age. The newest date has weight 1."""
    dates = pd.to_datetime(pd.Series(dates))
    as_of = pd.Timestamp(dates.max() if as_of is None else as_of)
    age = (as_of.normalize() - dates.dt.normalize()).dt.days.to_numpy(dtype=float)
    age = np.clip(age, 0, None)
    return np.power(0.5, age / float(half_life_days))


def result_weights(games: pd.DataFrame, ot=None, shootout=None) -> np.ndarray:
    """Per-game multiplier for the win/loss term. Missing endings count fully.

    `ot` and `shootout` override the module constants (the walk-forward
    comparison refits the previous multipliers without changing the live ones).
    """
    ot_w = OT_RESULT_WEIGHT if ot is None else float(ot)
    so_w = SHOOTOUT_RESULT_WEIGHT if shootout is None else float(shootout)
    w = np.ones(len(games), dtype=float)
    if "ending" not in games.columns or len(games) == 0:
        return w
    ending = games["ending"].fillna("").astype(str).str.strip().str.lower()
    w[ending.eq("ot").to_numpy()] = ot_w
    w[ending.eq("shootout").to_numpy()] = so_w
    return w


def decay_window(games: pd.DataFrame, half_life_days=HALF_LIFE_DAYS,
                 min_weight=MIN_WEIGHT, season_override=None) -> pd.DataFrame:
    """Games that still carry weight, with a `time_weight` column.

    `season_override` restricts the frame first (a debug hatch). The default
    fit does not pick a season."""
    g = games
    if season_override is not None:
        if season_override not in set(g["season"]):
            raise ValueError(
                f"season_override {season_override} has no completed games."
            )
        g = g[g["season"] == season_override]
    g = g.copy()
    g["time_weight"] = time_weights(g["date"], half_life_days=half_life_days)
    g = g[g["time_weight"] >= min_weight].reset_index(drop=True)
    if len(g) == 0:
        raise ValueError("No games inside the time-decay window.")
    return g
