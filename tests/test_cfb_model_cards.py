import copy
import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("cfb_model_cards", ROOT / "scripts" / "cfb_model_cards.py")
cards = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = cards
SPEC.loader.exec_module(cards)


BINS = [
    {"bin_low": 0.0, "bin_high": 0.1, "n": 0, "mean_predicted": None, "observed_home_win_rate": None},
    {"bin_low": 0.5, "bin_high": 0.6, "n": 100, "mean_predicted": 0.55, "observed_home_win_rate": 0.56},
    {"bin_low": 0.8, "bin_high": 0.9, "n": 90, "mean_predicted": 0.85, "observed_home_win_rate": 0.93},
]


class CalibrationReadingTests(unittest.TestCase):
    def test_reading_quotes_the_bins_rather_than_hand_typed_numbers(self):
        text = cards.calibration_reading(BINS)
        self.assertIn("0.850", text)
        self.assertIn("0.930", text)
        self.assertIn("90 games", text)

    def test_empty_bins_do_not_crash_or_invent_a_finding(self):
        empty = [{"bin_low": 0.0, "bin_high": 0.1, "n": 0,
                  "mean_predicted": None, "observed_home_win_rate": None}]
        self.assertEqual(cards.calibration_reading(empty), "No bin carried any games.")

    def test_largest_gap_is_reported_first(self):
        text = cards.calibration_reading(BINS)
        self.assertLess(text.index("0.850"), text.index("0.550"))


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.path = ROOT / "data" / "cfb-model-cards.json"
        if not self.path.exists():
            self.skipTest("data/cfb-model-cards.json not built yet")
        self.envelope = cards.backbone.read_json(self.path)

    def test_published_cards_validate(self):
        cards.validate_envelope(self.envelope)

    def test_every_governance_field_is_present(self):
        for card in self.envelope["data"]["cards"]:
            for field in cards.REQUIRED_CARD_FIELDS:
                self.assertIn(field, card, f"{card['model_id']} is missing {field}")

    def test_a_card_missing_limitations_is_rejected(self):
        broken = copy.deepcopy(self.envelope)
        broken["data"]["cards"][0]["known_limitations"] = []
        broken["integrity"]["snapshot_id"] = cards.backbone.sha256_id(broken["data"])
        with self.assertRaises(cards.ContractError):
            cards.validate_envelope(broken)

    def test_lifecycle_is_read_from_the_roadmap_not_asserted(self):
        """Two files claiming different statuses for the same model is the failure
        this guards against."""
        roadmap = cards.backbone.read_json(ROOT / "data" / "pound-tools.json")["data"]
        entries = roadmap.values() if isinstance(roadmap, dict) else roadmap
        by_id = {e["id"]: e for e in entries if isinstance(e, dict) and "id" in e}
        for card in self.envelope["data"]["cards"]:
            idea = by_id.get(card["roadmap_idea"])
            self.assertIsNotNone(idea, f"{card['roadmap_idea']} missing from the roadmap")
            self.assertEqual(card["lifecycle_status"]["roadmap_lifecycle_status"],
                             idea["lifecycle_status"])

    def test_cards_do_not_claim_a_graded_forecast(self):
        self.assertFalse(self.envelope["graded"])
        for card in self.envelope["data"]["cards"]:
            self.assertFalse(card["receipts"]["prospective_receipts_exist"])

    def test_team_diagnostic_summary_is_generated_and_non_ranked(self):
        elo_envelope = cards.backbone.read_json(ROOT / "data" / "cfb-elo.json")
        card = self.envelope["data"]["cards"][0]
        diagnostic = card["performance"]["team_diagnostics"]
        source = elo_envelope["data"]["team_diagnostics"]
        self.assertEqual(diagnostic["kind"], source["kind"])
        self.assertEqual(diagnostic["teams"], len(source["teams"]))
        self.assertFalse(diagnostic["prospective"])
        self.assertFalse(diagnostic["graded"])
        self.assertFalse(diagnostic["rankings_published"])

    def test_snapshot_tamper_is_detected(self):
        broken = copy.deepcopy(self.envelope)
        broken["data"]["cards"][0]["model_version"] = "9.9.9"
        with self.assertRaises(cards.ContractError):
            cards.validate_envelope(broken)


if __name__ == "__main__":
    unittest.main()
