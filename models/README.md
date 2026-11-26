# models/

Third-party model code that Data Dawgs runs, kept apart from the site's own code.

## bayesratings/ — WalrusQuant/bayesratings-models

| | |
|---|---|
| Upstream | https://github.com/WalrusQuant/bayesratings-models |
| Commit | `d65026a5e8ef069e8a463156869f7418d274b559` (2026-11-26, "Add CI test workflow") |
| License | GNU AGPL-3.0-only. Full text in [`bayesratings/LICENSE`](bayesratings/LICENSE) |
| Status | **Unmodified.** Every file matches upstream byte for byte; `models/bayesratings.lock.json` pins each SHA-256 and CI fails on any drift |
| Leagues | MLB, NBA, NFL, NHL. Data Dawgs runs NFL first |

What it is: the data pipeline and models behind bayesRatings.com. ESPN scoreboards go in;
a time-decayed Bayesian Bradley-Terry fit (Stan), a dynamic Elo stack, hybrid margin and
total regressions and per-league player models come out as team ratings and game forecasts
(win chance, margin, total). See [`bayesratings/README.md`](bayesratings/README.md) and
[`bayesratings/docs/model.md`](bayesratings/docs/model.md).

All credit for the models belongs to the upstream author. Data Dawgs did not write them.

### How Data Dawgs uses it

1. `.github/workflows/bayesratings.yml` (manual run) installs the pinned upstream
   requirements and CmdStan on a GitHub runner, backfills ESPN NFL scoreboards, fits, and
   runs the upstream test suite.
2. `scripts/bayesratings_export.py` (Data Dawgs code, standard library only) reads the
   SQLite file the pipeline writes. It does not import the upstream package. It writes
   `data/bayesratings-nfl.json`: team ratings, forecasts joined to canonical
   `/data/nfl-schedule.json` game ids, and prospective receipt candidates in the
   `/data/model-contracts.json` shape (`model_id` `bayesratings-nfl`).
3. Receipt candidates are not appended to `/data/model-receipts.json` automatically. That
   ledger is append-only and needs a reviewed step.
4. The manual run can only be started once the workflow is on `main` (GitHub runs
   `workflow_dispatch` only for workflows on the default branch). Without the quarterback
   ridge input (`qb_ridge: true`, nflverse play-by-play since 2006), NFL win chances come
   from the team path.

### Other leagues

The same five commands work with `--leagues nba`, `nhl` or `mlb`. None is wired into the
site yet. Each needs, beyond ESPN scoreboards:

- **NBA:** the official injury-report PDFs and probable lineups for the player ridge;
  the team path runs without them.
- **NHL:** Daily Faceoff lines and starting goalies (`scripts/cron.example`) and, for the
  shot model, `scripts/backfill_nhl_shots.py`; the team path runs without them.
- **MLB:** MLB Stats API rosters, lineups and boxes plus Baseball Savant batted balls,
  loaded with `scripts/backfill_mlb_extra.py`, `scripts/load_mlb_extra.py` and
  `bayesratings.mlb_team_hist` before the first daily run.

Each would need its own export (canonical game ids for that sport) and a `model_id`.

### AGPL-3.0 obligations (not legal advice)

- **Keep the notices.** `LICENSE`, the README's license section and authorship stay as they
  are. Do not relicense the vendored code.
- **Source for what we run.** This repository is public and the vendored tree is the exact
  source of what runs, so the corresponding source is always available here and upstream.
- **Modifying it.** Any change to a file under `bayesratings/` makes this a modified version
  (section 5). Before committing one: add a dated entry below saying what changed and why,
  set `"modified": true` in the lock, and run `python scripts/bayesratings_export.py lock`.
  The modified files stay AGPL-3.0.
- **Network use (section 13).** Today the code runs as a batch job and only its output
  (JSON) is served, which section 13 does not reach. If a *modified* version ever runs
  behind the Worker or a page that users interact with, the site must offer those users the
  corresponding source, for example a "Source" link to this directory.
- **Data is separate.** The license covers the code, not ESPN, nflverse, MLB, NBA, NHL or
  Daily Faceoff data. Their terms apply to whoever runs the fetchers.
- **The rest of this repository has no license file.** Keeping the adapter at arm's
  length (it reads the database; it does not import the package) and serving only output
  means the AGPL does not extend to the site's own code. If Data Dawgs code ever imports
  or links the package, treat that code as AGPL too.

### Change log (local modifications to bayesratings/)

None. Vendored unmodified on 2026-11-26.
