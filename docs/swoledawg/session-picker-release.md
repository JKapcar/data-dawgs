# Session picker and shared plans — September 16, 2026

Two PRs target main. Merge Level 1 before Level 2; Level 2 includes Level 1 as a prerequisite until it lands. This work order explicitly stops at PRs. Nothing here authorizes running the migration or deploying the Worker.

## Changes from the supplied handoff

- The current program uses `monday`/`tuesday`/`thursday`/`friday`; exercise IDs use `mon_`/`tue_`/`thu_`/`fri_`. Keep the existing full program day names and session IDs. Translate the compact picker/MCP values explicitly.
- `sessions.day_key` already exists and is NOT NULL. Do not add it again. Sunday has no scheduled workout; a legacy Sunday rest session retains its full weekday key.
- Add `plan_json` and `plan_selected_at`. The second field makes a reselected older session active without rewriting its original start time.
- SQLite does not support `ADD COLUMN IF NOT EXISTS`. Use the guarded runner below, which checks columns individually and supports retry after partial execution. The SQL file alone is not rerunnable.
- Backfill uses the majority known exercise prefix, with ties becoming `custom`. It changes no session IDs or sets and leaves plans NULL. Sessions without known program sets retain their existing day key.
- The old date-only read returned one session and the page could hydrate it repeatedly. Level 2 adds a uid-scoped session-ID read and aggregates each date once. Set-entry forms use the selected session's sets, not the aggregate of all workouts that date.
- Cache VERSION hashes all root HTML and JavaScript except sw.js, as AGENTS.md requires.
- Existing attribution is unchanged. In particular, rear-delt exercises are not remapped to Back: that suggestion conflicts with the handoff's explicit instruction to preserve attribution.

## Targets

Page starting targets are Chest 10, Back 10, Biceps 8, Triceps 8. All other known buckets are explicitly NULL and appear under “Not tracked this block.” Counts remain available. The existing Settings save path can explicitly override this starting map. Targets saved with `session_picker_targets_configured` persist through subsequent reads.

No automatic target ramp was added: increases remain deliberate Settings changes after reviewing attainment. The panel's existing volume counting/window behavior is unchanged; picker counts use the actual ISO calendar week. The page-only targets are not a mutation of the server program, so program-reading MCP clients continue seeing the stored program targets until explicitly updated.

## Deployment order after review

1. Apply the additive migration using the repository's existing Wrangler authentication:

   `node work/migrate-swoledawg-session-plan.mjs --remote`

   The runner uses the installed Wrangler, probes columns, adds only missing fields, and runs the idempotent majority-prefix backfill. It never recreates or drops the sessions table.

2. Deploy the Worker using the complete checked-in Wrangler configuration.
3. Publish the Level 2 page. The updated page requires the updated Worker.
4. Sign in and verify preset selection on a different weekday, Custom reorder, set save and readback, reload, Change day, and a second session on the same date.
5. Call `sd_start_session` with `exercises` from the connected account and return focus to the page: the server plan takes precedence. Unknown IDs or combined `day` and `exercises` must fail without writes.

No remote migration or live deployment was performed during implementation. Browser screenshots could not be verified because Chromium was absent and its download timed out. Automated tests execute the page's rendering function with a DOM fixture, but do not establish visual quality on a real browser.

## Validation

- Baseline: 91 SwoleDawg checks.
- Level 1: 103 checks.
- Level 2: 124 checks, including real SQLite migration/backfill reruns, uid isolation, ordered rendering, failed-save behavior, and ISO-week counts.
- Broader MCP suite: 451 checks.
