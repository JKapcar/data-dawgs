"""Starting pitcher (MLB) and starting goalie (NHL).

The rating model (2026-11) takes a pre-game covariate: home starter
team-relative quality minus away, 0 when that side is unknown. `model_rel`
and `prepare_model_edges` build it from earlier starts only. Stan estimates
the coefficient. The daily job does not also apply the outside shift below.

The October 2026 outside adjustment (`quality`, `apply_adjustment`,
`adjust_forecast`) is still here for the team-page player values and the
old backtest. It is a different formula (half FIP, longer memory) and the
forecast no longer calls it, so the two are not added together.

Outside adjustment, for that older path. The team rating already reflects a
team's usual rotation or goalie. This adds what today's starter is worth
relative to that usual starter:

  starter quality  MLB: runs a pitcher saves over his usual outing vs a
                   league-average pitcher (half FIP-style, half runs allowed,
                   per out, decayed and shrunk to a below-average prior).
                   NHL: goals a goalie saves per game vs league average
                   (decayed, shrunk save %).
  relative         quality minus the team's recent average starter quality
                   (180-day half-life, the rating model's own).

  win:    logit(p) += WIN_COEF  * (home relative - away relative)
  points: each side scores TOTAL_COEF * (opposing relative) fewer, so the
          total drops by TOTAL_COEF * (home + away) and the margin and team
          totals follow.

Only box lines from dates before the forecast day are used. A side with no
known starter, a starter with no box-line history, or a team with no prior
starts gets no adjustment (a team-average starter).

Coefficients are the constants below, from the Oct 2026 walk-forward:
one logistic offset coefficient and one least-squares totals coefficient,
fit on the out-of-sample baseline forecasts of every completed season with
box lines (MLB 2022-2026, NHL 2022-23 to 2026-27 to Oct 16).
"""

import sqlite3

import numpy as np
import pandas as pd

# metric settings (MLB: untuned, won out of sample; NHL: tested version)
PARAMS = {"mlb": {"hl": 365.0, "k_fip": 300.0, "k_ra": 900.0, "w_fip": 0.5},
          "nhl": {"hl": 1460.0, "k_sv": 1000.0}}
TEAM_HL = 180.0
PRIOR_PITCH_PENALTY = 1.05      # low-sample pitchers: 5% more runs than league
K_OUTS = 5.0                    # starts of prior for expected outs per start
PRIOR_SV_PENALTY = 0.003        # low-sample goalies: .003 below league save %

# Walk-forward coefficients. Forecasts do not apply these. player_values does.
COEFS = {"mlb": {"win": 0.0957, "total": 0.2465},
         "nhl": {"win": 0.5824, "total": 0.6386}}
LEAGUES = tuple(COEFS)
DAY0 = pd.Timestamp("2000-01-01")

AUDIT_COLS = ("home_starter_id", "away_starter_id", "home_starter_src",
              "away_starter_src", "home_starter_rel", "away_starter_rel",
              "home_prob_base", "total_pred_base", "starter_coef")


# ---------------------------------------------------------------- running sums

def _decayed_running(df, key, cols, hl):
    """Per row (df sorted by day), decay-weighted sums of `cols` over rows of
    the same key on EARLIER days. Same-day rows never see each other."""
    out = np.zeros((len(df), len(cols)))
    lam = np.log(2) / hl
    for _, idx in df.groupby(key, sort=False).indices.items():
        days = df["day"].to_numpy(float)[idx]
        vals = df[cols].to_numpy(float)[idx]
        acc = np.zeros(len(cols)); last = None
        pending = np.zeros(len(cols)); pday = None
        res = np.zeros((len(idx), len(cols)))
        for j in range(len(idx)):
            d = days[j]
            if pday is not None and d > pday:
                if last is not None:
                    acc *= np.exp(-lam * (pday - last))
                acc += pending; last = pday
                pending = np.zeros(len(cols)); pday = None
            res[j] = acc * (np.exp(-lam * (d - last)) if last is not None else 0)
            pending += vals[j]; pday = d
        out[idx] = res
    return out


def _league_running(df, cols, hl):
    """Decay-weighted league totals over days strictly before each row."""
    daily = df.groupby("day")[cols].sum().sort_index()
    lam = np.log(2) / hl
    acc = np.zeros(len(cols)); last = None; res = {}
    for d, row in daily.iterrows():
        res[d] = acc * (np.exp(-lam * (d - last)) if last is not None else 0)
        if last is not None:
            acc = acc * np.exp(-lam * (d - last))
        acc = acc + row.to_numpy(float); last = d
    return np.vstack([res[d] for d in df["day"]]) if len(df) else np.zeros((0, len(cols)))


# ---------------------------------------------------------------- quality

def load_lines(conn, league):
    """Every regular/postseason box line, with `start` = this line is the
    team's starter (first pitcher / first goalie listed)."""
    if league == "mlb":
        df = pd.read_sql_query(
            "SELECT espn_event_id, game_date, team_id, athlete_id, pitch_order AS ord, "
            "outs, r, bb, k, hr FROM player_game_mlb_pitching WHERE season_type IN (2,3)", conn)
    elif league == "nhl":
        # the first goalie listed started; the most-TOI goalie differs after early pulls
        df = pd.read_sql_query(
            "SELECT espn_event_id, game_date, team_id, athlete_id, goalie_order AS ord, "
            "sa, ga FROM player_game_nhl_goalie WHERE season_type IN (2,3)", conn)
    else:
        raise ValueError(f"no starter model for {league!r}")
    df["start"] = (df["ord"] == 1).astype(int)
    df["pseudo"] = 0
    return df


def pseudo_lines(starters, league):
    """Zero-stat rows for upcoming starters, so the same running sums give
    their pre-game quality. starters: espn_event_id, game_date, team_id,
    athlete_id."""
    s = starters[["espn_event_id", "game_date", "team_id", "athlete_id"]].copy()
    stats = ("outs", "r", "bb", "k", "hr") if league == "mlb" else ("sa", "ga")
    for c in stats:
        s[c] = 0
    s["ord"] = 1; s["start"] = 1; s["pseudo"] = 1
    return s


def quality(lines, league, params=None):
    """Per starter row: q (pre-game quality), prior_w (decayed history
    weight; 0 = no history), team_avg, rel, team_w. Pseudo rows carry no
    stats and never count toward a team's average."""
    p = dict(PARAMS[league], **(params or {}))
    df = lines.copy()
    df["day"] = (pd.to_datetime(df["game_date"]) - DAY0).dt.days
    df = df.sort_values(["day", "espn_event_id", "ord"], kind="stable").reset_index(drop=True)
    real = 1 - df["pseudo"].astype(int)
    if league == "mlb":
        df["fipn"] = 13 * df["hr"] + 3 * df["bb"] - 2 * df["k"]
        df["is_start"] = df["start"] * real
        df["start_outs"] = df["outs"] * df["is_start"]
        cols = ["outs", "r", "fipn", "is_start", "start_outs"]
        me = _decayed_running(df, "athlete_id", cols, p["hl"])
        lg = _league_running(df, cols, p["hl"])
        O, R, N, S, SO = me.T
        lO, lR, lN, lS, lSO = lg.T
        with np.errstate(divide="ignore", invalid="ignore"):
            lg_ra = np.where(lO > 0, lR / lO, np.nan)
            lg_fipn = np.where(lO > 0, lN / lO, np.nan)
            lg_so = np.where(lS > 0, lSO / lS, 15.0)
        prior = lg_ra * PRIOR_PITCH_PENALTY
        fip = (N - lg_fipn * O + lg_ra * O + p["k_fip"] * prior) / (O + p["k_fip"])
        ra = (R + p["k_ra"] * prior) / (O + p["k_ra"])
        rate = p["w_fip"] * fip + (1 - p["w_fip"]) * ra
        exp_outs = (SO + K_OUTS * lg_so) / (S + K_OUTS)
        df["prior_w"] = O
        df["q"] = (lg_ra - rate) * exp_outs
    else:
        df["sv"] = df["sa"] - df["ga"]
        df["gp"] = df["start"] * real
        me = _decayed_running(df, "athlete_id", ["sa", "sv"], p["hl"])
        lg = _league_running(df, ["sa", "sv", "gp"], p["hl"])
        SA, SV = me.T
        lSA, lSV, lGP = lg.T
        with np.errstate(divide="ignore", invalid="ignore"):
            lg_sv = np.where(lSA > 0, lSV / lSA, np.nan)
            lg_spg = np.where(lGP > 0, lSA / lGP, 30.0)
        sv = (SV + p["k_sv"] * (lg_sv - PRIOR_SV_PENALTY)) / (SA + p["k_sv"])
        df["prior_w"] = SA
        df["q"] = (sv - lg_sv) * lg_spg
    st = df[(df["start"] == 1) & np.isfinite(df["q"])].copy().reset_index(drop=True)
    st["_real"] = 1 - st["pseudo"].astype(int)
    st["_qr"] = st["q"] * st["_real"]
    s = _decayed_running(st, "team_id", ["_qr", "_real"], TEAM_HL)
    st["team_w"] = s[:, 1]
    st["team_avg"] = np.where(s[:, 1] > 0, s[:, 0] / np.maximum(s[:, 1], 1e-12), 0.0)
    st["rel"] = st["q"] - st["team_avg"]
    return st.drop(columns=["_real", "_qr"])


# ---------------------------------------------------------------- live starters

# change-only logging tables: the state at T is valid_from <= T < valid_to
STATE_AT = "valid_from <= :as_of AND (valid_to IS NULL OR valid_to > :as_of)"

# (source, query) in priority order per league
SOURCES = {
    "mlb": (
        ("espn", "SELECT espn_event_id, team_id, athlete_id, name FROM game_probables "
                 "WHERE league = 'mlb' AND kind = 'SP'"),
        # only ids we know as this team's ESPN pitcher: some Stats API -> ESPN
        # id matches point outside our box-score ids
        ("mlbapi", "SELECT espn_event_id, team_id, athlete_id, name FROM mlb_lineup_states l "
                   "WHERE slot = 0 AND EXISTS (SELECT 1 FROM players p WHERE "
                   "p.league = 'mlb' AND p.athlete_id = l.athlete_id AND p.team_id = l.team_id)"),
    ),
    "nhl": (
        ("dfo", "SELECT espn_event_id, team_id, athlete_id, goalie_name AS name "
                "FROM nhl_goalie_states WHERE strength IN ('Confirmed', 'Likely')"),
        ("espn", "SELECT espn_event_id, team_id, athlete_id, name FROM game_probables "
                 "WHERE league = 'nhl' AND kind = 'SG'"),
    ),
}


def known_starters(conn, league, event_ids, as_of):
    """Best starter known at `as_of` (ISO UTC, '+00:00' form, like the
    logging tables) per (espn_event_id, team_id): espn_event_id, team_id,
    athlete_id, name, src.
      MLB: ESPN probable, else MLB Stats API probable (lineup slot 0).
      NHL: Daily Faceoff Confirmed/Likely, else ESPN probable."""
    ids = ",".join(str(int(e)) for e in event_ids) or "NULL"   # ints, safe to inline
    q = [(src, f"{sql} AND athlete_id IS NOT NULL AND team_id IS NOT NULL "
               f"AND espn_event_id IN ({ids}) AND {STATE_AT}")
         for src, sql in SOURCES[league]]
    frames = []
    for rank, (src, sql) in enumerate(q):
        try:
            f = pd.read_sql_query(sql, conn, params={"as_of": as_of})
        except (sqlite3.OperationalError, pd.errors.DatabaseError):
            continue               # a logging table missing on an old DB: skip that source
        f["src"], f["rank"] = src, rank
        frames.append(f)
    cols = ["espn_event_id", "team_id", "athlete_id", "name", "src"]
    if not frames:
        return pd.DataFrame(columns=cols)
    f = pd.concat(frames, ignore_index=True)
    f = f.sort_values(["espn_event_id", "team_id", "rank"]).drop_duplicates(
        ["espn_event_id", "team_id"], keep="first")
    return f[cols].reset_index(drop=True)


def starter_values(conn, league, sched, as_of, lines=None):
    """Per scheduled game: home/away starter id, source, and relative quality
    (0 when unknown or no history). sched needs espn_event_id, date,
    home_team, away_team (team ids as text or int)."""
    sched = sched.reset_index(drop=True)
    out = pd.DataFrame({"espn_event_id": sched["espn_event_id"].astype(int)})
    for side in ("home", "away"):
        out[f"{side}_starter_id"] = pd.array([pd.NA] * len(out), dtype="Int64")
        out[f"{side}_starter_name"] = None
        out[f"{side}_starter_src"] = None
        out[f"{side}_starter_rel"] = 0.0
    if not len(sched):
        return out
    ks = known_starters(conn, league, out["espn_event_id"].tolist(), as_of)
    rows = []
    for side in ("home", "away"):
        m = pd.DataFrame({"espn_event_id": out["espn_event_id"],
                          "game_date": sched["date"].astype(str).str[:10],
                          "team_id": sched[f"{side}_team"].astype(int), "side": side})
        rows.append(m.merge(ks, on=["espn_event_id", "team_id"], how="inner"))
    known = pd.concat(rows, ignore_index=True)
    if not len(known):
        return out
    if lines is None:
        lines = load_lines(conn, league)
    ps = pseudo_lines(known, league)
    ps["side"] = known["side"].values
    st = quality(pd.concat([lines, ps], ignore_index=True), league)
    st = st[st["pseudo"] == 1]
    st = known.merge(st[["espn_event_id", "team_id", "athlete_id", "rel", "prior_w", "team_w"]],
                     on=["espn_event_id", "team_id", "athlete_id"], how="left")
    pos = {e: i for i, e in enumerate(out["espn_event_id"])}
    for r in st.itertuples(index=False):
        i, s = pos[r.espn_event_id], r.side
        # no history (or no team history): team-average starter, no shift
        ok = pd.notna(r.rel) and r.prior_w > 0 and r.team_w > 0
        out.at[i, f"{s}_starter_id"] = int(r.athlete_id)
        out.at[i, f"{s}_starter_name"] = r.name
        out.at[i, f"{s}_starter_src"] = r.src if ok else f"{r.src}:nohist"
        out.at[i, f"{s}_starter_rel"] = float(r.rel) if ok else 0.0
    return out


# ---------------------------------------------------------------- application

def apply_adjustment(forecast, rel_home, rel_away, coefs):
    """New forecast frame with the starter shift applied to win chance,
    total, margin and team totals, plus home_prob_base / total_pred_base.
    Zero relative values leave a game exactly as it was."""
    from .forecast import apply_home_probs
    f = forecast.reset_index(drop=True).copy()
    rh = np.asarray(rel_home, dtype=float)
    ra = np.asarray(rel_away, dtype=float)
    p0 = f["home_prob"].to_numpy(float)
    t0 = f["total_pred"].to_numpy(float)
    m0 = -f["home_spread"].to_numpy(float)
    pc = np.clip(p0, 1e-6, 1 - 1e-6)
    p = 1 / (1 + np.exp(-(np.log(pc / (1 - pc)) + coefs["win"] * (rh - ra))))
    p = np.where((rh == 0) & (ra == 0), p0, p)
    total = np.maximum(t0 - coefs["total"] * (rh + ra), 0.0)
    margin = m0 + coefs["total"] * (rh - ra)
    home_t = np.clip((total + margin) / 2, 0, total)
    changed = (rh != 0) | (ra != 0)
    f = apply_home_probs(f, np.round(p, 4))
    f["total_pred"] = np.where(changed, np.round(total, 1), t0)
    f["home_spread"] = np.where(changed, np.round(-margin, 1), f["home_spread"])
    f["away_spread"] = np.where(changed, np.round(margin, 1), f["away_spread"])
    f["home_total_pred"] = np.where(changed, np.round(home_t, 1), f["home_total_pred"])
    f["away_total_pred"] = np.where(changed, np.round(total - home_t, 1), f["away_total_pred"])
    f["home_prob_base"] = p0
    f["total_pred_base"] = t0
    return f


def adjust_forecast(conn, league, sched, forecast, as_of, coefs=None):
    """Forecast with the starter adjustment and the audit columns
    (AUDIT_COLS) attached, row-aligned with `sched`."""
    coefs = coefs or COEFS[league]
    sv = starter_values(conn, league, sched, as_of)
    f = apply_adjustment(forecast, sv["home_starter_rel"], sv["away_starter_rel"], coefs)
    for c in ("home_starter_id", "away_starter_id", "home_starter_src",
              "away_starter_src", "home_starter_rel", "away_starter_rel",
              "home_starter_name", "away_starter_name"):
        f[c] = sv[c].values
    return f


# ------------------------------------------------------- in-model covariate
#
# Research definition (2026-11), not the outside quality() above.
# MLB starter logs, half-life 180 days, earlier dates only:
#   lg = runs / outs
#   rate = (sum_runs + 150 * lg * 1.08) / (sum_outs + 150)
#   q = (lg - rate) * 16.5
# NHL starting-goalie logs, half-life 365 days:
#   lg = saves / shots
#   sv = (saves + 1500 * (lg - 0.003)) / (shots + 1500)
#   q = (sv - lg) * 28
# Team-relative: q minus the team's decayed (half-life 60 days, one weight
# per start) average q of its earlier starters. League rate uses the same
# half-life as the player, earlier dates only, so it is the current rate.

EDGE = {"mlb": {"hl": 180.0, "team_hl": 60.0, "k": 150.0, "penalty": 1.08, "per": 16.5},
        "nhl": {"hl": 365.0, "team_hl": 60.0, "k": 1500.0, "penalty": 0.003, "per": 28.0}}
_EDGE_STATS = {"mlb": ("outs", "runs_allowed"), "nhl": ("shots_against", "saves")}


def model_rel(lines, league):
    """Pre-game starter quality on each row of `lines`.

    Required columns: game_date, team_id, athlete_id, and the league's
    counting stats (`outs` and `runs_allowed`, or `shots_against` and
    `saves`). `pseudo` = 1 marks a row that must not enter the sums (an
    upcoming start). Same-day rows never see each other. A row with no
    earlier league sample gets q = 0. A team with no earlier start gets
    rel = 0. Returns the frame with q, rel, prior_w, team_w."""
    spec = EDGE[league]
    stats = _EDGE_STATS[league]
    df = lines.copy()
    if "pseudo" not in df.columns:
        df["pseudo"] = 0
    df["pseudo"] = df["pseudo"].fillna(0).astype(int)
    # Zero a pseudo row's stats before the sort, while the index still matches.
    pre_real = 1 - df["pseudo"]
    for c in stats:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0) * pre_real
    if "espn_event_id" not in df.columns:
        df["espn_event_id"] = 0
    df["athlete_id"] = pd.to_numeric(df["athlete_id"], errors="coerce")
    df["team_id"] = pd.to_numeric(df["team_id"], errors="coerce")
    df = df[df["athlete_id"].notna() & df["team_id"].notna()].copy()
    df["athlete_id"] = df["athlete_id"].astype(int)
    df["team_id"] = df["team_id"].astype(int)
    df["day"] = (pd.to_datetime(df["game_date"]) - DAY0).dt.days.astype(float)
    df = df.sort_values(["day", "espn_event_id", "athlete_id"], kind="mergesort").reset_index(drop=True)
    me = _decayed_running(df, "athlete_id", list(stats), spec["hl"])
    lg = _league_running(df, list(stats), spec["hl"])
    den = me[:, 0]
    num = me[:, 1]
    lden = lg[:, 0]
    lnum = lg[:, 1]
    with np.errstate(divide="ignore", invalid="ignore"):
        lg_rate = np.where(lden > 0, lnum / lden, np.nan)
    k = spec["k"]
    if league == "mlb":
        rate = (num + k * lg_rate * spec["penalty"]) / (den + k)
        q = (lg_rate - rate) * spec["per"]
    else:
        sv = (num + k * (lg_rate - spec["penalty"])) / (den + k)
        q = (sv - lg_rate) * spec["per"]
    # Recompute after the sort: a Series from before it would align on the old index.
    real = (1 - df["pseudo"].to_numpy()).astype(float)
    df["prior_w"] = den
    df["q"] = np.where(np.isfinite(q), q, 0.0)
    df["_one"] = real
    df["_qw"] = df["q"].to_numpy() * real
    team = _decayed_running(df, "team_id", ["_qw", "_one"], spec["team_hl"])
    df["team_w"] = team[:, 1]
    team_avg = np.where(team[:, 1] > 0, team[:, 0] / np.maximum(team[:, 1], 1e-12), 0.0)
    df["rel"] = np.where(df["team_w"] > 0, df["q"] - team_avg, 0.0)
    return df.drop(columns=["_one", "_qw"])


def _event_col(df) -> str:
    if "espn_event_id" in df.columns:
        return "espn_event_id"
    if "game_id" in df.columns:
        return "game_id"
    raise KeyError("starter edges need espn_event_id or game_id")


def attach_starter_edges(games, logs, league) -> pd.DataFrame:
    """Copy `games` with home/away relative quality and `starter_edge`.

    `logs` are the actual starts (one row per team per game). A side with
    no start in the logs gets relative quality 0, and the edge is the
    difference. `games` keeps its row order."""
    g = games.copy()
    g["home_starter_rel"] = 0.0
    g["away_starter_rel"] = 0.0
    g["starter_edge"] = 0.0
    if logs is None or not len(logs) or not len(g):
        return g
    ev = _event_col(g)
    rel = model_rel(logs, league)
    rel = rel[rel["pseudo"] == 0] if "pseudo" in rel.columns else rel
    key = rel[[_event_col(rel), "team_id", "rel"]].copy()
    key = key.rename(columns={_event_col(rel): ev})
    key[ev] = key[ev].astype(int)
    key["team_id"] = key["team_id"].astype(str)
    key = key.drop_duplicates([ev, "team_id"], keep="first")
    g[ev] = g[ev].astype(int)
    order = g.index
    home = key.rename(columns={"team_id": "home_team", "rel": "_hrel"})
    away = key.rename(columns={"team_id": "away_team", "rel": "_arel"})
    g["home_team"] = g["home_team"].astype(str)
    g["away_team"] = g["away_team"].astype(str)
    g = g.merge(home, on=[ev, "home_team"], how="left")
    g = g.merge(away, on=[ev, "away_team"], how="left")
    g.index = order
    g["home_starter_rel"] = g["_hrel"].fillna(0.0)
    g["away_starter_rel"] = g["_arel"].fillna(0.0)
    g["starter_edge"] = g["home_starter_rel"] - g["away_starter_rel"]
    return g.drop(columns=["_hrel", "_arel"])


def load_starter_logs(conn, league) -> pd.DataFrame:
    """Actual starts for the in-model covariate. MLB is the first pitcher
    listed; NHL is the first goalie listed (who started, not most time on ice)."""
    if league == "mlb":
        sql = ("SELECT espn_event_id, game_date, team_id, athlete_id, "
               "outs, r AS runs_allowed FROM player_game_mlb_pitching "
               "WHERE season_type IN (2, 3) AND pitch_order = 1")
    elif league == "nhl":
        sql = ("SELECT espn_event_id, game_date, team_id, athlete_id, "
               "sa AS shots_against, sv AS saves FROM player_game_nhl_goalie "
               "WHERE season_type IN (2, 3) AND goalie_order = 1")
    else:
        raise ValueError(f"no in-model starter for {league!r}")
    df = pd.read_sql_query(sql, conn)
    df["pseudo"] = 0
    return df


def _blank_starter_cols(sched: pd.DataFrame) -> pd.DataFrame:
    s = sched.copy()
    for side in ("home", "away"):
        s[f"{side}_starter_id"] = pd.array([pd.NA] * len(s), dtype="Int64")
        s[f"{side}_starter_name"] = None
        s[f"{side}_starter_src"] = None
        s[f"{side}_starter_rel"] = 0.0
    s["starter_edge"] = 0.0
    return s


def prepare_model_edges(conn, league, done, sched, as_of):
    """Attach pre-game starter edges to completed games and to the schedule.

    Completed games use the pitcher or goalie who actually started. The
    schedule uses the probable known at `as_of`. Quality on both uses only
    earlier starts. Returns (done, sched), row order unchanged. `sched` is
    the daily schedule frame, which keeps `espn_event_id`."""
    logs = load_starter_logs(conn, league)
    done_out = attach_starter_edges(done, logs, league) if len(done) else done.copy()
    sched_out = _blank_starter_cols(sched).reset_index(drop=True)
    if not len(sched_out):
        return done_out, sched_out
    ks = known_starters(conn, league, sched_out["espn_event_id"].astype(int).tolist(), as_of)
    if not len(ks):
        # still record edges of 0; training edges are on done_out
        if "starter_edge" not in done_out.columns and len(done_out):
            done_out["starter_edge"] = 0.0
        return done_out, sched_out
    rows = []
    for side in ("home", "away"):
        m = pd.DataFrame({
            "espn_event_id": sched_out["espn_event_id"].astype(int),
            "game_date": sched_out["date"].astype(str).str[:10],
            "team_id": sched_out[f"{side}_team"].astype(int),
            "side": side,
        })
        rows.append(m.merge(ks, on=["espn_event_id", "team_id"], how="inner"))
    known = pd.concat(rows, ignore_index=True)
    if not len(known):
        return done_out, sched_out
    pseudo = known[["espn_event_id", "game_date", "team_id", "athlete_id"]].copy()
    for c in _EDGE_STATS[league]:
        pseudo[c] = 0.0
    pseudo["pseudo"] = 1
    hist = logs.copy()
    hist["pseudo"] = 0
    rel = model_rel(pd.concat([hist, pseudo], ignore_index=True), league)
    rel = rel[rel["pseudo"] == 1]
    got = known.merge(
        rel[["espn_event_id", "team_id", "athlete_id", "rel", "prior_w", "team_w"]],
        on=["espn_event_id", "team_id", "athlete_id"], how="left")
    pos = {int(e): i for i, e in enumerate(sched_out["espn_event_id"].astype(int))}
    for r in got.itertuples(index=False):
        i = pos.get(int(r.espn_event_id))
        if i is None:
            continue
        side = r.side
        ok = pd.notna(r.rel)
        sched_out.at[i, f"{side}_starter_id"] = int(r.athlete_id)
        sched_out.at[i, f"{side}_starter_name"] = r.name
        sched_out.at[i, f"{side}_starter_src"] = r.src
        sched_out.at[i, f"{side}_starter_rel"] = float(r.rel) if ok else 0.0
    sched_out["starter_edge"] = (sched_out["home_starter_rel"].to_numpy(float)
                                 - sched_out["away_starter_rel"].to_numpy(float))
    return done_out, sched_out


def annotate_in_model(forecast, sched, res) -> pd.DataFrame:
    """Audit columns for a forecast whose win chance already includes the
    starter covariate. Does not move the chance, the spread, or the total.
    `home_prob_base` is the same posterior with the starter edge set to 0
    (back-to-back flags, when present, stay). `total_pred_base` is the
    total, which the starter coefficient does not shift."""
    from .ratings import posterior_home_prob
    f = forecast.reset_index(drop=True).copy()
    s = sched.reset_index(drop=True)
    if len(f) != len(s):
        raise RuntimeError("forecast rows do not match schedule rows")
    for c in ("home_starter_id", "away_starter_id", "home_starter_src",
              "away_starter_src", "home_starter_rel", "away_starter_rel",
              "home_starter_name", "away_starter_name"):
        if c in s.columns:
            f[c] = s[c].values
    neutral = s["neutral"].to_numpy() if "neutral" in s.columns else np.zeros(len(s))
    home_b2b = s["home_b2b"].to_numpy() if "home_b2b" in s.columns else None
    away_b2b = s["away_b2b"].to_numpy() if "away_b2b" in s.columns else None
    p0 = posterior_home_prob(
        res["fit"], s["home_team"], s["away_team"], neutral, res["teams"],
        home_b2b, away_b2b, np.zeros(len(s)))
    f["home_prob_base"] = np.round(np.clip(p0, 0.0001, 0.9999), 4)
    f["total_pred_base"] = f["total_pred"].to_numpy()
    return f


# ------------------------------------------------------- intraday MLB probables

def _finite(v) -> bool:
    if v is None or isinstance(v, str):
        return False
    try:
        return bool(np.isfinite(float(v)))
    except (TypeError, ValueError):
        return False


def _sid(v):
    if not _finite(v):
        return None
    return int(v)


def probable_changed(before, after) -> list:
    """Event ids whose {team_id: athlete_id} probable map changed.

    `before` and `after` are {espn_event_id: {team_id: athlete_id}}. A
    last_seen bump with the same athletes is not a change. A new pitcher,
    a missing side, or a dropped game is."""
    return sorted(e for e in set(before) | set(after) if before.get(e, {}) != after.get(e, {}))


def team_chance(p_base, coef, edge) -> float:
    """Win chance after moving the starter edge, on the logit of the
    no-starter posterior. Rounded the same way the morning chance is."""
    p = float(np.clip(p_base, 1e-4, 1 - 1e-4))
    z = np.log(p / (1 - p)) + float(coef) * float(edge)
    return float(np.round(np.clip(1 / (1 + np.exp(-z)), 0.0001, 0.9999), 4))


def recover_coef(p_base, p_with, edge, min_edge=0.05):
    """Morning coefficient implied by the stored bases, or None when the
    old edge is too small to read one off."""
    if not _finite(p_base) or not _finite(p_with) or not _finite(edge):
        return None
    if abs(float(edge)) < min_edge:
        return None
    pb = float(np.clip(p_base, 1e-4, 1 - 1e-4))
    pw = float(np.clip(p_with, 1e-4, 1 - 1e-4))
    return float((np.log(pw / (1 - pw)) - np.log(pb / (1 - pb))) / float(edge))


def sp_map(conn, event_ids, as_of) -> dict:
    """Current MLB probable pitchers at `as_of`: {event: {team_id: athlete_id}}."""
    ids = [int(e) for e in event_ids]
    out = {e: {} for e in ids}
    if not ids:
        return out
    q = ("SELECT espn_event_id, team_id, athlete_id FROM game_probables "
         f"WHERE league = 'mlb' AND kind = 'SP' AND athlete_id IS NOT NULL "
         f"AND espn_event_id IN ({','.join('?' * len(ids))}) "
         "AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)")
    for eid, tid, aid in conn.execute(q, (*ids, as_of, as_of)):
        if tid is None:
            continue
        out[int(eid)][int(tid)] = int(aid)
    return out


_REFRESH_COLS = (
    "home_prob", "away_prob", "home_spread", "total_pred", "home_total_pred",
    "away_total_pred", "p_logit", "player_prob_base", "starter_coef",
    "home_starter_id", "away_starter_id", "home_starter_src", "away_starter_src",
    "home_starter_rel", "away_starter_rel")


def _apply_new_starter(row, edged, coef):
    """One forecast row with the new probable. Returns (series, moved_chance).

    The chance moves from home_prob_base by coef * the new edge. When the
    player bases are stored, the player term and the margin carry run again
    from those bases, so a refresh does not stack on a refresh. A locked
    row never reaches here."""
    new = row.copy()
    for side in ("home", "away"):
        new[f"{side}_starter_id"] = _sid(edged.get(f"{side}_starter_id"))
        src = edged.get(f"{side}_starter_src")
        new[f"{side}_starter_src"] = None if src is None or (isinstance(src, float) and np.isnan(src)) else src
        rel = edged.get(f"{side}_starter_rel")
        new[f"{side}_starter_rel"] = float(rel) if _finite(rel) else 0.0
    base = new.get("home_prob_base")
    if not _finite(base) or coef is None:
        return new, False
    edge = float(new["home_starter_rel"]) - float(new["away_starter_rel"])
    p_team = team_chance(base, coef, edge)
    new["starter_coef"] = float(coef)
    if _finite(new.get("player_spread_base")):
        from .forecast import carry_margin
        from . import player_adj
        new["player_prob_base"] = p_team
        new["home_spread"] = float(new["player_spread_base"])
        if _finite(new.get("player_total_base")):
            new["total_pred"] = float(new["player_total_base"])
        if _finite(new.get("player_home_total_base")):
            new["home_total_pred"] = float(new["player_home_total_base"])
        if _finite(new.get("player_away_total_base")):
            new["away_total_pred"] = float(new["player_away_total_base"])
        for c in ("home_player_x", "away_player_x", "home_player_x2", "away_player_x2"):
            if not _finite(new.get(c)):
                new[c] = 0.0
        if not _finite(new.get("elo_weight")):
            new["elo_weight"] = 0.0
        frame = pd.DataFrame([new])
        frame = player_adj.restack(frame, "mlb")
        frame = carry_margin(frame, "mlb")
        return frame.iloc[0], True
    w = float(new["elo_weight"]) if _finite(new.get("elo_weight")) else 0.0
    pe = new.get("p_elo")
    pub = (1 - w) * p_team + w * float(pe) if _finite(pe) and w > 0 else p_team
    pub = float(np.round(np.clip(pub, 0.0001, 0.9999), 4))
    new["home_prob"] = pub
    new["away_prob"] = float(np.round(1 - pub, 4))
    if "p_logit" in new.index:
        new["p_logit"] = p_team
    if _finite(new.get("player_prob_base")) or "player_prob_base" in new.index:
        new["player_prob_base"] = p_team
    return new, True


def refresh_mlb(conn, event_ids, now, as_of=None, log=print) -> int:
    """Rewrite unlocked MLB forecasts whose probable pitcher changed.

    Reads the probable known at `as_of`, moves the team chance from
    home_prob_base with the stored (or recovered) morning coefficient, then
    reapplies the player term from the stored bases. A game inside the
    5-minute lock margin, a started game, a backfilled row, and a row in
    forecast_locks are left as stored. Returns rows rewritten."""
    from datetime import timezone
    from .player_adj import LOCK_MARGIN
    from .prelog import Tx

    ids = [int(e) for e in event_ids]
    if not ids or now is None:
        return 0
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    as_of = as_of or now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    ph = ",".join("?" * len(ids))
    locked = {int(r[0]) for r in conn.execute(
        f"SELECT espn_event_id FROM forecast_locks WHERE espn_event_id IN ({ph})", ids)}
    n = 0
    for table, pk, extra in (
            ("forecast_snapshots", ("snapshot_date", "espn_event_id"), "AND f.backfilled = 0"),
            ("upcoming_forecasts", ("espn_event_id",), "")):
        have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        if "home_prob" not in have:
            continue
        want = ["espn_event_id", "snapshot_date", "game_date", "home_team_id", "away_team_id",
                "home_prob", "away_prob", "home_spread", "total_pred", "home_total_pred",
                "away_total_pred", "home_starter_id", "away_starter_id", "home_starter_src",
                "away_starter_src", "home_starter_rel", "away_starter_rel", "home_prob_base",
                "starter_coef", "player_prob_base", "player_spread_base", "player_total_base",
                "player_home_total_base", "player_away_total_base", "home_player_x",
                "away_player_x", "home_player_x2", "away_player_x2", "p_logit", "p_elo",
                "elo_weight"]
        cols = [c for c in want if c in have or c in ("espn_event_id", "game_date", "home_team_id", "away_team_id")]
        cols = [c for c in cols if c in have]
        sql = (f"SELECT {', '.join('f.' + c for c in cols)}, g.start_time_utc, g.season "
               f"FROM {table} f JOIN games g ON g.espn_event_id = f.espn_event_id "
               f"WHERE f.league = 'mlb' AND g.completed = 0 AND f.espn_event_id IN ({ph}) {extra}")
        try:
            rows = pd.read_sql_query(sql, conn, params=ids)
        except (sqlite3.OperationalError, pd.errors.DatabaseError) as e:
            log(f"mlb probable refresh {table} skipped ({type(e).__name__}: {e})")
            continue
        if not len(rows):
            continue
        keep = []
        for i, r in rows.iterrows():
            if int(r["espn_event_id"]) in locked:
                continue
            st = pd.to_datetime(r["start_time_utc"], utc=True)
            if not (st - pd.Timestamp(now).tz_convert("UTC")) > LOCK_MARGIN:
                continue
            keep.append(i)
        if not keep:
            continue
        rows = rows.loc[keep].reset_index(drop=True)
        sched = pd.DataFrame({
            "espn_event_id": rows["espn_event_id"].astype(int),
            "date": rows["game_date"].astype(str).str[:10],
            "home_team": rows["home_team_id"].astype(int).astype(str),
            "away_team": rows["away_team_id"].astype(int).astype(str),
        })
        try:
            _, edged = prepare_model_edges(conn, "mlb", pd.DataFrame(), sched, as_of)
        except Exception as e:
            log(f"mlb probable refresh edges failed ({type(e).__name__}: {e})")
            continue
        by_eid = {int(edged.at[i, "espn_event_id"]): edged.loc[i] for i in edged.index}
        writable = [c for c in _REFRESH_COLS if c in have]
        where = " AND ".join(f"{c} = ?" for c in pk)
        with Tx(conn):
            for i in range(len(rows)):
                eid = int(rows.at[i, "espn_event_id"])
                if conn.execute(
                        "SELECT 1 FROM forecast_locks WHERE espn_event_id = ?",
                        (eid,)).fetchone():
                    continue
                edge_row = by_eid.get(eid)
                if edge_row is None:
                    continue
                old = rows.loc[i]
                if (_sid(old.get("home_starter_id")) == _sid(edge_row.get("home_starter_id"))
                        and _sid(old.get("away_starter_id")) == _sid(edge_row.get("away_starter_id"))):
                    continue
                coef = old.get("starter_coef") if "starter_coef" in old.index else None
                if not _finite(coef):
                    coef = recover_coef(
                        old.get("home_prob_base"), old.get("player_prob_base"),
                        (_num(old, "home_starter_rel") - _num(old, "away_starter_rel")))
                new, moved = _apply_new_starter(old, edge_row, coef)
                if not moved:
                    log(f"mlb probable {eid}: pitcher changed, no coefficient, chance left as stored")
                sets = ", ".join(f"{c} = ?" for c in writable)
                vals = [_py(new.get(c)) for c in writable]
                keys = [_py(new.get(c)) for c in pk]
                conn.execute(f"UPDATE {table} SET {sets} WHERE {where}", (*vals, *keys))
                n += 1
                log(f"mlb probable {eid}: forecast updated ({table})")
    if n:
        # A new probable can be the known starter. Recompute the player
        # stack for unlocked games. A failure leaves the probable update.
        try:
            from . import mlb_player
            mlb_player.refresh(conn, now, log=log, force=True)
        except Exception as e:
            log(f"mlb lineup stack skipped ({type(e).__name__}: {e})")
    return n


def _num(row, col) -> float:
    v = row.get(col) if hasattr(row, "get") else None
    return float(v) if _finite(v) else 0.0


def _py(v):
    if v is None or (not isinstance(v, str) and not _finite(v) and not isinstance(v, (int, np.integer))):
        if isinstance(v, str):
            return v
        return None
    if isinstance(v, str):
        return v
    if isinstance(v, (int, np.integer)):
        return int(v)
    f = float(v)
    if f.is_integer() and abs(f) < 1e15:
        # starter ids are whole numbers; probabilities are not
        return f
    return f
