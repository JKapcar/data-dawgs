---
as_of: 2026-09-28
source: Data Dawgs EPA daily refresh; nflverse play-by-play and schedules
canonical_url: https://datadawgs216.com/data/epa-method.md
---

# Daily NFL EPA refresh

The EPA explorer defaults to the newest season with available data. Its current
season refreshes once daily at **11:43 UTC (7:43 a.m. EDT / 6:43 a.m. EST)** via
GitHub Actions. Schedules are best effort. This is completed-game data, not live
play-by-play; the last successful refresh and source-file timestamp are displayed.

The collector downloads nflverse's processed season play-by-play, so EPA and CPOE
come from nflfastR. It accepts individual completed games even when the current
week still has games left. A game must match the nflverse schedule, have final
scores, an END GAME record, and non-missing EPA on every pass/rush play. Duplicate
plays, mismatched game identity and missing previously published games stop the
refresh. Future, unfinished and incomplete games are not included. Included game
IDs, games per team/week, pending games, capture timestamp and source SHA-256 are
published in each EPA JSON file's `data.coverage`.

The entire current season is rebuilt to pick up NFL/nflverse statistical
corrections. Other seasons retain their original rows and capture dates; they
are not silently downloaded again. Empty or failed refreshes preserve the last
published snapshot. A freshness notice appears after 48 hours without a
successful check. The daily job rebuilds the team and player mirrors, validates
them, updates the service-worker cache version and requests a Pages build.
Concurrent changes trigger a fresh rebuild on latest main; it never force-pushes.

## Filters and interpretation

For one incomplete season, the default QB minimum is **ceil(200 × completed
regular-season games / 272)**, bounded from 1 to 200. The same rule is used by the
page and machine-readable team/QB table. Full seasons and multi-season page
selections default to 200. Users can override it; “Use season minimum” restores
the automatic setting. This is a display threshold, not evidence of statistical
reliability. Read game counts, opponents and sample size alongside the rankings.

The 272-game denominator is the current 32-team, 17-game NFL regular season.
Changing league structure requires updating that documented assumption.

EPA, CPOE, success rate and win probability are model outputs. The existing
aggregation definitions and rounding are preserved: pass/rush plays with EPA;
EPA stored to 0.01 and CPOE to 0.1; regular-season machine tables exclude plays
without a down. The player surface attributes EPA to the primary ball handler,
not receivers, blockers or individual defenders. The page also supports
postseason and other situational filters. Coverage describes the loaded data;
selected weeks/downs and other filters can further narrow it.

nflverse generally updates processed play-by-play overnight after game days,
with some additional game-day updates. NFL corrections can arrive later; Thursday
is typically the cleanest weekly release. Daily polling cannot publish data
before the upstream source does.

Sources:
- https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html
- https://github.com/nflverse/nflverse-data/releases/tag/pbp
- https://github.com/nflverse/nfldata/blob/master/data/games.csv
