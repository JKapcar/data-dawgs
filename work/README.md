# work/ — build sources for the Worker and the DFS engine

Nothing here is served. It is the source that the deployed artefacts are built from,
committed so it cannot die with a session — which has happened once already on this repo
(`build.py` and the whole `site/` tree, gone with the session that held them).

## The Worker

    cd work && node assemble.mjs      # rewrites ../dawg-bot-worker.js IN PLACE

`mcp-block.js` is the hand-edited half. **Edit it there, never in the assembled Worker** —
the block is regenerated on every build and edits to the output are lost.

⚠️ **The build is idempotent and must stay that way.** The committed Worker *is* the
assembled output, so a build that naively appends produces a second copy of every
declaration and `SyntaxError: Identifier 'MCP_PROTOS' has already been declared`. The
build strips between content markers before injecting, then proves the result: one of
each declaration, parses under `node --check`, no write calls inside the block, and a
second pass that would change nothing. It reverts the file rather than leave a broken
Worker on disk.

Tests: `node test-mcp.mjs`.

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
