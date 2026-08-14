# NFL player identity backbone

This is Phase 1 of the Data Dawgs player-value architecture. It creates a canonical NFL identity layer before PMV, DFV, trade-market or projection signals are allowed to join.

## Contract

The pipeline publishes two machine-readable surfaces when refreshed:

- `/data/nfl-players.json` — current canonical NFL player identity.
- `/data/nfl-player-snapshots.json` — append-only metadata ledger for every distinct published identity snapshot.

A player enters this registry only when nflverse supplies a `gsis_id`. Data Dawgs does not assign a name-based or row-order ID to unresolved prospects. College/prospect identities will be bridged separately.

`dd_player_id` is deterministic:

```text
DD-NFL-<first 16 lowercase hex of SHA-256("dd-player-id-v1|gsis|<gsis_id>")>
```

That identifier is stable when source row order, names, teams or other descriptive fields change.

## Source and rights

The source is the `players.csv` asset from the `players` release in `nflverse/nflverse-data`. The refresh reads GitHub release metadata first, requires the release asset's SHA-256 digest, downloads the asset, and verifies the downloaded bytes against that exact digest before parsing.

The `nflverse-data` repository is licensed CC BY 4.0. Data Dawgs classifies this source as **OPEN** for this pipeline and records attribution, license, source asset ID, source digest, source update time, capture time, and the normalization performed. This classification applies to the nflverse release used here; it must not be copied onto unrelated future sources by analogy.

## Fields

Phase 1 intentionally publishes identity and slow-moving biographical/draft fields, not fantasy-market judgment: Data Dawgs ID; names; position; birth date, height, weight; college; rookie and last season; latest source-reported NFL team/status; draft fields; and GSIS, ESB, NFL, smart, PFR, PFF, OTC and ESPN IDs when present.

Missing provider IDs remain `null`. The pipeline never fabricates a crosswalk. Envelope-level `field_provenance` records which fields are upstream versus Data Dawgs-derived.

## Snapshot semantics

`integrity.snapshot_id` is a SHA-256 over canonical JSON for the ordered `data.players` array. A distinct hash is appended to `nfl-player-snapshots.json` with capture time, exact upstream asset digest/update time, player count, source row count, skipped non-GSIS rows, and player-ID contract version.

Repeated refreshes producing the same canonical player array are idempotent. Existing snapshot rows may not be removed, reordered or mutated. Git history retains full historical versions of `nfl-players.json`; the ledger gives future PMV/DFV receipts stable snapshot references.

## Fail-closed checks

Refresh or validation fails on missing core source columns, missing/mismatched release SHA-256, duplicate GSIS IDs, Data Dawgs ID collisions, suspicious player counts, malformed IDs, snapshot hash drift, rights metadata drift, or mutated snapshot history.

## Run locally

```powershell
python scripts/nfl_player_backbone.py refresh
node tools/data-manifest.js
python -m unittest tests.test_nfl_player_backbone
python scripts/nfl_player_backbone.py validate
python scripts/nfl_player_backbone.py verify-history --base-ref origin/main
node tools/validate-data.js
```

Before first publication, PR validation uses `validate --allow-missing`. The scheduled refresh creates the public surfaces, regenerates the manifest, validates them, and sends changes through the existing review-PR workflow. It does not write directly to `main`.

## Explicit non-goals for Phase 1

No PMV, DFV, Dawg Edge, ADP, ECR, Sleeper trade values, projections, injuries or college/prospect rows are blended here. Those layers join through `dd_player_id` after this identity contract exists.
