import copy
import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("cfb_disagreement", ROOT / "scripts" / "cfb_disagreement.py")
probe = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = probe
SPEC.loader.exec_module(probe)


def paired_rows(n=400):
    """Deterministic synthetic pairs: model and market drift apart across the set."""
    rows = []
    for i in range(n):
        p_market = 0.2 + 0.6 * ((i % 20) / 19)
        gap = 0.25 * (i / n)
        p_elo = min(0.99, max(0.01, p_market - gap))
        rows.append({"p_home": p_elo, "market_p_home": p_market, "home_won": i % 3 != 0})
    return rows


class ProbeTests(unittest.TestCase):
    def test_probe_refuses_to_conclude_while_prices_are_untimestamped(self):
        payload = probe.build(paired_rows())
        self.assertEqual(payload["finding"], "blocked")
        self.assertTrue(payload["what_would_unblock_it"])

    def test_every_scored_bucket_declares_whether_it_is_underpowered(self):
        payload = probe.build(paired_rows())
        for bucket in payload["measured_anyway"]["buckets"]:
            if bucket["n"]:
                self.assertIn("underpowered", bucket)

    def test_small_buckets_are_flagged_rather_than_merged_away(self):
        payload = probe.build(paired_rows())
        for bucket in payload["measured_anyway"]["buckets"]:
            if bucket["n"] and bucket["n"] < probe.MIN_BUCKET_N:
                self.assertTrue(bucket["underpowered"])

    def test_too_few_games_fails_closed(self):
        with self.assertRaises(probe.ContractError):
            probe.build(paired_rows(50))

    def test_pattern_text_is_generated_from_the_buckets(self):
        payload = probe.build(paired_rows())
        pattern = payload["measured_anyway"]["observed_pattern"]
        advantages = [b["market_brier_advantage"] for b in payload["measured_anyway"]["buckets"] if b["n"]]
        for value in advantages:
            self.assertIn(f"{value:+.4f}", pattern)

    def test_brier_and_accuracy_agree_with_hand_computation(self):
        rows = [
            {"p_home": 0.8, "market_p_home": 0.6, "home_won": True},
            {"p_home": 0.4, "market_p_home": 0.5, "home_won": False},
        ]
        self.assertAlmostEqual(probe.brier(rows, "p_home"), ((0.8 - 1) ** 2 + 0.4 ** 2) / 2)
        self.assertAlmostEqual(probe.accuracy(rows, "p_home"), 1.0)


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.path = ROOT / "data" / "cfb-disagreement.json"
        if not self.path.exists():
            self.skipTest("data/cfb-disagreement.json not built yet")
        self.envelope = probe.backbone.read_json(self.path)

    def test_published_probe_validates(self):
        probe.validate_envelope(self.envelope)

    def test_a_blocked_finding_without_an_unblock_path_is_rejected(self):
        broken = copy.deepcopy(self.envelope)
        broken["data"]["what_would_unblock_it"] = ""
        broken["integrity"]["snapshot_id"] = probe.backbone.sha256_id(broken["data"])
        with self.assertRaises(probe.ContractError):
            probe.validate_envelope(broken)

    def test_an_invented_finding_value_is_rejected(self):
        broken = copy.deepcopy(self.envelope)
        broken["data"]["finding"] = "market-is-better"
        broken["integrity"]["snapshot_id"] = probe.backbone.sha256_id(broken["data"])
        with self.assertRaises(probe.ContractError):
            probe.validate_envelope(broken)

    def test_market_timing_is_recorded_as_unknown(self):
        self.assertEqual(self.envelope["provenance"]["market_timing"], "unknown")


if __name__ == "__main__":
    unittest.main()
