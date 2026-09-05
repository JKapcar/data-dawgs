# DFS Labs — Phase 1 checklist

Status: **landed** (Weeks 1–3 Bible §10).

## Deliverables

| Piece | Notes |
| --- | --- |
| `work/dfs-contest-presets.js` | Full §4.1 presets → solver cfg (lineups, uniques, rand, leverage, stacks) |
| `work/dfs-dupe-model.js` | `E[dupes] = entries × Π own × Π c_jk` with §3.2 priors; always `prior: true` (I5) |
| `work/dfs-validators.js` | §4.2 classic + showdown warn/info; §4.3 fit score; export gate on contest mismatch |
| `work/dfs-receipts.js` | §9.3 grades on whatever exists; empty → prior (I5) |
| `work/dfs-standings-ingest.js` | Entry-name hash on ingest; schema `dfs-standings-v1-phase1` |
| `work/dfs-contest-screener.js` | Enriches mapped preset from `DDFSPresets` |
| `dfs.html` | Preset picker + Validate; screener **Apply**; lineup E[dupes]; standings Grade week |

## Invariants

- **I1** No ETR fetch/store/commit.
- **I2** Client-side only for solver/dupe/validators.
- **I3** Standings/receipts on-device.
- **I5** Dupe / fit / empty receipt sections labelled **prior** until ≥3 weeks graded.

## Tests

`node work/test-dfs-phase1.js`

## Not in Phase 1 (Phase 2+)

- Replace §3.2 `c_jk` with standings fits (≥3 weeks)
- Pareto frontier candidate cloud + sim overlay as selection driver
- Ownership calibrator
