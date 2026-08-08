import copy
import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "cfb_record_divergence_validation",
    ROOT / "scripts" / "cfb_record_divergence_validation.py",
)
validation = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = validation
SPEC.loader.exec_module(validation)


def synthetic_rows(count=40):
    rows = []
    for i in range(count):
        gap = -20 if i % 2 == 0 else 20
        directional_win = gap < 0
        # Keep a real directional signal without perfect separation, which would
        # correctly send an unregularized one-parameter logistic fit to infinity.
        home_won = not directional_win if i % 7 == 0 else directional_win
        rows.append({
            "game_id": f"game-{i:03d}",
            "kickoff_at": f"2025-10-{i // 2 + 1:02d}T12:00:00Z",
            "relative_record_scoring_gap": gap,
            "p_elo_home": 0.5,
            "home_won": 1.0 if home_won else 0.0,
        })
    return rows


class RecordDivergenceValidationMathTests(unittest.TestCase):
    def test_expected_negative_incremental_coefficient_is_recovered(self):
        rows = synthetic_rows()
        train, holdout, _ = validation.chronological_split(rows)
        fit = validation.fit_incremental_coefficient(train)
        self.assertLess(fit["coefficient"], 0)
        self.assertLess(
            validation.score(holdout, fit=fit)["brier_home_win"],
            validation.score(holdout, probability_key="p_elo_home")["brier_home_win"],
        )

    def test_split_never_divides_one_kickoff_between_sets(self):
        train, holdout, cutoff = validation.chronological_split(synthetic_rows())
        self.assertTrue(all(row["kickoff_at"] < cutoff for row in train))
        self.assertTrue(all(row["kickoff_at"] >= cutoff for row in holdout))
        self.assertTrue({row["kickoff_at"] for row in train}.isdisjoint(
            {row["kickoff_at"] for row in holdout}
        ))

    def test_zero_variance_feature_fails_closed(self):
        rows = synthetic_rows()
        for row in rows:
            row["relative_record_scoring_gap"] = 0
        with self.assertRaisesRegex(validation.ContractError, "zero variance"):
            validation.fit_incremental_coefficient(rows)

    def test_simultaneous_results_cannot_change_each_others_features(self):
        teams = {slug: {"division": "fbs"} for slug in ("a", "b", "c", "d")}
        rows = [
            {"game_id": "ab", "kickoff_at": "2025-09-01T12:00:00Z", "team_side": "home",
             "team_slug": "a", "opponent_slug": "b", "result": "win", "point_differential": 10},
            {"game_id": "cd", "kickoff_at": "2025-09-01T12:00:00Z", "team_side": "home",
             "team_slug": "c", "opponent_slug": "d", "result": "loss", "point_differential": -7},
            {"game_id": "ac", "kickoff_at": "2025-09-08T12:00:00Z", "team_side": "home",
             "team_slug": "a", "opponent_slug": "c", "result": "loss", "point_differential": -40},
            {"game_id": "bd", "kickoff_at": "2025-09-08T12:00:00Z", "team_side": "home",
             "team_slug": "b", "opponent_slug": "d", "result": "win", "point_differential": 3},
        ]
        team_game = {"data": {"scope": "results-only", "teams": teams, "rows": rows}}
        private = [
            {"game_id": "ac", "kickoff_at": "2025-09-08T12:00:00Z", "home_team_slug": "a",
             "away_team_slug": "c", "p_home": 0.5, "home_won": False},
            {"game_id": "bd", "kickoff_at": "2025-09-08T12:00:00Z", "home_team_slug": "b",
             "away_team_slug": "d", "p_home": 0.5, "home_won": True},
        ]
        built = validation.build_feature_rows(team_game, private, min_prior_games=1)
        by_id = {row["game_id"]: row for row in built}
        self.assertEqual(by_id["bd"]["relative_record_scoring_gap"], 0)

        changed = copy.deepcopy(team_game)
        changed["data"]["rows"][2]["result"] = "win"
        changed["data"]["rows"][2]["point_differential"] = 80
        rebuilt = validation.build_feature_rows(changed, private, min_prior_games=1)
        rebuilt_by_id = {row["game_id"]: row for row in rebuilt}
        self.assertEqual(by_id["bd"], rebuilt_by_id["bd"])


class PublishedRecordDivergenceValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.team_game = validation.backbone.read_json(ROOT / "data" / "cfb-team-game.json")
        cls.elo = validation.backbone.read_json(ROOT / "data" / "cfb-elo.json")
        cls.envelope = validation.backbone.read_json(
            ROOT / "data" / "cfb-record-divergence-validation.json"
        )

    def test_published_aggregate_validates(self):
        validation.validate_envelope(self.envelope, self.team_game, self.elo)

    def test_holdout_is_later_and_large_enough(self):
        result = self.envelope["data"]["result"]
        self.assertLess(result["training"]["last_kickoff_at"], result["holdout"]["first_kickoff_at"])
        self.assertGreaterEqual(result["holdout"]["n_games"], validation.MIN_HOLDOUT_GAMES)

    def test_no_private_rows_or_team_labels_are_published(self):
        serialized = json.dumps(self.envelope, sort_keys=True)
        for forbidden in ('"game_id"', '"home_team_slug"', '"away_team_slug"', '"predictive_label"'):
            self.assertNotIn(forbidden, serialized)
        decision = self.envelope["data"]["roadmap_decision"]
        self.assertFalse(decision["team_labels_permitted"])
        self.assertFalse(decision["prospective_value_claimed"])

    def test_rehashed_source_drift_is_rejected(self):
        broken = copy.deepcopy(self.envelope)
        broken["data"]["inputs"]["elo_snapshot_id"] = "sha256:" + "0" * 64
        broken["integrity"]["snapshot_id"] = validation.backbone.sha256_id(broken["data"])
        with self.assertRaisesRegex(validation.ContractError, "Elo snapshot drifted"):
            validation.validate_envelope(broken, self.team_game, self.elo)

    def test_promotion_gate_and_finding_reconcile(self):
        result = self.envelope["data"]["result"]
        self.assertEqual(result["promotion_gate"]["passed"], all(result["promotion_gate"]["checks"].values()))
        self.assertEqual(result["finding"], "held-out-incremental-signal")


if __name__ == "__main__":
    unittest.main()
