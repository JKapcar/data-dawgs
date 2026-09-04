# Bozo grade-path trace

**Traced:** 2026-09-04  
**Job:** J1 of `docs/bozo-execution-plan.md`

## Result

Before J1, neither an NFL leg nor a CFB leg could be graded from Worker egress: the page fetched ESPN in the browser, while the Worker's `/scores` fallback made three header variants against the same ESPN scoreboard and received HTTP 403 for all three. `/bozo/grade` then trusted the browser-supplied outcomes rather than fetching or verifying a score.

After J1, both sports are gradeable from Worker-reachable data once the scheduled cache row has populated. A blank score remains pending and a final grade returns a retryable 409; it is never coerced to zero.

## Current route-to-source path

| Step | Function | Location | Side | External call or storage read |
|---|---|---:|---|---|
| Route dispatch | `fetch` | `dawg-bot-worker.js:1733` | Worker | Dispatches `POST /bozo/grade` |
| Preview / confirm | `bozoGrade` | `dawg-bot-worker.js:8241` | Worker | Phase one reads only; phase two writes the signed phase-one values without re-fetching |
| Score join | `bozoGradeFromScheduleKv` | `dawg-bot-worker.js:8184` | Worker | Reads `schedule:{sport}:{season}` from RL KV |
| Outcome | `bozoScheduledOutcome` | `dawg-bot-worker.js:8162` | Worker | No external call; blank/incomplete rows return `scores_pending` |
| Browser preview | `autoGrade` | `bozo.html:7286` | Browser | Calls Worker `/bozo/grade` with `action:"preview"` |
| Browser confirmation | `confirmGrade` / `decide` | `bozo.html:7384`, `bozo.html:7392` | Browser | Shows the exact result and RTDB targets, then posts the signed confirmation token |

## Scheduled source calls

The existing hourly `9 * * * *` Worker trigger (`dawg-bot-worker.js:1619`) calls `runBozoScheduleRefresh` (`:6710`). It makes conditional GETs with `If-None-Match` through `bozoRefreshOneSchedule` (`:6693`):

- NFL, Worker-side: `https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv`
- CFB, Worker-side: `https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/schedules/csv/cfb_schedules_2026.csv`

The NFL adapter (`dawg-bot-worker.js:6641`) combines `gameday` and `gametime` in `America/New_York`. The CFB adapter (`:6662`) reads the processed schedule. Neither normalized row copies an odds column. ESPN IDs remain row attributes and are not KV keys.

## Browser-only ESPN dependency

The submission form may still request the ESPN scoreboard directly from the player's browser to populate its game picker. Its fallback is the Worker's `/scores` route (`dawg-bot-worker.js:1654`, handler `:1844`), which now reads the same schedule KV documents. Grading itself makes no ESPN call.

