#!/usr/bin/env python3
"""Reproduce 538 Classic Elo and publish immutable 2026 forecast receipts.

The model mathematics are a clean-room Python reimplementation of the MIT-licensed
FiveThirtyEight reference. Online refreshes pin both upstream commits, reproduce all
16,810 official historical probabilities, extend ratings with completed nflverse
games, and then emit only pre-kickoff forecasts. Offline validation uses the public
envelope and receipt ledger without reaching the network.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
if str(Path(__file__).parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).parent))

import nfl_data_backbone as backbone  # noqa: E402


DEFAULT_OUTPUT = ROOT / "data" / "538-classic.json"
DEFAULT_SCHEDULE = ROOT / "data" / "nfl-schedule.json"
DEFAULT_LEDGER = ROOT / "data" / "model-receipts.json"
DEFAULT_LEGACY = ROOT / "data" / "receipts.json"

MODEL_ID = "538-classic"
MODEL_NAME = "538 Classic Elo"
MODEL_VERSION = "classic-1.0.0"
OFFICIAL_REPOSITORY = "fivethirtyeight/nfl-elo-game"
OFFICIAL_COMMIT = "fbec1afa38ece5befe24fb21be8ddba8eb160fe6"
OFFICIAL_GAMES_URL = (
    f"https://raw.githubusercontent.com/{OFFICIAL_REPOSITORY}/{OFFICIAL_COMMIT}/"
    "data/nfl_games.csv"
)
OFFICIAL_INITIAL_URL = (
    f"https://raw.githubusercontent.com/{OFFICIAL_REPOSITORY}/{OFFICIAL_COMMIT}/"
    "data/initial_elos.csv"
)
OFFICIAL_GAMES_SHA256 = "af16cf3c5848393057fad07feea278f0a85ab7b57ddbfe42ed96b5c80e7d519d"
OFFICIAL_INITIAL_SHA256 = "d9e5ef0c9d762128fd2a9da0107989de4ab5c9f1e52411864adae19c6528bdf1"
HISTORY_REPOSITORY = "nflverse/nfldata"
HISTORY_URL_TEMPLATE = (
    "https://raw.githubusercontent.com/nflverse/nfldata/{commit}/data/games.csv"
)
METHODOLOGY_URL = "https://datadawgs216.com/data/538-classic-methodology.md"
NFELO_METHODOLOGY_URL = "https://datadawgs216.com/data/nfelo.json"
NFELO_REPOSITORY = "greerreNFL/nfelo"
NFELO_COMMIT = "0d3f8418f1f9fc4755ff42acb2d5f56c27c137ca"
NFELO_VERSION = "4.3.0"
NFELO_PUBLICATION_COMMIT = "ee8795f6b800e1600f73dc48c362f6e5720a076f"
NFELO_CAPTURED_AT = "2026-08-07T00:39:11Z"

HFA = 65
K = 20
REVERT = 1.0 / 3.0
REVERSION_BASELINE = 1505
REVERSIONS = {
    "CBD1925": 1502.032,
    "RAC1926": 1403.384,
    "LOU1926": 1307.201,
    "CIB1927": 1362.919,
    "MNN1929": 1306.702,
    "BFF1929": 1331.943,
    "LAR1944": 1373.977,
    "PHI1944": 1497.988,
    "ARI1945": 1353.939,
    "PIT1945": 1353.939,
    "CLE1999": 1300.0,
}
POSTSEASON_TYPES = {"REG", "WC", "DIV", "CON", "SB"}
TIER_MEANING = (
    "Pup — live and useful, not yet validated. It may compute real answers and still "
    "have open questions about calibration, assumptions, data quality or edge. "
    "Everything starts here."
)


class ModelError(ValueError):
    """Raised when model inputs or public outputs fail closed."""


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def csv_rows(value: bytes) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(value.decode("utf-8-sig"))))


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "data-dawgs-538-classic/1"})
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - fixed HTTPS URLs
        return response.read()


def normalize_csv_bytes(value: bytes) -> bytes:
    """Use Git blob line endings so hashes are stable across OS checkouts."""
    return value.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def source_bytes(path: Path | None, url: str) -> bytes:
    value = path.read_bytes() if path is not None else download(url)
    return normalize_csv_bytes(value)


def result_from_scores(home_score: int, away_score: int) -> float:
    if home_score == away_score:
        return 0.5
    return 1.0 if home_score > away_score else 0.0


def win_probability(home_elo: float, away_elo: float, neutral: bool = False) -> float:
    elo_diff = home_elo - away_elo + (0 if neutral else HFA)
    return 1.0 / (math.pow(10.0, -elo_diff / 400.0) + 1.0)


def margin_multiplier(point_difference: int, elo_diff: float, result_home: float) -> float:
    if result_home == 0.5:
        denominator = 1.0
    else:
        winner_diff = elo_diff if result_home == 1.0 else -elo_diff
        denominator = winner_diff * 0.001 + 2.2
    return math.log(max(abs(point_difference), 1) + 1.0) * (2.2 / denominator)


def regress_rating(rating: float) -> float:
    return REVERSION_BASELINE * REVERT + rating * (1.0 - REVERT)


def prepare_team(state: dict[str, dict[str, Any]], team: str, season: int) -> None:
    entry = state[team]
    if entry["season"] is not None and entry["season"] != season:
        entry["rating"] = REVERSIONS.get(f"{team}{season}", regress_rating(entry["rating"]))
    entry["season"] = season


def play_game(
    state: dict[str, dict[str, Any]],
    home: str,
    away: str,
    season: int,
    neutral: bool,
    home_score: int | None,
    away_score: int | None,
) -> float:
    prepare_team(state, home, season)
    prepare_team(state, away, season)
    home_entry, away_entry = state[home], state[away]
    elo_diff = home_entry["rating"] - away_entry["rating"] + (0.0 if neutral else HFA)
    probability = 1.0 / (math.pow(10.0, -elo_diff / 400.0) + 1.0)
    if home_score is not None and away_score is not None:
        result = result_from_scores(home_score, away_score)
        multiplier = margin_multiplier(home_score - away_score, elo_diff, result)
        shift = K * multiplier * (result - probability)
        home_entry["rating"] += shift
        away_entry["rating"] -= shift
    return probability


def replay_official_reference(
    initial_rows: Iterable[dict[str, str]], games: Iterable[dict[str, str]]
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    state = {
        row["team"]: {"rating": float(row["elo"]), "season": None}
        for row in initial_rows
    }
    compared = 0
    max_error = 0.0
    error_sum = 0.0
    for row in games:
        home, away = row["team1"], row["team2"]
        if home not in state or away not in state:
            raise ModelError(f"official reference contains an unseeded team: {home}/{away}")
        probability = play_game(
            state,
            home,
            away,
            int(row["season"]),
            row["neutral"] == "1",
            int(row["score1"]) if row["score1"] else None,
            int(row["score2"]) if row["score2"] else None,
        )
        if row["elo_prob1"]:
            error = abs(probability - float(row["elo_prob1"]))
            compared += 1
            max_error = max(max_error, error)
            error_sum += error
    # The historical CSV stores some early-era Elo seeds to three decimals, so a
    # clean replay from those published seeds is not bit-identical to the hidden
    # pre-rounding state. The official implementation reproduces to below 2e-6
    # probability (0.0002 percentage point) across every published row.
    if compared != 16810 or max_error > 2e-6:
        raise ModelError(
            f"official reproduction failed: {compared} rows, max probability error {max_error}"
        )
    return state, {
        "status": "reproduced",
        "official_probabilities_compared": compared,
        "max_absolute_probability_error": max_error,
        "mean_absolute_probability_error": error_sum / compared,
        "independent_skill_claim": False,
        "note": (
            "This proves the published mathematics were reproduced; it does not establish "
            "current predictive skill or betting profitability."
        ),
    }


def current_state_from_official(state: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    aliases = {"OAK": "LV", "WSH": "WAS"}
    current: dict[str, dict[str, Any]] = {}
    for team, entry in state.items():
        canonical = aliases.get(team, team)
        if canonical in backbone.CURRENT_TEAMS and entry["season"] == 2020:
            if canonical in current:
                raise ModelError(f"official state maps more than once to {canonical}")
            current[canonical] = {"rating": entry["rating"], "season": 2020}
    missing = backbone.CURRENT_TEAMS - set(current)
    if missing:
        raise ModelError(f"official 2020 state is missing current teams: {sorted(missing)}")
    return current


def replay_modern_history(
    state: dict[str, dict[str, Any]], rows: Iterable[dict[str, str]], target_season: int
) -> dict[str, Any]:
    games = [
        row
        for row in rows
        if 2021 <= int(row["season"]) < target_season
        and row["game_type"] in POSTSEASON_TYPES
        and row["home_score"] != ""
        and row["away_score"] != ""
    ]
    games.sort(key=lambda row: (row["gameday"], row["game_id"]))
    if target_season == 2026 and len(games) != 1424:
        raise ModelError(f"expected 1,424 completed 2021-2025 games, found {len(games)}")
    for row in games:
        home = backbone.canonical_team(row["home_team"])
        away = backbone.canonical_team(row["away_team"])
        play_game(
            state,
            home,
            away,
            int(row["season"]),
            row["location"].strip().lower() == "neutral",
            int(float(row["home_score"])),
            int(float(row["away_score"])),
        )
    if set(state) != backbone.CURRENT_TEAMS:
        raise ModelError("modern replay changed the current 32-team state")
    return {
        "games_replayed": len(games),
        "first_game": games[0]["game_id"] if games else None,
        "last_game": games[-1]["game_id"] if games else None,
        "last_game_date": games[-1]["gameday"] if games else None,
    }


def target_season_ratings(
    state: dict[str, dict[str, Any]], target_season: int
) -> dict[str, float]:
    ratings: dict[str, float] = {}
    for team in sorted(backbone.CURRENT_TEAMS):
        entry = state[team]
        if entry["season"] != target_season - 1:
            raise ModelError(f"{team} state did not reach season {target_season - 1}")
        ratings[team] = round(regress_rating(entry["rating"]), 6)
    return ratings


def make_forecasts(
    schedule: dict[str, Any], ratings: dict[str, float], captured_at: str
) -> list[dict[str, Any]]:
    captured = backbone.parse_timestamp(captured_at, "captured_at")
    forecasts: list[dict[str, Any]] = []
    for game in schedule["data"]["games"]:
        kickoff = backbone.parse_timestamp(game["kickoff_at"], "kickoff_at")
        if game["status"] != "scheduled" or kickoff <= captured:
            continue
        home, away = game["home_team"], game["away_team"]
        probability = win_probability(ratings[home], ratings[away], game["neutral_site"])
        forecasts.append({
            "game_id": game["game_id"],
            "season": game["season"],
            "week": game["week"],
            "kickoff_at": game["kickoff_at"],
            "home_team": home,
            "away_team": away,
            "neutral_site": game["neutral_site"],
            "home_elo": ratings[home],
            "away_elo": ratings[away],
            "home_field_elo": 0 if game["neutral_site"] else HFA,
            "home_win_probability": round(probability, 6),
        })
    return forecasts


def build_envelope(
    schedule: dict[str, Any],
    official_games_bytes: bytes,
    official_initial_bytes: bytes,
    history_bytes: bytes,
    captured_at: str,
) -> dict[str, Any]:
    backbone.validate_schedule_envelope(schedule)
    if sha256_bytes(official_games_bytes) != OFFICIAL_GAMES_SHA256:
        raise ModelError("official nfl_games.csv hash does not match the pinned reference")
    if sha256_bytes(official_initial_bytes) != OFFICIAL_INITIAL_SHA256:
        raise ModelError("official initial_elos.csv hash does not match the pinned reference")
    official_state, reproduction = replay_official_reference(
        csv_rows(official_initial_bytes), csv_rows(official_games_bytes)
    )
    state = current_state_from_official(official_state)
    season = int(schedule["data"]["season"])
    history = replay_modern_history(state, csv_rows(history_bytes), season)
    ratings = target_season_ratings(state, season)
    teams = [{"team": team, "elo": ratings[team]} for team in sorted(ratings)]
    forecasts = make_forecasts(schedule, ratings, captured_at)
    source_commit = schedule["provenance"]["source_commit"]
    input_material = {
        "model": {
            "id": MODEL_ID,
            "version": MODEL_VERSION,
            "home_field_elo": HFA,
            "k_factor": K,
            "offseason_reversion": REVERT,
            "reversion_baseline": REVERSION_BASELINE,
        },
        "official_reference": {
            "repository": OFFICIAL_REPOSITORY,
            "commit": OFFICIAL_COMMIT,
            "games_sha256": OFFICIAL_GAMES_SHA256,
            "initial_elos_sha256": OFFICIAL_INITIAL_SHA256,
        },
        "modern_history": {
            "repository": HISTORY_REPOSITORY,
            "commit": source_commit,
            "games_sha256": sha256_bytes(history_bytes),
            "games_replayed": history["games_replayed"],
        },
        "schedule_snapshot_id": schedule["integrity"]["snapshot_id"],
        "target_season_ratings": teams,
    }
    data = {"season": season, "teams": teams, "forecasts": forecasts}
    captured = backbone.parse_timestamp(captured_at, "captured_at")
    day = captured.date().isoformat()
    envelope = {
        "as_of": day,
        "source": (
            "Data Dawgs reimplementation of FiveThirtyEight 538 Classic Elo at commit "
            f"{OFFICIAL_COMMIT}; state extended with nflverse/nfldata at {source_commit}."
        ),
        "tier": "labs",
        "graded": False,
        "note": (
            "Prospective 2026 probabilities from the original 538 Classic Elo mathematics. "
            "They are ungraded, contain no QB, injury, weather or market adjustment, and are "
            "a permanent simple benchmark rather than a claim of current superiority."
        ),
        "methodology": {
            "home_field_elo": HFA,
            "k_factor": K,
            "offseason_reversion": REVERT,
            "reversion_baseline": REVERSION_BASELINE,
            "win_probability": "1 / (10 ** (-adjusted_elo_difference / 400) + 1)",
            "margin_multiplier": (
                "ln(max(abs(point_difference),1)+1) * 2.2 / "
                "(winner_pregame_elo_difference*0.001+2.2); ties use denominator 1"
            ),
            "methodology_url": METHODOLOGY_URL,
        },
        "provenance": {
            "generated_at": captured_at,
            "official_reference": {
                "repository": OFFICIAL_REPOSITORY,
                "commit": OFFICIAL_COMMIT,
                "license": "MIT",
                "games_sha256": OFFICIAL_GAMES_SHA256,
                "initial_elos_sha256": OFFICIAL_INITIAL_SHA256,
            },
            "modern_history": {
                "repository": HISTORY_REPOSITORY,
                "commit": source_commit,
                "source_data_license": "not-verified-for-nfldata-repository",
                "games_sha256": sha256_bytes(history_bytes),
                **history,
            },
            "schedule_snapshot_id": schedule["integrity"]["snapshot_id"],
            "input_material": input_material,
        },
        "validation": reproduction,
        "integrity": {
            "input_snapshot_id": backbone.sha256_id(input_material),
            "snapshot_id": backbone.sha256_id(data),
            "forecast_rows": len(forecasts),
            "team_rows": len(teams),
        },
        "data": data,
        "tier_meaning": TIER_MEANING,
        "built": day,
        "canonical_url": "https://datadawgs216.com/data/538-classic.json",
    }
    validate_envelope(envelope, schedule)
    return envelope


def validate_envelope(envelope: dict[str, Any], schedule: dict[str, Any]) -> None:
    backbone.validate_schedule_envelope(schedule)
    if envelope.get("graded") is not False:
        raise ModelError("538 Classic must remain explicitly ungraded")
    provenance = envelope.get("provenance", {})
    reference = provenance.get("official_reference", {})
    if reference.get("commit") != OFFICIAL_COMMIT or reference.get("license") != "MIT":
        raise ModelError("538 Classic official provenance is not pinned and MIT-labelled")
    validation = envelope.get("validation", {})
    if (
        validation.get("status") != "reproduced"
        or validation.get("official_probabilities_compared") != 16810
        or validation.get("max_absolute_probability_error", 1) > 2e-6
    ):
        raise ModelError("538 Classic historical reproduction evidence is missing")
    material = provenance.get("input_material")
    integrity = envelope.get("integrity", {})
    if integrity.get("input_snapshot_id") != backbone.sha256_id(material):
        raise ModelError("538 Classic input snapshot hash does not reproduce")
    data = envelope.get("data", {})
    if integrity.get("snapshot_id") != backbone.sha256_id(data):
        raise ModelError("538 Classic public snapshot hash does not reproduce")
    teams = data.get("teams")
    forecasts = data.get("forecasts")
    if not isinstance(teams, list) or not isinstance(forecasts, list):
        raise ModelError("538 Classic data must contain team and forecast arrays")
    rating_map = {row.get("team"): row.get("elo") for row in teams if isinstance(row, dict)}
    if set(rating_map) != backbone.CURRENT_TEAMS or len(teams) != 32:
        raise ModelError("538 Classic must contain exactly the current 32 teams")
    schedule_games = {game["game_id"]: game for game in schedule["data"]["games"]}
    ids: set[str] = set()
    for forecast in forecasts:
        game_id = forecast.get("game_id")
        if game_id in ids:
            raise ModelError(f"duplicate 538 Classic forecast: {game_id}")
        ids.add(game_id)
        game = schedule_games.get(game_id)
        if not game or forecast.get("kickoff_at") != game["kickoff_at"]:
            raise ModelError(f"538 Classic forecast disagrees with schedule: {game_id}")
        expected = round(
            win_probability(
                rating_map[game["home_team"]],
                rating_map[game["away_team"]],
                game["neutral_site"],
            ),
            6,
        )
        if forecast.get("home_win_probability") != expected:
            raise ModelError(f"538 Classic probability does not reproduce: {game_id}")
    if integrity.get("forecast_rows") != len(forecasts) or integrity.get("team_rows") != 32:
        raise ModelError("538 Classic integrity row counts disagree")
    if provenance.get("schedule_snapshot_id") != schedule["integrity"]["snapshot_id"]:
        raise ModelError("538 Classic schedule snapshot is stale")


def legacy_nfelo_hash(rows: list[dict[str, Any]]) -> str:
    canonical = "\n".join(
        f"{row['id']}|{float(row['p']):.4f}|"
        f"{'' if row.get('mk') is None else f'{float(row['mk']):.4f}'}"
        for row in rows
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def migrate_nfelo_receipts(
    legacy: dict[str, Any], schedule: dict[str, Any]
) -> list[dict[str, Any]]:
    rows = legacy.get("data")
    if not isinstance(rows, list) or len(rows) != 272:
        raise ModelError("legacy nfelo receipt ledger must contain 272 rows")
    locked_hash = legacy.get("integrity", {}).get("sha256")
    if locked_hash != legacy_nfelo_hash(rows):
        raise ModelError("legacy nfelo receipt hash does not reproduce")
    schedule_games = {game["game_id"]: game for game in schedule["data"]["games"]}
    snapshot_id = schedule["integrity"]["snapshot_id"]
    migrated: list[dict[str, Any]] = []
    for row in rows:
        home = backbone.canonical_team(row["h"])
        away = backbone.canonical_team(row["a"])
        canonical_id = backbone.canonical_game_id(2026, int(row["wk"]), away, home)
        game = schedule_games.get(canonical_id)
        if not game:
            raise ModelError(f"legacy nfelo game is absent from canonical schedule: {row['id']}")
        if home != game["home_team"] or away != game["away_team"]:
            raise ModelError(f"legacy nfelo teams disagree with schedule: {row['id']}")
        forecast_slug = row["id"].lower().replace("_", "-")
        migrated.append({
            "forecast_id": f"nfelo-4-3-0-{forecast_slug}-locked-20260806",
            "game_id": canonical_id,
            "season": game["season"],
            "week": game["week"],
            "kickoff_at": game["kickoff_at"],
            "captured_at": NFELO_CAPTURED_AT,
            "model_id": "nfelo",
            "model_name": "nfelo",
            "model_version": NFELO_VERSION,
            "source_repo": NFELO_REPOSITORY,
            "source_commit": NFELO_COMMIT,
            "source_capture_at": NFELO_CAPTURED_AT,
            "home_team": game["home_team"],
            "away_team": game["away_team"],
            "home_win_probability": round(float(row["p"]), 4),
            "expected_margin_home": None,
            "model_spread_home": None,
            "home_cover_probability": None,
            "push_probability": None,
            "input_snapshot_id": f"sha256:{locked_hash}",
            "schedule_snapshot_id": snapshot_id,
            "forecast_status": "prospective",
            "methodology_url": NFELO_METHODOLOGY_URL,
            "license_status": "unverified-no-license-file-output-only",
            "legacy_receipt_id": row["id"],
            "legacy_ledger_sha256": locked_hash,
            "legacy_publication_commit": NFELO_PUBLICATION_COMMIT,
            "market_status": (
                "not-normalized-missing-book-and-observation-timestamp"
                if row.get("mk") is not None
                else "absent"
            ),
        })
    return migrated


def model_receipts(envelope: dict[str, Any]) -> list[dict[str, Any]]:
    provenance = envelope["provenance"]
    input_snapshot_id = envelope["integrity"]["input_snapshot_id"]
    schedule_snapshot_id = provenance["schedule_snapshot_id"]
    captured_at = provenance["generated_at"]
    prefix = input_snapshot_id.removeprefix("sha256:")[:12]
    receipts: list[dict[str, Any]] = []
    for forecast in envelope["data"]["forecasts"]:
        forecast_slug = forecast["game_id"].lower().replace("_", "-")
        receipts.append({
            "forecast_id": f"538-classic-1-0-0-{prefix}-{forecast_slug}",
            "game_id": forecast["game_id"],
            "season": forecast["season"],
            "week": forecast["week"],
            "kickoff_at": forecast["kickoff_at"],
            "captured_at": captured_at,
            "model_id": MODEL_ID,
            "model_name": MODEL_NAME,
            "model_version": MODEL_VERSION,
            "source_repo": OFFICIAL_REPOSITORY,
            "source_commit": OFFICIAL_COMMIT,
            "source_capture_at": captured_at,
            "home_team": forecast["home_team"],
            "away_team": forecast["away_team"],
            "home_win_probability": forecast["home_win_probability"],
            "expected_margin_home": None,
            "model_spread_home": None,
            "home_cover_probability": None,
            "push_probability": None,
            "input_snapshot_id": input_snapshot_id,
            "schedule_snapshot_id": schedule_snapshot_id,
            "forecast_status": "prospective",
            "methodology_url": METHODOLOGY_URL,
            "license_status": "verified-mit-reference-reimplementation",
            "home_elo": forecast["home_elo"],
            "away_elo": forecast["away_elo"],
            "home_field_elo": forecast["home_field_elo"],
            "history_source_commit": provenance["modern_history"]["commit"],
        })
    return receipts


def update_ledger(
    ledger: dict[str, Any],
    legacy: dict[str, Any],
    model: dict[str, Any],
    schedule: dict[str, Any],
) -> dict[str, Any]:
    additions = migrate_nfelo_receipts(legacy, schedule) + model_receipts(model)
    updated = backbone.append_receipts(ledger, additions, schedule)
    source = (
        "Data Dawgs normalized append-only multi-model receipt ledger: locked nfelo "
        "4.3.0 output plus prospective 538 Classic Elo forecasts."
    )
    note = (
        "Every row is prospective and append-only. The nfelo adapter preserves its locked "
        "model probability but deliberately omits legacy market values whose book and "
        "observation timestamp are unknown. Results remain separate and nothing is graded yet."
    )
    if (
        updated["data"] == ledger["data"]
        and ledger.get("source") == source
        and ledger.get("note") == note
    ):
        return ledger
    updated["source"] = source
    updated["note"] = note
    backbone.validate_receipt_ledger(updated)
    return updated


def validate_public(
    model: dict[str, Any],
    ledger: dict[str, Any],
    legacy: dict[str, Any],
    schedule: dict[str, Any],
) -> None:
    validate_envelope(model, schedule)
    backbone.validate_receipt_ledger(ledger)
    expected_nfelo = migrate_nfelo_receipts(legacy, schedule)
    expected_538 = model_receipts(model)
    by_id = {row["forecast_id"]: row for row in ledger["data"]}
    covered = {(row["model_id"], row["game_id"]) for row in ledger["data"]}
    for expected in expected_nfelo + expected_538:
        prior = by_id.get(expected["forecast_id"])
        if prior is not None:
            if prior != expected:
                raise ModelError(f"normalized receipt changed: {expected['forecast_id']}")
        elif (expected["model_id"], expected["game_id"]) not in covered:
            raise ModelError(f"normalized receipt missing: {expected['forecast_id']}")
    if len(expected_nfelo) != 272:
        raise ModelError("normalized nfelo adapter did not preserve all 272 forecasts")


def cmd_refresh(args: argparse.Namespace) -> None:
    schedule = backbone.read_json(args.schedule)
    ledger = backbone.read_json(args.ledger)
    legacy = backbone.read_json(args.legacy_receipts)
    source_commit = schedule["provenance"]["source_commit"]
    official_games = source_bytes(args.official_games, OFFICIAL_GAMES_URL)
    official_initial = source_bytes(args.official_initial, OFFICIAL_INITIAL_URL)
    history = source_bytes(
        args.history_games, HISTORY_URL_TEMPLATE.format(commit=source_commit)
    )
    captured_at = args.captured_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    candidate = build_envelope(schedule, official_games, official_initial, history, captured_at)
    if args.output.exists():
        existing = backbone.read_json(args.output)
        validate_envelope(existing, schedule)
        if existing["integrity"]["input_snapshot_id"] == candidate["integrity"]["input_snapshot_id"]:
            model = existing
        else:
            model = candidate
    else:
        model = candidate
    updated = update_ledger(ledger, legacy, model, schedule)
    validate_public(model, updated, legacy, schedule)
    backbone.write_json(args.output, model)
    backbone.write_json(args.ledger, updated)
    print(
        f"538 Classic: {len(model['data']['forecasts'])} forecasts; "
        f"ledger {len(updated['data'])} rows; input {model['integrity']['input_snapshot_id']}"
    )


def cmd_validate(args: argparse.Namespace) -> None:
    schedule = backbone.read_json(args.schedule)
    model = backbone.read_json(args.output)
    ledger = backbone.read_json(args.ledger)
    legacy = backbone.read_json(args.legacy_receipts)
    validate_public(model, ledger, legacy, schedule)
    counts: dict[str, int] = {}
    for row in ledger["data"]:
        counts[row["model_id"]] = counts.get(row["model_id"], 0) + 1
    print(
        f"validated 538 Classic ({len(model['data']['forecasts'])} current forecasts), "
        f"normalized receipts {counts}"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    refresh = sub.add_parser("refresh", help="reproduce sources and append prospective receipts")
    refresh.add_argument("--schedule", type=Path, default=DEFAULT_SCHEDULE)
    refresh.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    refresh.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    refresh.add_argument("--legacy-receipts", type=Path, default=DEFAULT_LEGACY)
    refresh.add_argument("--official-games", type=Path)
    refresh.add_argument("--official-initial", type=Path)
    refresh.add_argument("--history-games", type=Path)
    refresh.add_argument("--captured-at")
    refresh.set_defaults(func=cmd_refresh)

    validate = sub.add_parser("validate", help="validate public model state and receipts offline")
    validate.add_argument("--schedule", type=Path, default=DEFAULT_SCHEDULE)
    validate.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    validate.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    validate.add_argument("--legacy-receipts", type=Path, default=DEFAULT_LEGACY)
    validate.set_defaults(func=cmd_validate)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    try:
        args.func(args)
    except (ModelError, backbone.ContractError, OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
