# Private development reader, version 2 (preparation only)

The existing production manifest remains pinned to its version 1 player/combine
slice. This change does not upload, activate, deploy, promote the archive, alter
permissions, or change that pin. Version 2 requires a separate approved release
and a verified private object upload before a manifest change.

## Local preparation

`data/full_development.py` verifies the original archive size and SHA-256 and
requires an output directory outside Git. It streams only named development
members. Mixed tables are partitioned before retained values are processed;
`game_tracking_2025` and `player_career_successes` are never opened.

The exporter retains all eligible rows and source fields, including missing
fields. Empty/NA tokens become explicit nulls; other cells remain strings. Source
order is retained. It does not deduplicate, impute, convert units, or calculate
outcomes. Derived `dd_season` and `dd_draft_year` identify the eligibility joins.

| Table | Eligibility | Join / candidate observation key |
| --- | --- | --- |
| players | draft_year 2023 or 2024 | nfl_id |
| combine_results | same draft years and matching players | nfl_id |
| combine_tracking | same draft years and matching players | draft_year, event_id, nfl_id, drill_type, drill_name, attempt, time |
| games | season 2023 or 2024 | game_id |
| player_play | eligible game and athlete | game_id, play_id, nfl_id |
| game_tracking | explicitly named 2023/2024 members, eligible game and athlete | game_id, play_id, nfl_id, time |

Context policy is `development-cohort-only-v1`: exclude ball tracks and players
outside the development cohort. Games retain season context. Player-play is
preserved as player-level data, not a fabricated one-row-per-play table. Tracking
does not require a player-play match; use a left join and account for unmatched
observations explicitly. An audit of join completeness must accompany a model.

`time` is the source timestamp, not `frame_id`. Observed timestamps have
millisecond precision without a timezone suffix. Neither timezone nor coordinate,
speed, acceleration, distance, timing-test, height or weight units have been
verified from an authoritative dictionary. Do not infer units from column names.
Per-field missing counts are in the manifest. The original misspelling
`visitor_team_win_probility_added` remains unchanged.

## Bounded traversal and reproduction

1. Call `dd_owner_bdb_data` with `{"op":"catalog"}`. Record the manifest hash.
2. For each table call `{"op":"index","table":"game_tracking","path":[]}`.
3. If the result has `children`, visit each child with its zero-based index
   appended to `path`. Every child is a hash pinned by its parent. Traverse all
   children, including the final partial page. Maximum depth is six.
4. A leaf lists `artifacts`. Call `rows` with the same table/path and one listed
   artifact hash. Start `offset:0`, follow `nextOffset` until null, then advance
   to the next artifact. Exact string/null filters apply only within that
   artifact; a full filtered scan must visit all leaves and artifacts.
5. `artifact` with the same table/path/hash returns exact UTF-8 JSON text and its
   SHA-256. Verify the hash before persisting or analyzing it privately.

Every request reloads the pinned manifest, verifies each selected index node,
and permits only the hash reached through that table's index. There are at most
seven index reads, a 64 KiB limit per index/manifest, a 128 KiB artifact limit,
256 rows per artifact and 100 returned rows per page. There is no SQL, URL,
arbitrary object key, execution, or public data endpoint. The existing owner
identity and research grant checks (including the post-I/O recheck) remain in
force. An assistant label is not an identity or permission grant.

## Validation and activation boundary

Synthetic exporter tests enumerate a multi-leaf table in full, check hashes,
missing values, deterministic output, holdout exclusion and Git-output refusal.
Reader tests cover traversal, pagination, filters, bounds, hash corruption and
hash-valid holdout rejection. Packaged MCP tests cover both catalogs, existing
owner credentials, other-user/shared denial, revocation and absence of writes.
These tests are not evidence that any live client imported or called the tool.

Before activation: review the final commit; inspect the private manifest and
exact object inventory; verify every uploaded object's bytes and SHA-256 using
the already-authorized private binding; approve the packaged Worker release
and exact new manifest pin. Archive promotion/copy is separate and excluded.
No credential creation, new grants or broader persistent access is required.

The historical rookie-snap-share baseline is blocked: the source lacks that
label, and career snap totals do not supply it. A valid baseline needs a declared
estimand, an authoritative unit dictionary and an approved outcome construction
with a denominator and season/rookie boundaries. Do not report a substitute
combine correlation as that baseline or a client success.
