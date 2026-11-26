"""NFL quarterback ridge: the published NFL win chance when both starters are known.

The published chance is an L2 logistic regression on the logit of
the team rating's win chance plus the confirmed starter's pre-game EPA per
dropback, completion percentage over expected, and log experience, and
whether that starter differs from the previous game's starter. The winning
research variant is ridge_stack_qbA. Last game's starter is not a fallback:
when either side has no confirmed starter, the current team path is published
unchanged.

Per game, at forecast time:
  ridge_qb  both teams have a confirmed starter, a stored fit of at least
            2000 games, play-by-play state, and a team-rating chance to stack on
  team      anything missing, or the stored fit has fewer than 2000 games:
            no fit, no play-by-play, no team-rating chance, or either starter
            not confirmed (a depth-chart quarterback who is not ruled out
            counts; the previous game's starter does not)

Training games are completed non-tie regular and postseason games from 2007
on. From 2025-09-04 the team chance is the game-day snapshot; earlier games
use nfl_team_chance_hist when no snapshot is stored. The refit runs Tuesday
and after a play-by-play load that adds completed games. Training uses the
nflverse injury report when it lists the starter out or doubtful before the
game, and then takes the previous game's starter. With no report, the
starter who played stays. The live confirmed starter (lineup, probable, or
a depth-chart quarterback who is not ruled out) is unchanged.

The spread follows the published chance from the current path's margin at
SLOPE points per unit of home logit (the carry_margin rule). The total
stays on the current path. Recorded locks and older forecast rows are not
rewritten. A failure publishes the current path and logs the league, the
event id, and the exception.
"""

import argparse
import json
import logging
import math
import sqlite3
import traceback
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

TRAIN_FROM_SEASON = 2006
# Ridge rows start in 2007. 2006 stays in the schedule and the play-by-play
# so the rates, the previous starter, and the team-chance replay have a year
# of history before the first training game.
RIDGE_FROM_SEASON = 2007
# Game-day snapshots from this date are the team chance. Earlier games use
# nfl_team_chance_hist when no snapshot is stored.
SNAPSHOT_FROM = "2025-09-04"
# Regular season and the nflverse postseason labels. Preseason is not a row.
COUNTED_TYPES = frozenset({"REG", "WC", "DIV", "CON", "SB", "POST"})
MIN_PUBLISH_GAMES = 2000
REFIT_WEEKDAY = 1  # Tuesday. Monday is before Sunday's play-by-play is in.
HL = 365.0
K_EPA = 250.0
K_CPOE = 300.0
EPA_SHIFT = 0.10
CPOE_PRIOR = -2.0
FEATURES = ["lt", "qbA_epa_d", "qbA_cpoe_d", "qbA_exp_d", "chg_d"]
VERSION = "qbA"
ST_PLAYS = ("kickoff", "punt", "field_goal", "extra_point")
# nflverse abbreviations and the ESPN ones for the same franchise, one key
CANON = {"OAK": "LV", "SD": "LAC", "STL": "LA", "LAR": "LA", "LA": "LA",
         "WSH": "WAS", "WAS": "WAS"}
AUDIT_COLS = ("nfl_model_src", "nfl_ridge_prob", "nfl_team_prob",
              "nfl_ridge_fit_id", "nfl_inputs")
_PBP_COLS = ("game_id", "season", "game_date", "posteam", "play_type", "epa",
             "qb_dropback", "passer_player_id", "rusher_player_id", "cpoe")


def canon(abbr):
    """One key per franchise. Relocations share a key; Rams are LA, Washington is WAS."""
    if abbr is None or (isinstance(abbr, float) and math.isnan(abbr)):
        return None
    text = str(abbr).strip()
    if not text or text.lower() == "nan":
        return None
    return CANON.get(text, text)


def logit(p):
    """Clipped the way models_stack.py clips the team probability."""
    p = float(np.clip(p, 1e-4, 1 - 1e-4))
    return float(math.log(p / (1.0 - p)))


def prior_rates(df, key, date, expo, metrics, hl, k, prior):
    """Decayed, shrunk rate from strictly earlier rows."""
    df = df.sort_values([key, date]).reset_index(drop=True)
    d_all = pd.to_datetime(df[date]).values.astype("datetime64[D]").astype(float)
    exposure = df[expo].values.astype(float)
    values = {m: df[m].values.astype(float) for m in metrics}
    rates = {m: np.empty(len(df)) for m in metrics}
    carried = np.empty(len(df))
    for _, idx in df.groupby(key, sort=False).indices.items():
        sums = {m: 0.0 for m in metrics}
        mass = 0.0
        last = None
        for i in idx:
            if last is not None:
                decay = 0.5 ** ((d_all[i] - last) / hl)
                mass *= decay
                for m in metrics:
                    sums[m] *= decay
            for m in metrics:
                rates[m][i] = (sums[m] + k * prior[m]) / (mass + k)
            carried[i] = mass
            for m in metrics:
                sums[m] += values[m][i]
            mass += exposure[i]
            last = d_all[i]
    for m in metrics:
        df[m + "_r"] = rates[m]
    df["_expo"] = carried
    return df


def qb_lines(plays):
    """Per (game, team, quarterback) dropback EPA and completion percentage
    over expected. Special-teams plays are left out. A missing passer falls
    back to the rusher, matching build.py."""
    empty = pd.DataFrame(columns=["game_id", "season", "game_date", "team", "qb",
                                  "qb_epa", "qb_n", "cpoe_sum", "cpoe_n"])
    if plays is None or not len(plays):
        return empty
    p = plays.copy()
    for c in _PBP_COLS:
        if c not in p.columns:
            p[c] = np.nan
    p = p[p["epa"].notna() & p["posteam"].notna()]
    if not len(p):
        return empty
    st = p["play_type"].isin(ST_PLAYS)
    db = p[(p["qb_dropback"] == 1) & ~st].copy()
    if not len(db):
        return empty
    passer = db["passer_player_id"]
    db["qb"] = passer.where(passer.notna() & (passer.astype(str) != ""), db["rusher_player_id"])
    db = db[db["qb"].notna() & (db["qb"].astype(str).str.strip() != "") &
            (db["qb"].astype(str).str.lower() != "nan")]
    if not len(db):
        return empty
    db["qb"] = db["qb"].astype(str)
    db["cpoe_filled"] = pd.to_numeric(db["cpoe"], errors="coerce").fillna(0.0)
    db["cpoe_ok"] = pd.to_numeric(db["cpoe"], errors="coerce").notna().astype(int)
    db["epa"] = pd.to_numeric(db["epa"], errors="coerce")
    db = db[db["epa"].notna()]
    g = db.groupby(["game_id", "posteam", "qb"], as_index=False).agg(
        qb_epa=("epa", "sum"), qb_n=("epa", "size"),
        cpoe_sum=("cpoe_filled", "sum"), cpoe_n=("cpoe_ok", "sum"),
        game_date=("game_date", "min"), season=("season", "min"))
    g = g.rename(columns={"posteam": "team"})
    g["qb_n"] = g["qb_n"].astype(int)
    g["cpoe_n"] = g["cpoe_n"].astype(int)
    return g


def qb_rates(lines):
    """Pregame EPA per dropback, completion percentage over expected, and the
    decayed dropback count, on every quarterback-game row.

    Returns (frame, league EPA per dropback). The prior is that league rate
    minus 0.10 for EPA, and -2 for completion percentage over expected.
    """
    cols = ["game_id", "qb", "date", "qb_epa", "qb_n", "cpoe_sum", "cpoe_n",
            "qb_epa_r", "qb_expo", "cpoe_sum_r"]
    if lines is None or not len(lines):
        return pd.DataFrame(columns=cols), float("nan")
    L = lines.copy()
    L["qb"] = L["qb"].astype(str)
    L["date"] = pd.to_datetime(L["date"] if "date" in L.columns else L["game_date"])
    L["qb_epa"] = pd.to_numeric(L["qb_epa"], errors="coerce").fillna(0.0)
    L["qb_n"] = pd.to_numeric(L["qb_n"], errors="coerce").fillna(0.0)
    L["cpoe_sum"] = pd.to_numeric(L["cpoe_sum"], errors="coerce").fillna(0.0)
    L["cpoe_n"] = pd.to_numeric(L["cpoe_n"], errors="coerce").fillna(0.0)
    L = L.groupby(["game_id", "qb"], as_index=False).agg(
        date=("date", "min"), qb_epa=("qb_epa", "sum"), qb_n=("qb_n", "sum"),
        cpoe_sum=("cpoe_sum", "sum"), cpoe_n=("cpoe_n", "sum"))
    if not len(L) or float(L["qb_n"].sum()) <= 0:
        return pd.DataFrame(columns=cols), float("nan")
    lq = float(L["qb_epa"].sum() / L["qb_n"].sum())
    epa = prior_rates(L[["game_id", "qb", "date", "qb_epa", "qb_n"]].copy(),
                      "qb", "date", "qb_n", ["qb_epa"], HL, K_EPA,
                      {"qb_epa": lq - EPA_SHIFT})
    cpoe = prior_rates(L[["game_id", "qb", "date", "cpoe_sum", "cpoe_n"]].copy(),
                       "qb", "date", "cpoe_n", ["cpoe_sum"], HL, K_CPOE,
                       {"cpoe_sum": CPOE_PRIOR})
    out = epa.rename(columns={"_expo": "qb_expo"}).merge(
        cpoe[["game_id", "qb", "cpoe_sum_r"]], on=["game_id", "qb"], how="left")
    return out, lq


def _qb_text(qb):
    if qb is None or (isinstance(qb, float) and math.isnan(qb)):
        return None
    text = str(qb).strip()
    if not text or text.lower() == "nan":
        return None
    return text


def qb_state(rates, lq, qb, when, game_id):
    """(epa per dropback, log experience, completion percentage over expected).

    A row in this game uses the pregame rate. A quarterback with no row in
    this game is updated from his last game with the gap's decay left off,
    and his completion rate stays at that game's pregame rate. Both match
    build.py qb_state. Never seen is the replacement level.
    """
    repl_epa = (float(lq) - EPA_SHIFT) if lq is not None and np.isfinite(lq) else float("nan")
    repl = (repl_epa, 0.0, CPOE_PRIOR)
    qb = _qb_text(qb)
    if qb is None or rates is None or not len(rates) or not np.isfinite(repl_epa):
        return repl
    df = rates[rates["qb"] == qb]
    if not len(df):
        return repl
    if game_id is not None:
        cur = df[df["game_id"].astype(str) == str(game_id)]
        if len(cur):
            r = cur.iloc[0]
            return (float(r.qb_epa_r), float(np.log1p(r.qb_expo)), float(r.cpoe_sum_r))
    when = pd.Timestamp(when)
    prev = df[pd.to_datetime(df["date"]) < when].sort_values(["date", "game_id"])
    if not len(prev):
        return repl
    r = prev.iloc[-1]
    expo = float(r.qb_expo)
    n = float(r.qb_n)
    epa = (float(r.qb_epa_r) * (expo + K_EPA) + float(r.qb_epa)) / (expo + K_EPA + n)
    return (epa, float(np.log1p(expo + n)), float(r.cpoe_sum_r))


def live_from_state(state, lq):
    """The no-current-game branch of qb_state, from a stored last game."""
    repl_epa = (float(lq) - EPA_SHIFT) if lq is not None and np.isfinite(lq) else float("nan")
    if not state:
        return (repl_epa, 0.0, CPOE_PRIOR)
    expo = float(state["qb_expo"])
    n = float(state["qb_n"])
    epa = (float(state["qb_epa_r"]) * (expo + K_EPA) + float(state["qb_epa"])) / (expo + K_EPA + n)
    return (epa, float(np.log1p(expo + n)), float(state["cpoe_sum_r"]))


def attach_changed(sched):
    """Home and away starter-changed flags. The previous starter is the
    previous game's starter for that franchise. A missing previous starter
    is not a change."""
    s = sched.copy()
    s["date"] = pd.to_datetime(s["date"])
    parts = []
    for side, fr, qb in (("h", "home_franchise", "home_qb"), ("a", "away_franchise", "away_qb")):
        part = s[["game_id", "date", fr, qb]].rename(columns={fr: "franchise", qb: "qb"})
        part["side"] = side
        parts.append(part)
    long = pd.concat(parts, ignore_index=True)
    long["franchise"] = long["franchise"].map(canon)
    long = long[long["franchise"].notna()].sort_values(
        ["franchise", "date", "game_id"]).reset_index(drop=True)
    long["prev"] = long.groupby("franchise", sort=False)["qb"].shift()

    def changed(prev, qb):
        prev_t = _qb_text(prev)
        qb_t = _qb_text(qb)
        return int(prev_t is not None and prev_t != qb_t)

    long["changed"] = [changed(p, q) for p, q in zip(long["prev"], long["qb"])]
    for side, col in (("h", "h_qb_changed"), ("a", "a_qb_changed")):
        m = long[long["side"] == side].drop_duplicates("game_id").set_index("game_id")["changed"]
        s[col] = s["game_id"].map(m).fillna(0).astype(int)
    return s


def stack_frame(sched, lines, team_prob):
    """Design matrix for completed, non-tied games that have a team chance.

    `team_prob` maps game_id to the team rating's home win chance. Ties are
    left out. A game with no chance is left out. Quarterback features use
    the schedule's starter id, which is the actual starter on a completed game.
    """
    # Rates and the previous starter use every scored game on the schedule.
    # A game with no team chance still counts as history. It is not a row.
    ids = set(sched["game_id"].astype(str))
    L = lines[lines["game_id"].astype(str).isin(ids)].copy() if lines is not None and len(lines) else lines
    if L is not None and len(L) and "date" in sched.columns:
        dmap = (sched.assign(_gid=sched["game_id"].astype(str))
                .drop_duplicates("_gid").set_index("_gid")["date"])
        L["date"] = L["game_id"].astype(str).map(dmap)
    rates, lq = qb_rates(L)
    s = attach_changed(sched)
    rows = []
    for r in s.itertuples(index=False):
        hs, aws = r.home_score, r.away_score
        if hs is None or aws is None or (isinstance(hs, float) and math.isnan(hs)):
            continue
        if (isinstance(aws, float) and math.isnan(aws)):
            continue
        if float(hs) == float(aws):
            continue
        pt = team_prob.get(str(r.game_id))
        if pt is None or not np.isfinite(pt):
            continue
        when = r.date
        he, hx, hc = qb_state(rates, lq, r.home_qb, when, r.game_id)
        ae, ax, ac = qb_state(rates, lq, r.away_qb, when, r.game_id)
        if not all(np.isfinite(v) for v in (he, hx, hc, ae, ax, ac)):
            continue
        rows.append({
            "game_id": str(r.game_id),
            "game_date": pd.Timestamp(when).strftime("%Y-%m-%d"),
            "season": int(r.season),
            "y": int(float(hs) > float(aws)),
            "lt": logit(pt),
            "qbA_epa_d": he - ae,
            "qbA_cpoe_d": hc - ac,
            "qbA_exp_d": hx - ax,
            "chg_d": int(r.h_qb_changed) - int(r.a_qb_changed),
        })
    return pd.DataFrame(rows)


def training_rows(M, fit_date):
    """Games before `fit_date`, from the 2007 season on."""
    if M is None or not len(M):
        return M.iloc[0:0] if M is not None else pd.DataFrame()
    d = pd.to_datetime(M["game_date"])
    end = pd.Timestamp(str(fit_date)[:10])
    ok = d < end
    if "season" in M.columns:
        ok = ok & (M["season"].astype(int) >= RIDGE_FROM_SEASON)
    return M.loc[ok].reset_index(drop=True)


def make_estimator():
    """The models_stack.py estimator: scaler, then L2 logistic with that C grid."""
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
    """Fit the stack on `training_rows` only. Stored scaler and coef reproduce predict_proba."""
    tr = training_rows(M, fit_date)
    cols = list(columns or FEATURES)
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
    eta = fit["intercept"] + z @ np.asarray(fit["coef"], float)
    return 1.0 / (1.0 + np.exp(-eta))


# ---------------------------------------------------------------- storage

def _jdump(obj):
    return json.dumps(obj, separators=(",", ":"))


def refit_due(conn, today):
    """Tuesday, or any day no fit is stored. A Tuesday that already stored
    the fit is not fit again (a same-day rerun). Monday is not a refit day:
    Sunday's play-by-play is not in yet. A play-by-play load that adds
    completed games refits on its own."""
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    try:
        rows = conn.execute("SELECT version, fit_date FROM nfl_ridge_fits").fetchall()
    except sqlite3.OperationalError:
        return False
    if not rows:
        return True
    if today.weekday() != REFIT_WEEKDAY:
        return False
    have = {r[0] for r in rows if r[1] == today.isoformat()}
    return VERSION not in have


def _save_fit(conn, today, packed, through):
    conn.execute(
        "INSERT INTO nfl_ridge_fits (fit_date, version, train_from, train_through, n_games, "
        "c_value, features, scaler_mean, scaler_scale, coef, intercept, sklearn_version, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (today.isoformat(), VERSION, f"{RIDGE_FROM_SEASON}", through, packed["n_games"],
         packed["c_value"], _jdump(packed["features"]), _jdump(packed["scaler_mean"]),
         _jdump(packed["scaler_scale"]), _jdump(packed["coef"]), packed["intercept"],
         packed["sklearn_version"], datetime.now(timezone.utc).isoformat(timespec="seconds")))


def _team_chance(player_base, home_prob, model_src, elo_weight):
    """The team rating's home chance, for the stack's logit feature.

    The game-day row's pre-player chance is that number. A replayed row has
    no player term and no stack weight, so its stored chance is the team
    rating. A row this model already replaced is not a training chance.
    """
    if player_base is not None and np.isfinite(player_base):
        return float(player_base)
    if model_src == "ridge_qb":
        return None
    if elo_weight is not None and np.isfinite(elo_weight) and float(elo_weight) > 0:
        return None
    if home_prob is not None and np.isfinite(home_prob):
        return float(home_prob)
    return None


def load_injury_status(conn):
    """Open nflverse injury rows, keyed for `apply_pregame_qbs`.

    exact: (season, week, game_type, franchise, gsis) -> status
    loose: (season, week, franchise, gsis) -> {status}
    A missing table returns empty maps, and training keeps who played.
    """
    from .injstatus import norm_report_status
    try:
        rows = conn.execute(
            "SELECT season, week, game_type, team, gsis_id, report_status "
            "FROM nfl_injury_report_states WHERE valid_to IS NULL").fetchall()
    except sqlite3.OperationalError:
        return {"exact": {}, "loose": {}}
    exact, loose = {}, {}
    for r in rows:
        if not r["gsis_id"] or r["week"] is None or r["season"] is None:
            continue
        st = norm_report_status(r["report_status"])
        fr = canon(r["team"])
        if fr is None:
            continue
        exact[(int(r["season"]), int(r["week"]), (r["game_type"] or "").upper(), fr, r["gsis_id"])] = st
        loose.setdefault((int(r["season"]), int(r["week"]), fr, r["gsis_id"]), set()).add(st)
    return {"exact": exact, "loose": loose}


def _status_of(index, season, week, game_type, franchise):
    def of(gsis):
        if not gsis or not index:
            return None
        gt = (game_type or "").upper()
        key = (int(season), int(week), gt, franchise, gsis)
        if key in index["exact"]:
            return index["exact"][key]
        opts = index["loose"].get((int(season), int(week), franchise, gsis))
        if opts and len(opts) == 1:
            return next(iter(opts))
        return None
    return of


def apply_pregame_qbs(sched, index):
    """Replace a starter the report had already ruled out.

    The previous starter is that franchise's previous game, home or away.
    The quarterback who played stays when the report has no status for him,
    and when the previous starter is also out or doubtful. An empty index
    returns the schedule unchanged.
    """
    from .injstatus import pregame_qb
    if sched is None or not len(sched) or not index:
        return sched
    if not index.get("exact") and not index.get("loose"):
        return sched
    s = sched.copy()
    s["date"] = pd.to_datetime(s["date"])
    parts = []
    for side, fr, qb in (("h", "home_franchise", "home_qb"), ("a", "away_franchise", "away_qb")):
        part = s[["game_id", "date", "season", fr, qb]].rename(
            columns={fr: "franchise", qb: "qb"})
        part["side"] = side
        part["week"] = s["week"] if "week" in s.columns else None
        part["game_type"] = s["game_type"] if "game_type" in s.columns else None
        parts.append(part)
    long = pd.concat(parts, ignore_index=True)
    long["franchise"] = long["franchise"].map(canon)
    long = long.sort_values(["franchise", "date", "game_id"]).reset_index(drop=True)
    long["prev"] = long.groupby("franchise", sort=False)["qb"].shift()
    chosen = []
    for r in long.itertuples(index=False):
        week = r.week
        blank = (week is None or (isinstance(week, float) and math.isnan(week))
                 or r.franchise is None)
        gt = r.game_type
        if gt is None or (isinstance(gt, float) and math.isnan(gt)):
            gt = ""
        if blank:
            chosen.append(r.qb)
            continue
        status_of = _status_of(index, int(r.season), int(week), str(gt), r.franchise)
        chosen.append(pregame_qb(r.qb, r.prev, status_of))
    long["chosen"] = chosen
    for side, col in (("h", "home_qb"), ("a", "away_qb")):
        mapped = (long[long["side"] == side].drop_duplicates("game_id")
                  .set_index("game_id")["chosen"])
        s[col] = s["game_id"].map(mapped)
    return s


def _counted_type(game_type):
    if game_type is None or (isinstance(game_type, float) and math.isnan(game_type)):
        return False
    return str(game_type).strip().upper() in COUNTED_TYPES


def load_training_frame(conn, through):
    """Completed non-tie regular and postseason games through `through`, from
    the 2007 season on, with a starter on both sides, play-by-play rates, and
    a team-rating chance.

    From 2025-09-04 on the chance is the game-day snapshot. Earlier games use
    that snapshot when one is stored, and nfl_team_chance_hist otherwise.
    Rates and the previous starter still see the 2006 season and preseason
    games. When an injury report listed the starter out or doubtful, his side
    uses the previous game's starter instead. With no report, the starter who
    played stays.
    """
    try:
        sched = pd.read_sql_query(
            "SELECT game_id, season, week, game_type, game_date AS date, "
            "home_franchise, away_franchise, "
            "home_qb_gsis AS home_qb, away_qb_gsis AS away_qb, espn_event_id, "
            "home_score, away_score FROM nfl_schedule "
            "WHERE season >= ? AND game_date <= ? AND home_score IS NOT NULL "
            "AND away_score IS NOT NULL",
            conn, params=(TRAIN_FROM_SEASON, through))
        lines = pd.read_sql_query(
            "SELECT p.game_id, p.qb, s.game_date AS date, p.qb_epa, p.qb_n, p.cpoe_sum, p.cpoe_n "
            "FROM nfl_pbp_qb p JOIN nfl_schedule s ON s.game_id = p.game_id "
            "WHERE s.season >= ? AND s.game_date <= ? AND s.home_score IS NOT NULL",
            conn, params=(TRAIN_FROM_SEASON, through))
        probs = pd.read_sql_query(
            "SELECT espn_event_id, player_prob_base, home_prob, nfl_model_src, elo_weight "
            "FROM forecast_snapshots WHERE league = 'nfl' AND snapshot_date = game_date",
            conn)
        hist = pd.read_sql_query(
            "SELECT game_id, espn_event_id, p FROM nfl_team_chance_hist", conn)
    except (sqlite3.OperationalError, pd.errors.DatabaseError):
        return pd.DataFrame()
    if not len(sched) or not len(lines):
        return pd.DataFrame()
    chance = {}
    for r in probs.itertuples(index=False):
        p = _team_chance(r.player_prob_base, r.home_prob, r.nfl_model_src, r.elo_weight)
        if p is not None and r.espn_event_id is not None and not pd.isna(r.espn_event_id):
            chance[int(r.espn_event_id)] = p
    by_game, by_event = {}, {}
    if len(hist):
        for r in hist.itertuples(index=False):
            if r.p is None or not np.isfinite(r.p):
                continue
            by_game[str(r.game_id)] = float(r.p)
            if r.espn_event_id is not None and not pd.isna(r.espn_event_id):
                by_event[int(r.espn_event_id)] = float(r.p)
    team_prob = {}
    for row in sched.itertuples(index=False):
        if int(row.season) < RIDGE_FROM_SEASON or not _counted_type(row.game_type):
            continue
        gid = str(row.game_id)
        day = str(row.date)[:10]
        eid = None if pd.isna(row.espn_event_id) else int(row.espn_event_id)
        snap = chance.get(eid) if eid is not None else None
        if day >= SNAPSHOT_FROM:
            if snap is not None:
                team_prob[gid] = snap
            continue
        if snap is not None:
            team_prob[gid] = snap
        elif gid in by_game:
            team_prob[gid] = by_game[gid]
        elif eid is not None and eid in by_event:
            team_prob[gid] = by_event[eid]
    if not team_prob:
        return pd.DataFrame()
    sched = apply_pregame_qbs(sched, load_injury_status(conn))
    return stack_frame(sched, lines, team_prob)


def refit(conn, today, log=print):
    """Fit ridge_stack_qbA on completed games through yesterday.

    Raises when the frame cannot be fit, so the caller keeps publishing the
    current path and the previous fit stays in place.
    """
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    through = (today - timedelta(days=1)).isoformat()
    frame = load_training_frame(conn, through)
    packed = fit_matrix(frame, today)
    from . import db
    with db.immediate(conn):
        _save_fit(conn, today, packed, through)
    coefs = " ".join(
        f"{name} {value:.2f}" for name, value in zip(packed["features"], packed["coef"]))
    line = f"nfl ridge {VERSION} n={packed['n_games']} c={packed['c_value']:g} coef {coefs}"
    log(line)
    return line


def build_state(conn, today, log=print):
    """Replace nfl_qb_state with each quarterback's last game through yesterday."""
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    through = (today - timedelta(days=1)).isoformat()
    try:
        lines = pd.read_sql_query(
            "SELECT p.game_id, p.qb, s.game_date AS date, p.qb_epa, p.qb_n, p.cpoe_sum, p.cpoe_n "
            "FROM nfl_pbp_qb p JOIN nfl_schedule s ON s.game_id = p.game_id "
            "WHERE s.game_date <= ? AND s.home_score IS NOT NULL",
            conn, params=(through,))
    except (sqlite3.OperationalError, pd.errors.DatabaseError):
        lines = pd.DataFrame()
    rates, lq = qb_rates(lines)
    rows = []
    if len(rates) and np.isfinite(lq):
        rates = rates.sort_values(["qb", "date", "game_id"])
        for qb, g in rates.groupby("qb", sort=False):
            r = g.iloc[-1]
            js = {"qb_epa_r": float(r.qb_epa_r), "qb_expo": float(r.qb_expo),
                  "qb_epa": float(r.qb_epa), "qb_n": float(r.qb_n),
                  "cpoe_sum_r": float(r.cpoe_sum_r), "lq": float(lq)}
            rows.append((today.isoformat(), str(qb), pd.Timestamp(r.date).strftime("%Y-%m-%d"),
                         str(r.game_id), _jdump(js)))
    from . import db
    with db.immediate(conn):
        conn.execute("DELETE FROM nfl_qb_state")
        conn.executemany(
            "INSERT INTO nfl_qb_state (as_of_date, qb, last_game_date, last_game_id, state_json) "
            "VALUES (?,?,?,?,?)", rows)
    log(f"nfl qb state {len(rows)} through {through}")
    return len(rows)


def morning(conn, today, log=print):
    """Daily NFL step before apply: refit on Tuesday (or when no fit is
    stored), then replace quarterback state.

    A failure is reported in the returned note and does not raise. The last
    stored fit, and yesterday's state if the new one failed, stay available.
    """
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    parts = []
    if refit_due(conn, today):
        try:
            parts.append(refit(conn, today, log=log))
        except Exception as e:
            parts.append(f"nfl ridge refit skipped ({type(e).__name__}: {e})"[:180])
            log(traceback.format_exc())
    try:
        n = build_state(conn, today, log=log)
        parts.append(f"state {n}")
    except Exception as e:
        parts.append(f"nfl qb state skipped ({type(e).__name__}: {e})"[:180])
        log(traceback.format_exc())
    return "; ".join(p for p in parts if p)[:300]


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
        "n_games": int(row["n_games"]) if row["n_games"] is not None else 0,
    }


def _fit_bits(fit):
    """n_games and C for nfl_inputs. Missing fit is a dash."""
    if not fit or fit.get("n_games") is None:
        return "-", "-"
    n_txt = str(int(fit["n_games"]))
    c = fit.get("c_value")
    try:
        c_txt = f"{float(c):.4g}" if c is not None and np.isfinite(float(c)) else "-"
    except (TypeError, ValueError):
        c_txt = "-"
    return n_txt, c_txt


def load_fit(conn):
    """Latest stored qbA fit, or None."""
    try:
        row = conn.execute(
            "SELECT * FROM nfl_ridge_fits WHERE version = ? "
            "ORDER BY fit_date DESC, fit_id DESC LIMIT 1", (VERSION,)).fetchone()
    except sqlite3.OperationalError:
        return None
    return _unpack_fit(row) if row else None


def load_state_map(conn):
    """qb id → last-game state, and the league EPA rate stored with it."""
    try:
        rows = conn.execute(
            "SELECT qb, last_game_date, last_game_id, state_json FROM nfl_qb_state").fetchall()
    except sqlite3.OperationalError:
        return {}, None
    out, lq = {}, None
    for r in rows:
        js = json.loads(r["state_json"])
        if lq is None and js.get("lq") is not None:
            lq = float(js["lq"])
        out[str(r["qb"])] = js
    return out, lq


# ---------------------------------------------------------------- starters

def _gsis_for(conn, athlete_id):
    """nflverse id for an ESPN athlete, from the weekly roster or the id map."""
    if athlete_id is None:
        return None
    try:
        row = conn.execute(
            "SELECT gsis_id FROM nfl_weekly_roster_states WHERE gsis_id IS NOT NULL "
            "AND (espn_id = ? OR athlete_id = ?) ORDER BY season DESC, week DESC LIMIT 1",
            (int(athlete_id), int(athlete_id))).fetchone()
    except sqlite3.OperationalError:
        row = None
    if row and row[0]:
        return str(row[0])
    try:
        row = conn.execute(
            "SELECT ext_id FROM ext_ids WHERE source = 'nflverse' AND league = 'nfl' "
            "AND kind = 'player' AND espn_id = ? ORDER BY last_seen DESC LIMIT 1",
            (int(athlete_id),)).fetchone()
    except sqlite3.OperationalError:
        row = None
    return str(row[0]) if row and row[0] else None


def _lineup_qb(conn, event_id, team_id, as_of):
    """A starter or probable quarterback on the latest game-page fetch."""
    try:
        newest = conn.execute(
            "SELECT athlete_id, role FROM pregame_lineups WHERE espn_event_id = ? AND team_id = ? "
            "AND fetched_at = (SELECT MAX(fetched_at) FROM pregame_lineups "
            "WHERE espn_event_id = ? AND team_id = ? AND fetched_at <= ? "
            "AND athlete_id IS NOT NULL AND UPPER(COALESCE(position, '')) = 'QB' "
            "AND role IN ('starter', 'probable')) "
            "AND UPPER(COALESCE(position, '')) = 'QB' AND role IN ('starter', 'probable')",
            (int(event_id), int(team_id), int(event_id), int(team_id), as_of)).fetchall()
    except sqlite3.OperationalError:
        return None, None
    if not newest:
        return None, None
    starters = [r for r in newest if r["role"] == "starter"]
    pick = starters[0] if starters else newest[0]
    return int(pick["athlete_id"]), ("lineup" if pick["role"] == "starter" else "probable")


def _probable_qb(conn, event_id, team_id, as_of):
    """An open scoreboard probable whose kind is quarterback."""
    try:
        rows = conn.execute(
            "SELECT athlete_id, kind, status FROM game_probables WHERE espn_event_id = ? "
            "AND team_id = ? AND league = 'nfl' AND athlete_id IS NOT NULL "
            "AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)",
            (int(event_id), int(team_id), as_of, as_of)).fetchall()
    except sqlite3.OperationalError:
        return None, None
    qbs = []
    for r in rows:
        kind = (r["kind"] or "").upper()
        if kind in ("QB", "QUARTERBACK") or kind.startswith("QB"):
            qbs.append(r)
    if not qbs:
        return None, None
    confirmed = [r for r in qbs if (r["status"] or "").lower() == "confirmed"]
    pick = confirmed[0] if confirmed else qbs[0]
    return int(pick["athlete_id"]), "probable"


def _depth_qb(conn, event_id, team_id, as_of):
    """Highest depth-chart quarterback who is not ruled out. Not the previous starter."""
    from .player_adj import nfl_pick
    aid, src = nfl_pick(conn, event_id, team_id, as_of, as_of, {})
    if src == "depth" and aid is not None:
        return int(aid), "depth"
    return None, None


def confirmed_qb(conn, event_id, team_id, as_of):
    """(espn athlete id, source, nflverse id) or (None, None, None).

    A posted starter, a scoreboard probable, or the depth-chart quarterback
    who is not ruled out. The previous game's starter is not used.
    """
    aid, src = _lineup_qb(conn, event_id, team_id, as_of)
    if aid is None:
        aid, src = _probable_qb(conn, event_id, team_id, as_of)
    if aid is None:
        aid, src = _depth_qb(conn, event_id, team_id, as_of)
    if aid is None:
        return None, None, None
    return aid, src, _gsis_for(conn, aid)


def _prev_lookup(conn):
    """franchise → [(date, qb)] of scored games, oldest first."""
    try:
        rows = conn.execute(
            "SELECT game_date, home_franchise, away_franchise, home_qb_gsis, away_qb_gsis "
            "FROM nfl_schedule WHERE home_score IS NOT NULL AND game_date IS NOT NULL "
            "ORDER BY game_date, game_id").fetchall()
    except sqlite3.OperationalError:
        return {}
    out = {}
    for r in rows:
        for fr, qb in ((r["home_franchise"], r["home_qb_gsis"]),
                       (r["away_franchise"], r["away_qb_gsis"])):
            if not fr:
                continue
            out.setdefault(fr, []).append((r["game_date"], _qb_text(qb)))
    return out


def _immediate_prev(history, franchise, game_date):
    """Starter id of the franchise's latest scored game before `game_date`."""
    if not franchise or not history:
        return None
    rows = history.get(franchise) or []
    gd = str(game_date)[:10]
    prev = None
    for d, qb in rows:
        if d < gd:
            prev = qb
        else:
            break
    return prev


def _changed(prev, current):
    return int(isinstance(prev, str) and prev != "" and prev != current)


# ---------------------------------------------------------------- publishing

def shift_margin(team_prob, team_spread, total, home_tp, away_tp, ridge_prob):
    """Move the current path's margin onto the ridge chance.

    SLOPE points per unit of home logit, then the same favorite check as
    forecast.carry_margin. Team totals follow. The total does not.
    """
    from .margin import SLOPE
    s = SLOPE["nfl"]
    p = float(np.round(np.clip(ridge_prob, 0.0001, 0.9999), 4))
    m0 = -float(team_spread)
    m = m0 + s * (logit(p) - logit(team_prob))
    fav = float(np.sign(np.round(p - 0.5, 4)))
    if fav != 0 and float(np.sign(m)) != fav:
        m = s * logit(p)
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
    """Fingerprint of the starter feeds, the play-by-play state, and the fit."""
    parts = []
    for sql in ("SELECT MAX(as_of_date) FROM nfl_qb_state",
                "SELECT MAX(game_date) FROM nfl_schedule",
                "SELECT MAX(fit_date) FROM nfl_ridge_fits",
                "SELECT MAX(valid_from) FROM nfl_depth_states",
                "SELECT MAX(valid_from) FROM game_probables WHERE league = 'nfl'",
                "SELECT MAX(fetched_at) FROM nfl_inactives",
                "SELECT MAX(l.fetched_at) FROM pregame_lineups l JOIN games g "
                "ON g.espn_event_id = l.espn_event_id WHERE g.league = 'nfl' AND l.position = 'QB'"):
        try:
            parts.append(str(conn.execute(sql).fetchone()[0]))
        except sqlite3.Error:
            parts.append("-")
    return "|".join(parts)


def _franchises(conn, team_ids):
    if not team_ids:
        return {}
    q = ",".join("?" * len(team_ids))
    try:
        rows = conn.execute(
            f"SELECT team_id, abbreviation FROM teams WHERE team_id IN ({q})",
            tuple(int(t) for t in team_ids)).fetchall()
    except sqlite3.OperationalError:
        return {}
    return {int(r["team_id"]): canon(r["abbreviation"]) for r in rows}


# Yards per play allowed has no passer feature. A one-standard-deviation
# gap, with the slider at double its default, moves the margin by a quarter
# of a typical NFL game. Lower yards allowed helps that team. The total stays.
DYP_SHARE = 0.25
DYP_FALLBACK_SD = 0.45


def _prepare_slate(conn, frame, as_of):
    teams = sorted({int(t) for t in list(frame["home_team_id"]) + list(frame["away_team_id"])})
    starters = {}
    for i in range(len(frame)):
        eid = int(frame.at[i, "espn_event_id"])
        for tm in (int(frame.at[i, "home_team_id"]), int(frame.at[i, "away_team_id"])):
            if (eid, tm) not in starters:
                starters[(eid, tm)] = confirmed_qb(conn, eid, tm, as_of)
    return {
        "fit": load_fit(conn),
        "state": load_state_map(conn),
        "starters": starters,
        "prev": _prev_lookup(conn),
        "franchise": _franchises(conn, teams),
        "key": inputs_key(conn),
        "out_ids": _out_ids(conn),
        "conn": conn,
        "dypp": _yards_allowed(conn, teams),
    }


def _out_ids(conn):
    """Athletes the latest player values already count out. Empty if none."""
    try:
        row = conn.execute(
            "SELECT MAX(snapshot_date) FROM player_values WHERE league='nfl'").fetchone()
    except sqlite3.Error:
        return set()
    day = row[0] if row else None
    if not day:
        return set()
    try:
        rows = conn.execute(
            "SELECT athlete_id FROM player_values WHERE league='nfl' AND is_out=1 "
            "AND snapshot_date=?", (day,)).fetchall()
    except sqlite3.Error:
        return set()
    return {int(r[0]) for r in rows if r[0] is not None}


def _score_row(row, slate):
    """Audit fields, and the published prob and spread when the ridge runs.

    The current path's home_prob / home_spread / total are the inputs. They
    are left unchanged when the source is team.
    """
    eid = int(row["espn_event_id"])
    home, away = int(row["home_team_id"]), int(row["away_team_id"])
    gd = str(row["game_date"])[:10]
    team_prob = float(row["home_prob"])
    h_id, h_src, h_gsis = slate["starters"].get((eid, home), (None, None, None))
    a_id, a_src, a_gsis = slate["starters"].get((eid, away), (None, None, None))
    fit = slate["fit"]
    n_txt, c_txt = _fit_bits(fit)
    inputs = (f"k={slate['key']};home={h_id if h_id is not None else '-'}:{h_src or '-'};"
              f"away={a_id if a_id is not None else '-'}:{a_src or '-'};n={n_txt};c={c_txt}")
    base = {"nfl_model_src": "team", "nfl_team_prob": team_prob, "nfl_ridge_prob": None,
            "nfl_ridge_fit_id": None, "nfl_inputs": inputs}

    def finish(payload):
        payload = _attach_dypp(payload, slate, row)
        note = qb_note or _restore_note(slate, h_id, a_id)
        if not note:
            return payload
        out = dict(payload)
        out["scenario_note"] = note
        return out

    h_id, h_gsis, a_id, a_gsis, qb_note = _apply_qb_line(
        slate, h_id, h_gsis, a_id, a_gsis)

    state, lq = slate["state"]
    short = fit is None or int(fit.get("n_games") or 0) < MIN_PUBLISH_GAMES
    if h_src is None or a_src is None or short or lq is None or not np.isfinite(lq):
        return finish(base)
    if h_gsis is None or a_gsis is None:
        return finish(base)
    raw = row["player_prob_base"] if "player_prob_base" in row.index else None
    try:
        base_p = float(raw)
    except (TypeError, ValueError):
        return finish(base)
    if not np.isfinite(base_p):
        return finish(base)
    he, hx, hc = live_from_state(state.get(h_gsis), lq)
    ae, ax, ac = live_from_state(state.get(a_gsis), lq)
    he, hx, hc, ae, ax, ac = _scenario_qbs(
        slate.get("scenario"), slate.get("out_ids"), h_id, a_id, lq,
        he, hx, hc, ae, ax, ac)
    if not all(np.isfinite(v) for v in (he, hx, hc, ae, ax, ac)):
        return finish(base)
    fr = slate["franchise"]
    ch = _changed(_immediate_prev(slate["prev"], fr.get(home), gd), h_gsis)
    ca = _changed(_immediate_prev(slate["prev"], fr.get(away), gd), a_gsis)
    x = np.array([logit(base_p), he - ae, hc - ac, hx - ax, float(ch - ca)], float)
    names = list(fit["features"])
    if names != FEATURES or not np.isfinite(x).all():
        return finish(base)
    p = float(predict_stored(fit, x.reshape(1, -1))[0])
    new_p, spread, ht, at = shift_margin(
        team_prob, row["home_spread"], row["total_pred"],
        row["home_total_pred"], row["away_total_pred"], p)
    return finish({
        "nfl_model_src": "ridge_qb", "nfl_team_prob": team_prob, "nfl_ridge_prob": new_p,
        "nfl_ridge_fit_id": fit["fit_id"], "nfl_inputs": inputs,
        "home_prob": new_p, "home_spread": spread,
        "home_total_pred": ht, "away_total_pred": at})


def _apply_qb_line(slate, h_id, h_gsis, a_id, a_gsis):
    """Use a chosen starter when he has a saved line. Otherwise keep the confirmed one."""
    picked = ((slate.get("scenario") or {}).get("line") or {}).get("qb") or {}
    note = None

    def one(side, aid, gsis):
        nonlocal note
        raw = picked.get(side)
        if raw is None:
            return aid, gsis
        try:
            want = int(raw)
        except (TypeError, ValueError):
            return aid, gsis
        if aid is not None and want == int(aid):
            return aid, gsis
        conn = slate.get("conn")
        found = _gsis_for(conn, want) if conn is not None else None
        if not found:
            note = "That quarterback has no saved line."
            return aid, gsis
        return want, found

    h_id, h_gsis = one("h", h_id, h_gsis)
    a_id, a_gsis = one("a", a_id, a_gsis)
    return h_id, h_gsis, a_id, a_gsis, note


def _yards_allowed(conn, teams):
    """Season yards per play allowed, from the stored team counts."""
    if not teams:
        return {}
    marks = ",".join("?" * len(teams))
    try:
        rows = conn.execute(
            f"SELECT team_id, counts_json FROM team_game_stats "
            f"WHERE league='nfl' AND team_id IN ({marks})",
            tuple(int(t) for t in teams)).fetchall()
    except sqlite3.Error:
        return {}
    sums = {}
    for row in rows:
        try:
            counts = json.loads(row["counts_json"] if isinstance(row, sqlite3.Row)
                                else row[1])
            against = counts[1]
            yards, plays = float(against[0]), float(against[1])
        except (TypeError, ValueError, IndexError, KeyError, json.JSONDecodeError):
            continue
        if not np.isfinite(yards) or not np.isfinite(plays) or plays <= 0:
            continue
        bag = sums.setdefault(int(row["team_id"] if isinstance(row, sqlite3.Row) else row[0]),
                              [0.0, 0.0])
        bag[0] += yards
        bag[1] += plays
    out = {}
    for tid, (yards, plays) in sums.items():
        if plays > 0:
            out[tid] = yards / plays
    return out


def _dypp_gap(slate, home, away):
    """Away yards allowed minus home, in standard deviations. Positive helps home."""
    rates = slate.get("dypp") or {}
    try:
        home_r = float(rates[int(home)])
        away_r = float(rates[int(away)])
    except (KeyError, TypeError, ValueError):
        return None
    vals = [float(v) for v in rates.values() if v == v]
    if len(vals) >= 2:
        sd = float(np.std(vals, ddof=1))
    else:
        sd = DYP_FALLBACK_SD
    if not np.isfinite(sd) or sd < 1e-6:
        sd = DYP_FALLBACK_SD
    return (away_r - home_r) / sd


def _attach_dypp(payload, slate, row):
    """Move the margin by the yards-allowed gap. The total stays."""
    scales = (slate.get("scenario") or {}).get("scale") or {}
    if "dypp" not in scales:
        return payload
    try:
        mult = float(scales["dypp"])
    except (TypeError, ValueError):
        return payload
    if abs(mult - 1.0) < 0.02:
        return payload
    gap = _dypp_gap(slate, row["home_team_id"], row["away_team_id"])
    if gap is None:
        return payload
    from .margin import SD_MARGIN, SLOPE
    points = (mult - 1.0) * gap * SD_MARGIN["nfl"] * DYP_SHARE
    old_p = payload.get("home_prob", row["home_prob"])
    old_sp = payload.get("home_spread", row["home_spread"])
    try:
        old_p = float(old_p)
        old_sp = float(old_sp)
    except (TypeError, ValueError):
        return payload
    if not np.isfinite(old_p) or not np.isfinite(old_sp) or not np.isfinite(points):
        return payload
    new_p = 1.0 / (1.0 + np.exp(-(logit(old_p) + points / SLOPE["nfl"])))
    total = payload.get("total_pred", row.get("total_pred"))
    ht = payload.get("home_total_pred", row.get("home_total_pred"))
    at = payload.get("away_total_pred", row.get("away_total_pred"))
    new_p, spread, ht, at = shift_margin(old_p, old_sp, total, ht, at, new_p)
    out = dict(payload)
    out["home_prob"] = new_p
    out["home_spread"] = spread
    out["home_total_pred"] = ht
    out["away_total_pred"] = at
    if "total_pred" not in out and total is not None:
        out["total_pred"] = total
    return out


def _restore_note(slate, h_id, a_id):
    """Set when a toggle names someone other than the two confirmed starters.

    The fit only has those two. Putting a replaced starter back is not a
    second quarterback the overlay can score.
    """
    toggles = {int(a) for a in ((slate.get("scenario") or {}).get("toggle") or ())}
    starters = {int(a) for a in (h_id, a_id) if a is not None}
    if toggles - starters:
        return "A replaced starter can't be restored."
    return None


def _scenario_qbs(scenario, out_ids, h_id, a_id, lq, he, hx, hc, ae, ax, ac):
    """Sit a toggled starter who is in the forecast. Put an out starter back.

    A starter the forecast is already using, and who is counted out, stays
    on his own line when the box is unchecked. Replacing him there would
    take him out a second time. A starter who is in, and then checked out,
    goes to the no-state branch of live_from_state. Pass value and
    completion edge scale both sides, so a gap grows and a tie stays a tie.
    """
    scenario = scenario or {}
    toggles = {int(a) for a in (scenario.get("toggle") or ())}
    already = {int(a) for a in (out_ids or ())}
    scales = scenario.get("scale") or {}

    def one(aid, epa, exp, cpoe):
        if aid is not None and int(aid) in toggles and int(aid) not in already:
            epa, exp, cpoe = live_from_state(None, lq)
        try:
            epa = float(epa) * float(scales.get("epa", 1.0))
            cpoe = float(cpoe) * float(scales.get("cpoe", 1.0))
        except (TypeError, ValueError):
            pass
        return epa, exp, cpoe

    he, hx, hc = one(h_id, he, hx, hc)
    ae, ax, ac = one(a_id, ae, ax, ac)
    return he, hx, hc, ae, ax, ac


def overlay(conn, frame, as_of, today=None, scenario=None):
    """Publish the ridge chance on rows where both starters are confirmed.

    home_prob, home_spread and the team totals are the current NFL path
    (already through carry_margin). Rows that stay on that path keep those
    numbers and are stamped nfl_model_src = team. Does not write.
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
            _log_fallback("nfl", event_id, exc)
        return mark_team(f)
    probs = np.array(f["home_prob"], dtype=float, copy=True)
    for i in range(len(f)):
        try:
            scored = _score_row(f.loc[i], slate)
        except Exception as exc:
            event_id = f.at[i, "espn_event_id"] if "espn_event_id" in f.columns else "?"
            _log_fallback("nfl", event_id, exc)
            scored = {"nfl_model_src": "team", "nfl_team_prob": float(f.at[i, "home_prob"]),
                      "nfl_ridge_prob": None, "nfl_ridge_fit_id": None, "nfl_inputs": None}
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
    """Stamp the current path as the published NFL source. Probabilities stay."""
    if forecast is None or not len(forecast):
        return forecast
    f = forecast.copy()
    f["nfl_model_src"] = "team"
    f["nfl_team_prob"] = f["home_prob"].to_numpy(float)
    f["nfl_ridge_prob"] = np.nan
    f["nfl_ridge_fit_id"] = np.nan
    if "nfl_inputs" not in f.columns:
        f["nfl_inputs"] = None
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
    return overlay(conn, f, as_of, today)


# ---------------------------------------------------------------- refresh

def _ridge_current(series, key):
    return str(series or "").startswith(f"k={key};")


def refresh(conn, now=None, log=print, force=False):
    """Recompute the NFL chance for games that have not started and are not locked.

    The current path is rebuilt from the stored pre-player values, then the
    ridge replaces the published chance where both starters are confirmed.
    Past forecast_snapshots rows and existing locks are not read. `force`
    recomputes even when the fingerprints match, which is how a new fit
    reaches today's unlocked games.
    """
    from . import player_adj as pa
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    as_of = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    today = now.astimezone(pa.CHICAGO).date().isoformat()
    key = pa.inputs_key(conn, "nfl", today)
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
                params={"today": today, "lg": "nfl"})
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
            stamped = "nfl_inputs" in rows.columns and bool(rows["nfl_inputs"].notna().any())
            if stamped:
                ridge_same = bool(rows["nfl_inputs"].map(
                    lambda s: _ridge_current(s, ridge_key)).all())
            else:
                ridge_same = True
            if player_same and ridge_same:
                continue
        if state is None:
            state = pa.STATE_FN["nfl"](conn, today)

        def adjust(frame, _as=as_of):
            return overlay(conn, frame, _as)

        n = pa._refresh_rows(conn, "nfl", rows, table, pk, as_of, key, state, adjust=adjust)
        total += n
        if n:
            early = "" if table == "forecast_snapshots" else " early"
            log(f"nfl ridge refresh{early}: {n} of {len(rows)} forecasts updated")
    return total or None


def after_games(conn, today=None, log=print):
    """Refit and rebuild state after completed games landed, then refresh.

    The play-by-play pass calls this when the schedule or the quarterback
    lines changed. A failed refit keeps the previous fit. The state rebuild
    and the refresh of unlocked NFL forecasts still run.
    """
    from zoneinfo import ZoneInfo
    if today is None:
        today = datetime.now(ZoneInfo("America/Chicago")).date()
    elif not isinstance(today, date):
        today = date.fromisoformat(str(today)[:10])
    parts = []
    try:
        parts.append(refit(conn, today, log=log))
    except Exception as e:
        parts.append(f"nfl ridge refit skipped ({type(e).__name__}: {e})"[:180])
        log(traceback.format_exc())
    try:
        n = build_state(conn, today, log=log)
        parts.append(f"state {n}")
    except Exception as e:
        parts.append(f"nfl qb state skipped ({type(e).__name__}: {e})"[:180])
        log(traceback.format_exc())
    try:
        n = refresh(conn, datetime.now(timezone.utc), log=log, force=True)
        parts.append(f"refreshed {n}")
    except Exception as e:
        parts.append(f"nfl ridge refresh skipped ({type(e).__name__}: {e})"[:180])
        log(traceback.format_exc())
    return "; ".join(p for p in parts if p)[:300]


def _main(argv=None):
    """Fit the quarterback ridge, replace its state, and refresh unlocked forecasts.

    Past forecast rows and existing locks are not rewritten. Run it after the
    play-by-play load so a fit is stored before the next morning job. The
    morning job also fits when no fit is stored.
    """
    from . import db
    ap = argparse.ArgumentParser(description="Fit the NFL quarterback ridge and refresh unlocked forecasts")
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
