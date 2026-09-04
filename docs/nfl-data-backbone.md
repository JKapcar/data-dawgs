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

The daily workflow runs at 10:17 UTC. Under Kap's **2026-09-04 approved amendment**, it first
extracts only new finals for structurally unchanged games into `automation/nfl-results`.
The results candidate has an exact five-file allowlist, is rebuilt twice from pinned
inputs and the same timestamp, passes model/data/history tests, and gets the
`NFL results / verified` commit status. The bot opens a PR and merges its exact tree with
a normal non-force push. If main advances, it regenerates and revalidates; required
repository protections remain enforced. This is the narrow automatic-production exception.

The full refresh still updates `automation/nfl-data-refresh` for review. Changed kickoffs,
new/removed games and corrections to existing finals are never automatically accepted.
A completed NFL workflow triggers receipt resolution and then the nfelo mirror; the mirror
triggers the normal prospective capture gate. Neither producer uses `on: push`.

The typed loader's rows are compared with the cited commit's raw CSV before they can be
published. A moving upstream branch cannot receive a provenance SHA it did not reproduce.
The 538 refresh retains the original schedule hashes of published legacy receipts, while
its current envelope moves to the newly accepted schedule. Future-forecast tests account
for completed games rather than assuming all 272 remain unplayed.

See `scripts/nfl_results_automation.py`, `tests/test_nfl_results_automation.py`, and the
[dated method amendment](../data/method.md).


## Survivor ownership operations

The approved 2026 public default is modelled ownership. There is no weekly manual
ownership task. `survivor.html` allows optional supplied inputs for the reader's own
board; public receipts remain tied to the declared modelled configuration. Published
receipt rows are not modified by this policy declaration.


## Verification on 2026-09-04

The approved rule has 42 combined loader, model and results-policy tests. The isolated
roundtrip test accepted a synthetic LAC final, rebuilt the current model to 256 still-future
forecasts, reproduced all 16,810 historical reference probabilities, preserved 1,088 model
receipt rows, and graded the survivor prediction once (Brier 0.046264). A repeat resolution
wrote nothing. Synthetic games were never published.

`work/test-nfl-results-roundtrip.py --inputs DIR` uses the pinned reference CSV files in
`DIR` and a temporary clone. The normal cron remains 10:17 UTC. A follow-up receipt run
recognizes an older rerun's NFL workflow definition and dispatches the current definition
before continuing to nfelo; unchanged workflow definitions follow the normal acyclic chain.
