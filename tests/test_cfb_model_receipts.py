import copy
import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "cfb_model_receipts", ROOT / "scripts" / "cfb_model_receipts.py"
)
receipts = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = receipts
SPEC.loader.exec_module(receipts)


class CfbReceiptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schedule = receipts.backbone.read_json(ROOT / "data" / "cfb-schedule.json")
        cls.ratings = receipts.backbone.read_json(ROOT / "data" / "cfb-ratings.json")
        cls.cards = receipts.backbone.read_json(ROOT / "data" / "cfb-model-cards.json")
        cls.ledger = receipts.backbone.read_json(ROOT / "data" / "cfb-model-receipts.json")

    def setUp(self):
        self.future_schedule = copy.deepcopy(self.schedule)
        game = self.future_schedule["data"]["games"][0]
        game["status"] = "scheduled"
        game["kickoff_at"] = "2027-08-23T16:00:00Z"
        game["home_points"] = None
        game["away_points"] = None
        self.future_schedule["integrity"]["snapshot_id"] = receipts.backbone.sha256_id(
            self.future_schedule["data"]["games"]
        )
        self.receipt = {
            "forecast_id": "dd-cfb-elo-2025-regu-01-iowa-state-kansas-state-v1",
            "model_id": "cfb-elo",
            "model_version": "1.0.0",
            "game_id": game["game_id"],
            "season": game["season"],
            "week": game["week"],
            "kickoff_at": game["kickoff_at"],
            "issued_at": "2027-08-22T15:00:00Z",
            "forecast_status": "prospective",
            "grading_status": "ungraded",
            "schedule_snapshot_id": self.future_schedule["integrity"]["snapshot_id"],
            "input_snapshot_ids": {
                "ratings_registry": self.ratings["integrity"]["snapshot_id"],
                "model_cards": self.cards["integrity"]["snapshot_id"],
            },
            "home_team": game["home_team"],
            "home_team_slug": game["home_team_slug"],
            "away_team": game["away_team"],
            "away_team_slug": game["away_team_slug"],
            "home_win_probability": 0.61,
            "expected_margin_home": 4.5,
            "predicted_total": None,
            "market_context": {
                "provider": "SportsGameOdds",
                "captured_at": "2027-08-22T14:00:00Z",
                "receipt_snapshot_id": "sha256:" + "a" * 64,
                "home_probability_no_vig": 0.57,
            },
            "assumptions": ["Flat 55-point non-neutral home-field adjustment."],
            "source_engine": "scripts/cfb_elo.py",
            "source_commit": "b" * 40,
        }

    def append(self, additions):
        return receipts.append_receipts(
            self.ledger, additions, self.future_schedule, self.ratings, self.cards
        )

    def test_published_ledger_is_valid_and_honestly_empty(self):
        receipts.validate_ledger(self.ledger)
        self.assertEqual(self.ledger["data"], [])
        self.assertEqual(self.ledger["integrity"]["rows"], 0)
        self.assertIn("EMPTY BY DESIGN", self.ledger["note"])

    def test_valid_future_receipt_appends(self):
        updated = self.append([self.receipt])
        self.assertEqual(updated["data"], [self.receipt])
        receipts.validate_ledger(updated)

    def test_identical_append_is_idempotent_but_conflict_fails(self):
        once = self.append([self.receipt])
        twice = receipts.append_receipts(
            once, [self.receipt], self.future_schedule, self.ratings, self.cards
        )
        self.assertEqual(once, twice)
        changed = copy.deepcopy(self.receipt)
        changed["home_win_probability"] = 0.62
        with self.assertRaisesRegex(receipts.ContractError, "conflicting duplicate"):
            receipts.append_receipts(
                once, [changed], self.future_schedule, self.ratings, self.cards
            )

    def test_current_completed_schedule_cannot_accept_a_fake_prospective_receipt(self):
        fake = copy.deepcopy(self.receipt)
        real_game = self.schedule["data"]["games"][0]
        for field in ("season", "week", "kickoff_at", "home_team", "home_team_slug", "away_team", "away_team_slug"):
            fake[field] = real_game[field]
        fake["issued_at"] = "2025-08-22T15:00:00Z"
        fake["schedule_snapshot_id"] = self.schedule["integrity"]["snapshot_id"]
        fake["market_context"] = None
        with self.assertRaisesRegex(receipts.ContractError, "scheduled game"):
            receipts.append_receipts(self.ledger, [fake], self.schedule, self.ratings, self.cards)

    def test_post_kickoff_issue_is_rejected(self):
        broken = copy.deepcopy(self.receipt)
        broken["issued_at"] = broken["kickoff_at"]
        with self.assertRaisesRegex(receipts.ContractError, "before kickoff"):
            receipts.validate_receipt(broken)

    def test_market_observation_after_issue_is_rejected(self):
        broken = copy.deepcopy(self.receipt)
        broken["market_context"]["captured_at"] = "2027-08-22T15:30:00Z"
        with self.assertRaisesRegex(receipts.ContractError, "before issue time"):
            receipts.validate_receipt(broken)

    def test_wrong_input_snapshot_is_rejected(self):
        broken = copy.deepcopy(self.receipt)
        broken["input_snapshot_ids"]["ratings_registry"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(receipts.ContractError, "ratings snapshot"):
            self.append([broken])

    def test_required_input_snapshot_names_cannot_be_substituted(self):
        broken = copy.deepcopy(self.receipt)
        broken["input_snapshot_ids"] = {
            "some_other_input": "sha256:" + "0" * 64,
            "another_input": "sha256:" + "1" * 64,
        }
        with self.assertRaisesRegex(receipts.ContractError, "must name ratings_registry and model_cards"):
            receipts.validate_receipt(broken)

    def test_backtest_row_is_rejected(self):
        broken = copy.deepcopy(self.receipt)
        broken["forecast_status"] = "backtest"
        with self.assertRaisesRegex(receipts.ContractError, "prospective forecasts only"):
            receipts.validate_receipt(broken)

    def test_receipt_grading_cannot_mutate_the_forecast_row(self):
        broken = copy.deepcopy(self.receipt)
        broken["grading_status"] = "graded"
        with self.assertRaisesRegex(receipts.ContractError, "grading surface"):
            receipts.validate_receipt(broken)

    def test_history_is_append_only(self):
        receipts.assert_append_only([self.receipt], [self.receipt, {"forecast_id": "later"}])
        changed = copy.deepcopy(self.receipt)
        changed["home_win_probability"] = 0.2
        with self.assertRaisesRegex(receipts.ContractError, "mutated"):
            receipts.assert_append_only([self.receipt], [changed])
        with self.assertRaisesRegex(receipts.ContractError, "removed"):
            receipts.assert_append_only([self.receipt], [])

    def test_rehashed_tamper_is_caught_by_supporting_snapshot_checks(self):
        broken = copy.deepcopy(self.receipt)
        broken["schedule_snapshot_id"] = "sha256:" + "1" * 64
        with self.assertRaisesRegex(receipts.ContractError, "schedule snapshot"):
            self.append([broken])


if __name__ == "__main__":
    unittest.main()
