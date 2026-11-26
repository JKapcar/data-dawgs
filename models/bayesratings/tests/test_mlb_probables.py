"""MLB probable starters stay fresh up to first pitch.

The :15/:45 pass updates game_probables and rewrites an unlocked forecast
when the pitcher changed. A locked forecast, a game inside the lock margin,
and a day with no games are left alone. The morning check WARNs when a game
within 3 hours of first pitch has a stale or missing probable.
Run: PYTHONPATH=. python tests/test_mlb_probables.py
"""
import sqlite3
from datetime import datetime, timedelta, timezone

from bayesratings import db, starters
from bayesratings.sources import check, mlb


NOW = datetime(2026, 7, 15, 18, 0, tzinfo=timezone.utc)   # 1:00 PM CT
AT = "2026-07-15T18:00:00+00:00"
EARLIER = "2026-07-15T12:00:00+00:00"


def test_probable_changed_is_the_athlete_not_the_timestamp():
    before = {1: {10: 111, 20: 333}, 2: {10: 111}}
    assert starters.probable_changed(before, {1: {10: 111, 20: 333}, 2: {10: 111}}) == []
    assert starters.probable_changed(before, {1: {10: 222, 20: 333}, 2: {10: 111}}) == [1]
    assert starters.probable_changed(before, {1: {10: 111}, 2: {10: 111}}) == [1]
    assert starters.probable_changed(before, {1: {10: 111, 20: 333}}) == [2]


def test_team_chance_moves_the_logit():
    assert starters.team_chance(0.5, 0.2, 1.0) == 0.5498
    assert starters.team_chance(0.5, 0.0, 3.0) == 0.5
    assert abs(starters.recover_coef(0.5, 0.5498, 1.0) - 0.2) < 1e-3
    assert starters.recover_coef(0.5, 0.55, 0.01) is None


def test_freshness_only_games_near_first_pitch():
    soon = NOW + timedelta(hours=2)
    later = NOW + timedelta(hours=5)
    started = NOW - timedelta(minutes=10)
    fresh = NOW - timedelta(minutes=30)
    old = NOW - timedelta(hours=4)
    starts = {1: soon, 2: soon, 3: later, 4: started}
    seen = {1: [fresh, fresh], 2: [old, fresh], 3: [old], 4: [old, old]}
    rows = {e: (ok, why) for e, ok, why in mlb.probable_freshness(starts, seen, NOW)}
    assert rows[1] == (True, "fresh")
    assert rows[2][0] is False and rows[2][1] == "stale"
    assert 3 not in rows and 4 not in rows
    missing = mlb.probable_freshness({1: soon}, {1: [fresh]}, NOW)
    assert missing == [(1, False, "missing")]
    assert mlb.freshness_summary([]) is None
    level, msg = mlb.freshness_summary(mlb.probable_freshness(starts, seen, NOW))
    assert level == "WARN" and msg.startswith("1/2 games within 3h")
    assert "150 min" in msg


def _db():
    c = db.connect(":memory:")
    db.init_db(c)
    c.execute("INSERT INTO teams (team_id, league, espn_id, name, abbreviation) VALUES (10,'mlb',110,'Home','HOM')")
    c.execute("INSERT INTO teams (team_id, league, espn_id, name, abbreviation) VALUES (20,'mlb',120,'Away','AWY')")
    # two earlier starts so the two home pitchers are not the same quality
    for eid, day, tid, opp, aid, runs in (
            (1, "2026-06-01", 10, 20, 111, 1),
            (2, "2026-06-02", 10, 20, 222, 20),
            (3, "2026-06-01", 20, 10, 333, 8)):
        c.execute("INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
                  "game_date, home_team_id, away_team_id, completed) VALUES (?,?,2026,2,?,?,?,?,1)",
                  (eid, "mlb", day + "T23:00:00Z", day, tid, opp))
        c.execute("INSERT INTO player_game_mlb_pitching (espn_event_id, season, season_type, game_date, "
                  "team_id, opp_team_id, is_home, athlete_id, starter, pitch_order, outs, r, stats_json) "
                  "VALUES (?,?,2,?,?,?,?,?,1,1,60,?, '{}')",
                  (eid, 2026, day, tid, opp, 1 if tid == 10 else 0, aid, runs))
    return c


def _game(c, eid, start, date="2026-07-15"):
    c.execute("INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
              "game_date, home_team_id, away_team_id, completed, status) "
              "VALUES (?, 'mlb', 2026, 2, ?, ?, 10, 20, 0, 'STATUS_SCHEDULED')",
              (eid, start, date))


def _forecast(c, eid, prob, date="2026-07-15"):
    c.execute(
        "INSERT INTO forecast_snapshots (snapshot_date, league, espn_event_id, game_date, "
        "home_team_id, away_team_id, home_prob, away_prob, home_spread, total_pred, "
        "home_total_pred, away_total_pred, backfilled, home_starter_id, away_starter_id, "
        "home_starter_src, away_starter_src, home_starter_rel, away_starter_rel, "
        "home_prob_base, starter_coef, player_prob_base, player_spread_base, player_total_base, "
        "player_home_total_base, player_away_total_base, home_player_x, away_player_x, "
        "home_player_x2, away_player_x2, elo_weight) VALUES "
        "(?,?,?,?,10,20,?,?, -1.5, 8.5, 5.0, 3.5, 0, 111, 333, 'espn', 'espn', 0, 0, "
        "0.5, 1.0, ?, -1.5, 8.5, 5.0, 3.5, 0, 0, 0, 0, 0)",
        (date, "mlb", eid, date, prob, round(1 - prob, 4), prob))


def _board(games):
    """games: [(eid, home_pid, away_pid)]."""
    events = []
    for eid, hp, ap in games:
        events.append({
            "id": str(eid),
            "competitions": [{
                "status": {"type": {"name": "STATUS_SCHEDULED"}},
                "competitors": [
                    {"homeAway": "home", "team": {"id": "110"},
                     "probables": [{"abbreviation": "SP", "athlete": {"id": str(hp), "displayName": "Home"}}]},
                    {"homeAway": "away", "team": {"id": "120"},
                     "probables": [{"abbreviation": "SP", "athlete": {"id": str(ap), "displayName": "Away"}}]},
                ],
            }],
        })
    return {"events": events}


def _prob(c, eid):
    return c.execute("SELECT home_prob, home_starter_id, away_starter_id FROM forecast_snapshots "
                     "WHERE espn_event_id=?", (eid,)).fetchone()


def test_offseason_makes_no_request():
    c = _db()
    calls = []

    def fetch(league, dates=None):
        calls.append(dates)
        return {"events": []}

    st = mlb.probables_pass(c, lambda fn, *a, **k: fn(*a, **k), NOW, fetch_fn=fetch)
    assert st["skipped"] == "no MLB games" and st["errors"] == 0 and calls == []


def test_changed_pitcher_refreshes_unlocked_forecasts_only():
    c = _db()
    _game(c, 800, "2026-07-15T20:00:00Z")          # 2h out, pitcher changes
    _game(c, 801, "2026-07-15T22:00:00Z")          # pitcher stays
    _game(c, 802, "2026-07-15T21:00:00Z")          # locked
    _game(c, 803, "2026-07-15T18:02:00Z")          # inside the 5-minute margin
    for eid, p in ((800, 0.50), (801, 0.55), (802, 0.40), (803, 0.45)):
        _forecast(c, eid, p)
    c.execute("INSERT INTO forecast_locks (espn_event_id, league, locked_at, "
              "home_prob, home_spread, total_pred) VALUES "
              "(802,'mlb',?,0.40,-1.0,8.0)", (EARLIER,))
    old = _board([(800, 111, 333), (801, 111, 333), (802, 111, 333), (803, 111, 333)])
    from bayesratings.prelog import parse_scoreboard, store_scoreboard
    store_scoreboard(c, "mlb", parse_scoreboard(old, "mlb"), EARLIER)
    new = _board([(800, 222, 333), (801, 111, 333), (802, 222, 333), (803, 222, 333)])
    calls = []

    def fetch(league, dates=None):
        calls.append((league, dates))
        return new

    st = mlb.probables_pass(c, lambda fn, *a, **k: fn(*a, **k), NOW, fetch_fn=fetch)
    assert st["errors"] == 0 and st["starter_changes"] == 3 and calls == [("mlb", "20260715")]
    moved = _prob(c, 800)
    assert int(moved[1]) == 222 and int(moved[2]) == 333
    assert moved[0] != 0.50                      # the new pitcher's edge moved the chance
    assert abs(moved[0] - 0.5) > 0.01
    assert _prob(c, 801)[0] == 0.55              # same pitcher: forecast untouched
    assert _prob(c, 802)[0] == 0.40 and int(_prob(c, 802)[1]) == 111
    assert _prob(c, 803)[0] == 0.45 and int(_prob(c, 803)[1]) == 111
    again = mlb.probables_pass(c, lambda fn, *a, **k: fn(*a, **k), NOW, fetch_fn=fetch)
    assert again.get("starter_changes", 0) == 0
    assert _prob(c, 800)[0] == moved[0]          # a second pass does not stack the shift


def test_check_warns_only_when_a_game_is_soon_and_stale():
    c = _db()
    assert all(src != "mlb_probables" for src, _, _ in check.check(c, NOW))
    _game(c, 810, "2026-07-15T20:00:00Z")        # 2h out
    _game(c, 811, "2026-07-15T23:30:00Z")        # 5.5h out: ignored even if stale
    from bayesratings.prelog import parse_scoreboard, store_scoreboard
    stale = _board([(810, 111, 333), (811, 111, 333)])
    store_scoreboard(c, "mlb", parse_scoreboard(stale, "mlb"), EARLIER)   # 6h before NOW
    line = {src: (lvl, msg) for src, lvl, msg in check.check(c, NOW)}
    assert line["mlb_probables"][0] == "WARN"
    assert line["mlb_probables"][1].startswith("0/1")
    store_scoreboard(c, "mlb", parse_scoreboard(stale, "mlb"), AT)        # seen just now
    line = {src: (lvl, msg) for src, lvl, msg in check.check(c, NOW)}
    assert line["mlb_probables"] == ("OK", "1/1 games within 3h of first pitch have a probable under 150 min old")


def test_missing_probable_is_a_warn():
    c = _db()
    _game(c, 820, "2026-07-15T19:00:00Z")
    line = {src: (lvl, msg) for src, lvl, msg in check.check(c, NOW)}
    assert line["mlb_probables"][0] == "WARN"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
