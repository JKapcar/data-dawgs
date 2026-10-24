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

## Supplemental UI verification — 2026-10-24

Installed the exact CI dependencies (`playwright@1.56.1`, `jsdom@30.0.1`) from the official npm registry into a separate workspace dependency directory. Playwright's official Chromium build v1194 installed successfully. This supersedes the earlier missing-dependency limitation; production code did not change.

Passed: `DDFS_JSDOM=<external node_modules/jsdom> node work/test-dfs-payout-ui.cjs`. This runs the actual standard Simulate button, positive duplicate-prior construction, engine, result table and lineup cards with synthetic inputs and stubbed Worker transport. Full-field settlement displays $8; sampled top-heavy settlement displays unavailable EV and explicitly named Top-10 proxy ranking. Also passed `work/test-dfs-workspace-ui.cjs`, covering private save/load, revision, auth header and local backup with mocked requests.

Failed, reproduced on unchanged base: `work/test-dfs-lab-ui.cjs:23` expects the upload control outside a details element, but current main nests it inside one. The identical assertion fails at base `bb7f0ada` and the patch before any simulation. The old test was not weakened or its unrelated layout changed.

Blocked/unrun beyond startup: `work/test-dfs-labs-ui.cjs` launched Chromium, but navigation to the local test server failed with `net::ERR_NETWORK_ACCESS_DENIED` at `http://127.0.0.1:<ephemeral-port>/dfs.html`. No alternate browser/network route was attempted after that denial. Actual browser interactions, responsive screenshots, cancellation and the remaining E2E assertions are therefore unverified. jsdom checks are not a substitute for browser certification.

Current-lineup comparison remains unavailable: the authorized workspace/project inventory contains historical 2020 audit inputs, synthetic NFL projection/lineup fixtures and unrelated NHL projection artifacts, not a verified current NFL candidate/projection snapshot. No private records or screenshots are included in the package. Supplemental commands/logs and the new test are included for reproduction.
