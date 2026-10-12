# DFS Labs manual lineup builder

Local review implementation, 2026-10-12. No publication authorized.

## Verified baseline

Current main at inspection: `74d729cfa24d84b7fee0edb4fc361c0c3940150b`.
The downloaded public `https://datadawgs216.com/dfs.html` was byte-identical to
that checkout (SHA-256 `26a51b8a7875bff39843a0b7532c3304918345a01209cddb3a822683a6cda855`).
Re-fetched main during implementation; it had not advanced.

Already shipped: the visual atlas, CSV/slate workspace, solver, modelled simulator,
exposure, standings ledger, and private decision desk with audit import/export,
source/availability unknowns, roster checks, swap checks and entry evidence.
The parent page also has an explicit private workspace save/load path. This is
not evidence of persistent account audit history or simulator calibration.
Missing: a direct manual player-pool-to-roster workflow with live diagnostics.

## Integration and privacy

- `dfs.html` adds **Build by hand** next to the atlas actions. It opens the
  **Lineup builder** tab of the existing `dfs-diagnostics.html` iframe. This is
  part of DFS Labs, not a new website or independent site shell.
- Keep `sandbox="allow-scripts allow-downloads"`, opaque origin, `data-ddb-skip`
  and the desk CSP (`connect-src 'none'`). No cookies, telemetry, storage or
  account writes for builder inputs. Only ready/layout-height messages leave
  the child. The existing explicit workspace capture is one-way into the desk.
- Complete mechanical passes can be appended to the existing audit as
  **proposed** entries. Never mark them entered. A different audit pool is
  preserved and must be exported/cleared explicitly before replacement.
- Private audit export retains roster, pool, input mapping and ownership
  conventions. Builder reset discards its pool and comparison; audit clear
  discards the audit without discarding a separate in-progress build.

## Import contract

- One header followed by 1–220 rows, one base/FLEX row per player; maximum 2 MB.
  Reuse the existing CSV parser after strict quote/shape checks. Support BOM,
  CRLF, quoted comma/newline, escaped quotes and quoted currency.
- Preview the first three rows and every mapped field. Exact alias matching,
  editable column selectors, no fuzzy cross-column matching. No silent dropped
  player rows. Duplicate canonical name/team rejects the import atomically.
- Detect DK/captain header signals, but require explicit DK NFL Classic or
  Showdown confirmation and the exact slate/game/date label. Preserve other
  platforms in the existing workspace; no new unsupported legality claim.
- Ownership units are a file-level explicit choice: percentage points or
  fractions. `0` is known; blanks/NA are unknown. Percentage-sign cells conflict
  with fraction mode. Small Field/Large Field selection is visible in mapping.
- Showdown generic ownership requires explicit total-including-CPT, FLEX-only,
  or unknown convention. Total minus CPT is used only when both are supplied;
  negative or conflicting results reject. CPT/FLEX missingness stays visible.
- Use supplied CPT salary and projection once. Otherwise derive base × 1.5
  once. Never multiply already supplied CPT values again. Preserve supplied
  non-1.5 projection differences; future simulations must reconcile them.
- Require explicit opponents for matchup checks. Where a Showdown CSV omits
  them, the user can explicitly confirm `AAA @ BBB`; label that evidence and
  reject conflicting teams. Do not infer opponents from a two-team file.
- Source time is distinct from import time. Missing source/injury timestamps
  remain unknown. Six hours is a review threshold, not availability clearance.
- A failed import retains the current build. A new valid import resets roster,
  filters, selection, drag state and pinned comparison. Generation counters
  discard file reads completed after reset or a newer import.

## Construction and diagnostic contract

- Desktop drag/drop, touch Add, target-slot selection, and keyboard Move/Place.
  Occupied slots replace a pool player, or swap two rostered players only if
  both are eligible. Uniqueness always holds. Escape/dragend/blur cancel drag.
- Search name/team, filter position/team, sort projection/salary/ownership/
  points per $1k/name. Responsive roster precedes pool on phones.
- DK Classic: QB, RB×2, WR×3, TE, FLEX (RB/WR/TE), DST; $50,000 and at least
  two mapped games. DK Showdown: CPT + FLEX×5; $50,000, one game, two teams,
  maximum five players from a team. Reuse `DDFSDiagnostics.roster`.
- Show salary used/remaining and average per open slot, projected points,
  points per $1k, slot ownership sum/coverage, and deltas to an explicit pinned
  build. Missing numeric inputs must not become zero. Do not call a projection
  or efficiency ratio realized performance.
- Player scatterplots use salary or ownership versus base projected points;
  roster dots are highlighted. The top build plot uses summed ownership
  percentage points, not uniqueness. Negative projections are valid inputs.
- Stacks, bring-backs and offense versus defense are structural relationships.
  Do not invent a numerical correlation, guaranteed ceiling or quality score.

## Requested simulation dashboard: deliberate unavailable states

The review UI includes a built-lineup chart, a cash/tournament category legend,
and 100 / 1,000 / 10,000-entry comparison panels. They show **unavailable** for
cash rate, top-1%, estimated copies, cash/first-place cutoffs, ROI and suitability
regions. They explicitly show sample count zero and no attached model/seed.
These are illustrative field sizes, not generated results. No numerical
simulation result is cached, accepted or reused by the builder.

The existing `work/dfs-engine.js` v2 is a useful starting point: it shares
player/game outcomes across candidates and opponents, has seeded sampling,
payout/tie helpers, conditional Monte Carlo intervals and partial-field gates.
It is not enough to wire directly into this CSV-only builder:

1. Builder files can lack game IDs, empirical dispersion/correlation evidence,
   full slot ownership and official salary/availability data. The engine groups
   by `gid`; missing IDs must never silently pool unrelated games.
2. The engine score model uses position CV/correlation estimates and sampled
   opponents. It has no validated slate-specific ceiling/field calibration
   receipt. Default stack rates, salary floors and field ownership fit need
   review against contest-specific observations.
3. `win` means tied-or-alone first; `firstShare` differs. In a field of identical
   rosters, `win` is 100% but first-place share is 1/N. `top1Share` uses a copy
   adjustment rather than complete tied-cutoff place allocation. Do not market
   either as outright victory or calibrated uniqueness.
4. `evAdj` divides an already tie-split prize by an optional copy prior. That
   second adjustment needs an explicit model justification, not blind reuse.
5. Supplied non-1.5 CPT projections differ from the engine's fixed 1.5 scoring;
   source reconciliation is required. Cash and first-place score cutoff
   distributions are not retained by the existing engine.

### Required implementation before enabling those outputs

- Snapshot exact contest fee, field size, entry limit, full payout ladder,
  field composition/ownership convention, source dates and model versions.
  Permit clearly named illustrative profiles, never imply they are real lobby
  evidence. User contest goals and concentration preferences remain separate.
- Validate all candidate and sampled opponent rosters. Generate each world's
  player outcomes once and score every entry on those same outcomes. Use
  sourced score distributions/correlations, with documented uncertainty and
  explicit error handling; no silent independent fallback for failed matrices.
- Simulate full fields where required for extreme ranks. If approximate field
  samples cannot resolve top-1% or first place, withhold those outputs. Define
  the small-field top-1% boundary as `max(1, floor(N * .01))`, show the actual
  place count, and handle ties explicitly at every cutoff.
- Retain per-world cash cutoff and maximum-opponent score, then show quantiles
  (e.g. 10/50/90) with seed/world count/Monte Carlo uncertainty. Cash cutoff,
  first-place score and fee break-even are different quantities. Monetary
  return uses full payouts and actual tie splits exactly once.
- Copies come from a validated opponent-construction model or observed field,
  with intervals and sample-size warnings. A marginal ownership product is
  only a labelled independence proxy; it is not a duplication probability.
- Hash canonical player data, slots/CPT, slate, source revisions, contest
  settings and model/seed before dispatch. Clear rates synchronously on any
  change. Workers must return that hash plus run generation; accept only the
  active hash/generation. Cancelled/older workers cannot overwrite fresh state.
- Reproducible-seed, tie-cutoff, small-field, full/partial-field, invalid-input,
  cancellation, out-of-order worker and model-revision tests are release gates.
- Color suitability regions only from documented output comparisons under the
  user's goal. No arbitrary winning zones or imposed allocation targets.

## Review and validation

### Local visual revision 2

Keep the approved section order and private iframe boundary. The revised skin
uses charcoal, orange and cream with violet reserved for a projection sensitivity
scenario. The keyboard/touch range changes only that labeled scenario; it never
changes source projections, lineup legality or probabilities. The chart can switch
between salary and summed ownership. The adjacent histogram counts actual loaded
player projections and highlights rostered players; it is not an outcome curve.
Slot placement uses a brief settling animation, disabled for reduced motion.
No sound, urgency, winning zones or reward mechanics are added. Browser QA covers
360/390px and desktop widths, light/dark, range keyboard control, axis taps and
unchanged base arithmetic. The visual revision still needs Jason's review.

`node --test tests/dfs-builder.test.js tests/dfs-simulation-contract.test.js`
tests importer/roster arithmetic and mechanical behavior of the unchanged
legacy simulator. The latter proves no model calibration.
`tests/dfs-builder.browser.cjs` uses Playwright/Chrome with synthetic fixtures
and blocked external traffic. It covers desktop/mobile touch, keyboard,
drag interruption, repeated import/reset, read races, CPT swaps, audit/export
and parent-frame privacy. `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`, and `QA_OUTPUT`
can point at local installations/output folders.

Keep screenshots under ignored `work/artifacts/dfs-builder` or a private output
folder. Never commit uploaded projection data. User visual review is required
before any push, merge, deployment or publication. The current design remains
a local proposal. No separate master prompt is needed: this specification is
the reusable handoff for Claude or another contributor.
