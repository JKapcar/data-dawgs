"""NBA player ridge: the published NBA win chance.

Standalone L2 logistic regression on player-aggregate
features plus rest, back-to-back and neutral site. No team rating is an input,
and nothing is stacked on the ridge chance.

Per game, at forecast time:
  ridge B  both teams have a submitted line on the latest official injury report,
           and both live lineups are usable
  ridge C  either team is NOT YET SUBMITTED, no report covers the game, or a
           B lineup is not usable and C can run
  team     no stored fit for that version, either team has no box score from
           this season or last, or the lineup above cannot be built

A live B lineup is usable when the team has a current-season box with
minutes and players with no such game hold at most 10% of the minute weight.

Training version B reads the official injury report when a status was
published before tip (out and doubtful stay out; questionable, probable
and available stay in). A player with no published status keeps who played.
B's live pool is everyone whose latest box is still with this team and who
has a box with minutes for this team in the current season, plus a listed
starter, minus anyone Out or Doubtful. Expected minutes on that lineup
halve every 21 days since the player's last game. That decay is live only;
the stored fit is not refit. C uses the previous game's rotation minus anyone
Out or Doubtful on the open report rows for that team, including when the
report is not fully submitted. Weights are expected minutes (0.7 / 0.3
exponential average, 12 before a first game, at least 1 after the live decay).

The spread follows the published chance from the current path's margin at
SLOPE points per unit of home logit (the carry_margin rule). The total
stays on the current path. Recorded locks and older forecast rows are not
rewritten. A failure publishes the current path and logs the league, the
event id, and the exception.

The training frame also carries travel columns from bayesratings/travel.py
(previous venue, kilometres, time-zone hours, days of rest). They are not
ridge inputs and do not change the published chance.
"""

import argparse
import json
import logging
import sqlite3
import traceback
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

TRAIN_FROM = "2021-12-01"
HL_LONG, HL_SHORT = 180.0, 21.0
K_LONG, K_SHORT = 400.0, 150.0
EXP_MIN_DEFAULT = 12.0
# Live B weights only. Halve expected minutes this many days after the last
# game (the short-form window). Applied before the floor of 1. Not in the fit.
EXP_MIN_HL = HL_SHORT
# Above this share of minute weight on players with no game for the team
# this season, version B falls back to C (then the team path).
GONE_SHARE_MAX = 0.10
UNKNOWN_MIN = 300.0
# same statuses player_adj.NBA_OUT removes
NBA_OUT = ("Out", "Doubtful")
NOT_YET = "(NOT YET SUBMITTED)"
RATE_COLS = ["gmsc", "poss_used", "ast", "oreb", "dreb", "stocks", "tov",
             "fg3a", "fta", "pts", "tsa"]
REPL_80 = {"gmsc", "pts", "ast", "stocks", "oreb", "dreb"}
CTX_COLS = ("h_b2b", "a_b2b", "rest_d", "neutral")
AUDIT_COLS = ("nba_model_src", "nba_ridge_prob", "nba_team_prob",
              "nba_ridge_fit_id", "nba_inputs")
_STAT_FILL = ["pts", "ast", "oreb", "dreb", "tov", "fg3a", "fta", "plus_minus"]
_BOX_STATS = ("pts", "fgm", "fga", "fg3a", "ftm", "fta", "oreb", "dreb",
              "ast", "tov", "stl", "blk", "pf", "plus_minus")


def _metrics(prior):
    """Metric order matches features.py: league-rate keys, then plus_minus."""
    return list(prior)


def _blank_prior():
    prior = {c: 0.0 for c in RATE_COLS}
    prior["plus_minus"] = -2.0 / 48.0
    return prior


def league_prior(P):
    """Replacement prior from played minutes. plus_minus is -2 per 48."""
    played = P["minutes"] > 0
    lg_m = float(P.loc[played, "minutes"].sum()) if played.any() else 0.0
    prior = {}
    for c in RATE_COLS:
        rate = float(P.loc[played, c].sum() / lg_m) if lg_m > 0 else 0.0
        prior[c] = rate * (0.8 if c in REPL_80 else 1.0)
    prior["plus_minus"] = -2.0 / 48.0
    return prior


def agg_keys(metrics):
    return [f"{c}_{h}" for c in metrics for h in ("L", "S")] + ["ts_L"]


def diff_feature_names(metrics=None):
    """Home-minus-away columns in the order ridge_wf.py trains on."""
    metrics = metrics or (_metrics(_blank_prior()))
    base = sorted(agg_keys(metrics) + ["unknown_share", "top3_gmsc"])
    return [f"d_{b}" for b in base] + list(CTX_COLS)


def _prepare_box(box):
    """Derived counting columns, in the same order as features.py."""
    P = box.copy()
    if "game_date" in P.columns and "date" not in P.columns:
        P["date"] = P["game_date"]
    P["date"] = pd.to_datetime(P["date"])
    if "did_not_play" not in P.columns:
        P["did_not_play"] = 0
    P["minutes"] = P["minutes"].fillna(0).astype(float)
    P.loc[P["did_not_play"] == 1, "minutes"] = 0.0
    for c in _BOX_STATS:
        if c not in P.columns:
            P[c] = 0.0
    P["gmsc"] = (P.pts + .4 * P.fgm - .7 * P.fga - .4 * (P.fta - P.ftm)
                 + .7 * P.oreb + .3 * P.dreb + P.stl + .7 * P.ast
                 + .7 * P.blk - .4 * P.pf - P.tov).fillna(0)
    P["poss_used"] = (P.fga + .44 * P.fta + P.tov).fillna(0)
    P["tsa"] = (P.fga + .44 * P.fta).fillna(0)
    P["stocks"] = (P.stl + P.blk).fillna(0)
    for c in _STAT_FILL:
        P[c] = P[c].fillna(0)
    return P.sort_values(["athlete_id", "date", "espn_event_id"]).reset_index(drop=True)


def _ts(pL, tL):
    """TS% shrunk the way features.py shrinks it (200 * 1.12 over 200 * 2 * 0.56)."""
    return (pL + 200 * 1.12) / (2 * tL + 200 * 2 * 0.56)


def decay_rates(sL, sS, mL, mS, tL, pL, last, game_date, prior, exp_min):
    """Pregame rates at `game_date` from sums stored at `last` (after that game).

    `last` None and zero sums is a player with no box line: pure prior, 12 minutes.
    """
    metrics = _metrics(prior)
    sL = {c: float(sL.get(c, 0.0)) for c in metrics}
    sS = {c: float(sS.get(c, 0.0)) for c in metrics}
    mL, mS, tL, pL = float(mL), float(mS), float(tL), float(pL)
    if last is not None and game_date is not None:
        delta = (pd.Timestamp(game_date).normalize() - pd.Timestamp(last).normalize()).days
        fL = 0.5 ** (delta / HL_LONG)
        fS = 0.5 ** (delta / HL_SHORT)
        sL = {c: sL[c] * fL for c in metrics}
        sS = {c: sS[c] * fS for c in metrics}
        mL *= fL
        mS *= fS
        tL *= fL
        pL *= fL
    out = {}
    for c in metrics:
        out[f"{c}_L"] = (sL[c] + K_LONG * prior[c]) / (mL + K_LONG)
        out[f"{c}_S"] = (sS[c] + K_SHORT * out[f"{c}_L"]) / (mS + K_SHORT)
    out["ts_L"] = _ts(pL, tL)
    out["prior_min"] = mL
    out["exp_min"] = EXP_MIN_DEFAULT if exp_min is None else float(exp_min)
    return out


def player_rates(box):
    """Pregame rate columns on every box row, plus one post-game state per player.

    Sums on a row exclude that row's game and every later game. Returns
    (frame, states, prior). `states` is the decayed sums after each player's
    last game, which `build_state` stores.
    """
    if box is None or not len(box):
        prior = _blank_prior()
        return pd.DataFrame(), [], prior
    P = _prepare_box(box)
    prior = league_prior(P)
    metrics = _metrics(prior)
    n = len(P)
    out = {f"{c}_{h}": np.full(n, np.nan) for c in metrics for h in ("L", "S")}
    out["prior_min"] = np.zeros(n)
    out["exp_min"] = np.zeros(n)
    out["ts_L"] = np.full(n, np.nan)
    d_all = P.date.values.astype("datetime64[D]").astype(float)
    vals = {c: P[c].values.astype(float) for c in metrics}
    mins = P.minutes.values
    tsa = P.tsa.values.astype(float)
    pts = P.pts.values.astype(float)
    states = []
    for pid, idx in P.groupby("athlete_id").indices.items():
        d = d_all[idx]
        sL = {c: 0.0 for c in metrics}
        sS = {c: 0.0 for c in metrics}
        mL = mS = 0.0
        tL = pL = 0.0
        em = None
        last = None
        for j, i in enumerate(idx):
            if last is not None:
                fL = 0.5 ** ((d[j] - last) / HL_LONG)
                fS = 0.5 ** ((d[j] - last) / HL_SHORT)
                for c in metrics:
                    sL[c] *= fL
                    sS[c] *= fS
                mL *= fL
                mS *= fS
                tL *= fL
                pL *= fL
            for c in metrics:
                out[f"{c}_L"][i] = (sL[c] + K_LONG * prior[c]) / (mL + K_LONG)
                out[f"{c}_S"][i] = (sS[c] + K_SHORT * out[f"{c}_L"][i]) / (mS + K_SHORT)
            out["ts_L"][i] = _ts(pL, tL)
            out["prior_min"][i] = mL
            out["exp_min"][i] = em if em is not None else EXP_MIN_DEFAULT
            m = mins[i]
            for c in metrics:
                sL[c] += vals[c][i]
                sS[c] += vals[c][i]
            mL += m
            mS += m
            tL += tsa[i]
            pL += pts[i]
            em = m if em is None else 0.7 * em + 0.3 * m
            last = d[j]
        last_i = idx[-1]
        last_day = pd.Timestamp(P.at[last_i, "date"]).date().isoformat()
        season = P.at[last_i, "season"] if "season" in P.columns else None
        states.append({
            "athlete_id": int(pid),
            "team_id": int(P.at[last_i, "team_id"]),
            "season": None if season is None or pd.isna(season) else int(season),
            "last_game_date": last_day,
            "exp_min": float(em if em is not None else EXP_MIN_DEFAULT),
            "prior_min": float(mL),
            "sL": sL, "sS": sS, "mL": float(mL), "mS": float(mS),
            "tL": float(tL), "pL": float(pL),
        })
    for k, v in out.items():
        P[k] = v
    return P, states, prior


def team_agg(df, wcol, feats):
    """Minutes-weighted team aggregate. Per-48 team rate is the mean times 5.

    TS% is not multiplied. None when the weights sum to 0 or less.
    """
    w = df[wcol].to_numpy(float)
    W = w.sum()
    if not np.isfinite(W) or W <= 0:
        return None
    res = {}
    for f in feats:
        x = df[f].to_numpy(float)
        res[f] = (x * w).sum() / W * (5 if f != "ts_L" else 1)
    res["unknown_share"] = (w * (df.prior_min.to_numpy(float) < UNKNOWN_MIN)).sum() / W
    g = df.gmsc_L.to_numpy(float)
    res["top3_gmsc"] = np.sort(g * np.minimum(w / W * 240, 40) / 48)[-3:].sum()
    res["n_players"] = int((w > 0).sum())
    return res


def _row_as_series(row):
    if isinstance(row, pd.DataFrame):
        return row.iloc[0]
    return row


def _pool_b(df, known):
    """Rows in version B.

    `known` is {athlete_id: published status} when a report covers the team,
    or None when it does not. A published out or doubtful player is left
    out. Questionable, probable and available stay in. Anyone the report
    does not name keeps the who-played rule (minutes > 0).
    """
    if not known:
        return df[df.minutes > 0]
    from .injstatus import training_available
    played = df.minutes.to_numpy(float) > 0
    aids = df.athlete_id.to_numpy()
    mask = []
    for a, p in zip(aids, played):
        if a is None or (isinstance(a, float) and a != a):
            mask.append(bool(p))
            continue
        mask.append(training_available(known.get(int(a)), bool(p)))
    return df[np.asarray(mask, dtype=bool)]


def team_table(P, prior, availability=None):
    """One row per (event, team) with version A, B and C aggregates.

    B: players with minutes > 0, weighted by pregame expected minutes,
    unless `availability` has a published status for that player. Out and
    doubtful are left out. Questionable, probable and available stay in,
    including a player who recorded no minutes.
    C: the previous game's rotation, weighted by expected minutes. A player
    in that rotation but absent from this game's box keeps the previous
    game's pregame row (features.py).
    """
    feats = agg_keys(_metrics(prior))
    team_games = P.groupby(["espn_event_id", "team_id"])
    tg_order = (P[["espn_event_id", "team_id", "date"]].drop_duplicates()
                .sort_values(["team_id", "date"]))
    tg_order["prev_event"] = tg_order.groupby("team_id").espn_event_id.shift()
    prev_map = tg_order.set_index(["espn_event_id", "team_id"]).prev_event.to_dict()
    rec = []
    for (ev, tm), df in team_games:
        r = {"espn_event_id": ev, "team_id": tm}
        a = team_agg(df[df.minutes > 0], "minutes", feats)
        known = None if not availability else availability.get((int(ev), int(tm)))
        b_df = _pool_b(df, known).copy()
        b = None
        if len(b_df):
            b_df["w"] = b_df.exp_min.clip(lower=1)
            b = team_agg(b_df, "w", feats)
        pe = prev_map.get((ev, tm))
        c = None
        if pe is not None and (pe, tm) in team_games.groups:
            prev = team_games.get_group((pe, tm))
            rot = prev[prev.minutes > 0].athlete_id.values
            cur = df.set_index("athlete_id")
            parts = []
            for aid in rot:
                if aid in cur.index:
                    parts.append(_row_as_series(cur.loc[aid]))
                else:
                    parts.append(prev[prev.athlete_id == aid].iloc[0])
            if parts:
                cdf = pd.DataFrame(parts)
                cdf["w"] = cdf.exp_min.clip(lower=1)
                c = team_agg(cdf, "w", feats)
        for tag, x in (("A", a), ("B", b), ("C", c)):
            if x:
                for k, v in x.items():
                    r[f"{tag}_{k}"] = v
        rec.append(r)
    return pd.DataFrame(rec)


def rest_table(games):
    """Home and away rest, days since the previous final or scheduled game.

    Missing rest is 7. Values are clipped to 0–7. Indexed by espn_event_id.
    """
    if games is None or not len(games):
        return pd.DataFrame(columns=["h_rest", "a_rest"])
    allg = games.loc[(games["league"] == "nba")
                     & games["status"].isin(["STATUS_FINAL", "STATUS_SCHEDULED"])].copy()
    if not len(allg):
        return pd.DataFrame(columns=["h_rest", "a_rest"])
    allg["date"] = pd.to_datetime(allg["game_date"])
    home = (allg[["espn_event_id", "date", "home_team_id"]]
            .rename(columns={"home_team_id": "t"}).assign(h=1))
    away = (allg[["espn_event_id", "date", "away_team_id"]]
            .rename(columns={"away_team_id": "t"}).assign(h=0))
    lo = pd.concat([home, away], ignore_index=True).sort_values(["t", "date"])
    lo["rest"] = (lo["date"] - lo.groupby("t")["date"].shift()).dt.days
    rh = lo[lo.h == 1].drop_duplicates("espn_event_id").set_index("espn_event_id")
    ra = lo[lo.h == 0].drop_duplicates("espn_event_id").set_index("espn_event_id")
    out = pd.DataFrame({"espn_event_id": allg["espn_event_id"].unique()})
    out["h_rest"] = out.espn_event_id.map(rh.rest).fillna(7).clip(0, 7)
    out["a_rest"] = out.espn_event_id.map(ra.rest).fillna(7).clip(0, 7)
    return out.set_index("espn_event_id")


def context_row(h_rest, a_rest, neutral):
    """b2b flags, rest difference and neutral site, as prep.py builds them."""
    h = float(h_rest)
    a = float(a_rest)
    return {
        "h_b2b": int(h == 1),
        "a_b2b": int(a == 1),
        "rest_d": float(np.clip(h, 1, 4) - np.clip(a, 1, 4)),
        "neutral": int(0 if pd.isna(neutral) else neutral),
    }


def build_feature_frame(box, games, availability=None):
    """Game-level frame matching features.py's out/features.parquet contents.

    `games` is the games table (final and scheduled). Completed games with a
    score are the rows. Rest uses final and scheduled games. `availability`
    is {(espn_event_id, team_id): {athlete_id: status}} from the injury
    report. With none, version B is the who-played pool.
    """
    P, _states, prior = player_rates(box)
    if not len(P):
        return pd.DataFrame(), prior
    T = team_table(P, prior, availability)
    G = games.loc[(games["league"] == "nba") & (games["completed"] == 1)
                  & games["home_score"].notna()].copy()
    keep = ["espn_event_id", "season", "season_type", "game_date", "start_time_utc",
            "home_team_id", "away_team_id", "home_score", "away_score", "neutral_site"]
    G = G[[c for c in keep if c in G.columns]].copy()
    G["home_team_id"] = G.home_team_id.astype(int)
    G["away_team_id"] = G.away_team_id.astype(int)
    if not len(T):
        return pd.DataFrame(), prior
    T["team_id"] = T.team_id.astype(int)
    H = T.add_prefix("h_").rename(columns={"h_espn_event_id": "espn_event_id",
                                           "h_team_id": "home_team_id"})
    A_ = T.add_prefix("a_").rename(columns={"a_espn_event_id": "espn_event_id",
                                            "a_team_id": "away_team_id"})
    X = G.merge(H, on=["espn_event_id", "home_team_id"]).merge(
        A_, on=["espn_event_id", "away_team_id"])
    rest = rest_table(games)
    X["h_rest"] = X.espn_event_id.map(rest.h_rest) if len(rest) else np.nan
    X["a_rest"] = X.espn_event_id.map(rest.a_rest) if len(rest) else np.nan
    X["h_rest"] = X.h_rest.fillna(7).clip(0, 7)
    X["a_rest"] = X.a_rest.fillna(7).clip(0, 7)
    X["y"] = (X.home_score > X.away_score).astype(int)
    X["margin"] = X.home_score - X.away_score
    from . import travel
    X = travel.merge_travel(X, games)
    X.attrs["prior"] = prior
    return X, prior


def build_matrix(X, version):
    """Home-minus-away design matrix for one version, as prep.py writes it.

    Rows with a missing aggregate are dropped. `train_ok` marks games on or
    after 2021-12-01; the fit applies that filter itself.
    """
    if X is None or not len(X):
        return pd.DataFrame()
    X = X.sort_values("start_time_utc").reset_index(drop=True)
    base = sorted({c[4:] for c in X.columns if c.startswith("h_A_")} - {"n_players"})
    if not base:
        base = sorted(set(diff_feature_names()) - set(CTX_COLS))
        base = [c[2:] for c in base if c.startswith("d_")]
    M = pd.DataFrame({f"d_{b}": X[f"h_{version}_{b}"] - X[f"a_{version}_{b}"] for b in base})
    ctx = pd.DataFrame({
        "h_b2b": (X.h_rest == 1).astype(int),
        "a_b2b": (X.a_rest == 1).astype(int),
        "rest_d": X.h_rest.clip(1, 4) - X.a_rest.clip(1, 4),
        "neutral": X.neutral_site.fillna(0).astype(int),
    })
    id_cols = [c for c in ("espn_event_id", "season", "game_date", "y", "margin") if c in X.columns]
    M = pd.concat([X[id_cols].reset_index(drop=True), M, ctx], axis=1)
    M["train_ok"] = pd.to_datetime(X["game_date"]).reset_index(drop=True) >= pd.Timestamp(TRAIN_FROM)
    return M.dropna().reset_index(drop=True)


def training_rows(M, fit_date):
    """Games from 2021-12-01 through the day before `fit_date`."""
    if M is None or not len(M):
        return M.iloc[0:0] if M is not None else pd.DataFrame()
    d = pd.to_datetime(M["game_date"])
    start = pd.Timestamp(TRAIN_FROM)
    end = pd.Timestamp(str(fit_date)[:10])
    ok = M["train_ok"].astype(bool) if "train_ok" in M.columns else (d >= start)
    return M.loc[ok & (d >= start) & (d < end)].reset_index(drop=True)


def feature_columns(M):
    return [c for c in M.columns if c.startswith("d_") or c in CTX_COLS]


def make_estimator():
    """The ridge_wf.py estimator: scaler, then L2 logistic with that C grid."""
    from sklearn.linear_model import LogisticRegressionCV
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    clf = LogisticRegressionCV(Cs=np.logspace(-3, 1, 9), cv=5,
                               scoring="neg_log_loss", max_iter=2000)
    return make_pipeline(StandardScaler(), clf)


def _pack_estimator(mdl, columns):
    import sklearn
    scaler = mdl.named_steps["standardscaler"]
    clf = mdl.named_steps["logisticregressioncv"]
    return {
        "features": list(columns),
        "scaler_mean": [float(x) for x in np.ravel(scaler.mean_)],
        "scaler_scale": [float(x) for x in np.ravel(scaler.scale_)],
        "coef": [float(x) for x in np.ravel(clf.coef_)],
        "intercept": float(np.ravel(clf.intercept_)[0]),
        "c_value": float(np.ravel(clf.C_)[0]),
        "sklearn_version": sklearn.__version__,
    }


def fit_matrix(M, fit_date, columns=None):
    """Fit ridge on `training_rows` only. Stored scaler and coef reproduce predict_proba."""
    tr = training_rows(M, fit_date)
    cols = list(columns or feature_columns(tr))
    if len(tr) < 10:
        raise RuntimeError(f"not enough training games ({len(tr)})")
    y = tr["y"].to_numpy(int)
    if len(set(y.tolist())) < 2 or min(np.bincount(y)) < 5:
        raise RuntimeError("training labels need at least 5 games of each class")
    mdl = make_estimator()
    mdl.fit(tr[cols].to_numpy(float), y)
    packed = _pack_estimator(mdl, cols)
    packed["n_games"] = int(len(tr))
    packed["train_dates"] = [str(d)[:10] for d in pd.to_datetime(tr["game_date"])]
    return packed


def predict_stored(fit, X):
    """P(home win) from a stored scaler and coefficient vector.

    `X` is an array shaped (n, n_features) in `fit["features"]` order, or a
    DataFrame with those columns.
    """
    if isinstance(X, pd.DataFrame):
        X = X[list(fit["features"])].to_numpy(float)
    else:
        X = np.asarray(X, float)
    mean = np.asarray(fit["scaler_mean"], float)
    scale = np.asarray(fit["scaler_scale"], float)
    scale = np.where(scale == 0, 1.0, scale)
    z = (X - mean) / scale
    logit = fit["intercept"] + z @ np.asarray(fit["coef"], float)
    return 1.0 / (1.0 + np.exp(-logit))


# Optional one-player minutes edit. The rate edge is shrunk by the minutes
# he plays over a 48-minute prior, then the margin those stored coefficients
# imply is clipped to a quarter of a typical NBA game (SD_MARGIN / 4 = 3.57
# points). The published forecast does not call this.
PLAYER_MIN_PRIOR = 48.0


def _one_player_cap_logit():
    from .margin import SD_MARGIN, SLOPE
    return (SD_MARGIN["nba"] / 4.0) / SLOPE["nba"]


def _clip_player(deltas, fit, side):
    """Scale one player's feature move so the stored fit moves at most the cap."""
    if not deltas or not fit:
        return deltas
    cap = _one_player_cap_logit()
    names = list(fit.get("features") or [])
    scale = list(fit.get("scaler_scale") or [])
    coef = list(fit.get("coef") or [])
    moved = 0.0
    for i, name in enumerate(names):
        if i >= len(coef) or i >= len(scale) or not str(name).startswith("d_"):
            continue
        key = str(name)[2:]
        if key not in deltas:
            continue
        sc = float(scale[i]) or 1.0
        moved += float(coef[i]) * (float(side) * float(deltas[key])) / sc
    if not np.isfinite(moved) or abs(moved) <= cap or cap <= 0:
        return deltas
    factor = cap / abs(moved)
    return {key: value * factor for key, value in deltas.items()}


# ---------------------------------------------------------------- storage

def _jdump(obj):
    return json.dumps(obj, separators=(",", ":"))


def refit_due(conn, today):
    """Monday, or any day no fit is stored. A Monday that already stored both
    versions is not fit again (a same-day rerun)."""
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    try:
        rows = conn.execute("SELECT version, fit_date FROM nba_ridge_fits").fetchall()
    except sqlite3.OperationalError:
        return False
    if not rows:
        return True
    if today.weekday() != 0:
        return False
    have = {r[0] for r in rows if r[1] == today.isoformat()}
    return not {"B", "C"} <= have


def _save_fit(conn, today, version, packed, through):
    conn.execute(
        "INSERT INTO nba_ridge_fits (fit_date, version, train_from, train_through, n_games, "
        "c_value, features, scaler_mean, scaler_scale, coef, intercept, sklearn_version, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (today.isoformat(), version, TRAIN_FROM, through, packed["n_games"], packed["c_value"],
         _jdump(packed["features"]), _jdump(packed["scaler_mean"]), _jdump(packed["scaler_scale"]),
         _jdump(packed["coef"]), packed["intercept"], packed["sklearn_version"],
         datetime.now(timezone.utc).isoformat(timespec="seconds")))


def load_box(conn, through):
    return pd.read_sql_query(
        "SELECT espn_event_id, season, season_type, game_date, team_id, athlete_id, "
        "did_not_play, minutes, pts, fgm, fga, fg3a, ftm, fta, oreb, dreb, ast, tov, "
        "stl, blk, pf, plus_minus FROM player_game_nba "
        "WHERE season_type IN (2, 3) AND game_date <= ?",
        conn, params=(through,))


def load_games(conn):
    games = pd.read_sql_query(
        "SELECT espn_event_id, league, season, season_type, game_date, start_time_utc, "
        "home_team_id, away_team_id, home_score, away_score, completed, status, neutral_site, "
        "venue FROM games WHERE league = 'nba'", conn)
    from . import travel
    return travel.attach_coords(games, conn)


def _utc_stamp(value):
    if value is None or value == "" or (isinstance(value, float) and value != value):
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        stamp = datetime.fromisoformat(text)
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp


def load_training_status(conn, games):
    """{(event, team): {athlete: status}} from reports published before tip.

    The latest status whose time is strictly before the game's start is kept.
    A player the report does not name is absent, and training falls back to
    who played. A report with no usable rows, or a missing table, returns {}.
    """
    from .injstatus import norm_report_status
    try:
        rows = conn.execute(
            "SELECT espn_event_id, game_date, team_id, athlete_id, status, player_key, valid_from "
            "FROM nba_injury_states").fetchall()
    except sqlite3.OperationalError:
        return {}
    if not rows or games is None or not len(games):
        return {}
    starts = {}
    by_team_date = {}
    for r in games.itertuples(index=False):
        if getattr(r, "league", "nba") != "nba":
            continue
        eid = int(r.espn_event_id)
        start = _utc_stamp(getattr(r, "start_time_utc", None))
        starts[eid] = start
        gd = str(r.game_date)[:10]
        for tm in (int(r.home_team_id), int(r.away_team_id)):
            by_team_date[(gd, tm)] = (eid, start)
    best = {}
    for r in rows:
        if r["player_key"] == NOT_YET or (r["status"] or "") == "NOT YET SUBMITTED":
            continue
        if r["athlete_id"] is None or r["team_id"] is None:
            continue
        st = norm_report_status(r["status"])
        if st is None:
            continue
        eid = r["espn_event_id"]
        if eid is not None and int(eid) in starts:
            eid = int(eid)
            start = starts[eid]
        else:
            hit = by_team_date.get((str(r["game_date"])[:10], int(r["team_id"])))
            if not hit:
                continue
            eid, start = hit
        vf = _utc_stamp(r["valid_from"])
        if start is None or vf is None or vf >= start:
            continue
        key = (int(eid), int(r["team_id"]), int(r["athlete_id"]))
        cur = best.get(key)
        if cur is None or vf > cur[0]:
            best[key] = (vf, st)
    out = {}
    for (eid, tm, aid), (_vf, st) in best.items():
        out.setdefault((eid, tm), {})[aid] = st
    return out


def refit(conn, today, log=print):
    """Fit ridge B and C on completed games from 2021-12-01 through yesterday.

    A version that cannot be fit is skipped. The previous row for a version
    stays in place when this run does not replace it. Raises when neither
    version fits, so the caller keeps publishing the current path.
    """
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    through = (today - timedelta(days=1)).isoformat()
    box = load_box(conn, through)
    games = load_games(conn)
    X, _prior = build_feature_frame(box, games, load_training_status(conn, games))
    notes, packed_by = [], {}
    for version in ("B", "C"):
        try:
            packed_by[version] = fit_matrix(build_matrix(X, version), today)
        except Exception as e:
            notes.append(f"{version} skipped ({type(e).__name__}: {e})"[:160])
            log(f"nba ridge {version} not fit: {type(e).__name__}: {e}")
    stored = []
    from . import db
    with db.immediate(conn):
        for version, packed in packed_by.items():
            _save_fit(conn, today, version, packed, through)
            stored.append(f"{version} n={packed['n_games']} c={packed['c_value']:g}")
    if not stored:
        raise RuntimeError("; ".join(notes) or "no training games")
    line = "nba ridge " + ", ".join(stored)
    if notes:
        line = line + "; " + "; ".join(notes)
    log(line)
    return line[:300]


def build_state(conn, today, log=print):
    """Replace nba_player_state with pregame sums through yesterday."""
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    through = (today - timedelta(days=1)).isoformat()
    box = load_box(conn, through)
    _P, states, prior = player_rates(box)
    rows = []
    for s in states:
        js = {"sL": s["sL"], "sS": s["sS"], "mL": s["mL"], "mS": s["mS"],
              "tL": s["tL"], "pL": s["pL"], "season": s["season"], "prior": prior}
        rows.append((today.isoformat(), s["athlete_id"], s["team_id"], s["last_game_date"],
                     s["exp_min"], s["prior_min"], _jdump(js)))
    from . import db
    with db.immediate(conn):
        conn.execute("DELETE FROM nba_player_state")
        conn.executemany(
            "INSERT INTO nba_player_state (as_of_date, athlete_id, team_id, last_game_date, "
            "exp_min, prior_min, state_json) VALUES (?,?,?,?,?,?,?)", rows)
    log(f"nba player state {len(rows)} through {through}")
    return len(rows)


def morning(conn, today, log=print):
    """Daily NBA step before apply: refit when due, then replace player state.

    A failure is reported in the returned note and does not raise. The last
    stored fit, and yesterday's state if the new one failed, stay available.
    """
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    parts = []
    if refit_due(conn, today):
        try:
            parts.append(refit(conn, today, log=log))
        except Exception as e:
            parts.append(f"nba ridge refit skipped ({type(e).__name__}: {e})"[:180])
            log(traceback.format_exc())
    try:
        n = build_state(conn, today, log=log)
        parts.append(f"state {n}")
    except Exception as e:
        parts.append(f"nba player state skipped ({type(e).__name__}: {e})"[:180])
        log(traceback.format_exc())
    return "; ".join(p for p in parts if p)[:300]


# ---------------------------------------------------------------- live pool

def _unpack_fit(row):
    return {
        "fit_id": int(row["fit_id"]),
        "version": row["version"],
        "features": json.loads(row["features"]),
        "scaler_mean": json.loads(row["scaler_mean"]),
        "scaler_scale": json.loads(row["scaler_scale"]),
        "coef": json.loads(row["coef"]),
        "intercept": float(row["intercept"]),
        "c_value": row["c_value"],
    }


def load_fits(conn):
    """Latest stored fit per version. Missing table or no rows → {}."""
    try:
        rows = conn.execute(
            "SELECT * FROM nba_ridge_fits ORDER BY fit_date DESC, fit_id DESC").fetchall()
    except sqlite3.OperationalError:
        return {}
    out = {}
    for r in rows:
        if r["version"] not in out:
            out[r["version"]] = _unpack_fit(r)
    return out


def load_state_map(conn):
    """athlete_id → state, and the league prior stored with it."""
    try:
        rows = conn.execute(
            "SELECT athlete_id, team_id, last_game_date, exp_min, prior_min, state_json "
            "FROM nba_player_state").fetchall()
    except sqlite3.OperationalError:
        return {}, None
    out, prior = {}, None
    for r in rows:
        js = json.loads(r["state_json"])
        if prior is None and js.get("prior"):
            prior = {k: float(v) for k, v in js["prior"].items()}
        out[int(r["athlete_id"])] = {
            "team_id": None if r["team_id"] is None else int(r["team_id"]),
            "season": None if js.get("season") is None else int(js["season"]),
            "last": r["last_game_date"],
            "exp_min": None if r["exp_min"] is None else float(r["exp_min"]),
            "sL": js.get("sL") or {}, "sS": js.get("sS") or {},
            "mL": float(js.get("mL") or 0), "mS": float(js.get("mS") or 0),
            "tL": float(js.get("tL") or 0), "pL": float(js.get("pL") or 0),
        }
    return out, prior


def rates_from_state(st, game_date, prior):
    if st is None:
        return decay_rates({}, {}, 0, 0, 0, 0, None, game_date, prior, EXP_MIN_DEFAULT)
    return decay_rates(st["sL"], st["sS"], st["mL"], st["mS"], st["tL"], st["pL"],
                       st["last"], game_date, prior, st["exp_min"])


def decay_exp_min(exp_min, last, game_date, half_life=EXP_MIN_HL):
    """Halve expected minutes every `half_life` days since the last game.

    A missing last game, or a game on or before that date, leaves the value
    unchanged. None stays None. The floor of 1 is applied by the caller.
    """
    if exp_min is None:
        return None
    value = float(exp_min)
    if last is None or game_date is None:
        return value
    delta = (pd.Timestamp(game_date).normalize() - pd.Timestamp(last).normalize()).days
    if delta <= 0:
        return value
    return value * (0.5 ** (delta / float(half_life)))


def _ids_played(played, team, season):
    """Athlete ids with minutes > 0 for this team in this season."""
    if not played:
        return set()
    tm, sn = int(team), int(season)
    return {int(a) for a, t, s in played if int(t) == tm and int(s) == sn}


def no_season_share(frame, team, season, played):
    """Share of minute weight on players with no game for this team this season.

    None when the side has no positive weight.
    """
    if frame is None or not len(frame):
        return None
    w = np.asarray(frame["w"], float)
    total = float(np.nansum(w))
    if not np.isfinite(total) or total <= 0:
        return None
    current = _ids_played(played, team, season)
    aids = np.asarray(frame["athlete_id"], int)
    gone = ~np.isin(aids, list(current))
    return float(w[gone].sum() / total)


def side_usable(frame, share, played, team, season):
    """True when version B can publish this side.

    The team needs a current-season box with minutes, and players with no
    such game can hold at most GONE_SHARE_MAX of the minute weight.
    """
    if frame is None or share is None:
        return False
    if not _ids_played(played, team, season):
        return False
    return float(share) <= GONE_SHARE_MAX


def fallback_src(home_ok, away_ok, can_c):
    """ridge_b when both live lineups are usable, else ridge_c or team."""
    if home_ok and away_ok:
        return "ridge_b"
    return "ridge_c" if can_c else "team"


def assemble_side(state, team, season, game_date, version, outs, starters, history,
                  prev_ids, prior, played=()):
    """Players and weights for one team. None when the side cannot be built.

    `history` is {(athlete_id, team_id)} with a box in this season or last.
    `played` is {(athlete_id, team_id, season)} with minutes > 0. Version B
    auto-includes a player only when his latest box is still with this team
    and he is in `played` for the current season. `prev_ids` is the previous
    rotation, or None when that box is missing. Version C is that rotation
    minus `outs`. A listed starter with no history for the team is weighted
    at 12 minutes.
    """
    if prior is None:
        return None
    rows = []
    if version == "B":
        current = _ids_played(played, team, season)
        auto = [aid for aid, st in state.items()
                if st.get("team_id") == int(team)
                and int(aid) in current
                and aid not in outs]
        ids = list(auto)
        for aid in starters:
            if aid not in ids and aid not in outs:
                ids.append(aid)
        auto_set = set(auto)
        for aid in ids:
            st = state.get(aid)
            rates = rates_from_state(st, game_date, prior)
            if aid not in auto_set and (aid, int(team)) not in history:
                rates["exp_min"] = EXP_MIN_DEFAULT
            elif st is None or st.get("exp_min") is None:
                rates["exp_min"] = EXP_MIN_DEFAULT
            else:
                decayed = decay_exp_min(st.get("exp_min"), st.get("last"), game_date)
                rates["exp_min"] = EXP_MIN_DEFAULT if decayed is None else decayed
            rates["w"] = max(float(rates["exp_min"]), 1.0)
            rates["athlete_id"] = int(aid)
            rows.append(rates)
    else:
        if prev_ids is None:
            return None
        for aid in prev_ids:
            if int(aid) in outs:
                continue
            rates = rates_from_state(state.get(int(aid)), game_date, prior)
            rates["w"] = max(float(rates["exp_min"]), 1.0)
            rates["athlete_id"] = int(aid)
            rows.append(rates)
    if not rows:
        return None
    return pd.DataFrame(rows)


def model_src(home_cov, away_cov, fits, home_prev, away_prev):
    """ridge_b, ridge_c, or team. See the module docstring."""
    if home_prev is None or away_prev is None:
        return "team"
    version = "B" if home_cov == "submitted" and away_cov == "submitted" else "C"
    if version not in fits:
        return "team"
    return "ridge_b" if version == "B" else "ridge_c"


def _side_features(frame, prior):
    if frame is None:
        return None
    feats = agg_keys(_metrics(prior))
    return team_agg(frame, "w", feats)


def _logit(p):
    p = float(np.clip(p, 1e-4, 1 - 1e-4))
    return float(np.log(p / (1 - p)))


def shift_margin(team_prob, team_spread, total, home_tp, away_tp, ridge_prob):
    """Move the current path's margin onto the ridge chance.

    SLOPE points per unit of home logit, then the same favorite check as
    forecast.carry_margin: a margin that names the other side becomes the
    margin the published chance implies. Team totals follow. The total does not.
    """
    from .margin import SLOPE
    s = SLOPE["nba"]
    p = float(np.round(np.clip(ridge_prob, 0.0001, 0.9999), 4))
    m0 = -float(team_spread)
    m = m0 + s * (_logit(p) - _logit(team_prob))
    fav = float(np.sign(np.round(p - 0.5, 4)))
    if fav != 0 and float(np.sign(m)) != fav:
        m = s * _logit(p)
    if not np.isfinite(m0):
        m = m0
    spread = float(np.round(-m, 1)) if np.isfinite(m) else float(team_spread)
    ht, at = home_tp, away_tp
    if np.isfinite(total) and np.isfinite(m0) and np.isfinite(m) and np.round(m, 1) != np.round(m0, 1):
        t = float(total)
        home = float(np.clip((t + m) / 2, 0, t))
        ht = float(np.round(home, 1))
        at = float(np.round(t - home, 1))
    return p, spread, ht, at


def inputs_key(conn):
    """League fingerprint of the injury report and the lineup states."""
    parts = []
    for sql in ("SELECT MAX(valid_from) FROM nba_injury_states",
                "SELECT MAX(valid_from) FROM nba_lineup_states"):
        try:
            parts.append(str(conn.execute(sql).fetchone()[0]))
        except sqlite3.Error:
            parts.append("-")
    return "|".join(parts)


def _coverage(rows):
    """(submitted|not_yet|none, report slot) from one team's open report rows."""
    if rows is None or not len(rows):
        return "none", "none"
    key = rows["player_key"].astype(str) if "player_key" in rows.columns else ""
    status = rows["status"].astype(str) if "status" in rows.columns else ""
    nys = (key == NOT_YET) | (status == "NOT YET SUBMITTED")
    slot = "none"
    if "report_slot" in rows.columns and rows["report_slot"].notna().any():
        slot = str(rows["report_slot"].dropna().astype(str).max())
    if bool(np.all(nys.to_numpy())) if hasattr(nys, "to_numpy") else False:
        return "not_yet", slot
    if hasattr(nys, "any") and bool(nys.any()):
        return "not_yet", slot
    return "submitted", slot


def _open_rows(df, as_of):
    if df is None or not len(df):
        return df.iloc[0:0] if df is not None else pd.DataFrame()
    t = str(as_of)
    ok = (df["valid_from"] <= t) & (df["valid_to"].isna() | (df["valid_to"] > t))
    return df.loc[ok]


def _load_report(conn, event_ids, as_of):
    if not event_ids:
        return {}
    ids = ",".join(str(int(e)) for e in event_ids)
    try:
        df = pd.read_sql_query(
            "SELECT espn_event_id, team_id, athlete_id, status, player_key, report_slot, "
            f"valid_from, valid_to FROM nba_injury_states WHERE espn_event_id IN ({ids})", conn)
    except (sqlite3.OperationalError, pd.errors.DatabaseError):
        return {}
    df = _open_rows(df, as_of)
    out = {}
    if not len(df):
        return out
    for eid, g in df.groupby(df["espn_event_id"].astype(int)):
        out[int(eid)] = g
    return out


def _load_lineups(conn, event_ids, as_of):
    if not event_ids:
        return {}
    ids = ",".join(str(int(e)) for e in event_ids)
    try:
        df = pd.read_sql_query(
            "SELECT espn_event_id, team_id, athlete_id, valid_from, valid_to "
            f"FROM nba_lineup_states WHERE espn_event_id IN ({ids})", conn)
    except (sqlite3.OperationalError, pd.errors.DatabaseError):
        return {}
    df = _open_rows(df, as_of)
    df = df.dropna(subset=["athlete_id"])
    out = {}
    for eid, team, aid in zip(df.get("espn_event_id", []), df.get("team_id", []),
                              df.get("athlete_id", [])):
        if pd.isna(eid) or pd.isna(team):
            continue
        out.setdefault((int(eid), int(team)), [])
        a = int(aid)
        if a not in out[(int(eid), int(team))]:
            out[(int(eid), int(team))].append(a)
    return out


def _load_history(conn, teams, seasons, before):
    """(history, played) from player_game_nba before `before`.

    history is {(athlete_id, team_id)} with any box in the given seasons
    (this season or last). A listed starter with no such row is weighted at
    12 minutes. played is {(athlete_id, team_id, season)} with minutes > 0.
    The live lineup auto-includes only the current-season part of that set.
    One query: state stores the latest team only, so it cannot say whether
    a departed player appeared for this team this season.
    """
    if not teams or not seasons:
        return set(), set()
    t = ",".join(str(int(x)) for x in teams)
    s = ",".join(str(int(x)) for x in seasons)
    try:
        rows = conn.execute(
            "SELECT athlete_id, team_id, season, "
            "MAX(CASE WHEN minutes > 0 AND COALESCE(did_not_play, 0) = 0 "
            "THEN 1 ELSE 0 END) "
            "FROM player_game_nba "
            f"WHERE team_id IN ({t}) AND season IN ({s}) AND season_type IN (2, 3) "
            "AND game_date < ? "
            "GROUP BY athlete_id, team_id, season", (before,)).fetchall()
    except sqlite3.OperationalError:
        return set(), set()
    history, played = set(), set()
    for aid, tm, season, flag in rows:
        history.add((int(aid), int(tm)))
        if int(flag or 0):
            played.add((int(aid), int(tm), int(season)))
    return history, played


def _load_prev(conn, teams, before):
    """team → list of (game_date, season, espn_event_id) newest last, and
    {(event, team): [athlete ids with minutes > 0]}."""
    if not teams:
        return {}, {}
    t = ",".join(str(int(x)) for x in teams)
    try:
        games = conn.execute(
            "SELECT team_id, espn_event_id, season, game_date FROM player_game_nba "
            f"WHERE team_id IN ({t}) AND season_type IN (2, 3) AND game_date < ? "
            "GROUP BY team_id, espn_event_id, season, game_date", (before,)).fetchall()
        played = conn.execute(
            "SELECT team_id, espn_event_id, athlete_id FROM player_game_nba "
            f"WHERE team_id IN ({t}) AND season_type IN (2, 3) AND game_date < ? "
            "AND minutes > 0 AND COALESCE(did_not_play, 0) = 0", (before,)).fetchall()
    except sqlite3.OperationalError:
        return {}, {}
    by_team = {}
    for tm, eid, season, gd in games:
        by_team.setdefault(int(tm), []).append((str(gd), int(season), int(eid)))
    for tm in by_team:
        by_team[tm].sort()
    rot = {}
    for tm, eid, aid in played:
        rot.setdefault((int(eid), int(tm)), []).append(int(aid))
    return by_team, rot


def qualifying_prev(history, game_date, season):
    """(event id, rotation-ready flag) of the previous box in this season or last.

    None when the team has no box, or the latest box is older than last season.
    """
    if not history:
        return None
    gd = str(game_date)[:10]
    earlier = [h for h in history if h[0] < gd]
    if not earlier:
        return None
    last = earlier[-1]
    if last[1] < int(season) - 1:
        return None
    return last[2]


def _team_vector(home_agg, away_agg, h_rest, a_rest, neutral, columns):
    if home_agg is None or away_agg is None:
        return None
    ctx = context_row(h_rest, a_rest, neutral)
    base = {}
    for k, hv in home_agg.items():
        if k == "n_players":
            continue
        base[f"d_{k}"] = hv - away_agg.get(k, np.nan)
    base.update(ctx)
    try:
        x = np.array([float(base[c]) for c in columns], float)
    except KeyError:
        return None
    if not np.isfinite(x).all():
        return None
    return x


def _prepare_slate(conn, frame, as_of):
    """Shared reads for a forecast frame. Returns a dict the row loop closes over."""
    eids = [int(e) for e in frame["espn_event_id"].tolist()]
    teams = sorted({int(t) for t in list(frame["home_team_id"]) + list(frame["away_team_id"])})
    seasons = sorted({int(s) for s in frame["season"].tolist()})
    season_set = set()
    for s in seasons:
        season_set.add(s)
        season_set.add(s - 1)
    before = str(pd.to_datetime(frame["game_date"]).max().date() + timedelta(days=1)) if len(frame) else "9999-12-31"
    # game_date < before includes the day of the latest game on the slate, so a
    # previous box on an earlier date is visible. The per-game filter is strict.
    fits = load_fits(conn)
    state, prior = load_state_map(conn)
    history, played = _load_history(conn, teams, season_set, before)
    try:
        games = load_games(conn)
    except (sqlite3.OperationalError, pd.errors.DatabaseError):
        games = pd.DataFrame()
    rest = rest_table(games) if len(games) else pd.DataFrame(columns=["h_rest", "a_rest"])
    return {
        "fits": fits, "state": state, "prior": prior, "rest": rest,
        "report": _load_report(conn, eids, as_of),
        "lineups": _load_lineups(conn, eids, as_of),
        "history": history, "played": played,
        "prev": _load_prev(conn, teams, before),
        "key": inputs_key(conn),
    }


def _share_text(share):
    if share is None or not np.isfinite(share):
        return "na"
    return f"{float(share):.4f}"


def _log_lineup(log, eid, home, h_share, away, a_share, src):
    """One line per side: the share of weight with no game for that team this season."""
    if log is None:
        return
    label = "ridge_b" if src == "ridge_b" else f"fallback {src}"
    log(f"nba lineup event={eid} team={home} no_season_share={_share_text(h_share)} {label}")
    log(f"nba lineup event={eid} team={away} no_season_share={_share_text(a_share)} {label}")


def _b_side(slate, team, season, game_date, outs, starters):
    played = slate.get("played") or ()
    frame = assemble_side(
        slate["state"], team, season, game_date, "B", outs, starters,
        slate["history"], None, slate["prior"], played)
    share = no_season_share(frame, team, season, played)
    return frame, share, side_usable(frame, share, played, team, season)


def _c_side(slate, team, season, game_date, prev_id, rots, outs):
    prev = None if prev_id is None else rots.get((prev_id, int(team)), [])
    return assemble_side(
        slate["state"], team, season, game_date, "C", outs, [],
        slate["history"], prev, slate["prior"])


def _score_row(row, slate, log=None):
    """Audit fields, and the published prob and spread when the ridge runs.

    The current path's home_prob / home_spread / total are the inputs. They
    are left unchanged when the source is team.
    """
    eid = int(row["espn_event_id"])
    home, away = int(row["home_team_id"]), int(row["away_team_id"])
    season = int(row["season"])
    gd = str(row["game_date"])[:10]
    team_prob = float(row["home_prob"])
    rep = slate["report"].get(eid, pd.DataFrame())
    def team_rows(tm):
        if rep is None or not len(rep) or "team_id" not in rep.columns:
            return rep.iloc[0:0] if rep is not None and len(getattr(rep, "columns", [])) else pd.DataFrame()
        return rep[rep["team_id"].astype(float) == tm]
    h_cov, h_slot = _coverage(team_rows(home))
    a_cov, a_slot = _coverage(team_rows(away))
    prev_games, rots = slate["prev"]
    h_prev = qualifying_prev(prev_games.get(home), gd, season)
    a_prev = qualifying_prev(prev_games.get(away), gd, season)
    src = model_src(h_cov, a_cov, slate["fits"], h_prev, a_prev)
    h_st = slate["lineups"].get((eid, home), [])
    a_st = slate["lineups"].get((eid, away), [])
    inputs = (f"k={slate['key']};report={h_slot}/{a_slot};"
              f"lineup={','.join(str(a) for a in sorted(h_st))}|"
              f"{','.join(str(a) for a in sorted(a_st))}")
    base = {"nba_model_src": "team", "nba_team_prob": team_prob, "nba_ridge_prob": None,
            "nba_ridge_fit_id": None, "nba_inputs": inputs}
    if src == "team" or slate["prior"] is None:
        return base
    outs_h, outs_a = set(), set()
    if len(rep):
        sel = rep[rep["status"].isin(NBA_OUT) & rep["athlete_id"].notna()]
        for tm, aid in zip(sel["team_id"].astype(int), sel["athlete_id"].astype(int)):
            (outs_h if tm == home else outs_a if tm == away else set()).add(aid)
    h_sit, h_back, a_sit, a_back = _toggle_sets(slate, home, away, outs_h, outs_a)
    h_frame = a_frame = None
    if src == "ridge_b":
        h_frame, h_share, h_ok = _b_side(slate, home, season, gd, outs_h, h_st)
        a_frame, a_share, a_ok = _b_side(slate, away, season, gd, outs_a, a_st)
        can_c = "C" in slate["fits"] and h_prev is not None and a_prev is not None
        src = fallback_src(h_ok, a_ok, can_c)
        _log_lineup(log, eid, home, h_share, away, a_share, src)
        if src != "ridge_b":
            h_frame = a_frame = None
        if src == "team":
            return base
    version = "B" if src == "ridge_b" else "C"
    fit = slate["fits"][version]
    if version == "C":
        h_frame = _c_side(slate, home, season, gd, h_prev, rots, outs_h)
        a_frame = _c_side(slate, away, season, gd, a_prev, rots, outs_a)
    scales = (slate.get("scenario") or {}).get("scale") or {}
    h_frame = _scale_rates(h_frame, scales)
    a_frame = _scale_rates(a_frame, scales)
    h_agg = _side_features(h_frame, slate["prior"])
    a_agg = _side_features(a_frame, slate["prior"])
    minutes = ((slate.get("scenario") or {}).get("line") or {}).get("min") or {}
    if h_sit or h_back:
        h_agg = _nudge_rates(
            h_agg, h_frame, h_sit, h_back, slate.get("state"), slate["prior"],
            gd, scales, fit, 1)
    if a_sit or a_back:
        a_agg = _nudge_rates(
            a_agg, a_frame, a_sit, a_back, slate.get("state"), slate["prior"],
            gd, scales, fit, -1)
    if minutes:
        h_agg = _nudge_minutes(
            h_agg, h_frame, minutes, slate.get("state"), slate["prior"],
            gd, scales, fit, 1, home)
        a_agg = _nudge_minutes(
            a_agg, a_frame, minutes, slate.get("state"), slate["prior"],
            gd, scales, fit, -1, away)
    rest = slate["rest"]
    if len(rest) and eid in rest.index:
        h_rest, a_rest = float(rest.at[eid, "h_rest"]), float(rest.at[eid, "a_rest"])
    else:
        h_rest = a_rest = 7.0
    neutral = row["neutral_site"] if "neutral_site" in row.index else 0
    x = _team_vector(h_agg, a_agg, h_rest, a_rest, neutral, fit["features"])
    if x is None:
        return base
    p = float(predict_stored(fit, x.reshape(1, -1))[0])
    new_p, spread, ht, at = shift_margin(
        team_prob, row["home_spread"], row["total_pred"],
        row["home_total_pred"], row["away_total_pred"], p)
    return {"nba_model_src": src, "nba_team_prob": team_prob, "nba_ridge_prob": new_p,
            "nba_ridge_fit_id": fit["fit_id"], "nba_inputs": inputs,
            "home_prob": new_p, "home_spread": spread,
            "home_total_pred": ht, "away_total_pred": at}


_RATE_SCALE = {
    "pts": ("pts_L", "pts_S"),
    "reb": ("oreb_L", "oreb_S", "dreb_L", "dreb_S"),
    "ast": ("ast_L", "ast_S"),
    "tov": ("tov_L", "tov_S"),
    "stocks": ("stl_L", "stl_S", "blk_L", "blk_S"),
}


def _toggle_sets(slate, home, away, outs_h, outs_a):
    """Who a toggle sits, and who it puts back, without changing the lineup.

    The lineup stays the one the forecast already scored. The rate nudge
    then adds or removes that player's edge over a replacement. Taking him
    out of the lineup and renormalizing the others makes a bench player
    help his team, and puts an already-out player back as a loss.
    """
    toggles = {int(a) for a in ((slate.get("scenario") or {}).get("toggle") or ())}
    state = slate.get("state") or {}
    h_sit, h_back, a_sit, a_back = set(), set(), set(), set()
    for aid in toggles:
        st = state.get(aid)
        if not st or st.get("team_id") is None:
            continue
        tm = int(st["team_id"])
        if tm == int(home):
            bag, sit, back = outs_h, h_sit, h_back
        elif tm == int(away):
            bag, sit, back = outs_a, a_sit, a_back
        else:
            continue
        (back if aid in bag else sit).add(aid)
    return h_sit, h_back, a_sit, a_back


def _scaled_map(rates, scales):
    frame = _scale_rates(pd.DataFrame([dict(rates)]), scales)
    if frame is None or not len(frame):
        return dict(rates)
    return frame.iloc[0].to_dict()


def _add_edge(out, row, prior_row, share, shrink_min, fit, side):
    """Add one player's rate edge times `share`, then shrink and cap it.

    `share` is signed: negative sits him. A player at or below the points
    prior is left alone, so a bench player cannot help his team. The edge
    is shrunk by minutes / (minutes + 48) and clipped to 3.57 points.
    """
    try:
        pts = float(row.get("pts_S"))
        floor = float(prior_row.get("pts_S"))
    except (TypeError, ValueError):
        return
    if not np.isfinite(pts) or not np.isfinite(floor) or pts <= floor + 1e-9:
        return
    if not np.isfinite(share) or share == 0:
        return
    shrink = 1.0
    if shrink_min is not None and np.isfinite(float(shrink_min)) and float(shrink_min) >= 0:
        shrink = float(shrink_min) / (float(shrink_min) + PLAYER_MIN_PRIOR)
    deltas = {}
    for key in list(out):
        if key in ("unknown_share", "top3_gmsc", "n_players"):
            continue
        if key not in row or key not in prior_row:
            continue
        try:
            player = float(row[key])
            repl = float(prior_row[key])
            current = float(out[key])
        except (TypeError, ValueError):
            continue
        if not all(np.isfinite(v) for v in (player, repl, current)):
            continue
        scale = 1.0 if key == "ts_L" else 5.0
        deltas[key] = share * (player - repl) * scale * shrink
    for key, raw in _clip_player(deltas, fit, side).items():
        try:
            out[key] = float(out[key]) + raw
        except (TypeError, ValueError):
            continue


def _frame_rows(frame):
    rows = {}
    weight = 0.0
    if frame is None or not len(frame) or "w" not in frame.columns:
        return rows, weight
    weight = float(frame["w"].sum())
    for _, row in frame.iterrows():
        rows[int(row["athlete_id"])] = row.to_dict()
    return rows, weight


def _nudge_rates(agg, frame, sits, restores, state, prior, game_date, scales,
                 fit=None, side=1):
    """Add a player's edge over replacement. Shares and the top three stay.

    Sitting a player at or below replacement does nothing, so a bench
    player cannot help his team. Putting an above-replacement player back
    adds his edge at his minute share. The unknown share and the top three
    are left as the forecast lineup had them.
    """
    if not agg or prior is None or (not sits and not restores):
        return agg
    prior_row = _scaled_map(rates_from_state(None, game_date, prior), scales)
    out = dict(agg)
    rows, weight = _frame_rows(frame)
    if not np.isfinite(weight) or weight <= 0:
        return agg
    for aid in sits:
        row = rows.get(int(aid))
        if row is None:
            continue
        try:
            played = float(row.get("w") or 0)
        except (TypeError, ValueError):
            continue
        if not np.isfinite(played) or played <= 0:
            continue
        _add_edge(out, row, prior_row, -min(played / weight, 1.0), played, fit, side)
    for aid in restores:
        rates = rates_from_state((state or {}).get(int(aid)), game_date, prior)
        played = max(float(rates.get("exp_min") or 1.0), 1.0)
        rates["w"] = played
        _add_edge(out, _scaled_map(rates, scales), prior_row,
                  min(played / weight, 1.0), played, fit, side)
    return out


def _nudge_minutes(agg, frame, minutes, state, prior, game_date, scales, fit, side, team):
    """Rescore a minute change as that player's edge at the new share.

    The lineup the forecast used stays the base. Only the minutes that
    differ are added, with the same shrink and cap as a toggle.
    """
    if not agg or prior is None or not minutes:
        return agg
    prior_row = _scaled_map(rates_from_state(None, game_date, prior), scales)
    out = dict(agg)
    rows, weight = _frame_rows(frame)
    if not np.isfinite(weight) or weight <= 0:
        return agg
    team = int(team)
    for key, value in minutes.items():
        try:
            aid = int(key)
            mins = float(value)
        except (TypeError, ValueError):
            continue
        if not np.isfinite(mins) or mins < 0 or mins > 48:
            continue
        st = (state or {}).get(aid)
        tm = None if not st or st.get("team_id") is None else int(st["team_id"])
        if tm != team:
            continue
        old = rows.get(aid)
        if old is not None:
            try:
                old_w = float(old.get("w") or 0)
            except (TypeError, ValueError):
                continue
            if not np.isfinite(old_w) or abs(mins - old_w) < 0.5:
                continue
            _add_edge(out, old, prior_row, (mins - old_w) / weight,
                      max(mins, old_w), fit, side)
            continue
        if mins < 0.5:
            continue
        rates = rates_from_state(st, game_date, prior)
        rates["w"] = mins
        _add_edge(out, _scaled_map(rates, scales), prior_row,
                  min(mins / weight, 1.0), mins, fit, side)
    return out


def _scale_rates(frame, scales):
    """Multiply the linked rate columns. A missing scale is 1."""
    if frame is None or not len(frame) or not scales:
        return frame
    frame = frame.copy()
    for key, cols in _RATE_SCALE.items():
        if key not in scales:
            continue
        try:
            mult = float(scales[key])
        except (TypeError, ValueError):
            continue
        for col in cols:
            if col in frame.columns:
                frame[col] = pd.to_numeric(frame[col], errors="coerce") * mult
    return frame


def overlay(conn, frame, as_of, today=None, log=None, scenario=None):
    """Publish the ridge chance on rows where it runs. `frame` is the current path.

    home_prob, home_spread and the team totals are the current NBA path (already
    through carry_margin). Rows that stay on that path keep those numbers and
    are stamped nba_model_src = team. Does not write.
    """
    if frame is None or not len(frame):
        return frame
    f = frame.reset_index(drop=True).copy()
    for c in AUDIT_COLS:
        if c not in f.columns:
            f[c] = None
    if "game_date" not in f.columns and "date" in f.columns:
        f["game_date"] = f["date"].astype(str).str[:10]
    try:
        slate = _prepare_slate(conn, f, as_of)
        if scenario:
            slate["scenario"] = scenario
    except Exception as exc:
        for event_id in _fallback_ids(f):
            _log_fallback("nba", event_id, exc)
        return mark_team(f)
    probs = np.array(f["home_prob"], dtype=float, copy=True)
    for i in range(len(f)):
        try:
            scored = _score_row(f.loc[i], slate, log=log)
        except Exception as exc:
            event_id = f.at[i, "espn_event_id"] if "espn_event_id" in f.columns else "?"
            _log_fallback("nba", event_id, exc)
            scored = {"nba_model_src": "team", "nba_team_prob": float(f.at[i, "home_prob"]),
                      "nba_ridge_prob": None, "nba_ridge_fit_id": None, "nba_inputs": None}
        for k, v in scored.items():
            f.at[i, k] = v
        if "home_prob" in scored:
            probs[i] = scored["home_prob"]
    from .forecast import apply_home_probs
    out = apply_home_probs(f, probs)
    if "away_spread" in out.columns:
        out["away_spread"] = -out["home_spread"]
    return out


def _log_fallback(league, event_id, exc):
    logging.getLogger(__name__).warning(
        "%s player fallback event %s: %s: %s",
        league, event_id, type(exc).__name__, exc)


def _fallback_ids(frame):
    if frame is not None and "espn_event_id" in frame.columns:
        return list(frame["espn_event_id"])
    return ["?"]


def mark_team(forecast):
    """Stamp the current path as the published NBA source. Probabilities stay."""
    if forecast is None or not len(forecast):
        return forecast
    f = forecast.copy()
    f["nba_model_src"] = "team"
    f["nba_team_prob"] = f["home_prob"].to_numpy(float)
    f["nba_ridge_prob"] = np.nan
    f["nba_ridge_fit_id"] = np.nan
    if "nba_inputs" not in f.columns:
        f["nba_inputs"] = None
    return f


def apply(conn, sched, forecast, as_of, today, log=None):
    """Forecast frame, row-aligned with `sched`, after the current path and carry_margin."""
    if forecast is None or not len(forecast):
        return forecast
    f = forecast.reset_index(drop=True).copy()
    s = sched.reset_index(drop=True)
    if len(f) != len(s):
        raise RuntimeError("forecast rows do not match schedule rows")
    f["espn_event_id"] = s["espn_event_id"].to_numpy()
    f["season"] = s["season"].to_numpy()
    f["game_date"] = s["date"].astype(str).str[:10].to_numpy()
    f["home_team_id"] = s["home_team"].astype(int).to_numpy()
    f["away_team_id"] = s["away_team"].astype(int).to_numpy()
    if "neutral" in s.columns:
        f["neutral_site"] = s["neutral"].to_numpy()
    elif "neutral_site" in s.columns:
        f["neutral_site"] = s["neutral_site"].to_numpy()
    return overlay(conn, f, as_of, today, log=log)


# ---------------------------------------------------------------- refresh

def _ridge_current(series, key):
    return str(series or "").startswith(f"k={key};")


def refresh(conn, now=None, log=print, force=False):
    """Recompute the NBA chance for games that have not started and are not locked.

    The current path (including its injury term) is rebuilt from the stored
    pre-player values, then the ridge replaces the published chance where it
    runs. Past forecast_snapshots rows and existing locks are not read.
    `force` recomputes even when the report and lineup fingerprints match,
    which is how a new fit reaches today's unlocked games.
    """
    from . import player_adj as pa
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    as_of = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    today = now.astimezone(pa.CHICAGO).date().isoformat()
    key = pa.inputs_key(conn, "nba", today)
    ridge_key = inputs_key(conn)
    total = 0
    state = None
    for table, where, pk in pa.REFRESH_TABLES:
        try:
            rows = pd.read_sql_query(
                f"SELECT f.*, g.season, g.start_time_utc, g.neutral_site FROM {table} f "
                "JOIN games g ON g.espn_event_id = f.espn_event_id "
                f"WHERE {where}f.league = :lg AND f.player_prob_base IS NOT NULL "
                "AND g.completed = 0 AND f.espn_event_id NOT IN "
                "(SELECT espn_event_id FROM forecast_locks)", conn,
                params={"today": today, "lg": "nba"})
        except (sqlite3.OperationalError, pd.errors.DatabaseError):
            continue
        if not len(rows):
            continue
        st = pd.to_datetime(rows["start_time_utc"], utc=True)
        rows = rows[(st - pd.Timestamp(now).tz_convert("UTC")) > pa.LOCK_MARGIN].reset_index(drop=True)
        if not len(rows):
            continue
        if not force:
            player_same = bool((rows["player_inputs"] == key).all())
            # Null nba_inputs means the row was saved before the ridge. A
            # passive refresh does not backfill it; the next forecast write
            # does. A stamped fingerprint that no longer matches does.
            stamped = "nba_inputs" in rows.columns and bool(rows["nba_inputs"].notna().any())
            if stamped:
                ridge_same = bool(rows["nba_inputs"].map(
                    lambda s: _ridge_current(s, ridge_key)).all())
            else:
                ridge_same = True
            if player_same and ridge_same:
                continue
        if state is None:
            state = pa.STATE_FN["nba"](conn, today)

        def adjust(frame, _as=as_of, _log=log):
            return overlay(conn, frame, _as, log=_log)

        n = pa._refresh_rows(conn, "nba", rows, table, pk, as_of, key, state, adjust=adjust)
        total += n
        if n:
            early = "" if table == "forecast_snapshots" else " early"
            log(f"nba ridge refresh{early}: {n} of {len(rows)} forecasts updated")
    return total or None


def _main(argv=None):
    """Fit both versions, replace player state, and refresh unlocked forecasts.

    Past forecast rows and existing locks are not rewritten. The morning job
    also fits when no fit is stored.
    """
    from . import db
    ap = argparse.ArgumentParser(description="Fit the NBA player ridge and refresh unlocked forecasts")
    ap.add_argument("--db", default="data/bayesratings.db")
    ap.add_argument("--date", default=None, help="run as of YYYY-MM-DD (default: today, CT)")
    args = ap.parse_args(argv)
    from zoneinfo import ZoneInfo
    ct = ZoneInfo("America/Chicago")
    today = date.fromisoformat(args.date) if args.date else datetime.now(ct).date()
    conn = db.connect(args.db)
    db.init_db(conn)
    print(refit(conn, today))
    print(f"state {build_state(conn, today)}")
    n = refresh(conn, datetime.now(timezone.utc), force=True)
    print(f"refreshed {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
