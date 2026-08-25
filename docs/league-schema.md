# Canonical fantasy league record, version 1

Seeded records under `/data/leagues/` use `canon_version: 1`. Required identity fields are
`provider`, `provider_league_id`, `dd_id`, `season`, and `name`. `source` must carry `url`,
`captured_at`, `auth`, and `official`. A record also carries `settings`, `teams`, `rosters`,
`draft`, and `diagnostics`.

Unknown values are `null` or named in `diagnostics.missing_inputs`; they are never guessed.
Team placeholders may have null names and owners. Provider-normalized records retain raw
scoring input under `settings.scoring.raw` when it is available.
