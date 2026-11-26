# bayesratings-models

The models and the data pipeline behind bayesRatings.com.
They turn ESPN games into team ratings and game forecasts for MLB, NBA, NFL,
and NHL. The published win chance, margin, and total are the model's own
numbers.

The code is open-sourced under the GNU Affero General Public License v3.0.
See `LICENSE`. The license covers this code. Each data source has its own
terms, and those apply to whoever runs the fetchers.

## What is included

Every league gets ESPN scoreboards and box scores, a Stan team rating, a
dynamic Elo stack, a player adjustment, and a forecast (win chance, margin,
total, and American odds from that chance).

| League | Extra data | Published win chance |
| --- | --- | --- |
| NBA | Official injury-report PDF and probable lineups | Player ridge when a fit and the boxes are available, otherwise the team path |
| NHL | Daily Faceoff lines and starting goalies | Player ridge when a fit, skater boxes, and a starter are available, otherwise the team path |
| NFL | nflverse schedule, injury report, and play-by-play | Quarterback ridge when both teams have a confirmed starter and the play-by-play state is loaded, otherwise the team path |
| MLB | MLB Stats API rosters, lineups, and boxes, plus Statcast batted balls | Player stack when both lineups and both starters are known and the fit passes its checks, otherwise the team path |

MLB and NHL also put starting-pitcher or starting-goalie quality inside the
team-rating fit. Spreads and totals stay on the team path. The margin is
moved so it names the same favorite as the published chance.

## Requirements

- Python 3.12
- git, a C++ compiler, and make (CmdStan compiles the Stan models)
- About 1 GB of free disk for CmdStan, more once you store several seasons

Python packages are pinned in `requirements.txt` (cmdstanpy, numpy, pandas,
scikit-learn, scipy, pdfplumber, pyarrow). No API keys.

## Install

```bash
git clone https://github.com/WalrusQuant/bayesratings-models.git
cd bayesratings-models
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install -e .
```

## CmdStan

CmdStan is the Stan compiler and sampler. Install it once:

```bash
.venv/bin/python -c "import cmdstanpy; cmdstanpy.install_cmdstan()"
```

The first `daily` run compiles `stan/bt_logit.stan` and
`stan/bayes_elo_dynamic.stan` into the `stan/` directory. Those binaries are
not committed. Later runs reuse them.

## Configuration

Copy the example and set a User-Agent that names you. Do not put a URL in
it. Some hosts stall a User-Agent that contains one.

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `BAYESRATINGS_USER_AGENT` | a local placeholder | Sent on outbound requests |
| `BAYESRATINGS_DB` | `data/bayesratings.db` | SQLite file. `init` creates it |
| `BAYESRATINGS_STATUS_DIR` | `data/status` | One-line status logs |
| `BAYESRATINGS_LOCK_DIR` | `data` | Directory for the writer-lock file |
| `BAYESRATINGS_LOCK` | `$BAYESRATINGS_LOCK_DIR/write.lock` | Full path of that lock file. Overrides the directory |

Existing environment variables win over `.env`. The database file is not
committed.

## Quickstart (NBA)

This pulls the current NBA season (scoreboards from mid-September through
today), builds player lines from the stored boxes, fits the models, and
prints ratings and forecasts. It is safe to stop and rerun. The first fit
compiles Stan, which takes a few minutes.

```bash
.venv/bin/bayesratings init
.venv/bin/bayesratings backfill --leagues nba --seasons 0
.venv/bin/bayesratings extract --leagues nba
.venv/bin/bayesratings daily --leagues nba
.venv/bin/bayesratings show --leagues nba
```

`--seasons 0` is the current season only. `--seasons 3` adds the three
completed seasons before it. A team with fewer than five completed games is
left out as an exhibition squad, so a couple of days is not enough to fit.

`show` prints team ratings and the next games with home win chance, margin,
and total. The same rows are in `rating_snapshots`, `forecast_snapshots`,
and `upcoming_forecasts`.

## Other leagues

Use the same five commands with `--leagues nhl`, `--leagues nfl`, or
`--leagues mlb`. A comma-separated list runs more than one
(`--leagues nba,nhl`). Before the first daily run, two leagues need a
one-time history load.

NFL, after `init` and a scoreboard backfill:

```bash
.venv/bin/python -m bayesratings.sources.nfl_pbp --db data/bayesratings.db --from-season 2006
.venv/bin/python -m bayesratings.nfl_team_hist --db data/bayesratings.db
```

The first command reads nflverse play-by-play and the schedule. The second
writes walk-forward team chances for games before 2025-09-04. Then
`bayesratings daily --leagues nfl`.

MLB, after `init` and a scoreboard backfill. Boxes and batted balls can be
pulled one season at a time into a file you own, then loaded:

```bash
.venv/bin/python scripts/backfill_mlb_extra.py --out mlb_extra_2024.db --from-season 2024 --to-season 2024
.venv/bin/python scripts/load_mlb_extra.py --db data/bayesratings.db --from mlb_extra_2024.db
.venv/bin/python -m bayesratings.mlb_team_hist --db data/bayesratings.db --season 2024
```

Repeat the history command once per season from 2022. Then
`bayesratings daily --leagues mlb`. MLB is skipped when no game is within
four days.

NHL uses the same commands as NBA. Daily Faceoff lines and goalies are
optional. The `nhl-slate` lines in `scripts/cron.example` fetch them. Without
that feed the NHL forecast stays on the team path or on the no-lineup ridge.

Injury-report history for the NBA and NFL training rows, and NHL shot
locations, follow the same pattern: `scripts/backfill_injuries.py` and
`scripts/backfill_nhl_shots.py` write a file you own, and the matching
`scripts/load_*.py` loads it. None of those files are committed.

## Keeping data current

`update` refreshes the schedule and runs one pass of the league's pre-game
feeds. `daily` pulls the ESPN window, fits, and saves ratings and forecasts.
`check` reports whether those feeds are fresh. It exits 1 when a feed it
expects is missing. The quickstart database will fail the injury-history
and pre-game checks until those passes have something to find.

```bash
.venv/bin/bayesratings update --leagues nba
.venv/bin/bayesratings daily --leagues nba,nhl,nfl,mlb
.venv/bin/bayesratings check
```

`scripts/cron.example` is a user crontab. Times are UTC, paired so each pass
lands on the same America/Chicago hour in both CDT and CST. Replace `REPO`
with this checkout. A league with no games nearby is skipped. The daily
script runs only at 04:xx Chicago unless `FORCE=1`.

The wrappers use `flock`. On macOS, install it (`brew install flock`) or run
the python modules directly. Each cron line creates `data/status` before it
opens the log.

```cron
# Daily fit, 04:30 America/Chicago
30 9,10 * * * mkdir -p REPO/data/status && REPO/scripts/run_daily.sh >> REPO/data/status/daily-cron.log 2>&1
```

## Project layout

```
bayesratings/     the package: CLI, ESPN client, SQLite, Stan fits, player models
bayesratings/sources/   rosters, injuries, lineups, nflverse, MLB boxes, NHL shots
stan/             bt_logit.stan and bayes_elo_dynamic.stan
scripts/          cron wrapper shells, one-time history loaders, cron.example
docs/             model, pipeline, tables, ESPN notes
tests/            pytest
```

The command-line entry is `bayesratings` (`bayesratings/cli.py`):

| Command | What it does |
| --- | --- |
| `init` | Create the database, apply `schema.sql`, load venue coordinates |
| `backfill` | ESPN scoreboards and box scores. `--dates` takes comma-separated `YYYY-MM-DD` |
| `extract` | Player lines and team counts from stored boxes. No network |
| `update` | Schedule refresh and one pre-game pass |
| `daily` | Fit and save ratings and forecasts. `--skip-update` fits what is already stored |
| `check` | Are the feeds fresh? |
| `show` | Print ratings and the next forecasts |

`python -m bayesratings.daily` and the other modules take the same flags
the commands wrap.

## How the models work

One games table goes in. A time-decayed Bayesian Bradley-Terry model
(`stan/bt_logit.stan`) returns zero-centered team ratings and a posterior
win chance. Hybrid regressions on that same window produce the margin and
the total. Player models can replace the win chance. A dynamic Elo model
(`stan/bayes_elo_dynamic.stan`) is mixed in for the team path. American
odds are converted from the rounded win chance.

The short version is [docs/model-overview.md](docs/model-overview.md). The
full path, including each league's player model, is
[docs/model.md](docs/model.md). Commands and the cron schedule are
[docs/data-pipeline.md](docs/data-pipeline.md). Tables are
[docs/database.md](docs/database.md).

```python
import pandas as pd
from bayesratings import run_model

games = pd.read_csv("data/fixtures/verify_games.csv")  # NaN scores = forecast
res = run_model(games)
res["ratings"]    # posterior means, by team
res["forecast"]   # win chance, margin, totals, American odds
```

That call needs CmdStan. The fixture is a small synthetic season from
`scripts/make_verify_fixture.py`.

## Data sources

The fetchers identify themselves with `BAYESRATINGS_USER_AGENT`, wait
between requests, and follow `robots.txt` where a source publishes one.
Read each source's terms before you run a backfill. This repository does
not grant rights to the data.

| Source | Used for | Where |
| --- | --- | --- |
| ESPN site API (`site.api.espn.com`) | Games, scores, boxes, rosters, probables, ESPN's betting block | `bayesratings/espn.py` |
| MLB Stats API (`statsapi.mlb.com`) | 40-man rosters, transactions, probable pitchers, lineups, extra box counts | `bayesratings/sources/mlb.py`, `mlb_box.py` |
| Baseball Savant | Batted balls (public search CSV) | `bayesratings/sources/mlb_statcast.py` |
| Daily Faceoff | NHL starting goalies and line combinations | `bayesratings/sources/dfo.py` |
| NBA official injury-report PDF | NBA player model | `bayesratings/sources/nbainj.py` |
| nflverse GitHub releases | Schedule, injuries, weekly rosters, play-by-play (Parquet). The schedule file has spread, total, and moneyline columns. This package does not store them. A contributor can add them | `bayesratings/sources/nflverse.py`, `nfl_pbp.py` |
| NHL play-by-play API (`api-web.nhle.com`) | Shot locations. No model reads them yet | `bayesratings/sources/nhl_pbp.py` |

ESPN's field notes are in [docs/espn-reference/](docs/espn-reference/README.md),
[docs/espn-mlb-schema-notes.md](docs/espn-mlb-schema-notes.md), and
[docs/espn-nfl-nba-nhl-notes.md](docs/espn-nfl-nba-nhl-notes.md).

## Tests

```bash
.venv/bin/pip install pytest
.venv/bin/python -m pytest
```

`tests/test_no_odds.py` fails if a prediction-market exchange name, a server
path, an unexpected host, a non-loopback address, or a key shows up in the
tree. Odds from ESPN and nflverse are allowed. CmdStan is required for the
rating-fit tests.

## License

Copyright is in `LICENSE`. You can run, study, change, and share this
program under the AGPL-3.0. If you run a modified version as a network
service, the AGPL requires you to offer the corresponding source to the
users of that service. Data you download stays under the terms of the
source that published it.

Contributing notes are in `CONTRIBUTING.md`.
