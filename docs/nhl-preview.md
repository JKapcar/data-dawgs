# Hockey DFS — standalone DraftKings preview

Local research release: static publication authorized October 13, 2026. Cloud save/load, automatic history refresh and AI workspace access are disabled. Reload clears all work. No Worker promotion.

## Current baseline: player-history/1

[Download the 725-player projection CSV](nhl-player-history-projections.csv). These are conditional known-component DK averages, not a fabricated tonight slate. No salaries, forecast appearance/start probabilities or full-point totals are supplied. The app downloads the same CSV and displays average, game-to-game SD and sample count. Full structured components, season splits, relief samples and source hashes are in `dfs-nhl-model.js`.

The default is each player's flat mean over the 2024-25 and 2025-26 regular seasons plus 2026-27 games strictly before October 13. There is **no position-mean shrinkage**. Variance is `sum((score - mean)^2)/(n-1)`; SD is its square root, not standard error. Score sum and sum of squares are exported for independent reconciliation. P10/median/P90 describe the historical partial-score distribution and are not guaranteed floors/ceilings. Historical statistics remain unchanged when an explicit forecast probability is entered.

Each appearance is scored with observed DK components and actual threshold bonuses before averaging. This replaces Poisson bonus approximations in the earlier rate prototype. Skater short-handed points and shootout goals are absent from these boxscores and remain flagged. Goalie offensive fields are absent too. Goalies are conditioned on starts, including short/pulled starts; relief samples are separate. W and O decisions supply wins and overtime losses, and actual 35-save bonuses are included. A shutout requires zero goalie goals allowed, a sole positive-minute goalie for that team, and zero team goals against. One ambiguous zero-GA result remains unknown. Missing contributions are omitted from the labeled partial subtotal, never described as observed zero.

Source coverage: 1,312 completed regular-season games in each of 2025 and 2026; 89 current-season games. Accepted appearances: 49,968 / 49,974 / 3,392. Zero/invalid-minute rows excluded: 2,485 / 2,480 / 167. Goalie save+GA versus shots inconsistencies exclude 20 / 24 / 1 additional rows. Accepted starts: 2,604 / 2,600 / 177. These omissions mean goalie samples are not complete even though every game has accepted player data. Playoffs are excluded. Same-day games are withheld together; no postgame minutes enter a prediction for that game.

Current role, line, PP and status remain timestamped manual evidence. They do not silently alter the baseline. An explicit skater minutes override scales the partial mean by requested/historical minutes, capped at 0.85-1.15. This is an approximate linear adjustment, including nonlinear bonuses, and is labeled as such. Goalie minutes overrides do not scale the start-conditioned score. Playing/start probability remains separate; blank shows points conditional on appearance/start. No opponent, ownership or profit model is claimed.

[Chronological backtest results](nhl-player-history-backtest.json) compare player mean, previous-season mean (falling back to available player mean), last 10, last 20, EWMA with 20-appearance half-life, and a capped recent-minutes adjustment. At least 10 prior appearances/starts are required. 2026 is the development comparison; 2027 is a small descriptive holdout. The same prior P10-P90 empirical range is evaluated for coverage across method rows; it is not a method-specific calibrated interval. The plain mean remains the transparent default, not a claim of optimality. On 3,048 current-season skater appearances its MAE/RMSE are 4.623/6.119; last-10 is 4.679/6.321. On 163 goalie starts the mean's MAE/RMSE are 7.943/9.788. Prospective calibration and contest outcomes are untested.

Rebuild with `node tools/nhl-player-history.cjs /private/source-directory base-model.js 2026-10-13T20:21:00Z /private/output-prefix`. Source directory contains player_box, goalie_box, team_box and game_info CSVs for ending-year seasons 2025, 2026 and 2027. Full names/current teams use the previously audited 725-ID roster snapshot; history follows stable NHL IDs across trades. Same-source agreement is not independent identity verification. Export generation is `DDNHL.projectionCsv(model)`.

Audit/red-team priorities: independently verify IDs and roster changes; investigate the 45 rejected goalie starts and unresolved shutout; supplement missing SH/shootout/offensive goalie events; assess era/team/role drift and survival bias of the current 725-player cohort; prospectively freeze inputs; validate probability and variance calibration; compare minutes adjustments without tuning on the holdout. No missing advanced input blocks the historical baseline.

## Open and review

Open `dfs-nhl.html` directly, or run `node tools/nhl-preview-server.cjs` and visit `http://127.0.0.1:8765/dfs-nhl.html`. Hockey DFS is its own app and site-navigation entry, like Showdown; it is not embedded in football DFS. The first version is DraftKings only. Use **Try synthetic example** for review without private data. Synthetic examples cannot be saved as real lineups.

Upload one DraftKings slate CSV. The importer recognizes name/position/team/salary/ID headers, quoted fields and DK preambles, and reports exact parsed/rejected counts. No FanDuel selector, ownership display, contest/portfolio tools, simulation controls or market-import workflow appears in this app. Exact-slate evidence and historical settings live in details. Missing slate, status and projection inputs remain flagged.

Select a player to view event components and edit minutes, playing/start probability, line, PP unit, availability, NHL ID and source. Overrides are timestamped assumptions. Then choose an eligible roster slot. The builder checks uniqueness, salary, position, three skater teams, slate date/ID and games; DK Classic roster rules are verified from current official rules screenshots supplied by the user on October 13, 2026. Correlation diagnostics identify shared line/PP roles and goalie-versus-skater opposition without estimating numerical correlation or contest suitability.

## Earlier rate prototype and shared infrastructure

- Shared browser/Worker NHL core (`dfs-nhl.js`), separate from NFL arithmetic.
- DraftKings source-verified event scoring (legacy FD arithmetic remains internal and unexposed), explicit missing components, and Poisson threshold bonus expectations rather than thresholds on means. Full points/value remain unknown while required components are absent; the display clearly labels the available subtotal.
- Recency-weighted per-minute event rates, with 30-day half-life and 180 minutes of position-level shrinkage. Expected minutes come from pre-as-of appearances or an explicit override. Playing/start probabilities require user input; no unsupported schedule-based availability model is claimed.
- Goalies identified by populated goalie statistics even when position is blank. Separate saves, shots faced and goals allowed rates. Win/shutout/overtime-loss estimates require explicit inputs; relief appearances and goalie event accuracy are not calibrated.
- Automatic bundled derived snapshot: 725 player identities, 3,392 usable regular-season appearances through 2026-10-12, as-of 2026-10-13T20:21:00Z. A normal DK CSV uses exact full name/team or explicitly supplied NHL ID. DK IDs are never mistaken for NHL IDs. Coverage is shown after import. Unknown players/rookies with no history and team conflicts remain unprojected.
- Optional replacement model JSON and draft JSON download. No persistence or draft re-import.
- Cloud controls are disabled without handlers; CSP forbids connections. The retired adapter rejects all requests. Future NHL Worker writes/history require NHL_PRIVATE_PREVIEW=enabled, absent from deployed config. Existing football operations are unchanged.

### Automatic baseline and attribution

Upload a DraftKings Classic salary CSV; no model upload is needed. The bundled `dfs-nhl-model.js` contains derived rates and projected minutes, not raw game rows. Subtotals omit missing rare events and goalie outcomes. With unknown appearance probability they are conditional on playing. The snapshot is dated, not a live feed; the page flags age beyond three days. Historical slates earlier than model as-of are blocked. The source identity check is within SportsDataverse, not an independent NHL roster audit.

SportsDataverse's [data repository README](https://github.com/sportsdataverse/sportsdataverse-data/blob/c30618f5f439abc8275f0a9bea30892a598890b8/README.md) labels its release store **CC BY 4.0**. This is the publication basis, not its separate MIT software LICENSE. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) permits adaptation/sharing with attribution, a license link and changed-material notice. Those appear in the page and snapshot. DataDawgs changed the data by aggregating recency-weighted rates, applying position shrinkage and joining full names by exact game/player IDs. No endorsement or warranty is implied. Underlying sources: NHL public API via SportsDataverse; no raw feed is republished.

Refresh reproducibly using locally downloaded player boxscore and game-roster CSVs: `node tools/nhl-snapshot.cjs /private/box.csv /private/rosters.csv ISO-AS-OF dfs-nhl-model.js`. The builder enforces season, regular-season type, as-of cutoff, minutes and goalie consistency, and roster identity/team agreement. Source hashes are retained. No scheduled refresh is claimed; updates require this validation and a reviewed static release. Optional advanced model replacement remains available.

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

1. **Official DK Classic roster rules verified:** current user-provided official rules screenshots confirm 2 C, 3 W, 2 D, 1 G and 1 UTIL (C/W/D), $50,000, and skaters from at least three NHL teams. There is no separate maximum-total-team rule; six skaters plus their goalie is valid. Goalies do not supply a third skater team. Images remain private. Known scheduled game times lock additions, removals and moves in the UI and saved-state API; missing times remain visibly unverified. Imported DK positions are retained, not inferred from history.
2. **Browser visual QA completed:** local HTTP navigation reached `ERR_NETWORK_ACCESS_DENIED`; settings were preserved. Direct-file Chromium desktop/mobile smoke tests then passed, and both screenshots were visually inspected with no mobile horizontal overflow. The normal HTTP browser test also passed in GitHub CI run 38445587766, artifact `nhl-preview-screenshots`. This verifies the standalone desk, not the live signed-in Worker flow.
3. **Live integration:** the authenticated API/MCP round-trip is tested with a mock ETag store. A preview Worker version and signed-in browser round-trip still need verification. No deployment/promotion occurred during local implementation. Team-shared workspace semantics were not added; existing personal-account authorization is retained.
4. **Data permissions/quality:** the data repository explicitly advertises CC BY 4.0; derived publication uses the attribution and change notices above, not the software MIT license. This implementation returns derived research only and publishes no bulk raw data. Review underlying rights, identity consistency and refresh operations before a public service. MoneyPuck and blocked scraped sources are not dependencies.
5. **Model completeness:** add licensed/authorized roster IDs, special-team and shootout events, multi-season training, chronological goalie evaluation, availability/start modeling and prospective frozen receipts. A source-specific identity adapter is preferable to fuzzy matching.
6. **Later research:** calibrated uncertainty and validated opponent effects; automated timestamped roles/status; ownership source with coverage/units; actual field model and contest simulation only after separate validation. Until then, ownership remains unknown and no contest outcome rates are shown.

## Checks

`node --test tests/nhl.test.cjs` (16 core tests), `node work/test-nhl-workspace.mjs` (32 checks), and `DD_NODE_MODULES=/path/to/node_modules node --test tests/nhl-ui.test.cjs` (4 interaction tests). Existing DFS draft, workspace, portfolio, history and MCP regression checks also run. Worker assembly is deterministic and generated from `work/` sources. The service-worker cache key must be stamped after final HTML/JS edits.

## Scoring verification update — October 13, 2026

DraftKings Network’s [official NHL guide](https://dknetwork.draftkings.com/2025/09/30/nhl-daily-fantasy-101-how-to-play-dfs-on-draftkings/) confirms all implemented DK event weights and thresholds. Scoring provenance is stored separately from the separately verified NHL roster rules. Goalies receive offensive statistics too; missing offensive projections remain unknown rather than zero. Shutout inputs must represent a sole goalie completing the entire regulation/overtime game without conceding; shootout goals do not disqualify it. Live signed-in integration remains open; roster verification is complete for the current supplied Classic rules.
