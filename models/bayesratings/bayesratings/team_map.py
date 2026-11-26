"""MAP replica of the production team model in stan/bt_logit.stan.

This is the fit used to backfill historical team chances for the NFL
quarterback ridge (`nfl_team_hist.py`). It is not the published rating.
The morning forecast still comes from the Stan posterior. Sigma is held
fixed: a free-sigma MAP collapses to zero, and the Stan model estimates
sigma and averages over draws. The objective and the gradient are the
MAP of that Stan model with sigma held fixed.
"""

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit, log_expit


def fit(hi, ai, y, m, w, rw, neu, X, T, sig, use_margin, x0, homesep=False):
    """MAP of the production likelihood.

    Ratings ~ normal(0, sigma), sigma fixed at `sig` (the bound holds
    log(sigma) there). `homesep` gives the margin its own home edge, in
    points, instead of sharing home_adv with the win/loss term. NFL leaves
    homesep off. Returns the parameter vector, warm-started from `x0`.
    """
    P = X.shape[1]

    def f(th):
        r, h = th[:T], th[T]
        ms, sm = np.exp(th[T + 1]), np.exp(th[T + 2])
        b = th[T + 3:T + 3 + P]
        ls = th[T + 3 + P]
        s = np.exp(ls)
        hm = th[T + 4 + P]
        base = r[hi] - r[ai] + (X @ b if P else 0)
        eta = base + h * (1 - neu)
        ll1 = y * log_expit(eta) + (1 - y) * log_expit(-eta)
        obj = -(w * rw * ll1).sum()
        geta = -(y - expit(eta)) * w * rw
        gbase = geta.copy()
        gh = (geta * (1 - neu)).sum()
        gms = gsm = ghm = 0.0
        if use_margin:
            mu = ms * eta if not homesep else ms * base + hm * (1 - neu)
            res = m - mu
            obj += (w * (0.5 * res ** 2 / sm ** 2 + np.log(sm))).sum()
            gmu = -w * res / sm ** 2
            if homesep:
                gbase = gbase + gmu * ms
                ghm = (gmu * (1 - neu)).sum()
                gms = (gmu * base).sum() * ms
            else:
                gbase = gbase + gmu * ms
                gh += (gmu * ms * (1 - neu)).sum()
                gms = (gmu * eta).sum() * ms
            gsm = (w * (-res ** 2 / sm ** 2 + 1)).sum()
        # sigma ~ half-normal(0, 1), held fixed by the bound below
        obj += 0.5 * (r ** 2).sum() / s ** 2 + T * ls + 0.5 * s ** 2
        obj += 0.5 * h ** 2 / 0.25 + 0.5 * (b ** 2).sum() / 0.25 + 0.5 * hm ** 2 / 100.0
        gr = np.bincount(hi, gbase, T) - np.bincount(ai, gbase, T) + r / s ** 2
        gls = -(r ** 2).sum() / s ** 2 + T + s ** 2
        gh += h / 0.25
        gb = (X.T @ gbase if P else np.zeros(0)) + b / 0.25
        ghm += hm / 100.0
        return obj, np.r_[gr, gh, gms, gsm, gb, gls, ghm]

    bounds = [(None, None)] * len(x0)
    bounds[T + 3 + P] = (np.log(sig), np.log(sig))
    if not homesep:
        bounds[T + 4 + P] = (0.0, 0.0)
    res = minimize(f, x0, jac=True, method="L-BFGS-B", bounds=bounds,
                   options={"maxiter": 1000})
    return res.x
