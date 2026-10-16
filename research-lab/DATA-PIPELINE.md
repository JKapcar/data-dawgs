# BDB data pipeline: verified dataset → reproducible audit → one baseline result

Written 2026-10-16. Milestone: a verified dataset, a reproducible audit, and one real baseline
result. Scheduling stays off: every step below is run by a person, once, on purpose.

## Where things stand

| Item | State |
|---|---|
| Local archive | On the owner's machine. Verified earlier: 512,718,566 bytes, nine CSVs, SHA-256 `27d52f59…8d0ced`. **Keep it.** It is the source of truth until the hosted copy is verified and durable. |
| Uploaded copy | R2 `datadawgs-research-private`, key `quarantine/<owner uid>/<upload id>.zip`, metadata at `/researchUploads/v1/<owner uid>`. Keyed by owner uid, not by the `jason-bdb` tenant. Existence and size not yet confirmed (no session or Cloudflare access from the agent). |
| Expiry | The bucket rule expires `quarantine/` objects **30 days after upload** (PRIVATE-ACTIVATION.md). The upload date is not yet known, so neither is the expiry. |
| Studies | Five ideas loaded into `jason-bdb` as `exploratory` through the connector on 2026-10-16 (keys `idea-2026-10-16-<family>`). None is registered; none has data behind it yet. |

## Step 1: verify the uploaded copy matches the local archive

After this PR is deployed, `dd_owner_bdb_read` returns a `dataset` block with metadata only: status, recorded size, part count, `partHashesSha256`, object present or missing, object size, upload time, and `lifecycle.expiresAt`. No bytes, no link. Then, on the owner's machine:

```
py research-lab\data\archive.py verify <path to archive.zip> --connector-digest <partHashesSha256>
```

The command exits 0 only when all three hold: the size matches 512,718,566, the SHA-256 matches `27d52f59…`, and the 8 MiB part-hash digest equals the uploaded copy's. The uploader hashed every part in the browser and the Worker re-verified each one on receipt, so equal digests mean the stored object is these bytes.

## Step 2: durable private storage (plan; nothing changed yet)

The archive must not depend on a 30-day quarantine rule.

| Option | What | Who | Cost |
|---|---|---|---|
| **A. Stopgap** | Remove or lengthen the `quarantine/` expiry rule in the Cloudflare dashboard (R2 → bucket → Settings → Object lifecycle rules). | Owner; needs the Cloudflare login. The agent has no Cloudflare access. | None. |
| **B. Recommended** | Add one owner-session-only route, `POST /research-upload/v1/promote`. It runs only after Step 1 passes. It streams `quarantine/<uid>/<id>.zip` to `datasets/<uid>/<sha256>.zip` inside the same private bucket, re-checks the size, points the metadata at the new key, then deletes the quarantine copy. `datasets/` has no expiry rule. The connector would report `lifecycle.durable: true`. | Agent writes it and tests it in Miniflare; owner approves the deploy and runs it once from the Uploads page. | Storage about 0.51 GB, inside R2's 10 GB-month free tier. A handful of class A/B operations. R2 has no egress fees. Expect $0; at most about $0.01 a month above the free tier. |

Do A immediately if `lifecycle.expiresAt` is less than seven days away. Then do B. Nothing is ever public: the bucket stays private, and the connector and Pages never serve the bytes.

## Step 3: audit the real tables (owner's machine)

```
py research-lab\data\audit.py <path to archive.zip> --out <folder outside the repo>
```

It reads the CSVs inside the ZIP in place, one streaming pass per table, and writes nothing beside the source:

- table identity and shape;
- ID joins across tables (`game_id`, `game_id`+`play_id`, athlete IDs), with orphans counted;
- missing fields;
- tracking sampling intervals and conventions;
- leakage: post-play fields per table, and combine-table columns that break the registered cutoff;
- readiness: which columns baseline B1 needs, and where they are.

It writes two files to the folder you give with `--out`:

- `audit-receipt.json` stays local.
- `audit-receipt-summary.json` holds counts, shapes, hashes and column names only. It passes `tools/check-research-data.py`, so it can be shared, committed under `research-lab/data/`, or attached to the BDB record.

Both receipts carry the SHA-256 of the code that produced them and of their own body. Re-running on the same archive reproduces them, apart from the timestamp.

## Step 4: one baseline experiment, B1

**Why not T1 first.** T1 (WR separation over expected on breaking routes) is itself a model: "expected" needs a fitted separation model and route labels. A first baseline should not have a model hidden inside its outcome.

**B1 definition.** Every element is fixed before any holdout data is seen:

| Element | B1 |
|---|---|
| Question | Does the stopwatch card predict rookie usage better than the cohort mean? |
| Outcome | T2, rookie-season offensive snap share, one value per athlete. The exact `TABLE.csv:COLUMN` is chosen from the audit's readiness section and recorded before the develop run. |
| Cohort | WR, draft classes 2023–2025, complete card (forty, ten_yd_split, combine_height, combine_weight). |
| Split | Develop = 2023–2024 classes. **Untouched holdout = 2025 class.** Split by class, so no athlete is in both. |
| Model | OLS on the card, fitted on develop only. Benchmark: the develop mean. |
| Metric | MAE. Develop is scored leave-one-out. The holdout is scored once with the develop fit, plus a paired bootstrap by athlete (2,000 resamples, fixed seed) of MAE(card) − MAE(mean). |
| Missing | Athletes without an outcome are counted and excluded, never imputed. That count is the missingness anchor the T1 studies need. |
| Holdout | `baseline.py --open-holdout` opens it **once**. It refuses if a holdout receipt already exists. |

Commands on the owner's machine, after Step 3:

```
py research-lab\data\baseline.py <archive.zip> --outcome <TABLE.csv>:<COLUMN> --out <folder>
py research-lab\data\baseline.py <archive.zip> --outcome <TABLE.csv>:<COLUMN> --out <folder> --open-holdout
```

If the audit shows no snap-count data, B1 is blocked as written. The outcome is then re-chosen from what the archive actually holds and recorded here before anything runs.

## Approvals and access needed

1. **Deploy** the connector change in this PR, so Step 1 can read upload metadata. Owner approval required.
2. **Cloudflare dashboard** (Option A) or approval to build and deploy the promote route (Option B). The cost is expected to be $0.
3. **Owner runs three local commands** (Steps 1, 3 and 4) against the private archive. The agent cannot reach the owner's machine or the private bucket.
4. Then **share `audit-receipt-summary.json`** and the baseline receipts, and confirm the B1 outcome column.

GrindingMocks (EDP-AUDIT.md) waits for its Excel file.
