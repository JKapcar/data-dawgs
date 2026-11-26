"""The daily run forecasts games after today into upcoming_forecasts.
Only game-day forecasts reach forecast_snapshots.
"""
import sqlite3
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from bayesratings import daily

SCHEMA = Path(__file__).resolve().parents[1] / "bayesratings" / "schema.sql"
TODAY = date(2026, 10, 13)


class _Fit:
    def stan_variable(self, name):
        return np.random.default_rng(0).normal(size=(50, 2))


def _db():
    c = sqlite3.connect(":memory:")
    c.executescript(SCHEMA.read_text())
    for t in (1, 2):
        c.execute("INSERT INTO teams (team_id, league, espn_id, name, abbreviation) "
                  "VALUES (?,?,?,?,?)", (t, "nfl", t, f"Team {t}", f"T{t}"))
    games = [(100, "2026-10-12", 1), (101, "2026-10-13", 0), (102, "2026-10-15", 0),
             (103, "2026-10-18", 0), (104, "2026-11-30", 0)]
    for eid, d, done in games:
        c.execute("INSERT INTO games (espn_event_id, league, season, season_type, "
                  "start_time_utc, game_date, home_team_id, away_team_id, home_score, "
                  "away_score, completed) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                  (eid, "nfl", 2026, 2, d + "T23:00Z", d, 1, 2,
                   24 if done else None, 17 if done else None, done))
    return c


def _res(sched):
    n = len(sched)
    return {"rating_season": 2026, "home_adv": 0.1, "fit": _Fit(),
            "ratings": pd.Series([0.2, -0.2], index=[1, 2]),
            "forecast": pd.DataFrame({"home_prob": [0.6] * n, "away_prob": [0.4] * n,
                                      "home_spread": [-3.0] * n, "total_pred": [44.0] * n,
                                      "home_total_pred": [23.5] * n,
                                      "away_total_pred": [20.5] * n})}


def test_schedule_window_and_split():
    c = _db()
    sched = daily.todays_schedule(c, "nfl", TODAY, date(2026, 10, 27))
    assert list(sched["espn_event_id"]) == [101, 102, 103]       # not past, not too far
    assert list(daily.todays_schedule(c, "nfl", TODAY)["espn_event_id"]) == [101]
    n = daily.save_snapshot(c, TODAY.isoformat(), "nfl", _res(sched), sched, upcoming=True)
    assert n == 1
    assert [r[0] for r in c.execute("SELECT espn_event_id FROM forecast_snapshots")] == [101]
    assert sorted(r[0] for r in c.execute("SELECT espn_event_id FROM upcoming_forecasts")) == [102, 103]
    # the next run replaces the league's upcoming rows (a game moved away drops out)
    s2 = sched[sched["espn_event_id"] == 102]
    daily.save_snapshot(c, "2026-10-14", "nfl", _res(s2), s2, upcoming=True)
    assert [r[0] for r in c.execute("SELECT espn_event_id FROM upcoming_forecasts")] == [102]
    assert c.execute("SELECT COUNT(*) FROM forecast_snapshots").fetchone()[0] == 1
    return c


def test_replay_never_writes_upcoming():
    c = _db()
    sched = daily.todays_schedule(c, "nfl", TODAY, date(2026, 10, 27))
    n = daily.save_snapshot(c, TODAY.isoformat(), "nfl", _res(sched), sched, backfilled=1)
    assert n == 3   # replay path unchanged: every row it is given, nothing upcoming
    assert c.execute("SELECT COUNT(*) FROM upcoming_forecasts").fetchone()[0] == 0


def test_update_espn_window(monkeypatch=None):
    calls = []
    orig = daily.backfill.run
    daily.backfill.run = lambda conn, lgs, n, rate, today, only_dates: (
        calls.append((lgs[0], only_dates)) or {"games": 1, "dates": len(only_dates)})
    try:
        st = daily.update_espn(None, ["nfl", "nhl"], TODAY, 1.0)
    finally:
        daily.backfill.run = orig
    span = {lg: (ds[0], ds[-1]) for lg, ds in calls}
    assert span["nfl"] == (date(2026, 10, 12), date(2026, 10, 28))
    assert span["nhl"] == (date(2026, 10, 12), date(2026, 10, 21))
    assert st["games"] == 2 and st["errors"] == 0


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
