"""Pre-game logging on a made-up scoreboard. No recorded payload."""
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from bayesratings import prelog


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript((Path(__file__).resolve().parents[1] / "bayesratings" / "schema.sql").read_text())
    for tid, espn_id in ((1, 10), (2, 20)):
        c.execute("INSERT INTO teams (team_id, league, espn_id, abbreviation) VALUES (?,?,?,?)",
                  (tid, "nba", espn_id, f"T{espn_id}"))
    return c


def _game(c, eid, start):
    c.execute(
        "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
        "game_date, home_team_id, away_team_id, completed, status) "
        "VALUES (?, 'nba', 2026, 2, ?, '2026-01-02', 1, 2, 0, 'STATUS_SCHEDULED')",
        (eid, start))


def test_scoreboard_logs_a_probable_and_ignores_garbage():
    c = _db()
    _game(c, 7, "2026-01-02T00:00Z")
    payload = {"events": [{
        "id": "7",
        "competitions": [{
            "status": {"type": {"name": "STATUS_SCHEDULED"}},
            "competitors": [
                {"homeAway": "home", "team": {"id": "10"}, "probables": [{
                    "abbreviation": "SP", "athlete": {"id": "101", "displayName": "Home Starter"},
                }]},
                {"homeAway": "away", "team": {"id": "20"}, "probables": []},
            ],
        }],
    }]}
    st = prelog.log_scoreboard(c, "nba", payload)
    assert st.get("probables_new") == 1
    assert prelog.log_scoreboard(c, "nba", {"garbage": 1}) == {}


def test_due_window_and_a_postponed_game():
    c = _db()
    start = "2026-01-02T00:00Z"
    _game(c, 7, start)
    now = datetime(2026, 1, 1, 22, 50, tzinfo=timezone.utc)
    assert [d[0] for d in prelog.due_games(c, now)] == [7]
    assert prelog.due_games(c, now - timedelta(minutes=40)) == []
    c.execute("UPDATE games SET status='STATUS_POSTPONED' WHERE espn_event_id=7")
    assert prelog.due_games(c, now) == []


def test_scoreboard_stores_espn_odds():
    c = _db()
    _game(c, 7, "2026-01-02T00:00Z")
    payload = {"events": [{
        "id": "7",
        "competitions": [{
            "status": {"type": {"name": "STATUS_SCHEDULED"}},
            "competitors": [
                {"homeAway": "home", "team": {"id": "10"}, "probables": []},
                {"homeAway": "away", "team": {"id": "20"}, "probables": []},
            ],
            "odds": [{
                "provider": {"id": "45", "name": "ESPN"},
                "details": "HOM -150",
                "overUnder": 220.5,
                "moneyline": {"home": {"close": {"odds": "-150"}, "open": {"odds": "-140"}},
                              "away": {"close": {"odds": "+130"}, "open": {"odds": "+120"}}},
                "pointSpread": {"home": {"close": {"line": "-3.5", "odds": "-110"},
                                         "open": {"line": "-3.0"}},
                                "away": {"close": {"odds": "-110"}}},
                "total": {"over": {"close": {"line": "220.5", "odds": "-110"},
                                   "open": {"line": "219.5"}},
                          "under": {"close": {"odds": "-110"}}},
                "homeTeamOdds": {"favorite": True},
            }],
        }],
    }]}
    st = prelog.log_scoreboard(c, "nba", payload)
    assert st.get("odds_new") == 1
    row = c.execute("SELECT home_ml, away_ml, home_spread, total, provider FROM game_odds").fetchone()
    assert (row["home_ml"], row["away_ml"], row["home_spread"], row["total"], row["provider"]) == (
        -150, 130, -3.5, 220.5, "ESPN")


def test_value_helpers():
    assert prelog._int("-114") == -114 and prelog._int("+158") == 158
    assert prelog._int("EVEN") == 100
    assert prelog._float("52.5") == 52.5 and prelog._float("-1.5") == -1.5
    assert prelog._int("") is None and prelog._float(None) is None
    assert prelog.slim({"a": 1, "links": [1], "b": [{"logo": "x", "c": 2}]}) == {"a": 1, "b": [{"c": 2}]}
