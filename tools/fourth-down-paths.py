#!/usr/bin/env python3
"""Measure how win probability moves through a game, and fit the Goal Lens path model.

The nfl4th port prices one play: it says what win probability (WP) is after each
outcome. Objectives such as "time spent above 50%" also need to know how WP travels
from there to the final gun. This tool measures that from nflverse play-by-play and
fits the smallest model that reproduces it: a diffusion in probit space run on a
measured "information clock" V(t), the share of the game's remaining uncertainty
still unresolved with t seconds left.

    WP at clock b, given WP p at clock a (a > b):
        Phi( probit(p) * sqrt(V(a)/V(b)) + sqrt(V(a)/V(b) - 1) * N(0,1) )

That is a martingale by construction, so it cannot move expected WP. V is fitted on
2016-2022 and every published error is measured on 2023-2025, which the fit never saw.

Research tool, not part of CI or any schedule. Needs numpy, pandas and scipy.

    python tools/fourth-down-paths.py                  # downloads ten seasons (~185 MB)
    python tools/fourth-down-paths.py --pbp-dir /path  # reuse {season}.csv.gz files

Rebuild only to extend the sample, and bump every date that quotes the result.
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import tempfile
import urllib.request

import numpy as np
import pandas as pd
from scipy.integrate import quad
from scipy.optimize import minimize, minimize_scalar
from scipy.special import ndtr, ndtri

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'data/fourth-down-paths.json'
URL = 'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.csv.gz'
FIT_SEASONS = (2016, 2022)
TEST_SEASONS = (2023, 2025)
THRESHOLDS = np.array([.05, .1, .2, .3, .4, .5, .6, .7, .8, .9, .95])
ZX = ndtri(THRESHOLDS)
KNOTS = np.array([0, 15, 30, 60, 120, 300, 600, 900, 1800, 2700, 3600.])
HORIZONS = (300, 900)
ABSTAIN_BELOW = 30  # seconds; see the per-clock errors this tool prints
TIME_EDGES = [30, 60, 120, 300, 600, 900, 1350, 1800, 2250, 2700, 3150]
REPORT_EDGES = [0, 30, 120, 300, 900, 1800, 2700, 3600]
GX, GW = np.polynomial.legendre.leggauss(40)
RQ, WQ = (GX + 1) / 2, GW / 2


def game_paths(path, season):
    """One row per play and per side: clock, WP, and what the rest of the path did."""
    cols = ['game_id', 'play_id', 'qtr', 'down', 'posteam', 'home_team', 'game_seconds_remaining', 'vegas_home_wp']
    d = pd.read_csv(path, usecols=cols, low_memory=False)
    d = d[(d.qtr <= 4) & d.vegas_home_wp.notna() & d.game_seconds_remaining.notna()]
    out, games = [], 0
    for _, g in d.groupby('game_id', sort=False):
        g = g.sort_values(['game_seconds_remaining', 'play_id'], ascending=[False, True])
        t = g.game_seconds_remaining.to_numpy(float)
        w = g.vegas_home_wp.to_numpy(float)
        if len(t) < 50 or t[0] < 3500:
            continue  # partial feed
        games += 1
        # WP is a step function: each play's value holds until the next play's clock.
        dur = np.clip(np.append(t[:-1] - t[1:], t[-1]), 0, None)
        keep = t > 0
        fourth = (g.down.to_numpy() == 4)[keep]
        home_ball = (g.posteam.to_numpy() == g.home_team.to_numpy())[keep]
        for side, has_ball in ((w, home_ball), (1 - w, ~home_ball)):
            above = (side[:, None] > THRESHOLDS[None, :]) * dur[:, None]
            rest = above[::-1].cumsum(0)[::-1]            # seconds above x from this play to 0:00
            rest_wp = (side * dur)[::-1].cumsum()[::-1]   # integral of WP over the same span
            block = [np.full(keep.sum(), season), t[keep], side[keep], rest_wp[keep] / t[keep], fourth, has_ball,
                     rest[keep] / t[keep][:, None]]
            for h in HORIZONS:
                # Seconds above x between this play's clock and h seconds later.
                end = t - h
                j = np.clip(np.searchsorted(-t, -end, side='left') - 1, 0, len(t) - 1)  # play in force at `end`
                nxt = np.append(rest[1:], np.zeros((1, len(THRESHOLDS))), 0)
                t_next = np.append(t[1:], 0)
                at_end = nxt[j] + (end - t_next[j])[:, None] * (side[j][:, None] > THRESHOLDS[None, :])
                share = np.where((end >= 0)[:, None], (rest - at_end) / h, np.nan)
                block.append(share[keep])
            out.append(np.column_stack(block))
    return np.vstack(out), games


def information(theta):
    v = np.concatenate([[0], np.cumsum(np.exp(theta))])
    return v / v[-1]


def occupancy(p, t, v, horizon=None, power=None):
    """Expected share of the next `horizon` seconds with WP above each threshold."""
    span = t if horizon is None else np.full_like(t, horizon)
    tau = (t - span)[:, None] + span[:, None] * RQ[None, :]
    if power is None:
        ratio = np.interp(tau, KNOTS, v) / np.interp(t, KNOTS, v)[:, None]
    else:
        ratio = (tau / t[:, None]) ** power
    ratio = np.clip(ratio, 0, 1 - 1e-9)[:, :, None]
    z = ndtri(p)[:, None, None]
    return (ndtr((z - ZX[None, None, :] * np.sqrt(ratio)) / np.sqrt(1 - ratio)) * WQ[None, :, None]).sum(1)


def occupancy_exact(p, x, t, horizon, v):
    """Scalar reference value, integrated segment by segment for the JS parity test."""
    z, zx, vt = ndtri(p), ndtri(x), np.interp(t, KNOTS, v)

    def f(tau):
        r = min(np.interp(tau, KNOTS, v) / vt, 1 - 1e-12)
        return ndtr((z - zx * np.sqrt(r)) / np.sqrt(1 - r))
    lo = t - horizon
    pts = [k for k in KNOTS if lo < k < t]
    return quad(f, lo, t, points=pts or None, limit=400, epsabs=1e-10)[0] / horizon


class Cells:
    """Observed means by clock x WP cell, with a capped sample of each cell's plays."""

    def __init__(self, a, mask, rng, cap, first=6, edges=TIME_EDGES, pbins=20, need=None):
        t, p = a[:, 1], np.clip(a[:, 2], 1e-4, 1 - 1e-4)
        tb = np.digitize(t, edges)
        pb = np.minimum((p * pbins).astype(int), pbins - 1)
        self.rows = []
        for ti in range(len(edges) + 1):
            for b in range(pbins):
                idx = np.flatnonzero(mask & (tb == ti) & (pb == b) & (True if need is None else t >= need))
                if len(idx) < 150:
                    continue
                s = rng.choice(idx, min(cap, len(idx)), replace=False)
                obs = a[idx, first:first + len(THRESHOLDS)]
                self.rows.append((ti, b, len(idx), p[s], t[s], np.nanmean(obs, 0)))
        self.n = np.array([r[2] for r in self.rows], float)
        self.obs = np.array([r[5] for r in self.rows])
        self.p = np.concatenate([r[3] for r in self.rows])
        self.t = np.concatenate([r[4] for r in self.rows])
        self.cut = np.cumsum([0] + [len(r[3]) for r in self.rows])

    def predict(self, v, horizon=None, power=None):
        o = occupancy(self.p, self.t, v, horizon, power)
        return np.array([o[self.cut[i]:self.cut[i + 1]].mean(0) for i in range(len(self.rows))])

    def rmse(self, v, horizon=None, power=None, where=None):
        err = self.predict(v, horizon, power) - self.obs
        w = self.n if where is None else self.n * where
        return float(np.sqrt((w[:, None] * err ** 2).sum() / (w.sum() * len(THRESHOLDS))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pbp-dir')
    args = ap.parse_args()
    seasons = range(FIT_SEASONS[0], TEST_SEASONS[1] + 1)
    parts, sources, games = [], [], {}
    with tempfile.TemporaryDirectory() as tmp:
        for season in seasons:
            path = Path(args.pbp_dir or tmp) / f'{season}.csv.gz'
            if not path.exists():
                urllib.request.urlretrieve(URL.format(season=season), path)
            sources.append({'season': season, 'url': URL.format(season=season),
                            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
            a, games[season] = game_paths(path, season)
            parts.append(a)
    a = np.vstack(parts)
    season, fourth, has_ball = a[:, 0], a[:, 4] > 0, a[:, 5] > 0
    train = season <= FIT_SEASONS[1]
    test = season >= TEST_SEASONS[0]
    rng = np.random.default_rng(216)
    fit = Cells(a, train, rng, 150)
    held = Cells(a, test, rng, 300)
    fourths = Cells(a, test & fourth & has_ball & (a[:, 1] >= ABSTAIN_BELOW), rng, 300, edges=REPORT_EDGES[1:-1], pbins=10)

    def loss(theta):
        return fit.rmse(information(theta)) ** 2
    start = np.log(np.diff((KNOTS / 3600) ** .65))
    v = information(minimize(loss, start, method='L-BFGS-B', options={'maxiter': 300}).x)
    power = minimize_scalar(lambda k: fit.rmse(v, power=k), bounds=(.3, 1.5), method='bounded').x

    # Martingale check on every play: does the realised time-average of WP equal WP now?
    p_all = a[:, 2]
    martingale = []
    for b in range(10):
        m = (p_all >= b / 10) & (p_all < (b + 1) / 10 if b < 9 else p_all <= 1)
        martingale.append({'wp_from': b / 10, 'wp_to': (b + 1) / 10, 'n': int(m.sum()),
                           'mean_wp_now': round(float(p_all[m].mean()), 4),
                           'mean_realized_average_wp': round(float(a[m, 3].mean()), 4)})

    by_time = []
    coarse = Cells(a, test, rng, 300, edges=REPORT_EDGES[1:-1], pbins=10)
    pred = coarse.predict(v)
    calibration = []
    for i, (ti, b, n, *_rest) in enumerate(coarse.rows):
        calibration.append({'seconds_from': REPORT_EDGES[ti], 'seconds_to': REPORT_EDGES[ti + 1],
                            'wp_from': b / 10, 'wp_to': (b + 1) / 10, 'n': int(n),
                            'observed': [round(float(x), 4) for x in coarse.obs[i]],
                            'modelled': [round(float(x), 4) for x in pred[i]]})
    for ti in range(len(REPORT_EDGES) - 1):
        where = np.array([r[0] == ti for r in coarse.rows], float)
        if where.sum():
            by_time.append({'seconds_from': REPORT_EDGES[ti], 'seconds_to': REPORT_EDGES[ti + 1],
                            'n': int((coarse.n * where).sum()), 'rmse': round(coarse.rmse(v, where=where), 4)})
    usable = np.array([r[0] > 0 for r in coarse.rows], float)
    err = np.abs(pred - coarse.obs)[usable > 0]

    horizon_test = []
    for k, h in enumerate(HORIZONS):
        first = 6 + len(THRESHOLDS) * (k + 1)
        c = Cells(a, test, rng, 300, first=first, need=max(h, ABSTAIN_BELOW))
        horizon_test.append({'horizon_seconds': h, 'n': int(c.n.sum()), 'rmse': round(c.rmse(v, horizon=h), 4)})

    reference = [{'p': p, 'x': x, 'seconds': t, 'horizon': h, 'share': round(float(occupancy_exact(p, x, t, h, v)), 6)}
                 for p, x, t, h in [(.5, .5, 3600, 3600), (.62, .5, 1800, 1800), (.3, .2, 900, 900), (.9, .8, 420, 420),
                                    (.45, .5, 2400, 600), (.7, .5, 65, 65), (.15, .2, 3000, 1200), (.94, .5, 59, 59)]]
    today = dt.datetime.now(dt.timezone.utc)

    def count(lo, hi, mask=None):
        m = (season >= lo) & (season <= hi) if mask is None else mask
        return {'seasons': [lo, hi], 'games': sum(games[s] for s in range(lo, hi + 1)), 'play_sides': int(m.sum())}
    env = {
        'as_of': today.date().isoformat(),
        'source': 'nflverse play-by-play 2016-2025 (nflfastR vegas_home_wp), regular season and playoffs, regulation only',
        'note': ('Fitted path model for the Fourth Down Lab Goal Lens. Fitted on 2016-2022; every error below is measured on '
                 '2023-2025. Modelled, not observed, when applied to a new play. The WP series is nflfastR spread-adjusted '
                 'home WP, not the nfl4th blend the calculator prices outcomes with. Not prospectively graded.'),
        'built': today.isoformat(),
        'canonical_url': 'https://datadawgs216.com/data/fourth-down-paths.json',
        'tier': 'labs', 'graded': False,
        'tier_meaning': 'Pup — live and useful, not yet validated. It may compute real answers and still have open questions about calibration, assumptions, data quality or edge. Everything starts here.',
        'data': {
            'model': 'probit diffusion on a measured information clock',
            'knots_seconds': [int(k) for k in KNOTS],
            'information_remaining': [round(float(x), 5) for x in v],
            'abstain_below_seconds': ABSTAIN_BELOW,
            'thresholds': [float(x) for x in THRESHOLDS],
            'fit': {**count(*FIT_SEASONS, train), 'rmse': round(fit.rmse(v), 4)},
            'test': {**count(*TEST_SEASONS, test), 'rmse': round(held.rmse(v), 4),
                     'rmse_outside_abstain_window': round(coarse.rmse(v, where=usable), 4),
                     'abs_error_percentiles_outside_abstain_window': {str(q): round(float(np.percentile(err, q)), 4) for q in (50, 90, 99, 100)},
                     'by_clock': by_time,
                     'fourth_downs_offense_view_outside_abstain_window': {'plays': int(fourths.n.sum()), 'rmse': round(fourths.rmse(v), 4)},
                     'horizons': horizon_test},
            'alternatives_on_test': {
                'plain_brownian_rmse': round(held.rmse(v, power=1.0), 4),
                'single_power_clock': {'power_fitted_2016_2022': round(float(power), 4), 'rmse': round(held.rmse(v, power=power), 4)}},
            'martingale_check': martingale,
            'calibration_test_seasons': calibration,
            'reference_values': reference,
            'sources': sources,
        },
    }
    OUTPUT.write_text(json.dumps(env, separators=(',', ':')) + '\n')
    print(json.dumps({k: env['data'][k] for k in ('knots_seconds', 'information_remaining', 'fit', 'alternatives_on_test')}, indent=1))
    print(json.dumps(env['data']['test'], indent=1))


if __name__ == '__main__':
    main()
