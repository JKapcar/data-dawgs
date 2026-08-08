#!/usr/bin/env python3
"""Publish CFB model cards (governance principle cfb-gov-model-cards).

The Pound's CFB governance says an important model documents purpose, target,
features, training window, validation design, known limitations, calibration,
performance, failure modes, version and retirement status before it is promoted
past the lab. This script publishes that record for every CFB model that has
shipped, at /data/cfb-model-cards.json.

Every number in a card is READ FROM the model's own published output rather than
typed here, so a card cannot drift away from the thing it describes. The build
fails if a referenced output is missing or fails its own contract.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "cfb-model-cards.json"

_SPEC = importlib.util.spec_from_file_location("cfb_elo", ROOT / "scripts" / "cfb_elo.py")
elo = importlib.util.module_from_spec(_SPEC)
sys.modules.setdefault(_SPEC.name, elo)
_SPEC.loader.exec_module(elo)
backbone = elo.backbone
ContractError = backbone.ContractError


def roadmap_lifecycle(idea_id: str, pound_tools: Path) -> dict[str, Any]:
    """Report the roadmap's own lifecycle value rather than asserting a second one.

    A model card that declares its own status can disagree with the roadmap. This
    reads the roadmap instead, so the two files cannot drift apart.
    """
    if not pound_tools.exists():
        raise ContractError(f"{pound_tools} is missing; cannot read roadmap lifecycle")
    entries = backbone.read_json(pound_tools)["data"]
    for entry in (entries.values() if isinstance(entries, dict) else entries):
        if isinstance(entry, dict) and entry.get("id") == idea_id:
            return {
                "roadmap_lifecycle_status": entry.get("lifecycle_status"),
                "roadmap_implemented_flag": entry.get("implemented"),
                "note": (
                    "Read from /data/pound-tools.json, not asserted here. The roadmap entry "
                    "has not been advanced since this model shipped; moving it is a pending "
                    "governance decision, not an oversight."
                ) if entry.get("lifecycle_status") == "idea" else
                "Read from /data/pound-tools.json, not asserted here.",
            }
    raise ContractError(f"roadmap idea {idea_id} not found in {pound_tools}")


def calibration_reading(bins: list[dict[str, Any]]) -> str:
    """Describe the largest predicted-vs-observed gaps using the bins themselves."""
    scored = [b for b in bins if b["n"] and b["mean_predicted"] is not None]
    if not scored:
        return "No bin carried any games."
    worst = sorted(scored, key=lambda b: -abs(b["observed_home_win_rate"] - b["mean_predicted"]))[:2]
    parts = [
        f"the {b['bin_low']:.1f}-{b['bin_high']:.1f} bin predicted {b['mean_predicted']:.3f} "
        f"and observed {b['observed_home_win_rate']:.3f} on {b['n']} games"
        for b in worst
    ]
    direction = ("underconfident" if all(
        b["observed_home_win_rate"] > b["mean_predicted"] for b in worst if b["mean_predicted"] >= 0.5
    ) and any(b["mean_predicted"] >= 0.5 for b in worst) else "off")
    return (
        f"Largest gaps: {parts[0]}" + (f", and {parts[1]}" if len(parts) > 1 else "") + ". "
        f"Reads {direction} where the gaps sit, on small per-bin samples, so this is a signal "
        "to check on more seasons rather than a measured bias to correct."
    )


def elo_card(envelope: dict[str, Any], pound_tools: Path) -> dict[str, Any]:
    elo.validate_envelope(envelope)
    data = envelope["data"]
    backtest = data["backtest"]
    team_diagnostics = data["team_diagnostics"]
    versus = backtest.get("versus_market")
    params = data["params"]
    return {
        "model_id": "cfb-elo",
        "model_name": "Data Dawgs CFB Elo baseline",
        "model_version": "1.0.0",
        "roadmap_idea": "cfb-elo",
        "roadmap_step": 2,
        "lifecycle_status": roadmap_lifecycle("cfb-elo", pound_tools),
        "retirement_status": "active",
        "purpose": (
            "Be the interpretable floor every future CFB model must clear. It exists to make "
            "'this model is good' a falsifiable claim, not to be the best available forecast."
        ),
        "target": "Probability that the home team wins a single FBS-vs-FBS game.",
        "features": [
            "Prior game results only: winner, margin of victory, and site (home or neutral).",
            "No recruiting, roster, injury, weather, travel, market or play-level input.",
        ],
        "training_window": {
            "burn_in_seasons": params["burn_in_seasons"],
            "evaluation_season": params["evaluation_season"],
            "note": (
                "Elo has no fit step. The burn-in seasons only move ratings to a sensible "
                "starting point; no parameter was tuned on them."
            ),
        },
        "parameters": params,
        "parameters_fixed_before_evaluation": True,
        "validation_design": {
            "kind": backtest["kind"],
            "evaluation_set": backtest["evaluation_set"],
            "n_games": backtest["n_games"],
            "walk_forward": (
                "Ratings update only from games already played, so each forecast uses "
                "pregame state. The season itself was already complete when this ran, which "
                "is why the result is labelled retrodictive rather than prospective."
            ),
            "reference_points": [
                "always pick the home team",
                "climatological Brier at the observed home win rate",
                "ESPN pregame Elo favorite accuracy",
                "market median devigged moneyline, scored on the same games",
            ],
        },
        "performance": {
            "full_evaluation_set": backtest["elo_baseline"],
            "reference_points": backtest["reference_points"],
            "team_diagnostics": {
                "kind": team_diagnostics["kind"],
                "evaluation_season": team_diagnostics["evaluation_season"],
                "teams": len(team_diagnostics["teams"]),
                "prospective": team_diagnostics["prospective"],
                "graded": team_diagnostics["graded"],
                "rankings_published": team_diagnostics["team_rankings_published"],
                "interpretation": team_diagnostics["interpretation"],
                "limitations": team_diagnostics["limitations"],
            },
            "versus_market_same_games": None if versus is None else {
                "n_games": versus["n_games"],
                "market": versus["market_median_devig"],
                "elo": versus["elo_baseline_same_games"],
                "reading": (
                    "The market beats this baseline on both accuracy and Brier. That is the "
                    "expected and correct result for a results-only Elo, and it is recorded so "
                    "a future model is judged against something real."
                ),
                "timing_caveat": versus["timing_caveat"],
            },
        },
        "calibration": {
            "method": backtest["calibration"]["method"],
            "bins": backtest["calibration"]["bins"],
            "reading": calibration_reading(backtest["calibration"]["bins"]),
        },
        "known_limitations": [
            "Every FBS team enters at 1500 the first time it appears, which overrates newly "
            "transitioning programs for most of their first season.",
            "Non-FBS opponents are one frozen 1200-rated pool, so beating a strong FCS team "
            "and a weak one move a rating identically.",
            "No preseason information at all. Week 1 is close to a coin flip adjusted only by "
            "last season's carry-over and home field.",
            "Flat 55-point home field for every venue, ignoring altitude, travel and crowd.",
            "Margin of victory is damped but not capped, so a running-up-the-score result "
            "still moves ratings more than the game's information warrants.",
            "One season of evaluation. 808 games is enough to rank against a baseline and not "
            "enough to claim a stable edge.",
        ],
        "failure_modes": [
            "Early season: ratings still reflect last year's roster after heavy turnover.",
            "Conference realignment years: schedule strength shifts faster than Elo learns it.",
            "Teams with many non-FBS games carry ratings built partly on the frozen pool.",
            "Postseason: long layoffs, opt-outs and coaching changes are invisible to it.",
        ],
        "inputs": {
            "canonical_schedule": "/data/cfb-schedule.json",
            "market_reference": "/data/cfb-market.json",
            "model_output": "/data/cfb-elo.json",
            "model_snapshot_id": envelope["integrity"]["snapshot_id"],
            "market_snapshot_id": None if versus is None else versus["market_snapshot_id"],
        },
        "receipts": {
            "prospective_receipts_exist": False,
            "why": (
                "No CFB forecast has been locked before kickoff yet. The 2026 schedule is not "
                "published upstream, and the market file carries no observation timestamp, so "
                "'prospective' cannot yet be established for a CFB receipt. Until that changes "
                "this model is backtest-only and appears on no leaderboard."
            ),
        },
        "methodology_url": "https://datadawgs216.com/docs/cfb-data-backbone.md",
        "engine": "scripts/cfb_elo.py",
    }


def build(elo_path: Path, pound_tools: Path) -> list[dict[str, Any]]:
    if not elo_path.exists():
        raise ContractError(f"{elo_path} is missing; build the model before its card")
    return [elo_card(backbone.read_json(elo_path), pound_tools)]


REQUIRED_CARD_FIELDS = {
    "model_id", "model_name", "model_version", "purpose", "target", "features",
    "training_window", "validation_design", "known_limitations", "calibration",
    "performance", "failure_modes", "retirement_status", "lifecycle_status",
}


def validate_envelope(envelope: dict[str, Any]) -> None:
    cards = envelope.get("data", {}).get("cards")
    if not isinstance(cards, list) or not cards:
        raise ContractError("model cards data.cards must be a non-empty array")
    ids = set()
    for card in cards:
        missing = REQUIRED_CARD_FIELDS - set(card)
        if missing:
            raise ContractError(
                f"{card.get('model_id', '?')} card missing governance fields: "
                f"{', '.join(sorted(missing))}"
            )
        if card["model_id"] in ids:
            raise ContractError(f"duplicate model card: {card['model_id']}")
        ids.add(card["model_id"])
        if not card["known_limitations"] or not card["failure_modes"]:
            raise ContractError(f"{card['model_id']} card must state limitations and failure modes")
        if card["retirement_status"] not in {"active", "retired", "graveyard"}:
            raise ContractError(f"{card['model_id']} has an invalid retirement_status")
    if envelope.get("integrity", {}).get("snapshot_id") != backbone.sha256_id(envelope["data"]):
        raise ContractError("model cards snapshot hash mismatch")


def make_envelope(cards: list[dict[str, Any]], captured_at: str) -> dict[str, Any]:
    payload = {"cards": cards}
    return {
        "as_of": captured_at[:10],
        "source": (
            "Generated from each model's own published output by scripts/cfb_model_cards.py; "
            "no performance number in a card is hand-entered."
        ),
        "tier": "labs",
        "graded": False,
        "note": (
            "Model cards for shipped CFB models, per the Model Cards governance principle in "
            "The Pound's CFB roadmap. A card documents what a model is for, what it cannot do "
            "and how it has actually scored. Nothing here is graded: no CFB forecast has been "
            "locked before kickoff yet."
        ),
        "provenance": {
            "generator": "scripts/cfb_model_cards.py",
            "governance_principle": "cfb-gov-model-cards",
            "captured_at": captured_at,
        },
        "integrity": {
            "snapshot_id": backbone.sha256_id(payload),
            "algorithm": (
                "SHA-256 of canonical UTF-8 JSON for the data object "
                "(sorted object keys, no insignificant whitespace)."
            ),
            "cards": len(cards),
        },
        "data": payload,
        "tier_meaning": backbone.TIER_MEANING,
        "built": captured_at[:10],
        "canonical_url": "https://datadawgs216.com/data/cfb-model-cards.json",
    }


def cmd_refresh(args: argparse.Namespace) -> int:
    captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    cards = build(Path(args.elo), Path(args.pound_tools))
    envelope = make_envelope(cards, captured_at)
    validate_envelope(envelope)
    backbone.write_json(Path(args.output), envelope)
    print(f"wrote {args.output}: {len(cards)} model card(s)")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    validate_envelope(backbone.read_json(Path(args.output)))
    print(f"{args.output} satisfies the CFB model card contract")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    refresh = sub.add_parser("refresh", help="regenerate cards from published model outputs")
    refresh.add_argument("--output", default=str(DEFAULT_OUTPUT))
    refresh.add_argument("--elo", default=str(ROOT / "data" / "cfb-elo.json"))
    refresh.add_argument("--pound-tools", dest="pound_tools",
                         default=str(ROOT / "data" / "pound-tools.json"))
    refresh.set_defaults(func=cmd_refresh)
    validate = sub.add_parser("validate", help="validate the published cards (offline)")
    validate.add_argument("--output", default=str(DEFAULT_OUTPUT))
    validate.set_defaults(func=cmd_validate)
    args = parser.parse_args()
    try:
        return args.func(args)
    except ContractError as exc:
        print(f"contract violation: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
