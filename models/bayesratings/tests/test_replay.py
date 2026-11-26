"""Walk-forward replay: rows are marked rebuilt, live rows are never touched,
and a day's forecast only depends on games before that day.
Needs CmdStan (skipped without it). Run: PYTHONPATH=. python tests/test_replay.py"""
import random
import shutil
import sqlite3
import tempfile
from datetime import date, timedelta
from pathlib import Path

from bayesratings import db, replay

TEAMS = list(range(1, 7))


def _make_db(path, flip_after=None):
    conn = db.connect(path)
    db.init_db(conn)
    for t in TEAMS:
        conn.execute("INSERT INTO teams (team_id, league, espn_id, name) VALUES "
                     "(?, 'nhl', ?, ?)", (t, t, f"T{t}"))
    rnd = random.Random(7)
    eid = 0
    d0 = date(2025, 10, 1)
    for k in range(30):
        d = (d0 + timedelta(days=k)).isoformat()
        order = TEAMS[:]
        rnd.shuffle(order)
        for i in range(0, 6, 2):
            eid += 1
            h, a = order[i], order[i + 1]
            hs, as_ = rnd.randint(0, 6), rnd.randint(0, 6)
            if hs == as_:
                hs += 1
            if flip_after and d > flip_after:      # change only LATER results
                hs, as_ = as_, hs
            conn.execute(
                "INSERT INTO games (espn_event_id, league, season, season_type, "
                "start_time_utc, game_date, home_team_id, away_team_id, home_score, "
                "away_score, completed) VALUES (?, 'nhl', 2026, 2, ?, ?, ?, ?, ?, ?, 1)",
                (eid, d + "T23:00Z", d, h, a, hs, as_))
    conn.commit()
    return conn


def _forecasts(conn, d):
    return [tuple(round(x, 6) for x in tuple(r)) for r in conn.execute(
        "SELECT espn_event_id, home_prob, home_spread FROM forecast_snapshots "
        "WHERE snapshot_date=? ORDER BY espn_event_id", (d,))]


def run():
    if shutil.which("make") is None:
        print("SKIP: no build tools for CmdStan")
        return
    from bayesratings.ratings import get_bt_model
    model = get_bt_model()
    tmp = Path(tempfile.mkdtemp())
    a = _make_db(tmp / "a.db")
    b = _make_db(tmp / "b.db", flip_after="2025-10-20")
    # a live row on one day must survive
    a.execute("INSERT INTO rating_snapshots (snapshot_date, league, season, team_id, "
              "rating, backfilled) VALUES ('2025-10-15', 'nhl', 2026, 1, 9.9, 0)")
    a.commit()
    for conn in (a, b):
        replay.replay_league(conn, "nhl", 1, "2025-10-22", model)
    assert [tuple(r) for r in a.execute("SELECT rating FROM rating_snapshots WHERE snapshot_date="
                     "'2025-10-15'").fetchall()] == [(9.9,)], "live row changed"
    n = a.execute("SELECT COUNT(*) FROM forecast_snapshots WHERE backfilled=1").fetchone()[0]
    assert n > 0 and a.execute("SELECT COUNT(*) FROM forecast_snapshots "
                               "WHERE backfilled=0").fetchone()[0] == 0
    # 2025-10-20's forecasts must not see results from after 2025-10-20
    fa, fb = _forecasts(a, "2025-10-20"), _forecasts(b, "2025-10-20")
    assert fa and fa == fb, "forecast used later games"
    print("ok replay", n, "rebuilt forecasts")


def test_replay():
    run()


if __name__ == "__main__":
    run()
