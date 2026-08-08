#!/usr/bin/env python3
"""Evaluate record-versus-scoring divergence beyond the CFB Elo baseline.

The experiment is deliberately small and leakage-resistant.  Pregame features use
only results completed before kickoff; simultaneous kickoffs are evaluated before
any result in that batch updates team state.  The first 60 percent of qualified
games (at a whole-kickoff boundary) fit one logistic coefficient on top of Elo's
fixed log-odds.  The untouched final 40 percent decide whether the feature improves
both Brier score and log loss in the expected direction.

Only aggregate evidence is published.  The private Elo game rows used for the join
remain in process and are never serialized.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone
from itertools import groupby
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEAM_GAME = ROOT / "data" / "cfb-team-game.json"
DEFAULT_ELO = ROOT / "data" / "cfb-elo.json"
DEFAULT_OUTPUT = ROOT / "data" / "cfb-record-divergence-validation.json"

MIN_PRIOR_GAMES = 4
TRAIN_SHARE = 0.60
MIN_HOLDOUT_GAMES = 180


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(spec.name, module)
    spec.loader.exec_module(module)
    return module


divergence = _load_module("cfb_record_divergence", ROOT / "scripts" / "cfb_record_divergence.py")
elo = _load_module("cfb_elo_for_divergence_validation", ROOT / "scripts" / "cfb_elo.py")
backbone = divergence.backbone
ContractError = backbone.ContractError


def _state_values(state: dict[str, dict[str, float]], eligible: set[str]) -> tuple[dict[str, float], dict[str, float]]:
    win_pct = {
        slug: (state[slug]["wins"] + 0.5 * state[slug]["ties"]) / state[slug]["games"]
        for slug in eligible
    }
    scoring = {slug: state[slug]["point_differential"] / state[slug]["games"] for slug in eligible}
    return win_pct, scoring


def _update_state(state: dict[str, dict[str, float]], slug: str, result: str, point_differential: int) -> None:
    row = state[slug]
    row["games"] += 1
    row["point_differential"] += point_differential
    if result == "win":
        row["wins"] += 1
    elif result == "tie":
        row["ties"] += 1
    elif result != "loss":
        raise ContractError(f"unknown completed result {result!r}")


def build_feature_rows(
    team_game_envelope: dict[str, Any],
    eval_rows: list[dict[str, Any]],
    min_prior_games: int = MIN_PRIOR_GAMES,
) -> list[dict[str, Any]]:
    """Build private, timestamp-aligned feature rows from results known pre-kickoff."""
    data = team_game_envelope.get("data")
    if not isinstance(data, dict) or data.get("scope") != "results-only":
        raise ContractError("cfb-team-game input must be results-only")
    if not isinstance(min_prior_games, int) or min_prior_games < 1:
        raise ContractError("min_prior_games must be a positive integer")

    teams = data.get("teams")
    if not isinstance(teams, dict):
        raise ContractError("cfb-team-game teams must be an object")
    fbs = {slug for slug, metadata in teams.items() if metadata.get("division") == "fbs"}
    if len(fbs) < 2:
        raise ContractError("cfb-team-game input has too few FBS teams")

    eval_by_game: dict[str, dict[str, Any]] = {}
    for row in eval_rows:
        game_id = row.get("game_id")
        if not isinstance(game_id, str) or game_id in eval_by_game:
            raise ContractError("private Elo rows must have unique game_id values")
        eval_by_game[game_id] = row

    home_rows = [row for row in data.get("rows", []) if row.get("team_side") == "home"]
    home_rows.sort(key=lambda row: (row["kickoff_at"], row["game_id"]))
    state: dict[str, dict[str, float]] = defaultdict(
        lambda: {"games": 0, "wins": 0, "ties": 0, "point_differential": 0}
    )
    features: list[dict[str, Any]] = []

    for kickoff_at, batch_iter in groupby(home_rows, key=lambda row: row["kickoff_at"]):
        batch = list(batch_iter)
        eligible = {slug for slug in fbs if state[slug]["games"] >= min_prior_games}
        win_pct, scoring = _state_values(state, eligible)
        record_ranks = divergence.competition_ranks(win_pct) if eligible else {}
        scoring_ranks = divergence.competition_ranks(scoring) if eligible else {}

        # Compute every feature in the batch before applying any result from this kickoff.
        for game in batch:
            if game.get("result") is None:
                continue
            home_slug = game["team_slug"]
            away_slug = game["opponent_slug"]
            if home_slug not in fbs or away_slug not in fbs:
                continue
            if home_slug not in eligible or away_slug not in eligible:
                continue
            private = eval_by_game.get(game["game_id"])
            if private is None:
                raise ContractError(f"qualified game missing from private Elo evaluation rows: {game['game_id']}")
            if (
                private.get("kickoff_at") != kickoff_at
                or private.get("home_team_slug") != home_slug
                or private.get("away_team_slug") != away_slug
            ):
                raise ContractError(f"private Elo join fields drift for {game['game_id']}")
            home_gap = scoring_ranks[home_slug] - record_ranks[home_slug]
            away_gap = scoring_ranks[away_slug] - record_ranks[away_slug]
            features.append({
                "game_id": game["game_id"],
                "kickoff_at": kickoff_at,
                "relative_record_scoring_gap": home_gap - away_gap,
                "home_record_scoring_gap": home_gap,
                "away_record_scoring_gap": away_gap,
                "p_elo_home": float(private["p_home"]),
                "home_won": 1.0 if private["home_won"] else 0.0,
            })

        for game in batch:
            result = game.get("result")
            if result is None:
                continue
            home_slug = game["team_slug"]
            away_slug = game["opponent_slug"]
            if home_slug in fbs:
                _update_state(state, home_slug, result, game["point_differential"])
            if away_slug in fbs:
                reverse = "loss" if result == "win" else "win" if result == "loss" else "tie"
                _update_state(state, away_slug, reverse, -game["point_differential"])

    features.sort(key=lambda row: (row["kickoff_at"], row["game_id"]))
    if not features:
        raise ContractError("record-divergence validation produced no qualified games")
    return features


def chronological_split(rows: list[dict[str, Any]], train_share: float = TRAIN_SHARE) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str]:
    if not 0.5 <= train_share < 1:
        raise ContractError("train_share must be at least 0.5 and below 1")
    ordered = sorted(rows, key=lambda row: (row["kickoff_at"], row.get("game_id", "")))
    target = len(ordered) * train_share
    boundaries = [i for i in range(1, len(ordered)) if ordered[i - 1]["kickoff_at"] < ordered[i]["kickoff_at"]]
    if not boundaries:
        raise ContractError("qualified games do not span multiple kickoff timestamps")
    boundary = min(boundaries, key=lambda i: (abs(i - target), i))
    train, holdout = ordered[:boundary], ordered[boundary:]
    cutoff = holdout[0]["kickoff_at"]
    if any(row["kickoff_at"] >= cutoff for row in train):
        raise ContractError("chronological split leaked a holdout kickoff into training")
    return train, holdout, cutoff


def _clamp_probability(value: float) -> float:
    return min(max(value, 1e-9), 1 - 1e-9)


def _logit(probability: float) -> float:
    p = _clamp_probability(probability)
    return math.log(p / (1 - p))


def _sigmoid(value: float) -> float:
    if value >= 0:
        z = math.exp(-value)
        return 1 / (1 + z)
    z = math.exp(value)
    return z / (1 + z)


def fit_incremental_coefficient(train: list[dict[str, Any]]) -> dict[str, float]:
    values = [float(row["relative_record_scoring_gap"]) for row in train]
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    scale = math.sqrt(variance)
    if not math.isfinite(scale) or scale <= 0:
        raise ContractError("training divergence feature has zero variance")
    beta = 0.0
    iterations = 0
    for iterations in range(1, 101):
        gradient = information = 0.0
        for row in train:
            z = (float(row["relative_record_scoring_gap"]) - mean) / scale
            fitted = _sigmoid(_logit(float(row["p_elo_home"])) + beta * z)
            gradient += z * (float(row["home_won"]) - fitted)
            information += z * z * fitted * (1 - fitted)
        if information <= 1e-12:
            raise ContractError("incremental coefficient fit became singular")
        step = gradient / information
        beta += step
        if abs(step) < 1e-10:
            break
    if not math.isfinite(beta):
        raise ContractError("incremental coefficient is non-finite")
    return {"feature_mean": mean, "feature_scale": scale, "coefficient": beta, "iterations": iterations}


def adjusted_probability(row: dict[str, Any], fit: dict[str, float]) -> float:
    z = (float(row["relative_record_scoring_gap"]) - fit["feature_mean"]) / fit["feature_scale"]
    return _sigmoid(_logit(float(row["p_elo_home"])) + fit["coefficient"] * z)


def score(rows: list[dict[str, Any]], probability_key: str | None = None, fit: dict[str, float] | None = None) -> dict[str, Any]:
    if not rows or ((probability_key is None) == (fit is None)):
        raise ContractError("score requires rows and exactly one probability source")
    probabilities = [
        float(row[probability_key]) if probability_key is not None else adjusted_probability(row, fit)
        for row in rows
    ]
    outcomes = [float(row["home_won"]) for row in rows]
    return {
        "n_games": len(rows),
        "brier_home_win": round(sum((p - y) ** 2 for p, y in zip(probabilities, outcomes)) / len(rows), 6),
        "log_loss_home_win": round(
            -sum(y * math.log(_clamp_probability(p)) + (1 - y) * math.log(_clamp_probability(1 - p))
                 for p, y in zip(probabilities, outcomes)) / len(rows), 6
        ),
        "favorite_accuracy": round(sum((p >= 0.5) == bool(y) for p, y in zip(probabilities, outcomes)) / len(rows), 4),
        "mean_predicted_home_win": round(sum(probabilities) / len(rows), 4),
        "observed_home_win_rate": round(sum(outcomes) / len(rows), 4),
    }


def directional_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(rows, key=lambda row: (row["relative_record_scoring_gap"], row["kickoff_at"], row["game_id"]))
    quartile_n = max(1, len(ordered) // 4)

    def summarize(members: list[dict[str, Any]]) -> dict[str, Any]:
        residuals = [row["home_won"] - row["p_elo_home"] for row in members]
        return {
            "n_games": len(members),
            "mean_relative_gap": round(sum(row["relative_record_scoring_gap"] for row in members) / len(members), 4),
            "mean_elo_residual": round(sum(residuals) / len(residuals), 6),
        }

    low = summarize(ordered[:quartile_n])
    high = summarize(ordered[-quartile_n:])
    return {
        "lowest_relative_gap_quartile": low,
        "highest_relative_gap_quartile": high,
        "high_minus_low_elo_residual": round(high["mean_elo_residual"] - low["mean_elo_residual"], 6),
        "expected_sign": "negative",
    }


def analyze(feature_rows: list[dict[str, Any]]) -> dict[str, Any]:
    train, holdout, cutoff = chronological_split(feature_rows)
    fit = fit_incremental_coefficient(train)
    train_elo = score(train, probability_key="p_elo_home")
    train_adjusted = score(train, fit=fit)
    holdout_elo = score(holdout, probability_key="p_elo_home")
    holdout_adjusted = score(holdout, fit=fit)
    direction = directional_summary(holdout)
    brier_improvement = round(holdout_elo["brier_home_win"] - holdout_adjusted["brier_home_win"], 6)
    log_loss_improvement = round(holdout_elo["log_loss_home_win"] - holdout_adjusted["log_loss_home_win"], 6)
    gates = {
        "minimum_holdout_games": len(holdout) >= MIN_HOLDOUT_GAMES,
        "coefficient_has_expected_negative_sign": fit["coefficient"] < 0,
        "holdout_brier_improves": brier_improvement > 0,
        "holdout_log_loss_improves": log_loss_improvement > 0,
        "extreme_quartile_residual_contrast_has_expected_negative_sign": direction["high_minus_low_elo_residual"] < 0,
    }
    passed = all(gates.values())
    finding = "held-out-incremental-signal" if passed else (
        "underpowered" if not gates["minimum_holdout_games"] else "no-held-out-improvement"
    )
    return {
        "qualified_games": len(feature_rows),
        "training": {
            "n_games": len(train),
            "first_kickoff_at": train[0]["kickoff_at"],
            "last_kickoff_at": train[-1]["kickoff_at"],
            "elo_baseline": train_elo,
            "elo_plus_divergence": train_adjusted,
        },
        "holdout": {
            "n_games": len(holdout),
            "first_kickoff_at": cutoff,
            "last_kickoff_at": holdout[-1]["kickoff_at"],
            "elo_baseline": holdout_elo,
            "elo_plus_divergence": holdout_adjusted,
            "brier_improvement_over_elo": brier_improvement,
            "log_loss_improvement_over_elo": log_loss_improvement,
            "directional_summary": direction,
        },
        "fit": {
            "feature_standardization_mean_training_only": round(fit["feature_mean"], 6),
            "feature_standardization_scale_training_only": round(fit["feature_scale"], 6),
            "log_odds_coefficient": round(fit["coefficient"], 8),
            "iterations": fit["iterations"],
            "expected_coefficient_sign": "negative",
            "intercept_fitted": False,
        },
        "promotion_gate": {"passed": passed, "checks": gates},
        "finding": finding,
    }


def build(
    team_game_envelope: dict[str, Any],
    elo_envelope: dict[str, Any],
    eval_rows: list[dict[str, Any]],
    season_provenance: list[dict[str, str]],
) -> dict[str, Any]:
    elo_data = elo_envelope.get("data")
    if not isinstance(elo_data, dict) or elo_data.get("backtest", {}).get("kind") != "retrodictive-backtest":
        raise ContractError("cfb-elo input must contain the retrodictive baseline")
    if season_provenance != elo_data.get("seasons_ingested"):
        raise ContractError("private Elo run does not match the published season snapshots")
    if len(eval_rows) != elo_data["backtest"]["n_games"]:
        raise ContractError("private Elo evaluation row count differs from the published baseline")
    features = build_feature_rows(team_game_envelope, eval_rows)
    result = analyze(features)
    return {
        "schema_version": 1,
        "season": team_game_envelope["data"]["season"],
        "status": "retrodictive-chronological-validation",
        "hypothesis": (
            "Holding Elo fixed, the team whose observed record ranks further ahead of its scoring margin "
            "should underperform; the incremental log-odds coefficient should therefore be negative."
        ),
        "inputs": {
            "team_game_snapshot_id": team_game_envelope["integrity"]["snapshot_id"],
            "elo_snapshot_id": elo_envelope["integrity"]["snapshot_id"],
            "elo_season_source_snapshots": season_provenance,
        },
        "design": {
            "feature": "home record_scoring_rank_gap minus away record_scoring_rank_gap",
            "minimum_prior_completed_games_per_team": MIN_PRIOR_GAMES,
            "pregame_only": True,
            "simultaneous_kickoffs_batched_before_state_update": True,
            "split": "first 60% training / final 40% holdout at nearest whole-kickoff boundary",
            "model": "logit(p_home) = logit(p_elo_home) + beta * standardized_relative_gap",
            "fitted_parameters": ["beta"],
            "intercept_fitted": False,
            "market_adjusted": False,
        },
        "result": result,
        "roadmap_decision": {
            "lifecycle_status": "evaluating",
            "team_labels_permitted": False,
            "prospective_value_claimed": False,
            "reason": (
                "A single-season retrodictive chronological holdout can challenge the feature but cannot "
                "authorize current-team fraud labels. Prospective receipts and timestamped market adjustment remain required."
            ),
        },
        "published_granularity": "aggregate-only; no game IDs, team identities or per-game predictions are serialized",
    }


def make_envelope(payload: dict[str, Any], captured_at: str) -> dict[str, Any]:
    finding = payload["result"]["finding"]
    return {
        "as_of": captured_at[:10],
        "source": (
            "Leakage-resistant chronological evaluation of /data/cfb-team-game.json record-versus-scoring "
            "divergence against the exact /data/cfb-elo.json baseline snapshots."
        ),
        "tier": "labs",
        "graded": False,
        "note": (
            f"RETRODICTIVE AGGREGATE VALIDATION. Finding: {finding}. This is not a prospective grade, "
            "not market-adjusted, and does not call any team overrated, underrated or a fraud."
        ),
        "provenance": {
            "generator": "scripts/cfb_record_divergence_validation.py",
            "captured_at": captured_at,
            "private_rows_serialized": False,
        },
        "integrity": {
            "snapshot_id": backbone.sha256_id(payload),
            "algorithm": "SHA-256 of canonical UTF-8 JSON for the data object (sorted object keys, no insignificant whitespace).",
            "qualified_games": payload["result"]["qualified_games"],
        },
        "data": payload,
        "tier_meaning": backbone.TIER_MEANING,
        "built": captured_at[:10],
        "canonical_url": "https://datadawgs216.com/data/cfb-record-divergence-validation.json",
    }


def validate_envelope(envelope: dict[str, Any], team_game: dict[str, Any], elo_envelope: dict[str, Any]) -> None:
    data = envelope.get("data")
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise ContractError("record-divergence validation must use schema_version 1")
    if data.get("status") != "retrodictive-chronological-validation" or envelope.get("graded") is not False:
        raise ContractError("record-divergence validation misstates its evidence class")
    inputs = data.get("inputs", {})
    if inputs.get("team_game_snapshot_id") != team_game.get("integrity", {}).get("snapshot_id"):
        raise ContractError("record-divergence validation team-game snapshot drifted")
    if inputs.get("elo_snapshot_id") != elo_envelope.get("integrity", {}).get("snapshot_id"):
        raise ContractError("record-divergence validation Elo snapshot drifted")
    if inputs.get("elo_season_source_snapshots") != elo_envelope.get("data", {}).get("seasons_ingested"):
        raise ContractError("record-divergence validation Elo source snapshots drifted")
    decision = data.get("roadmap_decision", {})
    if decision.get("team_labels_permitted") is not False or decision.get("prospective_value_claimed") is not False:
        raise ContractError("record-divergence validation overstates predictive evidence")
    design = data.get("design", {})
    if design.get("pregame_only") is not True or design.get("simultaneous_kickoffs_batched_before_state_update") is not True:
        raise ContractError("record-divergence validation leakage controls are absent")
    result = data.get("result", {})
    checks = result.get("promotion_gate", {}).get("checks", {})
    passed = bool(checks) and all(value is True for value in checks.values())
    if result.get("promotion_gate", {}).get("passed") is not passed:
        raise ContractError("record-divergence validation promotion gate does not reconcile")
    expected_finding = "held-out-incremental-signal" if passed else (
        "underpowered" if checks.get("minimum_holdout_games") is False else "no-held-out-improvement"
    )
    if result.get("finding") != expected_finding:
        raise ContractError("record-divergence validation finding does not reconcile")
    holdout = result.get("holdout", {})
    elo_score = holdout.get("elo_baseline", {})
    adjusted_score = holdout.get("elo_plus_divergence", {})
    if round(elo_score.get("brier_home_win", math.nan) - adjusted_score.get("brier_home_win", math.nan), 6) != holdout.get("brier_improvement_over_elo"):
        raise ContractError("record-divergence validation Brier delta does not reconcile")
    if round(elo_score.get("log_loss_home_win", math.nan) - adjusted_score.get("log_loss_home_win", math.nan), 6) != holdout.get("log_loss_improvement_over_elo"):
        raise ContractError("record-divergence validation log-loss delta does not reconcile")
    serialized = json.dumps(data, sort_keys=True)
    for forbidden in ('"game_id"', '"home_team_slug"', '"away_team_slug"', '"predictive_label"'):
        if forbidden in serialized:
            raise ContractError(f"record-divergence validation serialized private row field {forbidden}")
    if envelope.get("integrity", {}).get("snapshot_id") != backbone.sha256_id(data):
        raise ContractError("record-divergence validation snapshot hash mismatch")
    if envelope.get("integrity", {}).get("qualified_games") != result.get("qualified_games"):
        raise ContractError("record-divergence validation qualified game count disagrees")


def cmd_refresh(args: argparse.Namespace) -> int:
    team_game = backbone.read_json(Path(args.team_game))
    elo_envelope = backbone.read_json(Path(args.elo))
    backtest = elo.run_backtest()
    payload = build(team_game, elo_envelope, backtest["_eval_rows"], backtest["season_provenance"])
    captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    envelope = make_envelope(payload, captured_at)
    validate_envelope(envelope, team_game, elo_envelope)
    backbone.write_json(Path(args.output), envelope)
    result = payload["result"]
    print(
        f"wrote {args.output}: {result['qualified_games']} qualified games, "
        f"{result['holdout']['n_games']} holdout, finding {result['finding']}"
    )
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    team_game = backbone.read_json(Path(args.team_game))
    elo_envelope = backbone.read_json(Path(args.elo))
    validate_envelope(backbone.read_json(Path(args.output)), team_game, elo_envelope)
    print(f"{args.output} satisfies the aggregate record-divergence validation contract")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text, func in (
        ("refresh", "run the chronological experiment and publish aggregate evidence", cmd_refresh),
        ("validate", "validate the published aggregate evidence offline", cmd_validate),
    ):
        command = sub.add_parser(name, help=help_text)
        command.add_argument("--team-game", default=str(DEFAULT_TEAM_GAME))
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
