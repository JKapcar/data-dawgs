"""MLB Stats API (statsapi.mlb.com, free, no key): roster status incl. the
injured list, transactions with the injury text, confirmed lineups and
probable pitchers. Players map to ESPN through MLB's own xref ids when ESPN
knows that id, else by name + team (see resolve_person)."""

import re
from datetime import datetime, timedelta, timezone

from .. import db, espn
from ..prelog import Tx, _now, _teams, parse_scoreboard, store_scoreboard, track, _add
from .common import Players, Teams, get_ids, get_json, game_for, js, resolved, save_id, unmatched

API = "https://statsapi.mlb.com/api/v1"
SRC = "mlbam"
MLB_IL = ("D7", "D10", "D15", "D60")
XREF_RECHECK = timedelta(days=7)
LINEUP_WINDOW = (-20, 6 * 60)          # minutes around first pitch we poll
SKIP_STATES = ("Postponed", "Cancelled", "Canceled", "Suspended")


def fetch(path, **params):
    return get_json(f"{API}/{path}", params)


# ------------------------------------------------------------- teams + venues

def team_map(conn, teams_json, at=None) -> dict:
    """{mlb team id: our team_id}; saved in ext_ids, misses logged."""
    T = Teams(conn, "mlb")
    out = {}
    with Tx(conn):
        for t in teams_json.get("teams") or []:
            tid = T.by(t.get("name"), t.get("abbreviation"))
            if tid is None:
                unmatched(conn, SRC, "mlb", "team", t["id"], t.get("name"), at=at)
                continue
            out[t["id"]] = tid
            espn_id = conn.execute("SELECT espn_id FROM teams WHERE team_id = ?", (tid,)).fetchone()[0]
            save_id(conn, SRC, "mlb", "team", t["id"], espn_id, "name", t.get("name"), tid, at)
    return out


def saved_team_map(conn) -> dict:
    return {int(r[0]): r[1] for r in conn.execute(
        "SELECT ext_id, team_id FROM ext_ids WHERE source = ? AND league = 'mlb' AND kind = 'team' "
        "AND team_id IS NOT NULL", (SRC,))}


def venue_rows(teams_json, tmap, at):
    rows = []
    for t in teams_json.get("teams") or []:
        v = t.get("venue") or {}
        loc = v.get("location") or {}
        c = loc.get("defaultCoordinates") or {}
        if not v.get("id") or c.get("latitude") is None:
            continue
        roof = ((v.get("fieldInfo") or {}).get("roofType") or "").lower() or None
        rows.append(dict(league="mlb", venue_key=str(v["id"]), name=v.get("name"), aliases=None,
                         mlb_venue_id=v["id"], home_team_id=tmap.get(t["id"]),
                         lat=c.get("latitude"), lon=c.get("longitude"), roof=roof,
                         azimuth=loc.get("azimuthAngle"), elevation=loc.get("elevation"),
                         country=loc.get("country"), source="mlb-statsapi", updated_at=at))
    return rows


def upsert_venues(conn, rows):
    """Insert or refresh venue rows. Columns left out of this write stay as stored."""
    cols = ("league", "venue_key", "name", "aliases", "mlb_venue_id", "home_team_id", "lat", "lon",
            "roof", "azimuth", "elevation", "country", "source", "updated_at")
    upd = ", ".join(f"{c} = excluded.{c}" for c in cols[2:])
    with Tx(conn):
        for r in rows:
            moved = conn.execute("SELECT lat, lon FROM venues WHERE league = ? AND venue_key = ?",
                                 (r["league"], r["venue_key"])).fetchone()
            conn.execute(f"INSERT INTO venues ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))}) "
                         f"ON CONFLICT (league, venue_key) DO UPDATE SET {upd}",
                         [r.get(c) for c in cols])
            if moved and (round(moved[0] or 0, 4), round(moved[1] or 0, 4)) != (
                    round(r["lat"] or 0, 4), round(r["lon"] or 0, 4)):
                conn.execute("UPDATE venues SET nws_office = NULL, nws_x = NULL, nws_y = NULL, "
                             "nws_hourly_url = NULL, nws_checked_at = NULL WHERE league = ? "
                             "AND venue_key = ?", (r["league"], r["venue_key"]))
    return len(rows)


# ------------------------------------------------------------- people -> ESPN

def espn_xref(person) -> int:
    for x in person.get("xrefIds") or []:
        if x.get("xrefType") == "espn" and str(x.get("xrefId", "")).isdigit():
            return int(x["xrefId"])
    return None


# MLB's "espn" xref is not always the ESPN athlete id: for many veterans it
# carries a different ESPN id (Shawn Armstrong: xref 2336236, ESPN athlete
# 33499). An xref is trusted only when it is an athlete id ESPN itself has
# given us (box scores, rosters, probables); otherwise name + team decides.
# The raw xref is kept in ext_ids.xref_id either way.
RECHECK_METHODS = ("none", "xref_unverified")


def known_espn_ids(conn) -> set:
    """ESPN MLB athlete ids seen in ESPN's own data."""
    return {r[0] for r in conn.execute(
        "SELECT athlete_id FROM players WHERE league = 'mlb' "
        "UNION SELECT athlete_id FROM roster_states WHERE league = 'mlb' "
        "UNION SELECT athlete_id FROM game_probables WHERE league = 'mlb' "
        "AND athlete_id IS NOT NULL")}


def resolve_person(xref, name, team_id, known, players) -> tuple:
    """(espn_id or None, method) for one MLB person."""
    if xref and xref in known:
        return xref, "xref"
    eid, m = players.match(name, team_id)
    if eid:
        return eid, m
    return None, ("xref_unverified" if xref else "none")


def _save_person(conn, pid, xref, eid, method, name, team_id, at):
    save_id(conn, SRC, "mlb", "player", pid, eid, method, name, team_id, at)
    conn.execute("UPDATE ext_ids SET xref_id = ? WHERE source = ? AND league = 'mlb' "
                 "AND kind = 'player' AND ext_id = ?", (xref, SRC, str(pid)))


def map_people(conn, pace, people, now=None, fetch_fn=None) -> dict:
    """{mlb person id: ESPN athlete id or None}. `people` = {id: (name,
    team_id)}. Unknown ids (and misses older than a week) are looked up in
    batches of 100 (/people?hydrate=xrefId). The xref is used only when ESPN
    knows that id; otherwise name + team (see resolve_person)."""
    fetch_fn = fetch_fn or fetch
    now = now or datetime.now(timezone.utc)
    at = now.isoformat(timespec="seconds")
    repair_xrefs(conn)                  # old unchecked xrefs; a no-op once repaired
    known = get_ids(conn, SRC, "mlb", "player")
    stale = (now - XREF_RECHECK).isoformat(timespec="seconds")
    need = [p for p in people if str(p) not in known
            or (known[str(p)][0] is None and known[str(p)][1] in RECHECK_METHODS
                and known[str(p)][2] < stale)]
    found = {}
    for i in range(0, len(need), 100):
        batch = need[i:i + 100]
        data = pace(fetch_fn, "people", personIds=",".join(map(str, batch)), hydrate="xrefId")
        for p in data.get("people") or []:
            found[p["id"]] = espn_xref(p)
        for pid in batch:
            found.setdefault(pid, None)
    if found:
        espn_ids, P = known_espn_ids(conn), Players(conn, "mlb")
        with Tx(conn):
            for pid, xref in found.items():
                name, team_id = people[pid]
                eid, method = resolve_person(xref, name, team_id, espn_ids, P)
                _save_person(conn, pid, xref, eid, method, name, team_id, at)
    known = get_ids(conn, SRC, "mlb", "player")
    return {p: (known.get(str(p)) or (None,))[0] for p in people}


def repair_xrefs(conn) -> dict:
    """Fix mappings saved before xrefs were checked: a 'xref' row whose id
    ESPN never gave us is re-resolved by name + team, its raw xref kept in
    xref_id, and the logged rows carrying the bad id are corrected in place
    (nothing is deleted). Idempotent; returns counts."""
    espn_ids = known_espn_ids(conn)
    bad = [r for r in conn.execute(
        "SELECT ext_id, espn_id, name, team_id FROM ext_ids WHERE source = ? AND league = 'mlb' "
        "AND kind = 'player' AND method = 'xref'", (SRC,)) if r[1] not in espn_ids]
    st = {"checked": len(bad), "fixed": 0, "unverified": 0, "rows": 0}
    if not bad:
        return st
    P = Players(conn, "mlb")
    with Tx(conn):
        for ext_id, old, name, team_id in bad:
            eid, method = resolve_person(old, name, team_id, espn_ids, P)
            conn.execute("UPDATE ext_ids SET espn_id = ?, method = ?, xref_id = ? WHERE source = ? "
                         "AND league = 'mlb' AND kind = 'player' AND ext_id = ?",
                         (eid, method, old, SRC, ext_id))
            st["fixed" if eid else "unverified"] += 1
            for table in ("mlb_roster_states", "mlb_lineup_states", "mlb_transactions"):
                st["rows"] += conn.execute(
                    f"UPDATE {table} SET athlete_id = ? WHERE mlb_person_id = ? AND athlete_id = ?",
                    (eid, int(ext_id), old)).rowcount
    return st


# ------------------------------------------------------------- rosters

def roster_rows(full, forty, mlb_team, team_id):
    """40-man (all) plus every non-active status on the full roster (IL,
    restricted, ...). The full roster's plain 'A' rows are minor leaguers."""
    rows = {}
    on40 = set()
    for src, data in (("40", forty), ("full", full)):
        for p in (data or {}).get("roster") or []:
            pid = (p.get("person") or {}).get("id")
            code = (p.get("status") or {}).get("code")
            if not pid:
                continue
            if src == "40":
                on40.add(pid)
            elif pid in rows or code in ("A", "40M"):
                continue
            rows[pid] = dict(
                league="mlb", mlb_team_id=mlb_team, team_id=team_id, mlb_person_id=pid,
                name=(p.get("person") or {}).get("fullName"),
                position=(p.get("position") or {}).get("abbreviation"),
                jersey=p.get("jerseyNumber"), status_code=code,
                status_desc=(p.get("status") or {}).get("description"),
                on_40man=int(pid in on40), raw_json=js({k: v for k, v in p.items() if k != "person"}))
    return list(rows.values())


ROSTER_FIELDS = ("team_id", "name", "position", "jersey", "status_code", "status_desc", "on_40man")


def roster_pass(conn, pace, log=print, fetch_fn=None, today=None) -> dict:
    fetch_fn = fetch_fn or fetch
    st = {"errors": 0}
    espn_teams = _teams(conn, "mlb", today)
    if not espn_teams:
        return dict(st, skipped="no MLB games in window")
    teams_json = pace(fetch_fn, "teams", sportId=1, hydrate="venue(location,fieldInfo)")
    at = _now()
    tmap = team_map(conn, teams_json, at)
    st["venues"] = upsert_venues(conn, venue_rows(teams_json, tmap, at))
    inv = {v: k for k, v in tmap.items()}
    st["teams"] = len(espn_teams)
    for espn_id, team_id in espn_teams:
        # Placeholder sides (espn id below 1, or an MLB id below 1 such as
        # TBD / Rays/Guardians) have an empty roster. Skip them so the pass
        # finishes clean instead of logging ValueError: empty roster.
        if espn_id is None or int(espn_id) < 1:
            st["skipped_placeholder"] = st.get("skipped_placeholder", 0) + 1
            continue
        mlb_team = inv.get(team_id)
        if mlb_team is not None and int(mlb_team) < 1:
            st["skipped_placeholder"] = st.get("skipped_placeholder", 0) + 1
            continue
        if mlb_team is None:
            st["errors"] += 1
            log(f"mlb roster: ESPN team {team_id} has no MLB team id")
            continue
        try:
            full = pace(fetch_fn, f"teams/{mlb_team}/roster", rosterType="fullRoster")
            forty = pace(fetch_fn, f"teams/{mlb_team}/roster", rosterType="40Man")
            rows = roster_rows(full, forty, mlb_team, team_id)
            if not rows:
                raise ValueError("empty roster")
            ids = map_people(conn, pace, {r["mlb_person_id"]: (r["name"], team_id) for r in rows},
                             fetch_fn=fetch_fn)
            at = _now()
            with Tx(conn):
                for r in rows:
                    r["athlete_id"] = ids.get(r["mlb_person_id"])
                    if r["athlete_id"]:
                        resolved(conn, SRC, "mlb", "player", r["mlb_person_id"], at)
                        st["matched"] = st.get("matched", 0) + 1
                    elif r["on_40man"] or r["status_code"] in ("D10", "D15"):
                        unmatched(conn, SRC, "mlb", "player", r["mlb_person_id"], r["name"],
                                  str(team_id), f"roster {r['status_code']}", at)
                        st["unmatched"] = st.get("unmatched", 0) + 1
                    else:
                        st["unmapped_minors"] = st.get("unmapped_minors", 0) + 1
                _add(st, track(conn, "mlb_roster_states", ("league", "mlb_team_id", "mlb_person_id"),
                               ROSTER_FIELDS, rows, {"league": "mlb", "mlb_team_id": mlb_team}, at))
                # a mapping found later fills open states that had none
                conn.execute("UPDATE mlb_roster_states SET athlete_id = (SELECT espn_id FROM ext_ids e "
                             "WHERE e.source = ? AND e.league = 'mlb' AND e.kind = 'player' "
                             "AND e.ext_id = CAST(mlb_person_id AS TEXT)) WHERE athlete_id IS NULL "
                             "AND valid_to IS NULL AND mlb_team_id = ?", (SRC, mlb_team))
            st["il"] = st.get("il", 0) + sum(1 for r in rows if r["status_code"] in MLB_IL)
        except Exception as e:
            st["errors"] += 1
            log(f"mlb roster team {mlb_team} ERROR {type(e).__name__}: {e}")
    return st


# ------------------------------------------------------------- transactions

_IL = re.compile(r"injured list", re.I)


def tx_pass(conn, pace, log=print, fetch_fn=None, today=None, days=7) -> dict:
    fetch_fn = fetch_fn or fetch
    if not _teams(conn, "mlb", today):
        return {"errors": 0, "skipped": "no MLB games in window"}
    today = today or datetime.now(espn.CENTRAL).date()
    data = pace(fetch_fn, "transactions", sportId=1,
                startDate=(today - timedelta(days=days)).isoformat(),
                endDate=(today + timedelta(days=1)).isoformat())
    tmap = saved_team_map(conn)
    if not tmap:
        tmap = team_map(conn, pace(fetch_fn, "teams", sportId=1))
    rows = []
    for t in data.get("transactions") or []:
        if not t.get("id"):
            continue
        p = t.get("person") or {}
        to, fr = (t.get("toTeam") or {}).get("id"), (t.get("fromTeam") or {}).get("id")
        rows.append(dict(txn_id=t["id"], txn_date=t.get("date"), effective_date=t.get("effectiveDate"),
                         resolution_date=t.get("resolutionDate"), type_code=t.get("typeCode"),
                         type_desc=t.get("typeDesc"), description=t.get("description"),
                         mlb_person_id=p.get("id"), name=p.get("fullName"), from_mlb_team=fr,
                         to_mlb_team=to, team_id=tmap.get(to) or tmap.get(fr),
                         il_related=int(bool(_IL.search(t.get("description") or ""))),
                         raw_json=js({k: v for k, v in t.items() if k != "person"})))
    # map the MLB-club injured-list moves (and anyone already known)
    known = get_ids(conn, SRC, "mlb", "player")
    want = {r["mlb_person_id"]: (r["name"], r["team_id"]) for r in rows if r["mlb_person_id"]
            and (str(r["mlb_person_id"]) in known or (r["il_related"] and r["team_id"]))}
    ids = map_people(conn, pace, want, fetch_fn=fetch_fn) if want else {}
    at = _now()
    st = {"errors": 0, "seen": len(rows), "il": sum(r["il_related"] for r in rows)}
    with Tx(conn):
        before = conn.total_changes
        for r in rows:
            r["athlete_id"] = ids.get(r["mlb_person_id"])
            new = conn.execute("SELECT 1 FROM mlb_transactions WHERE txn_id = ?", (r["txn_id"],)).fetchone() is None
            conn.execute(
                "INSERT INTO mlb_transactions (txn_id, txn_date, effective_date, resolution_date, "
                "type_code, type_desc, description, mlb_person_id, athlete_id, from_mlb_team, "
                "to_mlb_team, team_id, il_related, first_seen, last_seen, raw_json) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (txn_id) DO UPDATE SET "
                "description = excluded.description, resolution_date = excluded.resolution_date, "
                "athlete_id = COALESCE(excluded.athlete_id, athlete_id), last_seen = excluded.last_seen, "
                "raw_json = excluded.raw_json",
                (r["txn_id"], r["txn_date"], r["effective_date"], r["resolution_date"], r["type_code"],
                 r["type_desc"], r["description"], r["mlb_person_id"], r["athlete_id"],
                 r["from_mlb_team"], r["to_mlb_team"], r["team_id"], r["il_related"], at, at,
                 r["raw_json"]))
            st["rows"] = st.get("rows", 0) + int(new)
            if r["il_related"] and r["team_id"]:
                if r["athlete_id"]:
                    st["matched"] = st.get("matched", 0) + 1
                    resolved(conn, SRC, "mlb", "player", r["mlb_person_id"], at)
                elif r["mlb_person_id"]:
                    st["unmatched"] = st.get("unmatched", 0) + 1
                    unmatched(conn, SRC, "mlb", "player", r["mlb_person_id"], r["name"],
                              str(r["team_id"]), "transaction IL", at)
        st["written"] = conn.total_changes - before
    return st


# ------------------------------------------------------------- lineups + probables

def due_mlb(conn, now):
    a = (now + timedelta(minutes=LINEUP_WINDOW[0])).strftime("%Y-%m-%dT%H:%M")
    b = (now + timedelta(minutes=LINEUP_WINDOW[1])).strftime("%Y-%m-%dT%H:%MZ")
    return conn.execute(
        "SELECT espn_event_id, start_time_utc FROM games g WHERE league = 'mlb' AND completed = 0 "
        f"AND {db.playable_sql('g')} AND start_time_utc BETWEEN ? AND ?", (a, b)).fetchall()


def lineup_rows(g, side, team_id, eid):
    t = g["teams"][side]
    rows = []
    pp = t.get("probablePitcher") or {}
    if pp.get("id"):
        rows.append(dict(slot=0, mlb_person_id=pp["id"], name=pp.get("fullName"), position="SP", raw=pp))
    for i, p in enumerate((g.get("lineups") or {}).get(f"{side}Players") or [], 1):
        rows.append(dict(slot=i, mlb_person_id=p.get("id"), name=p.get("fullName"),
                         position=(p.get("primaryPosition") or {}).get("abbreviation"), raw=p))
    return [dict(r, league="mlb", game_pk=g["gamePk"], espn_event_id=eid, side=side, team_id=team_id,
                 raw_json=js({k: v for k, v in r.pop("raw").items() if k != "link"})) for r in rows]


LINEUP_FIELDS = ("mlb_person_id", "position")


def lineups_pass(conn, pace, now=None, log=print, fetch_fn=None) -> dict:
    """Poll the schedule (one request per date) while any MLB game is within
    LINEUP_WINDOW of first pitch: probable pitchers and, once posted, the
    batting orders. Change-only, so valid_from is when we first saw it."""
    fetch_fn = fetch_fn or fetch
    now = now or datetime.now(timezone.utc)
    due = due_mlb(conn, now)
    st = {"errors": 0}
    if not due:
        return dict(st, skipped="no MLB game near first pitch")
    tmap = saved_team_map(conn)
    if not tmap:
        tmap = team_map(conn, pace(fetch_fn, "teams", sportId=1))
    lo = now + timedelta(minutes=LINEUP_WINDOW[0])
    hi = now + timedelta(minutes=LINEUP_WINDOW[1])
    for d in sorted({espn.eastern_date(s) for _, s in due}):
        try:
            data = pace(fetch_fn, "schedule", sportId=1, date=d,
                        hydrate="probablePitcher,lineups,venue,weather")
        except Exception as e:
            st["errors"] += 1
            log(f"mlb lineups schedule {d} ERROR {type(e).__name__}: {e}")
            continue
        at = now.isoformat(timespec="seconds")
        for day in data.get("dates") or []:
            for g in day.get("games") or []:
                try:
                    _add(st, store_game(conn, pace, g, tmap, lo, hi, at, fetch_fn))
                except Exception as e:
                    st["errors"] += 1
                    log(f"mlb lineups game {g.get('gamePk')} ERROR {type(e).__name__}: {e}")
    return st


def store_game(conn, pace, g, tmap, lo, hi, at, fetch_fn) -> dict:
    start = g.get("gameDate")
    state = (g.get("status") or {}).get("detailedState")
    if not start or not (lo <= _utc(start) <= hi) or state in SKIP_STATES:
        return {}
    st = {"games": 1}
    home_m, away_m = (g["teams"][s]["team"]["id"] for s in ("home", "away"))
    home, away = tmap.get(home_m), tmap.get(away_m)
    eid = game_for(conn, "mlb", [home, away], start, hours=6, home=home)
    if eid is None:
        with Tx(conn):
            unmatched(conn, SRC, "mlb", "game", g["gamePk"], g.get("description") or state,
                      f"{away_m}@{home_m}", start, at)
        st["unmatched_games"] = 1
    rows = lineup_rows(g, "home", home, eid) + lineup_rows(g, "away", away, eid)
    people = {r["mlb_person_id"]: (r["name"], r["team_id"]) for r in rows if r["mlb_person_id"]}
    ids = map_people(conn, pace, people, fetch_fn=fetch_fn) if people else {}
    n_home = sum(1 for r in rows if r["side"] == "home" and r["slot"] > 0)
    n_away = sum(1 for r in rows if r["side"] == "away" and r["slot"] > 0)
    with Tx(conn):
        if eid:
            save_id(conn, SRC, "mlb", "game", g["gamePk"], eid, "teams_start", None, None, at)
            resolved(conn, SRC, "mlb", "game", g["gamePk"], at)
        for r in rows:
            r["athlete_id"] = ids.get(r["mlb_person_id"])
            if r["athlete_id"]:
                st["matched"] = st.get("matched", 0) + 1
                resolved(conn, SRC, "mlb", "player", r["mlb_person_id"], at)
            else:
                st["unmatched"] = st.get("unmatched", 0) + 1
                unmatched(conn, SRC, "mlb", "player", r["mlb_person_id"], r["name"],
                          str(r["team_id"]), f"lineup {g['gamePk']}", at)
        _add(st, track(conn, "mlb_lineup_states", ("game_pk", "side", "slot"), LINEUP_FIELDS, rows,
                       {"game_pk": g["gamePk"]}, at))
        w = g.get("weather") or {}
        conn.execute(
            "INSERT INTO mlb_games (game_pk, espn_event_id, official_date, start_time_utc, "
            "home_mlb_team, away_mlb_team, venue_id, game_number, status, lineup_home_at, "
            "lineup_away_at, weather_json, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT (game_pk) DO UPDATE SET espn_event_id = COALESCE(excluded.espn_event_id, "
            "espn_event_id), start_time_utc = excluded.start_time_utc, status = excluded.status, "
            "lineup_home_at = COALESCE(lineup_home_at, excluded.lineup_home_at), "
            "lineup_away_at = COALESCE(lineup_away_at, excluded.lineup_away_at), "
            "weather_json = COALESCE(excluded.weather_json, weather_json), last_seen = excluded.last_seen",
            (g["gamePk"], eid, g.get("officialDate"), start, home_m, away_m,
             (g.get("venue") or {}).get("id"), g.get("gameNumber"), state,
             at if n_home >= 9 else None, at if n_away >= 9 else None, js(w) if w else None, at, at))
        if eid:
            conn.execute("INSERT OR IGNORE INTO src_game_passes (source, espn_event_id, phase, "
                         "fetched_at, found) VALUES ('mlb_lineups', ?, 'poll', ?, ?)",
                         (eid, at, int(n_home >= 9 and n_away >= 9)))
    st["lineups_posted"] = int(n_home >= 9) + int(n_away >= 9)
    return st


# Games we refresh: today's slate, and anything starting inside this window
# (a late game whose Central date is already tomorrow).
PROBABLE_HORIZON = timedelta(hours=8)
# A probable last seen longer ago than this, on a game inside 3 hours of
# first pitch, is stale. 150 minutes keeps the 06:00 fetch fresh until the
# first :15 pass, and still flags a job that has stopped.
STALE_PROBABLE = timedelta(minutes=150)
SOON_PITCH = timedelta(hours=3)


def due_probable_games(conn, now):
    """Unplayed MLB games whose probable should be fresh: Central today, or
    first pitch inside PROBABLE_HORIZON. Started games are left out."""
    today = now.astimezone(espn.CENTRAL).date().isoformat()
    hi = (now + PROBABLE_HORIZON).strftime("%Y-%m-%dT%H:%M:%S")
    rows = conn.execute(
        "SELECT espn_event_id, start_time_utc, game_date FROM games g "
        "WHERE league = 'mlb' AND completed = 0 AND season_type IN (2, 3) "
        f"AND {db.playable_sql('g')} AND (game_date = ? OR start_time_utc <= ?)",
        (today, hi)).fetchall()
    out = []
    for eid, start, gd in rows:
        try:
            st = _utc(start)
        except (TypeError, ValueError):
            continue
        if st <= now:
            continue
        if gd == today or st <= now + PROBABLE_HORIZON:
            out.append((int(eid), st, gd))
    return out


def probable_freshness(starts, seen, now, soon=SOON_PITCH, stale=STALE_PROBABLE):
    """(eid, ok, why) for games with now < start <= now+soon.

    `starts` is {eid: aware start}. `seen` is {eid: [last_seen or None]}
    for the current probable-pitcher rows, one entry per team. A game is
    fresh when both sides have a probable last seen within `stale`."""
    out = []
    for eid, st in starts.items():
        if st.tzinfo is None:
            st = st.replace(tzinfo=timezone.utc)
        if not (now < st <= now + soon):
            continue
        rows = seen.get(eid) or []
        old = [t for t in rows if t is None or now - t > stale]
        if len(rows) < 2 or old:
            out.append((eid, False, "missing" if len(rows) < 2 else "stale"))
        else:
            out.append((eid, True, "fresh"))
    return out


def freshness_summary(rows):
    """(level, message) or None when no game is inside the window."""
    if not rows:
        return None
    good = sum(1 for _, ok, _ in rows if ok)
    level = "OK" if good == len(rows) else "WARN"
    msg = (f"{good}/{len(rows)} games within 3h of first pitch have a probable "
           f"under {int(STALE_PROBABLE.total_seconds() // 60)} min old")
    return level, msg


def probables_pass(conn, pace, now=None, log=print, fetch_fn=None) -> dict:
    """Refresh ESPN probable pitchers on an MLB game day, then rewrite
    unlocked forecasts whose pitcher changed.

    One scoreboard request per eastern date of the games that are due.
    No such game (the off-season, or a day already played) returns
    skipped and makes no request. A locked forecast is not rewritten."""
    from .. import starters
    fetch_fn = fetch_fn or espn.fetch_scoreboard
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    due = due_probable_games(conn, now)
    if not due:
        return {"errors": 0, "skipped": "no MLB games"}
    at = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    eids = [e for e, _, _ in due]
    before = starters.sp_map(conn, eids, at)
    st = {"errors": 0}
    dates = sorted({espn.eastern_date(s.strftime("%Y-%m-%dT%H:%M:%SZ")) for _, s, _ in due})
    for d in dates:
        try:
            data = pace(fetch_fn, "mlb", dates=d.replace("-", ""))
            _add(st, store_scoreboard(conn, "mlb", parse_scoreboard(data, "mlb"), at))
        except Exception as e:
            st["errors"] += 1
            log(f"mlb probables {d} FAILED {type(e).__name__}: {e}")
    after = starters.sp_map(conn, eids, at)
    changed = starters.probable_changed(before, after)
    st["starter_changes"] = len(changed)
    if changed:
        try:
            st["forecasts"] = starters.refresh_mlb(conn, changed, now, as_of=at, log=log)
        except Exception as e:
            st["errors"] += 1
            log(f"mlb probable refresh FAILED {type(e).__name__}: {e}")
    return st


def _utc(s):
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
