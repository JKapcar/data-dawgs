"""Hourly light schedule refresh: keep today's and upcoming slates honest
between the 04:30 CT daily runs.

    python -m bayesratings.refresh --db data/bayesratings.db

For every in-season league it refetches ESPN scoreboards from yesterday
through the daily job's forecast window (one request per date, at least
--rate seconds apart, so each scoreboard is hit once an hour), upserts the
games (status, start time, notes and series fields), and reconciles:

  - an unplayed game ESPN no longer lists -> STATUS_REMOVED (row kept)
  - an "if necessary" game whose series is decided -> STATUS_REMOVED
  - removed/postponed/canceled games lose their display forecasts
    (upcoming_forecasts, and forecast_snapshots from today on)

It never fits the model or fetches box-score summaries; the daily job does.
`--live` also freezes forecasts that are about to start.

    python -m bayesratings.refresh --db data/bayesratings.db --live

--live (cron every 10 minutes) only refetches the ESPN scoreboard dates of
games that have started but aren't final yet, so a finished game is marked
final within minutes instead of at the next hourly run. No reconcile, no
pre-game logging; zero requests when nothing is in progress.
"""

import argparse
import sys
import traceback
from datetime import datetime, timedelta, timezone

from . import backfill, db, espn, prelog
from .lock import lock_due
from .runtime import CHICAGO, LEAGUES, ahead_days, in_season, log, write_status


def refresh_league(conn, league, today, pace) -> dict:
    st = {"dates": 0, "games": 0, "removed": 0, "errors": 0}
    plog, started = {}, prelog._now()
    # ESPN's ?dates= buckets are Eastern: the extra day covers a late-CT start
    for i in range(-1, ahead_days(league) + 2):
        d = today + timedelta(days=i)
        try:
            data = pace(espn.fetch_scoreboard, league, dates=f"{d:%Y%m%d}")
            parsed = espn.parse_scoreboard(data, league)
            parsed["games"] = [g for g in parsed["games"]
                               if g["season_type"] in backfill.KEEP_SEASON_TYPES]
            st["games"] += db.ingest_scoreboard(conn, league, parsed)
            st["removed"] += len(backfill.reconcile_date(conn, league, d, data, today))
            # probables, odds and weather from the same payload (no extra request)
            prelog._add(plog, prelog.log_scoreboard(conn, league, data, log=log))
            st["dates"] += 1
        except Exception as e:      # one bad date never blocks the rest
            st["errors"] += 1
            log(f"{league} {d} ERROR {type(e).__name__}: {e}")
    st["removed"] += len(db.mark_clinched(conn, league, today.isoformat()))
    prelog.record_scoreboard_run(conn, league, started, plog, log=log)
    st["prelog"] = prelog.changed(plog)
    return st


LIVE_LOOKBACK = timedelta(hours=36)   # a started game older than this is left to the hourly run
NOT_LIVE = ("STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_REMOVED", "STATUS_FINAL")


def started_unfinished(conn, now):
    """{(league, Eastern scoreboard date)} for games that have started but
    aren't marked final (start within LIVE_LOOKBACK)."""
    out = set()
    q = ",".join("?" * len(NOT_LIVE))
    for lg, st in conn.execute(
            "SELECT league, start_time_utc FROM games WHERE completed=0 "
            f"AND start_time_utc IS NOT NULL AND COALESCE(status, '') NOT IN ({q})", NOT_LIVE):
        try:
            t = datetime.fromisoformat(st.replace("Z", "+00:00"))
        except ValueError:
            continue
        if now - LIVE_LOOKBACK <= t <= now:
            out.add((lg, espn.eastern_date(st)))
    return out


def refresh_live(conn, leagues, now, pace) -> dict:
    """Refetch only the scoreboards holding in-progress games. Returns
    {league: {"dates", "games", "errors"}}."""
    res = {}
    for lg, d in sorted(started_unfinished(conn, now)):
        if lg not in leagues:
            continue
        st = res.setdefault(lg, {"dates": 0, "games": 0, "errors": 0})
        try:
            data = pace(espn.fetch_scoreboard, lg, dates=d.replace("-", ""))
            parsed = espn.parse_scoreboard(data, lg)
            parsed["games"] = [g for g in parsed["games"]
                               if g["season_type"] in backfill.KEEP_SEASON_TYPES]
            st["games"] += db.ingest_scoreboard(conn, lg, parsed)
            st["dates"] += 1
        except Exception as e:      # one bad date never blocks the rest
            st["errors"] += 1
            log(f"live {lg} {d} ERROR {type(e).__name__}: {e}")
    return res


def main_live(conn, leagues, args) -> int:
    pace = backfill.Pacer(args.rate)
    res = refresh_live(conn, leagues, datetime.now(timezone.utc), pace)
    failed = any(v["errors"] for v in res.values())
    parts = [f"{lg} {v['dates']}d {v['games']}g" + (f" {v['errors']}err" if v["errors"] else "")
             for lg, v in res.items()]
    try:
        n_lock = lock_due(conn, log_fn=log)
        if n_lock:
            parts.append(f"lock {n_lock}")
    except Exception as e:
        log(f"WARN forecast lock: {type(e).__name__}: {e}")
    line = (f"{datetime.now(CHICAGO):%Y-%m-%d %H:%M} CT {'FAIL' if failed else 'OK'} live "
            f"{' | '.join(parts) or 'nothing in progress'} | {pace.n} req")
    if args.status_file:
        write_status(args.status_file, line)
    log(line)
    return 1 if failed else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", default="data/bayesratings.db")
    ap.add_argument("--leagues", default=",".join(LEAGUES))
    ap.add_argument("--rate", type=float, default=2.0,
                    help="minimum seconds between ESPN requests")
    ap.add_argument("--status-file", default=None)
    ap.add_argument("--live", action="store_true",
                    help="only refetch scoreboards of started, not-final games")
    args = ap.parse_args(argv)
    today = datetime.now(CHICAGO).date()
    conn = db.connect(args.db)
    # Schema and venue coordinates load in the daily job.
    if args.live:
        return main_live(conn, [x.strip().lower() for x in args.leagues.split(",") if x.strip()],
                         args)
    pace = backfill.Pacer(args.rate)
    parts, failed = [], False
    for lg in [x.strip().lower() for x in args.leagues.split(",") if x.strip()]:
        if not in_season(conn, lg, today):
            continue
        try:
            st = refresh_league(conn, lg, today, pace)
            failed |= bool(st["errors"])
            parts.append(f"{lg} {st['dates']}d {st['games']}g -{st['removed']} pre+{st['prelog']}"
                         + (f" {st['errors']}err" if st["errors"] else ""))
        except Exception as e:
            failed = True
            parts.append(f"{lg} ERROR {type(e).__name__}")
            log(traceback.format_exc())
    hidden = db.drop_hidden_forecasts(conn, today.isoformat())
    line = (f"{datetime.now(CHICAGO):%Y-%m-%d %H:%M} CT "
            f"{'FAIL' if failed else 'OK'} refresh {' | '.join(parts) or 'no leagues in season'}"
            f" | hidden {hidden} | {pace.n} req")
    if args.status_file:
        write_status(args.status_file, line)
    log(line)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
