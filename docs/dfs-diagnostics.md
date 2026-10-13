# DFS decision desk (local audit version 1)

Open **Open saved portfolio** from the DFS Labs builder, or **Saved work & tools → Portfolio audit**. Capture workspace takes a frozen copy of the current candidates and settings; later solver changes do not mutate that audit. The solver mathematics and existing workspace API are unchanged. Unsupported or missing evidence is shown as unknown, not an invented performance score.

## Privacy and retention

The desk runs in an opaque-origin sandboxed iframe with scripts and downloads only. It has no direct network, account credentials, browser storage or Toto access. The host container is marked `data-ddb-skip`. A host bridge accepts only the exact child frame, opaque origin, session nonce and bounded explicit operations; it keeps the existing account token outside the frame. Imports remain in session memory until the user explicitly saves or exports.

**Save portfolio / Load portfolio** stores one complete audit snapshot on a named owned workspace, independent of its manual builder draft, player pool, solver candidates, settings and computed results. To attach an audit to an existing workspace, load that name first. If no portfolio exists there, loading binds its current revision and retains the local audit, ready to save. A new name can be saved directly. Load replaces the local audit only if it has not changed during the request. Edits during a successful save remain unsaved and can be saved again. Account changes reset revision tracking. Nothing submits provider entries.

The shared browser/MCP contract is POST `/api/dfs/portfolio` / `dd_dfs_portfolio` with `{workspace_id, expected_revision, portfolio}`. `dd_dfs_get` returns `portfolio`; its existing `audit` field remains the computed workspace summary. `dd_dfs_list` adds `has_portfolio`. Writes require the authenticated UID and revision/ETag compare-and-swap. Expected revision zero creates a new name only; stale revisions fail without changing storage. Never use `draft` or `sync` to persist an audit.

Private saves support explicit DK Classic/Showdown version 1 records, at most 450,000 UTF-8 bytes, depth 24, 60,000 JSON values, and 64,000 characters per string, within the existing 2 MB workspace limit. All JSON evidence and extensions are preserved, including fees, contests, source, notes, roles, availability and nulls. An internal JSON string avoids Firebase dropping nulls or empty arrays. The API returns the decoded object. Invalid lineups remain auditable warnings rather than being silently repaired. Evidence is supplied and editable, not independently verified or tamper-proof.

There is no automatic upload, continuous sync or server version archive. Reloading loses unsaved changes. Export to retain an earlier version or an audit larger than the private-save limit. Clear audit only clears local audit state; it does not delete the saved account snapshot or the separate builder session. Keep private exports outside public repositories and shared assets.

## Schema and conventions

Import/export is JSON, version `1`, maximum 4 MB, 220 players, 600 entries and 20 alternative score models. Repeated import replaces, never appends. A file has `version`, `site`, `players`, `entries`, `source`, `capturedAt`, optional `settings`, `simulation`, `scenarios`, `contests`, `risk`, `notes`, and `recommendations`. Captures additionally retain `originalInputs` including original solver ordering and provenance. Export includes recalculated `diagnostics` summary and `exportedAt`; imported calculated diagnostics are never trusted for display.

Only `dk_classic` and `dk_showdown` rules are supported. Player references in `entries[].ids` are zero-based indexes into `players`, not provider IDs. Player fields match the existing workspace: `name`, `pos`, `team`, explicit `opp`, `gid`, `sal`, `cptSal`, `proj`, `own` (percentage points), `cptOwn`, `flexOwn`, `kickoff`. Showdown roster displays and ownership coverage use only the matching explicit CPT/FLEX value; total ownership is never substituted. Zero is retained and missing stays unknown. Optional injury evidence is `{status, source, asOf}`. Times must carry `Z` or an explicit offset. Imported data is not a live status feed.

An entry can include:

- `fee`: dollars or null. Each entry is one purchased/proposed entry, not a multiplicity. Missing fees make all fee shares unknown; a zero-dollar portfolio has undefined fee shares.
- `slots`: position labels corresponding one-to-one to `ids`; `cpt`: captain player index for Showdown. Capture constructs a roster order from solver candidates and marks `slotEvidence: "inferred"`. Swap feasibility remains unknown until the user supplies actual slot assignments and changes this to `"supplied"`.
- `lockedSlots`: zero-based slot indexes locked by the provider, in addition to kickoff locks. Player `lock` is a solver preference and is deliberately not treated as a contest lock.
- `contestId`, `lifecycle`: `proposed`, `entered`, `amended`, or `graded`. Entered/amended require `entryEvidence: {entryId, source, asOf}`. Graded additionally requires `result: {points, payout, source, asOf}`. These are user attestations; there is no provider verification. UI edits append prior values to entry history.

`source` contains `name`, `asOf` (provider time, not import time), and `version`. Captures retain the existing source hash when available; a cloud revision alone is not called a provider snapshot version. Missing provider time stays unknown. `originalInputs.sourceEvidence` retains import time and matching diagnostics separately.

`scenarios` is an array of `{name, source, asOf, projections}`. Each projections array aligns to the full player pool. Missing values produce an unknown total. Showdown scenario points use 1.5 times the captain's supplied scenario projection. These are deterministic scenario totals, not empirical distributions or cash probabilities.

`contests` can retain `{id, source, asOf, fieldSize, entryLimit, fee, payouts}`. `payouts` is a dollar amount for every rank, including zero for unpaid places. The desk checks completeness and assigned entry count, but never claims verified cash, ROI or duplicate splitting from these records. Other supplied evidence is preserved in the JSON editor/export.

Optional confirmed risk settings use fractions: `maxFeeExposure`, `maxCountExposure`, `maxPairFeeExposure`, `maxGameFeeExposure`, plus `confirmedAt`. No values are presented as optimal. Limits warn only; they do not change solver constraints. Diversification is a risk preference, not an automatic EV gain.

## Diagnostic interpretation

Count and fee exposure include all captured entries, even proposals. Player pairs are unordered pairs, and games are canonical team/opponent pairs, so two opposing QBs still share game exposure. Incomplete matchups make game exposure a lower bound. Overlap reports shared player count and shared games, not estimated correlation. Display is limited to 40 exposure rows and 2,000 overlap rows; every input remains in the export for recalculation.

Roster checks cover required slots, duplicates, salary, team/opponent consistency and game count. Stacks and bring-backs are contextual descriptions. Offense facing rostered defense is a warning to review, not an automatic exclusion. Swap checks require explicit kickoff time, respect fixed locked slots, then recheck eligibility, salary and matchup rules. The UI flags opportunities to place later eligible players in FLEX but requires the full proposed roster to pass before calling it mechanically feasible. It never submits or changes an entry.

Simulation provenance retains the existing browser metadata and seed (216), while clearly stating that no calibration receipt is attached. The dashboard does not reinterpret threshold exceedance as cash/top-1%/win probability or invent uncertainty intervals. Monte Carlo sampling noise can shrink with more independent worlds; model uncertainty from projections, field generation and duplicate assumptions cannot. Exact field simulation, calibrated probability intervals and modeled duplicate prize splitting remain unavailable in this dashboard.

Every finding includes evidence and a next action. Swap recommendations preserve before/proposed rosters and evaluated time, start unapplied, and can be marked declined or applied externally with a timestamped history. This records an attestation; it does not prove a provider action. Timestamped notes retain reasoning alongside outcomes, without grading pregame decisions from postgame scores.

## Backend follow-up (not implemented)

Full audit attachment retention/versioning, a verified entry/result import, sourced injury refresh, exact field/payout simulation with duplicate splitting, calibration receipts and shared access controls need separate backend work. Current private workspace storage remains its existing players/lineups/settings/source/as_of schema with the 220-player and 200-character source limits. No credentials or access rights were created. History and Team functionality is not assumed live.

## Validation

Run `node --test tests/dfs-diagnostics.test.js tests/dfs-ledger.test.js tests/service-worker.test.js` from the repository root. Browser checks: `node tests/dfs-diagnostics.browser.cjs` with Playwright installed, or set `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` to existing local installations. Optional `QA_OUTPUT` writes synthetic-only screenshots outside this repo. The browser test blocks external requests, uses a local HTTP server and verifies 390px/desktop, light/dark, keyboard/reduced motion, private export, repeated/invalid imports, status confirmation, swap rejection, parent capture, opaque-origin access and Toto reader exclusion.
