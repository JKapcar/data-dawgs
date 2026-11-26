#!/usr/bin/env python3
"""Generate a fixed synthetic season for cross-language model verification.

Writes data/fixtures/verify_games.csv — a deterministic double round-robin of
completed games (real latent strengths + home edge, Poisson scores, no ties)
plus a handful of unplayed games to exercise the forecast path. `run_model`
loads this CSV.

The CSV is the fixture; regenerating it is only needed if you want a different
scenario. Deterministic given the seed.
"""

import pathlib

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "fixtures" / "verify_games.csv"

SEED = 20260719
N_TEAMS = 20
SEASON = 2025
BASE_RUNS = 4.5      # league-average runs per team per game
STRENGTH_SCALE = 0.18
HOME_EDGE = 0.12     # log-scale home scoring bump


def main():
    rng = np.random.default_rng(SEED)
    teams = [f"T{i:02d}" for i in range(1, N_TEAMS + 1)]
    strength = dict(zip(teams, rng.normal(0, 1, N_TEAMS)))

    def score(off_team, def_team, is_home):
        edge = HOME_EDGE if is_home else 0.0
        lam = BASE_RUNS * np.exp(
            STRENGTH_SCALE * (strength[off_team] - strength[def_team]) + edge
        )
        return int(rng.poisson(lam))

    rows = []
    day = pd.Timestamp("2025-04-01")
    # double round-robin: every ordered pair plays once as home
    for i, home in enumerate(teams):
        for j, away in enumerate(teams):
            if home == away:
                continue
            hs = score(home, away, is_home=True)
            as_ = score(away, home, is_home=False)
            if hs == as_:  # break ties deterministically (MLB has none)
                if strength[home] >= strength[away]:
                    hs += 1
                else:
                    as_ += 1
            rows.append((SEASON, day.date().isoformat(), home, away, hs, as_))
            day += pd.Timedelta(days=1) if len(rows) % 8 == 0 else pd.Timedelta(0)

    completed = pd.DataFrame(
        rows,
        columns=["season", "date", "home_team", "away_team", "home_score", "away_score"],
    )

    # unplayed slate: 15 future matchups between known teams, scores blank
    sched_rng = np.random.default_rng(SEED + 1)
    sched = []
    sched_day = "2025-09-30"
    for _ in range(15):
        h, a = sched_rng.choice(teams, size=2, replace=False)
        sched.append((SEASON, sched_day, h, a, "", ""))
    schedule = pd.DataFrame(sched, columns=completed.columns)

    games = pd.concat([completed, schedule], ignore_index=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    games.to_csv(OUT, index=False)
    print(f"wrote {OUT.relative_to(ROOT)}: {len(completed)} completed "
          f"+ {len(schedule)} unplayed games, {N_TEAMS} teams")


if __name__ == "__main__":
    main()
