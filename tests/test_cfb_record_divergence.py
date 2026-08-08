import copy
import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "cfb_record_divergence", ROOT / "scripts" / "cfb_record_divergence.py"
)
divergence = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = divergence
SPEC.loader.exec_module(divergence)


class RecordDivergenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.team_game = divergence.backbone.read_json(ROOT / "data" / "cfb-team-game.json")
        cls.profiles = divergence.backbone.read_json(ROOT / "data" / "cfb-teams.json")
        cls.envelope = divergence.backbone.read_json(ROOT / "data" / "cfb-record-divergence.json")

    def test_published_baseline_validates(self):
        divergence.validate_envelope(self.envelope, self.team_game, self.profiles)

    def test_every_fbs_profile_has_one_row(self):
        rows = self.envelope["data"]["rows"]
        self.assertEqual(len(rows), 136)
        self.assertEqual({row["team_slug"] for row in rows},
                         {row["team_slug"] for row in self.profiles["data"]["teams"]})

    def test_rank_gap_is_exact_and_directional(self):
        for row in self.envelope["data"]["rows"]:
            self.assertEqual(row["record_scoring_rank_gap"], row["scoring_rank"] - row["record_rank"])
            expected = "record-ahead-of-scoring" if row["record_scoring_rank_gap"] > 0 else \
                "scoring-ahead-of-record" if row["record_scoring_rank_gap"] < 0 else "aligned"
            self.assertEqual(row["descriptive_direction"], expected)

    def test_competition_ranks_stay_on_the_team_count_scale(self):
        rows = self.envelope["data"]["rows"]
        self.assertGreater(max(row["record_rank"] for row in rows), 120)
        self.assertLessEqual(max(row["record_rank"] for row in rows), len(rows))
        self.assertLessEqual(max(row["scoring_rank"] for row in rows), len(rows))

    def test_one_score_records_reconcile_with_team_games(self):
        for row in self.envelope["data"]["rows"]:
            close = [game for game in self.team_game["data"]["rows"]
                     if game["team_slug"] == row["team_slug"] and game["result"] is not None and
                     abs(game["point_differential"]) <= 8]
            summary = row["one_score_games"]
            self.assertEqual(summary["games"], len(close))
            self.assertEqual(summary["wins"] + summary["losses"] + summary["ties"], len(close))

    def test_no_predictive_or_fraud_labels_are_published(self):
        validation = self.envelope["data"]["predictive_validation"]
        self.assertEqual(validation["status"], "evaluated-separately")
        self.assertEqual(validation["evidence_url"], "/data/cfb-record-divergence-validation.json")
        self.assertFalse(validation["forward_value_claimed"])
        self.assertFalse(validation["team_labels_permitted"])
        self.assertIn("prospective receipts", validation["remaining_gate"])
        self.assertTrue(all(row["predictive_label"] is None for row in self.envelope["data"]["rows"]))
        self.assertIn("not a Fraud Detector verdict", self.envelope["note"])

    def test_snapshot_tamper_is_rejected(self):
        broken = copy.deepcopy(self.envelope)
        broken["data"]["rows"][0]["record_rank"] += 1
        with self.assertRaises(divergence.ContractError):
            divergence.validate_envelope(broken, self.team_game, self.profiles)

    def test_rehashed_source_drift_is_still_rejected(self):
        broken = copy.deepcopy(self.envelope)
        broken["data"]["rows"][0]["record_rank"] += 1
        broken["integrity"]["snapshot_id"] = divergence.backbone.sha256_id(broken["data"])
        with self.assertRaisesRegex(divergence.ContractError, "drifts"):
            divergence.validate_envelope(broken, self.team_game, self.profiles)

    def test_build_is_deterministic(self):
        self.assertEqual(divergence.build(self.team_game, self.profiles),
                         divergence.build(self.team_game, self.profiles))


if __name__ == "__main__":
    unittest.main()
