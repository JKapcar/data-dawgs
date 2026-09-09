# Last Dawg Standing — September 9 usability and data pass

Scope: guillotine.html and its companion engines, daily inputs, local selections, and forecast receipts. All existing tools retained. Site-wide navigation is outside this page-specific change.

## Repairs

- One labeled league/team control bar, with a separate disclosure for adding a league. The long ID is no longer the default presentation. Original saved league IDs, focus preferences, and local votes are retained.
- Navigation cards describe their contents; keyboard arrows/Home/End move between tabs. A collapsible field overview keeps the wheel and other tools within reach. Weekly tools follow the same selected team; loading and errors hide the previous league's results.
- Original focus changes recalculate its waiver plan and FAAB share. An older request cannot publish its result after a new league or focus is selected.
- Season projection caches are keyed by season and discard failures so a temporary error can recover. Read-only league requests bypass HTTP caches and have bounded timeouts. Missing bye data no longer produces a false zero-risk score.
- Zero-dollar FAAB balances cannot produce positive-dollar ranges. Real zero and negative matchup scores are retained when a roster played.
- Local votes close at the actual first kickoff (including Wednesday), not Sunday afternoon. Unknown deadlines pause voting. Existing local votes remain device-local and editable before lock.
- The daily receipt job now covers both DawgPound Royale and Case's Guillotine League, selecting the matching scoring calibration. Existing receipts are untouched; Case's Week 1 forecast was captured before kickoff. The latest pre-change daily pipeline run (34385397680) succeeded on September 9 at 17:50 UTC.
- Unavailable private roster values show a status instead of disappearing without explanation. A board still requires sign-in and a league-specific valuation from the Worker; no fallback values were fabricated.

## Verification

Original companion suite: 136 checks. Original valuation contract: 21 checks. Weekly/audit suite: 14 tests, including independent season caches, network retry, zero-dollar bids, and first-kickoff locking. Data envelope/manifest and service-worker checks run before publication. Live browser checks follow publication.

The original season-strength illustrations and the player-level weekly forecast remain distinct, labeled models. No claim of calibrated predictive accuracy or live in-game survival odds is added.

Live verification: both leagues load with 18 teams; changing league clears old tables before new data appears. Changing the focus team updates the shared selection and Money state. Weekly start/sit renders, the season scenario completes, and Case's prospective record is visible. Light and dark layouts inspected in the live browser. A final follow-up makes the URL follow league/tab selection so reload preserves it, and improves text contrast on dark-mode orange controls. Signed-in private valuation retrieval was not exercised in this browser session.
