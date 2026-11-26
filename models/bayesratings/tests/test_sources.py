"""Update-job runner and the morning check, on an empty database. No network."""
import copy
import gzip
import json
import re
import sqlite3
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from bayesratings import espn, prelog
from bayesratings.backfill import Pacer
from bayesratings.sources import check, runner

ROOT = Path(__file__).resolve().parents[1]


def fx(name):
    return json.loads(gzip.decompress((FIX / f"{name}.json.gz").read_bytes()))


def raw(name):
    return (FIX / name).read_bytes()


def _db():
    c = sqlite3.connect(":memory:", isolation_level=None)
    c.row_factory = sqlite3.Row
    c.executescript((ROOT / "bayesratings" / "schema.sql").read_text())
    return c


def team(c, lg, espn_id, abbr=None, name=None):
    c.execute("INSERT OR IGNORE INTO teams (league, espn_id, abbreviation, name) VALUES (?,?,?,?)",
              (lg, espn_id, abbr or str(espn_id), name))
    return c.execute("SELECT team_id FROM teams WHERE league=? AND espn_id=?", (lg, espn_id)).fetchone()[0]


def game(c, lg, eid, home, away, start, venue=None, completed=0, status="STATUS_SCHEDULED", stype=2):
    c.execute("INSERT OR REPLACE INTO games (espn_event_id, league, season, season_type, start_time_utc, "
              "game_date, home_team_id, away_team_id, completed, status, venue) VALUES (?,?,2026,?,?,?,?,?,?,?,?)",
              (eid, lg, stype, start, espn.central_date(start), home, away, completed, status, venue))


def fill(c, lg, home, away, around, n=5, eid0=9000000):
    """n filler games so the teams count as in season (exhibition filter)."""
    for i in range(n):
        s = (around + timedelta(days=i - 6)).strftime("%Y-%m-%dT%H:%MZ")
        game(c, lg, eid0 + i, home, away, s, completed=1, status="STATUS_FINAL")


def one(c, sql, *a):
    return c.execute(sql, a).fetchone()


def n(c, table, where="1", *a):
    return one(c, f"SELECT COUNT(*) FROM {table} WHERE {where}", *a)[0]


MLB_TEAMS = {5: ("CLE", "Cleveland Guardians"), 30: ("TB", "Tampa Bay Rays"),
             19: ("LAD", "Los Angeles Dodgers"), 8: ("MIL", "Milwaukee Brewers")}


def mlb_db(around, espn_knows_xrefs=True):
    c = _db()
    ids = {e: team(c, "mlb", e, a, nm) for e, (a, nm) in MLB_TEAMS.items()}
    fill(c, "mlb", ids[5], ids[30], around)
    if espn_knows_xrefs:
        # ESPN has given us these athletes (as box scores would): their xrefs verify
        for p in fx("mlb_people_xref")["people"]:
            x = mlb.espn_xref(p)
            if x:
                c.execute("INSERT OR IGNORE INTO players (league, athlete_id, name) "
                          "VALUES ('mlb', ?, ?)", (x, p.get("fullName")))
    return c, ids


class FakeMLB:
    def __init__(self, sched=None):
        self.calls = []
        self.sched = sched or {}

    def __call__(self, path, **p):
        self.calls.append((path, p))
        if path == "teams":
            return fx("mlb_teams")
        if path == "teams/114/roster":
            return fx("mlb_roster_114_full" if p["rosterType"] == "fullRoster" else "mlb_roster_114_40man")
        if path == "people":
            want = set(p["personIds"].split(","))
            return {"people": [x for x in fx("mlb_people_xref")["people"] if str(x["id"]) in want]}
        if path == "transactions":
            return fx("mlb_tx")
        if path == "schedule":
            return self.sched[p["date"]]
        raise OSError(f"no fixture for {path}")


# ------------------------------------------------------------- MLB

class FakeWeb:
    def __init__(self, pages, robots="User-agent: *\nAllow: /\nDisallow: /api/\n"):
        self.pages, self.robots, self.calls = pages, robots, []

    def __call__(self, url, accept="*/*", **k):
        self.calls.append(url)
        if url.endswith("/robots.txt"):
            if self.robots is None:
                raise common.Missing(url)
            return self.robots.encode()
        for pat, body in self.pages.items():
            if re.search(pat, url):
                if isinstance(body, Exception):
                    raise body
                return body
        raise common.Missing(url)


def dfo_html(next_data):
    return ('<html><script id="__NEXT_DATA__" type="application/json">'
            + json.dumps(next_data) + "</script></html>").encode()


def nba_db():
    c = _db()
    t = {e: team(c, "nba", e, a, nm) for e, (a, nm) in NBA.items()}
    game(c, "nba", 401810001, t[1], t[5], "2026-04-10T23:00Z")
    game(c, "nba", 401810002, t[2], t[3], "2026-04-10T23:30Z")
    game(c, "nba", 401810003, t[2], t[8], "2025-12-16T00:00Z")
    for tid, aid, nm in ((t[5], 4066328, "Jarrett Allen"), (t[3], 4395628, "Zion Williamson"),
                         (t[8], 4397136, "Wendell Moore Jr.")):
        c.execute("INSERT INTO roster_states (league, team_id, athlete_id, name, state_hash, valid_from, "
                  "last_seen) VALUES ('nba', ?, ?, ?, 'x', '2026-04-01', '2026-04-01')", (tid, aid, nm))
    return c, t


NFL = {7: ("DEN", "Denver Broncos"), 26: ("SEA", "Seattle Seahawks")}


def nfl_db(around=datetime(2026, 10, 17, 18)):
    c = _db()
    t = {e: team(c, "nfl", e, a, nm) for e, (a, nm) in NFL.items()}
    fill(c, "nfl", t[7], t[26], around)
    return c, t


def test_runner_isolates_failures_and_quiet_skips():
    c = _db()
    orig = dict(runner.JOBS)
    runner.JOBS["mlb_lineups"] = ("mlb", lambda *a: (_ for _ in ()).throw(RuntimeError("boom")))
    try:
        msgs = []
        ok, parts = runner.run_jobs(c, "pregame", Pacer(0), log=msgs.append)
    finally:
        runner.JOBS.clear()
        runner.JOBS.update(orig)
    assert not ok and any("boom" in m for m in msgs)
    r = one(c, "SELECT * FROM prelog_runs WHERE kind = 'mlb_lineups'")
    assert r["errors"] == 1 and "boom" in r["note"]
    # everything else had nothing to do and stayed quiet (no rows, no requests)
    assert n(c, "prelog_runs") == 1 and parts == [p for p in parts if p.startswith("mlb_lineups")]
    ok, parts = runner.run_jobs(c, "sources", Pacer(0), log=lambda m: None)
    assert ok and n(c, "prelog_runs", "note LIKE 'skipped:%'") == 3


def test_check_flags_missing_sources_and_players():
    c, t = nfl_db(datetime.now(timezone.utc))
    now = datetime.now(timezone.utc)
    if now.astimezone(espn.CENTRAL).hour < 8:
        now = now + timedelta(hours=8)
    res = {s: (lvl, m) for s, lvl, m in check.check(c, now, daily_status="/nonexistent")}
    assert res["nflverse"][0] == "FAIL" and res["mlb_roster"] == ("OK", "off-season")
    prelog.record_run(c, "nflverse", "nfl", now.isoformat(), 2, {"rows": 1}, 0)
    prelog.record_run(c, "rosters", "nfl", now.isoformat(), 2, {"rows": 1}, 0)
    res = {s: (lvl, m) for s, lvl, m in check.check(c, now + timedelta(hours=1), daily_status="/nonexistent")}
    assert res["nflverse"][0] == "OK" and res["rosters"][0] == "OK"
    # a game that started 2 h ago without inactives / pre-game snapshot -> WARN lines
    start = (now - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%MZ")
    game(c, "nfl", 77, t[7], t[26], start, venue="Empower Field at Mile High")
    res = {s: (lvl, m) for s, lvl, m in check.check(c, now, daily_status="/nonexistent")}
    assert res["nfl_inactives"] == ("WARN", "0/1 games with inactives for both teams")
    assert res["pregame/nfl"][0] == "WARN"
    line = check.summary_line(check.check(c, now, daily_status="/nonexistent"), now)
    assert " CHECK FAIL " in line and "nfl_inactives" in line


def test_user_agent_has_no_url():
    from bayesratings.config import user_agent
    ua = user_agent()
    assert "bayesratings" in ua and "http" not in ua and "://" not in ua


def test_cli_status_and_check():
    with tempfile.TemporaryDirectory() as d:
        dbp, sf = f"{d}/t.db", f"{d}/status.log"
        # prelog no longer loads the schema on start (that raced other writers).
        from bayesratings import db
        conn = db.connect(dbp)
        db.init_db(conn)
        conn.close()
        assert prelog.main(["status", "--db", dbp]) == 0
        rc = prelog.main(["check", "--db", dbp, "--status-file", sf])
        txt = Path(sf).read_text()
        assert " CHECK " in txt and rc in (0, 1)
        from bayesratings import db
        conn = db.connect(dbp)
        s = prelog.status(conn)
        assert set(s["sources"]["jobs"]) == set(runner.JOBS) and "nba_injury_states" in s["sources"]["tables"]
        assert "check" in {r[0] for r in conn.execute("SELECT kind FROM prelog_runs")}
        assert prelog.health(conn).count("check") == 1
        assert "unmatched" in prelog.status_line(conn)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
