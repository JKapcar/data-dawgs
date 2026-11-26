"""The four rating-model changes from 2026-10-13.

Decay, result weights, weighted team stats / regressions, and the
posterior-averaged win probability are checked here without a long fit.
One small Stan fit checks that a blowout outranks a string of narrow wins
against the same opponents, and that a two-season window actually keeps
both seasons. Skipped when CmdStan cannot compile.
"""
import shutil

import numpy as np
import pandas as pd
import pytest

from bayesratings.bayes_elo import prepare as prepare_elo
from bayesratings.forecast import apply_home_probs
from bayesratings.games import validate_games
from bayesratings.hybrid import _fit_ols, fit_hybrid_models
from bayesratings.ratings import back_to_back_flags, bt_stan_data, posterior_home_prob
from bayesratings.team_stats import compute_team_stats
from bayesratings.weights import (
    HALF_LIFE_DAYS, MIN_WEIGHT, OT_RESULT_WEIGHT, SHOOTOUT_RESULT_WEIGHT,
    decay_window, half_life_for, league_fit_kwargs, result_weights,
    sigma_scale_for, time_weights, use_margin_home, use_starter,
)


def test_decay_math_and_window():
    as_of = pd.Timestamp("2026-06-30")
    dates = pd.to_datetime(["2026-06-30", "2025-12-01", "2024-01-01"])
    w = time_weights(dates, as_of=as_of)
    assert w[0] == 1.0
    # 2025-12-01 is 211 days back; half of a 180-day half-life is weight 0.5
    age = (as_of - dates[1]).days
    assert abs(w[1] - 0.5 ** (age / HALF_LIFE_DAYS)) < 1e-12
    assert w[1] > MIN_WEIGHT
    assert w[2] < MIN_WEIGHT

    rows = []
    for d, season in (("2026-06-30", 2026), ("2025-12-01", 2025), ("2024-01-01", 2024)):
        rows.append({"season": season, "date": d, "home_team": "A", "away_team": "B",
                     "home_score": 3, "away_score": 1})
    window = decay_window(validate_games(pd.DataFrame(rows)))
    assert set(window["season"]) == {2026, 2025}
    assert window["time_weight"].max() == 1.0
    print("ok decay window keeps last season and drops the old one")


def test_per_league_half_life():
    assert half_life_for("nba") == 90
    for lg in ("mlb", "nfl", "nhl", "NFL"):
        assert half_life_for(lg) == HALF_LIFE_DAYS == 180
    # MIN_WEIGHT cutoff at 90 days: 90 * log2(1 / 0.05) ~ 389 days (~1.1 yr)
    as_of = pd.Timestamp("2026-06-30")
    rows = [{"season": 2026, "date": (as_of - pd.Timedelta(days=d)).date().isoformat(),
             "home_team": "A", "away_team": "B", "home_score": 3, "away_score": 1}
            for d in (0, 380, 400, 700)]
    w90 = decay_window(validate_games(pd.DataFrame(rows)), half_life_days=90)
    assert len(w90) == 2
    assert len(decay_window(validate_games(pd.DataFrame(rows)))) == 4
    assert league_fit_kwargs("nba")["half_life_days"] == 90
    assert league_fit_kwargs("nhl")["half_life_days"] == 180


def test_daily_passes_league_half_life(monkeypatch):
    from bayesratings import daily
    seen = {}

    class Stop(Exception):
        pass

    def fake_run_model(done, **kw):
        seen[lg] = {k: kw.get(k) for k in
                    ("half_life_days", "b2b", "sigma_scale", "margin_home", "starter")}
        raise Stop

    def outside(*_a, **_k):
        raise AssertionError("the outside starter adjustment must not run")

    games = pd.DataFrame({"date": ["2026-01-01"], "home_score": [1], "away_score": [0]})
    monkeypatch.setattr(daily.db, "read_games", lambda conn, league, event_id=False: games)
    monkeypatch.setattr(daily.starters, "adjust_forecast", outside)
    monkeypatch.setattr(daily, "todays_schedule",
                        lambda *a, **k: pd.DataFrame({"espn_event_id": []}))
    monkeypatch.setattr(daily, "run_model", fake_run_model)
    for lg in ("nba", "mlb", "nfl", "nhl"):
        with pytest.raises(Stop):
            daily.rate_league(None, lg, pd.Timestamp("2026-10-19").date(), None)
    assert seen == {
        "nba": {"half_life_days": 90, "b2b": True, "sigma_scale": 1.0,
                "margin_home": False, "starter": False},
        "mlb": {"half_life_days": 180, "b2b": False, "sigma_scale": 0.5,
                "margin_home": True, "starter": True},
        "nfl": {"half_life_days": 180, "b2b": False, "sigma_scale": 1.0,
                "margin_home": False, "starter": False},
        "nhl": {"half_life_days": 180, "b2b": True, "sigma_scale": 0.5,
                "margin_home": False, "starter": True},
    }
    assert use_margin_home("mlb") and not use_margin_home("nhl")
    assert use_starter("mlb") and use_starter("nhl")
    assert not use_starter("nba") and not use_starter("nfl")


def test_result_weights_and_stan_data():
    games = validate_games(pd.DataFrame([
        {"season": 2026, "date": "2026-01-01", "home_team": "A", "away_team": "B",
         "home_score": 2, "away_score": 1, "ending": "regulation"},
        {"season": 2026, "date": "2026-01-02", "home_team": "A", "away_team": "C",
         "home_score": 3, "away_score": 2, "ending": "ot"},
        {"season": 2026, "date": "2026-01-03", "home_team": "B", "away_team": "C",
         "home_score": 2, "away_score": 1, "ending": "shootout"},
        {"season": 2026, "date": "2026-01-04", "home_team": "C", "away_team": "A",
         "home_score": 1, "away_score": 0, "ending": None},
    ]))
    assert OT_RESULT_WEIGHT == 1.0 and SHOOTOUT_RESULT_WEIGHT == 1.0
    w = result_weights(games)
    assert list(w) == [1.0, 1.0, 1.0, 1.0]
    # The previous multipliers stay available for the before/after refit.
    old = result_weights(games, ot=0.5, shootout=0.25)
    assert list(old) == [1.0, 0.5, 0.25, 1.0]
    data = bt_stan_data(games, {"A": 1, "B": 2, "C": 3}, sigma_scale=0.5,
                        ot_weight=0.5, so_weight=0.25)
    assert data["result_weight"] == [1.0, 0.5, 0.25, 1.0]
    assert data["margin"] == [1.0, 1.0, 1.0, 1.0]
    assert data["time_weight"] == [1.0, 1.0, 1.0, 1.0]
    assert data["outcome"] == [1, 1, 1, 1]
    assert data["sigma_scale"] == 0.5
    assert data["home_b2b"] == [0, 0, 0, 0] and data["away_b2b"] == [0, 0, 0, 0]
    assert data["margin_home"] == 0 and data["starter_edge"] == [0.0, 0.0, 0.0, 0.0]
    edged = games.copy()
    edged["starter_edge"] = [0.4, -0.2, 0.0, 1.0]
    on = bt_stan_data(edged, {"A": 1, "B": 2, "C": 3}, margin_home=True, starter=True)
    assert on["margin_home"] == 1 and on["starter_edge"] == [0.4, -0.2, 0.0, 1.0]
    # A column on the frame does not move NBA or NFL, which pass starter=False.
    off = bt_stan_data(edged, {"A": 1, "B": 2, "C": 3}, margin_home=False, starter=False)
    assert off["margin_home"] == 0 and off["starter_edge"] == [0.0, 0.0, 0.0, 0.0]
    assert sigma_scale_for("nhl") == sigma_scale_for("mlb") == 0.5
    assert sigma_scale_for("nba") == sigma_scale_for("nfl") == 1.0
    elo = prepare_elo(pd.DataFrame({
        "home_score": [2, 3, 1], "away_score": [1, 2, 0],
        "ending": ["ot", "shootout", "regulation"], "neutral": [0, 0, 0],
    }))
    assert list(elo["w"]) == [1.0, 1.0, 1.0]
    print("ok OT/SO count fully; margin stays the score; MLB and NHL sigma scale is 0.5")


def test_back_to_back_uses_only_the_previous_day():
    games = validate_games(pd.DataFrame([
        {"season": 2026, "date": "2026-01-01", "home_team": "A", "away_team": "B",
         "home_score": 2, "away_score": 1},
        {"season": 2026, "date": "2026-01-01", "home_team": "C", "away_team": "D",
         "home_score": 2, "away_score": 1},  # same-day doubleheader partner, not a b2b
        {"season": 2026, "date": "2026-01-02", "home_team": "A", "away_team": "C",
         "home_score": 1, "away_score": 0},  # both played yesterday
        {"season": 2026, "date": "2026-01-03", "home_team": "B", "away_team": "A",
         "home_score": 1, "away_score": 0},  # A played yesterday; B did not
        {"season": 2026, "date": "2026-01-05", "home_team": "A", "away_team": "B",
         "home_score": 1, "away_score": 0},  # two days off
    ]))
    home_b2b, away_b2b = back_to_back_flags(games)
    assert list(home_b2b) == [0, 0, 1, 0, 0]
    assert list(away_b2b) == [0, 0, 1, 1, 0]
    # A later game cannot mark an earlier one, and a future slate row can.
    upcoming = validate_games(pd.DataFrame([
        {"season": 2026, "date": "2026-01-06", "home_team": "B", "away_team": "C",
         "home_score": np.nan, "away_score": np.nan},
    ]))
    home_b2b, away_b2b = back_to_back_flags(upcoming, history=games)
    # B played on Jan 5; C's previous game is Jan 2.
    assert list(home_b2b) == [1] and list(away_b2b) == [0]
    next_day = validate_games(pd.DataFrame([
        {"season": 2026, "date": "2026-01-06", "home_team": "A", "away_team": "D",
         "home_score": np.nan, "away_score": np.nan},
    ]))
    # Jan 5 is in history, so Jan 6 is a back-to-back for A only.
    home_b2b, away_b2b = back_to_back_flags(next_day, history=games)
    assert list(home_b2b) == [1] and list(away_b2b) == [0]
    # Two upcoming days: the second sees the first, which has not been played.
    slate = validate_games(pd.DataFrame([
        {"season": 2026, "date": "2026-01-06", "home_team": "D", "away_team": "C",
         "home_score": np.nan, "away_score": np.nan},
        {"season": 2026, "date": "2026-01-07", "home_team": "C", "away_team": "D",
         "home_score": np.nan, "away_score": np.nan},
    ]))
    home_b2b, away_b2b = back_to_back_flags(slate, history=games)
    assert list(home_b2b) == [0, 1]   # C plays Jan 7 after playing Jan 6
    assert list(away_b2b) == [0, 1]   # D plays both of those days
    tagged = games.copy()
    tagged["home_b2b"] = [1, 0, 0, 0, 0]
    tagged["away_b2b"] = [0, 1, 0, 0, 0]
    data = bt_stan_data(tagged, {"A": 1, "B": 2, "C": 3, "D": 4})
    assert data["home_b2b"] == [1, 0, 0, 0, 0]
    assert data["away_b2b"] == [0, 1, 0, 0, 0]
    assert league_fit_kwargs("nba")["b2b"] is True
    assert league_fit_kwargs("nhl")["b2b"] is True
    assert league_fit_kwargs("mlb")["b2b"] is False
    assert league_fit_kwargs("nfl")["b2b"] is False
    print("ok back-to-back is the previous calendar day, earlier games only")


def test_posterior_applies_back_to_back_shifts():
    class Fit:
        def __init__(self, variables):
            self._v = variables

        def stan_variable(self, name):
            if name not in self._v:
                raise KeyError(name)
            return self._v[name]

    fit = Fit({
        "rating": np.zeros((4, 2)),
        "home_adv": np.zeros(4),
        "b2b_home": np.full(4, -0.4),
        "b2b_away": np.full(4, 0.3),
    })
    teams = ["A", "B"]
    rested = posterior_home_prob(fit, ["A"], ["B"], [0], teams, [0], [0])
    home_tired = posterior_home_prob(fit, ["A"], ["B"], [0], teams, [1], [0])
    away_tired = posterior_home_prob(fit, ["A"], ["B"], [0], teams, [0], [1])
    assert abs(rested[0] - 0.5) < 1e-9
    assert abs(home_tired[0] - 1 / (1 + np.exp(0.4))) < 1e-9
    assert abs(away_tired[0] - 1 / (1 + np.exp(-0.3))) < 1e-9
    # A fit from before these coefficients existed leaves the probability unchanged.
    old = Fit({"rating": np.zeros((4, 2)), "home_adv": np.zeros(4)})
    plain = posterior_home_prob(old, ["A"], ["B"], [0], teams, [1], [1])
    assert abs(plain[0] - 0.5) < 1e-9
    fit_s = Fit({
        "rating": np.zeros((4, 2)),
        "home_adv": np.zeros(4),
        "starter_coef": np.full(4, 0.5),
    })
    boosted = posterior_home_prob(fit_s, ["A"], ["B"], [0], teams, None, None, [0.4])
    assert abs(boosted[0] - 1 / (1 + np.exp(-0.2))) < 1e-9
    zeroed = posterior_home_prob(fit_s, ["A"], ["B"], [0], teams, None, None, [0.0])
    assert abs(zeroed[0] - 0.5) < 1e-9
    # A fit from before the coefficient existed ignores a nonzero edge.
    assert abs(posterior_home_prob(old, ["A"], ["B"], [0], teams, None, None, [0.4])[0] - 0.5) < 1e-9
    print("ok back-to-back and starter edge shift the posterior win chance")


def test_weighted_stats_and_regression():
    # Each team has a recent game and an old one. The weights follow the
    # recent game, so A's recent blowout counts and B's old blowout does not.
    games = validate_games(pd.DataFrame([
        {"season": 2026, "date": "2026-06-01", "home_team": "A", "away_team": "C",
         "home_score": 10, "away_score": 0},
        {"season": 2025, "date": "2025-06-01", "home_team": "A", "away_team": "C",
         "home_score": 0, "away_score": 2},
        {"season": 2026, "date": "2026-06-01", "home_team": "B", "away_team": "C",
         "home_score": 0, "away_score": 2},
        {"season": 2025, "date": "2025-06-01", "home_team": "B", "away_team": "C",
         "home_score": 10, "away_score": 0},
    ]))
    heavy = np.array([1.0, 0.01, 1.0, 0.01])
    stats = compute_team_stats(games, sample_weight=heavy)
    os_ = dict(zip(stats["team_stats"]["team"], stats["team_stats"]["OS"]))
    assert os_["A"] > os_["B"]

    # Weighted OLS ignores a contradictory block that has almost no weight.
    rng = np.random.default_rng(0)
    n = 200
    x_keep = rng.normal(size=n)
    y_keep = 3.0 * x_keep
    x_drop = rng.normal(size=n)
    y_drop = -3.0 * x_drop
    X = np.column_stack([np.ones(2 * n), np.concatenate([x_keep, x_drop])])
    y = np.concatenate([y_keep, y_drop])
    w = np.concatenate([np.ones(n), np.full(n, 1e-6)])
    beta = _fit_ols(X, y, w)
    assert abs(beta[1] - 3.0) < 0.05, beta
    unweighted = _fit_ols(X, y)
    assert abs(unweighted[1]) < 0.3, unweighted
    print("ok weights follow the recent game and the heavy regression block")


def test_posterior_shrinks_a_wide_gap():
    class Fit:
        def __init__(self, rating, ha):
            self._v = {"rating": rating, "home_adv": ha}

        def stan_variable(self, name):
            return self._v[name]

    rng = np.random.default_rng(0)
    draws = np.column_stack([
        rng.normal(2.0, 3.0, 8000),
        rng.normal(-2.0, 3.0, 8000),
    ])
    fit = Fit(draws, np.zeros(8000))
    p = posterior_home_prob(fit, ["A"], ["B"], [0], ["A", "B"])
    plugin = 1 / (1 + np.exp(-4.0))
    assert 0.5 < p[0] < plugin - 0.02, (p[0], plugin)

    # neutral site: home edge does not move the probability
    fit_ha = Fit(np.zeros((1000, 2)), np.full(1000, 0.8))
    p_home = posterior_home_prob(fit_ha, ["A"], ["B"], [0], ["A", "B"])
    p_neut = posterior_home_prob(fit_ha, ["A"], ["B"], [1], ["A", "B"])
    assert p_home[0] > 0.6 and abs(p_neut[0] - 0.5) < 1e-6

    fc = pd.DataFrame({"home_prob": [0.5], "away_prob": [0.5],
                       "home_odds": [100], "away_odds": [-100]})
    out = apply_home_probs(fc, [0.7])
    assert out["home_prob"].iloc[0] == 0.7
    assert out["away_prob"].iloc[0] == 0.3
    assert out["home_odds"].iloc[0] < 0
    print("ok posterior average is less extreme than the plug-in")


def test_blowout_outranks_narrow_wins():
    if shutil.which("make") is None:
        print("SKIP stan fit: no build tools for CmdStan")
        return
    from bayesratings.pipeline import run_model

    rows = []

    def add(season, date, home, away, hs, as_):
        rows.append({"season": season, "date": date, "home_team": home, "away_team": away,
                     "home_score": hs, "away_score": as_})

    # A wins by a lot, B wins narrowly. Same opponents, both home and away.
    # The margin jitters so the noise scale can't collapse to zero.
    rng = np.random.default_rng(1)
    day = pd.Timestamp("2026-06-01")
    for i, opp in enumerate(["C", "D"] * 12):
        d = (day + pd.Timedelta(days=i)).strftime("%Y-%m-%d")
        blow = int(rng.integers(12, 22))
        narrow = int(rng.integers(1, 3))
        if i % 2 == 0:
            add(2026, d, "A", opp, blow, 0)
            add(2026, d, "B", opp, narrow, 0)
        else:
            add(2026, d, opp, "A", 0, blow)
            add(2026, d, opp, "B", 0, narrow)
    # Previous season, still inside the 180-day window, plus one ancient game
    # that the window must drop.
    add(2025, "2025-12-01", "C", "D", 4, 3)
    add(2024, "2024-01-01", "C", "D", 9, 0)
    add(2026, "2026-07-15", "A", "B", np.nan, np.nan)

    games = validate_games(pd.DataFrame(rows))
    res = run_model(games, evaluate=False, iter=400, warmup=200, chains=2, seed=7)
    assert res["rating_season"] == 2026
    assert res["n_fit_games"] == len(games) - 2  # the ancient game, and the unplayed one
    assert res["ratings"]["A"] > res["ratings"]["B"] + 0.15, res["ratings"].to_dict()
    fc = res["forecast"]
    assert len(fc) == 1 and 0.5 < fc["home_prob"].iloc[0] <= 0.9999
    assert np.isfinite(fc["home_odds"]).all() and np.isfinite(fc["away_odds"]).all()
    # the published probability is the posterior, not the hybrid GLM
    assert "home_spread" in fc.columns
    print("ok blowout rates above narrow wins;",
          {t: round(float(res["ratings"][t]), 3) for t in "ABCD"},
          "P(A beats B)", round(float(fc["home_prob"].iloc[0]), 3))


def test_weighted_hybrid_drops_neutral_weights():
    rng = np.random.default_rng(2)
    teams = ["A", "B", "C", "D"]
    rows = []
    for k in range(40):
        h, a = rng.choice(teams, 2, replace=False)
        rows.append({"season": 2026, "date": f"2026-06-{1 + k % 28:02d}",
                     "home_team": h, "away_team": a,
                     "home_score": int(rng.integers(0, 6)),
                     "away_score": int(rng.integers(0, 6)),
                     "neutral": int(k == 0)})
    games = validate_games(pd.DataFrame(rows))
    ratings = pd.Series({t: v for t, v in zip(teams, [-0.3, -0.1, 0.1, 0.3])})
    stats = compute_team_stats(games[games["neutral"] == 0])
    try:
        fit_hybrid_models(games, ratings, stats["team_stats"],
                          sample_weight=np.ones(len(games) - 1))
        raise AssertionError("short weight accepted")
    except ValueError:
        pass
    hyb = fit_hybrid_models(games, ratings, stats["team_stats"],
                            sample_weight=np.linspace(0.2, 1.0, len(games)))
    assert np.isfinite(hyb["mov_fit"].params.to_numpy()).all()
    print("ok hybrid accepts aligned weights and rejects a short vector")


if __name__ == "__main__":
    test_decay_math_and_window()
    test_per_league_half_life()
    test_result_weights_and_stan_data()
    test_back_to_back_uses_only_the_previous_day()
    test_posterior_applies_back_to_back_shifts()
    test_weighted_stats_and_regression()
    test_posterior_shrinks_a_wide_gap()
    test_weighted_hybrid_drops_neutral_weights()
    test_blowout_outranks_narrow_wins()
    print("ok all")
