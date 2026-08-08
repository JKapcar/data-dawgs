import copy
import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("cfb_data_backbone", ROOT / "scripts" / "cfb_data_backbone.py")
backbone = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = backbone
SPEC.loader.exec_module(backbone)


def source_row(index=0, **overrides):
    row = {
        "game_id": str(401000000 + index),
        "season": 2025,
        "week": index % 15 + 1,
        "season_type": "regular",
        "start_date": "2025-09-06T16:00:00.000Z",
        "completed": "TRUE",
        "neutral_site": "FALSE",
        "conference_game": "TRUE",
        "home_id": str(100 + index * 2),
        "home_team": f"Home College {index}",
        "home_division": "fbs",
        "home_conference": "Test Conference",
        "home_points": "28",
        "away_id": str(101 + index * 2),
        "away_team": f"Away College {index}",
        "away_division": "fbs",
        "away_conference": "Test Conference",
        "away_points": "14",
    }
    row.update(overrides)
    return row


def relaxed_gates():
    """Shrink the volume gates so small fixtures can exercise the contract."""
    return unittest.mock.patch.multiple(
        backbone, FBS_GAME_RANGE=(1, 50), FBS_TEAM_RANGE=(1, 145)
    )


# unittest.mock is stdlib but imported lazily to keep the top import block honest.
import unittest.mock  # noqa: E402


class CanonicalizationTests(unittest.TestCase):
    def test_fbs_involved_games_survive_and_others_are_dropped(self):
        rows = [
            source_row(0),
            source_row(1, home_division="ii", away_division="ii"),
            source_row(2, home_division="fcs", away_division="fbs"),
        ]
        with relaxed_gates():
            games = backbone.canonicalize_source_rows(rows, 2025)
        self.assertEqual(len(games), 2)
        for game in games:
            self.assertIn("fbs", (game["home_division"], game["away_division"]))

    def test_canonical_ids_are_deterministic_slugs(self):
        with relaxed_gates():
            games = backbone.canonicalize_source_rows([source_row(3)], 2025)
        self.assertEqual(games[0]["game_id"], "2025_regu_04_away-college-3_home-college-3")
        self.assertEqual(games[0]["home_team_slug"], "home-college-3")

    def test_partial_score_on_completed_game_fails_closed(self):
        with relaxed_gates(), self.assertRaises(backbone.ContractError):
            backbone.canonicalize_source_rows([source_row(0, away_points="NA")], 2025)

    def test_incomplete_game_scores_are_nulled_not_trusted(self):
        with relaxed_gates():
            games = backbone.canonicalize_source_rows(
                [source_row(0, completed="FALSE", home_points="28", away_points="14")], 2025
            )
        self.assertIsNone(games[0]["home_points"])
        self.assertEqual(games[0]["status"], "scheduled")

    def test_missing_column_fails_closed(self):
        row = source_row(0)
        del row["start_date"]
        with relaxed_gates(), self.assertRaises(backbone.ContractError):
            backbone.canonicalize_source_rows([row], 2025)

    def test_mixed_season_fails_closed(self):
        with relaxed_gates(), self.assertRaises(backbone.ContractError):
            backbone.canonicalize_source_rows([source_row(0, season=2024)], 2025)

    def test_unknown_division_fails_closed(self):
        with relaxed_gates(), self.assertRaises(backbone.ContractError):
            backbone.canonicalize_source_rows([source_row(0, home_division="juco")], 2025)

    def test_fbs_team_without_conference_fails_closed(self):
        with relaxed_gates(), self.assertRaises(backbone.ContractError):
            backbone.canonicalize_source_rows([source_row(0, home_conference="NA")], 2025)

    def test_duplicate_upstream_ids_fail_closed(self):
        rows = [source_row(0), source_row(1, game_id=str(401000000))]
        with relaxed_gates(), self.assertRaises(backbone.ContractError):
            backbone.canonicalize_source_rows(rows, 2025)

    def test_volume_gate_fails_closed_on_suspicious_counts(self):
        with self.assertRaises(backbone.ContractError):
            backbone.canonicalize_source_rows([source_row(0)], 2025)


class EnvelopeTests(unittest.TestCase):
    def build_envelope(self):
        with relaxed_gates():
            games = backbone.canonicalize_source_rows([source_row(i) for i in range(3)], 2025)
        return backbone.make_schedule_envelope(
            games, 2025, "935eed66a08c95822992fd182495848ac4303f96",
            "0" * 64, "2026-08-08T05:00:00Z",
        )

    def test_envelope_round_trips_validation(self):
        with relaxed_gates():
            backbone.validate_schedule_envelope(self.build_envelope())

    def test_snapshot_tamper_is_detected(self):
        envelope = self.build_envelope()
        envelope["data"]["games"][0]["home_points"] = 99
        with relaxed_gates(), self.assertRaises(backbone.ContractError):
            backbone.validate_schedule_envelope(envelope)

    def test_missing_repo_pin_is_detected(self):
        envelope = self.build_envelope()
        envelope["provenance"]["source_repo_head_at_capture"] = "not-a-sha"
        with relaxed_gates(), self.assertRaises(backbone.ContractError):
            backbone.validate_schedule_envelope(envelope)


class PublishedFileTests(unittest.TestCase):
    """The committed public file must satisfy its own contract, offline."""

    def test_published_schedule_validates(self):
        path = ROOT / "data" / "cfb-schedule.json"
        if not path.exists():
            self.skipTest("data/cfb-schedule.json not built yet")
        backbone.validate_schedule_envelope(backbone.read_json(path))

    def test_published_schedule_is_2025_and_complete(self):
        path = ROOT / "data" / "cfb-schedule.json"
        if not path.exists():
            self.skipTest("data/cfb-schedule.json not built yet")
        envelope = backbone.read_json(path)
        self.assertEqual(envelope["data"]["season"], 2025)
        games = envelope["data"]["games"]
        finals = [g for g in games if g["status"] == "final"]
        self.assertGreater(len(finals) / len(games), 0.99)


if __name__ == "__main__":
    unittest.main()
