"""Historical injury reports: parse, resume, load, and the training fallback.

No network. The NFL file is two rows in the test.
Run: PYTHONPATH=. python tests/test_injhist.py
"""
import importlib.util
import re
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd

from bayesratings import db as brdb
from bayesratings.backfill import Pacer
from bayesratings.injstatus import pregame_qb, training_available
from bayesratings.nba_player import load_training_status, team_table
from bayesratings.nfl_player import apply_pregame_qbs
from bayesratings.sources import common, injhist, nbainj

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "tests" / "fixtures" / "sources"
NFL_CSV = (
    "season,game_type,team,week,gsis_id,position,full_name,report_primary_injury,"
    "report_secondary_injury,report_status,practice_primary_injury,"
    "practice_secondary_injury,practice_status,date_modified\n"
    "2020,REG,DEN,1,00-0033869,CB,Pat Surtain,Hamstring,,Out,,,\n"
    "2020,REG,DEN,1,00-0027974,QB,Drew Lock,,,Questionable,,,\n"
).encode()


def _db():
    c = sqlite3.connect(":memory:", isolation_level=None)
    c.row_factory = sqlite3.Row
    c.executescript((ROOT / "bayesratings" / "schema.sql").read_text())
    return c


class FakeWeb:
    def __init__(self, pages, robots="User-agent: *\nAllow: /\n"):
        self.pages, self.robots, self.calls = pages, robots, []

    def __call__(self, url, accept="*/*", **k):
        self.calls.append(url)
        if url.endswith("/robots.txt"):
            if self.robots is None:
                raise common.Missing(url)
            return self.robots.encode()
        for pat, body in self.pages.items():
            if re.search(pat, url):
                if isinstance(body, Exception):
                    raise body
                return body
        raise common.Missing(url)


def _pdf_calls(web):
    return [u for u in web.calls if u.endswith(".pdf")]


def _csv_calls(web):
    return [u for u in web.calls if u.endswith(".csv")]


def test_status_words():
    assert training_available(None, True) is True
    assert training_available(None, False) is False
    assert training_available("Out", True) is False
    assert training_available("doubtful", True) is False
    assert training_available("Questionable", False) is True
    assert training_available("probable", False) is True
    assert training_available("Available", False) is True
    assert training_available("not yet submitted", True) is True
    assert training_available("n/a", False) is False
    assert pregame_qb("B", "A", None) == "B"
    assert pregame_qb("B", "A", lambda g: "out" if g == "B" else None) == "A"
    assert pregame_qb("B", "A", lambda g: "out") == "B"
    assert pregame_qb("B", "A", lambda g: "questionable" if g == "B" else None) == "B"


def test_nfl_file_resume_and_unchanged_current_season():
    c = _db()
    web = FakeWeb({r"injuries_2020\.csv$": NFL_CSV})
    today = date(2026, 11, 22)
    st = injhist.pull_nfl_season(c, Pacer(0), 2020, web, today, link=False)
    assert st["injury_rows"] == 2 and st["errors"] == 0
    surtain = c.execute(
        "SELECT report_status, team_id FROM nfl_injury_report_states WHERE gsis_id = '00-0033869'"
    ).fetchone()
    assert surtain["report_status"] == "Out" and surtain["team_id"] is None
    csvs = len(_csv_calls(web))
    again = injhist.pull_nfl_season(c, Pacer(0), 2020, web, today, link=False)
    assert again["skipped"] == "stored" and len(_csv_calls(web)) == csvs
    assert injhist.pull_nfl_season(c, Pacer(0), 2008, web, today, link=False)["skipped"]
    empty = FakeWeb({r"injuries_2019\.csv$": b"season,week,gsis_id,team\n"})
    bad = injhist.pull_nfl_season(c, Pacer(0), 2019, empty, today, link=False)
    assert bad["errors"] == 1 and injhist._meta(c, injhist._nfl_marker(2019)) is None
    cur = FakeWeb({r"injuries_2026\.csv$": NFL_CSV.replace(b"2020", b"2026")})
    first = injhist.pull_nfl_season(c, Pacer(0), 2026, cur, today, link=False)
    assert first["injury_rows"] == 2
    n0 = c.execute("SELECT COUNT(*) FROM nfl_injury_report_states WHERE season = 2026").fetchone()[0]
    c.execute("UPDATE src_meta SET updated_at = ? WHERE key = ?",
              ("2026-04-01T00:00:00+00:00", injhist._nfl_marker(2026)))
    seen = injhist._meta(c, injhist._nfl_marker(2026))[1]
    second = injhist.pull_nfl_season(c, Pacer(0), 2026, cur, today, link=False)
    assert second["unchanged"] == 1
    assert c.execute("SELECT COUNT(*) FROM nfl_injury_report_states WHERE season = 2026").fetchone()[0] == n0
    assert injhist._meta(c, injhist._nfl_marker(2026))[1] != seen


def test_nightly_skips_when_nothing_is_due():
    c = _db()
    web = FakeWeb({})
    injhist._put_meta(c, injhist._nfl_marker(2026), "have", "2026-04-10T00:00:00+00:00")
    now = datetime(2026, 4, 10, 18, tzinfo=timezone.utc)
    st = injhist.current_pass(c, Pacer(0), now, fetch=web)
    assert st["skipped"] == "nothing to fetch" and web.calls == []


def test_robots_disallow_is_not_stored_as_a_miss():
    c = _db()
    web = FakeWeb({}, robots="User-agent: *\nDisallow: /\n")
    try:
        injhist.pull_nba_day(c, Pacer(0), date(2026, 4, 10), web, link=False)
        raise AssertionError("robots disallow should raise")
    except RuntimeError:
        pass
    assert c.execute("SELECT COUNT(*) FROM nba_injury_reports").fetchone()[0] == 0
    assert injhist._meta(c, injhist.NBA_MISS + "2026-04-10") is None


def test_training_pool_uses_the_report_and_falls_back():
    prior = {"pts": 0.2}
    rows = [
        dict(espn_event_id=1, team_id=10, date="2026-04-10", athlete_id=1, minutes=30,
             exp_min=28, prior_min=400, pts_L=0.5, pts_S=0.4, ts_L=0.55, gmsc_L=15),
        dict(espn_event_id=1, team_id=10, date="2026-04-10", athlete_id=2, minutes=0,
             exp_min=20, prior_min=400, pts_L=0.3, pts_S=0.3, ts_L=0.50, gmsc_L=8),
    ]
    P = pd.DataFrame(rows)
    played = team_table(P, prior)
    assert played.loc[0, "B_n_players"] == 1 and abs(played.loc[0, "B_pts_L"] - 2.5) < 1e-9
    known = team_table(P, prior, {(1, 10): {1: "out", 2: "questionable"}})
    assert known.loc[0, "B_n_players"] == 1 and abs(known.loc[0, "B_pts_L"] - 1.5) < 1e-9
    both_out = team_table(P, prior, {(1, 10): {1: "doubtful", 2: "out"}})
    assert "B_n_players" not in both_out.columns or pd.isna(both_out.loc[0].get("B_n_players", float("nan")))


def test_training_status_drops_a_report_at_or_after_tip():
    c = _db()
    c.execute("INSERT INTO teams (league, espn_id, abbreviation, name) VALUES ('nba', 5, 'CLE', 'Cleveland')")
    tid = c.execute("SELECT team_id FROM teams").fetchone()[0]
    opp = c.execute(
        "INSERT INTO teams (league, espn_id, abbreviation, name) VALUES ('nba', 1, 'ATL', 'Atlanta')"
    ).lastrowid
    c.execute(
        "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, game_date, "
        "home_team_id, away_team_id, completed, status) VALUES "
        "(7, 'nba', 2026, 2, '2026-04-10T23:00:00Z', '2026-04-10', ?, ?, 1, 'STATUS_FINAL')",
        (tid, opp))
    def add(aid, status, vf, key="Allen, Jarrett"):
        c.execute(
            "INSERT INTO nba_injury_states (league, game_date, team_name, player_key, team_id, "
            "athlete_id, espn_event_id, status, state_hash, valid_from, last_seen) VALUES "
            "('nba', '2026-04-10', 'Cleveland', ?, ?, ?, 7, ?, 'h', ?, ?)",
            (key, tid, aid, status, vf, vf))
    add(1, "Out", "2026-04-10T12:00:00+00:00")
    add(1, "Questionable", "2026-04-10T18:00:00+00:00")
    add(1, "Out", "2026-04-10T23:00:00+00:00")
    add(2, "Out", "2026-04-10T23:30:00Z")
    add(3, "NOT YET SUBMITTED", "2026-04-10T12:00:00+00:00", "(NOT YET SUBMITTED)")
    games = pd.read_sql_query(
        "SELECT espn_event_id, league, game_date, start_time_utc, home_team_id, away_team_id FROM games", c)
    got = load_training_status(c, games)
    assert got[(7, tid)] == {1: "questionable"}


def test_pregame_qb_swap_uses_the_previous_game():
    sched = pd.DataFrame([
        dict(game_id="g1", season=2020, week=1, game_type="REG", date="2020-09-14",
             home_franchise="DEN", away_franchise="KC", home_qb="A", away_qb="Z"),
        dict(game_id="g2", season=2020, week=2, game_type="REG", date="2020-09-20",
             home_franchise="KC", away_franchise="DEN", home_qb="Z", away_qb="B"),
    ])
    same = apply_pregame_qbs(sched, {"exact": {}, "loose": {}})
    assert list(same["away_qb"]) == ["Z", "B"]
    index = {"exact": {(2020, 2, "REG", "DEN", "B"): "out"}, "loose": {}}
    swapped = apply_pregame_qbs(sched, index)
    assert list(swapped["away_qb"]) == ["Z", "A"]
    assert list(swapped["home_qb"]) == ["A", "Z"]
    both = {"exact": {(2020, 2, "REG", "DEN", "B"): "out",
                      (2020, 2, "REG", "DEN", "A"): "doubtful"}, "loose": {}}
    kept = apply_pregame_qbs(sched, both)
    assert list(kept["away_qb"]) == ["Z", "B"]
    loose = {"exact": {}, "loose": {(2020, 2, "DEN", "B"): {"questionable"}}}
    assert list(apply_pregame_qbs(sched, loose)["away_qb"]) == ["Z", "B"]


def test_freshness_lines():
    c = _db()
    now = datetime(2026, 4, 11, 18, tzinfo=timezone.utc)
    assert injhist.freshness(c, now) == []
    ids = []
    for lg, espn_id, abbr in (("nba", 1, "ATL"), ("nba", 2, "BOS"), ("nfl", 3, "KC"), ("nfl", 4, "DEN")):
        ids.append(c.execute(
            "INSERT INTO teams (league, espn_id, abbreviation, name) VALUES (?,?,?,?)",
            (lg, espn_id, abbr, abbr)).lastrowid)
    c.execute(
        "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, game_date, "
        "home_team_id, away_team_id, completed, status) VALUES "
        "(1, 'nba', 2026, 2, '2026-04-10T23:00:00Z', '2026-04-10', ?, ?, 1, 'STATUS_FINAL'),"
        "(2, 'nfl', 2025, 2, '2026-04-10T17:00:00Z', '2026-04-10', ?, ?, 1, 'STATUS_FINAL')",
        (ids[0], ids[1], ids[2], ids[3]))
    bad = {k: lvl for k, lvl, _m in injhist.freshness(c, now)}
    assert bad["inj_hist_nba"] == "FAIL" and bad["inj_hist_nfl"] == "FAIL"
    c.execute(
        "INSERT INTO nba_injury_reports (report_slot, url, fetched_at, backfill) "
        "VALUES ('2026-04-10 12:00', 'u', 't', 1)")
    injhist._put_meta(c, injhist._nfl_marker(2025), "abc", "2026-04-11T12:00:00+00:00")
    good = {k: lvl for k, lvl, _m in injhist.freshness(c, now)}
    assert good["inj_hist_nba"] == "OK" and good["inj_hist_nfl"] == "OK"


def test_script_argv_maps_onto_the_module():
    def load(name):
        spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    back = load("backfill_injuries")
    got = back._argv(["--out", "injuries_2024.db", "--from-season", "2024", "--to-season", "2024",
                      "--rate", "1"])
    assert got == ["--backfill", "--db", "injuries_2024.db", "--from-season", "2024",
                   "--to-season", "2024", "--rate", "1"]
    loader = load("load_injuries")
    assert loader._argv(["--db", "data/bayesratings.db", "--from", "injuries_2024.db"]) == [
        "--db", "data/bayesratings.db", "--load", "injuries_2024.db"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
