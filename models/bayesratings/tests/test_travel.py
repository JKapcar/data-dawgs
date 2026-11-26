"""Venue coordinates, travel distance, and the missing-venue check.

Small fixtures only. No network. The checked-in CSV is reference data, so
a few rows are locked to the Wikipedia coordinates they were copied from.
"""
import sqlite3
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import pytest

from bayesratings import db, nba_player, nhl_player, travel
from bayesratings.sources import check


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    db.init_db(c)
    return c


def _teams(c):
    c.execute("INSERT INTO teams (league, espn_id, abbreviation) VALUES ('mlb', 1, 'BOS')")
    c.execute("INSERT INTO teams (league, espn_id, abbreviation) VALUES ('mlb', 2, 'NYY')")
    ids = {r["espn_id"]: r["team_id"] for r in c.execute("SELECT team_id, espn_id FROM teams")}
    return ids[1], ids[2]


def _game(c, eid, home, away, start, day, venue, status="STATUS_FINAL"):
    c.execute(
        "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
        "game_date, home_team_id, away_team_id, home_score, away_score, completed, status, venue) "
        "VALUES (?,?,2026,2,?,?,?,?,3,1,1,?,?)",
        (eid, "mlb", start, day, home, away, status, venue))


def test_haversine_equator_degree_symmetry_and_zero():
    one = float(travel.haversine_km(0, 0, 0, 1))
    # 6371.0088 km * pi/180, one degree of longitude on the equator.
    assert one == pytest.approx(111.1950802335329, abs=1e-6)
    assert float(travel.haversine_km(0.0, 0.0, 0.0, 0.0)) == 0.0
    forward = float(travel.haversine_km(42.3, -71.1, 40.8, -73.9))
    back = float(travel.haversine_km(40.8, -73.9, 42.3, -71.1))
    assert forward == pytest.approx(back, abs=1e-9)
    assert forward > 0


def test_tz_shift_includes_daylight_saving():
    winter = "2026-01-15T18:00:00Z"
    summer = "2026-07-15T18:00:00Z"
    # Phoenix does not observe daylight saving. New York is UTC-5 in
    # January and UTC-4 in July, so the same trip is a different shift.
    assert travel.tz_shift_hours("America/New_York", winter, "America/Phoenix", winter) == -2
    assert travel.tz_shift_hours("America/New_York", summer, "America/Phoenix", summer) == -3
    assert travel.tz_shift_hours("America/Phoenix", winter, "America/New_York", winter) == 2
    assert travel.tz_shift_hours(None, winter, "America/New_York", winter) is None
    assert travel.tz_shift_hours("America/New_York", winter, "America/New_York", None) is None


def test_csv_locks_cited_coordinates_and_real_zones():
    from zoneinfo import ZoneInfo
    rows = {r["name"]: r for r in travel.read_rows()}
    assert len(rows) == 154
    assert sum(1 for r in rows.values() if r["aliases"]) == 4
    fenway, yankee = rows["Fenway Park"], rows["Yankee Stadium"]
    assert fenway["lat"] == "42.34638889" and fenway["lon"] == "-71.09777778"
    assert fenway["tz"] == "America/New_York" and fenway["source"] == "Wikipedia"
    assert yankee["city"] == "Bronx" and yankee["lat"] == "40.82916667"
    assert yankee["lon"] == "-73.92638889" and yankee["source"] == "Wikipedia"
    new, old = rows["Highmark Stadium"], rows["Highmark Stadium (Old)"]
    assert new["source"] == "Wikipedia" and old["source"] == "Wikipedia"
    apart = float(travel.haversine_km(float(new["lat"]), float(new["lon"]),
                                      float(old["lat"]), float(old["lon"])))
    assert 0.2 < apart < 2.0
    for r in rows.values():
        ZoneInfo(r["tz"])
        assert r["source"] in ("Wikipedia", "Wikidata")
        assert -90 <= float(r["lat"]) <= 90 and -180 <= float(r["lon"]) <= 180
    km = float(travel.haversine_km(float(fenway["lat"]), float(fenway["lon"]),
                                   float(yankee["lat"]), float(yankee["lon"])))
    assert 250 < km < 400


def test_alias_matches_folded_spelling_and_reloads():
    c = _conn()
    n_venues = c.execute("SELECT COUNT(*) FROM venue_coords").fetchone()[0]
    n_alias = c.execute("SELECT COUNT(*) FROM venue_aliases").fetchone()[0]
    assert n_venues == 154 and n_alias == 158
    travel.load_coords(c)
    assert c.execute("SELECT COUNT(*) FROM venue_coords").fetchone()[0] == n_venues
    assert c.execute("SELECT COUNT(*) FROM venue_aliases").fetchone()[0] == n_alias
    accor = c.execute("SELECT lat, lon FROM venue_coords WHERE name = 'Accor Arena'").fetchone()
    folded = travel.attach_coords(pd.DataFrame([{"espn_event_id": 1, "venue": "  bercy   arena "}]), c)
    assert folded.loc[0, "venue_lat"] == accor["lat"]
    assert folded.loc[0, "venue_tz"] == "Europe/Paris"
    fenway = travel.attach_coords(pd.DataFrame([{"espn_event_id": 2, "venue": "fenway park"}]), c)
    assert fenway.loc[0, "venue_lat"] == pytest.approx(42.34638889)
    unknown = travel.attach_coords(pd.DataFrame([{"espn_event_id": 3, "venue": "Brand New Arena"}]), c)
    assert pd.isna(unknown.loc[0, "venue_lat"]) and unknown.loc[0, "venue_tz"] is None


def test_view_joins_the_exact_spelling():
    c = _conn()
    bos, nyy = _teams(c)
    _game(c, 1, bos, nyy, "2026-01-10T18:00:00Z", "2026-01-10", "Fenway Park")
    _game(c, 2, nyy, bos, "2026-01-12T18:00:00Z", "2026-01-12", "Bercy Arena")
    _game(c, 3, bos, nyy, "2026-01-13T18:00:00Z", "2026-01-13", "fenway park")
    exact = c.execute("SELECT lat, tz, venue_name FROM game_venues WHERE espn_event_id = 1").fetchone()
    assert exact["venue_name"] == "Fenway Park"
    assert exact["lat"] == pytest.approx(42.34638889) and exact["tz"] == "America/New_York"
    alias = c.execute("SELECT venue_name, lat FROM game_venues WHERE espn_event_id = 2").fetchone()
    assert alias["venue_name"] == "Accor Arena"
    assert alias["lat"] == pytest.approx(48.83861111)
    folded = c.execute("SELECT lat FROM game_venues WHERE espn_event_id = 3").fetchone()
    assert folded["lat"] is None


def test_trip_uses_previous_game_and_skips_a_postponement():
    games = pd.DataFrame([
        {"espn_event_id": 1, "league": "nba", "game_date": "2026-01-10",
         "start_time_utc": "2026-01-10T18:00:00Z", "home_team_id": 1, "away_team_id": 2,
         "venue": "Home", "venue_lat": 0.0, "venue_lon": 0.0, "venue_tz": "America/New_York",
         "status": "STATUS_FINAL"},
        {"espn_event_id": 9, "league": "nba", "game_date": "2026-01-11",
         "start_time_utc": "2026-01-11T18:00:00Z", "home_team_id": 1, "away_team_id": 2,
         "venue": "Skipped", "venue_lat": 40.0, "venue_lon": 40.0, "venue_tz": "Europe/Paris",
         "status": "STATUS_POSTPONED"},
        {"espn_event_id": 2, "league": "nba", "game_date": "2026-01-12",
         "start_time_utc": "2026-01-12T18:00:00Z", "home_team_id": 2, "away_team_id": 1,
         "venue": "Away", "venue_lat": 0.0, "venue_lon": 1.0, "venue_tz": "America/Phoenix",
         "status": "STATUS_FINAL"},
        {"espn_event_id": 3, "league": "nba", "game_date": "2026-01-12",
         "start_time_utc": "2026-01-12T23:00:00Z", "home_team_id": 1, "away_team_id": 2,
         "venue": "Away", "venue_lat": 0.0, "venue_lon": 1.0, "venue_tz": "America/Phoenix",
         "status": "STATUS_FINAL"},
    ])
    wide = travel.home_away(games).set_index("espn_event_id")
    assert pd.isna(wide.loc[1, "h_rest_days"]) and pd.isna(wide.loc[1, "h_travel_km"])
    assert wide.loc[1, "h_prev_venue"] is None or pd.isna(wide.loc[1, "h_prev_venue"])
    assert wide.loc[2, "h_prev_venue"] == "Home" and wide.loc[2, "a_prev_venue"] == "Home"
    assert wide.loc[2, "h_travel_km"] == pytest.approx(111.1950802335329, abs=1e-6)
    assert wide.loc[2, "a_travel_km"] == pytest.approx(wide.loc[2, "h_travel_km"])
    assert wide.loc[2, "h_tz_shift_hours"] == -2 and wide.loc[2, "a_tz_shift_hours"] == -2
    assert wide.loc[2, "h_rest_days"] == 2 and wide.loc[2, "a_rest_days"] == 2
    assert wide.loc[3, "h_prev_venue"] == "Away" and wide.loc[3, "h_travel_km"] == 0
    assert wide.loc[3, "h_tz_shift_hours"] == 0 and wide.loc[3, "h_rest_days"] == 0
    assert set(wide.index) == {1, 2, 3}


def test_same_start_orders_by_event_id():
    games = pd.DataFrame([
        {"espn_event_id": 5, "game_date": "2026-07-01", "start_time_utc": "2026-07-01T17:00:00Z",
         "home_team_id": 1, "away_team_id": 2, "venue": "Second", "venue_lat": 0.0, "venue_lon": 1.0,
         "venue_tz": "America/New_York", "status": "STATUS_FINAL"},
        {"espn_event_id": 4, "game_date": "2026-07-01", "start_time_utc": "2026-07-01T17:00:00Z",
         "home_team_id": 1, "away_team_id": 2, "venue": "First", "venue_lat": 0.0, "venue_lon": 0.0,
         "venue_tz": "America/Phoenix", "status": "STATUS_FINAL"},
    ])
    wide = travel.home_away(games).set_index("espn_event_id")
    assert pd.isna(wide.loc[4, "h_travel_km"])
    assert wide.loc[5, "h_prev_venue"] == "First"
    assert wide.loc[5, "h_tz_shift_hours"] == 3  # July: New York -4 minus Phoenix -7


def test_missing_venue_check_warns_and_names_it():
    c = _conn()
    bos, nyy = _teams(c)
    _game(c, 1, bos, nyy, "2026-01-10T18:00:00Z", "2026-01-10", "Fenway Park")
    _game(c, 2, nyy, bos, "2026-01-12T18:00:00Z", "2026-01-12", "Brand New Arena")
    _game(c, 3, bos, nyy, "2026-01-13T18:00:00Z", "2026-01-13", None)
    level, msg = travel.coverage_check(c)
    assert level == "WARN"
    assert "Brand New Arena (1)" in msg and "(no venue) (1)" in msg
    assert "Fenway" not in msg
    assert "2 games, 2 venues" in msg
    listed = travel.unmatched_games(c)
    assert {r[0] for r in listed} == {2, 3}
    ok_level, ok_msg = travel.coverage_check(_conn())
    assert ok_level == "OK" and ok_msg.startswith("all 0 games")
    bare = sqlite3.connect(":memory:")
    bare.row_factory = sqlite3.Row
    bare.executescript((db.SCHEMA_FILE).read_text())
    _game_on(bare)
    assert travel.coverage_check(bare) == ("WARN", "venue coordinates are not loaded")
    found = {src: (lvl, text) for src, lvl, text in check.check(
        bare, datetime(2026, 1, 15, tzinfo=timezone.utc), daily_status="/nonexistent")}
    assert found["venue_coords"][0] == "WARN"
    assert found["venue_coords"][1] == "venue coordinates are not loaded"


def _game_on(c):
    c.execute("INSERT INTO teams (league, espn_id, abbreviation) VALUES ('mlb', 1, 'BOS')")
    c.execute("INSERT INTO teams (league, espn_id, abbreviation) VALUES ('mlb', 2, 'NYY')")
    bos, nyy = [r[0] for r in c.execute("SELECT team_id FROM teams ORDER BY espn_id")]
    c.execute(
        "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
        "game_date, home_team_id, away_team_id, completed, status, venue) "
        "VALUES (1,'mlb',2026,2,'2026-01-10T18:00:00Z','2026-01-10',?,?,0,'STATUS_SCHEDULED','Fenway Park')",
        (bos, nyy))


def test_empty_database_has_no_venue_warning():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(db.SCHEMA_FILE.read_text())
    assert travel.coverage_check(c) == ("OK", "no games")


def test_training_matrices_ignore_missing_travel():
    X = pd.DataFrame({
        "espn_event_id": [1, 2],
        "season": [2024, 2024],
        "game_date": ["2024-01-02", "2024-01-03"],
        "start_time_utc": ["2024-01-02T00:00:00Z", "2024-01-03T00:00:00Z"],
        "y": [1, 0],
        "margin": [5.0, -3.0],
        "h_rest": [2, 1],
        "a_rest": [2, 1],
        "neutral_site": [0, 0],
        "neutral": [0, 0],
        "h_A_x": [1.0, 2.0],
        "a_A_x": [0.5, 0.5],
        "h_travel_km": [np.nan, np.nan],
        "a_travel_km": [np.nan, 10.0],
        "h_tz_shift_hours": [np.nan, np.nan],
        "h_rest_days": [np.nan, 1.0],
    })
    for mod in (nba_player, nhl_player):
        got = mod.build_matrix(X, "A")
        assert len(got) == 2
        feat = mod.feature_columns(got)
        assert "d_x" in feat
        assert mod.CTX_COLS == ("h_b2b", "a_b2b", "rest_d", "neutral")
        assert not any("travel" in c or "rest_days" in c or "tz_shift" in c for c in feat)


def test_nhl_frame_keeps_fitted_rest_and_adds_raw_days():
    games = pd.DataFrame([
        {"espn_event_id": 1, "league": "nhl", "season": 2026, "season_type": 2,
         "game_date": "2026-01-10", "start_time_utc": "2026-01-10T00:00:00Z",
         "home_team_id": 1, "away_team_id": 2, "home_score": 3, "away_score": 1,
         "completed": 1, "status": "STATUS_FINAL", "neutral_site": 0},
        {"espn_event_id": 2, "league": "nhl", "season": 2026, "season_type": 2,
         "game_date": "2026-01-12", "start_time_utc": "2026-01-12T00:00:00Z",
         "home_team_id": 1, "away_team_id": 2, "home_score": 2, "away_score": 4,
         "completed": 1, "status": "STATUS_FINAL", "neutral_site": 0},
    ])
    out = nhl_player.games_frame(games).set_index("espn_event_id")
    assert out.loc[1, "h_rest"] == 7 and pd.isna(out.loc[1, "h_rest_days"])
    assert out.loc[2, "h_rest"] == 2 and out.loc[2, "h_rest_days"] == 2
    assert pd.isna(out.loc[2, "h_travel_km"])
    assert set(travel.HOME_AWAY_COLS).issubset(out.columns)
