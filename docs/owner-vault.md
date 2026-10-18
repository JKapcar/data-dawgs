# Owner-only vault files — draft, disabled

This replaces the setup-only storage refusal with a default-off owner file API and
catalog. No bucket, account, credential, sharing grant, rule or deployment is created.
The older local general-sharing prototype is not migrated or enabled. The public
repository contains only source, synthetic tests and this contract, never imported files.

## Narrow boundary

Only POST `/api/vault` accepts file operations. `/api/vault/*`, `/mcp/vault` and every
MCP suffix are intercepted and refused. There are no public URLs, Access operations,
invitations, external-AI tools, delete, folder creation or account discovery.
`VAULT_ENABLED` and `VAULT_SHARING_ENABLED` are committed as `false`. Even if sharing
is set true, this owner-only implementation refuses all file operations.

Activation needs a private `VAULT_BUCKET` and a verified immutable `VAULT_OWNER_UID`.
Authentication reuses `poundIdentity`: strict Authorization Bearer **existing signed
site session**, signature/expiry and exact live account/password-version verification.
Legacy credential headers (including empty headers), general MCP tokens and conflicting
credentials are rejected. The private UI never calls the old X-Dawg-Session self route.
It clears file bytes, selection and rendered metadata when hidden, navigating or switching
accounts. Private content is not stored in localStorage or CacheStorage.

Authorization is rechecked after reading the request, after metadata/R2 reads, before each
R2 write and catalog CAS, and before returning private data. Revocation already visible at
those checks blocks the operation. Account state and catalog are distinct backend records:
an already-authorized CAS in flight can finish after a concurrent password revocation.
A final recheck may then refuse the response even though a commit succeeded; the durable
receipt resolves that ambiguity after the owner signs in again. This is not a cross-store
atomic revocation guarantee. No session, body or private error detail is logged by this code.

## Contract and immutable history

Envelope: `{op,args}`; unknown keys/ops/query parameters are refused. All replies are
private/no-store and all bytes are JSON/base64; the UI downloads octet-stream blobs,
never renders HTML/PDF/SVG as active previews. Main is the only folder.

| Operation | Arguments | Result |
| --- | --- | --- |
| status | `{}` | verified owner UID, limits, sharing false |
| list | optional `after` file ID | up to 50 files, all immutable versions per file, `next_after` or null |
| stage_upload | `request_id,name,sha256,size,data_base64`; append also needs `file_id,expected_version` | staged or replayed committed receipt |
| commit | `request_id` | durable receipt; identical committed retry returns `replayed:true` |
| receipt | `request_id` | staged/committed state, exact IDs/hash/size and commit time |
| read | `file_id,version_id` | hash-verified exact bytes, metadata and receipt |

Every ID is 64 lowercase hex characters. For an upload, form **exactly this property order**:

```js
const metadata = {name, sha256, size, file_id: fileId || null,
                  expected_version: expectedVersion || null};
const request_id = sha256hex(UTF8(JSON.stringify(metadata)));
```

The server validates the ID against these canonical bytes. New file ID and version ID
are the request ID. An append uses the selected existing file ID and a new request ID as
version ID. Duplicate imports with identical name/bytes/append target and expected version
therefore recover the same request across lost responses, reloads and processes. Changing
metadata under the old ID is a conflict. Different names remain distinct files; the import
manifest preserves source identities even when exact duplicates reuse one stored file.

R2 bytes live under `owner-vault/v1/<uid>/sha256/<sha256>`. Only verified bytes matching
the key may be written. RTDB `/ownerVaults/<uid>` stores an owner-pinned exact JSON payload
with catalog, immutable version metadata and durable stage/commit receipts. ETag/If-Match
atomically publishes a version and its receipt. Concurrent identical commits publish once;
concurrent distinct appends quoting the same head have one winner and one409. Old versions
are never overwritten. Catalog entries never appear until staged bytes have been read back
and SHA-256 verified. `read` verifies size/hash again.

Limits: 8MiB per file, 2MiB metadata envelope, 2,000 retained requests and at most eight CAS
attempts per request. Receipts are never silently evicted; capacity exhaustion fails closed.
One catalog page can include a file's full version history, bounded by the envelope cap.
Pagination is by stable file-ID ordering, not a frozen snapshot: concurrent newly inserted
IDs preceding the cursor require a fresh scan. Import verification must retrieve exact IDs,
not infer success from one scan. This is a small private file vault, not a relational job DB.

## Import and retention

Upload only reviewed sanitized files. Preserve original workbook/resume provenance, source
dates and SHA-256 in the private manifest. Use the UI's existing-file selection for deliberate
updates; compare the current head/hash first. Exact current bytes are verified and reused.
After commit, read exact file/version bytes and compare hash/size before recording success.
On interruption retry the same request ID; never invent a new request for an uncertain write.
Client batches are sequential but not transactional: already verified files survive a later
failure and retry is idempotent. A conflict requires refreshing and a deliberate new append.

Stage reservations and uncommitted content-addressed bytes are retained for retry recovery.
There is no pending-prefix TTL or cleanup in this format. Do not apply the old prototype's
pending lifecycle or expire the hash prefix. No migration from prototype/RoboKap/research
storage is performed. New storage must be empty or already use this exact format; other
formats fail closed. Review eventual orphan cleanup and archival separately.

Both general RTDB backup copies exclude `ownerVaults`, preventing indefinite general-backup
retention of filenames/provenance/receipts. No new vault backup policy or deletion is enabled.
The private R2 bytes and active catalog are durable but have no independent backup in this
draft; original import sources must be retained. A separate private backup policy is future
approval work. Existing backups and unrelated stores remain unchanged.

## Bounded activation approval

Not ready for activation merely because CI passes. Before requesting approval:

1. Review the exact PR/commit and passing generated Worker, real R2, identity/revocation,
   concurrency/retry, checksum, cache, backup-exclusion and mobile-browser tests.
2. Verify Kap's immutable UID using his existing signed-in session; do not infer it from
   display name or a research grant. Confirm published RTDB rules deny direct client reads
   and writes to `/ownerVaults`; inspect actual logging destinations for credentials/body
   capture. Do not change rules or global logging as a side effect.
3. Verify a dedicated private R2 bucket (no r2.dev/custom-domain public access), capacity,
   costs and retention. Creating/binding it requires explicit approval; no broad developer
   token permission or new credential is necessary for owner browser access.
4. Request approval for the exact Pages merge and packaged Worker release with the complete
   existing manifest, confirmed owner UID/bucket and `VAULT_ENABLED=true`, while sharing,
   Access and MCP stay closed. No other flags or apps are part of this approval.
5. After approved activation, verify anonymous/other-user denials and a synthetic private
   stage/commit/readback. Then import the reviewed sanitized package and record exact IDs,
   hashes and byte readback receipts. An unavailable identity/browser remains a blocker;
   do not extract cookies or silently substitute another private app.

Disable `VAULT_ENABLED` to close access without deleting bytes/history. Never clear the
catalog or mint replacement IDs as rollback. No production import occurred in this PR.
