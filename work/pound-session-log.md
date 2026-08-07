# The Pound staging checkpoint log

Local branch: `codex/the-pound-staging`
Production writes: forbidden for this session
Started: 2026-08-07 ET

## Checkpoints

- Safe baseline: fetched `origin/main`, verified the deployed 13-tool surface, reset tracked files to `893519f`, and created the local branch. Preserved `Data-Dawgs-homepage-taxonomy.patch` and `tmp/` untouched.
- Reconnaissance: confirmed the handoff's Worker/backup work had already landed; found generator drift (`tools/build-data.js` still described 11 tools while the shipped surface described 13).
- Provenance/contracts: added generated upstream provenance, common model/calculator contracts, and a complete Pound tool inventory with exact statuses and blockers.
- Calculator core: added pure deterministic implementations and Node assertions for odds, parlay, vig, EV, hedge, passer rating, 538-style one-game Elo, normal translation, forecast grading, and consensus statistics.
- Human surface: staged the native Pound workbench, dated Week 1 two-input scoreboard, all ten calculator cards, 22-entry status inventory, 12-project provenance shelf, machine overlay, shared navigation, sitemap and `llms.txt` discovery.
- Browser QA: exercised the odds calculator and status filter, confirmed all ten default calculator results, 16 scoreboard rows, 22 inventory entries, 12 provenance entries, labelled controls, valid defaults, responsive single-column cards and clean Pound console output. Opened all 19 changed HTML pages and verified their Pound navigation and duplicate-ID state.
- Regression QA: data envelopes/manifest, Pound unit and contract suites, draft provider/league tests, Worker MCP (85), identity (62), backup (14), solver (38) and simulation (15) assertions all passed. Made the identity suite's temporary bundle path portable on Windows.
- Offline integrity: added `/pound.html` to the service-worker core and set `VERSION` to the first ten hex characters of the staged sorted 21-page HTML MD5 (`1de0c64530`).
- Owner review pass: corrected EV display precision, made cover inputs follow explicit sportsbook line convention, preserved the site’s published 0.5-point win threshold with a clearer disclosure, allowed legitimate negative passing-yard lines while rejecting fractional stats, renamed the unvalidated “consensus” display to an equal-weight belief summary, separated every blocker from its actionable minimum path, and changed not-installed MIT packages from `direct` to `pending` integration status.

## Invariants carried forward

- No secrets or private league data.
- No server handling of paid DFS projections/ownership.
- No code copied from an upstream repository without a verified reusable license.
- Backtests, modelled output, simulation and ungraded state remain visibly labelled.
- No push, PR, commit, deploy, Cloudflare/Firebase write, purchase or external message.

## Backend activation â€” Batch 1

- Branch: `codex/pound-backend-batch-1`, based on verified production commit `17b4faa`.
- Added eight deterministic, read-only MCP tools in the generated Worker block: odds conversion, proportional devig, parlay price multiplication, caller-supplied bet EV, equal-net hedge sizing, NFL passer rating, one-row forecast scoring and equal-weight belief summaries.
- The tools accept only bounded, validated inputs; they call no network service, persist no input and perform no production write.
- MCP parity coverage compares every calculation with `work/pound-core.js`; the expanded suite passes 122 assertions.
- Public metadata uses `ready`, not `live`: Worker deployment and a real production MCP conformance call remain required before the eight tools move into `tools_live` or `complete`.

## Production activation — 2026-08-07

- Deployed commit `51c7f3d` to Cloudflare Worker `toto` as version `b7eb9dfd-450c-4a2b-bdab-723b2de706bf`.
- Strict deployment preserved compatibility date `2026-07-31`, the `RL` KV binding, the daily `0 9 * * *` backup cron, dashboard variables, encrypted secrets, disabled preview URLs, Workers Logs and the 1,000 ms CPU limit.
- Production verification confirmed the active version and deployment message in Cloudflare, all eight tool registrations in the deployed bundle, the public streamable-HTTP MCP route, and the `401` authentication boundary for anonymous initialization.
- No league credential was inspected or requested. Calculator behavior remains covered by the 122-assertion MCP suite and parity checks against `work/pound-core.js`; deployment verification does not turn deterministic arithmetic into a graded forecast or a live market feed.
