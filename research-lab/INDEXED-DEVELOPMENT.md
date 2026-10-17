# V3 private all-position development preparation

This is local preparation. Production remains on its existing manifest pin.
No upload, deployment, archive promotion, permissions or credentials are changed.
The earlier WR-only candidate must not replace the all-position catalog. Activation
requires the exact private full-package inventory and successful population/readback
receipts. The verified V2 full-development package remains a separate all-position candidate.

## Population and meaning

`data/indexed_development.py` verifies the archive size and SHA-256, writes outside
Git, and opens only explicit development members. It never opens 2025 tracking
or career-success values. The default policy `all-position-development-v1` selects every source position
in draft classes 2023 and 2024. Combine rows join those athletes. NFL rows retain
all development seasons 2023 and 2024, including PRE, REG and POST and seasons
different from draft year. Draft year, season, season type and source position stay
separate fields. Games retain all three season types. No WR or rookie-only filter
is implicit. The optional `--policy wr-draft-season-reg-v1` reproduces the narrower
WR study explicitly; it is not the shared catalog population.

All eligible tracking survives, including observations without a player-play
match. The data does not create a synthetic play outcome or infer a missing
player-play match. Source fields are retained, including timestamp strings and
missing values. Added `dd_` columns document the eligibility join. Units and
timestamp timezone remain unverified; career totals and rookie snap share are
not interchangeable. Non-cohort context and ball tracks are outside this population; defenders who
belong to the development cohort are retained. This scope does not establish a route-separation baseline.

## Exact lookup and discovery

Use the existing `dd_owner_bdb_data` tool and existing owner authentication.

1. `{"op":"catalog"}` returns the active version, policy, schemas and manifest
   hash. These examples apply only when an independently approved V3 pin is active.
2. `{"op":"lookup","table":"game_tracking","selector":{}}` discovers seasons.
   Follow returned `children` in order: season, season_type, game_id, play_id,
   nfl_id. Each lookup accepts a complete prefix and returns at most 64 children.
   Follow `nextPage` until null before considering that prefix complete.
3. A complete selector returns `shards`, each with compressed/decoded hashes,
   byte counts, row count and the selected `start`/`count` range. Follow all
   descriptor pages. A play prefix discovers its eligible athletes directly;
   it does not require scanning unrelated artifact contents or knowing IDs first.
4. Use `rows` with `table`, full `selector`, descriptor `page` and `artifact`
   (the compressed SHA-256). It returns at most 100 rows from that descriptor's
   range. Start `offset:0`, follow `nextOffset`, then advance to the next descriptor.
   Optional exact string/null filters apply only within that range.
5. Use `artifact` with the same selector/page/hash for bounded `gzip+base64`.
   Verify the compressed hash, decompress with a strict bound, and verify the
   decoded hash. The shared shard may contain adjacent eligible development partitions;
   use the returned range to select the requested partition. Never deduplicate
   repeated descriptors by hash: repeated occurrences preserve source multiplicity.

Players/combine selectors are draft_year, nfl_id. Game selectors are season,
season_type, game_id. `index` permits bounded metadata discovery by table and
integer child path; ordinary callers can use prefix lookup instead.

## Storage and execution bounds

Rows sorted by partition and original source order are packed into shared gzip
shards, rather than one file per player-play. Each shard has at most 2,048 rows,
1 MiB decoded bytes and 256 KiB compressed bytes. Decompression enforces the
decoded ceiling while streaming, before JSON parsing. Every decoded row is
checked against the manifest-selected development policy before an artifact is
returned, including adjacent partitions in the same shard.

Small metadata pages are inline. Larger lists use immutable pages of at most
64 children/descriptors, with at most 256 pages per entry. The hash trie has at
most six edges, 16 children per branch and 128 entries per leaf; each metadata
object is independently capped at 64 KiB.
An exact lookup needs the manifest, at most seven trie nodes and at most one
external metadata page. Reading rows/artifacts adds one compressed object.
There is no SQL, execution, URL, caller-supplied bucket key or public endpoint.
Owner identity and research/connector grants are rechecked after I/O.

`verify-local-v3.mjs` traverses prefix and descriptor pagination, validates all
compressed/decoded hashes and every selected row range, checks representative
lookup/row pagination, and produces a private inventory. Shared shards are decoded
once while every descriptor occurrence is retained. `data/verify_indexed_population.py`
separately compares sorted SHA-256 fingerprints of every original-column row
occurrence against the pinned V2 full export, preserving duplicate multiplicity
and checking the added eligibility joins. It is an offline readback, not
an authenticated live-client proof. Synthetic tests cover holdout boundaries,
all-position PRE/POST/cross-draft-year retention, explicit WR-study filtering, missingness, unmatched retention, deterministic
output, schema drift, empty tables, repeated references, bounds and corruption.

## Activation boundary

Review the final code, dependency/runtime receipt, exact private inventory,
selected population and missing contextual/outcome definitions first. Separately
approve upload of that exact inventory, verify every stored object, and approve
the packaged Worker release plus exact manifest pin. Raw archive promotion is a
separate action. Do not expose this version simply because local tests pass.

## Research readiness gate

The shared catalog is all-position development data. A WR drill/separation audit is
one filtered study, not the population contract and not a fitted baseline.
Descriptive counts, missingness, source identity and join coverage are available.
Predictive fitting remains blocked on these specific definitions and evidence:

- Authoritative units/time conventions for tracking x/y/s/a/dis and source time,
  and the definition of separation_at_pass_forward. No conversion or derived
  physical threshold is justified by the column names alone.
- Verified drill protocols and cut-phase/event labels. Source year-specific tags
  remain distinct; observed trials do not establish completed standardized trials.
- A position-appropriate target, observation window and exposure denominator.
  Player-play rows alone do not establish full snap share; career totals are
  excluded and cannot substitute for rookie outcomes. Source selected-player
  tracking does not establish complete ball/defender context.
- Historical coverage, timestamp provenance, authoritative dictionaries and ID
  mapping for any proposed PFF/ETR/nflverse join. Existing project documentation
  establishes prior ranking/projection and nflverse-derived work, not a verified
  current private raw-data inventory or a join-ready 2023-2024 panel.

Resolve these before selecting model features or fitting a baseline. Keep 2025
sealed. Any later study must pin its target, cohort/filter, temporal split, missing
value treatment, baseline comparator and source hashes before evaluation.
