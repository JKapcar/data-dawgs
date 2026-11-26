# ESPN API Reference (vendored snapshot)

A copy of a public ESPN endpoint catalog (snapshot 2026-07-13), kept in this
repo so the field notes resolve without another checkout. Treat these four
files as reference. The client that this package actually calls is
`bayesratings/espn.py`.

- `endpoints.md` — every ESPN endpoint by domain (scoreboard, teams, summary, standings…)
- `gotchas.md` — the numbered pitfalls the plan docs cite (#7 pagination, #9 athlete
  availability, #11 season-year convention, #14 rate limits, etc.)
- `league-slugs.md` — sport/league slug map for every sport (we use four; see below)
- `response-schemas.md` — example JSON for scoreboard, teams, summary, standings…

The live-verified MLB field map lives separately in `docs/espn-mlb-schema-notes.md`
(checked against real 2016 + 2026 payloads). This directory is the general catalog;
that file is the verified-against-reality record.

---

## Four-majors quick reference (what the games parser needs)

The scoreboard endpoint is uniform across sports:
`https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard`
and the response shape (`events[].competitions[].competitors[]` with `homeAway`,
`team.id`, `score` as a **string**, `status.type.completed`) is the same for all four.
Only three things differ per sport:

| League | `{sport}/{league}` | Season-year convention (gotcha #11) | Backfill fetch |
|---|---|---|---|
| MLB | `baseball/mlb` | **calendar year** (2025 season = `2025`) | `?dates=YYYYMMDD-YYYYMMDD&limit=300` (~27 calls/season) — **verified** |
| NFL | `football/nfl` | **start year** (2025 season spans Sep 2025–Feb 2026 = `2025`) | `?week={n}&seasontype={t}` per week, or `?dates=` range; ~18 reg weeks |
| NBA | `basketball/nba` | **end year** (2024-25 season = `2025`) | `?dates=` range |
| NHL | `hockey/nhl` | **end year** (2024-25 season = `2025`) | `?dates=` range |

**`season.type` values** (on both `events[].season.type` and the league season object):
`1` = preseason, `2` = regular season, `3` = postseason. For the ratings model, include
**regular + postseason (2, 3)**; **exclude preseason (1) and All-Star/exhibition games**
(NFL Pro Bowl, NBA/NHL All-Star). Confirm the exact codes per league against a live
payload before backfilling — only MLB is verified so far.

**Season enumeration:** `calendar`, `calendar/regular-season`, and `calendar/postseason`
endpoints return a season's date ranges / week list — useful to drive the backfill
loop instead of hardcoding date math (especially NFL weeks).

**Ties/OT:** MLB none; NFL regular-season OT *can* end tied (`completed=true`, equal
scores, no `winner`) — the model already codes a tie as a home loss; NBA never ties
(OT → `status.period > 4`); NHL has no ties since 2005-06 (shootout), a Final still has
a winner (`status.type.detail` shows `Final/OT` or `Final/SO`).

This package uses the scoreboard, the game summary (boxes and team stats),
rosters, and ESPN's own odds block on the scoreboard. The catalog below
also lists endpoints this package does not call.
