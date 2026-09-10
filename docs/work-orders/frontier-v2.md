# Showdown frontier v2 — reconciled implementation order

The goal is five inspectable candidates: exact projection benchmark, cash,
3×, 5×, and a large-field tournament candidate. Projection, duplication and
correlated outcomes answer different questions. A rare lineup is not necessarily
playable; a projection-dominated lineup can still have a valuable upper tail.

## 1. Input hygiene

Use a configurable 0.25% ownership floor as an explicit modelling assumption.
Preserve the raw values. A reported zero is floored; missing/invalid ownership
blocks candidate recommendations. Keep every positive-projection player eligible,
including low-owned punts. Locks, exclusions, salary limits and team limits still
apply. A missing or nonpositive projection is not silently assigned upside.

Record filename/paste source, import time, file SHA-256, relevant columns and
player count. Provider update time is unknown unless supplied; an import timestamp
is not proof that ETR has not changed its numbers. Flag imports over six hours old.
Mixed/retained projection and ownership snapshots cannot pass recommendation gates.

Reconcile the chart maximum to an independent captain-first branch-and-bound
search over the same loaded players and generation constraints. The chart worker
enumerates six-player sets first. Compare within 0.01 points; explicitly return
INCOMPLETE on timeout. Test custom captain salary/projection fields, locks,
exclusions, and salary/team rules. Recompute three products from slot inputs.

The original NE@SEA CSV is not in the provided attachments. Its claimed 92.2
maximum and the phone's 93.0 snapshot remain unverified. An ownership floor cannot
change lineup projection; it changes rarity ordering. Reconciliation verifies the
loaded snapshot, not whether it is the correct slate or newest provider update.

## 2. Simulator correctness

Each candidate is a separate hypothetical entry facing N−1 opponents. Adding
candidates cannot change an existing candidate's draws, rank, payout or confidence
interval. Candidate pools are not submitted portfolios. Tie payouts average the
prizes covered by the tie, including ties across the cash cutoff. Keep captain
identity in duplicate keys. Separate field sampling from score-world randomness.

Ranks extrapolated from a smaller field remain approximations. Beating every
sampled opponent is not a verified first-place finish in a 132K field. Report
first place only with a full modelled field; otherwise show unavailable. Top-1%
needs adequate tail resolution. Report simulation error separately from field,
projection and correlation model uncertainty. Use independent scoring worlds to
evaluate a shortlist chosen on the first half of the simulations; do not reselect
using the evaluation results.

The v2 engine has separate CPT/FLEX field weights, independent candidate scoring,
exact sorted-score ties and payout-prefix sharing. It reserves half the scoring
worlds for validation and provides Wilson intervals for binary rates. Fractional
cutoff shares use a conservative bounded-mean interval. The sample field is fixed:
these intervals do not include its uncertainty. A zero duplicate observation gets
an explicit nonzero upper bound. First place and top-heavy ROI are unavailable
when the opponent field is extrapolated. Flat payout expectations can still
be estimated near their payout cutoff. Runtime captain/FLEX projection mismatch
flags prevent recommendation labels when 1.5× scoring and the imported means disagree.

## 3. Contest-aware chart

Keep the projection benchmark visible. Select candidates by cash rate, payout
cutoff rate for 3×/5×, and a clearly defined duplicate-adjusted top-1% heuristic
for large-field GPPs. Show plain top-1%, top-10%, prize sharing, projection cost,
Monte Carlo interval and first place separately. These are model candidates,
not certified profitable recommendations. Overlapping uncertainty means the
ranking is unresolved; do not force five different lineups.

The copy axis is N × captain ownership × five FLEX ownership terms (FLEX is
total minus captain, or a separately supplied FLEX column). This is an
unnormalized independence proxy, not a calibrated probability. A calibrated joint
lineup probability would imply (N−1) × probability of additional copies.
Keep C=1; do not compound observational pairwise ratios as fitted coefficients.
Label zones low/moderate/high duplication, never GPP-safe/cash-only. A chalk
lineup is not mathematically required to exceed one copy in this proxy.

Display five-slot core product and each slot's contribution to −log10(product)
as diagnostics. Core-frontier membership and a 50% log-share cap are not equivalent.
Neither deletes punts or projection-dominated correlated-upside candidates.
Keep a meaningful random cloud and the frontier band for simulation.

Tap/hover/long-press inspection shows the roster, projection, salary, ownership
used, raw values, copy proxy, correlation story and simulation evidence. Contest
presets are editable examples; paid places/payout structure matter as well as N.

## Evidence and its limits

- [ETR, NFL Showdown 101](https://establishtherun.com/nfl-showdown-101/)
  reports product ownership as its strongest single duplication correlate
  (r²=.43). Its observed same-team RB duplication ratio is 6.6/8.5, below one.
  Those group averages do not identify independent conditional coefficients.
  The article body discusses historical seasons despite a recent page date.
- [Fantasy Team Advisors, 163-slate study](https://fantasyteamadvisors.com/nfl-dfs-showdown-study/)
  reports sub-3% players in 41.1% of hindsight optimal lineups. This supports
  retaining punts, not a guarantee of their pre-lock profitability. The database
  is proprietary and the reported results are not independently reproduced here.
- [Hunter, Vielma & Zaman](https://juan-pablo-vielma.github.io/publications/Picking-Winners.pdf)
  use pairwise intersections of lineup winning events in a portfolio objective.
  That derivation does not validate player co-ownership multipliers or N×product
  as a calibrated duplication forecast.

- [ETR's Showdown sim review](https://establishtherun.com/nfl-showdown-dfs-what-are-the-sims-saying/)
  publicly reports increasing observed cash rates across predicted-cash buckets
  in its 33-slate sample. The remaining ROI-bucket claims are behind a subscription
  in the version available here; they are not independently verified in this change.
  Vendor calibration does not establish calibration of this simulator.

The supplied work order's 140% total-ownership cap, fixed salary-to-tie claims,
universal safe/unsafe copy zones and automatic punt exclusions are not acceptance
criteria. Nor is 92.2 hardcoded as the maximum of an unavailable source file.

## Delivery

Three reviewed changes, in dependency order: hygiene, simulator, chart. Each
HTML change includes the service-worker content stamp. Run module regressions,
inline-source parity checks, production script compilation and cache checks.
Then exercise the real deployed import → generate → simulate → inspect workflow.
Test data are explicitly synthetic; never commit proprietary ETR CSVs.


## Implemented chart behavior and verification

The primary Compare contests action evaluates the entire retained pool for all
four editable profiles in one reproducible run. The default is 8,000 worlds and
4,000 sampled opponents. Game-plan filters retain captain-side passing stacks,
passing stacks with bring-backs, or same-team RB/DST builds. They filter candidate
selection and the visible cloud; the projection benchmark stays visible.

Cards choose their lineup using training worlds only and show held-out rates and
95% Monte Carlo intervals. Cash ranks by tie-adjusted paid-slot rate (any-prize and positive-profit rates
are also shown); multipliers rank by paid-slot share with fractional tied-cutoff credit;
GPP ranks by top-1% rate divided by one plus the upper 95% estimate of identical
opponents when the field is sampled. With a complete modelled field, the actual
duplicate count is used. This conservative score prevents zero observed copies
from receiving an unsupported uniqueness bonus. It is an engineering choice,
not a calibrated probability or ROI. Duplicate-sampling intervals are separate
from the score-world intervals; the displayed MC band is conditional on the chosen
duplication penalty, not a joint confidence band for both uncertainties. Overlapping card/runner-up intervals are explicitly
marked unresolved. The same lineup can be selected for multiple profiles.

Input audit, current-snapshot/model keys, captain scoring consistency, correlation
matrix status and a configurable implementation quality threshold of 5 percentage
points of ownership miss gate these labels. The 5-point threshold is an engineering
choice, not empirically validated calibration. Provider update time remains unknown.

The chart uses an SVG sized to its actual container, 30 CSS-pixel nearest-dot hit
testing, explicit copy-count ticks, filled candidate/selection marks, and a secondary
accessible dropdown. Tooltip and roster inspection show all six slots, ownership
used, log-rarity contributions, core product and the construction hypothesis.
No published pair ratios are silently treated as fitted multipliers.

A regression discovered while exercising the UI: captain ownership without a CPT
Salary column must still detect Showdown and retain kickers. Missing captain
salary uses the legal 1.5× fallback in both independent searches.

Run the committed pure tests with Node: `work/test-dfs-lab-audit.js`,
`work/test-dfs-lab-contests.js`, `work/test-sim-v2.js`, `work/test-dfs-upload.js`,
and `work/test-dfs-page.js`. The optional `work/test-dfs-lab-ui.cjs` uses jsdom
(`DDFS_JSDOM` may point to a temporary install) to exercise actual UI handlers:
import → generate → audit → compare → select → change contest. It checks a
360-pixel chart and stale-result invalidation. Real browser checks follow deploy.

The generated `dawg-bot-worker.js` carries the same repaired engine for repository
consistency. Publishing the Pages site does not deploy that separate Cloudflare
service; its independent release process still applies.


Missing ownership cells remain missing, including when a new column replaces an
older value. They are not converted into reported zeros. Snapshot coverage tracks
the actual updated player IDs, so a partial projection update cannot claim complete
provenance. Blank CPT projections/ceilings also clear old estimates. Cash selection
uses fractional credit for ties at the payout cutoff: with flat prizes, this tracks
expected payout and avoids preferring frequent tiny tie refunds over actual returns.

Live verification also checks that changing generation rules clears the exact-frontier
claim until the pool is regenerated. Both checks have regression coverage.
