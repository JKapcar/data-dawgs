"""Schedule reconciliation: games ESPN stops listing (an "if necessary"
playoff game after a clinch), postponed/canceled games, series fields, and
the single Central clock for game_date.
Run: PYTHONPATH=. python tests/test_schedule_reconcile.py"""
import sqlite3
from datetime import date
from pathlib import Path

from bayesratings import backfill, daily, db, espn

SCHEMA = Path(__file__).resolve().parents[1] / "bayesratings" / "schema.sql"
TODAY = date(2026, 10, 16)


def _event(eid, when, home=8, away=19, state="STATUS_SCHEDULED", done=False,
           note="NLCS - Game 5 If Necessary", summary="MIL leads series 3-0",
           series_done=False):
    side = lambda tid, ha: {"homeAway": ha, "score": "3" if done else "0",
                            "team": {"id": str(tid), "abbreviation": f"T{tid}",
                                     "displayName": f"Team {tid}"}}
    return {"id": str(eid), "date": when, "name": "x", "shortName": "x",
            "season": {"year": 2026, "type": 3},
            "competitions": [{
                "status": {"type": {"name": state, "completed": done}},
                "competitors": [side(home, "home"), side(away, "away")],
                "notes": [{"type": "event", "headline": note}] if note else [],
                "series": {"summary": summary, "completed": series_done},
                "venue": {"fullName": "Park"}}]}


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(SCHEMA.read_text())
    for t in (8, 19, 5, 30):
        c.execute("INSERT INTO teams (team_id, league, espn_id, name, abbreviation) "
                  "VALUES (?,?,?,?,?)", (t, "mlb", t, f"Team {t}", f"T{t}"))
    for i in range(6):      # enough games that no team counts as an exhibition squad
        for h, a in ((8, 19), (5, 30)):
            c.execute("INSERT INTO games (espn_event_id, league, season, season_type, "
                      "start_time_utc, game_date, home_team_id, away_team_id, home_score, "
                      "away_score, completed, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                      (900 + i * 2 + (h == 5), "mlb", 2026, 2, f"2026-09-0{i + 1}T23:00Z",
                       f"2026-09-0{i + 1}", h, a, 3, 2, 1, "STATUS_FINAL"))
    return c


def _ingest(c, events):
    db.ingest_scoreboard(c, "mlb", espn.parse_scoreboard({"events": events}, "mlb"))


def _forecast(c, eid, snap, gd, early=True):
    tables = [("forecast_snapshots", ", backfilled")] + ([("upcoming_forecasts", "")] if early else [])
    for t, extra in tables:
        cols = ("snapshot_date, league, espn_event_id, game_date, home_team_id, "
                "away_team_id, home_prob, away_prob, home_spread, total_pred, "
                "home_total_pred, away_total_pred" + extra)
        vals = [snap, "mlb", eid, gd, 8, 19, .5, .5, 0, 8, 4, 4] + ([0] if extra else [])
        c.execute(f"INSERT INTO {t} ({cols}) VALUES ({','.join('?' * len(vals))})", vals)


def test_parse_series_fields():
    g = espn.parse_scoreboard({"events": [_event(1, "2026-10-17T01:00Z")]}, "mlb")["games"][0]
    assert g["if_necessary"] and g["notes"] == "NLCS - Game 5 If Necessary"
    assert g["series_summary"] == "MIL leads series 3-0" and not g["series_completed"]
    g = espn.parse_scoreboard({"events": [_event(2, "2026-10-16T00:00Z", note="NLCS - Game 4",
                                                series_done=True)]}, "mlb")["games"][0]
    assert not g["if_necessary"] and g["series_completed"]


def test_central_game_date():
    # 8pm CT Friday is Saturday in UTC; 11:30pm CT is Saturday in Eastern
    assert espn.central_date("2026-10-17T01:00Z") == "2026-10-16"
    assert espn.central_date("2026-10-17T04:30Z") == "2026-10-16"
    assert espn.eastern_date("2026-10-17T04:30Z") == "2026-10-17"
    g = espn.parse_scoreboard({"events": [_event(1, "2026-10-17T04:30Z")]}, "mlb")["games"][0]
    assert g["game_date"] == "2026-10-16"


def test_migration_moves_eastern_dates_to_central():
    c = _db()
    _ingest(c, [_event(1, "2026-10-17T04:30Z"), _event(2, "2026-10-17T01:00Z")])
    c.execute("UPDATE games SET game_date='2026-10-17' WHERE espn_event_id=1")  # old ET value
    assert db._central_game_dates(c) == 1
    assert c.execute("SELECT game_date FROM games WHERE espn_event_id=1").fetchone()[0] == "2026-10-16"
    assert db._central_game_dates(c) == 0


def test_removed_game_drops_off_and_comes_back():
    c = _db()
    _ingest(c, [_event(401908026, "2026-10-17T00:00Z", home=5, away=30, note="ALCS - Game 4"),
                _event(401908034, "2026-10-17T01:00Z")])
    _forecast(c, 401908034, "2026-10-16", "2026-10-16")
    _forecast(c, 401908034, "2026-10-15", "2026-10-16", early=False)   # an older graded-day row stays
    data = {"leagues": [{}], "events": [_event(401908026, "2026-10-17T00:00Z", home=5, away=30, note="ALCS - Game 4")]}
    gone = backfill.reconcile_date(c, "mlb", TODAY, data, TODAY)
    assert gone == [401908034]
    st = c.execute("SELECT status FROM games WHERE espn_event_id=401908034").fetchone()[0]
    assert st == db.REMOVED                      # kept, never deleted
    assert c.execute("SELECT COUNT(*) FROM upcoming_forecasts").fetchone()[0] == 0
    assert [tuple(r) for r in c.execute(
        "SELECT snapshot_date FROM forecast_snapshots")] == [("2026-10-15",)]
    assert list(daily.todays_schedule(c, "mlb", TODAY)["espn_event_id"]) == [401908026]
    # ESPN lists it again -> upsert restores the real status
    _ingest(c, [_event(401908034, "2026-10-17T01:00Z")])
    assert c.execute("SELECT status FROM games WHERE espn_event_id=401908034").fetchone()[0] \
        == "STATUS_SCHEDULED"


def test_malformed_payload_never_wipes_a_slate():
    c = _db()
    _ingest(c, [_event(1, "2026-10-17T01:00Z")])
    for bad in ({}, {"events": []}, {"leagues": []}, None,
                {"leagues": [], "events": [{"no": "id"}]}):
        assert backfill.reconcile_date(c, "mlb", TODAY, bad, TODAY) == []
    assert c.execute("SELECT status FROM games WHERE espn_event_id=1").fetchone()[0] == "STATUS_SCHEDULED"


def test_empty_well_formed_day_is_reconciled():
    # NLCS Game 6 (Oct 18) after a 4-0 sweep: ESPN's day is simply empty
    c = _db()
    _ingest(c, [_event(1, "2026-10-19T00:00Z"), _event(2, "2026-10-18T00:00Z", home=5, away=30)])
    gone = backfill.reconcile_date(c, "mlb", date(2026, 10, 18), {"leagues": [{}], "events": []}, TODAY)
    assert gone == [1]                            # the Oct 17 ET game is a different bucket


def test_clinched_if_necessary_hidden():
    c = _db()
    _ingest(c, [_event(10, "2026-10-16T00:00Z", state="STATUS_FINAL", done=True,
                       note="NLCS - Game 4", summary="MIL wins series 4-0", series_done=True),
                _event(11, "2026-10-17T01:00Z"),                       # Game 5 still listed
                _event(12, "2026-10-17T00:00Z", home=5, away=30, note="ALCS - Game 6 If Necessary",
                       summary="CLE leads series 2-1")])
    assert db.mark_clinched(c, "mlb", TODAY.isoformat()) == [11]
    assert c.execute("SELECT status FROM games WHERE espn_event_id=12").fetchone()[0] \
        == "STATUS_SCHEDULED"                   # open series: still shown, labeled


def test_hidden_games_drop_off_the_slate():
    c = _db()
    _ingest(c, [_event(20, "2026-10-17T01:00Z", state="STATUS_POSTPONED", note=None),
                _event(21, "2026-10-18T01:00Z", note="NLCS - Game 6 If Necessary"),
                _event(22, "2026-10-19T01:00Z", state="STATUS_CANCELED", note=None)])
    assert list(daily.todays_schedule(c, "mlb", TODAY, date(2026, 10, 20))["espn_event_id"]) == [21]
    for eid, gd in ((20, "2026-10-16"), (21, "2026-10-17"), (22, "2026-10-18")):
        _forecast(c, eid, "2026-10-16", gd)
    assert db.drop_hidden_forecasts(c, TODAY.isoformat()) == 2
    assert {r[0] for r in c.execute("SELECT espn_event_id FROM upcoming_forecasts")} == {21}


def test_placeholder_team_replaced_on_unplayed_game_only():
    # World Series listed as MIL vs a "TBD" team until the ALCS ends
    c = _db()
    _ingest(c, [_event(30, "2026-10-24T00:00Z", home=8, away=5, note="World Series - Game 1"),
                _event(31, "2026-09-10T00:00Z", home=8, away=5, state="STATUS_FINAL",
                       done=True, note=None)])
    _ingest(c, [_event(30, "2026-10-24T00:00Z", home=8, away=30, note="World Series - Game 1"),
                _event(31, "2026-09-10T00:00Z", home=8, away=30, state="STATUS_FINAL",
                       done=True, note=None)])
    teams = {r[0]: r[1] for r in c.execute(
        "SELECT g.espn_event_id, t.espn_id FROM games g JOIN teams t "
        "ON t.team_id = g.away_team_id WHERE g.espn_event_id IN (30, 31)")}
    assert teams == {30: 30, 31: 5}     # unplayed game updated; final kept


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
