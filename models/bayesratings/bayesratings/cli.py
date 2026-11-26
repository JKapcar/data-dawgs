"""Command line: init, backfill, extract, update, daily, check, show."""

import argparse
import sys

from .config import db_path, status_path
from .runtime import LEAGUES


def _db(args) -> str:
    return args.db or db_path()


def _leagues(args, default="nba") -> str:
    return args.leagues or default


def cmd_init(args) -> int:
    from . import db
    path = _db(args)
    conn = db.connect(path)
    db.init_db(conn)
    n = conn.execute("SELECT COUNT(*) FROM venue_coords").fetchone()[0]
    print(f"database {path} ready ({n} venue coordinates)")
    return 0


def cmd_backfill(args) -> int:
    from . import backfill
    argv = ["--db", _db(args), "--leagues", _leagues(args),
            "--seasons", str(args.seasons), "--rate", str(args.rate)]
    if args.dates:
        argv.extend(["--dates", args.dates])
    return backfill.main(argv) or 0


def cmd_extract(args) -> int:
    from . import players, team_counts
    leagues = _leagues(args, ",".join(LEAGUES))
    players.main(["--db", _db(args), "--leagues", leagues])
    team_counts.main(["--db", _db(args), "--leagues", leagues])
    return 0


def cmd_update(args) -> int:
    from . import db, prelog, refresh
    from .lock import lock_due
    path = _db(args)
    leagues = _leagues(args)
    status = status_path("prelog.log")
    rc = refresh.main(["--db", path, "--leagues", leagues,
                       "--status-file", status_path("refresh.log")])
    codes = [rc or 0]
    codes.append(prelog.main(["morning", "--db", path, "--leagues", leagues,
                              "--status-file", status]) or 0)
    wanted = {x.strip() for x in leagues.split(",") if x.strip()}
    extra = []
    if "nba" in wanted:
        extra.append("nbainj")
    if "nhl" in wanted:
        extra.append("nhl-slate")
    if "mlb" in wanted:
        extra.append("mlb-probables")
    if "nfl" in wanted:
        extra.append("nflverse")
    for kind in extra:
        codes.append(prelog.main([kind, "--db", path, "--leagues", leagues,
                                  "--status-file", status]) or 0)
    conn = db.connect(path)
    try:
        n = lock_due(conn)
    finally:
        conn.close()
    print(f"locked {n}")
    return 1 if any(codes) else 0


def cmd_daily(args) -> int:
    from . import daily
    argv = ["--db", _db(args), "--leagues", _leagues(args, ",".join(LEAGUES)),
            "--rate", str(args.rate),
            "--status-file", status_path("daily.log")]
    if args.skip_update:
        argv.append("--skip-update")
    if args.date:
        argv.extend(["--date", args.date])
    return daily.main(argv)


def cmd_check(args) -> int:
    from . import prelog
    return prelog.main(["check", "--db", _db(args),
                        "--status-file", status_path("prelog.log")])


def cmd_show(args) -> int:
    from . import db
    conn = db.connect(_db(args))
    leagues = [x.strip() for x in _leagues(args).split(",") if x.strip()]
    names = {r[0]: r[1] for r in conn.execute("SELECT team_id, abbreviation FROM teams")}
    for lg in leagues:
        snap = conn.execute(
            "SELECT MAX(snapshot_date) FROM rating_snapshots WHERE league=?",
            (lg,)).fetchone()[0]
        print(f"== {lg} ratings" + (f"  {snap}" if snap else "  (none yet)"))
        if snap:
            rows = conn.execute(
                "SELECT team_id, rating FROM rating_snapshots "
                "WHERE league=? AND snapshot_date=? ORDER BY rating DESC",
                (lg, snap)).fetchall()
            for tid, rating in rows:
                print(f"  {names.get(tid, tid):<6} {rating:+7.3f}")
        print(f"-- {lg} forecasts")
        seen = set()
        q = ("SELECT game_date, away_team_id, home_team_id, home_prob, "
             "home_spread, total_pred, espn_event_id FROM {table} "
             "WHERE league=? ORDER BY game_date, espn_event_id")
        rows = list(conn.execute(q.format(table="forecast_snapshots"), (lg,)))
        rows += list(conn.execute(q.format(table="upcoming_forecasts"), (lg,)))
        rows.sort(key=lambda r: (r[0] or "", r[6]))
        n = 0
        for day, away, home, prob, spread, total, eid in rows:
            if eid in seen:
                continue
            seen.add(eid)
            n += 1
            if n > 20:
                break
            print(f"  {str(day)[:10]}  {names.get(away, away)} @ {names.get(home, home)}"
                  f"  home {prob:.3f}  margin {-(spread or 0):+.1f}  total {total:.1f}")
        if not rows:
            print("  (none yet)")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="bayesratings")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("init", help="create the database and load venue coordinates")
    s.add_argument("--db", default=None)
    s.set_defaults(fn=cmd_init)

    s = sub.add_parser("backfill", help="pull scoreboards and box scores")
    s.add_argument("--db", default=None)
    s.add_argument("--leagues", default="nba")
    s.add_argument("--seasons", type=int, default=3)
    s.add_argument("--rate", type=float, default=1.0)
    s.add_argument("--dates", default=None, help="comma-separated YYYY-MM-DD, instead of full seasons")
    s.set_defaults(fn=cmd_backfill)

    s = sub.add_parser("extract", help="build player lines and team counts from stored boxes")
    s.add_argument("--db", default=None)
    s.add_argument("--leagues", default=None)
    s.set_defaults(fn=cmd_extract)

    s = sub.add_parser("update", help="refresh the schedule and run one update pass")
    s.add_argument("--db", default=None)
    s.add_argument("--leagues", default="nba")
    s.set_defaults(fn=cmd_update)

    s = sub.add_parser("daily", help="fit the models and save ratings and forecasts")
    s.add_argument("--db", default=None)
    s.add_argument("--leagues", default=None)
    s.add_argument("--date", default=None)
    s.add_argument("--rate", type=float, default=1.0)
    s.add_argument("--skip-update", action="store_true")
    s.set_defaults(fn=cmd_daily)

    s = sub.add_parser("check", help="check that each feed is fresh")
    s.add_argument("--db", default=None)
    s.set_defaults(fn=cmd_check)

    s = sub.add_parser("show", help="print team ratings and upcoming forecasts")
    s.add_argument("--db", default=None)
    s.add_argument("--leagues", default="nba")
    s.set_defaults(fn=cmd_show)

    args = p.parse_args(argv)
    return args.fn(args) or 0


if __name__ == "__main__":
    sys.exit(main())
