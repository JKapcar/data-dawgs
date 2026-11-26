"""Ingest write lock, race-safe venue load, and MLB placeholder rosters.

No network. Run: PYTHONPATH=. python3 -m pytest tests/test_ingest_lock.py -q
"""
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from bayesratings import db, prelog, travel
from bayesratings.sources import check, mlb


def _csv(path, rows):
    path.write_text(
        "name,city,region,lat,lon,tz,source,aliases\n" + "\n".join(rows) + "\n",
        encoding="utf-8")


def _open(path):
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def test_load_coords_upserts_and_drops_a_removed_building(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "LOCK_PATH", str(tmp_path / "write.lock"))
    conn = _open(tmp_path / "t.db")
    db.init_db(conn)
    first = tmp_path / "a.csv"
    _csv(first, [
        "Alpha Park,City,ST,40.0,-80.0,America/Chicago,test,The Alpha",
        "Beta Field,City,ST,41.0,-81.0,America/Chicago,test,",
    ])
    assert travel.load_coords(conn, first) == 2
    second = tmp_path / "b.csv"
    _csv(second, [
        "Alpha Park,City,ST,40.5,-80.0,America/Chicago,test,The Alpha",
    ])
    assert travel.load_coords(conn, second) == 1
    row = conn.execute("SELECT lat FROM venue_coords WHERE name = 'Alpha Park'").fetchone()
    assert row["lat"] == 40.5
    assert conn.execute("SELECT COUNT(*) FROM venue_coords").fetchone()[0] == 1
    assert conn.execute(
        "SELECT COUNT(*) FROM venue_aliases WHERE alias = 'Beta Field'").fetchone()[0] == 0
    db.init_db(conn)
    assert conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'view' AND name = 'game_venues'").fetchone()
    conn.close()


def test_load_coords_two_threads_keep_one_set(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "LOCK_PATH", str(tmp_path / "write.lock"))
    path = tmp_path / "t.db"
    conn = _open(path)
    db.init_db(conn)
    conn.close()
    csv = tmp_path / "v.csv"
    _csv(csv, [
        "Alpha Park,City,ST,40.0,-80.0,America/Chicago,test,The Alpha",
        "Beta Field,City,ST,41.0,-81.0,America/Chicago,test,",
    ])
    errors = []

    def worker():
        c = _open(path)
        try:
            travel.load_coords(c, csv)
        except Exception as exc:
            errors.append(exc)
        finally:
            c.close()

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    c = _open(path)
    assert c.execute("SELECT COUNT(*) FROM venue_coords").fetchone()[0] == 2
    assert c.execute("SELECT COUNT(*) FROM venue_aliases").fetchone()[0] == 3
    c.close()


def test_writer_lock_waits_and_reenters(tmp_path):
    path = str(tmp_path / "write.lock")
    started, release = threading.Event(), threading.Event()

    def hold():
        with db.writer_lock(path=path, timeout=None):
            started.set()
            assert release.wait(2)

    t = threading.Thread(target=hold)
    t.start()
    assert started.wait(2)
    with pytest.raises(TimeoutError):
        with db.writer_lock(path=path, timeout=0.15):
            pass
    release.set()
    t.join()
    with db.writer_lock(path=path, timeout=1):
        with db.writer_lock(path=path, timeout=0.1):
            assert Path(path).exists()


def _team(conn, espn_id, name):
    conn.execute(
        "INSERT INTO teams (league, espn_id, abbreviation, name) VALUES ('mlb', ?, ?, ?)",
        (espn_id, name[:3], name))
    return conn.execute(
        "SELECT team_id FROM teams WHERE league = 'mlb' AND espn_id = ?",
        (espn_id,)).fetchone()[0]


def _games(conn, home, away, eid0, day):
    for i in range(5):
        start = f"{day.isoformat()}T18:00Z"
        conn.execute(
            "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
            "game_date, home_team_id, away_team_id, completed, status) "
            "VALUES (?,?,2026,2,?,?,?,?,0,'STATUS_SCHEDULED')",
            (eid0 + i, "mlb", start, (day + timedelta(days=i - 2)).isoformat(), home, away))


def test_mlb_placeholder_rosters_are_skipped(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "LOCK_PATH", str(tmp_path / "write.lock"))
    conn = _open(tmp_path / "t.db")
    db.init_db(conn)
    tbd, combo, yanks = _team(conn, -1, "TBD"), _team(conn, 30, "Combo"), _team(conn, 14, "Yankees")
    day = date(2026, 10, 17)
    _games(conn, tbd, yanks, 100, day)
    _games(conn, combo, yanks, 200, day)
    conn.commit()

    fetched = []

    def pace(fn, *args, **kwargs):
        fetched.append(args[-1] if args else None)
        if args and str(args[-1]).lstrip("-").isdigit() and int(args[-1]) < 1:
            raise AssertionError(f"fetched placeholder {args[-1]}")
        return {"athletes": [{
            "id": "9", "displayName": "Ace", "position": {"abbreviation": "P"}}]}

    st = prelog.rosters_pass(conn, "mlb", pace, log=lambda *_: None, teams=[
        (-1, tbd), (-2, combo), (14, yanks)])
    assert st["errors"] == 0
    assert st["skipped_placeholder"] == 2
    assert -1 not in fetched and -2 not in fetched and 14 in fetched

    calls = []

    def fetch(path, **params):
        calls.append(path)
        if "roster" in path and path.split("/")[1].lstrip("-").isdigit() and int(path.split("/")[1]) < 1:
            raise AssertionError(path)
        if path == "teams":
            return {"teams": []}
        return {"roster": [{
            "person": {"id": 1, "fullName": "Ace"},
            "status": {"code": "A"}, "position": {"abbreviation": "P"}}]}

    monkeypatch.setattr(mlb, "team_map", lambda c, js, at=None: {-2: combo, 147: yanks})
    monkeypatch.setattr(mlb, "map_people", lambda *a, **k: {})
    st = mlb.roster_pass(conn, lambda fn, *a, **k: fn(*a, **k), log=lambda *_: None,
                         fetch_fn=fetch, today=day)
    assert st["errors"] == 0
    assert st["skipped_placeholder"] == 2
    roster_ids = [p.split("/")[1] for p in calls if p.startswith("teams/") and "roster" in p]
    assert roster_ids and set(roster_ids) == {"147"}
    conn.close()


def test_check_players_follow_430_and_skip_export(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "LOCK_PATH", str(tmp_path / "write.lock"))
    conn = _open(tmp_path / "t.db")
    db.init_db(conn)
    home, away = _team(conn, 14, "Yankees"), _team(conn, 15, "Red Sox")
    yesterday = "2026-11-24"
    conn.execute(
        "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
        "game_date, home_team_id, away_team_id, completed, status) "
        "VALUES (1,'mlb',2026,2,?,?,?,?,1,'STATUS_FINAL')",
        (yesterday + "T23:00Z", yesterday, home, away))
    conn.commit()
    # 14:00 UTC is 08:00 CT in November, after the 07:30 check.
    now = datetime(2026, 11, 25, 14, 0, tzinfo=timezone.utc)
    status = tmp_path / "daily.log"
    levels = lambda: {s: lvl for s, lvl, _ in check.check(conn, now, daily_status=str(status))}
    res = levels()
    assert "export" not in res and res["players"] == "FAIL"
    status.write_text("2026-11-25 04:40 CT OK snapshot=2026-11-25 espn +0g\n")
    assert levels()["players"] == "OK"
    status.write_text("no snapshot\n")
    conn.execute(
        "INSERT INTO player_extract_log (espn_event_id, league, summary_fetched_at, "
        "extracted_at, version, status, rows) VALUES (1,'mlb',?,? ,1,'ok',1)",
        (yesterday + "T23:00Z", "2026-11-25T10:29:00+00:00"))  # 04:29 CT
    conn.commit()
    assert levels()["players"] == "FAIL"
    conn.execute(
        "UPDATE player_extract_log SET extracted_at = ? WHERE espn_event_id = 1",
        ("2026-11-25T10:30:00+00:00",))  # 04:30 CT
    conn.commit()
    assert levels()["players"] == "OK" and "export" not in levels()
    conn.close()


def test_autocommit_build_state_is_atomic(tmp_path, monkeypatch):
    """isolation_level=None used to commit the DELETE before the INSERT."""
    monkeypatch.setattr(db, "LOCK_PATH", str(tmp_path / "write.lock"))
    conn = sqlite3.connect(tmp_path / "t.db", isolation_level=None)
    conn.row_factory = sqlite3.Row
    db.init_db(conn)
    conn.execute(
        "INSERT INTO nfl_qb_state (as_of_date, qb, state_json) VALUES (?,?,?)",
        ("2026-11-25", "old", "{}"))
    conn.execute(
        "INSERT INTO nfl_schedule (game_id, season, game_date, home_score, away_score) "
        "VALUES ('g1', 2026, '2026-11-20', 20, 17)")
    conn.execute(
        "INSERT INTO nfl_pbp_qb (game_id, season, game_date, team, qb, qb_epa, qb_n, "
        "cpoe_sum, cpoe_n) VALUES ('g1', 2026, '2026-11-20', 'H', 'qb1', 1.0, 10, 0.2, 10)")
    conn.execute(
        "CREATE TRIGGER nfl_qb_state_fail BEFORE INSERT ON nfl_qb_state "
        "BEGIN SELECT RAISE(ABORT, 'disk'); END")
    from bayesratings import nfl_player
    with pytest.raises(sqlite3.Error):
        nfl_player.build_state(conn, date(2026, 11, 26), log=lambda *_: None)
    left = conn.execute("SELECT qb FROM nfl_qb_state").fetchall()
    assert [r["qb"] for r in left] == ["old"]
    conn.close()


def test_nested_immediate_commits_once(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "LOCK_PATH", str(tmp_path / "write.lock"))
    conn = sqlite3.connect(tmp_path / "t.db", isolation_level=None)
    db.init_db(conn)
    sql = ("INSERT INTO scraper_runs (league, mode, started_at, status) "
           "VALUES (?,?,?,?)")
    with db.immediate(conn):
        conn.execute(sql, ("mlb", "outer", "t", "ok"))
        with db.immediate(conn):
            conn.execute(sql, ("mlb", "inner", "t", "ok"))
            assert conn.in_transaction
        assert conn.in_transaction
    modes = [r[0] for r in conn.execute(
        "SELECT mode FROM scraper_runs ORDER BY mode")]
    assert modes == ["inner", "outer"]
    with pytest.raises(sqlite3.OperationalError):
        with db.immediate(conn):
            conn.execute(sql, ("mlb", "rolled", "t", "ok"))
            with db.immediate(conn):
                conn.execute("INSERT INTO no_such_table (x) VALUES (1)")
    modes = [r[0] for r in conn.execute(
        "SELECT mode FROM scraper_runs ORDER BY mode")]
    assert modes == ["inner", "outer"]
    conn.close()


def test_lock_path_is_shared_and_not_under_tmp(monkeypatch):
    monkeypatch.delenv("BAYESRATINGS_LOCK", raising=False)
    monkeypatch.delenv("BAYESRATINGS_LOCK_DIR", raising=False)
    path = db.resolve_lock_path()
    assert path.endswith("write.lock")
    assert db.resolve_lock_path() == path
    assert not path.startswith("/tmp/")


def test_init_db_on_user_version_0_loads_coords(tmp_path, monkeypatch):
    """A migrate UPDATE must not still be open when venue rows are loaded."""
    monkeypatch.setattr(db, "LOCK_PATH", str(tmp_path / "write.lock"))
    conn = _open(tmp_path / "t.db")
    db.init_db(conn)
    home, away = _team(conn, 11, "Athletics"), _team(conn, 12, "Astros")
    # 05:30 UTC in November is 23:30 CT the day before.
    conn.execute(
        "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
        "game_date, home_team_id, away_team_id, completed, status) "
        "VALUES (9,'mlb',2026,2,?,?,?,?,1,'STATUS_FINAL')",
        ("2026-11-25T05:30:00Z", "2026-11-25", home, away))
    conn.execute("PRAGMA user_version = 0")
    conn.commit()
    db.init_db(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
    assert conn.execute("SELECT game_date FROM games WHERE espn_event_id = 9").fetchone()[0] == "2026-11-24"
    assert conn.execute("SELECT COUNT(*) FROM venue_coords").fetchone()[0] > 0
    conn.close()


def test_immediate_joins_an_open_begin(tmp_path, monkeypatch):
    """A plain BEGIN stays open. immediate takes the write lock and does not commit it."""
    lock = str(tmp_path / "write.lock")
    monkeypatch.setattr(db, "LOCK_PATH", lock)
    conn = sqlite3.connect(tmp_path / "t.db")
    db.init_db(conn)
    sql = ("INSERT INTO scraper_runs (league, mode, started_at, status) "
           "VALUES (?,?,?,?)")
    conn.execute("BEGIN")
    conn.execute(sql, ("mlb", "before", "t", "ok"))
    held = []

    def other():
        try:
            with db.writer_lock(path=lock, timeout=0.2):
                held.append("got")
        except TimeoutError:
            held.append("busy")

    with db.immediate(conn):
        conn.execute(sql, ("mlb", "inside", "t", "ok"))
        t = threading.Thread(target=other)
        t.start()
        t.join()
        assert held == ["busy"]
        assert conn.in_transaction
    assert conn.in_transaction
    other = sqlite3.connect(tmp_path / "t.db")
    assert other.execute("SELECT COUNT(*) FROM scraper_runs").fetchone()[0] == 0
    conn.commit()
    assert [r[0] for r in other.execute(
        "SELECT mode FROM scraper_runs ORDER BY mode")] == ["before", "inside"]
    conn.execute("BEGIN")
    conn.execute(sql, ("mlb", "kept", "t", "ok"))
    with pytest.raises(sqlite3.OperationalError):
        with db.immediate(conn):
            conn.execute("INSERT INTO no_such_table (x) VALUES (1)")
    assert conn.in_transaction
    assert [r[0] for r in conn.execute(
        "SELECT mode FROM scraper_runs ORDER BY mode")] == ["before", "inside", "kept"]
    conn.rollback()
    conn.close()
    other.close()


def test_lock_dir_follows_the_environment(tmp_path, monkeypatch):
    monkeypatch.delenv("BAYESRATINGS_LOCK", raising=False)
    monkeypatch.setattr(db, "_under_tmp", lambda _p: False)
    monkeypatch.setenv("BAYESRATINGS_LOCK_DIR", str(tmp_path / "locks"))
    assert db.resolve_lock_dir() == str(tmp_path / "locks")
    assert db.resolve_lock_path() == str(tmp_path / "locks" / "write.lock")


def test_shell_scripts_use_a_local_lock_dir():
    root = Path(__file__).resolve().parents[1]
    for name in ("run_daily.sh", "run_refresh.sh", "run_prelog.sh"):
        text = (root / "scripts" / name).read_text()
        assert "BAYESRATINGS_LOCK_DIR" in text
        assert ".env" in text
