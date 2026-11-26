"""Daily job: refresh ESPN data, rate every in-season league, save snapshots.

    python -m bayesratings.daily --db data/bayesratings.db

1. Incremental ESPN update (yesterday's finals + summaries, and the schedule
   from today through ahead_days ahead) through the resumable backfill.
2. For each league with games within +/- IN_SEASON_DAYS of today, run_model on
   read_games(league). MLB and NHL pass a pre-game starter covariate into
   that fit. Then the player-level adjustment, then the win-chance stack with
   the dynamic Bayesian Elo (an Elo failure publishes the logit alone). The
   model margin then follows the stacked win chance. NBA, NHL, NFL and MLB
   player models replace the published win chance when they can run.
3. Replace today's rows in rating_snapshots / forecast_snapshots; replace the
   league's rows in upcoming_forecasts; log daily_runs. Then each player's
   value from the player and starter adjustments into player_values.
4. Append one status line under the status directory from config.
"""

import argparse
import sqlite3
import sys
import time
import traceback
import warnings
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from . import (backfill, bayes_elo, db, mlb_player, nba_player, nfl_player,
               nhl_player, player_adj, starters)
from .config import db_path, status_path
from .forecast import carry_margin
from .hybrid import points_model_for
from .pipeline import run_model
from .publish import save_snapshot
from .ratings import attach_b2b, get_bt_model
from .runtime import (CHICAGO, LEAGUES, _now, ahead_days, fit_cutoff, in_season,
                      log, write_status)
from .weights import league_fit_kwargs

# Re-exported so callers can keep using bayesratings.daily.<name>.
from .publish import (  # noqa: F401
    AUDIT_COLS, BASE_FORECAST_COLS, FORECAST_COLS, RATING_COLS, UPCOMING_COLS,
    _audit_values, rating_uncertainty,
)
from .runtime import AHEAD_DAYS, DEFAULT_AHEAD, IN_SEASON_DAYS, WEEKLY_REFIT  # noqa: F401

def update_espn(conn, leagues, today: date, rate: float) -> dict:
    """Scoreboards from yesterday through ahead_days(league) after today (and
    summaries for any finals) through the resumable backfill. Recent and
    future dates are always refetched, so a late final, a rerun later in the
    day, or a schedule change picks up new data."""
    tot = {"dates": 0, "games": 0, "summaries": 0, "errors": 0}
    for lg in leagues:
        # ESPN buckets by Eastern date: one extra day covers a late-Central
        # start on the last day of the window
        dates = [today + timedelta(days=i) for i in range(-1, ahead_days(lg) + 2)]
        st = backfill.run(conn, [lg], 0, rate=rate, today=today, only_dates=dates)
        for k in tot:
            tot[k] += st.get(k, 0)
    return tot


def todays_schedule(conn, league: str, today: date, through: date = None) -> pd.DataFrame:
    """Unplayed games from today through `through` (default: today only) in
    the model contract, plus espn_event_id kept alongside (same row order) so
    forecasts join back per game, doubleheaders included."""
    through = through or today
    return pd.read_sql_query(
        "SELECT espn_event_id, season, game_date AS date, "
        "CAST(home_team_id AS TEXT) AS home_team, "
        "CAST(away_team_id AS TEXT) AS away_team, "
        "NULL AS home_score, NULL AS away_score, neutral_site AS neutral FROM games "
        "WHERE league = ? AND game_date BETWEEN ? AND ? AND completed = 0 "
        f"AND season_type IN (2, 3) AND {db.playable_sql()} "
        "ORDER BY start_time_utc, espn_event_id",
        conn, params=(league, today.isoformat(), through.isoformat()))


def rate_league(conn, league: str, today: date, stan_model, as_of: str = None,
                dry_run: bool = False, elo_model=None) -> dict:
    """Fit, forecast and (unless dry_run) save one league. as_of: ISO UTC
    time whose known starters are used (default now). The published win
    chance is the logit (with starters) stacked with the dynamic Bayesian Elo
    (bayes_elo.py); an Elo failure publishes the logit alone."""
    t0 = time.monotonic()
    fit_kw = league_fit_kwargs(league)
    games = db.read_games(conn, league, event_id=fit_kw["starter"])
    sched = todays_schedule(conn, league, today,
                            today + timedelta(days=ahead_days(league)))
    # the model is given every completed game; today's and upcoming games come
    # in as the explicit schedule so each forecast keeps its espn_event_id
    done = games.dropna(subset=["home_score", "away_score"])
    cutoff = fit_cutoff(league, today)
    if cutoff != today:
        done = done[pd.to_datetime(done["date"]) < pd.Timestamp(cutoff)]
    notes = []
    if fit_kw["starter"]:
        # in-model covariate from earlier starts; a failure fits with zeros
        try:
            done, sched = starters.prepare_model_edges(
                conn, league, done, sched, as_of or _now())
        except Exception as e:
            notes.append(f"starter edges skipped ({type(e).__name__}: {e})")
            log(traceback.format_exc())
    model_done = done.drop(columns=["espn_event_id"], errors="ignore")
    model_sched = sched.drop(columns=["espn_event_id"], errors="ignore")
    if fit_kw["b2b"] and len(model_sched):
        # Pre-set, so the audit's no-starter probability uses the same flags
        # the published chance did. run_model keeps columns that are already there.
        model_sched = attach_b2b(model_sched, history=model_done)
        if len(sched) == len(model_sched):
            sched = sched.copy()
            sched["home_b2b"] = model_sched["home_b2b"].to_numpy()
            sched["away_b2b"] = model_sched["away_b2b"].to_numpy()
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        res = run_model(model_done, schedule=model_sched,
                        stan_model=stan_model, points_model=points_model_for(league),
                        **fit_kw)
    notes.extend(str(x.message) for x in w)
    n_start = None
    starter_coef = None
    if (fit_kw["starter"] and res["forecast"] is not None and len(sched)
            and "starter_edge" in getattr(model_sched, "columns", ())):
        # identity and the chance without the covariate; the probability,
        # spread and total already include the in-model term and are not
        # shifted again
        try:
            res["forecast"] = starters.annotate_in_model(res["forecast"], sched, res)
            n_start = starter_counts(res["forecast"], today)
            coef = float(np.mean(res["fit"].stan_variable("starter_coef")))
            starter_coef = coef
            res["forecast"]["starter_coef"] = coef
            notes.insert(0, f"starter coef {coef:+.3f}")
            if fit_kw["margin_home"]:
                hm = float(np.mean(res["fit"].stan_variable("home_margin")))
                notes.insert(0, f"home margin {hm:+.2f}")
        except Exception as e:
            notes.insert(0, f"starter audit skipped ({type(e).__name__}: {e})")
            log(traceback.format_exc())
    n_players = None
    if league in player_adj.LEAGUES and res["forecast"] is not None and len(sched):
        # player-level adjustment; a failure publishes the forecast without it
        try:
            res["forecast"] = player_adj.adjust_forecast(
                conn, league, sched, res["forecast"], as_of or _now())
            n_players = player_adj.counts(res["forecast"])
        except Exception as e:
            notes.insert(0, f"players skipped ({type(e).__name__}: {e})")
            log(traceback.format_exc())
    elo = None
    if res["forecast"] is not None and len(sched):
        # dynamic Bayesian Elo stack; any Elo failure publishes the logit alone
        elo = bayes_elo.elo_probs(conn, league, sched, cutoff.isoformat(), elo_model)
        try:
            res["forecast"], wnotes = bayes_elo.apply_stack(
                res["forecast"], sched, league, elo["p_elo"])
        except Exception as e:
            elo["p_elo"] = None
            elo["notes"].append(f"elo fallback: stack {type(e).__name__}: {e}"[:200])
            log(traceback.format_exc())
            res["forecast"], wnotes = bayes_elo.apply_stack(
                res["forecast"], sched, league, None)
        notes[:0] = elo["notes"] + wnotes
        if n_players:
            # redo the player term with the Elo weight actually used, restack
            res["forecast"] = player_adj.restack(res["forecast"], league)
        # our model's margin follows the stacked win chance (same favorite);
        # a failure publishes the margin unmoved
        try:
            res["forecast"] = carry_margin(res["forecast"], league)
        except Exception as e:
            notes.insert(0, f"margin carry skipped ({type(e).__name__}: {e})"[:200])
            log(traceback.format_exc())
        if elo["p_elo"] is not None:
            dg = elo["diag"]
            ws = sorted(set(np.round(res["forecast"]["elo_weight"], 3)))
            notes.insert(0, f"elo w={'/'.join(f'{x:g}' for x in ws)} K={dg['K']:.1f} "
                            f"rhat={dg['max_rhat']:.3f} div={dg['divergences']} "
                            f"{dg['seconds']}s")
        if league == "nba":
            # ridge chance for games the player model can score; any failure
            # publishes the path above and says so on the status line
            try:
                if not dry_run:
                    note = nba_player.morning(conn, today, log=log)
                    if note:
                        notes.insert(0, note)
                res["forecast"] = nba_player.apply(
                    conn, sched, res["forecast"], as_of or _now(), today, log=log)
            except Exception as e:
                notes.insert(0, f"nba player model skipped ({type(e).__name__}: {e})"[:200])
                log(traceback.format_exc())
                try:
                    res["forecast"] = nba_player.mark_team(res["forecast"])
                except Exception:
                    log(traceback.format_exc())
        if league == "nhl":
            # ridge chance for games the player model can score; any failure
            # publishes the path above and says so on the status line
            try:
                if not dry_run:
                    note = nhl_player.morning(conn, today, log=log)
                    if note:
                        notes.insert(0, note)
                res["forecast"] = nhl_player.apply(
                    conn, sched, res["forecast"], as_of or _now(), today)
            except Exception as e:
                notes.insert(0, f"nhl player model skipped ({type(e).__name__}: {e})"[:200])
                log(traceback.format_exc())
                try:
                    res["forecast"] = nhl_player.mark_team(res["forecast"])
                except Exception:
                    log(traceback.format_exc())
        if league == "nfl":
            # ridge chance when both starters are confirmed and the stored
            # fit has at least 2000 games. The refit is Tuesday (or the first
            # run with no fit), and again after a play-by-play load that
            # adds completed games. Any failure publishes the path above.
            try:
                if not dry_run:
                    note = nfl_player.morning(conn, today, log=log)
                    if note:
                        notes.insert(0, note)
                res["forecast"] = nfl_player.apply(
                    conn, sched, res["forecast"], as_of or _now(), today)
            except Exception as e:
                notes.insert(0, f"nfl player model skipped ({type(e).__name__}: {e})"[:200])
                log(traceback.format_exc())
                try:
                    res["forecast"] = nfl_player.mark_team(res["forecast"])
                except Exception:
                    log(traceback.format_exc())
        if league == "mlb":
            # stack B when both lineups are posted and both starters are
            # known, and the stored fit has at least 2000 games. The refit
            # is Tuesday (or the first run with no fit). morning() logs a
            # refit or state error and does not raise. Anything that still
            # escapes is logged here and this league keeps the path above.
            # The loop in main() then rates the other leagues. Offseason
            # leagues never reach here.
            try:
                if not dry_run:
                    note = mlb_player.morning(conn, today, log=log)
                    if note:
                        notes.insert(0, note)
                res["forecast"] = mlb_player.apply(
                    conn, sched, res["forecast"], as_of or _now(), today)
            except Exception as e:
                notes.insert(0, f"mlb player model skipped ({type(e).__name__}: {e})"[:200])
                log(traceback.format_exc())
                try:
                    res["forecast"] = mlb_player.mark_team(res["forecast"])
                except Exception:
                    log(traceback.format_exc())
    if (starter_coef is not None and res.get("forecast") is not None
            and len(res["forecast"])):
        # later overlays copy the frame; stamp the morning coefficient last
        # so the intraday probable refresh can move the chance without a refit
        res["forecast"]["starter_coef"] = starter_coef
    out = {"rating_season": int(res["rating_season"]),
           "n_games": int(res["n_fit_games"]),
           "n_teams": len(res["ratings"]),
           "seconds": round(time.monotonic() - t0, 1),
           "elo_fallback": elo is not None and elo["p_elo"] is None}
    if n_players:
        notes.insert(0, n_players)
    if n_start:
        notes.insert(0, f"starters today {n_start['today']}, later {n_start['later']}")
    out["notes"] = "; ".join(notes)[:500] or None
    if dry_run:
        out["forecast"], out["sched"] = res["forecast"], sched
        out["n_forecasts"] = int((sched["date"].astype(str).str[:10] == today.isoformat()).sum())
        return out
    out["n_forecasts"] = save_snapshot(conn, today.isoformat(), league, res, sched,
                                       upcoming=True)
    return out


def starter_counts(f, today: date) -> dict:
    """'adjusted/known/sides' starter counts for today's games and later."""
    is_today = f["date"].astype(str).str[:10] == today.isoformat()
    def fmt(m):
        sides = 2 * int(m.sum())
        known = int(f.loc[m, "home_starter_id"].notna().sum()
                    + f.loc[m, "away_starter_id"].notna().sum())
        adj = int((f.loc[m, "home_starter_rel"] != 0).sum()
                  + (f.loc[m, "away_starter_rel"] != 0).sum())
        return f"{adj}/{known}/{sides}"
    return {"today": fmt(is_today), "later": fmt(~is_today)}


def _starter_label(p, side: str) -> str:
    if pd.isna(p[f"{side}_starter_id"]):
        return "none"
    return (f"{p[f'{side}_starter_name']} [{p[f'{side}_starter_src']}] "
            f"{p[f'{side}_starter_rel']:+.2f}")


def dry_run(db_path, leagues, today: date, as_of: str = None) -> int:
    """Fit and print each in-season league's forecasts from today on, with
    the starter used and how far it moved each game. Opens the DB read-only;
    writes nothing (no snapshots, no daily_runs, no status line)."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=30)
    names = {r[0]: r[1] for r in conn.execute("SELECT team_id, abbreviation FROM teams")}
    stan_model = get_bt_model()
    elo_model = bayes_elo.get_elo_model()
    for lg in leagues:
        if not in_season(conn, lg, today):
            print(f"{lg}: off season")
            continue
        r = rate_league(conn, lg, today, stan_model, as_of=as_of, dry_run=True,
                        elo_model=elo_model)
        f, sched = r["forecast"], r["sched"]
        print(f"== {lg}: {len(sched)} games, notes: {r['notes']}")
        if f is None:
            continue
        for (_, g), (_, p) in zip(sched.iterrows(), f.iterrows()):
            line = (f"{str(g['date'])[:10]} {g['espn_event_id']} "
                    f"{names.get(int(g['away_team']), g['away_team'])} @ "
                    f"{names.get(int(g['home_team']), g['home_team'])}  "
                    f"home {p['home_prob']:.3f}")
            if "p_logit" in f.columns:
                pe = "n/a" if pd.isna(p["p_elo"]) else f"{p['p_elo']:.3f}"
                line += (f" = logit {p['p_logit']:.3f} x elo {pe} "
                         f"(w {p['elo_weight']:.3f})")
            if "home_prob_base" in f.columns:
                line += (f" (base {p['home_prob_base']:.3f}, "
                         f"{100 * (p['home_prob'] - p['home_prob_base']):+.1f} pts)  "
                         f"total {p['total_pred']:.1f} (base {p['total_pred_base']:.1f})  "
                         f"away SP/G: {_starter_label(p, 'away')} | "
                         f"home: {_starter_label(p, 'home')}")
            print(line)
    return 0



def rate_each(conn, leagues, today, stan_model, elo_model, parts):
    """Fit and save each in-season league.

    A league that raises is logged and stored as an error. The next league
    still runs. `parts` gains one status fragment per league. Returns the
    leagues that finished, and whether any league raised.
    """
    rated = []
    failed = False
    for lg in leagues:
        started = _now()
        if not in_season(conn, lg, today):
            parts.append(f"{lg} off")
            with db.immediate(conn):
                conn.execute("INSERT INTO daily_runs (snapshot_date, league, "
                             "started_at, finished_at, status) VALUES (?,?,?,?,?)",
                             (today.isoformat(), lg, started, _now(), "skipped"))
            continue
        try:
            r = rate_league(conn, lg, today, stan_model, elo_model=elo_model)
            status = "ok"
            rated.append(lg)
            parts.append(f"{lg} ok {r['n_teams']}t {r['n_forecasts']}fc "
                         f"{r['seconds']}s"
                         + (" WARN elo fallback" if r.get("elo_fallback") else ""))
            log(f"{lg}: {r}")
        except Exception as e:
            failed = True
            status = "error"
            r = {"notes": f"{type(e).__name__}: {e}"[:500]}
            parts.append(f"{lg} ERROR {type(e).__name__}")
            log(traceback.format_exc())
        with db.immediate(conn):
            conn.execute(
                "INSERT INTO daily_runs (snapshot_date, league, started_at, "
                "finished_at, status, rating_season, n_games, n_teams, "
                "n_forecasts, seconds, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (today.isoformat(), lg, started, _now(), status,
                 r.get("rating_season"), r.get("n_games"), r.get("n_teams"),
                 r.get("n_forecasts"), r.get("seconds"), r.get("notes")))
    return rated, failed



def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("--leagues", default=",".join(LEAGUES))
    ap.add_argument("--date", default=None,
                    help="run as if today were YYYY-MM-DD (America/Chicago)")
    ap.add_argument("--skip-update", action="store_true",
                    help="don't call ESPN; model the DB as it is")
    ap.add_argument("--rate", type=float, default=1.0)
    ap.add_argument("--status-file", default=None)
    ap.add_argument("--dry-run", action="store_true",
                    help="fit and print forecasts (with starters); write nothing")
    ap.add_argument("--as-of", default=None,
                    help="ISO UTC time whose known starters are used (default now)")
    args = ap.parse_args(argv)

    today = (date.fromisoformat(args.date) if args.date
             else datetime.now(CHICAGO).date())
    leagues = [x.strip().lower() for x in args.leagues.split(",") if x.strip()]
    dbp = args.db or db_path()
    if args.dry_run:
        return dry_run(dbp, leagues, today, args.as_of)
    conn = db.connect(dbp)
    db.init_db(conn)
    t_start = time.monotonic()
    parts, failed = [], False

    if not args.skip_update:
        try:
            st = update_espn(conn, leagues, today, args.rate)
            parts.append(f"espn +{st['games']}g/{st['summaries']}s"
                         + (f" {st['errors']}err" if st["errors"] else ""))
            failed |= bool(st["errors"])
        except Exception as e:
            failed = True
            parts.append(f"espn ERROR {type(e).__name__}")
            log(traceback.format_exc())

    # player box lines from the stored summaries (no ESPN calls); never fails the run
    try:
        from . import players
        ps = players.extract(conn, [lg for lg in leagues if lg in players.LEAGUES], log=log)
        n_err = sum(v.get("error", 0) for v in ps.values())
        parts.append(f"players +{sum(v.get('ok', 0) for v in ps.values())}g"
                     + (f" {n_err}err" if n_err else ""))
    except Exception as e:
        parts.append(f"players skipped ({type(e).__name__})")
        log(traceback.format_exc())

    # Team totals the NFL model reads (yards allowed). Never fails the run.
    try:
        from . import team_counts
        lb = team_counts.extract(conn, [lg for lg in leagues if lg in team_counts.LEAGUES], log=log)
        parts.append(f"counts +{sum(v['games'] for v in lb.values())}g")
    except Exception as e:
        parts.append(f"counts skipped ({type(e).__name__})")
        log(traceback.format_exc())

    t = time.monotonic()
    stan_model = get_bt_model()            # compiles once, cached on disk
    log(f"stan model ready in {time.monotonic() - t:.1f}s")
    elo_model = None
    try:
        t = time.monotonic()
        elo_model = bayes_elo.get_elo_model()  # compiled once, cached on disk
        log(f"elo model ready in {time.monotonic() - t:.1f}s")
    except Exception:
        log(traceback.format_exc())            # each league then falls back

    rated, league_failed = rate_each(
        conn, leagues, today, stan_model, elo_model, parts)
    failed |= league_failed

    # Per-player model values for the team pages (player_values.py): runs after
    # the forecasts are saved, only reads the model's running sums, and never
    # fails the run or feeds a forecast.
    try:
        from . import player_values
        parts.append(player_values.status_part(
            player_values.run(conn, leagues, today.isoformat(), log=log)))
    except Exception as e:
        parts.append(f"values skipped ({type(e).__name__})")
        log(traceback.format_exc())

    # pre-game logging health (its own passes run from cron); display only
    try:
        from . import prelog
        parts.append(prelog.health(conn))
    except Exception as e:
        parts.append(f"prelog status skipped ({type(e).__name__})")

    line = (f"{datetime.now(CHICAGO):%Y-%m-%d %H:%M} CT "
            f"{'FAIL' if failed else 'OK'} snapshot={today} "
            + " | ".join(parts) + f" | {time.monotonic() - t_start:.0f}s")
    write_status(args.status_file or status_path("daily.log"), line)
    log(line)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
