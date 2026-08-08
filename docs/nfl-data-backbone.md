# NFL data backbone

This pipeline turns a typed `nfelodcm` games-table load into the small canonical schedule used by Data Dawgs models. It publishes schedule facts only. The loader's market columns are intentionally excluded because they do not identify the book and observation timestamp required by the Data Dawgs market contract.

## Provenance and runtime

- Loader: `nfelodcm==0.2.21`, MIT package metadata.
- Source table: `nflverse/nfldata` `data/games.csv`; the output records the exact source commit.
- Source data: public `nflverse/nfldata` schedule output. That repository's data license was not independently verified, so the public envelope says so instead of inheriting the loader package's MIT license.
- Python: 3.12 locally and in GitHub Actions.
- Public output: `/data/nfl-schedule.json`.
- Receipt ledger: `/data/model-receipts.json`.

The refresh fails if required source columns disappear, the source commit is over 30 days old, the season has a suspicious total row count, the regular season is not exactly 272 games over Weeks 1–18, team coverage is not the current 32-team set, game IDs collide, kickoff times are invalid, or a score is only partially populated.

## Reproducibility

Each output carries `integrity.snapshot_id`, a SHA-256 of canonical JSON for the ordered game rows. A forecast receipt must reference that exact identifier. Changed snapshots remain recoverable through Git history; the automated workflow commits only when canonical rows or their exact upstream source commit changes.

Run locally after installing the pinned loader:

```powershell
python -m pip install --requirement requirements-data.txt
python scripts/nfl_data_backbone.py refresh --season 2026
node tools/data-manifest.js
python -m unittest tests.test_nfl_data_backbone
python scripts/nfl_data_backbone.py validate
node tools/validate-data.js
```

## Immutable receipts

`append-receipts` accepts an array, or an envelope containing `data[]`. It validates every normalized forecast, requires a known game and the current snapshot ID, treats an identical repeated `forecast_id` as idempotent, and rejects a conflicting duplicate. `verify-history` compares the ledger with a Git base ref and rejects row removal, reordering, or mutation.

Results do not belong in forecast rows. A later grading slice will publish outcomes and grades separately and join them by `forecast_id`.

## Automation safety

The daily workflow runs at 10:17 UTC to avoid the busiest top-of-hour schedule window. It never pushes to `main`: if canonical data changes, it force-with-lease updates `automation/nfl-data-refresh` and opens a review PR. Production remains a human merge because this repository is the deployed GitHub Pages source.
