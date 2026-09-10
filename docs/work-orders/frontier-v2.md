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

The supplied work order's 140% total-ownership cap, fixed salary-to-tie claims,
universal safe/unsafe copy zones and automatic punt exclusions are not acceptance
criteria. Nor is 92.2 hardcoded as the maximum of an unavailable source file.

## Delivery

Three reviewed changes, in dependency order: hygiene, simulator, chart. Each
HTML change includes the service-worker content stamp. Run module regressions,
inline-source parity checks, production script compilation and cache checks.
Then exercise the real deployed import → generate → simulate → inspect workflow.
Test data are explicitly synthetic; never commit proprietary ETR CSVs.
