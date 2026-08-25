// Tests the ASSEMBLED Worker — its real timingSafeEqual, loadLeague, fbGet and
// handleScores — with only the network faked. Run: node test-mcp.mjs
import { readFileSync } from "fs";
import { createRequire } from "module";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import worker from "../dawg-bot-worker.js";
import P from "./pound-core.js";

const require = createRequire(import.meta.url);
const WORK = dirname(fileURLToPath(import.meta.url));
const DDFS = require("./dfs-engine.js").DDFS;
const DDSurvivorPath = require("./survivor-path-engine.js").DDSurvivorPath;
const makeSlate = require("./mkslate.js");

// Counts are pinned deliberately: a tool appearing or vanishing should break a test, not
// slip through. They live here so adding a tool is one edit, not nine.
const N_TOOLS = 55, N_CORE = 25;
const WRITE_TOOLS = ["dd_submit_bozo_leg", "sd_start_session", "sd_log_set", "sd_log_sets",
                     "sd_finish_session", "sd_log_measurement", "sd_log_nutrition"];
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error("FAIL:", name); } };

/* ------------------------------ fake network ------------------------------ */
const FB = "https://data-dawgs-draft-default-rtdb.firebaseio.com";
const NOW = Date.now();
const leagueRec = {
  name: "Data Dawgs", manager: "Kap", season: 2026, week: 1, status: "open",
  members: { Kap: true, Jeff: true, "The%20Kid": true },
  picks: {
    Jeff: { sport: "nfl", eventId: "401", game: "CLE @ PIT", mkt: "spread", side: "CLE", dir: "over", line: 3.5, price: -140, label: "CLE -3.5", ts: NOW - 2000, priceSource: "self" },
    Kap:  { sport: "nfl", eventId: "402", game: "DET @ GB",  mkt: "total",  side: "over", dir: "over", line: 47.5, price: -110, label: "Over 47.5", ts: NOW - 1000, priceSource: "self" },
  },
};
const draftRec = {
  ts: NOW,
  state: {
    settings: { budget: 200, spots: 15, scoring: "half", teams: [{ name: "Team A", owner: "Kap" }, { name: "Team B", owner: "Jeff" }] },
    picks: [{ player: "Jahmyr Gibbs", pos: "RB", ti: 0, price: 73, keeper: false, ts: NOW }],
    nomIdx: 1, onBlock: "Bijan Robinson",
  },
};
const poolJson = { as_of: "2026-07-29", source: "MV snapshot", note: "dated", tier: "labs", graded: false, scoring_keys: { half: "Half PPR" }, data: [
  { name: "Jahmyr Gibbs", pos: "RB", team: "DET", half: 81, rank: 1 },
  { name: "Ja'Marr Chase", pos: "WR", team: "CIN", half: 68, rank: 3 },
] };
const dfsHtml = 'junk before\nconst CORR = {"meta":{"seasons":[2019,2025]},"roles":["QB"],"same":[[1.0]],"opp":[[0.19]],"cv":{"QB":[{"lo":10,"hi":14,"cv":0.62,"n":62}]}};\njunk after';
const espnRaw = { events: [{ id: "401", shortName: "CLE @ PIT", date: "2026-09-13", status: { type: { state: "pre", completed: false } }, competitions: [{ competitors: [{ team: { abbreviation: "PIT" }, homeAway: "home", score: null }, { team: { abbreviation: "CLE" }, homeAway: "away", score: null }] }] }] };
const survJson = { data: {
  meta: { season: 2026, captured: "2026-08-06", elo_per_pt: 23.58, hfa: 2.1, sd: 13.18, nfelo_sha: "0d3f8418" },
  elo: { SEA: 1620, ARI: 1420, PIT: 1520, CLE: 1500 },
  teams: { SEA: { n: "Seahawks", loc: "Seattle", full: "Seattle Seahawks" },
           ARI: { n: "Cardinals", loc: "Arizona", full: "Arizona Cardinals" },
           PIT: { n: "Steelers", loc: "Pittsburgh", full: "Pittsburgh Steelers" },
           CLE: { n: "Browns", loc: "Cleveland", full: "Cleveland Browns" } },
  games: [
    { id: "2026_01_ARI_SEA", wk: 1, h: "SEA", a: "ARI", d: "2026-09-13", p: 0.8, src: "market" },
    { id: "2026_01_CLE_PIT", wk: 1, h: "PIT", a: "CLE", d: "2026-09-13", p: 0.55, src: "model" },
    { id: "2026_02_PIT_SEA", wk: 2, h: "SEA", a: "PIT", d: "2026-09-20", p: 0.7, src: "model" },
    { id: "2026_02_ARI_CLE", wk: 2, h: "CLE", a: "ARI", d: "2026-09-20", p: 0.6, src: "model" },
  ],
} };
const modelReceiptsJson = {
  as_of: "2026-08-08",
  source: "test normalized prospective receipt ledger",
  built: "2026-08-08",
  graded: false,
  integrity: { algorithm: "test", sha256: "abc123", rows: 7 },
  data: [
    { forecast_id: "nfelo-cle-old", game_id: "2026_01_CLE_PIT", season: 2026, week: 1, kickoff_at: "2026-09-13T17:00:00Z", captured_at: "2026-08-06T00:00:00Z", model_id: "nfelo", model_name: "nfelo", model_version: "4.3.0", source_repo: "greerreNFL/nfelo", source_commit: "n-old", source_capture_at: "2026-08-06T00:00:00Z", home_team: "PIT", away_team: "CLE", home_win_probability: 0.40, input_snapshot_id: "sha256:n-old", schedule_snapshot_id: "sha256:schedule", forecast_status: "prospective", methodology_url: "https://example.test/nfelo", license_status: "output-only" },
    { forecast_id: "nfelo-cle-new", game_id: "2026_01_CLE_PIT", season: 2026, week: 1, kickoff_at: "2026-09-13T17:00:00Z", captured_at: "2026-08-07T00:00:00Z", model_id: "nfelo", model_name: "nfelo", model_version: "4.3.0", source_repo: "greerreNFL/nfelo", source_commit: "n-new", source_capture_at: "2026-08-07T00:00:00Z", home_team: "PIT", away_team: "CLE", home_win_probability: 0.45, input_snapshot_id: "sha256:n-new", schedule_snapshot_id: "sha256:schedule", forecast_status: "prospective", methodology_url: "https://example.test/nfelo", license_status: "output-only" },
    { forecast_id: "classic-cle", game_id: "2026_01_CLE_PIT", season: 2026, week: 1, kickoff_at: "2026-09-13T17:00:00Z", captured_at: "2026-08-08T00:00:00Z", model_id: "538-classic", model_name: "538 Classic Elo", model_version: "classic-1.0.0", source_repo: "fivethirtyeight/nfl-elo-game", source_commit: "c1", source_capture_at: "2026-08-08T00:00:00Z", home_team: "PIT", away_team: "CLE", home_win_probability: 0.65, input_snapshot_id: "sha256:c1", schedule_snapshot_id: "sha256:schedule", forecast_status: "prospective", methodology_url: "https://example.test/classic", license_status: "MIT" },
    { forecast_id: "nfelo-ari", game_id: "2026_01_ARI_SEA", season: 2026, week: 1, kickoff_at: "2026-09-13T20:00:00Z", captured_at: "2026-08-07T00:00:00Z", model_id: "nfelo", model_name: "nfelo", model_version: "4.3.0", source_repo: "greerreNFL/nfelo", source_commit: "n2", source_capture_at: "2026-08-07T00:00:00Z", home_team: "SEA", away_team: "ARI", home_win_probability: 0.80, input_snapshot_id: "sha256:n2", schedule_snapshot_id: "sha256:schedule", forecast_status: "prospective", methodology_url: "https://example.test/nfelo", license_status: "output-only" },
    { forecast_id: "classic-ari", game_id: "2026_01_ARI_SEA", season: 2026, week: 1, kickoff_at: "2026-09-13T20:00:00Z", captured_at: "2026-08-08T00:00:00Z", model_id: "538-classic", model_name: "538 Classic Elo", model_version: "classic-1.0.0", source_repo: "fivethirtyeight/nfl-elo-game", source_commit: "c2", source_capture_at: "2026-08-08T00:00:00Z", home_team: "SEA", away_team: "ARI", home_win_probability: 0.75, input_snapshot_id: "sha256:c2", schedule_snapshot_id: "sha256:schedule", forecast_status: "prospective", methodology_url: "https://example.test/classic", license_status: "MIT" },
    { forecast_id: "nfelo-w2", game_id: "2026_02_PIT_SEA", season: 2026, week: 2, kickoff_at: "2026-09-20T17:00:00Z", captured_at: "2026-08-07T00:00:00Z", model_id: "nfelo", model_name: "nfelo", model_version: "4.3.0", source_repo: "greerreNFL/nfelo", source_commit: "n3", source_capture_at: "2026-08-07T00:00:00Z", home_team: "SEA", away_team: "PIT", home_win_probability: 0.60, input_snapshot_id: "sha256:n3", schedule_snapshot_id: "sha256:schedule", forecast_status: "prospective", methodology_url: "https://example.test/nfelo", license_status: "output-only" },
    { forecast_id: "classic-w2", game_id: "2026_02_PIT_SEA", season: 2026, week: 2, kickoff_at: "2026-09-20T17:00:00Z", captured_at: "2026-08-08T00:00:00Z", model_id: "538-classic", model_name: "538 Classic Elo", model_version: "classic-1.0.0", source_repo: "fivethirtyeight/nfl-elo-game", source_commit: "c3", source_capture_at: "2026-08-08T00:00:00Z", home_team: "SEA", away_team: "PIT", home_win_probability: 0.55, input_snapshot_id: "sha256:c3", schedule_snapshot_id: "sha256:schedule", forecast_status: "prospective", methodology_url: "https://example.test/classic", license_status: "MIT" },
  ],
};
const cfbRatingsJson = {
  as_of: "2026-08-08",
  source: "test normalized CFB ratings registry",
  built: "2026-08-08",
  graded: false,
  integrity: { snapshot_id: "sha256:test-cfb-ratings", systems: 1, teams: 3 },
  data: {
    scope: "observed-results-plus-retrodictive-rating",
    rating_period: { season: 2025, label: "end-of-2025-season", source_field: "ratings_as_of_end_of_2025", prospective: false },
    systems: [{
      system_id: "dd-cfb-elo", name: "Data Dawgs CFB Elo baseline", provider: "Data Dawgs",
      kind: "continuous-rating", feature_family: "game results and margin only",
      source_snapshot_id: "sha256:test-cfb-elo", source_url: "/data/cfb-elo.json",
      model_card_url: "/data/cfb-model-cards.json",
      matchup_probability: {
        available: true, output: "home_win_probability",
        formula: "1 / (1 + 10 ** (-(home_team_strength - away_team_strength + home_field_elo) / elo_scale))",
        elo_scale: 400, home_field_elo: 55, neutral_site_home_field_elo: 0,
        rating_period_only: true, not_a_team_level_output: true,
      },
      outputs: {
        team_strength: { available: true, units: "elo-points" },
        expected_margin: { available: false, units: "points" },
        win_probability: { available: false, units: "probability" },
        predicted_total: { available: false, units: "points" },
      },
      team_diagnostics: {
        available: true, kind: "retrodictive-team-aggregate", source_field: "team_diagnostics.teams",
        evaluation_season: 2025,
        metrics: ["games", "observed_wins", "observed_losses", "observed_win_percentage", "expected_wins", "actual_minus_expected_wins", "mean_pregame_win_probability", "brier_win_probability"],
        prospective: false, graded: false, rankings_published: false,
        note: "Descriptive model residual, not luck, team quality, or a forecast.",
      },
      prospective_forecasts_exist: false, graded: false,
    }],
    teams: [
      { team_slug: "indiana", team: "Indiana", conference: "Big Ten", observed_results: { season: 2025, through_at: "2026-01-01T00:00:00Z", record: "16-0-0", games: 16, wins: 16, losses: 0, ties: 0, point_differential: 300 }, systems: { "dd-cfb-elo": { rank: 1, team_strength: 2054.8, games_rated: 96, expected_margin: null, win_probability: null, predicted_total: null, retrodictive_team_diagnostic: { games: 15, observed_wins: 15, observed_losses: 0, observed_win_percentage: 1, expected_wins: 11.2, actual_minus_expected_wins: 3.8, mean_pregame_win_probability: 0.7467, brier_win_probability: 0.09 } } } },
      { team_slug: "ohio-state", team: "Ohio State", conference: "Big Ten", observed_results: { season: 2025, through_at: "2026-01-01T00:30:00Z", record: "12-2-0", games: 14, wins: 12, losses: 2, ties: 0, point_differential: 338, win_percentage: 0.8571, point_differential_per_game: 24.143 }, systems: { "dd-cfb-elo": { rank: 2, team_strength: 1925.8, games_rated: 99, expected_margin: null, win_probability: null, predicted_total: null, retrodictive_team_diagnostic: { games: 13, observed_wins: 11, observed_losses: 2, observed_win_percentage: 0.8462, expected_wins: 10.1, actual_minus_expected_wins: 0.9, mean_pregame_win_probability: 0.7769, brier_win_probability: 0.12 } } } },
      { team_slug: "akron", team: "Akron", conference: "Mid-American", observed_results: { season: 2025, through_at: "2025-11-29T00:00:00Z", record: "4-8-0", games: 12, wins: 4, losses: 8, ties: 0, point_differential: -100, win_percentage: 0.3333, point_differential_per_game: -8.333 }, systems: { "dd-cfb-elo": { rank: 133, team_strength: 1088.1, games_rated: 93, expected_margin: null, win_probability: null, predicted_total: null, retrodictive_team_diagnostic: { games: 11, observed_wins: 3, observed_losses: 8, observed_win_percentage: 0.2727, expected_wins: 2.5, actual_minus_expected_wins: 0.5, mean_pregame_win_probability: 0.2273, brier_win_probability: 0.19 } } } },
    ],
    consensus: { status: "not-built", system_count: 1, weights: null, reason: "One independent rating cannot form a consensus." },
  },
};
const cfbDivergenceJson = {
  as_of: "2026-08-08",
  source: "test descriptive CFB record divergence",
  built: "2026-08-08",
  integrity: { snapshot_id: "sha256:test-cfb-divergence", rows: 3 },
  data: {
    schema_version: 1,
    season: 2025,
    status: "descriptive-baseline",
    definitions: {
      record_rank: "Observed win-percentage competition rank, descending.",
      scoring_rank: "Observed point-differential-per-game competition rank, descending.",
      record_scoring_rank_gap: "scoring_rank - record_rank; positive means record ranks better than scoring margin.",
    },
    rows: [
      {
        team_slug: "florida-state", team: "Florida State", conference: "ACC", through_at: "2025-11-29T21:30:00Z",
        games: 12, record: "5-7-0", win_percentage: 0.4167, record_rank: 83,
        point_differential_per_game: 11, scoring_rank: 26, record_scoring_rank_gap: -57,
        descriptive_direction: "scoring-ahead-of-record",
        one_score_games: { definition: "absolute final point differential <= 8", games: 4, wins: 0, losses: 4, ties: 0, win_percentage: 0 },
        predictive_label: null,
      },
      {
        team_slug: "kennesaw-state", team: "Kennesaw State", conference: "Conference USA", through_at: "2025-12-19T16:00:00Z",
        games: 14, record: "10-4-0", win_percentage: 0.7143, record_rank: 23,
        point_differential_per_game: 1.214, scoring_rank: 74, record_scoring_rank_gap: 51,
        descriptive_direction: "record-ahead-of-scoring",
        one_score_games: { definition: "absolute final point differential <= 8", games: 7, wins: 6, losses: 1, ties: 0, win_percentage: 0.8571 },
        predictive_label: null,
      },
      {
        team_slug: "ohio-state", team: "Ohio State", conference: "Big Ten", through_at: "2026-01-01T00:30:00Z",
        games: 14, record: "12-2-0", win_percentage: 0.8571, record_rank: 4,
        point_differential_per_game: 24.143, scoring_rank: 4, record_scoring_rank_gap: 0,
        descriptive_direction: "aligned",
        one_score_games: { definition: "absolute final point differential <= 8", games: 2, wins: 1, losses: 1, ties: 0, win_percentage: 0.5 },
        predictive_label: null,
      },
    ],
  },
};
const cfbDivergenceValidationJson = {
  as_of: "2026-08-08",
  source: "test aggregate chronological CFB divergence validation",
  built: "2026-08-08",
  integrity: { snapshot_id: "sha256:test-cfb-divergence-validation", qualified_games: 582 },
  data: {
    schema_version: 1,
    season: 2025,
    status: "retrodictive-chronological-validation",
    design: { pregame_only: true, split: "first 60% training / final 40% holdout", market_adjusted: false },
    result: {
      qualified_games: 582,
      holdout: { n_games: 233, brier_improvement_over_elo: 0.001123, log_loss_improvement_over_elo: 0.002277 },
      promotion_gate: { passed: true },
      finding: "held-out-incremental-signal",
    },
    roadmap_decision: {
      lifecycle_status: "evaluating", team_labels_permitted: false, prospective_value_claimed: false,
      reason: "Prospective receipts and timestamped market adjustment remain required.",
    },
    published_granularity: "aggregate-only; no game IDs, team identities or per-game predictions are serialized",
  },
};
const cfbDisagreementJson = {
  as_of: "2026-08-08",
  source: "test CFB Elo against untimestamped market prices",
  built: "2026-08-08",
  integrity: { snapshot_id: "sha256:test-cfb-disagreement" },
  data: {
    question: "When the Data Dawgs CFB Elo and the market disagree, does either side systematically win?",
    finding: "blocked",
    why_blocked: "The available market prices carry no observation timestamp, so this design cannot separate a better method from a later information set.",
    what_would_unblock_it: "One timestamped pregame market snapshot per game at a fixed hour before kickoff.",
    measured_anyway: {
      n_paired_games: 5,
      buckets: [
        { gap_low: 0, gap_high: 0.1, n: 2, underpowered: true, mean_gap: 0.05, elo_brier: 0.2, market_brier: 0.19, market_brier_advantage: 0.01 },
        { gap_low: 0.1, gap_high: null, n: 3, underpowered: true, mean_gap: 0.2, elo_brier: 0.24, market_brier: 0.18, market_brier_advantage: 0.06 },
      ],
      widest_bucket: { gap_low: 0.1, n: 3, market_brier_advantage: 0.06 },
      observed_pattern: "Market Brier advantage rises with the disagreement gap.",
      reading_if_prices_were_timestamped_and_pregame: "Only timestamped pregame prices could make the comparison interpretable.",
    },
    governance: ["cfb-gov-correlation", "cfb-gov-incremental", "cfb-gov-uncertainty"],
  },
};
const cfbModelReceiptsJson = {
  as_of: "2026-08-08",
  source: "test empty append-only prospective CFB forecast receipt ledger",
  note: "EMPTY BY DESIGN. No CFB forecast has yet been frozen before kickoff.",
  built: "2026-08-08",
  graded: false,
  integrity: { snapshot_id: "sha256:test-empty-cfb-receipts", rows: 0 },
  data: [],
};
const cfbScheduleJson = {
  as_of: "2026-08-08",
  source: "test canonical 2025 CFB schedule/results",
  built: "2026-08-08",
  integrity: { snapshot_id: "sha256:test-cfb-schedule", rows: 3, final_rows: 3 },
  data: {
    season: 2025,
    games: [
      {
        game_id: "2025_regu_01_iowa-state_kansas-state", upstream_game_id: "401",
        season: 2025, week: 1, season_type: "regular", kickoff_at: "2025-08-23T16:00:00Z",
        neutral_site: true, conference_game: true,
        home_team: "Kansas State", home_team_slug: "kansas-state", home_division: "fbs", home_conference: "Big 12",
        away_team: "Iowa State", away_team_slug: "iowa-state", away_division: "fbs", away_conference: "Big 12",
        status: "final", home_points: 21, away_points: 24,
      },
      {
        game_id: "2025_regu_12_michigan_ohio-state", upstream_game_id: "402",
        season: 2025, week: 12, season_type: "regular", kickoff_at: "2025-11-29T17:00:00Z",
        neutral_site: false, conference_game: true,
        home_team: "Ohio State", home_team_slug: "ohio-state", home_division: "fbs", home_conference: "Big Ten",
        away_team: "Michigan", away_team_slug: "michigan", away_division: "fbs", away_conference: "Big Ten",
        status: "final", home_points: 27, away_points: 24,
      },
      {
        game_id: "2025_post_01_ohio-state_georgia", upstream_game_id: "403",
        season: 2025, week: 1, season_type: "postseason", kickoff_at: "2026-01-02T01:00:00Z",
        neutral_site: true, conference_game: false,
        home_team: "Georgia", home_team_slug: "georgia", home_division: "fbs", home_conference: "SEC",
        away_team: "Ohio State", away_team_slug: "ohio-state", away_division: "fbs", away_conference: "Big Ten",
        status: "final", home_points: 30, away_points: 31,
      },
    ],
  },
};
const cfbTeamWeekJson = {
  as_of: "2026-08-08",
  source: "test schedule-derived CFB team periods",
  built: "2026-08-08",
  integrity: { snapshot_id: "sha256:test-cfb-team-week", rows: 4 },
  data: {
    schema_version: 1,
    season: 2025,
    scope: "results-only",
    period_definition: "season_type plus upstream week; regular and postseason week numbers are distinct",
    unavailable_metrics: ["epa", "success_rate", "explosiveness", "havoc", "garbage_time", "opponent_adjusted", "market_performance"],
    teams: {
      "ohio-state": { team: "Ohio State", espn_id: 194, division: "fbs", conference: "Big Ten" },
      "akron": { team: "Akron", espn_id: 2006, division: "fbs", conference: "Mid-American" },
    },
    rows: [
      {
        team_period_id: "2025_regular_01::ohio-state", season: 2025, season_type: "regular", week: 1,
        period_key: "regular-01", through_at: "2025-08-30T20:00:00Z", team_slug: "ohio-state",
        division: "fbs", conference: "Big Ten", scheduled_games_this_period: 1, opponent_slugs: ["texas"],
        home_games: 1, away_games: 0, neutral_games: 0, fbs_opponents: 1,
        period: { games: 1, wins: 1, losses: 0, ties: 0, points_for: 14, points_against: 7, point_differential: 7 },
        season_to_date: { games: 1, wins: 1, losses: 0, ties: 0, points_for: 14, points_against: 7, point_differential: 7, record: "1-0-0" },
      },
      {
        team_period_id: "2025_regular_12::ohio-state", season: 2025, season_type: "regular", week: 12,
        period_key: "regular-12", through_at: "2025-11-29T20:00:00Z", team_slug: "ohio-state",
        division: "fbs", conference: "Big Ten", scheduled_games_this_period: 1, opponent_slugs: ["michigan"],
        home_games: 1, away_games: 0, neutral_games: 0, fbs_opponents: 1,
        period: { games: 1, wins: 1, losses: 0, ties: 0, points_for: 27, points_against: 24, point_differential: 3 },
        season_to_date: { games: 12, wins: 11, losses: 1, ties: 0, points_for: 420, points_against: 120, point_differential: 300, record: "11-1-0" },
      },
      {
        team_period_id: "2025_postseason_01::ohio-state", season: 2025, season_type: "postseason", week: 1,
        period_key: "postseason-01", through_at: "2026-01-02T04:00:00Z", team_slug: "ohio-state",
        division: "fbs", conference: "Big Ten", scheduled_games_this_period: 1, opponent_slugs: ["georgia"],
        home_games: 0, away_games: 0, neutral_games: 1, fbs_opponents: 1,
        period: { games: 1, wins: 1, losses: 0, ties: 0, points_for: 31, points_against: 30, point_differential: 1 },
        season_to_date: { games: 13, wins: 12, losses: 1, ties: 0, points_for: 451, points_against: 150, point_differential: 301, record: "12-1-0" },
      },
      {
        team_period_id: "2025_regular_01::akron", season: 2025, season_type: "regular", week: 1,
        period_key: "regular-01", through_at: "2025-08-30T22:00:00Z", team_slug: "akron",
        division: "fbs", conference: "Mid-American", scheduled_games_this_period: 1, opponent_slugs: ["wyoming"],
        home_games: 0, away_games: 1, neutral_games: 0, fbs_opponents: 1,
        period: { games: 1, wins: 0, losses: 1, ties: 0, points_for: 7, points_against: 24, point_differential: -17 },
        season_to_date: { games: 1, wins: 0, losses: 1, ties: 0, points_for: 7, points_against: 24, point_differential: -17, record: "0-1-0" },
      },
    ],
  },
};
cfbTeamWeekJson.data.conference_record_definition =
  "Observed final regular-season rows marked conference_game; not an official standing, rank or tiebreaker result.";
for (const row of cfbTeamWeekJson.data.rows) {
  const ohioConferenceWin = row.team_slug === "ohio-state" &&
    (row.period_key === "regular-12" || row.period_key === "postseason-01");
  row.conference_regular_season_to_date = ohioConferenceWin
    ? { games: 1, wins: 1, losses: 0, ties: 0, points_for: 27, points_against: 24,
        point_differential: 3, record: "1-0-0" }
    : { games: 0, wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0,
        point_differential: 0, record: "0-0-0" };
}
const cfbTeamWeekLatestRows = Object.keys(cfbTeamWeekJson.data.teams).sort().map(teamSlug => {
  const source = cfbTeamWeekJson.data.rows.filter(row => row.team_slug === teamSlug)
    .sort((a, b) => b.through_at.localeCompare(a.through_at) || b.team_period_id.localeCompare(a.team_period_id))[0];
  const team = cfbTeamWeekJson.data.teams[teamSlug];
  return {
    team_slug: teamSlug, team: team.team, espn_id: team.espn_id, division: team.division, conference: team.conference,
    through_at: source.through_at,
    latest_period: {
      team_period_id: source.team_period_id, season_type: source.season_type, week: source.week, period_key: source.period_key,
      scheduled_games: source.scheduled_games_this_period, opponent_slugs: source.opponent_slugs,
      home_games: source.home_games, away_games: source.away_games, neutral_games: source.neutral_games,
      fbs_opponents: source.fbs_opponents, observed_result: source.period,
    },
    season_to_date: source.season_to_date,
    conference_regular_season_to_date: source.conference_regular_season_to_date,
  };
});
const cfbTeamWeekLatestJson = {
  as_of: "2026-08-08", source: "test compact latest CFB team periods", built: "2026-08-08", graded: false,
  integrity: { snapshot_id: "sha256:test-cfb-team-week-latest", rows: cfbTeamWeekLatestRows.length, teams: cfbTeamWeekLatestRows.length },
  data: {
    schema_version: 1, season: 2025, scope: "results-only",
    input_schedule_snapshot_id: "sha256:test-cfb-schedule", input_team_week_snapshot_id: "sha256:test-cfb-team-week",
    selection: "Maximum (through_at, team_period_id) per team from /data/cfb-team-week.json.",
    conference_record_definition: cfbTeamWeekJson.data.conference_record_definition,
    coverage: {
      schedule_scope: "Canonical 2025 games involving at least one FBS team.",
      fbs_team_records: "Complete within the canonical FBS-involved schedule.",
      fcs_team_records: "Only games against FBS opponents; not complete FCS season records.",
    },
    unavailable_metrics: cfbTeamWeekJson.data.unavailable_metrics,
    rows: cfbTeamWeekLatestRows,
  },
};
const cfbTeamGameTeams = {};
for (const game of cfbScheduleJson.data.games) {
  cfbTeamGameTeams[game.home_team_slug] = { team: game.home_team, espn_id: null, division: game.home_division, conference: game.home_conference };
  cfbTeamGameTeams[game.away_team_slug] = { team: game.away_team, espn_id: null, division: game.away_division, conference: game.away_conference };
}
const cfbTeamGameRows = cfbScheduleJson.data.games.flatMap(game => [
  { side: "home", team_slug: game.home_team_slug, opponent_slug: game.away_team_slug, points_for: game.home_points, points_against: game.away_points },
  { side: "away", team_slug: game.away_team_slug, opponent_slug: game.home_team_slug, points_for: game.away_points, points_against: game.home_points },
].map(view => ({
  team_game_id: game.game_id + "::" + view.team_slug,
  game_id: game.game_id,
  upstream_game_id: game.upstream_game_id,
  season: game.season,
  season_type: game.season_type,
  week: game.week,
  kickoff_at: game.kickoff_at,
  status: game.status,
  team_slug: view.team_slug,
  opponent_slug: view.opponent_slug,
  team_side: view.side,
  site: game.neutral_site ? "neutral" : view.side,
  neutral_site: game.neutral_site,
  conference_game: game.conference_game,
  points_for: view.points_for,
  points_against: view.points_against,
  point_differential: view.points_for - view.points_against,
  result: view.points_for === view.points_against ? "tie" : view.points_for > view.points_against ? "win" : "loss",
})));
const cfbTeamGameJson = {
  as_of: "2026-08-08",
  source: "test schedule-derived CFB team games",
  built: "2026-08-08",
  integrity: { snapshot_id: "sha256:test-cfb-team-game", rows: cfbTeamGameRows.length },
  data: {
    schema_version: 1,
    season: 2025,
    scope: "results-only",
    teams: cfbTeamGameTeams,
    unavailable_metrics: ["epa_per_play", "success_rate", "explosiveness", "havoc", "garbage_time_filtered_metrics", "opponent_adjusted_metrics", "market_performance"],
    rows: cfbTeamGameRows,
  },
};
const cfbLatestGameByTeam = new Map();
for (const row of cfbTeamGameRows) {
  const prior = cfbLatestGameByTeam.get(row.team_slug);
  if (!prior || row.kickoff_at > prior.kickoff_at ||
      (row.kickoff_at === prior.kickoff_at && row.team_game_id > prior.team_game_id))
    cfbLatestGameByTeam.set(row.team_slug, row);
}
const cfbGamesLatestRows = [...cfbLatestGameByTeam].sort(([a], [b]) => a.localeCompare(b)).map(([teamSlug, row]) => {
  const team = cfbTeamGameTeams[teamSlug];
  const opponent = cfbTeamGameTeams[row.opponent_slug];
  return {
    team_slug: teamSlug, team: team.team, espn_id: team.espn_id, conference: team.conference,
    latest_completed_game: {
      team_game_id: row.team_game_id, game_id: row.game_id, upstream_game_id: row.upstream_game_id,
      season_type: row.season_type, week: row.week, kickoff_at: row.kickoff_at,
      opponent_slug: row.opponent_slug, opponent: opponent.team, opponent_division: opponent.division,
      opponent_conference: opponent.conference, team_side: row.team_side, site: row.site,
      neutral_site: row.neutral_site, conference_game: row.conference_game,
      points_for: row.points_for, points_against: row.points_against,
      point_differential: row.point_differential, result: row.result,
    },
  };
});
const cfbGamesLatestJson = {
  as_of: "2026-08-08", source: "test compact latest completed CFB games", built: "2026-08-08", graded: false,
  integrity: { snapshot_id: "sha256:test-cfb-games-latest", rows: cfbGamesLatestRows.length, teams: cfbGamesLatestRows.length },
  data: {
    schema_version: 1, season: 2025, scope: "observed-final-results-only",
    input_schedule_snapshot_id: "sha256:test-cfb-schedule", input_team_game_snapshot_id: "sha256:test-cfb-team-game",
    selection: "Maximum (kickoff_at, team_game_id) completed row per FBS team from /data/cfb-team-game.json.",
    coverage: { team_scope: "FBS", final_games_only: true, one_row_per_represented_team: true,
      mirrored_game_can_appear_for_two_teams: true, eligible_fbs_teams: cfbGamesLatestRows.length,
      represented_teams: cfbGamesLatestRows.length, teams_without_a_completed_game: [] },
    unavailable_metrics: cfbTeamGameJson.data.unavailable_metrics,
    rows: cfbGamesLatestRows,
  },
};
const cfbMarketJson = {
  as_of: "2026-08-08",
  source: "test historical CFB prices with unknown observation timing",
  built: "2026-08-08",
  integrity: { snapshot_id: "sha256:test-cfb-market", games: 3, games_with_devig_probability: 2, rejected_quotes: 1 },
  provenance: {
    observation_timestamp_available: false,
    price_timing: "unknown",
    devig_method: "proportional normalization of two-way raw implied probabilities",
  },
  data: {
    season: 2025,
    rejected_quotes: [{ game_id: "2025_post_01_ohio-state_georgia", book: "Test Book", reason: "impossible hold" }],
    games: [
      {
        game_id: "2025_regu_01_iowa-state_kansas-state", upstream_game_id: "401", season: 2025, week: 1,
        kickoff_at: "2025-08-23T16:00:00Z", home_team: "Kansas State", away_team: "Iowa State",
        books: [{ book: "DraftKings", spread_home: -3.5, spread_open_home: -3.5, total: 49.5, total_open: 49.5,
          moneyline_home: -162, moneyline_away: 136, devig_home_win_probability: 0.59337, hold: 0.042049 }],
        median_spread_home: -3.5, median_total: 49.5, median_devig_home_win_probability: 0.59337, books_quoting: 1,
      },
      {
        game_id: "2025_regu_12_michigan_ohio-state", upstream_game_id: "402", season: 2025, week: 12,
        kickoff_at: "2025-11-29T17:00:00Z", home_team: "Ohio State", away_team: "Michigan",
        books: [{ book: "DraftKings", spread_home: -7.5, spread_open_home: -6.5, total: 45.5, total_open: 46.5,
          moneyline_home: -300, moneyline_away: 240, devig_home_win_probability: 0.730435, hold: 0.036765 }],
        median_spread_home: -7.5, median_total: 45.5, median_devig_home_win_probability: 0.730435, books_quoting: 1,
      },
      {
        game_id: "2025_post_01_ohio-state_georgia", upstream_game_id: "403", season: 2025, week: 1,
        kickoff_at: "2026-01-02T01:00:00Z", home_team: "Georgia", away_team: "Ohio State",
        books: [], median_spread_home: null, median_total: null, median_devig_home_win_probability: null, books_quoting: 0,
      },
    ],
  },
};
const cfbModelCardsJson = {
  as_of: "2026-08-08",
  source: "test generated CFB model cards",
  built: "2026-08-08",
  graded: false,
  integrity: { snapshot_id: "sha256:test-cfb-model-cards", cards: 1 },
  data: {
    cards: [{
      model_id: "cfb-elo", model_name: "Data Dawgs CFB Elo baseline", model_version: "1.0.0",
      roadmap_idea: "cfb-elo", roadmap_step: 2,
      lifecycle_status: { roadmap_lifecycle_status: "live", roadmap_implemented_flag: true },
      retirement_status: "active",
      purpose: "Be the interpretable floor every future CFB model must clear.",
      target: "Probability that the home team wins a single FBS-vs-FBS game.",
      features: ["Prior results, margin and site only."],
      training_window: { burn_in_seasons: [2018, 2019, 2020, 2021, 2022, 2023, 2024], evaluation_season: 2025 },
      parameters: { base_rating: 1500, k_factor: 35, home_field_elo: 55 },
      parameters_fixed_before_evaluation: true,
      validation_design: { kind: "retrodictive-backtest", n_games: 808 },
      performance: { full_evaluation_set: { favorite_accuracy: 0.7017, brier_home_win: 0.1862 } },
      calibration: { method: "fixed bins", bins: [] },
      known_limitations: ["No preseason, roster, injury, market or play-level input."],
      failure_modes: ["Early-season roster turnover is invisible."],
      inputs: { model_output: "/data/cfb-elo.json" },
      receipts: { prospective_receipts_exist: false, why: "No CFB forecast has been locked before kickoff yet." },
      methodology_url: "https://datadawgs216.com/docs/cfb-data-backbone.md",
      engine: "scripts/cfb_elo.py",
    }],
  },
};

let netMode = "normal"; // normal | dbdown | emptyRoom | espnDown | simulatedRoom | simulatedSettings
/* ⚠️ THE WRITE GATE. `livePicks` is null for the entire suite except inside the
   dd_submit_bozo_leg group, so the historical invariant — no read tool ever issues a
   non-GET — still hard-fails for all 42 read tools. When armed, exactly one URL may be
   PUT: the caller's own pick. Anything else non-GET still throws. */
let livePicks = null;      // armed = { ...leagueRec.picks }, mutated by the allowed PUT
let legWrites = [];        // every allowed PUT lands here for the assertions
globalThis.fetch = async (input, init) => {
  const u = String(input instanceof URL ? input.href : (input && input.url) || input);
  const method = (init && init.method) || (input && input.method) || "GET";
  const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  if (method !== "GET") {
    if (livePicks && method === "PUT" && u.startsWith(FB + "/bozo/leagues/main/picks/Kap.json")) {
      const body = JSON.parse((init && init.body) || "null");
      livePicks.Kap = body;
      legWrites.push({ url: u, body });
      return J(body);
    }
    throw new Error("TEST: non-GET network call attempted by MCP path: " + method + " " + u);
  }
  if (livePicks && u.startsWith(FB + "/bozo/leagues/main/picks.json")) return J(livePicks);
  if (u.startsWith(FB + "/bozo/leagues.json") || u.startsWith(FB + "/bozo/leagues.json?")) {
    if (netMode === "dbdown") throw new Error("connect refused");
    return J({ main: leagueRec });
  }
  if (u.startsWith(FB + "/users.json")) return J(USERS);
  if (u.includes("/bozo/leagues/main/ledger")) return J(leagueRec.ledger || null);
  if (u.startsWith(FB + "/drafts/")) {
    if (netMode === "emptyRoom") return J(null);
    // C6 — the flag lives at the top level of the room node, out of the draft app's
    // write path. `simulatedSettings` covers the other place it might be written.
    if (netMode === "simulatedRoom") return J({ ...draftRec, simulated: true });
    if (netMode === "simulatedSettings") return J({ ...draftRec, state: { ...draftRec.state, settings: { ...draftRec.state.settings, simulated: true } } });
    return J(draftRec);
  }
  if (u.includes("datadawgs216.com/data/pool.json")) return J(poolJson);
  if (u.includes("datadawgs216.com/data/survivor.json")) return J(survJson);
  if (u.includes("datadawgs216.com/data/model-receipts.json")) return J(modelReceiptsJson);
  if (u.includes("datadawgs216.com/data/cfb-teams.json")) return J(cfbRatingsJson);
  if (u.includes("datadawgs216.com/data/cfb-record-divergence-validation.json")) return J(cfbDivergenceValidationJson);
  if (u.includes("datadawgs216.com/data/cfb-record-divergence.json")) return J(cfbDivergenceJson);
  if (u.includes("datadawgs216.com/data/cfb-disagreement.json")) return J(cfbDisagreementJson);
  if (u.includes("datadawgs216.com/data/cfb-model-receipts.json")) return J(cfbModelReceiptsJson);
  if (u.includes("datadawgs216.com/data/cfb-team-game.json")) return J(cfbTeamGameJson);
  if (u.includes("datadawgs216.com/data/cfb-games-latest.json")) return J(cfbGamesLatestJson);
  if (u.includes("datadawgs216.com/data/cfb-team-week-latest.json")) return J(cfbTeamWeekLatestJson);
  if (u.includes("datadawgs216.com/data/cfb-team-week.json")) return J(cfbTeamWeekJson);
  if (u.includes("datadawgs216.com/data/cfb-schedule.json")) return J(cfbScheduleJson);
  if (u.includes("datadawgs216.com/data/cfb-market.json")) return J(cfbMarketJson);
  if (u.includes("datadawgs216.com/data/cfb-model-cards.json")) return J(cfbModelCardsJson);
  if (u.includes("datadawgs216.com/dfs.html")) return new Response(dfsHtml, { status: 200 });
  if (u.includes("site.api.espn.com")) {
    if (netMode === "espnDown") return new Response("no", { status: 403 });
    return J(espnRaw);
  }
  throw new Error("TEST: unexpected fetch " + u);
};

/* -------------------------------- helpers -------------------------------- */
const PASS = "sekrit-league-pass";
/* ⚠️ A REAL PER-USER TOKEN. mcpAuth hashes the supplied token as hmac(BOZO_PEPPER,
   "mcp|" + token) and compares it against every /users row, so the fixture has to carry
   the genuine HMAC — faking the comparison would test nothing. */
const PEPPER = "test-pepper";
const USER_TOKEN = "u_thekid";
const hmacB64u = async (secret, msg) => {
  const te2 = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", te2.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te2.encode(msg));
  return Buffer.from(sig).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const USERS = {
  "Kap": { mcpToken: await hmacB64u(PEPPER, "mcp|u_kap") },
  "The%20Kid": { mcpToken: await hmacB64u(PEPPER, "mcp|" + USER_TOKEN) },
  "Outsider": { mcpToken: await hmacB64u(PEPPER, "mcp|u_outsider") },
  // ⚠️ A GREENFIELD UID-KEYED ACCOUNT, display name on the record. Before mcpAuth
  // resolved rec.name, this caller's `you:` markers and membership checks compared the
  // raw uid against name-keyed league rosters and always missed — a uid-keyed member's
  // own leg showed you:false on their own connector. These fixtures pin the fix.
  "u_jeffuid00000000000000001": { name: "Jeff", mcpToken: await hmacB64u(PEPPER, "mcp|u_jefftok") },
};
const env = { DAWG_PASS: PASS, BOZO_PEPPER: PEPPER, RL: { async get(k) { return k === "survivor:2026:1" ? JSON.stringify({ season: 2026, week: 1, stored: NOW - 3600e3, picks: { CLE: 40 } }) : null; } } };
const req = (body, { path = "/mcp/" + PASS, headers = {}, method = "POST" } = {}) =>
  worker.fetch(new Request("https://toto.jkapcar4.workers.dev" + path, {
    method, headers: { "Content-Type": "application/json", ...headers },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  }), env);
const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, params });
const call = (name, args, id = 1) => rpc("tools/call", { name, arguments: args || {} }, id);
const text = r => JSON.parse(r.result.content[0].text);

/* --------------------------------- tests ---------------------------------- */
// handshake: echo each known protocolVersion, fall back on unknown
for (const v of ["2025-03-26", "2025-06-18", "2026-07-28"]) {
  const j = await (await req(rpc("initialize", { protocolVersion: v }))).json();
  ok(j.result && j.result.protocolVersion === v, "initialize echoes " + v);
  ok(j.result.serverInfo.name === "data-dawgs", "serverInfo " + v);
}
{
  const j = await (await req(rpc("initialize", { protocolVersion: "1999-01-01" }))).json();
  ok(j.result.protocolVersion === "2025-06-18", "initialize falls back on unknown version");
  ok(/caller-supplied inputs/.test(j.result.instructions) && /not stored/.test(j.result.instructions),
     "initialize explains deterministic calculator provenance and non-persistence");
}
// notification: 202, EMPTY body
{
  const r = await req({ jsonrpc: "2.0", method: "notifications/initialized" });
  ok(r.status === 202, "notification returns 202");
  ok((await r.text()) === "", "notification body is EMPTY");
}
// batch: initialize + notification + ping → array of 2
{
  const r = await req([rpc("initialize", { protocolVersion: "2025-06-18" }, 1), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("ping", {}, 2)]);
  const j = await r.json();
  ok(Array.isArray(j) && j.length === 2, "batch skips notification, answers the rest");
  ok(j[0].id === 1 && j[1].id === 2, "batch preserves ids");
}
// auth failure paths
ok((await req(rpc("ping"), { path: "/mcp/wrong-pass" })).status === 401, "wrong passphrase in path → 401");
ok((await req(rpc("ping"), { path: "/mcp" })).status === 401, "no passphrase → 401");
{
  const r = await req(rpc("ping"), { path: "/mcp", headers: { "X-Dawg-Pass": PASS } });
  ok(r.status === 200, "X-Dawg-Pass header accepted");
  const r2 = await req(rpc("ping"), { path: "/mcp", headers: { Authorization: "Bearer " + PASS } });
  ok(r2.status === 200, "Authorization: Bearer accepted");
}
{
  const r = await worker.fetch(new Request("https://x/mcp/" + PASS, { method: "POST", body: "{}" }), {});
  ok(r.status === 500, "missing DAWG_PASS secret → 500");
}
// protocol failure paths
ok((await req("this is not json")).status === 400, "bad JSON → 400");
{
  const j = await (await req("this is not json")).json();
  ok(j.error && j.error.code === -32700, "bad JSON → -32700");
}
{
  const j = await (await req({ notRpc: true, id: 9 })).json();
  ok(j.error && j.error.code === -32600, "invalid request → -32600");
}
{
  const j = await (await req(rpc("resources/list"))).json();
  ok(j.error && j.error.code === -32601, "unknown method → -32601");
}
{
  const j = await (await req(call("dd_nonexistent"))).json();
  ok(j.error && j.error.code === -32602, "unknown tool → -32602");
}
// OPTIONS preflight and GET hint
ok((await req(null, { method: "OPTIONS" })).status === 200 || (await req(null, { method: "OPTIONS" })).status === 204, "OPTIONS answered");
{
  const r = await req(null, { method: "GET" });
  ok(r.status === 405, "GET → 405 with hint");
  ok((r.headers.get("Access-Control-Allow-Origin") || "") === "*", "/mcp carries its own permissive CORS");
}
// tools/list: every tool is named and schema-described
{
  const j = await (await req(rpc("tools/list"))).json();
  const t = j.result.tools;
  ok(t.length === N_TOOLS, `${N_TOOLS} tools listed in the staged Worker source`);
  ok(t.some(x => x.name === "dd_draft_bozo_leg" && /READ-ONLY/.test(x.description)),
     "dd_draft_bozo_leg is listed and says in its own description that it writes nothing");
  ok(t.every(x => /^(dd|sd)_/.test(x.name)), "all tools namespaced dd_ or sd_");
  ok(t.every(x => x.inputSchema && x.inputSchema.type === "object"), "all tools carry an inputSchema");
  for (const name of ["dd_convert_odds", "dd_devig_market", "dd_price_parlay", "dd_calculate_bet_ev",
    "dd_calculate_hedge", "dd_nfl_passer_rating", "dd_score_forecast", "dd_summarize_beliefs",
    "dd_elo_game", "dd_translate_probability", "dd_solve_dfs_lineup", "dd_model_scoreboard", "dd_get_cfb_rating_system", "dd_rank_cfb_teams", "dd_cfb_team_profile", "dd_compare_cfb_teams", "dd_project_cfb_matchup", "dd_project_cfb_schedule_path", "dd_find_cfb_record_divergence", "dd_get_cfb_model_disagreement", "dd_get_cfb_model_receipt_status", "dd_find_cfb_team_games", "dd_find_cfb_team_periods", "dd_find_cfb_games", "dd_find_cfb_historical_market", "dd_get_cfb_model_card", "dd_optimize_survivor_path"])
    ok(t.some(x => x.name === name), name + " is listed");
}

/* ---------------------- annotations and the two catalogs ----------------------
 * ⚠️ THE POINT OF `core` IS CONTEXT, AND IT ONLY PAYS IF IT IS A REAL BOUNDARY.
 * Forty-one schemas cost 10-25k tokens in every conversation that connects. If `core`
 * only filtered tools/list, a model that had seen a full-catalog name elsewhere could
 * still call it, so the small surface would be a suggestion rather than a surface. These
 * assertions pin both halves: what is listed, and what is callable.
 * ⚠️ The default path stays FULL. Changing it would silently remove tool names a live
 * connector may already be calling — the same breaking change as renaming one. */
{
  const listOn = async path => (await (await req(rpc("tools/list"), { path })).json()).result.tools;
  const full = await listOn("/mcp/" + PASS);
  const fullNamed = await listOn("/mcp/full/" + PASS);
  const core = await listOn("/mcp/core/" + PASS);

  ok(full.every(x => typeof x.title === "string" && x.title.length > 0), "every tool carries a display title");
  ok(full.every(x => x.annotations && x.annotations.title === x.title), "…mirrored into annotations.title, where MCP clients read it");
  // ⚠️ Was "every tool declares readOnlyHint:true". dd_submit_bozo_leg retired that
  // claim deliberately (2026-08-13): the wire now says exactly one tool writes, and which.
  // Allowlist, not a count: dd_submit_bozo_leg writes one Bozo leg, the sd_* writers each
  // write the caller's OWN training log. Anything else claiming a write fails here.
  ok(full.filter(x => x.annotations && x.annotations.readOnlyHint === false).map(x => x.name).sort().join("|")
       === WRITE_TOOLS.slice().sort().join("|"),
     "the tools that say they write on the wire are exactly the allowlisted ones");
  ok(full.find(x => x.name === "dd_submit_bozo_leg").annotations.destructiveHint === true,
     "the write tool declares destructiveHint:true — an edit overwrites the existing leg");
  ok(full.every(x => (x.annotations.readOnlyHint === true ? !("destructiveHint" in x.annotations) : true) &&
                     !("idempotentHint" in x.annotations) && !("openWorldHint" in x.annotations)),
     "the hints nobody verified are ABSENT, not guessed");
  ok(new Set(full.map(x => x.title)).size === full.length, "titles are unique — two tools with one title is a UI that lies");
  ok(full.every(x => !("catalog" in x)), "`catalog` is server-side bookkeeping and never reaches the wire");

  ok(fullNamed.length === full.length, "/mcp/full/<pass> lists the same set as the bare /mcp/<pass>");
  ok(full.length === N_TOOLS && core.length === N_CORE, `full lists ${N_TOOLS}, core lists ${N_CORE}`);
  const fullNames = new Set(full.map(x => x.name)), coreNames = new Set(core.map(x => x.name));
  ok([...coreNames].every(n => fullNames.has(n)), "core is a strict subset of full");
  ok(coreNames.has("dd_whoami") && coreNames.has("dd_bozo_week") && coreNames.has("dd_draft_board") && coreNames.has("dd_site_map"),
     "core keeps the league's own state and the site map");
  ok(!coreNames.has("dd_find_cfb_games") && !coreNames.has("dd_solve_dfs_lineup") && !coreNames.has("dd_model_scoreboard"),
     "core drops the CFB evidence surfaces, the DFS solver and the model scoreboard");

  // callable, not merely listed
  const okCall = await (await req(call("dd_convert_odds", { american_odds: -110 }), { path: "/mcp/core/" + PASS })).json();
  ok(okCall.result && !okCall.result.isError, "a core tool is callable on the core path");
  const blocked = await (await req(call("dd_find_cfb_games", { limit: 1 }), { path: "/mcp/core/" + PASS })).json();
  ok(blocked.error && blocked.error.code === -32602, "a full-only tool is NOT callable on core — it is an error, not a silent fallback");
  // ⚠️ read the message defensively: if the catalog stops being enforced there IS no error
  // object, and a crash here would hide which assertion actually broke.
  const msgOf = j => (j.error && j.error.message) || "";
  ok(/not in the `core` catalog/.test(msgOf(blocked)) && /\/mcp\/full\//.test(msgOf(blocked)),
     "…and the error says which catalog and where to get the tool");
  const missing = await (await req(call("dd_nonexistent"), { path: "/mcp/core/" + PASS })).json();
  ok(/Unknown tool/.test(msgOf(missing)), "a name that exists nowhere still reads as unknown, not as a catalog problem");
  const allowed = await (await req(call("dd_find_cfb_games", { limit: 1 }), { path: "/mcp/full/" + PASS })).json();
  ok(allowed.result && !allowed.result.isError, "…and the same call succeeds on full");

  // the catalog segment is stripped BEFORE the credential is read
  ok((await req(rpc("ping"), { path: "/mcp/core/wrong-pass" })).status === 401, "catalog prefix does not bypass auth");
  ok((await req(rpc("ping"), { path: "/mcp/core" })).status === 401, "a bare catalog word is a credential, and a wrong one → 401");
  {
    const r = await req(rpc("tools/list"), { path: "/mcp/core", headers: { "X-Dawg-Pass": PASS } });
    ok(r.status === 200 && (await r.json()).result.tools.length === N_CORE, "header auth can still pick a catalog");
  }

  /* ⚠️ THE RESERVED-WORD PASSPHRASE. A DAWG_PASS that IS "core" or "full" used to be
     unreachable: /mcp/core parsed as "catalog core, no credential", and no URL was left that
     could carry it. It was defended with a comment telling a human not to do it — which fails
     silently, at deploy time, and locks out the whole league rather than one member. The route
     now only treats a leading catalog word as a catalog when something follows it (or when the
     credential came in a header), so no passphrase can be stranded whatever it happens to be.
     These run against their OWN env, because the collision only exists when the secret equals
     the reserved word. */
  for (const word of ["core", "full"]) {
    const envWord = { ...env, DAWG_PASS: word };
    const reqWord = (body, path) => worker.fetch(
      new Request("https://toto.jkapcar4.workers.dev" + path, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }), envWord);
    const r = await reqWord(rpc("tools/list"), "/mcp/" + word);
    ok(r.status === 200, `a passphrase of "${word}" still authenticates at /mcp/${word}`, "status " + r.status);
    if (r.status === 200) {
      const n = (await r.json()).result.tools.length;
      ok(n === N_TOOLS, `…and gets the default full catalog, not an empty or partial one`, "tools=" + n);
    }
    // it must still be a real credential check, not a hole that lets the word through
    const bad = await reqWord(rpc("ping"), "/mcp/" + (word === "core" ? "full" : "core"));
    ok(bad.status === 401, `…while the OTHER reserved word is still rejected as a wrong credential`);
  }
  // per-user tokens route the same way
  {
    const j = await (await req(rpc("tools/list"), { path: "/mcp/core/" + USER_TOKEN })).json();
    ok(j.result.tools.length === N_CORE, "a per-user token gets the same catalog treatment");
  }
  // initialize says which catalog you are on
  for (const [path, needle] of [["/mcp/core/" + PASS, "Catalog `core`"], ["/mcp/" + PASS, "Catalog `full`"]]) {
    const j = await (await req(rpc("initialize", { protocolVersion: "2025-06-18" }), { path })).json();
    ok(j.result.instructions.startsWith(needle), "initialize opens by naming the catalog: " + needle);
    ok(new RegExp(`${N_CORE} of ${N_TOOLS}|${N_TOOLS} of ${N_TOOLS}`).test(j.result.instructions), "…with the honest count for that path");
  }
  {
    const r = await req(null, { path: "/mcp/" + PASS, method: "GET" });
    const j = await r.json();
    ok(j.catalogs && /\/mcp\/core\//.test(j.catalogs.core) && /\/mcp\/full\//.test(j.catalogs.full),
       "the GET hint advertises both catalog paths");
  }
}
// the registry itself: annotations are complete in the SOURCE, not just in one response
{
  const src = readFileSync(resolve(WORK, "mcp-block.js"), "utf8");
  const reg = src.slice(src.indexOf("const MCP_TOOLS = ["));
  const n = (re) => (reg.match(re) || []).length;
  const tools = n(/\n    name: "(?:dd|sd)_\w+",\n/g);
  ok(tools === N_TOOLS, `${N_TOOLS} tools declared in work/mcp-block.js`);
  ok(n(/\n    title: "[^"]+",\n/g) === tools, "every declared tool carries a title");
  ok(n(/\n    catalog: "(?:core|full)",\n/g) === tools, "every declared tool carries a core/full catalog tag");
  ok(n(/\n    readOnlyHint: (?:true|false),\n/g) === tools, "every declared tool carries a readOnlyHint");
  // ⚠️ This asserted ZERO readOnlyHint:false while the block was fully read-only, then
  // exactly one when dd_submit_bozo_leg landed (2026-08-13, cep-identity §4). SwoleDawg
  // (2026-08-18) made it a NAMED SET rather than a number — the invariant was never the
  // count, it was that no tool acquires a write quietly.
  ok(n(/readOnlyHint: false/g) === WRITE_TOOLS.length,
     `exactly ${WRITE_TOOLS.length} tools claim readOnlyHint:false in the source`);
  for (const name of WRITE_TOOLS) {
    const at = reg.indexOf(`name: "${name}"`);
    ok(at >= 0 && /readOnlyHint: false/.test(reg.slice(at, at + 700)),
       `…including ${name}, which declares it`);
  }
  const wtool = reg.slice(reg.indexOf('name: "dd_submit_bozo_leg"'));
  ok(/destructiveHint: true/.test(wtool.slice(0, 400)),
     "the write tool declares destructiveHint — an edit overwrites the caller's existing leg");
  ok(n(/\n    catalog: "core",\n/g) === N_CORE, `${N_CORE} tools are tagged core in the source`);
}
// dd_league_overview
{
  const j = await (await req(call("dd_league_overview"))).json();
  const d = text(j);
  ok(d.name === "Data Dawgs" && d.season === 2026, "league overview basics");
  ok(d.members.includes("The Kid"), "member names are DECODED (The%20Kid → The Kid)");
  ok(d.legsIn === 2, "legsIn counts current picks");
}
// dd_bozo_week: submission order + caveats
{
  const j = await (await req(call("dd_bozo_week"))).json();
  const d = text(j);
  ok(d.legs.length === 2, "bozo week returns both legs");
  ok(d.legs[0].player === "Jeff" && d.legs[1].player === "Kap", "legs in SUBMISSION ORDER (ts), not key order");
  ok(Array.isArray(d.caveats) && d.caveats.some(c => c.includes("CLV")), "caveats ship in the payload, incl. never-state-CLV");
  ok(d.legs[0].priceSource === "self", "priceSource label survives");
}
// dd_bozo_standings on an empty ledger: an answer, not a crash
{
  const j = await (await req(call("dd_bozo_standings"))).json();
  ok(!j.result.isError && text(j).note.includes("empty"), "empty ledger is an answer");
}
// dd_draft_board: maxBid math
{
  const j = await (await req(call("dd_draft_board"))).json();
  const d = text(j);
  const a = d.teams.find(t => t.name === "Team A"), b = d.teams.find(t => t.name === "Team B");
  ok(a.spent === 73 && a.left === 127 && a.openSpots === 14, "team A spent/left/open");
  ok(a.maxBid === a.left, "maxBid equals dollars remaining when $0 bids are legal");
  ok(b.left === 200 && b.openSpots === 15 && b.maxBid === 200, "untouched team reports left 200, 15 open spots, and maxBid 200");
  ok(d.onTheClock === "Team B" && d.onBlock === "Bijan Robinson", "clock + block");
}
// dd_draft_board: C6 — a test pick must never read as a completed sale
{
  const j = await (await req(call("dd_draft_board"))).json();
  const d = text(j);
  ok(d.simulated === false, "unflagged room: simulated is present and false, never absent");
  ok(d.note === undefined, "…and carries no warning it would have to walk back");
}
{
  netMode = "simulatedRoom";
  const j = await (await req(call("dd_draft_board"))).json();
  const d = text(j);
  ok(d.simulated === true, "top-level flag → simulated true");
  ok(typeof d.note === "string" && /NOT completed sales/.test(d.note),
     "…and the payload says so in WORDS — a bare boolean is ignorable, prose is not");
  ok(d.recentSales.length === 1 && d.teams.length === 2,
     "…while still returning the picks: the room stays usable for league testing (backlog C5)");
  netMode = "normal";
}
{
  netMode = "simulatedSettings";
  const j = await (await req(call("dd_draft_board"))).json();
  ok(text(j).simulated === true, "settings-level flag also counts (draft app may rewrite state)");
  netMode = "normal";
}
// dd_draft_board: empty room is a tool error, not a protocol error
{
  netMode = "emptyRoom";
  const j = await (await req(call("dd_draft_board"))).json();
  ok(j.result && j.result.isError === true, "empty draft room → isError RESULT");
  ok(j.result.content[0].text.includes("empty"), "…that says the room is empty");
  netMode = "normal";
}
// database failure → isError result, turn survives
{
  netMode = "dbdown";
  const j = await (await req(call("dd_bozo_week"))).json();
  ok(j.result && j.result.isError === true && /unreachable|refused/i.test(j.result.content[0].text), "DB down → isError result");
  netMode = "normal";
}
// dd_draft_pool: envelope + filter + limit
{
  const j = await (await req(call("dd_draft_pool", { pos: "RB", limit: 5 }))).json();
  const d = text(j);
  ok(d.as_of === "2026-07-29", "pool carries as_of");
  ok(d.players.length === 1 && d.players[0].pos === "RB", "pos filter works");
  ok(/NOT a points projection/i.test(d.note) || d.note.length > 0, "staleness note survives");
}
// dd_survivor_week
{
  const j = await (await req(call("dd_survivor_week", { week: 1 }))).json();
  const d = text(j);
  ok(d.picks && d.picks.CLE === 40, "survivor picks returned");
  ok(d.stale === false && typeof d.ageHours === "number", "age computed, not stale at 1h");
  const j2 = await (await req(call("dd_survivor_week", { week: 9 }))).json();
  ok(j2.result.isError === true, "missing survivor week → isError");
  const j3 = await (await req(call("dd_survivor_week", { week: 99 }))).json();
  ok(j3.result.isError === true, "week 99 rejected");
}
// dd_survivor_ev: a PORT of survivor.html's leverage(), and the parity is enforced —
// the reference below is transcribed from the page, not from the block. If the two
// drift, the MCP answer and the board silently disagree, which is the actual failure.
function refLeverage(week, pop, games, entries, used) {
  const tab = {};
  games.filter((g) => g.wk === week).forEach((g) => { tab[g.h] = { opp: g.a, p: g.p }; tab[g.a] = { opp: g.h, p: 1 - g.p }; });
  const E = Math.max(1, entries - 1);
  const seen = {}, gs = [];
  for (const t in tab) {
    if (seen[t]) continue;
    const g = tab[t]; seen[t] = 1; seen[g.opp] = 1;
    const ph = g.p, ah = pop[t] || 0, aa = pop[g.opp] || 0;
    gs.push({ h: t, a: g.opp, mean: aa + (ah - aa) * ph, varc: (ah - aa) * (ah - aa) * ph * (1 - ph) });
  }
  return Object.keys(tab).filter((t) => !used.has(t)).map((t) => {
    const own = pop[t] || 0; let mu = 0, v2 = 0;
    for (const g of gs) { if (g.h === t || g.a === t) { mu += own; continue; } mu += g.mean; v2 += g.varc; }
    const mean = E * mu, varS = E * E * v2, d = 1 + mean;
    return { team: t, equity: tab[t].p * (1 / d + varS / (d * d * d)) };
  });
}
{
  // week 2 has no posted snapshot → ownership is MODELLED and must say so in words
  const j = await (await req(call("dd_survivor_ev", { week: 2, entries: 200 }))).json();
  const d = text(j);
  ok(d.ownership === "modelled", "no snapshot → ownership modelled");
  ok(typeof d.note === "string" && /MODELLED/.test(d.note), "…and the payload says so in WORDS, not a flag");
  ok(typeof d.model === "string" && /independent/.test(d.model) && /Taylor/.test(d.model),
     "the model names itself: independence assumption + Taylor correction (invariant 6)");
  ok(d.rows.length === 4 && d.rows[0].evIndex === 1 && d.rows[0].rank === 1, "4 candidates, leader indexed 1.0");
  ok(d.rows.every((r, i) => !i || d.rows[i - 1].equity >= r.equity), "sorted by equity, best first");
  const CHALK = 2.4, tabP = { SEA: 0.7, PIT: 0.3, CLE: 0.6, ARI: 0.4 };
  const pop = {}; let tot = 0;
  for (const t in tabP) { pop[t] = Math.pow(Math.max(tabP[t], 0.01), CHALK); tot += pop[t]; }
  for (const t in pop) pop[t] /= tot;
  const ref = refLeverage(2, pop, survJson.data.games, 200, new Set());
  ok(ref.every((r) => Math.abs((d.rows.find((x) => x.team === r.team) || {}).equity - r.equity) < 1e-5),
     "equity matches survivor.html's leverage() transcribed independently — a port, not a cousin");
}
{
  // week 1 HAS a posted snapshot ({CLE:40}) → renormalised over the teams playing
  const j = await (await req(call("dd_survivor_ev", { week: 1 }))).json();
  const d = text(j);
  ok(d.ownership === "posted" && d.stale === false, "stored snapshot → posted, hour-old is not stale");
  const cle = d.rows.find((r) => r.team === "CLE"), sea = d.rows.find((r) => r.team === "SEA");
  ok(cle && cle.pop === 1, "posted picks renormalise over teams actually playing (CLE 40 → 100%)");
  ok(sea.survivorsIfWin < cle.survivorsIfWin,
     "joining the chalk keeps the whole field alive with you; fading it does not");
}
{
  // every playing team spent → a tool error, case-insensitively
  const j = await (await req(call("dd_survivor_ev", { week: 1, used: ["sea", "PIT", "CLE", "ari"] }))).json();
  ok(j.result.isError === true && /used list/.test(j.result.content[0].text), "all teams used → tool error, used list is case-insensitive");
  const j2 = await (await req(call("dd_survivor_ev", { week: 7 }))).json();
  ok(j2.result.isError === true, "week with no games in the snapshot → tool error");
}
// dd_optimize_survivor_path: the Worker calls the exact shared browser engine.
{
  const j = await (await req(call("dd_optimize_survivor_path", { from_week: 1 }))).json();
  const d = text(j);
  const teams = Object.keys(survJson.data.elo);
  const direct = DDSurvivorPath.solvePath({
    weeks: Array.from({ length: 18 }, (_, i) => i + 1), teams,
    probabilities: teams.map(team => Array.from({ length: 18 }, (_, i) => {
      const week = i + 1, g = survJson.data.games.find(game => game.wk === week && (game.h === team || game.a === team));
      return !g ? null : (g.h === team ? g.p : 1 - g.p);
    })),
  });
  ok(!j.result.isError && d.covered_weeks === 2 && d.complete === false && Math.abs(d.run_the_table_probability - 0.48) < 1e-12,
     "survivor path returns the exact 0.48 fixture ceiling and exposes missing weeks");
  ok(d.path.map(x => x.week + ":" + x.team).join(",") === direct.assignments.map(x => x.week + ":" + x.team).join(","),
     "survivor MCP selections exactly match direct browser-engine output");
  const sea = d.current_week_options.find(x => x.team === "SEA");
  ok(sea.selected && Math.abs(sea.future_path_probability - 0.6) < 1e-12 &&
       Math.abs(sea.future_cost - (1 - 0.6 / 0.7)) < 1e-12 && Math.abs(sea.combined_path_probability - 0.48) < 1e-12,
     "current-week option reports exact future cost and combined path probability");
  ok(d.access === "read-only" && d.stored === false && d.modelled === true && d.graded === false &&
       d.warnings.some(w => /CEILING, NOT A PLAN/.test(w)),
     "survivor path makes read-only, ungraded and ceiling limits explicit");
}
{
  const used = text(await (await req(call("dd_optimize_survivor_path", { from_week: 1, used_teams: ["sea"] }))).json());
  ok(Math.abs(used.run_the_table_probability - 0.33) < 1e-12 && used.path.some(x => x.week === 1 && x.team === "PIT"),
     "used team is case-insensitive and leaves the 0.33 PIT/CLE path");
  const reused = text(await (await req(call("dd_optimize_survivor_path", { from_week: 1, reuse_teams: true }))).json());
  ok(Math.abs(reused.run_the_table_probability - 0.56) < 1e-12 && reused.path.filter(x => x.team === "SEA").length === 2,
     "reuse mode truly permits SEA in both fixture weeks");
  /* ⚠️ This block used to assert the OPPOSITE — that the tool refused to model double
     picks and said so in a warning. That warning was true until Stage B and is now
     false, so the assertion is REPLACED by one pinning the new behaviour rather than
     deleted. Both numbers below are hand-computed from the fixture, not captured.

     Fixture: wk1 SEA .8 / ARI .2, PIT .55 / CLE .45; wk2 SEA .7 / PIT .3, CLE .6 / ARI .4.
     ⚠️ It also declares 18 weeks of which only two have games, so requested_picks and
     requested_weeks count the whole horizon and `complete` is false for reasons that
     predate slots. The Stage B quantities are covered_picks and covered_weeks. */

  // --- week 2 doubled: one slot in wk1, two in wk2, four teams, no reuse.
  //   w1=SEA .8  -> wk2 best pair CLE .6 x ARI .4 = .24  -> .192
  //   w1=PIT .55 -> wk2 best pair SEA .7 x CLE .6 = .42  -> .231   <- max
  //   w1=CLE .45 -> .7 x .4 = .28                        -> .126
  //   w1=ARI .2  -> .7 x .6 = .42                        -> .084
  const doubled = text(await (await req(call("dd_optimize_survivor_path", { double_pick_weeks: [2] }))).json());
  ok(Math.abs(doubled.run_the_table_probability - 0.231) < 1e-12,
     "double-pick week 2 solves to the hand-computed 0.231 optimum", String(doubled.run_the_table_probability));
  const wk2 = doubled.path.filter(x => x.week === 2);
  ok(wk2.length === 2 && new Set(wk2.map(x => x.team)).size === 2,
     "week 2 spends two DISTINCT teams", wk2.map(x => x.team).join(","));
  ok(doubled.covered_picks === 3 && doubled.covered_weeks === 2,
     "covered_picks counts slots while covered_weeks still counts weeks",
     `${doubled.covered_picks} picks / ${doubled.covered_weeks} weeks`);
  ok(doubled.requested_picks === doubled.requested_weeks + 1,
     "one double week asks for exactly one extra pick over the horizon",
     `${doubled.requested_picks} vs ${doubled.requested_weeks}`);
  ok(doubled.rules_fully_modelled === true &&
       doubled.warnings.some(w => /Double-pick weeks are modelled exactly/.test(w)) &&
       !doubled.warnings.some(w => /NOT MODELLED/.test(w)),
     "the tool now claims double picks ARE modelled, and the old warning is gone");
  ok(JSON.stringify(doubled.double_pick_weeks) === JSON.stringify([2]),
     "the payload names which weeks it treated as double", JSON.stringify(doubled.double_pick_weeks));

  // --- BOTH weeks doubled: four slots, four teams, every team spent exactly once.
  //   {SEA,PIT} wk1 = .44 x {ARI,CLE} wk2 = .24 -> .1056   <- max
  //   {SEA,CLE} = .36 x {ARI,PIT} = .12         -> .0432
  //   {SEA,ARI} = .16 x {PIT,CLE} = .18         -> .0288
  //   {PIT,CLE} = .2475 x {SEA,ARI} = .28       -> .0693
  //   {PIT,ARI} = .11 x {SEA,CLE} = .42         -> .0462
  //   {CLE,ARI} = .09 x {SEA,PIT} = .21         -> .0189
  const both = text(await (await req(call("dd_optimize_survivor_path", { double_pick_weeks: [1, 2] }))).json());
  ok(Math.abs(both.run_the_table_probability - 0.1056) < 1e-12,
     "two double weeks solve to the hand-computed 0.1056 optimum", String(both.run_the_table_probability));
  ok(both.covered_picks === 4 && new Set(both.path.map(x => x.team)).size === 4,
     "four slots spend four distinct teams", `${both.covered_picks} picks`);

  // --- the suffix rule and the explicit list are the same thing, and they union
  const suffix = text(await (await req(call("dd_optimize_survivor_path", { double_pick_from: 2 }))).json());
  ok(Math.abs(suffix.run_the_table_probability - 0.231) < 1e-12,
     "double_pick_from: 2 matches the equivalent explicit list — empty weeks cost nothing",
     String(suffix.run_the_table_probability));
  ok(suffix.double_pick_weeks.length === 17 && suffix.double_pick_weeks[0] === 2,
     "a suffix rule expands to every week from there to 18", JSON.stringify(suffix.double_pick_weeks));
  const union = text(await (await req(call("dd_optimize_survivor_path", { double_pick_from: 18, double_pick_weeks: [1] }))).json());
  ok(JSON.stringify(union.double_pick_weeks) === JSON.stringify([1, 18]),
     "a suffix and a list given together are unioned", JSON.stringify(union.double_pick_weeks));

  const badList = await (await req(call("dd_optimize_survivor_path", { double_pick_weeks: [0] }))).json();
  ok(/whole numbers from 1 to 18/.test(JSON.stringify(badList)),
     "an out-of-range double-pick week is rejected", JSON.stringify(badList).slice(0, 140));
}
{
  const badTeam = await (await req(call("dd_optimize_survivor_path", { used_teams: ["XXX"] }))).json();
  const badWeek = await (await req(call("dd_optimize_survivor_path", { from_week: 0 }))).json();
  const badExtra = await (await req(call("dd_optimize_survivor_path", { confidence: true }))).json();
  ok(badTeam.result.isError === true && badWeek.result.isError === true && badExtra.result.isError === true,
     "survivor path rejects unknown teams, invalid weeks and unsupported inputs");
}
// dd_analyze_matchup: the formula is public in models.json — recompute it here with a
// DIFFERENT Φ approximation (Press erfc, not the page's Abramowitz–Stegun) so agreement
// means the maths is right, not that the same bug is pasted twice.
function refNcdf(z) {
  const x = z / Math.SQRT2, ax = Math.abs(x), t = 1 / (1 + 0.5 * ax);
  const e = t * Math.exp(-ax * ax - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  const erfc = x >= 0 ? e : 2 - e;
  return 1 - erfc / 2;
}
{
  const j = await (await req(call("dd_analyze_matchup", { home: "SEA", away: "cardinals" }))).json();
  const d = text(j);
  ok(d.home.team === "SEA" && d.away.team === "ARI", "abbreviation and nickname both resolve");
  const margin = (1620 - 1420) / 23.58 + 2.1;
  ok(Math.abs(d.expectedMarginAtHome - Math.round(margin * 100) / 100) < 1e-9, "margin follows the published formula");
  ok(Math.abs(d.pHomeWin - refNcdf(margin / 13.18)) < 2e-4, "win prob is Φ(margin/SD), checked against an independent CDF");
  ok(Array.isArray(d.scheduledMeetings2026) && d.scheduledMeetings2026[0].week === 1 && d.scheduledMeetings2026[0].pHomeWin === 0.8,
     "the week-1 meeting is listed with the board's blended number");
  ok(/Elo-only/.test(d.model) && /0d3f8418/.test(d.model), "model names itself AND its snapshot (invariant 6)");
}
{
  const j = await (await req(call("dd_analyze_matchup", { home: "the 1972 dolphins", away: "SEA" }))).json();
  ok(j.result.isError === true, "unknown team → tool error");
  const j2 = await (await req(call("dd_analyze_matchup", { home: "browns", away: "Cleveland" }))).json();
  ok(j2.result.isError === true, "same team by two names → tool error");
}
// Pound calculators: pure MCP results must stay in parity with work/pound-core.js.
{
  const args = { home_elo: 1500, away_elo: 1500, home_field_elo: 65 };
  const j = await (await req(call("dd_elo_game", args))).json();
  const d = text(j), ref = P.eloGame(args.home_elo, args.away_elo, args.home_field_elo);
  ok(Math.abs(d.home_win_probability - ref.home_win_probability) < 1e-12 &&
     Math.abs(d.adjusted_elo_difference - ref.adjusted_elo_difference) < 1e-12,
     "Elo game probability matches Pound core");
  ok(d.read_only === true && /calculator only/i.test(d.note) && /538-classic\.json/.test(d.note) && /model-receipts\.json/.test(d.note),
     "Elo result separates calculator output from published states and receipts");
  const wrongType = await (await req(call("dd_elo_game", { ...args, home_elo: "1500" }))).json();
  ok(wrongType.result.isError === true, "Elo numeric strings fail closed");
}
{
  const args = { home_win_probability: 0.6, residual_sd_points: 13.18, home_line: -3 };
  const j = await (await req(call("dd_translate_probability", args))).json();
  const d = text(j), ref = P.normalTranslation(args.home_win_probability, args.residual_sd_points, args.home_line);
  ok(Math.abs(d.expected_margin_home - ref.expected_margin_home) < 1e-12 &&
     Math.abs(d.home_cover_probability - ref.home_cover_probability) < 1e-12,
     "probability translation matches Pound core");
  ok(d.modelled === true && d.read_only === true && d.push_probability === 0 &&
     /key-number mass/.test(d.note), "translation exposes modelled, continuous and zero-push assumptions");
  const marginOnly = text(await (await req(call("dd_translate_probability",
    { home_win_probability: 0.5, residual_sd_points: 13.18 }))).json());
  ok(Math.abs(marginOnly.expected_margin_home - 0.5) < 1e-12 && marginOnly.home_cover_probability === undefined,
     "translation supports margin-only calls without inventing a line");
  const zero = await (await req(call("dd_translate_probability",
    { home_win_probability: 0, residual_sd_points: 13.18 }))).json();
  const badSd = await (await req(call("dd_translate_probability",
    { home_win_probability: 0.6, residual_sd_points: 0 }))).json();
  ok(zero.result.isError === true && badSd.result.isError === true,
     "translation rejects boundary probabilities and non-positive residual SD");
}
{
  const j = await (await req(call("dd_convert_odds", { american_odds: -110 }))).json();
  const d = text(j), ref = P.oddsConverter(-110);
  ok(Math.abs(d.decimal_odds - ref.decimal) < 1e-12, "odds decimal matches Pound core");
  ok(Math.abs(d.implied_probability - ref.implied_probability) < 1e-12, "odds implied probability matches Pound core");
  ok(d.read_only === true && /user-supplied/i.test(d.note), "odds result labels provenance and read-only behavior");
  const bad = await (await req(call("dd_convert_odds", { american_odds: -50 }))).json();
  ok(bad.result.isError === true, "invalid American odds fail closed");
  const wrongType = await (await req(call("dd_convert_odds", { american_odds: "-110" }))).json();
  ok(wrongType.result.isError === true, "numeric strings are rejected against the MCP number schema");
}
{
  const j = await (await req(call("dd_devig_market", { side_a_american: -110, side_b_american: -110 }))).json();
  const d = text(j), ref = P.holdVig(-110, -110);
  ok(Math.abs(d.hold - ref.hold) < 1e-12, "market hold matches Pound core");
  ok(d.devig_probability.every((x, i) => Math.abs(x - ref.devig_probability[i]) < 1e-12), "proportional devig matches Pound core");
  ok(d.devig_method === "proportional normalization", "devig method is explicit");
}
{
  const prices = [-110, 150];
  const j = await (await req(call("dd_price_parlay", { american_odds: prices }))).json();
  const d = text(j), ref = P.parlay(prices);
  ok(Math.abs(d.decimal_odds - ref.decimal) < 1e-12 && Math.abs(d.american_odds - ref.american) < 1e-12,
     "parlay price matches Pound core");
  ok(/correlation/.test(d.note), "parlay discloses that price multiplication is not a correlation model");
  const empty = await (await req(call("dd_price_parlay", { american_odds: [] }))).json();
  ok(empty.result.isError === true, "empty parlay fails closed");
  const tooMany = await (await req(call("dd_price_parlay", { american_odds: new Array(21).fill(-110) }))).json();
  ok(tooMany.result.isError === true, "parlay call is bounded at 20 legs");
}
{
  const price = -110, p = P.impliedFromAmerican(price);
  const j = await (await req(call("dd_calculate_bet_ev", { win_probability: p, american_odds: price }))).json();
  const d = text(j), ref = P.betEV(p, price);
  ok(Math.abs(d.roi - ref.roi) < 1e-12 && Math.abs(d.break_even_probability - ref.break_even_probability) < 1e-12,
     "bet EV matches Pound core at break-even");
  ok(/caller-supplied/.test(d.note) && /not an independently graded edge/i.test(d.note), "EV result refuses an edge claim");
  const bad = await (await req(call("dd_calculate_bet_ev", { win_probability: 1.1, american_odds: -110 }))).json();
  ok(bad.result.isError === true, "EV probability outside [0,1] fails closed");
}
{
  const j = await (await req(call("dd_calculate_hedge", { original_stake: 100, original_american: 200, hedge_american: -150 }))).json();
  const d = text(j), ref = P.hedge(100, 200, -150);
  ok(Math.abs(d.hedge_stake - ref.hedge_stake) < 1e-12 && Math.abs(d.locked_profit - ref.locked_profit) < 1e-12,
     "hedge sizing matches Pound core");
  ok(/no bet is placed/.test(d.note), "hedge tool states that it takes no action");
  const bad = await (await req(call("dd_calculate_hedge", { original_stake: 0, original_american: 200, hedge_american: -150 }))).json();
  ok(bad.result.isError === true, "non-positive hedge stake fails closed");
}
{
  const args = { attempts: 20, completions: 20, yards: 400, touchdowns: 4, interceptions: 0 };
  const j = await (await req(call("dd_nfl_passer_rating", args))).json();
  const d = text(j), ref = P.passerRating(20, 20, 400, 4, 0);
  ok(Math.abs(d.nfl_passer_rating - ref.rating) < 1e-12 && Math.abs(d.nfl_passer_rating - 158.33333333333334) < 1e-12,
     "perfect passer rating matches Pound core");
  const neg = text(await (await req(call("dd_nfl_passer_rating", { attempts: 1, completions: 0, yards: -5, touchdowns: 0, interceptions: 0 }))).json());
  ok(Math.abs(neg.nfl_passer_rating - P.passerRating(1, 0, -5, 0, 0).rating) < 1e-12, "legitimate negative passing yards remain valid");
  const fractional = await (await req(call("dd_nfl_passer_rating", { attempts: 1.5, completions: 1, yards: 10, touchdowns: 0, interceptions: 0 }))).json();
  ok(fractional.result.isError === true, "fractional passing statistics fail closed");
}
{
  const j = await (await req(call("dd_score_forecast", { forecast_probability: 0.7, outcome_0_or_1: 1 }))).json();
  const d = text(j), ref = P.forecastGrade(0.7, 1);
  ok(Math.abs(d.brier - ref.brier) < 1e-12 && Math.abs(d.log_loss - ref.log_loss) < 1e-12,
     "forecast grade matches Pound core");
  ok(d.sample_size === 1 && d.graded_track_record === false, "single-row grade cannot masquerade as a track record");
  const bad = await (await req(call("dd_score_forecast", { forecast_probability: 0.7, outcome_0_or_1: 2 }))).json();
  ok(bad.result.isError === true, "non-binary outcome fails closed");
}
{
  const xs = [0.4, 0.6, 0.7];
  const j = await (await req(call("dd_summarize_beliefs", { probabilities: xs }))).json();
  const d = text(j), ref = P.beliefSummary(xs);
  ok(Math.abs(d.mean - ref.mean) < 1e-12 && Math.abs(d.standard_deviation - ref.standard_deviation) < 1e-12,
     "belief summary matches Pound core");
  ok(d.crosses_50 === true && /not a validated consensus blend/i.test(d.note), "belief summary carries the no-consensus claim");
  const empty = await (await req(call("dd_summarize_beliefs", { probabilities: [] }))).json();
  ok(empty.result.isError === true, "empty belief list fails closed");
}
// dd_model_scoreboard: bounded receipt query, latest-per-model selection and exact
// parity with the human board's descriptive statistics.
{
  const j = await (await req(call("dd_model_scoreboard"))).json();
  const d = text(j), cle = d.games[0], ref = P.beliefSummary([0.45, 0.65]);
  ok(!j.result.isError && d.games.length === 2 && d.filters.season === 2026 && d.filters.week === 1,
     "model scoreboard defaults to the latest season's Week 1 board");
  ok(cle.game_id === "2026_01_CLE_PIT" && cle.models.some(m => m.forecast_id === "nfelo-cle-new") && !cle.models.some(m => m.forecast_id === "nfelo-cle-old"),
     "model scoreboard sorts by disagreement and selects the latest receipt per game/model");
  ok(Math.abs(cle.descriptive_summary.mean - ref.mean) < 1e-12 && Math.abs(cle.descriptive_summary.standard_deviation - ref.standard_deviation) < 1e-12 && cle.descriptive_summary.crosses_50,
     "model scoreboard descriptive summary matches Pound core exactly");
  ok(d.read_only === true && d.stored === false && d.graded === false && d.comparison_type.includes("descriptive") && d.warnings.some(x => /not a validated consensus/i.test(x)),
     "model scoreboard makes read-only, ungraded and no-consensus limits explicit");
  ok(d.ledger_integrity.rows === 7 && cle.models.every(m => m.source_commit && m.input_snapshot_id && m.schedule_snapshot_id),
     "model scoreboard preserves ledger integrity and per-model provenance");
}
{
  const team = text(await (await req(call("dd_model_scoreboard", { team: "pit", sort: "kickoff", limit: 1 }))).json());
  ok(team.matched_games === 2 && team.returned_games === 1 && team.games[0].game_id === "2026_01_CLE_PIT",
     "model scoreboard team filter is case-insensitive and limit bounds output");
  const game = text(await (await req(call("dd_model_scoreboard", { game_id: "2026_02_PIT_SEA", model_ids: ["nfelo"] }))).json());
  ok(game.games.length === 1 && game.games[0].models.length === 1 && game.games[0].complete_comparable_set === true,
     "model scoreboard supports exact game and requested-model filters");
  const none = text(await (await req(call("dd_model_scoreboard", { season: 2099 }))).json());
  ok(none.games.length === 0 && none.note.includes("No prospective"), "model scoreboard returns a structured empty result");
  const badWeek = await (await req(call("dd_model_scoreboard", { week: 0 }))).json();
  const badExtra = await (await req(call("dd_model_scoreboard", { confidence: true }))).json();
  const badTeam = await (await req(call("dd_model_scoreboard", { team: "C!" }))).json();
  ok(badWeek.result.isError === true && badExtra.result.isError === true && badTeam.result.isError === true,
     "model scoreboard rejects invalid and unsupported filters");
}
// dd_get_cfb_rating_system: compact method discovery or one exact full system
// contract, without treating registry membership as evidence of skill.
{
  const j = await (await req(call("dd_get_cfb_rating_system"))).json();
  const d = text(j);
  ok(!j.result.isError && d.mode === "rating-system-index" && d.system === null &&
     d.registered_system_count === 1 && d.available_systems[0].system_id === "dd-cfb-elo" &&
     d.available_systems[0].available_outputs.join(",") === "team_strength",
     "CFB rating-system reader lists compact registered method and output summaries");
  ok(d.consensus_built === false && d.prospective_forecasts_exist === false && d.graded === false &&
     d.current_2026_method === false && d.read_only && d.stored === false &&
     d.warnings.some(x => /Registry membership documents source/i.test(x)),
     "CFB rating-system index refuses consensus, prospective, graded and current-method claims");
}
{
  const j = await (await req(call("dd_get_cfb_rating_system", { system_id: "DD-CFB-ELO" }))).json();
  const d = text(j);
  ok(!j.result.isError && d.mode === "rating-system" && d.system.system_id === "dd-cfb-elo" &&
     d.system.source_snapshot_id === "sha256:test-cfb-elo" && d.system.outputs.expected_margin.available === false,
     "CFB rating-system reader returns one exact full source and output contract");
  ok(d.system.matchup_probability.elo_scale === 400 && d.system.matchup_probability.home_field_elo === 55 &&
     d.rating_period.prospective === false && d.consensus.status === "not-built",
     "CFB rating-system reader preserves the published matchup transform and registry boundaries");
  const missing = await (await req(call("dd_get_cfb_rating_system", { system_id: "mystery" }))).json();
  const invalid = await (await req(call("dd_get_cfb_rating_system", { system_id: "bad system" }))).json();
  const extra = await (await req(call("dd_get_cfb_rating_system", { include_rankings: true }))).json();
  ok([missing, invalid, extra].every(result => result.result.isError === true),
     "CFB rating-system reader fails closed on unknown, invalid and unsupported inputs");
}
// dd_rank_cfb_teams: bounded ranking and conference slices over one declared
// rating system, without presenting the result as consensus or current-season.
{
  const j = await (await req(call("dd_rank_cfb_teams"))).json();
  const d = text(j);
  ok(!j.result.isError && d.system.system_id === "dd-cfb-elo" && d.teams.length === 3 &&
     d.teams.map(x => x.rating.rank).join(",") === "1,2,133",
     "CFB ranking defaults safely when the registry has exactly one system and sorts by rank");
  ok(d.teams[0].team === "Indiana" && d.teams[0].observed_results.record === "16-0-0" &&
     d.observed_results_are_facts === true && d.modelled_fields.includes("teams[].rating"),
     "CFB ranking keeps observed results separate from the modelled rating");
  ok(d.retrodictive === true && d.prospective === false && d.graded === false &&
     d.consensus_ranking === false && d.current_2026_ranking === false && d.read_only === true && d.stored === false,
     "CFB ranking states its historical, ungraded, non-consensus and non-persistence limits");
}
{
  const j = await (await req(call("dd_rank_cfb_teams", { conference: "big ten", offset: 1, limit: 1 }))).json();
  const d = text(j);
  ok(!j.result.isError && d.query.conference === "Big Ten" && d.matched_before_pagination === 2 &&
     d.returned === 1 && d.teams[0].team === "Ohio State",
     "CFB ranking supports exact case-insensitive conference slices and bounded pagination");
  const explicit = text(await (await req(call("dd_rank_cfb_teams", { system_id: "DD-CFB-ELO" }))).json());
  ok(explicit.system.system_id === "dd-cfb-elo",
     "CFB ranking accepts an explicit case-insensitive registered system id");
  const unknown = await (await req(call("dd_rank_cfb_teams", { system_id: "mystery" }))).json();
  const conference = await (await req(call("dd_rank_cfb_teams", { conference: "NFL" }))).json();
  const offset = await (await req(call("dd_rank_cfb_teams", { offset: 200 }))).json();
  const limit = await (await req(call("dd_rank_cfb_teams", { limit: 51 }))).json();
  const extra = await (await req(call("dd_rank_cfb_teams", { consensus: true }))).json();
  ok(unknown.result.isError === true && conference.result.isError === true && offset.result.isError === true &&
     limit.result.isError === true && extra.result.isError === true,
     "CFB ranking fails closed on unknown systems, conferences and unsupported bounds or claims");
}
// dd_cfb_team_profile: exact bounded read over the dated registry, with every
// retrodictive/no-consensus limit preserved in the response.
{
  const j = await (await req(call("dd_cfb_team_profile", { team: "OHIO STATE" }))).json();
  const d = text(j), elo = d.systems[0];
  ok(!j.result.isError && d.team.team_slug === "ohio-state" && d.team.conference === "Big Ten",
     "CFB team profile resolves an exact case-insensitive team name");
  ok(elo.system_id === "dd-cfb-elo" && elo.rating.rank === 2 && elo.rating.team_strength === 1925.8 && elo.rating.win_probability === null,
     "CFB team profile returns the registered rating and preserves unsupported null outputs");
  ok(d.observed_results.record === "12-2-0" && d.observed_results.point_differential === 338,
     "CFB team profile keeps observed season results separate from the modelled rating");
  ok(d.observed_results_are_facts === true && d.modelled_fields.includes("systems") &&
     d.modelled_fields.includes("systems[].rating.retrodictive_team_diagnostic"),
     "CFB team profile labels which object is observed and which is modelled");
  ok(elo.team_diagnostics.rankings_published === false && elo.rating.retrodictive_team_diagnostic.games === 13 &&
     elo.rating.retrodictive_team_diagnostic.actual_minus_expected_wins === 0.9 &&
     !("rank" in elo.rating.retrodictive_team_diagnostic),
     "CFB team profile carries the non-ranked retrodictive team diagnostic");
  ok(d.as_of === "2026-08-08" && d.integrity.snapshot_id === "sha256:test-cfb-ratings" && d.read_only && d.stored === false,
     "CFB team profile preserves registry provenance and non-persistence");
  ok(d.modelled && d.retrodictive && d.prospective === false && d.graded === false && d.consensus.status === "not-built" &&
     d.warnings.some(x => /one rating is not a consensus/i.test(x)) && d.warnings.some(x => /not represent a current-season forecast/i.test(x)),
     "CFB team profile states the retrodictive, ungraded and no-consensus limits");
  ok(d.warnings.some(x => /not luck, team-quality labels, forecasts, grades or rankings/i.test(x)),
     "CFB team profile refuses to turn the diagnostic into a luck or quality label");
}
{
  const slug = text(await (await req(call("dd_cfb_team_profile", { team: "ohio-state" }))).json());
  ok(slug.team.name === "Ohio State" && slug.match.exact === true,
     "CFB team profile accepts the canonical slug");
  const partial = await (await req(call("dd_cfb_team_profile", { team: "state" }))).json();
  const missing = await (await req(call("dd_cfb_team_profile", { team: "Cleveland Tech" }))).json();
  const extra = await (await req(call("dd_cfb_team_profile", { team: "Akron", season: 2026 }))).json();
  const empty = await (await req(call("dd_cfb_team_profile", { team: "" }))).json();
  ok(partial.result.isError === true && /exact registry name or slug/.test(partial.result.content[0].text) &&
     missing.result.isError === true && extra.result.isError === true && empty.result.isError === true,
     "CFB team profile fails closed on partial, unknown, unsupported and empty inputs");
}
// dd_compare_cfb_teams: exact same-snapshot comparison without laundering the
// observed/rating deltas into a matchup forecast.
{
  const j = await (await req(call("dd_compare_cfb_teams", { team_a: "Ohio State", team_b: "akron" }))).json();
  const d = text(j), system = d.comparison.systems[0];
  ok(!j.result.isError && d.teams.team_a.team_slug === "ohio-state" && d.teams.team_b.team_slug === "akron",
     "CFB comparison resolves two exact names or slugs on one snapshot");
  ok(system.team_strength_delta_a_minus_b === 837.7 && system.rank_delta_a_minus_b === -131,
     "CFB comparison returns exact rating and rank deltas");
  ok(d.comparison.observed_2025.win_percentage_delta_a_minus_b > 0 &&
     d.teams.team_a.observed_results.record === "12-2-0" && d.teams.team_b.observed_results.record === "4-8-0",
     "CFB comparison keeps observed records separate from modelled system deltas");
  ok(d.read_only && d.stored === false && d.prospective === false && d.graded === false &&
     d.warnings.some(x => /not a head-to-head game projection/i.test(x)) && d.warnings.some(x => /not opponent-adjusted/i.test(x)) &&
     d.warnings.some(x => /not luck, team-quality labels, forecasts, grades or rankings/i.test(x)),
     "CFB comparison refuses forecast, edge and schedule-adjustment claims");
}
{
  const same = await (await req(call("dd_compare_cfb_teams", { team_a: "Akron", team_b: "akron" }))).json();
  const partial = await (await req(call("dd_compare_cfb_teams", { team_a: "state", team_b: "Akron" }))).json();
  const missing = await (await req(call("dd_compare_cfb_teams", { team_a: "Akron" }))).json();
  const extra = await (await req(call("dd_compare_cfb_teams", { team_a: "Akron", team_b: "Indiana", neutral: true }))).json();
  ok(same.result.isError === true && partial.result.isError === true && missing.result.isError === true && extra.result.isError === true,
     "CFB comparison fails closed on same-team, partial, missing and unsupported inputs");
}
// dd_project_cfb_matchup: exact parity with the published Elo transform, with
// venue handling and a hard boundary against calling it a scheduled forecast.
{
  const j = await (await req(call("dd_project_cfb_matchup", { home_team: "Ohio State", away_team: "Akron" }))).json();
  const d = text(j), projection = d.projections[0];
  const expected = 1 / (1 + 10 ** (-((1925.8 - 1088.1 + 55) / 400)));
  ok(!j.result.isError && d.matchup.home_team.team_slug === "ohio-state" && d.matchup.away_team.team_slug === "akron",
     "CFB matchup projection resolves an exact home and away team");
  ok(Math.abs(projection.home_win_probability - expected) < 1e-15 &&
     Math.abs(projection.away_win_probability - (1 - expected)) < 1e-15 && projection.venue_adjustment_elo === 55,
     "CFB matchup projection reproduces the published Elo probability transform exactly");
  ok(d.retrodictive === true && d.prospective === false && d.scheduled_game === false && d.graded === false &&
     d.unsupported_outputs.expected_margin === null && d.unsupported_outputs.predicted_total === null,
     "CFB matchup projection labels retrodictive status and refuses unsupported outputs");
  ok(d.warnings.some(x => /not a frozen 2026 forecast receipt/i.test(x)) && d.warnings.some(x => /not a consensus/i.test(x)),
     "CFB matchup projection carries forecast and consensus caveats");
}
{
  const home = text(await (await req(call("dd_project_cfb_matchup", { home_team: "Ohio State", away_team: "Akron" }))).json()).projections[0];
  const neutral = text(await (await req(call("dd_project_cfb_matchup", { home_team: "Ohio State", away_team: "Akron", neutral_site: true }))).json()).projections[0];
  ok(neutral.venue_adjustment_elo === 0 && neutral.home_win_probability < home.home_win_probability,
     "neutral-site CFB projection removes the published home-field adjustment");
  const same = await (await req(call("dd_project_cfb_matchup", { home_team: "Akron", away_team: "akron" }))).json();
  const partial = await (await req(call("dd_project_cfb_matchup", { home_team: "state", away_team: "Akron" }))).json();
  const badNeutral = await (await req(call("dd_project_cfb_matchup", { home_team: "Ohio State", away_team: "Akron", neutral_site: "yes" }))).json();
  const extra = await (await req(call("dd_project_cfb_matchup", { home_team: "Ohio State", away_team: "Akron", week: 1 }))).json();
  ok(same.result.isError === true && partial.result.isError === true && badNeutral.result.isError === true && extra.result.isError === true,
     "CFB matchup projection fails closed on same-team, partial, mistyped and unsupported inputs");
}
// dd_project_cfb_schedule_path: exact Poisson-binomial path math over
// caller-supplied opponents, never an invented schedule or playoff model.
{
  const args = {
    team: "Ohio State",
    games: [
      { opponent: "Akron", venue: "home", label: "home test" },
      { opponent: "Indiana", venue: "away", label: "road test" },
      { opponent: "Akron", venue: "neutral", label: "rematch" },
    ],
    minimum_wins: 2,
  };
  const j = await (await req(call("dd_project_cfb_schedule_path", args))).json();
  const d = text(j), system = d.systems[0];
  const p1 = 1 / (1 + 10 ** (-((1925.8 - 1088.1 + 55) / 400)));
  const indianaHome = 1 / (1 + 10 ** (-((2054.8 - 1925.8 + 55) / 400)));
  const p2 = 1 - indianaHome;
  const p3 = 1 / (1 + 10 ** (-((1925.8 - 1088.1) / 400)));
  const expected = p1 + p2 + p3;
  const distributionSum = system.exact_win_distribution.reduce((sum, row) => sum + row.probability, 0);
  const atLeastTwo = system.exact_win_distribution.slice(2).reduce((sum, row) => sum + row.probability, 0);
  ok(!j.result.isError && d.team.team_slug === "ohio-state" && d.games_supplied === 3 && system.games.length === 3,
     "CFB schedule path resolves a focal team and every caller-supplied opponent");
  ok(Math.abs(system.games[0].focal_win_probability - p1) < 1e-15 &&
     Math.abs(system.games[1].focal_win_probability - p2) < 1e-15 &&
     Math.abs(system.games[2].focal_win_probability - p3) < 1e-15,
     "CFB schedule path applies home, away and neutral Elo venue transforms exactly");
  ok(Math.abs(system.expected_wins - expected) < 1e-15 && Math.abs(distributionSum - 1) < 1e-12 &&
     Math.abs(system.probability_at_least_minimum_wins - atLeastTwo) < 1e-15,
     "CFB schedule path returns a normalized exact Poisson-binomial distribution and threshold probability");
  const leverageByIndex = Object.fromEntries(system.threshold_game_leverage.map(row => [row.index, row]));
  const exactOneWin = (a, b) => a * (1 - b) + (1 - a) * b;
  ok(system.threshold_game_leverage.length === 3 &&
     Math.abs(leverageByIndex[1].threshold_probability_swing - exactOneWin(p2, p3)) < 1e-15 &&
     Math.abs(leverageByIndex[2].threshold_probability_swing - exactOneWin(p1, p3)) < 1e-15 &&
     Math.abs(leverageByIndex[3].threshold_probability_swing - exactOneWin(p1, p2)) < 1e-15 &&
     system.threshold_game_leverage.every(row =>
       Math.abs(row.threshold_probability_swing -
         (row.probability_at_least_minimum_wins_if_forced_win -
          row.probability_at_least_minimum_wins_if_forced_loss)) < 1e-15),
     "CFB schedule path computes each supplied game's exact forced-win versus forced-loss threshold leverage");
  ok(system.threshold_game_leverage.every((row, i, rows) => i === 0 ||
     rows[i - 1].threshold_probability_swing >= row.threshold_probability_swing) &&
     /not conference or playoff leverage/i.test(d.warnings.join(" ")),
     "CFB schedule path ranks threshold leverage without laundering it into playoff leverage");
  ok(system.method.includes("no Monte Carlo") && d.actual_schedule === false &&
     d.playoff_or_conference_rules_modelled === false && d.retrodictive && !d.prospective && !d.graded,
     "CFB schedule path refuses actual-schedule, playoff, prospective and graded claims");
  ok(d.read_only && d.stored === false && d.assumptions.some(x => /independent/.test(x)) &&
     d.warnings.some(x => /not a prospective 2026 season forecast/i.test(x)),
     "CFB schedule path publishes independence, non-persistence and forecast caveats");
}
{
  const empty = await (await req(call("dd_project_cfb_schedule_path", { team: "Akron", games: [] }))).json();
  const same = await (await req(call("dd_project_cfb_schedule_path", { team: "Akron", games: [{ opponent: "Akron" }] }))).json();
  const partial = await (await req(call("dd_project_cfb_schedule_path", { team: "Akron", games: [{ opponent: "state" }] }))).json();
  const badVenue = await (await req(call("dd_project_cfb_schedule_path", { team: "Akron", games: [{ opponent: "Indiana", venue: "Cleveland" }] }))).json();
  const badMinimum = await (await req(call("dd_project_cfb_schedule_path", { team: "Akron", games: [{ opponent: "Indiana" }], minimum_wins: 2 }))).json();
  const extra = await (await req(call("dd_project_cfb_schedule_path", { team: "Akron", games: [{ opponent: "Indiana", spread: -3 }] }))).json();
  ok([empty, same, partial, badVenue, badMinimum, extra].every(result => result.result.isError === true),
     "CFB schedule path fails closed on empty, same-team, partial, bad-venue, impossible-threshold and unsupported inputs");
  const noThreshold = text(await (await req(call("dd_project_cfb_schedule_path", {
    team: "Akron", games: [{ opponent: "Indiana" }]
  }))).json()).systems[0];
  ok(noThreshold.threshold_game_leverage === null && noThreshold.threshold_leverage_definition === null,
     "CFB schedule path omits leverage when the caller supplies no win threshold");
}
// dd_find_cfb_record_divergence: descriptive team rows plus the aggregate-only
// chronological validation receipt, never current-team fraud labels.
{
  const j = await (await req(call("dd_find_cfb_record_divergence", {}))).json();
  const d = text(j);
  ok(!j.result.isError && d.returned === 3 && d.rows[0].team_slug === "florida-state" && d.rows[0].absolute_rank_gap === 57,
     "CFB divergence explorer defaults to largest absolute descriptive rank gaps");
  ok(d.validation.finding === "held-out-incremental-signal" && d.validation.holdout_games === 233 &&
     d.validation.holdout_brier_improvement_over_elo === 0.001123 && d.validation.promotion_gate_passed === true,
     "CFB divergence explorer returns the aggregate chronological validation receipt");
  ok(d.current_team_labels_permitted === false && !d.prospective && !d.market_adjusted && !d.graded &&
     d.read_only && d.stored === false && d.rows.every(row => !("predictive_label" in row)),
     "CFB divergence explorer refuses labels, prospective, market-adjusted and graded claims");
  ok(d.warnings.some(x => /small incremental signal beyond Elo/i.test(x)) &&
     d.warnings.some(x => /Do not convert/.test(x)),
     "CFB divergence explorer carries validation-scale and no-verdict caveats");
}
{
  const team = text(await (await req(call("dd_find_cfb_record_divergence", { team: "Kennesaw State" }))).json());
  const filtered = text(await (await req(call("dd_find_cfb_record_divergence", {
    direction: "scoring-ahead-of-record", conference: "acc", minimum_absolute_rank_gap: 40, limit: 1,
  }))).json());
  ok(team.returned === 1 && team.rows[0].team_slug === "kennesaw-state" && team.rows[0].record_scoring_rank_gap === 51,
     "CFB divergence explorer resolves an exact team without assigning a predictive label");
  ok(filtered.query.conference === "ACC" && filtered.returned === 1 && filtered.rows[0].team_slug === "florida-state",
     "CFB divergence explorer applies exact conference, direction, gap and limit filters");
}
{
  const partial = await (await req(call("dd_find_cfb_record_divergence", { team: "state" }))).json();
  const badDirection = await (await req(call("dd_find_cfb_record_divergence", { direction: "fraud" }))).json();
  const badConference = await (await req(call("dd_find_cfb_record_divergence", { conference: "NFL" }))).json();
  const badGap = await (await req(call("dd_find_cfb_record_divergence", { minimum_absolute_rank_gap: 136 }))).json();
  const badLimit = await (await req(call("dd_find_cfb_record_divergence", { limit: 26 }))).json();
  const extra = await (await req(call("dd_find_cfb_record_divergence", { verdict: "overrated" }))).json();
  ok([partial, badDirection, badConference, badGap, badLimit, extra].every(result => result.result.isError === true),
     "CFB divergence explorer fails closed on partial, invented, out-of-range and unsupported inputs");
}
// dd_get_cfb_model_disagreement: the blocked aggregate measurement is useful
// evidence, but unknown price timing forbids a winner, blend or game-level edge.
{
  const j = await (await req(call("dd_get_cfb_model_disagreement", {}))).json();
  const d = text(j);
  ok(!j.result.isError && d.finding === "blocked" && d.conclusion_withheld === true &&
     d.measured_anyway.n_paired_games === 5 && d.measured_anyway.buckets.length === 2,
     "CFB disagreement reader returns the dated blocked aggregate measurement");
  ok(d.market_observation_timestamp_available === false && d.market_price_timing === "unknown" &&
     d.better_model_identified === false && d.consensus_or_blend_authorized === false &&
     d.game_level_edges_available === false,
     "CFB disagreement reader preserves the no-winner, no-blend and no-edge boundary");
  ok(!d.prospective && !d.graded && d.read_only && d.stored === false &&
     /timestamped pregame market snapshot/i.test(d.what_would_unblock_it) &&
     d.warnings.some(x => /Do not infer a model winner/i.test(x)),
     "CFB disagreement reader returns the exact unblock condition and non-persistence caveats");
  const extra = await (await req(call("dd_get_cfb_model_disagreement", { game: "Ohio State" }))).json();
  ok(extra.result.isError === true,
     "CFB disagreement reader rejects game-level or other unsupported arguments");
}
// dd_get_cfb_model_receipt_status: zero rows is the honest prospective state,
// and the immutable forecast ledger is never represented as its own grade table.
{
  const j = await (await req(call("dd_get_cfb_model_receipt_status", {}))).json();
  const d = text(j);
  ok(!j.result.isError && d.status === "empty-by-design" && d.prospective_receipts === 0 &&
     d.model_count === 0 && d.models.length === 0 && d.first_actual_forecast_exists === false,
     "CFB receipt status reports the real zero-row prospective ledger");
  ok(d.graded_forecasts === 0 && d.receipt_ledger_is_grading_surface === false &&
     d.grading_surface_available === false && d.leaderboard_available === false && !d.prospective && !d.graded,
     "CFB receipt status refuses grades, a leaderboard and prospective evidence that do not exist");
  ok(d.read_only && d.stored === false && /scheduled 2026 game/i.test(d.next_unlock) &&
     d.warnings.some(x => /zero-row ledger is evidence/i.test(x)) &&
     d.warnings.some(x => /Retrodictive 2025 backtests are intentionally excluded/i.test(x)),
     "CFB receipt status names the exact first-forecast unlock and ledger boundary");
  const extra = await (await req(call("dd_get_cfb_model_receipt_status", { include_backtests: true }))).json();
  ok(extra.result.isError === true,
     "CFB receipt status rejects backtest or other unsupported arguments");
}
// dd_find_cfb_team_games: bounded mirrored team-perspective results with exact
// opponent, outcome and site filtering.
{
  const j = await (await req(call("dd_find_cfb_team_games", { team: "OHIO STATE" }))).json();
  const d = text(j);
  ok(!j.result.isError && d.team.team_slug === "ohio-state" && d.returned === 2 &&
     d.games[0].opponent.team === "Michigan" && d.games[1].opponent.team === "Georgia",
     "CFB team-game reader resolves an exact team and returns chronological opponent history");
  ok(d.games[0].result === "win" && d.games[0].point_differential === 3 &&
     d.games[1].team_side === "away" && d.games[1].site === "neutral" && d.games[1].point_differential === 1,
     "CFB team-game reader returns score and outcome from the selected team's perspective");
  ok(d.scope === "results-only" && d.observed_results_only && !d.modelled && !d.opponent_adjusted &&
     !d.market_adjusted && !d.forecast && !d.graded && d.read_only && d.stored === false &&
     d.unavailable_metrics.includes("epa_per_play") && d.warnings.some(x => /mirrored row per team/i.test(x)),
     "CFB team-game reader publishes its results-only mirrored-row boundary");
}
{
  const filtered = text(await (await req(call("dd_find_cfb_team_games", {
    team: "ohio-state", opponent: "Georgia", season_type: "postseason", result: "win", site: "neutral"
  }))).json());
  const latest = text(await (await req(call("dd_find_cfb_team_games", { team: "Ohio State", sort: "kickoff-desc", limit: 1 }))).json());
  ok(filtered.returned === 1 && filtered.games[0].game_id === "2025_post_01_ohio-state_georgia" &&
     filtered.query.opponent === "Georgia",
     "CFB team-game reader combines exact opponent, postseason, result and site filters");
  ok(latest.matched_before_limit === 2 && latest.returned === 1 && latest.games[0].opponent.team === "Georgia",
     "CFB team-game reader applies reverse chronological sort and strict output bounds");
}
{
  const partial = await (await req(call("dd_find_cfb_team_games", { team: "state" }))).json();
  const missing = await (await req(call("dd_find_cfb_team_games", {}))).json();
  const same = await (await req(call("dd_find_cfb_team_games", { team: "Ohio State", opponent: "ohio-state" }))).json();
  const badResult = await (await req(call("dd_find_cfb_team_games", { team: "Akron", result: "cover" }))).json();
  const badSite = await (await req(call("dd_find_cfb_team_games", { team: "Akron", site: "road" }))).json();
  const badLimit = await (await req(call("dd_find_cfb_team_games", { team: "Akron", limit: 51 }))).json();
  const extra = await (await req(call("dd_find_cfb_team_games", { team: "Akron", include_epa: true }))).json();
  ok([partial, missing, same, badResult, badSite, badLimit, extra].every(result => result.result.isError === true),
     "CFB team-game reader fails closed on partial, missing, same-team and unsupported inputs");
}
// dd_find_cfb_team_games at scope=latest-per-team: compact bounded cross-team
// final-game discovery, formerly dd_find_cfb_latest_games.
{
  const j = await (await req(call("dd_find_cfb_team_games", { scope: "latest-per-team" }))).json();
  const d = text(j);
  ok(!j.result.isError && d.season === 2025 && d.returned === 5 &&
     d.rows.map(row => row.team).join(",") === "Georgia,Iowa State,Kansas State,Michigan,Ohio State",
     "CFB latest-game reader defaults to a bounded alphabetical FBS index");
  ok(d.scope === "observed-final-results-only" && d.observed_results_only && !d.current_2026_form &&
     !d.forecast && !d.modelled && !d.graded && d.read_only && d.stored === false,
     "CFB latest-game reader refuses current-form, model and forecast claims");
  ok(d.coverage.final_games_only && d.coverage.one_row_per_represented_team &&
     d.warnings.some(x => /last completed game in the dated 2025/i.test(x)),
     "CFB latest-game reader preserves the final-only dated-latest boundary");
}
{
  const filtered = text(await (await req(call("dd_find_cfb_team_games", {
    scope: "latest-per-team", team: "OHIO STATE", conference: "big ten", opponent_division: "fbs",
    season_type: "postseason", result: "win", site: "neutral",
    sort: "kickoff-desc", offset: 0, limit: 1
  }))).json());
  ok(filtered.matched_before_pagination === 1 && filtered.returned === 1 &&
     filtered.rows[0].team_slug === "ohio-state" &&
     filtered.rows[0].latest_completed_game.opponent === "Georgia" && filtered.query.conference === "Big Ten",
     "CFB latest-game reader combines exact team, conference, opponent, period, result and site filters");
  const losses = text(await (await req(call("dd_find_cfb_team_games", { scope: "latest-per-team", result: "loss" }))).json());
  ok(losses.returned === 3 && losses.rows.map(row => row.team).join(",") === "Georgia,Kansas State,Michigan",
     "CFB latest-game reader filters team-perspective observed outcomes");
}
{
  const partial = await (await req(call("dd_find_cfb_team_games", { scope: "latest-per-team", team: "state" }))).json();
  const conference = await (await req(call("dd_find_cfb_team_games", { scope: "latest-per-team", conference: "NFL" }))).json();
  const opponent = await (await req(call("dd_find_cfb_team_games", { scope: "latest-per-team", opponent_division: "d2" }))).json();
  const result = await (await req(call("dd_find_cfb_team_games", { scope: "latest-per-team", result: "cover" }))).json();
  const offset = await (await req(call("dd_find_cfb_team_games", { scope: "latest-per-team", offset: 200 }))).json();
  const limit = await (await req(call("dd_find_cfb_team_games", { scope: "latest-per-team", limit: 51 }))).json();
  const extra = await (await req(call("dd_find_cfb_team_games", { scope: "latest-per-team", current: true }))).json();
  ok([partial, conference, opponent, result, offset, limit, extra].every(value => value.result.isError === true),
     "CFB latest-game reader fails closed on partial, invented, out-of-range and unsupported inputs");
}
// dd_find_cfb_team_periods at scope=latest-per-team: compact bounded cross-team
// discovery whose "latest" label stays tied to the dated 2025 FBS-involved surface.
// Formerly dd_find_cfb_latest_team_periods.
{
  const j = await (await req(call("dd_find_cfb_team_periods", { scope: "latest-per-team" }))).json();
  const d = text(j);
  ok(!j.result.isError && d.season === 2025 && d.returned === 2 &&
     d.rows.map(row => row.team).join(",") === "Akron,Ohio State",
     "CFB latest-period reader defaults to a bounded alphabetical compact index");
  ok(d.scope === "results-only" && d.observed_results_only && !d.current_2026_form && !d.forecast &&
     !d.modelled && !d.graded && d.read_only && d.stored === false,
     "CFB latest-period reader refuses current-form, model and forecast claims");
  ok(/not complete FCS season records/i.test(d.coverage.fcs_team_records) &&
     d.warnings.some(x => /last covered period in the dated 2025/i.test(x)),
     "CFB latest-period reader preserves the partial-FCS and dated-latest boundaries");
  ok(d.rows.find(row => row.team_slug === "ohio-state").conference_regular_season_to_date.record === "1-0-0" &&
     /not an official standing/i.test(d.conference_record_definition),
     "CFB latest-period reader exposes the explicitly non-authoritative conference record");
}
{
  const filtered = text(await (await req(call("dd_find_cfb_team_periods", {
    scope: "latest-per-team", team: "OHIO STATE", division: "fbs", conference: "big ten", season_type: "postseason",
    period_outcome: "positive", sort: "through-desc", offset: 0, limit: 1
  }))).json());
  ok(filtered.matched_before_pagination === 1 && filtered.returned === 1 &&
     filtered.rows[0].team_slug === "ohio-state" && filtered.rows[0].latest_period.period_key === "postseason-01" &&
     filtered.query.conference === "Big Ten",
     "CFB latest-period reader combines exact team, conference, division, period and outcome filters");
  const negative = text(await (await req(call("dd_find_cfb_team_periods", { scope: "latest-per-team", period_outcome: "negative" }))).json());
  ok(negative.returned === 1 && negative.rows[0].team === "Akron",
     "CFB latest-period outcome filter uses aggregate observed point-differential direction");
  const conferenceOrder = text(await (await req(call("dd_find_cfb_team_periods", {
    scope: "latest-per-team", sort: "conference-record-desc"
  }))).json());
  ok(conferenceOrder.rows.map(row => row.team).join(",") === "Ohio State,Akron" &&
     conferenceOrder.rows.every(row => !("conference_rank" in row)) &&
     conferenceOrder.warnings.some(value => /descriptive arithmetic order/i.test(value)),
     "CFB latest-period reader compares conference records without inventing official ranks");
}
{
  const partial = await (await req(call("dd_find_cfb_team_periods", { scope: "latest-per-team", team: "state" }))).json();
  const conference = await (await req(call("dd_find_cfb_team_periods", { scope: "latest-per-team", conference: "NFL" }))).json();
  const outcome = await (await req(call("dd_find_cfb_team_periods", { scope: "latest-per-team", period_outcome: "win" }))).json();
  const offset = await (await req(call("dd_find_cfb_team_periods", { scope: "latest-per-team", offset: 400 }))).json();
  const limit = await (await req(call("dd_find_cfb_team_periods", { scope: "latest-per-team", limit: 51 }))).json();
  const sort = await (await req(call("dd_find_cfb_team_periods", { scope: "latest-per-team", sort: "official-standing" }))).json();
  const extra = await (await req(call("dd_find_cfb_team_periods", { scope: "latest-per-team", current: true }))).json();
  ok([partial, conference, outcome, offset, limit, sort, extra].every(result => result.result.isError === true),
     "CFB latest-period reader fails closed on partial, invented, out-of-range and unsupported inputs");
}
// dd_find_cfb_team_periods: bounded results-only team history with repeated
// regular/postseason week labels kept distinct.
{
  const j = await (await req(call("dd_find_cfb_team_periods", { team: "OHIO STATE" }))).json();
  const d = text(j);
  ok(!j.result.isError && d.team.team_slug === "ohio-state" && d.team.team === "Ohio State" &&
     d.returned === 3 && d.periods.map(x => x.period_key).join(",") === "regular-01,regular-12,postseason-01",
     "CFB team-period reader resolves an exact team and returns chronological regular/postseason history");
  ok(d.periods[1].period.point_differential === 3 && d.periods[2].season_to_date.record === "12-1-0" &&
     d.periods[2].venue_counts.neutral === 1,
     "CFB team-period reader preserves period, season-to-date and venue facts");
  ok(d.periods[1].conference_regular_season_to_date.record === "1-0-0" &&
     d.periods[2].conference_regular_season_to_date.record === "1-0-0" &&
     /excludes postseason|not an official standing/i.test(d.conference_record_definition),
     "CFB team-period reader carries conference record through postseason without counting it");
  ok(d.scope === "results-only" && d.observed_results_only && !d.modelled && !d.opponent_adjusted &&
     !d.market_adjusted && !d.forecast && !d.graded && d.read_only && d.stored === false &&
     d.unavailable_metrics.includes("epa") && d.warnings.some(x => /Regular-season week 1 and postseason week 1/i.test(x)),
     "CFB team-period reader publishes the results-only and repeated-week boundaries");
}
{
  const post = text(await (await req(call("dd_find_cfb_team_periods", { team: "ohio-state", week: 1, season_type: "postseason" }))).json());
  const latest = text(await (await req(call("dd_find_cfb_team_periods", { team: "Ohio State", sort: "period-desc", limit: 1 }))).json());
  ok(post.returned === 1 && post.periods[0].period_key === "postseason-01",
     "CFB team-period reader disambiguates repeated week numbers with season_type");
  ok(latest.matched_before_limit === 3 && latest.returned === 1 && latest.periods[0].period_key === "postseason-01",
     "CFB team-period reader applies chronological sort and strict output bounds");
}
{
  const partial = await (await req(call("dd_find_cfb_team_periods", { team: "state" }))).json();
  const missing = await (await req(call("dd_find_cfb_team_periods", {}))).json();
  const badWeek = await (await req(call("dd_find_cfb_team_periods", { team: "Akron", week: 0 }))).json();
  const badSeason = await (await req(call("dd_find_cfb_team_periods", { team: "Akron", season_type: "bowl" }))).json();
  const badLimit = await (await req(call("dd_find_cfb_team_periods", { team: "Akron", limit: 26 }))).json();
  const extra = await (await req(call("dd_find_cfb_team_periods", { team: "Akron", include_epa: true }))).json();
  ok([partial, missing, badWeek, badSeason, badLimit, extra].every(result => result.result.isError === true),
     "CFB team-period reader fails closed on partial, missing, out-of-range and unsupported inputs");
}
// dd_find_cfb_games: bounded canonical schedule/result facts with season-type
// disambiguation and no model or market claims.
{
  const j = await (await req(call("dd_find_cfb_games", { team: "Ohio State", sort: "kickoff-asc" }))).json();
  const d = text(j);
  ok(!j.result.isError && d.season === 2025 && d.returned === 2 && d.games[0].season_type === "regular" &&
     d.games[1].season_type === "postseason",
     "CFB game finder resolves one exact team across regular and postseason games");
  ok(d.games[0].observed_result.home_margin === 3 && d.games[0].observed_result.winner_team_slug === "ohio-state" &&
     d.games[1].observed_result.home_margin === -1 && d.games[1].observed_result.winner_team_slug === "ohio-state",
     "CFB game finder derives winner and home margin only from observed final scores");
  ok(d.actual_canonical_schedule && d.completed_schedule && d.scheduled_games_in_surface === 0 &&
     d.prospective_model_output === false && d.forecast === false && !d.modelled && d.read_only && d.stored === false,
     "CFB game finder labels canonical facts, completed coverage and non-forecast status");
}
{
  const post = text(await (await req(call("dd_find_cfb_games", { week: 1, season_type: "postseason", conference: "big ten" }))).json());
  const noneScheduled = text(await (await req(call("dd_find_cfb_games", { status: "scheduled" }))).json());
  const exact = text(await (await req(call("dd_find_cfb_games", { game_id: "2025_regu_01_iowa-state_kansas-state" }))).json());
  ok(post.returned === 1 && post.games[0].game_id === "2025_post_01_ohio-state_georgia" && post.query.conference === "Big Ten",
     "CFB game finder combines week, season type and exact conference filters");
  ok(noneScheduled.returned === 0 && noneScheduled.matched_before_limit === 0,
     "CFB game finder reports that the completed surface has no scheduled games");
  ok(exact.returned === 1 && exact.games[0].observed_result.winner_team_slug === "iowa-state",
     "CFB game finder resolves an exact canonical game id");
}
{
  const partial = await (await req(call("dd_find_cfb_games", { team: "state" }))).json();
  const missingGame = await (await req(call("dd_find_cfb_games", { game_id: "2026_missing" }))).json();
  const badWeek = await (await req(call("dd_find_cfb_games", { week: 0 }))).json();
  const badConference = await (await req(call("dd_find_cfb_games", { conference: "NFL" }))).json();
  const badSort = await (await req(call("dd_find_cfb_games", { sort: "score" }))).json();
  const extra = await (await req(call("dd_find_cfb_games", { include_odds: true }))).json();
  ok([partial, missingGame, badWeek, badConference, badSort, extra].every(result => result.result.isError === true),
     "CFB game finder fails closed on partial, missing, out-of-range and unsupported inputs");
}
// dd_find_cfb_historical_market: queryable book prices whose unknown timing is
// enforced in both source validation and every response boundary.
{
  const j = await (await req(call("dd_find_cfb_historical_market", { team: "Ohio State", sort: "kickoff-asc" }))).json();
  const d = text(j);
  ok(!j.result.isError && d.season === 2025 && d.returned === 2 && d.games[0].game_id === "2025_regu_12_michigan_ohio-state" &&
     d.games[1].books.length === 0,
     "CFB historical market resolves one exact team and retains explicitly unpriced games");
  ok(d.observation_timestamp_available === false && d.price_timing === "unknown" &&
     d.verified_closing_lines === false && d.clv_supported === false &&
     d.prospective_input_eligible === false && d.current_market === false,
     "CFB historical market mechanically refuses closing-line, CLV, prospective and current-market claims");
  ok(d.games[0].books[0].source_labelled_open_spread_home === -6.5 &&
     !("spread_open_home" in d.games[0].books[0]) && d.rejected_quote_count === 1 &&
     d.warnings.some(x => /Never call these closing lines/i.test(x)),
     "CFB historical market relabels source-open fields and publishes rejection/caveat context");
}
{
  const book = text(await (await req(call("dd_find_cfb_historical_market", { book: "draftkings", priced_only: true, limit: 1 }))).json());
  const exact = text(await (await req(call("dd_find_cfb_historical_market", { game_id: "2025_regu_01_iowa-state_kansas-state" }))).json());
  ok(book.query.book === "DraftKings" && book.matched_before_limit === 2 && book.returned === 1 && book.games[0].books.length === 1,
     "CFB historical market applies exact book, priced-only and limit filters");
  ok(exact.returned === 1 && exact.games[0].median_devig_home_win_probability === 0.59337,
     "CFB historical market resolves an exact canonical game id");
}
{
  const partial = await (await req(call("dd_find_cfb_historical_market", { team: "state" }))).json();
  const missingGame = await (await req(call("dd_find_cfb_historical_market", { game_id: "2026_missing" }))).json();
  const badBook = await (await req(call("dd_find_cfb_historical_market", { book: "Mystery Book" }))).json();
  const badPriced = await (await req(call("dd_find_cfb_historical_market", { priced_only: "yes" }))).json();
  const badLimit = await (await req(call("dd_find_cfb_historical_market", { limit: 26 }))).json();
  const extra = await (await req(call("dd_find_cfb_historical_market", { closing_only: true }))).json();
  ok([partial, missingGame, badBook, badPriced, badLimit, extra].every(result => result.result.isError === true),
     "CFB historical market fails closed on partial, invented, mistyped and closing-line inputs");
}
// dd_get_cfb_model_card: generated governance and evaluation evidence, never a
// shortcut from roadmap lifecycle to prospective skill.
{
  const j = await (await req(call("dd_get_cfb_model_card", {}))).json();
  const d = text(j);
  ok(!j.result.isError && d.mode === "model-card-index" && d.card === null &&
     d.available_models.length === 1 && d.available_models[0].model_id === "cfb-elo",
     "CFB model-card reader lists compact generated card summaries");
  ok(d.cards_are_generated_from_model_output && !d.prospective_receipts_exist && !d.prospective_validation &&
     !d.graded && !d.consensus && !d.current_forecast && d.read_only && d.stored === false,
     "CFB model-card index refuses prospective, graded, consensus and current-forecast claims");
}
{
  const j = await (await req(call("dd_get_cfb_model_card", { model_id: "CFB-ELO" }))).json();
  const d = text(j);
  ok(!j.result.isError && d.mode === "model-card" && d.card.model_id === "cfb-elo" &&
     d.card.performance.full_evaluation_set.brier_home_win === 0.1862,
     "CFB model-card reader returns one exact full card and its generated performance evidence");
  ok(d.card.validation_design.kind === "retrodictive-backtest" &&
     d.card.receipts.prospective_receipts_exist === false &&
     d.warnings.some(x => /lifecycle value documents roadmap state/i.test(x)) &&
     d.warnings.some(x => /known_limitations, failure_modes and receipts/i.test(x)),
     "CFB model-card reader carries retrodictive, limitation and receipt boundaries");
}
{
  const missing = await (await req(call("dd_get_cfb_model_card", { model_id: "mystery-model" }))).json();
  const invalid = await (await req(call("dd_get_cfb_model_card", { model_id: "bad model" }))).json();
  const extra = await (await req(call("dd_get_cfb_model_card", { include_recommendation: true }))).json();
  ok([missing, invalid, extra].every(result => result.result.isError === true),
     "CFB model-card reader fails closed on missing, invalid and unsupported inputs");
}
// dd_scores: reuses handleScores with sport+dates
{
  const j = await (await req(call("dd_scores", { sport: "nfl", dates: "20260913" }))).json();
  const d = text(j);
  ok(d.games && d.games[0].short === "CLE @ PIT", "scores flow through handleScores");
  const j2 = await (await req(call("dd_scores", { sport: "curling" }))).json();
  ok(j2.result.isError === true, "unknown sport → isError");
  netMode = "espnDown";
  const j3 = await (await req(call("dd_scores", { sport: "nfl" }))).json();
  ok(j3.result.isError === true && /espn\.com/.test(j3.result.content[0].text), "ESPN egress refusal → honest isError with fallback hint");
  netMode = "normal";
}
// dd_dfs_correlations: extraction from the live page
{
  const j = await (await req(call("dd_dfs_correlations"))).json();
  const d = text(j);
  ok(d.roles && d.roles[0] === "QB" && d.same[0][0] === 1, "CORR extracted and parsed from dfs.html");
}
// dd_solve_dfs_lineup: exact parity with the browser's shared engine
{
  const raw = makeSlate(4, 23);
  const players = raw.map((p, i) => ({
    id: "classic-" + i, name: p.pos + " " + i, position: p.pos,
    team: p.team, opponent: p.opp, game_id: String(p.gid), salary: p.sal,
    projection: p.proj, ownership: (i % 37) + 1,
  }));
  const args = {
    players, site: "dk_classic", count: 2, min_salary: 49000, max_salary: 50000,
    unique_players: 2, randomness: 0, seed: 7, max_per_team: 4, time_limit_ms: 3000,
    stack: { qb_min: 1, qb_positions: ["WR", "TE"], bring_back: 1, no_rb_vs_dst: true },
  };
  const cfg = {
    site: "dk_classic", count: 2, minSalary: 49000, maxSalary: 50000,
    uniques: 2, randomness: 0, seed: 7, maxPerTeam: 4, maxPerGame: undefined,
    timeLimitMs: 3000,
    stack: { qbMin: 1, qbPos: ["WR", "TE"], bringBack: 1, noRbVsDst: true, noOppDst: false },
  };
  const enginePlayers = players.map(p => ({
    id: p.id, name: p.name, pos: p.position, team: p.team, opp: p.opponent,
    gid: p.game_id, sal: p.salary, proj: p.projection, own: p.ownership,
    lock: false, excl: false, maxExp: null,
  }));
  const ref = DDFS.solveLineups(enginePlayers, cfg);
  const j = await (await req(call("dd_solve_dfs_lineup", args))).json();
  const d = text(j);
  ok(!j.result.isError && d.status === "complete" && d.lineups.length === 2,
     "DFS classic returns the requested exact lineup set");
  ok(d.lineups.every(l => l.constraint_audit.satisfied && l.players.map(p => p.slot).join(",") === "QB,RB,RB,WR,WR,WR,TE,FLEX,DST"),
     "DFS classic returns slot-aware lineups with a passing constraint audit");
  ok(d.lineups.every((l, i) => l.salary === ref.lineups[i].sal &&
       Math.abs(l.projection - ref.lineups[i].proj) < 1e-10 &&
       l.players.map(p => p.id).sort().join(",") === ref.lineups[i].ids.map(x => players[x].id).sort().join(",")),
     "DFS MCP classic selections exactly match direct browser-engine output");
  ok(d.read_only === true && d.stored === false && /this call/.test(d.warnings[0]),
     "DFS response makes transient read-only handling explicit");
}
// Showdown uses the same engine, including the captain multiplier.
{
  const raw = makeSlate(1, 29);
  const players = raw.map((p, i) => ({
    id: "showdown-" + i, name: p.pos + " " + i, position: p.pos,
    team: p.team, opponent: p.opp, game_id: String(p.gid), salary: p.sal,
    projection: p.proj,
  }));
  const enginePlayers = players.map(p => ({
    id: p.id, name: p.name, pos: p.position, team: p.team, opp: p.opponent,
    gid: p.game_id, sal: p.salary, proj: p.projection, own: null,
    lock: false, excl: false, maxExp: null,
  }));
  const cfg = {
    site: "dk_showdown", count: 1, minSalary: 0, maxSalary: 50000,
    uniques: 0, randomness: 0, seed: 11, maxPerTeam: undefined, maxPerGame: undefined,
    timeLimitMs: 3000, stack: { qbMin: 0, qbPos: ["WR", "TE"], bringBack: 0, noRbVsDst: false, noOppDst: false },
  };
  const ref = DDFS.solveLineups(enginePlayers, cfg);
  const j = await (await req(call("dd_solve_dfs_lineup", {
    players, site: "dk_showdown", count: 1, seed: 11, time_limit_ms: 3000,
  }))).json();
  const d = text(j);
  ok(d.status === "complete" && d.lineups[0].captain_id === players[ref.lineups[0].cpt].id,
     "DFS showdown captain matches direct browser-engine output");
  ok(d.lineups[0].salary === ref.lineups[0].sal && d.lineups[0].players[0].slot === "CPT" &&
       d.lineups[0].players[0].slot_salary === Math.round(d.lineups[0].players[0].salary * 1.5),
     "DFS showdown reports the exact salary and captain multiplier");
}
// Malformed and infeasible slates fail honestly and stay bounded.
{
  const base = makeSlate(1, 31).slice(0, 9).map((p, i) => ({
    id: "bad-" + i, name: p.pos + " " + i, position: p.pos,
    team: p.team, opponent: p.opp, game_id: String(p.gid), salary: p.sal, projection: p.proj,
  }));
  const dup = base.map(p => ({ ...p })); dup[1].id = dup[0].id;
  const bad = await (await req(call("dd_solve_dfs_lineup", { players: dup }))).json();
  ok(bad.result.isError === true && /more than once/.test(bad.result.content[0].text),
     "DFS rejects duplicate public player ids");
  const tooMany = Array.from({ length: 221 }, (_, i) => ({ ...base[0], id: "too-many-" + i }));
  const over = await (await req(call("dd_solve_dfs_lineup", { players: tooMany }))).json();
  ok(over.result.isError === true && /limited to 220/.test(over.result.content[0].text),
     "DFS enforces the per-call player bound");
  const infeasible = await (await req(call("dd_solve_dfs_lineup", {
    players: [base[0]], site: "dk_classic", time_limit_ms: 100,
  }))).json();
  const d = text(infeasible);
  ok(!infeasible.result.isError && d.status === "infeasible" && d.returned_lineups === 0 && d.infeasible_reason,
     "DFS reports a valid structured infeasibility result instead of crashing");
}
// dd_site_map: says what is NOT served
{
  const j = await (await req(call("dd_site_map"))).json();
  const d = text(j);
  ok(d.notServedHere && /Never hosted or persisted/.test(d.notServedHere.dfs_projections_and_ownership) &&
     /bounded slate transiently/.test(d.notServedHere.dfs_projections_and_ownership),
     "notServedHere explains the DFS transient-compute invariant");
  ok(d.machine.surfaces.includes("surfaces.json"), "points agents at the surfaces map");
  ok(d.machine.data.includes("/data/model-contracts.json") && d.pages["pound.html"], "site map includes the Pound contracts and workbench");
  ok(d.machine.data.includes("/data/cfb-ratings.json") && d.machine.data.includes("/data/cfb-model-receipts.json") &&
     d.machine.data.includes("/data/cfb-team-game.json") && d.machine.data.includes("/data/cfb-team-week.json") &&
     d.machine.data.includes("/data/cfb-team-week-latest.json") && d.machine.data.includes("/data/cfb-games-latest.json") &&
     d.machine.data.includes("/data/cfb-teams.json"),
     "site map includes the canonical CFB registry, receipt ledger and results layers");
  ok(d.machine.data.includes("/data/cfb-record-divergence.json"),
     "site map includes the descriptive CFB record-divergence baseline");
  ok(d.machine.data.includes("/data/cfb-record-divergence-validation.json"),
     "site map includes the aggregate CFB divergence validation");
}

/* ------------- the merged CFB find surfaces: scope is a real boundary -------------
 * ⚠️ WHY THESE EXIST. `dd_find_cfb_team_games` and `dd_find_cfb_team_periods` each cover
 * a parent surface and its derived cross-sectional view behind one flat schema, which
 * means a caller can pass a parameter the chosen scope does not support. IGNORING IT
 * WOULD BE THE DISHONEST FAILURE: the caller gets a plausible answer to a question it did
 * not ask, and nothing in the response says so. Every assertion below reads the error
 * MESSAGE, because an error thrown for some other reason would satisfy isError just as
 * well and prove nothing.
 */
{
  const msg = async (tool, args) => {
    const j = await (await req(call(tool, args))).json();
    if (!j.result || j.result.isError !== true) return "(no error)";
    return j.result.content[0].text;
  };

  // the retired names are gone from the wire, not merely undocumented
  for (const gone of ["dd_find_cfb_latest_games", "dd_find_cfb_latest_team_periods"]) {
    const j = await (await req(call(gone))).json();
    ok(/Unknown tool/.test((j.error && j.error.message) || (j.result && j.result.content[0].text) || ""),
       gone + " is not callable — the consolidation removed the name, it did not alias it");
  }

  // team is required for the default scope and optional for the derived one, and the
  // error says which is which rather than "team must be a non-empty name or slug"
  const noTeam = await msg("dd_find_cfb_team_games", {});
  ok(/team is required when scope is team-games/.test(noTeam) && /latest-per-team/.test(noTeam),
     "the conditional team requirement is enforced with an error that names both scopes", noTeam);
  const noTeamPeriods = await msg("dd_find_cfb_team_periods", {});
  ok(/team is required when scope is team-periods/.test(noTeamPeriods),
     "…and the same holds for the period surface", noTeamPeriods);

  // a parameter belonging to the other scope is refused BY NAME, naming the scope
  const wrongWay = await msg("dd_find_cfb_team_games", { scope: "latest-per-team", opponent: "Georgia" });
  ok(/unsupported field for scope latest-per-team: opponent/.test(wrongWay),
     "a parent-scope parameter is refused by name under the derived scope", wrongWay);
  const otherWay = await msg("dd_find_cfb_team_games", { team: "Ohio State", conference: "Big Ten" });
  ok(/unsupported field for scope team-games: conference/.test(otherWay),
     "…and a derived-scope parameter is refused by name under the parent scope", otherWay);
  const periodWrongWay = await msg("dd_find_cfb_team_periods", { team: "Ohio State", period_outcome: "positive" });
  ok(/unsupported field for scope team-periods: period_outcome/.test(periodWrongWay),
     "the period surface refuses period_outcome outside latest-per-team", periodWrongWay);
  const plural = await msg("dd_find_cfb_team_games", { team: "Ohio State", conference: "Big Ten", offset: 1 });
  ok(/unsupported fields for scope team-games: conference, offset/.test(plural),
     "…and two of them are refused together, both named", plural);

  // the sort enum is the union of both scopes, so a value must be checked against the
  // scope and not merely against the enum
  const crossSort = await msg("dd_find_cfb_team_games", { team: "Ohio State", sort: "team-asc" });
  ok(/sort must be kickoff-asc or kickoff-desc/.test(crossSort),
     "a sort value from the other scope is refused even though the schema enum allows it", crossSort);
  const crossSortBack = await msg("dd_find_cfb_team_games", { scope: "latest-per-team", sort: "kickoff-asc" });
  ok(/sort must be team-asc or kickoff-desc/.test(crossSortBack),
     "…in both directions", crossSortBack);
  const crossPeriodSort = await msg("dd_find_cfb_team_periods", { team: "Ohio State", sort: "conference-record-desc" });
  ok(/sort must be period-asc or period-desc/.test(crossPeriodSort),
     "…and on the period surface too", crossPeriodSort);

  // ⚠️ THE PER-SCOPE LIMIT CEILING SURVIVED THE MERGE. The schema advertises the union
  // maximum of 50; team-periods still refuses 26, because that bound is a payload bound
  // and raising it silently would be a behaviour change disguised as a refactor.
  const tightLimit = await msg("dd_find_cfb_team_periods", { team: "Ohio State", limit: 26 });
  ok(/limit must be a whole number from 1 through 25/.test(tightLimit),
     "team-periods keeps its 25 ceiling under the union schema maximum of 50", tightLimit);
  {
    const j = await (await req(call("dd_find_cfb_team_periods", { scope: "latest-per-team", limit: 26 }))).json();
    ok(!j.result.isError, "…while latest-per-team accepts 26, so the ceiling is per-scope and not global");
  }

  // an invented scope is refused, and names what is available
  const badScope = await msg("dd_find_cfb_team_games", { scope: "everything" });
  ok(/scope must be team-games or latest-per-team/.test(badScope), "an invented scope is refused", badScope);

  // both scopes declare which shape came back, so a consumer branches on a stated field
  // instead of probing for a key
  {
    const parent = text(await (await req(call("dd_find_cfb_team_games", { team: "Ohio State" }))).json());
    ok(parent.query.scope === "team-games" && parent.response_shape === "team-game-rows" &&
       Array.isArray(parent.games) && !("rows" in parent),
       "the parent scope echoes its scope and declares the team-game shape");
    const derived = text(await (await req(call("dd_find_cfb_team_games", { scope: "latest-per-team" }))).json());
    ok(derived.query.scope === "latest-per-team" && derived.response_shape === "latest-per-team-rows" &&
       Array.isArray(derived.rows) && !("games" in derived),
       "the derived scope echoes its scope and declares the latest-per-team shape");
    // ⚠️ the top-level `scope` field is the DATA SURFACE's coverage string and predates
    // the parameter. If the parameter had been echoed there it would have overwritten a
    // published honesty claim, so the two must not be the same field.
    ok(parent.scope !== parent.query.scope && typeof parent.scope === "string",
       "the top-level scope still carries the data surface's coverage string, not the argument");
    const derivedPeriods = text(await (await req(call("dd_find_cfb_team_periods", { scope: "latest-per-team" }))).json());
    ok(derivedPeriods.response_shape === "latest-per-team-rows" && derivedPeriods.query.scope === "latest-per-team",
       "the period surface declares its shape the same way");
  }

  // the per-scope DEFAULTS differ, and the default must follow the scope
  {
    const parent = text(await (await req(call("dd_find_cfb_team_games", { team: "Ohio State" }))).json());
    ok(parent.query.sort === "kickoff-asc" && parent.query.limit === 25,
       "the parent scope keeps its own sort and limit defaults");
    const derived = text(await (await req(call("dd_find_cfb_team_games", { scope: "latest-per-team" }))).json());
    ok(derived.query.sort === "team-asc" && derived.query.offset === 0,
       "the derived scope keeps its own sort default and its pagination");
    const parentPeriods = text(await (await req(call("dd_find_cfb_team_periods", { team: "Ohio State" }))).json());
    ok(parentPeriods.query.sort === "period-asc" && parentPeriods.query.limit === 20,
       "the period parent scope defaults to period-asc and a limit of 20, not the union's 25");
  }

  // the merged descriptions have to name the scopes, or a model cannot discover them
  {
    const listed = (await (await req(rpc("tools/list"))).json()).result.tools;
    for (const name of ["dd_find_cfb_team_games", "dd_find_cfb_team_periods"]) {
      const tool = listed.find(x => x.name === name);
      ok(/scope=latest-per-team/.test(tool.description) && /refused by name rather than ignored/.test(tool.description),
         name + " tells a caller the derived scope exists and that a wrong parameter is refused");
      ok(tool.inputSchema.properties.scope && !("required" in tool.inputSchema),
         name + " advertises scope and no longer claims an unconditional required field");
    }
  }
}

/* ----------------------- source-level safety asserts ----------------------- */
const blockSrc = readFileSync(resolve(WORK, "mcp-block.js"), "utf8");
const noComments = blockSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
/* ------------------------ dd_draft_bozo_leg ------------------------
   ⚠️ It reads the board and runs the server's validator. It submits nothing. The tests
   below go through the refusals in the order the tool checks them, then the happy path. */
const asUser = (name, args, id = 1) =>
  req(call("dd_draft_bozo_leg", args, id), { path: "/mcp/" + name });
const LEG = { sport: "nfl", eventId: "403", game: "SF @ SEA", mkt: "spread", side: "SF", line: -6.5, price: -180, label: "SF -6.5" };

{
  // identity first: the shared connector cannot answer "are you in this league"
  const j = await (await req(call("dd_draft_bozo_leg", LEG))).json();
  ok(j.result.isError === true, "shared connector: dd_draft_bozo_leg refuses");
  ok(/connect\.html/.test(j.result.content[0].text), "…and points at where to mint a personal URL");
}
{
  const j = await (await asUser("u_outsider", LEG)).json();
  ok(j.result.isError === true && /not in main/.test(j.result.content[0].text),
     "a member of nothing is refused before any leg is inspected");
}
{
  leagueRec.status = "placed";
  const d = text(await (await asUser(USER_TOKEN, LEG)).json());
  leagueRec.status = "open";
  ok(d.accepted === false && d.reason === "board-closed", "board locked: refused, with the reason named");
  ok(/lever hierarchy has already been drawn/.test(d.detail), "…and says the draw already happened");
}
{
  leagueRec.allowEdit = false;
  const d = text(await (await asUser("u_kap", LEG)).json());
  leagueRec.allowEdit = undefined;
  ok(d.accepted === false && d.reason === "edits-locked" && d.yourExistingLeg.label === "Over 47.5",
     "a league that locks legs on arrival refuses an edit, and shows what is already in");
}
{
  const d = text(await (await asUser(USER_TOKEN, { ...LEG, price: 150 })).json());
  ok(d.accepted === false && /outside the/.test(d.detail),
     "a price outside the band is refused in the server's own words");
  ok(d.band && d.band.ceil !== undefined, "…and the band is returned so the caller can fix it");
}
{
  // ⚠️ Uniqueness is keyed on the SELECTION, not on the label. Two people can spell the
  // same bet differently and DraftKings still rejects the second one — the ticket is one
  // parlay and the same selection cannot go on it twice. So the check has to look at
  // event, market, side and number, and a label that merely LOOKS the same must not
  // trigger it.
  const dupe = text(await (await asUser(USER_TOKEN,
    { ...LEG, eventId: "401", game: "CLE @ PIT", mkt: "spread", side: "CLE", line: 3.5, label: "Browns -3.5" })).json());
  ok(dupe.accepted === false && /Jeff already has that exact selection/.test(dupe.detail),
     "a duplicate SELECTION is refused even when spelled differently, and names whose leg it clashes with");
  ok(/DraftKings won't take it twice/.test(dupe.detail),
     "…and says it is DraftKings' constraint, not a house preference");

  // A label that collides while the selection does not is fine — the old check got this
  // exactly backwards and would have blocked a legal leg.
  const lookalike = text(await (await asUser(USER_TOKEN,
    { ...LEG, eventId: "409", game: "CLE @ BAL", mkt: "spread", side: "CLE", line: 3.5, label: "CLE -3.5" })).json());
  ok(lookalike.accepted === true,
     "the same label on a DIFFERENT game is accepted — the label was never the thing DK rejects");
}
{
  // ⚠️ THE CHECK UNIQUENESS DOES NOT MAKE. Jeff has CLE -3.5; PIT +3.5 is a DIFFERENT
  // selection, so the duplicate test passes it — and the resulting ticket could never
  // cash, because both legs cannot win. DK blocks the pair, and so must we.
  const contra = text(await (await asUser(USER_TOKEN,
    { ...LEG, eventId: "401", game: "CLE @ PIT", mkt: "spread", side: "PIT", line: -3.5, label: "PIT +3.5" })).json());
  ok(contra.accepted === false && /other side of that same market/.test(contra.detail),
     "the opposite side of a market already on the ticket is refused");
  ok(/could never win/.test(contra.detail), "…and says why: the ticket could never cash");

  // Same, on a total, where the two sides are over/under rather than two teams.
  const ou = text(await (await asUser(USER_TOKEN,
    { ...LEG, eventId: "402", game: "DET @ GB", mkt: "total", side: "under", line: 47.5, label: "Under 47.5" })).json());
  ok(ou.accepted === false && /other side of that same market/.test(ou.detail),
     "under 47.5 is refused when over 47.5 is already on the ticket");

  // A different NUMBER on the same game is a different market instance and stays legal.
  const otherNumber = text(await (await asUser(USER_TOKEN,
    { ...LEG, eventId: "402", game: "DET @ GB", mkt: "total", side: "under", line: 51.5, label: "Under 51.5" })).json());
  ok(otherNumber.accepted === true,
     "under 51.5 alongside over 47.5 is accepted — different numbers are different markets, and both can cash");
}
{
  // Futures are not SGP-legal, so they are not Bozo legs. This is a word match and is
  // deliberately narrow; it is not a market lookup and must never be described as one.
  const fut = text(await (await asUser(USER_TOKEN,
    { ...LEG, mkt: "other", prop: "Lions to win the division", label: "DET division" })).json());
  ok(fut.accepted === false && /future/.test(fut.detail),
     "a future dressed up as an \"other\" leg is refused");
}
{
  const d = text(await (await asUser(USER_TOKEN, { ...LEG, mkt: "other", prop: "" })).json());
  ok(d.accepted === false && /needs to say what it actually is/.test(d.detail),
     "an \"other\" leg with no description is refused");
}
{
  const d = text(await (await asUser(USER_TOKEN, LEG)).json());
  ok(d.accepted === true, "a legal leg is accepted");
  ok(d.you === "The Kid", "the caller is resolved from the per-user token, decoded");
  ok(d.submit.body.league === "main" && d.submit.body.pick.label === "SF -6.5" &&
     d.submit.body.pick.line === -6.5 && d.submit.body.pick.price === -180,
     "the returned body is the exact shape /bozo/pick wants");
  ok(d.willBeStoredAs.priceSource === "self" && /set by the server/.test(String(d.willBeStoredAs.ts)),
     "what the server will store is shown, including that it stamps the time and the price is self-reported");
  ok(d.editingAnExistingLeg === false, "The Kid has no leg in yet");
  // ⚠️ three members, two legs in — The Kid's would be the last one
  ok(d.wouldLockTheBoard === true && /LAST LEG/.test(d.warning) && /never redone/.test(d.warning),
     "it says plainly when submitting would lock the board and draw the hierarchy for everyone");
  ok(Array.isArray(d.stillWaitingOn) && d.stillWaitingOn.length === 1 && d.stillWaitingOn[0] === "The Kid",
     "stillWaitingOn is who has no leg in");
  ok(d.caveats.some(c => /Nothing was submitted/.test(c)), "the payload says nothing was submitted");
  ok(d.caveats.some(c => /self-reported/.test(c)), "…and that the price is unchecked");
}
{
  const d = text(await (await asUser("u_kap", { ...LEG, label: "SF -6.5 (edit)" })).json());
  ok(d.accepted === true && d.editingAnExistingLeg === true && d.editResetsYourClock === true,
     "an edit is allowed by default and says it resets the clock");
  ok(d.wouldLockTheBoard === false,
     "replacing a leg that is already counted does not become the locking leg");
}
{
  // the tool must defer to the enforcer, not carry its own copy of the rules
  const src = readFileSync(resolve(WORK, "mcp-block.js"), "utf8");
  const tool = src.slice(src.indexOf('name: "dd_draft_bozo_leg"'), src.indexOf('name: "dd_draft_board"'));
  ok(/validatePick\(/.test(tool), "dd_draft_bozo_leg calls the server's validatePick");
  ok(!/outside the .* band/.test(tool) && !/Unknown market/.test(tool),
     "…and does not carry its own copy of the rules to drift from");
}

/* ---------------- dd_submit_bozo_leg — the ONE write tool, two-phase ---------------- */
{
  const kv = new Map();
  const envW = { ...env, RL: {
    async get(k) { return kv.has(k) ? kv.get(k) : null; },
    async put(k, v) { kv.set(k, v); },
  } };
  const reqW = (body, path) => worker.fetch(new Request("https://toto.jkapcar4.workers.dev" + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), envW);
  const submit = (args, tok = "u_kap") => reqW(call("dd_submit_bozo_leg", args), "/mcp/" + tok);
  const NEWLEG = { sport: "nfl", eventId: "402", game: "DET @ GB", mkt: "spread", side: "DET", line: 6.5,
                   price: -150, label: "DET -6.5", priceOpp: 130, startsAt: "2026-09-13T17:00:00Z" };

  livePicks = { ...leagueRec.picks }; legWrites = [];

  // the shared connector cannot write — identity is the whole ballgame
  const shared = await (await reqW(call("dd_submit_bozo_leg", NEWLEG), "/mcp/" + PASS)).json();
  ok(shared.result.isError === true && /connect\.html/.test(shared.result.content[0].text),
     "shared connector: dd_submit_bozo_leg refuses and points at a personal URL");

  // phase one: validates, echoes, stages — and writes NOTHING
  const p1 = text(await (await submit(NEWLEG)).json());
  ok(p1.status === "confirm_required" && typeof p1.confirm_code === "string" && p1.confirm_code.length === 6,
     "propose returns confirm_required with a code");
  ok(/DET -6\.5/.test(p1.echo) && /for Kap/.test(p1.echo) && /week 1/.test(p1.echo),
     "the echo reads the parsed bet back in plain English, named to the caller");
  ok(/REPLACES your current leg/.test(p1.echo) && p1.editingAnExistingLeg === true,
     "the echo says it replaces the existing leg and resets the clock");
  ok(p1.wouldLockTheBoard === false, "replacing an already-counted leg does not lock the board");
  ok(legWrites.length === 0, "phase one wrote NOTHING to the board");
  ok(Array.isArray(p1.missing) && p1.missing.length === 0,
     "priceOpp and startsAt were supplied, so nothing is flagged missing");

  // a wrong code commits nothing
  const wrong = await (await submit({ confirm: "NOPE99" })).json();
  ok(wrong.result.isError === true && legWrites.length === 0, "a wrong confirm code writes nothing");

  // phase two: the same code commits, through the same write path the site uses
  const p2 = text(await (await submit({ confirm: p1.confirm_code })).json());
  ok(p2.status === "submitted" && p2.you === "Kap" && p2.leg.label === "DET -6.5",
     "confirm submits the staged leg for the caller");
  ok(legWrites.length === 1 && legWrites[0].url.includes("/picks/Kap.json"),
     "exactly one write, to the caller's OWN pick and nowhere else");
  const stored = legWrites[0].body;
  ok(stored.via === "mcp", "the stored leg is stamped via:'mcp' — the audit answer to 'did a human do this?'");
  ok(typeof stored.ts === "number" && stored.ts >= NOW, "the server stamped the time, not the client");
  ok(stored.priceSource === "self" && stored.entryPriceOpp === 130 && stored.startsAt === "2026-09-13T17:00:00Z",
     "priceOpp and startsAt rode through to the stored pick");
  ok(!!stored.selectionKey && !!stored.marketKey, "selection and market keys are stored at write time");
  ok(p2.boardLocked === false, "2 of 3 legs in — the board did not lock");

  // idempotent replay: same code, same answer, still one write
  const replay = text(await (await submit({ confirm: p1.confirm_code })).json());
  ok(replay.status === "submitted" && replay.ts === p2.ts && legWrites.length === 1,
     "replaying a used code is a no-op returning the ORIGINAL result");

  // a non-member with a valid personal token still cannot touch the board
  const out = await (await submit(NEWLEG, "u_outsider")).json();
  ok(out.result.isError === true && legWrites.length === 1, "a non-member's propose is refused");

  // the lock warning: The Kid's leg would be the third of three
  const kid = text(await (await submit({ sport: "nfl", eventId: "402", game: "DET @ GB", mkt: "ml", side: "GB",
    price: -140, label: "GB ML" }, USER_TOKEN)).json());
  ok(kid.status === "confirm_required" && kid.wouldLockTheBoard === true && /LAST LEG/.test(kid.echo),
     "the echo shouts when confirming would lock the board and draw the hierarchy");
  ok(kid.missing.length === 2, "missing priceOpp and startsAt are named, not silently accepted");
  ok(legWrites.length === 1, "…and proposing it still wrote nothing");

  // identity: a uid-keyed account resolves to its display name end to end
  const who = text(await (await reqW(call("dd_whoami"), "/mcp/u_jefftok")).json());
  ok(who.player === "Jeff", "a uid-keyed account's connector resolves to its display name");
  ok(/dd_submit_bozo_leg/.test(who.access), "whoami states the write scope instead of claiming read-only");
  const wk = text(await (await reqW(call("dd_bozo_week"), "/mcp/u_jefftok")).json());
  ok(wk.legs.some(l => l.player === "Jeff" && l.you === true),
     "a uid-keyed member's own leg is marked you:true — the exact miss the live board showed");

  livePicks = null; legWrites = [];
}

/* ⚠️ These three pinned "the block writes nothing" until dd_submit_bozo_leg
   (2026-08-13, cep-identity §4) retired that claim ON PURPOSE. What they pin now is the
   PRECISE write scope, so any second write path has to argue with a failing test:
   - still no direct Firebase write helper in the block — the only route to a Firebase
     write is commitBozoLeg, the same single write path the site form uses, exactly once;
   - every KV write in the block targets the caller's own mcpconfirm: staging key;
   - still no hand-rolled writing HTTP request anywhere in the block. */
ok(!/fbPut|fbPatch|fbDelete/.test(noComments), "block calls NO Firebase write helper directly");
ok((noComments.match(/commitBozoLeg\(/g) || []).length === 1,
   "the block reaches the Firebase write path via commitBozoLeg exactly once");
ok((noComments.match(/\.put\(/g) || []).length === (noComments.match(/env\.RL\.put\(kvKey/g) || []).length,
   "every KV write in the block is env.RL.put on the caller's own mcpconfirm staging key");
ok(!/\.delete\(/.test(noComments), "block performs NO KV deletes");
ok(!/method:\s*["'](PUT|POST|PATCH|DELETE)/.test(noComments), "block issues NO writing HTTP methods");
const assembled = readFileSync(resolve(WORK, "..", "dawg-bot-worker.js"), "utf8");
/* ⚠️ THIS USED TO BE AN ASSERTION THAT COULD NOT FAIL. It read dawg-bot-worker.js into
   `assembled` and then read THE SAME FILE into `oldLines`, so "purely additive: every
   non-blank old line survives" compared a file with itself and was true for any input.
   There is no reference-free way to make that sentence mean anything, so it is replaced
   by the invariant that was actually worth having and that nothing else covered: THE
   ASSEMBLED WORKER'S TOOL ROSTER IS EXACTLY THE REGISTRY'S, and the generated block is
   bounded by its markers so nothing leaked outside them.

   This is not hypothetical. work/mcp-block.js had said "(Pup / Dawgs / The DawgHouse)"
   since Stage TR while the committed Worker still said "(Labs / Dawgs / The Pound)",
   because the Worker had not been reassembled. 343 assertions were green throughout. */
const MCP_START = "/* ===== DD-MCP-BLOCK START — generated from work/mcp-block.js; edit THERE ===== */";
const MCP_END = "/* ===== DD-MCP-BLOCK END ===== */";
ok(assembled.split(MCP_START).length === 2 && assembled.split(MCP_END).length === 2,
   "the generated block appears exactly once, bounded by its markers");
{
  const inBlock = assembled.slice(assembled.indexOf(MCP_START), assembled.indexOf(MCP_END));
  const outOfBlock = assembled.slice(0, assembled.indexOf(MCP_START)) + assembled.slice(assembled.indexOf(MCP_END));
  const names = s => (s.match(/\n    name: "(?:dd|sd)_\w+",\n/g) || []).map(m => m.trim());
  const registry = names(blockSrc);
  ok(registry.length === N_TOOLS && names(inBlock).join("|") === registry.join("|"),
     `the assembled block declares the registry's ${N_TOOLS} tools, in the registry's order`,
     `${names(inBlock).length} assembled vs ${registry.length} declared`);
  ok(names(outOfBlock).length === 0,
     "no tool is declared outside the markers, where assemble.mjs would never regenerate it");
  // and the block is genuinely a COPY of the source, not a drifted sibling: the source's
  // own text has to be present verbatim, which is what caught nothing for two stages.
  const registrySource = blockSrc.slice(blockSrc.indexOf("const MCP_TOOLS = ["));
  ok(inBlock.includes(registrySource.trimEnd()),
     "the assembled block contains work/mcp-block.js verbatim — a stale Worker fails here");
}
ok((assembled.match(/export default/g) || []).length === 1, "exactly one default export");
ok((assembled.match(/function solveLineups/g) || []).length === 1 && assembled.includes("const mcpDdfsRoot = {}"),
   "assembled Worker contains one private copy of the shared DFS engine");
ok((assembled.match(/function solvePath/g) || []).length === 1 && assembled.includes("const mcpSurvivorPathRoot = {}"),
   "assembled Worker contains one private copy of the shared survivor path engine");
ok(!assembled.includes(PASS), "no hardcoded secrets in the source");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
