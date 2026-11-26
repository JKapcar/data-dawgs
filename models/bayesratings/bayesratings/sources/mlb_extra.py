"""MLB box scores and Statcast batted balls, stored and not published.

The nightly job is prelog mlb-extra (07:05 CT): finished games and dates
from the last 3 days that are not stored yet. No finished game is a no-op.
History is loaded from a shipped file.

    python scripts/backfill_mlb_extra.py --out mlb_extra_2016.db --from-season 2016 --to-season 2016
    python scripts/load_mlb_extra.py --db data/bayesratings.db --from mlb_extra_2016.db

Box scores start in 2006. Statcast batted balls start in 2015. A season
before 2015 has boxes only. Nothing here is read by the forecast, the MLB
model, or any page.
"""

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .. import db, espn
from ..prelog import Tx
from . import mlb_box, mlb_statcast
from .mlb_box import GAME_COLS as BOX_GAME_COLS, PLAYER_COLS as BOX_PLAYER_COLS
from .mlb_statcast import (
    BALL_COLS, DATE_COLS, GAME_COLS as SC_GAME_COLS, PLAYER_COLS as SC_PLAYER_COLS,
)

TABLES = (
    ("mlb_box_games", BOX_GAME_COLS),
    ("mlb_box_players", BOX_PLAYER_COLS),
    ("mlb_statcast_games", SC_GAME_COLS),
    ("mlb_batted_balls", BALL_COLS),
    ("mlb_batted_players", SC_PLAYER_COLS),
    ("mlb_statcast_dates", DATE_COLS),
)


def backfill(conn, pace, season_from, season_to, fetch=None, log=print) -> dict:
    """Boxes, then batted balls, into this connection. Stored games and dates are skipped."""
    box = mlb_box.backfill(conn, pace, season_from, season_to, fetch=fetch, log=log)
    sc = mlb_statcast.backfill(conn, pace, season_from, season_to, fetch=fetch, log=log)
    return {"box": box, "statcast": sc,
            "errors": box.get("errors", 0) + sc.get("errors", 0)}


def load_into(conn, src_path) -> dict:
    """ATTACH a shipped file and copy it into conn.

    The same keys are replaced. ESPN event ids and athlete ids are filled
    from the games and players already in conn. Running it again replaces
    those keys and links them again.
    """
    path = Path(src_path).resolve()
    if not path.is_file():
        raise FileNotFoundError(str(path))
    if "'" in str(path):
        raise ValueError("the shipped file path cannot contain a quote")
    db.init_db(conn)
    conn.commit()
    conn.execute(f"ATTACH DATABASE '{path}' AS mlb_src")
    try:
        counts = {}
        with Tx(conn):
            for table, cols in TABLES:
                exists = conn.execute(
                    "SELECT 1 FROM mlb_src.sqlite_master WHERE type = 'table' AND name = ?",
                    (table,)).fetchone()
                if not exists:
                    continue
                conn.execute(f"INSERT OR REPLACE INTO {table} ({', '.join(cols)}) "
                             f"SELECT {', '.join(cols)} FROM mlb_src.{table}")
                counts[table] = conn.execute("SELECT changes()").fetchone()[0]
            if conn.execute("SELECT 1 FROM mlb_src.sqlite_master WHERE name = 'src_meta'").fetchone():
                conn.execute(
                    "INSERT OR REPLACE INTO src_meta (key, value, updated_at) "
                    "SELECT key, value, updated_at FROM mlb_src.src_meta "
                    "WHERE key LIKE 'mlb_box:%' OR key LIKE 'mlb_statcast:%'")
        counts["games_linked"] = mlb_box.link_box_games(conn) + mlb_statcast.link_statcast_games(conn)
        counts["players_linked"] = (mlb_box.link_box_players(conn)
                                     + mlb_statcast.link_batted_players(conn))
        return counts
    finally:
        conn.execute("DETACH DATABASE mlb_src")


def extra_freshness(conn, now):
    """(level, message) for yesterday's finished MLB games, or None when
    there were none. None means the check adds no line."""
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'games'").fetchone() is None:
        return None
    yesterday = (now.astimezone(espn.CENTRAL).date() - timedelta(days=1)).isoformat()
    rows = conn.execute(
        "SELECT espn_event_id FROM games g WHERE league = 'mlb' AND completed = 1 "
        "AND season_type IN (2, 3) "
        f"AND {db.playable_sql('g')} AND game_date = ?", (yesterday,)).fetchall()
    if not rows:
        return None
    have_box = _table(conn, "mlb_box_games")
    have_dates = _table(conn, "mlb_statcast_dates")
    n = len(rows)
    if not have_box or not have_dates:
        return ("FAIL", f"0/{n} finished MLB games have a box and batted balls")
    ids = [r[0] for r in rows]
    got = conn.execute(
        f"SELECT COUNT(*) FROM mlb_box_games WHERE espn_event_id IN ({','.join('?' * n)})",
        ids).fetchone()[0]
    dated = conn.execute("SELECT 1 FROM mlb_statcast_dates WHERE game_date = ?",
                         (yesterday,)).fetchone()
    if got == n and dated:
        return ("OK", f"{got} finished MLB games stored")
    tail = "" if dated else "; batted balls not stored"
    return ("FAIL", f"{got}/{n} finished MLB games have a box{tail}")


def _table(conn, name):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                        (name,)).fetchone() is not None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="MLB box scores and Statcast batted balls")
    ap.add_argument("--db", required=True)
    ap.add_argument("--backfill", action="store_true")
    ap.add_argument("--from-season", type=int)
    ap.add_argument("--to-season", type=int)
    ap.add_argument("--rate", type=float, default=1.0,
                    help="seconds between requests (default 1)")
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
        st = backfill(conn, Pacer(a.rate), a.from_season, a.to_season)
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        if not conn.execute("SELECT COUNT(*) FROM games").fetchone()[0]:
            conn.execute("PRAGMA journal_mode = DELETE")
        print(json.dumps(st, default=str))
        return 1 if st.get("errors") else 0
    now = datetime.now(timezone.utc)
    pace = Pacer(a.rate)
    box = mlb_box.current_pass(conn, pace, now)
    sc = mlb_statcast.current_pass(conn, pace, now)
    st = {"box": box, "statcast": sc,
          "errors": box.get("errors", 0) + sc.get("errors", 0)}
    print(json.dumps(st, default=str))
    return 1 if st.get("errors") else 0


if __name__ == "__main__":
    raise SystemExit(main())
