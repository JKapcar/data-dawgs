# Forecasts for unplayed games: win probability, spread, team totals, odds.

import numpy as np
import pandas as pd

from .hybrid import build_features


def prob_to_american_odds(prob):
    prob = np.asarray(prob, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        odds = np.where(prob > 0.5,
                        -100 * prob / (1 - prob),
                        100 * (1 - prob) / prob)
    bad = np.isnan(prob) | (prob <= 0) | (prob >= 1)
    odds = np.where(bad, np.nan, np.round(odds))
    return odds


def forecast_games(schedule: pd.DataFrame, ratings: pd.Series,
                   team_stats: pd.DataFrame, hybrid: dict,
                   league_avg_points: float, w_totals: float = 0.6) -> pd.DataFrame:
    """`schedule` uses the standard games contract (scores NaN). Sign
    conventions are sportsbook-style: home_spread negative when home favored."""
    def side(sched, warn=True):
        feats = build_features(sched, ratings, team_stats, warn_unknown=warn)
        prob = np.asarray(hybrid["winprob_fit"].predict(feats), dtype=float)
        margin = np.asarray(hybrid["mov_fit"].predict(feats), dtype=float)
        if hybrid.get("points_model", "ols") != "ols":
            # count GLM (Poisson / negative binomial): expected points are the
            # GLM means directly, no OLS / OS*DS blend
            pts_h = np.asarray(hybrid["home_count_fit"].predict(feats), dtype=float)
            pts_a = np.asarray(hybrid["away_count_fit"].predict(feats), dtype=float)
            return prob, margin, pts_h, pts_a
        reg_h = np.maximum(np.asarray(hybrid["home_pts_fit"].predict(feats), dtype=float), 0)
        reg_a = np.maximum(np.asarray(hybrid["away_pts_fit"].predict(feats), dtype=float), 0)
        os_h = league_avg_points * feats["home_OS"].values * feats["away_DS"].values
        os_a = league_avg_points * feats["away_OS"].values * feats["home_DS"].values
        pts_h = w_totals * reg_h + (1 - w_totals) * os_h
        pts_a = w_totals * reg_a + (1 - w_totals) * os_a
        return prob, margin, pts_h, pts_a

    home_prob, home_margin, pts_home, pts_away = side(schedule)

    # Neutral site: no home edge. Average the game as listed with the same game
    # with home and away swapped, so the home term cancels out.
    neutral = (schedule["neutral"].fillna(0).astype(int).values == 1
               if "neutral" in schedule.columns else np.zeros(len(schedule), bool))
    if neutral.any():
        swapped = schedule.rename(columns={"home_team": "away_team", "away_team": "home_team"})
        s_prob, s_margin, s_pts_h, s_pts_a = side(swapped, warn=False)
        home_prob = np.where(neutral, (home_prob + 1 - s_prob) / 2, home_prob)
        home_margin = np.where(neutral, (home_margin - s_margin) / 2, home_margin)
        new_h = np.where(neutral, (pts_home + s_pts_a) / 2, pts_home)
        new_a = np.where(neutral, (pts_away + s_pts_h) / 2, pts_away)
        pts_home, pts_away = new_h, new_a

    # home_prob is rounded first, and the odds come from that rounded value.
    home_prob_r = np.round(home_prob, 4)

    return _forecast_frame(schedule, home_prob_r, home_margin, pts_home, pts_away)


def apply_home_probs(forecast: pd.DataFrame, home_prob) -> pd.DataFrame:
    """Replace win probabilities, and the American odds derived from them.

    Odds still come from the probability after it is rounded to 4 decimals,
    the same order `forecast_games` uses. This is how `run_model` publishes
    the posterior-averaged win chance without touching the spread or the total."""
    p = np.asarray(home_prob, dtype=float)
    if len(p) != len(forecast):
        raise ValueError("home_prob must match forecast rows.")
    # 4-decimal rounding turns 0.99995 into 1.0, and American odds of 1.0 are
    # undefined. Clip to the nearest probability the rounding can represent.
    p = np.round(np.clip(p, 0.0001, 0.9999), 4)
    out = forecast.copy()
    out["home_prob"] = p
    out["away_prob"] = np.round(1 - p, 4)
    out["home_odds"] = prob_to_american_odds(p)
    out["away_odds"] = prob_to_american_odds(1 - p)
    return out


def _forecast_frame(schedule, home_prob_r, home_margin, pts_home, pts_away):
    # reconcile team totals with the margin; clamp to [0, total]. All leagues,
    # count models included, so team points line up with the spread.
    total = pts_home + pts_away
    home_total = np.clip((total + home_margin) / 2, 0, total)
    away_total = total - home_total
    return pd.DataFrame({
        "season": schedule["season"].values,
        "date": schedule["date"].values,
        "home_team": schedule["home_team"].values,
        "away_team": schedule["away_team"].values,
        "home_prob": home_prob_r,
        "away_prob": np.round(1 - home_prob_r, 4),
        "home_spread": np.round(-home_margin, 1),
        "away_spread": np.round(home_margin, 1),
        "home_total_pred": np.round(home_total, 1),
        "away_total_pred": np.round(away_total, 1),
        "total_pred": np.round(total, 1),
        "home_odds": prob_to_american_odds(home_prob_r),
        "away_odds": prob_to_american_odds(1 - home_prob_r),
    })


def carry_margin(forecast: pd.DataFrame, league: str) -> pd.DataFrame:
    """Our model's expected margin moved with the published win chance, so the
    two always name the same favorite.

    The Elo stack (bayes_elo.apply_stack) moves only the win chance; its shift
    in home log-odds is carried into the margin at SLOPE points per unit of
    log-odds (margin.SLOPE, from the league's SD_MARGIN). The shift
    is the stack's alone: logit(stacked) - logit(logit chance), both before
    the player term (player_prob_base when present, else p_logit), since the
    player term already moves the margin itself (player_adj.shift). If the
    margin still names the other team (the margin and win-chance fits can
    disagree near an even game), it is set to the margin the win chance
    implies, SLOPE * logit(home_prob). Team totals follow the margin; the
    total is unchanged. Rows without p_logit / p_elo get only the agreement
    check. Apply once, after the stack (and the player restack)."""
    from .margin import SLOPE
    s = SLOPE.get(league)
    if s is None or forecast is None or not len(forecast) or "home_spread" not in forecast:
        return forecast
    f = forecast.copy()
    p = np.clip(pd.to_numeric(f["home_prob"], errors="coerce").to_numpy(float), 1e-4, 1 - 1e-4)
    lp = np.log(p / (1 - p))
    def col(c):
        return (pd.to_numeric(f[c], errors="coerce").to_numpy(float) if c in f
                else np.full(len(f), np.nan))
    base = col("player_prob_base")
    base = np.where(np.isfinite(base), base, col("p_logit"))     # logit chance, no player term
    pe, w = col("p_elo"), np.nan_to_num(col("elo_weight"), nan=0.0)
    ok = np.isfinite(base) & np.isfinite(pe) & (w > 0)
    b = np.clip(np.where(ok, base, 0.5), 1e-4, 1 - 1e-4)
    st = np.clip((1 - w) * b + w * np.where(ok, pe, 0.5), 1e-4, 1 - 1e-4)
    shift = np.where(ok, np.log(st / (1 - st)) - np.log(b / (1 - b)), 0.0)
    m0 = -pd.to_numeric(f["home_spread"], errors="coerce").to_numpy(float)
    m = m0 + s * shift
    fav = np.sign(np.round(p - 0.5, 4))
    m = np.where((fav != 0) & (np.sign(m) != fav), s * lp, m)
    m = np.where(np.isfinite(m0), m, m0)
    f["home_spread"] = np.round(-m, 1)
    if "away_spread" in f:
        f["away_spread"] = np.round(m, 1)
    if {"total_pred", "home_total_pred", "away_total_pred"} <= set(f.columns):
        t = pd.to_numeric(f["total_pred"], errors="coerce").to_numpy(float)
        moved = np.isfinite(t) & np.isfinite(m0) & (np.round(m, 1) != np.round(m0, 1))
        ht = np.clip((t + m) / 2, 0, t)
        f["home_total_pred"] = np.where(moved, np.round(ht, 1), f["home_total_pred"])
        f["away_total_pred"] = np.where(moved, np.round(t - ht, 1), f["away_total_pred"])
    return f
