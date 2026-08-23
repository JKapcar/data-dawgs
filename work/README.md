# work/ — build sources for the Worker and the DFS engine

Nothing here is served. It is the source that the deployed artefacts are built from,
committed so it cannot die with a session — which has happened once already on this repo
(`build.py` and the whole `site/` tree, gone with the session that held them).

## The Worker

    cd work && node assemble.mjs      # rewrites ../dawg-bot-worker.js IN PLACE

`mcp-block.js` is the hand-edited MCP adapter. **Edit it there, never in the assembled
Worker** — the block is regenerated on every build and edits to the output are lost.
The build also injects `dfs-engine.js` and `survivor-path-engine.js` into private Worker
roots. That is how `dd_solve_dfs_lineup`, `dd_optimize_survivor_path` and their browser
views run the same solver sources instead of parallel ports.

⚠️ **The build is idempotent and must stay that way.** The committed Worker *is* the
assembled output, so a build that naively appends produces a second copy of every
declaration and `SyntaxError: Identifier 'MCP_PROTOS' has already been declared`. The
build strips between content markers before injecting, then proves the result: one of
each declaration, exactly one shared solver, parses under `node --check`, no write calls
inside the block, and a second pass that would change nothing. It reverts the file rather
than leave a broken Worker on disk.

Tests: `node test-mcp.mjs`.

## The Dog Track (rankings)

`rankings-block.js` is the capture half of the rankings report card — the entrants
registry and the Thursday snapshot route. **Edit it there, never in the assembled
Worker**; `assemble.mjs` regenerates the DD-RANKINGS-BLOCK region on every build.

    node test-rankings-snapshot.mjs   # 98 assertions, mostly refusals

⚠️ **The block is injected ABOVE the MCP block, and the build asserts it.** The MCP
block's write-scope guard scans from the DD-MCP-BLOCK marker to end of file and bans every
Firebase write helper there. This block is a capture ledger and legitimately calls
`fbPut`/`fbPost`, so below that marker it would fail a guard written about something else
entirely — and the tempting "fix" would be to weaken the guard.

Raw third-party ranks are paid content: they live in Firebase behind toto and never appear
in a route response, an error body, the audit log, or a test fixture. The test file's
player names are all invented, and several assertions do nothing but scan responses for
them. Spec: `claude/dog-track-rankings-spec.md`. Visual contract:
`dog-track-mockups-v2.html`.

## The survivor path engine

`survivor-path-engine.js` is the bounded exact maximum-product assignment used by both
the survivor board and MCP. Run `node sync-survivor-path.mjs` after changing it; the
generated block in `survivor.html` must never be edited by hand.

    node test-survivor-path.js  # exact/brute-force math, reuse and browser-source parity

## The DFS engine

`dfs-engine.js` — the exact solver (branch and bound) and the correlated contest
simulator that `dfs.html` inlines, and that the compute-layer MCP tool will import.

⚠️ It is committed here **because the page inlines a copy**. If the two ever diverge the
page and the tool answer the same question differently, which is worse than either being
wrong. Treat this file as the source and the page's copy as a build artefact.

    node test-solver.js      # 38 assertions, incl. agreement with exhaustive enumeration
    node test-sim.js         # 15 assertions, incl. correlations landing where measured

`estimate_corr.py` regenerates `corr.compact.json` — the measured within-game correlation
structure — from nflverse weekly stats, 2019-2025. It needs the source CSVs downloaded to
/tmp first; the header comment says which. Re-run it only to extend the sample, and bump
the date wherever the matrix is quoted when you do.

`mkslate.js` builds the synthetic DK-shaped slate the tests run against. ⚠️ Salaries are
calibrated so a 9-man lineup lands near $50,000 — an earlier fixture priced players ~10%
high, which made almost every random lineup illegal and looked like a solver bug.
