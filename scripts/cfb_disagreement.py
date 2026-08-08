#!/usr/bin/env python3
"""CFB disagreement probe (roadmap step 3, idea cfb-disagreement-lab).

The question step 3 exists to answer: when Data Dawgs' model and the market
disagree, does either side systematically win? The answer decides whether a
consensus engine (step 4) is worth building at all.

READ THE CONFOUND BEFORE READING THE NUMBERS.

The only CFB market prices available carry no observation timestamp
(see scripts/cfb_market.py). If those prices are late, then the games where
model and market disagree most are exactly the games where the market had
information the model could not have had: an injury, a suspension, a weather
turn, a quarterback ruled out on Friday. Under that reading the market must win
the disagreement bucket, and it tells us nothing about whose method is better.

So this script publishes the measurement and refuses to draw the conclusion.
It reports the finding as BLOCKED, names the one thing that would unblock it
(prices with capture timestamps, established before kickoff), and says what the
numbers would mean if that existed. A lab is allowed to fail; it is not allowed
to launder a confounded result into a verdict.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "cfb-disagreement.json"

_SPEC = importlib.util.spec_from_file_location("cfb_elo", ROOT / "scripts" / "cfb_elo.py")
elo = importlib.util.module_from_spec(_SPEC)
sys.modules.setdefault(_SPEC.name, elo)
_SPEC.loader.exec_module(elo)
backbone = elo.backbone
ContractError = backbone.ContractError

DISAGREEMENT_EDGES = [0.0, 0.05, 0.10, 0.20, 1.01]
MIN_BUCKET_N = 30


def brier(rows: list[dict[str, Any]], key: str) -> float:
    return sum((r[key] - (1.0 if r["home_won"] else 0.0)) ** 2 for r in rows) / len(rows)


def accuracy(rows: list[dict[str, Any]], key: str) -> float:
    return sum((r[key] >= 0.5) == r["home_won"] for r in rows) / len(rows)


def build(paired: list[dict[str, Any]]) -> dict[str, Any]:
    if len(paired) < 200:
        raise ContractError(f"too few paired games to probe disagreement: {len(paired)}")
    for row in paired:
        row["gap"] = abs(row["p_home"] - row["market_p_home"])

    buckets = []
    for low, high in zip(DISAGREEMENT_EDGES, DISAGREEMENT_EDGES[1:]):
        members = [r for r in paired if low <= r["gap"] < high]
        bucket = {
            "gap_low": low,
            "gap_high": None if high > 1.0 else high,
            "n": len(members),
            "underpowered": len(members) < MIN_BUCKET_N,
        }
        if members:
            bucket.update({
                "mean_gap": round(sum(r["gap"] for r in members) / len(members), 4),
                "elo_brier": round(brier(members, "p_home"), 4),
                "market_brier": round(brier(members, "market_p_home"), 4),
                "elo_accuracy": round(accuracy(members, "p_home"), 4),
                "market_accuracy": round(accuracy(members, "market_p_home"), 4),
                "observed_home_win_rate": round(
                    sum(r["home_won"] for r in members) / len(members), 4),
            })
            bucket["market_brier_advantage"] = round(
                bucket["elo_brier"] - bucket["market_brier"], 4)
        buckets.append(bucket)

    scored = [b for b in buckets if b["n"]]
    widest = max(scored, key=lambda b: b["gap_low"])
    advantages = [b["market_brier_advantage"] for b in scored]
    monotone = all(a <= b + 1e-9 for a, b in zip(advantages, advantages[1:]))
    pattern = (
        "The market's Brier advantage rises with the disagreement gap, "
        + " then ".join(f"{a:+.4f}" for a in advantages)
        + ". Two explanations fit this equally well and the data cannot separate them: the "
        "Elo is worst exactly where it is most confidently wrong, or the market simply knew "
        "something later. Both predict this shape."
    ) if monotone else (
        "The market's Brier advantage does not rise monotonically with the disagreement gap: "
        + " then ".join(f"{a:+.4f}" for a in advantages) + "."
    )
    return {
        "question": (
            "When the Data Dawgs CFB Elo and the market disagree, does either side "
            "systematically win?"
        ),
        "finding": "blocked",
        "why_blocked": (
            "The available market prices carry no observation timestamp. If they are late, the "
            "widest-disagreement games are precisely the games where the market held news the "
            "model could not have held, so the market wins that bucket by construction. This "
            "design cannot separate a better method from a later look at the same world."
        ),
        "what_would_unblock_it": (
            "Market prices with a capture timestamp established before kickoff, from any book. "
            "One timestamped snapshot per game at a fixed pregame hour is enough; a full line "
            "history is not required. Until then, step 3's headline question and the step 4 "
            "consensus engine that depends on it are both gated on data, not on modelling."
        ),
        "measured_anyway": {
            "n_paired_games": len(paired),
            "buckets": buckets,
            "widest_bucket": {
                "gap_low": widest["gap_low"],
                "n": widest["n"],
                "market_brier_advantage": widest.get("market_brier_advantage"),
            },
            "observed_pattern": pattern,
            "reading_if_prices_were_timestamped_and_pregame": (
                "A market Brier advantage that grows with the disagreement gap would say the "
                "Elo's confident disagreements are where it is most wrong, and that blending "
                "toward the market is the correct move. A flat or shrinking advantage would say "
                "the Elo carries something the market does not, which is the only case where a "
                "consensus engine earns its keep."
            ),
        },
        "governance": ["cfb-gov-correlation", "cfb-gov-incremental", "cfb-gov-uncertainty"],
    }


def validate_envelope(envelope: dict[str, Any]) -> None:
    data = envelope.get("data")
    if not isinstance(data, dict):
        raise ContractError("disagreement data must be an object")
    if data.get("finding") not in {"blocked", "no-signal", "signal"}:
        raise ContractError(f"invalid finding: {data.get('finding')}")
    if data["finding"] == "blocked" and not data.get("what_would_unblock_it"):
        raise ContractError("a blocked finding must name what would unblock it")
    buckets = data.get("measured_anyway", {}).get("buckets")
    if not isinstance(buckets, list) or not buckets:
        raise ContractError("disagreement buckets must be a non-empty array")
    for bucket in buckets:
        if bucket["n"] and "underpowered" not in bucket:
            raise ContractError("every scored bucket must declare whether it is underpowered")
    if envelope.get("integrity", {}).get("snapshot_id") != backbone.sha256_id(data):
        raise ContractError("disagreement snapshot hash mismatch")


def make_envelope(payload: dict[str, Any], captured_at: str) -> dict[str, Any]:
    return {
        "as_of": captured_at[:10],
        "source": (
            "Data Dawgs CFB Elo (/data/cfb-elo.json) against median devigged market prices "
            "(/data/cfb-market.json), 2025 FBS-vs-FBS finals."
        ),
        "tier": "labs",
        "graded": False,
        "note": (
            "A probe, not a result. The market prices behind it have no observation timestamp, "
            "which confounds the only question the probe was built to answer. The measurement "
            "is published so the reasoning is checkable; the conclusion is withheld on purpose."
        ),
        "provenance": {
            "engine": "scripts/cfb_disagreement.py",
            "roadmap_idea": "cfb-disagreement-lab",
            "roadmap_step": 3,
            "market_timing": "unknown",
            "captured_at": captured_at,
        },
        "integrity": {
            "snapshot_id": backbone.sha256_id(payload),
            "algorithm": (
                "SHA-256 of canonical UTF-8 JSON for the data object "
                "(sorted object keys, no insignificant whitespace)."
            ),
        },
        "data": payload,
        "tier_meaning": backbone.TIER_MEANING,
        "built": captured_at[:10],
        "canonical_url": "https://datadawgs216.com/data/cfb-disagreement.json",
    }


def cmd_refresh(args: argparse.Namespace) -> int:
    captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    result = elo.run_backtest()
    paired = [r for r in result["_eval_rows"] if r["market_p_home"] is not None]
    payload = build(paired)
    envelope = make_envelope(payload, captured_at)
    validate_envelope(envelope)
    backbone.write_json(Path(args.output), envelope)
    widest = payload["measured_anyway"]["widest_bucket"]
    print(f"wrote {args.output}: {len(paired)} paired games, finding={payload['finding']}, "
          f"widest bucket n={widest['n']} market Brier advantage {widest['market_brier_advantage']}")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    validate_envelope(backbone.read_json(Path(args.output)))
    print(f"{args.output} satisfies the CFB disagreement contract")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    refresh = sub.add_parser("refresh", help="recompute the disagreement probe")
    refresh.add_argument("--output", default=str(DEFAULT_OUTPUT))
    refresh.set_defaults(func=cmd_refresh)
    validate = sub.add_parser("validate", help="validate the published probe (offline)")
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
