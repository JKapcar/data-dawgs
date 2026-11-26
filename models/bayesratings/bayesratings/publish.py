"""Write ratings and forecasts to SQLite."""

import numpy as np
import pandas as pd

from . import (bayes_elo, db, mlb_player, nba_player, nfl_player,
               nhl_player, player_adj, starters)

def rating_uncertainty(res) -> pd.DataFrame:
    """Posterior sd and 90% interval per team, on draws centered per draw so
    they match the zero-centered point ratings."""
    draws = res["fit"].stan_variable("rating")         # (n_draws, T)
    draws = draws - draws.mean(axis=1, keepdims=True)
    teams = res["ratings"].index
    return pd.DataFrame({
        "rating_sd": draws.std(axis=0, ddof=1),
        "rating_q05": np.quantile(draws, 0.05, axis=0),
        "rating_q95": np.quantile(draws, 0.95, axis=0),
    }, index=teams)


RATING_COLS = ("snapshot_date", "league", "season", "team_id", "rating",
               "rating_sd", "rating_q05", "rating_q95", "home_adv", "backfilled")
BASE_FORECAST_COLS = ("snapshot_date", "league", "espn_event_id", "game_date",
                      "home_team_id", "away_team_id", "home_prob", "away_prob",
                      "home_spread", "total_pred", "home_total_pred",
                      "away_total_pred")
AUDIT_COLS = (starters.AUDIT_COLS + player_adj.AUDIT_COLS + bayes_elo.AUDIT_COLS
              + nba_player.AUDIT_COLS + nhl_player.AUDIT_COLS + nfl_player.AUDIT_COLS
              + mlb_player.AUDIT_COLS)
FORECAST_COLS = BASE_FORECAST_COLS + ("backfilled",) + AUDIT_COLS
UPCOMING_COLS = BASE_FORECAST_COLS + AUDIT_COLS


def _audit_values(p) -> tuple:
    """Starter and Elo-stack audit columns from a forecast row; None where
    not applied."""
    out = []
    for c in AUDIT_COLS:
        v = p.get(c)
        if v is None or (not isinstance(v, str) and pd.isna(v)):
            out.append(None)
        elif c.endswith("_id"):
            out.append(int(v))
        elif isinstance(v, str) or c.endswith("_src") or c == "model_version":
            out.append(str(v))
        else:
            out.append(float(v))
    return tuple(out)


def save_snapshot(conn, snap: str, league: str, res, sched,
                  backfilled: int = 0, upcoming: bool = False) -> int:
    """Rows for games on `snap` go to forecast_snapshots (the game-day
    forecast, the only one graded). With upcoming=True, rows for later games
    replace the league's upcoming_forecasts (display only, never graded).
    Returns the number of game-day forecasts."""
    unc = rating_uncertainty(res)
    rat = [(snap, league, int(res["rating_season"]), int(t), float(r),
            float(unc.at[t, "rating_sd"]), float(unc.at[t, "rating_q05"]),
            float(unc.at[t, "rating_q95"]), float(res["home_adv"]), backfilled)
           for t, r in res["ratings"].items()]
    fc = []
    f = res["forecast"]
    if f is not None and len(f):
        if len(f) != len(sched):
            raise RuntimeError("forecast rows do not match schedule rows")
        for (_, g), (_, p) in zip(sched.iterrows(), f.iterrows()):
            fc.append((snap, league, int(g["espn_event_id"]), g["date"],
                       int(g["home_team"]), int(g["away_team"]),
                       float(p["home_prob"]), float(p["away_prob"]),
                       float(p["home_spread"]), float(p["total_pred"]),
                       float(p["home_total_pred"]), float(p["away_total_pred"]),
                       backfilled) + _audit_values(p))
    later = []
    if upcoming:
        nb = len(BASE_FORECAST_COLS)   # upcoming rows: no backfilled column
        later = [r[:nb] + r[nb + 1:] for r in fc if str(r[3])[:10] != snap]
        fc = [r for r in fc if str(r[3])[:10] == snap]
    with db.immediate(conn):  # one transaction: replace the day's rows for this league
            if upcoming:
                conn.execute("DELETE FROM upcoming_forecasts WHERE league = ?", (league,))
                conn.executemany(
                    f"INSERT OR REPLACE INTO upcoming_forecasts ({', '.join(UPCOMING_COLS)}) "
                    f"VALUES ({', '.join('?' * len(UPCOMING_COLS))})", later)
            conn.execute("DELETE FROM rating_snapshots WHERE snapshot_date = ? "
                         "AND league = ?", (snap, league))
            conn.execute("DELETE FROM forecast_snapshots WHERE snapshot_date = ? "
                         "AND league = ?", (snap, league))
            conn.executemany(
                f"INSERT INTO rating_snapshots ({', '.join(RATING_COLS)}) VALUES "
                f"({', '.join('?' * len(RATING_COLS))})", rat)
            conn.executemany(
                f"INSERT INTO forecast_snapshots ({', '.join(FORECAST_COLS)}) VALUES "
                f"({', '.join('?' * len(FORECAST_COLS))})", fc)
    return len(fc)
