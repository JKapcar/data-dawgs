"""Player-level adjustment (bayesratings/player_adj.py): the coefficient
math and the exact published shift, no lookahead, who counts as out for
each league, the no-information fallback, the audit columns and the
intraday refresh.
Run: PYTHONPATH=. python -m pytest tests/test_player_adj.py"""
import sqlite3
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from bayesratings import daily, db, player_adj as pa

AS_OF = "2026-10-20T16:00:00+00:00"
TODAY = "2026-10-20"


def _db():
    c = sqlite3.connect(":memory:")
    db.init_db(c)
    c.execute("PRAGMA foreign_keys = OFF")             # synthetic teams
    return c


def _ins(c, table, **kw):
    """Insert a row, filling other NOT NULL columns without a default."""
    for _, name, typ, notnull, dflt, _pk in c.execute(f"PRAGMA table_info({table})"):
        if notnull and dflt is None and name not in kw:
            kw[name] = 0 if "INT" in (typ or "").upper() or "REAL" in (typ or "").upper() else \
                (kw.get("valid_from", "x") if name == "last_seen" else "x")
    cols = ", ".join(kw)
    c.execute(f"INSERT INTO {table} ({cols}) VALUES ({', '.join('?' * len(kw))})", list(kw.values()))


def _game(c, eid, league, day, home, away, completed=1, start="23:00", season=2026):
    _ins(c, "games", espn_event_id=eid, league=league, season=season, season_type=2,
         start_time_utc=f"{day}T{start}Z", game_date=day, home_team_id=home,
         away_team_id=away, completed=completed, status="STATUS_FINAL" if completed else "STATUS_SCHEDULED")


def _days(n, end=TODAY):
    return [d.date().isoformat() for d in pd.date_range(end=pd.Timestamp(end) - pd.Timedelta(days=1), periods=n)]


def _nba_history(c, n=30, star_minutes=36):
    """Teams 1 and 2 play every day; athlete 10 is team 1's star."""
    for i, d in enumerate(_days(n)):
        eid = 1000 + i
        _game(c, eid, "nba", d, 1, 2)
        for team, opp, players in ((1, 2, (10, 11, 12)), (2, 1, (20, 21, 22))):
            for a in players:
                star = a == 10
                _ins(c, "player_game_nba", espn_event_id=eid, season=2026, season_type=2, game_date=d,
                     team_id=team, opp_team_id=opp, is_home=int(team == 1), athlete_id=a, starter=1,
                     did_not_play=0, minutes=star_minutes if star else 24, pts=30 if star else 10,
                     fgm=11 if star else 4, fga=20 if star else 9, ftm=6 if star else 2, fta=7 if star else 2,
                     oreb=1, dreb=6, ast=6 if star else 2, tov=2, stl=1, blk=1, pf=2, stats_json="{}")


def _sched(c, league, eid, home, away, day=TODAY, season=2026):
    _game(c, eid, league, day, home, away, completed=0, season=season)
    return pd.DataFrame({"espn_event_id": [eid], "season": [season], "date": [day],
                         "home_team": [str(home)], "away_team": [str(away)]})


def _base(n=1, p=0.55, spread=-2.5, total=220.0):
    return pd.DataFrame({"home_prob": [p] * n, "away_prob": [1 - p] * n, "home_spread": [spread] * n,
                         "away_spread": [-spread] * n, "total_pred": [total] * n,
                         "home_total_pred": [total / 2 + 1.25] * n,
                         "away_total_pred": [total / 2 - 1.25] * n})


def _with_x(league, xh, xa, xh2=None, xa2=None, **kw):
    f = _base(**kw)
    for c in pa.AUDIT_COLS:
        f[c] = None
    f["player_prob_base"], f["player_spread_base"] = f.home_prob, f.home_spread
    f["player_total_base"] = f.total_pred
    f["player_home_total_base"], f["player_away_total_base"] = f.home_total_pred, f.away_total_pred
    f["home_player_x"], f["away_player_x"] = xh, xa
    f["home_player_x2"], f["away_player_x2"] = xh2, xa2
    return f


# ------------------------------------------------------------------ math

def test_zero_or_missing_x_leaves_forecast_unchanged():
    for xh, xa in ((0.0, 0.0), (None, None)):
        f = pa.shift(_with_x("nba", xh, xa), "nba", [0.5], p_elo=[0.6])
        assert f.loc[0, "home_spread"] == -2.5 and f.loc[0, "total_pred"] == 220.0
        assert f.loc[0, "home_total_pred"] == 111.25
        assert abs(f.loc[0, "home_prob"] - (0.5 * 0.55 + 0.5 * 0.6)) < 1e-4


def test_published_chance_moves_by_the_backtested_logit_shift():
    xh, xa, w, pe = 3.0, -2.0, 0.5, 0.6
    f = pa.shift(_with_x("nba", xh, xa), "nba", [w], p_elo=[pe])
    b = pa.COEFS["nba"]["win"][0]
    pub0 = (1 - w) * 0.55 + w * pe
    want = 1 / (1 + np.exp(-(np.log(pub0 / (1 - pub0)) + b * (xh - xa))))
    assert abs(f.loc[0, "home_prob"] - want) < 2e-4
    # the change goes through the logit chance: published = stack of it
    assert abs(f.loc[0, "home_prob"] - ((1 - w) * f.loc[0, "p_logit"] + w * pe)) < 1e-4
    c, m = pa.COEFS["nba"]["total"][0], pa.COEFS["nba"]["margin"][0]
    assert f.loc[0, "total_pred"] == round(220 + c * (xh + xa), 1)
    assert f.loc[0, "home_spread"] == round(-(2.5 + m * (xh - xa)), 1)
    assert abs(f.loc[0, "home_total_pred"] + f.loc[0, "away_total_pred"] - f.loc[0, "total_pred"]) < 0.11


def test_elo_fallback_uses_the_plain_logit_shift():
    f = pa.shift(_with_x("nfl", 10.0, 0.0), "nfl", [0.0], p_elo=[np.nan])
    b = pa.COEFS["nfl"]["win"][0]
    want = 1 / (1 + np.exp(-(np.log(0.55 / 0.45) + b * 10)))
    assert abs(f.loc[0, "home_prob"] - want) < 1e-4 and f.loc[0, "home_prob"] == f.loc[0, "p_logit"]


def test_nfl_player_term_does_not_pin_the_logit_chance():
    """A large NFL shift used to solve p_logit to 0 or 1. It now moves the
    blended chance and leaves p_logit at the team chance."""
    b = pa.COEFS["nfl"]["win"][0]
    w = 0.8315
    cases = ((0.70, 0.80, 40.0), (0.30, 0.20, -40.0))
    for p0, pe, xd in cases:
        f = pa.shift(_with_x("nfl", xd, 0.0, p=p0), "nfl", [w], p_elo=[pe])
        pub0 = (1 - w) * p0 + w * pe
        want = 1 / (1 + np.exp(-(np.log(pub0 / (1 - pub0)) + b * xd)))
        pl = float(f.loc[0, "p_logit"])
        assert pl == round(p0, 4)
        assert 0 < pl < 1 and pl not in (0.0001, 0.9999)
        assert abs(float(f.loc[0, "home_prob"]) - want) < 2e-4


def test_mlb_uses_lineup_and_bullpen_terms():
    f1 = pa.shift(_with_x("mlb", 0.2, 0.0, 0.0, 0.0, total=8.5), "mlb", [0.0], p_elo=[np.nan])
    f2 = pa.shift(_with_x("mlb", 0.2, 0.0, 0.1, 0.0, total=8.5), "mlb", [0.0], p_elo=[np.nan])
    assert f2.loc[0, "home_prob"] > f1.loc[0, "home_prob"] > 0.55
    assert f1.loc[0, "total_pred"] == round(8.5 + pa.COEFS["mlb"]["total"][0] * 0.2, 1)


def _report(c, eid, team, athlete, status, vf="2026-10-20T15:00:00+00:00", vt=None):
    _ins(c, "nba_injury_states", game_date=TODAY, team_name="T", player_key=str(athlete), team_id=team,
         espn_event_id=eid, athlete_id=athlete, status=status, report_slot=vf[:16],
         valid_from=vf, valid_to=vt)


def test_nba_star_listed_out_lowers_team_value_questionable_does_not():
    c = _db()
    _nba_history(c)
    s = _sched(c, "nba", 5000, 1, 2)
    assert pa.player_values(c, "nba", s, AS_OF).loc[0, "home_player_src"] is None   # no report yet
    _report(c, 5000, 2, 21, "Questionable")
    v0 = pa.player_values(c, "nba", s, AS_OF)
    assert v0.loc[0, "home_player_src"] == "report"
    _report(c, 5000, 1, 10, "Out")
    v1 = pa.player_values(c, "nba", s, AS_OF)
    assert v1.loc[0, "home_player_x"] < v0.loc[0, "home_player_x"] - 1
    assert v1.loc[0, "away_player_x"] == v0.loc[0, "away_player_x"]     # Questionable not counted
    # a report state first seen after the forecast time is not known yet
    v2 = pa.player_values(c, "nba", s, "2026-10-20T14:00:00+00:00")
    assert v2.loc[0, "home_player_src"] is None


def test_no_lookahead_same_day_and_later_lines_do_not_matter():
    c = _db()
    _nba_history(c)
    s = _sched(c, "nba", 5000, 1, 2)
    _report(c, 5000, 1, 10, "Out")
    a = pa.player_values(c, "nba", s, AS_OF)
    # a huge game for the star today and tomorrow (box lines can't exist yet)
    for eid, d in ((7000, TODAY), (7001, "2026-10-21")):
        _ins(c, "player_game_nba", espn_event_id=eid, season=2026, season_type=2, game_date=d, team_id=1,
             opp_team_id=2, is_home=1, athlete_id=10, starter=1, did_not_play=0, minutes=48, pts=80,
             fgm=30, fga=35, stats_json="{}")
    b = pa.player_values(c, "nba", s, AS_OF)
    assert a.loc[0, "home_player_x"] == b.loc[0, "home_player_x"]


# ------------------------------------------------------------------ NFL

def _nfl_history(c):
    for i, d in enumerate(_days(6, "2026-10-20")):
        eid = 3000 + i
        _game(c, eid, "nfl", d, 61, 62)
        for team, qb, yds in ((61, 100, 300), (62, 200, 200)):
            _ins(c, "player_game_nfl_passing", espn_event_id=eid, season=2026, season_type=2, game_date=d,
                 team_id=team, opp_team_id=123 - team, is_home=int(team == 61), athlete_id=qb, qb_starter=1,
                 att=35, yds=yds, td=2, ints=1, sacks=2, sack_yds=12, stats_json="{}")


def _depth(c, team, athlete, depth, vf="2026-10-19T12:00:00+00:00"):
    _ins(c, "nfl_depth_states", league="nfl", team_id=team, formation="3WR 1TE", slot="qb", depth=depth,
         athlete_id=athlete, position="QB", state_hash="x", valid_from=vf, last_seen=vf)


def test_nfl_depth_chart_qb_skips_players_out_and_falls_back_to_last_starter():
    c = _db()
    _nfl_history(c)
    s = _sched(c, "nfl", 6000, 61, 62, day="2026-10-25")
    v = pa.player_values(c, "nfl", s, AS_OF)
    assert (v.loc[0, "home_player_id"], v.loc[0, "home_player_src"]) == (100, "last")
    usual = v.loc[0, "home_player_x"]
    _depth(c, 61, 100, 1)
    _depth(c, 61, 101, 2)                                  # backup, no history
    _ins(c, "nfl_injury_report_states", league="nfl", season=2026, game_type="REG", week=7, team="X",
         team_id=61, athlete_id=100, report_status="Out", state_hash="x",
         valid_from="2026-10-17T12:00:00+00:00", last_seen="2026-10-19T12:00:00+00:00")
    v = pa.player_values(c, "nfl", s, AS_OF)
    assert v.loc[0, "home_player_id"] == 100               # last week's report: ignored
    c.execute("UPDATE nfl_injury_report_states SET valid_from = '2026-10-20T12:00:00+00:00'")
    v = pa.player_values(c, "nfl", s, AS_OF)
    assert (v.loc[0, "home_player_id"], v.loc[0, "home_player_src"]) == (101, "depth")
    assert v.loc[0, "home_player_x"] < usual - 10         # unknown backup vs a good starter


# ------------------------------------------------------------------ MLB

def test_mlb_posted_lineup_beats_usual_lineup():
    c = _db()
    for i, d in enumerate(_days(5)):
        eid = 8000 + i
        _game(c, eid, "mlb", d, 17, 27)
        for team in (17, 27):
            for slot in range(1, 10):
                aid = team * 100 + slot
                _ins(c, "player_game_mlb_batting", espn_event_id=eid, season=2026, season_type=2, game_date=d,
                     team_id=team, opp_team_id=44 - team, is_home=int(team == 17), athlete_id=aid, starter=1,
                     bat_order=slot, box_order=slot, ab=4, h=2 if slot == 1 else 1, hr=0, bb=0, stats_json="{}")
    s = _sched(c, "mlb", 9000, 17, 27)
    v = pa.player_values(c, "mlb", s, AS_OF)
    assert v.loc[0, "home_player_src"] == "usual"
    usual = v.loc[0, "home_player_x"]
    for slot in range(1, 10):                              # posted: leadoff star sits
        aid = 1799 if slot == 1 else 1700 + slot
        _ins(c, "mlb_lineup_states", league="mlb", game_pk=1, espn_event_id=9000, side="home", slot=slot,
             team_id=17, athlete_id=aid, state_hash="x", valid_from="2026-10-20T15:00:00+00:00",
             last_seen="2026-10-20T15:00:00+00:00")
    v = pa.player_values(c, "mlb", s, AS_OF)
    assert v.loc[0, "home_player_src"] == "posted" and v.loc[0, "home_player_x"] < usual
    assert v.loc[0, "away_player_src"] == "usual"


# ------------------------------------------------------------------ NHL

def test_nhl_lines_mark_missing_skaters():
    c = _db()
    for i, d in enumerate(_days(20)):
        eid = 4000 + i
        _game(c, eid, "nhl", d, 101, 102)
        for team in (101, 102):
            for k in range(18):
                aid = team * 100 + k
                _ins(c, "player_game_nhl_skater", espn_event_id=eid, season=2027, season_type=2, game_date=d,
                     team_id=team, opp_team_id=203 - team, is_home=int(team == 101), athlete_id=aid,
                     position="D" if k >= 12 else "C", toi_sec=1500 if k == 0 else 900,
                     g=1 if k == 0 else 0, shots=5 if k == 0 else 1, stats_json="{}")
    s = _sched(c, "nhl", 4500, 101, 102, season=2027)
    vf = "2026-10-20T12:00:00+00:00"
    for team in (101, 102):
        for k in range(18):
            aid = team * 100 + k
            if team == 101 and k == 0:
                aid = 10199                                # the top scorer is out of the lines
            _ins(c, "nhl_line_states", dfo_team_id=team, team_id=team, group_id=f"f{k // 3 + 1}" if k < 12 else
                 f"d{(k - 12) // 2 + 1}", dfo_player_id=aid, athlete_id=aid, state_hash="x",
                 valid_from=vf, last_seen=vf)
    v = pa.player_values(c, "nhl", s, AS_OF)
    assert v.loc[0, "home_player_src"] == "lines"
    assert v.loc[0, "home_player_x"] < v.loc[0, "away_player_x"]


# ------------------------------------------------------- columns + refresh

def test_audit_columns_migrated_and_saved():
    c = _db()
    for t in ("forecast_snapshots", "upcoming_forecasts"):
        have = {r[1] for r in c.execute(f"PRAGMA table_info({t})")}
        assert set(pa.AUDIT_COLS) <= have, t
    assert set(pa.AUDIT_COLS) <= set(daily.AUDIT_COLS)
    vals = daily._audit_values({"player_inputs": "2026-10-20|a", "home_player_id": 7.0,
                                "home_player_src": "depth", "home_player_x": 1})
    got = dict(zip(daily.AUDIT_COLS, vals))
    assert got["player_inputs"] == "2026-10-20|a" and got["home_player_id"] == 7
    assert got["home_player_src"] == "depth" and got["home_player_x"] == 1.0


def test_refresh_reapplies_new_report_and_skips_started_games():
    c = _db()
    _nba_history(c)
    s = _sched(c, "nba", 5000, 1, 2)
    _game(c, 5001, "nba", TODAY, 1, 2, completed=0, start="16:02")     # starts in 2 minutes
    s2 = pd.concat([s, s.assign(espn_event_id=5001)], ignore_index=True)
    f = _base(n=2)
    f = pa.adjust_forecast(c, "nba", s2, f, AS_OF)
    f["p_logit"], f["p_elo"], f["elo_weight"] = f["home_prob"], 0.6, 0.5
    f["model_version"] = "t"
    f = pa.restack(f, "nba")
    res = {"forecast": f, "ratings": pd.Series({"1": 0.0, "2": 0.0}), "home_adv": 0.0, "rating_season": 2026,
           "fit": None}
    import bayesratings.publish as pub
    orig = pub.rating_uncertainty
    pub.rating_uncertainty = lambda r: pd.DataFrame({"rating_sd": 0.1, "rating_q05": 0.0, "rating_q95": 0.0},
                                                     index=r["ratings"].index)
    try:
        pub.save_snapshot(c, TODAY, "nba", res, s2)
    finally:
        pub.rating_uncertainty = orig
    row0 = c.execute("SELECT rowid, home_prob, home_player_src FROM forecast_snapshots "
                     "WHERE espn_event_id = 5000").fetchone()
    assert row0[2] is None                                 # no report at 6 AM
    now = datetime(2026, 10, 20, 16, 0, tzinfo=timezone.utc)
    assert pa.refresh(c, ("nba",), now, log=lambda *_: None) == {}     # inputs unchanged
    _report(c, 5000, 1, 10, "Out")
    out = pa.refresh(c, ("nba",), now, log=lambda *_: None)
    assert out == {"nba": 1}
    row1 = c.execute("SELECT rowid, home_prob, home_player_src, p_logit, elo_weight, p_elo "
                     "FROM forecast_snapshots WHERE espn_event_id = 5000").fetchone()
    assert row1[2] == "report" and row1[1] < row0[1] and row1[0] > row0[0]   # new rowid: cache sees it
    assert abs(row1[1] - (0.5 * row1[3] + 0.5 * 0.6)) < 1e-4
    late = c.execute("SELECT home_player_src FROM forecast_snapshots WHERE espn_event_id = 5001").fetchone()
    assert late[0] is None                                 # about to start: left alone
    assert pa.refresh(c, ("nba",), now, log=lambda *_: None) == {}     # nothing new


def test_refresh_runs_in_the_pregame_and_nba_report_jobs():
    from bayesratings.sources import runner
    assert runner.KINDS["pregame"][-1] == "players"
    assert runner.KINDS["nbainj"] == ("nba_injury", "nba_lineups", "players_nba")   # players_nba last
