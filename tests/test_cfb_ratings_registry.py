import copy
import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "cfb_ratings_registry", ROOT / "scripts" / "cfb_ratings_registry.py"
)
registry = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = registry
SPEC.loader.exec_module(registry)


class RatingsRegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.elo = registry.backbone.read_json(ROOT / "data" / "cfb-elo.json")
        cls.path = ROOT / "data" / "cfb-ratings.json"
        if not cls.path.exists():
            raise unittest.SkipTest("data/cfb-ratings.json not built yet")
        cls.envelope = registry.backbone.read_json(cls.path)

    def test_published_registry_validates_against_current_elo(self):
        registry.validate_envelope(self.envelope, self.elo)

    def test_registry_is_an_exact_normalization_not_a_recalculation(self):
        source_field = self.envelope["data"]["rating_period"]["source_field"]
        source = self.elo["data"][source_field]
        rows = self.envelope["data"]["teams"]
        diagnostics = {
            row["team_slug"]: row for row in self.elo["data"]["team_diagnostics"]["teams"]
        }
        self.assertEqual(len(rows), len(source))
        for rank, (actual, expected) in enumerate(zip(rows, source), start=1):
            value = actual["systems"][registry.SYSTEM_ID]
            self.assertEqual(actual["team_slug"], expected["team_slug"])
            self.assertEqual(value["rank"], rank)
            self.assertEqual(value["team_strength"], expected["rating"])
            self.assertEqual(value["games_rated"], expected["games_rated"])
            self.assertEqual(
                value["retrodictive_team_diagnostic"],
                {field: diagnostics[expected["team_slug"]][field] for field in registry.DIAGNOSTIC_FIELDS},
            )

    def test_team_diagnostics_are_available_but_not_ranked_or_graded(self):
        contract = self.envelope["data"]["systems"][0]["team_diagnostics"]
        self.assertTrue(contract["available"])
        self.assertFalse(contract["prospective"])
        self.assertFalse(contract["graded"])
        self.assertFalse(contract["rankings_published"])
        for row in self.envelope["data"]["teams"]:
            diagnostic = row["systems"][registry.SYSTEM_ID]["retrodictive_team_diagnostic"]
            self.assertNotIn("rank", diagnostic)
            self.assertNotIn("label", diagnostic)

    def test_unsupported_outputs_are_null_not_invented(self):
        for row in self.envelope["data"]["teams"]:
            value = row["systems"][registry.SYSTEM_ID]
            for field in registry.NULLABLE_OUTPUTS:
                self.assertIsNone(value[field], f"{row['team_slug']} {field}")

    def test_one_system_is_not_called_a_consensus(self):
        consensus = self.envelope["data"]["consensus"]
        self.assertEqual(consensus["status"], "not-built")
        self.assertIsNone(consensus["weights"])
        self.assertIn("One independent rating", consensus["reason"])

    def test_matchup_transform_is_published_from_the_elo_parameters(self):
        system = self.envelope["data"]["systems"][0]
        projection = system["matchup_probability"]
        self.assertTrue(projection["available"])
        self.assertEqual(projection["elo_scale"], 400.0)
        self.assertEqual(projection["home_field_elo"], registry.elo.PARAMS["home_field_elo"])
        self.assertTrue(projection["not_a_team_level_output"])
        self.assertFalse(system["outputs"]["win_probability"]["available"])

    def test_published_transform_reproduces_the_elo_probability_function(self):
        projection = self.envelope["data"]["systems"][0]["matchup_probability"]
        home, away = 1925.8, 1700.0
        actual = 1 / (1 + 10 ** (-(home - away + projection["home_field_elo"]) / projection["elo_scale"]))
        self.assertAlmostEqual(actual, registry.elo.expected_home_prob(home, away, neutral=False))

    def test_snapshot_tamper_is_rejected(self):
        broken = copy.deepcopy(self.envelope)
        broken["data"]["teams"][0]["systems"][registry.SYSTEM_ID]["team_strength"] += 1
        with self.assertRaises(registry.ContractError):
            registry.validate_envelope(broken, self.elo)

    def test_rehashed_source_drift_is_still_rejected(self):
        broken = copy.deepcopy(self.envelope)
        broken["data"]["teams"][0]["systems"][registry.SYSTEM_ID]["team_strength"] += 1
        broken["integrity"]["snapshot_id"] = registry.backbone.sha256_id(broken["data"])
        with self.assertRaisesRegex(registry.ContractError, "drift"):
            registry.validate_envelope(broken, self.elo)

    def test_rehashed_diagnostic_drift_is_still_rejected(self):
        broken = copy.deepcopy(self.envelope)
        broken["data"]["teams"][0]["systems"][registry.SYSTEM_ID]["retrodictive_team_diagnostic"]["expected_wins"] += 1
        broken["integrity"]["snapshot_id"] = registry.backbone.sha256_id(broken["data"])
        with self.assertRaisesRegex(registry.ContractError, "drift"):
            registry.validate_envelope(broken, self.elo)

    def test_noncontiguous_ranks_are_rejected(self):
        broken = copy.deepcopy(self.envelope)
        broken["data"]["teams"][0]["systems"][registry.SYSTEM_ID]["rank"] = 99
        broken["integrity"]["snapshot_id"] = registry.backbone.sha256_id(broken["data"])
        with self.assertRaisesRegex(registry.ContractError, "contiguous"):
            registry.validate_envelope(broken)

    def test_refresh_is_deterministic_for_the_same_input(self):
        first = registry.make_envelope(registry.build(self.elo), self.elo)
        second = registry.make_envelope(registry.build(self.elo), self.elo)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
