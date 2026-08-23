# The Dog Track (Rankings Report Card) — authoritative spec

**Status:** approved design + approved methodology. The visual contract is
`work/dog-track-mockups-v2.html`.

**Tier:** launches as a **Pup**. Promotion gate declared in §3 — do not claim more.

**Deploy window:** nothing ships before **Aug 29** (draft-night freeze Aug 21–28). Hard
deadline: capture pipeline + methodology page live before NFL Week 1 TNF (~Sep 10, 2026).
The first `captured_at` cannot be backfilled.

> This file is the authority. Where the engagement prompt (appendix) and this spec
> conflict, this spec wins. Where it is silent, follow the site's existing patterns —
> Bozo/SwoleDawg for Worker routes, cfb.html/arena for pages — and `AGENTS.md`.

## 1. What this is

A public tool that grades fantasy ranking services (ETR, PFF, ESPN, + "The Blend"
consensus) against actual weekly PPR finishes. Kap uploads each service's ranks every
Thursday before TNF kickoff; the tool grades after MNF and publishes **derived scores
only**.

**Hard legal constraint, enforced by architecture:** raw third-party ranks are paid
content and must NEVER appear in the public repo, in any public JSON, in any public API
response, or in client-side source. Raw ranks live only in Firebase behind toto auth. If
you ever find yourself writing a player-level third-party rank into anything public, stop
— you have the architecture wrong.

## 2. Non-negotiables (site doctrine, applies fully)

- **Append-only:** snapshots and graded weekly rows are immutable once written. Season
  aggregates are recomputed from graded rows (derivable = OK to rebuild).
- `captured_at` is **server-stamped by toto** at snapshot write. Never client-supplied.
  `captured_at < first kickoff of that NFL week` is checked at write; **reject** late
  snapshots rather than accepting them ungraded.
- Email/auth patterns unchanged; this feature adds one admin capability gated by a new env
  secret, not a new auth system.
- **Methodology is pre-registered:** the methodology section publishes before Week 1. Any
  amendment after Week 1 requires a dated note on the page stating what changed and why.
- The page never claims a winner the math doesn't support. Ties render as **PHOTO
  FINISH**. "Provisional" until the declared gate.

## 3. Pre-registered methodology (implement exactly)

**Services graded:** open entrants registry, not a fixed list. Launch entrants: ETR, PFF,
ESPN, BLEND. Admin can register new entrants at any week (a newly-found service, or house
entries like "Kap's Ranks") via the admin page; each entrant carries
`{id, name, type: service|house, first_week, color}`.

**BLEND** = per-player mean rank across all service-type entrants registered before Week
1's first kickoff (launch roster TBD — at minimum ETR, PFF, ESPN). The Blend's membership
**freezes at Week 1** and is named on the methodology page; entrants registered Week 1
onward NEVER join it (a mutating benchmark corrupts comparability). BLEND per-player ranks
are derived from paid inputs and stay private; only its scores publish. House-entry raw
ranks are also private by default (scores public).

### Late entrants & comparability (doctrine: identical game sets)

- Every entrant's season aggregates compute only over **its** graded weeks;
  `weeks_graded` displays everywhere its score does.
- **Headline season metric for cross-entrant comparison = relative-to-field:** entrant's
  weekly ρ minus the BLEND's ρ that same week, averaged over the entrant's graded weeks.
  Comparable across entrants with different spans; absolute season ρ still shown per
  entrant.
- Head-to-head / photo-finish calls between two entrants compute on their **matched weeks
  only**. If matched n < 4, render "insufficient overlap" instead of a call.
- An entrant with `weeks_graded < 4` is always "Provisional — small sample" regardless of
  score.

### Views: weekly + season

Every view (Board, Race, Wild Weeks, Cage, Report Card) gets a **week selector** alongside
the position scope: `SEASON | W1 | W2 | …`. Week view shows that single week's metrics per
entrant — **no CI, no shrinkage** (it's one observation); badge every week view
"one week ≠ skill". Season view = current behavior.

### Scoring

- **Baseline:** full PPR points that NFL week (canonical). Actual finish = within-position
  rank by PPR points, **mid-ranks for ties**.
- **Pool** per position per week: union of (consensus top-N across uploaded services) ∪
  (actual top-N by PPR). Depths: **RB 36, WR 48, QB 24, TE 24**.
- **Unranked-but-relevant player:** slot at that service's deepest ranked player + 1 (ties
  broken by consensus order). Never drop pairwise.
- **Inactives / byes / ruled OUT (did not play):** removed from the correlation pool.
  Separately increment that service's **hygiene** counter if a player who was officially
  OUT at capture time sat inside the startable range (top 24 RB/WR, top 12 QB/TE) of that
  service's list. Hygiene never touches the correlation.

### Metrics per service × position × week (all three, no fourth)

1. **Spearman ρ** (headline) — service rank vs. actual rank on the pool.
2. **Weighted Kendall τ** — hyperbolic weights on actual-finish rank (scipy `weightedtau`
   semantics; implement in JS: additive hyperbolic weighting, `w(r) = 1/(r+1)`).
3. **Capture rate** — (PPR points scored by the service's top-G group) ÷ (PPR points
   scored by the actual top-G group). G: **RB 12, WR 12, QB 6, TE 6**.

**Season aggregation:** mean of weekly values per position. **ALL scope** = equal-weight
mean across the four positions (declared choice; state it on the methodology page). No
dropped weeks, no mulligans.

**Uncertainty:** bootstrap 95% CI on the season mean (resample weeks with replacement,
2,000 draws, percentile). **Shrinkage:** `shrunk = field_mean + 0.7 × (raw − field_mean)`
until Week 10; from Week 10, use empirical-Bayes weight
`w = var_between / (var_between + var_within/n)` if implementable cleanly, else keep 0.7
and note it. Display shrunk as the headline number, raw + CI in the range line.

**Tie rule (PHOTO FINISH):** any service whose CI upper bound ≥ the leader's CI lower
bound is tied with the leader for that scope.

**Letter grades (Report Card):** blended percentile of the three metrics vs. the field per
scope, mapped: ≥90 A, ≥80 A−, ≥70 B+, ≥60 B, ≥50 B−, ≥40 C+, else C. Tied services display
the leader's grade.

**Promotion gate (declared now):** Pup → Working Dawg at season end only if ≥1 service pair
separates with non-overlapping shrunk CIs on the ALL scope. If not, the page says so
plainly (nfelo-style) and stays a Pup.

## 4. Architecture

Pattern: page ↔ toto ↔ Firebase (same as Bozo/SwoleDawg). No GitHub Action, no new repo
secrets, no raw data in repo.

### Firebase paths

```
/rankings/entrants                            ← registry {id:{name,type,first_week,color}}
/rankings/snapshots/{season}/{week}/{entrant} ← PRIVATE. {rows:[{rank,name,team,pos}],
                                                 captured_at, sha256, source_label}
/rankings/graded/{season}/{week}              ← PRIVATE per-week graded rows (immutable)
/rankings/public/{season}                     ← derived season doc, rebuilt each grade run
/rankings/aliases                             ← name → player_id alias map (grows over time)
/rankings/log                                 ← append-only event log of every write
```

### toto routes

New, in a new `work/` module; assemble via `work/assemble.mjs`.

- **`POST /rankings/snapshot`** — admin only (header `x-dd-admin` checked against new env
  secret `RANKINGS_ADMIN_KEY`; add via dashboard vars, not code). Body:
  `{season, week, service, csv}`. Server: parse, validate (position tags present, ranks
  contiguous, ≥ depth minimums), stamp `captured_at` (server time), verify
  `captured_at < week_first_kickoff` (kickoff table fetched from ESPN scoreboard fallback
  endpoint and cached at week open), write append-only, log. **Idempotency:** sha256 of
  normalized CSV; re-POST of identical content = no-op returning the original receipt.
  Re-POST of different content for the same service/week = **rejected** (snapshots are
  immutable; a correction requires a new week or a logged admin void that keeps the
  original).
- **`POST /rankings/grade`** — admin only. `{season, week}`. Fetches actual PPR stats
  (source order: Sleeper stats API → ESPN fallback `site.api.espn.com`), matches names via
  alias map, computes all metrics per §3, writes `/graded/{week}` (refuses if it already
  exists), rebuilds `/public/{season}`. Returns a summary + unmatched-names list.
- **`GET /rankings/grades?season=2026`** — public, no auth. Returns the derived doc only.
  **This is the ONLY public read.** Register it in the surfaces map + a read-only MCP tool
  `dd_rankings_grades` ONLY after the tool-honesty gate passes (Stage E).

### Public derived doc shape (`/rankings/public/{season}`)

```json
{ "season":2026, "weeks_graded":8, "scoring":"PPR", "updated_at":"…",
  "scopes": { "ALL": { "ETR": {"rho":.62,"rho_raw":.63,"ci":[.55,.71],"tau":.58,
                              "capture":82.2,"hygiene":1,"grade":"A-",
                              "tied_with_leader":true,"weekly_rho":[…]}, … },
              "RB":{…},"WR":{…},"QB":{…},"TE":{…} },
  "method_version":"1.0", "provisional": true }
```

`weekly_rho` arrays are derived scores (safe to publish). Nothing player-level, ever.

### Pages

**`rankings.html`** — public page, "The Dog Track." Port the approved mockup 1:1: five tabs
(🏆 Report Card = **landing tab**, 🐕 The Race, 🎰 The Board, 🎲 Wild Weeks, 🪙 The Cage),
ALL+position scope toggle on every view, PLAIN ENGLISH explainer box on every view (copy
from the mockup verbatim), photo-finish tie treatment, count-up numbers, chip-stack
animation, re-run button, `prefers-reduced-motion` respected. Dark is this page's default
(live-board exception pattern: early inline script sets default dark unless
`dd-theme2-rankings` is set). Standard site nav. Fetches `GET /rankings/grades`; renders an
honest empty state before Week 1 grades exist ("Season opens Sep 10 — methodology below,
receipts to follow"). Methodology section lives ON this page in a `<details>` drawer
(Playbill pattern), pre-registered content per §3, with the amendment-note rule stated.

**`rankings-admin.html`** — unlisted admin page (not in nav, noindex). Renders entirely
from the entrants registry — **zero hardcoded service names** anywhere in admin or public
UI. Sections: (1) add entrant (name, type, color) → registry; (2) one paste box PER
REGISTERED ENTRANT, generated dynamically, with per-entrant Snapshot buttons and a
snapshot-status strip for the week (captured ✓ / missing / voided); (3) Grade button;
(4) unmatched-names review list with add-alias action. Admin key stored in
`localStorage["dd-rankings-admin"]`.

### Placement & site registration (mandatory, all in the deploy commit set)

- **Nav:** dropdown item inside the **ARENA** group (label "Dog Track"). NOT a ninth
  top-level group — the nav row is at its measured width limit (5.1px spare at 420px). A
  dropdown item costs no row width. Nav change = re-flatten ALL pages (nav.js is inlined
  everywhere) + `sw.js` VERSION bump in the same commit. Run the nav fit/overlap tests.
- **Arena hub card:** add the tool to `arena.html` — ⚠️ `arena.html` is generated by
  `work/build_arena.py`; edit the builder, never the page, or the card reverts on next
  rebuild. Same for `TIER_LABEL` drift guards.
- **Tier chip:** `rankings.html` carries
  `<a class="tierchip" data-tier="labs" href="index.html#tiers" title="Why this page is a Pup">Pup</a>`
  — `surfaces.json` derives tier by scanning the live chip.
- **`/data/` mirror:** publish the derived grades doc to `/data/rankings-grades.json` at
  each grade run with the required envelope (`as_of`, `source`, `tier`, `graded`).
  `tools/validate-data.js` must pass. `graded: true` only once Week 1 rows exist.
- **Machine index:** rebuild `surfaces.json` (new surface row, honest `status`) and add the
  page to `llms.txt` and `sitemap.xml`. The challenge.html miss — a live page invisible to
  the machine index — is the named prior mistake; grep `llms.txt` for `rankings` as an
  acceptance check.

### CSV paste format (admin page validates before send)

```
pos,rank,player,team
RB,1,Rusty Kettleman,ATL
```

One paste per service covering all four positions. Ranks restart at 1 per position.

> The player name in the example above is invented. Per engagement rule 2, no real
> third-party rank line appears in this repo — examples and test fixtures included.

## 5. Build order

- **Stage A** (build during freeze, CANNOT deploy): Worker module — snapshot route +
  validation + kickoff-time check + idempotency + log. Local: `node --check`,
  `node work/assemble.mjs`, smoke tests.
- **Stage B:** grade route — stats fetch, name matching + alias flow, metrics (§3 exactly;
  unit-test Spearman/τ/capture against hand-computed fixtures; ≥20 assertions including tie
  mid-ranks, unranked imputation, inactive removal, hygiene), bootstrap + shrinkage, public
  doc rebuild.
- **Stage C:** `rankings.html` port from mockup + empty state + methodology drawer;
  `rankings-admin.html`.
- **Stage D** (Aug 29+): deploy Worker (paste ceremony rules apply), deploy pages, bump
  `sw.js` VERSION in the same commit as any HTML change.
- **Stage E:** dry-run week — snapshot a test service for the current preseason-ish window
  OR replay a 2025 week if the kickoff check is bypassed via an explicit `dry_run:true`
  flag that writes under `/rankings/snapshots/0/…` (season 0 = sandbox, excluded from the
  public doc). Verify the full loop. Then register surface + MCP tool.
- **Week 1 live:** Kap pastes four services Thursday Sep 10 before kickoff. Grade Tuesday
  Sep 15.

## 6. Named traps

1. **Name matching is the failure mode of this entire feature.** "Kenneth Walker III" vs
   "Kenneth Walker", "Hollywood Brown" vs "Marquise Brown", "Gabe/Gabriel Davis", D/ST
   naming. Normalize: lowercase, strip punctuation and suffixes (Jr/Sr/II/III/IV/V),
   collapse whitespace; then exact match on (normalized name + team + pos); then alias map;
   then **fail loudly** — unmatched players go to the returned review list and are EXCLUDED
   from that week's grade with a count shown in the public doc (`"excluded_unmatched": n`).
   Never fuzzy-match silently; a wrong merge corrupts a graded row you can't mutate.
2. **The race animation dead-dog bug:** dogs animate via a `left` transition; setting the
   final `left` in the same frame as the `innerHTML` render means no transition fires. The
   mockup uses **double `requestAnimationFrame`** before setting final positions, and
   re-triggers on tab-switch. Keep both or the dogs sit at the gate.
3. **Paste ceremony (Cloudflare):** editor-pane Ctrl+A not browser Ctrl+A; auto-indent
   corruption; CRLF expected; `node --check` before every paste; assemble via
   `work/assemble.mjs` — never hand-edit the assembled output.
4. **Concurrent writers:** `git fetch && git reset --hard origin/main` before editing and
   again before committing. One agent writes at a time.
5. **Kickoff-time source:** the `dd_scores` proxy can 403; the ESPN fallback
   (`site.api.espn.com/...scoreboard?dates=YYYYMMDD`) is the documented recovery path.
   Cache the week's first-kickoff timestamp at the first snapshot attempt so a Thursday
   ESPN outage can't block capture — if BOTH sources fail, accept the snapshot with
   `kickoff_check:"deferred"` and verify at grade time (reject then if late; log either
   way).
6. **Blend leakage:** BLEND per-player ranks are recoverable inputs → they stay private
   like the services. Only BLEND's scores publish.
7. **No webfonts** (Playbill doctrine). The LED look is mono + text-shadow, already in the
   mockup.
8. **Theme default:** this page defaults dark via the live-board early-inline-script
   pattern; do NOT change the global `dd-theme2` fallback or bump the theme key.
9. **`weekly_rho` sparkline scale is fixed .35–.85** in the mockup; clamp values outside it
   rather than rescaling per-service (rescaling makes services incomparable at a glance).
10. **Immutability vs. bad uploads:** if Kap pastes the wrong CSV, the fix is an admin void
    (logged, original retained, flagged `voided:true`, excluded from grading) + a new
    snapshot BEFORE kickoff. After kickoff: the week grades on what was captured, or the
    service shows `"no_snapshot"` for that week. **No silent replacement, ever.**
11. **Week view is not season view with n=1 styling.** No CI, no shrinkage, no photo-finish
    logic on a single week — those are season constructs. Week view shows raw metrics + the
    "one week ≠ skill" badge. Reusing the season renderer unmodified will print a CI of
    width zero and imply certainty.
12. **Entrant colors:** registry-assigned, never derived from array index — a mid-season
    entrant must not shift everyone else's colors (same class of bug as the drawer-index
    shift).
13. **The UI must render N entrants, not 4.** Race lanes, Board rows, Cage stack columns,
    Report Card grid all generate from the public doc's entrant list. Cage grid:
    `repeat(auto-fit, minmax(64px,1fr))` instead of `repeat(4,1fr)`; Race container height
    grows per lane; Wild Weeks SVG height computed from entrant count. Test the sandbox
    season with 7 entrants so a 5th source added on launch day is a paste, not a code
    change.

## 7. Acceptance gates

- [ ] Metric unit tests pass (fixtures with hand-computed Spearman/τ/capture, ties,
      imputation, inactives, hygiene).
- [ ] Snapshot idempotency + immutability + late-rejection tested (jsdom/Node smoke).
- [ ] Grade route refuses to re-grade an existing week.
- [ ] Public doc contains zero player-level third-party data (grep the doc for any uploaded
      player name — must be empty).
- [ ] `rankings.html` renders empty state, then full state from a sandbox-season doc; both
      themes; mobile (Race lanes and Cage chips are the risky spots); reduced-motion.
- [ ] `sw.js` VERSION bumped with the HTML commit.
- [ ] Methodology drawer content matches §3 verbatim; amendment rule stated.
- [ ] Dry-run loop (Stage E) completed before any surfaces-map/MCP registration.

## 8. Explicitly out of scope (do not build)

Open self-serve rank submission by signed-in users — that is v2, after the season proves
the loop (needs per-user auth on submission, per-user prospectiveness enforcement,
abuse/rate handling). v1 entrants are admin-registered only, which already covers new
services found mid-season and house entries. Also out: disagreement-as-signal, start/sit
head-to-head products, feeding ranks into site models, **additional metrics beyond the
three**, historical backfill of any kind. Adding entrants mid-season is IN scope (that's
the registry).

## 8.5. Interop with the local draft-ranks pipeline (kap-gamingpc, outside repo)

A separate local pipeline exists (`normalize.py`, `fetch_fantasypros.py`, `aliases.csv`,
`ranks_wide.csv` — draft-prep, NOT weekly grading). Shared contracts:

1. **One normalization spec.** Document the name-normalization rules once (lowercase; strip
   punctuation; strip Jr/Sr/II–V; collapse whitespace; match on name+team+pos) and
   implement identically in `normalize.py` and the Worker. Share test fixtures. Divergence
   here recreates trap #1 across systems.
2. **Alias source of truth:** the local `aliases.csv` seeds `/rankings/aliases` (one-time
   import at deploy). New aliases discovered in either system get added to both — same
   format.
3. **FP ECR is a launch entrant candidate** (free, public). v1 = manual Thursday paste like
   everything else. v1.5 (post-launch, only after `fetch_fantasypros.py` is verified
   locally): the fetcher POSTs to `/rankings/snapshot` with the admin key on a Thursday
   cron — same route, same server `captured_at`, no special path. Board note: ECR is itself
   an expert consensus, so BLEND-vs-ECR is a featured matchup.
4. **Draft ranks never enter the grading ledger.** `ranks_wide.csv` is season-long draft
   data; the Dog Track grades weekly snapshots only. No backfill (§8 stands).

---

## Appendix — engagement rules (from the build prompt)

The handoff above wins on any conflict with this appendix.

1. **DEPLOY FREEZE until Aug 29.** Build and test locally (Stages A–C). Do NOT push to
   `main`, paste to Cloudflare, or touch anything that serves the live site before Aug 29.
2. **Raw third-party ranks never touch anything public** — not the repo, not `/data/`, not
   any public route response, not client source, not test fixtures committed to the repo
   (use invented player lists in fixtures).
3. **One stage at a time.** Complete a stage, run its gate, report results, STOP for Kap's
   checkpoint. Do not batch stages.
4. **Append-only doctrine.** Snapshots and graded weekly rows are immutable. Corrections =
   logged void + new snapshot before kickoff, never replacement. `captured_at` is server
   time, never client-supplied.
5. **Git hygiene:** `git fetch && git reset --hard origin/main` before editing and again
   before committing.
6. **Worker changes:** edit source modules under `work/`, assemble with
   `node work/assemble.mjs`, gate with `node --check` on the assembled output. Never
   hand-edit assembled output. The Cloudflare paste is performed by Kap (paste ceremony);
   the deliverable is a clean assembled file plus paste instructions.
7. **Any HTML change ships with an `sw.js` VERSION bump in the same commit.** A nav change
   means re-flattening ALL pages.
8. **Methodology is pre-registered.** Implement §3 exactly. Do not improve, substitute, or
   add metrics. If something in §3 is wrong or unimplementable, stop and raise it — do not
   silently deviate.
9. **Do not build anything in §8's out-of-scope list.**

### Definition of done

Every acceptance gate in §7 checked and reported; the promotion gate (Pup → Working Dawg
criteria) stated on the page; zero third-party player-level data reachable publicly; Kap
has paste-ready Worker output and a one-page Thursday runbook (register entrant → paste →
verify capture strip → Tuesday grade → check unmatched list).

---

## Deviations from this spec, and why

Recorded here as they are taken, per rule 8. Each is raised at a stage checkpoint rather
than applied silently.

### D1 — kickoff source order (Stage A, ratified by Kap 2026-08-23)

§4 and trap #5 name the ESPN scoreboard as the kickoff source. The Worker already
documents at its `/scores` route (8/4/26) that **ESPN answers 403 to Cloudflare Worker
egress** and 200 to a browser on the identical path — an IP/ASN block, three header shapes
tested, "another permutation will not fix it." Taken literally, ESPN fails every Thursday,
every capture lands in `deferred`, and the pre-kickoff gate silently degrades into a
grade-time post-mortem.

**Resolution:** the site's own canonical `data/nfl-schedule.json` (nflverse-derived, the
same source the survivor receipt ledger refuses captures against) is consulted first; ESPN
stays exactly where the spec put it as tier 2; `deferred` remains the last resort. The
property the spec asks for — a capture that could not have been written after kickoff — is
preserved rather than weakened.
