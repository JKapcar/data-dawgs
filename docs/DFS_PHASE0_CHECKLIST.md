# DFS Labs — Phase 0 checklist

Status: **complete without DK Export CSV** (live draftables via toto).

## Decision (no live DK export)

Kap will not rely on desktop `DKSalaries.csv` Export (Android cannot export). Phase 0 uses public DraftKings lobby + draftables proxied through toto instead.

- Synthetic CPT/FLEX fixture still covers Export-shaped CSV parsing.
- Optional: someday smoke a real Export against `readSalaries` — nice-to-have, not blocking.

## Landed

| Piece | Notes |
| --- | --- |
| `work/dfs-slate-ingest.js` | DK CSV + ETR paste; showdown CPT/FLEX; K on showdown; reject ETR showdown as salary |
| `work/dk-draftables-ingest.js` | Lobby filter (ContestTypeId 21/96) + draftables → player pool + OUT/Q/IR |
| `GET /dk/lobby`, `GET /dk/draftables` | toto CORS proxies only — store nothing (I2) |
| `dfs.html` Slate | **Load from DraftKings** (lobby picker + draftables); CSV paste still works |
| `work/dfs-contest-screener.js` | §5 bands + §4.1 preset map |
| `work/dfs-standings-ingest.js` | IndexedDB skeleton (I3) |
| Screener / Standings UI | Tabs 6–7; Method → 8 |

## Invariants

- **I1** Never fetch/store/commit paid ETR.
- **I2** Solver/sim client-side; toto = CORS proxy only.
- **I3** Standings on-device only.

## Deploy note

`/dk/*` live on toto (redeployed 2026-09-05; Chrome UA fix #70).

## Next

Phase 1 checklist: `docs/DFS_PHASE1_CHECKLIST.md`.
