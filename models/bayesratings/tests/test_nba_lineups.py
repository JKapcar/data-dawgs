"""Probable NBA lineups, from a made-up payload. No network."""
from bayesratings.sources import nbalineups


def test_parse_lineups_keeps_the_five_slots():
    payload = {"games": [{
        "gameId": "1",
        "homeTeam": {"teamAbbreviation": "BOS", "players": [
            {"position": "PG", "playerName": "A Guard", "lineupStatus": "Expected", "personId": 11},
            {"position": "XX", "playerName": "Skip", "personId": 99},
        ]},
        "awayTeam": {"teamAbbreviation": "NYK", "players": [
            {"firstName": "B", "lastName": "Forward", "position": "SF", "personId": 22},
        ]},
    }]}
    rows = nbalineups.parse_lineups(payload)
    assert [(r["side"], r["slot"], r["name"]) for r in rows] == [
        ("home", "PG", "A Guard"),
        ("away", "SF", "B Forward"),
    ]
    assert rows[0]["status"] == "Expected"


def test_depth_chart_takes_the_first_player_at_each_spot():
    payload = {"depthchart": [{"positions": {
        "pg": {"athletes": [{"id": "5", "displayName": "One"}, {"id": "6", "displayName": "Two"}]},
        "c": {"athletes": [{"id": "5", "displayName": "One"}, {"id": "8", "displayName": "Center"}]},
    }}]}
    out = nbalineups.depth_starters(payload)
    assert out[0] == ("PG", 5, "One")
    assert ("C", 8, "Center") in out
