# Model overview

Sport-agnostic ratings. One games table in, ratings and forecasts out.

- **Ratings.** Bayesian Bradley-Terry in `stan/bt_logit.stan`, driven by
  cmdstanpy. Games decay with age (180-day half-life; 90 days for NBA). The
  score margin shares the latent edge with the win/loss term. Overtime and
  shootout results count fully. NBA and NHL add a back-to-back shift. MLB
  and NHL use a tighter prior on the rating spread. MLB gives the margin its
  own home edge, in runs. MLB and NHL put starter quality on the edge, with
  the coefficient estimated in the fit. The published win chance is the mean
  of that chance over posterior draws.
- **Player models.** After that path, NBA, NHL, NFL and MLB can replace the
  published win chance. The margin follows that chance. The total stays on
  the team path. See `docs/model.md`.
- **Margin and total.** Four regressions on the same decay window (least
  squares and a binomial GLM on numpy). Called without weights, each game
  counts once.

```python
import pandas as pd
from bayesratings import run_model

games = pd.read_csv("data/fixtures/verify_games.csv")
res = run_model(games)          # NaN scores = games to forecast
res["ratings"]                  # zero-centered posterior means, by team
res["forecast"]                 # win chance, margin, totals, American odds
res["fit"]                      # CmdStanMCMC draws
```

CmdStan is installed once:

```bash
python -c "import cmdstanpy; cmdstanpy.install_cmdstan()"
```

The Stan sources sit next to the package, so install this repo with
`pip install -e .`.
