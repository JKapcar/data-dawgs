# Private development data reader (review candidate, disabled)

`dd_owner_bdb_data` reuses the personal owner MCP connection and the existing research
permission. It adds no grant, credential, public route, SQL, execution or upload API.
The new flag and manifest pin are intentionally absent from `wrangler.jsonc`.
Deploying this code alone does not expose data. Dispatch UI is outside this change.

## Prepared scope

`data/development.py` verifies the exact source archive size and SHA-256 before reading
only `players.csv` and `combine_results.csv`. It retains draft classes 2023 and 2024.
Mixed CSV records must be parsed to find their partition cell; other classes' measurements
are not analyzed or exported. No 2025 tracking member is opened. The archive is unchanged.
Outputs are refused under any Git checkout and contain restricted data: never commit,
attach to a PR, or upload to public artifacts. The producer does not contact any server.

All cells stay strings or explicit null, without unit conversions or imputation.
The catalog reports per-column missing counts and **unverified** units: the archive
contains no unit dictionary. In particular, `combine_position` is not `position`,
and career offensive snaps are not rookie-season offensive snap share. Tracking,
game/play tables and career outcomes are explicitly unavailable in this first slice.
This supplies real combine data for inspection, not a complete baseline-ready dataset.

## Contract

- `{op:"catalog"}` returns the pinned manifest, schemas, missingness and artifact IDs.
- `{op:"rows",artifact:"<catalog SHA-256>",filters:{draft_year:"2023"},offset:0,limit:100}`
  returns exact-match filtered rows from one artifact. Filters accept strings or null
  and at most four known columns. Pagination is within that artifact; iterate catalog
  artifacts for the table. Limit 1-100; offset 0-256.
- `{op:"artifact",artifact:"<catalog SHA-256>"}` returns exact UTF-8 canonical JSON text
  and its SHA-256. This text reproduces the input bytes; no signed download URL exists.

The server accepts only catalogued hashes, never caller-supplied keys or URLs. Manifest
reads are capped at 64 KiB; each artifact at 128 KiB / 256 rows. Hashes are checked on
every read, and each row must have draft year 2023 or 2024. Owner identity, tenant owner
access, current app permission and connector authentication are checked before returning
data, including a second permission read after R2 I/O. A read already returning cannot
be recalled. Every client holding an authorized owner credential would have the same
data access; assistant labels are not independent identities.

R2 keys are derived solely from configured owner/tenant, the fixed source digest, and
the approved manifest or catalogued artifact digest:

`development/<owner>/<tenant>/<source-sha256>/<object-sha256>.json`

## Separate approval needed before activation

1. Review/merge the draft; approve deployment of the packaged Worker built by
   `build-worker.mjs`. Do not deploy the unwrapped root Worker.
2. Approve copying the locally prepared manifest and four data objects into the existing
   private R2 bucket at the exact prefix above. Verify each remote object's bytes/hash.
   No bucket-policy change, new grant or new credential is needed.
3. Approve widening the existing owner connector to this development-only slice, then
   set `RESEARCH_DEVELOPMENT_DATA_ENABLED=true` and
   `RESEARCH_DEVELOPMENT_MANIFEST_SHA=6ca60e1ac3e84350dabef39d7d5104b8cb88c2e06c5842c924b5a776eac7a181`
   in the complete release configuration. Until then the tool is undiscoverable and denied.
   This is a distinct action-time approval, not inferred from an existing metadata grant.
4. Through each actual supported client, verify catalog, filtered rows and an artifact
   hash. No success is claimed for dot, Claude, Gemini, Grok or Muse yet.

Disable the new flag to stop this read surface; existing app revocation also stops it.
Preserve the source archive and resolve its separate durable-copy status. This data
slice does not promote or replace the original archive.

## Local evidence, 2026-10-17

Source: 512,718,566 bytes, SHA-256
`27d52f594d6d31d4f617f9c94b0b37d11e280397ad8293c0987da5f91a8d0ced`.
Local preparation produced four data artifacts: 337 development players and 337
development combine rows. All 674 rows were paged through the production reader locally,
and every exact artifact read matched its hash. Restricted payloads remain outside Git.
This is local real-data proof, not hosted/provider proof. Unit verification is still open.

Live storage inspection used the existing authenticated Wrangler CLI on 2026-10-17.
The historically recorded quarantine object was downloaded privately and matched both
source size and full SHA-256. The expected `datasets/<owner>/<source-sha256>.zip`
durable key returned "The specified key does not exist." Current lifecycle rules still
expire `quarantine/` objects after 30 days and abort incomplete multipart uploads after
7 days; no completed-object expiration rule covers `development/`. No storage writes or
configuration changes were made. A current authenticated owner-MCP metadata read was
unavailable in this execution environment; do not infer promotion from source code.

Validation: 44 reader/owner unit tests, four exporter tests and seven packaged Worker
MCP/R2 tests passed. Packaged runtime tests required sandbox escalation because workerd
could not start inside the Windows sandbox. The browser automation runtime failed before
opening a tab, so no provider-account connection was verified.


## Exact scope and activation inventory

The 674 rows are **all eligible rows**, not samples: 337 rows from each of the two
source tables with draft_year exactly 2023 or 2024, with all original columns. The
exporter applies no position filter, completeness exclusion, row sampling or truncation;
nulls are retained. Chunk sizes are 256 + 81 per table. This is not 674 distinct athletes
and does not mean all development project tables are accessible.

Private bucket: `datadawgs-research-private`.
Exact common object prefix (append each filename below):

`development/u_y9Pgnfml5AlhtotzlailibDR/jason-bdb/27d52f594d6d31d4f617f9c94b0b37d11e280397ad8293c0987da5f91a8d0ced/`

| Object filename | Content | Bytes |
|---|---|---:|
| `6ca60e1ac3e84350dabef39d7d5104b8cb88c2e06c5842c924b5a776eac7a181.json` | Manifest | 3405 |
| `dc0cc7639b41231b46293047c09a5066d2a8f1d6692e8191bb870578e76f8e02.json` | Players, 256 rows | 68231 |
| `94fd69feec4a8f326765127ba1185c1966355545abb04cc4794cb3e9231c963d.json` | Players, 81 rows | 21898 |
| `86dec011a902a6438323f60a6d1aeb4870702a9a68c4bbcd5eb8e30971bdb0c8.json` | Combine results, 256 rows | 100132 |
| `348ad1a7c12dc1a82ea47d2798f3510ae11bd680cb5a6abb6a374e5dc3d7e629.json` | Combine results, 81 rows | 31910 |

Each filename stem is the expected SHA-256 of the exact UTF-8 file bytes. None is a
public URL. The original archive is not one of these five objects.

Existing prerequisites remain unchanged: `RESEARCH_LAB_ENABLED=true`, owner
`u_y9Pgnfml5AlhtotzlailibDR`, tenant `jason-bdb`, and the existing `RESEARCH_UPLOADS`
binding. The tenant envelope must already grant this user enabled owner access with
`research:read` and no expired owner access, and `ownerConnector` must already be enabled
for this owner with a valid existing persistent or unexpired timed permission. The
change never creates, renews, extends or upgrades those records.

**Audience is account-wide, not five-client-only.** Both the owner's primary MCP key and
any labeled key authenticate as the same owner. `keyLabel` and assistant labels are not
checked by this reader. Enabling the flag exposes the slice to every current or future
holder of a valid owner MCP key while that same research permission is on, including
clients other than dot, Claude, Gemini, Grok and Muse. It does not grant another user,
a shared pass, or a delegated `da1_` agent access. Restricting this to five named clients
would require a separate reviewed authorization design; labels alone cannot prove
provider identity. The flag does not install or contact any provider.

## Remaining full-development-data work (not included or activated)

A cards-only activation does **not** fulfill full project-data access. Keep PR284 a
reviewed first slice; prepare and review the following expansion before calling the
project data shared. No new table is read or exposed merely by approving this plan.

1. Freeze a partition contract distinguishing draft class from game season. Use the
   2023-2024 player identity set for the target cohort; fail closed on unknown/ambiguous
   joins. No 2025 class measurements, 2025 games, or 2025 tracking member may enter.
2. Add full `combine_tracking` for draft_year 2023-2024, preserving event, athlete,
   drill, attempt and time keys. Stream/export every eligible row. Confirm units and
   timing conventions against an authoritative dictionary before numerical analysis.
3. Build a development `games` index from season 2023-2024. Export eligible `player_play`
   rows only after the game and cohort checks, inspecting partition/join cells before
   measurement fields. Add `game_tracking_2023` and `_2024` for the same allowed games
   and players; do not open `_2025`. If a study needs the ball, defenders or other
   contextual players outside the target cohort, define and separately review that
   context policy before including them. Reject orphan IDs rather than guessing.
4. Keep `player_career_successes` unavailable until its time horizon is verified. It has
   no year column, and career totals for a 2023/2024 draftee can include later seasons.
   Joining on a development player ID alone cannot establish a 2024 cutoff. Require a
   documented permitted outcome horizon or construct season-bounded outcomes from
   eligible play data. Never relabel career totals as rookie snap share.
5. Replace the current small flat catalog with hash-pinned paged indexes by table and
   event/game/play/athlete. Preserve per-call byte/row bounds and exact artifact hashes;
   do not raise the 32-artifact limit and scan the entire corpus per request. Add bounded
   indexed filters, complete pagination, join-coverage/missingness/unit receipts and
   artifact lineage. No SQL or public downloads are needed.
6. Test synthetic mixed-season and mixed-class adversarial fixtures, unknown joins,
   contextual-entity exclusions, holdout-member non-opening, timestamp cutoffs, complete
   pagination, corrupted/missing pages, auth revocation and response limits. Then run
   local real-development proof without outputting data, review the new exact manifest,
   approve its private upload/pin separately, and prove reads in each actual client.
