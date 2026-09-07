# DFS Labs — Audit & Operating Plan

**Date:** 2026-09-06 (Sunday). First lock: **Wed 2026-09-09 8:20 pm ET** (NE@SEA showdown). Thu 8:35 pm ET SF–LAR (Melbourne showdown). Main slate **Sun 2026-09-13 1:00 pm ET**.
**Repo home (proposed):** `docs/DFS_LABS_AUDIT_2026-09-06.md`, next to `docs/DFS_LABS_BIBLE.md`.
**Audited:** `dfs.html` @ `3a33cbf` (deployed; Pages build green), `work/dfs-*.js`, `work/dk-draftables-ingest.js`, `dawg-bot-worker.js` `/dk/*`, `docs/DFS_LABS_BIBLE.md`, both phase checklists, `data/` surfaces, `llms.txt`.
**Method:** cloned the repo (repo = site, no build step), rendered `dfs.html` top-to-bottom as a phone user sees it, ran every DFS test suite (all pass: 7 + 14 + 6 + 6 + 8 checks), traced the sim/selection code against the Bible's invariants, checked deploy + service-worker state.
**Proportionality note:** this is a one-person lab that shipped a solver, sim, presets, validators, dupe priors and receipts skeleton in three days. The findings below are about *product shape* and *two method drifts*, not about engineering quality.

---

## 0. Verdict

The hub is not broken. It is a **workbench with no dashboard**: eight sheets, 51 inputs, 16 selects, every sheet opens empty, and nothing visual exists until a ~10-tap pipeline completes — pick game type → refresh lobby → pick slate → load → paste projections → map columns → match → build → simulate → open Exposure. The one step that gates all of it (pasting paid projections) is the one step that is painful on Android. So on a phone the page reads as "settings, then nothing" — exactly what you described, and exactly what your own Bozo rule (charts/actions only; settings and prose elsewhere) forbids.

Underneath, roughly 60% of the Bible's analytical spine is real and tested. Two pieces of what shipped contradict the Bible: lineups are ranked by simulated ROI (the signal the Bible says is inverted in the middle), and the frontier chart is on cumulative ownership (the axis the Bible says does not separate winners). Both are cheap to fix.

"AI in charge of the season" is achievable, but only as: **AI runs the loop, a human moves the money**, and the desktop-only DraftKings surfaces (standings export, CSV lineup upload) need a desktop session — a browser agent or a Monday ritual — or the calibration loop the whole Bible depends on never starts.

---

## 1. Why the page shows nothing — hypotheses

| # | Hypothesis | Prior | Evidence | 60-second check |
|---|---|---|---|---|
| H1 | Product shape: everything gated behind manual pipeline; empty states by design | **~60%** | Rendered DOM (§2, DFS-001/002). Lobby fetch is button-driven, no auto-load on open (`dfs.html:2703–2704`, `:7508`) | Open Slate → does "Fetch lobby…" populate after tapping Refresh? If yes → H1. |
| H2 | Stale service-worker cache on your phone | ~15% | `sw.js` VERSION rotates with every nfelo-mirror commit (~4×/day), so staleness self-heals within hours; Pages build succeeded on `3a33cbf` | Hard-reload once; if content changes → H2 contributed. |
| H3 | `toto /dk/lobby` failing from DK's side (UA/bot block) | ~25% | UA fix landed 9/5 (`e36acee`); DK blocks Cloudflare egress intermittently; proxy is `no-store` so a failure = empty page with a 502 | Tap Refresh lobby → if it errors or stays on "Fetch lobby…" → H3. Then paste path is the fallback. |

Posterior after you run the checks decides whether T2/T9 below is a UX fix or an outage fix. Both are in the work order.

---

## 2. Findings register

Severity: **Blocker** (prevents use), **High** (wrong answer or blocks the loop), **Medium**, **Low**.

### DFS-2026-001 · Blocker · No output without a manual pipeline
- **Evidence:** eight sheets (`fsTabs`), `poolEmpty` "No slate loaded", `expEmpty` "No lineups yet", "No contests scored yet"; 51 `<input>`, 16 `<select>`; no fetch on page open.
- **Why it matters:** the page violates the house rule for human-facing pages and has no default state worth opening on a Wednesday.
- **Fix:** T1 + T2. Definition of done is visual: *cold-open on Android, cards/chart within 10 s, zero input.*

### DFS-2026-002 · Blocker · Projections are paste-only with no fallback tier
- **Evidence:** Slate sheet copy: "A player with no projection is left out of the pool — a blank is not a zero." Only source is paste/CSV (I1). On Android the ETR paste is the hard step; no modelled baseline exists.
- **Why it matters:** without projections the pool is empty, the solver has nothing, and the whole rig is dark. I1 is correct; the missing piece is a *modelled, labelled* baseline so the page is never empty.
- **Fix:** T5 (baseline tier) + decision D3 (who pastes ETR, on what device, by when).

### DFS-2026-003 · High · Selection key contradicts I4 / §2.1
- **Evidence:** every ranking sorts by `roi` (`dfs.html:6414`, `:6573`, `:7750`); sim per-lineup output is `mean / roi / cash / top1 / meanRank` (`work/dfs-engine.js` ≈993) — **no top-10 rate, no dupe-adjusted EV (§3.4)**.
- **Why it matters:** the Bible's own evidence: in showdown the −25…−10% sim-ROI bucket realized +13.8% while all 0…40% buckets were negative; top-10 rate is the robust GPP predictor. The UI currently sorts on the noisy key.
- **Fix:** T4. Compute `top10` (rank ≤ 10 scaled to contest size) and `EV_adj = Σ P(place)·prize/(1+E[copies])`; default sort = dupe-adjusted top-10; ROI stays visible, not default.

### DFS-2026-004 · Medium · Frontier is on the wrong axis
- **Evidence:** `work/patch-dfs-frontier.py:39` — Lagrangian `proj[i] − L·own[i]` (sum ownership); page labels "cumulative ownership" (`dfs.html:2915`, `:6762`). Bible §3.1 defines rarity = Σ −log(own). The dupe model *does* use −log (`dfs.html:5549`).
- **Why it matters:** sum ownership was 113.4% vs 113.9% (top-100 vs field); it is the axis the Bible rejects. Pre-mortem #2 ("someone will sort by the frontier") applies to a frontier on any axis.
- **Fix:** T7 — hide or relabel behind Method until the §3.3 version ships in Phase 2. One-line change.

### DFS-2026-005 · High · Screener is hand-typed; lobby proxy drops contests
- **Evidence:** screener copy: "Lobby fields can be typed by hand until toto pulls them live." Fixture `tests/fixtures/dk-lobby-nfl-sample.json` holds `DraftGroups` only; `work/dk-draftables-ingest.js` never reads a `Contests` array.
- **Why it matters:** contest selection is the biggest ROI lever in the Bible (§2.5) and the one most likely to matter for a low-volume player; today it costs nine typed fields per contest.
- **Fix:** T3 — pass the lobby `Contests` array through toto (fee, prize pool, entries, entry cap, max entries per user) and add a per-contest payout-tier proxy; screener auto-fills and ranks; existing **Apply** pushes presets.

### DFS-2026-006 · High · The receipts loop has no owner and no device
- **Evidence:** standings ingest is paste-only (`dfs.html:3019`); DK exports standings CSVs from the desktop site; Phase 0 checklist records that you are phone-first ("Android cannot export").
- **Why it matters:** Phase 2 is gated on ≥3 weeks of standings. Without a desktop path, `c_jk` stays a prior all season, ownership error is never measured, and the Bible's #1 pre-mortem risk (ownership error dominates, 40–55%) is never observed. This is the single decision that determines whether the season produces a calibrated tool or a diary.
- **Fix:** decision D4 + runbook §4 (Monday desktop session, agent-driven or manual).

### DFS-2026-007 · Medium · No "week object"
- **Evidence:** DFS state persists in `localStorage["dd-dfs-v1"]`; nothing per-week is written to `data/`; the site's receipt machinery (`model-receipts.json`, `integrity.sha256`) is not wired to DFS; `llms.txt` lists DFS only under Arena; MCP exposes `dd_solve_dfs_lineup` and `dd_dfs_correlations` but no week/state tool.
- **Why it matters:** the proof of concept is "AI ran the process and here is the receipt." Without a pre-registered week record there is no receipt, only a bankroll log.
- **Fix:** T6.

### DFS-2026-008 · Low · Docs drift
- **Evidence:** Bible references `dfs-roadmap.md` and `docs/DFS_Bible_validation.md`; neither exists in the repo. Phase 1 checklist reads "landed" while DFS-003 is open.
- **Fix:** T8. "Landed" should require the visual acceptance test in DFS-001.

### DFS-2026-009 · Medium · DK proxy fragility with no visible health
- **Evidence:** `dkUpstream()` sends a browser UA + Referer; `/dk/*` is `no-store`; a DK block surfaces as a 502 and an empty page. Last-good pool survives in localStorage, which is good.
- **Fix:** T9 — health chip on the dashboard; failure copy points at the paste path.

### DFS-2026-010 · Low · Showdown is Week 1's first lock and has no fast path
- **Evidence:** the showdown ingest, CPT/FLEX merge and 5-1/4-2 validators are built and tested; but the page opens to Classic and the showdown slate is three taps deep.
- **Fix:** T2 auto-loads the *next* lock, which on Wednesday is a showdown.

**What is right and should not be touched:** invariants I1–I5; client-side compute; the dupe model (`E[dupes] = entries × Π own × Π c_jk`, priors labelled); validators (pass/warn, never block); presets; hashed standings; the Toto `sys` block on the page, which is unusually honest ("There are NO RECEIPTS").

---

## 3. What "AI runs the season" has to mean here

Constraints that shape the design, stated once:

1. **Money moves by hand.** DraftKings' terms prohibit automated entry; the sanctioned surfaces are the desktop CSV lineup upload and manual entry. The AI produces the entry file and the decision memo; a human confirms the upload. This is a *gate*, and it is also the governance story you actually want to tell at FAA: agent runs a critical workflow, human holds the two irreversible steps (contest entry, money).
2. **Paid inputs never touch the public repo (I1).** ETR enters by paste — on your phone, or by an agent reading ETR inside *your* logged-in desktop browser session. Nothing is stored.
3. **Desktop-only DK surfaces** (standings export, lineup CSV upload) mean either (a) a desktop with Chrome logged in, driven by an agent on a schedule, or (b) a weekly manual ritual. Phone-only caps the season at hand-enterable volume (≈8 lineups/week) and no standings — i.e., no Phase 2.
4. **Outside view on returns.** Field average ≈ −rake (−13% to −16%). ETR's single-entry showdown cohort realized −21.6% (n=33 slates). A disciplined small-volume player with paid projections should expect roughly −10% to +5% over a season with a 95% band wider than the whole edge at <200 entries. **Season ROI cannot be the pass/fail for the proof of concept.** Process compliance and calibration can.

### The loop (owners in brackets)

```
Tue  lobby → screener → Play list + sizing          [agent]  → approve (gate 1) [Kap]
Tue  slate load, baseline projections                [agent]
Tue  ETR paste (phone) or ETR read in your session   [Kap / agent-in-your-browser]
Thu  build → validate → sim → select → export CSVs   [agent]  → upload/enter (gate 2) [Kap]
Thu  week object written, expectations pre-registered, SHA-locked   [agent]
Sun  11:30 am inactives refresh → swap list          [agent]  (manual swaps until Phase 3)
Mon  standings export → ingest → grades → receipts   [agent on desktop / Kap]
```

Toto's job on `dfs.html`: read the week object and answer "what's built, what's exported, what did last week grade at, what is E[dupes] on lineup 3 and which pair drives it."

---

## 4. Proof-of-concept protocol (pre-register before Wed 8:20 pm ET)

Publish as a receipts entry with a SHA lock, in the site's existing format.

| Claim | Pass condition | Graded |
|---|---|---|
| C1 Process | A complete week object (contests, lineup hashes, expected cash/top-10 per lineup) exists before first lock in ≥16 of 18 weeks | weekly |
| C2 Calibration | By Week 8, sim cash-rate buckets (ETR format §9.3) are monotone against realized; ownership error bands published by position | Week 8, Week 18 |
| C3 Contest choice | Realized ROI in "Play" contests ≥ "Tolerate" contests over the season (directional; sign only) | Week 18 |
| C4 Money | Season ROI with bootstrap 95% band, benchmark = −(entry-weighted rake). Reported, not a pass condition | Week 18 |
| C5 Paper portfolios | Two or three alternative construction policies (e.g. chalk-tolerant / product-own-min / ETR-sim-top) graded against real standings at zero cost, so the field-sharpening tracker has data | weekly |

Promotion rule (Pup → Dawg): C1 + C2 pass. C4 alone never promotes; a bink is not evidence.

---

## 5. Work order — Phase 0.5 (this week, in order)

Invariants I1–I5 hold. Every PR: `sw.js` VERSION bump; `node work/test-*.js` green; report-back template from the Phase 0 order.

| # | Task | Acceptance |
|---|---|---|
| **T1** | **Dashboard-first `dfs.html`.** New default sheet "This week": slate card (games, kickoffs, spread/win-prob from `data/survivor.json`), pipeline chips (Slate / Projections / Lineups / Sim / Exported / Graded), countdown to next lock, Play list (from T3), last week's grade. Every settings block collapses into a per-sheet gear drawer. | Cold open on Android: cards render ≤10 s with zero input. Settings not visible until the gear is tapped. |
| **T2** | **Auto-load on open.** Fetch lobby; load the next-locking Classic main slate *and* the next Showdown; keep last-good pool; failure state shows the paste path in one tap. | Wednesday open shows NE@SEA showdown pool with salaries + OUT/Q, no taps. |
| **T3** | **Screener auto-fill.** toto: pass lobby `Contests` through; add per-contest payout-tier proxy. Screener ranks Play / Tolerate / Avoid per §5 and maps presets; Apply unchanged. | Screener opens with ≥20 NFL contests ranked; zero typing; rake computed from pool. |
| **T4** | **Selection key.** Sim emits `top10`; add `EV_adj` (§3.4) using the existing E[dupes]; default sort = dupe-adjusted top-10; ROI column kept, not default; Toto `ctx()` reports "best by dupe-adjusted top-10". | Node test: synthetic case where ROI order ≠ top-10 order; `top10 ≥ top1` for every lineup. |
| **T5** | **Never-empty projections (if time).** Modelled baseline tier: 2025 nflverse per-game fantasy points × role × market total scaler, labelled *modelled*, replaced the moment a paste lands. | Pool is never empty; every baseline row carries the label; Toto states it. If not shipped this week, Week 1 path = ETR paste on desktop. |
| **T6** | **Week object + receipts + Toto surface.** On export, write derived aggregates only (I3) to `data/dfs-weeks.json`: week, contests (id/type/fee/entries), lineup hashes, expected cash/top-10/E[dupes] at lock, SHA lock; realized fields filled by the Monday ingest. `DD_BOTCTX.ctx()` reads it. `llms.txt` lists DFS as a hub. | `node tools/validate-data.js` passes; receipt row visible on `receipts.html`; Toto answers "what did we enter this week". |
| **T7** | Hide the cumulative-ownership frontier (or relabel "convex hull on sum ownership — superseded by Bible §3.3") until Phase 2. | No chart on the Exposure sheet claims to be the frontier. |
| **T8** | Docs: add `docs/DFS_Bible_validation.md` from project knowledge; fix or drop the `dfs-roadmap.md` reference; Phase 1 checklist "landed" requires T1's visual test. | Links resolve. |
| **T9** | toto health chip on the dashboard (`/dk/lobby` last success time). | Chip flips red within one failed fetch. |

Not this week: frontier on −log(own) and the candidate cloud (Phase 2, gated on standings); late swap and bankroll Monte Carlo (Phase 3); anything that fetches ETR.

**Phase 2 gate (unchanged):** ≥3 weeks of standings for the relevant contest tier. Which is why D4 below matters more than anything in this table.

---

## 6. Ideas — build / later / kill

**Build (this week).** T1–T4, T6. These turn a rig into a product and make the season gradeable.

**Weeks 3–6 (the actual edge).**
- **Ownership calibrator** (§9.2): projected → realized error bands by position and ownership bucket; the three Leone miss modes. This is where a receipts-first lab can beat vendors who never publish their misses.
- **`c_jk` refits** from standings; log prior → posterior every update.
- **Paper portfolios** (C5) — free data on which construction policy the 2026 field has already arbitraged.
- **Market-implied projections** from player props as a cross-check on ETR (and the Bozo CLV instinct applied to projections: grade projection error against the market, weekly).
- **Showdown as the flagship.** Least public competition, validators already exist, two showdown locks before the first main slate. Ship a 5-1 / 4-2 builder that names the CPT-side split and the pair driving E[dupes].

**Later.**
- Frontier on Σ −log(own) with candidate cloud + sim overlay (§3.3), only once calibration data exists — otherwise it is a beautiful chart on an unmeasured input.
- Late swap (§6), bankroll Monte Carlo (§7).
- **"AI vs AI" weekly:** Toto, Claude and Grok each produce a paper lineup set from the same inputs; graded against real standings; published. On-brand, zero cost, and it feeds the field-sharpening tracker. Content, not edge — do it after the loop is stable.
- MCP tools `dd_dfs_week`, `dd_dfs_screen`, `dd_dfs_validate` (read/compute only) so any AI can inspect the week — "Bring Your Own Dawg" applied to DFS is the differentiator nobody else has.

**Kill / park.**
- Competing with The Solver / SaberSim / Stokastic on sim horsepower. They have years of post-lock calibration data; we have zero weeks. The Bible already says the edge is elsewhere; hold that line.
- A live self-updating field model; per-game correlation from scratch this season; anything that scrapes ETR.
- Making season ROI the headline metric. It will be dominated by variance at this volume and will mislead the promotion decision in either direction.

---

## 7. Decisions needed from Kap

| # | Decision | Why it blocks |
|---|---|---|
| D1 | Season bankroll and max weekly deployment | Sets contest count and whether 20/150-max is in scope at all. Starting frame: weekly deployment ≈ bankroll/40 (Leone's figure is Game-Changer-specific; the Bible says generalize by simulation, so treat it as a first cap, not a rule). |
| D2 | Entry path: phone-manual only (≈8 lineups/week: single-entry + 3-max + showdowns) vs desktop CSV upload (enables MME) | Decides whether a desktop session is required from Thursday of Week 1. |
| D3 | ETR path: you paste on the phone by Tuesday night, or an agent reads ETR in your logged-in desktop browser | Without this the pool is dark; T5 only softens it. |
| D4 | A desktop with Chrome, logged into DK, available Monday morning (and Thursday if D2 = CSV) | This is the whole receipts loop. No desktop path → no Phase 2 → the season produces a diary, not a calibrated tool. |
| D5 | Agree the pass conditions in §4 before Wednesday's lock | So the season is not graded on a bink or a bad beat. |

---

## 8. Pre-mortem additions (operational, beyond Bible §11)

1. **Nobody does Monday (35–45%).** The standings step is boring, desktop-only and unowned. If it slips two weeks, Phase 2 slips to Week 8 and the season is half over. Mitigation: D4, a named owner, a calendar event, and a red chip on the dashboard when a week is ungraded.
2. **ETR paste fails on the phone in Week 1 (25–35%).** Mitigation: T5 baseline, or one desktop paste Tuesday night.
3. **Toto/DK proxy blocked on a lock day (15–25%).** Mitigation: T9 chip + last-good pool + paste path.
4. **The implementer marks "landed" on a page that still opens empty (20–30%).** Checklists are self-reported. Mitigation: T1's acceptance test is a phone, not a test file; you run it.
5. **We grade ourselves on ROI anyway (20–30%).** Mitigation: §4 pre-registered before Wednesday; the dashboard shows C1/C2 status, not just the bankroll line.

---

## 9. What is genuinely different about this hub (say this, and only this)

Not "the best sim." Three things no vendor offers together: contest selection as a first-class ranked surface; public, pre-registered calibration of our own misses (ownership error, dupe error, pre→post ROI regression); and a machine-readable week object any AI can audit. That is the Data Dawgs thesis applied to DFS. Everything else is table stakes, and we should say so.
