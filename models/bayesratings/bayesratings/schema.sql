-- bayesRatings storage schema (SQLite).
-- Base ratings site: games in, ratings out. One writer (the daily pipeline),
-- read-mostly. Keep it small; add tables when something consumes them.

PRAGMA foreign_keys = ON;

-- Canonical teams. Our own team_id; keyed on ESPN's franchise-stable numeric id
-- so relocations/renames don't break joins (A's = espn_id 11 in both Oakland and
-- "ATH"). Name/abbrev/colors/logo are display attributes that can change.
CREATE TABLE IF NOT EXISTS teams (
    team_id         INTEGER PRIMARY KEY,
    league          TEXT    NOT NULL,          -- mlb | nfl | nba | nhl
    espn_id         INTEGER NOT NULL,
    location        TEXT,
    name            TEXT,                       -- displayName
    abbreviation    TEXT,
    color           TEXT,
    alternate_color TEXT,
    logo            TEXT,
    -- canonical franchise for ratings continuity across relocations where ESPN
    -- issued a new id (NHL Arizona 24 -> Utah 129764). NULL = itself.
    franchise_team_id INTEGER REFERENCES teams (team_id),
    UNIQUE (league, espn_id)
);

-- Games: the model's input plus provenance. espn_event_id is the natural unique
-- key (distinct per doubleheader game). Re-scraping upserts on it, so backfills
-- are idempotent and results fill in as games complete.
CREATE TABLE IF NOT EXISTS games (
    game_id         INTEGER PRIMARY KEY,
    espn_event_id   INTEGER NOT NULL UNIQUE,
    league          TEXT    NOT NULL,
    season          INTEGER NOT NULL,           -- per-sport convention (see docs/espn-reference)
    season_type     INTEGER,                    -- 1 pre, 2 regular, 3 post
    start_time_utc  TEXT    NOT NULL,           -- ISO UTC, minutes precision
    game_date       TEXT    NOT NULL,           -- America/Chicago calendar date (slate key)
    home_team_id    INTEGER NOT NULL REFERENCES teams (team_id),
    away_team_id    INTEGER NOT NULL REFERENCES teams (team_id),
    home_score      INTEGER,                    -- NULL until completed
    away_score      INTEGER,
    completed       INTEGER NOT NULL DEFAULT 0, -- 0/1
    status          TEXT,                       -- STATUS_FINAL, etc.
    venue           TEXT,
    venue_city      TEXT,                       -- ESPN venue.address.city
    venue_state     TEXT,                       -- ESPN venue.address.state
    venue_country   TEXT,                       -- ESPN venue.address.country (often absent)
    neutral_site    INTEGER NOT NULL DEFAULT 0,
    ending          TEXT,                       -- NHL: regulation | ot | shootout
    covid_2020      INTEGER NOT NULL DEFAULT 0, -- pandemic-affected season flag
    notes           TEXT,                       -- ESPN event notes, e.g. 'NLCS - Game 5 If Necessary'
    if_necessary    INTEGER NOT NULL DEFAULT 0, -- playoff game played only if the series is still open
    series_summary  TEXT,                       -- e.g. 'MIL wins series 4-0'
    series_completed INTEGER NOT NULL DEFAULT 0 -- ESPN says the series is decided
);

CREATE INDEX IF NOT EXISTS idx_games_league_season ON games (league, season);
CREATE INDEX IF NOT EXISTS idx_games_date          ON games (game_date);
CREATE INDEX IF NOT EXISTS idx_games_home          ON games (home_team_id);
CREATE INDEX IF NOT EXISTS idx_games_away          ON games (away_team_id);

-- Every scrape/ingest run logged (standing rule: no untracked production paths).
CREATE TABLE IF NOT EXISTS scraper_runs (
    run_id         INTEGER PRIMARY KEY,
    league         TEXT,
    mode           TEXT,                        -- backfill | daily | ingest
    started_at     TEXT,
    finished_at    TEXT,
    games_written  INTEGER,
    status         TEXT,                        -- ok | error
    notes          TEXT
);

-- Backfill progress: one row per (league, scoreboard date). A date marked done
-- with all its completed games summarized is skipped on rerun.
CREATE TABLE IF NOT EXISTS backfill_dates (
    league      TEXT NOT NULL,
    date        TEXT NOT NULL,                  -- YYYY-MM-DD as requested
    events      INTEGER,
    status      TEXT,                           -- done | error
    fetched_at  TEXT,
    PRIMARY KEY (league, date)
);

-- Raw ESPN game summary (box score, team stats, leaders, pickcenter lines),
-- gzip-compressed JSON. One per event; extract fields later without refetching.
CREATE TABLE IF NOT EXISTS game_summaries (
    espn_event_id INTEGER PRIMARY KEY,
    league        TEXT NOT NULL,
    fetched_at    TEXT NOT NULL,
    raw_bytes     INTEGER,
    json_gz       BLOB NOT NULL
);

-- Each team's identity and main home venue per season (relocations/renames).
CREATE TABLE IF NOT EXISTS team_seasons (
    team_id       INTEGER NOT NULL REFERENCES teams (team_id),
    league        TEXT NOT NULL,
    season        INTEGER NOT NULL,
    name          TEXT,
    abbreviation  TEXT,
    home_venue    TEXT,
    home_games    INTEGER,
    PRIMARY KEY (team_id, season)
);

-- Daily model output. One set of rows per (snapshot_date, league); a rerun of
-- the same day deletes and rewrites that day's rows in one transaction.
CREATE TABLE IF NOT EXISTS rating_snapshots (
    snapshot_date TEXT    NOT NULL,             -- America/Chicago run date
    league        TEXT    NOT NULL,
    season        INTEGER NOT NULL,             -- rating season used
    team_id       INTEGER NOT NULL REFERENCES teams (team_id),
    rating        REAL    NOT NULL,             -- zero-centered posterior mean
    rating_sd     REAL,                         -- posterior sd (centered draws)
    rating_q05    REAL,
    rating_q95    REAL,
    home_adv      REAL,                         -- league posterior mean, logit
    backfilled    INTEGER NOT NULL DEFAULT 0,   -- 1 = rebuilt later by replay.py
    PRIMARY KEY (snapshot_date, league, team_id)
);

CREATE TABLE IF NOT EXISTS forecast_snapshots (
    snapshot_date   TEXT    NOT NULL,
    league          TEXT    NOT NULL,
    espn_event_id   INTEGER NOT NULL,
    game_date       TEXT,
    home_team_id    INTEGER REFERENCES teams (team_id),
    away_team_id    INTEGER REFERENCES teams (team_id),
    home_prob       REAL,
    away_prob       REAL,
    home_spread     REAL,                        -- negative = home favored
    total_pred      REAL,
    home_total_pred REAL,
    away_total_pred REAL,
    backfilled      INTEGER NOT NULL DEFAULT 0,  -- 1 = rebuilt later by replay.py
    -- starter adjustment audit (MLB pitcher / NHL goalie; NULL = not applied)
    home_starter_id  INTEGER,                    -- ESPN athlete id used
    away_starter_id  INTEGER,
    home_starter_src TEXT,                       -- espn | mlbapi | dfo (":nohist" = no shift)
    away_starter_src TEXT,
    home_starter_rel REAL,                       -- vs team's usual starter (runs/goals)
    away_starter_rel REAL,
    home_prob_base   REAL,                       -- win chance before the adjustment
    total_pred_base  REAL,                       -- total before the adjustment
    starter_coef     REAL,                       -- morning mean in-model coefficient; the intraday probable refresh uses it
    -- player-level adjustment audit (player_adj.py; NULL = not applied)
    home_player_x    REAL,                       -- vs team's usual players (MLB: lineup)
    away_player_x    REAL,
    home_player_x2   REAL,                       -- MLB bullpen (NULL elsewhere)
    away_player_x2   REAL,
    home_player_id   INTEGER,                    -- NFL starting QB used
    away_player_id   INTEGER,
    home_player_src  TEXT,                       -- report | lines | roster | depth | last | posted | usual
    away_player_src  TEXT,
    player_prob_base REAL,                       -- win chance before the player term (after starters)
    player_spread_base REAL,
    player_total_base  REAL,
    player_home_total_base REAL,
    player_away_total_base REAL,
    player_inputs    TEXT,                       -- fingerprint of the pre-game inputs used
    -- win-chance stack audit (bayes_elo.py; NULL on older and replayed rows)
    p_logit          REAL,                       -- logit win chance (after starters + players)
    p_elo            REAL,                       -- dynamic Bayesian Elo (NULL = fallback)
    elo_weight       REAL,                       -- home_prob = (1-w)*p_logit + w*p_elo
    model_version    TEXT,
    -- NBA player ridge (nba_player.py). NULL on rows written before it and on other leagues.
    -- home_prob is the ridge chance when nba_model_src is ridge_b or ridge_c.
    nba_model_src    TEXT,                       -- ridge_b | ridge_c | team
    nba_ridge_prob   REAL,                       -- ridge chance (NULL when src is team)
    nba_team_prob    REAL,                       -- the current NBA path's chance, kept for audit and fallback
    nba_ridge_fit_id INTEGER,                    -- nba_ridge_fits.fit_id used
    nba_inputs       TEXT,                       -- report slot and lineup fingerprint used
    -- NHL player ridge (nhl_player.py). NULL on rows written before it and on other leagues.
    -- home_prob is the ridge chance when nhl_model_src is ridge_b or ridge_c.
    nhl_model_src    TEXT,                       -- ridge_b | ridge_c | team
    nhl_ridge_prob   REAL,                       -- ridge chance (NULL when src is team)
    nhl_team_prob    REAL,                       -- the current NHL path's chance, kept for audit and fallback
    nhl_ridge_fit_id INTEGER,                    -- nhl_ridge_fits.fit_id used
    nhl_inputs       TEXT,                       -- lines and confirmed-goalie fingerprint used
    -- NFL player ridge (nfl_player.py). NULL on rows written before it and on other leagues.
    -- home_prob is the ridge chance when nfl_model_src is ridge_qb.
    nfl_model_src    TEXT,                       -- ridge_qb | team
    nfl_ridge_prob   REAL,                       -- ridge chance (NULL when src is team)
    nfl_team_prob    REAL,                       -- the current NFL path's chance, kept for audit and fallback
    nfl_ridge_fit_id INTEGER,                    -- nfl_ridge_fits.fit_id used
    nfl_inputs       TEXT,                       -- confirmed quarterbacks and the fingerprint used
    -- MLB player stack (mlb_player.py). NULL on rows written before it and on other leagues.
    -- home_prob is the stack chance when mlb_model_src is stack_b.
    mlb_model_src    TEXT,                       -- stack_b | team
    mlb_ridge_prob   REAL,                       -- stack chance (NULL when src is team)
    mlb_team_prob    REAL,                       -- the current MLB path's chance, kept for audit and fallback
    mlb_ridge_fit_id INTEGER,                    -- mlb_ridge_fits.fit_id used
    mlb_inputs       TEXT,                       -- lineups, starters and the fingerprint used
    PRIMARY KEY (snapshot_date, espn_event_id)
);

-- Latest forecast for games AFTER the snapshot day, replaced per league on
-- every daily run. Later days only. The game-day forecast lives in
-- forecast_snapshots. This table is replaced each run and is not graded.
CREATE TABLE IF NOT EXISTS upcoming_forecasts (
    snapshot_date   TEXT    NOT NULL,            -- the run that made it
    league          TEXT    NOT NULL,
    espn_event_id   INTEGER NOT NULL PRIMARY KEY,
    game_date       TEXT,
    home_team_id    INTEGER REFERENCES teams (team_id),
    away_team_id    INTEGER REFERENCES teams (team_id),
    home_prob       REAL,
    away_prob       REAL,
    home_spread     REAL,
    total_pred      REAL,
    home_total_pred REAL,
    away_total_pred REAL,
    -- starter adjustment audit (MLB pitcher / NHL goalie; NULL = not applied)
    home_starter_id  INTEGER,                    -- ESPN athlete id used
    away_starter_id  INTEGER,
    home_starter_src TEXT,                       -- espn | mlbapi | dfo (":nohist" = no shift)
    away_starter_src TEXT,
    home_starter_rel REAL,                       -- vs team's usual starter (runs/goals)
    away_starter_rel REAL,
    home_prob_base   REAL,                       -- win chance before the adjustment
    total_pred_base  REAL,                       -- total before the adjustment
    starter_coef     REAL,                       -- morning mean in-model coefficient; the intraday probable refresh uses it
    -- player-level adjustment audit (player_adj.py; NULL = not applied)
    home_player_x    REAL,                       -- vs team's usual players (MLB: lineup)
    away_player_x    REAL,
    home_player_x2   REAL,                       -- MLB bullpen (NULL elsewhere)
    away_player_x2   REAL,
    home_player_id   INTEGER,                    -- NFL starting QB used
    away_player_id   INTEGER,
    home_player_src  TEXT,                       -- report | lines | roster | depth | last | posted | usual
    away_player_src  TEXT,
    player_prob_base REAL,                       -- win chance before the player term (after starters)
    player_spread_base REAL,
    player_total_base  REAL,
    player_home_total_base REAL,
    player_away_total_base REAL,
    player_inputs    TEXT,                       -- fingerprint of the pre-game inputs used
    -- win-chance stack audit (bayes_elo.py)
    p_logit          REAL,
    p_elo            REAL,
    elo_weight       REAL,
    model_version    TEXT,
    -- NBA player ridge (nba_player.py). NULL on rows written before it and on other leagues.
    nba_model_src    TEXT,                       -- ridge_b | ridge_c | team
    nba_ridge_prob   REAL,
    nba_team_prob    REAL,
    nba_ridge_fit_id INTEGER,
    nba_inputs       TEXT,
    -- NHL player ridge (nhl_player.py). NULL on rows written before it and on other leagues.
    nhl_model_src    TEXT,                       -- ridge_b | ridge_c | team
    nhl_ridge_prob   REAL,
    nhl_team_prob    REAL,
    nhl_ridge_fit_id INTEGER,
    nhl_inputs       TEXT,
    -- NFL player ridge (nfl_player.py). NULL on rows written before it and on other leagues.
    nfl_model_src    TEXT,                       -- ridge_qb | team
    nfl_ridge_prob   REAL,
    nfl_team_prob    REAL,
    nfl_ridge_fit_id INTEGER,
    nfl_inputs       TEXT,
    -- MLB player stack (mlb_player.py). NULL on rows written before it and on other leagues.
    mlb_model_src    TEXT,                       -- stack_b | team
    mlb_ridge_prob   REAL,
    mlb_team_prob    REAL,
    mlb_ridge_fit_id INTEGER,
    mlb_inputs       TEXT
);


-- Frozen model forecast, written once just before the scheduled start
-- (bayesratings/lock.py). Never replaced.
CREATE TABLE IF NOT EXISTS forecast_locks (
    espn_event_id INTEGER PRIMARY KEY,
    league        TEXT    NOT NULL,
    locked_at     TEXT    NOT NULL,
    home_prob     REAL,
    home_spread   REAL,
    total_pred    REAL
);

CREATE TABLE IF NOT EXISTS daily_runs (
    run_id        INTEGER PRIMARY KEY,
    snapshot_date TEXT,
    league        TEXT,
    started_at    TEXT,
    finished_at   TEXT,
    status        TEXT,                          -- ok | skipped | error
    rating_season INTEGER,
    n_games       INTEGER,                       -- completed games given to the model
    n_teams       INTEGER,
    n_forecasts   INTEGER,
    seconds       REAL,
    notes         TEXT
);

CREATE TABLE IF NOT EXISTS players (
    league          TEXT    NOT NULL,
    athlete_id      INTEGER NOT NULL,
    name            TEXT,
    short_name      TEXT,
    position        TEXT,                       -- latest abbreviation seen (NFL boxes carry none)
    team_id         INTEGER REFERENCES teams (team_id),   -- team in his latest game
    first_game_date TEXT,
    last_game_date  TEXT,
    games           INTEGER,                    -- distinct games with a box line
    PRIMARY KEY (league, athlete_id)
);

-- Team history: one row per player, season and team he appeared for.
CREATE TABLE IF NOT EXISTS player_team_seasons (
    league          TEXT    NOT NULL,
    athlete_id      INTEGER NOT NULL,
    season          INTEGER NOT NULL,
    team_id         INTEGER NOT NULL REFERENCES teams (team_id),
    games           INTEGER NOT NULL,
    first_game_date TEXT,
    last_game_date  TEXT,
    PRIMARY KEY (league, athlete_id, season, team_id)
);

-- MLB batting: everyone in the batting box, in box order.
CREATE TABLE IF NOT EXISTS player_game_mlb_batting (
    espn_event_id INTEGER NOT NULL, season INTEGER NOT NULL, season_type INTEGER,
    game_date TEXT NOT NULL, team_id INTEGER NOT NULL, opp_team_id INTEGER NOT NULL,
    is_home INTEGER NOT NULL, athlete_id INTEGER NOT NULL, position TEXT,
    starter INTEGER NOT NULL,                   -- in the starting lineup
    bat_order INTEGER,                          -- lineup slot 1-9 (subs share their slot)
    box_order INTEGER NOT NULL,                 -- 1-based order within the team's box
    ab INTEGER, r INTEGER, h INTEGER, rbi INTEGER, hr INTEGER, bb INTEGER, k INTEGER,
    pitches INTEGER,                            -- pitches seen
    stats_json TEXT NOT NULL,
    PRIMARY KEY (espn_event_id, team_id, athlete_id)
);

-- MLB pitching. pitch_order 1 = first pitcher listed = the starter.
CREATE TABLE IF NOT EXISTS player_game_mlb_pitching (
    espn_event_id INTEGER NOT NULL, season INTEGER NOT NULL, season_type INTEGER,
    game_date TEXT NOT NULL, team_id INTEGER NOT NULL, opp_team_id INTEGER NOT NULL,
    is_home INTEGER NOT NULL, athlete_id INTEGER NOT NULL, position TEXT,
    starter INTEGER NOT NULL,                   -- pitch_order = 1
    pitch_order INTEGER NOT NULL,
    decision TEXT,                              -- W | L | S | H | BS (ESPN note)
    outs INTEGER,                               -- innings pitched as outs (IP 5.2 = 17)
    h INTEGER, r INTEGER, er INTEGER, bb INTEGER, k INTEGER, hr INTEGER,
    pitches INTEGER, strikes INTEGER,
    stats_json TEXT NOT NULL,
    PRIMARY KEY (espn_event_id, team_id, athlete_id)
);

-- NBA: every listed player, including did-not-play (stats NULL).
CREATE TABLE IF NOT EXISTS player_game_nba (
    espn_event_id INTEGER NOT NULL, season INTEGER NOT NULL, season_type INTEGER,
    game_date TEXT NOT NULL, team_id INTEGER NOT NULL, opp_team_id INTEGER NOT NULL,
    is_home INTEGER NOT NULL, athlete_id INTEGER NOT NULL, position TEXT,
    starter INTEGER NOT NULL,
    did_not_play INTEGER NOT NULL,
    dnp_reason TEXT,                            -- only when did_not_play
    ejected INTEGER,
    minutes INTEGER, pts INTEGER, fgm INTEGER, fga INTEGER, fg3m INTEGER, fg3a INTEGER,
    ftm INTEGER, fta INTEGER, reb INTEGER, oreb INTEGER, dreb INTEGER, ast INTEGER,
    tov INTEGER, stl INTEGER, blk INTEGER, pf INTEGER, plus_minus INTEGER,
    stats_json TEXT NOT NULL,
    PRIMARY KEY (espn_event_id, team_id, athlete_id)
);

-- NHL skaters (forwards and defense). Times in seconds.
CREATE TABLE IF NOT EXISTS player_game_nhl_skater (
    espn_event_id INTEGER NOT NULL, season INTEGER NOT NULL, season_type INTEGER,
    game_date TEXT NOT NULL, team_id INTEGER NOT NULL, opp_team_id INTEGER NOT NULL,
    is_home INTEGER NOT NULL, athlete_id INTEGER NOT NULL, position TEXT,
    unit TEXT NOT NULL,                         -- forwards | defenses | skaters
    toi_sec INTEGER, pp_toi_sec INTEGER, sh_toi_sec INTEGER, es_toi_sec INTEGER,
    shifts INTEGER, g INTEGER, a INTEGER, shots INTEGER, shots_missed INTEGER,
    plus_minus INTEGER, hits INTEGER, blocks INTEGER, takeaways INTEGER,
    giveaways INTEGER, fo_won INTEGER, fo_lost INTEGER, pim INTEGER, so_goals INTEGER,
    stats_json TEXT NOT NULL,
    PRIMARY KEY (espn_event_id, team_id, athlete_id)
);

-- NHL goalies. starter = most time on ice for his team (ties: first listed).
-- ESPN's box has no goalie decision (W/L/OTL).
CREATE TABLE IF NOT EXISTS player_game_nhl_goalie (
    espn_event_id INTEGER NOT NULL, season INTEGER NOT NULL, season_type INTEGER,
    game_date TEXT NOT NULL, team_id INTEGER NOT NULL, opp_team_id INTEGER NOT NULL,
    is_home INTEGER NOT NULL, athlete_id INTEGER NOT NULL, position TEXT,
    starter INTEGER NOT NULL,
    goalie_order INTEGER NOT NULL,              -- order listed in the box
    toi_sec INTEGER, sa INTEGER, ga INTEGER, sv INTEGER, sv_pct REAL,
    es_sv INTEGER, pp_sv INTEGER, sh_sv INTEGER, so_sa INTEGER, so_sv INTEGER, pim INTEGER,
    stats_json TEXT NOT NULL,
    PRIMARY KEY (espn_event_id, team_id, athlete_id)
);

-- NFL passing. qb_starter = most attempts for his team (ties: first listed).
CREATE TABLE IF NOT EXISTS player_game_nfl_passing (
    espn_event_id INTEGER NOT NULL, season INTEGER NOT NULL, season_type INTEGER,
    game_date TEXT NOT NULL, team_id INTEGER NOT NULL, opp_team_id INTEGER NOT NULL,
    is_home INTEGER NOT NULL, athlete_id INTEGER NOT NULL,
    qb_starter INTEGER NOT NULL,
    cmp INTEGER, att INTEGER, yds INTEGER, td INTEGER, ints INTEGER,
    sacks INTEGER, sack_yds INTEGER, qbr REAL, rating REAL,
    stats_json TEXT NOT NULL,
    PRIMARY KEY (espn_event_id, team_id, athlete_id)
);

CREATE TABLE IF NOT EXISTS player_game_nfl_rushing (
    espn_event_id INTEGER NOT NULL, season INTEGER NOT NULL, season_type INTEGER,
    game_date TEXT NOT NULL, team_id INTEGER NOT NULL, opp_team_id INTEGER NOT NULL,
    is_home INTEGER NOT NULL, athlete_id INTEGER NOT NULL,
    car INTEGER, yds INTEGER, td INTEGER, long INTEGER,
    stats_json TEXT NOT NULL,
    PRIMARY KEY (espn_event_id, team_id, athlete_id)
);

CREATE TABLE IF NOT EXISTS player_game_nfl_receiving (
    espn_event_id INTEGER NOT NULL, season INTEGER NOT NULL, season_type INTEGER,
    game_date TEXT NOT NULL, team_id INTEGER NOT NULL, opp_team_id INTEGER NOT NULL,
    is_home INTEGER NOT NULL, athlete_id INTEGER NOT NULL,
    rec INTEGER, tgt INTEGER, yds INTEGER, td INTEGER, long INTEGER,
    stats_json TEXT NOT NULL,
    PRIMARY KEY (espn_event_id, team_id, athlete_id)
);

-- NFL defense, fumbles, interceptions, kick/punt returns, kicking, punting:
-- one row per player and category; stats in stats_json (json_extract them).
CREATE TABLE IF NOT EXISTS player_game_nfl_other (
    espn_event_id INTEGER NOT NULL, season INTEGER NOT NULL, season_type INTEGER,
    game_date TEXT NOT NULL, team_id INTEGER NOT NULL, opp_team_id INTEGER NOT NULL,
    is_home INTEGER NOT NULL, athlete_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    stats_json TEXT NOT NULL,
    PRIMARY KEY (espn_event_id, team_id, athlete_id, category)
);

-- One row per game summary processed: makes the extractor resumable and
-- re-extracts when the summary is refetched or the parser version changes.
-- status: ok | no_box (summary has no player box) | error (see note).
CREATE TABLE IF NOT EXISTS player_extract_log (
    espn_event_id      INTEGER PRIMARY KEY,
    league             TEXT    NOT NULL,
    summary_fetched_at TEXT    NOT NULL,
    extracted_at       TEXT    NOT NULL,
    version            INTEGER NOT NULL,
    status             TEXT    NOT NULL,
    rows               INTEGER NOT NULL DEFAULT 0,
    note               TEXT
);

-- Team totals per game from the stored summary (bayesratings/team_counts.py).
-- counts_json is [for, against] in that module's COUNTS order.
-- The NFL player model reads yards allowed from these rows.
CREATE TABLE IF NOT EXISTS team_game_stats (
    espn_event_id      INTEGER NOT NULL,
    team_id            INTEGER NOT NULL,
    opp_team_id        INTEGER NOT NULL,
    league             TEXT    NOT NULL,
    season             INTEGER NOT NULL,
    season_type        INTEGER,
    game_date          TEXT    NOT NULL,
    is_home            INTEGER NOT NULL,
    points_for         INTEGER,
    points_against     INTEGER,
    summary_fetched_at TEXT    NOT NULL,
    version            INTEGER NOT NULL,
    counts_json        TEXT,
    PRIMARY KEY (espn_event_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_team_game_stats_season
    ON team_game_stats (league, season, game_date);

-- player lookups: one player's games, one team's games
CREATE INDEX IF NOT EXISTS idx_pg_mlb_batting_athlete ON player_game_mlb_batting (athlete_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_mlb_batting_team ON player_game_mlb_batting (team_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_mlb_pitching_athlete ON player_game_mlb_pitching (athlete_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_mlb_pitching_team ON player_game_mlb_pitching (team_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_nba_athlete ON player_game_nba (athlete_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_nba_team ON player_game_nba (team_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_nhl_skater_athlete ON player_game_nhl_skater (athlete_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_nhl_skater_team ON player_game_nhl_skater (team_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_nhl_goalie_athlete ON player_game_nhl_goalie (athlete_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_nhl_goalie_team ON player_game_nhl_goalie (team_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_nfl_passing_athlete ON player_game_nfl_passing (athlete_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_nfl_passing_team ON player_game_nfl_passing (team_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_nfl_rushing_athlete ON player_game_nfl_rushing (athlete_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_nfl_rushing_team ON player_game_nfl_rushing (team_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_nfl_receiving_athlete ON player_game_nfl_receiving (athlete_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_nfl_receiving_team ON player_game_nfl_receiving (team_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_nfl_other_athlete ON player_game_nfl_other (athlete_id, game_date);
CREATE INDEX IF NOT EXISTS idx_pg_nfl_other_team ON player_game_nfl_other (team_id, game_date);
CREATE INDEX IF NOT EXISTS idx_player_team_seasons_team ON player_team_seasons (league, team_id, season);

-- ---------------------------------------------------------------------------
-- Pre-game data logging (bayesratings/prelog.py). LOGGING ONLY: nothing reads
-- these for the model, forecasts or pages yet.
--
-- Change-only tables carry one row per distinct state: valid_from = first
-- fetch that saw it, last_seen = latest fetch that still saw it, valid_to =
-- the fetch that saw it change or disappear (NULL = current). State at T:
--   valid_from <= T AND (valid_to IS NULL OR valid_to > T)
-- state_hash covers the typed columns; raw_json is ESPN's object (links and
-- images dropped) as first seen in that state. Times are ISO UTC.

CREATE TABLE IF NOT EXISTS game_probables (     -- scoreboards: hourly refresh, morning, pre-game, mlb-probables
    id            INTEGER PRIMARY KEY,
    espn_event_id INTEGER NOT NULL,
    league        TEXT    NOT NULL,
    team_id       INTEGER NOT NULL,
    kind          TEXT    NOT NULL,             -- SP (MLB pitcher), SG (NHL goalie), ...
    athlete_id    INTEGER,
    name          TEXT,
    status        TEXT,                         -- NHL: Expected | Confirmed
    raw_json      TEXT,
    state_hash    TEXT    NOT NULL,
    valid_from    TEXT    NOT NULL,
    valid_to      TEXT,
    last_seen     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_probables_event ON game_probables (espn_event_id, valid_to);

CREATE TABLE IF NOT EXISTS game_odds (          -- ESPN's betting block per provider
    id            INTEGER PRIMARY KEY,
    espn_event_id INTEGER NOT NULL,
    league        TEXT    NOT NULL,
    provider_id   INTEGER NOT NULL,
    provider      TEXT,
    details       TEXT,                         -- e.g. 'TB -114'
    over_under    REAL,
    home_ml INTEGER, away_ml INTEGER, home_ml_open INTEGER, away_ml_open INTEGER,
    home_spread REAL, home_spread_odds INTEGER, away_spread_odds INTEGER, home_spread_open REAL,
    total REAL, over_odds INTEGER, under_odds INTEGER, total_open REAL,
    home_favorite INTEGER,
    raw_json      TEXT,
    state_hash    TEXT    NOT NULL,
    valid_from    TEXT    NOT NULL,
    valid_to      TEXT,
    last_seen     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_odds_event ON game_odds (espn_event_id, valid_to);

CREATE TABLE IF NOT EXISTS game_weather (
    id            INTEGER PRIMARY KEY,
    espn_event_id INTEGER NOT NULL,
    league        TEXT    NOT NULL,
    source        TEXT    NOT NULL,             -- scoreboard | summary
    condition TEXT, condition_id INTEGER, temperature INTEGER, high_temp INTEGER,
    low_temp INTEGER, gust INTEGER, precipitation INTEGER,
    raw_json      TEXT,
    state_hash    TEXT    NOT NULL,
    valid_from    TEXT    NOT NULL,
    valid_to      TEXT,
    last_seen     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_weather_event ON game_weather (espn_event_id, valid_to);

CREATE TABLE IF NOT EXISTS roster_states (      -- per-team roster endpoint
    id            INTEGER PRIMARY KEY,
    league        TEXT    NOT NULL,
    team_id       INTEGER NOT NULL,
    athlete_id    INTEGER NOT NULL,
    name          TEXT,
    position      TEXT,
    jersey        TEXT,
    roster_group  TEXT,                         -- ESPN grouping: Pitchers, offense, injuredReserveOrOut, ...
    status        TEXT,                         -- Active, Day-To-Day, Practice Squad, ...
    injury_status TEXT,                         -- Out, Questionable, Injured Reserve, 10-Day-IL, ...
    injury_date   TEXT,
    raw_json      TEXT,
    state_hash    TEXT    NOT NULL,
    valid_from    TEXT    NOT NULL,
    valid_to      TEXT,
    last_seen     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_roster_states_team ON roster_states (league, team_id, valid_to);
CREATE INDEX IF NOT EXISTS idx_roster_states_athlete ON roster_states (league, athlete_id, valid_from);

CREATE TABLE IF NOT EXISTS injury_details (     -- core API, fetched once per new roster injury
    id            INTEGER PRIMARY KEY,
    league        TEXT    NOT NULL,
    injury_id     INTEGER NOT NULL,
    team_id       INTEGER,
    athlete_id    INTEGER NOT NULL,
    status        TEXT,
    injury_date   TEXT,
    type          TEXT,                         -- body part, e.g. Back
    detail        TEXT,                         -- e.g. Inflammation
    side          TEXT,
    return_date   TEXT,
    fantasy_status TEXT,
    short_comment TEXT,
    raw_json      TEXT,
    state_hash    TEXT    NOT NULL,
    valid_from    TEXT    NOT NULL,
    valid_to      TEXT,
    last_seen     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_injury_details_athlete ON injury_details (league, athlete_id, valid_to);
CREATE INDEX IF NOT EXISTS idx_injury_details_id ON injury_details (league, injury_id, valid_to);

CREATE TABLE IF NOT EXISTS injury_lookups (     -- which roster injury states we've looked up
    league        TEXT    NOT NULL,
    athlete_id    INTEGER NOT NULL,
    roster_status TEXT    NOT NULL,
    roster_injury_date TEXT,
    injury_id     INTEGER,                      -- NULL: ESPN's core list had no entry
    checked_at    TEXT    NOT NULL,
    PRIMARY KEY (league, athlete_id, roster_status, roster_injury_date)
);

CREATE TABLE IF NOT EXISTS nfl_depth_states (
    id            INTEGER PRIMARY KEY,
    league        TEXT    NOT NULL,             -- always nfl
    team_id       INTEGER NOT NULL,
    formation     TEXT    NOT NULL,             -- e.g. '3WR 1TE', 'Base 4-3 D', 'Special Teams'
    slot          TEXT    NOT NULL,             -- ESPN key: qb, rb, wr1, lde, ...
    depth         INTEGER NOT NULL,             -- 1 = starter
    athlete_id    INTEGER,
    name          TEXT,
    position      TEXT,
    raw_json      TEXT,
    state_hash    TEXT    NOT NULL,
    valid_from    TEXT    NOT NULL,
    valid_to      TEXT,
    last_seen     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nfl_depth_team ON nfl_depth_states (team_id, valid_to);
CREATE INDEX IF NOT EXISTS idx_nfl_depth_athlete ON nfl_depth_states (athlete_id, valid_to);

CREATE TABLE IF NOT EXISTS transactions (       -- append-only, deduplicated
    league        TEXT    NOT NULL,
    txn_key       TEXT    NOT NULL,             -- hash of date | team | description
    txn_date      TEXT,
    espn_team_id  INTEGER,
    team_id       INTEGER,
    description   TEXT,
    raw_json      TEXT,
    first_seen    TEXT    NOT NULL,
    PRIMARY KEY (league, txn_key)
);
CREATE INDEX IF NOT EXISTS idx_transactions_team ON transactions (team_id, txn_date);

CREATE TABLE IF NOT EXISTS pregame_snapshots (  -- one per game per pre-game fetch
    espn_event_id INTEGER NOT NULL,
    fetched_at    TEXT    NOT NULL,
    league        TEXT    NOT NULL,
    start_time_utc TEXT   NOT NULL,             -- start as we had it then
    minutes_before INTEGER,
    status        TEXT,
    n_lineup      INTEGER,
    n_injuries    INTEGER,
    weather_condition_id INTEGER, temperature INTEGER, gust INTEGER, precipitation INTEGER,
    raw_bytes     INTEGER,
    summary_gz    BLOB,                         -- summary JSON minus news/videos/standings
    PRIMARY KEY (espn_event_id, fetched_at)
);
CREATE INDEX IF NOT EXISTS idx_pregame_snapshots_league ON pregame_snapshots (league, fetched_at);

CREATE TABLE IF NOT EXISTS pregame_lineups (
    espn_event_id INTEGER NOT NULL,
    fetched_at    TEXT    NOT NULL,
    team_id       INTEGER NOT NULL,
    role          TEXT    NOT NULL,             -- lineup | bench | starter | probable | inactive
    athlete_id    INTEGER NOT NULL,
    name          TEXT,
    order_no      INTEGER,                      -- MLB batting order
    position      TEXT,
    status        TEXT,                         -- probable status / DNP reason
    group_name    TEXT,                         -- box group (NHL forwards/goalies, ...)
    raw_json      TEXT,
    PRIMARY KEY (espn_event_id, fetched_at, team_id, role, athlete_id)
);

CREATE TABLE IF NOT EXISTS pregame_injuries (
    espn_event_id INTEGER NOT NULL,
    fetched_at    TEXT    NOT NULL,
    team_id       INTEGER NOT NULL,
    athlete_id    INTEGER NOT NULL,
    name          TEXT,
    status        TEXT,
    injury_date   TEXT,
    type          TEXT,
    detail        TEXT,
    side          TEXT,
    return_date   TEXT,
    raw_json      TEXT,
    PRIMARY KEY (espn_event_id, fetched_at, team_id, athlete_id)
);

CREATE TABLE IF NOT EXISTS prelog_runs (
    id            INTEGER PRIMARY KEY,
    kind          TEXT    NOT NULL,             -- scoreboard | rosters | depth | transactions | pregame
    league        TEXT    NOT NULL,
    started_at    TEXT    NOT NULL,
    finished_at   TEXT    NOT NULL,
    requests      INTEGER,                      -- NULL for scoreboard logging (no extra requests)
    changed       INTEGER,
    errors        INTEGER NOT NULL DEFAULT 0,
    counts_json   TEXT,
    note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_prelog_runs_kind ON prelog_runs (kind, league, finished_at);

-- ---------------------------------------------------------------------------
-- Gap sources (bayesratings/sources): rosters, injuries, lineups, probables.
-- Change-only *_states tables follow the
-- prelog convention (valid_from / valid_to / last_seen / state_hash).

-- raw payloads, one row per distinct body per (source, key); last_seen moves
-- while the body stays the same
CREATE TABLE IF NOT EXISTS src_raw (
    id            INTEGER PRIMARY KEY,
    source        TEXT    NOT NULL,
    raw_key       TEXT    NOT NULL,
    content_hash  TEXT    NOT NULL,
    fetched_at    TEXT    NOT NULL,
    last_seen     TEXT    NOT NULL,
    content_type  TEXT,
    n_bytes       INTEGER NOT NULL,
    body_gz       BLOB    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_src_raw_key ON src_raw (source, raw_key, fetched_at);

CREATE TABLE IF NOT EXISTS src_meta (           -- robots.txt cache etc.
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT NOT NULL
);

-- external id -> ESPN id (players, teams, games). espn_id NULL = looked up,
-- no match (see ext_unmatched); method: xref | name_team | name_box | name_league | static
-- | xref_unverified (MLB xref not an id ESPN has given us, no name match)
CREATE TABLE IF NOT EXISTS ext_ids (
    source     TEXT    NOT NULL,                -- mlbam | dfo | nbainj | nflverse | venue
    league     TEXT    NOT NULL,
    kind       TEXT    NOT NULL,                -- player | team | game
    ext_id     TEXT    NOT NULL,
    espn_id    INTEGER,                         -- ESPN athlete / team espn_id / event id
    team_id    INTEGER,                         -- our team_id (teams table) when known
    name       TEXT,
    method     TEXT,
    first_seen TEXT    NOT NULL,
    last_seen  TEXT    NOT NULL,
    xref_id    INTEGER,                         -- mlbam: MLB's raw "espn" xref (may not be an ESPN athlete id)
    PRIMARY KEY (source, league, kind, ext_id)
);

-- everything we could not map to ESPN, never dropped silently
CREATE TABLE IF NOT EXISTS ext_unmatched (
    source      TEXT    NOT NULL,
    league      TEXT    NOT NULL,
    kind        TEXT    NOT NULL,               -- player | team | game | venue
    ext_key     TEXT    NOT NULL,
    name        TEXT,
    team        TEXT,
    context     TEXT,
    first_seen  TEXT    NOT NULL,
    last_seen   TEXT    NOT NULL,
    n_seen      INTEGER NOT NULL DEFAULT 1,
    resolved_at TEXT,
    PRIMARY KEY (source, league, kind, ext_key)
);

-- per-game passes (MLB lineup polls, NFL inactives, NBA starters, weather):
-- which game was looked at when, and whether the data was there
CREATE TABLE IF NOT EXISTS src_game_passes (
    source        TEXT    NOT NULL,
    espn_event_id INTEGER NOT NULL,
    phase         TEXT    NOT NULL,
    fetched_at    TEXT    NOT NULL,
    found         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source, espn_event_id, phase, fetched_at)
);

-- MLB Stats API: 40-man + every non-active status (IL etc.) on the full roster
CREATE TABLE IF NOT EXISTS mlb_roster_states (
    id            INTEGER PRIMARY KEY,
    league        TEXT    NOT NULL DEFAULT 'mlb',
    mlb_team_id   INTEGER NOT NULL,
    team_id       INTEGER,
    mlb_person_id INTEGER NOT NULL,
    athlete_id    INTEGER,                      -- ESPN athlete id (via MLB xref)
    name          TEXT,
    position      TEXT,
    jersey        TEXT,
    status_code   TEXT,                         -- A, 40M, D10, D15, D60, RM, ...
    status_desc   TEXT,
    on_40man      INTEGER,
    raw_json      TEXT,
    state_hash    TEXT    NOT NULL,
    valid_from    TEXT    NOT NULL,
    valid_to      TEXT,
    last_seen     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_roster_open ON mlb_roster_states (mlb_team_id, valid_to);
CREATE INDEX IF NOT EXISTS idx_mlb_roster_person ON mlb_roster_states (mlb_person_id, valid_from);
CREATE INDEX IF NOT EXISTS idx_mlb_roster_athlete ON mlb_roster_states (athlete_id, valid_to);

CREATE TABLE IF NOT EXISTS mlb_transactions (
    txn_id          INTEGER PRIMARY KEY,         -- MLB transaction id
    txn_date        TEXT,
    effective_date  TEXT,
    resolution_date TEXT,
    type_code       TEXT,
    type_desc       TEXT,
    description     TEXT,                        -- carries the injury: "... 15-day injured list. Right wrist inflammation."
    mlb_person_id   INTEGER,
    athlete_id      INTEGER,
    from_mlb_team   INTEGER,
    to_mlb_team     INTEGER,
    team_id         INTEGER,
    il_related      INTEGER NOT NULL DEFAULT 0,
    first_seen      TEXT    NOT NULL,
    last_seen       TEXT    NOT NULL,
    raw_json        TEXT
);
CREATE INDEX IF NOT EXISTS idx_mlb_tx_person ON mlb_transactions (mlb_person_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_mlb_tx_athlete ON mlb_transactions (athlete_id, txn_date);

-- MLB gamePk <-> ESPN event, and when each side's lineup was first seen
CREATE TABLE IF NOT EXISTS mlb_games (
    game_pk        INTEGER PRIMARY KEY,
    espn_event_id  INTEGER,
    official_date  TEXT,
    start_time_utc TEXT,
    home_mlb_team  INTEGER,
    away_mlb_team  INTEGER,
    venue_id       INTEGER,
    game_number    INTEGER,
    status         TEXT,
    lineup_home_at TEXT,
    lineup_away_at TEXT,
    weather_json   TEXT,                         -- MLB's own game weather once posted
    first_seen     TEXT    NOT NULL,
    last_seen      TEXT    NOT NULL
);

-- batting order slots 1-9 and slot 0 = probable / starting pitcher
CREATE TABLE IF NOT EXISTS mlb_lineup_states (
    id            INTEGER PRIMARY KEY,
    league        TEXT    NOT NULL DEFAULT 'mlb',
    game_pk       INTEGER NOT NULL,
    espn_event_id INTEGER,
    side          TEXT    NOT NULL,             -- home | away
    slot          INTEGER NOT NULL,
    team_id       INTEGER,
    mlb_person_id INTEGER,
    athlete_id    INTEGER,
    name          TEXT,
    position      TEXT,
    raw_json      TEXT,
    state_hash    TEXT    NOT NULL,
    valid_from    TEXT    NOT NULL,
    valid_to      TEXT,
    last_seen     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_lineup_game ON mlb_lineup_states (game_pk, valid_to);
CREATE INDEX IF NOT EXISTS idx_mlb_lineup_event ON mlb_lineup_states (espn_event_id);

-- Daily Faceoff starting goalies: one state per (date, team)
CREATE TABLE IF NOT EXISTS nhl_goalie_states (
    id              INTEGER PRIMARY KEY,
    league          TEXT    NOT NULL DEFAULT 'nhl',
    game_date       TEXT    NOT NULL,           -- DFO's date
    dfo_team_id     INTEGER NOT NULL,
    team_name       TEXT,
    team_id         INTEGER,
    espn_event_id   INTEGER,
    game_time_utc   TEXT,
    side            TEXT,
    dfo_goalie_id   INTEGER,
    goalie_name     TEXT,
    athlete_id      INTEGER,
    strength        TEXT,                       -- Confirmed | Likely | Unconfirmed
    news_created_at TEXT,                       -- when DFO posted the status (UTC)
    news_details    TEXT,
    source_name     TEXT,
    source_url      TEXT,
    raw_json        TEXT,
    state_hash      TEXT    NOT NULL,
    valid_from      TEXT    NOT NULL,
    valid_to        TEXT,
    last_seen       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_goalie_date ON nhl_goalie_states (game_date, valid_to);
CREATE INDEX IF NOT EXISTS idx_nhl_goalie_event ON nhl_goalie_states (espn_event_id);

-- Daily Faceoff line combinations: one state per (team, unit, player)
CREATE TABLE IF NOT EXISTS nhl_line_states (
    id             INTEGER PRIMARY KEY,
    league         TEXT    NOT NULL DEFAULT 'nhl',
    dfo_team_id    INTEGER NOT NULL,
    team_id        INTEGER,
    group_id       TEXT    NOT NULL,            -- f1..f4, d1..d3, g, pp1, pp2, pk1, pk2, ir
    category       TEXT,                        -- ev | pp | pk | oi
    dfo_player_id  INTEGER NOT NULL,
    name           TEXT,
    athlete_id     INTEGER,
    position_id    TEXT,                        -- lw c rw ld rd g1 g2 sk1..
    injury_status  TEXT,
    gtd            INTEGER,
    dfo_updated_at TEXT,
    dfo_source     TEXT,
    raw_json       TEXT,
    state_hash     TEXT    NOT NULL,
    valid_from     TEXT    NOT NULL,
    valid_to       TEXT,
    last_seen      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_line_team ON nhl_line_states (dfo_team_id, valid_to);
CREATE INDEX IF NOT EXISTS idx_nhl_line_athlete ON nhl_line_states (athlete_id, valid_to);

-- NBA official injury report PDFs (one row per report fetched).
-- The nightly inj-hist pass and the off-server archive backfill write the
-- same tables. Training reads a status only when valid_from is before tip.
CREATE TABLE IF NOT EXISTS nba_injury_reports (
    report_slot   TEXT PRIMARY KEY,             -- 'YYYY-MM-DD HH:MM' US/Eastern
    report_ts_utc TEXT,                         -- the report's own title time, in UTC
    url           TEXT    NOT NULL,
    fetched_at    TEXT    NOT NULL,
    backfill      INTEGER NOT NULL DEFAULT 0,
    n_rows        INTEGER,
    n_unmatched   INTEGER,
    text_sha1     TEXT,
    text_gz       BLOB,                         -- extracted words by line (always)
    pdf_gz        BLOB                          -- the PDF itself, when kept
);

CREATE TABLE IF NOT EXISTS nba_injury_states (
    id            INTEGER PRIMARY KEY,
    league        TEXT    NOT NULL DEFAULT 'nba',
    game_date     TEXT    NOT NULL,             -- report's game date (ET)
    team_name     TEXT    NOT NULL,
    player_key    TEXT    NOT NULL,             -- 'Last, First' as printed, or '(NOT YET SUBMITTED)'
    team_id       INTEGER,
    matchup       TEXT,
    game_time     TEXT,
    espn_event_id INTEGER,
    athlete_id    INTEGER,
    player_name   TEXT,                         -- First Last
    status        TEXT,                         -- Out | Doubtful | Questionable | Probable | Available | NOT YET SUBMITTED
    reason        TEXT,
    report_slot   TEXT,
    raw_json      TEXT,
    state_hash    TEXT    NOT NULL,
    valid_from    TEXT    NOT NULL,
    valid_to      TEXT,
    last_seen     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_inj_date ON nba_injury_states (game_date, valid_to);
CREATE INDEX IF NOT EXISTS idx_nba_inj_event ON nba_injury_states (espn_event_id);
CREATE INDEX IF NOT EXISTS idx_nba_inj_athlete ON nba_injury_states (athlete_id, game_date);

-- nflverse injuries (official report: practice participation + game status),
-- logged daily so Wed/Thu/Fri changes are kept here. The season file from
-- the inj-hist backfill is the same table. Training reads open rows.
CREATE TABLE IF NOT EXISTS nfl_injury_report_states (
    id                        INTEGER PRIMARY KEY,
    league                    TEXT    NOT NULL DEFAULT 'nfl',
    season                    INTEGER NOT NULL,
    game_type                 TEXT,
    week                      INTEGER NOT NULL,
    team                      TEXT    NOT NULL, -- nflverse abbreviation
    gsis_id                   TEXT    NOT NULL,
    team_id                   INTEGER,
    athlete_id                INTEGER,
    full_name                 TEXT,
    position                  TEXT,
    report_primary_injury     TEXT,
    report_secondary_injury   TEXT,
    report_status             TEXT,
    practice_primary_injury   TEXT,
    practice_secondary_injury TEXT,
    practice_status           TEXT,
    raw_json                  TEXT,
    state_hash                TEXT    NOT NULL,
    valid_from                TEXT    NOT NULL,
    valid_to                  TEXT,
    last_seen                 TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nfl_injrep_week ON nfl_injury_report_states (season, week, valid_to);
CREATE INDEX IF NOT EXISTS idx_nfl_injrep_athlete ON nfl_injury_report_states (athlete_id, season, week);

CREATE TABLE IF NOT EXISTS nfl_weekly_roster_states (
    id          INTEGER PRIMARY KEY,
    league      TEXT    NOT NULL DEFAULT 'nfl',
    season      INTEGER NOT NULL,
    week        INTEGER NOT NULL,
    gsis_id     TEXT    NOT NULL,
    game_type   TEXT,
    team        TEXT,
    team_id     INTEGER,
    espn_id     INTEGER,
    athlete_id  INTEGER,
    full_name   TEXT,
    position    TEXT,
    status      TEXT,                           -- ACT, INA (game-day inactive), RES, DEV, CUT ...
    status_abbr TEXT,
    raw_json    TEXT,
    state_hash  TEXT    NOT NULL,
    valid_from  TEXT    NOT NULL,
    valid_to    TEXT,
    last_seen   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nfl_wroster_week ON nfl_weekly_roster_states (season, week, valid_to);

-- NFL game-day inactives from ESPN's per-team injury list (~60 and ~20 min
-- before kickoff)
CREATE TABLE IF NOT EXISTS nfl_inactives (
    espn_event_id  INTEGER NOT NULL,
    team_id        INTEGER NOT NULL,
    athlete_id     INTEGER NOT NULL,
    fetched_at     TEXT    NOT NULL,
    minutes_before INTEGER,
    injury_id      INTEGER,
    name           TEXT,
    status         TEXT,
    fantasy_status TEXT,
    injury_date    TEXT,                        -- ESPN's timestamp on the entry
    type           TEXT,
    PRIMARY KEY (espn_event_id, team_id, athlete_id, fetched_at)
);

-- NBA starters from ESPN's box score at / just after tip
CREATE TABLE IF NOT EXISTS nba_starters (
    espn_event_id INTEGER NOT NULL,
    team_id       INTEGER NOT NULL,
    athlete_id    INTEGER NOT NULL,
    fetched_at    TEXT    NOT NULL,
    minutes_after INTEGER,
    name          TEXT,
    position      TEXT,
    raw_json      TEXT,
    PRIMARY KEY (espn_event_id, team_id, athlete_id)
);

-- NBA probable starting lineups (sources/nbalineups.py): NBA.com daily lineups
-- (Expected / Confirmed), else ESPN's depth chart. Change-only, one row per
-- (game, team, slot). The NBA player ridge adds a listed starter who has
-- no box history for the team.
CREATE TABLE IF NOT EXISTS nba_lineup_states (
    id            INTEGER PRIMARY KEY,
    league        TEXT    NOT NULL DEFAULT 'nba',
    espn_event_id INTEGER NOT NULL,
    team_id       INTEGER NOT NULL,
    slot          TEXT    NOT NULL,             -- PG | SG | SF | PF | C
    athlete_id    INTEGER,                      -- ESPN id (NULL: name not matched)
    name          TEXT,
    status        TEXT,                         -- Expected | Confirmed (NBA.com) | depth chart
    src           TEXT    NOT NULL,             -- nba.com | espn_depth
    nba_person_id INTEGER,
    raw_json      TEXT,
    state_hash    TEXT    NOT NULL,
    valid_from    TEXT    NOT NULL,
    valid_to      TEXT,
    last_seen     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_lineup_event ON nba_lineup_states (espn_event_id, team_id, valid_to);

-- NBA player ridge (nba_player.py). One row per weekly fit (versions B and C).
-- A failed refit leaves the previous row in place; predictions read the latest
-- row per version. Existing forecast rows are not rewritten when a fit is stored.
CREATE TABLE IF NOT EXISTS nba_ridge_fits (
    fit_id          INTEGER PRIMARY KEY,
    fit_date        TEXT    NOT NULL,           -- America/Chicago date of the run
    version         TEXT    NOT NULL,           -- B (report availability) | C (last rotation)
    train_from      TEXT    NOT NULL,           -- 2021-12-01
    train_through   TEXT    NOT NULL,           -- day before the fit
    n_games         INTEGER NOT NULL,
    c_value         REAL,
    features        TEXT    NOT NULL,           -- JSON list, column order of the design matrix
    scaler_mean     TEXT    NOT NULL,           -- JSON
    scaler_scale    TEXT    NOT NULL,           -- JSON
    coef            TEXT    NOT NULL,           -- JSON
    intercept       REAL    NOT NULL,
    sklearn_version TEXT,
    created_at      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_ridge_version ON nba_ridge_fits (version, fit_date);

-- Pregame player rate state, replaced each morning. Sums are as of last_game_date
-- after that game, so a forecast decays them to the game date. prior_min is the
-- long-form minute mass at last_game_date (after that game).
CREATE TABLE IF NOT EXISTS nba_player_state (
    as_of_date    TEXT    NOT NULL,             -- the morning's date; games before this date
    athlete_id    INTEGER NOT NULL,
    team_id       INTEGER,                      -- team on his latest box line
    last_game_date TEXT,
    exp_min       REAL,                         -- ewm of minutes after the last game (12 before any)
    prior_min     REAL,                         -- long-form minutes at last_game_date, after that game
    state_json    TEXT    NOT NULL,             -- decayed sums, TS sums, league prior
    PRIMARY KEY (as_of_date, athlete_id)
);

-- NHL player ridge (nhl_player.py). One row per weekly fit (versions B and C).
-- A failed refit leaves the previous row in place; predictions read the latest
-- row per version. Existing forecast rows are not rewritten when a fit is stored.
CREATE TABLE IF NOT EXISTS nhl_ridge_fits (
    fit_id          INTEGER PRIMARY KEY,
    fit_date        TEXT    NOT NULL,           -- America/Chicago date of the run
    version         TEXT    NOT NULL,           -- B (lines + confirmed goalie) | C (no lineup)
    train_from      TEXT    NOT NULL,           -- 2021-12-01
    train_through   TEXT    NOT NULL,           -- day before the fit
    n_games         INTEGER NOT NULL,
    c_value         REAL,
    features        TEXT    NOT NULL,           -- JSON list, column order of the design matrix
    scaler_mean     TEXT    NOT NULL,           -- JSON
    scaler_scale    TEXT    NOT NULL,           -- JSON
    coef            TEXT    NOT NULL,           -- JSON
    intercept       REAL    NOT NULL,
    sklearn_version TEXT,
    created_at      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_ridge_version ON nhl_ridge_fits (version, fit_date);

-- Pregame skater rate state, replaced each morning. Sums are as of last_game_date
-- after that game, so a forecast decays them to the game date. skater_expo is the
-- long-form minutes at last_game_date, after that game.
CREATE TABLE IF NOT EXISTS nhl_player_state (
    as_of_date     TEXT    NOT NULL,            -- the morning's date; games before this date
    athlete_id     INTEGER NOT NULL,
    team_id        INTEGER,                     -- team on his latest box line
    last_game_date TEXT,
    exp_toi        REAL,                        -- EWM of minutes after the last game
    skater_expo    REAL,                        -- long-form minutes at last_game_date, after that game
    is_defense     INTEGER,                     -- last box position is defense
    state_json     TEXT    NOT NULL,            -- decayed sums, league prior, position
    PRIMARY KEY (as_of_date, athlete_id)
);

-- Pregame goalie rate state, replaced each morning. Sums are shots and saves
-- after last_game_date, decayed to the game date for goals saved above average.
CREATE TABLE IF NOT EXISTS nhl_goalie_state (
    as_of_date     TEXT    NOT NULL,
    athlete_id     INTEGER NOT NULL,
    team_id        INTEGER,
    last_game_date TEXT,
    state_json     TEXT    NOT NULL,            -- save sums, shots faced, league save rate
    PRIMARY KEY (as_of_date, athlete_id)
);

-- NFL quarterback ridge (nfl_player.py). One row per weekly fit of the
-- team-rating plus confirmed-starter model. A failed refit leaves the
-- previous row in place. Existing forecast rows are not rewritten when a
-- fit is stored.
CREATE TABLE IF NOT EXISTS nfl_ridge_fits (
    fit_id          INTEGER PRIMARY KEY,
    fit_date        TEXT    NOT NULL,           -- America/Chicago date of the run
    version         TEXT    NOT NULL,           -- qbA (confirmed starter)
    train_from      TEXT    NOT NULL,           -- 2007 season; 2006 is history only
    train_through   TEXT    NOT NULL,           -- day before the fit
    n_games         INTEGER NOT NULL,
    c_value         REAL,
    features        TEXT    NOT NULL,           -- JSON list, column order of the design matrix
    scaler_mean     TEXT    NOT NULL,           -- JSON
    scaler_scale    TEXT    NOT NULL,           -- JSON
    coef            TEXT    NOT NULL,           -- JSON
    intercept       REAL    NOT NULL,
    sklearn_version TEXT,
    created_at      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nfl_ridge_version ON nfl_ridge_fits (version, fit_date);

-- MLB player stack (mlb_player.py). One row per weekly fit of stack B
-- (posted lineups and known starters, on the team+starter probability).
-- A failed refit leaves the previous row in place. Existing forecast rows
-- are not rewritten when a fit is stored. Published only when n_games is
-- at least 2,000, sd_p is at least 0.6 times sd_team, and mean_p is
-- within 0.03 of win_rate. Those four columns are the in-sample check.
CREATE TABLE IF NOT EXISTS mlb_ridge_fits (
    fit_id          INTEGER PRIMARY KEY,
    fit_date        TEXT    NOT NULL,           -- America/Chicago date of the run
    version         TEXT    NOT NULL,           -- stack_b
    train_from      TEXT    NOT NULL,           -- 2022; earlier seasons are rate history only
    train_through   TEXT    NOT NULL,           -- day before the fit
    n_games         INTEGER NOT NULL,
    c_value         REAL,
    features        TEXT    NOT NULL,           -- JSON list, column order of the design matrix
    scaler_mean     TEXT    NOT NULL,           -- JSON
    scaler_scale    TEXT    NOT NULL,           -- JSON
    coef            TEXT    NOT NULL,           -- JSON
    intercept       REAL    NOT NULL,
    sklearn_version TEXT,
    created_at      TEXT    NOT NULL,
    sd_p            REAL,                       -- sd of in-sample predicted home probabilities
    sd_team         REAL,                       -- sd of the team+starter probabilities
    mean_p          REAL,                       -- mean in-sample predicted home probability
    win_rate        REAL                        -- home win rate on the same rows
);
CREATE INDEX IF NOT EXISTS idx_mlb_ridge_version ON mlb_ridge_fits (version, fit_date);

-- Pregame batter and pitcher rate state, replaced each MLB morning from
-- games before that day. role is batter, pitcher, prior_bat or prior_pit.
-- state_json is the sums after the last game, which a forecast decays to
-- the game date. athlete_id 0 holds the league prior.
CREATE TABLE IF NOT EXISTS mlb_player_state (
    as_of_date     TEXT    NOT NULL,
    athlete_id     INTEGER NOT NULL,
    role           TEXT    NOT NULL,
    last_game_date TEXT,
    state_json     TEXT    NOT NULL,
    PRIMARY KEY (as_of_date, athlete_id, role)
);

-- Reliever appearances with the pregame rate at that appearance, so a
-- forecast can weight the previous 14 days without rereading every box.
-- Replaced each MLB morning. Not exported.
CREATE TABLE IF NOT EXISTS mlb_relief_log (
    team_id        INTEGER NOT NULL,
    game_date      TEXT    NOT NULL,
    espn_event_id  INTEGER NOT NULL,
    athlete_id     INTEGER NOT NULL,
    outs           REAL,
    pitches        REAL,
    fip_bf         REAL,
    xwcon          REAL,
    PRIMARY KEY (espn_event_id, athlete_id)
);
CREATE INDEX IF NOT EXISTS idx_mlb_relief_team ON mlb_relief_log (team_id, game_date);

-- Pregame quarterback rate state, replaced each morning from play-by-play
-- dated before that day. state_json is the last game's pregame rate plus that
-- game's dropbacks, which a forecast updates without a current-game row.
CREATE TABLE IF NOT EXISTS nfl_qb_state (
    as_of_date     TEXT    NOT NULL,
    qb             TEXT    NOT NULL,            -- nflverse player id
    last_game_date TEXT,
    last_game_id   TEXT,
    state_json     TEXT    NOT NULL,
    PRIMARY KEY (as_of_date, qb)
);

-- nflverse schedule rows used to name the starter of a completed game and to
-- join play-by-play to an ESPN event. The file has spread, total, and
-- moneyline columns. This package does not store them. A contributor can add them.
CREATE TABLE IF NOT EXISTS nfl_schedule (
    game_id         TEXT    PRIMARY KEY,        -- nflverse game id
    season          INTEGER NOT NULL,
    week            INTEGER,
    game_type       TEXT,
    game_date       TEXT,
    home_franchise  TEXT,
    away_franchise  TEXT,
    home_qb_gsis    TEXT,
    away_qb_gsis    TEXT,
    espn_event_id   INTEGER,
    home_score      REAL,
    away_score      REAL
);
CREATE INDEX IF NOT EXISTS idx_nfl_schedule_date ON nfl_schedule (game_date);
CREATE INDEX IF NOT EXISTS idx_nfl_schedule_espn ON nfl_schedule (espn_event_id);

-- One row per quarterback per game: dropback EPA and completion percentage
-- over expected, summed from nflverse play-by-play. Replaced per season.
CREATE TABLE IF NOT EXISTS nfl_pbp_qb (
    game_id    TEXT    NOT NULL,
    season     INTEGER NOT NULL,
    game_date  TEXT,
    team       TEXT    NOT NULL,
    qb         TEXT    NOT NULL,                -- nflverse player id
    qb_epa     REAL    NOT NULL,
    qb_n       INTEGER NOT NULL,
    cpoe_sum   REAL    NOT NULL,
    cpoe_n     INTEGER NOT NULL,
    PRIMARY KEY (game_id, team, qb)
);
CREATE INDEX IF NOT EXISTS idx_nfl_pbp_qb_qb ON nfl_pbp_qb (qb, game_date);

-- Walk-forward team-logit home chance for NFL games before 2025-09-04
-- (nfl_team_hist.py). The quarterback ridge reads it when a game has no
-- game-day forecast snapshot. Not a published rating.
CREATE TABLE IF NOT EXISTS nfl_team_chance_hist (
    game_id        TEXT    PRIMARY KEY,        -- nflverse game id
    espn_event_id  INTEGER,
    game_date      TEXT    NOT NULL,
    p              REAL    NOT NULL,           -- home win chance
    model_version  TEXT    NOT NULL,
    created_at     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nfl_team_chance_espn ON nfl_team_chance_hist (espn_event_id);

-- Walk-forward MLB team+starter home chance (mlb_team_hist.py). Training
-- input for the player stack when a game has no game-day forecast snapshot.
-- Not a published rating. Not exported.
CREATE TABLE IF NOT EXISTS mlb_team_chance_hist (
    espn_event_id  INTEGER PRIMARY KEY,
    game_date      TEXT    NOT NULL,
    season         INTEGER NOT NULL,
    p              REAL    NOT NULL,           -- home team+starter win chance
    source         TEXT    NOT NULL,           -- snapshot | stan
    model_version  TEXT    NOT NULL,
    created_at     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_team_chance_date ON mlb_team_chance_hist (game_date);

-- NHL shot locations from api-web.nhle.com play-by-play (sources/nhl_pbp.py).
-- Stored for our own xG. Not read by the forecast, the NHL player model, or any page.
-- season is the NHL start year (2024 = 2024-25), not the ESPN end-year label.
CREATE TABLE IF NOT EXISTS nhl_games (
    nhl_game_id    INTEGER PRIMARY KEY,         -- NHL gamecenter id
    season         INTEGER NOT NULL,
    game_type      INTEGER NOT NULL,            -- 2 regular, 3 playoffs
    game_date      TEXT    NOT NULL,
    start_time_utc TEXT,
    home_nhl_id    INTEGER NOT NULL,
    away_nhl_id    INTEGER NOT NULL,
    home_abbrev    TEXT    NOT NULL,
    away_abbrev    TEXT    NOT NULL,
    home_score     INTEGER,
    away_score     INTEGER,
    espn_event_id  INTEGER,                     -- filled when this game is in games
    content_hash   TEXT    NOT NULL,            -- sha1 of the play-by-play body
    fetched_at     TEXT    NOT NULL,
    n_shots        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_games_date ON nhl_games (game_date);
CREATE INDEX IF NOT EXISTS idx_nhl_games_espn ON nhl_games (espn_event_id);

-- One row per shot attempt. result: goal | shot (on goal, saved) | miss | block.
-- distance and angle are feet and degrees to the net being attacked.
-- xg is null until nhl_xg_model is stored, and stays null on blocks and shootout shots.
CREATE TABLE IF NOT EXISTS nhl_shots (
    nhl_game_id    INTEGER NOT NULL,
    event_id       INTEGER NOT NULL,
    sort_order     INTEGER,
    period         INTEGER,
    period_type    TEXT,                        -- REG | OT | SO
    clock_sec      INTEGER,                     -- seconds from the start of the period
    situation_code TEXT,                        -- away goalie, away skaters, home skaters, home goalie
    strength       TEXT,                        -- even | powerplay | shorthanded | empty
    result         TEXT    NOT NULL,
    shot_type      TEXT,
    x_coord        INTEGER,
    y_coord        INTEGER,
    zone_code      TEXT,
    distance       REAL,
    angle          REAL,
    rebound        INTEGER NOT NULL DEFAULT 0,  -- same-team shot within 3s of a non-goal
    rush           INTEGER NOT NULL DEFAULT 0,  -- within 4s of a takeaway or an opponent giveaway
    shooter_id     INTEGER,                     -- NHL player id
    goalie_id      INTEGER,                     -- null on a block or an empty net
    team_nhl_id    INTEGER NOT NULL,            -- shooting team
    opp_nhl_id     INTEGER,
    is_home        INTEGER NOT NULL,
    xg             REAL,
    PRIMARY KEY (nhl_game_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_nhl_shots_shooter ON nhl_shots (shooter_id, nhl_game_id);
CREATE INDEX IF NOT EXISTS idx_nhl_shots_goalie ON nhl_shots (goalie_id, nhl_game_id);

-- Per player per game. Skater xg is unblocked xG for; xg_per_60 is null without TOI.
-- Goalie gsax is xG faced on unblocked shots minus goals allowed. Shootout shots are left out.
CREATE TABLE IF NOT EXISTS nhl_player_xg (
    nhl_game_id  INTEGER NOT NULL,
    player_id    INTEGER NOT NULL,              -- NHL player id
    role         TEXT    NOT NULL,              -- skater | goalie
    team_nhl_id  INTEGER,
    is_home      INTEGER,
    name         TEXT,
    position     TEXT,
    toi_sec      INTEGER,
    shots        INTEGER NOT NULL,              -- skater: attempts; goalie: unblocked shots faced
    goals        INTEGER NOT NULL,              -- skater: goals; goalie: goals allowed
    xg           REAL,                          -- skater: xG for; goalie: xG faced
    xg_per_60    REAL,                          -- skater only
    gsax         REAL,                          -- goalie only
    PRIMARY KEY (nhl_game_id, player_id, role)
);
CREATE INDEX IF NOT EXISTS idx_nhl_player_xg_player ON nhl_player_xg (player_id, role);

-- One logistic fit. coef is JSON in the same order as features. Replaced on refit.
CREATE TABLE IF NOT EXISTS nhl_xg_model (
    model_id   INTEGER PRIMARY KEY,
    fit_at     TEXT    NOT NULL,
    n_shots    INTEGER NOT NULL,                -- unblocked shots with coordinates, no shootout
    n_goals    INTEGER NOT NULL,
    features   TEXT    NOT NULL,
    coef       TEXT    NOT NULL,
    intercept  REAL    NOT NULL,
    notes      TEXT
);

-- MLB Stats API box scores (sources/mlb_box.py). The batting and pitching
-- counts ESPN's box does not keep. The Tuesday MLB stack reads them.
-- The nightly pass does not itself change a published forecast.
-- season is the MLB season year. History from 2006.
CREATE TABLE IF NOT EXISTS mlb_box_games (
    game_pk        INTEGER PRIMARY KEY,         -- statsapi gamePk
    season         INTEGER NOT NULL,
    game_type      TEXT    NOT NULL,            -- R regular, F/D/L/W postseason
    game_number    INTEGER NOT NULL,            -- 2 on the second game of a doubleheader
    game_date      TEXT    NOT NULL,            -- officialDate
    start_time_utc TEXT,
    home_mlb_id    INTEGER NOT NULL,
    away_mlb_id    INTEGER NOT NULL,
    home_abbrev    TEXT    NOT NULL,
    away_abbrev    TEXT    NOT NULL,
    home_name      TEXT,
    away_name      TEXT,
    home_score     INTEGER,
    away_score     INTEGER,
    espn_event_id  INTEGER,                     -- filled when date and teams match one game
    content_hash   TEXT    NOT NULL,            -- sha1 of the boxscore body
    fetched_at     TEXT    NOT NULL,
    n_players      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_box_games_date ON mlb_box_games (game_date);
CREATE INDEX IF NOT EXISTS idx_mlb_box_games_espn ON mlb_box_games (espn_event_id);

-- One row per player per game. Batting columns are null when he did not bat;
-- pitching columns (p_*) are null when he did not pitch. A two-way player is one row.
-- These are the standard counts ESPN's batting and pitching boxes do not store,
-- plus the extra-base hits, hit by pitch, and sacrifices named for the batting line.
CREATE TABLE IF NOT EXISTS mlb_box_players (
    game_pk             INTEGER NOT NULL,
    mlb_person_id       INTEGER NOT NULL,       -- MLB Stats API player id
    side                TEXT    NOT NULL,       -- home | away
    team_mlb_id         INTEGER NOT NULL,
    is_home             INTEGER NOT NULL,
    name                TEXT,
    position            TEXT,
    bat_order           INTEGER,                -- lineup slot 1-9; null if he did not bat
    doubles             INTEGER,
    triples             INTEGER,
    home_runs           INTEGER,
    hit_by_pitch        INTEGER,
    sac_flies           INTEGER,
    sac_bunts           INTEGER,
    plate_appearances   INTEGER,
    total_bases         INTEGER,
    stolen_bases        INTEGER,
    caught_stealing     INTEGER,
    intentional_walks   INTEGER,
    gidp                INTEGER,
    p_doubles           INTEGER,
    p_triples           INTEGER,
    p_hit_batters       INTEGER,
    p_sac_flies         INTEGER,
    p_sac_bunts         INTEGER,
    p_intentional_walks INTEGER,
    p_wild_pitches      INTEGER,
    p_balks             INTEGER,
    p_batters_faced     INTEGER,
    p_ground_outs       INTEGER,
    p_air_outs          INTEGER,
    p_stolen_bases      INTEGER,
    p_caught_stealing   INTEGER,
    p_inherited_runners INTEGER,
    p_inherited_scored  INTEGER,
    p_wins              INTEGER,
    p_losses            INTEGER,
    p_saves             INTEGER,
    p_holds             INTEGER,
    p_blown_saves       INTEGER,
    p_games_started     INTEGER,
    athlete_id          INTEGER,                -- ESPN id when name and team match
    PRIMARY KEY (game_pk, mlb_person_id)
);
CREATE INDEX IF NOT EXISTS idx_mlb_box_players_player ON mlb_box_players (mlb_person_id, game_pk);
CREATE INDEX IF NOT EXISTS idx_mlb_box_players_athlete ON mlb_box_players (athlete_id);

-- Baseball Savant statcast_search batted balls only (sources/mlb_statcast.py).
-- Pitches are not stored. The Tuesday MLB stack reads the player totals.
-- The nightly pass does not itself change a published forecast.
-- History from 2015. A date row means that official date was stored in full.
CREATE TABLE IF NOT EXISTS mlb_statcast_dates (
    game_date    TEXT    PRIMARY KEY,
    season       INTEGER NOT NULL,
    fetched_at   TEXT    NOT NULL,
    n_events     INTEGER NOT NULL,
    n_games      INTEGER NOT NULL,
    content_hash TEXT    NOT NULL             -- sha1 of the batted-ball rows, not the raw CSV
);

CREATE TABLE IF NOT EXISTS mlb_statcast_games (
    game_pk       INTEGER PRIMARY KEY,
    season        INTEGER NOT NULL,
    game_type     TEXT    NOT NULL,
    game_date     TEXT    NOT NULL,
    home_abbrev   TEXT    NOT NULL,
    away_abbrev   TEXT    NOT NULL,
    home_score    INTEGER,
    away_score    INTEGER,
    espn_event_id INTEGER,
    n_batted      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_statcast_games_date ON mlb_statcast_games (game_date);
CREATE INDEX IF NOT EXISTS idx_mlb_statcast_games_espn ON mlb_statcast_games (espn_event_id);

-- One batted ball in play (Statcast type X). Foul balls are not stored.
-- hit_distance is Savant's hit_distance_sc. The key is the pitch inside the game.
CREATE TABLE IF NOT EXISTS mlb_batted_balls (
    game_pk                         INTEGER NOT NULL,
    at_bat_number                   INTEGER NOT NULL,
    pitch_number                    INTEGER NOT NULL,
    game_date                       TEXT    NOT NULL,
    season                          INTEGER NOT NULL,
    game_type                       TEXT,
    batter                          INTEGER NOT NULL,    -- MLB player id
    pitcher                         INTEGER NOT NULL,
    events                          TEXT,
    launch_speed                    REAL,
    launch_angle                    REAL,
    hit_distance                    REAL,
    bb_type                         TEXT,
    estimated_ba_using_speedangle   REAL,
    estimated_woba_using_speedangle REAL,
    woba_value                      REAL,
    PRIMARY KEY (game_pk, at_bat_number, pitch_number)
);
CREATE INDEX IF NOT EXISTS idx_mlb_batted_balls_date ON mlb_batted_balls (game_date);
CREATE INDEX IF NOT EXISTS idx_mlb_batted_balls_batter ON mlb_batted_balls (batter, game_date);
CREATE INDEX IF NOT EXISTS idx_mlb_batted_balls_pitcher ON mlb_batted_balls (pitcher, game_date);

-- Per player per game, for the batter and for the pitcher.
-- avg_ev is the mean of tracked exit velocities (ev_n of them).
-- hard_hit is launch speed of at least 95 mph.
-- barrels use Savant's launch_speed_angle code 6, or the published
-- exit-velocity / launch-angle window when that code is absent.
-- xwoba_sum / xwoba_n are estimated_woba_using_speedangle.
CREATE TABLE IF NOT EXISTS mlb_batted_players (
    game_pk       INTEGER NOT NULL,
    mlb_person_id INTEGER NOT NULL,
    role          TEXT    NOT NULL,            -- batter | pitcher
    game_date     TEXT    NOT NULL,
    season        INTEGER NOT NULL,
    team_abbrev   TEXT,
    is_home       INTEGER,
    name          TEXT,
    batted_balls  INTEGER NOT NULL,
    avg_ev        REAL,
    ev_n          INTEGER NOT NULL,
    hard_hit      INTEGER NOT NULL,
    barrels       INTEGER NOT NULL,
    xwoba_sum     REAL    NOT NULL,
    xwoba_n       INTEGER NOT NULL,
    athlete_id    INTEGER,
    PRIMARY KEY (game_pk, mlb_person_id, role)
);
CREATE INDEX IF NOT EXISTS idx_mlb_batted_players_player ON mlb_batted_players (mlb_person_id, role, game_date);
CREATE INDEX IF NOT EXISTS idx_mlb_batted_players_athlete ON mlb_batted_players (athlete_id);

-- Venue rows from the MLB Stats API (coordinates, roof, orientation).
CREATE TABLE IF NOT EXISTS venues (
    league         TEXT    NOT NULL,
    venue_key      TEXT    NOT NULL,            -- MLB venue id, NFL normalized name
    name           TEXT    NOT NULL,
    aliases        TEXT,                        -- '|'-separated other names ESPN uses
    mlb_venue_id   INTEGER,
    home_team_id   INTEGER,
    lat            REAL,
    lon            REAL,
    roof           TEXT,                        -- open | retractable | dome | fixed
    azimuth        REAL,                        -- MLB: home plate -> center field bearing
    elevation      REAL,
    country        TEXT,
    source         TEXT,
    nws_office     TEXT,
    nws_x          INTEGER,
    nws_y          INTEGER,
    nws_hourly_url TEXT,
    nws_checked_at TEXT,
    updated_at     TEXT    NOT NULL,
    PRIMARY KEY (league, venue_key)
);

-- hourly forecast for outdoor games: start hour (offset 0) and the next 3
CREATE TABLE IF NOT EXISTS player_values (
    snapshot_date TEXT    NOT NULL,             -- America/Chicago run date
    league        TEXT    NOT NULL,
    team_id       INTEGER NOT NULL,
    athlete_id    INTEGER NOT NULL,
    role          TEXT    NOT NULL,             -- P | F | D | G | QB | H | SP | RP
    value         REAL,                         -- per game, league units (player_values.py)
    value_lo      REAL,                         -- 90% range
    value_hi      REAL,
    usage         REAL,                         -- minutes / dropbacks / PA / outs per game
    sample        REAL,                         -- decayed sample behind the rate
    win_logit     REAL,                         -- win-term change when he plays vs the fallback
    is_out        INTEGER,                      -- 1 = counted out for the next game
    out_src       TEXT,
    PRIMARY KEY (snapshot_date, league, team_id, athlete_id, role)
);

CREATE INDEX IF NOT EXISTS idx_player_values_team ON player_values (league, team_id, snapshot_date);

-- Static building coordinates for games.venue (bayesratings/data/venues.csv).
-- Separate from the `venues` table above. One row per building, reloaded by
-- travel.load_coords from init_db. Every ESPN spelling, including the
-- canonical name, is a venue_aliases row.
CREATE TABLE IF NOT EXISTS venue_coords (
    venue_id  INTEGER PRIMARY KEY,
    name      TEXT NOT NULL UNIQUE,          -- one ESPN spelling of the building
    city      TEXT,
    region    TEXT,                          -- state, province, or country
    lat       REAL NOT NULL,
    lon       REAL NOT NULL,
    tz        TEXT NOT NULL,                 -- IANA time zone of that coordinate
    source    TEXT NOT NULL,                 -- where the coordinates were copied from
    loaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS venue_aliases (
    alias    TEXT PRIMARY KEY,               -- ESPN venue spelling
    venue_id INTEGER NOT NULL REFERENCES venue_coords (venue_id)
);

CREATE INDEX IF NOT EXISTS idx_venue_aliases_venue ON venue_aliases (venue_id);

CREATE VIEW IF NOT EXISTS game_venues AS
SELECT g.espn_event_id, g.league, g.season, g.game_date, g.start_time_utc,
       g.home_team_id, g.away_team_id, g.venue, g.neutral_site,
       c.venue_id, c.name AS venue_name, c.city, c.region,
       c.lat, c.lon, c.tz
FROM games g
LEFT JOIN venue_aliases a ON a.alias = g.venue
LEFT JOIN venue_coords c ON c.venue_id = a.venue_id;
