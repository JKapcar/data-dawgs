# Private DFS journal — September 2026

User-authorized amendment: the DFS page may now persist original subscriber inputs and contest records privately when the signed-in owner presses Save. This replaces the prior on-device-only constraint for this explicit workflow. No subscriber CSVs belong in the public repository or /data. Public and MCP discovery do not expose saved records.

## What ships

- POST /dfs/private creates immutable UUID records in existing RL KV, scoped only to authenticated immutable UID. No update or public-read route.
- Snapshot: original uploaded CSV history, parsed slate, lineup pool, entered DK Entry IDs, exact payout tiers supplied by the user, settings, simulation output and run configuration/seed, embedded engine source, model label, server timestamp and SHA-256.
- Results: server parses original standings CSV, links parent snapshot hash, matches Entry IDs and rosters, grades points, slot ownership, duplicate counts, winnings and net. Original snapshot is unchanged.
- Read/list requires the same account. UI supports reopening, restoring, and a private JSON backup download.

## Important bounds

Server timestamps are not independently verified pre-lock registration: contest ID/lock time are user supplied. Recording entries does not submit them to DraftKings. Replaying on a changed engine may differ; the original engine source, run configuration, seed, and outputs are retained.

The server accepts at most 8 MB per JSON record; the UI limits standings CSVs to 7 MB to leave JSON overhead. Larger contests require a future chunked-upload path; never trim a field and call it complete. KV list/read is eventually consistent; a newly saved item may take time to appear on another device.

A full matching row count and unambiguous roster resolution are required before reporting field ownership. Missing entries, captain changes, unrecognized names, duplicate entry IDs, zero scores and zero winnings are handled explicitly. Actual duplicate counts exclude the entry itself; incomplete counts are labeled lower bounds. Payouts use CSV winnings when present, otherwise explicit complete payout tiers with tie splits. No generic simulator payout curve is passed off as actual winnings.

Raw standings and outputs remain private. Estimates of duplicate counts remain priors. Sample outcomes alone do not establish calibration.

## Deployment

This changes the toto Worker as well as the page. Follow docs/worker-deploy.md, including its fresh owner authorization for moving Worker traffic. Deploy the approved backend before publishing the frontend. No bindings, secrets, cron schedules or public data files change.

## Verification

node work/test-dfs-ledger.cjs
node work/test-dfs-private.cjs
node work/test-dfs-page.js

The Worker release gates in docs/worker-deploy.md also apply. End-to-end DOM integration was exercised against the production route with isolated fake storage, from ETR upload through saved snapshot, restoration and server-side standings grading.
