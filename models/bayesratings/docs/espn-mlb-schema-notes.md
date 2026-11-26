# ESPN MLB — Verified Schema Notes

Live verification done 2026-07-06 against the ESPN scoreboard. Raw payloads
were saved under `data/samples/` and are not committed. This doc is the
committed record. The games contract is `bayesratings/games.py`. Storage is
`bayesratings/schema.sql`. The client is `bayesratings/espn.py`.

**ESPN knowledge base:** `docs/espn-reference/` (vendored in-repo) — full endpoint
catalog (`endpoints.md`), pitfalls (`gotchas.md`), response examples
(`response-schemas.md`), league slugs, plus a four-majors quick-reference in its
README. Read those before touching a new endpoint.

## How it was checked

Scoreboards for 2026-07-06 (a live slate), 2016-07-06 (ten years earlier),
and 2026-06-24 (a doubleheader), plus the team list. The same calls are
`espn.fetch_scoreboard("mlb", dates="YYYYMMDD")` and `espn.fetch_teams("mlb")`.

## Findings

### Schema is stable 2016 → 2026
Same event shape on both dates. One historical endpoint serves the whole backfill;
no schema fork between backfill and daily modes.

### Date-range queries work — backfill is cheap
`scoreboard?dates=20160801-20160807&limit=300` returned all 95 events for the week in
one call. A season is ~27 weekly calls; 10 seasons ≈ 270 requests. Always pass an
explicit `limit` (default page sizes are small — gotcha #7) and validate returned
count against expectation.

### Field map → `games` contract

| Ours | ESPN | Notes |
|---|---|---|
| `espn_event_id` | `events[].id` | e.g. `401816049`; unique per game incl. doubleheaders — natural unique key |
| `start_time_utc` | `events[].date` | ISO UTC, e.g. `2026-07-06T18:10Z` — **minutes precision, Z suffix** |
| `season` | `events[].season.year` | MLB = calendar year; convention varies by sport (gotcha #11) |
| `season_type` | `events[].season.type` | `2` = regular season; filter or store |
| `home/away team` | `competitions[].competitors[].homeAway` + `team.id` | competitor `team.id` is the stable numeric ID |
| `home/away score` | `competitors[].score` | **string**, cast to int; only trust when completed |
| `completed` | `status.type.completed` | bool; `status.type.name` = `STATUS_FINAL` etc.; `state` = pre/in/post |
| `venue` | `competitions[].venue.fullName` | present; `neutralSite` flag too |

### Doubleheaders: two events, distinct IDs and start times
2026-06-24 CHC @ NYM: event `401879401` at `17:10Z` and `401815882` at `23:10Z`.
Exactly what the event matcher (1.3) assumes — match on team pair + date +
start-time proximity works. `games` rows keyed by `espn_event_id` are naturally
distinct.

### Team IDs are franchise-stable across relocations
Athletics = ESPN team id `11` in 2016 (Oakland) and 2026 (abbrev `ATH`,
displayName "Athletics"). ESPN keeps the numeric ID and renames. So: our canonical
`teams` table maps `espn_id` (numeric, franchise-level) → our canonical ID; names/
abbreviations are display attributes that can change season to season — store
current values, don't key on them. 30 teams returned; fields: `id`, `uid`, `slug`,
`abbreviation`, `displayName`, `location`, `color`, `logos`, `isActive`.

### Timezone convention (decision)
ESPN event dates are UTC. **Store `start_time_utc` as-is (timestamptz).** Derive a
`game_date_local` (venue-local or US/Eastern — decide in the contract doc) for
"today's slate" queries; a 10:10 PM ET West Coast start is the next day in UTC.

## Not yet verified (do during 1.2)

- Team stats availability per scoreboard event vs `summary?event={id}` (only needed
  if/when the model consumes stats — v1 Bradley-Terry needs scores only)
- 2020 COVID season row count (~900 games) as the backfill spot-check
- Rate-limit behavior on sustained backfill (gotcha #14: no published limits, 429s
  exist — backoff + polite User-Agent required)
- Postseason `season.type` handling (backfill regular season only for the model?
  decide in the contract doc)
