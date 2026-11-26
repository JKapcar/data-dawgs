"""MLB stack B: the published win chance when both lineups and both starters are known.

The published chance is an L2 logistic
regression on the logit of the production team+starter win probability plus
the lineup, the opposing starter's hand, the starting pitcher, and the
bullpen. The team+starter probability is the one the production rating fit
already stores (`player_prob_base`): starter inside the rating model, rating
prior scale 0.5. This module does not refit that rating model.

Per game, at forecast time:
  stack_b  both posted lineups, both starters known, a stored fit of at least
           2000 games whose in-sample predicted probabilities keep at least
           0.6 of the team-probability spread and whose mean is within 0.03
           of the home win rate, and a team+starter probability to stack on
  team     anything missing, a short fit, a squeezed fit, or a fit whose
           mean sits more than 0.03 away from the home win rate. The
           team+starter probability is published unchanged.

Rates use strictly earlier games, time-decayed and shrunk the way the
reference does. Training games are completed non-tie regular-season and
postseason games from 2022 on. The team+starter probability is the game-day
snapshot when one is stored, and mlb_team_chance_hist otherwise. The refit
runs Tuesday, and the first morning no fit is stored,
and only while MLB is in season (the daily job does not call it otherwise).

The spread follows the published chance from the current path's margin at
SLOPE points per unit of home logit. The total stays on the current path.
Recorded locks and older forecast rows are not rewritten. A failure publishes
the current path and logs the league, the event id, and the exception.
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

VERSION = "stack_b"
MIN_PUBLISH_GAMES = 2000
# C grid for the stack-B logistic regression.
# The bottom of the grid is not a publish rule.
C_GRID = np.logspace(-3.0, 1.0, 9)
C_FLOOR = float(C_GRID[0])
# sd of the in-sample predicted home probabilities, divided by sd of the
# team+starter probabilities on the same games. Below this the forecasts
# are squeezed and the fit is stored without publishing. The 2026-11-24
# fit was 0.081 / 0.083.
MIN_SPREAD_RATIO = 0.6
# Absolute gap between the mean predicted home probability and the home
# win rate on the training rows.
MAX_MEAN_GAP = 0.03
REFIT_WEEKDAY = 1  # Tuesday, same morning as the NFL quarterback ridge.
TRAIN_FROM = "2022-01-01"
# Counting-stat history the rates read. The stack itself starts in 2022,
# which is the first season the reference had a team+starter probability for.
HISTORY_FROM = "2015-01-01"
HL_BAT = 540.0
K_BAT = 200.0
HL_PIT = 365.0
K_PIT = 300.0
HL_SC_BAT = 540.0
K_SC_BAT = 80.0
HL_SC_PIT = 365.0
K_SC_PIT = 150.0
K_PLAT = 150.0
BP_DAYS = 14
SLOT = np.array([4.65, 4.55, 4.45, 4.35, 4.25, 4.15, 4.05, 3.95, 3.85])
WOBA = {"ubb": 0.69, "hbp": 0.72, "h1": 0.89, "h2": 1.27, "h3": 1.62, "hr": 2.10}
SC_FILL = {"xw": 0.37, "hard": 0.38, "barrel": 0.07, "ev": 88.5}
BAT_METRICS = ("wv", "bb", "k", "hr", "iso")
PIT_METRICS = ("k", "bbh", "hr", "h")
BAT_KEYS = (
    "bat_wv", "bat_wv_plat", "bat_bb", "bat_k", "bat_hr", "bat_iso",
    "bat_xwcon", "bat_hard", "bat_barrel", "bat_ev", "plat_adv", "bat_unknown",
)
PIT_KEYS = (
    "sp_k", "sp_bbh", "sp_kbb", "sp_hr", "sp_h", "sp_fip", "sp_xwcon",
    "sp_hard", "sp_barrel", "sp_L", "sp_depth", "sp_exp", "staff_fip", "staff_xwcon",
)
BP_KEYS = ("bp_q", "bp_xwcon", "bp_p1", "bp_p3")
BASE_FEATS = tuple(sorted(BAT_KEYS + PIT_KEYS + BP_KEYS))
CONTEXT = ("h_b2b", "a_b2b", "rest_d", "neutral")
FEATURES = ("lt",) + tuple(f"d_{b}" for b in BASE_FEATS) + CONTEXT
AUDIT_COLS = ("mlb_model_src", "mlb_ridge_prob", "mlb_team_prob",
              "mlb_ridge_fit_id", "mlb_inputs")
_COUNTED_BOX = ("R", "F", "D", "L", "W")


def logit(p):
    """Clipped the way the reference clips the team probability."""
    p = float(np.clip(p, 1e-4, 1 - 1e-4))
    return float(math.log(p / (1.0 - p)))


def prior_rates(df, key, date, expo, metrics, hl, k, prior, ewm_col=None):
    """Decayed, shrunk rate from strictly earlier rows.

    Same recurrence as the NFL quarterback rates. A second game on the same
    date sees the first (doubleheader). `ewm_col`, when set, is the decayed
    mean of that column over earlier rows, one weight per row.
    """
    sort_cols = [key, date]
    if "espn_event_id" in df.columns:
        sort_cols.append("espn_event_id")
    df = df.sort_values(sort_cols).reset_index(drop=True)
    d_all = pd.to_datetime(df[date]).values.astype("datetime64[D]").astype(float)
    exposure = pd.to_numeric(df[expo], errors="coerce").fillna(0.0).to_numpy(float)
    values = {m: pd.to_numeric(df[m], errors="coerce").fillna(0.0).to_numpy(float) for m in metrics}
    rates = {m: np.empty(len(df)) for m in metrics}
    carried = np.empty(len(df))
    ewm = np.full(len(df), np.nan) if ewm_col else None
    ewm_vals = (pd.to_numeric(df[ewm_col], errors="coerce").to_numpy(float)
                if ewm_col else None)
    denom_k = float(k)
    for _, idx in df.groupby(key, sort=False).indices.items():
        sums = {m: 0.0 for m in metrics}
        mass = 0.0
        last = None
        e_sum = 0.0
        e_n = 0.0
        for i in idx:
            if last is not None:
                decay = 0.5 ** ((d_all[i] - last) / hl)
                mass *= decay
                for m in metrics:
                    sums[m] *= decay
                e_sum *= decay
                e_n *= decay
            for m in metrics:
                rates[m][i] = (sums[m] + denom_k * prior[m]) / (mass + denom_k)
            carried[i] = mass
            if ewm is not None:
                ewm[i] = (e_sum / e_n) if e_n > 0 else np.nan
            for m in metrics:
                sums[m] += values[m][i]
            mass += exposure[i]
            if ewm is not None and np.isfinite(ewm_vals[i]):
                e_sum += float(ewm_vals[i])
                e_n += 1.0
            last = d_all[i]
    for m in metrics:
        df[m + "_r"] = rates[m]
    df["_expo"] = carried
    if ewm is not None:
        df["_ewm"] = ewm
    return df


def _num(df, col, default=0.0):
    if col not in df.columns:
        return np.full(len(df), default, float)
    return pd.to_numeric(df[col], errors="coerce").fillna(default).to_numpy(float)


def batting_components(batting, box):
    """wOBA pieces. Missing gap fields count as zero, which is the reference
    when a Stats API row did not match."""
    if batting is None or not len(batting):
        return pd.DataFrame()
    B = batting.copy()
    B["athlete_id"] = pd.to_numeric(B["athlete_id"], errors="coerce")
    B = B[B["athlete_id"].notna()].copy()
    B["espn_event_id"] = pd.to_numeric(B["espn_event_id"], errors="coerce")
    B = B[B["espn_event_id"].notna()].copy()
    B["athlete_id"] = B["athlete_id"].astype(int)
    B["espn_event_id"] = B["espn_event_id"].astype("int64")
    B["game_date"] = pd.to_datetime(B["game_date"])
    for col in ("ab", "h", "hr", "bb", "k"):
        B[col] = _num(B, col)
    gap_cols = ["doubles", "triples", "hit_by_pitch", "sac_flies", "intentional_walks"]
    if box is not None and len(box):
        use = [c for c in ["espn_event_id", "athlete_id", *gap_cols, "plate_appearances"]
               if c in box.columns]
        xb = box.loc[box["plate_appearances"].notna(), use].drop_duplicates(
            ["espn_event_id", "athlete_id"]) if "plate_appearances" in box.columns else box
        B = B.merge(xb, on=["espn_event_id", "athlete_id"], how="left")
    else:
        for col in gap_cols:
            B[col] = 0.0
    for col in gap_cols:
        B[col] = _num(B, col)
    B["ubb"] = np.clip(B["bb"] - B["intentional_walks"], 0, None)
    B["h1"] = np.clip(B["h"] - B["doubles"] - B["triples"] - B["hr"], 0, None)
    B["pa"] = B["ab"] + B["ubb"] + B["sac_flies"] + B["hit_by_pitch"]
    B["wv"] = (WOBA["ubb"] * B["ubb"] + WOBA["hbp"] * B["hit_by_pitch"]
               + WOBA["h1"] * B["h1"] + WOBA["h2"] * B["doubles"]
               + WOBA["h3"] * B["triples"] + WOBA["hr"] * B["hr"])
    B["iso"] = B["doubles"] + 2 * B["triples"] + 3 * B["hr"]
    return B


def pitching_components(pitching, box):
    """Batters faced, with the reference fallback of outs + hits + walks."""
    if pitching is None or not len(pitching):
        return pd.DataFrame()
    P = pitching.copy()
    P["athlete_id"] = pd.to_numeric(P["athlete_id"], errors="coerce")
    P = P[P["athlete_id"].notna()].copy()
    P["espn_event_id"] = pd.to_numeric(P["espn_event_id"], errors="coerce")
    P = P[P["espn_event_id"].notna()].copy()
    P["athlete_id"] = P["athlete_id"].astype(int)
    P["espn_event_id"] = P["espn_event_id"].astype("int64")
    P["game_date"] = pd.to_datetime(P["game_date"])
    for col in ("outs", "h", "bb", "k", "hr", "pitches"):
        P[col] = _num(P, col)
    if box is not None and len(box) and "p_batters_faced" in box.columns:
        use = box.loc[box["p_batters_faced"].notna(),
                      [c for c in ("espn_event_id", "athlete_id", "p_batters_faced", "p_hit_batters")
                       if c in box.columns]].drop_duplicates(["espn_event_id", "athlete_id"])
        P = P.merge(use, on=["espn_event_id", "athlete_id"], how="left")
    P["bf"] = pd.to_numeric(P["p_batters_faced"], errors="coerce") if "p_batters_faced" in P.columns else np.nan
    P["bf"] = P["bf"].fillna(P["outs"] + P["h"] + P["bb"])
    hbp = _num(P, "p_hit_batters") if "p_hit_batters" in P.columns else np.zeros(len(P))
    P["bbh"] = P["bb"] + hbp
    return P


def _league_rate(df, metrics, expo):
    den = float(pd.to_numeric(df[expo], errors="coerce").fillna(0).sum())
    if den <= 0:
        return None
    return {m: float(pd.to_numeric(df[m], errors="coerce").fillna(0).sum()) / den for m in metrics}


def add_batter_rates(B, hands):
    """Pregame wOBA, BB/K/HR/ISO, and platoon wOBA. Returns (frame, priors)."""
    if B is None or not len(B):
        return B, None
    B = _attach_hand(B, hands)
    lg = _league_rate(B, BAT_METRICS, "pa")
    if not lg:
        return B.iloc[0:0], None
    prior = {**lg, "wv": lg["wv"] * 0.92, "iso": lg["iso"] * 0.9}
    B = prior_rates(B, "athlete_id", "game_date", "pa", list(BAT_METRICS),
                    HL_BAT, K_BAT, prior)
    B = B.rename(columns={"_expo": "pa_expo"})
    for hd in ("L", "R"):
        m = (B["sp_hand"] == hd).astype(float) if "sp_hand" in B.columns else np.zeros(len(B))
        T = B[["athlete_id", "game_date", "espn_event_id"]].copy()
        T["pa_x"] = B["pa"].to_numpy(float) * m
        T["wv_x"] = B["wv"].to_numpy(float) * m
        T = prior_rates(T, "athlete_id", "game_date", "pa_x", ["wv_x"], HL_BAT, 1e-6, {"wv_x": 0.0})
        pre_e = T["_expo"].to_numpy(float)
        pre_sum = T["wv_x_r"].to_numpy(float) * pre_e
        B[f"vs{hd}_e"] = pre_e
        B[f"vs{hd}_sum"] = pre_sum
        B[f"wv_vs{hd}"] = (pre_e * T["wv_x_r"].to_numpy(float) + K_PLAT * B["wv_r"].to_numpy(float)) / (pre_e + K_PLAT)
    return B, {"prior": prior, "k": K_BAT, "hl": HL_BAT}


def add_pitcher_rates(P):
    """Pregame K, BB+HBP, HR, hits per batter faced, FIP, and expected outs."""
    if P is None or not len(P):
        return P, None
    lg = _league_rate(P, PIT_METRICS, "bf")
    if not lg:
        return P.iloc[0:0], None
    prior = {"k": lg["k"] * 0.9, "bbh": lg["bbh"] * 1.1, "hr": lg["hr"] * 1.1, "h": lg["h"] * 1.05}
    P = prior_rates(P, "athlete_id", "game_date", "bf", list(PIT_METRICS),
                    HL_PIT, K_PIT, prior, ewm_col="outs")
    P["fip_bf"] = 13 * P["hr_r"] + 3 * P["bbh_r"] - 2 * P["k_r"]
    P["kbb"] = P["k_r"] - P["bbh_r"]
    P["exp_outs"] = P["_ewm"]
    return P, {"prior": prior, "k": K_PIT, "hl": HL_PIT}


def statcast_rates(batted, role, query, hl, k):
    """Pregame contact rates for `role`. Query dates with no batted balls
    still get a row, so a player is shrunk to the league rate rather than
    dropped."""
    empty = pd.DataFrame(columns=["athlete_id", "game_date", "xwcon_r", "hard_hit_r",
                                  "barrels_r", "ev_r", "bbe_expo"])
    if batted is None or not len(batted) or query is None or not len(query):
        return empty, None
    s = batted[batted["role"] == role].copy()
    if not len(s):
        return empty, None
    s["athlete_id"] = pd.to_numeric(s["athlete_id"], errors="coerce")
    s = s[s["athlete_id"].notna()]
    if not len(s):
        return empty, None
    s["athlete_id"] = s["athlete_id"].astype(int)
    s["game_date"] = pd.to_datetime(s["game_date"])
    for col in ("batted_balls", "ev_n", "hard_hit", "barrels", "xwoba_n"):
        s[col] = _num(s, col)
    s["ev_sum"] = _num(s, "avg_ev") * s["ev_n"]
    s["xwoba_sum"] = _num(s, "xwoba_sum")
    s = s.groupby(["athlete_id", "game_date"], as_index=False)[
        ["batted_balls", "ev_sum", "ev_n", "hard_hit", "barrels", "xwoba_sum", "xwoba_n"]].sum()
    qd = query[["athlete_id", "game_date"]].drop_duplicates()
    qd["athlete_id"] = qd["athlete_id"].astype(int)
    qd["game_date"] = pd.to_datetime(qd["game_date"])
    s = s.merge(qd, on=["athlete_id", "game_date"], how="outer").fillna(0)
    den_x = float(s["xwoba_n"].sum())
    den_b = float(s["batted_balls"].sum())
    den_e = float(s["ev_n"].sum())
    if den_x <= 0 or den_b <= 0 or den_e <= 0:
        return empty, None
    lg = {"xwoba_sum": float(s["xwoba_sum"].sum()) / den_x,
          "hard_hit": float(s["hard_hit"].sum()) / den_b,
          "barrels": float(s["barrels"].sum()) / den_b,
          "ev_sum": float(s["ev_sum"].sum()) / den_e}
    a = prior_rates(s.copy(), "athlete_id", "game_date", "xwoba_n", ["xwoba_sum"], hl, k, lg)
    b = prior_rates(s.copy(), "athlete_id", "game_date", "batted_balls", ["hard_hit", "barrels"], hl, k, lg)
    c = prior_rates(s.copy(), "athlete_id", "game_date", "ev_n", ["ev_sum"], hl, k, lg)
    out = a[["athlete_id", "game_date", "xwoba_sum_r", "_expo"]].rename(
        columns={"_expo": "bbe_expo", "xwoba_sum_r": "xwcon_r"})
    out = out.merge(b[["athlete_id", "game_date", "hard_hit_r", "barrels_r"]], on=["athlete_id", "game_date"])
    out = out.merge(c[["athlete_id", "game_date", "ev_sum_r"]].rename(columns={"ev_sum_r": "ev_r"}),
                    on=["athlete_id", "game_date"])
    return out, {"prior": {"xw": lg["xwoba_sum"], "hard": lg["hard_hit"],
                           "barrel": lg["barrels"], "ev": lg["ev_sum"]},
                 "k": k, "hl": hl}


def _fill_contact(df, cols):
    """Safety fill when a player has no contact row at all."""
    for col, key in cols:
        if col not in df.columns:
            df[col] = SC_FILL[key]
        else:
            df[col] = df[col].fillna(SC_FILL[key])
    if "bbe_expo" in df.columns:
        df["bbe_expo"] = df["bbe_expo"].fillna(0.0)
    else:
        df["bbe_expo"] = 0.0
    return df


def _attach_hand(B, hands):
    """Opposing starter hand, from the starter row already merged as sp_hand.
    Missing hand is right, matching the reference."""
    if "sp_hand" not in B.columns:
        B["sp_hand"] = "R"
    B["sp_hand"] = B["sp_hand"].fillna("R")
    if "bats" not in B.columns:
        B["bats"] = B["athlete_id"].map(lambda a: (hands or {}).get(int(a), {}).get("bats", "R"))
    B["bats"] = B["bats"].fillna("R")
    return B


def attach_starter_hand(B, pitching, hands):
    """The hand of the other team's starter, on each batting row."""
    if B is None or not len(B) or pitching is None or not len(pitching):
        if B is not None and len(B):
            B = B.copy()
            B["sp_hand"] = "R"
        return B
    sp = pitching[pitching["starter"] == 1][["espn_event_id", "team_id", "athlete_id"]].drop_duplicates(
        ["espn_event_id", "team_id"])
    sp = sp.copy()
    sp["sp_hand"] = sp["athlete_id"].map(lambda a: (hands or {}).get(int(a), {}).get("throws", "R")).fillna("R")
    sp = sp.rename(columns={"team_id": "opp_team_id"})
    out = B.merge(sp[["espn_event_id", "opp_team_id", "sp_hand"]],
                  on=["espn_event_id", "opp_team_id"], how="left")
    out["sp_hand"] = out["sp_hand"].fillna("R")
    return out


def bat_feats(df, slots, opp_hand):
    """Lineup rates, weighted by the slot's expected plate appearances.

    The weights are rescaled to sum to 38, then the rate features that are
    already per plate appearance are divided back by 38. That is the
    reference's scaling, so a lineup of identical hitters keeps their rate.
    """
    slots = np.asarray(slots, int)
    w = SLOT[slots - 1].astype(float)
    w = w / w.sum() * 38.0
    bats = df["bats"].fillna("R").to_numpy()
    vs = df[f"wv_vs{opp_hand}"].to_numpy(float)
    adv = ((bats == "B") | ((bats == "L") & (opp_hand == "R")) | ((bats == "R") & (opp_hand == "L"))).astype(float)

    def g(col):
        return float((df[col].to_numpy(float) * w).sum())

    return {
        "bat_wv": g("wv_r"), "bat_wv_plat": float((vs * w).sum()),
        "bat_bb": g("bb_r"), "bat_k": g("k_r"), "bat_hr": g("hr_r"), "bat_iso": g("iso_r"),
        "bat_xwcon": g("xwcon_r") / 38.0, "bat_hard": g("hard_hit_r") / 38.0,
        "bat_barrel": g("barrels_r") / 38.0, "bat_ev": g("ev_r") / 38.0,
        "plat_adv": float((adv * w).sum()) / 38.0,
        "bat_unknown": float((w * (df["pa_expo"].to_numpy(float) < 100)).sum()) / 38.0,
    }


def pit_feats(rates, bpq, bpc):
    """Starter rates and the staff blend. Expected outs default to 15."""
    eo = rates.get("exp_outs")
    eo = 15.0 if eo is None or not np.isfinite(eo) else float(eo)
    share = min(eo, 27.0) / 27.0
    fip = float(rates["fip_bf"])
    xw = float(rates["xwcon"])
    bq = fip if bpq is None or not np.isfinite(bpq) else float(bpq)
    bc = xw if bpc is None or not np.isfinite(bpc) else float(bpc)
    return {
        "sp_k": float(rates["k_r"]), "sp_bbh": float(rates["bbh_r"]), "sp_kbb": float(rates["kbb"]),
        "sp_hr": float(rates["hr_r"]), "sp_h": float(rates["h_r"]), "sp_fip": fip,
        "sp_xwcon": xw, "sp_hard": float(rates["hard"]), "sp_barrel": float(rates["barrel"]),
        "sp_L": float(rates["hand_L"]), "sp_depth": share, "sp_exp": float(np.log1p(rates["expo"])),
        "staff_fip": share * fip + (1.0 - share) * bq,
        "staff_xwcon": share * xw + (1.0 - share) * bc,
    }


def bullpen_at(rel, team, day):
    """(FIP, contact, pitches in 1 day, pitches in 3 days) before `day`."""
    if rel is None or not len(rel):
        return (np.nan, np.nan, 0.0, 0.0)
    R = rel[rel["team_id"] == team]
    if not len(R):
        return (np.nan, np.nan, 0.0, 0.0)
    day = np.datetime64(pd.Timestamp(day).normalize(), "D")
    rd = pd.to_datetime(R["game_date"]).values.astype("datetime64[D]")
    outs = pd.to_numeric(R["outs"], errors="coerce").fillna(0).to_numpy(float)
    pit = pd.to_numeric(R["pitches"], errors="coerce").fillna(0).to_numpy(float)
    fip = pd.to_numeric(R["fip_bf"], errors="coerce").to_numpy(float)
    xw = pd.to_numeric(R["xwcon"], errors="coerce").to_numpy(float)
    m14 = (rd < day) & (rd >= day - np.timedelta64(BP_DAYS, "D"))
    q = qc = np.nan
    if m14.any():
        w = outs[m14] + 1.0
        ok = np.isfinite(fip[m14]) & np.isfinite(w) & (w > 0)
        if ok.any():
            q = float(np.average(fip[m14][ok], weights=w[ok]))
        okc = np.isfinite(xw[m14]) & np.isfinite(w) & (w > 0)
        if okc.any():
            qc = float(np.average(xw[m14][okc], weights=w[okc]))
    p1 = float(pit[(rd < day) & (rd >= day - np.timedelta64(1, "D"))].sum())
    p3 = float(pit[(rd < day) & (rd >= day - np.timedelta64(3, "D"))].sum())
    return (q, qc, p1, p3)


def rest_context(h_rest, a_rest, neutral, fill_missing=False):
    """Back-to-back flags and the capped rest gap. A missing rest drops the
    training row. A live row with no earlier game uses the cap and is not a
    back-to-back."""
    def known(r):
        return r is not None and np.isfinite(r) and float(r) > 0

    if not fill_missing and (not known(h_rest) or not known(a_rest)):
        return None
    h = float(h_rest) if known(h_rest) else 4.0
    a = float(a_rest) if known(a_rest) else 4.0
    try:
        neu = 0 if neutral is None or not np.isfinite(float(neutral)) else int(neutral)
    except (TypeError, ValueError):
        neu = 0
    return {
        "h_b2b": int(known(h_rest) and float(h_rest) == 1.0),
        "a_b2b": int(known(a_rest) and float(a_rest) == 1.0),
        "rest_d": float(np.clip(h, 1, 4) - np.clip(a, 1, 4)),
        "neutral": neu,
    }


def stack_vector(p_team, home, away, h_rest, a_rest, neutral, fill_missing=False):
    """One design row: logit of the team+starter probability, home minus away,
    then the rest context. None when a feature is missing.

    A number outside (0, 1) is not a probability. Clipping it would turn a
    bad stored value into a near-certain win or loss, so the row is left out.
    """
    if p_team is None or not np.isfinite(p_team) or not (0.0 < float(p_team) < 1.0):
        return None
    ctx = rest_context(h_rest, a_rest, neutral, fill_missing=fill_missing)
    if ctx is None or home is None or away is None:
        return None
    row = {"lt": logit(p_team)}
    for key in BASE_FEATS:
        hv, av = home.get(key), away.get(key)
        if hv is None or av is None or not np.isfinite(hv) or not np.isfinite(av):
            return None
        row[f"d_{key}"] = float(hv) - float(av)
    row.update(ctx)
    return [row[c] for c in FEATURES]


def team_starter_prob(player_base, home_prob, model_src, elo_weight):
    """The production team+starter probability for one stored forecast.

    `player_prob_base` is that number: the rating model's win chance with the
    starter in it, before the player term and before the Elo blend, fit with
    the production rating prior (scale 0.5). A row this stack already replaced
    is not reused. A blended row with no stored base is left out.
    """
    if player_base is not None and np.isfinite(player_base):
        return float(player_base)
    if model_src == VERSION:
        return None
    if elo_weight is not None and np.isfinite(elo_weight) and float(elo_weight) > 0:
        return None
    if home_prob is not None and np.isfinite(home_prob):
        return float(home_prob)
    return None


# ---------------------------------------------------------------- fit storage


def _jdump(obj):
    return json.dumps(obj, separators=(",", ":"))


def make_estimator():
    """The reference estimator: scaler, then L2 logistic with that C grid.

    `l1_ratios=(0.0,)` is the L2 penalty. sklearn 1.8+ treats the default
    `l1_ratios` as deprecated and would otherwise warn on every refit.
    """
    from sklearn.linear_model import LogisticRegressionCV
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    clf = LogisticRegressionCV(
        Cs=C_GRID, cv=5, scoring="neg_log_loss", max_iter=3000,
        l1_ratios=(0.0,), use_legacy_attributes=True)
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


def training_rows(M, fit_date):
    """Games before `fit_date`, from 2022 on, in date order.

    The cross-validation is sklearn's stratified 5-fold with no shuffle, which
    walks the rows in the order they are given. Date order makes that walk
    follow the season instead of the order the games query happened to return.
    """
    if M is None or not len(M):
        return M.iloc[0:0] if M is not None else pd.DataFrame()
    d = pd.to_datetime(M["game_date"])
    end = pd.Timestamp(str(fit_date)[:10])
    out = M.loc[d < end]
    keys = ["game_date"] + (["espn_event_id"] if "espn_event_id" in out.columns else [])
    return out.sort_values(keys).reset_index(drop=True)


def fit_matrix(M, fit_date, columns=None):
    """Fit the stack on `training_rows` only."""
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


def refit_due(conn, today):
    """Tuesday, or any day no fit is stored. A Tuesday that already stored
    the fit is not fit again."""
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    try:
        rows = conn.execute("SELECT version, fit_date FROM mlb_ridge_fits").fetchall()
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
        "INSERT INTO mlb_ridge_fits (fit_date, version, train_from, train_through, n_games, "
        "c_value, features, scaler_mean, scaler_scale, coef, intercept, sklearn_version, created_at, "
        "sd_p, sd_team, mean_p, win_rate) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (today.isoformat(), VERSION, TRAIN_FROM, through, packed["n_games"],
         packed["c_value"], _jdump(packed["features"]), _jdump(packed["scaler_mean"]),
         _jdump(packed["scaler_scale"]), _jdump(packed["coef"]), packed["intercept"],
         packed["sklearn_version"], datetime.now(timezone.utc).isoformat(timespec="seconds"),
         packed.get("sd_p"), packed.get("sd_team"), packed.get("mean_p"),
         packed.get("win_rate")))


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
        "sd_p": row["sd_p"],
        "sd_team": row["sd_team"],
        "mean_p": row["mean_p"],
        "win_rate": row["win_rate"],
    }


def load_fit(conn):
    """Latest stored stack B fit, or None."""
    try:
        row = conn.execute(
            "SELECT * FROM mlb_ridge_fits WHERE version = ? "
            "ORDER BY fit_date DESC, fit_id DESC LIMIT 1", (VERSION,)).fetchone()
    except sqlite3.OperationalError:
        return None
    return _unpack_fit(row) if row else None


def _fit_bits(fit):
    if not fit or fit.get("n_games") is None:
        return "-", "-"
    n_txt = str(int(fit["n_games"]))
    c = fit.get("c_value")
    try:
        c_txt = f"{float(c):.4g}" if c is not None and np.isfinite(float(c)) else "-"
    except (TypeError, ValueError):
        c_txt = "-"
    return n_txt, c_txt


def lt_weight(fit):
    """Standardized coefficient on the team logit, or None when it is absent."""
    if not fit:
        return None
    feats = list(fit.get("features") or [])
    coef = list(fit.get("coef") or [])
    if "lt" not in feats or len(coef) != len(feats):
        return None
    try:
        return float(coef[feats.index("lt")])
    except (TypeError, ValueError):
        return None


def _opt_float(fit, key):
    if not fit or key not in fit or fit[key] is None:
        return None
    try:
        value = float(fit[key])
    except (TypeError, ValueError):
        return None
    return value if np.isfinite(value) else None


def unpublished_reason(fit):
    """Why a stored fit must not publish, or None when it may.

    A squeezed forecast (`sd_p` below `MIN_SPREAD_RATIO` times `sd_team`)
    or a mean more than `MAX_MEAN_GAP` from the home win rate stays
    unpublished. `n_games` is checked separately. The chosen C and the
    team-logit weight are reported and do not decide publication.
    """
    if not fit:
        return "no fit"
    sd_p = _opt_float(fit, "sd_p")
    sd_team = _opt_float(fit, "sd_team")
    mean_p = _opt_float(fit, "mean_p")
    win_rate = _opt_float(fit, "win_rate")
    reasons = []
    if sd_p is None or sd_team is None or sd_team <= 0:
        reasons.append("no spread")
    else:
        ratio = sd_p / sd_team
        if ratio < MIN_SPREAD_RATIO:
            reasons.append(f"sd ratio {ratio:.2f}")
    if mean_p is None or win_rate is None:
        reasons.append("no mean")
    elif abs(mean_p - win_rate) > MAX_MEAN_GAP:
        reasons.append(f"mean gap {abs(mean_p - win_rate):.3f}")
    return ", ".join(reasons) or None


def fit_diagnostics(frame, fit):
    """In-sample spread and mean of the fitted home probabilities.

    `sd_team` is the standard deviation of the inverse logit of `lt`.
    `win_rate` is the share of training rows the home team won.
    """
    cols = list(fit["features"])
    p_hat = np.asarray(predict_stored(fit, frame[cols]), float)
    p_team = 1.0 / (1.0 + np.exp(-frame["lt"].to_numpy(float)))
    return {
        "sd_p": float(np.std(p_hat)),
        "sd_team": float(np.std(p_team)),
        "mean_p": float(np.mean(p_hat)),
        "win_rate": float(np.mean(frame["y"].to_numpy(float))),
    }


def probability_spread(frame, fit):
    """(sd of fitted home probabilities, sd of the team+starter probabilities)."""
    diag = fit_diagnostics(frame, fit)
    return diag["sd_p"], diag["sd_team"]


# ---------------------------------------------------------------- history load


def _read(conn, sql, params=()):
    try:
        return pd.read_sql_query(sql, conn, params=params)
    except (sqlite3.OperationalError, pd.errors.DatabaseError):
        return pd.DataFrame()


def load_hands(conn):
    """athlete → {bats, throws}. Roster text, then the MLB roster payload.
    A missing side is filled later as right."""
    out = {}

    def put(aid, bats, throws):
        if aid is None or (isinstance(aid, float) and math.isnan(aid)):
            return
        cur = out.setdefault(int(aid), {})
        if bats and "bats" not in cur:
            cur["bats"] = _hand_code(bats)
        if throws and "throws" not in cur:
            cur["throws"] = _hand_code(throws)

    rows = _read(conn, "SELECT athlete_id, raw_json FROM roster_states WHERE league = 'mlb' "
                       "AND athlete_id IS NOT NULL ORDER BY last_seen")
    for r in rows.itertuples(index=False):
        raw = _json(getattr(r, "raw_json", None))
        put(r.athlete_id, raw.get("bats"), raw.get("throws"))
    rows = _read(conn, "SELECT athlete_id, raw_json FROM mlb_roster_states "
                       "WHERE athlete_id IS NOT NULL ORDER BY last_seen")
    for r in rows.itertuples(index=False):
        raw = _json(getattr(r, "raw_json", None))
        put(r.athlete_id, raw.get("batSide") or raw.get("bats"),
            raw.get("pitchHand") or raw.get("throws"))
    return out


def _hand_code(value):
    if isinstance(value, dict):
        value = value.get("code") or value.get("abbreviation") or value.get("description")
    if value is None:
        return None
    text = str(value).strip().upper()
    if text in ("L", "LEFT", "S", "SWITCH"):
        return "B" if text in ("S", "SWITCH") else "L"
    if text in ("R", "RIGHT"):
        return "R"
    if text[:1] in ("L", "R", "B"):
        return text[:1]
    return None


def _json(text):
    if not text or not isinstance(text, str):
        return {}
    try:
        obj = json.loads(text)
    except (TypeError, ValueError):
        return {}
    return obj if isinstance(obj, dict) else {}


def _looked_up_athlete(value, by_ext):
    """ESPN athlete id for one MLB person id, or NaN when it is not mapped.

    The miss has to be NaN. pandas 3 will not write None into the float
    athlete_id column."""
    if pd.isna(value):
        return np.nan
    try:
        found = by_ext.get(str(int(value)))
    except (TypeError, ValueError):
        return np.nan
    return np.nan if found is None else found


def _map_batted_athletes(conn, batted):
    """Fill a missing athlete id from the MLB person id.

    SQLite nulls make athlete_id float. The values written back are numeric,
    so an unmatched row stays missing instead of raising on pandas 3.
    """
    if batted is None or not len(batted):
        return batted
    s = batted.copy()
    s["athlete_id"] = pd.to_numeric(s["athlete_id"], errors="coerce")
    missing = s["athlete_id"].isna()
    if not missing.any() or "mlb_person_id" not in s.columns:
        return s
    ids = _read(conn, "SELECT ext_id, espn_id FROM ext_ids WHERE source = 'mlbam' "
                      "AND league = 'mlb' AND kind = 'player' AND espn_id IS NOT NULL")
    if not len(ids):
        return s
    by_ext = {}
    for row in ids.itertuples(index=False):
        try:
            by_ext[str(row.ext_id)] = int(row.espn_id)
        except (TypeError, ValueError):
            continue
    if not by_ext:
        return s
    filled = pd.to_numeric(
        s.loc[missing, "mlb_person_id"].map(lambda v: _looked_up_athlete(v, by_ext)),
        errors="coerce")
    s.loc[missing, "athlete_id"] = filled
    return s


def load_history(conn, through):
    """Box lines and contact through `through`, for rates. Empty frames when
    a table is missing, so a partial database still trains on what it has."""
    bat = _read(conn,
                "SELECT espn_event_id, game_date, team_id, opp_team_id, athlete_id, starter, "
                "bat_order, ab, h, hr, bb, k FROM player_game_mlb_batting "
                "WHERE season_type IN (2, 3) AND game_date >= ? AND game_date <= ?",
                (HISTORY_FROM, through))
    pit = _read(conn,
                "SELECT espn_event_id, game_date, team_id, athlete_id, starter, outs, h, bb, k, hr, "
                "pitches FROM player_game_mlb_pitching "
                "WHERE season_type IN (2, 3) AND game_date >= ? AND game_date <= ?",
                (HISTORY_FROM, through))
    box = _read(conn,
                "SELECT g.espn_event_id, p.athlete_id, p.doubles, p.triples, p.hit_by_pitch, "
                "p.sac_flies, p.intentional_walks, p.plate_appearances, p.p_batters_faced, "
                "p.p_hit_batters FROM mlb_box_players p JOIN mlb_box_games g ON g.game_pk = p.game_pk "
                "WHERE g.espn_event_id IS NOT NULL AND g.game_date <= ? AND g.game_type IN "
                f"({','.join('?' * len(_COUNTED_BOX))})",
                (through, *_COUNTED_BOX))
    batted = _map_batted_athletes(conn, _read(
        conn, "SELECT athlete_id, mlb_person_id, role, game_date, batted_balls, avg_ev, ev_n, "
              "hard_hit, barrels, xwoba_sum, xwoba_n FROM mlb_batted_players WHERE game_date <= ?",
        (through,)))
    games = _read(conn,
                  "SELECT espn_event_id, season, game_date, home_team_id, away_team_id, "
                  "home_score, away_score, neutral_site, completed FROM games "
                  "WHERE league = 'mlb' AND season_type IN (2, 3) AND game_date <= ?",
                  (through,))
    return {"batting": bat, "pitching": pit, "box": box, "batted": batted,
            "games": games, "hands": load_hands(conn)}


def prepare_rates(frames):
    """Rate columns on every batting and pitching row. Priors come back with
    the frames so the morning state uses the same shrinkage."""
    hands = frames.get("hands") or {}
    box = frames.get("box")
    B = batting_components(frames.get("batting"), box)
    P = pitching_components(frames.get("pitching"), box)
    B = attach_starter_hand(B, P, hands)
    sc_b, sc_b_prior = statcast_rates(frames.get("batted"), "batter", B, HL_SC_BAT, K_SC_BAT)
    sc_p, sc_p_prior = statcast_rates(frames.get("batted"), "pitcher", P, HL_SC_PIT, K_SC_PIT)
    if len(B) and len(sc_b):
        B = B.merge(sc_b, on=["athlete_id", "game_date"], how="left")
    if len(P) and len(sc_p):
        P = P.merge(sc_p, on=["athlete_id", "game_date"], how="left")
    B, bat_prior = add_batter_rates(B, hands) if len(B) else (B, None)
    P, pit_prior = add_pitcher_rates(P) if len(P) else (P, None)
    if len(B):
        B = _fill_contact(B, (("xwcon_r", "xw"), ("hard_hit_r", "hard"),
                              ("barrels_r", "barrel"), ("ev_r", "ev")))
        if "bats" not in B.columns:
            B["bats"] = "R"
    if len(P):
        P = _fill_contact(P, (("xwcon_r", "xw"), ("hard_hit_r", "hard"),
                              ("barrels_r", "barrel"), ("ev_r", "ev")))
        P["hand_L"] = P["athlete_id"].map(
            lambda a: int((hands.get(int(a), {}) or {}).get("throws") == "L")).astype(int)
        P["throws"] = P["athlete_id"].map(
            lambda a: (hands.get(int(a), {}) or {}).get("throws") or "R")
    return B, P, {"bat": bat_prior, "pit": pit_prior, "sc_bat": sc_b_prior, "sc_pit": sc_p_prior}


def _lineup_table(B):
    if B is None or not len(B) or "starter" not in B.columns:
        return pd.DataFrame()
    lu = B[(B["starter"] == 1) & B["bat_order"].between(1, 9)].copy()
    lu["bat_order"] = lu["bat_order"].astype(int)
    return lu.sort_values("bat_order").drop_duplicates(["espn_event_id", "team_id", "bat_order"])


def side_features(B, P):
    """One feature dict per (game, team) that has a posted-style lineup and a
    starter. Rates on each row are already pregame."""
    lu = _lineup_table(B)
    if not len(lu) or P is None or not len(P):
        return {}
    sps = P[P["starter"] == 1].drop_duplicates(["espn_event_id", "team_id"])
    sps = sps.set_index(["espn_event_id", "team_id"])
    rel = P[P["starter"] != 1][["team_id", "game_date", "outs", "pitches", "fip_bf", "xwcon_r"]].copy()
    rel = rel.rename(columns={"xwcon_r": "xwcon"})
    dates = lu[["espn_event_id", "team_id", "game_date"]].drop_duplicates()
    out = {}
    # opposing starter hand from the other side's starter, via the lineup's opp
    opp = (lu.drop_duplicates(["espn_event_id", "team_id"])
           .set_index(["espn_event_id", "team_id"])["opp_team_id"].to_dict()
           if "opp_team_id" in lu.columns else {})
    for (ev, tm), df in lu.groupby(["espn_event_id", "team_id"]):
        if df["bat_order"].nunique() < 9:
            continue
        key = (int(ev), int(tm))
        if key not in sps.index:
            continue
        s = sps.loc[key]
        if isinstance(s, pd.DataFrame):
            s = s.iloc[0]
        day = df["game_date"].iloc[0]
        q, qc, p1, p3 = bullpen_at(rel, int(tm), day)
        other = opp.get((ev, tm))
        opp_key = (int(ev), int(other)) if other is not None and not pd.isna(other) else None
        if opp_key is not None and opp_key in sps.index:
            os_ = sps.loc[opp_key]
            if isinstance(os_, pd.DataFrame):
                os_ = os_.iloc[0]
            opp_hand = "L" if int(os_["hand_L"]) == 1 else "R"
        else:
            opp_hand = "R"
        rates = {
            "k_r": s["k_r"], "bbh_r": s["bbh_r"], "kbb": s["kbb"], "hr_r": s["hr_r"],
            "h_r": s["h_r"], "fip_bf": s["fip_bf"], "xwcon": s["xwcon_r"],
            "hard": s["hard_hit_r"], "barrel": s["barrels_r"], "hand_L": s["hand_L"],
            "expo": s["_expo"], "exp_outs": s["exp_outs"],
        }
        feat = {}
        feat.update(bat_feats(df, df["bat_order"].to_numpy(int), opp_hand))
        feat.update(pit_feats(rates, q, qc))
        feat["bp_q"] = q
        feat["bp_xwcon"] = qc
        feat["bp_p1"] = p1
        feat["bp_p3"] = p3
        out[key] = feat
    return out


def add_rest(games):
    """Days since each side's previous game. The first game has no rest."""
    if games is None or not len(games):
        return pd.DataFrame(columns=["espn_event_id", "h_rest", "a_rest", "neutral"])
    g = games.copy()
    g["game_date"] = pd.to_datetime(g["game_date"])
    parts = []
    for side, col in (("home", "home_team_id"), ("away", "away_team_id")):
        p = g[["espn_event_id", "game_date", col]].rename(columns={col: "team"})
        p["side"] = side
        parts.append(p)
    long = pd.concat(parts, ignore_index=True).sort_values(["team", "game_date", "espn_event_id"])
    long["prev"] = long.groupby("team", sort=False)["game_date"].shift()
    long["rest"] = (long["game_date"] - long["prev"]).dt.days
    h = long[long.side == "home"].drop_duplicates("espn_event_id").set_index("espn_event_id")["rest"]
    a = long[long.side == "away"].drop_duplicates("espn_event_id").set_index("espn_event_id")["rest"]
    out = g.drop_duplicates("espn_event_id").set_index("espn_event_id")
    return pd.DataFrame({
        "h_rest": h, "a_rest": a,
        "neutral": out["neutral_site"].fillna(0).astype(int) if "neutral_site" in out.columns else 0,
    })


def stack_frame(sides, games, probs):
    """Design matrix for completed non-tie games with a team+starter probability
    and a full lineup on both sides."""
    if games is None or not len(games) or not sides:
        return pd.DataFrame(columns=["espn_event_id", "game_date", "y", *FEATURES])
    rest = add_rest(games)
    rows = []
    for g in games.itertuples(index=False):
        hs, aws = g.home_score, g.away_score
        if hs is None or aws is None or (isinstance(hs, float) and math.isnan(hs)):
            continue
        if isinstance(aws, float) and math.isnan(aws):
            continue
        if float(hs) == float(aws):
            continue
        if not int(getattr(g, "completed", 1) or 0):
            continue
        eid = int(g.espn_event_id)
        p = probs.get(eid)
        if p is None:
            continue
        home = sides.get((eid, int(g.home_team_id)))
        away = sides.get((eid, int(g.away_team_id)))
        info = rest.loc[eid] if eid in rest.index else None
        if info is None:
            continue
        vec = stack_vector(p, home, away, info["h_rest"], info["a_rest"], info["neutral"])
        if vec is None:
            continue
        day = pd.Timestamp(g.game_date)
        if day < pd.Timestamp(TRAIN_FROM):
            continue
        rows.append({"espn_event_id": eid, "game_date": day.strftime("%Y-%m-%d"),
                     "y": int(float(hs) > float(aws)),
                     **{c: v for c, v in zip(FEATURES, vec)}})
    return pd.DataFrame(rows)


def snapshot_team_probs(conn):
    """espn_event_id → team+starter probability from the game-day forecast.

    This is the number stored with that morning's rating snapshot. A row this
    stack already replaced, or an Elo blend with no stored base, is left out.
    """
    probs = _read(conn,
                  "SELECT espn_event_id, player_prob_base, home_prob, mlb_model_src, elo_weight "
                  "FROM forecast_snapshots WHERE league = 'mlb' AND snapshot_date = game_date")
    out = {}
    if not len(probs):
        return out
    for r in probs.itertuples(index=False):
        src = getattr(r, "mlb_model_src", None)
        p = team_starter_prob(getattr(r, "player_prob_base", None), r.home_prob,
                              src, getattr(r, "elo_weight", None))
        if p is not None and r.espn_event_id is not None and not pd.isna(r.espn_event_id):
            out[int(r.espn_event_id)] = p
    return out


def _hist_team_probs(conn):
    """espn_event_id → walk-forward team+starter probability.

    Missing table (init_db not run yet) is an empty map, so the morning job
    still trains on the snapshots it has.
    """
    try:
        rows = conn.execute(
            "SELECT espn_event_id, p FROM mlb_team_chance_hist").fetchall()
    except sqlite3.OperationalError:
        return {}
    out = {}
    for eid, p in rows:
        if eid is None or p is None:
            continue
        try:
            pf = float(p)
        except (TypeError, ValueError):
            continue
        if np.isfinite(pf):
            out[int(eid)] = pf
    return out


def load_team_probs(conn):
    """espn_event_id → production team+starter probability.

    A game-day snapshot wins. `mlb_team_chance_hist` fills games that have
    no usable snapshot. The live forecast does not read the history table.
    """
    out = _hist_team_probs(conn)
    out.update(snapshot_team_probs(conn))
    return out


def load_training_frame(conn, through):
    """Completed games through `through` with a production team+starter
    probability and stack B features from earlier games only.

    The probability is the game-day snapshot when one is stored, and
    `mlb_team_chance_hist` otherwise."""
    frames = load_history(conn, through)
    if not len(frames["batting"]) or not len(frames["pitching"]) or not len(frames["games"]):
        return pd.DataFrame()
    B, P, _priors = prepare_rates(frames)
    sides = side_features(B, P)
    played = frames["games"]
    played = played[played["game_date"].astype(str).str[:10] <= through]
    return stack_frame(sides, played, load_team_probs(conn))


def refit(conn, today, log=print):
    """Fit stack B on completed games through yesterday.

    Raises when the frame cannot be fit, so the caller keeps publishing the
    current path and the previous fit stays in place.
    """
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    through = (today - timedelta(days=1)).isoformat()
    frame = load_training_frame(conn, through)
    rows = training_rows(frame, today)
    packed = fit_matrix(frame, today)
    packed.update(fit_diagnostics(rows, packed))
    from . import db
    with db.immediate(conn):
        _save_fit(conn, today, packed, through)
    lt = lt_weight(packed)
    lt_txt = f"{lt:.2f}" if lt is not None and np.isfinite(lt) else "-"
    sd_team = packed["sd_team"]
    ratio = packed["sd_p"] / sd_team if sd_team else float("nan")
    ratio_txt = f"{ratio:.3f}" if np.isfinite(ratio) else "-"
    reason = unpublished_reason(packed)
    head = (f"mlb ridge {VERSION} n={packed['n_games']} c={packed['c_value']:g} "
            f"sd_p={packed['sd_p']:.4f} sd_team={sd_team:.4f} ratio={ratio_txt} lt={lt_txt}")
    if reason:
        head += f" WARN unpublished ({reason})"
    coefs = " ".join(f"{name} {value:.2f}" for name, value in zip(packed["features"], packed["coef"]))
    # morning() keeps 300 characters of its note. The summary is what it
    # stores. The coefficient list stays on the log line, after the warning.
    log(f"{head} coef {coefs}")
    return head


# ---------------------------------------------------------------- morning state


def _decay(last, when, hl):
    gap = (pd.Timestamp(when).normalize() - pd.Timestamp(last).normalize()).days
    if gap < 0:
        gap = 0
    return 0.5 ** (gap / float(hl))


def _has_key(row, key):
    """True when `row` is a dict or a Series and carries `key`.

    `build_state` freezes `DataFrame.to_dict('records')` rows. A Series check
    (`key in row.index`) raises on those dicts.
    """
    if isinstance(row, dict):
        return key in row
    index = getattr(row, "index", None)
    return index is not None and key in index


def freeze_batter(row, prior):
    """Sums after this game, so a later date can decay them."""
    k = prior["k"]
    pr = prior["prior"]
    expo = float(row["pa_expo"])
    sums = {}
    for m in BAT_METRICS:
        pre = float(row[f"{m}_r"]) * (expo + k) - k * pr[m]
        sums[m] = pre + float(row[m])
    vs = {}
    for hd in ("L", "R"):
        pre_e = float(row[f"vs{hd}_e"])
        pre_s = float(row[f"vs{hd}_sum"])
        hit = 1.0 if row.get("sp_hand", "R") == hd else 0.0
        vs[hd] = {"mass": pre_e + float(row["pa"]) * hit,
                  "sum": pre_s + float(row["wv"]) * hit}
    sc = _freeze_contact(row, prior.get("sc") or {"prior": SC_FILL, "k": K_SC_BAT, "hl": HL_SC_BAT})
    return {
        "last": pd.Timestamp(row["game_date"]).strftime("%Y-%m-%d"),
        "hl": prior["hl"], "k": k, "prior": pr,
        "mass": expo + float(row["pa"]), "sums": sums, "vs": vs,
        "bats": row.get("bats") or "R", "sc": sc,
    }


def _freeze_contact(row, sc_prior):
    """Contact sums after this game. A player with no batted balls stores a
    zero mass and the league prior."""
    pr = sc_prior["prior"]
    k = sc_prior["k"]
    expo = 0.0
    if _has_key(row, "bbe_expo") and row["bbe_expo"] is not None and np.isfinite(row["bbe_expo"]):
        expo = float(row["bbe_expo"])
    # The merged contact rate is the pregame rate. We do not have this game's
    # batted-ball counts on the batting row, so the stored state stays at the
    # pregame mass. The next decay still moves a quiet player toward the prior,
    # and a player with no contact history stays on the prior. Close enough for
    # a live slate: the morning rebuild reads the contact table directly.
    return {"hl": sc_prior["hl"], "k": k, "prior": pr,
            "xw_sum": float(row.get("xwcon_r", pr["xw"])) * expo,
            "xw_n": expo, "hard": float(row.get("hard_hit_r", pr["hard"])) * expo,
            "barrel": float(row.get("barrels_r", pr["barrel"])) * expo,
            "bbe": expo, "ev": float(row.get("ev_r", pr["ev"])) * expo, "ev_n": expo}


def freeze_pitcher(row, prior):
    k = prior["k"]
    pr = prior["prior"]
    expo = float(row["_expo"])
    sums = {}
    for m, col in (("k", "k"), ("bbh", "bbh"), ("hr", "hr"), ("h", "h")):
        pre = float(row[f"{m}_r"]) * (expo + k) - k * pr[m]
        sums[m] = pre + float(row[col])
    outs_n = 0.0
    outs_sum = 0.0
    if np.isfinite(row.get("exp_outs", np.nan)):
        # pregame ewm is the mean of earlier starts; fold this start in
        # with one weight, decayed forward later from this date
        outs_n = 1.0
        outs_sum = float(row["exp_outs"]) + float(row["outs"])
        # The pregame mean already summarizes earlier starts. Keep it as one
        # pseudo-start plus this start so the next projection is
        # (ewm + outs) / 2 decayed. That understates a long career's sample.
        # Store the pregame mean and a count proxy from the exposure instead.
    bf = float(row["bf"]) if np.isfinite(row.get("bf", np.nan)) else 0.0
    # Exposure is batters faced. Expected outs uses a start count. Use the
    # decayed start count implied by treating each start as weight 1 and
    # carrying the pregame ewm. A debut stores just this start.
    if np.isfinite(row.get("_ewm", np.nan)):
        # Cannot recover the start count from the mean alone. Carry the
        # pregame mean as the decayed sum with count 1, then add this start.
        outs_sum = float(row["_ewm"]) + float(row["outs"])
        outs_n = 2.0
    else:
        outs_sum = float(row["outs"])
        outs_n = 1.0
    sc = _freeze_contact(row, prior.get("sc") or {"prior": SC_FILL, "k": K_SC_PIT, "hl": HL_SC_PIT})
    return {
        "last": pd.Timestamp(row["game_date"]).strftime("%Y-%m-%d"),
        "hl": prior["hl"], "k": k, "prior": pr,
        "mass": expo + bf, "sums": sums,
        "outs_sum": outs_sum, "outs_n": outs_n,
        "hand_L": int(row.get("hand_L") or 0),
        "sc": sc,
    }


def project_batter(js, when):
    """Pregame batting rates on `when`, decayed from the last game."""
    d = _decay(js["last"], when, js["hl"])
    k = js["k"]
    pr = js["prior"]
    mass = js["mass"] * d
    rates = {}
    for m, sm in js["sums"].items():
        rates[f"{m}_r"] = (sm * d + k * pr[m]) / (mass + k)
    wv = rates["wv_r"]
    for hd in ("L", "R"):
        em = js["vs"][hd]["mass"] * d
        es = js["vs"][hd]["sum"] * d
        rates[f"wv_vs{hd}"] = (es + K_PLAT * wv) / (em + K_PLAT)
    sc = dict(js["sc"])
    sc["last"] = js["last"]
    contact = _project_contact(sc, when)
    return {
        "wv_r": rates["wv_r"], "bb_r": rates["bb_r"], "k_r": rates["k_r"],
        "hr_r": rates["hr_r"], "iso_r": rates["iso_r"], "pa_expo": mass,
        "wv_vsL": rates["wv_vsL"], "wv_vsR": rates["wv_vsR"],
        "bats": js.get("bats") or "R", **contact,
    }


def _project_contact(sc, when):
    """Contact rates on `when`. Sums are as of `sc['last']` when that is set."""
    last = sc.get("last")
    decay = _decay(last, when, sc["hl"]) if last else 1.0
    k = sc["k"]
    pr = sc["prior"]

    def shrunk(sm, mass, key):
        m = mass * decay
        if m <= 0 and sm == 0:
            return pr[key]
        return (sm * decay + k * pr[key]) / (m + k)

    return {
        "xwcon_r": shrunk(sc["xw_sum"], sc["xw_n"], "xw"),
        "hard_hit_r": shrunk(sc["hard"], sc["bbe"], "hard"),
        "barrels_r": shrunk(sc["barrel"], sc["bbe"], "barrel"),
        "ev_r": shrunk(sc["ev"], sc["ev_n"], "ev"),
    }


def project_pitcher(js, when):
    d = _decay(js["last"], when, js["hl"])
    k = js["k"]
    pr = js["prior"]
    mass = js["mass"] * d
    rates = {m: (js["sums"][m] * d + k * pr[m]) / (mass + k) for m in js["sums"]}
    outs_n = js["outs_n"] * d
    exp = (js["outs_sum"] * d / outs_n) if outs_n > 0 else np.nan
    sc = dict(js["sc"])
    sc["last"] = js["last"]
    contact = _project_contact(sc, when)
    return {
        "k_r": rates["k"], "bbh_r": rates["bbh"], "hr_r": rates["hr"], "h_r": rates["h"],
        "kbb": rates["k"] - rates["bbh"],
        "fip_bf": 13 * rates["hr"] + 3 * rates["bbh"] - 2 * rates["k"],
        "expo": mass, "exp_outs": exp, "hand_L": js.get("hand_L") or 0,
        "xwcon": contact["xwcon_r"], "hard": contact["hard_hit_r"],
        "barrel": contact["barrels_r"],
    }


def _blank_batter(hands_side, prior):
    pr = prior["prior"]
    scp = (prior.get("sc") or {"prior": SC_FILL})["prior"]
    return {
        "wv_r": pr["wv"], "bb_r": pr["bb"], "k_r": pr["k"], "hr_r": pr["hr"], "iso_r": pr["iso"],
        "pa_expo": 0.0, "wv_vsL": pr["wv"], "wv_vsR": pr["wv"],
        "bats": hands_side or "R",
        "xwcon_r": scp["xw"], "hard_hit_r": scp["hard"], "barrels_r": scp["barrel"], "ev_r": scp["ev"],
    }


def _blank_pitcher(hand_l, prior):
    pr = prior["prior"]
    scp = (prior.get("sc") or {"prior": SC_FILL})["prior"]
    return {
        "k_r": pr["k"], "bbh_r": pr["bbh"], "hr_r": pr["hr"], "h_r": pr["h"],
        "kbb": pr["k"] - pr["bbh"],
        "fip_bf": 13 * pr["hr"] + 3 * pr["bbh"] - 2 * pr["k"],
        "expo": 0.0, "exp_outs": np.nan, "hand_L": hand_l,
        "xwcon": scp["xw"], "hard": scp["hard"], "barrel": scp["barrel"],
    }


def build_state(conn, today, log=print):
    """Replace player rate state and the reliever log with games through yesterday."""
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    through = (today - timedelta(days=1)).isoformat()
    frames = load_history(conn, through)
    B, P, priors = prepare_rates(frames) if len(frames["batting"]) or len(frames["pitching"]) else (
        pd.DataFrame(), pd.DataFrame(), {})
    rows = []
    if priors.get("bat"):
        priors["bat"]["sc"] = priors.get("sc_bat") or {"prior": SC_FILL, "k": K_SC_BAT, "hl": HL_SC_BAT}
        rows.append((today.isoformat(), 0, "prior_bat", None, _jdump(priors["bat"])))
    if priors.get("pit"):
        priors["pit"]["sc"] = priors.get("sc_pit") or {"prior": SC_FILL, "k": K_SC_PIT, "hl": HL_SC_PIT}
        rows.append((today.isoformat(), 0, "prior_pit", None, _jdump(priors["pit"])))
    if len(B) and priors.get("bat"):
        last = B.sort_values(["athlete_id", "game_date", "espn_event_id"]).groupby("athlete_id", sort=False).tail(1)
        for r in last.to_dict("records"):
            js = freeze_batter(r, priors["bat"])
            rows.append((today.isoformat(), int(r["athlete_id"]), "batter", js["last"], _jdump(js)))
    if len(P) and priors.get("pit"):
        last = P.sort_values(["athlete_id", "game_date", "espn_event_id"]).groupby("athlete_id", sort=False).tail(1)
        for r in last.to_dict("records"):
            js = freeze_pitcher(r, priors["pit"])
            rows.append((today.isoformat(), int(r["athlete_id"]), "pitcher", js["last"], _jdump(js)))
    relief = []
    if len(P):
        rel = P[P["starter"] != 1]
        for r in rel.itertuples(index=False):
            fip = getattr(r, "fip_bf", np.nan)
            xw = getattr(r, "xwcon_r", np.nan)
            relief.append((int(r.team_id), pd.Timestamp(r.game_date).strftime("%Y-%m-%d"),
                           int(r.espn_event_id), int(r.athlete_id),
                           float(r.outs), float(r.pitches),
                           None if not np.isfinite(fip) else float(fip),
                           None if not np.isfinite(xw) else float(xw)))
    from . import db
    with db.immediate(conn):
        conn.execute("DELETE FROM mlb_player_state")
        conn.executemany(
            "INSERT INTO mlb_player_state (as_of_date, athlete_id, role, last_game_date, state_json) "
            "VALUES (?,?,?,?,?)", rows)
        conn.execute("DELETE FROM mlb_relief_log")
        conn.executemany(
            "INSERT INTO mlb_relief_log (team_id, game_date, espn_event_id, athlete_id, outs, pitches, "
            "fip_bf, xwcon) VALUES (?,?,?,?,?,?,?,?)", relief)
    log(f"mlb player state {len(rows)} relief {len(relief)} through {through}")
    return len(rows)


def morning(conn, today, log=print):
    """Daily MLB step before apply: refit on Tuesday (or when no fit is
    stored), then replace player state.

    A failure is reported in the returned note and does not raise. The last
    stored fit stays available. The daily job calls this only while MLB is
    in season.
    """
    today = today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
    parts = []
    if refit_due(conn, today):
        try:
            parts.append(refit(conn, today, log=log))
        except Exception as e:
            parts.append(f"mlb ridge refit skipped ({type(e).__name__}: {e})"[:180])
            log(traceback.format_exc())
    try:
        n = build_state(conn, today, log=log)
        parts.append(f"state {n}")
    except Exception as e:
        parts.append(f"mlb player state skipped ({type(e).__name__}: {e})"[:180])
        log(traceback.format_exc())
    return "; ".join(p for p in parts if p)[:300]


def load_state(conn):
    """(batters, pitchers, priors) from the morning state. Empty when missing."""
    try:
        rows = conn.execute(
            "SELECT athlete_id, role, state_json FROM mlb_player_state").fetchall()
    except sqlite3.OperationalError:
        return {}, {}, {}
    bat, pit, priors = {}, {}, {}
    for r in rows:
        js = json.loads(r["state_json"])
        if r["role"] == "batter":
            bat[int(r["athlete_id"])] = js
        elif r["role"] == "pitcher":
            pit[int(r["athlete_id"])] = js
        elif r["role"] == "prior_bat":
            priors["bat"] = js
        elif r["role"] == "prior_pit":
            priors["pit"] = js
    return bat, pit, priors


# ---------------------------------------------------------------- publishing


def posted_lineup(conn, event_id, team_id, as_of):
    """Nine posted batters, or None. The previous lineup is not a fallback."""
    from .player_adj import mlb_posted
    lu, src = mlb_posted(conn, event_id, team_id, as_of)
    if src != "posted" or not lu or len(lu) < 9:
        return None
    slots = sorted((int(a), int(s)) for a, s in lu if s is not None)
    if len({s for _, s in slots}) < 9:
        return None
    return slots[:9]


def confirmed_starter(conn, event_id, team_id, as_of):
    """(athlete id, source) when a starter is named, else (None, None).

    The lineup's pitcher (slot 0) or the scoreboard probable. The pitcher
    from an earlier game is not used.
    """
    try:
        row = conn.execute(
            "SELECT athlete_id FROM mlb_lineup_states WHERE espn_event_id = ? AND team_id = ? "
            "AND slot = 0 AND athlete_id IS NOT NULL AND valid_from <= ? "
            "AND (valid_to IS NULL OR valid_to > ?) ORDER BY valid_from DESC LIMIT 1",
            (int(event_id), int(team_id), as_of, as_of)).fetchone()
    except sqlite3.OperationalError:
        row = None
    if row and row["athlete_id"]:
        return int(row["athlete_id"]), "lineup"
    try:
        row = conn.execute(
            "SELECT athlete_id FROM game_probables WHERE espn_event_id = ? AND team_id = ? "
            "AND league = 'mlb' AND athlete_id IS NOT NULL AND kind = 'SP' "
            "AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?) "
            "ORDER BY valid_from DESC LIMIT 1",
            (int(event_id), int(team_id), as_of, as_of)).fetchone()
    except sqlite3.OperationalError:
        row = None
    if row and row["athlete_id"]:
        return int(row["athlete_id"]), "probable"
    return None, None


def _relief_table(conn, team_ids, day):
    if not team_ids:
        return pd.DataFrame(columns=["team_id", "game_date", "outs", "pitches", "fip_bf", "xwcon"])
    start = (pd.Timestamp(day) - pd.Timedelta(days=BP_DAYS + 1)).strftime("%Y-%m-%d")
    q = ",".join("?" * len(team_ids))
    return _read(conn,
                 f"SELECT team_id, game_date, outs, pitches, fip_bf, xwcon FROM mlb_relief_log "
                 f"WHERE team_id IN ({q}) AND game_date >= ? AND game_date < ?",
                 (*tuple(int(t) for t in team_ids), start, str(day)[:10]))


def _rest_for(conn, home, away, day):
    """Days since each club's previous counted game, before `day`."""
    try:
        rows = conn.execute(
            "SELECT game_date, home_team_id, away_team_id FROM games WHERE league = 'mlb' "
            "AND season_type IN (2, 3) AND game_date < ? AND (home_team_id IN (?, ?) "
            "OR away_team_id IN (?, ?)) ORDER BY game_date",
            (str(day)[:10], int(home), int(away), int(home), int(away))).fetchall()
    except sqlite3.OperationalError:
        return None, None
    last = {}
    for r in rows:
        for t in (r["home_team_id"], r["away_team_id"]):
            if t in (int(home), int(away)):
                last[int(t)] = r["game_date"]
    def gap(team):
        prev = last.get(int(team))
        if not prev:
            return None
        return (pd.Timestamp(day) - pd.Timestamp(prev)).days
    return gap(home), gap(away)


def shift_margin(team_prob, team_spread, total, home_tp, away_tp, ridge_prob):
    """Move the current path's margin onto the ridge chance. The total stays."""
    from .margin import SLOPE
    s = SLOPE["mlb"]
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
    """Fingerprint of the lineup feeds, the probable, the state, and the fit."""
    parts = []
    for sql in (
            "SELECT MAX(valid_from) FROM mlb_lineup_states",
            "SELECT MAX(valid_from) FROM game_probables WHERE league = 'mlb'",
            "SELECT MAX(l.fetched_at) FROM pregame_lineups l JOIN games g "
            "ON g.espn_event_id = l.espn_event_id WHERE g.league = 'mlb' AND l.role = 'lineup'",
            "SELECT MAX(as_of_date) FROM mlb_player_state",
            "SELECT MAX(fit_date) FROM mlb_ridge_fits"):
        try:
            parts.append(str(conn.execute(sql).fetchone()[0]))
        except sqlite3.Error:
            parts.append("-")
    return "|".join(parts)


def _score_side(lineup, starter, opp_hand, bullpen, bat_state, pit_state, priors, hands, when):
    if not priors.get("bat") or not priors.get("pit"):
        return None
    rows = []
    for aid, slot in lineup:
        js = bat_state.get(int(aid))
        if js is None:
            row = _blank_batter((hands.get(int(aid)) or {}).get("bats"), priors["bat"])
        else:
            row = project_batter(js, when)
            if not row.get("bats"):
                row["bats"] = (hands.get(int(aid)) or {}).get("bats") or "R"
        row["bat_order"] = slot
        rows.append(row)
    bat = pd.DataFrame(rows)
    pjs = pit_state.get(int(starter))
    if pjs is None:
        hand = (hands.get(int(starter)) or {}).get("throws")
        rates = _blank_pitcher(1 if hand == "L" else 0, priors["pit"])
    else:
        rates = project_pitcher(pjs, when)
    q, qc, p1, p3 = bullpen
    feat = {}
    feat.update(bat_feats(bat, bat["bat_order"].to_numpy(int), opp_hand))
    feat.update(pit_feats(rates, q, qc))
    feat["bp_q"], feat["bp_xwcon"], feat["bp_p1"], feat["bp_p3"] = q, qc, p1, p3
    return feat


def _prepare_slate(conn, frame, as_of):
    bat, pit, priors = load_state(conn)
    hands = load_hands(conn)
    fit = load_fit(conn)
    sides = {}
    teams = set()
    days = []
    for i in range(len(frame)):
        eid = int(frame.at[i, "espn_event_id"])
        for tm in (int(frame.at[i, "home_team_id"]), int(frame.at[i, "away_team_id"])):
            teams.add(tm)
            if (eid, tm) not in sides:
                lu = posted_lineup(conn, eid, tm, as_of)
                aid, src = confirmed_starter(conn, eid, tm, as_of)
                sides[(eid, tm)] = (lu, aid, src)
        days.append(str(frame.at[i, "game_date"])[:10])
    day = min(days) if days else as_of[:10]
    relief = _relief_table(conn, teams, day)
    return {"fit": fit, "bat": bat, "pit": pit, "priors": priors, "hands": hands,
            "sides": sides, "relief": relief, "key": inputs_key(conn)}


def _score_row(row, slate):
    """Audit fields, and the published prob and spread when stack B runs."""
    eid = int(row["espn_event_id"])
    home, away = int(row["home_team_id"]), int(row["away_team_id"])
    gd = str(row["game_date"])[:10]
    team_prob = float(row["home_prob"])
    h_lu, h_id, h_src = slate["sides"].get((eid, home), (None, None, None))
    a_lu, a_id, a_src = slate["sides"].get((eid, away), (None, None, None))
    fit = slate["fit"]
    n_txt, c_txt = _fit_bits(fit)
    inputs = (f"k={slate['key']};home_lu={1 if h_lu else 0};away_lu={1 if a_lu else 0};"
              f"home={h_id if h_id is not None else '-'}:{h_src or '-'};"
              f"away={a_id if a_id is not None else '-'}:{a_src or '-'};n={n_txt};c={c_txt}")
    base = {"mlb_model_src": "team", "mlb_team_prob": team_prob, "mlb_ridge_prob": None,
            "mlb_ridge_fit_id": None, "mlb_inputs": inputs, "era": "team_model"}
    reason = unpublished_reason(fit) if fit else "no fit"
    short = (fit is None or int(fit.get("n_games") or 0) < MIN_PUBLISH_GAMES
             or reason is not None)
    if h_lu is None or a_lu is None or h_id is None or a_id is None or short:
        return base
    if list(fit["features"]) != list(FEATURES):
        return base
    raw = row["player_prob_base"] if _has_key(row, "player_prob_base") else None
    try:
        base_p = float(raw)
    except (TypeError, ValueError):
        return base
    if not np.isfinite(base_p):
        return base
    hands = slate["hands"]
    h_hand = "L" if (slate["pit"].get(h_id) or {}).get("hand_L") else (
        "L" if (hands.get(h_id) or {}).get("throws") == "L" else "R")
    a_hand = "L" if (slate["pit"].get(a_id) or {}).get("hand_L") else (
        "L" if (hands.get(a_id) or {}).get("throws") == "L" else "R")
    # The home lineup hits against the away starter, and the reverse.
    h_bp = bullpen_at(slate["relief"], home, gd)
    a_bp = bullpen_at(slate["relief"], away, gd)
    h_id, a_id, bat, pit = _scenario_sides(slate, h_id, a_id)
    h_lu, a_lu, h_id, a_id = _apply_order(slate, h_lu, a_lu, h_id, a_id)
    try:
        hf = _score_side(h_lu, h_id, a_hand, h_bp, bat, pit,
                         slate["priors"], hands, gd)
        af = _score_side(a_lu, a_id, h_hand, a_bp, bat, pit,
                         slate["priors"], hands, gd)
    except Exception:
        return base
    _scale_side(hf, slate)
    _scale_side(af, slate)
    h_rest, a_rest = None, None
    neutral = 0
    if _has_key(row, "neutral") and row["neutral"] is not None and not (
            isinstance(row["neutral"], float) and math.isnan(row["neutral"])):
        neutral = int(row["neutral"])
    # Rest is attached by the caller when it has it; otherwise score_row asks.
    if _has_key(row, "h_rest"):
        h_rest, a_rest = row["h_rest"], row["a_rest"]
    vec = stack_vector(base_p, hf, af, h_rest, a_rest, neutral, fill_missing=True)
    if vec is None or not np.isfinite(vec).all():
        return base
    p = float(predict_stored(fit, np.asarray(vec, float).reshape(1, -1))[0])
    new_p, spread, ht, at = shift_margin(
        team_prob, row["home_spread"], row["total_pred"],
        row["home_total_pred"], row["away_total_pred"], p)
    return {"mlb_model_src": VERSION, "mlb_team_prob": team_prob, "mlb_ridge_prob": new_p,
            "mlb_ridge_fit_id": fit["fit_id"], "mlb_inputs": inputs, "era": "player_model",
            "home_prob": new_p, "home_spread": spread,
            "home_total_pred": ht, "away_total_pred": at}


def _log_fallback(event_id, exc):
    logging.getLogger(__name__).warning(
        "mlb player fallback event %s: %s: %s", event_id, type(exc).__name__, exc)


def mark_team(forecast):
    """Stamp the current path as the published MLB source. Probabilities stay."""
    if forecast is None or not len(forecast):
        return forecast
    f = forecast.copy()
    f["mlb_model_src"] = "team"
    f["mlb_team_prob"] = f["home_prob"].to_numpy(float)
    f["mlb_ridge_prob"] = np.nan
    f["mlb_ridge_fit_id"] = np.nan
    if "mlb_inputs" not in f.columns:
        f["mlb_inputs"] = None
    f["era"] = "team_model"
    return f


def _reorder(lineup, order):
    """Put the named batters in the given order. Anyone left out stays off."""
    if not order or not lineup:
        return lineup
    by_id = {}
    for aid, _slot in lineup:
        try:
            by_id[int(aid)] = int(aid)
        except (TypeError, ValueError):
            continue
    out = []
    slot = 1
    for raw in order:
        try:
            aid = int(raw)
        except (TypeError, ValueError):
            continue
        if aid not in by_id:
            continue
        out.append((aid, slot))
        slot += 1
        if slot > 9:
            break
    return out or lineup


def _apply_order(slate, h_lu, a_lu, h_id, a_id):
    """A chosen pitcher and batting order replace the posted ones."""
    line = (slate.get("scenario") or {}).get("line") or {}
    sp = line.get("sp") or {}
    for side, current in (("h", h_id), ("a", a_id)):
        raw = sp.get(side)
        if raw is None:
            continue
        try:
            picked = int(raw)
        except (TypeError, ValueError):
            continue
        if side == "h":
            h_id = picked
        else:
            a_id = picked
    bo = line.get("bo") or {}
    return _reorder(h_lu, bo.get("h")), _reorder(a_lu, bo.get("a")), h_id, a_id


def _scenario_sides(slate, h_id, a_id):
    """A toggled starter becomes a replacement arm. A toggled batter is blank."""
    scenario = slate.get("scenario") or {}
    toggles = {int(a) for a in (scenario.get("toggle") or ())}
    bat, pit = slate["bat"], slate["pit"]
    if not toggles:
        return h_id, a_id, bat, pit
    bat = {k: v for k, v in bat.items() if int(k) not in toggles}
    pit = {k: v for k, v in pit.items() if int(k) not in toggles}
    if h_id is not None and int(h_id) in toggles:
        h_id = -1
    if a_id is not None and int(a_id) in toggles:
        a_id = -1
    return h_id, a_id, bat, pit


def _scale_side(feat, slate):
    scales = (slate.get("scenario") or {}).get("scale") or {}
    if not feat or not scales:
        return
    mapping = {"bb": "bat_bb", "k": "bat_k", "hr": "bat_hr",
               "pk": "sp_k", "pbb": "sp_bbh", "phr": "sp_hr"}
    for key, col in mapping.items():
        if key not in scales or col not in feat:
            continue
        try:
            feat[col] = float(feat[col]) * float(scales[key])
        except (TypeError, ValueError):
            pass


def overlay(conn, frame, as_of, today=None, scenario=None):
    """Publish stack B where both lineups are posted and both starters are known.

    home_prob, home_spread and the team totals are the current MLB path.
    Rows that stay on that path keep those numbers and are stamped team.
    Does not write.
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
        for event_id in (list(f["espn_event_id"]) if "espn_event_id" in f.columns else ["?"]):
            _log_fallback(event_id, exc)
        return mark_team(f)
    f["h_rest"] = np.nan
    f["a_rest"] = np.nan
    if "neutral" not in f.columns and "neutral_site" in f.columns:
        f["neutral"] = f["neutral_site"]
    rests = {}
    for i in range(len(f)):
        eid = int(f.at[i, "espn_event_id"])
        if eid not in rests:
            rests[eid] = _rest_for(conn, int(f.at[i, "home_team_id"]), int(f.at[i, "away_team_id"]),
                                   str(f.at[i, "game_date"])[:10])
        f.at[i, "h_rest"], f.at[i, "a_rest"] = rests[eid]
        if "neutral_site" in f.columns and "neutral" not in f.columns:
            f.at[i, "neutral"] = f.at[i, "neutral_site"]
    probs = np.array(f["home_prob"], dtype=float, copy=True)
    for i in range(len(f)):
        try:
            scored = _score_row(f.loc[i], slate)
        except Exception as exc:
            event_id = f.at[i, "espn_event_id"] if "espn_event_id" in f.columns else "?"
            _log_fallback(event_id, exc)
            scored = {"mlb_model_src": "team", "mlb_team_prob": float(f.at[i, "home_prob"]),
                      "mlb_ridge_prob": None, "mlb_ridge_fit_id": None, "mlb_inputs": None,
                      "era": "team_model"}
        for k, v in scored.items():
            f.at[i, k] = v
        if "home_prob" in scored:
            probs[i] = scored["home_prob"]
    from .forecast import apply_home_probs
    out = apply_home_probs(f, probs)
    if "away_spread" in out.columns:
        out["away_spread"] = -out["home_spread"]
    return out


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
        f["neutral"] = s["neutral"].to_numpy()
    return overlay(conn, f, as_of, today)


def _current(series, key):
    return str(series or "").startswith(f"k={key};")


def refresh(conn, now=None, log=print, force=False):
    """Recompute the MLB chance for games that have not started and are not locked.

    The current path is rebuilt from the stored pre-player values, then stack B
    replaces the published chance where both lineups are posted and both
    starters are known. Past forecast rows and existing locks are not read.
    `force` recomputes even when the fingerprints match, which is how a new
    fit, a new probable, or a newly posted lineup reaches today's games.
    """
    from . import player_adj as pa
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    as_of = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    today = now.astimezone(pa.CHICAGO).date().isoformat()
    key = pa.inputs_key(conn, "mlb", today)
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
                params={"today": today, "lg": "mlb"})
        except (sqlite3.OperationalError, pd.errors.DatabaseError):
            continue
        if not len(rows):
            continue
        st = pd.to_datetime(rows["start_time_utc"], utc=True)
        rows = rows[(st - pd.Timestamp(now).tz_convert("UTC")) > pa.LOCK_MARGIN].reset_index(drop=True)
        if not len(rows):
            continue
        if not force:
            player_same = bool((rows["player_inputs"] == key).all()) if "player_inputs" in rows.columns else False
            stamped = "mlb_inputs" in rows.columns and bool(rows["mlb_inputs"].notna().any())
            if stamped:
                ridge_same = bool(rows["mlb_inputs"].map(lambda s: _current(s, ridge_key)).all())
            else:
                ridge_same = False
            if player_same and ridge_same:
                continue
        if state is None:
            state = pa.STATE_FN["mlb"](conn, today)

        def adjust(frame, _as=as_of):
            return overlay(conn, frame, _as)

        n = pa._refresh_rows(conn, "mlb", rows, table, pk, as_of, key, state, adjust=adjust)
        total += n
        if n:
            early = "" if table == "forecast_snapshots" else " early"
            log(f"mlb ridge refresh{early}: {n} of {len(rows)} forecasts updated")
    return total or None


def _main(argv=None):
    """Fit stack B, replace its state, and refresh unlocked forecasts.

    Past forecast rows and existing locks are not rewritten. A stored fit
    with fewer than 2,000 games, a squeezed in-sample spread, or a mean
    more than 0.03 from the home win rate does not publish.
    """
    from . import db
    ap = argparse.ArgumentParser(description="Fit the MLB player stack and refresh unlocked forecasts")
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
