# Survivor pipeline audit — 2026-09-04

Audited `main` at `a7af108439ffafd9f4215097bc43fc53b7ff0c8e`, with API and live HTTP observations through 19:58 UTC. This report accompanies the authorized hardening changes. New Actions execution remains **unverified**: both dispatch API calls returned HTTP 401, and the connected GitHub tools expose reruns but no dispatch operation. Local Git push also lacks a credential. The connected GitHub API successfully published the authorized changes as `85c57ea817038a1d7f8b4e5fbc247e400a37ff94`. [Pages deployment 33913835318](https://github.com/JKapcar/data-dawgs/actions/runs/33913835318) succeeded at **19:58:26Z**. Live survivor JSON matched tested SHA-256 `80469d0eaea9d9eb35a54dd67f5151020c548c185d6935d7c40aae6e780d9cc6`; the live ledger retained `727edc866620ad5e23c9a0c1f1d71252ffad87be79b865fde780c7ad42b7fc29`. This verifies this deployment, not future `GITHUB_TOKEN` build requests.

## Finding that determines the answer

**The results merge is manual.** `.github/workflows/nfl-data.yml` refreshes `automation/nfl-data-refresh`, opens a PR, and explicitly says “Review and merge manually.” `work/survivor-receipt.mjs` resolves solely from `data/nfl-schedule.json`, requires `status === "final"` and both scores, and records that file in `resolved.result_source`. With no results merged onto main, the resolver cannot grade. [Open refresh PR #32](https://github.com/JKapcar/data-dawgs/pull/32) is direct evidence of the review step.

Several supplied assumptions were incorrect:

* Week 1 already has `survivor-2026-w01-default`, captured **2026-08-28T00:12:07.878Z**, recommending **LAC at 0.784910**. Its input is dated August 6. It is preserved byte-for-byte; no superseding claim was requested or created.
* The current versions of the two workflows have not run, but the receipt workflow previously succeeded August 28 and failed September 3. A dispatch with `resolve_only=true` should currently print **0 resolved, 1 still waiting**, not zero waiting. Waiting before the games is correct.
* Both current `sw.js` and the version available August 30 serve HTML **network-first** and bypass `/data/`. A phone hard refresh is not an established recurring requirement.
* GitHub explicitly says `GITHUB_TOKEN` pushes do **not** trigger branch-source Pages builds. This patch adds an explicit Pages build request; a commit alone was not proof of publication. [GitHub publishing documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
* The old CLI gate used the recommended leg's kickoff, despite claiming the week's earliest kickoff. The new CLI uses the earliest regular-season game of that week. Existing receipts are unchanged.

## 1. Pipeline map

“Source verified” means the implementation was read or exercised locally. It is not a claim that the new Actions path has run.

| File / route | Producer | Trigger | Last success / timestamp observed | Freshness at audit | Downstream effect if stale | Who notices |
|---|---|---|---|---|---|---|
| `greerreNFL/nfelo/output_data/` | External nfelo automation | External commits; no timing SLA established | Cloned HEAD `e0c270a6b0d8e9eefaa88fe81b363506c406e5b6`, Sep 4 19:40:50Z | Current upstream commit; rating content last changed Sep 1 12:40:44Z, season 2026 W1 | Ratings/market inputs stagnate | Previously readers; new watchdog checks upstream timestamp |
| `tools/nfelo-refresh.mjs` → `nfelo.html` → `data/nfelo.json` | `build-data.js nfelo.json` after upstream mirror | Old 11:00Z daily; new 05/11/17/23Z daily + dispatch | Main before audit: observed Sep 4 16:07:00Z, upstream 12:40:48Z. Local refresh successfully reads 19:40:50Z commit | 32 ratings, 16 current-week games; no spread/win-probability moves; two totals and two price fields refreshed | All nfelo/survivor outputs | New alias test, failure notifier, freshness watchdog |
| `work/build-survivor-snapshot.mjs` → `survivor.html` → `data/survivor.json` | Canonical schedule + mirrored ratings/market; fixed model constants preserved | Same nfelo workflow, sequential | Main Sep 4; local rebuild passed | 272 games: 16 mirrored market rows, **35 carried from Aug 6**, 221 without market probabilities | Board and receipts use stale or carried inputs | Dates/source labels; watchdog detects whole-input/publication staleness, not every carried line |
| `data/nfl-schedule.json` | `scripts/nfl_data_backbone.py`, nfelodcm 0.2.21, nflverse/nfldata | 10:17Z daily creates review PR | Refresh run Sep 4 14:21:23Z succeeded; **main still captured Aug 7 23:56:57Z** | 28-day-old observation on main; current PR has unchanged game rows and newer provenance | Kickoff gates, schedule changes and grading all depend on main | Human PR reviewer; new watcher flags delayed grading |
| `.github/workflows/nfelo-refresh.yml` | GitHub Actions | Four daily crons + dispatch after patch | **Zero Actions runs** at audit | Local commands passed; Actions token/push/build not verified | No fresh survivor input | Workflow-run failure issue plus independent scheduled watcher |
| `.github/workflows/survivor-receipt.yml` → ledger | Exact page engine, snapshot hash, schedule resolver | 15:00Z daily; successful nfelo completion; dispatch | Aug 28 success; Sep 3 failure; new version unrun | One prospective Week 1 receipt; no graded rows | Missing claims or unresolved rows | Explicit capture classification and watchdog |
| Worker `mcpSurvivor()` | Fetch of live `/data/survivor.json` | On tool request; memory 900s and edge 200 responses 900s | Implementation verified in `work/mcp-block.js`; live Worker request blocked HTTP 403 here | Cache holds successful responses; errors not cached as long-lived successes | AI tools can lag publication; no guaranteed single 15-minute bound across both cache layers | Request errors; publication watchdog sees origin, not every edge cache |
| Worker `/survivor-picks` | Authenticated manual POST into existing `RL` KV, `survivor:season:week` | **No upstream collector** | Handler verified in actual `dawg-bot-worker.js`; live contents unverified (403) | Defaults modelled; button fetches/paste are optional | Cannot claim observed field ownership | User/UI labels; ownership decision below |
| `survivor.html` client | Inline `window.SV`; engine reads this object | Page navigation | Main live JSON hash matched repository at audit | `/data/index.json` fetch belongs to machine-view overlay; it does **not** replace board `window.SV` | Board needs fresh HTML publication | HTML network-first; actual phone profile not available |
| GitHub Pages | Dynamic Pages build/deploy | Human commits work; token pushes need explicit build request | [Main Pages run 33894733300](https://github.com/JKapcar/data-dawgs/actions/runs/33894733300), Sep 4 16:22:41Z success | Live survivor JSON and ledger matched pre-audit main | Repository and live product diverge | New POST build step and live-hash watchdog |

The Pages settings endpoint was unavailable through the connector and returned 404 without authenticated REST access. Dynamic Pages history and AGENTS.md support branch publication, but **the actual `source.branch/source.path` setting and the new build request are unverified**. The request requires Pages write permission. [GitHub Pages API](https://docs.github.com/en/rest/pages/pages#request-a-github-pages-build)

## 2. Actions and local evidence

| Check | Evidence | Result |
|---|---|---|
| nfelo Actions history | `GET /repos/JKapcar/data-dawgs/actions/workflows/350318672/runs`: `total_count: 0` | No new-run proof |
| Receipt Actions history | [Aug 28 run](https://github.com/JKapcar/data-dawgs/actions/runs/33128938075); [Sep 3 run](https://github.com/JKapcar/data-dawgs/actions/runs/33789653941) | Old success / old failure |
| Sep 3 full job log | Job `100762872385`: `FAIL wrangler.jsonc: required secret-name set drifted`; `1 FAILURE(S), 29 warning(s)` | Unrelated global validator stopped receipt workflow; current main passes this gate |
| Dispatch nfelo now | POST workflow dispatch, `ref=main`, inputs `{}` | HTTP 401 Unauthorized |
| Dispatch resolve only now | POST receipt dispatch, `ref=main`, inputs `{"resolve_only":"true"}` | HTTP 401 Unauthorized |
| Full local mirror/rebuild | `node tools/nfelo-refresh.mjs --from=…/nfelo-upstream`; `node work/build-survivor-snapshot.mjs`; `node tools/build-data.js survivor.json models.json` | Clone/read, exact mirror, 272-game rebuild passed |
| Team aliases | `node work/test-nfelo-aliases.mjs` after today's mirror | Both rating and game aliases cover all 32 codes; exact schedule joins pass |
| Resolve only | `node work/survivor-receipt.mjs resolve --check` | `0 resolved, 1 still waiting on results`; `nothing to write` |
| Receipt CLI | `node work/test-survivor-receipt.mjs` | **40 passed, 0 failed**; includes hash equality, write-once, supersedes, grading, never re-resolve, week-wide kickoff refusal |
| Gate / failure / notifier tests | `node work/test-survivor-pipeline.mjs` | 14 gate cases; malformed kickoff fails; unexpected CLI failures fail; mocked issue create/append/API failure pass |
| Forced race | `python3 work/test-survivor-publish.py` against a temporary local remote | `CONFLICT (content): Merge conflict in sw.js`; regenerated SW; staged verification; real global validator passed; amended and pushed; both writers and ledger preserved |
| Global data validation | `node tools/validate-data.js` | `all checks passed, 26 warning(s)`; warnings retained |
| SW behavior | Node VM with an old cached HTML response and a successful new network response | Fresh HTML won; `/data/` bypassed SW. This is a behavior test, **not an Android profile test** |

The rebase test is a real Git conflict/push test with repository scripts, but **not an Actions-hosted test**. A deliberately induced production race was unnecessary and no trivial commit was pushed solely to manufacture one.

`workflow_run` does not necessarily check out the triggering workflow's original SHA: GitHub documents its SHA as the last commit on the default branch. The prior stale-checkout hypothesis is therefore **not proven**. Explicit `ref: main` plus full history now removes ambiguity and supports rebase. [GitHub event reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)

New receipt runs log checkout SHA and SHA-256 of `data/survivor.json`; successful capture logs `input_snapshot_id`; publish logs the final hashes. To close the Actions evidence gap, compare the receipt's hash to the file in the **logged checkout commit**, then show that commit contains the refresh output. Do not compare an August receipt to September input or require equality with a later unrelated main commit.

Pre-audit live hashes:

* `data/survivor.json`: `d44c3c3f91842d4d38bed6b52d0ff919d427414b190f18036a158a69ed81c980`
* `data/survivor-receipts.json`: `727edc866620ad5e23c9a0c1f1d71252ffad87be79b865fde780c7ad42b7fc29`
* Existing Week 1 `input_snapshot_id`: `sha256:08c1f34f5eb2bc94cfbff001187b7fcbbb18a7dbb90e090038f65108b1f15dc3`

## 3. Gate simulation

Exact shared gate now used by the workflow, evaluated against the canonical schedule on main. “Eligible” does not override write-once; Week 1 already exists. The old embedded snippet yields the same answers for this valid single-season input.

| UTC evaluation | Next week | Hours to earliest kickoff | Eligible |
|---|---:|---:|---|
| Sep 8 15:00 | 1 | 33.33 | No |
| Sep 9 15:00 | 1 | 9.33 | Yes, but Week 1 already captured |
| Sep 10 15:00 | 2 | 177.25 | No |
| Sep 13 15:00 | 2 | 105.25 | No |
| Sep 17 15:00 | 2 | 9.25 | Yes |
| Sep 24 15:00 | 3 | 9.25 | Yes |
| Nov 25 15:00 | 12 | 10.00 | Yes |
| Nov 26 15:00 | 13 | 178.25 | No |
| Dec 17 15:00 | 15 | 10.25 | Yes |
| Dec 19 15:00 | 16 | 130.25 | No; Week 15 already began |
| Dec 24 15:00 | 16 | 10.25 | Yes |
| Dec 26 15:00 | 17 | 130.25 | No; Week 16 already began |
| Jan 9, 2027 15:00 | 18 | 27.00 | No |
| Jan 10, 2027 15:00 | 18 | 3.00 | Yes |

The stored Thanksgiving-week opener is **Nov 26 01:00Z (Wednesday 8 PM Eastern)**. Wednesday capture is required by that game, not by Thursday's lunchtime kickoff. Late-season flexed kickoffs must reach main; these results prove the gate against the stored schedule, not that a month-old schedule will remain correct through January.

At the new 05/11/17/23Z refresh cadence, the first ordinary Thursday-opener capture opportunity is **Thursday 05Z**, after that run's refresh. Week 1's first would be Wednesday Sep 9 05Z, but it is already recorded. Exact Action start times are not guaranteed.

## 4. Weekly calendar

The following describes the patched schedule. “Automatic in code” is separated from live proof.

| Day / UTC time | Event and input dependency | Runs without Kap? | Evidence / limit |
|---|---|---|---|
| Every Tue–Mon 05,11,17,23 | Mirror nfelo → rebuild survivor from main schedule → validate/stamp → commit → request Pages build | Automatic in code; new Actions path unverified | nfelo workflow, local refresh and Git-race tests |
| Every Tue–Mon 10:17 | NFL loader and 538 refresh → PR | Yes, prior run observed | [Sep 4 successful run](https://github.com/JKapcar/data-dawgs/actions/runs/33883248664); PR #32 |
| After that PR | Merge canonical finals/schedule into main | **No** | Explicit manual-merge command text |
| After each successful nfelo run | Resolve existing receipts, then test capture proximity | Automatic in code; chain unverified | Receipt workflow, explicit main checkout |
| Every Tue–Mon 15:00 | Independent resolve + gated capture retry | Automatic in code; current version unverified | Receipt workflow; old runs establish scheduler existed |
| Thu 05Z onward, usual week | First eligible capture after refresh, before Fri 00:15Z kickoff | Automatic in code, assuming current schedule and healthy runs | Gate tests; subsequent runs refuse duplicates |
| Thu–Mon after games | Upstream publishes finals; next 10:17Z loader observes available rows | Upstream + loader automatic; landing on main is **manual** | No guaranteed nflverse final-publication SLA established |
| First receipt run after finals land on main | Resolve recommendation once; publish ledger | Automatic in code, blocked by manual merge today | Resolver final/score checks and 40 CLI tests |
| Each new week | nfelo rating snapshot is mirrored when upstream changes it | Automatic mirror; external update timing unverified | Latest rating-content commit Sep 1; cannot promise a Tuesday publication deadline |
| Each new week | Ownership | Modelled needs no action; observed needs a source | Empty default popularity; manual POST route; decision below |
| Every Tue–Mon 06:35,12:35,18:35,23:35 and watched run completion | Watch successful-run age, mirror timestamps, missed receipt, delayed grading, live hashes; open/append dated issue | Automatic in code; real issue delivery unverified | Mocked notifier tests; no unsolicited email/Slack sent |

Week 1 specifically: Sep 8 15Z is outside the gate; Sep 9 05Z begins the scheduled eligible opportunities; Sep 10 00:20Z is the stored earliest kickoff. Existing August 28 receipt is retained at every attempt. Its LAC game is Sep 13 20:25Z; grading can occur once that game's final is merged, without waiting for every Monday game. Sep 14/15 loader runs are potential final-ingestion opportunities, **not promised final availability times**.

## 5. Precise proposed approvals — NOT activated

### A. Results-only automatic merge

Recommend a separate results candidate from the full schedule/model refresh PR, validated against the **current main SHA immediately before merge**. A full existing refresh PR is not automatically safe merely because it touches `data/`.

1. Trusted same-repository automation, fixed results branch, base `main`; no fork head or untrusted PR code executes with a write token. Require the bot's expected origin and successful trusted validation against the exact candidate head.
2. Keep identical ordered game IDs, row counts, data season, and object-key sets. For every game, the **only** allowed row changes are `status`, `home_score`, `away_score`.
3. Allow only `(scheduled, null, null)` → `(final, nonnegative integer, nonnegative integer)` with kickoff already in the past. At least one such result must change. Unchanged rows are allowed. Reject final-to-scheduled, edits to existing final scores, partial/nonfinite/negative scores and new fields. Corrections require review and never rewrite an already graded receipt.
4. Specifically unchanged: `game_id`, `upstream_game_id`, `season`, `week`, `season_type`, `kickoff_at`, both teams, `neutral_site`, `divisional`, both rest-day fields. No new/removed/reordered games or kickoff edits. Any structural change routes to the ordinary review PR; safe results for unrelated unchanged games should be extracted into the results candidate rather than blocked behind it.
5. Schedule envelope exceptions only: `as_of`, `built`, exact commit suffix in `source`, `provenance.source_commit`, `provenance.source_committed_at`, `provenance.captured_at`, and recomputed `integrity.snapshot_id`. Validate their types/timestamps/hash; pin repository, URL, loader/version/license, notes, tiers, algorithm and row counts. No arbitrary metadata exception.
6. The existing validator couples schedule to 538 forecasts; **schedule JSON alone cannot simply be merged**. Candidate file allowlist: `data/nfl-schedule.json`, `data/538-classic.json`, `data/model-receipts.json`, `data/receipts-inventory.json`, `data/index.json`. The latter four must match a trusted replay of unchanged generators against the accepted results candidate and pinned inputs/timestamps. Every pre-existing model receipt object remains exactly equal; no removals/reordering or altered graded rows. Any append must satisfy the existing prospective and uniqueness contracts. No HTML, JS, workflow, method, contract or survivor-receipt file may change in this auto-merge PR.
7. Require Python loader/classic tests, canonical/hash validation, historical 538 reproduction, receipt-history validation, and global manifest validation. Recheck main/head immediately before merge; if main advanced, regenerate and revalidate. Never force merge or bypass required checks. The current bot PR validation runs show `action_required`; required-check approval behavior must be resolved before claiming unattended merging.
8. After merge, run/publish the resolver through an existing allowed schedule or explicit dispatch and verify live bytes. Do not add `on: push`. Ship a dated Method amendment describing this precise exception and the remaining review requirements.

This rule authorizes new final facts plus their deterministic downstream rebuilds, **not edits to published evidence**. PR #32 is provenance-only today (same canonical game data) and would not satisfy the “at least one new result” requirement.

### B. Ownership policy for 2026

Recommend: **the public default and its receipts use modelled ownership for 2026 unless an explicitly sourced observed dataset is supplied; no weekly posting is required.** Label the field modelled, retain observation dates/source when real data exists, and remove any runbook promise that Kap must post weekly. Do not call modelled weights real picks or infer a league feed from the existence of Firebase.

The public receipt CLI currently sets `popularity: {}` and does not query `/survivor-picks`, so posting data there alone does not change its receipt input. Wiring observed ownership into public receipts would require an explicit source/input contract, not just an upload. No ownership policy, Worker route, or Method doctrine was changed here.

## 6. Final manual-step inventory and residual limits

| Item | Before audit | Change / remaining requirement |
|---|---|---|
| Merge final results | Mandatory recurring human gate | Remains mandatory until approval A is implemented and verified |
| Supply observed ownership | Manual if observed ownership is promised | Optional for current modelled product; approval B makes season scope explicit |
| Same-day mirror dispatch | Suggested manually in workflow comments | Replaced by four daily refreshes; not Actions-proven yet |
| Notice silent failures | Manual inspection | Capture guard + dated GitHub issue notifier + scheduled watchdog; production notification unproven |
| Publish bot commits | Hidden missing automation | Explicit Pages build request added; token/settings/build/live success unverified |
| Phone hard refresh | Hypothesized | Removed as an established requirement: current and Aug 30 SW network-first; actual retained Android session unverified |
| Alias drift | Exceptional code repair | Every refresh now tests actual mirrored codes; unknown aliases fail and alert, never guessed |
| Concurrent writers | Could break rebase on shared generated files | Tested automatic regeneration of only SW/manifest conflicts, bounded retries; source conflicts still fail closed |
| Schedule flexes/new or corrected facts | Human review | Remains by the proposed results-only rule. Cannot promise no intervention across 18 weeks |
| Running one real entry through the season | Not implemented by this receipt configuration | `used: []` resets each week; weekly recommendation calibration is not a continuous entry's survival history. No new product policy inferred |

**Known mandatory recurring manual gates today: 1 — merge canonical results. Observed ownership would add a second obligation if required. Proven zero-weekly-action operation: no.** With A and B approved, implemented, and all new Actions/publication checks verified, routine unchanged-schedule weeks can require zero planned actions. An unconditional 18-week zero cannot be claimed while schedule-structure changes require review, and exceptional failures still require repair. Automating alerts removes manual surveillance, not the need to respond to a real fault.

## 7. Changes included and intentionally withheld

Included: four daily mirrors; explicit main receipt checkout and hash logs; capture exit/log guard; earliest-week-game deadline; successful grading can still commit when capture fails; no manifest-only ledger commits; safe generated-conflict rebase/amend with validation; explicit Pages build requests; notifier/watchdog; alias, gate, refusal, grading and concurrency tests; today's upstream mirror with numeric Week 1 probabilities unchanged.

Withheld: results auto-merge; 2026 ownership policy amendment; any superseding or late Week 1 receipt; Worker edits/deployment; forced production race; claims of successful new Actions runs, notification delivery, Pages token behavior or a real-phone session test.

No published survivor receipt was rewritten. No final result was manufactured to grade production data. Test schedules/results were fixtures restored after each local run.
