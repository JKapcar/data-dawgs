# Private Pack portrait attachments (disabled by default)

Portraits attach to an existing RoboKap context or roster ID. They do not edit names, authored context text, its versions, task records, or another agent's claims. No seed IDs or real portraits are included. `POUND_PORTRAITS_ENABLED=false` in the complete deployment manifest; release and activation require separate approval. No new credentials, grants or buckets are introduced.

## Owner transport and schema

Existing signed site-session authentication only: `Authorization: Bearer <site session>` over HTTPS. The existing `poundIdentity` verifier rejects personal connector credentials, shared passwords, conflicting headers and revoked accounts. There are no new agent write tools; an agent may describe this workflow or prepare an image but cannot use owner credentials. The user uploads through RoboKap. No token or signed image URL belongs in a reference, chat, log or query string.

`GET /pound-portraits/v1/{contexts|agents}/{existing_p_uuid}` returns schema version 1, current workspace `revision`, target, limits, attachment metadata and `active` (latest ready request ID or null). Both workspace ownership and an existing unarchived target are required. `portraits[]` contains request_id, expected_revision, status (pending/ready), sha256, size, width, height, type, alt and created_at. No R2 keys or bytes appear in this response.

`POST` to that same path accepts one JSON object, with no additional fields:

```json
{
  "expected_revision": 7,
  "request_id": "unique_16_to_80_char_key",
  "alt": "A concise description of the portrait",
  "png_base64": "<normalized PNG bytes, base64 without a data URL prefix>"
}
```

`expected_revision` is a nonnegative integer from the latest read. `request_id` contains 16–80 letters, digits, underscores or hyphens. `alt` is 1–200 characters with no control characters. PNG bytes are at most 512 KiB, at most 1024 pixels per dimension and 1,048,576 pixels total. The browser accepts PNG/JPEG/WebP files up to 8 MiB and 16 million decoded pixels, resizes proportionally, and re-encodes PNG (static frame) before preview. Very detailed PNG results may still exceed 512 KiB and are rejected with a smaller-image instruction. Browser decoding is not the server trust boundary.

Server validation checks PNG signature, chunk lengths/CRC/order, complete end with no trailing bytes, an 8-bit RGB/RGBA noninterlaced header, dimensions, bounded decompression, exact scanline length and filter values. Only IHDR/IDAT/IEND plus pre-data sRGB/pHYs are accepted. SVG, scripts, arbitrary files, palette PNGs and metadata-bearing originals are not accepted directly; use the normalizing UI. The original file and its metadata are not uploaded.

`GET .../{existing_p_uuid}/image/{request_id}` returns only a ready, owner-authorized PNG. Every read rechecks signed-session access. Responses use `private, no-store`, `nosniff`, restrictive CSP, no-referrer and noindex. Browser fetches use Authorization, no-store, omit credentials and reject redirects; only short-lived in-memory blob URLs render images. Account switch, page hiding and workspace clearing revoke blob URLs and abort requests. No CDN/public URL, browser image cache or persistent image copy is created by this feature. Saving a browser download or screenshot is outside that guarantee.

## Atomicity, idempotency and retained storage

The existing `/privatePounds/<uid>` JSON payload gains optional internal `portraitUploads` metadata indexed by target kind and ID. Image bytes live under `pound-portraits/<uid>/<kind>/<id>/<request_id>.png` in the existing private `RESEARCH_UPLOADS` R2 binding. This prefix is independent of competition archive quarantine/datasets; those objects and their upload status are untouched. Generic workspace reads omit the internal attachment journal. No migration is needed for old clients or records; existing writers preserve the additive field.

1. Validate bytes and input. Conditionally reserve a pending metadata record against the existing workspace ETag and revision **before** any R2 write. That reservation commits a fingerprint of target, original revision, description and SHA-256.
2. Recheck identity, write the deterministic key, and read back all bounded bytes to verify size/hash.
3. Re-read the workspace and conditionally mark that reservation ready without changing authored records. Concurrent unrelated edits are preserved. The workspace revision increments for reservation and finalization.

An exact request replay returns the same ready receipt or resumes a pending upload. Changed content under the same key is 409. A stale new request is 409; re-read before creating a new request ID. After a lost response or finalization conflict, resend the **identical** request, including its original expected_revision. On a later session, pending metadata supplies that original revision/key/hash/description; select the same normalized image and description to resume. The UI displays success only after metadata readback and authenticated image retrieval.

Each target allows eight retained attachment records and at most one pending upload. A new request cannot bypass a pending reservation. Concurrent retries write the same verified bytes to the same key. Every object has a persisted reservation before it can exist; failures, uncertain commits and revocation leave tracked pending records rather than unreferenced uploads. Failed uploads may consume a reservation even when no object exists. If the original bytes are lost, that pending reservation needs a later explicitly designed recovery/delete flow; this release does not discard it. History and reservations have **no automatic expiry or deletion**, and archived identities retain bytes while image access is denied. The bound is 40 existing targets × 8 × 512 KiB (160 MiB maximum image data per full workspace), additionally constrained by existing JSON limits. Do not promise cleanup/retention periods that are not implemented.

## UI and release checks

Roster cards and the Context library reader expose private portrait controls when enabled. A description, preview, explicit confirmation and cancellation before upload are supported. Replacing a portrait changes attachment display, not the selected context text version; the portrait is labeled separately from versioned text. Keyboard controls, 44px targets, 320/390px layout and reduced motion are tested with synthetic images. All synthetic screenshots are labeled; no real Pack identity is seeded.

Tests: `node --test research-lab/pound-portraits.test.mjs`; with the existing QA dependencies, `node --test research-lab/portraits-worker.test.mjs` and `node research-lab/portraits-browser.test.mjs`. The packaged test exercises actual Worker routing, signature auth and R2, not just a mocked upload function. Existing Pound and owner-connector regressions must pass. Inspect current private bucket access/lifecycle and Firebase rules before separately approved activation; this change neither reads live secrets nor modifies storage permissions. Upload the actual approved image only after release and activation, using the existing identity and a current read.
