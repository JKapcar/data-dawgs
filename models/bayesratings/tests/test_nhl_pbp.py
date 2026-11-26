"""NHL shot location parsing, the no-op when nothing finished, idempotent
stores, and goalie GSAx. No network and no accuracy backtest.

    PYTHONPATH=. python tests/test_nhl_pbp.py
"""
import json
import math
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from bayesratings import db
from bayesratings.backfill import Pacer
from bayesratings.sources import check, nhl_pbp

ROOT = Path(__file__).resolve().parents[1]
FIX = json.loads((ROOT / "tests" / "fixtures" / "sources" / "nhl_pbp_min.json").read_text())
NOW = datetime(2026, 11, 22, 13, 30, tzinfo=timezone.utc)  # 07:30 CT
PBP = json.dumps(FIX["pbp"]).encode()
BOX = json.dumps(FIX["box"]).encode()


def _db():
    conn = db.connect(":memory:")
    conn.isolation_level = None
    db.init_db(conn)
    return conn


def _team(conn, espn_id, abbr):
    conn.execute("INSERT INTO teams (league, espn_id, abbreviation, name) VALUES ('nhl', ?, ?, ?)",
                 (espn_id, abbr, abbr))
    return conn.execute("SELECT team_id FROM teams WHERE league = 'nhl' AND espn_id = ?",
                        (espn_id,)).fetchone()[0]


def _final(conn, eid, home, away, game_date, completed=1, status="STATUS_FINAL"):
    conn.execute(
        "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
        "game_date, home_team_id, away_team_id, completed, status) "
        "VALUES (?, 'nhl', 2026, 2, ?, ?, ?, ?, ?, ?)",
        (eid, game_date + "T00:00Z", game_date, home, away, completed, status))


def _by_event(shots):
    return {s["event_id"]: s for s in shots}


def test_parse_shots_distance_strength_and_flags():
    header, shots = nhl_pbp.parse_game(FIX["pbp"])
    assert header["nhl_game_id"] == 2025020001
    assert header["home_abbrev"] == "BOS" and header["season"] == 2025
    by = _by_event(shots)
    assert [s["result"] for s in shots] == [
        "shot", "shot", "miss", "block", "goal", "goal", "shot", "goal"]
    rush = by[10]
    assert rush["rush"] == 1 and rush["rebound"] == 0
    assert rush["shooter_id"] == 101 and rush["goalie_id"] == 201
    assert rush["strength"] == "even" and rush["is_home"] == 1
    # Home defends the left goal (x = -89), so Boston shoots at +89.
    assert round(rush["distance"], 4) == round(math.hypot(89 - 55, 11), 4)
    assert round(rush["angle"], 4) == round(math.degrees(math.atan2(11, 34)), 4)
    rebound = by[11]
    assert rebound["rebound"] == 1 and rebound["rush"] == 0
    assert round(rebound["distance"], 4) == 9.0 and round(rebound["angle"], 4) == 0.0
    assert by[13]["result"] == "block" and by[13]["goalie_id"] is None
    goal = by[20]
    assert goal["strength"] == "powerplay" and goal["shooter_id"] == 401
    assert round(goal["distance"], 4) == 8.0
    empty = by[21]
    assert empty["strength"] == "empty" and empty["goalie_id"] is None
    assert by[22]["distance"] is None and by[22]["angle"] is None
    assert by[90]["period_type"] == "SO"
    people = nhl_pbp.parse_box(FIX["box"], 6, 8)
    nhl_pbp.roster_names(FIX["pbp"])
    assert people[101]["toi_sec"] == 600
    assert people[101]["name"] == "B. Marchand"
    names = nhl_pbp.roster_names(FIX["pbp"])
    assert names[101] == "Brad Marchand"


def test_net_is_inferred_when_the_defending_side_is_missing():
    payload = {
        "id": 2010020001, "season": 20102011, "gameType": 2, "gameDate": "2010-10-07",
        "homeTeam": {"id": 6, "abbrev": "BOS", "score": 1},
        "awayTeam": {"id": 15, "abbrev": "WSH", "score": 0},
        "plays": [
            {"eventId": 1, "sortOrder": 1, "periodDescriptor": {"number": 1, "periodType": "REG"},
             "timeInPeriod": "01:00", "typeDescKey": "shot-on-goal",
             "details": {"xCoord": 70, "yCoord": 0, "zoneCode": "O", "shotType": "wrist",
                         "shootingPlayerId": 1, "eventOwnerTeamId": 6}},
            {"eventId": 2, "sortOrder": 2, "periodDescriptor": {"number": 1, "periodType": "REG"},
             "timeInPeriod": "02:00", "typeDescKey": "missed-shot",
             "details": {"xCoord": -80, "yCoord": 0, "zoneCode": "O", "shotType": "wrist",
                         "shootingPlayerId": 2, "eventOwnerTeamId": 15}},
        ],
    }
    _, shots = nhl_pbp.parse_game(payload)
    by = _by_event(shots)
    assert by[1]["distance"] == 19.0
    assert by[2]["distance"] == 9.0


def test_gsax_is_xg_faced_on_unblocked_shots_minus_goals():
    shots = [
        {"period_type": "REG", "result": "shot", "shooter_id": 101, "goalie_id": 201,
         "team_nhl_id": 6, "opp_nhl_id": 8, "is_home": 1, "xg": 0.10, "strength": "even"},
        {"period_type": "REG", "result": "shot", "shooter_id": 102, "goalie_id": 201,
         "team_nhl_id": 6, "opp_nhl_id": 8, "is_home": 1, "xg": 0.40, "strength": "even"},
        {"period_type": "REG", "result": "miss", "shooter_id": 101, "goalie_id": 201,
         "team_nhl_id": 6, "opp_nhl_id": 8, "is_home": 1, "xg": 0.05, "strength": "even"},
        {"period_type": "REG", "result": "block", "shooter_id": 103, "goalie_id": 201,
         "team_nhl_id": 6, "opp_nhl_id": 8, "is_home": 1, "xg": 0.99, "strength": "even"},
        {"period_type": "REG", "result": "goal", "shooter_id": 401, "goalie_id": 501,
         "team_nhl_id": 8, "opp_nhl_id": 6, "is_home": 0, "xg": 0.30, "strength": "powerplay"},
        {"period_type": "REG", "result": "goal", "shooter_id": 402, "goalie_id": 501,
         "team_nhl_id": 8, "opp_nhl_id": 6, "is_home": 0, "xg": 0.80, "strength": "empty"},
        {"period_type": "SO", "result": "goal", "shooter_id": 101, "goalie_id": 201,
         "team_nhl_id": 6, "opp_nhl_id": 8, "is_home": 1, "xg": 0.70, "strength": "even"},
    ]
    people = {101: {"role": "skater", "toi_sec": 600, "name": "A", "team_nhl_id": 6, "is_home": 1,
                    "position": "L"}}
    rows = { (r["player_id"], r["role"]): r
             for r in nhl_pbp.build_player_rows(1, shots, people) }
    goalie = rows[(201, "goalie")]
    assert goalie["shots"] == 3 and goalie["goals"] == 0
    assert round(goalie["xg"], 4) == 0.55
    assert round(goalie["gsax"], 4) == 0.55
    other = rows[(501, "goalie")]
    assert other["shots"] == 1 and other["goals"] == 1
    assert round(other["gsax"], 4) == round(0.30 - 1, 4)
    skater = rows[(101, "skater")]
    assert skater["shots"] == 2 and skater["goals"] == 0
    assert round(skater["xg"], 4) == 0.15
    assert round(skater["xg_per_60"], 4) == round(0.15 * 3600 / 600, 4)
    assert rows[(102, "skater")]["xg_per_60"] is None


def test_fit_ranks_a_closer_shot_higher():
    shots = []
    for i in range(200):
        shots.append({"distance": 12, "angle": 8, "result": "goal" if i < 150 else "miss",
                      "shot_type": "wrist", "strength": "even", "rebound": 0, "rush": 0,
                      "period_type": "REG"})
    for i in range(200):
        shots.append({"distance": 55, "angle": 40, "result": "goal" if i < 16 else "shot",
                      "shot_type": "wrist", "strength": "even", "rebound": 0, "rush": 0,
                      "period_type": "REG"})
    coef = nhl_pbp.fit_shots(shots)
    assert coef is not None
    assert coef[nhl_pbp.FEATURES.index("distance")] < 0
    close = dict(shots[0])
    far = dict(shots[200])
    nhl_pbp.score_shots([close, far], {"coef": coef})
    assert close["xg"] > 0.5 > far["xg"]


def test_init_db_is_idempotent():
    conn = _db()
    db.init_db(conn)
    assert conn.execute("SELECT COUNT(*) FROM nhl_shots").fetchone()[0] == 0


def test_store_is_idempotent_and_a_new_body_replaces():
    conn = _db()
    assert nhl_pbp.store_game(conn, PBP, BOX, at="t1") == 8
    assert nhl_pbp.store_game(conn, PBP, BOX, at="t2") == 0
    assert conn.execute("SELECT COUNT(*) FROM nhl_shots").fetchone()[0] == 8
    assert tuple(conn.execute("SELECT fetched_at, n_shots FROM nhl_games").fetchone()) == ("t1", 8)
    assert conn.execute("SELECT value FROM src_meta WHERE key = 'nhl_pbp:2025020001'").fetchone()[0]
    row = conn.execute("SELECT toi_sec, name, xg FROM nhl_player_xg WHERE player_id = 101 "
                       "AND role = 'skater'").fetchone()
    assert row["toi_sec"] == 600 and row["name"] == "Brad Marchand" and row["xg"] is None
    body = json.loads(PBP)
    body["plays"].append({
        "eventId": 30, "sortOrder": 12, "periodDescriptor": {"number": 2, "periodType": "REG"},
        "timeInPeriod": "00:20", "situationCode": "1551", "homeTeamDefendingSide": "right",
        "typeDescKey": "shot-on-goal",
        "details": {"xCoord": 40, "yCoord": 0, "zoneCode": "O", "shotType": "slap",
                    "shootingPlayerId": 104, "goalieInNetId": 201, "eventOwnerTeamId": 6}})
    assert nhl_pbp.store_game(conn, json.dumps(body).encode(), BOX, at="t3") == 9
    assert conn.execute("SELECT COUNT(*) FROM nhl_shots").fetchone()[0] == 9
    assert conn.execute("SELECT fetched_at FROM nhl_games").fetchone()[0] == "t3"


def test_match_uses_espn_abbreviations():
    games = [{"game_date": "2026-11-21", "home_abbrev": "TBL", "away_abbrev": "BOS",
              "nhl_game_id": 5}]
    assert nhl_pbp.match_game(games, "TB", "BOS", "2026-11-21") == 5
    assert nhl_pbp.match_game(games, "TB", "BOS", "2026-11-20") == 5
    two = games + [{"game_date": "2026-11-21", "home_abbrev": "TBL", "away_abbrev": "BOS",
                    "nhl_game_id": 6}]
    assert nhl_pbp.match_game(two, "TB", "BOS", "2026-11-21") is None


def _fetch(calls, pbp=PBP):
    def fetch(url, **_kw):
        calls.append(url)
        if url.endswith("/robots.txt"):
            return b"User-agent: *\nAllow: /\n"
        if "/schedule/" in url:
            return json.dumps({"gameWeek": [{"date": "2026-11-21", "games": [{
                "id": 2025020001, "season": 20252026, "gameType": 2, "gameDate": "2026-11-21",
                "gameState": "OFF", "gameScheduleState": "OK",
                "homeTeam": {"id": 6, "abbrev": "BOS", "score": 1},
                "awayTeam": {"id": 8, "abbrev": "MTL", "score": 2},
            }]}]}).encode()
        if url.endswith("/play-by-play"):
            return pbp
        if url.endswith("/boxscore"):
            return BOX
        raise AssertionError(url)
    return fetch


def test_pass_is_a_no_op_without_finished_games_and_idempotent_after():
    conn = _db()
    calls = []
    st = nhl_pbp.current_pass(conn, Pacer(0), now=NOW, log=lambda *_: None, fetch=_fetch(calls))
    assert st == {"skipped": "no new finished games"} and calls == []
    home, away = _team(conn, 6, "BOS"), _team(conn, 8, "MTL")
    _final(conn, 77, home, away, "2026-11-21")
    _final(conn, 78, home, away, "2026-11-21", status="STATUS_POSTPONED")
    st = nhl_pbp.current_pass(conn, Pacer(0), now=NOW, log=lambda *_: None, fetch=_fetch(calls))
    assert st["games"] == 1 and st["rows"] == 8 and st["errors"] == 0
    assert any(u.endswith("/play-by-play") for u in calls)
    n_calls = len(calls)
    again = nhl_pbp.current_pass(conn, Pacer(0), now=NOW, log=lambda *_: None, fetch=_fetch(calls))
    assert again == {"skipped": "no new finished games"}
    assert len(calls) == n_calls
    assert conn.execute("SELECT espn_event_id FROM nhl_games").fetchone()[0] == 77
    assert conn.execute("SELECT COUNT(*) FROM nhl_shots").fetchone()[0] == 8


def test_check_line_is_absent_without_recent_games():
    conn = _db()
    assert nhl_pbp.shot_freshness(conn, NOW) is None
    res = check.check(conn, NOW, daily_status="/nonexistent")
    assert all(src != "nhl_pbp" for src, _, _ in res)
    home, away = _team(conn, 6, "BOS"), _team(conn, 8, "MTL")
    _final(conn, 77, home, away, "2026-11-21")
    _final(conn, 79, home, away, "2026-11-21", status="STATUS_POSTPONED")
    assert nhl_pbp.shot_freshness(conn, NOW)[0] == "FAIL"
    nhl_pbp.store_game(conn, PBP, BOX, at="t1", espn_event_id=77)
    level, msg = nhl_pbp.shot_freshness(conn, NOW)
    assert level == "OK" and msg.startswith("1 ")
    res = {src: lvl for src, lvl, _ in check.check(conn, NOW, daily_status="/nonexistent")}
    assert res["nhl_pbp"] == "OK"


def test_load_attaches_and_is_idempotent():
    with tempfile.TemporaryDirectory() as d:
        src_path, dst_path = Path(d) / "shots.db", Path(d) / "main.db"
        src, dst = db.connect(src_path), db.connect(dst_path)
        src.isolation_level = dst.isolation_level = None
        db.init_db(src)
        db.init_db(dst)
        assert nhl_pbp.store_game(src, PBP, BOX, at="t1") == 8
        nhl_pbp.refit(src, at="t1", log=lambda *_: None)  # too few shots: leaves the model unset
        # a stored model still has to copy; plant one row
        src.execute("INSERT INTO nhl_xg_model (fit_at, n_shots, n_goals, features, coef, "
                    "intercept, notes) VALUES ('t1', 10, 2, ?, ?, 0.1, 'n')",
                    (json.dumps(list(nhl_pbp.FEATURES)), json.dumps([0.1] * len(nhl_pbp.FEATURES))))
        home, away = _team(dst, 6, "BOS"), _team(dst, 8, "MTL")
        _final(dst, 77, home, away, "2026-11-21")
        first = nhl_pbp.load_into(dst, src_path)
        assert first["nhl_shots"] == 8 and first["linked"] == 1
        assert dst.execute("SELECT espn_event_id FROM nhl_games").fetchone()[0] == 77
        assert dst.execute("SELECT COUNT(*) FROM nhl_xg_model").fetchone()[0] == 1
        assert dst.execute("SELECT COUNT(*) FROM src_meta WHERE key LIKE 'nhl_pbp:%'").fetchone()[0] == 1
        second = nhl_pbp.load_into(dst, src_path)
        assert second["nhl_shots"] == 8
        assert dst.execute("SELECT COUNT(*) FROM nhl_shots").fetchone()[0] == 8
        assert dst.execute("SELECT COUNT(*) FROM nhl_player_xg").fetchone()[0] == \
            src.execute("SELECT COUNT(*) FROM nhl_player_xg").fetchone()[0]
        src.close()
        dst.close()


def test_refit_writes_coefficients_and_gsax():
    conn = _db()
    gid = 7
    conn.execute("INSERT INTO nhl_games (nhl_game_id, season, game_type, game_date, "
                 "home_nhl_id, away_nhl_id, home_abbrev, away_abbrev, content_hash, "
                 "fetched_at, n_shots) VALUES (7, 2025, 2, '2026-11-21', 6, 8, 'BOS', 'MTL', "
                 "'h', 't', 120)")
    rows = []
    for i in range(80):
        rows.append((gid, i, "REG", "goal" if i < 60 else "miss", 12.0, 8.0, 101, 201, 6, 1))
    for i in range(80):
        rows.append((gid, 100 + i, "REG", "goal" if i < 8 else "shot", 55.0, 40.0, 102, 201, 6, 1))
    conn.executemany(
        "INSERT INTO nhl_shots (nhl_game_id, event_id, period_type, result, distance, angle, "
        "shot_type, strength, rebound, rush, shooter_id, goalie_id, team_nhl_id, is_home) "
        "VALUES (?, ?, ?, ?, ?, ?, 'wrist', 'even', 0, 0, ?, ?, ?, ?)", rows)
    conn.execute("INSERT INTO nhl_player_xg (nhl_game_id, player_id, role, toi_sec, shots, goals) "
                 "VALUES (7, 201, 'goalie', 3600, 0, 0)")
    st = nhl_pbp.refit(conn, at="t1", log=lambda *_: None)
    assert st["n_shots"] == 160 and st["n_goals"] == 68
    row = conn.execute("SELECT n_shots, n_goals, features FROM nhl_xg_model").fetchone()
    assert row["n_shots"] == 160 and json.loads(row["features"]) == list(nhl_pbp.FEATURES)
    gsax, goals, xg = conn.execute(
        "SELECT gsax, goals, xg FROM nhl_player_xg WHERE player_id = 201").fetchone()
    faced = conn.execute("SELECT COALESCE(SUM(xg), 0), SUM(result = 'goal') FROM nhl_shots "
                         "WHERE goalie_id = 201 AND result != 'block'").fetchone()
    assert goals == faced[1]
    assert abs(xg - faced[0]) < 1e-9
    assert abs(gsax - (faced[0] - faced[1])) < 1e-9
    # a second fit replaces the row instead of stacking another one
    assert nhl_pbp.refit(conn, at="t2", log=lambda *_: None)["n_shots"] == 160
    assert conn.execute("SELECT COUNT(*) FROM nhl_xg_model").fetchone()[0] == 1


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
