"""Dynamic Bayesian Elo stack (bayesratings/bayes_elo.py): the stacking math,
weight loading, the logit-only fallback, no lookahead, the audit columns and
their migration, and one small real Stan fit.
Run: PYTHONPATH=. python -m pytest tests/test_bayes_elo.py"""
import sqlite3
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from bayesratings import bayes_elo, daily, db
from bayesratings.sources import check as src_check

SCHEMA = Path(__file__).resolve().parents[1] / "bayesratings" / "schema.sql"


def _sched(seasons=(2026, 2026, 2027), neutral=(0, 1, 0)):
    n = len(seasons)
    return pd.DataFrame({"espn_event_id": range(500, 500 + n), "season": list(seasons),
                         "date": ["2026-10-17"] * n, "home_team": ["1"] * n,
                         "away_team": ["2"] * n, "neutral": list(neutral)})


def _fc(n, p=0.6):
    return pd.DataFrame({"home_prob": [p] * n, "away_prob": [1 - p] * n,
                         "home_spread": [-3.0] * n, "total_pred": [44.0] * n,
                         "home_odds": [-150.0] * n, "away_odds": [150.0] * n})


# ---------------------------------------------------------------- stacking

def test_stack_math():
    assert bayes_elo.stack(0.6, 0.4, 0.25) == pytest.approx(0.55)
    assert bayes_elo.stack(0.6, 0.4, 0.0) == pytest.approx(0.6)
    assert bayes_elo.stack(0.6, 0.4, 1.0) == pytest.approx(0.4)


def test_apply_stack_publishes_mix_and_audit(monkeypatch):
    monkeypatch.setattr(bayes_elo, "WEIGHTS", {("nfl", 2026): {"w": 0.5},
                                               ("nfl", 2027): {"w": 0.25}})
    s = _sched()
    f, notes = bayes_elo.apply_stack(_fc(3), s, "nfl", np.array([0.4, 0.5, 0.8]))
    assert list(f["home_prob"]) == pytest.approx([0.5, 0.55, 0.65])
    assert list(f["away_prob"]) == pytest.approx([0.5, 0.45, 0.35])
    assert list(f["p_logit"]) == [0.6, 0.6, 0.6]
    assert list(f["p_elo"]) == [0.4, 0.5, 0.8]
    assert list(f["elo_weight"]) == [0.5, 0.5, 0.25]          # weight by game season
    assert f["home_odds"].iloc[2] == pytest.approx(-186.0)     # odds follow the new prob
    assert f["home_spread"].tolist() == [-3.0] * 3 and f["total_pred"].tolist() == [44.0] * 3
    assert f["model_version"].iloc[0].startswith("logit+" + bayes_elo.ELO_VERSION)
    assert notes == []


# ---------------------------------------------------------------- weights

def test_weight_loading_rules(monkeypatch):
    monkeypatch.setattr(bayes_elo, "WEIGHTS", {("mlb", 2025): {"w": 0.3},
                                               ("mlb", 2026): {"w": 0.2}})
    assert bayes_elo.weight_for("mlb", 2026) == (0.2, None)
    w, note = bayes_elo.weight_for("mlb", 2028)            # newest earlier entry
    assert w == 0.2 and "2026" in note
    w, note = bayes_elo.weight_for("mlb", 2024)            # nothing earlier: no weight
    assert w is None and note
    assert bayes_elo.weight_for("nhl", 2027)[0] is None


def test_shipped_weights_cover_every_league_and_never_use_their_own_season():
    lgs = {lg for lg, _ in bayes_elo.WEIGHTS}
    assert lgs == set(daily.LEAGUES)
    for (lg, season), v in bayes_elo.WEIGHTS.items():
        assert 0.0 <= v["w"] <= 1.0
        lo, hi = v["fit_seasons"]
        assert hi < season and lo <= hi and v["n_games"] > 0   # fit on earlier seasons only


# ---------------------------------------------------------------- fallback

def test_convergence_check():
    ok = {"max_rhat": 1.01, "divergences": 0, "n_draws": 2000}
    assert bayes_elo.check(ok) == []
    assert bayes_elo.check({**ok, "max_rhat": 1.2})
    assert bayes_elo.check({**ok, "max_rhat": float("nan")})
    assert bayes_elo.check({**ok, "divergences": 11})
    assert bayes_elo.check({**ok, "divergences": 10}) == []


def test_fallback_publishes_logit_unchanged():
    f, _ = bayes_elo.apply_stack(_fc(3), _sched(), "nfl", None)
    assert list(f["home_prob"]) == [0.6] * 3 and list(f["home_odds"]) == [-150.0] * 3
    assert list(f["elo_weight"]) == [0.0] * 3 and f["p_elo"].isna().all()
    assert (f["model_version"] == "logit-only:elo-fallback").all()


class _Boom:
    def sample(self, **kw):
        raise RuntimeError("stan exploded")


class _Bad:
    """A fit that 'works' but did not converge."""
    def sample(self, **kw):
        raise AssertionError("not called")


def test_elo_probs_never_raises_and_falls_back(monkeypatch):
    c = _games_db(n_seasons=2)
    r = bayes_elo.elo_probs(c, "nba", _sched(seasons=(2027,) * 3), "2026-10-17", _Boom())
    assert r["p_elo"] is None and "elo fallback" in r["notes"][0]
    # not converged -> fallback with the reason
    monkeypatch.setattr(bayes_elo, "fit", lambda *a, **k: (None, None, {
        "max_rhat": 1.5, "divergences": 0, "n_draws": 2000, "n_games": 1}))
    r = bayes_elo.elo_probs(c, "nba", _sched(seasons=(2027,) * 3), "2026-10-17", _Bad())
    assert r["p_elo"] is None and "R-hat" in r["notes"][0]
    # too few games
    r = bayes_elo.elo_probs(sqlite3.connect(":memory:"), "nba", _sched(), "2026-10-17", _Bad())
    assert r["p_elo"] is None


def test_rate_league_survives_elo_failure(monkeypatch):
    c = _games_db(n_seasons=2, upcoming=True)
    monkeypatch.setattr(daily, "run_model", lambda done, schedule, **k: {
        "rating_season": 2027, "n_fit_games": len(done), "home_adv": 0.1,
        "ratings": pd.Series([0.0] * 6, index=range(1, 7)), "fit": None,
        "forecast": _fc(len(schedule)).assign(away_prob=0.4, home_total_pred=22.0,
                                              away_total_pred=22.0)})
    monkeypatch.setattr(bayes_elo, "elo_probs", lambda *a, **k: {
        "p_elo": None, "notes": ["elo fallback: test"], "diag": None})
    r = daily.rate_league(c, "nba", date(2026, 10, 20), None, dry_run=True)
    assert r["elo_fallback"] and "elo fallback" in r["notes"]
    assert (r["forecast"]["home_prob"] == 0.6).all()
    assert (r["forecast"]["elo_weight"] == 0).all()


def test_pipeline_check_warns_on_elo_fallback(tmp_path):
    line = ("2026-10-18 06:09 CT OK snapshot=2026-10-18 espn +1g/1s | mlb ok 30t 1fc 90s "
            "| nba ok 30t 5fc 60s WARN elo fallback | 300s")
    out = []
    add = lambda s, lvl, m: out.append((s, lvl, m))
    src_check._daily_elo_warn(line, add)
    assert out == [("daily/elo", "WARN", "BayesElo fallback (logit only): nba")]
    out.clear()
    src_check._daily_elo_warn(line.replace(" WARN elo fallback", ""), add)
    assert out == []


# ---------------------------------------------------------------- no lookahead

def _games_db(n_seasons=2, upcoming=False):
    """6 NBA teams, round robins over n_seasons ending in 2026; team 1 strongest."""
    c = sqlite3.connect(":memory:")
    c.executescript(SCHEMA.read_text())
    for t in range(1, 7):
        c.execute("INSERT INTO teams (team_id, league, espn_id, name, abbreviation) "
                  "VALUES (?, 'nba', ?, 'T', 'T')", (t, t))
    rng = np.random.default_rng(1)
    eid, day = 1, pd.Timestamp("2024-11-01")
    for season in range(2027 - n_seasons, 2027):
        for rep in range(12):
            for h in range(1, 7):
                for a in range(1, 7):
                    if h == a:
                        continue
                    edge = (a - h) * 2.0 + 2
                    m = int(round(edge + rng.normal(0, 8))) or 1
                    c.execute("INSERT INTO games (espn_event_id, league, season, season_type, "
                              "start_time_utc, game_date, home_team_id, away_team_id, home_score, "
                              "away_score, completed) VALUES (?,?,?,?,?,?,?,?,?,?,1)",
                              (eid, "nba", season, 2, f"{day.date()}T23:{eid % 60:02d}Z",
                               str(day.date()), h, a, 100 + max(m, 0), 100 + max(-m, 0)))
                    eid += 1
                day += pd.Timedelta(days=1)
        day += pd.Timedelta(days=150)
    if upcoming:
        for k, (h, a) in enumerate(((1, 6), (6, 1), (2, 3))):
            c.execute("INSERT INTO games (espn_event_id, league, season, season_type, "
                      "start_time_utc, game_date, home_team_id, away_team_id, completed) "
                      "VALUES (?,?,?,?,?,?,?,?,0)",
                      (90000 + k, "nba", 2027, 2, "2026-10-20T23:00Z", "2026-10-20", h, a))
    return c


def test_load_games_uses_only_games_before_cutoff_and_recent_seasons(monkeypatch):
    c = _games_db(n_seasons=2)
    last = c.execute("SELECT MAX(game_date) FROM games").fetchone()[0]
    g = bayes_elo.load_games(c, "nba", last)
    assert g["date"].max() < last and len(g) > 0
    # results on/after the cutoff can change without changing the training data
    c.execute("UPDATE games SET home_score = 0, away_score = 200 WHERE game_date >= ?", (last,))
    pd.testing.assert_frame_equal(g, bayes_elo.load_games(c, "nba", last))
    monkeypatch.setattr(bayes_elo, "SEASONS_BACK", 0)          # latest season only
    assert set(bayes_elo.load_games(c, "nba", "2099-01-01")["season"]) == {2026}


def test_new_season_flags_and_per_team_carryover():
    g = pd.DataFrame({"home": [1, 2, 1], "away": [2, 3, 4], "season": [2025, 2025, 2026]})
    hf, af = bayes_elo.new_season_flags(g)
    assert hf.tolist() == [0, 0, 1] and af.tolist() == [0, 0, 0]   # team 4: no earlier season
    draws = {"final_rating": np.array([[1600.0, 1400.0, 1500.0, 1500.0]]),
             "carry": np.array([0.5]), "home_adv": np.array([0.0])}
    teams = {1: 1, 2: 2, 3: 3, 9: 4}
    train = pd.DataFrame({"home": [1], "away": [2], "season": [2025]})
    fc = pd.DataFrame({"home": [1, 1, 9], "away": [2, 2, 2], "season": [2025, 2026, 2026],
                       "neutral": [0, 0, 0]})
    p = bayes_elo.forecast_probs(draws, teams, train, fc)
    e = lambda d: 1 / (1 + 10 ** (-d / 400))
    assert p == pytest.approx([e(200), e(100), e(50)])   # 9 = new team, no regression


# ---------------------------------------------------------------- audit columns

def test_migration_adds_stack_audit_columns_and_keeps_rows():
    c = sqlite3.connect(":memory:")
    c.executescript("""
    CREATE TABLE forecast_snapshots (snapshot_date TEXT NOT NULL, league TEXT NOT NULL,
      espn_event_id INTEGER NOT NULL, game_date TEXT, home_team_id INTEGER,
      away_team_id INTEGER, home_prob REAL, away_prob REAL, home_spread REAL,
      total_pred REAL, home_total_pred REAL, away_total_pred REAL,
      backfilled INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (snapshot_date, espn_event_id));
    CREATE TABLE upcoming_forecasts (snapshot_date TEXT NOT NULL, league TEXT NOT NULL,
      espn_event_id INTEGER NOT NULL PRIMARY KEY, game_date TEXT, home_team_id INTEGER,
      away_team_id INTEGER, home_prob REAL, away_prob REAL, home_spread REAL,
      total_pred REAL, home_total_pred REAL, away_total_pred REAL);
    INSERT INTO forecast_snapshots VALUES ('2026-10-16','nhl',1,'2026-10-16',1,2,
      0.55,0.45,-0.5,6.1,3.3,2.8,0);
    """)
    db.init_db(c)
    db.init_db(c)
    for t in ("forecast_snapshots", "upcoming_forecasts"):
        have = {r[1] for r in c.execute(f"PRAGMA table_info({t})")}
        assert set(bayes_elo.AUDIT_COLS) <= have, t
    assert c.execute("SELECT home_prob, p_logit, p_elo, elo_weight, model_version "
                     "FROM forecast_snapshots").fetchone() == (0.55, None, None, None, None)


def test_save_snapshot_writes_stack_audit_columns():
    from tests.test_forecast_ahead import _db, _res
    c = _db()
    sched = daily.todays_schedule(c, "nfl", date(2026, 10, 13), date(2026, 10, 27))
    res = _res(sched)
    res["forecast"], _ = bayes_elo.apply_stack(res["forecast"], sched, "nfl",
                                               np.array([0.5, 0.7, 0.4]))
    w = bayes_elo.WEIGHTS[("nfl", 2026)]["w"]
    daily.save_snapshot(c, "2026-10-13", "nfl", res, sched, upcoming=True)
    row = c.execute("SELECT home_prob, p_logit, p_elo, elo_weight, model_version "
                    "FROM forecast_snapshots").fetchone()
    assert row[0] == pytest.approx((1 - w) * 0.6 + w * 0.5, abs=1e-4)
    assert row[1:4] == (0.6, 0.5, w) and row[4].startswith("logit+")
    up = c.execute("SELECT espn_event_id, p_elo, elo_weight FROM upcoming_forecasts "
                   "ORDER BY 1").fetchall()
    assert up == [(102, 0.7, w), (103, 0.4, w)]
    # replay-style forecasts (no stack) store NULL audit columns
    c2 = _db()
    daily.save_snapshot(c2, "2026-10-13", "nfl", _res(sched), sched, backfilled=1)
    assert c2.execute("SELECT COUNT(*) FROM forecast_snapshots WHERE p_logit IS NULL "
                      "AND model_version IS NULL").fetchone()[0] == 3


# ---------------------------------------------------------------- real fit

def test_small_real_fit_converges_and_ranks_teams(monkeypatch):
    monkeypatch.setattr(bayes_elo, "WARMUP", 300)
    monkeypatch.setattr(bayes_elo, "SAMPLES", 300)
    c = _games_db(n_seasons=2, upcoming=True)
    sched = daily.todays_schedule(c, "nba", date(2026, 10, 20))
    r = bayes_elo.elo_probs(c, "nba", sched, "2026-10-20")
    assert r["p_elo"] is not None, r["notes"]
    p = r["p_elo"]
    assert p[0] > 0.6 and p[1] < 0.5 and 0 < p.min() and p.max() < 1   # 1 beats 6 at home and away
    assert r["diag"]["max_rhat"] < bayes_elo.MAX_RHAT and r["diag"]["n_games"] == 720


def test_live_weights():
    w = {k: v["w"] for k, v in bayes_elo.WEIGHTS.items()}
    assert w == {("mlb", 2026): 0.2415, ("nba", 2027): 0.5,
                 ("nfl", 2026): 0.8315, ("nhl", 2027): 0.1033}
