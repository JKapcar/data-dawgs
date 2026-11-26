# Database

One SQLite file. `BAYESRATINGS_DB` defaults to `data/bayesratings.db`.
`bayesratings init` applies `bayesratings/schema.sql` and reloads venue
coordinates from `bayesratings/data/venues.csv`. The file is not committed.
Column lists and indexes live in `schema.sql`. This page says what each
table is for.

Change-only tables (`game_probables`, `game_odds`, `game_weather`,
`roster_states`, `injury_details`, `nfl_depth_states`, and the `*_states`
tables from the gap sources) keep one row per distinct state. The state at
time T is `valid_from <= T` and (`valid_to` is null or `valid_to > T`).

## Games and ratings

| Table | What it holds |
| --- | --- |
| `teams` | Canonical teams. `team_id` is ours. `espn_id` is the franchise-stable ESPN id, so a rename does not break joins. |
| `games` | One row per ESPN event: scores, start time, season, venue, and whether the game is final. |
| `team_seasons` | Each team's name, abbreviation, and main home venue in a season. |
| `scraper_runs` | One row per scoreboard or summary fetch. |
| `backfill_dates` | One row per league and scoreboard date already fetched. A rerun skips a finished date. |
| `game_summaries` | Gzip-compressed ESPN summary JSON. Player lines are extracted from this. |
| `rating_snapshots` | Team ratings for one `(snapshot_date, league)`. A rerun of that day replaces the rows. |
| `forecast_snapshots` | Game-day forecast: win chance, margin, total, and the audit columns for starters, players, and Elo. |
| `upcoming_forecasts` | Forecasts for games after the snapshot day. Replaced per league on each daily run. Not a graded row. |
| `forecast_locks` | The model forecast frozen about ten minutes before the start (`bayesratings/lock.py`). Inserted once and never replaced. |
| `daily_runs` | One row per daily fit: status, counts, and the notes line. |

`forecast_snapshots` does not store American odds. Those columns are on the
in-memory forecast frame (`home_odds`, `away_odds`), from
`prob_to_american_odds`.

## Players

| Table | What it holds |
| --- | --- |
| `players` | Latest name, team, and position seen for an athlete. |
| `player_team_seasons` | One row per player, season, and team he appeared for. |
| `player_game_mlb_batting`, `player_game_mlb_pitching` | MLB box lines. The first pitcher listed is the starter. |
| `player_game_nba` | NBA box lines, including did-not-play rows. |
| `player_game_nhl_skater`, `player_game_nhl_goalie` | NHL box lines. The goalie with the most time on ice is the starter. |
| `player_game_nfl_passing`, `player_game_nfl_rushing`, `player_game_nfl_receiving`, `player_game_nfl_other` | NFL box lines. The quarterback with the most attempts is the starter. |
| `player_extract_log` | Which summaries have been extracted, and at which parser version. |
| `team_game_stats` | Team totals for and against, from the stored summary. The NFL player model reads yards allowed from here. |
| `player_values` | Each player's daily value from the same running sums the adjustments use. Display only. A failure here does not fail the fit. |

## Pre-game log

Written by `bayesratings/prelog.py` from scoreboards the jobs already fetch,
plus roster and summary requests.

| Table | What it holds |
| --- | --- |
| `game_probables` | MLB probable pitcher and NHL probable goalie from the scoreboard. |
| `game_odds` | ESPN's betting block per provider: moneyline, spread, total, open and current. |
| `game_weather` | The conditions note on the ESPN scoreboard or summary. |
| `roster_states` | ESPN roster: team, status, position, injury status. |
| `injury_details` | Type, detail, side, and return date from one core-API lookup per new roster injury. |
| `injury_lookups` | Which of those lookups have been done. |
| `nfl_depth_states` | NFL depth chart. |
| `transactions` | League transaction wire, deduplicated. |
| `pregame_snapshots` | Summary fetched 60–80 minutes before the start. |
| `pregame_lineups` | Lineup, starters, and probables from that summary. |
| `pregame_injuries` | Injury list on that summary. ESPN caps it at five per team. |
| `prelog_runs` | One row per pre-game pass: requests, rows, errors. |

## Gap sources

| Table | What it holds |
| --- | --- |
| `src_raw` | Raw payload, deduplicated by hash, so a later parser can reread it. |
| `src_meta` | Small cache, including `robots.txt`. |
| `ext_ids` | External id mapped to an ESPN id, and the method used. |
| `ext_unmatched` | Ids that did not map. They are kept, not dropped. |
| `src_game_passes` | Which per-game pass ran, and whether the data was there. |
| `mlb_roster_states`, `mlb_transactions` | MLB Stats API 40-man roster and transactions. |
| `mlb_games`, `mlb_lineup_states` | MLB game id, probable pitcher (slot 0), and posted batting order. |
| `nhl_goalie_states`, `nhl_line_states` | Daily Faceoff starting goalie and dressed lines. |
| `nba_injury_reports`, `nba_injury_states` | Official NBA injury-report PDF and one row per player. |
| `nba_lineup_states` | Probable NBA starters: NBA.com daily lineups, else ESPN's depth chart. |
| `nba_starters` | Starters flagged on the ESPN box after tip. |
| `nfl_injury_report_states`, `nfl_weekly_roster_states` | nflverse practice and game status, and the weekly roster (including inactive). |
| `nfl_inactives` | Game-day inactives from ESPN's per-team injury list. |
| `nfl_schedule` | nflverse schedule rows used to name the starter of a completed game and to join play-by-play to an ESPN event. The file has spread, total, and moneyline columns. This package does not store them. A contributor can add them. |
| `nfl_pbp_qb` | Quarterback dropback EPA and completion percentage over expected, summed from nflverse play-by-play. |
| `nfl_qb_state`, `nfl_team_chance_hist` | Pregame quarterback rates, and walk-forward team chances before 2025-09-04. |
| `mlb_box_games`, `mlb_box_players` | Box-score counts ESPN does not keep. |
| `mlb_statcast_dates`, `mlb_statcast_games`, `mlb_batted_balls`, `mlb_batted_players` | Statcast batted balls and the per-player game totals. |
| `mlb_player_state`, `mlb_relief_log`, `mlb_team_chance_hist` | Pregame batter and pitcher rates, recent reliever usage, and walk-forward team-plus-starter chances. |
| `nhl_games`, `nhl_shots`, `nhl_player_xg`, `nhl_xg_model` | NHL shot locations and a logistic expected-goals fit. No forecast reads them. |

## Fits

One row per stored fit. A failed refit leaves the previous row. Existing
forecast rows are not rewritten when a fit is stored.

| Table | Model |
| --- | --- |
| `nba_ridge_fits`, `nba_player_state` | NBA player ridge (versions B and C) and the pregame rate sums. |
| `nhl_ridge_fits`, `nhl_player_state`, `nhl_goalie_state` | NHL player ridge and the skater and goalie sums. |
| `nfl_ridge_fits` | NFL quarterback ridge. |
| `mlb_ridge_fits` | MLB player stack (version B). |

## Venues

| Table | What it holds |
| --- | --- |
| `venue_coords`, `venue_aliases` | Building coordinates for `games.venue`, loaded by `init`. |
| `venues` | MLB Stats API venue rows (coordinates, roof, orientation). Separate from `venue_coords`. |
