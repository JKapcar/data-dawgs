# V3 private all-position development preparation

This is local preparation. Production remains on its existing manifest pin.
No upload, deployment, archive promotion, permissions or credentials are changed.
The earlier WR-only candidate must not replace the all-position catalog. The corrected
all-position code is synthetic-tested; its full real-data V3 package is not yet built.
The existing verified V2 full-development package remains a separate all-position candidate.

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
most six edges and 16 children per node; each metadata object is at most 64 KiB.
An exact lookup needs the manifest, at most seven trie nodes and at most one
external metadata page. Reading rows/artifacts adds one compressed object.
There is no SQL, execution, URL, caller-supplied bucket key or public endpoint.
Owner identity and research/connector grants are rechecked after I/O.

`verify-local-v3.mjs` traverses prefix and descriptor pagination, validates all
compressed/decoded hashes and selected row totals, checks representative row
pagination, and produces a private inventory. It is an offline readback, not
an authenticated live-client proof. Synthetic tests cover holdout boundaries,
all-position PRE/POST/cross-draft-year retention, explicit WR-study filtering, missingness, unmatched retention, deterministic
output, schema drift, empty tables, repeated references, bounds and corruption.

## Activation boundary

Review the final code, dependency/runtime receipt, exact private inventory,
selected population and missing contextual/outcome definitions first. Separately
approve upload of that exact inventory, verify every stored object, and approve
the packaged Worker release plus exact manifest pin. Raw archive promotion is a
separate action. Do not expose this version simply because local tests pass.
