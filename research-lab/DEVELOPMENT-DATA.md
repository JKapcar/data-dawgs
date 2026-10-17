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
  artifacts for the table. Limit 1–100; offset 0–256.
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

Validation: 42 reader/owner unit tests, two exporter tests and seven packaged Worker
MCP/R2 tests passed. Packaged runtime tests required sandbox escalation because workerd
could not start inside the Windows sandbox. The browser automation runtime failed before
opening a tab, so no provider-account connection was verified.
