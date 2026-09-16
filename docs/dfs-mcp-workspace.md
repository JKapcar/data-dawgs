# DFS MCP workspace suite

Status: implemented and locally tested; staged, not deployed. Source date: 2026-09-16.

The old integration could solve a transient caller-supplied slate but could not upload and save data, run the correlated simulator, or share a slate with the page. The new account-scoped boundary powers both POST `/api/dfs/{operation}` and the core MCP catalog. It uses the existing parser, solver, exploration module, correlation model and simulator rather than a second numerical implementation.

## Tool coverage

| Tools | Behavior |
|---|---|
| `dd_dfs_schema` | Fields, units, defaults, workflow and enforced limits |
| `dd_dfs_list`, `dd_dfs_get`, `dd_dfs_create`, `dd_dfs_delete` | Named account-scoped workspaces and revision checks |
| `dd_dfs_upload` | Preview or commit CSV import; matching/dropped-row diagnostics; source timestamp |
| `dd_dfs_players`, `dd_dfs_settings` | Player pool and solver/simulation/lab settings; invalidate dependent output |
| `dd_dfs_sync` | Atomic browser snapshot save |
| `dd_dfs_solve`, `dd_dfs_explore` | Shared optimizer and exploration; partial-search disclosure |
| `dd_dfs_simulate`, `dd_dfs_compare` | Correlated score worlds, modelled field, held-out metrics, contest comparisons |
| `dd_dfs_exposure`, `dd_dfs_select` | CPT/FLEX/player/team/game exposure; retain selected candidates |
| `dd_dfs_export` | DraftKings CSV with official slot IDs; no entry submission |

The legacy `dd_solve_dfs_lineup` remains available and transient. `dd_dfs_correlations` remains available in full.

## State, privacy and provenance

Each account stores workspaces below `/users/{verifiedUid}/dfsWorkspaces/{workspaceId}`. Neither API accepts a caller-supplied account ID. Shared/anonymous connector credentials cannot use these tools. Every mutation reads an ETag, checks expected_revision, and performs a conditional write. The page explicitly saves and loads; it does not silently upload a paid CSV. Loading backs up the previous local slate. Account changes invalidate browser revision tracking.

The browser duplication prior is shared for EV-adjusted parity; it is not calibrated. This change corrects percentage units below 1% and uses captain/FLEX slot ownership for Showdown. Pair multipliers remain unvalidated priors.

No paid projections are committed to GitHub or exposed through public data files. Direct Firebase rule verification remains a release gate: automatic review blocked a non-authenticated access-rule probe. Local tests prove application-layer account isolation, not deployed database rules. Do not call the integration production-private until the owner-authorized rule review is complete.

Source and as_of accompany saved inputs. Computed results record their input revision, elapsed time, settings and seed. Input edits invalidate stale results. Compute results are model-conditional and not promises of profitability.

## Current bounds and limitations

- 220 players; 150 requested solver lineups; 5,000 saved candidates; 2 MB workspace; 500 KB CSV.
- Five-second maximum optimizer/exploration search. Showdown enumeration stops at 100,000 stored legal candidates and reports incomplete search; its frontier is then partial.
- Up to 200 simulation candidates, 16,000 worlds and 10,000 sampled opponents, subject to a 32-million work-unit budget. Four-contest comparisons have a stricter combined budget. Requests exceeding limits fail explicitly.
- Proposes increasing Worker CPU ceiling from 1 to 30 seconds. It requires preview verification and production approval. There are no durable background jobs yet.
- Solver exposure caps are sequential heuristics, not guaranteed final portfolio bounds. The exposure report flags final violations. Exploration does not enforce portfolio exposure limits or minimum differences.
- Missing projections remain missing; simulations require ownership. Showdown requires captain ownership and reconciled CPT scoring. Ownership product is an uncalibrated independence proxy.
- Sampling cannot resolve exact first-place probability or top-heavy ROI; shared simulator withholds those metrics. Confidence intervals quantify Monte Carlo sampling error, not model error.
- Browser import does not support MCP-only player groups; it refuses those workspaces rather than dropping the constraints.
- This exposes DFS computational settings. Presentation-only chart filters, bankroll history, contest-lobby scraping, actual-results ingestion, and automated contest entry are not new MCP features in this change.

## Evaluation and next priorities

1. Durable compute jobs with progress, cancellation, resumable results and immutable dataset/settings hashes. Needed for large candidate pools and full Milly-size fields.
2. Exact portfolio optimization: integer min/max total/CPT/FLEX exposures, overlap and stack limits; diagnose infeasible targets; optimize on training worlds and reserve held-out worlds for evaluation.
3. Late-swap support: official game start timestamps, locked slots and a fresh availability feed; never re-optimize a locked player out of an entry.
4. Contest-results ingestion: join official entries and standings; grade projection errors, ownership calibration, duplication and realized outcomes by format and contest type.
5. Model stress tests: alternative field construction, ownership shocks and projection/correlation uncertainty. Report recommendation stability rather than only additional decimal places.
6. Immutable run receipts and pinned datasets; compare forecast versions without reusing outcomes to tune the same evaluation sample.

Classic and Showdown must remain separate evaluation populations. Preserve the owner's source hierarchy: tracked results, the DFS Bible with its confidence labels, then ETR primary digests. New strategic rules require supporting evidence; these engineering priorities are not claims of validated DFS edge.

## Release gates

1. Run workspace, browser and existing Worker regression checks; assembly must be idempotent.
2. Review/verify Firebase rules using authorized access. Anonymous and other-account reads/writes must fail.
3. Obtain fresh owner authorization for Pages and Worker production changes, as required by `docs/worker-deploy.md`.
4. Upload a Worker preview using the complete manifest; verify CPU/memory at limits and authenticated CSV → solve → simulate → exposure → export with synthetic data.
5. Promote, then verify deployed core discovery and page save/load with the same account. Change staged declarations only after that verification. Reconnect/refresh the client's tool catalog if it caches registrations.
