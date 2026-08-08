import copy
import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "cfb_team_profiles", ROOT / "scripts" / "cfb_team_profiles.py"
)
profiles = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = profiles
SPEC.loader.exec_module(profiles)


class TeamProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.team_week = profiles.backbone.read_json(ROOT / "data" / "cfb-team-week.json")
        cls.ratings = profiles.backbone.read_json(ROOT / "data" / "cfb-ratings.json")
        cls.envelope = profiles.backbone.read_json(ROOT / "data" / "cfb-teams.json")

    def test_published_profiles_validate_against_both_inputs(self):
        profiles.validate_envelope(self.envelope, self.team_week, self.ratings)

    def test_every_registry_team_has_one_compact_profile(self):
        actual = self.envelope["data"]["teams"]
        expected = self.ratings["data"]["teams"]
        self.assertEqual(len(actual), 136)
        self.assertEqual({row["team_slug"] for row in actual}, {row["team_slug"] for row in expected})
        self.assertTrue(all(row["division"] == "fbs" for row in actual))

    def test_observed_and_modelled_values_are_separate(self):
        ohio = next(row for row in self.envelope["data"]["teams"] if row["team_slug"] == "ohio-state")
        self.assertEqual(ohio["observed_results"]["record"], "12-2-0")
        self.assertEqual(ohio["observed_results"]["point_differential"], 338)
        self.assertEqual(ohio["systems"][profiles.ratings_registry.SYSTEM_ID]["rank"], 2)
        self.assertEqual(ohio["systems"][profiles.ratings_registry.SYSTEM_ID]["win_probability"], None)

    def test_descriptive_rates_reproduce_from_totals(self):
        for row in self.envelope["data"]["teams"]:
            observed = row["observed_results"]
            games = observed["games"]
            self.assertEqual(observed["win_percentage"], round((observed["wins"] + 0.5 * observed["ties"]) / games, 4))
            self.assertEqual(observed["point_differential_per_game"], round(observed["point_differential"] / games, 3))

    def test_input_snapshot_receipts_are_exact(self):
        inputs = self.envelope["data"]["inputs"]
        self.assertEqual(inputs["team_week_snapshot_id"], self.team_week["integrity"]["snapshot_id"])
        self.assertEqual(inputs["ratings_registry_snapshot_id"], self.ratings["integrity"]["snapshot_id"])

    def test_one_rating_still_is_not_consensus_or_forecast(self):
        self.assertEqual(self.envelope["data"]["consensus"]["status"], "not-built")
        self.assertIsNone(self.envelope["data"]["consensus"]["weights"])
        self.assertIn("2026 forecast", self.envelope["data"]["unsupported"])
        self.assertIn("not a 2026 forecast", self.envelope["note"])

    def test_rehashed_join_tamper_is_rejected(self):
        broken = copy.deepcopy(self.envelope)
        broken["data"]["teams"][0]["observed_results"]["wins"] += 1
        broken["integrity"]["snapshot_id"] = profiles.backbone.sha256_id(broken["data"])
        with self.assertRaisesRegex(profiles.ContractError, "drifts"):
            profiles.validate_envelope(broken, self.team_week, self.ratings)

    def test_build_is_deterministic(self):
        self.assertEqual(profiles.build(self.team_week, self.ratings), profiles.build(self.team_week, self.ratings))


if __name__ == "__main__":
    unittest.main()
