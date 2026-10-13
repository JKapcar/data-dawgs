# NHL DFS Labs research preview

Review branch only. No merge, production Pages release, Worker promotion, or contest submission is authorized by this build.

## Open and review

Run `node tools/nhl-preview-server.cjs` from the checkout, then open `http://127.0.0.1:8765/dfs.html?sport=nhl`. The NHL button uses the existing sandboxed decision-desk frame. The direct `dfs-nhl.html` page works for local/synthetic exploration but has no parent account bridge. Use **Try synthetic example** to inspect interactions without supplying private data. Synthetic examples cannot be saved as real workspaces.

Choose DK or FD before uploading one DFS CSV. The importer recognizes common name/position/team/salary/ID headers, quoted fields, and DK preambles. It reports exact parsed/rejected counts and mapping. Rejected rows are not silently repaired. Ownership is percent 0–100; blank is null. Salary imports do not invent a slate ID/date, opponent, NHL identity, or playing probability. Enter an exact target slate under the single disclosure; missing CSV evidence remains flagged.

Select a player to view event components and edit minutes, playing/start probability, line, PP unit, availability, NHL ID and source. Overrides are timestamped assumptions. Then choose an eligible roster slot. The builder checks uniqueness, salary, position, team limits, slate date/ID and games; all roster presets remain provisional pending official verification. Correlation diagnostics identify shared line/PP roles and goalie-versus-skater opposition without estimating numerical correlation or contest suitability.

## What is implemented

- Shared browser/Worker NHL core (`dfs-nhl.js`), separate from NFL arithmetic.
- DK/FD provisional event scoring, explicit missing components, and Poisson threshold bonus expectations rather than thresholds on means. Full points/value remain unknown while required components are absent; the display clearly labels the available subtotal.
- Recency-weighted per-minute event rates, with 30-day half-life and 180 minutes of position-level shrinkage. Expected minutes come from pre-as-of appearances or an explicit override. Playing/start probabilities require user input; no unsupported schedule-based availability model is claimed.
- Goalies identified by populated goalie statistics even when position is blank. Separate saves, shots faced and goals allowed rates. Win/shutout/overtime-loss estimates require explicit inputs; relief appearances and goalie event accuracy are not calibrated.
- Authenticated historical derivation via the existing `/api/dfs/nhl_model` dispatcher / `dd_dfs_nhl_model`. Fixed upstream URL construction, bounded season/type/input size, no user-controlled URL or raw boxscore response.
- Existing signed-in UID/ETag/revision storage through `dd_dfs_draft` and `dd_dfs_get`, using `draft.sport=nhl`. Full state retains nulls, overrides, provenance, model, roster and exact-slate target. Separate NHL names protect existing NFL work. NFL solve/simulation/export reject NHL workspaces. Account switching clears the browser state.
- Existing opaque-origin frame bridge, nonce, sender check and explicit actions. No new grant, anonymous data endpoint, auto-upload, localStorage mirror, or Toto session-data exposure. Authorized AI reads the saved state through the same personal connector.

## Historical evidence

Source: https://github.com/sportsdataverse/sportsdataverse-data/releases/download/nhl_player_boxscores/player_box_2027.csv

Retrieved October 13, 2026. The file contains 3,560 player-game rows, 89 distinct games, and maximum game date October 12. Game IDs have type `02` (regular season); type `01` preseason and `03` playoffs are not mixed into that run. The as-of date is excluded in its entirety because boxscores lack reliable completion timestamps. `MM:SS` converts to decimal minutes. Of the source rows, 3,392 pass minute/stat validation; 168 are rejected, including zero-minute records. Neither accepted count nor stable IDs independently proves upstream identity accuracy. Names are abbreviated in places; exact NHL ID or unambiguous exact name/team matching is required. Team/goalie conflicts fail closed.

Reproduce locally without committing raw data:

```sh
node tools/nhl-research.cjs /private/player_box_2027.csv 2026-10-13T12:00:00Z /private/nhl-research
```

The command writes a derived model and chronological event-count backtest. Paste the derived model under **Local research model** for offline review, or use the authenticated preview Worker refresh after that Worker is available. Full raw history and derived player-level research files are intentionally outside the public repo. Aggregate evidence is in `docs/nhl-backtest-preview.json`, including source SHA-256.

The walk-forward test uses 1,326 skater appearances from October 4–12 with at least three earlier appearances. All methods use the same eligible rows; no same-day results or realized target minutes enter predictions. This is conditional-on-appearance retrospective evaluation from a current snapshot, not a prospective fantasy-point validation or availability calibration.

| Event | Shrinkage MAE | Season average MAE | Shrinkage RMSE | Season average RMSE |
|---|---:|---:|---:|---:|
| Goals | 0.2841 | 0.2808 | 0.4355 | 0.4820 |
| Assists | 0.4310 | 0.4166 | 0.5614 | 0.6195 |
| Shots | 1.0598 | 1.1348 | 1.3591 | 1.4748 |
| Blocks | 0.7685 | 0.7780 | 0.9803 | 1.0458 |

Last-10 averages and simple recent-minutes × historical-rate baselines coincide with season averages in this young-season sample. Goal/assist MAE did not improve. Parameters were not optimized on these rows, but have not been validated on a broad independent holdout. No profit, ceiling calibration, goalie performance, full fantasy-score, cash-rate, top-1% or ROI claim follows from these results.

## Release blockers and next increment

1. **Official rules verification:** https://www.draftkings.com/help/rules/nhl returned a dynamic shell; https://www.fanduel.com/rules returned 403. No blocked source was bypassed. All scoring/bonus/cap/roster/team-limit presets are visibly provisional and cannot establish provider legality. Verify current official classic rules and attach dated evidence before release.
2. **Browser visual QA:** local Chromium reached `ERR_NETWORK_ACCESS_DENIED` when opening localhost. DOM interaction tests pass, but no local visual pass is claimed. `work/test-nhl-browser.mjs` runs desktop/mobile checks and captures screenshots in CI; inspect those before accepting the preview.
3. **Live integration:** the authenticated API/MCP round-trip is tested with a mock ETag store. A preview Worker version and signed-in browser round-trip still need verification. No deployment/promotion occurred during local implementation. Team-shared workspace semantics were not added; existing personal-account authorization is retained.
4. **Data permissions/quality:** the repository's MIT license covers software and does not independently authorize underlying NHL data redistribution/resale. This implementation returns derived research only and publishes no bulk raw data. Review underlying rights, identity consistency and refresh operations before a public service. MoneyPuck and blocked scraped sources are not dependencies.
5. **Model completeness:** add licensed/authorized roster IDs, special-team and shootout events, multi-season training, chronological goalie evaluation, availability/start modeling and prospective frozen receipts. A source-specific identity adapter is preferable to fuzzy matching.
6. **Later research:** calibrated uncertainty and validated opponent effects; automated timestamped roles/status; ownership source with coverage/units; actual field model and contest simulation only after separate validation. Until then, ownership remains unknown and no contest outcome rates are shown.

## Checks

`node --test tests/nhl.test.cjs` (12 core tests), `node work/test-nhl-workspace.mjs` (30 checks), and `DD_NODE_MODULES=/path/to/node_modules node --test tests/nhl-ui.test.cjs` (4 interaction tests). Existing DFS draft, workspace, portfolio, history and MCP regression checks also run. Worker assembly is deterministic and generated from `work/` sources. The service-worker cache key must be stamped after final HTML/JS edits.
