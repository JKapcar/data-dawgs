import importlib.util
import json
import math
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("elo_538_classic", SCRIPTS / "elo_538_classic.py")
elo = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(elo)


OFFICIAL_PROBABILITY_CHECKPOINTS = [
    (1503.947, 1300.0, False, 0.8246512009492516),
    (1503.42, 1300.0, False, 0.8242120973373386),
    (1562.92, 1415.301, False, 0.7727550050827636),
    (1594.613, 1529.011, False, 0.6795719912207544),
    (1376.06, 1442.672, False, 0.4976801621650896),
    (1484.314, 1451.566, False, 0.6370730422181038),
    (1664.8472507563, 1527.93004656683, False, 0.7617556234419874),
    (1703.30329600465, 1741.08727932497, True, 0.4458378304058082),
    (1467.04162910093, 1358.67340590286, False, 0.7306627556439421),
]


class ClassicMathTests(unittest.TestCase):
    def test_csv_source_hashes_are_cross_platform(self):
        lf = b"a,b\n1,2\n"
        crlf = b"a,b\r\n1,2\r\n"
        self.assertEqual(elo.normalize_csv_bytes(lf), lf)
        self.assertEqual(elo.normalize_csv_bytes(crlf), lf)

    def test_official_probability_checkpoints(self):
        for home, away, neutral, expected in OFFICIAL_PROBABILITY_CHECKPOINTS:
            with self.subTest(home=home, away=away, neutral=neutral):
                self.assertAlmostEqual(elo.win_probability(home, away, neutral), expected, places=12)

    def test_equal_teams_use_original_hfa(self):
        expected = 1 / (10 ** (-65 / 400) + 1)
        self.assertAlmostEqual(elo.win_probability(1500, 1500), expected, places=15)
        self.assertEqual(elo.win_probability(1500, 1500, True), 0.5)

    def test_offseason_reversion_retains_two_thirds(self):
        self.assertAlmostEqual(elo.regress_rating(1600), 1505 / 3 + 1600 * 2 / 3)

    def test_tie_update_is_zero_sum(self):
        state = {
            "A": {"rating": 1550.0, "season": 2025},
            "B": {"rating": 1450.0, "season": 2025},
        }
        before = state["A"]["rating"] + state["B"]["rating"]
        probability = elo.play_game(state, "A", "B", 2025, False, 20, 20)
        self.assertGreater(probability, 0.5)
        self.assertAlmostEqual(state["A"]["rating"] + state["B"]["rating"], before)

    def test_winner_gains_and_loser_loses_same_elo(self):
        state = {
            "A": {"rating": 1500.0, "season": 2025},
            "B": {"rating": 1500.0, "season": 2025},
        }
        elo.play_game(state, "A", "B", 2025, False, 27, 17)
        self.assertGreater(state["A"]["rating"], 1500)
        self.assertAlmostEqual(state["A"]["rating"] - 1500, 1500 - state["B"]["rating"])


class PublishedClassicTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schedule = json.loads((ROOT / "data" / "nfl-schedule.json").read_text(encoding="utf-8"))
        cls.model = json.loads((ROOT / "data" / "538-classic.json").read_text(encoding="utf-8"))
        cls.ledger = json.loads((ROOT / "data" / "model-receipts.json").read_text(encoding="utf-8"))
        cls.legacy = json.loads((ROOT / "data" / "receipts.json").read_text(encoding="utf-8"))

    def test_public_envelope_reproduces(self):
        elo.validate_envelope(self.model, self.schedule)
        self.assertEqual(self.model["validation"]["official_probabilities_compared"], 16810)
        self.assertLess(self.model["validation"]["max_absolute_probability_error"], 2e-6)

    def test_all_2026_games_have_prospective_forecasts(self):
        forecasts = self.model["data"]["forecasts"]
        self.assertEqual(len(forecasts), 272)
        self.assertEqual(
            {row["game_id"] for row in forecasts},
            {row["game_id"] for row in self.schedule["data"]["games"]},
        )

    def test_public_receipts_are_two_complete_model_sets(self):
        elo.validate_public(self.model, self.ledger, self.legacy, self.schedule)
        counts = {}
        for row in self.ledger["data"]:
            counts[row["model_id"]] = counts.get(row["model_id"], 0) + 1
        self.assertEqual(counts, {"nfelo": 272, "538-classic": 272})

    def test_every_receipt_precedes_kickoff(self):
        for row in self.ledger["data"]:
            self.assertLess(
                elo.backbone.parse_timestamp(row["captured_at"], "captured_at"),
                elo.backbone.parse_timestamp(row["kickoff_at"], "kickoff_at"),
            )

    def test_nfelo_adapter_preserves_probability_and_aliases(self):
        expected = elo.migrate_nfelo_receipts(self.legacy, self.schedule)
        by_legacy = {row["legacy_receipt_id"]: row for row in expected}
        self.assertEqual(by_legacy["2026_01_ARI_LAC"]["home_win_probability"], 0.806)
        self.assertEqual(by_legacy["2026_01_SF_LA"]["game_id"], "2026_01_SF_LAR")

    def test_unprovenanced_legacy_market_values_are_not_normalized(self):
        migrated = elo.migrate_nfelo_receipts(self.legacy, self.schedule)
        with_market = [row for row in migrated if row["market_status"].startswith("not-normalized")]
        self.assertEqual(len(with_market), 51)
        for row in migrated:
            self.assertNotIn("market_home_win_probability", row)

    def test_input_and_schedule_snapshots_are_distinct_contracts(self):
        sample = next(row for row in self.ledger["data"] if row["model_id"] == "538-classic")
        self.assertEqual(sample["input_snapshot_id"], self.model["integrity"]["input_snapshot_id"])
        self.assertEqual(sample["schedule_snapshot_id"], self.schedule["integrity"]["snapshot_id"])
        self.assertNotEqual(sample["input_snapshot_id"], sample["schedule_snapshot_id"])

    def test_probabilities_are_finite_and_bounded(self):
        for row in self.model["data"]["forecasts"]:
            self.assertTrue(math.isfinite(row["home_win_probability"]))
            self.assertGreaterEqual(row["home_win_probability"], 0)
            self.assertLessEqual(row["home_win_probability"], 1)


if __name__ == "__main__":
    unittest.main()
