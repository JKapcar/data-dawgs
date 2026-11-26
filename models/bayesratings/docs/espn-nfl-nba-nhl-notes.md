# ESPN NFL / NBA / NHL — Live-Verified Notes

Companion to `docs/espn-mlb-schema-notes.md`. Verified 2026-07-19 with
`scripts/probe_espn_seasons.py` (raw payloads in `data/samples/`, gitignored —
refetch with that script). The uniform scoreboard field map from the MLB notes
holds for all three; only the sport-specific items below differ.

## Season-year convention — CONFIRMED

| League | Probe | `season.year` | Convention |
|---|---|---|---|
| NFL | 2025-10-05 (reg) & 2026-01-11 (playoff) | `2025` both | **start year** |
| NBA | 2025-01-15 (2024-25 season) | `2025` | **end year** |
| NHL | 2025-01-15 (2024-25 season) | `2025` | **end year** |

## `season.type` — use the EVENT-level value, not the league-level

`events[].season.type`: `1` = preseason, `2` = regular, `3` = postseason.
Model backfill includes **2 and 3**, excludes 1.

⚠️ **The league-level `leagues[0].season.type` is unreliable** — on the NFL
2026-01-11 *playoff* date it still read `"Regular Season"`, while the events
correctly carried `season.type = 3`. Always filter on the per-event value (which
is what we store on each `games` row).

## ⚠️ All-Star / exhibition games — NOT excluded by `season.type`

The **NBA All-Star game ingests as `season.type = 2` (regular season)** with
non-franchise "teams": 2025 showed `CHK`/`KEN` (Team Chuck / Team Kenny), ESPN
team ids `130579`/`130581` — far outside the real 1–30 franchise range. All-Star
Saturday events (Rising Stars, etc.) appear the same way. `season.type` alone
does **not** filter these out.

**Exclusion mechanism (implemented):** `db.ingest_scoreboard` resolves each
game's teams against the **canonical teams table** (seeded from the `/teams`
endpoint = the real franchises) and skips + warns on any unresolved team. So
All-Star/exhibition games are dropped automatically and loudly, with no
sport-specific special case. **Consequence:** teams MUST be seeded from `/teams`
before ingesting games (`ingest_scoreboard` raises if the league has no teams).

## Ties / OT

- **NFL** — regular-season OT can end tied (rare). A tie is `completed=true`,
  equal scores, no `winner`. The model already codes a tie as a home loss.
- **NBA** — never ties; OT shows as `status.type.detail = "Final/OT"`,
  `status.period > 4`.
- **NHL** — no ties since 2005-06 (shootout). A Final still has a winner;
  `status.type.detail` reads `Final/OT` or `Final/SO`. (Later refinement, not a
  correctness issue: OT/SO wins are weaker signals than regulation wins.)

## Backfill fetch shape

All three take `?dates=YYYYMMDD-YYYYMMDD&limit=300` (uniform). NFL additionally
supports `?week={n}&seasontype={t}`; the `calendar/regular-season` and
`calendar/postseason` endpoints enumerate a season's date ranges/weeks if we'd
rather drive the loop off ESPN's own calendar than compute date math. Not needed
for MLB/NBA/NHL, useful for NFL weeks.
