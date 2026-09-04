# Bozo — Execution Plan

**For:** Codex, working on `github.com/JKapcar/data-dawgs`
**Owner:** Kap
**Written:** 2026-09-03, Thursday evening
**Companion:** `docs/bozo-workplan.md` holds every locked decision (D1–D19) and the design. This file holds the **order of work**. Where the two disagree on sequencing, this file wins. Where they disagree on a decision, the workplan wins — decisions are not re-opened here.

---

## 0. State of the board as of tonight

What is true right now, so no job starts from a wrong assumption.

| Area | State |
|---|---|
| Matcher | Fixed and deployed. `@`/`vs` split, long-only matching, ESPN-derived team registry in KV, hard-coded `UNT`/`IU` fallback retained. Commits `1449789` and `f404d68`. |
| Fixture | `tests/fixtures/sgo-ncaaf-2026-09-05.json`, trimmed to four events. SGO returns `names.long` only for 78/100 NCAAF teams; NFL returns all three. |
| Roster | Kap, Roger, ItzBornLegend. Six more to add: Beamen, Butts, Tony, Squatch, Jay White, Pat. League is nine. |
| Board | Week 1, open, **zero legs**. No leg has been filed since the roster was re-seeded. |
| Orphan data | `results.Kap` and ledger `2026-w1-Kap` survive from the old roster with close-failure fields only, no `player`/`uid`. Source of the `"undefined"` standings key. |
| ESPN | **403 from Worker egress** (`site.api`, scoreboard). **Works from the user's browser.** Submit form derives `startsAt` browser-side (bozo.html:4431, :6098) and is unaffected today. Grading runs in the Worker and is **unverified**. |
| Replacement sources | Validated HTTP 200 from Worker egress: `nflverse/nfldata` `games.csv` (NFL), `sportsdataverse/cfbfastR-data` processed schedule (CFB). Both carry ESPN game ids and post-game scores. No freshness SLA on either. |
| Price capture | Not built. Every leg is `priceSource: self`. `priceOpp` is an optional form field. **No leg has ever produced a CLV number.** |
| Close state | Not built. A failure reason is as immutable as a price (6584). |
| Tests | 462 passing. |
| Workplan on `main` | Through D18 (`ce56de0`). **D19 and task 2.5b are in the attached copy and not yet committed.** |

First kickoff of anything on the board: Sat 2026-09-05 12:00 ET, UNT @ IND, if Kap files it. NFL Week 1: Sun 2026-09-13.

---

## 1. Milestones

| | Milestone | Definition of done | Target |
|---|---|---|---|
| **M0** | **A week finishes** | Nine legs filed, board locks, every game-market close captured with both sides, every leg graded from a Worker-reachable source, one Bozo named by the lever walk, `/bozo/next` rolls cleanly. No self-reported prices. | **Tue 2026-09-15** (grade NFL Week 1) |
| **M1** | **The numbers are honest** | Archive close in place, Worst Beat unified and calibrated, no assumed hold anywhere, all six sports gradeable or rejected at submit. | Week of 2026-09-28 |
| **M2** | **A commissioner can run it** | Deadline, placement stage, re-open with audit, navigation a stranger can use. | Week of 2026-10-19 |
| **M3** | **Strangers can join** | `uid` keys, auth hardening, PWA, terms. Invite-only cohort. | Week of 2026-11-16 |

M0 is the only one with a hard date. It is set by the NFL calendar, not by preference.

---

## 2. Standing rules for every job

These apply to every Codex session regardless of job. They are restated here because fresh sessions drop them.

1. **Echo before write.** Any RTDB or KV write is shown to Kap and confirmed before it executes. This includes roster edits, cleanups, migrations, and manual patches. The roster add on 09-03 skipped this; it must not happen again.
2. **Fixture before parser.** No adapter or matcher code is written against a documented response shape. Capture a real response first, commit it under `tests/fixtures/`, write against that.
3. **Never assume a hold.** No `−110/−110` default, no `.022`, no "standard juice." A leg without a real `priceOpp` is `clvEligible: false`. Missing beats wrong. (D8, D9, Phase 4.2.)
4. **Blank is not zero.** A score that hasn't populated is a retry, never a `0`. A close that wasn't captured is `unmeasured`, never `0.00`. (D8, D19.)
5. **Foreign ids are attributes.** ESPN, SGO, and Odds API ids hang off the canonical key. None is a join key. (D7.)
6. **No scraper, no DK endpoints, no slip-link parsing.** (D14, §0.2.)
7. **Two-phase on every write route.** Phase one echoes and never writes. Phase two stores what phase one captured without re-fetching.
8. **One job per chat.** Open with the verbatim opener below. Do not carry forward assumptions from a previous session's local files — pull `main`.
9. **Every new field lands in the `dd_*` tool schemas in the same PR as the write path.** (§4 of the workplan.)
10. **Report in the shape of the acceptance criteria.** Each job's acceptance is a checklist; the closing report answers each item yes/no with evidence.

---

## 3. Jobs — M0: a week finishes

Order is a dependency order. J1 before J2 before J3. J4 and J5 can run alongside J3.

### J1 — Verify and fix grading · ~4h · **first, before anything else**

Nobody has traced the grade path since the ESPN block. If it reads a blocked endpoint, a week can start and never finish. Everything else in M0 is moot until this is known.

**Tasks**

| # | Task | Acceptance |
|---|---|---|
| J1.0 | Replace `docs/bozo-workplan.md` with the attached copy (adds D19, 2.5b, D19 consequences). Commit. | Diff shows D19 row and task 2.5b present. |
| J1.1 | Trace `/bozo/grade` (§3.4) from route to score fetch. Name every external call, its URL, and whether it is Worker-side or browser-side. | A written trace with function names and line numbers. Yes/no: does a CFB leg and an NFL leg grade today from Worker egress? |
| J1.2 | If any Worker-side call hits ESPN: build the **NFL adapter** on `nflverse/nfldata/data/games.csv` and the **CFB adapter** on `sportsdataverse/cfbfastR-data/main/schedules/csv/cfb_schedules_2026.csv`, per D19. Scheduled fetch with ETag conditional request → parse current season only → compact JSON in KV keyed `schedule:{sport}:{season}` with `etag`, `fetchedAt`, `source`. Grade reads KV only. | KV holds both schedules. `games.csv` `gametime` is combined with `gameday` under `America/New_York`. cfbfastR uses the **processed** file, never raw. No odds column from either file is read anywhere. |
| J1.3 | Grade becomes **poll-until-populated**. A blank `home_score`/`away_score` is a retry with the same retryable-vs-terminal discipline as the close cron. Never a zero. | Test: a leg whose source row has blank scores grades as `pending`, not as a loss or push. |
| J1.4 | Validator rejects `nba`, `cbb`, `mlb`, `nhl` at submit with reason `sport_not_gradeable` until an adapter exists for that sport. | `dd_draft_bozo_leg` on an NBA leg returns `accepted: false` with that reason. |
| J1.5 | Populate `espnEventId` and `startsAt` server-side from KV when a submission omits them (this is 2.5b's server half; the validator half is in J3). | An MCP submission with only `eventId` resolves `startsAt` from KV. |

**Opener**

> Job J1 of `docs/bozo-execution-plan.md`. First, replace `docs/bozo-workplan.md` with the attached copy and commit it. Then trace `/bozo/grade` end to end and tell me, with line numbers, whether an NFL leg and a CFB leg can be graded today from Worker egress given ESPN returns 403. Stop and report before building the adapters.

---

### J2 — Orphan cleanup + 1.4 · ~1h · after J1 report, before any leg is filed

| # | Task | Acceptance |
|---|---|---|
| J2.1 | Remove `results.Kap` and ledger `2026-w1-Kap` from `/bozo/leagues/main/`. Echo the exact nodes before deleting. | `dd_bozo_standings` returns no `"undefined"` key. |
| J2.2 | `dawg-bot-worker.js:7078` — close-capture must never write a ledger row without `player` and `uid`. If the pick is missing, write nothing and log. | Test: close capture against a leg whose pick node is absent writes nothing. |
| J2.3 | `stillWaitingOn` and every name-bearing field pass through `decodeURIComponent` (workplan 1.5). | `The Kid`, never `The%20Kid`, in any `dd_*` output. |

**Opener**

> Job J2 of `docs/bozo-execution-plan.md`. Echo the exact RTDB nodes you intend to delete before deleting them. Then fix line 7078 so close capture cannot create a ledger row without `player` and `uid`.

---

### J3 — Phase 2: submit-time price capture · ~10h · the job that ends manual entry

This is workplan Phase 2 plus 2.0 (moved from 1.2) plus 2.5b, pulled ahead of Phase 3. It is the largest M0 job and the one that makes CLV exist.

| # | Task | Acceptance |
|---|---|---|
| J3.0 | Introduce `closeState` (`pending / captured / retryable / unmatched / no_opp / void / late_entry / unmeasured`). Only `captured` is immutable. `bozoCloseTargets` selects `pending` and `retryable`. Run between weeks, never on a live board. | A `retryable` leg is re-attempted next tick until `STALE`. A `captured` close is never overwritten. |
| J3.1 | `/bozo/pick` phase one: resolve canonical key, match SGO event via the registry, fetch the DK quote for **both sides** with alt lines, `assertQuote`. Echo returns captured `price`, `priceOpp`, `line`, `entrySnapshotAt`. Phase one writes nothing. | Echo body contains all four. No RTDB write on phase one. |
| J3.2 | Phase two stores the phase-one captured values without re-fetching. `priceSource: captured`, `providerEventIds.sgo` pinned, `fairEntry` and `entryHold` computed from the real pair. | Stored pick has `priceSource: captured` and a non-null `priceOpp`. |
| J3.3 | Validator rejects a game-market leg (`spread/ml/total`) with null `priceOpp`. This is Bug B. | `dd_draft_bozo_leg` on a spread with no opposing price returns `accepted: false`. |
| J3.4 | Validator requires `startsAt` for any leg that is not `mkt: other`. Resolve from KV (J1.5) if absent; reject if unresolvable. Mark `startsAt` required in `dd_submit_bozo_leg`'s schema. | An MCP submission with only `eventId` is never stored with `startsAt: null`. |
| J3.5 | Tiered policy per D10: `spread/ml/total` reject on capture failure with a distinct reason (`book_absent / line_mismatch / one_sided / no_match`); `prop` falls to `priceSource: self`, `clvEligible: false`; `other` is always self. | Four distinct rejection reasons in tests. A prop with no SGO coverage is accepted and flagged. |
| J3.6 | Typed price is an optional tripwire: if supplied and more than 1.5 probability points from captured, echo shows both and sets `needsConfirmation`. Typed price is stored as `typedPrice` for audit and never used in math. | A 15-point gap is surfaced, not silently accepted. |
| J3.7 | Band check runs on the **captured** price. Echo shows the captured price before any band rejection. | No band rejection without the captured price visible in the same echo. |
| J3.8 | Board renders `priceSource` badge, `clvEligible`, and `closeState` per leg. | A self-priced prop is visibly distinct from a captured leg. |
| J3.9 | `dd_bozo_week`, `dd_bozo_clv`, `dd_draft_bozo_leg`, `dd_submit_bozo_leg` schemas carry every new field. `dd_bozo_clv` adds `coverage: "n/N"`. | Each tool returns the new fields on a live leg. |

**Opener**

> Job J3 of `docs/bozo-execution-plan.md` — Phase 2 of the workplan, tasks 2.0–2.6 and 2.5b. Read workplan §3.2. Before writing, confirm `tests/fixtures/sgo-ncaaf-2026-09-05.json` contains both sides of a spread with alt lines; capture a second fixture if it doesn't. Build J3.0 first, between weeks, and confirm the board is not mid-week before you touch immutability. Never assume a hold.

---

### J4 — D18: roster size is variable · ~3h · alongside J3

| # | Task | Acceptance |
|---|---|---|
| J4.1 | `dawg-bot-worker.js:5109` — `lockCount` must follow `members.length` (or the manager override) when a member joins. | Adding a member to an open board raises `legsNeeded` by one. |
| J4.2 | `lockCount < members.length` is legal. Surplus members can sit out a week without breaking lock. | Test: 9 members, `lockCount: 8`, board locks at 8. |
| J4.3 | Fix the audited literal-`8` hits: bozo.html 3638, 6881, 8399 (behavior/copy); worker 5109 (behavior); stale comments listed in Codex's 09-03 audit. | Grep for leg-count `8` in code and copy returns only the D18 test fixtures. |
| J4.4 | A member joining mid-week does not retroactively change an already-locked board. | Test: lock at 3, add a member, board stays locked at 3. |

**Opener**

> Job J4 of `docs/bozo-execution-plan.md` — D18. Start at `dawg-bot-worker.js:5109`. The league is going to nine members and `lockCount` must track it.

---

### J5 — Commissioner actions (Kap, not Codex)

Not code. Listed so the sequence is visible.

| When | Action |
|---|---|
| After J2 | File the UNT @ IND leg on bozo.html — spread, IND, fill in **Other side**. Saturday noon tests the matcher. |
| After J4 | Add the six remaining members. Not before J4, or the board locks at the wrong count. |
| After J3 | Have every member file a Week 1 NFL leg through the form. All nine should show `priceSource: captured`. |
| Sun 09-13 | Watch capture at each kickoff. Record the rate in `docs/bozo-capture-log.md`. |
| Tue 09-15 | Grade. This is M0. |

---

## 4. Jobs — M1: the numbers are honest

### J6 — Phase 3: archive close + credit meter · ~8h · gated

Do not start until two Sundays of J3 capture data exist (09-13 and 09-20). Gate 3.5: if SGO capture on game markets is ≥ 87% of eligible legs and the 10-minute staleness is tolerable, stay on SGO free and skip the Odds API. Record the decision in `docs/`.

If the gate says build: workplan 3.1, 3.2 (Odds API archive at T+3, promotion from `closeCandidate`, SGO's direct close write retired here and not before), 3.3 (alt-line retry), 3.4 (credit meter in KV, warn on **N × 10 × 4.3**, not a fixed number). Pre-kick `closeCandidate` write is J3-era work (workplan 2.7) and should already exist.

**Opener**

> Job J6 of `docs/bozo-execution-plan.md` — Phase 3. Read `docs/bozo-capture-log.md` first and apply gate 3.5. If the gate says stay on SGO, this job is only 3.4. Read `tests/fixtures/sgo-*.json` and the `getMarket(event, spec, {at})` signature before touching the adapter interface.

---

### J7 — Phase 4: Worst Beat unification · ~6h

| # | Task | Acceptance |
|---|---|---|
| J7.1 | Simulator conforms to grader: SD-normalized, all leg types. Remove the raw-margin path at 4370. | One definition in code and in `data/bozo-rules.json`; simulator == grader on fixtures. |
| J7.2 | Replace `rImp(price) − .022` (6952) with `devigPair(price, priceOpp).fair`; `beatBasis: no-sd` when `priceOpp` absent. | Grep for `.022` returns nothing. |
| J7.3 | SD calibration from prior-season nflverse and cfbfastR results: empirical SD of `(margin − closing spread)` and `(total − closing total)` per sport → `data/bozo-sd.json` with `asOf`. | Table date renders on Docs. |
| J7.4 | Prop SD table for the top 15 stat types (workplan 4.4). | Props participate in Worst Beat; others `no-sd`. |

**Opener**

> Job J7 of `docs/bozo-execution-plan.md` — Phase 4. Start with the `.022` removal at 6952; it is the one that fabricates a number. Then the simulator at 4370.

---

### J8 — Remaining sports + submit validation · ~8h

| # | Task | Acceptance |
|---|---|---|
| J8.1 | `commenceTime` validation at submit: the event must fall inside the league's current week window and be a regular-season game. This is the preseason gap that already bit Kap's Week 1 leg. | A preseason game is rejected with reason `out_of_week`. |
| J8.2 | NBA and CBB adapters on SportsDataverse releases (ESPN ids, UTC starts, completion state, scores). Same scheduled-fetch/current-season/KV shape as J1. Files are 9 MB and 29.5 MB — never per-request. | Both schedules in KV; a leg in each sport grades. |
| J8.3 | NHL adapter on SportsDataverse NHL release. | Same. |
| J8.4 | MLB adapter on the official MLB Stats API schedule endpoint (confirmed 200 from Worker egress; SportsDataverse baseball is dormant). | Same. |
| J8.5 | Lift the J1.4 `sport_not_gradeable` rejection per sport as each adapter lands. | Validator accepts a sport only when its adapter exists. |

**Opener**

> Job J8 of `docs/bozo-execution-plan.md`. Do J8.1 first — it's small and it already caused a live defect. Then adapters in the order NBA, CBB, NHL, MLB, capturing a fixture from each source before writing its parser.

---

## 5. Jobs — M2: a commissioner can run it

### J9 — Phase 5: deadline + placement · ~8h

Workplan 5.1–5.4 unchanged: `settings.deadline` (default Thu 13:00 ET, league tz, DST-safe), `late: true` stamped past it; `ticket` split into `locked` vs `placed` so `boardLocked` is no longer `!!placed` (13503); placement form with N rows per D18 and two-phase confirm; entry → placed → close chart with deadline drift separate from CLV.

**Opener**

> Job J9 of `docs/bozo-execution-plan.md` — Phase 5. Start with the `ticket` split at 13503; Phase 6 depends on it.

---

### J10 — Phase 6: commissioner re-open + audit · ~12h

Workplan 6.1–6.5 unchanged: `/bozo/reopen` manager-only via session `uid` → `league.managerUid`, two-phase, reason ≥ 20 chars, override mode when `ticket.placed`; D12 `ts` unchanged and `commissionerModified: true`; D13 `draw.order` preserved and `preservedThroughReopen` appended; three close branches per §3.5; `admin/actions` written and rendered on Board the same week; stale comments at 6165 deleted.

**Opener**

> Job J10 of `docs/bozo-execution-plan.md` — Phase 6. Test first that re-open never calls `placeAndDraw`; that is the integrity property everything else here protects.

---

### J11 — Phase 7: navigation split · ~16h

Board / Submit / Standings / Manage (gated) / Docs per §3.8. **No explanatory prose on Board, Submit, Standings, or Manage** — every paragraph moves to Docs; each chart gets one caption and a `?` link. Docs carries lever definitions, SD table with `asOf`, CLV method with the de-vig formula, basis and close-state definitions, provider caveats including SGO's 10-minute delay. Charts on real data; demo data behind an explicit "sample" toggle with the ⚠️ retained. Playbill/broadside aesthetic and Data Dawgs characters preserved throughout.

**Opener**

> Job J11 of `docs/bozo-execution-plan.md` — Phase 7. Read the aesthetic constraints in the workplan before touching markup. Move prose to Docs first, then split pages.

---

## 6. Jobs — M3: strangers can join

### J12 — Phase 8: multi-tenant hardening · ~24h

Workplan 8.1–8.6: migrate pick/result/ledger keys from `encodeURIComponent(displayName)` to auth `uid` (D17) with a one-time migration script and dual-read during transition, **run between weeks**; `managerUid` checked server-side on every manager route; sign-up with 21+ attestation, email verification, session expiry; per-uid rate limits on write routes; join-link hash verified in code; XSS pass — every user string via `textContent`; terms + privacy page stating no money on-platform.

**Opener**

> Job J12 of `docs/bozo-execution-plan.md` — Phase 8. Confirm the board is between weeks before starting 8.1. The ledger is not migrated; it is dual-read.

---

### J13 — Phase 9: PWA + notifications + bot · ~20h

Manifest, service worker, guided iOS Add-to-Home-Screen, Web Push on lock and on Bozo named. Discord `/bozo submit` calls the same phase-one/phase-two path so it captures server-side by construction and never hits the 2.5b null-`startsAt` hole.

---

### J14 — Phase 10: public readiness

Invite-only cohort of five leagues. Credit meter data → D6 budget decision → open sign-up. Not before J12 is complete and not before two full graded weeks across the cohort.

---

## 7. Gates

| Gate | Condition | Blocks |
|---|---|---|
| G1 | J1 report says grading works for NFL and CFB from Worker egress | Any leg being filed with the expectation of grading |
| G2 | J2 done | Roster additions; filing the UNT @ IND leg |
| G3 | J4 done | Adding the six remaining members |
| G4 | J3 done and one Sunday of capture data recorded | Calling M0 complete |
| G5 | Two Sundays of capture data | J6 |
| G6 | J7.3 calibration committed | Any public cohort (M3) |
| G7 | J12 complete | J14 |

---

## 8. What each Codex report must contain

Every closing report, no exceptions:

1. Each acceptance line from the job, answered yes/no with the evidence (test name, tool output, line number).
2. Every RTDB or KV write that was executed, with the echo that preceded it.
3. Every deploy id.
4. Any deviation from the workplan's decisions, flagged as a deviation — not silently absorbed.
5. Anything discovered that isn't in this plan, listed separately from the job's own results so it can be triaged rather than lost.

The 09-03 session produced two findings that weren't in any plan — the ESPN egress block and the browser/Worker path split — and both were surfaced only because the report said what it found beyond what it was asked. Keep doing that.
