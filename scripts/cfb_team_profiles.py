#!/usr/bin/env python3
"""Publish compact CFB team profiles from observed results and dated ratings.

The output is a join, not a new model. Observed 2025 record/score facts stay in a
separate object from the one retrodictive, ungraded Elo value. It is intentionally
small enough for deterministic reads while preserving both input snapshot receipts.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEAM_WEEK = ROOT / "data" / "cfb-team-week.json"
DEFAULT_RATINGS = ROOT / "data" / "cfb-ratings.json"
DEFAULT_OUTPUT = ROOT / "data" / "cfb-teams.json"


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(spec.name, module)
    spec.loader.exec_module(module)
    return module


team_results = _load_module("cfb_team_results", ROOT / "scripts" / "cfb_team_results.py")
ratings_registry = _load_module("cfb_ratings_registry", ROOT / "scripts" / "cfb_ratings_registry.py")
backbone = team_results.backbone
ContractError = backbone.ContractError


def build(team_week_envelope: dict[str, Any], ratings_envelope: dict[str, Any]) -> dict[str, Any]:
    team_week = team_week_envelope.get("data")
    ratings = ratings_envelope.get("data")
    if not isinstance(team_week, dict) or team_week.get("scope") != "results-only":
        raise ContractError("cfb-team-week input must be the results-only public surface")
    if not isinstance(ratings, dict):
        raise ContractError("cfb-ratings input is missing data")

    latest: dict[str, dict[str, Any]] = {}
    for row in team_week.get("rows", []):
        slug = row.get("team_slug")
        if not isinstance(slug, str):
            raise ContractError("cfb-team-week row lacks team_slug")
        prior = latest.get(slug)
        if prior is None or row["through_at"] > prior["through_at"]:
            latest[slug] = row

    teams = []
    identities = team_week.get("teams", {})
    for rating_row in ratings.get("teams", []):
        slug = rating_row["team_slug"]
        period = latest.get(slug)
        identity = identities.get(slug)
        if period is None or not isinstance(identity, dict):
            raise ContractError(f"ratings team missing from team-week results: {slug}")
        if identity.get("division") != "fbs":
            raise ContractError(f"ratings team is not FBS in the result identity map: {slug}")
        if identity.get("team") != rating_row.get("team") or identity.get("conference") != rating_row.get("conference"):
            raise ContractError(f"team identity disagrees across inputs: {slug}")
        observed = period["season_to_date"]
        games = observed["games"]
        teams.append({
            "team_slug": slug,
            "team": rating_row["team"],
            "espn_id": identity.get("espn_id"),
            "division": identity["division"],
            "conference": rating_row["conference"],
            "observed_results": {
                "season": period["season"],
                "through_at": period["through_at"],
                "last_period": period["period_key"],
                **observed,
                "win_percentage": None if games == 0 else round((observed["wins"] + 0.5 * observed["ties"]) / games, 4),
                "points_for_per_game": None if games == 0 else round(observed["points_for"] / games, 3),
                "points_against_per_game": None if games == 0 else round(observed["points_against"] / games, 3),
                "point_differential_per_game": None if games == 0 else round(observed["point_differential"] / games, 3),
            },
            "systems": rating_row["systems"],
        })

    teams.sort(key=lambda row: (row["systems"][ratings_registry.SYSTEM_ID]["rank"], row["team_slug"]))
    return {
        "schema_version": 1,
        "season": ratings["rating_period"]["season"],
        "scope": "observed-results-plus-retrodictive-rating",
        "inputs": {
            "team_week_snapshot_id": team_week_envelope["integrity"]["snapshot_id"],
            "ratings_registry_snapshot_id": ratings_envelope["integrity"]["snapshot_id"],
        },
        "rating_period": ratings["rating_period"],
        "systems": ratings["systems"],
        "teams": teams,
        "consensus": ratings["consensus"],
        "unsupported": [
            "2026 forecast", "current roster or availability", "talent or portal inputs",
            "play-by-play efficiency", "opponent adjustment", "timestamped market comparison",
        ],
    }


def make_envelope(payload: dict[str, Any], team_week: dict[str, Any], ratings: dict[str, Any]) -> dict[str, Any]:
    as_of = max(team_week["as_of"], ratings["as_of"])
    return {
        "as_of": as_of,
        "source": (
            "Compact join of /data/cfb-team-week.json and /data/cfb-ratings.json by "
            f"scripts/cfb_team_profiles.py; inputs {team_week['integrity']['snapshot_id']} and "
            f"{ratings['integrity']['snapshot_id']}."
        ),
        "tier": "labs",
        "graded": False,
        "note": (
            "OBSERVED RESULTS plus one MODELLED, RETRODICTIVE, UNGRADED end-of-2025 Elo rating. "
            "The objects are separated deliberately. This is not a 2026 forecast, consensus, edge or recommendation."
        ),
        "provenance": {
            "generator": "scripts/cfb_team_profiles.py",
            "inputs": [
                {"url": "/data/cfb-team-week.json", "snapshot_id": team_week["integrity"]["snapshot_id"]},
                {"url": "/data/cfb-ratings.json", "snapshot_id": ratings["integrity"]["snapshot_id"]},
            ],
        },
        "integrity": {
            "snapshot_id": backbone.sha256_id(payload),
            "algorithm": "SHA-256 of canonical UTF-8 JSON for the data object (sorted object keys, no insignificant whitespace).",
            "systems": len(payload["systems"]),
            "teams": len(payload["teams"]),
        },
        "data": payload,
        "tier_meaning": backbone.TIER_MEANING,
        "built": as_of,
        "canonical_url": "https://datadawgs216.com/data/cfb-teams.json",
    }


def validate_envelope(envelope: dict[str, Any], team_week: dict[str, Any], ratings: dict[str, Any]) -> None:
    data = envelope.get("data")
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise ContractError("cfb-teams must use schema_version 1")
    if data.get("scope") != "observed-results-plus-retrodictive-rating" or envelope.get("graded") is not False:
        raise ContractError("cfb-teams overstates its evidence scope")
    expected = build(team_week, ratings)
    if data != expected:
        raise ContractError("cfb-teams drifts from its team-week or ratings input")
    if envelope.get("integrity", {}).get("snapshot_id") != backbone.sha256_id(data):
        raise ContractError("cfb-teams snapshot hash mismatch")
    if envelope["integrity"].get("teams") != len(data["teams"]) or envelope["integrity"].get("systems") != len(data["systems"]):
        raise ContractError("cfb-teams integrity counts disagree")
    if data["inputs"].get("team_week_snapshot_id") != team_week["integrity"]["snapshot_id"] or \
       data["inputs"].get("ratings_registry_snapshot_id") != ratings["integrity"]["snapshot_id"]:
        raise ContractError("cfb-teams input receipts drifted")
    if data["consensus"].get("status") != "not-built" or data["consensus"].get("weights") is not None:
        raise ContractError("cfb-teams cannot turn one system into a consensus")


def cmd_refresh(args: argparse.Namespace) -> int:
    team_week = backbone.read_json(Path(args.team_week))
    ratings = backbone.read_json(Path(args.ratings))
    payload = build(team_week, ratings)
    envelope = make_envelope(payload, team_week, ratings)
    validate_envelope(envelope, team_week, ratings)
    backbone.write_json(Path(args.output), envelope)
    print(f"wrote {args.output}: {len(payload['teams'])} compact team profiles")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    team_week = backbone.read_json(Path(args.team_week))
    ratings = backbone.read_json(Path(args.ratings))
    validate_envelope(backbone.read_json(Path(args.output)), team_week, ratings)
    print(f"{args.output} satisfies the compact CFB team profile contract")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text, func in (
        ("refresh", "rebuild compact profiles from published inputs", cmd_refresh),
        ("validate", "validate the published compact profiles offline", cmd_validate),
    ):
        command = sub.add_parser(name, help=help_text)
        command.add_argument("--team-week", default=str(DEFAULT_TEAM_WEEK))
        command.add_argument("--ratings", default=str(DEFAULT_RATINGS))
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
