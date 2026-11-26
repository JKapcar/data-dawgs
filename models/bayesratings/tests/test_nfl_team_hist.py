"""Walk-forward team chances for the NFL quarterback ridge.

The MAP is the fixed-sigma team model. A game day's chance uses
earlier games only, relocations share a franchise, and a second backfill
with the same schedule writes nothing.
Run: PYTHONPATH=. python -m pytest tests/test_nfl_team_hist.py
"""
import importlib.util
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

from bayesratings import db, nfl_team_hist as hist
from bayesratings.team_map import fit as map_fit

ROOT = Path(__file__).resolve().parents[1]


def _ref_fit():
    path = ROOT / "analysis" / "nfl_qb_calib" / "wf_map.py"
    spec = importlib.util.spec_from_file_location("wf_map_ref", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.fit


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    db.init_db(c)
    c.execute("PRAGMA foreign_keys = OFF")
    return c


def _ins(c, table, **kw):
    for _, name, typ, notnull, dflt, _pk in c.execute(f"PRAGMA table_info({table})"):
        if notnull and dflt is None and name not in kw:
            kw[name] = 0 if "INT" in (typ or "").upper() or "REAL" in (typ or "").upper() else "x"
    cols = ", ".join(kw)
    c.execute(f"INSERT INTO {table} ({cols}) VALUES ({', '.join('?' * len(kw))})", list(kw.values()))


def _frame(rows):
    df = pd.DataFrame(rows)
    df["home"] = df["home_franchise"]
    df["away"] = df["away_franchise"]
    df["neu"] = df.get("neu", 0)
    df["y"] = (df["home_score"] > df["away_score"]).astype(int)
    df["m"] = (df["home_score"] - df["away_score"]).astype(float)
    return df


def _p(rows, gid):
    out = {r[0]: r[3] for r in hist.replay(_frame(rows))}
    return out[gid]


def test_a_game_day_uses_only_earlier_games_and_skips_the_cutoff():
    rows = [
        dict(game_id="y06", season=2006, game_date="2006-09-10", home_franchise="KC",
             away_franchise="BUF", home_score=24, away_score=10, espn_event_id=1),
        dict(game_id="y07", season=2007, game_date="2007-09-09", home_franchise="DEN",
             away_franchise="MIA", home_score=20, away_score=17, espn_event_id=2),
        dict(game_id="late", season=2025, game_date="2025-09-04", home_franchise="KC",
             away_franchise="BUF", home_score=21, away_score=14, espn_event_id=3),
    ]
    out = {r[0]: r[3] for r in hist.replay(_frame(rows))}
    assert set(out) == {"y07"}
    blown = [dict(r) for r in rows]
    blown[1]["home_score"] = 3
    assert abs(_p(blown, "y07") - out["y07"]) < 1e-12
    earlier = [dict(r) for r in rows]
    earlier[0]["home_score"] = 0
    earlier[0]["away_score"] = 35
    assert abs(_p(earlier, "y07") - out["y07"]) > 0.02


def test_a_relocation_is_the_same_franchise():
    def one(oak_score, opp_score):
        c = _db()
        _ins(c, "nfl_schedule", game_id="old", season=2006, week=1, game_type="REG",
             game_date="2006-09-10", home_franchise="OAK", away_franchise="KC",
             home_score=oak_score, away_score=opp_score, espn_event_id=1)
        _ins(c, "nfl_schedule", game_id="now", season=2007, week=1, game_type="REG",
             game_date="2007-09-09", home_franchise="LV", away_franchise="BUF",
             home_score=17, away_score=14, espn_event_id=2)
        out = {r[0]: r[3] for r in hist.replay(hist.load_games(c))}
        return out["now"]

    assert one(40, 0) > one(0, 40) + 0.02


def test_backfill_is_idempotent_and_a_neutral_site_is_read():
    c = _db()
    _ins(c, "teams", team_id=1, league="nfl", espn_id=12, abbreviation="KC", name="Chiefs")
    _ins(c, "teams", team_id=2, league="nfl", espn_id=2, abbreviation="BUF", name="Bills")
    _ins(c, "nfl_schedule", game_id="y06", season=2006, week=1, game_type="REG",
         game_date="2006-09-10", home_franchise="KC", away_franchise="BUF",
         home_score=30, away_score=7, espn_event_id=10)
    _ins(c, "nfl_schedule", game_id="y07", season=2007, week=1, game_type="REG",
         game_date="2007-09-09", home_franchise="DEN", away_franchise="MIA",
         home_score=20, away_score=17, espn_event_id=11)
    _ins(c, "games", game_id=11, espn_event_id=11, league="nfl", season=2007,
         start_time_utc="2007-09-09T17:00:00Z", game_date="2007-09-09",
         home_team_id=1, away_team_id=2, neutral_site=0, completed=1, status="final")
    logs = []
    n = hist.backfill(c, log=logs.append)
    assert n == 1
    p_home = c.execute("SELECT p FROM nfl_team_chance_hist WHERE game_id = 'y07'").fetchone()[0]
    logs.clear()
    assert hist.backfill(c, log=logs.append) == 1
    assert any("up to date" in line for line in logs)
    c.execute("UPDATE games SET neutral_site = 1 WHERE espn_event_id = 11")
    hist.backfill(c, log=lambda *_: None)
    p_neu = c.execute("SELECT p FROM nfl_team_chance_hist WHERE game_id = 'y07'").fetchone()[0]
    # One training game does not pin down the sign of home edge. A different
    # probability shows the neutral flag reached the fit.
    assert abs(p_neu - p_home) > 1e-4
