import copy
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("nfl_player_backbone", ROOT / "scripts" / "nfl_player_backbone.py")
backbone = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = backbone
SPEC.loader.exec_module(backbone)


def source_row(index: int) -> dict:
    return {
        "gsis_id": f"00-{index:07d}", "display_name": f"Player {index}",
        "first_name": "Player", "last_name": str(index), "common_first_name": "Player",
        "football_name": "Player", "position": "WR", "position_group": "WR",
        "birth_date": "2000-01-01", "height": "72", "weight": "200",
        "latest_team": "CLE", "status": "ACT", "college_name": "Ohio State",
        "college_conference": "Big Ten", "rookie_season": "2024", "last_season": "2026",
        "draft_year": "2024", "draft_round": "1", "draft_pick": "20", "draft_team": "CLE",
        "esb_id": "", "nfl_id": str(1000 + index), "smart_id": "",
        "pfr_id": f"Play{index:04d}", "pff_id": "", "otc_id": "", "espn_id": str(2000 + index),
    }


class IdentityTests(unittest.TestCase):
    def test_id_is_stable_and_gsis_anchored(self):
        a = backbone.dd_player_id("00-0036322")
        self.assertEqual(a, backbone.dd_player_id("00-0036322"))
        self.assertRegex(a, r"^DD-NFL-[0-9a-f]{16}$")
        self.assertNotEqual(a, backbone.dd_player_id("00-0036323"))

    def test_rows_without_gsis_are_explicitly_excluded(self):
        rows = [source_row(i) for i in range(10000)]
        rows.append({**source_row(10001), "gsis_id": ""})
        players, stats = backbone.canonicalize_rows(rows)
        self.assertEqual(len(players), 10000)
        self.assertEqual(stats["skipped_without_gsis"], 1)

    def test_missing_core_column_fails_closed(self):
        rows = [source_row(i) for i in range(10000)]
        for row in rows:
            row.pop("position_group")
        with self.assertRaisesRegex(backbone.ContractError, "position_group"):
            backbone.canonicalize_rows(rows)

    def test_duplicate_gsis_fails_closed(self):
        rows = [source_row(i) for i in range(10000)]
        rows[-1]["gsis_id"] = rows[0]["gsis_id"]
        with self.assertRaisesRegex(backbone.ContractError, "duplicate gsis_id"):
            backbone.canonicalize_rows(rows)


class SnapshotTests(unittest.TestCase):
    def envelope(self):
        players, stats = backbone.canonicalize_rows([source_row(i) for i in range(10000)])
        meta = {"asset": {"id": 1, "digest": "sha256:" + "a" * 64, "updated_at": "2026-08-09T08:35:37Z"}}
        return backbone.build_envelope(players, stats, meta, "2026-08-14T18:00:00Z")

    def test_snapshot_hash_detects_mutation(self):
        env = self.envelope()
        backbone.validate_envelope(env)
        changed = copy.deepcopy(env)
        changed["data"]["players"][0]["latest_team"] = "PIT"
        with self.assertRaisesRegex(backbone.ContractError, "snapshot hash mismatch"):
            backbone.validate_envelope(changed)

    def test_snapshot_ledger_is_idempotent(self):
        env = self.envelope()
        once = backbone.append_snapshot(backbone.empty_snapshot_ledger("2026-08-14"), env)
        twice = backbone.append_snapshot(once, env)
        self.assertEqual(len(twice["data"]), 1)

    def test_append_only_history_rejects_mutation_and_removal(self):
        env = self.envelope()
        row = backbone.append_snapshot(backbone.empty_snapshot_ledger("2026-08-14"), env)["data"][0]
        backbone.assert_append_only([row], [row, {"snapshot_id": "sha256:" + "b" * 64}])
        changed = copy.deepcopy(row)
        changed["player_count"] += 1
        with self.assertRaisesRegex(backbone.ContractError, "mutated"):
            backbone.assert_append_only([row], [changed])
        with self.assertRaisesRegex(backbone.ContractError, "removed"):
            backbone.assert_append_only([row], [])


if __name__ == "__main__":
    unittest.main()
