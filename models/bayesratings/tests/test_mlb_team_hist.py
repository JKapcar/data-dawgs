"""Walk-forward MLB team+starter history. No Stan sample and no accuracy check.

Run: PYTHONPATH=. python -m pytest tests/test_mlb_team_hist.py
"""
import sqlite3

import numpy as np
import pandas as pd

from bayesratings import db, mlb_team_hist as hist


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    db.init_db(c)
    c.execute("PRAGMA foreign_keys = OFF")
    c.execute("INSERT INTO teams (team_id, league, espn_id, name, abbreviation) "
              "VALUES (10,'mlb',110,'Home','HOM')")
    c.execute("INSERT INTO teams (team_id, league, espn_id, name, abbreviation) "
              "VALUES (20,'mlb',120,'Away','AWY')")
    # Five appearances keep both clubs inside the exhibition filter.
    # The April 3 game is already stored and must not enter the April 2 fit.
    rows = [
        (1, "2022-04-01", 3, 1),
        (2, "2022-04-01", 3, 1),
        (3, "2022-04-01", 3, 1),
        (4, "2022-04-01", 3, 1),
        (5, "2022-04-02", 2, 4),
        (6, "2022-04-03", 50, 1),
    ]
    for eid, day, hs, aws in rows:
        c.execute(
            "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
            "game_date, home_team_id, away_team_id, home_score, away_score, completed, status) "
            "VALUES (?, 'mlb', 2022, 2, ?, ?, 10, 20, ?, ?, 1, 'STATUS_FINAL')",
            (eid, f"{day}T20:00:00Z", day, hs, aws))
    for eid in (1, 2, 3, 4):
        c.execute(
            "INSERT INTO forecast_snapshots (snapshot_date, league, espn_event_id, game_date, "
            "home_prob, player_prob_base, elo_weight) VALUES (?,?,?,?,?,?,0)",
            ("2022-04-01", "mlb", eid, "2022-04-01", 0.61, 0.61))
    c.execute(
        "INSERT INTO mlb_team_chance_hist (espn_event_id, game_date, season, p, source, "
        "model_version, created_at) VALUES (6,'2022-04-03',2022,0.5,'stan','t','t')")
    c.commit()
    return c


def _fit(calls):
    def fit_day(train, today):
        calls.append({
            "day": str(today["game_date"].iloc[0])[:10],
            "train_max": str(train["date"].max())[:10],
            "train_sum": float(train["home_score"].sum()),
            "today_ids": set(int(x) for x in today["espn_event_id"]),
        })
        return np.full(len(today), 0.2 + 0.01 * float(train["home_score"].sum()))
    return fit_day


def test_walk_forward_ignores_the_game_and_later_games():
    c = _db()
    calls = []
    wrote = hist.backfill(c, log=lambda *_: None, fit_day=_fit(calls))
    assert wrote == 5  # four snapshots plus the April 2 fit; April 3 was stored
    assert len(calls) == 1
    assert calls[0]["day"] == "2022-04-02"
    assert calls[0]["train_max"] < "2022-04-02"
    assert calls[0]["today_ids"] == {5}
    assert calls[0]["train_sum"] == 12.0
    snap = c.execute(
        "SELECT p, source FROM mlb_team_chance_hist WHERE espn_event_id = 1").fetchone()
    assert snap["source"] == "snapshot" and snap["p"] == 0.61
    fit = c.execute(
        "SELECT p, source FROM mlb_team_chance_hist WHERE espn_event_id = 5").fetchone()
    assert fit["source"] == "stan"
    assert abs(fit["p"] - (0.2 + 0.01 * 12)) < 1e-9

    # The game's own score is not in its training slice.
    c.execute("UPDATE games SET home_score = 9 WHERE espn_event_id = 5")
    c.execute("DELETE FROM mlb_team_chance_hist WHERE espn_event_id = 5")
    hist.backfill(c, log=lambda *_: None, fit_day=_fit(calls))
    assert len(calls) == 2
    assert calls[1]["today_ids"] == {5}
    assert calls[1]["train_sum"] == 12.0

    # An earlier game does move the later probability.
    c.execute("UPDATE games SET home_score = 8 WHERE espn_event_id = 1")
    c.execute("DELETE FROM mlb_team_chance_hist WHERE espn_event_id = 5")
    hist.backfill(c, log=lambda *_: None, fit_day=_fit(calls))
    assert calls[2]["train_sum"] == 17.0
    moved = c.execute(
        "SELECT p FROM mlb_team_chance_hist WHERE espn_event_id = 5").fetchone()[0]
    assert abs(moved - (0.2 + 0.01 * 17)) < 1e-9
    held = c.execute(
        "SELECT p, source FROM mlb_team_chance_hist WHERE espn_event_id = 1").fetchone()
    assert held["p"] == 0.61 and held["source"] == "snapshot"


def test_rerun_skips_filled_games():
    c = _db()
    calls = []
    lines = []
    first = hist.backfill(c, log=lines.append, fit_day=_fit(calls))
    assert first == 5
    assert any("2022:" in line and "done" in line for line in lines)
    n = c.execute("SELECT COUNT(*) FROM mlb_team_chance_hist").fetchone()[0]
    p5 = c.execute("SELECT p FROM mlb_team_chance_hist WHERE espn_event_id = 5").fetchone()[0]
    second = hist.backfill(c, log=lines.append, fit_day=_fit(calls))
    assert second == 0
    assert len(calls) == 1
    assert c.execute("SELECT COUNT(*) FROM mlb_team_chance_hist").fetchone()[0] == n
    assert c.execute("SELECT p FROM mlb_team_chance_hist WHERE espn_event_id = 5").fetchone()[0] == p5
    assert any("up to date" in line for line in lines)
    # Another season is a no-op and does not sample.
    assert hist.backfill(c, season=2023, log=lambda *_: None, fit_day=_fit(calls)) == 0
    assert len(calls) == 1


def test_predict_day_does_not_call_the_fit_without_history():
    done = pd.DataFrame({
        "date": pd.to_datetime(["2022-04-02"]),
        "game_date": ["2022-04-02"],
        "home_score": [1],
        "espn_event_id": [1],
    })
    called = []
    out = hist.predict_day(done, "2022-04-02", done, lambda train, today: called.append(1))
    assert out is None and called == []
