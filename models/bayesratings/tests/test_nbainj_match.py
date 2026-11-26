"""NBA injury report matching: 11:00 (ET) = 11 PM tips, family-name-first
players, and the rematch of open unmatched keys.
Run: PYTHONPATH=. python tests/test_nbainj_match.py"""
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_sources as ts  # noqa: E402

from bayesratings.sources import nbainj  # noqa: E402


def _nba():
    c = ts._db()
    gsw = ts.team(c, "nba", 9, "GS", "Golden State Warriors")
    lac = ts.team(c, "nba", 12, "LAC", "LA Clippers")
    por = ts.team(c, "nba", 22, "POR", "Portland Trail Blazers")
    # LAC @ GSW, Tue Oct 28 2025 11:00 PM ET (Wed 03:00Z); GSW's previous game Mon night
    ts.game(c, "nba", 401809982, gsw, lac, "2025-10-29T03:00Z", completed=1, status="STATUS_FINAL")
    ts.game(c, "nba", 401809976, gsw, por, "2025-10-28T02:00Z", completed=1, status="STATUS_FINAL")
    c.execute("INSERT INTO roster_states (league, team_id, athlete_id, name, state_hash, valid_from, "
              "last_seen) VALUES ('nba', ?, 5217746, 'Yang Hansen', 'x', '2025-10-01', '2025-10-01')", (por,))
    return c, gsw, lac, por


def test_eleven_et_is_a_late_tip():
    c, gsw, lac, por = _nba()
    assert nbainj._game(c, "2025-10-28", "11:00 (ET)", gsw) == 401809982
    assert nbainj._game(c, "2025-10-28", "11:00 (ET)", lac) == 401809982
    assert nbainj._game(c, "2025-10-27", "10:00 (ET)", gsw) == 401809976   # unchanged
    ts.game(c, "nba", 401800001, lac, por, "2026-01-01T16:00Z")            # an 11 AM ET tip still maps
    assert nbainj._game(c, "2025-12-31", "11:00 (ET)", por) is None
    assert nbainj._game(c, "2026-01-01", "11:00 (ET)", por) == 401800001


def test_family_name_first_player():
    c, gsw, lac, por = _nba()
    P = nbainj.Players(c, "nba", season=2026)
    assert nbainj._player(P, "Yang, Hansen", por)[0] == 5217746
    assert nbainj._player(P, "Ndiaye, Eli John", por)[0] is None


def test_rematch_fills_nulls_and_resolves():
    c, gsw, lac, por = _nba()
    at = "2026-10-17T19:31:46+00:00"
    for tid, pk in ((gsw, "Curry, Stephen"), (lac, "Harden, James"), (por, "Yang, Hansen")):
        c.execute("INSERT INTO nba_injury_states (game_date, team_name, player_key, team_id, game_time, "
                  "status, state_hash, valid_from, last_seen) VALUES ('2025-10-28', 'x', ?, ?, "
                  "'11:00 (ET)', 'Out', 'h', ?, ?)", (pk, tid, at, at))
    for key, kind in ((f"2025-10-28:{gsw}", "game"), (f"2025-10-28:{lac}", "game"),
                      (f"{por}:Yang, Hansen", "player"), (f"{por}:Mangas, Kyle", "player")):
        nbainj.unmatched(c, "nbainj", "nba", kind, key, None, None, None, at)
    st = nbainj.rematch(c, log=lambda *a: None)
    assert st == {"games": 2, "games_resolved": 2, "players": 2, "players_resolved": 1}, st
    rows = c.execute("SELECT player_key, espn_event_id, athlete_id FROM nba_injury_states "
                     "ORDER BY player_key").fetchall()
    assert [tuple(r) for r in rows] == [("Curry, Stephen", 401809982, None),
                                        ("Harden, James", 401809982, None),
                                        ("Yang, Hansen", None, 5217746)]
    left = c.execute("SELECT ext_key FROM ext_unmatched WHERE resolved_at IS NULL").fetchall()
    assert [r[0] for r in left] == [f"{por}:Mangas, Kyle"]
    assert nbainj.rematch(c, log=lambda *a: None)["games"] == 0            # re-runnable


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
