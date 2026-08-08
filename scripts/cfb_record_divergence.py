#!/usr/bin/env python3
"""Publish the descriptive baseline for the CFB Fraud Detector roadmap item.

This does not call teams overrated or underrated. It compares two observed 2025
rankings—win percentage and point differential per game—and reports one-score game
records. Schedule strength, play efficiency, turnovers, market value and forward
predictive validation are absent, so the output is a baseline to test, not a verdict.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEAM_GAME = ROOT / "data" / "cfb-team-game.json"
DEFAULT_PROFILES = ROOT / "data" / "cfb-teams.json"
DEFAULT_OUTPUT = ROOT / "data" / "cfb-record-divergence.json"


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(spec.name, module)
    spec.loader.exec_module(module)
    return module


team_results = _load_module("cfb_team_results", ROOT / "scripts" / "cfb_team_results.py")
backbone = team_results.backbone
ContractError = backbone.ContractError


def competition_ranks(values: dict[str, float]) -> dict[str, int]:
    ordered = sorted(values.values(), reverse=True)
    rank = {value: ordered.index(value) + 1 for value in set(ordered)}
    return {slug: rank[value] for slug, value in values.items()}


def build(team_game_envelope: dict[str, Any], profiles_envelope: dict[str, Any]) -> dict[str, Any]:
    team_game = team_game_envelope.get("data")
    profiles = profiles_envelope.get("data")
    if not isinstance(team_game, dict) or team_game.get("scope") != "results-only":
        raise ContractError("cfb-team-game input must be results-only")
    if not isinstance(profiles, dict) or profiles.get("scope") != "observed-results-plus-retrodictive-rating":
        raise ContractError("cfb-teams input has the wrong evidence scope")

    game_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in team_game.get("rows", []):
        if row.get("result") is not None:
            game_rows[row["team_slug"]].append(row)

    profile_by_slug = {row["team_slug"]: row for row in profiles.get("teams", [])}
    win_pct = {slug: row["observed_results"]["win_percentage"] for slug, row in profile_by_slug.items()}
    pd_per_game = {slug: row["observed_results"]["point_differential_per_game"] for slug, row in profile_by_slug.items()}
    record_ranks = competition_ranks(win_pct)
    scoring_ranks = competition_ranks(pd_per_game)

    rows = []
    for slug, profile in profile_by_slug.items():
        observed = profile["observed_results"]
        games = game_rows.get(slug, [])
        if len(games) != observed["games"]:
            raise ContractError(f"completed team-game count disagrees with compact profile: {slug}")
        close = [row for row in games if abs(row["point_differential"]) <= 8]
        close_wins = sum(row["result"] == "win" for row in close)
        close_losses = sum(row["result"] == "loss" for row in close)
        close_ties = sum(row["result"] == "tie" for row in close)
        gap = scoring_ranks[slug] - record_ranks[slug]
        rows.append({
            "team_slug": slug,
            "team": profile["team"],
            "conference": profile["conference"],
            "through_at": observed["through_at"],
            "games": observed["games"],
            "record": observed["record"],
            "win_percentage": observed["win_percentage"],
            "record_rank": record_ranks[slug],
            "point_differential": observed["point_differential"],
            "point_differential_per_game": observed["point_differential_per_game"],
            "scoring_rank": scoring_ranks[slug],
            "record_rank_minus_scoring_rank": record_ranks[slug] - scoring_ranks[slug],
            "record_scoring_rank_gap": gap,
            "descriptive_direction": (
                "record-ahead-of-scoring" if gap > 0 else
                "scoring-ahead-of-record" if gap < 0 else "aligned"
            ),
            "one_score_games": {
                "definition": "absolute final point differential <= 8",
                "games": len(close),
                "wins": close_wins,
                "losses": close_losses,
                "ties": close_ties,
                "win_percentage": None if not close else round((close_wins + 0.5 * close_ties) / len(close), 4),
            },
            "predictive_label": None,
        })
    rows.sort(key=lambda row: (-abs(row["record_scoring_rank_gap"]), row["team_slug"]))
    return {
        "schema_version": 1,
        "season": profiles["season"],
        "status": "descriptive-baseline",
        "inputs": {
            "team_game_snapshot_id": team_game_envelope["integrity"]["snapshot_id"],
            "team_profiles_snapshot_id": profiles_envelope["integrity"]["snapshot_id"],
        },
        "definitions": {
            "record_rank": "Competition rank of observed win percentage, descending; ties share a rank and subsequent positions are skipped.",
            "scoring_rank": "Competition rank of observed point differential per game, descending; ties share a rank and subsequent positions are skipped.",
            "record_scoring_rank_gap": "scoring_rank - record_rank; positive means the observed record ranks better than scoring margin.",
        },
        "predictive_validation": {
            "status": "evaluated-separately",
            "evidence_url": "/data/cfb-record-divergence-validation.json",
            "forward_value_claimed": False,
            "team_labels_permitted": False,
            "remaining_gate": (
                "Freeze the metric in prospective receipts and test whether the gap adds value beyond Elo "
                "and timestamped pregame market observations before permitting current-team labels."
            ),
        },
        "unavailable": [
            "opponent adjustment", "play efficiency", "postgame win expectancy", "turnover variance",
            "fourth-down variance", "timestamped market overvaluation", "talent and availability",
        ],
        "rows": rows,
    }


def make_envelope(payload: dict[str, Any], team_game: dict[str, Any], profiles: dict[str, Any]) -> dict[str, Any]:
    as_of = max(team_game["as_of"], profiles["as_of"])
    return {
        "as_of": as_of,
        "source": (
            "Descriptive join of /data/cfb-team-game.json and /data/cfb-teams.json by "
            f"scripts/cfb_record_divergence.py; inputs {team_game['integrity']['snapshot_id']} and "
            f"{profiles['integrity']['snapshot_id']}."
        ),
        "tier": "labs",
        "graded": False,
        "note": (
            "OBSERVED, DESCRIPTIVE BASELINE ONLY. This is not a Fraud Detector verdict and does not call "
            "any team overrated or underrated. No forward predictive value has been demonstrated."
        ),
        "provenance": {
            "generator": "scripts/cfb_record_divergence.py",
            "inputs": [
                {"url": "/data/cfb-team-game.json", "snapshot_id": team_game["integrity"]["snapshot_id"]},
                {"url": "/data/cfb-teams.json", "snapshot_id": profiles["integrity"]["snapshot_id"]},
            ],
        },
        "integrity": {
            "snapshot_id": backbone.sha256_id(payload),
            "algorithm": "SHA-256 of canonical UTF-8 JSON for the data object (sorted object keys, no insignificant whitespace).",
            "rows": len(payload["rows"]),
        },
        "data": payload,
        "tier_meaning": backbone.TIER_MEANING,
        "built": as_of,
        "canonical_url": "https://datadawgs216.com/data/cfb-record-divergence.json",
    }


def validate_envelope(envelope: dict[str, Any], team_game: dict[str, Any], profiles: dict[str, Any]) -> None:
    data = envelope.get("data")
    if not isinstance(data, dict) or data.get("schema_version") != 1 or data.get("status") != "descriptive-baseline":
        raise ContractError("cfb-record-divergence must be a descriptive schema_version 1 baseline")
    predictive = data.get("predictive_validation", {})
    if (envelope.get("graded") is not False or
            predictive.get("status") != "evaluated-separately" or
            predictive.get("evidence_url") != "/data/cfb-record-divergence-validation.json" or
            predictive.get("forward_value_claimed") is not False or
            predictive.get("team_labels_permitted") is not False):
        raise ContractError("cfb-record-divergence overstates predictive evidence")
    if any(row.get("predictive_label") is not None for row in data.get("rows", [])):
        raise ContractError("cfb-record-divergence cannot publish predictive labels")
    expected = build(team_game, profiles)
    if data != expected:
        raise ContractError("cfb-record-divergence drifts from its published inputs")
    if envelope.get("integrity", {}).get("snapshot_id") != backbone.sha256_id(data):
        raise ContractError("cfb-record-divergence snapshot hash mismatch")
    if envelope["integrity"].get("rows") != len(data["rows"]):
        raise ContractError("cfb-record-divergence row count disagrees")


def cmd_refresh(args: argparse.Namespace) -> int:
    team_game = backbone.read_json(Path(args.team_game))
    profiles = backbone.read_json(Path(args.profiles))
    payload = build(team_game, profiles)
    envelope = make_envelope(payload, team_game, profiles)
    validate_envelope(envelope, team_game, profiles)
    backbone.write_json(Path(args.output), envelope)
    print(f"wrote {args.output}: {len(payload['rows'])} descriptive team rows")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    team_game = backbone.read_json(Path(args.team_game))
    profiles = backbone.read_json(Path(args.profiles))
    validate_envelope(backbone.read_json(Path(args.output)), team_game, profiles)
    print(f"{args.output} satisfies the descriptive record-divergence contract")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text, func in (
        ("refresh", "rebuild the descriptive baseline", cmd_refresh),
        ("validate", "validate the published baseline offline", cmd_validate),
    ):
        command = sub.add_parser(name, help=help_text)
        command.add_argument("--team-game", default=str(DEFAULT_TEAM_GAME))
        command.add_argument("--profiles", default=str(DEFAULT_PROFILES))
        command.add_argument("--output", default=str(DEFAULT_OUTPUT))
        command.set_defaults(func=func)
    args = parser.parse_args()
    try:
        return args.func(args)
    except ContractError as exc:
        print(f"contract violation: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
