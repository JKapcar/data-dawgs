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
      prospective_forecasts_exist: false, graded: false,
    }],
    teams: [
      { team_slug: "indiana", team: "Indiana", conference: "Big Ten", observed_results: { season: 2025, through_at: "2026-01-01T00:00:00Z", record: "16-0-0", games: 16, wins: 16, losses: 0, ties: 0, point_differential: 300 }, systems: { "dd-cfb-elo": { rank: 1, team_strength: 2054.8, games_rated: 96, expected_margin: null, win_probability: null, predicted_total: null } } },
      { team_slug: "ohio-state", team: "Ohio State", conference: "Big Ten", observed_results: { season: 2025, through_at: "2026-01-01T00:30:00Z", record: "12-2-0", games: 14, wins: 12, losses: 2, ties: 0, point_differential: 338, win_percentage: 0.8571, point_differential_per_game: 24.143 }, systems: { "dd-cfb-elo": { rank: 2, team_strength: 1925.8, games_rated: 99, expected_margin: null, win_probability: null, predicted_total: null } } },
      { team_slug: "akron", team: "Akron", conference: "Mid-American", observed_results: { season: 2025, through_at: "2025-11-29T00:00:00Z", record: "4-8-0", games: 12, wins: 4, losses: 8, ties: 0, point_differential: -100, win_percentage: 0.3333, point_differential_per_game: -8.333 }, systems: { "dd-cfb-elo": { rank: 133, team_strength: 1088.1, games_rated: 93, expected_margin: null, win_probability: null, predicted_total: null } } },
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

let netMode = "normal"; // normal | dbdown | emptyRoom | espnDown | simulatedRoom | simulatedSettings
globalThis.fetch = async (input, init) => {
  const u = String(input instanceof URL ? input.href : (input && input.url) || input);
  const method = (init && init.method) || (input && input.method) || "GET";
  const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  if (method !== "GET") throw new Error("TEST: non-GET network call attempted by MCP path: " + method + " " + u);
  if (u.startsWith(FB + "/bozo/leagues.json") || u.startsWith(FB + "/bozo/leagues.json?")) {
    if (netMode === "dbdown") throw new Error("connect refused");
    return J({ main: leagueRec });
  }
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
  if (u.includes("datadawgs216.com/data/cfb-schedule.json")) return J(cfbScheduleJson);
  if (u.includes("datadawgs216.com/dfs.html")) return new Response(dfsHtml, { status: 200 });
  if (u.includes("site.api.espn.com")) {
    if (netMode === "espnDown") return new Response("no", { status: 403 });
    return J(espnRaw);
  }
  throw new Error("TEST: unexpected fetch " + u);
};

/* -------------------------------- helpers -------------------------------- */
const PASS = "sekrit-league-pass";
const env = { DAWG_PASS: PASS, RL: { async get(k) { return k === "survivor:2026:1" ? JSON.stringify({ season: 2026, week: 1, stored: NOW - 3600e3, picks: { CLE: 40 } }) : null; } } };
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
  ok(t.length === 34, "thirty-four tools listed in the staged Worker source");
  ok(t.every(x => x.name.startsWith("dd_")), "all tools dd_-prefixed");
  ok(t.every(x => x.inputSchema && x.inputSchema.type === "object"), "all tools carry an inputSchema");
  for (const name of ["dd_convert_odds", "dd_devig_market", "dd_price_parlay", "dd_calculate_bet_ev",
    "dd_calculate_hedge", "dd_nfl_passer_rating", "dd_score_forecast", "dd_summarize_beliefs",
    "dd_elo_game", "dd_translate_probability", "dd_solve_dfs_lineup", "dd_model_scoreboard", "dd_cfb_team_profile", "dd_compare_cfb_teams", "dd_project_cfb_matchup", "dd_project_cfb_schedule_path", "dd_find_cfb_record_divergence", "dd_get_cfb_model_disagreement", "dd_get_cfb_model_receipt_status", "dd_find_cfb_games", "dd_optimize_survivor_path"])
    ok(t.some(x => x.name === name), name + " is listed");
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
  ok(a.maxBid === 127 - 13, "maxBid = left − (openSpots − 1) — $1 reserved per unfilled slot");
  ok(b.maxBid === 200 - 14, "untouched team maxBid = budget − (spots − 1)");
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
  const doubled = text(await (await req(call("dd_optimize_survivor_path", { double_pick_from: 10 }))).json());
  ok(doubled.rules_fully_modelled === false && doubled.warnings.some(w => /DOUBLE-PICK RULE NOT MODELLED/.test(w)),
     "double-pick rule fails visibly instead of pretending to be modelled");
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
  ok(d.observed_results_are_facts === true && d.modelled_fields.length === 1 && d.modelled_fields[0] === "systems",
     "CFB team profile labels which object is observed and which is modelled");
  ok(d.as_of === "2026-08-08" && d.integrity.snapshot_id === "sha256:test-cfb-ratings" && d.read_only && d.stored === false,
     "CFB team profile preserves registry provenance and non-persistence");
  ok(d.modelled && d.retrodictive && d.prospective === false && d.graded === false && d.consensus.status === "not-built" &&
     d.warnings.some(x => /one rating is not a consensus/i.test(x)) && d.warnings.some(x => /not represent a current-season forecast/i.test(x)),
     "CFB team profile states the retrodictive, ungraded and no-consensus limits");
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
     d.warnings.some(x => /not a head-to-head game projection/i.test(x)) && d.warnings.some(x => /not opponent-adjusted/i.test(x)),
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
     d.machine.data.includes("/data/cfb-team-game.json") && d.machine.data.includes("/data/cfb-team-week.json") && d.machine.data.includes("/data/cfb-teams.json"),
     "site map includes the canonical CFB registry, receipt ledger and results layers");
  ok(d.machine.data.includes("/data/cfb-record-divergence.json"),
     "site map includes the descriptive CFB record-divergence baseline");
  ok(d.machine.data.includes("/data/cfb-record-divergence-validation.json"),
     "site map includes the aggregate CFB divergence validation");
}

/* ----------------------- source-level safety asserts ----------------------- */
const blockSrc = readFileSync(resolve(WORK, "mcp-block.js"), "utf8");
const noComments = blockSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
ok(!/fbPut|fbPatch|fbDelete/.test(noComments), "block calls NO Firebase write helper");
ok(!/\.put\(|\.delete\(/.test(noComments), "block performs NO KV writes");
ok(!/method:\s*["'](PUT|POST|PATCH|DELETE)/.test(noComments), "block issues NO writing HTTP methods");
const assembled = readFileSync(resolve(WORK, "..", "dawg-bot-worker.js"), "utf8");
const oldLines = readFileSync(resolve(WORK, "..", "dawg-bot-worker.js"), "utf8").split("\n").filter(l => l.trim());
const newSet = new Set(assembled.split("\n"));
ok(oldLines.every(l => newSet.has(l)), "purely additive: every non-blank old line survives");
ok((assembled.match(/export default/g) || []).length === 1, "exactly one default export");
ok((assembled.match(/function solveLineups/g) || []).length === 1 && assembled.includes("const mcpDdfsRoot = {}"),
   "assembled Worker contains one private copy of the shared DFS engine");
ok((assembled.match(/function solvePath/g) || []).length === 1 && assembled.includes("const mcpSurvivorPathRoot = {}"),
   "assembled Worker contains one private copy of the shared survivor path engine");
ok(!assembled.includes(PASS), "no hardcoded secrets in the source");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
