"""NBA player ridge (bayesratings/nba_player.py).

Checks the estimator on a synthetic slate, the training window, the live
pool, and the refresh write rules. No
walk-forward and no Stan fit.
Run: PYTHONPATH=. python -m pytest tests/test_nba_player.py
"""
import json
import logging
import math
import sqlite3
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from bayesratings import db, nba_player as np_

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "tests" / "fixtures" / "nba_player" / "slate.json"
AS_OF = "2026-11-22T18:00:00+00:00"


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    db.init_db(c)
    c.execute("PRAGMA foreign_keys = OFF")
    return c


def _ins(c, table, **kw):
    for _, name, typ, notnull, dflt, _pk in c.execute(f"PRAGMA table_info({table})"):
        if notnull and dflt is None and name not in kw:
            kw[name] = 0 if "INT" in (typ or "").upper() or "REAL" in (typ or "").upper() else \
                (kw.get("valid_from", "x") if name == "last_seen" else "x")
    cols = ", ".join(kw)
    c.execute(f"INSERT INTO {table} ({cols}) VALUES ({', '.join('?' * len(kw))})", list(kw.values()))


def _slate():
    raw = json.loads(FIX.read_text())
    players = pd.DataFrame(raw["players"])
    games = pd.DataFrame(raw["games"])
    return players, games


def _exec_research(src, ns):
    lines = []
    for line in src.splitlines():
        if line.startswith("print(") or ".to_csv(" in line or ".to_parquet(" in line:
            continue
        lines.append(line)
    exec("\n".join(lines), ns)


def _research_features(players, games):
    src = (ROOT / "analysis" / "nba_player" / "features.py").read_text()
    src = src.replace('P = pd.read_csv("data/player_game_nba.csv.gz")', "P = P_IN.copy()")
    src = src.replace(
        'G = pd.read_csv("data/games.csv"); G = G[(G.league == "nba") & (G.completed == 1) & G.home_score.notna()]',
        'G = G_IN.copy()\nG = G[(G.league == "nba") & (G.completed == 1) & G.home_score.notna()]')
    src = src.replace(
        'allg = pd.read_csv("data/games.csv"); allg = allg[(allg.league == "nba") & allg.status.isin(["STATUS_FINAL", "STATUS_SCHEDULED"])]',
        'allg = G_ALL.copy()\nallg = allg[(allg.league == "nba") & allg.status.isin(["STATUS_FINAL", "STATUS_SCHEDULED"])]')
    ns = {"P_IN": players, "G_IN": games, "G_ALL": games}
    _exec_research(src, ns)
    return ns["P"], ns["X"]


def _research_matrices(X):
    src = (ROOT / "analysis" / "nba_player" / "prep.py").read_text()
    src = src.replace(
        'X = pd.read_parquet("out/features.parquet").sort_values("start_time_utc").reset_index(drop=True)',
        "X = X_IN.sort_values('start_time_utc').reset_index(drop=True)")
    src = src.replace("    M = M.dropna()", "    M = M.dropna()\n    MAT[v] = M.copy()")
    ns = {"X_IN": X, "MAT": {}}
    _exec_research(src, ns)
    return ns["MAT"]


def _close(a, b, keys, cols):
    a = a.sort_values(keys).reset_index(drop=True)
    b = b.sort_values(keys).reset_index(drop=True)
    assert list(a[keys].itertuples(index=False)) == list(b[keys].itertuples(index=False))
    for c in cols:
        av = pd.to_numeric(a[c], errors="coerce").to_numpy(float)
        bv = pd.to_numeric(b[c], errors="coerce").to_numpy(float)
        assert np.allclose(av, bv, rtol=1e-9, atol=1e-9, equal_nan=True), c


def test_only_earlier_box_lines_feed_a_game():
    players, _games = _slate()
    base, states, _ = np_.player_rates(players)
    first = base[base.espn_event_id == base.espn_event_id.min()]
    assert (first.prior_min == 0).all()          # a row's own minutes are not in its prior
    assert (first.exp_min == np_.EXP_MIN_DEFAULT).all()
    extra = players.iloc[[0]].copy()
    aid = int(extra.athlete_id.iloc[0])
    extra["espn_event_id"] = 99
    extra["game_date"] = "2024-06-01"
    extra["minutes"] = 48
    extra["pts"] = 80
    extra["did_not_play"] = 0
    later, later_states, _ = np_.player_rates(pd.concat([players, extra], ignore_index=True))
    # a later date does not change earlier rows. Rates that shrink to the league
    # prior move when the frame itself grows; the sums and the minute state do not.
    keys = ["athlete_id", "espn_event_id"]
    _close(base, later[later.espn_event_id != 99], keys, ["prior_min", "exp_min", "ts_L"])
    by_id = {s["athlete_id"]: s for s in states}
    for s in later_states:
        if s["athlete_id"] == aid:
            continue
        assert s["sL"] == by_id[s["athlete_id"]]["sL"]
        assert s["mL"] == by_id[s["athlete_id"]]["mL"]
        assert s["prior_min"] == by_id[s["athlete_id"]]["prior_min"]


def test_fit_uses_the_research_estimator_and_window():
    est = np_.make_estimator()
    clf = est.named_steps["logisticregressioncv"]
    assert np.allclose(np.asarray(clf.Cs, float), np.logspace(-3, 1, 9))
    assert clf.cv == 5 and clf.scoring == "neg_log_loss" and clf.max_iter == 2000
    rng = np.random.default_rng(0)
    rows = []
    for i, day, y in (
        *[(i, "2021-11-15", i % 2) for i in range(8)],
        *[(i, f"2023-06-{(i % 27) + 1:02d}", int(i < 30)) for i in range(60)],
        *[(i, "2024-06-01", i % 2) for i in range(8)],
    ):
        rows.append({"game_date": day, "y": y, "train_ok": day >= np_.TRAIN_FROM,
                     "d_0": (2.0 if y else -2.0) + float(rng.normal(0, 0.05)),
                     "d_1": float(rng.normal()), "h_b2b": i % 2, "a_b2b": 0,
                     "rest_d": 0, "neutral": 0})
    M = pd.DataFrame(rows)
    fit_date = "2024-01-01"
    packed = np_.fit_matrix(M, fit_date)
    assert all(d >= np_.TRAIN_FROM and d < fit_date for d in packed["train_dates"])
    assert packed["n_games"] == 60
    tr = np_.training_rows(M, fit_date)
    cols = np_.feature_columns(tr)
    again = np_.make_estimator()
    again.fit(tr[cols].to_numpy(float), tr["y"].to_numpy(int))
    p_model = again.predict_proba(tr[cols].to_numpy(float))[:, 1]
    p_stored = np_.predict_stored(packed, tr[cols])
    assert np.allclose(p_stored, p_model, rtol=1e-8, atol=1e-8)
    mutated = M.copy()
    out = ~((pd.to_datetime(M.game_date) >= np_.TRAIN_FROM) & (pd.to_datetime(M.game_date) < fit_date))
    mutated.loc[out, "d_0"] = 1e6
    mutated.loc[out, "y"] = 1 - mutated.loc[out, "y"]
    other = np_.fit_matrix(mutated, fit_date)
    assert other["coef"] == packed["coef"]
    assert other["intercept"] == packed["intercept"]
    assert other["scaler_mean"] == packed["scaler_mean"]


def test_out_doubtful_removed_questionable_stays_debut_gets_twelve():
    prior = np_._blank_prior()
    state = {
        11: {"team_id": 1, "season": 2026, "last": "2026-11-20", "exp_min": 30.0,
             "sL": {}, "sS": {}, "mL": 200.0, "mS": 30.0, "tL": 10.0, "pL": 10.0},
        12: {"team_id": 1, "season": 2026, "last": "2026-11-20", "exp_min": 28.0,
             "sL": {}, "sS": {}, "mL": 180.0, "mS": 28.0, "tL": 8.0, "pL": 8.0},
        13: {"team_id": 1, "season": 2026, "last": "2026-11-20", "exp_min": 22.0,
             "sL": {}, "sS": {}, "mL": 100.0, "mS": 22.0, "tL": 6.0, "pL": 6.0},
    }
    history = {(11, 1), (12, 1), (13, 1)}
    played = {(11, 1, 2026), (12, 1, 2026), (13, 1, 2026)}
    frame = np_.assemble_side(state, 1, 2026, "2026-11-22", "B", {11, 13}, [99, 12],
                              history, None, prior, played)
    got = dict(zip(frame.athlete_id.astype(int), frame.exp_min))
    assert 11 not in got and 13 not in got          # Out and Doubtful
    # Questionable stays. Two days since the last game, so the 28 minutes decay.
    assert 12 in got and math.isclose(got[12], np_.decay_exp_min(28.0, "2026-11-20", "2026-11-22"))
    assert got[99] == np_.EXP_MIN_DEFAULT           # listed starter, no history for the team
    kept = np_.assemble_side(state, 1, 2026, "2026-11-22", "C", {11}, [99],
                             history, [11, 12], prior)
    assert set(kept.athlete_id.astype(int)) == {12}   # C drops Out and Doubtful


def _logit(p):
    return math.log(p / (1 - p))


def _store_fit(c, version, p):
    names = np_.diff_feature_names()
    n = len(names)
    _ins(c, "nba_ridge_fits", fit_date="2026-11-16", version=version, train_from="2021-12-01",
         train_through="2026-11-15", n_games=100, c_value=0.1, features=json.dumps(names),
         scaler_mean=json.dumps([0.0] * n), scaler_scale=json.dumps([1.0] * n),
         coef=json.dumps([0.0] * n), intercept=_logit(p), sklearn_version="1.9.1",
         created_at="2026-11-16T12:00:00+00:00")


def _box(c, eid, day, team, opp, home, aid, minutes=30, season=2026):
    _ins(c, "player_game_nba", espn_event_id=eid, season=season, season_type=2, game_date=day,
         team_id=team, opp_team_id=opp, is_home=home, athlete_id=aid, starter=1,
         did_not_play=0, minutes=minutes, pts=12, fgm=5, fga=10, fg3a=3, ftm=2, fta=2,
         oreb=1, dreb=4, ast=3, tov=1, stl=1, blk=1, pf=2, plus_minus=4, stats_json="{}")


def _prev_game(c):
    _ins(c, "games", espn_event_id=10, league="nba", season=2026, season_type=2,
         start_time_utc="2026-11-20T00:00:00Z", game_date="2026-11-20", home_team_id=1,
         away_team_id=2, home_score=110, away_score=100, completed=1, status="STATUS_FINAL")
    for team, opp, home, aid in ((1, 2, 1, 11), (1, 2, 1, 12), (2, 1, 0, 21), (2, 1, 0, 22)):
        _box(c, 10, "2026-11-20", team, opp, home, aid)
    np_.build_state(c, date(2026, 11, 22), log=lambda *_: None)


def _forecast_row():
    return pd.DataFrame({
        "home_prob": [0.40], "away_prob": [0.60], "home_spread": [6.0], "away_spread": [-6.0],
        "total_pred": [230.0], "home_total_pred": [112.0], "away_total_pred": [118.0],
        "home_odds": [150], "away_odds": [-170],
    })


def _sched(eid=100, home=1, away=2, day="2026-11-22"):
    return pd.DataFrame({
        "espn_event_id": [eid], "season": [2026], "date": [day],
        "home_team": [str(home)], "away_team": [str(away)], "neutral": [0],
    })


def _report(c, eid, team, aid, status, key, slot="2026-11-22 11:00"):
    _ins(c, "nba_injury_states", espn_event_id=eid, team_id=team, athlete_id=aid, status=status,
         player_key=key, report_slot=slot, game_date="2026-11-22", team_name="T",
         state_hash=f"{eid}-{team}-{key}", valid_from="2026-11-22T16:00:00+00:00",
         last_seen="2026-11-22T16:00:00+00:00")


def _publish(c, eid=100, home=1, away=2):
    _ins(c, "games", espn_event_id=eid, league="nba", season=2026, season_type=2,
         start_time_utc="2026-11-22T20:00:00Z", game_date="2026-11-22", home_team_id=home,
         away_team_id=away, completed=0, status="STATUS_SCHEDULED")
    return np_.apply(c, _sched(eid, home, away), _forecast_row(), AS_OF, date(2026, 11, 22))


def test_report_coverage_and_fallbacks():
    c = _db()
    _prev_game(c)
    _store_fit(c, "B", 0.8)
    _store_fit(c, "C", 0.2)
    _report(c, 100, 1, 11, "Out", "Guard, Home")
    _report(c, 100, 2, 21, "Questionable", "Guard, Away")
    both = _publish(c)
    assert both.loc[0, "nba_model_src"] == "ridge_b"
    assert both.loc[0, "home_prob"] == 0.8
    assert both.loc[0, "home_spread"] < 0                 # same favorite as the chance
    assert both.loc[0, "total_pred"] == 230.0
    assert both.loc[0, "nba_team_prob"] == 0.4

    c2 = _db()
    _prev_game(c2)
    _store_fit(c2, "B", 0.8)
    _store_fit(c2, "C", 0.2)
    _report(c2, 100, 1, None, "NOT YET SUBMITTED", np_.NOT_YET)
    _report(c2, 100, 2, 21, "Out", "Guard, Away")
    nys = _publish(c2)
    assert nys.loc[0, "nba_model_src"] == "ridge_c"
    assert nys.loc[0, "home_prob"] == 0.2
    assert nys.loc[0, "home_spread"] > 0
    assert nys.loc[0, "total_pred"] == 230.0

    c3 = _db()
    _prev_game(c3)
    _store_fit(c3, "B", 0.8)
    _store_fit(c3, "C", 0.2)
    none = _publish(c3)
    assert none.loc[0, "nba_model_src"] == "ridge_c"      # no report covers the game

    c4 = _db()
    _prev_game(c4)
    missing = _publish(c4)
    assert missing.loc[0, "nba_model_src"] == "team"      # no stored fit
    assert missing.loc[0, "home_prob"] == 0.4
    assert missing.loc[0, "home_spread"] == 6.0
    assert missing.loc[0, "total_pred"] == 230.0

    c5 = _db()
    _store_fit(c5, "B", 0.8)
    _store_fit(c5, "C", 0.2)
    cold = _publish(c5, eid=300, home=3, away=4)
    assert cold.loc[0, "nba_model_src"] == "team"         # no previous box this season or last
    assert cold.loc[0, "home_prob"] == 0.4


def _snap(c, table, eid, league, day, start, home_prob, snap=None, locked=False):
    _ins(c, "games", espn_event_id=eid, league=league, season=2026, season_type=2,
         start_time_utc=start, game_date=day, home_team_id=1, away_team_id=2,
         completed=0, status="STATUS_SCHEDULED")
    kw = dict(espn_event_id=eid, league=league, game_date=day, home_team_id=1, away_team_id=2,
              home_prob=home_prob, away_prob=round(1 - home_prob, 4), home_spread=6.0,
              total_pred=224.5, home_total_pred=109.2, away_total_pred=115.3,
              player_prob_base=0.42, player_spread_base=6.0, player_total_base=224.5,
              player_home_total_base=109.2, player_away_total_base=115.3,
              home_player_x=0.0, away_player_x=0.0, elo_weight=0.0, p_logit=0.42,
              player_inputs="stale")
    if table == "forecast_snapshots":
        kw["snapshot_date"] = snap or day
    else:
        kw["snapshot_date"] = snap or day
    _ins(c, table, **kw)
    if locked:
        _ins(c, "forecast_locks", espn_event_id=eid, league=league,
             locked_at=AS_OF, home_prob=home_prob, home_spread=0.0, total_pred=200.0)


def _row(c, table, eid):
    return c.execute(
        f"SELECT home_prob, home_spread, total_pred, nba_model_src FROM {table} "
        "WHERE espn_event_id = ?", (eid,)).fetchone()


def test_refresh_leaves_past_rows_locks_and_other_leagues():
    c = _db()
    _prev_game(c)
    _store_fit(c, "B", 0.8)
    _store_fit(c, "C", 0.8)
    now_day = "2026-11-22"
    _snap(c, "forecast_snapshots", 100, "nba", now_day, "2026-11-22T20:00:00Z", 0.11)
    _snap(c, "forecast_snapshots", 101, "nba", now_day, "2026-11-22T18:03:00Z", 0.11)   # inside 5 min
    _snap(c, "forecast_snapshots", 102, "nba", "2026-11-21", "2026-11-21T20:00:00Z", 0.11,
          snap="2026-11-21")
    _snap(c, "forecast_snapshots", 103, "nba", now_day, "2026-11-22T23:00:00Z", 0.11, locked=True)
    _snap(c, "upcoming_forecasts", 104, "nba", "2026-11-25", "2026-11-25T20:00:00Z", 0.11)
    _snap(c, "forecast_snapshots", 200, "nfl", now_day, "2026-11-22T20:00:00Z", 0.3333)
    before = {eid: _row(c, "forecast_snapshots", eid) for eid in (101, 102, 103, 200)}
    up_before = _row(c, "upcoming_forecasts", 104)
    from datetime import datetime, timezone
    now = datetime(2026, 11, 22, 18, 0, tzinfo=timezone.utc)
    out = np_.refresh(c, now, log=lambda *_: None)
    assert out == 2
    live = _row(c, "forecast_snapshots", 100)
    assert live["nba_model_src"] == "ridge_c" and live["home_prob"] == 0.8
    assert live["home_spread"] < 0 and live["total_pred"] == 224.5
    soon = _row(c, "upcoming_forecasts", 104)
    assert soon["home_prob"] == 0.8 and soon["total_pred"] == up_before["total_pred"]
    for eid, old in before.items():
        assert _row(c, "forecast_snapshots", eid) == old
    # a second pass with the same report writes nothing, including the NFL row
    assert np_.refresh(c, now, log=lambda *_: None) is None
    assert _row(c, "forecast_snapshots", 200) == before[200]


def test_refit_due_monday_or_when_empty():
    c = _db()
    assert np_.refit_due(c, date(2026, 11, 24))          # Tuesday, nothing stored
    _store_fit(c, "B", 0.5)
    _store_fit(c, "C", 0.5)
    assert not np_.refit_due(c, date(2026, 11, 24))
    assert np_.refit_due(c, date(2026, 11, 23))          # Monday
    c.execute("UPDATE nba_ridge_fits SET fit_date = '2026-11-23'")
    assert not np_.refit_due(c, date(2026, 11, 23))


def test_requirements_pin_sklearn():
    text = (ROOT / "requirements.txt").read_text()
    for pin in ("scikit-learn==1.9.1", "scipy==1.18.1", "joblib==1.6.0", "threadpoolctl==3.8.0"):
        assert pin in text


def _st(team, season, last, exp, minutes=200.0):
    return {"team_id": team, "season": season, "last": last, "exp_min": exp,
            "sL": {}, "sS": {}, "mL": minutes, "mS": 30.0, "tL": 10.0, "pL": 10.0}


def test_departed_last_season_players_are_excluded():
    """A MEM-like roster: last season's players are still tagged to the team."""
    prior = np_._blank_prior()
    day = "2026-11-23"
    state = {
        1: _st(29, 2026, day, 32.0),
        2: _st(29, 2026, day, 28.0),
        101: _st(29, 2025, "2025-04-10", 36.9),
        102: _st(29, 2025, "2025-04-10", 34.7),
        103: _st(29, 2025, "2025-04-10", 29.9),
        104: _st(29, 2025, "2025-04-10", 18.0),
        105: _st(29, 2025, "2025-04-10", 16.0),
        106: _st(29, 2025, "2025-04-10", 14.0),
        107: _st(29, 2025, "2025-04-10", 12.0),
        108: _st(29, 2025, "2025-04-10", 10.0),
        # played for the team this season, then his latest box is elsewhere
        201: _st(30, 2026, day, 40.0),
    }
    played = {(1, 29, 2026), (2, 29, 2026), (201, 29, 2026)}
    history = {(aid, 29) for aid in (1, 2, 101, 102, 103, 104, 105, 106, 107, 108)}
    frame = np_.assemble_side(state, 29, 2026, day, "B", set(), [], history, None, prior, played)
    assert set(frame.athlete_id.astype(int)) == {1, 2}
    assert np_.no_season_share(frame, 29, 2026, played) == 0.0
    assert np_.side_usable(frame, 0.0, played, 29, 2026)
    with_new = np_.assemble_side(
        state, 29, 2026, day, "B", set(), [999], history, None, prior, played)
    got = dict(zip(with_new.athlete_id.astype(int), with_new.exp_min))
    assert 999 in got and 101 not in got and 201 not in got
    assert got[999] == np_.EXP_MIN_DEFAULT
    share = np_.no_season_share(with_new, 29, 2026, played)
    assert math.isclose(share, np_.EXP_MIN_DEFAULT / (32.0 + 28.0 + np_.EXP_MIN_DEFAULT))
    assert share > np_.GONE_SHARE_MAX
    assert not np_.side_usable(with_new, share, played, 29, 2026)


def test_expected_minutes_halve_every_21_days():
    assert np_.decay_exp_min(30.0, "2026-11-01", "2026-11-01") == 30.0
    assert np_.decay_exp_min(30.0, None, "2026-11-22") == 30.0
    assert math.isclose(np_.decay_exp_min(30.0, "2026-11-01", "2026-11-22"), 15.0)
    long = (pd.Timestamp("2026-11-01") + pd.Timedelta(days=147)).date().isoformat()
    assert math.isclose(np_.decay_exp_min(32.0, "2026-11-01", long), 0.25)
    prior = np_._blank_prior()
    state = {1: _st(5, 2026, "2026-11-01", 32.0)}
    played = {(1, 5, 2026)}
    history = {(1, 5)}
    fresh = np_.assemble_side(state, 5, 2026, "2026-11-01", "B", set(), [], history, None, prior, played)
    assert fresh.exp_min.iloc[0] == 32.0 and fresh.w.iloc[0] == 32.0
    later = np_.assemble_side(state, 5, 2026, "2026-11-22", "B", set(), [], history, None, prior, played)
    assert math.isclose(later.exp_min.iloc[0], 16.0) and math.isclose(later.w.iloc[0], 16.0)
    stale = np_.assemble_side(state, 5, 2026, long, "B", set(), [], history, None, prior, played)
    assert stale.exp_min.iloc[0] < 1.0 and stale.w.iloc[0] == 1.0
    # the previous-game rotation keeps the stored minutes
    kept = np_.assemble_side(state, 5, 2026, "2026-11-22", "C", set(), [], history, [1], prior, played)
    assert kept.exp_min.iloc[0] == 32.0
    assert np_.fallback_src(True, True, True) == "ridge_b"
    assert np_.fallback_src(False, True, True) == "ridge_c"
    assert np_.fallback_src(False, True, False) == "team"
    assert np_.side_usable(fresh, 0.10, played, 5, 2026)
    assert not np_.side_usable(fresh, 0.10 + 1e-6, played, 5, 2026)
    assert not np_.side_usable(None, None, set(), 5, 2026)


def test_history_played_is_minutes_this_season():
    c = _db()
    _box(c, 1, "2025-04-10", 29, 30, 0, 101, minutes=36, season=2025)
    _box(c, 2, "2026-11-20", 29, 30, 1, 1, minutes=30, season=2026)
    _box(c, 3, "2026-11-20", 29, 30, 1, 2, minutes=0, season=2026)
    _box(c, 4, "2026-11-20", 29, 30, 1, 3, minutes=18, season=2026)
    c.execute("UPDATE player_game_nba SET did_not_play = 1 WHERE athlete_id = 3")
    history, played = np_._load_history(c, [29], [2025, 2026], "2026-11-23")
    assert history == {(101, 29), (1, 29), (2, 29), (3, 29)}
    assert played == {(101, 29, 2025), (1, 29, 2026)}
    assert np_._ids_played(played, 29, 2026) == {1}


def _starter(c, eid, team, aid):
    _ins(c, "nba_lineup_states", espn_event_id=eid, team_id=team, slot="PG",
         athlete_id=aid, name="New", status="Confirmed", src="nba.com",
         state_hash=f"{eid}-{team}-{aid}", valid_from="2026-11-22T16:00:00+00:00",
         last_seen="2026-11-22T16:00:00+00:00")


def _last_season_only(c):
    _ins(c, "games", espn_event_id=10, league="nba", season=2025, season_type=2,
         start_time_utc="2025-04-10T00:00:00Z", game_date="2025-04-10", home_team_id=1,
         away_team_id=2, home_score=110, away_score=100, completed=1, status="STATUS_FINAL")
    for team, opp, home, aid in ((1, 2, 1, 11), (1, 2, 1, 12), (2, 1, 0, 21), (2, 1, 0, 22)):
        _box(c, 10, "2025-04-10", team, opp, home, aid, minutes=36, season=2025)
    np_.build_state(c, date(2026, 11, 22), log=lambda *_: None)


def _apply_logged(c):
    logs = []
    out = np_.apply(c, _sched(), _forecast_row(), AS_OF, date(2026, 11, 22), log=logs.append)
    return out, logs


def _share_of(logs, team):
    line = next(m for m in logs if f"team={team} " in m)
    return float(line.split("no_season_share=")[1].split()[0])


def test_b_falls_back_when_the_side_has_no_current_season_boxes():
    c = _db()
    _last_season_only(c)
    _store_fit(c, "B", 0.8)
    _store_fit(c, "C", 0.2)
    _report(c, 100, 1, 11, "Questionable", "Guard, Home")
    _report(c, 100, 2, 21, "Questionable", "Guard, Away")
    out, logs = _apply_logged(c)
    assert out.loc[0, "nba_model_src"] == "ridge_c"
    assert out.loc[0, "home_prob"] == 0.2
    assert any("no_season_share=" in m and "fallback ridge_c" in m for m in logs)

    c2 = _db()
    _last_season_only(c2)
    _store_fit(c2, "B", 0.8)
    _report(c2, 100, 1, 11, "Questionable", "Guard, Home")
    _report(c2, 100, 2, 21, "Questionable", "Guard, Away")
    team, logs2 = _apply_logged(c2)
    assert team.loc[0, "nba_model_src"] == "team"
    assert team.loc[0, "home_prob"] == 0.4 and team.loc[0, "home_spread"] == 6.0
    assert any("fallback team" in m for m in logs2)


def test_b_falls_back_when_no_season_share_is_above_10_percent():
    c = _db()
    _prev_game(c)
    _store_fit(c, "B", 0.8)
    _store_fit(c, "C", 0.2)
    _report(c, 100, 1, 11, "Questionable", "Guard, Home")
    _report(c, 100, 2, 21, "Questionable", "Guard, Away")
    _starter(c, 100, 1, 99)
    out, logs = _apply_logged(c)
    assert out.loc[0, "nba_model_src"] == "ridge_c"
    assert _share_of(logs, 1) > np_.GONE_SHARE_MAX
    assert _share_of(logs, 2) == 0.0

    c2 = _db()
    _prev_game(c2)
    c2.execute("UPDATE player_game_nba SET minutes = 200")
    np_.build_state(c2, date(2026, 11, 22), log=lambda *_: None)
    _store_fit(c2, "B", 0.8)
    _store_fit(c2, "C", 0.2)
    _report(c2, 100, 1, 11, "Questionable", "Guard, Home")
    _report(c2, 100, 2, 21, "Questionable", "Guard, Away")
    _starter(c2, 100, 1, 99)
    stayed, logs3 = _apply_logged(c2)
    assert stayed.loc[0, "nba_model_src"] == "ridge_b"
    assert 0 < _share_of(logs3, 1) <= np_.GONE_SHARE_MAX
    assert any(m.endswith(" ridge_b") for m in logs3)


def test_ridge_c_drops_out_on_an_unsubmitted_report(monkeypatch):
    """Open Out and Doubtful rows apply to C even when the report is not submitted."""
    c = _db()
    _prev_game(c)
    _store_fit(c, "B", 0.8)
    _store_fit(c, "C", 0.2)
    _report(c, 100, 1, 11, "Out", "Guard, Home")
    _report(c, 100, 1, 12, "Questionable", "Wing, Home")
    _report(c, 100, 2, 21, "Doubtful", "Guard, Away")
    _report(c, 100, 2, None, "NOT YET SUBMITTED", np_.NOT_YET)
    seen = []
    real = np_.assemble_side

    def wrap(*args, **kwargs):
        frame = real(*args, **kwargs)
        seen.append((int(args[1]), args[4], set(args[5]),
                     set(frame.athlete_id.astype(int))))
        return frame

    monkeypatch.setattr(np_, "assemble_side", wrap)
    out = _publish(c)
    assert out.loc[0, "nba_model_src"] == "ridge_c"
    by_team = {team: (ver, outs, ids) for team, ver, outs, ids in seen}
    assert set(by_team) == {1, 2}
    assert by_team[1][0] == "C" and by_team[2][0] == "C"
    assert 11 in by_team[1][1] and 11 not in by_team[1][2]
    assert 12 not in by_team[1][1] and 12 in by_team[1][2]
    assert 21 in by_team[2][1] and 21 not in by_team[2][2]
    assert 22 in by_team[2][2]


def test_overlay_logs_the_team_fallback(monkeypatch, caplog):
    frame = pd.DataFrame({
        "espn_event_id": [9001, 9002], "home_prob": [0.61, 0.55],
        "home_spread": [-3.0, 2.0], "total_pred": [220.0, 210.0],
        "home_total_pred": [112.0, 104.0], "away_total_pred": [108.0, 106.0],
    })

    def slate_broke(*_a, **_k):
        raise RuntimeError("slate broke")

    monkeypatch.setattr(np_, "_prepare_slate", slate_broke)
    with caplog.at_level(logging.WARNING, logger="bayesratings.nba_player"):
        out = np_.overlay(None, frame, AS_OF)
    assert list(out["nba_model_src"]) == ["team", "team"]
    assert abs(float(out.loc[0, "home_prob"]) - 0.61) < 1e-6
    assert "nba player fallback event 9001: RuntimeError: slate broke" in caplog.text
    assert "nba player fallback event 9002: RuntimeError: slate broke" in caplog.text

    caplog.clear()
    monkeypatch.setattr(np_, "_prepare_slate", lambda *_a, **_k: {})

    def row_broke(*_a, **_k):
        raise ValueError("row broke")

    monkeypatch.setattr(np_, "_score_row", row_broke)
    with caplog.at_level(logging.WARNING, logger="bayesratings.nba_player"):
        out = np_.overlay(None, frame, AS_OF)
    assert list(out["nba_model_src"]) == ["team", "team"]
    assert "nba player fallback event 9001: ValueError: row broke" in caplog.text
    assert "nba player fallback event 9002: ValueError: row broke" in caplog.text
