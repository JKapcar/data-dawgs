"""Shared run clock, league list, and status line."""

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

CHICAGO = ZoneInfo("America/Chicago")
IN_SEASON_DAYS = 4          # NFL's longest normal gap is Mon -> Thu
LEAGUES = ("mlb", "nba", "nfl", "nhl")
# Leagues whose ratings refit once a week, on Tuesday. Empty: every league
# refits every morning it is in season.
WEEKLY_REFIT = set()


def fit_cutoff(league: str, today: date) -> date:
    """Games before this date go into today's fit."""
    if league in WEEKLY_REFIT:
        return today - timedelta(days=(today.weekday() - 1) % 7)
    return today


# how far ahead the schedule is fetched and forecast (days after today)
AHEAD_DAYS = {"nfl": 14}
DEFAULT_AHEAD = 7


def ahead_days(league: str) -> int:
    return AHEAD_DAYS.get(league, DEFAULT_AHEAD)


def log(msg: str) -> None:
    print(f"[{datetime.now(CHICAGO):%Y-%m-%d %H:%M:%S} CT] {msg}", flush=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def in_season(conn, league: str, today: date) -> bool:
    lo = (today - timedelta(days=IN_SEASON_DAYS)).isoformat()
    hi = (today + timedelta(days=IN_SEASON_DAYS)).isoformat()
    row = conn.execute(
        "SELECT COUNT(*) FROM games WHERE league = ? AND season_type IN (2, 3) "
        "AND game_date BETWEEN ? AND ?", (league, lo, hi)).fetchone()
    return row[0] > 0


def write_status(path, line: str) -> None:
    if not path:
        return
    p = Path(path)
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a") as fh:
            fh.write(line + "\n")
    except OSError as e:
        log(f"could not write status file {p}: {e}")
