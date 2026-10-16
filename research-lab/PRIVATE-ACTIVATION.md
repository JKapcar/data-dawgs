# Owner persistence and private competition intake

Activation prepared 2026-10-16 following explicit owner approval. The private R2
bucket and 30-day object/seven-day multipart lifecycle are provisioned. Canonical
owner identity was verified against the existing site record; the empty tenant
and owner grant were saved and read back in the Firebase console. No external
agent grants, credentials, billing upgrades, rules or schedules were added.
The public demo remains at `index.html`; `private.html` uses the authenticated
hosted workspace. Signed-in live persistence and upload checks remain pending.

## Exact approval scope

Approve enabling Jason's persistent research workspace and private ZIP intake on
the existing DataDawgs site. Use Jason's verified existing account UID; durable
owner access remains until explicitly revoked, while sign-in sessions retain
their existing expiry. Reuse the existing Worker, Firebase and KV. Create one
private R2 Standard bucket `datadawgs-research-private` if no suitable private
bucket already exists, and bind it only to the existing Worker as
`RESEARCH_UPLOADS`. Keep public access, public custom domains and bucket CORS off.
Allow one archive up to 10 GiB at a time, owner-only upload/download/delete, with
30-day object expiry and default seven-day incomplete-multipart cleanup. Keep
active research records until requested deletion; save separate research metadata
backups for 30 days using the existing daily job. Do not give external agents
access, create provider keys, schedule research jobs or change Firebase rules.

Storage uses existing Cloudflare metered billing, not a new subscription. Verify
the account's current R2 availability/usage before creation. If R2 enrollment,
payment details, a plan upgrade, or a new billing commitment is required, stop and
show that specific requirement. Do not describe this as free or a hard dollar cap.

## What must be applied, after approval

1. Resolve the UID from `/auth/self` using Jason's existing signed session. No
   password or session token should be pasted into chat or the public repository.
2. Verify current direct-client denial for `/researchLab` and `/researchUploads`.
   Earlier screenshot evidence showed no root allow, but is not a current rules
   read. Anonymous denial alone does not prove authenticated-client denial.
   No rule change is anticipated; if current rules differ, present the exact diff.
3. Use a one-time conditional admin write, with existing backend authority, to
   initialize `/researchLab/v1/tenants/jason-bdb`. Use `encodeEnvelope()` from
   `exact-store.mjs` with schema-v1 empty state and inputs. Grant only the verified
   UID `{enabled:true, owner:true, capabilities:[...]}` with **no expiresAt**.
   The seven capabilities are research:read, hypothesis:write, evidence:write,
   discussion:write, task:write, task:claim, experiment:run. `access.agents` stays
   absent. No public grant editor/bootstrap route is added.
4. Add the private bucket binding to the complete `wrangler.jsonc` only after the
   resource decision. Set `RESEARCH_OWNER_UID`, `RESEARCH_UPLOAD_TENANT=jason-bdb`,
   `RESEARCH_UPLOAD_ENABLED=true`, `RESEARCH_LAB_ENABLED=true`. The owner UID is
   not a secret, but keep it out of public example configuration where unnecessary.
5. Configure the bucket lifecycle: expire objects under `quarantine/` after 30
   days; abort incomplete uploads after seven days. A six-day application resume
   window leaves time before provider cleanup. No new cron job is necessary.
6. Change `client-config.mjs` to hosted mode with tenant `jason-bdb`, the existing
   Worker origin and `sharedEnabled:true`. Leave provider/scheduler/holdout off.
7. Review/merge and release through the existing full Worker and Pages workflow
   after a current concurrent-release handoff. Verify actual signed-in persistence
   and a small synthetic multipart upload, resume, download hash and deletion.
   Confirm logs redact Authorization and do not capture request bodies.

Owner access has no arbitrary pilot expiry. Revocation is `enabled:false`; the
owner-only exception also requires the environment's exact owner UID. Agents
still require finite expiry and have no uploader route. Infrastructure admins
can access storage and backups; this is not end-to-end encrypted owner-only
physical storage. All approved tenant readers see that tenant's research records.

## Upload design and limits

`upload.html` is a distinct private intake page, not a demo data loader. It uses
the existing sign-in page. The browser hashes each 8 MiB slice, registers a fixed
manifest, and sends sequential authenticated slices to the Worker. No full-file
buffer, R2 credentials, presigned bearer URLs or browser-to-bucket CORS are needed.
This is Cloudflare's supported Worker multipart route, not one multi-GB request.
The Worker verifies the SHA-256 of each received slice, fixes object keys itself,
and saves parts with ETag compare-and-swap. A same-file hash match is required on
resume. Completion checks object size; multipart ETag is explicitly not a file
SHA-256. Full archive and member hashes come from the inspector.

One owner slot lives at `/researchUploads/v1/<uid>` as an exact JSON payload.
No private filenames/bytes are written to GitHub or the public site. A completed
archive must be explicitly deleted before another is accepted. Abort tombstones
prevent new writes during cleanup. Interrupted create failures can leave provider
orphans until seven-day lifecycle cleanup. Lifecycle expiry does not remove the
metadata record; delete/cancel clears that slot before a replacement.

No generic object-list/public-download/AI-retrieval API is provided. The owner
download endpoint streams bytes under the same signed-session check. Later AI
retrieval must use separate scoped identity, approved data split and allowed
artifact IDs; existing broad personal MCP tokens are not research-only tokens.

## Inspection and extraction

`python research-lab/inspect_zip.py <private-local-archive>` inspects without
extracting. Optional `--extract <new-private-directory>` writes only CSV members
to a fresh directory and removes that newly created directory on failure. Run
outside the public checkout, on a private local volume with at least 20 GiB free
for extraction, ideally in an OS sandbox with no network. No automatic hosted
compute is provisioned. Jason already has the original ZIP locally; it can be
inspected there, with its part hashes compared to the stored manifest.

The inspector bounds central-directory allocation before Python opens the ZIP,
including ZIP64 record handling. Limits: 10 GiB archive, 16 MiB central directory,
1,000 members, 8 GiB/member, 20 GiB expanded, 100:1 expansion, 300 seconds. It
rejects paths escaping the new directory, Windows device names, alternate stream
paths, duplicate case-insensitive paths, links, special files, encryption and
non-CSV members. Stored/deflate only. It streams CRC verification and SHA-256;
no archive contents are executed. These conservative limits may reject valid
datasets; change them only after inspecting the reason, not by disabling checks.
Passing archive inspection does not verify schema, units or measurements.

## Retention and costs

Research metadata is removed from newly generated general 180-day/latest
backups and copied to `research-backup:v1:tenant:<id>:<date>` and
`research-backup:v1:upload:<uid>:<date>` with a 30-day TTL. Existing historical
backups are untouched. No ZIP bytes are placed in Firebase or KV. Bucket object
expiry is separate from metadata backup expiry; a metadata restore cannot restore
expired/deleted ZIP bytes. Keep the source ZIP locally.

Current published R2 Standard rates: $0.015/GB-month, $4.50/million Class A,
$0.36/million Class B, free egress. Included monthly allowance is 10 GB-month,
1 million A and 10 million B operations, shared across the account. Billing units
round up. One full 10 GiB archive is about $0.17/month in gross storage before
allowance; account usage, repeated replacements, retries, Workers and Firebase
can add costs. The actual competition ZIP size and account bill are unknown.
There is no application-enforced monetary billing cap; one-archive/size limits
bound retained payload, not all account spending.

Verified provider references, 2026-10-16:
- https://developers.cloudflare.com/r2/objects/upload-objects/ — resumable multipart,
  equal-size parts except last; 5 MiB minimum; seven-day incomplete cleanup.
- https://developers.cloudflare.com/workers/platform/limits/ — minimum plan request
  limit 100 MB and 128 MB Worker memory; 8 MiB requests stay below both.
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ — binding
  API, streamed retrieval and multipart completion/abort races.
- https://developers.cloudflare.com/r2/pricing/ — rates, allowance and rounding.

The existing Vault page is setup-only. The approved bucket binding is now in the
complete Worker configuration. Firebase currently warns that monthly downloads
exceed its free allowance; the editor remained operational and initialization
succeeded. No plan change was made. Future service continuity remains a risk
until usage resets or the owner separately decides how to address the overage.
