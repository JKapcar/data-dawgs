"""MLB box-score and Statcast batted-ball parsing, the no-op when nothing
finished, idempotent stores, and the loader's ESPN link. No network and no
accuracy backtest.

    PYTHONPATH=. python tests/test_mlb_extra.py
"""
import importlib.util
import json
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path

from bayesratings import db
from bayesratings.backfill import Pacer
from bayesratings.sources import check, mlb_box, mlb_extra, mlb_statcast

ROOT = Path(__file__).resolve().parents[1]
FIX = json.loads((ROOT / "tests" / "fixtures" / "sources" / "mlb_extra_min.json").read_text())
NOW = datetime(2026, 11, 22, 13, 30, tzinfo=timezone.utc)  # 07:30 CT
BOX = json.dumps(FIX["box"]).encode()
DAY = "2026-11-21"


def _db():
    conn = db.connect(":memory:")
    conn.isolation_level = None
    db.init_db(conn)
    return conn


def _team(conn, espn_id, abbr, name):
    conn.execute("INSERT INTO teams (league, espn_id, abbreviation, name) VALUES ('mlb', ?, ?, ?)",
                 (espn_id, abbr, name))
    return conn.execute("SELECT team_id FROM teams WHERE league = 'mlb' AND espn_id = ?",
                        (espn_id,)).fetchone()[0]


def _player(conn, athlete_id, name, team_id):
    conn.execute("INSERT INTO players (league, athlete_id, name, team_id) VALUES ('mlb', ?, ?, ?)",
                 (athlete_id, name, team_id))
    conn.execute("INSERT INTO player_team_seasons (league, athlete_id, season, team_id, games) "
                 "VALUES ('mlb', ?, 2026, ?, 10)", (athlete_id, team_id))


def _final(conn, eid, home, away, game_date=DAY, status="STATUS_FINAL", completed=1,
           start="2026-11-21T23:10:00Z"):
    conn.execute(
        "INSERT INTO games (espn_event_id, league, season, season_type, start_time_utc, "
        "game_date, home_team_id, away_team_id, home_score, away_score, completed, status) "
        "VALUES (?, 'mlb', 2026, 2, ?, ?, ?, ?, 4, 2, ?, ?)",
        (eid, start, game_date, home, away, completed, status))


def _meta():
    games = mlb_box.finished_games(FIX["schedule"])
    mlb_box.apply_abbrevs(games, mlb_box.parse_teams(FIX["teams"]))
    return games[0]


def _rows(rows, *keys):
    out = {}
    for r in rows:
        key = tuple(r[k] for k in keys)
        out[key if len(keys) > 1 else key[0]] = r
    return out


def test_parse_box_keeps_the_gap_fields_and_one_row_for_a_two_way_player():
    meta = _meta()
    assert meta["home_abbrev"] == "DET" and meta["away_abbrev"] == "CWS"
    assert meta["game_pk"] == 778445 and meta["home_score"] == 4
    rows = _rows(mlb_box.parse_box(FIX["box"], meta), "mlb_person_id")
    assert set(rows) == {101, 201, 202, 301}
    malloy = rows[101]
    assert malloy["name"] == "Justyn-Henry Malloy" and malloy["bat_order"] == 1
    assert (malloy["doubles"], malloy["triples"], malloy["home_runs"], malloy["hit_by_pitch"],
            malloy["sac_flies"], malloy["sac_bunts"]) == (1, 1, 0, 1, 1, 0)
    assert malloy["plate_appearances"] == 4 and malloy["total_bases"] == 3
    assert malloy["stolen_bases"] == 1 and malloy["intentional_walks"] == 1
    assert malloy["p_batters_faced"] is None
    two_way = rows[201]
    assert two_way["doubles"] == 0 and two_way["bat_order"] == 9
    assert two_way["p_hit_batters"] == 1 and two_way["p_wild_pitches"] == 1
    assert two_way["p_batters_faced"] == 22 and two_way["p_games_started"] == 1
    assert two_way["p_wins"] == 1 and two_way["p_doubles"] == 1
    # hitBatsmen is absent; hitByPitch fills it. He did not bat.
    reliever = rows[301]
    assert reliever["p_hit_batters"] == 2 and reliever["p_balks"] == 1
    assert reliever["p_holds"] == 1 and reliever["doubles"] is None
    assert rows[202]["sac_bunts"] == 1 and rows[202]["home_runs"] == 1
    bad = dict(meta, home_mlb_id=1)
    try:
        mlb_box.parse_box(FIX["box"], bad)
        raise AssertionError("team mismatch should fail")
    except ValueError:
        pass
    assert mlb_box.bat_slot("100") == 1 and mlb_box.bat_slot("901") == 9
    assert mlb_box.bat_slot("0") is None
    assert mlb_box.canon_abbr("FLA") == "MIA" and mlb_box.canon_abbr("CWS") == "CHW"
    assert mlb_box.canon_abbr("ANA") == "LAA" and mlb_box.canon_abbr("DET") == "DET"
    assert mlb_box.team_name_key("Florida Marlins") == "miami marlins"
    postponed = json.loads(json.dumps(FIX["schedule"]))
    postponed["dates"][0]["games"][0]["status"] = {
        "abstractGameState": "Postponed", "detailedState": "Postponed"}
    assert mlb_box.finished_games(postponed) == []


def test_parse_csv_drops_pitches_and_fouls_and_aggregates_both_sides():
    events, games, n_rows = mlb_statcast.parse_csv(FIX["csv"])
    assert n_rows == 6 and len(events) == 3
    assert set(games) == {778445}
    assert games[778445]["home_score"] == 1 and games[778445]["away_score"] == 1
    assert games[778445]["n_batted"] == 3
    by = {(e["batter"], e["events"]): e for e in events}
    out = by[(101, "field_out")]
    assert out["hit_distance"] == 341 and out["launch_speed"] == 99.6
    assert out["estimated_woba_using_speedangle"] == 0.123
    assert out["barrel"] == 0 and out["batter_name"] == "Justyn-Henry Malloy"
    assert out["bat_team"] == "CWS" and out["bat_home"] == 0
    assert by[(102, "home_run")]["barrel"] == 1
    assert by[(201, "single")]["barrel"] == 0 and by[(201, "single")]["bat_home"] == 1
    rows = _rows(mlb_statcast.aggregate(events), "mlb_person_id", "role")
    malloy = rows[(101, "batter")]
    assert malloy["batted_balls"] == 1 and malloy["hard_hit"] == 1 and malloy["barrels"] == 0
    assert malloy["avg_ev"] == 99.6 and malloy["xwoba_sum"] == 0.123 and malloy["xwoba_n"] == 1
    assert malloy["is_home"] == 0 and malloy["name"] == "Justyn-Henry Malloy"
    hr = rows[(102, "batter")]
    assert hr["barrels"] == 1 and hr["hard_hit"] == 1 and hr["xwoba_sum"] == 1.9
    single = rows[(201, "batter")]
    assert single["hard_hit"] == 0 and single["barrels"] == 0 and single["avg_ev"] == 70
    assert single["is_home"] == 1 and single["team_abbrev"] == "DET"
    pit = rows[(201, "pitcher")]
    assert pit["batted_balls"] == 2 and pit["hard_hit"] == 2 and pit["barrels"] == 1
    assert round(pit["avg_ev"], 4) == 103.2 and pit["xwoba_n"] == 2
    assert round(pit["xwoba_sum"], 5) == 2.023 and pit["is_home"] == 1 and pit["name"] is None
    other = rows[(301, "pitcher")]
    assert other["batted_balls"] == 1 and other["is_home"] == 0 and other["team_abbrev"] == "CWS"
    assert mlb_statcast.barrel_window(97) is None
    assert mlb_statcast.barrel_window(98) == (26.0, 30.0)
    assert mlb_statcast.barrel_window(99) == (25.0, 31.0)
    assert mlb_statcast.is_barrel(104.8, 40, None) == 1
    assert mlb_statcast.is_barrel(104.8, 41, None) == 0
    assert mlb_statcast.is_barrel(116, 8, None) == 1
    assert mlb_statcast.is_barrel(90, 28, "6") == 1
    assert mlb_statcast.is_barrel(110, 25, "3") == 0
    try:
        mlb_statcast.parse_csv(
            "pitch_type,game_pk,type,game_type,game_date,batter,pitcher,at_bat_number,pitch_number\n"
            "FF,5,X,R,2026-11-21,1,2,,1\n")
        raise AssertionError("a batted ball needs its key")
    except ValueError:
        pass
    try:
        mlb_statcast.csv_text(b"<html>")
        raise AssertionError("html is not a csv")
    except ValueError:
        pass
    hard = mlb_statcast.aggregate([
        {"game_pk": 1, "batter": 1, "pitcher": 2, "game_date": DAY, "season": 2026,
         "bat_team": "DET", "bat_home": 1, "pit_team": "CWS", "pit_home": 0,
         "batter_name": None, "launch_speed": 95.0, "barrel": 0,
         "estimated_woba_using_speedangle": 0.4},
        {"game_pk": 1, "batter": 1, "pitcher": 2, "game_date": DAY, "season": 2026,
         "bat_team": "DET", "bat_home": 1, "pit_team": "CWS", "pit_home": 0,
         "batter_name": None, "launch_speed": 94.9, "barrel": 0,
         "estimated_woba_using_speedangle": None},
    ])
    pitcher = _rows(hard, "mlb_person_id", "role")[(2, "pitcher")]
    assert pitcher["hard_hit"] == 1 and pitcher["batted_balls"] == 2 and pitcher["xwoba_n"] == 1


def test_date_windows_are_three_days_and_a_gap_starts_a_new_one():
    wins = mlb_statcast.date_windows(
        ["2025-04-05", "2025-04-06", "2025-04-07", "2025-04-08", "2025-04-12"])
    assert [(a.isoformat(), b.isoformat(), days) for a, b, days in wins] == [
        ("2025-04-05", "2025-04-07", ["2025-04-05", "2025-04-06", "2025-04-07"]),
        ("2025-04-08", "2025-04-08", ["2025-04-08"]),
        ("2025-04-12", "2025-04-12", ["2025-04-12"]),
    ]


def test_choose_one_splits_a_doubleheader_by_start_then_score():
    later = {"espn_event_id": 2, "start_time_utc": "2026-11-21T23:10:00Z",
             "game_date": DAY, "home_score": 4, "away_score": 2}
    early = {"espn_event_id": 1, "start_time_utc": "2026-11-21T17:00:00Z",
             "game_date": DAY, "home_score": 1, "away_score": 2}
    assert mlb_box.choose_one([early, later], start_utc=later["start_time_utc"])["espn_event_id"] == 2
    close = [
        {"espn_event_id": 1, "start_time_utc": "2026-11-21T23:00:00Z", "game_date": DAY,
         "home_score": 1, "away_score": 0},
        {"espn_event_id": 2, "start_time_utc": "2026-11-21T23:20:00Z", "game_date": DAY,
         "home_score": 4, "away_score": 2},
    ]
    assert mlb_box.choose_one(close, start_utc="2026-11-21T23:10:00Z",
                              home_score=4, away_score=2)["espn_event_id"] == 2
    same = [dict(close[0], home_score=4, away_score=2), close[1]]
    assert mlb_box.choose_one(same, start_utc="2026-11-21T23:10:00Z",
                              home_score=4, away_score=2) is None


def test_store_is_idempotent_and_a_new_body_replaces():
    conn = _db()
    meta = _meta()
    assert mlb_box.store_game(conn, BOX, meta, at="t1", link=False) == 4
    assert mlb_box.store_game(conn, BOX, meta, at="t2", espn_event_id=77, link=False) == 0
    assert conn.execute("SELECT COUNT(*) FROM mlb_box_players").fetchone()[0] == 4
    assert tuple(conn.execute("SELECT espn_event_id, fetched_at FROM mlb_box_games").fetchone()) == (77, "t1")
    assert conn.execute("SELECT value FROM src_meta WHERE key = 'mlb_box:778445'").fetchone()[0]
    body = json.loads(BOX)
    body["teams"]["away"]["players"]["ID101"]["stats"]["batting"]["doubles"] = 2
    assert mlb_box.store_game(conn, json.dumps(body).encode(), meta, at="t3", link=False) == 4
    assert conn.execute("SELECT doubles FROM mlb_box_players WHERE mlb_person_id = 101").fetchone()[0] == 2
    assert conn.execute("SELECT fetched_at FROM mlb_box_games").fetchone()[0] == "t3"


def test_statcast_store_is_idempotent_and_a_short_day_is_not_marked():
    conn = _db()
    events, games, _n = mlb_statcast.parse_csv(FIX["csv"])
    st = mlb_statcast.store_parsed(conn, events, games, [DAY], {DAY: 1}, at="t1")
    assert st["errors"] == 0 and st["rows"] == 3 and st["dates"] == 1
    again = mlb_statcast.store_parsed(conn, events, games, [DAY], {DAY: 1}, at="t2")
    assert again["rows"] == 0 and again["errors"] == 0
    assert conn.execute("SELECT COUNT(*) FROM mlb_statcast_dates").fetchone()[0] == 1
    assert conn.execute("SELECT fetched_at FROM mlb_statcast_dates").fetchone()[0] == "t1"
    assert conn.execute("SELECT COUNT(*) FROM mlb_batted_balls").fetchone()[0] == 3
    short = _db()
    st = mlb_statcast.store_parsed(short, events, games, [DAY], {DAY: 2}, at="t1")
    assert st["errors"] == 1
    assert short.execute("SELECT COUNT(*) FROM mlb_statcast_dates").fetchone()[0] == 0
    assert short.execute("SELECT COUNT(*) FROM mlb_batted_balls").fetchone()[0] == 3
    assert short.execute("SELECT COUNT(*) FROM src_meta WHERE key = 'mlb_statcast:2026-11-21'").fetchone()[0] == 0


def test_a_capped_window_splits_and_a_capped_day_is_not_stored():
    conn = _db()
    d1, d2 = "2026-11-21", "2026-11-22"

    def row(gdate, pitch, kind="B"):
        return ("FF,{g},2026,R,778445,DET,CWS,101,201,Name,single,{k},fly_ball,100,20,300,"
                "0.5,0.4,0.9,,1,{p},Top,0,0\n").format(g=gdate, k=kind, p=pitch)

    header = ("pitch_type,game_date,game_year,game_type,game_pk,home_team,away_team,batter,"
              "pitcher,player_name,events,type,bb_type,launch_speed,launch_angle,hit_distance_sc,"
              "estimated_ba_using_speedangle,estimated_woba_using_speedangle,woba_value,"
              "launch_speed_angle,at_bat_number,pitch_number,inning_topbot,post_home_score,"
              "post_away_score\n")

    def fetch(url, **_kw):
        if "game_date_gt=2026-11-21" in url and "game_date_lt=2026-11-22" in url:
            return (header + row(d1, 1) + row(d1, 2) + row(d2, 1)).encode()
        if "game_date_gt=2026-11-21" in url:
            return (header + row(d1, 1, "X")).encode()
        if "game_date_gt=2026-11-22" in url:
            return (header + row(d2, 1) + row(d2, 2) + row(d2, 3)).encode()
        raise AssertionError(url)

    old = mlb_statcast.ROW_CAP
    mlb_statcast.ROW_CAP = 2
    try:
        st = mlb_statcast.pull_window(conn, Pacer(0), fetch, [d1, d2], {d1: 1, d2: 1},
                                      log=lambda *_a: None)
    finally:
        mlb_statcast.ROW_CAP = old
    assert st["errors"] == 1 and st["dates"] == 1
    assert conn.execute("SELECT game_date FROM mlb_statcast_dates").fetchone()[0] == d1
    assert conn.execute("SELECT COUNT(*) FROM mlb_batted_balls WHERE game_date = ?", (d2,)).fetchone()[0] == 0


def _fetch(calls):
    def fetch(url, **_kw):
        calls.append(url)
        if url.endswith("/robots.txt"):
            return b"User-agent: *\nAllow: /\n"
        if "/teams?" in url:
            return json.dumps(FIX["teams"]).encode()
        if "/schedule?" in url:
            return json.dumps(FIX["schedule"]).encode()
        if url.endswith("/boxscore"):
            return BOX
        if "statcast_search" in url:
            return FIX["csv"].encode()
        raise AssertionError(url)
    return fetch


def test_pass_is_a_no_op_without_finished_games_and_idempotent_after():
    conn = _db()
    calls = []
    fetch = _fetch(calls)
    assert mlb_box.current_pass(conn, Pacer(0), now=NOW, log=lambda *_: None, fetch=fetch) == {
        "skipped": "no new finished games"}
    assert mlb_statcast.current_pass(conn, Pacer(0), now=NOW, log=lambda *_: None, fetch=fetch) == {
        "skipped": "no new finished games"}
    assert calls == []
    det = _team(conn, 116, "DET", "Detroit Tigers")
    chw = _team(conn, 145, "CHW", "Chicago White Sox")
    _player(conn, 33499, "Justyn-Henry Malloy", chw)
    _final(conn, 77, det, chw)
    _final(conn, 78, det, chw, status="STATUS_POSTPONED")
    today = date(2026, 11, 22)
    assert [p["espn_event_id"] for p in mlb_box.pending_games(conn, today)] == [77]
    assert mlb_statcast._open_dates(conn, today) == {DAY: 1}
    box = mlb_box.current_pass(conn, Pacer(0), now=NOW, log=lambda *_: None, fetch=fetch)
    assert box["games"] == 1 and box["rows"] == 4 and box["errors"] == 0
    sc = mlb_statcast.current_pass(conn, Pacer(0), now=NOW, log=lambda *_: None, fetch=fetch)
    assert sc["dates"] == 1 and sc["errors"] == 0 and sc["rows"] == 3
    n_calls = len(calls)
    assert any(u.endswith("/boxscore") for u in calls)
    assert any("statcast_search" in u for u in calls)
    assert mlb_box.current_pass(conn, Pacer(0), now=NOW, log=lambda *_: None, fetch=fetch)["skipped"]
    assert mlb_statcast.current_pass(conn, Pacer(0), now=NOW, log=lambda *_: None, fetch=fetch)["skipped"]
    assert len(calls) == n_calls
    assert conn.execute("SELECT espn_event_id FROM mlb_box_games").fetchone()[0] == 77
    assert conn.execute("SELECT espn_event_id FROM mlb_statcast_games").fetchone()[0] == 77
    assert conn.execute("SELECT athlete_id FROM mlb_box_players WHERE mlb_person_id = 101").fetchone()[0] == 33499


def test_check_line_is_absent_without_recent_games():
    conn = _db()
    assert mlb_extra.extra_freshness(conn, NOW) is None
    res = check.check(conn, NOW, daily_status="/nonexistent")
    assert all(src != "mlb_extra" for src, _, _ in res)
    det = _team(conn, 116, "DET", "Detroit Tigers")
    chw = _team(conn, 145, "CHW", "Chicago White Sox")
    _final(conn, 79, det, chw, status="STATUS_POSTPONED")
    assert mlb_extra.extra_freshness(conn, NOW) is None
    _final(conn, 77, det, chw)
    assert mlb_extra.extra_freshness(conn, NOW)[0] == "FAIL"
    meta = _meta()
    mlb_box.store_game(conn, BOX, meta, at="t1", espn_event_id=77, link=False)
    assert mlb_extra.extra_freshness(conn, NOW)[0] == "FAIL"
    events, games, _n = mlb_statcast.parse_csv(FIX["csv"])
    mlb_statcast.store_parsed(conn, events, games, [DAY], {DAY: 1}, at="t1")
    level, msg = mlb_extra.extra_freshness(conn, NOW)
    assert level == "OK" and msg.startswith("1 ")
    res = {src: lvl for src, lvl, _ in check.check(conn, NOW, daily_status="/nonexistent")}
    assert res["mlb_extra"] == "OK"


def test_backfill_skips_stored_games_and_statcast_starts_in_2015():
    conn = _db()
    calls = []
    fetch = _fetch(calls)
    early = mlb_statcast.backfill(conn, Pacer(0), 2014, 2014, fetch=fetch, log=lambda *_: None)
    assert early == {"games": 0, "rows": 0, "dates": 0, "errors": 0} and calls == []
    assert mlb_box.backfill(conn, Pacer(0), 2005, 2005, fetch=fetch, log=lambda *_: None)["games"] == 0
    assert calls == []
    st = mlb_extra.backfill(conn, Pacer(0), 2026, 2026, fetch=fetch, log=lambda *_: None)
    assert st["errors"] == 0 and st["box"]["games"] == 1 and st["statcast"]["dates"] == 1
    assert any(u.endswith("/boxscore") for u in calls)
    assert any("statcast_search" in u for u in calls)
    n = len(calls)
    again = mlb_extra.backfill(conn, Pacer(0), 2026, 2026, fetch=fetch, log=lambda *_: None)
    assert again["errors"] == 0 and again["box"]["games"] == 0 and again["statcast"]["dates"] == 0
    assert not any(u.endswith("/boxscore") or "statcast_search" in u for u in calls[n:])


def test_load_attaches_links_and_is_idempotent():
    with tempfile.TemporaryDirectory() as d:
        src_path, dst_path = Path(d) / "mlb_extra_2026.db", Path(d) / "main.db"
        src, dst = db.connect(src_path), db.connect(dst_path)
        src.isolation_level = dst.isolation_level = None
        db.init_db(src)
        db.init_db(dst)
        meta = _meta()
        assert mlb_box.store_game(src, BOX, meta, at="t1", link=False) == 4
        events, games, _n = mlb_statcast.parse_csv(FIX["csv"])
        st = mlb_statcast.store_parsed(src, events, games, [DAY], {DAY: 1}, at="t1")
        assert st["dates"] == 1
        det = _team(dst, 116, "DET", "Detroit Tigers")
        chw = _team(dst, 145, "CHW", "Chicago White Sox")
        _player(dst, 33499, "Justyn-Henry Malloy", chw)
        _player(dst, 592450, "Tarik Skubal", det)
        _final(dst, 77, det, chw)
        first = mlb_extra.load_into(dst, src_path)
        assert first["mlb_box_players"] == 4 and first["mlb_batted_balls"] == 3
        assert first["games_linked"] == 2 and first["players_linked"] >= 2
        assert dst.execute("SELECT espn_event_id FROM mlb_box_games").fetchone()[0] == 77
        assert dst.execute("SELECT espn_event_id FROM mlb_statcast_games").fetchone()[0] == 77
        assert dst.execute("SELECT athlete_id FROM mlb_box_players WHERE mlb_person_id = 101").fetchone()[0] == 33499
        pit = dst.execute("SELECT name, athlete_id FROM mlb_batted_players "
                          "WHERE mlb_person_id = 201 AND role = 'pitcher'").fetchone()
        assert pit["name"] == "Tarik Skubal" and pit["athlete_id"] == 592450
        assert dst.execute("SELECT COUNT(*) FROM src_meta WHERE key = 'mlb_box:778445'").fetchone()[0] == 1
        assert dst.execute("SELECT COUNT(*) FROM src_meta WHERE key = ?",
                           (f"mlb_statcast:{DAY}",)).fetchone()[0] == 1
        second = mlb_extra.load_into(dst, src_path)
        assert second["mlb_batted_balls"] == 3 and second["games_linked"] == 2
        assert dst.execute("SELECT COUNT(*) FROM mlb_box_players").fetchone()[0] == 4
        assert dst.execute("SELECT COUNT(*) FROM mlb_batted_balls").fetchone()[0] == 3
        assert dst.execute("SELECT espn_event_id FROM mlb_box_games").fetchone()[0] == 77
        assert dst.execute("SELECT athlete_id FROM mlb_batted_players "
                           "WHERE mlb_person_id = 101 AND role = 'batter'").fetchone()[0] == 33499
        src.close()
        dst.close()


def test_script_argv_maps_onto_the_module():
    def load(name):
        spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    back = load("backfill_mlb_extra")
    got = back._argv(["--out", "mlb_extra_2016.db", "--from-season", "2016", "--to-season", "2016"])
    assert got == ["--backfill", "--db", "mlb_extra_2016.db", "--from-season", "2016",
                   "--to-season", "2016"]
    loader = load("load_mlb_extra")
    assert loader._argv(["--db", "data/bayesratings.db", "--from", "mlb_extra_2016.db"]) == [
        "--db", "data/bayesratings.db", "--load", "mlb_extra_2016.db"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
