#!/usr/bin/env python3
"""Build results-only CFB team-game and team-week public surfaces.

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


def cmd_refresh(args: argparse.Namespace) -> int:
    schedule = backbone.read_json(Path(args.schedule))
    team_game_payload = build_team_game(schedule)
    team_game_envelope = make_envelope(team_game_payload, schedule, "team-game")
    validate_team_game(team_game_envelope, schedule)
    team_week_payload = build_team_week(team_game_payload)
    team_week_envelope = make_envelope(team_week_payload, schedule, "team-week")
    validate_team_week(team_week_envelope, team_game_envelope, schedule)
    backbone.write_json(Path(args.team_game), team_game_envelope)
    backbone.write_json(Path(args.team_week), team_week_envelope)
    print(f"wrote {args.team_game}: {len(team_game_payload['rows'])} rows")
    print(f"wrote {args.team_week}: {len(team_week_payload['rows'])} rows")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    schedule = backbone.read_json(Path(args.schedule))
    team_game = backbone.read_json(Path(args.team_game))
    team_week = backbone.read_json(Path(args.team_week))
    validate_team_game(team_game, schedule)
    validate_team_week(team_week, team_game, schedule)
    print(f"{args.team_game} and {args.team_week} satisfy the results-only contracts")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text, func in (
        ("refresh", "rebuild both result surfaces from the canonical schedule", cmd_refresh),
        ("validate", "validate both published result surfaces offline", cmd_validate),
    ):
        command = sub.add_parser(name, help=help_text)
        command.add_argument("--schedule", default=str(DEFAULT_SCHEDULE))
        command.add_argument("--team-game", default=str(DEFAULT_TEAM_GAME))
        command.add_argument("--team-week", default=str(DEFAULT_TEAM_WEEK))
        command.set_defaults(func=func)
    args = parser.parse_args()
    try:
        return args.func(args)
    except ContractError as exc:
        print(f"contract violation: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
