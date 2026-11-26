"""Freeze our own forecast just before a game starts.

A later pass does not rewrite a locked game. The row stores our win chance,
margin and total only.
"""

from datetime import datetime, timedelta, timezone

from .db import immediate, playable_sql

# The live refresh runs every 10 minutes, so the freeze window matches that.
LOCK_BEFORE = timedelta(minutes=10)
LOCK_LATE = timedelta(hours=1)


def _utc(s):
    if not s:
        return None
    dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _current_forecast(conn, eid, game_date):
    """Game-day forecast for that date, else the latest early forecast."""
    r = conn.execute(
        "SELECT home_prob, home_spread, total_pred FROM forecast_snapshots "
        "WHERE espn_event_id=? AND snapshot_date=? AND backfilled=0",
        (eid, game_date)).fetchone()
    if r is None:
        r = conn.execute(
            "SELECT home_prob, home_spread, total_pred FROM upcoming_forecasts "
            "WHERE espn_event_id=?", (eid,)).fetchone()
    return None if r is None or r[0] is None else tuple(r)


def lock_due(conn, now=None, log_fn=print) -> int:
    """Lock every playable game starting within LOCK_BEFORE, or started within
    LOCK_LATE without a lock. INSERT OR IGNORE: a locked row never changes.
    Returns the number of games locked."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    n = 0
    lo = (now - timedelta(days=1)).date().isoformat()
    hi = (now + timedelta(days=1)).date().isoformat()
    rows = conn.execute(
        "SELECT g.espn_event_id, g.league, g.start_time_utc, g.game_date "
        "FROM games g LEFT JOIN forecast_locks m USING (espn_event_id) "
        "WHERE m.espn_event_id IS NULL AND g.completed=0 "
        f"AND g.season_type IN (2, 3) AND {playable_sql('g')} "
        "AND g.game_date BETWEEN ? AND ?",
        (lo, hi)).fetchall()
    for row in rows:
        r = dict(row)
        st = _utc(r["start_time_utc"])
        if st is None or not (now - LOCK_LATE <= st <= now + LOCK_BEFORE):
            continue
        try:
            cf = _current_forecast(conn, r["espn_event_id"], r["game_date"])
        except Exception as ex:
            log_fn(f"WARN forecast lock {r['espn_event_id']}: {type(ex).__name__}: {ex}")
            continue
        if cf is None:
            continue
        home_prob, home_spread, total_pred = cf
        with immediate(conn):
            cur = conn.execute(
                "INSERT OR IGNORE INTO forecast_locks "
                "(espn_event_id, league, locked_at, home_prob, home_spread, total_pred) "
                "VALUES (?,?,?,?,?,?)",
                (r["espn_event_id"], r["league"], now.isoformat(timespec="seconds"),
                 home_prob, home_spread, total_pred))
        n += cur.rowcount
    return n
