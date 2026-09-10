# Lineup Lab fix — 2026-09-10

Applied the supplied lineup-lab-fix.diff to current main (50ed40a), preserving newer changes. The PDF script contains wrapped code; the machine-readable diff applied cleanly instead.

Adds exact Showdown enumeration, salary/team settings, frontier band/cloud controls, captain and ownership filters, lineup diagnostics, pins/copy, band simulation, Ceiling ingestion, captain-aware simulation duplicate keys and slot-aware duplication priors. Both worker references use ?v=20260909; sw.js is restamped.

Review fixes: replace unsafe packed-number sorting with comparisons of original ownership/projection values; honor zero band/cloud; reject conflicting locks; only label the unfiltered projection frontier exact. Filtered/ceiling views operate on the retained candidate pool and are labelled sampled. Ceiling display requires imported ceiling values.

Validation: JS parse checks; independent brute-force enumeration and frontier comparison on 1,260 legal Showdown lineups; locks/exclusions and ownership floors.

The original Wednesday ETR CSV is not attached, so its claimed 70,267-lineup count cannot be independently verified in this handoff.
