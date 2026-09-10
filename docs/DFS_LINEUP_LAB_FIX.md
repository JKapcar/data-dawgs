# Lineup Lab fix — 2026-09-10

Applied the supplied lineup-lab-fix.diff to current main (50ed40a), preserving newer changes. The PDF script contains wrapped code; the machine-readable diff applied cleanly instead.

Adds exact Showdown enumeration, salary/team settings, frontier band/cloud controls, captain and ownership filters, lineup diagnostics, pins/copy, band simulation, Ceiling ingestion, captain-aware simulation duplicate keys and slot-aware duplication priors. Both worker references use ?v=20260909; sw.js is restamped.

Review fixes: replace unsafe packed-number sorting with comparisons of original ownership/projection values; honor zero band/cloud; reject conflicting locks; only label the unfiltered projection frontier exact. Filtered/ceiling views operate on the retained candidate pool and are labelled sampled. Ceiling display requires imported ceiling values.

Validation: JS parse checks; independent brute-force enumeration and frontier comparison on 1,260 legal Showdown lineups; locks/exclusions and ownership floors.

The original Wednesday ETR CSV is not attached, so its claimed 70,267-lineup count cannot be independently verified in this handoff.


## Decision diagnostics and input repair — 2026-09-10

- Reproduced separate paste turning 0.5 ownership / 0.2 CPT ownership into 50 / 20, while combined upload yielded 0.5 / 0.2. Both now parse units once per column. Explicit percent signs or values over one mark a percent column; otherwise fractional units are inferred. Entirely sub-one columns without unit labels remain inherently ambiguous: use percent signs for low-percentage-only inputs.
- Updated a legacy synthetic test that expected mixed units within one column; retained the independent fractional-column test.
- Synced standalone and inline ingestion, including Ceiling. A regression test enforces parity.
- New base-only projections clear stale CPT projection and ceiling; direct base projection edits do the same. Clear projections invalidates lineups and pins.
- Added browser-local source label, import time, SHA-256 file fingerprint, matched columns and manual-edit disclosure. Older saved slates request reimport; the original values cannot be reconstructed from already misparsed state.
- Selected lineups show projection sacrificed versus the generated pool best, lowest-owned slot, slot projection, near-zero base-projection dependencies, and sensitivity to a 0.5% ownership minimum.
- Optional 0.5% and 1% sensitivity views recompute ownership products and the frontier over the retained pool. They are explicitly assumptions, not corrected ETR ownership or a global frontier guarantee.
- Copy counts remain an unnormalized ownership-product proxy. They must not be interpreted as calibrated joint lineup probabilities or contest suitability. Validated field modeling and contest payout evaluation remain needed for that claim.
- The screenshots' 93.0 versus 92.2, 1.06M lineups and 86–89-point recommendation cannot be verified without the same source CSV and generation constraints.
