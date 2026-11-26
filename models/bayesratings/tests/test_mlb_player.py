"""MLB stack B (bayesratings/mlb_player.py).

Feature recipe, the lineup switch, the refit day, the refresh write rules,
No walk-forward.
Run: PYTHONPATH=. python -m pytest tests/test_mlb_player.py
"""
import json
import sqlite3
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd

from bayesratings import daily, db, mlb_player as mp


NOW = datetime(2026, 7, 15, 18, 0, tzinfo=timezone.utc)
AS_OF = "2026-07-15T18:00:00+00:00"
DAY = "2026-07-15"


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    db.init_db(c)
    c.execute("PRAGMA foreign_keys = OFF")
    c.execute("INSERT INTO teams (team_id, league, espn_id, name, abbreviation) "
              "VALUES (10,'mlb',110,'Home','HOM')")
    c.execute("INSERT INTO teams (team_id, league, espn_id, name, abbreviation) "
              "VALUES (20,'mlb',120,'Away','AWY')")
    return c


def _box_line(ab=4, h=2, hr=1, bb=1, doubles=1):
    return dict(ab=ab, h=h, hr=hr, bb=bb, k=1, doubles=doubles, triples=0,
                hit_by_pitch=0, sac_flies=0, intentional_walks=0)


def test_woba_uses_earlier_games_only_and_platoon_splits():
    """The worked example: one single is not in the line, wOBA is 4.06 / 5.
    Game 1 is the prior. Game 2 decays only game 1. Versus-left and
    versus-right differ."""
    bat_rows, box_rows = [], []
    for eid, day, hand in ((1, "2024-04-01", "L"), (2, "2024-04-10", "R")):
        line = _box_line()
        bat_rows.append({"espn_event_id": eid, "game_date": day, "athlete_id": 7,
                         "team_id": 1, "opp_team_id": 2, "starter": 1, "bat_order": 1,
                         **{k: line[k] for k in ("ab", "h", "hr", "bb", "k")}})
        box_rows.append({"espn_event_id": eid, "athlete_id": 7,
                         "plate_appearances": 5,
                         **{k: line[k] for k in ("doubles", "triples", "hit_by_pitch",
                                                 "sac_flies", "intentional_walks")}})
    comp = mp.batting_components(pd.DataFrame(bat_rows), pd.DataFrame(box_rows))
    assert list(comp["h1"]) == [0, 0]
    assert list(comp["pa"]) == [5, 5]
    assert abs(comp["wv"].iloc[0] - 4.06) < 1e-9
    assert comp["iso"].iloc[0] == 4
    comp["sp_hand"] = ["L", "R"]
    comp["bats"] = "R"
    rated, info = mp.add_batter_rates(comp, {})
    prior_wv = info["prior"]["wv"]
    assert abs(prior_wv - 0.92 * (4.06 / 5)) < 1e-12
    g1 = rated[rated.espn_event_id == 1].iloc[0]
    g2 = rated[rated.espn_event_id == 2].iloc[0]
    assert abs(g1.wv_r - prior_wv) < 1e-12
    decay = 0.5 ** (9 / 540)
    expect = (4.06 * decay + 200 * prior_wv) / (5 * decay + 200)
    assert abs(g2.wv_r - expect) < 1e-9
    assert abs(g2.wv_vsR - g2.wv_r) < 1e-6
    assert abs(g2.wv_vsL - g2.wv_r) > 1e-3


def test_same_day_second_game_sees_the_first():
    rows = []
    for eid in (1, 2):
        line = _box_line()
        rows.append({"espn_event_id": eid, "game_date": "2024-04-01", "athlete_id": 7,
                     "ab": line["ab"], "h": line["h"], "hr": line["hr"], "bb": line["bb"],
                     "k": line["k"], "doubles": 1, "triples": 0, "hit_by_pitch": 0,
                     "sac_flies": 0, "intentional_walks": 0, "sp_hand": "R", "bats": "R",
                     "pa": 5, "ubb": 1, "h1": 0, "wv": 4.06, "iso": 4})
    rated, info = mp.add_batter_rates(pd.DataFrame(rows), {})
    g1 = rated[rated.espn_event_id == 1].iloc[0]
    g2 = rated[rated.espn_event_id == 2].iloc[0]
    assert abs(g1.wv_r - info["prior"]["wv"]) < 1e-12
    expect = (4.06 + 200 * info["prior"]["wv"]) / (5 + 200)
    assert abs(g2.wv_r - expect) < 1e-9


def test_bullpen_window_and_stack_diffs():
    rel = pd.DataFrame([
        {"team_id": 1, "game_date": "2024-04-01", "outs": 3, "pitches": 40,
         "fip_bf": 9.0, "xwcon": 0.9},
        {"team_id": 1, "game_date": "2024-04-11", "outs": 3, "pitches": 12,
         "fip_bf": 0.2, "xwcon": 0.4},
        {"team_id": 1, "game_date": "2024-04-19", "outs": 3, "pitches": 7,
         "fip_bf": 0.2, "xwcon": 0.4},
        {"team_id": 1, "game_date": "2024-04-20", "outs": 3, "pitches": 4,
         "fip_bf": 0.2, "xwcon": 0.4},
        {"team_id": 1, "game_date": "2024-04-21", "outs": 3, "pitches": 50,
         "fip_bf": 5.0, "xwcon": 0.1},
    ])
    q, qc, p1, p3 = mp.bullpen_at(rel, 1, "2024-04-21")
    assert abs(q - 0.2) < 1e-9 and abs(qc - 0.4) < 1e-9
    assert p1 == 4
    assert p3 == 11
    home = {k: 1.0 for k in mp.BASE_FEATS}
    away = {k: 0.25 for k in mp.BASE_FEATS}
    vec = mp.stack_vector(0.62, home, away, 1, 3, 0)
    assert vec[0] == mp.logit(0.62)
    assert vec[mp.FEATURES.index("d_bat_wv")] == 0.75
    assert vec[mp.FEATURES.index("h_b2b")] == 1
    assert vec[mp.FEATURES.index("a_b2b")] == 0
    assert vec[mp.FEATURES.index("rest_d")] == -2
    assert mp.stack_vector(0.62, home, away, None, 3, 0) is None
    filled = mp.stack_vector(0.62, home, away, None, None, 0, fill_missing=True)
    assert filled[mp.FEATURES.index("h_b2b")] == 0
    assert filled[mp.FEATURES.index("rest_d")] == 0


def _frame(prob=0.55):
    return pd.DataFrame([{
        "espn_event_id": 900, "season": 2026, "game_date": DAY,
        "home_team_id": 10, "away_team_id": 20,
        "home_prob": prob, "away_prob": round(1 - prob, 4),
        "home_spread": -1.2, "away_spread": 1.2,
        "total_pred": 8.5, "home_total_pred": 4.8, "away_total_pred": 3.7,
        "player_prob_base": prob, "neutral": 0,
    }])


def _store_fit(c, n_games, intercept=None, c_value=1.0, lt=0.09,
               sd_p=0.081, sd_team=0.083, mean_p=0.530, win_rate=0.530):
    """A fit with the stored in-sample spread. The team-logit column is
    centered on logit(0.55), so a game whose team chance is 0.55 has a zero
    standardized lt and the intercept (logit 0.6) is the published chance.
    """
    coef = [0.0] * len(mp.FEATURES)
    mean = [0.0] * len(mp.FEATURES)
    coef[0] = lt
    mean[0] = mp.logit(0.55)
    packed = {
        "features": list(mp.FEATURES),
        "scaler_mean": mean,
        "scaler_scale": [1.0] * len(mp.FEATURES),
        "coef": coef,
        "intercept": mp.logit(0.6) if intercept is None else intercept,
        "c_value": c_value,
        "sklearn_version": "test",
        "n_games": int(n_games),
        "sd_p": sd_p,
        "sd_team": sd_team,
        "mean_p": mean_p,
        "win_rate": win_rate,
    }
    mp._save_fit(c, date(2026, 7, 14), packed, "2026-07-13")


def _priors(c):
    bat = {"hl": 540, "k": 200,
           "prior": {"wv": 0.30, "bb": 0.08, "k": 0.22, "hr": 0.03, "iso": 0.15},
           "sc": {"hl": 540, "k": 80, "prior": {"xw": 0.37, "hard": 0.38,
                                                "barrel": 0.07, "ev": 88.5}}}
    pit = {"hl": 365, "k": 300,
           "prior": {"k": 0.20, "bbh": 0.08, "hr": 0.03, "h": 0.22},
           "sc": {"hl": 365, "k": 150, "prior": {"xw": 0.37, "hard": 0.38,
                                                 "barrel": 0.07, "ev": 88.5}}}
    c.execute("DELETE FROM mlb_player_state")
    for role, js in (("prior_bat", bat), ("prior_pit", pit)):
        c.execute("INSERT INTO mlb_player_state (as_of_date, athlete_id, role, state_json) "
                  "VALUES (?,?,?,?)", (DAY, 0, role, json.dumps(js)))


def _lineup(c, eid, team, side, pitcher):
    for slot in range(1, 10):
        c.execute(
            "INSERT INTO mlb_lineup_states (league, game_pk, espn_event_id, side, slot, "
            "team_id, athlete_id, state_hash, valid_from, last_seen) "
            "VALUES ('mlb', ?, ?, ?, ?, ?, ?, 'h', ?, ?)",
            (eid, eid, side, slot, team, 1000 + slot + team, AS_OF, AS_OF))
    c.execute(
        "INSERT INTO mlb_lineup_states (league, game_pk, espn_event_id, side, slot, "
        "team_id, athlete_id, state_hash, valid_from, last_seen) "
        "VALUES ('mlb', ?, ?, ?, 0, ?, ?, 'h', ?, ?)",
        (eid, eid, side, team, pitcher, AS_OF, AS_OF))


def _arm(c, n_games=2000):
    _priors(c)
    _store_fit(c, n_games)
    _lineup(c, 900, 10, "home", 111)
    _lineup(c, 900, 20, "away", 222)
    c.execute("DELETE FROM mlb_relief_log")
    for team, fip in ((10, 0.1), (20, 0.2)):
        c.execute("INSERT INTO mlb_relief_log (team_id, game_date, espn_event_id, athlete_id, "
                  "outs, pitches, fip_bf, xwcon) VALUES (?,?,?,?,?,?,?,?)",
                  (team, "2026-07-10", 1, team, 3, 15, fip, 0.35))


def test_fallback_until_lineups_starters_and_a_large_fit():
    c = _db()
    bare = mp.overlay(c, _frame(), AS_OF)
    assert bare.loc[0, "mlb_model_src"] == "team"
    assert bare.loc[0, "home_prob"] == 0.55
    assert bare.loc[0, "era"] == "team_model"
    _arm(c, n_games=1999)
    short = mp.overlay(c, _frame(), AS_OF)
    assert short.loc[0, "mlb_model_src"] == "team"
    assert short.loc[0, "home_prob"] == 0.55
    c.execute("DELETE FROM mlb_ridge_fits")
    _store_fit(c, 2000)
    c.execute("DELETE FROM mlb_lineup_states WHERE team_id = 20")
    one_side = mp.overlay(c, _frame(), AS_OF)
    assert one_side.loc[0, "mlb_model_src"] == "team"
    assert one_side.loc[0, "home_prob"] == 0.55
    _lineup(c, 900, 20, "away", 222)
    full = mp.overlay(c, _frame(), AS_OF)
    assert full.loc[0, "mlb_model_src"] == "stack_b"
    assert full.loc[0, "home_prob"] == 0.6
    assert full.loc[0, "era"] == "player_model"
    assert full.loc[0, "total_pred"] == 8.5
    assert int(full.loc[0, "mlb_ridge_fit_id"]) >= 1


def test_hist_rows_do_not_lower_the_publish_line():
    """A history row is a training input. Publishing still needs 2,000 games."""
    c = _db()
    c.execute(
        "INSERT INTO mlb_team_chance_hist (espn_event_id, game_date, season, p, source, "
        "model_version, created_at) VALUES (900,'2026-07-15',2026,0.7,'stan','t','t')")
    assert mp.MIN_PUBLISH_GAMES == 2000
    _arm(c, n_games=1999)
    short = mp.overlay(c, _frame(), AS_OF)
    assert short.loc[0, "mlb_model_src"] == "team"
    assert short.loc[0, "home_prob"] == 0.55


def test_refit_due_is_tuesday_or_a_missing_fit():
    c = _db()
    assert mp.refit_due(c, date(2026, 11, 24)) is True
    assert mp.refit_due(c, date(2026, 11, 25)) is True
    c.execute(
        "INSERT INTO mlb_ridge_fits (fit_date, version, train_from, train_through, n_games, "
        "features, scaler_mean, scaler_scale, coef, intercept, created_at) "
        "VALUES ('2026-11-24','stack_b','2022-01-01','2026-11-23',10,'[]','[]','[]','[]',0,'t')")
    assert mp.refit_due(c, date(2026, 11, 24)) is False
    assert mp.refit_due(c, date(2026, 11, 25)) is False
    c.execute("DELETE FROM mlb_ridge_fits")
    assert mp.refit_due(c, date(2026, 11, 25)) is True


def _game(c, eid, start, day=DAY):
    c.execute("INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
              "game_date, home_team_id, away_team_id, completed, status) "
              "VALUES (?, 'mlb', 2026, 2, ?, ?, 10, 20, 0, 'STATUS_SCHEDULED')",
              (eid, start, day))


def _forecast(c, eid, prob=0.55, day=DAY, table="forecast_snapshots"):
    c.execute(
        f"INSERT INTO {table} (snapshot_date, league, espn_event_id, game_date, "
        "home_team_id, away_team_id, home_prob, away_prob, home_spread, total_pred, "
        "home_total_pred, away_total_pred, home_prob_base, starter_coef, player_prob_base, "
        "player_spread_base, player_total_base, player_home_total_base, player_away_total_base, "
        "home_player_x, away_player_x, home_player_x2, away_player_x2, elo_weight) "
        "VALUES (?,?,?,?,10,20,?,?, -1.2, 8.5, 4.8, 3.7, 0.50, 1.0, ?, -1.2, 8.5, 4.8, 3.7, "
        "0, 0, 0, 0, 0)",
        (day, "mlb", eid, day, prob, round(1 - prob, 4), prob))


def test_posted_lineup_recomputes_unlocked_forecasts_only():
    c = _db()
    _game(c, 900, "2026-07-15T20:00:00Z")
    _game(c, 901, "2026-07-15T21:00:00Z")
    _game(c, 902, "2026-07-15T18:03:00Z")
    for eid in (900, 901, 902):
        _forecast(c, eid)
    c.execute("INSERT INTO forecast_locks (espn_event_id, league, locked_at, "
              "home_prob, home_spread, total_pred) VALUES "
              "(901,'mlb',?,0.55,-1.2,8.5)", (AS_OF,))
    mp.refresh(c, NOW, force=True)
    before = c.execute("SELECT home_prob, mlb_model_src FROM forecast_snapshots "
                       "WHERE espn_event_id=900").fetchone()
    assert before[0] == 0.55 and before[1] in (None, "team")
    _lineup(c, 900, 10, "home", 111)
    _lineup(c, 900, 20, "away", 222)
    _lineup(c, 901, 10, "home", 111)
    _lineup(c, 901, 20, "away", 222)
    _lineup(c, 902, 10, "home", 111)
    _lineup(c, 902, 20, "away", 222)
    _priors(c)
    _store_fit(c, 2500)
    for team, fip in ((10, 0.1), (20, 0.2)):
        c.execute("INSERT INTO mlb_relief_log (team_id, game_date, espn_event_id, athlete_id, "
                  "outs, pitches, fip_bf, xwcon) VALUES (?,?,?,?,?,?,?,?)",
                  (team, "2026-07-10", 7, team, 3, 15, fip, 0.35))
    mp.refresh(c, NOW, force=True)
    row = c.execute("SELECT home_prob, mlb_model_src, total_pred FROM forecast_snapshots "
                    "WHERE espn_event_id=900").fetchone()
    assert row[0] == 0.6 and row[1] == "stack_b" and row[2] == 8.5
    locked = c.execute("SELECT home_prob, mlb_model_src FROM forecast_snapshots "
                       "WHERE espn_event_id=901").fetchone()
    assert locked[0] == 0.55 and locked[1] is None
    soon = c.execute("SELECT home_prob FROM forecast_snapshots WHERE espn_event_id=902").fetchone()
    assert soon[0] == 0.55


def test_snapshot_split():
    c = _db()
    _game(c, 910, "2026-07-15T20:00:00Z", DAY)
    _game(c, 911, "2026-07-17T20:00:00Z", "2026-07-17")
    sched = daily.todays_schedule(c, "mlb", date(2026, 7, 15), date(2026, 7, 17))
    n = len(sched)
    res = {"rating_season": 2026, "home_adv": 0.1,
           "fit": type("F", (), {"stan_variable": lambda self, name: np.zeros((40, 2))})(),
           "ratings": pd.Series([0.2, -0.2], index=[10, 20]),
           "forecast": pd.DataFrame({
               "home_prob": [0.6, 0.4], "away_prob": [0.4, 0.6],
               "home_spread": [-1.0, 1.0], "total_pred": [8.0, 8.0],
               "home_total_pred": [4.5, 3.5], "away_total_pred": [3.5, 4.5],
               "mlb_model_src": ["stack_b", "team"]})}
    assert list(sched["espn_event_id"]) == [910, 911]
    assert len(res["forecast"]) == n
    daily.save_snapshot(c, DAY, "mlb", res, sched, upcoming=True)
    stored = [tuple(r) for r in c.execute(
        "SELECT espn_event_id, mlb_model_src FROM forecast_snapshots")]
    assert stored == [(910, "stack_b")]
    cols = {r[1] for r in c.execute("PRAGMA table_info(forecast_snapshots)")}
    assert "era" not in cols
    upcoming = tuple(c.execute(
        "SELECT espn_event_id, mlb_model_src FROM upcoming_forecasts").fetchone())
    assert upcoming == (911, "team")


def _batted_row(c, game_pk, person, athlete):
    c.execute(
        "INSERT INTO mlb_batted_players (game_pk, mlb_person_id, role, game_date, season, "
        "batted_balls, ev_n, hard_hit, barrels, xwoba_sum, xwoba_n, athlete_id) "
        "VALUES (?, ?, 'batter', '2024-06-01', 2024, 4, 4, 1, 0, 1.2, 4, ?)",
        (game_pk, person, athlete))


def test_all_missing_batted_athlete_ids_stay_numeric():
    """pandas 3 rejects an object array of None written into float athlete_id.
    Every id on the way in is missing. An unmatched person stays missing. A
    mapped person becomes that athlete, as a number."""
    c = _db()
    _batted_row(c, 1, 500, None)
    _batted_row(c, 2, 501, None)
    got = mp.load_history(c, "2024-06-02")["batted"]
    assert len(got) == 2
    assert pd.api.types.is_numeric_dtype(got["athlete_id"])
    assert got["athlete_id"].isna().all()
    query = pd.DataFrame({"athlete_id": [77], "game_date": ["2024-06-01"]})
    empty, prior = mp.statcast_rates(got, "batter", query, mp.HL_SC_BAT, mp.K_SC_BAT)
    assert prior is None and len(empty) == 0

    c.execute(
        "INSERT INTO ext_ids (source, league, kind, ext_id, espn_id, first_seen, last_seen) "
        "VALUES ('mlbam', 'mlb', 'player', '500', 77, '2024-01-01', '2024-01-01')")
    got = mp.load_history(c, "2024-06-02")["batted"].set_index("mlb_person_id")
    assert int(got.loc[500, "athlete_id"]) == 77
    assert pd.isna(got.loc[501, "athlete_id"])
    rated, prior = mp.statcast_rates(
        got.reset_index(), "batter", query, mp.HL_SC_BAT, mp.K_SC_BAT)
    assert prior is not None and set(rated["athlete_id"]) == {77}


def test_refit_failure_is_logged_and_the_morning_continues(monkeypatch):
    """The daily job calls morning(). A refit error is logged and does not
    raise, so this league keeps the current path and the next league still runs."""
    c = _db()
    monkeypatch.setattr(mp, "refit_due", lambda conn, today: True)

    def boom(conn, today, log=print):
        raise TypeError("Invalid value '[None None None]' for dtype 'float64'")

    monkeypatch.setattr(mp, "refit", boom)
    lines = []
    note = mp.morning(c, date(2026, 11, 24), log=lines.append)
    assert note.startswith("mlb ridge refit skipped (TypeError:")
    assert "state" in note
    assert any("Traceback" in line and "float64" in line for line in lines)
    assert c.execute("SELECT COUNT(*) FROM mlb_player_state").fetchone()[0] == 0


def test_an_mlb_error_does_not_stop_the_next_league(monkeypatch):
    c = _db()
    seen = []

    def fake_rate(conn, lg, today, stan_model, elo_model=None):
        seen.append(lg)
        if lg == "mlb":
            raise TypeError("Invalid value '[None None None]' for dtype 'float64'")
        return {"rating_season": 2026, "n_games": 1, "n_teams": 2,
                "n_forecasts": 0, "seconds": 0.1}

    monkeypatch.setattr(daily, "rate_league", fake_rate)
    monkeypatch.setattr(daily, "in_season", lambda *a, **k: True)
    parts = []
    rated, failed = daily.rate_each(
        c, ["mlb", "nba"], date(2026, 11, 24), None, None, parts)
    assert seen == ["mlb", "nba"]
    assert rated == ["nba"] and failed is True
    assert "mlb ERROR TypeError" in parts
    assert parts[-1].startswith("nba ok")
    rows = {r["league"]: r["status"] for r in c.execute(
        "SELECT league, status FROM daily_runs")}
    assert rows == {"mlb": "error", "nba": "ok"}


def test_build_state_freezes_dict_rows():
    """build_state passes DataFrame.to_dict records. A Series-only check crashes."""
    prior = {"hl": 540.0, "k": 200.0,
             "prior": {"wv": 0.30, "bb": 0.08, "k": 0.22, "hr": 0.03, "iso": 0.15}}
    row = {
        "game_date": "2024-04-10", "bats": "L", "sp_hand": "L", "pa_expo": 12.0, "pa": 4.0,
        "wv": 1.2, "bb": 0.4, "k": 1.0, "hr": 0.0, "iso": 0.5,
        "wv_r": 0.32, "bb_r": 0.09, "k_r": 0.21, "hr_r": 0.03, "iso_r": 0.16,
        "vsL_e": 4.0, "vsL_sum": 1.1, "vsR_e": 0.0, "vsR_sum": 0.0,
    }
    frozen = mp.freeze_batter(row, prior)
    assert frozen["last"] == "2024-04-10" and frozen["bats"] == "L"
    assert frozen["sc"]["bbe"] == 0.0 and frozen["sc"]["xw_n"] == 0.0
    row["bbe_expo"] = 5.0
    row.update(xwcon_r=0.40, hard_hit_r=0.50, barrels_r=0.10, ev_r=90.0)
    frozen = mp.freeze_batter(row, prior)
    assert frozen["sc"]["bbe"] == 5.0 and abs(frozen["sc"]["xw_sum"] - 2.0) < 1e-9

    pit_prior = {"hl": 365.0, "k": 300.0,
                 "prior": {"k": 0.20, "bbh": 0.08, "hr": 0.03, "h": 0.22}}
    pitcher = {
        "game_date": "2024-04-10", "_expo": 40.0, "bf": 20.0, "outs": 15.0,
        "k": 5.0, "bbh": 2.0, "hr": 1.0, "h": 4.0,
        "k_r": 0.22, "bbh_r": 0.09, "hr_r": 0.03, "h_r": 0.23,
        "exp_outs": 16.0, "_ewm": 16.0, "hand_L": 1,
    }
    assert mp.freeze_pitcher(pitcher, pit_prior)["sc"]["bbe"] == 0.0

    c = _db()
    c.execute(
        "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
        "game_date, home_team_id, away_team_id, home_score, away_score, completed, status) "
        "VALUES (50, 'mlb', 2024, 2, '2024-04-10T20:00:00Z', '2024-04-10', 10, 20, 4, 2, 1, "
        "'STATUS_FINAL')")
    for slot, aid in enumerate(range(1101, 1110), start=1):
        c.execute(
            "INSERT INTO player_game_mlb_batting (espn_event_id, season, season_type, game_date, "
            "team_id, opp_team_id, is_home, athlete_id, starter, bat_order, box_order, "
            "ab, h, hr, bb, k, stats_json) VALUES (50, 2024, 2, '2024-04-10', 10, 20, 1, ?, 1, ?, ?, "
            "4, 1, 0, 0, 1, '{}')", (aid, slot, slot))
    c.execute(
        "INSERT INTO player_game_mlb_pitching (espn_event_id, season, season_type, game_date, "
        "team_id, opp_team_id, is_home, athlete_id, starter, pitch_order, outs, h, bb, k, hr, "
        "pitches, stats_json) VALUES (50, 2024, 2, '2024-04-10', 20, 10, 0, 1211, 1, 1, 18, 5, 2, "
        "6, 1, 90, '{}')")
    c.execute(
        "INSERT INTO player_game_mlb_pitching (espn_event_id, season, season_type, game_date, "
        "team_id, opp_team_id, is_home, athlete_id, starter, pitch_order, outs, h, bb, k, hr, "
        "pitches, stats_json) VALUES (50, 2024, 2, '2024-04-10', 20, 10, 0, 1411, 0, 2, 6, 1, 1, "
        "2, 0, 20, '{}')")
    n = mp.build_state(c, date(2024, 4, 11))
    roles = {r["role"] for r in c.execute("SELECT role FROM mlb_player_state")}
    assert n >= 3
    assert {"prior_bat", "batter", "prior_pit", "pitcher"} <= roles


def _counted_game(c, eid, day, home_runs, away_runs):
    season = int(day[:4])
    c.execute(
        "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
        "game_date, home_team_id, away_team_id, home_score, away_score, completed, status) "
        "VALUES (?, 'mlb', ?, 2, ?, ?, 10, 20, ?, ?, 1, 'STATUS_FINAL')",
        (eid, season, f"{day}T20:00:00Z", day, home_runs, away_runs))
    _forecast(c, eid, prob=0.62 if home_runs > away_runs else 0.38, day=day)
    for team, opp, home, bat0, starter, reliever in (
            (10, 20, 1, 1101, 1111, 1311), (20, 10, 0, 1201, 1211, 1411)):
        for slot in range(9):
            c.execute(
                "INSERT INTO player_game_mlb_batting (espn_event_id, season, season_type, "
                "game_date, team_id, opp_team_id, is_home, athlete_id, starter, bat_order, "
                "box_order, ab, h, hr, bb, k, stats_json) "
                "VALUES (?, ?, 2, ?, ?, ?, ?, ?, 1, ?, ?, 4, 1, 0, 0, 1, '{}')",
                (eid, season, day, team, opp, home, bat0 + slot, slot + 1, slot + 1))
        c.execute(
            "INSERT INTO player_game_mlb_pitching (espn_event_id, season, season_type, game_date, "
            "team_id, opp_team_id, is_home, athlete_id, starter, pitch_order, outs, h, bb, k, hr, "
            "pitches, stats_json) VALUES (?, ?, 2, ?, ?, ?, ?, ?, 1, 1, 18, 5, 2, 6, 1, 90, '{}')",
            (eid, season, day, team, opp, home, starter))
        c.execute(
            "INSERT INTO player_game_mlb_pitching (espn_event_id, season, season_type, game_date, "
            "team_id, opp_team_id, is_home, athlete_id, starter, pitch_order, outs, h, bb, k, hr, "
            "pitches, stats_json) VALUES (?, ?, 2, ?, ?, ?, ?, ?, 0, 2, 6, 1, 1, 2, 0, 25, '{}')",
            (eid, season, day, team, opp, home, reliever))


def _relief_day(c, eid, day):
    """A reliever outing two days earlier, so the game's bullpen feature is finite."""
    season = int(day[:4])
    for team, opp, home, reliever in ((10, 20, 1, 1311), (20, 10, 0, 1411)):
        c.execute(
            "INSERT INTO player_game_mlb_pitching (espn_event_id, season, season_type, game_date, "
            "team_id, opp_team_id, is_home, athlete_id, starter, pitch_order, outs, h, bb, k, hr, "
            "pitches, stats_json) VALUES (?, ?, 2, ?, ?, ?, ?, ?, 0, 2, 6, 1, 1, 2, 0, 25, '{}')",
            (eid, season, day, team, opp, home, reliever))


def test_training_frame_prefers_the_snapshot_and_uses_history():
    c = _db()
    c.execute(
        "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
        "game_date, home_team_id, away_team_id, home_score, away_score, completed, status) "
        "VALUES (1, 'mlb', 2023, 2, '2023-04-01T20:00:00Z', '2023-04-01', 10, 20, 4, 2, 1, "
        "'STATUS_FINAL')")
    _relief_day(c, 8001, "2023-04-02")
    _counted_game(c, 11, "2023-04-04", 5, 2)
    _relief_day(c, 8002, "2023-04-06")
    _counted_game(c, 12, "2023-04-07", 5, 2)
    c.execute("DELETE FROM forecast_snapshots WHERE espn_event_id = 12")
    c.executemany(
        "INSERT INTO mlb_team_chance_hist (espn_event_id, game_date, season, p, source, "
        "model_version, created_at) VALUES (?,?,2023,?,'stan','t','t')",
        [(11, "2023-04-04", 0.11), (12, "2023-04-07", 0.73)])
    frame = mp.load_training_frame(c, "2023-04-07")
    by_id = frame.set_index("espn_event_id")
    assert 11 in by_id.index and 12 in by_id.index
    assert abs(by_id.loc[11, "lt"] - mp.logit(0.62)) < 1e-9
    assert abs(by_id.loc[12, "lt"] - mp.logit(0.73)) < 1e-9


def test_main_refits_builds_state_and_refreshes(tmp_path, monkeypatch):
    """The module command is refit, then build_state, then refresh. All three run."""
    path = tmp_path / "mlb.db"
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    db.init_db(c)
    c.execute("PRAGMA foreign_keys = OFF")
    c.execute("INSERT INTO teams (team_id, league, espn_id, name, abbreviation) "
              "VALUES (10,'mlb',110,'Home','HOM')")
    c.execute("INSERT INTO teams (team_id, league, espn_id, name, abbreviation) "
              "VALUES (20,'mlb',120,'Away','AWY')")
    c.execute(
        "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
        "game_date, home_team_id, away_team_id, home_score, away_score, completed, status) "
        "VALUES (1, 'mlb', 2023, 2, '2023-04-01T20:00:00Z', '2023-04-01', 10, 20, 3, 1, 1, "
        "'STATUS_FINAL')")
    eid = 10
    relief_eid = 8000
    for year, start in ((2023, date(2023, 4, 5)), (2024, date(2024, 4, 5))):
        for i in range(6):
            day = (start + pd.Timedelta(days=3 * i)).strftime("%Y-%m-%d")
            prev = (start + pd.Timedelta(days=3 * i - 2)).strftime("%Y-%m-%d")
            _relief_day(c, relief_eid, prev)
            relief_eid += 1
            home_runs, away_runs = (5, 2) if i % 2 == 0 else (2, 5)
            _counted_game(c, eid, day, home_runs, away_runs)
            eid += 1
    _relief_day(c, 8999, "2026-11-20")
    _game(c, 900, "2026-12-01T20:00:00Z", "2026-12-01")
    _forecast(c, 900, prob=0.57, day="2026-12-01", table="upcoming_forecasts")
    for team, side, pitcher in ((10, "home", 1111), (20, "away", 1211)):
        _lineup(c, 900, team, side, pitcher)
    c.commit()
    c.close()

    monkeypatch.setattr(mp, "MIN_PUBLISH_GAMES", 10)
    assert mp._main(["--db", str(path), "--date", "2026-11-24"]) == 0

    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    fit = c.execute(
        "SELECT n_games, c_value FROM mlb_ridge_fits ORDER BY fit_id DESC").fetchone()
    assert fit["n_games"] == 12
    roles = {r["role"] for r in c.execute("SELECT role FROM mlb_player_state")}
    assert "batter" in roles and "pitcher" in roles
    live = c.execute(
        "SELECT mlb_model_src, home_prob FROM upcoming_forecasts "
        "WHERE espn_event_id = 900").fetchone()
    assert live["mlb_model_src"] == "stack_b"
    assert live["home_prob"] != 0.57


def _side(wv):
    feat = {k: 0.2 for k in mp.BASE_FEATS}
    feat["bat_wv"] = wv
    return feat


def test_training_row_label_side_diffs_and_drops():
    """The design row is a home win, the home-side logit, and home minus away.

    A tie, a missing feature, and a probability outside (0, 1) drop the row.
    A missing feature is not filled with zero. Training rows are date-ordered.
    """
    games = pd.DataFrame([
        {"espn_event_id": 1, "game_date": "2024-04-01", "home_team_id": 10,
         "away_team_id": 20, "home_score": 3, "away_score": 1, "completed": 1,
         "neutral_site": 0},
        {"espn_event_id": 2, "game_date": "2024-04-03", "home_team_id": 10,
         "away_team_id": 20, "home_score": 1, "away_score": 5, "completed": 1,
         "neutral_site": 0},
        {"espn_event_id": 3, "game_date": "2024-04-05", "home_team_id": 10,
         "away_team_id": 20, "home_score": 2, "away_score": 2, "completed": 1,
         "neutral_site": 0},
        {"espn_event_id": 4, "game_date": "2024-04-07", "home_team_id": 10,
         "away_team_id": 20, "home_score": 6, "away_score": 1, "completed": 1,
         "neutral_site": 0},
        {"espn_event_id": 5, "game_date": "2024-04-09", "home_team_id": 10,
         "away_team_id": 20, "home_score": 4, "away_score": 3, "completed": 1,
         "neutral_site": 0},
    ])
    games = games.iloc[[4, 0, 2, 1, 3]].reset_index(drop=True)
    sides = {}
    for eid in (1, 2, 3, 4, 5):
        sides[(eid, 10)] = _side(0.40)
        sides[(eid, 20)] = _side(0.20)
    sides[(4, 10)]["bp_q"] = float("nan")
    probs = {1: 0.70, 2: 0.40, 3: 0.55, 4: 0.60, 5: 1.2}
    frame = mp.stack_frame(sides, games, probs)
    assert list(frame["espn_event_id"]) == [2]
    assert int(frame.loc[0, "y"]) == 0
    assert frame.loc[0, "lt"] < 0
    assert abs(frame.loc[0, "lt"] - mp.logit(0.40)) < 1e-12
    assert abs(frame.loc[0, "d_bat_wv"] - 0.20) < 1e-12
    swapped = games.copy()
    mask = swapped["espn_event_id"] == 2
    swapped.loc[mask, "home_score"] = 5
    swapped.loc[mask, "away_score"] = 1
    flipped = mp.stack_frame(sides, swapped, probs)
    assert int(flipped.loc[flipped.espn_event_id == 2, "y"].iloc[0]) == 1
    assert abs(flipped.loc[flipped.espn_event_id == 2, "lt"].iloc[0] - frame.loc[0, "lt"]) < 1e-12
    assert abs(flipped.loc[flipped.espn_event_id == 2, "d_bat_wv"].iloc[0]
               - frame.loc[0, "d_bat_wv"]) < 1e-12
    earlier = frame.assign(espn_event_id=9, game_date="2024-04-02")
    ordered = mp.training_rows(pd.concat([frame, earlier], ignore_index=True), "2024-05-01")
    assert list(ordered["game_date"]) == ["2024-04-02", "2024-04-03"]
    home = _side(0.4)
    away = _side(0.2)
    assert mp.stack_vector(0.0, home, away, 2, 2, 0) is None
    assert mp.stack_vector(1.0, home, away, 2, 2, 0) is None
    assert mp.stack_vector(1.2, home, away, 2, 2, 0) is None


def test_production_frame_label_side_and_no_current_game_leak():
    """load_training_frame: y follows the score, lt is the home probability,
    and the current game's own box score is not in that game's features."""
    c = _db()
    c.execute(
        "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
        "game_date, home_team_id, away_team_id, home_score, away_score, completed, status) "
        "VALUES (1, 'mlb', 2023, 2, '2023-04-01T20:00:00Z', '2023-04-01', 10, 20, 4, 2, 1, "
        "'STATUS_FINAL')")
    _relief_day(c, 8001, "2023-04-02")
    _counted_game(c, 11, "2023-04-04", 5, 2)
    _relief_day(c, 8002, "2023-04-06")
    _counted_game(c, 12, "2023-04-07", 2, 5)
    frame = mp.load_training_frame(c, "2023-04-07").set_index("espn_event_id")
    assert int(frame.loc[11, "y"]) == 1
    assert int(frame.loc[12, "y"]) == 0
    assert abs(frame.loc[11, "lt"] - mp.logit(0.62)) < 1e-9
    assert frame.loc[12, "lt"] < 0
    assert abs(frame.loc[12, "lt"] - mp.logit(0.38)) < 1e-9
    before = float(frame.loc[12, "d_bat_wv"])
    c.execute("UPDATE player_game_mlb_batting SET h = 4 "
              "WHERE espn_event_id = 12 AND team_id = 10")
    again = mp.load_training_frame(c, "2023-04-07").set_index("espn_event_id")
    assert abs(float(again.loc[12, "d_bat_wv"]) - before) < 1e-9
    c.execute("UPDATE player_game_mlb_batting SET h = 4 "
              "WHERE espn_event_id = 11 AND team_id = 10")
    moved = mp.load_training_frame(c, "2023-04-07").set_index("espn_event_id")
    assert float(moved.loc[12, "d_bat_wv"]) > before + 0.01


def test_estimator_keeps_a_real_team_logit():
    """A home-win logit plus noise keeps the team spread and the home win rate.

    That fit passes the publish check. This is the estimator, not a score
    against a holdout.
    """
    est = mp.make_estimator()
    clf = est.named_steps["logisticregressioncv"]
    assert clf.scoring == "neg_log_loss"
    assert clf.cv == 5
    assert list(clf.l1_ratios) == [0.0]
    assert abs(float(np.min(clf.Cs)) - mp.C_FLOOR) < 1e-12
    rng = np.random.default_rng(0)
    n = 1200
    lt = rng.normal(0.0, 0.33, n)
    p = 1.0 / (1.0 + np.exp(-lt))
    frame = pd.DataFrame({name: rng.normal(0.0, 1.0, n) for name in mp.FEATURES})
    frame["lt"] = lt
    frame["y"] = rng.binomial(1, p)
    frame["game_date"] = pd.date_range("2023-04-01", periods=n, freq="D").strftime("%Y-%m-%d")
    frame["espn_event_id"] = np.arange(n)
    frame = frame.sample(frac=1.0, random_state=1).reset_index(drop=True)
    packed = mp.fit_matrix(frame, date(2027, 1, 1))
    rows = mp.training_rows(frame, date(2027, 1, 1))
    packed.update(mp.fit_diagnostics(rows, packed))
    assert mp.unpublished_reason(packed) is None
    assert packed["sd_p"] >= mp.MIN_SPREAD_RATIO * packed["sd_team"]
    assert abs(packed["mean_p"] - packed["win_rate"]) <= mp.MAX_MEAN_GAP


def test_crushed_team_logit_shrinks_the_probability_spread():
    """A lone standardized weight of 0.09 squeezes the fitted probabilities.

    The refit prints both standard deviations so this is visible. Other
    coefficients are zero here, which is the case the 3-4x squeeze describes.
    """
    rng = np.random.default_rng(1)
    n = 400
    frame = pd.DataFrame({name: np.zeros(n) for name in mp.FEATURES})
    frame["lt"] = rng.normal(0.0, 0.33, n)
    frame["y"] = 1
    fit = {
        "features": list(mp.FEATURES),
        "scaler_mean": [0.0] * len(mp.FEATURES),
        "scaler_scale": [1.0] * len(mp.FEATURES),
        "coef": [0.0] * len(mp.FEATURES),
        "intercept": 0.0,
    }
    fit["coef"][0] = 0.09
    sd_p, sd_team = mp.probability_spread(frame, fit)
    assert sd_team > 0.07
    assert sd_p < sd_team / 3.0


def test_existing_fit_table_gains_the_spread_columns():
    c = _db()
    for col in ("sd_p", "sd_team", "mean_p", "win_rate"):
        c.execute(f"ALTER TABLE mlb_ridge_fits DROP COLUMN {col}")
    db._migrate(c)
    have = {r[1] for r in c.execute("PRAGMA table_info(mlb_ridge_fits)")}
    assert {"sd_p", "sd_team", "mean_p", "win_rate"} <= have


def test_spread_guard_publishes_the_stored_fit_and_holds_a_squeeze():
    """C on the grid floor and a small lt weight still publish when the
    in-sample spread matches the team probability and the mean matches
    the home win rate. A squeezed fit, and a mean more than 0.03 off the
    win rate, are stored and stay on the team path.
    """
    healthy = {"sd_p": 0.081, "sd_team": 0.083, "mean_p": 0.530, "win_rate": 0.530}
    assert mp.unpublished_reason(healthy) is None
    edge = {"sd_p": mp.MIN_SPREAD_RATIO, "sd_team": 1.0,
            "mean_p": mp.MAX_MEAN_GAP, "win_rate": 0.0}
    assert mp.unpublished_reason(edge) is None
    squeezed = dict(healthy, sd_p=mp.MIN_SPREAD_RATIO - 1e-4, sd_team=1.0)
    assert "sd ratio" in mp.unpublished_reason(squeezed)
    off = dict(healthy, mean_p=mp.MAX_MEAN_GAP + 1e-4, win_rate=0.0)
    assert "mean gap" in mp.unpublished_reason(off)
    assert "no spread" in mp.unpublished_reason({"mean_p": 0.53, "win_rate": 0.53})

    c = _db()
    _arm(c, n_games=2000)
    c.execute("DELETE FROM mlb_ridge_fits")
    _store_fit(c, 2000, c_value=mp.C_FLOOR, lt=0.09)
    published = mp.overlay(c, _frame(), AS_OF)
    assert published.loc[0, "mlb_model_src"] == "stack_b"
    assert published.loc[0, "home_prob"] == 0.6
    stored = mp.load_fit(c)
    assert stored["n_games"] == 2000
    assert mp.unpublished_reason(stored) is None

    c.execute("DELETE FROM mlb_ridge_fits")
    _store_fit(c, 2000, sd_p=0.020, sd_team=0.083)
    held = mp.overlay(c, _frame(), AS_OF)
    assert held.loc[0, "mlb_model_src"] == "team"
    assert held.loc[0, "home_prob"] == 0.55
    assert mp.load_fit(c)["n_games"] == 2000
    assert "sd ratio" in mp.unpublished_reason(mp.load_fit(c))

    c.execute("DELETE FROM mlb_ridge_fits")
    _store_fit(c, 2000, mean_p=0.570, win_rate=0.530)
    gap = mp.overlay(c, _frame(), AS_OF)
    assert gap.loc[0, "mlb_model_src"] == "team"
    assert gap.loc[0, "home_prob"] == 0.55
    assert "mean gap" in mp.unpublished_reason(mp.load_fit(c))


def test_ridge_alert_threshold_and_offseason_skip():
    c = _db()
    assert daily.in_season(c, "mlb", date(2026, 11, 24)) is False
    _game(c, 920, "2026-07-15T20:00:00Z")
    _forecast(c, 920, prob=0.50)
    c.execute("UPDATE forecast_snapshots SET mlb_model_src='stack_b', mlb_ridge_prob=0.60, "
              "mlb_team_prob=0.50 WHERE espn_event_id=920")
    assert mp and daily
    from bayesratings.sources import check
    assert check.mlb_ridge_alerts(c, DAY) is None
    c.execute("UPDATE forecast_snapshots SET mlb_ridge_prob=0.61 WHERE espn_event_id=920")
    msg = check.mlb_ridge_alerts(c, DAY)
    assert msg.startswith("ridge vs team:") and "AWY@HOM" in msg and "pts" in msg
    c.execute("UPDATE forecast_snapshots SET mlb_ridge_prob=0.49, mlb_team_prob=0.51 "
              "WHERE espn_event_id=920")
    assert "favorite flips" in check.mlb_ridge_alerts(c, DAY)
