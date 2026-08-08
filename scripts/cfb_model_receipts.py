#!/usr/bin/env python3
"""Create and protect the append-only CFB prospective forecast receipt ledger.

The public ledger starts empty because every currently published CFB game is final.
That emptiness is evidence: no CFB forecast has yet been frozen before kickoff. The
append path is built now so the first 2026 forecast cannot quietly become a backtest.
It validates the canonical schedule, exact input snapshots, issue time, game identity
and optional pregame market observation before appending an immutable row.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import math
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LEDGER = ROOT / "data" / "cfb-model-receipts.json"
DEFAULT_SCHEDULE = ROOT / "data" / "cfb-schedule.json"
DEFAULT_RATINGS = ROOT / "data" / "cfb-ratings.json"
DEFAULT_MODEL_CARDS = ROOT / "data" / "cfb-model-cards.json"

_SPEC = importlib.util.spec_from_file_location(
    "cfb_data_backbone", ROOT / "scripts" / "cfb_data_backbone.py"
)
backbone = importlib.util.module_from_spec(_SPEC)
sys.modules.setdefault(_SPEC.name, backbone)
_SPEC.loader.exec_module(backbone)
ContractError = backbone.ContractError

SHA256_RE = re.compile(r"sha256:[0-9a-f]{64}")
COMMIT_RE = re.compile(r"[0-9a-f]{40,64}")
SLUG_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
REQUIRED_FIELDS = {
    "forecast_id", "model_id", "model_version", "game_id", "season", "week",
    "kickoff_at", "issued_at", "forecast_status", "grading_status",
    "schedule_snapshot_id", "input_snapshot_ids", "home_team", "home_team_slug",
    "away_team", "away_team_slug", "home_win_probability", "expected_margin_home",
    "predicted_total", "market_context", "assumptions", "source_engine", "source_commit",
}


def parse_timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise ContractError(f"{field} must be a non-empty ISO-8601 timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError(f"invalid {field}: {value!r}") from exc
    if parsed.tzinfo is None:
        raise ContractError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def finite_or_null(value: Any, field: str) -> None:
    if value is None:
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ContractError(f"{field} must be finite or null")


def validate_receipt(receipt: dict[str, Any]) -> None:
    missing = REQUIRED_FIELDS - set(receipt)
    if missing:
        raise ContractError(f"receipt missing fields: {', '.join(sorted(missing))}")
    if not isinstance(receipt["forecast_id"], str) or not receipt["forecast_id"]:
        raise ContractError("forecast_id must be a non-empty string")
    if not SLUG_RE.fullmatch(str(receipt["model_id"])):
        raise ContractError("model_id must be a lowercase slug")
    if not isinstance(receipt["model_version"], str) or not receipt["model_version"]:
        raise ContractError("model_version must be a non-empty string")
    if isinstance(receipt["season"], bool) or not isinstance(receipt["season"], int):
        raise ContractError("season must be an integer")
    if isinstance(receipt["week"], bool) or not isinstance(receipt["week"], int) or not 0 <= receipt["week"] <= 20:
        raise ContractError("week must be an integer from 0 through 20")
    for field in ("home_team", "away_team"):
        if not isinstance(receipt[field], str) or not receipt[field]:
            raise ContractError(f"{field} must be a non-empty string")
    for field in ("home_team_slug", "away_team_slug"):
        if not SLUG_RE.fullmatch(str(receipt[field])):
            raise ContractError(f"{field} must be a lowercase slug")
    if receipt["forecast_status"] != "prospective":
        raise ContractError("CFB receipt ledger accepts prospective forecasts only")
    if receipt["grading_status"] != "ungraded":
        raise ContractError("immutable forecast receipts remain ungraded; outcomes belong in a grading surface")
    kickoff = parse_timestamp(receipt["kickoff_at"], "kickoff_at")
    issued = parse_timestamp(receipt["issued_at"], "issued_at")
    if issued >= kickoff:
        raise ContractError("prospective receipt must be issued before kickoff")
    probability = receipt["home_win_probability"]
    if isinstance(probability, bool) or not isinstance(probability, (int, float)) or not 0 <= probability <= 1:
        raise ContractError("home_win_probability must be in [0,1]")
    finite_or_null(receipt["expected_margin_home"], "expected_margin_home")
    finite_or_null(receipt["predicted_total"], "predicted_total")
    if not SHA256_RE.fullmatch(str(receipt["schedule_snapshot_id"])):
        raise ContractError("schedule_snapshot_id must be a sha256 identifier")
    snapshots = receipt["input_snapshot_ids"]
    if not isinstance(snapshots, dict) or not snapshots:
        raise ContractError("input_snapshot_ids must be a non-empty object")
    if {"ratings_registry", "model_cards"} - set(snapshots):
        raise ContractError("input_snapshot_ids must name ratings_registry and model_cards")
    for name, value in snapshots.items():
        if not SLUG_RE.fullmatch(str(name).replace("_", "-")) or not SHA256_RE.fullmatch(str(value)):
            raise ContractError(f"invalid input snapshot {name}")
    if not isinstance(receipt["assumptions"], list) or not all(
        isinstance(value, str) and value for value in receipt["assumptions"]
    ):
        raise ContractError("assumptions must be an array of non-empty strings")
    if not isinstance(receipt["source_engine"], str) or not receipt["source_engine"]:
        raise ContractError("source_engine must be named")
    if not COMMIT_RE.fullmatch(str(receipt["source_commit"])):
        raise ContractError("source_commit must be an exact commit SHA")

    market = receipt["market_context"]
    if market is not None:
        if not isinstance(market, dict):
            raise ContractError("market_context must be null or an object")
        required = {"provider", "captured_at", "receipt_snapshot_id", "home_probability_no_vig"}
        if required - set(market):
            raise ContractError("market_context is missing provenance fields")
        if not isinstance(market["provider"], str) or not market["provider"]:
            raise ContractError("market_context.provider must be named")
        captured = parse_timestamp(market["captured_at"], "market_context.captured_at")
        if captured > issued or captured >= kickoff:
            raise ContractError("market context must have been observed before issue time and kickoff")
        if not SHA256_RE.fullmatch(str(market["receipt_snapshot_id"])):
            raise ContractError("market receipt_snapshot_id must be a sha256 identifier")
        market_p = market["home_probability_no_vig"]
        if isinstance(market_p, bool) or not isinstance(market_p, (int, float)) or not 0 <= market_p <= 1:
            raise ContractError("market home_probability_no_vig must be in [0,1]")


def ledger_hash(receipts: list[dict[str, Any]]) -> str:
    canonical = "\n".join(backbone.canonical_json(receipt) for receipt in receipts)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate_ledger(envelope: dict[str, Any]) -> None:
    receipts = envelope.get("data")
    if not isinstance(receipts, list):
        raise ContractError("CFB receipt ledger data must be an array")
    if envelope.get("graded") is not False:
        raise ContractError("CFB receipt ledger is not itself a grading surface")
    ids: set[str] = set()
    for receipt in receipts:
        if not isinstance(receipt, dict):
            raise ContractError("every CFB receipt must be an object")
        validate_receipt(receipt)
        if receipt["forecast_id"] in ids:
            raise ContractError(f"duplicate forecast_id: {receipt['forecast_id']}")
        ids.add(receipt["forecast_id"])
    integrity = envelope.get("integrity", {})
    expected = ledger_hash(receipts)
    if integrity.get("sha256") != expected or integrity.get("snapshot_id") != "sha256:" + expected:
        raise ContractError("CFB receipt ledger hash does not match canonical rows")
    if integrity.get("rows") != len(receipts):
        raise ContractError("CFB receipt ledger row count does not match integrity.rows")


def make_empty_ledger(captured_at: str) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    digest = ledger_hash(rows)
    return {
        "as_of": captured_at[:10],
        "source": "Initialized by scripts/cfb_model_receipts.py; no forecast rows existed at initialization.",
        "tier": "labs",
        "graded": False,
        "note": (
            "EMPTY BY DESIGN. No CFB forecast has yet been frozen before kickoff. This file "
            "publishes the append-only prospective receipt contract without manufacturing a "
            "backtest row or implying that the 2025 completed season was forecast live."
        ),
        "provenance": {"generator": "scripts/cfb_model_receipts.py", "captured_at": captured_at},
        "integrity": {
            "snapshot_id": "sha256:" + digest,
            "sha256": digest,
            "algorithm": "SHA-256 of canonical receipt JSON rows joined by LF in append order.",
            "rows": 0,
        },
        "contract": {
            "schema_version": 1,
            "forecast_status": "prospective-only",
            "immutability": "Existing rows may never be removed, reordered or changed.",
            "grading": "Outcomes and scores belong in a separate derived grading surface.",
            "required_input_snapshots": ["schedule", "ratings_registry", "model_cards"],
        },
        "data": rows,
        "tier_meaning": backbone.TIER_MEANING,
        "built": captured_at[:10],
        "canonical_url": "https://datadawgs216.com/data/cfb-model-receipts.json",
    }


def validate_supporting_inputs(
    schedule: dict[str, Any], ratings: dict[str, Any], model_cards: dict[str, Any]
) -> None:
    backbone.validate_schedule_envelope(schedule)
    for name, envelope in (("ratings", ratings), ("model cards", model_cards)):
        snapshot = envelope.get("integrity", {}).get("snapshot_id")
        if not SHA256_RE.fullmatch(str(snapshot)):
            raise ContractError(f"CFB {name} input lacks a snapshot identifier")


def append_receipts(
    ledger: dict[str, Any], additions: list[dict[str, Any]], schedule: dict[str, Any],
    ratings: dict[str, Any], model_cards: dict[str, Any],
) -> dict[str, Any]:
    validate_ledger(ledger)
    validate_supporting_inputs(schedule, ratings, model_cards)
    schedule_snapshot = schedule["integrity"]["snapshot_id"]
    rating_snapshot = ratings["integrity"]["snapshot_id"]
    card_snapshot = model_cards["integrity"]["snapshot_id"]
    games = {game["game_id"]: game for game in schedule["data"]["games"]}
    existing = {receipt["forecast_id"]: receipt for receipt in ledger["data"]}
    rows = list(ledger["data"])

    for receipt in additions:
        validate_receipt(receipt)
        if receipt["schedule_snapshot_id"] != schedule_snapshot:
            raise ContractError("receipt schedule snapshot does not match the supplied schedule")
        if receipt["input_snapshot_ids"]["ratings_registry"] != rating_snapshot:
            raise ContractError("receipt ratings snapshot does not match the supplied registry")
        if receipt["input_snapshot_ids"]["model_cards"] != card_snapshot:
            raise ContractError("receipt model-card snapshot does not match the supplied cards")
        game = games.get(receipt["game_id"])
        if not game:
            raise ContractError(f"receipt game is absent from schedule: {receipt['game_id']}")
        for field in ("season", "week", "kickoff_at", "home_team", "home_team_slug", "away_team", "away_team_slug"):
            if receipt[field] != game[field]:
                raise ContractError(f"receipt {field} disagrees with schedule: {receipt['game_id']}")
        if game["status"] != "scheduled":
            raise ContractError("a prospective receipt may only append against a scheduled game")
        prior = existing.get(receipt["forecast_id"])
        if prior is not None:
            if prior != receipt:
                raise ContractError(f"conflicting duplicate forecast_id: {receipt['forecast_id']}")
            continue
        rows.append(receipt)
        existing[receipt["forecast_id"]] = receipt

    result = copy.deepcopy(ledger)
    result["data"] = rows
    digest = ledger_hash(rows)
    result["integrity"] = {
        "snapshot_id": "sha256:" + digest,
        "sha256": digest,
        "algorithm": "SHA-256 of canonical receipt JSON rows joined by LF in append order.",
        "rows": len(rows),
    }
    if rows:
        newest = max(parse_timestamp(row["issued_at"], "issued_at") for row in rows)
        result["as_of"] = newest.date().isoformat()
        result["built"] = result["as_of"]
        result["note"] = (
            "Append-only prospective CFB forecast receipts. Receipt rows are immutable and "
            "ungraded; outcomes live in a separate derived grading surface."
        )
    validate_ledger(result)
    return result


def assert_append_only(base: list[dict[str, Any]], current: list[dict[str, Any]]) -> None:
    if len(current) < len(base):
        raise ContractError("CFB receipt history removed existing rows")
    for index, old in enumerate(base):
        if current[index] != old:
            raise ContractError(f"CFB receipt history mutated existing row: {old.get('forecast_id', index)}")


def cmd_init(args: argparse.Namespace) -> None:
    captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    if args.ledger.exists():
        existing = backbone.read_json(args.ledger)
        validate_ledger(existing)
        if existing["data"]:
            raise ContractError("refusing to replace a non-empty CFB receipt ledger")
        print(f"unchanged {args.ledger}: empty ledger already exists")
        return
    ledger = make_empty_ledger(captured_at)
    validate_ledger(ledger)
    backbone.write_json(args.ledger, ledger)
    print(f"initialized {args.ledger}: 0 receipts")


def cmd_validate(args: argparse.Namespace) -> None:
    ledger = backbone.read_json(args.ledger)
    validate_ledger(ledger)
    print(f"{args.ledger} satisfies the append-only CFB receipt contract ({len(ledger['data'])} rows)")


def cmd_append(args: argparse.Namespace) -> None:
    value = json.loads(args.input.read_text(encoding="utf-8"))
    additions = value.get("data") if isinstance(value, dict) else value
    if not isinstance(additions, list):
        raise ContractError("receipt input must be an array or an object with data[]")
    updated = append_receipts(
        backbone.read_json(args.ledger), additions, backbone.read_json(args.schedule),
        backbone.read_json(args.ratings), backbone.read_json(args.model_cards),
    )
    backbone.write_json(args.ledger, updated)
    print(f"CFB receipt ledger now contains {len(updated['data'])} rows")


def cmd_verify_history(args: argparse.Namespace) -> None:
    current = backbone.read_json(args.ledger)
    validate_ledger(current)
    relative = args.ledger.resolve().relative_to(ROOT).as_posix()
    proc = subprocess.run(
        ["git", "show", f"{args.base_ref}:{relative}"], cwd=ROOT, check=False,
        capture_output=True, text=True, encoding="utf-8",
    )
    if proc.returncode != 0:
        if current["data"]:
            raise ContractError("base CFB ledger is absent; first introduction must be empty")
        print("base CFB ledger absent and current ledger empty; initial append-only baseline is valid")
        return
    try:
        base = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise ContractError("base CFB ledger is not valid JSON") from exc
    validate_ledger(base)
    assert_append_only(base["data"], current["data"])
    print(f"append-only CFB history preserved for {len(base['data'])} existing receipts")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init", help="create the public empty receipt ledger once")
    init.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    init.set_defaults(func=cmd_init)
    validate = sub.add_parser("validate", help="validate the public ledger offline")
    validate.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    validate.set_defaults(func=cmd_validate)
    append = sub.add_parser("append", help="append prospective receipts without mutation")
    append.add_argument("--input", type=Path, required=True)
    append.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    append.add_argument("--schedule", type=Path, default=DEFAULT_SCHEDULE)
    append.add_argument("--ratings", type=Path, default=DEFAULT_RATINGS)
    append.add_argument("--model-cards", type=Path, default=DEFAULT_MODEL_CARDS)
    append.set_defaults(func=cmd_append)
    history = sub.add_parser("verify-history", help="prove existing receipt rows were not changed")
    history.add_argument("--base-ref", default="origin/main")
    history.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    history.set_defaults(func=cmd_verify_history)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        args.func(args)
    except (ContractError, OSError, json.JSONDecodeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
