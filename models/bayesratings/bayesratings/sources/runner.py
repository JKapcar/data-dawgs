"""What runs when (cron lines in scripts/cron.example, all through
scripts/run_prelog.sh -> python -m bayesratings.prelog KIND):

  sources   07:10 CT   MLB roster/IL + venues, MLB transactions, nflverse
                       injury report + weekly rosters
  goalies   04:15, 09:10, 12:10, 15:10, 17:40 CT on NHL game days (Daily Faceoff)
  nhl-lines 16:10 CT   Daily Faceoff line combinations, every team
  nhl-slate 03:50 CT, and every 30 min 08:00-22:59 CT on NHL game days.
            Daily Faceoff lines + starting goalies for the player model.
            The pass itself skips a feed fetched in the last 45 minutes.
  mlb-probables every 30 min 08:00-22:59 CT on MLB game days. ESPN scoreboard
            probables, then the unlocked MLB forecast when a pitcher changed.
            No game is a no-op. A locked forecast is not rewritten.
  nbainj    every 15 min 08:00-22:59 CT on NBA game days (official PDF), plus
            NBA probable starting lineups (NBA.com, else ESPN depth chart)
  nflverse  19:10 CT   second daily nflverse pull
  nfl-pbp   04:00 CT   nflverse play-by-play for the current season. When the
                       file adds completed games, the pass refits the
                       quarterback ridge, rebuilds quarterback state, and
                       refreshes unlocked NFL forecasts. The 04:30 job refits
                       on Tuesday, or when no fit is stored, not on Monday.
                       One-time history is `python -m bayesratings.sources.nfl_pbp`
                       and does not refit.
  mlb-extra 07:05 CT   MLB Stats API box scores and Savant batted balls for
                       finished games in the last 3 days that are not stored
                       yet. No such game is a no-op. History is loaded from a
                       shipped file (scripts/load_mlb_extra.py). The Tuesday
                       MLB stack reads the stored rows. This pass does not
                       itself change a published forecast.
  nhl-pbp   07:20 CT   NHL API play-by-play for finished games in the last
                       3 days that are not stored yet. No such game is a
                       no-op. History is loaded from a shipped file
                       (scripts/load_nhl_shots.py). Not read by the forecast.
  inj-hist  07:25 CT   NBA official injury-report PDFs for game days in the
                       last 3 days that have no report yet, and the current
                       nflverse injury file while the NFL has a game nearby.
                       Nothing due is a no-op. History is loaded from a
                       shipped file (scripts/load_injuries.py). Read by the
                       NBA and NFL player-model training only.
  pregame   every 10 min (with the ESPN pre-game pass): MLB lineups +
            probables poll, DFO goalies before puck drop, NFL inactives at
            ~T-60 / T-20, NBA starters at tip
  The player-level adjustment (player_adj.refresh) runs last in pregame
  (all leagues) and nbainj (NBA): today's not-yet-started forecasts and the
  early forecasts of later games are re-adjusted when injury reports, lines,
  depth charts or lineups changed (never a locked or started game).
  check     07:30 CT   end-to-end pipeline check -> status file

Each job is isolated: an exception is logged loudly, recorded in
prelog_runs (kind = job name) and makes the run exit non-zero, but never
touches the other jobs or the daily forecast run."""

import traceback
from datetime import datetime, timezone

from ..prelog import _now, changed, record_run
from . import (dfo, espn_extra, injhist, mlb, mlb_box, mlb_statcast, nbainj, nbalineups,
               nfl_pbp, nhl_pbp, nflverse)
from .. import player_adj


def _players(conn, leagues, now, log) -> dict:
    """Re-apply the player-level adjustment to unstarted, unlocked forecasts
    (today's game-day forecasts and the early forecasts of later games)."""
    errs = []
    res = player_adj.refresh(conn, leagues, now, log, errors=errs)
    if not errs and not any(res.values()):
        return {"errors": 0, "skipped": "no player input changes"}
    return {"errors": len(errs), **{f"{lg}_changed": n for lg, n in res.items()},
            **({"fatal": "failed: " + ", ".join(errs)} if errs else {})}


# job -> (league, fn(conn, pace, now, log))
JOBS = {
    "mlb_roster": ("mlb", lambda c, p, now, log: mlb.roster_pass(c, p, log=log)),
    "mlb_tx": ("mlb", lambda c, p, now, log: mlb.tx_pass(c, p, log=log)),
    "mlb_lineups": ("mlb", lambda c, p, now, log: mlb.lineups_pass(c, p, now, log=log)),
    "mlb_probables": ("mlb", lambda c, p, now, log: mlb.probables_pass(c, p, now, log=log)),
    "dfo_goalies": ("nhl", lambda c, p, now, log: dfo.goalies_pass(c, p, now, log=log)),
    "dfo_goalies_pre": ("nhl", lambda c, p, now, log: dfo.pregame_goalies(c, p, now, log=log)),
    "dfo_lines": ("nhl", lambda c, p, now, log: dfo.lines_pass(c, p, log=log)),
    "dfo_slate": ("nhl", lambda c, p, now, log: dfo.slate_pass(c, p, now, log=log)),
    "nba_injury": ("nba", lambda c, p, now, log: nbainj.report_pass(c, p, now, log=log)),
    "nflverse": ("nfl", lambda c, p, now, log: nflverse.daily_pass(c, p, log=log)),
    "nfl_pbp": ("nfl", lambda c, p, now, log: nfl_pbp.current_pass(c, p, log=log)),
    "mlb_box": ("mlb", lambda c, p, now, log: mlb_box.current_pass(c, p, now, log=log)),
    "mlb_statcast": ("mlb", lambda c, p, now, log: mlb_statcast.current_pass(c, p, now, log=log)),
    "nhl_pbp": ("nhl", lambda c, p, now, log: nhl_pbp.current_pass(c, p, now, log=log)),
    "inj_hist": ("all", lambda c, p, now, log: injhist.current_pass(c, p, now, log=log)),
    "nfl_inactives": ("nfl", lambda c, p, now, log: espn_extra.inactives_pass(c, p, now, log=log)),
    "nba_starters": ("nba", lambda c, p, now, log: espn_extra.starters_pass(c, p, now, log=log)),
    "nba_lineups": ("nba", lambda c, p, now, log: nbalineups.lineups_pass(c, p, now, log=log)),
    "players": ("all", lambda c, p, now, log: _players(c, player_adj.LEAGUES, now, log)),
    "players_nba": ("nba", lambda c, p, now, log: _players(c, ("nba",), now, log)),
    "players_nhl": ("nhl", lambda c, p, now, log: _players(c, ("nhl",), now, log)),
}
KINDS = {
    "sources": ("mlb_roster", "mlb_tx", "nflverse"),
    "goalies": ("dfo_goalies",),
    "nhl-lines": ("dfo_lines",),
    "nhl-slate": ("dfo_slate", "players_nhl"),
    "mlb-probables": ("mlb_probables",),
    "nbainj": ("nba_injury", "nba_lineups", "players_nba"),
    "nflverse": ("nflverse",),
    "nfl-pbp": ("nfl_pbp",),
    "mlb-extra": ("mlb_box", "mlb_statcast"),
    "nhl-pbp": ("nhl_pbp",),
    "inj-hist": ("inj_hist",),
    "pregame": ("mlb_lineups", "dfo_goalies_pre", "nfl_inactives", "nba_starters",
                "players"),
}
# frequent kinds don't record a prelog_runs row when a job had nothing to do
QUIET_SKIPS = {"pregame", "nbainj", "nhl-slate", "mlb-probables"}


def run_jobs(conn, kind, pace, now=None, log=print, jobs=None) -> tuple:
    """Run every job of `kind`; returns (ok, summary parts)."""
    parts, failed = [], False
    for name in jobs or KINDS[kind]:
        league, fn = JOBS[name]
        started, n0 = _now(), pace.n
        try:
            st = fn(conn, pace, now or datetime.now(timezone.utc), log) or {}
        except Exception as e:
            st = {"errors": 1, "fatal": f"{type(e).__name__}: {e}"}
            log(f"{name} FAILED\n{traceback.format_exc()}")
        req = pace.n - n0
        if st.get("skipped") and not req:
            if kind not in QUIET_SKIPS:
                record_run(conn, name, league, started, 0, st, 0, f"skipped: {st['skipped']}")
                parts.append(f"{name} skip")
            continue
        errs = st.get("errors", 0)
        failed |= bool(errs)
        record_run(conn, name, league, started, req, st, errs, st.get("fatal"))
        um = st.get("unmatched", 0)
        parts.append(f"{name} +{changed(st)}" + (f" {um}unm" if um else "")
                     + (f" {errs}err" if errs else "") + f" {req}req")
        log(f"{name}: {st}")
    return not failed, parts
