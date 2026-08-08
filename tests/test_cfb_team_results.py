import copy
import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "cfb_team_results", ROOT / "scripts" / "cfb_team_results.py"
)
results = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = results
SPEC.loader.exec_module(results)


class TeamResultsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schedule = results.backbone.read_json(ROOT / "data" / "cfb-schedule.json")
        cls.team_game = results.backbone.read_json(ROOT / "data" / "cfb-team-game.json")
        cls.team_week = results.backbone.read_json(ROOT / "data" / "cfb-team-week.json")

    def test_published_surfaces_validate_against_the_current_schedule(self):
        results.validate_team_game(self.team_game, self.schedule)
        results.validate_team_week(self.team_week, self.team_game, self.schedule)

    def test_every_game_has_two_mirrored_rows(self):
        by_game = {}
        for row in self.team_game["data"]["rows"]:
            by_game.setdefault(row["game_id"], []).append(row)
        self.assertEqual(len(by_game), len(self.schedule["data"]["games"]))
        for game_id, pair in by_game.items():
            self.assertEqual(len(pair), 2, game_id)
            first, second = pair
            self.assertEqual(first["team_slug"], second["opponent_slug"])
            self.assertEqual(first["opponent_slug"], second["team_slug"])
            self.assertEqual(first["points_for"], second["points_against"])
            self.assertEqual(first["point_differential"], -second["point_differential"])

    def test_nonfinal_game_does_not_manufacture_a_result(self):
        changed = copy.deepcopy(self.schedule)
        game = changed["data"]["games"][0]
        game["status"] = "scheduled"
        game["home_points"] = None
        game["away_points"] = None
        changed["integrity"]["snapshot_id"] = results.backbone.sha256_id(changed["data"]["games"])
        payload = results.build_team_game(changed)
        pair = [row for row in payload["rows"] if row["game_id"] == game["game_id"]]
        self.assertEqual(len(pair), 2)
        self.assertTrue(all(row["result"] is None and row["point_differential"] is None for row in pair))

    def test_team_identity_drift_fails_closed(self):
        changed = copy.deepcopy(self.schedule)
        slug = changed["data"]["games"][0]["home_team_slug"]
        later = next(game for game in changed["data"]["games"][1:]
                     if game["home_team_slug"] == slug or game["away_team_slug"] == slug)
        side = "home" if later["home_team_slug"] == slug else "away"
        later[f"{side}_conference"] = "Wrong Conference"
        changed["integrity"]["snapshot_id"] = results.backbone.sha256_id(changed["data"]["games"])
        with self.assertRaisesRegex(results.ContractError, "identity drift"):
            results.build_team_game(changed)

    def test_week_keys_keep_postseason_week_one_separate(self):
        rows = self.team_week["data"]["rows"]
        keys = {(row["team_slug"], row["period_key"]) for row in rows}
        postseason_teams = {row["team_slug"] for row in rows if row["season_type"] == "postseason"}
        self.assertTrue(postseason_teams)
        team = next(slug for slug in postseason_teams if (slug, "regular-01") in keys)
        self.assertIn((team, "postseason-01"), keys)
        self.assertIn((team, "regular-01"), keys)

    def test_period_contract_allows_multiple_games_under_one_upstream_week(self):
        row = next(row for row in self.team_week["data"]["rows"]
                   if row["team_slug"] == "unlv" and row["period_key"] == "regular-01")
        self.assertEqual(row["scheduled_games_this_period"], 2)
        self.assertEqual(row["period"]["games"], 2)
        self.assertEqual(len(row["opponent_slugs"]), 2)

    def test_season_to_date_totals_reconcile_with_team_games(self):
        team = "ohio-state"
        team_rows = [row for row in self.team_game["data"]["rows"]
                     if row["team_slug"] == team and row["result"] is not None]
        final_period = [row for row in self.team_week["data"]["rows"] if row["team_slug"] == team][-1]
        totals = final_period["season_to_date"]
        self.assertEqual(totals["games"], len(team_rows))
        self.assertEqual(totals["points_for"], sum(row["points_for"] for row in team_rows))
        self.assertEqual(totals["points_against"], sum(row["points_against"] for row in team_rows))
        self.assertEqual(totals["wins"] + totals["losses"] + totals["ties"], totals["games"])

    def test_advanced_metrics_are_explicitly_unavailable(self):
        for envelope in (self.team_game, self.team_week):
            self.assertEqual(envelope["data"]["scope"], "results-only")
            self.assertIn("epa_per_play", envelope["data"]["unavailable_metrics"])
            self.assertIn("opponent_adjusted_metrics", envelope["data"]["unavailable_metrics"])
            self.assertIn("OBSERVED RESULTS ONLY", envelope["note"])

    def test_rehashed_row_tamper_still_fails_source_reconciliation(self):
        broken = copy.deepcopy(self.team_game)
        broken["data"]["rows"][0]["points_for"] += 1
        broken["integrity"]["snapshot_id"] = results.backbone.sha256_id(broken["data"])
        with self.assertRaisesRegex(results.ContractError, "drift"):
            results.validate_team_game(broken, self.schedule)

    def test_build_is_deterministic_for_the_same_snapshot(self):
        first_game = results.build_team_game(self.schedule)
        second_game = results.build_team_game(self.schedule)
        self.assertEqual(first_game, second_game)
        self.assertEqual(results.build_team_week(first_game), results.build_team_week(second_game))


if __name__ == "__main__":
    unittest.main()
