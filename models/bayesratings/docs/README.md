# Docs

How the package fits games and how the fetchers fill the database.

- [model-overview.md](model-overview.md) — the short version of the model
- [model.md](model.md) — ratings, the player models, the Elo stack, and the lock
- [data-pipeline.md](data-pipeline.md) — commands, the cron schedule, one-time history
- [database.md](database.md) — tables. Column lists are in `bayesratings/schema.sql`
- [espn-reference/](espn-reference/README.md) — vendored ESPN endpoint catalog
- [espn-mlb-schema-notes.md](espn-mlb-schema-notes.md) — MLB scoreboard fields, checked in 2026
- [espn-nfl-nba-nhl-notes.md](espn-nfl-nba-nhl-notes.md) — season-year conventions for the other three leagues
- [decisions/](decisions/2026-10-13-model-rebuild.md) — why the rating model and the player models changed

Install, configuration, and the NBA quickstart are in the repository
`README.md`.
