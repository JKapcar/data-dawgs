# Bozo live scores from ESPN (October 10, 2026)

## Why

Since about 10:40 PM ET Thursday, October 8, The Odds API has refused the Worker's key with
HTTP 401 (`/scores?sport=cfb` → `feeds.finals.diagnostic`). That made `bozo:scores` fail and
turned the survivor pipeline watch red (issue #212). The Worker's health page shows the
failure "since 06:30Z October 10" only because that was the first run after the health page
went live. Kap chose to stop paying for a live score feed: ESPN's public scoreboard is now the
primary live source, and the Odds API is optional.

## Precedence (highest first)

1. **Official schedule finals**: nflverse `games.csv` (NFL) and cfbfastR (CFB). Every reader
   takes the schedule row first: grading (`bozoGradeFromScheduleKv`), `/scores`, and the MCP
   scores tool. A live final is used only while the schedule row is not final. When an
   official final disagrees with ESPN, the official one wins. The disagreement is logged as
   `bozo-final-disagreement` and the newest 20 are kept on the ESPN archive. Their count is
   public at `feeds.live.disagreements`. If a leg was banked from ESPN and nflverse/cfbfastR
   later publishes a different final, the official grade replaces it and the change is logged.
2. **ESPN** (`source: "espn"`): matched to the scheduled game by ESPN event id, which both
   schedule feeds carry. If the event id places the row, the row takes the schedule's
   `canonicalKey`. Otherwise the registry maps team names to a key built from the kickoff's
   UTC date, so a Monday-night game at 00:15Z keeps Tuesday's UTC date. ESPN is asked for
   the Eastern date, which for that game is the Monday. A row the event id cannot place falls
   back to teams plus the nearest kickoff.
3. **The Odds API** (optional): used only on a pass where ESPN failed. With no
   `ODDS_API_KEY`, it is skipped. A 401 is quiet: the key is probed once a day and the job
   never fails because of it.

## Final means final

A row is stored only when ESPN reports `status.type.completed === true` and `state === "post"`,
and the status name is not a cancellation, postponement, suspension, forfeit or delay.
In-progress scores are counted for diagnostics only. They never enter the archive, so they
cannot grade a leg.

## Sources and Worker egress

`docs/bozo-workplan.md` D19 recorded `site.api.espn.com` answering 403 to Worker egress in
September. So the job tries, in order:

1. `site.api.espn.com` scoreboard
2. `site.web.api.espn.com` scoreboard (same shape)
3. `sports.core.api.espn.com` per-game records (status → competition → two scores)

A host that answers 401, 403 or 451 is skipped for six hours. `feeds.live.via` shows the path
that worked: `site`, `site-web` or `core`. If all three are blocked, grading still lands from
the schedule feeds, later.

Note: ESPN rejects scoreboard date ranges (the query returns zero events), so each Eastern
date is its own request.

## Budget

- Only a sport with a due game spends anything. A game is due from kickoff + 2.5 h, while
  still not final, until 72 h after kickoff.
- Scoreboard: one request per due Eastern date, at most two dates per tick. That is every
  5 minutes while a due game is inside the 8-hour fast window, every 30 minutes for
  long-overdue games, and every 15 minutes after a failed pass.
- Core fallback: at most 4 requests per sport per tick. That is one status read per
  unfinished game, plus three reads once it is final.
- Ceiling: 600 requests per sport per UTC day (`BOZO_ESPN_DAILY_CAP`). It stops a bug; it
  is not a working budget.
- Cloudflare's free plan allows 50 subrequests per invocation, shared by every job on the
  5-minute tick. ESPN adds at most 2 (scoreboard) or 4 (core) per sport.

## Health

`runBozoLiveScores` reports each sport's `health`, and `opsOutcome("bozo:scores")` reads it:

- `ok`: ESPN (or the Odds API) answered this pass. It is also `ok`, with
  `degraded: "live_scores_unavailable"`, when ESPN failed while the schedule feeds are healthy
  (`ops:health:bozo:schedule` not failing), because grading still lands from them.
- `fail`: ESPN failed, the Odds API did not rescue it, and the schedule feed is failing.
- `noop`: nothing due, or a throttled pass.

The latched failure on `/ops/health` clears on the first ESPN success after deploy. The watch
closes issue #212 on its next passing run. A degraded ESPN does not turn the watch red. It
shows up at `/scores?sport=nfl` → `feeds.live.error` and `feeds.live.httpStatus`.

## Files

- `work/bozo-espn-scores.js`: the block. `cd work && node assemble.mjs` injects it in place,
  just above the near-close archive, inside the Bozo grade region.
- `dawg-bot-worker.js` (hand-written half): `opsOutcome`, `handleScores` (`feeds.live`),
  `bozoGradeFromScheduleKv` (ESPN overlay, `espn` as a banked source, disagreement log),
  and `bozoScoreRefreshInterval` (daily probe after a 401).
- `tests/bozo-espn-scores.test.js` and `tests/fixtures/espn-scoreboard-2026-10.json`
  (real scoreboards captured October 10, 2026, trimmed).
