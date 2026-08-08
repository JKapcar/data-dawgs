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
        self.assertEqual(len(rows), len(source))
        for rank, (actual, expected) in enumerate(zip(rows, source), start=1):
            value = actual["systems"][registry.SYSTEM_ID]
            self.assertEqual(actual["team_slug"], expected["team_slug"])
            self.assertEqual(value["rank"], rank)
            self.assertEqual(value["team_strength"], expected["rating"])
            self.assertEqual(value["games_rated"], expected["games_rated"])

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
