"""Weekly refits, the daily-job lock, and the daily fit cutoff (NFL included).
Needs CmdStan for the replay part (skipped without it).
Run: PYTHONPATH=. python tests/test_replay_weekly.py"""
import fcntl
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from bayesratings import daily, replay
from test_replay import _make_db


def check_dates():
    assert replay.week_anchor("2025-10-14") == "2025-10-14"   # Tuesday
    assert replay.week_anchor("2025-10-20") == "2025-10-14"   # Monday
    assert replay.week_anchor("2025-10-15") == "2025-10-14"
    # every league, NFL included, refits daily on games before today
    assert "nfl" not in daily.WEEKLY_REFIT
    for lg in ("mlb", "nba", "nfl", "nhl"):
        assert daily.fit_cutoff(lg, date(2026, 10, 18)) == date(2026, 10, 18)
        assert daily.fit_cutoff(lg, date(2026, 10, 19)) == date(2026, 10, 19)
    # the weekly mechanism still works for a league placed in WEEKLY_REFIT
    daily.WEEKLY_REFIT.add("zz")
    try:
        assert daily.fit_cutoff("zz", date(2026, 10, 18)) == date(2026, 10, 13)
        assert daily.fit_cutoff("zz", date(2026, 10, 13)) == date(2026, 10, 13)
    finally:
        daily.WEEKLY_REFIT.discard("zz")
    print("ok week anchor and daily cutoff for every league")


def check_lock():
    path = Path(tempfile.mkdtemp()) / "x.lock"
    holder = subprocess.Popen(["flock", str(path), "sleep", "1.5"])
    time.sleep(0.4)
    t = time.monotonic()
    with replay.db_lock(str(path)):
        waited = time.monotonic() - t
    holder.wait()
    assert waited > 0.7, f"did not wait for the lock ({waited:.2f}s)"
    with replay.db_lock(""):   # disabled
        pass
    print(f"ok replay waits for the daily lock ({waited:.1f}s)")


def check_weekly():
    if shutil.which("make") is None:
        print("SKIP: no build tools for CmdStan")
        return
    from bayesratings.ratings import get_bt_model
    model = get_bt_model()
    tmp = Path(tempfile.mkdtemp())
    a = _make_db(tmp / "a.db")
    b = _make_db(tmp / "b.db", flip_after="2025-10-16")
    for conn in (a, b):
        replay.replay_league(conn, "nhl", 1, "2025-10-22", model, refit="weekly",
                             since="2025-10-14", lock_path="")
    rat = lambda c, d: [tuple(r) for r in c.execute(
        "SELECT team_id, rating FROM rating_snapshots WHERE snapshot_date=? "
        "ORDER BY team_id", (d,))]
    assert rat(a, "2025-10-15") and rat(a, "2025-10-15") == rat(a, "2025-10-20"), \
        "ratings moved inside a week"
    assert rat(a, "2025-10-21") != rat(a, "2025-10-20"), "no refit on Tuesday"
    assert a.execute("SELECT MIN(snapshot_date) FROM rating_snapshots").fetchone()[0] \
        == "2025-10-14", "--since ignored"
    # Monday 10-20 uses the 10-14 fit: later results (flipped in b) can't leak
    f = lambda c, d: [tuple(r) for r in c.execute(
        "SELECT espn_event_id, home_prob FROM forecast_snapshots WHERE snapshot_date=? "
        "ORDER BY 1", (d,))]
    assert f(a, "2025-10-20") and f(a, "2025-10-20") == f(b, "2025-10-20"), "leak"
    print("ok weekly replay")


def run():
    check_dates()
    check_lock()
    check_weekly()


def test_replay_weekly():
    run()


if __name__ == "__main__":
    run()
