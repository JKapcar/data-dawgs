# DFS results ledger (WO-1)

The measurement layer. Every later DFS Labs model change is graded against it, so it records
what the model said **before lock** and what DraftKings recorded **after**.

## Pieces

| Path | What |
|---|---|
| `dfs-ledger.js` | Engine. Parses DK contest-standings CSVs, finds our entries, counts copies, recovers field ownership, joins each entry to the saved pre-lock workspace, computes residuals, writes the audit CSV. Pure; browser and Node. |
| `dfs-ledger-ui.js` | Standings sheet → *Results ledger · post-lock audit* panel on `dfs.html`. |
| `tools/dfs-ledger.mjs` | Same engine from the command line. Writes to `private/dfs-ledger/<slate>/` (gitignored). |
| `tests/dfs-ledger.test.js`, `tests/fixtures/dfs-ledger/` | Deterministic synthetic fixture (invented players and users) and the reference audit CSV. |
| `work/test-dfs-ledger-ui.cjs` | jsdom test of the panel. |

## Run it

Browser: sign in, open `dfs.html#standings`, *List saved workspaces*, choose the slate's workspace,
enter your DK username, choose the `contest-standings-<id>.csv` files, *Build audit*. Entry fee,
payout table, contest name and start time are fetched from DraftKings by contest ID; the earliest
start is used as the lock unless you set one.

CLI:

```
node tools/dfs-ledger.mjs --snapshot ws.json --user NAME [--lock ISO] [--contests meta.json] contest-standings-*.csv
```

`ws.json` is `dd_dfs_get` with `include_results: true` and a limit covering every lineup.
`meta.json` maps contest ID → `{name, start_time, entry_fee, payout:[{from,to,prize}], max_entries, max_entries_per_user, type}`.

## Rules the engine enforces

- **Predictions are the snapshot as saved.** Nothing is re-simulated. If the workspace was saved
  after lock the build is refused; `--allow-postlock` / the checkbox overrides it and every row
  carries `prelock_verified: false`. With no lock time it is `null` (unverified), never assumed.
- **Missing stays missing.** The simulator reports cash, top-1%, places 1–10, mean/sd, mean rank
  and expected copies. It does not report top-10% or top-0.1%, so `pred_top10pct` and
  `pred_top0_1pct` are null and so are their residuals. The *actual* indicators are recorded, so
  the columns fill in once the simulator produces them. No fee or payout → payout, cash and ROI
  stay null.
- **Predictions carry their contest basis.** The simulation models one contest (field size,
  parametric payout). Each row has `pred_basis_field` and `pred_basis_match` (contest within 15%
  of that field). `pred_dupes_scaled` rescales expected copies linearly to the contest's field.
  Cash residuals on a mismatched contest compare against the simulated payout, not that contest's.
- **Join status is explicit.** `joined` (in the snapshot and simulated), `not_simulated`,
  `not_in_snapshot_lineups` (hand-built or edited entry: inputs-derived fields only),
  `player_not_in_snapshot:…`, `lineup_hidden`.
- **Only derived data is kept** (Bible I3). Our entries, field ownership per player/slot, copy
  counts, contest metadata. Other entrants' names and lineups are dropped after counting.

## Record (`dfs-ledger/1`)

`slate` — workspace id/revision/saved time, source and `as_of`, lock time, `prelock_verified`,
snapshot SHA-256 (CLI), and the model block (engine version, sims, seed, field size, payout,
field sample, rank method, input revision).

`contests[]` — id, name, entry fee, observed field size, capacity, max per user, our entries,
payout table, total prizes, paid places, rake on the observed field and at capacity, tier
(heuristic: single_entry, multiplier, large/mid/small/micro GPP).

`entries[]` — one per entry: CPT, FLEX, salary, salary remaining, construction/script tags,
per-player pre-lock inputs (proj, ceiling, slot ownership), lineup projection, ceiling sum,
ownership product; model outputs (`pred_*`); actual points, rank, percentile, cash/top-x
indicators, copies, observed duplicates (copies minus our own), observed ownership product,
payout (DK tie split), ROI; residuals (ownership-product log error, duplicate error, percentile
error, cash and top-1% calibration residuals); `model_version`.

`ownership[]` — projected vs observed ownership by player, slot, contest, tier, field size and
fee. This is the input WO-4 needs.

`summary` — join counts, fees, payout, ROI, predicted vs observed cash and top-1% counts,
ownership bias/MAE/RMSE overall and by slot, duplicate MAE and bias.

## Limits

- One slate is an observation, not a calibration. Read residuals across slates.
- The workspace itself is mutable: a later solve or simulate overwrites the pre-lock state.
  Build the ledger (or save the `dd_dfs_get` output) before touching the workspace after lock.
  An immutable server-side snapshot is the next step.
- Ledgers live on the device (browser) or in `private/` (CLI). There is no account-side ledger
  store or MCP tool yet.
- `ceil_sum` is a sum of player ceilings, not a joint quantile. Lineup distribution quantiles
  are WO-2.
