# DFS Labs: single-upload implementation contract

This is an integrated change to `dfs.html`, not another website. Keep the Browns charcoal/orange/cream design and the existing audit, history and workspace APIs.

## Entry and state

- The first screen has one primary DFS CSV upload in the existing opaque diagnostics iframe. It has no network permission or same-origin access. No CSV or draft enters parent localStorage, Toto context or telemetry automatically.
- `dfs-builder.js` recognizes spaced or compact ETR Classic headers and known Showdown CPT columns. Explicit percent signs establish percentage-point units; bare numbers remain ambiguous. Foreign platforms are rejected with an actionable message. Classic small/large/cash ownership columns remain distinct.
- Successful import shows filename, count, platform/format and freshness status, and resets the current roster atomically. Malformed imports keep the previous pool/roster. Date/source time can be unknown. Source time is never replaced with import time.
- `dfs-builder-ui.js` owns the session pool/roster. Repeated imports, reset and delayed file reads use a generation counter. Drag state cancels on Escape, blur, visibility change and drag end. Mobile Add and keyboard Move/Place use the same slot assignment function.
- Advanced mappings, source evidence, synthetic examples and private workspaces live under details controls. The older solver/history UI remains clearly identified as previous workspaces and does not receive a silent copy of the current upload.

## Authenticated manual/AI contract

- `dfs-draft.js` validates version 1 drafts for both browser and Worker. Shape: `{version,pool,roster,preset,settings}`. Roster is an array of nullable player indexes in official slot order. Invalid positions, duplicate identities/slots, unsupported fields and out-of-range settings reject atomically. Incomplete and over-budget exploratory drafts are allowed.
- `dd_dfs_draft` and `/api/dfs/draft` reuse existing personal MCP and browser session authentication. Every path is derived from the verified caller UID. Zero revision creates a new workspace only; other writes require the exact revision and an ETag compare-and-swap.
- Store one `players` array. `builder` stores metadata, roster player IDs and preset/settings; `get.draft` reconstructs the browser shape. Account changes reset bindings. Late loads cannot replace newer local edits. Sparse Firebase arrays and omitted null fields retain unknown states.
- `dfs-entry-bridge.js` accepts only list/load/save requests from the exact iframe, opaque origin and per-session nonce. It whitelists fields, caps payload size and retains auth tokens in the host. No polling or automatic saves. The browser user explicitly saves/loads; an AI uses `get.draft` and `dd_dfs_draft` with the same revision contract.
- Existing APIs and records remain. Pool replacement through old APIs invalidates draft metadata. Draft roster-only saves retain compatible existing candidates; changes to pool inputs invalidate candidates/results. No full audit-history retention is added.

## Conditional simulation

- `dfs-builder-sim.js` reuses the existing nflverse CV/correlation tables and legal roster samplers. `work/dfs-field-sim.js` evaluates a complete modeled field in shared score worlds, with explicit tie boundaries. Captain scoring applies once. No rank scaling or ownership-product duplication probability.
- Defaults: Cash 100 entries/50% paid, Small field 100/20%, Large field 10,000/20%. These are visible illustrative assumptions. Exact overrides live in Fine-tune. Do not silently apply Large Field ownership to cash/small fields. Showdown ownership requires an explicit applicability choice.
- Rates require a legal full roster, complete ownership/projection inputs and acknowledgment of model assumptions. Unknown source time remains disclosed. A verified real-contest match is separate from exploratory model runs.
- Intervals describe score-world Monte Carlo error conditional on one modeled field. They exclude model, projection, field-selection and calibration error. Historical roles versus projection-ranked roles, latent versus lognormal correlations, missing kicker history and normal score tails are limitations. EV/ROI are unavailable in this UI.
- Every material edit synchronously cancels and clears prior results. Seed, assumptions, source evidence and an input fingerprint are in the private export receipt. `dd_dfs_simulate` remains the legacy workspace engine; do not claim it executes this local draft model.

## Validation and release

Synthetic fixtures only belong in the repository. Authorized real CSVs are tested from their private local paths without copying rows into source/assets. Cover CSV quoting/mapping, zero versus missing, percentage units, import/reset races, legal/illegal rosters, CPT/FLEX swaps, touch/keyboard/drag interruption, result invalidation, account isolation, stale/concurrent writes and manual/AI round-trips. Inspect phone and desktop screenshots.

Rebuild the Worker with `cd work && node assemble.mjs`; keep the embedded page engine identical to `work/dfs-engine.js`. Bump `sw.js` using the repository hash convention. Release requires coordinated site and Worker publication and explicit approval. This work never submits contest entries, changes credentials or broadens account permissions.
