"""Walk-forward team chances for NFL games before the snapshot era.

Replays the production team logit by MAP (bayesratings/team_map.py, the
base variant: 180-day half-life, weights below 0.05 dropped, no extra
covariates) over nfl_schedule. Each game day from the 2007 season on is
fit on earlier scored games only. Rows are written for games dated before
2025-09-04. Later games keep the game-day snapshot.

Relocations share a franchise key (the schedule's franchise columns, which
already use that key, canonicalized again here). A neutral site is taken
from games.neutral_site when that event is in games, and is 0 otherwise.

Idempotent: a second run with the same schedule writes nothing. Scipy only.

    python -m bayesratings.nfl_team_hist --db data/bayesratings.db
"""

import argparse
import sqlite3
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy.special import expit

from . import db
from .nfl_player import SNAPSHOT_FROM, TRAIN_FROM_SEASON, canon
from .team_map import fit

HALF_LIFE = 180.0
MIN_WEIGHT = 0.05
SIGMA = 1.0
# Bump when the replay definition changes so a stored table is rebuilt.
MODEL_VERSION = "map-base-hl180-w05-v1"
META_KEY = "nfl_team_chance_hist"


def _meta(conn, key):
    try:
        row = conn.execute("SELECT value FROM src_meta WHERE key = ?", (key,)).fetchone()
    except sqlite3.OperationalError:
        return None
    return row[0] if row else None


def _put_meta(conn, key, value, at):
    conn.execute(
        "INSERT OR REPLACE INTO src_meta (key, value, updated_at) VALUES (?,?,?)",
        (key, value, at))


def fingerprint(conn) -> str:
    """Changes when the scored schedule or a stored neutral flag changes."""
    row = conn.execute(
        "SELECT COUNT(*), COALESCE(MAX(game_date), ''), "
        "ROUND(COALESCE(SUM(home_score), 0), 2), ROUND(COALESCE(SUM(away_score), 0), 2), "
        "COALESCE(SUM(LENGTH(COALESCE(home_franchise, ''))), 0), "
        "COALESCE(SUM(LENGTH(COALESCE(away_franchise, ''))), 0) "
        "FROM nfl_schedule WHERE season >= ? AND home_score IS NOT NULL "
        "AND away_score IS NOT NULL AND game_date IS NOT NULL",
        (TRAIN_FROM_SEASON,)).fetchone()
    try:
        neu = conn.execute(
            "SELECT COALESCE(SUM(g.neutral_site), 0) FROM games g "
            "JOIN nfl_schedule s ON s.espn_event_id = g.espn_event_id "
            "WHERE g.league = 'nfl' AND s.season >= ?",
            (TRAIN_FROM_SEASON,)).fetchone()[0]
    except sqlite3.OperationalError:
        neu = 0
    return f"{MODEL_VERSION}|{SNAPSHOT_FROM}|{tuple(row)}|{neu}"


def _neutral(conn) -> dict:
    try:
        rows = conn.execute(
            "SELECT espn_event_id, MAX(neutral_site) FROM games "
            "WHERE league = 'nfl' AND espn_event_id IS NOT NULL "
            "GROUP BY espn_event_id").fetchall()
    except sqlite3.OperationalError:
        return {}
    return {int(eid): int(flag or 0) for eid, flag in rows}


def load_games(conn) -> pd.DataFrame:
    """Scored nfl_schedule rows from 2006 on, one franchise key per relocation."""
    df = pd.read_sql_query(
        "SELECT game_id, season, game_date, home_franchise, away_franchise, "
        "home_score, away_score, espn_event_id FROM nfl_schedule "
        "WHERE season >= ? AND home_score IS NOT NULL AND away_score IS NOT NULL "
        "AND game_date IS NOT NULL",
        conn, params=(TRAIN_FROM_SEASON,))
    if not len(df):
        return df
    neu = _neutral(conn)
    df["home"] = df["home_franchise"].map(canon)
    df["away"] = df["away_franchise"].map(canon)
    df = df[df["home"].notna() & df["away"].notna() & (df["home"] != df["away"])]
    df["neu"] = [
        neu.get(int(e), 0) if pd.notna(e) else 0 for e in df["espn_event_id"]]
    df["y"] = (df["home_score"] > df["away_score"]).astype(int)
    df["m"] = (df["home_score"] - df["away_score"]).astype(float)
    return df.sort_values(["game_date", "game_id"]).reset_index(drop=True)


def _eid(value):
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    try:
        if pd.isna(value):
            return None
    except TypeError:
        pass
    return int(value)


def replay(games, cutoff=SNAPSHOT_FROM, first_season=2007, log=None) -> list:
    """Home chances for scored games in `first_season` and later, before `cutoff`.

    Each game day is fit on earlier scored games only. 2006 is history and
    is not written. Returns (game_id, espn_event_id, game_date, p) rows.
    """
    if games is None or not len(games):
        return []
    g = games
    teams = sorted(set(g["home"]) | set(g["away"]))
    ix = {t: i for i, t in enumerate(teams)}
    T = len(teams)
    hi = g["home"].map(ix).to_numpy(int)
    ai = g["away"].map(ix).to_numpy(int)
    y = g["y"].to_numpy(float)
    m = g["m"].to_numpy(float)
    neu = g["neu"].to_numpy(float)
    seasons = g["season"].to_numpy(int)
    dates = pd.to_datetime(g["game_date"]).values.astype("datetime64[D]")
    date_txt = pd.to_datetime(g["game_date"]).dt.strftime("%Y-%m-%d").to_numpy()
    ids = g["game_id"].astype(str).to_numpy()
    eids = [_eid(v) for v in g["espn_event_id"]]
    cutoff_d = np.datetime64(str(cutoff)[:10])
    days = np.unique(dates[(seasons >= int(first_season)) & (dates < cutoff_d)])
    x0 = None
    out = []
    Xempty = np.zeros((0, 0))
    for n_day, day in enumerate(days):
        tr = dates < day
        if not tr.any():
            continue
        age = (dates[tr].max() - dates[tr]).astype("timedelta64[D]").astype(float)
        w = 0.5 ** (age / HALF_LIFE)
        keep = w >= MIN_WEIGHT
        if not keep.any():
            continue
        idx = np.flatnonzero(tr)[keep]
        ww = w[keep]
        if x0 is None:
            x0 = np.r_[np.zeros(T), 0.1, np.log(5.0), np.log(10.0), np.log(SIGMA), 0.0]
        x0 = fit(hi[idx], ai[idx], y[idx], m[idx], ww, np.ones(len(idx)),
                 neu[idx], Xempty, T, SIGMA, True, x0, homesep=False)
        r, h = x0[:T], x0[T]
        te = np.flatnonzero(dates == day)
        eta = r[hi[te]] - r[ai[te]] + h * (1.0 - neu[te])
        p = expit(eta)
        for i, prob in zip(te, p):
            if not np.isfinite(prob):
                continue
            out.append((ids[i], eids[i], date_txt[i], float(prob)))
        if log and (n_day + 1) % 40 == 0:
            log(f"nfl team chance {date_txt[te[0]]} {len(out)} games")
    return out


def backfill(conn, log=print) -> int:
    """Write nfl_team_chance_hist. Returns the row count. A matching
    fingerprint keeps the stored rows."""
    token = fingerprint(conn)
    have = 0
    try:
        have = conn.execute("SELECT COUNT(*) FROM nfl_team_chance_hist").fetchone()[0]
    except sqlite3.OperationalError:
        have = 0
    if have and _meta(conn, META_KEY) == token:
        log(f"nfl team chance hist up to date ({have} rows)")
        return int(have)
    games = load_games(conn)
    if not len(games):
        raise RuntimeError("nfl_schedule has no scored games from 2006 on")
    t0 = datetime.now(timezone.utc)
    rows = replay(games, log=log)
    if not rows:
        raise RuntimeError("team-chance replay produced no games before 2025-09-04")
    at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with db.immediate(conn):
        conn.execute("DELETE FROM nfl_team_chance_hist")
        conn.executemany(
            "INSERT INTO nfl_team_chance_hist "
            "(game_id, espn_event_id, game_date, p, model_version, created_at) "
            "VALUES (?,?,?,?,?,?)",
            [(gid, eid, day, p, MODEL_VERSION, at) for gid, eid, day, p in rows])
        _put_meta(conn, META_KEY, token, at)
    seconds = (datetime.now(timezone.utc) - t0).total_seconds()
    log(f"nfl team chance hist {len(rows)} rows in {seconds:.0f}s ({MODEL_VERSION})")
    return len(rows)


def _main(argv=None):
    from . import db
    ap = argparse.ArgumentParser(
        description="Backfill walk-forward NFL team chances before 2025-09-04")
    ap.add_argument("--db", default="data/bayesratings.db")
    args = ap.parse_args(argv)
    conn = db.connect(args.db)
    db.init_db(conn)
    n = backfill(conn)
    print(f"nfl_team_chance_hist {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
