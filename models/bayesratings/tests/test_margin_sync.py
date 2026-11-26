"""Win chance and margin name the same favorite.

carry_margin moves the Elo stack's shift into the margin at margin.SLOPE
points per unit of home logit. player_adj.refresh rewrites an early forecast
and leaves a locked or started game alone.
"""
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_player_adj as tpa  # noqa: E402

from bayesratings import margin, player_adj as pa  # noqa: E402
from bayesratings.forecast import carry_margin  # noqa: E402


def _lg(p):
    return math.log(p / (1 - p))


def disagree(home_prob, margin):
    """True when the shown win favorite and the shown margin favorite differ
    beyond rounding: the win chance is not 50/50 to the nearest point and the
    margin is not 0.0 to one decimal."""
    return (abs(home_prob - 0.5) >= 0.005 and abs(margin) >= 0.05
            and (home_prob > 0.5) != (margin > 0))


def test_slope_comes_from_the_league_spread():
    for lg, sd in margin.SD_MARGIN.items():
        assert abs(margin.SLOPE[lg] - sd * math.sqrt(2 * math.pi) / 4) < 1e-12
    assert abs(margin.SLOPE["nba"] - 8.95) < 0.01


def test_carry_moves_the_margin_with_the_stack():
    # logit model: home 45%, away by 1; the Elo stack lifts the win chance to 52%
    f = pd.DataFrame({"home_prob": [0.52], "away_prob": [0.48], "p_logit": [0.45],
                      "p_elo": [0.59], "elo_weight": [0.5], "home_spread": [1.0], "away_spread": [-1.0], "total_pred": [220.0],
                      "home_total_pred": [109.5], "away_total_pred": [110.5]})
    g = carry_margin(f, "nba")
    m = -1.0 + margin.SLOPE["nba"] * (_lg(0.52) - _lg(0.45))
    assert g.loc[0, "home_spread"] == round(-m, 1) and g.loc[0, "away_spread"] == round(m, 1)
    assert g.loc[0, "home_total_pred"] == round((220 + m) / 2, 1)
    assert g.loc[0, "away_total_pred"] == round(220 - (220 + m) / 2, 1)
    assert g.loc[0, "total_pred"] == 220.0 and g.loc[0, "home_prob"] == 0.52
    # no stack shift (Elo fallback: published = logit) and already agreeing: unchanged
    f2 = f.assign(home_prob=0.45, p_logit=0.45, elo_weight=0.0)
    assert carry_margin(f2, "nba").loc[0, "home_spread"] == 1.0
    assert carry_margin(f2, "nba").loc[0, "home_total_pred"] == 109.5


def test_carry_leaves_the_player_term_to_the_player_margin():
    """After the player restack p_logit carries the player shift scaled by
    1 / (1 - w); only the stack's own shift (from the pre-player chance) is
    carried, the player term already moved the margin."""
    xh, xa, w, pe = 3.0, -2.0, 0.8315, 0.6
    f = tpa._with_x("nfl", xh, xa)
    g = pa.shift(f, "nfl", [w], p_elo=[pe]).assign(p_elo=pe, elo_weight=w)   # as after the stack
    h = carry_margin(g, "nfl")
    pub0 = (1 - w) * 0.55 + w * pe
    m = 2.5 + pa.COEFS["nfl"]["margin"][0] * (xh - xa) + margin.SLOPE["nfl"] * (_lg(pub0) - _lg(0.55))
    assert h.loc[0, "home_spread"] == round(-m, 1)
    assert abs(h.loc[0, "home_spread"] - g.loc[0, "home_spread"]) < 3      # no blow-up


def test_carry_without_p_logit_only_fixes_a_disagreement():
    f = pd.DataFrame({"home_prob": [0.56, 0.56], "home_spread": [-2.0, 1.5], "total_pred": [6.0, 6.0],
                      "home_total_pred": [4.0, 2.25], "away_total_pred": [2.0, 3.75]})
    g = carry_margin(f, "nhl")
    assert g.loc[0, "home_spread"] == -2.0                       # agrees: untouched
    assert g.loc[1, "home_spread"] == round(-margin.SLOPE["nhl"] * _lg(0.56), 1)   # implied margin
    assert not disagree(g.loc[1, "home_prob"], -g.loc[1, "home_spread"])


def test_model_win_chance_and_margin_always_agree():
    rng = np.random.default_rng(7)
    for lg in margin.SLOPE:
        n = 4000
        pl = rng.uniform(0.15, 0.85, n)
        pe = rng.uniform(0.15, 0.85, n)
        w = rng.choice([0.0, 0.1033, 0.2415, 0.5, 0.8315], n)
        p = np.round((1 - w) * pl + w * pe, 4)
        # margin fits that only loosely follow the logit (and sometimes disagree)
        m = margin.SLOPE[lg] * np.log(pl / (1 - pl)) * rng.uniform(-0.5, 2.5, n) + rng.normal(0, 1, n)
        f = pd.DataFrame({"home_prob": p, "p_logit": pl, "p_elo": pe, "elo_weight": w,
                          "home_spread": np.round(-m, 1),
                          "total_pred": 200.0, "home_total_pred": 100.0, "away_total_pred": 100.0})
        g = carry_margin(f, lg)
        bad = [i for i in range(n) if disagree(g.home_prob[i], -g.home_spread[i])]
        assert not bad, (lg, g.loc[bad[:3]].to_dict("records"))
        assert np.allclose(g.home_total_pred + g.away_total_pred, 200.0, atol=0.11)


def test_refresh_reaches_early_forecasts_not_locked_ones():
    c = tpa._db()
    tpa._nba_history(c)
    tomorrow = "2026-10-21"
    s = pd.concat([tpa._sched(c, "nba", 5000, 1, 2),
                   tpa._sched(c, "nba", 5003, 1, 2, day=tomorrow),
                   tpa._sched(c, "nba", 5004, 1, 2, day=tomorrow)], ignore_index=True)
    f = tpa._base(n=3)
    f = pa.adjust_forecast(c, "nba", s, f, tpa.AS_OF)
    f["p_logit"], f["p_elo"], f["elo_weight"] = f["home_prob"], 0.6, 0.5
    f["model_version"] = "t"
    f = carry_margin(pa.restack(f, "nba"), "nba")
    res = {"forecast": f, "ratings": pd.Series({"1": 0.0, "2": 0.0}), "home_adv": 0.0,
           "rating_season": 2026, "fit": None}
    import bayesratings.publish as pub
    orig = pub.rating_uncertainty
    pub.rating_uncertainty = lambda r: pd.DataFrame({"rating_sd": 0.1, "rating_q05": 0.0, "rating_q95": 0.0},
                                                     index=r["ratings"].index)
    try:
        pub.save_snapshot(c, tpa.TODAY, "nba", res, s, upcoming=True)
    finally:
        pub.rating_uncertainty = orig
    q = "SELECT rowid, home_prob, home_spread, home_player_src FROM upcoming_forecasts WHERE espn_event_id = ?"
    early0, locked0 = c.execute(q, (5003,)).fetchone(), c.execute(q, (5004,)).fetchone()
    assert early0[3] is None                                   # no report in the morning
    c.execute("INSERT INTO forecast_locks (espn_event_id, league, locked_at, home_prob, "
              "home_spread, total_pred) VALUES (5004,'nba','2026-10-20T15:30:00+00:00',0.5,0.0,220)")
    now = datetime(2026, 10, 20, 16, 0, tzinfo=timezone.utc)
    assert pa.refresh(c, ("nba",), now, log=lambda *_: None) == {}
    tpa._report(c, 5003, 1, 10, "Out")                          # tomorrow's report: star out
    tpa._report(c, 5004, 1, 10, "Out")
    logs = []
    assert pa.refresh(c, ("nba",), now, log=logs.append) == {"nba": 1}
    early1, locked1 = c.execute(q, (5003,)).fetchone(), c.execute(q, (5004,)).fetchone()
    assert early1[3] == "report" and early1[1] < early0[1]
    assert early1[2] > early0[2]                               # the margin moves with it
    assert locked1 == locked0                                  # locked: never changed
    assert any("early" in x for x in logs)
    row = c.execute("SELECT home_prob, home_spread FROM upcoming_forecasts WHERE espn_event_id = 5003").fetchone()
    assert not disagree(row[0], -row[1])
    assert pa.refresh(c, ("nba",), now, log=lambda *_: None) == {}       # nothing new
