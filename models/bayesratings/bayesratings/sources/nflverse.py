"""nflverse open data (github.com/nflverse/nflverse-data releases, free):
the official NFL injury report (practice participation + game status) and
the weekly rosters (game-day status incl. INA = inactive, plus ESPN ids).
nflverse keeps one row per player-week (the latest report), so we log it
daily and the change-only states keep the Wed/Thu/Fri progression."""

import csv
import gzip
import io
from datetime import datetime

from .. import espn
from ..prelog import Tx, _now, _teams, track, _add
from .common import Players, Teams, http_get, js, resolved, save_id, store_raw, unmatched

REL = "https://github.com/nflverse/nflverse-data/releases/download"
SRC = "nflverse"
# nflverse -> ESPN team abbreviations where they differ
TEAM_ALIAS = {"LA": "LAR", "WAS": "WSH", "OAK": "LV", "SD": "LAC", "STL": "LAR"}


def season_of(d) -> int:
    return d.year if d.month >= 3 else d.year - 1


def read_csv(body: bytes) -> list:
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return list(csv.DictReader(io.StringIO(body.decode("utf-8-sig"))))


def _i(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


INJ_FIELDS = ("report_primary_injury", "report_secondary_injury", "report_status",
              "practice_primary_injury", "practice_secondary_injury", "practice_status",
              "position", "full_name")
ROSTER_FIELDS = ("team", "status", "status_abbr", "position", "espn_id")


def roster_rows(rows, T):
    out = []
    for r in rows:
        if not r.get("gsis_id") or _i(r.get("week")) is None:
            continue
        team = r.get("team")
        out.append(dict(league="nfl", season=_i(r["season"]), week=_i(r["week"]), gsis_id=r["gsis_id"],
                        game_type=r.get("game_type"), team=team,
                        team_id=T.by(abbr=TEAM_ALIAS.get(team, team)), espn_id=_i(r.get("espn_id")),
                        full_name=r.get("full_name"), position=r.get("position"),
                        status=r.get("status"), status_abbr=r.get("status_description_abbr"),
                        raw_json=js({k: r[k] for k in ("jersey_number", "depth_chart_position",
                                                       "years_exp", "football_name", "pfr_id",
                                                       "sportradar_id") if k in r})))
    return out


def injury_rows(rows, T):
    out = []
    for r in rows:
        if not r.get("gsis_id") or _i(r.get("week")) is None:
            continue
        team = r.get("team")
        out.append(dict(league="nfl", season=_i(r["season"]), game_type=r.get("game_type"),
                        week=_i(r["week"]), team=team, gsis_id=r["gsis_id"],
                        team_id=T.by(abbr=TEAM_ALIAS.get(team, team)),
                        full_name=r.get("full_name"), position=r.get("position"),
                        **{f: r.get(f) or None for f in INJ_FIELDS[:6]},
                        raw_json=js({k: r.get(k) for k in ("first_name", "last_name", "season_type")})))
    return out


# nflverse injury files start with the 2009 season (the start year).
INJURY_FIRST = 2009
INJURY_URL = REL + "/injuries/injuries_{season}.csv"


def store_injury_body(conn, body, at, link=True) -> dict:
    """Write one injuries_{season}.csv into nfl_injury_report_states.

    `link=False` leaves team and athlete ids empty so a standalone file can
    be loaded and linked on the main database. An empty file is an error
    and writes nothing.
    """
    rows = read_csv(body)
    T = Teams(conn, "nfl")
    irows = injury_rows(rows, T if link else _NoTeams())
    season = next((r["season"] for r in irows if r.get("season")), None)
    if not irows or season is None:
        return {"errors": 1, "fatal": "empty injury file", "injury_rows": 0}
    st = {"errors": 0, "injury_rows": len(irows), "season": int(season)}
    gsis_espn = {}
    P = None
    if link:
        for g, e in conn.execute(
                "SELECT gsis_id, espn_id FROM nfl_weekly_roster_states "
                "WHERE espn_id IS NOT NULL AND valid_to IS NULL"):
            gsis_espn[g] = e
        for g, e in conn.execute(
                "SELECT ext_id, espn_id FROM ext_ids WHERE source = ? AND league = 'nfl' "
                "AND kind = 'player' AND espn_id IS NOT NULL", (SRC,)):
            gsis_espn.setdefault(g, e)
        P = Players(conn, "nfl")
    with Tx(conn):
        store_raw(conn, SRC, f"injuries_{int(season)}", body, at, "text/csv")
        for r in irows:
            if not link:
                r["athlete_id"] = None
                r["team_id"] = None
                continue
            aid = gsis_espn.get(r["gsis_id"])
            method = "xref" if aid else None
            if not aid and P is not None:
                aid, method = P.match(r["full_name"], r["team_id"])
            r["athlete_id"] = aid
            if aid:
                st["matched"] = st.get("matched", 0) + 1
                if method != "xref":
                    save_id(conn, SRC, "nfl", "player", r["gsis_id"], aid, method, r["full_name"],
                            r["team_id"], at)
                resolved(conn, SRC, "nfl", "player", r["gsis_id"], at)
            else:
                st["unmatched"] = st.get("unmatched", 0) + 1
                unmatched(conn, SRC, "nfl", "player", r["gsis_id"], r["full_name"], r["team"],
                          f"injury report wk{r['week']}", at)
            if r["team_id"] is None:
                unmatched(conn, SRC, "nfl", "team", r["team"], r["team"], at=at)
        for wk in sorted({(r["season"], r["week"]) for r in irows}):
            _add(st, {f"injury_{k}": v for k, v in track(
                conn, "nfl_injury_report_states", ("league", "season", "week", "team", "gsis_id"),
                INJ_FIELDS, [r for r in irows if (r["season"], r["week"]) == wk],
                {"league": "nfl", "season": wk[0], "week": wk[1]}, at).items()})
    st["weeks"] = max((r["week"] for r in irows), default=None)
    return st


class _NoTeams:
    def by(self, name=None, abbr=None):
        return None


def link_injuries(conn) -> dict:
    """Fill empty team and athlete ids. A row that already has one is left."""
    T = Teams(conn, "nfl")
    P = Players(conn, "nfl")
    gsis = {}
    for g, e in conn.execute(
            "SELECT gsis_id, espn_id FROM nfl_weekly_roster_states WHERE espn_id IS NOT NULL"):
        gsis[g] = e
    for g, e in conn.execute(
            "SELECT ext_id, espn_id FROM ext_ids WHERE source = ? AND league = 'nfl' "
            "AND kind = 'player' AND espn_id IS NOT NULL", (SRC,)):
        gsis.setdefault(g, e)
    rows = conn.execute(
        "SELECT id, team, gsis_id, full_name, team_id, athlete_id FROM nfl_injury_report_states "
        "WHERE team_id IS NULL OR athlete_id IS NULL").fetchall()
    st = {"teams": 0, "players": 0}
    with Tx(conn):
        for r in rows:
            tid = r["team_id"]
            if tid is None and r["team"]:
                abbr = TEAM_ALIAS.get(r["team"], r["team"])
                tid = T.by(abbr=abbr) or T.by(abbr=r["team"])
                if tid:
                    conn.execute("UPDATE nfl_injury_report_states SET team_id = ? WHERE id = ?",
                                 (tid, r["id"]))
                    st["teams"] += 1
            if r["athlete_id"] is None:
                aid = gsis.get(r["gsis_id"])
                if not aid and tid and r["full_name"]:
                    aid, _how = P.match(r["full_name"], tid)
                if aid:
                    conn.execute(
                        "UPDATE nfl_injury_report_states SET athlete_id = ? WHERE id = ?",
                        (aid, r["id"]))
                    st["players"] += 1
                    save_id(conn, SRC, "nfl", "player", r["gsis_id"], aid, "name", r["full_name"],
                            tid, _now())
    return st


def daily_pass(conn, pace, log=print, fetch=None, today=None) -> dict:
    """Injury report + weekly roster files for the current season (2 requests)."""
    fetch = fetch or http_get
    if not _teams(conn, "nfl", today):
        return {"errors": 0, "skipped": "no NFL games in window"}
    today = today or datetime.now(espn.CENTRAL).date()
    season = season_of(today)
    T = Teams(conn, "nfl")
    st = {"errors": 0}
    # weekly rosters first: they carry the gsis -> ESPN id map
    body = pace(fetch, f"{REL}/weekly_rosters/roster_weekly_{season}.csv.gz")
    at = _now()
    rrows = roster_rows(read_csv(body), T)
    if not rrows:
        raise ValueError("empty weekly roster file")
    gsis_espn = {}
    for r in rrows:
        if r["espn_id"]:
            gsis_espn[r["gsis_id"]] = r["espn_id"]
    P = Players(conn, "nfl")
    with Tx(conn):
        for g, e in gsis_espn.items():
            save_id(conn, SRC, "nfl", "player", g, e, "xref", at=at)
        for r in rrows:
            r["athlete_id"] = r["espn_id"]
        for wk in sorted({(r["season"], r["week"]) for r in rrows}):
            _add(st, {f"roster_{k}": v for k, v in track(
                conn, "nfl_weekly_roster_states", ("league", "season", "week", "gsis_id"), ROSTER_FIELDS,
                [r for r in rrows if (r["season"], r["week"]) == wk],
                {"league": "nfl", "season": wk[0], "week": wk[1]}, at).items()})
    st["roster_rows"] = len(rrows)
    body = pace(fetch, f"{REL}/injuries/injuries_{season}.csv")
    at = _now()
    irows = injury_rows(read_csv(body), T)
    with Tx(conn):
        store_raw(conn, SRC, f"injuries_{season}", body, at, "text/csv")
        for r in irows:
            aid = gsis_espn.get(r["gsis_id"])
            method = "xref" if aid else None
            if not aid:
                aid, method = P.match(r["full_name"], r["team_id"])
            r["athlete_id"] = aid
            if aid:
                st["matched"] = st.get("matched", 0) + 1
                if method != "xref":
                    save_id(conn, SRC, "nfl", "player", r["gsis_id"], aid, method, r["full_name"],
                            r["team_id"], at)
                resolved(conn, SRC, "nfl", "player", r["gsis_id"], at)
            else:
                st["unmatched"] = st.get("unmatched", 0) + 1
                unmatched(conn, SRC, "nfl", "player", r["gsis_id"], r["full_name"], r["team"],
                          f"injury report wk{r['week']}", at)
            if r["team_id"] is None:
                unmatched(conn, SRC, "nfl", "team", r["team"], r["team"], at=at)
        for wk in sorted({(r["season"], r["week"]) for r in irows}):
            _add(st, {f"injury_{k}": v for k, v in track(
                conn, "nfl_injury_report_states", ("league", "season", "week", "team", "gsis_id"),
                INJ_FIELDS, [r for r in irows if (r["season"], r["week"]) == wk],
                {"league": "nfl", "season": wk[0], "week": wk[1]}, at).items()})
    st["injury_rows"] = len(irows)
    st["weeks"] = max((r["week"] for r in irows), default=None)
    return st
