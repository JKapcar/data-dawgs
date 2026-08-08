#!/usr/bin/env python3
"""Publish the canonical CFB ratings registry (roadmap step 2).

The registry is a normalization boundary, not an ensemble. It gives every rating
system one dated, provenance-locked shape while leaving outputs the source does not
provide as null. The first version contains only the shipped Data Dawgs Elo baseline;
SP+, FPI, SRS, market and future Data Dawgs models remain absent until lawful dated
inputs exist. One system is not a consensus and this file says so mechanically.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ELO = ROOT / "data" / "cfb-elo.json"
DEFAULT_OUTPUT = ROOT / "data" / "cfb-ratings.json"

_SPEC = importlib.util.spec_from_file_location("cfb_elo", ROOT / "scripts" / "cfb_elo.py")
elo = importlib.util.module_from_spec(_SPEC)
sys.modules.setdefault(_SPEC.name, elo)
_SPEC.loader.exec_module(elo)
backbone = elo.backbone
ContractError = backbone.ContractError

SYSTEM_ID = "dd-cfb-elo"
NULLABLE_OUTPUTS = ("expected_margin", "win_probability", "predicted_total")


def build(elo_envelope: dict[str, Any]) -> dict[str, Any]:
    """Normalize the published Elo rows without recomputing or embellishing them."""
    elo.validate_envelope(elo_envelope)
    data = elo_envelope["data"]
    season = data["params"]["evaluation_season"]
    source_field = f"ratings_as_of_end_of_{season}"
    source_rows = data.get(source_field)
    if not isinstance(source_rows, list) or not source_rows:
        raise ContractError(f"cfb-elo is missing {source_field}")
    source_snapshot = elo_envelope["integrity"]["snapshot_id"]

    teams = []
    for rank, row in enumerate(source_rows, start=1):
        teams.append({
            "team_slug": row["team_slug"],
            "team": row["team"],
            "conference": row["conference"],
            "systems": {
                SYSTEM_ID: {
                    "rank": rank,
                    "team_strength": row["rating"],
                    "games_rated": row["games_rated"],
                    "expected_margin": None,
                    "win_probability": None,
                    "predicted_total": None,
                }
            },
        })

    return {
        "schema_version": 1,
        "rating_period": {
            "season": season,
            "label": f"end-of-{season}-season",
            "source_field": source_field,
            "prospective": False,
        },
        "systems": [{
            "system_id": SYSTEM_ID,
            "name": "Data Dawgs CFB Elo baseline",
            "provider": "Data Dawgs",
            "kind": "continuous-rating",
            "feature_family": "game results and margin only",
            "source_snapshot_id": source_snapshot,
            "source_url": "/data/cfb-elo.json",
            "model_card_url": "/data/cfb-model-cards.json",
            "normalization": (
                "Native Elo points are retained as team_strength. Game-context expected margin "
                "and win probability are not team-level source fields, so they remain null."
            ),
            "outputs": {
                "team_strength": {"available": True, "units": "elo-points"},
                "expected_margin": {"available": False, "units": "points"},
                "win_probability": {"available": False, "units": "probability"},
                "predicted_total": {"available": False, "units": "points"},
            },
            "prospective_forecasts_exist": False,
            "graded": False,
        }],
        "teams": teams,
        "consensus": {
            "status": "not-built",
            "system_count": 1,
            "weights": None,
            "reason": (
                "One independent rating cannot form a consensus. Do not create blend weights "
                "until multiple dated systems have prospective error histories."
            ),
        },
    }


def make_envelope(payload: dict[str, Any], elo_envelope: dict[str, Any]) -> dict[str, Any]:
    captured_at = elo_envelope.get("provenance", {}).get("captured_at")
    if not isinstance(captured_at, str) or len(captured_at) < 10:
        raise ContractError("cfb-elo provenance lacks captured_at")
    return {
        "as_of": captured_at[:10],
        "source": (
            "Normalized from /data/cfb-elo.json by scripts/cfb_ratings_registry.py; "
            f"source snapshot {elo_envelope['integrity']['snapshot_id']}."
        ),
        "tier": "labs",
        "graded": False,
        "note": (
            "MODELLED, RETRODICTIVE, UNGRADED. This is a registry contract with one live "
            "baseline, not a consensus or evidence that several models agree. Unsupported "
            "outputs are null rather than inferred. Quote the rating period with every value."
        ),
        "provenance": {
            "generator": "scripts/cfb_ratings_registry.py",
            "captured_at": captured_at,
            "input": "/data/cfb-elo.json",
            "input_snapshot_id": elo_envelope["integrity"]["snapshot_id"],
        },
        "integrity": {
            "snapshot_id": backbone.sha256_id(payload),
            "algorithm": (
                "SHA-256 of canonical UTF-8 JSON for the data object "
                "(sorted object keys, no insignificant whitespace)."
            ),
            "systems": len(payload["systems"]),
            "teams": len(payload["teams"]),
        },
        "data": payload,
        "tier_meaning": backbone.TIER_MEANING,
        "built": captured_at[:10],
        "canonical_url": "https://datadawgs216.com/data/cfb-ratings.json",
    }


def validate_envelope(envelope: dict[str, Any], elo_envelope: dict[str, Any] | None = None) -> None:
    data = envelope.get("data")
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise ContractError("cfb-ratings data must use schema_version 1")
    if envelope.get("graded") is not False:
        raise ContractError("cfb-ratings must remain ungraded until prospective receipts exist")
    if envelope.get("integrity", {}).get("snapshot_id") != backbone.sha256_id(data):
        raise ContractError("cfb-ratings snapshot hash mismatch")

    systems = data.get("systems")
    if not isinstance(systems, list) or not systems:
        raise ContractError("cfb-ratings systems must be a non-empty array")
    system_ids = [system.get("system_id") for system in systems]
    if len(system_ids) != len(set(system_ids)) or any(not value for value in system_ids):
        raise ContractError("cfb-ratings system IDs must be present and unique")
    for system in systems:
        outputs = system.get("outputs")
        if not isinstance(outputs, dict) or set(outputs) != {"team_strength", *NULLABLE_OUTPUTS}:
            raise ContractError(f"{system.get('system_id')} has an invalid output contract")
        if system.get("graded") is not False or system.get("prospective_forecasts_exist") is not False:
            raise ContractError(f"{system.get('system_id')} overstates prospective evidence")

    teams = data.get("teams")
    low, high = backbone.FBS_TEAM_RANGE
    if not isinstance(teams, list) or not low <= len(teams) <= high + 15:
        raise ContractError(f"suspicious registry team count: {len(teams) if isinstance(teams, list) else '?'}")
    slugs = [row.get("team_slug") for row in teams]
    if len(slugs) != len(set(slugs)) or any(not slug for slug in slugs):
        raise ContractError("registry team slugs must be present and unique")
    for row in teams:
        values = row.get("systems")
        if not isinstance(values, dict) or not values:
            raise ContractError(f"{row.get('team_slug')} has no rating systems")
        if not set(values).issubset(system_ids):
            raise ContractError(f"{row.get('team_slug')} references an unknown rating system")
        for system_id, rating in values.items():
            if not isinstance(rating.get("team_strength"), (int, float)):
                raise ContractError(f"{row.get('team_slug')} has invalid {system_id} team strength")
            if any(rating.get(field) is not None for field in NULLABLE_OUTPUTS):
                raise ContractError(f"{row.get('team_slug')} invents unsupported {system_id} output")

    for system_id in system_ids:
        ranks = sorted(row["systems"][system_id]["rank"] for row in teams if system_id in row["systems"])
        if ranks != list(range(1, len(ranks) + 1)):
            raise ContractError(f"{system_id} ranks must be contiguous from 1")

    consensus = data.get("consensus", {})
    if consensus.get("status") != "not-built" or consensus.get("weights") is not None:
        raise ContractError("a one-system registry cannot claim a consensus")
    if consensus.get("system_count") != len(systems):
        raise ContractError("consensus system_count disagrees with systems")

    if elo_envelope is not None:
        elo.validate_envelope(elo_envelope)
        expected_snapshot = elo_envelope["integrity"]["snapshot_id"]
        if envelope.get("provenance", {}).get("input_snapshot_id") != expected_snapshot:
            raise ContractError("registry provenance does not name the current Elo snapshot")
        if systems[0].get("source_snapshot_id") != expected_snapshot:
            raise ContractError("registry system does not name the current Elo snapshot")
        source_field = data.get("rating_period", {}).get("source_field")
        source_rows = elo_envelope["data"].get(source_field)
        if not isinstance(source_rows, list):
            raise ContractError("registry rating_period does not name a current Elo field")
        expected = [(r["team_slug"], r["rating"], r["games_rated"]) for r in source_rows]
        actual = [(r["team_slug"], r["systems"][SYSTEM_ID]["team_strength"],
                   r["systems"][SYSTEM_ID]["games_rated"]) for r in teams]
        if actual != expected:
            raise ContractError("registry rows drift from the published Elo source")


def cmd_refresh(args: argparse.Namespace) -> int:
    elo_envelope = backbone.read_json(Path(args.elo))
    payload = build(elo_envelope)
    envelope = make_envelope(payload, elo_envelope)
    validate_envelope(envelope, elo_envelope)
    backbone.write_json(Path(args.output), envelope)
    print(f"wrote {args.output}: {len(payload['systems'])} system, {len(payload['teams'])} teams")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    elo_envelope = backbone.read_json(Path(args.elo))
    validate_envelope(backbone.read_json(Path(args.output)), elo_envelope)
    print(f"{args.output} satisfies the CFB ratings registry contract")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text, func in (
        ("refresh", "regenerate the registry from published model output", cmd_refresh),
        ("validate", "validate the published registry offline", cmd_validate),
    ):
        command = sub.add_parser(name, help=help_text)
        command.add_argument("--elo", default=str(DEFAULT_ELO))
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
