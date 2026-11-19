# The Showdown Stage

An owner-session-only DFS Labs archive for DraftKings Showdown. It never enters contests or submits lineups.

## Evidence and workflow

1. Obtain the official salary CSV for the exact DraftKings game set. Preserve the original bytes and the lobby game-set ID separately. Do not use a projection list to attest official completeness.
2. Run `python tools/showdown-stage/archive.py DKSalaries.csv archive-dir --game IND@HOU --provenance 'exact export source and time'` and `python tools/showdown-stage/verify.py archive-dir`. The tool does not independently establish the authenticity of an uploaded CSV.
3. Select that archive folder in DFS Labs → The Showdown Stage. Confirm the slate, total, and source. Open locally first. The owner must choose **Save privately** to persist the archive. Copy the archive ID. An optional metrics layer has a separate version ID.
4. Filter by Captain, salary, team split, included FLEX, ceiling and ownership. The displayed ceiling is a sum of player ceilings, not a simulated percentile. Ownership is a role-specific sum, not a duplication probability. Missing values remain unknown.

Each gzip partition stores one Captain and all qualifying ordered-by-ID FLEX combinations. Each lineup is six distinct players, both teams, and at most $50,000 using exact corresponding role salaries. The optional metrics schema binds to the SHA-256 of the exact manifest bytes; ownership inputs are stored by role in fractional units between 0 and 1. The complete flag verifies declared chunks exist and match metadata, not whether the source has the full official roster. The local tool verifies every legal record and the independent tiny-pool tests compare enumeration against a brute-force reference.

The pilot limits archive chunks to 2 MiB compressed / 8 MiB decoded, 64 athletes, and 128 MiB total compressed. Large slates will require deterministic subpartitions before enabling production intake; never silently truncate. Existing drafts, portfolios, simulation outputs, and entry history remain separate. Only existing owner identity can save or reopen; no model pointers or public data.

Release requires the normal Worker release runbook and separate owner verification after testing the website shell. Use a synthetic archive for unauthenticated and mismatch tests. Confirm owner readback on hosting before calling it live, and verify no private data or sample inputs entered Git. No new binding or changes to existing ACL are part of this implementation.
