"""Starting pitcher / goalie adjustment (bayesratings/starters.py):
no lookahead, the no-starter fallback, coefficient application, source
priority, the audit columns and their migration.
Run: PYTHONPATH=. python -m pytest tests/test_starters.py"""
import re
import sqlite3
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from bayesratings import daily, db, starters

SCHEMA = Path(__file__).resolve().parents[1] / "bayesratings" / "schema.sql"
AS_OF = "2026-10-17T11:00:00+00:00"


def _lines(n_days=40, seed=0):
    """Synthetic NHL goalie lines: two teams, two goalies each, one game a day."""
    rng = np.random.default_rng(seed)
    rows = []
    for d in range(n_days):
        day = (pd.Timestamp("2026-01-01") + pd.Timedelta(days=d)).date().isoformat()
        for team, opp, goalies in ((1, 2, (11, 12)), (2, 1, (21, 22))):
            g = goalies[d % 2]
            sa = int(rng.integers(20, 40))
            rows.append({"espn_event_id": 1000 + d, "game_date": day, "team_id": team,
                         "athlete_id": g, "ord": 1, "sa": sa,
                         "ga": int(rng.integers(0, 6)), "start": 1, "pseudo": 0})
    return pd.DataFrame(rows)


def test_no_lookahead_future_and_same_day_lines_do_not_matter():
    lines = _lines()
    cut = "2026-01-30"
    st = starters.quality(lines, "nhl")
    a = st[st["game_date"] == cut].set_index("team_id")[["q", "rel"]]
    # wreck every line from the cut day on: pre-game values must not move
    later = lines["game_date"] >= cut
    lines2 = lines.copy()
    lines2.loc[later, "ga"] = lines2.loc[later, "sa"]
    st2 = starters.quality(lines2, "nhl")
    b = st2[st2["game_date"] == cut].set_index("team_id")[["q", "rel"]]
    pd.testing.assert_frame_equal(a, b)


def test_pseudo_row_matches_backtest_value():
    """An upcoming starter (zero-stat pseudo row) gets exactly the pre-game
    number the backtest computed for a real start that day."""
    lines = _lines()
    day = "2026-02-09"                         # last day in the data
    real = starters.quality(lines, "nhl")
    real = real[real["game_date"] == day].set_index("team_id")
    hist = lines[lines["game_date"] < day]
    ps = starters.pseudo_lines(lines[lines["game_date"] == day], "nhl")
    st = starters.quality(pd.concat([hist, ps], ignore_index=True), "nhl")
    st = st[st["pseudo"] == 1].set_index("team_id")
    assert np.allclose(st.loc[real.index, "q"], real["q"])
    assert np.allclose(st.loc[real.index, "rel"], real["rel"])


def test_apply_adjustment_math():
    f = pd.DataFrame({"home_prob": [0.5, 0.6], "away_prob": [0.5, 0.4],
                      "home_spread": [-0.5, -1.0], "away_spread": [0.5, 1.0],
                      "total_pred": [8.0, 6.0], "home_total_pred": [4.25, 3.5],
                      "away_total_pred": [3.75, 2.5], "home_odds": [100, -150],
                      "away_odds": [-100, 150]})
    c = {"win": 0.5, "total": 0.25}
    out = starters.apply_adjustment(f, [1.0, 0.0], [0.0, 0.0], c)
    assert abs(out.loc[0, "home_prob"] - round(1 / (1 + np.exp(-0.5)), 4)) < 1e-9
    assert out.loc[0, "total_pred"] == 7.8            # 8 - 0.25 * (1 + 0)
    assert out.loc[0, "home_spread"] == -0.8           # margin 0.5 + 0.25 * 1
    assert abs(out.loc[0, "home_total_pred"] + out.loc[0, "away_total_pred"] - 7.8) < 0.11
    assert out.loc[0, "away_prob"] == round(1 - out.loc[0, "home_prob"], 4)
    assert out.loc[0, "home_prob_base"] == 0.5 and out.loc[0, "total_pred_base"] == 8.0
    # no starter on either side: the game is untouched
    for col in ("home_prob", "away_prob", "home_spread", "total_pred",
                "home_total_pred", "away_total_pred", "home_odds"):
        assert out.loc[1, col] == f.loc[1, col], col
    # a better away starter lowers the home side
    out2 = starters.apply_adjustment(f, [0.0, 0.0], [1.0, 1.0], c)
    assert (out2["home_prob"] < f["home_prob"]).all()
    assert (out2["home_spread"] > f["home_spread"]).all()


def _probe_db():
    c = sqlite3.connect(":memory:")
    c.executescript(SCHEMA.read_text())
    db._migrate(c)
    lines = _lines()
    for r in lines.itertuples():
        c.execute("INSERT INTO player_game_nhl_goalie (espn_event_id, season, season_type, "
                  "game_date, team_id, opp_team_id, is_home, athlete_id, position, starter, "
                  "goalie_order, toi_sec, sa, ga, sv, stats_json) "
                  "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'{}')",
                  (r.espn_event_id, 2026, 2, r.game_date, r.team_id, 3 - r.team_id,
                   int(r.team_id == 1), r.athlete_id, "G", 1, 1, 3600, r.sa, r.ga, r.sa - r.ga))
    return c


def _sched():
    return pd.DataFrame({"espn_event_id": [5000], "date": ["2026-10-17"],
                         "home_team": ["1"], "away_team": ["2"]})


def _goalie(c, src, team, athlete, strength="Confirmed", vf="2026-10-17T10:00:00+00:00",
            vt=None):
    if src == "dfo":
        c.execute("INSERT INTO nhl_goalie_states (game_date, dfo_team_id, team_id, "
                  "espn_event_id, athlete_id, goalie_name, strength, state_hash, valid_from, "
                  "valid_to, last_seen) VALUES ('2026-10-17',?,?,5000,?,?,?,'h',?,?,?)",
                  (team, team, athlete, f"G{athlete}", strength, vf, vt, vf))
    else:
        c.execute("INSERT INTO game_probables (espn_event_id, league, team_id, kind, "
                  "athlete_id, name, status, state_hash, valid_from, valid_to, last_seen) "
                  "VALUES (5000,'nhl',?,'SG',?,?,'Expected','h',?,?,?)",
                  (team, athlete, f"G{athlete}", vf, vt, vf))


def test_no_starter_known_means_no_adjustment():
    c = _probe_db()
    sv = starters.starter_values(c, "nhl", _sched(), AS_OF)
    assert sv.loc[0, "home_starter_rel"] == 0 and sv.loc[0, "away_starter_rel"] == 0
    assert pd.isna(sv.loc[0, "home_starter_id"]) and pd.isna(sv.loc[0, "away_starter_id"])


def test_starter_without_history_gets_no_shift():
    c = _probe_db()
    _goalie(c, "espn", 1, 999)                         # never played: no box lines
    _goalie(c, "espn", 2, 21)
    sv = starters.starter_values(c, "nhl", _sched(), AS_OF)
    assert sv.loc[0, "home_starter_id"] == 999
    assert sv.loc[0, "home_starter_rel"] == 0
    assert sv.loc[0, "home_starter_src"] == "espn:nohist"
    assert sv.loc[0, "away_starter_rel"] != 0 and sv.loc[0, "away_starter_src"] == "espn"


def test_source_priority_and_state_time():
    c = _probe_db()
    _goalie(c, "espn", 1, 12)
    _goalie(c, "dfo", 1, 11, "Confirmed")              # DFO confirmed beats ESPN
    _goalie(c, "dfo", 2, 22, "Unconfirmed")            # DFO unconfirmed is ignored...
    _goalie(c, "espn", 2, 21)                          # ...so ESPN's probable is used
    sv = starters.starter_values(c, "nhl", _sched(), AS_OF)
    assert (sv.loc[0, "home_starter_id"], sv.loc[0, "home_starter_src"]) == (11, "dfo")
    assert (sv.loc[0, "away_starter_id"], sv.loc[0, "away_starter_src"]) == (21, "espn")
    # a state first seen after the run time is not known yet
    c2 = _probe_db()
    _goalie(c2, "dfo", 1, 11, vf="2026-10-17T15:00:00+00:00")
    _goalie(c2, "espn", 1, 12, vt="2026-10-17T10:30:00+00:00")   # ended before the run
    sv2 = starters.starter_values(c2, "nhl", _sched(), AS_OF)
    assert pd.isna(sv2.loc[0, "home_starter_id"])


def test_migration_adds_audit_columns_and_keeps_rows():
    c = sqlite3.connect(":memory:")
    # the forecast tables as they were before this change
    c.executescript("""
    CREATE TABLE forecast_snapshots (snapshot_date TEXT NOT NULL, league TEXT NOT NULL,
      espn_event_id INTEGER NOT NULL, game_date TEXT, home_team_id INTEGER,
      away_team_id INTEGER, home_prob REAL, away_prob REAL, home_spread REAL,
      total_pred REAL, home_total_pred REAL, away_total_pred REAL,
      backfilled INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (snapshot_date, espn_event_id));
    CREATE TABLE upcoming_forecasts (snapshot_date TEXT NOT NULL, league TEXT NOT NULL,
      espn_event_id INTEGER NOT NULL PRIMARY KEY, game_date TEXT, home_team_id INTEGER,
      away_team_id INTEGER, home_prob REAL, away_prob REAL, home_spread REAL,
      total_pred REAL, home_total_pred REAL, away_total_pred REAL);
    INSERT INTO forecast_snapshots VALUES ('2026-10-16','nhl',1,'2026-10-16',1,2,
      0.55,0.45,-0.5,6.1,3.3,2.8,0);
    """)
    db.init_db(c)
    db.init_db(c)                                      # idempotent
    for t in ("forecast_snapshots", "upcoming_forecasts"):
        have = {r[1] for r in c.execute(f"PRAGMA table_info({t})")}
        assert set(starters.AUDIT_COLS) <= have, t
    row = c.execute("SELECT home_prob, total_pred, home_starter_id, home_prob_base "
                    "FROM forecast_snapshots").fetchone()
    assert row == (0.55, 6.1, None, None)              # old row unchanged, audit NULL


def test_save_snapshot_writes_audit_columns():
    from tests.test_forecast_ahead import _db, _res
    c = _db()
    sched = daily.todays_schedule(c, "nfl", date(2026, 10, 13), date(2026, 10, 27))
    res = _res(sched)
    f = res["forecast"]
    f["home_starter_id"] = pd.array([7, None, 8], dtype="Int64")
    f["away_starter_id"] = pd.array([None, None, 9], dtype="Int64")
    f["home_starter_src"] = ["espn", None, "dfo"]
    f["away_starter_src"] = [None, None, "espn:nohist"]
    f["home_starter_rel"] = [0.3, 0.0, 0.1]
    f["away_starter_rel"] = [0.0, 0.0, 0.0]
    f["home_prob_base"] = [0.58, 0.6, 0.59]
    f["total_pred_base"] = [44.5, 44.0, 44.2]
    daily.save_snapshot(c, "2026-10-13", "nfl", res, sched, upcoming=True)
    assert c.execute("SELECT home_starter_id, away_starter_id, home_starter_src, "
                     "home_starter_rel, home_prob_base FROM forecast_snapshots").fetchone() \
        == (7, None, "espn", 0.3, 0.58)
    up = c.execute("SELECT espn_event_id, home_starter_id, away_starter_src, total_pred_base "
                   "FROM upcoming_forecasts ORDER BY 1").fetchall()
    assert up == [(102, None, None, 44.0), (103, 8, "espn:nohist", 44.2)]
    # replay-style forecasts carry no audit columns: stored as NULL
    c2 = _db()
    daily.save_snapshot(c2, "2026-10-13", "nfl", _res(sched), sched, backfilled=1)
    assert c2.execute("SELECT COUNT(*) FROM forecast_snapshots WHERE home_starter_id IS NULL "
                      "AND home_prob_base IS NULL").fetchone()[0] == 3


def test_coefficients_are_set_for_both_leagues():
    for lg in ("mlb", "nhl"):
        assert set(starters.COEFS[lg]) == {"win", "total"}
        assert starters.COEFS[lg]["win"] > 0 and starters.COEFS[lg]["total"] > 0


def test_mlb_sources_espn_first_and_statsapi_ids_checked():
    c = sqlite3.connect(":memory:")
    c.executescript(SCHEMA.read_text())
    for t in (1, 2):
        c.execute("INSERT INTO teams (team_id, league, espn_id, name, abbreviation) "
                  "VALUES (?, 'mlb', ?, 'T', 'T')", (t, t))
    c.execute("INSERT INTO players (league, athlete_id, name, team_id) VALUES ('mlb', 33, 'P', 1)")
    for side, team, pid in (("home", 1, 33), ("away", 2, 2336236)):   # 2336236: not our id
        c.execute("INSERT INTO mlb_lineup_states (game_pk, espn_event_id, side, slot, team_id, "
                  "athlete_id, name, state_hash, valid_from, last_seen) "
                  "VALUES (1, 5000, ?, 0, ?, ?, 'x', 'h', ?, ?)", (side, team, pid, AS_OF, AS_OF))
    ks = starters.known_starters(c, "mlb", [5000], AS_OF).set_index("team_id")
    assert list(ks.index) == [1] and ks.loc[1, "src"] == "mlbapi"
    c.execute("INSERT INTO game_probables (espn_event_id, league, team_id, kind, athlete_id, "
              "name, state_hash, valid_from, last_seen) VALUES (5000,'mlb',1,'SP',44,'E','h',?,?)",
              (AS_OF, AS_OF))
    ks = starters.known_starters(c, "mlb", [5000], AS_OF).set_index("team_id")
    assert (ks.loc[1, "athlete_id"], ks.loc[1, "src"]) == (44, "espn")


def test_dfo_goalies_pass_lands_before_the_6am_forecast():
    """The 04:30 CT forecast locks NHL starters at run time: a Daily Faceoff
    pass must run just before (04:15 CT, both UTC offsets) and run_daily.sh
    must wait for it if it is still going."""
    root = Path(__file__).resolve().parents[1]
    cron = (root / "scripts" / "cron.example").read_text()
    assert "run_prelog.sh goalies 04" in cron
    assert "30 9,10 * * * mkdir -p REPO/data/status && REPO/scripts/run_daily.sh" in cron
    run_daily = (root / "scripts" / "run_daily.sh").read_text()
    wait = run_daily.index('flock -w 600 "$LOCK_DIR/prelog-goalies.lock"')
    assert wait < run_daily.index("-m bayesratings.daily")
    assert "/tmp/bayesratings" not in run_daily
    lock = (root / "scripts" / "run_prelog.sh").read_text()
    assert 'prelog-$KIND.lock' in lock
    assert "/tmp/bayesratings" not in lock


def _mlb_start(day, outs, runs, event=1, team=1, athlete=10):
    return {"espn_event_id": event, "game_date": day, "team_id": team,
            "athlete_id": athlete, "outs": outs, "runs_allowed": runs, "pseudo": 0}


def test_model_rel_matches_the_research_formula_and_ignores_the_future():
    # One start, then one 180 days later (exactly one half-life). No earlier
    # league sample on the first start, so its quality is 0.
    first = "2024-04-01"
    second = "2024-09-28"   # 180 days later
    lines = pd.DataFrame([
        _mlb_start(first, 15, 3, event=1),
        _mlb_start(second, 18, 9, event=2),
    ])
    rel = starters.model_rel(lines, "mlb").set_index("espn_event_id")
    assert rel.loc[1, "q"] == 0.0 and rel.loc[1, "rel"] == 0.0
    # decayed sums are half of the first start; the second start's own line is not in them
    lg = 1.5 / 7.5
    rate = (1.5 + 150 * lg * 1.08) / (7.5 + 150)
    q = (lg - rate) * 16.5
    assert abs(rel.loc[2, "q"] - q) < 1e-9
    # team average of the earlier q (0), so rel equals q
    assert abs(rel.loc[2, "rel"] - q) < 1e-9
    assert abs(q - (-0.25142857142857145)) < 1e-9

    # A later blow-up, and a same-day twin, must not move the second start.
    wrecked = pd.concat([
        lines,
        pd.DataFrame([_mlb_start(second, 1, 20, event=3, athlete=11, team=2),
                      _mlb_start("2024-10-01", 1, 30, event=4)]),
    ], ignore_index=True)
    again = starters.model_rel(wrecked, "mlb").set_index("espn_event_id")
    assert abs(again.loc[2, "q"] - rel.loc[2, "q"]) < 1e-12
    # same day, no personal history: the prior only, and not the other pitcher's line
    rate0 = (150 * lg * 1.08) / 150
    assert abs(again.loc[3, "q"] - (lg - rate0) * 16.5) < 1e-9

    # NHL: one start, then one 365 days later.
    g0 = "2023-10-10"
    g1 = "2024-10-09"   # 365 days
    goalies = pd.DataFrame([
        {"espn_event_id": 1, "game_date": g0, "team_id": 1, "athlete_id": 7,
         "shots_against": 1000, "saves": 900, "pseudo": 0},
        {"espn_event_id": 2, "game_date": g1, "team_id": 1, "athlete_id": 7,
         "shots_against": 30, "saves": 27, "pseudo": 0},
    ])
    gr = starters.model_rel(goalies, "nhl").set_index("espn_event_id")
    lg_sv = 450 / 500
    sv = (450 + 1500 * (lg_sv - 0.003)) / (500 + 1500)
    gq = (sv - lg_sv) * 28
    assert gr.loc[1, "q"] == 0.0
    assert abs(gr.loc[2, "q"] - gq) < 1e-9
    assert abs(gq - (-0.063)) < 1e-9


def test_starter_edge_is_home_minus_away_and_zero_when_missing():
    day = "2024-09-28"
    lines = pd.DataFrame([
        _mlb_start("2024-04-01", 15, 3, event=1, team=1, athlete=10),
        _mlb_start("2024-04-01", 15, 6, event=1, team=2, athlete=20),
        _mlb_start(day, 12, 2, event=2, team=1, athlete=10),
        _mlb_start(day, 12, 4, event=2, team=2, athlete=20),
    ])
    games = pd.DataFrame([
        {"espn_event_id": 2, "season": 2024, "date": day, "home_team": "1", "away_team": "2",
         "home_score": 4, "away_score": 2},
        {"espn_event_id": 3, "season": 2024, "date": day, "home_team": "9", "away_team": "8",
         "home_score": 1, "away_score": 0},
    ])
    out = starters.attach_starter_edges(games, lines, "mlb")
    assert abs(out.loc[0, "starter_edge"] - (out.loc[0, "home_starter_rel"] - out.loc[0, "away_starter_rel"])) < 1e-12
    assert out.loc[0, "home_starter_rel"] != 0 or out.loc[0, "away_starter_rel"] != 0
    assert out.loc[1, "starter_edge"] == 0.0
    assert list(out["espn_event_id"]) == [2, 3]
