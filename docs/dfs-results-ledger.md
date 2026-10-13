# DFS results history and ledger

Two formats use separate device stores. Explicit account archives are also available in the Saved history sheet (`dfs.html#history`); imports are never uploaded automatically.

- **DraftKings account history:** `dfs.html#bankroll`. `Entry_Key` identifies each entry, `Contest_Key` the contest, and `Entry` its name. Records live in browser state `dd-dfs-v1`.
- **Contest standings:** `dfs.html#standings`. The ledger joins the specified user's entries to a saved prediction workspace. Other entrants' names and lineups are discarded after counting ownership, copies and ties. Explicit Keep on this device stores a ledger locally; downloads are private files.
- The older weekly-receipts panel has its own device IndexedDB. Loading a workspace or portfolio does not restore these stores.

## Private account history

Save log to my account archives the full bankroll log and retained legacy archives. Save audit to my account archives the current results ledger. Saved history lists and opens these versions on any device signed into the same account. Opening is read-only and does not replace the current draft or device log. Post-lock audits open in the existing audit renderer; account logs show entry IDs, finish/field, points, separate cash/tickets and missing values. Download original JSON retains the full source evidence.

Archive this revision copies a selected server workspace, including all players, candidates, settings, results and portfolio JSON. It requires the exact workspace revision and preserves the original prediction provenance without modifying the current workspace. Later changes do not affect the archive. Legacy timestamps remain unverified.

The four browser/AI operations are `history_save`, `history_archive`, `history_list`, and `history_get`, under `/api/dfs/` and `dd_dfs_` MCP tools. Account ownership comes only from the verified session/connector UID. Archives live below `/users/{uid}/dfsHistory/records/{sha256}`; a separate metadata index keeps list responses free of payload data. The UI clears loaded account history on account changes, rejects late responses, and does not mirror archives into localStorage or Toto context.

Archives preserve JSON as a string so Firebase cannot remove nulls or empty arrays. The kind and exact JSON determine the SHA-256 ID. Identical retries reuse the original record and server save time, including after an interrupted index write. Corrections create a separate archive; these endpoints cannot overwrite or delete an existing one. Titles of identical archives are not renamed on retry. Save responses distinguish existing records. Archive save time never proves historical prediction timing; client-supplied ledgers remain client-supplied evidence.

Maximum payload: 8 MB UTF-8, 24 nesting levels and 750,000 JSON nodes. List returns 25 metadata records by default, up to 100, with a cursor and optional kind filter. Oversize or incomplete payloads fail explicitly; no rows are truncated. A failed listing-index write reports that the archive was stored and asks for an identical retry. No automatic recovery, backfill, source reconciliation, strategy calibration or publication occurs.

## Import correctness

Account-history imports require entry ID, contest ID and fee columns. They retain points, finish, field size, prize pool, places paid, sport, game type, original source headers and row values. Source date text and its column label remain intact; no timezone conversion is invented.

Deduplication uses `(Contest_Key, Entry_Key)`. Separate tied entries survive. Exact repeated entries are skipped; conflicting evidence for an existing ID rejects the import atomically. Amendments require explicit reconciliation.

Cash winnings and ticket face values are separate. Tickets never enter cash ROI. Missing fees or cash winnings make the corresponding totals, profit and ROI unknown. Known zero remains zero. The cash-profit chart is unavailable with incomplete economics.

Cash labels require explicit names such as Double Up, 50/50 or Head-to-Head; a prize amount containing 50 is not cash evidence. Unknown Classic contests are Unclassified rather than assumed GPP. These labels are not a strategy grade. If a full import exceeds device storage, the complete log remains visibly available in the current session for account save/export, while the previous device log stays intact. Reloading before either action loses that session-only copy.

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

Synthetic coverage: `tests/dfs-history-correctness.test.cjs`, `tests/dfs-ledger.test.js`, `work/test-dfs-portfolio-workspace.mjs`, `work/test-dfs-ledger-ui.cjs`, `tests/dfs-history.browser.cjs`, `work/test-dfs-history-workspace.mjs` and `tests/dfs-account-history.browser.cjs`. The latter uses two isolated browser sessions and the assembled Worker with in-memory storage, without production access.

Unfinished: production publication and authenticated deployment verification, recovery/reconciliation of the user's original archives, archive deletion/retention management, and automatic archival of successive prediction runs. The implemented archive action is explicit. The separate portfolio feature persists one current audit; it does not import a results CSV or populate historical stores automatically. No personal history is saved by implementing or testing this feature.
