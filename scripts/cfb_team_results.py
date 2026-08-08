#!/usr/bin/env python3
"""Build results-only CFB team-game, team-week and compact latest public surfaces.

These are deterministic views of the locked canonical schedule. They deliberately
do not impersonate the full play-derived roadmap layers: EPA, success, explosiveness,
havoc, opponent adjustment and market performance remain absent until their dated
inputs exist. One schedule game becomes two mirrored team-game rows; team-period rows
then aggregate only observed results, scores, venues and opponents.
"""

from __future__ import annotations

import argparse
import copy
import importlib.util
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCHEDULE = ROOT / "data" / "cfb-schedule.json"
DEFAULT_TEAM_GAME = ROOT / "data" / "cfb-team-game.json"
DEFAULT_TEAM_WEEK = ROOT / "data" / "cfb-team-week.json"
DEFAULT_TEAM_WEEK_LATEST = ROOT / "data" / "cfb-team-week-latest.json"
DEFAULT_GAMES_LATEST = ROOT / "data" / "cfb-games-latest.json"

_SPEC = importlib.util.spec_from_file_location(
    "cfb_data_backbone", ROOT / "scripts" / "cfb_data_backbone.py"
)
backbone = importlib.util.module_from_spec(_SPEC)
sys.modules.setdefault(_SPEC.name, backbone)
_SPEC.loader.exec_module(backbone)
ContractError = backbone.ContractError

UNAVAILABLE_METRICS = [
    "epa_per_play", "offensive_epa", "defensive_epa", "dropback_epa", "rush_epa",
    "success_rate", "explosive_rate", "havoc", "early_down_epa",
    "late_down_success", "garbage_time_filtered_metrics", "opponent_adjusted_metrics",
    "strength_of_schedule", "market_performance", "closing_line_error",
]


def _team_fact(game: dict[str, Any], side: str) -> dict[str, Any]:
    return {
        "team": game[f"{side}_team"],
        "espn_id": game[f"{side}_espn_id"],
        "division": game[f"{side}_division"],
        "conference": game[f"{side}_conference"],
    }


def _result(points_for: int | None, points_against: int | None) -> str | None:
    if points_for is None or points_against is None:
        return None
    return "win" if points_for > points_against else "loss" if points_for < points_against else "tie"


def build_team_game(schedule: dict[str, Any]) -> dict[str, Any]:
    """Expand every canonical game to two exact, mirrored team rows."""
    backbone.validate_schedule_envelope(schedule)
    games = schedule["data"]["games"]
    teams: dict[str, dict[str, Any]] = {}
    rows: list[dict[str, Any]] = []
    for game in games:
        for side, opponent_side in (("home", "away"), ("away", "home")):
            slug = game[f"{side}_team_slug"]
            facts = _team_fact(game, side)
            if slug in teams and teams[slug] != facts:
                raise ContractError(f"team identity drift for {slug}")
            teams[slug] = facts
            points_for = game[f"{side}_points"]
            points_against = game[f"{opponent_side}_points"]
            rows.append({
                "team_game_id": f"{game['game_id']}::{slug}",
                "game_id": game["game_id"],
                "upstream_game_id": game["upstream_game_id"],
                "season": game["season"],
                "season_type": game["season_type"],
                "week": game["week"],
                "kickoff_at": game["kickoff_at"],
                "status": game["status"],
                "team_slug": slug,
                "opponent_slug": game[f"{opponent_side}_team_slug"],
                "team_side": side,
                "site": "neutral" if game["neutral_site"] else side,
                "neutral_site": game["neutral_site"],
                "conference_game": game["conference_game"],
                "points_for": points_for,
                "points_against": points_against,
                "point_differential": None if points_for is None or points_against is None else points_for - points_against,
                "result": _result(points_for, points_against),
            })
    rows.sort(key=lambda row: (row["kickoff_at"], row["game_id"], row["team_slug"]))
    return {
        "schema_version": 1,
        "season": schedule["data"]["season"],
        "scope": "results-only",
        "input_schedule_snapshot_id": schedule["integrity"]["snapshot_id"],
        "teams": dict(sorted(teams.items())),
        "unavailable_metrics": UNAVAILABLE_METRICS,
        "rows": rows,
    }


def build_team_week(team_game: dict[str, Any]) -> dict[str, Any]:
    """Aggregate observed team-game facts by season type and upstream week label."""
    rows = team_game.get("rows")
    teams = team_game.get("teams")
    if not isinstance(rows, list) or not isinstance(teams, dict):
        raise ContractError("team-game payload must contain rows and teams")
    grouped: dict[tuple[int, str, int, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[(row["season"], row["season_type"], row["week"], row["team_slug"])].append(row)

    by_team: dict[str, list[tuple[tuple[int, str, int, str], list[dict[str, Any]]]]] = defaultdict(list)
    for key, period_rows in grouped.items():
        period_rows.sort(key=lambda row: (row["kickoff_at"], row["game_id"]))
        by_team[key[3]].append((key, period_rows))

    output: list[dict[str, Any]] = []
    for team_slug, periods in by_team.items():
        periods.sort(key=lambda item: (item[1][-1]["kickoff_at"], item[0][1], item[0][2]))
        totals = {"games": 0, "wins": 0, "losses": 0, "ties": 0, "points_for": 0, "points_against": 0}
        for (season, season_type, week, _), period_rows in periods:
            final = [row for row in period_rows if row["result"] is not None]
            period = {
                "games": len(final),
                "wins": sum(row["result"] == "win" for row in final),
                "losses": sum(row["result"] == "loss" for row in final),
                "ties": sum(row["result"] == "tie" for row in final),
                "points_for": sum(row["points_for"] for row in final),
                "points_against": sum(row["points_against"] for row in final),
            }
            for field in totals:
                totals[field] += period[field]
            opponent_slugs = [row["opponent_slug"] for row in period_rows]
            output.append({
                "team_period_id": f"{season}_{season_type}_{week:02d}::{team_slug}",
                "season": season,
                "season_type": season_type,
                "week": week,
                "period_key": f"{season_type}-{week:02d}",
                "through_at": period_rows[-1]["kickoff_at"],
                "team_slug": team_slug,
                "division": teams[team_slug]["division"],
                "conference": teams[team_slug]["conference"],
                "scheduled_games_this_period": len(period_rows),
                "opponent_slugs": opponent_slugs,
                "home_games": sum(row["site"] == "home" for row in period_rows),
                "away_games": sum(row["site"] == "away" for row in period_rows),
                "neutral_games": sum(row["site"] == "neutral" for row in period_rows),
                "fbs_opponents": sum(teams[row["opponent_slug"]]["division"] == "fbs" for row in period_rows),
                "period": {
                    **period,
                    "point_differential": period["points_for"] - period["points_against"],
                },
                "season_to_date": {
                    **totals,
                    "point_differential": totals["points_for"] - totals["points_against"],
                    "record": f"{totals['wins']}-{totals['losses']}-{totals['ties']}",
                },
            })
    output.sort(key=lambda row: (row["through_at"], row["team_slug"], row["period_key"]))
    return {
        "schema_version": 1,
        "season": team_game["season"],
        "scope": "results-only",
        "input_schedule_snapshot_id": team_game["input_schedule_snapshot_id"],
        "input_team_game_snapshot_id": backbone.sha256_id(team_game),
        "teams": copy.deepcopy(teams),
        "period_definition": (
            "One row per team, season_type and upstream week label when at least one game is scheduled. "
            "Postseason week 1 is distinct from regular-season week 1. A period may contain multiple games."
        ),
        "unavailable_metrics": UNAVAILABLE_METRICS,
        "rows": output,
    }


def build_team_week_latest(team_week_envelope: dict[str, Any]) -> dict[str, Any]:
    """Select one latest team-period row per canonical team without recomputing facts."""
    data = team_week_envelope.get("data")
    integrity = team_week_envelope.get("integrity")
    if not isinstance(data, dict) or not isinstance(integrity, dict):
        raise ContractError("team-week envelope must contain data and integrity")
    rows = data.get("rows")
    teams = data.get("teams")
    snapshot_id = integrity.get("snapshot_id")
    if not isinstance(rows, list) or not isinstance(teams, dict) or not isinstance(snapshot_id, str):
        raise ContractError("team-week envelope lacks rows, teams or a snapshot id")

    latest: dict[str, dict[str, Any]] = {}
    for row in rows:
        slug = row.get("team_slug")
        if slug not in teams:
            raise ContractError(f"team-week row names an unknown team: {slug}")
        prior = latest.get(slug)
        if prior is None or (row["through_at"], row["team_period_id"]) > (
            prior["through_at"], prior["team_period_id"]
        ):
            latest[slug] = row
    if set(latest) != set(teams):
        missing = sorted(set(teams) - set(latest))
        raise ContractError(f"team-week latest selection lacks rows for: {', '.join(missing[:10])}")

    output = []
    for slug in sorted(latest):
        row = latest[slug]
        facts = teams[slug]
        output.append({
            "team_slug": slug,
            "team": facts["team"],
            "espn_id": facts["espn_id"],
            "division": facts["division"],
            "conference": facts["conference"],
            "through_at": row["through_at"],
            "latest_period": {
                "team_period_id": row["team_period_id"],
                "season_type": row["season_type"],
                "week": row["week"],
                "period_key": row["period_key"],
                "scheduled_games": row["scheduled_games_this_period"],
                "opponent_slugs": copy.deepcopy(row["opponent_slugs"]),
                "home_games": row["home_games"],
                "away_games": row["away_games"],
                "neutral_games": row["neutral_games"],
                "fbs_opponents": row["fbs_opponents"],
                "observed_result": copy.deepcopy(row["period"]),
            },
            "season_to_date": copy.deepcopy(row["season_to_date"]),
        })
    return {
        "schema_version": 1,
        "season": data["season"],
        "scope": "results-only",
        "input_schedule_snapshot_id": data["input_schedule_snapshot_id"],
        "input_team_week_snapshot_id": snapshot_id,
        "selection": "Maximum (through_at, team_period_id) per team from /data/cfb-team-week.json.",
        "coverage": {
            "schedule_scope": "Canonical 2025 games involving at least one FBS team.",
            "fbs_team_records": "Complete within the canonical FBS-involved schedule.",
            "fcs_team_records": "Only games against FBS opponents; not complete FCS season records.",
        },
        "unavailable_metrics": copy.deepcopy(data["unavailable_metrics"]),
        "rows": output,
    }


def build_games_latest(team_game_envelope: dict[str, Any]) -> dict[str, Any]:
    """Select each FBS team's latest completed canonical game from its mirrored rows."""
    data = team_game_envelope.get("data")
    integrity = team_game_envelope.get("integrity")
    if not isinstance(data, dict) or not isinstance(integrity, dict):
        raise ContractError("team-game envelope must contain data and integrity")
    rows = data.get("rows")
    teams = data.get("teams")
    snapshot_id = integrity.get("snapshot_id")
    if not isinstance(rows, list) or not isinstance(teams, dict) or not isinstance(snapshot_id, str):
        raise ContractError("team-game envelope lacks rows, teams or a snapshot id")

    eligible = sorted(slug for slug, facts in teams.items() if facts.get("division") == "fbs")
    eligible_set = set(eligible)
    latest: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row.get("team_slug") not in eligible_set or row.get("status") != "final" or row.get("result") is None:
            continue
        slug = row["team_slug"]
        prior = latest.get(slug)
        if prior is None or (row["kickoff_at"], row["team_game_id"]) > (
            prior["kickoff_at"], prior["team_game_id"]
        ):
            latest[slug] = row

    output = []
    for slug in sorted(latest):
        row = latest[slug]
        facts = teams[slug]
        opponent = teams[row["opponent_slug"]]
        output.append({
            "team_slug": slug,
            "team": facts["team"],
            "espn_id": facts["espn_id"],
            "conference": facts["conference"],
            "latest_completed_game": {
                "team_game_id": row["team_game_id"],
                "game_id": row["game_id"],
                "upstream_game_id": row["upstream_game_id"],
                "season_type": row["season_type"],
                "week": row["week"],
                "kickoff_at": row["kickoff_at"],
                "opponent_slug": row["opponent_slug"],
                "opponent": opponent["team"],
                "opponent_division": opponent["division"],
                "opponent_conference": opponent["conference"],
                "team_side": row["team_side"],
                "site": row["site"],
                "neutral_site": row["neutral_site"],
                "conference_game": row["conference_game"],
                "points_for": row["points_for"],
                "points_against": row["points_against"],
                "point_differential": row["point_differential"],
                "result": row["result"],
            },
        })
    missing = sorted(eligible_set - set(latest))
    return {
        "schema_version": 1,
        "season": data["season"],
        "scope": "observed-final-results-only",
        "input_schedule_snapshot_id": data["input_schedule_snapshot_id"],
        "input_team_game_snapshot_id": snapshot_id,
        "selection": "Maximum (kickoff_at, team_game_id) completed row per FBS team from /data/cfb-team-game.json.",
        "coverage": {
            "team_scope": "FBS teams present in the canonical FBS-involved schedule.",
            "final_games_only": True,
            "one_row_per_represented_team": True,
            "mirrored_game_can_appear_for_two_teams": True,
            "eligible_fbs_teams": len(eligible),
            "represented_teams": len(output),
            "teams_without_a_completed_game": missing,
        },
        "unavailable_metrics": copy.deepcopy(data["unavailable_metrics"]),
        "rows": output,
    }


def make_envelope(payload: dict[str, Any], schedule: dict[str, Any], kind: str) -> dict[str, Any]:
    captured_at = schedule.get("provenance", {}).get("captured_at")
    if not isinstance(captured_at, str) or len(captured_at) < 10:
        raise ContractError("schedule provenance lacks captured_at")
    label = "team-game" if kind == "team-game" else "team-week"
    return {
        "as_of": schedule["as_of"],
        "source": (
            f"Results-only {label} derivation from /data/cfb-schedule.json by "
            f"scripts/cfb_team_results.py; source snapshot {schedule['integrity']['snapshot_id']}."
        ),
        "tier": "labs",
        "graded": False,
        "note": (
            "OBSERVED RESULTS ONLY. Scores, opponents, venue and record are deterministic schedule facts. "
            "No play-by-play, EPA, success, opponent adjustment, market performance or predictive claim is present."
        ),
        "provenance": {
            "generator": "scripts/cfb_team_results.py",
            "captured_at": captured_at,
            "input": "/data/cfb-schedule.json",
            "input_snapshot_id": schedule["integrity"]["snapshot_id"],
        },
        "integrity": {
            "snapshot_id": backbone.sha256_id(payload),
            "algorithm": "SHA-256 of canonical UTF-8 JSON for the data object (sorted object keys, no insignificant whitespace).",
            "rows": len(payload["rows"]),
            "teams": len(payload["teams"]),
        },
        "data": payload,
        "tier_meaning": backbone.TIER_MEANING,
        "built": schedule["as_of"],
        "canonical_url": f"https://datadawgs216.com/data/cfb-{label}.json",
    }


def make_latest_envelope(
    payload: dict[str, Any], schedule: dict[str, Any], team_week_envelope: dict[str, Any]
) -> dict[str, Any]:
    captured_at = schedule.get("provenance", {}).get("captured_at")
    if not isinstance(captured_at, str) or len(captured_at) < 10:
        raise ContractError("schedule provenance lacks captured_at")
    team_week_snapshot = team_week_envelope.get("integrity", {}).get("snapshot_id")
    if not isinstance(team_week_snapshot, str):
        raise ContractError("team-week envelope lacks a snapshot id")
    return {
        "as_of": schedule["as_of"],
        "source": (
            "Compact latest-team selection from /data/cfb-team-week.json by "
            f"scripts/cfb_team_results.py; source snapshot {team_week_snapshot}."
        ),
        "tier": "labs",
        "graded": False,
        "note": (
            "OBSERVED RESULTS ONLY. One latest schedule-derived period per team plus season-to-date record and "
            "scoring. No play-by-play, EPA, opponent adjustment, market performance or predictive claim is present."
        ),
        "provenance": {
            "generator": "scripts/cfb_team_results.py",
            "captured_at": captured_at,
            "input": "/data/cfb-team-week.json",
            "input_snapshot_id": team_week_snapshot,
            "schedule_snapshot_id": schedule["integrity"]["snapshot_id"],
        },
        "integrity": {
            "snapshot_id": backbone.sha256_id(payload),
            "algorithm": "SHA-256 of canonical UTF-8 JSON for the data object (sorted object keys, no insignificant whitespace).",
            "rows": len(payload["rows"]),
            "teams": len(payload["rows"]),
        },
        "data": payload,
        "tier_meaning": backbone.TIER_MEANING,
        "built": schedule["as_of"],
        "canonical_url": "https://datadawgs216.com/data/cfb-team-week-latest.json",
    }


def make_games_latest_envelope(
    payload: dict[str, Any], schedule: dict[str, Any], team_game_envelope: dict[str, Any]
) -> dict[str, Any]:
    captured_at = schedule.get("provenance", {}).get("captured_at")
    if not isinstance(captured_at, str) or len(captured_at) < 10:
        raise ContractError("schedule provenance lacks captured_at")
    team_game_snapshot = team_game_envelope.get("integrity", {}).get("snapshot_id")
    if not isinstance(team_game_snapshot, str):
        raise ContractError("team-game envelope lacks a snapshot id")
    return {
        "as_of": schedule["as_of"],
        "source": (
            "Compact latest-completed-game-per-FBS-team selection from /data/cfb-team-game.json by "
            f"scripts/cfb_team_results.py; source snapshot {team_game_snapshot}."
        ),
        "tier": "labs",
        "graded": False,
        "note": (
            "OBSERVED RESULTS ONLY. Final games only; one latest completed canonical game per represented FBS team. "
            "This is dated 2025 history, not current 2026 form, a forecast or a model grade."
        ),
        "provenance": {
            "generator": "scripts/cfb_team_results.py",
            "captured_at": captured_at,
            "input": "/data/cfb-team-game.json",
            "input_snapshot_id": team_game_snapshot,
            "schedule_snapshot_id": schedule["integrity"]["snapshot_id"],
        },
        "integrity": {
            "snapshot_id": backbone.sha256_id(payload),
            "algorithm": "SHA-256 of canonical UTF-8 JSON for the data object (sorted object keys, no insignificant whitespace).",
            "rows": len(payload["rows"]),
            "teams": len(payload["rows"]),
        },
        "data": payload,
        "tier_meaning": backbone.TIER_MEANING,
        "built": schedule["as_of"],
        "canonical_url": "https://datadawgs216.com/data/cfb-games-latest.json",
    }


def validate_team_game(envelope: dict[str, Any], schedule: dict[str, Any]) -> None:
    backbone.validate_schedule_envelope(schedule)
    data = envelope.get("data")
    if not isinstance(data, dict) or data.get("schema_version") != 1 or data.get("scope") != "results-only":
        raise ContractError("cfb-team-game must be a results-only schema_version 1 payload")
    if envelope.get("graded") is not False or data.get("unavailable_metrics") != UNAVAILABLE_METRICS:
        raise ContractError("cfb-team-game overstates its evidence scope")
    if envelope.get("provenance", {}).get("input_snapshot_id") != schedule["integrity"]["snapshot_id"]:
        raise ContractError("cfb-team-game provenance does not name the current schedule snapshot")
    expected = build_team_game(schedule)
    if data != expected:
        raise ContractError("cfb-team-game rows drift from the canonical schedule")
    if envelope.get("integrity", {}).get("snapshot_id") != backbone.sha256_id(data):
        raise ContractError("cfb-team-game snapshot hash mismatch")
    if envelope["integrity"].get("rows") != len(data["rows"]) or len(data["rows"]) != 2 * len(schedule["data"]["games"]):
        raise ContractError("cfb-team-game row count must be exactly twice the game count")


def validate_team_week(envelope: dict[str, Any], team_game_envelope: dict[str, Any], schedule: dict[str, Any]) -> None:
    validate_team_game(team_game_envelope, schedule)
    data = envelope.get("data")
    if not isinstance(data, dict) or data.get("schema_version") != 1 or data.get("scope") != "results-only":
        raise ContractError("cfb-team-week must be a results-only schema_version 1 payload")
    if envelope.get("graded") is not False or data.get("unavailable_metrics") != UNAVAILABLE_METRICS:
        raise ContractError("cfb-team-week overstates its evidence scope")
    if envelope.get("provenance", {}).get("input_snapshot_id") != schedule["integrity"]["snapshot_id"]:
        raise ContractError("cfb-team-week provenance does not name the current schedule snapshot")
    expected = build_team_week(team_game_envelope["data"])
    if data != expected:
        raise ContractError("cfb-team-week rows drift from the team-game source")
    if envelope.get("integrity", {}).get("snapshot_id") != backbone.sha256_id(data):
        raise ContractError("cfb-team-week snapshot hash mismatch")
    if envelope["integrity"].get("rows") != len(data["rows"]):
        raise ContractError("cfb-team-week integrity row count disagrees")


def validate_team_week_latest(
    envelope: dict[str, Any], team_week_envelope: dict[str, Any],
    team_game_envelope: dict[str, Any], schedule: dict[str, Any]
) -> None:
    validate_team_week(team_week_envelope, team_game_envelope, schedule)
    data = envelope.get("data")
    if not isinstance(data, dict) or data.get("schema_version") != 1 or data.get("scope") != "results-only":
        raise ContractError("cfb-team-week-latest must be a results-only schema_version 1 payload")
    if envelope.get("graded") is not False or data.get("unavailable_metrics") != UNAVAILABLE_METRICS:
        raise ContractError("cfb-team-week-latest overstates its evidence scope")
    team_week_snapshot = team_week_envelope["integrity"]["snapshot_id"]
    if envelope.get("provenance", {}).get("input_snapshot_id") != team_week_snapshot:
        raise ContractError("cfb-team-week-latest provenance does not name the current team-week snapshot")
    expected = build_team_week_latest(team_week_envelope)
    if data != expected:
        raise ContractError("cfb-team-week-latest rows drift from the team-week source")
    if envelope.get("integrity", {}).get("snapshot_id") != backbone.sha256_id(data):
        raise ContractError("cfb-team-week-latest snapshot hash mismatch")
    row_count = len(data["rows"])
    if envelope["integrity"].get("rows") != row_count or envelope["integrity"].get("teams") != row_count:
        raise ContractError("cfb-team-week-latest integrity row or team count disagrees")
    if row_count != len(team_week_envelope["data"]["teams"]):
        raise ContractError("cfb-team-week-latest must contain exactly one row per team")


def validate_games_latest(
    envelope: dict[str, Any], team_game_envelope: dict[str, Any], schedule: dict[str, Any]
) -> None:
    validate_team_game(team_game_envelope, schedule)
    data = envelope.get("data")
    if not isinstance(data, dict) or data.get("schema_version") != 1 or data.get("scope") != "observed-final-results-only":
        raise ContractError("cfb-games-latest must be an observed-final-results-only schema_version 1 payload")
    if envelope.get("graded") is not False or data.get("unavailable_metrics") != UNAVAILABLE_METRICS:
        raise ContractError("cfb-games-latest overstates its evidence scope")
    team_game_snapshot = team_game_envelope["integrity"]["snapshot_id"]
    if envelope.get("provenance", {}).get("input_snapshot_id") != team_game_snapshot:
        raise ContractError("cfb-games-latest provenance does not name the current team-game snapshot")
    expected = build_games_latest(team_game_envelope)
    if data != expected:
        raise ContractError("cfb-games-latest rows drift from the team-game source")
    if envelope.get("integrity", {}).get("snapshot_id") != backbone.sha256_id(data):
        raise ContractError("cfb-games-latest snapshot hash mismatch")
    rows = data["rows"]
    if envelope["integrity"].get("rows") != len(rows) or envelope["integrity"].get("teams") != len(rows):
        raise ContractError("cfb-games-latest integrity row or team count disagrees")
    if len({row["team_slug"] for row in rows}) != len(rows):
        raise ContractError("cfb-games-latest contains duplicate team rows")
    if data["coverage"].get("represented_teams") != len(rows):
        raise ContractError("cfb-games-latest coverage count disagrees")


def cmd_refresh(args: argparse.Namespace) -> int:
    schedule = backbone.read_json(Path(args.schedule))
    team_game_payload = build_team_game(schedule)
    team_game_envelope = make_envelope(team_game_payload, schedule, "team-game")
    validate_team_game(team_game_envelope, schedule)
    team_week_payload = build_team_week(team_game_payload)
    team_week_envelope = make_envelope(team_week_payload, schedule, "team-week")
    validate_team_week(team_week_envelope, team_game_envelope, schedule)
    latest_payload = build_team_week_latest(team_week_envelope)
    latest_envelope = make_latest_envelope(latest_payload, schedule, team_week_envelope)
    validate_team_week_latest(latest_envelope, team_week_envelope, team_game_envelope, schedule)
    games_latest_payload = build_games_latest(team_game_envelope)
    games_latest_envelope = make_games_latest_envelope(games_latest_payload, schedule, team_game_envelope)
    validate_games_latest(games_latest_envelope, team_game_envelope, schedule)
    backbone.write_json(Path(args.team_game), team_game_envelope)
    backbone.write_json(Path(args.team_week), team_week_envelope)
    backbone.write_json(Path(args.team_week_latest), latest_envelope)
    backbone.write_json(Path(args.games_latest), games_latest_envelope)
    print(f"wrote {args.team_game}: {len(team_game_payload['rows'])} rows")
    print(f"wrote {args.team_week}: {len(team_week_payload['rows'])} rows")
    print(f"wrote {args.team_week_latest}: {len(latest_payload['rows'])} rows")
    print(f"wrote {args.games_latest}: {len(games_latest_payload['rows'])} rows")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    schedule = backbone.read_json(Path(args.schedule))
    team_game = backbone.read_json(Path(args.team_game))
    team_week = backbone.read_json(Path(args.team_week))
    latest = backbone.read_json(Path(args.team_week_latest))
    games_latest = backbone.read_json(Path(args.games_latest))
    validate_team_game(team_game, schedule)
    validate_team_week(team_week, team_game, schedule)
    validate_team_week_latest(latest, team_week, team_game, schedule)
    validate_games_latest(games_latest, team_game, schedule)
    print(f"{args.team_game}, {args.team_week}, {args.team_week_latest} and {args.games_latest} satisfy the results-only contracts")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text, func in (
        ("refresh", "rebuild all result surfaces from the canonical schedule", cmd_refresh),
        ("validate", "validate all published result surfaces offline", cmd_validate),
    ):
        command = sub.add_parser(name, help=help_text)
        command.add_argument("--schedule", default=str(DEFAULT_SCHEDULE))
        command.add_argument("--team-game", default=str(DEFAULT_TEAM_GAME))
        command.add_argument("--team-week", default=str(DEFAULT_TEAM_WEEK))
        command.add_argument("--team-week-latest", default=str(DEFAULT_TEAM_WEEK_LATEST))
        command.add_argument("--games-latest", default=str(DEFAULT_GAMES_LATEST))
        command.set_defaults(func=func)
    args = parser.parse_args()
    try:
        return args.func(args)
    except ContractError as exc:
        print(f"contract violation: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
