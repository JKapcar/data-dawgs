# DFS Labs — Phase 0 checklist

**Status:** audit-only as of 2026-09-04 (Bible on `main` at `docs/DFS_LABS_BIBLE.md`; implementation not started from Grok Bot — Cloud Agents unavailable on plan).  
**Source of truth:** Bible §10. Invariants I1–I5 apply.

## One prompt for local Cursor

> Implement Phase 0 per `docs/DFS_LABS_BIBLE.md` §10. Start with a **real** DraftKings Showdown salary CSV: fix kicker drop + captain merge, add a fixture/test, then DK live slate + OUT/Q via toto CORS, ETR-shaped paste through the real parser, contest screener lobby fields → §4.1 presets, and standings ingest skeleton (IndexedDB only). Do not fetch/store/commit ETR. PR description must include “Where the showdown parser broke.”

## Already in the hub (`dfs.html`, `work/dfs-engine.js`)

| Piece | State |
|---|---|
| DK salary CSV upload/paste | Works (file stays on-device) |
| Showdown CPT/FLEX merge in `readSalaries` | Present, **untested on a real file** |
| Projection/ownership paste (`applyProjections`) | Column-guessing paste-in; not a dedicated ETR format path |
| Demo slate | Synthetic, labelled (I1 OK) |
| Bankroll “My Contests → History” import | Present — **not** GameCenter standings ingest |
| Live DK draftables via `toto` | **Missing** |
| OUT/Q flags from lobby | **Missing** |
| Contest screener → §4.1 presets | **Missing** |
| Standings → IndexedDB skeleton | **Missing** |

## Highest-risk break (fix first)

In `readSalaries`, positions not in `QB/RB/WR/TE/DST` are dropped. **Showdown kickers (`K`) never enter the pool.** Expect that as the first failure on a real showdown export; then CPT-only rows without a FLEX twin; then ETR name-matching on CPT labels.

## Phase 0 acceptance

1. Real DK Classic **and** Showdown slate path end-to-end; OUT/Q visible when DK provides them (CSV and/or toto draftables).
2. ETR-shaped paste/CSV through the real parser; synthetic demo paste OK; **no** ETR committed or fetched (I1).
3. Showdown captain merge proven against a **real** DK showdown file (sanitized fixture OK if it is public DK JSON/CSV shape — not paid ETR).
4. Contest screener: buy-in, entry cap, field cap, prize pool, places paid, tier boundaries → maps to Bible §4.1 preset.
5. Standings ingest skeleton: GameCenter/standings CSV → localStorage/IndexedDB only (I3); Week 1 capture even if nothing consumes yet.

## Out of scope for Phase 0

Frontier as selection objective (I4), live ETR fetch, server-side standings upload, Phase 1–3 features.

## Suggested PR title

`dfs: Phase 0 — slate import, showdown captain merge, screener, standings skeleton`
