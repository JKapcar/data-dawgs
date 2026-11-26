"""NHL player ridge: the published NHL win chance.

Standalone L2 logistic regression on
skater and goalie aggregates plus rest, back-to-back and neutral site.
No team rating is an input, and nothing is stacked on the ridge chance.

Per game, at forecast time:
  ridge B  both teams have a fresh dressed chart (Daily Faceoff even-strength
           lines) and a Confirmed starting goalie from the same Daily Faceoff
           feed the starter covariate uses (starters.known_starters, source dfo,
           strength Confirmed)
  ridge C  lines or the confirmed goalie are missing: skaters from a fresh
           Daily Faceoff chart when the team has one, otherwise last game's
           skaters with anyone listed out or injured removed, and
           expected_goalie (Confirmed, then Likely, then the ESPN probable,
           then the most-used goalie in the previous 10 starts)
  team     no stored fit for that version, either team has no skater box from
           this season or last, the starter is unknown, a named starter has
           no saved goalie line, or the feature row cannot be built

B's live pool is the pregame stand-in for the skaters who played, which is
what version B trained on: dressed skaters, weighted by expected time on ice.
C's skaters are separate from the confirmed-goalie gate. The C fit is unchanged.

The puck line follows the published chance from the current path's margin at
SLOPE goals per unit of home logit (the carry_margin rule). The total
stays on the current path. Recorded locks and older forecast rows are not
rewritten. A failure publishes the current path and logs the league, the
event id, and the exception.

The training frame also carries travel columns from bayesratings/travel.py
(previous venue, kilometres, time-zone hours, days of rest). They are not
ridge inputs and do not change the published chance.
"""

import argparse
import bisect
import json
import logging
import sqlite3
import traceback
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

TRAIN_FROM = "2021-12-01"
HL_LONG, HL_SHORT = 365.0, 30.0
K_LONG, K_SHORT, K_GOAL = 300.0, 100.0, 1500.0
TEAM_MINUTES = 300.0
UNKNOWN_MIN = 200.0
EWM_ALPHA = 0.3
SV_PRIOR_PENALTY = 0.003
PM_PRIOR = -0.1 / 60.0
REPL_80 = ("g", "a", "shots")
METRICS = ["g", "a", "shots", "shots_missed", "plus_minus", "tg", "blocks",
           "hits", "fo_won", "fo_lost"]
SHORT_METRICS = ["pts", "shots", "plus_minus"]
RATE = [m + "_r" for m in METRICS] + ["ptsS_r", "shotsS_r", "pmS_r"]
TEAM_EXTRA = ["pm_F", "pm_D", "unknown", "gsaa30", "gexp"]
CTX_COLS = ("h_b2b", "a_b2b", "rest_d", "neutral")
LINE_GROUPS = ("f1", "f2", "f3", "f4", "d1", "d2", "d3", "d4")
DRESSED_MIN = 15
FEED_MAX_AGE = timedelta(hours=36)
AUDIT_COLS = ("nhl_model_src", "nhl_ridge_prob", "nhl_team_prob",
              "nhl_ridge_fit_id", "nhl_inputs")
_SKATER_STATS = ("g", "a", "shots", "shots_missed", "plus_minus", "takeaways",
                 "giveaways", "blocks", "hits", "fo_won", "fo_lost")


def team_keys():
    return list(RATE) + list(TEAM_EXTRA)


def diff_feature_names():
    """Home-minus-away columns in the order run_models.py trains on."""
    return [f"d_{b}" for b in sorted(team_keys())] + list(CTX_COLS)


def is_dressed_row(row):
    """Even-strength skater on a Daily Faceoff chart. IR and out are not dressed."""
    group = str(row.get("group_id") or "")
    if group not in LINE_GROUPS:
        return False
    status = str(row.get("injury_status") or "").strip().lower()
    return status != "out"


def is_confirmed_goalie(row):
    """Daily Faceoff strength Confirmed. Likely and Unconfirmed are not."""
    strength = row.get("strength") if isinstance(row, dict) else getattr(row, "strength", None)
    return str(strength or "") == "Confirmed"


def _is_d(position):
    return str(position or "").upper().startswith("D")


def prior_rates(df, key, date, expo, metrics, hl, k, prior, ewm_col=None,
                ewm_alpha=EWM_ALPHA, _ends=None):
    """Decayed, shrunk rate from strictly earlier rows. `_ends` collects the post-game sums."""
    df = df.sort_values([key, date]).reset_index(drop=True)
    d_all = pd.to_datetime(df[date]).values.astype("datetime64[D]").astype(float)
    E = df[expo].values.astype(float)
    V = {m: df[m].values.astype(float) for m in metrics}
    R = {m: np.empty(len(df)) for m in metrics}
    X = np.empty(len(df))
    W = np.full(len(df), np.nan)
    ew = df[ewm_col].values.astype(float) if ewm_col else None
    for pid, idx in df.groupby(key).indices.items():
        s = {m: 0.0 for m in metrics}
        e = 0.0
        last = None
        em = np.nan
        for i in idx:
            if last is not None:
                f = 0.5 ** ((d_all[i] - last) / hl)
                e *= f
                for m in metrics:
                    s[m] *= f
            for m in metrics:
                R[m][i] = (s[m] + k * prior[m]) / (e + k)
            X[i] = e
            W[i] = em
            for m in metrics:
                s[m] += V[m][i]
            e += E[i]
            last = d_all[i]
            if ew is not None:
                em = ew[i] if np.isnan(em) else (1 - ewm_alpha) * em + ewm_alpha * ew[i]
        if _ends is not None:
            _ends.append({
                "athlete_id": int(pid),
                "s": {m: float(s[m]) for m in metrics},
                "e": float(e),
                "em": None if ew is None or np.isnan(em) else float(em),
                "row": int(idx[-1]),
            })
    for m in metrics:
        df[m + "_r"] = R[m]
    df["_expo"] = X
    df["_ewm"] = W
    return df


def _skater_rates(box):
    """Pregame skater rates, the enriched frame features.py builds, and one
    post-game state per skater."""
    if box is None or not len(box):
        return pd.DataFrame(), [], {}
    S = box.copy()
    S = S[S.toi_sec.fillna(0) > 0].copy()
    if not len(S):
        return pd.DataFrame(), [], {}
    S["toi"] = S.toi_sec / 60.0
    S["pts"] = S.g.fillna(0) + S.a.fillna(0)
    S["tg"] = S.takeaways.fillna(0) - S.giveaways.fillna(0)
    for c in METRICS + ["pts"]:
        if c not in S.columns:
            S[c] = 0.0
        S[c] = S[c].fillna(0)
    toi_sum = float(S.toi.sum())
    lgr = {m: float(S[m].sum() / toi_sum) if toi_sum else 0.0 for m in METRICS}
    prior = {m: lgr[m] * (0.8 if m in REPL_80 else 1.0) for m in METRICS}
    prior["plus_minus"] = PM_PRIOR
    short_prior = {"pts": lgr["g"] + lgr["a"], "shots": lgr["shots"], "plus_minus": 0.0}
    ends = []
    S = prior_rates(S, "athlete_id", "game_date", "toi", METRICS, HL_LONG, K_LONG,
                    prior, ewm_col="toi", _ends=ends)
    pos_median = S.groupby("position").toi.transform("median")
    S["exp_toi"] = S._ewm.fillna(pos_median)
    S = S.rename(columns={"_expo": "skater_expo"})
    for en in ends:
        i = en.pop("row")
        en["team_id"] = int(S.at[i, "team_id"])
        pos = S.at[i, "position"]
        en["position"] = None if pd.isna(pos) else str(pos)
        season = S.at[i, "season"] if "season" in S.columns else None
        en["season"] = None if season is None or pd.isna(season) else int(season)
        en["last_game_date"] = str(pd.Timestamp(S.at[i, "game_date"]).date())
        en["exp_toi"] = en.pop("em")
        en["mL"] = en.pop("e")
        en["sL"] = en.pop("s")
        en["is_d"] = _is_d(en["position"])
    sh_ends = []
    sh = prior_rates(
        S[["athlete_id", "game_date", "espn_event_id", "toi", "pts", "shots", "plus_minus"]].copy(),
        "athlete_id", "game_date", "toi", SHORT_METRICS, HL_SHORT, K_SHORT, short_prior,
        _ends=sh_ends)
    S = S.merge(
        sh[["athlete_id", "espn_event_id", "pts_r", "shots_r", "plus_minus_r"]].rename(
            columns={"pts_r": "ptsS_r", "shots_r": "shotsS_r", "plus_minus_r": "pmS_r"}),
        on=["athlete_id", "espn_event_id"])
    S["isD"] = S.position.fillna("").str.upper().str.startswith("D")
    by_short = {e["athlete_id"]: e for e in sh_ends}
    for en in ends:
        sh_en = by_short.get(en["athlete_id"])
        en["sS"] = sh_en["s"] if sh_en else {m: 0.0 for m in SHORT_METRICS}
        en["mS"] = sh_en["e"] if sh_en else 0.0
    is_d = S["isD"].to_numpy(bool)
    group_median = {
        "D": float(S.loc[is_d, "toi"].median()) if is_d.any() else None,
        "F": float(S.loc[~is_d, "toi"].median()) if (~is_d).any() else None,
    }
    meta = {"prior": prior, "short_prior": short_prior, "lgr": lgr,
            "group_median": group_median}
    return S, ends, meta


def _goalie_rates(box):
    if box is None or not len(box):
        return pd.DataFrame(), [], None
    Gl = box.copy()
    Gl = Gl[Gl.sa.fillna(0) >= 0].copy()
    if not len(Gl) or float(Gl.sa.fillna(0).sum()) <= 0:
        return pd.DataFrame(), [], None
    Gl["sv"] = Gl.sv.fillna(Gl.sa - Gl.ga)
    lg_sv = float(Gl.sv.sum() / Gl.sa.sum())
    ends = []
    Gl = prior_rates(Gl, "athlete_id", "game_date", "sa", ["sv"], HL_LONG, K_GOAL,
                     {"sv": lg_sv - SV_PRIOR_PENALTY}, _ends=ends)
    Gl["gsaa30"] = (Gl.sv_r - lg_sv) * 30
    Gl["g_expo"] = np.log1p(Gl._expo)
    for en in ends:
        i = en.pop("row")
        en["team_id"] = int(Gl.at[i, "team_id"])
        en["last_game_date"] = str(pd.Timestamp(Gl.at[i, "game_date"]).date())
        en["s_sv"] = en.pop("s")["sv"]
        en["e_sa"] = en.pop("e")
        en.pop("em", None)
        season = Gl.at[i, "season"] if "season" in Gl.columns else None
        en["season"] = None if season is None or pd.isna(season) else int(season)
    return Gl, ends, lg_sv


def _agg(df, w):
    """TOI-weighted team rates. Weights are rescaled to 300 skater-minutes."""
    w = np.asarray(w, float)
    w = w / w.sum() * TEAM_MINUTES
    out = {c: float((df[c].to_numpy(float) * w).sum() / 60.0) for c in RATE}
    is_d = df.isD.to_numpy(bool)
    pm = df.plus_minus_r.to_numpy(float)
    for name, mask in (("F", ~is_d), ("D", is_d)):
        out[f"pm_{name}"] = float((pm * w * mask).sum() / 60.0)
    out["unknown"] = float((w * (df.skater_expo.to_numpy(float) < UNKNOWN_MIN)).sum() / TEAM_MINUTES)
    return out


def _row_as_series(row):
    if isinstance(row, pd.DataFrame):
        return row.iloc[0]
    return row


def team_features(S, Gl):
    """One row per (event, team) with version A, B and C aggregates.

    A: skaters who played, weighted by the minutes they played.
    B: those same skaters, weighted by expected minutes, plus the starter.
    C: the previous game's skaters, weighted by expected minutes, plus the
    goalie with the most starts in the previous 10. A skater from that game
    who did not play this one keeps the previous game's pregame row.
    """
    if S is None or not len(S) or Gl is None or not len(Gl):
        return pd.DataFrame()
    S = S.copy()
    Gl = Gl.copy()
    for frame in (S, Gl):
        frame["espn_event_id"] = frame.espn_event_id.astype(int)
        frame["team_id"] = frame.team_id.astype(int)
        frame["athlete_id"] = frame.athlete_id.astype(int)
    starters = (Gl[Gl.starter == 1].drop_duplicates(["espn_event_id", "team_id"])
                .set_index(["espn_event_id", "team_id"]))
    team_games = S.groupby(["espn_event_id", "team_id"])
    order = (S[["espn_event_id", "team_id", "game_date"]].drop_duplicates()
             .sort_values(["team_id", "game_date"]))
    order["prev"] = order.groupby("team_id").espn_event_id.shift()
    prev = order.set_index(["espn_event_id", "team_id"]).prev.to_dict()
    Gs = Gl[Gl.starter == 1].sort_values(["team_id", "game_date"])
    cg = {}
    for t, df in Gs.groupby("team_id"):
        ids = df.athlete_id.to_numpy()
        evs = df.espn_event_id.to_numpy()
        for j in range(len(df)):
            last10 = ids[max(0, j - 10):j]
            if len(last10):
                vals, cnt = np.unique(last10, return_counts=True)
                cg[(int(evs[j]), int(t))] = int(vals[cnt.argmax()])
    last_row = {}
    for r in Gl.sort_values("game_date").itertuples(index=False):
        last_row.setdefault(int(r.athlete_id), []).append((r.game_date, r.gsaa30, r.g_expo))

    def goalie_state(aid, when):
        L = last_row.get(int(aid), [])
        i = bisect.bisect_left([x[0] for x in L], when)
        if i < len(L) and L[i][0] == when:
            return L[i][1], L[i][2]
        return (L[i - 1][1], L[i - 1][2]) if i > 0 else (np.nan, np.nan)

    rec = []
    for (ev, tm), df in team_games:
        ev, tm = int(ev), int(tm)
        r = {"espn_event_id": ev, "team_id": tm}
        when = df.game_date.iloc[0]
        for k, v in _agg(df, df.toi).items():
            r["A_" + k] = v
        for k, v in _agg(df, df.exp_toi).items():
            r["B_" + k] = v
        if (ev, tm) in starters.index:
            st = starters.loc[(ev, tm)]
            r["A_gsaa30"] = r["B_gsaa30"] = float(st.gsaa30)
            r["A_gexp"] = r["B_gexp"] = float(st.g_expo)
        pe = prev.get((ev, tm))
        if pe is not None and not (isinstance(pe, float) and np.isnan(pe)):
            pe = int(pe)
        if pe is not None and (pe, tm) in team_games.groups:
            p = team_games.get_group((pe, tm))
            cur = df.set_index("athlete_id")
            rows = []
            for a in p.athlete_id:
                if a in cur.index:
                    rows.append(_row_as_series(cur.loc[a]))
                else:
                    rows.append(p[p.athlete_id == a].iloc[0])
            cdf = pd.DataFrame(rows)
            for k, v in _agg(cdf, cdf.exp_toi).items():
                r["C_" + k] = v
            ga = cg.get((ev, tm))
            if ga is not None:
                gsaa, gexp = goalie_state(ga, when)
                r["C_gsaa30"], r["C_gexp"] = gsaa, gexp
        rec.append(r)
    return pd.DataFrame(rec)


def games_frame(games):
    """Completed non-tie games with rest, as common.games builds them.

    Rest counts final and scheduled games. Missing rest is 7, clipped to 0–14.
    """
    if games is None or not len(games):
        return pd.DataFrame()
    g = games.copy()
    if "league" in g.columns:
        g = g[g.league == "nhl"].copy()
    if not len(g):
        return pd.DataFrame()
    allg = g[g.status.isin(["STATUS_FINAL", "STATUS_SCHEDULED"])].copy()
    allg["date"] = pd.to_datetime(allg.game_date)
    home = (allg[["espn_event_id", "date", "home_team_id"]]
            .rename(columns={"home_team_id": "t"}).assign(h=1))
    away = (allg[["espn_event_id", "date", "away_team_id"]]
            .rename(columns={"away_team_id": "t"}).assign(h=0))
    lo = pd.concat([home, away], ignore_index=True).sort_values(["t", "date"])
    lo["rest"] = (lo.date - lo.groupby("t").date.shift()).dt.days
    rh = lo[lo.h == 1].set_index("espn_event_id").rest
    ra = lo[lo.h == 0].set_index("espn_event_id").rest
    out = g[(g.completed == 1) & g.home_score.notna() & (g.home_score != g.away_score)].copy()
    out["h_rest"] = out.espn_event_id.map(rh).fillna(7).clip(0, 14)
    out["a_rest"] = out.espn_event_id.map(ra).fillna(7).clip(0, 14)
    out["y"] = (out.home_score > out.away_score).astype(int)
    out["margin"] = out.home_score - out.away_score
    out["neutral"] = out.neutral_site.fillna(0).astype(int)
    if "start_time_utc" in out.columns:
        out = out.sort_values("start_time_utc").reset_index(drop=True)
    from . import travel
    return travel.merge_travel(out, g)


def rest_table(games):
    """Home and away rest indexed by espn_event_id. Missing rest is 7."""
    if games is None or not len(games):
        return pd.DataFrame(columns=["h_rest", "a_rest"])
    g = games.copy()
    if "league" in g.columns:
        g = g[g.league == "nhl"]
    allg = g[g.status.isin(["STATUS_FINAL", "STATUS_SCHEDULED"])].copy()
    if not len(allg):
        return pd.DataFrame(columns=["h_rest", "a_rest"])
    allg["date"] = pd.to_datetime(allg.game_date)
    home = (allg[["espn_event_id", "date", "home_team_id"]]
            .rename(columns={"home_team_id": "t"}).assign(h=1))
    away = (allg[["espn_event_id", "date", "away_team_id"]]
            .rename(columns={"away_team_id": "t"}).assign(h=0))
    lo = pd.concat([home, away], ignore_index=True).sort_values(["t", "date"])
    lo["rest"] = (lo.date - lo.groupby("t").date.shift()).dt.days
    rh = lo[lo.h == 1].drop_duplicates("espn_event_id").set_index("espn_event_id")
    ra = lo[lo.h == 0].drop_duplicates("espn_event_id").set_index("espn_event_id")
    out = pd.DataFrame({"espn_event_id": allg["espn_event_id"].unique()})
    out["h_rest"] = out.espn_event_id.map(rh.rest).fillna(7).clip(0, 14)
    out["a_rest"] = out.espn_event_id.map(ra.rest).fillna(7).clip(0, 14)
    return out.set_index("espn_event_id")


def context_row(h_rest, a_rest, neutral):
    h = float(h_rest)
    a = float(a_rest)
    return {
        "h_b2b": int(h == 1),
        "a_b2b": int(a == 1),
        "rest_d": float(np.clip(h, 1, 4) - np.clip(a, 1, 4)),
        "neutral": int(0 if pd.isna(neutral) else neutral),
    }


def build_feature_frame(skaters, goalies, games):
    """Game-level frame matching features.py joined to common.games.

    `games` includes final and scheduled rows (rest uses both). Completed
    non-tie games are the rows.
    """
    S, _ends, meta = _skater_rates(skaters)
    Gl, _gends, lg_sv = _goalie_rates(goalies)
    meta = dict(meta or {})
    meta["lg_sv"] = lg_sv
    if not len(S) or not len(Gl):
        return pd.DataFrame(), meta
    T = team_features(S, Gl)
    G = games_frame(games)
    if not len(T) or not len(G):
        return pd.DataFrame(), meta
    from . import travel
    keep = ["espn_event_id", "season", "season_type", "game_date", "start_time_utc",
            "home_team_id", "away_team_id", "home_score", "away_score", "neutral_site",
            "h_rest", "a_rest", "y", "margin", "neutral", *travel.HOME_AWAY_COLS]
    G = G[[c for c in keep if c in G.columns]].copy()
    G["home_team_id"] = G.home_team_id.astype(int)
    G["away_team_id"] = G.away_team_id.astype(int)
    G["espn_event_id"] = G.espn_event_id.astype(int)
    T["team_id"] = T.team_id.astype(int)
    T["espn_event_id"] = T.espn_event_id.astype(int)
    H = T.add_prefix("h_").rename(columns={"h_espn_event_id": "espn_event_id",
                                           "h_team_id": "home_team_id"})
    A = T.add_prefix("a_").rename(columns={"a_espn_event_id": "espn_event_id",
                                           "a_team_id": "away_team_id"})
    X = G.merge(H, on=["espn_event_id", "home_team_id"]).merge(
        A, on=["espn_event_id", "away_team_id"])
    return X, meta


def build_matrix(X, version):
    """Home-minus-away design matrix for one version, as run_models.py writes it.

    Rows with a missing aggregate are dropped. `train_ok` marks games on or
    after 2021-12-01.
    """
    if X is None or not len(X):
        return pd.DataFrame()
    X = X.sort_values("start_time_utc").reset_index(drop=True)
    prefix = f"h_{version}_"
    base = sorted({c[len(prefix):] for c in X.columns if c.startswith(prefix)})
    if not base:
        return pd.DataFrame()
    M = pd.DataFrame({f"d_{b}": X[f"h_{version}_{b}"] - X[f"a_{version}_{b}"] for b in base})
    ctx = pd.DataFrame({
        "h_b2b": (X.h_rest == 1).astype(int),
        "a_b2b": (X.a_rest == 1).astype(int),
        "rest_d": X.h_rest.clip(1, 4) - X.a_rest.clip(1, 4),
        "neutral": X.neutral.astype(int) if "neutral" in X.columns else X.neutral_site.fillna(0).astype(int),
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
    """The run_models.py estimator: scaler, then L2 logistic with that C grid."""
    from sklearn.linear_model import LogisticRegressionCV
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    clf = LogisticRegressionCV(Cs=np.logspace(-3, 1, 9), cv=5,
                               scoring="neg_log_loss", max_iter=3000)
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
    """P(home win) from a stored scaler and coefficient vector."""
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


def decay_skater(st, game_date, prior, short_prior):
    """Pregame rates at `game_date` from sums stored after the last game."""
    sL = {c: 0.0 for c in METRICS}
    sS = {c: 0.0 for c in SHORT_METRICS}
    mL = mS = 0.0
    if st is not None:
        sL = {c: float(st["sL"].get(c, 0.0)) for c in METRICS}
        sS = {c: float(st["sS"].get(c, 0.0)) for c in SHORT_METRICS}
        mL, mS = float(st["mL"]), float(st["mS"])
        if st.get("last") and game_date is not None:
            delta = (pd.Timestamp(game_date).normalize() - pd.Timestamp(st["last"]).normalize()).days
            fL = 0.5 ** (delta / HL_LONG)
            fS = 0.5 ** (delta / HL_SHORT)
            sL = {c: sL[c] * fL for c in METRICS}
            sS = {c: sS[c] * fS for c in SHORT_METRICS}
            mL *= fL
            mS *= fS
    out = {f"{c}_r": (sL[c] + K_LONG * prior[c]) / (mL + K_LONG) for c in METRICS}
    out["ptsS_r"] = (sS["pts"] + K_SHORT * short_prior["pts"]) / (mS + K_SHORT)
    out["shotsS_r"] = (sS["shots"] + K_SHORT * short_prior["shots"]) / (mS + K_SHORT)
    out["pmS_r"] = (sS["plus_minus"] + K_SHORT * short_prior["plus_minus"]) / (mS + K_SHORT)
    out["skater_expo"] = mL
    return out


def decay_goalie(st, game_date, lg_sv):
    """Goals saved above average per 30 shots, and log shots faced.

    `st` is a saved goalie line. A missing line is not a league-average
    goalie, so this refuses None. The overlay leaves the ridge instead.
    """
    if st is None:
        raise ValueError("decay_goalie requires a saved goalie line")
    s, e = float(st["s_sv"]), float(st["e_sa"])
    if st.get("last") and game_date is not None:
        delta = (pd.Timestamp(game_date).normalize() - pd.Timestamp(st["last"]).normalize()).days
        f = 0.5 ** (delta / HL_LONG)
        s *= f
        e *= f
    sv_r = (s + K_GOAL * (lg_sv - SV_PRIOR_PENALTY)) / (e + K_GOAL)
    return {"gsaa30": (sv_r - lg_sv) * 30.0, "gexp": float(np.log1p(e))}


def _replacement_goalie(starter, game_date, lg_sv, goalies):
    """Replacement save skill, with a real starter's shot volume.

    decay_goalie(None) is the shrinkage save rate and zero shots. That
    shot total is outside the fit, and it can rate the replacement above
    a star. The save rate moves to the prior. The log shots stay with the
    goalie who is sitting, or the median of the goalies on the slate.
    """
    gexp = None
    if starter is not None:
        gexp = decay_goalie(starter, game_date, lg_sv)["gexp"]
    if gexp is None or not np.isfinite(gexp) or gexp <= 0:
        found = []
        for st in (goalies or {}).values():
            got = decay_goalie(st, game_date, lg_sv)["gexp"]
            if got > 0:
                found.append(got)
        gexp = float(np.median(found)) if found else float(np.log1p(K_GOAL))
    return {"gsaa30": -SV_PRIOR_PENALTY * 30.0, "gexp": float(gexp)}


# ---------------------------------------------------------------- storage

def _jdump(obj):
    return json.dumps(obj, separators=(",", ":"))


def refit_due(conn, today):
    """Monday, or any day no fit is stored. A Monday that already stored both
    versions is not fit again."""
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    try:
        rows = conn.execute("SELECT version, fit_date FROM nhl_ridge_fits").fetchall()
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
        "INSERT INTO nhl_ridge_fits (fit_date, version, train_from, train_through, n_games, "
        "c_value, features, scaler_mean, scaler_scale, coef, intercept, sklearn_version, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (today.isoformat(), version, TRAIN_FROM, through, packed["n_games"], packed["c_value"],
         _jdump(packed["features"]), _jdump(packed["scaler_mean"]), _jdump(packed["scaler_scale"]),
         _jdump(packed["coef"]), packed["intercept"], packed["sklearn_version"],
         datetime.now(timezone.utc).isoformat(timespec="seconds")))


def load_skaters(conn, through):
    return pd.read_sql_query(
        "SELECT espn_event_id, season, season_type, game_date, team_id, athlete_id, position, "
        "toi_sec, g, a, shots, shots_missed, plus_minus, takeaways, giveaways, blocks, hits, "
        "fo_won, fo_lost FROM player_game_nhl_skater WHERE game_date <= ?",
        conn, params=(through,))


def load_goalies(conn, through):
    return pd.read_sql_query(
        "SELECT espn_event_id, season, season_type, game_date, team_id, athlete_id, starter, "
        "sa, sv, ga FROM player_game_nhl_goalie WHERE game_date <= ?",
        conn, params=(through,))


def load_games(conn):
    games = pd.read_sql_query(
        "SELECT espn_event_id, league, season, season_type, game_date, start_time_utc, "
        "home_team_id, away_team_id, home_score, away_score, completed, status, neutral_site, "
        "venue FROM games WHERE league = 'nhl'", conn)
    from . import travel
    return travel.attach_coords(games, conn)


def refit(conn, today, log=print):
    """Fit ridge B and C on completed games from 2021-12-01 through yesterday.

    A version that cannot be fit is skipped. The previous row for a version
    stays in place when this run does not replace it. Raises when neither
    version fits, so the caller keeps publishing the current path.
    """
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    through = (today - timedelta(days=1)).isoformat()
    sk = load_skaters(conn, through)
    gl = load_goalies(conn, through)
    games = load_games(conn)
    X, _meta = build_feature_frame(sk, gl, games)
    notes, packed_by = [], {}
    for version in ("B", "C"):
        try:
            packed_by[version] = fit_matrix(build_matrix(X, version), today)
        except Exception as e:
            notes.append(f"{version} skipped ({type(e).__name__}: {e})"[:160])
            log(f"nhl ridge {version} not fit: {type(e).__name__}: {e}")
    stored = []
    from . import db
    with db.immediate(conn):
        for version, packed in packed_by.items():
            _save_fit(conn, today, version, packed, through)
            stored.append(f"{version} n={packed['n_games']} c={packed['c_value']:g}")
    if not stored:
        raise RuntimeError("; ".join(notes) or "no training games")
    line = "nhl ridge " + ", ".join(stored)
    if notes:
        line = line + "; " + "; ".join(notes)
    log(line)
    return line[:300]


def _json_medians(meta):
    out = {}
    for k, v in (meta.get("group_median") or {}).items():
        out[k] = None if v is None or (isinstance(v, float) and np.isnan(v)) else float(v)
    return out


def build_state(conn, today, log=print):
    """Replace skater and goalie state with post-game sums through yesterday."""
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    through = (today - timedelta(days=1)).isoformat()
    _S, sk_ends, meta = _skater_rates(load_skaters(conn, through))
    _G, g_ends, lg_sv = _goalie_rates(load_goalies(conn, through))
    meta = dict(meta or {})
    meta["lg_sv"] = lg_sv
    med = _json_medians(meta)
    sk_rows = []
    for s in sk_ends:
        js = {"sL": s["sL"], "sS": s["sS"], "mL": s["mL"], "mS": s["mS"],
              "season": s["season"], "position": s["position"], "is_d": s["is_d"],
              "prior": meta.get("prior"), "short_prior": meta.get("short_prior"),
              "group_median": med, "lg_sv": lg_sv}
        sk_rows.append((today.isoformat(), s["athlete_id"], s["team_id"], s["last_game_date"],
                        s["exp_toi"], s["mL"], 1 if s["is_d"] else 0, _jdump(js)))
    g_rows = []
    for s in g_ends:
        js = {"s_sv": s["s_sv"], "e_sa": s["e_sa"], "lg_sv": lg_sv, "season": s["season"]}
        g_rows.append((today.isoformat(), s["athlete_id"], s["team_id"], s["last_game_date"],
                       _jdump(js)))
    from . import db
    with db.immediate(conn):
        conn.execute("DELETE FROM nhl_player_state")
        conn.execute("DELETE FROM nhl_goalie_state")
        conn.executemany(
            "INSERT INTO nhl_player_state (as_of_date, athlete_id, team_id, last_game_date, "
            "exp_toi, skater_expo, is_defense, state_json) VALUES (?,?,?,?,?,?,?,?)", sk_rows)
        conn.executemany(
            "INSERT INTO nhl_goalie_state (as_of_date, athlete_id, team_id, last_game_date, "
            "state_json) VALUES (?,?,?,?,?)", g_rows)
    log(f"nhl player state {len(sk_rows)} skaters {len(g_rows)} goalies through {through}")
    return len(sk_rows)


def morning(conn, today, log=print):
    """Daily NHL step before apply: refit when due, then replace player state.

    A failure is reported in the returned note and does not raise. The last
    stored fit, and yesterday's state if the new one failed, stay available.
    """
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    parts = []
    if refit_due(conn, today):
        try:
            parts.append(refit(conn, today, log=log))
        except Exception as e:
            parts.append(f"nhl ridge refit skipped ({type(e).__name__}: {e})"[:180])
            log(traceback.format_exc())
    try:
        n = build_state(conn, today, log=log)
        parts.append(f"state {n}")
    except Exception as e:
        parts.append(f"nhl player state skipped ({type(e).__name__}: {e})"[:180])
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
    }


def load_fits(conn):
    """Latest stored fit per version. Missing table or no rows → {}."""
    try:
        rows = conn.execute(
            "SELECT * FROM nhl_ridge_fits ORDER BY fit_date DESC, fit_id DESC").fetchall()
    except sqlite3.OperationalError:
        return {}
    out = {}
    for r in rows:
        if r["version"] not in out:
            out[r["version"]] = _unpack_fit(r)
    return out


def load_state_map(conn):
    """Skater and goalie state, plus the priors stored with them."""
    prior = short_prior = None
    group_median = {}
    lg_sv = None
    skaters, goalies = {}, {}
    try:
        rows = conn.execute(
            "SELECT athlete_id, team_id, last_game_date, exp_toi, skater_expo, is_defense, state_json "
            "FROM nhl_player_state").fetchall()
    except sqlite3.OperationalError:
        rows = []
    for r in rows:
        js = json.loads(r["state_json"])
        if prior is None and js.get("prior"):
            prior = {k: float(v) for k, v in js["prior"].items()}
            short_prior = {k: float(v) for k, v in (js.get("short_prior") or {}).items()}
            group_median = js.get("group_median") or {}
            if js.get("lg_sv") is not None:
                lg_sv = float(js["lg_sv"])
        skaters[int(r["athlete_id"])] = {
            "team_id": None if r["team_id"] is None else int(r["team_id"]),
            "last": r["last_game_date"],
            "exp_toi": None if r["exp_toi"] is None else float(r["exp_toi"]),
            "is_d": bool(r["is_defense"]),
            "sL": js.get("sL") or {}, "sS": js.get("sS") or {},
            "mL": float(js.get("mL") or 0), "mS": float(js.get("mS") or 0),
        }
    try:
        grows = conn.execute(
            "SELECT athlete_id, team_id, last_game_date, state_json FROM nhl_goalie_state").fetchall()
    except sqlite3.OperationalError:
        grows = []
    for r in grows:
        js = json.loads(r["state_json"])
        if lg_sv is None and js.get("lg_sv") is not None:
            lg_sv = float(js["lg_sv"])
        goalies[int(r["athlete_id"])] = {
            "team_id": None if r["team_id"] is None else int(r["team_id"]),
            "last": r["last_game_date"],
            "s_sv": float(js.get("s_sv") or 0), "e_sa": float(js.get("e_sa") or 0),
        }
    meta = {"prior": prior, "short_prior": short_prior, "group_median": group_median,
            "lg_sv": lg_sv}
    return skaters, goalies, meta


def _blank_prior():
    prior = {m: 0.0 for m in METRICS}
    prior["plus_minus"] = PM_PRIOR
    return prior, {"pts": 0.0, "shots": 0.0, "plus_minus": 0.0}


def _side_from_ids(ids, is_d_of, state, goalie_id, goalies, game_date, meta, repl=None,
                   toi=None):
    """One team's aggregate. None when the weights are missing, the starter
    is unknown, or a named starter has no saved goalie line.

    No goalie id leaves the ridge (the team forecast). That is the production
    path when the starter is unknown, and it does not use a replacement
    goalie. Athlete id 0 means the starter is sat: replacement saves, and the
    outgoing goalie's shot volume. A named id with no saved line leaves the
    ridge the same way.
    """
    prior = meta.get("prior")
    short_prior = meta.get("short_prior")
    lg_sv = meta.get("lg_sv")
    if prior is None or short_prior is None or lg_sv is None or not ids:
        return None
    med = meta.get("group_median") or {}
    rows = []
    for aid in ids:
        st = state.get(int(aid))
        rates = decay_skater(st, game_date, prior, short_prior)
        is_d = is_d_of(int(aid), st)
        rates["isD"] = bool(is_d)
        exp = None if st is None else st.get("exp_toi")
        if exp is None or not np.isfinite(exp):
            exp = med.get("D" if is_d else "F")
        forced = None
        if toi and int(aid) in toi:
            try:
                forced = float(toi[int(aid)])
            except (TypeError, ValueError):
                forced = None
        if forced is not None and np.isfinite(forced):
            if forced <= 0:
                continue
            exp = forced
        if exp is None or not np.isfinite(float(exp)) or float(exp) <= 0:
            return None
        rates["exp_toi"] = float(exp)
        rows.append(rates)
    if not rows:
        return None
    frame = pd.DataFrame(rows)
    w = frame.exp_toi.to_numpy(float)
    if not np.isfinite(w).all() or w.sum() <= 0:
        return None
    agg = _agg(frame, w)
    # An unknown starter and a named starter with no saved line both leave
    # the ridge. decay_goalie runs only on a saved line. Athlete id 0 is a
    # sat starter, which keeps the outgoing goalie's shot volume.
    if goalie_id is None:
        return None
    gid = int(goalie_id)
    if gid == 0:
        g = _replacement_goalie(repl, game_date, lg_sv, goalies)
    else:
        st = goalies.get(gid)
        if st is None:
            return None
        g = decay_goalie(st, game_date, lg_sv)
    agg.update(g)
    return agg


def _logit(p):
    p = float(np.clip(p, 1e-4, 1 - 1e-4))
    return float(np.log(p / (1 - p)))


def shift_margin(team_prob, team_spread, total, home_tp, away_tp, ridge_prob):
    """Move the current path's margin onto the ridge chance.

    SLOPE goals per unit of home logit, then the same favorite check as
    forecast.carry_margin. Team totals follow. The total does not.
    """
    from .margin import SLOPE
    s = SLOPE["nhl"]
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
    """League fingerprint of the line chart and the starting-goalie feed."""
    parts = []
    for sql in ("SELECT MAX(valid_from) FROM nhl_line_states",
                "SELECT MAX(valid_from) FROM nhl_goalie_states"):
        try:
            parts.append(str(conn.execute(sql).fetchone()[0]))
        except sqlite3.Error:
            parts.append("-")
    return "|".join(parts)


def _ids(values):
    if not values:
        return ""
    return ",".join(str(int(a)) for a in values)


def _open(conn, sql, params):
    try:
        return pd.read_sql_query(sql, conn, params=params)
    except (sqlite3.OperationalError, pd.errors.DatabaseError):
        return pd.DataFrame()


def _load_dressed(conn, teams, as_of):
    """team → [athlete ids] when the chart is fresh and has a full skate."""
    if not teams:
        return {}
    t = ",".join(str(int(x)) for x in teams)
    df = _open(conn,
               "SELECT team_id, athlete_id, group_id, injury_status, last_seen "
               f"FROM nhl_line_states WHERE team_id IN ({t}) "
               "AND valid_from <= :as_of AND (valid_to IS NULL OR valid_to > :as_of)",
               {"as_of": as_of})
    if not len(df):
        return {}
    cutoff = (pd.Timestamp(as_of) - FEED_MAX_AGE).isoformat()
    out = {}
    for team, g in df.groupby(df.team_id.astype(int)):
        rows = g.to_dict("records")
        dressed = []
        seen = set()
        last = ""
        for row in rows:
            seen_at = str(row.get("last_seen") or "")
            if seen_at > last:
                last = seen_at
            if not is_dressed_row(row) or row.get("athlete_id") is None or pd.isna(row.get("athlete_id")):
                continue
            aid = int(row["athlete_id"])
            if aid not in seen:
                seen.add(aid)
                dressed.append(aid)
        if len(dressed) >= DRESSED_MIN and last >= cutoff:
            out[int(team)] = dressed
    return out


def _load_confirmed(conn, event_ids, as_of):
    """(event, team) → athlete id for a Confirmed Daily Faceoff starter.

    The id is the one starters.known_starters would use. Likely, Unconfirmed
    and an ESPN probable do not count, and a confirmation older than the feed
    window does not count.
    """
    if not event_ids:
        return {}
    from .starters import known_starters
    try:
        ks = known_starters(conn, "nhl", event_ids, as_of)
    except (sqlite3.OperationalError, pd.errors.DatabaseError):
        return {}
    if ks is None or not len(ks):
        return {}
    ids = ",".join(str(int(e)) for e in event_ids)
    df = _open(conn,
               "SELECT espn_event_id, team_id, athlete_id, strength, last_seen "
               f"FROM nhl_goalie_states WHERE espn_event_id IN ({ids}) "
               "AND valid_from <= :as_of AND (valid_to IS NULL OR valid_to > :as_of)",
               {"as_of": as_of})
    strength = {}
    if len(df):
        for r in df.itertuples(index=False):
            if r.athlete_id is None or pd.isna(r.athlete_id) or r.espn_event_id is None:
                continue
            strength[(int(r.espn_event_id), int(r.team_id))] = r
    cutoff = (pd.Timestamp(as_of) - FEED_MAX_AGE).isoformat()
    out = {}
    for r in ks.itertuples(index=False):
        if r.src != "dfo":
            continue
        rec = strength.get((int(r.espn_event_id), int(r.team_id)))
        if rec is None or not is_confirmed_goalie(rec):
            continue
        if int(rec.athlete_id) != int(r.athlete_id):
            continue
        if str(rec.last_seen or "") < cutoff:
            continue
        out[(int(r.espn_event_id), int(r.team_id))] = int(r.athlete_id)
    return out


def _load_goalie_choices(conn, event_ids, as_of):
    """(event, team) → {confirmed, likely, espn} and team → goalie-state ids.

    No 36-hour cutoff: this is the team-model starter order, not the ridge B
    gate. A team is absent from the id map when it has no open goalie row.
    """
    choices, state_ids = {}, {}
    if not event_ids:
        return choices, state_ids
    ids = ",".join(str(int(e)) for e in event_ids)
    df = _open(conn,
               "SELECT espn_event_id, team_id, athlete_id, strength "
               f"FROM nhl_goalie_states WHERE espn_event_id IN ({ids}) "
               "AND valid_from <= :as_of AND (valid_to IS NULL OR valid_to > :as_of)",
               {"as_of": as_of})
    if len(df):
        for r in df.itertuples(index=False):
            if (r.athlete_id is None or pd.isna(r.athlete_id) or r.team_id is None
                    or pd.isna(r.team_id) or r.espn_event_id is None or pd.isna(r.espn_event_id)):
                continue
            key = (int(r.espn_event_id), int(r.team_id))
            slot = choices.setdefault(key, {})
            aid = int(r.athlete_id)
            strength = str(r.strength or "").strip()
            if strength == "Confirmed" and "confirmed" not in slot:
                slot["confirmed"] = aid
            elif strength == "Likely" and "likely" not in slot:
                slot["likely"] = aid
            state_ids.setdefault(int(r.team_id), set()).add(aid)
    ep = _open(conn,
               "SELECT espn_event_id, team_id, athlete_id FROM game_probables "
               f"WHERE league = 'nhl' AND kind = 'SG' AND espn_event_id IN ({ids}) "
               "AND athlete_id IS NOT NULL AND team_id IS NOT NULL "
               "AND valid_from <= :as_of AND (valid_to IS NULL OR valid_to > :as_of)",
               {"as_of": as_of})
    if len(ep):
        for r in ep.itertuples(index=False):
            if r.athlete_id is None or pd.isna(r.athlete_id) or r.espn_event_id is None:
                continue
            key = (int(r.espn_event_id), int(r.team_id))
            slot = choices.setdefault(key, {})
            if "espn" not in slot:
                slot["espn"] = int(r.athlete_id)
    return choices, state_ids


def _load_goalie_chart(conn, as_of):
    """athlete → set of teams with an open line-chart goalie row.

    League-wide, so a goalie who moved to a team that is not on this slate
    is still visible.
    """
    df = _open(conn,
               "SELECT team_id, athlete_id FROM nhl_line_states "
               "WHERE valid_from <= :as_of AND (valid_to IS NULL OR valid_to > :as_of) "
               "AND (group_id = 'g' OR lower(COALESCE(position_id, '')) LIKE 'g%')",
               {"as_of": as_of})
    chart = {}
    if not len(df):
        return chart
    for r in df.itertuples(index=False):
        if r.athlete_id is None or pd.isna(r.athlete_id) or r.team_id is None or pd.isna(r.team_id):
            continue
        chart.setdefault(int(r.athlete_id), set()).add(int(r.team_id))
    return chart


def _load_prev(conn, teams, before):
    """team → [(game_date, season, event)], and {(event, team): [skater ids]}."""
    if not teams:
        return {}, {}
    t = ",".join(str(int(x)) for x in teams)
    try:
        games = conn.execute(
            "SELECT team_id, espn_event_id, season, game_date FROM player_game_nhl_skater "
            f"WHERE team_id IN ({t}) AND game_date < ? AND COALESCE(toi_sec, 0) > 0 "
            "GROUP BY team_id, espn_event_id, season, game_date", (before,)).fetchall()
        played = conn.execute(
            "SELECT team_id, espn_event_id, athlete_id FROM player_game_nhl_skater "
            f"WHERE team_id IN ({t}) AND game_date < ? AND COALESCE(toi_sec, 0) > 0",
            (before,)).fetchall()
    except sqlite3.OperationalError:
        return {}, {}
    by_team = {}
    for tm, eid, season, gd in games:
        by_team.setdefault(int(tm), []).append((str(gd), int(season), int(eid)))
    for tm in by_team:
        by_team[tm].sort()
    rot = {}
    for tm, eid, aid in played:
        rot.setdefault((int(eid), int(tm)), [])
        if int(aid) not in rot[(int(eid), int(tm))]:
            rot[(int(eid), int(tm))].append(int(aid))
    return by_team, rot


def _load_starts(conn, teams, before):
    """team → [(game_date, athlete)] of starter=1 rows before `before`, oldest first."""
    if not teams:
        return {}
    t = ",".join(str(int(x)) for x in teams)
    try:
        rows = conn.execute(
            "SELECT team_id, game_date, athlete_id FROM player_game_nhl_goalie "
            f"WHERE team_id IN ({t}) AND starter = 1 AND game_date < ? "
            "ORDER BY team_id, game_date, athlete_id", (before,)).fetchall()
    except sqlite3.OperationalError:
        return {}
    out = {}
    for tm, gd, aid in rows:
        out.setdefault(int(tm), []).append((str(gd), int(aid)))
    return out


def qualifying_prev(history, game_date, season):
    """Event id of the previous skater box in this season or last.

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


def most_used_goalie(starts, game_date):
    """Goalie with the most starts in the previous 10. Ties take the smaller id."""
    if not starts:
        return None
    gd = str(game_date)[:10]
    last10 = [aid for d, aid in starts if d < gd][-10:]
    if not last10:
        return None
    vals, cnt = np.unique(np.asarray(last10), return_counts=True)
    return int(vals[cnt.argmax()])


# Statuses that mean the skater will not dress. `out` is the one ridge B
# rejects. The rest are the same idea on a chart row B would still dress
# if the group were an even-strength line. Daily Faceoff stores `gtd`
# separately and ridge B does not read it; a game-time decision can dress,
# so C does not drop `gtd` either.
NOT_DRESSING = frozenset({
    "out", "ir", "injured", "ltir", "injured reserve",
    "suspension", "suspended", "scratched",
})


def _athlete_id(row):
    if not isinstance(row, dict):
        return None
    aid = row.get("athlete_id")
    if aid is None or pd.isna(aid):
        return None
    try:
        return int(aid)
    except (TypeError, ValueError):
        return None


def injury_wont_dress(row):
    """True when this chart row says the player will not dress.

    An IR group counts even when the status is only day-to-day. `gtd` does
    not: ridge B ignores it, and C is not looser than that.
    """
    status = str(row.get("injury_status") or "").strip().lower()
    if status in NOT_DRESSING:
        return True
    return str(row.get("group_id") or "") == "ir"


def _blocked_ids(rows):
    out = set()
    for row in rows or []:
        if not injury_wont_dress(row):
            continue
        aid = _athlete_id(row)
        if aid is not None:
            out.add(aid)
    return out


def chart_fresh(rows, as_of):
    """True when the newest row is inside the same 36-hour window ridge B uses."""
    if not rows or as_of is None:
        return False
    cutoff = (pd.Timestamp(as_of) - FEED_MAX_AGE).isoformat()
    last = ""
    for row in rows:
        seen = str(row.get("last_seen") or "")
        if seen > last:
            last = seen
    return bool(last) and last >= cutoff


def c_dressed_ids(rows):
    """Even-strength skaters on a fresh chart, without anyone who will not dress."""
    blocked = _blocked_ids(rows)
    out, seen = [], set()
    for row in rows or []:
        if not is_dressed_row(row):
            continue
        aid = _athlete_id(row)
        if aid is None or aid in seen or aid in blocked:
            continue
        seen.add(aid)
        out.append(aid)
    return out


def c_skater_ids(rows, as_of, rotation_ids):
    """Skaters for ridge C.

    A fresh chart (same 36-hour `last_seen` rule as ridge B) supplies today's
    dressed skaters, including when the chart is shorter than B's 15-skater
    gate. An empty fresh chart stays empty. Otherwise the previous rotation
    is used, with anyone that chart lists as out or injured removed.
    """
    if chart_fresh(rows, as_of):
        return c_dressed_ids(rows)
    blocked = _blocked_ids(rows)
    return [int(a) for a in (rotation_ids or []) if int(a) not in blocked]


def _is_chart_goalie(row):
    group = str(row.get("group_id") or "")
    pos = str(row.get("position_id") or "").lower()
    return group == "g" or pos.startswith("g")


def _goalie_listing(team, rows, state_ids):
    """Athlete ids the team is currently listing at goalie, or None.

    The line chart's goalie rows win. With none, the open Daily Faceoff
    goalie rows for the team are the listing. None means there is no listing,
    which is different from an empty one.
    """
    ids = []
    for row in rows or []:
        if not _is_chart_goalie(row):
            continue
        aid = _athlete_id(row)
        if aid is not None:
            ids.append(aid)
    if ids:
        return set(ids)
    extra = None if not state_ids else state_ids.get(int(team))
    if extra:
        return {int(a) for a in extra}
    return None


def expected_goalie(team, game_date, choices, starts, listing, latest_team,
                    chart_teams=None):
    """Goalie for ridge C, and the source name.

    Precedence matches the team-model starter, then the old C fallback:
    Daily Faceoff Confirmed, then Likely, then the ESPN probable, then the
    most-used goalie in the previous 10 starts (a tie takes the smaller id).
    A goalie the line chart currently lists for another team is never
    returned. When this team has a listing, a goalie who is not on it is
    skipped. With no listing, a goalie whose latest appearance is for
    another team is skipped. Returns (None, None) when nobody qualifies.
    """
    team = int(team)
    choices = choices or {}
    latest_team = latest_team or {}
    chart_teams = chart_teams or {}

    def eligible(aid):
        if aid is None or pd.isna(aid):
            return False
        try:
            aid = int(aid)
        except (TypeError, ValueError):
            return False
        teams = chart_teams.get(aid)
        if teams and team not in teams:
            return False
        if listing is not None:
            return aid in listing
        last = latest_team.get(aid)
        if last is not None and int(last) != team:
            return False
        return True

    for src in ("confirmed", "likely", "espn"):
        aid = choices.get(src)
        if eligible(aid):
            return int(aid), src
    gd = str(game_date)[:10]
    last10 = [(d, a) for d, a in (starts or []) if str(d) < gd][-10:]
    kept = [(d, a) for d, a in last10 if eligible(a)]
    aid = most_used_goalie(kept, game_date)
    if aid is None:
        return None, None
    return int(aid), "most_used"


def _goalie_bit(aid, src):
    if aid is None:
        return "-"
    if src:
        return f"{int(aid)}:{src}"
    return str(int(aid))


def _pos_flag(defense):
    """Box position when the skater has one, otherwise the chart defense set."""
    defense = defense or set()

    def flag(aid, st, defense=defense):
        if st is not None:
            return bool(st.get("is_d"))
        return int(aid) in defense

    return flag


def _team_vector(home_agg, away_agg, h_rest, a_rest, neutral, columns):
    if home_agg is None or away_agg is None:
        return None
    ctx = context_row(h_rest, a_rest, neutral)
    base = {f"d_{k}": hv - away_agg.get(k, np.nan) for k, hv in home_agg.items()}
    base.update(ctx)
    try:
        x = np.array([float(base[c]) for c in columns], float)
    except (KeyError, TypeError, ValueError):
        return None
    if not np.isfinite(x).all():
        return None
    return x


def _prepare_slate(conn, frame, as_of):
    eids = [int(e) for e in frame["espn_event_id"].tolist()]
    teams = sorted({int(t) for t in list(frame["home_team_id"]) + list(frame["away_team_id"])})
    before = (str(pd.to_datetime(frame["game_date"]).max().date() + timedelta(days=1))
              if len(frame) else "9999-12-31")
    skaters, goalies, meta = load_state_map(conn)
    try:
        games = load_games(conn)
    except (sqlite3.OperationalError, pd.errors.DatabaseError):
        games = pd.DataFrame()
    prev, rot = _load_prev(conn, teams, before)
    choices, state_ids = _load_goalie_choices(conn, eids, as_of)
    latest = {}
    for aid, st in goalies.items():
        if st.get("team_id") is not None:
            latest[int(aid)] = int(st["team_id"])
    return {
        "fits": load_fits(conn),
        "skaters": skaters, "goalies": goalies, "meta": meta,
        "rest": rest_table(games) if len(games) else pd.DataFrame(columns=["h_rest", "a_rest"]),
        "dressed": _load_dressed(conn, teams, as_of),
        "confirmed": _load_confirmed(conn, eids, as_of),
        "prev": prev, "rot": rot,
        "starts": _load_starts(conn, teams, before),
        "key": inputs_key(conn),
        "as_of": as_of,
        "line_rows": _load_line_rows(conn, teams, as_of),
        "goalie_choices": choices,
        "goalie_state_ids": state_ids,
        "goalie_chart": _load_goalie_chart(conn, as_of),
        "goalie_latest": latest,
    }


def _c_pool(slate, team, eid, game_date, prev_event):
    """(skater ids, goalie id, goalie source) for one ridge C side."""
    rows = (slate.get("line_rows") or {}).get(team) or []
    rotation = [] if prev_event is None else (slate.get("rot") or {}).get((prev_event, team), [])
    ids = c_skater_ids(rows, slate.get("as_of"), rotation)
    choices = (slate.get("goalie_choices") or {}).get((int(eid), int(team)), {})
    listing = _goalie_listing(team, rows, slate.get("goalie_state_ids"))
    gid, src = expected_goalie(
        team, game_date, choices, (slate.get("starts") or {}).get(team),
        listing, slate.get("goalie_latest") or {}, slate.get("goalie_chart"))
    return ids, gid, src


def _score_row(row, slate):
    """Audit fields, and the published prob and spread when the ridge runs."""
    eid = int(row["espn_event_id"])
    home, away = int(row["home_team_id"]), int(row["away_team_id"])
    season = int(row["season"])
    gd = str(row["game_date"])[:10]
    team_prob = float(row["home_prob"])
    dressed = slate["dressed"]
    confirmed = slate["confirmed"]
    h_lines = dressed.get(home)
    a_lines = dressed.get(away)
    h_goal = confirmed.get((eid, home))
    a_goal = confirmed.get((eid, away))
    prev_games = slate["prev"]
    h_prev = qualifying_prev(prev_games.get(home), gd, season)
    a_prev = qualifying_prev(prev_games.get(away), gd, season)
    lines_ok = h_lines is not None and a_lines is not None
    goalies_ok = h_goal is not None and a_goal is not None
    prev_ok = h_prev is not None and a_prev is not None
    fits = slate["fits"]
    if lines_ok and goalies_ok and prev_ok and "B" in fits:
        src = "ridge_b"
    elif prev_ok and "C" in fits:
        src = "ridge_c"
    else:
        src = "team"
    # Ridge B keeps the confirmed-goalie gate. C chooses skaters and the
    # goalie on their own, and the audit records that goalie's source.
    if src == "ridge_b":
        h_ids, a_ids = list(h_lines), list(a_lines)
        h_g, h_gs, a_g, a_gs = h_goal, "confirmed", a_goal, "confirmed"
    else:
        h_ids, h_g, h_gs = _c_pool(slate, home, eid, gd, h_prev)
        a_ids, a_g, a_gs = _c_pool(slate, away, eid, gd, a_prev)
    h_ids, h_g = _flip_side(slate, home, h_ids, h_g)
    a_ids, a_g = _flip_side(slate, away, a_ids, a_g)
    h_ids, h_g = _apply_line(slate, h_ids, h_g, "h")
    a_ids, a_g = _apply_line(slate, a_ids, a_g, "a")
    toi = _toi_map(slate)
    inputs = (f"k={slate['key']};lines={_ids(h_ids)}|{_ids(a_ids)};"
              f"goalie={_goalie_bit(h_g, h_gs)}|{_goalie_bit(a_g, a_gs)}")
    base = {"nhl_model_src": "team", "nhl_team_prob": team_prob, "nhl_ridge_prob": None,
            "nhl_ridge_fit_id": None, "nhl_inputs": inputs}
    if src == "team" or slate["meta"].get("prior") is None:
        return base
    version = "B" if src == "ridge_b" else "C"
    fit = fits[version]
    meta = slate["meta"]
    # A skater with a box keeps that position. A call-up takes the chart:
    # d1–d4 are defense, the forward lines are not. C uses the same rule.
    line_rows = slate.get("line_rows") or {}
    h_def = _defense_ids(line_rows.get(home))
    a_def = _defense_ids(line_rows.get(away))
    repls = slate.get("goalie_repl") or {}
    h_agg = _side_from_ids(
        h_ids, _pos_flag(h_def), slate["skaters"], h_g, slate["goalies"], gd, meta,
        repls.get(home), toi)
    a_agg = _side_from_ids(
        a_ids, _pos_flag(a_def), slate["skaters"], a_g, slate["goalies"], gd, meta,
        repls.get(away), toi)
    scales = (slate.get("scenario") or {}).get("scale") or {}
    h_agg = _scale_agg(h_agg, scales)
    a_agg = _scale_agg(a_agg, scales)
    rest = slate["rest"]
    if len(rest) and eid in rest.index:
        h_rest, a_rest = float(rest.at[eid, "h_rest"]), float(rest.at[eid, "a_rest"])
    else:
        h_rest = a_rest = 7.0
    neutral = row["neutral_site"] if "neutral_site" in row.index else row.get("neutral", 0)
    x = _team_vector(h_agg, a_agg, h_rest, a_rest, neutral, fit["features"])
    if x is None:
        return base
    p = float(predict_stored(fit, x.reshape(1, -1))[0])
    new_p, spread, ht, at = shift_margin(
        team_prob, row["home_spread"], row["total_pred"],
        row["home_total_pred"], row["away_total_pred"], p)
    return {"nhl_model_src": src, "nhl_team_prob": team_prob, "nhl_ridge_prob": new_p,
            "nhl_ridge_fit_id": fit["fit_id"], "nhl_inputs": inputs,
            "home_prob": new_p, "home_spread": spread,
            "home_total_pred": ht, "away_total_pred": at}


def _defense_ids(rows):
    if not rows:
        return set()
    out = set()
    for row in rows:
        group = str(row.get("group_id") or "")
        aid = _athlete_id(row)
        if aid is None or not group.startswith("d"):
            continue
        if is_dressed_row(row):
            out.add(aid)
    return out


def _load_line_rows(conn, teams, as_of):
    if not teams:
        return {}
    t = ",".join(str(int(x)) for x in teams)
    df = _open(conn,
               "SELECT team_id, athlete_id, group_id, position_id, injury_status, last_seen "
               f"FROM nhl_line_states WHERE team_id IN ({t}) "
               "AND valid_from <= :as_of AND (valid_to IS NULL OR valid_to > :as_of)",
               {"as_of": as_of})
    out = {}
    if not len(df):
        return out
    for team, g in df.groupby(df.team_id.astype(int)):
        out[int(team)] = g.to_dict("records")
    return out


def _prepare_slate_full(conn, frame, as_of):
    return _prepare_slate(conn, frame, as_of)


def _apply_line(slate, ids, goalie, side):
    """A chosen goalie, or a chosen dressed list, replaces the forecast's."""
    line = (slate.get("scenario") or {}).get("line") or {}
    picked = (line.get("g") or {}).get(side)
    if picked is not None:
        try:
            goalie = int(picked)
        except (TypeError, ValueError):
            pass
    skaters = (line.get("sk") or {}).get(side)
    if skaters:
        ids = []
        for raw in skaters:
            try:
                ids.append(int(raw))
            except (TypeError, ValueError):
                continue
    return ids, goalie


def _toi_map(slate):
    raw = ((slate.get("scenario") or {}).get("line") or {}).get("toi") or {}
    out = {}
    for key, value in raw.items():
        try:
            out[int(key)] = float(value)
        except (TypeError, ValueError):
            continue
    return out or None


def _flip_side(slate, team, ids, goalie):
    """Drop a toggled skater, or replace a toggled starting goalie.

    Goalie id 0 is not a stored goalie. The side keeps a replacement
    goaltender with that starter's shot volume, so the forecast still runs
    and sitting him only removes his save skill.
    """
    toggles = {int(a) for a in ((slate.get("scenario") or {}).get("toggle") or ())}
    if not toggles:
        return list(ids), goalie
    ids = [int(x) for x in ids]
    skaters = slate.get("skaters") or {}
    goalies = slate.get("goalies") or {}
    gid = None if goalie is None else int(goalie)
    for aid in toggles:
        st = skaters.get(aid)
        gt = goalies.get(aid)
        tm = None
        if st and st.get("team_id") is not None:
            tm = int(st["team_id"])
        elif gt and gt.get("team_id") is not None:
            tm = int(gt["team_id"])
        if tm != int(team):
            continue
        if gt is not None and (st is None or aid == gid):
            if aid == gid:
                slate.setdefault("goalie_repl", {})[int(team)] = gt
                gid = 0
            else:
                gid = aid
            continue
        if aid in ids:
            ids = [x for x in ids if x != aid]
        else:
            ids.append(aid)
    return ids, gid


def _scale_agg(agg, scales):
    """Multiply linked team rates. Save percentage moves the goalie term."""
    if not agg or not scales:
        return agg
    mapping = {
        "g": ("g_r",), "a": ("a_r",), "sog": ("shots_r", "shotsS_r"),
        "hits": ("hits_r",), "blk": ("blocks_r",), "sv": ("gsaa30",),
    }
    out = dict(agg)
    for key, cols in mapping.items():
        if key not in scales:
            continue
        try:
            mult = float(scales[key])
        except (TypeError, ValueError):
            continue
        for col in cols:
            if col in out and out[col] is not None:
                out[col] = float(out[col]) * mult
    return out


def overlay(conn, frame, as_of, today=None, scenario=None):
    """Publish the ridge chance on rows where it runs. Does not write."""
    if frame is None or not len(frame):
        return frame
    f = frame.reset_index(drop=True).copy()
    for c in AUDIT_COLS:
        if c not in f.columns:
            f[c] = None
    if "game_date" not in f.columns and "date" in f.columns:
        f["game_date"] = f["date"].astype(str).str[:10]
    try:
        slate = _prepare_slate_full(conn, f, as_of)
        if scenario:
            slate["scenario"] = scenario
    except Exception as exc:
        for event_id in _fallback_ids(f):
            _log_fallback("nhl", event_id, exc)
        return mark_team(f)
    probs = np.array(f["home_prob"], dtype=float, copy=True)
    for i in range(len(f)):
        try:
            scored = _score_row(f.loc[i], slate)
        except Exception as exc:
            event_id = f.at[i, "espn_event_id"] if "espn_event_id" in f.columns else "?"
            _log_fallback("nhl", event_id, exc)
            scored = {"nhl_model_src": "team", "nhl_team_prob": float(f.at[i, "home_prob"]),
                      "nhl_ridge_prob": None, "nhl_ridge_fit_id": None, "nhl_inputs": None}
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
    """Stamp the current path as the published NHL source. Probabilities stay."""
    if forecast is None or not len(forecast):
        return forecast
    f = forecast.copy()
    f["nhl_model_src"] = "team"
    f["nhl_team_prob"] = f["home_prob"].to_numpy(float)
    f["nhl_ridge_prob"] = np.nan
    f["nhl_ridge_fit_id"] = np.nan
    if "nhl_inputs" not in f.columns:
        f["nhl_inputs"] = None
    return f


def apply(conn, sched, forecast, as_of, today):
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
    return overlay(conn, f, as_of, today)


# ---------------------------------------------------------------- refresh

def _ridge_current(series, key):
    return str(series or "").startswith(f"k={key};")


def refresh(conn, now=None, log=print, force=False):
    """Recompute the NHL chance for games that have not started and are not locked.

    The current path is rebuilt from the stored pre-player values, then the
    ridge replaces the published chance where it runs. Past forecast_snapshots
    rows and existing locks are not read. `force` recomputes even when the
    line and goalie fingerprints match, which is how a new fit reaches today's
    unlocked games.
    """
    from . import player_adj as pa
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    as_of = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    today = now.astimezone(pa.CHICAGO).date().isoformat()
    key = pa.inputs_key(conn, "nhl", today)
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
                params={"today": today, "lg": "nhl"})
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
            stamped = "nhl_inputs" in rows.columns and bool(rows["nhl_inputs"].notna().any())
            if stamped:
                ridge_same = bool(rows["nhl_inputs"].map(
                    lambda s: _ridge_current(s, ridge_key)).all())
            else:
                ridge_same = True
            if player_same and ridge_same:
                continue
        if state is None:
            state = pa.STATE_FN["nhl"](conn, today)

        def adjust(frame, _as=as_of):
            return overlay(conn, frame, _as)

        n = pa._refresh_rows(conn, "nhl", rows, table, pk, as_of, key, state, adjust=adjust)
        total += n
        if n:
            early = "" if table == "forecast_snapshots" else " early"
            log(f"nhl ridge refresh{early}: {n} of {len(rows)} forecasts updated")
    return total or None


def _main(argv=None):
    """Fit both versions, replace player state, and refresh unlocked forecasts.

    Past forecast rows and existing locks are not rewritten. The morning job
    also fits when no fit is stored.
    """
    from . import db
    ap = argparse.ArgumentParser(description="Fit the NHL player ridge and refresh unlocked forecasts")
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
