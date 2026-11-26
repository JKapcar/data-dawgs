"""Rebuild past ratings and forecasts day by day ("walk-forward replay").

For every game day in the last N seasons, fit the same model the daily job
uses on ONLY the games finished before that day, then forecast that day's
games. Results go into rating_snapshots / forecast_snapshots with
backfilled = 1, so a rebuilt row is distinct from a forecast that was
saved on that morning.

    python -m bayesratings.replay --db data/bayesratings.db --leagues nhl
    python -m bayesratings.replay --leagues mlb --seasons 5 --max-days 20

Replays use the team model only. The in-model starter covariate needs the
box-score logs and the probable known that morning, which this rebuild does
not join, so the covariate is zero and rebuilt rows carry no starter
columns. MLB's separate margin home edge is part of the team model and is on.
The NFL quarterback ridge is not applied, so those audit columns stay null.

Safe to stop and restart: days that already have rows (live or replayed) are
skipped. Never deletes or overwrites a live (backfilled = 0) row.
Runs one league per process; scripts/run_replay.sh starts all four at once.
"""

import argparse
import sys
import time
import warnings
from contextlib import contextmanager
from datetime import date, datetime, timedelta

import pandas as pd

from . import db
from .publish import save_snapshot
from .runtime import CHICAGO
from .hybrid import points_model_for
from .pipeline import forecast_from_fit, run_model
from .ratings import attach_b2b, get_bt_model
from .weights import league_fit_kwargs, use_b2b


def log(msg: str) -> None:
    print(f"[{datetime.now(CHICAGO):%Y-%m-%d %H:%M:%S} CT] {msg}", flush=True)


LOCK_PATH = db.LOCK_PATH   # shared writer lock, next to the database


@contextmanager
def db_lock(path):
    """Hold the shared writer lock while saving a day, so a replay never
    writes at the same moment as the morning job. Held only
    for the write, never during a fit."""
    if not path:
        yield
        return
    from .db import writer_lock
    with writer_lock(timeout=None, path=path):
        yield


def week_anchor(d: str) -> str:
    """The Tuesday on or before d. Weekly refits fit on games before it."""
    x = date.fromisoformat(d)
    return (x - timedelta(days=(x.weekday() - 1) % 7)).isoformat()


def day_schedule(conn, league: str, d: str, nx: str) -> pd.DataFrame:
    """All regular/postseason games on day d (any status), model contract
    plus espn_event_id, exhibition games left out."""
    return pd.read_sql_query(
        "SELECT espn_event_id, season, game_date AS date, "
        "CAST(home_team_id AS TEXT) AS home_team, "
        "CAST(away_team_id AS TEXT) AS away_team, "
        "NULL AS home_score, NULL AS away_score, neutral_site AS neutral FROM games "
        f"WHERE league = ? AND game_date = ? AND season_type IN (2, 3) AND {nx} "
        "ORDER BY start_time_utc, espn_event_id", conn, params=(league, d))


def replay_days(conn, league: str, seasons: int, until: str) -> list:
    """Game days to replay: every date with a game in the last `seasons`
    seasons, before `until`, oldest first."""
    last = conn.execute("SELECT MAX(season) FROM games WHERE league = ? AND "
                        "season_type IN (2, 3)", (league,)).fetchone()[0]
    if last is None:
        return []
    return [r[0] for r in conn.execute(
        "SELECT DISTINCT game_date FROM games WHERE league = ? AND season > ? "
        "AND season_type IN (2, 3) AND game_date < ? ORDER BY 1",
        (league, last - seasons, until))]


def done_days(conn, league: str) -> set:
    return {r[0] for r in conn.execute(
        "SELECT DISTINCT snapshot_date FROM rating_snapshots WHERE league = ?",
        (league,))}


def replay_league(conn, league: str, seasons: int, until: str, stan_model,
                  max_days: int = None, sample: int = None, refit: str = "daily",
                  since: str = None, lock_path: str = LOCK_PATH) -> dict:
    games = db.read_games(conn, league)
    games["date"] = games["date"].astype(str)
    done = games.dropna(subset=["home_score", "away_score"])
    nx = db.not_exhibition_sql(db.exhibition_team_ids(conn, league))
    have = done_days(conn, league)
    todo = [d for d in replay_days(conn, league, seasons, until) if d not in have
            and (since is None or d >= since)]
    if sample and len(todo) > sample:   # evenly spaced days, for timing runs
        step = len(todo) / sample
        todo = [todo[int(k * step)] for k in range(sample)]
    if max_days:
        todo = todo[:max_days]
    n_teams = len(set(games["home_team"]) | set(games["away_team"]))
    min_train = 10 * max(n_teams, 1) // 2   # ~10 games per team on record
    log(f"{league}: {len(todo)} day(s) to replay ({len(have)} already have rows)")
    stats_total = len(todo)
    stats = {"days": 0, "forecasts": 0, "skipped": 0, "errors": 0, "seconds": 0.0}
    t_all = time.monotonic()
    cache = {}                           # weekly: anchor Tuesday -> fit
    for i, d in enumerate(todo, 1):
        t0 = time.monotonic()
        cut = week_anchor(d) if refit == "weekly" else d
        train = done[done["date"] < cut]
        sched = day_schedule(conn, league, d, nx)
        if len(train) < min_train or not len(sched):
            stats["skipped"] += 1
            continue
        try:
            day = sched.drop(columns="espn_event_id")
            # Back-to-back from every earlier completed game, including games
            # after a weekly fit cutoff. The result is not used, only the date.
            if use_b2b(league):
                day = attach_b2b(day, history=done[done["date"] < d])
            if cut in cache:
                res = forecast_from_fit(cache[cut], day)
            else:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    res = run_model(train, schedule=day, stan_model=stan_model,
                                    points_model=points_model_for(league),
                                    evaluate=False, **league_fit_kwargs(league))
                if refit == "weekly":
                    cache.clear()
                    cache[cut] = res
            with db_lock(lock_path):
                # a live run may have written this day meanwhile: never touch it
                if conn.execute("SELECT 1 FROM rating_snapshots WHERE league=? AND "
                                "snapshot_date=? AND backfilled=0 LIMIT 1",
                                (league, d)).fetchone():
                    stats["skipped"] += 1
                    continue
                stats["forecasts"] += save_snapshot(conn, d, league, res, sched,
                                                    backfilled=1)
            stats["days"] += 1
        except Exception as e:  # one bad day must not stop a multi-hour run
            stats["errors"] += 1
            log(f"{league} {d}: {type(e).__name__}: {e}")
        if i % 25 == 0 or i == len(todo):
            el = time.monotonic() - t_all
            log(f"{league}: {i}/{len(todo)} days, {el / i:.1f}s/day, "
                f"~{el / i * (len(todo) - i) / 60:.0f} min left")
        stats["seconds"] += time.monotonic() - t0
    stats["planned"] = stats_total
    return stats


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", default="data/bayesratings.db")
    ap.add_argument("--leagues", default="nfl,nba,mlb,nhl")
    ap.add_argument("--seasons", type=int, default=5)
    ap.add_argument("--until", default=None,
                    help="replay days before this date (default: today, CT)")
    ap.add_argument("--max-days", type=int, default=None,
                    help="stop after this many days per league (for testing)")
    ap.add_argument("--sample", type=int, default=None,
                    help="only replay this many evenly spaced days (timing runs)")
    ap.add_argument("--refit", choices=("daily", "weekly"), default="daily",
                    help="weekly: fit once per week (games before Tuesday), "
                         "forecast each day from that fit")
    ap.add_argument("--since", default=None,
                    help="only replay days on or after this date")
    ap.add_argument("--lock", default=LOCK_PATH,
                    help="lock file shared with the daily job ('' = none)")
    args = ap.parse_args(argv)
    until = args.until or datetime.now(CHICAGO).date().isoformat()
    date.fromisoformat(until)
    conn = db.connect(args.db)
    db.init_db(conn)
    stan_model = get_bt_model()
    failed = False
    for lg in [x.strip().lower() for x in args.leagues.split(",") if x.strip()]:
        st = replay_league(conn, lg, args.seasons, until, stan_model,
                           args.max_days, args.sample, args.refit,
                           args.since, args.lock)
        log(f"{lg} done: {st}")
        failed |= bool(st["errors"])
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
