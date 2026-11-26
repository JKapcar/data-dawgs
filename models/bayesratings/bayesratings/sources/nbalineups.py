"""NBA probable starting lineups.

  1. The public daily lineups JSON: five starters per team marked Expected,
     then Confirmed near tip. Names map to ESPN ids by name and team.
  2. A team that file does not list yet: ESPN's depth chart (the first player
     at PG / SG / SF / PF / C, each player once).

Fetched with the NBA injury report for games still to tip in the next 18
hours. Stored change-only in nba_lineup_states."""

import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from ..prelog import Tx, track, _add
from .common import Missing, Players, Teams, http_get, js, resolved, robots_allowed, store_raw, unmatched
from .espn_extra import _games

URL = "https://stats.nba.com/js/data/leaders/00_daily_lineups_{d}.json"
DEPTH = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{espn_id}/depthcharts"
SRC = "nbalineups"
EASTERN = ZoneInfo("America/New_York")
SLOTS = ("PG", "SG", "SF", "PF", "C")
WINDOW_MIN = 18 * 60                      # games tipping within the next 18 hours
DEPTH_EVERY = timedelta(hours=2)          # depth-chart refetch at most this often
# NBA.com abbreviation -> ours (ESPN's) where they differ
ABBR = {"NOP": "NO", "UTA": "UTAH", "GSW": "GS", "SAS": "SA", "NYK": "NY", "WAS": "WSH",
        "BRK": "BKN", "PHO": "PHX"}
FIELDS = ("athlete_id", "name", "status", "src", "nba_person_id")


def parse_lineups(payload) -> list:
    """NBA.com daily lineups -> one dict per listed starter."""
    out = []
    for g in (payload or {}).get("games") or []:
        for side, key in (("home", "homeTeam"), ("away", "awayTeam")):
            t = g.get(key) or {}
            for p in t.get("players") or []:
                pos = (p.get("position") or "").upper()
                if pos not in SLOTS:
                    continue
                out.append(dict(nba_game_id=g.get("gameId"), side=side,
                                team_abbr=t.get("teamAbbreviation"), slot=pos,
                                name=p.get("playerName") or " ".join(
                                    x for x in (p.get("firstName"), p.get("lastName")) if x),
                                status=p.get("lineupStatus") or None,
                                nba_person_id=p.get("personId"),
                                raw_json=js(p)))
    return out


def depth_starters(payload) -> list:
    """ESPN depth chart -> [(slot, athlete_id, name)]: the first player listed
    at each position who isn't already in the five."""
    charts = (payload or {}).get("depthchart") or []
    pos = (charts[0].get("positions") if charts else None) or {}
    used, out = set(), []
    for slot in SLOTS:
        for a in (pos.get(slot.lower()) or {}).get("athletes") or []:
            aid = int(a["id"]) if a.get("id") else None
            if aid and aid not in used:
                used.add(aid)
                out.append((slot, aid, a.get("displayName")))
                break
    return out


def _team_id(T, abbr):
    return T.by(abbr=ABBR.get((abbr or "").upper(), abbr))


def store_team(conn, eid, team_id, rows, at) -> dict:
    """Track one team's five for one game (call inside a transaction)."""
    for r in rows:
        r.update(league="nba", espn_event_id=eid, team_id=team_id)
    return track(conn, "nba_lineup_states", ("espn_event_id", "team_id", "slot"), FIELDS, rows,
                 {"espn_event_id": eid, "team_id": team_id}, at)


def lineups_pass(conn, pace, now=None, log=print, fetch=None) -> dict:
    fetch = fetch or http_get
    now = now or datetime.now(timezone.utc)
    games = _games(conn, "nba", now, 0, WINDOW_MIN)
    if not games:
        return {"errors": 0, "skipped": "no NBA game to tip in the next 18 hours"}
    st, at = {"errors": 0}, now.isoformat(timespec="seconds")
    T, P = Teams(conn, "nba"), Players(conn, "nba")
    by_pair, dates = {}, set()
    for eid, start, home, away in games:
        by_pair[(home, away)] = eid
        d = datetime.fromisoformat(start.replace("Z", "+00:00")).astimezone(EASTERN).date()
        dates.add(d.strftime("%Y%m%d"))
    done = set()                          # (eid, team_id) with an NBA.com five
    for d in sorted(dates):
        url = URL.format(d=d)
        if not robots_allowed(conn, url, pace, fetch):
            st["robots_blocked"] = st.get("robots_blocked", 0) + 1
            continue
        try:
            body = pace(fetch, url, accept="application/json")
        except Missing:
            st["not_posted"] = st.get("not_posted", 0) + 1
            continue
        rows = parse_lineups(json.loads(body))
        by_game = {}
        for r in rows:
            by_game.setdefault(r["nba_game_id"], {}).setdefault(r["side"], []).append(r)
        with Tx(conn):
            store_raw(conn, SRC, f"daily_lineups/{d}", body, at, "application/json")
            for gid, sides in by_game.items():
                ids = {s: _team_id(T, rs[0]["team_abbr"]) for s, rs in sides.items()}
                eid = by_pair.get((ids.get("home"), ids.get("away")))
                if eid is None:
                    if (ids.get("home"), ids.get("away")) not in by_pair:
                        st["other_games"] = st.get("other_games", 0) + 1
                    continue
                for s, rs in sides.items():
                    if len({r["slot"] for r in rs}) != 5:
                        st["incomplete"] = st.get("incomplete", 0) + 1
                        continue
                    for r in rs:
                        r["athlete_id"], _ = P.match(r["name"], ids[s])
                        key = r["nba_person_id"] or r["name"]
                        if r["athlete_id"]:
                            st["matched"] = st.get("matched", 0) + 1
                            resolved(conn, SRC, "nba", "player", key, at)
                        else:
                            st["unmatched"] = st.get("unmatched", 0) + 1
                            unmatched(conn, SRC, "nba", "player", key, r["name"], r["team_abbr"],
                                      "starting lineup", at)
                        r["src"] = "nba.com"
                    _add(st, store_team(conn, eid, ids[s], rs, at))
                    done.add((eid, ids[s]))
                    st[f"teams_{(rs[0]['status'] or 'none').lower()}"] = \
                        st.get(f"teams_{(rs[0]['status'] or 'none').lower()}", 0) + 1
    # teams NBA.com doesn't list (yet): ESPN depth chart
    for eid, _, home, away in games:
        for tid in (home, away):
            if (eid, tid) in done:
                continue
            last = conn.execute("SELECT MAX(src), MAX(last_seen) FROM nba_lineup_states WHERE "
                                "espn_event_id = ? AND team_id = ? AND valid_to IS NULL",
                                (eid, tid)).fetchone()
            # keep an NBA.com five this run couldn't refresh; depth charts at most every DEPTH_EVERY
            if last[0] == "nba.com" or (last[1] and datetime.fromisoformat(last[1]) > now - DEPTH_EVERY):
                continue
            r = conn.execute("SELECT espn_id FROM teams WHERE team_id = ?", (tid,)).fetchone()
            if not r or r[0] is None:
                continue
            try:
                body = pace(fetch, DEPTH.format(espn_id=r[0]), accept="application/json")
                five = depth_starters(json.loads(body))
            except Missing:
                five = []
            except Exception as e:
                st["errors"] += 1
                log(f"nba lineups depth chart team {tid} ERROR {type(e).__name__}: {e}")
                continue
            if len(five) != 5:
                st["depth_incomplete"] = st.get("depth_incomplete", 0) + 1
                continue
            rows = [dict(slot=s, athlete_id=a, name=n, status="depth chart", src="espn_depth",
                         nba_person_id=None, raw_json=None) for s, a, n in five]
            with Tx(conn):
                _add(st, store_team(conn, eid, tid, rows, at))
            st["teams_depth"] = st.get("teams_depth", 0) + 1
    return st


def current(conn, eid, team_id) -> list:
    """The open lineup rows for one team in one game, in slot order."""
    rows = conn.execute("SELECT slot, athlete_id, name, status, src FROM nba_lineup_states "
                        "WHERE espn_event_id = ? AND team_id = ? AND valid_to IS NULL",
                        (eid, team_id)).fetchall()
    return sorted(rows, key=lambda r: SLOTS.index(r[0]) if r[0] in SLOTS else 9)
