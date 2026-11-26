# Data pipeline

What each command pulls, what it writes, and how to run it. Times are
America/Chicago. Run commands from the checkout. The database path, status
directory and User-Agent come from the environment or `.env` (see
`.env.example`).

## Commands

| Command | What it does |
| --- | --- |
| `bayesratings init` | Create the SQLite file, apply `schema.sql`, load venue coordinates |
| `bayesratings backfill --leagues nba --seasons 0` | Current season's scoreboards and box scores. `--seasons 3` adds the three completed seasons before it. Safe to stop and rerun |
| `bayesratings extract --leagues nba` | Player lines and team counts from stored boxes. No network |
| `bayesratings update --leagues nba` | Schedule refresh, rosters, and the league's update passes, once |
| `bayesratings daily --leagues nba` | Fit team and player models, save ratings and forecasts |
| `bayesratings check` | Are the feeds fresh? |
| `bayesratings show --leagues nba` | Print ratings and the next forecasts |

`python -m bayesratings.daily` and the other modules take the same flags
the commands wrap. `--skip-update` fits whatever is already in the database.

## Schedule

`scripts/cron.example` is a user crontab. A league with no games nearby is
skipped. The daily script runs only at 04:xx Chicago unless `FORCE=1`.

| When (Chicago) | Script | What |
| --- | --- | --- |
| 04:30 | `run_daily.sh` | ESPN window, extracts, fit, snapshots |
| hourly | `run_refresh.sh` | Schedule refresh. Skips the 04:xx hour |
| every 10 min | `run_refresh.sh --live` | Mark in-progress games final, freeze forecasts about to start |
| 06:40 | `run_prelog.sh morning` | Rosters, NFL depth, transactions |
| every 10 min | `run_prelog.sh pregame` | Lineups and injuries in the hour before a start |
| 07:10 | `run_prelog.sh sources` | MLB roster and transactions, nflverse |
| NHL game days | `goalies`, `nhl-lines`, `nhl-slate` | Daily Faceoff goalies and lines. Optional |
| MLB game days | `mlb-probables` | Probable pitchers, then an unlocked forecast if one changed |
| NBA game days | `nbainj` | Official injury-report PDF and probable starters |
| 04:00 | `nfl-pbp` | nflverse play-by-play. Refits the quarterback model when new games landed |
| 07:05 | `mlb-extra` | MLB boxes and batted balls for the last 3 days |
| 07:20 | `nhl-pbp` | NHL shots for the last 3 days. No model reads them yet |
| 07:25 | `inj-hist` | Recent injury-report history for the Monday refit |
| 07:30 | `check` | One health line |

## One-time history

| League | Before the first daily run |
| --- | --- |
| NBA | Backfill, extract, update. The player model fits itself on the first daily run |
| NHL | Same. Add the `nhl-slate` lines if you want dressed lines and a confirmed goalie |
| NFL | `python -m bayesratings.sources.nfl_pbp --from-season 2006`, then `python -m bayesratings.nfl_team_hist`, then daily |
| MLB | `scripts/backfill_mlb_extra.py` and `scripts/load_mlb_extra.py`, then `python -m bayesratings.mlb_team_hist --season YYYY` once per season from 2022, then daily |

Injury history for the NBA and NFL training rows:
`scripts/backfill_injuries.py` writes a file you own, and
`scripts/load_injuries.py` loads it. NHL shots are the same pattern with
`scripts/backfill_nhl_shots.py` and `scripts/load_nhl_shots.py`.

## What is stored

ESPN owns games and scores. Its scoreboard betting block (moneyline, spread,
total) is stored in `game_odds`. The nflverse schedule has spread, total,
and moneyline columns. This package does not store them. A contributor can
add them. Gap sources fill rosters, injuries, lineups and
probables. Raw payloads are kept in `src_raw` so a later parser can reread
them. The model reads completed games, the starter and player tables, and
writes `rating_snapshots`, `forecast_snapshots` and `upcoming_forecasts`.
Each forecast row also carries American odds (`home_odds`, `away_odds`)
from the published win chance.
`forecast_locks` freezes a forecast about ten minutes before the start so a
later pass does not rewrite it.
