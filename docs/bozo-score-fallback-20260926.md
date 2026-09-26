# Bozo score fallback — September 26, 2026

The live CFB schedule was last changed September 21. Its upstream cfbfastR CSV
still marked Clemson–Cal and Northwestern–Indiana incomplete with blank scores
on September 26. The five-minute grader and manager preview only read that cache.

The shared grader now falls back to the existing The Odds API score endpoint for
started NFL/CFB full-game legs when nflverse/cfbfastR cannot settle them. It batches
by sport, caches requests for 60 seconds, and requires a completed event with both
valid scores, team/date identity, and a provider observation timestamp. No new
subscription, secret, or browser-supplied result is required.

Finals are retained in a separate season archive because the provider only returns
three days of completed games. Verified stored grades survive provider failures.
The public score endpoint overlays archived finals on its existing schedule rows,
preserving the schedule's ESPN IDs and weeks. One failed CSV refresh no longer
ends the other sport's refresh before it settles.

Existing five-minute automatic grading and manager preview use the same resolver.
Props and period bets remain manual. A pending leg still prevents closing the week.
Closing odds and submission records are preserved.

Validation: six added regression cases cover the reported two-leg failure, NFL
underdog grading, live/missing/mismatched scores, durable finals, outages and forged
browser results, and period/prop exclusion. All 18 schedule-grading tests pass.
The deployment workflow's 25 local Node commands pass after regenerating the stale
manifest hashes for existing surfaces.json and data/site-guide.md changes.
