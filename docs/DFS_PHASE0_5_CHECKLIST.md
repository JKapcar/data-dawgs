# DFS Labs — Phase 0.5 checklist

Status: **open / in PR** — "landed" only after Kap phone test (work order §3: cold-open `dfs.html` on Android → slate, ranked contests, pipeline chips, last week's grade in under 10 seconds with zero taps).

Companion: `docs/DFS_LABS_AUDIT_2026-09-06.md` · `docs/DFS_PHASE0_5_WORK_ORDER.md`.

## Tasks

| Piece | Notes |
| --- | --- |
| T1 · Dashboard-first page (DFS-001) | In PR: https://github.com/JKapcar/data-dawgs/pull/76 |
| T2 · Auto-load on open (DFS-001/010, DFS-009 partially) | In PR: https://github.com/JKapcar/data-dawgs/pull/75 |
| T3 · Screener auto-fill (DFS-005) — Worker + page | In PR: https://github.com/JKapcar/data-dawgs/pull/74 |
| T4 · Selection key (DFS-003) — engine + page | In PR: https://github.com/JKapcar/data-dawgs/pull/72 |
| T5 · Never-empty projections (DFS-002) — modelled baseline tier | Open (after Wed; due Sat 2026-09-12) |
| T6 · Week object + receipts + Toto surface (DFS-007) | In PR: https://github.com/JKapcar/data-dawgs/pull/77 |
| T7 · Hide the cumulative-ownership frontier (DFS-004) | In PR: https://github.com/JKapcar/data-dawgs/pull/73 |
| T8 · Docs (DFS-008) | In PR: https://github.com/JKapcar/data-dawgs/pull/79 |
| T9 · toto health chip (DFS-009) | In PR: https://github.com/JKapcar/data-dawgs/pull/78 |

## Invariants

- **I1** Never fetch/store/commit paid ETR.
- **I2** Solver/sim client-side; toto = CORS proxy only.
- **I3** Standings on-device only.
- **I4** Rarity is candidate generator only — selection key fixed in T4.
- **I5** Model axes labelled prior until ≥3 weeks graded.

## Phone-test gate (Kap)

Cold-open on Android with zero taps: slate loaded, contests ranked, pipeline chips visible, last week grade (or empty-state prompt). Only then flip Status → **landed**.

## PR order (work order)

T4 → T7 → T3 → T2 → T1 → T6 → T9 → T8 → T5
