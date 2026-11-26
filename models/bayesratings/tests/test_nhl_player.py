"""NHL player ridge: the estimator on a synthetic slate,
Daily Faceoff parsing, and the publish fallbacks. No walk-forward and no fit
against a holdout — the estimator is the one the research already tested.
"""
import gzip
import json
import logging
import math
import re
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from bayesratings import db, nhl_player as np_
from bayesratings.backfill import Pacer
from bayesratings.sources import common, dfo

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "tests" / "fixtures" / "sources"
AS_OF = "2026-11-22T18:00:00+00:00"
WHEN = datetime(2026, 11, 22, 18, 0, tzinfo=timezone.utc)


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    db.init_db(c)
    c.execute("PRAGMA foreign_keys = OFF")
    return c


def _ins(c, table, **kw):
    for _, name, typ, notnull, dflt, _pk in c.execute(f"PRAGMA table_info({table})"):
        if notnull and dflt is None and name not in kw:
            kw[name] = 0 if "INT" in (typ or "").upper() or "REAL" in (typ or "").upper() else \
                (kw.get("valid_from", "x") if name == "last_seen" else "x")
    cols = ", ".join(kw)
    c.execute(f"INSERT INTO {table} ({cols}) VALUES ({', '.join('?' * len(kw))})", list(kw.values()))


def _exec_research(src, ns):
    lines = []
    for line in src.splitlines():
        if line.startswith("print(") or ".to_csv(" in line or ".to_parquet(" in line:
            continue
        lines.append(line)
    exec("\n".join(lines), ns)


def _fn(src, start, end):
    return src[src.index(start):src.index(end)]


def _research_fns(games):
    src = (ROOT / "analysis" / "nhl_player" / "common.py").read_text()
    prior = _fn(src, "def prior_rates", "\ndef games")
    games_src = _fn(src, "def games", "\ndef folds")
    games_src = games_src.replace(
        'g = pd.read_csv(ROOT + "data/games.csv"); g = g[g.league == league]',
        "g = GAMES_IN.copy(); g = g[g.league == league]")
    ns = {"np": np, "pd": pd, "GAMES_IN": games}
    exec(prior + "\n" + games_src, ns)
    return ns["prior_rates"], ns["games"]


def _research_features(skaters, goalies, games):
    prior_rates, games_fn = _research_fns(games)
    src = (ROOT / "analysis" / "nhl_player" / "features.py").read_text()
    src = src.replace("from common import prior_rates, games, ROOT", "")
    src = src.replace(
        'S = pd.read_csv(ROOT + "data/player_game_nhl_skater.csv")', "S = S_IN.copy()")
    src = src.replace(
        'Gl = pd.read_csv(ROOT + "data/player_game_nhl_goalie.csv"); Gl = Gl[Gl.sa.fillna(0) >= 0].copy()',
        "Gl = G_IN.copy(); Gl = Gl[Gl.sa.fillna(0) >= 0].copy()")
    ns = {"S_IN": skaters, "G_IN": goalies, "prior_rates": prior_rates, "games": games_fn,
          "np": np, "pd": pd}
    _exec_research(src, ns)
    return ns["X"]


def _research_matrices(X):
    src = (ROOT / "analysis" / "nhl_player" / "run_models.py").read_text()
    src = src.replace("from common import folds, walk_forward\n", "")
    src = src.replace(
        'lg, fts, warm = sys.argv[1], int(sys.argv[2]), sys.argv[3]',
        'lg, fts, warm = "nhl", 2024, "2021-12-01"')
    src = src.replace(
        'X = pd.read_parquet(f"{lg}/features.parquet")', "X = X_IN.copy()")
    src = src.replace(
        "X = folds(X, fts, warm)",
        'X = X.sort_values("start_time_utc").reset_index(drop=True)\n'
        'X["date"] = pd.to_datetime(X.game_date)\n'
        'X["train_ok"] = X.date >= warm\n'
        'X["fold"] = -1')
    src = src.replace(
        'walk_forward(M, feats, f"{lg}/out", v); print("done", v, flush=True)',
        "MAT[v] = M.copy()")
    ns = {"X_IN": X, "MAT": {}, "np": np, "pd": pd}
    _exec_research(src, ns)
    return ns["MAT"]


def _close(a, b, keys, cols):
    a = a.sort_values(keys).reset_index(drop=True)
    b = b.sort_values(keys).reset_index(drop=True)
    assert list(a[keys].itertuples(index=False)) == list(b[keys].itertuples(index=False))
    for c in cols:
        av = pd.to_numeric(a[c], errors="coerce").to_numpy(float)
        bv = pd.to_numeric(b[c], errors="coerce").to_numpy(float)
        assert np.allclose(av, bv, rtol=1e-9, atol=1e-9, equal_nan=True), c


def _slate():
    """Small slate: a game before the training window, a scheduled day that
    only sets rest, a back-to-back, a tie, and a neutral game a skater misses."""
    events = [
        (1, "2021-11-20", "2021-11-20T00:00:00Z", 3, 1, 1, "STATUS_FINAL", 0),
        (90, "2021-12-01", "2021-12-01T00:00:00Z", None, None, 0, "STATUS_SCHEDULED", 0),
        (2, "2021-12-05", "2021-12-05T00:00:00Z", 4, 2, 1, "STATUS_FINAL", 0),
        (3, "2021-12-06", "2021-12-06T00:00:00Z", 2, 1, 1, "STATUS_FINAL", 0),
        (5, "2022-01-06", "2022-01-06T00:00:00Z", 2, 2, 1, "STATUS_FINAL", 0),
        (4, "2022-01-20", "2022-01-20T00:00:00Z", 5, 3, 1, "STATUS_FINAL", 1),
    ]
    games = pd.DataFrame([{
        "espn_event_id": eid, "league": "nhl", "season": 2022, "season_type": 2,
        "game_date": day, "start_time_utc": start, "home_team_id": 1, "away_team_id": 2,
        "home_score": hs, "away_score": as_, "completed": done, "status": status,
        "neutral_site": neutral,
    } for eid, day, start, hs, as_, done, status, neutral in events])
    played = [e for e in events if e[5] == 1]
    sk, gl = [], []
    for eid, day, *_rest in played:
        for aid, pos in ((11, "C"), (12, "L"), (13, "R"), (14, "D"), (15, "D")):
            if aid == 15 and eid == 4:
                continue
            sk.append(_skater(eid, day, 1, 2, 1, aid, pos))
        for aid, pos in ((21, "C"), (22, "L"), (23, "R"), (24, "D"), (25, "D")):
            sk.append(_skater(eid, day, 2, 1, 0, aid, pos))
        gl.append(_goalie(eid, day, 1, 2, 1, 101, 1, 20 + eid, 18 + (eid % 3)))
        gl.append(_goalie(eid, day, 2, 1, 0, 201, 1, 22 + eid, 19))
    gl.append(_goalie(2, "2021-12-05", 1, 2, 1, 102, 0, 8, 7))
    return pd.DataFrame(sk), pd.DataFrame(gl), games


def _skater(eid, day, team, opp, home, aid, pos):
    return {
        "espn_event_id": eid, "season": 2022, "game_date": day, "team_id": team,
        "opp_team_id": opp, "is_home": home, "athlete_id": aid, "position": pos,
        "toi_sec": 700 + (aid % 5) * 80 + eid * 40,
        "g": (aid + eid) % 3, "a": (aid * eid) % 2, "shots": 1 + (aid + eid) % 4,
        "shots_missed": eid % 2, "plus_minus": (aid % 5) - 2 - eid,
        "takeaways": (aid + eid) % 3, "giveaways": eid % 2, "blocks": (aid % 3),
        "hits": (aid + eid) % 4, "fo_won": 2 if pos == "C" else 0,
        "fo_lost": 1 if pos == "C" else 0,
    }


def _goalie(eid, day, team, opp, home, aid, starter, sa, sv):
    return {
        "espn_event_id": eid, "season": 2022, "game_date": day, "team_id": team,
        "opp_team_id": opp, "is_home": home, "athlete_id": aid, "starter": starter,
        "sa": sa, "sv": sv, "ga": sa - sv,
    }


def test_estimator_matches_the_research_grid():
    est = np_.make_estimator()
    clf = est.named_steps["logisticregressioncv"]
    assert clf.max_iter == 3000
    assert clf.cv == 5
    assert clf.scoring == "neg_log_loss"
    assert np.allclose(np.asarray(clf.Cs, float), np.logspace(-3, 1, 9))
    assert np_.TRAIN_FROM == "2021-12-01"


def _logit(p):
    return math.log(p / (1 - p))


def _store_fit(c, version, p, day="2026-11-16"):
    names = np_.diff_feature_names()
    n = len(names)
    _ins(c, "nhl_ridge_fits", fit_date=day, version=version, train_from="2021-12-01",
         train_through="2026-11-15", n_games=100, c_value=0.1, features=json.dumps(names),
         scaler_mean=json.dumps([0.0] * n), scaler_scale=json.dumps([1.0] * n),
         coef=json.dumps([0.0] * n), intercept=_logit(p), sklearn_version="1.9.1",
         created_at="2026-11-16T12:00:00+00:00")


def _box_skater(c, eid, day, team, opp, home, aid, pos="C", toi=900, season=2026):
    _ins(c, "player_game_nhl_skater", espn_event_id=eid, season=season, season_type=2,
         game_date=day, team_id=team, opp_team_id=opp, is_home=home, athlete_id=aid,
         position=pos, unit="defenses" if pos == "D" else "forwards", toi_sec=toi,
         g=0, a=1, shots=2, shots_missed=1, plus_minus=1, hits=1, blocks=1,
         takeaways=1, giveaways=0, fo_won=1, fo_lost=1, stats_json="{}")


def _box_goalie(c, eid, day, team, opp, home, aid, season=2026):
    _ins(c, "player_game_nhl_goalie", espn_event_id=eid, season=season, season_type=2,
         game_date=day, team_id=team, opp_team_id=opp, is_home=home, athlete_id=aid,
         starter=1, goalie_order=1, toi_sec=3600, sa=25, ga=2, sv=23, stats_json="{}")


def _prev_game(c, n_home=15, n_away=15):
    _ins(c, "games", espn_event_id=10, league="nhl", season=2026, season_type=2,
         start_time_utc="2026-11-20T00:00:00Z", game_date="2026-11-20", home_team_id=1,
         away_team_id=2, home_score=4, away_score=2, completed=1, status="STATUS_FINAL")
    for i in range(n_home):
        _box_skater(c, 10, "2026-11-20", 1, 2, 1, 100 + i, "D" if i < 6 else "C")
    for i in range(n_away):
        _box_skater(c, 10, "2026-11-20", 2, 1, 0, 200 + i, "D" if i < 6 else "C")
    _box_goalie(c, 10, "2026-11-20", 1, 2, 1, 301)
    _box_goalie(c, 10, "2026-11-20", 2, 1, 0, 401)
    np_.build_state(c, date(2026, 11, 22), log=lambda *_: None)


def _lines(c, team, aids, seen=AS_OF, status=None, group=None):
    for i, aid in enumerate(aids):
        g = group or ("d1" if i < 6 else "f1")
        _ins(c, "nhl_line_states", dfo_team_id=team, team_id=team, group_id=g,
             dfo_player_id=aid, athlete_id=aid, name=f"P{aid}", injury_status=status,
             state_hash=f"l-{team}-{aid}-{seen}", valid_from=seen, last_seen=seen)


def _goalie_feed(c, eid, team, aid, strength="Confirmed", seen=AS_OF):
    _ins(c, "nhl_goalie_states", game_date="2026-11-22", dfo_team_id=team, team_id=team,
         espn_event_id=eid, athlete_id=aid, goalie_name=f"G{aid}", strength=strength,
         state_hash=f"g-{eid}-{team}-{strength}", valid_from=seen, last_seen=seen)


def _forecast_row():
    return pd.DataFrame({
        "home_prob": [0.40], "away_prob": [0.60], "home_spread": [1.5], "away_spread": [-1.5],
        "total_pred": [6.0], "home_total_pred": [2.5], "away_total_pred": [3.5],
        "home_odds": [150], "away_odds": [-170],
    })


def _sched(eid=100, home=1, away=2, day="2026-11-22"):
    return pd.DataFrame({
        "espn_event_id": [eid], "season": [2026], "date": [day],
        "home_team": [str(home)], "away_team": [str(away)], "neutral": [0],
    })


def _publish(c, eid=100, home=1, away=2):
    _ins(c, "games", espn_event_id=eid, league="nhl", season=2026, season_type=2,
         start_time_utc="2026-11-22T23:00:00Z", game_date="2026-11-22", home_team_id=home,
         away_team_id=away, completed=0, status="STATUS_SCHEDULED")
    return np_.apply(c, _sched(eid, home, away), _forecast_row(), AS_OF, date(2026, 11, 22))


def _full_feed(c, eid=100):
    _lines(c, 1, list(range(100, 115)))
    _lines(c, 2, list(range(200, 215)))
    _goalie_feed(c, eid, 1, 301)
    _goalie_feed(c, eid, 2, 401)


def test_lines_goalie_and_fallbacks():
    c = _db()
    _prev_game(c)
    _store_fit(c, "B", 0.8)
    _store_fit(c, "C", 0.2)
    _full_feed(c)
    both = _publish(c)
    assert both.loc[0, "nhl_model_src"] == "ridge_b"
    assert both.loc[0, "home_prob"] == 0.8
    assert both.loc[0, "home_spread"] < 0
    assert both.loc[0, "total_pred"] == 6.0
    assert both.loc[0, "nhl_team_prob"] == 0.4

    c2 = _db()
    _prev_game(c2)
    _store_fit(c2, "B", 0.8)
    _store_fit(c2, "C", 0.2)
    _lines(c2, 1, list(range(100, 115)))
    _lines(c2, 2, list(range(200, 215)))
    _goalie_feed(c2, 100, 1, 301, strength="Likely")
    _goalie_feed(c2, 100, 2, 401)
    likely = _publish(c2)
    assert likely.loc[0, "nhl_model_src"] == "ridge_c"     # Likely is not confirmed
    assert likely.loc[0, "home_prob"] == 0.2
    assert likely.loc[0, "home_spread"] > 0
    assert likely.loc[0, "total_pred"] == 6.0

    c3 = _db()
    _prev_game(c3)
    _store_fit(c3, "B", 0.8)
    _store_fit(c3, "C", 0.2)
    _goalie_feed(c3, 100, 1, 301)
    _goalie_feed(c3, 100, 2, 401)
    noline = _publish(c3)
    assert noline.loc[0, "nhl_model_src"] == "ridge_c"

    stale = (WHEN - timedelta(hours=40)).isoformat()
    c4 = _db()
    _prev_game(c4)
    _store_fit(c4, "B", 0.8)
    _store_fit(c4, "C", 0.2)
    _lines(c4, 1, list(range(100, 115)), seen=stale)
    _lines(c4, 2, list(range(200, 215)), seen=stale)
    _goalie_feed(c4, 100, 1, 301)
    _goalie_feed(c4, 100, 2, 401)
    old = _publish(c4)
    assert old.loc[0, "nhl_model_src"] == "ridge_c"        # lines older than 36 hours

    c5 = _db()
    _prev_game(c5)
    missing = _publish(c5)
    assert missing.loc[0, "nhl_model_src"] == "team"
    assert missing.loc[0, "home_prob"] == 0.4
    assert missing.loc[0, "home_spread"] == 1.5
    assert missing.loc[0, "total_pred"] == 6.0

    c6 = _db()
    _store_fit(c6, "B", 0.8)
    _store_fit(c6, "C", 0.2)
    _full_feed(c6, eid=300)
    cold = _publish(c6, eid=300, home=3, away=4)
    assert cold.loc[0, "nhl_model_src"] == "team"          # no box this season or last

    short = _db()
    _prev_game(short, n_home=14, n_away=15)
    _store_fit(short, "B", 0.8)
    _store_fit(short, "C", 0.2)
    _lines(short, 1, list(range(100, 114)))
    _lines(short, 2, list(range(200, 215)))
    _goalie_feed(short, 100, 1, 301)
    _goalie_feed(short, 100, 2, 401)
    thin = _publish(short)
    assert thin.loc[0, "nhl_model_src"] == "ridge_c"       # 14 dressed is not a full chart


def _pools(inputs):
    body = str(inputs).split("lines=", 1)[1]
    lines, goalie = body.split(";goalie=")
    home, away = lines.split("|")

    def ids(text):
        return {int(x) for x in text.split(",") if x}

    return ids(home), ids(away), goalie


def _chart(c, team, aid, group, status=None, seen=AS_OF, pos=None):
    _ins(c, "nhl_line_states", dfo_team_id=team, team_id=team, group_id=group,
         position_id=pos, dfo_player_id=aid, athlete_id=aid, name=f"P{aid}",
         injury_status=status, state_hash=f"c-{team}-{aid}-{group}-{status}-{seen}",
         valid_from=seen, last_seen=seen)


def test_c_skaters_use_a_fresh_chart_and_drop_who_will_not_dress():
    rows = [
        {"athlete_id": 1, "group_id": "f1", "injury_status": None, "last_seen": AS_OF, "gtd": 1},
        {"athlete_id": 2, "group_id": "f2", "injury_status": "dtd", "last_seen": AS_OF},
        {"athlete_id": 3, "group_id": "d1", "injury_status": None, "last_seen": AS_OF},
        {"athlete_id": 4, "group_id": "f1", "injury_status": "out", "last_seen": AS_OF},
        {"athlete_id": 5, "group_id": "f3", "injury_status": "Injured Reserve", "last_seen": AS_OF},
        {"athlete_id": 6, "group_id": "ir", "injury_status": "dtd", "last_seen": AS_OF},
        {"athlete_id": 7, "group_id": "d2", "injury_status": "scratched", "last_seen": AS_OF},
        {"athlete_id": 1, "group_id": "ir", "injury_status": "out", "last_seen": AS_OF},
    ]
    # 1 is also on a dressed line; one out row is enough to keep him off.
    assert np_.c_skater_ids(rows, AS_OF, [4, 9, 10]) == [2, 3]
    flag = np_._pos_flag(np_._defense_ids(rows))
    assert flag(3, None) is True
    assert flag(2, None) is False
    assert flag(3, {"is_d": 0}) is False          # a box position wins
    assert flag(2, {"is_d": 1}) is True

    stale = (WHEN - timedelta(hours=40)).isoformat()
    old = [
        {"athlete_id": 900, "group_id": "f1", "injury_status": None, "last_seen": stale},
        {"athlete_id": 100, "group_id": "ir", "injury_status": "out", "last_seen": stale},
    ]
    got = np_.c_skater_ids(old, AS_OF, list(range(100, 115)))
    assert 900 not in got and 100 not in got and 101 in got
    assert got == list(range(101, 115))

    empty = [{"athlete_id": None, "group_id": "f1", "injury_status": None, "last_seen": AS_OF}]
    assert np_.c_skater_ids(empty, AS_OF, [1, 2]) == []


def test_expected_goalie_precedence_and_other_team():
    starts = [("2026-11-01", 5), ("2026-11-02", 5)] + [("2026-11-10", 9)] * 8
    starts += [("2026-11-18", 8), ("2026-11-19", 8)]
    chart = {9: {2}}
    latest = {9: 1, 8: 1, 7: 1, 5: 1}
    listing = {8, 7}
    # Confirmed is on another team's chart, so Likely is next.
    assert np_.expected_goalie(
        1, "2026-11-22", {"confirmed": 9, "likely": 8, "espn": 7},
        starts, listing, latest, chart) == (8, "likely")
    assert np_.expected_goalie(
        1, "2026-11-22", {"espn": 7}, starts, listing, latest, chart) == (7, "espn")
    assert np_.expected_goalie(
        1, "2026-11-22", {"confirmed": 7, "likely": 8},
        starts, {7, 8}, latest, {}) == (7, "confirmed")
    # No listing: 9's latest appearance is another team, so the last-10 count is 8.
    assert np_.expected_goalie(
        1, "2026-11-22", {}, starts, None, {9: 2, 8: 1}, {}) == (8, "most_used")
    # Do not reach past the last 10 to an eligible goalie.
    traded = [("2026-11-01", 5), ("2026-11-02", 5)] + [("2026-11-10", 9)] * 10
    assert np_.expected_goalie(
        1, "2026-11-22", {}, traded, None, {5: 1, 9: 2}, {9: {2}}) == (None, None)
    # A goalie the chart now lists elsewhere is never returned, even as most-used.
    assert np_.expected_goalie(
        1, "2026-11-22", {"confirmed": 9}, [("2026-11-20", 9)] * 10,
        {9}, {9: 1}, {9: {2}}) == (None, None)
    tie = [("2026-11-18", 20), ("2026-11-19", 10)]
    assert np_.expected_goalie(
        1, "2026-11-22", {}, tie, None, {20: 1, 10: 1}, {}) == (10, "most_used")


def test_ridge_c_fresh_lines_follow_a_trade(monkeypatch):
    c = _db()
    _prev_game(c)
    _store_fit(c, "B", 0.8)
    _store_fit(c, "C", 0.2)
    _lines(c, 1, list(range(101, 116)))
    _chart(c, 1, 102, "ir", status="out")
    _lines(c, 2, list(range(200, 214)) + [100])
    _chart(c, 2, 150, "d1")
    _chart(c, 2, 151, "f1")
    flags = []
    real = np_._side_from_ids

    def wrap(ids, flag, state, *args, **kwargs):
        flags.append({int(i): bool(flag(int(i), state.get(int(i)))) for i in ids})
        return real(ids, flag, state, *args, **kwargs)

    monkeypatch.setattr(np_, "_side_from_ids", wrap)
    out = _publish(c)
    assert out.loc[0, "nhl_model_src"] == "ridge_c"
    home, away, goalie = _pools(out.loc[0, "nhl_inputs"])
    assert 100 not in home and 102 not in home and 101 in home
    assert 100 in away and 150 in away and 151 in away and 214 not in away
    assert goalie == "301:most_used|401:most_used"
    callups = next(side for side in flags if 150 in side)
    assert callups[150] is True and callups[151] is False
    assert callups[100] is True                 # box says defense, the chart says f1


def test_ridge_c_stale_lines_keep_the_rotation_and_drop_outs():
    c = _db()
    _prev_game(c)
    _store_fit(c, "B", 0.8)
    _store_fit(c, "C", 0.2)
    stale = (WHEN - timedelta(hours=40)).isoformat()
    _lines(c, 1, list(range(900, 915)), seen=stale)
    _chart(c, 1, 100, "ir", status="injured", seen=stale)
    _lines(c, 2, list(range(200, 215)), seen=stale)
    out = _publish(c)
    assert out.loc[0, "nhl_model_src"] == "ridge_c"
    home, away, _goalie = _pools(out.loc[0, "nhl_inputs"])
    assert home == set(range(101, 115))
    assert 900 not in home and 100 not in home
    assert away == set(range(200, 215))


def test_ridge_c_goalie_source_follows_the_starter_order():
    c = _db()
    _prev_game(c)
    for n, day in enumerate(["2026-11-10", "2026-11-12", "2026-11-14",
                             "2026-11-16", "2026-11-18"]):
        _box_goalie(c, 50 + n, day, 1, 2, 1, 302)
    np_.build_state(c, date(2026, 11, 22), log=lambda *_: None)
    _store_fit(c, "B", 0.8)
    _store_fit(c, "C", 0.2)
    _lines(c, 1, list(range(100, 115)))
    _lines(c, 2, list(range(200, 215)))
    _goalie_feed(c, 100, 1, 301, strength="Likely")
    _goalie_feed(c, 100, 1, 302, strength="Unconfirmed")
    _goalie_feed(c, 100, 2, 401, strength="Likely")
    likely = _publish(c)
    assert likely.loc[0, "nhl_model_src"] == "ridge_c"
    assert "301:likely|401:likely" in likely.loc[0, "nhl_inputs"]

    traded = _db()
    _prev_game(traded)
    _store_fit(traded, "B", 0.8)
    _store_fit(traded, "C", 0.2)
    _lines(traded, 1, list(range(100, 115)))
    _lines(traded, 2, list(range(200, 215)))
    _chart(traded, 1, 303, "g", pos="g1")
    _chart(traded, 2, 301, "g", pos="g1")
    _chart(traded, 2, 401, "g", pos="g2")
    _ins(traded, "game_probables", espn_event_id=100, league="nhl", team_id=1, kind="SG",
         athlete_id=303, name="G303", status="Expected", state_hash="sg-303",
         valid_from=AS_OF, last_seen=AS_OF)
    moved = _publish(traded)
    _home, _away, goalie = _pools(moved.loc[0, "nhl_inputs"])
    assert goalie == "303:espn|401:most_used"
    assert "301:" not in goalie
    # 303 is named and has no saved goalie line, so the team forecast is published.
    assert moved.loc[0, "nhl_model_src"] == "team"
    assert moved.loc[0, "home_prob"] == 0.4
    assert moved.loc[0, "home_spread"] == 1.5


def _published(row):
    return (row["nhl_model_src"], float(row["home_prob"]), float(row["home_spread"]),
            float(row["total_pred"]), float(row["home_total_pred"]),
            float(row["away_total_pred"]))


def test_named_starter_without_a_goalie_line_publishes_the_team_forecast(monkeypatch, caplog):
    """A named starter with no saved line leaves the ridge, same as unknown.

    decay_goalie(None) is the blank league-average goalie. A saved line,
    including one with no shots yet, still decays.
    """
    with pytest.raises(ValueError, match="saved goalie line"):
        np_.decay_goalie(None, "2026-11-22", 0.910)
    kept = np_.decay_goalie({"s_sv": 0.0, "e_sa": 0.0}, "2026-11-22", 0.910)
    assert kept["gexp"] == 0.0 and math.isfinite(kept["gsaa30"])

    calls = []
    real = np_.decay_goalie

    def guard(st, game_date, lg_sv):
        calls.append(st)
        if st is None:
            raise AssertionError("decay_goalie(None)")
        return real(st, game_date, lg_sv)

    monkeypatch.setattr(np_, "decay_goalie", guard)
    team = ("team", 0.4, 1.5, 6.0, 2.5, 3.5)

    def slate():
        c = _db()
        _prev_game(c)
        _store_fit(c, "B", 0.8)
        _store_fit(c, "C", 0.2)
        _lines(c, 1, list(range(100, 115)))
        _lines(c, 2, list(range(200, 215)))
        return c

    # Home's only recent starter is listed for a third team, so the
    # starter is unknown. Away keeps the goalie who has a saved line.
    unknown_db = slate()
    _chart(unknown_db, 3, 301, "g", pos="g1")
    with caplog.at_level(logging.WARNING, logger="bayesratings.nhl_player"):
        unknown = _publish(unknown_db)
    assert _published(unknown.loc[0]) == team
    assert unknown.loc[0, "nhl_inputs"].endswith("goalie=-|401:most_used")
    assert "player fallback" not in caplog.text
    assert calls and all(st is not None for st in calls)

    # 999 is named (Likely) and has no goalie box, so no saved line.
    calls.clear()
    caplog.clear()
    named = slate()
    _goalie_feed(named, 100, 1, 999, strength="Likely")
    with caplog.at_level(logging.WARNING, logger="bayesratings.nhl_player"):
        out = _publish(named)
    assert _published(out.loc[0]) == _published(unknown.loc[0])
    assert "999:likely|401:most_used" in out.loc[0, "nhl_inputs"]
    assert "player fallback" not in caplog.text
    assert calls and all(st is not None for st in calls)

    # Both goalies are Confirmed, so this would have been ridge B. The
    # named starter still has no line, so the team forecast is published.
    calls.clear()
    confirmed = slate()
    _goalie_feed(confirmed, 100, 1, 999)
    _goalie_feed(confirmed, 100, 2, 401)
    both = _publish(confirmed)
    assert _published(both.loc[0]) == team
    assert "999:confirmed|401:confirmed" in both.loc[0, "nhl_inputs"]
    assert calls and all(st is not None for st in calls)


def test_overlay_logs_the_team_fallback(monkeypatch, caplog):
    frame = pd.DataFrame({
        "espn_event_id": [9001, 9002], "home_prob": [0.61, 0.55],
        "home_spread": [-1.5, 1.5], "total_pred": [6.0, 6.0],
        "home_total_pred": [3.0, 2.5], "away_total_pred": [3.0, 3.5],
    })

    def slate_broke(*_a, **_k):
        raise RuntimeError("slate broke")

    monkeypatch.setattr(np_, "_prepare_slate", slate_broke)
    with caplog.at_level(logging.WARNING, logger="bayesratings.nhl_player"):
        out = np_.overlay(None, frame, AS_OF)
    assert list(out["nhl_model_src"]) == ["team", "team"]
    assert abs(float(out.loc[0, "home_prob"]) - 0.61) < 1e-6
    assert "nhl player fallback event 9001: RuntimeError: slate broke" in caplog.text
    assert "nhl player fallback event 9002: RuntimeError: slate broke" in caplog.text

    caplog.clear()
    monkeypatch.setattr(np_, "_prepare_slate", lambda *_a, **_k: {})

    def row_broke(*_a, **_k):
        raise ValueError("row broke")

    monkeypatch.setattr(np_, "_score_row", row_broke)
    with caplog.at_level(logging.WARNING, logger="bayesratings.nhl_player"):
        out = np_.overlay(None, frame, AS_OF)
    assert list(out["nhl_model_src"]) == ["team", "team"]
    assert "nhl player fallback event 9001: ValueError: row broke" in caplog.text
    assert "nhl player fallback event 9002: ValueError: row broke" in caplog.text


def _snap(c, table, eid, league, day, start, home_prob, snap=None, locked=False):
    _ins(c, "games", espn_event_id=eid, league=league, season=2026, season_type=2,
         start_time_utc=start, game_date=day, home_team_id=1, away_team_id=2,
         completed=0, status="STATUS_SCHEDULED")
    kw = dict(espn_event_id=eid, league=league, game_date=day, home_team_id=1, away_team_id=2,
              home_prob=home_prob, away_prob=round(1 - home_prob, 4), home_spread=1.5,
              total_pred=6.0, home_total_pred=2.5, away_total_pred=3.5,
              player_prob_base=0.42, player_spread_base=1.5, player_total_base=6.0,
              player_home_total_base=2.5, player_away_total_base=3.5,
              home_player_x=0.0, away_player_x=0.0, elo_weight=0.0, p_logit=0.42,
              player_inputs="stale", snapshot_date=snap or day)
    _ins(c, table, **kw)
    if locked:
        _ins(c, "forecast_locks", espn_event_id=eid, league=league,
             locked_at=AS_OF, home_prob=home_prob, home_spread=0.0, total_pred=200.0)


def _row(c, table, eid):
    return c.execute(
        f"SELECT home_prob, home_spread, total_pred, nhl_model_src FROM {table} "
        "WHERE espn_event_id = ?", (eid,)).fetchone()


def test_refresh_leaves_past_rows_locks_and_other_leagues():
    c = _db()
    _prev_game(c, n_home=2, n_away=2)
    _store_fit(c, "B", 0.8)
    _store_fit(c, "C", 0.8)
    now_day = "2026-11-22"
    _snap(c, "forecast_snapshots", 100, "nhl", now_day, "2026-11-22T23:00:00Z", 0.11)
    _snap(c, "forecast_snapshots", 101, "nhl", now_day, "2026-11-22T18:03:00Z", 0.11)
    _snap(c, "forecast_snapshots", 102, "nhl", "2026-11-21", "2026-11-21T23:00:00Z", 0.11,
          snap="2026-11-21")
    _snap(c, "forecast_snapshots", 103, "nhl", now_day, "2026-11-23T02:00:00Z", 0.11, locked=True)
    _snap(c, "upcoming_forecasts", 104, "nhl", "2026-11-25", "2026-11-25T23:00:00Z", 0.11)
    _snap(c, "forecast_snapshots", 200, "nba", now_day, "2026-11-22T23:00:00Z", 0.3333)
    before = {eid: _row(c, "forecast_snapshots", eid) for eid in (101, 102, 103, 200)}
    up_before = _row(c, "upcoming_forecasts", 104)
    out = np_.refresh(c, WHEN, log=lambda *_: None)
    assert out == 2
    live = _row(c, "forecast_snapshots", 100)
    assert live["nhl_model_src"] == "ridge_c" and live["home_prob"] == 0.8
    assert live["home_spread"] < 0 and live["total_pred"] == 6.0
    soon = _row(c, "upcoming_forecasts", 104)
    assert soon["home_prob"] == 0.8 and soon["total_pred"] == up_before["total_pred"]
    for eid, old in before.items():
        assert _row(c, "forecast_snapshots", eid) == old
    assert np_.refresh(c, WHEN, log=lambda *_: None) is None
    assert _row(c, "forecast_snapshots", 200) == before[200]


def test_refit_due_monday_or_when_empty():
    c = _db()
    assert np_.refit_due(c, date(2026, 11, 24))          # Tuesday, nothing stored
    _store_fit(c, "B", 0.5, day="2026-11-24")
    _store_fit(c, "C", 0.5, day="2026-11-24")
    assert not np_.refit_due(c, date(2026, 11, 24))
    assert np_.refit_due(c, date(2026, 11, 23))          # Monday
    c.execute("UPDATE nhl_ridge_fits SET fit_date = '2026-11-23'")
    assert not np_.refit_due(c, date(2026, 11, 23))


def test_requirements_pin_sklearn():
    text = (ROOT / "requirements.txt").read_text()
    for pin in ("scikit-learn==1.9.1", "scipy==1.18.1", "joblib==1.6.0", "threadpoolctl==3.8.0"):
        assert pin in text


def _nhl_game(c, day="2026-11-22"):
    _ins(c, "games", espn_event_id=1, league="nhl", season=2026, season_type=2,
         start_time_utc=f"{day}T23:00:00Z", game_date=day, home_team_id=1, away_team_id=2,
         completed=0, status="STATUS_SCHEDULED")


def test_slate_pass_fail_closed():
    quiet = _db()
    calls = []
    out = dfo.slate_pass(quiet, Pacer(0), now=WHEN, fetch=lambda *a, **k: calls.append(a) or b"")
    assert out["skipped"] == "no NHL games today" and calls == []

    cached = _db()
    _nhl_game(cached)
    seen = WHEN.isoformat()
    _ins(cached, "nhl_goalie_states", game_date="2026-11-22", dfo_team_id=1, team_id=1,
         state_hash="g", valid_from=seen, last_seen=seen)
    _ins(cached, "nhl_line_states", dfo_team_id=1, team_id=1, group_id="f1", dfo_player_id=1,
         state_hash="l", valid_from=seen, last_seen=seen)
    calls = []
    out = dfo.slate_pass(cached, Pacer(0), now=WHEN, fetch=lambda *a, **k: calls.append(a) or b"")
    assert out["skipped"] == "fetched recently" and calls == []

    blocked = _db()
    _nhl_game(blocked)

    def fetch(url, accept="*/*", timeout=30, retries=3, headers=None):
        if str(url).endswith("/robots.txt"):
            return b"User-agent: *\nDisallow: /\n"
        raise AssertionError(url)

    out = dfo.slate_pass(blocked, Pacer(0), now=WHEN, fetch=fetch, log=lambda *_: None)
    assert out["errors"] >= 1
    assert "robots" in str(out.get("lines", "")).lower() or "Robots" in str(out.get("goalies_error", ""))
