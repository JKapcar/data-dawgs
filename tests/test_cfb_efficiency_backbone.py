import csv
import io
import unittest

from scripts import cfb_efficiency_backbone as backbone


class CfbEfficiencyBackboneTests(unittest.TestCase):
    def test_build_selects_fbs_and_keeps_directional_names(self):
        fieldnames = sorted(backbone.FIELDS)
        rows = []
        for index in range(100):
            row = {field: "1" for field in fieldnames}
            row.update({
                "team_id": str(index), "pos_team": f"Team {index}", "division": "fbs",
                "conference": "Test", "season": "2025", "valid_games": "12",
                "plays_off": "700", "adj_off_epa_rank": str(index + 1),
                "adj_def_epa_rank": str(index + 1), "net_adj_epa_rank": str(index + 1),
            })
            rows.append(row)
        rows.append({**rows[0], "team_id": "fcs", "pos_team": "FCS Team", "division": "fcs"})
        stream = io.StringIO()
        writer = csv.DictWriter(stream, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
        payload = backbone.build(stream.getvalue().encode(), "https://example.test/data.csv", "2026-08-29", 2025)
        backbone.validate(payload)
        self.assertEqual(len(payload["data"]["teams"]), 100)
        self.assertIn("def_epa_play_allowed", payload["data"]["teams"][0]["adjusted"])
        self.assertNotIn("FCS Team", [row["team"] for row in payload["data"]["teams"]])


if __name__ == "__main__":
    unittest.main()
