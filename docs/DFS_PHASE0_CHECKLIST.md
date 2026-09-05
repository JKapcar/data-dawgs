# DFS Labs — Phase 0 checklist

**Status:** pipes in progress (2026-09-05). Bible at `docs/DFS_LABS_BIBLE.md`.  
**Source of truth:** Bible §10. Invariants I1–I5 apply.

## Decision (no live DK export yet)

Skip waiting on a historical DK Export CSV. Build ingest / screener / standings pipes with:
- ETR-shaped paste fixtures (synthetic in `tests/fixtures/`; never commit paid ETR)
- Synthetic DK Showdown CPT/FLEX salary CSV (invented players)
- One real DK Showdown `DKSalaries.csv` still required before calling Phase 0 **done** (desktop Export)

## One prompt for local Cursor (remaining)

> Wire toto CORS draftables + OUT/Q; exercise standings UI against a GameCenter CSV; when a live DK Showdown Export exists, drop it on `readSalaries` and document breaks in the PR.

## Landed in this Phase 0 pipes PR

| Piece | State |
|---|---|
| `work/dfs-slate-ingest.js` | DK aliases, K on showdown, ETR showdown **rejected** as salary, Large/Small Field own, CPT Own/Proj on paste |
| `tests/fixtures/dk-showdown-salaries-synthetic.csv` | CPT/FLEX + kickers |
| `work/dfs-contest-screener.js` | §5 bands + §4.1 preset map (manual contest object; toto lobby later) |
| `work/dfs-standings-ingest.js` | GameCenter CSV → IndexedDB skeleton (I3) |
| `dfs.html` | Inlines ingest modules; wrappers for `readSalaries` / `applyProjections` |
| Tests | `node work/test-dfs-slate-ingest.js`, `node work/test-dfs-phase0-pipes.js` |

## Still open

- Live DK draftables via `toto` + OUT/Q flags
- Screener UI on the page (module ready)
- Standings UI on the page (module ready)
- Real DK Showdown Export once on desktop
- Showdown solver/`POS` fully K-aware in classic tables (pool filter includes K; sampler uses full eligible list)

## Invariants

Do not commit real ETR boards. Demo/synthetic only in git.
