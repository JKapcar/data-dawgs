"""Player lines from a made-up box score. No network and no recorded payload."""
import json
import sqlite3
from pathlib import Path

from bayesratings import db, players


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript((Path(__file__).resolve().parents[1] / "bayesratings" / "schema.sql").read_text())
    c.execute("INSERT INTO teams (team_id, league, espn_id, abbreviation, name) VALUES (1,'nba',10,'HOM','Home')")
    c.execute("INSERT INTO teams (team_id, league, espn_id, abbreviation, name) VALUES (2,'nba',20,'AWY','Away')")
    c.execute(
        "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
        "game_date, home_team_id, away_team_id, home_score, away_score, completed, status) "
        "VALUES (7,'nba',2026,2,'2026-01-02T00:00Z','2026-01-01',1,2,110,100,1,'STATUS_FINAL')")
    return c


def _side(espn_id, athlete, points):
    return {
        "team": {"id": str(espn_id)},
        "statistics": [{
            "keys": ["minutes", "points"],
            "athletes": [{
                "starter": True,
                "athlete": {"id": str(athlete), "displayName": f"Player {athlete}", "position": {"abbreviation": "G"}},
                "stats": ["32", str(points)],
            }],
        }],
    }


def test_parse_and_store_one_nba_game():
    c = _db()
    game = dict(c.execute("SELECT * FROM games WHERE espn_event_id=7").fetchone())
    summary = {"boxscore": {"players": [_side(10, 101, 28), _side(20, 202, 22)]}}
    rows, dropped = players.parse_game(summary, game, {10: 1, 20: 2})
    assert dropped == 0
    assert rows["player_game_nba"][0]["pts"] == 28
    assert rows["player_game_nba"][1]["athlete_id"] == 202
    cols = {t: players._columns(c, t) for t in players.TABLES["nba"]}
    n = players.store_game(c, "nba", 7, rows, cols)
    assert n == 2
    assert c.execute("SELECT COUNT(*) FROM player_game_nba").fetchone()[0] == 2


def test_extract_on_an_empty_log_is_a_no_op():
    c = _db()
    out = players.extract(c, ["nba"], log=lambda *_: None)
    assert out["nba"].get("ok", 0) == 0
