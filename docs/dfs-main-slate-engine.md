# Classic main-slate engine

The shared solver source is `work/dfs-engine.js`, inlined into `dfs.html` and assembled into `dawg-bot-worker.js`. The existing branch-and-bound optimizer implements the requested integer constraints without installing CBC in a browser. Tests compare its optimum with an independent exhaustive oracle, including negative objective weights and hard-cap infeasibility.

On Solver, **Apply main-slate defaults** selects $48,500–$50,000, three differing players, four per team including DST, two WR/TE teammates, one non-DST bring-back, and no QB/RB against opposing DST. A fifth teammate requires explicit selection. The ACO cap stays as entered; blank disables it. GPP weights default to 0.3 / 0.7 / −0.05. Objective values never overwrite player projections. A time-limited incumbent is legal but not proved optimal.

**Simulate 30,000 score worlds** runs the separate score-tail model in a background worker. This does not replace the existing empirical contest simulator. See the Week 2 log for assumptions and units. It reports median, p90, p99, p99.9, score-threshold probabilities and hit counts, ACO, and sum ln(ownership percent). It does not simulate the contest field or estimate ROI.

REST/MCP settings accept solver `acoCap` (nullable), `objective` (`proj`, `ceil`, `own` weights), and `stack.noQbVsDst`. Simulation `mode: "score_tail"` supports `sims: 30000, seed: 216`; default `mode: "contest"` retains its existing 16,000-world ceiling. Compare refuses score-tail mode. Saved solver settings round-trip to the browser; score-tail results remain available through workspace get and can be rerun with the browser score button.

## Private slate preparation

```
node tools/dfs-main-slate.mjs INPUT.csv PRIVATE_OUTPUT.json
```

This uses the production CSV reader, selects Large Field ownership, maps `id` to both identity fields, normalizes opposite teams and shared game IDs, and filters projection ≥6 before enforcing the 220-player cap. Never commit either the input or generated JSON. Read the target workspace first; use its current revision in the players mutation. Verify the increment and `audit.missing_projections: []` in the result.

## Release checks

- `node work/test-dfs-main-slate.cjs`
- `node work/test-dfs-page.js`
- `node work/test-dfs-workspace.mjs`
- `DDFS_JSDOM=/tmp/dd-dfs-test/node_modules/jsdom node work/test-dfs-workspace-ui.cjs`
- `DDFS_JSDOM=/tmp/dd-dfs-test/node_modules/jsdom node work/test-dfs-autoload-ui.cjs`

Pages and Worker are separate releases. Run the existing worker-deploy workflow with the complete manifest when promoting backend changes. Paid slate data is not a repository deployment artifact; loading the private workspace requires account authentication.
