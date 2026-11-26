"""Exhibition games (All-Star, Pro Bowl, 4 Nations) stay out of the model.
Run: python -m pytest tests/  (or python tests/test_exhibition.py)"""
import sqlite3
import warnings
from pathlib import Path

import pandas as pd

from bayesratings import db, espn
from bayesratings.hybrid import build_features

SCHEMA = Path(__file__).resolve().parents[1] / "bayesratings" / "schema.sql"


def test_is_exhibition_by_name_and_notes():
    assert espn.is_exhibition({"name": "Team Canada at Team USA",
                               "notes": [{"headline": "4 Nations Face-Off"}]})
    assert espn.is_exhibition({"name": "2023 NHL All-Star Game"})
    assert espn.is_exhibition({"name": "AFC at NFC", "competitions": [
        {"notes": [{"headline": "Pro Bowl Games"}]}]})
    assert espn.is_exhibition({"name": "X", "competitions": [
        {"type": {"abbreviation": "ALLSTAR"}}]})
    assert not espn.is_exhibition({"name": "Boston Bruins at Toronto Maple Leafs",
                                   "competitions": [{"type": {"abbreviation": "STD"}}]})


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA.read_text())
    return conn


def test_read_games_drops_teams_with_few_games():
    conn = _conn()
    for tid in (1, 2, 3, 4):
        conn.execute("INSERT INTO teams (team_id, league, espn_id, name) "
                     "VALUES (?, 'nhl', ?, ?)", (tid, tid, f"T{tid}"))
    rows, eid = [], 0
    for i in range(6):  # real teams 1 & 2 play 6 games each
        eid += 1
        rows.append((eid, 1, 2))
    eid += 1
    rows.append((eid, 3, 4))  # exhibition squads, one game
    eid += 1
    rows.append((eid, 1, 3))  # real team vs exhibition squad
    for e, h, a in rows:
        conn.execute(
            "INSERT INTO games (espn_event_id, league, season, season_type, "
            "start_time_utc, game_date, home_team_id, away_team_id, home_score, "
            "away_score, completed) VALUES (?, 'nhl', 2025, 2, ?, '2025-01-01', "
            "?, ?, 3, 2, 1)", (e, f"2025-01-01T00:00:{e:02d}Z", h, a))
    got = db.read_games(conn, "nhl")
    assert len(got) == 6
    assert set(got.home_team) | set(got.away_team) == {"1", "2"}
    assert len(db.read_games(conn, "nhl", exclude_exhibition=False)) == 8

    assert db.exhibition_team_ids(conn) == {3, 4}
    clause = db.not_exhibition_sql({3, 4}, "g")
    n = conn.execute(f"SELECT COUNT(*) FROM games g WHERE {clause}").fetchone()[0]
    assert n == 6
    assert db.not_exhibition_sql(set()) == "1=1"


def test_hybrid_fit_quiet_for_past_teams():
    games = pd.DataFrame({"season": [2024], "date": ["2024-01-01"],
                          "home_team": ["old"], "away_team": ["a"],
                          "home_score": [3], "away_score": [1]})
    ratings = pd.Series({"a": 0.1})
    stats = pd.DataFrame({"team": ["a"], "OS": [1.0], "DS": [1.0]})
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        build_features(games, ratings, stats, warn_unknown=False)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
