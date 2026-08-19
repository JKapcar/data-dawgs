#!/usr/bin/env python3
"""DDPR NFL — the Data Dawgs Power Rank, an explicit ensemble of the ledger's model lines.

DDPR is not a novel model and does not pretend to be. It is the average of the prospective
model forecasts already in /data/model-receipts.json, published so that the ensemble is
pre-registered on exactly the same terms as its inputs.

TWO AGGREGATIONS ARE PRE-REGISTERED, BOTH BEFORE ANY GAME IS PLAYED:

  ddpr-nfl          the LOG-ODDS average. This is the displayed line.
  ddpr-nfl-linear   the arithmetic average of the probabilities. Pre-registered and
                    ungraded; it exists so the season-end comparison is not model-shopping.

Averaging probabilities is systematically underconfident where the inputs agree, which is
where a proper scoring rule pays. Averaging log-odds is not. The pair is locked now so that
whichever wins, we cannot be accused of having chosen it afterwards.

⚠️ NO EXTREMIZING. The literature's case for extremizing an ensemble assumes partially
independent forecasters. Ours are two Elo-family models whose logits correlate at 0.93 over
the 272 (measured 2026-08-10), so extremizing would overshoot and wreck calibration on the
line that carries our own name.

⚠️ HONEST EXPECTATION, RECORDED BEFORE THE FACT. Over the 272 games, the two aggregations
differ by a mean of 0.00096 and a maximum of 0.00932. With two inputs this correlated the
comparison will very likely land inside the noise on n=272. That is not a reason to skip the
pre-registration, and it IS a reason never to publish the result as having settled anything.

⚠️ DDPR IS NOT INDEPENDENT EVIDENCE. It is a function of its inputs. A board showing nfelo,
538 Classic and DDPR is showing TWO sources, not three, and has to say so.

Determinism: every field is a function of the ledger, the schedule and the pinned constants
below. Re-running reproduces byte-identical rows, which is what lets append_receipts() treat
a second run as a no-op instead of a conflict. Probabilities are quantized to 6 decimal
places with ROUND_HALF_UP so the value does not depend on the platform's float printing.
"""

from __future__ import annotations

import argparse
import hashlib
import math
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import nfl_data_backbone as backbone  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCHEDULE = ROOT / "data" / "nfl-schedule.json"
DEFAULT_LEDGER = ROOT / "data" / "model-receipts.json"
DEFAULT_OUTPUT = ROOT / "data" / "ddpr-nfl.json"

MODEL_NAME = "DDPR NFL"
MODEL_VERSION = "1.0.0"
LOGIT_MODEL_ID = "ddpr-nfl"
LINEAR_MODEL_ID = "ddpr-nfl-linear"
METHODOLOGY_URL = "https://datadawgs216.com/data/ddpr-methodology.md"
LICENSE_STATUS = "first-party-data-dawgs-own-output"

# The inputs, in the order they enter the average. Order is fixed so the input snapshot is
# reproducible; the average itself is symmetric.
INPUT_MODEL_IDS = ("nfelo", "538-classic")

# ⚠️ PINNED, not computed. `source_commit` must be an exact SHA (validate_receipt), and a
# self-authored model has to cite something. This is the commit whose ledger these forecasts
# were computed from — the one fact about provenance that is actually checkable by a reader:
# fetch model-receipts.json at this commit, average the two input columns, get these rows.
# Bump it ONLY alongside a genuine re-derivation, and never for rows already appended.
SOURCE_COMMIT = "706177db2bbdbf4b3e0bc62966a1f65e7d77fc34"
SOURCE_REPO = "JKapcar/data-dawgs"

QUANTUM = Decimal("0.000001")


class ModelError(ValueError):
    """Raised when the ensemble's inputs or output violate the declared contract."""


def q6(value: float) -> float:
    """Quantize to 6 dp, half away from zero. Stated so a reader can reproduce it exactly."""
    return float(Decimal(repr(float(value))).quantize(QUANTUM, rounding=ROUND_HALF_UP))


def logit(p: float) -> float:
    return math.log(p / (1.0 - p))


def inverse_logit(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-z))


def latest_inputs(ledger: dict[str, Any]) -> dict[str, dict[str, dict[str, Any]]]:
    """Latest prospective receipt per (game_id, model_id) for the input models only.

    "Latest" is by captured_at, matching model_contracts.selection. Only games carrying
    EVERY input model are returned: an ensemble of a partial panel is a different model
    from one game to the next, and averaging over whoever happened to publish is how a
    leaderboard silently changes its own sample.
    """
    rows = ledger.get("data")
    if not isinstance(rows, list):
        raise ModelError("receipt ledger data must be an array")
    latest: dict[str, dict[str, dict[str, Any]]] = {}
    for row in rows:
        if row.get("model_id") not in INPUT_MODEL_IDS:
            continue
        if row.get("forecast_status") != "prospective":
            continue
        per_game = latest.setdefault(row["game_id"], {})
        prior = per_game.get(row["model_id"])
        if prior is None or str(row["captured_at"]) > str(prior["captured_at"]):
            per_game[row["model_id"]] = row
    complete = {
        game_id: models
        for game_id, models in latest.items()
        if all(model_id in models for model_id in INPUT_MODEL_IDS)
    }
    if not complete:
        raise ModelError("no game carries every input model; DDPR has nothing to average")
    return complete


def input_snapshot_id(complete: dict[str, dict[str, dict[str, Any]]]) -> str:
    """SHA-256 over exactly the numbers that entered the average, and nothing else.

    Deliberately NOT the ledger's own hash: that moves when an unrelated model is appended,
    which would make DDPR's provenance look changed when its inputs had not.
    """
    material = [
        [game_id]
        + [
            [model_id, f"{float(complete[game_id][model_id]['home_win_probability']):.6f}"]
            for model_id in INPUT_MODEL_IDS
        ]
        for game_id in sorted(complete)
    ]
    return backbone.sha256_id(["ddpr-nfl-inputs-v1", list(INPUT_MODEL_IDS), material])


def aggregate(probabilities: list[float]) -> tuple[float, float]:
    """Return (log-odds average, linear average), both quantized."""
    for p in probabilities:
        if not (0.0 < float(p) < 1.0):
            raise ModelError(f"input probability must be strictly inside (0,1): {p!r}")
    logit_mean = sum(logit(float(p)) for p in probabilities) / len(probabilities)
    linear_mean = sum(float(p) for p in probabilities) / len(probabilities)
    return q6(inverse_logit(logit_mean)), q6(linear_mean)


def build_envelope(ledger: dict[str, Any], schedule: dict[str, Any]) -> dict[str, Any]:
    complete = latest_inputs(ledger)
    schedule_games = {game["game_id"]: game for game in schedule["data"]["games"]}
    snapshot = input_snapshot_id(complete)
    forecasts: list[dict[str, Any]] = []
    for game_id in sorted(complete):
        game = schedule_games.get(game_id)
        if not game:
            raise ModelError(f"input game is absent from the canonical schedule: {game_id}")
        models = complete[game_id]
        inputs = [float(models[m]["home_win_probability"]) for m in INPUT_MODEL_IDS]
        logit_p, linear_p = aggregate(inputs)
        # The ensemble cannot predate its inputs. Taking the newest input's capture time is
        # both the honest timestamp and a deterministic one — datetime.now() here would make
        # every re-run a conflicting duplicate.
        captured_at = max(str(models[m]["captured_at"]) for m in INPUT_MODEL_IDS)
        forecasts.append({
            "game_id": game_id,
            "season": game["season"],
            "week": game["week"],
            "kickoff_at": game["kickoff_at"],
            "home_team": game["home_team"],
            "away_team": game["away_team"],
            "captured_at": captured_at,
            "inputs": {m: float(models[m]["home_win_probability"]) for m in INPUT_MODEL_IDS},
            "home_win_probability_logit_mean": logit_p,
            "home_win_probability_linear_mean": linear_p,
        })
    data = {
        "model_id": LOGIT_MODEL_ID,
        "model_name": MODEL_NAME,
        "model_version": MODEL_VERSION,
        "displayed_aggregation": "logit_mean",
        "input_model_ids": list(INPUT_MODEL_IDS),
        "extremized": False,
        "forecasts": forecasts,
    }
    independence = pairwise_logit_correlation(complete)
    return {
        "source_page": "/receipts.html",
        "tier": "labs",
        "graded": False,
        "as_of": max(f["captured_at"] for f in forecasts)[:10],
        "source": (
            "Data Dawgs Power Rank: an explicit ensemble of the prospective model lines in "
            "/data/model-receipts.json. Not a novel model."
        ),
        "note": (
            "DDPR is a FUNCTION of its inputs, so it is not independent evidence — a board "
            "showing nfelo, 538 Classic and DDPR shows two sources, not three. Two "
            "aggregations are pre-registered before any game is played: the log-odds average "
            "is displayed and the linear average is carried ungraded so the season-end "
            "comparison is not model-shopping. No extremizing. Nothing is graded: the 2026 "
            "season starts 2026-09-10."
        ),
        "methodology": {
            "displayed": "inverse_logit(mean(logit(p_i)))",
            "also_registered": "mean(p_i)",
            "rounding": "6 decimal places, ROUND_HALF_UP",
            "extremizing": "none, by decision — the inputs are not independent enough",
            "url": METHODOLOGY_URL,
        },
        "independence": independence,
        "integrity": {
            "input_snapshot_id": snapshot,
            "snapshot_id": backbone.sha256_id(data),
            "forecast_rows": len(forecasts),
            "input_model_count": len(INPUT_MODEL_IDS),
        },
        "provenance": {
            "source_repo": SOURCE_REPO,
            "source_commit": SOURCE_COMMIT,
            "schedule_snapshot_id": schedule["integrity"]["snapshot_id"],
            "inputs_from": "/data/model-receipts.json",
        },
        "data": data,
        # ⚠️ From the backbone, never retyped. tools/validate-data.js asserts every
        # data/*.json carries the sentence BYTE-IDENTICAL to TIER_MEANING in
        # tools/build-data.js, which is the fix for tier_meaning having had five sources.
        "tier_meaning": backbone.TIER_MEANING,
        "canonical_url": "https://datadawgs216.com/data/ddpr-nfl.json",
    }


def pairwise_logit_correlation(
    complete: dict[str, dict[str, dict[str, Any]]]
) -> dict[str, Any]:
    """How much independent evidence the panel actually carries.

    Needs ZERO resolved games, which is the entire reason it can be published today while
    every Brier column is still empty.
    """
    game_ids = sorted(complete)
    series = {
        model_id: [logit(float(complete[g][model_id]["home_win_probability"])) for g in game_ids]
        for model_id in INPUT_MODEL_IDS
    }
    pairs = []
    for i, a in enumerate(INPUT_MODEL_IDS):
        for b in INPUT_MODEL_IDS[i + 1:]:
            pairs.append({
                "models": [a, b],
                "logit_correlation": q6(correlation(series[a], series[b])),
                "mean_absolute_probability_gap": q6(
                    sum(
                        abs(
                            float(complete[g][a]["home_win_probability"])
                            - float(complete[g][b]["home_win_probability"])
                        )
                        for g in game_ids
                    )
                    / len(game_ids)
                ),
            })
    return {
        "games": len(game_ids),
        "note": (
            "Correlation of LOGITS between input models, computed on prospective forecasts "
            "alone. High correlation means the ensemble carries less independent evidence "
            "than its member count suggests."
        ),
        "pairs": pairs,
    }


def correlation(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 2 or len(ys) != n:
        raise ModelError("correlation needs two equal-length series of at least two points")
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 0 or syy <= 0:
        raise ModelError("correlation is undefined for a constant series")
    return sxy / math.sqrt(sxx * syy)


def model_receipts(envelope: dict[str, Any]) -> list[dict[str, Any]]:
    """Both pre-registered aggregations, as normalized ledger rows."""
    snapshot = envelope["integrity"]["input_snapshot_id"]
    prefix = snapshot.removeprefix("sha256:")[:12]
    schedule_snapshot_id = envelope["provenance"]["schedule_snapshot_id"]
    variants = (
        (LOGIT_MODEL_ID, "logit-1.0.0", "home_win_probability_logit_mean", "logit_mean", True),
        (LINEAR_MODEL_ID, "linear-1.0.0", "home_win_probability_linear_mean", "linear_mean", False),
    )
    receipts: list[dict[str, Any]] = []
    for model_id, version, field, aggregation, displayed in variants:
        for forecast in envelope["data"]["forecasts"]:
            slug = forecast["game_id"].lower().replace("_", "-")
            receipts.append({
                "forecast_id": f"{model_id}-{version}-{prefix}-{slug}",
                "game_id": forecast["game_id"],
                "season": forecast["season"],
                "week": forecast["week"],
                "kickoff_at": forecast["kickoff_at"],
                "captured_at": forecast["captured_at"],
                "model_id": model_id,
                "model_name": f"{MODEL_NAME} ({aggregation.replace('_', ' ')})",
                "model_version": version,
                "source_repo": SOURCE_REPO,
                "source_commit": SOURCE_COMMIT,
                "source_capture_at": forecast["captured_at"],
                "home_team": forecast["home_team"],
                "away_team": forecast["away_team"],
                "home_win_probability": forecast[field],
                "expected_margin_home": None,
                "model_spread_home": None,
                "home_cover_probability": None,
                "push_probability": None,
                "input_snapshot_id": snapshot,
                "schedule_snapshot_id": schedule_snapshot_id,
                "forecast_status": "prospective",
                "methodology_url": METHODOLOGY_URL,
                "license_status": LICENSE_STATUS,
                "ensemble_of": list(INPUT_MODEL_IDS),
                "aggregation": aggregation,
                "displayed": displayed,
                "extremized": False,
            })
    return receipts


LEDGER_SOURCE = (
    "Data Dawgs normalized append-only multi-model receipt ledger: locked nfelo 4.3.0 "
    "output, prospective 538 Classic Elo forecasts, and both pre-registered DDPR NFL "
    "ensemble aggregations."
)
LEDGER_NOTE = (
    "Every row is prospective and append-only. The nfelo adapter preserves its locked model "
    "probability but deliberately omits legacy market values whose book and observation "
    "timestamp are unknown. The two ddpr-nfl lines are FUNCTIONS of the nfelo and 538 "
    "Classic rows, not independent evidence, and ddpr-nfl-linear is registered for "
    "comparison only and is not displayed. Results remain separate and nothing is graded yet."
)


def update_ledger(
    ledger: dict[str, Any], envelope: dict[str, Any], schedule: dict[str, Any]
) -> dict[str, Any]:
    updated = backbone.append_receipts(ledger, model_receipts(envelope), schedule)
    if (
        updated["data"] == ledger["data"]
        and ledger.get("source") == LEDGER_SOURCE
        and ledger.get("note") == LEDGER_NOTE
    ):
        return ledger
    updated["source"] = LEDGER_SOURCE
    updated["note"] = LEDGER_NOTE
    backbone.validate_receipt_ledger(updated)
    return updated


def validate_envelope(envelope: dict[str, Any], schedule: dict[str, Any]) -> None:
    data = envelope.get("data")
    if not isinstance(data, dict):
        raise ModelError("DDPR envelope data must be an object")
    integrity = envelope.get("integrity", {})
    if integrity.get("snapshot_id") != backbone.sha256_id(data):
        raise ModelError("DDPR snapshot_id does not reproduce from data")
    forecasts = data.get("forecasts")
    if not isinstance(forecasts, list) or not forecasts:
        raise ModelError("DDPR envelope carries no forecasts")
    if integrity.get("forecast_rows") != len(forecasts):
        raise ModelError("DDPR integrity.forecast_rows disagrees with the forecast count")
    if data.get("extremized") is not False:
        raise ModelError("DDPR must not be extremized")
    if data.get("displayed_aggregation") != "logit_mean":
        raise ModelError("the displayed DDPR aggregation must be the logit mean")
    if list(data.get("input_model_ids") or []) != list(INPUT_MODEL_IDS):
        raise ModelError("DDPR input model list does not match the pinned inputs")
    if envelope["provenance"]["schedule_snapshot_id"] != schedule["integrity"]["snapshot_id"]:
        raise ModelError("DDPR schedule snapshot does not match the canonical schedule")
    if envelope.get("graded") is not False:
        raise ModelError("DDPR cannot be graded before the season starts")
    for forecast in forecasts:
        logit_p, linear_p = aggregate(list(forecast["inputs"].values()))
        if forecast["home_win_probability_logit_mean"] != logit_p:
            raise ModelError(f"DDPR logit mean does not reproduce: {forecast['game_id']}")
        if forecast["home_win_probability_linear_mean"] != linear_p:
            raise ModelError(f"DDPR linear mean does not reproduce: {forecast['game_id']}")


def validate_public(
    envelope: dict[str, Any], ledger: dict[str, Any], schedule: dict[str, Any]
) -> None:
    validate_envelope(envelope, schedule)
    backbone.validate_receipt_ledger(ledger)
    by_id = {row["forecast_id"]: row for row in ledger["data"]}
    covered = {(row["model_id"], row["game_id"]) for row in ledger["data"]}
    expected = model_receipts(envelope)
    for row in expected:
        prior = by_id.get(row["forecast_id"])
        if prior is not None:
            if prior != row:
                raise ModelError(f"DDPR receipt changed: {row['forecast_id']}")
        elif (row["model_id"], row["game_id"]) not in covered:
            raise ModelError(f"DDPR receipt missing: {row['forecast_id']}")
    displayed = [r for r in ledger["data"] if r["model_id"] == LOGIT_MODEL_ID]
    linear = [r for r in ledger["data"] if r["model_id"] == LINEAR_MODEL_ID]
    if len(displayed) != len(linear):
        raise ModelError("the two pre-registered DDPR aggregations cover different game sets")
    if len(displayed) != envelope["integrity"]["forecast_rows"]:
        raise ModelError("the ledger's DDPR coverage disagrees with the envelope")


def cmd_refresh(args: argparse.Namespace) -> None:
    schedule = backbone.read_json(args.schedule)
    ledger = backbone.read_json(args.ledger)
    # ⚠️ NO REUSE-THE-EXISTING-ENVELOPE BRANCH, deliberately.
    # scripts/elo_538_classic.py keeps the published envelope when the input snapshot has
    # not moved, because its `captured_at` comes from datetime.now() and a re-run would
    # otherwise churn the timestamp. Every field here is a function of the inputs, so the
    # candidate is already byte-identical on a re-run and the cache buys nothing.
    # It also actively hurt: written once with that branch in place, adding tier_meaning to
    # build_envelope() changed nothing on disk, because the matching input snapshot handed
    # back the OLD envelope and validate-data.js kept failing on a field the builder was
    # by then emitting correctly. A cache keyed on the inputs cannot see a change to the
    # envelope's SHAPE. Rebuild every time and let idempotency come from determinism.
    envelope = build_envelope(ledger, schedule)
    updated = update_ledger(ledger, envelope, schedule)
    validate_public(envelope, updated, schedule)
    backbone.write_json(args.output, envelope)
    backbone.write_json(args.ledger, updated)
    pair = envelope["independence"]["pairs"][0]
    print(
        f"DDPR NFL: {envelope['integrity']['forecast_rows']} games x 2 pre-registered "
        f"aggregations; ledger {len(updated['data'])} rows; "
        f"logit corr {pair['logit_correlation']}; input {envelope['integrity']['input_snapshot_id']}"
    )


def cmd_validate(args: argparse.Namespace) -> None:
    schedule = backbone.read_json(args.schedule)
    envelope = backbone.read_json(args.output)
    ledger = backbone.read_json(args.ledger)
    validate_public(envelope, ledger, schedule)
    counts: dict[str, int] = {}
    for row in ledger["data"]:
        counts[row["model_id"]] = counts.get(row["model_id"], 0) + 1
    print(f"validated DDPR NFL; normalized receipts {counts}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    refresh = sub.add_parser("refresh", help="recompute DDPR and append its receipts")
    refresh.add_argument("--schedule", type=Path, default=DEFAULT_SCHEDULE)
    refresh.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    refresh.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    refresh.set_defaults(func=cmd_refresh)

    validate = sub.add_parser("validate", help="validate DDPR and its receipts offline")
    validate.add_argument("--schedule", type=Path, default=DEFAULT_SCHEDULE)
    validate.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    validate.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
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
