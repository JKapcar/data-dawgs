# Duplicate payout correction — 2026-10-24

Base: `bb7f0ada236d210dae784c21f03a0be4c4049e33` (current main at start).
Branch: `codex/dfs-tie-payout-correction-2026-10-24`. Local review only; no push, merge or deployment.

The standard simulator already pools prizes over all occupied tied ranks. Its separate ownership-product prior then divided that settled amount again. Remove that second division. Keep `eDupes` diagnostic and retain `evAdj` as a compatibility alias of settled `ev`, including its null availability gate. The legacy `approxEvAdj` alias also follows that gate; `approxEv` remains an explicitly approximate internal diagnostic. Train and validation summaries use identical rules.

The browser and assembled private Worker carry the same engine. Standard cards, results and bot context use modelled payout EV when available, otherwise explicitly named Top-10 proxy ordering. No sampled top-heavy EV is displayed. Lab contest selection objectives and the separate full-field diagnostic simulator are unchanged. This is not empirical duplicate calibration or evidence of better actual win rates. Model quality and sample resolution remain limitations.

Arithmetic: first-place tie with prizes $100 and $60 pays $80 each; two tied mincash entries at $20 each receive $20; a tie spanning $20 and an unpaid place pays $10 each. Nine identical opponents plus the candidate and $80 total prizes pay $8 per entry. A prior of nine previously reduced the reported adjusted EV to $0.80; it now remains $8. Distinct rosters with tied scores receive the same occupied-rank treatment.

## Verification

Run `python work/test-payout-correction.py <output-folder>` from the checkout. It records each command, exit status, logs and a reproducible synthetic ranking receipt. Final run: all 15 commands passed, including 131 aggregate DFS/service-worker tests, engine/browser parity, main slate, selection, Lab contest objectives, simulation v2, workspace/draft/portfolio/history, MCP, data validation and Worker/service-worker syntax checks. Worker assembly passed its idempotence/parse guards. `git diff --check` passed; staged cache hash verification also required before committing.

The ranking fixture uses eight unchanged legal synthetic Classic rosters, a supplied 200-opponent full field, seed 99 and 1,000 identical scoring draws. Zero-based order changes from `[4,3,0,1,6,2,5,7]` to `[7,4,3,0,1,6,2,5]`. Candidate 7 has a deliberately imposed prior of 100: its previous adjusted value was $0.203204; settled EV is $20.523647. All raw EVs and mean scores are exactly equal before and after. This is a regression fixture, not a calibrated forecast. Current-lineup comparison is unavailable because no verified current candidate/projection inputs were supplied.

Initial verification found a typo in the new parity test and missing ownership in an early generated-field fixture; both were corrected before the final run. The final ranking fixture supplies its field explicitly. Browser end-to-end checks were not run: Playwright/jsdom are absent and the workspace dependency tool reports this thread unsupported. Page script compilation, embedded-source parity and renderer availability assertions passed; this is not a visual browser certification.

No field generation, scoring distribution, projection source, saved lineup, historical split/gate or rejected calibration candidate changed. Payout changes apply only to new simulations; archived outputs are not rewritten. The independent research branch remains untouched. Review the portable patch before any separately authorized release.
