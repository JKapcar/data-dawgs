# DFS results history and ledger

Two formats use separate device stores. Neither is an account-level historical archive yet.

- **DraftKings account history:** `dfs.html#bankroll`. `Entry_Key` identifies each entry, `Contest_Key` the contest, and `Entry` its name. Records live in browser state `dd-dfs-v1`.
- **Contest standings:** `dfs.html#standings`. The ledger joins the specified user's entries to a saved prediction workspace. Other entrants' names and lineups are discarded after counting ownership, copies and ties. Explicit Keep on this device stores a ledger locally; downloads are private files.
- The older weekly-receipts panel has its own device IndexedDB. Loading a workspace or portfolio does not restore these stores.

## Import correctness

Account-history imports require entry ID, contest ID and fee columns. They retain points, finish, field size, prize pool, places paid, sport, game type, original source headers and row values. Source date text and its column label remain intact; no timezone conversion is invented.

Deduplication uses `(Contest_Key, Entry_Key)`. Separate tied entries survive. Exact repeated entries are skipped; conflicting evidence for an existing ID rejects the import atomically. Amendments require explicit reconciliation.

Cash winnings and ticket face values are separate. Tickets never enter cash ROI. Missing fees or cash winnings make the corresponding totals, profit and ROI unknown. Known zero remains zero. The cash-profit chart is unavailable with incomplete economics.

The former entry-row bootstrap and its confidence/edge claims are removed. Entries share contests and slates. These descriptive results do not establish profitability or grade a first-place strategy.

## Explicit legacy migration

Old imported bankroll rows lack reliable identity and may combine cash and tickets. Their original values remain intact and are not relabelled verified cash. Importing alongside those legacy rows is blocked to avoid double-counting.

1. Export log + legacy archives to retain the original JSON privately.
2. Choose Archive legacy import for re-import. Only legacy imported rows move into a dated device archive; manual records remain active. Storage failure restores the active log.
3. Re-import the original DraftKings CSV. A derived summary cannot recover entries discarded by the old importer.

Existing `dfs-ledger/1` files are not rewritten. They remain readable/exportable, while old calibration aggregates are excluded. Rebuild from original standings and archived prediction evidence. Keeping a changed ledger under an occupied slate name fails rather than replacing its archive; download the new JSON instead.

## Prediction timestamps

New workspace prediction/input writes record server-controlled `prediction_provenance`: version, `saved_at`, source time and workspace revision. Portfolio-only saves preserve this evidence and record `portfolio_saved_at`. General `updated_at` remains the mutable account-save clock.

The ledger checks prediction `saved_at` against lock time. Provider `as_of`, import time and account-save time are not substitutes. Saving a portfolio after lock cannot relabel an unchanged prediction; actual input or model writes create a new prediction timestamp.

Legacy workspaces are not backdated or automatically verified. A portfolio save retains their old workspace timestamp/revision as `legacy-unverified` evidence and leaves prediction time unknown. Raw old snapshots without prediction provenance remain unverified. Known post-lock predictions require an explicit override and remain excluded from calibration. This is not cryptographic attestation or an immutable server version archive.

## Ledger version 2 and the stated objective

The audit records an explicit objective: first-place tournament upside, cash frequency, expected profit, or unrecorded. This is labelled an audit-time statement, not proof of pre-lock intent.

Actual rank, points, first-place finishes/ties, field size, copies, payouts and cash ROI remain available. Contest context shows paid fraction, first-prize share of the pool and the neutral `1 / field size` equal-entry/no-tie reference. That reference is not this lineup's or portfolio's win probability.

`pred_top1_share_proxy` preserves the simulator's `top1Share`: a duplicate-adjusted top-1% ranking score, **not first-place probability or expected profit**. New ledgers do not emit the ambiguous `pred_objective`. Existing legacy files retain their original fields. Top-1%, literal places 1-10 and first place remain separate; unavailable outputs stay null.

Calibration requires verified pre-lock prediction provenance, a joined saved simulation, exact field size, matching fee and matching explicit payout tables by rank. Parametric or missing payout evidence remains unverified. Incompatible, post-lock and unknown rows stay visible with exclusion reasons but are excluded from model calibration residuals and summaries. Top-1% calibration also requires the model's resolution flag. Compatibility does not establish external calibration. Cash rate does not grade first-place upside.

## Tools and tests

`dfs-ledger.js` contains the pure import/join/summary functions; `dfs-ledger-ui.js` renders the standings audit. The CLI remains:

```sh
node tools/dfs-ledger.mjs --snapshot ws.json --user NAME --lock ISO --contests meta.json contest-standings-ID.csv
```

Use complete `dd_dfs_get` output with `include_results:true`. CLI output defaults to gitignored `private/`. Never commit private account-history CSVs, paid projections or user ledgers.

Synthetic coverage: `tests/dfs-history-correctness.test.cjs`, `tests/dfs-ledger.test.js`, `work/test-dfs-portfolio-workspace.mjs`, `work/test-dfs-ledger-ui.cjs` and `tests/dfs-history.browser.cjs`.

Unfinished: private account-level history save/list/load, cross-device historical browsing, immutable storage of successive prediction versions, and reconciliation of recovered user archives. The separate portfolio feature persists one complete current audit; it does not import a results CSV or populate historical stores automatically.
