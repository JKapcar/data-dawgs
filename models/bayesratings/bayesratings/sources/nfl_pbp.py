"""nflverse play-by-play into per-game quarterback EPA rows.

Public GitHub release parquets, one file a season, from 2006. The current
season is refreshed; an older season whose file has not changed is left
alone. The schedule file supplies the actual starter of a completed game
and the ESPN event id. The nflverse schedule has spread, total, and
moneyline columns. This package does not store them. A contributor can
add them.

Polite: the shared client (identifying User-Agent, retries), robots.txt,
and a gap between requests. A failed download or parse leaves the rows
already stored for that season in place.

    python -m bayesratings.sources.nfl_pbp --db data/bayesratings.db --from-season 2006
"""

import argparse
import csv
import hashlib
import io
import sqlite3
from datetime import datetime

import pandas as pd

from .. import espn
from ..nfl_player import TRAIN_FROM_SEASON, canon, qb_lines
from ..prelog import Tx, _now, _teams
from .common import Missing, http_get, robots_allowed
from .nflverse import season_of

PBP_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.parquet"
SCHED_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv"
# columns read from play-by-play. Anything else in the file is not stored.
PBP_READ = ["game_id", "season", "game_date", "posteam", "play_type", "epa",
            "qb_dropback", "passer_player_id", "rusher_player_id", "cpoe"]
# columns read from the schedule. The file's spread, total, and moneyline
# columns are not in this list, and this package does not store them.
SCHED_READ = ("game_id", "season", "game_type", "week", "gameday", "home_team",
              "away_team", "home_score", "away_score", "espn", "home_qb_id", "away_qb_id")


def _digest(body: bytes) -> str:
    return hashlib.sha1(body).hexdigest()


def _meta(conn, key):
    try:
        row = conn.execute("SELECT value FROM src_meta WHERE key = ?", (key,)).fetchone()
    except Exception:
        return None
    return row[0] if row else None


def _put_meta(conn, key, value, at):
    conn.execute("INSERT OR REPLACE INTO src_meta (key, value, updated_at) VALUES (?,?,?)",
                 (key, value, at))


def _num(v):
    if v is None:
        return None
    text = str(v).strip()
    if not text or text.lower() in ("nan", "na", "none"):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _int(v):
    n = _num(v)
    if n is None:
        return None
    return int(n)


def _text(v):
    if v is None:
        return None
    text = str(v).strip()
    if not text or text.lower() in ("nan", "na", "none"):
        return None
    return text


def parse_schedule(body: bytes) -> list:
    """Schedule rows from 2006 on. Raises when the file has no usable games.

    Only SCHED_READ is copied onto the stored row. The schedule's spread,
    total, and moneyline columns are not stored. A contributor can add them.
    """
    text = body.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise ValueError("schedule file has no header")
    missing = [c for c in ("game_id", "season", "gameday", "home_team", "away_team")
               if c not in reader.fieldnames]
    if missing:
        raise ValueError("schedule file missing " + ", ".join(missing))
    out = []
    for raw in reader:
        season = _int(raw.get("season"))
        game_id = _text(raw.get("game_id"))
        if season is None or season < TRAIN_FROM_SEASON or not game_id:
            continue
        out.append({
            "game_id": game_id,
            "season": season,
            "week": _int(raw.get("week")),
            "game_type": _text(raw.get("game_type")),
            "game_date": _text(raw.get("gameday")),
            "home_franchise": canon(raw.get("home_team")),
            "away_franchise": canon(raw.get("away_team")),
            "home_qb_gsis": _text(raw.get("home_qb_id")),
            "away_qb_gsis": _text(raw.get("away_qb_id")),
            "espn_event_id": _int(raw.get("espn")),
            "home_score": _num(raw.get("home_score")),
            "away_score": _num(raw.get("away_score")),
        })
    if not out:
        raise ValueError("schedule file has no games from 2006 on")
    return out


def parse_pbp(body: bytes, season: int) -> pd.DataFrame:
    """Quarterback lines for one season file. Raises when the file is unreadable
    or has no dropbacks. The season stored is the file's season, not a guess."""
    try:
        plays = pd.read_parquet(io.BytesIO(body), columns=PBP_READ)
    except Exception as e:
        raise ValueError(f"play-by-play {season} unreadable: {type(e).__name__}: {e}") from e
    lines = qb_lines(plays)
    if not len(lines):
        raise ValueError(f"play-by-play {season} has no quarterback dropbacks")
    lines["season"] = int(season)
    return lines


def _cached(conn, key, digest, count_sql, params):
    if _meta(conn, key) != digest:
        return False
    try:
        n = conn.execute(count_sql, params).fetchone()[0]
    except Exception:
        return False
    return bool(n)


def replace_schedule(conn, body: bytes, at=None) -> int:
    """Replace nfl_schedule. A bad file raises before any row is deleted."""
    digest = _digest(body)
    if _cached(conn, "nfl_schedule", digest, "SELECT COUNT(*) FROM nfl_schedule", ()):
        return 0
    rows = parse_schedule(body)
    at = at or _now()
    cols = ("game_id", "season", "week", "game_type", "game_date", "home_franchise",
            "away_franchise", "home_qb_gsis", "away_qb_gsis", "espn_event_id",
            "home_score", "away_score")
    with Tx(conn):
        conn.execute("DELETE FROM nfl_schedule")
        conn.executemany(
            f"INSERT INTO nfl_schedule ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
            [tuple(r[c] for c in cols) for r in rows])
        _put_meta(conn, "nfl_schedule", digest, at)
    return len(rows)


def replace_season(conn, season: int, body: bytes, at=None) -> int:
    """Replace one season's quarterback lines. A bad file raises first."""
    season = int(season)
    digest = _digest(body)
    key = f"nfl_pbp:{season}"
    if _cached(conn, key, digest, "SELECT COUNT(*) FROM nfl_pbp_qb WHERE season = ?", (season,)):
        return 0
    lines = parse_pbp(body, season)
    at = at or _now()
    recs = []
    for r in lines.itertuples(index=False):
        recs.append((str(r.game_id), season, None if pd.isna(r.game_date) else str(r.game_date)[:10],
                     str(r.team), str(r.qb), float(r.qb_epa), int(r.qb_n),
                     float(r.cpoe_sum), int(r.cpoe_n)))
    with Tx(conn):
        conn.execute("DELETE FROM nfl_pbp_qb WHERE season = ?", (season,))
        conn.executemany(
            "INSERT INTO nfl_pbp_qb (game_id, season, game_date, team, qb, qb_epa, qb_n, "
            "cpoe_sum, cpoe_n) VALUES (?,?,?,?,?,?,?,?,?)", recs)
        _put_meta(conn, key, digest, at)
    return len(recs)


def _fetch(pace, fetch, url):
    return pace(fetch, url)


def refresh_schedule(conn, pace, fetch, log=print) -> dict:
    """One schedule download. Failure leaves the stored schedule in place."""
    if not robots_allowed(conn, SCHED_URL, pace, fetch):
        raise RuntimeError("robots.txt disallows the nflverse schedule")
    body = _fetch(pace, fetch, SCHED_URL)
    n = replace_schedule(conn, body)
    log(f"nfl schedule {n} games")
    return {"schedule_games": n}


def refresh_season(conn, pace, fetch, season, log=print, required=True) -> dict:
    """One season file. A 404 on the current season is a skip; on an older
    season it is an error. Any other failure leaves that season's rows."""
    url = PBP_URL.format(season=int(season))
    if not robots_allowed(conn, url, pace, fetch):
        raise RuntimeError("robots.txt disallows nflverse play-by-play")
    try:
        body = _fetch(pace, fetch, url)
    except Missing:
        if required:
            raise
        log(f"nfl pbp {season} not published")
        return {"skipped_season": int(season)}
    n = replace_season(conn, season, body)
    log(f"nfl pbp {season} {n} quarterback rows")
    return {"pbp_rows": n, "season": int(season)}


def _data_token(conn):
    """Completed-game scores plus quarterback-line totals. Changes when a
    new final lands or a play-by-play file is rewritten."""
    try:
        sched = conn.execute(
            "SELECT COUNT(*), COALESCE(MAX(game_date), ''), "
            "ROUND(COALESCE(SUM(home_score), 0), 2), ROUND(COALESCE(SUM(away_score), 0), 2) "
            "FROM nfl_schedule WHERE home_score IS NOT NULL AND away_score IS NOT NULL"
        ).fetchone()
        pbp = conn.execute(
            "SELECT COUNT(*), ROUND(COALESCE(SUM(qb_epa), 0), 3), COALESCE(SUM(qb_n), 0) "
            "FROM nfl_pbp_qb").fetchone()
    except sqlite3.OperationalError:
        return None
    return (tuple(sched), tuple(pbp))


def maybe_refit(conn, before, st, today=None, log=print) -> dict:
    """Refit the quarterback ridge when this pass loaded new completed games.

    A pass that recorded an error does not refit. An unchanged file does not
    refit. The refit itself logs n, C and the coefficients."""
    if st.get("errors"):
        return st
    after = _data_token(conn)
    if before is None or after is None or after == before or not after[0][0]:
        return st
    try:
        from ..nfl_player import after_games
        note = after_games(conn, today=today, log=log)
        st["refit"] = note
        log(note)
    except Exception as e:
        st["errors"] = int(st.get("errors") or 0) + 1
        st["fatal"] = (str(st.get("fatal") or "") + f" refit {type(e).__name__}: {e}")[:200]
        log(f"nfl ridge after pbp FAILED {type(e).__name__}: {e}")
    return st


def current_pass(conn, pace, log=print, fetch=None, today=None) -> dict:
    """Schedule, then the current season. Used by the morning cron.

    Off-season with no NFL games in the usual window still refreshes: the
    file is how a just-finished week gets into the next morning's fit.
    A failure is returned as errors and does not raise, so the runner
    records it and continues with any other job.
    """
    fetch = fetch or http_get
    today = today or datetime.now(espn.CENTRAL).date()
    season = season_of(today)
    if not _teams(conn, "nfl", today):
        log("nfl pbp off-season")
        return {"errors": 0, "skipped": "no NFL games in window", "season": season}
    before = _data_token(conn)
    st = {"errors": 0, "season": season}
    try:
        st.update(refresh_schedule(conn, pace, fetch, log=log))
    except Exception as e:
        st["errors"] += 1
        st["fatal"] = f"schedule {type(e).__name__}: {e}"[:200]
        log(f"nfl schedule FAILED {type(e).__name__}: {e}")
    try:
        got = refresh_season(conn, pace, fetch, season, log=log, required=False)
        st.update(got)
    except Exception as e:
        st["errors"] += 1
        st["fatal"] = (st.get("fatal", "") + f" pbp {type(e).__name__}: {e}")[:200]
        log(f"nfl pbp {season} FAILED {type(e).__name__}: {e}")
    return maybe_refit(conn, before, st, today=today, log=log)


def backfill(conn, pace, fetch, start, end, log=print) -> dict:
    """Seasons `start` through `end`, then the schedule. Each season commits
    on its own. A season that fails is counted and left as it was; later
    seasons still run."""
    fetch = fetch or http_get
    st = {"errors": 0, "seasons": 0, "rows": 0}
    try:
        got = refresh_schedule(conn, pace, fetch, log=log)
        st["schedule_games"] = got.get("schedule_games", 0)
    except Exception as e:
        st["errors"] += 1
        log(f"nfl schedule FAILED {type(e).__name__}: {e}")
    for season in range(int(start), int(end) + 1):
        try:
            got = refresh_season(conn, pace, fetch, season, log=log, required=True)
        except Exception as e:
            st["errors"] += 1
            log(f"nfl pbp {season} FAILED {type(e).__name__}: {e}")
            continue
        st["seasons"] += 1
        st["rows"] += int(got.get("pbp_rows") or 0)
    return st


def _main(argv=None):
    from .. import db
    from ..backfill import Pacer
    ap = argparse.ArgumentParser(description="Load nflverse play-by-play quarterback lines")
    ap.add_argument("--db", default="data/bayesratings.db")
    ap.add_argument("--from-season", type=int, default=TRAIN_FROM_SEASON)
    ap.add_argument("--to-season", type=int, default=None)
    ap.add_argument("--rate", type=float, default=2.0, help="min seconds between requests")
    args = ap.parse_args(argv)
    end = args.to_season
    if end is None:
        end = season_of(datetime.now(espn.CENTRAL).date())
    conn = db.connect(args.db)
    conn.isolation_level = None
    db.init_db(conn)
    st = backfill(conn, Pacer(args.rate), http_get, args.from_season, end)
    print(st)
    return 1 if st.get("errors") else 0


if __name__ == "__main__":
    raise SystemExit(_main())
