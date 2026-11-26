"""Two ESPN gaps closed with ESPN itself:

  NFL inactives: the summary lists at most 5 injuries per team, but the
  per-team core injury list carries every game-day inactive (fantasyStatus
  INACTIVE, "Coach's Decision") about 60-90 min before kickoff. Fetched for
  both teams ~60 and ~20 min before kickoff.

  NBA starters: no free pre-tip source; ESPN's box score flags the starters
  once the game is under way, so we take them at / just after tip."""

from datetime import datetime, timedelta, timezone

from .. import db, espn, prelog
from ..prelog import Tx, track, _add, _utc

INACTIVE_PHASES = {"t60": (45, 70), "t20": (10, 30)}     # minutes before kickoff
DETAIL_CAP = 60                                          # new injury entries per team per pass
STARTER_WINDOW = (3, 45)                                 # minutes after the scheduled tip
_INJ_REF = prelog._INJ_REF


def _games(conn, league, now, lo, hi, completed_ok=False):
    """Playable games whose start is in [now + lo, now + hi] minutes."""
    a = (now + timedelta(minutes=lo)).strftime("%Y-%m-%dT%H:%M")
    b = (now + timedelta(minutes=hi)).strftime("%Y-%m-%dT%H:%MZ")
    q = (f"SELECT espn_event_id, start_time_utc, home_team_id, away_team_id FROM games g "
         f"WHERE league = ? AND {db.playable_sql('g')} AND season_type IN (2, 3) "
         f"AND start_time_utc BETWEEN ? AND ?")
    if not completed_ok:
        q += " AND completed = 0"
    return conn.execute(q, (league, a, b)).fetchall()


def _done(conn, source, eid, phase):
    return conn.execute("SELECT 1 FROM src_game_passes WHERE source = ? AND espn_event_id = ? "
                        "AND phase = ? AND found = 1", (source, eid, phase)).fetchone() is not None


# ------------------------------------------------------------- NFL inactives

def inactives_pass(conn, pace, now=None, log=print) -> dict:
    now = now or datetime.now(timezone.utc)
    st = {"errors": 0}
    T = {r[0]: r[1] for r in conn.execute("SELECT team_id, espn_id FROM teams WHERE league = 'nfl'")}
    for phase, (lo, hi) in INACTIVE_PHASES.items():
        for eid, start, home, away in _games(conn, "nfl", now, lo, hi):
            if conn.execute("SELECT 1 FROM src_game_passes WHERE source = 'nfl_inactives' AND "
                            "espn_event_id = ? AND phase = ?", (eid, phase)).fetchone():
                continue
            st["games"] = st.get("games", 0) + 1
            found = 0
            for team_id in (home, away):
                try:
                    n = team_inactives(conn, pace, eid, start, team_id, T[team_id], now, st)
                    found += n
                except Exception as e:
                    st["errors"] += 1
                    log(f"nfl inactives {eid} team {team_id} ERROR {type(e).__name__}: {e}")
            with Tx(conn):
                conn.execute("INSERT OR REPLACE INTO src_game_passes (source, espn_event_id, phase, "
                             "fetched_at, found) VALUES ('nfl_inactives', ?, ?, ?, ?)",
                             (eid, phase, now.isoformat(timespec="seconds"), found))
            st[f"inactive_{phase}"] = st.get(f"inactive_{phase}", 0) + found
    if not st.get("games"):
        st["skipped"] = "no NFL game near kickoff"
    return st


def team_inactives(conn, pace, eid, start, team_id, espn_team, now, st) -> int:
    refs = pace(prelog.fetch_team_injuries, "nfl", espn_team)
    items = []
    for it in refs.get("items") or []:
        m = _INJ_REF.search(it.get("$ref", ""))
        if m:
            items.append((int(m.group(2)), int(m.group(1)), it["$ref"]))   # ESPN order: newest first
    have = {r[0] for r in conn.execute("SELECT injury_id FROM injury_details WHERE league = 'nfl' "
                                       "AND injury_id IN (%s)" % ",".join("?" * len(items)),
                                       [i for i, _, _ in items])} if items else set()
    got = []
    for iid, aid, ref in items:
        if iid in have:
            continue
        if len(got) >= DETAIL_CAP:
            st["detail_capped"] = st.get("detail_capped", 0) + 1
            break
        d = pace(prelog.fetch_ref, ref)
        got.append(prelog.parse_injury_detail(d, "nfl", team_id, aid))
    at = now.isoformat(timespec="seconds")
    kick = _utc(start)
    with Tx(conn):
        _add(st, {f"detail_{k}": v for k, v in track(
            conn, "injury_details", ("league", "injury_id"), prelog.INJ_FIELDS,
            [g for g in got if g["injury_id"]], None, at).items()})
        # every entry for this team dated within 3 days of kickoff that ESPN
        # marks inactive (fantasy status) -- fetched now or on an earlier pass
        rows = conn.execute(
            "SELECT d.injury_id, d.athlete_id, d.status, d.fantasy_status, d.injury_date, d.type, "
            "r.name FROM injury_details d LEFT JOIN roster_states r ON r.league = 'nfl' "
            "AND r.athlete_id = d.athlete_id AND r.valid_to IS NULL WHERE d.league = 'nfl' "
            "AND d.valid_to IS NULL AND d.team_id = ? AND d.injury_id IN (%s)"
            % ",".join("?" * len(items)), [team_id] + [i for i, _, _ in items]).fetchall() if items else []
        n = 0
        for iid, aid, status, fs, idate, typ, name in rows:
            if (fs or "").upper() != "INACTIVE" or not idate:
                continue
            if abs((_utc(idate) - kick).total_seconds()) > 3 * 86400:
                continue
            conn.execute(
                "INSERT OR REPLACE INTO nfl_inactives (espn_event_id, team_id, athlete_id, fetched_at, "
                "minutes_before, injury_id, name, status, fantasy_status, injury_date, type) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (eid, team_id, aid, at, round((kick - now).total_seconds() / 60), iid, name, status, fs,
                 idate, typ))
            n += 1
    return n


# ------------------------------------------------------------- NBA starters

def starters_pass(conn, pace, now=None, log=print) -> dict:
    now = now or datetime.now(timezone.utc)
    st = {"errors": 0}
    tid = db.team_id_map(conn, "nba")
    for eid, start, home, away in _games(conn, "nba", now, -STARTER_WINDOW[1], -STARTER_WINDOW[0],
                                         completed_ok=True):
        if _done(conn, "nba_starters", eid, "tip"):
            continue
        st["games"] = st.get("games", 0) + 1
        try:
            summary = pace(espn.fetch_summary, "nba", eid)
            lineups, _, _ = prelog.parse_pregame(summary, "nba", tid)
            starters = [r for r in lineups if r["role"] == "starter"]
            at = now.isoformat(timespec="seconds")
            mins = round((now - _utc(start)).total_seconds() / 60)
            by_team = {}
            for r in starters:
                by_team.setdefault(r["team_id"], []).append(r)
            ok = len(by_team) == 2 and all(len(v) == 5 for v in by_team.values())
            with Tx(conn):
                conn.executemany(
                    "INSERT OR REPLACE INTO nba_starters (espn_event_id, team_id, athlete_id, fetched_at, "
                    "minutes_after, name, position, raw_json) VALUES (?,?,?,?,?,?,?,?)",
                    [(eid, r["team_id"], r["athlete_id"], at, mins, r["name"], r["position"], r["raw_json"])
                     for r in starters])
                conn.execute("INSERT OR REPLACE INTO src_game_passes (source, espn_event_id, phase, "
                             "fetched_at, found) VALUES ('nba_starters', ?, 'tip', ?, ?)", (eid, at, int(ok)))
            st["starters"] = st.get("starters", 0) + len(starters)
            st["complete"] = st.get("complete", 0) + int(ok)
        except Exception as e:
            st["errors"] += 1
            log(f"nba starters {eid} ERROR {type(e).__name__}: {e}")
    if not st.get("games"):
        st["skipped"] = "no NBA game just past tip"
    return st
