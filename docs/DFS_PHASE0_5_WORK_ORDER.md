# DFS Labs — Phase 0.5 Work Order (grokbot handoff)

**Issued:** 2026-09-06 · **Deadline:** T1–T4, T6–T9 merged before **Wed 2026-09-09 6:00 pm ET** (first lock 8:20 pm ET). T5 by Sat 2026-09-12.
**Source of truth:** `docs/DFS_LABS_BIBLE.md` (v1.0). This order narrows it; where they conflict, the Bible wins and you report the conflict.
**Companion:** `docs/DFS_LABS_AUDIT_2026-09-06.md` (findings DFS-2026-001…010 referenced below). Commit both docs with T8.
**Owner / approver:** Kap. You do not deploy the Worker (see Hazard H4).

---

## 1. Read first — repo hazards (all real, all have bitten)

- **H1 Sync before every edit.** `git fetch origin main && git reset --hard origin/main`. Concurrent writers; the nfelo mirror commits ~4×/day. Re-sync if >30 min pass. Verify-deploy and reset are separate commands.
- **H2 The engine lives twice.** `work/dfs-engine.js` is editable; `dfs.html` carries the identical bytes inside `<script type="text/plain" id="ddfsEngine">` (line ≈3087) and builds a Blob-URL Worker from that text. Edit the file, then restamp the block and assert byte equality — the pattern in `work/patch-dfs-frontier.py` and `work/patch-dfs-slate-ingest.py`. Never hand-edit only one copy.
- **H3 Every page change bumps `sw.js`.** Run `python3 work/stamp-sw-version.py` (md5 of all `*.html` + `*.js` excluding `sw.js`, first 10 hex). A JS-only fix without a bump never reaches a phone that has visited.
- **H4 The Worker deploys separately, never on push.** `dawg-bot-worker.js` + `wrangler.jsonc` are source; `.github/workflows/worker-deploy.yml` is `workflow_dispatch` only and Kap runs it. Your Worker PRs must (a) pass `worker-validate.yml`, (b) state in the report that traffic has NOT moved, (c) keep every new route additive and backward-compatible so a page deployed before the Worker still works.
- **H5 No secrets, no paid data (I1).** Nothing from ETR in fixtures, tests, docs, comments or commit messages. Demo slate stays synthetic.
- **H6 `/data/` contract.** Every file is an envelope `{as_of, source, note, built, canonical_url, data}`; `node tools/validate-data.js` must pass; regenerate `data/index.json` via `tools/build-data.js` / `tools/data-manifest.js`, never hand-edit.
- **H7 Toto's prompt copies `HELP` and `MAP` into every page.** If you add a sheet or change the page list, update them in the same commit.
- **H8 Flattened HTML is the source.** No build step, no bundler. Python string-replace with `assert s.count(old) == 1` is the house edit pattern. Add new modules under `work/` and inline them the way Phase 1 did.
- **H9 House style.** Values labelled MV; simulation labelled simulation; modelled inputs labelled modelled; "hasn't been graded yet" stays on screen until it has. No vendor names added.

## 2. Invariants (unchanged from Bible §1 + checklists)

I1 no ETR fetch/store/commit · I2 solver/sim/dupe/validators client-side; toto is a CORS proxy that stores nothing · I3 standings and receipts on-device; only derived aggregates published · I4 selection = sim top-10 / top-1%, dupe-adjusted; rarity is never a sort key · I5 every model-derived number labelled *prior* / *modelled* until ≥3 weeks graded.

## 3. Scope, order, and what "done" means

Ship as **separate PRs in this order**: T4 → T7 → T3 (Worker + page) → T2 → T1 → T6 → T9 → T8 → T5. T4 and T7 are small and de-risk the rest; T1 depends on T2/T3 outputs.

**Definition of done for the whole order (Kap runs it, not you):** cold-open `dfs.html` on Android over mobile data → within 10 s, with zero taps, the page shows the next-locking slate, a ranked contest list, pipeline status chips and last week's grade (or "not yet graded"). Settings are not visible until a gear is tapped.

## 4. Non-goals (do not touch)

- Frontier on Σ −log(own), candidate cloud, sim overlay (Bible §3.3, Phase 2).
- Ownership calibrator, `c_jk` refits (Phase 2, gated on standings).
- Late swap (§6), bankroll Monte Carlo (§7), field-sharpening tracker (§9.4).
- Any projection or ownership source other than paste/CSV and the T5 baseline.
- Auth on the DFS page. Any change to the draft rig, Bozo, survivor, receipts pages beyond the one receipts row in T6.
- `stats.html`, `index.html` copy, `signon.html`.
- Restyling the sheets you are not asked to restructure.

---

## 5. Tasks

Existing anchors you will use (verify line numbers after H1 sync — they drift):
`fsTabs` tab bar (`data-s="slate|solver|sim|exposure|bankroll|screener|standings|method"`, `dfs.html:2673`) · sheet switch sets `S.sheet` then `save()` (≈7273) · persisted state key `LS = "dd-dfs-v1"` (≈4429) · `DK_TOTO` (≈7499) · lobby fetch `dkLobbyGo` / `dkLoadGo` (≈2703, ≈7508, ≈7534) · module globals `DDFSDkDraftables`, `DDFSScreener` (`rankContests`, `scoreContest`, `mapPresetFull`, `enrichPreset`), `DDFSPresets`, `DDFSDupe` (`expectedDupes`, `thresholdForContest`), `DDFSValidators` (`validateSet`, `fitCheck`), `DDFSReceipts` (`cashBuckets`, `roiBuckets`, `hashEntries`), `DDFSStandings` · `window.DD_BOTCTX` (≈7719) · sim per-lineup output in `work/dfs-engine.js` ≈901–993 (`accCash`, `accWin`, `accTop1`, `accRank`).

### T4 · Selection key (DFS-003) — engine + page

**Spec**
1. In the sim loop add `accTop10` (Int32Array): increment when `rank <= Math.max(10, fieldSize * 0.001)`… no — use the literal contest definition: `rank <= 10` scaled the same way `top1` is scaled today (`rank <= Math.max(1, fieldSize*0.01)`). Emit `top10: accTop10[o]/sims`. Keep `top1`, `cash`, `roi`, `win`, `mean`, `meanRank`.
2. Add `evAdj` per lineup per Bible §3.4: `Σ_place P(place)·prize(place) / (1 + E[copies | cashed])`. `E[copies]` = `DDFSDupe.expectedDupes(lineup, players, {entries})` (already computed for the Dupes column; reuse, do not recompute in the Worker — pass it in with the lineup set). Use the payout table the sim already samples from; `P(place)` from the rank histogram the sim already keeps for `meanRank` (if it only keeps the mean, add a bucketed histogram over the paid tiers — tier granularity is sufficient).
3. Page: every place that sorts by `roi` (≈6414 lineup order, ≈6573 results table, ≈7750 Toto ctx) sorts by `evAdj` desc, tiebreak `top10` desc. Columns: add **Top-10 %** and **EV (dupe-adj) $** ; keep ROI visible, not default. Column header tooltip: "Bible §2.1: top-10 rate is the calibrated GPP signal; ROI is noisy in the middle."
4. Toto `ctx()`: replace "BEST LINEUPS BY SIMULATED ROI" with "BEST LINEUPS BY DUPE-ADJUSTED TOP-10 (prior dupes)". Add to `sys`: "Rankings on this page are dupe-adjusted top-10; the dupe term is a prior until ≥3 weeks of standings."
5. Restamp the engine block (H2).

**Tests** — `work/test-dfs-selection.js` (node): synthetic 20-lineup set where the ROI order and the `evAdj` order differ by ≥3 positions; `top10 >= top1` for every lineup; `evAdj <= roi-implied EV` when `E[dupes] > 0`; engine text in `dfs.html` byte-equals `work/dfs-engine.js`.

**Acceptance** — run the demo slate → sim → the Results table's default order changes vs `3a33cbf`; the Top-10 column is populated; ROI column still present.

### T7 · Hide the cumulative-ownership frontier (DFS-004)

**Spec** — On the Exposure sheet wrap `rarityCard` (+ `rarityChart`, `rarityTab`, buttons) in a `<details>` closed by default, summary text: "Projection vs cumulative ownership — convex hull, superseded by Bible §3.3 (Phase 2). Not a selection tool." Remove the word "frontier" from the visible summary. Leave the code path intact. Update Toto `ctx()` string for `FRONT` to say "superseded; not used for selection." No engine change.

**Acceptance** — Exposure sheet shows no chart claiming to be the frontier on open.

### T3 · Screener auto-fill (DFS-005) — Worker + page

**Worker (`dawg-bot-worker.js`, additive, no deploy by you):**
1. `handleDkLobby` currently returns the raw upstream body. Do not change its shape. Add `GET /dk/contests?sport=NFL&draftGroupId=<id>` → same upstream lobby call via `dkUpstream`, return **only** the `Contests` array filtered to `dg == draftGroupId` (or all NFL if absent), and only these fields per contest (rename to stable keys): `id`, `name`, `entryFee`, `prizePool`, `maxEntries` (field cap), `entries` (current), `maxEntriesPerUser`, `draftGroupId`, `gameTypeId`, `startsAt`, `isGuaranteed`, `payoutSummary` if present in the lobby row. **Field names on DK's side are observed, not documented** — log the raw keys of one row to the PR (redact nothing; it's public lobby data) and map defensively.
2. `GET /dk/contest?id=<id>` → upstream contest detail endpoint (`https://api.draftkings.com/contests/v1/contests/{id}?format=json`), return the payout tiers only: `[{fromPlace, toPlace, prize}]`, plus `entryFee`, `prizePool`, `maxEntries`, `maxEntriesPerUser`. `Cache-Control: no-store`. 8-second upstream timeout, 502 on non-JSON, same shape as `handleDkLobby` errors.
3. Both routes GET-only, CORS as the existing `/dk/*` routes. Add to the route table beside `/dk/draftables`. Add fixtures `tests/fixtures/dk-contests-nfl-sample.json` and `dk-contest-detail-sample.json` captured from a real call (public data, no I1 concern).
4. Extend `worker-validate.yml`'s checks to cover the two new routes if it has a route inventory; otherwise add a unit test under `tests/` for the field mapper.

**Page:**
1. On the Screener sheet add a **Pull from lobby** action (auto-run by T2 on open): `/dk/contests` for the loaded draft group → for the top N by prize pool (N=25, configurable in the gear) call `/dk/contest` for tiers → build the object `DDFSScreener.scoreContest` already expects (name, gameType, buyIn, entryCap, fieldCap, prizePool, first, tenth, minCash, rake). `first` = tier with `fromPlace==1`; `tenth` = tier covering place 10; `minCash` = lowest paid tier prize; rake = `1 − prizePool/(entryFee·maxEntries)`.
2. Render the existing ranked table with verdict bands **Play / Tolerate / Avoid** per Bible §5, preset column from `mapPresetFull`, and the existing **Apply**. Add a "% filled" column. Rows remain hand-editable; manual entry path stays.
3. Persist the last pull in `dd-dfs-v1` under `screener.lastPull = {at, draftGroupId, rows}`.
4. If the Worker routes 404 (page deployed before Worker), show one line: "Live lobby contests need the toto update — type contests by hand for now" and keep the manual form. **This path is mandatory** (H4).

**Tests** — `work/test-dfs-screener-lobby.js`: mapper turns both fixtures into `scoreContest` inputs; rake within ±0.5% of `1 − pool/(fee·cap)`; a contest with no place-10 tier yields `tenth = 0` and lands in Avoid; 404 path renders the fallback line (DOM-free unit test on the message builder is fine).

**Acceptance** — with the Worker deployed: Screener sheet shows ≥20 ranked NFL contests with no typing. Without: fallback line, manual form intact.

### T2 · Auto-load on open (DFS-001/010, DFS-009 partially)

**Spec**
1. On page load, if `navigator.onLine`: fetch `/dk/lobby` (existing), pick (a) the next-locking Showdown draft group and (b) the next-locking Classic main slate (`ContestTypeId` 21 classic / 96 showdown per `dk-draftables-ingest.js`; "main" = the classic group with the largest `GameCount` whose `StartTime` is the earliest Sunday 1:00 pm ET slot). Load draftables for whichever locks **first**; expose the other as a one-tap switch on the T1 dashboard.
2. Keep last-good pool: state already persists in `dd-dfs-v1`; add `slate.loadedAt`, `slate.source: "toto"|"csv"|"demo"`, `slate.draftGroupId`. On fetch failure, keep the stored pool and set `slate.stale = true`.
3. Never auto-load the demo slate. Demo stays a button.
4. Projections already matched to a previous pool must survive a re-load of the *same* draft group (match by DK player id; the ingest already carries it) and be dropped with a visible notice for a different one.
5. Do not auto-run the solver or the sim.

**Tests** — `work/test-dfs-autoload.js`: draft-group picker chooses correctly on a fixture lobby with Wed showdown + Thu showdown + Sun classic; stale flag set on simulated failure; projections survive same-group reload, dropped on different group.

**Acceptance** — Wednesday: open page → NE@SEA showdown pool with salaries and OUT/Q with zero taps; Slate sheet still works exactly as before.

### T1 · Dashboard-first page (DFS-001)

**Spec**
1. New first sheet `data-s="week"` labelled **This week**, default on open (`S.sheet` default → `"week"`; existing users' saved sheet is ignored once, then honoured). Keyboard number shifts: week=1, slate=2 … method=9. Update `HELP`/`MAP` (H7).
2. Cards, in order, all rendering from state with no input:
   - **Next lock** — countdown (device clock vs `StartTime`), slate name, one-tap switch to the other loaded group (T2).
   - **Slate** — one row per game: `AWAY @ HOME`, kickoff local time, home win prob and modelled margin from `data/survivor.json` (`p`, `mm`, `src` → label "market" or "model"; `as_of` shown once in the card footer). Match on team codes; DK team abbreviations differ from nflverse for a few teams (JAX/JAC, LA/LAR, WSH/WAS) — normalise. No totals exist on-site; do not fabricate one.
   - **Pipeline** — six chips: Slate · Projections · Lineups · Sim · Exported · Graded. Each chip states its source and time ("Slate · toto · 6:02 pm", "Projections · none — paste on Slate sheet"). Chip tap jumps to the sheet.
   - **Play list** — top 5 rows from the T3 ranked table (Play band only), with preset and **Apply**; empty state: "No lobby pull yet" or the T3 fallback line.
   - **Last week** — from T6 week object: contests entered, cash rate vs expected, ROI with the existing bootstrap band; empty state: "Week N not graded — ingest standings on the Standings sheet."
3. **Gear drawers.** On sheets 2–8 move every `.fld` settings block into a `<details class="gear">` per card, closed by default, summary = the card's current settings in one line (e.g. "150 lineups · 3 uniques · 12% rand · after-each exposure"). Buttons that *act* (Build, Run, Validate, Export, Apply, Pull) stay outside the drawer. Do not remove any control.
4. Mobile: cards single-column ≤600px; existing media queries apply; no new fonts.
5. Toto: `chrome.sub` → "reads this week's slate, lineups, contests and grades"; `ctx()` prepends the pipeline chips and next-lock line; `sys` unchanged except the T4 line.

**Tests** — DOM-free unit tests for: countdown formatter; survivor.json join (fixture with the three abbreviation mismatches); chip state derivation from a fixture `S`. Plus `node work/test-dfs-phase1.js` still green.

**Acceptance** — the §3 definition of done. Also: the Solver sheet with the gear closed shows only Contest preset · Build · Validate · Export · Clear.

### T6 · Week object + receipts + Toto surface (DFS-007)

**Spec**
1. New module `work/dfs-week.js` → `DDFSWeek`: `build(S, SIM, contests)` returns
   ```json
   {"season":2026,"week":1,"lockAt":"2026-09-09T20:20:00-04:00","slate":{"draftGroupId":0,"format":"showdown","games":1},
    "contests":[{"id":"","type":"sd_wildcat","fee":15,"entries":3,"preset":"sd_wildcat","screenerBand":"Play"}],
    "lineups":[{"hash":"sha256-16","contestId":"","expCash":0.21,"expTop10":0.06,"expTop1":0.012,"eDupes":2.3,"dupePrior":true}],
    "projSource":"paste|modelled|none","ownSource":"paste|modelled|none",
    "lockedSha256":"", "realized":null}
   ```
   Derived aggregates only (I3): lineup **hashes** (reuse `DDFSReceipts.hashEntries` salt-less SHA-256 of the sorted DK ids + CPT), never player lists, never projections.
2. Page: on **Export DraftKings CSV** (and on a new **Lock week** button on the dashboard), build the object, compute `lockedSha256` over the canonical JSON, store in `dd-dfs-v1.weeks[week]`, and offer **Download week receipt (.json)**. Publishing to `data/dfs-weeks.json` is a Kap step (H4-style: he commits the file); you ship `tools/build-data.js` support so the envelope validates and `index.json` regenerates, plus a `data/dfs-weeks.json` seed with `data: []`, `as_of` = commit date, `source: "DFS Labs week receipts (derived aggregates only)"`.
3. Monday ingest: when `DDFSStandings` ingests a contest whose id matches a week-object contest, fill `realized` per lineup by hash (rank, cashed, dupes = count of identical lineups if the CSV carries lineups) and per contest (cash rate, ROI). `DDFSReceipts.cashBuckets` / `roiBuckets` run over all weeks with `realized`.
4. `receipts.html`: one row per locked week: "DFS Labs W{n} — {k} contests, {m} lineups, locked {time}, sha {8}. Graded: yes/no." Match the page's existing row style; no new section.
5. `llms.txt`: add under Hubs "DFS Labs (`/dfs.html`): solver, sim, screener, week receipts (`/data/dfs-weeks.json`)". `data/surfaces.json`: add the data file to the `dfs` surface.
6. Toto `ctx()` reads `S.weeks[current]` and reports: contests entered, lineups exported, expected vs realized where present, and the sentence "Expectations were pre-registered at {lockAt}; sha {8}."

**Tests** — `work/test-dfs-week.js`: object contains no player names, no projections, no ownership values (assert by regex over the JSON against the fixture pool's names); sha stable across key order; ingest fills `realized` by hash; `validate-data.js` passes with the seed.

**Acceptance** — Lock week → download → JSON matches schema; receipts row appears; Toto answers "what did we enter this week".

### T9 · toto health chip (DFS-009)

**Spec** — Dashboard chip "toto · DK proxy": green with last-success time, red with the last error message after any failed `/dk/*` call; red state text ends "— paste a salary file on the Slate sheet." Store `dd-dfs-v1.toto = {lastOk, lastErr}`.

**Acceptance** — force a failure (bad `DK_TOTO` in devtools) → chip flips within one fetch.

### T8 · Docs (DFS-008)

- Add `docs/DFS_LABS_AUDIT_2026-09-06.md` and this file as `docs/DFS_PHASE0_5_WORK_ORDER.md`.
- Add `docs/DFS_Bible_validation.md` — Kap supplies the text (blocking input B3); if absent at PR time, add a stub with the title and "pending" and say so.
- Bible header: replace the `dfs-roadmap.md` reference with "sequenced by `docs/DFS_PHASE*` checklists".
- `docs/DFS_PHASE1_CHECKLIST.md`: status → "landed except I4 in UI (fixed in Phase 0.5 T4)". New `docs/DFS_PHASE0_5_CHECKLIST.md` in the same table format, "landed" only after Kap runs the §3 phone test.

### T5 · Never-empty projections (DFS-002) — modelled baseline tier

**Spec**
1. New module `work/dfs-baseline-proj.js` → `DDFSBaseline.project(pool, ctx)`. Inputs available on-site: `data/pool.json` (season-long MV/ranks, `as_of 2026-08-24`), `data/survivor.json` (`p`, `mm` per game). Method, deliberately crude and labelled: per-game baseline = `seasonProjPts / 17` from `pool.json` where a player matches (name + team normalised), scaled by `1 + k·(homeWinProb − 0.5)` for offence with `k = 0.4` (a prior; log it), K and DST from a fixed positional table stated in the Method sheet. Players with no match get **no** projection (a blank is still not a zero).
2. Ownership baseline: **none**. Do not invent ownership; the sim's field model needs it and must stay disabled ("No meaningful ownership has been supplied") when only the baseline is loaded. The solver may run on baseline projections; the sim may not.
3. Every baseline row carries `src: "modelled"` and renders with the existing modelled label; the Projections chip reads "modelled baseline — replace with your own". A paste **replaces** baseline rows for matched players and keeps baseline for unmatched ones, each row keeping its own `src`.
4. Method sheet: one paragraph, dated, with the k prior and the K/DST table. Toto `sys`: "Baseline projections are a crude modelled placeholder derived from season-long values and win probability; they are not the site's opinion of any player."

**Tests** — `work/test-dfs-baseline.js`: matches ≥85% of a real classic draftables fixture by name/team; no ownership produced; paste overrides only matched rows; `src` preserved.

**Acceptance** — open page with no paste → pool is populated with modelled projections; Build works; Run the simulation is disabled with the existing ownership message.

---

## 6. Report-back template (one per PR, in the PR body)

```
PR: T<n> <title>            Base: <sha>   Head: <sha>
Files: <list>               sw.js VERSION: <old> → <new>   Engine restamped: yes/no/n.a.
Tests run: node work/test-*.js (list) → pass/fail counts; tools/validate-data.js → pass/fail
Worker changes: none | routes added <list> — NOT deployed; validate workflow: pass/fail
Behaviour before/after (one line each, from the phone if you can):
Bible conflicts found: none | <section> — <what>
Invariants touched: I1..I5 → each "unchanged" or explanation
Open questions for Kap: <max 3>
Not done / deferred: <list with reason>
```

## 7. Blocking inputs from Kap

- **B1** DK team-abbreviation map confirmation after first real `/dk/draftables` pull (T1 slate join).
- **B2** Worker deploy: Kap runs `worker-deploy.yml` after T3 merges; page must ship before or after safely (T3 fallback).
- **B3** Text of `docs/DFS_Bible_validation.md` (project knowledge → repo).
- **B4** Week 1 contest choices for the T6 first week object (or leave `contests: []` until Thursday).
- **B5** Confirmation of the `top10` scaling rule in T4 (literal rank ≤ 10 vs proportional); default = literal rank ≤ 10, which is what ETR's studies report.

## 8. Stop conditions — halt and report instead of guessing

- Any task needs a value that only ETR provides.
- A real DK payload lacks a field the mapper assumes (report the raw keys).
- The engine restamp assert fails.
- `worker-validate.yml` fails for any reason.
- A change would require touching `stats.html`, the draft rig, Bozo, or auth.
