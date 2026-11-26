"""Historical pregame injury reports for training.

NFL: nflverse injuries_{season}.csv, every season from 2009. The file is
one row per player per week, the report nflverse publishes for that week.
NBA: the official injury-report PDF, one file per calendar day from the
2019 season (2018-19). The noon Eastern report is kept when it exists,
otherwise 11:00, 1:00 or 5:00. NHL has no official report. MLB is out of
scope.

The nightly job (prelog inj-hist, 07:25 CT) fills NBA game days in the
last 3 days that have no report yet, and refreshes the current NFL injury
file while the league has a game in the surrounding three weeks. A day or
a past season already stored is not downloaded again.

    python scripts/backfill_injuries.py --out injuries_2024.db --from-season 2024 --to-season 2024
    python scripts/load_injuries.py --db data/bayesratings.db --from injuries_2024.db

Training reads the stored status. The live forecast path is unchanged.
"""

import argparse
import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .. import db, espn
from ..prelog import Tx, _now
from . import nbainj, nflverse
from .common import Missing, http_get, robots_allowed

NBA_MISS = "injhist:nba:miss:"
NFL_MARK = "injhist:nfl:"
REPORT_COLS = (
    "report_slot", "report_ts_utc", "url", "fetched_at", "backfill", "n_rows",
    "n_unmatched", "text_sha1", "text_gz", "pdf_gz",
)
NBA_STATE_COLS = (
    "league", "game_date", "team_name", "player_key", "team_id", "matchup",
    "game_time", "espn_event_id", "athlete_id", "player_name", "status", "reason",
    "report_slot", "raw_json", "state_hash", "valid_from", "valid_to", "last_seen",
)
NFL_STATE_COLS = (
    "league", "season", "game_type", "week", "team", "gsis_id", "team_id",
    "athlete_id", "full_name", "position", "report_primary_injury",
    "report_secondary_injury", "report_status", "practice_primary_injury",
    "practice_secondary_injury", "practice_status", "raw_json", "state_hash",
    "valid_from", "valid_to", "last_seen",
)


def _meta(conn, key):
    row = conn.execute("SELECT value, updated_at FROM src_meta WHERE key = ?", (key,)).fetchone()
    return row


def _put_meta(conn, key, value, at):
    conn.execute(
        "INSERT OR REPLACE INTO src_meta (key, value, updated_at) VALUES (?,?,?)",
        (key, value, at))


def _has_table(conn, name):
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def _dates(start, end):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


# ---------------------------------------------------------------- NBA days

def pull_nba_day(conn, pace, day, fetch, link=True, honor_miss=True, log=print) -> dict:
    """One calendar day. A stored report or a recorded miss is not requested again."""
    day = day if isinstance(day, date) else date.fromisoformat(str(day)[:10])
    key = day.isoformat()
    if nbainj.report_stored(conn, key):
        return {"day": key, "skipped": "stored"}
    if honor_miss and _meta(conn, NBA_MISS + key):
        return {"day": key, "skipped": "missing"}
    got = None
    slot = None
    try:
        for hh, mm in nbainj.ARCHIVE_TIMES:
            slot = datetime(day.year, day.month, day.day, hh, mm, tzinfo=nbainj.EASTERN)
            got = nbainj.fetch_slot(conn, pace, slot, fetch)
            if got:
                break
    except RuntimeError:
        raise
    except Exception as e:
        log(f"nba injury {key} FAILED {type(e).__name__}: {e}")
        return {"day": key, "errors": 1, "fatal": f"{type(e).__name__}: {e}"}
    if not got:
        at = _now()
        with Tx(conn):
            _put_meta(conn, NBA_MISS + key, "404", at)
        return {"day": key, "missing": 1}
    url, pdf = got
    try:
        parsed = nbainj.parse_report(pdf)
    except Exception as e:
        log(f"nba injury {key} PARSE {type(e).__name__}: {e}")
        return {"day": key, "errors": 1, "fatal": f"{type(e).__name__}: {e}"}
    if not parsed["rows"]:
        log(f"nba injury {key} parsed no rows")
        return {"day": key, "errors": 1, "fatal": "no rows"}
    st = nbainj.store_report(conn, slot, url, pdf, parsed, _now(), backfill=True,
                             keep_pdf=False, link=link)
    st["day"] = key
    st["errors"] = 0
    return st


def pull_nba_season(conn, pace, season, fetch, link=True, log=print) -> dict:
    """Every date in the season. Stored days and recorded misses are skipped."""
    if int(season) < nbainj.ARCHIVE_FIRST:
        return {"season": int(season), "skipped": f"reports start in {nbainj.ARCHIVE_FIRST}"}
    start, end = nbainj.season_span(season)
    sample = nbainj.slot_urls(datetime(start.year, start.month, start.day, 12, 0,
                                       tzinfo=nbainj.EASTERN))[0]
    if not robots_allowed(conn, sample, pace, fetch):
        raise RuntimeError("robots.txt disallows the NBA injury report")
    st = {"season": int(season), "days": 0, "missing": 0, "errors": 0, "rows": 0, "skipped": 0}
    for day in _dates(start, end):
        one = pull_nba_day(conn, pace, day, fetch, link=link, honor_miss=True, log=log)
        if one.get("errors"):
            st["errors"] += 1
        elif one.get("missing"):
            st["missing"] += 1
        elif one.get("skipped"):
            st["skipped"] += 1
        else:
            st["days"] += 1
            st["rows"] += one.get("rows", 0)
    log(f"nba injury season {season}: {st['days']} days, {st['rows']} rows, "
        f"{st['missing']} missing, {st['skipped']} skipped")
    return st


# ---------------------------------------------------------------- NFL seasons

def _nfl_marker(season):
    return f"{NFL_MARK}{int(season)}"


def pull_nfl_season(conn, pace, season, fetch, today, link=True, log=print) -> dict:
    """One injuries_{season}.csv. A past season whose file is unchanged is not
    downloaded again. The current season is fetched, and stored only when
    the file changed."""
    season = int(season)
    if season < nflverse.INJURY_FIRST:
        return {"season": season, "skipped": f"injuries start in {nflverse.INJURY_FIRST}"}
    current = nflverse.season_of(today) == season
    marker = _meta(conn, _nfl_marker(season))
    if marker and not current:
        return {"season": season, "skipped": "stored"}
    url = nflverse.INJURY_URL.format(season=season)
    if not robots_allowed(conn, url, pace, fetch):
        raise RuntimeError("robots.txt disallows nflverse injuries")
    try:
        body = pace(fetch, url, accept="text/csv")
    except Missing:
        log(f"nfl injuries {season} not published")
        return {"season": season, "missing": 1}
    digest = hashlib.sha1(body).hexdigest()
    at = _now()
    if marker and marker[0] == digest:
        with Tx(conn):
            conn.execute("UPDATE src_meta SET updated_at = ? WHERE key = ?",
                         (at, _nfl_marker(season)))
        return {"season": season, "unchanged": 1}
    st = nflverse.store_injury_body(conn, body, at, link=link)
    if st.get("errors"):
        log(f"nfl injuries {season} {st.get('fatal')}")
        return st
    with Tx(conn):
        _put_meta(conn, _nfl_marker(season), digest, at)
    log(f"nfl injuries {season}: {st.get('injury_rows', 0)} rows")
    return st


def _nfl_in_season(conn, today):
    if not _has_table(conn, "games"):
        return False
    start = (today - timedelta(days=14)).isoformat()
    end = (today + timedelta(days=7)).isoformat()
    return conn.execute(
        "SELECT 1 FROM games WHERE league = 'nfl' AND season_type IN (2, 3) "
        "AND game_date BETWEEN ? AND ? LIMIT 1", (start, end)).fetchone() is not None


# ---------------------------------------------------------------- nightly

def current_pass(conn, pace, now=None, log=print, fetch=None) -> dict:
    """NBA days in the last 3 days with no report, and the current NFL file.

    No such day, and an NFL file already stored with no game nearby, makes
    no request.
    """
    fetch = fetch or http_get
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(espn.CENTRAL).date()
    nba_days = []
    if _has_table(conn, "games"):
        start = (today - timedelta(days=2)).isoformat()
        nba_days = [r[0] for r in conn.execute(
            "SELECT DISTINCT game_date FROM games WHERE league = 'nba' AND season_type IN (2, 3) "
            "AND game_date BETWEEN ? AND ? ORDER BY game_date", (start, today.isoformat()))]
    pending = [d for d in nba_days if not nbainj.report_stored(conn, d)]
    season = nflverse.season_of(today)
    nfl_due = _nfl_in_season(conn, today) or _meta(conn, _nfl_marker(season)) is None
    if not pending and not nfl_due:
        return {"skipped": "nothing to fetch"}
    st = {"errors": 0, "nba_days": 0, "nba_missing": 0, "nba_rows": 0}
    if pending:
        sample = nbainj.slot_urls(datetime(today.year, today.month, today.day, 12, 0,
                                           tzinfo=nbainj.EASTERN))[0]
        if not robots_allowed(conn, sample, pace, fetch):
            raise RuntimeError("robots.txt disallows the NBA injury report")
        for d in pending:
            # honor_miss is off: a report that 404'd yesterday can be published today
            one = pull_nba_day(conn, pace, d, fetch, link=True, honor_miss=False, log=log)
            if one.get("errors"):
                st["errors"] += 1
            elif one.get("missing"):
                st["nba_missing"] += 1
            elif not one.get("skipped"):
                st["nba_days"] += 1
                st["nba_rows"] += one.get("rows", 0)
    if nfl_due:
        one = pull_nfl_season(conn, pace, season, fetch, today, link=True, log=log)
        st["nfl"] = {k: one[k] for k in one if k in (
            "season", "injury_rows", "skipped", "missing", "unchanged", "errors", "fatal")}
        st["errors"] += one.get("errors", 0)
    elif not pending:
        return {"skipped": "nothing to fetch"}
    return st


def backfill(conn, pace, season_from, season_to, fetch=None, today=None, league="both",
             link=False, log=print) -> dict:
    """NBA dates and NFL season files for the range, into this connection.

    Seasons already stored are skipped. `league` is nba, nfl, or both.
    NBA uses the end-year label (2025 is 2024-25). NFL uses the start year.
    """
    fetch = fetch or http_get
    today = today or datetime.now(espn.CENTRAL).date()
    season_from, season_to = int(season_from), int(season_to)
    league = (league or "both").lower()
    out = {"errors": 0, "nba": [], "nfl": []}
    if league in ("nba", "both"):
        for season in range(season_from, season_to + 1):
            st = pull_nba_season(conn, pace, season, fetch, link=link, log=log)
            out["nba"].append(st)
            out["errors"] += st.get("errors", 0)
    if league in ("nfl", "both"):
        for season in range(season_from, season_to + 1):
            st = pull_nfl_season(conn, pace, season, fetch, today, link=link, log=log)
            out["nfl"].append(st)
            out["errors"] += st.get("errors", 0)
    return out


# ---------------------------------------------------------------- load

def _latest(rows, keyfn):
    best = {}
    for r in rows:
        key = keyfn(r)
        cur = best.get(key)
        if cur is None or str(r["valid_from"] or "") >= str(cur["valid_from"] or ""):
            best[key] = r
    return list(best.values())


def _insert_new(conn, table, cols, rows, exists_sql, exists_args):
    """Insert rows whose natural key is absent. Returns how many were inserted."""
    n = 0
    sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})"
    for r in rows:
        if conn.execute(exists_sql, exists_args(r)).fetchone():
            continue
        conn.execute(sql, [r[c] if c in r.keys() else None for c in cols])
        n += 1
    return n


def load_into(conn, src_path) -> dict:
    """Copy a shipped injury file into conn and link ESPN ids.

    A report slot or player-week already stored is left as it is, so a
    second load inserts nothing. Running it again links any id that is
    still empty.
    """
    path = Path(src_path).resolve()
    if not path.is_file():
        raise FileNotFoundError(str(path))
    if "'" in str(path):
        raise ValueError("the shipped file path cannot contain a quote")
    db.init_db(conn)
    conn.commit()
    conn.execute(f"ATTACH DATABASE '{path}' AS inj_src")
    try:
        counts = {"nba_injury_reports": 0, "nba_injury_states": 0,
                  "nfl_injury_report_states": 0}
        with Tx(conn):
            if conn.execute(
                    "SELECT 1 FROM inj_src.sqlite_master WHERE type = 'table' AND name = ?",
                    ("nba_injury_reports",)).fetchone():
                have = {r[0] for r in conn.execute("SELECT report_slot FROM nba_injury_reports")}
                rows = conn.execute(
                    f"SELECT {', '.join(REPORT_COLS)} FROM inj_src.nba_injury_reports").fetchall()
                for r in rows:
                    if r["report_slot"] in have:
                        continue
                    conn.execute(
                        f"INSERT INTO nba_injury_reports ({', '.join(REPORT_COLS)}) "
                        f"VALUES ({', '.join('?' * len(REPORT_COLS))})",
                        [r[c] for c in REPORT_COLS])
                    counts["nba_injury_reports"] += 1
            if conn.execute(
                    "SELECT 1 FROM inj_src.sqlite_master WHERE type = 'table' AND name = ?",
                    ("nba_injury_states",)).fetchone():
                src_rows = conn.execute(
                    f"SELECT {', '.join(NBA_STATE_COLS)} FROM inj_src.nba_injury_states").fetchall()
                latest = _latest(src_rows, lambda r: (r["game_date"], r["team_name"], r["player_key"]))
                counts["nba_injury_states"] = _insert_new(
                    conn, "nba_injury_states", NBA_STATE_COLS, latest,
                    "SELECT 1 FROM nba_injury_states WHERE game_date = ? AND team_name = ? "
                    "AND player_key = ? LIMIT 1",
                    lambda r: (r["game_date"], r["team_name"], r["player_key"]))
            if conn.execute(
                    "SELECT 1 FROM inj_src.sqlite_master WHERE type = 'table' AND name = ?",
                    ("nfl_injury_report_states",)).fetchone():
                src_rows = conn.execute(
                    f"SELECT {', '.join(NFL_STATE_COLS)} FROM inj_src.nfl_injury_report_states").fetchall()
                latest = _latest(
                    src_rows, lambda r: (r["season"], r["week"], r["team"], r["gsis_id"]))
                counts["nfl_injury_report_states"] = _insert_new(
                    conn, "nfl_injury_report_states", NFL_STATE_COLS, latest,
                    "SELECT 1 FROM nfl_injury_report_states WHERE season = ? AND week = ? "
                    "AND team = ? AND gsis_id = ? LIMIT 1",
                    lambda r: (r["season"], r["week"], r["team"], r["gsis_id"]))
            if conn.execute(
                    "SELECT 1 FROM inj_src.sqlite_master WHERE type = 'table' AND name = 'src_meta'"
                    ).fetchone():
                conn.execute(
                    "INSERT OR IGNORE INTO src_meta (key, value, updated_at) "
                    "SELECT key, value, updated_at FROM inj_src.src_meta "
                    "WHERE key LIKE 'injhist:%'")
        linked = {}
        linked.update({f"nba_{k}": v for k, v in nbainj.link_states(conn).items()})
        linked.update({f"nfl_{k}": v for k, v in nflverse.link_injuries(conn).items()})
        counts.update(linked)
        counts["nfl_weeks_with_espn"] = _nfl_weeks_linked(conn)
        return counts
    finally:
        conn.execute("DETACH DATABASE inj_src")


def _nfl_weeks_linked(conn):
    """Injury weeks whose franchise and week match a schedule row that has an ESPN id."""
    if not _has_table(conn, "nfl_schedule"):
        return 0
    from ..nfl_player import canon
    weeks = {(canon(team), int(season), int(week))
             for season, week, team in conn.execute(
                 "SELECT DISTINCT season, week, team FROM nfl_injury_report_states "
                 "WHERE season IS NOT NULL AND week IS NOT NULL AND team IS NOT NULL")}
    if not weeks:
        return 0
    n = 0
    for season, week, home, away, eid in conn.execute(
            "SELECT season, week, home_franchise, away_franchise, espn_event_id "
            "FROM nfl_schedule WHERE espn_event_id IS NOT NULL AND week IS NOT NULL"):
        key_h = (canon(home), int(season), int(week))
        key_a = (canon(away), int(season), int(week))
        if key_h in weeks or key_a in weeks:
            n += 1
    return n


def freshness(conn, now):
    """Lines for yesterday, or none when that day had no NBA or NFL game.

    NBA: a finished game needs a stored report for its date.
    NFL: a finished game needs the season's injury file touched in the last 36 hours.
    """
    if not _has_table(conn, "games"):
        return []
    yesterday = (now.astimezone(espn.CENTRAL).date() - timedelta(days=1)).isoformat()
    out = []
    nba = conn.execute(
        "SELECT COUNT(*) FROM games g WHERE league = 'nba' AND completed = 1 "
        "AND season_type IN (2, 3) "
        f"AND {db.playable_sql('g')} AND game_date = ?", (yesterday,)).fetchone()[0]
    if nba:
        if not _has_table(conn, "nba_injury_reports"):
            out.append(("inj_hist", "FAIL", f"0/{nba} finished NBA games have an injury report"))
        else:
            got = conn.execute(
                "SELECT 1 FROM nba_injury_reports WHERE substr(report_slot, 1, 10) = ? LIMIT 1",
                (yesterday,)).fetchone()
            if got:
                out.append(("inj_hist_nba", "OK", f"{nba} finished NBA games have a report"))
            else:
                out.append(("inj_hist_nba", "FAIL",
                            f"0/{nba} finished NBA games have an injury report"))
    nfl = conn.execute(
        "SELECT season FROM games g WHERE league = 'nfl' AND completed = 1 "
        "AND season_type IN (2, 3) "
        f"AND {db.playable_sql('g')} AND game_date = ? LIMIT 1", (yesterday,)).fetchone()
    if nfl:
        season = int(nfl[0])
        row = _meta(conn, _nfl_marker(season)) if _has_table(conn, "src_meta") else None
        fresh = False
        if row and row[1]:
            try:
                seen = datetime.fromisoformat(str(row[1]).replace("Z", "+00:00"))
                if seen.tzinfo is None:
                    seen = seen.replace(tzinfo=timezone.utc)
                fresh = now - seen <= timedelta(hours=36)
            except ValueError:
                fresh = False
        if fresh:
            out.append(("inj_hist_nfl", "OK", f"NFL {season} injury file is current"))
        else:
            out.append(("inj_hist_nfl", "FAIL", f"NFL {season} injury file was not refreshed"))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Historical NBA and NFL injury reports")
    ap.add_argument("--db", required=True)
    ap.add_argument("--backfill", action="store_true")
    ap.add_argument("--from-season", type=int)
    ap.add_argument("--to-season", type=int)
    ap.add_argument("--rate", type=float, default=1.0,
                    help="seconds between requests (default 1)")
    ap.add_argument("--league", default="both", choices=("nba", "nfl", "both"))
    ap.add_argument("--load", help="ATTACH this SQLite file and copy it into --db")
    a = ap.parse_args(argv)
    from ..backfill import Pacer
    conn = db.connect(a.db)
    conn.isolation_level = None
    db.init_db(conn)
    if a.load:
        print(json.dumps(load_into(conn, a.load)))
        return 0
    if a.backfill:
        if a.from_season is None or a.to_season is None:
            ap.error("--backfill needs --from-season and --to-season")
        st = backfill(conn, Pacer(a.rate), a.from_season, a.to_season, league=a.league, link=False)
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        if not conn.execute("SELECT COUNT(*) FROM games").fetchone()[0]:
            conn.execute("PRAGMA journal_mode = DELETE")
        print(json.dumps(st, default=str))
        return 1 if st.get("errors") else 0
    st = current_pass(conn, Pacer(a.rate))
    print(json.dumps(st, default=str))
    return 1 if st.get("errors") else 0


if __name__ == "__main__":
    raise SystemExit(main())
