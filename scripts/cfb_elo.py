#!/usr/bin/env python3
"""Data Dawgs CFB Elo baseline (roadmap step 2, idea cfb-elo).

A deliberately simple, fully deterministic Elo over the canonical CFB schedule
facts. Its job is to be the interpretable baseline every fancier CFB model must
beat (governance: Baseline Requirement) — not to be good.

All parameters are fixed here, before any evaluation, and recorded in the
output. The published numbers are a RETRODICTIVE BACKTEST on the completed
2025 season after a 2018-2024 burn-in. They demonstrate the pipeline and the
baseline's honest performance on one past season; they say nothing about 2026
until prospective receipts exist.

Design choices (all limitations, all recorded):
- Only FBS-involved games from the canonical backbone are used.
- Non-FBS opponents are a single frozen 1200-rated pool; their rating never
  updates and they are excluded from evaluation.
- Every FBS team enters at 1500 the first time it appears, including
  transitioning programs, which overrates them early.
- Between seasons each rating reverts one third of the way to 1500.
- Home-field advantage is a flat +55 Elo unless the game is a neutral site.
- Margin-of-victory multiplier is the Silver-style ln(margin+1) damping.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import io
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "cfb-elo.json"

_SPEC = importlib.util.spec_from_file_location("cfb_data_backbone", ROOT / "scripts" / "cfb_data_backbone.py")
backbone = importlib.util.module_from_spec(_SPEC)
sys.modules.setdefault(_SPEC.name, backbone)
_SPEC.loader.exec_module(backbone)

PARAMS = {
    "base_rating": 1500.0,
    "non_fbs_pool_rating": 1200.0,
    "k_factor": 35.0,
    "home_field_elo": 55.0,
    "season_reversion_to_mean": 1.0 / 3.0,
    "mov_formula": "ln(|margin|+1) * 2.2 / (0.001*|winner_elo_diff| + 2.2)",
    "burn_in_seasons": [2018, 2019, 2020, 2021, 2022, 2023, 2024],
    "evaluation_season": 2025,
}

ContractError = backbone.ContractError


def expected_home_prob(home_elo: float, away_elo: float, neutral: bool) -> float:
    diff = home_elo - away_elo + (0.0 if neutral else PARAMS["home_field_elo"])
    return 1.0 / (1.0 + 10.0 ** (-diff / 400.0))


def mov_multiplier(margin: int, winner_elo_diff: float) -> float:
    return math.log(abs(margin) + 1.0) * 2.2 / (0.001 * abs(winner_elo_diff) + 2.2)


class EloModel:
    def __init__(self) -> None:
        self.ratings: dict[str, float] = {}
        self.games_rated: dict[str, int] = {}
        self.team_names: dict[str, str] = {}
        self.team_conferences: dict[str, str | None] = {}
        self.current_season: int | None = None

    def rating_of(self, slug: str | None) -> float:
        if slug is None:
            return PARAMS["non_fbs_pool_rating"]
        return self.ratings.setdefault(slug, PARAMS["base_rating"])

    def start_season(self, season: int) -> None:
        if self.current_season is not None and season != self.current_season:
            revert = PARAMS["season_reversion_to_mean"]
            for slug, rating in self.ratings.items():
                self.ratings[slug] = rating + revert * (PARAMS["base_rating"] - rating)
        self.current_season = season

    def process_game(self, game: dict[str, Any]) -> dict[str, float] | None:
        """Update ratings from one final game; returns the pregame view or None."""
        if game["status"] != "final":
            return None
        home_slug = game["home_team_slug"] if game["home_division"] == "fbs" else None
        away_slug = game["away_team_slug"] if game["away_division"] == "fbs" else None
        if home_slug is None and away_slug is None:
            return None
        home_elo = self.rating_of(home_slug)
        away_elo = self.rating_of(away_slug)
        p_home = expected_home_prob(home_elo, away_elo, game["neutral_site"])
        margin = game["home_points"] - game["away_points"]
        if margin == 0:
            return None  # modern CFB has no ties; ignore defensively rather than guess
        home_won = margin > 0
        winner_diff = (home_elo - away_elo) if home_won else (away_elo - home_elo)
        delta = PARAMS["k_factor"] * mov_multiplier(margin, winner_diff) * ((1.0 if home_won else 0.0) - p_home)
        for slug, sign in ((home_slug, 1.0), (away_slug, -1.0)):
            if slug is not None:
                self.ratings[slug] += sign * delta
                self.games_rated[slug] = self.games_rated.get(slug, 0) + 1
        for side, slug in (("home", home_slug), ("away", away_slug)):
            if slug is not None:
                self.team_names[slug] = game[f"{side}_team"]
                self.team_conferences[slug] = game[f"{side}_conference"]
        return {"p_home_pregame": p_home, "home_elo_pregame": home_elo, "away_elo_pregame": away_elo}


def load_season(season: int) -> tuple[list[dict[str, Any]], dict[str, str], list[dict[str, Any]]]:
    text, source_sha256 = backbone.fetch_source(season)
    raw_rows = list(csv.DictReader(io.StringIO(text)))
    games = backbone.canonicalize_source_rows(raw_rows, season)
    provenance = {"season": str(season), "source_raw_sha256": source_sha256, "rows_canonical": str(len(games))}
    return games, provenance, raw_rows


def load_market_probabilities(path: Path) -> tuple[dict[str, float], str | None]:
    """Median devigged home win probability per canonical game, if the file exists.

    Timing is unknown for every price in that file (see scripts/cfb_market.py).
    The caller must carry that caveat into anything it publishes.
    """
    if not path.exists():
        return {}, None
    envelope = backbone.read_json(path)
    probabilities = {
        game["game_id"]: game["median_devig_home_win_probability"]
        for game in envelope["data"]["games"]
        if game.get("median_devig_home_win_probability") is not None
    }
    return probabilities, envelope["integrity"]["snapshot_id"]


CALIBRATION_EDGES = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]


def calibration_bins(rows: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    """Predicted vs observed home win rate in fixed probability bins.

    Fixed edges, not quantiles, so bins stay comparable across refreshes and
    across models. Sparse bins are published with their count rather than
    merged away; a bin of 12 games is not evidence and its n says so.
    """
    bins = []
    for low, high in zip(CALIBRATION_EDGES, CALIBRATION_EDGES[1:]):
        members = [r for r in rows
                   if r[key] is not None and (low <= r[key] < high or (high == 1.0 and r[key] == 1.0))]
        if not members:
            bins.append({"bin_low": low, "bin_high": high, "n": 0,
                         "mean_predicted": None, "observed_home_win_rate": None})
            continue
        bins.append({
            "bin_low": low,
            "bin_high": high,
            "n": len(members),
            "mean_predicted": round(sum(r[key] for r in members) / len(members), 4),
            "observed_home_win_rate": round(sum(r["home_won"] for r in members) / len(members), 4),
        })
    return bins


def run_backtest(market_path: Path | None = None) -> dict[str, Any]:
    model = EloModel()
    season_provenance: list[dict[str, str]] = []
    eval_rows: list[dict[str, Any]] = []
    espn_upsets_checkable = espn_favorite_hits = 0
    market_probabilities, market_snapshot = load_market_probabilities(
        market_path or (ROOT / "data" / "cfb-market.json")
    )

    seasons = PARAMS["burn_in_seasons"] + [PARAMS["evaluation_season"]]
    for season in seasons:
        games, provenance, raw_rows = load_season(season)
        season_provenance.append(provenance)
        model.start_season(season)
        espn_pregame = {}
        if season == PARAMS["evaluation_season"]:
            for raw in raw_rows:
                home_elo = backbone.nullable_int(raw.get("home_pregame_elo"))
                away_elo = backbone.nullable_int(raw.get("away_pregame_elo"))
                if home_elo is not None and away_elo is not None:
                    espn_pregame[str(raw["game_id"]).strip()] = (home_elo, away_elo)
        for game in games:
            fbs_vs_fbs = game["home_division"] == "fbs" and game["away_division"] == "fbs"
            pregame = model.process_game(game)
            if pregame is None or season != PARAMS["evaluation_season"] or not fbs_vs_fbs:
                continue
            home_won = game["home_points"] > game["away_points"]
            eval_rows.append({
                "p_home": pregame["p_home_pregame"],
                "home_won": home_won,
                "favorite_hit": (pregame["p_home_pregame"] >= 0.5) == home_won,
                "market_p_home": market_probabilities.get(game["game_id"]),
            })
            espn = espn_pregame.get(game["upstream_game_id"])
            if espn is not None and espn[0] != espn[1]:
                espn_upsets_checkable += 1
                if (espn[0] > espn[1]) == home_won:
                    espn_favorite_hits += 1

    n = len(eval_rows)
    if n < 500:
        raise ContractError(f"suspiciously small evaluation set: {n} FBS-vs-FBS finals")
    home_wins = sum(r["home_won"] for r in eval_rows)
    brier = sum((r["p_home"] - (1.0 if r["home_won"] else 0.0)) ** 2 for r in eval_rows) / n
    home_rate = home_wins / n
    climatological_brier = home_rate * (1 - home_rate)  # constant-p forecast at the observed rate

    calibration = calibration_bins(eval_rows, "p_home")

    # Head-to-head against the market, scored on the SAME games only. Anything else
    # would compare two different question sets and call it a result.
    paired = [r for r in eval_rows if r["market_p_home"] is not None]
    market_block: dict[str, Any] | None = None
    if paired:
        m = len(paired)
        def score(key: str) -> dict[str, float]:
            return {
                "favorite_accuracy": round(
                    sum((r[key] >= 0.5) == r["home_won"] for r in paired) / m, 4),
                "brier_home_win": round(
                    sum((r[key] - (1.0 if r["home_won"] else 0.0)) ** 2 for r in paired) / m, 4),
            }
        market_block = {
            "n_games": m,
            "coverage_of_evaluation_set": round(m / n, 4),
            "market_median_devig": score("market_p_home"),
            "elo_baseline_same_games": score("p_home"),
            "market_calibration_bins": calibration_bins(paired, "market_p_home"),
            "elo_calibration_bins_same_games": calibration_bins(paired, "p_home"),
            "market_snapshot_id": market_snapshot,
            "timing_caveat": (
                "Prices in data/cfb-market.json carry no observation timestamp. They are not "
                "closing lines and their timing is unknown. If they are late they contain "
                "information the Elo did not have, so this comparison flatters the market. "
                "It is a reference point, not a verdict."
            ),
        }
    return {
        "season_provenance": season_provenance,
        "ratings": sorted(
            (
                {
                    "team_slug": slug,
                    "team": model.team_names.get(slug, slug),
                    "conference": model.team_conferences.get(slug),
                    "rating": round(rating, 1),
                    "games_rated": model.games_rated.get(slug, 0),
                }
                for slug, rating in model.ratings.items()
            ),
            key=lambda row: -row["rating"],
        ),
        "backtest": {
            "kind": "retrodictive-backtest",
            "evaluation_season": PARAMS["evaluation_season"],
            "evaluation_set": "FBS-vs-FBS final games",
            "n_games": n,
            "elo_baseline": {
                "favorite_accuracy": round(sum(r["favorite_hit"] for r in eval_rows) / n, 4),
                "brier_home_win": round(brier, 4),
            },
            "calibration": {
                "method": "fixed 0.1-wide probability bins over the home win probability",
                "bins": calibration,
            },
            "reference_points": {
                "always_pick_home_accuracy": round(max(home_rate, 1 - home_rate), 4),
                "observed_home_win_rate": round(home_rate, 4),
                "climatological_brier": round(climatological_brier, 4),
                "espn_pregame_elo_favorite_accuracy": (
                    round(espn_favorite_hits / espn_upsets_checkable, 4) if espn_upsets_checkable else None
                ),
                "espn_note": (
                    "Favorite accuracy only, computed from the pregame Elo columns in the raw "
                    "snapshot over the games where both are present and unequal "
                    f"({espn_upsets_checkable} games). No probability comparison: converting "
                    "someone else's Elo to a probability requires assumptions they did not publish."
                ),
            },
            "versus_market": market_block,
        },
    }


def make_envelope(result: dict[str, Any], repo_head: str, captured_at: str) -> dict[str, Any]:
    payload = {
        "params": PARAMS,
        "seasons_ingested": result["season_provenance"],
        "ratings_as_of_end_of_2025": result["ratings"],
        "backtest": result["backtest"],
    }
    return {
        "as_of": captured_at[:10],
        "source": (
            f"Deterministic Elo over canonical cfbfastR-data schedule facts, seasons 2018-2025 "
            f"(source repository HEAD {repo_head} at capture; per-season raw hashes inside)."
        ),
        "tier": "labs",
        "graded": False,
        "note": (
            "MODELLED OUTPUT, and a deliberately simple baseline at that. The backtest is "
            "retrodictive: 2025 outcomes were known before this file was built. It exists so "
            "future CFB models have an interpretable floor to beat (Baseline Requirement). "
            "No prospective CFB forecast receipts exist yet; nothing here is graded."
        ),
        "provenance": {
            "engine": "scripts/cfb_elo.py",
            "inputs": "data/cfb-schedule.json contract via scripts/cfb_data_backbone.py canonicalization",
            "source_repository": backbone.SOURCE_REPOSITORY,
            "source_repo_head_at_capture": repo_head,
            "parameters_fixed_before_evaluation": True,
            "captured_at": captured_at,
        },
        "integrity": {
            "snapshot_id": backbone.sha256_id(payload),
            "algorithm": (
                "SHA-256 of canonical UTF-8 JSON for the data object "
                "(sorted object keys, no insignificant whitespace)."
            ),
            "rated_teams": len(result["ratings"]),
        },
        "data": payload,
        "tier_meaning": backbone.TIER_MEANING,
        "built": captured_at[:10],
        "canonical_url": "https://datadawgs216.com/data/cfb-elo.json",
    }


def validate_envelope(envelope: dict[str, Any]) -> None:
    data = envelope.get("data")
    if not isinstance(data, dict):
        raise ContractError("cfb-elo data must be an object")
    expected = backbone.sha256_id(data)
    if envelope.get("integrity", {}).get("snapshot_id") != expected:
        raise ContractError("cfb-elo snapshot hash mismatch")
    ratings = data.get("ratings_as_of_end_of_2025")
    if not isinstance(ratings, list) or not ratings:
        raise ContractError("cfb-elo ratings must be a non-empty array")
    low, high = backbone.FBS_TEAM_RANGE
    if not low <= len(ratings) <= high + 15:
        raise ContractError(f"suspicious rated team count: {len(ratings)}")
    last = math.inf
    for row in ratings:
        if not isinstance(row.get("rating"), (int, float)) or not math.isfinite(row["rating"]):
            raise ContractError(f"non-finite rating for {row.get('team_slug')}")
        if row["rating"] > last:
            raise ContractError("ratings must be sorted descending")
        last = row["rating"]
    backtest = data.get("backtest", {})
    if backtest.get("kind") != "retrodictive-backtest":
        raise ContractError("backtest must declare itself retrodictive")
    for field in ("favorite_accuracy", "brier_home_win"):
        value = backtest.get("elo_baseline", {}).get(field)
        if not isinstance(value, (int, float)) or not 0 <= value <= 1:
            raise ContractError(f"backtest {field} out of range")
    if data.get("params") != PARAMS:
        raise ContractError("published params differ from the pinned params in scripts/cfb_elo.py")


def cmd_refresh(args: argparse.Namespace) -> int:
    captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    repo_head = backbone.fetch_source_repo_head()
    result = run_backtest()
    envelope = make_envelope(result, repo_head, captured_at)
    validate_envelope(envelope)
    backbone.write_json(Path(args.output), envelope)
    top = result["ratings"][0]
    bt = result["backtest"]["elo_baseline"]
    print(f"wrote {args.output}: {len(result['ratings'])} rated teams, "
          f"top {top['team']} {top['rating']}, 2025 backtest favorite accuracy "
          f"{bt['favorite_accuracy']}, Brier {bt['brier_home_win']}")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    validate_envelope(backbone.read_json(Path(args.output)))
    print(f"{args.output} satisfies the CFB Elo contract")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    refresh = sub.add_parser("refresh", help="ingest 2018-2025, run the backtest, write the envelope")
    refresh.add_argument("--output", default=str(DEFAULT_OUTPUT))
    refresh.set_defaults(func=cmd_refresh)
    validate = sub.add_parser("validate", help="validate the published file (offline)")
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
