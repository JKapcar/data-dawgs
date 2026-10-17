# Reconcile an already preserved private archive

A server-side copy can exist at the derived durable key with CRC metadata but no
stored SHA-256. The previous promotion route rejected it even when its bytes were
correct. The existing signed-owner `promote` operation now has a read-only object
verification fallback before its existing conditional application-record update.
There is no new route, grant, credential, permission mode or caller-supplied key.

An explicitly different SHA-256 or size remains an immediate conflict. Only an
existing object with absent SHA-256 metadata qualifies. Its exact bytes are
hashed with native `crypto.DigestStream`, checked against the requested hash and
recorded upload size, and bound to the original R2 version and ETag. Conditional
GET and subsequent HEAD checks reject replacement, deletion or metadata drift.
Owner permission is checked again after final object I/O; the upload record must
still have the same ID, key, size and complete status. The existing ETag-guarded
record write preserves concurrency protection and five-attempt retry bounds.
R2 and the application database are separate stores: these checks are not an
atomic transaction spanning both, and do not authorize concurrent object writes.

The fallback never writes or deletes an object. It records truthful full-readback
verification provenance, rather than claiming R2 validated SHA-256 on the copy.
The existing verified-copy path remains available when the destination is absent.

## Feasibility and limits

- At most 512 MiB per fallback, with a 20-second deadline covering GET, streamed
  hashing and the verification HEAD. Larger checksumless objects fail closed.
- At most 1 MiB per input chunk, sequential backpressure, no whole-body buffer,
  tee, JavaScript hash implementation or new dependency. The deadline and request
  cancellation abort the stream. A late GET is cancelled rather than processed.
- Cloudflare's [DigestStream documentation](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
  states the native sink does not retain input. The [Worker limits](https://developers.cloudflare.com/workers/platform/limits/)
  allow 128 MB per isolate; this repository configures 30,000 ms CPU. No limit or
  deployment setting is changed here.
- Local workerd with the repository compatibility date verified 512 MiB of
  synthetic input, in 64 KiB chunks, through the actual bounded helper in about
  2.7 seconds wall time. Its result matched Node's independent SHA-256. The test
  runs in CI; packaged Worker tests additionally exercise actual local R2 and
  signed-owner authentication with a smaller synthetic copied object.
- Local wall time is not production CPU telemetry or a guarantee about R2
  latency. A slow production read fails at the deadline without marking durable;
  the preserved object remains intact. Production execution and telemetry need
  separate review/approval. Do not raise limits or accept a caller receipt to
  bypass a failed verification.

After approved deployment, the existing signed site owner session can call the
existing promotion operation for the current upload ID and source SHA-256.
Personal MCP tokens cannot call this route. Read back status and confirm the
durable key, size, SHA-256 and verification provenance. Preparation and tests do
not perform that production action.

This patch is prepared separately from the full development-reader release. If
that release activates first, integrate this patch onto its approved code and
rebuild/test the combined Worker before requesting deployment approval. Do not
deploy a standalone build from an older base that omits the active reader.
