import copy
import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("nfl_data_backbone", ROOT / "scripts" / "nfl_data_backbone.py")
backbone = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = backbone
SPEC.loader.exec_module(backbone)


def source_row(index=0):
    teams = sorted(backbone.CURRENT_TEAMS)
    away = teams[(index * 2) % len(teams)]
    home = teams[(index * 2 + 1) % len(teams)]
    return {
        "game_id": f"2026_{index % 18 + 1:02d}_{away}_{home}",
        "season": 2026,
        "game_type": "REG",
        "week": index % 18 + 1,
        "gameday": "2026-09-13",
        "gametime": "13:00",
        "away_team": away,
        "home_team": home,
        "location": "Home",
        "away_score": None,
        "home_score": None,
        "away_rest": 7,
        "home_rest": 7,
        "div_game": 0,
    }


def valid_receipt(snapshot_id, game, model_id="nfelo"):
    return {
        "forecast_id": "nfelo-2026-01-ari-atl-v1",
        "game_id": game["game_id"],
        "season": game["season"],
        "week": game["week"],
        "kickoff_at": game["kickoff_at"],
        "captured_at": "2026-08-07T12:00:00Z",
        "model_id": model_id,
        "model_name": "nfelo",
        "model_version": "4.3.0",
        "source_repo": "greerreNFL/nfelo",
        "source_commit": "0d3f8418f1f9fc4755ff42acb2d5f56c27c137ca",
        "source_capture_at": "2026-08-07T12:00:00Z",
        "home_team": game["home_team"],
        "away_team": game["away_team"],
        "home_win_probability": 0.61,
        "expected_margin_home": None,
        "model_spread_home": None,
        "home_cover_probability": None,
        "push_probability": None,
        "input_snapshot_id": snapshot_id,
        "schedule_snapshot_id": snapshot_id,
        "forecast_status": "prospective",
        "methodology_url": "https://datadawgs216.com/nfelo.html",
        "license_status": "output-only",
    }


class CanonicalizationTests(unittest.TestCase):
    def test_team_aliases_and_game_id(self):
        self.assertEqual(backbone.canonical_team("JAC"), "JAX")
        self.assertEqual(backbone.canonical_team("LA"), "LAR")
        self.assertEqual(backbone.canonical_game_id(2026, 1, "SF", "LA"), "2026_01_SF_LAR")

    def test_kickoff_uses_eastern_dst_then_utc(self):
        self.assertEqual(backbone.kickoff_utc("2026-09-13", "13:00"), "2026-09-13T17:00:00Z")
        self.assertEqual(backbone.kickoff_utc("2026-12-13", "13:00"), "2026-12-13T18:00:00Z")

    def test_missing_source_column_fails_closed(self):
        row = source_row()
        del row["gametime"]
        with self.assertRaisesRegex(backbone.ContractError, "missing columns: gametime"):
            backbone.canonicalize_source_rows([row], 2026)

    def test_partial_score_fails_closed(self):
        row = source_row()
        row["home_score"] = 20
        with self.assertRaisesRegex(backbone.ContractError, "partial score"):
            backbone.canonicalize_source_rows([row], 2026)


class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schedule = json.loads((ROOT / "data" / "nfl-schedule.json").read_text(encoding="utf-8"))
        cls.ledger = json.loads((ROOT / "data" / "model-receipts.json").read_text(encoding="utf-8"))

    def test_committed_schedule_contract(self):
        backbone.validate_schedule_envelope(self.schedule)
        self.assertEqual(len(self.schedule["data"]["games"]), 272)
        self.assertEqual(self.schedule["integrity"]["regular_season_rows"], 272)

    def test_committed_multi_model_ledger_contract(self):
        backbone.validate_receipt_ledger(self.ledger)
        self.assertEqual(len(self.ledger["data"]), 1088)
        self.assertEqual(
            self.ledger["integrity"]["sha256"],
            backbone.receipt_ledger_hash(self.ledger["data"]),
        )

    def test_snapshot_hash_detects_mutation(self):
        changed = copy.deepcopy(self.schedule)
        changed["data"]["games"][0]["home_rest_days"] = 999
        with self.assertRaisesRegex(backbone.ContractError, "snapshot hash mismatch"):
            backbone.validate_schedule_envelope(changed)

    def test_suspicious_row_count_fails_closed(self):
        with self.assertRaisesRegex(backbone.ContractError, "suspicious season row count"):
            backbone.validate_games(self.schedule["data"]["games"][:20], 2026)

    def test_probability_bounds(self):
        game = self.schedule["data"]["games"][0]
        receipt = valid_receipt(self.schedule["integrity"]["snapshot_id"], game)
        receipt["home_win_probability"] = 1.01
        with self.assertRaisesRegex(backbone.ContractError, "outside"):
            backbone.validate_receipt(receipt)

    def test_prospective_receipt_must_precede_kickoff(self):
        game = self.schedule["data"]["games"][0]
        receipt = valid_receipt(self.schedule["integrity"]["snapshot_id"], game)
        receipt["captured_at"] = game["kickoff_at"]
        with self.assertRaisesRegex(backbone.ContractError, "before kickoff"):
            backbone.validate_receipt(receipt)

    def test_append_is_idempotent_but_conflicts_fail(self):
        game = self.schedule["data"]["games"][0]
        receipt = valid_receipt(self.schedule["integrity"]["snapshot_id"], game, "test-model")
        once = backbone.append_receipts(self.ledger, [receipt], self.schedule)
        twice = backbone.append_receipts(once, [receipt], self.schedule)
        self.assertEqual(len(twice["data"]), len(self.ledger["data"]) + 1)
        changed = copy.deepcopy(receipt)
        changed["home_win_probability"] = 0.62
        with self.assertRaisesRegex(backbone.ContractError, "conflicting duplicate"):
            backbone.append_receipts(once, [changed], self.schedule)

    def test_refreshed_input_snapshot_does_not_mint_a_second_slate(self):
        game = self.schedule["data"]["games"][0]
        snapshot_id = self.schedule["integrity"]["snapshot_id"]
        first = valid_receipt(snapshot_id, game, "test-model")
        once = backbone.append_receipts(self.ledger, [first], self.schedule)
        self.assertEqual(len(once["data"]), len(self.ledger["data"]) + 1)
        refreshed = copy.deepcopy(first)
        refreshed["forecast_id"] = "test-model-2026-01-ari-atl-v2"
        refreshed["input_snapshot_id"] = "sha256:" + "b" * 64
        again = backbone.append_receipts(once, [refreshed], self.schedule)
        self.assertEqual(again["data"], once["data"])

    def test_ledger_rejects_two_forecasts_for_one_model_and_game(self):
        game = self.schedule["data"]["games"][0]
        snapshot_id = self.schedule["integrity"]["snapshot_id"]
        first = valid_receipt(snapshot_id, game, "test-model")
        second = copy.deepcopy(first)
        second["forecast_id"] = "test-model-2026-01-ari-atl-v2"
        rows = self.ledger["data"] + [first, second]
        envelope = dict(self.ledger)
        envelope["data"] = rows
        envelope["integrity"] = {
            "sha256": backbone.receipt_ledger_hash(rows),
            "algorithm": self.ledger["integrity"]["algorithm"],
            "rows": len(rows),
        }
        with self.assertRaisesRegex(backbone.ContractError, "duplicate forecast for test-model"):
            backbone.validate_receipt_ledger(envelope)

    def test_history_allows_append_but_not_mutation_or_removal(self):
        game = self.schedule["data"]["games"][0]
        receipt = valid_receipt(self.schedule["integrity"]["snapshot_id"], game)
        backbone.assert_append_only([receipt], [receipt, {"forecast_id": "new"}])
        changed = copy.deepcopy(receipt)
        changed["home_win_probability"] = 0.62
        with self.assertRaisesRegex(backbone.ContractError, "mutated"):
            backbone.assert_append_only([receipt], [changed])
        with self.assertRaisesRegex(backbone.ContractError, "removed"):
            backbone.assert_append_only([receipt], [])


if __name__ == "__main__":
    unittest.main()
