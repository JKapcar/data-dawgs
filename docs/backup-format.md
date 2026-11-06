# General backup format

The daily backup reads RTDB once and excludes private Pound, Jobs and research
sections from both general copies. Private copies retain their existing formats
and 30-day expiration. General dated copies retain 180-day expiration; latest
has no expiration. No old dated copy is deleted by this change.

General JSON values up to 25 MiB retain `{taken, db}`. Larger values use a JSON
envelope with `format: "dd-backup-gzip-v1"`, `taken`, `uncompressedBytes`,
`sha256` and a base64 `payload`. Decode base64, gunzip, verify the exact UTF-8
byte count and SHA-256, then parse the original `{taken, db}` JSON. Check the
inner and outer timestamps match. Never restore the compressed envelope itself.

Preparation and size checking happen before writing either general key. A value
that remains above 25 MiB after compression fails visibly and leaves previous
general copies intact. Compression is not unlimited capacity: future growth may
require a separately reviewed storage migration. Private-copy failures can still
occur after general copies succeed; backup health covers the complete run.

`node tools/verify-backup.mjs` uses existing Cloudflare authentication to read both
latest general copies and same-day private copies in memory. It verifies decoding,
checksums, byte equality, timestamps, private-section exclusion and JSON structure.
It emits aggregate metadata only. It does not write data or prove a production
restore. Research archive objects are not part of these KV copies.

The approved November 6 incident retry uses the existing five-minute cron and a
private `backup-retry:2026-11-06` marker. Only `{ "status": "pending",
"incident": "kv-size-20261106" }` opts in. It claims the request before executing;
complete, started and failed markers do not retry automatically. Inspect evidence
before re-arming an uncertain attempt. The gate expires at November 7 00:00 UTC;
there is no HTTP route, new schedule, credential or configuration change. KV is
eventually consistent, so this is an operational single-attempt gate, not a
distributed exactly-once lock. Only one active deployment should be armed.
