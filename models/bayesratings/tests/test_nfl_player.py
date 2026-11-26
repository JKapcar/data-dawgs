"""NFL quarterback ridge (bayesratings/nfl_player.py).

Checks the estimator on a synthetic slate, the publish rule, and the
refresh write rules. No walk-forward.
Run: PYTHONPATH=. python -m pytest tests/test_nfl_player.py
"""
import io
import json
import logging
import math
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from bayesratings import db, nfl_player as nf
from bayesratings.backfill import Pacer
from bayesratings.sources import nfl_pbp
from bayesratings.sources.common import Missing

ROOT = Path(__file__).resolve().parents[1]
AS_OF = "2026-11-22T18:00:00+00:00"
FEATURES = ["lt", "qbA_epa_d", "qbA_cpoe_d", "qbA_exp_d", "chg_d"]


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


def _research_prior():
    src = (ROOT / "analysis" / "nfl_qb_epa" / "shared" / "common.py").read_text()
    start = src.index("def prior_rates")
    end = src.index("\ndef games")
    ns = {"np": np, "pd": pd}
    exec(src[start:end], ns)
    return ns["prior_rates"]


def _slate():
    """Thirty scored games, four quarterbacks, one relocation. Built here."""
    rng = np.random.default_rng(0)
    qbs = ["00-A", "00-B", "00-C", "00-D"]
    base = {"00-A": 0.20, "00-B": -0.05, "00-C": 0.08, "00-D": -0.12}
    plays, games = [], []
    start = pd.Timestamp("2010-09-12")
    for i in range(30):
        gid = f"g{i:02d}"
        day = start + pd.Timedelta(days=7 * i)
        if i == 0:
            home, away = "OAK", "BUF"
        elif i == 1:
            home, away = "LV", "BUF"          # same franchise as OAK, different starter
        else:
            home, away = ("KC", "BUF") if i % 2 == 0 else ("BUF", "KC")
        hq = "00-B" if i == 1 else ("00-A" if i == 0 else qbs[(i // 3) % 2])
        aq = qbs[2 + (i // 5) % 2]
        hs, aws = (24, 17) if i % 2 == 0 else (13, 20)
        games.append({"game_id": gid, "season": 2010 if i < 20 else 2011, "date": day,
                      "home_franchise": home, "away_franchise": away,
                      "home_qb": hq, "away_qb": aq, "home_score": hs, "away_score": aws})
        for qb, team in ((hq, home), (aq, away)):
            for k in range(12):
                plays.append({
                    "game_id": gid, "season": games[-1]["season"],
                    "game_date": str(day.date()), "posteam": team, "play_type": "pass",
                    "epa": float(base[qb] + rng.normal(0, 0.4)),
                    "qb_dropback": 1, "passer_player_id": qb, "rusher_player_id": None,
                    "cpoe": float(rng.normal(0, 8)) if k % 4 else np.nan,
                })
            plays.append({
                "game_id": gid, "season": games[-1]["season"], "game_date": str(day.date()),
                "posteam": team, "play_type": "kickoff", "epa": 1.0, "qb_dropback": 1,
                "passer_player_id": qb, "rusher_player_id": None, "cpoe": 50.0,
            })
    sched = pd.DataFrame(games)
    plays = pd.DataFrame(plays)
    team_prob = {g: float(0.42 + (i % 5) * 0.03) for i, g in enumerate(sched.game_id)}
    return plays, sched, team_prob


def _research_features(plays, sched, team_prob):
    """build.py's quarterback rates, qb_state and the changed flag, on this slate."""
    prior = _research_prior()
    p = plays[plays.epa.notna() & plays.posteam.notna()].copy()
    p["st"] = p.play_type.isin(["kickoff", "punt", "field_goal", "extra_point"])
    db = p[(p.qb_dropback == 1) & ~p.st].copy()
    db = db.assign(qb=db.passer_player_id.fillna(db.rusher_player_id))
    q = db.groupby(["game_id", "posteam", "qb"], as_index=False).agg(
        qb_epa=("epa", "sum"), qb_n=("epa", "size"),
        cpoe_sum=("cpoe", lambda x: x.fillna(0).sum()),
        cpoe_n=("cpoe", lambda x: x.notna().sum()))
    S = sched.copy()
    S["home_team"] = S.home_franchise.replace({"OAK": "LV", "SD": "LAC", "STL": "LA"})
    S["away_team"] = S.away_franchise.replace({"OAK": "LV", "SD": "LAC", "STL": "LA"})
    S["date"] = pd.to_datetime(S.date)
    QG = q.merge(S[["game_id", "date"]], on="game_id")
    lq = float(QG.qb_epa.sum() / QG.qb_n.sum())
    qa = prior(QG[["game_id", "qb", "date", "qb_epa", "qb_n"]].copy(),
               "qb", "date", "qb_n", ["qb_epa"], 365.0, 250.0, {"qb_epa": lq - 0.10})
    qa = qa.rename(columns={"_expo": "qb_expo"})
    qc = prior(QG[["game_id", "qb", "date", "cpoe_sum", "cpoe_n"]].copy(),
               "qb", "date", "cpoe_n", ["cpoe_sum"], 365.0, 300.0, {"cpoe_sum": -2.0})
    QS = qa.merge(qc[["game_id", "qb", "cpoe_sum_r"]], on=["game_id", "qb"])
    QG2 = QG.merge(QS[["game_id", "qb", "qb_epa_r", "qb_expo", "cpoe_sum_r"]], on=["game_id", "qb"])
    by_qb = {qb: df.sort_values("date") for qb, df in QG2.groupby("qb")}

    def qb_state(qb, when, game_id):
        df = by_qb.get(qb)
        if df is None:
            return (lq - 0.10, 0.0, -2.0)
        cur = df[df.game_id == game_id]
        if len(cur):
            r = cur.iloc[0]
            return (float(r.qb_epa_r), float(np.log1p(r.qb_expo)), float(r.cpoe_sum_r))
        prev = df[df.date < when]
        if not len(prev):
            return (lq - 0.10, 0.0, -2.0)
        r = prev.iloc[-1]
        n = r.qb_expo + r.qb_n
        e = (r.qb_epa_r * (r.qb_expo + 250) + r.qb_epa) / (r.qb_expo + 250 + r.qb_n)
        return (float(e), float(np.log1p(n)), float(r.cpoe_sum_r))

    long = pd.concat([
        S[["game_id", "date", "home_team", "home_qb"]].rename(columns={"home_team": "t", "home_qb": "qb"}),
        S[["game_id", "date", "away_team", "away_qb"]].rename(columns={"away_team": "t", "away_qb": "qb"}),
    ]).sort_values(["t", "date"])
    long["prev_qb"] = long.groupby("t").qb.shift()
    pq = long.set_index(["game_id", "t"]).prev_qb.to_dict()
    rows = []
    for r in S.itertuples(index=False):
        o = {"game_id": r.game_id, "y": int(r.home_score > r.away_score)}
        for side, tm, qb in (("h", r.home_team, r.home_qb), ("a", r.away_team, r.away_qb)):
            e, x, cp = qb_state(qb, r.date, r.game_id)
            o[f"{side}_epa"], o[f"{side}_exp"], o[f"{side}_cpoe"] = e, x, cp
            prev = pq.get((r.game_id, tm))
            o[f"{side}_changed"] = int(isinstance(prev, str) and prev != qb)
        pt = team_prob[r.game_id]
        o["lt"] = float(np.log(np.clip(pt, 1e-4, 1 - 1e-4) / (1 - np.clip(pt, 1e-4, 1 - 1e-4))))
        o["qbA_epa_d"] = o["h_epa"] - o["a_epa"]
        o["qbA_cpoe_d"] = o["h_cpoe"] - o["a_cpoe"]
        o["qbA_exp_d"] = o["h_exp"] - o["a_exp"]
        o["chg_d"] = o["h_changed"] - o["a_changed"]
        o["date"] = r.date
        o["y_home"] = r.home_score > r.away_score
        rows.append(o)
    # the no-current-game branch, and a quarterback who never appears
    future = pd.Timestamp("2012-01-01")
    branches = {
        "seen": qb_state("00-A", S.date.iloc[5], S.game_id.iloc[5]),
        "later": qb_state("00-A", future, "not-a-game"),
        "never": qb_state("00-NOBODY", future, "not-a-game"),
    }
    return pd.DataFrame(rows), branches, lq


def _logit(p):
    return math.log(p / (1 - p))


def _store_fit(c, p=0.7, n_games=2000):
    _ins(c, "nfl_ridge_fits", fit_date="2026-11-16", version="qbA", train_from="2007",
         train_through="2026-11-15", n_games=n_games, c_value=0.1,
         features=json.dumps(FEATURES), scaler_mean=json.dumps([0.0] * 5),
         scaler_scale=json.dumps([1.0] * 5), coef=json.dumps([0.0] * 5),
         intercept=_logit(p), sklearn_version="1.9.1", created_at=AS_OF)


def _state(c):
    _ins(c, "nfl_qb_state", as_of_date="2026-11-22", qb="00-0099999",
         last_game_date="2026-11-15", last_game_id="old",
         state_json=json.dumps({"qb_epa_r": 0.1, "qb_expo": 80, "qb_epa": 4,
                                "qb_n": 25, "cpoe_sum_r": -1.0, "lq": 0.04}))


def _gsis(c, athlete, gsis):
    _ins(c, "nfl_weekly_roster_states", league="nfl", season=2026, week=10, gsis_id=gsis,
         espn_id=athlete, athlete_id=athlete, state_hash=f"h{athlete}",
         valid_from="2026-11-01T00:00:00+00:00", last_seen=AS_OF)


def _lineup(c, eid, team, athlete, role="starter", at=AS_OF):
    _ins(c, "pregame_lineups", espn_event_id=eid, fetched_at=at, team_id=team,
         role=role, athlete_id=athlete, position="QB")


def _teams(c):
    _ins(c, "teams", team_id=1, league="nfl", espn_id=12, abbreviation="KC", name="Chiefs")
    _ins(c, "teams", team_id=2, league="nfl", espn_id=2, abbreviation="BUF", name="Bills")


def _game(c, eid=100, day="2026-11-22", start="2026-11-22T20:00:00Z"):
    _ins(c, "games", espn_event_id=eid, league="nfl", season=2026, season_type=2,
         start_time_utc=start, game_date=day, home_team_id=1, away_team_id=2,
         completed=0, status="STATUS_SCHEDULED")


def _forecast_row():
    return pd.DataFrame({
        "home_prob": [0.40], "away_prob": [0.60], "home_spread": [6.0], "away_spread": [-6.0],
        "total_pred": [45.5], "home_total_pred": [19.8], "away_total_pred": [25.7],
        "home_odds": [150], "away_odds": [-170], "player_prob_base": [0.47],
    })


def _sched(eid=100):
    return pd.DataFrame({
        "espn_event_id": [eid], "season": [2026], "date": ["2026-11-22"],
        "home_team": ["1"], "away_team": ["2"],
    })


def _ready(c, eid=100):
    _teams(c)
    _game(c, eid)
    _store_fit(c)
    _state(c)
    _gsis(c, 11, "00-0033873")
    _gsis(c, 22, "00-0034796")
    _lineup(c, eid, 1, 11)
    _lineup(c, eid, 2, 22)


def test_publish_rules():
    c = _db()
    _ready(c)
    both = nf.apply(c, _sched(), _forecast_row(), AS_OF, date(2026, 11, 22))
    assert both.loc[0, "nfl_model_src"] == "ridge_qb"
    assert both.loc[0, "home_prob"] == 0.7
    assert both.loc[0, "home_spread"] < 0
    assert both.loc[0, "total_pred"] == 45.5
    assert both.loc[0, "nfl_team_prob"] == 0.4
    assert "home=11:lineup" in both.loc[0, "nfl_inputs"]
    assert "away=22:lineup" in both.loc[0, "nfl_inputs"]
    assert "n=2000" in both.loc[0, "nfl_inputs"] and "c=0.1" in both.loc[0, "nfl_inputs"]

    one = _db()
    _ready(one)
    one.execute("DELETE FROM pregame_lineups WHERE team_id = 2")
    # yesterday's starter is on the schedule and is still not a fallback
    _ins(one, "nfl_schedule", game_id="prev", season=2026, week=10, game_type="REG",
         game_date="2026-11-15", home_franchise="KC", away_franchise="BUF",
         home_qb_gsis="00-0034796", away_qb_gsis="00-0033873", espn_event_id=9,
         home_score=20, away_score=17)
    missed = nf.apply(one, _sched(), _forecast_row(), AS_OF, date(2026, 11, 22))
    assert missed.loc[0, "nfl_model_src"] == "team"
    assert missed.loc[0, "home_prob"] == 0.4
    assert missed.loc[0, "home_spread"] == 6.0
    assert missed.loc[0, "total_pred"] == 45.5

    depth = _db()
    _teams(depth)
    _game(depth)
    _store_fit(depth)
    _state(depth)
    _gsis(depth, 11, "00-0033873")
    _gsis(depth, 22, "00-0034796")
    for team, athlete in ((1, 11), (2, 22)):
        _ins(depth, "nfl_depth_states", league="nfl", team_id=team, formation="Offense",
             slot="qb", depth=1, athlete_id=athlete, state_hash=f"d{team}",
             valid_from="2026-11-20T00:00:00+00:00", last_seen=AS_OF)
    via_depth = nf.apply(depth, _sched(), _forecast_row(), AS_OF, date(2026, 11, 22))
    assert via_depth.loc[0, "nfl_model_src"] == "ridge_qb"
    assert "home=11:depth" in via_depth.loc[0, "nfl_inputs"]
    assert "away=22:depth" in via_depth.loc[0, "nfl_inputs"]

    unmapped = _db()
    _teams(unmapped)
    _game(unmapped)
    _store_fit(unmapped)
    _state(unmapped)
    _lineup(unmapped, 100, 1, 11)
    _lineup(unmapped, 100, 2, 22)
    no_id = nf.apply(unmapped, _sched(), _forecast_row(), AS_OF, date(2026, 11, 22))
    assert no_id.loc[0, "nfl_model_src"] == "team"
    assert no_id.loc[0, "home_prob"] == 0.4

    no_fit = _db()
    _teams(no_fit)
    _game(no_fit)
    _state(no_fit)
    _gsis(no_fit, 11, "00-0033873")
    _gsis(no_fit, 22, "00-0034796")
    _lineup(no_fit, 100, 1, 11)
    _lineup(no_fit, 100, 2, 22)
    bare = nf.apply(no_fit, _sched(), _forecast_row(), AS_OF, date(2026, 11, 22))
    assert bare.loc[0, "nfl_model_src"] == "team"
    assert bare.loc[0, "home_spread"] == 6.0
    assert "n=-" in bare.loc[0, "nfl_inputs"] and "c=-" in bare.loc[0, "nfl_inputs"]

    short = _db()
    _ready(short)
    short.execute("UPDATE nfl_ridge_fits SET n_games = 1999")
    held = nf.apply(short, _sched(), _forecast_row(), AS_OF, date(2026, 11, 22))
    assert held.loc[0, "nfl_model_src"] == "team"
    assert held.loc[0, "home_prob"] == 0.4
    assert "n=1999" in held.loc[0, "nfl_inputs"] and "c=0.1" in held.loc[0, "nfl_inputs"]


def _snap(c, table, eid, league, day, start, home_prob, snap=None, locked=False):
    _game(c, eid, day, start) if league == "nfl" else _ins(
        c, "games", espn_event_id=eid, league=league, season=2026, season_type=2,
        start_time_utc=start, game_date=day, home_team_id=1, away_team_id=2,
        completed=0, status="STATUS_SCHEDULED")
    kw = dict(espn_event_id=eid, league=league, game_date=day, home_team_id=1, away_team_id=2,
              home_prob=home_prob, away_prob=round(1 - home_prob, 4), home_spread=6.0,
              total_pred=45.5, home_total_pred=19.8, away_total_pred=25.7,
              player_prob_base=0.47, player_spread_base=6.0, player_total_base=45.5,
              player_home_total_base=19.8, player_away_total_base=25.7,
              home_player_x=0.0, away_player_x=0.0, elo_weight=0.0, p_logit=0.47,
              player_inputs="stale", snapshot_date=snap or day)
    _ins(c, table, **kw)
    if locked:
        _ins(c, "forecast_locks", espn_event_id=eid, league=league,
             locked_at=AS_OF, home_prob=home_prob, home_spread=0.0, total_pred=200.0)


def _row(c, table, eid):
    return c.execute(
        f"SELECT home_prob, home_spread, total_pred, nfl_model_src FROM {table} "
        "WHERE espn_event_id = ?", (eid,)).fetchone()


def test_refresh_leaves_past_rows_locks_and_other_leagues():
    c = _db()
    _teams(c)
    _store_fit(c)
    _state(c)
    _gsis(c, 11, "00-0033873")
    _gsis(c, 22, "00-0034796")
    now_day = "2026-11-22"
    _snap(c, "forecast_snapshots", 100, "nfl", now_day, "2026-11-22T20:00:00Z", 0.11)
    _snap(c, "forecast_snapshots", 101, "nfl", now_day, "2026-11-22T18:03:00Z", 0.11)
    _snap(c, "forecast_snapshots", 102, "nfl", "2026-11-21", "2026-11-21T20:00:00Z", 0.11,
          snap="2026-11-21")
    _snap(c, "forecast_snapshots", 103, "nfl", now_day, "2026-11-22T23:00:00Z", 0.11, locked=True)
    _snap(c, "upcoming_forecasts", 104, "nfl", "2026-11-29", "2026-11-29T18:00:00Z", 0.11)
    _snap(c, "forecast_snapshots", 200, "nba", now_day, "2026-11-22T20:00:00Z", 0.3333)
    for eid in (100, 104):
        _lineup(c, eid, 1, 11)
        _lineup(c, eid, 2, 22)
    before = {eid: _row(c, "forecast_snapshots", eid) for eid in (101, 102, 103, 200)}
    now = datetime(2026, 11, 22, 18, 0, tzinfo=timezone.utc)
    out = nf.refresh(c, now, log=lambda *_: None)
    assert out == 2
    live = _row(c, "forecast_snapshots", 100)
    assert live["nfl_model_src"] == "ridge_qb" and live["home_prob"] == 0.7
    assert live["home_spread"] < 0 and live["total_pred"] == 45.5
    soon = _row(c, "upcoming_forecasts", 104)
    assert soon["nfl_model_src"] == "ridge_qb" and soon["home_prob"] == 0.7
    assert soon["total_pred"] == 45.5
    for eid, old in before.items():
        assert _row(c, "forecast_snapshots", eid) == old
    assert nf.refresh(c, now, log=lambda *_: None) is None
    assert _row(c, "forecast_snapshots", 200) == before[200]


def test_refit_due_and_morning_keeps_going():
    c = _db()
    # nothing stored: any day, including Monday
    assert nf.refit_due(c, date(2026, 11, 23))
    assert nf.refit_due(c, date(2026, 11, 24))
    note = nf.morning(c, date(2026, 11, 24), log=lambda *_: None)
    assert "skipped" in note and "state 0" in note
    _store_fit(c)                                       # fit_date 2026-11-16
    assert nf.refit_due(c, date(2026, 11, 24))          # Tuesday, last fit is older
    assert not nf.refit_due(c, date(2026, 11, 23))      # Monday keeps the stored fit
    c.execute("UPDATE nfl_ridge_fits SET fit_date = '2026-11-24'")
    assert not nf.refit_due(c, date(2026, 11, 24))      # already stored today


def _sched_csv():
    return (
        "game_id,season,week,game_type,gameday,home_team,away_team,home_score,away_score,"
        "espn,home_qb_id,away_qb_id,spread_line,total,total_line,home_moneyline,away_moneyline\n"
        "2024_01_KC_BAL,2024,1,REG,2024-09-05,KC,BAL,27,20,401671789,00-1,00-2,-3.5,47.5,47.5,-150,130\n"
        "1999_01_STL_OAK,2006,1,REG,2006-09-10,STL,OAK,10,7,1,00-3,00-4,3,41,41,120,-140\n"
        "2005_01_X_Y,2005,1,REG,2005-09-11,NYG,DAL,1,0,2,a,b,1,1,1,1,-1\n"
    ).encode()


def test_schedule_keeps_nflverse_lines_out_of_the_table():
    c = _db()
    body = _sched_csv()
    assert nfl_pbp.replace_schedule(c, body) == 2
    rows = {r["game_id"]: r for r in c.execute("SELECT * FROM nfl_schedule")}
    kc = rows["2024_01_KC_BAL"]
    assert kc["home_franchise"] == "KC" and kc["home_score"] == 27
    assert kc["home_qb_gsis"] == "00-1" and kc["espn_event_id"] == 401671789
    assert rows["1999_01_STL_OAK"]["home_franchise"] == "LA"
    assert rows["1999_01_STL_OAK"]["away_franchise"] == "LV"
    stored = [v for r in rows.values() for v in tuple(r)]
    assert -3.5 not in stored and -150 not in stored and 47.5 not in stored
    assert nfl_pbp.replace_schedule(c, body) == 0
    assert c.execute("SELECT COUNT(*) FROM nfl_schedule").fetchone()[0] == 2
    with pytest.raises(ValueError):
        nfl_pbp.replace_schedule(c, b"no,header,here\n1,2,3\n")
    assert c.execute("SELECT COUNT(*) FROM nfl_schedule").fetchone()[0] == 2


def _pbp_bytes(dropback=1, epa=0.4):
    df = pd.DataFrame({
        "game_id": ["2024_01_KC_BAL"], "season": [2024], "game_date": ["2024-09-05"],
        "posteam": ["KC"], "play_type": ["pass"], "epa": [epa], "qb_dropback": [dropback],
        "passer_player_id": ["00-1"], "rusher_player_id": [None], "cpoe": [3.0],
    })
    buf = io.BytesIO()
    df.to_parquet(buf)
    return buf.getvalue()


def test_bad_pbp_does_not_delete():
    c = _db()
    body = _pbp_bytes()
    assert nfl_pbp.replace_season(c, 2024, body) == 1
    assert nfl_pbp.replace_season(c, 2024, body) == 0
    with pytest.raises(ValueError):
        nfl_pbp.replace_season(c, 2024, b"this is not a parquet")
    assert c.execute("SELECT COUNT(*) FROM nfl_pbp_qb").fetchone()[0] == 1
    with pytest.raises(ValueError):
        nfl_pbp.replace_season(c, 2024, _pbp_bytes(dropback=0))
    row = c.execute("SELECT qb_epa, qb_n FROM nfl_pbp_qb").fetchone()
    assert row["qb_n"] == 1 and abs(row["qb_epa"] - 0.4) < 1e-9


def test_missing_current_season_skips():
    c = _db()

    def fetch(url):
        if url.endswith("/robots.txt"):
            return b"User-agent: *\nAllow: /\n"
        raise Missing(f"404 {url}")

    got = nfl_pbp.refresh_season(c, Pacer(0), fetch, 2099, log=lambda *_: None, required=False)
    assert got["skipped_season"] == 2099
    with pytest.raises(Missing):
        nfl_pbp.refresh_season(c, Pacer(0), fetch, 2006, log=lambda *_: None, required=True)
    off = nfl_pbp.current_pass(c, Pacer(0), log=lambda *_: None, today=date(2026, 3, 1))
    assert off["skipped"] == "no NFL games in window"


def test_overlay_logs_the_team_fallback(monkeypatch, caplog):
    frame = pd.DataFrame({
        "espn_event_id": [9001, 9002], "home_prob": [0.61, 0.55],
        "home_spread": [-3.0, 2.0], "total_pred": [45.0, 44.0],
        "home_total_pred": [24.0, 21.0], "away_total_pred": [21.0, 23.0],
    })

    def slate_broke(*_a, **_k):
        raise RuntimeError("slate broke")

    monkeypatch.setattr(nf, "_prepare_slate", slate_broke)
    with caplog.at_level(logging.WARNING, logger="bayesratings.nfl_player"):
        out = nf.overlay(None, frame, AS_OF)
    assert list(out["nfl_model_src"]) == ["team", "team"]
    assert abs(float(out.loc[0, "home_prob"]) - 0.61) < 1e-6
    assert "nfl player fallback event 9001: RuntimeError: slate broke" in caplog.text
    assert "nfl player fallback event 9002: RuntimeError: slate broke" in caplog.text

    caplog.clear()
    monkeypatch.setattr(nf, "_prepare_slate", lambda *_a, **_k: {})

    def row_broke(*_a, **_k):
        raise ValueError("row broke")

    monkeypatch.setattr(nf, "_score_row", row_broke)
    with caplog.at_level(logging.WARNING, logger="bayesratings.nfl_player"):
        out = nf.overlay(None, frame, AS_OF)
    assert list(out["nfl_model_src"]) == ["team", "team"]
    assert "nfl player fallback event 9001: ValueError: row broke" in caplog.text
    assert "nfl player fallback event 9002: ValueError: row broke" in caplog.text


def _sched_game(c, gid, season, day, gtype, home, away, hs, aws, eid, hqb="00-H", aqb="00-A"):
    _ins(c, "nfl_schedule", game_id=gid, season=season, week=1, game_type=gtype,
         game_date=day, home_franchise=home, away_franchise=away,
         home_qb_gsis=hqb, away_qb_gsis=aqb, espn_event_id=eid,
         home_score=hs, away_score=aws)


def _snap_chance(c, eid, day, home_prob):
    _ins(c, "forecast_snapshots", snapshot_date=day, league="nfl", espn_event_id=eid,
         game_date=day, home_prob=home_prob)


def _hist_chance(c, gid, eid, day, p):
    _ins(c, "nfl_team_chance_hist", game_id=gid, espn_event_id=eid, game_date=day,
         p=p, model_version="map-base-hl180-w05-v1", created_at=AS_OF)


def test_training_frame_uses_hist_before_the_snapshot_date():
    c = _db()
    _ins(c, "nfl_pbp_qb", game_id="g2006", season=2006, game_date="2006-09-10",
         team="KC", qb="00-H", qb_epa=1.0, qb_n=10, cpoe_sum=-1.0, cpoe_n=8)
    _sched_game(c, "g2006", 2006, "2006-09-10", "REG", "KC", "BUF", 21, 14, 1)
    _hist_chance(c, "g2006", 1, "2006-09-10", 0.40)
    _sched_game(c, "gpre", 2008, "2008-08-10", "PRE", "KC", "BUF", 21, 14, 2)
    _hist_chance(c, "gpre", 2, "2008-08-10", 0.40)
    _sched_game(c, "ghist", 2010, "2010-09-12", "REG", "KC", "BUF", 24, 17, 3)
    _hist_chance(c, "ghist", 3, "2010-09-12", 0.33)
    _sched_game(c, "gboth", 2011, "2011-09-11", "REG", "BUF", "KC", 17, 24, 4)
    _hist_chance(c, "gboth", 4, "2011-09-11", 0.11)
    _snap_chance(c, 4, "2011-09-11", 0.62)
    _sched_game(c, "gsnap", 2025, "2025-09-04", "REG", "KC", "BUF", 27, 20, 5)
    _hist_chance(c, "gsnap", 5, "2025-09-04", 0.20)
    _snap_chance(c, 5, "2025-09-04", 0.71)
    _sched_game(c, "gonly", 2025, "2025-09-07", "REG", "BUF", "KC", 10, 20, 6)
    _hist_chance(c, "gonly", 6, "2025-09-07", 0.80)
    _sched_game(c, "gtie", 2012, "2012-09-09", "REG", "KC", "BUF", 17, 17, 7)
    _hist_chance(c, "gtie", 7, "2012-09-09", 0.50)
    frame = nf.load_training_frame(c, "2026-01-01")
    got = dict(zip(frame["game_id"], frame["lt"]))
    assert set(got) == {"ghist", "gboth", "gsnap"}
    assert abs(got["ghist"] - nf.logit(0.33)) < 1e-9
    assert abs(got["gboth"] - nf.logit(0.62)) < 1e-9
    assert abs(got["gsnap"] - nf.logit(0.71)) < 1e-9


def test_refit_logs_n_c_and_coefs(monkeypatch):
    c = _db()
    packed = {
        "n_games": 5311, "c_value": 0.1, "features": FEATURES,
        "coef": [0.74, 3.32, -0.03, 0.07, -0.13],
        "scaler_mean": [0.0] * 5, "scaler_scale": [1.0] * 5,
        "intercept": 0.0, "sklearn_version": "1.9.1",
    }
    monkeypatch.setattr(nf, "load_training_frame", lambda *_a, **_k: pd.DataFrame({"y": [1]}))
    monkeypatch.setattr(nf, "fit_matrix", lambda *_a, **_k: packed)
    lines = []
    out = nf.refit(c, date(2026, 11, 23), log=lines.append)
    assert out == lines[0]
    assert "n=5311" in out and "c=0.1" in out
    assert "lt 0.74" in out and "qbA_epa_d 3.32" in out
    assert "qbA_cpoe_d -0.03" in out and "qbA_exp_d 0.07" in out and "chg_d -0.13" in out
    row = c.execute("SELECT n_games, train_from FROM nfl_ridge_fits").fetchone()
    assert row["n_games"] == 5311 and row["train_from"] == "2007"


def test_maybe_refit_runs_only_when_completed_games_change(monkeypatch):
    c = _db()
    seen = []
    monkeypatch.setattr(nf, "after_games", lambda conn, today=None, log=print: seen.append(today) or "refit note")
    before = nfl_pbp._data_token(c)
    skipped = nfl_pbp.maybe_refit(c, before, {"errors": 0}, today=date(2026, 11, 23), log=lambda *_: None)
    assert seen == [] and "refit" not in skipped
    _sched_game(c, "g1", 2026, "2026-11-22", "REG", "KC", "BUF", 20, 17, 50)
    erred = nfl_pbp.maybe_refit(c, before, {"errors": 1}, today=date(2026, 11, 23), log=lambda *_: None)
    assert seen == [] and "refit" not in erred
    ran = nfl_pbp.maybe_refit(c, before, {"errors": 0}, today=date(2026, 11, 23), log=lambda *_: None)
    assert seen == [date(2026, 11, 23)] and ran["refit"] == "refit note"
    again = nfl_pbp.maybe_refit(c, nfl_pbp._data_token(c), {"errors": 0}, log=lambda *_: None)
    assert len(seen) == 1 and "refit" not in again


def test_ridge_alert_names_a_large_gap_or_a_favorite_flip():
    from bayesratings.sources import check
    c = _db()
    _teams(c)
    _ins(c, "teams", team_id=3, league="nfl", espn_id=6, abbreviation="DAL", name="Cowboys")

    def add(eid, ridge, team, home=1, away=2, completed=0):
        _ins(c, "games", game_id=eid, espn_event_id=eid, league="nfl", season=2026,
             start_time_utc="2026-11-23T20:00:00Z", game_date="2026-11-23",
             home_team_id=home, away_team_id=away, completed=completed, status="scheduled")
        _ins(c, "forecast_snapshots", snapshot_date="2026-11-23", league="nfl",
             espn_event_id=eid, game_date="2026-11-23", home_team_id=home, away_team_id=away,
             nfl_model_src="ridge_qb", nfl_ridge_prob=ridge, nfl_team_prob=team)

    add(1, 0.68, 0.80)                       # 12 points, same favorite
    add(2, 0.48, 0.52, home=3)               # favorite flips, under 10 points
    add(3, 0.60, 0.50)                       # exactly 10 points, same side
    add(4, 0.90, 0.40, completed=1)          # already played
    msg = check.nfl_ridge_alerts(c, "2026-11-23")
    assert "BUF@KC" in msg and "12.0 pts" in msg
    assert "BUF@DAL" in msg and "favorite flips" in msg
    assert msg.count("BUF@KC") == 1
    assert check.nfl_ridge_alerts(c, "2026-11-22") is None
