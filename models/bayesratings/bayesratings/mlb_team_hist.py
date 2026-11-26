"""Walk-forward team+starter chances for completed MLB games from 2022 on.

The number is the production rating model's home win chance with the
starter in the model (margin home edge, rating prior scale 0.5),
before the player term and before the Elo blend. Each game day uses only
games and starts dated before that day.

A day that already has that probability on the game-day forecast snapshot
is copied. That row was written with the morning's rating snapshot, so
those days are not fit again. A rating snapshot stores posterior-mean ratings, not
the posterior win chance and not the starter coefficient, so a day with
ratings and no stored probability is fit rather than inverted at the mean.

Days without a snapshot are one Stan fit each (the production sampler,
holdout evaluation off, four chains one at a time). The process is niced.
One fit is dropped before the next, and the write is one short transaction
per day, so the morning job keeps the database.

Filled games are skipped. ``--season`` limits which season is written; the
fit for that season still sees earlier seasons. A second run writes nothing
for games already stored.

    python -m bayesratings.mlb_team_hist --db data/bayesratings.db
    python -m bayesratings.mlb_team_hist --db data/bayesratings.db --season 2023

A season that needs a fit is about 180 game days. Four chains, run one at a
time on a decay window of a few thousand games, is on the order of one to
three minutes per day, so several hours per season. A season already
filled, or already covered by game-day snapshots, finishes in seconds.
Run one season at a time, and not across the 06:00 job. Stopping and
running the same command again continues at the first unfilled game.
"""

import argparse
import gc
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import db, starters
from .db import read_games
from .games import completed_games as completed_rows
from .mlb_player import snapshot_team_probs
from .ratings import fit_bt_ratings, get_bt_model, neutral_flags, posterior_home_prob
from .weights import decay_window, league_fit_kwargs

FROM_SEASON = 2022
# Bump when the replay definition changes. Stored rows are not rewritten;
# delete them to recompute under a new version.
MODEL_VERSION = "stan-mlb-starter-s05-hl180-v1"
CHAINS = 4
# One chain at a time, so a fit does not take every core.
PARALLEL_CHAINS = 1
NICE = 10


def _day_text(value) -> str:
    return str(value)[:10]


def load_done(conn) -> pd.DataFrame:
    """Completed MLB games the rating model sees, with starter edges.

    Edges use only earlier starts (same-day rows do not see each other),
    from the pitcher who actually started.
    """
    games = read_games(conn, "mlb", event_id=True)
    games = completed_rows(games)
    if not len(games):
        return games
    games = games.copy()
    games["game_date"] = games["date"].astype(str).str[:10]
    games["date"] = pd.to_datetime(games["game_date"])
    games["espn_event_id"] = games["espn_event_id"].astype(int)
    games["season"] = games["season"].astype(int)
    logs = starters.load_starter_logs(conn, "mlb")
    return starters.attach_starter_edges(games, logs, "mlb")


def predict_day(done, day, today, fit_day):
    """Home chances for `today` from games strictly before `day`.

    `fit_day(train, today)` returns one probability per row of `today`.
    An empty history returns None and does not call `fit_day`.
    """
    day = pd.Timestamp(day).normalize()
    today = today.reset_index(drop=True)
    if not len(today):
        return None
    train = done[done["date"] < day]
    if not len(train):
        return None
    p = np.asarray(fit_day(train.copy(), today.copy()), dtype=float).reshape(-1)
    if len(p) != len(today):
        raise RuntimeError(
            f"fit for {day.date()} returned {len(p)} probabilities for {len(today)} games")
    return p


def _stan_day(train, today, stan_model):
    """Production Stan probability for `today`, fit on `train` only."""
    kw = league_fit_kwargs("mlb")
    window = decay_window(train, half_life_days=kw["half_life_days"])
    res = fit_bt_ratings(
        window, stan_model, evaluate=False,
        chains=CHAINS, parallel_chains=PARALLEL_CHAINS,
        sigma_scale=kw["sigma_scale"], margin_home=kw["margin_home"],
        starter=kw["starter"], b2b=kw["b2b"],
    )
    edge = (today["starter_edge"].to_numpy(dtype=float)
            if "starter_edge" in today.columns else None)
    p = posterior_home_prob(
        res["fit"], today["home_team"], today["away_team"],
        neutral_flags(today), res["teams"], None, None, edge)
    del res
    gc.collect()
    return p


def _filled(conn) -> set:
    try:
        rows = conn.execute("SELECT espn_event_id FROM mlb_team_chance_hist").fetchall()
    except Exception:
        return set()
    return {int(r[0]) for r in rows if r[0] is not None}


def _insert(conn, rows):
    if not rows:
        return
    with db.immediate(conn):
        conn.executemany(
            "INSERT OR IGNORE INTO mlb_team_chance_hist "
            "(espn_event_id, game_date, season, p, source, model_version, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            rows)


def _be_polite():
    try:
        os.nice(NICE)
    except OSError:
        pass


def backfill(conn, season=None, log=print, fit_day=None, polite=False) -> int:
    """Insert missing MLB team+starter chances from `FROM_SEASON` on.

    Returns the number of rows inserted. `fit_day` replaces the Stan fit
    (tests). The default fit compiles the production model on first use.
    """
    if season is not None and int(season) < FROM_SEASON:
        log(f"mlb team hist starts at {FROM_SEASON}")
        return 0
    if polite:
        _be_polite()
    done = load_done(conn)
    if not len(done):
        log("mlb team hist: no completed MLB games")
        return 0
    snaps = snapshot_team_probs(conn)
    filled = _filled(conn)
    target = done[done["season"] >= FROM_SEASON]
    if season is not None:
        target = target[target["season"] == int(season)]
    seasons = sorted(int(s) for s in target["season"].unique())
    if not seasons:
        log("mlb team hist: nothing to fill")
        return 0

    stan_model = {"m": None}

    def _fit(train, today):
        if stan_model["m"] is None:
            stan_model["m"] = get_bt_model()
        return _stan_day(train, today, stan_model["m"])

    use_fit = fit_day or _fit
    at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    wrote = 0
    for yr in seasons:
        part = target[target["season"] == yr]
        days = sorted(part["game_date"].unique())
        pending = int((~part["espn_event_id"].isin(filled)).sum())
        log(f"mlb team hist {yr}: {pending} games over {len(days)} days")
        n_copy = n_fit = n_skip = 0
        if pending == 0:
            log(f"mlb team hist {yr}: up to date")
            continue
        for i, day in enumerate(days, start=1):
            today = part[part["game_date"] == day]
            missing = today[~today["espn_event_id"].isin(filled)]
            if not len(missing):
                n_skip += int(len(today))
                continue
            copied = []
            need_idx = []
            for row in missing.itertuples(index=False):
                p = snaps.get(int(row.espn_event_id))
                if p is None or not np.isfinite(p):
                    need_idx.append(int(row.espn_event_id))
                    continue
                copied.append((int(row.espn_event_id), day, int(yr), float(p),
                               "snapshot", MODEL_VERSION, at))
            if copied:
                _insert(conn, copied)
                for eid, *_rest in copied:
                    filled.add(eid)
                n_copy += len(copied)
                wrote += len(copied)
            if need_idx:
                ask = missing[missing["espn_event_id"].isin(need_idx)]
                p = predict_day(done, day, ask, use_fit)
                if p is None:
                    log(f"mlb team hist {yr}: {day} has no earlier games, left unfilled")
                else:
                    rows = []
                    for eid, prob in zip(ask["espn_event_id"].astype(int), p):
                        if not np.isfinite(prob):
                            continue
                        rows.append((int(eid), day, int(yr), float(prob),
                                     "stan", MODEL_VERSION, at))
                    _insert(conn, rows)
                    for eid, *_rest in rows:
                        filled.add(eid)
                    n_fit += len(rows)
                    wrote += len(rows)
            if i == len(days) or i % 20 == 0:
                log(f"mlb team hist {yr}: day {i}/{len(days)} {day} "
                    f"copied {n_copy} fit {n_fit}")
        log(f"mlb team hist {yr}: done, copied {n_copy}, fit {n_fit}, "
            f"already stored {n_skip}")
    log(f"mlb team hist wrote {wrote}")
    return wrote


def _main(argv=None):
    from . import db
    ap = argparse.ArgumentParser(
        description="Backfill walk-forward MLB team+starter chances from 2022")
    ap.add_argument("--db", default="data/bayesratings.db")
    ap.add_argument("--season", type=int, default=None,
                    help="Fill one season. Earlier seasons still train the fit.")
    args = ap.parse_args(argv)
    conn = db.connect(args.db)
    db.init_db(conn)

    def _log(msg):
        print(msg, flush=True)

    n = backfill(conn, season=args.season, log=_log, polite=True)
    print(f"mlb_team_chance_hist wrote {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
